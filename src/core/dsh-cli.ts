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

export type PluginRunner = (
  profile: string,
  pluginArgs: string[],
  options?: { signal?: AbortSignal },
) => Promise<string>

// ---------- pnpm 结果六类分类（Task 1：分类先于任何文案改写） ----------

export type PnpmOutcomeClass =
  | 'ok' | 'retryable-lag' | 'config-drift' | 'unused-patch' | 'needs-builds' | 'hard-fail'

export const PNPM_OUTCOME_CODES = {
  CONFIG_MISMATCH: 'ERR_PNPM_LOCKFILE_CONFIG_MISMATCH',
  OUTDATED_LOCKFILE: 'ERR_PNPM_OUTDATED_LOCKFILE',
  NO_MATCHING_VERSION: 'ERR_PNPM_NO_MATCHING_VERSION',
  UNUSED_PATCH: 'ERR_PNPM_UNUSED_PATCH',
  PUBLIC_HOIST_PATTERN_DIFF: 'ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF',
} as const

export interface RunnerOutcome {
  readonly class: PnpmOutcomeClass
  /** 已知决策 code 取 PNPM_OUTCOME_CODES 的值；hard-fail 可保留其他 ERR_PNPM_* 诊断码 */
  readonly code?: string
  /** ≤800 字符（runner 边界统一截断） */
  readonly output: string
  /** 仅 add·ok */
  readonly usedAllowAllBuilds?: boolean
}

/**
 * 对 pnpm/dsh 原始输出文本做六类归一解释。分类发生在任何文案改写之前；
 * 上层（事务/market）只消费 class + code 常量，永不 regex 原始输出。
 */
export function classifyPnpmError(text: string): { class: PnpmOutcomeClass; code?: string } {
  const raw = String(text ?? '')
  if (raw.includes(PNPM_OUTCOME_CODES.NO_MATCHING_VERSION)) {
    return { class: 'retryable-lag', code: PNPM_OUTCOME_CODES.NO_MATCHING_VERSION }
  }
  if (raw.includes(PNPM_OUTCOME_CODES.CONFIG_MISMATCH)) {
    return { class: 'config-drift', code: PNPM_OUTCOME_CODES.CONFIG_MISMATCH }
  }
  if (raw.includes(PNPM_OUTCOME_CODES.OUTDATED_LOCKFILE)) {
    return { class: 'config-drift', code: PNPM_OUTCOME_CODES.OUTDATED_LOCKFILE }
  }
  if (raw.includes(PNPM_OUTCOME_CODES.UNUSED_PATCH)) {
    return { class: 'unused-patch', code: PNPM_OUTCOME_CODES.UNUSED_PATCH }
  }
  if (isPrepareBlocked(raw)) return { class: 'needs-builds' }
  const m = /(ERR_PNPM_[A-Z0-9_]+)/.exec(raw)
  return { class: 'hard-fail', code: m?.[1] }
}

/** 统一的命令取消错误形态（runCommand 调用前已取消与运行中取消同款）。 */
function commandAbortError(): Error {
  const err = new Error('命令已取消')
  err.name = 'AbortError'
  return err
}

function truncateOutput(text: string): string {
  const raw = String(text ?? '')
  return raw.length <= 800 ? raw : raw.slice(-800)
}

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
  /** 停止子进程时 SIGTERM→SIGKILL 的升级宽限（毫秒）；默认 5000 */
  killGraceMs?: number
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

/**
 * 失败摘要：命令失败时从完整输出里提取可诊断的行，而不是盲取末尾。
 * 2026-09-05 实证（dsh-better-sidebar 安装失败）：pnpm ndjson 错误行 ~1.2KB，
 * 错误码/信息/hint 在行首，尾截 800 只剩纯栈帧——`ERR_PNPM_IGNORED_BUILDS`
 * 与 `node-pty` 关键字全部丢失，isPrepareBlocked 匹配不到，
 * dangerouslyAllowAllBuilds 自愈重试从未触发，用户只看到一屏栈。
 * 优先级：ndjson 错误行（code — message — hint）→ 含 ERR_ 码的行 + 尾部 → 纯尾部。
 */
