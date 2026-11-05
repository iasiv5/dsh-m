/**
 * 发布时刻（最后发布时间）取数与磁盘缓存唯一属主（ADR-0031，issue #45）：
 * 搜索/详情展示用的「最后发布时刻」= **包级** npm packument `time.modified` 语义
 * （最后发布活动时刻，缺席回退各版本发布时刻最大值、排除 `created`），ISO string；
 * 磁盘缓存 store（TTL 24h 硬过期、只存成功值、键 = 包名 + 生效 registry）为本模块独占，
 * packument 内存缓存（5min TTL / cap 4，ADR-0006 预检语义）不受本模块影响。
 * 消歧义（R6）：区别于 `release-age.ts` 的**版本级** `publishedAt`（`times[version]` →
 * epoch ms number，服务发布等待期/排除治理）——同名异义，两处注释互指。
 */
/** 缓存 TTL：24h 硬过期（B4 裁决——误差上界 1 天，天粒度展示不可见；过期同步重取，无 SWR）。 */
export const PUBLISHED_AT_TTL_MS = 24 * 60 * 60_000
/** store 条目上限：超限按 `at` 最旧淘汰（B4）。 */
export const PUBLISHED_AT_STORE_MAX = 20_000
/** 发布时刻取数载荷上限：64MB。默认 8MB 会确定性拒绝重型包（实测 billion-context：
 * 8096 版本 / 32MB packument）——只影响本模块生产取数通道，共享访问器缺省值不动。 */
export const PUBLISHED_AT_MAX_BYTES = 64 * 1024 * 1024

/**
 * 大载荷 fetcher：抬高 maxBytes 上限后透传（其余选项逐字保留）。
 * 仅发布时刻生产取数通道使用；`base` 可注入供测试断言抬升行为。
 */
export function makeLargeFetcher(base?: typeof fetchJsonLimited): typeof fetchJsonLimited {
  const inner = base ?? fetchJsonLimited
  return (url, opts) => inner(url, { ...opts, maxBytes: Math.max(opts?.maxBytes ?? 0, PUBLISHED_AT_MAX_BYTES) })
}

const LARGE_FETCHER = /* 惰性绑定：lib 构建后模块级常量持有包装器 */ makeLargeFetcher()

export interface PublishedAtDeps {
  packumentTimes?: (pkg: string, timeoutMs?: number, signal?: AbortSignal) => Promise<Record<string, string> | null>
  nowMs?: () => number
}

/**
 * packument `time` 表 → 包级最后发布时刻（ISO string 原样透传）：
 * `modified` 键可解析则原样返回；否则对键 `!== 'created'` 的条目取 `Date.parse` 最大者
 * 返回其原键值；无可解析 → null（纯函数，不抛）。
 */
export function modifiedOf(times: Record<string, string>): string | null {
  const modified = times['modified']
  if (typeof modified === 'string' && modified !== '' && Number.isFinite(Date.parse(modified))) return modified
  let best: { key: string; at: number } | null = null
  for (const [key, value] of Object.entries(times)) {
    if (key === 'created') continue
    const at = Date.parse(value)
    if (!Number.isFinite(at)) continue
    if (best === null || at > best.at) best = { key, at }
  }
  return best ? times[best.key] ?? null : null
}

/**
 * ISO 时刻 → 展示部件：`date`（ISO 日期段）与 `days`（距 nowMs 的整天数，下取、clamp ≥0）；
 * 解析失败 → null（纯函数，不抛）。三端展示格式化消费（tools ` · 发布 …`、CLI `最后发布 …`、
 * GUI 弹窗 kv）；client 不引 core，弹窗侧等价内联（计划 Task 7，展示格式化不入属主）。
 */
export function publishedAtParts(iso: string, nowMs?: number): { date: string; days: number } | null {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return null
  const now = nowMs ?? Date.now()
  const days = Math.max(0, Math.floor((now - at) / 86_400_000))
  return { date: iso.slice(0, 10), days }
}

// ---------- 磁盘缓存层（ADR-0031；profile 无关共享文件，npm-route.json 先例） ----------

