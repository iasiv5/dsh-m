/**
 * Doctor Day1（ADR-0010）Task 1：类型契约 + detectLayout 布局探测。
 * 运行：npm run build && node --test tests/doctor.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { detectLayout, analyzeFarm, listResidue, checkAccount, runDoctor } from '../lib/core/doctor.js'

let root
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dshm-doctor-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('detectLayout（布局判据与优先级，评审 R1.1）', () => {
  it('isolated：无声明且 .pnpm 含包目录 → isolated', async () => {
    mkdirSync(join(root, 'node_modules', '.pnpm', 'foo@1.0.0'), { recursive: true })
    assert.equal(await detectLayout(root), 'isolated')
  })

  it('hoisted：workspace 声明 nodeLinker: hoisted → hoisted', async () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\n')
    assert.equal(await detectLayout(root), 'hoisted')
  })

  it('冲突并存（本机实况形态）：声明 hoisted + .pnpm 仅 lock.yaml → 声明优先，判 hoisted', async () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')
    mkdirSync(join(root, 'node_modules', '.pnpm'), { recursive: true })
    writeFileSync(join(root, 'node_modules', '.pnpm', 'lock.yaml'), '# vestigial\n')
    assert.equal(await detectLayout(root), 'hoisted')
  })

  it('冲突并存加强：声明 hoisted + .pnpm 含包目录 → 声明仍然优先', async () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')
    mkdirSync(join(root, 'node_modules', '.pnpm', 'foo@1.0.0'), { recursive: true })
    assert.equal(await detectLayout(root), 'hoisted')
  })

  it('unknown：皆无 → unknown', async () => {
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    assert.equal(await detectLayout(root), 'unknown')
  })

  it('unknown（判据收紧）：无声明且 .pnpm 仅 lock.yaml → 不算 isolated', async () => {
    mkdirSync(join(root, 'node_modules', '.pnpm'), { recursive: true })
    writeFileSync(join(root, 'node_modules', '.pnpm', 'lock.yaml'), '# vestigial\n')
    assert.equal(await detectLayout(root), 'unknown')
  })

  it('unknown（判据收紧·执行评审 E1.5）：.pnpm 仅 lock.yaml + 点文件 → 仍不算 isolated', async () => {
    mkdirSync(join(root, 'node_modules', '.pnpm'), { recursive: true })
    writeFileSync(join(root, 'node_modules', '.pnpm', 'lock.yaml'), '# vestigial\n')
    writeFileSync(join(root, 'node_modules', '.pnpm', '.DS_Store'), 'junk')
    assert.equal(await detectLayout(root), 'unknown')
  })

  it('workspace 声明存在但无 nodeLinker 键 → 不构成 hoisted 判据，按 .pnpm 判', async () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    mkdirSync(join(root, 'node_modules', '.pnpm', 'foo@1.0.0'), { recursive: true })
    assert.equal(await detectLayout(root), 'isolated')
  })
})

// ---------- Task 2：analyzeFarm（祖先链遍历 + 两级 targetVersion + 降级，评审 R1.2/R1.3/R1.4） ----------

/** 复刻本机形态的 fixture：DSH_HOME 根 + profiles/web + 父级共享店农场。 */
function farmFixture() {
  const home = mkdtempSync(join(tmpdir(), 'dshm-farm-'))
  const profile = join(home, 'profiles', 'web')
  const scopeAt = (level) => join(level, 'node_modules', '@deepseek-ai')
  mkdirSync(scopeAt(profile), { recursive: true })
  mkdirSync(scopeAt(home), { recursive: true }) // 父目录共享店（本机实况：农场在 profile 父级）
  return { home, profile, scopeAt }
}

