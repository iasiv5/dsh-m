/**
 * T4：图标解析链纯逻辑（ADR-0025）：catalogIconUrl https-only 过滤 + iconCandidates 候选序。
 * 运行：node --test tests/client-icon-view.test.mjs（直 import src，无需构建）
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { catalogIconUrl, iconCandidates } from '../src/client/icon-view.js'

describe('catalogIconUrl（目录侧仅认 https URL，用户 Q7 定案）', () => {
  it('https URL 原样返回', () => {
    assert.equal(catalogIconUrl('https://cdn.jsdelivr.net/npm/x@1.0.0/icon.svg'), 'https://cdn.jsdelivr.net/npm/x@1.0.0/icon.svg')
  })
  it('http / data: / 相对路径 / 非字符串 / 空串 / undefined → null', () => {
    assert.equal(catalogIconUrl('http://a/i.png'), null)
    assert.equal(catalogIconUrl('data:image/png;base64,xx'), null)
    assert.equal(catalogIconUrl('icon.svg'), null)
    assert.equal(catalogIconUrl(123), null)
    assert.equal(catalogIconUrl(''), null)
    assert.equal(catalogIconUrl('   '), null)
    assert.equal(catalogIconUrl(undefined), null)
    assert.equal(catalogIconUrl('not a url :://'), null)
  })
})

describe('iconCandidates（候选序：目录声明 → 已装官方 data URI → 头像；去重）', () => {
  it('目录声明 + github → [catalog, avatar]', () => {
    assert.deepEqual(
      iconCandidates({ icon: 'https://a/i.png', github: 'o/r' }),
      ['https://a/i.png', 'https://github.com/o.png?size=64'],
    )
  })
  it('目录侧 data: 不进链（Q7：塞 base64 视为无图标）→ 仅头像', () => {
    assert.deepEqual(
      iconCandidates({ icon: 'data:image/png;base64,xx', github: 'o/r' }),
      ['https://github.com/o.png?size=64'],
    )
  })
  it('已装 iconDataUri（data:image/*）→ [meta, avatar]', () => {
    assert.deepEqual(
      iconCandidates({ iconDataUri: 'data:image/png;base64,xx', github: 'o/r' }),
      ['data:image/png;base64,xx', 'https://github.com/o.png?size=64'],
    )
  })
  it('非 image/* 的 data:（iconDataUri）→ 剔除', () => {
    assert.deepEqual(iconCandidates({ iconDataUri: 'data:text/html,x', github: 'o/r' }), ['https://github.com/o.png?size=64'])
  })
  it('catalog 与 iconDataUri 同现 → 目录声明在前（纯函数序契约；产品上两字段分属不同面板不冲突）', () => {
    assert.deepEqual(
      iconCandidates({ icon: 'https://a/i.png', iconDataUri: 'data:image/png;base64,xx' }),
      ['https://a/i.png', 'data:image/png;base64,xx'],
    )
  })
  it('github 非 owner/repo 形态（无斜杠）→ 无头像', () => {
    assert.deepEqual(iconCandidates({ github: 'o' }), [])
  })
  it('全空 → []', () => {
    assert.deepEqual(iconCandidates({}), [])
    assert.deepEqual(iconCandidates(), [])
  })
  it('重复候选去重', () => {
    assert.deepEqual(
      iconCandidates({ icon: 'https://github.com/o.png?size=64', github: 'o/r' }),
      ['https://github.com/o.png?size=64'],
    )
  })
})
