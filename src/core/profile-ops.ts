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
import { withMutationSession, resolveRegistryEntry, type InstallableEntry, type InstallResult, type InstallDeps } from './market.js'
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
  listBundles?(): Promise<Array<{ name: string; installed?: boolean; enabled?: boolean }>>
}

export type DesktopOpsErrorCode = 'no-manager' | 'install-refused' | 'enable-failed' | 'verify-failed'

export class DesktopOpsError extends Error {
  readonly code: DesktopOpsErrorCode
  constructor(code: DesktopOpsErrorCode, message: string) {
    super(message)
    this.name = 'DesktopOpsError'
    this.code = code
  }
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
  const service = deps.getService?.()
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

  const raw = await service.installBundle(spec, {
    enabled: true,
    ...(opts.approvedBuilds ? { approvedBuilds: opts.approvedBuilds } : {}),
  })
  const change = changeOf(raw)

  if (change.application === 'cancelled') {
    throw new DesktopOpsError('install-refused', `安装已被取消（${pkg}）：desktop profile 文件已由官方管理器恢复，未安装`)
  }
  if (change.application === 'failed' || change.error) {
    const pending = Array.isArray(change.pendingBuilds) ? change.pendingBuilds.filter((n) => typeof n === 'string') : []
    const buildBlocked = change.packageResult?.kind === 'build-blocked'
    if (buildBlocked && pending.length > 0) {
      return {
        ok: false,
        needsBuildApproval: true,
        id: entry.id,
        pkg,
        spec,
        pendingBuilds: pending,
        message: `该插件需要执行构建脚本（${pending.join('、')}）。确认后带同样的包名名单重试（approvedBuilds）；dsh-m 不做全量放行（ADR-0002 同语义）`,
      }
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
  profileDir?: string
}

/**
 * Desktop 开关：服务缺席 → 结构化拒绝（ToggleError/unaddressable，禁 fallback 文件写）；
 * 服务在用 → 既有 togglePlugin 委派路径（installed 校验按 profileDir，与 web 委派同代码）。
 */
export async function desktopToggle(pkg: string, enabled: boolean, deps: DesktopToggleDeps = {}): Promise<ReturnType<typeof togglePlugin>> {
  const service = deps.getService?.()
  if (!service) {
    throw new ToggleError('unaddressable', '官方 pluginManager 服务不可用：desktop profile 的开关必须走官方管理器（dsh-m 不做文件级 fallback）；请在官方 Desktop 插件页操作')
  }
  return togglePlugin(pkg, enabled, { getService: () => service, profileDir: deps.profileDir })
}
