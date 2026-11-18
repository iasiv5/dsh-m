/**
 * ADR-0039：dshm_list 卡片行模型（纯函数，DOM-free）。
 * 新数据形状读 market / update / uncheckedReason；旧数据形状（无这些字段）按 registryId 与 outdated 回退。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { listRowsOf } from '../src/client/tool-view.js'

const wrap = (items) => ({ block: { meta: { kind: 'dshm-list', items } } })

describe('listRowsOf：新数据形状', () => {
  it('三态市场标签与更新徽标', () => {
    const rows = listRowsOf(wrap([
      { pkg: 'a', name: 'A', version: '1.0.0', market: 'market', registryId: 'a', update: 'latest' },
      { pkg: 'b', name: 'B', version: '1.0.0', market: 'non-market', registryId: null, update: 'upgradable', latestVersion: '2.0.0' },
      { pkg: 'c', name: 'C', version: '1.0.0', market: 'unknown', registryId: null, update: 'unchecked', uncheckedReason: 'registry-unavailable' },
      { pkg: 'd', name: 'D', version: '1.0.0', market: 'market', registryId: 'd', update: 'incomplete', latestErrorCode: 'timeout' },
    ]))
    assert.deepEqual(rows.map((r) => r.marketLabel), ['市场', '非市场', '未知', '市场'])
    assert.equal(rows[0].updateLabel, null)
    assert.equal(rows[1].updateLabel, '可升级 → v2.0.0')
    assert.equal(rows[2].updateLabel, '未检查')
    assert.equal(rows[3].updateLabel, '检查未完成')
  })

  it('未知市场用 warn 色，非市场用 info 色', () => {
    const rows = listRowsOf(wrap([
      { pkg: 'b', name: 'B', version: '1.0.0', market: 'non-market', update: 'latest' },
      { pkg: 'c', name: 'C', version: '1.0.0', market: 'unknown', update: 'unchecked' },
    ]))
    assert.equal(rows[0].marketClass, 'dshm-badge info')
    assert.equal(rows[1].marketClass, 'dshm-badge warn')
  })

  it('GitHub 可升级项的目标用 latestTag', () => {
    const rows = listRowsOf(wrap([
      { pkg: 'g', name: 'G', version: '1.0.0', market: 'market', update: 'upgradable', latestTag: 'v3.0.0' },
    ]))
    assert.equal(rows[0].updateLabel, '可升级 → v3.0.0')
  })

  it('意图停用：userDisabled 为真时带标记', () => {
    const rows = listRowsOf(wrap([
      { pkg: 'o', name: 'O', version: '1.0.0', market: 'market', update: 'upgradable', latestVersion: '2.0.0', userDisabled: true },
      { pkg: 'p', name: 'P', version: '1.0.0', market: 'market', update: 'latest' },
    ]))
    assert.equal(rows[0].userDisabled, true)
    assert.equal(rows[1].userDisabled, false)
  })
})

describe('listRowsOf：旧数据形状回退', () => {
  it('无 market / update 字段时按 registryId 与 outdated 判定，与旧版一致', () => {
    const rows = listRowsOf(wrap([
      { pkg: 'o', name: 'O', version: '1.0.0', registryId: 'o', outdated: true, latestVersion: '2.0.0' },
      { pkg: 'p', name: 'P', version: '1.0.0', registryId: null },
    ]))
    assert.deepEqual(rows.map((r) => r.marketLabel), ['市场', '非市场'])
    assert.equal(rows[0].updateLabel, '可升级 → v2.0.0')
    assert.equal(rows[1].updateLabel, null)
  })
})

describe('listRowsOf：空载荷', () => {
  it('无 items 时返回空数组', () => {
    assert.deepEqual(listRowsOf({}), [])
    assert.deepEqual(listRowsOf({ content: 'plain text' }), [])
  })
})
