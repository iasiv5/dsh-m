/**
 * Task 2：Profile 变更事务（install-npm 门）——两阶段不变量、B1/B2/B3、四分支结果、
 * FIFO 互斥、畸形 request、phase-aware INTERNAL_ERROR、renderFailure 契约、原语加固。
 * 运行：npm run build && node --test tests/profile-transaction.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs'
import { rename as realRename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  runProfileTransaction,
  renderFailure,
  TransactionError,
  makeNpmWarmPackument,
} from '../lib/core/profile-transaction.js'
import { snapshotFiles, atomicWriteFile } from '../lib/core/npm-integrity.js'
import { classifyPnpmError, PNPM_OUTCOME_CODES } from '../lib/core/dsh-cli.js'

// ---------- fixtures（事故同形摘要；Task 11 起共享 tests/fixtures/pnpm-errors.mjs） ----------

const sha512 = (tag) => `sha512-${tag}${'A'.repeat(20)}`
const OVERRIDE = { '@deepseek-ai/dsh-credentials-local': '0.1.1-rc.2' }

const CONFIG_MISMATCH = '命令失败 (exit 1): ERR_PNPM_LOCKFILE_CONFIG_MISMATCH Cannot proceed with the frozen installation. The current "overrides" configuration doesn\'t match the value found in the lockfile'
const OUTDATED_LOCKFILE = '命令失败 (exit 1): ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date'
const NO_MATCHING = '命令失败 (exit 1): ERR_PNPM_NO_MATCHING_VERSION No matching version found for pkg-a@1.2.3'

function lockFile({ pkg = 'existing', version = '1.0.0', integrity = sha512('old'), overrides = OVERRIDE, withOverrides = true } = {}) {
  const overrideLines = withOverrides
    ? `overrides:\n${Object.entries(overrides).map(([k, v]) => `  '${k}': ${v}`).join('\n')}\n\n`
    : ''
  return `lockfileVersion: '9.0'

${overrideLines}importers:
  .:
    dependencies:
      ${pkg}:
        specifier: ${version}
        version: ${version}

packages:
  ${pkg}@${version}:
    resolution: {integrity: ${integrity}}
`
}

function manifest(doc) {
  return JSON.stringify(doc, null, 2) + '\n'
}

function makeProfile(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-tx-'))
  for (const [name, content] of Object.entries(files || {})) writeFileSync(join(dir, name), content)
  return dir
}

const PATHS = (dir) => ({
  pkg: join(dir, 'package.json'),
  lock: join(dir, 'pnpm-lock.yaml'),
  ws: join(dir, 'pnpm-workspace.yaml'),
})
const bytesOf = (dir) => {
  const p = PATHS(dir)
  return [readFileSync(p.pkg), readFileSync(p.lock), readFileSync(p.ws)]
}

/** mock runner：script[op] = 按序 step 函数数组（返回 RunnerOutcome 或 throw）；记录调用与 in-flight 峰值 */
function mockRunner(script = {}) {
  const calls = { add: [], remove: [], frozen: [], rebuild: [] }
  let inFlight = 0
  let peak = 0
  const op = (name) => async (arg, signal) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    try {
      calls[name].push({ arg, signal })
      const seq = script[name] || []
      const step = seq[Math.min(calls[name].length - 1, seq.length - 1)]
      if (!step) return { class: 'ok', output: `${name}-ok` }
      return await step(arg, signal, calls[name].length)
    } finally {
      inFlight -= 1
    }
  }
  return {
    runner: { add: op('add'), remove: op('remove'), frozenInstall: op('frozen'), rebuildInstall: op('rebuild') },
    calls,
    peak: () => peak,
  }
}

const ok = (output = 'ok') => async () => ({ class: 'ok', output })
const failWith = (text) => async () => ({ ...classifyPnpmError(text), output: text })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const healCodes = (r) => r.healActions.map((h) => h.code)
const baseTx = (dir, runner, extra = {}) => ({
  runner: () => runner,
  profileDir: dir,
  retryDelaysMs: [0, 0],
  ...extra,
})

