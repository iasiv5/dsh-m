/**
 * npm integrity（DESIGN.md §3 基线扩展）：pnpm lockfile v9 的 integrity 定位与 fail-closed
 * 断言、以及安装失败时的 best-effort manifest/lock 快照恢复。
 * ADR-0037：lockfile 观测解析已收敛到锁档观测（lockfile.ts），本模块是其严格政策消费端
 * （v9 硬门 / 重复键拒绝 / 多候选歧义 fail-closed，文案与门序冻结）；不声称 node_modules
 * 与间接依赖已字节级回滚——这是 best-effort dependency rollback。
 */
import { parseLockfile } from './lockfile.js'
import { readFile, rename, rm, open, mkdir } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname } from 'node:path'

export interface LockIntegrityTarget {
  pkg: string
  version: string
}

/**
 * 定位 lockfile 中 pkg@version 的 resolution.integrity（锁档观测之上的薄政策层，ADR-0037 T4）。
 * 门序冻结：① v9 硬门（字面 '9.0'，值剥一层引号；缺失/空值按「缺失」入文案）→ ② 重复键拒绝
 * （归一后首键入文案）→ ③ 多候选歧义 fail-closed。找不到返回 null；单候选 integrity 缺失
 * 返回 null（非 throw）；peer 后缀仅 `(` 起始容忍 + 余部为空。
 */
export function readPnpmLockIntegrity(lockText: string, pkg: string, version: string): string | null {
  const view = parseLockfile(lockText)
  const raw = view.lockfileVersion
  if ((raw ?? '') !== '9.0') {
    throw new Error(`pnpm lockfile 版本不是 9.0（实际 ${raw || '缺失'}），拒绝解析`)
  }
  if (view.anomalies.duplicateKeys.length > 0) {
    throw new Error(`pnpm lockfile packages 键重复: ${view.anomalies.duplicateKeys[0]}`)
  }
  const target = `${pkg}@${version}`
  const candidates = view.candidatesOf(pkg, version)
  if (candidates.length === 0) return null
  const integrities = new Set(candidates.map((m) => m.integrity))
  if (integrities.size > 1 || (candidates.length > 1 && integrities.has(undefined))) {
    throw new Error(`无法唯一定位 ${target} 的 integrity（${candidates.length} 个候选解析结果不一致），fail closed`)
  }
  return candidates[0]!.integrity ?? null
}

/** 比对 npm dist integrity 与 lockfile 实际值：缺失或不一致都 throw。 */
export function assertNpmIntegrity(expected: string, actual: string | null, pkg: string, version: string): void {
  if (!expected) throw new Error(`npm metadata 缺少 dist integrity：${pkg}@${version}`)
  if (!actual) throw new Error(`pnpm lockfile 中找不到 ${pkg}@${version} 的 resolution.integrity`)
  if (actual !== expected) {
    throw new Error(`integrity 不一致：${pkg}@${version} 期望 ${expected}，lockfile 实际 ${actual}`)
  }
}

// ---------- best-effort 快照恢复 ----------

export interface ProfileFileSnapshot {
  path: string
  /** 安装前是否存在；不存在者恢复时删除安装期间新生成的文件 */
  existed: boolean
  bytes: Buffer | null
}

/** 内部测试注入缝（不进对外接口）：缺省真 fs。 */
export interface AtomicWriteFsOps {
  mkdir?: typeof mkdir
  open?: typeof open
  rename?: typeof rename
  rm?: typeof rm
}

/**
 * 原子写（Task 2 加固；终审复审 Y1/F3/F5 再加固）：POSIX 直接 `rename` 原子覆盖目标
 * （不再先 rm——旧实现的「删目标 → rename」窗口期内崩溃会直接丢文件）。仅 Windows 形态
 * 的 `EPERM`/`EEXIST` 走备份协议：`target→backup`、`tmp→target`，任一步失败恢复
 * `backup→target`，全部成功后删除 backup。失败清理遵守：
 * - F5：`O_EXCL` open 成功才取得 tmp 所有权，未取得所有权绝不清理（可能是他人 in-flight 的碰撞文件）；
 * - F3：close 失败不吞（但不掩盖 write/sync 的原始异常）；
 * - 任何失败路径（含 write/sync/close/rename）都清理自有 tmp；备份恢复本身失败时报告
 *   backup 路径与双重错误，不静默。
 */
