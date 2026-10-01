/**
 * 头部 dsh-m 版本角标的 self-check 纯逻辑（0.9.1）。
 *
 * 需求口径（主人 2026-10-01）：**有新版本才提示，没有就静默**。
 * - 数据源：host `/dshm` 的 `self-check`（npm latest vs 装机版本，只读，host-api.ts）；
 * - 常态（已最新 / 检查失败 / 本地 dev 领先 npm）：角标维持 0.7.5 起的静态展示，不加粗不可点；
 * - 仅 `outdated === true` 时点亮为 warn 态可点角标（点击触发 self-upgrade）。
 *
 * 为什么有 TTL 缓存：面板每次打开都会挂载角标，`self-check` 每次都打 npm registry
 * 既慢（最长 20s 超时）又浪费；localStorage 缓存 30 分钟，命中即零网络。
 * 另有**版本护栏**：缓存记录的 current 与当前 ping.version 不一致（升级重启后）→ 缓存作废，
 * 防止旧 latest 把新版本误标成可升级。
 *
 * 不依赖 DOM/React，Node tests 直接 import。
 */

/** localStorage 缓存键（与 operations.js 的 OP_STORAGE_KEY 同风格，dshm- 前缀）。 */
export const SELF_CHECK_STORAGE_KEY = 'dshm-selfcheck'
/** 缓存 TTL：30 分钟。面板开关频繁，registry 检查不必每次都打。 */
export const SELF_CHECK_TTL_MS = 30 * 60 * 1000

/**
 * @typedef {Object} SelfCheckData
 * @property {string} current 装机版本（host package.json version）
 * @property {string | null} latest npm latest；null = 检查失败
 * @property {boolean} outdated true = npm 有更新版本（唯一点亮条件）
 * @property {boolean} ahead true = 本地 dev 版领先 npm（静默，仅 title 提示）
 * @property {string} [error] 检查失败原因（静默，不展示）
 */

/**
 * 读取 self-check 缓存。任何异常/畸形/过期/版本不符 → null（调用方按无缓存处理）。
 * @param {Storage | null | undefined} storage 浏览器 localStorage；不可用即视为无缓存
 * @param {{ now?: number, version?: string | null, ttlMs?: number }} [opts]
 *   version 传入当前 ping.version 时启用版本护栏（不一致即作废）
 * @returns {SelfCheckData | null}
 */
export function readSelfCheckCache(storage, opts = {}) {
  if (!storage || typeof storage.getItem !== 'function') return null
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  const ttlMs = typeof opts.ttlMs === 'number' ? opts.ttlMs : SELF_CHECK_TTL_MS
  let raw = null
  try {
    raw = storage.getItem(SELF_CHECK_STORAGE_KEY)
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
  const data = box.data
  if (!data || typeof data !== 'object' || typeof data.current !== 'string') return null
  // 版本护栏：升级重启后 current 变了 → 缓存作废（防旧 latest 误标新版本为可升级）
  if (typeof opts.version === 'string' && opts.version !== '' && data.current !== opts.version) return null
  return data
}

/**
 * 写入 self-check 缓存。data 畸形或 storage 不可用/配额满 → 静默放弃（缓存是优化不是功能）。
 * @param {Storage | null | undefined} storage
 * @param {SelfCheckData} data
 * @param {{ now?: number }} [opts]
 */
export function writeSelfCheckCache(storage, data, opts = {}) {
  if (!storage || typeof storage.setItem !== 'function') return
  if (!data || typeof data !== 'object' || typeof data.current !== 'string') return
  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  try {
    storage.setItem(SELF_CHECK_STORAGE_KEY, JSON.stringify({ ts: now, data }))
  } catch {
    /* 配额/隐私模式静默降级 */
  }
}

/**
 * 清除 self-check 缓存（self-upgrade 成功后调用；下次挂载强制重查，确认新版本已是最新）。
 * @param {Storage | null | undefined} storage
 */
export function clearSelfCheckCache(storage) {
  try {
    if (storage && typeof storage.removeItem === 'function') storage.removeItem(SELF_CHECK_STORAGE_KEY)
  } catch {
    /* 静默 */
  }
}

/**
 * 角标状态推导（纯函数）。
 * - outdated → `{ kind: 'outdated', latest }`：点亮 warn 可点角标（唯一非静默态）；
 * - ahead → `{ kind: 'ahead', latest }`：静默，title 提示本地开发版；
 * - 其余（无数据 / 检查失败 / 已最新）→ `{ kind: 'idle' }`：完全静默。
 * @param {SelfCheckData | null | undefined} check
 * @param {string | null | undefined} version 当前 ping.version（仅防御性冗余，判定以 host outdated 为准）
 * @returns {{ kind: 'outdated' | 'ahead' | 'idle', latest?: string | null }}
 */
export function deriveChipState(check, version) {
  if (!check || typeof check !== 'object') return { kind: 'idle' }
  if (check.outdated === true && typeof check.latest === 'string' && check.latest !== '') {
    return { kind: 'outdated', latest: check.latest }
  }
  if (check.ahead === true) return { kind: 'ahead', latest: typeof check.latest === 'string' ? check.latest : null }
  return { kind: 'idle' }
}
