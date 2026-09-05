/**
 * Spawn `dsh plugin`。与 skillhub 同款关键约束：
 * - 不经 agent 的沙箱 shell（它写不了 profile 目录）；
 * - 在 dsh web 宿主进程内时，用 `node <自身 entry> plugin ...` 重入自身；
 * - 目标串白名单校验；超时对进程组发 SIGTERM；只保留末 256KB 输出；
 * - prepare 被拦 → 写 dangerouslyAllowAllBuilds 重试（明确报告，DESIGN.md §3 基线 4）。
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { installTimeoutMs, WEB_PROFILE, webProfileDir } from './env.js'
import { createProgressTracker, type ProgressPhase, type ProgressTracker } from './progress.js'

/** pnpm patchedDependencies 条目键与目标包匹配：`pkg` 或 `pkg@任意版本/区间`。 */
function matchesPatchedKey(key: string, pkg: string): boolean {
  return key === pkg || key.startsWith(`${pkg}@`)
}

export interface PatchedEntriesCleanup {
  /** 是否改写了任何配置文件 */
  changed: boolean
  /** 因条目被摘除而失去宿主的补丁文件（保留在磁盘，仅报告） */
  orphanedPatchFiles: string[]
}

/**
 * 摘除 profile 里目标包的 pnpm 补丁条目：pnpm-workspace.yaml 顶层
 * `patchedDependencies` 与 package.json 的 `pnpm.patchedDependencies` 两处。
 * 卸载场景下依赖被移除后，残留补丁条目会让 pnpm 以 ERR_PNPM_UNUSED_PATCH
 * 拒绝整个 remove/install。只精确匹配目标包的键（`pkg` / `pkg@ver`），
 * 其他包的补丁不动；补丁文件本体保留在磁盘（删包不删数据，DESIGN.md §3）。
 */
