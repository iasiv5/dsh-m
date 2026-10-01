/**
 * ProfileOperations 接缝的 Desktop adapter（0.9.0，ADR-0005）。
 *
 * Desktop profile 的包操作一律委派官方 pluginManager（`ctx.get('pluginManager')`，
 * 鸭子类型投影，无静态依赖）：`installBundle(spec, { enabled?, approvedBuilds? })`。
 * dsh-m 保留自己的收录条目解析（resolveRegistryEntry）与 peer 兼容预检
 * （precheckNpmCompat，web 同语义）；完整性/锁/构建脚本审批/生效相位归官方管理器。
 *
 * 判定纪律（报告 §5.2，dsh-market #703/#772 实证）：
 * - 以 `application`/`stage` 为准，绝不只看 `packageResult.exitCode`——
 *   `stage:'enable'` + `application:'failed'` 可跟在 exitCode 0 之后；
 * - `application:'overridden'` 是「成功但被更高层 patch 覆盖」，如实标注非失败；
 * - 构建脚本：`build-blocked` + `pendingBuilds` → 结构化 needsBuildApproval 结果，
 *   重试把 pending 名单原样传回 `approvedBuilds`（键格式由官方管理器自己写），
 *   dsh-m 绝不直接编辑 desktop profile 的 pnpm-workspace.yaml，绝不全量放行；
 * - 成功判定 = 官方结果无 error + `listBundles()` 复读目标 bundle 在装，二者同时满足。
 *
 * 禁止事项：desktop 路径零 Web fallback——不做文件级装后守卫（app.asar 探测盲区）、
 * 不写 allowBuilds、不跑 dsh-m 自实现 pnpm 编排、服务缺席一律结构化拒绝。
 */
import { withMutationSession, resolveRegistryEntry, matchInstalledByEntry, type InstallableEntry, type InstallResult, type InstallDeps } from './market.js'
import { loadRegistry as defaultLoadRegistry } from './registry.js'
import { fetchCommunityCatalog as defaultFetchCommunityCatalog } from './community.js'
import { adaptCommunityCatalog } from './community-adapter.js'
import { listInstalledPlugins as defaultListInstalled } from './installed.js'
import { precheckNpmCompat, IncompatibleError, type CompatIssue } from './compat-check.js'
import { npmLatest as defaultNpmLatest, githubLatestTag as defaultGithubLatestTag } from './versions.js'
import { togglePlugin, ToggleError, type PluginManagerRow } from './toggle.js'
import type { RegistryConfig, RegistryCacheNamespace } from './registry.js'

/** 官方 pluginManager 的 Desktop 超集投影（运行时探测，缺方法按不可用处理）。 */
export interface DesktopManagerLike {
  listPlugins(): Promise<PluginManagerRow[]>
  setPluginEnabled(id: string, enabled: boolean): Promise<unknown>
  setBundleEnabled(name: string, enabled: boolean): Promise<unknown>
  installBundle?(spec: string, options?: { enabled?: boolean; approvedBuilds?: string[] }): Promise<unknown>
  /** 0.9.8：desktop 卸载委派（dsh-market 同策略：removeBundle，零 CLI、零文件级 fallback） */
  removeBundle?(name: string): Promise<unknown>
  listBundles?(): Promise<Array<{ name: string; installed?: boolean; enabled?: boolean }>>
}

export type DesktopOpsErrorCode = 'no-manager' | 'install-refused' | 'enable-failed' | 'remove-failed' | 'verify-failed'

export class DesktopOpsError extends Error {
  readonly code: DesktopOpsErrorCode
  constructor(code: DesktopOpsErrorCode, message: string) {
    super(message)
    this.name = 'DesktopOpsError'
    this.code = code
  }
}

