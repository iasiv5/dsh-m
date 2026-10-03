/**
 * 供应链等待期（minimumReleaseAge）预检与失败翻译（0.9.19 立基，0.9.x 按治理语义收敛，ADR-0009）。
 *
 * 实证基准（2026-10-03，本机 desktop profile，pnpm 11.7.0，官方管理器操作日志
 * operation-zsc4ei / operation-L8oq1z / operation-l5fXEd）：
 * 1. 默认策略（未显式设置 age、未开 strict = 非严格）下，显式点名的「太新」目标
 *    直接放行安装，pnpm 自动向 pnpm-workspace.yaml 的 `minimumReleaseAgeExclude`
 *    追加 `pkg@ver` 条目（"Added 1 entry …"）；
 * 2. pnpm 的 evaluateVersionPolicy **每包名只认第一条排除规则**，同名后续规则死亡
 *    （dshmarket #732 实证，首条规则生效机理）——死规则会让等待期内全部包操作被
 *    锁文件级校验拦死（0:15 quota-watch 连坐实录）；
 * 3. 校验失败前目标包可能已写入 node_modules，官方管理器只回滚 manifest/lockfile
 *    →「账实分裂」，下次包操作静默回退。
 *
 * 职责（ADR-0009）：
 * ① 委派前预检（releaseAgePrecheck）：仅「显式设置 age 或 strict 开启」时对窗口内
 *    目标拒绝（附可重试时刻）；默认策略放行并返回陈述性 notice。锁内坏形态由
 *    exclude-governance 的治理挂点处理，本模块不再预拒绝（0.9.19 ②腿退役）。
 * ② 失败翻译（describeReleaseAgeFailure）：解析全部违规条目，按「本次目标 vs
 *    旁包」分述发布时刻与可重试时刻。
 * ③ cachedPackumentTimes：预检与登记共用的带缓存 packument 探测。
 *
 * fail-open 纪律：发布时刻不可得 / 策略文件不可读 / profileDir 缺席 / 命中任一
 * 排除规则（首条规则口径）→ 一律放行；pnpm 仍是最终执行者。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { fetchJsonLimited } from './httpx.js'

/** pnpm 11.7 实机测得的策略窗口：24h（operation-l5fXEd 的 cutoff = 检查时刻 − 1440min）。 */
export const DEFAULT_MINIMUM_RELEASE_AGE_MIN = 1440

export interface WorkspacePolicy {
  /** `minimumReleaseAge` 键是否显式存在（显式设置时 pnpm 对精确点名的新版本改判硬失败 NO_MATURE_MATCHING_VERSION，dshmarket #531 实测） */
  explicitAge: boolean
  /** minimumReleaseAge（分钟）；未配置 = null（调用方用 DEFAULT 兜底） */
  minimumReleaseAgeMin: number | null
  /** minimumReleaseAgeStrict: true（自动豁免改判 prompt 门，非交互委派过不去） */
  strict: boolean
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
  const empty: WorkspacePolicy = { explicitAge: false, minimumReleaseAgeMin: null, strict: false, excludes: [] }
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
  // yaml 库的 Map.get() 对标量返回已解包的原始值（number/string/boolean），对集合返回节点——两种形态都兜住
  const rawAge: unknown = document.contents.get('minimumReleaseAge')
  const age = isScalar(rawAge) ? scalarNumber(rawAge.value) : scalarNumber(rawAge)
  const rawStrict: unknown = document.contents.get('minimumReleaseAgeStrict')
  const strict = rawStrict === true || (isScalar(rawStrict) && rawStrict.value === true)
  return {
    explicitAge: rawAge !== undefined && rawAge !== null,
    minimumReleaseAgeMin: age !== null && age > 0 ? age : null,
    strict,
    excludes,
  }
}

/**
 * 单条 exclude 选择器对 (pkg, version) 的覆盖判定——首条规则生效口径（ADR-0009）：
 * 规范形态下每包名只有一条规则，命中即覆盖。0.9.19 的 `unreliable-unscoped-exact`
 * 形态论退役（020 §2.4 的 ❌ 案例实为同名第二规则死亡，见 §8 改判）。
 */
export type ExcludeMatch = 'effective' | 'no'

