/**
 * Doctor Day1（ADR-0010）Task 1：类型契约 + detectLayout 布局探测。
 * 运行：npm run build && node --test tests/doctor.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { detectLayout, analyzeFarm, listResidue } from '../lib/core/doctor.js'

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
