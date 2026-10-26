/**
 * 全局操作记录模型（0.7.0 Task 13 / DESIGN.md §2.6「全局操作记录」）：
 * 每个变更操作（安装/升级/卸载/开关）一条 record，状态不挂卡片——翻页/搜索/切 tab 不丢；
 * localStorage 持久化（key `dshm-operations`），宿主重载恢复时逐条校验「此刻仍成立才执行，否则报告」。
 *
 * 设置类终态直落记录（2026-10-10，DESIGN §2.6 修订）：`community-toggle` / `registry-url` 两类
 * **不入泵**——创建即终态（done/failed），无 queued 生命周期、无恢复重放语义；恢复分支对其
 * 原样保留（与 done/warned/failed 同路）、「清除已结束」照常可清、failed 照常点亮红点。
 * target 只承载对象身份（`community-catalog` / 目标地址，恢复默认记 `"(default)"`），参数进 meta
 * （toggle 的 on / registry-url 的 from）。
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
 *  toggle 的 on、upgrade 的 force、community-toggle 的 on、registry-url 的 from 等——
 *  target 只承载身份，参数进 meta。 */
export const OP_STORAGE_KEY = 'dshm-operations'

/** registry-url 记录的「恢复默认」target 记号（共享常量，2026-10-10 评审 N1：三处引用不散落魔法串）。 */
export const REGISTRY_DEFAULT_TARGET = '(default)'

/**
 * 外部操作记录（服务端 ExternalOperationRecord，ADR-0018）→ 渲染记录（OperationRecord 形态）映射
 * （0.9.79）：终态直落语义——result:'ok'→'done'、'failed'→'failed'（永不 queued/running）；
 * at→createdAt/updatedAt；reason→error（红点数据源）；fromVersion/toVersion→meta.from/to
 * （升级版本串经 opRowVm 照常派生）；channel 原样携带（渠道徽标 + 单条移除出口判定）。
 */
export function externalToRecord(er) {
  if (!er || typeof er !== 'object') return null
  const meta = {}
  if (typeof er.fromVersion === 'string' && er.fromVersion !== '') meta.from = er.fromVersion
  if (typeof er.toVersion === 'string' && er.toVersion !== '') meta.to = er.toVersion
  return {
    id: typeof er.id === 'string' && er.id !== '' ? er.id : `ext-${er.at ?? 'unknown'}`,
    kind: er.kind,
    target: typeof er.target === 'string' ? er.target : '',
    status: er.result === 'failed' ? 'failed' : 'done',
    createdAt: Number.isFinite(er.at) ? er.at : 0,
    updatedAt: Number.isFinite(er.at) ? er.at : 0,
    channel: typeof er.channel === 'string' && er.channel !== '' ? er.channel : 'external',
    ...(er.reason ? { error: String(er.reason) } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  }
}

/**
 * @typedef {'install'|'upgrade'|'uninstall'|'toggle'|'community-toggle'|'registry-url'} OpKind
 * @typedef {'queued'|'running'|'input'|'done'|'warned'|'failed'|'superseded'} OpStatus
 */

/**
 * @typedef {Object} OperationRecord
 * @property {string} id
 * @property {'install'|'upgrade'|'uninstall'|'toggle'|'community-toggle'|'registry-url'} kind
 * @property {string} target install=收录 id；upgrade/uninstall/toggle=包名；community-toggle=community-catalog；
 *                            registry-url=目标地址（恢复默认为 "(default)"）
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
  // 外部操作记录 overlay（0.9.79 ADR-0018）：服务端（机器本地 journal）为唯一事实源，
  // fetch 后只进内存——绝不写 localStorage（R1-3：否则服务端滚动淘汰/清除后被本地副本复活，
  // 且每浏览器各留一份）。泵/恢复语义只看 records（本地），overlay 零扰动。
  let externalOverlay = []
  // 墓碑（0.9.82 修订 R2-3，评审 R1-C3）：removeExternal 后（服务端删除已成功）的 id 在本页
  // 内存记名——拦截在途 fetch 迟到响应把已删记录并回 overlay（setExternal 是只增改的 merge-only
  // 合并，无墓碑时该行会僵尸存留）。clearExternal（「清除已结束」）重置：重置后能并回的只有
  // 服务端仍存在的行，已被 ✕ 删除的行服务端已无、不会经 fetch 回来。
  const removedIds = new Set()

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
    /** 外部记录 overlay（内存）：id 幂等合并（后到值覆盖），返回合并视图。 */
    setExternal(next) {
      const incoming = (Array.isArray(next) ? next : []).filter((r) => r && typeof r === 'object' && typeof r.id === 'string')
      const byId = new Map(externalOverlay.map((r) => [r.id, r]))
      for (const r of incoming) {
        if (removedIds.has(r.id)) continue // 0.9.82 墓碑：在途 fetch 迟到响应不复活已删记录
        byId.set(r.id, { ...(byId.get(r.id) || {}), ...r })
      }
      externalOverlay = [...byId.values()]
      return this.listMerged()
    },
    /** 清空外部 overlay（「清除已结束」联动 external-operations-clear 成功后调用）。 */
    clearExternal() {
      externalOverlay = []
      removedIds.clear()
      return this.listMerged()
    },
    /** 按 id 剔除外部 overlay（0.9.82 修订 R2-3）：仅内存视图——调用方必须已在服务端
     *  删除成功后调用（external-operations-remove）；墓碑拦住在途 fetch 迟到响应的复活。 */
    removeExternal(id) {
      removedIds.add(id)
      externalOverlay = externalOverlay.filter((r) => r.id !== id)
      return this.listMerged()
    },
    /** @returns {OperationRecord[]} 外部 overlay 当前快照（原始形态，浅拷贝）。 */
    externalList() {
      return externalOverlay.map((r) => ({ ...r }))
    },
    /** 本地 + 外部合并视图：外部映射为渲染记录后与本地按 createdAt 升序（groupOpsByDay 假定升序输入）。 */
    listMerged() {
      const external = externalOverlay.map(externalToRecord).filter(Boolean)
      return [...records.map((r) => ({ ...r })), ...external].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
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
 * 0.10.6（挂账 1 收口）：installed 是否已达 target（rc-aware 语义化 ≥ 比较，pure）。
 * core 三段数值比较；同 core 下无预发布 > 有预发布，预发布段逐段（数值段按数值、标识符按字典序）。
 * 非法/不可解析 → false（对账读不到就不收口，保持原语义）。
 */
export function reachedVersion(installed, target) {
  if (typeof installed !== 'string' || typeof target !== 'string') return false
  const parse = (v) => {
    const m = /^(.*?)-([\s\S]+)$/.exec(v)
    const corePart = m ? m[1] : v
    const seg = corePart.split('.')
    if (seg.length !== 3 || seg.some((n) => !/^\d+$/.test(n))) return null
    return { core: seg.map((n) => Number.parseInt(n, 10)), pre: m ? m[2].split('.') : null }
  }
  const a = parse(installed)
  const b = parse(target)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i]
  }
  if (a.pre === null && b.pre === null) return true
  if (a.pre === null) return true
  if (b.pre === null) return false
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === undefined) return true
    if (y === undefined) return false
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const c = Number(x) - Number(y)
      if (c !== 0) return c > 0
    } else if (xn !== yn) {
      return xn
    } else if (x !== y) {
      return x > y
    }
  }
  return true
}