export function removePatchedDependencyEntries(
  profileDirectory: string,
  pkg: string,
  deps: {
    existsSync?: typeof existsSync
    readFileSync?: typeof readFileSync
    writeFileSync?: typeof writeFileSync
  } = {},
): PatchedEntriesCleanup {
  const target = String(pkg || '').trim()
  if (!target || !isSafePluginTarget(target)) return { changed: false, orphanedPatchFiles: [] }
  const exists = deps.existsSync ?? existsSync
  const read = deps.readFileSync ?? readFileSync
  const write = deps.writeFileSync ?? writeFileSync
  const orphanedPatchFiles: string[] = []
  let changed = false

  // --- pnpm-workspace.yaml（pnpm≥10 补丁配置落点；行级手术，只摘匹配键） ---
  const wsFile = join(profileDirectory, 'pnpm-workspace.yaml')
  let ws = ''
  try {
    ws = read(wsFile, 'utf8')
  } catch {
    /* 无文件则跳过 */
  }
  if (ws) {
    const srcLines = ws.split('\n')
    let start = -1
    for (let i = 0; i < srcLines.length; i++) {
      if (/^patchedDependencies:\s*$/.test(srcLines[i])) {
        start = i
        break
      }
    }
    if (start >= 0) {
      // 块边界：下一个顶层键（无缩进行）或文件尾
      let end = srcLines.length
      for (let i = start + 1; i < srcLines.length; i++) {
        if (/^\S/.test(srcLines[i])) {
          end = i
          break
        }
      }
      const keptBlock: string[] = []
      for (const line of srcLines.slice(start + 1, end)) {
        // 条目行：缩进键 + `:` + 补丁文件路径（键可带引号）
        const m = /^\s+(["']?)([^"':]+?)\1\s*:\s*(.+?)\s*$/.exec(line)
        if (m && matchesPatchedKey(m[2].trim(), target)) {
          changed = true
          const file = resolve(profileDirectory, m[3].trim())
          if (exists(file)) orphanedPatchFiles.push(file)
        } else {
          keptBlock.push(line)
        }
      }
      if (changed) {
        // 块内条目被摘空 → 连 `patchedDependencies:` 头一起移除，避免留下空映射
        const stillHasEntry = keptBlock.some((l) => /^\s+\S/.test(l))
        const next = stillHasEntry
          ? [...srcLines.slice(0, start + 1), ...keptBlock, ...srcLines.slice(end)]
          : [...srcLines.slice(0, start), ...srcLines.slice(end)]
        write(wsFile, next.join('\n'))
      }
    }
  }

  // --- package.json#pnpm.patchedDependencies（pnpm<10 落点，兼容清理） ---
  const pkgJsonFile = join(profileDirectory, 'package.json')
  let raw = ''
  try {
    raw = read(pkgJsonFile, 'utf8')
  } catch {
    /* 无文件则跳过 */
  }
  if (raw) {
    try {
      const doc = JSON.parse(raw) as { pnpm?: { patchedDependencies?: Record<string, unknown> } }
      const patched = doc?.pnpm?.patchedDependencies
      if (patched && typeof patched === 'object') {
        let touched = false
        for (const [key, file] of Object.entries(patched)) {
          if (!matchesPatchedKey(key, target)) continue
          delete patched[key]
          touched = true
          changed = true
          if (typeof file === 'string') {
            const abs = resolve(profileDirectory, file)
            if (exists(abs)) orphanedPatchFiles.push(abs)
          }
        }
        if (touched) {
          if (Object.keys(patched).length === 0) delete doc.pnpm!.patchedDependencies
          if (Object.keys(doc.pnpm!).length === 0) delete doc.pnpm
          write(pkgJsonFile, `${JSON.stringify(doc, null, 2)}\n`)
        }
      }
    } catch {
      /* package.json 不是合法 JSON：不动 */
    }
  }

  return { changed, orphanedPatchFiles }
}

const TARGET_RE = /^[A-Za-z0-9@:./_#+-]+$/
const NDJSON_COMMANDS = new Set(['add', 'remove', 'install'])

export const BOOT_ID = `${String(process.pid)}-${String(Date.now())}`

export interface InstallProgress {
  active: boolean
  target: string
  startedAt: number
  lastLine: string
  phase: ProgressPhase
  done: number
  total: number | null
  currentPackage: string | null
  downloaded: number | null
  size: number | null
  ndjson: boolean
  error: string | null
}

export const progress: InstallProgress = {
  active: false,
  target: '',
  startedAt: 0,
  lastLine: '',
  phase: null,
  done: 0,
  total: null,
  currentPackage: null,
  downloaded: null,
  size: null,
  ndjson: false,
  error: null,
}

export function publicInstallStatus(): Omit<InstallProgress, 'startedAt'> & { boot: string; seconds: number } {
  return {
    active: progress.active,
    target: progress.target,
    seconds: progress.active ? Math.round((Date.now() - progress.startedAt) / 1000) : 0,
    lastLine: progress.lastLine,
    phase: progress.phase,
    done: progress.done,
    total: progress.total,
    currentPackage: progress.currentPackage,
    downloaded: progress.downloaded,
    size: progress.size,
    ndjson: progress.ndjson,
    error: progress.error,
    boot: BOOT_ID,
  }
}

function beginProgress(target: string): ProgressTracker {
  progress.active = true
  progress.target = target
  progress.startedAt = Date.now()
  progress.lastLine = ''
  progress.phase = null
  progress.done = 0
  progress.total = null
  progress.currentPackage = null
  progress.downloaded = null
  progress.size = null
  progress.ndjson = false
  progress.error = null
  return createProgressTracker()
}

function makeProgressFeeder(tracker: ProgressTracker): (chunk: string) => void {
  let lineBuffer = ''
  return (chunk: string): void => {
    lineBuffer += chunk
    let nl: number
    while ((nl = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, nl)
      lineBuffer = lineBuffer.slice(nl + 1)
      const trimmed = line.trim()
      if (trimmed === '') continue
      tracker.feed(trimmed)
      if (!trimmed.startsWith('{')) progress.lastLine = trimmed.slice(0, 200)
    }
  }
}

function syncProgress(tracker: ProgressTracker): void {
  const snap = tracker.snapshot
  progress.phase = snap.phase
  progress.done = snap.done
  progress.total = snap.total
  progress.currentPackage = snap.currentPackage
  progress.downloaded = snap.downloaded
  progress.size = snap.size
  progress.ndjson = snap.seen
  if (snap.error !== null) progress.error = snap.error
}

export type PluginRunner = (profile: string, pluginArgs: string[]) => Promise<string>

export interface DshArgv {
  file: string
  args: string[]
  cwd: string | undefined
  viaShell: boolean
}

export interface RunCommandOptions {
  cwd?: string
  timeoutMs: number
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  viaShell?: boolean
  detached?: boolean
  onChunk?: (text: string) => void
}

export function webProfileName(): string {
  return WEB_PROFILE
}

export function isSafePluginTarget(target: string): boolean {
  return TARGET_RE.test(target)
}

export function nodeExecutable(argv0: string | undefined = process.argv0, execPath: string = process.execPath): string {
  if (argv0 !== undefined && argv0 !== '' && isAbsolute(argv0) && existsSync(argv0)) return argv0
  return execPath
}

/** 宿主进程内时重入自身 entry（skillhub 同款）；否则退回 PATH 上的 dsh。 */
export function dshArgv(input: {
  argv?: readonly string[]
  execArgv?: readonly string[]
  execPath?: string
  argv0?: string
  platform?: NodeJS.Platform
} = {}): DshArgv {
  const argv = input.argv ?? process.argv
  const execArgv = input.execArgv ?? process.execArgv
  const execPath = input.execPath ?? process.execPath
  const argv0 = input.argv0 ?? process.argv0
  const platform = input.platform ?? process.platform
  const node = nodeExecutable(argv0, execPath)
  const entry = argv[1]
  if (entry !== undefined && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) {
    const abs = resolve(entry)
    return { file: node, args: [...execArgv, abs], cwd: dirname(abs), viaShell: false }
  }
  return { file: 'dsh', args: [], cwd: undefined, viaShell: platform === 'win32' }
}

/** pnpm 9 需要 -w 于 workspace 根；其他主版本在非 workspace 下拒绝 -w。 */
export function pluginArgsFor(profileDirectory: string, pluginArgs: readonly string[]): string[] {
  const args = [...pluginArgs]
  if (args[0] !== 'add' && args[0] !== 'remove') return args
  if (!existsSync(join(profileDirectory, 'pnpm-workspace.yaml'))) return args
  return [args[0], '-w', ...args.slice(1)]
}

/** add/remove/install 追加 ndjson reporter，供进度解析（人类回退行由 feeder 记录 lastLine）。 */
export function preparePluginArgs(profileDirectory: string, pluginArgs: readonly string[]): string[] {
  const args = pluginArgsFor(profileDirectory, pluginArgs)
  const command = args[0]
  if (command !== undefined && NDJSON_COMMANDS.has(command)) return [...args, '--reporter=ndjson']
  return args
}

export function isPrepareBlocked(text: string): boolean {
  return /needs to execute build scripts|allowBuilds|ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED|ERR_PNPM_IGNORED_BUILDS/i.test(text)
}

export function withDangerouslyAllowAllBuilds(yaml: string): string {
  if (/(?:^|\n)dangerouslyAllowAllBuilds:\s*true\s*(?:\n|$)/.test(yaml)) return yaml
  if (/(?:^|\n)dangerouslyAllowAllBuilds:\s*/m.test(yaml)) {
    return yaml.replace(/^dangerouslyAllowAllBuilds:\s*.*$/m, 'dangerouslyAllowAllBuilds: true')
  }
  if (yaml.trim() === '') return 'dangerouslyAllowAllBuilds: true\n'
  return `${yaml.replace(/\s*$/u, '\n')}\ndangerouslyAllowAllBuilds: true\n`
}

/** 基线 §17.4：放行构建脚本前必须能被明确报告（返回值带 usedAllowAllBuilds）。 */
function writeDangerouslyAllowAllBuilds(profileDirectory: string): boolean {
  const file = join(profileDirectory, 'pnpm-workspace.yaml')
  let yaml = ''
  try {
    yaml = readFileSync(file, 'utf8')
  } catch {
    /* created below */
  }
  const next = withDangerouslyAllowAllBuilds(yaml)
  if (next === yaml) return false
  mkdirSync(profileDirectory, { recursive: true })
  writeFileSync(file, next)
  return true
}

export function rewritePnpmError(err: unknown): Error {
  const text = err instanceof Error ? err.message : String(err)
  if (/ERR_PNPM_UNUSED_PATCH/.test(text)) {
    return new Error('profile 的补丁配置（patchedDependencies）里存在不再使用的条目，pnpm 拒绝执行。卸载时 dsh-m 会自动摘除目标包自己的补丁条目；仍报此错通常是其他包留有失效补丁，请手工清理 profile 的 pnpm-workspace.yaml。')
  }
  if (isPrepareBlocked(text)) {
    return new Error('该插件需要执行构建脚本（prepare），pnpm 默认拦截。dsh-m 已写入 profile 的 dangerouslyAllowAllBuilds 并重试；若仍失败请检查 web profile 是否可写。')
  }
  if (/ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF/.test(text)) {
    return new Error('当前 profile 的 node_modules 由不同主版本的 pnpm 生成，安装前需要先重建依赖。')
  }
  return err instanceof Error ? err : new Error(text)
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: options.viaShell === true,
      detached: options.detached === true && process.platform !== 'win32',
    } satisfies SpawnOptions)
    let out = ''
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (err) reject(err)
      else resolvePromise(out)
    }
    const killChild = () => {
      if (process.platform !== 'win32' && child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGTERM')
          return
        } catch {
          /* fall through */
        }
      }
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
    }
    const timer = setTimeout(() => {
      killChild()
      finish(new Error(`命令超时 ${options.timeoutMs}ms`))
    }, options.timeoutMs)
    const onAbort = () => {
      killChild()
      finish(new Error('命令已取消'))
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      out = (out + text).slice(-256 * 1024)
      options.onChunk?.(text)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      out = (out + text).slice(-256 * 1024)
      options.onChunk?.(text)
    })
    child.on('error', (err) => finish(err))
    child.on('close', (code) => {
      if (code === 0) finish()
      else finish(new Error(`命令失败 (exit ${code}): ${out.trim().slice(-800) || 'no output'}`))
    })
  })
}