async function atomicWriteFile(path: string, bytes: Buffer, fsOps: AtomicWriteFsOps = {}): Promise<void> {
  const mkdirOp = fsOps.mkdir ?? mkdir
  const openOp = fsOps.open ?? open
  const renameOp = fsOps.rename ?? rename
  const rmOp = fsOps.rm ?? rm
  await mkdirOp(dirname(path), { recursive: true })
  const tmp = `${path}.restore-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const backup = `${path}.backup-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  let completed = false
  let tmpOwned = false
  let mainErr: unknown
  let threw = false
  let cleanupErr: unknown
  try {
    try {
      const fh = await openOp(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600)
      tmpOwned = true // O_EXCL 成功 = tmp 由本调用创建
      // Y1（第三轮复审）：write/sync 与 close 的错误全部保留（AggregateError），不互相覆盖
      const errors: unknown[] = []
      try {
        await fh.write(bytes)
        await fh.sync()
      } catch (err) {
        errors.push(err)
      }
      try {
        await fh.close()
      } catch (err) {
        errors.push(err) // F3：close 失败不吞
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, '临时文件写入/同步/关闭失败')
      try {
        await renameOp(tmp, path)
        completed = true
        return
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | null)?.code
        if (code !== 'EPERM' && code !== 'EEXIST') {
          throw err
        }
      }
      // Windows 备份协议
      try {
        await renameOp(path, backup)
      } catch (bakErr) {
        throw bakErr
      }
      try {
        await renameOp(tmp, path)
      } catch (moveErr) {
        try {
          await renameOp(backup, path)
        } catch (restoreErr) {
          throw new Error(
            `原子写失败：${errTextOf(moveErr)}；备份恢复也失败（${errTextOf(restoreErr)}），原文件现位于备份 ${backup}`,
          )
        }
        throw moveErr
      }
      await rmOp(backup, { force: true }).catch(() => undefined)
      completed = true
    } catch (err) {
      threw = true
      mainErr = err
    }
  } finally {
    if (tmpOwned && !completed) {
      try {
        await rmOp(tmp, { force: true })
      } catch (err) {
        cleanupErr = err // Y1：清理失败不覆盖主错误，随后聚合上报（含 tmp 路径）
      }
    }
  }
  if (threw) {
    if (cleanupErr !== undefined) {
      throw new AggregateError(
        [mainErr, cleanupErr],
        `原子写失败且临时文件清理也失败（可能残留 tmp：${tmp}）`,
      )
    }
    throw mainErr
  }
}

function errTextOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export { atomicWriteFile }

/** 内部测试注入缝（不进对外接口）：缺省真 fs。 */
export interface SnapshotFsOps {
  readFile?: typeof readFile
}

/**
 * 记录 profile 关键文件的字节快照（package.json / pnpm-lock.yaml / pnpm-workspace.yaml）。
 * Task 2 加固：仅 `ENOENT`（文件本不存在）→ `existed:false`；其他读取异常（EACCES、
 * EISDIR 等）一律 throw，由调用方 fail closed（零写入），不再把不可读误当成「不存在」。
 */
export async function snapshotFiles(paths: string[], fsOps: SnapshotFsOps = {}): Promise<ProfileFileSnapshot[]> {
  const read = fsOps.readFile ?? readFile
  return Promise.all(
    paths.map(async (path): Promise<ProfileFileSnapshot> => {
      try {
        const bytes = await read(path)
        return { path, existed: true, bytes }
      } catch (err) {
        if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          return { path, existed: false, bytes: null }
        }
        throw err
      }
    }),
  )
}

/**
 * 还原后立即重读比对（第一阶段验证动作；Task 2 起）。F2（第三轮复审）：仅 `ENOENT`
 * 视为文件不存在；EACCES/EIO/EISDIR 等其他读取异常一律 fail closed（抛错）。
 * `fsOps` 为内部测试缝（缺省真 fs），确定性注入读取异常，不依赖 chmod。
 */
export async function verifySnapshots(snapshots: ProfileFileSnapshot[], fsOps: SnapshotFsOps = {}): Promise<void> {
  const read = fsOps.readFile ?? readFile
  for (const snap of snapshots) {
    let current: Buffer | null
    try {
      current = await read(snap.path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code !== 'ENOENT') {
        throw new Error(`还原后复验读取失败（${snap.path}）：${errTextOf(err)}`)
      }
      current = null
    }
    if (snap.existed && snap.bytes !== null) {
      if (current === null || !current.equals(snap.bytes)) {
        throw new Error(`还原后复验不一致：${snap.path}`)
      }
    } else if (current !== null) {
      throw new Error(`还原后应删除的新生成文件仍存在：${snap.path}`)
    }
  }
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
