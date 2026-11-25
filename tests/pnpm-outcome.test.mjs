/**
 * Task 1：pnpm 结果六类分类 + PNPM_OUTCOME_CODES + makeAddViaLadder（可注入加装阶梯工厂）。
 * 原始文本样本与线上事故同形（来源标注于各 fixture；Task 11 起共享 tests/fixtures/pnpm-errors.mjs）。
 * 运行：npm run build && node --test tests/pnpm-outcome.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  classifyPnpmError,
  makeAddViaLadder,
  makeDshRunner,
  PNPM_OUTCOME_CODES,
  pnpmInstallSpawnPlan,
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
      registry: 'npmjs',
      missingPackage: '@iasiv5/dsh-skins',
    })
    assert.deepEqual(classifyPnpmError(UNUSED_PATCH_TEXT), {
      class: 'unused-patch',
      code: PNPM_OUTCOME_CODES.UNUSED_PATCH,
      registry: null,
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

/** resolveBuilds 决策桩：默认精确放行 node-sass（可覆盖）。
 *  ADR-0009：govern/register 缺省注入 no-op 替身——既有用例零改动且不被动出网
 *  （缺省绑定会走 exclude-governance 的真实读盘/registry 探测）。 */
function ladderOf(run, resolveBuilds, overrides = {}) {
  const decision = resolveBuilds ?? (() => ({ approvals: ['node-sass'], needsApproval: false, pendingBuilds: [] }))
  return makeAddViaLadder({
    runDshPlugin: run,
    resolveBuilds: decision,
    govern: overrides.govern ?? (async () => ({ ok: true, changed: false })),
    register: overrides.register ?? (async () => ({ applied: false })),
    installedVersion: overrides.installedVersion ?? (async () => undefined),
  })
}

