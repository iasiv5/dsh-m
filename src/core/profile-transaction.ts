/**
 * Profile 变更事务（Profile Transaction）——深模块。
 * 设计语义见 docs/DESIGN.md §3.1；执行计划（含四轮评审处置）见
 * docs/plans/2026-09-07-profile-transaction-implementation-plan.md。
 *
 * 模块契约（「类型之外的契约」）：
 * 1. 前置：request 必须已解析到底（版本/SHA/integrity 均已定）；模块内除 `warmPackument` 外零网络。
 * 2. throw 政策与未预期异常（phase-aware）：预期的领域失败一律返回 TransactionResult；仅畸形
 *    request 抛 TypeError（isSafePkgName/isSafePluginTarget 不通过、github repo 非 owner/repo 形状、
 *    SHA 非 40 位十六进制、integrity 空白）——校验先于 runner factory 调用与任何读写，零写入。
 *    未预期异常由顶层 catch 按阶段分流：快照完成前且无写入 → rejected + INTERNAL_ERROR；
 *    快照后或 mutation 已开始 → failure code 保留 INTERNAL_ERROR，照常执行不可取消的统一
 *    回滚/收敛/live 补偿——回滚成功 → rolled-back；失败 → manual-repair。
 * 3. 四态语义与证据来源：`snapshotRestoreVerified` = 还原后重读比对的历史事实（committed 恒
 *    false，未发生还原）；`profileConverged` = committed 门专属 verify 成功 / rolled-back 收敛
 *    阶梯通过；rejected、manual-repair 恒 false。不声称 node_modules 字节级回滚。
 * 4. signal 语义：`req.signal` 贯通 PnpmRunner 四操作、warmPackument 与 B3 退避 sleep
 *    （abort 即醒）；排队期或 mutate 前 abort → rejected + ABORTED；mutate 已开始后 abort →
 *    中止在途调用并执行不可取消的回滚（failure code 保留 ABORTED，终态 rolled-back 或
 *    manual-repair）；回滚/收敛阶段不传外部 signal（不变量优先于取消）。
 * 5. 串行：模块级 FIFO promise 链，进程内互斥；不得在 runner 回调里再调
 *    runProfileTransaction；跨进程并发不在覆盖范围。
 * 6. uninstall 定序固定：validate（严格读取）→ 快照 → live-disable → 摘补丁 → remove →
 *    verify gone；失败回滚时 live 尽力反向。
 * 7. 事务内 verify 相 profile 读取用严格读取器（模块私有）：manifest 读异常 →
 *    PROFILE_MANIFEST_UNREADABLE、JSON 非法 → PROFILE_MANIFEST_INVALID、插件元数据不可读 →
 *    PLUGIN_METADATA_UNREADABLE；宽容读取只属列表页。B1/B2 自愈阶梯内部的 best-effort
 *    读取保持宽容（阶梯失败本身会进失败路径）。
 * 8. github 校验：存在键 k 使 depsNow[k] === spec 且 snapshotDeps[k] !== spec（相对前态
 *    变化，防旧依赖误命中）；无 → GITHUB_SPEC_MISMATCH。
 * 9. 拒绝的假想 seam：FsPort、时钟 port、锁 port、每 doorway 一模块、版本解析 port。
 *    npm-integrity.ts 的可注入 fs 操作是内部 seam（仅供其自测）。
 */
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { webProfileDir } from './env.js'
import { isSafePkgName, resolvePluginDir } from './installed.js'
import { setLivePluginDisabled } from './live-plugin.js'
import { npmPackument } from './versions.js'
import { syncNpmmirrorPackage } from './npm-route.js'
import { clearAllLatestCache } from './latest-cache.js'
import {
  assertNpmIntegrity,
  atomicWriteFile,
  readPnpmLockIntegrity,
  readPnpmLockOverrides,
  restoreSnapshots,
  snapshotFiles,
  verifySnapshots,
  type ProfileFileSnapshot,
} from './npm-integrity.js'
import {
  isSafePluginTarget,
  makeDshRunner,
  removePatchedDependencyEntries,
  PNPM_OUTCOME_CODES,
  type PnpmRunner,
  type RunnerOutcome,
} from './dsh-cli.js'

// ---------- 类型与常量（接口定稿） ----------

export type TransactionRequest =
  | { kind: 'install-npm'; pkg: string; version: string; integrity: string; signal?: AbortSignal }
  | { kind: 'install-github'; repo: string; sha: string; tag?: string; signal?: AbortSignal }
  | { kind: 'uninstall'; pkg: string; signal?: AbortSignal }
  | { kind: 'compensate-install'; pkg: string; evidence: CompensateEvidence; prior: PriorUnion; signal?: AbortSignal }

// ---------- 补偿事务类型（M2 Task 3 / DESIGN §3「专用 compensate-install」） ----------

/** dependency 形态 prior 的完整恢复依据。npm integrity 缺失 → restorable:false（捕获阶段即拒）。 */
export interface PriorState {
  manifestSpec: string
  installSpec: string
  resolvedVersion?: string
  sourceKind: 'npm' | 'github' | 'other'
  integrity?: string
  lockResolution?: { version?: string; integrity?: string; commit?: string }
  patchMapping: { workspace: Array<{ key: string; patchPath: string }>; manifest: Array<{ key: string; patchPath: string }> }
  restorable: boolean
}

/** prior 判别联合（v6）：none/mappingOnly/dependency 三形态 + unavailable（fail-closed）。 */
export type PriorUnion =
  | { kind: 'none' }
  | { kind: 'mappingOnly'; patchMapping: { workspace: Array<{ key: string; patchPath: string }>; manifest: Array<{ key: string; patchPath: string }> } }
  | { kind: 'dependency'; state: PriorState }
  | { kind: 'unavailable'; reason: string }

/** 分源 evidence：validate 对当前 manifest/lock 实读比对（插队复验），不匹配 → COMPENSATE_EVIDENCE_MISMATCH。 */
export type CompensateEvidence =
  | { source: 'npm'; manifestSpec: string; resolvedVersion: string; integrity: string }
  | { source: 'github'; pinnedSpec: string; sha: string; lockCommitIdentity: string }
// 自升级 = install-npm + pkg=自身（语义等同，不设独立 kind）

export interface HealAction { code: (typeof TX_HEAL_CODES)[number]; note: string }

export const TX_HEAL_CODES = [
  'RANGE_ANCHOR_ACCEPTED', 'B1_MANIFEST_KEYS_RESTORED', 'B1_FROZEN_REVERIFY_FAILED',
  'B2_OVERRIDES_ALIGNED', 'B2_FROZEN_REVERIFY_OK', 'B2_LOCKFILE_REBUILT',
  'B3_LAG_RETRY', 'B3_NPMMIRROR_SYNC', 'B3_PACKUMENT_WARMED', 'BUILDS_ALLOWED',
  'ROLLBACK_BYTES_RESTORED', 'ROLLBACK_CONVERGED_FROZEN', 'ROLLBACK_FALLBACK_REMOVED',
  'ROLLBACK_VERIFY_FAILED', 'LIVE_DISABLED', 'LIVE_REENABLED', 'LIVE_REENABLE_FAILED',
  'PATCH_ENTRIES_STRIPPED', 'PATCH_MAPPING_RESTORED',
] as const

export const TX_FAILURE_CODES = [
  'DEP_MISSING_AFTER_ADD', 'DEP_VERSION_MISMATCH', 'LOCKFILE_MISSING', 'LOCK_INTEGRITY_MISMATCH',
  'GITHUB_SPEC_MISMATCH', 'ADD_RETRY_EXHAUSTED', 'ADD_FAILED', 'POST_MUTATION_CONVERGENCE_FAILED',
  'NOT_INSTALLED', 'NOT_DSH_PLUGIN', 'REMOVE_FAILED', 'STILL_PRESENT_AFTER_REMOVE',
  'COMPENSATE_EVIDENCE_MISMATCH', 'COMPENSATE_RESTORE_FAILED',
  'ROLLBACK_FAILED', 'SNAPSHOT_FAILED', 'ABORTED', 'INTERNAL_ERROR',
  'PROFILE_MANIFEST_UNREADABLE', 'PROFILE_MANIFEST_INVALID', 'PLUGIN_METADATA_UNREADABLE',
] as const

export interface TransactionFailure { code: (typeof TX_FAILURE_CODES)[number]; note: string }

