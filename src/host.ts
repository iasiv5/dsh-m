import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createApiDispatcher, type RequestTrustCheck } from './core/host-api.js'
import { bindLoaderHost, type LoaderHost } from './core/live-plugin.js'
import { createRegistryController, type RegistrySettingsStore } from './core/registry-controller.js'
import { wireRegistrySettings, unwrapConfig } from './core/settings-compat.js'
import { resolveActiveProfile } from './core/active-profile.js'
import { registerTools } from './tools.js'
import { appExitFromContext, scheduleRestart } from './core/restart.js'
import type { PluginManagerLike } from './core/toggle.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { name: string; version: string }

export const name = 'dshm'

// dshm_* 七个工具（src/tools.ts）
export const inject: string[] = ['tools']

export interface Config {
  registryUrl?: string
  timeoutMs?: number
  cacheTtlMin?: number
  communityCatalog?: boolean
  communityCatalogPin?: string
}

/**
 * 0.1.7+ 的 DSH schemastery 才有 `.volatile()`（标记字段进自动生成设置页 + loader 原地提交）；
 * 旧版（≤0.1.5，schemastery 3.18.2）缺方法时保持普通字段——旧 settings API 的 scope 自带 live 语义。
 * `volatile()` 幂等性：重复包裹会 throw，这里每字段只调一次。
 */
function live<T>(field: Schema<T>): Schema<T> {
  const volatile = (field as unknown as { volatile?: () => Schema<T> }).volatile
  return typeof volatile === 'function' ? volatile.call(field) : field
}

export const Config: Schema<Config> = Schema.object({
  registryUrl: live(Schema.string().description('registry 地址：空值使用默认官方清单；支持 HTTPS URL、loopback HTTP URL 或本机绝对路径/file://（整体覆盖默认清单，live 生效）')),
  timeoutMs: live(Schema.number().default(20000).description('上游请求超时（毫秒）')),
  cacheTtlMin: live(Schema.number().default(60).description('registry 缓存时长（分钟）')),
  communityCatalog: live(Schema.boolean().default(true).description('社区清单：awesome-dsh-plugin 全量社区目录叠加进市场（只读，live 生效）')),
  communityCatalogPin: live(Schema.string().description('社区目录版本锁定：精确 semver（如 2026.928.1），空值跟随 latest')),
})

