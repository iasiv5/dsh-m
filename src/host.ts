import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  installFromRegistry,
  listInstalledWithMeta,
  listMarket,
  uninstallPlugin,
  upgradePlugin,
  withMutationLock,
} from './core/market.js'
import { bindLoaderHost, type LoaderHost } from './core/live-plugin.js'
import { scheduleRestart, servingPort, trustedRestartRequest } from './core/restart.js'
import type { RegistryConfig } from './core/registry.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { name: string; version: string }

export const name = 'dshm'

// M3 将改为 ['tools'] 并注册 dshm_* 工具
export const inject: string[] = []

export interface Config extends RegistryConfig {}

export const Config: Schema<Config> = Schema.object({
  registryUrl: Schema.string().description('registry 源覆盖（默认 jsDelivr @main）'),
  timeoutMs: Schema.number().default(20000).description('上游请求超时（毫秒）'),
  cacheTtlMin: Schema.number().default(60).description('registry 缓存时长（分钟）'),
})

export function apply(ctx: Context, config: Config): void {
  const cfg: Config = { ...config }
  // 卸载前的 live-disable 依赖 loader（skillhub 同款）
  bindLoaderHost(ctx as unknown as LoaderHost)

  // 本地 API：单路由 + method 分发（skillhub 同款）
  ctx.inject(['webServer'], (c) => {
    const server = (
      c as unknown as {
        webServer: {
          register: (route: {
            kind: string
            path: string
            handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
          }) => void
        }
      }
    ).webServer
    server.register({
      kind: 'exact',
      path: '/dshm',
      handler: (req, res) => {
        void handleApi(req, res, cfg)
      },
    })
  })

  // 设置页（GUI 设置卡片的宿主命名空间）
  ctx.inject(['settings'], (c) => {
    const settings = (
      c as unknown as {
        settings: {
          register: (ns: string, schema: Schema<Config>, options?: { base?: Config }) => void
        }
      }
    ).settings
    settings.register('dshm', Config, { base: config })
  })
}

async function handleApi(req: IncomingMessage, res: ServerResponse, cfg: Config): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const body = req.method === 'POST' ? await readBody(req) : {}
    const method = String(body.method || url.searchParams.get('method') || 'ping')
    switch (method) {
      case 'ping':
        return sendJson(res, 200, { ok: true, plugin: pkg.name, version: pkg.version, node: process.version })

      case 'registry': {
        const loaded = await loadRegistrySafe(cfg, boolArg(body.force))
        return sendJson(res, 200, {
          ok: true,
          plugins: loaded.registry.plugins,
          source: loaded.source,
          fetchedAt: loaded.fetchedAt,
          errors: loaded.errors,
        })
      }

      case 'market': {
        const result = await listMarket(cfg, { force: boolArg(body.force) })
        return sendJson(res, 200, { ok: true, ...result })
      }

      case 'installed': {
        const result = await listInstalledWithMeta(cfg)
        return sendJson(res, 200, { ok: true, ...result })
      }

      case 'install': {
        const id = String(body.id || '').trim()
        if (!id) return sendJson(res, 400, { ok: false, error: '缺少 id' })
        const version = typeof body.version === 'string' ? body.version : undefined
        const result = await withMutationLock(() => installFromRegistry(id, cfg, { version }))
        return sendJson(res, 200, { ok: true, ...result })
      }

      case 'uninstall': {
        const target = String(body.pkg || '').trim()
        if (!target) return sendJson(res, 400, { ok: false, error: '缺少 pkg' })
        const result = await withMutationLock(() => uninstallPlugin(target, cfg))
        return sendJson(res, 200, { ok: true, ...result })
      }

      case 'upgrade': {
        const target = String(body.pkg || '').trim()
        if (!target) return sendJson(res, 400, { ok: false, error: '缺少 pkg' })
        const result = await withMutationLock(() => upgradePlugin(target, cfg))
        return sendJson(res, 200, { ok: true, ...result })
      }

      case 'restart': {
        if (!trustedRestartRequest(req)) {
          return sendJson(res, 403, { ok: false, error: '拒绝跨源重启请求' })
        }
        const result = scheduleRestart(servingPort(req))
        return sendJson(res, 200, { ok: true, ...result })
      }

      default:
        return sendJson(res, 404, { ok: false, error: `未知 method: ${method}` })
    }
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

async function loadRegistrySafe(cfg: Config, force?: boolean) {
  const { loadRegistry } = await import('./core/registry.js')
  return loadRegistry(cfg, { force })
}

function boolArg(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1'
}

function readBody(req: IncomingMessage, maxBytes = 1 << 20): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > maxBytes) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve({})
      }
    })
    req.on('error', reject)
  })
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
