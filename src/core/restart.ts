/**
 * 自重启：优先使用 DSH launcher 提供的 appExit 生命周期钩子，把重启交给
 * systemd 等服务管理器的 Restart 策略；没有受管服务时再退回 detached helper。
 * 只有无法使用 appExit 且能从 cgroup 识别服务时，才通过 manager-owned transient
 * systemd-run 任务调用 systemctl 作为兼容兜底，避免 helper 留在待停止 unit cgroup。
 * 安全：restart 端点必须通过 trustedRestartRequest（Origin 与 Host 同源）。
 */
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dshArgv, nodeExecutable } from './dsh-cli.js'

function headerString(raw: string | string[] | undefined): string | undefined {
  if (raw === undefined) return undefined
  const value = Array.isArray(raw) ? raw[0] : raw
  const trimmed = String(value || '').trim()
  return trimmed === '' ? undefined : trimmed.split(',')[0]!.trim()
}

function parseHost(raw: string): { hostname: string; port: string } | null {
  try {
    const parsed = new URL(raw.includes('://') ? raw : `http://${raw}`)
    return { hostname: parsed.hostname.toLowerCase(), port: parsed.port }
  } catch {
    return null
  }
}

function isLoopbackHost(host: string): boolean {
  const parsed = parseHost(host)
  if (parsed === null) return false
  return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1'
}

function hostsMatch(originHost: string, candidate: string): boolean {
  const a = parseHost(originHost)
  const b = parseHost(candidate)
  if (a === null || b === null) return false
  if (a.hostname !== b.hostname) return false
  if (a.port !== '' && b.port !== '' && a.port !== b.port) return false
  return true
}

export function servingPort(request: Pick<IncomingMessage, 'headers'>): number | null {
  const host = headerString(request.headers.host)
  if (host === undefined || !isLoopbackHost(host)) return null
  const match = /:(\d{1,5})$/u.exec(host)
  if (match === null) return null
  const port = Number(match[1])
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

export function trustedRestartRequest(request: Pick<IncomingMessage, 'headers'>): boolean {
  const origin = headerString(request.headers.origin)
  if (origin === undefined) return false
  let from: string
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    from = parsed.host
  } catch {
    return false
  }
  const host = headerString(request.headers.host)
  const forwardedHost = headerString(request.headers['x-forwarded-host'])
  const candidates = [host, forwardedHost].filter((value): value is string => value !== undefined)
  return candidates.some((candidate) => hostsMatch(from, candidate))
}

export function readProcCgroup(
  readFile: (path: string, encoding: 'utf8') => string = (path, encoding) => readFileSync(path, encoding),
): string {
  try {
    return readFile('/proc/self/cgroup', 'utf8')
  } catch {
    return ''
  }
}

export function systemdUnitName(cgroupText: string): string | null {
  for (const line of cgroupText.split(/\r?\n/u)) {
    if (line.trim() === '') continue
    const path = line.includes(':') ? line.slice(line.lastIndexOf(':') + 1) : line
    const parts = path.split('/').filter(Boolean)
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i]!
      if (!part.endsWith('.service')) continue
      if (/^user@\d+\.service$/u.test(part)) continue
      return part
    }
  }
  return null
}

function shellQuote(part: string): string {
  return `'${part.replace(/'/g, "'\\''")}'`
}

/**
 * Build a transient systemd-run command for callers that do not have appExit.
 * The transient service is owned by the manager, not by the DSH unit that it
 * will restart, so KillMode=control-group cannot kill the restart command.
 */
export function systemdRestartArgv(opts: { cgroup: string; uid: number; pid?: number }): { file: string; args: string[] } | null {
  const unit = systemdUnitName(opts.cgroup)
  if (unit === null) return null
  const userManager = opts.cgroup.includes('/user.slice/')
  const targetArgs = userManager
    ? ['systemctl', '--user', 'restart', '--no-block', unit]
    : ['systemctl', 'restart', '--no-block', unit]
  const script = `sleep 0.2; exec ${targetArgs.map(shellQuote).join(' ')}`
  const transientArgs = [
    '--unit', `dshm-restart-${opts.pid ?? process.pid}-${Date.now()}.service`,
    '--collect', '--service-type=exec', '/bin/sh', '-c', script,
  ]
  if (userManager) return { file: 'systemd-run', args: ['--user', ...transientArgs] }
  if (opts.uid === 0) return { file: 'systemd-run', args: transientArgs }
  return { file: 'sudo', args: ['-n', 'systemd-run', ...transientArgs] }
}

export function restartLaunch(): { file: string; args: string[]; cwd: string; viaShell: boolean } {
  const launch = dshArgv()
  return {
    ...launch,
    args: [...launch.args, ...process.argv.slice(2)],
    cwd: launch.cwd ?? process.cwd(),
  }
}

