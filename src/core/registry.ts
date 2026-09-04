/**
 * registry（DESIGN.md §2）：官方 curated registry.json + 单地址自定义覆盖（整体覆盖，不合并）。
 * Task 1 范围：严格 v1 schema、地址解析（RegistryAddress）、状态契约（RegistryState/
 * LoadedRegistry 非 nullable）与 registrySummary。分源 cache / candidate-commit loader
 * 在 Task 2 接管 loadRegistry；当前保留旧 fallback 行为但输出新状态形状。
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { isAbsolute, normalize } from 'node:path'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cacheDir } from './env.js'
import { fetchJsonLimited, type HttpError } from './httpx.js'

export const CATEGORIES = ['market', 'tools', 'ui', 'search', 'media', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

/** 容量上限：2 MiB 是原始 UTF-8 bytes（不是字符数）；条目超限拒绝整份清单。 */
export const MAX_REGISTRY_BYTES = 2 * 1024 * 1024
export const MAX_PLUGINS = 1000

const MAX_ID = 64
const MAX_NAME = 100
const MAX_DESCRIPTION = 500
const MAX_TAGS = 10
const MAX_TAG = 30
const MAX_NPM = 214
const MAX_URL = 2048
const GITHUB_OWNER_MAX = 39
const GITHUB_REPO_MAX = 100
const GITHUB_PATH_MAX = GITHUB_OWNER_MAX + 1 + GITHUB_REPO_MAX

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/
const NPM_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const GITHUB_RE = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/
const CONTROL_RE = /[\u0000-\u001f\u007f]/
/** 已知凭据 query key：registry URL 一律拒绝（大小写不敏感）。 */
const CREDENTIAL_QUERY_KEYS = new Set(['token', 'access_token', 'api_key', 'password', 'secret'])
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export interface RegistryEntry {
  id: string
  name: string
  description: string
  category: Category
  tags: string[]
  source: 'npm' | 'github'
  npm?: string
  github?: string
  homepage?: string
  icon?: string
}

export interface Registry {
  version: 1
  plugins: RegistryEntry[]
}

// ---------- 地址与状态契约 ----------

export type RegistryAddressKind = 'default' | 'url' | 'file'

export interface RegistryAddress {
  kind: RegistryAddressKind
  input: string
  /** default 为 ''；URL 为规范化 URL（去 fragment 留 query）；file 为规范化绝对路径 */
  normalized: string
  /** default 固定 'default'；url/file 带算法版本的稳定 key（文件系统安全） */
  cacheKey: string
}

export type RegistrySource =
  | 'default-raw'
  | 'default-jsdelivr'
  | 'default-cache'
  | 'bundled'
  | 'custom-url'
  | 'custom-file'
  | 'custom-cache'
  | 'custom-unavailable'

export type RegistryStatus = 'ready' | 'stale' | 'unavailable'
export type RegistryCacheNamespace = 'host' | 'cli'
export type RegistryConfigPhase = 'loading' | 'ready' | 'pending' | 'rejected' | 'unavailable'

export interface RegistryState {
  /** '' 表示默认清单；描述 active registry 的配置地址 */
  configuredAddress: string
  activeAddress: string | null
  /** 只描述真实 active registry 来源（config phase 由 registry-controller 表达） */
  source: RegistrySource
  /** 只描述真实 active registry 状态 */
  status: RegistryStatus
  isDefault: boolean
  stale: boolean
  fetchedAt: string | null
  errors: string[]
  count: number
}

export interface RegistrySummary {
  isDefault: boolean
  status: RegistryStatus
  stale: boolean
}

/** registry 始终非 nullable：不可用时返回 { version: 1, plugins: [] } + status 'unavailable'。 */
export interface LoadedRegistry extends RegistryState {
  registry: Registry
}

export interface RegistryConfig {
  registryUrl?: string
  timeoutMs?: number
  cacheTtlMin?: number
}

export function registrySummary(loaded: LoadedRegistry): RegistrySummary {
  return { isDefault: loaded.isDefault, status: loaded.status, stale: loaded.stale }
}

// ---------- 地址解析 ----------

const CACHE_KEY_VERSION = 'r1'

function stableKey(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 32)
  return `${CACHE_KEY_VERSION}-${hash}`
}

function normalizeLocalPath(raw: string): string {
  const p = normalize(raw)
  if (!isAbsolute(p)) throw new Error('本地 registry 必须是绝对路径或 file:// URL')
  if (p.endsWith('/')) throw new Error('本地 registry 不能指向目录')
  return p
}

