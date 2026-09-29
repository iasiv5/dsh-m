/**
 * 社区清单（DESIGN.md §2.5 / ADR-0003）：awesome-dsh-plugin 全量目录的只读叠加层。
 * 容器层（常量/类型/校验/标签）+ 获取链（Task 3：版本探测 → 三线路正文 → 版本缓存）。
 * 校验语义（Q43）：容器层严格；条目层宽松（适配层跳过计数，见 community-adapter.ts）。
 * deadline 语义（v8-v10 定稿）：共享 flight 只受自身 30s hard cap 约束；
 * 调用者 deadline/signal 不进入共享 loader——waiter 在调用层各自 race（本模块只接受
 * 每调用者的 signal 用于取消「自己的等待」，最后一个 waiter 离开才 abort 共享加载）。
 */
import { mkdir, readFile, rm, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { cacheDir } from './env.js'
import { decodeUtf8Fatal, fetchBytesLimited, describeFetchFailure } from './httpx.js'
import { isExactVersion, npmLatest } from './versions.js'
import { communityOutcome, type CommunityRegistrySummary } from './market.js'
import type { RegistryEntry } from './registry.js'

export const COMMUNITY_NPM_PACKAGE = 'dsh-plugin-catalog'
export const MAX_COMMUNITY_BYTES = 32 * 1024 * 1024
export const MAX_COMMUNITY_ENTRIES = 30_000
export const CATALOG_BODY_TIMEOUT_MS = 15_000
export const COMMUNITY_CHAIN_BUDGET_MS = 30_000

/** 原生条目（防御性：字段全可选，消费方必须自行判空；npm:null=未发 npm，capabilities 缺省=未扫描）。 */
export interface CommunityRawEntry {
  name?: string
  owner?: string
  url?: string
  page?: string
  category?: string
  description?: { en?: string; zh?: string }
  npm?: string | null
  tarball?: string
  version?: string | null
  stars?: number | null
  downloads?: number | null
  downloadsStart?: string | null
  downloadsEnd?: string | null
  downloadsCheckedAt?: string | null
  capabilities?: string[]
  capabilityRedLines?: string[]
  capabilityCheckedAt?: string
  install?: string
  added?: string
  screenshots?: string[]
  /** 前瞻性声明（0.7.0 Task 1）：上游目录当前无此键，形状对齐 dsh-market registry 类型；上游落地后跑 smoke 核对（尤其 replacement 是 string 还是对象）。 */
  deprecated?: boolean
  replacement?: string | null
}

export interface CommunityCatalogCategory {
  en?: string
  zh?: string
}

export interface CommunityCatalog {
  name: string
  url: string
  source: string
  updated: string
  count: number
  categories: Record<string, CommunityCatalogCategory>
  plugins: CommunityRawEntry[]
}

/**
 * 上游 23 个分类 id 的全量中文标签（以 fixture `categories` 键为准逐条核对）。
 * 其中 ui/tools/market 与精选分类同名共享过滤桶、不进筛选栏社区组，标签供详情页等处使用。
 */
export const COMMUNITY_KNOWN_CATEGORIES: Record<string, string> = {
  agi: 'AGI 架构探索',
  ui: 'UI 增强',
  usage: '用量与计费',
  theme: '主题与外观',
  model: '模型与账号接入',
  identity: '身份与通信',
  session: '会话与消息',
  memory: '记忆',
  tools: '工具与能力',
  wsl: 'WSL 与 Windows 互操作',
  browser: '浏览器与网页',
  vision: '视觉与多模态',
  voice: '语音与音频',
  docs: '文档与渲染',
  skill: '技能包',
  workflow: '工作流与自动化',
  git: 'Git 与代码评审',
  notify: '通知与集成',
  dev: '开发与运行时',
  security: '安全与权限',
  remote: '远程与移动端',
  market: '插件市场与管理',
  fun: '娱乐',
}

const TOP_LEVEL_KEYS = new Set(['name', 'url', 'source', 'updated', 'count', 'categories', 'plugins'])

export interface CommunityContainerResult {
  ok: boolean
  errors: string[]
  catalog: CommunityCatalog | null
}

/**
 * 容器层严格校验（条目层由适配层负责）：
 * - 根必须是对象，未知顶层键报错；
 * - `plugins` 缺失/非数组/超过 MAX_COMMUNITY_ENTRIES → 整份拒收（不截断、不部分加载）。
 */
export function validateCommunityContainer(raw: unknown): CommunityContainerResult {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['社区目录根必须是对象'], catalog: null }
  }
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`${key}: 未知顶层字段`)
  }
  const plugins = obj.plugins
  if (!Array.isArray(plugins)) {
    errors.push('plugins: 必须是数组')
    return { ok: false, errors, catalog: null }
  }
  if (plugins.length > MAX_COMMUNITY_ENTRIES) {
    errors.push(`plugins: ${plugins.length} 条超过上限 ${MAX_COMMUNITY_ENTRIES}，拒绝整份目录`)
    return { ok: false, errors, catalog: null }
  }
  for (let i = 0; i < plugins.length; i++) {
    const item = plugins[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`plugins[${i}]: 必须是对象`)
    }
  }
  if (errors.length > 0) return { ok: false, errors, catalog: null }
  const categories =
    obj.categories && typeof obj.categories === 'object' && !Array.isArray(obj.categories)
      ? (obj.categories as Record<string, CommunityCatalogCategory>)
      : {}
  return {
    ok: true,
    errors: [],
    catalog: {
      name: typeof obj.name === 'string' ? obj.name : '',
      url: typeof obj.url === 'string' ? obj.url : '',
      source: typeof obj.source === 'string' ? obj.source : '',
      updated: typeof obj.updated === 'string' ? obj.updated : '',
      count: typeof obj.count === 'number' ? obj.count : plugins.length,
      categories,
      plugins: plugins as CommunityRawEntry[],
    },
  }
}