function respawnInvocation(
  launch: { file: string; args: string[]; viaShell: boolean },
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[]; viaShell: boolean; detached: boolean } {
  if (platform !== 'win32') {
    return { file: launch.file, args: launch.args, viaShell: launch.viaShell, detached: true }
  }
  const quote = (part: string): string => `'${part.replace(/'/g, "''")}'`
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
      [`& ${quote(launch.file)}`, ...launch.args.map(quote)].join(' ')],
    viaShell: false,
    detached: false,
  }
}

export interface RestartResult {
  pid: number
  helperPid: number | undefined
  via: 'app-exit' | 'helper' | 'systemd'
}

/** DSH's launcher treats a non-zero appExit as a service-manager restart. */
export const MANAGED_RESTART_EXIT_CODE = 75
export type AppExit = (code: number) => void

export interface RestartPolicyFacts {
  restart: string
  successExitStatus: string
  restartPreventExitStatus: string
}

/**
 * Detect a process started by a service manager without depending on the unit
 * name or on a particular DSH release's cgroup layout.
 */
export function serviceManagedEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const present = (value: unknown): boolean => typeof value === 'string' && value.trim() !== ''
  return typeof env === 'object' && env !== null
    && (present(env.INVOCATION_ID) || present(env.NOTIFY_SOCKET))
}

function statusContainsExitCode(status: string, code: number): boolean {
  return String(status ?? '').split(/\s+/u).some((token) => token === String(code) || token === `STATUS=${code}`)
}

export function restartPolicyAllowsExit(policy: RestartPolicyFacts | null | undefined, code = MANAGED_RESTART_EXIT_CODE): boolean {
  if (policy === null || policy === undefined) return false
  if (policy.restart !== 'on-failure' && policy.restart !== 'always') return false
  if (statusContainsExitCode(policy.successExitStatus, code)) return false
  if (statusContainsExitCode(policy.restartPreventExitStatus, code)) return false
  return true
}

/** Query policy before voluntarily exiting; failure fails over to transient restart. */
export function readSystemdRestartPolicy(opts: { cgroup: string; uid: number }): RestartPolicyFacts | null {
  const unit = systemdUnitName(opts.cgroup)
  if (unit === null) return null
  const userManager = opts.cgroup.includes('/user.slice/')
  const file = userManager || opts.uid === 0 ? 'systemctl' : 'sudo'
  const args = userManager
    ? ['--user', 'show', '--value', '--property=Restart', '--property=SuccessExitStatus', '--property=RestartPreventExitStatus', unit]
    : opts.uid === 0
      ? ['show', '--value', '--property=Restart', '--property=SuccessExitStatus', '--property=RestartPreventExitStatus', unit]
      : ['-n', 'systemctl', 'show', '--value', '--property=Restart', '--property=SuccessExitStatus', '--property=RestartPreventExitStatus', unit]
  try {
    const output = execFileSync(file, args, {
      encoding: 'utf8',
      timeout: 1_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: process.env,
    })
    const [restart = '', successExitStatus = '', restartPreventExitStatus = ''] = String(output).split(/\r?\n/u)
    return { restart: restart.trim(), successExitStatus: successExitStatus.trim(), restartPreventExitStatus: restartPreventExitStatus.trim() }
  } catch {
    return null
  }
}

