/**
 * 0.7.0 Task 14：收藏纯模块——load/save 往返 / toggle / removeIds / partitionStale
 * （命中/未命中/部分 reject/owner--name 合成 id 语义）/ 持久化异常静默。
 * 运行：node --test tests/client-favorites.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createFavoritesStore, partitionStale, FAV_STORAGE_KEY } from '../src/client/favorites.js'

function memStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v))
    },
    removeItem: (k) => m.delete(k),
    _map: m,
  }
}

const snap = (over = {}) => ({
  id: 'furongjun-1999--dsh-memory',
  name: 'dsh-memory',
  description: '记忆插件',
  category: 'memory',
  source: 'npm',
  npm: 'dsh-memory',
  ...over,
})

describe('createFavoritesStore', () => {
  it('toggle 存/取往返 + 再 toggle 移除；removeIds 批量清理', () => {
    const storage = memStorage()
    const store = createFavoritesStore(storage)
    assert.equal(store.list().length, 0)
    let next = store.toggle(snap({ downloads: 5, owner: 'furongjun-1999' }))
    assert.equal(next.length, 1)
    assert.equal(next[0].snapshot.owner, 'furongjun-1999')
    // 新 store 从 localStorage 读回（持久化往返）
    const store2 = createFavoritesStore(storage)
    assert.equal(store2.list().length, 1)
    assert.equal(store2.list()[0].id, 'furongjun-1999--dsh-memory')
    // toggle 同 id → 移除
    next = store.toggle(snap())
    assert.equal(next.length, 0)
    // removeIds
    store.toggle(snap({ id: 'a' }))
    store.toggle(snap({ id: 'b' }))
    next = store.removeIds(['a'])
    assert.deepEqual(next.map((f) => f.id), ['b'])
  })

  it('持久化异常静默降级（不抛、内存态可用）', () => {
    const boom = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    const store = createFavoritesStore(boom)
    const next = store.toggle(snap())
    assert.equal(next.length, 1)
    assert.equal(store.persistDegraded, true)
    // storage 缺失（null）同样内存态
    const s2 = createFavoritesStore(null)
    assert.equal(s2.toggle(snap({ id: 'x' })).length, 1)
  })

  it('脏持久化数据安全收敛', () => {
    const storage = memStorage()
    storage.setItem(FAV_STORAGE_KEY, JSON.stringify([{ id: 'ok', savedAt: 1, snapshot: { id: 'ok' } }, null, { bad: 1 }]))
    assert.equal(createFavoritesStore(storage).list().length, 1)
  })
})

describe('partitionStale', () => {
  it('命中→live；未命中→stale；保持原顺序（并发完成序不干扰）', async () => {
    const favs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ id: `f-${n}`, savedAt: n, snapshot: { id: `f-${n}` } }))
    const { live, stale } = await partitionStale(favs, async (f) => Number(f.id.split('-')[1]) % 3 !== 0)
    // 字符串字典序：f-10 < f-2
    assert.deepEqual([...live.map((f) => f.id)].sort(), ['f-1', 'f-10', 'f-2', 'f-4', 'f-5', 'f-7', 'f-8'])
    assert.deepEqual([...stale.map((f) => f.id)].sort(), ['f-3', 'f-6', 'f-9'])
    // live 内部保持收藏原顺序（f-1 在 f-2 前，f-8 在 f-10 前——数值序）
    const liveNums = live.map((f) => Number(f.id.split('-')[1]))
    assert.deepEqual([...liveNums].sort((a, b) => a - b), liveNums, 'live 保持收藏写入顺序')
  })

  it('lookup reject 视为 stale（保守：查不到=不在目录）且不中断整体', async () => {
    const favs = [{ id: 'ok', savedAt: 1, snapshot: { id: 'ok' } }, { id: 'boom', savedAt: 2, snapshot: { id: 'boom' } }]
    const { live, stale } = await partitionStale(favs, async (f) => {
      if (f.id === 'boom') throw new Error('network')
      return true
    })
    assert.deepEqual(live.map((f) => f.id), ['ok'])
    assert.deepEqual(stale.map((f) => f.id), ['boom'])
  })

  it('owner--name 合成 id 的 lookup 语义：结果集成员判定（不依赖 top-1）', async () => {
    // 模拟 Task 3 相关性语义：query=id 时目标必在结果集（可能不在首位）
    const fav = { id: 'owner--name', savedAt: 1, snapshot: { id: 'owner--name' } }
    const fakeSearch = async (q) => (q === 'owner--name' ? [{ id: 'zzz--other' }, { id: 'owner--name' }] : [])
    const lookup = async (f) => {
      const results = await fakeSearch(f.id)
      return results.some((r) => r.id === f.id)
    }
    const { live, stale } = await partitionStale([fav], lookup)
    assert.deepEqual(live.map((f) => f.id), ['owner--name'])
    assert.deepEqual(stale, [])
  })

  it('空收藏与脏输入安全', async () => {
    const r = await partitionStale([], async () => true)
    assert.deepEqual(r, { live: [], stale: [] })
    const r2 = await partitionStale(null, async () => true)
    assert.deepEqual(r2, { live: [], stale: [] })
  })
})
