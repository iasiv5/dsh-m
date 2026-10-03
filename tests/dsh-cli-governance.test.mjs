/**
 * ADR-0009：web ladder（makeAddViaLadder）三挂点接线——登记覆盖三条成功出口、
 * 双码治理+重试覆盖四个失败出口、留痕短语进 RunnerOutcome.output。
 * 驱动方式参照 tests/pnpm-outcome.test.mjs:82-243（fakeRunner/ladderOf）。
 * 运行：npm run build && node --test tests/dsh-cli-governance.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { makeAddViaLadder } from '../lib/core/dsh-cli.js'

const PREPARE = 'needs to execute build scripts (node-sass) ERR_PNPM_IGNORED_BUILDS'
const HOIST = '命令失败 (exit 1): ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF boom'
const DUAL = '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:\n  dsh-m@0.9.8 was published at 2026-10-01T14:26:10.989Z, within the minimumReleaseAge cutoff (2026-09-30T15:08:06.630Z)'

/** 记录每次调用的 fake PluginRunner：按序抛错/成功（pnpm-outcome.test.mjs 同款）。 */
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

const noopGovern = async () => ({ ok: true, changed: false })
const noopRegister = async () => ({ applied: false })
const noopInstalledVersion = async () => undefined

function ladderOf(run, overrides = {}) {
  return makeAddViaLadder({
    runDshPlugin: run,
    ...(overrides.resolveBuilds ? { resolveBuilds: overrides.resolveBuilds } : {}),
    govern: overrides.govern ?? noopGovern,
    register: overrides.register ?? noopRegister,
    installedVersion: overrides.installedVersion ?? noopInstalledVersion,
  })
}

