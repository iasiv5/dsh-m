/**
 * 0.7.0 Task 13：全局操作记录纯模块——store CRUD/持久化往返/恢复四分支/
 * drain 二次校验（执行时实读）/superseded 语义/持久化降级。
 * 运行：node --test tests/client-operations.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createOperationsStore, restoreRecords, drainRestored, createOpsPump, opAppliesTo, OP_STORAGE_KEY } from '../src/client/operations.js'

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

describe('drainRestored（恢复执行器）', () => {
  function storeWith(records) {
    const store = createOperationsStore(memStorage())
    for (const r of records) store.upsert(r) // 播种用 upsert（P1 后 replaceAll 是恢复写回合并语义，不新增）
    return store
  }

  it('FIFO 逐条执行：成立→running→done；失败→failed；不成立→superseded 且不 dispatch', async () => {
    const store = storeWith([
      rec({ id: 'a', status: 'queued', target: 't-a' }),
      rec({ id: 'b', status: 'queued', target: 't-b' }),
      rec({ id: 'c', status: 'queued', target: 't-c' }),
    ])
    const dispatched = []
    const stillApplies = async (r) => r.target !== 't-c'
    await drainRestored(
      store,
      async (r) => {
        dispatched.push(r.target)
        return r.target === 't-b' ? { ok: false, error: 'boom' } : { ok: true }
      },
      stillApplies,
    )
    assert.deepEqual(dispatched, ['t-a', 't-b'], 't-c 前提消失不 dispatch')
    const by = Object.fromEntries(store.list().map((r) => [r.id, r.status]))
    assert.equal(by.a, 'done')
    assert.equal(by.b, 'failed')
    assert.equal(by.c, 'superseded')
    assert.ok(store.list().find((r) => r.id === 'b').error.includes('boom'))
  })

  it('二次校验为执行时实读：drain dispatch 前重新查询而非复用 restore 快照', async () => {
    // 侧信道：stillApplies 调用计数——restoreRecords 一次 + drain 每条 dispatch 前再一次 = 同一记录两次
    const store = storeWith([rec({ id: 'only', status: 'queued' })])
    let calls = 0
    const stillApplies = async () => {
      calls += 1
      return true
    }
    const restored = await restoreRecords(store.list(), stillApplies)
    store.replaceAll(restored)
    await drainRestored(
      store,
      async () => ({ ok: true }),
      stillApplies,
    )
    assert.equal(calls, 2, '同一记录 restore 校验 1 次 + drain dispatch 前实读 1 次')
    assert.equal(store.list().find((r) => r.id === 'only').status, 'done')
  })

  it('dispatch 抛错按 failed 收敛；warned 透传', async () => {
    const store = storeWith([
      rec({ id: 'e', status: 'queued', target: 't-e' }),
      rec({ id: 'w', status: 'queued', target: 't-w' }),
    ])
    await drainRestored(
      store,
      async (r) => {
        if (r.target === 't-e') throw new Error('network gone')
        return { ok: true, warning: 'built scripts approved' }
      },
      async () => true,
    )
    const by = Object.fromEntries(store.list().map((r) => [r.id, r.status]))
    assert.equal(by.e, 'failed')
    assert.equal(by.w, 'warned')
  })

  it('clearFinished 清除全部终态（含 failed/superseded，0.9.6 主人裁决），保留在途态', async () => {
    const store = storeWith([
      rec({ id: 's', status: 'superseded' }),
      rec({ id: 'f', status: 'failed', error: 'x' }),
      rec({ id: 'd', status: 'done' }),
      rec({ id: 'q', status: 'queued' }),
    ])
    const next = store.clearFinished()
    assert.deepEqual(next.map((r) => r.id), ['q'], '只有非终态（queued/running/input）保留')
  })

  it('单条 remove（终审·新伤2 的面板出口）', () => {
    const store = storeWith([rec({ id: 'i', status: 'input', inputKind: 'peer-incompatible' }), rec({ id: 'd', status: 'done' })])
    assert.deepEqual(store.remove('i').map((r) => r.id), ['d'])
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
