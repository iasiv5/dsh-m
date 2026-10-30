/**
 * 市场变更编排（GLOSSARY「市场变更编排 Market Mutation」；ADR-0024）：写侧——
 * 收录条目解析、兼容预检、快照、安装/卸载/升级/自升级的 Profile 变更事务编排。
 * 自 market.ts「安装 / 升级」段（原 1001–1960 行）verbatim 迁出，零行为搬家；
 * 单向依赖读侧 market.ts（探测缓存定向失效）与 merged-market。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHome, webProfileDir, WEB_PROFILE } from './env.js'
import {
  runProfileTransaction,
  makeNpmWarmPackument,
  TransactionError,
  type HealAction,
  type TransactionDeps,
} from './profile-transaction.js'
import {
  listInstalledPlugins as defaultListInstalledPlugins,
  type InstalledPlugin,
} from './installed.js'
import { setLivePluginDisabled, loaderHost, type LoaderEntry } from './live-plugin.js'
import { precheckNpmCompat, IncompatibleError, type CompatIssue } from './compat-check.js'
import { PROTECTED_MODULES, composeEnablement, type PluginEnablement } from './enablement.js'
import { readProfileOverrides } from './patch-yaml.js'
import {
  loadRegistry as defaultLoadRegistry,
  type LoadedRegistry,
  type RegistryCacheNamespace,
  type RegistryConfig,
  type RegistryEntry,
  type RegistryState,
} from './registry.js'
import {
  fetchCommunityCatalog as defaultFetchCommunityCatalog,
  type LoadedCommunity,
} from './community.js'
// 0.9.68（ADR-0016）：合并层迁入 merged-market.ts（communityOutcome/mergeRegistries/communitySummary/
// deadlineRace/matchInstalledByEntry/isCommunityEntry/COMMUNITY_CATEGORY_LABELS）——market↔community
// import 环自此断开；re-export 保既有消费方（tools.ts 的类型、profile-ops 的 matchInstalledByEntry）零改动。
import {
  communityOutcome,
  communityTimeoutSummary,
  withFallbackLookups,
  deadlineRace,
  isCommunityEntry,
  matchInstalledByEntry,
  mergedOutcome,
  type CommunityRegistrySummary,
  type MergedOutcome,
} from './merged-market.js'
import type { CommunityEntry } from './community-adapter.js'
import { synthesizeInstallableEntry } from './upgrade-target.js'
import { normalizeSearchText, relevanceScore, tokenizeSearchText } from './search-relevance.js'
import { GithubBudgetExhaustedError, createGithubRequestBudget, githubLatestTag as rawGithubLatestTag, isExactVersion, type GithubBudget } from './versions.js'
import { classifyUpgradeActivation, type ActivationClassification } from './activation.js'
import { HttpError } from './httpx.js'
import { ensureLatestCacheSwept, invalidateLatestCache, latestCacheKey, latestItemId, peekLatestCache, readLatestCache, writeLatestCache, type LatestValue } from './latest-cache.js'
import { verifyInstalledAdditions, type GuardViolation } from './install-guard.js'
import { journalExternalOperation, type OperationChannel, type AppendExternalOperation } from './external-journal.js'
import { readPnpmLockIntegrity } from './npm-integrity.js'
import { isGenerationProjectionPkg } from './generation-projection.js'
import type { CompensateEvidence, PriorUnion, TransactionResult } from './profile-transaction.js'
import { decodeUtf8Fatal, fetchTextLimited } from './httpx.js'
import {
  githubLatestTag as defaultGithubLatestTag,
  isNewerVersion,
  npmLatest as defaultNpmLatest,
  npmVersion,
} from './versions.js'
import { invalidateLatestForEntry, DEFAULT_DEADLINE_MS, type MarketDeps, type RegistryRuntimeOptions } from './market.js'

// ---------- 安装 / 升级 ----------

/** 安装/升级路径可注入依赖（测试用；生产走真实实现）。Task 9 起事务注入走 `transaction`。 */
export interface InstallDeps extends Partial<MarketDeps> {
  npmVersion?: typeof npmVersion
  /** GitHub candidate key 预解析注入（M2 Task 3 测试用；缺省 = 真实抓取 pinned package.json） */
  candidateKey?: typeof candidateKeyOf
  /** peer 兼容预检注入（Task 11）；缺省 = precheckNpmCompat */
  precheck?: typeof precheckNpmCompat
  /** 生效判定注入（0.9.22 测试用；缺省 = classifyUpgradeActivation，npm 源升级成功点调用） */
  classifyActivation?: (pkg: string, fromVersion: string, toVersion: string) => Promise<ActivationClassification>
  /** 事务依赖注入（runner/预热/退避/tmpdir 等）；B3 预热统一走 transaction.warmPackument */
  transaction?: TransactionDeps
  /** 目标 profile 目录（0.9.0 双 profile；缺省 webProfileDir()；transaction.profileDir 优先） */
  profileDir?: string
  /** 外部操作直落钩子注入（0.9.79 ADR-0018，R3-1；缺省 = 真实现 appendExternalOperation） */
  appendExternalOperation?: AppendExternalOperation
}

export interface InstallResult {
  id: string
  pkg: string
  spec: string
  version?: string
  sha?: string
  tag?: string
  /** 精确放行的构建脚本包名（未走放行 = []；ADR-0002） */
  buildApprovals: string[]
  /** pending 名单读不出时的全量兜底标记 */
  fallbackAllBuilds: boolean
  /** verify 阶段观察：装成纯依赖（无补丁层且不在 bundles）——只警告不回滚 */
  bundleWarning?: 'no-patch-layer'
  /** 守卫 fail-open：结论不可定的包放行时的警告（M2 Task 3） */
  guardWarning?: string
  /** peer 兼容预检结果（null = 兼容或未检；Task 11） */
  compat?: CompatIssue | null
  /** github 源不做兼容预检的明示（Task 11） */
  compatSkipped?: 'github-source'
  /** 变更完成需重启宿主生效。0.9.22 源头放宽 boolean：TS 禁止派生接口放宽属性（TS2430），UpgradeResult 纯客户端更新覆写 false；生产方语义不变（install/uninstall/self-upgrade 恒 true）。 */
  needsRestart: boolean
  output: string
  /** 事务自愈动作（机器可断言 code + 给人看的 note） */
  healActions?: HealAction[]
}