// ---------- 获取链（M1 Task 3） ----------

export interface CommunityConfig {
  timeoutMs?: number
  cacheTtlMin?: number
  communityCatalog?: boolean
  communityCatalogPin?: string
}

export type CommunityStatus = 'ready' | 'stale' | 'unavailable' | 'disabled'

export interface CommunityCatalogState {
  enabled: boolean
  status: CommunityStatus
  version: string | null
  checkedAt: string | null
  fetchedAt: string | null
  route: string | null
  count: number
  errors: string[]
  warnings: string[]
}

export interface LoadedCommunity {
  state: CommunityCatalogState
  catalog: CommunityCatalog | null
}

export interface CommunityFetchOptions {
  namespace?: 'host' | 'cli'
  force?: boolean
  /** 只取消本调用者的等待（waiter-scoped）；不影响共享 flight。 */
  signal?: AbortSignal
  /** 测试注入：本地服务器（registryBase 直达 `<base>/dsh-plugin-catalog/latest`）。 */
  routes?: { registryBase?: string; fileBases?: string[] }
  /** 测试注入：flight 硬上限（默认 COMMUNITY_CHAIN_BUDGET_MS）。生产不传。 */
  flightBudgetMs?: number
}

const DEFAULT_FILE_BASES = [
  'https://cdn.jsdelivr.net/npm/dsh-plugin-catalog@{version}/plugins.json',
  'https://registry.npmmirror.com/dsh-plugin-catalog/{version}/files/plugins.json',
  'https://unpkg.com/dsh-plugin-catalog@{version}/plugins.json',
]
const ROUTE_LABELS = ['jsdelivr', 'npmmirror', 'unpkg']
const META_LATEST = 'meta.json'

const metaPinName = (v: string) => `meta-pin-${v}.json`
const bodyName = (v: string) => `catalog-${v}.json`

function awesomeDir(namespace: 'host' | 'cli'): string {
  return join(cacheDir(), namespace, 'awesome')
}

/** 路径 containment：目标必须仍在 dir 内（防御拼接穿越）。 */
function contained(dir: string, p: string): boolean {
  const rel = relative(dir, p)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

async function atomicWrite(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, text)
  await rename(tmp, path)
}

interface CommunityMeta {
  version: string
  checkedAt: string
  fetchedAt: string
  route: string | null
}

