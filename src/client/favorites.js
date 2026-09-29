/**
 * 收藏（0.7.0 Task 14 / DESIGN.md §2.6「收藏」）：浏览器 localStorage 本地收藏
 * （key `dshm-favorites`；不进 profile、不进服务端）；stale 检测 = 逐条以 id 精确查询目录
 * （listMarket query=id，Task 3 保证 id 整串精确匹配命中），结果集成员判定（不依赖 top-1）。
 * 不依赖 DOM/React，Node tests 直接 import。
 */

export const FAV_STORAGE_KEY = 'dshm-favorites'

/**
 * @typedef {Object} FavoriteEntry
 * @property {string} id
 * @property {number} savedAt
 * @property {{ id: string, name: string, description: string, descriptionEn?: string, category: string,
 *              categoryLabel?: string, source: string, npm?: string, github?: string, homepage?: string,
 *              owner?: string, downloads?: number, stars?: number, added?: string, deprecated?: boolean }} snapshot
 */

function safeParse(raw) {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((f) => f && typeof f === 'object' && typeof f.id === 'string') : []
  } catch {
    return []
  }
}

/**
 * @param {Storage | null | undefined} storage 浏览器 localStorage；不可用即内存态（静默降级不抛）
 */
export function createFavoritesStore(storage) {
  const memory = { list: [] }
  const canPersist = () => storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
  let degraded = false

  const persist = (list) => {
    if (!canPersist() || degraded) return
    try {
      storage.setItem(FAV_STORAGE_KEY, JSON.stringify(list))
    } catch {
      degraded = true // 配额/序列化失败：静默降级内存态
    }
  }

  return {
    get persistDegraded() {
      return degraded || !canPersist()
    },
    /** @returns {FavoriteEntry[]} */
    list() {
      let raw = null
      if (canPersist() && !degraded) {
        try {
          raw = storage.getItem(FAV_STORAGE_KEY)
        } catch {
          degraded = true // 读故障：静默降级内存态
          raw = null
        }
      }
      if (!canPersist() || degraded) return memory.list.map((f) => ({ ...f, snapshot: { ...f.snapshot } }))
      return safeParse(raw).map((f) => ({ ...f, snapshot: { ...f.snapshot } }))
    },
    /** toggle 收藏：已存在则移除，否则存快照。@returns 操作后的全量列表。 */
    toggle(snapshot) {
      const list = this.list()
      const next = list.some((f) => f.id === snapshot.id)
        ? list.filter((f) => f.id !== snapshot.id)
        : [...list, { id: snapshot.id, savedAt: Date.now(), snapshot: { ...snapshot } }]
      if (!canPersist() || degraded) memory.list = next
      persist(next)
      return this.list()
    },
    /** 批量移除（清理失效收藏）。 */
    removeIds(ids) {
      const set = new Set(ids)
      const next = this.list().filter((f) => !set.has(f.id))
      if (!canPersist() || degraded) memory.list = next
      persist(next)
      return this.list()
    },
  }
}

/**
 * stale 检测：逐条 lookup（并行 ≤ 8，并发池实现），任何一条 reject 视为该条 stale（保守：查不到=不在目录）。
 * @param {FavoriteEntry[]} favorites
 * @param {(fav: FavoriteEntry) => Promise<boolean>} lookup 单条存在性判定（调用方以
 *        listMarket({query: fav.id, source:'all', limit:8}) 结果集成员判定实现）
 * @returns {Promise<{ live: FavoriteEntry[], stale: FavoriteEntry[] }>}
 */
export async function partitionStale(favorites, lookup) {
  const list = Array.isArray(favorites) ? favorites : []
  const live = []
  const stale = []
  const CONCURRENCY = 8
  let cursor = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
    for (;;) {
      const i = cursor
      cursor += 1
      if (i >= list.length) return
      const fav = list[i]
      let exists = false
      try {
        exists = await lookup(fav)
      } catch {
        exists = false
      }
      if (exists) live.push(fav)
      else stale.push(fav)
    }
  })
  await Promise.all(workers)
  // 保持原收藏顺序（并发完成序不稳定）
  const order = new Map(list.map((f, i) => [f.id, i]))
  live.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  stale.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  return { live, stale }
}
