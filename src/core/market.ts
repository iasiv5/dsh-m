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
  COMMUNITY_CATEGORY_LABELS,
  fetchCommunityCatalog as defaultFetchCommunityCatalog,
  type CommunityCatalogState,
  type CommunityStatus,
  type LoadedCommunity,
} from './community.js'
import { adaptCommunityCatalog, type CommunityEntry } from './community-adapter.js'
import { normalizeSearchText, relevanceScore, tokenizeSearchText } from './search-relevance.js'
import { GithubBudgetExhaustedError, createGithubRequestBudget, githubLatestTag as rawGithubLatestTag, isExactVersion, type GithubBudget } from './versions.js'
import { classifyUpgradeActivation, type ActivationClassification } from './activation.js'
import { HttpError } from './httpx.js'
import { ensureLatestCacheSwept, invalidateLatestCache, latestCacheKey, latestItemId, readLatestCache, writeLatestCache, type LatestValue } from './latest-cache.js'
import { verifyInstalledAdditions, type GuardViolation } from './install-guard.js'
import { readPnpmLockIntegrity } from './npm-integrity.js'
import type { CompensateEvidence, PriorUnion, TransactionResult } from './profile-transaction.js'
import { decodeUtf8Fatal, fetchTextLimited } from './httpx.js'
import {
  githubLatestTag as defaultGithubLatestTag,
  isNewerVersion,
  npmLatest as defaultNpmLatest,
  npmVersion,
} from './versions.js'

// ---------- 契约类型 ----------

export type RegistryRuntimeOptions = {
  /** Host API / Agent tools 固定 host；独立 CLI 固定 cli */
  namespace?: RegistryCacheNamespace
  /** 缓存 profile 段（0.9.0 双 profile；默认 web=旧路径，行为零漂移） */
  profile?: string
  signal?: AbortSignal
}

/**
 * latestError 结构化 code（M1 Task 7 / v8 ⑥）：预算拒绝、GitHub 限流、超时、其他网络错误
 * 各自归类——三端按 code 呈现安全化原因，禁止「未完成检查」冒充「全部最新」。
 */
export type LatestErrorCode = 'budget-exhausted' | 'rate-limited' | 'timeout' | 'network-error'

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
  /** 0.7.0 Task 1 社区 bypass 扩展（同 CommunityEntry 契约：缺失不产生键）：
   * owner 供 byline；added 收录日期排序；deprecated/replacement 前瞻字段 truthy 判断缺失不渲染；
   * install 上游安装命令原文；downloadsStart/End/CheckedAt 下载量窗口三要素；
   * version 目录快照（仅 latestError 兜底展示，带「目录快照」标注，不参与 outdated 判定）。 */
  owner?: string
  added?: string
  deprecated?: true
  replacement?: string
  install?: string
  downloadsStart?: string
  downloadsEnd?: string
  downloadsCheckedAt?: string
  version?: string
}

/** 开放分类计数：策展五桶恒在 + 社区开放 slug 键（M1 Task 5；0.9.16 策展分类法替换功能五分类）。 */
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
  /** 社区分类中文标签单一事实源（0.7.0 Task 4）：status 非 disabled/skipped 时携带；
   *  客户端 market-state.js 的内嵌副本随 Task 8 删除。 */
  categoryLabels?: Record<string, string>
  /** 社区分类英文标签（i18n）：取上游目录 categories.en（双语目录自带；缺 en 的 id 不进映射，
   *  客户端按界面语言取用并回退中文标签）；仅 ready 且上游携带 categories 时与 categoryLabels 同行携带。 */
  categoryLabelsEn?: Record<string, string>
}

