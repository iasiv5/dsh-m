/**
 * 截图灯箱纯逻辑（0.9.60 从 main.jsx 内联取模抽出，Node tests 直接覆盖）。
 * lbStep：环形步进——从 index 出发走 step 步（-1/1），对 length 取模回绕；
 * length<=1 或非有限输入时原地不动（单图灯箱按钮不渲染，键盘兜底也安全）。
 */
export function lbStep(index, step, length) {
  if (!Number.isFinite(index) || !Number.isFinite(step) || !Number.isInteger(length) || length <= 1) return index;
  return (((index + step) % length) + length) % length;
}
