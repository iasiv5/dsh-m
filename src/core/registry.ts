/**
 * registry（DESIGN.md §2）：官方 curated registry.json + 单地址自定义覆盖（整体覆盖，不合并）。
 * Task 1：严格 v1 schema、地址解析、状态契约。Task 2：分源 loader、namespace/cacheKey v2
 * 原子 cache、fd 级本地读取、candidate 与 active prune 分离、commitActiveSource。
 */
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { isAbsolute, join, normalize } from 'node:path'
import { constants as fsConstants, mkdirSync, readFileSync } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { cacheDir } from './env.js'
import { decodeUtf8Fatal, fetchJsonLimitedMeta, type HttpError } from './httpx.js'

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

export function registrySummary(state: RegistryState): RegistrySummary {
  return { isDefault: state.isDefault, status: state.status, stale: state.stale }
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

// ---------- 本地文件 fd 读取（TOCTOU 防护 + 实时 2 MiB cap） ----------

export interface ReadRegistryFileHooks {
  /** 测试注入点：首次 fstat 之后、读取之前触发（模拟 stat 后文件增长/替换） */
  afterStat?: () => Promise<void> | void
}

export async function readRegistryFile(path: string, hooks: ReadRegistryFileHooks = {}): Promise<Buffer> {
  const real = await realpath(path)
  // realpath 之后仍可能被换成 symlink：O_NOFOLLOW 在最终路径上兜底
  const fh = await open(real, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  try {
    const st = await fh.stat()
    if (!st.isFile()) throw new Error('本地 registry 不是普通文件')
    if (st.size > MAX_REGISTRY_BYTES) throw new Error(`本地 registry 超过 ${MAX_REGISTRY_BYTES} 字节上限`)
    await hooks.afterStat?.()
    const chunks: Buffer[] = []
    let total = 0
    const buf = Buffer.alloc(64 * 1024)
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > MAX_REGISTRY_BYTES) throw new Error(`本地 registry 读取超过 ${MAX_REGISTRY_BYTES} 字节上限`)
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)))
    }
    const st2 = await fh.stat()
    if (!st2.isFile() || st2.ino !== st.ino || st2.size !== total) {
      throw new Error('本地 registry 读取期间发生变化，已拒绝本次内容')
    }
    return Buffer.concat(chunks)
  } finally {
    await fh.close().catch(() => undefined)
  }
}

// ---------- namespace / cacheKey v2 原子 cache ----------

export interface CacheFile {
  version: 2
  namespace: RegistryCacheNamespace
  cacheKey: string
  configuredAddress: string
  activeAddress: string | null
  source: RegistrySource
  fetchedAt: string
  registry: Registry
}

interface AcceptedSourceMetadata {
  version: 1
  namespace: 'host'
  configuredAddress: string
  cacheKey: string
  savedAt: string
}

const CACHE_FILE_VERSION = 2
const DEFAULT_CACHE_KEY = 'default'
const ACTIVE_SOURCE_FILE = 'active-source.json'

function nsDir(namespace: RegistryCacheNamespace): string {
  return join(cacheDir(), namespace)
}

function cacheFilePath(namespace: RegistryCacheNamespace, cacheKey: string): string {
  return join(nsDir(namespace), `${cacheKey}.json`)
}

function cacheDirSyncMode(): void {
  mkdirSync(cacheDir(), { recursive: true, mode: 0o700 })
}

/** 同 key 写锁：进程内串行化同一 cache 文件的写入。 */
const writeLocks = new Map<string, Promise<unknown>>()

function withKeyLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve()
  const next = prev.then(task, task)
  const tail = next.catch(() => undefined)
  writeLocks.set(key, tail)
  void tail.finally(() => {
    if (writeLocks.get(key) === tail) writeLocks.delete(key)
  })
  return next
}

/** 原子写：0600 临时文件（O_CREAT|O_EXCL）→ fsync → rename。目标为 symlink 时拒绝。 */
async function atomicWriteJson(target: string, dir: string, value: unknown): Promise<boolean> {
  return withKeyLock(target, async () => {
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      cacheDirSyncMode()
      let existing: Awaited<ReturnType<typeof lstat>> | null = null
      try {
        existing = await lstat(target)
      } catch {
        /* not exists */
      }
      if (existing && existing.isSymbolicLink()) return false
      const tmp = join(dir, `.${target.split('/').pop() ?? 'cache'}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`)
      const fh = await open(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600)
      try {
        await fh.write(Buffer.from(JSON.stringify(value, null, 2), 'utf8'))
        await fh.sync()
      } finally {
        await fh.close().catch(() => undefined)
      }
      await rename(tmp, target)
      return true
    } catch {
      return false
    }
  })
}