export async function runDshPlugin(
  profile: string,
  pluginArgs: string[],
  deps: {
    runCommand?: typeof runCommand
    dshArgv?: typeof dshArgv
    profileDir?: string
    timeoutMs?: number
  } = {},
): Promise<string> {
  if (profile !== WEB_PROFILE) throw new Error('仅支持 web profile')
  const target = pluginArgs[pluginArgs.length - 1] ?? ''
  if (!isSafePluginTarget(target)) throw new Error(`拒绝不安全的安装目标: ${target}`)
  const argv = (deps.dshArgv ?? dshArgv)()
  const prepared = preparePluginArgs(deps.profileDir ?? webProfileDir(), pluginArgs)
  const tracker = beginProgress(target)
  const feed = makeProgressFeeder(tracker)
  const run = deps.runCommand ?? runCommand
  try {
    return await run(argv.file, [...argv.args, 'plugin', '--profile', profile, ...prepared], {
      cwd: argv.cwd,
      timeoutMs: deps.timeoutMs ?? installTimeoutMs(),
      env: { CI: 'true' },
      viaShell: argv.viaShell,
      detached: process.platform !== 'win32',
      onChunk: (text) => {
        feed(text)
        syncProgress(tracker)
      },
    })
  } catch (err) {
    // 失败/超时时也把原因写入状态端点，轮询侧能看到错误终态
    const text = err instanceof Error ? err.message : String(err)
    if (progress.error === null) progress.error = text.slice(0, 800)
    throw err
  } finally {
    progress.active = false
  }
}

