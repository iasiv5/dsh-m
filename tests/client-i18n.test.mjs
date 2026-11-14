/**
 * i18n 完整性审计（0.10.5 建，0.10.7 扩面）：client 侧全部 lookup("key") 直接量必须落在
 * 字典定义内——0.10.4 真机 dogfood 实证：缺失键以裸键名 toast 给用户（upgrade.reconciled.done
 * 事件，恢复对账横幅键漏定义）。动态前缀键（"cat." + id 等，尾点结尾）与动态变量调用
 * （lookup(note.suffixKey) 等）不在直接量审计范围。
 * 0.10.7 扩面：审计对象从 main.jsx 扩到 op-outcome.js（13 个直接量同族缺陷面）。
 * 运行：npm test 自动发现（node --test tests/）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { ZH, EN } from '../src/client/i18n.js'

// ADR-0023 第一刀：词典出仓 i18n.js——键集直接由模块对象构建（正则抽 main.jsx 退役）
const dictKeys = new Set([...Object.keys(ZH), ...Object.keys(EN)])

const auditTargets = [
  { file: '../src/client/main.jsx' },
  { file: '../src/client/op-outcome.js' },
  // ADR-0023 T11：调用侧审计扩面至全部出仓组件（lookup 直接量的完整缺陷面）
  { file: '../src/client/chrome.jsx' },
  { file: '../src/client/card.jsx' },
  { file: '../src/client/favorite-zone.jsx' },
  { file: '../src/client/zone-chips.jsx' },
  { file: '../src/client/operations-card.jsx' },
  { file: '../src/client/version-chip.jsx' },
  { file: '../src/client/detail-modal.jsx' },
  { file: '../src/client/installed-tab.jsx' },
  { file: '../src/client/market-tab.jsx' },
  { file: '../src/client/settings-tab.jsx' },
]

for (const { file } of auditTargets) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8')
  // 双引号形态（main.jsx 惯例）与单引号形态（op-outcome.js 惯例）都捕获
  const used = new Set()
  for (const m of src.matchAll(/lookup\((["'])([^"'`]+)\1/g)) {
    const k = m[2]
    if (!k.endsWith('.')) used.add(k)
  }

  describe(`i18n 完整性审计：${file.replace('../src/client/', '')}`, () => {
    it('全部 lookup 直接量键均有字典定义（防裸键名 toast 回归）', () => {
      const missing = [...used].filter((k) => !dictKeys.has(k)).sort()
      assert.deepEqual(missing, [], `缺失字典定义的键: ${missing.join(', ')}`)
    })
  })
}

describe('i18n 审计自身健全性', () => {
  it('抽查已知键在册', () => {
    for (const k of ['common.ok', 'notify.selfupgraded', 'failed.upgrade', 'guard.blocked', 'op.degraded']) {
      assert.ok(dictKeys.has(k), `${k} 应在字典`)
    }
  })
})

// ADR-0026（评审 F5 连带②）：ZH/EN 键集配对断言——dictKeys 是并集、单语漂移不红，此处补防
it('ADR-0026：ZH 与 EN 键集逐键相等（中英同步防回归门）', () => {
  assert.deepEqual([...Object.keys(ZH)].sort(), [...Object.keys(EN)].sort())
})

describe('issue #41：notify.buildApprovalPending 三键双字典在场（评审 I6——动态 lookup(verbKey) 不在直接量审计面）', () => {
  it('ZH/EN 均含共享键与两个动词键', () => {
    for (const k of ['notify.buildApprovalPending', 'notify.verb.upgrade', 'notify.verb.install']) {
      assert.ok(k in ZH, `ZH 缺 ${k}`)
      assert.ok(k in EN, `EN 缺 ${k}`)
    }
  })
})

describe('issue #51：restart 终态通知四键双字典在场（动态 lookup 于 main.jsx onOutcome / operations-card op.kind）', () => {
  it('ZH/EN 均含 restart.done 三键与 op.kind.restart', () => {
    for (const k of ['restart.done.ok', 'restart.done.assumed', 'restart.done.failed', 'op.kind.restart']) {
      assert.ok(k in ZH, `ZH 缺 ${k}`)
      assert.ok(k in EN, `EN 缺 ${k}`)
    }
  })
})

// ---------- round-2 P8：i18n 死键反向守卫（a45373b 声明补落地） ----------
// 方向与上方正向审计相反：字典键 → 消费方。键无字面引用、且不属任何「有构造证据的
// 动态前缀族」即红——a45373b commit 声明的反向守卫当时未随 diff 落地（round-2 评审 P8），
// 本守卫补建并随行清扫死键（含 0.4.0 被 notify.builds 族取代后残留的 allowbuilds/upgradehint）。
// 动态形态纪律（CODING-STANDARDS「动态键另行在场断言」）：经变量/模板拼接消费的键不在
// 直接量审计面，以前缀 + 消费调用点证据锚显式化；锚腐化由自检断言拦住，防名单烂尾。
const DYNAMIC_PREFIX_EVIDENCE = [
  { prefix: 'cat.', anchor: 'labelKey: `cat.${id}`', where: 'market-state.js（zone-chips.jsx 经 lookup(c.labelKey) 消费）' },
  { prefix: 'op.kind.', anchor: 'lookup("op.kind." + r.kind)', where: 'operations-card.jsx' },
  { prefix: 'op.status.', anchor: 'lookup("op.status." + r.status)', where: 'operations-card.jsx' },
  { prefix: 'op.channel.', anchor: 'op.channel.${', where: 'operations-view.js（返回键串，main.jsx lookup 承接）' },
  { prefix: 'settings.status.', anchor: 'lookup(`settings.status.${', where: 'settings-tab.jsx' },
  { prefix: 'installed.upgradeBatch.skipped.', anchor: 'lookup(`installed.upgradeBatch.skipped.${', where: 'installed-updates.js' },
  { prefix: 'notify.toggled.', anchor: 'textKey: `notify.toggled.${', where: 'toggle-view.js' },
]

describe('i18n 死键反向守卫（round-2 P8）', () => {
  const clientDir = new URL('../src/client/', import.meta.url)
  const files = readdirSync(clientDir).filter((f) => /\.(js|jsx)$/.test(f) && f !== 'i18n.js').sort()
  const all = files.map((f) => readFileSync(new URL(f, clientDir), 'utf8')).join('\n')

  it('动态前缀证据锚在位（前缀名单不烂尾）', () => {
    assert.ok(files.length > 30, `src/client 文件枚举非空（实测 ${files.length}）`)
    for (const { prefix, anchor, where } of DYNAMIC_PREFIX_EVIDENCE) {
      assert.ok(all.includes(anchor), `证据锚腐化：${where} 应含 ${anchor}——前缀 ${prefix} 的消费点已迁移，须同步更新名单`)
    }
  })

  it('字典键均有消费面：字面引用或动态前缀族，死键零容忍', () => {
    const dead = []
    for (const key of Object.keys(ZH)) {
      const literal = all.includes(`"${key}"`) || all.includes(`'${key}'`) || all.includes(`\`${key}\``)
      const dynamic = DYNAMIC_PREFIX_EVIDENCE.some((d) => key.startsWith(d.prefix))
      if (!literal && !dynamic) dead.push(key)
    }
    assert.deepEqual(dead.sort(), [], `死键（无任何消费面，删除或补消费方）: ${dead.join(', ')}`)
  })
})
