/**
 * ZoneChips 视觉裁剪纯函数（#36 自 market-state.js 归位：唯一消费者 zone-chips.jsx，
 * seam 归位——market-state 只保留市场数据状态几何）。DOM-free，Node tests 直接 import
 * （tests/client-zonechips-clip.test.mjs）。
 */

/**
 * 按 offsetTop 去重计数行数（相邻同值视为同一行；非有限数值跳过）。
 * @param {number[]} offsets chip.offsetTop 数组（按 DOM 顺序）
 * @returns {number}
 */
export function chipRows(offsets) {
  if (!Array.isArray(offsets)) return 0
  let rows = 0
  let last = null
  for (const t of offsets) {
    if (typeof t !== 'number' || !Number.isFinite(t)) continue
    if (last === null || t !== last) {
      rows += 1
      last = t
    }
  }
  return rows
}

/**
 * 统计第 maxRows 行之外的 chip 颗数（按 offsetTop 分组；分组不足 maxRows 行时恒 0）。
 * @param {number[]} offsets chip.offsetTop 数组（按 DOM 顺序）
 * @param {number} maxRows 可见行数（≥1 整数，非法输入返回 0）
 * @returns {number}
 */
export function countBeyondRows(offsets, maxRows) {
  if (!Array.isArray(offsets)) return 0
  if (!Number.isInteger(maxRows) || maxRows < 1) return 0
  let beyond = 0
  let rowCount = 0
  let last = null
  for (const t of offsets) {
    if (typeof t !== 'number' || !Number.isFinite(t)) continue
    if (last === null || t !== last) {
      rowCount += 1
      last = t
    }
    if (rowCount > maxRows) beyond += 1
  }
  return beyond
}

/**
 * 求首个被裁剪行的 offsetTop（第 maxRows+1 行行顶）；行数不足 maxRows+1 时返回 Infinity（无裁剪）。
 * @param {number[]} offsets chip.offsetTop 数组（按 DOM 顺序）
 * @param {number} maxRows 可见行数（≥1 整数）
 * @returns {number}
 */
export function clipTopOf(offsets, maxRows) {
  if (!Array.isArray(offsets)) return Infinity
  if (!Number.isInteger(maxRows) || maxRows < 1) return Infinity
  let rowCount = 0
  let last = null
  for (const t of offsets) {
    if (typeof t !== 'number' || !Number.isFinite(t)) continue
    if (last === null || t !== last) {
      rowCount += 1
      last = t
      if (rowCount === maxRows + 1) return t
    }
  }
  return Infinity
}

/**
 * 当前最后可见行的行顶（不能用 offsets[maxRows]：一行可容纳多颗 chip）。
 * @param {number[]} offsets chip.offsetTop 数组（按 DOM 顺序）
 * @param {number} maxRows 可见行数（≥1 整数）
 * @returns {number} 无有效行时返回 0
 */
export function visibleRowTop(offsets, maxRows) {
  if (!Array.isArray(offsets) || !Number.isInteger(maxRows) || maxRows < 1) return 0
  let rows = 0
  let last = null
  for (const top of offsets) {
    if (typeof top !== 'number' || !Number.isFinite(top)) continue
    if (last === null || top !== last) {
      rows += 1
      last = top
      if (rows === maxRows) return top
    }
  }
  return last ?? 0
}

/**
 * 自动展开决策（评审 R1-Q3：展开态同样记录 autoRef、仅不施裁剪——对齐现状 main.jsx:921-922
 * 在展开态也写 autoRef 的语义；R2-N1 后签名不变）。
 * @param {number} activeTop 激活分类 chip 的 offsetTop（折叠态坐标系）
 * @param {number} clipTop 首个被裁剪行的 offsetTop（折叠态测量快照）
 * @param {boolean} autoRefMatched autoRef.current === active（该激活分类已记录过）
 * @param {boolean} expanded 当前是否展开态
 * @returns {{record: boolean, expand: boolean}}
 */
export function autoExpandDecision(activeTop, clipTop, autoRefMatched, expanded) {
  const beyond =
    typeof activeTop === 'number' && Number.isFinite(activeTop) &&
    typeof clipTop === 'number' && Number.isFinite(clipTop) &&
    activeTop >= clipTop
  if (!beyond || autoRefMatched) return { record: false, expand: false }
  return { record: true, expand: !expanded }
}
