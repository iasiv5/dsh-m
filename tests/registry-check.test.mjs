/**
 * Task 4：Registry 条目可达性诊断（probe 统计、稳定顺序、并发、deadline、abort、截断）。
 * 运行：npm run build && node --test tests/registry-check.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { checkRegistryEntries, defaultRegistryCheckDeps } from '../lib/core/registry-check.js'
import { validateRegistry } from '../lib/core/registry.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function entry(overrides = {}) {
  return {
    id: 'e',
    name: 'E',
    description: 'entry',
    category: 'tools',
    tags: [],
    source: 'npm',
    npm: 'pkg',
    ...overrides,
  }
}

function registryOf(plugins) {
  return { version: 1, plugins }
}

function trackingDeps(overrides = {}) {
  let inFlight = 0
  const state = { maxInFlight: 0, started: [] }
  const track = (name) => async () => {
    state.started.push(name)
    inFlight += 1
    state.maxInFlight = Math.max(state.maxInFlight, inFlight)
    await sleep(1)
    inFlight -= 1
    return true
  }
  const deps = {
    npmLatest: async () => ({}),
    githubLatestTag: async () => ({ tag: 'v1', sha: 'a'.repeat(40) }),
    reachable: async () => true,
  }
  // 用 track 包装以记录并发
  const wrapped = {
    npmLatest: async (pkg, t, s) => { await track('npm')(); return deps.npmLatest(pkg, t, s) },
    githubLatestTag: async (repo, t, s) => { await track('github')(); return deps.githubLatestTag(repo, t, s) },
    reachable: async (url, t, s) => { await track('reachable')(); return deps.reachable(url, t, s) },
  }
  return { deps: { ...wrapped, ...overrides }, state }
}

describe('checkRegistryEntries：统计语义', () => {
  it('checked/passed/failed 统计 probe 次数而不是条目数', async () => {
    const { deps } = trackingDeps()
    const registry = registryOf([
      entry({ id: 'a', npm: 'pkg-a', homepage: 'https://a.example.com' }),
      entry({ id: 'b', source: 'github', npm: undefined, github: 'o/r', icon: 'https://b.example.com/i.png' }),
    ])
    const res = await checkRegistryEntries(registry, { deadlineMs: 5000 }, deps)
    assert.equal(res.checked, 4, 'npm+homepage+github+icon = 4 个 probe')
    assert.equal(res.passed, 4)
    assert.equal(res.failed, 0)
    assert.equal(res.truncated, false)
    assert.deepEqual(res.issues, [])
  })

  it('失败 probe 生成 issue 且消息稳定', async () => {
    const { deps } = trackingDeps({
      npmLatest: async (pkg) => { if (pkg === 'bad') throw new Error('HTTP 404') },
      reachable: async (url) => url !== 'https://down.example.com',
    })
    const registry = registryOf([
      entry({ id: 'good', npm: 'ok' }),
      entry({ id: 'bad', npm: 'bad', homepage: 'https://down.example.com' }),
    ])
    const res = await checkRegistryEntries(registry, { deadlineMs: 5000 }, deps)
    assert.equal(res.checked, 3)
    assert.equal(res.passed, 1)
    assert.equal(res.failed, 2)
    assert.equal(res.issues.length, 2)
    assert.deepEqual(
      res.issues.map((i) => [i.id, i.field]),
      [['bad', 'npm'], ['bad', 'homepage']],
    )
  })
})

describe('checkRegistryEntries：并发与 deadline', () => {
  it('默认/异常 concurrency 均 ≤ 8，正数向下取整并 clamp 1–8', async () => {
    const many = Array.from({ length: 60 }, (_, i) => entry({ id: `p-${i}`, npm: `pkg-${i}` }))
    for (const concurrency of [undefined, NaN, Infinity, 0, -3]) {
      const { deps, state } = trackingDeps()
      await checkRegistryEntries(registryOf(many), { concurrency, deadlineMs: 5000 }, deps)
      assert.ok(state.maxInFlight <= 8, `concurrency=${concurrency} 最大并发 ${state.maxInFlight}`)
    }
    {
      const { deps, state } = trackingDeps()
      await checkRegistryEntries(registryOf(many), { concurrency: 3.7, deadlineMs: 5000 }, deps)
      assert.equal(state.maxInFlight, 3, '3.7 → 3')
    }
    {
      const { deps, state } = trackingDeps()
      await checkRegistryEntries(registryOf(many), { concurrency: 1, deadlineMs: 5000 }, deps)
      assert.equal(state.maxInFlight, 1)
    }
  })

  it('永不 resolve 的 probe 在 deadline 后返回 partial 统计而不永久等待', async () => {
    const registry = registryOf([
      entry({ id: 'hang', npm: 'hang-pkg' }),
      entry({ id: 'ok', npm: 'ok-pkg' }),
    ])
    const { deps } = trackingDeps({
      npmLatest: async (pkg) => {
        if (pkg === 'hang-pkg') return new Promise(() => {})
        return {}
      },
    })
    const startedAt = Date.now()
    const res = await checkRegistryEntries(registry, { deadlineMs: 60 }, deps)
    assert.ok(Date.now() - startedAt < 5000, '不应永久等待')
    assert.equal(res.checked, 2, '已发起的 probe 计入 checked')
    assert.equal(res.passed, 1)
    assert.equal(res.failed, 1, '未收敛 probe 计为失败')
    assert.ok(res.issues.some((i) => i.id === 'hang' && /deadline|超时/.test(i.message)))
  })

  it('deadline 后不启动新 probe', async () => {
    const many = Array.from({ length: 200 }, (_, i) => entry({ id: `p-${i}`, npm: `pkg-${i}` }))
    const { deps } = trackingDeps({
      npmLatest: async () => { await sleep(5); return {} },
    })
    const res = await checkRegistryEntries(registryOf(many), { concurrency: 1, deadlineMs: 50 }, deps)
    assert.ok(res.checked < 200, `deadline 后应停止启动，实际 ${res.checked}`)
    assert.equal(res.checked, res.passed + res.failed, '已启动 probe 全部收敛并计入统计')
  })

  it('外部 signal abort 后停止启动新 probe 并正常返回', async () => {
    const many = Array.from({ length: 100 }, (_, i) => entry({ id: `p-${i}`, npm: `pkg-${i}` }))
    const { deps } = trackingDeps()
    const ac = new AbortController()
    const before = JSON.parse(JSON.stringify(registryOf(many)))
    setTimeout(() => ac.abort(), 5)
    const res = await checkRegistryEntries(registryOf(many), { deadlineMs: 60_000, signal: ac.signal }, deps)
    assert.ok(res.checked < 100, `abort 后不再启动，实际 ${res.checked}`)
    assert.deepEqual(registryOf(many), before, '输入 registry 不被修改')
  })
})

describe('checkRegistryEntries：issue 截断与顺序', () => {
  it('最多返回 100 个 issue，truncated 标记，但统计继续到全部完成', async () => {
    const many = Array.from({ length: 120 }, (_, i) => entry({ id: `p-${i}`, npm: `bad-${i}` }))
    const { deps } = trackingDeps({
      npmLatest: async () => { throw new Error('down') },
    })
    const res = await checkRegistryEntries(registryOf(many), { deadlineMs: 30_000 }, deps)
    assert.equal(res.checked, 120)
    assert.equal(res.failed, 120)
    assert.equal(res.issues.length, 100)
    assert.equal(res.truncated, true)
  })

  it('issue 按 registry 条目顺序与字段顺序稳定（与完成顺序无关）', async () => {
    const registry = registryOf([
      entry({ id: 'z', npm: 'z-pkg', github: 'z/r', homepage: 'https://z.example.com', icon: 'https://z.example.com/i.png' }),
      entry({ id: 'a', npm: 'a-pkg', github: 'a/r', homepage: 'https://a.example.com', icon: 'https://a.example.com/i.png' }),
    ])
    const { deps } = trackingDeps({
      npmLatest: async () => { await sleep(Math.random() * 6); throw new Error('x') },
      githubLatestTag: async () => { await sleep(Math.random() * 6); throw new Error('x') },
      reachable: async (url) => { await sleep(Math.random() * 6); return url.endsWith('.png') },
    })
    const res = await checkRegistryEntries(registry, { deadlineMs: 30_000 }, deps)
    const keys = res.issues.map((i) => `${i.id}:${i.field}`)
    // 条目顺序 z → a；字段顺序 npm → github → homepage → icon（icon 可达不产生 issue）
    assert.deepEqual(keys.filter((k) => k.startsWith('z:')), ['z:npm', 'z:github', 'z:homepage'])
    assert.deepEqual(keys.filter((k) => k.startsWith('a:')), ['a:npm', 'a:github', 'a:homepage'])
  })
})

describe('defaultRegistryCheckDeps', () => {
  it('四个依赖函数都存在', () => {
    const deps = defaultRegistryCheckDeps()
    for (const key of ['npmLatest', 'githubLatestTag', 'reachable']) {
      assert.equal(typeof deps[key], 'function')
    }
  })

  it('官方 registry.json 可执行诊断（全部可达时零 issue）', async () => {
    const { readFileSync } = await import('node:fs')
    const raw = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'))
    const parsed = validateRegistry(raw)
    assert.equal(parsed.ok, true)
    const { deps } = trackingDeps({
      npmLatest: async () => ({}),
      githubLatestTag: async () => ({ tag: 'v1', sha: 'a'.repeat(40) }),
      reachable: async () => true,
    })
    const res = await checkRegistryEntries(parsed.registry, { deadlineMs: 10_000 }, deps)
    assert.equal(res.failed, 0)
    assert.equal(res.truncated, false)
  })
})
