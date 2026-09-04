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
  uninstallPlugin,
  upgradePlugin,
  withMutationLock,
  type InstalledResult,
} from './core/market.js'
import type { RegistryConfig, RegistryEntry, RegistryState } from './core/registry.js'
import { scheduleRestart } from './core/restart.js'

export const CATEGORY_LABELS: Record<RegistryEntry['category'], string> = {
  market: '市场',
  tools: '工具',
  ui: '界面',
  search: '搜索',
  media: '多媒体',
  other: '其他',
}

/** 可注入 market 依赖（测试用；生产走真实 core）。 */
export interface ToolMarketDeps {
  listMarket?: typeof listMarket
  listInstalledWithMeta?: typeof listInstalledWithMeta
  installFromRegistry?: typeof installFromRegistry
  uninstallPlugin?: typeof uninstallPlugin
  upgradePlugin?: typeof upgradePlugin
}

function cloneJson(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function summaryOf(state: RegistryState): { isDefault: boolean; status: string; stale: boolean } {
  return { isDefault: state.isDefault, status: state.status, stale: state.stale }
}

function matchInstalledByEntry(
  entry: RegistryEntry,
  installed: Array<{ pkg: string; name: string; spec: string; version: string; source: string }>,
) {
  return installed.find((it) => {
    if (entry.npm && (it.pkg === entry.npm || it.name === entry.npm)) return true
    if (entry.github && it.source === 'github') {
      const m = /^github:([^#]+)/.exec(it.spec)
      if (m && m[1] === entry.github) return true
    }
    return false
  })
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

  ctx.tools.register(defineTool({
    name: 'dshm_search',
    description:
      'Search your personal DSH plugin marketplace (dsh-m) and show clickable plugin cards. ALWAYS call this instead of web_search or bash when the user wants to find/recommend/browse their curated DSH plugins (插件). Call EXACTLY ONCE per user message; extract a real keyword (主题, 搜索) rather than pasting the whole sentence. Omit query to browse all listings. After cards appear, reply with AT MOST one short sentence. Do not print install commands.',
    parameters: {
      query: { type: 'string', description: 'Main keyword, e.g. 主题 or 搜索. Optional.' },
      category: {
        type: 'string',
        description: `Optional first-level category: ${Object.keys(CATEGORY_LABELS).join(', ')}`,
      },
      limit: { type: 'number', description: 'Cards in this batch. Default all (registry is curated & small).' },
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
    timeoutMs: timeoutMs + 5000,
    async execute(args) {
      const category = typeof args.category === 'string' && args.category ? (args.category as RegistryEntry['category']) : null
      const rawLimit = Number(args.limit)
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? clamp(rawLimit, 1, 80) : undefined
      // metadata-only：agent 卡片不需要 latest；与 Host GUI 共用 host namespace
      const result = await m.listMarket(cfg, {
        query: String(args.query || ''),
        category,
        offset: 0,
        limit,
        withLatest: false,
        namespace: 'host',
      })
      const installed = await import('./core/installed.js')
      const inst = await installed.listInstalledPlugins()
      const merged = result.items.map((e) => {
        const i = matchInstalledByEntry(e, inst.items)
        return { ...e, installed: Boolean(i), installedPkg: i?.pkg, installedVersion: i?.version }
      })
      return cloneJson({
        query: String(args.query || ''),
        category,
        total: result.total,
        registry: summaryOf(result.registryState),
        items: merged.map((e) => ({
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
    timeoutMs: timeoutMs + 5000,
    async execute() {
      const result: InstalledResult = await m.listInstalledWithMeta(cfg, { namespace: 'host' })
      return cloneJson({
        registry: summaryOf(result.registryState),
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
        })),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dshm_install',
    description:
      'Install a plugin from the dsh-m registry into the current web profile after the user names one (装 dsh-skins / 安装 web-search). Pass the id from dshm_search results. npm 源锁定最新精确版本，github 源锁定 commit SHA。Do not print CLI commands. After success, tell the user it needs a restart of dsh web, and offer dshm_restart.',
    parameters: {
      id: { type: 'string', required: true, description: '收录 id from dshm_search, e.g. dsh-skins' },
      version: { type: 'string', description: 'Optional exact semver (npm 源). Default latest.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderInstall(value as InstallOut) }],
      presentationMeta: (_args, value) => ({ kind: 'dshm-install', ...(value as object) }),
    },
    presentCall: (args) => ({ card: 'generic', title: `安装 · ${String(args.id || '')}`, kind: 'search', content: [] }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '安装失败' : `已安装 · ${(meta as InstallOut | undefined)?.pkg || ''}`,
      content: [],
    }),
    timeoutMs: installTimeoutMs() + 60_000,
    async execute(args) {
      const id = String(args.id || '').trim()
      if (!id) throw new Error('缺少收录 id')
      const version = typeof args.version === 'string' && args.version.trim() ? args.version.trim() : undefined
      return cloneJson(await withMutationLock(() => m.installFromRegistry(id, cfg, { version, namespace: 'host' })))
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
      return cloneJson(await withMutationLock(() => m.uninstallPlugin(target, cfg, { namespace: 'host' })))
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
      return { card: 'generic', title: isError ? '检查失败' : n ? `${n} 个可升级` : '全部最新', content: [] }
    },
    timeoutMs: timeoutMs + 10_000,
    async execute() {
      const result: InstalledResult = await m.listInstalledWithMeta(cfg, { namespace: 'host' })
      const items = result.items.map((it) => ({
        pkg: it.pkg,
        name: it.name,
        version: it.version,
        source: it.source,
        latestVersion: it.latestVersion ?? null,
        latestTag: it.latestTag ?? null,
        outdated: it.outdated,
      }))
      return cloneJson({
        registry: summaryOf(result.registryState),
        items,
        outdatedCount: items.filter((it) => it.outdated).length,
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
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '升级失败' : `已升级 · ${(meta as InstallOut | undefined)?.pkg || ''}`,
      content: [],
    }),
    timeoutMs: installTimeoutMs() + 60_000,
    async execute(args) {
      const target = String(args.pkg || '').trim()
      if (!target) throw new Error('缺少 pkg')
      return cloneJson(await withMutationLock(() => m.upgradePlugin(target, cfg, { namespace: 'host' })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dshm_restart',
    description:
      'Restart DSH web so newly installed/uninstalled/upgraded plugins take effect. ONLY call after the user agrees (用户同意重启后). The page reloads automatically after the service comes back.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: `已请求重启 DSH web（via ${(value as { via?: string }).via}）。服务几秒内恢复，之后让用户刷新页面即可。对用户最多一句短话。`,
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
      return cloneJson(scheduleRestart(null))
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
  items?: Array<{ pkg: string; name: string; version: string; source: string; latestVersion?: string | null; latestTag?: string | null; outdated?: boolean; registryId?: string | null }>
}
interface InstallOut {
  pkg?: string
  spec?: string
  version?: string
  sha?: string
  usedAllowAllBuilds?: boolean
  fromVersion?: string
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
  const extra = out.usedAllowAllBuilds ? '注意：该插件执行了构建脚本（已按策略放行）。' : ''
  return `✅ ${out.pkg} 已安装（${out.spec}）。${extra}需要重启 DSH Web 生效——告知用户并询问是否 dshm_restart。不要打印安装命令。`
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
  if (!out.items?.length) return 'web profile 没有已装插件。'
  if (!outdated.length) return `全部 ${out.items.length} 个插件均已是最新版本。对用户一句短话。`
  const lines = outdated.map((it) => `${it.name} (${it.pkg})：v${it.version} → ${it.latestTag || (it.latestVersion ? `v${it.latestVersion}` : '最新')}`)
  return [
    `${outdated.length}/${out.items.length} 个插件可升级：`,
    lines.join('\n'),
    '询问用户要升级哪个，确认后调 dshm_upgrade（pkg）。',
  ].join('\n')
}

function renderUpgrade(out: InstallOut): string {
  const from = out.fromVersion ? `v${out.fromVersion} → ` : ''
  const to = out.version ? `v${out.version}` : out.sha ? out.sha.slice(0, 7) : '最新'
  const extra = out.usedAllowAllBuilds ? '注意：该插件执行了构建脚本。' : ''
  return `✅ ${out.pkg} 已升级（${from}${to}）。${extra}需要重启生效——询问是否 dshm_restart。`
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
