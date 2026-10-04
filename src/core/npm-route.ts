/**
 * L1/L2（ADR-0012）：npm registry 路由自适应。
 * 候选 = `DSHM_NPM_REGISTRY` env（最高优先，设了跳过探测）> [.npmrc registry, npmjs, npmmirror] 去重；
 * probe-once（Promise.any 探 `semver/latest`，2.5s 共享预算，胜者须合法 JSON 带 version）+ single-flight；
 * 决策持久化 `<cacheDir()>/npm-route.json`；**全候选失败仅内存回退 npmjs（TTL 60s 过期重探，不落盘）**——
 * 对官方 region-probe「持久化回退值」立场的显式偏离：GUI 长驻进程里坏决策不可见、恢复口不可发现。
 * sync 原语：npmmirror 按需同步（know-how 020 §2.2/§3.1），`DSHM_MIRROR_SYNC=0` 全关。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { cacheDir } from './env.js'
import { fetchJsonLimited, fetchLimited } from './httpx.js'

export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org'
export const NPM_MIRROR = 'https://registry.npmmirror.com'

const PROBE_BUDGET_MS = 2_500
const FALLBACK_TTL_MS = 60_000
const DECISION_FILE = 'npm-route.json'

/** 用户级 .npmrc 顶层 `registry=` 键（ini-lite；scope 键 v1 忽略；缺失/损坏 = null）。 */
export function readNpmrcRegistry(path: string = join(homedir(), '.npmrc')): string | null {
  try {
    const text = readFileSync(path, 'utf8')
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (line === '' || line.startsWith('#') || line.startsWith(';')) continue
      const m = /^registry\s*=\s*(.+)$/.exec(line)
      if (m) {
        const base = m[1].trim().replace(/\/+$/, '')
        return base === '' ? null : base
      }
    }
  } catch {
    // 文件缺失/不可读 = 无 .npmrc 源
  }
  return null
}

/** 候选源（env 直采时恒单元素；否则 .npmrc 优先、官方源与镜像兜底，去重保序）。 */
export function candidates(): string[] {
  const override = process.env.DSHM_NPM_REGISTRY?.trim()
  if (override) return [override]
  const out: string[] = []
  for (const c of [readNpmrcRegistry(), DEFAULT_NPM_REGISTRY, NPM_MIRROR]) {
    if (c && !out.includes(c)) out.push(c)
  }
  return out
}

type Listener = (base: string) => void
const listeners: Listener[] = []

export function onRouteSwitch(fn: Listener): void {
  listeners.push(fn)
}

/** 生效值变化才广播（含首次决议；listener 异常不阻断路由）。 */
let effective: string | null = null
function setEffective(base: string): void {
  if (effective === base) return
  effective = base
  for (const fn of listeners) {
    try {
      fn(base)
    } catch {
      // listener 自身问题不阻断
    }
  }
}

interface DecisionFile {
  base: string
  decidedAt: string
  candidates: string[]
}

function decisionPath(): string {
  return join(cacheDir(), DECISION_FILE)
}

function readDecisionFile(): string | null {
  try {
    const doc = JSON.parse(readFileSync(decisionPath(), 'utf8')) as Partial<DecisionFile>
    if (typeof doc.base === 'string' && /^https?:\/\//.test(doc.base)) return doc.base.replace(/\/+$/, '')
  } catch {
    // 缺失/损坏 = 无决策（下次重探）
  }
  return null
}

async function writeDecisionFile(base: string, cands: string[]): Promise<void> {
  try {
    const doc: DecisionFile = { base, decidedAt: new Date().toISOString(), candidates: cands }
    await writeFileAtomic(decisionPath(), JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 })
  } catch {
    // 落盘失败不影响本次生效（内存已有）
  }
}

export interface DecideDeps {
  /** 注入探测（测试用）；默认真网 fetch `${base}/semver/latest`，返回 version 字符串。 */
  probeFetch?: (base: string, signal: AbortSignal) => Promise<string>
  /** 全败回退态 TTL（毫秒，默认 60s）；过期后下次调用重探。 */
  fallbackTtlMs?: number
}

