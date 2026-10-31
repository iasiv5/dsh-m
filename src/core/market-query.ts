/**
 * 市场查询文法（GLOSSARY「市场查询文法」）：三端（面板 API / agent 工具 / CLI）市场查询
 * 参数的共享校验与归一模块——「合并市场」条目「三端同源同语义」承诺的执行机制。
 *
 * 单一入口 parseMarketQueryInput 一次吃下 {category, source, limit, offset}，文法违规
 * throw MarketQueryError（消息即契约，逐字节沿用 host-api/tools 既有文案，测试锚零迁移）；
 * 各端 policy（limitMax / limitDefault）表达 channel 差异（GUI 96/32，tools/CLI 80/10）。
 *
 * 环纪律：本模块 import 白名单仅 ./registry.js——community → merged-market →
 * community-adapter 已是值链，adapter 接入本模块后再值引用 community 即成环。
 * categoryLabelOf 的社区段合并（?? COMMUNITY_CATEGORY_LABELS[cat]）因此留在 tools/cli 各一行。
 *
 * 不入本模块（grill D1）：sort/probeMode/force/primaryOnly（仅 GUI 暴露）、query 字符串
 * （三端语义不同：host-api strArg 会 trim、tools 不 trim、cli 位置参数合并在前）。
 */
import { CATEGORIES } from './registry.js'

/** 社区分类 slug 文法（单一事实源；host-api/tools/cli/community-adapter 共用）。 */
export const COMMUNITY_SLUG_RE = /^[a-z0-9-]{1,32}$/

/** 精选五桶中文标签（键集 ≡ registry CATEGORIES，market-query.test.mjs 漂移守卫钉住）。 */
export const PRIMARY_CATEGORY_LABELS: Record<string, string> = {
  essentials: '装机必备',
  'cui-picks': '崔添翼精选',
  baoyu: '宝玉专区',
  'self-dev': 'iasi自研',
  'tencent-lighthouse': '腾讯轻量云专区',
  watchlist: '观察区',
}

/** 三端查询接线策略常量（原 tools.ts / cli.ts 双份字面量收敛；0.9.92 起单源）。 */
export const SEARCH_CORE_DEADLINE_MS = 44_000
export const INSTALLED_CORE_DEADLINE_MS = 60_000

/** 文法违规错误：消息即契约（各端映射自身信封：400 / throw 直飞 / stderr+exit 1），无 code 字段（YAGNI）。 */
export class MarketQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketQueryError'
  }
}

export interface MarketQueryPolicy {
  limitMax: number
  limitDefault: number
}

export interface MarketQueryIntake {
  category: string | null
  source: 'primary' | 'community' | 'all'
  limit: number
  offset: number
}

/**
 * 归一文法（错误检查顺序 category → source，红线 #6 双违例注记）：
 * - category：非字符串或 trim 后为空 → null；精选五桶（registry CATEGORIES）∪ 社区 slug → trim 后值；
 *   否则 throw `非法分类: …`
 * - source：非字符串或 trim 后为空 → 'all'；primary/community/all → trim 后值（勿返回未 trim 原值）；
 *   否则 throw `非法 source: …`
 * - limit：Number() 后 Number.isFinite && > 0 ? floor 先行钳 [1, limitMax] : limitDefault
 *   （floor 发生位置从 core clampLimit 前移到入口，值域结果逐点相同——红线 #3）
 * - offset：Number() 后 Number.isFinite && > 0 ? Math.floor : 0
 */
export function parseMarketQueryInput(
  raw: { category?: unknown; source?: unknown; limit?: unknown; offset?: unknown },
  policy: MarketQueryPolicy,
): MarketQueryIntake {
  const categoryRaw = typeof raw.category === 'string' ? raw.category.trim() : ''
  let category: string | null = null
  if (categoryRaw !== '') {
    if ((CATEGORIES as readonly string[]).includes(categoryRaw) || COMMUNITY_SLUG_RE.test(categoryRaw)) {
      category = categoryRaw
    } else {
      throw new MarketQueryError(`非法分类: ${categoryRaw}（需精选分类或 [a-z0-9-]{1,32} slug）`)
    }
  }

  const sourceRaw = typeof raw.source === 'string' ? raw.source.trim() : ''
  if (sourceRaw !== '' && sourceRaw !== 'primary' && sourceRaw !== 'community' && sourceRaw !== 'all') {
    throw new MarketQueryError(`非法 source: ${sourceRaw}（需 primary/community/all）`)
  }
  const source: 'primary' | 'community' | 'all' = sourceRaw === '' ? 'all' : (sourceRaw as 'primary' | 'community' | 'all')

  const rawLimit = Number(raw.limit)
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(policy.limitMax, Math.max(1, Math.floor(rawLimit)))
      : policy.limitDefault

  const rawOffset = Number(raw.offset)
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0

  return { category, source, limit, offset }
}
