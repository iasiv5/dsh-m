/**
 * 市场编排层：registry × profile × 最新版本 → 市场列表（服务端分页）/ 已装列表 /
 * 安装 / 升级。安装语义见 DESIGN.md §3（npm 精确锁定、GitHub 锁 SHA）。
 * Task 3：服务端 query/category/offset/limit 过滤；只对当前页查 latest（并发 ≤8、
 * TTL cache、共享全局 deadline）；unavailable 返回结构化空页；host/cli namespace 贯穿。
 * 2026-09-05 回滚缺陷加固：B1 成功路径保留 manifest 顶层未知键（如 pnpm.overrides）、
 * 失败路径字节级回滚后 frozen 自愈阶梯（overrides 对齐 → no-frozen 重建，B2）、
 * 新发布后 NO_MATCHING_VERSION 的退避重试 + packument 预热（B3）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { addDshPlugin, removeDshPlugin } from './dsh-cli.js'
import {
  classifyPnpmError,
  makeDshRunner,
  type PnpmRunner,
  type RunnerOutcome,
} from './dsh-cli.js'
import { dshHome, webProfileDir } from './env.js'
import { readPnpmLockIntegrity } from './npm-integrity.js'
import {
  runProfileTransaction,
  makeNpmWarmPackument,
  TransactionError,
  type HealAction,
  type TransactionDeps,
} from './profile-transaction.js'
import {
  listInstalledPlugins as defaultListInstalledPlugins,
  readProfileDeps,
  type InstalledPlugin,
} from './installed.js'
import { setLivePluginDisabled } from './live-plugin.js'
import {
  loadRegistry as defaultLoadRegistry,
  type LoadedRegistry,
  type RegistryCacheNamespace,
  type RegistryConfig,
  type RegistryEntry,
  type RegistryState,
} from './registry.js'
import {
  githubLatestTag as defaultGithubLatestTag,
  isNewerVersion,
  npmLatest as defaultNpmLatest,
  npmPackument as defaultNpmPackument,
  npmVersion,
} from './versions.js'

// ---------- 契约类型 ----------

export interface RegistryRuntimeOptions {
  /** Host API / Agent tools 固定 host；独立 CLI 固定 cli */
  namespace?: RegistryCacheNamespace
  signal?: AbortSignal
}

export type LatestErrorCode = 'LATEST_TIMEOUT' | 'LATEST_ERROR'

export interface MarketItem extends RegistryEntry {
  latestVersion?: string
  latestTag?: string
  latestSha?: string
  installed: boolean
  installedPkg?: string
  installedVersion?: string
  outdated: boolean
  /** 查询最新版本失败的说明（不阻塞列表） */
  latestError?: string
  latestErrorCode?: LatestErrorCode
}

export type CategoryCounts = Record<RegistryEntry['category'], number>

export interface MarketQuery extends RegistryRuntimeOptions {
  query?: string
  category?: RegistryEntry['category'] | null
  offset?: number
  /** core 按 withLatest hard clamp：true 最大 50，false 最大 80 */
  limit?: number
  /** core 默认 true；Host GUI 忽略 caller 值，tool/CLI 显式 false */
  withLatest?: boolean
  force?: boolean
  /** default 60_000；测试注入短 deadline */
  deadlineMs?: number
}

export interface MarketDeps {
  loadRegistry: typeof defaultLoadRegistry
  listInstalledPlugins: typeof defaultListInstalledPlugins
  npmLatest: typeof defaultNpmLatest
  githubLatestTag: typeof defaultGithubLatestTag
}

export interface MarketResult {
  items: MarketItem[]
  total: number
  offset: number
  limit: number
  categoryCounts: CategoryCounts
  registryState: RegistryState
  installedComplete: boolean
  latestComplete: boolean
  latestTimedOut: boolean
}

export interface InstalledItem extends InstalledPlugin {
  registryId?: string
  latestTag?: string
  latestSha?: string
  registryGithub?: string | null
  registryIcon?: string | null
  latestVersion?: string
  outdated: boolean
  latestError?: string
}