export function errorDigest(out: string, maxChars = 800): string {
  const text = out.trim()
  if (text === '') return ''
  if (text.length <= maxChars) return text
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!line.startsWith('{') || !line.includes('"level":"error"')) continue
    try {
      const doc = JSON.parse(line) as {
        code?: unknown
        hint?: unknown
        err?: { message?: unknown; code?: unknown }
      }
      const code = typeof doc.code === 'string' && doc.code !== '' ? doc.code
        : typeof doc.err?.code === 'string' ? doc.err.code : null
      const message = typeof doc.err?.message === 'string' ? doc.err.message : null
      const hint = typeof doc.hint === 'string' ? doc.hint : null
      const parts = [code, message, hint].filter((p): p is string => p !== null && p !== '')
      if (parts.length > 0) return parts.join(' — ')
    } catch {
      /* 非 JSON 行，继续向前找 */
    }
  }
  const errCodeLines = lines.filter((l) => /ERR_[A-Z0-9_]+/.test(l)).slice(-5)
  if (errCodeLines.length > 0) {
    const digest = [...errCodeLines, text.slice(-maxChars)].join('\n').slice(-maxChars * 2)
    return digest
  }
  return text.slice(-maxChars)
}

/** 停止宽限缺省（毫秒）；可用 DSH_KILL_GRACE_MS 覆盖（测试/平台调节）。 */
function killGraceDefault(): number {
  return Number(process.env.DSH_KILL_GRACE_MS) || 5_000
}

