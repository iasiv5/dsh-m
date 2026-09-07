/**
 * Task 1：pnpm 结果六类分类 + PNPM_OUTCOME_CODES + makeAddViaLadder（可注入加装阶梯工厂）。
 * 原始文本样本与线上事故同形（来源标注于各 fixture；Task 11 起共享 tests/fixtures/pnpm-errors.mjs）。
 * 运行：npm run build && node --test tests/pnpm-outcome.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyPnpmError,
  makeAddViaLadder,
  PNPM_OUTCOME_CODES,
} from '../lib/core/dsh-cli.js'
import {
  CONFIG_MISMATCH_TEXT,
  NO_MATCHING_TEXT,
  UNUSED_PATCH_TEXT,
} from './fixtures/pnpm-errors.mjs'

// ---------- 原始 pnpm 文本（Task 11 起共享 tests/fixtures/pnpm-errors.mjs；其余为本地补充样本） ----------

/** 同事故家族：回滚快照 specifier 漂移。 */
const OUTDATED_LOCKFILE_TEXT =
  '命令失败 (exit 1): ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with <ROOT>/package.json'
/** 2026-09-05 dsh-better-sidebar 事故：构建脚本被拦（errorDigest 保留 code/hint 后的同形摘要）。 */
const PREPARE_BLOCKED_TEXT =
  '命令失败 (exit 1): ERR_PNPM_IGNORED_BUILDS — Ignored build scripts: node-pty@1.1.0 — Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.'
/** hoist 模式漂移：不同主版本 pnpm 生成的 node_modules。 */
const PUBLIC_HOIST_TEXT =
  '命令失败 (exit 1): ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF public-hoist-pattern differs'

describe('classifyPnpmError：六类分类表', () => {
  it('CONFIG_MISMATCH 与 OUTDATED_LOCKFILE 同为 config-drift 但 code 不同', () => {
    const a = classifyPnpmError(CONFIG_MISMATCH_TEXT)
    const b = classifyPnpmError(OUTDATED_LOCKFILE_TEXT)
    assert.equal(a.class, 'config-drift')
    assert.equal(a.code, PNPM_OUTCOME_CODES.CONFIG_MISMATCH)
    assert.equal(b.class, 'config-drift')
    assert.equal(b.code, PNPM_OUTCOME_CODES.OUTDATED_LOCKFILE)
    assert.notEqual(a.code, b.code, 'code 必须可区分（B2-L1 对齐 vs 直接重建）')
  })

  it('NO_MATCHING_VERSION → retryable-lag；UNUSED_PATCH → unused-patch', () => {
    assert.deepEqual(classifyPnpmError(NO_MATCHING_TEXT), {
      class: 'retryable-lag',
      code: PNPM_OUTCOME_CODES.NO_MATCHING_VERSION,
    })
    assert.deepEqual(classifyPnpmError(UNUSED_PATCH_TEXT), {
      class: 'unused-patch',
      code: PNPM_OUTCOME_CODES.UNUSED_PATCH,
    })
  })

  it('构建脚本被拦（IGNORED_BUILDS / GIT_DEP_PREPARE_NOT_ALLOWED）→ needs-builds', () => {
    assert.equal(classifyPnpmError(PREPARE_BLOCKED_TEXT).class, 'needs-builds')
    assert.equal(
      classifyPnpmError('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED prepare script not allowed').class,
      'needs-builds',
    )
  })

  it('其他 ERR_PNPM_* → hard-fail 且保留诊断码；无码文本 code 缺省', () => {
    const known = classifyPnpmError('命令失败 (exit 1): ERR_PNPM_PEER_DEPRECATED_ISSUES peer invalid')
    assert.equal(known.class, 'hard-fail')
    assert.equal(known.code, 'ERR_PNPM_PEER_DEPRECATED_ISSUES')
    const bare = classifyPnpmError('命令失败 (exit 1): something odd happened')
    assert.equal(bare.class, 'hard-fail')
    assert.equal(bare.code, undefined)
  })

  it('PUBLIC_HOIST_PATTERN_DIFF 单独出现时按 hard-fail 收类（在途重建由阶梯负责，分类不越权）', () => {
    const out = classifyPnpmError(PUBLIC_HOIST_TEXT)
    assert.equal(out.class, 'hard-fail')
    assert.equal(out.code, PNPM_OUTCOME_CODES.PUBLIC_HOIST_PATTERN_DIFF)
  })
})

// ---------- makeAddViaLadder ----------

/** 记录每次调用的 fake PluginRunner：按序抛错/成功。 */
function fakeRunner(script) {
  const calls = []
  const run = (profile, pluginArgs, options) => {
    calls.push({ profile, pluginArgs, options })
    const step = script[Math.min(calls.length - 1, script.length - 1)]
    if (step instanceof Error) throw step
    if (typeof step === 'function') return step(profile, pluginArgs, options)
    return step
  }
  return { run, calls }
}

function ladderOf(run, allowAllBuilds) {
  return makeAddViaLadder({ runDshPlugin: run, allowAllBuilds })
}