/**
 * 0.10.7（对账补横幅一次性化，A 方案·主人裁决）：已读集合的独立存储键。
 * 集合成员 = `${recordId}|${target}|${toVersion}`（Q2-a 元组：同一条升级只提醒一次，新升级照常提醒）。
 * 存在操作记录生命周期**之外**（独立 localStorage 键）——对真机实证的「done 落账被复活路径
 * 打回 running」（0.10.6 每开必弹事件）鲁棒；复活机制未定谳，已挂账排查（CHANGELOG 0.10.7）。
 */
export const RECONCILE_NOTIFIED_KEY = 'dshm-reconcile-notified'

/** 读已读集合：缺键/损坏 JSON/非数组 → 空 Set（容错）；storage 缺席 → 空 Set（SSR/探针零操作）。 */
export function readReconcileNotified(storage) {
  if (!storage || typeof storage.getItem !== 'function') return new Set()
  try {
    const raw = storage.getItem(RECONCILE_NOTIFIED_KEY)
    if (typeof raw !== 'string' || raw === '') return new Set()
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((k) => typeof k === 'string'))
  } catch {
    return new Set()
  }
}

/** 写已读集合：配额/私有模式等异常静默放弃持久化（横幅可能重复一次，不致命）。 */
export function writeReconcileNotified(storage, keys) {
  if (!storage || typeof storage.setItem !== 'function') return
  try {
    storage.setItem(RECONCILE_NOTIFIED_KEY, JSON.stringify([...keys]))
  } catch {
    /* 容错：放弃持久化 */
  }
}