/**
 * 安装。返回 usedAllowAllBuilds 供 UI 明确报告「该插件执行了构建脚本」。
 * source 形如：`pkg@1.2.3`（npm 精确锁定）或 `github:owner/repo#sha`（锁 SHA）。
 */
export async function addDshPlugin(
  source: string,
  deps: {
    runDshPlugin?: PluginRunner
    profileDir?: string
    allowAllBuilds?: (profileDirectory: string) => boolean
  } = {},
): Promise<{ output: string; usedAllowAllBuilds: boolean }> {
  const run = deps.runDshPlugin ?? runDshPlugin
  const allowAllBuilds = deps.allowAllBuilds ?? writeDangerouslyAllowAllBuilds
  const retryAfterPrepare = async (): Promise<{ output: string; usedAllowAllBuilds: boolean }> => {
    const changed = allowAllBuilds(deps.profileDir ?? webProfileDir())
    try {
      return { output: await run(WEB_PROFILE, ['add', source]), usedAllowAllBuilds: true }
    } catch (retryErr) {
      throw rewritePnpmError(retryErr)
    }
  }
  try {
    return { output: await run(WEB_PROFILE, ['add', source]), usedAllowAllBuilds: false }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    if (text.includes('ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF')) {
      await run(WEB_PROFILE, ['install', '--no-frozen-lockfile'])
      try {
        return { output: await run(WEB_PROFILE, ['add', source]), usedAllowAllBuilds: false }
      } catch (retryErr) {
        if (!isPrepareBlocked(retryErr instanceof Error ? retryErr.message : String(retryErr))) {
          throw rewritePnpmError(retryErr)
        }
        return retryAfterPrepare()
      }
    }
    if (!isPrepareBlocked(text)) throw rewritePnpmError(err)
    return retryAfterPrepare()
  }
}

/** 卸载（转发 pnpm remove；调用方须先做 live-disable）。 */
export async function removeDshPlugin(
  pkg: string,
  deps: { runDshPlugin?: PluginRunner } = {},
): Promise<string> {
  if (!isSafePluginTarget(pkg)) throw new Error(`无效插件包名: ${pkg}`)
  const run = deps.runDshPlugin ?? runDshPlugin
  return run(WEB_PROFILE, ['remove', pkg])
}
