/**
 * ADR-0009：web ladder（makeAddViaLadder）三挂点接线——登记覆盖三条成功出口、
 * 双码治理+重试覆盖四个失败出口、留痕短语进 RunnerOutcome.output。
 * 驱动方式参照 tests/pnpm-outcome.test.mjs:82-243（fakeRunner/ladderOf）。
 * 运行：npm run build && node --test tests/dsh-cli-governance.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeAddViaLadder, runDshPlugin, removeDshPlugin, makeDshRunner, isPrepareBlocked, classifyPnpmError } from '../lib/core/dsh-cli.js'

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

  it('评审执行轮：hook1 clean + 挂点3 changed（重试成功）→ output 含挂点3 治理短语', async () => {
    let governCalls = 0
    const { run, calls } = fakeRunner([new Error(DUAL), 'ok after retry'])
    const out = await ladderOf(run, {
      govern: async () => {
        governCalls += 1
        return governCalls === 1 ? { ok: true, changed: false } : { ok: true, changed: true, mergedNames: ['dsh-m'] }
      },
    })('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.equal(calls.length, 2)
    assert.equal(governCalls, 2)
    assert.ok(out.output.includes('；排除条目治理：合并 dsh-m'), `挂点3 治理短语应留痕：${out.output}`)
  })

  it('评审执行轮：hook1 clean + 挂点3 changed（重试仍败）→ output 仍含挂点3 治理短语', async () => {
    let governCalls = 0
    const { run, calls } = fakeRunner([new Error(DUAL), new Error(DUAL)])
    const out = await ladderOf(run, {
      govern: async () => {
        governCalls += 1
        return governCalls === 1 ? { ok: true, changed: false } : { ok: true, changed: true, mergedNames: ['dsh-m'] }
      },
    })('pkg-a@1.2.3', '/tmp/profile')
    assert.notEqual(out.class, 'ok')
    assert.equal(calls.length, 2)
    assert.ok(out.output.includes('；排除条目治理：合并 dsh-m'), `挂点3 治理短语应留痕：${out.output}`)
  })

  it('计划矩阵：profileDir 无 pnpm-workspace.yaml → 缺省绑定全链 no-op、不写盘（首跑成功）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshm-ladder-'))
    const { run } = fakeRunner(['installed!'])
    // 缺省绑定（govern/register 不注入）：govern no-file fail-open、register 本地检查先行 no-file（零网络）
    const out = await makeAddViaLadder({ runDshPlugin: run })('pkg-a@1.2.3', dir)
    assert.equal(out.class, 'ok')
    assert.equal(existsSync(join(dir, 'pnpm-workspace.yaml')), false, '登记不应为无块文件创建任何东西')
  })
})

describe('ADR-0030：runDshPlugin 守卫放开 + profile 名参数化（issue #39）', () => {
  /** runDshPlugin 直驱用桩：argv/cwd 全假，runCommand 捕获 (file, args)。 */
  function fakeDshArgv() {
    return { file: '/bin/echo', args: [], cwd: '/tmp', viaShell: false }
  }
  function captureRunCommand() {
    const calls = []
    const run = async (file, args, opts) => {
      calls.push({ file, args, opts })
      return 'ok'
    }
    return { run, calls }
  }

  it("runDshPlugin('aqua', …) 放行且子进程 argv 含 plugin --profile aqua", async () => {
    const { run, calls } = captureRunCommand()
    const out = await runDshPlugin('aqua', ['add', 'pkg-a@1.0.0'], { dshArgv: fakeDshArgv, runCommand: run, profileDir: '/tmp/pdir' })
    assert.equal(out, 'ok')
    const args = calls[0].args
    const i = args.indexOf('--profile')
    assert.ok(i !== -1, 'argv 应含 --profile')
    assert.equal(args[i + 1], 'aqua', '--profile 应带真实 profile 名')
    assert.equal(args.indexOf('plugin') !== -1, true, 'argv 应含 plugin 子命令')
  })

  it("runDshPlugin('../evil', …) → 拒绝不安全的 profile 名（新守卫文案锚）", async () => {
    await assert.rejects(
      () => runDshPlugin('../evil', ['add', 'pkg-a@1.0.0'], { dshArgv: fakeDshArgv }),
      /拒绝不安全的 profile 名/,
    )
  })

  it('ladder deps.profile → runDshPlugin 首参收到真实名（ADR-0009 三挂点行为不变）', async () => {
    const { run, calls } = fakeRunner(['installed!'])
    const ladder = makeAddViaLadder({ runDshPlugin: run, profile: 'aqua', govern: noopGovern, register: noopRegister, installedVersion: noopInstalledVersion })
    const out = await ladder('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.equal(calls[0].profile, 'aqua')
  })

  it('removeDshPlugin deps.profile → runDshPlugin 首参收到真实名', async () => {
    const { run, calls } = fakeRunner(['removed!'])
    const out = await removeDshPlugin('pkg-a', { runDshPlugin: run, profile: 'aqua', profileDir: '/tmp/profile' })
    assert.equal(out, 'removed!')
    assert.equal(calls[0].profile, 'aqua')
  })

  it("makeDshRunner(dir, 'aqua') → add/remove 均以 aqua 为 profile 名（deps.runDshPlugin 注入缝）", async () => {
    const { run, calls } = fakeRunner(['ok'])
    const runner = makeDshRunner('/tmp/profile', 'aqua', { runDshPlugin: run })
    const add = await runner.add('pkg-a@1.2.3')
    assert.equal(add.class, 'ok')
    assert.equal(calls[0].profile, 'aqua')
    const rem = await runner.remove('pkg-a')
    assert.equal(rem.class, 'ok')
    assert.equal(calls[calls.length - 1].profile, 'aqua')
  })

  it('makeDshRunner 不传名字 → 现状 web（零漂移）', async () => {
    const { run, calls } = fakeRunner(['ok'])
    const runner = makeDshRunner('/tmp/profile', undefined, { runDshPlugin: run })
    await runner.add('pkg-a@1.2.3')
    assert.equal(calls[0].profile, 'web')
  })
})

