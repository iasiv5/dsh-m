/**
 * /dshm Host API dispatcher（DESIGN.md §4/§5）：可注入的 method 分发 + 请求防护 +
 * HTTP 状态映射，供 host.ts 与契约测试共用。
 *
 * 解析顺序固定：只接受 POST → JSON Content-Type → 有上限读取并 drain body →
 * 顶层必须是非 null/非数组对象且有 method → `ping` 跳过 guard，否则
 * trustedRestartRequest host-equivalence guard → typed method/业务错误映射 → 其他 500。
 */
import { BOOT_ID, publicInstallStatus } from './dsh-cli.js'
import { resolveDshVersion } from './dsh-version.js'
import {
  listInstalledWithMeta,
  listMarket,
  installFromRegistry,
  selfUpgrade,
  uninstallPlugin,
  upgradePlugin,
  InstallGuardError,
} from './market.js'
import { runProfileTransaction, TransactionError, makeNpmWarmPackument } from './profile-transaction.js'
import { readInstalledPluginReadme } from './installed.js'
import { isNewerVersion, npmLatest } from './versions.js'
import { getCommunitySummary } from './community.js'
import type { RegistryController, RegistryControllerSnapshot } from './registry-controller.js'
import { RegistryConfigError } from './registry-controller.js'
import { checkRegistryEntries } from './registry-check.js'
import { CATEGORIES } from './registry.js'
import { servingPort, scheduleRestart, trustedRestartRequest } from './restart.js'
import { togglePlugin, ToggleError, type PluginManagerLike } from './toggle.js'
import { IncompatibleError } from './compat-check.js'
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
  selfUpgrade?: typeof selfUpgrade
  checkRegistryEntries?: typeof checkRegistryEntries
  npmLatest?: typeof npmLatest
  /** registry 分支社区 summary 数据源（M1 Task 6；测试注入 cache-first 模拟） */
  getCommunitySummary?: typeof getCommunitySummary
  /** Task 7：self-upgrade 委派事务（缺省 = runProfileTransaction） */
  runTransaction?: typeof runProfileTransaction
  /** Host 注入 appExit 后的重启调度器；测试可替换。 */
  scheduleRestart?: typeof scheduleRestart
  /** DSH 运行版本解析（ping.dshVersion 数据源）；测试可替换。 */
  resolveDshVersion?: typeof resolveDshVersion
  /** Task 14：开关委派的官方服务探测（ctx.get('pluginManager')）；测试可替换。 */
  getService?: () => PluginManagerLike | undefined
  /** Task 14：开关执行器；测试可替换。 */
  togglePlugin?: typeof togglePlugin
}

export interface HostApiContext {
  controller: RegistryController
  pkg: { name: string; version: string }
  deps?: HostApiOverrides
}

interface ParsedRequest {
  method: string
  body: Record<string, unknown>
}

const BODY_MAX_BYTES = 1 << 20
/** 社区开放分类安全 slug（计划 Task 6；与适配层 COMMUNITY_CATEGORY_RE 同语义） */
const COMMUNITY_SLUG_RE = /^[a-z0-9-]{1,32}$/

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

