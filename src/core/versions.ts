/**
 * 最新版本解析（DESIGN.md §3：版本不写死，运行时实查）。
 * npm：registry /latest（pnpm 安装本身会按 lock integrity 校验 tarball）。
 * GitHub：优先最新 release/tag（更新提示只跟稳定版走，不跟 main HEAD——中间提交可能不稳定）；
 * 无 release 且无 tag 的仓库回退默认分支 HEAD（'HEAD' 标记，对齐 dsh-market：
 * 该形态此前直接抛「仓库没有任何 tag」导致 GitHub 单一源插件完全不可安装）。
 * 未认证限额 60 次/小时，自用足够。
 *
 * 0.9.86（ADR-0019）：npm registry 元数据族（npmVersion/npmPackument/npmPackumentReadme/
 * npmLatest/extractGithubRepo/isExactVersion 及其类型）实现已迁入 packument 访问器属主模块；
 * 本文件原名 re-export 保全部 import 位零改动，自身只留 GitHub 族。
 */
import { gt } from 'semver'
import { fetchJsonLimited, HttpError } from './httpx.js'
import { isExactVersion } from './packument.js'

export {
  npmVersion,
  npmTarballUrl,
  npmPackument,
  npmPackumentReadme,
  npmLatest,
  extractGithubRepo,
  isExactVersion,
} from './packument.js'
export type { NpmLatest, NpmVersionMetadata, NpmVersionDetail, NpmVersionDeps, NpmLatestDeps } from './packument.js'

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
    if (!Array.isArray(tags) || !tags.length) {
      // 3) 兜底（对齐 dsh-market）：仓库从未发 release/tag → 默认分支 HEAD。
      //    commits/HEAD 由 GitHub API 自动解引用默认分支头 commit，一次请求使
      //    github:owner/repo（无 #fragment）形态可安装/可升级；tag 字段返回 'HEAD'
      //    标记——semver 提示面对此类条目不产假更新徽章（SHA 面提示待后续评估）。
      const headSha = await githubTagSha(repo, 'HEAD', timeoutMs, signal, budget, apiBase)
      return { tag: 'HEAD', sha: headSha }
    }
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
  if (!isExactVersion(String(candidate ?? '')) || !isExactVersion(String(current ?? ''))) return false
  try {
    return gt(String(candidate), String(current))
  } catch {
    return false
  }
}