async function writeCacheFile(file: CacheFile): Promise<boolean> {
  return atomicWriteJson(cacheFilePath(file.namespace, file.cacheKey), nsDir(file.namespace), file)
}

async function readCacheFile(namespace: RegistryCacheNamespace, cacheKey: string): Promise<CacheFile | null> {
  try {
    const raw = JSON.parse(await readFile(cacheFilePath(namespace, cacheKey), 'utf8')) as CacheFile | null
    if (!raw || typeof raw !== 'object') return null
    if (raw.version !== CACHE_FILE_VERSION || raw.namespace !== namespace || raw.cacheKey !== cacheKey) return null
    if (typeof raw.fetchedAt !== 'string' || !raw.registry || !Array.isArray(raw.registry.plugins)) return null
    const re = validateRegistry(raw.registry)
    if (!re.ok || !re.registry) return null
    return { ...raw, registry: re.registry }
  } catch {
    return null
  }
}

function cacheFresh(file: CacheFile, ttlMin: number): boolean {
  const t = Date.parse(file.fetchedAt || '')
  if (!Number.isFinite(t)) return false
  return Date.now() - t < ttlMin * 60_000
}

/** 清理 namespace 内非 default、非当前 custom 的 cache 文件（不动 metadata）。 */
async function pruneCaches(namespace: RegistryCacheNamespace, keepCustomKey: string | null): Promise<boolean> {
  try {
    const dir = nsDir(namespace)
    const entries = await readdir(dir).catch(() => [] as string[])
    const keep = new Set([`${DEFAULT_CACHE_KEY}.json`, ACTIVE_SOURCE_FILE])
    if (keepCustomKey) keep.add(`${keepCustomKey}.json`)
    for (const name of entries) {
      if (keep.has(name) || !name.endsWith('.json')) continue
      await rm(join(dir, name), { force: true }).catch(() => {
        throw new Error(`无法删除 ${name}`)
      })
    }
    return true
  } catch {
    return false
  }
}

export interface ActiveSourceCommitResult {
  metadataCommitted: boolean
  pruned: boolean
  warning: string | null
}

/**
 * settings update 成功后由 controller 调用：先写 accepted metadata（仅 host namespace），
 * 再 prune 非当前 custom cache。metadata 失败 → 不 prune；prune 失败 → 保留旧 cache；
 * 都只返回 warning，不反向撤销已成功的 settings update。
 */
export async function commitActiveSource(
  address: RegistryAddress,
  namespace: RegistryCacheNamespace,
): Promise<ActiveSourceCommitResult> {
  let metadataCommitted = true
  if (namespace === 'host') {
    const meta: AcceptedSourceMetadata = {
      version: 1,
      namespace: 'host',
      configuredAddress: address.normalized,
      cacheKey: address.cacheKey,
      savedAt: new Date().toISOString(),
    }
    metadataCommitted = await atomicWriteJson(join(nsDir('host'), ACTIVE_SOURCE_FILE), nsDir('host'), meta)
  }
  if (!metadataCommitted) {
    return { metadataCommitted: false, pruned: false, warning: 'accepted-source 元数据写入失败，已跳过旧 cache 清理（新配置仍生效）' }
  }
  const pruned = await pruneCaches(namespace, address.kind === 'default' ? null : address.cacheKey)
  if (!pruned) {
    return { metadataCommitted: true, pruned: false, warning: '旧来源 cache 清理失败（不影响新配置生效）' }
  }
  return { metadataCommitted: true, pruned: true, warning: null }
}

// ---------- 加载 ----------

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
    stale: params.status === 'stale',
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

export interface RegistryLoadOptions {
  force?: boolean
  signal?: AbortSignal
  namespace?: RegistryCacheNamespace
  prune?: boolean
  deadlineMs?: number
}

function attemptTimeoutMs(cfg: RegistryConfig, opts: RegistryLoadOptions, startedAt: number): number {
  const per = cfg.timeoutMs ?? 20_000
  if (!opts.deadlineMs || !Number.isFinite(opts.deadlineMs)) return per
  const remaining = opts.deadlineMs - (Date.now() - startedAt)
  return Math.max(1, Math.min(per, remaining))
}