describe('analyzeFarm', () => {
  let home, profile, scopeAt
  beforeEach(() => {
    ;({ home, profile, scopeAt } = farmFixture())
    process.env.DSH_HOME = home
  })
  afterEach(() => {
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  })

  it('祖先链遍历命中父目录共享店（farmChecked>0，评审 R1.2 反空转）', async () => {
    symlinkSync(join(home, 'rt', 'x'), join(scopeAt(home), 'dsh-x')) // 悬空也计入 farmChecked
    const r = await analyzeFarm(profile, 'hoisted', null)
    assert.equal(r.farm.length, 1)
  })

  it('悬空 → error finding（check=farm-liveness，title 含包名，hint 提 know-how 014）', async () => {
    symlinkSync(join(home, 'gone-store', 'node_modules', '@deepseek-ai', 'dsh-x'), join(scopeAt(home), 'dsh-x'))
    const r = await analyzeFarm(profile, 'hoisted', null)
    assert.equal(r.farm[0].state, 'dangling')
    assert.equal(r.findings.length, 1)
    assert.equal(r.findings[0].severity, 'error')
    assert.equal(r.findings[0].check, 'farm-liveness')
    assert.ok(r.findings[0].title.includes('dsh-x'))
    assert.ok(r.findings[0].hint.length > 0)
  })

  it('dsh 伞包指向旧运行时 store → stale-target（只进清单不产生 finding）；两级提取第一级（目录名版本段）', async () => {
    const target = join(home, 'store', '@deepseek-ai+dsh@0.1.7-rc.2_abc123ef', 'node_modules', '@deepseek-ai', 'dsh')
    mkdirSync(target, { recursive: true })
    symlinkSync(target, join(scopeAt(home), 'dsh'))
    const r = await analyzeFarm(profile, 'hoisted', '0.2.0-rc.2')
    assert.equal(r.farm[0].state, 'stale-target')
    assert.equal(r.farm[0].targetVersion, '0.1.7-rc.2')
    assert.equal(r.findings.length, 0)
  })

  it('非 dsh 伞包（如 cordis）版本不同于 runtime 也不判 stale——跨命名空间不比较（误报纪律）', async () => {
    const target = join(home, 'rt', '.pnpm', '@deepseek-ai+cordis@4.0.1_deadbeef99', 'node_modules', '@deepseek-ai', 'cordis')
    mkdirSync(target, { recursive: true })
    symlinkSync(target, join(scopeAt(home), 'cordis'))
    const r = await analyzeFarm(profile, 'hoisted', '0.2.0-rc.2')
    assert.equal(r.farm[0].state, 'healthy')
    assert.equal(r.farm[0].targetVersion, '4.0.1')
    assert.equal(r.findings.length, 0)
  })

  it('两级提取第二级：无版本段目标读其 package.json version（评审 R1.4——本机 235/236 形态）', async () => {
    const target = join(home, 'rt', '.pnpm', 'node_modules', '@deepseek-ai', 'dsh-tools')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.1.7-rc.2' }))
    symlinkSync(target, join(scopeAt(home), 'dsh-tools'))
    const r = await analyzeFarm(profile, 'hoisted', null)
    assert.equal(r.farm[0].state, 'healthy')
    assert.equal(r.farm[0].targetVersion, '0.1.7-rc.2')
  })

  it('runtimeVersion=null → 不判 stale、记降级 unknowns；dsh 旧 store 也记 healthy（评审 R1.3 降级路径）', async () => {
    const target = join(home, 'store', '@deepseek-ai+dsh@0.1.7-rc.2_abc123ef', 'node_modules', '@deepseek-ai', 'dsh')
    mkdirSync(target, { recursive: true })
    symlinkSync(target, join(scopeAt(home), 'dsh'))
    const r = await analyzeFarm(profile, 'hoisted', null)
    assert.equal(r.farm[0].state, 'healthy')
    assert.ok(r.unknowns.some((u) => u.includes('stale')))
  })

  it('dsh 伞包指向当前运行时版本 → healthy 不 stale', async () => {
    const target = join(home, 'store', '@deepseek-ai+dsh@0.2.0-rc.2_abc123ef', 'node_modules', '@deepseek-ai', 'dsh')
    mkdirSync(target, { recursive: true })
    symlinkSync(target, join(scopeAt(home), 'dsh'))
    const r = await analyzeFarm(profile, 'hoisted', '0.2.0-rc.2')
    assert.equal(r.farm[0].state, 'healthy')
  })

  it('两级提取皆失败 → targetVersion=null 聚合进 unknowns（不逐条刷屏）', async () => {
    const target = join(home, 'weird') // 存在但无 package.json、路径无版本段
    mkdirSync(target, { recursive: true })
    symlinkSync(target, join(scopeAt(home), 'weird'))
    const r = await analyzeFarm(profile, 'hoisted', null)
    assert.equal(r.farm[0].targetVersion, null)
    assert.equal(r.unknowns.filter((u) => u.includes('无法解析')).length, 1)
  })
})

