/**
 * registry-categories 纯函数单测（scripts/registry-categories.mjs）。网络部分不在单测中触发。
 * 运行：node --test tests/registry-categories.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { parseCategories, unsupportedCategories } from '../scripts/registry-categories.mjs'

describe('parseCategories：从 dsh-m registry.js 文本解析 CATEGORIES', () => {
  it('编译产物形态（分号结尾、单引号）', () => {
    const text = "export const CATEGORIES = ['essentials', 'cui-picks', 'baoyu', 'guizang', 'self-dev', 'tencent-lighthouse', 'watchlist'];\n"
    assert.deepEqual(parseCategories(text), ['essentials', 'cui-picks', 'baoyu', 'guizang', 'self-dev', 'tencent-lighthouse', 'watchlist'])
  })

  it('源码形态（as const、双引号）', () => {
    assert.deepEqual(parseCategories('export const CATEGORIES = ["a", "b"] as const'), ['a', 'b'])
  })

  it('找不到 CATEGORIES 或脏输入 → null', () => {
    assert.equal(parseCategories('export const OTHER = []'), null)
    assert.equal(parseCategories(null), null)
  })
})

describe('unsupportedCategories：registry 分类须被已发布版本支持', () => {
  const supported = ['essentials', 'baoyu', 'guizang']

  it('全部受支持 → 空数组', () => {
    const reg = { plugins: [{ id: 'a', category: 'essentials' }, { id: 'b', category: 'guizang' }] }
    assert.deepEqual(unsupportedCategories(reg, supported), [])
  })

  it('未发布的分类 → 列出条目（整份 registry 旧版拒绝的成因）', () => {
    const reg = { plugins: [{ id: 'a', category: 'essentials' }, { id: 'x', category: 'future-zone' }] }
    assert.deepEqual(unsupportedCategories(reg, supported), [{ id: 'x', category: 'future-zone' }])
  })

  it('脏输入安全：无 plugins → 空数组', () => {
    assert.deepEqual(unsupportedCategories(null, supported), [])
    assert.deepEqual(unsupportedCategories({}, supported), [])
  })
})
