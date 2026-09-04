/**
 * Registry 条目可达性诊断（DESIGN.md §4）：用户主动触发的 probe，只读当前 active
 * registry，不改配置、不写 cache、不修改条目。每个 npm/GitHub/homepage/icon 字段是
 * 一个 probe；统计 probe 次数；issue 按条目与字段顺序稳定；最多返回 100 条 issue。
 */
import type { Registry } from './registry.js'
import { isReachable } from './httpx.js'
import { githubLatestTag, npmLatest } from './versions.js'

export interface RegistryCheckIssue {
  id: string
  field: string
  message: string
}

export interface RegistryCheckResult {
  /** 已发起的 probe 次数（不是条目数） */
  checked: number
  /** 成功 probe 次数 */
  passed: number
  /** 失败 probe 次数（含 deadline 未收敛） */
  failed: number
  issues: RegistryCheckIssue[]
  truncated: boolean
}

export interface RegistryCheckDeps {
  npmLatest(pkg: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown>
  githubLatestTag(repo: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown>
  reachable(url: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean>
}

const MAX_ISSUES = 100
const DEFAULT_CONCURRENCY = 8
const MAX_CONCURRENCY = 8
const DEFAULT_DEADLINE_MS = 60_000
const FIELD_ORDER = ['npm', 'github', 'homepage', 'icon'] as const

function normalizeConcurrency(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return DEFAULT_CONCURRENCY
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(raw)))
}

export function defaultRegistryCheckDeps(): RegistryCheckDeps {
  return {
    npmLatest: (pkg, timeoutMs, signal) => npmLatest(pkg, timeoutMs, signal),
    githubLatestTag: (repo, timeoutMs, signal) => githubLatestTag(repo, timeoutMs, signal),
    reachable: (url, timeoutMs, signal) => isReachable(url, timeoutMs, signal),
  }
}

interface ProbeSpec {
  id: string
  field: (typeof FIELD_ORDER)[number]
  entryIndex: number
  fieldIndex: number
  run: (timeoutMs: number, signal?: AbortSignal) => Promise<unknown>
}

function collectProbes(registry: Registry, deps: RegistryCheckDeps): ProbeSpec[] {
  const probes: ProbeSpec[] = []
  registry.plugins.forEach((entry, entryIndex) => {
    const push = (field: (typeof FIELD_ORDER)[number], run: ProbeSpec['run']): void => {
      probes.push({ id: entry.id, field, entryIndex, fieldIndex: FIELD_ORDER.indexOf(field), run })
    }
    if (entry.source === 'npm' && entry.npm) {
      push('npm', (t, s) => deps.npmLatest(entry.npm!, t, s))
    }
    if (entry.github) {
      push('github', (t, s) => deps.githubLatestTag(entry.github!, t, s))
    }
    if (entry.homepage) {
      push('homepage', (t, s) => deps.reachable(entry.homepage!, t, s))
    }
    if (entry.icon) {
      push('icon', (t, s) => deps.reachable(entry.icon!, t, s))
    }
  })
  return probes
}

interface ProbeOutcome {
  kind: 'value' | 'error' | 'timeout'
  value?: unknown
  error?: unknown
}

/** probe 收敛：deadline 内未 resolve/reject 一律按 timeout 统计，不永久等待。 */
function raceProbe(task: Promise<ProbeOutcome>, deadlineAt: number): Promise<ProbeOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutP = new Promise<ProbeOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), Math.max(1, deadlineAt - Date.now()))
  })
  return Promise.race([task, timeoutP]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export async function checkRegistryEntries(
  registry: Registry,
  options: { timeoutMs?: number; concurrency?: number; deadlineMs?: number; signal?: AbortSignal } = {},
  deps: RegistryCheckDeps = defaultRegistryCheckDeps(),
): Promise<RegistryCheckResult> {
  const timeoutMs = options.timeoutMs ?? 20_000
  const concurrency = normalizeConcurrency(options.concurrency)
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS
  const signal = options.signal
  const deadlineAt = Date.now() + deadlineMs

  const probes = collectProbes(registry, deps)
  const records: Array<{ entryIndex: number; fieldIndex: number; issue: RegistryCheckIssue }> = []
  let checked = 0
  let passed = 0
  let failed = 0
  let aborted = false
  const onAbort = () => {
    aborted = true
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const record = (spec: ProbeSpec, message: string): void => {
    records.push({ entryIndex: spec.entryIndex, fieldIndex: spec.fieldIndex, issue: { id: spec.id, field: spec.field, message } })
  }

  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      if (aborted || Date.now() >= deadlineAt) return
      const index = next
      if (index >= probes.length) return
      next += 1
      const spec = probes[index]!
      checked += 1
      const budget = Math.max(1, Math.min(timeoutMs, deadlineAt - Date.now()))
      const outcome = await raceProbe(
        spec.run(budget, signal).then<ProbeOutcome, ProbeOutcome>(
          (value) => ({ kind: 'value', value }),
          (error) => ({ kind: 'error', error }),
        ),
        deadlineAt,
      )
      if (outcome.kind === 'timeout') {
        failed += 1
        record(spec, 'probe 在 deadline 前未收敛')
      } else if (outcome.kind === 'error') {
        failed += 1
        record(spec, outcome.error instanceof Error ? outcome.error.message : String(outcome.error))
      } else if (spec.field === 'homepage' || spec.field === 'icon') {
        if (outcome.value === true) passed += 1
        else {
          failed += 1
          record(spec, 'URL 不可达')
        }
      } else {
        passed += 1
      }
    }
  }

  const size = Math.min(concurrency, probes.length)
  await Promise.all(Array.from({ length: size === 0 ? 1 : size }, worker))
  signal?.removeEventListener('abort', onAbort)

  records.sort((a, b) => (a.entryIndex - b.entryIndex) || (a.fieldIndex - b.fieldIndex))
  const issues = records.slice(0, MAX_ISSUES).map((r) => r.issue)
  return { checked, passed, failed, issues, truncated: records.length > MAX_ISSUES }
}
