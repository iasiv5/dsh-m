/**
 * 0.9.27：遮罩点击关闭防拖拽误关——按下/点击双落遮罩才关闭。
 * 运行：node --test tests/client-backdrop.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { backdropCloseHandlers } from '../src/client/backdrop.js'

/** 模拟合成事件：onSelf=true 表示 target 即遮罩自身（currentTarget），否则为面板内子元素。 */
const ev = (onSelf) => ({ target: onSelf ? 'self' : 'child', currentTarget: 'self' })

describe('backdropCloseHandlers（0.9.27 防拖拽误关）', () => {
  it('按下与点击都在遮罩上 → 关闭一次', () => {
    let closed = 0
    const h = backdropCloseHandlers(() => { closed += 1 })
    h.onMouseDown(ev(true))
    h.onClick(ev(true))
    assert.equal(closed, 1)
  })

  it('面板内按下、拖到遮罩释放（click 落公共祖先）→ 不关闭——主缺陷场景', () => {
    let closed = 0
    const h = backdropCloseHandlers(() => { closed += 1 })
    h.onMouseDown(ev(false))
    h.onClick(ev(true))
    assert.equal(closed, 0)
  })

  it('遮罩上按下、拖进面板内释放 → 不关闭', () => {
    let closed = 0
    const h = backdropCloseHandlers(() => { closed += 1 })
    h.onMouseDown(ev(true))
    h.onClick(ev(false))
    assert.equal(closed, 0)
  })

  it('click 后按位状态复位：无前置按下的 click 不关闭，两轮独立判定', () => {
    let closed = 0
    const h = backdropCloseHandlers(() => { closed += 1 })
    h.onMouseDown(ev(true))
    h.onClick(ev(true)) // close #1
    h.onClick(ev(true)) // 无前置按下 → 不关
    h.onMouseDown(ev(false))
    h.onClick(ev(true)) // 按下不在遮罩 → 不关
    h.onMouseDown(ev(true))
    h.onClick(ev(true)) // close #2
    assert.equal(closed, 2)
  })

  it('畸形事件与非法回调安全（不抛错、不误关）', () => {
    let called = false
    const h1 = backdropCloseHandlers(undefined)
    h1.onMouseDown(undefined)
    h1.onClick(undefined)
    const h2 = backdropCloseHandlers(() => { called = true })
    h2.onMouseDown(undefined)
    h2.onClick(ev(true))
    assert.equal(called, false)
  })
})