export interface TransactionDeps {
  runner?: (profileDir: string) => PnpmRunner   // 缺省 = makeDshRunner
  warmPackument?: (pkg: string, signal?: AbortSignal) => Promise<void>
  /** L2②（ADR-0012）：NO_MATCHING_VERSION 来自 npmmirror 时的按需同步（缺省 = npm-route syncNpmmirrorPackage；注入仅为可测试性） */
  syncNpmmirror?: (pkg: string) => Promise<boolean>
  /** 同上：sync 受理后作废 latest 探测缓存（缺省 = latest-cache clearAllLatestCache） */
  clearLatestCache?: () => void
  setLiveDisabled?: (pkg: string, disabled: boolean) => Promise<boolean>
  /** 卸载门的补丁条目摘除（缺省 = dsh-cli removePatchedDependencyEntries）；注入仅为可测试性 */
  stripPatchedEntries?: (profileDir: string, pkg: string) => { changed: boolean; orphanedPatchFiles: string[] }
  retryDelaysMs?: readonly number[]             // 默认 [5_000, 15_000]；测试 [0, 0]
  profileDir?: string                           // 缺省 webProfileDir()；测试 tmpdir
}

// ---------- 四分支判别联合 ----------

interface TransactionBase {
  readonly kind: TransactionRequest['kind']
  readonly healActions: HealAction[]            // 按发生顺序；committed 也可非空
  readonly output: string                       // ≤800
}
interface CommittedResult extends TransactionBase {
  readonly status: 'committed'
  readonly ok: true
  readonly failure?: never
  readonly snapshotRestoreVerified: false       // 未发生还原
  readonly profileConverged: true               // 证据：安装/卸载专属 verify 成功
  readonly needsRestart: true
  // 载荷（按门）：
  readonly pkg?: string; readonly spec?: string; readonly version?: string
  readonly sha?: string; readonly tag?: string
  readonly buildApprovals?: string[]; readonly fallbackAllBuilds?: boolean
  /** verify 阶段观察：无补丁层且不在 bundles（装成纯依赖）——只警告不回滚（Task 10） */
  readonly bundleWarning?: 'no-patch-layer'
  readonly liveDisabled?: boolean; readonly orphanedPatchFiles?: string[]
}
interface RejectedResult extends TransactionBase {
  readonly status: 'rejected'
  readonly ok: false
  readonly failure: TransactionFailure          // SNAPSHOT_FAILED / NOT_* / ABORTED / …
  readonly snapshotRestoreVerified: false
  readonly profileConverged: false              // 未执行
  readonly needsRestart?: never
}
interface RolledBackResult extends TransactionBase {
  readonly status: 'rolled-back'
  readonly ok: false
  readonly failure: TransactionFailure
  readonly snapshotRestoreVerified: true        // 证据：还原后重读比对通过
  readonly profileConverged: true               // 证据：收敛阶梯最终通过
  readonly needsRestart?: never
}
interface ManualRepairResult extends TransactionBase {
  readonly status: 'manual-repair'
  readonly ok: false
  readonly failure: TransactionFailure
  readonly snapshotRestoreVerified: boolean     // 还原本身可能也失败（ROLLBACK_FAILED）
  readonly profileConverged: false
  readonly needsRestart?: never
}
export type TransactionResult =
  | CommittedResult | RejectedResult | RolledBackResult | ManualRepairResult
export type FailedTransactionResult = Exclude<TransactionResult, CommittedResult>

// ---------- 生产预热绑定 ----------

/**
 * 生产预热绑定：market.ts / host-api.ts 生产路径使用
 * `warmPackument: makeNpmWarmPackument(cfg.timeoutMs ?? 20_000)`。
 * fetcher 参数仅测试注入；失败吞错。deps 未提供且调用方未绑定时，
 * 事务内 B3 跳过预热仅重试——绝不调用 undefined。
 */
export function makeNpmWarmPackument(
  timeoutMs: number,
  fetcher: (pkg: string, timeoutMs: number, signal?: AbortSignal) => Promise<unknown> = npmPackument,
): (pkg: string, signal?: AbortSignal) => Promise<void> {
  return async (pkg: string, signal?: AbortSignal): Promise<void> => {
    try {
      await fetcher(pkg, timeoutMs, signal)
    } catch (err) {
      // R4c（终审复审）：取消不是预热失败——abort 异常必须向上传播，让 B3 立即终止
      if (signal?.aborted) throw err
      /* 预热尽力而为：CDN 滞后场景下 packument 请求失败不阻塞重试 */
    }
  }
}

// ---------- 展示层：renderFailure（中文散文唯一产地） ----------

function prefixOf(kind: TransactionRequest['kind'], code: TransactionFailure['code']): string {
  if (code === 'LOCK_INTEGRITY_MISMATCH') return 'integrity 校验失败'
  if (kind === 'uninstall') return '卸载失败'
  if (kind === 'install-github') return 'GitHub 安装失败'
  if (kind === 'compensate-install') return '补偿失败'
  return '安装失败'
}

/** 失败结果的中文散文（唯一产地；三条 legacy 文案逐字钉住在 tests/profile-transaction.test.mjs）。 */
export function renderFailure(r: FailedTransactionResult): string {
  const heals = r.healActions.map((h) => h.note).filter((n) => n !== '')
  const healSuffix = heals.length > 0 ? `（${heals.join('；')}）` : ''
  const prefix = prefixOf(r.kind, r.failure.code)
  switch (r.status) {
    case 'rejected':
      return `${prefix}前置校验未通过（${r.failure.code}）：${r.failure.note}`
    case 'rolled-back':
      return `${prefix}，已回滚到安装前状态${healSuffix}：${r.failure.note}`
    case 'manual-repair':
      return `${prefix}，${r.failure.note}，profile 可能需要人工修复`
  }
}

/** 领域失败以值携带（内部用）；TransactionError 才是对外 throw 形态。 */
export class TransactionError extends Error {
  constructor(readonly result: FailedTransactionResult) {
    super(renderFailure(result))
  }
}

// ---------- 内部工具 ----------

/** Y2（第四轮复审）：AggregateError 递归展开——多个底层错误都要进入事务 failure.note，不只最外层 message。 */
function errText(err: unknown): string {
  if (err instanceof AggregateError) {
    const details = err.errors.map(errText).filter((t) => t !== '')
    return details.length > 0 ? `${err.message}：${details.join('；')}` : err.message
  }
  return err instanceof Error ? err.message : String(err)
}

function abortErr(): Error {
  const err = new Error('已取消')
  err.name = 'AbortError'
  return err
}

function isAbortish(err: unknown, signal?: AbortSignal): boolean {
  return (err instanceof Error && err.name === 'AbortError') || signal?.aborted === true
}

/** abort-aware sleep：abort 即醒（抛 AbortError）。 */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortErr())
      return
    }
    const timer = setTimeout(() => resolve(), Math.max(0, ms))
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(abortErr())
    }, { once: true })
  })
}

/** 旧版 dsh CLI（save-prefix ^）锚定在目标精确版本上的 spec 放行；精确性由 lockfile integrity 保证。 */
function specAnchoredAtVersion(spec: string, version: string): boolean {
  const s = String(spec || '').trim()
  return s === version || s === `^${version}` || s === `~${version}`
}

class DomainFailure extends Error {
  constructor(readonly failure: TransactionFailure) {
    super(failure.note)
  }
}

class RestoreVerifyMismatch extends Error {}

/** 畸形 request：校验先于 runner factory 与任何读写，零写入。 */
function validateRequest(req: TransactionRequest): void {
  switch (req.kind) {
    case 'install-npm':
      if (!isSafePkgName(String(req.pkg ?? ''))) throw new TypeError(`畸形 request：非法包名 ${JSON.stringify(req.pkg)}`)
      if (typeof req.version !== 'string' || req.version.trim() === '') throw new TypeError('畸形 request：版本为空')
      if (typeof req.integrity !== 'string' || req.integrity.trim() === '') throw new TypeError('畸形 request：integrity 空白')
      return
    case 'install-github':
      if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(String(req.repo ?? ''))) throw new TypeError(`畸形 request：github repo 非 owner/repo 形状 ${JSON.stringify(req.repo)}`)
      if (!/^[0-9a-f]{40}$/.test(String(req.sha ?? ''))) throw new TypeError(`畸形 request：SHA 非 40 位十六进制 ${JSON.stringify(req.sha)}`)
      return
    case 'uninstall':
      if (!isSafePkgName(String(req.pkg ?? '')) || !isSafePluginTarget(String(req.pkg ?? ''))) throw new TypeError(`畸形 request：非法包名 ${JSON.stringify(req.pkg)}`)
      return
  }
}

