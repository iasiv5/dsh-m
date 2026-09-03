/**
 * 最新版本解析（DESIGN.md §3：版本不写死，运行时实查）。
 * npm：registry /latest（pnpm 安装本身会按 lock integrity 校验 tarball）。
 * GitHub：api.github.com 解析 HEAD commit SHA（未认证限额 60 次/小时，自用足够）。
 */
import { fetchJsonLimited } from './httpx.js'

export interface NpmLatest {
  version: string
  integrity?: string
  tarball?: string
}

export async function npmLatest(pkg: string, timeoutMs = 20_000): Promise<NpmLatest> {
  // 允许 scoped 包名：@scope/name（isSafePkgName 同款字符集）
  if (!/^@?[A-Za-z0-9-._~]+(\/[A-Za-z0-9-._~]+)?$/.test(pkg)) throw new Error(`无效 npm 包名: ${pkg}`)
  const data = await fetchJsonLimited<{
    version?: unknown
    dist?: { integrity?: unknown; tarball?: unknown }
  }>(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, { timeoutMs })
  const version = typeof data.version === 'string' ? data.version : ''
  if (!version) throw new Error(`npm 未返回版本: ${pkg}`)
  return {
    version,
    integrity: typeof data.dist?.integrity === 'string' ? data.dist.integrity : undefined,
    tarball: typeof data.dist?.tarball === 'string' ? data.dist.tarball : undefined,
  }
}

export async function githubHeadSha(repo: string, timeoutMs = 20_000): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error(`无效 GitHub 仓库: ${repo}`)
  const data = await fetchJsonLimited<{ sha?: unknown }>(`https://api.github.com/repos/${repo}/commits/HEAD`, {
    timeoutMs,
    headers: { accept: 'application/vnd.github+json' },
  })
  const sha = typeof data.sha === 'string' ? data.sha : ''
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`GitHub 未返回有效 SHA: ${repo}`)
  return sha
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
