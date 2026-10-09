import { fetchTextLimited, type FetchOptions } from './httpx.js'

const MANIFEST_HOST = 'raw.githubusercontent.com'
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

function manifestUrl(github: string): string | null {
  const value = typeof github === 'string' ? github.trim() : ''
  if (!GITHUB_REPO_RE.test(value)) return null
  const slash = value.indexOf('/')
  const owner = value.slice(0, slash)
  const repo = value.slice(slash + 1)
  if (owner.length > OWNER_MAX || repo.length > REPO_MAX || repo === '.' || repo === '..') return null
  return `https://${MANIFEST_HOST}/${owner}/${repo}/HEAD/${MANIFEST_FILE}`
}

function screenshotUrl(manifest: string, rawPath: unknown): string | null {
  if (typeof rawPath !== 'string') return null
  const path = rawPath.trim()
  if (!path || CONTROL_RE.test(path)) return null
  if (path.startsWith('/') || path.startsWith('\\') || path.includes('\\')) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) return null
  if (/[?#]/.test(path)) return null
  const segments = path.split('/')
  if (segments.some((part) => part === '' || part === '.' || part === '..')) return null
  const base = new URL('.', manifest)
  return new URL(segments.map((part) => encodeURIComponent(part)).join('/'), base).toString()
}

function parseManifest(text: string, manifestUrl: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_SCREENSHOTS) return []
  const result: string[] = []
  for (const path of parsed) {
    const url = screenshotUrl(manifestUrl, path)
    if (!url) return []
    result.push(url)
  }
  return result
}

function assertManifestHost(raw: string, isRedirectHop: boolean): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(isRedirectHop ? 'screenshot manifest redirect URL is invalid' : 'invalid screenshot manifest request URL')
  }
  if (url.protocol !== 'https:' || url.hostname !== MANIFEST_HOST || url.username || url.password || url.port) {
    throw new Error(
      isRedirectHop
        ? 'screenshot manifest redirects must remain on raw.githubusercontent.com'
        : 'screenshot manifest request URL must be https://raw.githubusercontent.com',
    )
  }
}

/**
 * Read an author-owned root screenshots.json without consulting Community Catalog.
 * All network access is bounded, and a rejected/empty manifest degrades to no gallery.
 */
export function createPrimaryScreenshotReader(options: PrimaryScreenshotReaderOptions = {}): PrimaryScreenshotReader {
  const fetchText = options.fetchText ?? fetchTextLimited
  const now = options.now ?? Date.now
  const cache = new Map<string, CacheEntry>()
  const flights = new Map<string, Promise<string[]>>()

  return async (github: string): Promise<string[]> => {
    const url = manifestUrl(github)
    if (!url) return []
    const key = url.toLowerCase()
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
      let hop = 0
      try {
        const text = await fetchText(url, {
          timeoutMs: 5_000,
          maxBytes: MAX_MANIFEST_BYTES,
          headers: { accept: 'application/json' },
          onRequest: (hopUrl) => {
            // 逐跳 host guard；错误文案区分初始跳与重定向跳，避免调试误导（评审建议落盘）。
            const isRedirectHop = hop > 0
            hop += 1
            assertManifestHost(hopUrl, isRedirectHop)
          },
        } satisfies FetchOptions)
        screenshots = parseManifest(text, url)
      } catch {
        // Images are optional metadata: a missing/unavailable manifest must not block detail/install.
        screenshots = []
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