// ---------- B1/B2 自愈阶梯（自 market.ts 搬移；消费 RunnerOutcome） ----------

async function readManifestDoc(profileDir: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * B1（成功路径）：安装链若把升级前 manifest 的顶层键丢掉（如 `pnpm.overrides`），
 * 从安装前字节快照里找回并原子写回。只补「快照有、现在无」的键；无需修复返回 null。
 */
async function restoreManifestKeys(
  profileDir: string,
  snapshot: ProfileFileSnapshot | undefined,
): Promise<string[] | null> {
  if (!snapshot?.existed || snapshot.bytes === null) return null
  let prev: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(snapshot.bytes.toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    prev = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const cur = await readManifestDoc(profileDir)
  if (!cur) return null
  const missing = Object.keys(prev).filter((k) => !(k in cur))
  if (missing.length === 0) return null
  for (const key of missing) cur[key] = prev[key]
  const bytes = Buffer.from(`${JSON.stringify(cur, null, 2)}\n`, 'utf8')
  await atomicWriteFile(join(profileDir, 'package.json'), bytes)
  return missing
}

/**
 * B2 第一层自愈：把 lockfile 记录的 overrides 并入 manifest 的 `pnpm.overrides`
 * （manifest 已有条目优先）。未做任何修改返回 null。
 */
async function restoreOverridesFromLock(profileDir: string): Promise<string | null> {
  let lockText: string
  try {
    lockText = await readFile(join(profileDir, 'pnpm-lock.yaml'), 'utf8')
  } catch {
    return null
  }
  const lockOverrides = readPnpmLockOverrides(lockText)
  const doc = await readManifestDoc(profileDir)
  if (!doc) return null
  const pnpm = doc.pnpm !== null && typeof doc.pnpm === 'object' && !Array.isArray(doc.pnpm)
    ? doc.pnpm as Record<string, unknown>
    : {}
  const current = pnpm.overrides !== null && typeof pnpm.overrides === 'object' && !Array.isArray(pnpm.overrides)
    ? pnpm.overrides as Record<string, unknown>
    : {}
  const merged: Record<string, unknown> = { ...lockOverrides, ...current }
  if (JSON.stringify(merged) === JSON.stringify(current)) return null
  doc.pnpm = { ...pnpm, overrides: merged }
  const bytes = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  await atomicWriteFile(join(profileDir, 'package.json'), bytes)
  const restored = Object.keys(lockOverrides).filter((k) => !(k in current))
  return restored.length > 0 ? `（还原自 lockfile：${restored.join(', ')}）` : '（与 lockfile overrides 对齐）'
}

/**
 * B2 frozen 收敛阶梯（消费矩阵 frozenInstall 行）：frozen → CONFIG_MISMATCH 时先
 * overrides 对齐再复验 → 仍 config-drift（含 OUTDATED_LOCKFILE specifier 漂移）降级
 * `--no-frozen-lockfile` 重建。永不 throw，一律 RunnerOutcome；自愈动作记入 healActions。
 */
async function frozenConvergeLadder(
  d: ResolvedDeps,
  heal: HealAction[],
): Promise<RunnerOutcome> {
  let out = await d.runner.frozenInstall()
  if (out.class === 'ok') return out
  if (out.class === 'config-drift' && out.code === PNPM_OUTCOME_CODES.CONFIG_MISMATCH) {
    const merged = await restoreOverridesFromLock(d.profileDir)
    if (merged !== null) {
      heal.push({ code: 'B2_OVERRIDES_ALIGNED', note: `已把 lockfile overrides 还原进 manifest ${merged}` })
      const retry = await d.runner.frozenInstall()
      if (retry.class === 'ok') {
        heal.push({ code: 'B2_FROZEN_REVERIFY_OK', note: 'frozen 校验通过' })
        return retry
      }
      out = retry
    }
  }
  if (out.class === 'config-drift') {
    const rebuilt = await d.runner.rebuildInstall()
    if (rebuilt.class === 'ok') {
      heal.push({ code: 'B2_LOCKFILE_REBUILT', note: 'lockfile 已重建（--no-frozen-lockfile 完成一致性安装）' })
      return rebuilt
    }
    return { ...rebuilt, output: `${out.output}；lockfile 重建（--no-frozen-lockfile）也失败：${rebuilt.output}`.slice(-800) }
  }
  return out
}

// ---------- 严格读取器（verify 相专用） ----------

async function strictReadDeps(d: ResolvedDeps): Promise<Record<string, string>> {
  let raw: string
  try {
    raw = await readFile(join(d.profileDir, 'package.json'), 'utf8')
  } catch (err) {
    throw new DomainFailure({ code: 'PROFILE_MANIFEST_UNREADABLE', note: `profile package.json 读取失败：${errText(err)}` })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new DomainFailure({ code: 'PROFILE_MANIFEST_INVALID', note: `profile package.json 不是合法 JSON：${errText(err)}` })
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DomainFailure({ code: 'PROFILE_MANIFEST_INVALID', note: 'profile package.json 顶层不是对象' })
  }
  const deps = (parsed as { dependencies?: unknown }).dependencies
  if (deps === null || deps === undefined || typeof deps !== 'object' || Array.isArray(deps)) return {}
  const out: Record<string, string> = {}
  for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
    if (typeof spec === 'string' && spec !== '') out[name] = spec
  }
  return out
}

// ---------- 结果 builder ----------

function truncate(text: string): string {
  const raw = String(text ?? '')
  return raw.length <= 800 ? raw : raw.slice(-800)
}

function committed(
  kind: TransactionRequest['kind'],
  heal: HealAction[],
  output: string,
  payload: Partial<CommittedResult>,
): CommittedResult {
  return {
    kind, status: 'committed', ok: true, healActions: heal, output: truncate(output),
    snapshotRestoreVerified: false, profileConverged: true, needsRestart: true,
    ...payload,
  } as CommittedResult
}
function rejected(failure: TransactionFailure, kind: TransactionRequest['kind'], output = ''): RejectedResult {
  return {
    kind, status: 'rejected', ok: false, failure, healActions: [], output: truncate(output),
    snapshotRestoreVerified: false, profileConverged: false,
  }
}
function rolledBack(kind: TransactionRequest['kind'], failure: TransactionFailure, heal: HealAction[], output: string): RolledBackResult {
  return {
    kind, status: 'rolled-back', ok: false, failure, healActions: heal, output: truncate(output),
    snapshotRestoreVerified: true, profileConverged: true,
  }
}
function manualRepair(
  kind: TransactionRequest['kind'],
  failure: TransactionFailure,
  heal: HealAction[],
  output: string,
  snapshotRestoreVerified: boolean,
): ManualRepairResult {
  return {
    kind, status: 'manual-repair', ok: false, failure, healActions: heal, output: truncate(output),
    snapshotRestoreVerified, profileConverged: false,
  }
}

// ---------- 回滚编排（两阶段不变量） ----------

function originallyAbsent(pkg: string, snapshots: ProfileFileSnapshot[]): boolean {
  const snap = snapshots[0]
  if (!snap?.existed || snap.bytes === null) return false
  try {
    return !JSON.parse(snap.bytes.toString('utf8'))?.dependencies?.[pkg]
  } catch {
    return false
  }
}

/** 还原后立即重读比对（第一阶段验证动作；原语在 npm-integrity.verifySnapshots，F2 只吞 ENOENT）。 */
async function assertRestoredBytes(snapshots: ProfileFileSnapshot[]): Promise<void> {
  try {
    await verifySnapshots(snapshots)
  } catch (err) {
    // 读取异常与字节不一致统一按复验失败处理（ROLLBACK_VERIFY_FAILED 在案）
    throw new RestoreVerifyMismatch(errText(err))
  }
}

/**
 * 统一回滚：字节还原（重读比对）→ frozen 收敛阶梯 → （仅当前面失败时）originallyAbsent
 * 补移除。回滚不可取消（不传外部 signal）。终态 rolled-back 或 manual-repair。
 *
 * 终审复审 R1/R2 契约：`rolled-back` 必须同时代表「字节还原已重读验证」与「终态一致性
 * 已证明」——补移除成功本身不构成其中任何一个证明：字节还原未验证时移除只是补偿动作
 * （manual-repair）；收敛失败后移除成功必须再经 verify-gone + frozen 复验才允许 rolled-back。
 * 本函数为 total function：收敛阶梯 / 补移除 / B2 写入的任何异常都转换为 manual-repair
 * 结果，绝不 reject。
 */
async function rollbackAndConverge(
  d: ResolvedDeps,
  kind: TransactionRequest['kind'],
  failure: TransactionFailure,
  heal: HealAction[],
  snapshots: ProfileFileSnapshot[],
  fallbackRemovePkg?: string,
): Promise<FailedTransactionResult> {
  const healSuffixNote = (detail: string): TransactionFailure => ({
    code: failure.code,
    note: `${failure.note}；依赖回滚也失败（${detail}）`,
  })
  // 阶段一：字节还原 + 重读比对验证
  let restoreVerified = false
  let restoreErr: unknown = null
  let restoreMismatch = false
  try {
    await restoreSnapshots(snapshots)
    await assertRestoredBytes(snapshots)
    restoreVerified = true
    heal.push({ code: 'ROLLBACK_BYTES_RESTORED', note: '三文件已按快照逐字节还原并重读复验' })
  } catch (err) {
    restoreErr = err
    restoreMismatch = err instanceof RestoreVerifyMismatch
    if (restoreMismatch) {
      heal.push({ code: 'ROLLBACK_VERIFY_FAILED', note: `还原后重读比对不一致：${errText(err)}` })
    }
  }

  // 阶段二：frozen 收敛阶梯（仅在字节还原验证通过后才有意义；R2：异常→manual-repair）
  if (restoreVerified) {
    let conv: RunnerOutcome
    try {
      conv = await frozenConvergeLadder(d, heal)
    } catch (err) {
      return manualRepair(kind, healSuffixNote(`回滚收敛异常：${errText(err)}`), heal, errText(err), true)
    }
    if (conv.class === 'ok') {
      heal.push({ code: 'ROLLBACK_CONVERGED_FROZEN', note: '回滚后 frozen 校验一致' })
      return rolledBack(kind, failure, heal, conv.output)
    }
    // 收敛失败 → originallyAbsent 补移除兜底（移除成功 ≠ 收敛已证，需复验）
    if (fallbackRemovePkg !== undefined && originallyAbsent(fallbackRemovePkg, snapshots)) {
      let rm: RunnerOutcome
      try {
        rm = await d.runner.remove(fallbackRemovePkg)
      } catch (rmErr) {
        return manualRepair(kind, healSuffixNote(`${conv.output}；移除 ${fallbackRemovePkg} 也失败（${errText(rmErr)}）`), heal, conv.output, true)
      }
      if (rm.class !== 'ok') {
        return manualRepair(kind, healSuffixNote(`${conv.output}；移除 ${fallbackRemovePkg} 也失败（${rm.output}）`), heal, conv.output, true)
      }
      heal.push({ code: 'ROLLBACK_FALLBACK_REMOVED', note: `恢复安装失败，已补移除原不存在的依赖 ${fallbackRemovePkg}` })
      // R1：严格 verify gone + 再跑一次 frozen 收敛，通过才允许 rolled-back
      try {
        const depsNow = await strictReadDeps(d)
        if (fallbackRemovePkg in depsNow) {
          return manualRepair(kind, healSuffixNote(`${conv.output}；补移除 ${fallbackRemovePkg} 后依赖仍存在`), heal, conv.output, true)
        }
        const reconverge = await frozenConvergeLadder(d, heal)
        if (reconverge.class === 'ok') {
          heal.push({ code: 'ROLLBACK_CONVERGED_FROZEN', note: '补移除后 frozen 校验一致' })
          return rolledBack(kind, failure, heal, reconverge.output)
        }
        return manualRepair(kind, healSuffixNote(`${conv.output}；补移除 ${fallbackRemovePkg} 后 frozen 复验仍未通过：${reconverge.output}`), heal, reconverge.output, true)
      } catch (err) {
        return manualRepair(kind, healSuffixNote(`${conv.output}；补移除 ${fallbackRemovePkg} 后复验异常：${errText(err)}`), heal, conv.output, true)
      }
    }
    return manualRepair(kind, healSuffixNote(conv.output), heal, conv.output, true)
  }

  // 字节还原本身失败 → 补移除仅作为补偿动作记录（R1：restoreVerified=false 一律 manual-repair）
  const restoreDetail = errText(restoreErr)
  if (fallbackRemovePkg !== undefined && originallyAbsent(fallbackRemovePkg, snapshots)) {
    try {
      const rm = await d.runner.remove(fallbackRemovePkg)
      if (rm.class === 'ok') {
        heal.push({ code: 'ROLLBACK_FALLBACK_REMOVED', note: `快照恢复失败，已补移除原不存在的依赖 ${fallbackRemovePkg}（字节还原未验证）` })
        return manualRepair(kind, healSuffixNote(restoreDetail), heal, rm.output, false)
      }
      return manualRepair(kind, healSuffixNote(`${restoreDetail}；移除 ${fallbackRemovePkg} 也失败（${rm.output}）`), heal, restoreDetail, false)
    } catch (rmErr) {
      return manualRepair(kind, healSuffixNote(`${restoreDetail}；移除 ${fallbackRemovePkg} 也失败（${errText(rmErr)}）`), heal, restoreDetail, false)
    }
  }
  return manualRepair(kind, healSuffixNote(restoreDetail), heal, restoreDetail, false)
}

// ---------- 依赖解析 ----------

interface ResolvedDeps {
  profileDir: string
  runner: PnpmRunner
  warmPackument: ((pkg: string, signal?: AbortSignal) => Promise<void>) | undefined
  syncNpmmirror: (pkg: string) => Promise<boolean>
  clearLatestCache: () => void
  setLiveDisabled: (pkg: string, disabled: boolean) => Promise<boolean>
  stripPatchedEntries: (profileDir: string, pkg: string) => { changed: boolean; orphanedPatchFiles: string[] }
  retryDelaysMs: readonly number[]
  paths: string[]
}

function resolveDeps(deps?: TransactionDeps): Omit<ResolvedDeps, 'runner'> {
  const profileDir = deps?.profileDir ?? webProfileDir()
  return {
    profileDir,
    warmPackument: deps?.warmPackument,
    syncNpmmirror: deps?.syncNpmmirror ?? syncNpmmirrorPackage,
    clearLatestCache: deps?.clearLatestCache ?? clearAllLatestCache,
    setLiveDisabled: deps?.setLiveDisabled ?? setLivePluginDisabled,
    stripPatchedEntries: deps?.stripPatchedEntries ?? removePatchedDependencyEntries,
    retryDelaysMs: deps?.retryDelaysMs ?? [5_000, 15_000],
    paths: [
      join(profileDir, 'package.json'),
      join(profileDir, 'pnpm-lock.yaml'),
      join(profileDir, 'pnpm-workspace.yaml'),
    ],
  }
}

// ---------- install-npm 门 ----------

/** B3：retryable-lag 退避重试（abort-aware sleep + warmPackument 预热；R4：取消不吞）。 */
async function addWithLagRetry(
  req: TransactionRequest & { pkg: string; signal?: AbortSignal },
  spec: string,
  d: ResolvedDeps,
  heal: HealAction[],
): Promise<RunnerOutcome> {
  let attempt = 0
  for (;;) {
    const out = await d.runner.add(spec, req.signal)
    if (out.class !== 'retryable-lag') return out
    // L2②（ADR-0012）：NO_MATCHING_VERSION 且 registry 字段指名 npmmirror → 按需同步镜像后重试；
    // sync 失败静默（false = 回到既有退避语义）；kill switch（DSHM_MIRROR_SYNC=0）在缺省实现内。
    if (out.code === PNPM_OUTCOME_CODES.NO_MATCHING_VERSION && out.registry === 'npmmirror') {
      const synced = await d.syncNpmmirror(req.pkg)
      if (synced) {
        d.clearLatestCache()
        heal.push({ code: 'B3_NPMMIRROR_SYNC', note: 'NO_MATCHING_VERSION 来自 npmmirror，已按需同步镜像后重试（+npmmirror sync）' })
      }
    }
    if (attempt >= d.retryDelaysMs.length) return out
    const delay = d.retryDelaysMs[attempt] ?? 0
    attempt += 1
    heal.push({ code: 'B3_LAG_RETRY', note: `NO_MATCHING_VERSION 疑似 packument CDN 滞后，退避 ${delay}ms 后重试（第 ${attempt} 次）` })
    if (delay > 0) await sleepAbortable(delay, req.signal)
    if (req.signal?.aborted) throw abortErr()
    if (d.warmPackument !== undefined) {
      await d.warmPackument(req.pkg, req.signal)
      // F4（复审补充）：不信任 warm 正确传播取消——即使它正常 resolve，
      // 取消已发生就不得再发起下一轮 add
      if (req.signal?.aborted) throw abortErr()
      heal.push({ code: 'B3_PACKUMENT_WARMED', note: '重试前已预热 registry packument' })
    }
  }
}

/**
 * npm 门最终验证（R3：可重复执行）——manifest 依赖存在与锚定、lockfile 存在、
 * 与 npm dist 一致的 resolution.integrity。firstPass 控制是否记录 range 放行 heal。
 */
/**
 * bundle 身份观察（Task 10，只警告不回滚）：包内无 cordis.patch.yml 且 profile
 * bundles 数组不含该包 → 装成「纯依赖」（不进加载树、已装页进 others 折叠）。
 * 存在合法的无补丁层 dsh 包（伴生库/纯资源包），故不判失败。
 */
async function bundleIdentityWarning(profileDir: string, pkg: string): Promise<'no-patch-layer' | undefined> {
  try {
    await readFile(join(profileDir, 'node_modules', pkg, 'cordis.patch.yml'))
    return undefined
  } catch {
    /* 无补丁层 → 再看 bundles */
  }
  try {
    const raw = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } }
    }
    const bundles = raw?.dsh?.profile?.bundles
    if (Array.isArray(bundles) && bundles.includes(pkg)) return undefined
  } catch {
    /* manifest 读不到 → 如实报 warning（不升级为失败） */
  }
  return 'no-patch-layer'
}

