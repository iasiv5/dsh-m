/**
 * 机器本地的外部操作日志（0.9.79，ADR-0018）：外部通道（dshm CLI / Agent 工具）发起的
 * Profile 变更以终态直落记录进入本文件——不入操作泵、永不 queued/running、不参与恢复重放、
 * 宿主重启后原样保留；记录机器本地、不跨机同步；不含凭据与原始命令输出。
 *
 * - 存储文件：`$DSH_HOME/dshm/external-operations.json`（`DSHM_EXTERNAL_JOURNAL_FILE` 可整文件
 *   覆盖供测试；与 dshm/cache 同基址、不带 profile 维度、不被缓存清理波及）。
 * - append：mkdir recursive 先行（R2-4：全新机器上 `dshm/` 目录可能尚不存在，首条审计记录
 *   恰是最有价值的一条，不能静默丢失）→ tmp+rename 原子替换（community.ts 同款惯例）→
 *   滚动保留最新 200 条。channel='panel' 拒绝（防御性不变量：面板通道不走外部日志，
 *   面板调用点应在钩子层被跳过）。错误一律上抛——吞错是上层钩子的职责（R1-1）。
 * - list：按 `at` 降序（新→旧）；文件缺失 = 空列表；损坏文件不抛——改名
 *   `<file>.corrupt-<ts>` 隔离留证后从空开始（best-effort，隔离失败同样不抛）。
 * - clear：写空数组，文件保留（面板「清除已结束」联动出口）。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dshHome } from './env.js'

/** 调用通道（全局类型契约）：三个已知调用点必须显式传值；'external' 仅为缺省兜底。 */
export type OperationChannel = 'panel' | 'cli' | 'host-tool' | 'external'

/** 外部记录的 channel（不含 'panel'——append 层拒绝）。 */
export type ExternalChannel = Exclude<OperationChannel, 'panel'>

export type ExternalOperationKind =
  | 'install'
  | 'uninstall'
  | 'upgrade'
  | 'self-upgrade'
  | 'toggle'
  | 'restart'
  | 'desktop-install'
  | 'desktop-uninstall'
  | 'desktop-upgrade'
  | 'desktop-toggle'

/** 外部操作记录（终态事实；与客户端 OperationRecord 正交，panel 通道不产生）。 */
export interface ExternalOperationRecord {
  id: string
  at: number
  channel: ExternalChannel
  kind: ExternalOperationKind
  target: string
  fromVersion?: string
  toVersion?: string
  result: 'ok' | 'failed'
  reason?: string
}

const MAX_RECORDS = 200
const REASON_MAX = 300

/** 日志文件路径：env 整文件覆盖优先（测试隔离），缺省 $DSH_HOME/dshm/external-operations.json。 */
export function journalFile(): string {
  return process.env.DSHM_EXTERNAL_JOURNAL_FILE || join(dshHome(), 'dshm', 'external-operations.json')
}

/** 显式字段白名单重组（超集字段一律不落盘——「记录不含凭据」的形状级保证）；reason 截断 ≤300。 */
function normalizeRecord(record: ExternalOperationRecord): ExternalOperationRecord {
  const reason = typeof record.reason === 'string' ? record.reason.slice(0, REASON_MAX) : undefined
  return {
    id: record.id,
    at: record.at,
    channel: record.channel,
    kind: record.kind,
    target: record.target,
    ...(record.fromVersion !== undefined ? { fromVersion: record.fromVersion } : {}),
    ...(record.toVersion !== undefined ? { toVersion: record.toVersion } : {}),
    result: record.result,
    ...(reason !== undefined && reason !== '' ? { reason } : {}),
  }
}

async function atomicWrite(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, text)
  await rename(tmp, path)
}