// ---------- Task 3：listResidue（四类残留，结构化清单零告警） ----------

describe('listResidue', () => {
  let home, profile
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dshm-residue-'))
    profile = join(home, 'profiles', 'web')
    mkdirSync(join(profile, 'node_modules'), { recursive: true })
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('四类各自命中且零 finding：no-manifest / empty-scope / tmp-dir / bak-file', async () => {
    mkdirSync(join(profile, 'node_modules', 'broken-pkg')) // 无 package.json
    mkdirSync(join(profile, 'node_modules', '@ghost')) // 空 scope
    mkdirSync(join(profile, 'node_modules', 'x_pkg_tmp_123_ab12')) // pnpm 暂存形态
    mkdirSync(join(profile, 'node_modules', 'healthy'), { recursive: true })
    writeFileSync(join(profile, 'node_modules', 'healthy', 'package.json'), '{}')
    writeFileSync(join(profile, 'package.json.bak-20260903'), '{}')
    const r = await listResidue(profile, 'hoisted')
    const kinds = r.residue.map((x) => x.kind).sort()
    assert.deepEqual(kinds, ['bak-file', 'empty-scope', 'no-manifest', 'tmp-dir'])
  })

  it('正常安装不误报：有 package.json 的目录与有成员的 scope 都不算残留', async () => {
    mkdirSync(join(profile, 'node_modules', 'good'), { recursive: true })
    writeFileSync(join(profile, 'node_modules', 'good', 'package.json'), '{}')
    mkdirSync(join(profile, 'node_modules', '@scope', 'pkg'), { recursive: true })
    const r = await listResidue(profile, 'hoisted')
    assert.equal(r.residue.length, 0)
  })

  it('isolated：.pnpm 顶层一层只查 *_tmp_*；正常 store 目录（foo@1.0.0，无根级 package.json）不误报', async () => {
    mkdirSync(join(profile, 'node_modules', '.pnpm', 'foo@1.0.0', 'node_modules', 'foo'), { recursive: true })
    mkdirSync(join(profile, 'node_modules', '.pnpm', 'leftover_tmp_7_ff3'))
    const r = await listResidue(profile, 'isolated')
    assert.equal(r.residue.length, 1)
    assert.equal(r.residue[0].kind, 'tmp-dir')
    assert.ok(r.residue[0].path.includes('leftover_tmp_7_ff3'))
  })

  it('hoisted：不做 .pnpm 扫描，unknowns 记中性事实（含 lock.yaml 残留并存说明）', async () => {
    mkdirSync(join(profile, 'node_modules', '.pnpm'), { recursive: true })
    writeFileSync(join(profile, 'node_modules', '.pnpm', 'lock.yaml'), '# vestigial\n')
    const r = await listResidue(profile, 'hoisted')
    assert.equal(r.residue.length, 0)
    assert.ok(r.unknowns.some((u) => u.includes('不扫 .pnpm 店')))
  })

  it('bak-file 的 note 含 mtime（计数+最旧时间入 note）', async () => {
    writeFileSync(join(profile, 'package.json.bak-20260903'), '{}')
    const r = await listResidue(profile, 'hoisted')
    assert.equal(r.residue[0].kind, 'bak-file')
    assert.ok(r.residue[0].note && r.residue[0].note.includes('mtime'))
  })
})

// ---------- Task 4：checkAccount（三处记账：pin / 实装 / lockfile） ----------