async function verifyNpmCommitState(
  req: Extract<TransactionRequest, { kind: 'install-npm' }>,
  d: ResolvedDeps,
  heal: HealAction[],
  firstPass: boolean,
): Promise<void> {
  const depsNow = await strictReadDeps(d)
  if (depsNow[req.pkg] === undefined) {
    throw new DomainFailure({ code: 'DEP_MISSING_AFTER_ADD', note: `安装后未在 profile 依赖中找到 ${req.pkg}` })
  }
  if (depsNow[req.pkg] !== req.version) {
    if (!specAnchoredAtVersion(depsNow[req.pkg]!, req.version)) {
      throw new DomainFailure({ code: 'DEP_VERSION_MISMATCH', note: `profile 依赖版本 ${depsNow[req.pkg]} 与目标 ${req.version} 不一致` })
    }
    if (firstPass) {
      heal.push({
        code: 'RANGE_ANCHOR_ACCEPTED',
        note: `安装链把依赖写成 range（${depsNow[req.pkg]}，旧版 CLI save-prefix 行为）；精确性由 lockfile integrity 校验继续保证`,
      })
    }
  }
  let lockText: string
  try {
    lockText = await readFile(join(d.profileDir, 'pnpm-lock.yaml'), 'utf8')
  } catch {
    throw new DomainFailure({ code: 'LOCKFILE_MISSING', note: '安装后未找到 pnpm-lock.yaml，无法核对 integrity' })
  }
  let actual: string | null
  try {
    actual = readPnpmLockIntegrity(lockText, req.pkg, req.version)
  } catch (err) {
    throw new DomainFailure({ code: 'LOCK_INTEGRITY_MISMATCH', note: errText(err) })
  }
  try {
    assertNpmIntegrity(req.integrity, actual, req.pkg, req.version)
  } catch (err) {
    throw new DomainFailure({ code: 'LOCK_INTEGRITY_MISMATCH', note: errText(err) })
  }
}

