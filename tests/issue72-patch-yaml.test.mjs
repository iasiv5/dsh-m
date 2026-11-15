/**
 * issue #72 纯函数契约（补丁路径解析）：installed.ts 读包内补丁层的新原料。
 * - declaredBundlePatchFiles：官方 @deepseek-ai/dsh-app-boot bundlePatchFiles 同口径——
 *   dsh.bundle.patch = string（单文件）| string[]（多文件，声明序）；未声明/非法 → null
 *   （调用方回退根级 cordis.patch.yml）；空数组 = 合法声明零补丁文件。
 * - mergeBundlePatchRows：多文件行枚举合并，全有全无——任一文件缺失（null）或不可解析 →
 *   整体 readable:false（粒度降 Bundle，与单文件缺失契约一致）；全可读 → inserts 拼接、configRows 求和。
 * 运行：npm run build && node --test tests/issue72-patch-yaml.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { declaredBundlePatchFiles, mergeBundlePatchRows } from '../lib/core/patch-yaml.js'

describe('declaredBundlePatchFiles：dsh.bundle.patch 声明解析（issue #72，官方 bundlePatchFiles 同口径）', () => {
  it('string → 单元素路径表', () => {
    assert.deepEqual(declaredBundlePatchFiles({ bundle: { patch: './dist/deepseek-harness/cordis.patch.yml' } }), [
      './dist/deepseek-harness/cordis.patch.yml',
    ])
  })

  it('string[] → 原序路径表（官方数组声明）', () => {
    assert.deepEqual(declaredBundlePatchFiles({ bundle: { patch: ['./a.yml', './b.yml'] } }), ['./a.yml', './b.yml'])
  })

  it('空数组 → []（合法声明零补丁文件，官方同判不抛）', () => {
    assert.deepEqual(declaredBundlePatchFiles({ bundle: { patch: [] } }), [])
  })

  it('未声明（无 dsh / 无 bundle / 无 patch）→ null（调用方回退根级）', () => {
    assert.equal(declaredBundlePatchFiles(undefined), null)
    assert.equal(declaredBundlePatchFiles({}), null)
    assert.equal(declaredBundlePatchFiles({ bundle: {} }), null)
  })

  it('非法类型（数字 / 含非字符串元素的数组 / 对象 / 非 dsh 对象）→ null', () => {
    assert.equal(declaredBundlePatchFiles({ bundle: { patch: 42 } }), null)
    assert.equal(declaredBundlePatchFiles({ bundle: { patch: ['./ok.yml', 42] } }), null)
    assert.equal(declaredBundlePatchFiles({ bundle: { patch: {} } }), null)
    assert.equal(declaredBundlePatchFiles('dsh'), null)
    assert.equal(declaredBundlePatchFiles(null), null)
  })
})

describe('mergeBundlePatchRows：多补丁文件合并（issue #72，全有全无）', () => {
  it('全可读 → inserts 按声明序拼接、configRows 求和', () => {
    const merged = mergeBundlePatchRows([
      { inserts: [{ id: 'a' }], configRows: 1, readable: true },
      { inserts: [{ id: 'b', name: 'm' }], configRows: 0, readable: true },
    ])
    assert.deepEqual(merged, { inserts: [{ id: 'a' }, { id: 'b', name: 'm' }], configRows: 1, readable: true })
  })

  it('任一文件缺失（null）→ 整体 readable:false（粒度降 Bundle）', () => {
    assert.deepEqual(
      mergeBundlePatchRows([{ inserts: [{ id: 'a' }], configRows: 0, readable: true }, null]),
      { inserts: [], configRows: 0, readable: false },
    )
  })

  it('任一文件不可解析 → 整体 readable:false（与单文件契约一致）', () => {
    assert.deepEqual(
      mergeBundlePatchRows([
        { inserts: [{ id: 'a' }], configRows: 0, readable: true },
        { inserts: [], configRows: 0, readable: false },
      ]),
      { inserts: [], configRows: 0, readable: false },
    )
  })

  it('空 parts（声明 []）→ 可读零行', () => {
    assert.deepEqual(mergeBundlePatchRows([]), { inserts: [], configRows: 0, readable: true })
  })
})
