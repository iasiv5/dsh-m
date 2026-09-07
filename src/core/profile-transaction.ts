/**
 * Profile 变更事务（Profile Transaction）——深模块（计划：docs/plans/2026-09-07-profile-transaction-implementation-plan.md）。
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
import {
  assertNpmIntegrity,
  atomicWriteFile,
  readPnpmLockIntegrity,
  readPnpmLockOverrides,
  restoreSnapshots,
  snapshotFiles,
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
// 自升级 = install-npm + pkg=自身（语义等同，不设独立 kind）

export interface HealAction { code: (typeof TX_HEAL_CODES)[number]; note: string }

export const TX_HEAL_CODES = [
  'RANGE_ANCHOR_ACCEPTED', 'B1_MANIFEST_KEYS_RESTORED', 'B1_FROZEN_REVERIFY_FAILED',
  'B2_OVERRIDES_ALIGNED', 'B2_FROZEN_REVERIFY_OK', 'B2_LOCKFILE_REBUILT',
  'B3_LAG_RETRY', 'B3_PACKUMENT_WARMED', 'BUILDS_ALLOWED',
  'ROLLBACK_BYTES_RESTORED', 'ROLLBACK_CONVERGED_FROZEN', 'ROLLBACK_FALLBACK_REMOVED',
  'ROLLBACK_VERIFY_FAILED', 'LIVE_DISABLED', 'LIVE_REENABLED', 'LIVE_REENABLE_FAILED',
  'PATCH_ENTRIES_STRIPPED',
] as const

export const TX_FAILURE_CODES = [
  'DEP_MISSING_AFTER_ADD', 'DEP_VERSION_MISMATCH', 'LOCKFILE_MISSING', 'LOCK_INTEGRITY_MISMATCH',
  'GITHUB_SPEC_MISMATCH', 'ADD_RETRY_EXHAUSTED', 'ADD_FAILED', 'POST_MUTATION_CONVERGENCE_FAILED',
  'NOT_INSTALLED', 'NOT_DSH_PLUGIN', 'REMOVE_FAILED', 'STILL_PRESENT_AFTER_REMOVE',
  'ROLLBACK_FAILED', 'SNAPSHOT_FAILED', 'ABORTED', 'INTERNAL_ERROR',
  'PROFILE_MANIFEST_UNREADABLE', 'PROFILE_MANIFEST_INVALID', 'PLUGIN_METADATA_UNREADABLE',
] as const

export interface TransactionFailure { code: (typeof TX_FAILURE_CODES)[number]; note: string }

export interface TransactionDeps {
  runner?: (profileDir: string) => PnpmRunner   // 缺省 = makeDshRunner
  warmPackument?: (pkg: string, signal?: AbortSignal) => Promise<void>
  setLiveDisabled?: (pkg: string, disabled: boolean) => Promise<boolean>
  /** 卸载门的补丁条目摘除（缺省 = dsh-cli removePatchedDependencyEntries）；注入仅为可测试性 */
  stripPatchedEntries?: (profileDir: string, pkg: string) => { changed: boolean; orphanedPatchFiles: string[] }
  retryDelaysMs?: readonly number[]             // 默认 [5_000, 15_000]；测试 [0, 0]
  profileDir?: string                           // 缺省 webProfileDir()；测试 tmpdir
  /** verify 相读取 profile 依赖（缺省 = 模块私有严格读取器）；仅为桥接/可测试性注入，Task 9 删桥时移除 */
  readProfileDeps?: (profileDir: string) => Promise<Record<string, string>>
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
  readonly sha?: string; readonly tag?: string; readonly usedAllowAllBuilds?: boolean
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
    } catch {
      /* 预热尽力而为：CDN 滞后场景下 packument 请求失败不阻塞重试 */
    }
  }
}

// ---------- 展示层：renderFailure（中文散文唯一产地） ----------

