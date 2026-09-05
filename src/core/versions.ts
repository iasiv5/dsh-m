/**
 * 最新版本解析（DESIGN.md §3：版本不写死，运行时实查）。
 * npm：registry /latest（pnpm 安装本身会按 lock integrity 校验 tarball）。
 * GitHub：优先最新 release/tag（更新提示只跟稳定版走，不跟 main HEAD——中间提交可能不稳定）；
 * 未认证限额 60 次/小时，自用足够。
 */
import { fetchJsonLimited, HttpError } from './httpx.js'

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

/** 精确 semver：接受 prerelease/build metadata，拒绝 v 前缀、range、tag 与脏尾缀。 */
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function isExactVersion(version: string): boolean {
  return EXACT_VERSION_RE.test(version)
}

/** 读取该精确版本的 dist metadata（不使用 /latest endpoint）；integrity 缺失由调用方拒绝安装。 */
export async function npmVersion(pkg: string, version: string, timeoutMs = 20_000, signal?: AbortSignal): Promise<NpmVersionMetadata> {
  if (!/^@?[A-Za-z0-9-._~]+(\/[A-Za-z0-9-._~]+)?$/.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
  if (!isExactVersion(version)) throw new Error(`不是精确版本（拒绝 range/tag/前缀）: ${version}`)
  const data = await fetchJsonLimited<{
    version?: unknown
    dist?: { integrity?: unknown; tarball?: unknown }
  }>(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/${version}`, { timeoutMs, signal })
  const resolved = typeof data.version === 'string' ? data.version : ''
  if (!resolved) throw new Error(`npm 未返回版本: ${pkg}@${version}`)
  return {
    version: resolved,
    integrity: typeof data.dist?.integrity === 'string' ? data.dist.integrity : undefined,
    tarball: typeof data.dist?.tarball === 'string' ? data.dist.tarball : undefined,
  }
}

/**
 * 拉取完整 packument（NO_MATCHING_VERSION 退避重试前的预热/校验原语）。
 * 返回该包已知的全部版本号；解析不出 versions 时返回空列表（不抛）。
 */
export async function npmPackument(pkg: string, timeoutMs = 20_000, signal?: AbortSignal): Promise<{ versions: string[] }> {
  if (!/^@?[A-Za-z0-9-._~]+(\/[A-Za-z0-9-._~]+)?$/.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
  const data = await fetchJsonLimited<{ versions?: unknown }>(
    `https://registry.npmjs.org/${encodeURIComponent(pkg)}`,
    { timeoutMs, signal, maxBytes: 8 * 1024 * 1024 },
  )
  const versions = data?.versions !== null && typeof data?.versions === 'object' ? Object.keys(data.versions as object) : []
  return { versions }
}

export async function npmLatest(pkg: string, timeoutMs = 20_000, signal?: AbortSignal): Promise<NpmLatest> {
  // 允许 scoped 包名：@scope/name（isSafePkgName 同款字符集）
  if (!/^@?[A-Za-z0-9-._~]+(\/[A-Za-z0-9-._~]+)?$/.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
  const data = await fetchJsonLimited<{
    version?: unknown
    dist?: { integrity?: unknown; tarball?: unknown }
  }>(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, { timeoutMs, signal })
  const version = typeof data.version === 'string' ? data.version : ''
  if (!version) throw new Error(`npm 未返回版本: ${pkg}`)
  return {
    version,
    integrity: typeof data.dist?.integrity === 'string' ? data.dist.integrity : undefined,
    tarball: typeof data.dist?.tarball === 'string' ? data.dist.tarball : undefined,
  }
}

export async function githubTagSha(repo: string, tag: string, timeoutMs = 20_000, signal?: AbortSignal): Promise<string> {
  // commits/{ref} 会自动解引用 annotated tag，返回的才是可用于 #sha 锁定的 commit
  const data = await fetchJsonLimited<{ sha?: unknown }>(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(tag)}`, {
    timeoutMs,
    signal,
    headers: { accept: 'application/vnd.github+json' },
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

/** GitHub 来源的“最新稳定点”：优先最新 release（排除 draft/prerelease），无则回退 tags 列表首项。 */
export async function githubLatestTag(repo: string, timeoutMs = 20_000, signal?: AbortSignal): Promise<GithubTag> {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error(`无效 GitHub 仓库: ${repo}`)
  const headers = { accept: 'application/vnd.github+json' }
  try {

  // 1) 最新 release（404 = 仓库从未发过 release → 回退 tags）
  try {
    const rel = await fetchJsonLimited<{ tag_name?: unknown }>(
      `https://api.github.com/repos/${repo}/releases/latest`,
      { timeoutMs, signal, headers },
    )
    const tag = typeof rel.tag_name === 'string' ? rel.tag_name.trim() : ''
    if (tag) return { tag, sha: await githubTagSha(repo, tag, timeoutMs, signal) }
  } catch (err) {
    const status = (err as HttpError).status
    if (status !== 404) throw err
  }

  // 2) 回退：tags 列表（GitHub 按创建时间倒序，首项即最新）
  const tags = await fetchJsonLimited<Array<{ name?: unknown; commit?: { sha?: unknown } }>>(
    `https://api.github.com/repos/${repo}/tags`,
    { timeoutMs, signal, headers },
  )
  if (!Array.isArray(tags) || !tags.length) throw new Error(`仓库没有任何 tag: ${repo}`)
  const first = tags[0]
  const name = typeof first.name === 'string' ? first.name : ''
  const sha = first.commit && typeof first.commit.sha === 'string' ? first.commit.sha : ''
  if (!name || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`tag 信息无效: ${repo}`)
  return { tag: name, sha }
  } catch (err) {
    const rateLimit = githubRateLimitMessage(err)
    if (rateLimit) throw new Error(rateLimit)
    throw err
  }
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string): number[] =>
    String(v || '')
      .replace(/^v/i, '')
      .split(/[-+.]/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
      .map((n) => (typeof n === 'number' ? n : 0))
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}
