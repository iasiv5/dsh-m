/**
 * 操作记录行展示模型（0.9.75 信息增强）：把「何时发生 / 开还是关 / 跑了多久 / 从哪升到哪」
 * 从记录数据派生为可直接渲染的视图模型——展示层纯函数，Node tests 直接覆盖，
 * main.jsx 只消费不内联（仓库惯例同 toggle-view.js / installed-view.js）。
 *
 * 数据契约（src/client/operations.js 的 OperationRecord 不变，零迁移）：
 * - createdAt / updatedAt（ms）store.upsert 本来就打点 → 行内时间与耗时零新增写入；
 * - toggle / community-toggle 的 meta.on（0.4.0 起）→ 方向徽章；
 * - upgrade 的 meta.from / meta.to（0.9.75 起由泵从执行器 value.opMeta 并入，见 pump）→ 版本变迁。
 * 不消费 meta.session（0.9.76 自纠）：它是泵所有权标记（restore 跳过 / replaceAll 不回卷 /
 * persist 剥离），不是「对话区发起」来源语义——GUI 的 runOp 与对话镜像两条路都打同一标，
 * 展示层消费它只会制造误报（0.9.75「对话」徽章事故）；来源区分须由未来 meta.origin 承载。
 * 全部字段缺席时优雅回退旧行形态（旧记录立即可读，不要求重放）。
 */

import { TERMINAL_CLEARABLE } from './operations.js'

export function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 行内时刻「HH:mm」（本地时区；日期由按日分组头承载，不逐行重复）。 */
export function fmtOpClock(ts) {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 完整时刻「YYYY-MM-DD HH:mm:ss」（本地时区；进 title 悬浮可读，杜绝歧义）。 */
export function fmtOpFull(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${fmtOpClock(ts)}:${pad2(d.getSeconds())}`
}

/** 本地日期键「YYYY-MM-DD」（按日分组的组键；跨年自然带年份）。 */
export function opDayKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * 耗时格式：紧凑、tabular-nums 对齐、无需翻译。
 * <1s / 42s / 1m02s / 3h05m（小时累计不进天——操作记录里没有跨天量级）；负值/非有限 → ''。
 */
export function fmtOpDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return '<1s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${pad2(s % 60)}s`
  const hr = Math.floor(m / 60)
  return `${hr}h${pad2(m % 60)}m`
}

/**
 * 升级结果 → 版本变迁 meta（{ from, to }；两侧皆空 → null 不入账）。
 * to 缺 version 时回退 sha 前 7 位（github 源），与 notify.upgraded 文案口径一致。
 * 渲染端复用：从记录 meta 构造 { fromVersion: meta.from, version: meta.to } 再走本函数。
 */
export function opUpgradeMeta(res) {
  if (!res || typeof res !== 'object') return null
  const from = res.fromVersion ? String(res.fromVersion) : ''
  const to = res.version ? String(res.version) : res.sha ? String(res.sha).slice(0, 7) : ''
  return from || to ? { from, to } : null
}

/**
 * 已结束记录按日分组（**新组在前、组内新→旧**）：最新一条永远贴着「已结束」标题可见，
 * 不再沉底要滚动找。返回 [{ key: 'YYYY-MM-DD'|'', kind: 'today'|'yesterday'|'date', records }]；
 * createdAt 非法的记录落 key='' 的末组（渲染端不给它日期头）。输入假定时间升序（store 追加序）。
 */
export function groupOpsByDay(records, now = Date.now()) {
  const list = Array.isArray(records) ? records.filter(Boolean) : []
  const todayKey = opDayKey(now)
  const yesterdayKey = opDayKey(now - 86400000)
  const byDay = new Map()
  for (const r of list) {
    const key = r && Number.isFinite(r.createdAt) ? opDayKey(r.createdAt) : ''
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(r)
  }
  const kindOf = (key) => (key === todayKey ? 'today' : key === yesterdayKey ? 'yesterday' : 'date')
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([key, rs]) => ({ key, kind: kindOf(key), records: rs.slice().reverse() }))
}

/**
 * 单行视图模型：clock（HH:mm）/ full（完整时刻）/ durText（终态耗时，非终态 ''）/
 * dir（'on'|'off'|null，toggle 与 community-toggle 按 meta.on）/
 * version（升级 from→to）/ target。字段缺席回退：clock='' 时渲染端整段省略（等价旧行）。
 * 不含 session：泵所有权标记不是来源语义，展示层不消费（0.9.76 自纠，见文件头）。
 */
export function opRowVm(r) {
  const rec = r || {}
  const meta = rec.meta && typeof rec.meta === 'object' ? rec.meta : {}
  const ts = Number.isFinite(rec.createdAt) ? rec.createdAt : null
  const durMs =
    rec.status && TERMINAL_CLEARABLE.has(rec.status) &&
    Number.isFinite(rec.createdAt) && Number.isFinite(rec.updatedAt)
      ? Math.max(0, rec.updatedAt - rec.createdAt)
      : null
  const isToggle = rec.kind === 'toggle' || rec.kind === 'community-toggle'
  let version = ''
  if (rec.kind === 'upgrade') {
    const m = opUpgradeMeta({ fromVersion: meta.from, version: meta.to })
    if (m) version = `${m.from ? `v${m.from}` : ''}→${m.to ? `v${m.to}` : ''}`
  }
  return {
    clock: ts === null ? '' : fmtOpClock(ts),
    full: ts === null ? '' : fmtOpFull(ts),
    durText: durMs === null ? '' : fmtOpDuration(durMs),
    dir: isToggle && typeof meta.on === 'boolean' ? (meta.on ? 'on' : 'off') : null,
    version,
    target: typeof rec.target === 'string' ? rec.target : '',
  }
}
