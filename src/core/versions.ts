/**
 * 最新版本解析（DESIGN.md §3：版本不写死，运行时实查）。
 * npm：registry /latest（pnpm 安装本身会按 lock integrity 校验 tarball）。
 * GitHub：优先最新 release/tag（更新提示只跟稳定版走，不跟 main HEAD——中间提交可能不稳定）；
 * 未认证限额 60 次/小时，自用足够。
 */
import { gt } from 'semver'
import { fetchJsonLimited, HttpError } from './httpx.js'
import { DEFAULT_NPM_REGISTRY, NPM_MIRROR, activeNpmRegistry, syncNpmmirrorPackage } from './npm-route.js'

/** GitHub 匿名限额（60 次/小时/IP）用尽时返回可读提示（含重置等待分钟数），否则 null。 */
function githubRateLimitMessage(err: unknown): string | null {
  if (err instanceof HttpError && err.status === 403 && err.headers?.get('x-ratelimit-remaining') === '0') {
    const resetSec = Number(err.headers.get('x-ratelimit-reset'))
    const waitMin = Number.isFinite(resetSec) && resetSec > 0
      ? Math.max(1, Math.ceil((resetSec * 1000 - Date.now()) / 60_000))
      : null
    return waitMin
      ? `GitHub API 匿名限额已用尽（60 次/小时），约 ${waitMin} 分钟后自动重置`
      : 'GitHub API 匿名限额已用尽（60 次/小时），请稍后重试'
  }
  return null
}

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

/** registry base 归一（去尾斜杠；空/缺省 → 官方 npmjs）。 */
function registryBase(registry?: string): string {
  const base = typeof registry === 'string' && registry.trim() !== '' ? registry.trim() : 'https://registry.npmjs.org'
  return base.replace(/\/+$/, '')
}

/** 精确 semver：接受 prerelease/build metadata，拒绝 v 前缀、range、tag 与脏尾缀。 */
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function isExactVersion(version: string): boolean {
  return EXACT_VERSION_RE.test(version)
}

