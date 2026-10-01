/**
 * 0.9.14 Task 4a：latest 探测缓存的唯一 owner——内存 Map + 磁盘信封层（write-through）。
 * 磁盘文件 `<cacheRoot(profile)>/latest/<namespace>.json`：置于 nsDir 之外——registry.ts
 * pruneCaches 只清扫 `<ns>/` 顶层 *.json（keep 集不含 latest），放 nsDir 内会被每次
 * registry 刷新成功后的 prune 删除。信封 { version, namespace, entries }；损坏/版本不符
 * 整文件弃；全部磁盘操作静默失败（缓存是优化不是功能）。Task 4b 由 market.ts 接线
 * （探测段前 ensureLatestCacheSeeded + writeLatestCache write-through 迁移）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WEB_PROFILE, cacheRoot } from './env.js'
import type { RegistryCacheNamespace, RegistryEntry } from './registry.js'

export const LATEST_CACHE_VERSION = 1

export interface LatestValue {
  version?: string
  tag?: string
  sha?: string
}

interface LatestCacheEntry {
  at: number
  value: LatestValue
}

const latestCache = new Map<string, LatestCacheEntry>()
const LATEST_CACHE_MAX = 5000
/** seed 硬上限淘汰窗口：超过 24h 的条目不再灌内存（write/seed 双侧一致） */
const SEED_MAX_AGE_MS = 24 * 60 * 60_000

export function latestCacheKey(namespace: RegistryCacheNamespace, registryKey: string, item: Pick<RegistryEntry, 'source' | 'npm' | 'github' | 'id'>): string {
  const id = item.source === 'npm' && item.npm ? `npm:${item.npm}` : item.github ? `gh:${item.github}` : item.id
  return `${namespace}|${registryKey}|${id}`
}

export function readLatestCache(key: string, ttlMin: number): LatestValue | null {
  const entry = latestCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at >= ttlMin * 60_000) {
    latestCache.delete(key)
    return null
  }
  return entry.value
}

// ---------- 磁盘信封层（write-through；串行队列防并发读改写互相覆盖） ----------

interface LatestEnvelope {
  version: number
  namespace: RegistryCacheNamespace
  entries: Record<string, LatestCacheEntry>
}

function latestDir(profile: string): string {
  return join(cacheRoot(profile), 'latest')
}

function latestFile(namespace: RegistryCacheNamespace, profile: string): string {
  return join(latestDir(profile), `${namespace}.json`)
}

let persistChain: Promise<void> = Promise.resolve()

/** 入队时快照单条（key+entry）：flush 晚于内存 reset 也不丢数据；串行链防并发读改写互相覆盖。 */
function queuePersist(key: string, namespace: RegistryCacheNamespace, profile: string, entry: LatestCacheEntry): void {
  persistChain = persistChain.then(() => persistEnvelope(key, namespace, profile, entry)).catch(() => undefined)
}

async function persistEnvelope(key: string, namespace: RegistryCacheNamespace, profile: string, entry: LatestCacheEntry): Promise<void> {
  let entries: Record<string, LatestCacheEntry> = {}
  try {
    const parsed = JSON.parse(await readFile(latestFile(namespace, profile), 'utf8')) as LatestEnvelope
    if (
      parsed && typeof parsed === 'object' &&
      parsed.version === LATEST_CACHE_VERSION && parsed.namespace === namespace &&
      parsed.entries && typeof parsed.entries === 'object'
    ) {
      entries = parsed.entries
    }
  } catch {
    // 无/损坏信封 → 从本条重建（静默）
  }
  const floor = Date.now() - SEED_MAX_AGE_MS
  for (const k of Object.keys(entries)) {
    const e = entries[k]
    if (!e || typeof e !== 'object' || typeof e.at !== 'number' || !Number.isFinite(e.at) || e.at < floor) delete entries[k]
  }
  entries[key] = entry
  const envelope: LatestEnvelope = { version: LATEST_CACHE_VERSION, namespace, entries }
  await mkdir(latestDir(profile), { recursive: true })
  const file = latestFile(namespace, profile)
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(envelope))
  await rename(tmp, file)
}

/** 内存 set + write-through：ns 自 key 首段 `|` 前缀解析定位 `<ns>.json` 信封；profile 缺省 web（0.9.0 双 profile 段约定，调用方可显式传）。 */
export function writeLatestCache(key: string, value: LatestValue, profile: string = WEB_PROFILE): void {
  if (latestCache.size >= LATEST_CACHE_MAX) {
    const oldest = latestCache.keys().next().value
    if (oldest !== undefined) latestCache.delete(oldest)
  }
  latestCache.set(key, { at: Date.now(), value })
  const ns = key.split('|', 1)[0]
  if (ns !== 'host' && ns !== 'cli') return
  const entry = latestCache.get(key)
  if (!entry) return
  queuePersist(key, ns, profile, entry)
}

// ---------- 懒 seed（每 (namespace,profile) 记忆化一次） ----------

const seeded = new Map<string, Promise<void>>()

export async function ensureLatestCacheSeeded(opts: { namespace?: RegistryCacheNamespace; profile?: string } = {}): Promise<void> {
  const namespace = opts.namespace ?? 'host'
  const profile = opts.profile ?? WEB_PROFILE
  const memoKey = `${namespace}§${profile}`
  let task = seeded.get(memoKey)
  if (!task) {
    task = (async () => {
      await persistChain.catch(() => undefined) // 先排空 write-through 队列（写→reset→seed 顺序亦确定成立）
      await seedFromDisk(namespace, profile)
    })().catch(() => undefined)
    seeded.set(memoKey, task)
  }
  await task
}

async function seedFromDisk(namespace: RegistryCacheNamespace, profile: string): Promise<void> {
  let raw: string
  try {
    raw = await readFile(latestFile(namespace, profile), 'utf8')
  } catch {
    return // 无信封 = 首次运行；静默
  }
  let envelope: LatestEnvelope
  try {
    const parsed = JSON.parse(raw) as LatestEnvelope
    if (!parsed || typeof parsed !== 'object') return
    if (parsed.version !== LATEST_CACHE_VERSION || parsed.namespace !== namespace) return
    if (!parsed.entries || typeof parsed.entries !== 'object') return
    envelope = parsed
  } catch {
    return // 损坏整文件弃（静默，行为退化为现状探测重放）
  }
  const floor = Date.now() - SEED_MAX_AGE_MS
  for (const [key, entry] of Object.entries(envelope.entries)) {
    if (!entry || typeof entry !== 'object') continue
    if (typeof entry.at !== 'number' || !Number.isFinite(entry.at) || entry.at < floor) continue
    if (!entry.value || typeof entry.value !== 'object') continue
    if (!latestCache.has(key)) latestCache.set(key, entry)
  }
}

/** 测试钩子：清内存 Map + seed 记忆化（dsh-version.ts resetDshVersionCacheForTest 同款先例）。 */
export function resetLatestCacheForTest(): void {
  latestCache.clear()
  seeded.clear()
}
