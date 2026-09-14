/**
 * DSH 运行版本解析（市场面板头部 chip 数据源，2026-09-14 设计定稿）。
 *
 * 通路（查证结论，三条免费路径已证伪）：生产 host 内 dshArgv() 以 process.argv[1]
 * 定位 launcher entry（…/@deepseek-ai/dsh/lib/bin.js，restart.ts 拉起重启即复用同一
 * 定位），从 entry 向上至多三级找 package.json 读 version——官方 bin.js 的 readVersion
 * 同款做法。CLI/PATH 模式或读取失败回退 spawn `dsh --version`（短超时）。
 *
 * 结果进程内缓存（版本随进程恒定）；两级皆失败返回 null，客户端据此隐藏 chip。
 * 注意：`window.__DSH_BOOT__` 只有内容哈希 rev 无 semver；settings.yaml 无版本键；
 * .pnpm 目录名多版本残留无判据——均不走。
 */
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
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
    const entry = argv.args.length > 0 ? argv.args[argv.args.length - 1] : undefined
    // 与 dshArgv 同一判定：entry 必须长得像 launcher bin，否则是 CLI/PATH 模式
    if (!entry || !/[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) return null
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

/** 进程内缓存的一次性解析；null = 两级皆失败（调用方按「未知」处理）。 */
export function resolveDshVersion(opts: { fallbackTimeoutMs?: number } = {}): Promise<string | null> {
  if (!cache) {
    const direct = readLauncherPackageVersion()
    cache = direct != null ? Promise.resolve(direct) : spawnDshVersion(opts.fallbackTimeoutMs ?? 3_000)
  }
  return cache
}

/** 仅测试：清空进程内缓存。 */
export function resetDshVersionCacheForTest(): void {
  cache = null
}
