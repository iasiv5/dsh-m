/**
 * toggle-view 契约（plan Task 17）：
 * - 五相位映射（active→ok、failed→err、pending→idle、loading/unloading→busy、null→无点）；
 * - switchOn/switchDisabled/switchTitleKey（lockReason 三值）；未知 phase → 无点不抛；
 * - 通知分流：on/off × live/restart 四 key；restart 联动 needsRestart。
 * 运行：npm run build && node --test tests/client-toggle-view.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { toggleViewModel, toggleNoticeKeys } from '../src/client/toggle-view.js'

describe('toggleViewModel：相位点只映射 phase 五值', () => {
  const cases = [
    ['active', 'ok', 'phase.active'],
    ['failed', 'err', 'phase.failed'],
    ['pending', 'idle', 'phase.pending'],
    ['loading', 'busy', 'phase.loading'],
    ['unloading', 'busy', 'phase.unloading'],
  ]
  for (const [phase, dot, key] of cases) {
    it(`${phase} → ${dot}`, () => {
      assert.deepEqual(toggleViewModel({ phase, enabled: true, toggleable: true }), {
        phaseDotClass: dot,
        phaseLabelKey: key,
        switchOn: true,
        switchDisabled: false,
        switchTitleKey: null,
      })
    })
  }

  it('null 相位 → 无点（已停用归 Switch，不占相位点）', () => {
    const vm = toggleViewModel({ phase: null, enabled: false, toggleable: true })
    assert.equal(vm.phaseDotClass, '')
    assert.equal(vm.phaseLabelKey, null)
    assert.equal(vm.switchOn, false)
  })

  it('未知 phase → 无点不抛', () => {
    const vm = toggleViewModel({ phase: 'weird', enabled: true, toggleable: true })
    assert.equal(vm.phaseDotClass, '')
    assert.equal(vm.phaseLabelKey, null)
  })
})

describe('toggleViewModel：可开关性与锁因', () => {
  it('toggleable:false → switchDisabled', () => {
    const vm = toggleViewModel({ phase: 'active', enabled: true, toggleable: false })
    assert.equal(vm.switchDisabled, true)
  })

  it('lockReason 三值 → title key 映射', () => {
    assert.equal(toggleViewModel({ phase: null, lockReason: 'self' }).switchTitleKey, 'toggle.lock.self')
    assert.equal(toggleViewModel({ phase: null, lockReason: 'protected' }).switchTitleKey, 'toggle.lock.protected')
    assert.equal(toggleViewModel({ phase: null, lockReason: 'no-entry' }).switchTitleKey, 'toggle.lock.noentry')
    assert.equal(toggleViewModel({ phase: null, lockReason: 'mystery' }).switchTitleKey, null)
  })

  it('lockReason 存在时即便 toggleable 误传 true 也禁用（双保险）', () => {
    const vm = toggleViewModel({ phase: 'active', enabled: true, toggleable: true, lockReason: 'self' })
    assert.equal(vm.switchDisabled, true)
  })
})

describe('toggleNoticeKeys：live/restart 分流', () => {
  const cases = [
    [true, 'live', 'notify.toggled.on.live', false],
    [false, 'live', 'notify.toggled.off.live', false],
    [true, 'restart-required', 'notify.toggled.on.restart', true],
    [false, 'restart-required', 'notify.toggled.off.restart', true],
  ]
  for (const [enabled, applied, key, needsRestart] of cases) {
    it(`${enabled ? '启用' : '停用'} × ${applied} → ${key}`, () => {
      assert.deepEqual(toggleNoticeKeys({ pkg: 'demo-pkg', enabled, applied }), {
        textKey: key,
        params: { pkg: 'demo-pkg' },
        needsRestart,
      })
    })
  }

  it('异常形态（缺 applied）按 restart 保守分流', () => {
    const out = toggleNoticeKeys({ pkg: 'x', enabled: true })
    assert.equal(out.textKey, 'notify.toggled.on.restart')
    assert.equal(out.needsRestart, true)
  })
})
