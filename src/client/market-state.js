/**
 * 市场面板 pure state（DESIGN.md §2.6 分区制 / 0.7.0 Task 8，修订 M1 Task 8 的混排形态）：
 * 分区状态工厂、分区 query 规范化、分页 reset（query/category/sort 变化归零）、页码窗口化、
 * 分区 chips 构建器（社区标签消费服务端 categoryLabels/categoryLabelsEn 双语单一事实源，客户端内嵌副本已删除）、
 * API response narrowing、短 registry notice。不依赖 DOM/React，Node tests 直接 import。
 * 客户端不自行推断来源状态，只消费 Host 返回的 registryState/RegistrySummary；
 * 排序单一事实源在服务端（客户端不再重排，sortMergedItems 已删除）。
 */

export const MARKET_PAGE_SIZES = [24, 48, 96]
export const DEFAULT_PAGE_SIZE = 24

const CURATED_ORDER = ['market', 'tools', 'ui', 'search', 'other']
const CURATED_LABELS = { market: '市场', tools: '工具', ui: '界面', search: '搜索', other: '其他' }
const CURATED_IDS = new Set(CURATED_ORDER)
/** 社区开放分类安全 slug（与服务端同语义） */
const SLUG_RE = /^[a-z0-9-]{1,32}$/
const SORT_FIELDS = new Set(['downloads', 'stars', 'added'])

function toSafeInt(value, fallback, min, max) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  if (min !== undefined && n < min) return min
  if (max !== undefined && n > max) return max
  return n
}

/** 分区初始状态（0.7.0 Task 8/11）：community 默认 downloads-desc；primary 策展序（sort 恒 null），
 *  limit 96 = 单页直出上限（当前 registry 22 条即此形态；自定义源 >96 时由通用分页器降级兜底）。 */
export function createZoneState(zone) {
  const z = zone === 'primary' ? 'primary' : 'community'
  return {
    zone: z,
    query: '',
    category: null,
    sort: z === 'community' ? { field: 'downloads', dir: 'desc' } : null,
    offset: 0,
    limit: z === 'primary' ? 96 : DEFAULT_PAGE_SIZE,
  }
}

/** 规范化分区查询：query trim；category 白名单按 zone（primary=精选 5 ∪ slug、community=slug）；
 *  offset ≥ 0；limit clamp 1..96 默认 24；sort 仅 community 区合法化（非法形状归 null）。 */
export function normalizeMarketQuery(input, zone = 'community') {
  const z = zone === 'primary' ? 'primary' : 'community'
  const raw = input && typeof input === 'object' ? input : {}
  const query = typeof raw.query === 'string' ? raw.query.trim() : ''
  const catOk =
    typeof raw.category === 'string' &&
    raw.category !== '' &&
    (z === 'primary' ? CURATED_IDS.has(raw.category) || SLUG_RE.test(raw.category) : SLUG_RE.test(raw.category))
  const category = catOk ? raw.category : null
  const offset = toSafeInt(raw.offset, 0, 0)
  const limit = toSafeInt(raw.limit, DEFAULT_PAGE_SIZE, 1, 96)
  let sort = null
  if (z === 'community' && raw.sort && typeof raw.sort === 'object' && !Array.isArray(raw.sort)) {
    const field = raw.sort.field
    const dir = raw.sort.dir
    if (SORT_FIELDS.has(field) && (dir === 'asc' || dir === 'desc')) sort = { field, dir }
  }
  return { zone: z, source: z, query, category, sort, offset, limit }
}

const sameSort = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** query/category/sort 变化时把 offset 归零（回到第一页）；同筛选下保留分页。 */
export function resetPageOnFilterChange(previous, next) {
  const prev = previous && typeof previous === 'object' ? previous : {}
  const merged = { ...next }
  if (prev.query !== next.query || prev.category !== next.category || !sameSort(prev.sort, next.sort)) {
    merged.offset = 0
  }
  return merged
}

/** 页码窗口化：`1 … n-1 n n+1 … last`；总页数 ≤ 7 全显；首末页恒在（'...' 为省略占位）。 */
export function pageItems(current, totalPages) {
  const last = Math.max(1, Math.floor(totalPages))
  const cur = Math.min(Math.max(1, Math.floor(current)), last)
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1)
  const out = [1]
  const from = Math.max(2, cur - 1)
  const to = Math.min(last - 1, cur + 1)
  if (from > 2) out.push('...')
  for (let p = from; p <= to; p++) out.push(p)
  if (to < last - 1) out.push('...')
  out.push(last)
  return out
}

const FALLBACK_REGISTRY_STATE = {
  configuredAddress: '',
  activeAddress: null,
  source: 'bundled',
  status: 'unavailable',
  isDefault: true,
  stale: false,
  fetchedAt: null,
  errors: [],
  count: 0,
}

