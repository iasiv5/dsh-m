/**
 * 物化合并市场（Materialized Merged Market）——ADR-0016 v3。
 *
 * 「合并市场（Merged Market）」的拥有模块：adapt → merge → 匹配索引 一次性物化，
 * 按身份键探测驱动换代（namespace / profile / registry 身份 / 目录 version+pin+开关）。
 * 与 ADR-0006 的划界：物化的是**本地文件的派生数据**（失效键全部来自确定性文件身份），
 * 不是 latest 探测值——「重启即失效」不适用，身份变即整体重建、旧代自然淘汰。
 *
 * 结构（ADR-0016 决策 1/3/5/6）：
 * - L2 代存储：cap=4，代内只存随 version 稳定的 { merged, counts, adaptWarnings,
 *   categoryLabelsEn, mergedIndex, fullIndex }——**summary 永不入代**，每调用由当次
 *   state 现算（status/checkedAt/errors 永远新鲜，SWR 与⑫同版本短路零漂移）。
 * - 并发去重 = 同步临界区不变量：全部 await 位于键派生之前；键派生→查 store→
 *   adapt→merge→index→set 全同步（JS 单线程串行穿越，后来者必命中）。「只建一次」
 *   以 stats.builds 断言。临界区内禁止引入任何 await。
 * - 失败形态不落代：deadline 逃逸 / unavailable / disabled / task=null 一律透传现算。
 * - 双索引（R2-3）：mergedIndex 服务读路径（今日 merged.find 语义）；fullIndex
 *   （[primary..., adapt 全量...] 含 displaced 让位条目）服务安装/升级路径——id-让位
 *   条目今日可装可升，语义零变化。
 * - reject 语义（R2-2）：communityTask reject 透传（与今日 communityOutcome 同构）；
 *   读路径维持冒泡，安装/升级调用侧保留既有窄 try/catch。
 *
 * 迁入自 market.ts（0.9.68，解环）：communityOutcome、deadlineRace、mergeRegistries、
 * communitySummary 四形态、isCommunityEntry、matchInstalledByEntry；
 * 迁入自 community.ts：COMMUNITY_CATEGORY_LABELS（communitySummary 的值依赖，
 * community.ts 原位 re-export 保 cli/tools 零改动）。对 community.js 只用 import type。
 */
import type { RegistryCacheNamespace, RegistryConfig, RegistryEntry, LoadedRegistry } from './registry.js'
import type { CommunityCatalog, CommunityCatalogState, CommunityStatus, LoadedCommunity } from './community.js'
import { adaptCommunityCatalog, type CommunityEntry } from './community-adapter.js'
import type { InstalledPlugin } from './installed.js'

// ---------- 迁入：COMMUNITY_CATEGORY_LABELS（标签单一事实源，0.7.0 Task 4） ----------

/**
 * 上游 23 个分类 id 的全量中文标签（以 fixture `categories` 键为准逐条核对）。
 * 0.7.0 Task 4 改名导出 + 作为标签单一事实源：summary 层附带（communitySummary）、
 * GUI zoneChips 消费服务端数据，客户端内嵌副本（market-state.js）随 Task 8 删除。
 * 0.9.68 随 communitySummary 迁入本模块（ADR-0016 R1-2：不迁则环只是从
 * market↔community 平移为 merged-market↔community）；community.ts 原位 re-export。
 */
export const COMMUNITY_CATEGORY_LABELS: Record<string, string> = {
  agi: 'AGI 架构探索',
  ui: 'UI 增强',
  usage: '用量与计费',
  theme: '主题与外观',
  model: '模型与账号接入',
  identity: '身份与通信',
  session: '会话与消息',
  memory: '记忆',
  tools: '工具与能力',
  wsl: 'WSL 与 Windows 互操作',
  browser: '浏览器与网页',
  vision: '视觉与多模态',
  voice: '语音与音频',
  docs: '文档与渲染',
  skill: '技能包',
  workflow: '工作流与自动化',
  git: 'Git 与代码评审',
  notify: '通知与集成',
  dev: '开发与运行时',
  security: '安全与权限',
  remote: '远程与移动端',
  market: '插件市场与管理',
  fun: '娱乐',
}

// ---------- 迁入：deadlineRace（communityOutcome 的唯一 await 依赖；market.ts 反向值导入） ----------

