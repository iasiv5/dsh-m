/**
 * registry（DESIGN.md §2）：repo 内手工 curated 的 registry.json。
 * 分发顺序：源覆盖 → jsDelivr @main → raw @main → TTL 缓存 → 包内快照兜底。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { cacheDir } from './env.js'
import { fetchJsonLimited, type HttpError } from './httpx.js'

export const CATEGORIES = ['market', 'tools', 'ui', 'search', 'media', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

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

export interface LoadedRegistry {
  registry: Registry
  source: 'override' | 'jsdelivr' | 'raw' | 'cache' | 'bundled'
  fetchedAt: string | null
  /** 尝试过的远端错误（全部失败而回退时用于提示） */
  errors: string[]
}

export interface RegistryConfig {
  registryUrl?: string
  timeoutMs?: number
  cacheTtlMin?: number
}

const REPO = 'iasiv5/dsh-m'
// raw 优先：jsDelivr 对 @main 有 CDN 缓存（可 stale 数小时），raw 始终反映 main 最新内容；
// jsDelivr 降为备用线路（可通过 purge.jsdelivr.net 手动清缓存）。
const DEFAULT_URLS: Array<{ source: LoadedRegistry['source']; url: string }> = [
  { source: 'raw', url: `https://raw.githubusercontent.com/${REPO}/main/registry.json` },
  { source: 'jsdelivr', url: `https://cdn.jsdelivr.net/gh/${REPO}@main/registry.json` },
]

// ---------- 校验 ----------

const GITHUB_RE = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/
const HTTPS_URL_RE = /^https:\/\/\S+$/i

export function validateRegistry(raw: unknown): { ok: boolean; errors: string[]; registry: Registry | null } {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['registry 根必须是对象'], registry: null }
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1) errors.push('version 必须为 1')
  if (!Array.isArray(obj.plugins)) return { ok: false, errors: [...errors, 'plugins 必须是数组'], registry: null }
  const plugins: RegistryEntry[] = []
  const seen = new Set<string>()
  obj.plugins.forEach((item, index) => {
    const where = `plugins[${index}]`
    if (!item || typeof item !== 'object') {
      errors.push(`${where}: 必须是对象`)
      return
    }
    const e = item as Record<string, unknown>
    const id = String(e.id || '').trim()
    if (!id || id.length > 64) return errors.push(`${where}.id 无效`)
    if (seen.has(id)) return errors.push(`${where}.id 重复: ${id}`)
    seen.add(id)
    const category = String(e.category || '')
    if (!CATEGORIES.includes(category as Category)) return errors.push(`${where}.category 无效: ${category}`)
    const source = String(e.source || '')
    if (source !== 'npm' && source !== 'github') return errors.push(`${where}.source 无效: ${source}`)
    const entry: RegistryEntry = {
      id,
      name: String(e.name || id).trim().slice(0, 100),
      description: String(e.description || '').trim().slice(0, 500),
      category: category as Category,
      tags: Array.isArray(e.tags) ? e.tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 10) : [],
      source,
    }
    if (source === 'npm') {
      const npm = String(e.npm || '').trim()
      if (!npm) return errors.push(`${where}.npm 必填（source=npm）`)
      entry.npm = npm
    }
    if (source === 'github') {
      const gh = String(e.github || '').trim()
      if (!GITHUB_RE.test(gh)) return errors.push(`${where}.github 必须是 owner/repo（source=github）`)
      entry.github = gh
    }
    if (e.npm && source !== 'npm') entry.npm = String(e.npm).trim()
    if (e.github && source !== 'github' && GITHUB_RE.test(String(e.github).trim())) entry.github = String(e.github).trim()
    for (const key of ['homepage', 'icon'] as const) {
      const v = e[key]
      if (v === undefined || v === null || v === '') continue
      const s = String(v).trim()
      if (!HTTPS_URL_RE.test(s)) return errors.push(`${where}.${key} 必须是 https URL`)
      entry[key] = s
    }
    plugins.push(entry)
  })
  return { ok: errors.length === 0, errors, registry: errors.length === 0 ? { version: 1, plugins } : null }
}

// ---------- 包内快照兜底 ----------

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

// ---------- 缓存 ----------

interface CacheFile {
  fetchedAt: string
  source: LoadedRegistry['source']
  registry: Registry
}

function cachePath(): string {
  return join(cacheDir(), 'registry.json')
}

function readCache(): CacheFile | null {
  try {
    const raw = JSON.parse(readFileSync(cachePath(), 'utf8')) as CacheFile
    if (!raw || typeof raw !== 'object' || !raw.registry || !Array.isArray(raw.registry.plugins)) return null
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

// ---------- 加载 ----------

export async function loadRegistry(cfg: RegistryConfig = {}, opts: { force?: boolean } = {}): Promise<LoadedRegistry> {
  const errors: string[] = []
  const timeoutMs = cfg.timeoutMs ?? 20_000
  const ttlMin = Math.max(0, cfg.cacheTtlMin ?? 60)

  const cached = readCache()
  if (!opts.force && cached && cacheFresh(cached, ttlMin)) {
    return { registry: cached.registry, source: 'cache', fetchedAt: cached.fetchedAt, errors }
  }

  const candidates: Array<{ source: LoadedRegistry['source']; url: string }> = []
  if (cfg.registryUrl && cfg.registryUrl.trim()) {
    candidates.push({ source: 'override', url: cfg.registryUrl.trim() })
  }
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
      return { registry: parsed.registry, source: candidate.source, fetchedAt, errors }
    } catch (err) {
      const he = err as HttpError
      errors.push(`${candidate.source}: ${he?.status ? `HTTP ${he.status}` : err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (cached) return { registry: cached.registry, source: 'cache', fetchedAt: cached.fetchedAt, errors }
  return { registry: bundledSnapshot(), source: 'bundled', fetchedAt: null, errors }
}
