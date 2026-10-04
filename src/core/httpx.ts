/**
 * 安全基线 §17.1：仅 HTTPS（loopback http 例外）+ 响应大小上限 + 超时 + 手动重定向。
 * 所有 HTTP JSON/text/HEAD 请求共享同一 primitive：每一跳 assertSafeUrl、最多 3 跳、
 * 循环检测、signal 传播、返回最终 URL；registry/homepage/icon 诊断不得另起一套。
 */
import { Buffer } from 'node:buffer'
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch } from 'undici'

export class HttpError extends Error {
  status: number
  /** 非 2xx 响应的 headers（供上层识别限流等场景）；body-cap/协议类错误无 headers */
  headers?: Headers
  constructor(status: number, message: string, headers?: Headers) {
    super(message)
    this.status = status
    this.headers = headers
  }
}

const MAX_DEFAULT = 2 * 1024 * 1024 // 2MB：registry/npm metadata 足够
const MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const USER_AGENT = 'dsh-m (personal marketplace)'

/**
 * L0（ADR-0012）：undici 自带 fetch + 自建 dispatcher——全局 fetch 不吃代理 env
 * 且暴露于宿主 undici 全局 dispatcher 污染（dsh-market net.ts #742 实录）。
 * 代理解析：标准 env 小写优先，npm_config_* 兜底——EnvHttpProxyAgent 自身只读
 * http(s)_proxy，npm 命名空间的代理必须显式交接，否则静默直连而报错却声称走过代理。
 */
export function resolveProxyConfig(): { http: string | null; https: string | null } {
  const pick = (raw: string | undefined): string | null => {
    const value = raw?.trim()
    if (value === undefined || value === '') return null
    return /^[a-z][a-z\d+.-]*:\/\//iu.test(value) ? value : `http://${value}`
  }
  const https = pick(process.env.https_proxy ?? process.env.HTTPS_PROXY) ?? pick(process.env.npm_config_https_proxy)
  const http = pick(process.env.http_proxy ?? process.env.HTTP_PROXY) ?? pick(process.env.npm_config_proxy)
  return { http, https }
}

/** 代理 URL 凭据掩码（via 附着与 describeFetchFailure 共用）。 */
export function maskProxy(url: string): string {
  return url.replace(/\/\/[^@]*@/u, '//***@')
}

let directAgent: Agent | null = null
let proxyAgent: EnvHttpProxyAgent | null = null

/** 仅测试：env 变更后重建单例（单例只为连接复用，不承载语义）。 */
export function resetProxyAgentsForTests(): void {
  directAgent = null
  proxyAgent = null
}

function dispatcherFor(): Agent | EnvHttpProxyAgent {
  const { http, https } = resolveProxyConfig()
  if (http === null && https === null) {
    directAgent ??= new Agent()
    return directAgent
  }
  proxyAgent ??= new EnvHttpProxyAgent({ httpProxy: http ?? undefined, httpsProxy: https ?? undefined })
  return proxyAgent
}

/** wire 层出网引用：默认 undici 包自带 fetch（带 dispatcher）。 */
let wireFetch: (url: URL, init: Parameters<typeof undiciFetch>[1]) => Promise<Response> = (url, init) =>
  undiciFetch(url, init) as unknown as Promise<Response>

/**
 * 仅测试：替换 wire 层 fetch（本仓库既有 mock globalThis.fetch 测试缝隙的迁移口，
 * 首参收字符串 url；传 null 恢复 undici 默认）。生产路径永不调用。
 */