export function deadlineRace<T>(task: Promise<T>, ms: number): Promise<T | 'deadline'> {
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

// ---------- 迁入：matchInstalledByEntry（0.9.8 导出：desktopUpgrade 与 web upgradePlugin 同语义） ----------

/** 「已装 ↔ 收录条目」匹配三准则：npm 名对 pkg / npm 名对 name / github spec 前缀（source 守卫）。 */
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

// ---------- 迁入：合并去重（Q41/Q45） ----------

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

// ---------- 迁入：summary 组装（单一产地；summary 永不入代——每调用现算） ----------

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

/** 导出（0.9.68 迁移配套）：market.ts 的 registry-deadline 分支直接取超时 summary（该分支社区 task 未启动）。 */
export { communityTimeoutSummary }

export interface CommunityOutcome {
  summary: CommunityRegistrySummary
  /** 合并后全量条目（主清单 + 存活社区条目）；社区不可用/未启用时 = 主清单原样 */
  merged: Array<RegistryEntry | CommunityEntry>
}

// ---------- 迁入：isCommunityEntry ----------

export function isCommunityEntry(entry: RegistryEntry | CommunityEntry): entry is CommunityEntry {
  return (entry as CommunityEntry).descriptionEn !== undefined
}

// ---------- 匹配索引（ADR-0016 决策 5：O(I×M) 扫描 → O(I) 查表；R2-3 双域；R2-6 source 守卫） ----------

interface OrdEntry {
  entry: RegistryEntry | CommunityEntry
  ord: number
}

interface MatchIndex {
  byNpm: Map<string, OrdEntry>
  byGithub: Map<string, OrdEntry>
  byId: Map<string, OrdEntry>
}

/** 单域首现索引：每键取序最前（min-ord）条目——等价于在该域上 find(matchInstalledByEntry) 的「第一条任一准则命中」。 */
function buildMatchIndex(domain: Array<RegistryEntry | CommunityEntry>): MatchIndex {
  const byNpm = new Map<string, OrdEntry>()
  const byGithub = new Map<string, OrdEntry>()
  const byId = new Map<string, OrdEntry>()
  domain.forEach((entry, ord) => {
    const slot = { entry, ord }
    if (entry.npm !== undefined && !byNpm.has(entry.npm)) byNpm.set(entry.npm, slot)
    if (entry.github !== undefined && !byGithub.has(entry.github)) byGithub.set(entry.github, slot)
    if (!byId.has(entry.id)) byId.set(entry.id, slot)
  })
  return { byNpm, byGithub, byId }
}

const GITHUB_SPEC_RE = /^github:([^#]+)/

/** 三候选（npm[pkg] / npm[name] / github[spec]（仅 source==='github'））取域序最前者胜——与 matchInstalledByEntry 逐点等价。 */
function lookupInIndex(index: MatchIndex, installed: InstalledPlugin): RegistryEntry | CommunityEntry | undefined {
  const candidates: OrdEntry[] = []
  const byPkg = index.byNpm.get(installed.pkg)
  if (byPkg) candidates.push(byPkg)
  const byName = index.byNpm.get(installed.name)
  if (byName) candidates.push(byName)
  if (installed.source === 'github') {
    const m = GITHUB_SPEC_RE.exec(installed.spec)
    const byRepo = m ? index.byGithub.get(m[1]) : undefined
    if (byRepo) candidates.push(byRepo)
  }
  if (candidates.length === 0) return undefined
  let best = candidates[0]
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].ord < best.ord) best = candidates[i]
  }
  return best.entry
}

// ---------- L2 代存储（探测驱动换代 + 同步临界区 + cap=4） ----------

/** 代内容：全部随 version 稳定（summary 永不入代）。 */
interface MergedGeneration {
  merged: Array<RegistryEntry | CommunityEntry>
  counts: { acceptedCount: number; upstreamCount: number; displaced: number; skippedDirty: number; skippedSubpathNoNpm: number }
  adaptWarnings: string[]
  categoryLabelsEn: Record<string, string>
  /** merged 域索引（读路径：今日 merged.find 语义） */
  mergedIndex: MatchIndex
  /** 全量域索引（[primary..., adapt 全量...] 含 displaced；安装/升级路径） */
  fullIndex: MatchIndex
}

const generations = new Map<string, MergedGeneration>()
const GENERATION_CAP = 4
const mergedStats = { builds: 0, hits: 0, evictions: 0 }

/** 测试钩子：清 L2 store 与 stats（latest-cache resetLatestCacheForTest 同款先例；测试隔离用）。 */
export function _resetMergedMarketForTests(): void {
  generations.clear()
  Object.assign(mergedStats, { builds: 0, hits: 0, evictions: 0 })
}

