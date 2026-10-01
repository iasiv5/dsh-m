/**
 * 0.9.14 Task 5a：市场默认首页快照纯逻辑（localStorage，镜像 self-check.js 形态）。
 *
 * 需求口径：消灭「每次打开市场必现加载 spinner」的数据面——面板挂载命中快照即先渲染
 * 上次默认首页响应，background 换新（main.jsx useMarketData Task 5b 接线）。
 * - 只缓存「默认首页」形态的响应（offset===0 / limit 为该区默认），搜索与翻页不写（防膨胀）；
 * - TTL 10 分钟：只消短 spinner，正确性由 background 刷新兜底；
 * - 无版本护栏：存的是 normalizeMarketResponse 收敛后的响应，读侧调用方会再次收敛，形状漂移免疫；
 * - 不依赖 DOM/React，Node tests 直接 import（../src/ 直跑，client 族无 lib 逐文件产物）。
 */
import { DEFAULT_PAGE_SIZE } from './market-state.js'

export const MARKET_SNAPSHOT_TTL_MS = 10 * 60 * 1000

/** localStorage 键（dshm- 前缀同族；zone 分键自隔离）。 */
export function snapshotKey(zone) {
  return `dshm-marketsnap-${zone === 'primary' ? 'primary' : 'community'}`
}

function defaultLimitOf(zone) {
  return zone === 'primary' ? 96 : DEFAULT_PAGE_SIZE
}

function defaultSortOf(zone) {
  return zone === 'community' ? { field: 'downloads', dir: 'desc' } : null
}

function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * 判定规范化后的分区 query 是否为「默认首页」形态（快照唯一可写/可命中的形态）。
 * @param {{ query?: string, category?: string | null, sort?: object | null, offset?: number, limit?: number }} query
 */
export function isDefaultFirstPageQuery(query, zone) {
  const q = query && typeof query === 'object' ? query : {}
  if (typeof q.query === 'string' ? q.query !== '' : q.query != null) return false
  if (q.category != null && q.category !== '') return false
  const offset = typeof q.offset === 'number' && Number.isFinite(q.offset) ? q.offset : 0
  if (offset !== 0) return false
  if ((q.limit ?? DEFAULT_PAGE_SIZE) !== defaultLimitOf(zone)) return false
  return sameJson(q.sort ?? null, defaultSortOf(zone))
}

/**
 * 读取快照。任何异常/畸形/过期/形状缺失 → null（调用方按无缓存处理）。
 * @param {Storage | null | undefined} storage
 * @param {{ zone?: string, now?: number, ttlMs?: number }} [opts]
 * @returns {object | null} 收敛后的市场响应对象（调用方再过一次 normalizeMarketResponse）
 */
export function readMarketSnapshot(storage, opts = {}) {
  if (!storage || typeof storage.getItem !== 'function') return null
  const zone = opts.zone === 'primary' ? 'primary' : 'community'
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const ttlMs = typeof opts.ttlMs === 'number' ? opts.ttlMs : MARKET_SNAPSHOT_TTL_MS
  let raw = null
  try {
    raw = storage.getItem(snapshotKey(zone))
  } catch {
    return null
  }
  if (typeof raw !== 'string' || raw === '') return null
  let box
  try {
    box = JSON.parse(raw)
  } catch {
    return null
  }
  if (!box || typeof box !== 'object') return null
  if (typeof box.ts !== 'number' || !Number.isFinite(box.ts)) return null
  if (now - box.ts > ttlMs) return null
  const response = box.response
  if (!isDefaultFirstPageResponse(response, zone)) return null
  return response
}

/**
 * 写入快照。非默认首页形状的 response 拒写；storage 不可用/配额满静默放弃（缓存是优化不是功能）。
 * @param {Storage | null | undefined} storage
 * @param {{ zone?: string, response?: object, now?: number }} opts
 */
export function writeMarketSnapshot(storage, opts = {}) {
  if (!storage || typeof storage.setItem !== 'function') return
  const zone = opts.zone === 'primary' ? 'primary' : 'community'
  const response = opts.response
  if (!isDefaultFirstPageResponse(response, zone)) return
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  try {
    storage.setItem(snapshotKey(zone), JSON.stringify({ ts: now, response }))
  } catch {
    /* 配额/隐私模式静默降级 */
  }
}

/** 清除双 zone 快照（静默）。 */
export function clearMarketSnapshots(storage) {
  try {
    if (!storage || typeof storage.removeItem !== 'function') return
    storage.removeItem(snapshotKey('community'))
    storage.removeItem(snapshotKey('primary'))
  } catch {
    /* 静默 */
  }
}

/** 响应级默认首页形状校验（收敛产物：items 数组 + total 数字 + offset 0 + 该区默认 limit）。 */
function isDefaultFirstPageResponse(response, zone) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false
  if (!Array.isArray(response.items)) return false
  if (typeof response.total !== 'number' || !Number.isFinite(response.total)) return false
  const offset = typeof response.offset === 'number' && Number.isFinite(response.offset) ? response.offset : 0
  if (offset !== 0) return false
  return (response.limit ?? DEFAULT_PAGE_SIZE) === defaultLimitOf(zone)
}
