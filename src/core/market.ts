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
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHome, webProfileDir } from './env.js'
import {
  runProfileTransaction,
  makeNpmWarmPackument,
  TransactionError,
  type HealAction,
  type TransactionDeps,
} from './profile-transaction.js'
import {
  listInstalledPlugins as defaultListInstalledPlugins,
  type InstalledPlugin,
} from './installed.js'
import { setLivePluginDisabled, loaderHost, type LoaderEntry } from './live-plugin.js'
import { precheckNpmCompat, IncompatibleError, type CompatIssue } from './compat-check.js'
import { PROTECTED_MODULES, composeEnablement, type PluginEnablement } from './enablement.js'
import { readProfileOverrides } from './patch-yaml.js'
import {
  loadRegistry as defaultLoadRegistry,
  type LoadedRegistry,
  type RegistryCacheNamespace,
  type RegistryConfig,
  type RegistryEntry,
  type RegistryState,
} from './registry.js'
import {
  fetchCommunityCatalog as defaultFetchCommunityCatalog,
  type CommunityCatalogState,
  type CommunityStatus,
  type LoadedCommunity,
} from './community.js'
import { adaptCommunityCatalog, type CommunityEntry } from './community-adapter.js'
import { createGithubRequestBudget, type GithubBudget } from './versions.js'
import {
  githubLatestTag as defaultGithubLatestTag,
  isNewerVersion,
  npmLatest as defaultNpmLatest,
  npmVersion,
} from './versions.js'

// ---------- 契约类型 ----------

export interface RegistryRuntimeOptions {
  /** Host API / Agent tools 固定 host；独立 CLI 固定 cli */
  namespace?: RegistryCacheNamespace
  signal?: AbortSignal
}

export type LatestErrorCode = 'LATEST_TIMEOUT' | 'LATEST_ERROR'

export interface MarketItem extends Omit<RegistryEntry, 'category'> {
  /** 合并市场开放分类（M1 Task 5）：主清单 5 值 + 社区开放 slug */
  category: string
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
  /** 社区收录条目标记（M1 Task 5）；主清单条目不带 */
  community?: true
  /** 以下为社区旁路字段（Q44：能力披露/截图只进详情折叠区，卡片不打标） */
  stars?: number | null
  downloads?: number | null
  capabilities?: string[]
  capabilityRedLines?: string[]
  screenshots?: string[]
}

/** 开放分类计数：精选 5 键恒在 + 社区开放 slug 键（M1 Task 5）。 */
export type CategoryCounts = Record<string, number>

/** 社区 registry summary 完整字段口径（Task 6 getCommunitySummary 同型；status=disabled/unavailable 时计数字段 0/null，不伪造）。 */
export interface CommunityRegistrySummary {
  enabled: boolean
  status: CommunityStatus
  version: string | null
  checkedAt: string | null
  fetchedAt: string | null
  route: string | null
  acceptedCount: number
  upstreamCount: number | null
  displaced: number
  skippedDirty: number
  skippedSubpathNoNpm: number
  errors: string[]
  warnings: string[]
}

export interface MarketQuery extends RegistryRuntimeOptions {
  query?: string
  /** 精选 5 分类或社区开放分类 slug（host-api 层校验安全 slug；core 侧原样匹配） */
  category?: string | null
  offset?: number
  /** core 按 withLatest hard clamp：true 最大 50，false 最大 80 */
  limit?: number
  /** core 默认 true；Host GUI 忽略 caller 值，tool/CLI 显式 false */
  withLatest?: boolean
  /** 只看主清单：跳过社区加载（loader 零调用） */
  primaryOnly?: boolean
  force?: boolean
  /** default 60_000；测试注入短 deadline */
  deadlineMs?: number
}

export interface MarketDeps {
  loadRegistry: typeof defaultLoadRegistry
  listInstalledPlugins: typeof defaultListInstalledPlugins
  npmLatest: typeof defaultNpmLatest
  githubLatestTag: typeof defaultGithubLatestTag
  /** 社区清单加载（M1 Task 5；测试注入） */
  fetchCommunityCatalog: typeof defaultFetchCommunityCatalog
  /** enablement 合成注入（Task 13）；缺省 = composeEnablement */
  composeEnablement?: typeof composeEnablement
}

