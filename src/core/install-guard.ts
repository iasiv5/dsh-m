/**
 * 装后假成功守卫三项检查（M2 Task 2 / DESIGN.md §3「装后假成功守卫」）：
 * ① NO_DSH_MARKER——包内无 dsh 插件标记（package.json 的 dsh.bundle/dsh.client 键或包内 cordis.patch.yml）；
 * ② ENTRY_UNRESOLVABLE——入口不可解析（exports/main 指向文件在包目录内不存在，或 realpath 越界）；
 * ③ LOADER_ID_CONFLICT——新增包的 loader insert id 与现存 id 冲突（两个同 id entry 会让下次开机
 *    整个 profile 起不来）。
 *
 * 读错误分类（io taxonomy）：ENOENT 归属语义结论（marker 不存在/入口不存在/无 patch = 空集）；
 * EACCES/EIO/坏 JSON/坏 YAML → `unavailable`（结论不可定，由调用方 fail-open + guardWarning）。
 * 自撞排除：现存 id 集合排除 `addedPkgs ∪ priorPkgs` 的贡献——升级/重复安装不与自己的旧 id 冲突。
 * bundles 数组不产生 loader id（bundle 是包级启停选择，不是 cordis insert 合成条目），不参与冲突集合。
 */
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { readBundlePatchRows } from './patch-yaml.js'

export type GuardViolationCode = 'NO_DSH_MARKER' | 'ENTRY_UNRESOLVABLE' | 'LOADER_ID_CONFLICT'

export interface GuardViolation {
  pkg: string
  code: GuardViolationCode
  detail: string
  /** LOADER_ID_CONFLICT 专用：冲突 id 及其来源（根 patch / 已装包） */
  conflictingIds?: Array<{ id: string; source: string }>
}

export interface GuardUnavailable {
  /** null = 全局性不可定（如 deps 快照读取失败） */
  pkg: string | null
  reason: string
}

export interface VerifyInstalledAdditionsInput {
  profileDir: string
  addedPkgs: string[]
  /** 升级/重复安装时被覆盖的旧包名（与 addedPkgs 一起从冲突集合中排除） */
  priorPkgs?: string[]
  /** node_modules 目录（缺省 `<profileDir>/node_modules`） */
  pkgsDir?: string
}

export interface VerifyInstalledAdditionsDeps {
  /** dependencies 完整快照（包名 → spec）；缺省读 `<profileDir>/package.json`，显式失败 → 全局 unavailable */
  readDeps?: (profileDir: string) => Promise<Record<string, string>>
}

export interface VerifyGuardResult {
  ok: boolean
  violations: GuardViolation[]
  unavailable: GuardUnavailable[]
}

/** 包名 → node_modules 内目录（@scope/name → node_modules/@scope/name）。 */
function pkgDirOf(pkgsDir: string, name: string): string {
  return join(pkgsDir, ...name.split('/'))
}

function contained(dir: string, p: string): boolean {
  const rel = relative(dir, p)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** 读 JSON：ENOENT → null（语义结论用）；坏 JSON/其他 → 'unreadable'（unavailable 用）。 */
async function readJsonOrNull(file: string): Promise<Record<string, unknown> | null | 'unreadable'> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    return 'unreadable'
  }
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'unreadable'
    return parsed as Record<string, unknown>
  } catch {
    return 'unreadable'
  }
}

/** cordis.patch.yml 存在即 marker（内容可读性由 LOADER_ID_CONFLICT 检查另行分类）。 */
async function hasPatchFile(pkgDir: string): Promise<boolean | 'unreadable' | null> {
  try {
    await stat(join(pkgDir, 'cordis.patch.yml'))
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    return 'unreadable'
  }
}

/**
 * 入口目标解析（保守口径）：
 * - exports 为 string（root sugar）→ 可检查；
 * - exports 为 object：仅 `.` 键（值为 string 或 {default}）或仅 `default` 键 → 可检查；
 *   含其他条件键（./client 等多键导出）→ conservative（调用方 unavailable——多入口解析歧义）；
 * - 无 exports → main；main 也缺失 → null（NO ENTRY 声明）。
 */
function entryTargetOf(pkgJson: Record<string, unknown>): { target: string } | { conservative: true } | { none: true } {
  const exportsField = pkgJson.exports
  if (typeof exportsField === 'string') {
    return { target: exportsField }
  }
  if (exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField)) {
    const keys = Object.keys(exportsField as Record<string, unknown>)
    if (keys.includes('.') && keys.length === 1) {
      const dot = (exportsField as Record<string, unknown>)['.']
      if (typeof dot === 'string') return { target: dot }
      if (dot && typeof dot === 'object' && !Array.isArray(dot)) {
        const dotKeys = Object.keys(dot as Record<string, unknown>)
        if (dotKeys.length === 1 && dotKeys[0] === 'default' && typeof (dot as Record<string, unknown>).default === 'string') {
          return { target: (dot as Record<string, unknown>).default as string }
        }
      }
      return { conservative: true }
    }
    if (keys.length === 1 && keys[0] === 'default' && typeof (exportsField as Record<string, unknown>).default === 'string') {
      return { target: (exportsField as Record<string, unknown>).default as string }
    }
    return { conservative: true }
  }
  const main = pkgJson.main
  if (typeof main === 'string' && main.trim() !== '') return { target: main }
  return { none: true }
}

