/**
 * packument 访问器（ADR-0019）：npm 全量 packument 取数的唯一属主模块（GLOSSARY 在案）。
 * 一次取回按需派生视图（times/versions/distTags/readme/repo），按（pkg, 生效 registry）
 * 记忆化共享给登记、预检与 B3 预热；latest 小端点探测与其缓存制度（ADR-0006）不在辖区。
 *
 * 取数双面：fetchDocThrowing（strict——两腿阶梯，npmjs 首腿 `min(timeoutMs,5s)` 收紧 →
 * 生效源备腿，终末失败抛原始错误，供 readme 阶梯错误透传）；fetchPackumentDoc（lenient——
 * 同阶梯 catch → null，times 的 fail-open 口径）。发布时戳是不可变历史事实，TTL 5min 只防
 * 内存滞留过期内容，不作废旧时戳判定；失败与 regex-invalid 的确定性 null 同按 TTL 负缓存
 * （故障窗口内预检/登记不二次打网）。
 *
 * 腿策略（ADR-0012 消费端）：times 走两腿（完整性敏感读，npmjs 权威优先）；warm 与 readme
 * 兜底腿走「生效源单腿」（warm 暖的正是 B3 重试要打的 CDN，两腿会让镜像机先付 npmjs 5s
 * 且暖错对象——评审 G1-3/G2-2 裁决）。onRouteSwitch 作废 + 缓存键含生效源双保险；本模块是
 * 唯一注册点（release-age 旧注册已随其本地缓存退役）。
 */
import { fetchJsonLimited } from './httpx.js'
import { DEFAULT_NPM_REGISTRY, NPM_MIRROR, activeNpmRegistry, onRouteSwitch, syncNpmmirrorPackage } from './npm-route.js'

/** npm 包名形状（与既有四函数同一字符集，scoped 允许）。 */
const PKG_RE = /^@?[A-Za-z0-9-._~]+(\/[A-Za-z0-9-._~]+)?$/

/** registry base 归一（去尾斜杠；空/缺省 → 官方 npmjs）。 */
function registryBase(registry?: string): string {
  const base = typeof registry === 'string' && registry.trim() !== '' ? registry.trim() : DEFAULT_NPM_REGISTRY
  return base.replace(/\/+$/, '')
}

/** 精确 semver：接受 prerelease/build metadata，拒绝 v 前缀、range、tag 与脏尾缀。 */
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function isExactVersion(version: string): boolean {
  return EXACT_VERSION_RE.test(version)
}

export interface PackumentViews {
  times: Record<string, string>
  versions: string[]
  distTags: Record<string, unknown>
  readme: string
  repo: string
}

export interface PackumentAccessorDeps {
  /** 注入 wire（测试用）；默认 httpx fetchJsonLimited。 */
  fetchJsonLimited?: typeof fetchJsonLimited
}

// ---------- 取数层（strict / lenient 双面） ----------

/**
 * strict 面：两腿阶梯取全量 packument，终末失败抛原始错误。
 * L3 权威链（ADR-0012）：npmjs 首腿超时收紧 `Math.min(timeoutMs, 5_000)`；生效源即 npmjs
 * 时失败直接抛（权威源无备腿可降）；两腿皆败抛终末腿错误（readme 阶梯的错误透传依赖此约定）。
 */
