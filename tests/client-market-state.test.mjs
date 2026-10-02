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
      zone: 'primary', query: '', category: null, sort: null, offset: 0, limit: 96,
    }, 'primary 单页直出上限 96（Task 11）')
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

  it('primary 区：策展五桶 ∪ slug 白名单；sort 恒 null（策展序）', () => {
    const q = normalizeMarketQuery({}, 'primary')
    assert.equal(q.source, 'primary')
    assert.equal(normalizeMarketQuery({ category: 'essentials' }, 'primary').category, 'essentials')
    assert.equal(normalizeMarketQuery({ category: 'cui-picks' }, 'primary').category, 'cui-picks')
    assert.equal(normalizeMarketQuery({ category: 'memory' }, 'primary').category, 'memory')
    assert.equal(normalizeMarketQuery({ category: 'tools' }, 'primary').category, 'tools', '旧功能分类退出策展桶后仍可作开放 slug 命中自定义源')
    assert.equal(normalizeMarketQuery({ category: 'UI!!' }, 'primary').category, null)
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
  it('primary：策展五桶固定序（0 计数也展示）', () => {
    const chips = zoneChips({ essentials: 3 }, labels, 'primary')
    assert.deepEqual(chips.map((c) => c.id), ['essentials', 'cui-picks', 'self-dev', 'tencent-lighthouse', 'watchlist'])
    assert.deepEqual(chips.map((c) => c.count), [3, 0, 0, 0, 0])
    assert.deepEqual(chips.map((c) => c.labelKey), ['cat.essentials', 'cat.cui-picks', 'cat.self-dev', 'cat.tencent-lighthouse', 'cat.watchlist'])
  })
  it('community：已知标签在前（含 ui/tools 真实计数键）、未知 slug 尾组、0 计数跳过', () => {
    const counts = { market: 1, tools: 5, ui: 7, search: 0, other: 0, agi: 10, theme: 4, 'brand-new-slug': 2, 'empty-slug': 0 }
    const chips = zoneChips(counts, labels, 'community')
    const ids = chips.map((c) => c.id)
    assert.ok(ids.includes('agi') && ids.includes('ui') && ids.includes('tools'), '社区区含同名真实计数键')
    assert.ok(!ids.includes('search') && !ids.includes('other'), '0 计数键不进社区区')
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

describe('normalizeMarketResponse（保留语义 + categoryLabels/categoryLabelsEn 透传）', () => {
  it('完整响应原样收敛 + community.categoryLabels 收敛', () => {
    const raw = {
      items: [{ id: 'a', name: 'A', installed: true, outdated: false }],
      total: 10, offset: 0, limit: 24,
      categoryCounts: { tools: 10, market: 0 },
      registryState: { source: 'custom-file', status: 'ready', isDefault: false, stale: false, count: 10 },
      installedComplete: true, latestComplete: true, latestTimedOut: false,
      community: {
        enabled: true, status: 'ready', acceptedCount: 2,
        categoryLabels: { theme: '主题与外观', bad: 42 },
        categoryLabelsEn: { theme: 'Themes & Appearance', bad: 42 },
      },
    }
    const page = normalizeMarketResponse(raw)
    assert.equal(page.items.length, 1)
    assert.equal(page.total, 10)
    assert.equal(page.community.categoryLabels.theme, '主题与外观')
    assert.equal(page.community.categoryLabels.bad, undefined, '非 string 值剔除')
    assert.equal(page.community.categoryLabelsEn.theme, 'Themes & Appearance')
    assert.equal(page.community.categoryLabelsEn.bad, undefined, '非 string 值剔除')
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
    assert.equal(empty.community.categoryLabelsEn, undefined)
  })
})

describe('registryNotice / marketNotice（0.7.1：信息性来源横幅退役）', () => {
  it('短状态只保留错误态 unavailable；默认/自定义/缓存 stale 一律 null（不泄露路径）', () => {
    const leaky = { isDefault: false, status: 'ready', stale: false, configuredAddress: '/home/user/secret/registry.json' }
    assert.equal(registryNotice(leaky, 42), null)
    assert.ok(!JSON.stringify(registryNotice(leaky, 42)).includes('/home/user'))
    assert.equal(registryNotice({ isDefault: true, status: 'ready', stale: false }, 10), null, '默认清单 ready → 无横幅')
    assert.equal(registryNotice({ isDefault: false, status: 'ready', stale: false }, 10), null, '自定义清单 ready → 无横幅')
    assert.equal(registryNotice({ isDefault: true, status: 'stale', stale: true }, 10), null, '缓存 stale → 无横幅（0.7.0 前恒挂的噪音）')
    assert.deepEqual(registryNotice({ status: 'unavailable' }), { key: 'notice.unavailable' }, '错误态保留')
  })
  it('双源语义：主 down+社区 up → communityFallback；社区 stale → 无横幅（0.9.15+ 退役，状态由设置页承接）；旗标独立于 notice 键', () => {
    const fallback = marketNotice({ isDefault: true, status: 'unavailable', stale: false }, { enabled: true, status: 'ready' })
    assert.equal(fallback.communityFallback, true)
    assert.deepEqual(fallback.notice, { key: 'notice.unavailable' }, 'unavailable 仍在场')
    const staleOnly = marketNotice({ isDefault: true, status: 'stale', stale: true }, { status: 'stale' })
    assert.equal(staleOnly.communityStale, undefined, '社区 stale 横幅退役（SWR 时代 stale 是设计常态态，不打扰用户；状态由设置页承接）')
    assert.equal(staleOnly.notice, undefined, '主清单仅 stale（可用）→ 无错误横幅')
    const silent = marketNotice({ isDefault: true, status: 'ready', stale: false }, { status: 'unavailable' })
    assert.notEqual(silent.communityStale, true)
    assert.notEqual(silent.communityFallback, true)
    assert.equal(silent.notice, undefined)
  })
})