/** 读取顺序（v8 定稿）：meta 结构校验 → isExactVersion(meta.version) → body containment → 才读正文；损坏文件清理。 */
async function readCache(
  dir: string,
  pin: string | null,
): Promise<{ meta: CommunityMeta; catalog: CommunityCatalog } | null> {
  const metaPath = join(dir, pin ? metaPinName(pin) : META_LATEST)
  let meta: CommunityMeta | null = null
  try {
    const raw = JSON.parse(await readFile(metaPath, 'utf8')) as unknown
    if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as CommunityMeta).version === 'string' &&
      typeof (raw as CommunityMeta).checkedAt === 'string' &&
      typeof (raw as CommunityMeta).fetchedAt === 'string' &&
      ((raw as CommunityMeta).route === null || typeof (raw as CommunityMeta).route === 'string')
    ) {
      meta = raw as CommunityMeta
    }
  } catch {
    meta = null
  }
  if (!meta) {
    await rm(metaPath, { force: true }).catch(() => undefined)
    return null
  }
  if (!isExactVersion(meta.version)) {
    await rm(metaPath, { force: true }).catch(() => undefined)
    return null
  }
  const bodyPath = join(dir, bodyName(meta.version))
  if (!contained(dir, bodyPath)) return null
  let data: unknown
  try {
    data = JSON.parse(await readFile(bodyPath, 'utf8'))
  } catch {
    await rm(bodyPath, { force: true }).catch(() => undefined)
    return null
  }
  const v = validateCommunityContainer(data)
  if (!v.ok || !v.catalog) {
    await rm(bodyPath, { force: true }).catch(() => undefined)
    return null
  }
  return { meta, catalog: v.catalog }
}

async function writeMeta(dir: string, pin: string | null, meta: CommunityMeta): Promise<void> {
  await mkdir(dir, { recursive: true })
  await atomicWrite(join(dir, pin ? metaPinName(pin) : META_LATEST), JSON.stringify(meta, null, 2))
}

function withinTtl(cfg: CommunityConfig, meta: CommunityMeta): boolean {
  const t = Date.parse(meta.checkedAt || '')
  if (!Number.isFinite(t)) return false // checkedAt 非法 → 视为过期（⑪）
  return Date.now() - t < Math.max(0, cfg.cacheTtlMin ?? 60) * 60_000
}

function routeError(label: string, err: unknown, ms: number): string {
  return describeFetchFailure({ label, err, elapsedMs: ms })
}

function stateOf(partial: Partial<CommunityCatalogState> & { status: CommunityStatus }): CommunityCatalogState {
  return {
    enabled: true,
    version: null,
    checkedAt: null,
    fetchedAt: null,
    route: null,
    count: 0,
    errors: [],
    warnings: [],
    ...partial,
  }
}

function disabledState(): CommunityCatalogState {
  return stateOf({ enabled: false, status: 'disabled' })
}

function trimPin(cfg: CommunityConfig): string | null {
  const raw = typeof cfg.communityCatalogPin === 'string' ? cfg.communityCatalogPin.trim() : ''
  return raw === '' ? null : raw
}

