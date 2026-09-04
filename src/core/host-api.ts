/**
 * /dshm Host API dispatcher（DESIGN.md §4/§5）：可注入的 method 分发 + 请求防护 +
 * HTTP 状态映射，供 host.ts 与契约测试共用。
 *
 * 解析顺序固定：只接受 POST → JSON Content-Type → 有上限读取并 drain body →
 * 顶层必须是非 null/非数组对象且有 method → `ping` 跳过 guard，否则
 * trustedRestartRequest host-equivalence guard → typed method/业务错误映射 → 其他 500。
 */
import { BOOT_ID, addDshPlugin, publicInstallStatus } from './dsh-cli.js'
import {
  listInstalledWithMeta,
  listMarket,
  installFromRegistry,
  uninstallPlugin,
  upgradePlugin,
  withMutationLock,
} from './market.js'
import { readInstalledPluginReadme } from './installed.js'
import { isNewerVersion, npmLatest } from './versions.js'
import type { RegistryController, RegistryControllerSnapshot } from './registry-controller.js'
import { RegistryConfigError } from './registry-controller.js'
import { checkRegistryEntries } from './registry-check.js'
import { CATEGORIES, type Category } from './registry.js'
import { servingPort, scheduleRestart, trustedRestartRequest } from './restart.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

export class BadJsonError extends Error {}
export class BodyTooLargeError extends Error {}
export class UnsupportedMediaTypeError extends Error {}

class ApiProtocolError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface HostApiOverrides {
  listMarket?: typeof listMarket
  listInstalledWithMeta?: typeof listInstalledWithMeta
  installFromRegistry?: typeof installFromRegistry
  uninstallPlugin?: typeof uninstallPlugin
  upgradePlugin?: typeof upgradePlugin
  checkRegistryEntries?: typeof checkRegistryEntries
  npmLatest?: typeof npmLatest
}

export interface HostApiContext {
  controller: RegistryController
  pkg: { name: string; version: string }
  /** 变更互斥锁（host.ts 传 withMutationLock） */
  onMutation: <T>(task: () => Promise<T>) => Promise<T>
  deps?: HostApiOverrides
}

interface ParsedRequest {
  method: string
  body: Record<string, unknown>
}

const BODY_MAX_BYTES = 1 << 20

function readBody(req: IncomingMessage, maxBytes = BODY_MAX_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        settled = true
        req.resume() // drain：停止收集但不盲目 destroy socket
        reject(new BodyTooLargeError())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!settled) {
        settled = true
        resolve(Buffer.concat(chunks))
      }
    })
    req.on('error', (err) => {
      if (!settled) {
        settled = true
        reject(err)
      }
    })
  })
}

async function parseRequest(req: IncomingMessage): Promise<ParsedRequest> {
  if ((req.method || 'GET').toUpperCase() !== 'POST') {
    throw new ApiProtocolError(405, '只接受 POST')
  }
  const contentType = String(req.headers['content-type'] ?? '').trim()
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) {
    throw new UnsupportedMediaTypeError()
  }
  const raw = await readBody(req)
  let parsed: unknown
  if (raw.length === 0) throw new BadJsonError('请求体不能为空')
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
  } catch {
    throw new BadJsonError('请求体不是合法 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadJsonError('请求体顶层必须是对象')
  }
  const body = parsed as Record<string, unknown>
  const method = typeof body.method === 'string' ? body.method.trim() : ''
  if (!method) throw new BadJsonError('缺少 method')
  if (method !== 'ping' && !trustedRestartRequest(req)) {
    throw new ApiProtocolError(403, '拒绝跨源请求')
  }
  return { method, body }
}

function strArg(body: Record<string, unknown>, key: string): string {
  const v = body[key]
  return typeof v === 'string' ? v.trim() : ''
}

function boolArg(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1'
}

