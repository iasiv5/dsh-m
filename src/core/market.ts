/**
 * 市场编排层：registry × profile × 最新版本 → 市场列表 / 已装列表 / outdated /
 * 安装 / 卸载 / 升级。安装语义见 DESIGN.md §3（npm 精确锁定、GitHub 锁 SHA）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { addDshPlugin } from './dsh-cli.js'
import { dshHome, webProfileDir } from './env.js'
import {
  listInstalledPlugins,
  readProfileDeps,
  removeInstalledPlugin,
  type InstalledPlugin,
} from './installed.js'
import { setLivePluginDisabled } from './live-plugin.js'
import { loadRegistry, type LoadedRegistry, type RegistryConfig, type RegistryEntry } from './registry.js'
import { githubLatestTag, isNewerVersion, npmLatest } from './versions.js'

export interface MarketItem extends RegistryEntry {
  latestVersion?: string
  latestTag?: string
  latestSha?: string
  installed: boolean
  installedPkg?: string
  installedVersion?: string
  outdated: boolean
  /** 查询最新版本失败的说明（不阻塞列表） */
  latestError?: string
}

export interface MarketResult {
  items: MarketItem[]
  registrySource: LoadedRegistry['source']
  registryFetchedAt: string | null
  registryErrors: string[]
}

export interface InstalledItem extends InstalledPlugin {
  registryId?: string
  latestTag?: string
  registryGithub?: string | null
  registryIcon?: string | null
  latestVersion?: string
  outdated: boolean
}

