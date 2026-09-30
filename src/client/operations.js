/**
 * 全局操作记录模型（0.7.0 Task 13 / DESIGN.md §2.6「全局操作记录」）：
 * 每个变更操作（安装/升级/卸载/开关）一条 record，状态不挂卡片——翻页/搜索/切 tab 不丢；
 * localStorage 持久化（key `dshm-operations`），宿主重载恢复时逐条校验「此刻仍成立才执行，否则报告」。
 *
 * - OpStatus 七态：queued / running / input（冲突待决，恢复时不可复活）/ done / warned / failed /
 *   superseded（良性前提消失——如恢复期间用户已手动装同款；UI 中性样式呈现，不得显示为红色错误）；
 * - 持久化原子写：每次变更全量写，配额/序列化失败静默降级内存态（persistDegraded=true，不抛）；
 * - restoreRecords：必须在 installed 数据 resolve 之后调用（时序写死）；queued 逐条校验
 *   （成立→保持 queued 待执行；不成立→superseded）；input 一律 failed（待决确认不可恢复）；
 *   running 标 failed（进程重启中断）；done/warned/failed 原样保留；
 * - drainRestored：恢复执行器。FIFO 逐条 dispatch（复用现有 UI 调用链，不新建事务路径；
 *   后端 Profile 变更事务 FIFO 保证串行）；dispatch 前二次校验——以执行时实读复核前提
 *   （禁止复用 restore 流程开头缓存的 installed 快照），不成立→superseded。
 *   与 compensate-install rejected 分支「以执行时实况为准」语义同源。
 * 不依赖 DOM/React，Node tests 直接 import。
 */

/** 操作记录的参数载体（0.7.0 Task 13 契约扩展）：install 的 version/forceIncompatible、
 *  toggle 的 on、upgrade 的 force 等——target 只承载身份，参数进 meta。 */
export const OP_STORAGE_KEY = 'dshm-operations'

/**
 * @typedef {'install'|'upgrade'|'uninstall'|'toggle'} OpKind
 * @typedef {'queued'|'running'|'input'|'done'|'warned'|'failed'|'superseded'} OpStatus
 */

/**
 * @typedef {Object} OperationRecord
 * @property {string} id
 * @property {'install'|'upgrade'|'uninstall'|'toggle'} kind
 * @property {string} target install=收录 id；upgrade/uninstall/toggle=包名
 * @property {'queued'|'running'|'input'|'done'|'warned'|'failed'|'superseded'} status
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string} [error]
 * @property {string} [warning]
 * @property {'peer-incompatible'|'force-needed'} [inputKind]
 * @property {Record<string, unknown>} [meta] 操作参数（version/force/on…）
 */

const TERMINAL_CLEARABLE = new Set(['done', 'warned'])

function safeParse(raw) {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((r) => r && typeof r === 'object' && typeof r.id === 'string') : []
  } catch {
    return []
  }
}

/** localStorage 安全壳：任何访问异常 → 内存态（persistDegraded）。 */
function storageOf(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return { degraded: true, read: () => null, write: () => { throw new Error('degraded') } }
  }
  return {
    degraded: false,
    read: () => {
      try {
        return storage.getItem(OP_STORAGE_KEY)
      } catch {
        return null
      }
    },
    write: (text) => {
      storage.setItem(OP_STORAGE_KEY, text) // 抛出由调用方捕获降级
    },
  }
}

/**
 * @param {Storage | null | undefined} storage 浏览器 localStorage；不可用即内存态
 */
