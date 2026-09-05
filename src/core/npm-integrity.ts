/**
 * npm integrity（DESIGN.md §3 基线扩展）：pnpm lockfile v9 的包/version integrity 定位、
 * 与 npm dist metadata 的比对断言、以及安装失败时的 best-effort manifest/lock 快照恢复。
 * 只用 Node 内置代码；无法唯一定位 package/version/integrity 时 fail closed。
 * 不声称 node_modules 与间接依赖已字节级回滚——这是 best-effort dependency rollback。
 */
import { readFile, rename, rm, open, mkdir } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname } from 'node:path'

export interface LockIntegrityTarget {
  pkg: string
  version: string
}

function unquote(key: string): string {
  if (key.length >= 2 && ((key.startsWith("'") && key.endsWith("'")) || (key.startsWith('"') && key.endsWith('"')))) {
    return key.slice(1, -1)
  }
  return key
}

interface PackageEntry {
  key: string
  integrity: string | null
}

/**
 * 解析 pnpm lockfile v9 的 packages 区块。结构（2 空格缩进层级）：
 *   packages:
 *     name@1.2.3:
 *       resolution: {integrity: sha512-..., tarball: ...}
 *     '@scope/name@1.2.3(peer@2.0.0)':
 *       resolution: {...}
 */
function parsePackagesSection(lockText: string): Map<string, PackageEntry> {
  const lines = lockText.split(/\r?\n/)
  const versionLine = lines.find((l) => /^lockfileVersion:/.test(l.trim()))
  const rawVersion = versionLine ? versionLine.split(':').slice(1).join(':').trim().replace(/^['"]|['"]$/g, '') : ''
  if (rawVersion !== '9.0') {
    throw new Error(`pnpm lockfile 版本不是 9.0（实际 ${rawVersion || '缺失'}），拒绝解析`)
  }
  const packagesIdx = lines.findIndex((l) => l.trim() === 'packages:')
  if (packagesIdx === -1) return new Map()
  const entries = new Map<string, PackageEntry>()
  let i = packagesIdx + 1
  while (i < lines.length) {
    const line = lines[i]!
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()
    if (trimmed === '') {
      i += 1
      continue
    }
    if (indent < 2 || (indent === 0 && trimmed !== '')) break
    if (indent !== 2 || !trimmed.endsWith(':')) {
      i += 1
      continue
    }
    const key = unquote(trimmed.slice(0, -1))
    if (entries.has(key)) throw new Error(`pnpm lockfile packages 键重复: ${key}`)
    // 读取该条目区块直到下一条同级键
    let integrity: string | null = null
    i += 1
    while (i < lines.length) {
      const inner = lines[i]!
      const innerIndent = inner.length - inner.trimStart().length
      if (inner.trim() !== '' && innerIndent <= 2) break
      const m = /(?:^|[,{]\s*)integrity:\s*([^,}\s'"]+)/.exec(inner)
      if (m && integrity === null) integrity = m[1]!
      i += 1
    }
    entries.set(key, { key, integrity })
  }
  return entries
}

/**
 * 定位 lockfile 中 pkg@version 的 resolution.integrity。
 * peer suffix（`(peer@x)`）仅在其剥离后唯一时接受；多个候选 integrity 不一致、
 * lockfile 版本不支持、键重复等一律 throw（fail closed）。找不到返回 null。
 */
export function readPnpmLockIntegrity(lockText: string, pkg: string, version: string): string | null {
  const entries = parsePackagesSection(lockText)
  const target = `${pkg}@${version}`
  const matches = [...entries.values()].filter((entry) => {
    if (!entry.key.startsWith(target)) return false
    const rest = entry.key.slice(target.length)
    return rest === '' || rest.startsWith('(')
  })
  if (matches.length === 0) return null
  const integrities = new Set(matches.map((m) => m.integrity))
  if (integrities.size > 1 || (matches.length > 1 && integrities.has(null))) {
    throw new Error(`无法唯一定位 ${target} 的 integrity（${matches.length} 个候选解析结果不一致），fail closed`)
  }
  return matches[0]!.integrity
}

/** 比对 npm dist integrity 与 lockfile 实际值：缺失或不一致都 throw。 */
export function assertNpmIntegrity(expected: string, actual: string | null, pkg: string, version: string): void {
  if (!expected) throw new Error(`npm metadata 缺少 dist integrity：${pkg}@${version}`)
  if (!actual) throw new Error(`pnpm lockfile 中找不到 ${pkg}@${version} 的 resolution.integrity`)
  if (actual !== expected) {
    throw new Error(`integrity 不一致：${pkg}@${version} 期望 ${expected}，lockfile 实际 ${actual}`)
  }
}

/**
 * 解析 pnpm lockfile v9 顶层的 `overrides:` 映射（键可带引号，值为版本串）。
 * 无该区块返回 {}。只认 pnpm 自己生成的两空格顶层缩进；单条目解析失败即停（宁可少配，
 * 不可错配）。frozen 自愈用它把 lockfile 记录的 overrides 还原进 manifest（2026-09-05 事故）。
 */
export function readPnpmLockOverrides(lockText: string): Record<string, string> {
  const lines = lockText.split(/\r?\n/)
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

// ---------- best-effort 快照恢复 ----------

export interface ProfileFileSnapshot {
  path: string
  /** 安装前是否存在；不存在者恢复时删除安装期间新生成的文件 */
  existed: boolean
  bytes: Buffer | null
}

async function atomicWriteFile(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.restore-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const fh = await open(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600)
  try {
    await fh.write(bytes)
    await fh.sync()
  } finally {
    await fh.close().catch(() => undefined)
  }
  await rm(path, { force: true })
  await rename(tmp, path)
}

export { atomicWriteFile }

/** 记录 profile 关键文件的字节快照（package.json / pnpm-lock.yaml / pnpm-workspace.yaml）。 */
export async function snapshotFiles(paths: string[]): Promise<ProfileFileSnapshot[]> {
  return Promise.all(
    paths.map(async (path): Promise<ProfileFileSnapshot> => {
      try {
        const bytes = await readFile(path)
        return { path, existed: true, bytes }
      } catch {
        return { path, existed: false, bytes: null }
      }
    }),
  )
}

/**
 * 恢复快照：原先存在的文件原样写回（原子 rename）；原先不存在的删除安装过程中
 * 新生成的文件。恢复动作本身失败由调用方汇总报告。
 */
export async function restoreSnapshots(snapshots: ProfileFileSnapshot[]): Promise<void> {
  for (const snap of snapshots) {
    if (snap.existed && snap.bytes !== null) {
      await atomicWriteFile(snap.path, snap.bytes)
    } else {
      await rm(snap.path, { force: true })
    }
  }
}