async function checkEntry(pkg: string, pkgDir: string, pkgJson: Record<string, unknown>): Promise<GuardViolation | GuardUnavailable | null> {
  const resolved = entryTargetOf(pkgJson)
  if ('none' in resolved) {
    return { pkg, code: 'ENTRY_UNRESOLVABLE', detail: 'package.json 缺少 exports/main 入口声明' }
  }
  if ('conservative' in resolved) {
    return { pkg, reason: `入口解析保守跳过（exports 含多条件键，不猜入口）: ${pkgDir}` }
  }
  const entryAbs = join(pkgDir, resolved.target)
  let st
  try {
    st = await stat(entryAbs)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { pkg, code: 'ENTRY_UNRESOLVABLE', detail: `入口文件不存在: ${resolved.target}` }
    }
    return { pkg: null, reason: `入口 stat 失败（${code ?? '未知错误'}）: ${entryAbs}` }
  }
  if (!st.isFile()) {
    return { pkg, code: 'ENTRY_UNRESOLVABLE', detail: `入口不是常规文件: ${resolved.target}` }
  }
  // realpath containment：入口真实路径必须仍在包目录内（防 symlink 逃逸）
  try {
    const [entryReal, pkgReal] = await Promise.all([realpath(entryAbs), realpath(pkgDir)])
    if (!contained(pkgReal, entryReal)) {
      return { pkg, code: 'ENTRY_UNRESOLVABLE', detail: '入口 realpath 越出包目录（symlink 逃逸）' }
    }
  } catch (err) {
    return { pkg: null, reason: `入口 realpath 失败（${(err as NodeJS.ErrnoException).code ?? '未知错误'}）: ${entryAbs}` }
  }
  return null
}

