/**
 * Desktop 供应链等待期（minimumReleaseAge）预检与失败翻译（0.9.19）。
 *
 * pnpm 11.7 实机实证（2026-10-03，本机 desktop profile，官方管理器操作日志
 * operation-hNjgaN / operation-l5fXEd）：
 * 1. 显式安装「太新」目标：非严格模式放行，pnpm 自动向 pnpm-workspace.yaml 的
 *    `minimumReleaseAgeExclude` 追加一条「独立精确条目」（`pkg@ver` 形态）；
 * 2. 但后续任何包操作的锁文件级供应链校验（`Verifying lockfile against
 *    supply-chain policies (N entries)`）不认可 pnpm 自己追加的这种条目——
 *    任何一条未满期的 `pkg@ver` 都会拦死整个安装，且与本次目标无关（旁包能拦住
 *    所有升级，0.9.18 拦住 quota-watch 0.1.15 升级即实证）；
 * 3. 校验失败前目标包可能已写入 node_modules，官方管理器只回滚 manifest/lockfile
 *    →「账实分裂」：界面实装新版 active，账本仍旧版，下次包操作静默回退。
 *
 * 对策（零文件级红线不破：只读 profile 文件，绝不写）：
 * ① 委派前预检（releaseAgePrecheck）：目标版本或锁内「不被校验认可的独立精确
 *    排除条目」任一未满等待期 → 结构化拒绝，不委派官方管理器；
 * ② 失败翻译（describeReleaseAgeFailure）：解析全部违规条目，按「本次目标 vs
 *    锁内旁包」分别给出发布时刻与可重试时刻——不再把旁包名字冒充成本次目标被拦。
 *
 * fail-open 纪律：发布时刻不可得 / 策略文件不可读 / profileDir 缺席 / 命中有效排除
 * 条目（包名级、`||` 复合、scoped 独立精确）→ 一律放行；pnpm 仍是最终执行者。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { fetchJsonLimited } from './httpx.js'
import { isExactVersion } from './versions.js'

/** pnpm 11.7 实机测得的策略窗口：24h（operation-l5fXEd 的 cutoff = 检查时刻 − 1440min）。 */
export const DEFAULT_MINIMUM_RELEASE_AGE_MIN = 1440
/** 锁内「独立精确排除条目」旁包探测上限（防清单失控；超出部分放弃预判，交 pnpm 兜底）。 */
export const MAX_EXCLUDE_PROBES = 8

export interface WorkspacePolicy {
  /** minimumReleaseAge（分钟）；未配置 = null（调用方用 DEFAULT 兜底） */
  minimumReleaseAgeMin: number | null
  /** minimumReleaseAgeExclude 原始条目（字符串原样，仅 trim） */
  excludes: string[]
}

function scalarNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

/**
 * 最小解析 pnpm-workspace.yaml 的两个策略键。
 * 保守口径：坏 YAML / 根非映射 / 结构不符 → 空策略（minimumReleaseAgeMin=null、excludes=[]），
 * 调用方按默认窗口 + 无排除处理，绝不抛。
 */
export function parseWorkspacePolicy(text: string): WorkspacePolicy {
  const empty: WorkspacePolicy = { minimumReleaseAgeMin: null, excludes: [] }
  let document
  try {
    document = parseDocument(text)
  } catch {
    return empty
  }
  if (document.errors.length > 0 || !isMap(document.contents)) return empty
  const excludes: string[] = []
  const rawExcludes = document.contents.get('minimumReleaseAgeExclude')
  if (isSeq(rawExcludes)) {
    for (const item of rawExcludes.items) {
      if (isScalar(item) && typeof item.value === 'string' && item.value.trim() !== '') {
        excludes.push(item.value.trim())
      }
    }
  }
  // yaml 库的 Map.get() 对标量返回已解包的原始值（number/string），对集合返回节点——两种形态都兜住
  const rawAge: unknown = document.contents.get('minimumReleaseAge')
  const age = isScalar(rawAge) ? scalarNumber(rawAge.value) : scalarNumber(rawAge)
  return { minimumReleaseAgeMin: age !== null && age > 0 ? age : null, excludes }
}