function matchInstalledByEntry(entry: RegistryEntry, installed: InstalledPlugin[]): InstalledPlugin | undefined {
  return installed.find((it) => {
    if (entry.npm && it.pkg === entry.npm) return true
    if (entry.npm && it.name === entry.npm) return true
    if (entry.github && it.source === 'github') {
      const m = /^github:([^#]+)/.exec(it.spec)
      if (m && m[1] === entry.github) return true
    }
    return false
  })
}

export async function listMarket(cfg: RegistryConfig = {}, opts: { force?: boolean } = {}): Promise<MarketResult> {
  const [loaded, installed] = await Promise.all([
    loadRegistry(cfg, opts),
    listInstalledPlugins(),
  ])
  const timeoutMs = cfg.timeoutMs ?? 20_000
  const items: MarketItem[] = []
  for (const entry of loaded.registry.plugins) {
    const inst = matchInstalledByEntry(entry, installed.items)
    const item: MarketItem = {
      ...entry,
      installed: Boolean(inst),
      outdated: false,
    }
    if (inst) {
      item.installedPkg = inst.pkg
      item.installedVersion = inst.version
    }
    try {
      if (entry.source === 'npm' && entry.npm) {
        const latest = await npmLatest(entry.npm, timeoutMs)
        item.latestVersion = latest.version
        if (inst?.version && isNewerVersion(latest.version, inst.version)) item.outdated = true
      } else if (entry.github) {
        const { tag, sha } = await githubLatestTag(entry.github, timeoutMs)
        item.latestTag = tag
        item.latestSha = sha
        if (inst && !inst.spec.includes(sha)) item.outdated = true
      }
    } catch (err) {
      item.latestError = err instanceof Error ? err.message : String(err)
    }
    items.push(item)
  }
  return {
    items,
    registrySource: loaded.source,
    registryFetchedAt: loaded.fetchedAt,
    registryErrors: loaded.errors,
  }
}

export async function listInstalledWithMeta(cfg: RegistryConfig = {}): Promise<{
  items: InstalledItem[]
  others: number
  profileDir: string
}> {
  const [{ items: installed, others, profileDir }, loaded] = await Promise.all([
    listInstalledPlugins(),
    loadRegistry(cfg),
  ])
  const timeoutMs = cfg.timeoutMs ?? 20_000
  const items: InstalledItem[] = []
  for (const it of installed) {
    const entry = loaded.registry.plugins.find((e) => matchInstalledByEntry(e, [it]))
    const item: InstalledItem = { ...it, outdated: false }
    if (entry) {
      item.registryId = entry.id
      item.registryGithub = entry.github ?? null
      item.registryIcon = entry.icon ?? null
    }
    try {
      if (!entry && it.source === 'npm') {
        const latest = await npmLatest(it.pkg, timeoutMs)
        item.latestVersion = latest.version
        item.outdated = isNewerVersion(latest.version, it.version)
      } else if (entry?.source === 'npm' && entry.npm) {
        const latest = await npmLatest(entry.npm, timeoutMs)
        item.latestVersion = latest.version
        item.outdated = isNewerVersion(latest.version, it.version)
      } else if (it.source === 'github') {
        const m = /^github:([^#]+)/.exec(it.spec)
        if (m) {
          const { tag, sha } = await githubLatestTag(m[1], timeoutMs)
          item.latestTag = tag
          item.outdated = !it.spec.includes(sha)
        }
      }
    } catch {
      /* 查询失败不阻塞列表，outdated 维持 false */
    }
    items.push(item)
  }
  return { items, others, profileDir }
}

export interface InstallResult {
  id: string
  pkg: string
  spec: string
  version?: string
  sha?: string
  usedAllowAllBuilds: boolean
  needsRestart: true
  output: string
}

/** 从 registry 收录条目安装（npm → 精确锁定最新版；github → 锁 HEAD SHA）。 */
export async function installFromRegistry(
  id: string,
  cfg: RegistryConfig = {},
  opts: { version?: string } = {},
): Promise<InstallResult> {
  const { registry } = await loadRegistry(cfg)
  const entry = registry.plugins.find((e) => e.id === id)
  if (!entry) throw new Error(`registry 中没有该条目: ${id}`)
  return installEntry(entry, cfg, opts)
}

export async function installEntry(
  entry: RegistryEntry,
  cfg: RegistryConfig = {},
  opts: { version?: string } = {},
): Promise<InstallResult> {
  const timeoutMs = cfg.timeoutMs ?? 20_000
  if (entry.source === 'npm' && entry.npm) {
    const version = opts.version && /^\d+\.\d+\.\d+/.test(opts.version) ? opts.version : (await npmLatest(entry.npm, timeoutMs)).version
    const spec = `${entry.npm}@${version}`
    const res = await addDshPlugin(spec)
    // 安装后校验：落盘版本必须与意图一致（tarball 完整性由 pnpm 按 lock integrity 保证）
    const deps = await readProfileDeps(webProfileDir())
    const specInProfile = deps[entry.npm]
    if (specInProfile === undefined) throw new Error(`安装后未在 profile 依赖中找到 ${entry.npm}`)
    return {
      id: entry.id,
      pkg: entry.npm,
      spec,
      version,
      usedAllowAllBuilds: res.usedAllowAllBuilds,
      needsRestart: true,
      output: res.output.slice(-800),
    }
  }
  if (entry.github) {
    const { tag, sha } = await githubLatestTag(entry.github, timeoutMs)
    const spec = `github:${entry.github}#${sha}`
    const res = await addDshPlugin(spec)
    const deps = await readProfileDeps(webProfileDir())
    const pkgKey = Object.keys(deps).find((k) => deps[k] === spec || deps[k].startsWith(`github:${entry.github}#`))
    if (!pkgKey) throw new Error(`安装后未在 profile 依赖中找到 ${entry.github}`)
    return {
      id: entry.id,
      pkg: pkgKey,
      spec,
      sha,
      usedAllowAllBuilds: res.usedAllowAllBuilds,
      needsRestart: true,
      output: res.output.slice(-800),
    }
  }
  throw new Error(`条目 ${entry.id} 缺少可安装来源`)
}

export interface UninstallResult {
  pkg: string
  liveDisabled: boolean
  needsRestart: true
  leftovers: string[]
}

/** 卸载：live-disable → pnpm remove → 报告疑似残留（DESIGN.md §3：删包不删数据）。 */
export async function uninstallPlugin(
  pkg: string,
  _cfg: RegistryConfig = {},
): Promise<UninstallResult> {
  const liveDisabled = await setLivePluginDisabled(pkg, true)
  await removeInstalledPlugin(pkg)
  return { pkg, liveDisabled, needsRestart: true, leftovers: leftoverCandidates(pkg) }
}

export interface UpgradeResult extends InstallResult {
  fromVersion?: string
}

/** 升级 = 按最新重新安装（npm 拉最新精确版；github 重新锁 HEAD）。 */
export async function upgradePlugin(pkg: string, cfg: RegistryConfig = {}): Promise<UpgradeResult> {
  const { registry } = await loadRegistry(cfg)
  const { items: installed } = await listInstalledPlugins()
  const target = installed.find((it) => it.pkg === pkg)
  if (!target) throw new Error(`web profile 未安装该插件: ${pkg}`)
  const entry = registry.plugins.find((e) => matchInstalledByEntry(e, [target]))
  if (!entry) throw new Error(`「${pkg}」不是经 dsh-m 收录的插件；直接升级请用 dsh plugin update 或先在 registry 收录它`)
  const result = await installEntry(entry, cfg)
  return { ...result, fromVersion: target.version }
}

/** 变更互斥：安装/卸载/升级串行执行（skillhub install-lock 同款思路）。 */
let mutationTail: Promise<unknown> = Promise.resolve()

export function withMutationLock<T>(task: () => Promise<T>): Promise<T> {
  const next = mutationTail.then(task, task)
  mutationTail = next.catch(() => undefined)
  return next
}

/** 疑似残留路径（存在才列出）：删包不删数据，只报告。 */
export function leftoverCandidates(pkg: string): string[] {
  const home = dshHome()
  const candidates = [
    join(home, `${pkg}.json`),
    join(home, pkg),
    join(home, `${pkg.replace(/^@[^/]+\//, '')}.json`),
  ]
  return candidates.filter((p) => existsSync(p))
}
