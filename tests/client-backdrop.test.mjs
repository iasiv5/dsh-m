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

describe('backdropCloseHandlers 触摸路径（issue #31：移动端遮罩无法关闭）', () => {
  it('触摸按下与抬起都在遮罩上 → 关闭一次；后续合成 mousedown+click 不再二次关闭', () => {
    let closed = 0
    const h = backdropCloseHandlers(() => { closed += 1 })
    h.onTouchStart(ev(true))
    h.onTouchEnd(ev(true))
    h.onMouseDown(ev(true)) // 移动端合成序列：touchend 之后浏览器还派发 mousedown
    h.onClick(ev(true)) // 合成 click 必须被门闩吞掉，onClose 只允许触发一次
    assert.equal(closed, 1)
  })

  it('无合成 click 的 WebView（issue #31 病灶）：touchend 即关；门闩不残留到下一手势', () => {
    let closed = 0
    const h = backdropCloseHandlers(() => { closed += 1 })
    h.onTouchStart(ev(true))
    h.onTouchEnd(ev(true))
    assert.equal(closed, 1)
    h.onTouchStart(ev(true)) // 新手势开始 → 上一轮门闩作废
    h.onTouchEnd(ev(true))
    assert.equal(closed, 2)
  })

  it('对话框内按下、遮罩上抬起（点按判定对称镜像鼠标路径）→ 不关闭', () => {
    let closed = 0
    const h = backdropCloseHandlers(() => { closed += 1 })
    h.onTouchStart(ev(false))
    h.onTouchEnd(ev(true))
    assert.equal(closed, 0)
  })

  it('遮罩上按下、对话框内抬起 → 不关闭', () => {
    let closed = 0
    const h = backdropCloseHandlers(() => { closed += 1 })
    h.onTouchStart(ev(true))
    h.onTouchEnd(ev(false))
    assert.equal(closed, 0)
  })

  it('触摸未关（抬起点不在遮罩）不设门闩：随后的鼠标路径关闭不被吞', () => {
    let closed = 0
    const h = backdropCloseHandlers(() => { closed += 1 })
    h.onTouchStart(ev(true))
    h.onTouchEnd(ev(false)) // 不关闭
    h.onMouseDown(ev(true))
    h.onClick(ev(true)) // 鼠标路径正常关闭
    assert.equal(closed, 1)
  })

  it('畸形触摸事件安全（不抛错、不误关）', () => {
    let called = false
    const h1 = backdropCloseHandlers(undefined)
    h1.onTouchStart(undefined)
    h1.onTouchEnd(undefined)
    const h2 = backdropCloseHandlers(() => { called = true })
    h2.onTouchStart(undefined)
    h2.onTouchEnd(ev(true))
    assert.equal(called, false)
  })
})
