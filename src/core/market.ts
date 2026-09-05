/**
 * 市场编排层：registry × profile × 最新版本 → 市场列表（服务端分页）/ 已装列表 /
 * 安装 / 升级。安装语义见 DESIGN.md §3（npm 精确锁定、GitHub 锁 SHA）。
 * Task 3：服务端 query/category/offset/limit 过滤；只对当前页查 latest（并发 ≤8、
 * TTL cache、共享全局 deadline）；unavailable 返回结构化空页；host/cli namespace 贯穿。
 * 2026-09-05 回滚缺陷加固：B1 成功路径保留 manifest 顶层未知键（如 pnpm.overrides）、
 * 失败路径字节级回滚后 frozen 自愈阶梯（overrides 对齐 → no-frozen 重建，B2）、
 * 新发布后 NO_MATCHING_VERSION 的退避重试 + packument 预热（B3）。
 */
import { existsSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { addDshPlugin, removeDshPlugin, removePatchedDependencyEntries, runCommand } from './dsh-cli.js'
import { dshHome, installTimeoutMs, webProfileDir } from './env.js'
import {
  assertNpmIntegrity,
  atomicWriteFile,
  readPnpmLockIntegrity,
  readPnpmLockOverrides,
  restoreSnapshots,
  snapshotFiles,
  type ProfileFileSnapshot,
} from './npm-integrity.js'
import {
  listInstalledPlugins as defaultListInstalledPlugins,
  readProfileDeps,
  removeInstalledPlugin,
  type InstalledPlugin,
} from './installed.js'
import { setLivePluginDisabled } from './live-plugin.js'
import {
  loadRegistry as defaultLoadRegistry,
  type LoadedRegistry,
  type RegistryCacheNamespace,
  type RegistryConfig,
  type RegistryEntry,
  type RegistryState,
} from './registry.js'
import {
  githubLatestTag as defaultGithubLatestTag,
  isNewerVersion,
  npmLatest as defaultNpmLatest,
  npmPackument as defaultNpmPackument,
  npmVersion,
} from './versions.js'

// ---------- 契约类型 ----------

export interface RegistryRuntimeOptions {
  /** Host API / Agent tools 固定 host；独立 CLI 固定 cli */
  namespace?: RegistryCacheNamespace
  signal?: AbortSignal
}

export type LatestErrorCode = 'LATEST_TIMEOUT' | 'LATEST_ERROR'

export interface MarketItem extends RegistryEntry {
  latestVersion?: string
  latestTag?: string
  latestSha?: string
  installed: boolean
  installedPkg?: string
  installedVersion?: string
  outdated: boolean
  /** 查询最新版本失败的说明（不阻塞列表） */
  latestError?: string
  latestErrorCode?: LatestErrorCode
}

export type CategoryCounts = Record<RegistryEntry['category'], number>

export interface MarketQuery extends RegistryRuntimeOptions {
  query?: string
  category?: RegistryEntry['category'] | null
  offset?: number
  /** core 按 withLatest hard clamp：true 最大 50，false 最大 80 */
  limit?: number
  /** core 默认 true；Host GUI 忽略 caller 值，tool/CLI 显式 false */
  withLatest?: boolean
  force?: boolean
  /** default 60_000；测试注入短 deadline */
  deadlineMs?: number
}

export interface MarketDeps {
  loadRegistry: typeof defaultLoadRegistry
  listInstalledPlugins: typeof defaultListInstalledPlugins
  npmLatest: typeof defaultNpmLatest
  githubLatestTag: typeof defaultGithubLatestTag
}

export interface MarketResult {
  items: MarketItem[]
  total: number
  offset: number
  limit: number
  categoryCounts: CategoryCounts
  registryState: RegistryState
  installedComplete: boolean
  latestComplete: boolean
  latestTimedOut: boolean
}

export interface InstalledItem extends InstalledPlugin {
  registryId?: string
  latestTag?: string
  latestSha?: string
  registryGithub?: string | null
  registryIcon?: string | null
  latestVersion?: string
  outdated: boolean
  latestError?: string
}

export interface InstalledResult {
  items: InstalledItem[]
  others: number
  profileDir: string
  registryState: RegistryState
}

// ---------- 通用工具 ----------

const DEFAULT_DEADLINE_MS = 60_000
const WITH_LATEST_MAX = 50
const METADATA_ONLY_MAX = 80
const LATEST_WORKERS = 8

export function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

/** 稳定顺序的并发 map：结果顺序与输入一致，in-flight ≤ limit。 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const size = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const index = next
      if (index >= items.length) return
      next += 1
      results[index] = await worker(items[index]!, index)
    }
  })
  await Promise.all(runners)
  return results
}

function zeroCounts(): CategoryCounts {
  return { market: 0, tools: 0, ui: 0, search: 0, other: 0 }
}

function clampLimit(raw: unknown, max: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : max
  return Math.min(max, Math.max(1, n))
}

function normalizeOffset(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0
  return n > 0 ? n : 0
}

function stateOf(loaded: LoadedRegistry): RegistryState {
  return {
    configuredAddress: loaded.configuredAddress,
    activeAddress: loaded.activeAddress,
    source: loaded.source,
    status: loaded.status,
    isDefault: loaded.isDefault,
    stale: loaded.stale,
    fetchedAt: loaded.fetchedAt,
    errors: loaded.errors,
    count: loaded.count,
  }
}

function timeoutRegistryState(cfg: RegistryConfig): RegistryState {
  const configuredAddress = typeof cfg.registryUrl === 'string' ? cfg.registryUrl.trim() : ''
  return {
    configuredAddress,
    activeAddress: null,
    source: configuredAddress === '' ? 'default-cache' : 'custom-unavailable',
    status: 'unavailable',
    isDefault: configuredAddress === '',
    stale: false,
    fetchedAt: null,
    errors: ['registry 加载超出 deadline'],
    count: 0,
  }
}

function deadlineRace<T>(task: Promise<T>, ms: number): Promise<T | 'deadline'> {
  return new Promise<T | 'deadline'>((resolve, reject) => {
    const timer = setTimeout(() => resolve('deadline'), Math.max(0, ms))
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

// ---------- latest TTL cache ----------

interface LatestValue {
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

function latestCacheKey(namespace: RegistryCacheNamespace, registryKey: string, item: RegistryEntry): string {
  const id = item.source === 'npm' && item.npm ? `npm:${item.npm}` : item.github ? `gh:${item.github}` : item.id
  return `${namespace}|${registryKey}|${id}`
}

function readLatestCache(key: string, ttlMin: number): LatestValue | null {
  const entry = latestCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at >= ttlMin * 60_000) {
    latestCache.delete(key)
    return null
  }
  return entry.value
}

function writeLatestCache(key: string, value: LatestValue): void {
  if (latestCache.size >= LATEST_CACHE_MAX) {
    const oldest = latestCache.keys().next().value
    if (oldest !== undefined) latestCache.delete(oldest)
  }
  latestCache.set(key, { at: Date.now(), value })
}

// ---------- probe 基元 ----------

interface ProbeOutcome {
  ok: boolean
  timeout?: boolean
  error?: unknown
  value?: LatestValue
}

function probeTask(item: MarketItem, deps: MarketDeps, timeoutMs: number, signal?: AbortSignal): Promise<LatestValue> {
  if (item.source === 'npm' && item.npm) {
    return deps.npmLatest(item.npm, timeoutMs, signal).then((r) => ({ version: r.version }))
  }
  return deps.githubLatestTag(item.github!, timeoutMs, signal).then((r) => ({ tag: r.tag, sha: r.sha }))
}

/**
 * 单个 probe 的 deadline 收敛：即使依赖忽略 AbortSignal 也通过 race 返回。
 * 外部 signal abort → 抛 AbortError（由上层终止整次请求）。
 */
async function probeWithBudget(
  task: Promise<LatestValue>,
  budgetMs: number,
  signal?: AbortSignal,
): Promise<ProbeOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutP = new Promise<ProbeOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timeout: true }), Math.max(1, budgetMs))
  })
  const safeTask = task.then<ProbeOutcome, ProbeOutcome>(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  )
  const abortP = signal
    ? new Promise<ProbeOutcome>((_, reject) => {
        signal!.addEventListener('abort', () => reject(abortError()), { once: true })
      })
    : null
  try {
    return await Promise.race(abortP ? [safeTask, timeoutP, abortP] : [safeTask, timeoutP])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

interface ProbeTarget {
  latestVersion?: string
  latestTag?: string
  latestSha?: string
}

function applyProbe(item: ProbeTarget, value: LatestValue): void {
  if (value.version !== undefined) item.latestVersion = value.version
  if (value.tag !== undefined) item.latestTag = value.tag
  if (value.sha !== undefined) item.latestSha = value.sha
}

function matchInstalledByEntry(entry: RegistryEntry, installed: InstalledPlugin[]): InstalledPlugin | undefined {
  return installed.find((it) => {
    if (entry.npm && it.pkg === entry.npm) return true
    if (entry.npm && it.name === entry.npm) return true
    if (entry.github && it.source === 'github') {
      const m = /^github:([^#]+)/.exec(it.spec)
      if (m && m[1] === entry.github) return true
    }
    return false
  })
}

// ---------- 市场列表 ----------

function marketDeps(): MarketDeps {
  return {
    loadRegistry: defaultLoadRegistry,
    listInstalledPlugins: defaultListInstalledPlugins,
    npmLatest: defaultNpmLatest,
    githubLatestTag: defaultGithubLatestTag,
  }
}

export async function listMarket(
  cfg: RegistryConfig = {},
  opts: MarketQuery = {},
  deps: Partial<MarketDeps> = {},
): Promise<MarketResult> {
  const d: MarketDeps = { ...marketDeps(), ...deps }
  const startedAt = Date.now()
  const deadlineMs = typeof opts.deadlineMs === 'number' && Number.isFinite(opts.deadlineMs) && opts.deadlineMs > 0
    ? opts.deadlineMs
    : DEFAULT_DEADLINE_MS
  const deadlineAt = startedAt + deadlineMs
  const namespace = opts.namespace ?? 'host'
  const withLatest = opts.withLatest !== false
  const maxLimit = withLatest ? WITH_LATEST_MAX : METADATA_ONLY_MAX
  const signal = opts.signal
  const remaining = () => deadlineAt - Date.now()

  const registryTask = d.loadRegistry(cfg, { namespace, signal, force: opts.force, deadlineMs })
  const installedTask: Promise<Awaited<ReturnType<MarketDeps['listInstalledPlugins']>> | null> =
    d.listInstalledPlugins().catch(() => null)

  let loaded: LoadedRegistry | 'deadline'
  try {
    loaded = await deadlineRace(registryTask, remaining())
  } catch (err) {
    void installedTask
    throw err
  }
  if (loaded === 'deadline') {
    void installedTask
    return {
      items: [],
      total: 0,
      offset: 0,
      limit: maxLimit,
      categoryCounts: zeroCounts(),
      registryState: timeoutRegistryState(cfg),
      installedComplete: false,
      latestComplete: false,
      latestTimedOut: true,
    }
  }
  const registryState = stateOf(loaded)

  if (loaded.status === 'unavailable') {
    void installedTask
    return {
      items: [],
      total: 0,
      offset: 0,
      limit: maxLimit,
      categoryCounts: zeroCounts(),
      registryState,
      installedComplete: false,
      latestComplete: false,
      latestTimedOut: false,
    }
  }

  const installed = await installedTask
  const installedComplete = installed !== null
  const installedItems = installed?.items ?? []

  // 全量统计 + query/category 过滤 + 分页（同步，极轻）
  const all = loaded.registry.plugins
  const counts = zeroCounts()
  for (const entry of all) counts[entry.category] += 1
  const q = (opts.query ?? '').trim().toLowerCase()
  const cat = opts.category ?? null
  const filtered = all.filter((entry) => {
    if (cat && entry.category !== cat) return false
    if (!q) return true
    return `${entry.id} ${entry.name} ${entry.description} ${entry.tags.join(' ')}`.toLowerCase().includes(q)
  })
  const total = filtered.length
  const limit = clampLimit(opts.limit, maxLimit)
  let offset = normalizeOffset(opts.offset)
  if (total > 0 && offset >= total) offset = Math.floor((total - 1) / limit) * limit

  const items: MarketItem[] = filtered.slice(offset, offset + limit).map((entry) => {
    const inst = matchInstalledByEntry(entry, installedItems)
    const item: MarketItem = { ...entry, installed: Boolean(inst), outdated: false }
    if (inst) {
      item.installedPkg = inst.pkg
      item.installedVersion = inst.version
    }
    return item
  })

  let latestComplete = true
  let latestTimedOut = false
  if (withLatest && items.length > 0) {
    // 先吃 cache 命中
    const ttlMin = Math.max(0, cfg.cacheTtlMin ?? 60)
    for (const item of items) {
      const cached = readLatestCache(latestCacheKey(namespace, loaded.configuredAddress, item), ttlMin)
      if (cached) applyProbe(item, cached)
    }
    const todo = items.filter((it) => it.latestVersion === undefined && it.latestTag === undefined && it.latestSha === undefined)
    if (todo.length > 0) {
      const budget = remaining()
      if (budget <= 0) {
        for (const item of todo) item.latestErrorCode = 'LATEST_TIMEOUT'
        latestComplete = false
        latestTimedOut = true
      } else {
        await mapWithConcurrency(todo, LATEST_WORKERS, async (item) => {
          const perBudget = Math.max(1, remaining())
          const task = probeTask(item, d, Math.min(cfg.timeoutMs ?? 20_000, perBudget), signal)
          const outcome = await probeWithBudget(task, perBudget, signal)
          if (outcome.ok && outcome.value) {
            applyProbe(item, outcome.value)
            writeLatestCache(latestCacheKey(namespace, loaded.configuredAddress, item), outcome.value)
          } else if (outcome.timeout) {
            item.latestErrorCode = 'LATEST_TIMEOUT'
            latestComplete = false
            latestTimedOut = true
          } else if (outcome.error !== undefined) {
            if (signal?.aborted) throw abortError()
            item.latestError = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
            item.latestErrorCode = 'LATEST_ERROR'
          }
        })
      }
    }
    // outdated 判定统一在 probe 后进行
    for (const item of items) {
      const inst = item.installedPkg !== undefined ? installedItems.find((i) => i.pkg === item.installedPkg) : undefined
      if (!inst) continue
      if (item.latestVersion !== undefined && inst.version) {
        item.outdated = isNewerVersion(item.latestVersion, inst.version)
      } else if (item.latestSha !== undefined) {
        item.outdated = !inst.spec.includes(item.latestSha)
      }
    }
  }

  return { items, total, offset, limit, categoryCounts: counts, registryState, installedComplete, latestComplete, latestTimedOut }
}

// ---------- 已装列表 ----------

export async function listInstalledWithMeta(
  cfg: RegistryConfig = {},
  opts: RegistryRuntimeOptions & { deadlineMs?: number; force?: boolean } = {},
  deps: Partial<MarketDeps> = {},
): Promise<InstalledResult> {
  const d: MarketDeps = { ...marketDeps(), ...deps }
  const startedAt = Date.now()
  const deadlineMs = typeof opts.deadlineMs === 'number' && Number.isFinite(opts.deadlineMs) && opts.deadlineMs > 0
    ? opts.deadlineMs
    : DEFAULT_DEADLINE_MS
  const deadlineAt = startedAt + deadlineMs
  const namespace = opts.namespace ?? 'host'
  const signal = opts.signal
  const remaining = () => deadlineAt - Date.now()

  const installedPromise = d.listInstalledPlugins()
  const registryTask = d.loadRegistry(cfg, { namespace, signal, force: opts.force, deadlineMs })
  const installed = await installedPromise
  const items: InstalledItem[] = installed.items.map((it) => ({ ...it, outdated: false }))

  let loaded: LoadedRegistry | 'deadline'
  try {
    loaded = await deadlineRace(registryTask, remaining())
  } catch {
    loaded = 'deadline'
  }

  if (loaded === 'deadline' || loaded.status === 'unavailable') {
    // registry 不可用：不做 matching，直接返回已装列表
    const registryState = loaded === 'deadline' ? timeoutRegistryState(cfg) : stateOf(loaded)
    return { items, others: installed.others, profileDir: installed.profileDir, registryState }
  }

  const registryState = stateOf(loaded)

  const ttlMin = Math.max(0, cfg.cacheTtlMin ?? 60)
  await mapWithConcurrency(items, LATEST_WORKERS, async (item) => {
    const entry = loaded.registry.plugins.find((e) => matchInstalledByEntry(e, [item]))
    if (entry) {
      item.registryId = entry.id
      item.registryGithub = entry.github ?? null
      item.registryIcon = entry.icon ?? null
    }
    // latest 探测沿用 listMarket 的 TTL cache
    const cacheKey = entry
      ? latestCacheKey(namespace, loaded.configuredAddress, entry)
      : item.source === 'npm'
        ? `npm-only|${namespace}|npm:${item.pkg}`
        : null
    if (cacheKey) {
      const cached = readLatestCache(cacheKey, ttlMin)
      if (cached) {
        applyProbe(item, cached)
      } else if (remaining() > 0) {
        const budget = Math.max(1, remaining())
        try {
          let value: LatestValue | null = null
          if (!entry && item.source === 'npm') {
            const latest = await d.npmLatest(item.pkg, Math.min(cfg.timeoutMs ?? 20_000, budget), signal)
            value = { version: latest.version }
          } else if (entry?.source === 'npm' && entry.npm) {
            const latest = await d.npmLatest(entry.npm, Math.min(cfg.timeoutMs ?? 20_000, budget), signal)
            value = { version: latest.version }
          } else if (item.source === 'github') {
            const m = /^github:([^#]+)/.exec(item.spec)
            if (m) {
              const latest = await d.githubLatestTag(m[1], Math.min(cfg.timeoutMs ?? 20_000, budget), signal)
              value = { tag: latest.tag, sha: latest.sha }
            }
          }
          if (value) {
            applyProbe(item, value)
            writeLatestCache(cacheKey, value)
          }
        } catch (err) {
          item.latestError = err instanceof Error ? err.message : String(err)
        }
      }
    }
    if (item.latestVersion !== undefined && item.version) item.outdated = isNewerVersion(item.latestVersion, item.version)
    else if (item.latestSha !== undefined) item.outdated = !item.spec.includes(item.latestSha)
  })

  return { items, others: installed.others, profileDir: installed.profileDir, registryState }
}

// ---------- 安装 / 升级 ----------

/** 安装路径可注入依赖（测试用；生产走真实实现）。 */
export interface InstallDeps extends Partial<MarketDeps> {
  addDshPlugin?: typeof addDshPlugin
  removeDshPlugin?: typeof removeDshPlugin
  readProfileDeps?: typeof readProfileDeps
  npmVersion?: typeof npmVersion
  npmPackument?: typeof defaultNpmPackument
  readLockIntegrity?: typeof readPnpmLockIntegrity
  profileDir?: string
  /** 恢复快照后的 pnpm install --frozen-lockfile（可注入） */
  restoreInstall?: (profileDir: string) => Promise<unknown>
  /** B2 最终降级：frozen 持续失配时的 lockfile 重建（--no-frozen-lockfile，可注入） */
  rebuildInstall?: (profileDir: string) => Promise<unknown>
  /** B3：ERR_PNPM_NO_MATCHING_VERSION 的退避重试间隔（毫秒，按序消费）；测试注入 [0,0] */
  retryDelaysMs?: number[]
}

async function defaultRestoreInstall(profileDir: string): Promise<unknown> {
  return runCommand('pnpm', ['--dir', profileDir, 'install', '--frozen-lockfile'], { timeoutMs: installTimeoutMs() })
}

async function defaultRebuildInstall(profileDir: string): Promise<unknown> {
  return runCommand('pnpm', ['--dir', profileDir, 'install', '--no-frozen-lockfile'], { timeoutMs: installTimeoutMs() })
}

/** B3 默认退避：新发布 ~1 分钟内的升级失败多为 packument CDN 滞后（2026-09-05 实证）。 */
const NO_MATCHING_VERSION_RETRY_DELAYS_MS = [5_000, 15_000]

// ---------- B1/B2：manifest 保留与 frozen 自愈（2026-09-05 事故加固） ----------

const LOCKFILE_CONFIG_MISMATCH_RE = /ERR_PNPM_LOCKFILE_CONFIG_MISMATCH/
const OUTDATED_LOCKFILE_RE = /ERR_PNPM_OUTDATED_LOCKFILE/
const NO_MATCHING_VERSION_RE = /ERR_PNPM_NO_MATCHING_VERSION/

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readManifestDoc(profileDir: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * B1（成功路径）：安装链（pnpm / 宿主 CLI）若把升级前 manifest 的顶层键丢掉
 * （如 `pnpm.overrides` 事故前态），从安装前字节快照里找回并原子写回。
 * 只补「快照有、现在无」的键，绝不覆盖安装刚写入的 dependencies/dsh 变更。
 * 返回找回的键名列表；无需修复返回 null。
 */
async function restoreManifestKeys(
  profileDir: string,
  snapshot: ProfileFileSnapshot | undefined,
): Promise<string[] | null> {
  if (!snapshot?.existed || snapshot.bytes === null) return null
  let prev: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(snapshot.bytes.toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    prev = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const cur = await readManifestDoc(profileDir)
  if (!cur) return null
  const missing = Object.keys(prev).filter((k) => !(k in cur))
  if (missing.length === 0) return null
  for (const key of missing) cur[key] = prev[key]
  const bytes = Buffer.from(`${JSON.stringify(cur, null, 2)}\n`, 'utf8')
  await atomicWriteFile(join(profileDir, 'package.json'), bytes)
  return missing
}

/**
 * B2 第一层自愈：frozen 校验报 overrides 失配时，把 lockfile 记录的 overrides
 * 并入 manifest 的 `pnpm.overrides`（manifest 已有条目优先，绝不删用户手写的键）。
 * lockfile 的 overrides 是上一次解析实际生效的钉版，以此为准可让 frozen 直接通过
 * 而无需重建依赖树（与 2026-09-05 人工修复路径等价）。未做任何修改返回 null。
 */
async function restoreOverridesFromLock(profileDir: string): Promise<string | null> {
  let lockText: string
  try {
    lockText = await readFile(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
  } catch {
    return null
  }
  const lockOverrides = readPnpmLockOverrides(lockText)
  const doc = await readManifestDoc(profileDir)
  if (!doc) return null
  const pnpm = doc.pnpm !== null && typeof doc.pnpm === 'object' && !Array.isArray(doc.pnpm)
    ? doc.pnpm as Record<string, unknown>
    : {}
  const current = pnpm.overrides !== null && typeof pnpm.overrides === 'object' && !Array.isArray(pnpm.overrides)
    ? pnpm.overrides as Record<string, unknown>
    : {}
  const merged: Record<string, unknown> = { ...lockOverrides, ...current }
  if (JSON.stringify(merged) === JSON.stringify(current)) return null
  doc.pnpm = { ...pnpm, overrides: merged }
  const bytes = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  await atomicWriteFile(join(profileDir, 'package.json'), bytes)
  const restored = Object.keys(lockOverrides).filter((k) => !(k in current))
  return restored.length > 0 ? `（还原自 lockfile：${restored.join(', ')}）` : '（与 lockfile overrides 对齐）'
}

/**
 * B2 frozen 自愈阶梯：frozen install → CONFIG_MISMATCH 时先 overrides 对齐再重试 →
 * 仍失配（或 OUTDATED_LOCKFILE specifier 漂移，实机实证：override 钉直接依赖时回滚
 * 快照本身即 specifier 不一致）则降级 `--no-frozen-lockfile` 重建一致性。自愈动作按序
 * 记入 notes（最终呈现给用户）；阶梯走完仍失败时抛最后一个错误。
 */
async function frozenInstallWithHeal(
  profileDir: string,
  d: {
    restoreInstall: (profileDir: string) => Promise<unknown>
    rebuildInstall: (profileDir: string) => Promise<unknown>
  },
  notes: string[],
): Promise<void> {
  try {
    await d.restoreInstall(profileDir)
    return
  } catch (frozenErr) {
    const text = errText(frozenErr)
    const isConfigMismatch = LOCKFILE_CONFIG_MISMATCH_RE.test(text)
    if (!isConfigMismatch && !OUTDATED_LOCKFILE_RE.test(text)) throw frozenErr
    if (isConfigMismatch) {
      const merged = await restoreOverridesFromLock(profileDir)
      if (merged !== null) {
        notes.push(`已把 lockfile overrides 还原进 manifest ${merged}`)
        try {
          await d.restoreInstall(profileDir)
          notes.push('frozen 校验通过')
          return
        } catch {
          /* 对齐后仍失配 → 走重建降级 */
        }
      }
    }
    try {
      await d.rebuildInstall(profileDir)
    } catch (rebuildErr) {
      throw new Error(`${text}；lockfile 重建（--no-frozen-lockfile）也失败：${errText(rebuildErr)}`)
    }
    notes.push('lockfile 已重建（--no-frozen-lockfile 完成一致性安装）')
  }
}

/**
 * B3：ERR_PNPM_NO_MATCHING_VERSION 在刚发布的窗口内几乎都是 packument CDN 滞后
 * （2026-09-05 实证：/latest 已新、完整 packument 仍旧）。按 retryDelaysMs 退避重试，
 * 每次重试前拉一次完整 packument 预热/校验；其他错误与重试耗尽后原样抛出。
 */
async function addDshPluginWithRetry(
  spec: string,
  pkg: string,
  d: {
    addDshPlugin: typeof addDshPlugin
    npmPackument: typeof defaultNpmPackument
  },
  retryDelaysMs: readonly number[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ output: string; usedAllowAllBuilds: boolean }> {
  let attempt = 0
  for (;;) {
    try {
      return await d.addDshPlugin(spec)
    } catch (err) {
      if (!NO_MATCHING_VERSION_RE.test(errText(err)) || attempt >= retryDelaysMs.length) throw err
      const delay = retryDelaysMs[attempt] ?? 0
      attempt += 1
      if (delay > 0) await sleep(delay)
      await d.npmPackument(pkg, timeoutMs, signal).catch(() => undefined)
    }
  }
}

export interface InstallResult {
  id: string
  pkg: string
  spec: string
  version?: string
  sha?: string
  usedAllowAllBuilds: boolean
  needsRestart: true
  output: string
}

/** 从 registry 收录条目安装（npm → 精确锁定最新版；github → 锁 HEAD SHA）。 */
export async function installFromRegistry(
  id: string,
  cfg: RegistryConfig = {},
  opts: { version?: string } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallResult> {
  const loaded = await (deps?.loadRegistry ?? defaultLoadRegistry)(cfg, { namespace: opts.namespace ?? 'host' })
  if (loaded.status === 'unavailable') {
    throw new Error(`收录清单不可用，无法安装 ${id}；请检查 registry 配置或网络后重试`)
  }
  const entry = loaded.registry.plugins.find((e) => e.id === id)
  if (!entry) throw new Error(`registry 中没有该条目: ${id}`)
  return installEntry(entry, cfg, opts, deps)
}

export async function installEntry(
  entry: RegistryEntry,
  cfg: RegistryConfig = {},
  opts: { version?: string } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallResult> {
  const timeoutMs = cfg.timeoutMs ?? 20_000
  const d = {
    npmLatest: deps?.npmLatest ?? defaultNpmLatest,
    npmVersion: deps?.npmVersion ?? npmVersion,
    npmPackument: deps?.npmPackument ?? defaultNpmPackument,
    addDshPlugin: deps?.addDshPlugin ?? addDshPlugin,
    removeDshPlugin: deps?.removeDshPlugin ?? removeDshPlugin,
    readProfileDeps: deps?.readProfileDeps ?? readProfileDeps,
    readLockIntegrity: deps?.readLockIntegrity ?? readPnpmLockIntegrity,
    restoreInstall: deps?.restoreInstall ?? defaultRestoreInstall,
    rebuildInstall: deps?.rebuildInstall ?? defaultRebuildInstall,
  }
  const retryDelaysMs = deps?.retryDelaysMs ?? NO_MATCHING_VERSION_RETRY_DELAYS_MS
  const profileDir = deps?.profileDir ?? webProfileDir()
  if (entry.source === 'npm' && entry.npm) {
    const pkg = entry.npm
    // npm：无论 latest 还是用户指定 exact，都先读取该精确版本的 dist metadata
    let version: string
    let expectedIntegrity: string | undefined
    if (opts.version) {
      const meta = await d.npmVersion(pkg, opts.version, timeoutMs, opts.signal)
      version = meta.version
      expectedIntegrity = meta.integrity
    } else {
      const latest = await d.npmLatest(pkg, timeoutMs, opts.signal)
      version = latest.version
      expectedIntegrity = latest.integrity
    }
    if (!expectedIntegrity) throw new Error(`npm metadata 缺少 dist integrity：${pkg}@${version}，拒绝安装`)
    const spec = `${pkg}@${version}`
    // 安装前快照：失败时 best-effort 依赖回滚与 B1 键找回的依据
    const snapshots = await snapshotFiles([
      join(profileDir, 'package.json'),
      join(profileDir, 'pnpm-lock.yaml'),
      join(profileDir, 'pnpm-workspace.yaml'),
    ])
    const healNotes: string[] = []
    // 区分 add 阶段与校验阶段失败：回滚报错不再把 pnpm 安装失败误标成「integrity 校验失败」
    let phase: 'install' | 'verify' = 'install'
    try {
      const res = await addDshPluginWithRetry(spec, pkg, d, retryDelaysMs, timeoutMs, opts.signal)
      phase = 'verify'
      const depsNow = await d.readProfileDeps(profileDir)
      if (depsNow[pkg] === undefined) throw new Error(`安装后未在 profile 依赖中找到 ${pkg}`)
      if (depsNow[pkg] !== version) throw new Error(`profile 依赖版本 ${depsNow[pkg]} 与目标 ${version} 不一致`)
      let lockText: string
      try {
        lockText = await readFile(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
      } catch {
        throw new Error('安装后未找到 pnpm-lock.yaml，无法核对 integrity')
      }
      const actual = d.readLockIntegrity(lockText, pkg, version)
      assertNpmIntegrity(expectedIntegrity, actual, pkg, version)
      // B1（成功路径）：安装链若丢了 manifest 顶层键（如 pnpm.overrides），从快照找回并复验 frozen 一致性
      const restoredKeys = await restoreManifestKeys(profileDir, snapshots[0])
      if (restoredKeys) {
        healNotes.push(`安装链丢失了 manifest 顶层键（${restoredKeys.join(', ')}），已从安装前快照找回`)
        try {
          await frozenInstallWithHeal(profileDir, d, healNotes)
        } catch (healErr) {
          healNotes.push(`frozen 一致性自愈未完成，profile 可能需要人工检查：${errText(healErr)}`)
        }
      }
      return {
        id: entry.id,
        pkg,
        spec,
        version,
        usedAllowAllBuilds: res.usedAllowAllBuilds,
        needsRestart: true,
        output: res.output.slice(-800) + (healNotes.length > 0 ? `\n[dsh-m 自愈] ${healNotes.join('；')}` : ''),
      }
    } catch (err) {
      // best-effort rollback：原子恢复 manifest/lock/workspace 快照字节，再按 frozen 自愈阶梯收敛
      let rollbackError: string | null = null
      const rollbackNotes: string[] = []
      try {
        await restoreSnapshots(snapshots)
        await frozenInstallWithHeal(profileDir, d, rollbackNotes)
      } catch (rerr) {
        rollbackError = errText(rerr)
        // 原先不存在该依赖且恢复安装失败：尝试移除
        const originallyAbsent = snapshots[0] && snapshots[0].existed && (() => {
          try {
            return !JSON.parse(snapshots[0].bytes!.toString('utf8'))?.dependencies?.[pkg]
          } catch {
            return false
          }
        })()
        if (originallyAbsent) {
          try {
            await d.removeDshPlugin(pkg)
            rollbackError = null
          } catch (rmErr) {
            rollbackError = `${rollbackError}；移除 ${pkg} 也失败（${errText(rmErr)}）`
          }
        }
      }
      const prefix = phase === 'install' ? '安装失败' : 'integrity 校验失败'
      if (rollbackError) {
        throw new Error(`${prefix}（${errText(err)}）；依赖回滚也失败（${rollbackError}），profile 可能需要人工修复`)
      }
      const suffix = rollbackNotes.length > 0 ? `（${rollbackNotes.join('；')}）` : ''
      throw new Error(`${prefix}，已回滚到安装前状态${suffix}：${errText(err)}`)
    }
  }
  if (entry.github) {
    const { tag, sha } = await defaultGithubLatestTag(entry.github, timeoutMs, opts.signal)
    const spec = `github:${entry.github}#${sha}`
    const res = await d.addDshPlugin(spec)
    const depsNow = await d.readProfileDeps(profileDir)
    const pkgKey = Object.keys(depsNow).find((k) => depsNow[k] === spec || depsNow[k].startsWith(`github:${entry.github}#`))
    if (!pkgKey) throw new Error(`安装后未在 profile 依赖中找到 ${entry.github}`)
    void tag
    return {
      id: entry.id,
      pkg: pkgKey,
      spec,
      sha,
      usedAllowAllBuilds: res.usedAllowAllBuilds,
      needsRestart: true,
      output: res.output.slice(-800),
    }
  }
  throw new Error(`条目 ${entry.id} 缺少可安装来源`)
}

export interface UninstallResult {
  pkg: string
  liveDisabled: boolean
  needsRestart: true
  leftovers: string[]
}

export interface UninstallDeps {
  removePatchedEntries?: typeof removePatchedDependencyEntries
  removeInstalled?: typeof removeInstalledPlugin
}

/** 卸载：live-disable → 摘除该包补丁条目 → pnpm remove → 报告疑似残留（DESIGN.md §3：删包不删数据）。 */
export async function uninstallPlugin(
  pkg: string,
  _cfg: RegistryConfig = {},
  _opts: RegistryRuntimeOptions = {},
  deps: UninstallDeps = {},
): Promise<UninstallResult> {
  const liveDisabled = await setLivePluginDisabled(pkg, true)
  // 依赖移除后残留的 patchedDependencies 条目会让 pnpm 以 ERR_PNPM_UNUSED_PATCH 整单失败，先摘掉
  const patchCleanup = (deps.removePatchedEntries ?? removePatchedDependencyEntries)(webProfileDir(), pkg)
  await (deps.removeInstalled ?? removeInstalledPlugin)(pkg)
  const leftovers = [...new Set([...leftoverCandidates(pkg), ...patchCleanup.orphanedPatchFiles])]
  return { pkg, liveDisabled, needsRestart: true, leftovers }
}

export interface UpgradeResult extends InstallResult {
  fromVersion?: string
}

/** 升级 = 按最新重新安装（npm 拉最新精确版；github 重新锁 HEAD）。 */
export async function upgradePlugin(
  pkg: string,
  cfg: RegistryConfig = {},
  opts: RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<UpgradeResult> {
  const loaded = await (deps?.loadRegistry ?? defaultLoadRegistry)(cfg, { namespace: opts.namespace ?? 'host' })
  if (loaded.status === 'unavailable') {
    throw new Error(`收录清单不可用，无法升级 ${pkg}；请检查 registry 配置或网络后重试`)
  }
  const { items: installed } = await (deps?.listInstalledPlugins ?? defaultListInstalledPlugins)()
  const target = installed.find((it) => it.pkg === pkg)
  if (!target) throw new Error(`web profile 未安装该插件: ${pkg}`)
  const entry = loaded.registry.plugins.find((e) => matchInstalledByEntry(e, [target]))
  if (!entry) throw new Error(`「${pkg}」不是经 dsh-m 收录的插件；直接升级请用 dsh plugin update 或先在 registry 收录它`)
  const result = await installEntry(entry, cfg, opts, deps)
  return { ...result, fromVersion: target.version }
}

// ---------- 变更互斥 ----------

/** 变更互斥：安装/卸载/升级串行执行（skillhub install-lock 同款思路）。 */
let mutationTail: Promise<unknown> = Promise.resolve()

export function withMutationLock<T>(task: () => Promise<T>): Promise<T> {
  const next = mutationTail.then(task, task)
  mutationTail = next.catch(() => undefined)
  return next
}

/** 疑似残留路径（存在才列出）：删包不删数据，只报告。 */
export function leftoverCandidates(pkg: string): string[] {
  const home = dshHome()
  const candidates = [
    join(home, `${pkg}.json`),
    join(home, pkg),
    join(home, `${pkg.replace(/^@[^/]+\//, '')}.json`),
  ]
  return candidates.filter((p) => existsSync(p))
}