/** mutate 已开始后的取消：进不可取消回滚（R4：runner 返回 ok 也不能提交已取消的变更）。 */
function abortedFailure(note: string): TransactionFailure {
  return { code: 'ABORTED', note }
}

async function installNpm(
  req: Extract<TransactionRequest, { kind: 'install-npm' }>,
  d: ResolvedDeps,
  snapshots: ProfileFileSnapshot[],
): Promise<TransactionResult> {
  const heal: HealAction[] = []
  const spec = `${req.pkg}@${req.version}`
  try {
    const addOut = await addWithLagRetry(req, spec, d, heal)
    if (req.signal?.aborted) {
      return await rollbackAndConverge(d, req.kind, abortedFailure('安装过程中已取消'), heal, snapshots, req.pkg)
    }
    if (addOut.class !== 'ok') {
      const failure: TransactionFailure = req.signal?.aborted
        ? { code: 'ABORTED', note: addOut.output }
        : addOut.class === 'retryable-lag'
          ? { code: 'ADD_RETRY_EXHAUSTED', note: addOut.output }
          : { code: 'ADD_FAILED', note: addOut.output }
      return await rollbackAndConverge(d, req.kind, failure, heal, snapshots, req.pkg)
    }

    // verify 相（严格读取；首次）
    await verifyNpmCommitState(req, d, heal, true)

    // B1（成功路径）：安装链丢 manifest 顶层键 → 快照找回 + frozen 复验（复验失败 fail-closed 进回滚）
    const restoredKeys = await restoreManifestKeys(d.profileDir, snapshots[0])
    if (restoredKeys) {
      heal.push({ code: 'B1_MANIFEST_KEYS_RESTORED', note: `安装链丢失了 manifest 顶层键（${restoredKeys.join(', ')}），已从安装前快照找回` })
      const conv = await frozenConvergeLadder(d, heal)
      if (conv.class !== 'ok') {
        heal.push({ code: 'B1_FROZEN_REVERIFY_FAILED', note: `frozen 复验未通过：${conv.output}` })
        throw new DomainFailure({ code: 'POST_MUTATION_CONVERGENCE_FAILED', note: `B1 找回 manifest 键后 frozen 复验失败：${conv.output}` })
      }
      // R3：B1/B2 可能受控改写了 manifest/lockfile——提交前对最终状态重新执行完整验证
      await verifyNpmCommitState(req, d, heal, false)
    }

    if (req.signal?.aborted) {
      return await rollbackAndConverge(d, req.kind, abortedFailure('提交前已取消'), heal, snapshots, req.pkg)
    }
    return committed(req.kind, heal, addOut.output, {
      pkg: req.pkg,
      spec,
      version: req.version,
      buildApprovals: addOut.buildApprovals ?? [],
      fallbackAllBuilds: addOut.fallbackAllBuilds === true,
      ...(await bundleIdentityWarning(d.profileDir, req.pkg)) ? { bundleWarning: 'no-patch-layer' as const } : {},
    })
  } catch (err) {
    if (err instanceof DomainFailure) {
      return await rollbackAndConverge(d, req.kind, err.failure, heal, snapshots, req.pkg)
    }
    const failure: TransactionFailure = isAbortish(err, req.signal)
      ? { code: 'ABORTED', note: errText(err) }
      : { code: 'INTERNAL_ERROR', note: errText(err) }
    return await rollbackAndConverge(d, req.kind, failure, heal, snapshots, req.pkg)
  }
}

// ---------- install-github 门（Task 5） ----------

/** 从快照 manifest（宽容）读依赖表：github 前态比对用；无/坏 → {}。 */
function snapshotDepsOf(snapshot: ProfileFileSnapshot | undefined): Record<string, string> {
  if (!snapshot?.existed || snapshot.bytes === null) return {}
  try {
    const parsed: unknown = JSON.parse(snapshot.bytes.toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const deps = (parsed as { dependencies?: unknown }).dependencies
    if (deps === null || deps === undefined || typeof deps !== 'object' || Array.isArray(deps)) return {}
    const out: Record<string, string> = {}
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec === 'string' && spec !== '') out[name] = spec
    }
    return out
  } catch {
    return {}
  }
}