describe('checkAccount', () => {
  let home, profile
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dshm-account-'))
    profile = join(home, 'profiles', 'web')
    mkdirSync(profile, { recursive: true })
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  function mkProfile(deps, lockBody) {
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'p', dependencies: deps }))
    if (lockBody !== null) writeFileSync(join(profile, 'pnpm-lock.yaml'), lockBody)
  }
  function mkInstalled(name, version) {
    mkdirSync(join(profile, 'node_modules', name), { recursive: true })
    writeFileSync(join(profile, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }))
  }
  const lock = (entries) =>
    'lockfileVersion: \'9.0\'\nimporters:\n  .:\n    dependencies:\n' +
    entries.map((e) => `      ${e.name}:\n        specifier: ${e.spec}\n        version: ${e.ver}\n`).join('')

  it('三处一致 → consistent，零 finding', async () => {
    mkProfile({ 'pkg-a': '1.0.0' }, lock([{ name: 'pkg-a', spec: '1.0.0', ver: '1.0.0' }]))
    mkInstalled('pkg-a', '1.0.0')
    const r = await checkAccount(profile)
    assert.equal(r.account.length, 1)
    assert.equal(r.account[0].consistent, true)
    assert.equal(r.findings.length, 0)
  })

  it('pin≠实装（023 §6.2 形态：pin 1.2.5 / 实装+lock 1.2.7）→ warning + hint 提 023', async () => {
    mkProfile({ 'pkg-b': '1.2.5' }, lock([{ name: 'pkg-b', spec: '1.2.5', ver: '1.2.7' }]))
    mkInstalled('pkg-b', '1.2.7')
    const r = await checkAccount(profile)
    assert.equal(r.account[0].consistent, false)
    assert.equal(r.account[0].installed, '1.2.7')
    assert.equal(r.account[0].lockfile, '1.2.7')
    assert.equal(r.findings.length, 1)
    assert.equal(r.findings[0].severity, 'warning')
    assert.equal(r.findings[0].check, 'account-reality')
    assert.ok(r.findings[0].hint.includes('023'))
  })

  it('range pin 按范围判定（^1.0.0 配实装 1.2.0）→ consistent', async () => {
    mkProfile({ 'pkg-c': '^1.0.0' }, lock([{ name: 'pkg-c', spec: '^1.0.0', ver: '1.2.0' }]))
    mkInstalled('pkg-c', '1.2.0')
    const r = await checkAccount(profile)
    assert.equal(r.account[0].consistent, true)
  })

  it('lock 无记录（unknown≠broken）→ lockfile=null 不计为不一致', async () => {
    mkProfile({ 'pkg-d': '1.0.0' }, lock([]))
    mkInstalled('pkg-d', '1.0.0')
    const r = await checkAccount(profile)
    assert.equal(r.account[0].lockfile, null)
    assert.equal(r.account[0].consistent, true)
  })

  it('pin 存在但实装缺失 → 不一致', async () => {
    mkProfile({ 'pkg-e': '1.0.0' }, lock([{ name: 'pkg-e', spec: '1.0.0', ver: '1.0.0' }]))
    const r = await checkAccount(profile)
    assert.equal(r.account[0].consistent, false)
    assert.equal(r.account[0].installed, null)
  })

  it('link: 依赖——pin 记原文、installed 取目标 package.json、lockfile 置 null', async () => {
    const target = join(home, 'linked-pkg')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'linked-pkg', version: '2.0.0' }))
    mkProfile({ 'pkg-f': `link:${target}` }, lock([]))
    mkdirSync(join(profile, 'node_modules'), { recursive: true })
    symlinkSync(target, join(profile, 'node_modules', 'pkg-f'))
    const r = await checkAccount(profile)
    assert.equal(r.account[0].pin, `link:${target}`)
    assert.equal(r.account[0].installed, '2.0.0')
    assert.equal(r.account[0].lockfile, null)
    assert.equal(r.account[0].consistent, true)
  })

  it('非 9.0 lockfile → 不猜（lockfile 全 null，不产生 finding）', async () => {
    mkProfile({ 'pkg-g': '1.0.0' }, "lockfileVersion: '6.0'\nimporters: {}\n")
    mkInstalled('pkg-g', '1.0.0')
    const r = await checkAccount(profile)
    assert.equal(r.account[0].lockfile, null)
    assert.equal(r.account[0].consistent, true)
    assert.equal(r.findings.length, 0)
  })

  it('lock version 带 peer 后缀（实机形态：0.9.28(@deepseek-ai/schemastery@3.18.4)）→ 剥后缀后一致，不误报', async () => {
    mkProfile(
      { 'pkg-h': '1.0.0' },
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      pkg-h:\n        specifier: 1.0.0\n        version: 1.0.0(@deepseek-ai/schemastery@3.18.4)\n",
    )
    mkInstalled('pkg-h', '1.0.0')
    const r = await checkAccount(profile)
    assert.equal(r.account[0].lockfile, '1.0.0')
    assert.equal(r.account[0].consistent, true)
    assert.equal(r.findings.length, 0)
  })
})

