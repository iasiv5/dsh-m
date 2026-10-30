/**
 * 0.7.0 Task 13：全局操作记录纯模块——store CRUD/持久化往返/恢复四分支/
 * drain 二次校验（执行时实读）/superseded 语义/持久化降级。
 * 运行：node --test tests/client-operations.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createOperationsStore, restoreRecords, createOpsPump, opAppliesTo, reachedVersion, readReconcileNotified, writeReconcileNotified, RECONCILE_NOTIFIED_KEY, OP_STORAGE_KEY, upgradeNotify, TERMINAL_CLEARABLE, REGISTRY_DEFAULT_TARGET } from '../src/client/operations.js'
import { groupOpsByDay, opRowVm } from '../src/client/operations-view.js'

/** localStorage mock（可注入故障）。 */
function memStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v))
    },
    removeItem: (k) => m.delete(k),
    _map: m,
  }
}

const rec = (over = {}) => ({
  id: 'op-1',
  kind: 'install',
  target: 'demo--plugin',
  status: 'queued',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

describe('createOperationsStore', () => {
  it('upsert/list/remove/clearFinished 基本流', () => {
    const store = createOperationsStore(memStorage())
    store.upsert(rec())
    store.upsert(rec({ id: 'op-2', kind: 'uninstall', target: 'pkg-a' }))
    assert.equal(store.list().length, 2)
    store.upsert(rec({ id: 'op-2', status: 'done' }))
    store.upsert(rec({ status: 'failed', error: 'x' })) // 同 id 覆盖
    assert.equal(store.list().length, 2)
    assert.equal(store.list().find((r) => r.id === 'op-1').status, 'failed')
    store.upsert(rec({ id: 'op-3', status: 'superseded' }))
    store.upsert(rec({ id: 'op-4', status: 'warned', warning: 'w' }))
    let next = store.clearFinished()
    // 0.9.6 主人裁决：done/warned/failed/superseded 全部终态可清（推翻 0.7.0「失败保留」共识）
    assert.deepEqual(next, [])
    next = store.remove('op-1')
    assert.deepEqual(next, [])
  })

  it('localStorage 持久化往返：新 store 读到旧记录', () => {
    const storage = memStorage()
    const a = createOperationsStore(storage)
    a.upsert(rec({ id: 'keep-1', kind: 'toggle', target: 'pkg-t', meta: { on: true } }))
    const b = createOperationsStore(storage)
    const r = b.list().find((x) => x.id === 'keep-1')
    assert.ok(r)
    assert.equal(r.kind, 'toggle')
    assert.deepEqual(r.meta, { on: true })
    assert.equal(storage.getItem(OP_STORAGE_KEY).includes('keep-1'), true)
  })

  it('持久化异常静默降级：persistDegraded 置位、不抛、内存态可用', () => {
    const boom = {
      getItem: () => {
        throw new Error('quota')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    const store = createOperationsStore(boom)
    store.upsert(rec())
    assert.equal(store.persistDegraded, true)
    assert.equal(store.list().length, 1)
    // storage 缺失（null）同样内存态
    const s2 = createOperationsStore(null)
    s2.upsert(rec({ id: 'x' }))
    assert.equal(s2.list().length, 1)
  })

  it('脏持久化数据安全收敛（非数组/坏条目剔除）', () => {
    const storage = memStorage()
    storage.setItem(OP_STORAGE_KEY, JSON.stringify([{ id: 'ok', kind: 'install', target: 't', status: 'done', createdAt: 1, updatedAt: 1 }, null, { bad: true }, 'x']))
    const store = createOperationsStore(storage)
    assert.equal(store.list().length, 1)
  })
})

describe('restoreRecords（恢复四分支）', () => {
  it('queued 成立→保持；不成立→superseded；input→failed；running→failed；终态原样', async () => {
    const records = [
      rec({ id: 'q-ok', status: 'queued' }),
      rec({ id: 'q-bad', status: 'queued', kind: 'uninstall', target: 'pkg-x' }),
      rec({ id: 'in-1', status: 'input', inputKind: 'peer-incompatible' }),
      rec({ id: 'run-1', status: 'running' }),
      rec({ id: 'done-1', status: 'done' }),
      rec({ id: 'sup-1', status: 'superseded' }),
    ]
    const stillApplies = async (r) => r.target !== 'pkg-x'
    const out = await restoreRecords(records, stillApplies)
    const by = Object.fromEntries(out.map((r) => [r.id, r.status]))
    assert.equal(by['q-ok'], 'queued')
    assert.equal(by['q-bad'], 'superseded')
    assert.equal(by['in-1'], 'failed')
    assert.equal(by['run-1'], 'failed')
    assert.equal(by['done-1'], 'done')
    assert.equal(by['sup-1'], 'superseded')
    // superseded/failed 带原因
    assert.ok(out.find((r) => r.id === 'q-bad').error.includes('前提消失'))
    assert.ok(out.find((r) => r.id === 'in-1').error.includes('重新发起'))
    assert.ok(out.find((r) => r.id === 'run-1').error.includes('重启中断'))
  })

  it('stillApplies 抛错按不成立处理', async () => {
    const out = await restoreRecords([rec({ id: 'e-1', status: 'queued' })], async () => {
      throw new Error('db down')
    })
    assert.equal(out[0].status, 'superseded')
  })
})


describe('session 活会话标记（0.7.0 终审·新伤1）', () => {
  it('restoreRecords 跳过带 session 标记的记录（running 不被误标「重启中断」）', async () => {
    const out = await restoreRecords(
      [
        rec({ id: 's-run', status: 'running', meta: { session: true } }),
        rec({ id: 's-q', status: 'queued', meta: { session: true } }),
        rec({ id: 'p-run', status: 'running' }),
      ],
      async () => true,
    )
    const by = Object.fromEntries(out.map((r) => [r.id, r.status]))
    assert.equal(by['s-run'], 'running', '活会话 running 不改标（面板重挂载 ≠ 进程重启）')
    assert.equal(by['s-q'], 'queued', '活会话 queued 保持待泵执行')
    assert.equal(by['p-run'], 'failed', '无标记 running 照常标「重启中断」')
  })

  it('persist 剥离 session 标记：重载后（新 store）读到无标记记录，走正常恢复分支', async () => {
    const storage = memStorage()
    const a = createOperationsStore(storage)
    a.upsert(rec({ id: 'q-1', status: 'queued', meta: { session: true, npm: 'x' } }))
    const persisted = JSON.parse(storage.getItem(OP_STORAGE_KEY))
    assert.equal(persisted[0].meta.session, undefined, '持久层无 session 标记')
    assert.equal(persisted[0].meta.npm, 'x', '其余 meta 字段保留')
    const b = createOperationsStore(storage)
    assert.equal(b.list()[0].meta.session, undefined, '重载后内存态也无标记')
    const restored = await restoreRecords(b.list(), async () => true)
    assert.equal(restored[0].status, 'queued', '重载后的 queued 走正常恢复（不因残留标记被跳过）')
  })
})

describe('replaceAll 合并语义（0.7.0 评审 P1：恢复快照不抹掉窗口内新增/删除）', () => {
  it('窗口内新增的记录保留——不被旧快照整体覆盖', () => {
    const store = createOperationsStore(memStorage())
    store.upsert(rec({ id: 'old', status: 'queued' }))
    const snapshot = store.list() // restoreRecords 拿到的快照
    // 校验 await 窗口内用户发起新操作（模拟：restoreRecords 期间的 runOp）
    store.upsert(rec({ id: 'new-in-window', status: 'queued', meta: { session: true } }))
    store.replaceAll(snapshot.map((r) => ({ ...r, status: 'superseded' })))
    const ids = store.list().map((r) => r.id)
    assert.ok(ids.includes('new-in-window'), '窗口内新增不被抹掉')
    assert.equal(store.list().find((r) => r.id === 'old').status, 'superseded', '快照内记录按校验结果覆写')
  })

  it('窗口内被用户删除的记录不复活', () => {
    const store = createOperationsStore(memStorage())
    store.upsert(rec({ id: 'doomed', status: 'queued' }))
    const snapshot = store.list()
    store.remove('doomed') // 窗口内 onRemove
    store.replaceAll(snapshot)
    assert.equal(store.list().find((r) => r.id === 'doomed'), undefined, '已删记录不被快照复活')
  })

  it('活会话记录不被快照旧态回卷（done 不被覆写回 queued）', () => {
    const store = createOperationsStore(memStorage())
    store.upsert(rec({ id: 'live', status: 'done', meta: { session: true } })) // 泵已完成（current 权威）
    const staleSnapshot = [rec({ id: 'live', status: 'queued', meta: { session: true } })] // 恢复前拍的旧快照
    store.replaceAll(staleSnapshot)
    assert.equal(store.list()[0].status, 'done', 'session 记录保持 current 版本')
  })
})

describe('opAppliesTo 前提判定（0.7.0 评审 P2）', () => {
  const items = [
    { pkg: 'plain-pkg' },
    { pkg: '@scope/wrapper', registryGithub: 'owner/repo' },
  ]
  it('install：target ∪ meta.npm ∪ registryGithub=meta.github 三键任一命中即「已装」', () => {
    assert.equal(opAppliesTo(rec({ kind: 'install', target: 'plain-pkg' }), items), false, 'target 命中')
    assert.equal(opAppliesTo(rec({ kind: 'install', target: 'id-x', meta: { npm: '@scope/wrapper' } }), items), false, 'meta.npm 命中')
    assert.equal(opAppliesTo(rec({ kind: 'install', target: 'owner--repo', meta: { github: 'owner/repo' } }), items), false, 'meta.github 命中（github 源已装）')
    assert.equal(opAppliesTo(rec({ kind: 'install', target: 'not-there', meta: { npm: 'absent' } }), items), true, '未装 → 前提成立')
  })
  it('upgrade/uninstall/toggle：target 已装才成立', () => {
    assert.equal(opAppliesTo(rec({ kind: 'uninstall', target: 'plain-pkg' }), items), true)
    assert.equal(opAppliesTo(rec({ kind: 'toggle', target: 'missing' }), items), false)
    assert.equal(opAppliesTo(rec({ kind: 'install', target: 'x' }), null), true, '脏输入安全')
  })
})

describe('createOpsPump（0.7.0 评审 P4：生产泵的直接测试）', () => {
  function setup(ctx) {
    const store = createOperationsStore(memStorage())
    let current = ctx
    const pump = createOpsPump(store, () => current)
    return { store, pump, setCtx: (c) => { current = c } }
  }

  it('FIFO 逐条流转：queued→running→done，按入队顺序', async () => {
    const { store, pump } = setup(null)
    const order = []
    const p1 = pump.enqueue(rec({ id: 'a', target: 't-a', status: 'queued' }), async () => { order.push('a'); return { okv: 1 } })
    const p2 = pump.enqueue(rec({ id: 'b', target: 't-b', status: 'queued' }), async () => { order.push('b'); return { okv: 2 } })
    assert.equal((await p1).okv, 1)
    assert.equal((await p2).okv, 2)
    assert.deepEqual(order, ['a', 'b'], 'FIFO')
    const statuses = store.list().map((r) => r.status)
    assert.deepEqual(statuses, ['done', 'done'])
  })

  it('stillApplies=false → superseded，waiter 收到 e.opSuperseded', async () => {
    const { store, pump } = setup({ stillApplies: async (r) => r.target !== 'gone' })
    const caught = pump.enqueue(rec({ id: 'g', target: 'gone', status: 'queued' }), async () => { throw new Error('should not run') })
      .then(() => null, (e) => e)
    const e = await caught
    assert.ok(e && e.opSuperseded === true && e.opId === 'g')
    assert.equal(store.list()[0].status, 'superseded')
  })

  it('错误保真：原始 Error（含 issue 结构）随 opId 拒绝 waiter；issue→input 态', async () => {
    const { store, pump } = setup(null)
    const peerErr = Object.assign(new Error('peer mismatch'), { issue: { pkg: 'p', peers: {} } })
    const e = await pump.enqueue(rec({ id: 'p1', target: 't', status: 'queued' }), async () => { throw peerErr })
      .then(() => null, (err) => err)
    assert.equal(e, peerErr, '同一 Error 引用（结构保真）')
    assert.equal(e.opId, 'p1')
    const stored = store.list()[0]
    assert.equal(stored.status, 'input')
    assert.equal(stored.inputKind, 'peer-incompatible')
  })

  it('opWarning → warned 态；恢复记录（无执行器）走 dispatchRestored，issue 透传 → input', async () => {
    const store = createOperationsStore(memStorage())
    const dispatches = []
    const pump = createOpsPump(store, () => ({
      dispatchRestored: async (r) => {
        dispatches.push(r.id)
        return r.id === 'ok-one' ? { ok: true } : { ok: false, error: 'peer', issue: { pkg: 'x' } }
      },
    }))
    store.upsert(rec({ id: 'ok-one', target: 't1', status: 'queued' }))
    store.upsert(rec({ id: 'bad-one', target: 't2', status: 'queued' }))
    pump.kick()
    await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(dispatches, ['ok-one', 'bad-one'])
    const by = Object.fromEntries(store.list().map((r) => [r.id, r.status]))
    assert.equal(by['ok-one'], 'done')
    assert.equal(by['bad-one'], 'input', '恢复遇 peer 冲突 → input（待决）')
    // opWarning → warned（前台执行器路径）
    const p2 = createOpsPump(store, () => null)
    await p2.enqueue(rec({ id: 'w', target: 't-w', status: 'queued' }), async () => ({ opWarning: 'builds approved' }))
    const w = store.list().find((r) => r.id === 'w')
    assert.equal(w.status, 'warned')
    assert.equal(w.warning, 'builds approved')
  })

  describe('opMeta 落账（0.9.75：执行器成功值回传版本变迁等参数进 meta）', () => {
    it('done：opMeta 并入 meta（实读 meta 为底——session 标记保留；opMeta 覆写同名键）', async () => {
      const { store, pump } = setup(null)
      await pump.enqueue(
        rec({ id: 'm1', target: 't-m1', status: 'queued', meta: { on: true, from: 'stale' } }),
        async () => ({ okv: 1, opMeta: { from: '0.9.71', to: '0.9.72' } }),
      )
      const stored = store.list().find((r) => r.id === 'm1')
      assert.equal(stored.status, 'done')
      assert.deepEqual(stored.meta, { on: true, from: '0.9.71', to: '0.9.72', session: true }, '入队 meta 为底 + opMeta 覆写 + session 保留')
    })
    it('warned 同样入账（部分成功也有版本事实）', async () => {
      const { store, pump } = setup(null)
      await pump.enqueue(rec({ id: 'm2', target: 't-m2', status: 'queued' }), async () => ({ opWarning: 'builds', opMeta: { to: '2.0.0' } }))
      const stored = store.list().find((r) => r.id === 'm2')
      assert.equal(stored.status, 'warned')
      assert.deepEqual(stored.meta, { to: '2.0.0', session: true })
    })
    it('失败路径不入账（结果不可信）；无 opMeta / 非对象 opMeta → meta 零扰动', async () => {
      const { store, pump } = setup(null)
      const p1 = pump.enqueue(rec({ id: 'm3', target: 't-m3', status: 'queued', meta: { on: true } }), async () => {
        throw new Error('boom')
      }).then(() => null, (e) => e)
      await p1
      assert.deepEqual(store.list().find((r) => r.id === 'm3').meta, { on: true, session: true }, '失败不并入')
      await pump.enqueue(rec({ id: 'm4', target: 't-m4', status: 'queued', meta: { on: true } }), async () => ({ okv: 1 }))
      await pump.enqueue(rec({ id: 'm5', target: 't-m5', status: 'queued', meta: { on: true } }), async () => ({ okv: 1, opMeta: 'dirty' }))
      assert.deepEqual(store.list().find((r) => r.id === 'm4').meta, { on: true, session: true })
      assert.deepEqual(store.list().find((r) => r.id === 'm5').meta, { on: true, session: true })
    })
    it('恢复路径（dispatchRestored）结果带 opMeta 同样入账', async () => {
      const store = createOperationsStore(memStorage())
      store.upsert(rec({ id: 'm6', target: 't-m6', status: 'queued' }))
      const pump = createOpsPump(store, () => ({
        dispatchRestored: async () => ({ ok: true, opMeta: { to: '3.0.0' } }),
      }))
      pump.kick()
      await new Promise((r) => setTimeout(r, 20))
      const stored = store.list().find((r) => r.id === 'm6')
      assert.equal(stored.status, 'done')
      assert.equal(stored.meta.to, '3.0.0')
    })
  })

  // ---------- 0.10.0 Task 12：降级恢复落账（R12/R13）——零新状态，复用 'warned' + meta 载荷 ----------
  describe('降级恢复落账（0.10.0 Task 12）', () => {
    it('① runOp 收到 degraded:true + restoredTo 结果 → 落账 status warned 且 meta 携带 degraded/restoredTo（opMeta 同账合并）', async () => {
      const { store, pump } = setup(null)
      await pump.enqueue(
        rec({ id: 'dg1', kind: 'upgrade', target: 'dsh-m', status: 'queued' }),
        async () => ({ degraded: true, restoredTo: '0.9.0', opMeta: { from: '0.9.0', to: '0.10.0' } }),
      )
      const stored = store.list().find((r) => r.id === 'dg1')
      assert.equal(stored.status, 'warned', '降级复用既有 warned 态（零新状态、零新文案键）——opsAttention 口径（failed||warned）据此自动点亮设置 Tab 红点')
      assert.equal(stored.meta.degraded, true)
      assert.equal(stored.meta.restoredTo, '0.9.0')
      assert.equal(stored.meta.to, '0.10.0', 'opMeta 版本事实同账保留')
    })

    it('② 非 degraded 结果零行为漂移：普通 done 与 opWarning→warned 路径原样、零 meta 污染', async () => {
      const { store, pump } = setup(null)
      await pump.enqueue(rec({ id: 'n1', target: 't1', status: 'queued' }), async () => ({ okv: 1 }))
      await pump.enqueue(rec({ id: 'n2', target: 't2', status: 'queued' }), async () => ({ opWarning: 'x' }))
      await pump.enqueue(rec({ id: 'n3', target: 't3', status: 'queued' }), async () => ({ degraded: false, restoredTo: '0.9.0' }))
      const by = Object.fromEntries(store.list().map((r) => [r.id, r.status]))
      assert.equal(by.n1, 'done')
      assert.equal(by.n2, 'warned')
      assert.equal(by.n3, 'done', 'degraded:false 不命中新分支')
      assert.equal(store.list().find((r) => r.id === 'n3').meta.degraded, undefined, '非降级零 meta 污染')
    })

    it('③ 徽标口径与 × 删除通道零改动（源锚，ADR-0023 T10：× 通道锚随 OperationsCard 迁 operations-card.jsx）', () => {
      const src = readFileSync(new URL('../src/client/main.jsx', import.meta.url), 'utf8')
      const ocSrc = readFileSync(new URL('../src/client/operations-card.jsx', import.meta.url), 'utf8')
      assert.ok(
        src.includes('const opsAttention = opRecords.some((r) => r.status === "failed" || r.status === "warned");'),
        '红点口径 failed||warned 原样在（MarketPanel，main.jsx 保留区）——dismiss（移除记录）后随 syncOps 自灭（R13 徽标清零路径）',
      )
      assert.ok(ocSrc.includes('title: lookup("op.remove")'), '× 删除走既有 op.remove 通道（operations-card.jsx；删除仅移除记录，不改真实插件状态字段）')
    })
  })
})

// ---------- 0.10.3（挂账 1，0.10.2 真机事件）：恢复记账对账——中断升级若账面已到目标版则改判完成 ----------

describe('restoreRecords 恢复记账对账（0.10.3 挂账 1）', () => {
  const running = (over = {}) => rec({ id: 'r1', kind: 'upgrade', target: 'pkg-a', status: 'running', meta: { toVersion: '2.0.0', session: undefined }, ...over })
  const ivo = (v) => async () => v

  it('① running 升级中断 + 账面已到目标版 → 改判 done（reconciledAfterRestart 留痕、error 清零）', async () => {
    const out = await restoreRecords([running()], ivo('2.0.0'), ivo('2.0.0'))
    assert.equal(out[0].status, 'done')
    assert.equal(out[0].error, undefined, '中断文案清零（不残留假失败）')
    assert.equal(out[0].meta.reconciledAfterRestart, true, '改判留痕')
    assert.equal(out[0].meta.toVersion, '2.0.0')
  })

  it('② 账面未到目标版 → 保持「进程重启中断」失败标注（真中断不洗白）', async () => {
    const out = await restoreRecords([running()], ivo('2.0.0'), ivo('1.0.0'))
    assert.equal(out[0].status, 'failed')
    assert.equal(out[0].error, '进程重启中断')
  })

  it('③ 无 meta.toVersion / 非 upgrade kind / 未传 installedVersionOf → 原语义（向后兼容）', async () => {
    const noMeta = await restoreRecords([running({ meta: {} })], ivo('2.0.0'), ivo('2.0.0'))
    assert.equal(noMeta[0].status, 'failed')
    const nonUpgrade = await restoreRecords([running({ kind: 'install' })], ivo('2.0.0'), ivo('2.0.0'))
    assert.equal(nonUpgrade[0].status, 'failed')
    const legacy = await restoreRecords([running()], ivo('2.0.0'))
    assert.equal(legacy[0].status, 'failed', '不传第三参 = 原行为（既有调用方零迁移）')
  })
})

// ---------- 0.10.6（0.10.5 dogfood 实证）：对账匹配放宽为「已到或已超过」+ 补报文案用实装版 ----------

describe('reachedVersion（0.10.6：rc-aware 语义化 ≥ 比较，pure）', () => {
  it('相等 / core 更大 → true；core 更小 → false', () => {
    assert.equal(reachedVersion('0.10.4', '0.10.4'), true)
    assert.equal(reachedVersion('0.10.5', '0.10.4'), true)
    assert.equal(reachedVersion('0.10.4', '0.10.5'), false)
    assert.equal(reachedVersion('1.0.0', '0.9.9'), true)
  })
  it('预发布序：同 core 下 rc.2 ≥ rc.1；无预发布 ≥ 有预发布；有预发布 < 无预发布', () => {
    assert.equal(reachedVersion('0.2.1-rc.2', '0.2.1-rc.1'), true)
    assert.equal(reachedVersion('0.2.1-rc.1', '0.2.1-rc.2'), false)
    assert.equal(reachedVersion('0.2.1', '0.2.1-rc.2'), true)
    assert.equal(reachedVersion('0.2.1-rc.2', '0.2.1'), false)
  })
  it('非法形态 → false（不抛）', () => {
    assert.equal(reachedVersion('junk', '0.10.4'), false)
    assert.equal(reachedVersion('0.10.4', 'junk'), false)
    assert.equal(reachedVersion(undefined, '0.10.4'), false)
  })
})

describe('restoreRecords 对账匹配放宽（0.10.6 挂账 1 收口）', () => {
  const running = (over = {}) => rec({ id: 'r1', kind: 'upgrade', target: 'pkg-a', status: 'running', meta: { toVersion: '0.10.4' }, ...over })
  const ivo = (v) => async () => v
  it('④ 账面已「超过」目标版（0.10.5 > 记录 0.10.4）→ 改判 done 且 meta.toVersion 落实装版（补报不显示滞后值）', async () => {
    const out = await restoreRecords([running()], ivo('2.0.0'), ivo('0.10.5'))
    assert.equal(out[0].status, 'done', '滞后记录收口（不再反复打扰）')
    assert.equal(out[0].meta.toVersion, '0.10.5', '补报文案数据源 = 实装版')
    assert.equal(out[0].meta.reconciledAfterRestart, true)
  })
})

// ---------- 0.10.20（2026-10-26 真机实证）：对账改判行丢版本变迁——meta.to 回填实装版 + 入队 from 持久化 ----------

describe('restoreRecords 对账改判回填展示键（0.10.20：toVersion 之外的 meta.from / meta.to）', () => {
  const running = (over = {}) => rec({ id: 'r1', kind: 'upgrade', target: 'pkg-a', status: 'running', meta: { from: '1.0.0', toVersion: '2.0.0' }, ...over })
  const ivo = (v) => async () => v

  it('⑤ 改判 done：meta.from（入队持久化）原样保留、meta.to 回填实装版——展示键齐备', async () => {
    const out = await restoreRecords([running()], ivo('2.0.0'), ivo('2.0.0'))
    assert.equal(out[0].status, 'done')
    assert.equal(out[0].meta.from, '1.0.0', 'from = 入队时实装版（对账不得改写/丢失）')
    assert.equal(out[0].meta.to, '2.0.0', 'to = 对账实读的实装版（展示键回填）')
    assert.equal(out[0].meta.toVersion, '2.0.0', '比对键照旧落实装版（0.10.6 语义不变）')
    assert.equal(out[0].meta.reconciledAfterRestart, true)
  })

  it('⑥ 旧残留无 meta.from → 改判不造 from 键，仅回填 to（渲染回退「→v新」）', async () => {
    const out = await restoreRecords([running({ meta: { toVersion: '2.0.0' } })], ivo('2.0.0'), ivo('2.0.0'))
    assert.equal(out[0].status, 'done')
    assert.equal('from' in out[0].meta, false, '不得出现 from: undefined（persist 序列化噪音）')
    assert.equal(out[0].meta.to, '2.0.0')
  })

  it('⑦ 端到端：改判输出喂 opRowVm 渲染出 v旧→v新（0.10.18→0.10.19 行裸奔的回归锚）', async () => {
    const out = await restoreRecords([running({ meta: { from: '0.10.18', toVersion: '0.10.19' } })], ivo('0.10.19'), ivo('0.10.19'))
    assert.equal(out[0].status, 'done')
    assert.equal(opRowVm(out[0]).version, 'v0.10.18→v0.10.19')
  })

  it('⑧ 账面未到目标版 → 仍走「进程重启中断」，meta 不回填展示键（失败行不改账）', async () => {
    const out = await restoreRecords([running()], ivo('2.0.0'), ivo('1.0.0'))
    assert.equal(out[0].status, 'failed')
    assert.equal(out[0].error, '进程重启中断')
    assert.equal('to' in out[0].meta, false, '失败路径零 meta 改写')
  })
})

// ---------- 0.10.4（挂账 1 延伸）：恢复对账改判完成的升级记录补成功横幅 ----------
describe('恢复对账改判补横幅（0.10.4，main.jsx 源锚）', () => {
  it('恢复流程消费 reconciledAfterRestart 标记并补完成横幅（0.10.3 事件实证：成功结局会随面板重载静默）', () => {
    const src = readFileSync(new URL('../src/client/main.jsx', import.meta.url), 'utf8')
    // ADR-0023 第二刀：编排迁 panel-ops.js——消费锚改读 panel-ops 源 + 行为测试双保险（tests/client-panel-ops）
    const po = readFileSync(new URL('../src/client/panel-ops.js', import.meta.url), 'utf8')
    assert.ok(po.includes("i18nKey: 'upgrade.reconciled.done'"), '恢复对账完成横幅键（panel-ops 计划函数）')
    assert.ok(po.includes('r.meta.reconciledAfterRestart'), '改判标记消费在（panel-ops）')
    assert.ok(src.includes('lookup(n.i18nKey, n.params)'), '适配器按计划渲染通知文案（main.jsx）')
    // 0.10.5：横幅键必须在双字典定义（0.10.4 真机实证漏定义 → 用户看到裸键名 toast）
    // ADR-0023 T1：词典面改读 i18n.js
    const i18nSrc = readFileSync(new URL('../src/client/i18n.js', import.meta.url), 'utf8')
    assert.equal(i18nSrc.split('"upgrade.reconciled.done": "').length - 1, 2, '文案键双语在位（防裸键名回归）')
  })
})

// ---------- 0.10.7（A 方案，主人裁决）：对账补横幅一次性化——独立已读集合 + 先落账后补报 ----------
describe('对账补横幅一次性化（0.10.7，main.jsx 源锚 + 已读集合纯函数）', () => {
  it('① restore 时序反转：replaceAll（落账）先于补报 notify；persist 抛错静默放弃该次补报并留诊断', () => {
    const src = readFileSync(new URL('../src/client/main.jsx', import.meta.url), 'utf8')
    // ADR-0023 第二刀：适配器锚——replaceAll(plan.replacements) 先于 lookup(n.i18nKey) 补报
    const idxReplace = src.indexOf('opsStore.replaceAll(plan.replacements);')
    const idxNotify = src.indexOf('lookup(n.i18nKey, n.params)')
    assert.ok(idxReplace >= 0 && idxNotify > idxReplace, '先落账后补报（弹的时候账已落）')
    assert.ok(src.includes('restore persist failed'), 'persist 抛错诊断留痕（Q5-a）')
  })

  it('② 已读集合接线：读（适配器）→ has 去重（计划函数）→ add + 写回（适配器逐条落账序）', () => {
    const src = readFileSync(new URL('../src/client/main.jsx', import.meta.url), 'utf8')
    const po = readFileSync(new URL('../src/client/panel-ops.js', import.meta.url), 'utf8')
    assert.ok(src.includes('readReconcileNotified('), '读已读集合（适配器）')
    assert.ok(po.includes('seenKeys.has(key)'), '去重判在（panel-ops 计划函数）')
    assert.ok(src.includes('seen.add(n.dedupeKey);') && src.includes('writeReconcileNotified('), '逐条 add → 写回（适配器，崩溃窗口语义与 0.10.7 逐字节一致）')
  })

  it('③ readReconcileNotified：缺键/损坏 JSON/非数组 → 空 Set；合法 → Set', () => {
    const empty = memStorage()
    assert.deepEqual([...readReconcileNotified(empty)], [], '缺键 → 空 Set')
    empty.setItem(RECONCILE_NOTIFIED_KEY, '{corrupt')
    assert.deepEqual([...readReconcileNotified(empty)], [], '损坏 JSON → 空 Set（容错）')
    empty.setItem(RECONCILE_NOTIFIED_KEY, 'not-an-array')
    assert.deepEqual([...readReconcileNotified(empty)], [], '非数组 → 空 Set（容错）')
    empty.setItem(RECONCILE_NOTIFIED_KEY, JSON.stringify(['a|pkg-a|1.0.0', 42, null]))
    assert.deepEqual([...readReconcileNotified(empty)], ['a|pkg-a|1.0.0'], '合法数组 → 只留字符串成员')
  })

  it('④ writeReconcileNotified：roundtrip + null storage 零抛（私有模式/配额容错）', () => {
    const s = memStorage()
    writeReconcileNotified(s, new Set(['x|t|0.1.0']))
    assert.deepEqual([...readReconcileNotified(s)], ['x|t|0.1.0'], 'roundtrip')
    assert.doesNotThrow(() => writeReconcileNotified(null, new Set(['k'])), 'null storage 不抛')
    assert.doesNotThrow(() => readReconcileNotified(null), 'null storage 读不抛')
    assert.equal(readReconcileNotified(null).size, 0)
  })
})

describe('恢复所有权语义（R3·N1 修正：session 标记区分泵拥有 vs 崩溃残留）', () => {
  it('端到端：crashed running（无标记）经 restoreRecords→replaceAll 落库为 failed「进程重启中断」', async () => {
    const storage = memStorage()
    // 模拟崩溃现场：上一会话的 running 持久化时被剥离 session 标记
    const prev = createOperationsStore(storage)
    prev.upsert(rec({ id: 'crashed', target: 't', status: 'running', meta: { session: true } }))
    // 重载：新 store 读到无标记 running
    const store = createOperationsStore(storage)
    assert.equal(store.list()[0].meta.session, undefined)
    const restored = await restoreRecords(store.list(), async () => true)
    assert.equal(restored[0].status, 'failed', 'restoreRecords 判「进程重启中断」')
    store.replaceAll(restored)
    const after = store.list()[0]
    assert.equal(after.status, 'failed', '改标经 replaceAll 落库（不被任何短路挡回）')
    assert.ok((after.error || '').includes('重启中断'))
  })

  it('泵拾取即打 session：恢复 queued 被泵执行到 done 后，陈旧恢复快照不回卷', async () => {
    const store = createOperationsStore(memStorage())
    store.upsert(rec({ id: 'picked', target: 't-p', status: 'queued' })) // 恢复的 queued（无标记）
    const staleSnapshot = store.list() // 恢复校验开始前拍的快照
    // 前台泵先捞到它并执行完（拾取时打 session 标记）
    const pump = createOpsPump(store, () => null)
    await pump.enqueue(staleSnapshot[0], async () => ({ okv: 1 }))
    assert.equal(store.list().find((r) => r.id === 'picked').status, 'done')
    assert.equal(store.list().find((r) => r.id === 'picked').meta.session, true, '泵拾取打了标记')
    // 恢复校验此时才落库（陈旧快照视角还是 queued）——不得回卷
    store.replaceAll(await restoreRecords(staleSnapshot, async () => true))
    assert.equal(store.list().find((r) => r.id === 'picked').status, 'done', '泵拥有的 done 不被回卷')
  })
})

describe('upgradeNotify：升级完成提示三态（0.9.22 生效判定）', () => {
  it('client-only → needsRestart false + 刷新文案后缀键', () => {
    assert.deepEqual(upgradeNotify('client-only'), { needsRestart: false, suffixKey: 'notify.upgraded.clientonly' })
  })

  it('unknown → needsRestart true + 判定未完成后缀键', () => {
    assert.deepEqual(upgradeNotify('unknown'), { needsRestart: true, suffixKey: 'notify.upgraded.activationUnknown' })
  })

  it('restart-required 与缺席 → needsRestart true、无后缀（现状横幅）', () => {
    assert.deepEqual(upgradeNotify('restart-required'), { needsRestart: true, suffixKey: null })
    assert.deepEqual(upgradeNotify(undefined), { needsRestart: true, suffixKey: null })
  })
})

describe('设置类终态直落记录（2026-10-10：community-toggle / registry-url 不入泵）', () => {
  it('done 直落记录跨 restoreRecords 原样保留，且不参与恢复前提校验（不咨询谓词）', async () => {
    const store = createOperationsStore(memStorage())
    store.upsert(rec({ id: 'set-1', kind: 'community-toggle', target: 'community-catalog', status: 'done', meta: { on: false } }))
    store.upsert(rec({ id: 'set-2', kind: 'registry-url', target: 'https://example.com/registry.json', status: 'done', meta: { from: REGISTRY_DEFAULT_TARGET } }))
    // 计数桩（评审 M2）：终态直落记录不得进入 stillApplies 校验——若未来回归对 done/failed 也
    // 咨询谓词，called > 0 立即可证伪。
    let called = 0
    const still = async () => {
      called++
      return false
    }
    const restored = await restoreRecords(store.list(), still)
    assert.equal(called, 0, '终态记录不参与恢复前提校验')
    assert.equal(restored.find((r) => r.id === 'set-1').status, 'done')
    assert.deepEqual(restored.find((r) => r.id === 'set-1').meta, { on: false })
    assert.equal(restored.find((r) => r.id === 'set-2').target, 'https://example.com/registry.json')
    assert.deepEqual(restored.find((r) => r.id === 'set-2').meta, { from: REGISTRY_DEFAULT_TARGET })
    // 快照往返：恢复窗口期快照外新增的直落记录不被 replaceAll 丢失
    const staleSnapshot = store.list()
    store.upsert(rec({ id: 'set-4', kind: 'registry-url', target: REGISTRY_DEFAULT_TARGET, status: 'done', meta: { from: 'https://example.com/registry.json' } }))
    store.replaceAll(await restoreRecords(staleSnapshot, still))
    assert.equal(called, 0, 'replaceAll 路径同样不咨询谓词')
    assert.equal(store.list().some((r) => r.id === 'set-4'), true, '快照外新增不丢')
    assert.equal(store.list().find((r) => r.id === 'set-1').status, 'done', '终态不被旧快照回卷为非终态')
  })

  it('failed 直落记录恢复时保留 failed + error，且落入「清除已结束」范围', async () => {
    const store = createOperationsStore(memStorage())
    store.upsert(rec({ id: 'set-f', kind: 'community-toggle', target: 'community-catalog', status: 'failed', meta: { on: true }, error: '写入设置失败：quota' }))
    const restored = await restoreRecords(store.list(), async () => true)
    assert.equal(restored.find((r) => r.id === 'set-f').status, 'failed', 'failed 终态原样保留（不误标重启中断）')
    assert.equal(restored.find((r) => r.id === 'set-f').error, '写入设置失败：quota')
    assert.equal(TERMINAL_CLEARABLE.has('failed'), true)
    assert.equal(store.clearFinished().some((r) => r.id === 'set-f'), false, 'failed 终态可被清除')
  })

  it('直落记录永不参与泵生命周期：创建即终态；假设性 queued 也会被恢复校验 superseded 而非误派发', () => {
    const store = createOperationsStore(memStorage())
    store.upsert(rec({ id: 'set-3', kind: 'community-toggle', target: 'community-catalog', status: 'done', meta: { on: true } }))
    assert.equal(store.list().some((r) => r.status === 'queued'), false, '设置类记录创建即终态')
    // 评审 M3：target 是对象身份而非包名——即使数据异常落入 queued，opAppliesTo(空 installed)=false
    // ⇒ restoreRecords 改标 superseded，不会进 dispatchRestored 的 set-enabled 兜底分支误执行。
    assert.equal(opAppliesTo(store.list()[0], []), false)
  })
})

// ---------- 外部操作记录 overlay（0.9.79，ADR-0018：内存并读，不写 localStorage） ----------

describe('createOperationsStore × 外部记录 overlay（Task 5）', () => {
  const ext = (over = {}) => ({
    id: 'ext-1',
    at: 1_000,
    channel: 'cli',
    kind: 'upgrade',
    target: 'demo-pkg',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    result: 'ok',
    ...over,
  })

  it('①setExternal 并入 listMerged：与本地记录按 createdAt 升序（groupOpsByDay 假定升序输入）', () => {
    const store = createOperationsStore(memStorage())
    store.upsert(rec({ id: 'local-1', createdAt: 3_000, updatedAt: 3_000, status: 'done' }))
    store.setExternal([ext({ id: 'ext-early', at: 1_000 }), ext({ id: 'ext-late', at: 5_000 })])
    const merged = store.listMerged()
    assert.deepEqual(merged.map((r) => r.id), ['ext-early', 'local-1', 'ext-late'], '升序统一序列')
    // 升序喂 groupOpsByDay 不破分组（组内新→旧由视图层反转）
    const groups = groupOpsByDay(merged)
    assert.ok(groups.length >= 1)
    // 外部记录映射：result→status、at→createdAt、reason→error、from/to→meta
    const e = merged.find((r) => r.id === 'ext-early')
    assert.equal(e.status, 'done')
    assert.equal(e.createdAt, 1_000)
    assert.equal(e.channel, 'cli')
    assert.deepEqual(e.meta, { from: '1.0.0', to: '2.0.0' })
    const ef = merged.find((r) => r.id === 'ext-late')
    assert.equal(ef.kind, 'upgrade')
  })

  it('②persist 序列化不含外部记录（localStorage 纯净性，R1-3）；clearExternal 同步清空 overlay', () => {
    const storage = memStorage()
    const store = createOperationsStore(storage)
    store.upsert(rec({ id: 'local-keep', status: 'done' }))
    store.setExternal([ext({ id: 'ext-only-server' })])
    const persisted = JSON.parse(storage.getItem(OP_STORAGE_KEY))
    assert.ok(persisted.every((r) => r.id !== 'ext-only-server'), '外部记录绝不进 persist 路径')
    assert.equal(store.listMerged().some((r) => r.id === 'ext-only-server'), true, 'overlay 在内存中可见')
    store.clearExternal()
    assert.equal(store.listMerged().some((r) => r.id === 'ext-only-server'), false, '清除联动后 overlay 清空')
    assert.equal(store.list().some((r) => r.id === 'local-keep'), true, '本地记录不受影响')
  })

  it('③按 id 幂等：重复 fetch 同 id 不产生双条（新值覆盖旧值）', () => {
    const store = createOperationsStore(memStorage())
    store.setExternal([ext({ id: 'same', result: 'failed', reason: 'v1' })])
    store.setExternal([ext({ id: 'same', result: 'failed', reason: 'v2' })])
    store.setExternal([ext({ id: 'other' })])
    const merged = store.listMerged().filter((r) => r.id === 'same')
    assert.equal(merged.length, 1, '同 id 合并为一条')
    assert.equal(merged[0].error, 'v2', '后到值覆盖（reason 经 externalToRecord 映射为 error）')
  })

  it('④failed 外部记录点亮红点：映射为 failed 状态（opsAttention 数据源语义）', () => {
    const store = createOperationsStore(memStorage())
    store.setExternal([ext({ id: 'bad', result: 'failed', reason: 'boom' })])
    const m = store.listMerged().find((r) => r.id === 'bad')
    assert.equal(m.status, 'failed', 'opsAttention 的 failed/warned 判定据此点亮')
    assert.equal(m.error, 'boom')
    // 成功记录不点亮
    store.setExternal([ext({ id: 'good', result: 'ok' })])
    assert.equal(store.listMerged().find((r) => r.id === 'good').status, 'done')
  })

  it('外部记录不入泵生命周期：list() 纯本地，泵/恢复语义零扰动', () => {
    const store = createOperationsStore(memStorage())
    store.setExternal([ext({ id: 'ext-x' })])
    assert.equal(store.list().length, 0, 'list() 不含外部记录（泵/restore 只看本地）')
    assert.equal(store.listMerged().length, 1, 'listMerged() 并读两类')
  })

  it('⑤removeExternal 按 id 剔除 overlay：本地记录原样、不存在 id 静默 no-op（0.9.82 修订 R2-3）', () => {
    const store = createOperationsStore(memStorage())
    store.upsert(rec({ id: 'local-1', status: 'done' }))
    store.setExternal([ext({ id: 'ext-a', at: 1_000 }), ext({ id: 'ext-b', at: 2_000 })])
    const merged = store.removeExternal('ext-a')
    assert.equal(merged.some((r) => r.id === 'ext-a'), false, '被删行不在合并视图')
    assert.equal(merged.some((r) => r.id === 'local-1'), true, '本地记录不受影响')
    assert.deepEqual(store.externalList().map((r) => r.id), ['ext-b'])
    // 不存在 id：不抛、视图不变
    const again = store.removeExternal('not-exist')
    assert.deepEqual(again.map((r) => r.id), merged.map((r) => r.id))
  })

  it('⑥墓碑：removeExternal 后迟到 fetch 同 id 不复活；clearExternal 重置墓碑（评审 R1-C3）', () => {
    const store = createOperationsStore(memStorage())
    store.setExternal([ext({ id: 'ext-b', at: 1_000 })])
    store.removeExternal('ext-b')
    // 模拟在途 fetch 迟到响应：删除前发出的 list 结果晚于删除落地
    store.setExternal([ext({ id: 'ext-b', at: 1_000 })])
    assert.equal(store.listMerged().some((r) => r.id === 'ext-b'), false, '墓碑拦住复活')
    // 「清除已结束」重置墓碑：服务端 journal 已整体清空，此后 fetch 并回的是服务端仍存在的行
    store.clearExternal()
    store.setExternal([ext({ id: 'ext-b', at: 1_000 })])
    assert.equal(store.listMerged().some((r) => r.id === 'ext-b'), true, '重置后不再拦截')
  })
})