async function installGithub(
  req: Extract<TransactionRequest, { kind: 'install-github' }>,
  d: ResolvedDeps,
  snapshots: ProfileFileSnapshot[],
): Promise<TransactionResult> {
  const heal: HealAction[] = []
  const spec = `github:${req.repo}#${req.sha}`
  try {
    // github 门无 B3：retryable-lag 不适用，一律按 hard-fail 处置（分类消费矩阵 github 行）
    const addOut = await d.runner.add(spec, req.signal)
    if (req.signal?.aborted) {
      return await rollbackAndConverge(d, req.kind, abortedFailure('安装过程中已取消'), heal, snapshots)
    }
    if (addOut.class !== 'ok') {
      const failure: TransactionFailure = req.signal?.aborted
        ? { code: 'ABORTED', note: addOut.output }
        : { code: 'ADD_FAILED', note: addOut.output }
      return await rollbackAndConverge(d, req.kind, failure, heal, snapshots)
    }
    // verify（契约 8）：存在键 k 使 depsNow[k] === spec 且 snapshotDeps[k] !== spec（相对前态变化）
    const depsNow = await strictReadDeps(d)
    const prevDeps = snapshotDepsOf(snapshots[0])
    const key = Object.keys(depsNow).find((k) => depsNow[k] === spec && prevDeps[k] !== spec)
    if (key === undefined) {
      throw new DomainFailure({
        code: 'GITHUB_SPEC_MISMATCH',
        note: `安装后未在 profile 依赖中找到受 SHA 锁定的新 spec（${spec}）；已存在的同 spec 旧依赖不算命中`,
      })
    }
    if (req.signal?.aborted) {
      return await rollbackAndConverge(d, req.kind, abortedFailure('提交前已取消'), heal, snapshots)
    }
    return committed(req.kind, heal, addOut.output, {
      pkg: key,
      spec,
      sha: req.sha,
      tag: req.tag,
      buildApprovals: addOut.buildApprovals ?? [],
      fallbackAllBuilds: addOut.fallbackAllBuilds === true,
      ...(await bundleIdentityWarning(d.profileDir, key)) ? { bundleWarning: 'no-patch-layer' as const } : {},
    })
  } catch (err) {
    if (err instanceof DomainFailure) {
      return await rollbackAndConverge(d, req.kind, err.failure, heal, snapshots)
    }
    const failure: TransactionFailure = isAbortish(err, req.signal)
      ? { code: 'ABORTED', note: errText(err) }
      : { code: 'INTERNAL_ERROR', note: errText(err) }
    return await rollbackAndConverge(d, req.kind, failure, heal, snapshots)
  }
}

// ---------- uninstall 门（Task 5；定序写死：validate → 快照 → live-disable → 摘补丁 → remove → verify gone） ----------

/** validate（严格读取）：全部 rejected，零写入零快照。返回 null 表示通过。 */
async function validateUninstall(
  req: Extract<TransactionRequest, { kind: 'uninstall' }>,
  d: ResolvedDeps,
): Promise<RejectedResult | null> {
  let depsNow: Record<string, string>
  try {
    depsNow = await strictReadDeps(d)
  } catch (err) {
    if (err instanceof DomainFailure) return rejected(err.failure, req.kind)
    return rejected({ code: 'PROFILE_MANIFEST_UNREADABLE', note: errText(err) }, req.kind)
  }
  if (!(req.pkg in depsNow)) {
    return rejected({ code: 'NOT_INSTALLED', note: `web profile 未安装该插件: ${req.pkg}` }, req.kind)
  }
  const dir = resolvePluginDir(d.profileDir, req.pkg, depsNow[req.pkg])
  if (dir === null) {
    return rejected({ code: 'PLUGIN_METADATA_UNREADABLE', note: `无法解析插件目录: ${req.pkg}` }, req.kind)
  }
  let raw: string
  try {
    raw = await readFile(join(dir, 'package.json'), 'utf8')
  } catch (err) {
    return rejected({ code: 'PLUGIN_METADATA_UNREADABLE', note: `插件 package.json 读取失败（${dir}）：${errText(err)}` }, req.kind)
  }
  let meta: unknown
  try {
    meta = JSON.parse(raw)
  } catch (err) {
    return rejected({ code: 'PLUGIN_METADATA_UNREADABLE', note: `插件 package.json 不是合法 JSON（${dir}）：${errText(err)}` }, req.kind)
  }
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta) || !('dsh' in (meta as Record<string, unknown>))) {
    return rejected({ code: 'NOT_DSH_PLUGIN', note: `不是 dsh 插件: ${req.pkg}` }, req.kind)
  }
  return null
}

/** 卸载回滚：统一回滚后 live 尽力反向（R2：回滚异常也必须反向；补偿记录在案，不改变终态）。 */
async function rollbackWithLiveReverse(
  req: Extract<TransactionRequest, { kind: 'uninstall' }>,
  d: ResolvedDeps,
  failure: TransactionFailure,
  heal: HealAction[],
  snapshots: ProfileFileSnapshot[],
  liveDisabled: boolean,
): Promise<FailedTransactionResult> {
  let result: FailedTransactionResult
  try {
    result = await rollbackAndConverge(d, req.kind, failure, heal, snapshots)
  } catch (err) {
    // 最后防线：rollbackAndConverge 理论上 total；仍异常时如实 manual-repair，随后照样 live 反向
    result = manualRepair(
      req.kind,
      { code: failure.code, note: `${failure.note}；依赖回滚也失败（${errText(err)}）` },
      heal,
      errText(err),
      false,
    )
  }
  if (liveDisabled) {
    try {
      const back = await d.setLiveDisabled(req.pkg, false)
      if (back) heal.push({ code: 'LIVE_REENABLED', note: '回滚后已恢复插件运行（live 反向）' })
      else heal.push({ code: 'LIVE_REENABLE_FAILED', note: '回滚后恢复插件运行未确认（live 反向返回 false）' })
    } catch (err) {
      heal.push({ code: 'LIVE_REENABLE_FAILED', note: `回滚后恢复插件运行失败（live 反向）：${errText(err)}` })
    }
  }
  return result
}

async function uninstall(
  req: Extract<TransactionRequest, { kind: 'uninstall' }>,
  d: ResolvedDeps,
  snapshots: ProfileFileSnapshot[],
): Promise<TransactionResult> {
  const heal: HealAction[] = []
  let liveDisabled = false
  let orphanedPatchFiles: string[] = []
  try {
    liveDisabled = await d.setLiveDisabled(req.pkg, true)
    if (liveDisabled) heal.push({ code: 'LIVE_DISABLED', note: '运行中的插件界面已先行下线' })
    const patch = d.stripPatchedEntries(d.profileDir, req.pkg)
    if (patch.changed) heal.push({ code: 'PATCH_ENTRIES_STRIPPED', note: '已摘除该包的 pnpm 补丁条目（防残留补丁触发 unused-patch 整单失败）' })
    orphanedPatchFiles = patch.orphanedPatchFiles
    const rmOut = await d.runner.remove(req.pkg, req.signal)
    if (req.signal?.aborted) {
      return await rollbackWithLiveReverse(req, d, abortedFailure('卸载过程中已取消'), heal, snapshots, liveDisabled)
    }
    if (rmOut.class !== 'ok') {
      const failure: TransactionFailure = req.signal?.aborted
        ? { code: 'ABORTED', note: rmOut.output }
        : { code: 'REMOVE_FAILED', note: rmOut.output }
      return await rollbackWithLiveReverse(req, d, failure, heal, snapshots, liveDisabled)
    }
    const depsNow = await strictReadDeps(d)
    if (req.pkg in depsNow) {
      throw new DomainFailure({ code: 'STILL_PRESENT_AFTER_REMOVE', note: `移除后 profile 依赖中仍存在 ${req.pkg}` })
    }
    if (req.signal?.aborted) {
      return await rollbackWithLiveReverse(req, d, abortedFailure('提交前已取消'), heal, snapshots, liveDisabled)
    }
    return committed(req.kind, heal, rmOut.output, { pkg: req.pkg, liveDisabled, orphanedPatchFiles })
  } catch (err) {
    if (err instanceof DomainFailure) {
      return await rollbackWithLiveReverse(req, d, err.failure, heal, snapshots, liveDisabled)
    }
    const failure: TransactionFailure = isAbortish(err, req.signal)
      ? { code: 'ABORTED', note: errText(err) }
      : { code: 'INTERNAL_ERROR', note: errText(err) }
    return await rollbackWithLiveReverse(req, d, failure, heal, snapshots, liveDisabled)
  }
}