/** 结构化信号：build-blocked + pendingBuilds（desktopInstall/Upgrade 共享，调用方映射各自返回形态）。 */
export class DesktopBuildApprovalNeeded extends Error {
  readonly pendingBuilds: string[]
  constructor(pending: string[]) {
    super(`该插件需要执行构建脚本（${pending.join('、')}）。确认后带同样的包名名单重试（approvedBuilds）；dsh-m 不做全量放行（ADR-0002 同语义）`)
    this.name = 'DesktopBuildApprovalNeeded'
    this.pendingBuilds = pending
  }
}

/**
 * 0.9.8：服务解析与 dsh-market 同源——同步探测（getService）缺席时可异步拉起
 * （host 侧经 cordis inject 等官方惰性服务实例化，短超时）。Windows 实机 2026-10-01：
 * host-api 曾漏传 deps 且一次性 get 探不到惰性服务 → 「官方 pluginManager 服务不可用」恒现。
 */
export interface DesktopEnsureService {
  ensureService?: (timeoutMs?: number) => Promise<DesktopManagerLike | undefined>
}

async function resolveManager(
  deps: DesktopEnsureService & { getService?: () => DesktopManagerLike | undefined },
): Promise<DesktopManagerLike | undefined> {
  const direct = deps.getService?.()
  if (direct) return direct
  return deps.ensureService ? await deps.ensureService() : undefined
}

/** 官方 ChangeResult 的鸭子读投影（不建类型依赖；字段缺席按 undefined 处理）。 */
export interface DesktopChangeResult {
  changed?: boolean
  application?: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  stage?: 'install' | 'enable' | 'remove'
  target?: string
  enabled?: boolean
  error?: { code?: string; diagnostic?: string }
  bundle?: string
  pendingBuilds?: string[]
  approvedBuilds?: string[]
  packageResult?: { exitCode?: number; kind?: string }
  warnings?: string[]
}

function changeOf(raw: unknown): DesktopChangeResult {
  if (raw && typeof raw === 'object') return raw as DesktopChangeResult
  return {}
}

export interface DesktopInstallOptions {
  version?: string
  forceIncompatible?: boolean
  /** 结构化 needsBuildApproval 后的重试通道：原样回传官方 pending 名单 */
  approvedBuilds?: string[]
  namespace?: RegistryCacheNamespace
  profile?: string
  signal?: AbortSignal
}

export interface DesktopInstallDeps {
  /** 官方服务探测（host.ts 与 tools.ts 共用同一 getter） */
  getService?: () => DesktopManagerLike | undefined
  /** 同步探测缺席时的惰性拉起通道（0.9.8；host 侧 inject 实现） */
  ensureService?: (timeoutMs?: number) => Promise<DesktopManagerLike | undefined>
  resolveEntry?: typeof resolveRegistryEntry
  npmLatest?: typeof defaultNpmLatest
  githubLatestTag?: typeof defaultGithubLatestTag
  precheck?: typeof precheckNpmCompat
  /** 透传给 resolveRegistryEntry（测试注入清单源） */
  loadRegistry?: InstallDeps['loadRegistry']
}

export type DesktopInstallResult =
  | (InstallResult & { via: 'desktop-manager'; overridden?: boolean })
  | {
      ok: false
      needsBuildApproval: true
      id: string
      pkg: string
      spec: string
      pendingBuilds: string[]
      message: string
    }

/**
 * Desktop 安装（仅新包）：收录条目解析（web 同源）→ spec 精确锁定 → compat 预检
 * （npm 源；web 同语义）→ 官方 installBundle → ChangeResult 判定 → listBundles 复读。
 * 全程 within mutation session（与 web 五入口同一 FIFO）。
 */
export async function desktopInstallFromRegistry(
  id: string,
  cfg: RegistryConfig = {},
  opts: DesktopInstallOptions = {},
  deps: DesktopInstallDeps = {},
): Promise<DesktopInstallResult> {
  return withMutationSession(() => desktopInstallLocked(id, cfg, opts, deps))
}