describe('install-npm：两阶段不变量', () => {
  let dir = ''
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('①参数化：add 破坏性写入后 verify 必炸 → rolled-back + 字节还原 + 收敛通过', async () => {
    const files = {
      'package.json': manifest({ name: 's', private: true, pnpm: { overrides: OVERRIDE }, dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    }
    dir = makeProfile(files)
    const before = bytesOf(dir)
    const { runner } = mockRunner({
      // 破坏性写入：manifest 丢 pnpm 键且缺 pkg-a 依赖（DEP_MISSING_AFTER_ADD）
      add: [async () => {
        writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { existing: '^1.0.0' } }))
        writeFileSync(join(dir, 'pnpm-lock.yaml'), 'garbage')
        return { class: 'ok', output: 'added' }
      }],
    })
    const r = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
      baseTx(dir, runner),
    )
    assert.equal(r.status, 'rolled-back')
    assert.equal(r.ok, false)
    assert.equal(r.failure.code, 'DEP_MISSING_AFTER_ADD')
    assert.equal(r.snapshotRestoreVerified, true, '还原后重读比对通过')
    assert.equal(r.profileConverged, true, '收敛阶梯通过')
    assert.ok(healCodes(r).includes('ROLLBACK_BYTES_RESTORED'))
    assert.deepEqual(bytesOf(dir), before, '三文件最终字节 === before')
  })

  it('②B2 改写专项：frozen 两次 CONFIG_MISMATCH → 对齐 + 重建记录在案（不断言字节等同）', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const { runner, calls } = mockRunner({
      add: [failWith('命令失败 (exit 1): ERR_PNPM_PEERS_PUBLISH conflict')],
      frozen: [failWith(CONFIG_MISMATCH), failWith(CONFIG_MISMATCH)],
      rebuild: [ok('rebuilt')],
    })
    const r = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
      baseTx(dir, runner),
    )
    assert.equal(r.status, 'rolled-back')
    assert.equal(r.profileConverged, true)
    assert.ok(healCodes(r).includes('B2_OVERRIDES_ALIGNED'), `heals=${healCodes(r)}`)
    assert.ok(healCodes(r).includes('B2_LOCKFILE_REBUILT'))
    assert.equal(calls.rebuild.length, 1, '重建只跑一次')
    // 收敛改写只经记录路径发生：manifest 被对齐写入 overrides
    const doc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.deepEqual(doc.pnpm?.overrides, OVERRIDE, 'B2 对齐写入了 lockfile 记录的 overrides')
  })

  it('③B1 复验失败 → POST_MUTATION_CONVERGENCE_FAILED 进回滚；回滚后 frozen ok → rolled-back', async () => {
    dir = makeProfile({
      'package.json': manifest({ name: 's', private: true, pnpm: { overrides: OVERRIDE }, dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const before = bytesOf(dir)
    const { runner, calls } = mockRunner({
      // 安装成功但 manifest 丢 pnpm 键 → B1 找回 → frozen 复验必炸
      add: [async () => {
        writeFileSync(join(dir, 'package.json'), manifest({ name: 's', private: true, dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }))
        writeFileSync(join(dir, 'pnpm-lock.yaml'), lockFile({ pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good'), withOverrides: false }))
        return { class: 'ok', output: 'added' }
      }],
      frozen: [failWith(CONFIG_MISMATCH), ok('frozen-ok')],   // B1 复验炸；回滚后收敛通过
      rebuild: [failWith(CONFIG_MISMATCH)],
    })
    const r = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
      baseTx(dir, runner),
    )
    assert.equal(r.status, 'rolled-back', `实际 ${r.status}`)
    assert.equal(r.failure.code, 'POST_MUTATION_CONVERGENCE_FAILED')
    assert.equal(r.profileConverged, true)
    assert.ok(healCodes(r).includes('B1_MANIFEST_KEYS_RESTORED'))
    assert.ok(healCodes(r).includes('B1_FROZEN_REVERIFY_FAILED'))
    assert.deepEqual(bytesOf(dir), before, '回滚后三文件字节还原')
    assert.equal(calls.frozen.length, 2, 'B1 复验一次 + 回滚收敛一次')
  })

  it('③b B1 复验失败且回滚后 frozen/rebuild 全失败 → manual-repair、profileConverged:false', async () => {
    dir = makeProfile({
      // pkg-a 原本已存在（originallyAbsent=false，不落入补移除兜底）
      'package.json': manifest({ name: 's', private: true, pnpm: { overrides: OVERRIDE }, dependencies: { existing: '^1.0.0', 'pkg-a': '1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const { runner } = mockRunner({
      add: [async () => {
        writeFileSync(join(dir, 'package.json'), manifest({ name: 's', private: true, dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }))
        writeFileSync(join(dir, 'pnpm-lock.yaml'), lockFile({ pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good'), withOverrides: false }))
        return { class: 'ok', output: 'added' }
      }],
      frozen: [failWith(CONFIG_MISMATCH)],
      rebuild: [failWith('命令失败 (exit 1): 重建也炸了')],
    })
    const r = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
      baseTx(dir, runner),
    )
    assert.equal(r.status, 'manual-repair')
    assert.equal(r.snapshotRestoreVerified, true, '字节还原本身成功')
    assert.equal(r.profileConverged, false, '收敛失败')
    assert.ok(renderFailure(r).includes('人工修复'))
  })

  it('回滚收敛全败但依赖原本不存在 → 补移除成功 → rolled-back + ROLLBACK_FALLBACK_REMOVED', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const { runner, calls } = mockRunner({
      add: [failWith(NO_MATCHING), failWith(NO_MATCHING), failWith(NO_MATCHING)],
      frozen: [failWith(CONFIG_MISMATCH)],
      rebuild: [failWith('重建失败')],
      remove: [ok('removed')],
    })
    const r = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
      baseTx(dir, runner),
    )
    assert.equal(r.status, 'rolled-back', `实际 ${r.status} / ${renderFailure(r)}`)
    assert.ok(healCodes(r).includes('ROLLBACK_FALLBACK_REMOVED'))
    assert.equal(calls.remove.length, 1)
    assert.deepEqual(calls.remove[0], { arg: 'pkg-a', signal: undefined }, '回滚移除不带外部 signal')
  })

  it('④快照失败 → rejected + SNAPSHOT_FAILED + 三文件字节未动（package.json 为目录 → EISDIR）', async () => {
    dir = makeProfile({
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    mkdirSync(join(dir, 'package.json')) // readFile 必然 EISDIR，非 ENOENT → throw
    const before = [readFileSync(join(dir, 'pnpm-lock.yaml')), readFileSync(join(dir, 'pnpm-workspace.yaml'))]
    const { runner, calls } = mockRunner({})
    const r = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
      baseTx(dir, runner),
    )
    assert.equal(r.status, 'rejected')
    assert.equal(r.failure.code, 'SNAPSHOT_FAILED')
    assert.equal(r.snapshotRestoreVerified, false)
    assert.equal(r.profileConverged, false)
    assert.equal(calls.add.length, 0, '快照失败零 mutation')
    assert.deepEqual([readFileSync(join(dir, 'pnpm-lock.yaml')), readFileSync(join(dir, 'pnpm-workspace.yaml'))], before)
  })

  it('⑤B3：retryable-lag ×2 后 ok → warm ×2 + B3_LAG_RETRY ×2', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const warmCalls = []
    const { runner, calls } = mockRunner({
      add: [
        failWith(NO_MATCHING),
        failWith(NO_MATCHING),
        async () => {
          writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }))
          writeFileSync(join(dir, 'pnpm-lock.yaml'), lockFile({ pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good'), withOverrides: false }))
          return { class: 'ok', output: 'added' }
        },
      ],
    })
    const r = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
      baseTx(dir, runner, { warmPackument: async (pkg, signal) => { warmCalls.push({ pkg, signal }) } }),
    )
    assert.equal(r.status, 'committed', `heals=${JSON.stringify(r.healActions)}`)
    assert.equal(r.version, '1.2.3')
    assert.equal(calls.add.length, 3)
    assert.equal(warmCalls.length, 2, '每次重试前预热一次')
    assert.equal(warmCalls[0].pkg, 'pkg-a')
    const lags = healCodes(r).filter((c) => c === 'B3_LAG_RETRY')
    assert.equal(lags.length, 2)
    assert.equal(healCodes(r).filter((c) => c === 'B3_PACKUMENT_WARMED').length, 2)
  })

  it('⑤b B3 退避中 abort → 立即唤醒，终态含 ABORTED', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const ac = new AbortController()
    const { runner } = mockRunner({
      add: [
        failWith(NO_MATCHING),
        async () => new Promise((_, reject) => {
          ac.signal.addEventListener('abort', () => {
            const err = new Error('命令已取消')
            err.name = 'AbortError'
            reject(err)
          }, { once: true })
        }),
      ],
    })
    const startedAt = Date.now()
    const pending = runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good'), signal: ac.signal },
      baseTx(dir, runner, { retryDelaysMs: [60_000] }),
    )
    await sleep(80)
    ac.abort()
    const r = await pending
    assert.ok(Date.now() - startedAt < 5_000, 'abort 应立即唤醒而不是等满退避')
    assert.equal(r.failure.code, 'ABORTED')
    assert.equal(r.status, 'rolled-back', 'mutate 已开始，回滚不可取消')
  })

  it('⑦abort：排队前 abort → rejected 零写入；add 中途 abort（已写入）→ rolled-back 字节还原', async () => {
    // a) pre-mutation abort
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const before = bytesOf(dir)
    const ac = new AbortController()
    ac.abort()
    const { runner, calls } = mockRunner({ add: [ok('nope')] })
    const ra = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good'), signal: ac.signal },
      baseTx(dir, runner),
    )
    assert.equal(ra.status, 'rejected')
    assert.equal(ra.failure.code, 'ABORTED')
    assert.equal(calls.add.length, 0)
    assert.deepEqual(bytesOf(dir), before, '零写入')

    // b) mid-mutation abort：mock add 先做破坏性写入再挂起，abort 后 throw AbortError
    const ac2 = new AbortController()
    const { runner: runner2 } = mockRunner({
      add: [() => new Promise((_, reject) => {
        writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { evil: '1' } }))
        ac2.signal.addEventListener('abort', () => {
          const err = new Error('命令已取消')
          err.name = 'AbortError'
          reject(err)
        }, { once: true })
      })],
      frozen: [ok('frozen-ok')],
    })
    const pending = runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good'), signal: ac2.signal },
      baseTx(dir, runner2),
    )
    await sleep(60)
    ac2.abort()
    const rb = await pending
    assert.equal(rb.status, 'rolled-back')
    assert.equal(rb.failure.code, 'ABORTED')
    assert.equal(rb.snapshotRestoreVerified, true)
    assert.deepEqual(bytesOf(dir), before, '已写入场景字节还原')
  })

  it('⑧FIFO：真实 runProfileTransaction ×2 并发 → runner in-flight 峰值 ≤1', async () => {
    const dirA = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const dirB = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const shared = mockRunner({
      add: [async () => {
        await sleep(40)
        throw Object.assign(new Error('命令失败 (exit 1): ERR_PNPM_MISC'), {})
      }],
      frozen: [ok('frozen-ok')],
    })
    const [ra, rb] = await Promise.all([
      runProfileTransaction({ kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') }, baseTx(dirA, shared.runner)),
      runProfileTransaction({ kind: 'install-npm', pkg: 'pkg-b', version: '2.0.0', integrity: sha512('good2') }, baseTx(dirB, shared.runner)),
    ])
    assert.equal(ra.status, 'rolled-back')
    assert.equal(rb.status, 'rolled-back')
    assert.equal(shared.peak(), 1, `in-flight 峰值 ${shared.peak()}`)
    rmSync(dirA, { recursive: true, force: true })
    rmSync(dirB, { recursive: true, force: true })
  })

  it('⑩畸形 request：unsafe pkg / 空白 integrity → TypeError + 零调用零写入', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const before = bytesOf(dir)
    const factoryCalls = []
    const liveCalls = []
    const deps = {
      runner: () => { factoryCalls.push(1); return mockRunner().runner },
      profileDir: dir,
      setLiveDisabled: async (pkg, flag) => { liveCalls.push([pkg, flag]); return false },
    }
    for (const bad of [
      { kind: 'install-npm', pkg: '../evil', version: '1.2.3', integrity: sha512('good') },
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: '   ' },
    ]) {
      await assert.rejects(() => runProfileTransaction(bad, deps), TypeError)
    }
    assert.equal(factoryCalls.length, 0, 'runner factory 零调用')
    assert.equal(liveCalls.length, 0, 'setLiveDisabled 零调用')
    assert.deepEqual(bytesOf(dir), before, '三文件字节未变')
  })

  it('⑪INTERNAL_ERROR phase-aware：factory 快照前 throw → rejected；add 写后 throw → rolled-back 字节还原', async () => {
    // a) factory throw（快照前）
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const before = bytesOf(dir)
    const ra = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
      { profileDir: dir, runner: () => { throw new Error('factory exploded') } },
    )
    assert.equal(ra.status, 'rejected')
    assert.equal(ra.failure.code, 'INTERNAL_ERROR')
    assert.deepEqual(bytesOf(dir), before, '文件未动')

    // b) add 先破坏性写入再 throw（未预期异常）→ 照常回滚
    const { runner } = mockRunner({
      add: [async () => {
        writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { evil: '1' } }))
        writeFileSync(join(dir, 'pnpm-lock.yaml'), 'garbage')
        throw new Error('unexpected runner crash')
      }],
      frozen: [ok('frozen-ok')],
    })
    const rb = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
      baseTx(dir, runner),
    )
    assert.equal(rb.status, 'rolled-back')
    assert.equal(rb.failure.code, 'INTERNAL_ERROR')
    assert.deepEqual(bytesOf(dir), before, '三文件字节还原')
  })

  it('⑫makeNpmWarmPackument：逐参传递 + 失败吞错', async () => {
    const seen = []
    const fetcher = async (pkg, timeoutMs, signal) => {
      seen.push({ pkg, timeoutMs, signal })
      if (pkg === 'boom') throw new Error('network down')
      return { versions: [] }
    }
    const warm = makeNpmWarmPackument(5_000, fetcher)
    const sig = new AbortController().signal
    await warm('pkg-a', sig)
    assert.deepEqual(seen, [{ pkg: 'pkg-a', timeoutMs: 5_000, signal: sig }], '(pkg, timeoutMs, signal) 逐参')
    await warm('boom') // 不抛
    assert.equal(seen.length, 2)
  })

  it('⑬warm 缺省：不提供 warmPackument 时 B3 仍退避重试（不预热不抛）', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const { runner } = mockRunner({
      add: [
        failWith(NO_MATCHING),
        async () => {
          writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }))
          writeFileSync(join(dir, 'pnpm-lock.yaml'), lockFile({ pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good'), withOverrides: false }))
          return { class: 'ok', output: 'added' }
        },
      ],
    })
    const r = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
      baseTx(dir, runner),
    )
    assert.equal(r.status, 'committed', `heals=${JSON.stringify(r.healActions)}`)
    assert.equal(healCodes(r).filter((c) => c === 'B3_LAG_RETRY').length, 1)
    assert.equal(healCodes(r).filter((c) => c === 'B3_PACKUMENT_WARMED').length, 0, '未绑定时跳过预热')
  })
})

