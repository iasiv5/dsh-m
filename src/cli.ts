#!/usr/bin/env node
/**
 * dshm — DSH Marketplace 薄 CLI（DESIGN.md §5）。与 dshm_* agent 工具同核。
 * 变更类命令（uninstall/upgrade/restart）必须带 --yes 显式确认。
 */
import {
  installFromRegistry,
  listInstalledWithMeta,
  uninstallPlugin,
  upgradePlugin,
  withMutationLock,
} from './core/market.js'
import { loadRegistry } from './core/registry.js'
import { scheduleRestart } from './core/restart.js'
import type { RegistryConfig } from './core/registry.js'

interface Parsed {
  cmd: string
  flags: Record<string, string | boolean>
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
    console.error(`错误：缺少 --${name} 参数`)
    process.exit(1)
  }
  return v.trim()
}

function requireYes(flags: Record<string, string | boolean>, action: string): void {
  if (flags.yes !== true) {
    console.error(`拒绝执行：${action} 是变更操作，必须带 --yes 显式确认。`)
    process.exit(1)
  }
}

function sourceLabel(s: string): string {
  return { npm: 'npm', github: 'github', link: '本地 link', file: '本地 file', unknown: '未知' }[s] || s
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

async function main(): Promise<number> {
  const { cmd, flags } = parseArgs(process.argv.slice(2))
  const cfg = cliConfig()

  switch (cmd) {
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP)
      return 0

    case 'search': {
      const { listMarket } = await import('./core/market.js')
      const result = await listMarket(cfg)
      const q = typeof flags.query === 'string' ? flags.query.toLowerCase() : ''
      const cat = typeof flags.category === 'string' ? flags.category : null
      const limit = Number(flags.limit) || Infinity
      const items = result.items.filter((it) => {
        if (cat && it.category !== cat) return false
        if (!q) return true
        return `${it.id} ${it.name} ${it.description} ${it.tags.join(' ')}`.toLowerCase().includes(q)
      }).slice(0, limit)
      if (!items.length) {
        console.log('没有匹配的收录条目。')
        return 0
      }
      for (const it of items) {
        const inst = it.installed ? ` [已安装 v${it.installedVersion || '?'}]` : ''
        const latest = it.latestVersion ? ` 最新 v${it.latestVersion}` : it.latestSha ? ` HEAD ${it.latestSha.slice(0, 7)}` : ''
        console.log(`• ${it.name} (${it.id}) · ${it.category} · ${it.source}${inst}${latest}`)
        console.log(`  ${it.description}`)
      }
      console.log(`\n来源：${result.registrySource}（${result.registryFetchedAt ?? '—'}），共 ${result.items.length} 条`)
      return 0
    }

    case 'list': {
      const result = await listInstalledWithMeta(cfg)
      if (!result.items.length) {
        console.log(`web profile（${result.profileDir}）还没有已装的 dsh 插件。`)
        return 0
      }
      for (const it of result.items) {
        const marks = [
          it.registryId ? '市场' : '非市场',
          it.outdated && it.latestVersion ? `可升级 → v${it.latestVersion}` : null,
        ].filter(Boolean).join('，')
        console.log(`• ${it.name} (${it.pkg}) v${it.version || '?'} · ${sourceLabel(it.source)}${marks ? ` · ${marks}` : ''}`)
      }
      if (result.others) console.log(`\n另有 ${result.others} 个非 dsh 依赖未列出。`)
      return 0
    }

    case 'outdated': {
      const result = await listInstalledWithMeta(cfg)
      const outdated = result.items.filter((it) => it.outdated)
      if (!outdated.length) {
        console.log(`全部 ${result.items.length} 个插件均已是最新版本。`)
        return 0
      }
      for (const it of outdated) {
        console.log(`• ${it.name} (${it.pkg})：v${it.version} → ${it.latestVersion || '最新'}`)
      }
      console.log(`\n升级：dshm upgrade --pkg <包名> --yes`)
      return 0
    }

    case 'registry': {
      const loaded = await loadRegistry(cfg, { force: flags.force === true })
      console.log(`来源：${loaded.source} · 更新时间：${loaded.fetchedAt ?? '—'} · 条目：${loaded.registry.plugins.length}`)
      for (const e of loaded.registry.plugins) {
        console.log(`  • ${e.id} · ${e.name} · ${e.category} · ${e.source === 'npm' ? e.npm : e.github}`)
      }
      if (loaded.errors.length) console.log(`提示：${loaded.errors.join('；')}`)
      return 0
    }

    case 'install': {
      const id = needFlag(flags, 'id')
      const version = typeof flags.version === 'string' ? flags.version : undefined
      const res = await withMutationLock(() => installFromRegistry(id, cfg, { version }))
      console.log(`✅ 已安装 ${res.pkg}（${res.spec}）`)
      if (res.usedAllowAllBuilds) console.log('⚠️  该插件执行了构建脚本（已按策略放行）。')
      console.log('需要重启 DSH Web 生效：dshm restart --yes')
      return 0
    }

    case 'upgrade': {
      const target = needFlag(flags, 'pkg')
      requireYes(flags, '升级')
      const res = await withMutationLock(() => upgradePlugin(target, cfg))
      const from = res.fromVersion ? `v${res.fromVersion} → ` : ''
      const to = res.version ? `v${res.version}` : res.sha ? res.sha.slice(0, 7) : '最新'
      console.log(`✅ 已升级 ${res.pkg}（${from}${to}）`)
      if (res.usedAllowAllBuilds) console.log('⚠️  该插件执行了构建脚本（已按策略放行）。')
      console.log('需要重启 DSH Web 生效：dshm restart --yes')
      return 0
    }

    case 'uninstall': {
      const target = needFlag(flags, 'pkg')
      requireYes(flags, '卸载')
      const res = await withMutationLock(() => uninstallPlugin(target, cfg))
      console.log(`✅ 已卸载 ${res.pkg}${res.liveDisabled ? '（运行中的界面已先下线）' : ''}`)
      if (res.leftovers.length) console.log(`ℹ️  疑似残留数据（未删除）：${res.leftovers.join('、')}`)
      console.log('需要重启 DSH Web 生效：dshm restart --yes')
      return 0
    }

    case 'restart': {
      requireYes(flags, '重启 DSH Web')
      const res = scheduleRestart(null)
      console.log(`✅ 已请求重启（via ${res.via}）。服务恢复后刷新页面即可。`)
      return 0
    }

    default:
      console.error(`未知命令：${cmd}\n`)
      console.log(HELP)
      return 1
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err) => {
    console.error('错误：', err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