async function desktopInstallLocked(
  id: string,
  cfg: RegistryConfig,
  opts: DesktopInstallOptions,
  deps: DesktopInstallDeps,
): Promise<DesktopInstallResult> {
  const service = await resolveManager(deps)
  if (!service || typeof service.installBundle !== 'function') {
    throw new DesktopOpsError('no-manager', '官方 pluginManager 服务不可用（desktop profile 必须由官方管理器执行包操作）；拒绝安装（fail-closed）')
  }
  const timeoutMs = cfg.timeoutMs ?? 20_000
  const entry: InstallableEntry = await (deps.resolveEntry ?? resolveRegistryEntry)(id, cfg, opts, { loadRegistry: deps.loadRegistry })

  let spec: string
  let pkg: string
  let version: string | undefined
  let sha: string | undefined
  let tag: string | undefined
  let compat: CompatIssue | null = null
  let compatSkipped: 'github-source' | undefined

  if (entry.source === 'npm' && entry.npm) {
    pkg = entry.npm
    if (opts.version) {
      version = opts.version
    } else {
      const latest = await (deps.npmLatest ?? defaultNpmLatest)(pkg, timeoutMs, opts.signal)
      version = latest.version
    }
    spec = `${pkg}@${version}`
    // peer 兼容预检（web 同语义）：预检自身失败视为未检，不拦安装
    try {
      compat = await (deps.precheck ?? precheckNpmCompat)(pkg, version, { timeoutMs, signal: opts.signal })
    } catch {
      compat = null
    }
    if (compat !== null && opts.forceIncompatible !== true) throw new IncompatibleError(compat)
  } else if (entry.github) {
    // github 源：锁 HEAD SHA（web 同语义），不做兼容预检（明示 compatSkipped）
    const resolved = await (deps.githubLatestTag ?? defaultGithubLatestTag)(entry.github, timeoutMs, opts.signal)
    sha = resolved.sha
    tag = resolved.tag
    pkg = entry.github.split('/')[1] ?? entry.github
    spec = `github:${entry.github}#${sha}`
    compatSkipped = 'github-source'
  } else {
    throw new DesktopOpsError('install-refused', `收录条目 ${entry.id} 缺少 npm/github 来源，无法在 desktop 安装`)
  }

  let change: DesktopChangeResult
  let bundleName: string
  try {
    ({ change, bundleName } = await runManagedInstall(service, pkg, spec, opts.approvedBuilds))
  } catch (err) {
    if (err instanceof DesktopBuildApprovalNeeded) {
      return { ok: false, needsBuildApproval: true, id: entry.id, pkg, spec, pendingBuilds: err.pendingBuilds, message: err.message }
    }
    throw err
  }

  return {
    id: entry.id,
    pkg,
    spec,
    ...(version !== undefined ? { version } : {}),
    ...(sha !== undefined ? { sha } : {}),
    ...(tag !== undefined ? { tag } : {}),
    buildApprovals: Array.isArray(change.approvedBuilds) ? change.approvedBuilds : [],
    fallbackAllBuilds: false,
    ...(compat !== null ? { compat } : {}),
    ...(compatSkipped ? { compatSkipped } : {}),
    needsRestart: true,
    output: `official pluginManager: application=${change.application ?? 'applied'}, bundle=${bundleName}${change.changed === false ? ', changed=false' : ''}`,
    via: 'desktop-manager',
    ...(change.application === 'overridden' ? { overridden: true } : {}),
  }
}

export interface DesktopToggleDeps {
  getService?: () => DesktopManagerLike | undefined
  ensureService?: (timeoutMs?: number) => Promise<DesktopManagerLike | undefined>
  profileDir?: string
}

/**
 * Desktop 开关：服务缺席 → 结构化拒绝（ToggleError/unaddressable，禁 fallback 文件写）；
 * 服务在用 → 既有 togglePlugin 委派路径（installed 校验按 profileDir，与 web 委派同代码）。
 */
