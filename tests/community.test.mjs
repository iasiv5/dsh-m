/**
 * M1 Task 2：社区清单容器层——常量、严格容器校验、23 分类标签表、入库 fixture 契约。
 * 运行：npm run build && node --test tests/community.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  COMMUNITY_CHAIN_BUDGET_MS,
  COMMUNITY_KNOWN_CATEGORIES,
  COMMUNITY_NPM_PACKAGE,
  MAX_COMMUNITY_BYTES,
  MAX_COMMUNITY_ENTRIES,
  validateCommunityContainer,
} from '../lib/core/community.js'

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'community-catalog-sample.json'), 'utf8'),
)

describe('常量（容器契约）', () => {
  it('锚定 npm 包与容量上限', () => {
    assert.equal(COMMUNITY_NPM_PACKAGE, 'dsh-plugin-catalog')
    assert.equal(MAX_COMMUNITY_BYTES, 32 * 1024 * 1024)
    assert.equal(MAX_COMMUNITY_ENTRIES, 30_000)
    assert.equal(COMMUNITY_CHAIN_BUDGET_MS, 30_000)
  })
})

describe('validateCommunityContainer', () => {
  it('合法最小 catalog 通过（2 条）', () => {
    const raw = {
      name: 'awesome-dsh-plugin',
      url: 'https://example.com',
      source: 'https://github.com/x/y',
      updated: '2026-09-28',
      count: 2,
      categories: { ui: { en: 'UI', zh: 'UI 增强' } },
      plugins: [
        { name: 'a', owner: 'o1', category: 'ui', npm: 'a' },
        { name: 'b', owner: 'o2', category: 'ui', npm: null },
      ],
    }
    const r = validateCommunityContainer(raw)
    assert.equal(r.ok, true)
    assert.equal(r.catalog?.plugins.length, 2)
    assert.equal(r.errors.length, 0)
  })

  it('未知顶层键报错且 catalog=null', () => {
    const r = validateCommunityContainer({ ...fixture, extra: 1 })
    assert.equal(r.ok, false)
    assert.equal(r.catalog, null)
    assert.ok(r.errors.some((e) => e.includes('extra') && e.includes('未知顶层字段')))
  })

  it('plugins 缺失/非数组 → 整份拒收', () => {
    for (const bad of [{}, { plugins: 'x' }, { plugins: {} }]) {
      const r = validateCommunityContainer(bad)
      assert.equal(r.ok, false)
      assert.equal(r.catalog, null)
      assert.ok(r.errors.some((e) => e.startsWith('plugins:')))
    }
  })

  it('plugins 超过 30,000 条 → 整份拒收并注明上限', () => {
    const big = Array.from({ length: MAX_COMMUNITY_ENTRIES + 1 }, () => ({ name: 'x' }))
    const r = validateCommunityContainer({ plugins: big })
    assert.equal(r.ok, false)
    assert.equal(r.catalog, null)
    assert.ok(r.errors.some((e) => e.includes('30001') && e.includes('30000')))
  })

  it('条目非对象 → 拒收（容器层保底；条目字段校验属适配层）', () => {
    const r = validateCommunityContainer({ plugins: [{ name: 'ok' }, 'bad', null] })
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.includes('plugins[1]')))
  })

  it('根非对象 → 拒收', () => {
    for (const bad of [null, 'x', [], 42]) {
      const r = validateCommunityContainer(bad)
      assert.equal(r.ok, false)
      assert.equal(r.catalog, null)
    }
  })

  it('入库 fixture 通过容器校验', () => {
    const r = validateCommunityContainer(fixture)
    assert.equal(r.ok, true)
    assert.equal(r.catalog?.plugins.length, fixture.plugins.length)
  })
})

describe('COMMUNITY_KNOWN_CATEGORIES 与 fixture 一致', () => {
  it('23 个分类 id 全覆盖（含共享桶 ui/tools/market）', () => {
    assert.equal(Object.keys(COMMUNITY_KNOWN_CATEGORIES).length, 23)
    for (const id of Object.keys(fixture.categories)) {
      assert.ok(COMMUNITY_KNOWN_CATEGORIES[id], `标签表缺分类: ${id}`)
    }
    for (const id of Object.keys(COMMUNITY_KNOWN_CATEGORIES)) {
      assert.ok(fixture.categories[id], `fixture 缺分类: ${id}`)
    }
  })

  it('标签为中文非空字符串', () => {
    for (const [id, label] of Object.entries(COMMUNITY_KNOWN_CATEGORIES)) {
      assert.equal(typeof label, 'string', id)
      assert.ok(label.length > 0, id)
    }
  })

  it('fixture 覆盖全部 23 个分类', () => {
    const seen = new Set(fixture.plugins.map((p) => p.category))
    assert.equal(seen.size, 23)
  })
})
