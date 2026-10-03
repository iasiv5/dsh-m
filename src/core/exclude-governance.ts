/**
 * 排除条目代管（ADR-0009）：pnpm-workspace.yaml `minimumReleaseAgeExclude` 块的
 * 纯文本变换（解析 / 治理合并 / 登记）与落盘封装（原子写 + 官方同款锁 + fail-open）。
 *
 * 规范形态：每包一条、版本并集复合（`name@a || b`）；包名级保持裸名；scoped 名在
 * YAML 中必须单引号包裹（`@` 不能作 plain scalar 开头）。治理只修不建；登记可为
 * 无块的文件创建块；解析失败（含 `#` 注释行）一律弃写——pnpm 仍是最终执行者。
 *
 * 机理（首条规则生效）：pnpm evaluateVersionPolicy 每包名只认第一条排除规则，
 * 同名后续规则死亡（dshmarket #732 实证）——同名合并即消除死规则。
 * 语义对照（只读参考）：.dsh-research/dsh-market-clone/src/profile.ts:1310-1385（merge）。
 */
import { readFile as readFileFs } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic, withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { isExactVersion } from './versions.js'
import { cachedPackumentTimes, DEFAULT_MINIMUM_RELEASE_AGE_MIN, readWorkspacePolicy } from './release-age.js'

/** 块形态（`minimumReleaseAgeExclude:` + 块内 `- <条目>` 行）；行内数组等其它形态不在此列。 */
const BLOCK_RE = /^minimumReleaseAgeExclude:[ \t]*\r?\n((?:[ \t]+-[^\r\n]*\r?\n?)*)/m
/** 任意形态的键存在性（含行内）；登记据此避免产生重复键。 */
const KEY_ANY_FORM_RE = /^[ \t]*minimumReleaseAgeExclude[ \t]*:/m
const WS_FILE = 'pnpm-workspace.yaml'

export interface ExcludeRuleView {
  name: string
  /** 版本选择器并集（书写顺序）；包名级（无版本段）→ null */
  selectors: string[] | null
  /** 原行是否以引号开头 */
  quoted: boolean
  /** 原始行全文（含缩进，不含换行） */
  raw: string
}

export type ExcludeBlockParse =
  | { kind: 'absent' }
  | { kind: 'unparseable' }
  | { kind: 'ok'; entries: ExcludeRuleView[]; rawLines: string[]; eol: '\n' | '\r\n'; indent: string }

function splitEntry(raw: string): { name: string; selectors: string[] | null } | null {
  let text = raw.trim()
  if (text.length >= 2 && ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"')))) {
    text = text.slice(1, -1)
  }
  const at = text.startsWith('@') ? text.indexOf('@', 1) : text.indexOf('@')
  if (at === -1) return text === '' ? null : { name: text, selectors: null }
  const name = text.slice(0, at)
  const selector = text.slice(at + 1).trim()
  if (name === '' || selector === '') return null
  return { name, selectors: selector.split('||').map((s) => s.trim()) }
}