export function apply(ctx: Context, config: Config): void {
  // 卸载前的 live-disable 依赖 loader（skillhub 同款）
  bindLoaderHost(ctx as unknown as LoaderHost)

  // 0.9.0 双 profile（ADR-0005）：宿主当前 profile 单一事实源——apply 期解析一次，
  // host 生命周期内不可变；GUI/工具/HTTP/缓存分段全部消费同一对象。
  const profile = resolveActiveProfile(ctx)
  ctx.logger?.info?.('dsh-m: active profile %s (dir=%s, source=%s)', profile.name, profile.dir, profile.source)

  // registry controller：active config / configured / pending / rejected 分离 + generation fence；
  // tools 与 Host API 共用同一 active config object（apply 原地更新字段，live 生效）。
  // unwrapConfig：0.1.7 上 volatile 字段是 cosmokit Volatile 引用，先解包成 plain 值再进 controller。
  const controller = createRegistryController(unwrapConfig(config), { profile: profile.name })
  // DSH 0.1.2-rc.1 / 0.1.5-rc.1 / 0.1.7-rc.1 / 0.1.7-rc.2 都经 dsh-cmdline 暴露 appExit；
  // using it avoids guessing the service unit from release-specific cgroups.
  const appExit = appExitFromContext(ctx)
  const restart = (port: number | null = null) => scheduleRestart(port, { appExit })

  // 开关委派的官方服务探测（ADR-0001）：运行时按服务存在性探测，不判 DSH 版本号。
  // 0.9.8 与 dsh-market 同源修正（Windows 实机 2026-10-01）：pluginManager 是惰性服务，
  // 外层 apply ctx 的一次性 get 在本机探不到；改为双上下文探测（webServer 注入回调的
  // hostCtx 优先——dshmarket 即此路径，两轮覆盖安装实证）+ inject 惰性拉起兜底。
  let serviceCtx: unknown = undefined
  const getService = (): PluginManagerLike | undefined => {
    for (const c of [serviceCtx, ctx]) {
      const svc = (c as unknown as { get?: (name: string) => unknown } | null)?.get?.('pluginManager') as
        | PluginManagerLike
        | undefined
      if (svc !== undefined && svc !== null) return svc
    }
    return undefined
  }
  // 惰性拉起：get 缺席时经 cordis inject 等官方服务实例化（短超时，仍缺席由调用方 fail-closed）
  const ensureService = (timeoutMs = 5_000): Promise<PluginManagerLike | undefined> =>
    new Promise((resolve) => {
      const immediate = getService()
      if (immediate !== undefined) {
        resolve(immediate)
        return
      }
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(getService())
      }
      const timer = setTimeout(finish, timeoutMs)
      try {
        ;(ctx as unknown as { inject?: (deps: string[], cb: (c: unknown) => void) => unknown }).inject?.(['pluginManager'], () => finish())
      } catch {
        finish()
      }
    })
  registerTools(ctx, controller.config, { restart, getService, ensureService }, profile)

  // 设置页接线（双代兼容，详见 core/settings-compat.ts）：
  // - ≤0.1.5：settings.register('dshm', …) scope（get/update/watch）；
  // - 0.1.7-rc.1 / rc.2：Config `.volatile()` 字段自动生成设置页（autoGenerate 默认开，无需 configure），
  //   读 = loader 解析的 Config 引用，写 = settings.update(ns, patch)，通知 = loader/volatile-update；
  // - 其他形态：降级 cordis 配置文件通路。任何失败只 warn，不拖垮 webServer / tools。
  ctx.inject(['settings'], (c) => {
    const settings = (
      c as unknown as { settings?: unknown }
    ).settings
    try {
      const outcome = wireRegistrySettings({
        ctx,
        settings,
        schema: Config,
        parsedConfig: config,
        packageName: pkg.name,
        logger: ctx.logger,
        attachStore: (store: RegistrySettingsStore) => controller.attachStore(store),
      })
      if (outcome === 'legacy' || outcome === 'forms') {
        ctx.logger?.debug?.('dsh-m: settings store attached (%s)', outcome)
      }
    } catch (err) {
      ctx.logger?.warn?.('dsh-m: settings 集成失败，registry 地址走 cordis 配置文件')
      ctx.logger?.warn?.(err)
    }
  })

  // 本地 API：单路由 + method 分发（信任检查与状态映射在 core/host-api.ts）。
  // 0.9.0（ADR-0005）：入口信任检查全量委派官方 connection.requestRejection——
  // Desktop 桥剥 Origin 的请求按官方语义（trustedHosts/loopback/cross-site/Origin:null）判定，
  // 服务缺席或抛错一律 fail-closed 403（warn 一次）。
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
    serviceCtx = c // 0.9.8：webServer 注入回调的 hostCtx 是 pluginManager 的可见上下文（dsh-market 同款）
    const rejectRequest = createRequestRejection(ctx)
    const handleApi = createApiDispatcher({
      controller,
      pkg,
      profile,
      deps: {
        scheduleRestart: restart,
        getService,
        ensureService,
        rejectRequest,
      },
    })
    server.register({
      kind: 'exact',
      path: '/dshm',
      handler: (req, res) => {
        void handleApi(req, res)
      },
    })
  })
}

/** 守卫式官方 requestRejection 委派：缺席/抛错 fail-closed 403（warn 一次，不刷日志）。 */
function createRequestRejection(ctx: Context): RequestTrustCheck {
  let warned = false
  const warnOnce = (err: unknown) => {
    if (warned) return
    warned = true
    ctx.logger?.warn?.('dsh-m: 官方 connection.requestRejection 不可用，/dshm 全入口 fail-closed 403（ADR-0005）')
    if (err) ctx.logger?.warn?.(err)
  }
  return (req) => {
    try {
      const connection = (ctx as unknown as { get?: (name: string) => unknown }).get?.('connection') as
        | { requestRejection?: (r: { headers: IncomingMessage['headers'] }) => 401 | 403 | undefined }
        | undefined
      const reject = connection?.requestRejection
      if (typeof reject !== 'function') {
        warnOnce(undefined)
        return 403
      }
      return reject.call(connection, { headers: req.headers }) ?? undefined
    } catch (err) {
      warnOnce(err)
      return 403
    }
  }
}
