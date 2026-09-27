/**
 * registry-probe 契约（plan Task 7）：
 * - npmjs 先 2xx → 胜出；npmmirror 先 2xx → 胜出；
 * - 一败一成 → 成者胜；双败/双超时 → null（保持默认 npmjs）；
 * - 缓存期内不发请求（fetch 次数断言）；过期后重新竞速；
 * - 并发 fastest() 共享同一次探测（inflight 去重）；
 * - 非注入路径使用 httpx fetchLimited（此处不测真实网络）。
 * 运行：npm run build && node --test tests/registry-probe.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { RegistryProbe, PROBE_URLS, PROBE_REGISTRY_BASES } from '../lib/core/registry-probe.js'

function delayStub(map, { delayMs = 0 } = {}) {
  // map: { npmjs: 'ok' | 'fail' | 'slow-ok' | 'non2xx', ... }
  const calls = []
  const fetchImpl = async (url, opts) => {
    calls.push({ url, signal: opts.signal })
    const source = url.includes('npmmirror') ? 'npmmirror' : 'npmjs'
    const mode = map[source] ?? 'fail'
    if (mode === 'ok') return { ok: true, status: 200 }
    if (mode === 'non2xx') return { ok: false, status: 500 }
    if (mode === 'slow-ok') {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, delayMs || 40)
        opts.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
      })
      return { ok: true, status: 200 }
    }
    throw new Error('network down')
  }
  return { fetchImpl, calls }
}

function clock(start = 1_000_000) {
  let now = start
  return {
    now: () => now,
    advance(ms) {
      now += ms
    },
  }
}

describe('RegistryProbe：竞速判定', () => {
  it('npmjs 2xx 且 npmmirror 失败 → npmjs', async () => {
    const { fetchImpl } = delayStub({ npmjs: 'ok', npmmirror: 'fail' })
    const probe = new RegistryProbe({ timeoutMs: 500, cacheTtlMs: 60_000, fetchImpl })
    assert.equal(await probe.fastest(), 'npmjs')
  })

  it('npmmirror 2xx 且 npmjs 失败 → npmmirror', async () => {
    const { fetchImpl } = delayStub({ npmjs: 'fail', npmmirror: 'ok' })
    const probe = new RegistryProbe({ timeoutMs: 500, cacheTtlMs: 60_000, fetchImpl })
    assert.equal(await probe.fastest(), 'npmmirror')
  })

  it('双败 → null（默认保持 npmjs）', async () => {
    const { fetchImpl } = delayStub({ npmjs: 'fail', npmmirror: 'fail' })
    const probe = new RegistryProbe({ timeoutMs: 500, cacheTtlMs: 60_000, fetchImpl })
    assert.equal(await probe.fastest(), null)
  })

  it('非 2xx（500）视同失败', async () => {
    const { fetchImpl } = delayStub({ npmjs: 'non2xx', npmmirror: 'ok' })
    const probe = new RegistryProbe({ timeoutMs: 500, cacheTtlMs: 60_000, fetchImpl })
    assert.equal(await probe.fastest(), 'npmmirror')
  })

  it('慢的一侧被 abort（胜者先到）', async () => {
    const { fetchImpl, calls } = delayStub({ npmjs: 'ok', npmmirror: 'slow-ok' }, { delayMs: 200 })
    const probe = new RegistryProbe({ timeoutMs: 500, cacheTtlMs: 60_000, fetchImpl })
    assert.equal(await probe.fastest(), 'npmjs')
    const mirrorCall = calls.find((c) => c.url === PROBE_URLS.npmmirror)
    assert.equal(mirrorCall.signal.aborted, true)
  })
})

describe('RegistryProbe：缓存与并发', () => {
  it('缓存期内不发请求（fetch 恰好 2 次）', async () => {
    const { fetchImpl, calls } = delayStub({ npmjs: 'ok', npmmirror: 'fail' })
    const time = clock()
    const probe = new RegistryProbe({ timeoutMs: 500, cacheTtlMs: 300_000, fetchImpl, now: time.now })
    await probe.fastest()
    time.advance(1_000)
    assert.equal(await probe.fastest(), 'npmjs')
    assert.equal(calls.length, 2)
  })

  it('过期后重新竞速', async () => {
    let mode = { npmjs: 'ok', npmmirror: 'fail' }
    const calls = []
    const fetchImpl = async (url) => {
      calls.push(url)
      const source = url.includes('npmmirror') ? 'npmmirror' : 'npmjs'
      if ((mode[source] ?? 'fail') === 'ok') return { ok: true, status: 200 }
      throw new Error('down')
    }
    const time = clock()
    const probe = new RegistryProbe({ timeoutMs: 500, cacheTtlMs: 100, fetchImpl, now: time.now })
    assert.equal(await probe.fastest(), 'npmjs')
    mode = { npmjs: 'fail', npmmirror: 'ok' }
    time.advance(200)
    assert.equal(await probe.fastest(), 'npmmirror')
    assert.equal(calls.length, 4) // 两轮各 2 次
  })

  it('并发 fastest 共享同一次探测（fetch 仍 2 次）', async () => {
    const { fetchImpl, calls } = delayStub({ npmjs: 'ok', npmmirror: 'fail' })
    const probe = new RegistryProbe({ timeoutMs: 500, cacheTtlMs: 60_000, fetchImpl })
    const [a, b, c] = await Promise.all([probe.fastest(), probe.fastest(), probe.fastest()])
    assert.deepEqual([a, b, c], ['npmjs', 'npmjs', 'npmjs'])
    assert.equal(calls.length, 2)
  })

  it('cachedSnapshot 反映最近结果（含 null 源）', async () => {
    const { fetchImpl } = delayStub({ npmjs: 'fail', npmmirror: 'fail' })
    const probe = new RegistryProbe({ timeoutMs: 500, cacheTtlMs: 60_000, fetchImpl })
    await probe.fastest()
    assert.deepEqual(probe.cachedSnapshot(), { source: null, checkedAt: probe.cachedSnapshot().checkedAt })
  })

  it('初始无记录 → cachedSnapshot null', () => {
    const probe = new RegistryProbe({ timeoutMs: 500, cacheTtlMs: 60_000 })
    assert.equal(probe.cachedSnapshot(), null)
  })
})

describe('常量表', () => {
  it('PROBE_URLS / PROBE_REGISTRY_BASES 键一致', () => {
    assert.deepEqual(Object.keys(PROBE_URLS), ['npmjs', 'npmmirror'])
    assert.deepEqual(Object.keys(PROBE_REGISTRY_BASES), ['npmjs', 'npmmirror'])
    assert.equal(PROBE_URLS.npmjs.startsWith(PROBE_REGISTRY_BASES.npmjs), true)
    assert.equal(PROBE_URLS.npmmirror.startsWith(PROBE_REGISTRY_BASES.npmmirror), true)
  })
})
