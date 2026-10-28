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
 * - 0.9.19：供应链等待期在委派前预检（release-age.ts，零写操作 fail-open）；失败翻译解析
 *   全部违规条目并复读「账实分裂」（pnpm 11 锁文件校验失败前目标已写入 node_modules、
 *   官方管理器只回滚 manifest/lockfile 的实证形态——0:15 quota-watch 事件）。
 *
 * 禁止事项：desktop 路径零 Web fallback——不做文件级装后守卫（app.asar 探测盲区）、
 * 不写 allowBuilds、不跑 dsh-m 自实现 pnpm 编排、服务缺席一律结构化拒绝。
 */
import { withMutationSession, resolveRegistryEntry, synthesizeInstallableEntry, UpgradePathUnsupportedError, type InstallableEntry, type InstallResult, type InstallDeps } from './market-mutation.js'
import { matchInstalledByEntry } from './merged-market.js'
import { mergedOutcome } from './merged-market.js'
import { WEB_PROFILE } from './env.js'
import { loadRegistry as defaultLoadRegistry } from './registry.js'
import { fetchCommunityCatalog as defaultFetchCommunityCatalog } from './community.js'
import { listInstalledPlugins as defaultListInstalled } from './installed.js'
import { precheckNpmCompat, IncompatibleError, type CompatIssue } from './compat-check.js'
import { npmLatest as defaultNpmLatest, npmTarballUrl as defaultNpmTarballUrl, githubLatestTag as defaultGithubLatestTag } from './versions.js'
import { writeUpgradeIntent as defaultWriteUpgradeIntent, resolveUpgradeIntent as defaultResolveUpgradeIntent } from './upgrade-intent.js'
import { classifyUpgradeActivation, type ActivationClassification } from './activation.js'
import { togglePlugin, ToggleError, type PluginManagerRow } from './toggle.js'
import { describeReleaseAgeFailure, releaseAgePrecheck, type ReleaseAgePrecheckDeps } from './release-age.js'
import { governExcludeBlock, registerExclusion } from './exclude-governance.js'
import { journalExternalOperation, type OperationChannel, type AppendExternalOperation } from './external-journal.js'
import type { RegistryConfig, RegistryCacheNamespace } from './registry.js'

/** desktop 升级社区兜底的等待上限（对齐 market.ts DEFAULT_DEADLINE_MS 量级；仅本路径使用）。 */
const DEFAULT_COMMUNITY_DEADLINE_MS = 60_000

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

export type DesktopOpsErrorCode =
  | 'no-manager'
  | 'install-refused'
  | 'enable-failed'
  | 'remove-failed'
  | 'verify-failed'
  | 'release-age-wait'
  // 0.10.0：两步升级兜底回装也失败 → 缺席硬错误（details: pkg/previousVersion/addDiagnostic/pendingBuilds?）
  | 'rollback-failed'

// 0.9.19：等待期失败翻译移入 release-age.ts（describeReleaseAgeFailure）——全量违规解析 +
// 目标/旁包分述。0.9.10 版只取第一条违规并把旁包名字当成本次目标、给「改用 DSH Web」的
// 失配指引（本机 quota-watch 0.1.15 事件实证：被拦的是旁包 dsh-m@0.9.18，文案却让用户等
// 旁包满期、去装 web profile）。

export class DesktopOpsError extends Error {
  readonly code: DesktopOpsErrorCode
  /** 0.9.19：结构化细节（release-age：violations/targetViolating/splitState；precheck：blockers）。 */
  readonly details?: Record<string, unknown>
  constructor(code: DesktopOpsErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'DesktopOpsError'
    this.code = code
    if (details !== undefined) this.details = details
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
  /** 目标 profile 目录（0.9.19 供应链等待期预检与账实分裂复读需要；缺席则两者跳过） */
  profileDir?: string
  signal?: AbortSignal
  /** 调用通道（0.9.79 ADR-0018）：调用点显式传值；缺省 'external' */
  channel?: OperationChannel
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
  /** 0.9.19 供应链等待期预检注入（测试；缺省 npmjs packument / 读 profile pnpm-workspace.yaml） */
  packumentTimes?: ReleaseAgePrecheckDeps['packumentTimes']
  workspacePolicy?: ReleaseAgePrecheckDeps['workspacePolicy']
  /** ADR-0009 排除条目治理/登记注入（测试；缺省读写 profile pnpm-workspace.yaml 排除块） */
  governExclude?: typeof governExcludeBlock
  registerExclude?: typeof registerExclusion
  /** 0.9.19 账实分裂复读（测试注入；缺省 installed.ts 实现） */
  listInstalled?: typeof defaultListInstalled
  /** 外部操作直落钩子注入（0.9.79 ADR-0018，R3-1；缺省 = 真实现） */
  appendExternalOperation?: AppendExternalOperation
  /** 0.10.0 D3 自升级通道注入（SELF_PKG 缝改道用；测试注入 tarball 解析与 intent 读写） */
  npmTarballUrl?: typeof defaultNpmTarballUrl
  writeUpgradeIntent?: typeof defaultWriteUpgradeIntent
  resolveUpgradeIntent?: typeof defaultResolveUpgradeIntent
}

export type DesktopInstallResult =
  | (InstallResult & { via: 'desktop-manager'; overridden?: boolean; degraded?: boolean; restoredTo?: string })
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
  // 0.9.79 外部操作直落（ADR-0018）：自记（call-graph audit：内部走 resolveEntry + service.installBundle，
  // 不经 market.ts 已插桩入口）；成功/失败/needsBuildApproval（结构化未遂）都记；append 失败被钩子吞
  try {
    const result = await withMutationSession(() => desktopInstallLocked(id, cfg, opts, deps))
    if ('needsBuildApproval' in result) {
      await journalExternalOperation(opts.channel, { kind: 'desktop-install', target: id }, 'failed', {
        reason: result.message,
        appendExternalOperation: deps.appendExternalOperation,
      })
      return result
    }
    await journalExternalOperation(
      opts.channel,
      { kind: 'desktop-install', target: id, ...(result.version ? { toVersion: result.version } : {}) },
      'ok',
      { appendExternalOperation: deps.appendExternalOperation },
    )
    return result
  } catch (err) {
    await journalExternalOperation(opts.channel, { kind: 'desktop-install', target: id }, 'failed', {
      reason: err instanceof Error ? err.message : String(err),
      appendExternalOperation: deps.appendExternalOperation,
    })
    throw err
  }
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

  // ADR-0009：委派前治理（排除块规范形态，fail-open）+ 供应链等待期预检收敛——默认策略
  // 放行并附陈述（官方管理器对显式点名的新版本直接安装并自动登记）；显式设置 age 或
  // strict 开启才拒绝。治理已落盘的编辑在成功 output 与失败 message 双路留痕。
  let governanceNote = ''
  let releaseAgeNotice = ''
  let governedMergedNames: string[] | undefined
  if (entry.source === 'npm' && version !== undefined && opts.profileDir) {
    try {
      const gov = await (deps.governExclude ?? governExcludeBlock)(opts.profileDir)
      if (gov.changed && gov.mergedNames?.length) {
        governanceNote = `；排除条目治理：合并 ${gov.mergedNames.join('、')}`
        governedMergedNames = gov.mergedNames
      }
    } catch {
      // fail-open：治理失败不阻塞委派（pnpm 仍是最终执行者）
    }
    const gate = await releaseAgePrecheck({
      pkg,
      version,
      profileDir: opts.profileDir,
      timeoutMs,
      signal: opts.signal,
      deps: { packumentTimes: deps.packumentTimes, workspacePolicy: deps.workspacePolicy },
    })
    if (gate.blocked) {
      throw new DesktopOpsError('release-age-wait', gate.message + governanceNote, { blockers: gate.blockers, ...(governedMergedNames !== undefined ? { governanceMerged: governedMergedNames } : {}) })
    }
    if (gate.notice) releaseAgeNotice = `；${gate.notice}`
  }

