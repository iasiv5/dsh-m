/**
 * 目录适配层（M1 Task 4 / DESIGN.md §2.5「目录适配层」/ Q40 / Q43）：
 * 原生条目（宽松校验的字段袋）→ 收录条目 CommunityEntry。
 * 条目层宽松语义（Q43）：单条不合格跳过 + 计数（skippedDirty / skippedSubpathNoNpm），不整份拒绝。
 * id 合成：小写 `owner--name`，非法字符折叠为 `-`，超 64 截断加哈希尾缀，适配层内冲突追加序号。
 * 旁路字段（stars/downloads/capabilities/capabilityRedLines/screenshots）不进 RegistryEntry
 * 本体，仅随 CommunityEntry 透传、由市场层展示（Q44：卡片不打标，详情折叠区才展示）。
 */
import { createHash } from 'node:crypto'
import type { RegistryEntry } from './registry.js'
import type { CommunityCatalog, CommunityRawEntry } from './community.js'

/** 与主清单 v1 同款约束（registry.ts MAX_ID / ID_RE / NPM_RE / GITHUB_RE 同语义，锚定不漂移）。 */
const MAX_ID = 64
const MAX_DESCRIPTION = 500
const ID_ILLEGAL_RE = /[^a-z0-9._-]+/g
const ID_LEADING_ILLEGAL_RE = /^[._-]+/
const NPM_SHAPE_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const GITHUB_SHAPE_RE = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/
/** 社区开放分类的安全 slug（计划 Task 4 契约；原生值保留不转译，Q40）。 */
const COMMUNITY_CATEGORY_RE = /^[a-z0-9-]{1,32}$/
const HASH_SUFFIX_LEN = 8
const TRUNCATED_BODY_LEN = MAX_ID - (HASH_SUFFIX_LEN + 1)

/** 收录条目：category 为开放集 string（不收窄到精选 5）；附市场层旁路字段（全量给缺省，消费端免判缺）。 */
export interface CommunityEntry extends Omit<RegistryEntry, 'category'> {
  category: string
  stars: number | null
  downloads: number | null
  capabilities: string[]
  capabilityRedLines: string[]
  screenshots: string[]
  /** 英文描述原文（Q45「搜索同时匹配中英文」：zh 收录后搜索仍要命中英文；zh 回退 en 时与 description 同文） */
  descriptionEn: string
  /** 0.7.0 Task 1 bypass 扩展：作者（适配必填字段，直达条目本体供 byline 使用——此前仅用于 id 合成） */
  owner: string
  /** 0.7.0 Task 1 bypass 扩展（全部 truthy 透传、缺失不产生键；deprecated 仅布尔 true；
   * version 仅非空字符串（null = github-only 无目录版本），只作展示兜底（带「目录快照」标注），不参与 outdated 判定）。 */
  added?: string
  deprecated?: true
  replacement?: string
  install?: string
  downloadsStart?: string
  downloadsEnd?: string
  downloadsCheckedAt?: string
  version?: string
}

export interface AdaptCommunityResult {
  entries: CommunityEntry[]
  /** 聚合 warning（每类一条，含计数）；空数组 = 无可报告事项。 */
  warnings: string[]
  skippedDirty: number
  skippedSubpathNoNpm: number
}