describe('renderFailure 契约（legacy 文案逐字）', () => {
  const base = {
    kind: 'install-npm',
    healActions: [{ code: 'ROLLBACK_BYTES_RESTORED', note: '三文件已按快照逐字节还原并重读复验' }],
    output: '',
  }
  const rolled = {
    ...base,
    status: 'rolled-back',
    ok: false,
    failure: { code: 'ADD_FAILED', note: '命令失败 (exit 1): boom' },
    snapshotRestoreVerified: true,
    profileConverged: true,
  }

  it('安装失败，已回滚到安装前状态（…）：…', () => {
    assert.equal(
      renderFailure(rolled),
      '安装失败，已回滚到安装前状态（三文件已按快照逐字节还原并重读复验）：命令失败 (exit 1): boom',
    )
  })

  it('integrity 校验失败，已回滚到安装前状态（…）：…', () => {
    const r = { ...rolled, failure: { code: 'LOCK_INTEGRITY_MISMATCH', note: 'integrity 不一致：pkg@1.0.0' } }
    assert.ok(renderFailure(r).startsWith('integrity 校验失败，已回滚到安装前状态（'))
    assert.ok(renderFailure(r).endsWith('）：integrity 不一致：pkg@1.0.0'))
  })

  it('…依赖回滚也失败（…），profile 可能需要人工修复', () => {
    const r = {
      ...base,
      status: 'manual-repair',
      ok: false,
      failure: { code: 'ADD_FAILED', note: '命令失败 (exit 1): boom；依赖回滚也失败（frozen install 也失败）' },
      snapshotRestoreVerified: true,
      profileConverged: false,
    }
    assert.equal(
      renderFailure(r),
      '安装失败，命令失败 (exit 1): boom；依赖回滚也失败（frozen install 也失败），profile 可能需要人工修复',
    )
  })

  it('rejected：SNAPSHOT_FAILED / ABORTED 产出可读中文；committed 不入参（类型层拒绝）', () => {
    const rej = {
      kind: 'install-npm',
      status: 'rejected',
      ok: false,
      failure: { code: 'ABORTED', note: '客户端取消' },
      healActions: [],
      output: '',
      snapshotRestoreVerified: false,
      profileConverged: false,
    }
    const text = renderFailure(rej)
    assert.ok(text.includes('ABORTED') || text.includes('取消'), text)
    assert.ok(typeof text === 'string' && text.length > 0)
  })

  it('TransactionError.message === renderFailure(result)，result 原样可取', () => {
    const err = new TransactionError(rolled)
    assert.equal(err.message, renderFailure(rolled))
    assert.equal(err.result, rolled)
  })
})