// ---------- compensate-install 门（M2 Task 3：专用补偿事务，四边界见 DESIGN §3） ----------

/** patchMapping 结构化双落点恢复：workspace（pnpm-workspace.yaml patchedDependencies）与 manifest（pnpm.patchedDependencies）。 */
async function restorePatchMapping(
  profileDir: string,
  mapping: { workspace: Array<{ key: string; patchPath: string }>; manifest: Array<{ key: string; patchPath: string }> },
  heal: HealAction[],
): Promise<void> {
  const wsFile = join(profileDir, 'pnpm-workspace.yaml')
  if (mapping.workspace.length > 0) {
    let text = ''
    try {
      text = await readFile(wsFile, 'utf8')
    } catch {
      text = ''
    }
    const lines = text.replace(/\n*$/, '\n').split('\n')
    if (!lines.some((l) => l.trim() === 'patchedDependencies:')) {
      lines.push('patchedDependencies:')
    }
    for (const entry of mapping.workspace) {
      const line = `  ${JSON.stringify(entry.key)}: ${entry.patchPath}`
      if (!lines.includes(line)) lines.push(line)
    }
    await atomicWriteFile(wsFile, Buffer.from(lines.join('\n'), 'utf8'))
    heal.push({ code: 'PATCH_MAPPING_RESTORED', note: `已恢复 pnpm-workspace.yaml 补丁映射（${mapping.workspace.map((m) => m.key).join('、')}）` })
  }
  if (mapping.manifest.length > 0) {
    const mfFile = join(profileDir, 'package.json')
    let doc: Record<string, unknown> = {}
    try {
      doc = JSON.parse(await readFile(mfFile, 'utf8')) as Record<string, unknown>
    } catch {
      doc = {}
    }
    const pnpm = (doc.pnpm && typeof doc.pnpm === 'object' && !Array.isArray(doc.pnpm) ? doc.pnpm : {}) as Record<string, unknown>
    const patched = (pnpm.patchedDependencies && typeof pnpm.patchedDependencies === 'object' && !Array.isArray(pnpm.patchedDependencies)
      ? pnpm.patchedDependencies
      : {}) as Record<string, string>
    for (const entry of mapping.manifest) patched[entry.key] = entry.patchPath
    pnpm.patchedDependencies = patched
    doc.pnpm = pnpm
    await atomicWriteFile(mfFile, Buffer.from(JSON.stringify(doc, null, 2) + '\n', 'utf8'))
    heal.push({ code: 'PATCH_MAPPING_RESTORED', note: `已恢复 package.json#pnpm.patchedDependencies（${mapping.manifest.map((m) => m.key).join('、')}）` })
  }
}

/** mapping 双落点复读确认（严格读写：任一落点写入后复读不符 → 失败）。 */
async function verifyPatchMapping(profileDir: string, mapping: { workspace: Array<{ key: string; patchPath: string }>; manifest: Array<{ key: string; patchPath: string }> }): Promise<string | null> {
  if (mapping.workspace.length > 0) {
    try {
      const text = await readFile(join(profileDir, 'pnpm-workspace.yaml'), 'utf8')
      for (const entry of mapping.workspace) {
        if (!text.includes(JSON.stringify(entry.key))) return `workspace 补丁映射复读缺失：${entry.key}`
      }
    } catch (err) {
      return `pnpm-workspace.yaml 复读失败：${errText(err)}`
    }
  }
  if (mapping.manifest.length > 0) {
    try {
      const doc = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { pnpm?: { patchedDependencies?: Record<string, string> } }
      for (const entry of mapping.manifest) {
        if (doc.pnpm?.patchedDependencies?.[entry.key] !== entry.patchPath) return `manifest 补丁映射复读缺失：${entry.key}`
      }
    } catch (err) {
      return `package.json 复读失败：${errText(err)}`
    }
  }
  return null
}

/**
 * 补偿门：validate（evidence 插队复验，零写入）→ 快照 → live-disable → strip → remove →
 * verify gone → PriorUnion 分支（none 终 / mappingOnly 恢复 mapping+frozen / dependency 恢复 mapping→add→三重验证）。
 * 无外部 signal（安装已 committed，清理不可被客户端断连取消）。
 */