function parseFileUrl(input: string): RegistryAddress {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('无效的 file:// registry 地址')
  }
  if (url.protocol !== 'file:') throw new Error('file registry 地址只支持 file:// 协议')
  if (url.host !== '') throw new Error('file:// registry 地址不允许携带 host')
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    throw new Error('file:// registry 路径百分号编码无效')
  }
  if (CONTROL_RE.test(pathname)) throw new Error('registry 路径包含控制字符')
  const normalized = normalizeLocalPath(pathname)
  return { kind: 'file', input, normalized, cacheKey: stableKey(`file:${normalized}`) }
}

function parseHttpUrl(input: string): RegistryAddress {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('registry 地址不是合法 URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('registry 远程地址只允许 HTTPS（loopback 可用 HTTP）')
  }
  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(hostname)) {
    throw new Error('HTTP registry 只允许 loopback（127.0.0.1 / localhost / ::1）；外网请使用 HTTPS')
  }
  if (url.username || url.password) throw new Error('registry URL 不允许携带 userinfo')
  for (const key of url.searchParams.keys()) {
    if (CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())) {
      throw new Error(`registry URL 查询参数不允许携带凭据字段（${key}）`)
    }
  }
  url.hash = ''
  const normalized = url.toString()
  return { kind: 'url', input, normalized, cacheKey: stableKey(`url:${normalized}`) }
}

export function parseRegistryAddress(raw: string | undefined): RegistryAddress {
  const input = typeof raw === 'string' ? raw.trim() : ''
  if (input === '') return { kind: 'default', input: '', normalized: '', cacheKey: 'default' }
  if (CONTROL_RE.test(input)) throw new Error('registry 地址包含控制字符')
  if (/^file:/i.test(input)) return parseFileUrl(input)
  if (input.startsWith('/')) {
    const normalized = normalizeLocalPath(input)
    return { kind: 'file', input, normalized, cacheKey: stableKey(`file:${normalized}`) }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return parseHttpUrl(input)
  throw new Error('registry 地址必须是 HTTPS URL、loopback HTTP URL、绝对路径或 file:// 路径')
}

// ---------- 严格 v1 校验 ----------

const TOP_LEVEL_KEYS = new Set(['version', 'plugins'])
const ENTRY_KEYS = new Set(['id', 'name', 'description', 'category', 'tags', 'source', 'npm', 'github', 'homepage', 'icon'])

function httpsUrlError(raw: string): string | null {
  if (raw.length > MAX_URL) return `超过 ${MAX_URL} 字符`
  if (CONTROL_RE.test(raw)) return '包含控制字符'
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return '不是合法 URL'
  }
  if (url.protocol !== 'https:') return '只允许 HTTPS'
  if (url.username || url.password) return '不允许 userinfo'
  return null
}

