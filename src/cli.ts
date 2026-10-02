#!/usr/bin/env node
/**
 * dshm — DSH Marketplace 薄 CLI（DESIGN.md §5）。与 dshm_* agent 工具同核。
 * 变更类命令（uninstall/upgrade/restart）必须带 --yes 显式确认。
 * 独立 CLI 固定 namespace:'cli'（与 Host 的 host namespace cache 互不影响）；
 * registry/search/list/outdated 在清单不可用时打印配置/实际生效地址并 exit 1。
 */
import {
  installFromRegistry,
  listInstalledWithMeta,
  listMarket,
  uninstallPlugin,
  upgradePlugin,
  InstallGuardError,
  type InstalledResult,
  type MarketResult,
} from './core/market.js'
import { togglePlugin as coreTogglePlugin } from './core/toggle.js'
import { loadRegistry, type LoadedRegistry, type RegistryConfig } from './core/registry.js'
import { COMMUNITY_CATEGORY_LABELS } from './core/community.js'
import { scheduleRestart } from './core/restart.js'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

/** 分类中文标签（0.7.0 Task 6；0.9.16 策展五桶）：精选策展桶本地表 + 社区已知标签单一事实源；未知 slug 原样。 */
const CLI_CATEGORY_LABELS: Record<string, string> = {
  essentials: '装机必备',
  'cui-picks': '崔添翼精选',
  'self-dev': 'iasi自研',
  'tencent-lighthouse': '腾讯轻量云专区',
  watchlist: '观察区',
}

function categoryLabelOf(category: string): string {
  return CLI_CATEGORY_LABELS[category] ?? COMMUNITY_CATEGORY_LABELS[category] ?? category
}

interface Parsed {
  cmd: string
  flags: Record<string, string | boolean>
}

/** 可注入 core 依赖（测试用；生产走真实实现）。 */
export interface CliDeps {
  listMarket?: typeof listMarket
  loadRegistry?: typeof loadRegistry
  listInstalledWithMeta?: typeof listInstalledWithMeta
  installFromRegistry?: typeof installFromRegistry
  uninstallPlugin?: typeof uninstallPlugin
  upgradePlugin?: typeof upgradePlugin
  togglePlugin?: typeof coreTogglePlugin
}

export interface CliIo {
  out?: (line: string) => void
  err?: (line: string) => void
}

function parseArgs(argv: string[]): Parsed {
  const cmd = argv[0] || 'help'
  const flags: Record<string, string | boolean> = {}
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next
      i++
    } else {
      flags[key] = true
    }
  }
  return { cmd, flags }
}

function cliConfig(): RegistryConfig {
  return {
    registryUrl: process.env.DSHM_REGISTRY_URL || undefined,
    timeoutMs: Number(process.env.DSHM_TIMEOUT_MS) || 20_000,
    cacheTtlMin: Number(process.env.DSHM_CACHE_TTL_MIN) || 60,
    // DSHM_COMMUNITY_CATALOG=0 → 退出社区清单（合并市场退回纯主清单）
    communityCatalog: process.env.DSHM_COMMUNITY_CATALOG === '0' ? false : undefined,
    communityCatalogPin: process.env.DSHM_COMMUNITY_CATALOG_PIN || undefined,
  }
}

/** 搜索工具 deadline 对齐（Task 7）：CLI 无请求 signal，deadline 44s 与工具侧一致。 */
const SEARCH_CORE_DEADLINE_MS = 44_000
const INSTALLED_CORE_DEADLINE_MS = 60_000

/** latestErrorCode → 安全化原因（与 tools.ts 同表；CLI 终端呈现）。 */
function latestErrorCodeReason(code: string | null | undefined): string {
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

function needFlag(flags: Record<string, string | boolean>, name: string): string {
  const v = flags[name]
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`缺少 --${name} 参数`)
  }
  return v.trim()
}