function errorMessage(err: unknown): string {
  const he = err as HttpError
  if (he && typeof he.status === 'number') return `HTTP ${he.status}`
  return err instanceof Error ? err.message : String(err)
}

async function fetchRegistryFromUrl(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ registry: Registry; finalUrl: string }> {
  const { data, finalUrl } = await fetchJsonLimitedMeta(url, { timeoutMs, maxBytes: MAX_REGISTRY_BYTES, signal })
  const parsed = validateRegistry(data)
  if (!parsed.ok || !parsed.registry) {
    throw new Error(`registry 校验失败 — ${parsed.errors.slice(0, 3).join('; ')}`)
  }
  return { registry: parsed.registry, finalUrl }
}

async function readRegistryFromPath(path: string): Promise<Registry> {
  const buf = await readRegistryFile(path)
  let data: unknown
  try {
    data = JSON.parse(decodeUtf8Fatal(buf))
  } catch (err) {
    throw new Error(err instanceof Error && /UTF-8|decode/i.test(err.message) ? '本地 registry 不是合法 UTF-8' : '本地 registry 不是合法 JSON')
  }
  const parsed = validateRegistry(data)
  if (!parsed.ok || !parsed.registry) {
    throw new Error(`registry 校验失败 — ${parsed.errors.slice(0, 3).join('; ')}`)
  }
  return parsed.registry
}

function loadedFromCacheFile(file: CacheFile, configuredAddress: string, errors: string[]): LoadedRegistry {
  // cache 命中是“stale 供应”：source 报告 cache 来源，而不是当初抓取用的 raw/jsdelivr/url/file
  const source: RegistrySource = file.source.startsWith('custom') ? 'custom-cache' : 'default-cache'
  return {
    ...buildState({
      configuredAddress,
      activeAddress: file.activeAddress,
      source,
      status: 'stale',
      fetchedAt: file.fetchedAt,
      errors,
      count: file.registry.plugins.length,
    }),
    registry: file.registry,
  }
}

interface DefaultChainOptions {
  namespace: RegistryCacheNamespace
  includeBundled: boolean
}