function reportRestartError(scope: string, error: unknown): void {
  try {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[dsh-m] ${scope} failed: ${message}\n`)
  } catch {
    /* stderr may already be closed while the host is shutting down */
  }
}

/** Read the optional launcher hook without coupling core code to Cordis types. */
export function appExitFromContext(context: unknown): AppExit | undefined {
  const getter = (context as { get?: unknown } | null | undefined)?.get
  if (typeof getter !== 'function') return undefined
  try {
    const candidate = getter.call(context, 'appExit')
    return typeof candidate === 'function' ? candidate as AppExit : undefined
  } catch {
    return undefined
  }
}

function restartHelperSource(
  spawned: { file: string; args: string[]; viaShell: boolean; detached: boolean },
  launch: { cwd: string },
  logs: { out: string; err: string },
  port: number | null,
): string {
  return [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    "const net = require('node:net')",
    `const file = ${JSON.stringify(spawned.file)}`,
    `const args = ${JSON.stringify(spawned.args)}`,
    `const cwd = ${JSON.stringify(launch.cwd)}`,
    `const viaShell = ${JSON.stringify(spawned.viaShell)}`,
    `const detached = ${JSON.stringify(spawned.detached)}`,
    `const logOut = ${JSON.stringify(logs.out)}`,
    `const logErr = ${JSON.stringify(logs.err)}`,
    `const port = ${JSON.stringify(port)}`,
    'const sleep = (ms) => new Promise(r => setTimeout(r, ms))',
    "const note = (line) => { try { fs.appendFileSync(logErr, `[dsh-m] ${line}\\n`) } catch {} }",
    'const listening = () => new Promise((resolve) => {',
    '  const probe = net.connect({ host: "127.0.0.1", port })',
    '  const done = (value) => { probe.destroy(); resolve(value) }',
    '  probe.on("connect", () => done(true))',
    '  probe.on("error", () => done(false))',
    '  setTimeout(() => done(false), 500)',
    '})',
    'const main = async () => {',
    '  if (port) {',
    '    const until = Date.now() + 30000',
    '    while (Date.now() < until && await listening()) await sleep(250)',
    '    if (await listening()) note(`port ${port} was still in use after 30s; starting anyway`)',
    '    await sleep(300)',
    '  } else {',
    '    await sleep(1500)',
    '  }',
    "  let child",
    '  try {',
    '    const out = fs.openSync(logOut, "a")',
    '    const err = fs.openSync(logErr, "a")',
    '    child = spawn(file, args, { cwd, detached, stdio: ["ignore", out, err], env: process.env, shell: viaShell })',
    '    child.on("error", (error) => note(`could not start the replacement: ${error && error.message ? error.message : error}`))',
    '    child.unref()',
    '  } catch (error) {',
    '    note(`could not start the replacement: ${error && error.message ? error.message : error}`)',
    '    return',
    '  }',
    '  if (!port) { await sleep(3000); return }',
    '  const upBy = Date.now() + 20000',
    '  while (Date.now() < upBy && !(await listening())) await sleep(500)',
    '  if (!(await listening())) note(`the replacement did not bind port ${port} within 20s — see the output log beside this one`)',
    '}',
    'main()',
  ].join('\n')
}

export function scheduleRestart(
  port: number | null = null,
  deps: {
    spawn?: typeof spawn
    nodeExecutable?: typeof nodeExecutable
    restartLaunch?: typeof restartLaunch
    kill?: typeof process.kill
    setTimeout?: typeof setTimeout
    pid?: number
    cgroup?: string
    uid?: number
    /** DSH launcher lifecycle hook, available in both 0.1.2-rc.1 and 0.1.5-rc.1. */
    appExit?: AppExit
    /** Injectable environment for deterministic tests. */
    env?: NodeJS.ProcessEnv
    /** Injectable systemd policy facts; omitted in production and queried when needed. */
    restartPolicy?: RestartPolicyFacts | null
  } = {},
): RestartResult {
  const pid = deps.pid ?? process.pid
  const cgroup = deps.cgroup ?? readProcCgroup()
  const uid = deps.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 1)
  const systemd = systemdRestartArgv({ cgroup, uid, pid })
  const managed = typeof deps.appExit === 'function' && serviceManagedEnv(deps.env ?? process.env)
  const policy = deps.restartPolicy ?? (managed && systemd !== null ? readSystemdRestartPolicy({ cgroup, uid }) : null)
  if (managed && (systemd === null || restartPolicyAllowsExit(policy))) {
    const timer = (deps.setTimeout ?? setTimeout)(() => deps.appExit!(MANAGED_RESTART_EXIT_CODE), 150)
    timer.unref?.()
    return { pid, helperPid: undefined, via: 'app-exit' }
  }
  if (systemd !== null) {
    ;(deps.setTimeout ?? setTimeout)(() => {
      try {
        const helper = (deps.spawn ?? spawn)(systemd.file, systemd.args, {
          detached: true,
          stdio: 'ignore',
          env: process.env,
        })
        helper.once?.('error', (error) => reportRestartError('transient restart helper', error))
        helper.once?.('exit', (code, signal) => {
          if (code !== 0) reportRestartError('transient restart helper', `exit=${code ?? 'null'} signal=${signal ?? 'none'}`)
        })
        helper.unref()
      } catch (error) {
        reportRestartError('transient restart helper', error)
      }
    }, 500)
    return { pid, helperPid: undefined, via: 'systemd' }
  }
  const launch = (deps.restartLaunch ?? restartLaunch)()
  const spawned = respawnInvocation(launch)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logOut = join(tmpdir(), `dshm-restart-${stamp}.out.log`)
  const logErr = join(tmpdir(), `dshm-restart-${stamp}.err.log`)
  let helper
  try {
    helper = (deps.spawn ?? spawn)(
      (deps.nodeExecutable ?? nodeExecutable)(),
      ['-e', restartHelperSource(spawned, launch, { out: logOut, err: logErr }, port)],
      {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      },
    )
    helper.once?.('error', (error) => reportRestartError('detached restart helper', error))
  } catch (error) {
    // Do not terminate the live host if the replacement could not be started.
    reportRestartError('detached restart helper', error)
    return { pid, helperPid: undefined, via: 'helper' }
  }
  helper.unref()
  ;(deps.setTimeout ?? setTimeout)(() => {
    try {
      ;(deps.kill ?? process.kill)(pid, 'SIGTERM')
    } catch (error) {
      reportRestartError('detached host shutdown', error)
    }
  }, 500)
  return { pid, helperPid: helper.pid, via: 'helper' }
}
