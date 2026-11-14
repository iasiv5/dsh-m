/**
 * 精选缺口直查（ADR-0036 R10）：directGap 条目的 npm bulk 下载量拉取（gh star 直查已退役）。
 * - 动态缺口集驱动（curatedGapKeys 的 npmKeys），24h TTL 落盘缓存（<dir>/stats.json，writeFileAtomic）
 *   + 刷新周期 GC（写回仅保留当前 keys）；
 * - npm bulk 一枪（scoped `%2F`，≤128 包/批由调用方分片）失败 → 逐包 point 回退；
 *   bulk 成功但省略键（无记录/0 下载包，npm bulk 实测行为）→ 缺键逐包 point 回退补齐（R7）；
 *   两段并发均 ≤4；
 * - 失败逐项静默（errors 收集）；TTL 过期拉取失败**保留旧值**（装饰性指标 fail-open）；
 *   全失败不落盘（R5：空箱会以「新鲜」身份抑制重试）；
 * - 全部可注入（fetchJson/now），生产缺省 fetchJsonLimited(timeoutMs 8000)。
 * DOM-free 纯逻辑直测于 tests/curated-stats.test.mjs。
 */
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic-write.js'
import { fetchJsonLimited } from './httpx.js'
import { isCommunityEntry, type DirectGapEntry } from './merged-market.js'

export const CURATED_STATS_TTL_MS = 24 * 60 * 60 * 1000

const NPM_BULK = 'https://api.npmjs.org/downloads/point/last-month/'
/** npm point 逐包回退并发上限（round-2 P12② 更名：gh 直查已随 R10 退役，本常量现仅节制 npm 回退腿）。 */
const NPM_POINT_CONCURRENCY = 4
const REQUEST_TIMEOUT_MS = 8_000

export interface CuratedStat {
  downloads?: number
  downloadsStart?: string
  downloadsEnd?: string
  checkedAt: string
}

export interface LoadCuratedStatsInput {
  npmKeys: string[]
  dir: string
  ttlMs?: number
  deadlineAt?: number
  signal?: AbortSignal
  deps?: {
    fetchJson?: (url: string, opts?: Record<string, unknown>) => Promise<unknown>
    now?: () => number
  }
}

export interface LoadCuratedStatsResult {
  stats: Record<string, CuratedStat>
  errors: string[]
}

type FetchJsonFn = (url: string, opts?: Record<string, unknown>) => Promise<unknown>

/**
 * 缺口键集：npm 单源（round-2 P12①：githubKeys 死面移除——R10 契约面退役后两处调用方
 * 均只消费 npmKeys，gh 键产出无任何消费者；模块 gh 能力保留于 annotateDirectStats 键兜底，
 * 供未来 github-only 条目扩展）。双键条目取 npm；无键条目由 mergeRegistries 不产出。
 */
export function curatedGapKeys(entries: DirectGapEntry[]): { npmKeys: string[] } {
  const npmKeys: string[] = []
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e !== 'object') continue
    if (typeof e.npm === 'string' && e.npm !== '') npmKeys.push(e.npm)
  }
  return { npmKeys }
}

/** 缓存箱解析：version=1 + 可解析 fetchedAt + TTL 内（未来时间戳视为腐箱，round-2 P10/O1）+ 非空 entries 对象 → entries；否则 null。 */
export function parseCuratedStatsBox(raw: unknown, now: number, ttlMs: number): Record<string, CuratedStat> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const box = raw as { version?: unknown; fetchedAt?: unknown; entries?: unknown }
  if (box.version !== 1 || typeof box.fetchedAt !== 'string') return null
  const t = Date.parse(box.fetchedAt)
  // t > now（时钟回拨/跨机拷贝缓存）：负年龄恒小于 ttl 会把「未来箱」判新鲜、锁死重拉到
  // 墙钟追上 fetchedAt+ttl——按腐箱走 stale 重拉（round-2 P10/O1，评审探针 +10d 箱实测）。
  if (!Number.isFinite(t) || t > now || now - t > ttlMs) return null
  if (!box.entries || typeof box.entries !== 'object' || Array.isArray(box.entries)) return null
  // 空箱不算新鲜数据（R5：全失败落盘的空箱会以「新鲜」身份抑制重试 24h——19:45 泄漏空箱实测）
  if (Object.keys(box.entries as Record<string, unknown>).length === 0) return null
  return box.entries as Record<string, CuratedStat>
}

const nonNeg = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined

const scopedName = (pkg: string): string => pkg.replace('/', '%2F')

