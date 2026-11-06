/**
 * restart-state 状态文件读写与惰性折叠（issue #51 / ADR-0032）。
 * 属主模块契约：写 = mkdir recursive + tmp+rename 原子替换；读 = 缺失/损坏 → null（best-effort）；
 * 折叠 = external 通道经钩子补 journal 记录并回写 foldedAt（幂等）；panel 显式跳过；fold-failed 不回写。
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  readLastRestart,
  writeLastRestart,
  foldLastRestartIntoJournal,
} from '../lib/core/restart-state.js'

const STATE = {
  ok: true,
  via: 'helper',
  port: 3081,
  requestChannel: 'host-tool',
  at: 1_700_000_000_000,
  elapsedMs: 46_300,
}

describe('restart-state：状态文件读写（issue #51 / ADR-0032）', () => {
  let dir
  let prevEnv

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshm-restart-state-'))
    prevEnv = process.env.DSHM_LAST_RESTART_FILE
    process.env.DSHM_LAST_RESTART_FILE = join(dir, 'last-restart.json')
  })
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.DSHM_LAST_RESTART_FILE
    else process.env.DSHM_LAST_RESTART_FILE = prevEnv
    rmSync(dir, { recursive: true, force: true })
  })

  it('① write→read roundtrip 逐字段相等（含 assumed/reason 可选键）', async () => {
    await writeLastRestart(STATE)
    assert.deepEqual(await readLastRestart(), STATE)
    const failed = { ...STATE, ok: false, reason: 'port 3081 still held by another process', assumed: true }
    await writeLastRestart(failed)
    assert.deepEqual(await readLastRestart(), failed)
  })

  it('② 缺失文件 → null；损坏文件 → null（不抛）', async () => {
    assert.equal(await readLastRestart(), null)
    writeFileSync(join(dir, 'last-restart.json'), 'not json{{{')
    assert.equal(await readLastRestart(), null)
  })

  it('③ DSHM_LAST_RESTART_FILE 覆盖缺省路径（env 整文件覆盖优先）', async () => {
    await writeLastRestart(STATE)
    const other = join(dir, 'other.json')
    process.env.DSHM_LAST_RESTART_FILE = other
    assert.equal(await readLastRestart(), null, '切路径后读不到旧文件 → env 覆盖生效')
    await writeLastRestart(STATE)
    assert.ok(existsSync(other), '写落在 env 指定路径')
  })

  it('④ 原子性形态：写后无 .tmp 残留（tmp+rename 惯例）', async () => {
    await writeLastRestart(STATE)
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'))
    assert.deepEqual(leftovers, [])
  })
})

describe('foldLastRestartIntoJournal：惰性折叠（issue #51 / ADR-0032）', () => {
  let dir
  let prevEnv
  const appendCalls = []
  const throwingHook = (async (...args) => { appendCalls.push(args); throw new Error('hook exploded') })

  function stubHook() {
    return { journalExternalOperation: (async (channel, record, result, deps) => { appendCalls.push({ channel, record, result, deps }) }) }
  }

  async function presetState(state) {
    process.env.DSHM_LAST_RESTART_FILE = join(dir, 'last-restart.json')
    await writeLastRestart(state)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshm-restart-fold-'))
    prevEnv = process.env.DSHM_LAST_RESTART_FILE
    process.env.DSHM_EXTERNAL_JOURNAL_FILE = join(dir, 'external-operations.json')
    appendCalls.length = 0
  })
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.DSHM_LAST_RESTART_FILE
    else process.env.DSHM_LAST_RESTART_FILE = prevEnv
    const prevJ = process.env.DSHM_EXTERNAL_JOURNAL_FILE
    if (prevJ === undefined) delete process.env.DSHM_EXTERNAL_JOURNAL_FILE
    else process.env.DSHM_EXTERNAL_JOURNAL_FILE = prevJ
    rmSync(dir, { recursive: true, force: true })
  })

  it('⑤ external 通道 → folded：钩子收 kind restart/target/result，文件回写 foldedAt', async () => {
    await presetState(STATE)
    const outcome = await foldLastRestartIntoJournal(stubHook())
    assert.equal(outcome, 'folded')
    assert.equal(appendCalls.length, 1)
    assert.equal(appendCalls[0].channel, 'host-tool')
    assert.equal(appendCalls[0].record.kind, 'restart')
    assert.equal(appendCalls[0].record.target, 'dsh-m web')
    assert.equal(appendCalls[0].result, 'ok')
    const after = await readLastRestart()
    assert.ok(typeof after.foldedAt === 'number', 'foldedAt 回写')
  })

  it('⑤b 失败态 → result failed + reason 透传', async () => {
    await presetState({ ...STATE, ok: false, reason: 'port 3081 still held by another process' })
    const outcome = await foldLastRestartIntoJournal(stubHook())
    assert.equal(outcome, 'folded')
    assert.equal(appendCalls[0].result, 'failed')
    assert.equal(appendCalls[0].deps.reason, 'port 3081 still held by another process')
  })

  it('⑥ panel 通道 → skipped-panel：桩零调用，文件无 foldedAt', async () => {
    await presetState({ ...STATE, requestChannel: 'panel' })
    const outcome = await foldLastRestartIntoJournal(stubHook())
    assert.equal(outcome, 'skipped-panel')
    assert.equal(appendCalls.length, 0)
    const after = await readLastRestart()
    assert.ok(!('foldedAt' in after))
  })

  it('⑦ 已折叠（foldedAt 在场）→ already-folded：桩零调用', async () => {
    await presetState({ ...STATE, foldedAt: 1_700_000_100_000 })
    const outcome = await foldLastRestartIntoJournal(stubHook())
    assert.equal(outcome, 'already-folded')
    assert.equal(appendCalls.length, 0)
  })

  it('⑧ 无状态文件 → absent', async () => {
    const outcome = await foldLastRestartIntoJournal(stubHook())
    assert.equal(outcome, 'absent')
    assert.equal(appendCalls.length, 0)
  })

  it('⑨ fold-failed：钩子桩抛错 → 返回 fold-failed、不抛、文件无 foldedAt 回写', async () => {
    await presetState(STATE)
    const outcome = await foldLastRestartIntoJournal({ journalExternalOperation: throwingHook })
    assert.equal(outcome, 'fold-failed')
    const after = await readLastRestart()
    assert.ok(!('foldedAt' in after), '失败不回写 foldedAt（下次调用可重试）')
  })
})