describe('makeAddViaLadder：加装阶梯工厂', () => {
  it('一次成功 → ok + output + usedAllowAllBuilds:false', async () => {
    const { run, calls } = fakeRunner(['installed!'])
    const out = await ladderOf(run)('pkg-a@1.2.3', '/tmp/profile')
    assert.deepEqual(
      { ...out },
      { class: 'ok', output: 'installed!', usedAllowAllBuilds: false },
    )
    assert.deepEqual(calls[0].pluginArgs, ['add', 'pkg-a@1.2.3'])
  })

  it('prepare 被拦 → 写 allowAllBuilds 后重试成功 → usedAllowAllBuilds:true', async () => {
    const { run, calls } = fakeRunner([new Error(PREPARE_BLOCKED_TEXT), 'ok after allow'])
    const allowCalls = []
    const out = await ladderOf(run, (dir) => {
      allowCalls.push(dir)
      return true
    })('pkg-a@1.2.3', '/tmp/profile-x')
    assert.equal(out.class, 'ok')
    assert.equal(out.usedAllowAllBuilds, true)
    assert.deepEqual(allowCalls, ['/tmp/profile-x'], 'allowAllBuilds 收到 profileDir')
    assert.equal(calls.length, 2, '重试一次')
  })

  it('PUBLIC_HOIST_PATTERN_DIFF → no-frozen 重建 → 重试成功', async () => {
    const { run, calls } = fakeRunner([
      new Error(PUBLIC_HOIST_TEXT),
      'rebuilt',
      'added after rebuild',
    ])
    const out = await ladderOf(run)('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.equal(out.output, 'added after rebuild')
    assert.equal(out.usedAllowAllBuilds, false)
    assert.deepEqual(calls[1].pluginArgs, ['install', '--no-frozen-lockfile'], '先重建再重试')
    assert.deepEqual(calls[2].pluginArgs, ['add', 'pkg-a@1.2.3'])
  })

  it('重建后重试仍 prepare 被拦 → allowAllBuilds 再放行重试（全链耗尽路径）', async () => {
    const { run, calls } = fakeRunner([
      new Error(PUBLIC_HOIST_TEXT),
      'rebuilt',
      new Error(PREPARE_BLOCKED_TEXT),
      'ok finally',
    ])
    const out = await ladderOf(run, () => true)('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.equal(out.usedAllowAllBuilds, true)
    assert.equal(calls.length, 4)
  })

  it('重试全部耗尽 → hard-fail/needs-builds 分类结果，永不 throw', async () => {
    // prepare 重试后仍被拦：needs-builds（在途 allowAllBuilds 已耗尽）
    const exhausted = fakeRunner([new Error(PREPARE_BLOCKED_TEXT), new Error(PREPARE_BLOCKED_TEXT)])
    const out1 = await ladderOf(exhausted.run, () => true)('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out1.class, 'needs-builds')
    assert.ok(out1.output.includes('ERR_PNPM_IGNORED_BUILDS'))

    // 普通硬错误直接归类返回
    const hard = fakeRunner([new Error(NO_MATCHING_TEXT)])
    const out2 = await ladderOf(hard.run)('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out2.class, 'retryable-lag')
    assert.equal(out2.code, PNPM_OUTCOME_CODES.NO_MATCHING_VERSION)

    // 重建本身失败：分类重建错误，不 throw
    const rebuildFails = fakeRunner([new Error(PUBLIC_HOIST_TEXT), new Error('命令失败 (exit 1): ERR_PNPM_OUTDATED_LOCKFILE boom')])
    const out3 = await ladderOf(rebuildFails.run)('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out3.class, 'config-drift')
    assert.ok(!('usedAllowAllBuilds' in out3) || out3.usedAllowAllBuilds === undefined)

    // 重建成功但重试加回仍 PUBLIC_HOIST：hard-fail，不无限循环
    const loop = fakeRunner([new Error(PUBLIC_HOIST_TEXT), 'rebuilt', new Error(PUBLIC_HOIST_TEXT)])
    const out4 = await ladderOf(loop.run)('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out4.class, 'hard-fail')
    assert.equal(loop.calls.length, 3, '阶梯只重建一次')
  })

  it('signal 透传到在途 runDshPlugin 调用（含重建与重试）', async () => {
    const { run, calls } = fakeRunner([new Error(PUBLIC_HOIST_TEXT), 'rebuilt', 'ok'])
    const ac = new AbortController()
    const out = await ladderOf(run)('pkg-a@1.2.3', '/tmp/profile', ac.signal)
    assert.equal(out.class, 'ok')
    assert.equal(calls[0].options?.signal, ac.signal, '首次 add 收到 signal')
    assert.equal(calls[1].options?.signal, ac.signal, '重建 install 收到 signal')
    assert.equal(calls[2].options?.signal, ac.signal, '重试 add 收到 signal')
  })

  it('ok 输出统一截断 ≤800 字符（runner 边界约束）', async () => {
    const long = 'x'.repeat(5000)
    const { run } = fakeRunner([long])
    const out = await ladderOf(run)('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.ok(out.output.length <= 800, `实际 ${out.output.length}`)
  })

  it('Y2：allowAllBuilds 写入失败 → 仍 resolve RunnerOutcome（hard-fail），不执行第二次 add', async () => {
    const { run, calls } = fakeRunner([new Error(PREPARE_BLOCKED_TEXT)])
    const out = await ladderOf(run, () => {
      throw Object.assign(new Error('workspace read-only'), { code: 'EROFS' })
    })('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'hard-fail', `实际 ${JSON.stringify(out)}`)
    assert.ok(out.output.includes('workspace read-only'))
    assert.ok(out.output.length <= 800)
    assert.equal(calls.length, 1, 'allowAll 写失败后不再重试 add')
  })
})

describe('PluginRunner seam 形状', () => {
  it('makeAddViaLadder 注入的 runner 按 (profile, pluginArgs, options) 调用', async () => {
    let seen = null
    const run = (profile, pluginArgs, options) => {
      seen = { profile, pluginArgs, options }
      return 'done'
    }
    await ladderOf(run)('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(seen.profile, 'web')
    assert.deepEqual(seen.pluginArgs, ['add', 'pkg-a@1.2.3'])
    assert.equal(seen.options, undefined, '未提供 signal 时不传 options')
  })
})
