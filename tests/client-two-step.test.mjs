/**
 * TwoStepButton 三态展示模型直测（卸载在途 UX，2026-10-31）：
 * 「确认卸载」后按钮只剩灰色 disabled「卸载」，用户无从知晓正在卸载——
 * 两段确认按钮补 busy（在途）态：busy > arm > idle 的优先级矩阵 + 文案/危险态派生 + 输入兜底。
 * DOM-free 纯逻辑，node:test 直测（仓库惯例同 toggle-view / installed-view）。
 * 运行：npm test 自动发现（node --test tests/）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { twoStepVm } from '../src/client/two-step.js'

const FULL = { label: '卸载', confirmLabel: '确认卸载？', busyLabel: '卸载中…' }

describe('twoStepVm：三态优先级矩阵（busy > arm > idle）', () => {
  it('常态：label、无危险态', () => {
    assert.deepEqual(
      twoStepVm({ ...FULL, arm: false, busy: false }),
      { mode: 'idle', text: '卸载', danger: false },
    )
  })

  it('武装确认：confirmLabel + 危险态', () => {
    assert.deepEqual(
      twoStepVm({ ...FULL, arm: true, busy: false }),
      { mode: 'arm', text: '确认卸载？', danger: true },
    )
  })

  it('在途压过武装：busyLabel 胜出、危险态摘除（armed 残留不闪红）', () => {
    assert.deepEqual(
      twoStepVm({ ...FULL, arm: true, busy: true }),
      { mode: 'busy', text: '卸载中…', danger: false },
    )
  })

  it('busy 单独为真（未武装）同样转在途', () => {
    assert.deepEqual(
      twoStepVm({ ...FULL, arm: false, busy: true }),
      { mode: 'busy', text: '卸载中…', danger: false },
    )
  })

  it('mode 闭集恰为 idle/arm/busy 三态（全矩阵穷举）', () => {
    const modes = new Set()
    for (const arm of [false, true]) {
      for (const busy of [false, true]) {
        modes.add(twoStepVm({ ...FULL, arm, busy }).mode)
      }
    }
    assert.deepEqual([...modes].sort(), ['arm', 'busy', 'idle'])
  })
})

describe('twoStepVm：文案兜底与输入容错', () => {
  it('busyLabel 缺席回退 label（保住动作名，不出空白按钮）', () => {
    const vm = twoStepVm({ label: '卸载', confirmLabel: '确认卸载？', busy: true })
    assert.equal(vm.mode, 'busy')
    assert.equal(vm.text, '卸载')
  })

  it('全字段缺席不抛：idle 兜底空文案（存取语义）', () => {
    assert.deepEqual(twoStepVm(), { mode: 'idle', text: '', danger: false })
  })

  it('arm 非真值按未武装处理（真值语义）', () => {
    assert.equal(twoStepVm({ ...FULL, arm: 0, busy: false }).mode, 'idle')
    assert.equal(twoStepVm({ ...FULL, arm: '', busy: false }).mode, 'idle')
    assert.equal(twoStepVm({ ...FULL, arm: undefined, busy: false }).mode, 'idle')
  })
})