function snapshotPayload(snap: RegistryControllerSnapshot, config?: { communityCatalog?: boolean; communityCatalogPin?: string }): Record<string, unknown> {
  return {
    registryUrl: snap.configuredAddress,
    configuredAddress: snap.configuredAddress,
    activeConfigAddress: snap.activeConfigAddress,
    pendingAddress: snap.pendingAddress,
    configStatus: snap.configStatus,
    configErrors: snap.configErrors,
    warnings: snap.warnings,
    registryState: snap.loaded,
    // 社区两键（M1 Task 6）：设置页回显数据源
    communityCatalog: config?.communityCatalog,
    communityCatalogPin: config?.communityCatalogPin,
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
  if (err instanceof ToggleError) {
    const status = err.code === 'protected' ? 403 : err.code === 'not-installed' ? 404 : 409
    return { status, payload: { ok: false, error: err.message, code: err.code } }
  }
  if (err instanceof InstallGuardError) {
    // 装后守卫拦截（M2 Task 3）：结构化投影含 needsRestart/restartSafe/kind——GUI 一键重启只读 restartSafe
    return {
      status: 409,
      payload: {
        ok: false,
        error: err.message,
        kind: err.kind,
        violations: err.violations,
        compensation: err.compensation,
        needsRestart: err.needsRestart,
        restartSafe: err.restartSafe,
        ...(err.repairBasis ? { repairBasis: err.repairBasis } : {}),
      },
    }
  }
  if (err instanceof IncompatibleError) {
    // 结构化 issue：GUI 据此弹「仍要安装」确认（forceIncompatible 重试）
    return { status: 409, payload: { ok: false, error: err.message, issue: err.issue } }
  }
  if (err instanceof TransactionError) {
    // detail 白名单投影：结构化事实，不含 raw output（GUI 只读 error，零改动）
    const r = err.result
    return {
      status: 500,
      payload: {
        ok: false,
        error: err.message,
        detail: {
          status: r.status,
          kind: r.kind,
          failure: r.failure,
          healActions: r.healActions,
          snapshotRestoreVerified: r.snapshotRestoreVerified,
          profileConverged: r.profileConverged,
        },
      },
    }
  }
  return { status: 500, payload: { ok: false, error: err instanceof Error ? err.message : String(err) } }
}

export function createApiDispatcher(ctx: HostApiContext): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const d = {
    listMarket: ctx.deps?.listMarket ?? listMarket,
    listInstalledWithMeta: ctx.deps?.listInstalledWithMeta ?? listInstalledWithMeta,
    installFromRegistry: ctx.deps?.installFromRegistry ?? installFromRegistry,
    uninstallPlugin: ctx.deps?.uninstallPlugin ?? uninstallPlugin,
    upgradePlugin: ctx.deps?.upgradePlugin ?? upgradePlugin,
    selfUpgrade: ctx.deps?.selfUpgrade ?? selfUpgrade,
    checkRegistryEntries: ctx.deps?.checkRegistryEntries ?? checkRegistryEntries,
    npmLatest: ctx.deps?.npmLatest ?? npmLatest,
    getCommunitySummary: ctx.deps?.getCommunitySummary ?? getCommunitySummary,
    runTransaction: ctx.deps?.runTransaction ?? runProfileTransaction,
    scheduleRestart: ctx.deps?.scheduleRestart ?? scheduleRestart,
    resolveDshVersion: ctx.deps?.resolveDshVersion ?? resolveDshVersion,
    getService: ctx.deps?.getService,
    toggle: ctx.deps?.togglePlugin ?? togglePlugin,
  }
  const cfg = (): typeof ctx.controller.config => ctx.controller.config
  // DSH 版本一次性解析，dispatcher 创建即预热（首个 ping 不吃 spawn 回退的延迟）
  const dshVersionP: Promise<string | null> = Promise.resolve()
    .then(() => d.resolveDshVersion())
    .catch(() => null)

  return async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const abort = new AbortController()
    res.once('close', () => abort.abort())
    try {
      const { method, body } = await parseRequest(req)
      const signal = abort.signal
      let payload: Record<string, unknown>
      switch (method) {
        case 'ping':
          payload = {
            plugin: ctx.pkg.name,
            version: ctx.pkg.version,
            node: process.version,
            boot: BOOT_ID,
            // DSH 运行版本（头部 chip 数据源）；解析失败 → undefined → JSON 序列化时字段缺席
            dshVersion: (await dshVersionP) ?? undefined,
          }
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
          // M2 Task 3：self-upgrade 收编 market.selfUpgrade（统一 mutation session + 守卫，直调事务旁路封死）
          const result = await d.selfUpgrade(ctx.pkg.name, ctx.pkg.version, cfg(), { signal })
          payload = {
            pkg: result.pkg,
            version: result.version,
            buildApprovals: result.buildApprovals ?? [],
            fallbackAllBuilds: result.fallbackAllBuilds === true,
            needsRestart: true as const,
          }
          break
        }

        case 'registry': {
          await ctx.controller.ensureReady()
          const snap = await ctx.controller.snapshot({ force: boolArg(body.force), signal })
          // 社区 summary：primaryEntries 直接取本次 snapshot（displaced 与本次响应同代，不重拉主清单）；
          // 3s 是本 waiter 的等待上限——到点返回 unavailable summary，主清单响应按契约照常返回
          const community = await d.getCommunitySummary(snap.loaded.registry.plugins, cfg(), {
            force: boolArg(body.force),
            signal,
            deadlineAt: Date.now() + 3_000,
          })
          payload = { plugins: snap.loaded.registry.plugins, registryState: snap.loaded, community }
          break
        }

        case 'market': {
          await ctx.controller.ensureReady()
          // GUI policy：忽略客户端 withLatest，固定 true；limit clamp 1..50
          const limitRaw = Number(body.limit)
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 50
          const offsetRaw = Number(body.offset)
          const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0
          // category：精选 5 + 社区开放 slug（非法 slug → 400，不静默吞）
          const categoryRaw = typeof body.category === 'string' ? body.category.trim() : ''
          let category: string | null = null
          if (categoryRaw !== '') {
            if ((CATEGORIES as readonly string[]).includes(categoryRaw) || COMMUNITY_SLUG_RE.test(categoryRaw)) {
              category = categoryRaw
            } else {
              throw new ApiProtocolError(400, `非法分类: ${categoryRaw}（需精选分类或 [a-z0-9-]{1,32} slug）`)
            }
          }
          const result = await d.listMarket(cfg(), {
            query: strArg(body, 'query'),
            category,
            offset,
            limit,
            primaryOnly: boolArg(body.primaryOnly),
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
          const result = await d.installFromRegistry(id, cfg(), {
            version,
            forceIncompatible: boolArg(body.forceIncompatible),
            namespace: 'host',
            signal,
          })
          payload = { ...result }
          break
        }

        case 'uninstall': {
          const target = strArg(body, 'pkg')
          if (!target) throw new ApiProtocolError(400, '缺少 pkg')
          const result = await d.uninstallPlugin(target, cfg(), { namespace: 'host', signal })
          payload = { ...result }
          break
        }

        case 'set-enabled': {
          const target = strArg(body, 'pkg')
          if (!target) throw new ApiProtocolError(400, '缺少 pkg')
          if (typeof body.enabled !== 'boolean') throw new ApiProtocolError(400, '缺少 enabled（必须为 boolean）')
          const result = await d.toggle(target, body.enabled, { getService: d.getService })
          payload = { ...result }
          break
        }

        case 'upgrade': {
          const target = strArg(body, 'pkg')
          if (!target) throw new ApiProtocolError(400, '缺少 pkg')
          const result = await d.upgradePlugin(target, cfg(), {
            forceIncompatible: boolArg(body.forceIncompatible),
            namespace: 'host',
            signal,
          })
          payload = { ...result }
          break
        }

        case 'restart': {
          const result = d.scheduleRestart(servingPort(req))
          payload = { ...result }
          break
        }

        case 'registry-config': {
          const snap = await ctx.controller.snapshot()
          payload = { applied: false, ...snapshotPayload(snap, cfg()) }
          break
        }

        case 'registry-config-apply': {
          if (typeof body.registryUrl !== 'string') throw new ApiProtocolError(400, '缺少 registryUrl')
          const snap = await ctx.controller.apply(body.registryUrl, { signal })
          payload = { applied: true, ...snapshotPayload(snap, cfg()) }
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