export function _setWireFetchForTests(fn: ((url: string, init?: unknown) => Promise<Response>) | null): void {
  wireFetch = fn
    ? (url, init) => fn(url.toString(), init)
    : (url, init) => undiciFetch(url, init) as unknown as Promise<Response>
}

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
  /** PUT 仅供 sync 原语（ADR-0012 L2）；GET/HEAD 为元数据读。 */
  method?: 'GET' | 'HEAD' | 'PUT'
  /**
   * wire 层钩子（M1 Q46 预算计数点）：每个物理 outbound 请求（含重定向每一跳）发起前调用一次。
   * 抛错（如预算 reserve 拒绝）→ 该跳 fetch 立即中止、错误原样上抛。
   */
  onRequest?: (url: string) => void
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
export async function fetchLimited(url: string, opts: FetchOptions & { method?: 'GET' | 'HEAD' | 'PUT' } = {}): Promise<LimitedResponse> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = opts.signal ? AbortSignal.any([timeoutSignal, opts.signal]) : timeoutSignal
  let current = assertSafeUrl(url)
  const seen = new Set<string>([current.toString()])
  for (let hop = 0; ; hop++) {
    opts.onRequest?.(current.toString())
    let res: Response
    try {
      // 实证（undici 7.30）：redirect:'manual' 返回真实 3xx + Location（type=basic），
      // 现有手动跳循环原样保留；每跳 assertSafeUrl / 上限 / 循环检测不动。
      res = await wireFetch(current, {
        redirect: 'manual',
        signal,
        method: opts.method ?? 'GET',
        headers: { 'user-agent': USER_AGENT, ...opts.headers },
        dispatcher: dispatcherFor(),
      }) as unknown as Response
    } catch (err) {
      if (!(err instanceof HttpError)) {
        const { http, https } = resolveProxyConfig()
        const proxyUrl = https ?? http
        ;(err as Error & { via?: string }).via = proxyUrl === null ? 'direct' : maskProxy(proxyUrl)
      }
      throw err
    }
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
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`, res.headers)
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
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`, res.headers)
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

export interface DescribeFetchFailureInput {
  label: string
  /** 仅用于诊断记录，不进用户可见消息（防本地路径/内部 URL 泄露） */
  url?: string
  err: unknown
  attempts?: number
  elapsedMs?: number
}

/**
 * 拉取失败三要素统一（M2 Task 4）：发生了什么（label + 根因）/ 代价（尝试次数 + 耗时）/ 现在怎么办。
 * 根因分类：AbortError=「请求被取消」；TimeoutError/超时=「请求超时」；message 形如 `HTTP <n>`
 * 才映射状态码；其余保留安全化根因（不吞协议错误细节）。
 */
export function describeFetchFailure({ label, err, attempts, elapsedMs }: DescribeFetchFailureInput): string {
  let reason: string
  if (err instanceof Error && err.name === 'AbortError') {
    reason = '请求被取消'
  } else if (err instanceof Error && (err.name === 'TimeoutError' || /timed?\s?out|超时/i.test(err.message))) {
    reason = '请求超时'
  } else if (err instanceof HttpError || (err instanceof Error && /^HTTP \d{3}/.test(err.message))) {
    reason = err instanceof Error ? err.message : String(err)
  } else if (err instanceof Error) {
    reason = err.message
  } else {
    reason = String(err)
  }
  // L4（ADR-0012）：仅代理路径渲染「（经 …）」；direct/缺失不渲染（无代理机器零噪音）。
  const via = err instanceof Error && typeof (err as Error & { via?: unknown }).via === 'string'
    ? (err as Error & { via: string }).via
    : null
  const viaText = via && via !== 'direct' ? `（经 ${maskProxy(via)}）` : ''
  const cost: string[] = []
  if (typeof attempts === 'number' && attempts > 0) cost.push(`${attempts} 次尝试`)
  if (typeof elapsedMs === 'number' && elapsedMs > 0) cost.push(`耗时 ${(elapsedMs / 1000).toFixed(1)}s`)
  const costText = cost.length > 0 ? `（${cost.join('，')}）` : ''
  return `${label} 失败：${reason}${viaText}${costText}；可稍后重试或检查网络后重试`
}

/** 字节下载（社区目录正文用）：非 2xx 抛 HttpError；bytes = 完整响应体。 */
export async function fetchBytesLimited(
  url: string,
  opts: FetchOptions = {},
): Promise<{ bytes: Buffer; finalUrl: string }> {
  const res = await fetchLimited(url, opts)
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`, res.headers)
  return { bytes: res.buffer, finalUrl: res.finalUrl }
}