/** 构建放行输出（ADR-0002）：列包名；兜底全量放行如实标注。 */
function outBuildsNote(
  res: { buildApprovals?: string[]; fallbackAllBuilds?: boolean },
  out: (line: string) => void,
): void {
  if (res.fallbackAllBuilds === true) {
    out('⚠️  该插件执行了构建脚本（名单不可读，已全量兜底放行）。')
    return
  }
  const names = res.buildApprovals ?? []
  if (names.length > 0) out(`⚠️  该插件执行了构建脚本，已精确放行：${names.join('、')}。`)
}

function requireYes(flags: Record<string, string | boolean>, action: string): void {
  if (flags.yes !== true) {
    throw new Error(`拒绝执行：${action} 是变更操作，必须带 --yes 显式确认。`)
  }
}

function sourceLabel(s: string): string {
  return { npm: 'npm', github: 'github', link: '本地 link', file: '本地 file', unknown: '未知' }[s] || s
}

/** registry 来源的用户友好名称（CLI 本地终端可见）。 */
function registrySourceLabel(s: string): string {
  return {
    'default-raw': 'GitHub 原始文件（@main）',
    'default-jsdelivr': 'GitHub 镜像（备用）',
    'default-cache': '默认清单缓存',
    bundled: '包内快照（兜底）',
    'custom-url': '自定义 URL 源',
    'custom-file': '本地文件源',
    'custom-cache': '自定义源（缓存）',
    'custom-unavailable': '自定义源（不可用）',
  }[s] || s
}

function addressLines(state: { configuredAddress: string; activeAddress: string | null }): string[] {
  return [
    `配置地址：${state.configuredAddress === '' ? '（默认官方清单）' : state.configuredAddress}`,
    `实际生效：${state.activeAddress ?? '—'}`,
  ]
}

function unavailableLines(state: { configuredAddress: string; activeAddress: string | null; errors: string[] }): string[] {
  return [
    '收录清单当前不可用：',
    ...addressLines(state),
    state.errors.length ? `错误：${state.errors.join('；')}` : '',
  ].filter(Boolean)
}

const HELP = `dshm — DSH Marketplace（DSH 插件市场：精选策展 + 社区目录双清单）

用法：dshm <命令> [参数]

只读命令：
  dshm search [--query 关键词] [--category market|tools|ui|search|other|<社区slug>] [--source primary|community|all] [--limit N] [--offset N]
                                        （source 分区：community=社区目录 4000+ 条 / primary=精选策展 / all=默认；limit 默认 10；offset 翻页）
  dshm list                          列出 web profile 已装插件（含市场标注/可升级）
  dshm outdated                      检查已装插件的最新版本
  dshm registry                      查看收录清单来源与条目

变更命令（必须 --yes）：
  dshm install --id <收录id> [--version 1.2.3] [--force]   （--force：确认兼容风险后跳过预检拦截）
  dshm upgrade --pkg <包名> --yes [--force]
  dshm uninstall --pkg <包名> --yes
  dshm toggle --pkg <包名> --on|--off --yes   （切换运行状态；文件级编辑，重启生效）
  dshm restart --yes
  注意：变更互斥仅在进程内生效——变更执行期间不要同时从 GUI / Agent 工具发起另一次变更。

profile 目标（0.9.0）：CLI 恒作用于 web profile；--profile web 为显式声明，
  --profile desktop 会被拒绝——Desktop profile 的插件管理走官方 Desktop 插件管理页。

环境变量：DSHM_REGISTRY_URL（registry 源覆盖）、DSHM_TIMEOUT_MS、DSHM_CACHE_TTL_MIN、DSHM_CACHE_DIR、
  DSHM_COMMUNITY_CATALOG=0（退出社区清单）、DSHM_COMMUNITY_CATALOG_PIN（锁定社区目录版本）
`