export function createOperationsStore(storage) {
  const s = storageOf(storage)
  let records = safeParse(s.read())
  let persistDegraded = false

  const persist = () => {
    if (persistDegraded) return
    try {
      // session 标记只活在本页内存（0.7.0 终审·新伤1）：持久化时剥离——
      // 重挂载的 restoreRecords 靠它跳过活会话记录（泵仍拥有它们），
      // 真正的页面重载后持久层无标记，queued 恢复 / running→「重启中断」语义照常成立。
      s.write(JSON.stringify(records.map((r) => (r.meta && r.meta.session === true ? { ...r, meta: { ...r.meta, session: undefined } } : r))))
    } catch {
      persistDegraded = true // 配额/序列化失败：静默降级内存态
    }
  }

  return {
    /** @returns {OperationRecord[]} 当前记录（浅拷贝） */
    list() {
      return records.map((r) => ({ ...r }))
    },
    get persistDegraded() {
      return persistDegraded
    },
    /** upsert 按 id 覆盖；不带 id 视为新记录生成 id。@returns 存储后的记录（含 id/时间戳）。 */
    upsert(rec) {
      const now = Date.now()
      const id = typeof rec.id === 'string' && rec.id !== '' ? rec.id : `op-${now}-${Math.random().toString(36).slice(2, 8)}`
      const merged = { createdAt: now, ...rec, id, updatedAt: now }
      const idx = records.findIndex((r) => r.id === id)
      let stored
      if (idx >= 0) {
        records[idx] = stored = { ...records[idx], ...merged, createdAt: records[idx].createdAt }
      } else {
        records = [...records, merged]
        stored = merged
      }
      persist()
      return { ...stored }
    },
    remove(id) {
      records = records.filter((r) => r.id !== id)
      persist()
      return this.list()
    },
    /** 只清 done/warned；failed/superseded 保留供回看（评审共识：不把失败静默抹掉）。 */
    clearFinished() {
      records = records.filter((r) => !TERMINAL_CLEARABLE.has(r.status))
      persist()
      return this.list()
    },
    /** 供 restore 之后的批量覆写（drain 校验结果落库）。 */
    replaceAll(next) {
      records = next.map((r) => ({ ...r }))
      persist()
      return this.list()
    },
  }
}

/**
 * 恢复校验（必须在 installed 数据 resolve 之后调用——数据未到位时等待而非默认判定）：
 * @param {OperationRecord[]} records
 * @param {(rec: OperationRecord) => Promise<boolean>} stillApplies 前提判定（调用方以实读数据实现）
 * @returns {Promise<OperationRecord[]>} 改标后的记录列表（不落库；由调用方 replaceAll）
 */
export async function restoreRecords(records, stillApplies) {
  const list = Array.isArray(records) ? records : []
  const out = []
  for (const rec of list) {
    if (!rec || typeof rec !== 'object') continue
    if (rec.meta && rec.meta.session === true) {
      // 活会话记录（0.7.0 终审·新伤1）：泵仍拥有它——面板重挂载不是进程重启，
      // 不得误标「重启中断」；重载后持久层已剥离标记，自然走正常恢复分支。
      out.push({ ...rec })
      continue
    }
    if (rec.status === 'queued') {
      let applies = false
      try {
        applies = await stillApplies(rec)
      } catch {
        applies = false
      }
      out.push(
        applies
          ? { ...rec, status: 'queued' }
          : { ...rec, status: 'superseded', error: '恢复时前提消失（校验不成立）', updatedAt: Date.now() },
      )
    } else if (rec.status === 'input') {
      out.push({ ...rec, status: 'failed', error: '待决确认不可恢复，请重新发起', updatedAt: Date.now() })
    } else if (rec.status === 'running') {
      out.push({ ...rec, status: 'failed', error: '进程重启中断', updatedAt: Date.now() })
    } else {
      out.push({ ...rec })
    }
  }
  return out
}

/**
 * 恢复执行器：FIFO 逐条 dispatch。dispatch 前以**执行时实读**复核前提
 * （stillApplies 二次调用，禁止复用 restore 流程开头的快照）；不成立→superseded（良性，中性呈现）。
 * @param {ReturnType<typeof createOperationsStore>} store
 * @param {(rec: OperationRecord) => Promise<{ ok: boolean; error?: string; warning?: string }>} dispatch
 * @param {(rec: OperationRecord) => Promise<boolean>} stillApplies
 */
export async function drainRestored(store, dispatch, stillApplies) {
  const queue = store.list().filter((r) => r.status === 'queued')
  for (const rec of queue) {
    let applies = false
    try {
      applies = await stillApplies(rec)
    } catch {
      applies = false
    }
    if (!applies) {
      store.upsert({ ...rec, status: 'superseded', error: '执行时前提消失（已手动处理？）' })
      continue
    }
    store.upsert({ ...rec, status: 'running' })
    let result
    try {
      result = await dispatch(rec)
    } catch (e) {
      result = { ok: false, error: String((e && e.message) || e) }
    }
    if (result && result.ok) {
      store.upsert({ ...rec, status: result.warning ? 'warned' : 'done', warning: result.warning })
    } else {
      store.upsert({ ...rec, status: 'failed', error: (result && result.error) || 'unknown' })
    }
  }
}