import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fetchJsonLimited } from './httpx.js'
import { packumentTimes } from './packument.js'
import { cacheDir } from './env.js'
import { activeNpmRegistry } from './npm-route.js'
import { writeFileAtomic, withFileLock } from './atomic-write.js'

interface StoreEntry {
  modified: string
  at: number
}
type StoreEntries = Record<string, StoreEntry>

const STORE_VERSION = 1

function storePath(): string {
  return join(cacheDir(), 'published-at', 'store.json')
}

/** store 读取（envelope 校验；缺席/损坏/版本不符 = 空表，不抛）。 */
function readStoreEntries(): StoreEntries {
  try {
    const raw = JSON.parse(readFileSync(storePath(), 'utf8')) as { version?: unknown; entries?: unknown }
    if (raw?.version !== STORE_VERSION || !raw.entries || typeof raw.entries !== 'object' || Array.isArray(raw.entries)) return {}
    return raw.entries as StoreEntries
  } catch {
    return {}
  }
}

/** 超限淘汰 `at` 最旧（纯函数；`at` 缺失视为最旧）。 */
export function evictOldest(entries: StoreEntries, max: number): StoreEntries {
  const list = Object.entries(entries)
  if (list.length <= max) return entries
  const sorted = [...list].sort((a, b) => (a[1]?.at ?? 0) - (b[1]?.at ?? 0))
  const out: StoreEntries = {}
  for (const [key, value] of sorted.slice(list.length - max)) out[key] = value
  return out
}

/** 进程内 memo（磁盘的镜像；测试隔离钩子清空并强制下次重读盘）。 */
let memo: StoreEntries = {}
let memoLoaded = false

export function clearPublishedAtCacheForTest(): void {
  memo = {}
  memoLoaded = false
}

/**
 * 单条取数（磁盘优先）：① 惰性加载 store；② TTL 内命中直回（零网络）；③ 未命中/过期 →
 * `packumentTimes` → `modifiedOf`；成功才回写（withFileLock 读-改-写 + evictOldest + 原子写）。
 * 失败语义：取数失败/无modified → null，不落盘不写负缓存；回盘自身失败（锁竞争超时/磁盘
 * 错误）吞错不抛，仍返回已取得的值——持久缓存降级为进程内 memo，不冒充落盘成功（R2）。
 */
export async function fetchPublishedAt(
  pkg: string,
  timeoutMs?: number,
  signal?: AbortSignal,
  deps?: PublishedAtDeps,
): Promise<string | null> {
  const nowMs = deps?.nowMs ?? Date.now
  if (!memoLoaded) {
    memo = readStoreEntries()
    memoLoaded = true
  }
  const key = `${pkg}\n${await activeNpmRegistry()}`
  const hit = memo[key]
  if (hit && nowMs() - hit.at < PUBLISHED_AT_TTL_MS) return hit.modified
  const times = deps?.packumentTimes
    ? await deps.packumentTimes(pkg, timeoutMs ?? 12_000, signal)
    : await packumentTimes(pkg, timeoutMs ?? 12_000, signal, { fetchJsonLimited: LARGE_FETCHER })
  const modified = times ? modifiedOf(times) : null
  if (modified === null) return null
  const entry: StoreEntry = { modified, at: nowMs() }
  memo[key] = entry
  try {
    // 锁文件 `<store>.lock` 由 withFileLock 以 wx 直写——父目录必须先于锁在场（registry.ts cacheDirSyncMode 先例）
    await mkdir(dirname(storePath()), { recursive: true })
    await withFileLock(storePath(), async () => {
      const merged: StoreEntries = { ...readStoreEntries(), [key]: entry }
      await writeFileAtomic(
        storePath(),
        JSON.stringify({ version: STORE_VERSION, entries: evictOldest(merged, PUBLISHED_AT_STORE_MAX) }, null, 2) + '\n',
        { mode: 0o600 },
      )
    })
  } catch {
    // 回盘失败吞错（R2）：值已取得 ≠ 缓存失败；下次过期重取自然补盘。
  }
  return modified
}
