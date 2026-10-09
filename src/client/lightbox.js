/**
 * 截图灯箱纯逻辑（0.9.60 从 main.jsx 内联取模抽出，Node tests 直接覆盖）。
 * lbStep：环形步进——从 index 出发走 step 步（-1/1），对 length 取模回绕；
 * length<=1 或非有限输入时原地不动（单图灯箱按钮不渲染，键盘兜底也安全）。
 * 0.9.65 增两枚交互纯函数：
 * lbNeighbors：左右邻图序号（走 lbStep 回绕，去重保序）——邻图预取的取数源；
 *   length<=1 → []（单图无邻可预取）；双图左右邻是同一张 → 去重成一项。
 * swipeDir：横滑判向——|dx| 达阈值且 |dx| ≥ ratio×|dy| 才算一次横向滑动，返回
 *   -1/1/0；不设时长门槛（慢拖也算一次翻页，误触由方向比兜住）；竖滑/斜滑/短滑
 *   一律 0（纵向手势留给原生：页面滚动/pinch-zoom 不被劫持）。
 */
export function lbStep(index, step, length) {
  if (!Number.isFinite(index) || !Number.isFinite(step) || !Number.isInteger(length) || length <= 1) return index;
  return (((index + step) % length) + length) % length;
}

export function lbNeighbors(index, length) {
  if (!Number.isFinite(index) || !Number.isInteger(length) || length <= 1) return [];
  const out = [];
  for (const n of [lbStep(index, 1, length), lbStep(index, -1, length)]) {
    if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

export function swipeDir(dx, dy, { threshold = 48, ratio = 2 } = {}) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  const ax = Math.abs(dx);
  if (ax < threshold || ax < ratio * Math.abs(dy)) return 0;
  return dx > 0 ? 1 : -1;
}
