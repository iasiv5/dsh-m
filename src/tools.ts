/**
 * dshm_* agent 工具（DESIGN.md §5）：7 个 defineTool + systemPrompt 注入。
 * 渲染文本遵循 skillhub 的 agent 体验约束：卡片已展示、对用户最多一句、不打印命令。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { installTimeoutMs } from './core/env.js'
import {
  installFromRegistry,
  listInstalledWithMeta,
  listMarket,
  selfUpgrade,
  uninstallPlugin,
  upgradePlugin,
  InstallGuardError,
  type CommunityRegistrySummary,
  type InstalledResult,
} from './core/market.js'
import type { RegistryConfig, RegistryEntry, RegistryState } from './core/registry.js'
import { appExitFromContext, scheduleRestart } from './core/restart.js'
import { togglePlugin as coreTogglePlugin, type ToggleResult } from './core/toggle.js'

export const CATEGORY_LABELS: Record<RegistryEntry['category'], string> = {
  market: '市场',
  tools: '工具',
  ui: '界面',
  search: '搜索',
  other: '其他',
}

/** 工具 deadline 对齐（M1 Task 7）：search 45s（core 44s）、list/outdated 65s（core 60s + 5s 回包余量）。 */
const SEARCH_TOOL_TIMEOUT_MS = 45_000
const SEARCH_CORE_DEADLINE_MS = 44_000
const INSTALLED_TOOL_TIMEOUT_MS = 65_000
const INSTALLED_CORE_DEADLINE_MS = 60_000
/** 社区开放分类安全 slug（与 host-api 侧同语义） */
const COMMUNITY_SLUG_RE = /^[a-z0-9-]{1,32}$/

/** 社区 summary 四键投影（Task 7 ②）：agent 工具输出只带这四个字段。 */
export function communityToolSummary(c: CommunityRegistrySummary | null | undefined): {
  acceptedCount: number | null
  route: string | null
  status: string
  version: string | null
} {
  if (!c) return { acceptedCount: null, route: null, status: 'unavailable', version: null }
  const unavailableLike = c.status === 'disabled' || c.status === 'unavailable'
  return {
    acceptedCount: unavailableLike ? null : c.acceptedCount,
    route: unavailableLike ? null : c.route,
    status: c.status,
    version: c.version,
  }
}

/** latestErrorCode → 安全化原因（Task 7 ⑨）：不泄露内部细节，按 code 归类。 */
export function latestErrorCodeReason(code: string | null | undefined): string {
  switch (code) {
    case 'budget-exhausted':
      return '因 GitHub 预算未完成'
    case 'rate-limited':
      return 'GitHub 限流'
    case 'timeout':
      return '检查超时'
    default:
      return '网络错误'
  }
}

/** 可注入 market 依赖（测试用；生产走真实 core）。 */
export interface ToolMarketDeps {
  listMarket?: typeof listMarket
  listInstalledWithMeta?: typeof listInstalledWithMeta
  installFromRegistry?: typeof installFromRegistry
  uninstallPlugin?: typeof uninstallPlugin
  upgradePlugin?: typeof upgradePlugin
  restart?: typeof scheduleRestart
  togglePlugin?: typeof coreTogglePlugin
}

