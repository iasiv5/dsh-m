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
    assert.deepEqual(normalizeMarketQuery({}), { query: '', category: null, offset: 0, limit: MARKET_PAGE_SIZE })
    assert.equal(MARKET_PAGE_SIZE, 50)
  })

  it('query trim；category 白名单外归 null；offset 负数/NaN/浮点归一；limit clamp 1..50', () => {
    assert.equal(normalizeMarketQuery({ query: '  主题  ' }).query, '主题')
    assert.equal(normalizeMarketQuery({ category: 'nope' }).category, null)
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