export interface InstalledResult {
  items: InstalledItem[]
  others: number
  profileDir: string
  registryState: RegistryState
}

// ---------- 通用工具 ----------

const DEFAULT_DEADLINE_MS = 60_000
const WITH_LATEST_MAX = 50
const METADATA_ONLY_MAX = 80
const LATEST_WORKERS = 8

export function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

/** 稳定顺序的并发 map：结果顺序与输入一致，in-flight ≤ limit。 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const size = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const index = next
      if (index >= items.length) return
      next += 1
      results[index] = await worker(items[index]!, index)
    }
  })
  await Promise.all(runners)
  return results
}

function zeroCounts(): CategoryCounts {
  return { market: 0, tools: 0, ui: 0, search: 0, other: 0 }
}

function clampLimit(raw: unknown, max: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : max
  return Math.min(max, Math.max(1, n))
}

function normalizeOffset(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0
  return n > 0 ? n : 0
}

function stateOf(loaded: LoadedRegistry): RegistryState {
  return {
    configuredAddress: loaded.configuredAddress,
    activeAddress: loaded.activeAddress,
    source: loaded.source,
    status: loaded.status,
    isDefault: loaded.isDefault,
    stale: loaded.stale,
    fetchedAt: loaded.fetchedAt,
    errors: loaded.errors,
    count: loaded.count,
  }
}

function timeoutRegistryState(cfg: RegistryConfig): RegistryState {
  const configuredAddress = typeof cfg.registryUrl === 'string' ? cfg.registryUrl.trim() : ''
  return {
    configuredAddress,
    activeAddress: null,
    source: configuredAddress === '' ? 'default-cache' : 'custom-unavailable',
    status: 'unavailable',
    isDefault: configuredAddress === '',
    stale: false,
    fetchedAt: null,
    errors: ['registry 加载超出 deadline'],
    count: 0,
  }
}

function deadlineRace<T>(task: Promise<T>, ms: number): Promise<T | 'deadline'> {
  return new Promise<T | 'deadline'>((resolve, reject) => {
    const timer = setTimeout(() => resolve('deadline'), Math.max(0, ms))
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

// ---------- latest TTL cache ----------

interface LatestValue {
  version?: string
  tag?: string
  sha?: string
}

interface LatestCacheEntry {
  at: number
  value: LatestValue
}

const latestCache = new Map<string, LatestCacheEntry>()
const LATEST_CACHE_MAX = 5000

function latestCacheKey(namespace: RegistryCacheNamespace, registryKey: string, item: RegistryEntry): string {
  const id = item.source === 'npm' && item.npm ? `npm:${item.npm}` : item.github ? `gh:${item.github}` : item.id
  return `${namespace}|${registryKey}|${id}`
}

function readLatestCache(key: string, ttlMin: number): LatestValue | null {
  const entry = latestCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at >= ttlMin * 60_000) {
    latestCache.delete(key)
    return null
  }
  return entry.value
}

function writeLatestCache(key: string, value: LatestValue): void {
  if (latestCache.size >= LATEST_CACHE_MAX) {
    const oldest = latestCache.keys().next().value
    if (oldest !== undefined) latestCache.delete(oldest)
  }
  latestCache.set(key, { at: Date.now(), value })
}

// ---------- probe 基元 ----------

interface ProbeOutcome {
  ok: boolean
  timeout?: boolean
  error?: unknown
  value?: LatestValue
}

function probeTask(item: MarketItem, deps: MarketDeps, timeoutMs: number, signal?: AbortSignal): Promise<LatestValue> {
  if (item.source === 'npm' && item.npm) {
    return deps.npmLatest(item.npm, timeoutMs, signal).then((r) => ({ version: r.version }))
  }
  return deps.githubLatestTag(item.github!, timeoutMs, signal).then((r) => ({ tag: r.tag, sha: r.sha }))
}

/**
 * 单个 probe 的 deadline 收敛：即使依赖忽略 AbortSignal 也通过 race 返回。
 * 外部 signal abort → 抛 AbortError（由上层终止整次请求）。
 */
