/**
 * 变更结局描述（0.9.94）：工厂注入 lookup 出成品文案——五类投影矩阵。
 * guardBlockedText（repairBasis 有无/空串 × restartSafe × compstatus 缺省）、
 * buildsSuffix（approvals 有无 × fallback）、upgradeOkText（version/sha/latest × activation 三态 × builds）、
 * mutationFailed（superseded/guard/plain × verb 五枚 + 异常对象花样）。
 * 期望串为手写字面量（假 lookup 格式 `key{a=v,b=v}`），不与实现共用装配代码——防同义反复。
 * 运行：npm test 自动发现（node --test tests/）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createOpOutcome } from '../src/client/op-outcome.js'

/** 假 lookup：无参 → 键名；有参 → `key{a=v,b=v}`（参数按传入顺序）。 */
const lk = (k, p) => (p ? `${k}{${Object.entries(p).map(([a, b]) => a + '=' + b).join(',')}}` : k)
const oc = createOpOutcome(lk)

describe('op-outcome · guardBlockedText（守卫全版五段装配，×3 逐字收敛原样）', () => {
  const comp = { status: 'compensated', note: '清理完成' }

  it('① repBasis 无 + restartSafe true：四段', () => {
    assert.equal(oc.guardBlockedText({ compensation: comp, needsRestart: true, restartSafe: true }),
      'guard.blocked | guard.compstatus: compensated（清理完成） | guard.noforce | guard.restartsafenow')
  })

  it('② repBasis 有 + restartSafe true：五段含 repairBasis', () => {
    assert.equal(oc.guardBlockedText({ compensation: comp, repairBasis: '旧 spec', restartSafe: true }),
      'guard.blocked | guard.compstatus: compensated（清理完成） | guard.repairbasis: 旧 spec | guard.noforce | guard.restartsafenow')
  })

  it('③ repBasis 有 + restartSafe false：末段 restartunsafe', () => {
    assert.equal(oc.guardBlockedText({ compensation: comp, repairBasis: '旧 spec', restartSafe: false }),
      'guard.blocked | guard.compstatus: compensated（清理完成） | guard.repairbasis: 旧 spec | guard.noforce | guard.restartunsafe')
  })

  it('④ repBasis 无 + restartSafe false：四段', () => {
    assert.equal(oc.guardBlockedText({ compensation: comp, restartSafe: false }),
      'guard.blocked | guard.compstatus: compensated（清理完成） | guard.noforce | guard.restartunsafe')
  })

  it('⑤ compstatus 全缺省：status→—、note→空串', () => {
    assert.equal(oc.guardBlockedText({ restartSafe: false }),
      'guard.blocked | guard.compstatus: —（） | guard.noforce | guard.restartunsafe')
  })

  it('⑥ repairBasis 空串（falsy）：段缺席同 ④', () => {
    assert.equal(oc.guardBlockedText({ compensation: comp, repairBasis: '', restartSafe: false }),
      'guard.blocked | guard.compstatus: compensated（清理完成） | guard.noforce | guard.restartunsafe')
  })
})

describe('op-outcome · buildsSuffix（×4 收敛原样）', () => {
  it('① approvals 多项：join(", ")', () => {
    assert.equal(oc.buildsSuffix({ buildApprovals: ['a', 'b'] }), 'notify.builds{names=a, b}')
  })

  it('② approvals 单项', () => {
    assert.equal(oc.buildsSuffix({ buildApprovals: ['x'] }), 'notify.builds{names=x}')
  })

  it('③ 空数组 + fallbackAllBuilds：fallback 文案', () => {
    assert.equal(oc.buildsSuffix({ buildApprovals: [], fallbackAllBuilds: true }), 'notify.builds.fallback')
  })

  it('④ 空数组 + 无 fallback：空串', () => {
    assert.equal(oc.buildsSuffix({ buildApprovals: [], fallbackAllBuilds: false }), '')
  })

  it('⑤ 字段全缺：空串', () => {
    assert.equal(oc.buildsSuffix({}), '')
  })
})