describe('ADR-0030 收口：viaShell（Windows cmd.exe 兜底）路径的 cmd 安全名守卫（对齐 dsh-market isCmdSafeProfileName）', () => {
  const cmdArgv = () => ({ file: 'dsh', args: [], cwd: undefined, viaShell: true })
  const nodeArgv = () => ({ file: '/bin/echo', args: [], cwd: '/tmp', viaShell: false })
  const noopRun = async () => 'ok'

  it("viaShell=true + 名字含 % → 结构化拒绝（cmd.exe 变量展开面）", async () => {
    await assert.rejects(
      () => runDshPlugin('a%b', ['add', 'pkg-a@1.0.0'], { dshArgv: cmdArgv, runCommand: noopRun }),
      /cmd\.exe|无法安全通过/,
    )
  })
  it('viaShell=true + 名字含 & | ^ 等元字符 → 拒绝', async () => {
    for (const name of ['a&b', 'a|b', 'a^b']) {
      await assert.rejects(
        () => runDshPlugin(name, ['add', 'pkg-a@1.0.0'], { dshArgv: cmdArgv, runCommand: noopRun }),
        /cmd\.exe|无法安全通过/,
      )
    }
  })
  it("viaShell=true + 白名单名（'aqua' / 'a b' / 'dev-1.v2'）→ 放行", async () => {
    for (const name of ['aqua', 'a b', 'dev-1.v2']) {
      const out = await runDshPlugin(name, ['add', 'pkg-a@1.0.0'], { dshArgv: cmdArgv, runCommand: noopRun, profileDir: '/tmp/p' })
      assert.equal(out, 'ok')
    }
  })
  it('viaShell=false（Node 直启）+ 名字含 % → 放行（不经过 cmd.exe，无此面）', async () => {
    const out = await runDshPlugin('a%b', ['add', 'pkg-a@1.0.0'], { dshArgv: nodeArgv, runCommand: noopRun, profileDir: '/tmp/p' })
    assert.equal(out, 'ok')
  })
})

describe('ADR-0034：runDshPlugin spawn 级失败溯源行（issue #65）', () => {
  const errRun = (message) => async () => { throw new Error(message) }

  it('生产路径（不注入 dshArgv）spawn EACCES → 错误带 [dsh-m launch: source=path-fallback … file=dsh]', async () => {
    await assert.rejects(
      () => runDshPlugin('aqua', ['add', 'pkg-a@1.0.0'], { runCommand: errRun('spawn dsh EACCES'), profileDir: '/tmp/p' }),
      (err) => {
        assert.match(err.message, / \[dsh-m launch: source=path-fallback entry=.+ file=dsh\]/, '溯源行：source/entry/file 现场')
        assert.equal(isPrepareBlocked(err.message), false, '溯源行不得染 pnpm 分类面')
        assert.equal(
          classifyPnpmError(err.message).class,
          classifyPnpmError('spawn dsh EACCES').class,
          '分类不因溯源行改变',
        )
        return true
      },
    )
  })

  it('注入 dshArgv（测试上下文）→ 不 enrich（钉裁决）', async () => {
    const fakeDshArgv = () => ({ file: '/bin/echo', args: [], cwd: '/tmp', viaShell: false })
    await assert.rejects(
      () => runDshPlugin('aqua', ['add', 'pkg-a@1.0.0'], { dshArgv: fakeDshArgv, runCommand: errRun('spawn dsh EACCES'), profileDir: '/tmp/p' }),
      (err) => {
        assert.equal(err.message, 'spawn dsh EACCES')
        return true
      },
    )
  })

  it('非 spawn 级错误（exit 失败/超时）→ 不 enrich', async () => {
    for (const message of ['命令失败 (exit 1): boom', '命令超时 200ms']) {
      await assert.rejects(
        () => runDshPlugin('aqua', ['add', 'pkg-a@1.0.0'], { runCommand: errRun(message), profileDir: '/tmp/p' }),
        (err) => {
          assert.equal(err.message, message)
          return true
        },
      )
    }
  })
})
