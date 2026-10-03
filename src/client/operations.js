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

/**
 * 升级完成提示三态（0.9.22 生效判定）：activation → toast 的 needsRestart 门与文案后缀键。
 * 'client-only' 不出重启横幅（刷新页面即生效）；'unknown' 保守出横幅；缺席（github 源升级等）= 现状。
 * 纯函数无 DOM/React 依赖，client-operations 单测覆盖。
 */
export function upgradeNotify(activation) {
  if (activation === 'client-only') return { needsRestart: false, suffixKey: 'notify.upgraded.clientonly' }
  if (activation === 'unknown') return { needsRestart: true, suffixKey: 'notify.upgraded.activationUnknown' }
  return { needsRestart: true, suffixKey: null }
}

// 终态可清集合（0.9.6 主人裁决，推翻 0.7.0 评审共识「failed/superseded 保留供回看」）：
// 「清除已结束」是显式点击动作而非静默抹除，失败/已跳过同样应可清——否则按钮对着
// 一屏失败记录无声 no-op（Windows 实机反馈 2026-10-01）；单条 ✕ 仍是逐条出口。
const TERMINAL_CLEARABLE = new Set(['done', 'warned', 'failed', 'superseded'])
export { TERMINAL_CLEARABLE }

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
    /** 清除全部终态（done/warned/failed/superseded）；queued/running/input 等在途态不受影响。 */
    clearFinished() {
      records = records.filter((r) => !TERMINAL_CLEARABLE.has(r.status))
      persist()
      return this.list()
    },
    /** 供 restore 之后的批量覆写（恢复校验结果落库）。
     *  合并语义（0.7.0 评审 P1/R2·N1/R3 修正）：以**当前**记录为权威按 id 覆写——
     *  - 快照外新增（恢复校验窗口内用户发起的操作）保留，不被旧快照抹掉；
     *  - 快照内但窗口期被用户删除的记录不复活；
     *  - 活会话记录（meta.session）不覆写——泵在拾取（queued→running）时打标，覆盖其任意
     *    后续状态（含 done），防恢复快照旧态回卷；**无标记的 crashed running 照常被改标为
     *    failed「进程重启中断」**（恢复语义核心，R3：不得用 status 短路——泵拥有与崩溃残留
     *    在此处不可区分，session 标记才是唯一可信的所有权凭证）。 */
    replaceAll(next) {
      const byId = new Map((Array.isArray(next) ? next : []).map((r) => [r.id, r]))
      records = records.map((r) => {
        const incoming = byId.get(r.id)
        if (!incoming) return { ...r }
        if (r.meta && r.meta.session === true) return { ...r }
        return { ...incoming }
      })
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
 * 前提判定核心（0.7.0 评审 P2）：install 的 target 是收录 id，与 installed.pkg 不同名——
 * 同时比对 meta.npm（npm 源安装后的包名）与 registryGithub === meta.github（github 源且已装条目
 * 被合并市场匹配上）；未匹配 registry 的手装 github 条目无可比键，恢复重发幂等（可接受边界）。
 * @param {OperationRecord} rec
 * @param {Array<{pkg: string, registryGithub?: string | null}>} installedItems
 */
export function opAppliesTo(rec, installedItems) {
  const items = Array.isArray(installedItems) ? installedItems : []
  const has = items.some(
    (x) =>
      x &&
      (x.pkg === rec.target ||
        (rec.meta && typeof rec.meta.npm === 'string' && x.pkg === rec.meta.npm) ||
        (rec.meta && typeof rec.meta.github === 'string' && x.registryGithub === rec.meta.github)),
  )
  return rec.kind === 'install' ? !has : has
}

/**
 * 单一执行泵（0.7.0 评审 P4：生产实现迁入本模块，可测；main.jsx 只保留接线）。
 * queued→running→终态 FIFO；恢复与前台共用（getCtx 提供恢复 dispatch 与实读校验）。
 * - waiters 持有 dispatch 抛出的**原始 Error 引用**（附 opId）——调用方 catch 读
 *   e.guard/e.issue 不受 record.error 字符串化影响；
 * - 取队首同步 store.list()，判空到退出之间不插任何 await；
 * - dispatch 前统一 stillApplies 实读校验；前提消失 → superseded（e.opSuperseded 拒绝 waiter）。
 * @param {ReturnType<typeof createOperationsStore>} store
 * @param {() => ({ stillApplies?: (rec) => Promise<boolean>, dispatchRestored?: (rec) => Promise<{ok: boolean, error?: string, issue?: unknown}>, syncOps?: () => void } | null)} getCtx
 */
export function createOpsPump(store, getCtx) {
  const executors = new Map()
  const waiters = new Map()
  let pumping = false
  async function pump() {
    if (pumping) return
    pumping = true
    try {
      for (;;) {
        const queued = store.list().find((r) => r.status === 'queued') // 同步取队首
        if (!queued) break
        const waitersEntry = waiters.get(queued.id)
        const executor = executors.get(queued.id)
        waiters.delete(queued.id)
        executors.delete(queued.id)
        const ctx = getCtx()
        const finalize = (patch) => {
          store.upsert({ id: queued.id, ...patch })
          const c = getCtx()
          if (c && c.syncOps) c.syncOps()
        }
        if (ctx && ctx.stillApplies) {
          let applies = true
          try {
            applies = await ctx.stillApplies(queued)
          } catch {
            applies = false
          }
          if (!applies) {
            finalize({ status: 'superseded', error: '执行时前提消失（已手动处理？）' })
            if (waitersEntry) {
              waitersEntry.reject(Object.assign(new Error('op superseded'), { opSuperseded: true, opId: queued.id }))
            }
            continue
          }
        }
        // 拾取即打 session 标记（R3·N1 修正）：泵从此拥有该记录（任意后续状态含 done 均受
        // replaceAll 的 session 短路保护）；persist 剥离标记——崩溃残留的 running 重载后无标记，
        // 照常走「进程重启中断」改标。
        store.upsert({ id: queued.id, status: 'running', meta: { ...(queued.meta || {}), session: true } })
        if (ctx && ctx.syncOps) ctx.syncOps()
        let value
        let err = null
        try {
          if (executor) {
            value = await executor.exec()
          } else if (ctx && ctx.dispatchRestored) {
            const r = await ctx.dispatchRestored(queued)
            if (!r || !r.ok) err = Object.assign(new Error((r && r.error) || 'unknown'), r && r.issue ? { issue: r.issue } : {})
          } else {
            err = new Error('无执行上下文（面板未挂载）')
          }
        } catch (e) {
          err = e
        }
        if (!err) {
          finalize({ status: value && value.opWarning ? 'warned' : 'done', warning: value && value.opWarning })
          if (waitersEntry) waitersEntry.resolve(value)
        } else {
          const isInput = Boolean(err.issue)
          finalize(isInput ? { status: 'input', inputKind: 'peer-incompatible' } : { status: 'failed', error: String(err.message || err) })
          err.opId = queued.id
          if (waitersEntry) waitersEntry.reject(err)
        }
      }
    } finally {
      pumping = false
    }
  }
  return {
    /** 入队并返回该记录终态的 Promise（waiters 持原始错误）。 */
    enqueue(record, exec) {
      const stored = store.upsert(record)
      const ctx = getCtx()
      if (ctx && ctx.syncOps) ctx.syncOps()
      return new Promise((resolve, reject) => {
        waiters.set(stored.id, { resolve, reject })
        executors.set(stored.id, { exec })
        void pump()
      })
    },
    /** 启动泵（恢复流程改标后调用，处理 restored queued）。 */
    kick() {
      void pump()
    },
  }
}

/**
 * 恢复执行器（**已退役**，0.7.0 评审 P4）：生产路径由 createOpsPump 承担（恢复并入同一泵）。
 * 保留为纯函数参考实现与 Node 测试对象；生产变更请改 createOpsPump。
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
