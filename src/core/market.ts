/**
 * 市场查询层（读侧）：registry × profile × 最新版本 → 市场列表（服务端分页）/ 已装列表。
 * 安装语义见 DESIGN.md §3（npm 精确锁定、GitHub 锁 SHA）。
 * Task 3：服务端 query/category/offset/limit 过滤；只对当前页查 latest（并发 ≤8、
 * TTL cache、共享全局 deadline）；unavailable 返回结构化空页；host/cli namespace 贯穿。
 * 2026-09-05 回滚缺陷加固：B1 成功路径保留 manifest 顶层未知键（如 pnpm.overrides）、
 * 失败路径字节级回滚后 frozen 自愈阶梯（overrides 对齐 → no-frozen 重建，B2）、
 * 新发布后 NO_MATCHING_VERSION 的退避重试 + packument 预热（B3）。
 * 2026-10-24（ADR-0024）：安装/卸载/升级/自升级写侧整段迁出 src/core/market-mutation.ts，
 * 本文件只留读侧查询与探测缓存；mutation 成功后的定向失效经本文件导出的
 * invalidateLatestForEntry（只失效不回写）。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHome, webProfileDir, WEB_PROFILE } from './env.js'
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
import { attachInstalledIconDataUris } from './installed-icon.js'
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
  type LoadedCommunity,
} from './community.js'
// 0.9.68（ADR-0016）：合并层迁入 merged-market.ts（communityOutcome/mergeRegistries/communitySummary/
// deadlineRace/matchInstalledByEntry/isCommunityEntry/COMMUNITY_CATEGORY_LABELS）——market↔community
// import 环自此断开；re-export 保既有消费方（tools.ts 的类型、profile-ops 的 matchInstalledByEntry）零改动。
import {
  communityOutcome,
  communityTimeoutSummary,
  withFallbackLookups,
  deadlineRace,
  isCommunityEntry,
  matchInstalledByEntry,
  mergedOutcome,
  GITHUB_SPEC_RE,
  type CommunityRegistrySummary,
  type MergedOutcome,
} from './merged-market.js'
// ADR-0024：对 merged-market 的转手 re-export 已删除（communityOutcome / matchInstalledByEntry /
// CommunityRegistrySummary 等）——消费方直连 merged-market.js；本文件仅在上方 import 中自用。
import type { CommunityEntry } from './community-adapter.js'
import { normalizeSearchText, relevanceScore, tokenizeSearchText } from './search-relevance.js'
import { GithubBudgetExhaustedError, createGithubRequestBudget, githubLatestTag as rawGithubLatestTag, isExactVersion, type GithubBudget } from './versions.js'
import { classifyUpgradeActivation, type ActivationClassification } from './activation.js'
import { HttpError } from './httpx.js'
import { ensureLatestCacheSwept, invalidateLatestCache, latestCacheKey, latestItemId, peekLatestCache, readLatestCache, writeLatestCache, type LatestValue } from './latest-cache.js'
import { verifyInstalledAdditions, type GuardViolation } from './install-guard.js'
import { journalExternalOperation, type OperationChannel, type AppendExternalOperation } from './external-journal.js'
import { readPnpmLockIntegrity } from './npm-integrity.js'
import { isGenerationProjectionPkg } from './generation-projection.js'
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

// 0.9.68：CommunityRegistrySummary / CommunityOutcome / MergeRegistriesResult 迁入 merged-market.ts
// （本文件经上方 export type {...} from 转发，既有消费方零改动）。

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
  /** 探测两态（0.9.45 市场页两段加载，ADR-0013）：缺省 'full' 行为不变（缓存新鲜直用 + 未命中/
   *  过期 inline 探测）；'cache-only' 只回 TTL 内缓存命中、零网络，有缺口 → latestComplete=false
   *  （缺口判定豁免社区 github 条目——Q46 永久缺口不构成第二段理由）。
   *  force（非 cache-only 模式）：peek 旧值兜底 + 全页重探——不走 ttlMin=0（ADR-0006 在案约束：
   *  先删后探失败会丢旧值）；重探成功覆盖缓存，失败保留旧值 + latestError。 */
  probeMode?: 'full' | 'cache-only'
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
  /** 本机声明图标 data URI（ADR-0025：官方 iconOf 语义自读；仅详情路径 icon:true 时产出） */
  iconDataUri?: string | null
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