export function validateRegistry(raw: unknown): { ok: boolean; errors: string[]; registry: Registry | null } {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['registry 根必须是对象'], registry: null }
  }
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`${key}: 未知字段（顶层只允许 version/plugins）`)
  }
  if (obj.version !== 1) errors.push('version: 必须为 1')
  if (!Array.isArray(obj.plugins)) {
    errors.push('plugins: 必须是数组')
    return { ok: false, errors, registry: null }
  }
  if (obj.plugins.length > MAX_PLUGINS) {
    errors.push(`plugins: ${obj.plugins.length} 条超过上限 ${MAX_PLUGINS}，拒绝整份清单`)
    return { ok: false, errors, registry: null }
  }

  const plugins: RegistryEntry[] = []
  const seen = new Set<string>()
  obj.plugins.forEach((item, index) => {
    const where = `plugins[${index}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${where}: 必须是对象`)
      return
    }
    const e = item as Record<string, unknown>
    for (const key of Object.keys(e)) {
      if (!ENTRY_KEYS.has(key)) errors.push(`${where}.${key}: 未知字段`)
    }

    const id = typeof e.id === 'string' ? e.id.trim() : ''
    if (id === '') errors.push(`${where}.id: 必填`)
    else if (id.length > MAX_ID) errors.push(`${where}.id: 超过 ${MAX_ID} 字符`)
    else if (!ID_RE.test(id)) errors.push(`${where}.id: 须小写字母/数字开头，只含小写字母、数字、.、_、-`)
    else if (seen.has(id)) errors.push(`${where}.id: 重复 ${id}`)
    else seen.add(id)

    const name = typeof e.name === 'string' ? e.name.trim() : ''
    if (name === '') errors.push(`${where}.name: 必填`)
    else if (name.length > MAX_NAME) errors.push(`${where}.name: 超过 ${MAX_NAME} 字符`)

    const description = typeof e.description === 'string' ? e.description.trim() : ''
    if (description === '') errors.push(`${where}.description: 必填`)
    else if (description.length > MAX_DESCRIPTION) errors.push(`${where}.description: 超过 ${MAX_DESCRIPTION} 字符`)

    const category = e.category
    const categoryOk = typeof category === 'string' && (CATEGORIES as readonly string[]).includes(category)
    if (!categoryOk) errors.push(`${where}.category: 无效 ${JSON.stringify(category ?? null)}`)

    let tags: string[] = []
    if (!Array.isArray(e.tags)) {
      errors.push(`${where}.tags: 必须是字符串数组`)
    } else {
      if (e.tags.length > MAX_TAGS) errors.push(`${where}.tags: 超过 ${MAX_TAGS} 个`)
      const seenTags = new Set<string>()
      e.tags.forEach((t, ti) => {
        const ts = typeof t === 'string' ? t.trim() : ''
        if (ts === '') errors.push(`${where}.tags[${ti}]: 必须是非空字符串`)
        else if (ts.length > MAX_TAG) errors.push(`${where}.tags[${ti}]: 超过 ${MAX_TAG} 字符`)
        else if (seenTags.has(ts)) errors.push(`${where}.tags[${ti}]: 重复 ${ts}`)
        else {
          seenTags.add(ts)
          tags = [...tags, ts]
        }
      })
    }

    const source = e.source
    const sourceOk = source === 'npm' || source === 'github'
    if (!sourceOk) errors.push(`${where}.source: 必须是 npm 或 github`)

    let entryNpm: string | undefined
    if (e.npm !== undefined) {
      const nv = typeof e.npm === 'string' ? e.npm.trim() : ''
      if (nv === '') errors.push(`${where}.npm: 不能为空字符串`)
      else if (nv.length > MAX_NPM) errors.push(`${where}.npm: 超过 ${MAX_NPM} 字符`)
      else if (!NPM_RE.test(nv)) errors.push(`${where}.npm: 不是合法 npm 包名（不接受版本/range/URL/空白）`)
      else entryNpm = nv
    }

    let entryGithub: string | undefined
    if (e.github !== undefined) {
      const gv = typeof e.github === 'string' ? e.github.trim() : ''
      if (gv === '') errors.push(`${where}.github: 不能为空字符串`)
      else if (gv.length > GITHUB_PATH_MAX) errors.push(`${where}.github: 超过 ${GITHUB_PATH_MAX} 字符（owner ≤39、repo ≤100）`)
      else if (!GITHUB_RE.test(gv)) errors.push(`${where}.github: 必须是 owner/repo`)
      else {
        const [owner = '', repo = ''] = gv.split('/')
        if (owner.length > GITHUB_OWNER_MAX || repo.length > GITHUB_REPO_MAX) {
          errors.push(`${where}.github: owner ≤${GITHUB_OWNER_MAX}、repo ≤${GITHUB_REPO_MAX}`)
        } else entryGithub = gv
      }
    }

    if (source === 'npm' && entryNpm === undefined) errors.push(`${where}.npm: source=npm 必填`)
    if (source === 'github' && entryGithub === undefined) errors.push(`${where}.github: source=github 必填 owner/repo`)

    let entryHomepage: string | undefined
    let entryIcon: string | undefined
    for (const key of ['homepage', 'icon'] as const) {
      const v = e[key]
      if (v === undefined) continue
      const s = typeof v === 'string' ? v.trim() : ''
      const problem = s === '' ? '不能为空字符串' : httpsUrlError(s)
      if (problem) errors.push(`${where}.${key}: ${problem}`)
      else if (key === 'homepage') entryHomepage = s
      else entryIcon = s
    }

    // 错误条目不产生合法输出：整份清单在存在任何错误时返回 null
    plugins.push({
      id,
      name,
      description,
      category: category as Category,
      tags,
      source: source as RegistryEntry['source'],
      ...(entryNpm !== undefined ? { npm: entryNpm } : {}),
      ...(entryGithub !== undefined ? { github: entryGithub } : {}),
      ...(entryHomepage !== undefined ? { homepage: entryHomepage } : {}),
      ...(entryIcon !== undefined ? { icon: entryIcon } : {}),
    })
  })

  return { ok: errors.length === 0, errors, registry: errors.length === 0 ? { version: 1, plugins } : null }
}

// ---------- 包内快照兜底（default 专属，custom 永不使用） ----------

function bundledSnapshot(): Registry {
  const require = createRequire(import.meta.url)
  for (const rel of ['../registry.json', '../../registry.json']) {
    try {
      const raw = require(rel) as unknown
      const parsed = validateRegistry(raw)
      if (parsed.registry) return parsed.registry
    } catch {
      /* try next */
    }
  }
  return { version: 1, plugins: [] }
}

// ---------- 缓存（Task 1 过渡实现；Task 2 替换为 namespace/cacheKey v2 原子 cache） ----------

interface CacheFile {
  fetchedAt: string
  source: RegistrySource
  registry: Registry
}

const KNOWN_SOURCES: ReadonlySet<string> = new Set([
  'default-raw', 'default-jsdelivr', 'default-cache', 'bundled',
  'custom-url', 'custom-file', 'custom-cache', 'custom-unavailable',
])

