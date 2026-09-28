/**
 * 市场面板 pure state（DESIGN.md §4）：query 规范化、分页 reset、API response narrowing、
 * 短 registry notice。不依赖 DOM/React，Node tests 直接 import。
 * 客户端不自行推断来源状态，只消费 Host 返回的 registryState/RegistrySummary。
 */

export const MARKET_PAGE_SIZE = 50

const CATEGORIES = ['market', 'tools', 'ui', 'search', 'other']

function toSafeInt(value, fallback, min, max) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  if (min !== undefined && n < min) return min
  if (max !== undefined && n > max) return max
  return n
}

/** 规范化市场查询：query trim、category 精选白名单 ∪ 安全 slug、primaryOnly、offset ≥0、limit clamp 1..50。 */
export function normalizeMarketQuery(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const query = typeof raw.query === 'string' ? raw.query.trim() : ''
  const category =
    typeof raw.category === 'string' && (CATEGORIES.includes(raw.category) || COMMUNITY_SLUG_RE.test(raw.category))
      ? raw.category
      : null
  const offset = toSafeInt(raw.offset, 0, 0)
  const limit = toSafeInt(raw.limit, MARKET_PAGE_SIZE, 1, MARKET_PAGE_SIZE)
  const primaryOnly = raw.primaryOnly === true
  return { query, category, offset, limit, primaryOnly }
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

// ---------- M1 Task 8：合并市场客户端 pure state ----------

const COMMUNITY_SLUG_RE = /^[a-z0-9-]{1,32}$/
const CURATED_CATEGORIES = [
  { id: 'market', label: '市场' },
  { id: 'tools', label: '工具' },
  { id: 'ui', label: '界面' },
  { id: 'search', label: '搜索' },
  { id: 'other', label: '其他' },
]
const CURATED_IDS = new Set(CURATED_CATEGORIES.map((c) => c.id))
/** 与精选同名共享过滤桶的三 id：不进筛选栏社区组（DESIGN §2.5 / Q40） */
const SHARED_BUCKETS = new Set(['ui', 'tools', 'market'])
/** 已知 20 个社区分类中文标签（与 src/core/community.ts COMMUNITY_KNOWN_CATEGORIES 同表；客户端内嵌副本） */
const COMMUNITY_KNOWN_LABELS = {
  agi: 'AGI 架构探索',
  usage: '用量与计费',
  theme: '主题与外观',
  model: '模型与账号接入',
  identity: '身份与通信',
  session: '会话与消息',
  memory: '记忆',
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
  fun: '娱乐',
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

/** 筛选栏分组（Q45）：精选（5）→ 社区（已知 20 带计数）→ 新分类临时组；共享桶不重复。 */
export function splitCategories(categoryCounts) {
  const counts = categoryCounts && typeof categoryCounts === 'object' && !Array.isArray(categoryCounts) ? categoryCounts : {}
  const curated = CURATED_CATEGORIES.map(({ id, label }) => ({ id, label, count: typeof counts[id] === 'number' ? counts[id] : 0 }))
  const community = []
  const unknown = []
  for (const [id, raw] of Object.entries(counts)) {
    const count = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
    if (CURATED_IDS.has(id)) continue
    if (COMMUNITY_KNOWN_LABELS[id]) community.push({ id, label: COMMUNITY_KNOWN_LABELS[id], count })
    else if (!SHARED_BUCKETS.has(id)) unknown.push({ id, label: id, count })
  }
  return { curated, community, unknown }
}

/** 双源 notice（Q42）：主 down+社区 up → 错误横幅 + communityFallback；社区 stale → communityStale 显式；社区失败静默。 */
export function marketNotice(registryState, community) {
  const base = registryNotice(registryState, undefined)
  const c = community && typeof community === 'object' ? community : {}
  if (c.status === 'stale') base.communityStale = true
  if (registryState && registryState.status === 'unavailable' && (c.status === 'ready' || c.status === 'stale')) {
    base.communityFallback = true
  }
  return base
}

/** 合并条目排序（Q45）：主清单置顶（保持服务端序）+ 社区按 downloads 降序、无数据按名称。 */
export function sortMergedItems(items) {
  const list = Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : []
  const primary = list.filter((it) => it.community !== true)
  const community = list
    .filter((it) => it.community === true)
    .slice()
    .sort((a, b) => {
      const da = typeof a.downloads === 'number' && Number.isFinite(a.downloads) ? a.downloads : -1
      const db = typeof b.downloads === 'number' && Number.isFinite(b.downloads) ? b.downloads : -1
      if (da !== db) return db - da
      return String(a.name).localeCompare(String(b.name))
    })
  return [...primary, ...community]
}
