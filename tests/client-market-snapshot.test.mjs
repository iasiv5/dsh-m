/**
 * 0.9.14 Task 5a：市场默认首页快照纯逻辑单测（镜像 client-self-check.test.mjs 用例族）。
 * 覆盖：读写清回环、TTL 过期、畸形/形状缺失作废、非默认首页拒写、storage 故障静默、
 * isDefaultFirstPageQuery 双 zone 真假表。
 * 导入自 ../src/client/（client 族 esbuild 单 bundle 无 lib 逐文件产物）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MARKET_SNAPSHOT_TTL_MS,
  snapshotKey,
  isDefaultFirstPageQuery,
  readMarketSnapshot,
  writeMarketSnapshot,
  clearMarketSnapshots,
} from '../src/client/market-snapshot.js'

/** Map 存储桩（localStorage 同构子集；throwing 可注入故障）。 */
function memStorage({ throwOn = null } = {}) {
  const m = new Map()
  return {
    getItem: (k) => {
      if (throwOn === 'get') throw new Error('boom')
      return m.has(k) ? m.get(k) : null
    },
    setItem: (k, v) => {
      if (throwOn === 'set') throw new Error('quota')
      m.set(k, String(v))
    },
    removeItem: (k) => {
      if (throwOn === 'remove') throw new Error('boom')
      m.delete(k)
    },
    _map: m,
  }
}

const NOW = 1_700_000_000_000
const RESP_32 = { items: [{ id: 'a' }, { id: 'b' }], total: 2, offset: 0, limit: 32 }
const RESP_96 = { items: [{ id: 'p' }], total: 1, offset: 0, limit: 96 }
const Q_COMMUNITY_DEFAULT = { query: '', category: null, sort: { field: 'downloads', dir: 'desc' }, offset: 0, limit: 32 }
const Q_PRIMARY_DEFAULT = { query: '', category: null, sort: null, offset: 0, limit: 96 }

