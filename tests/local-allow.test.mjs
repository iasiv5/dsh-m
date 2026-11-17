/**
 * issue #76/ADR-0038 v1.3：白名单写死在源码（LOCAL_UPGRADE_ALLOWLIST），CLI env 注入并集。
 * 运行：npm run build && node --test tests/local-allow.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { localUpgradeAllowSet, LOCAL_UPGRADE_ALLOWLIST } from '../lib/core/local-allow.js'

const EXPECTED = [
  '@iasiv5/dsh-obmc-web',
  '@iasiv5/dsh-quota-watch',
  '@iasiv5/dsh-skills',
  '@iasiv5/dsh-skins',
  '@iasiv5/dsh-skip-browser-auth',
  '@iasiv5/dsh-surf',
  '@inventec/dsh-copilot-auth',
  '@inventec/dsh-onetree-log',
  'dsh-l',
  'dsh-m',
  'dsh-send-later',
  'dsh-stock-kanban',
]

describe('local-allow 写死名单（v1.3）', () => {
  it('① 名单内容钉死为 12 项（维护者 npm 包，逐字）', () => {
    assert.deepEqual([...LOCAL_UPGRADE_ALLOWLIST], EXPECTED)
  })

  it('② 无注入 → 判定集合即写死名单', () => {
    assert.deepEqual([...localUpgradeAllowSet(undefined)].sort(), [...EXPECTED].sort())
  })

  it('③ CLI 注入并集：trim、去空、非字符串丢弃，写死名单内的名字不重复计入', () => {
    const s = localUpgradeAllowSet({ localUpgradeAllow: [' extra-a ', 'dsh-m', '', 3] })
    assert.ok(s.has('extra-a'))
    assert.ok(s.has('dsh-m'))
    assert.equal(s.size, EXPECTED.length + 1)
  })

  it('④ 精确匹配：无 scope 同名他人包（dsh-skins）与大小写变体不命中', () => {
    const s = localUpgradeAllowSet(undefined)
    assert.equal(s.has('dsh-skins'), false, '无 scope 的 dsh-skins 属他人，不在名单')
    assert.equal(s.has('DSH-M'), false)
  })
})