  // 0.10.0 R5：install 目标已装（0.2.1 宿主 already-installed 守卫必拦）→ 预查旧版本号，
  // 使 runManagedInstall 在守卫命中时可静默两步化（remove+add）；全新包（未命中）不注入——
  // T6 钉零 removeBundle。探测失败 fail-open（守卫命中且无 previousVersion 时走既有失败形态）。
  let previousVersion: string | undefined
  if (opts.profileDir) {
    try {
      const { items } = await (deps.listInstalled ?? defaultListInstalled)(opts.profileDir)
      previousVersion = items.find((it) => it.pkg === pkg)?.version
    } catch {
      previousVersion = undefined
    }
  }

  // 0.10.0 R6（install 臂）：dsh-m 已装态下的 install 调用实为升级（守卫必拦）→ 改道 D3；
  // 全新安装（未装）走既有单步——守卫不触发，R1「新装路径不动」。
  if (pkg === SELF_PKG && previousVersion !== undefined) {
    return desktopSelfUpgradeViaTarballLocked(pkg, previousVersion, { timeoutMs, signal: opts.signal, profileDir: opts.profileDir }, {
      getService: () => service,
      npmLatest: deps.npmLatest,
      npmTarballUrl: deps.npmTarballUrl,
      writeUpgradeIntent: deps.writeUpgradeIntent,
      resolveUpgradeIntent: deps.resolveUpgradeIntent,
      listInstalled: deps.listInstalled,
    })
  }

  let change: DesktopChangeResult
  let bundleName: string
  let registerNote: string | undefined
  let managed: Awaited<ReturnType<typeof runManagedInstall>> | undefined
  try {
    managed = await runManagedInstall(
      service,
      { pkg, spec, version, ...(previousVersion !== undefined ? { previousVersion } : {}), profileDir: opts.profileDir, approvedBuilds: opts.approvedBuilds, listInstalled: deps.listInstalled },
      { governExclude: deps.governExclude, registerExclude: deps.registerExclude, packumentTimes: deps.packumentTimes },
    )
    change = managed.change
    bundleName = managed.bundleName
    registerNote = managed.registerNote
  } catch (err) {
    if (err instanceof DesktopBuildApprovalNeeded) {
      return { ok: false, needsBuildApproval: true, id: entry.id, pkg, spec, pendingBuilds: err.pendingBuilds, message: err.message + governanceNote }
    }
    if (err instanceof Error) {
      if (governanceNote !== '' && !err.message.includes(governanceNote)) err.message += governanceNote
      if (managed?.governRetryNote !== undefined && !err.message.includes(managed.governRetryNote)) err.message += managed.governRetryNote
    }
    throw err
  }
  const retryNote = managed.governRetryNote !== undefined && !governanceNote.includes(managed.governRetryNote) ? managed.governRetryNote : ''
  const twoStepSuffix = managed.twoStepNote !== undefined ? `；${managed.twoStepNote}` : ''
  const degradedRestoredTo = managed.degraded === true ? managed.restoredTo : undefined
  const degradedSuffix = degradedRestoredTo !== undefined ? `；升级失败已回装旧版 ${degradedRestoredTo}（降级恢复）` : ''

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
    output: `official pluginManager: application=${change.application ?? 'applied'}, bundle=${bundleName}${change.changed === false ? ', changed=false' : ''}${governanceNote}${retryNote}${releaseAgeNotice}${registerNote ?? ''}${twoStepSuffix}${degradedSuffix}`,
    via: 'desktop-manager',
    ...(change.application === 'overridden' ? { overridden: true } : {}),
    ...(degradedRestoredTo !== undefined ? { degraded: true, restoredTo: degradedRestoredTo } : {}),
    // 0.10.0（评审 R1-2）：降级恢复的 version 落账为回装后实际版本（账实相符）；spec 字段保留尝试目标
    ...(degradedRestoredTo !== undefined ? { version: degradedRestoredTo } : {}),
  }
}

export interface DesktopToggleDeps {
  getService?: () => DesktopManagerLike | undefined
  ensureService?: (timeoutMs?: number) => Promise<DesktopManagerLike | undefined>
  profileDir?: string
  /** 调用通道（0.9.79 ADR-0018）：透传给 togglePlugin（唯一嵌套对）；缺省 'external' */
  channel?: OperationChannel
  /** 外部操作直落钩子注入（R3-1；透传 togglePlugin） */
  appendExternalOperation?: AppendExternalOperation
}

/**
 * Desktop 开关：服务缺席 → 结构化拒绝（ToggleError/unaddressable，禁 fallback 文件写；
 * 该拒绝发生在透传前，由本入口自记 desktop-toggle failed——类型契约中该 kind 的唯一可达路径）；
 * 服务在用 → 既有 togglePlugin 委派路径（installed 校验按 profileDir，与 web 委派同代码；
 * channel/钩子透传，单笔事务只产生一条 toggle 记录，不双记——R1-2）。
 */
export async function desktopToggle(pkg: string, enabled: boolean, deps: DesktopToggleDeps = {}): Promise<ReturnType<typeof togglePlugin>> {
  const service = await resolveManager(deps)
  if (!service) {
    const message = '官方 pluginManager 服务不可用：desktop profile 的开关必须走官方管理器（dsh-m 不做文件级 fallback）；请在官方 Desktop 插件页操作'
    await journalExternalOperation(deps.channel, { kind: 'desktop-toggle', target: pkg }, 'failed', {
      reason: message,
      appendExternalOperation: deps.appendExternalOperation,
    })
    throw new ToggleError('unaddressable', message)
  }
  return togglePlugin(pkg, enabled, {
    getService: () => service,
    profileDir: deps.profileDir,
    channel: deps.channel,
    appendExternalOperation: deps.appendExternalOperation,
  })
}

/**
 * 管理器安装共享核心（0.9.8）：installBundle + ChangeResult 判定 + listBundles 复读。
 * desktopInstall / desktopUpgrade 共用；build-blocked 以 DesktopBuildApprovalNeeded 抛出，
 * 由调用方映射各自的返回形态。判定纪律沿用文件头「报告 §5.2」（dsh-market #703/#772 实证）：
 * 以 application/stage 为准，绝不只看 packageResult.exitCode；overridden 非失败。
 * 0.9.19：release-age 失败翻译换 release-age.ts（全量违规解析 + 目标/旁包分述），并复读
 * 「账实分裂」（pnpm 11 锁文件校验失败前目标可能已写入 node_modules，官方管理器只回滚
 * manifest/lockfile），把回退风险明示进错误信息。
 *
 * 本地增强（2026-10-02，未随计划发版）：enable 阶段失败自动重试一次 + 文案按 packageResult 精确化。
 * 背景：desktop 高频装卸/插件树重载窗口下，官方管理器 enable 阶段与应用侧操作竞速，返回
 * application=failed/stage=enable/error=operation-error（实机实证 dsh-copilot-auth 三装卸两败，
 * 失败 operation 的 pnpm.log 均为 0 字节——失败发生在 pnpm 之前的应用侧 enable，重试即愈）。
 */