/**
 * 恢复校验（必须在 installed 数据 resolve 之后调用——数据未到位时等待而非默认判定）：
 * @param {OperationRecord[]} records
 * @param {(rec: OperationRecord) => Promise<boolean>} stillApplies 前提判定（调用方以实读数据实现）
 * @param {(rec: OperationRecord) => Promise<string|undefined>} [installedVersionOf]
 *   0.10.3 挂账 1：中断升级的账实复读缝——返回 rec.target 的实装版本（未知/缺席 = undefined）。
 *   0.10.6 匹配放宽：升级类 running 残留若账面「已到或已超过」meta.toVersion（reachedVersion），
 *   改判 done（meta.reconciledAfterRestart 留痕、toVersion 落为实装版）；否则保持「进程重启中断」原语义。
 *   0.10.20：改判时 meta.to 同步回填实装版（展示键）；meta.from 沿用三站点入队持久化值
 *   （chip=version、已装列表=it.version、市场卡=it.installedVersion），旧残留缺席则不造键。
 * @returns {Promise<OperationRecord[]>} 改标后的记录列表（不落库；由调用方 replaceAll）
 */
export async function restoreRecords(records, stillApplies, installedVersionOf) {
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
      // 0.10.3（挂账 1，0.10.2 真机事件）：升级/自升级中断 ≠ 一定失败——installBundle 可能已写穿
      // 账面（post-write 伪失败）而面板随宿主换装重载打断了泵落账。实读账面：已到 meta.toVersion
      // = 升级事实成立，改判 done（reconciledAfterRestart 留痕）；否则保持中断原语义。
      if (
        rec.kind === 'upgrade' &&
        rec.meta && typeof rec.meta.toVersion === 'string' && rec.meta.toVersion !== '' &&
        typeof installedVersionOf === 'function'
      ) {
        let installed
        try {
          installed = await installedVersionOf(rec)
        } catch {
          installed = undefined
        }
        // 0.10.6（0.10.5 dogfood 实证）：匹配放宽为「已到或已超过」（reachedVersion，rc-aware ≥）——
        // 跨版本滞后记录也能收口；meta.toVersion 落为实装版——补报文案数据源不再显示滞后值。
        // 0.10.20：meta.to（展示键，opRowVm 渲染 v旧→v新 只认 from/to）同步回填实装版；meta.from 沿用
        // 三站点入队持久化值（旧残留缺席时不造键，渲染回退「→v新」）——改判行不再丢版本变迁
        //（2026-10-26 真机实证：dsh-m 0.10.18→0.10.19 自升级中断经对账改判后行内版本串裸奔）。
        if (installed !== undefined && reachedVersion(installed, rec.meta.toVersion)) {
          out.push({
            ...rec,
            status: 'done',
            error: undefined,
            meta: { ...rec.meta, to: installed, toVersion: installed, reconciledAfterRestart: true },
            updatedAt: Date.now(),
          })
          continue
        }
      }
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
 * - 执行器成功值可带 opMeta（0.9.75）：对象则并入记录 meta（落账时实读的当前 meta 为底、
 *   opMeta 覆写同名键，session 标记保留），upgrade 调用方借此把 from/to 版本变迁落账；
 *   失败路径不并入。
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
            // 0.9.75：恢复成功值同样进成功值通道（opMeta 可落账）。生产 dispatchRestored 今日
            // 返回 { ok: true }，此赋值对现有流零行为变化；opWarning 若未来出现也不再被吞。
            else value = r
          } else {
            err = new Error('无执行上下文（面板未挂载）')
          }
        } catch (e) {
          err = e
        }
        if (!err) {
          // 0.9.75：执行器可回传 opMeta（如 upgrade 的 { from, to } 版本变迁）——并入记录 meta。
          // 底座取**落账时实读**的当前记录 meta（而非入队快照 queued.meta）：拾取阶段追加的
          // session 标记（R3 所有权凭证）不得在合并时被抹掉；opMeta 覆写同名键。
          // 仅成功/warned 路径生效；失败路径结果不可信，不入账。
          const opMeta = value && typeof value === 'object' && value.opMeta && typeof value.opMeta === 'object' ? value.opMeta : null
          const cur = opMeta ? store.list().find((x) => x.id === queued.id) : null
          // 0.10.0 R12：降级恢复（升级失败但已自动回装旧版）复用既有 'warned' 状态落账（零新状态、
          // 零新状态文案键）——meta 携带 {degraded, restoredTo}；opsAttention 对 warned 的既有统计
          // 自动点亮设置 Tab 红点，× 删除走既有 op.remove 通道（R13）。
          const degraded = value && typeof value === 'object' && value.degraded === true
            ? { degraded: true, restoredTo: value.restoredTo }
            : null
          const mergedMeta = opMeta || degraded ? { ...((cur && cur.meta) || {}), ...(opMeta || {}), ...(degraded || {}) } : null
          finalize({
            status: (value && value.opWarning) || degraded ? 'warned' : 'done',
            warning: value && value.opWarning,
            ...(mergedMeta ? { meta: mergedMeta } : {}),
          })
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
