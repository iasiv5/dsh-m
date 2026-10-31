/**
 * release-lock 纯函数单测（scripts/release-lock.mjs）。
 * 运行：node --test tests/release-lock.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { lockVersionMismatch } from '../scripts/release-lock.mjs'

describe('lockVersionMismatch：package.json 与 lock 三处版本一致判定', () => {
  it('三处一致 → null', () => {
    const pkg = { version: '0.11.12' }
    const lock = { version: '0.11.12', packages: { '': { version: '0.11.12' } } }
    assert.equal(lockVersionMismatch(pkg, lock), null)
  })

  it('lock 根版本落后 → 报告不一致并给出三处取值', () => {
    const pkg = { version: '0.11.12' }
    const lock = { version: '0.11.11', packages: { '': { version: '0.11.12' } } }
    const msg = lockVersionMismatch(pkg, lock)
    assert.match(msg, /package\.json=0\.11\.12/)
    assert.match(msg, /lock 根=0\.11\.11/)
  })

  it('packages[""] 落后 → 不一致', () => {
    const pkg = { version: '0.11.12' }
    const lock = { version: '0.11.12', packages: { '': { version: '0.11.11' } } }
    assert.notEqual(lockVersionMismatch(pkg, lock), null)
  })

  it('lock 缺少 packages[""] → 不一致（不因缺失而误判通过）', () => {
    const pkg = { version: '0.11.12' }
    assert.notEqual(lockVersionMismatch(pkg, { version: '0.11.12' }), null)
  })

  it('package.json 缺少 version 或为空 → 不一致', () => {
    assert.notEqual(lockVersionMismatch({}, { version: '0.11.12' }), null)
    assert.notEqual(lockVersionMismatch({ version: '' }, { version: '' }), null)
    assert.notEqual(lockVersionMismatch(null, null), null)
  })
})
