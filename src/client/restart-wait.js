/**
 * 重启等待 pure 决策（DESIGN.md §3.2 一键重启）：把 RestartBanner.restart 轮询里的
 * 两个判定点显式化。phase='before-ping' 对应「sleep 后、ping 前」的 deadline 检查
 * （现行实现：超时先于 boot 判定抛出）；phase='after-ping' 对应「ping 成功后」的
 * boot 比对（现行实现：立即 break，deadline 不参与）。时序语义由此测试钉死。
 */

export const RESTART_POLL_MS = 2_000;
export const RESTART_DEADLINE_MS = 90_000;

export function nextRestartWait({ phase, now = 0, deadlineAt = Infinity, bootChanged = false }) {
  if (phase === "before-ping") {
    return now > deadlineAt ? "timeout" : "continue";
  }
  return bootChanged ? "done" : "continue";
}

/**
 * A fetch TypeError/AbortError can mean the server accepted restart and closed
 * the connection before the response flushed. HTTP 4xx/5xx errors remain
 * definite failures and must not silently turn into a 90-second wait.
 */
export function isAmbiguousRestartRequestError(error) {
  const name = error && typeof error === "object" ? error.name : "";
  return name === "TypeError" || name === "AbortError" || name === "NetworkError";
}
