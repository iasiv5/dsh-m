/**
 * DSH 运行版本解析（市场面板头部 chip 数据源，2026-09-14 设计定稿；issue #32 三通路重排）。
 *
 * 通路顺序（issue #32）：① readAppAsarVersion()——桌面（Electron）主判据，读 app.asar
 * 内嵌 package.json（纯同步 FS）；② readLauncherPackageVersion()——生产 host/CLI 内
 * dshArgv() 以 process.argv[1] 定位 launcher entry（…/@deepseek-ai/dsh/lib/bin.js，
 * restart.ts 拉起重启即复用同一定位），从 entry 向上至多三级找 package.json 读 version
 * （官方 bin.js 的 readVersion 同款做法）；③ spawn `dsh --version`（短超时）——**仅非
 * Electron 进程采信**：PATH 上全局 CLI 的版本不受应用控制（残留旧 CLI 曾致桌面 peer
 * 预检全数误拦），桌面（process.versions.electron 存在）内整体禁用，宁可达不成、不可错。
 *
 * 结果进程内缓存（版本随进程恒定）；全失败返回 null，客户端据此隐藏 chip、peer 预检按
 * 「未检不拦」放行。注意：`window.__DSH_BOOT__` 只有内容哈希 rev 无 semver；settings.yaml
 * 无版本键；.pnpm 目录名多版本残留无判据——均不走。
 */
import { dirname, join } from 'node:path'
import { closeSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dshArgv } from './dsh-cli.js'

/** 从 `dsh --version` 输出提取 semver：容忍 v 前缀与前后散文，取首个命中。 */
export function parseDshVersionOutput(text: string): string | null {
  const m = /\bv?([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/.exec(text ?? '')
  return m ? m[1] : null
}

/**
 * 生产通路：launcher entry 定位 + 就近向上找 package.json。
 * 纯同步、无 spawn；任何一步失败返回 null（不抛）。
 */
export function readLauncherPackageVersion(input: Parameters<typeof dshArgv>[0] = {}): string | null {
  try {
    const argv = dshArgv(input)
    let entry = argv.args.length > 0 ? argv.args[argv.args.length - 1] : undefined
    // 与 dshArgv 同一判定：entry 必须长得像 launcher bin，否则是 CLI/PATH 模式
    if (!entry || !/[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) return null
    // F1（0.9.29 装机验收实证）：pnpm 全局 shim（如 PNPM_HOME/dsh）是指向真实 bin.js
    // 的符号链接——realpath 后再向上找 package.json，否则会在 pnpm home 目录树上
    // 空走三级，宿主内纯 FS 解析落空（ping chip 被迫吃 spawn 回退）。
    entry = realpathSync(entry)
    let dir = dirname(entry)
    for (let up = 0; up < 3; up++) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: unknown }
        if (typeof pkg?.version === 'string' && pkg.version) return pkg.version
      } catch {
        /* 该级无 package.json / 不可读，继续向上一级 */
      }
      dir = dirname(dir)
    }
    return null
  } catch {
    return null
  }
}

function spawnDshVersion(timeoutMs: number): Promise<string | null> {
  return new Promise((resolveP) => {
    let settled = false
    const done = (v: string | null): void => {
      if (!settled) {
        settled = true
        resolveP(v)
      }
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('dsh', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' })
    } catch {
      done(null)
      return
    }
    let out = ''
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already dead */
      }
      done(null)
    }, timeoutMs)
    child.stdout?.on('data', (d: Buffer) => {
      out += String(d)
    })
    child.on('error', () => {
      clearTimeout(timer)
      done(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      done(parseDshVersionOutput(out))
    })
  })
}

let cache: Promise<string | null> | null = null

export interface ResolveDshVersionDeps {
  readAsar?: () => string | null
  readLauncher?: () => string | null
  spawnVersion?: (timeoutMs: number) => Promise<string | null>
  isElectron?: boolean
  fallbackTimeoutMs?: number
}

/**
 * 可注入编排（issue #32）：asar → launcher →（仅非 Electron）spawn。
 * 测试桩经 deps 注入；生产路径（resolveDshVersion）用默认 deps。
 */
export async function resolveDshVersionWith(deps: ResolveDshVersionDeps = {}): Promise<string | null> {
  const versions = process.versions as typeof process.versions & { electron?: string }
  const isElectron = deps.isElectron ?? versions.electron != null
  const readAsar = deps.readAsar ?? ((): string | null => readAppAsarVersion())
  const readLauncher = deps.readLauncher ?? ((): string | null => readLauncherPackageVersion())
  const spawnVersion = deps.spawnVersion ?? spawnDshVersion
  const asarV = readAsar()
  if (asarV != null && asarV !== '') return asarV
  const launcherV = readLauncher()
  if (launcherV != null && launcherV !== '') return launcherV
  if (isElectron) return null // 桌面：PATH 来源不受控，宁可达不成、不可错（issue #32）
  return spawnVersion(deps.fallbackTimeoutMs ?? 3_000)
}