/** 探测全局 deadline 缺省（毫秒）；ADR-0024 起供 market-mutation 跨模块取用。 */
export const DEFAULT_DEADLINE_MS = 60_000
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

// ---------- latest TTL cache ----------
// 0.9.20：纯内存 TTL 缓存（ADR-0006，推翻 0.9.14 的落盘跨重启存活——重启即失效是特性）；
// mutation 成功后的定向失效走 invalidateLatestForEntry（只失效不回写）。

/** 0.9.20 ①：install/upgrade/uninstall 成功点调用的定向失效——registry 真值交给下一次探测。ADR-0024 起供 market-mutation 跨模块调用。 */
export function invalidateLatestForEntry(namespace: RegistryCacheNamespace | undefined, entry: Pick<RegistryEntry, 'source' | 'npm' | 'github' | 'id'>): void {
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

// ---------- 已装索引（FP5 2026-10-15：toMarketItem 逐页线性扫描 → 每查询一次 O(1) 查表） ----------

interface OrdInst {
  inst: InstalledPlugin
  ord: number
}

/** 三域 first-wins 索引：与 matchInstalledByEntry 逐点等价（论证同 ADR-0016 决策 5 lookupInIndex——数组序中首个命中任一准则者 = 三域首现 + 跨域取 ord 最小）。 */
interface InstalledIndex {
  byPkg: Map<string, OrdInst>
  byName: Map<string, OrdInst>
  byGithub: Map<string, OrdInst>
}

function buildInstalledIndex(installedItems: InstalledPlugin[]): InstalledIndex {
  const byPkg = new Map<string, OrdInst>()
  const byName = new Map<string, OrdInst>()
  const byGithub = new Map<string, OrdInst>()
  installedItems.forEach((inst, ord) => {
    const slot = { inst, ord }
    if (!byPkg.has(inst.pkg)) byPkg.set(inst.pkg, slot)
    if (!byName.has(inst.name)) byName.set(inst.name, slot)
    if (inst.source === 'github') {
      const m = GITHUB_SPEC_RE.exec(inst.spec)
      if (m && !byGithub.has(m[1])) byGithub.set(m[1], slot)
    }
  })
  return { byPkg, byName, byGithub }
}

/** 三候选（byPkg[npm] / byName[npm] / byGithub[github]，truthiness 守卫与旧谓词一致）取 ord 最小者胜。 */
function lookupInstalledByIndex(index: InstalledIndex, entry: Pick<RegistryEntry, 'npm' | 'github'>): InstalledPlugin | undefined {
  const candidates: OrdInst[] = []
  if (entry.npm) {
    const byPkg = index.byPkg.get(entry.npm)
    if (byPkg) candidates.push(byPkg)
    const byName = index.byName.get(entry.npm)
    if (byName) candidates.push(byName)
  }
  if (entry.github) {
    const byRepo = index.byGithub.get(entry.github)
    if (byRepo) candidates.push(byRepo)
  }
  if (candidates.length === 0) return undefined
  let best = candidates[0]
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].ord < best.ord) best = candidates[i]
  }
  return best.inst
}

