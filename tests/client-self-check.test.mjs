/**
 * 头部版本角标 self-check 纯逻辑单测（0.9.1）。
 * 覆盖：TTL 缓存读写清、畸形/过期/版本护栏作废、deriveChipState 三态判定。
 * 需求口径：只有 outdated 才点亮（{ kind: 'outdated' }），其余一律静默。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SELF_CHECK_STORAGE_KEY,
  SELF_CHECK_TTL_MS,
  readSelfCheckCache,
  writeSelfCheckCache,
  clearSelfCheckCache,
  deriveChipState,
} from '../src/client/self-check.js'

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

const DATA = { current: '0.9.0', latest: '0.9.1', outdated: true, ahead: false }
const NOW = 1_700_000_000_000

describe('self-check 缓存', () => {
  it('write → read 回环：TTL 内且版本一致命中', () => {
    const s = memStorage()
    writeSelfCheckCache(s, DATA, { now: NOW })
    assert.deepEqual(readSelfCheckCache(s, { now: NOW + 1000, version: '0.9.0' }), DATA)
    // 未传 version：不做版本护栏
    assert.deepEqual(readSelfCheckCache(s, { now: NOW + 1000 }), DATA)
    assert.ok(s._map.has(SELF_CHECK_STORAGE_KEY))
  })

  it('TTL 过期 → null（默认 30 分钟；自定义 ttlMs 同样生效）', () => {
    const s = memStorage()
    writeSelfCheckCache(s, DATA, { now: NOW })
    assert.equal(readSelfCheckCache(s, { now: NOW + SELF_CHECK_TTL_MS + 1 }), null)
    assert.equal(readSelfCheckCache(s, { now: NOW + 1000, ttlMs: 500 }), null)
  })

  it('版本护栏：缓存 current 与当前 version 不一致（升级重启后）→ 作废', () => {
    const s = memStorage()
    writeSelfCheckCache(s, DATA, { now: NOW })
    assert.equal(readSelfCheckCache(s, { now: NOW + 1000, version: '0.9.1' }), null)
    // version 为 null/空（ping 未带回）→ 不启用护栏，照常命中
    assert.deepEqual(readSelfCheckCache(s, { now: NOW + 1000, version: null }), DATA)
  })

  it('畸形情形全部安全返回 null：storage 缺失 / 无键 / 非 JSON / 畸形 box / 畸形 data / 读取抛错', () => {
    assert.equal(readSelfCheckCache(null, {}), null)
    assert.equal(readSelfCheckCache(undefined, {}), null)
    const s = memStorage()
    assert.equal(readSelfCheckCache(s, {}), null)
    s.setItem(SELF_CHECK_STORAGE_KEY, '{not-json')
    assert.equal(readSelfCheckCache(s, {}), null)
    s.setItem(SELF_CHECK_STORAGE_KEY, JSON.stringify({ ts: NOW })) // 缺 data
    assert.equal(readSelfCheckCache(s, {}), null)
    s.setItem(SELF_CHECK_STORAGE_KEY, JSON.stringify({ ts: NOW, data: { no: 'current' } }))
    assert.equal(readSelfCheckCache(s, {}), null)
    s.setItem(SELF_CHECK_STORAGE_KEY, JSON.stringify({ ts: 'NaN', data: DATA }))
    assert.equal(readSelfCheckCache(s, {}), null)
    assert.equal(readSelfCheckCache(memStorage({ throwOn: 'get' }), {}), null)
  })

  it('write 防御：data 畸形 / storage 缺失 / 写入抛错 → 静默（缓存是优化不是功能）', () => {
    const s = memStorage()
    writeSelfCheckCache(s, null, {})
    writeSelfCheckCache(s, { no: 'current' }, {})
    writeSelfCheckCache(null, DATA, {})
    assert.equal(s._map.size, 0)
    writeSelfCheckCache(memStorage({ throwOn: 'set' }), DATA, {})
  })

  it('clear：删除键；storage 缺失/抛错静默', () => {
    const s = memStorage()
    writeSelfCheckCache(s, DATA, { now: NOW })
    clearSelfCheckCache(s)
    assert.equal(readSelfCheckCache(s, { now: NOW }), null)
    clearSelfCheckCache(null)
    clearSelfCheckCache(memStorage({ throwOn: 'remove' }))
  })
})

describe('deriveChipState 三态', () => {
  it('outdated=true 且 latest 非空 → 唯一点亮态', () => {
    assert.deepEqual(deriveChipState(DATA, '0.9.0'), { kind: 'outdated', latest: '0.9.1' })
  })

  it('版本护栏（0.9.2）：check.current ≠ 当前 ping.version（跨服务重启的旧进程判定）→ 一律静默', () => {
    // 面板常开跨重启：version 已是新进程 0.9.1，check 还是旧进程 0.9.0 的 outdated 判定
    // ——不得渲染「v0.9.1 ⬆ v0.9.1」
    assert.deepEqual(deriveChipState(DATA, '0.9.1'), { kind: 'idle' })
    assert.deepEqual(
      deriveChipState({ current: '0.9.0', latest: '0.9.1', outdated: false, ahead: true }, '0.9.1'),
      { kind: 'idle' },
    )
    // version 缺席（ping 失败/旧宿主）→ 无从比对，不启用护栏，维持原判定
    assert.deepEqual(deriveChipState(DATA, null), { kind: 'outdated', latest: '0.9.1' })
  })

  it('outdated=true 但 latest 缺失（服务端半残）→ 静默，不点亮空箭头', () => {
    assert.deepEqual(deriveChipState({ current: '0.9.0', latest: null, outdated: true, ahead: false }), { kind: 'idle' })
    assert.deepEqual(deriveChipState({ current: '0.9.0', outdated: true }), { kind: 'idle' })
  })

  it('ahead → 静默态（仅 title 用），idle 同样静默', () => {
    assert.deepEqual(deriveChipState({ current: '0.9.1', latest: '0.9.0', outdated: false, ahead: true }, '0.9.1'), { kind: 'ahead', latest: '0.9.0' })
    assert.deepEqual(deriveChipState({ current: '0.9.1', latest: null, outdated: false, ahead: true }, '0.9.1'), { kind: 'ahead', latest: null })
    assert.deepEqual(deriveChipState({ current: '0.9.1', latest: '0.9.1', outdated: false, ahead: false }, '0.9.1'), { kind: 'idle' })
    // ahead 携带 error（检查虽成、降级口径）也不影响
    assert.deepEqual(deriveChipState({ current: '0.9.1', latest: '0.9.0', outdated: false, ahead: true, error: 'x' }, '0.9.1'), { kind: 'ahead', latest: '0.9.0' })
  })

  it('无数据 / 检查失败 payload → idle 静默', () => {
    assert.deepEqual(deriveChipState(null, '0.9.0'), { kind: 'idle' })
    assert.deepEqual(deriveChipState(undefined, '0.9.0'), { kind: 'idle' })
    assert.deepEqual(deriveChipState('junk', '0.9.0'), { kind: 'idle' })
    assert.deepEqual(deriveChipState({ current: '0.9.0', latest: null, outdated: false, ahead: false, error: 'network' }, '0.9.0'), { kind: 'idle' })
  })
})
