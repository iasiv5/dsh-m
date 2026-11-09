/**
 * registry-url-probe 纯逻辑直测（scripts/registry-url-probe.mjs，先例 registry-categories.test.mjs）。
 * 判定口径钉子（retro 2026-11-09 ①）：全部轮次 5xx = 探测面服务器故障 → 'warn'（fail-open，调用方
 * 不判红）；任一轮确定性非 ok（404 等）与网络异常 → 抛错（死链/域名消失证据），且与失败顺序无关。
 * fetch/sleep 全注入，零真网络。运行：node --test tests/registry-url-probe.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { probeVerdict, reachable } from '../scripts/registry-url-probe.mjs'

// 按序脚本化假 fetch：每次取下一步；步骤是状态码（数字）或抛出的 Error；耗尽后复用末步。
// 同时计数，便于断言重试次数。
const scripted = (...steps) => {
  let i = 0
  const f = async () => {
    f.calls++
    const s = steps[Math.min(i++, steps.length - 1)]
    if (s instanceof Error) throw s
    return { status: s }
  }
  f.calls = 0
  return f
}

describe('probeVerdict 状态归类', () => {
  const ok = [200, 204, 299, 405]
  const warn = [500, 502, 503, 504, 599]
  const fail = [301, 403, 404, 410, 499]
  for (const s of ok) it(`HTTP ${s} → ok`, () => assert.equal(probeVerdict(s), 'ok'))
  for (const s of warn) it(`HTTP ${s} → warn（服务器故障非死链证据）`, () => assert.equal(probeVerdict(s), 'warn'))
  for (const s of fail) it(`HTTP ${s} → fail`, () => assert.equal(probeVerdict(s), 'fail'))
})

describe('reachable（fetch/sleep 注入，零真网络）', () => {
  it('200 → ok，单次探测、零退避', async () => {
    const fetch = scripted(200)
    const sleeps = []
    const v = await reachable('https://example.com/icon.svg', { fetch, sleep: async (ms) => { sleeps.push(ms) } })
    assert.equal(v, 'ok')
    assert.equal(fetch.calls, 1)
    assert.deepEqual(sleeps, [])
  })

  it('405（HEAD 被拒）→ ok', async () => {
    const v = await reachable('https://example.com/x', { fetch: scripted(405), sleep: async () => {} })
    assert.equal(v, 'ok')
  })

  it('两轮 503 → warn 不抛（fail-open），重试一轮退避 1500ms', async () => {
    const fetch = scripted(503, 503)
    const sleeps = []
    const v = await reachable('https://example.com/x', { fetch, sleep: async (ms) => { sleeps.push(ms) } })
    assert.equal(v, 'warn')
    assert.equal(fetch.calls, 2)
    assert.deepEqual(sleeps, [1500])
  })

  it('首轮 503 次轮 200 → ok（重试恢复）', async () => {
    const v = await reachable('https://example.com/x', { fetch: scripted(503, 200), sleep: async () => {} })
    assert.equal(v, 'ok')
  })

  it('两轮 404 → 抛「URL 不可达 … HTTP 404」，重试一轮', async () => {
    const fetch = scripted(404, 404)
    const sleeps = []
    await assert.rejects(
      reachable('https://example.com/gone.svg', { fetch, sleep: async (ms) => { sleeps.push(ms) } }),
      (err) => /URL 不可达：https:\/\/example\.com\/gone\.svg（HTTP 404）/.test(err.message) && fetch.calls === 2 && sleeps.length === 1,
    )
  })

  it('[503, 404] → 抛（确定性失败即判红，不因首轮 5xx 被豁免）', async () => {
    await assert.rejects(
      reachable('https://example.com/x', { fetch: scripted(503, 404), sleep: async () => {} }),
      /URL 不可达/,
    )
  })

  it('[404, 503] → 抛（与失败顺序无关，反序同样判红）', async () => {
    await assert.rejects(
      reachable('https://example.com/x', { fetch: scripted(404, 503), sleep: async () => {} }),
      /URL 不可达/,
    )
  })

  it('网络异常两轮 → 抛错（保守 fail，可能是域名消失）', async () => {
    await assert.rejects(
      reachable('https://dead-domain.invalid/x', {
        fetch: scripted(new TypeError('fetch failed'), new TypeError('fetch failed')),
        sleep: async () => {},
      }),
      (err) => /URL 不可达.*fetch failed/.test(err.message),
    )
  })

  it('[503, 网络异常] → 抛错（5xx 与网络异常混合不构成「全部 5xx」，保守 fail）', async () => {
    await assert.rejects(
      reachable('https://example.com/x', { fetch: scripted(503, new TypeError('fetch failed')), sleep: async () => {} }),
      /URL 不可达/,
    )
  })
})