export async function runCli(argv: string[], deps: CliDeps = {}, io: CliIo = {}): Promise<number> {
  const out = io.out ?? ((line: string) => console.log(line))
  const err = io.err ?? ((line: string) => console.error(line))
  try {
    return await runCliDispatch(argv, deps, { out, err })
  } catch (e) {
    // 业务错误统一在这里打印并 exit 1（覆盖 install/upgrade/uninstall 等）
    err(`错误：${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}

async function runCliDispatch(argv: string[], deps: CliDeps, io: Required<CliIo>): Promise<number> {
  const { out, err } = io
  const d = {
    listMarket: deps.listMarket ?? listMarket,
    loadRegistry: deps.loadRegistry ?? loadRegistry,
    listInstalledWithMeta: deps.listInstalledWithMeta ?? listInstalledWithMeta,
    installFromRegistry: deps.installFromRegistry ?? installFromRegistry,
    uninstallPlugin: deps.uninstallPlugin ?? uninstallPlugin,
    upgradePlugin: deps.upgradePlugin ?? upgradePlugin,
    togglePlugin: deps.togglePlugin ?? coreTogglePlugin,
  }
  const { cmd, flags } = parseArgs(argv)
  const cfg = cliConfig()

  // 0.9.0 双 profile（ADR-0005）：CLI 是 Web-only 入口（独立进程拿不到宿主 profileContext，
  // 目标恒为 web profile）；--profile desktop / 其他非 web 值显式拒绝并指引官方入口，
  // 绝不隐式回落 web（报告 §5.3「不能从不存在的 Desktop 模式推断」）。
  const profileFlag = typeof flags.profile === 'string' ? flags.profile.trim() : ''
  if (profileFlag !== '' && profileFlag !== 'web') {
    err(`错误：dshm CLI 仅作用于 web profile，不支持 --profile ${profileFlag}。`)
    err('Desktop profile 的插件管理请使用官方 Desktop 的插件管理页（Settings → Plugins），或回到 DSH Web 端使用 dsh-m。')
    return 1
  }

  switch (cmd) {
    case 'help':
    case '--help':
    case '-h':
      out(HELP)
      return 0

    case 'search': {
      // metadata-only：不构造全量 latest；source/offset/limit 直接交给 core（0.7.0 Task 6：与工具同语义）；
      // 双源判定：主清单 unavailable 但社区有条目 → 照常出页（Q42）；两层皆不可用 → exit 1
      const sourceRaw = typeof flags.source === 'string' ? flags.source : ''
      if (sourceRaw !== '' && sourceRaw !== 'primary' && sourceRaw !== 'community' && sourceRaw !== 'all') {
        err(`错误：非法 source: ${sourceRaw}（需 primary/community/all）`)
        return 1
      }
      const source = sourceRaw === '' ? 'all' : sourceRaw
      const limitRaw = Number(flags.limit)
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(80, Math.max(1, Math.floor(limitRaw))) : 10
      const offsetRaw = Number(flags.offset)
      const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0
      const result: MarketResult = await d.listMarket(cfg, {
        query: typeof flags.query === 'string' ? flags.query : undefined,
        category: typeof flags.category === 'string' ? flags.category : null,
        source,
        offset,
        limit,
        withLatest: false,
        namespace: 'cli',
        deadlineMs: SEARCH_CORE_DEADLINE_MS,
      })
      if (result.registryState.status === 'unavailable') {
        if (result.community.status !== 'ready' && result.community.status !== 'stale') {
          for (const line of unavailableLines(result.registryState)) err(line)
          return 1
        }
        err(`提示：收录清单不可用，当前展示社区清单条目（${result.community.acceptedCount} 条）。`)
      }
      if (result.community.status === 'stale') err('提示：社区目录为缓存快照（探测未完成，显示的不是最新数据）。')
      if (!result.items.length) {
        out('没有匹配的收录条目。')
        return 0
      }
      for (const it of result.items) {
        const inst = it.installed ? ` [已安装 v${it.installedVersion || '?'}]` : ''
        const zone = it.community === true ? '[社区] ' : ''
        out(`• ${it.name} (${it.id})${zone}· ${categoryLabelOf(it.category)} · ${it.source}${inst}`)
        out(`  ${it.description}`)
      }
      const shown = result.items.length
      const nextOffset = offset + shown < result.total ? offset + shown : null
      const s = result.registryState
      out(`\n来源：${registrySourceLabel(s.source)}${s.stale ? '（缓存）' : ''} · 更新：${s.fetchedAt ?? '—'} · 共 ${result.total} 条`)
      const c = result.community
      if (c.status !== 'skipped') {
        const cLabel = c.status === 'ready' ? '就绪' : c.status === 'stale' ? '缓存快照' : c.status
        out(`社区：${cLabel} · 收录 ${c.acceptedCount} · 版本 ${c.version ?? '—'} · 线路 ${c.route ?? '—'}`)
      }
      out(
        nextOffset !== null
          ? `已显示 ${offset + 1}–${offset + shown} · 翻页：加 --offset ${nextOffset}（其余参数不变）`
          : `已显示 ${offset + 1}–${offset + shown} · 已到末尾`,
      )
      return 0
    }

    case 'list': {
      const result: InstalledResult = await d.listInstalledWithMeta(cfg, { namespace: 'cli' })
      if (result.registryState.status === 'unavailable') {
        for (const line of unavailableLines(result.registryState)) out(line)
        out('（registry 不可用，仅列出已装插件）')
      }
      if (!result.items.length) {
        out(`web profile（${result.profileDir}）还没有已装的 dsh 插件。`)
        return 0
      }
      for (const it of result.items) {
        const marks = [
          it.registryId ? '市场' : '非市场',
          it.outdated && it.latestVersion ? `可升级 → v${it.latestVersion}` : null,
        ].filter(Boolean).join('，')
        out(`• ${it.name} (${it.pkg}) v${it.version || '?'} · ${sourceLabel(it.source)}${marks ? ` · ${marks}` : ''}`)
      }
      if (result.others) out(`\n另有 ${result.others} 个非 dsh 依赖未列出。`)
      return 0
    }

    case 'outdated': {
      // 双源判定（Task 7 ⑧）：主 unavailable + 社区 ready → 正常输出 + warning；
      // 社区 stale → 「缓存快照」行；两层皆不可用 → exit 1
      const result: InstalledResult = await d.listInstalledWithMeta(cfg, { namespace: 'cli', deadlineMs: INSTALLED_CORE_DEADLINE_MS })
      if (result.registryState.status === 'unavailable') {
        if (result.community.status !== 'ready' && result.community.status !== 'stale') {
          for (const line of unavailableLines(result.registryState)) err(line)
          return 1
        }
        err('提示：收录清单不可用，更新判定仅覆盖社区收录与本地源。')
      }
      if (result.community.status === 'stale') err('提示：社区目录为缓存快照（显示的不是最新数据）。')
      const outdated = result.items.filter((it) => it.outdated)
      const incomplete = result.items.filter((it) => it.latestErrorCode)
      // 禁止「未完成检查」冒充「全部最新」（Task 7 ⑨）
      if (!outdated.length) {
        if (incomplete.length) {
          out(`${result.items.length} 个插件中没有可升级项；另有 ${incomplete.length} 项检查未完成：`)
          for (const it of incomplete) out(`  · ${it.name} (${it.pkg})——${latestErrorCodeReason(it.latestErrorCode)}`)
          return 0
        }
        out(`全部 ${result.items.length} 个插件均已是最新版本。`)
        return 0
      }
      for (const it of outdated) {
        out(`• ${it.name} (${it.pkg})：v${it.version} → ${it.latestVersion || '最新'}`)
      }
      if (incomplete.length) {
        out(`\n另有 ${incomplete.length} 项检查未完成：`)
        for (const it of incomplete) out(`  · ${it.name} (${it.pkg})——${latestErrorCodeReason(it.latestErrorCode)}`)
      }
      out(`\n升级：dshm upgrade --pkg <包名> --yes`)
      return 0
    }

    case 'registry': {
      const loaded: LoadedRegistry = await d.loadRegistry(cfg, { namespace: 'cli', force: flags.force === true })
      if (loaded.status === 'unavailable') {
        for (const line of unavailableLines(loaded)) err(line)
        return 1
      }
      out(`来源：${registrySourceLabel(loaded.source)} · 更新时间：${loaded.fetchedAt ?? '—'} · 条目：${loaded.count}`)
      for (const line of addressLines(loaded)) out(line)
      for (const e of loaded.registry.plugins) {
        out(`  • ${e.id} · ${e.name} · ${e.category} · ${e.source === 'npm' ? e.npm : e.github}`)
      }
      if (loaded.errors.length) out(`提示：${loaded.errors.join('；')}`)
      return 0
    }

    case 'install': {
      const id = needFlag(flags, 'id')
      const version = typeof flags.version === 'string' ? flags.version : undefined
      let res
      try {
        res = await d.installFromRegistry(id, cfg, {
          version,
          forceIncompatible: flags.force === true,
          namespace: 'cli',
        })
      } catch (e) {
        if (e instanceof InstallGuardError) {
          err('[⛔ 装后守卫拦截] ' + JSON.stringify({ kind: e.kind, violations: e.violations, compensation: e.compensation, needsRestart: e.needsRestart, restartSafe: e.restartSafe, ...(e.repairBasis ? { repairBasis: e.repairBasis } : {}) }))
          err(e.message)
          err(e.restartSafe ? '可以重启 DSH Web：dshm restart --yes' : '修复后再重启（不要现在重启）。')
          return 1
        }
        throw e
      }
      out(`✅ 已安装 ${res.pkg}（${res.spec}）`)
      outBuildsNote(res, out)
      out('需要重启 DSH Web 生效：dshm restart --yes')
      return 0
    }

    case 'upgrade': {
      const target = needFlag(flags, 'pkg')
      requireYes(flags, '升级')
      let res
      try {
        res = await d.upgradePlugin(target, cfg, {
          forceIncompatible: flags.force === true,
          namespace: 'cli',
        })
      } catch (e) {
        if (e instanceof InstallGuardError) {
          err('[⛔ 装后守卫拦截] ' + JSON.stringify({ kind: e.kind, violations: e.violations, compensation: e.compensation, needsRestart: e.needsRestart, restartSafe: e.restartSafe, ...(e.repairBasis ? { repairBasis: e.repairBasis } : {}) }))
          err(e.message)
          err(e.restartSafe ? '可以重启 DSH Web：dshm restart --yes' : '修复后再重启（不要现在重启）。')
          return 1
        }
        throw e
      }
      const from = res.fromVersion ? `v${res.fromVersion} → ` : ''
      const to = res.version ? `v${res.version}` : res.sha ? res.sha.slice(0, 7) : '最新'
      out(`✅ 已升级 ${res.pkg}（${from}${to}）`)
      outBuildsNote(res, out)
      out('需要重启 DSH Web 生效：dshm restart --yes')
      return 0
    }

    case 'toggle': {
      const target = needFlag(flags, 'pkg')
      const onFlag = flags.on === true
      const offFlag = flags.off === true
      if (onFlag === offFlag) throw new Error('开关命令需要恰好一个 --on 或 --off')
      requireYes(flags, '切换插件运行状态')
      const res = await d.togglePlugin(target, onFlag)
      out(`✅ 已${onFlag ? '启用' : '停用'} ${res.pkg}（profile 文件已更新）`)
      if (res.applied === 'live') out('本次进程内已即时生效；重启后状态保持。')
      else out('需要重启 DSH Web 生效：dshm restart --yes')
      return 0
    }

    case 'uninstall': {
      const target = needFlag(flags, 'pkg')
      requireYes(flags, '卸载')
      const res = await d.uninstallPlugin(target, cfg, { namespace: 'cli' })
      out(`✅ 已卸载 ${res.pkg}${res.liveDisabled ? '（运行中的界面已先下线）' : ''}`)
      if (res.leftovers.length) out(`ℹ️  疑似残留数据（未删除）：${res.leftovers.join('、')}`)
      out('需要重启 DSH Web 生效：dshm restart --yes')
      return 0
    }

    case 'restart': {
      requireYes(flags, '重启 DSH Web')
      const res = scheduleRestart(null)
      out(`✅ 已请求重启（via ${res.via}）。服务恢复后刷新页面即可。`)
      return 0
    }

    default: {
      err(`未知命令：${cmd}\n`)
      out(HELP)
      return 1
    }
  }
}

/** 仅在直接执行（bin/node lib/cli.js）时运行；被测试导入时无副作用。 */
const invokedDirectly = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((err) => {
      console.error('错误：', err instanceof Error ? err.message : String(err))
      process.exitCode = 1
    })
}