/**
 * 单条 exclude 选择器对 (pkg, version) 的覆盖判定——pnpm 11.7 实证语义：
 * - 包名级（`dshmarket`）与 `||` 复合条目（含复合段内的裸版本号）：锁文件校验认可 → effective；
 * - scoped 独立精确条目（`@scope/pkg@1.2.3`）：本机实证被校验认可
 *   （quota-watch@0.1.13 发布 4h、带此条目，0:15 校验未标记）→ effective；
 * - 非 scoped 独立精确条目（`dsh-m@0.9.18`，pnpm 安装时自动追加的形态）：
 *   两次实证（0.9.14、0.9.18）均被锁文件校验拒绝 → unreliable-unscoped-exact（预检按会拦死处理）；
 * - 其余（版本段非精确等值等）不判覆盖。
 */
export type ExcludeMatch = 'effective' | 'unreliable-unscoped-exact' | 'no'

export function excludeMatch(selector: string, pkg: string, version: string): ExcludeMatch {
  const s = selector.trim()
  if (s === '') return 'no'
  if (s.includes('||')) {
    for (const part of s.split('||')) {
      if (excludeMatch(part.trim(), pkg, version) !== 'no') return 'effective'
    }
    return 'no'
  }
  const at = s.lastIndexOf('@')
  if (at <= 0) {
    // 包名级（dshmarket）或裸版本号段（只应出现在复合条目内，顶层出现视为包名比较）
    return s === pkg || s === version ? 'effective' : 'no'
  }
  const namePart = s.slice(0, at)
  const verPart = s.slice(at + 1)
  if (namePart !== pkg) return 'no'
  if (verPart === version) {
    return pkg.startsWith('@') ? 'effective' : 'unreliable-unscoped-exact'
  }
  return 'no'
}

export interface ExactSelector {
  pkg: string
  version: string
  /** scoped 独立精确条目被锁校验认可（effective），不参与「会拦死」旁包探测。 */
  reliable: boolean
}

/** 从独立精确条目提取 (pkg, version)；复合/包名级/版本段非精确 semver → null。 */
export function splitExactSelector(selector: string): ExactSelector | null {
  const s = selector.trim()
  if (s === '' || s.includes('||')) return null
  const at = s.lastIndexOf('@')
  if (at <= 0) return null
  const pkg = s.slice(0, at)
  const version = s.slice(at + 1)
  if (!isExactVersion(version)) return null
  if (!/^@?[A-Za-z0-9-._~]+(\/[A-Za-z0-9-._~]+)?$/.test(pkg)) return null
  return { pkg, version, reliable: pkg.startsWith('@') }
}

const VIOLATION_RE = /(\S+@\S+) was published at ([^,]+), within the minimumReleaseAge cutoff \(([^)]+)\)/g

export interface ReleaseAgeViolation {
  /** 诊断原文里的 `pkg@ver` */
  entry: string
  pkg: string
  version: string | null
  publishedAt: number
  cutoff: number
  /** publishedAt + (检查时刻 − cutoff)：该条目满等待期的时刻 */
  deadline: number
}

/** 解析 pnpm 诊断里的全部等待期违规条目（0.9.10 只取第一条是「报错报错包」的根因之一）。 */
export function parseViolations(diagnostic: string, nowMs = Date.now()): ReleaseAgeViolation[] {
  const out: ReleaseAgeViolation[] = []
  for (const m of diagnostic.matchAll(VIOLATION_RE)) {
    const entry = m[1] ?? ''
    const publishedAt = Date.parse(m[2] ?? '')
    const cutoff = Date.parse(m[3] ?? '')
    if (entry === '' || !Number.isFinite(publishedAt) || !Number.isFinite(cutoff)) continue
    const at = entry.lastIndexOf('@')
    out.push({
      entry,
      pkg: at > 0 ? entry.slice(0, at) : entry,
      version: at > 0 ? entry.slice(at + 1) : null,
      publishedAt,
      cutoff,
      deadline: publishedAt + (nowMs - cutoff),
    })
  }
  return out
}

