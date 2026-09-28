/**
 * Task 7：市场 pure state（query 规范化、分页 reset、response narrowing、短 notice 隐私）。
 * 直接 import 源文件，不依赖 DOM/React。
 * 运行：node --test tests/client-market-state.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MARKET_PAGE_SIZE,
  normalizeMarketQuery,
  resetPageOnFilterChange,
  normalizeMarketResponse,
  registryNotice,
} from '../src/client/market-state.js'

describe('normalizeMarketQuery', () => {
  it('默认值：空 query、null category、offset 0、limit 50', () => {
    assert.deepEqual(normalizeMarketQuery({}), { query: '', category: null, offset: 0, limit: MARKET_PAGE_SIZE, primaryOnly: false })
    assert.equal(MARKET_PAGE_SIZE, 50)
  })

  it('query trim；category 白名单外归 null；offset 负数/NaN/浮点归一；limit clamp 1..50', () => {
    assert.equal(normalizeMarketQuery({ query: '  主题  ' }).query, '主题')
    assert.equal(normalizeMarketQuery({ category: 'nope' }).category, 'nope', 'Task 8：合法形状的社区 slug 放行（开放集）')
    assert.equal(normalizeMarketQuery({ category: 'NOPE!' }).category, null, '非法形状仍归 null')
    assert.equal(normalizeMarketQuery({ category: 'tools' }).category, 'tools')
    assert.equal(normalizeMarketQuery({ offset: -5 }).offset, 0)
    assert.equal(normalizeMarketQuery({ offset: Number.NaN }).offset, 0)
    assert.equal(normalizeMarketQuery({ offset: 10.9 }).offset, 10)
    assert.equal(normalizeMarketQuery({ limit: 1000 }).limit, 50)
    assert.equal(normalizeMarketQuery({ limit: 0 }).limit, 1)
    assert.equal(normalizeMarketQuery({ limit: Number.NaN }).limit, MARKET_PAGE_SIZE)
  })
})

describe('resetPageOnFilterChange', () => {
  it('query/category 变化时 offset 归零，否则保留', () => {
    const prev = { query: 'a', category: 'tools', offset: 100, limit: 50 }
    assert.equal(resetPageOnFilterChange(prev, { ...prev, offset: 100 }).offset, 100)
    assert.equal(resetPageOnFilterChange(prev, { ...prev, query: 'b', offset: 100 }).offset, 0)
    assert.equal(resetPageOnFilterChange(prev, { ...prev, category: 'ui', offset: 100 }).offset, 0)
  })
})

describe('normalizeMarketResponse', () => {
  it('完整响应原样收敛', () => {
    const raw = {
      items: [{ id: 'a', name: 'A', installed: true, outdated: false }],
      total: 10,
      offset: 0,
      limit: 50,
      categoryCounts: { tools: 10, market: 0 },
      registryState: { configuredAddress: '/tmp/x.json', source: 'custom-file', status: 'ready', isDefault: false, stale: false, count: 10 },
      installedComplete: true,
      latestComplete: true,
      latestTimedOut: false,
    }
    const page = normalizeMarketResponse(raw)
    assert.equal(page.items.length, 1)
    assert.equal(page.total, 10)
    assert.equal(page.limit, 50)
    assert.equal(page.registryState.source, 'custom-file')
    assert.equal(page.registryState.status, 'ready')
    assert.equal(page.installedComplete, true)
  })

  it('缺失/错误字段给出安全空页', () => {
    for (const raw of [null, undefined, {}, { items: 'nope' }, { items: [1, 2] }]) {
      const page = normalizeMarketResponse(raw)
      assert.ok(Array.isArray(page.items))
      assert.equal(typeof page.total, 'number')
      assert.equal(page.registryState.status, 'unavailable')
      assert.equal(page.installedComplete, false)
      assert.equal(page.latestTimedOut, false)
    }
    const empty = normalizeMarketResponse(null)
    assert.deepEqual(empty.items, [])
    assert.equal(empty.total, 0)
    assert.deepEqual(empty.categoryCounts, {})
  })

  it('registryState 部分字段缺失时安全补全', () => {
    const page = normalizeMarketResponse({ registryState: { source: 'custom-cache', stale: true } })
    assert.equal(page.registryState.source, 'custom-cache')
    assert.equal(page.registryState.stale, true)
    assert.equal(page.registryState.status, 'unavailable')
    assert.deepEqual(page.registryState.errors, [])
    assert.equal(page.registryState.isDefault, true)
  })
})

describe('registryNotice', () => {
  it('按 summary 返回短状态 key，不泄露路径', () => {
    const leaky = {
      isDefault: false,
      status: 'ready',
      stale: false,
      configuredAddress: '/home/user/secret/registry.json',
      activeAddress: '/home/user/secret/registry.json',
    }
    const notice = registryNotice(leaky, 42)
    assert.ok(!JSON.stringify(notice).includes('/home/user'))
    assert.equal(notice.count, 42)

    assert.equal(registryNotice({ isDefault: true, status: 'ready', stale: false }, 10).key, 'notice.default')
    assert.equal(registryNotice({ isDefault: false, status: 'ready', stale: false }, 10).key, 'notice.custom')
    assert.equal(registryNotice({ isDefault: true, status: 'stale', stale: true }, 10).key, 'notice.stale')
    assert.equal(registryNotice({ isDefault: false, status: 'unavailable', stale: false }, 10).key, 'notice.unavailable')
  })
})

// ---------- M1 Task 8：合并市场客户端 pure state ----------

import {
  normalizeMarketQuery as normQ2,
  normalizeMarketResponse as normR2,
  splitCategories,
  marketNotice,
  sortMergedItems,
} from '../src/client/market-state.js'

describe('M1 Task 8：normalizeMarketQuery 扩展', () => {
  it('社区开放 slug 放行、非法 slug 归 null、primaryOnly 布尔收敛', () => {
    assert.equal(normQ2({ category: 'memory' }).category, 'memory')
    assert.equal(normQ2({ category: 'my-slug' }).category, 'my-slug')
    assert.equal(normQ2({ category: 'UI!!' }).category, null)
    assert.equal(normQ2({ category: 'a'.repeat(33) }).category, null)
    assert.equal(normQ2({ category: 'tools' }).category, 'tools', '精选分类照旧')
    assert.equal(normQ2({ primaryOnly: true }).primaryOnly, true)
    assert.equal(normQ2({}).primaryOnly, false)
    assert.equal(normQ2({ primaryOnly: 'yes' }).primaryOnly, false)
  })
})

describe('M1 Task 8：normalizeMarketResponse community 缺省形状', () => {
  it('缺失 community → enabled:false/disabled 缺省（不伪造计数）', () => {
    const page = normR2({})
    assert.deepEqual(page.community, {
      enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null,
      route: null, acceptedCount: 0, upstreamCount: null, displaced: 0,
      skippedDirty: 0, skippedSubpathNoNpm: 0, errors: [], warnings: [],
    })
  })
  it('合法 community 原样收敛；脏值回退缺省', () => {
    const ready = { enabled: true, status: 'ready', version: 'v', acceptedCount: 2, upstreamCount: 3, displaced: 1, skippedDirty: 0, skippedSubpathNoNpm: 0, errors: [], warnings: [] }
    assert.equal(normR2({ community: ready }).community.acceptedCount, 2)
    assert.equal(normR2({ community: 'x' }).community.status, 'disabled')
    assert.equal(normR2({ community: { status: 42 } }).community.status, 'disabled')
  })
})

describe('M1 Task 8：splitCategories 共享桶规则', () => {
  const counts = {
    market: 1, tools: 3, ui: 5, search: 0, other: 2,           // 精选 5（ui/tools/market 为共享桶）
    agi: 10, memory: 7, theme: 4,                               // 已知社区分类
    'brand-new-slug': 1,                                        // 未知 → 新分类临时组
  }
  it('精选 5 恒在；共享桶 ui/tools/market 不重复进社区组', () => {
    const r = splitCategories(counts)
    assert.deepEqual(r.curated.map((c) => c.id), ['market', 'tools', 'ui', 'search', 'other'])
    assert.ok(!r.community.some((c) => ['ui', 'tools', 'market'].includes(c.id)), '共享桶不重复')
  })
  it('已知社区分类带中文标签与计数；未知 id 进临时组原样渲染', () => {
    const r = splitCategories(counts)
    const agi = r.community.find((c) => c.id === 'agi')
    assert.equal(agi.label, 'AGI 架构探索')
    assert.equal(agi.count, 10)
    assert.deepEqual(r.unknown.map((c) => c.id), ['brand-new-slug'])
    assert.equal(r.unknown[0].count, 1)
  })
  it('空/脏输入安全', () => {
    const r = splitCategories(null)
    assert.equal(r.curated.length, 5)
    assert.deepEqual(r.community, [])
    assert.deepEqual(r.unknown, [])
  })
})

describe('M1 Task 8：marketNotice 双源语义', () => {
  const registryDown = { isDefault: true, status: 'unavailable', stale: false }
  const communityUp = { enabled: true, status: 'ready' }
  it('主 down + 社区 up → 不可用横幅 + communityFallback（Q42 显示社区）', () => {
    const n = marketNotice(registryDown, communityUp)
    assert.equal(n.key, 'notice.unavailable')
    assert.equal(n.communityFallback, true)
    assert.notEqual(n.communityStale, true)
  })
  it('社区 stale → communityStale 显式标注；unavailable → 静默（无社区字段）', () => {
    assert.equal(marketNotice({ isDefault: true, status: 'ready', stale: false }, { status: 'stale' }).communityStale, true)
    const silent = marketNotice({ isDefault: true, status: 'ready', stale: false }, { status: 'unavailable' })
    assert.notEqual(silent.communityStale, true)
    assert.notEqual(silent.communityFallback, true)
  })
  it('主 ready + 社区 ready → 正常 key、无 fallback', () => {
    const n = marketNotice({ isDefault: true, status: 'ready', stale: false }, communityUp)
    assert.equal(n.key, 'notice.default')
    assert.notEqual(n.communityFallback, true)
  })
})

describe('M1 Task 8：sortMergedItems', () => {
  it('主清单置顶原序 + 社区按 downloads 降序、无数据按名称', () => {
    const items = [
      { id: 'c-2', community: true, name: 'zz', downloads: 900 },
      { id: 'p-0', name: 'A' },
      { id: 'c-1', community: true, name: 'aa', downloads: null },
      { id: 'p-1', name: 'B' },
      { id: 'c-3', community: true, name: 'mm', downloads: 100 },
    ]
    assert.deepEqual(sortMergedItems(items).map((it) => it.id), ['p-0', 'p-1', 'c-2', 'c-3', 'c-1'])
  })
})