export async function fetchDocThrowing(
  pkg: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  deps?: PackumentAccessorDeps,
): Promise<Record<string, unknown>> {
  if (!PKG_RE.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
  const fetcher = deps?.fetchJsonLimited ?? fetchJsonLimited
  const firstLegMs = Math.min(timeoutMs, 5_000)
  try {
    return (await fetcher(`${registryBase(DEFAULT_NPM_REGISTRY)}/${encodeURIComponent(pkg)}`, {
      timeoutMs: firstLegMs,
      signal,
      maxBytes: 8 * 1024 * 1024,
    })) as Record<string, unknown>
  } catch (firstErr) {
    const alt = await activeNpmRegistry()
    if (alt === DEFAULT_NPM_REGISTRY) throw firstErr
    return (await fetcher(`${registryBase(alt)}/${encodeURIComponent(pkg)}`, {
      timeoutMs,
      signal,
      maxBytes: 8 * 1024 * 1024,
    })) as Record<string, unknown>
  }
}

/** lenient 面：同阶梯 catch → null（times 的 fail-open 口径；regex-invalid 亦 null）。 */
export async function fetchPackumentDoc(
  pkg: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  deps?: PackumentAccessorDeps,
): Promise<Record<string, unknown> | null> {
  try {
    return await fetchDocThrowing(pkg, timeoutMs, signal, deps)
  } catch {
    return null
  }
}

/** 生效源单腿 strict 取数（warm 与 readme 兜底腿的取数原语；失败抛原始错误）。返回 doc 与取数所用 base——调用方回填键必须用同一 base（评审 R1-1：一次生效源判定贯穿取数与回填，杜绝路由切换窗口的键错配）。 */
async function fetchDocViaActiveThrowing(
  pkg: string,
  timeoutMs: number,
  signal?: AbortSignal,
  deps?: PackumentAccessorDeps,
): Promise<{ doc: Record<string, unknown>; base: string }> {
  if (!PKG_RE.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
  const fetcher = deps?.fetchJsonLimited ?? fetchJsonLimited
  const base = await activeNpmRegistry()
  const doc = (await fetcher(`${registryBase(base)}/${encodeURIComponent(pkg)}`, {
    timeoutMs,
    signal,
    maxBytes: 8 * 1024 * 1024,
  })) as Record<string, unknown>
  return { doc, base }
}

// ---------- 视图层 ----------

/** packument repository → "owner/repo"（仅 github.com；git+https / git@ / .git / #frag 归一；非 GitHub 返回空串）。 */
export function extractGithubRepo(v: unknown): string {
  const url =
    v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { url?: unknown }).url === 'string'
      ? (v as { url: string }).url
      : typeof v === 'string'
        ? v
        : ''
  if (!url) return ''
  const m = /github\.com[/:]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#]|$)/i.exec(url)
  return m ? `${m[1]}/${m[2]}` : ''
}

/** 全量 packument → 派生视图包（纯函数；畸形字段一律回落默认值，不抛）。 */
export function packumentViews(doc: unknown): PackumentViews {
  const d = doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {}
  const times: Record<string, string> = {}
  const t = d.time
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
      if (typeof v === 'string' && v !== '') times[k] = v
    }
  }
  const versions =
    d.versions && typeof d.versions === 'object' && !Array.isArray(d.versions) ? Object.keys(d.versions as object) : []
  const distTags =
    d['dist-tags'] && typeof d['dist-tags'] === 'object' && !Array.isArray(d['dist-tags'])
      ? (d['dist-tags'] as Record<string, unknown>)
      : {}
  const readme = typeof d.readme === 'string' && d.readme.trim() !== '' ? d.readme : ''
  return { times, versions, distTags, readme, repo: extractGithubRepo(d.repository) }
}

// ---------- 缓存层 ----------

interface PackumentEntry {
  at: number
  /** 派生视图；null = 负缓存（取数失败 / regex-invalid 的确定性 null，仅 lenient 面消费）。 */
  views: PackumentViews | null
}

const packumentCache = new Map<string, PackumentEntry>()
const packumentInflight = new Map<string, Promise<PackumentViews | null>>()
const PACKUMENT_TTL_MS = 5 * 60_000
const PACKUMENT_CAP = 4

function packumentKey(pkg: string, registry: string): string {
  return `${pkg}\n${registry}`
}

function backfill(key: string, views: PackumentViews | null): void {
  if (packumentCache.has(key)) packumentCache.delete(key) // 重写移尾：淘汰语义 = 最旧写入
  packumentCache.set(key, { at: Date.now(), views })
  if (packumentCache.size > PACKUMENT_CAP) {
    const oldest = packumentCache.keys().next().value
    if (oldest !== undefined) packumentCache.delete(oldest)
  }
}

/** 路由作废（ADR-0012 L1：生效源切换 → 缓存整体作废）；亦是测试隔离钩子。 */
export function clearPackumentAccessorCache(): void {
  packumentCache.clear()
  packumentInflight.clear()
}
onRouteSwitch(() => clearPackumentAccessorCache())

/** lenient 带缓存取数（times/全视图共用；single-flight；失败/非法 → null 负缓存）。 */
async function entryLenient(
  pkg: string,
  timeoutMs: number,
  signal?: AbortSignal,
  deps?: PackumentAccessorDeps,
): Promise<PackumentViews | null> {
  const key = packumentKey(pkg, await activeNpmRegistry())
  const hit = packumentCache.get(key)
  if (hit && Date.now() - hit.at < PACKUMENT_TTL_MS) return hit.views
  const existing = packumentInflight.get(key)
  if (existing) return existing
  const p = (async () => {
    let views: PackumentViews | null = null
    try {
      views = packumentViews(await fetchDocThrowing(pkg, timeoutMs, signal, deps))
    } catch {
      views = null
    }
    backfill(key, views)
    return views
  })().finally(() => {
    packumentInflight.delete(key)
  })
  packumentInflight.set(key, p)
  return p
}