describe('makeAddViaLadder：加装阶梯工厂', () => {
  it('resolveBuilds 抛错 → Y2 契约转 hard-fail（永不 throw）', async () => {
    const { run } = fakeRunner([new Error(PREPARE_BLOCKED_TEXT), 'should-not-run'])
    const out = await ladderOf(run, () => { throw new Error('写盘失败') })('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'hard-fail')
    assert.equal(out.output.includes('写盘失败'), true)
  })

  it('resolveBuilds 未获同意（needsApproval）→ 零写盘结构化请示：needs-builds + buildApprovalNeeded + pendingBuilds，不重试', async () => {
    const { run, calls } = fakeRunner([new Error(PREPARE_BLOCKED_TEXT)])
    const out = await ladderOf(run, () => ({ approvals: [], needsApproval: true, pendingBuilds: ['node-pty'] }))('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'needs-builds')
    assert.equal(out.buildApprovalNeeded, true)
    assert.deepEqual(out.pendingBuilds, ['node-pty'])
    assert.ok(!('fallbackAllBuilds' in out), '全量兜底已退役：请示结果不带 fallbackAllBuilds')
    assert.equal(calls.length, 1, '未获同意不重试')
    assert.ok(out.output.includes('node-pty'), '请示文案携带待决名单')
  })

  it('一次成功 → ok + output + buildApprovals:[]', async () => {
    const { run, calls } = fakeRunner(['installed!'])
    const out = await ladderOf(run)('pkg-a@1.2.3', '/tmp/profile')
    assert.deepEqual(
      { ...out },
      { class: 'ok', output: 'installed!', buildApprovals: [], fallbackAllBuilds: false },
    )
    assert.deepEqual(calls[0].pluginArgs, ['add', 'pkg-a@1.2.3'])
  })

  it('prepare 被拦 → 精确放行后重试成功 → buildApprovals 携带名单', async () => {
    const { run, calls } = fakeRunner([new Error(PREPARE_BLOCKED_TEXT), 'ok after allow'])
    const allowCalls = []
    const out = await ladderOf(run, (dir) => {
      allowCalls.push(dir)
      return { approvals: ['node-sass'], needsApproval: false, pendingBuilds: [] }
    })('pkg-a@1.2.3', '/tmp/profile-x')
    assert.equal(out.class, 'ok')
    assert.deepEqual(out.buildApprovals, ['node-sass'])
      assert.equal(out.fallbackAllBuilds, false)
    assert.deepEqual(allowCalls, ['/tmp/profile-x'], 'resolveBuilds 收到 profileDir')
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
    assert.deepEqual(out.buildApprovals, [])
      assert.equal(out.fallbackAllBuilds, false)
    assert.deepEqual(calls[1].pluginArgs, ['install', '--no-frozen-lockfile'], '先重建再重试')
    assert.deepEqual(calls[2].pluginArgs, ['add', 'pkg-a@1.2.3'])
  })

  it('重建后重试仍 prepare 被拦 → resolveBuilds 再放行重试（全链耗尽路径）', async () => {
    const { run, calls } = fakeRunner([
      new Error(PUBLIC_HOIST_TEXT),
      'rebuilt',
      new Error(PREPARE_BLOCKED_TEXT),
      'ok finally',
    ])
    const out = await ladderOf(run, () => ({ approvals: ['node-sass'], needsApproval: false, pendingBuilds: [] }))('pkg-a@1.2.3', '/tmp/profile')
    assert.equal(out.class, 'ok')
    assert.deepEqual(out.buildApprovals, ['node-sass'])
      assert.equal(out.fallbackAllBuilds, false)
    assert.equal(calls.length, 4)
  })

  it('重试全部耗尽 → hard-fail/needs-builds 分类结果，永不 throw', async () => {
    // prepare 重试后仍被拦：needs-builds（在途放行重试已耗尽）
    const exhausted = fakeRunner([new Error(PREPARE_BLOCKED_TEXT), new Error(PREPARE_BLOCKED_TEXT)])
    const out1 = await ladderOf(exhausted.run, () => ({ approvals: ['node-sass'], needsApproval: false, pendingBuilds: [] }))('pkg-a@1.2.3', '/tmp/profile')
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
    assert.ok(!('buildApprovals' in out3) || out3.buildApprovals === undefined)

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

// ---------- 缺省 writePreciseBuilds：逐项同意闸门（安全修订 sfind-5dbc…，真文件读写） ----------

/** pnpm 11 写下的待决占位值（build-approval.ts PENDING_PLACEHOLDER 同款逐字）。 */
const PENDING_PLACEHOLDER = 'set this to true or false'

/** 临时 profile + 带 pending 占位的 pnpm-workspace.yaml；测试结束自清理。 */
function profileWithPendingBuilds(names) {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-builds-'))
  const yaml = names.length > 0
    ? `allowBuilds:\n${names.map((n) => `  ${n}: "${PENDING_PLACEHOLDER}"`).join('\n')}\n`
    : ''
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), yaml, 'utf8')
  return { dir, file: join(dir, 'pnpm-workspace.yaml') }
}

/** 不注入 resolveBuilds 的阶梯（走缺省 writePreciseBuilds 真读盘）；govern/register 静音。 */
function defaultLadderOf(run, approvedBuilds) {
  return makeAddViaLadder({
    runDshPlugin: run,
    ...(approvedBuilds !== undefined ? { approvedBuilds } : {}),
    govern: async () => ({ ok: true, changed: false }),
    register: async () => ({ applied: false }),
    installedVersion: async () => undefined,
  })
}

describe('缺省 writePreciseBuilds：逐项同意闸门（安全修订 sfind-5dbc…）', () => {
  it('首次被拦（ERR_PNPM_IGNORED_BUILDS）且无 approvedBuilds → 文件逐字节不变，无 allowBuilds 写入、无全量开关（红驱动主用例）', async () => {
    const { dir, file } = profileWithPendingBuilds(['node-pty', 'node-sass'])
    const before = readFileSync(file, 'utf8')
    const { run, calls } = fakeRunner([new Error(PREPARE_BLOCKED_TEXT)])
    const out = await defaultLadderOf(run)('pkg-a@1.2.3', dir)
    assert.equal(out.class, 'needs-builds')
    assert.equal(out.buildApprovalNeeded, true)
    assert.deepEqual(out.pendingBuilds, ['node-pty', 'node-sass'], 'pending 名单来自 workspace 占位，与报错文本无关')
    assert.equal(readFileSync(file, 'utf8'), before, 'pnpm-workspace.yaml 必须逐字节保持不变')
    assert.ok(!readFileSync(file, 'utf8').includes('dangerouslyAllowAllBuilds'), '绝不自动写全量开关')
    assert.equal(calls.length, 1, '未获同意不重试')
    rmSync(dir, { recursive: true, force: true })
  })

  it('pending 名单不可得（无占位）→ 结构化请示（pendingBuilds 空），同样零写盘', async () => {
    const { dir, file } = profileWithPendingBuilds([])
    const { run } = fakeRunner([new Error(PREPARE_BLOCKED_TEXT)])
    const out = await defaultLadderOf(run)('pkg-a@1.2.3', dir)
    assert.equal(out.class, 'needs-builds')
    assert.equal(out.buildApprovalNeeded, true)
    assert.ok(!('pendingBuilds' in out), '名单不可得 → 字段缺席（事务层归一为 []）')
    assert.ok(out.output.includes('未留下待决名单'))
    assert.equal(existsSync(file), true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('approvedBuilds 回显（部分）→ 只对回显项写 allowBuilds:true 并重试；未确认项保持占位、全量开关永不出现', async () => {
    const { dir, file } = profileWithPendingBuilds(['node-pty', 'node-sass'])
    const { run, calls } = fakeRunner([new Error(PREPARE_BLOCKED_TEXT), 'ok after allow'])
    const out = await defaultLadderOf(run, ['node-pty'])('pkg-a@1.2.3', dir)
    assert.equal(out.class, 'ok')
    assert.deepEqual(out.buildApprovals, ['node-pty'])
    assert.equal(out.fallbackAllBuilds, false)
    const after = readFileSync(file, 'utf8')
    assert.ok(after.includes('node-pty: true'), '获准项写 true')
    assert.ok(after.includes(`node-sass: "${PENDING_PLACEHOLDER}"`), '未确认项保持占位')
    assert.ok(!after.includes('dangerouslyAllowAllBuilds'), '全量开关永不出现')
    assert.equal(calls.length, 2, '获准后重试一次')
    rmSync(dir, { recursive: true, force: true })
  })

  it('approvedBuilds 回显（全部）→ 两键均写 true 且重试成功', async () => {
    const { dir, file } = profileWithPendingBuilds(['node-pty', 'node-sass'])
    const { run } = fakeRunner([new Error(PREPARE_BLOCKED_TEXT), 'ok after allow'])
    const out = await defaultLadderOf(run, ['node-pty', 'node-sass'])('pkg-a@1.2.3', dir)
    assert.equal(out.class, 'ok')
    assert.deepEqual(out.buildApprovals, ['node-pty', 'node-sass'])
    const after = readFileSync(file, 'utf8')
    assert.ok(after.includes('node-pty: true'))
    assert.ok(after.includes('node-sass: true'))
    assert.ok(!after.includes('dangerouslyAllowAllBuilds'))
    rmSync(dir, { recursive: true, force: true })
  })

  it('approvedBuilds 与 pending 无交集 → 零写盘请示（不写未知项）', async () => {
    const { dir, file } = profileWithPendingBuilds(['node-pty'])
    const before = readFileSync(file, 'utf8')
    const { run } = fakeRunner([new Error(PREPARE_BLOCKED_TEXT)])
    const out = await defaultLadderOf(run, ['totally-other-pkg'])('pkg-a@1.2.3', dir)
    assert.equal(out.class, 'needs-builds')
    assert.equal(out.buildApprovalNeeded, true)
    assert.equal(readFileSync(file, 'utf8'), before, '无获准项 = 文件不变')
    rmSync(dir, { recursive: true, force: true })
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

// ---------- F1-R/B（第三轮复审）：生产 frozenInstall 的进程树终止 ----------

describe('makeDshRunner.frozenInstall：生产进程树终止（F1-R/B）', () => {
  // ⚠️ 平台边界：假 pnpm 是 #!/bin/sh 脚本，且断言依赖 POSIX 进程组 + SIGTERM 语义
  // （Windows 无进程组、无法执行 shebang 脚本），仅 POSIX 执行。
  const POSIX_ONLY = process.platform === 'win32' ? '假 pnpm 为 shebang 脚本且依赖 POSIX 进程组语义，Windows 不适用' : false

  it('abort 后 pnpm 的后代（同组、忽略 SIGTERM）必须被组 SIGKILL，marker 不写出', { skip: POSIX_ONLY }, async (t) => {
    const binDir = mkdtempSync(join(tmpdir(), 'dshm-bin-'))
    const profileDir = mkdtempSync(join(tmpdir(), 'dshm-frozen-'))
    const marker = join(tmpdir(), `dshm-pnpm-tree-${process.pid}-${Date.now()}.marker`)
    const ready = join(tmpdir(), `dshm-pnpm-tree-ready-${process.pid}-${Date.now()}.marker`)
    // 假 pnpm：派生忽略 SIGTERM 的后代（输出重定向，不持有 sh 的管道），TERM 时自己退出；
    // grandchild 启动即写 ready（round-2 P14 就绪门锚——仿 F1-R/C）
    const grandchild = `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(ready)}, 'x'); setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(marker)}, 'x') }, 1500)`
    const fakePnpm = join(binDir, 'pnpm')
    writeFileSync(fakePnpm, `#!/bin/sh\n"${process.execPath}" -e ${JSON.stringify(grandchild)} >/dev/null 2>&1 &\ntrap 'exit 0' TERM\nwait\n`)
    chmodSync(fakePnpm, 0o755)
    const oldPath = process.env.PATH
    const oldGrace = process.env.DSH_KILL_GRACE_MS
    process.env.PATH = `${binDir}:${oldPath}`
    process.env.DSH_KILL_GRACE_MS = '400'
    try {
      const ac = new AbortController()
      const startedAt = Date.now()
      const pending = makeDshRunner(profileDir).frozenInstall(ac.signal)
      // round-2 P14 就绪门（评审开题）：原固定 start+150ms abort 隐含「子进程启动快于 150ms」
      // 前提——载荷下（探针模块图开销/双全量并发实录）grandchild 未及武装即 abort → 组空快
      // settle → 下界断言假红。改就绪门：ready 出现后 abort（组已武装，下界确定性成立）；
      // 3s 未就绪（载荷）→ diagnostic 跳过下界，与 F1-R/C 同款两分支。断言面不变。
      const readyDeadline = Date.now() + 3000
      while (!existsSync(ready) && Date.now() < readyDeadline) await new Promise((r) => setTimeout(r, 25))
      const groupArmed = existsSync(ready)
      if (!groupArmed) t.diagnostic('grandchild 3s 未就绪（载荷）——组空快 settle 属合法，跳过下界断言')
      ac.abort()
      const out = await pending
      const elapsed = Date.now() - startedAt
      assert.equal(out.class, 'hard-fail', `取消应归为失败结果：${JSON.stringify(out)}`)
      assert.ok(/命令已取消/.test(out.output))
      if (groupArmed) assert.ok(elapsed >= 400, `必须等进程组消失（grace 后 SIGKILL）才返回 RunnerOutcome，实际 ${elapsed}ms`)
      await new Promise((r) => setTimeout(r, 2500)) // 越过后代 marker 计划写出时刻
      assert.equal(existsSync(marker), false, 'pnpm 后代不得在 operation 返回后继续写文件')
    } finally {
      process.env.PATH = oldPath
      if (oldGrace === undefined) delete process.env.DSH_KILL_GRACE_MS
      else process.env.DSH_KILL_GRACE_MS = oldGrace
      rmSync(binDir, { recursive: true, force: true })
      rmSync(profileDir, { recursive: true, force: true })
    }
  })
})

// ---------- registry 源识别（L2，ADR-0012）：完整文本判定、先于截断 ----------

describe('classifyPnpmError registry 源识别（L2，ADR-0012）', () => {
  it('npmmirror 特征 → npmmirror；npmjs 特征 → npmjs；无关输出 → null', () => {
    assert.equal(classifyPnpmError(`${NO_MATCHING_TEXT} from https://registry.npmmirror.com/`).registry, 'npmmirror')
    assert.equal(classifyPnpmError('ERR_PNPM_NO_MATCHING_VERSION while fetching it from https://registry-direct.npmmirror.com/').registry, 'npmmirror')
    assert.equal(classifyPnpmError('ERR_PNPM_NO_MATCHING_VERSION while fetching from https://registry.npmjs.org/x').registry, 'npmjs')
    assert.equal(classifyPnpmError('ERR_PNPM_NO_MATCHING_VERSION No matching version found').registry, null)
    assert.equal(classifyPnpmError(OUTDATED_LOCKFILE_TEXT).registry, null)
  })

  it('特征串位于 800 字截断线之外仍识别（分类先于截断，评审 R1-3）', () => {
    const pad = 'x'.repeat(900)
    const text = `ERR_PNPM_NO_MATCHING_VERSION No matching version found for pkg-a@1.2.8\n${pad}\nfrom https://registry.npmmirror.com/`
    assert.ok(text.length > 800)
    const c = classifyPnpmError(text)
    assert.equal(c.class, 'retryable-lag')
    assert.equal(c.registry, 'npmmirror')
  })
})

// ---------- 回滚/重建 install 的 spawn 计划（issue #77）：win32 裸 spawn pnpm 必 ENOENT ----------

describe('pnpmInstallSpawnPlan（issue #77）', () => {
  it('win32：viaShell=true + detached=false + --dir 双引号包裹（cmd 分词防护）', () => {
    const p = pnpmInstallSpawnPlan('C:\\Users\\J O\\.dsh\\profiles\\aqua', 'frozen', 'win32')
    assert.equal(p.file, 'pnpm')
    assert.equal(p.viaShell, true)
    assert.equal(p.detached, false)
    assert.deepEqual(p.args, ['--dir', '"C:\\Users\\J O\\.dsh\\profiles\\aqua"', 'install', '--frozen-lockfile'])
  })

  it('win32 rebuild：--no-frozen-lockfile 同款 shell 形态', () => {
    const p = pnpmInstallSpawnPlan('C:\\p', 'rebuild', 'win32')
    assert.deepEqual(p.args, ['--dir', '"C:\\p"', 'install', '--no-frozen-lockfile'])
    assert.equal(p.viaShell, true)
    assert.equal(p.detached, false)
  })

  it('POSIX：viaShell=false + detached=true + 路径不加引号（既有行为零漂移）', () => {
    const p = pnpmInstallSpawnPlan('/tmp/profile-x', 'frozen', 'linux')
    assert.equal(p.viaShell, false)
    assert.equal(p.detached, true)
    assert.deepEqual(p.args, ['--dir', '/tmp/profile-x', 'install', '--frozen-lockfile'])
  })
})

describe('makeDshRunner frozen/rebuild 接线（issue #77）：spawn 计划透传 runCommand', () => {
  it('frozenInstall/rebuildInstall 把计划交给 deps.runCommand（viaShell/detached 随平台）', async () => {
    const seen = []
    const fakeRunCommand = async (file, args, options) => {
      seen.push({ file, args, options })
      return 'installed'
    }
    const runner = makeDshRunner('C:\\Users\\J O\\.dsh\\profiles\\aqua', 'aqua', { runCommand: fakeRunCommand })
    const outF = await runner.frozenInstall()
    const outR = await runner.rebuildInstall()
    assert.equal(outF.class, 'ok')
    assert.equal(outR.class, 'ok')
    assert.equal(seen.length, 2)
    assert.equal(seen[0].file, 'pnpm')
    assert.equal(seen[0].options.viaShell, process.platform === 'win32')
    assert.equal(seen[0].options.detached, process.platform !== 'win32')
    assert.ok(seen[0].args.includes('--frozen-lockfile'))
    assert.ok(seen[1].args.includes('--no-frozen-lockfile'))
    assert.equal(seen[1].options.viaShell, process.platform === 'win32')
    if (process.platform === 'win32') {
      assert.ok(seen[0].args.some((a) => a.startsWith('"') && a.includes('profiles\\aqua')), JSON.stringify(seen[0].args))
    }
  })
})

// ---------- win32 真实 shell 级防线（issue #77 增强用例，评审终审建议 1） ----------
// 绿钉性质：runCommand 的 viaShell 形参 HEAD 已实现（:549–568），本用例钉「真实 pnpm
// cmd shim 经 shell 可解析 + 引号交互不炸」的环境契约不被未来回归；红驱动由上方 seen
// 接线断言承担。PATH 无 pnpm 的环境整体 t.skip（探测经 shell:true spawnSync，不假红）。

describe('win32 真实 shell 级防线（issue #77）', () => {
  it('runCommand 经 viaShell spawn 真实 pnpm → 非 ENOENT、输出版本号（win32 验证 cmd shim 解析；POSIX 验证直启不回归）', async (t) => {
    const { spawnSync } = await import('node:child_process')
    const probe = spawnSync('pnpm', ['--version'], { shell: true, encoding: 'utf8' })
    if (probe.status !== 0) return t.skip(`PATH 上无 pnpm（shell 探测 status=${probe.status}），本环境不适用`)
    const { runCommand } = await import('../lib/core/dsh-cli.js')
    const out = await runCommand('pnpm', ['--version'], { timeoutMs: 30_000, viaShell: process.platform === 'win32' })
    assert.match(out, /^\d+\.\d+/)
  })
})

// ---------- classifyPnpmError 缺失包提取（issue #78） ----------

describe('classifyPnpmError 缺失包提取（issue #78）', () => {
  it('主包名形态：found for <pkg>@<ver> → missingPackage 携出', () => {
    const c = classifyPnpmError('ERR_PNPM_NO_MATCHING_VERSION No matching version found for dsh-mnemon@0.5.48 while fetching it from https://registry.npmmirror.com/')
    assert.equal(c.missingPackage, 'dsh-mnemon')
  })

  it('pin 子依赖（issue #78 事故同形）与 scoped 名（贪婪到最后一个 @）', () => {
    const sub = classifyPnpmError('ERR_PNPM_NO_MATCHING_VERSION No matching version found for dsh-mnemon-source-memory-spaces@0.5.30 while fetching it from https://registry.npmmirror.com/')
    assert.equal(sub.missingPackage, 'dsh-mnemon-source-memory-spaces')
    assert.equal(classifyPnpmError(NO_MATCHING_TEXT).missingPackage, '@iasiv5/dsh-skins')
  })

  it('特征串位于 800 字截断线之外仍提取（分类先于截断，与 registry 识别同款）', () => {
    const pad = 'x'.repeat(900)
    const text = `ERR_PNPM_NO_MATCHING_VERSION No matching version found for pkg-dep@0.1.0\n${pad}\nfrom https://registry.npmmirror.com/`
    assert.ok(text.length > 800)
    assert.equal(classifyPnpmError(text).missingPackage, 'pkg-dep')
  })

  it('无「found for」句式 / 非 NO_MATCHING 类 → 字段缺席（负向锚：现状即绿——HEAD 本就不携带该字段）', () => {
    const bare = classifyPnpmError('ERR_PNPM_NO_MATCHING_VERSION while fetching it from https://registry.npmmirror.com/')
    assert.ok(!('missingPackage' in bare))
    assert.ok(!('missingPackage' in classifyPnpmError(OUTDATED_LOCKFILE_TEXT)))
  })

  it('「found for」后非合法包名（多段路径）→ 不携带（负向锚：现状即绿，同上机制）', () => {
    const junk = classifyPnpmError('ERR_PNPM_NO_MATCHING_VERSION No matching version found for ../../etc/passwd@1.0.0 while fetching it from https://registry.npmmirror.com/')
    assert.ok(!('missingPackage' in junk))
  })
})
