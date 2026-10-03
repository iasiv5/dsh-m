/**
 * 已装页两段加载合并/统计纯逻辑（ADR-0008）。
 * 运行：node --test tests/client-installed-updates.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { applyInstalledUpdates, installedUpdateStats } from '../src/client/installed-updates.js'

const base = { pkg: 'a', name: 'A', version: '1.0.0' }
const upd = (over = {}) => ({
  pkg: 'a', latestVersion: '2.0.0', latestTag: null, latestSha: null,
  outdated: true, latestError: null, latestErrorCode: null, ...over,
})

describe('applyInstalledUpdates', () => {
  it('七字段按 pkg 落位：outdated 与 latestError 项都在 updates 内', () => {
    const items = [{ ...base }, { pkg: 'b', name: 'B', version: '1.0.0' }]
    const updates = [
      upd(),
      { pkg: 'b', latestVersion: null, latestTag: null, latestSha: null, outdated: false, latestError: '更新检查未完成：超时', latestErrorCode: 'timeout' },
    ]
    const merged = applyInstalledUpdates(items, updates)
    assert.equal(merged[0].latestVersion, '2.0.0')
    assert.equal(merged[0].outdated, true)
    assert.equal(merged[1].latestError, '更新检查未完成：超时')
    assert.equal(merged[1].latestErrorCode, 'timeout')
    assert.equal(merged[1].outdated, false)
  })

  it('updates 缺席的 pkg 原样保留；未知 pkg 忽略', () => {
    const items = [{ ...base }, { pkg: 'c', name: 'C', version: '0.1.0' }]
    const merged = applyInstalledUpdates(items, [upd()])
    assert.equal(merged[1].latestVersion, undefined)
    assert.deepEqual(merged[1], { pkg: 'c', name: 'C', version: '0.1.0' })
  })

  it('不可变：原数组与原 item 对象不被改写', () => {
    const item = { ...base }
    const items = [item]
    applyInstalledUpdates(items, [upd()])
    assert.deepEqual(item, { pkg: 'a', name: 'A', version: '1.0.0' })
    assert.equal(items.length, 1)
  })

  it('items/updates 非数组安全降级', () => {
    assert.deepEqual(applyInstalledUpdates(null, [upd()]), [])
    assert.deepEqual(applyInstalledUpdates([{ ...base }], 'nope'), [{ ...base }])
    assert.deepEqual(applyInstalledUpdates(undefined, undefined), [])
  })
})

describe('installedUpdateStats', () => {
  it('分别计数 outdated 与 latestError；null 安全', () => {
    const items = [
      { pkg: 'a', outdated: true },
      { pkg: 'b', outdated: false, latestError: '更新检查未完成：超时' },
      { pkg: 'c', outdated: true, latestError: 'GitHub 更新检查预算已用尽' },
      { pkg: 'd', outdated: false },
    ]
    assert.deepEqual(installedUpdateStats(items), { outdatedCount: 2, incompleteCount: 2 })
    assert.deepEqual(installedUpdateStats(null), { outdatedCount: 0, incompleteCount: 0 })
  })
})
