/**
 * 重启终态状态文件属主（issue #51 / ADR-0032）：
 * - 文件：`$DSH_HOME/dshm/last-restart.json`（`DSHM_LAST_RESTART_FILE` 整文件覆盖供测试；
 *   与 external-operations.json 同目录、随 profile 作用域）。
 * - 写：mkdir recursive 先行（全新机器 `dshm/` 可能不存在，external-journal 同款）→ tmp+rename
 *   原子替换（community.ts 同款惯例）。helper 侧直写走 restart.ts 模板（单写者场景，ADR-0032 §4），
 *   本模块写通道供宿主侧 foldedAt 回写使用。
 * - 读：文件缺失 → null；损坏 → null（best-effort，external-journal list 同款纪律，不抛）。
 * - 折叠：`requestChannel ?? 'external'` ∈ {cli, host-tool, external} 且无 foldedAt 时，经
 *   `journalExternalOperation` 钩子补 `kind:'restart'` 记录（成功失败都记）并回写 foldedAt；
 *   panel 显式跳过（append 层 `channel='panel'` 拒绝不变量之上折叠层可测跳过）；钩子/回写
 *   任何失败 → `'fold-failed'` 且不回写 foldedAt（下次调用可重试）。
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dshHome } from './env.js'
import { journalExternalOperation } from './external-journal.js'

/** 重启终态（helper 侧写入形状；foldedAt 由宿主折叠回写追加）。 */
export interface LastRestartState {
  ok: boolean
  via: 'helper'
  port: number | null
  requestChannel?: string
  at: number
  elapsedMs: number
  assumed?: boolean
  reason?: string
  foldedAt?: number
}

/** 状态文件路径：env 整文件覆盖优先（测试隔离），缺省 `$DSH_HOME/dshm/last-restart.json`。 */
export function lastRestartFile(): string {
  return process.env.DSHM_LAST_RESTART_FILE || join(dshHome(), 'dshm', 'last-restart.json')
}

/** 读终态：缺失/损坏 → null（best-effort，不抛）。 */
export async function readLastRestart(): Promise<LastRestartState | null> {
  try {
    const text = await readFile(lastRestartFile(), 'utf8')
    const parsed = JSON.parse(text) as LastRestartState
    if (parsed === null || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

/** 写终态：mkdir recursive + tmp+rename 原子替换（external-journal append 同款惯例）。 */
export async function writeLastRestart(state: LastRestartState): Promise<void> {
  const path = lastRestartFile()
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(state))
  await rename(tmp, path)
}

export type FoldOutcome = 'folded' | 'skipped-panel' | 'already-folded' | 'absent' | 'fold-failed'

/**
 * 惰性折叠：把 helper 终态折为外部 journal 记录（仅 cli/host-tool/external 通道；panel 显式
 * 跳过——append 层 `channel='panel'` 拒绝不变量之上折叠层可测跳过）。成功回写 foldedAt 幂等
 * 标记；钩子/回写任何失败 → `'fold-failed'` 且不回写 foldedAt（下次调用可重试；「钩子已成功
 * 而回写失败」窗口存在重复记录可能，磁盘故障级罕见，接受并记录——ADR-0032 §4）。
 */
export async function foldLastRestartIntoJournal(
  deps: { journalExternalOperation?: typeof journalExternalOperation } = {},
): Promise<FoldOutcome> {
  const state = await readLastRestart()
  if (state === null) return 'absent'
  if (state.foldedAt !== undefined) return 'already-folded'
  const channel = state.requestChannel ?? 'external'
  if (channel === 'panel') return 'skipped-panel'
  try {
    await (deps.journalExternalOperation ?? journalExternalOperation)(
      channel as Parameters<typeof journalExternalOperation>[0],
      { kind: 'restart', target: 'dsh-m web' },
      state.ok ? 'ok' : 'failed',
      { reason: state.reason },
    )
    await writeLastRestart({ ...state, foldedAt: Date.now() })
    return 'folded'
  } catch {
    return 'fold-failed'
  }
}