/** 从 registry 收录条目安装（npm → 精确锁定最新版；github → 锁 HEAD SHA）。
 *  0.7.1 修复：合并市场展示的社区条目 id 不在主清单（loadRegistry 只装载主清单，
 *  社区层只合入 listMarket 展示）——主清单 miss 时按收录 id 查社区目录再装，
 *  与 0.5.1 升级路径（findCommunityUpgradeEntry）同构。 */
/**
 * 按收录 id 解析可安装条目（0.9.0 Task 5 抽出）：主清单优先，社区目录兜底。
 * installFromRegistry 与 Desktop adapter（profile-ops）共用同一解析与错误文案。
 */
export async function resolveRegistryEntry(
  id: string,
  cfg: RegistryConfig = {},
  opts: { version?: string; forceIncompatible?: boolean } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallableEntry> {
  const loaded = await (deps?.loadRegistry ?? defaultLoadRegistry)(cfg, { namespace: opts.namespace ?? 'host', profile: opts.profile })
  if (loaded.status === 'unavailable') {
    throw new Error(`收录清单不可用，无法安装 ${id}；请检查 registry 配置或网络后重试`)
  }
  // 主清单优先短路（今日语义原样）：primary 命中不触碰社区——社区异常不阻断主清单条目安装。
  const primaryEntry = loaded.registry.plugins.find((e) => e.id === id)
  if (primaryEntry) return primaryEntry
  // 0.9.68（ADR-0016 / R2-3）：主清单 miss 时经物化合并市场取全量域 findById（[primary..., adapt 全量...]
  // 含 displaced 让位条目——id-让位条目今日可装，语义零变化）；同身份命中免每装机 4,400 条重 adapt。
  // communityTask reject 透传，由窄 catch 吞为 miss（与旧 findCommunityInstallEntry 同构 →「没有该条目」）。
  try {
    const communityTask = (deps?.fetchCommunityCatalog ?? defaultFetchCommunityCatalog)(cfg, { namespace: opts.namespace ?? 'host', signal: opts.signal, profile: opts.profile })
    const outcome = await mergedOutcome({
      namespace: opts.namespace ?? 'host',
      profile: opts.profile ?? WEB_PROFILE,
      cfg,
      registry: loaded,
      communityTask,
      deadlineAt: Date.now() + DEFAULT_DEADLINE_MS,
    })
    const entry = outcome.findById(id)
    if (entry) return entry
  } catch {
    /* 社区失败/异常吞为 miss（今日语义） */
  }
  throw new Error(`registry 中没有该条目: ${id}`)
}

export async function installFromRegistry(
  id: string,
  cfg: RegistryConfig = {},
  opts: { version?: string; forceIncompatible?: boolean; channel?: OperationChannel } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallResult> {
  // 0.9.79 外部操作直落（ADR-0018）：终态后挂钩，成功与失败都记；append 失败被钩子吞（R1-1）
  try {
    const entry = await resolveRegistryEntry(id, cfg, opts, deps)
    const result = await installEntry(entry, cfg, opts, deps)
    await journalExternalOperation(
      opts.channel,
      { kind: 'install', target: id, ...(result.version ? { toVersion: result.version } : {}) },
      'ok',
      { appendExternalOperation: deps?.appendExternalOperation },
    )
    return result
  } catch (err) {
    await journalExternalOperation(
      opts.channel,
      { kind: 'install', target: id },
      'failed',
      { reason: errText(err), appendExternalOperation: deps?.appendExternalOperation },
    )
    throw err
  }
}

/** 安装接口收窄（M1 Task 5）：社区条目（CommunityEntry）与主清单条目同型可装。 */
export type InstallableEntry = Pick<RegistryEntry, 'id' | 'source' | 'npm' | 'github'>

// ---------- M2 Task 3：统一 mutation session + 装后守卫 + 补偿接线 ----------

let sessionTail: Promise<unknown> = Promise.resolve()

/**
 * 统一 mutation 串行区间（模块级 FIFO，非重入）：包住全部五个 profile mutation 入口
 * （installFromRegistry / upgradePlugin / uninstallPlugin / selfUpgrade / toggle）。
 * session 单点获取——只在 core façade 获取（toggle 在 togglePlugin 本体），host-api/tools/CLI
 * 层不得重复获取（session 非重入，多层重复获取会死锁）。锁序：mutation session 外层 →
 * toggle file lock / 事务 FIFO 内层。
 */
export async function withMutationSession<T>(fn: () => Promise<T>): Promise<T> {
  const run = sessionTail.then(
    () => fn(),
    () => fn(),
  )
  sessionTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** 守卫拦截的结构化错误（非成功状态）：三端按 kind/needsRestart/restartSafe 渲染，无 force 通道。 */
export class InstallGuardError extends Error {
  readonly kind: 'compensated' | 'manual_required'
  readonly violations: GuardViolation[]
  readonly needsRestart: boolean
  readonly restartSafe: boolean
  /** 补偿终态摘要（rolled-back/manual-repair/rejected 的 note） */
  readonly compensation: { status: string; note: string }
  /** manual-repair 的修复依据（旧 manifestSpec/installSpec/mapping） */
  readonly repairBasis?: string

  constructor(fields: {
    kind: 'compensated' | 'manual_required'
    message: string
    violations: GuardViolation[]
    needsRestart: boolean
    restartSafe: boolean
    compensation: { status: string; note: string }
    repairBasis?: string
  }) {
    super(fields.message)
    this.name = 'InstallGuardError'
    this.kind = fields.kind
    this.violations = fields.violations
    this.needsRestart = fields.needsRestart
    this.restartSafe = fields.restartSafe
    this.compensation = fields.compensation
    this.repairBasis = fields.repairBasis
  }

  /**
   * 线格式单一事实源（0.9.93）：三端共享的 6 字段守卫投影。各端信封自拼（host-api 409 payload 的
   * ok/error、tools 的 ok/guard/message、cli 的裸 JSON），共享部分一律经此方法——加守卫字段只改
   * 本方法 + client 读取一处。repairBasis undefined 时键不存在（今日 5 处投影同语义）。
   */
  toWire(): InstallGuardWire {
    return {
      kind: this.kind,
      violations: this.violations,
      compensation: this.compensation,
      needsRestart: this.needsRestart,
      restartSafe: this.restartSafe,
      ...(this.repairBasis ? { repairBasis: this.repairBasis } : {}),
    }
  }
}

/** InstallGuardError 的三端共享线格式（toWire 的返回形状；键序与键缺席语义被 install-guard.test.mjs 钉住）。 */
export interface InstallGuardWire {
  kind: 'compensated' | 'manual_required'
  violations: GuardViolation[]
  compensation: { status: string; note: string }
  needsRestart: boolean
  restartSafe: boolean
  repairBasis?: string
}

export type { GuardViolation } from './install-guard.js'

export interface PreMutationSnapshot {
  deps: Record<string, string>
  lockResolutions: Record<string, { version?: string; integrity?: string; commit?: string }>
  mapping: { workspace: Array<{ key: string; patchPath: string }>; manifest: Array<{ key: string; patchPath: string }> }
}

/** lockfile packages 段的目标包 resolution 提取（行扫描：键行 `pkg@ver:` → 收集至下一键行；引号/嵌套键兼容）。 */
function lockResolutionOf(lockText: string, pkg: string): { version?: string; integrity?: string; commit?: string } | null {
  // 只扫顶层 packages: 段（importer 段的同名键不参与；packages: 后条目缩进两空格）
  const pkgsAt = lockText.split('\n').findIndex((l) => l.trim() === 'packages:')
  if (pkgsAt < 0) return null
  const lines = lockText.split('\n').slice(pkgsAt + 1)
  let body: string[] | null = null
  for (const line of lines) {
    if (body !== null && /^\S/.test(line)) break // 顶层新段 → 收集结束
    // 0.5.1 修复：收尾引号必须可选消耗——pnpm lockfile 对 scoped 包键恒带引号
    //（`'@scope/name@1.2.3':`），旧正则匹配不到任何带引号键，导致 scoped 已装插件
    // 的 lockResolution 恒为 null → derivePrior 误判 restorable:false → 升级被守卫硬拒。
    const keyMatch = /^  '?(?:[^'\n]*node_modules\/)?([^\s':]+)'?:\s*$/.exec(line)
    if (keyMatch) {
      if (body) break
      const key = keyMatch[1] ?? ''
      if (key === pkg || key.startsWith(`${pkg}@`)) body = []
      continue
    }
    if (body) body.push(line)
  }
  if (body === null) return null
  const text = body.join('\n')
  const version = /version:\s*'?([^'\n]+)/.exec(text)?.[1]?.trim()
  // 0.5.1：integrity 捕获排除 flow 结尾（`,`/`}`/引号）——与 npm-integrity.ts parsePackagesSection
  // 同口径；旧 `(\S+)` 会把 `{integrity: sha512-...}` 的收尾 `}` 一起带进 prior 证据。
  const integrity = /integrity:\s*([^,}\s'"]+)/.exec(text)?.[1]?.trim()
  const commit = /commit:\s*'?([0-9a-f]{40})/.exec(text)?.[1]?.trim()
  if (!version && !integrity && !commit) return null
  return { ...(version ? { version } : {}), ...(integrity ? { integrity } : {}), ...(commit ? { commit } : {}) }
}

/** 变更前全量快照（v6）：deps / lock resolutions / 双落点 mapping。读取失败 → unavailable（fail-closed 拒绝安装）。 */
export async function capturePreMutationState(profileDir: string): Promise<{ kind: 'unavailable'; reason: string } | { kind: 'snapshot'; snapshot: PreMutationSnapshot }> {
  try {
    // manifest ENOENT = 无已装依赖的空 profile（与 guard readDeps 同语义）；其他读取/解析失败 → fail-closed
    let manifestText = ''
    try {
      manifestText = await readFile(join(profileDir, 'package.json'), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    const doc = manifestText
      ? (JSON.parse(manifestText) as { dependencies?: unknown; pnpm?: { patchedDependencies?: unknown } })
      : {}
    const deps: Record<string, string> = {}
    if (doc.dependencies && typeof doc.dependencies === 'object' && !Array.isArray(doc.dependencies)) {
      for (const [name, spec] of Object.entries(doc.dependencies as Record<string, unknown>)) {
        if (typeof spec === 'string') deps[name] = spec
      }
    }
    const manifestMapping: Array<{ key: string; patchPath: string }> = []
    const patched = doc.pnpm?.patchedDependencies
    if (patched && typeof patched === 'object' && !Array.isArray(patched)) {
      for (const [key, patchPath] of Object.entries(patched as Record<string, unknown>)) {
        if (typeof patchPath === 'string') manifestMapping.push({ key, patchPath })
      }
    }
    let lockText = ''
    try {
      lockText = await readFile(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
    } catch {
      lockText = ''
    }
    const lockResolutions: PreMutationSnapshot['lockResolutions'] = {}
    for (const name of Object.keys(deps)) {
      const res = lockResolutionOf(lockText, name)
      if (res) lockResolutions[name] = res
    }
    const workspaceMapping: Array<{ key: string; patchPath: string }> = []
    try {
      const ws = await readFile(join(profileDir, 'pnpm-workspace.yaml'), 'utf8')
      const inBlock = /^patchedDependencies:/m
      if (inBlock.test(ws)) {
        const section = ws.split(/^patchedDependencies:/m)[1]?.split(/^\S/m)?.[0] ?? ''
        for (const line of section.split('\n')) {
          const m = /^\s+'?([^':]+)'?:\s*(\S+)/.exec(line)
          if (m) workspaceMapping.push({ key: m[1]!.trim(), patchPath: m[2]!.trim() })
        }
      }
    } catch {
      /* 无 workspace 文件 = 无 workspace mapping */
    }
    return { kind: 'snapshot', snapshot: { deps, lockResolutions, mapping: { workspace: workspaceMapping, manifest: manifestMapping } } }
  } catch (err) {
    return { kind: 'unavailable', reason: err instanceof Error ? err.message : String(err) }
  }
}

/** mapping 条目按真实 key 精确关联（key === realKey 或版本化 key `realKey@x`）；不按 repo/id/相似名猜。 */
function mappingFor(mapping: { workspace: Array<{ key: string; patchPath: string }>; manifest: Array<{ key: string; patchPath: string }> }, realKey: string) {
  const pick = (rows: Array<{ key: string; patchPath: string }>) => rows.filter((r) => r.key === realKey || r.key.startsWith(`${realKey}@`))
  return { workspace: pick(mapping.workspace), manifest: pick(mapping.manifest) }
}

/**
 * prior 派生（add 返回真实 key 后、守卫前）：严格按真实 key 关联快照；判定表唯一映射。
 * 来源白名单（独立实现，不复用 parseSpecSource）：精确 npm version（含 ^/~ 书写）与
 * pinned github commit + lock identity 可自动恢复；alias/workspace/tarball URL/git+ssh/link/file 一律 restorable:false。
 *
 * facts.generationProjected（issue #6 修法 B）：node_modules/<pkg> 是宿主代际系统的
 * .generations 投影时，代际目录自身就是完整可回退快照（官方代际系统拥有完整性与
 * 回退），restorable 直接成立，不依赖 lockfile integrity——generation 安装形态的
 * lockfile 恒为 `link:`（无 resolution.integrity），按基线判 restorable:false 会把
 * 全部投影形态插件硬拒在 prior 门（dataelement/dsh-desktop 实测 12/12 命中）。
 */
export function derivePrior(
  snapshot: PreMutationSnapshot,
  realKey: string,
  facts?: { generationProjected?: boolean },
): { kind: 'none' } | { kind: 'mappingOnly'; patchMapping: { workspace: Array<{ key: string; patchPath: string }>; manifest: Array<{ key: string; patchPath: string }> } } | { kind: 'dependency'; state: PriorStateExport } | { kind: 'unavailable'; reason: string } {
  const spec = snapshot.deps[realKey]
  const mapping = mappingFor(snapshot.mapping, realKey)
  if (spec === undefined) {
    if (mapping.workspace.length > 0 || mapping.manifest.length > 0) {
      return { kind: 'mappingOnly', patchMapping: mapping }
    }
    return { kind: 'none' }
  }
  const lock = snapshot.lockResolutions[realKey] ?? null
  let sourceKind: 'npm' | 'github' | 'other' = 'other'
  let restorable = false
  if (isExactVersion(spec)) {
    sourceKind = 'npm'
    restorable = Boolean(lock?.integrity)
  } else if (/^[~^]\d/.test(spec) && isExactVersion(spec.slice(1))) {
    // ^/~ 锚定（0.4.x 旧 CLI 书写）：恢复后接受规范化并明示
    sourceKind = 'npm'
    restorable = Boolean(lock?.integrity)
  } else if (/^github:[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+#[0-9a-f]{40}$/.test(spec)) {
    sourceKind = 'github'
    restorable = Boolean(lock?.commit)
  }
  if (facts?.generationProjected === true) restorable = true
  return {
    kind: 'dependency',
    state: {
      manifestSpec: spec,
      installSpec: spec,
      resolvedVersion: lock?.version,
      sourceKind,
      ...(lock?.integrity ? { integrity: lock.integrity } : {}),
      ...(lock ? { lockResolution: lock } : {}),
      patchMapping: mapping,
      restorable,
    },
  }
}

interface PriorStateExport {
  manifestSpec: string
  installSpec: string
  resolvedVersion?: string
  sourceKind: 'npm' | 'github' | 'other'
  integrity?: string
  lockResolution?: { version?: string; integrity?: string; commit?: string }
  patchMapping: { workspace: Array<{ key: string; patchPath: string }>; manifest: Array<{ key: string; patchPath: string }> }
  restorable: boolean
}

/** GitHub candidate preflight：只读抓取 pinned SHA 的 package.json 解析 name（预算外 read-only 通道，不写 profile）。 */
async function candidateKeyOf(repo: string, sha: string, timeoutMs: number): Promise<string | null> {
  const text = await fetchTextLimited(`https://raw.githubusercontent.com/${repo}/${sha}/package.json`, { timeoutMs, maxBytes: 512 * 1024 })
  const doc = JSON.parse(text) as { name?: unknown }
  return typeof doc.name === 'string' && doc.name.trim() !== '' ? doc.name.trim() : null
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 补偿执行 + InstallGuardError 抛出（四态 → needsRestart/restartSafe 映射；rejected 复读 profile 实况）。 */
async function throwCompensated(args: {
  pkg: string
  guard: Awaited<ReturnType<typeof verifyInstalledAdditions>>
  deps?: TransactionDeps
  evidence: CompensateEvidence
  prior: ReturnType<typeof derivePrior>
}): Promise<never> {
  const { pkg, guard, deps, evidence, prior } = args
  const violations = guard.violations
  const violationText = violations.map((v) => `${v.code}: ${v.detail}`).join('；')
  let comp: TransactionResult
  const priorForTx: PriorUnion =
    prior.kind === 'mappingOnly'
      ? { kind: 'mappingOnly', patchMapping: prior.patchMapping }
      : prior.kind === 'dependency'
        ? { kind: 'dependency', state: prior.state }
        : { kind: 'none' }
  try {
    comp = await runProfileTransaction(
      { kind: 'compensate-install', pkg, evidence, prior: priorForTx },
      deps,
    )
  } catch (err) {
    throw new InstallGuardError({
      kind: 'manual_required',
      message: `安装违例（${violationText}），补偿事务执行异常：${err instanceof Error ? err.message : String(err)}——需人工处理`,
      violations,
      needsRestart: true,
      restartSafe: false,
      compensation: { status: 'manual-repair', note: errText(err) },
    })
  }
  if (comp.ok) {
    // committed(fresh/restore) + 补偿验证完整 → 可一键重启
    throw new InstallGuardError({
      kind: 'compensated',
      message: `安装违例（${violationText}），已${prior.kind === 'dependency' ? '恢复原版本' : '自动卸载'}（补偿事务 committed）`,
      violations,
      needsRestart: true,
      restartSafe: true,
      compensation: { status: 'committed', note: comp.output },
      ...(prior.kind === 'dependency' ? { repairBasis: `prior: ${prior.state.manifestSpec}（${prior.state.resolvedVersion ?? 'version 未知'}）` } : {}),
    })
  }
  const status = comp.status
  const note = comp.failure?.note ?? ''
  if (status === 'rejected') {
    // 复读 profile 实况决定 restartSafe（不因零写入直接 false）
    let pkgStillThere = false
    try {
      const now = await capturePreMutationState(deps?.profileDir ?? webProfileDir())
      pkgStillThere = now.kind === 'snapshot' && pkg in now.snapshot.deps
    } catch {
      pkgStillThere = true
    }
    throw new InstallGuardError({
      kind: 'compensated',
      message: `安装违例（${violationText}），补偿未执行（profile 状态已变化：${note}）`,
      violations,
      needsRestart: pkgStillThere,
      restartSafe: !pkgStillThere,
      compensation: { status: 'rejected', note },
    })
  }
  if (status === 'rolled-back') {
    throw new InstallGuardError({
      kind: 'compensated',
      message: `安装违例（${violationText}），补偿未完成：已回到补偿前状态，坏包可能仍在，需人工处理（${note}）`,
      violations,
      needsRestart: true,
      restartSafe: false,
      compensation: { status: 'rolled-back', note },
    })
  }
  // manual-repair：状态未知；post-add 兜底场景附修复依据，任何端不显示「已恢复原版本/已安装成功」
  throw new InstallGuardError({
    kind: 'manual_required',
    message: `安装违例（${violationText}），补偿进入 manual-repair：需人工处理（${note}）`,
    violations,
    needsRestart: true,
    restartSafe: false,
    compensation: { status: 'manual-repair', note },
    ...(prior.kind === 'dependency'
      ? { repairBasis: `旧 manifestSpec=${prior.state.manifestSpec}；installSpec=${prior.state.installSpec}；mapping=${JSON.stringify(prior.state.patchMapping)}` }
      : prior.kind === 'mappingOnly'
        ? { repairBasis: `旧 mapping=${JSON.stringify(prior.patchMapping)}` }
        : {}),
  })
}

function guardManualRequired(message: string, violations: GuardViolation[]): InstallGuardError {
  // 零副作用：未进 mutation → needsRestart=false、restartSafe=false
  return new InstallGuardError({
    kind: 'manual_required',
    message,
    violations,
    needsRestart: false,
    restartSafe: false,
    compensation: { status: 'pre-mutation', note: '未开始变更，profile 零写入' },
  })
}

export async function installEntry(
  entry: InstallableEntry,
  cfg: RegistryConfig = {},
  opts: { version?: string; forceIncompatible?: boolean } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallResult> {
  return withMutationSession(() => installEntryLocked(entry, cfg, opts, deps))
}

/** installEntry 主体（session 区间内）。入口约定：installFromRegistry 走 installEntry（获取 session）；
 *  upgradePlugin 已持有 session，必须直调本函数——二次获取 session 会自死锁（session 非重入）。 */
async function installEntryLocked(
  entry: InstallableEntry,
  cfg: RegistryConfig = {},
  opts: { version?: string; forceIncompatible?: boolean } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallResult> {
  const timeoutMs = cfg.timeoutMs ?? 20_000
  const profileDir = deps?.transaction?.profileDir ?? deps?.profileDir ?? webProfileDir()
  const d = {
    npmLatest: deps?.npmLatest ?? defaultNpmLatest,
    npmVersion: deps?.npmVersion ?? npmVersion,
  }
  if (entry.source === 'npm' && entry.npm) {
    const pkg = entry.npm
    // 变更前全量快照（unavailable → fail-closed，零写入）
    const pre = await capturePreMutationState(profileDir)
    if (pre.kind === 'unavailable') {
      throw new Error(`变更前状态捕获失败：${pre.reason}；拒绝安装（fail-closed）`)
    }
    // npm key 事务前已知：prior 派生与 restorable 检查在事务前完成
    // （issue #6 修法 B：投影形态包不受 lock integrity 判据约束，见 derivePrior 注）
    const prior = derivePrior(pre.snapshot, pkg, { generationProjected: isGenerationProjectionPkg(profileDir, pkg) })
    if (prior.kind === 'unavailable') {
      throw new Error(`prior 关联歧义：${prior.reason}；拒绝安装（fail-closed）`)
    }
    if (prior.kind === 'dependency' && !prior.state.restorable) {
      throw guardManualRequired(
        `「${pkg}」的原安装形态（${prior.state.sourceKind === 'other' ? 'link/file 等非 registry 来源' : 'pnpm-lock.yaml 未解析出该依赖的 integrity（键缺失或为别名/URL 等非 registry 写法）'}）无法自动回退，请先手动处理（卸载或修复后重试）；也可在官方宿主插件管理界面（Settings → Plugins）操作该插件`,
        [{ pkg, code: 'NO_DSH_MARKER', detail: `prior restorable:false（sourceKind=${prior.state.sourceKind}）` }],
      )
    }
    // npm：无论 latest 还是用户指定 exact，都先读取该精确版本的 dist metadata（事务外解析）
    let version: string
    let expectedIntegrity: string | undefined
    if (opts.version) {
      const meta = await d.npmVersion(pkg, opts.version, timeoutMs, opts.signal)
      version = meta.version
      expectedIntegrity = meta.integrity
    } else {
      const latest = await d.npmLatest(pkg, timeoutMs, opts.signal)
      version = latest.version
      expectedIntegrity = latest.integrity
    }
    if (!expectedIntegrity) throw new Error(`npm metadata 缺少 dist integrity：${pkg}@${version}，拒绝安装`)
    // peer 兼容预检（Task 11，事务外 metadata 阶段；force = 用户已确认风险）。
    // 预检自身的元数据读取失败（网络错/404）不拦安装——视为未检，安装事务自有失败语义。
    let compat: CompatIssue | null = null
    try {
      compat = await (deps?.precheck ?? precheckNpmCompat)(pkg, version, {
        timeoutMs,
        signal: opts.signal,
      })
    } catch {
      compat = null
    }
    if (compat !== null && opts.forceIncompatible !== true) throw new IncompatibleError(compat)
    // 生产预热绑定：未注入时 B3 用 makeNpmWarmPackument（保留 timeout/signal、失败吞错）
    const result = await runProfileTransaction(
      { kind: 'install-npm', pkg, version, integrity: expectedIntegrity, signal: opts.signal },
      {
        ...deps?.transaction,
        warmPackument: deps?.transaction?.warmPackument ?? makeNpmWarmPackument(timeoutMs),
      },
    )
    if (!result.ok) throw new TransactionError(result)
    // 装后守卫（session 区间内；fail-open 仅限结论不可定）
    const guard = await verifyInstalledAdditions({
      profileDir,
      addedPkgs: [result.pkg ?? pkg],
      ...(prior.kind === 'dependency' ? { priorPkgs: [pkg] } : {}),
    })
    if (guard.unavailable.length > 0) {
      // 0.9.20 ①：事务已 committed（守卫不可定 fail-open 亦是成功态）→ 定向作废该条目 latest 缓存
      invalidateLatestForEntry(opts.namespace, entry)
      return {
        id: entry.id,
        pkg: result.pkg ?? pkg,
        spec: result.spec ?? `${pkg}@${version}`,
        version: result.version ?? version,
        buildApprovals: result.buildApprovals ?? [],
        fallbackAllBuilds: result.fallbackAllBuilds === true,
        ...(result.bundleWarning ? { bundleWarning: result.bundleWarning } : {}),
        compat: compat ?? null,
        needsRestart: true,
        output: result.output,
        healActions: result.healActions,
        guardWarning: `装后守卫不可用（${guard.unavailable.map((u) => u.reason).slice(0, 2).join('；')}），未执行三项检查——如异常请人工核查`,
      }
    }
    if (!guard.ok) {
      await throwCompensated({
        pkg: result.pkg ?? pkg,
        guard,
        deps: deps?.transaction,
        evidence: {
          source: 'npm',
          // manifestSpec = 安装后 manifest deps 值（pnpm add 写入裸 version）；validate 对当前 manifest 实读比对
          manifestSpec: result.version ?? version,
          resolvedVersion: result.version ?? version,
          integrity: expectedIntegrity ?? '',
        },
        prior,
      })
    }
    const notes = result.healActions.map((h) => h.note).filter((n) => n !== '')
    // 0.9.20 ①：安装成功 → 定向作废该条目 latest 缓存（只失效不回写，ADR-0006）
    invalidateLatestForEntry(opts.namespace, entry)
    return {
      id: entry.id,
      pkg: result.pkg ?? pkg,
      spec: result.spec ?? `${pkg}@${version}`,
      version: result.version ?? version,
      buildApprovals: result.buildApprovals ?? [],
      fallbackAllBuilds: result.fallbackAllBuilds === true,
      ...(result.bundleWarning ? { bundleWarning: result.bundleWarning } : {}),
      compat: compat ?? null,
      needsRestart: true,
      output: result.output + (notes.length > 0 ? `\n[dsh-m 自愈] ${notes.join('；')}` : ''),
      healActions: result.healActions,
    }
  }
  if (entry.github) {
    // 变更前全量快照（fail-closed）
    const pre = await capturePreMutationState(profileDir)
    if (pre.kind === 'unavailable') {
      throw new Error(`变更前状态捕获失败：${pre.reason}；拒绝安装（fail-closed）`)
    }
    // candidate preflight（M2 Task 0 gate 已证明 name→key 映射）：只读抓取 pinned package.json；
    // 抓取失败/解析歧义 → fail-closed 拒绝安装（零写入）；candidate 命中 link/file 或 restorable:false
    // prior → mutation 前 GUARD_MANUAL_REQUIRED（runner.add 零调用）
    const { tag, sha } = await (deps?.githubLatestTag ?? defaultGithubLatestTag)(entry.github, timeoutMs, opts.signal)
    let candidate: string | null
    try {
      candidate = await (deps?.candidateKey ?? candidateKeyOf)(entry.github, sha, timeoutMs)
    } catch (err) {
      throw new Error(`GitHub candidate key 预解析失败（${entry.github}@${sha.slice(0, 7)}）：${err instanceof Error ? err.message : String(err)}；拒绝安装（fail-closed）`)
    }
    if (candidate === null || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(candidate)) {
      throw new Error(`GitHub candidate key 不可用（${candidate ?? 'name 缺失'}）：拒绝安装（fail-closed）`)
    }
    const candidatePrior = derivePrior(pre.snapshot, candidate, { generationProjected: isGenerationProjectionPkg(profileDir, candidate) })
    if (candidatePrior.kind === 'unavailable') {
      throw new Error(`prior 关联歧义：${candidatePrior.reason}；拒绝安装（fail-closed）`)
    }
    if (candidatePrior.kind === 'dependency' && !candidatePrior.state.restorable) {
      throw guardManualRequired(
        `「${candidate}」的原安装形态（pnpm-lock.yaml 未解析出该依赖的可回退依据——integrity/commit 缺失，或 link/file/别名等非 registry 写法）无法自动回退，请先手动处理（卸载或修复后重试）`,
        [{ pkg: candidate, code: 'NO_DSH_MARKER', detail: 'candidate 命中 restorable:false prior（lockfile 依据缺失）' }],
      )
    }
    const result = await runProfileTransaction(
      { kind: 'install-github', repo: entry.github, sha, tag, signal: opts.signal },
      deps?.transaction ?? {},
    )
    if (!result.ok) throw new TransactionError(result)
    const realKey = result.pkg ?? candidate
    // post-add derivePrior 复核（兜底网）：真实 key 与 candidate 不符且发现不可自动恢复 prior
    // → manual-repair 非成功状态（不冒充 pre-mutation 拒绝、不承诺 prior 无损）
    let prior = candidatePrior
    if (realKey !== candidate) {
      const real = derivePrior(pre.snapshot, realKey, { generationProjected: isGenerationProjectionPkg(profileDir, realKey) })
      if (real.kind === 'unavailable') {
        throw new Error(`prior 关联歧义（真实 key ${realKey}）：${real.reason}；拒绝继续（fail-closed）`)
      }
      if (real.kind === 'dependency' && !real.state.restorable) {
        throw new InstallGuardError({
          kind: 'manual_required',
          message: `安装违例后复核：真实 dependency key（${realKey}）与预解析 candidate（${candidate}）不符，且旧 prior 为 link/file 等不可自动恢复来源——旧 prior 可能已被覆盖，需人工恢复`,
          violations: [{ pkg: realKey, code: 'NO_DSH_MARKER', detail: 'candidate 与真实 key 不符且 prior restorable:false' }],
          needsRestart: true,
          restartSafe: false,
          compensation: { status: 'manual-repair', note: '真实 key ≠ candidate 且旧 prior 不可自动恢复' },
          repairBasis: `旧 manifestSpec=${real.state.manifestSpec}；installSpec=${real.state.installSpec}；mapping=${JSON.stringify(real.state.patchMapping)}`,
        })
      }
      if (real.kind !== 'none') prior = real
    }
    // 装后守卫
    const guard = await verifyInstalledAdditions({
      profileDir,
      addedPkgs: [realKey],
      ...(prior.kind === 'dependency' ? { priorPkgs: [realKey] } : {}),
    })
    if (guard.unavailable.length > 0) {
      // 0.9.20 ①：事务已 committed（守卫不可定 fail-open 亦是成功态）→ 定向作废该条目 latest 缓存
      invalidateLatestForEntry(opts.namespace, entry)
      const notes = result.healActions.map((h) => h.note).filter((n) => n !== '')
      return {
        id: entry.id,
        pkg: realKey,
        spec: result.spec ?? `github:${entry.github}#${sha}`,
        sha: result.sha ?? sha,
        tag: result.tag ?? tag,
        buildApprovals: result.buildApprovals ?? [],
        fallbackAllBuilds: result.fallbackAllBuilds === true,
        ...(result.bundleWarning ? { bundleWarning: result.bundleWarning } : {}),
        compatSkipped: 'github-source',
        needsRestart: true,
        output: result.output + (notes.length > 0 ? `\n[dsh-m 自愈] ${notes.join('；')}` : ''),
        healActions: result.healActions,
        guardWarning: `装后守卫不可用（${guard.unavailable.map((u) => u.reason).slice(0, 2).join('；')}），未执行三项检查——如异常请人工核查`,
      }
    }
    if (!guard.ok) {
      // lock commit identity 从实际 pnpm-lock.yaml 解析（InstallResult.sha 是请求时期望值，非独立观测）
      const lockText = await readFile(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
      const lockCommit = lockResolutionOf(lockText, realKey)?.commit ?? sha
      await throwCompensated({
        pkg: realKey,
        guard,
        deps: deps?.transaction,
        evidence: { source: 'github', pinnedSpec: `github:${entry.github}#${sha}`, sha, lockCommitIdentity: lockCommit },
        prior,
      })
    }
    const notes = result.healActions.map((h) => h.note).filter((n) => n !== '')
    // 0.9.20 ①：安装成功 → 定向作废该条目 latest 缓存（只失效不回写，ADR-0006）
    invalidateLatestForEntry(opts.namespace, entry)
    return {
      id: entry.id,
      pkg: realKey,
      spec: result.spec ?? `github:${entry.github}#${sha}`,
      sha: result.sha ?? sha,
      tag: result.tag ?? tag,
      buildApprovals: result.buildApprovals ?? [],
      fallbackAllBuilds: result.fallbackAllBuilds === true,
      ...(result.bundleWarning ? { bundleWarning: result.bundleWarning } : {}),
      compatSkipped: 'github-source',
      needsRestart: true,
      output: result.output + (notes.length > 0 ? `\n[dsh-m 自愈] ${notes.join('；')}` : ''),
      healActions: result.healActions,
    }
  }
  throw new Error(`条目 ${entry.id} 缺少可安装来源`)
}

export interface UninstallResult {
  pkg: string
  liveDisabled: boolean
  needsRestart: true
  leftovers: string[]
  /** 事务自愈动作（机器可断言 code + 给人看的 note） */
  healActions?: HealAction[]
}

export interface UninstallDeps {
  /** Task 6 起：卸载走事务（validate 前置 + 快照 + 回滚）；注入仅为可测试性 */
  transaction?: TransactionDeps
  /** 外部操作直落钩子注入（0.9.79 ADR-0018，R3-1；缺省 = 真实现） */
  appendExternalOperation?: AppendExternalOperation
}

/** 卸载：validate（严格读取）→ live-disable → 摘补丁 → pnpm remove → verify gone（DESIGN.md §3：删包不删数据）。 */
export function uninstallPlugin(
  pkg: string,
  cfg: RegistryConfig = {},
  opts: { channel?: OperationChannel } & RegistryRuntimeOptions = {},
  deps: UninstallDeps = {},
): Promise<UninstallResult> {
  // 0.9.79 外部操作直落（ADR-0018）：终态后挂钩，session 区间内保持单写者
  return withMutationSession(async () => {
    try {
      const result = await uninstallPluginLocked(pkg, cfg, opts, deps)
      await journalExternalOperation(opts.channel, { kind: 'uninstall', target: pkg }, 'ok', {
        appendExternalOperation: deps.appendExternalOperation,
      })
      return result
    } catch (err) {
      await journalExternalOperation(opts.channel, { kind: 'uninstall', target: pkg }, 'failed', {
        reason: errText(err),
        appendExternalOperation: deps.appendExternalOperation,
      })
      throw err
    }
  })
}

async function uninstallPluginLocked(
  pkg: string,
  _cfg: RegistryConfig = {},
  opts: RegistryRuntimeOptions = {},
  deps: UninstallDeps = {},
): Promise<UninstallResult> {
  // 保护门（Task 12，grilling Q3）：dsh-m 自身与官方宿主命脉拒绝卸载（升级不受影响）
  if (pkg === 'dsh-m' || PROTECTED_MODULES.includes(pkg)) {
    throw new Error(
      `拒绝卸载受保护插件: ${pkg}（dsh-m 自身或官方宿主命脉）。如确需移除，请使用官方插件管理页或 dsh plugin CLI`,
    )
  }
  const result = await runProfileTransaction(
    { kind: 'uninstall', pkg, signal: opts.signal },
    deps.transaction ?? {},
  )
  if (!result.ok) throw new TransactionError(result)
  // 0.9.20 ①：卸载成功 → 尽力作废 npm-only 键（github 条目的 gh: 键无法由 pkg 名重构，
  // 交由 TTL 自然过期——卸载后已装列表无此条目，不存在「已装/最新」自相矛盾场景）
  invalidateLatestCache(opts.namespace ?? 'host', `npm:${pkg}`)
  const orphaned = result.orphanedPatchFiles ?? []
  const leftovers = [...new Set([...leftoverCandidates(pkg), ...orphaned])]
  return {
    pkg,
    liveDisabled: result.liveDisabled === true,
    needsRestart: true,
    leftovers,
    healActions: result.healActions,
  }
}

export interface UpgradeResult extends InstallResult {
  fromVersion?: string
  /** 生效判定（0.9.22）：仅 npm 源升级产出；'client-only' 时 needsRestart 必为 false，'unknown' 保守为 true */
  activation?: ActivationClassification
}

/** 升级 = 按最新重新安装（npm 拉最新精确版；github 重新锁 HEAD）。 */
export function upgradePlugin(
  pkg: string,
  cfg: RegistryConfig = {},
  opts: { forceIncompatible?: boolean; profileDir?: string; channel?: OperationChannel } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<UpgradeResult> {
  // 0.9.79 外部操作直落（ADR-0018）：终态后挂钩，session 区间内保持单写者
  return withMutationSession(async () => {
    try {
      const result = await upgradePluginLocked(pkg, cfg, opts, deps)
      await journalExternalOperation(
        opts.channel,
        {
          kind: 'upgrade',
          target: pkg,
          ...(result.fromVersion ? { fromVersion: result.fromVersion } : {}),
          ...(result.version ? { toVersion: result.version } : {}),
        },
        'ok',
        { appendExternalOperation: deps?.appendExternalOperation },
      )
      return result
    } catch (err) {
      await journalExternalOperation(opts.channel, { kind: 'upgrade', target: pkg }, 'failed', {
        reason: errText(err),
        appendExternalOperation: deps?.appendExternalOperation,
      })
      throw err
    }
  })
}

async function upgradePluginLocked(
  pkg: string,
  cfg: RegistryConfig = {},
  opts: { forceIncompatible?: boolean; profileDir?: string } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<UpgradeResult> {
  const loaded = await (deps?.loadRegistry ?? defaultLoadRegistry)(cfg, { namespace: opts.namespace ?? 'host', profile: opts.profile })
  const registryUsable = loaded.status !== 'unavailable'
  const { items: installed } = await (deps?.listInstalledPlugins ?? defaultListInstalledPlugins)(opts.profileDir)
  const target = installed.find((it) => it.pkg === pkg)
  if (!target) throw new Error(`web profile 未安装该插件: ${pkg}`)
  // ADR-0026（issue #30）：条目查找降级为元数据增强——registry unavailable 不再硬阻断升级；
  // 主清单+社区均 miss 时经合成条目（synthesizeInstallableEntry）走与市场安装同一条管线，
  // 本地/非线上来源由其 fail-closed 抛 UpgradePathUnsupportedError。
  let entry: InstallableEntry | undefined
  if (registryUsable) {
    // 0.5.1：合并市场安装的社区条目同样可升级——主清单优先，miss 时查社区目录。
    // 0.9.68（ADR-0016 / R2-3）：社区兜底经物化合并市场全量域 lookupInstalledAll（含 displaced 让位条目，
    // min-ord 胜者 = 今日「先主清单 find 后社区 adapt 全量 find」合成语义）；reject 透传由窄 catch 吞为 miss。
    entry = loaded.registry.plugins.find((e) => matchInstalledByEntry(e, [target]))
    try {
      if (!entry) {
        const communityTask = (deps?.fetchCommunityCatalog ?? defaultFetchCommunityCatalog)(cfg, { namespace: opts.namespace ?? 'host', signal: opts.signal, profile: opts.profile })
        const outcome = await mergedOutcome({
          namespace: opts.namespace ?? 'host',
          profile: opts.profile ?? WEB_PROFILE,
          cfg,
          registry: loaded,
          communityTask,
          deadlineAt: Date.now() + DEFAULT_DEADLINE_MS,
        })
        entry = outcome.lookupInstalledAll(target) as InstallableEntry | undefined
      }
    } catch {
      entry = undefined
    }
  }
  if (!entry) entry = synthesizeInstallableEntry(target)
  // 0.5.1 修复：直调 installEntryLocked——upgradePlugin 已在 mutation session 区间内，
  // 再经 installEntry 二次获取 session 会自死锁（session 非重入，见 withMutationSession 契约）。
  const result = await installEntryLocked(entry, cfg, opts, deps)
  // 0.9.22 生效判定：npm 源升级在成功点分类；任何异常 fail-open 到 unknown，绝不影响升级成功态
  let activation: ActivationClassification | undefined
  let needsRestart = result.needsRestart
  if (entry.source === 'npm' && entry.npm && target.version && result.version) {
    try {
      activation = await (deps?.classifyActivation ?? classifyUpgradeActivation)(entry.npm, target.version, result.version)
      if (activation === 'client-only') needsRestart = false
    } catch {
      activation = 'unknown'
    }
  }
  return { ...result, fromVersion: target.version, needsRestart, ...(activation ? { activation } : {}) }
}

/**
 * 社区条目按收录 id 查找（0.7.1 安装修复）：合并市场展示的社区条目 id = 社区目录合成 id
 * （owner--name 等），主清单 miss 时按同一 id 查社区目录。社区清单未启用/不可用/加载
 * 异常/未命中 → undefined，由调用方统一报「registry 中没有该条目」。
 */
/** 自升级（0.5.0 收编：host-api 直调事务的旁路封死）：npmLatest + integrity fail-closed；函数体直调事务（call-graph audit：不经 installEntry，无嵌套双记）。 */
export async function selfUpgrade(
  pkgName: string,
  currentVersion: string,
  cfg: RegistryConfig = {},
  opts: { channel?: OperationChannel } & RegistryRuntimeOptions = {},
  deps?: InstallDeps,
): Promise<InstallResult> {
  return withMutationSession(async () => {
    try {
      const timeoutMs = cfg.timeoutMs ?? 20_000
      const latest = await (deps?.npmLatest ?? defaultNpmLatest)(pkgName, timeoutMs, opts.signal)
      if (!latest.integrity) {
        throw new Error(`npm metadata 缺少 dist integrity：${pkgName}@${latest.version}，拒绝升级`)
      }
      const result = await runProfileTransaction(
        { kind: 'install-npm', pkg: pkgName, version: latest.version, integrity: latest.integrity, signal: opts.signal },
        { ...(deps?.transaction ?? {}), warmPackument: deps?.transaction?.warmPackument ?? makeNpmWarmPackument(timeoutMs) },
      )
      if (!result.ok) throw new TransactionError(result)
      const payload: InstallResult = {
        id: pkgName,
        pkg: result.pkg ?? pkgName,
        spec: result.spec ?? `${pkgName}@${latest.version}`,
        version: result.version ?? latest.version,
        buildApprovals: result.buildApprovals ?? [],
        fallbackAllBuilds: result.fallbackAllBuilds === true,
        ...(result.bundleWarning ? { bundleWarning: result.bundleWarning } : {}),
        needsRestart: true as const,
        output: result.output,
        healActions: result.healActions,
      }
      await journalExternalOperation(
        opts.channel,
        {
          kind: 'self-upgrade',
          target: pkgName,
          ...(currentVersion ? { fromVersion: currentVersion } : {}),
          ...(payload.version ? { toVersion: payload.version } : {}),
        },
        'ok',
        { appendExternalOperation: deps?.appendExternalOperation },
      )
      return payload
    } catch (err) {
      await journalExternalOperation(
        opts.channel,
        { kind: 'self-upgrade', target: pkgName, ...(currentVersion ? { fromVersion: currentVersion } : {}) },
        'failed',
        { reason: errText(err), appendExternalOperation: deps?.appendExternalOperation },
      )
      throw err
    }
  })
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
