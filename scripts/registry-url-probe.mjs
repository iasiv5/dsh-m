/**
 * registry URL 可达性探测纯逻辑（validate-registry 用；具名导出供 tests 直测，
 * 先例 scripts/registry-categories.mjs）。判定口径（2026-11-09 PR #58 战役 retro ①）：
 * 5xx 是「探测面服务器侧故障」，从来不是 URL 已死的证据（GitHub「匿名用户激增致超时」
 * 事故实证：36 条 homepage 探测被 502/504 成片打红、purge 被 needs 连带跳过）→
 * 全部轮次为 5xx 时 fail-open warn；404 等确定性非 ok / 网络异常 → 抛错判红
 * （网络异常可能是域名消失，保守 fail）。
 */

/**
 * 把探测 HTTP 状态归类为 'ok' | 'warn' | 'fail'。
 * @param {number} status
 * @returns {'ok'|'warn'|'fail'}
 */
export function probeVerdict(status) {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 405) return 'ok' // HEAD 被拒但资源存在（GET 可达），沿用旧豁免
  if (status >= 500 && status < 600) return 'warn'
  return 'fail'
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 探测 URL 可达性：两轮 HEAD，中间退避 1.5s（只跨瞬时抖动，不跨事故窗口）。
 * - 任一轮 ok → 'ok'；
 * - 两轮都是 5xx → 'warn'（fail-open，调用方不判红）；
 * - 其余（任一轮 404 等确定性失败、或网络异常）→ 抛错，调用方按 ✗ 判红。
 * 判定与失败顺序无关：[503, 404] 与 [404, 503] 都抛错。
 * @param {string} url
 * @param {{fetch?: (url: string, init: object) => Promise<{status: number}>, sleep?: (ms: number) => Promise<void>}} [deps] 测试注入点
 * @returns {Promise<'ok'|'warn'>}
 */
export async function reachable(url, deps = {}) {
  const depFetch = deps.fetch || ((u, init) => fetch(u, init))
  const depSleep = deps.sleep || defaultSleep
  let allServerErr = true
  let detail = ''
  for (let i = 0; i < 2; i++) {
    if (i > 0) await depSleep(1500)
    try {
      const res = await depFetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': 'dsh-m-registry-check' } })
      const verdict = probeVerdict(res.status)
      if (verdict === 'ok') return 'ok'
      if (verdict !== 'warn') allServerErr = false
      detail = `HTTP ${res.status}`
    } catch (err) {
      allServerErr = false
      detail = err instanceof Error ? err.message : String(err)
    }
  }
  if (allServerErr) return 'warn'
  throw new Error(`URL 不可达：${url}（${detail}）`)
}