function isBlank(v: unknown): boolean {
  return typeof v !== 'string' || v.trim() === ''
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 非空字符串透传（trim 后），否则 undefined（键不产生）——0.7.0 Task 1 bypass 字段统一口径。 */
function strOrUndef(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s === '' ? undefined : s
}

/** npm 形状成立（非空字符串且满足 npm 包名形状）→ source: npm。 */
function npmShape(raw: CommunityRawEntry): string | null {
  if (typeof raw.npm !== 'string') return null
  const v = raw.npm.trim()
  return NPM_SHAPE_RE.test(v) ? v : null
}

/** url → `owner/repo`（仅接受 github.com http(s) 链接；形状须满足 GITHUB_SHAPE_RE）。 */
function githubFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = url.match(/^https?:\/\/github\.com\/([^/?#\s]+)\/([^/?#\s]+)/i)
  if (!m) return null
  const candidate = `${m[1]}/${m[2]}`
  return GITHUB_SHAPE_RE.test(candidate) ? candidate : null
}

/** 子包形态（Q43）：monorepo 子路径（url 含 `/tree/`）或上游 `name` 含 `#` 子包命名。 */
function isSubpathShape(raw: CommunityRawEntry): boolean {
  const urlHasTree = typeof raw.url === 'string' && raw.url.includes('/tree/')
  const nameHasHash = typeof raw.name === 'string' && raw.name.includes('#')
  return urlHasTree || nameHasHash
}

/** id 合成：小写 owner--name → 非法字符折叠 `-` → 剥前导非法段 → 超 64 截断加 sha256 尾缀。 */
function synthesizeId(owner: string, name: string): string {
  let id = `${owner}--${name}`.toLowerCase().replace(ID_ILLEGAL_RE, '-').replace(ID_LEADING_ILLEGAL_RE, '')
  if (id === '') return ''
  if (id.length > MAX_ID) {
    const hash = createHash('sha256').update(id).digest('hex').slice(0, HASH_SUFFIX_LEN)
    id = `${id.slice(0, TRUNCATED_BODY_LEN)}-${hash}`
  }
  return id
}

/** 适配层内冲突追加序号（-2/-3/…；追加后超长则截主体保序号完整）。 */
function dedupeId(id: string, used: Set<string>): string {
  if (!used.has(id)) {
    used.add(id)
    return id
  }
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate =
      id.length + suffix.length > MAX_ID ? id.slice(0, MAX_ID - suffix.length) + suffix : id + suffix
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/**
 * 适配入口：输入为已过容器校验的 CommunityCatalog（fetch 链产物）。
 * 每条原生条目按序判定：name/owner/category/description 基础字段 → 子包两态 → 来源归一
 * （npm 形状 → npm；否则 url → github；皆否跳过）→ id 合成去重。脏条目跳过计数，绝不中断整份。
 */
export function adaptCommunityCatalog(catalog: CommunityCatalog): AdaptCommunityResult {
  const entries: CommunityEntry[] = []
  const warnings: string[] = []
  const used = new Set<string>()
  let skippedDirty = 0
  let skippedSubpathNoNpm = 0
  let fallbackEn = 0
  let truncated = 0

  for (const raw of catalog.plugins) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      skippedDirty += 1
      continue
    }
    if (isBlank(raw.name) || isBlank(raw.owner)) {
      skippedDirty += 1
      continue
    }
    const name = (raw.name as string).trim()
    const owner = (raw.owner as string).trim()
    if (typeof raw.category !== 'string' || !COMMUNITY_CATEGORY_RE.test(raw.category)) {
      skippedDirty += 1
      continue
    }
    // description：zh 优先，缺省回退 en；两者皆无 → 脏条目（>500 截断并计数，同 registry MAX_DESCRIPTION 口径）
    const desc = raw.description
    const zh = typeof desc?.zh === 'string' ? desc.zh.trim() : ''
    const en = typeof desc?.en === 'string' ? desc.en.trim() : ''
    let description = zh !== '' ? zh : en
    if (description === '') {
      skippedDirty += 1
      continue
    }
    if (zh === '') fallbackEn += 1
    if (description.length > MAX_DESCRIPTION) {
      description = description.slice(0, MAX_DESCRIPTION)
      truncated += 1
    }

    const npm = npmShape(raw)
    if (npm === null && isSubpathShape(raw)) {
      // 无 npm 的 monorepo 子包：repo 根不是正确安装目标（Q43），跳过并计数
      skippedSubpathNoNpm += 1
      continue
    }

    let source: 'npm' | 'github'
    let npmName: string | undefined
    let github: string | undefined
    if (npm !== null) {
      source = 'npm'
      npmName = npm
      // 0.9.51：npm 条目补派生 github（url 为 github.com 形态时取 owner/repo，子包取 repo 根，
      // 原样大小写）——图标 owner 头像兜底 / 详情 GitHub 链接 / 已装匹配与精选双源条目同语义。
      // 派生失败不产出键、不跳过条目（条目层宽松，Q43）。
      github = githubFromUrl(raw.url) ?? undefined
    } else {
      const gh = githubFromUrl(raw.url)
      if (gh === null) {
        skippedDirty += 1
        continue
      }
      source = 'github'
      github = gh
    }

    const id = synthesizeId(owner, name)
    if (id === '') {
      skippedDirty += 1
      continue
    }

    // url → homepage（仅 http(s)；github 源必有 url，npm 源可能缺省）
    const rawUrl = typeof raw.url === 'string' ? raw.url.trim() : ''
    const homepage = rawUrl.startsWith('https://') || rawUrl.startsWith('http://') ? rawUrl : undefined

    entries.push({
      id: dedupeId(id, used),
      name,
      description,
      category: raw.category,
      tags: [],
      source,
      ...(npmName !== undefined ? { npm: npmName } : {}),
      ...(github !== undefined ? { github } : {}),
      ...(homepage !== undefined ? { homepage } : {}),
      stars: numOrNull(raw.stars),
      downloads: numOrNull(raw.downloads),
      capabilities: strArray(raw.capabilities),
      capabilityRedLines: strArray(raw.capabilityRedLines),
      screenshots: strArray(raw.screenshots),
      descriptionEn: en,
      owner,
      ...(strOrUndef(raw.added) !== undefined ? { added: strOrUndef(raw.added) } : {}),
      ...(raw.deprecated === true ? { deprecated: true } : {}),
      ...(strOrUndef(raw.replacement) !== undefined ? { replacement: strOrUndef(raw.replacement) } : {}),
      ...(strOrUndef(raw.install) !== undefined ? { install: strOrUndef(raw.install) } : {}),
      ...(strOrUndef(raw.downloadsStart) !== undefined ? { downloadsStart: strOrUndef(raw.downloadsStart) } : {}),
      ...(strOrUndef(raw.downloadsEnd) !== undefined ? { downloadsEnd: strOrUndef(raw.downloadsEnd) } : {}),
      ...(strOrUndef(raw.downloadsCheckedAt) !== undefined ? { downloadsCheckedAt: strOrUndef(raw.downloadsCheckedAt) } : {}),
      ...(strOrUndef(raw.version) !== undefined ? { version: strOrUndef(raw.version) } : {}),
    })
  }

  if (fallbackEn > 0) warnings.push(`zh 描述缺省回退 en：${fallbackEn} 条`)
  if (truncated > 0) warnings.push(`描述超过 ${MAX_DESCRIPTION} 字符已截断：${truncated} 条`)
  if (skippedSubpathNoNpm > 0) warnings.push(`无 npm 的子包条目跳过：${skippedSubpathNoNpm} 条`)
  if (skippedDirty > 0) warnings.push(`脏条目跳过：${skippedDirty} 条（缺 name/owner/category/描述，或来源无法判定）`)

  return { entries, warnings, skippedDirty, skippedSubpathNoNpm }
}
