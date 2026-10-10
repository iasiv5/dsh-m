/**
 * ADR-0016 L2：物化合并市场（merged-market.ts）——验收断言①②③ + 胜者等价（R1-6/R2-3）+ cap 淘汰。
 * 运行：npm run build && node --test tests/merged-market.test.mjs
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  mergedOutcome,
  communityOutcome,
  mergeRegistries,
  matchInstalledByEntry,
  _resetMergedMarketForTests,
  _mergedMarketStatsForTests,
} from '../lib/core/merged-market.js'
import { adaptCommunityCatalog } from '../lib/core/community-adapter.js'

// ---------- 合成 fixture ----------

function readyRegistry(plugins, overrides = {}) {
  return {
    configuredAddress: '',
    activeAddress: 'https://example.com/r.json',
    source: 'default-raw',
    status: 'ready',
    isDefault: true,
    stale: false,
    fetchedAt: '2026-10-10T00:00:00.000Z',
    errors: [],
    count: plugins.length,
    registry: { version: 1, plugins },
    ...overrides,
  }
}

function communityRaw(name, owner, props = {}) {
  return {
    name,
    owner,
    url: `https://github.com/${owner}/${name}`,
    category: 'c-ui',
    description: { en: `${name} en`, zh: `${name} 中文` },
    npm: `${name}-pkg`,
    downloads: 100,
    ...props,
  }
}

function communityTaskValue(plugins, stateOverrides = {}) {
  return {
    state: {
      enabled: true,
      status: 'ready',
      version: '2026.10.10.1',
      checkedAt: '2026-10-10T00:00:00.000Z',
      fetchedAt: '2026-10-10T00:00:00.000Z',
      route: 'jsdelivr',
      count: plugins.length,
      errors: [],
      warnings: [],
      ...stateOverrides,
    },
    catalog: {
      name: 'awesome-dsh-plugin',
      url: 'https://awesome.example',
      source: 'https://github.com/x/y',
      updated: '2026-10-10',
      count: plugins.length,
      categories: { 'c-ui': { en: 'C UI', zh: 'UI' } },
      plugins,
    },
  }
}

const PRIMARY = [
  { id: 'p-1', name: 'P1', description: 'd1', category: 'tools', tags: [], source: 'npm', npm: 'pkg-1' },
  { id: 'p-2', name: 'P2', description: 'd2', category: 'ui', tags: [], source: 'npm', npm: 'pkg-2', github: 'own/dual' },
  { id: 'clashown--keepc', name: 'P3', description: 'd3', category: 'market', tags: [], source: 'npm', npm: 'pkg-3' },
]

const COMMUNITY_RAW = [
  communityRaw('dualrepo', 'own', { npm: 'dualrepo-pkg', url: 'https://github.com/own/dual' }), // github 撞 p2 → displaced
  communityRaw('keepc', 'clashown', { npm: 'clash-keepc-pkg' }), // id 撞 p3 → displaced（id-让位）
  communityRaw('namehit', 'nh', { npm: 'gold-name-pkg' }),     // 无撞 → 收录
]

function installed(patch) {
  return { name: '', description: '', homepage: '', dsh: true, version: '1.0.0', spec: '^1.0.0', source: 'npm', ...patch }
}

const CFG = {}

function call(overrides = {}) {
  return mergedOutcome({
    namespace: 'host',
    profile: 'web',
    cfg: CFG,
    registry: overrides.registry ?? readyRegistry(PRIMARY),
    communityTask: 'communityTask' in overrides ? overrides.communityTask : Promise.resolve(communityTaskValue(COMMUNITY_RAW)),
    deadlineAt: overrides.deadlineAt ?? Date.now() + 5000,
    ...overrides.input,
  })
}

// ---------- 用例 ----------

describe('L2 物化合并市场（ADR-0016）', () => {
  beforeEach(() => {
    _resetMergedMarketForTests()
  })

  it('(a) 断言①代命中：同身份两调 merged 引用同一、builds===1、hits>=1；summary 取当次 state', async () => {
    const first = await call()
    const stats1 = _mergedMarketStatsForTests()
    assert.equal(stats1.builds, 1)
    assert.equal(stats1.hits, 0)

    const secondState = { checkedAt: '2026-10-10T01:00:00.000Z' }
    const second = await call({ communityTask: Promise.resolve(communityTaskValue(COMMUNITY_RAW, secondState)) })
    const stats2 = _mergedMarketStatsForTests()

    assert.equal(stats2.builds, 1, '身份未变 → 不重建')
    assert.ok(stats2.hits >= 1, '命中计数')
    assert.equal(second.merged, first.merged, '同身份返回同一 merged 数组引用')
    assert.equal(second.summary.checkedAt, '2026-10-10T01:00:00.000Z', 'summary 由当次 state 现算（checkedAt 不冻结）')
    assert.equal(second.summary.status, 'ready')
  })

  it('(b) 断言②并发去重：延迟 resolve 的 task + 双并发 → builds===1 且引用同一', async () => {
    const delayed = new Promise((resolve) => {
      setTimeout(() => resolve(communityTaskValue(COMMUNITY_RAW)), 20)
    })
    const [a, b] = await Promise.all([call({ communityTask: delayed }), call({ communityTask: delayed })])
    assert.equal(_mergedMarketStatsForTests().builds, 1, '同步临界区：只建一次')
    assert.equal(a.merged, b.merged, '并发共享同一代')
    assert.equal(a.summary.status, 'ready')
  })

  it('(c) 断言③失败不落代：deadline/unavailable/task=null 透传且 builds===0，随后正常调用无残留', async () => {
    // deadline 逃逸：悬挂 task + 已过期 deadline
    const hanging = new Promise(() => {})
    const timeout = await call({ communityTask: hanging, deadlineAt: Date.now() - 1 })
    assert.equal(timeout.summary.status, 'unavailable')
    assert.ok(timeout.summary.errors.some((e) => e.includes('超时')))
    assert.equal(_mergedMarketStatsForTests().builds, 0)

    // unavailable 形态
    const unavailable = await call({
      communityTask: Promise.resolve({
        state: { enabled: true, status: 'unavailable', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: ['x'], warnings: [] },
        catalog: null,
      }),
    })
    assert.equal(unavailable.summary.status, 'unavailable')
    assert.equal(_mergedMarketStatsForTests().builds, 0)

    // task=null（source=primary）
    const skipped = await call({ communityTask: null })
    assert.equal(skipped.summary.status, 'skipped')
    assert.equal(_mergedMarketStatsForTests().builds, 0)

    // 随后正常调用：无任何旧形态残留
    const normal = await call()
    assert.equal(_mergedMarketStatsForTests().builds, 1)
    assert.equal(normal.summary.status, 'ready')
    assert.deepEqual(normal.summary.errors, [])
  })

  it('(d) 身份变即换代：fetchedAt 变 → 新引用、builds +1', async () => {
    const first = await call()
    const second = await call({ registry: readyRegistry(PRIMARY, { fetchedAt: '2026-10-11T00:00:00.000Z' }) })
    assert.equal(_mergedMarketStatsForTests().builds, 2)
    assert.notEqual(second.merged, first.merged)
  })

  it('(e) cap=4：第 5 身份淘汰最早键，重访被淘汰身份 → 重建 + evictions 计数', async () => {
    for (let i = 1; i <= 5; i++) {
      await call({ registry: readyRegistry(PRIMARY, { fetchedAt: `2026-10-${10 + i}T00:00:00.000Z` }) })
    }
    const stats5 = _mergedMarketStatsForTests()
    assert.equal(stats5.builds, 5)
    assert.ok(stats5.evictions >= 1, `cap=4 淘汰（实际 ${stats5.evictions}）`)
    // 重访最早身份（T1 已被淘汰）→ 重建
    await call({ registry: readyRegistry(PRIMARY) })
    const stats6 = _mergedMarketStatsForTests()
    assert.equal(stats6.builds, 6)
    assert.ok(stats6.evictions >= 2)
  })

  it('(f) 胜者等价（R1-6/R2-3）：四场景 × 双域全等——读路径 merged 域 / 安装路径全量域', async () => {
    const outcome = await call()
    const adaptedAll = adaptCommunityCatalog(communityTaskValue(COMMUNITY_RAW).catalog).entries
    const fullDomain = [...PRIMARY, ...adaptedAll]
    const merge = mergeRegistries(PRIMARY, adaptedAll)
    assert.equal(merge.displaced, 2, 'fixture 预期：github 撞位 + id-让位 各一')

    const installedSet = [
      installed({ pkg: 'pkg-2', name: 'irrelevant', spec: '^1.0.0' }),                       // npm/pkg 准则（主清单双源条目）
      installed({ pkg: 'x-pkg', name: 'gold-name-pkg', spec: '^1.0.0' }),                    // npm/name 准则（社区条目）
      installed({ pkg: 'y-pkg', name: 'Y', spec: 'github:own/dual', source: 'github' }),     // github spec 准则（主 npm 条目带 github）
      installed({ pkg: 'dualrepo-pkg', name: '', spec: '^1.0.0' }),                          // displaced 条目（R2-3 核心：merged 域 miss、全量域命中）
      installed({ pkg: 'clash-keepc-pkg', name: '', spec: '^1.0.0' }),                       // id-让位条目（同上）
    ]
    for (const it of installedSet) {
      const readExpected = outcome.merged.find((e) => matchInstalledByEntry(e, [it]) !== undefined)
      const installExpected = fullDomain.find((e) => matchInstalledByEntry(e, [it]) !== undefined)
      assert.equal(outcome.lookupInstalled(it)?.id, readExpected?.id, `读路径等价（pkg=${it.pkg}）`)
      assert.equal(outcome.lookupInstalledAll(it)?.id, installExpected?.id, `安装路径等价（pkg=${it.pkg}）`)
    }
    // id-让位可装性（R2-3）：findById 全量域含 displaced；primary 同 id 恒优先（今日语义）
    assert.equal(outcome.findById('clashown--keepc')?.npm, 'pkg-3', 'id-让位：primary 同 id 优先')
    assert.equal(outcome.findById('nh--namehit')?.id, 'nh--namehit', '非撞位社区 id 全量域可查')
    // displaced 条目经全量域仍可升级（今日行为），merged 域不可见
    const displacedTarget = installed({ pkg: 'dualrepo-pkg', name: '', spec: '^1.0.0' })
    assert.equal(outcome.lookupInstalled(displacedTarget)?.id, undefined, 'merged 域不含 displaced')
    assert.equal(outcome.lookupInstalledAll(displacedTarget)?.id, 'own--dualrepo', '全量域命中 displaced（今日可升）')
  })

  it('communityOutcome（迁入原样）：无 memo——同参两调均现算（builds 恒 0）', async () => {
    const task = Promise.resolve(communityTaskValue(COMMUNITY_RAW))
    const a = await communityOutcome(task, Date.now() + 5000, PRIMARY)
    const b = await communityOutcome(task, Date.now() + 5000, PRIMARY)
    assert.equal(a.summary.status, 'ready')
    assert.notEqual(a.merged, b.merged, '无 memo：每次现算新数组（getCommunitySummary / 降级路径专用）')
    assert.equal(_mergedMarketStatsForTests().builds, 0)
    assert.equal(_mergedMarketStatsForTests().hits, 0)
  })
})
