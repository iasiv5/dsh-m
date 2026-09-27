/**
 * build-approval 契约（plan Task 3，ADR-0002）：
 * - readPendingBuilds：占位值键进名单；已决键（true/false）不计；通配符键排除；
 *   坏 YAML / 根非映射 / allowBuilds 非映射 / 锚点别名 / 值非标量 → []（保守回退）；
 * - applyPreciseBuilds：逐键写 true、保留其余内容与注释；allowBuilds 缺失创建；
 *   names 空 → 原样；坏 YAML → throw；写后 readPendingBuilds 归零。
 * fixture 为脱敏手写样本（本机实态的结构等价物：node-pty/protobufjs 已决键）。
 * 运行：npm run build && node --test tests/build-approval.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { applyPreciseBuilds, readPendingBuilds } from '../lib/core/build-approval.js'

/** 本机实态的结构等价脱敏样本：已有两个已决键。 */
const REAL_SHAPED = [
  'packages:',
  '  - .',
  '',
  'nodeLinker: hoisted',
  'autoInstallPeers: false',
  '',
  '',
  'allowBuilds:',
  '  node-pty: true',
  '  protobufjs: true',
  '',
].join('\n')

const PENDING_SHAPED = [
  'packages:',
  '  - .',
  '',
  'allowBuilds:',
  '  node-sass: set this to true or false',
  '  esbuild: set this to true or false',
  '  node-pty: true',
  '',
].join('\n')

describe('readPendingBuilds：待决名单解析', () => {
  it('占位值键进名单，已决键（true/false）不计', () => {
    assert.deepEqual(readPendingBuilds(PENDING_SHAPED), ['node-sass', 'esbuild'])
  })

  it('无 allowBuilds → []', () => {
    assert.deepEqual(readPendingBuilds(REAL_SHAPED), [])
    assert.deepEqual(readPendingBuilds('packages:\n  - .\n'), [])
  })

  it('空文本 → []', () => {
    assert.deepEqual(readPendingBuilds(''), [])
  })

  it('坏 YAML → []（保守回退）', () => {
    assert.deepEqual(readPendingBuilds('allowBuilds: [broken'), [])
  })

  it('根非映射 → []', () => {
    assert.deepEqual(readPendingBuilds('- a\n- b\n'), [])
  })

  it('allowBuilds 非映射 → []', () => {
    assert.deepEqual(readPendingBuilds('allowBuilds: yes\n'), [])
  })

  it('通配符键排除（官方同款）', () => {
    const text = 'allowBuilds:\n  "eslint*": set this to true or false\n  sharp: set this to true or false\n'
    assert.deepEqual(readPendingBuilds(text), ['sharp'])
  })

  it('值非精确占位串不计（true/false/大小写不同的文案）', () => {
    const text = [
      'allowBuilds:',
      '  a: true',
      '  b: false',
      '  d: Set this to true or false',
      '',
    ].join('\n')
    assert.deepEqual(readPendingBuilds(text), [])
  })

  it('条目值含锚点/别名 → 整体 []（保守）', () => {
    const text = 'allowBuilds:\n  a: &anch set this to true or false\n  b: *anch\n'
    assert.deepEqual(readPendingBuilds(text), [])
  })

  it('值非标量（嵌套映射/序列）→ 整体 []（保守）', () => {
    assert.deepEqual(readPendingBuilds('allowBuilds:\n  a:\n    nested: true\n'), [])
  })
})

describe('applyPreciseBuilds：逐键放行写入', () => {
  it('pending 状态写入两个键：值 true、其余内容与顺序保留', () => {
    const next = applyPreciseBuilds(PENDING_SHAPED, ['node-sass', 'esbuild'])
    assert.equal(next.includes('node-sass: true'), true)
    assert.equal(next.includes('esbuild: true'), true)
    assert.equal(next.includes('packages:'), true)
    assert.equal(next.includes('node-pty: true'), true)
    assert.equal(next.includes('set this to true or false'), false)
  })

  it('注释逐字保留', () => {
    const text = '# 顶层注释\nallowBuilds:\n  # 行内注释\n  sharp: set this to true or false\n'
    const next = applyPreciseBuilds(text, ['sharp'])
    assert.equal(next.includes('# 顶层注释'), true)
    assert.equal(next.includes('# 行内注释'), true)
    assert.equal(next.includes('sharp: true'), true)
  })

  it('allowBuilds 缺失 → 创建', () => {
    const next = applyPreciseBuilds('packages:\n  - .\n', ['sharp'])
    assert.equal(next.includes('allowBuilds:'), true)
    assert.equal(next.includes('sharp: true'), true)
    assert.equal(next.includes('packages:'), true)
  })

  it('names 空 → 原样返回', () => {
    assert.equal(applyPreciseBuilds(PENDING_SHAPED, []), PENDING_SHAPED)
  })

  it('坏 YAML / 根非映射 / 通配键 → throw', () => {
    assert.throws(() => applyPreciseBuilds('broken: [', ['a']))
    assert.throws(() => applyPreciseBuilds('- seq\n', ['a']))
    assert.throws(() => applyPreciseBuilds('allowBuilds:\n', ['wild*card']))
  })

  it('写后 readPendingBuilds 归零（往返闭环）', () => {
    const next = applyPreciseBuilds(PENDING_SHAPED, ['node-sass', 'esbuild'])
    assert.deepEqual(readPendingBuilds(next), [])
  })

  it('对已决键重写无害（幂等）', () => {
    const once = applyPreciseBuilds(PENDING_SHAPED, ['node-sass'])
    const twice = applyPreciseBuilds(once, ['node-sass'])
    assert.equal(twice.includes('node-sass: true'), true)
    assert.deepEqual(readPendingBuilds(twice), ['esbuild'])
  })
})