export async function desktopToggle(pkg: string, enabled: boolean, deps: DesktopToggleDeps = {}): Promise<ReturnType<typeof togglePlugin>> {
  const service = await resolveManager(deps)
  if (!service) {
    throw new ToggleError('unaddressable', '官方 pluginManager 服务不可用：desktop profile 的开关必须走官方管理器（dsh-m 不做文件级 fallback）；请在官方 Desktop 插件页操作')
  }
  return togglePlugin(pkg, enabled, { getService: () => service, profileDir: deps.profileDir })
}

/**
 * 管理器安装共享核心（0.9.8）：installBundle + ChangeResult 判定 + listBundles 复读。
 * desktopInstall / desktopUpgrade 共用；build-blocked 以 DesktopBuildApprovalNeeded 抛出，
 * 由调用方映射各自的返回形态。判定纪律沿用文件头「报告 §5.2」（dsh-market #703/#772 实证）：
 * 以 application/stage 为准，绝不只看 packageResult.exitCode；overridden 非失败。
 */
async function runManagedInstall(
  service: DesktopManagerLike,
  pkg: string,
  spec: string,
  approvedBuilds: string[] | undefined,
): Promise<{ change: DesktopChangeResult; bundleName: string }> {
  const raw = await service.installBundle!(spec, {
    enabled: true,
    ...(approvedBuilds && approvedBuilds.length > 0 ? { approvedBuilds } : {}),
  })
  const change = changeOf(raw)
  if (change.application === 'cancelled') {
    throw new DesktopOpsError('install-refused', `安装已被取消（${pkg}）：desktop profile 文件已由官方管理器恢复，未安装`)
  }
  if (change.application === 'failed' || change.error) {
    const pending = Array.isArray(change.pendingBuilds) ? change.pendingBuilds.filter((n) => typeof n === 'string') : []
    if (change.packageResult?.kind === 'build-blocked' && pending.length > 0) {
      throw new DesktopBuildApprovalNeeded(pending)
    }
    if (change.stage === 'enable') {
      throw new DesktopOpsError('enable-failed', `安装后启用阶段失败（${pkg}；application=failed、stage=enable${change.error?.code ? `、error=${change.error.code}` : ''}）：包已写入但未能启用，请在官方 Desktop 插件页查看状态或重试`)
    }
    throw new DesktopOpsError('install-refused', `官方管理器安装失败（${pkg}；application=${change.application ?? 'failed'}${change.error?.code ? `、error=${change.error.code}` : ''}${change.error?.diagnostic ? `：${change.error.diagnostic}` : ''}）`)
  }
  // 复读校验：listBundles 可用必须见目标在装；不可用（老管理器）至少要求官方宣称产出 bundle
  const bundleName = change.bundle ?? pkg
  if (typeof service.listBundles === 'function') {
    const bundles = await service.listBundles()
    const found = (bundles ?? []).find((b) => b && b.name === bundleName)
    if (!found || found.installed === false) {
      throw new DesktopOpsError('verify-failed', `安装复读失败（${pkg}）：官方结果为 ${change.application ?? 'unknown'} 但 listBundles 未見目标 bundle 在装——不冒充安装成功`)
    }
  } else if (!change.bundle) {
    throw new DesktopOpsError('verify-failed', `安装复读不可用（${pkg}）：官方结果未携带 bundle 字段且 listBundles 缺席——不冒充安装成功`)
  }
  return { change, bundleName }
}

export interface DesktopUninstallDeps extends DesktopEnsureService {
  getService?: () => DesktopManagerLike | undefined
  /** 管理器按 bundle 名操作，目录当前用不上；保留与 install/toggle 对称（dsh-market 同注释） */
  profileDir?: string
}

export interface DesktopUninstallResult {
  pkg: string
  liveDisabled: false
  needsRestart: boolean
  leftovers: string[]
  via: 'desktop-manager'
  output: string
}

/**
 * Desktop 卸载（0.9.8，dsh-market 同策略）：removeBundle 委派 + ChangeResult 判定 +
 * listBundles 复读（可用时必须不见目标在装）。服务缺席 → 结构化拒绝，零 CLI、零文件级 fallback。
 */