function cachePath(): string {
  return join(cacheDir(), 'registry.json')
}

function readCache(): CacheFile | null {
  try {
    const raw = JSON.parse(readFileSync(cachePath(), 'utf8')) as CacheFile
    if (!raw || typeof raw !== 'object' || !raw.registry || !Array.isArray(raw.registry.plugins)) return null
    if (typeof raw.fetchedAt !== 'string' || typeof raw.source !== 'string' || !KNOWN_SOURCES.has(raw.source)) return null
    return raw
  } catch {
    return null
  }
}

function writeCache(file: CacheFile): void {
  try {
    mkdirSync(cacheDir(), { recursive: true })
    writeFileSync(cachePath(), JSON.stringify(file, null, 2))
  } catch {
    /* 缓存写失败不致命 */
  }
}

function cacheFresh(file: CacheFile, ttlMin: number): boolean {
  const t = Date.parse(file.fetchedAt || '')
  if (!Number.isFinite(t)) return false
  return Date.now() - t < ttlMin * 60_000
}

// ---------- 加载（Task 1 过渡：旧行为 + 新状态形状；Task 2 重写为分源 loader） ----------

function buildState(params: {
  configuredAddress: string
  activeAddress: string | null
  source: RegistrySource
  status: RegistryStatus
  fetchedAt: string | null
  errors: string[]
  count: number
}): RegistryState {
  return {
    configuredAddress: params.configuredAddress,
    activeAddress: params.activeAddress,
    source: params.source,
    status: params.status,
    isDefault: params.configuredAddress === '',
    stale: params.status !== 'ready',
    fetchedAt: params.fetchedAt,
    errors: params.errors,
    count: params.count,
  }
}

const REPO = 'iasiv5/dsh-m'
// raw 优先：jsDelivr 对 @main 有 CDN 缓存（可 stale 数小时），raw 始终反映 main 最新内容；
// jsDelivr 降为备用线路（可通过 purge.jsdelivr.net 手动清缓存）。
const DEFAULT_URLS: Array<{ source: RegistrySource; url: string }> = [
  { source: 'default-raw', url: `https://raw.githubusercontent.com/${REPO}/main/registry.json` },
  { source: 'default-jsdelivr', url: `https://cdn.jsdelivr.net/gh/${REPO}@main/registry.json` },
]

function cachedLoaded(file: CacheFile, configured: string, errors: string[]): LoadedRegistry {
  return {
    ...buildState({
      configuredAddress: configured,
      activeAddress: null,
      source: configured === '' ? 'default-cache' : 'custom-cache',
      status: 'stale',
      fetchedAt: file.fetchedAt,
      errors,
      count: file.registry.plugins.length,
    }),
    registry: file.registry,
  }
}

export async function loadRegistry(cfg: RegistryConfig = {}, opts: { force?: boolean } = {}): Promise<LoadedRegistry> {
  const errors: string[] = []
  const timeoutMs = cfg.timeoutMs ?? 20_000
  const ttlMin = Math.max(0, cfg.cacheTtlMin ?? 60)
  const configured = typeof cfg.registryUrl === 'string' ? cfg.registryUrl.trim() : ''

  const cached = readCache()

  if (!opts.force && cached && cacheFresh(cached, ttlMin)) return cachedLoaded(cached, configured, errors)

  const candidates: Array<{ source: RegistrySource; url: string }> = []
  if (configured !== '') candidates.push({ source: 'custom-url', url: configured })
  candidates.push(...DEFAULT_URLS)

  for (const candidate of candidates) {
    try {
      const raw = await fetchJsonLimited(candidate.url, { timeoutMs })
      const parsed = validateRegistry(raw)
      if (!parsed.ok || !parsed.registry) {
        errors.push(`${candidate.source}: registry 校验失败 — ${parsed.errors.slice(0, 3).join('; ')}`)
        continue
      }
      const fetchedAt = new Date().toISOString()
      writeCache({ fetchedAt, source: candidate.source, registry: parsed.registry })
      return {
        ...buildState({
          configuredAddress: configured,
          activeAddress: candidate.source === 'custom-url' ? configured : candidate.url,
          source: candidate.source,
          status: 'ready',
          fetchedAt,
          errors,
          count: parsed.registry.plugins.length,
        }),
        registry: parsed.registry,
      }
    } catch (err) {
      const he = err as HttpError
      errors.push(`${candidate.source}: ${he?.status ? `HTTP ${he.status}` : err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (cached) return cachedLoaded(cached, configured, errors)
  const bundled = bundledSnapshot()
  return {
    ...buildState({
      configuredAddress: configured,
      activeAddress: null,
      source: 'bundled',
      status: 'stale',
      fetchedAt: null,
      errors,
      count: bundled.plugins.length,
    }),
    registry: bundled,
  }
}