/**
 * 进程内缓存的一次性解析；null = 三级皆失败（调用方按「未知」处理）。
 * opts.deps 为测试缝（PrecheckOptions 同款先例，评审 S3 备案随版落地）：缺省零行为差异，
 * 生产调用方不传；memo 契约 = 每进程恰一次解析（宿主预热 dshVersionP 与三处预检共享）。
 */
export function resolveDshVersion(opts: { fallbackTimeoutMs?: number; deps?: ResolveDshVersionDeps } = {}): Promise<string | null> {
  if (!cache) {
    // 超时优先级（评审 P3 修复）：显式 opts > deps 测试缝 > 编排层默认 3000
    cache = resolveDshVersionWith({ ...(opts.deps ?? {}), fallbackTimeoutMs: opts.fallbackTimeoutMs ?? opts.deps?.fallbackTimeoutMs })
  }
  return cache
}

/** 仅测试：清空进程内缓存。 */
export function resetDshVersionCacheForTest(): void {
  cache = null
}

// --- 桌面 app.asar 通路（issue #32：Electron 内 argv[1] 非 launcher entry、PATH 版本不受控） ---

const ASAR_NAME_RE = /^@deepseek-ai\/dsh(?:-[a-z0-9-]+)?$/ // 精确形态（评审 P1 收紧）：dsh 或 dsh-后缀，拒近形名（dshx 等）
const ASAR_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/ // 严格 semver（评审 P2 收紧）：semver.org 官方正则，拒前导零
const ASAR_HEADER_JSON_MAX = 32 * 1024 * 1024
const ASAR_PKG_MAX = 1024 * 1024

/**
 * 单个 asar 的解析：pickle 头（@0 u32=4、@4 headerSize、@8 headerSize-4、@12 jsonLen、@16…JSON，
 * 内容区起点 = 8 + headerSize）→ 头 JSON 定位 files["package.json"]（size/offset 为字符串）→
 * 按 offset 读实体 package.json → name 前缀 + semver + 越界守卫。任一步失败静默 null（不抛）。
 */
function readAsarPackageVersionAt(asarPath: string): string | null {
  let fd: number | null = null
  try {
    fd = openSync(asarPath, 'r')
    const head = Buffer.alloc(16)
    if (readSync(fd, head, 0, 16, 0) !== 16) return null
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
    if (dv.getUint32(0, true) !== 4) return null
    const headerSize = dv.getUint32(4, true)
    const payloadSize = dv.getUint32(8, true)
    const jsonLen = dv.getUint32(12, true)
    if (headerSize < 4 || headerSize - 4 !== payloadSize) return null
    if (jsonLen === 0 || jsonLen > payloadSize || jsonLen > ASAR_HEADER_JSON_MAX) return null
    const jsonBuf = Buffer.alloc(jsonLen)
    if (readSync(fd, jsonBuf, 0, jsonLen, 16) !== jsonLen) return null
    const header: unknown = JSON.parse(jsonBuf.toString('utf8'))
    const files = (header as { files?: unknown } | null)?.files
    const entry = (files as Record<string, { size?: unknown; offset?: unknown } | undefined> | undefined)?.['package.json']
    if (!entry) return null
    const pkgOffset = Number(entry.offset)
    const pkgSize = Number(entry.size)
    if (!Number.isSafeInteger(pkgOffset) || pkgOffset < 0) return null
    if (!Number.isSafeInteger(pkgSize) || pkgSize < 2 || pkgSize > ASAR_PKG_MAX) return null
    const pkgBuf = Buffer.alloc(pkgSize)
    if (readSync(fd, pkgBuf, 0, pkgSize, 8 + headerSize + pkgOffset) !== pkgSize) return null
    const pkg: unknown = JSON.parse(pkgBuf.toString('utf8'))
    const name = (pkg as { name?: unknown } | null)?.name
    const version = (pkg as { version?: unknown } | null)?.version
    if (typeof name !== 'string' || !ASAR_NAME_RE.test(name)) return null
    if (typeof version !== 'string' || !ASAR_VERSION_RE.test(version)) return null
    return version
  } catch {
    return null
  } finally {
    if (fd !== null) { try { closeSync(fd) } catch { /* already closed */ } }
  }
}

export interface AppAsarVersionDeps { resourcesPath?: string | undefined; execPath?: string }

/**
 * 应用自身版本（issue #32 通路 0）：读 DSH Desktop 的 app.asar 内嵌 package.json。
 * 候选 resourcesPath/app.asar → dirname(execPath)/resources/app.asar，任一命中即返回；
 * 全部失败（含非 Electron 下候选不存在）返回 null。纯同步 FS，无进程派生。
 */
export function readAppAsarVersion(deps: AppAsarVersionDeps = {}): string | null {
  try {
    const proc = process as unknown as { resourcesPath?: string }
    const resources = deps.resourcesPath !== undefined ? deps.resourcesPath : proc.resourcesPath
    const candidates: string[] = []
    if (resources) candidates.push(join(resources, 'app.asar'))
    candidates.push(join(dirname(deps.execPath ?? process.execPath), 'resources', 'app.asar'))
    for (const candidate of candidates) {
      const v = readAsarPackageVersionAt(candidate) // 缺文件 ENOENT → null，继续下一候选
      if (v != null) return v
    }
    return null
  } catch {
    return null
  }
}