/** 解析排除块：absent = 键缺失；unparseable = 块内含 `#` 或无法精确读取的条目（调用方弃写）。 */
export function parseExcludeBlock(yaml: string): ExcludeBlockParse {
  const block = BLOCK_RE.exec(yaml)
  if (block === null) return { kind: 'absent' }
  const eol: '\n' | '\r\n' = /\r\n/.test(yaml) ? '\r\n' : '\n'
  const indentMatch = /^([ \t]+)-/.exec(block[1])
  const indent = indentMatch === null ? '  ' : indentMatch[1]
  const entries: ExcludeRuleView[] = []
  const rawLines: string[] = []
  for (const line of block[1].split(/\r?\n/)) {
    if (line.trim() === '') continue
    const m = /^[ \t]+-[ \t]*(.*?)[ \t]*$/.exec(line)
    if (m === null || m[1].includes('#')) return { kind: 'unparseable' }
    const split = splitEntry(m[1])
    if (split === null) return { kind: 'unparseable' }
    entries.push({ name: split.name, selectors: split.selectors, quoted: /^['"]/.test(m[1]), raw: line })
    rawLines.push(line)
  }
  return { kind: 'ok', entries, rawLines, eol, indent }
}

/** 规范行渲染：单选择器 `name@v`、多选择器 `name@a || b`、包名级裸名；scoped 名加单引号。 */
function renderEntryLine(name: string, selectors: string[] | null, indent: string): string {
  const text =
    selectors === null || selectors.length === 0
      ? name
      : selectors.length === 1
        ? `${name}@${selectors[0]}`
        : `${name}@${selectors.join(' || ')}`
  return `${indent}- ${text.startsWith('@') ? `'${text.replaceAll("'", "''")}'` : text}`
}

export interface MergeExcludeResult {
  yaml: string
  changed: boolean
  mergedNames: string[]
  blockAbsent: boolean
}

/**
 * 治理：同名规则合并为规范形态（每包一条、版本并集、原首现顺序）；只修不建；
 * 块缺失 → changed=false；解析失败 → null（弃写）。changed 的判定逐名比较
 * 「合并后渲染行 vs 原始行」，只有实际被改写的名字进入 mergedNames。
 */
export function mergeExcludeRules(yaml: string): MergeExcludeResult | null {
  const parse = parseExcludeBlock(yaml)
  if (parse.kind === 'absent') return { yaml, changed: false, mergedNames: [], blockAbsent: true }
  if (parse.kind === 'unparseable') return null
  const { entries, rawLines, eol, indent } = parse
  const groups = new Map<string, { selectors: string[] | null; seen: Set<string>; firstRaw: string; count: number }>()
  const order: string[] = []
  entries.forEach((e, i) => {
    let g = groups.get(e.name)
    if (g === undefined) {
      g = { selectors: [], seen: new Set(), firstRaw: rawLines[i], count: 0 }
      groups.set(e.name, g)
      order.push(e.name)
    }
    g.count += 1
    if (e.selectors === null) {
      // 包名级吞掉同名一切版本段
      g.selectors = null
      g.seen.clear()
    } else if (g.selectors !== null) {
      for (const s of e.selectors) {
        if (!g.seen.has(s)) {
          g.seen.add(s)
          g.selectors.push(s)
        }
      }
    }
  })
  const mergedNames = order.filter((name) => {
    const g = groups.get(name)
    if (g === undefined) return false
    return g.count > 1 || renderEntryLine(name, g.selectors, indent) !== g.firstRaw
  })
  if (mergedNames.length === 0) return { yaml, changed: false, mergedNames: [], blockAbsent: false }
  const lines = order.map((name) => {
    const g = groups.get(name)
    return renderEntryLine(name, g?.selectors ?? null, indent)
  })
  const blockText = `minimumReleaseAgeExclude:${eol}${lines.join(eol)}${eol}`
  return { yaml: yaml.replace(BLOCK_RE, () => blockText), changed: true, mergedNames, blockAbsent: false }
}

export type RegisterForm = 'merged' | 'created-composite' | 'created-scoped-exact' | 'created-exact' | 'noop'

export interface RegisterYamlResult {
  yaml: string
  changed: boolean
  form: RegisterForm
}

function newRuleLine(target: { pkg: string; version: string; previousVersion?: string }, indent: string): { line: string; form: RegisterForm } {
  if (target.pkg.startsWith('@')) return { line: renderEntryLine(target.pkg, [target.version], indent), form: 'created-scoped-exact' }
  if (target.previousVersion !== undefined && target.previousVersion !== target.version) {
    return { line: renderEntryLine(target.pkg, [target.version, target.previousVersion], indent), form: 'created-composite' }
  }
  return { line: renderEntryLine(target.pkg, [target.version], indent), form: 'created-exact' }
}

/**
 * 登记：把目标精确版本并入该包**首条**规则（首条规则生效口径）；无既有规则时按
 * scoped → 精确单条、非 scoped + 异版 previousVersion → 双选择器复合、其余 → 精确单条
 * 新建；块缺失的文件在尾部创建块（键以行内等其它形式存在 → null，避免重复键）。
 * 目标已被覆盖（包名级 / 选择器含该版本）→ noop。
 */
export function registerExclusionInYaml(
  yaml: string,
  target: { pkg: string; version: string; previousVersion?: string },
): RegisterYamlResult | null {
  const parse = parseExcludeBlock(yaml)
  if (parse.kind === 'unparseable') return null
  if (parse.kind === 'absent') {
    if (KEY_ANY_FORM_RE.test(yaml)) return null
    const eol: '\n' | '\r\n' = /\r\n/.test(yaml) ? '\r\n' : '\n'
    const { line, form } = newRuleLine(target, '  ')
    const base = yaml === '' || yaml.endsWith(eol) ? yaml : yaml + eol
    return { yaml: `${base}minimumReleaseAgeExclude:${eol}${line}${eol}`, changed: true, form }
  }
  const { entries, rawLines, eol, indent } = parse
  const lines = [...rawLines]
  const idx = entries.findIndex((e) => e.name === target.pkg)
  if (idx >= 0) {
    const e = entries[idx]
    if (e.selectors === null) return { yaml, changed: false, form: 'noop' }
    if (e.selectors.includes(target.version)) return { yaml, changed: false, form: 'noop' }
    lines[idx] = renderEntryLine(target.pkg, [...e.selectors, target.version], indent)
    const blockText = `minimumReleaseAgeExclude:${eol}${lines.join(eol)}${eol}`
    return { yaml: yaml.replace(BLOCK_RE, () => blockText), changed: true, form: 'merged' }
  }
  const { line, form } = newRuleLine(target, indent)
  lines.push(line)
  const blockText = `minimumReleaseAgeExclude:${eol}${lines.join(eol)}${eol}`
  return { yaml: yaml.replace(BLOCK_RE, () => blockText), changed: true, form }
}

export function parseNpmSpec(spec: string): { pkg: string; version: string } | null {
  let text = spec.trim()
  if (text.length >= 2 && ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"')))) {
    text = text.slice(1, -1)
  }
  if (text === '' || text.includes(':')) return null
  const at = text.startsWith('@') ? text.indexOf('@', 1) : text.indexOf('@')
  if (at <= 0) return null
  const pkg = text.slice(0, at)
  const version = text.slice(at + 1)
  if (pkg === '' || version === '' || !isExactVersion(version)) return null
  return { pkg, version }
}

// ---------- 落盘封装（治理 / 登记的 I/O 层） ----------

export interface GovernResult {
  ok: boolean
  changed: boolean
  mergedNames?: string[]
  reason?: 'no-dir' | 'no-file' | 'no-block' | 'unparseable' | 'write-failed' | 'clean'
}

export interface GovernDeps {
  readFile?: (path: string) => Promise<string>
  writeFile?: (path: string, text: string) => Promise<void>
}

/**
 * 委派前治理：读-改-写全程持官方同款锁（`withFileLock(<profile>/package.json)`，
 * toggle 同先例），changed 才原子写。fail-open：任何失败返回结构化 reason，不抛——
 * pnpm 是最终执行者。锁只串行持锁写者，不防不持锁的 pnpm 追加（残余风险见 ADR-0009）。
 */
export async function governExcludeBlock(profileDir: string, deps: GovernDeps = {}): Promise<GovernResult> {
  if (!profileDir) return { ok: true, changed: false, reason: 'no-dir' }
  const doRead = deps.readFile ?? ((path: string) => readFileFs(path, 'utf8'))
  const doWrite =
    deps.writeFile ??
    (async (path: string, text: string) => {
      await writeFileAtomic(path, text, { mode: 0o600 })
    })
  const file = join(profileDir, WS_FILE)
  try {
    return await withFileLock(join(profileDir, 'package.json'), async () => {
      let yaml: string
      try {
        yaml = await doRead(file)
      } catch {
        return { ok: false, changed: false, reason: 'no-file' as const }
      }
      if (!KEY_ANY_FORM_RE.test(yaml)) return { ok: true, changed: false, reason: 'no-block' as const }
      const merged = mergeExcludeRules(yaml)
      if (merged === null) return { ok: false, changed: false, reason: 'unparseable' as const }
      if (!merged.changed) return { ok: true, changed: false, reason: 'clean' as const }
      await doWrite(file, merged.yaml)
      return { ok: true, changed: true, mergedNames: merged.mergedNames }
    })
  } catch {
    return { ok: false, changed: false, reason: 'write-failed' }
  }
}

export interface RegisterResult {
  applied: boolean
  form?: RegisterForm
  reason?: 'no-dir' | 'not-young' | 'no-file' | 'unparseable' | 'write-failed' | 'up-to-date'
}

export interface RegisterDeps {
  readFile?: (path: string) => Promise<string>
  writeFile?: (path: string, text: string) => Promise<void>
  packumentTimes?: (pkg: string, timeoutMs?: number, signal?: AbortSignal) => Promise<Record<string, string> | null>
  nowMs?: number
}

/**
 * 成功后登记：仅对发布时刻可判「窗口内」（显式 age 值优先，缺省 1440 分钟）的目标
 * 触发；时刻不可得一律不登记（不发明）。本地检查（文件缺席 → no-file）先于 registry
 * 探测——缺省绑定下无块文件零网络。与治理同锁同 fail-open 纪律。
 */
export async function registerExclusion(
  profileDir: string,
  target: { pkg: string; version: string; previousVersion?: string },
  deps: RegisterDeps = {},
): Promise<RegisterResult> {
  if (!profileDir) return { applied: false, reason: 'no-dir' }
  const doRead = deps.readFile ?? ((path: string) => readFileFs(path, 'utf8'))
  const doWrite =
    deps.writeFile ??
    (async (path: string, text: string) => {
      await writeFileAtomic(path, text, { mode: 0o600 })
    })
  const file = join(profileDir, WS_FILE)
  try {
    return await withFileLock(join(profileDir, 'package.json'), async () => {
      // 本地检查先行：文件缺席直接 no-file（不发 registry 探测——缺省绑定下测试离线可跑）
      let yaml: string
      try {
        yaml = await doRead(file)
      } catch {
        return { applied: false, reason: 'no-file' as const }
      }
      const times = await (deps.packumentTimes ?? cachedPackumentTimes)(target.pkg, 12_000)
      const now = deps.nowMs ?? Date.now()
      const publishedAt = times ? Date.parse(times[target.version] ?? '') : NaN
      if (!Number.isFinite(publishedAt)) return { applied: false, reason: 'not-young' as const }
      const policy = await readWorkspacePolicy(profileDir)
      const windowMin = policy?.minimumReleaseAgeMin ?? DEFAULT_MINIMUM_RELEASE_AGE_MIN
      if (now >= publishedAt + windowMin * 60_000) return { applied: false, reason: 'not-young' as const }
      const next = registerExclusionInYaml(yaml, target)
      if (next === null) return { applied: false, reason: 'unparseable' as const }
      if (!next.changed) return { applied: false, reason: 'up-to-date' as const, form: next.form }
      await doWrite(file, next.yaml)
      return { applied: true, form: next.form }
    })
  } catch {
    return { applied: false, reason: 'write-failed' }
  }
}
