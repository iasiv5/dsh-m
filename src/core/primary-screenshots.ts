import { fetchTextLimited, type FetchOptions } from './httpx.js'

const MANIFEST_HOST = 'raw.githubusercontent.com'
/**
 * 0.9.77 兜底腿（桌面机 raw 被墙实录）：raw.githubusercontent.com 直连在部分网络下
 * TLS 握手即被 reset，而 registry 清单自身早有 default-raw → default-jsdelivr 降级链、
 * 社区目录有 jsdelivr/npmmirror/unpkg 三路由——截图 manifest 是全市场唯一单源抓取点，
 * 症状为「列表/README/安装全正常，唯独精选详情无截图」。此处补齐同款第二腿：
 * jsDelivr 的 GitHub 镜像，仅当 raw 抓取层失败（含 404/超时/host guard 拒绝）时启用。
 */
const MIRROR_HOST = 'cdn.jsdelivr.net'
const MANIFEST_FILE = 'screenshots.json'
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_SCREENSHOTS = 8
const SUCCESS_TTL_MS = 10 * 60_000
const EMPTY_TTL_MS = 60_000
const OWNER_MAX = 39
const REPO_MAX = 100
const GITHUB_REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/
const CONTROL_RE = /[\u0000-\u001f\u007f]/

export type PrimaryScreenshotFetcher = typeof fetchTextLimited
export type PrimaryScreenshotReader = (github: string) => Promise<string[]>

export interface PrimaryScreenshotReaderOptions {
  /** Production uses fetchTextLimited; tests supply an in-memory adapter. */
  fetchText?: PrimaryScreenshotFetcher
  /** Expiry clock seam; production uses Date.now. */
  now?: () => number
}

interface CacheEntry {
  screenshots: string[]
  expiresAt: number
}

/** owner/repo 校验与归一（GITHUB_REPO_RE 与 registry 同款）；非法输入返回 null（零抓取）。 */
function repoSlug(github: string): string | null {
  const value = typeof github === 'string' ? github.trim() : ''
  if (!GITHUB_REPO_RE.test(value)) return null
  const slash = value.indexOf('/')
  const owner = value.slice(0, slash)
  const repo = value.slice(slash + 1)
  if (owner.length > OWNER_MAX || repo.length > REPO_MAX || repo === '.' || repo === '..') return null
  return `${owner}/${repo}`
}

/**
 * raw 规范形（/HEAD/ = 默认分支）。它同时是 parseManifest 的路径解析基址：无论哪条腿供数，
 * 返回的图片 URL 一律落在 *.githubusercontent.com——恰好通过客户端 safeScreenshots 图床白名单
 * （main.jsx 只放行 github.com / *.githubusercontent.com），镜像腿若原样回 jsdelivr URL 会被
 * 客户端整体过滤、白修。
 */
function rawManifestUrl(slug: string): string {
  return `https://${MANIFEST_HOST}/${slug}/HEAD/${MANIFEST_FILE}`
}

/**
 * jsDelivr 镜像形（@HEAD 与 raw /HEAD/ 同义，默认分支，实测可用）。镜像存在 CDN 缓存滞后
 * （registry default-jsdelivr 同款取舍，可用 purge.jsdelivr.net 手动清缓存），截图属低频变更元数据，可接受。
 */
function mirrorManifestUrl(slug: string): string {
  return `https://${MIRROR_HOST}/gh/${slug}@HEAD/${MANIFEST_FILE}`
}

/**
 * Manifest 路径规则单一事实源（ADR-0015 决策修订）：合法返回 null，违规返回中文错误串。
 * 消费方：screenshotUrl（运行时解析）与 registry 校验（screenshots 内嵌字段，registry.ts）——
 * 两处共用同一规则面，禁另起一套。
 */
export function screenshotPathError(rawPath: unknown): string | null {
  if (typeof rawPath !== 'string') return '必须是字符串'
  const path = rawPath.trim()
  if (!path) return '不能为空字符串'
  if (CONTROL_RE.test(path)) return '含控制字符'
  if (path.startsWith('/') || path.startsWith('\\') || path.includes('\\')) return '禁绝对/反斜杠路径'
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) return '禁协议或协议相对路径'
  if (/[?#]/.test(path)) return '禁 query/hash'
  if (path.split('/').some((part) => part === '' || part === '.' || part === '..')) return '禁空段与 ./.. 越界段'
  return null
}

function screenshotUrl(baseUrl: string, rawPath: unknown): string | null {
  if (screenshotPathError(rawPath) !== null) return null
  const path = (rawPath as string).trim()
  const segments = path.split('/')
  const base = new URL('.', baseUrl)
  return new URL(segments.map((part) => encodeURIComponent(part)).join('/'), base).toString()
}

function parseManifest(text: string, baseUrl: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_SCREENSHOTS) return []
  const result: string[] = []
  for (const path of parsed) {
    const url = screenshotUrl(baseUrl, path)
    if (!url) return []
    result.push(url)
  }
  return result
}

