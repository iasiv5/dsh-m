/**
 * 0.7.0 Task 8：市场 pure state 分区化——分区状态工厂 / 分区 query 规范化 / 分页 reset（含 sort）/
 * 页码窗口化 / 分区 chips（标签单一事实源） / 旧混排导出已删。
 * 直接 import 源文件，不依赖 DOM/React。
 * 运行：node --test tests/client-market-state.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import * as ms from '../src/client/market-state.js'
const {
  MARKET_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  createZoneState,
  normalizeMarketQuery,
  resetPageOnFilterChange,
  normalizeMarketResponse,
  registryNotice,
  marketNotice,
  zoneChips,
  pageItems,
} = ms

describe('旧混排导出已删除（0.7.0 Task 8）', () => {
  it('sortMergedItems / splitCategories / MARKET_PAGE_SIZE 不再导出', () => {
    assert.equal(ms.sortMergedItems, undefined)
    assert.equal(ms.splitCategories, undefined)
    assert.equal(ms.MARKET_PAGE_SIZE, undefined)
  })
})

describe('分区常量与状态工厂', () => {
  it('页大小档位 24/48/96，默认 24', () => {
    assert.deepEqual(MARKET_PAGE_SIZES, [24, 48, 96])
    assert.equal(DEFAULT_PAGE_SIZE, 24)
  })

  it('createZoneState：community 默认 downloads-desc；primary 策展序 sort=null', () => {
    assert.deepEqual(createZoneState('community'), {
      zone: 'community', query: '', category: null, sort: { field: 'downloads', dir: 'desc' }, offset: 0, limit: 24,
    })
    assert.deepEqual(createZoneState('primary'), {
      zone: 'primary', query: '', category: null, sort: null, offset: 0, limit: 24,
    })
    assert.equal(createZoneState('nonsense').zone, 'community', '未知 zone 归 community')
  })
})

describe('normalizeMarketQuery（分区化）', () => {
  it('community 区：默认值 + slug 白名单 + limit clamp 1..96 默认 24 + sort 合法化', () => {
    const q = normalizeMarketQuery({}, 'community')
    assert.equal(q.zone, 'community')
    assert.equal(q.source, 'community')
    assert.equal(q.query, '')
    assert.equal(q.category, null)
    assert.equal(q.sort, null, '未传 sort 归 null（非法形状也归 null）')
    assert.equal(q.offset, 0)
    assert.equal(q.limit, 24)
    assert.equal(normalizeMarketQuery({ query: '  主题  ' }, 'community').query, '主题')
    assert.equal(normalizeMarketQuery({ category: 'memory' }, 'community').category, 'memory')
    assert.equal(normalizeMarketQuery({ category: 'tools' }, 'community').category, 'tools', '社区区接受同名 slug（真实计数键）')
    assert.equal(normalizeMarketQuery({ category: 'UI!!' }, 'community').category, null)
    assert.equal(normalizeMarketQuery({ limit: 1000 }, 'community').limit, 96)
    assert.equal(normalizeMarketQuery({ limit: 0 }, 'community').limit, 1)
    assert.equal(normalizeMarketQuery({ limit: Number.NaN }, 'community').limit, 24)
    assert.deepEqual(normalizeMarketQuery({ sort: { field: 'stars', dir: 'asc' } }, 'community').sort, { field: 'stars', dir: 'asc' })
    assert.equal(normalizeMarketQuery({ sort: { field: 'name', dir: 'asc' } }, 'community').sort, null, '非法字段归 null')
    assert.equal(normalizeMarketQuery({ sort: { field: 'stars', dir: 'up' } }, 'community').sort, null, '非法方向归 null')
  })

  it('primary 区：精选 5 ∪ slug 白名单；sort 恒 null（策展序）', () => {
    const q = normalizeMarketQuery({}, 'primary')
    assert.equal(q.source, 'primary')
    assert.equal(normalizeMarketQuery({ category: 'tools' }, 'primary').category, 'tools')
    assert.equal(normalizeMarketQuery({ category: 'memory' }, 'primary').category, 'memory')
    assert.equal(normalizeMarketQuery({ sort: { field: 'stars', dir: 'asc' } }, 'primary').sort, null)
  })

  it('primaryOnly 旧字段不再存在', () => {
    assert.equal('primaryOnly' in normalizeMarketQuery({}, 'community'), false)
  })
})

describe('resetPageOnFilterChange（含 sort）', () => {
  const prev = { query: 'a', category: 'tools', sort: { field: 'downloads', dir: 'desc' }, offset: 100, limit: 24 }
  it('query/category/sort 变化归零 offset；同筛选保留', () => {
    assert.equal(resetPageOnFilterChange(prev, { ...prev, offset: 100 }).offset, 100)
    assert.equal(resetPageOnFilterChange(prev, { ...prev, query: 'b', offset: 100 }).offset, 0)
    assert.equal(resetPageOnFilterChange(prev, { ...prev, category: 'ui', offset: 100 }).offset, 0)
    assert.equal(resetPageOnFilterChange(prev, { ...prev, sort: { field: 'stars', dir: 'desc' }, offset: 100 }).offset, 0)
    assert.equal(resetPageOnFilterChange(prev, { ...prev, sort: { field: 'downloads', dir: 'desc' }, offset: 100 }).offset, 100, '同 sort 不重置')
  })
})

describe('pageItems 页码窗口化', () => {
  it('总页数 ≤ 7 全显', () => {
    assert.deepEqual(pageItems(1, 1), [1])
    assert.deepEqual(pageItems(3, 7), [1, 2, 3, 4, 5, 6, 7])
  })
  it('大总页数窗口：1 … n-1 n n+1 … last，首末页恒在', () => {
    assert.deepEqual(pageItems(1, 20), [1, 2, '...', 20])
    assert.deepEqual(pageItems(2, 20), [1, 2, 3, '...', 20])
    assert.deepEqual(pageItems(10, 20), [1, '...', 9, 10, 11, '...', 20])
    assert.deepEqual(pageItems(20, 20), [1, '...', 19, 20])
  })
  it('current 越界钳制；totalPages 脏值安全', () => {
    assert.deepEqual(pageItems(99, 8), [1, '...', 7, 8])
    assert.deepEqual(pageItems(1, 0), [1])
  })
})

describe('zoneChips 分区构建器', () => {
  const labels = {
    agi: 'AGI 架构探索', ui: 'UI 增强', tools: '工具与能力', theme: '主题与外观', memory: '记忆',
  }
  it('primary：精选 5 类固定序（0 计数也展示）', () => {
    const chips = zoneChips({ tools: 3, market: 0 }, labels, 'primary')
    assert.deepEqual(chips.map((c) => c.id), ['market', 'tools', 'ui', 'search', 'other'])
    assert.deepEqual(chips.map((c) => c.count), [0, 3, 0, 0, 0])
  })
  it('community：已知标签在前（含 ui/tools 真实计数键）、未知 slug 尾组、0 计数精选种子跳过', () => {
    const counts = { market: 1, tools: 5, ui: 7, search: 0, other: 0, agi: 10, theme: 4, 'brand-new-slug': 2, 'empty-slug': 0 }
    const chips = zoneChips(counts, labels, 'community')
    const ids = chips.map((c) => c.id)
    assert.ok(ids.includes('agi') && ids.includes('ui') && ids.includes('tools'), '社区区含同名真实计数键')
    assert.ok(!ids.includes('search') && !ids.includes('other'), '0 计数精选种子不进社区区')
    assert.ok(!ids.includes('empty-slug'), '0 计数未知分类跳过')
    assert.equal(ids[ids.length - 1], 'brand-new-slug', '未知 slug 尾组')
    assert.equal(chips.find((c) => c.id === 'agi').label, 'AGI 架构探索')
    assert.equal(chips.find((c) => c.id === 'brand-new-slug').label, 'brand-new-slug', '未知 slug 原样渲染')
  })
  it('脏输入安全', () => {
    assert.deepEqual(zoneChips(null, null, 'community'), [])
    assert.equal(zoneChips(null, null, 'primary').length, 5)
  })
})

describe('normalizeMarketResponse（保留语义 + categoryLabels 透传）', () => {
  it('完整响应原样收敛 + community.categoryLabels 收敛', () => {
    const raw = {
      items: [{ id: 'a', name: 'A', installed: true, outdated: false }],
      total: 10, offset: 0, limit: 24,
      categoryCounts: { tools: 10, market: 0 },
      registryState: { source: 'custom-file', status: 'ready', isDefault: false, stale: false, count: 10 },
      installedComplete: true, latestComplete: true, latestTimedOut: false,
      community: { enabled: true, status: 'ready', acceptedCount: 2, categoryLabels: { theme: '主题与外观', bad: 42 } },
    }
    const page = normalizeMarketResponse(raw)
    assert.equal(page.items.length, 1)
    assert.equal(page.total, 10)
    assert.equal(page.community.categoryLabels.theme, '主题与外观')
    assert.equal(page.community.categoryLabels.bad, undefined, '非 string 值剔除')
  })

  it('缺失/错误字段给出安全空页；community 缺省形状不伪造', () => {
    for (const raw of [null, undefined, {}, { items: 'nope' }, { items: [1, 2] }]) {
      const page = normalizeMarketResponse(raw)
      assert.ok(Array.isArray(page.items))
      assert.equal(typeof page.total, 'number')
      assert.equal(page.registryState.status, 'unavailable')
      assert.equal(page.installedComplete, false)
    }
    const empty = normalizeMarketResponse(null)
    assert.deepEqual(empty.items, [])
    assert.deepEqual(empty.categoryCounts, {})
    assert.equal(empty.community.status, 'disabled')
    assert.equal(empty.community.categoryLabels, undefined)
  })
})

describe('registryNotice / marketNotice（保留语义）', () => {
  it('短状态 key，不泄露路径', () => {
    const leaky = { isDefault: false, status: 'ready', stale: false, configuredAddress: '/home/user/secret/registry.json' }
    const notice = registryNotice(leaky, 42)
    assert.ok(!JSON.stringify(notice).includes('/home/user'))
    assert.equal(registryNotice({ isDefault: true, status: 'ready', stale: false }, 10).key, 'notice.default')
    assert.equal(registryNotice({ isDefault: false, status: 'ready', stale: false }, 10).key, 'notice.custom')
    assert.equal(registryNotice({ isDefault: true, status: 'stale', stale: true }, 10).key, 'notice.stale')
  })
  it('双源语义：主 down+社区 up → communityFallback；社区 stale → communityStale', () => {
    assert.equal(marketNotice({ isDefault: true, status: 'unavailable', stale: false }, { enabled: true, status: 'ready' }).communityFallback, true)
    assert.equal(marketNotice({ isDefault: true, status: 'ready', stale: false }, { status: 'stale' }).communityStale, true)
    const silent = marketNotice({ isDefault: true, status: 'ready', stale: false }, { status: 'unavailable' })
    assert.notEqual(silent.communityStale, true)
    assert.notEqual(silent.communityFallback, true)
  })
})