function cloneJson(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function summaryOf(state: RegistryState): { isDefault: boolean; status: string; stale: boolean } {
  return { isDefault: state.isDefault, status: state.status, stale: state.stale }
}

export function registerTools(ctx: Context, cfg: RegistryConfig, deps: ToolMarketDeps = {}): void {
  const timeoutMs = cfg.timeoutMs ?? 20_000
  const m = {
    listMarket: deps.listMarket ?? listMarket,
    listInstalledWithMeta: deps.listInstalledWithMeta ?? listInstalledWithMeta,
    installFromRegistry: deps.installFromRegistry ?? installFromRegistry,
    uninstallPlugin: deps.uninstallPlugin ?? uninstallPlugin,
    upgradePlugin: deps.upgradePlugin ?? upgradePlugin,
  }
  const restart = deps.restart ?? ((port: number | null = null) =>
    scheduleRestart(port, { appExit: appExitFromContext(ctx) }))
  const toggle = deps.togglePlugin ?? coreTogglePlugin
  // 开关委派服务探测（ADR-0001）：运行时按存在性，不判版本号
  const getService = (): unknown =>
    (ctx as unknown as { get?: (name: string) => unknown }).get?.('pluginManager')

  ctx.tools.register(defineTool({
    name: 'dshm_search',
    description:
      'Search your personal DSH plugin marketplace (dsh-m) and show clickable plugin cards. ALWAYS call this instead of web_search or bash when the user wants to find/recommend/browse their curated DSH plugins (插件). Call EXACTLY ONCE per user message; extract a real keyword (主题, 搜索) rather than pasting the whole sentence. Omit query to browse all listings. After cards appear, reply with AT MOST one short sentence. Do not print install commands.',
    parameters: {
      query: { type: 'string', description: 'Main keyword, e.g. 主题 or 搜索. Optional.' },
      category: {
        type: 'string',
        description: `Optional category: curated ${Object.keys(CATEGORY_LABELS).join('/')} or any community slug ([a-z0-9-]{1,32}, e.g. theme/memory/git).`,
      },
      limit: { type: 'number', description: 'Cards in this batch. Default all (registry is curated & small).' },
      primary_only: { type: 'boolean', description: '只看主清单（排除社区条目）. Optional.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderSearch(value as SearchOut) }],
      presentationMeta: (_args, value) => ({ kind: 'dshm-search', ...(value as object) }),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `DSH 市场 · ${String(args.query || args.category || '浏览')}`,
      kind: 'search',
      content: [],
    }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '市场搜索失败' : `DSH 市场 · ${(meta as SearchOut | undefined)?.items?.length ?? 0} 条`,
      content: [],
    }),
    timeoutMs: SEARCH_TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const categoryRaw = typeof args.category === 'string' ? args.category.trim() : ''
      let category: string | null = null
      if (categoryRaw !== '') {
        if (categoryRaw in CATEGORY_LABELS || COMMUNITY_SLUG_RE.test(categoryRaw)) category = categoryRaw
        else throw new Error(`非法分类: ${categoryRaw}（需精选分类或 [a-z0-9-]{1,32} slug）`)
      }
      const rawLimit = Number(args.limit)
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? clamp(rawLimit, 1, 80) : undefined
      // metadata-only：agent 卡片不需要 latest；与 Host GUI 共用 host namespace；
      // deadline 44s 是本 waiter 的绝对上限（工具 timeout 45s 先到兜底）
      const result = await m.listMarket(cfg, {
        query: String(args.query || ''),
        category,
        offset: 0,
        limit,
        primaryOnly: args.primary_only === true,
        withLatest: false,
        namespace: 'host',
        deadlineMs: SEARCH_CORE_DEADLINE_MS,
        signal: exec?.signal,
      })
      // 安装标注唯一来源：listMarket 的单次 profile 快照。
      // 状态不完整且存在可被误标的条目时 fail-closed——不把未知安装状态呈现成未安装；
      // 空结果（registry 不可用/超时/无匹配）无可误标条目，维持优雅空结果。
      if (!result.installedComplete && result.items.length > 0) {
        throw new Error('读取 web profile 安装状态失败，安装标注不可用；请稍后重试')
      }
      return cloneJson({
        query: String(args.query || ''),
        category,
        total: result.total,
        registry: summaryOf(result.registryState),
        community: communityToolSummary(result.community),
        items: result.items.map((e) => ({
          id: e.id,
          name: e.name,
          description: e.description,
          category: e.category,
          tags: e.tags,
          source: e.source,
          npm: e.npm,
          github: e.github,
          homepage: e.homepage,
          installed: e.installed,
          installedPkg: e.installedPkg,
          installedVersion: e.installedVersion,
        })),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dshm_list',
    description:
      'List plugins installed in the DSH web profile, annotated with 市场安装/非市场安装, sources, and outdated flags. Use when the user asks what plugins are installed or wants to manage local plugins.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderList(value as ListOut) }],
      presentationMeta: (_args, value) => ({ kind: 'dshm-list', ...(value as object) }),
    },
    presentCall: () => ({ card: 'generic', title: '已装插件', kind: 'search', content: [] }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '列出失败' : `已装 · ${(meta as ListOut | undefined)?.items?.length ?? 0} 个`,
      content: [],
    }),
    timeoutMs: INSTALLED_TOOL_TIMEOUT_MS,
    async execute(_args, exec) {
      const result: InstalledResult = await m.listInstalledWithMeta(cfg, {
        namespace: 'host',
        deadlineMs: INSTALLED_CORE_DEADLINE_MS,
        signal: exec?.signal,
      })
      return cloneJson({
        registry: summaryOf(result.registryState),
        community: communityToolSummary(result.community),
        profileDir: result.profileDir,
        others: result.others,
        items: result.items.map((it) => ({
          pkg: it.pkg,
          name: it.name,
          version: it.version,
          source: it.source,
          registryId: it.registryId ?? null,
          latestVersion: it.latestVersion ?? null,
          outdated: it.outdated,
          latestError: it.latestError ?? null,
          latestErrorCode: it.latestErrorCode ?? null,
        })),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dshm_install',
    description:
      'Install a plugin from the dsh-m registry into the current web profile after the user names one (装 dsh-skins / 安装 web-search). Pass the id from dshm_search results. npm 源锁定最新精确版本，github 源锁定 commit SHA。安装前做 peer 兼容预检（只检 @deepseek-ai/dsh(-*)；github 源不预检）：不兼容时返回结构化结果，向用户说明风险，用户确认后带 force: true 重试（force 等价 forceIncompatible）。Do not print CLI commands. After success, tell the user it needs a restart of dsh web, and offer dshm_restart.',
    parameters: {
      id: { type: 'string', required: true, description: '收录 id from dshm_search, e.g. dsh-skins' },
      version: { type: 'string', description: 'Optional exact semver (npm 源). Default latest.' },
      force: { type: 'boolean', description: '用户已确认兼容风险后重试时置 true（跳过 peer 预检拦截）。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderInstall(value as InstallOut) }],
      presentationMeta: (_args, value) => ({ kind: 'dshm-install', ...(value as object) }),
    },
    presentCall: (args) => ({ card: 'generic', title: `安装 · ${String(args.id || '')}`, kind: 'search', content: [] }),
    presentResult: (_args, { isError, meta }) => {
      const out = meta as InstallOut | undefined
      if (out?.guard === true) return { card: 'generic', title: `守卫拦截 · ${out.compensation?.status ?? ''}`, content: [] }
      return { card: 'generic', title: isError ? '安装失败' : `已安装 · ${out?.pkg || ''}`, content: [] }
    },
    timeoutMs: installTimeoutMs() + 60_000,
    async execute(args) {
      const id = String(args.id || '').trim()
      if (!id) throw new Error('缺少收录 id')
      const version = typeof args.version === 'string' && args.version.trim() ? args.version.trim() : undefined
      const force = args.force === true
      try {
        return cloneJson(await m.installFromRegistry(id, cfg, { version, forceIncompatible: force, namespace: 'host' }))
      } catch (err) {
        if (err instanceof InstallGuardError) {
          // 结构化 error result（M2 Task 3 ㉑-㉜）：不渲染「已安装」，无 force 通道；restartSafe 随结果携带
          return { ok: false, guard: true, kind: err.kind, message: err.message, violations: err.violations, compensation: err.compensation, needsRestart: err.needsRestart, restartSafe: err.restartSafe, ...(err.repairBasis ? { repairBasis: err.repairBasis } : {}) }
        }
        throw err
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dshm_toggle',
    description:
      'Toggle a DSH plugin on/off (切换运行状态). Pass pkg from dshm_list and enabled (true=启用 / false=停用). 可逆操作：默认先与用户确认；用户同一句消息已明确表达（如「把 skins 关掉」）可直接执行。结果 applied=live 时告知已即时生效；restart-required 时提示需重启并提供 dshm_restart。受保护插件（dsh-m 自身与官方宿主命脉）会被拒绝。',
    parameters: {
      pkg: { type: 'string', required: true, description: '包名 from dshm_list, e.g. dsh-better-sidebar' },
      enabled: { type: 'boolean', required: true, description: 'true = 启用，false = 停用' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderToggle(value as unknown as ToggleResult) }],
      presentationMeta: (_args, value) => ({ kind: 'dshm-toggle', ...(value as object) }),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `${args.enabled === true ? '启用' : '停用'} · ${String(args.pkg || '')}`,
      content: [],
    }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '开关操作失败' : `已${(meta as ToggleResult | undefined)?.enabled === true ? '启用' : '停用'} · ${(meta as ToggleResult | undefined)?.pkg || ''}`,
      content: [],
    }),
    timeoutMs: 30_000,
    async execute(args) {
      const target = String(args.pkg || '').trim()
      if (!target) throw new Error('缺少 pkg')
      if (typeof args.enabled !== 'boolean') throw new Error('缺少 enabled（boolean）')
      return cloneJson(await toggle(target, args.enabled, { getService: getService as never }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dshm_uninstall',
    description:
      'Uninstall a DSH plugin from the web profile by package name (pkg from dshm_list). Confirm with the user BEFORE calling. Does not delete plugin data; reports leftover paths instead.',
    parameters: {
      pkg: { type: 'string', required: true, description: '包名 from dshm_list, e.g. dsh-web-search' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderUninstall(value as UninstallOut) }],
      presentationMeta: (_args, value) => ({ kind: 'dshm-uninstall', ...(value as object) }),
    },
    presentCall: (args) => ({ card: 'generic', title: `卸载 · ${String(args.pkg || '')}`, content: [] }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '卸载失败' : `已卸载 · ${(meta as UninstallOut | undefined)?.pkg || ''}`,
      content: [],
    }),
    timeoutMs: installTimeoutMs(),
    async execute(args) {
      const target = String(args.pkg || '').trim()
      if (!target) throw new Error('缺少 pkg')
      return cloneJson(await m.uninstallPlugin(target, cfg, { namespace: 'host' }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dshm_outdated',
    description:
      'Check installed DSH plugins for newer versions (npm latest / GitHub HEAD). Use when the user asks about updates or 升级. Read-only.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderOutdated(value as ListOut) }],
      presentationMeta: (_args, value) => ({ kind: 'dshm-outdated', ...(value as object) }),
    },
    presentCall: () => ({ card: 'generic', title: '检查更新', kind: 'search', content: [] }),
    presentResult: (_args, { isError, meta }) => {
      const out = meta as ListOut | undefined
      const n = out?.items?.filter((it) => it.outdated).length ?? 0
      const incomplete = out?.incompleteCount ?? 0
      // 禁止「未完成检查」冒充「全部最新」（Task 7 ⑨）
      const title = isError
        ? '检查失败'
        : incomplete > 0
          ? `${n} 个可升级（${incomplete} 项检查未完成）`
          : n
            ? `${n} 个可升级`
            : '全部最新'
      return { card: 'generic', title, content: [] }
    },
    timeoutMs: INSTALLED_TOOL_TIMEOUT_MS,
    async execute(_args, exec) {
      const result: InstalledResult = await m.listInstalledWithMeta(cfg, {
        namespace: 'host',
        deadlineMs: INSTALLED_CORE_DEADLINE_MS,
        signal: exec?.signal,
      })
      const items = result.items.map((it) => ({
        pkg: it.pkg,
        name: it.name,
        version: it.version,
        source: it.source,
        latestVersion: it.latestVersion ?? null,
        latestTag: it.latestTag ?? null,
        outdated: it.outdated,
        latestError: it.latestError ?? null,
        latestErrorCode: it.latestErrorCode ?? null,
      }))
      const incompleteCount = items.filter((it) => it.latestErrorCode !== null).length
      return cloneJson({
        registry: summaryOf(result.registryState),
        community: communityToolSummary(result.community),
        items,
        outdatedCount: items.filter((it) => it.outdated).length,
        incompleteCount,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dshm_upgrade',
    description:
      'Upgrade an installed DSH plugin to the latest version (npm 拉最新精确版 / github 重新锁 HEAD)。pkg 来自 dshm_list 或 dshm_outdated。用户确认升级哪一个之后再调用。After success, tell the user it needs a restart, and offer dshm_restart.',
    parameters: {
      pkg: { type: 'string', required: true, description: '包名 from dshm_list / dshm_outdated' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderUpgrade(value as InstallOut & { fromVersion?: string }) }],
      presentationMeta: (_args, value) => ({ kind: 'dshm-upgrade', ...(value as object) }),
    },
    presentCall: (args) => ({ card: 'generic', title: `升级 · ${String(args.pkg || '')}`, content: [] }),
    presentResult: (_args, { isError, meta }) => {
      const out = meta as InstallOut | undefined
      if (out?.guard === true) return { card: 'generic', title: `守卫拦截 · ${out.compensation?.status ?? ''}`, content: [] }
      return { card: 'generic', title: isError ? '升级失败' : `已升级 · ${out?.pkg || ''}`, content: [] }
    },
    timeoutMs: installTimeoutMs() + 60_000,
    async execute(args) {
      const target = String(args.pkg || '').trim()
      if (!target) throw new Error('缺少 pkg')
      try {
        return cloneJson(await m.upgradePlugin(target, cfg, { namespace: 'host' }))
      } catch (err) {
        if (err instanceof InstallGuardError) {
          return { ok: false, guard: true, kind: err.kind, message: err.message, violations: err.violations, compensation: err.compensation, needsRestart: err.needsRestart, restartSafe: err.restartSafe, ...(err.repairBasis ? { repairBasis: err.repairBasis } : {}) }
        }
        throw err
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dshm_restart',
    description:
      'Restart DSH web so newly installed/uninstalled/upgraded plugins take effect. ONLY call after the user agrees (用户同意重启后). DSH Web reconnects in the background after the service comes back.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: `已请求重启 DSH web（via ${(value as { via?: string }).via}）。服务恢复后 DSH Web 会在后台自动重连。对用户最多一句短话。`,
      }],
      presentationMeta: (_args, value) => ({ kind: 'dshm-restart', ...(value as object) }),
    },
    presentCall: () => ({ card: 'generic', title: '重启 DSH Web', content: [] }),
    presentResult: (_args, { isError }) => ({
      card: 'generic',
      title: isError ? '重启失败' : '已请求重启',
      content: [],
    }),
    timeoutMs: 15_000,
    async execute() {
      return cloneJson(restart(null))
    },
  }))

  ctx.inject(['systemPrompt'], (c) => {
    const prompt = (c as unknown as {
      systemPrompt: {
        section: (section: { name: string; order: number; text: string | (() => string) }) => void
      }
    }).systemPrompt
    prompt.section({
      name: 'tool:dshm',
      order: 211,
      text: [
        'Finding / recommending / browsing DSH plugins (插件) in the personal marketplace: you MUST call dshm_search, never web_search or bash. One call per user message; extract a real keyword. After cards appear, reply with AT MOST one short sentence. Do not print install commands.',
        `Plugin categories: ${Object.entries(CATEGORY_LABELS).map(([k, v]) => `${k}=${v}`).join(', ')}.`,
        'Install only after the user names a card: dshm_install with its id. Then one short sentence mentioning the restart requirement; offer dshm_restart.',
        'For installed plugins, call dshm_list / dshm_outdated. Upgrade only after the user confirms which one: dshm_upgrade. Uninstall only after confirmation: dshm_uninstall.',
        'dshm_toggle switches a plugin on/off: confirm first unless the user already said it in the same message (把 skins 关掉 → execute directly); report live vs restart-required accordingly. ',
        'dshm_restart only after the user agrees to restart; afterwards tell them to refresh once the page recovers.',
      ].join(' '),
    })
  })
}

// ---------- 渲染文本 ----------
interface SearchOut {
  items?: Array<RegistryEntry & { installed?: boolean; installedVersion?: string }>
  total?: number
}
interface ListOut {
  items?: Array<{ pkg: string; name: string; version: string; source: string; latestVersion?: string | null; latestTag?: string | null; outdated?: boolean; registryId?: string | null; latestError?: string | null; latestErrorCode?: string | null }>
  incompleteCount?: number
  community?: { acceptedCount: number | null; route: string | null; status: string; version: string | null }
}
interface InstallOut {
  guard?: boolean
  kind?: string
  message?: string
  compensation?: { status: string; note: string }
  restartSafe?: boolean
  repairBasis?: string
  pkg?: string
  spec?: string
  version?: string
  sha?: string
  tag?: string
  buildApprovals?: string[]
  fallbackAllBuilds?: boolean
  compat?: { pkg?: string; version?: string; runtimeVersion?: string | null; peers?: Record<string, string> } | null
  compatSkipped?: 'github-source'
  bundleWarning?: 'no-patch-layer'
  fromVersion?: string
  healActions?: Array<{ code: string; note: string }>
}

/** 开关结果渲染（Task 15）。 */
function renderToggle(out: ToggleResult): string {
  const word = out.enabled ? '已启用' : '已停用'
  if (out.applied === 'live') {
    return `✅ ${out.pkg} ${word}（即时生效）。${out.warnings.join('；')}`
  }
  return `✅ ${out.pkg} ${word}（需重启生效——询问是否 dshm_restart）。${out.warnings.join('；')}`
}

/** 构建放行文案（ADR-0002）：列包名；兜底全量放行如实标注。 */
function buildsNote(out: InstallOut): string {
  if (out.fallbackAllBuilds) return '注意：该插件执行了构建脚本（名单不可读，已全量兜底放行）。'
  const names = out.buildApprovals ?? []
  if (names.length === 0) return ''
  return `注意：该插件执行了构建脚本，已精确放行：${names.join('、')}。`
}
interface UninstallOut {
  pkg?: string
  liveDisabled?: boolean
  leftovers?: string[]
}

function renderSearch(out: SearchOut): string {
  if (!out.items?.length) return '收录清单中没有匹配的插件。对用户只说一句：没找到，可以换个词再搜。不要写长文。'
  const lines = out.items.map((it, i) => {
    const inst = it.installed ? `（已安装 v${it.installedVersion || '?'}）` : ''
    return `${i + 1}. ${it.name} · ${it.id}${inst} · ${CATEGORY_LABELS[it.category] || it.category}`
  })
  return [
    `插件卡片已展示 ${out.items.length}${out.total && out.total > out.items.length ? `/${out.total}` : ''} 条（内部序号，禁止复述给用户）：`,
    lines.join('\n'),
    '对用户最多回一句短话。禁止清单和长文。用户点名安装时才调 dshm_install（id）。',
  ].join('\n')
}

function renderList(out: ListOut): string {
  if (!out.items?.length) return 'web profile 还没有安装任何 dsh 插件。对用户一句短话即可。'
  const lines = out.items.map((it, i) => {
    const marks = [
      it.registryId ? '市场' : '非市场',
      it.outdated && it.latestVersion ? `可升级 → v${it.latestVersion}` : null,
    ].filter(Boolean).join('，')
    return `${i + 1}. ${it.name} (${it.pkg}) v${it.version || '?'} · ${it.source}${marks ? ` · ${marks}` : ''}`
  })
  return [
    `已安装 ${out.items.length} 个插件（内部序号，禁止复述给用户）：`,
    lines.join('\n'),
    '对用户最多回一句短话。管理动作：dshm_upgrade / dshm_uninstall（先与用户确认）。',
  ].join('\n')
}

function renderInstall(out: InstallOut): string {
  const guardBlock = out.guard !== true ? null : [
    `⛔ 安装被装后守卫拦截：${out.message ?? ''}`,
    `终态：${out.compensation?.status ?? '—'}（${out.compensation?.note ?? ''}）`,
    out.repairBasis ? `修复依据：${out.repairBasis}` : null,
    out.restartSafe === true ? '可以重启 DSH Web。' : '修复后再重启（不要现在一键重启）。',
    '对用户如实说明守卫拦截与终态，不得说「已安装成功」或「已恢复原版本」。',
  ].filter(Boolean).join('\n')
  if (out.guard === true) return guardBlock as unknown as string
  const extra = buildsNote(out)
  const compatNote = out.compat
    ? '注意：该版本与当前 DSH 运行时 peer 不兼容，已按用户确认强制安装。'
    : out.compatSkipped === 'github-source'
      ? '注意：github 源未做兼容预检。'
      : ''
  const bundleNote = out.bundleWarning === 'no-patch-layer'
    ? '注意：该包无补丁层（cordis.patch.yml 缺失且未进 bundles），已装入为纯依赖不会生效；如非预期可卸载（dshm_uninstall）或到收录仓库反馈。'
    : ''
  const heals = out.healActions?.length
    ? `安装过程含 ${out.healActions.length} 步自愈（${out.healActions.map((h) => h.code).join('、')}）。`
    : ''
  return `✅ ${out.pkg} 已安装（${out.spec}）。${extra}${compatNote}${bundleNote}${heals}需要重启 DSH Web 生效——告知用户并询问是否 dshm_restart。不要打印安装命令。`
}

function renderUninstall(out: UninstallOut): string {
  const parts = [`✅ ${out.pkg} 已卸载。`]
  if (out.liveDisabled) parts.push('运行中的界面已先下线。')
  if (out.leftovers?.length) parts.push(`疑似残留数据（未删除，仅供知晓）：${out.leftovers.join('、')}`)
  parts.push('需要重启生效——询问是否 dshm_restart。')
  return parts.join(' ')
}

function renderOutdated(out: ListOut): string {
  const outdated = (out.items || []).filter((it) => it.outdated)
  const incomplete = (out.items || []).filter((it) => it.latestErrorCode)
  if (!out.items?.length) return 'web profile 没有已装插件。'
  const head: string[] = []
  if (outdated.length) {
    head.push(
      `${outdated.length}/${out.items.length} 个插件可升级：`,
      outdated.map((it) => `${it.name} (${it.pkg})：v${it.version} → ${it.latestTag || (it.latestVersion ? `v${it.latestVersion}` : '最新')}`).join('\n'),
    )
  } else {
    head.push(`全部 ${out.items.length} 个插件均已是最新版本。`)
  }
  // 禁止「未完成检查」冒充「全部最新」（Task 7 ⑨）：按 code 安全化原因列出
  if (incomplete.length) {
    head.push(
      `${incomplete.length} 项检查未完成：`,
      incomplete.map((it) => `· ${it.name} (${it.pkg})——${latestErrorCodeReason(it.latestErrorCode)}`).join('\n'),
    )
  }
  head.push('询问用户要升级哪个，确认后调 dshm_upgrade（pkg）。')
  return head.join('\n')
}

function renderUpgrade(out: InstallOut): string {
  const from = out.fromVersion ? `v${out.fromVersion} → ` : ''
  const to = out.version ? `v${out.version}` : out.sha ? out.sha.slice(0, 7) : '最新'
  const extra = buildsNote(out)
  return `✅ ${out.pkg} 已升级（${from}${to}）。${extra}需要重启生效——询问是否 dshm_restart。`
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
