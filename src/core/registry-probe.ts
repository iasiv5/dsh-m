/**
 * 元数据源竞速（0.4.0，plan Task 7；对齐官方 ui-plugin-manager 的 registry probe
 * 语义：npmjs vs npmmirror `/-/ping` 并发，首个 2xx 胜出即定、败者 abort，
 * 双败 → null 保持默认 npmjs；结果缓存 TTL，默认 1500ms 预算 / 5 分钟缓存）。
 *
 * 只读不写：探测结果仅用于 dsh-m 自身的元数据/packument 读取源选择与市场页展示，
 * 安装链路（pnpm 读 profile .npmrc）完全不动（grilling Q9 定稿）。
 */
import { fetchLimited } from './httpx.js'

export type ProbeSource = 'npmjs' | 'npmmirror'

export const PROBE_URLS: Record<ProbeSource, string> = {
  npmjs: 'https://registry.npmjs.org/-/ping',
  npmmirror: 'https://registry.npmmirror.com/-/ping',
}

/** 探测源 → registry base（versions.ts 元数据读取的 registry 参数值）。 */
export const PROBE_REGISTRY_BASES: Record<ProbeSource, string> = {
  npmjs: 'https://registry.npmjs.org',
  npmmirror: 'https://registry.npmmirror.com',
}

export interface ProbeSnapshot {
  source: ProbeSource | null
  checkedAt: number
}

export interface ProbeFetchLike {
  (url: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<{ ok: boolean; status: number }>
}

export interface RegistryProbeOptions {
  timeoutMs: number
  cacheTtlMs: number
  /** 注入测试桩；缺省 = fetchLimited */
  fetchImpl?: ProbeFetchLike
  /** 时钟注入（测试）；缺省 = Date.now */
  now?: () => number
}

export class RegistryProbe {
  private readonly options: RegistryProbeOptions
  private cached: ProbeSnapshot | null = null
  private inflight: Promise<ProbeSource | null> | null = null

  constructor(options: RegistryProbeOptions) {
    this.options = options
  }

  /** 最近一次快照（不发请求）；无记录 → null。 */
  cachedSnapshot(): ProbeSnapshot | null {
    return this.cached
  }

  /** 缓存期内直接回放；否则并发竞速一次（并发调用共享同一次探测）。 */
  async fastest(): Promise<ProbeSource | null> {
    const now = this.options.now?.() ?? Date.now()
    if (this.cached !== null && now - this.cached.checkedAt < this.options.cacheTtlMs) {
      return this.cached.source
    }
    if (this.inflight !== null) return this.inflight
    this.inflight = this.race().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async race(): Promise<ProbeSource | null> {
    const fetchImpl = this.options.fetchImpl ?? fetchLimited
    const sources = Object.keys(PROBE_URLS) as ProbeSource[]
    const racers = sources.map((source) => {
      const controller = new AbortController()
      const promise = Promise.resolve()
        .then(() => fetchImpl(PROBE_URLS[source], { timeoutMs: this.options.timeoutMs, signal: controller.signal }))
        .then((res) => res.ok === true)
      return { source, controller, promise }
    })
    const winner = await new Promise<ProbeSource | null>((resolve) => {
      let settled = false
      let pending = racers.length
      const done = (source: ProbeSource | null): void => {
        if (settled) return
        settled = true
        for (const racer of racers) {
          if (racer.source !== source) racer.controller.abort()
        }
        resolve(source)
      }
      const oneFinished = (ok: boolean, source: ProbeSource): void => {
        if (ok) {
          done(source)
          return
        }
        pending -= 1
        if (pending <= 0) done(null)
      }
      for (const racer of racers) {
        racer.promise.then((ok) => oneFinished(ok, racer.source)).catch(() => oneFinished(false, racer.source))
      }
    })
    this.cached = { source: winner, checkedAt: this.options.now?.() ?? Date.now() }
    return winner
  }
}
