/**
 * dshm_restart 工具：上次重启终态尾行（issue #51 / ADR-0032）。
 * execute 读 last-restart.json（env 覆盖），render 追加「上次重启终态」尾行；
 * 缺失态输出与今日逐字节一致（零变化承诺）。
 * 运行：npm run build && node --test tests/tools-restart.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASELINE_TEXT = '已请求重启 DSH web（via helper）。服务恢复后 DSH Web 会在后台自动重连。对用户最多一句短话。'

async function registerRestartWith(behavior) {
  const { registerTools } = await import('../lib/tools.js')
  const registered = []
  const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {} }
  registerTools(ctx, { timeoutMs: 50 }, { restart: behavior })
  return registered.find((t) => t.name === 'dshm_restart')
}

describe('dshm_restart 上次重启终态尾行（issue #51 / ADR-0032）', () => {
  let dir
  let prevEnv
  let prevJournal

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshm-restart-tool-'))
    prevEnv = process.env.DSHM_LAST_RESTART_FILE
    process.env.DSHM_LAST_RESTART_FILE = join(dir, 'last-restart.json')
    prevJournal = process.env.DSHM_EXTERNAL_JOURNAL_FILE
    process.env.DSHM_EXTERNAL_JOURNAL_FILE = join(dir, 'external-operations.json')
  })
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.DSHM_LAST_RESTART_FILE
    else process.env.DSHM_LAST_RESTART_FILE = prevEnv
    if (prevJournal === undefined) delete process.env.DSHM_EXTERNAL_JOURNAL_FILE
    else process.env.DSHM_EXTERNAL_JOURNAL_FILE = prevJournal
    rmSync(dir, { recursive: true, force: true })
  })

  async function journalCount() {
    const { readFileSync } = await import('node:fs')
    try {
      const parsed = JSON.parse(readFileSync(process.env.DSHM_EXTERNAL_JOURNAL_FILE, 'utf8'))
      return Array.isArray(parsed) ? parsed.length : 0
    } catch {
      return 0
    }
  }

  it('① 状态文件存在 → execute 透传 lastRestart，render 尾行含 上次重启终态：成功（46.3s）', async () => {
    const { writeLastRestart } = await import('../lib/core/restart-state.js')
    await writeLastRestart({ ok: true, via: 'helper', port: 3080, requestChannel: 'host-tool', at: Date.now(), elapsedMs: 46300 })
    const tool = await registerRestartWith((port, channel) => {
      assert.equal(port, null)
      assert.equal(channel, 'host-tool')
      return { pid: 1, helperPid: undefined, via: 'helper' }
    })
    const out = await tool.execute({})
    assert.equal(out.lastRestart.ok, true)
    const lines = tool.output.render(null, out)
    assert.ok(lines[0].text.startsWith('已请求重启 DSH web（via helper）。'), lines[0].text)
    assert.ok(lines[0].text.includes('上次重启终态：成功（46.3s）'), lines[0].text)
  })

  it('② 状态文件缺失 → 输出与今日逐字节一致（无尾行、无 lastRestart 键）', async () => {
    const tool = await registerRestartWith(() => ({ pid: 1, helperPid: undefined, via: 'helper' }))
    const out = await tool.execute({})
    assert.ok(!('lastRestart' in out), '缺失态不携带 lastRestart 键')
    const lines = tool.output.render(null, out)
    assert.equal(lines[0].text, BASELINE_TEXT)
  })

  it('③ 失败态 → render 尾行含 上次重启终态：失败（原因）', async () => {
    const { writeLastRestart } = await import('../lib/core/restart-state.js')
    await writeLastRestart({ ok: false, via: 'helper', port: 3080, requestChannel: 'host-tool', at: Date.now(), elapsedMs: 5210, reason: 'port 3081 still held by another process' })
    const tool = await registerRestartWith(() => ({ pid: 1, helperPid: undefined, via: 'helper' }))
    const out = await tool.execute({})
    const lines = tool.output.render(null, out)
    assert.ok(lines[0].text.includes('上次重启终态：失败（port 3081 still held by another process）'), lines[0].text)
  })

  it('④ assumed 成功 → 尾行降级为 成功（假定，无端口可探）不显耗时（R2-2）', async () => {
    const { writeLastRestart } = await import('../lib/core/restart-state.js')
    await writeLastRestart({ ok: true, via: 'helper', port: null, requestChannel: 'host-tool', at: Date.now(), elapsedMs: 10000, assumed: true })
    const tool = await registerRestartWith(() => ({ pid: 1, helperPid: undefined, via: 'helper' }))
    const out = await tool.execute({})
    const lines = tool.output.render(null, out)
    assert.ok(lines[0].text.includes('上次重启终态：成功（假定，无端口可探）'), lines[0].text)
    assert.ok(!lines[0].text.includes('10.0s'), 'assumed 不显耗时')
  })

  it('⑤ external 终态 → execute 惰性折叠 journal + foldedAt 回写（F1 修复：外部通道操作记录可见性）', async () => {
    const { writeLastRestart } = await import('../lib/core/restart-state.js')
    await writeLastRestart({ ok: false, via: 'helper', port: 3080, requestChannel: 'host-tool', at: Date.now(), elapsedMs: 5210, reason: 'port 3081 still held' })
    const tool = await registerRestartWith(() => ({ pid: 1, helperPid: undefined, via: 'helper' }))
    const out = await tool.execute({})
    assert.equal(await journalCount(), 1, '折叠恰补一条 journal 记录')
    const journal = JSON.parse((await import('node:fs')).readFileSync(process.env.DSHM_EXTERNAL_JOURNAL_FILE, 'utf8'))
    assert.equal(journal[0].kind, 'restart')
    assert.equal(journal[0].channel, 'host-tool')
    assert.equal(journal[0].result, 'failed')
    assert.equal(out.lastRestart.foldedAt !== undefined, true, 'foldedAt 回写（幂等防重）')
  })

  it('⑥ panel 终态 → execute 不折叠（append 层不变量由折叠层显式跳过承接）', async () => {
    const { writeLastRestart } = await import('../lib/core/restart-state.js')
    await writeLastRestart({ ok: true, via: 'helper', port: 3080, requestChannel: 'panel', at: Date.now(), elapsedMs: 46300 })
    const tool = await registerRestartWith(() => ({ pid: 1, helperPid: undefined, via: 'helper' }))
    await tool.execute({})
    assert.equal(await journalCount(), 0, 'panel 通道零 journal 写入')
  })
})
