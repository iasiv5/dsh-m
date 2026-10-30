/**
 * #36：升级编排单点 performUpgradeFlow 直测（installed-tab / market-tab 薄壳的共同核心）。
 * 注入面：fake ops（runOp 捕获 enqueueMeta 并执行传入 call）+ 真 createOpOutcome(lookup)
 * （i18n 纯字典，零 mock 缺口）+ notify/noteSink/refresh 收集数组。
 * restartBannerDecision 为 panel-ops 真实现（缺席保守 true；client-only 三态有其直测，不重复）。
 * 运行：node --test tests/client-upgrade-flow.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { performUpgradeFlow } from '../src/client/upgrade-flow.js'
import { createOpOutcome } from '../src/client/op-outcome.js'
import { lookup } from '../src/client/i18n.js'

const oc = createOpOutcome(lookup)

/** fake ops：runOp 记录 (kind, target, enqueueMeta) 并执行传入 call，返回其结果。 */
function fakeOps() {
  const seen = {}
  return {
    seen,
    runOp: async (kind, target, call, meta) => {
      seen.kind = kind
      seen.target = target
      seen.meta = meta
      return await call()
    },
  }
}

const okRes = () => ({ ok: true, pkg: 'p', fromVersion: '1.0.0', version: '2.0.0' })

describe('performUpgradeFlow（#36 升级编排单点）', () => {
  it('① 成功臂：notify ok + needsRestart 通道（缺席保守 true）+ noteSink ok + refresh 调用 + 返回 ok', async () => {
    const ops = fakeOps()
    const notes = []
    const notify = (n) => notes.push(n)
    const sinks = []
    let refreshes = 0
    const out = await performUpgradeFlow({
      ops, oc, target: 'p', from: '1.0.0', toVersion: '2.0.0',
      apiCall: async () => okRes(),
      noteSink: (s) => sinks.push(s),
      refresh: () => { refreshes += 1 },
      notify,
    })
    assert.equal(out, 'ok')
    const okNote = notes.find((n) => n.kind === 'ok')
    assert.ok(okNote, '成功 notify 在案')
    assert.equal(okNote.needsRestart, true, 'activation 缺席 → restartBannerDecision 保守 true')
    assert.deepEqual(sinks, [{ kind: 'ok', text: okNote.text }])
    assert.equal(refreshes, 1)
  })

  it('② degraded 臂：warn 投影绝不进成功臂 + noteSink warn', async () => {
    const ops = fakeOps()
    const notes = []
    const sinks = []
    const out = await performUpgradeFlow({
      ops, oc, target: 'p', from: '1.0.0', toVersion: '2.0.0',
      apiCall: async () => ({ ...okRes(), degraded: true, restoredTo: '1.0.0' }),
      noteSink: (s) => sinks.push(s),
      notify: (n) => notes.push(n),
    })
    assert.equal(out, 'ok', '降级恢复结局仍归 ok（回滚事实由 warn 投影呈现）')
    assert.equal(notes.length, 1)
    assert.equal(notes[0].kind, 'warn')
    assert.deepEqual(sinks, [{ kind: 'warn', text: notes[0].text }])
  })

  it('③ catch target 失败：返回 target + noteSink err', async () => {
    const ops = fakeOps()
    const notes = []
    const sinks = []
    const err = Object.assign(new Error('boom'), { failureClass: 'target' })
    const out = await performUpgradeFlow({
      ops, oc, target: 'p', from: '1.0.0', toVersion: '2.0.0',
      apiCall: async () => { throw err },
      noteSink: (s) => sinks.push(s),
      notify: (n) => notes.push(n),
    })
    assert.equal(out, 'target')
    assert.equal(notes[0].kind, 'err')
    assert.deepEqual(sinks, [{ kind: 'err', text: notes[0].text }])
  })

  it('④ catch systemic：返回 systemic（批量短路语义单源 classifyBatchOutcome）', async () => {
    const ops = fakeOps()
    const err = Object.assign(new Error('guard'), { failureClass: 'systemic' })
    const out = await performUpgradeFlow({
      ops, oc, target: 'p', from: '1.0.0', toVersion: '2.0.0',
      apiCall: async () => { throw err },
      notify: () => {},
    })
    assert.equal(out, 'systemic')
  })

  it('⑤ catch superseded（m.kind ok）：返回 ok + noteSink hint', async () => {
    const ops = fakeOps()
    const sinks = []
    const err = Object.assign(new Error('stale'), { opSuperseded: true })
    const out = await performUpgradeFlow({
      ops, oc, target: 'p', from: '1.0.0', toVersion: '2.0.0',
      apiCall: async () => { throw err },
      noteSink: (s) => sinks.push(s),
      notify: () => {},
    })
    assert.equal(out, 'ok', 'superseded 良性跳过归 ok 不中断')
    assert.deepEqual(sinks, [{ kind: 'hint', text: notes0Text(sinks) }])
    function notes0Text(s) { return s[0].text }
  })

  it('⑥ opUpgradeMeta 落账：runOp call 产出的 res 携带 opMeta（enqueue-meta 与 meta 同源）', async () => {
    const ops = fakeOps()
    await performUpgradeFlow({
      ops, oc, target: 'p', from: '1.0.0', toVersion: '2.0.0',
      apiCall: async () => okRes(),
      notify: () => {},
    })
    assert.equal(ops.seen.kind, 'upgrade')
    assert.equal(ops.seen.target, 'p')
    assert.deepEqual(ops.seen.meta, { from: '1.0.0', toVersion: '2.0.0' }, 'enqueue-meta 形态（operations.js restoreRecords 对账依据）')
  })

  it('⑦ runOp 的 call 把 opUpgradeMeta 落进返回体（from/to 版本对，sha 回退 7 位走 opUpgradeMeta 本体）', async () => {
    let callResult
    const ops = {
      runOp: async (_kind, _target, call, _meta) => { callResult = await call() },
    }
    await performUpgradeFlow({
      ops, oc, target: 'p', from: '1.0.0', toVersion: '2.0.0',
      apiCall: async () => ({ ok: true, pkg: 'p', fromVersion: '1.0.0', version: '2.0.0' }),
      notify: () => {},
    })
    assert.deepEqual(callResult.opMeta, { from: '1.0.0', to: '2.0.0' })
  })
})