export async function desktopUninstall(pkg: string, deps: DesktopUninstallDeps = {}): Promise<DesktopUninstallResult> {
  const service = await resolveManager(deps)
  if (!service || typeof service.removeBundle !== 'function') {
    throw new DesktopOpsError('no-manager', '官方 pluginManager 服务不可用（desktop profile 的卸载必须由官方管理器执行）；拒绝卸载（fail-closed）')
  }
  const raw = await service.removeBundle(pkg)
  const change = changeOf(raw)
  if (change.application === 'failed' || change.error) {
    throw new DesktopOpsError('remove-failed', `官方管理器卸载失败（${pkg}；application=${change.application ?? 'failed'}${change.error?.code ? `、error=${change.error.code}` : ''}${change.error?.diagnostic ? `：${change.error.diagnostic}` : ''}）`)
  }
  if (typeof service.listBundles === 'function') {
    const bundles = await service.listBundles()
    const found = (bundles ?? []).find((b) => b && b.name === (change.bundle ?? pkg))
    if (found && found.installed === true) {
      throw new DesktopOpsError('verify-failed', `卸载复读失败（${pkg}）：官方结果为 ${change.application ?? 'unknown'} 但 listBundles 仍见目标在装——不冒充卸载成功`)
    }
  }
  return {
    pkg,
    liveDisabled: false,
    needsRestart: change.application === 'restart-required',
    leftovers: [],
    via: 'desktop-manager',
    output: `official pluginManager: application=${change.application ?? 'applied'}`,
  }
}

export interface DesktopUpgradeOptions {
  forceIncompatible?: boolean
  approvedBuilds?: string[]
  /** 显式锁定目标版本（缺省 = npm latest 精确版） */
  version?: string
  namespace?: RegistryCacheNamespace
  profile?: string
  profileDir?: string
  signal?: AbortSignal
}

export interface DesktopUpgradeDeps extends DesktopEnsureService {
  getService?: () => DesktopManagerLike | undefined
  loadRegistry?: InstallDeps['loadRegistry']
  fetchCommunityCatalog?: typeof defaultFetchCommunityCatalog
  listInstalled?: typeof defaultListInstalled
  npmLatest?: typeof defaultNpmLatest
  githubLatestTag?: typeof defaultGithubLatestTag
  precheck?: typeof precheckNpmCompat
}

/**
 * Desktop 升级（0.9.8，dsh-market 同策略——本机 0.9.3→0.9.4/0.9.5 即此路径实证）：
 * 覆盖安装 = installBundle(latest 精确 spec)。收录匹配（主清单 → 社区目录）与
 * upgradePluginLocked 同语义；非 dsh-m 收录的插件结构化拒绝（官方插件页负责）。
 */
export async function desktopUpgradeFromRegistry(
  pkg: string,
  cfg: RegistryConfig = {},
  opts: DesktopUpgradeOptions = {},
  deps: DesktopUpgradeDeps = {},
): Promise<DesktopInstallResult & { fromVersion?: string }> {
  return withMutationSession(() => desktopUpgradeLocked(pkg, cfg, opts, deps))
}