function snapshotPayload(snap: RegistryControllerSnapshot): Record<string, unknown> {
  return {
    registryUrl: snap.configuredAddress,
    configuredAddress: snap.configuredAddress,
    activeConfigAddress: snap.activeConfigAddress,
    pendingAddress: snap.pendingAddress,
    configStatus: snap.configStatus,
    configErrors: snap.configErrors,
    warnings: snap.warnings,
    registryState: snap.loaded,
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function errorStatus(err: unknown): { status: number; payload: Record<string, unknown> } {
  if (err instanceof BadJsonError) return { status: 400, payload: { ok: false, error: err.message } }
  if (err instanceof BodyTooLargeError) return { status: 413, payload: { ok: false, error: '请求体过大' } }
  if (err instanceof UnsupportedMediaTypeError) return { status: 415, payload: { ok: false, error: 'Content-Type 必须是 application/json' } }
  if (err instanceof RegistryConfigError) {
    return { status: 422, payload: { ok: false, error: err.message, errors: err.errors } }
  }
  if (err instanceof ApiProtocolError) return { status: err.status, payload: { ok: false, error: err.message } }
  return { status: 500, payload: { ok: false, error: err instanceof Error ? err.message : String(err) } }
}

export function createApiDispatcher(ctx: HostApiContext): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const d = {
    listMarket: ctx.deps?.listMarket ?? listMarket,
    listInstalledWithMeta: ctx.deps?.listInstalledWithMeta ?? listInstalledWithMeta,
    installFromRegistry: ctx.deps?.installFromRegistry ?? installFromRegistry,
    uninstallPlugin: ctx.deps?.uninstallPlugin ?? uninstallPlugin,
    upgradePlugin: ctx.deps?.upgradePlugin ?? upgradePlugin,
    checkRegistryEntries: ctx.deps?.checkRegistryEntries ?? checkRegistryEntries,
    npmLatest: ctx.deps?.npmLatest ?? npmLatest,
  }
  const cfg = (): typeof ctx.controller.config => ctx.controller.config

  return async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const abort = new AbortController()
    res.once('close', () => abort.abort())
    try {
      const { method, body } = await parseRequest(req)
      const signal = abort.signal
      let payload: Record<string, unknown>
      switch (method) {
        case 'ping':
          payload = { plugin: ctx.pkg.name, version: ctx.pkg.version, node: process.version, boot: BOOT_ID }
          break

        case 'self-check': {
          try {
            const latest = await d.npmLatest(ctx.pkg.name, cfg().timeoutMs ?? 20_000)
            payload = { current: ctx.pkg.version, latest: latest.version, outdated: isNewerVersion(latest.version, ctx.pkg.version) }
          } catch (err) {
            payload = { current: ctx.pkg.version, latest: null, outdated: false, error: err instanceof Error ? err.message : String(err) }
          }
          break
        }

        case 'self-upgrade': {
          const latest = await d.npmLatest(ctx.pkg.name, cfg().timeoutMs ?? 20_000)
          const result = await ctx.onMutation(() => addDshPlugin(`${ctx.pkg.name}@${latest.version}`))
          payload = { pkg: ctx.pkg.name, version: latest.version, usedAllowAllBuilds: result.usedAllowAllBuilds, needsRestart: true as const }
          break
        }

        case 'registry': {
          await ctx.controller.ensureReady()
          const snap = await ctx.controller.snapshot({ force: boolArg(body.force), signal })
          payload = { plugins: snap.loaded.registry.plugins, registryState: snap.loaded }
          break
        }

        case 'market': {
          await ctx.controller.ensureReady()
          // GUI policy：忽略客户端 withLatest，固定 true；limit clamp 1..50
          const limitRaw = Number(body.limit)
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 50
          const offsetRaw = Number(body.offset)
          const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0
          const category = typeof body.category === 'string' && (CATEGORIES as readonly string[]).includes(body.category)
            ? (body.category as Category)
            : null
          const result = await d.listMarket(cfg(), {
            query: strArg(body, 'query'),
            category,
            offset,
            limit,
            force: boolArg(body.force),
            withLatest: true,
            namespace: 'host',
            signal,
          })
          payload = { ...result }
          break
        }

        case 'installed': {
          await ctx.controller.ensureReady()
          const result = await d.listInstalledWithMeta(cfg(), { namespace: 'host', signal })
          payload = { ...result }
          break
        }

        case 'readme': {
          const target = strArg(body, 'pkg')
          if (!target) throw new ApiProtocolError(400, '缺少 pkg')
          const result = await readInstalledPluginReadme(target)
          payload = { ...result }
          break
        }

        case 'status':
          payload = { ...publicInstallStatus() }
          break

        case 'install': {
          const id = strArg(body, 'id')
          if (!id) throw new ApiProtocolError(400, '缺少 id')
          const version = typeof body.version === 'string' ? body.version : undefined
          const result = await ctx.onMutation(() => d.installFromRegistry(id, cfg(), { version, namespace: 'host' }))
          payload = { ...result }
          break
        }

        case 'uninstall': {
          const target = strArg(body, 'pkg')
          if (!target) throw new ApiProtocolError(400, '缺少 pkg')
          const result = await ctx.onMutation(() => d.uninstallPlugin(target, cfg(), { namespace: 'host' }))
          payload = { ...result }
          break
        }

        case 'upgrade': {
          const target = strArg(body, 'pkg')
          if (!target) throw new ApiProtocolError(400, '缺少 pkg')
          const result = await ctx.onMutation(() => d.upgradePlugin(target, cfg(), { namespace: 'host' }))
          payload = { ...result }
          break
        }

        case 'restart': {
          const result = scheduleRestart(servingPort(req))
          payload = { ...result }
          break
        }

        case 'registry-config': {
          const snap = await ctx.controller.snapshot()
          payload = { ...snapshotPayload(snap) }
          break
        }

        case 'registry-config-apply': {
          if (typeof body.registryUrl !== 'string') throw new ApiProtocolError(400, '缺少 registryUrl')
          const snap = await ctx.controller.apply(body.registryUrl, { signal })
          payload = { applied: true, ...snapshotPayload(snap) }
          break
        }

        case 'registry-default-download': {
          const loaded = await ctx.controller.loadDefault({ force: true, signal })
          payload = { registry: loaded.registry, registryState: loaded }
          break
        }

        case 'registry-diagnose': {
          await ctx.controller.ensureReady()
          const snap = await ctx.controller.snapshot()
          const check = await d.checkRegistryEntries(snap.loaded.registry, { signal })
          payload = { registryState: snap.loaded, check }
          break
        }

        default:
          throw new ApiProtocolError(404, `未知 method: ${method}`)
      }
      sendJson(res, 200, { ok: true, ...payload })
    } catch (err) {
      const { status, payload } = errorStatus(err)
      if (!res.headersSent) sendJson(res, status, payload)
      else res.destroy()
    }
  }
}
