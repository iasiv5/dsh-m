/**
 * 安全基线 §17.1：仅 HTTPS（loopback http 例外）+ 响应大小上限 + 超时 + 手动重定向。
 * 所有 HTTP JSON/text/HEAD 请求共享同一 primitive：每一跳 assertSafeUrl、最多 3 跳、
 * 循环检测、signal 传播、返回最终 URL；registry/homepage/icon 诊断不得另起一套。
 */
import { Buffer } from 'node:buffer'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const MAX_DEFAULT = 2 * 1024 * 1024 // 2MB：registry/npm metadata 足够
const MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const USER_AGENT = 'dsh-m (personal marketplace)'

export function assertSafeUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new HttpError(400, `无效 URL`)
  }
  if (url.protocol === 'https:') return url
  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    return url // 本地 registry 覆盖调试用（DESIGN.md §2.1）
  }
  throw new HttpError(400, '仅允许 HTTPS（loopback 可用 HTTP）')
}

/** UTF-8 fatal 解码：非法序列直接抛错，不用替换字符静默吞掉。 */
export function decodeUtf8Fatal(buf: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(buf)
}

export interface FetchOptions {
  timeoutMs?: number
  maxBytes?: number
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface LimitedResponse {
  status: number
  ok: boolean
  /** 重定向收敛后的最终 URL */
  finalUrl: string
  headers: Headers
  buffer: Buffer
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new HttpError(502, `响应过大: ${declared} > ${maxBytes}`)
  const reader = res.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new HttpError(502, `响应超过上限 ${maxBytes} 字节`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/**
 * 统一安全 fetch：redirect:'manual' + 每跳 assertSafeUrl + 最多 3 跳 + 循环检测 +
 * timeout/外部 signal 合并 + body cap。HEAD 不读 body。
 */
export async function fetchLimited(url: string, opts: FetchOptions & { method?: 'GET' | 'HEAD' } = {}): Promise<LimitedResponse> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = opts.signal ? AbortSignal.any([timeoutSignal, opts.signal]) : timeoutSignal
  let current = assertSafeUrl(url)
  const seen = new Set<string>([current.toString()])
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      signal,
      method: opts.method ?? 'GET',
      headers: { 'user-agent': USER_AGENT, ...opts.headers },
    })
    if (REDIRECT_STATUSES.has(res.status)) {
      await res.body?.cancel().catch(() => undefined)
      if (hop >= MAX_REDIRECTS) throw new HttpError(502, `重定向超过 ${MAX_REDIRECTS} 跳`)
      const location = res.headers.get('location')
      if (!location) throw new HttpError(502, '重定向缺少 Location')
      let next: URL
      try {
        next = new URL(location, current)
      } catch {
        throw new HttpError(502, '重定向 Location 无效')
      }
      assertSafeUrl(next.toString())
      const key = next.toString()
      if (seen.has(key)) throw new HttpError(502, '检测到重定向循环')
      seen.add(key)
      current = next
      continue
    }
    const buffer = opts.method === 'HEAD' ? Buffer.alloc(0) : await readCapped(res, opts.maxBytes ?? MAX_DEFAULT)
    return { status: res.status, ok: res.ok, finalUrl: current.toString(), headers: res.headers, buffer }
  }
}

export interface FetchJsonMeta<T> {
  data: T
  finalUrl: string
}

export async function fetchJsonLimitedMeta<T = unknown>(url: string, opts: FetchOptions = {}): Promise<FetchJsonMeta<T>> {
  const res = await fetchLimited(url, {
    ...opts,
    headers: { accept: 'application/json', ...opts.headers },
  })
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`)
  let text: string
  try {
    text = decodeUtf8Fatal(res.buffer)
  } catch {
    throw new HttpError(502, '响应不是合法 UTF-8')
  }
  try {
    return { data: JSON.parse(text) as T, finalUrl: res.finalUrl }
  } catch {
    throw new HttpError(502, '响应不是合法 JSON')
  }
}

/** 旧契约兼容：只返回解析后的 JSON。 */
export async function fetchJsonLimited<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  return (await fetchJsonLimitedMeta<T>(url, opts)).data
}

export async function fetchTextLimited(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await fetchLimited(url, opts)
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`)
  try {
    return decodeUtf8Fatal(res.buffer)
  } catch {
    throw new HttpError(502, '响应不是合法 UTF-8')
  }
}

/** 可达性探测（icon/homepage 诊断用）：2xx 即可达；HEAD 405 视为可达。 */
export async function isReachable(url: string, timeoutMs = 8000, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetchLimited(url, { method: 'HEAD', timeoutMs, signal })
    return res.ok || res.status === 405
  } catch {
    return false
  }
}