let enableRetryDelayMs = 1_200
/** 测试钩子：调整 enable 重试退避毫秒（0 = 立即重试）。 */
export function _setEnableRetryDelayForTests(ms: number): void {
  enableRetryDelayMs = Math.max(0, ms)
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** enable 阶段失败文案：按 packageResult 如实区分「已写入 / 未写入 / 未知」——
 *  enable 先行失败（pnpm 未跑）时旧文案「包已写入」是错误断言（实机实证）。 */
function enableStageFailureMessage(pkg: string, change: DesktopChangeResult): string {
  const pr = change.packageResult
  let writtenText: string
  if (pr && typeof pr === 'object') {
    const written = pr.exitCode === 0 || (typeof pr.kind === 'string' && /applied|ok|installed|success/i.test(pr.kind))
    writtenText = written ? '包已写入但未能启用' : '包未能写入（启用注册先行失败，安装步骤未执行）'
  } else {
    writtenText = '启用阶段失败（官方未回传包写入结果，是否写入未知）'
  }
  return `安装后启用阶段失败（${pkg}；application=failed、stage=enable${change.error?.code ? `、error=${change.error.code}` : ''}）：${writtenText}，请在官方 Desktop 插件页查看状态或重试`
}

/** runManagedInstall 上下文（0.9.19）：目标标识 + 账实分裂复读所需的 profileDir/listInstalled；previousVersion 供登记复合形态（ADR-0009）。 */
interface ManagedInstallCtx {
  pkg: string
  spec: string
  /** npm 源精确目标版本（等待期翻译与账实分裂复读用；github 源缺席） */
  version?: string
  profileDir?: string
  approvedBuilds?: string[] | undefined
  listInstalled?: typeof defaultListInstalled
  /** 升级前的已装版本（ADR-0009 登记复合形态用；全新安装缺席） */
  previousVersion?: string
}

interface ManagedInstallDeps {
  governExclude?: typeof governExcludeBlock
  registerExclude?: typeof registerExclusion
  /** 透传给登记的 young 探测（测试注入；缺省 cachedPackumentTimes）——避免测试被动出网 */
  packumentTimes?: ReleaseAgePrecheckDeps['packumentTimes']
}

const DUAL_CODE_RE = /ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION|ERR_PNPM_NO_MATURE_MATCHING_VERSION/

/** 可治理的失败形态：cancelled / build-blocked 不治理不重试（与 mapFailure 分类一致）。 */
function isGovableFailure(change: DesktopChangeResult): boolean {
  if (change.application === 'cancelled') return false
  const pending = Array.isArray(change.pendingBuilds) ? change.pendingBuilds.filter((n) => typeof n === 'string') : []
  if (change.packageResult?.kind === 'build-blocked' && pending.length > 0) return false
  return change.application === 'failed' || change.error !== undefined
}

/** 官方 pendingBuilds 的鸭子读投影（strings-only）。 */
function pendingOf(change: DesktopChangeResult): string[] {
  return Array.isArray(change.pendingBuilds) ? change.pendingBuilds.filter((n) => typeof n === 'string') : []
}

/** 终态失败（与 runManagedInstall 既有失败闸门同口径）。 */
function isTerminalFailure(change: DesktopChangeResult): boolean {
  return change.application === 'failed' || change.application === 'cancelled' || change.error !== undefined
}

/**
 * 宿主 0.2.1 already-installed 安装守卫命中（0.10.0，R2）：application=failed +
 * error.code 精确匹配，且 release-age / build-blocked 形态先于本判定（等待期与审批语义优先）。
 */
function isAlreadyInstalledGuard(change: DesktopChangeResult): boolean {
  if (change.application !== 'failed' || change.error?.code !== 'already-installed') return false
  if (change.packageResult?.kind === 'build-blocked' && pendingOf(change).length > 0) return false
  return !/ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION|minimumReleaseAge/i.test(
    `${change.error?.diagnostic ?? ''}\n${change.error?.code ?? ''}`,
  )
}

async function runManagedInstall(
  service: DesktopManagerLike,
  ctx: ManagedInstallCtx,
  deps: ManagedInstallDeps = {},
): Promise<{
  change: DesktopChangeResult
  bundleName: string
  registerNote?: string
  governRetryNote?: string
  /** 0.10.0：发生了 already-installed → remove+add 两步化（调用方并入 output 留痕） */
  twoStepNote?: string
  /** 0.10.0 R4：降级恢复——升级失败但已自动回装旧版（成功形态 + degraded 标记） */
  degraded?: boolean
  restoredTo?: string
}> {
  const installOnce = async (spec: string = ctx.spec): Promise<DesktopChangeResult> =>
    changeOf(await service.installBundle!(spec, {
      enabled: true,
      ...(ctx.approvedBuilds && ctx.approvedBuilds.length > 0 ? { approvedBuilds: ctx.approvedBuilds } : {}),
    }))

  // enable 阶段竞速自动重试（2026-10-02 本地增强的普适化，0.10.1 E2E 实证扩面）：
  // 高频装卸/插件树重载窗口下 enable 阶段与应用侧竞速（实机实证「重试即愈」，skip-auth@0.4.1 事件二度实证）——
  // 首腿、两步第二腿、兜底回装腿同享受限单次重试；cancelled / build-blocked / release-age 等其他失败形态不重试。
  const installOnceRetryingEnable = async (spec: string): Promise<DesktopChangeResult> => {
    const first = await installOnce(spec)
    if (first.stage === 'enable' && (first.application === 'failed' || first.error)) {
      if (enableRetryDelayMs > 0) await sleepMs(enableRetryDelayMs)
      return installOnce(spec)
    }
    return first
  }

  /** 失败映射（既有语义不变：cancelled / build-blocked 审批 / release-age 等待 / enable / 通用）。 */
  const mapFailure = async (change: DesktopChangeResult): Promise<never> => {
    if (change.application === 'cancelled') {
      throw new DesktopOpsError('install-refused', `安装已被取消（${ctx.pkg}）：desktop profile 文件已由官方管理器恢复，未安装`)
    }
    const pending = Array.isArray(change.pendingBuilds) ? change.pendingBuilds.filter((n) => typeof n === 'string') : []
    if (change.packageResult?.kind === 'build-blocked' && pending.length > 0) {
      throw new DesktopBuildApprovalNeeded(pending)
    }
    // 0.9.19：供应链等待期——解析全部违规条目（0.9.10 只取第一条，旁包被当成被拦目标）、
    // 目标/旁包分述 + 账实分裂复读（pnpm 11 校验失败前已写入 node_modules 的实证形态）。
    const diagnosticText = `${change.error?.diagnostic ?? ''}\n${change.error?.code ?? ''}`
    if (/ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION|minimumReleaseAge/i.test(diagnosticText)) {
      const view = describeReleaseAgeFailure({ pkg: ctx.pkg, version: ctx.version, diagnostic: diagnosticText })
      let message = view.message
      let splitState: { installedVersion: string; manifestSpec: string } | undefined
      if (ctx.profileDir && ctx.version) {
        try {
          const items = (await ctx.listInstalled?.(ctx.profileDir) ?? { items: [] }).items
          const row = items.find((it) => it.pkg === ctx.pkg)
          if (row && row.version === ctx.version && typeof row.spec === 'string' && row.spec !== '') {
            splitState = { installedVersion: row.version, manifestSpec: row.spec }
            message += `\n注意：${row.version} 已写入 node_modules 且在运行，但 manifest/lockfile 仍记录 ${row.spec}（官方管理器失败回滚所致，「账实分裂」）——官方管理器下次任何包操作都会把它回退到 ${row.spec}；等待期满后重新升级即可对齐。`
          }
        } catch {
          // 复读失败不遮蔽原错误
        }
      }
      throw new DesktopOpsError('release-age-wait', message, {
        violations: view.violations,
        targetViolating: view.targetViolating,
        ...(splitState !== undefined ? { splitState } : {}),
      })
    }
    if (change.stage === 'enable') {
      throw new DesktopOpsError('enable-failed', enableStageFailureMessage(ctx.pkg, change))
    }
    throw new DesktopOpsError('install-refused', `官方管理器安装失败（${ctx.pkg}；application=${change.application ?? 'failed'}${change.error?.code ? `、error=${change.error.code}` : ''}${change.error?.diagnostic ? `：${change.error.diagnostic}` : ''}）`)
  }

  /** 复读校验：listBundles 可用必须见目标在装；不可用（老管理器）至少要求官方宣称产出 bundle。 */
  const verifyAndBundle = async (change: DesktopChangeResult): Promise<{ change: DesktopChangeResult; bundleName: string }> => {
    const bundleName = change.bundle ?? ctx.pkg
    if (typeof service.listBundles === 'function') {
      const bundles = await service.listBundles()
      const found = (bundles ?? []).find((b) => b && b.name === bundleName)
      if (!found || found.installed === false) {
        throw new DesktopOpsError('verify-failed', `安装复读失败（${ctx.pkg}）：官方结果为 ${change.application ?? 'unknown'} 但 listBundles 未見目标 bundle 在装——不冒充安装成功`)
      }
    } else if (!change.bundle) {
      throw new DesktopOpsError('verify-failed', `安装复读不可用（${ctx.pkg}）：官方结果未携带 bundle 字段且 listBundles 缺席——不冒充安装成功`)
    }
    return { change, bundleName }
  }

  let change = await installOnceRetryingEnable(ctx.spec)
  // （enable 阶段竞速自动重试已普适化进 installOnceRetryingEnable——首腿/两步第二腿/兜底回装腿/D3 同享）
  // ADR-0009 挂点3：双码失败 → 治理 → changed 则重试该命令一次（每次调用至多一次；
  // cancelled / build-blocked 不治理不重试）。仍败走既有 mapFailure（含账实分裂复读）；
  // 挂点3 已落盘的合并以短语并入失败 message 与成功 output（留痕契约含挂点3）。
  let governRetryNote: string | undefined
  if (isGovableFailure(change) && DUAL_CODE_RE.test(`${change.error?.diagnostic ?? ''}\n${change.error?.code ?? ''}`)) {
    const gov = await (deps.governExclude ?? governExcludeBlock)(ctx.profileDir ?? '')
    if (gov.changed) {
      if (gov.mergedNames?.length) governRetryNote = `；排除条目治理：合并 ${gov.mergedNames.join('、')}`
      change = await installOnce()
    }
  }

  // 0.10.0（宿主 0.2.1 already-installed 守卫适配，R2/R3）：首腿守卫命中 → 静默两步化
  // （removeBundle 旧版 → 重试安装同一 spec，至多一次、无循环）；第二腿终态失败 → 兜底回装旧版
  // （remove 后旧名已不在 manifest，守卫不适用）：回装成功 = 降级恢复结局（degraded，R4）；
  // cancelled / build-blocked 语义优先（不冒充降级）；回装失败 = 缺席硬错误（rollback-failed）。
  // 0.10.1（E2E 实证 ③）：去掉 previousVersion 前置门——卸载后同会话重装时，宿主活跃态/manifest
  // 字面仍视其在装（守卫命中），而探测口径为「未安装」；守卫命中即 remove+add（官方语义），
  // 无旧版可回装时失败走账实复读给恢复指引。
  let twoStepNote: string | undefined
  // 0.10.16（@iasiv5/dsh-skip-browser-auth@0.4.3 批量升级真机事件）：第二腿 already-installed
  // 终态失败存在 post-write 伪失败形态——installBundle 已写穿三面账（manifest/node_modules/lock
  // 均为目标版）却回传 failed/already-installed（自指操作伪影：写完后 manifest 含该名，宿主完成
  // 路径自触守卫；D3 0.10.2 同款先例）。此刻兜底回装腿的「remove 后旧名已不在 manifest，守卫不
  // 适用」假设不成立（manifest 已含新名），回装必再撞守卫 → rollback-failed 误报（账面明明已是
  // 目标版）。处置（镜像 D3 0.10.2 账实改判）：两处失败闸（两步第二腿 / 首腿）终态失败时先账实
  // 复读——npm 源目标版（ctx.version）已写入 = 升级事实成立，按成功改判（调用方 needsRestart 恒
  // true，重启 Desktop 激活），绝不降级倒退、也绝不报失败；复读失败 / 版本不符（含仍为旧版）
  // → 既有回装/失败语义不变。
  const reconcilePostWriteArtifact = async (): Promise<{
    change: DesktopChangeResult
    bundleName: string
    twoStepNote: string
  } | undefined> => {
    if (ctx.version === undefined || !ctx.profileDir || !ctx.listInstalled) return undefined
    try {
      const row = (await ctx.listInstalled(ctx.profileDir)).items.find((it) => it.pkg === ctx.pkg)
      // 三面账一致才算 post-write 伪失败：version（node_modules 实装）与 spec（manifest
      // pin）都等于目标版。只看 version 会误吞 release-age 账实分裂形态（node_modules
      // 已写新、manifest 被官方回滚到旧 pin）——那是等待/回退风险，不是升级成立
      // （0.9.19 钉例「账实分裂复读」守此边界，2026-10-25 真机回归教训）。
      if (row?.version !== ctx.version || row?.spec !== ctx.version) return undefined
      return {
        change,
        bundleName: ctx.pkg,
        twoStepNote: `${twoStepNote ?? 'already-installed'}；post-write 伪失败经账实复读改判成功（目标版 ${ctx.version} 已写入三面账，重启 Desktop 激活）`,
      }
    } catch {
      // 复读失败按未知处理：走既有回装/失败语义
      return undefined
    }
  }
  if (isAlreadyInstalledGuard(change) && typeof service.removeBundle === 'function') {
    twoStepNote = 'already-installed → two-step'
    const removeChange = changeOf(await service.removeBundle(ctx.pkg))
    if (isTerminalFailure(removeChange)) {
      // remove 腿失败短路（不回装）：旧版尚未移除，状态以官方插件页为准
      throw new DesktopOpsError(
        'remove-failed',
        `两步升级第一步（卸载旧版）失败（${ctx.pkg}；application=${removeChange.application ?? 'failed'}${removeChange.error?.code ? `、error=${removeChange.error.code}` : ''}）：未执行升级，请到官方 Desktop 插件页确认 ${ctx.pkg} 状态`,
      )
    }
    change = await installOnceRetryingEnable(ctx.spec)
    if (isTerminalFailure(change)) {
      const reconciled = await reconcilePostWriteArtifact()
      if (reconciled !== undefined) return reconciled
      const pendingAdd = pendingOf(change)
      const addDiagnostic = `${change.error?.diagnostic ?? ''}${change.error?.code ? `\n${change.error.code}` : ''}`.trim()
      const addCancelled = change.application === 'cancelled'
      const addBuildBlocked = change.packageResult?.kind === 'build-blocked' && pendingAdd.length > 0
      if (ctx.previousVersion) {
        // 兜底回装旧版（R3）：回装腿失败（含其自身 build-blocked）= 缺席硬错误，降级失败真相优先
        const rollbackChange = await installOnceRetryingEnable(`${ctx.pkg}@${ctx.previousVersion}`)
        const pendingRollback = pendingOf(rollbackChange)
        if (isTerminalFailure(rollbackChange) || (rollbackChange.packageResult?.kind === 'build-blocked' && pendingRollback.length > 0)) {
          // 0.10.1（E2E 实证，skip-auth@0.4.1 事件）：回装腿失败 ≠ 一定缺席——pnpm 可能已写入账面
          // （激活阶段失败）。宣称缺席前实读账面，按实况分派恢复指引（账实相符优先，零误导性降级建议）。
          let installedVersion: string | undefined
          if (ctx.profileDir && ctx.listInstalled) {
            try {
              const row = (await ctx.listInstalled(ctx.profileDir)).items.find((it) => it.pkg === ctx.pkg)
              installedVersion = row?.version
            } catch {
              // 复读失败按未知处理：保留既有缺席文案（含「可能」字样，不断言）
            }
          }
          const message = installedVersion !== undefined
            ? `升级失败且自动回装未完成，但账面显示 ${ctx.pkg}@${installedVersion} 已写入（激活阶段可能未完成）：请重启 Desktop 完成激活；如重启后仍异常，请在官方 Desktop 插件页手动处理${addDiagnostic !== '' ? `；升级失败原因：${addDiagnostic}` : ''}`
            : `升级失败且自动回装旧版也失败（${ctx.pkg}@${ctx.previousVersion}）：插件当前可能缺席，请在官方 Desktop 插件页手动重装 ${ctx.pkg}@${ctx.previousVersion}${addDiagnostic !== '' ? `；升级失败原因：${addDiagnostic}` : ''}`
          throw new DesktopOpsError(
            'rollback-failed',
            message,
            {
              pkg: ctx.pkg,
              previousVersion: ctx.previousVersion,
              ...(addDiagnostic !== '' ? { addDiagnostic } : {}),
              ...(pendingRollback.length > 0 ? { pendingBuilds: pendingRollback } : {}),
              ...(installedVersion !== undefined ? { installedVersion } : {}),
            },
          )
        }
        const verifiedRollback = await verifyAndBundle(rollbackChange)
        if (addBuildBlocked) {
          // build-blocked 语义优先：旧版已兜住，仍抛审批请求（不冒充降级成功）
          throw new DesktopBuildApprovalNeeded(pendingAdd)
        }
        if (addCancelled) {
          // 取消不冒充降级成功：已恢复旧版、未做升级
          throw new DesktopOpsError('install-refused', `升级已被取消（${ctx.pkg}）：已恢复旧版 ${ctx.previousVersion}，未做升级`)
        }
        // 降级恢复（R4）：成功形态 + degraded 标记；跳过挂点2 登记——实际在装的是旧版，登记新版本会是假账
        return {
          ...verifiedRollback,
          ...(governRetryNote !== undefined ? { governRetryNote } : {}),
          degraded: true,
          restoredTo: ctx.previousVersion,
          twoStepNote,
        }
      }
      // 0.10.1（E2E 实证 ③）：无 previousVersion——remove 已按官方语义执行、无旧版可回装。
      // build-blocked / cancelled 语义照旧；其余按账实复读给恢复指引（缺席硬错误族）。
      if (addBuildBlocked) {
        throw new DesktopBuildApprovalNeeded(pendingAdd)
      }
      if (addCancelled) {
        throw new DesktopOpsError('install-refused', `安装已被取消（${ctx.pkg}）：未安装`)
      }
      let installedVersion: string | undefined
      if (ctx.profileDir && ctx.listInstalled) {
        try {
          const row = (await ctx.listInstalled(ctx.profileDir)).items.find((it) => it.pkg === ctx.pkg)
          installedVersion = row?.version
        } catch {
          // 复读失败按未知处理：缺席文案含「可能」字样，不断言
        }
      }
      const message = installedVersion !== undefined
        ? `安装未完成，但账面显示 ${ctx.pkg}@${installedVersion} 已写入（激活阶段可能未完成）：请重启 Desktop 完成激活；如重启后仍异常，请在官方 Desktop 插件页手动处理${addDiagnostic !== '' ? `；失败原因：${addDiagnostic}` : ''}`
        : `安装失败且无法自动恢复（${ctx.pkg}）：插件当前可能缺席，请在官方 Desktop 插件页手动重装${addDiagnostic !== '' ? `；失败原因：${addDiagnostic}` : ''}`
      throw new DesktopOpsError(
        'rollback-failed',
        message,
        {
          pkg: ctx.pkg,
          ...(addDiagnostic !== '' ? { addDiagnostic } : {}),
          ...(pendingAdd.length > 0 ? { pendingBuilds: pendingAdd } : {}),
          ...(installedVersion !== undefined ? { installedVersion } : {}),
        },
      )
    }
  }

  if (change.application === 'failed' || change.application === 'cancelled' || change.error) {
    const reconciled = await reconcilePostWriteArtifact()
    if (reconciled !== undefined) return reconciled
    try {
      await mapFailure(change)
    } catch (err) {
      if (err instanceof Error && governRetryNote !== undefined && !err.message.includes(governRetryNote)) err.message += governRetryNote
      throw err
    }
  }
  const verified = await verifyAndBundle(change)
  // ADR-0009 挂点2：成功后登记（仅 npm 源窗口内目标；fail-open，applied 短语由调用方并入 output）
  let registerNote: string | undefined
  if (ctx.profileDir && ctx.version) {
    try {
      const reg = await (deps.registerExclude ?? registerExclusion)(
        ctx.profileDir,
        {
          pkg: ctx.pkg,
          version: ctx.version,
          ...(ctx.previousVersion !== undefined ? { previousVersion: ctx.previousVersion } : {}),
        },
        deps.packumentTimes ? { packumentTimes: deps.packumentTimes } : {},
      )
      if (reg.applied && reg.form) registerNote = `；排除条目已登记 ${ctx.pkg}@${ctx.version}（${reg.form}）`
    } catch {
      // fail-open：登记失败不影响安装/升级成功态
    }
  }
  return {
    ...verified,
    ...(registerNote !== undefined || governRetryNote !== undefined ? { registerNote, governRetryNote } : {}),
    ...(twoStepNote !== undefined ? { twoStepNote } : {}),
  }
}

export interface DesktopUninstallDeps extends DesktopEnsureService {
  getService?: () => DesktopManagerLike | undefined
  /** 管理器按 bundle 名操作，目录当前用不上；保留与 install/toggle 对称（dsh-market 同注释） */
  profileDir?: string
  /** 调用通道（0.9.79 ADR-0018）：缺省 'external' */
  channel?: OperationChannel
  /** 外部操作直落钩子注入（R3-1；缺省 = 真实现） */
  appendExternalOperation?: AppendExternalOperation
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
 * 0.9.79：自记外部操作（call-graph audit：内部直接 service.removeBundle，不经 market.ts 插桩入口）。
 */
export async function desktopUninstall(pkg: string, deps: DesktopUninstallDeps = {}): Promise<DesktopUninstallResult> {
  try {
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
    await journalExternalOperation(deps.channel, { kind: 'desktop-uninstall', target: pkg }, 'ok', {
      appendExternalOperation: deps.appendExternalOperation,
    })
    return {
      pkg,
      liveDisabled: false,
      needsRestart: change.application === 'restart-required',
      leftovers: [],
      via: 'desktop-manager',
      output: `official pluginManager: application=${change.application ?? 'applied'}`,
    }
  } catch (err) {
    await journalExternalOperation(deps.channel, { kind: 'desktop-uninstall', target: pkg }, 'failed', {
      reason: err instanceof Error ? err.message : String(err),
      appendExternalOperation: deps.appendExternalOperation,
    })
    throw err
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
  /** 调用通道（0.9.79 ADR-0018）：调用点显式传值；缺省 'external' */
  channel?: OperationChannel
}

export interface DesktopUpgradeDeps extends DesktopEnsureService {
  getService?: () => DesktopManagerLike | undefined
  loadRegistry?: InstallDeps['loadRegistry']
  fetchCommunityCatalog?: typeof defaultFetchCommunityCatalog
  listInstalled?: typeof defaultListInstalled
  npmLatest?: typeof defaultNpmLatest
  githubLatestTag?: typeof defaultGithubLatestTag
  precheck?: typeof precheckNpmCompat
  /** 0.9.19 供应链等待期预检注入（测试；缺省 npmjs packument / 读 profile pnpm-workspace.yaml） */
  packumentTimes?: ReleaseAgePrecheckDeps['packumentTimes']
  workspacePolicy?: ReleaseAgePrecheckDeps['workspacePolicy']
  /** ADR-0009 排除条目治理/登记注入（测试；缺省读写 profile pnpm-workspace.yaml 排除块） */
  governExclude?: typeof governExcludeBlock
  registerExclude?: typeof registerExclusion
  /** 生效判定注入（0.9.22 测试用；缺省 = classifyUpgradeActivation，npm 源升级成功点调用） */
  classifyActivation?: (pkg: string, fromVersion: string, toVersion: string) => Promise<ActivationClassification>
  /** 外部操作直落钩子注入（0.9.79 ADR-0018，R3-1；缺省 = 真实现） */
  appendExternalOperation?: AppendExternalOperation
  /** 0.10.0 D3 自升级通道注入（SELF_PKG 缝改道用；测试注入 tarball 解析与 intent 读写） */
  npmTarballUrl?: typeof defaultNpmTarballUrl
  writeUpgradeIntent?: typeof defaultWriteUpgradeIntent
  resolveUpgradeIntent?: typeof defaultResolveUpgradeIntent
}

/**
 * Desktop 升级（0.9.8，dsh-market 同策略——本机 0.9.3→0.9.4/0.9.5 即此路径实证）：
 * 覆盖安装 = installBundle(latest 精确 spec)。收录匹配（主清单 → 社区目录）与
 * upgradePluginLocked 同语义；非 dsh-m 收录的插件结构化拒绝（官方插件页负责）。
 * 0.9.79：自记外部操作（call-graph audit：内部走 loadRegistry/mergedOutcome + service.installBundle，
 * 不经 market.ts 已插桩入口）；needsBuildApproval（结构化未遂）记 failed。
 */
export async function desktopUpgradeFromRegistry(
  pkg: string,
  cfg: RegistryConfig = {},
  opts: DesktopUpgradeOptions = {},
  deps: DesktopUpgradeDeps = {},
): Promise<DesktopInstallResult & { fromVersion?: string; activation?: ActivationClassification }> {
  try {
    const result = await withMutationSession(() => desktopUpgradeLocked(pkg, cfg, opts, deps))
    if ('needsBuildApproval' in result) {
      await journalExternalOperation(opts.channel, { kind: 'desktop-upgrade', target: pkg }, 'failed', {
        reason: result.message,
        appendExternalOperation: deps.appendExternalOperation,
      })
      return result
    }
    await journalExternalOperation(
      opts.channel,
      {
        kind: 'desktop-upgrade',
        target: pkg,
        ...(result.fromVersion ? { fromVersion: result.fromVersion } : {}),
        ...(result.version ? { toVersion: result.version } : {}),
      },
      'ok',
      { appendExternalOperation: deps.appendExternalOperation },
    )
    return result
  } catch (err) {
    await journalExternalOperation(opts.channel, { kind: 'desktop-upgrade', target: pkg }, 'failed', {
      reason: err instanceof Error ? err.message : String(err),
      appendExternalOperation: deps.appendExternalOperation,
    })
    throw err
  }
}

/** 0.10.0 R6：自升级专用通道的目标包（core 缝改道唯一判据；host-api/tools/客户端零特判）。 */
export const SELF_PKG = 'dsh-m'

/** D3 自升级专用通道的可注入依赖（测试；缺省 = 真实现）。 */
export interface DesktopSelfUpgradeDeps {
  getService?: () => DesktopManagerLike | undefined
  ensureService?: (timeoutMs?: number) => Promise<DesktopManagerLike | undefined>
  npmLatest?: typeof defaultNpmLatest
  npmTarballUrl?: typeof defaultNpmTarballUrl
  writeUpgradeIntent?: typeof defaultWriteUpgradeIntent
  resolveUpgradeIntent?: typeof defaultResolveUpgradeIntent
  listInstalled?: typeof defaultListInstalled
}

/**
 * Desktop 自升级专用通道（0.10.0，R6/R7/D3）：npmLatest 精确版本 → 生效 registry packument 的
 * dist.tarball → 预写 intent → installBundle(tarballUrl, {enabled:true}) 直覆盖——tarball spec
 * 的包名在 pnpm 前不可知，不受宿主 0.2.1 already-installed 守卫约束（本机 spike 实证）。
 * - 恒 panel 语义零外部日志（ADR-0018）：intent 预写落独立 ledger（upgrade-intent.ts），不入 external journal；
 * - 同版本 → install-refused no-op（T10）；URL 构造失败发生在预写之前 → 零副作用失败（T12）；
 * - install 终态失败 → 旧版不受影响（spike 实证）+ intent 收口 failed；
 * - 成功（applied/restart-required/overridden）→ intent 收口 ok + installedVersion；
 * - promise 悬垂（进程死于活交换）→ intent 保持 delegated，由 self-check 对账收口（崩溃兜底网）。
 * 导出层自包 withMutationSession（market.ts 同惯例）；core 缝改道发生在宿主 upgrade/install 的
 * session 之内，直接调 Locked 内层避免嵌套。
 */
export async function desktopSelfUpgradeViaTarball(
  pkgName: string,
  currentVersion: string,
  opts: { timeoutMs?: number; signal?: AbortSignal; profileDir?: string } = {},
  deps: DesktopSelfUpgradeDeps = {},
): Promise<DesktopInstallResult & { needsRestart: boolean }> {
  return withMutationSession(() => desktopSelfUpgradeViaTarballLocked(pkgName, currentVersion, opts, deps))
}

async function desktopSelfUpgradeViaTarballLocked(
  pkgName: string,
  currentVersion: string,
  opts: { timeoutMs?: number; signal?: AbortSignal; profileDir?: string },
  deps: DesktopSelfUpgradeDeps,
): Promise<DesktopInstallResult & { needsRestart: boolean }> {
  const service = await resolveManager(deps)
  if (!service || typeof service.installBundle !== 'function') {
    throw new DesktopOpsError('no-manager', '官方 pluginManager 服务不可用（desktop profile 的自升级必须由官方管理器执行）；拒绝自升级（fail-closed）')
  }
  const timeoutMs = opts.timeoutMs ?? 20_000
  const latest = await (deps.npmLatest ?? defaultNpmLatest)(pkgName, timeoutMs, opts.signal)
  if (latest.version === currentVersion) {
    throw new DesktopOpsError('install-refused', `已是最新版本（${pkgName}@${currentVersion}），无需升级`)
  }
  const spec = await (deps.npmTarballUrl ?? defaultNpmTarballUrl)(pkgName, latest.version, timeoutMs, opts.signal)
  // 预写 intent（崩溃兜底网）：URL 构造失败已在此前抛出，零落盘（T12）
  await (deps.writeUpgradeIntent ?? defaultWriteUpgradeIntent)({
    target: pkgName,
    version: latest.version,
    ...(currentVersion !== '' ? { fromVersion: currentVersion } : {}),
    at: Date.now(),
  })
  const resolveIntent = deps.resolveUpgradeIntent ?? defaultResolveUpgradeIntent
  try {
    let change = changeOf(await service.installBundle(spec, { enabled: true }))
    // 0.10.1：enable 阶段竞速自动重试（与 runManagedInstall 各腿同款；skip-auth@0.4.1 真机事件实证竞速窗口真实）
    if (change.stage === 'enable' && (change.application === 'failed' || change.error)) {
      if (enableRetryDelayMs > 0) await sleepMs(enableRetryDelayMs)
      change = changeOf(await service.installBundle(spec, { enabled: true }))
    }
    if (isTerminalFailure(change)) {
      // 0.10.2（D3 dogfood 实证，0.10.0→0.10.1 真机事件）：宿主对自身 bundle 换装存在 post-write 伪失败——
      // installBundle 已写穿三面账（manifest/node_modules/lock 均为目标版）却回传 failed/already-installed
      // （自指操作伪影：写完后 manifest 含该名，宿主完成路径自触守卫）。终态失败一律实读账面：
      // 目标版已写入 = 升级事实成立，按成功改判（needsRestart=true，重启激活）；否则真失败（原语义）。
      let installedVersion: string | undefined
      if (opts.profileDir && deps.listInstalled) {
        try {
          const row = (await deps.listInstalled(opts.profileDir)).items.find((it) => it.pkg === pkgName)
          installedVersion = row?.version
        } catch {
          // 复读失败按真失败处理
        }
      }
      if (installedVersion === latest.version) {
        await resolveIntent({ ok: true, installedVersion: latest.version })
        return {
          id: pkgName,
          pkg: pkgName,
          spec,
          version: latest.version,
          buildApprovals: Array.isArray(change.approvedBuilds) ? change.approvedBuilds : [],
          fallbackAllBuilds: false,
          needsRestart: true,
          output: `official pluginManager (self-upgrade via tarball): application=${change.application ?? 'failed'}、error=${change.error?.code ?? 'terminal-failure'} 经账实复读改判成功——目标版 ${latest.version} 已写入（宿主自升级 post-write 伪失败），重启 Desktop 激活`,
          via: 'desktop-manager',
        }
      }
      const pending = pendingOf(change)
      if (change.application === 'cancelled') {
        throw new DesktopOpsError('install-refused', `自升级已被取消（${pkgName}）：当前版本 ${currentVersion} 不受影响`)
      }
      if (change.packageResult?.kind === 'build-blocked' && pending.length > 0) {
        throw new DesktopBuildApprovalNeeded(pending)
      }
      throw new DesktopOpsError('install-refused', `自升级失败（${pkgName}@${latest.version}；application=${change.application ?? 'failed'}${change.error?.code ? `、error=${change.error.code}` : ''}）：当前版本 ${currentVersion} 不受影响，可稍后重试`)
    }
    const bundleName = change.bundle ?? pkgName
    if (typeof service.listBundles === 'function') {
      const bundles = await service.listBundles()
      const found = (bundles ?? []).find((b) => b && b.name === bundleName)
      if (!found || found.installed === false) {
        throw new DesktopOpsError('verify-failed', `自升级复读失败（${pkgName}）：官方结果为 ${change.application ?? 'unknown'} 但 listBundles 未見目标 bundle 在装——不冒充升级成功`)
      }
    }
    await resolveIntent({ ok: true, installedVersion: latest.version })
    return {
      id: pkgName,
      pkg: pkgName,
      spec,
      version: latest.version,
      buildApprovals: Array.isArray(change.approvedBuilds) ? change.approvedBuilds : [],
      fallbackAllBuilds: false,
      // R10 忠实透传宿主 application：restart-required → true；applied/overridden → false
      needsRestart: change.application === 'restart-required',
      output: `official pluginManager (self-upgrade via tarball): application=${change.application ?? 'applied'}, bundle=${bundleName}`,
      via: 'desktop-manager',
      ...(change.application === 'overridden' ? { overridden: true } : {}),
    }
  } catch (err) {
    // 未竟路径统一收口 intent 为 failed（成功臂已 resolve 时幂等 no-op）；
    // 收口失败不遮蔽原始错误——delegated 残留由 self-check 对账兜底。
    try {
      await resolveIntent({ ok: false })
    } catch {
      /* 对账兜底仍在 */
    }
    throw err
  }
}

async function desktopUpgradeLocked(
  pkg: string,
  cfg: RegistryConfig,
  opts: DesktopUpgradeOptions,
  deps: DesktopUpgradeDeps,
): Promise<DesktopInstallResult & { fromVersion?: string; activation?: ActivationClassification }> {
  const service = await resolveManager(deps)
  if (!service || typeof service.installBundle !== 'function') {
    throw new DesktopOpsError('no-manager', '官方 pluginManager 服务不可用（desktop profile 的升级必须由官方管理器执行覆盖安装）；拒绝升级（fail-closed）')
  }
  const timeoutMs = cfg.timeoutMs ?? 20_000
  // 0.10.0 R6 自升级通道分治（唯一改道点）：desktop 上「升级 dsh-m 自身」一律 D3 tarball 直覆盖——
  // remove+add 对调用者自身是破坏性路径，绝不落入通用两步；host-api `case 'upgrade'`、tools
  // `dshm_upgrade` 与一切经 core 的入口在此自动获得同语义（客户端与工具层零特判）。
  if (pkg === SELF_PKG) {
    const { items } = await (deps.listInstalled ?? defaultListInstalled)(opts.profileDir)
    const selfTarget = items.find((it) => it.pkg === pkg)
    if (!selfTarget) throw new DesktopOpsError('install-refused', `desktop profile 未安装该插件: ${pkg}（升级目标必须是已装插件）`)
    return desktopSelfUpgradeViaTarballLocked(pkg, selfTarget.version, { timeoutMs, signal: opts.signal, profileDir: opts.profileDir }, {
      getService: () => service,
      npmLatest: deps.npmLatest,
      npmTarballUrl: deps.npmTarballUrl,
      writeUpgradeIntent: deps.writeUpgradeIntent,
      resolveUpgradeIntent: deps.resolveUpgradeIntent,
      listInstalled: deps.listInstalled,
    })
  }
  const loaded = await (deps.loadRegistry ?? defaultLoadRegistry)(cfg, { namespace: opts.namespace ?? 'host', profile: opts.profile })
  // ADR-0026（issue #30）：条目查找降级为元数据增强——registry unavailable 不再硬阻断升级；
  // 主清单+社区均 miss 时经合成条目走同一委派管线，本地/非线上来源转译为结构化 upgrade-unsupported。
  const registryUsable = loaded.status !== 'unavailable'
  const { items } = await (deps.listInstalled ?? defaultListInstalled)(opts.profileDir)
  const target = items.find((it) => it.pkg === pkg)
  if (!target) throw new DesktopOpsError('install-refused', `desktop profile 未安装该插件: ${pkg}（升级目标必须是已装插件）`)
  let entry: InstallableEntry | undefined
  if (registryUsable) {
    // 0.5.1 同语义：主清单 miss 查社区目录（合并市场安装的社区条目同样可升级）。
    // 0.9.68（ADR-0016 / R2-3）：经物化合并市场全量域 lookupInstalledAll（含 displaced 让位条目，
    // min-ord = 今日「先主清单后社区 adapt 全量」合成语义）；reject 透传由窄 catch 吞为 miss。
    entry = loaded.registry.plugins.find((e) => matchInstalledByEntry(e, [target]))
    if (!entry) {
      try {
        const communityTask = (deps.fetchCommunityCatalog ?? defaultFetchCommunityCatalog)(cfg, { namespace: opts.namespace ?? 'host', signal: opts.signal, profile: opts.profile })
        const outcome = await mergedOutcome({
          namespace: opts.namespace ?? 'host',
          profile: opts.profile ?? WEB_PROFILE,
          cfg,
          registry: loaded,
          communityTask,
          deadlineAt: Date.now() + DEFAULT_COMMUNITY_DEADLINE_MS,
        })
        entry = outcome.lookupInstalledAll(target) as InstallableEntry | undefined
      } catch {
        entry = undefined
      }
    }
  }
  if (!entry) {
    try {
      entry = synthesizeInstallableEntry(target)
    } catch (err) {
      if (err instanceof UpgradePathUnsupportedError) {
        throw new DesktopOpsError('upgrade-unsupported', err.message)
      }
      throw err
    }
  }

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

  // ADR-0009：委派前治理 + 预检收敛（同 desktopInstallLocked；0:15 quota-watch 事件为治理前的旧形态实证）
  let governanceNote = ''
  let releaseAgeNotice = ''
  let governedMergedNames: string[] | undefined
  if (entry.source === 'npm' && version !== undefined && opts.profileDir) {
    try {
      const gov = await (deps.governExclude ?? governExcludeBlock)(opts.profileDir)
      if (gov.changed && gov.mergedNames?.length) {
        governanceNote = `；排除条目治理：合并 ${gov.mergedNames.join('、')}`
        governedMergedNames = gov.mergedNames
      }
    } catch {
      // fail-open：治理失败不阻塞委派
    }
    const gate = await releaseAgePrecheck({
      pkg,
      version,
      profileDir: opts.profileDir,
      timeoutMs,
      signal: opts.signal,
      deps: { packumentTimes: deps.packumentTimes, workspacePolicy: deps.workspacePolicy },
    })
    if (gate.blocked) {
      throw new DesktopOpsError('release-age-wait', gate.message + governanceNote, { blockers: gate.blockers, ...(governedMergedNames !== undefined ? { governanceMerged: governedMergedNames } : {}) })
    }
    if (gate.notice) releaseAgeNotice = `；${gate.notice}`
  }

  let change: DesktopChangeResult
  let bundleName: string
  let registerNote: string | undefined
  let managed: Awaited<ReturnType<typeof runManagedInstall>> | undefined
  try {
    managed = await runManagedInstall(
      service,
      { pkg, spec, version, previousVersion: target.version, profileDir: opts.profileDir, approvedBuilds: opts.approvedBuilds, listInstalled: deps.listInstalled },
      { governExclude: deps.governExclude, registerExclude: deps.registerExclude, packumentTimes: deps.packumentTimes },
    )
    change = managed.change
    bundleName = managed.bundleName
    registerNote = managed.registerNote
  } catch (err) {
    if (err instanceof DesktopBuildApprovalNeeded) {
      return { ok: false, needsBuildApproval: true, id: entry.id, pkg, spec, pendingBuilds: err.pendingBuilds, message: err.message + governanceNote }
    }
    if (err instanceof Error) {
      if (governanceNote !== '' && !err.message.includes(governanceNote)) err.message += governanceNote
      if (managed?.governRetryNote !== undefined && !err.message.includes(managed.governRetryNote)) err.message += managed.governRetryNote
    }
    throw err
  }
  const retryNote = managed.governRetryNote !== undefined && !governanceNote.includes(managed.governRetryNote) ? managed.governRetryNote : ''
  const twoStepSuffix = managed.twoStepNote !== undefined ? `；${managed.twoStepNote}` : ''
  const degradedRestoredTo = managed.degraded === true ? managed.restoredTo : undefined
  const degradedSuffix = degradedRestoredTo !== undefined ? `；升级失败已回装旧版 ${degradedRestoredTo}（降级恢复）` : ''

  // 0.9.22 生效判定：npm 源升级在成功点分类；任何异常 fail-open 到 unknown，绝不影响升级成功态
  let activation: ActivationClassification | undefined
  let needsRestart = true
  if (entry.source === 'npm' && entry.npm && target.version && version !== undefined) {
    try {
      activation = await (deps.classifyActivation ?? classifyUpgradeActivation)(entry.npm, target.version, version)
      if (activation === 'client-only') needsRestart = false
    } catch {
      activation = 'unknown'
    }
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
    needsRestart,
    output: `official pluginManager: application=${change.application ?? 'applied'}, bundle=${bundleName}${change.changed === false ? ', changed=false' : ''}${governanceNote}${retryNote}${releaseAgeNotice}${registerNote ?? ''}${twoStepSuffix}${degradedSuffix}`,
    via: 'desktop-manager',
    ...(change.application === 'overridden' ? { overridden: true } : {}),
    ...(degradedRestoredTo !== undefined ? { degraded: true, restoredTo: degradedRestoredTo } : {}),
    // 0.10.0（评审 R1-2）：降级恢复的 version 落账为回装后实际版本（账实相符）；spec 字段保留尝试目标
    ...(degradedRestoredTo !== undefined ? { version: degradedRestoredTo } : {}),
    fromVersion: target.version,
    ...(activation ? { activation } : {}),
  }
}