/** 测试钩子：builds/hits/evictions 计数（验收断言①②③的机器可断言信号）。 */
export function _mergedMarketStatsForTests(): { builds: number; hits: number; evictions: number } {
  return { ...mergedStats }
}

function rememberGeneration(key: string, gen: MergedGeneration): void {
  if (!generations.has(key) && generations.size >= GENERATION_CAP) {
    const oldest = generations.keys().next().value
    if (oldest !== undefined) {
      generations.delete(oldest)
      mergedStats.evictions += 1
    }
  }
  generations.set(key, gen)
}

/**
 * 身份键派生（探测驱动，R1-12 等价性：configuredAddress 即规范化地址，registry cacheKey
 * 是它的纯函数——default→DEFAULT_CACHE_KEY、否则 stableKey(url)）。调用点必须在
 * 全部 await 完成之后（同步临界区起点）。
 */
function identityKey(
  namespace: RegistryCacheNamespace,
  profile: string,
  cfg: Pick<RegistryConfig, 'communityCatalogPin' | 'communityCatalog'>,
  registry: LoadedRegistry,
  state: CommunityCatalogState,
): string {
  const pin = typeof cfg.communityCatalogPin === 'string' ? cfg.communityCatalogPin.trim() : ''
  return [
    namespace,
    profile,
    registry.configuredAddress,
    registry.fetchedAt ?? 'never',
    state.version ?? 'off',
    pin,
    cfg.communityCatalog === false ? 'off' : 'on',
  ].join('§')
}

/** 建代（全同步——adapt → merge → 双域索引；禁止引入 await：同步临界区不变量）。 */
function buildGeneration(primary: RegistryEntry[], catalog: CommunityCatalog): MergedGeneration {
  const adapted = adaptCommunityCatalog(catalog)
  const merge = mergeRegistries(primary, adapted.entries)
  const categoryLabelsEn = Object.fromEntries(
    Object.entries(catalog.categories)
      .map(([id, c]) => [id, typeof c?.en === 'string' && c.en !== '' ? c.en : ''])
      .filter(([, en]) => en !== ''),
  )
  return {
    merged: merge.items,
    counts: {
      acceptedCount: adapted.entries.length,
      upstreamCount: catalog.plugins.length,
      displaced: merge.displaced,
      skippedDirty: adapted.skippedDirty,
      skippedSubpathNoNpm: adapted.skippedSubpathNoNpm,
    },
    adaptWarnings: [...adapted.warnings, ...merge.warnings],
    categoryLabelsEn,
    mergedIndex: buildMatchIndex(merge.items),
    fullIndex: buildMatchIndex([...primary, ...adapted.entries]),
  }
}

// ---------- 迁入：communityOutcome（原样、无 memo；getCommunitySummary 与 registry-deadline 降级路径专用） ----------

/**
 * 社区 loader waiter 收敛（v9/v10 waiter-scoped 契约）：共享 flight 不接收调用者 deadline，
 * 本函数作为 waiter 用剩余 deadline race 自己的等待；到点只结束本 waiter（summary 标超时），
 * 共享 flight 照常继续。source='primary'/未启用 → loader 零调用（task 传 null → skipped；
 * 配置关闭走真任务的 disabled 分支，与跳过语义分离）。
 * 0.9.68 自 market.ts 迁入（ADR-0016）：签名与行为原样；community.ts getCommunitySummary
 * 与 listInstalledWithMeta 的 registry-deadline 降级路径继续消费本无 memo 形态。
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

// ---------- mergedOutcome：memoized 主入口 ----------

export interface MergedOutcome extends CommunityOutcome {
  /** O(1) 匹配（merged 域）：三候选取 merged 序最前者胜——等价今日 merged.find(matchInstalledByEntry)。 */
  lookupInstalled(installed: InstalledPlugin): RegistryEntry | CommunityEntry | undefined
  /** O(1) id 查询（全量域 [primary..., adapt 全量...] 含 displaced——id-让位条目今日可装，R2-3）。 */
  findById(id: string): RegistryEntry | CommunityEntry | undefined
  /** O(1) 匹配（全量域）：等价今日「先主清单 find 后社区 adapt 全量 find」的合成语义（R2-3）。 */
  lookupInstalledAll(installed: InstalledPlugin): RegistryEntry | CommunityEntry | undefined
}

