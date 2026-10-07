/**
 * 0.9.53 方案A：ZoneChips 视觉裁剪纯函数单测（clipTop/countBeyondRows/chipRows/autoExpandDecision）。
 * 直接 import 源文件，不依赖 DOM/React。
 * 运行：node --test tests/client-zonechips-clip.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { chipRows, countBeyondRows, clipTopOf, autoExpandDecision } from '../src/client/market-state.js'

describe('chipRows（offsetTop 去重计数行数）', () => {
  it('空数组 / 非数组 → 0', () => {
    assert.equal(chipRows([]), 0)
    assert.equal(chipRows(undefined), 0)
    assert.equal(chipRows('nope'), 0)
  })
  it('非有限数值元素跳过', () => {
    assert.equal(chipRows([0, NaN, 0, Infinity, 28]), 2)
  })
  it('单行（全部同 offsetTop）→ 1', () => {
    assert.equal(chipRows([0, 0, 0, 0]), 1)
  })
  it('两行 → 2', () => {
    assert.equal(chipRows([0, 0, 28, 28, 28]), 2)
  })
  it('三行 → 3', () => {
    assert.equal(chipRows([0, 28, 56, 56]), 3)
  })
})

describe('countBeyondRows（第 maxRows 行之外颗数）', () => {
  const threeRows = [0, 0, 0, 28, 28, 28, 56, 56] // 行1×3 行2×3 行3×2
  it('空数组 / 非法 maxRows → 0', () => {
    assert.equal(countBeyondRows([], 2), 0)
    assert.equal(countBeyondRows(threeRows, 0), 0)
    assert.equal(countBeyondRows(threeRows, 1.5), 0)
    assert.equal(countBeyondRows(undefined, 2), 0)
  })
  it('恰好两行 → 0', () => {
    assert.equal(countBeyondRows([0, 0, 28, 28], 2), 0)
  })
  it('三行取两行 → 越界 2 颗', () => {
    assert.equal(countBeyondRows(threeRows, 2), 2)
  })
  it('单行取一行 → 0', () => {
    assert.equal(countBeyondRows([0, 0, 0], 1), 0)
  })
  it('maxRows=1 三行 → 越界 5 颗', () => {
    assert.equal(countBeyondRows(threeRows, 1), 5)
  })
})

describe('clipTopOf（首个被裁剪行的 offsetTop）', () => {
  it('不足 maxRows+1 行 → Infinity（无裁剪）', () => {
    assert.equal(clipTopOf([0, 0, 28, 28], 2), Infinity)
    assert.equal(clipTopOf([], 2), Infinity)
    assert.equal(clipTopOf([0], 1), Infinity)
  })
  it('三行取两行 → 第 3 行行顶 56', () => {
    assert.equal(clipTopOf([0, 0, 0, 28, 28, 28, 56, 56], 2), 56)
  })
  it('两行取一行 → 第 2 行行顶 28', () => {
    assert.equal(clipTopOf([0, 0, 28, 28], 1), 28)
  })
  it('非法 maxRows → Infinity', () => {
    assert.equal(clipTopOf([0, 28], 0), Infinity)
    assert.equal(clipTopOf([0, 28], -1), Infinity)
  })
})

describe('autoExpandDecision（自动展开四态决策，评审 R1-Q3）', () => {
  const CLIP = 50 // 首个被裁剪行行顶

  it('未越界 → 不记录不展开（任意态）', () => {
    assert.deepEqual(autoExpandDecision(0, CLIP, false, false), { record: false, expand: false })
    assert.deepEqual(autoExpandDecision(28, CLIP, false, true), { record: false, expand: false })
  })
  it('越界 + 未记录 + 折叠态 → 记录并展开', () => {
    assert.deepEqual(autoExpandDecision(50, CLIP, false, false), { record: true, expand: true })
    assert.deepEqual(autoExpandDecision(78, CLIP, false, false), { record: true, expand: true })
  })
  it('越界 + 未记录 + 展开态 → 仅记录不施裁剪（record-only，现状 main.jsx:921-922 展开态也写 autoRef）', () => {
    assert.deepEqual(autoExpandDecision(50, CLIP, false, true), { record: true, expand: false })
  })
  it('越界 + 已记录（autoRef 命中）→ 不弹回（⌃ 手动收起后尊重）', () => {
    assert.deepEqual(autoExpandDecision(50, CLIP, true, false), { record: false, expand: false })
    assert.deepEqual(autoExpandDecision(50, CLIP, true, true), { record: false, expand: false })
  })
  it('非法输入 → 不记录不展开', () => {
    assert.deepEqual(autoExpandDecision(undefined, CLIP, false, false), { record: false, expand: false })
    assert.deepEqual(autoExpandDecision(50, Infinity, false, false), { record: false, expand: false })
  })
  it('场景串演：展开态激活深层分类 → ⌃ 收起后不弹回（V5 回归钉）', () => {
    // 1) 展开态下激活深层分类（top=78 越界）→ 仅记录
    const d1 = autoExpandDecision(78, 50, false, true)
    assert.equal(d1.record, true)
    assert.equal(d1.expand, false)
    // 2) 用户 ⌃ 收起（expanded=true→false），autoRef 已记录 → 不重新展开
    const d2 = autoExpandDecision(78, 50, true, false)
    assert.equal(d2.expand, false)
    assert.equal(d2.record, false)
  })
})