/** 带缓存发布时戳表（预检/登记消费；语义 = 旧 cachedPackumentTimes：失败 null 不抛）。 */
export async function packumentTimes(
  pkg: string,
  timeoutMs = 12_000,
  signal?: AbortSignal,
  deps?: PackumentAccessorDeps,
): Promise<Record<string, string> | null> {
  const views = await entryLenient(pkg, timeoutMs, signal, deps)
  return views ? views.times : null
}

/** 带缓存全视图（npmPackument 隐式 registry 路径消费）。 */
export async function packumentDocViews(
  pkg: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  deps?: PackumentAccessorDeps,
): Promise<PackumentViews | null> {
  return entryLenient(pkg, timeoutMs, signal, deps)
}

/**
 * 生效源单腿带缓存全视图（readme 隐式 registry 兜底腿专用，G2-2 方案 a）：命中（且非
 * 负缓存）直回；miss/负缓存 → 单腿 strict 重取（失败抛原始错误）+ 回填。负缓存条目仅
 * lenient 面消费——strict 面视 null 为 miss，保终末错误透传（≈现状无缓存每次尝试）。
 */
export async function packumentDocViewsActive(
  pkg: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  deps?: PackumentAccessorDeps,
): Promise<PackumentViews> {
  const key = packumentKey(pkg, await activeNpmRegistry())
  const hit = packumentCache.get(key)
  if (hit && Date.now() - hit.at < PACKUMENT_TTL_MS && hit.views !== null) return hit.views
  const { doc, base } = await fetchDocViaActiveThrowing(pkg, timeoutMs, signal, deps)
  const views = packumentViews(doc)
  backfill(packumentKey(pkg, base), views)
  return views
}

/**
 * B3 预热（G1-3 裁决）：bypass 缓存读 + 生效源单腿直取 + 成功回填——预热的目的就是真发
 * 请求暖 CDN（B3 重试要打的正是生效源），缓存命中≠预热；失败/abort 异常向上传播（调用方
 * makeNpmWarmPackument 按 R4c 消化：abort rethrow、其余吞错）。
 */
export async function warmPackumentFor(
  pkg: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  deps?: PackumentAccessorDeps,
): Promise<void> {
  const { doc, base } = await fetchDocViaActiveThrowing(pkg, timeoutMs, signal, deps)
  backfill(packumentKey(pkg, base), packumentViews(doc))
}

// ---------- 迁入的 registry 元数据函数（versions.ts 原名 re-export，import 位零改动） ----------

export interface NpmLatest {
  version: string
  integrity?: string
  tarball?: string
}

/** 精确版本 metadata（Task 8 integrity 校验使用，与 NpmLatest 同形）。 */
export type NpmVersionMetadata = NpmLatest

/** 精确版本完整详情（0.4.0 兼容预检）：同 NpmLatest + 该版本 peerDependencies 原样。 */
export interface NpmVersionDetail extends NpmLatest {
  peers: Record<string, string>
}