// ---------- Task 5：runDoctor 聚合 + dualMarket 信息级 ----------

describe('runDoctor', () => {
  let home, profile
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dshm-run-'))
    profile = join(home, 'profiles', 'web')
    mkdirSync(join(profile, 'node_modules'), { recursive: true })
    mkdirSync(join(home, 'node_modules', '@deepseek-ai'), { recursive: true })
    process.env.DSH_HOME = home
  })
  afterEach(() => {
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  })

  function buildFixture() {
    writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')
    // 农场：1 悬空 + 1 dsh stale + 1 健康
    symlinkSync(join(home, 'gone'), join(home, 'node_modules', '@deepseek-ai', 'dsh-x'))
    const staleTarget = join(home, 'store', '@deepseek-ai+dsh@0.1.7-rc.2_abc123ef', 'node_modules', '@deepseek-ai', 'dsh')
    mkdirSync(staleTarget, { recursive: true })
    symlinkSync(staleTarget, join(home, 'node_modules', '@deepseek-ai', 'dsh'))
    const okTarget = join(home, 'rt', '.pnpm', 'node_modules', '@deepseek-ai', 'dsh-tools')
    mkdirSync(okTarget, { recursive: true })
    writeFileSync(join(okTarget, 'package.json'), JSON.stringify({ version: '0.1.7-rc.2' }))
    symlinkSync(okTarget, join(home, 'node_modules', '@deepseek-ai', 'dsh-tools'))
    // 残留：1 个 bak
    writeFileSync(join(profile, 'package.json.bak-20260903'), '{}')
    // 账实：2 个依赖（含双市场）三处一致
    writeFileSync(
      join(profile, 'package.json'),
      JSON.stringify({ dependencies: { 'dsh-m': '0.9.28', dshmarket: '1.66.8' } }),
    )
    writeFileSync(
      join(profile, 'pnpm-lock.yaml'),
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      dsh-m:\n        specifier: 0.9.28\n        version: 0.9.28\n      dshmarket:\n        specifier: 1.66.8\n        version: 1.66.8\n",
    )
    for (const [n, v] of [['dsh-m', '0.9.28'], ['dshmarket', '1.66.8']]) {
      mkdirSync(join(profile, 'node_modules', n), { recursive: true })
      writeFileSync(join(profile, 'node_modules', n, 'package.json'), JSON.stringify({ name: n, version: v }))
    }
  }

  it('聚合：summary 计数与分项一致；runtimeVersion 透传；schema 信封', async () => {
    buildFixture()
    const r = await runDoctor(profile, '0.2.0-rc.2')
    assert.equal(r.schema, 'dsh-m/doctor/v1')
    assert.equal(r.layout, 'hoisted')
    assert.equal(r.runtimeVersion, '0.2.0-rc.2')
    assert.ok(r.scannedAt)
    assert.equal(r.summary.errors, 1) // 悬空
    assert.equal(r.summary.warnings, 0)
    assert.equal(r.summary.farmChecked, 3)
    assert.equal(r.summary.farmDangling, 1)
    assert.equal(r.summary.farmStale, 1)
    assert.equal(r.summary.residueCount, 1)
    assert.equal(r.summary.accountChecked, 2)
    assert.equal(r.summary.accountMismatched, 0)
    assert.ok(Array.isArray(r.summary.unknowns))
  })

  it('dualMarket：双市场并存命中（信息级，不产生 finding）', async () => {
    buildFixture()
    const r = await runDoctor(profile, null)
    assert.deepEqual(r.dualMarket, ['dsh-m', 'dshmarket'])
    assert.ok(!r.findings.some((f) => f.title.includes('dshmarket')))
  })

  it('dualMarket：无 dshmarket → null', async () => {
    buildFixture()
    const pkg = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    delete pkg.dependencies.dshmarket
    writeFileSync(join(profile, 'package.json'), JSON.stringify(pkg))
    rmSync(join(profile, 'node_modules', 'dshmarket'), { recursive: true, force: true })
    const r = await runDoctor(profile, null)
    assert.equal(r.dualMarket, null)
  })
})