function assertManifestHost(raw: string, isRedirectHop: boolean, allowedHost: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(isRedirectHop ? 'screenshot manifest redirect URL is invalid' : 'invalid screenshot manifest request URL')
  }
  if (url.protocol !== 'https:' || url.hostname !== allowedHost || url.username || url.password || url.port) {
    throw new Error(
      isRedirectHop
        ? `screenshot manifest redirects must remain on ${allowedHost}`
        : `screenshot manifest request URL must be https://${allowedHost}`,
    )
  }
}

/** 单腿抓取：每腿独立逐跳 host guard（初始跳 + 重定向都不许离开本腿源），5s / 64KB 上限逐腿独立生效。 */
async function fetchManifestLeg(
  fetchText: PrimaryScreenshotFetcher,
  url: string,
  allowedHost: string,
): Promise<string> {
  let hop = 0
  return fetchText(url, {
    timeoutMs: 5_000,
    maxBytes: MAX_MANIFEST_BYTES,
    headers: { accept: 'application/json' },
    onRequest: (hopUrl) => {
      // 逐跳 host guard；错误文案区分初始跳与重定向跳，避免调试误导（评审建议落盘）。
      const isRedirectHop = hop > 0
      hop += 1
      assertManifestHost(hopUrl, isRedirectHop, allowedHost)
    },
  } satisfies FetchOptions)
}

/**
 * Read an author-owned root screenshots.json without consulting Community Catalog.
 * 两腿链：raw 抓取层失败 → jsDelivr 镜像；两腿全败 → 空图库。解析层的「空」是权威结果
 * （两腿读的是同一 repo 文件，镜像不会有不同内容），不再触发兜底。
 * All network access is bounded, and a rejected/empty manifest degrades to no gallery.
 */
export function createPrimaryScreenshotReader(options: PrimaryScreenshotReaderOptions = {}): PrimaryScreenshotReader {
  const fetchText = options.fetchText ?? fetchTextLimited
  const now = options.now ?? Date.now
  const cache = new Map<string, CacheEntry>()
  const flights = new Map<string, Promise<string[]>>()

  return async (github: string): Promise<string[]> => {
    const slug = repoSlug(github)
    if (!slug) return []
    const rawUrl = rawManifestUrl(slug)
    const key = rawUrl.toLowerCase()
    const timestamp = now()
    for (const [cachedKey, value] of cache) {
      if (value.expiresAt <= timestamp) cache.delete(cachedKey)
    }
    const cached = cache.get(key)
    if (cached && cached.expiresAt > timestamp) return [...cached.screenshots]

    const pending = flights.get(key)
    if (pending) return [...(await pending)]

    const flight = (async () => {
      let screenshots: string[] = []
      try {
        const text = await fetchManifestLeg(fetchText, rawUrl, MANIFEST_HOST)
        screenshots = parseManifest(text, rawUrl)
      } catch {
        try {
          const mirrorUrl = mirrorManifestUrl(slug)
          const text = await fetchManifestLeg(fetchText, mirrorUrl, MIRROR_HOST)
          screenshots = parseManifest(text, rawUrl)
        } catch {
          // Images are optional metadata: a missing/unavailable manifest must not block detail/install.
          screenshots = []
        }
      }
      cache.set(key, {
        screenshots,
        expiresAt: now() + (screenshots.length > 0 ? SUCCESS_TTL_MS : EMPTY_TTL_MS),
      })
      return screenshots
    })()
    flights.set(key, flight)
    try {
      return [...(await flight)]
    } finally {
      if (flights.get(key) === flight) flights.delete(key)
    }
  }
}

/** Production reader: one process-memory cache shared by GUI Host calls. */
export const loadPrimaryScreenshots = createPrimaryScreenshotReader()

/** Exported parser contract for focused regression tests; production calls the reader above. */
export const PRIMARY_SCREENSHOT_LIMIT = MAX_SCREENSHOTS
export const PRIMARY_SCREENSHOT_MANIFEST_MAX_BYTES = MAX_MANIFEST_BYTES
export const PRIMARY_SCREENSHOT_SUCCESS_TTL_MS = SUCCESS_TTL_MS
export const PRIMARY_SCREENSHOT_EMPTY_TTL_MS = EMPTY_TTL_MS
