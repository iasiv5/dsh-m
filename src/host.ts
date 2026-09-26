import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createApiDispatcher } from './core/host-api.js'
import { bindLoaderHost, type LoaderHost } from './core/live-plugin.js'
import { createRegistryController, type RegistrySettingsStore } from './core/registry-controller.js'
import { wireRegistrySettings, unwrapConfig } from './core/settings-compat.js'
import { registerTools } from './tools.js'
import { appExitFromContext, scheduleRestart } from './core/restart.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { name: string; version: string }

export const name = 'dshm'

// dshm_* 七个工具（src/tools.ts）
export const inject: string[] = ['tools']

export interface Config {
  registryUrl?: string
  timeoutMs?: number
  cacheTtlMin?: number
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
})

export function apply(ctx: Context, config: Config): void {
  // 卸载前的 live-disable 依赖 loader（skillhub 同款）
  bindLoaderHost(ctx as unknown as LoaderHost)

  // registry controller：active config / configured / pending / rejected 分离 + generation fence；
  // tools 与 Host API 共用同一 active config object（apply 原地更新字段，live 生效）。
  // unwrapConfig：0.1.7 上 volatile 字段是 cosmokit Volatile 引用，先解包成 plain 值再进 controller。
  const controller = createRegistryController(unwrapConfig(config))
  // DSH 0.1.2-rc.1 / 0.1.5-rc.1 / 0.1.7-rc.1 / 0.1.7-rc.2 都经 dsh-cmdline 暴露 appExit；
  // using it avoids guessing the service unit from release-specific cgroups.
  const appExit = appExitFromContext(ctx)
  const restart = (port: number | null = null) => scheduleRestart(port, { appExit })
  registerTools(ctx, controller.config, { restart })

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

  // 本地 API：单路由 + method 分发（防护与状态映射在 core/host-api.ts）
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
    const handleApi = createApiDispatcher({ controller, pkg, deps: { scheduleRestart: restart } })
    server.register({
      kind: 'exact',
      path: '/dshm',
      handler: (req, res) => {
        void handleApi(req, res)
      },
    })
  })
}