/** 合并条目 → MarketItem：社区条目带 community 标记与旁路字段。 */
function toMarketItem(entry: RegistryEntry | CommunityEntry, installedIndex: InstalledIndex): MarketItem {
  const inst = lookupInstalledByIndex(installedIndex, entry)
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
    d.listInstalledPlugins(opts.profileDir, { patchRows: false }).catch(() => null)
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
  // 0.9.68（ADR-0016）：改经物化合并市场——同身份（registry 代 + 目录 version）命中即免 adapt+merge，
  // summary 仍由当次 state 现算；失败/deadline/unavailable/disabled/task=null 形态透传不落代。
  const community: MergedOutcome = await mergedOutcome({
    namespace,
    profile: opts.profile ?? WEB_PROFILE,
    cfg,
    registry: loaded,
    communityTask,
    deadlineAt,
  })

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
  // 0.9.68（ADR-0016 决策 7，score-once）：类别不匹配先短路（不付评分成本），terms 非空时
  // 单遍评分并记入 scoreByEntry——rank 阶段查表，不再对每条目二次调用 relevanceScore。
  // tie-break 取 afterSort 之后的位置，与 0.9.67 语义逐点一致（评审 R1-4）。
  const scoreByEntry = new Map<RegistryEntry | CommunityEntry, number>()
  const filtered = zoned.filter((entry) => {
    const also = (entry as RegistryEntry).alsoCategories ?? []
    if (cat && entry.category !== cat && !also.includes(cat as RegistryEntry['category'])) return false
    if (terms.length === 0) return true
    const score = relevanceScore(entry, terms)
    if (score <= 0) return false
    scoreByEntry.set(entry, score)
    return true
  })
  // 排序：显式 sort 先行；query 命中时相关性优先（稳定 tie-break 回到既有序——merged 现序或用户排序）
  const afterSort = opts.sort ? sortEntries(filtered, opts.sort) : filtered
  const ranked =
    terms.length > 0
      ? afterSort
          .map((entry, idx) => ({ entry, score: scoreByEntry.get(entry)!, idx }))
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

  // 0.9.68（ADR-0016 决策 5 同款思路，FP5 2026-10-15）：已装索引每查询建一次，页内条目 O(1) 查表
  const installedIndex = buildInstalledIndex(installedItems)
  const items: MarketItem[] = ordered.slice(offset, offset + limit).map((entry) => toMarketItem(entry, installedIndex))

  let latestComplete = true
  let latestTimedOut = false
  if (withLatest && items.length > 0) {
    // 0.9.20：latest 缓存纯内存（ADR-0006）——探测段前仅一次性清扫 0.9.14 遗留磁盘信封
    await ensureLatestCacheSwept({ namespace, profile: opts.profile })
    // 0.9.45 探测两态（ADR-0013）：'full'（缺省，行为不变）| 'cache-only'（两段加载第一段：零网络）
    const mode = opts.probeMode ?? 'full'
    // force（P2，ADR-0013）：peek 旧值兜底 + 全页重探——不走 ttlMin=0（ADR-0006 在案约束：
    // 先删后探失败会丢旧值）；重探成功覆盖缓存，失败保留旧值 + latestError，无空徽标窗口
    const forceProbe = mode !== 'cache-only' && opts.force === true
    const ttlMin = Math.max(0, cfg.cacheTtlMin ?? 60)
    // 先吃 cache 命中（force 用 peek：不判 TTL、不删除）
    for (const item of items) {
      const key = latestCacheKey(namespace, loaded.configuredAddress, item)
      const cached = forceProbe ? peekLatestCache(key) : readLatestCache(key, ttlMin)
      if (cached) applyProbe(item, cached)
    }
    if (mode === 'cache-only') {
      // 两段加载第一段：零网络；缺口判定镜像 todo 豁免（社区 github 永不探测 → 不构成第二段理由，Q46）
      const gap = items.some(
        (it) =>
          it.latestVersion === undefined &&
          it.latestTag === undefined &&
          it.latestSha === undefined &&
          !(it.community === true && it.source === 'github'),
      )
      latestComplete = !gap
    } else {
      const todo = items.filter(
        (it) =>
          // Q46 探测边界：社区 github 条目不做浏览页 REST 探测（配额不可控）；社区 npm 条目照常
          !(it.community === true && it.source === 'github') &&
          // force：全页重探（缓存内旧值仅作兜底展示）；常态：仅未命中条目
          (forceProbe || (it.latestVersion === undefined && it.latestTag === undefined && it.latestSha === undefined)),
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
    }
    // outdated 判定统一在 probe 后进行（0.9.45：cache-only 也执行——暖缓存不丢「可升级」徽标）
    // 0.9.68（ADR-0016 决策 5 / 评审 R1-7）：pkg→installed 查表，页内 O(1) 取代逐项 find
    // first-wins：与旧 installedItems.find 逐点一致（正常枚举无重复 pkg，理论边界防御）
    const instByPkg = new Map<string, typeof installedItems[number]>()
    for (const inst of installedItems) if (!instByPkg.has(inst.pkg)) instByPkg.set(inst.pkg, inst)
    for (const item of items) {
      const inst = item.installedPkg !== undefined ? instByPkg.get(item.installedPkg) : undefined
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

// ---------- 批量 id 存在性（FP2 2026-10-15：收藏 stale 检测批量化） ----------

export interface ExistingMarketIdsOptions {
  namespace?: RegistryCacheNamespace
  profile?: string
  signal?: AbortSignal
  force?: boolean
  deadlineMs?: number
}

/**
 * 批量 id 存在性（收藏 stale 检测专用，FP2）：一次装载 registry+社区、经物化合并市场（L2，
 * 同身份与 listMarket 共享代）对 **merged 域**（主清单 + 存活社区条目，不含 displaced——与
 * 今日 source:'all' 搜索域一致）建原始 id Set，按输入序过滤返回。
 *
 * 三不原则（与 listMarket 的接口差异，也是性能来源）：不枚举已装、不探测 latest、不分页。
 *
 * 语义对照（旧路径 = 逐收藏 `market {query:id, source:'all', limit:8, probeMode:'cache-only'}`
 * + items.some(id)）：除一处自觉差异外逐点一致——**curatedFirst 挤出边界**：旧搜索页路径在
 * primary 域同字段全词命中 ≥limit 条时会把 id-exact 的社区条目挤出前 8（误判 stale），本接口
 * 的 Set 判定在该边界判 live（=「已从目录消失」的正确语义），属修复而非回归，勿改回搜索页行为。
 *
 * 失败语义：registry 装载 reject → 原样抛出（host-api 统一 500 → 客户端 catch 空 Set 全 stale，
 * 与今日 market 同路径等价）；deadline 逃逸 → `{ present: [] }`（同今日超时空页 → 全 stale）；
 * 社区 unavailable/disabled → merged=primary-only → 社区收藏判 stale（同今日）。
 */
export async function existingMarketIds(
  ids: string[],
  cfg: RegistryConfig = {},
  opts: ExistingMarketIdsOptions = {},
  deps?: Partial<Pick<MarketDeps, 'loadRegistry' | 'fetchCommunityCatalog'>>,
): Promise<{ present: string[] }> {
  const list = Array.isArray(ids) ? ids : []
  if (list.length === 0) return { present: [] }
  const d: Pick<MarketDeps, 'loadRegistry' | 'fetchCommunityCatalog'> = {
    loadRegistry: deps?.loadRegistry ?? defaultLoadRegistry,
    fetchCommunityCatalog: deps?.fetchCommunityCatalog ?? defaultFetchCommunityCatalog,
  }
  const deadlineMs = typeof opts.deadlineMs === 'number' && Number.isFinite(opts.deadlineMs) && opts.deadlineMs > 0
    ? opts.deadlineMs
    : DEFAULT_DEADLINE_MS
  const deadlineAt = Date.now() + deadlineMs
  const namespace = opts.namespace ?? 'host'
  const signal = opts.signal

  const registryTask = d.loadRegistry(cfg, { namespace, signal, force: opts.force, deadlineMs, profile: opts.profile })
  const communityTask = d.fetchCommunityCatalog(cfg, { namespace, signal, force: opts.force, profile: opts.profile })

  let loaded: LoadedRegistry | 'deadline'
  try {
    loaded = await deadlineRace(registryTask, deadlineAt - Date.now())
  } catch (err) {
    void communityTask.catch(() => undefined)
    throw err
  }
  if (loaded === 'deadline') {
    void communityTask.catch(() => undefined)
    return { present: [] }
  }
  const community = await mergedOutcome({
    namespace,
    profile: opts.profile ?? WEB_PROFILE,
    cfg,
    registry: loaded,
    communityTask,
    deadlineAt,
  })
  const knownIds = new Set(community.merged.map((entry) => entry.id))
  const present = list
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id !== '' && knownIds.has(id))
  return { present }
}

// ---------- 已装列表 ----------

export async function listInstalledWithMeta(
  cfg: RegistryConfig = {},
  opts: RegistryRuntimeOptions & { deadlineMs?: number; force?: boolean; profileDir?: string; probeMode?: 'full' | 'none' | 'only'; icon?: boolean } = {},
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
  // ADR-0025：声明图标读盘仅限显式 icon:true 的详情路径（'installedUpdates' 与市场查询热路径豁免，
  // 全局约束 4）。置于 registry deadline 判定之前——两条返回臂都消费同一 items。
  if (opts.icon) await attachInstalledIconDataUris(items)

  let loaded: LoadedRegistry | 'deadline'
  try {
    loaded = await deadlineRace(registryTask, remaining())
  } catch {
    loaded = 'deadline'
  }

  // 0.9.68（ADR-0016）：registry 正常时经物化合并市场（同身份免 adapt+merge + 匹配查表）；
  // registry deadline 降级路径身份残缺（primary=[]、fetchedAt 未知），走无 memo 的 communityOutcome，不进 L2。
  const community: MergedOutcome = loaded === 'deadline'
    ? withFallbackLookups(await communityOutcome(communityTask, deadlineAt, []))
    : await mergedOutcome({
        namespace,
        profile: opts.profile ?? WEB_PROFILE,
        cfg,
        registry: loaded,
        communityTask,
        deadlineAt,
      })

  if (loaded === 'deadline' || loaded.status === 'unavailable') {
    // registry 不可用：不做 matching/探测（原行为），但社区 summary 照常携带（CLI outdated 双源判定）
    const registryState = loaded === 'deadline' ? timeoutRegistryState(cfg) : stateOf(loaded)
    void community.merged
    return { items, others: installed.others, profileDir: installed.profileDir, registryState, community: community.summary }
  }

  const registryState = stateOf(loaded)

  matchInstalled(items, community.merged, community.lookupInstalled)
  // 两段加载（ADR-0008）：probeMode 控制探测段——缺省 'full' 行为不变；'none' 面板快列表跳过探测；
  // 'only' 面板第二段 ttlMin=0 永远新鲜（readLatestCache(key,0) 先删共享条目再重探：host ns 下浏览页/
  // 工具的 TTL 命中被刷新为更新值，预算消耗速率上升、上限不变，超限走 latestError 降级）。
  if ((opts.probeMode ?? 'full') !== 'none') {
    // 0.9.20：latest 缓存纯内存（ADR-0006）——探测段前仅一次性清扫 0.9.14 遗留磁盘信封
    await ensureLatestCacheSwept({ namespace, profile: opts.profile })
    await probeLatest(items, { merged: community.merged, lookup: community.lookupInstalled, registryAddress: loaded.configuredAddress, ttlMin: opts.probeMode === 'only' ? 0 : Math.max(0, cfg.cacheTtlMin ?? 60) }, d, { namespace, signal, githubBudget, remaining, timeoutMs: cfg.timeoutMs ?? 20_000 })
  }

  return { items, others: installed.others, profileDir: installed.profileDir, registryState, community: community.summary }
}

/** matching（主+社区合并条目）：命中主条目或社区条目都写 registryId；社区命中再标 community。 */
function matchInstalled(
  items: InstalledItem[],
  merged: Array<RegistryEntry | CommunityEntry>,
  lookup?: (item: InstalledItem) => RegistryEntry | CommunityEntry | undefined,
): void {
  for (const item of items) {
    // 0.9.68（ADR-0016 决策 5）：mergedOutcome.lookupInstalled 查表 O(I)；缺省回退线性扫描保旧调用面
    const entry = lookup ? lookup(item) : merged.find((e) => matchInstalledByEntry(e, [item]))
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
  ctx: { merged: Array<RegistryEntry | CommunityEntry>; registryAddress: string | null; ttlMin: number; lookup?: (item: InstalledItem) => RegistryEntry | CommunityEntry | undefined },
  d: MarketDeps,
  rt: { namespace: RegistryCacheNamespace; signal?: AbortSignal; githubBudget: GithubBudget; remaining: () => number; timeoutMs: number },
): Promise<void> {
  await mapWithConcurrency(items, LATEST_WORKERS, async (item) => {
    const entry = ctx.lookup ? ctx.lookup(item) : ctx.merged.find((e) => matchInstalledByEntry(e, [item]))
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