describe('原语加固：snapshotFiles / atomicWriteFile（内部 fsOps 注入缝）', () => {  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshm-prim-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('snapshotFiles：仅 ENOENT → existed:false；EACCES 等其他异常 throw', async () => {
    writeFileSync(join(dir, 'a.json'), 'x')
    const eaccErr = Object.assign(new Error('denied'), { code: 'EACCES' })
    await assert.rejects(
      () => snapshotFiles([join(dir, 'a.json'), join(dir, 'missing')], { readFile: async (p) => {
        if (p.endsWith('missing')) { const e = Object.assign(new Error('no'), { code: 'ENOENT' }); throw e }
        throw eaccErr
      } }),
      (err) => err.code === 'EACCES',
    )
    const snaps = await snapshotFiles([join(dir, 'missing')], {
      readFile: async () => { const e = Object.assign(new Error('no'), { code: 'ENOENT' }); throw e },
    })
    assert.equal(snaps[0].existed, false)
    assert.equal(snaps[0].bytes, null)
  })

  it('atomicWriteFile：POSIX 首选 rename 直接成功，无 rm 路径', async () => {
    const renames = []
    const rms = []
    const target = join(dir, 'f.json')
    writeFileSync(target, 'old')
    await atomicWriteFile(target, Buffer.from('new'), {
      rename: async (a, b) => { renames.push([a, b]); await realRename(a, b) },
      rm: async (p, o) => { rms.push([p, o]) },
    })
    assert.equal(renames.length, 1, '只有一次 tmp→target rename')
    assert.equal(rms.length, 0, '无 rm 调用')
    assert.equal(readFileSync(target, 'utf8'), 'new')
  })

  it('atomicWriteFile：EPERM 才走备份协议（target→backup / tmp→target / 删 backup）', async () => {
    const target = join(dir, 'f.json')
    writeFileSync(target, 'old')
    const renames = []
    const rms = []
    await atomicWriteFile(target, Buffer.from('new'), {
      rename: async (from, to) => {
        renames.push([from, to])
        if (renames.length === 1) throw Object.assign(new Error('win'), { code: 'EPERM' })
        await realRename(from, to)
      },
      rm: async (p, o) => { rms.push([p, o]) },
    })
    assert.equal(renames.length, 3, 'tmp→target(EPERM) + target→backup + tmp→target')
    assert.ok(renames[1][1].includes('.backup-'), '第二步 target→backup')
    assert.equal(rms.length, 1, '成功后删 backup')
    assert.equal(readFileSync(target, 'utf8'), 'new')
  })

  it('atomicWriteFile：第二次 rename 失败 → backup 恢复目标 + tmp 清理', async () => {
    const target = join(dir, 'f.json')
    writeFileSync(target, 'old-content')
    const renames = []
    const rms = []
    await assert.rejects(
      () => atomicWriteFile(target, Buffer.from('new'), {
        rename: async (from, to) => {
          renames.push([from, to])
          if (renames.length === 1) throw Object.assign(new Error('win'), { code: 'EPERM' })
          if (renames.length === 3) throw Object.assign(new Error('still win'), { code: 'EPERM' })
        },
        rm: async (p, o) => { rms.push([p, o]) },
      }),
      (err) => /still win/.test(err.message),
    )
    // 调用序列：tmp→target(EPERM)、target→backup、tmp→target(EPERM)、backup→target(恢复)
    assert.equal(renames.length, 4, `实际 ${JSON.stringify(renames)}`)
    assert.equal(renames[3][0], renames[1][1], 'backup 恢复到 target')
    assert.equal(renames[3][1], target)
    assert.equal(readFileSync(target, 'utf8'), 'old-content', '目标恢复原内容')
    const tmpCleaned = rms.some(([p]) => p.includes('.restore-'))
    assert.ok(tmpCleaned, '失败后清理 tmp')
  })

  it('atomicWriteFile：非 EPERM/EEXIST 的 rename 失败直接抛并清理 tmp', async () => {
    const target = join(dir, 'f.json')
    writeFileSync(target, 'old')
    const rms = []
    await assert.rejects(
      () => atomicWriteFile(target, Buffer.from('new'), {
        rename: async () => { throw Object.assign(new Error('io'), { code: 'EIO' }) },
        rm: async (p, o) => { rms.push([p, o]) },
      }),
      (err) => err.code === 'EIO',
    )
    assert.ok(rms.some(([p]) => p.includes('.restore-')), 'tmp 已清理')
    assert.equal(readFileSync(target, 'utf8'), 'old')
  })
})