async function probeWithBudget(
  task: Promise<LatestValue>,
  budgetMs: number,
  signal?: AbortSignal,
): Promise<ProbeOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutP = new Promise<ProbeOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timeout: true }), Math.max(1, budgetMs))
  })
  const safeTask = task.then<ProbeOutcome, ProbeOutcome>(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  )
  const abortP = signal
    ? new Promise<ProbeOutcome>((_, reject) => {
        signal!.addEventListener('abort', () => reject(abortError()), { once: true })
      })
    : null
  try {
    return await Promise.race(abortP ? [safeTask, timeoutP, abortP] : [safeTask, timeoutP])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

interface ProbeTarget {
  latestVersion?: string
  latestTag?: string
  latestSha?: string
}

function applyProbe(item: ProbeTarget, value: LatestValue): void {
  if (value.version !== undefined) item.latestVersion = value.version
  if (value.tag !== undefined) item.latestTag = value.tag
  if (value.sha !== undefined) item.latestSha = value.sha
}

function matchInstalledByEntry(entry: RegistryEntry, installed: InstalledPlugin[]): InstalledPlugin | undefined {
  return installed.find((it) => {
    if (entry.npm && it.pkg === entry.npm) return true
    if (entry.npm && it.name === entry.npm) return true
    if (entry.github && it.source === 'github') {
      const m = /^github:([^#]+)/.exec(it.spec)
      if (m && m[1] === entry.github) return true
    }
    return false
  })
}

// ---------- 市场列表 ----------

function marketDeps(): MarketDeps {
  return {
    loadRegistry: defaultLoadRegistry,
    listInstalledPlugins: defaultListInstalledPlugins,
    npmLatest: defaultNpmLatest,
    githubLatestTag: defaultGithubLatestTag,
  }
}

export async function listMarket(
  cfg: RegistryConfig = {},
  opts: MarketQuery = {},
  deps: Partial<MarketDeps> = {},
): Promise<MarketResult> {
  const d: MarketDeps = { ...marketDeps(), ...deps }
  const startedAt = Date.now()
  const deadlineMs = typeof opts.deadlineMs === 'number' && Number.isFinite(opts.deadlineMs) && opts.deadlineMs > 0
    ? opts.deadlineMs
    : DEFAULT_DEADLINE_MS
  const deadlineAt = startedAt + deadlineMs
  const namespace = opts.namespace ?? 'host'
  const withLatest = opts.withLatest !== false
  const maxLimit = withLatest ? WITH_LATEST_MAX : METADATA_ONLY_MAX
  const signal = opts.signal
  const remaining = () => deadlineAt - Date.now()

  const registryTask = d.loadRegistry(cfg, { namespace, signal, force: opts.force, deadlineMs })
  const installedTask: Promise<Awaited<ReturnType<MarketDeps['listInstalledPlugins']>> | null> =
    d.listInstalledPlugins().catch(() => null)

  let loaded: LoadedRegistry | 'deadline'
  try {
    loaded = await deadlineRace(registryTask, remaining())
  } catch (err) {
    void installedTask
    throw err
  }
  if (loaded === 'deadline') {
    void installedTask
    return {
      items: [],
      total: 0,
      offset: 0,
      limit: maxLimit,
      categoryCounts: zeroCounts(),
      registryState: timeoutRegistryState(cfg),
      installedComplete: false,
      latestComplete: false,
      latestTimedOut: true,
    }
  }
  const registryState = stateOf(loaded)

  if (loaded.status === 'unavailable') {
    void installedTask
    return {
      items: [],
      total: 0,
      offset: 0,
      limit: maxLimit,
      categoryCounts: zeroCounts(),
      registryState,
      installedComplete: false,
      latestComplete: false,
      latestTimedOut: false,
    }
  }

  const installed = await installedTask
  const installedComplete = installed !== null
  const installedItems = installed?.items ?? []

  // 全量统计 + query/category 过滤 + 分页（同步，极轻）
  const all = loaded.registry.plugins
  const counts = zeroCounts()
  for (const entry of all) counts[entry.category] += 1
  const q = (opts.query ?? '').trim().toLowerCase()
  const cat = opts.category ?? null
  const filtered = all.filter((entry) => {
    if (cat && entry.category !== cat) return false
    if (!q) return true
    return `${entry.id} ${entry.name} ${entry.description} ${entry.tags.join(' ')}`.toLowerCase().includes(q)
  })
  const total = filtered.length
  const limit = clampLimit(opts.limit, maxLimit)
  let offset = normalizeOffset(opts.offset)
  if (total > 0 && offset >= total) offset = Math.floor((total - 1) / limit) * limit

  const items: MarketItem[] = filtered.slice(offset, offset + limit).map((entry) => {
    const inst = matchInstalledByEntry(entry, installedItems)
    const item: MarketItem = { ...entry, installed: Boolean(inst), outdated: false }
    if (inst) {
      item.installedPkg = inst.pkg
      item.installedVersion = inst.version
    }
    return item
  })

  let latestComplete = true
  let latestTimedOut = false
  if (withLatest && items.length > 0) {
    // 先吃 cache 命中
    const ttlMin = Math.max(0, cfg.cacheTtlMin ?? 60)
    for (const item of items) {
      const cached = readLatestCache(latestCacheKey(namespace, loaded.configuredAddress, item), ttlMin)
      if (cached) applyProbe(item, cached)
    }
    const todo = items.filter((it) => it.latestVersion === undefined && it.latestTag === undefined && it.latestSha === undefined)
    if (todo.length > 0) {
      const budget = remaining()
      if (budget <= 0) {
        for (const item of todo) item.latestErrorCode = 'LATEST_TIMEOUT'
        latestComplete = false
        latestTimedOut = true
      } else {
        await mapWithConcurrency(todo, LATEST_WORKERS, async (item) => {
          const perBudget = Math.max(1, remaining())
          const task = probeTask(item, d, Math.min(cfg.timeoutMs ?? 20_000, perBudget), signal)
          const outcome = await probeWithBudget(task, perBudget, signal)
          if (outcome.ok && outcome.value) {
            applyProbe(item, outcome.value)
            writeLatestCache(latestCacheKey(namespace, loaded.configuredAddress, item), outcome.value)
          } else if (outcome.timeout) {
            item.latestErrorCode = 'LATEST_TIMEOUT'
            latestComplete = false
            latestTimedOut = true
          } else if (outcome.error !== undefined) {
            if (signal?.aborted) throw abortError()
            item.latestError = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
            item.latestErrorCode = 'LATEST_ERROR'
          }
        })
      }
    }
    // outdated 判定统一在 probe 后进行
    for (const item of items) {
      const inst = item.installedPkg !== undefined ? installedItems.find((i) => i.pkg === item.installedPkg) : undefined
      if (!inst) continue
      if (item.latestVersion !== undefined && inst.version) {
        item.outdated = isNewerVersion(item.latestVersion, inst.version)
      } else if (item.latestSha !== undefined) {
        item.outdated = !inst.spec.includes(item.latestSha)
      }
    }
  }

  return { items, total, offset, limit, categoryCounts: counts, registryState, installedComplete, latestComplete, latestTimedOut }
}

// ---------- 已装列表 ----------

export async function listInstalledWithMeta(
  cfg: RegistryConfig = {},
  opts: RegistryRuntimeOptions & { deadlineMs?: number; force?: boolean } = {},
  deps: Partial<MarketDeps> = {},
): Promise<InstalledResult> {
  const d: MarketDeps = { ...marketDeps(), ...deps }
  const startedAt = Date.now()
  const deadlineMs = typeof opts.deadlineMs === 'number' && Number.isFinite(opts.deadlineMs) && opts.deadlineMs > 0
    ? opts.deadlineMs
    : DEFAULT_DEADLINE_MS
  const deadlineAt = startedAt + deadlineMs
  const namespace = opts.namespace ?? 'host'
  const signal = opts.signal
  const remaining = () => deadlineAt - Date.now()

  const installedPromise = d.listInstalledPlugins()
  const registryTask = d.loadRegistry(cfg, { namespace, signal, force: opts.force, deadlineMs })
  const installed = await installedPromise
  const items: InstalledItem[] = installed.items.map((it) => ({ ...it, outdated: false }))

  let loaded: LoadedRegistry | 'deadline'
  try {
    loaded = await deadlineRace(registryTask, remaining())
  } catch {
    loaded = 'deadline'
  }

  if (loaded === 'deadline' || loaded.status === 'unavailable') {
    // registry 不可用：不做 matching，直接返回已装列表
    const registryState = loaded === 'deadline' ? timeoutRegistryState(cfg) : stateOf(loaded)
    return { items, others: installed.others, profileDir: installed.profileDir, registryState }
  }

  const registryState = stateOf(loaded)

  const ttlMin = Math.max(0, cfg.cacheTtlMin ?? 60)
  await mapWithConcurrency(items, LATEST_WORKERS, async (item) => {
    const entry = loaded.registry.plugins.find((e) => matchInstalledByEntry(e, [item]))
    if (entry) {
      item.registryId = entry.id
      item.registryGithub = entry.github ?? null
      item.registryIcon = entry.icon ?? null
    }
    // latest 探测沿用 listMarket 的 TTL cache
    const cacheKey = entry
      ? latestCacheKey(namespace, loaded.configuredAddress, entry)
      : item.source === 'npm'
        ? `npm-only|${namespace}|npm:${item.pkg}`
        : null
    if (cacheKey) {
      const cached = readLatestCache(cacheKey, ttlMin)
      if (cached) {
        applyProbe(item, cached)
      } else if (remaining() > 0) {
        const budget = Math.max(1, remaining())
        try {
          let value: LatestValue | null = null
          if (!entry && item.source === 'npm') {
            const latest = await d.npmLatest(item.pkg, Math.min(cfg.timeoutMs ?? 20_000, budget), signal)
            value = { version: latest.version }
          } else if (entry?.source === 'npm' && entry.npm) {
            const latest = await d.npmLatest(entry.npm, Math.min(cfg.timeoutMs ?? 20_000, budget), signal)
            value = { version: latest.version }
          } else if (item.source === 'github') {
            const m = /^github:([^#]+)/.exec(item.spec)
            if (m) {
              const latest = await d.githubLatestTag(m[1], Math.min(cfg.timeoutMs ?? 20_000, budget), signal)
              value = { tag: latest.tag, sha: latest.sha }
            }
          }
          if (value) {
            applyProbe(item, value)
            writeLatestCache(cacheKey, value)
          }
        } catch (err) {
          item.latestError = err instanceof Error ? err.message : String(err)
        }
      }
    }
    if (item.latestVersion !== undefined && item.version) item.outdated = isNewerVersion(item.latestVersion, item.version)
    else if (item.latestSha !== undefined) item.outdated = !item.spec.includes(item.latestSha)
  })

  return { items, others: installed.others, profileDir: installed.profileDir, registryState }
}

// ---------- 安装 / 升级 ----------

/** 安装路径可注入依赖（测试用；生产走真实实现）。 */
export interface InstallDeps extends Partial<MarketDeps> {
  addDshPlugin?: typeof addDshPlugin
  removeDshPlugin?: typeof removeDshPlugin
  readProfileDeps?: typeof readProfileDeps
  npmVersion?: typeof npmVersion
  npmPackument?: typeof defaultNpmPackument
  readLockIntegrity?: typeof readPnpmLockIntegrity
  profileDir?: string
  /** 恢复快照后的 pnpm install --frozen-lockfile（可注入） */
  restoreInstall?: (profileDir: string) => Promise<unknown>
  /** B2 最终降级：frozen 持续失配时的 lockfile 重建（--no-frozen-lockfile，可注入） */
  rebuildInstall?: (profileDir: string) => Promise<unknown>
  /** B3：ERR_PNPM_NO_MATCHING_VERSION 的退避重试间隔（毫秒，按序消费）；测试注入 [0,0] */
  retryDelaysMs?: number[]
  /** Task 3 起：事务依赖注入（生产原生形态；旧槽位经桥接兼容至 Task 9 删除） */
  transaction?: TransactionDeps
}

// ---------- Task 3：npm 分支事务桥接（txDepsFrom；Task 9 删除） ----------

/** legacy mutation 槽位（add/remove/frozen/rebuild）任一存在时才构造 legacy runner。 */
function hasLegacyMutationOverrides(deps?: InstallDeps): boolean {
  return deps?.addDshPlugin !== undefined
    || deps?.removeDshPlugin !== undefined
    || deps?.restoreInstall !== undefined
    || deps?.rebuildInstall !== undefined
}

function bridgeOutcome(text: string): RunnerOutcome {
  const raw = String(text ?? '')
  return { ...classifyPnpmError(raw), output: raw.length <= 800 ? raw : raw.slice(-800) }
}

/**
 * legacy 槽位 → PnpmRunner 包装：成功→ok+output+usedAllowAllBuilds；throw→原始文本分类。
 * 未注入的槽位逐操作回退有效 runner（transaction.runner 优先，缺省生产 makeDshRunner），
 * 绝不构造残缺 runner。
 */
function bridgeLegacyRunnerWithPerOperationFallbacks(deps: InstallDeps, base: PnpmRunner): PnpmRunner {
  return {
    add: deps.addDshPlugin !== undefined
      ? async (spec: string, signal?: AbortSignal): Promise<RunnerOutcome> => {
          try {
            const r = await deps.addDshPlugin!(spec)
            return { class: 'ok', output: r.output, usedAllowAllBuilds: r.usedAllowAllBuilds === true }
          } catch (err) {
            return bridgeOutcome(err instanceof Error ? err.message : String(err))
          }
        }
      : base.add.bind(base),
    remove: deps.removeDshPlugin !== undefined
      ? async (pkg: string, signal?: AbortSignal): Promise<RunnerOutcome> => {
          try {
            const output = await deps.removeDshPlugin!(pkg, { signal })
            return { class: 'ok', output }
          } catch (err) {
            return bridgeOutcome(err instanceof Error ? err.message : String(err))
          }
        }
      : base.remove.bind(base),
    frozenInstall: deps.restoreInstall !== undefined
      ? async (): Promise<RunnerOutcome> => {
          try {
            await deps.restoreInstall!(deps.profileDir ?? webProfileDir())
            return { class: 'ok', output: 'frozen-lockfile 校验通过' }
          } catch (err) {
            return bridgeOutcome(err instanceof Error ? err.message : String(err))
          }
        }
      : base.frozenInstall.bind(base),
    rebuildInstall: deps.rebuildInstall !== undefined
      ? async (): Promise<RunnerOutcome> => {
          try {
            await deps.rebuildInstall!(deps.profileDir ?? webProfileDir())
            return { class: 'ok', output: 'lockfile 已重建（--no-frozen-lockfile）' }
          } catch (err) {
            return bridgeOutcome(err instanceof Error ? err.message : String(err))
          }
        }
      : base.rebuildInstall.bind(base),
  }
}

/**
 * 桥接构造（Task 9 删除）：legacy InstallDeps 槽位 → TransactionDeps。
 * 仅注入查询类依赖时不得构造残缺 legacy runner——直接用注入的 transaction.runner 或生产 runner。
 */
function txDepsFrom(deps: InstallDeps | undefined, timeoutMs: number): TransactionDeps {
  const profileDir = deps?.transaction?.profileDir ?? deps?.profileDir ?? webProfileDir()
  const productionRunner = makeDshRunner(profileDir)
  const effectiveRunner = deps?.transaction?.runner?.(profileDir) ?? productionRunner
  const runner = hasLegacyMutationOverrides(deps)
    ? bridgeLegacyRunnerWithPerOperationFallbacks(deps ?? {}, effectiveRunner)
    : effectiveRunner
  return {
    ...deps?.transaction,
    profileDir,
    runner: () => runner,
    warmPackument:
      deps?.transaction?.warmPackument
      ?? (deps?.npmPackument !== undefined
        ? (pkg: string, signal?: AbortSignal) =>
            Promise.resolve(deps.npmPackument!(pkg, timeoutMs, signal)).then(() => undefined, () => undefined)
        : makeNpmWarmPackument(timeoutMs)),
    retryDelaysMs: deps?.transaction?.retryDelaysMs ?? deps?.retryDelaysMs,
    readProfileDeps: deps?.transaction?.readProfileDeps ?? deps?.readProfileDeps,
  }
}

export interface InstallResult {
  id: string
  pkg: string
  spec: string
  version?: string
  sha?: string
  tag?: string
  usedAllowAllBuilds: boolean
  needsRestart: true
  output: string
  /** 事务自愈动作（机器可断言 code + 给人看的 note） */
  healActions?: HealAction[]
}

/** 从 registry 收录条目安装（npm → 精确锁定最新版；github → 锁 HEAD SHA）。 */
export async function installFromRegistry(
  id: string,
  cfg: RegistryConfig = {},
  opts: { version?: string } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallResult> {
  const loaded = await (deps?.loadRegistry ?? defaultLoadRegistry)(cfg, { namespace: opts.namespace ?? 'host' })
  if (loaded.status === 'unavailable') {
    throw new Error(`收录清单不可用，无法安装 ${id}；请检查 registry 配置或网络后重试`)
  }
  const entry = loaded.registry.plugins.find((e) => e.id === id)
  if (!entry) throw new Error(`registry 中没有该条目: ${id}`)
  return installEntry(entry, cfg, opts, deps)
}

export async function installEntry(
  entry: RegistryEntry,
  cfg: RegistryConfig = {},
  opts: { version?: string } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallResult> {
  const timeoutMs = cfg.timeoutMs ?? 20_000
  const d = {
    npmLatest: deps?.npmLatest ?? defaultNpmLatest,
    npmVersion: deps?.npmVersion ?? npmVersion,
  }
  if (entry.source === 'npm' && entry.npm) {
    const pkg = entry.npm
    // npm：无论 latest 还是用户指定 exact，都先读取该精确版本的 dist metadata（事务外解析）
    let version: string
    let expectedIntegrity: string | undefined
    if (opts.version) {
      const meta = await d.npmVersion(pkg, opts.version, timeoutMs, opts.signal)
      version = meta.version
      expectedIntegrity = meta.integrity
    } else {
      const latest = await d.npmLatest(pkg, timeoutMs, opts.signal)
      version = latest.version
      expectedIntegrity = latest.integrity
    }
    if (!expectedIntegrity) throw new Error(`npm metadata 缺少 dist integrity：${pkg}@${version}，拒绝安装`)
    const result = await runProfileTransaction(
      { kind: 'install-npm', pkg, version, integrity: expectedIntegrity, signal: opts.signal },
      txDepsFrom(deps, timeoutMs),
    )
    if (!result.ok) throw new TransactionError(result)
    const notes = result.healActions.map((h) => h.note).filter((n) => n !== '')
    return {
      id: entry.id,
      pkg: result.pkg ?? pkg,
      spec: result.spec ?? `${pkg}@${version}`,
      version: result.version ?? version,
      usedAllowAllBuilds: result.usedAllowAllBuilds === true,
      needsRestart: true,
      output: result.output + (notes.length > 0 ? `\n[dsh-m 自愈] ${notes.join('；')}` : ''),
      healActions: result.healActions,
    }
  }
  if (entry.github) {
    // 版本解析在事务外（DI 修正：githubLatestTag 此前绕过注入）
    const { tag, sha } = await (deps?.githubLatestTag ?? defaultGithubLatestTag)(entry.github, timeoutMs, opts.signal)
    const result = await runProfileTransaction(
      { kind: 'install-github', repo: entry.github, sha, tag, signal: opts.signal },
      txDepsFrom(deps, timeoutMs),
    )
    if (!result.ok) throw new TransactionError(result)
    const notes = result.healActions.map((h) => h.note).filter((n) => n !== '')
    return {
      id: entry.id,
      pkg: result.pkg ?? entry.github,
      spec: result.spec ?? `github:${entry.github}#${sha}`,
      sha: result.sha ?? sha,
      tag: result.tag ?? tag,
      usedAllowAllBuilds: result.usedAllowAllBuilds === true,
      needsRestart: true,
      output: result.output + (notes.length > 0 ? `\n[dsh-m 自愈] ${notes.join('；')}` : ''),
      healActions: result.healActions,
    }
  }
  throw new Error(`条目 ${entry.id} 缺少可安装来源`)
}

export interface UninstallResult {
  pkg: string
  liveDisabled: boolean
  needsRestart: true
  leftovers: string[]
  /** 事务自愈动作（机器可断言 code + 给人看的 note） */
  healActions?: HealAction[]
}

export interface UninstallDeps {
  /** Task 6 起：卸载走事务（validate 前置 + 快照 + 回滚）；注入仅为可测试性 */
  transaction?: TransactionDeps
}

/** 卸载：validate（严格读取）→ live-disable → 摘补丁 → pnpm remove → verify gone（DESIGN.md §3：删包不删数据）。 */
export async function uninstallPlugin(
  pkg: string,
  _cfg: RegistryConfig = {},
  opts: RegistryRuntimeOptions = {},
  deps: UninstallDeps = {},
): Promise<UninstallResult> {
  const result = await runProfileTransaction(
    { kind: 'uninstall', pkg, signal: opts.signal },
    deps.transaction ?? {},
  )
  if (!result.ok) throw new TransactionError(result)
  const orphaned = result.orphanedPatchFiles ?? []
  const leftovers = [...new Set([...leftoverCandidates(pkg), ...orphaned])]
  return {
    pkg,
    liveDisabled: result.liveDisabled === true,
    needsRestart: true,
    leftovers,
    healActions: result.healActions,
  }
}

export interface UpgradeResult extends InstallResult {
  fromVersion?: string
}

/** 升级 = 按最新重新安装（npm 拉最新精确版；github 重新锁 HEAD）。 */
export async function upgradePlugin(
  pkg: string,
  cfg: RegistryConfig = {},
  opts: RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<UpgradeResult> {
  const loaded = await (deps?.loadRegistry ?? defaultLoadRegistry)(cfg, { namespace: opts.namespace ?? 'host' })
  if (loaded.status === 'unavailable') {
    throw new Error(`收录清单不可用，无法升级 ${pkg}；请检查 registry 配置或网络后重试`)
  }
  const { items: installed } = await (deps?.listInstalledPlugins ?? defaultListInstalledPlugins)()
  const target = installed.find((it) => it.pkg === pkg)
  if (!target) throw new Error(`web profile 未安装该插件: ${pkg}`)
  const entry = loaded.registry.plugins.find((e) => matchInstalledByEntry(e, [target]))
  if (!entry) throw new Error(`「${pkg}」不是经 dsh-m 收录的插件；直接升级请用 dsh plugin update 或先在 registry 收录它`)
  const result = await installEntry(entry, cfg, opts, deps)
  return { ...result, fromVersion: target.version }
}

// ---------- 变更互斥 ----------

/** 变更互斥：安装/卸载/升级串行执行（skillhub install-lock 同款思路）。 */
let mutationTail: Promise<unknown> = Promise.resolve()

export function withMutationLock<T>(task: () => Promise<T>): Promise<T> {
  const next = mutationTail.then(task, task)
  mutationTail = next.catch(() => undefined)
  return next
}

/** 疑似残留路径（存在才列出）：删包不删数据，只报告。 */
export function leftoverCandidates(pkg: string): string[] {
  const home = dshHome()
  const candidates = [
    join(home, `${pkg}.json`),
    join(home, pkg),
    join(home, `${pkg.replace(/^@[^/]+\//, '')}.json`),
  ]
  return candidates.filter((p) => existsSync(p))
}