async function runChain(
  cfg: CommunityConfig,
  opts: CommunityFetchOptions,
  ctrl: AbortController,
): Promise<LoadedCommunity> {
  const namespace = opts.namespace ?? 'host'
  const dir = awesomeDir(namespace)
  const pin = trimPin(cfg)
  const budgetMs = opts.flightBudgetMs ?? COMMUNITY_CHAIN_BUDGET_MS
  const startedAt = Date.now()
  const remaining = () => budgetMs - (Date.now() - startedAt)

  // 缓存快速路径：pin 命中即用（版本不可变）；latest 需 TTL 内（checkedAt 新鲜）
  if (!opts.force) {
    const cached = await readCache(dir, pin)
    if (cached && (pin !== null || withinTtl(cfg, cached.meta))) {
      return {
        state: stateOf({
          status: 'ready',
          version: cached.meta.version,
          checkedAt: cached.meta.checkedAt,
          fetchedAt: cached.meta.fetchedAt,
          route: cached.meta.route,
          count: cached.catalog.plugins.length,
        }),
        catalog: cached.catalog,
      }
    }
  }

  const errors: string[] = []
  let version: string | null = pin
  let probeFailed = false
  if (pin === null) {
    const probeTimeout = Math.max(1, Math.min(8_000, remaining()))
    const t0 = Date.now()
    try {
      const latest = await npmLatest(COMMUNITY_NPM_PACKAGE, probeTimeout, ctrl.signal, opts.routes?.registryBase)
      if (!isExactVersion(latest.version)) throw new Error(`dist-tags 返回非精确版本: ${latest.version}`)
      version = latest.version
    } catch (err) {
      probeFailed = true
      errors.push(routeError('版本探测', err, Date.now() - t0))
    }
  }

  if (probeFailed || version === null) {
    const cached = await readCache(dir, pin)
    if (cached) {
      return {
        state: stateOf({
          status: 'stale',
          version: cached.meta.version,
          checkedAt: cached.meta.checkedAt,
          fetchedAt: cached.meta.fetchedAt,
          route: cached.meta.route,
          count: cached.catalog.plugins.length,
          errors,
        }),
        catalog: cached.catalog,
      }
    }
    return { state: stateOf({ status: 'unavailable', errors }), catalog: null }
  }

  // 同版本短路（⑫）：探测成功但版本未变 → 只更新 checkedAt，不重拉正文
  if (!opts.force) {
    const cachedSame = await readCache(dir, pin)
    if (cachedSame && cachedSame.meta.version === version) {
      const checkedAt = new Date().toISOString()
      await writeMeta(dir, pin, { ...cachedSame.meta, checkedAt })
      return {
        state: stateOf({
          status: 'ready',
          version,
          checkedAt,
          fetchedAt: cachedSame.meta.fetchedAt,
          route: cachedSame.meta.route,
          count: cachedSame.catalog.plugins.length,
        }),
        catalog: cachedSame.catalog,
      }
    }
  }

  const bases = opts.routes?.fileBases ?? DEFAULT_FILE_BASES
  for (let i = 0; i < bases.length; i++) {
    if (remaining() <= 0) {
      errors.push('社区目录加载预算耗尽，稍后重试可恢复')
      break
    }
    const label = ROUTE_LABELS[i] ?? `route${i}`
    const url = bases[i].replace('{version}', encodeURIComponent(version))
    const t0 = Date.now()
    try {
      const { bytes } = await fetchBytesLimited(url, {
        timeoutMs: Math.max(1, Math.min(CATALOG_BODY_TIMEOUT_MS, remaining())),
        maxBytes: MAX_COMMUNITY_BYTES,
        signal: ctrl.signal,
      })
      const text = decodeUtf8Fatal(bytes)
      const data: unknown = JSON.parse(text)
      const v = validateCommunityContainer(data)
      if (!v.ok || !v.catalog) throw new Error(`目录校验失败 — ${v.errors.slice(0, 3).join('; ')}`)
      const now = new Date().toISOString()
      await mkdir(dir, { recursive: true })
      await atomicWrite(join(dir, bodyName(version)), text)
      await writeMeta(dir, pin, { version, checkedAt: now, fetchedAt: now, route: label })
      return {
        state: stateOf({
          status: 'ready',
          version,
          checkedAt: now,
          fetchedAt: now,
          route: label,
          count: v.catalog.plugins.length,
        }),
        catalog: v.catalog,
      }
    } catch (err) {
      if (ctrl.signal.aborted && remaining() <= 0) {
        errors.push('社区目录加载预算耗尽，稍后重试可恢复')
        break
      }
      errors.push(routeError(label, err, Date.now() - t0))
    }
  }

  const cached = await readCache(dir, pin)
  if (cached) {
    return {
      state: stateOf({
        status: 'stale',
        version: cached.meta.version,
        checkedAt: cached.meta.checkedAt,
        fetchedAt: cached.meta.fetchedAt,
        route: cached.meta.route,
        count: cached.catalog.plugins.length,
        errors,
      }),
      catalog: cached.catalog,
    }
  }
  return { state: stateOf({ status: 'unavailable', errors }), catalog: null }
}

// ---------- in-flight 合并（waiter-scoped signal，flight 自身 hard cap） ----------