// ---------- Task 5：install-github 与 uninstall 两门 ----------

const SHA = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)

/** 可卸载 fixture：manifest 含 pkg-a 依赖 + node_modules/pkg-a/package.json 带 dsh 字段。 */
function uninstallableProfile({ manifestDeps = { existing: '^1.0.0', 'pkg-a': '1.0.0' } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-unin-'))
  writeFileSync(join(dir, 'package.json'), manifest({ dependencies: manifestDeps }))
  writeFileSync(join(dir, 'pnpm-lock.yaml'), lockFile({ withOverrides: false }))
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  mkdirSync(join(dir, 'node_modules', 'pkg-a'), { recursive: true })
  writeFileSync(join(dir, 'node_modules', 'pkg-a', 'package.json'), JSON.stringify({ name: 'pkg-a', version: '1.0.0', dsh: {} }))
  return dir
}

const SIX_CLASSES = [
  ['ok', () => ({ class: 'ok', output: 'ok' })],
  ['retryable-lag', () => ({ class: 'retryable-lag', code: PNPM_OUTCOME_CODES.NO_MATCHING_VERSION, output: 'lag' })],
  ['config-drift', () => ({ class: 'config-drift', code: PNPM_OUTCOME_CODES.CONFIG_MISMATCH, output: 'drift' })],
  ['unused-patch', () => ({ class: 'unused-patch', code: PNPM_OUTCOME_CODES.UNUSED_PATCH, output: 'patch' })],
  ['needs-builds', () => ({ class: 'needs-builds', output: 'builds' })],
  ['hard-fail', () => ({ class: 'hard-fail', output: 'hard' })],
]

describe('install-github 门', () => {
  let dir = ''
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('参数化：add 破坏性写入后 spec 不匹配 → GITHUB_SPEC_MISMATCH → rolled-back 字节还原', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const before = bytesOf(dir)
    const { runner } = mockRunner({
      add: [async () => {
        writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { garbage: 'x' } }))
        return { class: 'ok', output: 'added' }
      }],
      frozen: [ok('frozen-ok')],
    })
    const r = await runProfileTransaction(
      { kind: 'install-github', repo: 'owner/repo', sha: SHA, tag: 'v1.0.0' },
      baseTx(dir, runner),
    )
    assert.equal(r.status, 'rolled-back')
    assert.equal(r.failure.code, 'GITHUB_SPEC_MISMATCH')
    assert.equal(r.snapshotRestoreVerified, true)
    assert.equal(r.profileConverged, true)
    assert.deepEqual(bytesOf(dir), before)
  })

  it('安装成功：新写入 spec 命中 → committed，pkg/tag 透传', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const { runner } = mockRunner({
      add: [async () => {
        writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { existing: '^1.0.0', 'owner-repo': `github:owner/repo#${SHA}` } }))
        return { class: 'ok', output: 'added', usedAllowAllBuilds: false }
      }],
    })
    const r = await runProfileTransaction(
      { kind: 'install-github', repo: 'owner/repo', sha: SHA, tag: 'v1.2.3' },
      baseTx(dir, runner),
    )
    assert.equal(r.status, 'committed', JSON.stringify(r.healActions))
    assert.equal(r.pkg, 'owner-repo')
    assert.equal(r.spec, `github:owner/repo#${SHA}`)
    assert.equal(r.sha, SHA)
    assert.equal(r.tag, 'v1.2.3')
  })

  it('旧依赖误命中防护：预置同 spec 旧依赖、add 不改文件 → GITHUB_SPEC_MISMATCH（前态比对）', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0', 'owner-repo': `github:owner/repo#${SHA}` } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const before = bytesOf(dir)
    const { runner } = mockRunner({ add: [ok('noop-add')], frozen: [ok('frozen-ok')] })
    const r = await runProfileTransaction(
      { kind: 'install-github', repo: 'owner/repo', sha: SHA },
      baseTx(dir, runner),
    )
    assert.equal(r.status, 'rolled-back')
    assert.equal(r.failure.code, 'GITHUB_SPEC_MISMATCH')
    assert.deepEqual(bytesOf(dir), before)
  })

  it('add 非 ok（含 retryable-lag，按 hard-fail）→ ADD_FAILED → 回滚', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    for (const maker of SIX_CLASSES.slice(1)) {
      const { runner } = mockRunner({ add: [async () => maker[1]()], frozen: [ok('frozen-ok')] })
      const r = await runProfileTransaction(
        { kind: 'install-github', repo: 'owner/repo', sha: SHA2 },
        baseTx(dir, runner),
      )
      assert.equal(r.failure.code, 'ADD_FAILED', `class=${maker[0]}`)
      assert.equal(r.status, 'rolled-back', `class=${maker[0]}`)
    }
  })

  it('畸形 request：unsafe repo / 非 owner/repo 形状 / 非 40 位 hex SHA → TypeError 零调用', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const before = bytesOf(dir)
    const factoryCalls = []
    const deps = { runner: () => { factoryCalls.push(1); return mockRunner().runner }, profileDir: dir }
    for (const bad of [
      { kind: 'install-github', repo: '../evil', sha: SHA },
      { kind: 'install-github', repo: 'owner', sha: SHA },
      { kind: 'install-github', repo: 'owner/repo', sha: 'xyz' },
    ]) {
      await assert.rejects(() => runProfileTransaction(bad, deps), TypeError)
    }
    assert.equal(factoryCalls.length, 0)
    assert.deepEqual(bytesOf(dir), before)
  })
})