/** 读取一个包的 insert ids：无 patch 文件 → []；坏 YAML → 'unreadable'。 */
async function insertIdsOf(pkgDir: string): Promise<string[] | 'unreadable'> {
  let text: string
  try {
    text = await readFile(join(pkgDir, 'cordis.patch.yml'), 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    return 'unreadable'
  }
  const rows = readBundlePatchRows(text)
  if (!rows.readable) return 'unreadable'
  return rows.inserts.map((row) => row.id)
}

/** 读 profile 根 cordis.patch.yml 的 insert ids：ENOENT = 空集；坏 YAML/EACCES = 'unreadable'。 */
async function rootInsertIds(profileDir: string): Promise<string[] | 'unreadable'> {
  let text: string
  try {
    text = await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    return 'unreadable'
  }
  const rows = readBundlePatchRows(text)
  if (!rows.readable) return 'unreadable'
  return rows.inserts.map((row) => row.id)
}

/** dependencies 完整快照缺省实现：`<profileDir>/package.json` 的 dependencies。文件缺失 = 空集（合法新 profile）；其他读取/解析失败显式抛出 → 全局 unavailable。 */
async function defaultReadDeps(profileDir: string): Promise<Record<string, string>> {
  let text: string
  try {
    text = await readFile(join(profileDir, 'package.json'), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  let raw: { dependencies?: unknown }
  try {
    raw = JSON.parse(text) as { dependencies?: unknown }
  } catch {
    throw new Error('profile package.json 不是合法 JSON')
  }
  const deps = raw?.dependencies
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) return {}
  const out: Record<string, string> = {}
  for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
    if (typeof spec === 'string') out[name] = spec
  }
  return out
}

/**
 * 三项检查入口：对 `addedPkgs` 逐包验证 marker / 入口 / loader id 冲突。
 * `ok` = 无 violation 且无 unavailable；`unavailable` 非空 → 结论不可定（调用方 fail-open + guardWarning）。
 */
export async function verifyInstalledAdditions(
  input: VerifyInstalledAdditionsInput,
  deps?: VerifyInstalledAdditionsDeps,
): Promise<VerifyGuardResult> {
  const violations: GuardViolation[] = []
  const unavailable: GuardUnavailable[] = []
  const pkgsDir = input.pkgsDir ?? join(input.profileDir, 'node_modules')

  // 依赖全量快照：显式失败 → 全局 unavailable（结论不可定）
  let installedDeps: Record<string, string>
  try {
    installedDeps = deps?.readDeps ? await deps.readDeps(input.profileDir) : await defaultReadDeps(input.profileDir)
  } catch (err) {
    return {
      ok: false,
      violations: [],
      unavailable: [{ pkg: null, reason: `profile dependencies 全量读取失败：${err instanceof Error ? err.message : err}` }],
    }
  }

  const added = input.addedPkgs.filter((p) => typeof p === 'string' && p.trim() !== '')
  const excluded = new Set([...added, ...(input.priorPkgs ?? [])])

  // ---------- ① NO_DSH_MARKER + ② ENTRY_UNRESOLVABLE（逐新增包） ----------
  for (const pkg of added) {
    const pkgDir = pkgDirOf(pkgsDir, pkg)
    const pkgJson = await readJsonOrNull(join(pkgDir, 'package.json'))
    if (pkgJson === 'unreadable') {
      unavailable.push({ pkg, reason: `package.json 不可读（EACCES/坏 JSON）: ${pkgDir}` })
      continue
    }
    if (pkgJson === null) {
      violations.push({ pkg, code: 'NO_DSH_MARKER', detail: `包目录或 package.json 不存在: ${pkgDir}` })
      continue
    }
    const hasKey = 'dsh' in pkgJson && pkgJson.dsh !== null && typeof pkgJson.dsh === 'object'
    let marker = hasKey
    if (!marker) {
      const patch = await hasPatchFile(pkgDir)
      if (patch === 'unreadable') {
        unavailable.push({ pkg, reason: `cordis.patch.yml stat 失败（EACCES 等）: ${pkgDir}` })
        continue
      }
      marker = patch === true
    }
    if (!marker) {
      violations.push({ pkg, code: 'NO_DSH_MARKER', detail: '包内无 dsh.bundle/dsh.client 标记且无 cordis.patch.yml' })
      continue
    }
    // ② 入口（marker 成立才检查；marker 缺失时安装本来就要补偿）
    const entry = await checkEntry(pkg, pkgDir, pkgJson)
    if (entry) {
      if ('code' in entry) violations.push(entry as GuardViolation)
      else unavailable.push(entry as GuardUnavailable)
    }
  }

  // ---------- ③ LOADER_ID_CONFLICT（新增包 pairwise + 现存集合，排除自撞） ----------
  const rootIds = await rootInsertIds(input.profileDir)
  if (rootIds === 'unreadable') {
    unavailable.push({ pkg: null, reason: 'profile 根 cordis.patch.yml 不可读（EACCES/坏 YAML），loader id 集合不可定' })
  }
  // 已装依赖包的 insert ids（排除 addedPkgs ∪ priorPkgs 的贡献——自撞排除）
  const existing: Array<{ id: string; source: string }> = rootIds === 'unreadable' ? [] : rootIds.map((id) => ({ id, source: 'profile 根 patch' }))
  for (const depName of Object.keys(installedDeps)) {
    if (excluded.has(depName)) continue
    const ids = await insertIdsOf(pkgDirOf(pkgsDir, depName))
    if (ids === 'unreadable') {
      unavailable.push({ pkg: null, reason: `已装包 cordis.patch.yml 不可读，loader id 集合不可定: ${depName}` })
      continue
    }
    for (const id of ids) existing.push({ id, source: depName })
  }
  // 新增包的 ids（自撞排除在 pairwise 内同样适用：A 的新 id 不会与 A 自己比较）
  const addedIds = new Map<string, string[] | 'unreadable'>()
  for (const pkg of added) {
    addedIds.set(pkg, await insertIdsOf(pkgDirOf(pkgsDir, pkg)))
  }
  for (const [pkg, ids] of addedIds) {
    if (ids === 'unreadable') {
      unavailable.push({ pkg, reason: `新增包 cordis.patch.yml 不可读（EACCES/坏 YAML）: ${pkg}` })
      continue
    }
    if (ids.length === 0) continue
    // pairwise：与其他新增包
    const conflicting: Array<{ id: string; source: string }> = []
    for (const [other, otherIds] of addedIds) {
      if (other === pkg || otherIds === 'unreadable') continue
      for (const id of ids) {
        if (otherIds.includes(id)) conflicting.push({ id, source: other })
      }
    }
    // 与现存集合（根 patch + 其他已装包）
    for (const id of ids) {
      for (const ex of existing) {
        if (ex.id === id) conflicting.push({ id, source: ex.source })
      }
    }
    if (conflicting.length > 0) {
      const seen = new Set<string>()
      const unique = conflicting.filter((c) => (seen.has(`${c.id}|${c.source}`) ? false : (seen.add(`${c.id}|${c.source}`), true)))
      violations.push({
        pkg,
        code: 'LOADER_ID_CONFLICT',
        detail: `insert id 与现存 loader 条目冲突：${unique.map((c) => `${c.id}（来自 ${c.source}）`).join('、')}`,
        conflictingIds: unique,
      })
    }
  }

  return { ok: violations.length === 0 && unavailable.length === 0, violations, unavailable }
}