async function compensateInstall(
  req: Extract<TransactionRequest, { kind: 'compensate-install' }>,
  d: ResolvedDeps,
): Promise<TransactionResult> {
  const heal: HealAction[] = []
  const pkg = req.pkg

  // validate：evidence 实读比对（插队复验；失配 → rejected 零写入）
  try {
    const depsNow = await strictReadDeps(d)
    const current = depsNow[pkg]
    if (req.evidence.source === 'npm') {
      if (current !== req.evidence.manifestSpec) {
        return rejected({ code: 'COMPENSATE_EVIDENCE_MISMATCH', note: `manifest 依赖值已变化（现值 ${current ?? '缺失'}，期望 ${req.evidence.manifestSpec}）；拒绝补偿` }, req.kind)
      }
    } else if (current !== req.evidence.pinnedSpec) {
      return rejected({ code: 'COMPENSATE_EVIDENCE_MISMATCH', note: `manifest 依赖值已变化（现值 ${current ?? '缺失'}，期望 ${req.evidence.pinnedSpec}）；拒绝补偿` }, req.kind)
    }
    if (req.evidence.source === 'npm') {
      const lockText = await readFile(join(d.profileDir, 'pnpm-lock.yaml'), 'utf8')
      const version = lockVersionOf(lockText, pkg) ?? req.evidence.resolvedVersion
      const integrity = readPnpmLockIntegrity(lockText, pkg, version)
      if (integrity === null || integrity !== req.evidence.integrity) {
        return rejected({ code: 'COMPENSATE_EVIDENCE_MISMATCH', note: 'lockfile integrity 与补偿证据不一致；拒绝补偿' }, req.kind)
      }
    } else {
      const lockText = await readFile(join(d.profileDir, 'pnpm-lock.yaml'), 'utf8')
      const commit = lockCommitOf(lockText, pkg)
      if (commit === null || commit !== req.evidence.lockCommitIdentity) {
        return rejected({ code: 'COMPENSATE_EVIDENCE_MISMATCH', note: 'lockfile commit identity 与补偿证据不一致；拒绝补偿' }, req.kind)
      }
    }
  } catch (err) {
    if (err instanceof DomainFailure) return rejected(err.failure, req.kind)
    return rejected({ code: 'COMPENSATE_EVIDENCE_MISMATCH', note: `补偿证据复验读取失败：${errText(err)}` }, req.kind)
  }
  if (req.prior.kind === 'unavailable') {
    return rejected({ code: 'COMPENSATE_EVIDENCE_MISMATCH', note: `prior 关联歧义，拒绝补偿：${req.prior.reason}` }, req.kind)
  }

  // 快照 → live-disable → strip → remove → verify gone（与卸载同序；live-disable 在快照后）
  let snapshots: ProfileFileSnapshot[]
  try {
    snapshots = await snapshotFiles(d.paths)
  } catch (err) {
    return rejected({ code: 'SNAPSHOT_FAILED', note: errText(err) }, req.kind)
  }
  let liveDisabled = false
  let orphanedPatchFiles: string[] = []
  try {
    liveDisabled = await d.setLiveDisabled(pkg, true)
    if (liveDisabled) heal.push({ code: 'LIVE_DISABLED', note: '补偿前已将运行中的坏包界面下线' })
    const patch = d.stripPatchedEntries(d.profileDir, pkg)
    if (patch.changed) heal.push({ code: 'PATCH_ENTRIES_STRIPPED', note: '已摘除该包的 pnpm 补丁条目' })
    orphanedPatchFiles = patch.orphanedPatchFiles
    const rmOut = await d.runner.remove(pkg)
    if (rmOut.class !== 'ok') {
      return await rollbackAndConverge(d, req.kind, { code: 'REMOVE_FAILED', note: rmOut.output }, heal, snapshots)
    }
    const depsNow = await strictReadDeps(d)
    if (pkg in depsNow) {
      throw new DomainFailure({ code: 'STILL_PRESENT_AFTER_REMOVE', note: `补偿移除后仍存在 ${pkg}` })
    }
  } catch (err) {
    const failure: TransactionFailure = err instanceof DomainFailure
      ? err.failure
      : { code: 'INTERNAL_ERROR', note: errText(err) }
    // rolled-back：坏包可能仍在 → needsRestart=true、restartSafe=false
    const result = await rollbackAndConverge(d, req.kind, failure, heal, snapshots)
    return result
  }

  // PriorUnion 分支（v9/v10：显式分支，无通用「有 prior 就 add」路径）
  const prior = req.prior
  if (prior.kind === 'none') {
    return committed(req.kind, heal, `compensated:${pkg}`, { pkg, liveDisabled, orphanedPatchFiles })
  }
  const mapping = prior.kind === 'mappingOnly' ? prior.patchMapping : prior.state.patchMapping
  await restorePatchMapping(d.profileDir, mapping, heal)
  const mappingBad = await verifyPatchMapping(d.profileDir, mapping)
  if (mappingBad !== null) {
    return manualRepair(req.kind, { code: 'COMPENSATE_RESTORE_FAILED', note: mappingBad }, heal, mappingBad, false)
  }
  if (prior.kind === 'mappingOnly') {
    // 原依赖本不存在 → 恢复 mapping 后 frozen 验证（runner.add 零调用——add 会装回不存在的包）
    const conv = await frozenConvergeLadder(d, heal)
    if (conv.class !== 'ok') {
      return manualRepair(req.kind, { code: 'POST_MUTATION_CONVERGENCE_FAILED', note: `mapping 恢复后 frozen 验证未通过：${conv.output}` }, heal, conv.output, false)
    }
    return committed(req.kind, heal, `compensated:${pkg}`, { pkg, liveDisabled, orphanedPatchFiles })
  }
  // dependency：恢复 mapping → add ladder → frozen 收敛 → 三重恢复验证
  const priorState = prior.state
  if (!priorState.restorable) {
    // 理论不可达（restorable:false 在 mutation 前已拒）——防御性 manual-repair
    return manualRepair(req.kind, { code: 'COMPENSATE_RESTORE_FAILED', note: 'prior 不可自动恢复（restorable:false）' }, heal, 'restorable:false', false)
  }
  const addOut = await addWithLagRetry({ kind: 'install-npm', pkg, version: priorState.resolvedVersion ?? '', integrity: priorState.integrity ?? '' }, `${pkg}@${priorState.manifestSpec}`, d, heal)
  if (addOut.class !== 'ok') {
    const result = await rollbackAndConverge(d, req.kind, { code: 'ADD_FAILED', note: addOut.output }, heal, snapshots)
    return result
  }
  const conv = await frozenConvergeLadder(d, heal)
  if (conv.class !== 'ok') {
    return manualRepair(req.kind, { code: 'POST_MUTATION_CONVERGENCE_FAILED', note: `恢复后 frozen 收敛未通过：${conv.output}` }, heal, conv.output, false)
  }
  // 三重恢复验证：manifest spec / node_modules 实际 version / lock integrity
  try {
    const depsNow = await strictReadDeps(d)
    const specNow = depsNow[pkg]
    if (specNow === undefined) throw new Error(`恢复后 manifest 缺少 ${pkg}`)
    let versionNote = ''
    if (priorState.sourceKind === 'npm') {
      if (specNow !== priorState.manifestSpec) {
        // CLI 书写规范化（^/~）：接受规范化但明示，不称「完全恢复」
        versionNote = `；已恢复旧 resolved version，spec 已规范化为 ${specNow}`
      }
      const lockText = await readFile(join(d.profileDir, 'pnpm-lock.yaml'), 'utf8')
      const version = lockVersionOf(lockText, pkg) ?? priorState.resolvedVersion ?? ''
      const integrity = readPnpmLockIntegrity(lockText, pkg, version)
      if (priorState.integrity && integrity !== priorState.integrity) {
        throw new Error('lockfile integrity 与 prior 不一致')
      }
      const nmPkg = JSON.parse(await readFile(join(d.profileDir, 'node_modules', pkg, 'package.json'), 'utf8')) as { version?: unknown }
      if (priorState.resolvedVersion && nmPkg.version !== priorState.resolvedVersion) {
        throw new Error(`node_modules 实际版本（${String(nmPkg.version)}）与 prior（${priorState.resolvedVersion}）不一致`)
      }
    }
    return committed(req.kind, heal, `compensated:${pkg}`, {
      pkg,
      liveDisabled,
      orphanedPatchFiles,
      ...(versionNote ? {} : {}),
    })
  } catch (err) {
    return manualRepair(req.kind, { code: 'COMPENSATE_RESTORE_FAILED', note: `三重恢复验证失败：${errText(err)}` }, heal, errText(err), false)
  }
}

/** pnpm-lock packages 段中目标包的 resolution.version（粗粒度文本提取，供补偿验证）。 */
function lockVersionOf(lockText: string, pkg: string): string | null {
  const re = new RegExp(`'?(?:[^'\n]*node_modules/)?${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@[^'\n]*':\s*\n[^}]*?version:\s*(\S+)`, 'm')
  const m = re.exec(lockText)
  return m ? m[1]!.replace(/'/g, '') : null
}

/** pnpm-lock 目标包 resolution 的 commit（github tarball 无 integrity，以 commit identity 为准）。 */
function lockCommitOf(lockText: string, pkg: string): string | null {
  const re = new RegExp(`'?(?:[^'\n]*node_modules/)?${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@[^'\n]*':\s*\n[^}]*?commit:\s*'?([0-9a-f]{40})`, 'm')
  const m = re.exec(lockText)
  return m ? m[1]! : null
}

// ---------- 入口：FIFO 互斥 + 分发 ----------

/** 模块级 FIFO 互斥锁（进程内串行；skillhub install-lock 同款思路）。 */
let txTail: Promise<unknown> = Promise.resolve()

export async function runProfileTransaction(
  req: TransactionRequest,
  deps?: TransactionDeps,
): Promise<TransactionResult> {
  validateRequest(req) // 畸形 request 快速失败：零排队、零写入
  const exec = txTail.then(
    () => executeTransaction(req, deps),
    () => executeTransaction(req, deps),
  )
  txTail = exec.catch(() => undefined)
  return exec
}

async function executeTransaction(
  req: TransactionRequest,
  deps?: TransactionDeps,
): Promise<TransactionResult> {
  const base = resolveDeps(deps)
  // 排队期 abort
  if (req.signal?.aborted) {
    return rejected({ code: 'ABORTED', note: '排队期已取消' }, req.kind)
  }
  // runner factory（畸形校验已过；factory 异常 = 快照前 → rejected）
  let runner: PnpmRunner
  try {
    runner = (deps?.runner ?? makeDshRunner)(base.profileDir)
  } catch (err) {
    return rejected({ code: 'INTERNAL_ERROR', note: `runner 构造失败：${errText(err)}` }, req.kind)
  }
  const d: ResolvedDeps = { ...base, runner }

  // uninstall 门 validate 先于快照（定序 1；全部 rejected 零写入零快照）
  if (req.kind === 'uninstall') {
    const rejectedResult = await validateUninstall(req, d)
    if (rejectedResult !== null) return rejectedResult
  }

  // 快照（非 ENOENT 读取异常 → rejected，零写入）
  let snapshots: ProfileFileSnapshot[]
  try {
    snapshots = await snapshotFiles(d.paths)
  } catch (err) {
    return rejected({ code: 'SNAPSHOT_FAILED', note: errText(err) }, req.kind)
  }
  // mutate 前 abort
  if (req.signal?.aborted) {
    return rejected({ code: 'ABORTED', note: '变更开始前已取消' }, req.kind)
  }

  // R2 第二层：phase-aware 最后防线。各门自身已 total；此兜底只处理门逻辑的意外遗漏，
  // 快照已取 → 照常走统一回滚（rollbackAndConverge 已 total，不会再递归逃逸）。
  try {
    switch (req.kind) {
      case 'compensate-install':
        return compensateInstall(req, d)
      case 'install-npm':
        return await installNpm(req, d, snapshots)
      case 'install-github':
        return await installGithub(req, d, snapshots)
      case 'uninstall':
        return await uninstall(req, d, snapshots)
    }
  } catch (err) {
    const failure: TransactionFailure = isAbortish(err, req.signal)
      ? { code: 'ABORTED', note: errText(err) }
      : { code: 'INTERNAL_ERROR', note: errText(err) }
    return await rollbackAndConverge(d, req.kind, failure, [], snapshots)
  }
}