export interface NpmVersionDeps {
  fetchJsonLimited?: typeof fetchJsonLimited
  syncNpmmirror?: typeof syncNpmmirrorPackage
  /** 有界等待（sync 受理 → 镜像可见的窗口，默认 10s、abort-aware）。 */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const t = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/**
 * 精确版本元数据（兼容预检/integrity 锚定）。L2① 履约阶梯（ADR-0012）：
 * 显式 registry 参数 > 生效源 → 失败且生效源为镜像 → sync → 有界等待 10s → 同源重试一次
 * → 仍败 → npmjs 兜底（sync+重试为尽力而为，npmjs 兜底是主安全网）；
 * 主源即 npmjs 时失败直接抛（权威源无镜像滞后可言）。
 */
export async function npmVersion(
  pkg: string,
  version: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  registry?: string,
  deps?: NpmVersionDeps,
): Promise<NpmVersionDetail> {
  if (!PKG_RE.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
  if (!isExactVersion(version)) throw new Error(`不是精确版本（拒绝 range/tag/前缀）: ${version}`)
  const fetcher = deps?.fetchJsonLimited ?? fetchJsonLimited
  const sync = deps?.syncNpmmirror ?? syncNpmmirrorPackage
  const wait = deps?.wait ?? sleepAbortable
  const leg = async (base: string): Promise<NpmVersionDetail> => {
    const data = await fetcher<{
      version?: unknown
      dist?: { integrity?: unknown; tarball?: unknown }
      peerDependencies?: unknown
    }>(`${registryBase(base)}/${encodeURIComponent(pkg)}/${version}`, { timeoutMs, signal })
    const resolved = typeof data.version === 'string' ? data.version : ''
    if (!resolved) throw new Error(`npm 未返回版本: ${pkg}@${version}`)
    const peers: Record<string, string> = {}
    if (data.peerDependencies !== null && typeof data.peerDependencies === 'object') {
      for (const [name, range] of Object.entries(data.peerDependencies as Record<string, unknown>)) {
        if (typeof range === 'string') peers[name] = range
      }
    }
    return {
      version: resolved,
      integrity: typeof data.dist?.integrity === 'string' ? data.dist.integrity : undefined,
      tarball: typeof data.dist?.tarball === 'string' ? data.dist.tarball : undefined,
      peers,
    }
  }
  const primary = registry?.trim() ? registry.trim() : await activeNpmRegistry()
  try {
    return await leg(primary)
  } catch (firstErr) {
    // L2①（ADR-0012）：仅 sync 真正受理才重试镜像（kill switch / 同步失败不付 10s 等待）。
    if (primary === NPM_MIRROR && (await sync(pkg))) {
      await wait(10_000, signal)
      try {
        return await leg(primary)
      } catch {
        // 同源重试仍败 → npmjs 兜底
      }
    }
    if (primary !== DEFAULT_NPM_REGISTRY) return leg(DEFAULT_NPM_REGISTRY)
    throw firstErr
  }
}

/**
 * 精确版本 tarball URL（0.10.0，D3 自升级专用通道的取 URL 腿）：
 * `npmVersion` 薄封装——复用同一 L2① 履约阶梯（ADR-0012，含镜像 sync 腿与 npmjs 兜底），
 * 不新增 packument 面。tarball 缺失 / 版本不存在 → 可读错误上抛。
 */
export async function npmTarballUrl(
  pkg: string,
  version: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  registry?: string,
  deps?: NpmVersionDeps,
): Promise<string> {
  const detail = await npmVersion(pkg, version, timeoutMs, signal, registry, deps)
  if (!detail.tarball) throw new Error(`${pkg}@${version} packument 缺 dist.tarball`)
  return detail.tarball
}

export interface NpmLatestDeps {
  fetchJsonLimited?: typeof fetchJsonLimited
}

// ---------- in-flight 合并（ADR-0040：waiter-scoped 超时/signal + flight 30s 硬上限） ----------

interface NpmFlight {
  promise: Promise<NpmLatest>
  refs: number
  ctrl: AbortController
  timer: ReturnType<typeof setTimeout>
}

const npmFlights = new Map<string, NpmFlight>()
const NPM_FLIGHT_CAP_MS = 30_000

/** waiter 全部离开时中止并清键（flight settle 清理是另一条通道，二者幂等互容）。 */
function flightRelease(key: string, flight: NpmFlight): void {
  flight.refs -= 1
  if (flight.refs === 0 && npmFlights.get(key) === flight) {
    npmFlights.delete(key)
    flight.ctrl.abort(new Error('npmLatest flight：全部等待方已离开'))
    clearTimeout(flight.timer)
  }
}

/** waiter/leader 共用等待裁剪：自身超时、自身 signal、flight ctrl 三臂；ctrl 臂 reason 承载 canonical message（评审 P3：cap 不借 wire 生效）。 */
function raceWaiter(p: Promise<NpmLatest>, timeoutMs: number, signal: AbortSignal | undefined, ctrlSignal?: AbortSignal): Promise<NpmLatest> {
  return new Promise<NpmLatest>((resolve, reject) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const settle = (fn: () => void) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onSelfAbort)
      ctrlSignal?.removeEventListener('abort', onCtrlAbort)
      fn()
    }
    const onSelfAbort = () => settle(() => reject(signal?.reason ?? new Error('npmLatest 被中止')))
    const onCtrlAbort = () => settle(() => reject(ctrlSignal?.reason ?? new Error('npmLatest flight 被中止')))
    if (signal) {
      if (signal.aborted) {
        onSelfAbort()
        return
      }
      signal.addEventListener('abort', onSelfAbort, { once: true })
    }
    if (ctrlSignal) {
      if (ctrlSignal.aborted) {
        onCtrlAbort()
        return
      }
      ctrlSignal.addEventListener('abort', onCtrlAbort, { once: true })
    }
    timer = setTimeout(() => settle(() => reject(new Error('npmLatest 超时'))), timeoutMs)
    p.then(
      (value) => settle(() => resolve(value)),
      (err) => settle(() => reject(err)),
    )
  })
}