async function defaultProbeFetch(base: string, signal: AbortSignal): Promise<string> {
  const doc = await fetchJsonLimited<{ version?: unknown }>(`${base}/semver/latest`, { timeoutMs: PROBE_BUDGET_MS, signal })
  return typeof doc?.version === 'string' ? doc.version : ''
}

let memBase: string | null = null
let memIsFallback = false
let fallbackAt = 0
let inflight: Promise<string> | null = null

export function resetNpmRouteForTests(): void {
  memBase = null
  memIsFallback = false
  fallbackAt = 0
  inflight = null
  effective = null
}

/** 共享预算 + 读完整个响应才算赢（captive portal 只回 header 就挂的场景选不出赢家）。 */
async function probeOnce(cands: string[], probeFetch: (base: string, signal: AbortSignal) => Promise<string>): Promise<string> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error('路由探测超时')), PROBE_BUDGET_MS)
  try {
    const ask = async (base: string): Promise<string> => {
      const version = await probeFetch(base, ac.signal)
      if (typeof version !== 'string' || version === '') throw new Error(`${base} 探测无有效 version`)
      return base
    }
    return await Promise.any(cands.map(ask))
  } finally {
    clearTimeout(timer)
    ac.abort() // 停止败者：其答案已不能改变任何决定
  }
}

export async function decideNpmRoute(deps?: DecideDeps): Promise<string> {
  if (inflight) return inflight
  inflight = (async () => {
    // 1) env 最高优先：直采、不探测、不落盘
    const override = process.env.DSHM_NPM_REGISTRY?.trim()
    if (override) {
      setEffective(override)
      return override
    }
    // 2) 成功探测的内存决策稳定复用（决策文件才是持久真相）
    if (memBase !== null && !memIsFallback) return memBase
    // 3) 回退态：TTL 内复用，过期重探（R2-3）
    if (memBase !== null && memIsFallback) {
      if (Date.now() - fallbackAt < (deps?.fallbackTtlMs ?? FALLBACK_TTL_MS)) return memBase
      memBase = null
      memIsFallback = false
    }
    // 4) 决策文件（机器级事实，跨重启稳定）
    const fromFile = readDecisionFile()
    if (fromFile) {
      memBase = fromFile
      memIsFallback = false
      setEffective(fromFile)
      return fromFile
    }
    // 5) probe-once；全败 → 内存回退 DEFAULT（不落盘，R1-8 决策 a）
    const cands = candidates()
    try {
      const winner = await probeOnce(cands, deps?.probeFetch ?? defaultProbeFetch)
      memBase = winner
      memIsFallback = false
      setEffective(winner)
      await writeDecisionFile(winner, cands)
      return winner
    } catch {
      memBase = DEFAULT_NPM_REGISTRY
      memIsFallback = true
      fallbackAt = Date.now()
      setEffective(DEFAULT_NPM_REGISTRY)
      return DEFAULT_NPM_REGISTRY
    }
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/** 当前生效 npm registry（decideNpmRoute 语义名）。 */
export async function activeNpmRegistry(deps?: DecideDeps): Promise<string> {
  return decideNpmRoute(deps)
}

export interface SyncDeps {
  fetcher?: typeof fetchLimited
  timeoutMs?: number
}

/**
 * npmmirror 按需同步（know-how 020 §2.2/§3.1）；2xx=受理。任何失败返回 false、不抛；
 * `DSHM_MIRROR_SYNC=0` 一键关闭（不发请求）。
 */
export async function syncNpmmirrorPackage(pkg: string, deps?: SyncDeps): Promise<boolean> {
  if (process.env.DSHM_MIRROR_SYNC === '0') return false
  const fetcher = deps?.fetcher ?? fetchLimited
  const url = `https://registry-direct.npmmirror.com/${encodeURIComponent(pkg)}/sync?sync_upstream=true`
  try {
    const res = await fetcher(url, { method: 'PUT', timeoutMs: deps?.timeoutMs ?? 8_000 })
    return res.ok
  } catch {
    return false
  }
}
