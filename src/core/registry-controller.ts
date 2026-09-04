/**
 * Registry settings controller（DESIGN.md §4）：active config / configured address /
 * pending / config phase 与真实 active registry 的分离。
 * - 外部 settings 写入进入同一串行 queue，异步加载用 generation fence 防旧结果覆盖新结果；
 * - `rejected` 只属于 config phase，不污染 loaded 的真实 source/status；
 * - apply：candidate 校验成功 → store.update → 原子切换 active → commitActiveSource；
 * - 最近一次 accepted address 通过 host cache metadata 跨重启保存，无效持久化值自动回滚。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cacheDir } from './env.js'
import {
  commitActiveSource,
  loadDefaultRegistry,
  loadRegistry,
  loadRegistryCandidate,
  parseRegistryAddress,
  type LoadedRegistry,
  type RegistryAddress,
  type RegistryConfig,
  type RegistryConfigPhase,
} from './registry.js'

export class RegistryConfigError extends Error {
  readonly errors: string[]
  constructor(message: string, errors: string[] = []) {
    super(message)
    this.name = 'RegistryConfigError'
    this.errors = errors
  }
}

export interface RegistrySettingsStore {
  get(): RegistryConfig
  update(patch: { registryUrl: string }): Promise<void>
  watch(callback: (next: RegistryConfig, prev: RegistryConfig) => void): () => void
}

export interface RegistryControllerSnapshot {
  configuredAddress: string
  activeConfigAddress: string
  pendingAddress: string | null
  configStatus: RegistryConfigPhase
  configErrors: string[]
  warnings: string[]
  /** 始终描述真实 active registry，不污染 source/status */
  loaded: LoadedRegistry
}

export interface RegistryController {
  /** active config object（host.ts 与 tools 共享同一引用；controller 原地更新字段） */
  readonly config: RegistryConfig
  attachStore(store: RegistrySettingsStore): void
  ensureReady(opts?: { signal?: AbortSignal }): Promise<void>
  snapshot(opts?: { force?: boolean; signal?: AbortSignal }): Promise<RegistryControllerSnapshot>
  loadDefault(opts?: { force?: boolean; signal?: AbortSignal }): Promise<LoadedRegistry>
  apply(rawAddress: string, opts?: { signal?: AbortSignal }): Promise<RegistryControllerSnapshot>
  dispose(): void
}

export interface AcceptedSourceMetadata {
  version: 1
  namespace: 'host'
  configuredAddress: string
  cacheKey: string
  savedAt: string
}

const ACCEPTED_SOURCE_FILE = 'active-source.json'

/** 读取 host accepted-source metadata（损坏/缺失返回 null）。 */
export async function readAcceptedSourceMetadata(): Promise<AcceptedSourceMetadata | null> {
  try {
    const raw = JSON.parse(await readFile(join(cacheDir(), 'host', ACCEPTED_SOURCE_FILE), 'utf8')) as AcceptedSourceMetadata | null
    if (!raw || typeof raw !== 'object') return null
    if (raw.version !== 1 || raw.namespace !== 'host') return null
    if (typeof raw.configuredAddress !== 'string' || typeof raw.cacheKey !== 'string') return null
    if (typeof raw.savedAt !== 'string') return null
    return raw
  } catch {
    return null
  }
}