function prefixOf(kind: TransactionRequest['kind'], code: TransactionFailure['code']): string {
  if (code === 'LOCK_INTEGRITY_MISMATCH') return 'integrity 校验失败'
  if (kind === 'uninstall') return '卸载失败'
  if (kind === 'install-github') return 'GitHub 安装失败'
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

function errText(err: unknown): string {
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
  if (d.readProfileDeps !== undefined) return d.readProfileDeps(d.profileDir)
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

/** 还原后立即重读比对（第一阶段的验证动作）。 */
async function assertRestoredBytes(snapshots: ProfileFileSnapshot[]): Promise<void> {
  for (const snap of snapshots) {
    let current: Buffer | null
    try {
      current = await readFile(snap.path)
    } catch {
      current = null
    }
    if (snap.existed && snap.bytes !== null) {
      if (current === null || !current.equals(snap.bytes)) {
        throw new RestoreVerifyMismatch(`还原后复验不一致：${snap.path}`)
      }
    } else if (current !== null) {
      throw new RestoreVerifyMismatch(`还原后应删除的新生成文件仍存在：${snap.path}`)
    }
  }
}

/**
 * 统一回滚：字节还原（重读比对）→ frozen 收敛阶梯 → （仅当前面失败时）originallyAbsent
 * 补移除。回滚不可取消（不传外部 signal）。终态 rolled-back 或 manual-repair。
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

  // 阶段二：frozen 收敛阶梯（仅在字节还原验证通过后才有意义）
  if (restoreVerified) {
    const conv = await frozenConvergeLadder(d, heal)
    if (conv.class === 'ok') {
      heal.push({ code: 'ROLLBACK_CONVERGED_FROZEN', note: '回滚后 frozen 校验一致' })
      return rolledBack(kind, failure, heal, conv.output)
    }
    // 收敛失败 → originallyAbsent 补移除（旧语义兜底）
    if (fallbackRemovePkg !== undefined && originallyAbsent(fallbackRemovePkg, snapshots)) {
      try {
        const rm = await d.runner.remove(fallbackRemovePkg)
        if (rm.class === 'ok') {
          heal.push({ code: 'ROLLBACK_FALLBACK_REMOVED', note: `恢复安装失败，已补移除原不存在的依赖 ${fallbackRemovePkg}` })
          return rolledBack(kind, failure, heal, rm.output)
        }
        return manualRepair(kind, healSuffixNote(`${conv.output}；移除 ${fallbackRemovePkg} 也失败（${rm.output}）`), heal, conv.output, true)
      } catch (rmErr) {
        return manualRepair(kind, healSuffixNote(`${conv.output}；移除 ${fallbackRemovePkg} 也失败（${errText(rmErr)}）`), heal, conv.output, true)
      }
    }
    return manualRepair(kind, healSuffixNote(conv.output), heal, conv.output, true)
  }

  // 字节还原本身失败 → 补移除兜底或 manual-repair
  const restoreDetail = errText(restoreErr)
  if (fallbackRemovePkg !== undefined && originallyAbsent(fallbackRemovePkg, snapshots)) {
    try {
      const rm = await d.runner.remove(fallbackRemovePkg)
      if (rm.class === 'ok') {
        heal.push({ code: 'ROLLBACK_FALLBACK_REMOVED', note: `快照恢复失败，已补移除原不存在的依赖 ${fallbackRemovePkg}` })
        return rolledBack(kind, failure, heal, rm.output)
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
  setLiveDisabled: (pkg: string, disabled: boolean) => Promise<boolean>
  stripPatchedEntries: (profileDir: string, pkg: string) => { changed: boolean; orphanedPatchFiles: string[] }
  retryDelaysMs: readonly number[]
  readProfileDeps: ((profileDir: string) => Promise<Record<string, string>>) | undefined
  paths: string[]
}

function resolveDeps(deps?: TransactionDeps): Omit<ResolvedDeps, 'runner'> {
  const profileDir = deps?.profileDir ?? webProfileDir()
  return {
    profileDir,
    warmPackument: deps?.warmPackument,
    setLiveDisabled: deps?.setLiveDisabled ?? setLivePluginDisabled,
    stripPatchedEntries: deps?.stripPatchedEntries ?? removePatchedDependencyEntries,
    retryDelaysMs: deps?.retryDelaysMs ?? [5_000, 15_000],
    readProfileDeps: deps?.readProfileDeps,
    paths: [
      join(profileDir, 'package.json'),
      join(profileDir, 'pnpm-lock.yaml'),
      join(profileDir, 'pnpm-workspace.yaml'),
    ],
  }
}

// ---------- install-npm 门 ----------

/** B3：retryable-lag 退避重试（abort-aware sleep + warmPackument 预热）。 */
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
    if (attempt >= d.retryDelaysMs.length) return out
    const delay = d.retryDelaysMs[attempt] ?? 0
    attempt += 1
    heal.push({ code: 'B3_LAG_RETRY', note: `NO_MATCHING_VERSION 疑似 packument CDN 滞后，退避 ${delay}ms 后重试（第 ${attempt} 次）` })
    if (delay > 0) await sleepAbortable(delay, req.signal)
    if (d.warmPackument !== undefined) {
      await d.warmPackument(req.pkg, req.signal)
      heal.push({ code: 'B3_PACKUMENT_WARMED', note: '重试前已预热 registry packument' })
    }
  }
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
    if (addOut.class !== 'ok') {
      const failure: TransactionFailure = req.signal?.aborted
        ? { code: 'ABORTED', note: addOut.output }
        : addOut.class === 'retryable-lag'
          ? { code: 'ADD_RETRY_EXHAUSTED', note: addOut.output }
          : { code: 'ADD_FAILED', note: addOut.output }
      return rollbackAndConverge(d, req.kind, failure, heal, snapshots, req.pkg)
    }

    // verify 相（严格读取）
    const depsNow = await strictReadDeps(d)
    if (depsNow[req.pkg] === undefined) {
      throw new DomainFailure({ code: 'DEP_MISSING_AFTER_ADD', note: `安装后未在 profile 依赖中找到 ${req.pkg}` })
    }
    if (depsNow[req.pkg] !== req.version) {
      if (!specAnchoredAtVersion(depsNow[req.pkg]!, req.version)) {
        throw new DomainFailure({ code: 'DEP_VERSION_MISMATCH', note: `profile 依赖版本 ${depsNow[req.pkg]} 与目标 ${req.version} 不一致` })
      }
      heal.push({
        code: 'RANGE_ANCHOR_ACCEPTED',
        note: `安装链把依赖写成 range（${depsNow[req.pkg]}，旧版 CLI save-prefix 行为）；精确性由 lockfile integrity 校验继续保证`,
      })
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

    // B1（成功路径）：安装链丢 manifest 顶层键 → 快照找回 + frozen 复验（复验失败 fail-closed 进回滚）
    const restoredKeys = await restoreManifestKeys(d.profileDir, snapshots[0])
    if (restoredKeys) {
      heal.push({ code: 'B1_MANIFEST_KEYS_RESTORED', note: `安装链丢失了 manifest 顶层键（${restoredKeys.join(', ')}），已从安装前快照找回` })
      const conv = await frozenConvergeLadder(d, heal)
      if (conv.class !== 'ok') {
        heal.push({ code: 'B1_FROZEN_REVERIFY_FAILED', note: `frozen 复验未通过：${conv.output}` })
        throw new DomainFailure({ code: 'POST_MUTATION_CONVERGENCE_FAILED', note: `B1 找回 manifest 键后 frozen 复验失败：${conv.output}` })
      }
    }

    return committed(req.kind, heal, addOut.output, {
      pkg: req.pkg,
      spec,
      version: req.version,
      usedAllowAllBuilds: addOut.usedAllowAllBuilds === true,
    })
  } catch (err) {
    if (err instanceof DomainFailure) {
      return rollbackAndConverge(d, req.kind, err.failure, heal, snapshots, req.pkg)
    }
    const failure: TransactionFailure = isAbortish(err, req.signal)
      ? { code: 'ABORTED', note: errText(err) }
      : { code: 'INTERNAL_ERROR', note: errText(err) }
    return rollbackAndConverge(d, req.kind, failure, heal, snapshots, req.pkg)
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
    if (addOut.class !== 'ok') {
      const failure: TransactionFailure = req.signal?.aborted
        ? { code: 'ABORTED', note: addOut.output }
        : { code: 'ADD_FAILED', note: addOut.output }
      return rollbackAndConverge(d, req.kind, failure, heal, snapshots)
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
    return committed(req.kind, heal, addOut.output, {
      pkg: key,
      spec,
      sha: req.sha,
      tag: req.tag,
      usedAllowAllBuilds: addOut.usedAllowAllBuilds === true,
    })
  } catch (err) {
    if (err instanceof DomainFailure) {
      return rollbackAndConverge(d, req.kind, err.failure, heal, snapshots)
    }
    const failure: TransactionFailure = isAbortish(err, req.signal)
      ? { code: 'ABORTED', note: errText(err) }
      : { code: 'INTERNAL_ERROR', note: errText(err) }
    return rollbackAndConverge(d, req.kind, failure, heal, snapshots)
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

/** 卸载回滚：统一回滚后 live 尽力反向（补偿动作记录在案，不改变终态）。 */
async function rollbackWithLiveReverse(
  req: Extract<TransactionRequest, { kind: 'uninstall' }>,
  d: ResolvedDeps,
  failure: TransactionFailure,
  heal: HealAction[],
  snapshots: ProfileFileSnapshot[],
  liveDisabled: boolean,
): Promise<FailedTransactionResult> {
  const result = await rollbackAndConverge(d, req.kind, failure, heal, snapshots)
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
    if (patch.changed) heal.push({ code: 'PATCH_ENTRIES_STRIPPED', note: '已摘除该包的 pnpm 补丁条目（防 ERR_PNPM_UNUSED_PATCH 整单失败）' })
    orphanedPatchFiles = patch.orphanedPatchFiles
    const rmOut = await d.runner.remove(req.pkg, req.signal)
    if (rmOut.class !== 'ok') {
      const failure: TransactionFailure = req.signal?.aborted
        ? { code: 'ABORTED', note: rmOut.output }
        : { code: 'REMOVE_FAILED', note: rmOut.output }
      return rollbackWithLiveReverse(req, d, failure, heal, snapshots, liveDisabled)
    }
    const depsNow = await strictReadDeps(d)
    if (req.pkg in depsNow) {
      throw new DomainFailure({ code: 'STILL_PRESENT_AFTER_REMOVE', note: `移除后 profile 依赖中仍存在 ${req.pkg}` })
    }
    return committed(req.kind, heal, rmOut.output, { pkg: req.pkg, liveDisabled, orphanedPatchFiles })
  } catch (err) {
    if (err instanceof DomainFailure) {
      return rollbackWithLiveReverse(req, d, err.failure, heal, snapshots, liveDisabled)
    }
    const failure: TransactionFailure = isAbortish(err, req.signal)
      ? { code: 'ABORTED', note: errText(err) }
      : { code: 'INTERNAL_ERROR', note: errText(err) }
    return rollbackWithLiveReverse(req, d, failure, heal, snapshots, liveDisabled)
  }
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

  switch (req.kind) {
    case 'install-npm':
      return installNpm(req, d, snapshots)
    case 'install-github':
      return installGithub(req, d, snapshots)
    case 'uninstall':
      return uninstall(req, d, snapshots)
  }
}