// ---------- Task 7：CLI `dshm doctor`（DSH_HOME 机制 + exit code + HELP，评审 R1.6/R1.7） ----------

const CLI_JS = fileURLToPath(new URL('../lib/cli.js', import.meta.url))

function runCli(args, envHome) {
  return spawnSync(process.execPath, [CLI_JS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: envHome },
  })
}

describe('dshm doctor（CLI 子命令）', () => {
  let home, profile
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dshm-doccli-'))
    profile = join(home, 'profiles', 'web')
    mkdirSync(join(profile, 'node_modules'), { recursive: true })
    mkdirSync(join(home, 'node_modules', '@deepseek-ai'), { recursive: true })
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('--json 可解析；有 error（悬空）时 exit 1；stale 维度显示降级而非 0', async () => {
    symlinkSync(join(home, 'gone'), join(home, 'node_modules', '@deepseek-ai', 'dsh-x')) // 悬空 → error
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: {} }))
    const r = runCli(['doctor', '--json'], home)
    assert.equal(r.status, 1)
    const report = JSON.parse(r.stdout)
    assert.equal(report.schema, 'dsh-m/doctor/v1')
    assert.equal(report.summary.errors, 1)
    assert.equal(report.runtimeVersion, null) // CLI 通路：纯 FS 解析不可得，绝不 spawn
    assert.ok(report.summary.unknowns.some((u) => u.includes('stale')))
  })

  it('健康 profile → exit 0，人读输出含 summary 行；残留代表样例呈现且零告警（执行评审 E1.4）', async () => {
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: {} }))
    writeFileSync(join(profile, 'package.json.bak-20260903'), '{}') // 有残留但零告警
    const r = runCli(['doctor'], home)
    assert.equal(r.status, 0)
    assert.ok(r.stdout.includes('体检') || r.stdout.includes('doctor') || r.stdout.includes('农场'))
    assert.ok(r.stdout.includes('[bak-file]')) // 代表样例（kind 标签）
    assert.ok(r.stdout.includes('package.json.bak-20260903'))
    assert.ok(!r.stdout.includes('❌')) // 零告警：残留不产生 error/warning
    assert.ok(!r.stdout.includes('⚠️'))
  })

  it('--profile desktop 对 doctor 以外命令被拒绝（0.9.31 前本用例以 doctor 为样本，ADR-0011 后 doctor 为例外）', async () => {
    const r = runCli(['registry', '--profile', 'desktop'], home)
    assert.equal(r.status, 1)
    assert.ok(r.stderr.includes('desktop'))
  })

  it('HELP 命令枚举含 doctor 行（防 HELP 漂移，评审 R1.6）', async () => {
    const r = runCli([], home) // 无参 → help
    assert.equal(r.status, 0)
    assert.ok(r.stdout.includes('doctor'))
  })
})

// ---------- 0.9.31（ADR-0011）：doctor --profile desktop 例外开口 + 空目录提示 ----------

