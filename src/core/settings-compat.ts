/**
 * DSH settings 服务双代兼容层（2026-09-27，适配 0.1.7-rc.1 / 0.1.7-rc.2）。
 *
 * 背景（know-how 013 §3）：DSH 0.1.7 把 settings 服务重塑为 @deepseek-ai/dsh-settings
 * 的 SettingsForms——旧的 `settings.register(ns, schema, …)`（返回 get/update/watch scope）
 * 消失，改为「Config schema 标 `.volatile()` 的字段 + loader 原地提交 + 自动生成设置页」。
 * rc.1 与 rc.2 的 dsh-settings 包逐字节相同、loader 同为 ~1.0.5，故一套新通路通吃两个 rc。
 *
 * 三代 runtime 的判定与通路：
 * - ≤0.1.5（schemastery ≤3.18.2，无 `.volatile`）：旧 `register()` scope 通路，行为不变；
 * - 0.1.7-rc.1 / rc.2：`.volatile()` 字段生效，读走 loader 解析出的 Volatile 引用（原地提交），
 *   写走 `settings.update(ns, patch)`（config-editor 落 profile patch，重启后仍在），
 *   变更通知走 loader 的 `loader/volatile-update` 事件；
 * - 形态不识别：降级为「cordis 配置文件通路」，插件本体不受影响。
 *
 * Volatile 引用协议（@deepseek-ai/cosmokit）：`{ get(): snapshot, [Symbol.for('cosmokit.volatile.write')]: fn }`。
 * 用 Symbol.for 判定，跨 ESM/CJS 副本成立，dsh-m 无需依赖 cosmokit。
 */
import type { RegistrySettingsStore } from './registry-controller.js'
import type { RegistryConfig } from './registry.js'

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** cosmokit Volatile 引用判定（鸭子类型，跨副本安全）。 */
export function isVolatileRef(value: unknown): value is { get(): unknown } {
  return typeof value === 'object' && value !== null && VOLATILE_WRITE in value
}

/** 解析引用为快照；普通值原样返回。深度有界（防循环与异常结构），超界截断为 undefined。 */
export function unwrapValue<T>(value: T, depth = 4): T {
  const walk = (v: unknown, d: number): unknown => {
    if (isVolatileRef(v)) {
      if (d <= 0) return undefined
      return walk(v.get(), d - 1)
    }
    if (Array.isArray(v)) {
      if (d <= 0) return undefined
      return v.map((item) => walk(item, d - 1))
    }
    if (typeof v === 'object' && v !== null) {
      if (d <= 0) return undefined
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(v)) out[key] = walk(item, d - 1)
      return out
    }
    return v
  }
  return walk(value, depth) as T
}

/** 从任意形态（plain / 带 Volatile 引用 / 未知脏值）提取已知 registry 字段，类型不符丢弃。 */
export function unwrapConfig(source: unknown): RegistryConfig {
  const raw = unwrapValue(source) as { registryUrl?: unknown; timeoutMs?: unknown; cacheTtlMin?: unknown } | null | undefined
  const out: RegistryConfig = {}
  if (raw && typeof raw === 'object') {
    if (typeof raw.registryUrl === 'string') out.registryUrl = raw.registryUrl
    if (typeof raw.timeoutMs === 'number') out.timeoutMs = raw.timeoutMs
    if (typeof raw.cacheTtlMin === 'number') out.cacheTtlMin = raw.cacheTtlMin
  }
  return out
}

/** 旧 settings 服务（≤0.1.5）：register() 返回 get/update/watch scope。 */
export interface LegacySettingsScope {
  get(): unknown
  update(patch: object): Promise<void>
  watch(callback: (next: unknown, prev: unknown) => void): () => void
}

export interface LegacySettingsService {
  register(
    namespace: string,
    schema: unknown,
    options?: { base?: unknown; applies?: 'live' | 'restart' },
  ): LegacySettingsScope
}

/** 新 settings 服务（0.1.7-rc.1 / rc.2，SettingsForms）。 */
export interface FormsSettingsService {
  describe(options?: { redactSecrets?: boolean }): Array<{ ns: string; value?: unknown; revision?: number }>
  update(namespace: string, patch: object, expectedRevision?: number): Promise<void>
}

export type SettingsKind = 'legacy' | 'forms' | 'unknown'

/** 运行时形态探测：register 在前（老服务不会带 describe/update），forms 次之。 */
export function detectSettingsKind(settings: unknown): SettingsKind {
  const s = settings as Partial<LegacySettingsService & FormsSettingsService> | null | undefined
  if (s && typeof s === 'object') {
    if (typeof s.register === 'function') return 'legacy'
    if (typeof s.describe === 'function' && typeof s.update === 'function') return 'forms'
  }
  return 'unknown'
}

/** 在 loader entries 里找本插件实例的 profile entry id（新 API 写入的 ns）。范式同 dsh-better-sidebar。 */
export function ownEntryId(ctx: unknown, packageName: string): string | undefined {
  const loader = (ctx as { loader?: { entries?: () => Iterable<LoaderEntryView> } } | null | undefined)?.loader
  if (!loader || typeof loader.entries !== 'function') return undefined
  const ownFiber = (ctx as { fiber?: unknown } | null | undefined)?.fiber
  let fallback: string | undefined
  try {
    for (const entry of loader.entries()) {
      const id = entry?.options?.id
      if (entry?.options?.name !== packageName || typeof id !== 'string' || id === '') continue
      if (ownFiber !== undefined && entry.fiber === ownFiber) return id
      if (entry.options.disabled !== true && fallback === undefined) fallback = id
    }
  } catch {
    return undefined
  }
  return fallback
}