/** 读全量记录（插入序 = 时间升序）；损坏 → 隔离改名后按空处理；文件缺失 → []。 */
async function readAll(file: string): Promise<ExternalOperationRecord[]> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r === 'object') : []
  } catch {
    // 损坏容错：整文件改名隔离留证（best-effort），从空开始；不抛——读路径永不炸
    const quarantined = `${file}.corrupt-${Date.now()}`
    try {
      await rename(file, quarantined)
    } catch {
      try {
        // 同毫秒重入等极小概率命名冲突：换一个带随机尾缀的名字再试一次；仍败则放弃隔离
        const fallback = `${file}.corrupt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        await rename(file, fallback)
      } catch {
        /* 放弃隔离：按空继续 */
      }
    }
    return []
  }
}

/**
 * 追加一条终态记录（成功与失败都记）。channel='panel' 抛错（防御性不变量）；
 * 不可创建路径/磁盘错误等存储失败原样上抛，由上层钩子吞（R1-1：绝不反噬操作终态）。
 */
export async function appendExternalOperation(record: ExternalOperationRecord): Promise<void> {
  if ((record as { channel?: unknown }).channel === 'panel') {
    throw new Error('panel 通道不入外部操作日志（防御性不变量：面板调用点应在钩子层跳过 append）')
  }
  const file = journalFile()
  await mkdir(dirname(file), { recursive: true })
  const records = await readAll(file)
  records.push(normalizeRecord(record))
  const kept = records.slice(-MAX_RECORDS)
  await atomicWrite(file, `${JSON.stringify(kept, null, 2)}\n`)
}

/** 全量外部记录，按 `at` 降序（新→旧）。 */
export async function listExternalOperations(): Promise<ExternalOperationRecord[]> {
  const records = await readAll(journalFile())
  return records
    .slice()
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .map((r) => ({ ...r }))
}

/** 清空外部记录：文件保留（空数组），面板「清除已结束」联动出口。 */
export async function clearExternalOperations(): Promise<void> {
  const file = journalFile()
  await mkdir(dirname(file), { recursive: true })
  await atomicWrite(file, '[]\n')
}

/** 按 id 删除单条外部记录（0.9.82 修订 R2-3）：幂等——id 不存在静默 no-op；
 *  整文件读-改-写与 append 同款并发纪律（ADR-0018 Consequences 既有明示局限）；
 *  保留记录原样透写，不做 normalize 重写（删除不改写历史字段）。 */
export async function removeExternalOperation(id: string): Promise<void> {
  const file = journalFile()
  const records = await readAll(file)
  const kept = records.filter((r) => r.id !== id)
  if (kept.length === records.length) return
  await mkdir(dirname(file), { recursive: true })
  await atomicWrite(file, `${JSON.stringify(kept, null, 2)}\n`)
}

/** appendExternalOperation 的类型（钩子注入位；R3-1：deps.appendExternalOperation ?? 真实现）。 */
export type AppendExternalOperation = typeof appendExternalOperation

/** 终态直落钩子的可注入依赖（测试用；生产缺省真实现）。 */
export interface ExternalJournalHook {
  appendExternalOperation?: AppendExternalOperation
}

/**
 * 九个公共变更入口共用的终态直落钩子（0.9.79，ADR-0018）：
 * - channel 缺省 'external'（审计上漏报更糟，未知调用方落兜底而非丢弃）；
 * - channel='panel' 在钩子层**跳过**（面板通道零记录；append 侧的 panel 抛错仅为防御性不变量）；
 * - append 任何失败被吞（至多 stderr 一行）——**绝不反噬操作终态与返回值**（R1-1）；
 * - reason 截断 ≤300 字符（R1-8）。
 * 调用时机 = 操作终态之后（成功与失败都记）。
 */
export async function journalExternalOperation(
  channel: OperationChannel | undefined,
  record: { kind: ExternalOperationKind; target: string; fromVersion?: string; toVersion?: string },
  result: 'ok' | 'failed',
  deps: ExternalJournalHook & { reason?: string } = {},
): Promise<void> {
  const ch: OperationChannel = channel ?? 'external'
  if (ch === 'panel') return
  try {
    const reason = typeof deps.reason === 'string' ? deps.reason.slice(0, REASON_MAX) : undefined
    await (deps.appendExternalOperation ?? appendExternalOperation)({
      id: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      channel: ch,
      kind: record.kind,
      target: record.target,
      ...(record.fromVersion !== undefined ? { fromVersion: record.fromVersion } : {}),
      ...(record.toVersion !== undefined ? { toVersion: record.toVersion } : {}),
      result,
      ...(reason !== undefined && reason !== '' ? { reason } : {}),
    })
  } catch (err) {
    console.error(`[dsh-m] 外部操作记录落盘失败（不影响操作结果）: ${err instanceof Error ? err.message : String(err)}`)
  }
}
