import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { withMutationLock } from './core/market.js'
import { createApiDispatcher } from './core/host-api.js'
import { bindLoaderHost, type LoaderHost } from './core/live-plugin.js'
import { createRegistryController, type RegistrySettingsStore } from './core/registry-controller.js'
import { registerTools } from './tools.js'

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

export const Config: Schema<Config> = Schema.object({
  registryUrl: Schema.string().description('registry 地址：空值使用默认官方清单；支持 HTTPS URL、loopback HTTP URL 或本机绝对路径/file://（整体覆盖默认清单，live 生效）'),
  timeoutMs: Schema.number().default(20000).description('上游请求超时（毫秒）'),
  cacheTtlMin: Schema.number().default(60).description('registry 缓存时长（分钟）'),
})

export function apply(ctx: Context, config: Config): void {
  // 卸载前的 live-disable 依赖 loader（skillhub 同款）
  bindLoaderHost(ctx as unknown as LoaderHost)

  // registry controller：active config / configured / pending / rejected 分离 + generation fence；
  // tools 与 Host API 共用同一 active config object（apply 原地更新字段，live 生效）
  const controller = createRegistryController(config)
  registerTools(ctx, controller.config)

  // 设置页（GUI 设置卡片的宿主命名空间）：applies 'live'，scope 提供 get/update/watch
  ctx.inject(['settings'], (c) => {
    const settings = (
      c as unknown as {
        settings: {
          register: (
            ns: string,
            schema: Schema<Config>,
            options?: { base?: Config; applies?: 'live' | 'restart' },
          ) => {
            get(): Config
            update(patch: object): Promise<void>
            watch(callback: (next: Config, prev: Config) => void): () => void
          }
        }
      }
    ).settings
    const scope = settings.register('dshm', Config, { base: config, applies: 'live' })
    const store: RegistrySettingsStore = {
      get: () => scope.get(),
      update: (patch) => scope.update(patch),
      watch: (callback) => scope.watch(callback),
    }
    controller.attachStore(store)
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
    const handleApi = createApiDispatcher({ controller, pkg, onMutation: withMutationLock })
    server.register({
      kind: 'exact',
      path: '/dshm',
      handler: (req, res) => {
        void handleApi(req, res)
      },
    })
  })
}