async function readBoxEntries(dir: string, now: number, ttlMs: number): Promise<{ fresh: Record<string, CuratedStat> | null; fallback: Record<string, CuratedStat>; freshFetchedAt: string | null }> {
  try {
    const raw = JSON.parse(await readFile(join(dir, 'stats.json'), 'utf8')) as unknown
    const parsed = parseCuratedStatsBox(raw, now, ttlMs)
    if (parsed) {
      const fetchedAt = typeof (raw as { fetchedAt?: unknown }).fetchedAt === 'string' ? (raw as { fetchedAt: string }).fetchedAt : null
      return { fresh: parsed, fallback: parsed, freshFetchedAt: fetchedAt }
    }
    const entries = (raw as { entries?: unknown }).entries
    if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
      return { fresh: null, fallback: entries as Record<string, CuratedStat>, freshFetchedAt: null }
    }
  } catch {
    /* 无缓存/坏 JSON：零兜底 */
  }
  return { fresh: null, fallback: {}, freshFetchedAt: null }
}

/**
 * 缺口直查编排：缓存新鲜（TTL 内）→ 零网络按 keys 供数；
 * 过期/缺失 → 全量重拉当前 keys（失败键保留旧值 fail-open）→ GC 写回。
 * deadlineAt/signal 由调用方竞速/透传（本函数不做内部超时）。
 */
/** npm 下载量族取数原语：bulk 一枪 → bulk 失败整体逐包回退（并发 ≤NPM_POINT_CONCURRENCY）
 * → R7 bulk 省略键逐包 point 回退补齐。P11 抽取为独立原语供全量/增量两路径共用。 */