describe('uninstall 门', () => {
  let dir = ''
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  it('参数化：remove 破坏性写入后依赖仍在 → STILL_PRESENT_AFTER_REMOVE → rolled-back 字节还原 + live 反向', async () => {
    dir = uninstallableProfile()
    const before = bytesOf(dir)
    const liveCalls = []
    const { runner } = mockRunner({
      remove: [async () => {
        // 破坏性写入：丢了其他键，但 pkg-a 依赖仍在 → verify gone 必炸
        writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { 'pkg-a': '1.0.0' } }))
        return { class: 'ok', output: 'removed' }
      }],
      frozen: [ok('frozen-ok')],
    })
    const r = await runProfileTransaction(
      { kind: 'uninstall', pkg: 'pkg-a' },
      baseTx(dir, runner, { setLiveDisabled: async (pkg, flag) => { liveCalls.push([pkg, flag]); return true } }),
    )
    assert.equal(r.status, 'rolled-back')
    assert.equal(r.failure.code, 'STILL_PRESENT_AFTER_REMOVE')
    assert.deepEqual(bytesOf(dir), before, '三文件字节还原')
    assert.deepEqual(liveCalls, [['pkg-a', true], ['pkg-a', false]], '先下线、回滚后反向')
    assert.ok(healCodes(r).includes('LIVE_DISABLED'))
    assert.ok(healCodes(r).includes('LIVE_REENABLED'))
  })

  it('正常卸载：validate → live-disable → 摘补丁 → remove → verify gone → committed', async () => {
    dir = uninstallableProfile()
    const liveCalls = []
    const patchCalls = []
    const { runner, calls } = mockRunner({
      remove: [async () => {
        writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { existing: '^1.0.0' } }))
        return { class: 'ok', output: 'removed' }
      }],
    })
    const r = await runProfileTransaction(
      { kind: 'uninstall', pkg: 'pkg-a' },
      baseTx(dir, runner, {
        setLiveDisabled: async (pkg, flag) => { liveCalls.push([pkg, flag]); return true },
        stripPatchedEntries: (profileDir, pkg) => {
          patchCalls.push([profileDir, pkg])
          return { changed: true, orphanedPatchFiles: [join(dir, 'patches', 'pkg-a.patch')] }
        },
      }),
    )
    assert.equal(r.status, 'committed')
    assert.equal(r.pkg, 'pkg-a')
    assert.equal(r.liveDisabled, true)
    assert.deepEqual(r.orphanedPatchFiles, [join(dir, 'patches', 'pkg-a.patch')])
    assert.equal(r.needsRestart, true)
    assert.deepEqual(liveCalls, [['pkg-a', true]], 'committed 不做 live 反向')
    assert.deepEqual(patchCalls, [[dir, 'pkg-a']])
    assert.deepEqual(calls.remove, [{ arg: 'pkg-a', signal: undefined }])
    assert.ok(healCodes(r).includes('PATCH_ENTRIES_STRIPPED'))
  })

  it('三种 rejected：NOT_INSTALLED / NOT_DSH_PLUGIN / PLUGIN_METADATA_UNREADABLE —— 零写入零 runner 调用', async () => {
    const liveCalls = []
    const { runner, calls } = mockRunner({})
    const depsOf = (d) => baseTx(d, runner, { setLiveDisabled: async (pkg, flag) => { liveCalls.push([pkg, flag]); return false } })

    // NOT_INSTALLED
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const r1 = await runProfileTransaction({ kind: 'uninstall', pkg: 'pkg-a' }, depsOf(dir))
    assert.equal(r1.status, 'rejected')
    assert.equal(r1.failure.code, 'NOT_INSTALLED')
    rmSync(dir, { recursive: true, force: true })

    // NOT_DSH_PLUGIN
    dir = uninstallableProfile({ manifestDeps: { 'pkg-a': '1.0.0' } })
    writeFileSync(join(dir, 'node_modules', 'pkg-a', 'package.json'), JSON.stringify({ name: 'pkg-a', version: '1.0.0' }))
    const r2 = await runProfileTransaction({ kind: 'uninstall', pkg: 'pkg-a' }, depsOf(dir))
    assert.equal(r2.status, 'rejected')
    assert.equal(r2.failure.code, 'NOT_DSH_PLUGIN')
    rmSync(dir, { recursive: true, force: true })

    // PLUGIN_METADATA_UNREADABLE（元数据非合法 JSON）
    dir = uninstallableProfile({ manifestDeps: { 'pkg-a': '1.0.0' } })
    writeFileSync(join(dir, 'node_modules', 'pkg-a', 'package.json'), '{broken json')
    const r3 = await runProfileTransaction({ kind: 'uninstall', pkg: 'pkg-a' }, depsOf(dir))
    assert.equal(r3.status, 'rejected')
    assert.equal(r3.failure.code, 'PLUGIN_METADATA_UNREADABLE')

    assert.equal(calls.remove.length, 0, 'runner 零调用')
    assert.equal(liveCalls.length, 0, 'setLiveDisabled 零调用')
  })

  it('分类消费矩阵 remove 行六类全枚举：ok→committed，其余五类→REMOVE_FAILED→rolled-back', async () => {
    for (const [name, maker] of SIX_CLASSES) {
      dir = uninstallableProfile()
      const { runner } = mockRunner({
        remove: [async () => {
          if (name === 'ok') {
            writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { existing: '^1.0.0' } }))
            return maker()
          }
          return maker()
        }],
        frozen: [ok('frozen-ok')],
      })
      const r = await runProfileTransaction({ kind: 'uninstall', pkg: 'pkg-a' }, baseTx(dir, runner))
      if (name === 'ok') {
        assert.equal(r.status, 'committed', name)
        assert.equal(r.ok, true)
      } else {
        assert.equal(r.failure.code, 'REMOVE_FAILED', name)
        assert.equal(r.status, 'rolled-back', name)
      }
      rmSync(dir, { recursive: true, force: true })
      dir = ''
    }
  })

  it('分类消费矩阵 rebuildInstall 行六类全枚举：ok→rolled-back，其余五类→manual-repair', async () => {
    for (const [name, maker] of SIX_CLASSES) {
      dir = makeProfile({
        'package.json': manifest({ dependencies: { existing: '^1.0.0', 'pkg-a': '1.0.0' } }),
        'pnpm-lock.yaml': lockFile(),
        'pnpm-workspace.yaml': 'packages:\n  - .\n',
      })
      const { runner } = mockRunner({
        add: [failWith('命令失败 (exit 1): ERR_PNPM_MISC')],
        frozen: [failWith(CONFIG_MISMATCH)],   // 对齐后仍失配 → rebuild
        rebuild: [async () => maker()],
      })
      const r = await runProfileTransaction(
        { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
        baseTx(dir, runner),
      )
      assert.equal(r.failure.code, 'ADD_FAILED', name)
      if (name === 'ok') {
        assert.equal(r.status, 'rolled-back', name)
        assert.equal(r.profileConverged, true, name)
        assert.ok(healCodes(r).includes('B2_LOCKFILE_REBUILT'), name)
      } else {
        assert.equal(r.profileConverged, false, name)
        assert.equal(r.status, 'manual-repair', `rebuild=${name} 应 manual-repair`)
      }
      rmSync(dir, { recursive: true, force: true })
      dir = ''
    }
  })

  it('中途 abort：remove 已写入后 abort → 回滚不可取消，终态 rolled-back + ABORTED', async () => {
    dir = uninstallableProfile()
    const before = bytesOf(dir)
    const ac = new AbortController()
    const { runner } = mockRunner({
      remove: [() => new Promise((_, reject) => {
        writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { evil: '1' } }))
        ac.signal.addEventListener('abort', () => {
          const err = new Error('命令已取消')
          err.name = 'AbortError'
          reject(err)
        }, { once: true })
      })],
      frozen: [ok('frozen-ok')],
    })
    const pending = runProfileTransaction(
      { kind: 'uninstall', pkg: 'pkg-a', signal: ac.signal },
      baseTx(dir, runner),
    )
    await sleep(60)
    ac.abort()
    const r = await pending
    assert.equal(r.status, 'rolled-back')
    assert.equal(r.failure.code, 'ABORTED')
    assert.deepEqual(bytesOf(dir), before)
  })

  it('patch cleanup 部分写入后 throw → 回滚字节还原 + live 反向补偿记录在案', async () => {
    dir = uninstallableProfile()
    const before = bytesOf(dir)
    const liveCalls = []
    const { runner, calls } = mockRunner({ frozen: [ok('frozen-ok')] })
    const r = await runProfileTransaction(
      { kind: 'uninstall', pkg: 'pkg-a' },
      baseTx(dir, runner, {
        setLiveDisabled: async (pkg, flag) => { liveCalls.push([pkg, flag]); return true },
        stripPatchedEntries: (profileDir, pkg) => {
          // 先真实改写一半，再抛
          writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\npatchedDependencies:\n  pkg-a: patches/a.patch\n')
          throw new Error('strip crashed mid-way')
        },
      }),
    )
    assert.equal(r.status, 'rolled-back', renderFailure(r))
    assert.equal(r.failure.code, 'INTERNAL_ERROR')
    assert.deepEqual(bytesOf(dir), before, '三文件字节还原')
    assert.deepEqual(liveCalls, [['pkg-a', true], ['pkg-a', false]], 'live 反向补偿被尝试')
    assert.ok(healCodes(r).includes('LIVE_REENABLED'))
    assert.equal(calls.remove.length, 0, '摘补丁炸了不再进 remove')
  })

  it('live 反向失败也如实记录（LIVE_REENABLE_FAILED），不改变 rolled-back 终态', async () => {
    dir = uninstallableProfile()
    const liveCalls = []
    const { runner } = mockRunner({
      remove: [async () => {
        // 破坏性写入：pkg-a 仍在（verify gone 必炸）
        writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { 'pkg-a': '1.0.0' } }))
        return { class: 'ok', output: 'removed' }
      }],
      frozen: [ok('frozen-ok')],
    })
    const r = await runProfileTransaction(
      { kind: 'uninstall', pkg: 'pkg-a' },
      baseTx(dir, runner, {
        setLiveDisabled: async (pkg, flag) => {
          liveCalls.push([pkg, flag])
          if (flag === false) throw new Error('reenable failed')
          return true
        },
      }),
    )
    assert.equal(r.status, 'rolled-back')
    assert.ok(healCodes(r).includes('LIVE_REENABLE_FAILED'))
  })

  it('畸形 request：uninstall unsafe pkg → TypeError + 零调用 + 字节未变', async () => {
    dir = uninstallableProfile()
    const before = bytesOf(dir)
    const factoryCalls = []
    const liveCalls = []
    const deps = {
      profileDir: dir,
      runner: () => { factoryCalls.push(1); return mockRunner().runner },
      setLiveDisabled: async (pkg, flag) => { liveCalls.push([pkg, flag]); return false },
    }
    await assert.rejects(() => runProfileTransaction({ kind: 'uninstall', pkg: '../evil' }, deps), TypeError)
    assert.equal(factoryCalls.length, 0)
    assert.equal(liveCalls.length, 0)
    assert.deepEqual(bytesOf(dir), before)
  })
})
