/**
 * TwoStepButton 三态展示模型（DOM-free 纯逻辑，node:test 直测——tests/client-two-step.test.mjs）。
 *
 * 背景（2026-10-31 卸载在途 UX）：两段确认按钮原为「常态 label / 武装确认 confirmLabel」两态，
 * 「确认卸载」点击后在途窗口（泵 record queued→running→终态）内只剩灰色 disabled label——
 * 用户无从知晓正在卸载。补第三态 busy（在途）：转圈 + busyLabel 文案。
 *
 * 优先级 busy > arm > idle：在途（已确认执行中）覆盖武装态——confirm 后 arm 已被组件复位，
 * 但恢复重放/并发在途等路径下 arm 残留时，busy 仍须胜出且摘除 danger 红样式（在途不是危险确认）。
 * mode 闭集：'idle' | 'arm' | 'busy'；danger 仅 arm 为 true。
 * busyLabel 缺席回退 label（保住动作名）；全字段缺席兜底 idle 空文案不抛。
 * 不依赖 DOM/React，组件层（chrome.jsx TwoStepButton）只做 mode → 节点的薄映射。
 */

/**
 * @param {Object} [p]
 * @param {boolean} [p.arm] 武装确认态（第一次点击后 4s 窗口内）
 * @param {boolean} [p.busy] 在途态（该目标的变更操作 queued/running/input）
 * @param {string} [p.label] 常态文案
 * @param {string} [p.confirmLabel] 武装确认文案
 * @param {string} [p.busyLabel] 在途文案
 * @returns {{ mode: 'idle'|'arm'|'busy', text: string, danger: boolean }}
 */
export function twoStepVm({ arm = false, busy = false, label = "", confirmLabel = "", busyLabel = "" } = {}) {
  if (busy) return { mode: "busy", text: busyLabel || label, danger: false };
  if (arm) return { mode: "arm", text: confirmLabel, danger: true };
  return { mode: "idle", text: label, danger: false };
}