/** 读取该精确版本的 dist metadata（不使用 /latest endpoint）；integrity 缺失由调用方拒绝安装。 */
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
  if (!/^@?[A-Za-z0-9-._~]+(\/[A-Za-z0-9-._~]+)?$/.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
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
    // L2①（ADR-0012）：仅 sync 真正受理（评审 R1-2：kill switch / 同步失败返回 false 时
    // 不付 10s 等待成本、不发必 404 的同源重试——「风险与回退」承诺的行为回到现状）才重试镜像。
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
 * 拉取完整 packument（NO_MATCHING_VERSION 退避重试前的预热/校验原语）。
 * 返回该包已知的全部版本号；解析不出 versions 时返回空列表（不抛）。
 * L1（ADR-0012/R1-6）：registry 参数曾被忽略——现「显式参数 > 生效源」。
 */
export async function npmPackument(
  pkg: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  registry?: string,
  deps?: Pick<NpmVersionDeps, 'fetchJsonLimited'>,
): Promise<{ versions: string[] }> {
  if (!/^@?[A-Za-z0-9-._~]+(\/[A-Za-z0-9-._~]+)?$/.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
  const fetcher = deps?.fetchJsonLimited ?? fetchJsonLimited
  const base = registry?.trim() ? registry.trim() : await activeNpmRegistry()
  const data = await fetcher<{ versions?: unknown }>(`${registryBase(base)}/${encodeURIComponent(pkg)}`, {
    timeoutMs,
    signal,
    maxBytes: 8 * 1024 * 1024,
  })
  const versions = data?.versions !== null && typeof data?.versions === 'object' ? Object.keys(data.versions as object) : []
  return { versions }
}

export interface NpmLatestDeps {
  fetchJsonLimited?: typeof fetchJsonLimited
}

/**
 * 升级探测（检测读）。L3 权威链（ADR-0012）：新鲜度敏感——npmjs 权威源优先
 * （首腿超时收紧 `Math.min(timeoutMs, 5_000)`），失败降级生效源（≠npmjs 时）；
 * 不设 sync 腿（两腿全败属网络型失败，sync 只救镜像滞后）。显式 registry 参数优先。
 */
export async function npmLatest(
  pkg: string,
  timeoutMs = 20_000,
  signal?: AbortSignal,
  registry?: string,
  deps?: NpmLatestDeps,
): Promise<NpmLatest> {
  // 允许 scoped 包名：@scope/name（isSafePkgName 同款字符集）
  if (!/^@?[A-Za-z0-9-._~]+(\/[A-Za-z0-9-._~]+)?$/.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
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

export async function githubTagSha(repo: string, tag: string, timeoutMs = 20_000, signal?: AbortSignal, budget?: GithubBudget, apiBase: string = 'https://api.github.com'): Promise<string> {
  // commits/{ref} 会自动解引用 annotated tag，返回的才是可用于 #sha 锁定的 commit
  const data = await fetchJsonLimited<{ sha?: unknown }>(`${apiBase}/repos/${repo}/commits/${encodeURIComponent(tag)}`, {
    timeoutMs,
    signal,
    headers: { accept: 'application/vnd.github+json' },
    onRequest: wireReserve(budget),
  })
  const sha = typeof data.sha === 'string' ? data.sha : ''
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`GitHub 未返回有效 SHA: ${repo}@${tag}`)
  return sha
}

export interface GithubTag {
  tag: string
  /** tag 指向的 commit SHA（可直接用于 github:owner/repo#sha 锁定） */
  sha: string
}

// ---------- GitHub 请求预算（M1 Task 5 / Q46） ----------

export type BudgetReserve = 'ok' | 'exhausted'

/** request-scoped 预算对象：listInstalledWithMeta 每次检查创建一个，跨 repo 与 fallback 共享。 */
export interface GithubBudget {
  reserve(): BudgetReserve
}

/** 预算拒绝：该跳 fetch 不发出，错误可识别（latestError 呈现，不与其他网络错误混淆）。 */
export class GithubBudgetExhaustedError extends Error {
  constructor() {
    super('GitHub 更新检查预算已用尽，本次检查的剩余条目未完成')
    this.name = 'GithubBudgetExhaustedError'
  }
}

export const GITHUB_PASSIVE_PER_REQUEST_MAX = 25
export const GITHUB_PASSIVE_HOURLY_MAX = 50
const HOURLY_MS = 3_600_000

/** 宿主级滚动 1 小时命中窗（仅被动探测路径计数；active 调用不经过 reserve 即不受限）。 */
const hourlyHits: number[] = []

function hourlyReserve(): BudgetReserve {
  const now = Date.now()
  while (hourlyHits.length > 0 && now - hourlyHits[0] >= HOURLY_MS) hourlyHits.shift()
  if (hourlyHits.length >= GITHUB_PASSIVE_HOURLY_MAX) return 'exhausted'
  hourlyHits.push(now)
  return 'ok'
}

/** 测试钩子：清空宿主滚动窗口。 */
export function _resetGithubHourlyWindowForTests(): void {
  hourlyHits.length = 0
}

/** 测试钩子：把窗口内全部命中回拨指定毫秒（模拟时间流逝，测过期滑出）。 */
export function _backdateGithubHourlyWindowForTests(ms: number): void {
  for (let i = 0; i < hourlyHits.length; i++) hourlyHits[i] = (hourlyHits[i] ?? 0) - ms
}

export function createGithubRequestBudget(opts: { perRequestMax?: number } = {}): GithubBudget {
  let used = 0
  const max = Math.max(0, Math.floor(opts.perRequestMax ?? GITHUB_PASSIVE_PER_REQUEST_MAX))
  return {
    reserve(): BudgetReserve {
      if (used >= max) return 'exhausted'
      if (hourlyReserve() === 'exhausted') return 'exhausted'
      used += 1
      return 'ok'
    },
  }
}

/** wire 层 reserve 钩子（httpx onRequest）：拒绝即中止该跳且不发出请求；无预算 → undefined（零预算交互）。 */
function wireReserve(budget?: GithubBudget): ((url: string) => void) | undefined {
  if (!budget) return undefined
  return () => {
    if (budget.reserve() === 'exhausted') throw new GithubBudgetExhaustedError()
  }
}

// ---------- 同仓库 single-flight（预算策略池分池） ----------

interface GhFlight {
  promise: Promise<GithubTag>
  refs: number
  ctrl: AbortController
}

const ghFlights = new Map<string, GhFlight>()

function ghAbortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

function raceWaiter(promise: Promise<GithubTag>, timeoutMs: number, signal?: AbortSignal): Promise<GithubTag> {
  return new Promise<GithubTag>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`GitHub 请求超时（${timeoutMs}ms）`)), Math.max(1, timeoutMs))
    const onAbort = () => reject(ghAbortError())
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(ghAbortError())
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    const done = (fn: () => void) => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      fn()
    }
    promise.then(
      (value) => done(() => resolve(value)),
      (err) => done(() => reject(err)),
    )
  })
}

