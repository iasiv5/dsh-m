/**
 * 社区清单（DESIGN.md §2.5 / ADR-0003）：awesome-dsh-plugin 全量目录的只读叠加层。
 * 本模块只负责「容器层」：常量、原生 schema 类型、容器校验、分类标签表。
 * 获取链/缓存（Task 3）与目录适配层（Task 4）见同目录另两处。
 * 校验语义（Q43）：容器层严格（未知顶层键/非数组/超上限整份拒收）；条目层宽松（适配层跳过计数）。
 */
import type { Buffer } from 'node:buffer'

export const COMMUNITY_NPM_PACKAGE = 'dsh-plugin-catalog'
export const MAX_COMMUNITY_BYTES = 32 * 1024 * 1024
export const MAX_COMMUNITY_ENTRIES = 30_000
export const CATALOG_BODY_TIMEOUT_MS = 15_000
export const COMMUNITY_CHAIN_BUDGET_MS = 30_000

/** 原生条目（防御性：字段全可选，消费方必须自行判空；npm:null=未发 npm，capabilities 缺省=未扫描）。 */
export interface CommunityRawEntry {
  name?: string
  owner?: string
  url?: string
  page?: string
  category?: string
  description?: { en?: string; zh?: string }
  npm?: string | null
  tarball?: string
  version?: string | null
  stars?: number | null
  downloads?: number | null
  downloadsStart?: string | null
  downloadsEnd?: string | null
  downloadsCheckedAt?: string | null
  capabilities?: string[]
  capabilityRedLines?: string[]
  capabilityCheckedAt?: string
  install?: string
  added?: string
  screenshots?: string[]
}

export interface CommunityCatalogCategory {
  en?: string
  zh?: string
}

export interface CommunityCatalog {
  name: string
  url: string
  source: string
  updated: string
  count: number
  categories: Record<string, CommunityCatalogCategory>
  plugins: CommunityRawEntry[]
}

/**
 * 上游 23 个分类 id 的全量中文标签（以 fixture `categories` 键为准逐条核对）。
 * 其中 ui/tools/market 与精选分类同名共享过滤桶、不进筛选栏社区组，标签供详情页等处使用。
 */
export const COMMUNITY_KNOWN_CATEGORIES: Record<string, string> = {
  agi: 'AGI 架构探索',
  ui: 'UI 增强',
  usage: '用量与计费',
  theme: '主题与外观',
  model: '模型与账号接入',
  identity: '身份与通信',
  session: '会话与消息',
  memory: '记忆',
  tools: '工具与能力',
  wsl: 'WSL 与 Windows 互操作',
  browser: '浏览器与网页',
  vision: '视觉与多模态',
  voice: '语音与音频',
  docs: '文档与渲染',
  skill: '技能包',
  workflow: '工作流与自动化',
  git: 'Git 与代码评审',
  notify: '通知与集成',
  dev: '开发与运行时',
  security: '安全与权限',
  remote: '远程与移动端',
  market: '插件市场与管理',
  fun: '娱乐',
}

const TOP_LEVEL_KEYS = new Set(['name', 'url', 'source', 'updated', 'count', 'categories', 'plugins'])

export interface CommunityContainerResult {
  ok: boolean
  errors: string[]
  catalog: CommunityCatalog | null
}

/**
 * 容器层严格校验（条目层由适配层负责）：
 * - 根必须是对象，未知顶层键报错；
 * - `plugins` 缺失/非数组/超过 MAX_COMMUNITY_ENTRIES → 整份拒收（不截断、不部分加载）。
 */
export function validateCommunityContainer(raw: unknown): CommunityContainerResult {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['社区目录根必须是对象'], catalog: null }
  }
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`${key}: 未知顶层字段`)
  }
  const plugins = obj.plugins
  if (!Array.isArray(plugins)) {
    errors.push('plugins: 必须是数组')
    return { ok: false, errors, catalog: null }
  }
  if (plugins.length > MAX_COMMUNITY_ENTRIES) {
    errors.push(`plugins: ${plugins.length} 条超过上限 ${MAX_COMMUNITY_ENTRIES}，拒绝整份目录`)
    return { ok: false, errors, catalog: null }
  }
  for (let i = 0; i < plugins.length; i++) {
    const item = plugins[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`plugins[${i}]: 必须是对象`)
    }
  }
  if (errors.length > 0) return { ok: false, errors, catalog: null }
  const categories =
    obj.categories && typeof obj.categories === 'object' && !Array.isArray(obj.categories)
      ? (obj.categories as Record<string, CommunityCatalogCategory>)
      : {}
  return {
    ok: true,
    errors: [],
    catalog: {
      name: typeof obj.name === 'string' ? obj.name : '',
      url: typeof obj.url === 'string' ? obj.url : '',
      source: typeof obj.source === 'string' ? obj.source : '',
      updated: typeof obj.updated === 'string' ? obj.updated : '',
      count: typeof obj.count === 'number' ? obj.count : plugins.length,
      categories,
      plugins: plugins as CommunityRawEntry[],
    },
  }
}

/** 预留给 Task 3 的类型占位（避免循环引用，正文下载经 httpx.fetchBytesLimited）。 */
export type CommunityBytes = Buffer