function fmtLocal(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

export interface ReleaseAgeFailureView {
  message: string
  violations: ReleaseAgeViolation[]
  /** 本次目标包是否在违规名单内（false = 被锁内旁包连坐） */
  targetViolating: boolean
}

/**
 * 0.9.19 失败翻译：替代 0.9.10 的 releaseAgeWaitMessage（只取第一条违规、把旁包
 * 名字当成被拦对象、给「DSH Web 安装同版本」的失配指引）。多行文案进操作记录面板。
 */
export function describeReleaseAgeFailure(input: {
  pkg: string
  version?: string
  diagnostic: string
  nowMs?: number
}): ReleaseAgeFailureView {
  const now = input.nowMs ?? Date.now()
  const violations = parseViolations(input.diagnostic, now)
  if (violations.length === 0) {
    return {
      message: '官方管理器的供应链策略（minimumReleaseAge）未满足：新发布的版本需满等待期才能装入 desktop profile。稍后再点升级即可',
      violations,
      targetViolating: false,
    }
  }
  const targetEntry = input.version ? `${input.pkg}@${input.version}` : input.pkg
  const targetViol = violations.find((v) => v.pkg === input.pkg)
  const others = violations.filter((v) => v !== targetViol)
  const lines: string[] = [`官方管理器的供应链策略（minimumReleaseAge）拦截了本次安装（${input.pkg}）：锁文件供应链校验未通过`]
  if (targetViol) {
    lines.push(`· 本次目标 ${targetViol.entry}：发布于 ${fmtLocal(targetViol.publishedAt)}，预计 ${fmtLocal(targetViol.deadline)} 后满等待期`)
  } else {
    lines.push(`· 本次目标 ${targetEntry}：不在违规名单（被锁内其他未满期条目连坐）`)
  }
  for (const v of others) {
    lines.push(`· 锁内未满期条目 ${v.entry}：发布于 ${fmtLocal(v.publishedAt)}，预计 ${fmtLocal(v.deadline)} 后满等待期（pnpm 安装它时自动追加的独立精确排除条目不被锁文件校验认可，等待期内任何官方包操作都会被拦）`)
  }
  const maxDeadline = Math.max(...violations.map((v) => v.deadline))
  lines.push(`预计 ${fmtLocal(maxDeadline)} 后可重试；等待期内也可由操作员把 pnpm-workspace.yaml 中对应的独立精确排除条目改为包名级或复合条目以解除拦截`)
  return { message: lines.join('\n'), violations, targetViolating: targetViol !== undefined }
}

// ---------- 委派前预检（releaseAgePrecheck） ----------

export interface ReleaseAgeBlocker {
  entry: string
  role: 'target' | 'lockfile-exclude'
  publishedAt: number
  deadline: number
}

export type ReleaseAgePrecheckResult =
  | { blocked: false }
  | { blocked: true; message: string; blockers: ReleaseAgeBlocker[] }

export interface ReleaseAgePrecheckDeps {
  packumentTimes?: (pkg: string, timeoutMs?: number, signal?: AbortSignal) => Promise<Record<string, string> | null>
  workspacePolicy?: (profileDir?: string) => Promise<WorkspacePolicy | null>
}

/** registry packument 的 time 映射（与 npmPackument 同源；失败返回 null，不抛）。 */
export async function npmPackumentTimes(pkg: string, timeoutMs = 20_000, signal?: AbortSignal): Promise<Record<string, string> | null> {
  if (!/^@?[A-Za-z0-9-._~]+(\/[A-Za-z0-9-._~]+)?$/.test(pkg)) return null
  try {
    const data = await fetchJsonLimited<{ time?: unknown }>(
      `https://registry.npmjs.org/${encodeURIComponent(pkg)}`,
      { timeoutMs, signal, maxBytes: 8 * 1024 * 1024 },
    )
    if (!data || typeof data !== 'object' || data.time === null || typeof data.time !== 'object') return null
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(data.time as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return null
  }
}

/** 读 profile 的 pnpm-workspace.yaml 策略；缺席/不可读 → null（调用方 fail-open）。 */
export async function readWorkspacePolicy(profileDir?: string): Promise<WorkspacePolicy | null> {
  if (!profileDir) return null
  try {
    return parseWorkspacePolicy(await readFile(join(profileDir, 'pnpm-workspace.yaml'), 'utf8'))
  } catch {
    return null
  }
}

const packumentCache = new Map<string, { at: number; times: Record<string, string> | null }>()
const PACKUMENT_CACHE_TTL_MS = 5 * 60_000

/** 测试钩子：清空 packument 进程内缓存。 */
export function _resetReleaseAgeCachesForTests(): void {
  packumentCache.clear()
}

/**
 * 委派前预检：目标版本与锁内「不被校验认可的独立精确排除条目」逐个对发布时刻，
 * 任一未满等待期 → 结构化拒绝（blocked + 多行理由）。零写操作；不确定一律放行。
 */
export async function releaseAgePrecheck(input: {
  pkg: string
  version: string
  profileDir?: string
  timeoutMs?: number
  signal?: AbortSignal
  nowMs?: number
  deps?: ReleaseAgePrecheckDeps
}): Promise<ReleaseAgePrecheckResult> {
  // profileDir 缺席 = 读不到操作员排除条目 → 不预判（避免误拦操作员显式 pin 的安装）
  if (!input.profileDir) return { blocked: false }
  const now = input.nowMs ?? Date.now()
  const policy = input.deps?.workspacePolicy
    ? await input.deps.workspacePolicy(input.profileDir)
    : await readWorkspacePolicy(input.profileDir)
  const policyMin = policy?.minimumReleaseAgeMin ?? DEFAULT_MINIMUM_RELEASE_AGE_MIN
  const probe = async (pkg: string): Promise<Record<string, string> | null> => {
    const hit = packumentCache.get(pkg)
    if (hit && Date.now() - hit.at < PACKUMENT_CACHE_TTL_MS) return hit.times
    const times = await (input.deps?.packumentTimes ?? npmPackumentTimes)(pkg, Math.min(input.timeoutMs ?? 20_000, 12_000), input.signal)
    packumentCache.set(pkg, { at: Date.now(), times })
    return times
  }
  const blockers: ReleaseAgeBlocker[] = []
  // ① 本次目标版本的发布时刻（有效排除条目覆盖 → 放行）
  const times = await probe(input.pkg)
  const publishedAt = times ? Date.parse(times[input.version] ?? '') : NaN
  if (Number.isFinite(publishedAt)) {
    const exempt = (policy?.excludes ?? []).some((sel) => excludeMatch(sel, input.pkg, input.version) === 'effective')
    if (!exempt) {
      const deadline = publishedAt + policyMin * 60_000
      if (now < deadline) {
        blockers.push({ entry: `${input.pkg}@${input.version}`, role: 'target', publishedAt, deadline })
      }
    }
  }
  // ② 锁内「不被校验认可的独立精确排除条目」（非 scoped）——任何一条未满期都会拦死整次安装
  const seen = new Set<string>([`${input.pkg}@${input.version}`])
  const candidates = (policy?.excludes ?? [])
    .map((sel) => splitExactSelector(sel))
    .filter((x): x is ExactSelector => x !== null && !x.reliable)
  for (const ex of candidates.slice(0, MAX_EXCLUDE_PROBES)) {
    const entry = `${ex.pkg}@${ex.version}`
    if (seen.has(entry)) continue
    seen.add(entry)
    const t2 = await probe(ex.pkg)
    const pub = t2 ? Date.parse(t2[ex.version] ?? '') : NaN
    if (!Number.isFinite(pub)) continue
    const deadline = pub + policyMin * 60_000
    if (now < deadline) {
      blockers.push({ entry, role: 'lockfile-exclude', publishedAt: pub, deadline })
    }
  }
  if (blockers.length === 0) return { blocked: false }
  const lines: string[] = ['官方管理器的供应链策略（minimumReleaseAge）将拦截本次安装，已提前拒绝（未触碰 profile 文件）：']
  for (const b of blockers) {
    lines.push(b.role === 'target'
      ? `· 目标 ${b.entry}：发布于 ${fmtLocal(b.publishedAt)}，预计 ${fmtLocal(b.deadline)} 后满等待期`
      : `· 锁内排除条目 ${b.entry}：发布于 ${fmtLocal(b.publishedAt)}，预计 ${fmtLocal(b.deadline)} 后满等待期（pnpm 自动追加的独立精确条目不被锁文件校验认可，等待期内任何官方包操作都会被拦）`)
  }
  const maxDeadline = Math.max(...blockers.map((b) => b.deadline))
  lines.push(`预计 ${fmtLocal(maxDeadline)} 后可重试；等待期内也可由操作员修正 pnpm-workspace.yaml 的排除条目形态（包名级/复合）解除拦截`)
  return { blocked: true, message: lines.join('\n'), blockers }
}
