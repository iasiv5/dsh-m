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
import { readFileSync } from 'node:fs'
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