/**
 * 升级探测（检测读）内部实现（原 npmLatest 主体逐字节搬入，ADR-0040 包装层见下）。
 * L3 权威链（ADR-0012）：新鲜度敏感——npmjs 权威源优先
 * （首腿超时收紧 `Math.min(timeoutMs, 5_000)`），失败降级生效源（≠npmjs 时）；
 * 不设 sync 腿。显式 registry 参数优先。
 */
async function npmLatestInner(
  pkg: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  registry?: string,
  deps?: NpmLatestDeps,
): Promise<NpmLatest> {
  if (!PKG_RE.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
  const fetcher = deps?.fetchJsonLimited ?? fetchJsonLimited
  const leg = async (base: string, ms: number): Promise<NpmLatest> => {
    const data = await fetcher<{
      version?: unknown
      dist?: { integrity?: unknown; tarball?: unknown }
    }>(`${registryBase(base)}/${encodeURIComponent(pkg)}/latest`, { timeoutMs: ms, signal })
    const version = typeof data.version === 'string' ? data.version : ''
    if (!version) throw new Error(`npm 未返回版本: ${pkg}`)
    return {
      version,
      integrity: typeof data.dist?.integrity === 'string' ? data.dist.integrity : undefined,
      tarball: typeof data.dist?.tarball === 'string' ? data.dist.tarball : undefined,
    }
  }
  const explicit = registry?.trim()
  if (explicit) return leg(explicit, timeoutMs)
  const firstLegMs = Math.min(timeoutMs, 5_000)
  try {
    return await leg(DEFAULT_NPM_REGISTRY, firstLegMs)
  } catch (firstErr) {
    const alt = await activeNpmRegistry()
    if (alt === DEFAULT_NPM_REGISTRY) throw firstErr
    return leg(alt, timeoutMs)
  }
}

/**
 * 升级探测（检测读）公开入口（ADR-0040）：同 (registry, pkg) 的并发调用合并为一根 wire；
 * 单调用语义与错误形态与 npmLatestInner 一致。键：显式 registry 原样 `| pkg`，隐式以
 * `implicit` 字面入键（生效腿由 inner 两腿阶梯决策，避免 waiter join 前先做异步解析）。
 * flight 30s 硬上限与「全部等待方已离开」经 ctrl.abort 承载 canonical message，waiter
 * 经 raceWaiter 的 ctrl 臂如实收到（cap 不借 wire 生效）。
 */
export async function npmLatest(
  pkg: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  registry?: string,
  deps?: NpmLatestDeps,
): Promise<NpmLatest> {
  const key = `${registry?.trim() || 'implicit'}|${pkg}`
  const existing = npmFlights.get(key)
  if (existing) {
    existing.refs += 1
    try {
      return await raceWaiter(existing.promise, timeoutMs, signal, existing.ctrl.signal)
    } finally {
      flightRelease(key, existing)
    }
  }
  const ctrl = new AbortController()
  const flight: NpmFlight = {
    promise: null as unknown as Promise<NpmLatest>,
    refs: 1,
    ctrl,
    timer: null as unknown as ReturnType<typeof setTimeout>,
  }
  flight.timer = setTimeout(() => ctrl.abort(new Error('npmLatest flight 30s 硬上限')), NPM_FLIGHT_CAP_MS)
  flight.promise = npmLatestInner(pkg, timeoutMs, ctrl.signal, registry, deps).finally(() => {
    if (npmFlights.get(key) === flight) {
      npmFlights.delete(key)
      clearTimeout(flight.timer)
    }
  })
  npmFlights.set(key, flight)
  try {
    return await raceWaiter(flight.promise, timeoutMs, signal, flight.ctrl.signal)
  } finally {
    flightRelease(key, flight)
  }
}

/**
 * 拉取完整 packument（NO_MATCHING_VERSION 退避重试前的预热/校验原语）。
 * 返回该包已知的全部版本号；解析不出 versions 时返回空列表（不抛）。
 * 隐式 registry → 访问器缓存（lenient 两腿面；该路径在 B3 改用 warmPackumentFor 后已无
 * 生产消费方，仅测试触达——G3-2 备案）；显式 registry 直取不走缓存。
 */
export async function npmPackument(
  pkg: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  registry?: string,
  deps?: Pick<NpmVersionDeps, 'fetchJsonLimited'>,
): Promise<{ versions: string[] }> {
  if (!PKG_RE.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
  const explicit = registry?.trim()
  if (!explicit) {
    const views = await packumentDocViews(pkg, timeoutMs, signal, deps?.fetchJsonLimited ? { fetchJsonLimited: deps.fetchJsonLimited } : undefined)
    if (!views) throw new Error(`packument 不可用: ${pkg}`)
    return { versions: views.versions }
  }
  const fetcher = deps?.fetchJsonLimited ?? fetchJsonLimited
  const data = await fetcher<{ versions?: unknown }>(`${registryBase(explicit)}/${encodeURIComponent(pkg)}`, {
    timeoutMs,
    signal,
    maxBytes: 8 * 1024 * 1024,
  })
  const versions = data?.versions !== null && typeof data?.versions === 'object' ? Object.keys(data.versions as object) : []
  return { versions }
}

/**
 * npm packument readme 兜底（0.9.45 U10b / 0.9.50 两腿阶梯）：腿1 `/latest` 小端点优先
 * （KB 级载荷，超时收紧 `min(timeoutMs,5s)`），readme 命中即短路；空或腿失败落腿2
 * packument。任一腿成功即成功——readme 空渲染「没有 README」（含 latest 空白 readme +
 * packument 失败的降级，不抛）；两腿全败抛终末腿（packument）错误。两腿均在生效源。
 * 0.9.86：腿2 隐式 registry 改走访问器「生效源单腿带缓存」面（G2-2 方案 a——腿策略与
 * 现状单腿一致，不换两腿；共享缓存）；显式 registry 直取不走缓存。
 */
export async function npmPackumentReadme(
  pkg: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  registry?: string,
  deps?: Pick<NpmVersionDeps, 'fetchJsonLimited'>,
): Promise<{ readme: string; repo: string }> {
  if (!PKG_RE.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
  const fetcher = deps?.fetchJsonLimited ?? fetchJsonLimited
  const explicit = registry?.trim()
  const base = explicit ? registryBase(explicit) : registryBase(await activeNpmRegistry())
  const extractReadme = (data: { readme?: unknown } | undefined | null): string =>
    typeof data?.readme === 'string' && data.readme.trim() !== '' ? data.readme : ''
  // 腿1：/latest 版本文档（小载荷；超时收紧同 npmLatest 首腿先例）
  let latestOk = false
  let latestRepo = ''
  try {
    const latestDoc = await fetcher<{ readme?: unknown; repository?: unknown }>(
      `${base}/${encodeURIComponent(pkg)}/latest`,
      { timeoutMs: Math.min(timeoutMs, 5_000), signal, maxBytes: 8 * 1024 * 1024 },
    )
    latestOk = true
    latestRepo = extractGithubRepo(latestDoc?.repository)
    const latestReadme = extractReadme(latestDoc)
    if (latestReadme) return { readme: latestReadme, repo: latestRepo }
  } catch {
    // latest 腿失败 → 落 packument 腿（终末腿语义见下）
  }
  // 腿2：packument（终末腿）——隐式 registry 走访问器 Active 面（单腿带缓存 + 错误透传）
  try {
    if (explicit) {
      const data = await fetcher<{ readme?: unknown; repository?: unknown }>(
        `${base}/${encodeURIComponent(pkg)}`,
        { timeoutMs, signal, maxBytes: 8 * 1024 * 1024 },
      )
      return { readme: extractReadme(data), repo: extractGithubRepo(data?.repository) }
    }
    const views = await packumentDocViewsActive(pkg, timeoutMs, signal, deps?.fetchJsonLimited ? { fetchJsonLimited: deps.fetchJsonLimited } : undefined)
    return { readme: views.readme, repo: views.repo }
  } catch (packumentErr) {
    if (latestOk) {
      // latest 到达但 readme 空 + packument 失败 → 降级空 readme（0.9.50 语义，不抛）
      return { readme: '', repo: latestRepo }
    }
    throw packumentErr
  }
}