interface Flight {
  promise: Promise<LoadedCommunity>
  refs: number
  ctrl: AbortController
  timer: ReturnType<typeof setTimeout>
}

const flights = new Map<string, Flight>()

function flightKey(opts: CommunityFetchOptions, pin: string | null): string {
  const ns = opts.namespace ?? 'host'
  const routesSig = opts.routes
    ? `${opts.routes.registryBase ?? ''}|${(opts.routes.fileBases ?? []).join(',')}`
    : 'default'
  return [ns, pin ?? '', opts.force ? 'force' : 'normal', routesSig].join('§')
}

function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

async function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) throw abortError()
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

function releaseFlight(key: string, flight: Flight): void {
  flight.refs -= 1
  if (flight.refs <= 0) {
    clearTimeout(flight.timer)
    flight.ctrl.abort()
    if (flights.get(key) === flight) flights.delete(key)
  }
}

/**
 * 社区清单加载入口（Q39/Q43）：
 * - disabled → 直接返回（不触网络）；
 * - pin 非法 → unavailable（零网络零写入）；
 * - in-flight 合并：key = namespace + 生效 pin + force + routes；各 waiter 的 signal 只取消各自等待。
 */
export async function fetchCommunityCatalog(
  cfg: CommunityConfig = {},
  opts: CommunityFetchOptions = {},
): Promise<LoadedCommunity> {
  if (cfg.communityCatalog === false) return { state: disabledState(), catalog: null }
  const pin = trimPin(cfg)
  if (pin !== null && !isExactVersion(pin)) {
    return {
      state: stateOf({
        status: 'unavailable',
        errors: [`communityCatalogPin 非法（需精确 semver）: ${pin}；请检查设置`],
      }),
      catalog: null,
    }
  }
  const key = flightKey(opts, pin)
  let flight = flights.get(key)
  if (!flight) {
    const ctrl = new AbortController()
    const budgetMs = opts.flightBudgetMs ?? COMMUNITY_CHAIN_BUDGET_MS
    const timer = setTimeout(() => ctrl.abort(), budgetMs)
    const runPromise = runChain(cfg, opts, ctrl)
    const created: Flight = { refs: 0, ctrl, timer, promise: runPromise }
    runPromise
      .finally(() => {
        clearTimeout(timer)
        if (flights.get(key) === created && created.refs <= 0) flights.delete(key)
      })
      .catch(() => undefined)
    flights.set(key, created)
    flight = created
  }
  flight.refs += 1
  try {
    return await raceWithSignal(flight.promise, opts.signal)
  } finally {
    releaseFlight(key, flight)
  }
}

// ---------- registry 响应社区 summary（M1 Task 6） ----------

export interface CommunitySummaryOptions {
  force?: boolean
  /** 请求 signal（waiter 隔离：只取消本次等待，见 Task 3 in-flight 合并） */
  signal?: AbortSignal
  /** 本 waiter 的等待上限（绝对时刻，host-api 传 now + 3s）；到点返回 unavailable summary */
  deadlineAt: number
}

/**
 * 单一深接口（计划 Task 6）：fetch → adapt → merge 计数 → CommunityRegistrySummary。
 * - primaryEntries 直接取本次 registry snapshot 的 primary plugins（displaced 与本次响应同代，
 *   不重复加载主清单；内部禁止调用 loadRegistry——单一来源约束）；
 * - 3s 是本 waiter 的等待上限（waiter-scoped race）：到点未 materialize → unavailable +
 *   「社区目录状态获取超时」errors，调用方主响应照常；共享 flight 按 30s hard cap 继续；
 * - 数据源 cache-first：fetchCommunityCatalog 的版本缓存 + TTL 保证 registry 刷新无重复网络压力。
 */
export async function getCommunitySummary(
  primaryEntries: RegistryEntry[],
  cfg: CommunityConfig = {},
  opts: CommunitySummaryOptions,
): Promise<CommunityRegistrySummary> {
  const task = fetchCommunityCatalog(cfg, { signal: opts.signal, force: opts.force })
  const outcome = await communityOutcome(task, opts.deadlineAt, primaryEntries)
  return outcome.summary
}