describe('market-snapshot 缓存', () => {
  it('snapshotKey：双 zone 键隔离', () => {
    assert.equal(snapshotKey('community'), 'dshm-marketsnap-community')
    assert.equal(snapshotKey('primary'), 'dshm-marketsnap-primary')
    assert.equal(snapshotKey('unknown'), 'dshm-marketsnap-community', '非法 zone 归一 community')
  })

  it('write → read 回环：TTL 内命中原响应', () => {
    const s = memStorage()
    writeMarketSnapshot(s, { zone: 'community', response: RESP_32, now: NOW })
    assert.deepEqual(readMarketSnapshot(s, { zone: 'community', now: NOW + 1000 }), RESP_32)
    assert.ok(s._map.has(snapshotKey('community')))
    // 双 zone 互不串扰
    writeMarketSnapshot(s, { zone: 'primary', response: RESP_96, now: NOW })
    assert.deepEqual(readMarketSnapshot(s, { zone: 'primary', now: NOW + 1000 }), RESP_96)
  })

  it('TTL 过期 → null（默认 10 分钟；自定义 ttlMs 同样生效）', () => {
    const s = memStorage()
    writeMarketSnapshot(s, { zone: 'community', response: RESP_32, now: NOW })
    assert.equal(readMarketSnapshot(s, { zone: 'community', now: NOW + MARKET_SNAPSHOT_TTL_MS + 1 }), null)
    assert.equal(readMarketSnapshot(s, { zone: 'community', now: NOW + 1000, ttlMs: 500 }), null)
  })

  it('畸形 JSON / 形状缺失 → null', () => {
    const s = memStorage()
    s._map.set(snapshotKey('community'), 'not-json')
    assert.equal(readMarketSnapshot(s, { zone: 'community', now: NOW }), null)
    s._map.set(snapshotKey('community'), JSON.stringify({ ts: NOW, response: { nope: true } }))
    assert.equal(readMarketSnapshot(s, { zone: 'community', now: NOW }), null)
    s._map.set(snapshotKey('community'), JSON.stringify({ ts: 'x', response: RESP_32 }))
    assert.equal(readMarketSnapshot(s, { zone: 'community', now: NOW }), null)
  })

  it('非默认首页形状的 response 拒写（offset≠0 / limit≠该区默认）', () => {
    const s = memStorage()
    writeMarketSnapshot(s, { zone: 'community', response: { ...RESP_32, offset: 24 }, now: NOW })
    assert.equal(s._map.has(snapshotKey('community')), false)
    writeMarketSnapshot(s, { zone: 'community', response: { ...RESP_32, limit: 64 }, now: NOW })
    assert.equal(s._map.has(snapshotKey('community')), false)
    writeMarketSnapshot(s, { zone: 'primary', response: RESP_32, now: NOW })   // primary 区 limit 32 ≠ 96
    assert.equal(s._map.has(snapshotKey('primary')), false)
  })

  it('storage 不可用 / 故障静默降级', () => {
    assert.equal(readMarketSnapshot(null, { zone: 'community', now: NOW }), null)
    assert.doesNotThrow(() => writeMarketSnapshot(null, { zone: 'community', response: RESP_32, now: NOW }))
    const s = memStorage({ throwOn: 'set' })
    assert.doesNotThrow(() => writeMarketSnapshot(s, { zone: 'community', response: RESP_32, now: NOW }))
    const g = memStorage({ throwOn: 'get' })
    assert.equal(readMarketSnapshot(g, { zone: 'community', now: NOW }), null)
    assert.doesNotThrow(() => clearMarketSnapshots(memStorage({ throwOn: 'remove' })))
  })

  it('clear 后 → null', () => {
    const s = memStorage()
    writeMarketSnapshot(s, { zone: 'community', response: RESP_32, now: NOW })
    writeMarketSnapshot(s, { zone: 'primary', response: RESP_96, now: NOW })
    clearMarketSnapshots(s)
    assert.equal(readMarketSnapshot(s, { zone: 'community', now: NOW }), null)
    assert.equal(readMarketSnapshot(s, { zone: 'primary', now: NOW }), null)
  })
})

describe('isDefaultFirstPageQuery 真假表', () => {
  it('community 默认首页真；limit/sort/query/category/offset 偏离即假', () => {
    assert.equal(isDefaultFirstPageQuery(Q_COMMUNITY_DEFAULT, 'community'), true)
    assert.equal(isDefaultFirstPageQuery({ ...Q_COMMUNITY_DEFAULT, limit: 64 }, 'community'), false)
    assert.equal(isDefaultFirstPageQuery({ ...Q_COMMUNITY_DEFAULT, sort: null }, 'community'), false)
    assert.equal(isDefaultFirstPageQuery({ ...Q_COMMUNITY_DEFAULT, query: 'git' }, 'community'), false)
    assert.equal(isDefaultFirstPageQuery({ ...Q_COMMUNITY_DEFAULT, category: 'ui' }, 'community'), false)
    assert.equal(isDefaultFirstPageQuery({ ...Q_COMMUNITY_DEFAULT, offset: 24 }, 'community'), false)
  })

  it('primary 默认首页真（sort 恒 null、limit 96）；偏离即假', () => {
    assert.equal(isDefaultFirstPageQuery(Q_PRIMARY_DEFAULT, 'primary'), true)
    assert.equal(isDefaultFirstPageQuery({ ...Q_PRIMARY_DEFAULT, limit: 32 }, 'primary'), false)
    assert.equal(isDefaultFirstPageQuery({ ...Q_PRIMARY_DEFAULT, sort: { field: 'downloads', dir: 'desc' } }, 'primary'), false)
    assert.equal(isDefaultFirstPageQuery({ ...Q_PRIMARY_DEFAULT, query: 'x' }, 'primary'), false)
  })
})