/** SIGKILL 后组存活轮询的硬上限（毫秒）：防 D 态进程导致永不 settle。 */
const GROUP_POLL_CAP_MS = 10_000

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    // R4a（终审复审）：AbortSignal 的事件不会对后注册的 listener 重放——调用前已取消的
    // signal 必须在 spawn 前拒绝，否则命令会完整执行副作用。检查与 listener 注册之间为
    // 同步代码，无交织窗口。
    if (options.signal?.aborted) {
      reject(commandAbortError())
      return
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: options.viaShell === true,
      detached: options.detached === true && process.platform !== 'win32',
    } satisfies SpawnOptions)
    let out = ''
    let settled = false
    let stopping = false
    let pendingError: Error | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let pollDeadline = 0
    // 组语义仅 POSIX + detached（child 是组长）才成立；Windows/非 detached 只保证 direct child
    const groupSupported = process.platform !== 'win32' && child.pid !== undefined
    const groupAlive = (): boolean => {
      if (!groupSupported) return false
      try {
        process.kill(-child.pid!, 0)
        return true
      } catch (err) {
        // ESRCH = 组不存在；EPERM 等保守视为仍存活
        return (err as NodeJS.ErrnoException).code !== 'ESRCH'
      }
    }
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      if (pollTimer !== undefined) clearTimeout(pollTimer)
      options.signal?.removeEventListener('abort', onAbort)
      if (err) reject(err)
      else resolvePromise(out)
    }
    const signalGroup = (sig: NodeJS.Signals) => {
      if (groupSupported) {
        try {
          process.kill(-child.pid!, sig)
          return
        } catch {
          /* fall through：组可能已消失 */
        }
      }
      try {
        child.kill(sig)
      } catch {
        /* already gone */
      }
    }
    const pollGroupGone = (): void => {
      if (settled) return
      // SIGKILL 已发：组消失（或超过轮询硬上限，防 D 态进程）才 settle
      if (!groupAlive() || Date.now() > pollDeadline) {
        finish(pendingError)
        return
      }
      pollTimer = setTimeout(pollGroupGone, 25)
    }
    /**
     * F1-R（第三轮复审）：停止协议以「进程组不存在」为 settle 前提——SIGTERM 进程组 →
     * 宽限后 SIGKILL → 轮询确认组消失。direct child 提前 close 不清除 kill 定时器
     * （同组后代可能仍忽略 SIGTERM 并写 profile）。
     */
    const stopChild = (err: Error) => {
      if (settled || stopping) return
      stopping = true
      pendingError = err
      signalGroup('SIGTERM')
      killTimer = setTimeout(() => {
        signalGroup('SIGKILL')
        pollDeadline = Date.now() + GROUP_POLL_CAP_MS
        pollGroupGone()
      }, Math.max(0, options.killGraceMs ?? killGraceDefault()))
    }
    const timer = setTimeout(() => {
      stopChild(new Error(`命令超时 ${options.timeoutMs}ms`))
    }, options.timeoutMs)
    const onAbort = () => {
      stopChild(commandAbortError())
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
    child.on('error', (err) => {
      // F1-R：停止协议进行中，迟到的 error（如 kill 竞态）只作诊断，不得提前收口
      if (stopping) return
      finish(err)
    })
    child.on('close', (code) => {
      if (stopping) {
        // direct child close ≠ 进程组停止：组仍存活 → 保留 SIGKILL 定时器/轮询，不 settle
        if (groupAlive()) return
        finish(pendingError)
        return
      }
      if (code === 0) finish()
      else finish(new Error(`命令失败 (exit ${code}): ${errorDigest(out) || 'no output'}`))
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
    signal?: AbortSignal
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
      signal: deps.signal,
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
 * 加装阶梯工厂（导出、可注入、可测试；生产与测试共用同一实现）。
 * 阶梯：add → prepare 被拦时写 dangerouslyAllowAllBuilds 重试 →
 * PUBLIC_HOIST_PATTERN_DIFF 时 `install --no-frozen-lockfile` 重建后重试 →
 * 耗尽归类返回。对**原始错误文本**分类；永不 throw，一律返回 RunnerOutcome。
 */
export function makeAddViaLadder(deps: {
  runDshPlugin: PluginRunner
  allowAllBuilds?: (profileDirectory: string) => boolean
}): (source: string, profileDir: string, signal?: AbortSignal) => Promise<RunnerOutcome> {
  const run = deps.runDshPlugin
  const allowAllBuilds = deps.allowAllBuilds ?? writeDangerouslyAllowAllBuilds
  const opts = (signal?: AbortSignal) => (signal !== undefined ? { signal } : undefined)
  return async (source: string, profileDir: string, signal?: AbortSignal): Promise<RunnerOutcome> => {
    const retryAfterPrepare = async (): Promise<RunnerOutcome> => {
      // Y2（终审复审）：allowAll 写入本身失败也必须转换为结果，维持「永不 throw」契约
      try {
        allowAllBuilds(profileDir)
      } catch (err) {
        const text = errText(err)
        return { class: 'hard-fail', output: truncateOutput(text) }
      }
      try {
        const output = await run(WEB_PROFILE, ['add', source], opts(signal))
        return { class: 'ok', output: truncateOutput(output), usedAllowAllBuilds: true }
      } catch (retryErr) {
        return { ...classifyPnpmError(errText(retryErr)), output: truncateOutput(errText(retryErr)) }
      }
    }
    try {
      const output = await run(WEB_PROFILE, ['add', source], opts(signal))
      return { class: 'ok', output: truncateOutput(output), usedAllowAllBuilds: false }
    } catch (err) {
      const text = errText(err)
      if (text.includes(PNPM_OUTCOME_CODES.PUBLIC_HOIST_PATTERN_DIFF)) {
        try {
          await run(WEB_PROFILE, ['install', '--no-frozen-lockfile'], opts(signal))
        } catch (rebuildErr) {
          const rebuildText = errText(rebuildErr)
          return { ...classifyPnpmError(rebuildText), output: truncateOutput(rebuildText) }
        }
        try {
          const output = await run(WEB_PROFILE, ['add', source], opts(signal))
          return { class: 'ok', output: truncateOutput(output), usedAllowAllBuilds: false }
        } catch (retryErr) {
          const retryText = errText(retryErr)
          if (isPrepareBlocked(retryText)) return retryAfterPrepare()
          return { ...classifyPnpmError(retryText), output: truncateOutput(retryText) }
        }
      }
      if (!isPrepareBlocked(text)) {
        return { ...classifyPnpmError(text), output: truncateOutput(text) }
      }
      return retryAfterPrepare()
    }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 安装。返回 usedAllowAllBuilds 供 UI 明确报告「该插件执行了构建脚本」。
 * source 形如：`pkg@1.2.3`（npm 精确锁定）或 `github:owner/repo#sha`（锁 SHA）。
 * 薄包装：调 makeAddViaLadder，非 ok 时 throw（对 legacy 调用方保持现行报错形状）。
 */
export async function addDshPlugin(
  source: string,
  deps: {
    runDshPlugin?: PluginRunner
    profileDir?: string
    allowAllBuilds?: (profileDirectory: string) => boolean
  } = {},
): Promise<{ output: string; usedAllowAllBuilds: boolean }> {
  const ladder = makeAddViaLadder({
    runDshPlugin: deps.runDshPlugin ?? runDshPlugin,
    allowAllBuilds: deps.allowAllBuilds,
  })
  const outcome = await ladder(source, deps.profileDir ?? webProfileDir())
  if (outcome.class === 'ok') {
    return { output: outcome.output, usedAllowAllBuilds: outcome.usedAllowAllBuilds === true }
  }
  throw rewritePnpmError(new Error(outcome.output))
}

/** 卸载（转发 pnpm remove；调用方须先做 live-disable）。 */
export async function removeDshPlugin(
  pkg: string,
  deps: { runDshPlugin?: PluginRunner; profileDir?: string; signal?: AbortSignal } = {},
): Promise<string> {
  if (!isSafePluginTarget(pkg)) throw new Error(`无效插件包名: ${pkg}`)
  const run = deps.runDshPlugin ?? runDshPlugin
  return run(
    WEB_PROFILE,
    ['remove', pkg],
    deps.profileDir !== undefined || deps.signal !== undefined
      ? { profileDir: deps.profileDir, signal: deps.signal }
      : undefined,
  )
}

// ---------- PnpmRunner 生产适配器（Task 2） ----------

/** 事务模块消费的四个 pnpm 操作；一律返回 RunnerOutcome，永不 throw。 */
export interface PnpmRunner {
  add(spec: string, signal?: AbortSignal): Promise<RunnerOutcome>
  remove(pkg: string, signal?: AbortSignal): Promise<RunnerOutcome>
  frozenInstall(signal?: AbortSignal): Promise<RunnerOutcome>
  rebuildInstall(signal?: AbortSignal): Promise<RunnerOutcome>
}

function rawOutcome(text: string): RunnerOutcome {
  const out = String(text ?? '')
  return { ...classifyPnpmError(out), output: out.length <= 800 ? out : out.slice(-800) }
}

/**
 * 生产 runner：add 走 makeAddViaLadder（prepare/hoist 在途自愈在 adapter 内耗尽）；
 * remove 包 removeDshPlugin（原始文本分类）；frozen/rebuild 直接 spawn pnpm。
 * 四操作统一收 signal；output 截 800。
 */
export function makeDshRunner(profileDir: string): PnpmRunner {
  const ladder = makeAddViaLadder({ runDshPlugin })
  return {
    async add(spec: string, signal?: AbortSignal): Promise<RunnerOutcome> {
      return ladder(spec, profileDir, signal)
    },
    async remove(pkg: string, signal?: AbortSignal): Promise<RunnerOutcome> {
      try {
        const output = await removeDshPlugin(pkg, { profileDir, signal })
        return { class: 'ok', output: output.length <= 800 ? output : output.slice(-800) }
      } catch (err) {
        return rawOutcome(errText(err))
      }
    },
    async frozenInstall(signal?: AbortSignal): Promise<RunnerOutcome> {
      try {
        // F1-R：detached 使 pnpm（及其后代）进入独立进程组，abort/超时可整组终止
        const output = await runCommand('pnpm', ['--dir', profileDir, 'install', '--frozen-lockfile'], {
          timeoutMs: installTimeoutMs(),
          signal,
          detached: process.platform !== 'win32',
        })
        return { class: 'ok', output: output.length <= 800 ? output : output.slice(-800) }
      } catch (err) {
        return rawOutcome(errText(err))
      }
    },
    async rebuildInstall(signal?: AbortSignal): Promise<RunnerOutcome> {
      try {
        const output = await runCommand('pnpm', ['--dir', profileDir, 'install', '--no-frozen-lockfile'], {
          timeoutMs: installTimeoutMs(),
          signal,
          detached: process.platform !== 'win32',
        })
        return { class: 'ok', output: output.length <= 800 ? output : output.slice(-800) }
      } catch (err) {
        return rawOutcome(errText(err))
      }
    },
  }
}
