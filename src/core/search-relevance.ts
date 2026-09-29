/**
 * 搜索相关性管线（0.7.0 Task 3 / DESIGN.md §2.6「搜索：相关性加权管线」）：
 * NFKC 归一化 + 中西文边界插空格 + 标点归空格 → 分词 → 字段加权评分。
 *
 * - id 为单列最高优先：normalized id 与整条 query 精确相等 → ID_EXACT_SCORE（收藏 stale 检测
 *   依赖此语义，豁免「多词同字段全命中」约束）；
 * - 字段权重：name/npm 700 · owner 400 · 首选描述 280 · 次选描述 240 · 分类 180 · tags 150
 *   （tags 为 dsh-m 主清单召回保留——dsh-market 目录无 tags 概念，主清单 tags 有文案标准）；
 * - 命中类型加分：精确 +300 / 前缀 +250 / 包含 +200 / 多词全命中 +150；
 *   多词要求**同字段全命中**，否则该字段 0 分；
 * - 按条目 WeakMap memoize 归一化字段串——4,400+ 条 × 每次搜索请求全量归一化的性能护栏
 *   （条目对象随每次 adapt 重建，缓存随条目代际自然失效，无陈旧风险）。
 */

export interface SearchableEntry {
  id: string
  name: string
  npm?: string
  owner?: string
  description: string
  descriptionEn?: string
  category: string
  tags?: string[]
}

/** id 整串精确匹配得分：恒高于一切字段组合分，保证排首且必命中。 */
export const ID_EXACT_SCORE = 10_000

const W_NAME = 700
const W_OWNER = 400
const W_DESC = 280
const W_DESC_EN = 240
const W_CATEGORY = 180
const W_TAGS = 150

const B_EXACT = 300
const B_PREFIX = 250
const B_CONTAINS = 200
const B_MULTI = 150

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const WORD_RE = /[\p{L}\p{N}]/u

/** 归一化：NFKC + 小写 + 中西文边界插空格（`MCP管理` ≈ `MCP 管理`）+ 标点/符号/空白归单空格。 */
export function normalizeSearchText(input: string): string {
  const nfk = input.normalize('NFKC').toLowerCase()
  let out = ''
  for (let i = 0; i < nfk.length; i++) {
    const ch = nfk[i]
    if (i > 0) {
      const prev = nfk[i - 1]
      if (WORD_RE.test(ch) && WORD_RE.test(prev) && CJK_RE.test(ch) !== CJK_RE.test(prev)) out += ' '
    }
    out += ch
  }
  return out.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** 分词（输入应为 normalizeSearchText 产物）。 */
export function tokenizeSearchText(normalized: string): string[] {
  return normalized.split(/\s+/).filter((t) => t !== '')
}

/** 多段字段（如 tags）归一化为单空格连接的 token 串。 */
function fieldText(parts: Array<string | undefined>): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => normalizeSearchText(p))
    .filter((p) => p !== '')
    .join(' ')
}

interface NormalizedFields {
  id: string
  fields: Array<{ text: string; weight: number }>
}

const fieldsCache = new WeakMap<object, NormalizedFields>()

function fieldsOf(entry: SearchableEntry): NormalizedFields {
  const cached = fieldsCache.get(entry)
  if (cached) return cached
  const fields: Array<{ text: string; weight: number }> = [
    { text: fieldText([entry.name]), weight: W_NAME },
    ...(entry.npm !== undefined ? [{ text: fieldText([entry.npm]), weight: W_NAME }] : []),
    ...(entry.owner !== undefined ? [{ text: fieldText([entry.owner]), weight: W_OWNER }] : []),
    { text: fieldText([entry.description]), weight: W_DESC },
    ...(entry.descriptionEn !== undefined ? [{ text: fieldText([entry.descriptionEn]), weight: W_DESC_EN }] : []),
    { text: fieldText([entry.category]), weight: W_CATEGORY },
    ...(entry.tags !== undefined && entry.tags.length > 0 ? [{ text: fieldText(entry.tags), weight: W_TAGS }] : []),
  ]
  const value: NormalizedFields = { id: fieldText([entry.id]), fields }
  fieldsCache.set(entry, value)
  return value
}

function hitBonus(field: string, term: string): number {
  if (field === term) return B_EXACT
  if (field.startsWith(term)) return B_PREFIX
  if (field.includes(term)) return B_CONTAINS
  return 0
}

/** 单字段评分：全部词命中才得分（取最弱命中类型 + 多词加成）；任一词未命中 → 0。 */
function scoreField(text: string, weight: number, terms: string[]): number {
  if (text === '') return 0
  let min = Number.POSITIVE_INFINITY
  for (const term of terms) {
    const b = hitBonus(text, term)
    if (b === 0) return 0
    if (b < min) min = b
  }
  return weight + min + (terms.length > 1 ? B_MULTI : 0)
}

/** 相关性评分（>0 = 命中）：id 整串精确匹配最高优先且豁免多词约束；否则取各字段最大分。 */
export function relevanceScore(entry: SearchableEntry, terms: string[]): number {
  if (terms.length === 0) return 0
  const f = fieldsOf(entry)
  if (f.id !== '' && f.id === terms.join(' ')) return ID_EXACT_SCORE
  let best = 0
  for (const field of f.fields) {
    const s = scoreField(field.text, field.weight, terms)
    if (s > best) best = s
  }
  return best
}