/** 导出（0.9.68 接线配套）：给无 memo 的 communityOutcome 结果挂兜底 lookup（线性扫描，今日语义原样）——供降级路径（registry-deadline / settings 摘要等冷路径）取得与 mergedOutcome 同形的返回值。 */
export function withFallbackLookups(outcome: CommunityOutcome): MergedOutcome {
  return outcomeWithLookups(outcome, null, null)
}
// ↑ 兜底域 = outcome.merged（透传形态下为 primary-only，不含 displaced 让位条目）——只保证读路径
// lookupInstalled 等价；不得用于安装/升级路径（那里需要 findById/lookupInstalledAll 的全量域语义）。
// 现状唯一消费点 listInstalledWithMeta 的 registry-deadline 臂在消费 lookups 前即早返回，零行为影响。

function outcomeWithLookups(outcome: CommunityOutcome, mergedIndex: MatchIndex | null, fullIndex: MatchIndex | null): MergedOutcome {
  return {
    ...outcome,
    lookupInstalled: (installed) => (mergedIndex ? lookupInIndex(mergedIndex, installed) : matchInstalledByEntryFallback(outcome.merged, installed)),
    findById: (id) => (fullIndex ? fullIndex.byId.get(id)?.entry : outcome.merged.find((e) => e.id === id)),
    lookupInstalledAll: (installed) => (fullIndex ? lookupInIndex(fullIndex, installed) : matchInstalledByEntryFallback(outcome.merged, installed)),
  }
}

/** 透传形态（无代）的兜底：线性扫描（今日语义原样；仅 primary-only 域，量小）。 */
function matchInstalledByEntryFallback(domain: Array<RegistryEntry | CommunityEntry>, installed: InstalledPlugin): RegistryEntry | CommunityEntry | undefined {
  return domain.find((e) => matchInstalledByEntry(e, [installed]) !== undefined)
}

/**
 * memoized 主入口：内部 resolve communityTask → 派生身份键 → 查/建代。
 * 落代/读代：仅 community 正常 resolve 且 catalog 在场（ready|stale——同 version 内容恒等）；
 * deadline 逃逸 / unavailable / disabled / task=null → 透传现算（不读不写 store）。
 * reject 语义：透传（与 communityOutcome 同构），不做内部吞咽。
 */
export async function mergedOutcome(input: {
  namespace: RegistryCacheNamespace
  profile: string
  cfg: Pick<RegistryConfig, 'communityCatalogPin' | 'communityCatalog'>
  registry: LoadedRegistry
  communityTask: Promise<LoadedCommunity> | null
  deadlineAt: number
}): Promise<MergedOutcome> {
  const { registry, communityTask, deadlineAt } = input
  const primary = registry.registry.plugins
  if (!communityTask) {
    // source='primary'：loader 零调用，透传（今日语义）；主清单域小，索引免建
    return outcomeWithLookups(await communityOutcome(null, deadlineAt, primary), null, null)
  }
  let loaded: LoadedCommunity | 'deadline'
  try {
    loaded = await deadlineRace(communityTask, deadlineAt - Date.now())
  } finally {
    void communityTask.catch(() => undefined)
  }
  // ---- 以下透传形态：不读不写 store ----
  if (loaded === 'deadline') {
    return outcomeWithLookups({ summary: communityTimeoutSummary(), merged: primary }, null, null)
  }
  const state = loaded.state
  if (state.status === 'disabled') {
    return outcomeWithLookups({ summary: disabledCommunitySummary(), merged: primary }, null, null)
  }
  if (state.status === 'unavailable' || !loaded.catalog) {
    return outcomeWithLookups(
      { summary: communitySummary(state, { acceptedCount: 0, upstreamCount: 0, displaced: 0, skippedDirty: 0, skippedSubpathNoNpm: 0 }, []), merged: primary },
      null,
      null,
    )
  }
  // ---- 同步临界区起点：键派生 → 查 store → 建代 → set（禁止 await） ----
  const key = identityKey(input.namespace, input.profile, input.cfg, registry, state)
  const hit = generations.get(key)
  if (hit) {
    mergedStats.hits += 1
    return outcomeWithLookups({ summary: communitySummary(state, hit.counts, hit.adaptWarnings, hit.categoryLabelsEn), merged: hit.merged }, hit.mergedIndex, hit.fullIndex)
  }
  const gen = buildGeneration(primary, loaded.catalog)
  mergedStats.builds += 1
  rememberGeneration(key, gen)
  return outcomeWithLookups({ summary: communitySummary(state, gen.counts, gen.adaptWarnings, gen.categoryLabelsEn), merged: gen.merged }, gen.mergedIndex, gen.fullIndex)
  // ---- 同步临界区终点 ----
}