interface LoaderEntryView {
  options?: { id?: unknown; name?: unknown; disabled?: unknown }
  fiber?: unknown
}

/** 旧 API store：scope 值出站前统一解包（防御老 runtime 解析出引用的混合形态）。 */
export function createLegacyRegistryStore(scope: LegacySettingsScope): RegistrySettingsStore {
  return {
    get: () => unwrapConfig(scope.get()),
    update: async (patch) => {
      await scope.update({ ...patch })
    },
    watch: (callback) =>
      scope.watch((next, prev) => {
        callback(unwrapConfig(next), unwrapConfig(prev))
      }),
  }
}

type VolatileUpdateContext = { on(event: string, callback: (paths: string[][]) => void): unknown }

function subscribeVolatileUpdate(ctx: unknown, callback: () => void): () => void {
  const on = (ctx as Partial<VolatileUpdateContext> | null | undefined)?.on
  if (typeof on !== 'function') return () => {}
  const disposed: unknown = on.call(ctx, 'loader/volatile-update', () => callback())
  return typeof disposed === 'function' ? (disposed as () => void) : () => {}
}

/**
 * 新 API store（0.1.7-rc.1 / rc.2）：
 * - 读：直接解包 loader 解析出的 Config（Volatile 引用 `.get()` 即最新已提交值）；
 * - 写：`settings.update(ns, patch)`，经 config-editor 落 profile patch（重启持久），省略
 *   expectedRevision = 与旧 API 相同的末写胜语义（controller 串行队列 + lastSelfWrite 去重）；
 * - 变更通知：`loader/volatile-update`（loader 只发给本 fiber，路径含变更字段）。
 */
export function createFormsRegistryStore(ctx: unknown, settings: FormsSettingsService, ns: string, parsedConfig: unknown): RegistrySettingsStore {
  const read = (): RegistryConfig => unwrapConfig(parsedConfig)
  let prev = read()
  return {
    get: read,
    update: async (patch) => {
      await settings.update(ns, { ...patch })
    },
    watch: (callback) =>
      subscribeVolatileUpdate(ctx, () => {
        const next = read()
        callback(next, prev)
        prev = next
      }),
  }
}

/**
 * 找不到本插件 loader 条目（ns 缺失）时的只读降级 store：
 * 读与变更通知仍可用（Config 引用由 loader 解析），只有写不可持久化。
 */
export function createFormsRegistryStoreWithoutNs(ctx: unknown, parsedConfig: unknown, note: string): RegistrySettingsStore {
  const read = (): RegistryConfig => unwrapConfig(parsedConfig)
  let prev = read()
  return {
    get: read,
    update: async () => {
      throw new Error(`settings 命名空间不可用，registry 地址无法持久化（${note}）`)
    },
    watch: (callback) =>
      subscribeVolatileUpdate(ctx, () => {
        const next = read()
        callback(next, prev)
        prev = next
      }),
  }
}

export interface WireRegistrySettingsInput {
  ctx: unknown
  settings: unknown
  /** 旧 API register() 需要的 schema（新 API 不用——字段级 `.volatile()` 已在 schema 上生效） */
  schema: unknown
  /** loader 解析并传给 apply() 的 config（0.1.7 上 volatile 字段是 Volatile 引用） */
  parsedConfig: unknown
  packageName: string
  logger?: { warn?(...args: unknown[]): void }
  attachStore: (store: RegistrySettingsStore) => void
}

export type WireOutcome = 'legacy' | 'forms' | 'forms-without-ns' | 'unknown'

/**
 * 按运行时形态把 RegistrySettingsStore 接到 controller 上。
 * 不抛：任何形态失败都以返回值 + warn 收场，绝不拖垮插件其余部分（webServer / tools）。
 */
export function wireRegistrySettings(input: WireRegistrySettingsInput): WireOutcome {
  const kind = detectSettingsKind(input.settings)
  if (kind === 'legacy') {
    const scope = (input.settings as LegacySettingsService).register('dshm', input.schema, {
      base: input.parsedConfig,
      applies: 'live',
    })
    input.attachStore(createLegacyRegistryStore(scope))
    return 'legacy'
  }
  if (kind === 'forms') {
    const ns = ownEntryId(input.ctx, input.packageName)
    if (ns === undefined) {
      const note = 'loader 中未找到本插件条目'
      input.logger?.warn?.(`dsh-m: ${note}，设置卡不可持久化，registry 地址仅剩 cordis 配置文件通路`)
      input.attachStore(createFormsRegistryStoreWithoutNs(input.ctx, input.parsedConfig, note))
      return 'forms-without-ns'
    }
    input.attachStore(createFormsRegistryStore(input.ctx, input.settings as FormsSettingsService, ns, input.parsedConfig))
    return 'forms'
  }
  input.logger?.warn?.('dsh-m: settings 服务形态未识别（无 register 也无 describe/update），registry 地址走 cordis 配置文件')
  return 'unknown'
}
