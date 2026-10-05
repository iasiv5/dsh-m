/**
 * 截图纯逻辑（0.9.34 / ADR-0013）：GitHub 图床白名单、jsDelivr 线路改写、README 抽图与
 * 语义打分、会话缓存工厂、多候选抓取链（content-length 预检 + chunked 边读边限 + 超时 +
 * 失败静默降级）。不依赖 DOM/React；Node tests 直接 import（同 market-state.js 模式）。
 */

export const CARD_SHOT_LIMIT = 3
export const GALLERY_SHOT_LIMIT = 6
export const README_MAX_BYTES = 262144
export const README_FETCH_TIMEOUT_MS = 8000

const MAX_SHOT_URL = 2048

/** GitHub 图床白名单（与 registry schema 校验同语义）：github.com 或 *.githubusercontent.com。 */
export function isSafeShotUrl(url) {
  if (typeof url !== 'string' || url === '' || url.length > MAX_SHOT_URL) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return parsed.hostname === 'github.com' || parsed.hostname.endsWith('.githubusercontent.com')
  } catch {
    return false
  }
}

// 仓库路径形态：ref 段不限定（HEAD/分支/tag 都改写为 jsDelivr @HEAD——截图对滞后不敏感，
// @HEAD 最耐用）；github.com/<o>/<r>/raw/ 形态同归一。
const RAW_GH_RE = /^https:\/\/raw\.githubusercontent\.com\/([^/\s]+)\/([^/\s]+)\/[^/\s]+\/(\S+)$/
const GH_RAW_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/raw\/[^/\s]+\/(\S+)$/

/** 首选线路候选：raw 仓库路径图 → [jsDelivr@HEAD 改写, 原 URL]；其余白名单图 → [原 URL]；非白名单 → []。 */
export function shotSrcCandidates(url) {
  if (!isSafeShotUrl(url)) return []
  const m = RAW_GH_RE.exec(url) || GH_RAW_RE.exec(url)
  if (!m) return [url]
  const [, owner, repo, path] = m
  return [`https://cdn.jsdelivr.net/gh/${owner}/${repo}@HEAD/${path}`, url]
}

const INLINE_IMG_RE = /!\[[^\]]*?\]\(\s*(https:[^)\s]+)/g
const REF_DEF_RE = /^[ \t]*\[([^\]]+)\]:[ \t]+(https:\S+)/gm
const REF_USE_RE = /!\[[^\]]*?\]\[([^\]]+)\]/g
const HTML_IMG_RE = /<img[^>]*?\ssrc=["'](https:[^"']+)["']/gi

/** README markdown 抽图：内联图 + 参考式定义（按引用取用）+ HTML <img>；仅收 https。 */
export function extractReadmeImageUrls(markdown) {
  if (typeof markdown !== 'string' || markdown === '') return []
  const out = []
  const seen = new Set()
  const push = (u) => {
    if (typeof u !== 'string') return
    const clean = u.trim()
    if (!/^https:\/\//i.test(clean)) return
    if (!seen.has(clean)) {
      seen.add(clean)
      out.push(clean)
    }
  }
  const refDefs = new Map()
  for (const m of markdown.matchAll(REF_DEF_RE)) refDefs.set(m[1], m[2])
  for (const m of markdown.matchAll(INLINE_IMG_RE)) push(m[1])
  for (const m of markdown.matchAll(REF_USE_RE)) {
    const def = refDefs.get(m[1]) ?? refDefs.get(m[1].toLowerCase())
    if (def) push(def)
  }
  for (const m of markdown.matchAll(HTML_IMG_RE)) push(m[1])
  return out
}

// 语义打分（瘦身版，无几何探针）：剔装饰图，偏好产品截图路径；同分稳定保序。
const BAD_SHOT_RE = /(?:^|[/\-.])(?:badge|logo|avatar|icon|sprite|spinner)(?:[/\-.?]|$)|shields\.io|\.svg(?:[?#]|$)/i
const GOOD_NAME_RE = /(screenshot|preview|shot)/i
const GOOD_PATH_RE = /\/docs\//i

export function rankReadmeShots(urls, limit) {
  const safe = (Array.isArray(urls) ? urls : []).filter(isSafeShotUrl).filter((u) => !BAD_SHOT_RE.test(u))
  const scored = safe.map((u, i) => {
    let score = 0
    if (GOOD_NAME_RE.test(u)) score += 2
    if (GOOD_PATH_RE.test(u)) score += 1
    return { u, i, score }
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  const lim = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : safe.length
  return scored.slice(0, lim).map((s) => s.u)
}

/** 会话级缓存工厂（GalleryCard / CardShots 共用）：按条目 id 记忆兜底结果，含空结果。 */
export function createReadmeShotCache() {
  const map = new Map()
  return {
    get: (id) => map.get(id),
    set: (id, shots) => {
      map.set(id, Array.isArray(shots) ? shots : [])
    },
    clear: () => map.clear(),
  }
}

function readmeCandidates(repo) {
  return [
    `https://cdn.jsdelivr.net/gh/${repo}@HEAD/README.md`,
    `https://raw.githubusercontent.com/${repo}/HEAD/README.md`,
  ]
}

/** chunked/有长度头通吃的有界读取：字节数达到上限即 cancel 停读（AA-0013 双保险的边读边限半边）。 */
async function readBodyCapped(res, cap) {
  const body = res.body
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const dec = new TextDecoder()
    let bytes = 0
    let text = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value ? value.byteLength : 0
        text += dec.decode(value, { stream: true })
        if (bytes >= cap) {
          try {
            await reader.cancel()
          } catch {
            /* reader 已关 */
          }
          break
        }
      }
    } finally {
      try {
        if (reader.releaseLock) reader.releaseLock()
      } catch {
        /* ignore */
      }
    }
    return text.slice(0, cap)
  }
  const text = await res.text()
  return text.slice(0, cap)
}

/**
 * README 抽图兜底（瘦身版）：jsDelivr → raw 两候选；成功拿到正文即停（同仓库两候选内容
 * 相同，无图也不做无意义重试）；任一失败静默进入下一候选；全败返回 []。
 * deps.cache 命中即短路返回；未命中抓取后写回（空结果也写，避免会话内反复打网络）。
 */
export async function fetchReadmeShots(entry, deps = {}) {
  const fetchImpl = deps.fetchImpl || (typeof fetch === 'function' ? fetch : null)
  const cache = deps.cache || null
  const repo = entry && typeof entry.github === 'string' && /^[^\s/]+\/[^\s/]+$/.test(entry.github) ? entry.github : ''
  const id = entry && entry.id != null ? String(entry.id) : ''
  if (!fetchImpl || repo === '') return []
  if (cache) {
    const hit = cache.get(id)
    if (hit !== undefined) return hit
  }
  const found = []
  for (const url of readmeCandidates(repo)) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), README_FETCH_TIMEOUT_MS)
      let res
      try {
        res = await fetchImpl(url, { signal: ctrl.signal })
      } finally {
        clearTimeout(timer)
      }
      if (!res || !res.ok) continue
      const lenHeader = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null
      if (lenHeader && Number(lenHeader) > README_MAX_BYTES) continue
      const md = await readBodyCapped(res, README_MAX_BYTES)
      found.push(...rankReadmeShots(extractReadmeImageUrls(md), GALLERY_SHOT_LIMIT))
      break
    } catch {
      /* 该线路失败 → 下一候选；全败静默 */
    }
  }
  const out = found.slice(0, GALLERY_SHOT_LIMIT)
  if (cache) cache.set(id, out)
  return out
}