function trimAddress(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

function placeholderLoaded(configuredAddress: string): LoadedRegistry {
  return {
    configuredAddress,
    activeAddress: null,
    source: configuredAddress === '' ? 'default-cache' : 'custom-unavailable',
    status: 'unavailable',
    isDefault: configuredAddress === '',
    stale: false,
    fetchedAt: null,
    errors: [],
    count: 0,
    registry: { version: 1, plugins: [] },
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createRegistryController(initial: RegistryConfig = {}): RegistryController {
  // config 是共享对象：host.ts 把它传给 tools/API，controller 原地更新字段实现 live 生效
  const config: RegistryConfig = { ...initial }
  let activeConfigAddress = trimAddress(initial.registryUrl)
  let loaded: LoadedRegistry = placeholderLoaded(activeConfigAddress)
  let pendingAddress: string | null = null
  let configStatus: RegistryConfigPhase = 'loading'
  let configErrors: string[] = []
  let warnings: string[] = []
  let generation = 0
  let disposed = false
  let store: RegistrySettingsStore | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let bootstrapPromise: Promise<void> | null = null
  let lastSelfWrite: string | null = null
  let unwatch: (() => void) | null = null

  function enqueue<T>(task: (gen: number) => Promise<T>): Promise<T> {
    if (disposed) return Promise.reject(new Error('registry controller 已 disposed'))
    const run = queue.then(() => {
      const gen = ++generation
      return task(gen)
    })
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  function adopt(gen: number, nextRegistryUrl: string, candidate: LoadedRegistry): boolean {
    if (disposed || gen !== generation) return false
    config.registryUrl = nextRegistryUrl
    activeConfigAddress = candidate.configuredAddress
    loaded = candidate
    pendingAddress = null
    configErrors = []
    configStatus = 'ready'
    return true
  }

  function snapshotInternal(): RegistryControllerSnapshot {
    return {
      configuredAddress: trimAddress(config.registryUrl),
      activeConfigAddress,
      pendingAddress,
      configStatus,
      configErrors: [...configErrors],
      warnings: [...warnings],
      loaded,
    }
  }

  async function rollbackPersist(value: string): Promise<boolean> {
    if (!store) return false
    lastSelfWrite = value
    try {
      await store.update({ registryUrl: value })
      return true
    } catch (err) {
      warnings.push(`回滚持久化配置失败：${errorMessage(err)}；将在下次启动再次尝试`)
      lastSelfWrite = null
      return false
    }
  }

  function candidateFor(rawAddress: string, signal?: AbortSignal): Promise<LoadedRegistry> {
    return loadRegistryCandidate({ ...config, registryUrl: rawAddress }, { namespace: 'host', signal })
  }

  const bootstrap = async (): Promise<void> => {
    await enqueue(async (gen) => {
      const source = store ? store.get() : initial
      config.timeoutMs = source.timeoutMs
      config.cacheTtlMin = source.cacheTtlMin
      const raw = trimAddress(source.registryUrl)
      const attempt = await loadRegistry({ ...config, registryUrl: raw }, { namespace: 'host' })
      if (disposed || gen !== generation) return
      if (attempt.status !== 'unavailable') {
        adopt(gen, raw, attempt)
        return
      }
      // 持久化 custom 不可达：先试 accepted address（含其 cache），无 accepted 则默认
      configErrors = [...attempt.errors]
      const accepted = await readAcceptedSourceMetadata()
      const recoverAddress = accepted && accepted.configuredAddress !== raw ? accepted.configuredAddress : ''
      const recovered = await loadRegistry({ ...config, registryUrl: recoverAddress }, { namespace: 'host', force: true })
      if (disposed || gen !== generation) return
      if (recovered.status !== 'unavailable') {
        adopt(gen, recoverAddress, recovered)
        configStatus = 'rejected'
        configErrors = [...attempt.errors]
        pendingAddress = null
        warnings.push(`持久化 registry 地址不可用，已回滚到${recoverAddress === '' ? '默认清单' : recoverAddress}`)
        await rollbackPersist(recoverAddress)
      } else {
        // 连恢复都失败：接受 unavailable 现实，config 标记 rejected
        loaded = recovered
        activeConfigAddress = recovered.configuredAddress
        config.registryUrl = recoverAddress
        configStatus = 'rejected'
      }
    })
  }

  function startBootstrap(): Promise<void> {
    if (!bootstrapPromise) {
      bootstrapPromise = bootstrap().catch((err) => {
        if (!disposed) {
          configStatus = 'unavailable'
          configErrors = [errorMessage(err)]
        }
      })
    }
    return bootstrapPromise
  }

  function handleExternalWatch(next: RegistryConfig): Promise<void> {
    if (disposed) return Promise.resolve()
    const raw = trimAddress(next.registryUrl)
    if (lastSelfWrite !== null && raw === lastSelfWrite) {
      lastSelfWrite = null
      return Promise.resolve()
    }
    if (raw === trimAddress(config.registryUrl) && configStatus === 'ready') return Promise.resolve()
    return enqueue(async (gen) => {
      let candidate: LoadedRegistry
      try {
        candidate = await candidateFor(raw)
      } catch (err) {
        candidate = { ...placeholderLoaded(raw), errors: [errorMessage(err)] }
      }
      if (disposed || gen !== generation) return
      if (candidate.status !== 'unavailable') {
        adopt(gen, raw, candidate)
        const nextConfig: RegistryConfig = { ...config, registryUrl: raw, timeoutMs: next.timeoutMs, cacheTtlMin: next.cacheTtlMin }
        config.timeoutMs = nextConfig.timeoutMs
        config.cacheTtlMin = nextConfig.cacheTtlMin
        try {
          const commit = await commitActiveSource(parseRegistryAddress(raw), 'host')
          if (commit.warning) warnings.push(commit.warning)
        } catch {
          /* commit 失败不改变已采纳的 active */
        }
        return
      }
      // 外部无效值：保持旧 active，回滚持久化值
      configStatus = 'rejected'
      configErrors = [...candidate.errors]
      pendingAddress = raw
      const rolledBack = await rollbackPersist(trimAddress(config.registryUrl))
      if (rolledBack) pendingAddress = null
    }).then(() => undefined, () => undefined)
  }

  function attachStore(s: RegistrySettingsStore): void {
    if (disposed) throw new Error('registry controller 已 disposed')
    store = s
    unwatch?.()
    unwatch = s.watch((next) => {
      void handleExternalWatch(next)
    })
    void startBootstrap()
  }

  function ensureReady(opts?: { signal?: AbortSignal }): Promise<void> {
    void opts
    return startBootstrap()
  }

  async function snapshot(opts: { force?: boolean; signal?: AbortSignal } = {}): Promise<RegistryControllerSnapshot> {
    await startBootstrap()
    if (opts.force) {
      await enqueue(async (gen) => {
        const attempt = await loadRegistry(config, { namespace: 'host', force: true, signal: opts.signal })
        if (disposed || gen !== generation) return
        loaded = attempt
        activeConfigAddress = attempt.configuredAddress
      })
    }
    return snapshotInternal()
  }

  function loadDefault(opts: { force?: boolean; signal?: AbortSignal } = {}): Promise<LoadedRegistry> {
    return loadDefaultRegistry(config, { namespace: 'host', force: opts?.force, signal: opts?.signal })
  }

  function apply(rawAddress: string, opts: { signal?: AbortSignal } = {}): Promise<RegistryControllerSnapshot> {
    return enqueue(async (gen) => {
      const trimmed = String(rawAddress ?? '').trim()
      let address: RegistryAddress
      try {
        address = parseRegistryAddress(trimmed)
      } catch (err) {
        configStatus = 'rejected'
        pendingAddress = trimmed || null
        configErrors = [errorMessage(err)]
        throw new RegistryConfigError(errorMessage(err), [errorMessage(err)])
      }
      let candidate: LoadedRegistry
      try {
        candidate = await candidateFor(trimmed, opts.signal)
      } catch (err) {
        if (disposed || gen !== generation) return snapshotInternal()
        configStatus = 'rejected'
        pendingAddress = trimmed || null
        configErrors = [errorMessage(err)]
        throw new RegistryConfigError(errorMessage(err), [errorMessage(err)])
      }
      if (disposed || gen !== generation) return snapshotInternal()
      if (candidate.status === 'unavailable') {
        configStatus = 'rejected'
        pendingAddress = trimmed || null
        configErrors = [...candidate.errors]
        throw new RegistryConfigError('registry 地址校验失败', candidate.errors)
      }
      if (store) {
        lastSelfWrite = trimmed
        try {
          await store.update({ registryUrl: trimmed })
        } catch (err) {
          lastSelfWrite = null
          configStatus = 'pending'
          pendingAddress = trimmed
          configErrors = [errorMessage(err)]
          throw new RegistryConfigError(`配置校验成功但写入设置失败：${errorMessage(err)}`, [errorMessage(err)])
        }
      }
      adopt(gen, trimmed, candidate)
      try {
        const commit = await commitActiveSource(address, 'host')
        if (commit.warning) warnings.push(commit.warning)
      } catch (err) {
        warnings.push(`accepted-source 提交异常：${errorMessage(err)}`)
      }
      return snapshotInternal()
    })
  }

  function dispose(): void {
    disposed = true
    unwatch?.()
    unwatch = null
    store = null
  }

  const controller: RegistryController = {
    config,
    attachStore,
    ensureReady,
    snapshot,
    loadDefault,
    apply,
    dispose,
  }
  return controller
}