describe('web ladder 三挂点（ADR-0009）：登记覆盖全部成功出口', () => {
  it('首跑成功（npm spec）→ register 恰调一次，收到 {pkg, version, previousVersion}', async () => {
    const { run } = fakeRunner(['installed!'])
    const seen = []
    const out = await ladderOf(run, {
      register: async (dir, target) => {
        seen.push({ dir, target })
        return { applied: true }
      },
      installedVersion: async () => '1.1.0',
    })('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].dir, '/tmp/profile')
    assert.deepEqual(seen[0].target, { pkg: 'pkg-a', version: '1.2.3', previousVersion: '1.1.0' })
  })

  it('prepare 放行重试成功 → register 仍被调（第二条成功出口）', async () => {
    const { run } = fakeRunner([new Error(PREPARE), 'ok after allow'])
    const seen = []
    const out = await ladderOf(run, {
      resolveBuilds: () => ({ approvals: ['node-sass'], fallbackAll: false }),
      register: async (_dir, target) => {
        seen.push(target)
        return { applied: true }
      },
    })('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.deepEqual(out.buildApprovals, ['node-sass'])
    assert.deepEqual(seen, [{ pkg: 'pkg-a', version: '1.2.3', previousVersion: undefined }])
  })

  it('hoist 重建后重试成功 → register 仍被调（第三条成功出口）', async () => {
    const { run } = fakeRunner([new Error(HOIST), 'rebuilt', 'added after rebuild'])
    const seen = []
    const out = await ladderOf(run, {
      register: async (_dir, target) => {
        seen.push(target)
        return { applied: true }
      },
    })('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.equal(out.output, 'added after rebuild')
    assert.deepEqual(seen, [{ pkg: 'pkg-a', version: '1.2.3', previousVersion: undefined }])
  })

  it('github:/裸名 spec → register 不被调', async () => {
    const { run } = fakeRunner(['ok gh'])
    const seen = []
    const out = await ladderOf(run, {
      register: async (_dir, target) => {
        seen.push(target)
        return { applied: true }
      },
    })('github:owner/repo#abcd1234', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.deepEqual(seen, [])
  })

  it('register applied → output 含登记短语；成功 output 仍 ≤800', async () => {
    const { run } = fakeRunner(['installed!'])
    const out = await ladderOf(run, {
      register: async () => ({ applied: true, form: 'merged' }),
    })('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.ok(out.output.includes('；排除条目已登记 pkg-a@1.2.3（merged）'))
    assert.ok(out.output.length <= 800)
  })
})

describe('web ladder 三挂点（ADR-0009）：双码治理+重试覆盖全部四个失败出口', () => {
  it('出口① 首跑 add 双码 → govern changed → 重试该命令一次成功', async () => {
    const { run, calls } = fakeRunner([new Error(DUAL), 'ok after govern'])
    const governCalls = []
    const out = await ladderOf(run, {
      govern: async () => {
        governCalls.push(1)
        return { ok: true, changed: true, mergedNames: ['dsh-m'] }
      },
    })('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.equal(out.output, 'ok after govern；排除条目治理：合并 dsh-m')
    assert.equal(calls.length, 2, '治理后恰重试一次')
    assert.equal(governCalls.length, 2, 'hook1（委派前）与 hook3（双码失败）各一次')
  })

  it('出口① 双码 + govern 无变化 → 不重试，分类失败', async () => {
    const { run, calls } = fakeRunner([new Error(DUAL)])
    const out = await ladderOf(run, { govern: async () => ({ ok: true, changed: false }) })('pkg-a@1.2.3', '/tmp/profile')
    assert.notEqual(out.class, 'ok')
    assert.equal(calls.length, 1)
  })

  it('出口② hoist 重建 install 自身双码 → 治理后重试重建一次', async () => {
    const { run, calls } = fakeRunner([new Error(HOIST), new Error(DUAL), 'rebuilt', 'added'])
    const out = await ladderOf(run, { govern: async () => ({ ok: true, changed: true, mergedNames: ['dsh-m'] }) })('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.ok(out.output.startsWith('added'), `实际 ${out.output}`)
    assert.ok(out.output.includes('；排除条目治理：合并 dsh-m'))
    assert.deepEqual(calls.map((c) => c.pluginArgs[0]), ['add', 'install', 'install', 'add'], '重建命令被治理后重试')
  })

  it('出口③ 重建后 add 双码 → 治理后重试一次', async () => {
    const { run, calls } = fakeRunner([new Error(HOIST), 'rebuilt', new Error(DUAL), 'added after govern'])
    const out = await ladderOf(run, { govern: async () => ({ ok: true, changed: true, mergedNames: ['dsh-m'] }) })('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.ok(out.output.startsWith('added after govern'), `实际 ${out.output}`)
    assert.equal(calls.length, 4)
  })

  it('出口④ prepare 放行重试 add 双码 → 治理后重试一次', async () => {
    const { run, calls } = fakeRunner([new Error(PREPARE), new Error(DUAL), 'ok finally'])
    const out = await ladderOf(run, {
      resolveBuilds: () => ({ approvals: ['node-sass'], fallbackAll: false }),
      govern: async () => ({ ok: true, changed: true, mergedNames: ['dsh-m'] }),
    })('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.deepEqual(out.buildApprovals, ['node-sass'])
    assert.equal(calls.length, 3)
  })

  it('治理重试仍失败 → 分类失败且 output 含治理短语（挂点3 留痕），无第三次重试', async () => {
    const { run, calls } = fakeRunner([new Error(DUAL), new Error(DUAL)])
    const out = await ladderOf(run, { govern: async () => ({ ok: true, changed: true, mergedNames: ['dsh-m'] }) })('pkg-a@1.2.3', '/tmp/profile')
    assert.notEqual(out.class, 'ok')
    assert.equal(calls.length, 2)
    assert.ok(out.output.includes('；排除条目治理：合并 dsh-m'))
  })
})

describe('web ladder 三挂点（ADR-0009）：留痕与 fail-open', () => {
  it('失败出口的治理短语：hook1 治理 changed → 硬失败 output 携带短语', async () => {
    const { run } = fakeRunner([new Error('命令失败 (exit 1): ERR_PNPM_OUTDATED_LOCKFILE boom')])
    const out = await ladderOf(run, { govern: async () => ({ ok: true, changed: true, mergedNames: ['dsh-m'] }) })('pkg-a@1.2.3', '/tmp/profile')
    assert.notEqual(out.class, 'ok')
    assert.ok(out.output.includes('；排除条目治理：合并 dsh-m'))
  })

  it('hook1 治理抛错 → fail-open，阶梯照常', async () => {
    const { run, calls } = fakeRunner(['installed!'])
    const out = await ladderOf(run, {
      govern: async () => {
        throw new Error('disk full')
      },
    })('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.equal(calls.length, 1)
  })

  it('非 npm spec（github:）→ 双码治理/登记路径不触发登记', async () => {
    const { run } = fakeRunner(['ok gh'])
    const seen = []
    const out = await ladderOf(run, {
      register: async (_dir, target) => {
        seen.push(target)
        return { applied: true }
      },
    })('github:owner/repo#abcd1234', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.deepEqual(seen, [])
  })
})
