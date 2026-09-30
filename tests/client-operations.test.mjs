/**
 * 0.7.0 Task 13：全局操作记录纯模块——store CRUD/持久化往返/恢复四分支/
 * drain 二次校验（执行时实读）/superseded 语义/持久化降级。
 * 运行：node --test tests/client-operations.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createOperationsStore, restoreRecords, drainRestored, OP_STORAGE_KEY } from '../src/client/operations.js'

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
    // done/warned 清除；failed/superseded 保留
    assert.deepEqual(next.map((r) => r.id).sort(), ['op-1', 'op-3'])
    next = store.remove('op-1')
    assert.deepEqual(next.map((r) => r.id), ['op-3'])
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
    store.replaceAll(records)
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

  it('clearFinished 不清除 superseded/failed', async () => {
    const store = storeWith([rec({ id: 's', status: 'superseded' }), rec({ id: 'f', status: 'failed', error: 'x' }), rec({ id: 'd', status: 'done' })])
    const next = store.clearFinished()
    assert.deepEqual(next.map((r) => r.id).sort(), ['f', 's'])
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