async function fetchNpmDownloads(
  pkgs: string[],
  fetchJson: FetchJsonFn,
  checkedAt: string,
): Promise<{ fetched: Record<string, CuratedStat>; errors: string[] }> {
  const errors: string[] = []
  const fetched: Record<string, CuratedStat> = {}
  // npm bulk 一枪 → 失败逐包回退（并发 ≤4）
  const runPerPkgFallback = async (list: string[]): Promise<void> => {
    let cursor = 0
    const workers = Array.from({ length: Math.min(NPM_POINT_CONCURRENCY, list.length) }, async () => {
      for (;;) {
        const idx = cursor
        cursor += 1
        if (idx >= list.length) return
        const pkg = list[idx]
        try {
          const resp = (await fetchJson(NPM_BULK + scopedName(pkg))) as { downloads?: unknown; start?: unknown; end?: unknown } | null
          const downloads = nonNeg(resp?.downloads)
          if (downloads !== undefined) {
            fetched[`npm:${pkg}`] = {
              downloads,
              ...(typeof resp?.start === 'string' ? { downloadsStart: resp.start } : {}),
              ...(typeof resp?.end === 'string' ? { downloadsEnd: resp.end } : {}),
              checkedAt,
            }
          }
        } catch (e) {
          errors.push(`npm:${pkg} ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    })
    await Promise.all(workers)
  }

  if (pkgs.length > 0) {
    try {
      const resp = (await fetchJson(NPM_BULK + pkgs.map(scopedName).join(','))) as Record<string, { downloads?: unknown; start?: unknown; end?: unknown }> | null
      for (const pkg of pkgs) {
        const hit = resp?.[pkg] ?? resp?.[scopedName(pkg)]
        const downloads = nonNeg(hit?.downloads)
        if (downloads !== undefined) {
          fetched[`npm:${pkg}`] = {
            downloads,
            ...(typeof hit?.start === 'string' ? { downloadsStart: hit.start } : {}),
            ...(typeof hit?.end === 'string' ? { downloadsEnd: hit.end } : {}),
            checkedAt,
          }
        }
      }
    } catch (err) {
      errors.push(`npm bulk 失败，逐包回退：${err instanceof Error ? err.message : String(err)}`)
      await runPerPkgFallback(pkgs)
    }
    // R7：bulk 成功但省略键（无记录/0 下载包，npm bulk 实测行为）→ 缺键逐包 point 回退补齐
    const missing = pkgs.filter((pkg) => fetched[`npm:${pkg}`] === undefined)
    if (missing.length > 0) await runPerPkgFallback(missing)
  }
  return { fetched, errors }
}

export async function loadCuratedStats(input: LoadCuratedStatsInput): Promise<LoadCuratedStatsResult> {
  const ttl = typeof input.ttlMs === 'number' && input.ttlMs > 0 ? input.ttlMs : CURATED_STATS_TTL_MS
  const now = input.deps?.now ?? Date.now
  const fetchJson: FetchJsonFn = input.deps?.fetchJson
    ?? (async (url, opts) => fetchJsonLimited(url, { timeoutMs: REQUEST_TIMEOUT_MS, signal: input.signal, ...opts }))
  const errors: string[] = []
  const stats: Record<string, CuratedStat> = {}
  const npmKeys = Array.isArray(input.npmKeys) ? input.npmKeys : []
  const keys = npmKeys.map((k) => `npm:${k}`)
  if (keys.length === 0) {
    return { stats, errors }
  }

  const { fresh, fallback, freshFetchedAt } = await readBoxEntries(input.dir, now(), ttl)
  if (fresh) {
    for (const k of keys) {
      if (fresh[k]) stats[k] = fresh[k]
    }
    // round-2 owner 裁定（评审 P11/O2 落地）：fresh 箱缺新 gap 键不再等 TTL——仅对缺失键增量
    // 补拉（精选集增删自愈即时化）。box 级 TTL 语义对既有键不变：写回保留原 fetchedAt（既有键
    // 的重拉节奏不延展）、按当前键集 GC（惰性残留键随写回收）；补拉零命中不写盘（无信息增量）。
    const missingKeys = npmKeys.filter((pkg) => fresh[`npm:${pkg}`] === undefined)
    if (missingKeys.length === 0) return { stats, errors }
    const checkedAt = new Date(now()).toISOString()
    const inc = await fetchNpmDownloads(missingKeys, fetchJson, checkedAt)
    errors.push(...inc.errors)
    for (const pkg of missingKeys) {
      const hit = inc.fetched[`npm:${pkg}`]
      if (hit) stats[`npm:${pkg}`] = hit
    }
    if (Object.keys(inc.fetched).length > 0) {
      try {
        await mkdir(input.dir, { recursive: true })
        const entries: Record<string, CuratedStat> = {}
        for (const k of keys) {
          if (stats[k]) entries[k] = stats[k]
        }
        await writeFileAtomic(join(input.dir, 'stats.json'), JSON.stringify({ version: 1, fetchedAt: freshFetchedAt ?? checkedAt, entries }))
      } catch (e) {
        errors.push(`cache write: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return { stats, errors }
  }

  const checkedAt = new Date(now()).toISOString()
  const run = await fetchNpmDownloads(npmKeys, fetchJson, checkedAt)
  const fetched = run.fetched
  errors.push(...run.errors)

  // 合并：新值优先，失败键旧值兜底（fail-open，ADR-0036）；GC = 写回仅当前 keys
  for (const k of keys) {
    if (fetched[k]) stats[k] = fetched[k]
    else if (fallback[k]) stats[k] = fallback[k]
  }
  // 空箱一律不落盘（R5 全失败形态 + round-2 P12④ 补面：全成功零数据同样不写——空箱永不
  // 判 fresh，写盘徒增每轮重拉与盘上残迹）
  if (Object.keys(stats).length === 0) {
    return { stats, errors }
  }
  try {
    await mkdir(input.dir, { recursive: true })
    await writeFileAtomic(join(input.dir, 'stats.json'), JSON.stringify({ version: 1, fetchedAt: checkedAt, entries: stats }))
  } catch (e) {
    errors.push(`cache write: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { stats, errors }
}

/**
 * 直查统计注记（ADR-0036）：对 join 后仍无 downloads 的条目按键（npm 优先、gh 兜底）
 * 浅拷贝注记直查结果；无命中/已注记条目原样返回。物化代共享对象禁原地改写，调用方消费副本。
 * C 方案（R10）：注记不带 stars——精选卡只显下载量（ADR-0036 决策修订）。
 * 社区门（评审 P2）：社区条目（isCommunityEntry，判据 descriptionEn）不参与直查注记——缺口键
 * 与社区镜像同 npm 时不得把 direct 预写进社区条目（toMarketItem 社区分支 statsVia 硬置 'catalog'）。
 */
export function annotateDirectStats<T extends { id: string; npm?: string; github?: string; statsVia?: 'catalog' | 'direct' }>(
  items: T[],
  stats: Record<string, CuratedStat>,
): T[] {
  return items.map((it) => {
    if (
      !it || typeof it !== 'object' || it.statsVia !== undefined
      || isCommunityEntry(it as unknown as Parameters<typeof isCommunityEntry>[0])
    ) return it
    const key = typeof it.npm === 'string' && it.npm !== ''
      ? `npm:${it.npm}`
      : typeof it.github === 'string' && it.github !== ''
        ? `gh:${it.github}`
        : null
    const hit = key ? stats[key] : undefined
    if (!hit) return it
    return {
      ...it,
      ...(hit.downloads !== undefined ? { downloads: hit.downloads } : {}),
      ...(typeof hit.downloadsStart === 'string' ? { downloadsStart: hit.downloadsStart } : {}),
      ...(typeof hit.downloadsEnd === 'string' ? { downloadsEnd: hit.downloadsEnd } : {}),
      ...(typeof hit.checkedAt === 'string' ? { downloadsCheckedAt: hit.checkedAt } : {}),
      statsVia: 'direct' as const,
    }
  })
}
