/**
 * 锁档观测（ADR-0037，GLOSSARY「锁档观测」）：pnpm-lock.yaml 文本的唯一判定产地。
 * 只观测不校验：缺证据如实返回缺失，异常（归一后重复键）如实透出 anomalies；
 * 版本门、重复键拒绝、多候选歧义等严格政策属于消费端（npm-integrity 的 fail-closed 守卫）。
 * text-in、零 fs：读文件的时刻永远归调用方（verify 相的读后写重读是事务契约，不在本 module 合并）。
 *
 * 口径（ADR-0037 决议 5 六项仲裁的落点）：
 * - 段锚定：仅 packages: 段，段扫描终止于其后首个缩进 <2 的非空行（npm-integrity.ts:55 语义）；
 * - 键行：缩进恰好 2（npm-integrity.ts:56 逐字）且 `:` 结尾；缩进 >2 的冒号行属 body 不入键
 *   （真实规范锁段内普遍存在 peerDependencies: 族块样式子映射，≥2 识别会尽数成键——R2-1）；
 * - 键归一取并集：成对单/双引号剥 + node_modules/ 路径前缀剥（至最后一处）；
 * - version 归一（B1/doctor 权威）：剥引号 + 剥全部尾部括号组；
 * - commit 三级（A 权威）：体内 commit: → 键内 40-hex → tarball URL 内 40-hex；
 * - integrity 捕获（C 权威）：前缀约束（行首或 `{`/`,`+空白）首中即定；
 * - observationOf 无证据字段（version/integrity/commit 全缺）→ null（A:305 同语义；tarball 为辅助字段不参与判定）。
 */
import { parseDocument } from 'yaml'

export interface LockObservation {
  version?: string
  integrity?: string
  commit?: string
  /** 辅助观测：tarball URL（不参与 observationOf 的空观测判定） */
  tarball?: string
}

export interface LockfileView {
  /** lockfileVersion 观测值（剥一层首尾引号；无该行 → null）。只观测不做门。 */
  lockfileVersion: string | null
  /** 先在证据语义：归一键 `=== pkg || startsWith(pkg + '@')` 的文件序首条目；重复键首条胜；无证据字段 → null。 */
  observationOf(pkg: string): LockObservation | null
  /** 守卫语义：`pkg@version` 精确 + peer 后缀候选（余部 `=== '' || startsWith('(')`），文件序；含无 integrity 候选（歧义判定归消费端）。 */
  candidatesOf(pkg: string, version: string): LockObservation[]
  /** 顶层 overrides: 区块映射；首条解析失败即停（宁可少配，不可错配——npm-integrity 语义逐字）。 */
  overrides: Record<string, string>
  /** 观测异常透出：归一后重复键（每多一份重复记一条）。不抛错——抛错政策归消费端。 */
  anomalies: { duplicateKeys: string[] }
  /** importers.'.'.dependencies 版本观测（惰性 memoized；yaml 硬错误（doc.errors > 0）或解析异常 → null；版本已归一剥尾部括号组）。不做 9.x 门——门归消费端。 */
  importersRootDependencies(): Map<string, string> | null
}

interface PkgEntry {
  key: string
  body: string
}

function unquote(key: string): string {
  if (key.length >= 2 && ((key.startsWith("'") && key.endsWith("'")) || (key.startsWith('"') && key.endsWith('"')))) {
    return key.slice(1, -1)
  }
  return key
}

/** 键归一并集（ADR-0037 决议 5）：成对单/双引号剥 + node_modules/ 路径前缀剥（至最后一处，A 形贪婪口径）。 */
function normalizeKey(rawKey: string): string {
  let key = unquote(rawKey)
  const idx = key.lastIndexOf('node_modules/')
  if (idx !== -1) key = key.slice(idx + 'node_modules/'.length)
  return key
}

/**
 * packages: 段扫描（缩进感知，C 权威）：键行 = 缩进恰好 2 且 `:` 结尾；条目 body 截至下一
 * 缩进 ≤2 的非空行（空行跳过不终止）；段终止于首个缩进 <2 的非空行。重复键记 anomalies、首条胜。
 */
function scanPackagesSection(lines: string[]): { entries: PkgEntry[]; duplicateKeys: string[] } {
  const entries: PkgEntry[] = []
  const duplicateKeys: string[] = []
  const seen = new Set<string>()
  const packagesIdx = lines.findIndex((l) => l.trim() === 'packages:')
  if (packagesIdx === -1) return { entries, duplicateKeys }
  let i = packagesIdx + 1
  while (i < lines.length) {
    const line = lines[i]!
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()
    if (trimmed === '') {
      i += 1
      continue
    }
    if (indent < 2) break // 段终止（npm-integrity.ts:55 语义）：顶格新段（snapshots:/importers: 等）不流入观测
    if (indent !== 2 || !trimmed.endsWith(':')) {
      i += 1
      continue
    }
    const key = normalizeKey(trimmed.slice(0, -1))
    let j = i + 1
    const body: string[] = []
    while (j < lines.length) {
      const inner = lines[j]!
      const innerIndent = inner.length - inner.trimStart().length
      if (inner.trim() !== '' && innerIndent <= 2) break
      body.push(inner)
      j += 1
    }
    if (seen.has(key)) duplicateKeys.push(key)
    else {
      seen.add(key)
      entries.push({ key, body: body.join('\n') })
    }
    i = j
  }
  return { entries, duplicateKeys }
}