export interface MarketQuery extends RegistryRuntimeOptions {
  query?: string
  /** 已装态枚举目标 profile 目录（0.9.0 双 profile；缺省 = webProfileDir()） */
  profileDir?: string
  /** 精选 5 分类或社区开放分类 slug（host-api 层校验安全 slug；core 侧原样匹配） */
  category?: string | null
  /** 分区过滤（0.7.0 Task 2 / ADR-0004）：'primary'=只主清单（社区 loader 零调用，summary=skipped）、
   *  'community'=只社区条目（排除与主清单重复的 displaced 条目）、缺省 'all' 合并视图。 */
  source?: 'primary' | 'community' | 'all'
  /** 显式排序（0.7.0 Task 2）：不传维持 merged 现序（primary=策展序、community=downloads 降序）。
   *  downloads 排序下无计数 ≠ 0（无数据恒排有数据之后，组内 stars 降序）；stars 缺失视为 -1；added 缺失视为最旧。 */
  sort?: { field: 'downloads' | 'stars' | 'added'; dir: 'asc' | 'desc' }
  /** GUI 跨区搜索稳定前置（0.9.26）：仅 host-api GUI 通道传入。source='all' 且 query 非空时精选命中
   *  稳定前置（分区内相关序不变，社区命中随后）——摘要行全局计数与首页所见一致，弱命中精选不被
   *  downloads tie-break 埋进后页。tools/CLI 不传 → 搜索排序契约不变（三端同序）；单分区/浏览态天然无效。 */
  curatedFirst?: boolean
  offset?: number
  /** core 按 withLatest hard clamp：true 最大 96（0.7.0 Task 7），false 最大 80 */
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
  /** filtered 集合（分区 ∩ query ∩ category）按 community 标记分桶（0.9.25 跨区搜索摘要行数据源） */
  sourceCounts: { primary: number; community: number }
  registryState: RegistryState
  installedComplete: boolean
  latestComplete: boolean
  latestTimedOut: boolean
  /** 社区清单状态 summary（M1 Task 5；source='primary' → skipped，配置关闭 → disabled） */
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
  /** 结构化 code（Task 7 ⑨）：非空 = 该条检查未完成（三端按 code 呈现，不冒充「全部最新」） */
  latestErrorCode?: LatestErrorCode
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
/** withLatest 上限 = 96（0.7.0 Task 7：50→96，opt-in 页大小；默认页 24、0.9.28 起 32，探测负载仍低于 0.6.x 默认 50——
 * 96/页冷缓存最坏情况被 60s deadline 框死为 latestError 不阻塞列表，Q46「探测对象=页面条目」不动；
 * 人工验收阈值：96/页冷缓存 latestError > 20% 即回退默认页大小并重议）。 */
const WITH_LATEST_MAX = 96
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
  return { essentials: 0, 'cui-picks': 0, 'self-dev': 0, 'tencent-lighthouse': 0, watchlist: 0 }
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
// 0.9.20：纯内存 TTL 缓存（ADR-0006，推翻 0.9.14 的落盘跨重启存活——重启即失效是特性）；
// mutation 成功后的定向失效走 invalidateLatestForEntry（只失效不回写）。

/** 0.9.20 ①：install/upgrade/uninstall 成功点调用的定向失效——registry 真值交给下一次探测。 */
function invalidateLatestForEntry(namespace: RegistryCacheNamespace | undefined, entry: Pick<RegistryEntry, 'source' | 'npm' | 'github' | 'id'>): void {
  invalidateLatestCache(namespace ?? 'host', latestItemId(entry))
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

/** probe 错误 → 结构化 code（Task 7 ⑨）：预算/限流/超时/其他网络错误各自归类，不得一律归因预算。 */
function classifyLatestError(err: unknown): LatestErrorCode {
  if (err instanceof GithubBudgetExhaustedError) return 'budget-exhausted'
  if (err instanceof HttpError && err.status === 403) return 'rate-limited'
  if (err instanceof Error && /限额已用尽/.test(err.message)) return 'rate-limited'
  return 'network-error'
}

/** 0.9.8 导出（原模块私有）：desktopUpgrade 的「已装 ↔ 收录条目」匹配与 web upgradePlugin 同语义。 */
export function matchInstalledByEntry(entry: Pick<RegistryEntry, 'npm' | 'github'>, installed: InstalledPlugin[]): InstalledPlugin | undefined {
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

function communitySummary(
  state: CommunityCatalogState,
  counts: Partial<CommunityRegistrySummary>,
  extraWarnings: string[],
  categoryLabelsEn?: Record<string, string>,
): CommunityRegistrySummary {
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
    // 标签单一事实源（0.7.0 Task 4）：disabled/skipped 下无社区数据语义，不携带；
    // EN 标签（i18n）随行携带，仅在调用方传入非空映射时出现（缺省 = 上游无 categories 数据）
    ...(state.status !== 'disabled' && state.status !== 'skipped'
      ? {
          categoryLabels: { ...COMMUNITY_CATEGORY_LABELS },
          ...(categoryLabelsEn && Object.keys(categoryLabelsEn).length > 0
            ? { categoryLabelsEn: { ...categoryLabelsEn } }
            : {}),
        }
      : {}),
  }
}

function disabledCommunitySummary(): CommunityRegistrySummary {
  return communitySummary(
    { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] },
    {},
    [],
  )
}

/** 查询层主动跳过（0.7.0 Task 2：source='primary'）：本次未加载社区层，非配置关闭、非故障。 */
function skippedCommunitySummary(): CommunityRegistrySummary {
  return communitySummary(
    { enabled: true, status: 'skipped', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] },
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
 * 共享 flight 照常继续。source='primary'/未启用 → loader 零调用（task 传 null → skipped；
 * 配置关闭走真任务的 disabled 分支，与跳过语义分离）。
 * 导出供 community.ts getCommunitySummary 复用（summary 组装单一产地）。
 */
export async function communityOutcome(
  task: Promise<LoadedCommunity> | null,
  deadlineAt: number,
  primary: RegistryEntry[],
): Promise<CommunityOutcome> {
  if (!task) return { summary: skippedCommunitySummary(), merged: primary }
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
  // EN 分类标签（i18n）：直接取上游目录 categories.en——上游新增分类自动跟进，
  // 缺 en 的 id 不进映射（客户端按语言取用并回退中文标签，不在此处手养第二张表）
  const categoryLabelsEn = Object.fromEntries(
    Object.entries(loaded.catalog.categories)
      .map(([id, c]) => [id, typeof c?.en === 'string' && c.en !== '' ? c.en : ''])
      .filter(([, en]) => en !== ''),
  )
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
    categoryLabelsEn,
  )
  return { summary, merged: merge.items }
}

function isCommunityEntry(entry: RegistryEntry | CommunityEntry): entry is CommunityEntry {
  return (entry as CommunityEntry).descriptionEn !== undefined
}

/** 旁路数值/日期读取（RegistryEntry 无这些键 → null/''；0.7.0 Task 2 排序用）。 */
function dlOf(e: RegistryEntry | CommunityEntry): number | null {
  const v = (e as CommunityEntry).downloads
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function starsOf(e: RegistryEntry | CommunityEntry): number {
  const v = (e as CommunityEntry).stars
  return typeof v === 'number' && Number.isFinite(v) ? v : -1
}

function addedOf(e: RegistryEntry | CommunityEntry): string {
  const v = (e as CommunityEntry).added
  return typeof v === 'string' ? v : ''
}

/**
 * 分区排序（0.7.0 Task 2）：`dir` 只翻转有数据的比较，**不翻转「无数据垫底」语义**——
 * downloads 无计数 ≠ 0（无数据者恒排有数据者之后，组内按 stars 降序再 name）；
 * stars 缺失视为 -1、added 缺失视为最旧（空串日期），两者参与正常比较随 dir 翻转。
 */
function sortEntries(
  entries: Array<RegistryEntry | CommunityEntry>,
  sort: { field: 'downloads' | 'stars' | 'added'; dir: 'asc' | 'desc' },
): Array<RegistryEntry | CommunityEntry> {
  const dirMul = sort.dir === 'asc' ? 1 : -1
  const nameCmp = (a: RegistryEntry | CommunityEntry, b: RegistryEntry | CommunityEntry) =>
    String(a.name).localeCompare(String(b.name))
  return entries.slice().sort((a, b) => {
    if (sort.field === 'downloads') {
      const da = dlOf(a)
      const db = dlOf(b)
      if (da !== null && db !== null) return (da - db) * dirMul || nameCmp(a, b)
      if (da !== null) return -1
      if (db !== null) return 1
      return starsOf(b) - starsOf(a) || nameCmp(a, b)
    }
    if (sort.field === 'stars') {
      const diff = starsOf(a) - starsOf(b)
      return diff * dirMul || nameCmp(a, b)
    }
    const aa = addedOf(a)
    const ab = addedOf(b)
    return (aa < ab ? -1 : aa > ab ? 1 : 0) * dirMul || nameCmp(a, b)
  })
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
    item.owner = entry.owner
    if (entry.added !== undefined) item.added = entry.added
    if (entry.deprecated !== undefined) item.deprecated = entry.deprecated
    if (entry.replacement !== undefined) item.replacement = entry.replacement
    if (entry.install !== undefined) item.install = entry.install
    if (entry.downloadsStart !== undefined) item.downloadsStart = entry.downloadsStart
    if (entry.downloadsEnd !== undefined) item.downloadsEnd = entry.downloadsEnd
    if (entry.downloadsCheckedAt !== undefined) item.downloadsCheckedAt = entry.downloadsCheckedAt
    if (entry.version !== undefined) item.version = entry.version
  }
  return item
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
  // 分区归一（0.7.0 Task 2）：非法值一律按 'all'
  const source: 'primary' | 'community' | 'all' =
    opts.source === 'primary' || opts.source === 'community' ? opts.source : 'all'
  const withLatest = opts.withLatest !== false
  const maxLimit = withLatest ? WITH_LATEST_MAX : METADATA_ONLY_MAX
  const signal = opts.signal
  const remaining = () => deadlineAt - Date.now()

  const registryTask = d.loadRegistry(cfg, { namespace, signal, force: opts.force, deadlineMs, profile: opts.profile })
  const installedTask: Promise<Awaited<ReturnType<MarketDeps['listInstalledPlugins']>> | null> =
    d.listInstalledPlugins(opts.profileDir).catch(() => null)
  // 社区 flight 并发启动（source=primary 零调用；0.7.0 Task 7：primaryOnly 字段已删除）；共享 loader 不接收调用者 deadline——
  // listMarket 作为 waiter 在 communityOutcome 内 race 自己的剩余 deadline/signal（v10 契约）
  const communityTask =
    source === 'primary' ? null : d.fetchCommunityCatalog(cfg, { namespace, signal, force: opts.force, profile: opts.profile })

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
      sourceCounts: { primary: 0, community: 0 },
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

  // 分区过滤 + 全量统计 + query/category 过滤 + 分页（同步，极轻；0.7.0 Task 2）：
  // categoryCounts = 分区集合（不含 query/category 过滤——chips 需要全区计数）；
  // total = 分区 ∩ query ∩ category。
  const merged = community.merged
  const zoned =
    source === 'community'
      ? merged.filter(isCommunityEntry)
      : source === 'primary'
        ? merged.filter((entry) => !isCommunityEntry(entry))
        : merged
  const counts: CategoryCounts = zeroCounts()
  for (const entry of zoned) {
    counts[entry.category] = (counts[entry.category] ?? 0) + 1
    // 0.9.17 次级策展桶：跨桶条目在每个归属桶里都计一次（Σcounts 可大于去重总数）；
    // 社区条目无 alsoCategories（开放集 string），cast 到 RegistryEntry 侧读取
    const also = (entry as RegistryEntry).alsoCategories
    for (const extra of also ?? []) {
      counts[extra] = (counts[extra] ?? 0) + 1
    }
  }
  const cat = opts.category ?? null
  // 相关性搜索（0.7.0 Task 3）：归一化分词 + 字段加权评分；0 分不返回；
  // id 整串精确匹配保证命中（收藏 stale 检测依赖）。
  const terms = tokenizeSearchText(normalizeSearchText(opts.query ?? ''))
  const filtered = zoned.filter((entry) => {
    const also = (entry as RegistryEntry).alsoCategories ?? []
    if (cat && entry.category !== cat && !also.includes(cat as RegistryEntry['category'])) return false
    if (terms.length === 0) return true
    return relevanceScore(entry, terms) > 0
  })
  // 排序：显式 sort 先行；query 命中时相关性优先（稳定 tie-break 回到既有序——merged 现序或用户排序）
  const afterSort = opts.sort ? sortEntries(filtered, opts.sort) : filtered
  const ranked =
    terms.length > 0
      ? afterSort
          .map((entry, idx) => ({ entry, score: relevanceScore(entry, terms), idx }))
          .sort((a, b) => b.score - a.score || a.idx - b.idx)
          .map((s) => s.entry)
      : afterSort
  // curatedFirst 稳定前置（0.9.26）：见 MarketQuery 注释——稳定分区不破坏分区内相关序
  const ordered =
    opts.curatedFirst === true && source === 'all' && terms.length > 0
      ? [...ranked.filter((entry) => !isCommunityEntry(entry)), ...ranked.filter(isCommunityEntry)]
      : ranked
  const total = ordered.length
  // sourceCounts 分桶（0.9.25 跨区搜索摘要行）：filtered（分区 ∩ query ∩ category）计数，与排序/分页无关
  const communityHitCount = filtered.reduce((n, entry) => n + (isCommunityEntry(entry) ? 1 : 0), 0)
  const sourceCounts = { primary: filtered.length - communityHitCount, community: communityHitCount }
  const limit = clampLimit(opts.limit, maxLimit)
  let offset = normalizeOffset(opts.offset)
  if (total > 0 && offset >= total) offset = Math.floor((total - 1) / limit) * limit

  const items: MarketItem[] = ordered.slice(offset, offset + limit).map((entry) => toMarketItem(entry, installedItems))

  let latestComplete = true
  let latestTimedOut = false
  if (withLatest && items.length > 0) {
    // 0.9.20：latest 缓存纯内存（ADR-0006）——探测段前仅一次性清扫 0.9.14 遗留磁盘信封
    await ensureLatestCacheSwept({ namespace, profile: opts.profile })
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
        for (const item of todo) {
          item.latestError = '更新检查未完成：时间预算已用尽'
          item.latestErrorCode = 'timeout'
        }
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
            item.latestError = '更新检查未完成：超时'
            item.latestErrorCode = 'timeout'
            latestComplete = false
            latestTimedOut = true
          } else if (outcome.error !== undefined) {
            if (signal?.aborted) throw abortError()
            item.latestError = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
            item.latestErrorCode = classifyLatestError(outcome.error)
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
    sourceCounts,
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
  opts: RegistryRuntimeOptions & { deadlineMs?: number; force?: boolean; profileDir?: string; probeMode?: 'full' | 'none' | 'only' } = {},
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

  const installedPromise = d.listInstalledPlugins(opts.profileDir)
  const registryTask = d.loadRegistry(cfg, { namespace, signal, force: opts.force, deadlineMs, profile: opts.profile })
  // 社区 flight 并发启动 + request-scoped GitHub 预算（本次检查 ≤25 个 wire 请求、宿主滚动 50/h）
  const communityTask = d.fetchCommunityCatalog(cfg, { namespace, signal, force: opts.force, profile: opts.profile })
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
  // 两段加载（ADR-0008）：probeMode 控制探测段——缺省 'full' 行为不变；'none' 面板快列表跳过探测；
  // 'only' 面板第二段 ttlMin=0 永远新鲜（readLatestCache(key,0) 先删共享条目再重探：host ns 下浏览页/
  // 工具的 TTL 命中被刷新为更新值，预算消耗速率上升、上限不变，超限走 latestError 降级）。
  if ((opts.probeMode ?? 'full') !== 'none') {
    // 0.9.20：latest 缓存纯内存（ADR-0006）——探测段前仅一次性清扫 0.9.14 遗留磁盘信封
    await ensureLatestCacheSwept({ namespace, profile: opts.profile })
    await probeLatest(items, { merged: community.merged, registryAddress: loaded.configuredAddress, ttlMin: opts.probeMode === 'only' ? 0 : Math.max(0, cfg.cacheTtlMin ?? 60) }, d, { namespace, signal, githubBudget, remaining, timeoutMs: cfg.timeoutMs ?? 20_000 })
  }

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
    // latest 探测沿用 listMarket 的 TTL cache；npm-only 条目（不在收录清单的已装包）也走
    // latestCacheKey 归一格式（0.9.14：否则首段非 host/cli 会被落盘层静默跳过）
    const cacheKey = entry
      ? latestCacheKey(rt.namespace, ctx.registryAddress ?? '', entry)
      : item.source === 'npm'
        ? latestCacheKey(rt.namespace, 'npm-only', { source: 'npm', id: item.pkg, npm: item.pkg })
        : null
    if (cacheKey) {
      const cached = readLatestCache(cacheKey, ctx.ttlMin)
      if (cached) {
        applyProbe(item, cached)
      } else if (rt.remaining() > 0) {
        // 绝对剩余预算贯穿整个 probe（多跳 githubLatestTag 不逐子请求重置——v9 ②）
        const budget = rt.remaining()
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
          item.latestErrorCode = classifyLatestError(err)
        }
      } else {
        // deadline 已到且未启动：标未完成并停止派发（v9 ②「未启动条目也标未完成」）
        item.latestError = '更新检查未完成：时间预算已用尽'
        item.latestErrorCode = 'timeout'
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
  /** GitHub candidate key 预解析注入（M2 Task 3 测试用；缺省 = 真实抓取 pinned package.json） */
  candidateKey?: typeof candidateKeyOf
  /** peer 兼容预检注入（Task 11）；缺省 = precheckNpmCompat */
  precheck?: typeof precheckNpmCompat
  /** 生效判定注入（0.9.22 测试用；缺省 = classifyUpgradeActivation，npm 源升级成功点调用） */
  classifyActivation?: (pkg: string, fromVersion: string, toVersion: string) => Promise<ActivationClassification>
  /** 事务依赖注入（runner/预热/退避/tmpdir 等）；B3 预热统一走 transaction.warmPackument */
  transaction?: TransactionDeps
  /** 目标 profile 目录（0.9.0 双 profile；缺省 webProfileDir()；transaction.profileDir 优先） */
  profileDir?: string
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
  /** 守卫 fail-open：结论不可定的包放行时的警告（M2 Task 3） */
  guardWarning?: string
  /** peer 兼容预检结果（null = 兼容或未检；Task 11） */
  compat?: CompatIssue | null
  /** github 源不做兼容预检的明示（Task 11） */
  compatSkipped?: 'github-source'
  /** 变更完成需重启宿主生效。0.9.22 源头放宽 boolean：TS 禁止派生接口放宽属性（TS2430），UpgradeResult 纯客户端更新覆写 false；生产方语义不变（install/uninstall/self-upgrade 恒 true）。 */
  needsRestart: boolean
  output: string
  /** 事务自愈动作（机器可断言 code + 给人看的 note） */
  healActions?: HealAction[]
}

/** 从 registry 收录条目安装（npm → 精确锁定最新版；github → 锁 HEAD SHA）。
 *  0.7.1 修复：合并市场展示的社区条目 id 不在主清单（loadRegistry 只装载主清单，
 *  社区层只合入 listMarket 展示）——主清单 miss 时按收录 id 查社区目录再装，
 *  与 0.5.1 升级路径（findCommunityUpgradeEntry）同构。 */
/**
 * 按收录 id 解析可安装条目（0.9.0 Task 5 抽出）：主清单优先，社区目录兜底。
 * installFromRegistry 与 Desktop adapter（profile-ops）共用同一解析与错误文案。
 */
export async function resolveRegistryEntry(
  id: string,
  cfg: RegistryConfig = {},
  opts: { version?: string; forceIncompatible?: boolean } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallableEntry> {
  const loaded = await (deps?.loadRegistry ?? defaultLoadRegistry)(cfg, { namespace: opts.namespace ?? 'host', profile: opts.profile })
  if (loaded.status === 'unavailable') {
    throw new Error(`收录清单不可用，无法安装 ${id}；请检查 registry 配置或网络后重试`)
  }
  const entry =
    loaded.registry.plugins.find((e) => e.id === id) ??
    (await findCommunityInstallEntry(id, cfg, opts, deps))
  if (!entry) throw new Error(`registry 中没有该条目: ${id}`)
  return entry
}

export async function installFromRegistry(
  id: string,
  cfg: RegistryConfig = {},
  opts: { version?: string; forceIncompatible?: boolean } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallResult> {
  const entry = await resolveRegistryEntry(id, cfg, opts, deps)
  return installEntry(entry, cfg, opts, deps)
}

/** 安装接口收窄（M1 Task 5）：社区条目（CommunityEntry）与主清单条目同型可装。 */
export type InstallableEntry = Pick<RegistryEntry, 'id' | 'source' | 'npm' | 'github'>

// ---------- M2 Task 3：统一 mutation session + 装后守卫 + 补偿接线 ----------

let sessionTail: Promise<unknown> = Promise.resolve()

/**
 * 统一 mutation 串行区间（模块级 FIFO，非重入）：包住全部五个 profile mutation 入口
 * （installFromRegistry / upgradePlugin / uninstallPlugin / selfUpgrade / toggle）。
 * session 单点获取——只在 core façade 获取（toggle 在 togglePlugin 本体），host-api/tools/CLI
 * 层不得重复获取（session 非重入，多层重复获取会死锁）。锁序：mutation session 外层 →
 * toggle file lock / 事务 FIFO 内层。
 */
export async function withMutationSession<T>(fn: () => Promise<T>): Promise<T> {
  const run = sessionTail.then(
    () => fn(),
    () => fn(),
  )
  sessionTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** 守卫拦截的结构化错误（非成功状态）：三端按 kind/needsRestart/restartSafe 渲染，无 force 通道。 */
export class InstallGuardError extends Error {
  readonly kind: 'compensated' | 'manual_required'
  readonly violations: GuardViolation[]
  readonly needsRestart: boolean
  readonly restartSafe: boolean
  /** 补偿终态摘要（rolled-back/manual-repair/rejected 的 note） */
  readonly compensation: { status: string; note: string }
  /** manual-repair 的修复依据（旧 manifestSpec/installSpec/mapping） */
  readonly repairBasis?: string

  constructor(fields: {
    kind: 'compensated' | 'manual_required'
    message: string
    violations: GuardViolation[]
    needsRestart: boolean
    restartSafe: boolean
    compensation: { status: string; note: string }
    repairBasis?: string
  }) {
    super(fields.message)
    this.name = 'InstallGuardError'
    this.kind = fields.kind
    this.violations = fields.violations
    this.needsRestart = fields.needsRestart
    this.restartSafe = fields.restartSafe
    this.compensation = fields.compensation
    this.repairBasis = fields.repairBasis
  }
}

export interface PreMutationSnapshot {
  deps: Record<string, string>
  lockResolutions: Record<string, { version?: string; integrity?: string; commit?: string }>
  mapping: { workspace: Array<{ key: string; patchPath: string }>; manifest: Array<{ key: string; patchPath: string }> }
}

/** lockfile packages 段的目标包 resolution 提取（行扫描：键行 `pkg@ver:` → 收集至下一键行；引号/嵌套键兼容）。 */
function lockResolutionOf(lockText: string, pkg: string): { version?: string; integrity?: string; commit?: string } | null {
  // 只扫顶层 packages: 段（importer 段的同名键不参与；packages: 后条目缩进两空格）
  const pkgsAt = lockText.split('\n').findIndex((l) => l.trim() === 'packages:')
  if (pkgsAt < 0) return null
  const lines = lockText.split('\n').slice(pkgsAt + 1)
  let body: string[] | null = null
  for (const line of lines) {
    if (body !== null && /^\S/.test(line)) break // 顶层新段 → 收集结束
    // 0.5.1 修复：收尾引号必须可选消耗——pnpm lockfile 对 scoped 包键恒带引号
    //（`'@scope/name@1.2.3':`），旧正则匹配不到任何带引号键，导致 scoped 已装插件
    // 的 lockResolution 恒为 null → derivePrior 误判 restorable:false → 升级被守卫硬拒。
    const keyMatch = /^  '?(?:[^'\n]*node_modules\/)?([^\s':]+)'?:\s*$/.exec(line)
    if (keyMatch) {
      if (body) break
      const key = keyMatch[1] ?? ''
      if (key === pkg || key.startsWith(`${pkg}@`)) body = []
      continue
    }
    if (body) body.push(line)
  }
  if (body === null) return null
  const text = body.join('\n')
  const version = /version:\s*'?([^'\n]+)/.exec(text)?.[1]?.trim()
  // 0.5.1：integrity 捕获排除 flow 结尾（`,`/`}`/引号）——与 npm-integrity.ts parsePackagesSection
  // 同口径；旧 `(\S+)` 会把 `{integrity: sha512-...}` 的收尾 `}` 一起带进 prior 证据。
  const integrity = /integrity:\s*([^,}\s'"]+)/.exec(text)?.[1]?.trim()
  const commit = /commit:\s*'?([0-9a-f]{40})/.exec(text)?.[1]?.trim()
  if (!version && !integrity && !commit) return null
  return { ...(version ? { version } : {}), ...(integrity ? { integrity } : {}), ...(commit ? { commit } : {}) }
}

/** 变更前全量快照（v6）：deps / lock resolutions / 双落点 mapping。读取失败 → unavailable（fail-closed 拒绝安装）。 */
export async function capturePreMutationState(profileDir: string): Promise<{ kind: 'unavailable'; reason: string } | { kind: 'snapshot'; snapshot: PreMutationSnapshot }> {
  try {
    // manifest ENOENT = 无已装依赖的空 profile（与 guard readDeps 同语义）；其他读取/解析失败 → fail-closed
    let manifestText = ''
    try {
      manifestText = await readFile(join(profileDir, 'package.json'), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    const doc = manifestText
      ? (JSON.parse(manifestText) as { dependencies?: unknown; pnpm?: { patchedDependencies?: unknown } })
      : {}
    const deps: Record<string, string> = {}
    if (doc.dependencies && typeof doc.dependencies === 'object' && !Array.isArray(doc.dependencies)) {
      for (const [name, spec] of Object.entries(doc.dependencies as Record<string, unknown>)) {
        if (typeof spec === 'string') deps[name] = spec
      }
    }
    const manifestMapping: Array<{ key: string; patchPath: string }> = []
    const patched = doc.pnpm?.patchedDependencies
    if (patched && typeof patched === 'object' && !Array.isArray(patched)) {
      for (const [key, patchPath] of Object.entries(patched as Record<string, unknown>)) {
        if (typeof patchPath === 'string') manifestMapping.push({ key, patchPath })
      }
    }
    let lockText = ''
    try {
      lockText = await readFile(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
    } catch {
      lockText = ''
    }
    const lockResolutions: PreMutationSnapshot['lockResolutions'] = {}
    for (const name of Object.keys(deps)) {
      const res = lockResolutionOf(lockText, name)
      if (res) lockResolutions[name] = res
    }
    const workspaceMapping: Array<{ key: string; patchPath: string }> = []
    try {
      const ws = await readFile(join(profileDir, 'pnpm-workspace.yaml'), 'utf8')
      const inBlock = /^patchedDependencies:/m
      if (inBlock.test(ws)) {
        const section = ws.split(/^patchedDependencies:/m)[1]?.split(/^\S/m)?.[0] ?? ''
        for (const line of section.split('\n')) {
          const m = /^\s+'?([^':]+)'?:\s*(\S+)/.exec(line)
          if (m) workspaceMapping.push({ key: m[1]!.trim(), patchPath: m[2]!.trim() })
        }
      }
    } catch {
      /* 无 workspace 文件 = 无 workspace mapping */
    }
    return { kind: 'snapshot', snapshot: { deps, lockResolutions, mapping: { workspace: workspaceMapping, manifest: manifestMapping } } }
  } catch (err) {
    return { kind: 'unavailable', reason: err instanceof Error ? err.message : String(err) }
  }
}

/** mapping 条目按真实 key 精确关联（key === realKey 或版本化 key `realKey@x`）；不按 repo/id/相似名猜。 */
function mappingFor(mapping: { workspace: Array<{ key: string; patchPath: string }>; manifest: Array<{ key: string; patchPath: string }> }, realKey: string) {
  const pick = (rows: Array<{ key: string; patchPath: string }>) => rows.filter((r) => r.key === realKey || r.key.startsWith(`${realKey}@`))
  return { workspace: pick(mapping.workspace), manifest: pick(mapping.manifest) }
}

/**
 * prior 派生（add 返回真实 key 后、守卫前）：严格按真实 key 关联快照；判定表唯一映射。
 * 来源白名单（独立实现，不复用 parseSpecSource）：精确 npm version（含 ^/~ 书写）与
 * pinned github commit + lock identity 可自动恢复；alias/workspace/tarball URL/git+ssh/link/file 一律 restorable:false。
 */
export function derivePrior(
  snapshot: PreMutationSnapshot,
  realKey: string,
): { kind: 'none' } | { kind: 'mappingOnly'; patchMapping: { workspace: Array<{ key: string; patchPath: string }>; manifest: Array<{ key: string; patchPath: string }> } } | { kind: 'dependency'; state: PriorStateExport } | { kind: 'unavailable'; reason: string } {
  const spec = snapshot.deps[realKey]
  const mapping = mappingFor(snapshot.mapping, realKey)
  if (spec === undefined) {
    if (mapping.workspace.length > 0 || mapping.manifest.length > 0) {
      return { kind: 'mappingOnly', patchMapping: mapping }
    }
    return { kind: 'none' }
  }
  const lock = snapshot.lockResolutions[realKey] ?? null
  let sourceKind: 'npm' | 'github' | 'other' = 'other'
  let restorable = false
  if (isExactVersion(spec)) {
    sourceKind = 'npm'
    restorable = Boolean(lock?.integrity)
  } else if (/^[~^]\d/.test(spec) && isExactVersion(spec.slice(1))) {
    // ^/~ 锚定（0.4.x 旧 CLI 书写）：恢复后接受规范化并明示
    sourceKind = 'npm'
    restorable = Boolean(lock?.integrity)
  } else if (/^github:[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+#[0-9a-f]{40}$/.test(spec)) {
    sourceKind = 'github'
    restorable = Boolean(lock?.commit)
  }
  return {
    kind: 'dependency',
    state: {
      manifestSpec: spec,
      installSpec: spec,
      resolvedVersion: lock?.version,
      sourceKind,
      ...(lock?.integrity ? { integrity: lock.integrity } : {}),
      ...(lock ? { lockResolution: lock } : {}),
      patchMapping: mapping,
      restorable,
    },
  }
}

interface PriorStateExport {
  manifestSpec: string
  installSpec: string
  resolvedVersion?: string
  sourceKind: 'npm' | 'github' | 'other'
  integrity?: string
  lockResolution?: { version?: string; integrity?: string; commit?: string }
  patchMapping: { workspace: Array<{ key: string; patchPath: string }>; manifest: Array<{ key: string; patchPath: string }> }
  restorable: boolean
}

/** GitHub candidate preflight：只读抓取 pinned SHA 的 package.json 解析 name（预算外 read-only 通道，不写 profile）。 */
async function candidateKeyOf(repo: string, sha: string, timeoutMs: number): Promise<string | null> {
  const text = await fetchTextLimited(`https://raw.githubusercontent.com/${repo}/${sha}/package.json`, { timeoutMs, maxBytes: 512 * 1024 })
  const doc = JSON.parse(text) as { name?: unknown }
  return typeof doc.name === 'string' && doc.name.trim() !== '' ? doc.name.trim() : null
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 补偿执行 + InstallGuardError 抛出（四态 → needsRestart/restartSafe 映射；rejected 复读 profile 实况）。 */
async function throwCompensated(args: {
  pkg: string
  guard: Awaited<ReturnType<typeof verifyInstalledAdditions>>
  deps?: TransactionDeps
  evidence: CompensateEvidence
  prior: ReturnType<typeof derivePrior>
}): Promise<never> {
  const { pkg, guard, deps, evidence, prior } = args
  const violations = guard.violations
  const violationText = violations.map((v) => `${v.code}: ${v.detail}`).join('；')
  let comp: TransactionResult
  const priorForTx: PriorUnion =
    prior.kind === 'mappingOnly'
      ? { kind: 'mappingOnly', patchMapping: prior.patchMapping }
      : prior.kind === 'dependency'
        ? { kind: 'dependency', state: prior.state }
        : { kind: 'none' }
  try {
    comp = await runProfileTransaction(
      { kind: 'compensate-install', pkg, evidence, prior: priorForTx },
      deps,
    )
  } catch (err) {
    throw new InstallGuardError({
      kind: 'manual_required',
      message: `安装违例（${violationText}），补偿事务执行异常：${err instanceof Error ? err.message : String(err)}——需人工处理`,
      violations,
      needsRestart: true,
      restartSafe: false,
      compensation: { status: 'manual-repair', note: errText(err) },
    })
  }
  if (comp.ok) {
    // committed(fresh/restore) + 补偿验证完整 → 可一键重启
    throw new InstallGuardError({
      kind: 'compensated',
      message: `安装违例（${violationText}），已${prior.kind === 'dependency' ? '恢复原版本' : '自动卸载'}（补偿事务 committed）`,
      violations,
      needsRestart: true,
      restartSafe: true,
      compensation: { status: 'committed', note: comp.output },
      ...(prior.kind === 'dependency' ? { repairBasis: `prior: ${prior.state.manifestSpec}（${prior.state.resolvedVersion ?? 'version 未知'}）` } : {}),
    })
  }
  const status = comp.status
  const note = comp.failure?.note ?? ''
  if (status === 'rejected') {
    // 复读 profile 实况决定 restartSafe（不因零写入直接 false）
    let pkgStillThere = false
    try {
      const now = await capturePreMutationState(deps?.profileDir ?? webProfileDir())
      pkgStillThere = now.kind === 'snapshot' && pkg in now.snapshot.deps
    } catch {
      pkgStillThere = true
    }
    throw new InstallGuardError({
      kind: 'compensated',
      message: `安装违例（${violationText}），补偿未执行（profile 状态已变化：${note}）`,
      violations,
      needsRestart: pkgStillThere,
      restartSafe: !pkgStillThere,
      compensation: { status: 'rejected', note },
    })
  }
  if (status === 'rolled-back') {
    throw new InstallGuardError({
      kind: 'compensated',
      message: `安装违例（${violationText}），补偿未完成：已回到补偿前状态，坏包可能仍在，需人工处理（${note}）`,
      violations,
      needsRestart: true,
      restartSafe: false,
      compensation: { status: 'rolled-back', note },
    })
  }
  // manual-repair：状态未知；post-add 兜底场景附修复依据，任何端不显示「已恢复原版本/已安装成功」
  throw new InstallGuardError({
    kind: 'manual_required',
    message: `安装违例（${violationText}），补偿进入 manual-repair：需人工处理（${note}）`,
    violations,
    needsRestart: true,
    restartSafe: false,
    compensation: { status: 'manual-repair', note },
    ...(prior.kind === 'dependency'
      ? { repairBasis: `旧 manifestSpec=${prior.state.manifestSpec}；installSpec=${prior.state.installSpec}；mapping=${JSON.stringify(prior.state.patchMapping)}` }
      : prior.kind === 'mappingOnly'
        ? { repairBasis: `旧 mapping=${JSON.stringify(prior.patchMapping)}` }
        : {}),
  })
}

function guardManualRequired(message: string, violations: GuardViolation[]): InstallGuardError {
  // 零副作用：未进 mutation → needsRestart=false、restartSafe=false
  return new InstallGuardError({
    kind: 'manual_required',
    message,
    violations,
    needsRestart: false,
    restartSafe: false,
    compensation: { status: 'pre-mutation', note: '未开始变更，profile 零写入' },
  })
}

export async function installEntry(
  entry: InstallableEntry,
  cfg: RegistryConfig = {},
  opts: { version?: string; forceIncompatible?: boolean } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallResult> {
  return withMutationSession(() => installEntryLocked(entry, cfg, opts, deps))
}

/** installEntry 主体（session 区间内）。入口约定：installFromRegistry 走 installEntry（获取 session）；
 *  upgradePlugin 已持有 session，必须直调本函数——二次获取 session 会自死锁（session 非重入）。 */
async function installEntryLocked(
  entry: InstallableEntry,
  cfg: RegistryConfig = {},
  opts: { version?: string; forceIncompatible?: boolean } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallResult> {
  const timeoutMs = cfg.timeoutMs ?? 20_000
  const profileDir = deps?.transaction?.profileDir ?? deps?.profileDir ?? webProfileDir()
  const d = {
    npmLatest: deps?.npmLatest ?? defaultNpmLatest,
    npmVersion: deps?.npmVersion ?? npmVersion,
  }
  if (entry.source === 'npm' && entry.npm) {
    const pkg = entry.npm
    // 变更前全量快照（unavailable → fail-closed，零写入）
    const pre = await capturePreMutationState(profileDir)
    if (pre.kind === 'unavailable') {
      throw new Error(`变更前状态捕获失败：${pre.reason}；拒绝安装（fail-closed）`)
    }
    // npm key 事务前已知：prior 派生与 restorable 检查在事务前完成
    const prior = derivePrior(pre.snapshot, pkg)
    if (prior.kind === 'unavailable') {
      throw new Error(`prior 关联歧义：${prior.reason}；拒绝安装（fail-closed）`)
    }
    if (prior.kind === 'dependency' && !prior.state.restorable) {
      throw guardManualRequired(
        `「${pkg}」的原安装形态（${prior.state.sourceKind === 'other' ? 'link/file 等非 registry 来源' : 'pnpm-lock.yaml 未解析出该依赖的 integrity（键缺失或为别名/URL 等非 registry 写法）'}）无法自动回退，请先手动处理（卸载或修复后重试）`,
        [{ pkg, code: 'NO_DSH_MARKER', detail: `prior restorable:false（sourceKind=${prior.state.sourceKind}）` }],
      )
    }
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
    // 装后守卫（session 区间内；fail-open 仅限结论不可定）
    const guard = await verifyInstalledAdditions({
      profileDir,
      addedPkgs: [result.pkg ?? pkg],
      ...(prior.kind === 'dependency' ? { priorPkgs: [pkg] } : {}),
    })
    if (guard.unavailable.length > 0) {
      // 0.9.20 ①：事务已 committed（守卫不可定 fail-open 亦是成功态）→ 定向作废该条目 latest 缓存
      invalidateLatestForEntry(opts.namespace, entry)
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
        output: result.output,
        healActions: result.healActions,
        guardWarning: `装后守卫不可用（${guard.unavailable.map((u) => u.reason).slice(0, 2).join('；')}），未执行三项检查——如异常请人工核查`,
      }
    }
    if (!guard.ok) {
      await throwCompensated({
        pkg: result.pkg ?? pkg,
        guard,
        deps: deps?.transaction,
        evidence: {
          source: 'npm',
          // manifestSpec = 安装后 manifest deps 值（pnpm add 写入裸 version）；validate 对当前 manifest 实读比对
          manifestSpec: result.version ?? version,
          resolvedVersion: result.version ?? version,
          integrity: expectedIntegrity ?? '',
        },
        prior,
      })
    }
    const notes = result.healActions.map((h) => h.note).filter((n) => n !== '')
    // 0.9.20 ①：安装成功 → 定向作废该条目 latest 缓存（只失效不回写，ADR-0006）
    invalidateLatestForEntry(opts.namespace, entry)
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
    // 变更前全量快照（fail-closed）
    const pre = await capturePreMutationState(profileDir)
    if (pre.kind === 'unavailable') {
      throw new Error(`变更前状态捕获失败：${pre.reason}；拒绝安装（fail-closed）`)
    }
    // candidate preflight（M2 Task 0 gate 已证明 name→key 映射）：只读抓取 pinned package.json；
    // 抓取失败/解析歧义 → fail-closed 拒绝安装（零写入）；candidate 命中 link/file 或 restorable:false
    // prior → mutation 前 GUARD_MANUAL_REQUIRED（runner.add 零调用）
    const { tag, sha } = await (deps?.githubLatestTag ?? defaultGithubLatestTag)(entry.github, timeoutMs, opts.signal)
    let candidate: string | null
    try {
      candidate = await (deps?.candidateKey ?? candidateKeyOf)(entry.github, sha, timeoutMs)
    } catch (err) {
      throw new Error(`GitHub candidate key 预解析失败（${entry.github}@${sha.slice(0, 7)}）：${err instanceof Error ? err.message : String(err)}；拒绝安装（fail-closed）`)
    }
    if (candidate === null || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(candidate)) {
      throw new Error(`GitHub candidate key 不可用（${candidate ?? 'name 缺失'}）：拒绝安装（fail-closed）`)
    }
    const candidatePrior = derivePrior(pre.snapshot, candidate)
    if (candidatePrior.kind === 'unavailable') {
      throw new Error(`prior 关联歧义：${candidatePrior.reason}；拒绝安装（fail-closed）`)
    }
    if (candidatePrior.kind === 'dependency' && !candidatePrior.state.restorable) {
      throw guardManualRequired(
        `「${candidate}」的原安装形态（pnpm-lock.yaml 未解析出该依赖的可回退依据——integrity/commit 缺失，或 link/file/别名等非 registry 写法）无法自动回退，请先手动处理（卸载或修复后重试）`,
        [{ pkg: candidate, code: 'NO_DSH_MARKER', detail: 'candidate 命中 restorable:false prior（lockfile 依据缺失）' }],
      )
    }
    const result = await runProfileTransaction(
      { kind: 'install-github', repo: entry.github, sha, tag, signal: opts.signal },
      deps?.transaction ?? {},
    )
    if (!result.ok) throw new TransactionError(result)
    const realKey = result.pkg ?? candidate
    // post-add derivePrior 复核（兜底网）：真实 key 与 candidate 不符且发现不可自动恢复 prior
    // → manual-repair 非成功状态（不冒充 pre-mutation 拒绝、不承诺 prior 无损）
    let prior = candidatePrior
    if (realKey !== candidate) {
      const real = derivePrior(pre.snapshot, realKey)
      if (real.kind === 'unavailable') {
        throw new Error(`prior 关联歧义（真实 key ${realKey}）：${real.reason}；拒绝继续（fail-closed）`)
      }
      if (real.kind === 'dependency' && !real.state.restorable) {
        throw new InstallGuardError({
          kind: 'manual_required',
          message: `安装违例后复核：真实 dependency key（${realKey}）与预解析 candidate（${candidate}）不符，且旧 prior 为 link/file 等不可自动恢复来源——旧 prior 可能已被覆盖，需人工恢复`,
          violations: [{ pkg: realKey, code: 'NO_DSH_MARKER', detail: 'candidate 与真实 key 不符且 prior restorable:false' }],
          needsRestart: true,
          restartSafe: false,
          compensation: { status: 'manual-repair', note: '真实 key ≠ candidate 且旧 prior 不可自动恢复' },
          repairBasis: `旧 manifestSpec=${real.state.manifestSpec}；installSpec=${real.state.installSpec}；mapping=${JSON.stringify(real.state.patchMapping)}`,
        })
      }
      if (real.kind !== 'none') prior = real
    }
    // 装后守卫
    const guard = await verifyInstalledAdditions({
      profileDir,
      addedPkgs: [realKey],
      ...(prior.kind === 'dependency' ? { priorPkgs: [realKey] } : {}),
    })
    if (guard.unavailable.length > 0) {
      // 0.9.20 ①：事务已 committed（守卫不可定 fail-open 亦是成功态）→ 定向作废该条目 latest 缓存
      invalidateLatestForEntry(opts.namespace, entry)
      const notes = result.healActions.map((h) => h.note).filter((n) => n !== '')
      return {
        id: entry.id,
        pkg: realKey,
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
        guardWarning: `装后守卫不可用（${guard.unavailable.map((u) => u.reason).slice(0, 2).join('；')}），未执行三项检查——如异常请人工核查`,
      }
    }
    if (!guard.ok) {
      // lock commit identity 从实际 pnpm-lock.yaml 解析（InstallResult.sha 是请求时期望值，非独立观测）
      const lockText = await readFile(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
      const lockCommit = lockResolutionOf(lockText, realKey)?.commit ?? sha
      await throwCompensated({
        pkg: realKey,
        guard,
        deps: deps?.transaction,
        evidence: { source: 'github', pinnedSpec: `github:${entry.github}#${sha}`, sha, lockCommitIdentity: lockCommit },
        prior,
      })
    }
    const notes = result.healActions.map((h) => h.note).filter((n) => n !== '')
    // 0.9.20 ①：安装成功 → 定向作废该条目 latest 缓存（只失效不回写，ADR-0006）
    invalidateLatestForEntry(opts.namespace, entry)
    return {
      id: entry.id,
      pkg: realKey,
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
export function uninstallPlugin(
  pkg: string,
  cfg: RegistryConfig = {},
  opts: RegistryRuntimeOptions = {},
  deps: UninstallDeps = {},
): Promise<UninstallResult> {
  return withMutationSession(() => uninstallPluginLocked(pkg, cfg, opts, deps))
}

async function uninstallPluginLocked(
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
  // 0.9.20 ①：卸载成功 → 尽力作废 npm-only 键（github 条目的 gh: 键无法由 pkg 名重构，
  // 交由 TTL 自然过期——卸载后已装列表无此条目，不存在「已装/最新」自相矛盾场景）
  invalidateLatestCache(opts.namespace ?? 'host', `npm:${pkg}`)
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
  /** 生效判定（0.9.22）：仅 npm 源升级产出；'client-only' 时 needsRestart 必为 false，'unknown' 保守为 true */
  activation?: ActivationClassification
}

/** 升级 = 按最新重新安装（npm 拉最新精确版；github 重新锁 HEAD）。 */
export function upgradePlugin(
  pkg: string,
  cfg: RegistryConfig = {},
  opts: { forceIncompatible?: boolean; profileDir?: string } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<UpgradeResult> {
  return withMutationSession(() => upgradePluginLocked(pkg, cfg, opts, deps))
}

async function upgradePluginLocked(
  pkg: string,
  cfg: RegistryConfig = {},
  opts: { forceIncompatible?: boolean; profileDir?: string } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<UpgradeResult> {
  const loaded = await (deps?.loadRegistry ?? defaultLoadRegistry)(cfg, { namespace: opts.namespace ?? 'host', profile: opts.profile })
  if (loaded.status === 'unavailable') {
    throw new Error(`收录清单不可用，无法升级 ${pkg}；请检查 registry 配置或网络后重试`)
  }
  const { items: installed } = await (deps?.listInstalledPlugins ?? defaultListInstalledPlugins)(opts.profileDir)
  const target = installed.find((it) => it.pkg === pkg)
  if (!target) throw new Error(`web profile 未安装该插件: ${pkg}`)
  let entry: InstallableEntry | undefined = loaded.registry.plugins.find((e) => matchInstalledByEntry(e, [target]))
  // 0.5.1：合并市场安装的社区条目同样可升级——主清单 miss 时查社区目录
  if (!entry) entry = await findCommunityUpgradeEntry(target, cfg, opts, deps)
  if (!entry) throw new Error(`「${pkg}」不是经 dsh-m 收录的插件；直接升级请用 dsh plugin update 或先在 registry 收录它`)
  // 0.5.1 修复：直调 installEntryLocked——upgradePlugin 已在 mutation session 区间内，
  // 再经 installEntry 二次获取 session 会自死锁（session 非重入，见 withMutationSession 契约）。
  const result = await installEntryLocked(entry, cfg, opts, deps)
  // 0.9.22 生效判定：npm 源升级在成功点分类；任何异常 fail-open 到 unknown，绝不影响升级成功态
  let activation: ActivationClassification | undefined
  let needsRestart = result.needsRestart
  if (entry.source === 'npm' && entry.npm && target.version && result.version) {
    try {
      activation = await (deps?.classifyActivation ?? classifyUpgradeActivation)(entry.npm, target.version, result.version)
      if (activation === 'client-only') needsRestart = false
    } catch {
      activation = 'unknown'
    }
  }
  return { ...result, fromVersion: target.version, needsRestart, ...(activation ? { activation } : {}) }
}

/**
 * 社区条目按收录 id 查找（0.7.1 安装修复）：合并市场展示的社区条目 id = 社区目录合成 id
 * （owner--name 等），主清单 miss 时按同一 id 查社区目录。社区清单未启用/不可用/加载
 * 异常/未命中 → undefined，由调用方统一报「registry 中没有该条目」。
 */
async function findCommunityInstallEntry(
  id: string,
  cfg: RegistryConfig,
  opts: RegistryRuntimeOptions,
  deps?: InstallDeps,
): Promise<InstallableEntry | undefined> {
  try {
    const loaded = await (deps?.fetchCommunityCatalog ?? defaultFetchCommunityCatalog)(cfg, { namespace: opts.namespace ?? 'host', signal: opts.signal, profile: opts.profile })
    if (!loaded.catalog) return undefined
    return adaptCommunityCatalog(loaded.catalog).entries.find((e) => e.id === id)
  } catch {
    return undefined
  }
}

/**
 * 社区条目升级查找（0.5.1）：主清单 miss 时按同一 matchInstalledByEntry 语义查社区目录。
 * 社区清单未启用/不可用/加载异常/未命中 → undefined，由调用方统一报「不是经 dsh-m 收录」。
 */
async function findCommunityUpgradeEntry(
  target: InstalledPlugin,
  cfg: RegistryConfig,
  opts: RegistryRuntimeOptions,
  deps?: InstallDeps,
): Promise<InstallableEntry | undefined> {
  try {
    const loaded = await (deps?.fetchCommunityCatalog ?? defaultFetchCommunityCatalog)(cfg, { namespace: opts.namespace ?? 'host', signal: opts.signal, profile: opts.profile })
    if (!loaded.catalog) return undefined
    const adapted = adaptCommunityCatalog(loaded.catalog)
    return adapted.entries.find((e) => matchInstalledByEntry(e, [target]))
  } catch {
    return undefined
  }
}

/** 自升级（0.5.0 收编：host-api 直调事务的旁路封死）：npmLatest + integrity fail-closed + installEntryLocked（session/守卫经 installEntry）。 */
export async function selfUpgrade(
  pkgName: string,
  currentVersion: string,
  cfg: RegistryConfig = {},
  opts: RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallResult> {
  return withMutationSession(async () => {
    const timeoutMs = cfg.timeoutMs ?? 20_000
    const latest = await (deps?.npmLatest ?? defaultNpmLatest)(pkgName, timeoutMs, opts.signal)
    if (!latest.integrity) {
      throw new Error(`npm metadata 缺少 dist integrity：${pkgName}@${latest.version}，拒绝升级`)
    }
    const result = await runProfileTransaction(
      { kind: 'install-npm', pkg: pkgName, version: latest.version, integrity: latest.integrity, signal: opts.signal },
      { ...(deps?.transaction ?? {}), warmPackument: deps?.transaction?.warmPackument ?? makeNpmWarmPackument(timeoutMs) },
    )
    if (!result.ok) throw new TransactionError(result)
    return {
      id: pkgName,
      pkg: result.pkg ?? pkgName,
      spec: result.spec ?? `${pkgName}@${latest.version}`,
      version: result.version ?? latest.version,
      buildApprovals: result.buildApprovals ?? [],
      fallbackAllBuilds: result.fallbackAllBuilds === true,
      ...(result.bundleWarning ? { bundleWarning: result.bundleWarning } : {}),
      needsRestart: true as const,
      output: result.output,
      healActions: result.healActions,
    }
  })
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