describe('dshm doctor --profile desktop', () => {
  let home
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dshm-docdesk-'))
    const desk = join(home, 'profiles', 'desktop')
    mkdirSync(join(desk, 'node_modules', 'some-pkg'), { recursive: true })
    writeFileSync(join(desk, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\n')
    writeFileSync(join(desk, 'package.json'), JSON.stringify({ dependencies: { 'some-pkg': '1.0.0' } }))
    writeFileSync(join(desk, 'node_modules', 'some-pkg', 'package.json'), JSON.stringify({ name: 'some-pkg', version: '1.0.0' }))
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('--profile desktop 路由到 desktop 目录，[desktop] 标注，真实扫描（物化布局 farm=0 属常态）', async () => {
    const r = runCli(['doctor', '--profile', 'desktop', '--json'], home)
    assert.equal(r.status, 0)
    const report = JSON.parse(r.stdout)
    assert.ok(report.profileDir.endsWith(join('profiles', 'desktop')))
    assert.equal(report.layout, 'hoisted')
    assert.equal(report.summary.accountChecked, 1)
    assert.equal(report.summary.farmChecked, 0)
    const h = runCli(['doctor', '--profile', 'desktop'], home)
    assert.ok(h.stdout.includes('[desktop]'), '人读输出应含 [desktop] 标注')
  })

  it('其他命令对 --profile desktop 的拒绝语义不变（回归钉子）', async () => {
    for (const argv of [['list'], ['outdated'], ['install', '--id', 'x', '--yes'], ['uninstall', '--pkg', 'x', '--yes']]) {
      const r = runCli([...argv, '--profile', 'desktop'], home)
      assert.equal(r.status, 1, `应拒绝：dshm ${argv.join(' ')} --profile desktop`)
      assert.ok(r.stderr.includes('desktop'))
    }
  })

  it('doctor --profile 非法值（非 web|desktop）仍拒绝', async () => {
    const r = runCli(['doctor', '--profile', 'foo'], home)
    assert.equal(r.status, 1)
    assert.ok(r.stderr.includes('foo'))
  })

  it('空目录提示：默认 doctor 扫不存在的 web 目录 → 提示加 --profile desktop', async () => {
    const emptyHome = mkdtempSync(join(tmpdir(), 'dshm-docempty-'))
    try {
      const r = runCli(['doctor'], emptyHome)
      assert.equal(r.status, 0)
      assert.ok(r.stdout.includes('--profile desktop'), '应输出 desktop 提示行')
    } finally {
      rmSync(emptyHome, { recursive: true, force: true })
    }
  })

  it('正常 web profile 不出空目录提示（回归钉子）', async () => {
    const web = join(home, 'profiles', 'web')
    mkdirSync(web, { recursive: true })
    writeFileSync(join(web, 'package.json'), JSON.stringify({ dependencies: {} }))
    const r = runCli(['doctor'], home)
    assert.equal(r.status, 0)
    assert.ok(!r.stdout.includes('--profile desktop'), '正常 profile 不应出 desktop 提示')
  })

  it('显式 --profile desktop 且目录缺失 → 提示不含「请加 --profile desktop」（评审 G5.2 文案矛盾修复）', async () => {
    const noDeskHome = mkdtempSync(join(tmpdir(), 'dshm-nodesk-'))
    try {
      const web = join(noDeskHome, 'profiles', 'web')
      mkdirSync(web, { recursive: true })
      writeFileSync(join(web, 'package.json'), JSON.stringify({ dependencies: {} }))
      const r = runCli(['doctor', '--profile', 'desktop'], noDeskHome)
      assert.equal(r.status, 0)
      assert.ok(r.stdout.includes('目标 profile 目录不存在'))
      assert.ok(!r.stdout.includes('请加 --profile desktop'), '显式 desktop 时不应再建议加 desktop')
    } finally {
      rmSync(noDeskHome, { recursive: true, force: true })
    }
  })

  it('显式 --profile web → 照常路由 web 目录（评审 G5.3 钉子）', async () => {
    const web = join(home, 'profiles', 'web')
    mkdirSync(web, { recursive: true })
    writeFileSync(join(web, 'package.json'), JSON.stringify({ dependencies: {} }))
    const r = runCli(['doctor', '--profile', 'web', '--json'], home)
    assert.equal(r.status, 0)
    const report = JSON.parse(r.stdout)
    assert.ok(report.profileDir.endsWith(join('profiles', 'web')))
    const h = runCli(['doctor', '--profile', 'web'], home)
    assert.ok(h.stdout.includes('[web]'))
  })
})