/** profile package.json 的 dsh.profile.bundles 数组（读不到 → []；Task 13）。 */
async function readProfileBundles(profileDir: string): Promise<string[]> {
  try {
    const raw = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } }
    }
    const bundles = raw?.dsh?.profile?.bundles
    return Array.isArray(bundles) ? bundles.filter((name): name is string => typeof name === 'string') : []
  } catch {
    return []
  }
}

/** profile cordis.patch.yml 覆盖行（读不到 → []；Task 13）。 */
async function readProfileOverrideRows(profileDir: string): Promise<Array<{ id: string; disabled: boolean }>> {
  try {
    return readProfileOverrides(await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8'))
  } catch {
    return []
  }
}

/** 宿主内 loader entries（CLI/测试进程 → null；Task 13 读路径始终自读）。 */
function loaderEntriesOrNull(): LoaderEntry[] | null {
  const entries = loaderHost()?.loader?.entries
  if (typeof entries !== 'function') return null
  try {
    return [...entries.call(loaderHost()!.loader)]
  } catch {
    return null
  }
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
  /** 社区清单状态 summary（M1 Task 5；primaryOnly → disabled） */
  community: CommunityRegistrySummary
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
  /** 命中社区收录条目（主清单未收录；M1 Task 5） */
  community?: true
}

export interface InstalledResult {
  items: InstalledItem[]
  others: number
  profileDir: string
  registryState: RegistryState
  /** CLI outdated 双源判定的状态来源（M1 Task 5，v3 缺口闭合） */
  community: CommunityRegistrySummary
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

function latestCacheKey(namespace: RegistryCacheNamespace, registryKey: string, item: Pick<RegistryEntry, 'source' | 'npm' | 'github' | 'id'>): string {
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

function matchInstalledByEntry(entry: Pick<RegistryEntry, 'npm' | 'github'>, installed: InstalledPlugin[]): InstalledPlugin | undefined {
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

// ---------- 合并层（M1 Task 5 / Q41 / Q45） ----------

export interface MergeRegistriesResult {
  /** 主清单在前（组内原顺序）+ 社区条目在后（downloads 降序、无数据按名称） */
  items: Array<RegistryEntry | CommunityEntry>
  /** 与主清单撞名而让位的社区条目数（Q41：去重键序 npm 名 → owner/repo → 合成 id） */
  displaced: number
  /** 合并层 warning（让位计数聚合；社区层 warnings 由 summary 另行合并） */
  warnings: string[]
}

/**
 * 合并去重（Q41）：社区条目依次与主清单的 npm 名集 / github owner-repo 集 / id 集比对，
 * 任一相撞即让位（每条只计一次）；社区内部 npm 名重复同样让位（首条优先）。
 * 主清单恒优先——让位只影响社区条目，主条目原样保留。
 */
export function mergeRegistries(primary: RegistryEntry[], community: CommunityEntry[]): MergeRegistriesResult {
  const primaryNpm = new Set(primary.filter((e) => e.npm).map((e) => e.npm as string))
  const primaryGithub = new Set(primary.filter((e) => e.github).map((e) => e.github as string))
  const primaryIds = new Set(primary.map((e) => e.id))
  const displaced: string[] = []
  const kept: CommunityEntry[] = []
  const seenNpm = new Set<string>()
  for (const c of community) {
    if (c.npm !== undefined) {
      if (primaryNpm.has(c.npm) || seenNpm.has(c.npm)) {
        displaced.push(c.id)
        continue
      }
      seenNpm.add(c.npm)
    }
    if ((c.github !== undefined && primaryGithub.has(c.github)) || primaryIds.has(c.id)) {
      displaced.push(c.id)
      continue
    }
    kept.push(c)
  }
  // Q45：主清单置顶（组内原顺序）+ 社区按 30 天下载量降序（无数据按名称）
  const sorted = [...kept].sort((a, b) => {
    const da = a.downloads ?? -1
    const db = b.downloads ?? -1
    if (da !== db) return db - da
    return a.name.localeCompare(b.name)
  })
  const warnings = displaced.length > 0 ? [`${displaced.length} 条社区条目与主清单重复，已让位（主清单恒优先）`] : []
  return { items: [...primary, ...sorted], displaced: displaced.length, warnings }
}

function communitySummary(state: CommunityCatalogState, counts: Partial<CommunityRegistrySummary>, extraWarnings: string[]): CommunityRegistrySummary {
  const unavailableLike = state.status === 'disabled' || state.status === 'unavailable'
  return {
    enabled: state.enabled,
    status: state.status,
    version: state.version,
    checkedAt: state.checkedAt,
    fetchedAt: state.fetchedAt,
    route: state.route,
    acceptedCount: unavailableLike ? 0 : (counts.acceptedCount ?? 0),
    upstreamCount: unavailableLike ? (state.status === 'disabled' ? null : 0) : (counts.upstreamCount ?? state.count),
    displaced: unavailableLike ? 0 : (counts.displaced ?? 0),
    skippedDirty: unavailableLike ? 0 : (counts.skippedDirty ?? 0),
    skippedSubpathNoNpm: unavailableLike ? 0 : (counts.skippedSubpathNoNpm ?? 0),
    errors: [...state.errors],
    warnings: [...state.warnings, ...extraWarnings],
  }
}

function disabledCommunitySummary(): CommunityRegistrySummary {
  return communitySummary(
    { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] },
    {},
    [],
  )
}

function communityTimeoutSummary(): CommunityRegistrySummary {
  return communitySummary(
    { enabled: true, status: 'unavailable', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: ['社区目录状态获取超时，可稍后刷新'], warnings: [] },
    {},
    [],
  )
}

interface CommunityOutcome {
  summary: CommunityRegistrySummary
  /** 合并后全量条目（主清单 + 存活社区条目）；社区不可用/未启用时 = 主清单原样 */
  merged: Array<RegistryEntry | CommunityEntry>
}

/**
 * 社区 loader waiter 收敛（v9/v10 waiter-scoped 契约）：共享 flight 不接收调用者 deadline，
 * 本函数作为 waiter 用剩余 deadline race 自己的等待；到点只结束本 waiter（summary 标超时），
 * 共享 flight 照常继续。primaryOnly/未启用 → loader 零调用（task 传 null）。
 * 导出供 community.ts getCommunitySummary 复用（summary 组装单一产地）。
 */
export async function communityOutcome(
  task: Promise<LoadedCommunity> | null,
  deadlineAt: number,
  primary: RegistryEntry[],
): Promise<CommunityOutcome> {
  if (!task) return { summary: disabledCommunitySummary(), merged: primary }
  let loaded: LoadedCommunity | 'deadline'
  try {
    loaded = await deadlineRace(task, deadlineAt - Date.now())
  } finally {
    // race 输出后共享 promise 若仍悬挂（deadline 先到），收尾防 unhandled rejection
    void task.catch(() => undefined)
  }
  if (loaded === 'deadline') return { summary: communityTimeoutSummary(), merged: primary }
  const state = loaded.state
  if (state.status === 'disabled') return { summary: disabledCommunitySummary(), merged: primary }
  if (state.status === 'unavailable' || !loaded.catalog) {
    return {
      summary: communitySummary(state, { acceptedCount: 0, upstreamCount: 0, displaced: 0, skippedDirty: 0, skippedSubpathNoNpm: 0 }, []),
      merged: primary,
    }
  }
  const adapted = adaptCommunityCatalog(loaded.catalog)
  const merge = mergeRegistries(primary, adapted.entries)
  const summary = communitySummary(
    state,
    {
      acceptedCount: adapted.entries.length,
      upstreamCount: loaded.catalog.plugins.length,
      displaced: merge.displaced,
      skippedDirty: adapted.skippedDirty,
      skippedSubpathNoNpm: adapted.skippedSubpathNoNpm,
    },
    [...adapted.warnings, ...merge.warnings],
  )
  return { summary, merged: merge.items }
}

function isCommunityEntry(entry: RegistryEntry | CommunityEntry): entry is CommunityEntry {
  return (entry as CommunityEntry).descriptionEn !== undefined
}

/** 合并条目 → MarketItem：社区条目带 community 标记与旁路字段。 */
function toMarketItem(entry: RegistryEntry | CommunityEntry, installedItems: InstalledPlugin[]): MarketItem {
  const inst = matchInstalledByEntry(entry, installedItems)
  const item: MarketItem = { ...entry, installed: Boolean(inst), outdated: false }
  if (inst) {
    item.installedPkg = inst.pkg
    item.installedVersion = inst.version
  }
  if (isCommunityEntry(entry)) {
    item.community = true
    item.stars = entry.stars
    item.downloads = entry.downloads
    item.capabilities = entry.capabilities
    item.capabilityRedLines = entry.capabilityRedLines
    item.screenshots = entry.screenshots
  }
  return item
}

/** 合并条目的搜索串：社区条目附英文描述原文（Q45 搜索同时匹配中英文）。 */
function searchableText(entry: RegistryEntry | CommunityEntry): string {
  const base = `${entry.id} ${entry.name} ${entry.description} ${entry.tags.join(' ')}`
  return isCommunityEntry(entry) ? `${base} ${entry.descriptionEn}` : base
}

// ---------- 市场列表 ----------

function marketDeps(): MarketDeps {
  return {
    loadRegistry: defaultLoadRegistry,
    listInstalledPlugins: defaultListInstalledPlugins,
    npmLatest: defaultNpmLatest,
    githubLatestTag: defaultGithubLatestTag,
    fetchCommunityCatalog: defaultFetchCommunityCatalog,
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
  // 社区 flight 并发启动（primaryOnly 零调用）；共享 loader 不接收调用者 deadline——
  // listMarket 作为 waiter 在 communityOutcome 内 race 自己的剩余 deadline/signal（v10 契约）
  const communityTask =
    opts.primaryOnly === true ? null : d.fetchCommunityCatalog(cfg, { namespace, signal, force: opts.force })

  let loaded: LoadedRegistry | 'deadline'
  try {
    loaded = await deadlineRace(registryTask, remaining())
  } catch (err) {
    void installedTask
    void communityTask?.catch(() => undefined)
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
      community: communityTimeoutSummary(),
    }
  }
  const registryState = stateOf(loaded)

  const installed = await installedTask
  // 完整性两层来源：枚举 throw → null；枚举 partial resolve → complete:false（installed.ts 完整性契约）
  const installedComplete = installed !== null && installed.complete === true
  const installedItems = installed?.items ?? []

  // 社区 waiter 收敛：主 unavailable 时 merged = 存活社区条目（Q42 出页不返空）；两层皆不可用 → 空页契约
  const community = await communityOutcome(communityTask, deadlineAt, loaded.registry.plugins)

  // 全量统计 + query/category 过滤 + 分页（同步，极轻）
  const all = community.merged
  const counts: CategoryCounts = zeroCounts()
  for (const entry of all) counts[entry.category] = (counts[entry.category] ?? 0) + 1
  const q = (opts.query ?? '').trim().toLowerCase()
  const cat = opts.category ?? null
  const filtered = all.filter((entry) => {
    if (cat && entry.category !== cat) return false
    if (!q) return true
    return searchableText(entry).toLowerCase().includes(q)
  })
  const total = filtered.length
  const limit = clampLimit(opts.limit, maxLimit)
  let offset = normalizeOffset(opts.offset)
  if (total > 0 && offset >= total) offset = Math.floor((total - 1) / limit) * limit

  const items: MarketItem[] = filtered.slice(offset, offset + limit).map((entry) => toMarketItem(entry, installedItems))

  let latestComplete = true
  let latestTimedOut = false
  if (withLatest && items.length > 0) {
    // 先吃 cache 命中
    const ttlMin = Math.max(0, cfg.cacheTtlMin ?? 60)
    for (const item of items) {
      const cached = readLatestCache(latestCacheKey(namespace, loaded.configuredAddress, item), ttlMin)
      if (cached) applyProbe(item, cached)
    }
    const todo = items.filter(
      (it) =>
        it.latestVersion === undefined &&
        it.latestTag === undefined &&
        it.latestSha === undefined &&
        // Q46 探测边界：社区 github 条目不做浏览页 REST 探测（配额不可控）；社区 npm 条目照常
        !(it.community === true && it.source === 'github'),
    )
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

  return {
    items,
    total,
    offset,
    limit,
    categoryCounts: counts,
    registryState,
    installedComplete,
    latestComplete,
    latestTimedOut,
    community: community.summary,
  }
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
  // 社区 flight 并发启动 + request-scoped GitHub 预算（本次检查 ≤25 个 wire 请求、宿主滚动 50/h）
  const communityTask = d.fetchCommunityCatalog(cfg, { namespace, signal, force: opts.force })
  const githubBudget = createGithubRequestBudget()
  const installed = await installedPromise
  // enablement join（Task 13，ADR-0001 读路径自读）：loader ⋈ bundles ⋈ profile 覆盖行
  const compose = d.composeEnablement ?? composeEnablement
  const enablement = await compose({
    items: installed.items,
    loaderEntries: loaderEntriesOrNull(),
    bundles: await readProfileBundles(installed.profileDir),
    profileOverrides: await readProfileOverrideRows(installed.profileDir),
  })
  const items: InstalledItem[] = installed.items.map((it) => ({
    ...it,
    outdated: false,
    ...(enablement.get(it.pkg) ?? { pkg: it.pkg, enabled: true, phase: null, granularity: 'bundle' as const, toggleable: false, lockReason: 'no-entry' as const }),
  }))

  let loaded: LoadedRegistry | 'deadline'
  try {
    loaded = await deadlineRace(registryTask, remaining())
  } catch {
    loaded = 'deadline'
  }

  const community = await communityOutcome(communityTask, deadlineAt, loaded === 'deadline' ? [] : loaded.registry.plugins)

  if (loaded === 'deadline' || loaded.status === 'unavailable') {
    // registry 不可用：不做 matching/探测（原行为），但社区 summary 照常携带（CLI outdated 双源判定）
    const registryState = loaded === 'deadline' ? timeoutRegistryState(cfg) : stateOf(loaded)
    void community.merged
    return { items, others: installed.others, profileDir: installed.profileDir, registryState, community: community.summary }
  }

  const registryState = stateOf(loaded)

  matchInstalled(items, community.merged)
  await probeLatest(items, { merged: community.merged, registryAddress: loaded.configuredAddress, ttlMin: Math.max(0, cfg.cacheTtlMin ?? 60) }, d, { namespace, signal, githubBudget, remaining, timeoutMs: cfg.timeoutMs ?? 20_000 })

  return { items, others: installed.others, profileDir: installed.profileDir, registryState, community: community.summary }
}

/** matching（主+社区合并条目）：命中主条目或社区条目都写 registryId；社区命中再标 community。 */
function matchInstalled(items: InstalledItem[], merged: Array<RegistryEntry | CommunityEntry>): void {
  for (const item of items) {
    const entry = merged.find((e) => matchInstalledByEntry(e, [item]))
    if (!entry) continue
    item.registryId = entry.id
    item.registryGithub = entry.github ?? null
    item.registryIcon = (entry as RegistryEntry).icon ?? null
    if (isCommunityEntry(entry)) item.community = true
  }
}

/** 已装页 latest 探测（Q46 已装页豁免，但 GitHub 计入 request 预算 + 宿主滚动窗口）。 */
async function probeLatest(
  items: InstalledItem[],
  ctx: { merged: Array<RegistryEntry | CommunityEntry>; registryAddress: string | null; ttlMin: number },
  d: MarketDeps,
  rt: { namespace: RegistryCacheNamespace; signal?: AbortSignal; githubBudget: GithubBudget; remaining: () => number; timeoutMs: number },
): Promise<void> {
  await mapWithConcurrency(items, LATEST_WORKERS, async (item) => {
    const entry = ctx.merged.find((e) => matchInstalledByEntry(e, [item]))
    // latest 探测沿用 listMarket 的 TTL cache
    const cacheKey = entry
      ? latestCacheKey(rt.namespace, ctx.registryAddress ?? '', entry)
      : item.source === 'npm'
        ? `npm-only|${rt.namespace}|npm:${item.pkg}`
        : null
    if (cacheKey) {
      const cached = readLatestCache(cacheKey, ctx.ttlMin)
      if (cached) {
        applyProbe(item, cached)
      } else if (rt.remaining() > 0) {
        const budget = Math.max(1, rt.remaining())
        try {
          let value: LatestValue | null = null
          if (!entry && item.source === 'npm') {
            const latest = await d.npmLatest(item.pkg, Math.min(rt.timeoutMs, budget), rt.signal)
            value = { version: latest.version }
          } else if (entry?.source === 'npm' && entry.npm) {
            const latest = await d.npmLatest(entry.npm, Math.min(rt.timeoutMs, budget), rt.signal)
            value = { version: latest.version }
          } else if (item.source === 'github') {
            const m = /^github:([^#]+)/.exec(item.spec)
            if (m) {
              const latest = await d.githubLatestTag(m[1], Math.min(rt.timeoutMs, budget), rt.signal, rt.githubBudget)
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
}

// ---------- 安装 / 升级 ----------

/** 安装/升级路径可注入依赖（测试用；生产走真实实现）。Task 9 起事务注入走 `transaction`。 */
export interface InstallDeps extends Partial<MarketDeps> {
  npmVersion?: typeof npmVersion
  /** peer 兼容预检注入（Task 11）；缺省 = precheckNpmCompat */
  precheck?: typeof precheckNpmCompat
  /** 事务依赖注入（runner/预热/退避/tmpdir 等）；B3 预热统一走 transaction.warmPackument */
  transaction?: TransactionDeps
}

export interface InstallResult {
  id: string
  pkg: string
  spec: string
  version?: string
  sha?: string
  tag?: string
  /** 精确放行的构建脚本包名（未走放行 = []；ADR-0002） */
  buildApprovals: string[]
  /** pending 名单读不出时的全量兜底标记 */
  fallbackAllBuilds: boolean
  /** verify 阶段观察：装成纯依赖（无补丁层且不在 bundles）——只警告不回滚 */
  bundleWarning?: 'no-patch-layer'
  /** peer 兼容预检结果（null = 兼容或未检；Task 11） */
  compat?: CompatIssue | null
  /** github 源不做兼容预检的明示（Task 11） */
  compatSkipped?: 'github-source'
  needsRestart: true
  output: string
  /** 事务自愈动作（机器可断言 code + 给人看的 note） */
  healActions?: HealAction[]
}

/** 从 registry 收录条目安装（npm → 精确锁定最新版；github → 锁 HEAD SHA）。 */
export async function installFromRegistry(
  id: string,
  cfg: RegistryConfig = {},
  opts: { version?: string; forceIncompatible?: boolean } & RegistryRuntimeOptions = {},
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

/** 安装接口收窄（M1 Task 5）：社区条目（CommunityEntry）与主清单条目同型可装。 */
export type InstallableEntry = Pick<RegistryEntry, 'id' | 'source' | 'npm' | 'github'>

export async function installEntry(
  entry: InstallableEntry,
  cfg: RegistryConfig = {},
  opts: { version?: string; forceIncompatible?: boolean } & RegistryRuntimeOptions = {},
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
    // peer 兼容预检（Task 11，事务外 metadata 阶段；force = 用户已确认风险）。
    // 预检自身的元数据读取失败（网络错/404）不拦安装——视为未检，安装事务自有失败语义。
    let compat: CompatIssue | null = null
    try {
      compat = await (deps?.precheck ?? precheckNpmCompat)(pkg, version, {
        timeoutMs,
        signal: opts.signal,
      })
    } catch {
      compat = null
    }
    if (compat !== null && opts.forceIncompatible !== true) throw new IncompatibleError(compat)
    // 生产预热绑定：未注入时 B3 用 makeNpmWarmPackument（保留 timeout/signal、失败吞错）
    const result = await runProfileTransaction(
      { kind: 'install-npm', pkg, version, integrity: expectedIntegrity, signal: opts.signal },
      {
        ...deps?.transaction,
        warmPackument: deps?.transaction?.warmPackument ?? makeNpmWarmPackument(timeoutMs),
      },
    )
    if (!result.ok) throw new TransactionError(result)
    const notes = result.healActions.map((h) => h.note).filter((n) => n !== '')
    return {
      id: entry.id,
      pkg: result.pkg ?? pkg,
      spec: result.spec ?? `${pkg}@${version}`,
      version: result.version ?? version,
      buildApprovals: result.buildApprovals ?? [],
      fallbackAllBuilds: result.fallbackAllBuilds === true,
      ...(result.bundleWarning ? { bundleWarning: result.bundleWarning } : {}),
      compat: compat ?? null,
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
      deps?.transaction ?? {},
    )
    if (!result.ok) throw new TransactionError(result)
    const notes = result.healActions.map((h) => h.note).filter((n) => n !== '')
    return {
      id: entry.id,
      pkg: result.pkg ?? entry.github,
      spec: result.spec ?? `github:${entry.github}#${sha}`,
      sha: result.sha ?? sha,
      tag: result.tag ?? tag,
      buildApprovals: result.buildApprovals ?? [],
      fallbackAllBuilds: result.fallbackAllBuilds === true,
      ...(result.bundleWarning ? { bundleWarning: result.bundleWarning } : {}),
      compatSkipped: 'github-source',
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
  // 保护门（Task 12，grilling Q3）：dsh-m 自身与官方宿主命脉拒绝卸载（升级不受影响）
  if (pkg === 'dsh-m' || PROTECTED_MODULES.includes(pkg)) {
    throw new Error(
      `拒绝卸载受保护插件: ${pkg}（dsh-m 自身或官方宿主命脉）。如确需移除，请使用官方插件管理页或 dsh plugin CLI`,
    )
  }
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
  opts: { forceIncompatible?: boolean } & RegistryRuntimeOptions = {},
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