/** API 响应收敛：缺失/错误字段一律给出安全空页，registryState 部分合并。 */
export function normalizeMarketResponse(raw) {
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const items = Array.isArray(body.items) ? body.items.filter((it) => it && typeof it === 'object') : []
  const total = toSafeInt(body.total, items.length, 0)
  const offset = toSafeInt(body.offset, 0, 0)
  const limit = toSafeInt(body.limit, DEFAULT_PAGE_SIZE, 1)
  let categoryCounts = {}
  if (body.categoryCounts && typeof body.categoryCounts === 'object' && !Array.isArray(body.categoryCounts)) {
    for (const [key, value] of Object.entries(body.categoryCounts)) {
      if (typeof value === 'number' && Number.isFinite(value)) categoryCounts[key] = value
    }
  }
  const rs = body.registryState && typeof body.registryState === 'object' && !Array.isArray(body.registryState)
    ? body.registryState
    : {}
  const registryState = {
    ...FALLBACK_REGISTRY_STATE,
    ...rs,
    errors: Array.isArray(rs.errors) ? rs.errors.map(String) : [],
  }
  const c = body.community && typeof body.community === 'object' && !Array.isArray(body.community)
    ? body.community
    : {}
  const community = {
    ...FALLBACK_COMMUNITY,
    ...c,
    enabled: c.enabled === true,
    status: typeof c.status === 'string' ? c.status : 'disabled',
    acceptedCount: typeof c.acceptedCount === 'number' && Number.isFinite(c.acceptedCount) ? c.acceptedCount : 0,
    upstreamCount: typeof c.upstreamCount === 'number' && Number.isFinite(c.upstreamCount) ? c.upstreamCount : null,
    displaced: typeof c.displaced === 'number' && Number.isFinite(c.displaced) ? c.displaced : 0,
    skippedDirty: typeof c.skippedDirty === 'number' && Number.isFinite(c.skippedDirty) ? c.skippedDirty : 0,
    skippedSubpathNoNpm: typeof c.skippedSubpathNoNpm === 'number' && Number.isFinite(c.skippedSubpathNoNpm) ? c.skippedSubpathNoNpm : 0,
    errors: Array.isArray(c.errors) ? c.errors.map(String) : [],
    warnings: Array.isArray(c.warnings) ? c.warnings.map(String) : [],
    categoryLabels: narrowCategoryLabels(c.categoryLabels),
    categoryLabelsEn: narrowCategoryLabels(c.categoryLabelsEn),
  }
  return {
    items,
    total,
    offset,
    limit,
    categoryCounts,
    registryState,
    community,
    installedComplete: body.installedComplete === true,
    latestComplete: body.latestComplete === true,
    latestTimedOut: body.latestTimedOut === true,
  }
}

/** 社区分类标签（服务端单一事实源，0.7.0 Task 4/8）：仅收敛 string 值条目；缺失 → undefined。 */
function narrowCategoryLabels(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out = {}
  let n = 0
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value !== '') {
      out[key] = value
      n += 1
    }
  }
  return n > 0 ? out : undefined
}

/**
 * 短 registry notice（0.7.1 修订）：信息性来源横幅（默认/自定义/缓存 stale）全部退役——
 * 「共 {count} 条」计数从未接线（恒显 0）、本机网络受限时 stale 横幅常驻，均属噪音；
 * 来源状态去设置页看。只保留错误态 unavailable（收录清单不可用）。
 * 输出绝不包含 configured/active 地址等本地路径。
 */
export function registryNotice(summary, total) {
  const s = summary && typeof summary === 'object' ? summary : {}
  if (s.status === 'unavailable') return { key: 'notice.unavailable' }
  return null
}

const FALLBACK_COMMUNITY = {
  enabled: false,
  status: 'disabled',
  version: null,
  checkedAt: null,
  fetchedAt: null,
  route: null,
  acceptedCount: 0,
  upstreamCount: null,
  displaced: 0,
  skippedDirty: 0,
  skippedSubpathNoNpm: 0,
  errors: [],
  warnings: [],
}

/**
 * 分区 chips（0.7.0 Task 8，Q40 共享过滤桶退役——各区分类彻底解耦）：
 * - primary：精选 5 类固定序（0 计数也展示——策展区固定分类法）；
 * - community：消费服务端 categoryLabels（单一事实源）已知标签在前（含 ui/tools/market 等真实计数键），
 *   未知 slug 尾组原样渲染；精选种子键 0 计数（search/other）与 0 计数未知分类不进社区区。
 */
export function zoneChips(categoryCounts, categoryLabels, zone) {
  const counts =
    categoryCounts && typeof categoryCounts === 'object' && !Array.isArray(categoryCounts) ? categoryCounts : {}
  if (zone === 'primary') {
    return CURATED_ORDER.map((id) => ({
      id,
      label: CURATED_LABELS[id],
      labelKey: `cat.${id}`,
      count: typeof counts[id] === 'number' && Number.isFinite(counts[id]) ? counts[id] : 0,
    }))
  }
  const labels =
    categoryLabels && typeof categoryLabels === 'object' && !Array.isArray(categoryLabels) ? categoryLabels : {}
  const countOf = (id) => (typeof counts[id] === 'number' && Number.isFinite(counts[id]) ? counts[id] : 0)
  const known = []
  const seen = new Set()
  for (const [id, label] of Object.entries(labels)) {
    if (typeof label !== 'string' || label === '') continue
    const count = countOf(id)
    if (count === 0) continue
    known.push({ id, label, count })
    seen.add(id)
  }
  const unknown = []
  for (const [id, raw] of Object.entries(counts)) {
    if (seen.has(id) || CURATED_IDS.has(id)) continue
    const count = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
    if (count === 0) continue
    unknown.push({ id, label: id, count })
  }
  return [...known, ...unknown]
}

/**
 * 双源 notice（0.7.1 修订）：恒返回旗标对象（可全空），调用方按旗标渲染——
 * - notice: { key: 'notice.unavailable' } 错误态（主清单不可用）；
 * - communityFallback：主 down+社区 up；communityStale：社区目录为缓存快照。
 * 旗标独立于 notice 键存在（社区提示不再被信息性来源横幅的退役连坐）。
 */
export function marketNotice(registryState, community) {
  const out = {}
  const c = community && typeof community === 'object' ? community : {}
  if (c.status === 'stale') out.communityStale = true
  if (registryState && registryState.status === 'unavailable' && (c.status === 'ready' || c.status === 'stale')) {
    out.communityFallback = true
  }
  const notice = registryNotice(registryState)
  if (notice) out.notice = notice
  return out
}
