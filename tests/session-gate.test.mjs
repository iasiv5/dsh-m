/**
 * issue #57 / ADR-0035：session-gate 门控纯逻辑真值表（Task 1）+ tools.ts 接线（Task 4 追加）。
 * 运行：npm run build && node --test tests/session-gate.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  SESSION_PROMPT_SECTION_NAME,
  SESSION_PROMPT_SECTION_ORDER,
  SLIM_PROMPT_SECTION,
  resolveSessionPromptText,
  sessionPromptEnabled,
  sessionToolsEnabled,
} from '../lib/core/session-gate.js'

describe('session-gate：归一化（undefined = 开）', () => {
  it('sessionToolsEnabled 缺省开', () => {
    assert.equal(sessionToolsEnabled(undefined), true)
    assert.equal(sessionToolsEnabled({}), true)
    assert.equal(sessionToolsEnabled({ sessionTools: true }), true)
    assert.equal(sessionToolsEnabled({ sessionTools: false }), false)
  })

  it('sessionPromptEnabled 级联：tools off ⇒ prompt off（无论 sessionPrompt）', () => {
    assert.equal(sessionPromptEnabled(undefined), true)
    assert.equal(sessionPromptEnabled({ sessionPrompt: false }), false)
    assert.equal(sessionPromptEnabled({ sessionTools: false, sessionPrompt: true }), false)
    assert.equal(sessionPromptEnabled({ sessionTools: true, sessionPrompt: true }), true)
  })
})

describe('session-gate：resolveSessionPromptText 级联真值表', () => {
  const cases = [
    ['undefined 缺省全开', undefined, SLIM_PROMPT_SECTION],
    ['both true 全开', { sessionTools: true, sessionPrompt: true }, SLIM_PROMPT_SECTION],
    ['tools off 级联钳真值', { sessionTools: false, sessionPrompt: true }, ''],
    ['prompt off 仅工具', { sessionTools: true, sessionPrompt: false }, ''],
    ['both off 全关', { sessionTools: false, sessionPrompt: false }, ''],
  ]
  for (const [name, cfg, want] of cases) {
    it(`resolveSessionPromptText：${name}`, () => {
      assert.equal(resolveSessionPromptText(cfg), want)
    })
  }
})

describe('session-gate：SLIM 文本锚与常量', () => {
  it('ASCII 字面量在场（split 出现次数 ≥1）', () => {
    for (const needle of ['dshm_restart', 'web_search', 'desktop']) {
      assert.ok(SLIM_PROMPT_SECTION.split(needle).length - 1 >= 1, needle)
    }
  })

  it('段名与序常量（单一事实源）', () => {
    assert.equal(SESSION_PROMPT_SECTION_NAME, 'tool:dshm')
    assert.equal(SESSION_PROMPT_SECTION_ORDER, 211)
  })
})

describe('tools.ts 接线（issue #57 Task 4）', () => {
  it('T5：8 个工具均带 when 谓词，随 cfg 两态翻转', async () => {
    const { registerTools } = await import('../lib/tools.js')
    const registeredOff = []
    registerTools(
      { tools: { register: (t, o) => registeredOff.push([t, o]) }, inject: () => {} },
      { sessionTools: false },
      {},
    )
    assert.equal(registeredOff.length, 8)
    for (const [t, o] of registeredOff) {
      assert.equal(typeof o?.when, 'function', `${t.name} 缺 when`)
      assert.equal(o.when(), false, `${t.name} 关态应为 false`)
    }
    const registeredOn = []
    registerTools(
      { tools: { register: (t, o) => registeredOn.push([t, o]) }, inject: () => {} },
      {},
      {},
    )
    assert.equal(registeredOn.length, 8)
    for (const [t, o] of registeredOn) {
      assert.equal(o.when(), true, `${t.name} 缺省应可入装配`)
    }
  })

  it('T6：systemPrompt 段 text 为函数，段名/序引常量，随 cfg 三态返回 SLIM/空', async () => {
    const { registerTools } = await import('../lib/tools.js')
    const captured = []
    const cfg = {}
    registerTools(
      { tools: { register: () => {} }, inject: (deps, cb) => cb({ systemPrompt: { section: (s) => captured.push(s) } }) },
      cfg,
      {},
    )
    assert.equal(captured.length, 1)
    const s = captured[0]
    assert.equal(s.name, SESSION_PROMPT_SECTION_NAME)
    assert.equal(s.order, SESSION_PROMPT_SECTION_ORDER)
    assert.equal(typeof s.text, 'function')
    assert.equal(s.text(), SLIM_PROMPT_SECTION) // 缺省全开
    cfg.sessionPrompt = false
    assert.equal(s.text(), '') // 仅工具
    cfg.sessionTools = false
    cfg.sessionPrompt = true
    assert.equal(s.text(), '') // 级联
    cfg.sessionTools = true
    assert.equal(s.text(), SLIM_PROMPT_SECTION) // 翻回全开
  })
})
