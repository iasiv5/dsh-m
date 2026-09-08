/**
 * 工具视图 payload 解析 pure 逻辑：depth-6 启发式抓取 + argsRaw 容错解析。
 * 运行：node --test tests/client-tool-view.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { pickPayload, parseToolArgs } from '../src/client/tool-view.js'

describe('pickPayload', () => {
  it('沿已知 key 深挖，返回首个含 items 数组的节点', () => {
    assert.deepEqual(pickPayload({ meta: { result: { items: [1, 2] } } }), { items: [1, 2] })
    assert.deepEqual(pickPayload({ content: '{"items":[3]}' }), { items: [3] })
    assert.deepEqual(pickPayload([{ items: ['x'] }]), { items: ['x'] })
  })
  it('深度上限 6（白名单 key 计层）：第 6 层可命中，第 7 层弃抓', () => {
    const d6 = { meta: { meta: { meta: { meta: { meta: { meta: { items: [1] } } } } } } } // meta×6 → items 节点在第 6 层
    assert.deepEqual(pickPayload(d6), { items: [1] })
    const d7 = { meta: { meta: { meta: { meta: { meta: { meta: { meta: { items: [1] } } } } } } } } // meta×7 → 第 7 层，depth > 6 弃抓
    assert.equal(pickPayload(d7), null)
  })
  it('短字符串/非 JSON/无 items 一律 null（静默失败现行为）', () => {
    assert.equal(pickPayload({}), null)
    assert.equal(pickPayload({ block: { argsRaw: '{}' } }), null)
    assert.equal(pickPayload({ content: '{short' }), null)
    assert.equal(pickPayload({ content: 'plain text' }), null)
  })
})

describe('parseToolArgs', () => {
  it('block.argsRaw 为 JSON 时解析；kind 存在时改读 call.argsRaw', () => {
    assert.deepEqual(parseToolArgs({ block: { argsRaw: '{"id":"a"}' } }), { id: 'a' })
    assert.deepEqual(parseToolArgs({ block: { kind: 'x', call: { argsRaw: '{"id":"b"}' } } }), { id: 'b' })
    assert.deepEqual(parseToolArgs({ block: { kind: 'x', argsRaw: '{"ignored":1}' } }), {})
  })
  it('缺失/非字符串/非 JSON 一律 {}（静默失败现行为）', () => {
    assert.deepEqual(parseToolArgs({}), {})
    assert.deepEqual(parseToolArgs({ block: {} }), {})
    assert.deepEqual(parseToolArgs({ block: { argsRaw: 'not json' } }), {})
    assert.deepEqual(parseToolArgs({ block: { argsRaw: 42 } }), {})
  })
})