/** default 链：raw → jsDelivr → default cache →（可选）bundled。从不 prune。 */
async function loadDefaultChain(
  cfg: RegistryConfig,
  opts: RegistryLoadOptions,
  chain: DefaultChainOptions,
): Promise<LoadedRegistry> {
  const errors: string[] = []
  const startedAt = Date.now()
  for (const candidate of DEFAULT_URLS) {
    try {
      const { registry, finalUrl } = await fetchRegistryFromUrl(candidate.url, attemptTimeoutMs(cfg, opts, startedAt), opts.signal)
      const fetchedAt = new Date().toISOString()
      await writeCacheFile({
        version: CACHE_FILE_VERSION,
        namespace: chain.namespace,
        cacheKey: DEFAULT_CACHE_KEY,
        configuredAddress: '',
        activeAddress: finalUrl,
        source: candidate.source,
        fetchedAt,
        registry,
      })
      return {
        ...buildState({
          configuredAddress: '',
          activeAddress: finalUrl,
          source: candidate.source,
          status: 'ready',
          fetchedAt,
          errors,
          count: registry.plugins.length,
        }),
        registry,
      }
    } catch (err) {
      errors.push(`${candidate.source}: ${errorMessage(err)}`)
    }
  }
  const cached = await readCacheFile(chain.namespace, DEFAULT_CACHE_KEY)
  if (cached) return loadedFromCacheFile(cached, '', errors)
  if (chain.includeBundled) {
    const bundled = bundledSnapshot()
    return {
      ...buildState({
        configuredAddress: '',
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
  return {
    ...buildState({
      configuredAddress: '',
      activeAddress: null,
      source: 'bundled',
      status: 'unavailable',
      fetchedAt: null,
      errors,
      count: 0,
    }),
    registry: { version: 1, plugins: [] },
  }
}

interface CustomChainOptions {
  namespace: RegistryCacheNamespace
  /** 失败时是否回退当前 source 的 cache（candidate 与 active 都允许，只是 stale 语义） */
  allowCacheFallback: boolean
}

/** custom 链：只尝试该 source 自身，失败只读同 sourceKey cache；没有数据 → unavailable。 */
async function loadCustomChain(
  address: RegistryAddress,
  cfg: RegistryConfig,
  opts: RegistryLoadOptions,
  chain: CustomChainOptions,
): Promise<LoadedRegistry> {
  const errors: string[] = []
  const source: RegistrySource = address.kind === 'url' ? 'custom-url' : 'custom-file'
  const startedAt = Date.now()
  try {
    const result =
      address.kind === 'url'
        ? await fetchRegistryFromUrl(address.normalized, attemptTimeoutMs(cfg, opts, startedAt), opts.signal)
        : { registry: await readRegistryFromPath(address.normalized), finalUrl: address.normalized }
    const fetchedAt = new Date().toISOString()
    await writeCacheFile({
      version: CACHE_FILE_VERSION,
      namespace: chain.namespace,
      cacheKey: address.cacheKey,
      configuredAddress: address.normalized,
      activeAddress: result.finalUrl,
      source,
      fetchedAt,
      registry: result.registry,
    })
    return {
      ...buildState({
        configuredAddress: address.normalized,
        activeAddress: result.finalUrl,
        source,
        status: 'ready',
        fetchedAt,
        errors,
        count: result.registry.plugins.length,
      }),
      registry: result.registry,
    }
  } catch (err) {
    errors.push(`${source}: ${errorMessage(err)}`)
  }
  if (chain.allowCacheFallback) {
    const cached = await readCacheFile(chain.namespace, address.cacheKey)
    if (cached) return loadedFromCacheFile(cached, address.normalized, errors)
  }
  return {
    ...buildState({
      configuredAddress: address.normalized,
      activeAddress: null,
      source: 'custom-unavailable',
      status: 'unavailable',
      fetchedAt: null,
      errors,
      count: 0,
    }),
    registry: { version: 1, plugins: [] },
  }
}

/** active 读取：default/custom 各自 fallback；网络成功后可在本 namespace 内 prune。 */
export async function loadRegistry(cfg: RegistryConfig = {}, opts: RegistryLoadOptions = {}): Promise<LoadedRegistry> {
  const namespace = opts.namespace ?? 'host'
  const address = parseRegistryAddress(cfg.registryUrl)
  const ttlMin = Math.max(0, cfg.cacheTtlMin ?? 60)
  if (!opts.force) {
    const cacheKey = address.kind === 'default' ? DEFAULT_CACHE_KEY : address.cacheKey
    const cached = await readCacheFile(namespace, cacheKey)
    if (cached && cacheFresh(cached, ttlMin)) return loadedFromCacheFile(cached, address.normalized, [])
  }
  if (address.kind === 'default') {
    const loaded = await loadDefaultChain(cfg, opts, { namespace, includeBundled: true })
    if (opts.prune !== false && loaded.status === 'ready') await pruneCaches(namespace, null)
    return loaded
  }
  const loaded = await loadCustomChain(address, cfg, opts, { namespace, allowCacheFallback: true })
  if (opts.prune !== false && loaded.status === 'ready') await pruneCaches(namespace, address.cacheKey)
  return loaded
}

/** candidate 读取：apply 前校验专用。只写候选 cache、绝不 prune；default 不落 bundled。 */
export async function loadRegistryCandidate(
  cfg: RegistryConfig,
  opts: Omit<RegistryLoadOptions, 'prune'> = {},
): Promise<LoadedRegistry> {
  const namespace = opts.namespace ?? 'host'
  const address = parseRegistryAddress(cfg.registryUrl)
  if (address.kind === 'default') {
    return loadDefaultChain(cfg, opts, { namespace, includeBundled: false })
  }
  return loadCustomChain(address, cfg, opts, { namespace, allowCacheFallback: true })
}

/** default 显式加载（下载/主动刷新）。写 default cache，从不 prune。 */
export async function loadDefaultRegistry(cfg: RegistryConfig = {}, opts: RegistryLoadOptions = {}): Promise<LoadedRegistry> {
  const namespace = opts.namespace ?? 'host'
  const ttlMin = Math.max(0, cfg.cacheTtlMin ?? 60)
  if (!opts.force) {
    const cached = await readCacheFile(namespace, DEFAULT_CACHE_KEY)
    if (cached && cacheFresh(cached, ttlMin)) return loadedFromCacheFile(cached, '', [])
  }
  return loadDefaultChain(cfg, opts, { namespace, includeBundled: true })
}