describe('op-outcome · degradedOutcome（0.10.0 R4 降级恢复投影）', () => {
  it('① degraded 输入 → kind=warn、text 走 op.degraded 键且携带 restoredTo', () => {
    assert.deepEqual(oc.degradedOutcome({ degraded: true, restoredTo: '0.9.0' }),
      { kind: 'warn', text: 'op.degraded{restoredTo=0.9.0}' })
  })

  it('② 非 degraded 输入不命中新分支（null）：degraded:false / 字段全缺 / undefined', () => {
    assert.equal(oc.degradedOutcome({ degraded: false, restoredTo: '0.9.0' }), null)
    assert.equal(oc.degradedOutcome({}), null)
    assert.equal(oc.degradedOutcome(undefined), null)
  })
})

describe('op-outcome · upgradeOkText（升级成功文案 ×2 逐字收敛原样）', () => {
  it('① version 三态之首：v 前缀 + client-only 后缀 + 不需重启', () => {
    assert.deepEqual(oc.upgradeOkText({ pkg: 'p', fromVersion: '1.0.0', version: '1.2.3', activation: 'client-only' }),
      { needsRestart: false, text: 'notify.upgraded{pkg=p,from=v1.0.0,to=v1.2.3}notify.upgraded.clientonly' })
  })

  it('② unknown 后缀 + 需重启', () => {
    assert.deepEqual(oc.upgradeOkText({ pkg: 'p', fromVersion: '1.0.0', version: '1.2.3', activation: 'unknown' }),
      { needsRestart: true, text: 'notify.upgraded{pkg=p,from=v1.0.0,to=v1.2.3}notify.upgraded.activationUnknown' })
  })

  it('③ activation 缺席：无后缀 + 需重启（维持现状横幅）', () => {
    assert.deepEqual(oc.upgradeOkText({ pkg: 'p', fromVersion: '1.0.0', version: '1.2.3', activation: undefined }),
      { needsRestart: true, text: 'notify.upgraded{pkg=p,from=v1.0.0,to=v1.2.3}' })
  })

  it('④ sha 三态：前 7 位截断', () => {
    assert.deepEqual(oc.upgradeOkText({ pkg: 'p', sha: 'abcdef1234567890' }),
      { needsRestart: true, text: 'notify.upgraded{pkg=p,from=—,to=abcdef1}' })
  })

  it('⑤ sha 精确 7 位边界', () => {
    assert.equal(oc.upgradeOkText({ pkg: 'p', sha: 'abc1234xyz' }).text, 'notify.upgraded{pkg=p,from=—,to=abc1234}')
  })

  it('⑥ version/sha 皆无：latest 兜底', () => {
    assert.deepEqual(oc.upgradeOkText({ pkg: 'p' }),
      { needsRestart: true, text: 'notify.upgraded{pkg=p,from=—,to=latest}' })
  })

  it('⑦ builds 后缀拼接（approvals 非空优先）', () => {
    assert.equal(oc.upgradeOkText({ pkg: 'p', fromVersion: '1.0.0', version: '1.2.3', buildApprovals: ['a'], activation: undefined }).text,
      'notify.upgraded{pkg=p,from=v1.0.0,to=v1.2.3}notify.builds{names=a}')
  })

  it('⑧ builds 后缀拼接（fallback 腿）+ client-only', () => {
    assert.deepEqual(oc.upgradeOkText({ pkg: 'p', version: '1.2.3', fallbackAllBuilds: true, activation: 'client-only' }),
      { needsRestart: false, text: 'notify.upgraded{pkg=p,from=—,to=v1.2.3}notify.builds.fallbacknotify.upgraded.clientonly' })
  })

  it('⑨ from 缺省：— 占位', () => {
    assert.equal(oc.upgradeOkText({ pkg: 'q', version: '2.0.0', activation: 'unknown' }).text,
      'notify.upgraded{pkg=q,from=—,to=v2.0.0}notify.upgraded.activationUnknown')
  })

  it('⑩ 三态组合抽查：sha + unknown + approvals', () => {
    assert.equal(oc.upgradeOkText({ pkg: 'p', sha: 'ffff0000aaaa', buildApprovals: ['x', 'y'], activation: 'unknown' }).text,
      'notify.upgraded{pkg=p,from=—,to=ffff000}notify.builds{names=x, y}notify.upgraded.activationUnknown')
  })

  it('⑪ sha + client-only（3×3 交叉补全，评审 R1-②）：截断 + 不需重启', () => {
    assert.deepEqual(oc.upgradeOkText({ pkg: 'p', sha: 'abcdef1234', activation: 'client-only' }),
      { needsRestart: false, text: 'notify.upgraded{pkg=p,from=—,to=abcdef1}notify.upgraded.clientonly' })
  })

  it('⑫ latest + client-only（3×3 交叉补全）：兜底 + 不需重启', () => {
    assert.deepEqual(oc.upgradeOkText({ pkg: 'p', activation: 'client-only' }),
      { needsRestart: false, text: 'notify.upgraded{pkg=p,from=—,to=latest}notify.upgraded.clientonly' })
  })

  it('⑬ latest + unknown（3×3 交叉补全）：兜底 + 需重启', () => {
    assert.deepEqual(oc.upgradeOkText({ pkg: 'p', activation: 'unknown' }),
      { needsRestart: true, text: 'notify.upgraded{pkg=p,from=—,to=latest}notify.upgraded.activationUnknown' })
  })
})

