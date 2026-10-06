/**
 * 0.9.20：latest 探测缓存的唯一 owner——**纯内存 Map + TTL**（ADR-0006）。
 * 设计立场：缓存是优化不是功能；「重启即失效」是特性而非缺陷。0.9.14 的磁盘信封层
 * （write-through 落盘 + 懒 seed，跨重启存活）在 2026-10-03 事故中被证伪为负债：
 * 发版窗口内重启/重开面板全部吃到陈旧 latest（唯一失效通道只剩 TTL），卡片与
 * `dshm_outdated` 双双误报「已是最新」。故磁盘层整体退役——重启变回可靠逃生门，
 * 代价是重启后首轮受限重探（8 并发 + deadline 兜底，TTL 内只付一次）。
 * 0.9.14 遗留的 `<cacheRoot>/latest/<ns>.json` 惰性文件由 ensureLatestCacheSwept
 * 在探测段一次性 best-effort 清扫（每 (namespace,profile) 记忆化，失败静默）。
 * mutation 协作（0.9.20 ①）：install/upgrade/uninstall 成功后由 market.ts 调
 * invalidateLatestCache 按 itemId 定向作废（只失效不回写：故意装旧版时回写会伪造
 * latest=已装版本；registry 真值交给下一次探测）。
 */
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { WEB_PROFILE, cacheRoot } from './env.js'
import type { RegistryCacheNamespace, RegistryEntry } from './registry.js'
import { onRouteSwitch } from './npm-route.js'

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

/** 缓存键第三段（itemId）：浏览页键 / 已装页 matched 键 / npm-only 键共用同一尾段，定向失效按它匹配。 */
export function latestItemId(item: Pick<RegistryEntry, 'source' | 'npm' | 'github' | 'id'>): string {
  return item.source === 'npm' && item.npm ? `npm:${item.npm}` : item.github ? `gh:${item.github}` : item.id
}

export function latestCacheKey(namespace: RegistryCacheNamespace, registryKey: string, item: Pick<RegistryEntry, 'source' | 'npm' | 'github' | 'id'>): string {
  return `${namespace}|${registryKey}|${latestItemId(item)}`
}

/** TTL 过期即从内存删除条目并返回 null（过期值不复活、不外泄；不得以 ttlMin=0 当「force 穿透」用——会先删旧值）。 */
export function readLatestCache(key: string, ttlMin: number): LatestValue | null {
  const entry = latestCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at >= ttlMin * 60_000) {
    latestCache.delete(key)
    return null
  }
  return entry.value
}

/**
 * peek 读取（0.9.45，ADR-0013）：不判 TTL、不删除——供 force 全页重探时旧值兜底展示。
 * 落实 ADR-0006 在案约束：「force 穿透须用 peek 不删除语义，而非 ttlMin=0 先删后探（失败时旧值丢失）」；
 * force 重探成功覆盖缓存，失败保留旧值 + latestError，不产生空徽标窗口。
 */
export function peekLatestCache(key: string): LatestValue | null {
  return latestCache.get(key)?.value ?? null
}

/** 内存 set（超上限淘汰最旧）；纯内存，无任何落盘。 */
export function writeLatestCache(key: string, value: LatestValue): void {
  if (latestCache.size >= LATEST_CACHE_MAX) {
    const oldest = latestCache.keys().next().value
    if (oldest !== undefined) latestCache.delete(oldest)
  }
  latestCache.set(key, { at: Date.now(), value })
}

/**
 * 0.9.20 ①：mutation 成功后的定向失效——按 itemId 尾段作废该条目在指定 namespace 下的
 * 全部 registryKey 变体（浏览页键、已装页 matched 键、npm-only 键共用同一 itemId）。
 * 返回删除条数（测试断言用）。
 */
export function invalidateLatestCache(namespace: RegistryCacheNamespace, itemId: string): number {
  const prefix = `${namespace}|`
  const suffix = `|${itemId}`
  let removed = 0
  for (const key of [...latestCache.keys()]) {
    if (key.startsWith(prefix) && key.endsWith(suffix)) {
      latestCache.delete(key)
      removed += 1
    }
  }
  return removed
}

// ---------- 0.9.14 遗留磁盘信封的一次性清扫（ADR-0006） ----------

const swept = new Map<string, Promise<void>>()

/** 探测段前调用：删除遗留 `<cacheRoot>/latest/<ns>.json`（退役后的惰性文件，删失败静默）；每 (namespace,profile) 记忆化一次。 */
export async function ensureLatestCacheSwept(opts: { namespace?: RegistryCacheNamespace; profile?: string } = {}): Promise<void> {
  const namespace = opts.namespace ?? 'host'
  const profile = opts.profile ?? WEB_PROFILE
  const memoKey = `${namespace}§${profile}`
  let task = swept.get(memoKey)
  if (!task) {
    task = rm(join(cacheRoot(profile), 'latest', `${namespace}.json`), { force: true }).catch(() => undefined)
    swept.set(memoKey, task)
  }
  await task
}

/** 测试钩子：清内存 Map + 清扫记忆化（dsh-version.ts resetDshVersionCacheForTest 同款先例）。 */
export function resetLatestCacheForTest(): void {
  latestCache.clear()
  swept.clear()
}

/** L1（ADR-0012）：npm 生效源切换 → 整体作废 latest 探测缓存（镜像的答案不是官方源的答案）。 */
export function clearAllLatestCache(): void {
  latestCache.clear()
}
onRouteSwitch(() => clearAllLatestCache())