async function desktopUpgradeLocked(
  pkg: string,
  cfg: RegistryConfig,
  opts: DesktopUpgradeOptions,
  deps: DesktopUpgradeDeps,
): Promise<DesktopInstallResult & { fromVersion?: string }> {
  const service = await resolveManager(deps)
  if (!service || typeof service.installBundle !== 'function') {
    throw new DesktopOpsError('no-manager', '官方 pluginManager 服务不可用（desktop profile 的升级必须由官方管理器执行覆盖安装）；拒绝升级（fail-closed）')
  }
  const timeoutMs = cfg.timeoutMs ?? 20_000
  const loaded = await (deps.loadRegistry ?? defaultLoadRegistry)(cfg, { namespace: opts.namespace ?? 'host', profile: opts.profile })
  if (loaded.status === 'unavailable') {
    throw new DesktopOpsError('install-refused', `收录清单不可用，无法升级 ${pkg}；请检查 registry 配置或网络后重试`)
  }
  const { items } = await (deps.listInstalled ?? defaultListInstalled)(opts.profileDir)
  const target = items.find((it) => it.pkg === pkg)
  if (!target) throw new DesktopOpsError('install-refused', `desktop profile 未安装该插件: ${pkg}（升级目标必须是已装插件）`)
  let entry: InstallableEntry | undefined = loaded.registry.plugins.find((e) => matchInstalledByEntry(e, [target]))
  if (!entry) {
    // 0.5.1 同语义：主清单 miss 查社区目录（合并市场安装的社区条目同样可升级）
    try {
      const community = await (deps.fetchCommunityCatalog ?? defaultFetchCommunityCatalog)(cfg, { namespace: opts.namespace ?? 'host', signal: opts.signal, profile: opts.profile })
      entry = community.catalog
        ? adaptCommunityCatalog(community.catalog).entries.find((e) => matchInstalledByEntry(e, [target]))
        : undefined
    } catch {
      entry = undefined
    }
  }
  if (!entry) throw new DesktopOpsError('install-refused', `「${pkg}」不是经 dsh-m 收录的插件；desktop 升级请在官方 Desktop 插件页操作`)

  let spec: string
  let version: string | undefined
  let sha: string | undefined
  let tag: string | undefined
  let compat: CompatIssue | null = null
  let compatSkipped: 'github-source' | undefined
  if (entry.source === 'npm' && entry.npm) {
    if (opts.version) {
      version = opts.version
    } else {
      const latest = await (deps.npmLatest ?? defaultNpmLatest)(entry.npm, timeoutMs, opts.signal)
      version = latest.version
    }
    spec = `${entry.npm}@${version}`
    if (version !== undefined) {
      try {
        compat = await (deps.precheck ?? precheckNpmCompat)(entry.npm, version, { timeoutMs, signal: opts.signal })
      } catch {
        compat = null
      }
      if (compat !== null && opts.forceIncompatible !== true) throw new IncompatibleError(compat)
    }
  } else if (entry.github) {
    const resolved = await (deps.githubLatestTag ?? defaultGithubLatestTag)(entry.github, timeoutMs, opts.signal)
    sha = resolved.sha
    tag = resolved.tag
    spec = `github:${entry.github}#${sha}`
    compatSkipped = 'github-source'
  } else {
    throw new DesktopOpsError('install-refused', `收录条目 ${entry.id} 缺少 npm/github 来源，无法在 desktop 升级`)
  }

  let change: DesktopChangeResult
  let bundleName: string
  try {
    ({ change, bundleName } = await runManagedInstall(service, pkg, spec, opts.approvedBuilds))
  } catch (err) {
    if (err instanceof DesktopBuildApprovalNeeded) {
      return { ok: false, needsBuildApproval: true, id: entry.id, pkg, spec, pendingBuilds: err.pendingBuilds, message: err.message }
    }
    throw err
  }

  return {
    id: entry.id,
    pkg,
    spec,
    ...(version !== undefined ? { version } : {}),
    ...(sha !== undefined ? { sha } : {}),
    ...(tag !== undefined ? { tag } : {}),
    buildApprovals: Array.isArray(change.approvedBuilds) ? change.approvedBuilds : [],
    fallbackAllBuilds: false,
    ...(compat !== null ? { compat } : {}),
    ...(compatSkipped ? { compatSkipped } : {}),
    needsRestart: true,
    output: `official pluginManager: application=${change.application ?? 'applied'}, bundle=${bundleName}${change.changed === false ? ', changed=false' : ''}`,
    via: 'desktop-manager',
    ...(change.application === 'overridden' ? { overridden: true } : {}),
    fromVersion: target.version,
  }
}
