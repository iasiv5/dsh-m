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

const TARGET_RE = /^[A-Za-z0-9@:./_#+-]+$/

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
      out = (out + chunk.toString()).slice(-256 * 1024)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      out = (out + chunk.toString()).slice(-256 * 1024)
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
  const prepared = pluginArgsFor(deps.profileDir ?? webProfileDir(), pluginArgs)
  const run = deps.runCommand ?? runCommand
  return run(argv.file, [...argv.args, 'plugin', '--profile', profile, ...prepared], {
    cwd: argv.cwd,
    timeoutMs: deps.timeoutMs ?? installTimeoutMs(),
    env: { CI: 'true' },
    viaShell: argv.viaShell,
    detached: process.platform !== 'win32',
  })
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