export function excludeMatch(selector: string, pkg: string, version: string): ExcludeMatch {
  const s = selector.trim()
  if (s === '') return 'no'
  if (s.includes('||')) {
    for (const part of s.split('||')) {
      if (excludeMatch(part.trim(), pkg, version) === 'effective') return 'effective'
    }
    return 'no'
  }
  const at = s.lastIndexOf('@')
  if (at <= 0) {
    // 包名级（dshmarket）或裸版本号段（只应出现在复合条目内，顶层出现视为包名比较）
    return s === pkg || s === version ? 'effective' : 'no'
  }
  return s.slice(0, at) === pkg && s.slice(at + 1) === version ? 'effective' : 'no'
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
  role: 'target'
  publishedAt: number
  deadline: number
}

export type ReleaseAgePrecheckResult =
  | { blocked: false; notice?: string }
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

/**
 * 带进程内缓存的 packument time 探测（TTL 5min）：预检与登记（exclude-governance）
 * 共用——同一操作里预检刚拉过的 packument 不二次拉取（8MiB 级全量）。
 */
export async function cachedPackumentTimes(pkg: string, timeoutMs = 12_000, signal?: AbortSignal): Promise<Record<string, string> | null> {
  const hit = packumentCache.get(pkg)
  if (hit && Date.now() - hit.at < PACKUMENT_CACHE_TTL_MS) return hit.times
  const times = await npmPackumentTimes(pkg, timeoutMs, signal)
  packumentCache.set(pkg, { at: Date.now(), times })
  return times
}

/** 测试钩子：清空 packument 进程内缓存。 */
export function _resetReleaseAgeCachesForTests(): void {
  packumentCache.clear()
}

/**
 * 委派前预检（ADR-0009 收敛语义）：仅当策略显式设置 age 或开启 strict 时，对窗口内
 * 且未被任一排除规则覆盖（首条规则口径）的目标结构化拒绝（附可重试时刻）；默认
 * 策略（非严格）放行并返回陈述性 notice——官方管理器对显式点名的新版本会直接
 * 安装并自动登记，锁内坏形态由 exclude-governance 的治理挂点处理。零写操作；
 * fail-open：发布时刻不可得 / profileDir 缺席 / 命中排除规则 → 放行。
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
  // profileDir 缺席 = 读不到操作员排除条目与策略 → 不预判
  if (!input.profileDir) return { blocked: false }
  const now = input.nowMs ?? Date.now()
  const policy = input.deps?.workspacePolicy
    ? await input.deps.workspacePolicy(input.profileDir)
    : await readWorkspacePolicy(input.profileDir)
  const explicit = policy?.explicitAge ?? false
  const strict = policy?.strict ?? false
  const policyMin = explicit && policy?.minimumReleaseAgeMin != null ? policy.minimumReleaseAgeMin : DEFAULT_MINIMUM_RELEASE_AGE_MIN
  const probe = async (pkg: string): Promise<Record<string, string> | null> => {
    if (input.deps?.packumentTimes) return input.deps.packumentTimes(pkg, Math.min(input.timeoutMs ?? 20_000, 12_000), input.signal)
    return cachedPackumentTimes(pkg, 12_000, input.signal)
  }
  const times = await probe(input.pkg)
  const publishedAt = times ? Date.parse(times[input.version] ?? '') : NaN
  if (!Number.isFinite(publishedAt)) return { blocked: false }
  const exempt = (policy?.excludes ?? []).some((sel) => excludeMatch(sel, input.pkg, input.version) === 'effective')
  const deadline = publishedAt + policyMin * 60_000
  if (exempt || now >= deadline) return { blocked: false }
  if (!explicit && !strict) {
    return {
      blocked: false,
      notice: `目标 ${input.pkg}@${input.version} 发布于 ${fmtLocal(publishedAt)}（等待期内）：官方管理器将按显式点名安装，装好后 dsh-m 会登记豁免条目`,
    }
  }
  const lines: string[] = ['官方管理器的供应链策略（minimumReleaseAge）将拦截本次安装，已提前拒绝（未触碰 profile 文件）：']
  lines.push(`· 目标 ${input.pkg}@${input.version}：发布于 ${fmtLocal(publishedAt)}，预计 ${fmtLocal(deadline)} 后满等待期`)
  lines.push(`预计 ${fmtLocal(deadline)} 后可重试；等待期内也可由操作员修正 pnpm-workspace.yaml 的排除条目形态（包名级/复合）解除拦截`)
  return {
    blocked: true,
    message: lines.join('\n'),
    blockers: [{ entry: `${input.pkg}@${input.version}`, role: 'target', publishedAt, deadline }],
  }
}
