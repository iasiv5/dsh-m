/**
 * 安全基线 §17.1：仅 HTTPS（loopback http 例外）+ 响应大小上限 + 超时。
 * skillhub 的缺口（无统一体积上限）在这里补齐。
 */

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const MAX_DEFAULT = 2 * 1024 * 1024 // 2MB：registry/npm metadata 足够

export function assertSafeUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new HttpError(400, `无效 URL: ${raw}`)
  }
  if (url.protocol === 'https:') return url
  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    return url // 本地 registry 覆盖调试用（DESIGN.md §2.1）
  }
  throw new HttpError(400, `仅允许 HTTPS: ${raw}`)
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

export interface FetchOptions {
  timeoutMs?: number
  maxBytes?: number
  headers?: Record<string, string>
}

export async function fetchJsonLimited<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  assertSafeUrl(url)
  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    headers: { accept: 'application/json', 'user-agent': 'dsh-m (personal marketplace)', ...opts.headers },
    redirect: 'follow',
  })
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}: ${url}`)
  const buf = await readCapped(res, opts.maxBytes ?? MAX_DEFAULT)
  try {
    return JSON.parse(buf.toString('utf8')) as T
  } catch (err) {
    throw new HttpError(502, `响应不是合法 JSON: ${url}`)
  }
}

export async function fetchTextLimited(url: string, opts: FetchOptions = {}): Promise<string> {
  assertSafeUrl(url)
  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    headers: { 'user-agent': 'dsh-m (personal marketplace)', ...opts.headers },
    redirect: 'follow',
  })
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}: ${url}`)
  const buf = await readCapped(res, opts.maxBytes ?? MAX_DEFAULT)
  return buf.toString('utf8')
}

/** 可达性探测（icon/homepage 校验用）：2xx 即可达。 */
export async function isReachable(url: string, timeoutMs = 8000): Promise<boolean> {
  try {
    assertSafeUrl(url)
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'dsh-m (personal marketplace)' },
      redirect: 'follow',
    })
    return res.ok || res.status === 405 // 有的站点拒绝 HEAD，视为可达
  } catch {
    return false
  }
}
