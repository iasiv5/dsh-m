/**
 * 市场面板 pure state（DESIGN.md §4）：query 规范化、分页 reset、API response narrowing、
 * 短 registry notice。不依赖 DOM/React，Node tests 直接 import。
 * 客户端不自行推断来源状态，只消费 Host 返回的 registryState/RegistrySummary。
 */

export const MARKET_PAGE_SIZE = 50

const CATEGORIES = ['market', 'tools', 'ui', 'search', 'media', 'other']

function toSafeInt(value, fallback, min, max) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  if (min !== undefined && n < min) return min
  if (max !== undefined && n > max) return max
  return n
}

/** 规范化市场查询：query trim、category 白名单、offset ≥0、limit clamp 1..50。 */
export function normalizeMarketQuery(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const query = typeof raw.query === 'string' ? raw.query.trim() : ''
  const category = typeof raw.category === 'string' && CATEGORIES.includes(raw.category) ? raw.category : null
  const offset = toSafeInt(raw.offset, 0, 0)
  const limit = toSafeInt(raw.limit, MARKET_PAGE_SIZE, 1, MARKET_PAGE_SIZE)
  return { query, category, offset, limit }
}

/** query/category 变化时把 offset 归零（回到第一页）；同筛选下保留分页。 */
export function resetPageOnFilterChange(previous, next) {
  const prev = previous && typeof previous === 'object' ? previous : {}
  const merged = { ...next }
  if (prev.query !== next.query || prev.category !== next.category) {
    merged.offset = 0
  }
  return merged
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
  const limit = toSafeInt(body.limit, MARKET_PAGE_SIZE, 1)
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
  return {
    items,
    total,
    offset,
    limit,
    categoryCounts,
    registryState,
    installedComplete: body.installedComplete === true,
    latestComplete: body.latestComplete === true,
    latestTimedOut: body.latestTimedOut === true,
  }
}

/**
 * 短 registry notice：只消费 summary 的 isDefault/status/stale 布尔语义，
 * 输出 i18n key 与条数，绝不包含 configured/active 地址等本地路径。
 */
export function registryNotice(summary, total) {
  const s = summary && typeof summary === 'object' ? summary : {}
  let key = 'notice.default'
  if (s.status === 'unavailable') key = 'notice.unavailable'
  else if (s.stale || s.status === 'stale') key = 'notice.stale'
  else if (!s.isDefault) key = 'notice.custom'
  return { key, count: typeof total === 'number' && Number.isFinite(total) ? total : 0 }
}
