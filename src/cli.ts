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
  withMutationLock,
  type InstalledResult,
  type MarketResult,
} from './core/market.js'
import { loadRegistry, type LoadedRegistry, type RegistryConfig } from './core/registry.js'
import { scheduleRestart } from './core/restart.js'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

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
  }
}

function needFlag(flags: Record<string, string | boolean>, name: string): string {
  const v = flags[name]
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`缺少 --${name} 参数`)
  }
  return v.trim()
}

function requireYes(flags: Record<string, string | boolean>, action: string): void {
  if (flags.yes !== true) {
    throw new Error(`拒绝执行：${action} 是变更操作，必须带 --yes 显式确认。`)
  }
}

function sourceLabel(s: string): string {
  return { npm: 'npm', github: 'github', link: '本地 link', file: '本地 file', unknown: '未知' }[s] || s
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

const HELP = `dshm — DSH Marketplace（个人自用 DSH 插件市场）

用法：dshm <命令> [参数]

只读命令：
  dshm search [--query 关键词] [--category market|tools|ui|search|media|other] [--limit N]
  dshm list                          列出 web profile 已装插件（含市场标注/可升级）
  dshm outdated                      检查已装插件的最新版本
  dshm registry                      查看收录清单来源与条目

变更命令（必须 --yes）：
  dshm install --id <收录id> [--version 1.2.3]
  dshm upgrade --pkg <包名> --yes
  dshm uninstall --pkg <包名> --yes
  dshm restart --yes

环境变量：DSHM_REGISTRY_URL（registry 源覆盖）、DSHM_TIMEOUT_MS、DSHM_CACHE_TTL_MIN、DSHM_CACHE_DIR
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
  }
  const { cmd, flags } = parseArgs(argv)
  const cfg = cliConfig()

  switch (cmd) {
    case 'help':
    case '--help':
    case '-h':
      out(HELP)
      return 0

    case 'search': {
      // metadata-only：不构造全量 latest，query/category/limit 直接交给 core
      const limit = Number.isFinite(Number(flags.limit)) && Number(flags.limit) > 0 ? Number(flags.limit) : undefined
      const result: MarketResult = await d.listMarket(cfg, {
        query: typeof flags.query === 'string' ? flags.query : undefined,
        category: typeof flags.category === 'string' ? (flags.category as never) : null,
        offset: 0,
        limit,
        withLatest: false,
        namespace: 'cli',
      })
      if (result.registryState.status === 'unavailable') {
        for (const line of unavailableLines(result.registryState)) err(line)
        return 1
      }
      if (!result.items.length) {
        out('没有匹配的收录条目。')
        return 0
      }
      for (const it of result.items) {
        const inst = it.installed ? ` [已安装 v${it.installedVersion || '?'}]` : ''
        out(`• ${it.name} (${it.id}) · ${it.category} · ${it.source}${inst}`)
        out(`  ${it.description}`)
      }
      const s = result.registryState
      out(`\n来源：${s.source}${s.stale ? '（缓存）' : ''} · 更新：${s.fetchedAt ?? '—'} · 共 ${result.total} 条`)
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
      const result: InstalledResult = await d.listInstalledWithMeta(cfg, { namespace: 'cli' })
      if (result.registryState.status === 'unavailable') {
        for (const line of unavailableLines(result.registryState)) err(line)
        return 1
      }
      const outdated = result.items.filter((it) => it.outdated)
      if (!outdated.length) {
        out(`全部 ${result.items.length} 个插件均已是最新版本。`)
        return 0
      }
      for (const it of outdated) {
        out(`• ${it.name} (${it.pkg})：v${it.version} → ${it.latestVersion || '最新'}`)
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
      out(`来源：${loaded.source} · 更新时间：${loaded.fetchedAt ?? '—'} · 条目：${loaded.count}`)
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
      const res = await withMutationLock(() => d.installFromRegistry(id, cfg, { version, namespace: 'cli' }))
      out(`✅ 已安装 ${res.pkg}（${res.spec}）`)
      if (res.usedAllowAllBuilds) out('⚠️  该插件执行了构建脚本（已按策略放行）。')
      out('需要重启 DSH Web 生效：dshm restart --yes')
      return 0
    }

    case 'upgrade': {
      const target = needFlag(flags, 'pkg')
      requireYes(flags, '升级')
      const res = await withMutationLock(() => d.upgradePlugin(target, cfg, { namespace: 'cli' }))
      const from = res.fromVersion ? `v${res.fromVersion} → ` : ''
      const to = res.version ? `v${res.version}` : res.sha ? res.sha.slice(0, 7) : '最新'
      out(`✅ 已升级 ${res.pkg}（${from}${to}）`)
      if (res.usedAllowAllBuilds) out('⚠️  该插件执行了构建脚本（已按策略放行）。')
      out('需要重启 DSH Web 生效：dshm restart --yes')
      return 0
    }

    case 'uninstall': {
      const target = needFlag(flags, 'pkg')
      requireYes(flags, '卸载')
      const res = await withMutationLock(() => d.uninstallPlugin(target, cfg, { namespace: 'cli' }))
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