/** 共享 flight 的实际 fetch 序列：release 路径 1–2 个 wire 请求、fallback 路径逐次 reserve。 */
async function fetchGithubTag(repo: string, timeoutMs: number, signal: AbortSignal, budget?: GithubBudget, apiBase: string = 'https://api.github.com'): Promise<GithubTag> {
  const headers = { accept: 'application/vnd.github+json' }
  const reserve = wireReserve(budget)
  try {
    // 1) 最新 release（404 = 仓库从未发过 release → 回退 tags）
    try {
      const rel = await fetchJsonLimited<{ tag_name?: unknown }>(
        `${apiBase}/repos/${repo}/releases/latest`,
        { timeoutMs, signal, headers, onRequest: reserve },
      )
      const tag = typeof rel.tag_name === 'string' ? rel.tag_name.trim() : ''
      if (tag) return { tag, sha: await githubTagSha(repo, tag, timeoutMs, signal, budget, apiBase) }
    } catch (err) {
      const status = (err as HttpError).status
      if (status !== 404) throw err
    }

    // 2) 回退：tags 列表（GitHub 按创建时间倒序，首项即最新）——tag object sha 经 commits/{ref}
    //    解引用为 commit sha（与 release 路径同语义，annotated tag 的 object sha 不可直接锁定）
    const tags = await fetchJsonLimited<Array<{ name?: unknown }>>(
      `${apiBase}/repos/${repo}/tags`,
      { timeoutMs, signal, headers, onRequest: reserve },
    )
    if (!Array.isArray(tags) || !tags.length) throw new Error(`仓库没有任何 tag: ${repo}`)
    const first = tags[0]
    const name = typeof first.name === 'string' ? first.name : ''
    if (!name) throw new Error(`tag 信息无效: ${repo}`)
    return { tag: name, sha: await githubTagSha(repo, name, timeoutMs, signal, budget, apiBase) }
  } catch (err) {
    const rateLimit = githubRateLimitMessage(err)
    if (rateLimit) throw new Error(rateLimit)
    throw err
  }
}

function releaseGhFlight(key: string, flight: GhFlight): void {
  flight.refs -= 1
  if (flight.refs <= 0) {
    flight.ctrl.abort()
    if (ghFlights.get(key) === flight) ghFlights.delete(key)
  }
}

/**
 * GitHub 来源的“最新稳定点”：优先最新 release（排除 draft/prerelease），无则回退 tags 列表首项。
 * Q46 预算语义（M1 Task 5）：
 * - 同仓库 in-flight single-flight，key = 仓库 + 预算策略池（passive-budgeted / active-unbudgeted 互不 join）；
 * - 记账：flight 创建时绑定 leader 的预算对象（一次）；reserve() 挂 httpx onRequest，
 *   每个物理 outbound fetch（含重定向每一跳）各一次；joiner 不重复 reserve（join 零 wire 成本，
 *   预算已耗尽的 waiter 可免费加入既有 flight）；
 * - waiter-scoped：每个 waiter 用自己的 timeoutMs/signal race 共享 Promise；任何 waiter 的
 *   signal 都不影响共享请求——最后一个 waiter 离开才 abort；
 * - 无 budget 的调用（用户主动 install/upgrade/诊断）零预算交互，不受被动窗口限制。
 */
export async function githubLatestTag(repo: string, timeoutMs = 20_000, signal?: AbortSignal, budget?: GithubBudget, apiBase: string = 'https://api.github.com'): Promise<GithubTag> {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error(`无效 GitHub 仓库: ${repo}`)
  const key = `${budget ? 'passive' : 'active'}§${repo}`
  let flight = ghFlights.get(key)
  if (!flight) {
    const ctrl = new AbortController()
    const created: GhFlight = { refs: 0, ctrl, promise: fetchGithubTag(repo, timeoutMs, ctrl.signal, budget, apiBase) }
    created.promise.finally(() => {
      if (ghFlights.get(key) === created && created.refs <= 0) ghFlights.delete(key)
    }).catch(() => undefined)
    ghFlights.set(key, created)
    flight = created
  }
  flight.refs += 1
  try {
    return await raceWaiter(flight.promise, timeoutMs, signal)
  } finally {
    releaseGhFlight(key, flight)
  }
}

/**
 * 版本前进比较（0.5.0 语义加固）：标准 semver 前进比较——prerelease < 正式版、
 * build metadata 不参与比较。旧自定义折叠实现把 `1.2.3-beta.1` 的数字尾段参与比较、
 * 误判为大于 `1.2.3`，本实现以 semver.gt 修正。非法输入不抛、一律 false。
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  // 只接受精确 semver（与收录语义一致：v 前缀/range/tag 不参与比较）；非法输入不抛、一律 false
  if (!EXACT_VERSION_RE.test(String(candidate ?? '')) || !EXACT_VERSION_RE.test(String(current ?? ''))) return false
  try {
    return gt(String(candidate), String(current))
  } catch {
    return false
  }
}
