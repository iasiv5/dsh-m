/**
 * 重启等待 pure 决策：钉死现行实现（RestartBanner.restart）的时序语义——
 * deadline 只在 before-ping 检查且优先于 boot 变化；after-ping 只产 done/continue。
 * 运行：node --test tests/client-restart-wait.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  RESTART_POLL_MS,
  RESTART_DEADLINE_MS,
  nextRestartWait,
  isAmbiguousRestartRequestError,
} from '../src/client/restart-wait.js'

describe('常量（与现行字面量一致）', () => {
  it('轮询 2s、deadline 90s', () => {
    assert.equal(RESTART_POLL_MS, 2_000)
    assert.equal(RESTART_DEADLINE_MS, 90_000)
  })
})

describe('restart request errors', () => {
  it('网络/中止错误可能表示服务已接受重启', () => {
    assert.equal(isAmbiguousRestartRequestError({ name: 'TypeError' }), true)
    assert.equal(isAmbiguousRestartRequestError({ name: 'AbortError' }), true)
    assert.equal(isAmbiguousRestartRequestError({ name: 'NetworkError' }), true)
  })
  it('HTTP 业务错误仍是确定失败', () => {
    assert.equal(isAmbiguousRestartRequestError(new Error('HTTP 500')), false)
    assert.equal(isAmbiguousRestartRequestError({ name: 'SyntaxError' }), false)
    assert.equal(isAmbiguousRestartRequestError(null), false)
  })
})

describe('nextRestartWait', () => {
  it('before-ping：过 deadline 即 timeout——即使上一轮 boot 已变（超时优先，边界语义钉死）', () => {
    assert.equal(nextRestartWait({ phase: 'before-ping', now: 100, deadlineAt: 90, bootChanged: true }), 'timeout')
  })
  it('before-ping：deadline 内 continue（含恰好等于 deadline 的边界）', () => {
    assert.equal(nextRestartWait({ phase: 'before-ping', now: 90, deadlineAt: 90 }), 'continue')
    assert.equal(nextRestartWait({ phase: 'before-ping', now: 50, deadlineAt: 90 }), 'continue')
  })
  it('after-ping：boot 已变 done，未变 continue；deadline 已过也不产 timeout（deadline 只在 before-ping 查）', () => {
    assert.equal(nextRestartWait({ phase: 'after-ping', bootChanged: true }), 'done')
    assert.equal(nextRestartWait({ phase: 'after-ping', bootChanged: false }), 'continue')
    assert.equal(nextRestartWait({ phase: 'after-ping', bootChanged: false, now: 999, deadlineAt: 90 }), 'continue')
  })
  it('bootChanged 缺省 false', () => {
    assert.equal(nextRestartWait({ phase: 'after-ping' }), 'continue')
  })
})