describe('op-outcome · mutationFailed（superseded/guard/plain × verb 五枚）', () => {
  it('① superseded：kind ok + target 插值', () => {
    assert.deepEqual(oc.mutationFailed({ opSuperseded: true }, { verb: 'install', target: 'pkg-a' }),
      { kind: 'ok', text: 'op.superseded.note{target=pkg-a}' })
  })

  it('② guard：kind err + 与 guardBlockedText 同串', () => {
    assert.deepEqual(oc.mutationFailed({ guard: { compensation: { status: 'compensated', note: 'n' }, restartSafe: false } }, { verb: 'upgrade', target: 'p' }),
      { kind: 'err', text: 'guard.blocked | guard.compstatus: compensated（n） | guard.noforce | guard.restartunsafe' })
  })

  it('③ plain Error：message 插值', () => {
    assert.deepEqual(oc.mutationFailed(new Error('boom'), { verb: 'uninstall', target: 'p' }),
      { kind: 'err', text: 'failed.uninstall{err=boom}' })
  })

  it('④ 字符串异常：原文入参', () => {
    assert.deepEqual(oc.mutationFailed('raw string', { verb: 'toggle', target: 'p' }),
      { kind: 'err', text: 'toggle.failed{err=raw string}' })
  })

  it('⑤ null-ish e：err 参数即 null', () => {
    assert.deepEqual(oc.mutationFailed(null, { verb: 'self', target: 'dsh-m' }),
      { kind: 'err', text: 'notify.selfupgraded.failed{err=null}' })
  })

  it('⑥ plain object 带 message：取 message', () => {
    assert.deepEqual(oc.mutationFailed({ message: 'm' }, { verb: 'install', target: 'p' }),
      { kind: 'err', text: 'failed.install{err=m}' })
  })

  it('⑦ verb 五枚键位落点', () => {
    const verbs = [
      ['install', 'failed.install'],
      ['upgrade', 'failed.upgrade'],
      ['uninstall', 'failed.uninstall'],
      ['toggle', 'toggle.failed'],
      ['self', 'notify.selfupgraded.failed'],
    ]
    for (const [verb, key] of verbs) {
      assert.equal(oc.mutationFailed(new Error('x'), { verb, target: 't' }).text, `${key}{err=x}`, `verb=${verb}`)
    }
  })

  it('⑧ superseded 与 guard 同在场（互斥前提被破坏的防御）：superseded 优先', () => {
    assert.deepEqual(oc.mutationFailed({ opSuperseded: true, opId: 'op-1', guard: { restartSafe: false } }, { verb: 'install', target: 'p' }),
      { kind: 'ok', text: 'op.superseded.note{target=p}' })
  })
})

describe('op-outcome · buildBlockedText（issue #41 未遂文案：共享键 + 动词键）', () => {
  it('① verb 参数逐字进共享键（upgrade）', () => {
    assert.equal(oc.buildBlockedText({ pkg: 'plug-a' }, 'notify.verb.upgrade'),
      'notify.buildApprovalPending{verb=notify.verb.upgrade,pkg=plug-a}')
  })

  it('② install 动词同构', () => {
    assert.equal(oc.buildBlockedText({ pkg: 'plug-a' }, 'notify.verb.install'),
      'notify.buildApprovalPending{verb=notify.verb.install,pkg=plug-a}')
  })
})