/** version 归一（B1/doctor 权威）：捕获后剥全部单引号 + 剥全部尾部括号组。 */
function extractVersion(body: string): string | undefined {
  const m = /version:\s*'?([^'\n]+)/.exec(body)?.[1]
  if (m === undefined) return undefined
  const normalized = m.replace(/'/g, '').replace(/(\([^)]*\))+$/, '').trim()
  return normalized === '' ? undefined : normalized
}

/** integrity 捕获（C 权威）：前缀约束（行首或 `{`/`,`+空白）逐行首中即定。 */
function extractIntegrity(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const m = /(?:^|[,{]\s*)integrity:\s*([^,}\s'"]+)/.exec(line)
    if (m) return m[1]!
  }
  return undefined
}

function extractTarball(body: string): string | undefined {
  return /tarball:\s*([^,}\s'"]+)/.exec(body)?.[1]?.trim()
}

/** commit 三级（A 权威）：体内 `commit:` → 键内 40-hex → tarball URL 内 40-hex。 */
function extractCommit(key: string, body: string): string | undefined {
  const inBody = /commit:\s*'?([0-9a-f]{40})/.exec(body)?.[1]
  if (inBody) return inBody
  const inKey = /([0-9a-f]{40})/.exec(key)?.[1]
  if (inKey) return inKey
  const tarball = extractTarball(body)
  if (tarball) return /([0-9a-f]{40})/.exec(tarball)?.[1] ?? undefined
  return undefined
}

function entryObservation(entry: PkgEntry): LockObservation {
  const obs: LockObservation = {}
  const version = extractVersion(entry.body)
  const integrity = extractIntegrity(entry.body)
  const commit = extractCommit(entry.key, entry.body)
  const tarball = extractTarball(entry.body)
  if (version !== undefined) obs.version = version
  if (integrity !== undefined) obs.integrity = integrity
  if (commit !== undefined) obs.commit = commit
  if (tarball !== undefined) obs.tarball = tarball
  return obs
}

function readLockfileVersion(lines: string[]): string | null {
  const versionLine = lines.find((l) => /^lockfileVersion:/.test(l.trim()))
  if (!versionLine) return null
  return versionLine.split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, '')
}

/** overrides 区块行扫描（npm-integrity 旧 overrides 读取语义逐字迁移：恰好 2 空格续行、三引号形态、首条失败即停）。 */
function readOverrides(lines: string[]): Record<string, string> {
  const start = lines.findIndex((l) => l.trim() === 'overrides:')
  const result: Record<string, string> = {}
  if (start === -1) return result
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') continue
    if (!/^\s{2}\S/.test(line)) break
    const m = /^\s{2}(?:'([^']+)'|"([^"]+)"|([^\s:][^:]*?))\s*:\s*(.+?)\s*$/.exec(line)
    if (!m) break
    const key = m[1] ?? m[2] ?? m[3]
    if (key === undefined) break
    result[key] = m[4]!
  }
  return result
}

export function parseLockfile(lockText: string): LockfileView {
  const lines = lockText.split(/\r?\n/)
  const { entries, duplicateKeys } = scanPackagesSection(lines)

  const isEvidenceEmpty = (obs: LockObservation): boolean =>
    obs.version === undefined && obs.integrity === undefined && obs.commit === undefined

  let importersCache: Map<string, string> | null | undefined
  const importersRootDependencies = (): Map<string, string> | null => {
    if (importersCache !== undefined) return importersCache
    try {
      const doc = parseDocument(lockText)
      // yaml 硬错误（如重复映射键）→ null（fail-open-null 不猜；与 workspacePatchedKeys 判废语义同源）
      if (doc.errors.length > 0) {
        importersCache = null
        return importersCache
      }
      const js = doc.toJS() as {
        importers?: Record<string, { dependencies?: Record<string, { version?: unknown }> }>
      }
      const depsObj = js?.importers?.['.']?.dependencies ?? {}
      const map = new Map<string, string>()
      for (const [name, value] of Object.entries(depsObj)) {
        // link: 依赖在 lock 里无 version → 自然落空；peer 后缀剥全部尾部括号组（doctor 同口径）
        if (value && typeof value === 'object' && typeof value.version === 'string' && value.version) {
          map.set(name, value.version.replace(/(\([^)]*\))+$/, ''))
        }
      }
      importersCache = map
    } catch {
      importersCache = null
    }
    return importersCache
  }

  const view: LockfileView = {
    lockfileVersion: readLockfileVersion(lines),
    observationOf(pkg: string): LockObservation | null {
      const entry = entries.find((e) => e.key === pkg || e.key.startsWith(`${pkg}@`))
      if (!entry) return null
      const obs = entryObservation(entry)
      return isEvidenceEmpty(obs) ? null : obs
    },
    candidatesOf(pkg: string, version: string): LockObservation[] {
      const prefix = `${pkg}@${version}`
      const out: LockObservation[] = []
      for (const entry of entries) {
        if (!entry.key.startsWith(prefix)) continue
        const rest = entry.key.slice(prefix.length)
        if (rest === '' || rest.startsWith('(')) out.push(entryObservation(entry))
      }
      return out
    },
    overrides: readOverrides(lines),
    anomalies: { duplicateKeys },
    importersRootDependencies,
  }
  return view
}
