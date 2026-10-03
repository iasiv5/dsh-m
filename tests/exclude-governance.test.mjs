/**
 * ADR-0009：排除条目代管——纯函数（解析/治理合并/登记）与落盘封装（原子写+同款锁+fail-open）。
 * 机理基准：首条规则生效（pnpm evaluateVersionPolicy 每包名只认第一条，同名后续死亡）。
 * 运行：npm run build && node --test tests/exclude-governance.test.mjs
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  mergeExcludeRules,
  parseExcludeBlock,
  parseNpmSpec,
  registerExclusion,
  registerExclusionInYaml,
  governExcludeBlock,
} from '../lib/core/exclude-governance.js'
import { _resetReleaseAgeCachesForTests } from '../lib/core/release-age.js'

// 结构等价的脱敏样本（不拷贝生产 profile 文件）
const SAMPLE = [
  'packages:',
  '  - .',
  '',
  'nodeLinker: hoisted',
  'minimumReleaseAgeExclude:',
  '  - dsh-m@0.9.0 || 0.9.1',
  '  - dshmarket',
  "  - '@scope/pkg@1.0.0'",
  '  - dsh-m@0.9.18',
  '',
].join('\n')

const SAMPLE_CRLF = SAMPLE.replaceAll('\n', '\r\n')

describe('parseExcludeBlock', () => {
  it('本机真实形态（复合/包名级/scoped 引号/同名两条）→ ok，顺序与原始行保留', () => {
    const p = parseExcludeBlock(SAMPLE)
    assert.equal(p.kind, 'ok')
    if (p.kind !== 'ok') return
    assert.equal(p.entries.length, 4)
    assert.equal(p.entries[0].name, 'dsh-m')
    assert.deepEqual(p.entries[0].selectors, ['0.9.0', '0.9.1'])
    assert.equal(p.entries[1].name, 'dshmarket')
    assert.equal(p.entries[1].selectors, null)
    assert.equal(p.entries[2].name, '@scope/pkg')
    assert.equal(p.entries[2].quoted, true)
    assert.deepEqual(p.entries[2].selectors, ['1.0.0'])
    assert.equal(p.entries[3].name, 'dsh-m')
    assert.deepEqual(p.rawLines[3], '  - dsh-m@0.9.18')
    assert.equal(p.eol, '\n')
    assert.equal(p.indent, '  ')
  })
  it('CRLF 探测保留', () => {
    const p = parseExcludeBlock(SAMPLE_CRLF)
    assert.equal(p.kind, 'ok')
    if (p.kind !== 'ok') return
    assert.equal(p.eol, '\r\n')
  })
  it('块缺失 → absent；含 # 注释行 / 残缺条目 → unparseable', () => {
    assert.equal(parseExcludeBlock('packages:\n  - .\n').kind, 'absent')
    assert.equal(parseExcludeBlock('minimumReleaseAgeExclude:\n  - pkg@1.0.0 # 注释\n').kind, 'unparseable')
    assert.equal(parseExcludeBlock('minimumReleaseAgeExclude:\n  - pkg@\n').kind, 'unparseable')
  })
})

describe('mergeExcludeRules（治理：同名合并为版本并集复合，只修不建）', () => {
  it('同名两条 → 一条复合（并集、原顺序、其余行不动）', () => {
    const r = mergeExcludeRules(SAMPLE)
    assert.ok(r)
    assert.equal(r.changed, true)
    assert.deepEqual(r.mergedNames, ['dsh-m'])
    assert.ok(r.yaml.includes('  - dsh-m@0.9.0 || 0.9.1 || 0.9.18'))
    assert.ok(r.yaml.includes("  - '@scope/pkg@1.0.0'"))
    assert.ok(r.yaml.includes('  - dshmarket'))
    assert.equal(r.yaml.match(/dsh-m@/g)?.length, 1)
  })
  it('已规范单条 → changed=false', () => {
    const r = mergeExcludeRules('minimumReleaseAgeExclude:\n  - dshmarket\n')
    assert.ok(r)
    assert.equal(r.changed, false)
    assert.deepEqual(r.mergedNames, [])
  })
  it('包名级 + 同名精确 → 收敛为包名级单条', () => {
    const r = mergeExcludeRules('minimumReleaseAgeExclude:\n  - pkg\n  - pkg@1.0.0\n')
    assert.ok(r)
    assert.equal(r.changed, true)
    assert.ok(r.yaml.includes('  - pkg\n'))
  })
  it('块缺失 → changed=false（治理只修不建）', () => {
    const r = mergeExcludeRules('packages:\n  - .\n')
    assert.ok(r)
    assert.equal(r.changed, false)
  })
  it('scoped 合并输出带引号；CRLF 保留', () => {
    const r = mergeExcludeRules("minimumReleaseAgeExclude:\r\n  - '@s/p@1.0.0'\r\n  - '@s/p@2.0.0'\r\n")
    assert.ok(r)
    assert.equal(r.changed, true)
    assert.ok(r.yaml.includes("  - '@s/p@1.0.0 || 2.0.0'\r\n"))
  })
  it('含 # / 残缺条目 → null（弃写，fail-safe）', () => {
    assert.equal(mergeExcludeRules('minimumReleaseAgeExclude:\n  - pkg@1.0.0 # x\n'), null)
  })
})

describe('registerExclusionInYaml（登记：窗口内目标并入规范形态）', () => {
  it('既有复合含该版本 → noop', () => {
    const r = registerExclusionInYaml(SAMPLE, { pkg: 'dsh-m', version: '0.9.0' })
    assert.ok(r)
    assert.equal(r.changed, false)
    assert.equal(r.form, 'noop')
  })
  it('既有复合不含 → 追加选择器（merged），其它行不动（生产序：治理先行，输入为规范形态）', () => {
    const canonical = mergeExcludeRules(SAMPLE)
    assert.ok(canonical)
    const r = registerExclusionInYaml(canonical.yaml, { pkg: 'dsh-m', version: '0.9.23' })
    assert.ok(r)
    assert.equal(r.changed, true)
    assert.equal(r.form, 'merged')
    assert.ok(r.yaml.includes('  - dsh-m@0.9.0 || 0.9.1 || 0.9.18 || 0.9.23'))
    assert.ok(r.yaml.includes("  - '@scope/pkg@1.0.0'"))
  })
  it('非规范输入（同名两条）→ 按首条规则并入第一条，第二条保持原样（治理挂点负责合并）', () => {
    const r = registerExclusionInYaml(SAMPLE, { pkg: 'dsh-m', version: '0.9.23' })
    assert.ok(r)
    assert.equal(r.form, 'merged')
    assert.ok(r.yaml.includes('  - dsh-m@0.9.0 || 0.9.1 || 0.9.23'))
    assert.ok(r.yaml.includes('  - dsh-m@0.9.18'))
  })
  it('既有包名级 → noop（已覆盖全部版本）', () => {
    const r = registerExclusionInYaml('minimumReleaseAgeExclude:\n  - dshmarket\n', { pkg: 'dshmarket', version: '1.67.0' })
    assert.ok(r)
    assert.equal(r.changed, false)
  })
  it('scoped 精确同版本 → noop；异版本 → 复合化（保持引号）', () => {
    const same = registerExclusionInYaml(SAMPLE, { pkg: '@scope/pkg', version: '1.0.0' })
    assert.ok(same)
    assert.equal(same.changed, false)
    const diff = registerExclusionInYaml(SAMPLE, { pkg: '@scope/pkg', version: '2.0.0' })
    assert.ok(diff)
    assert.equal(diff.form, 'merged')
    assert.ok(diff.yaml.includes("  - '@scope/pkg@1.0.0 || 2.0.0'"))
  })
  it('无既有规则：scoped → 精确单条（引号）；非 scoped+异版 previousVersion → 双选择器复合', () => {
    const scoped = registerExclusionInYaml('minimumReleaseAgeExclude:\n  - dshmarket\n', { pkg: '@iasiv5/other', version: '0.1.0' })
    assert.ok(scoped)
    assert.equal(scoped.form, 'created-scoped-exact')
    assert.ok(scoped.yaml.includes("  - '@iasiv5/other@0.1.0'"))
    const composite = registerExclusionInYaml('minimumReleaseAgeExclude:\n  - dshmarket\n', { pkg: 'plain', version: '2.0.0', previousVersion: '1.9.0' })
    assert.ok(composite)
    assert.equal(composite.form, 'created-composite')
    assert.ok(composite.yaml.includes('  - plain@2.0.0 || 1.9.0'))
  })
  it('非 scoped 无 previous（或 prev===version）→ 精确单条', () => {
    const fresh = registerExclusionInYaml('minimumReleaseAgeExclude:\n  - dshmarket\n', { pkg: 'brand-new', version: '1.0.0' })
    assert.ok(fresh)
    assert.equal(fresh.form, 'created-exact')
    const same = registerExclusionInYaml('minimumReleaseAgeExclude:\n  - dshmarket\n', { pkg: 'brand-new', version: '1.0.0', previousVersion: '1.0.0' })
    assert.ok(same)
    assert.equal(same.form, 'created-exact')
  })
  it('块缺失 → 文件尾追加块', () => {
    const r = registerExclusionInYaml('packages:\n  - .\n', { pkg: 'pkg-a', version: '1.0.0' })
    assert.ok(r)
    assert.equal(r.changed, true)
    assert.ok(r.yaml.startsWith('packages:\n  - .\n'))
    assert.ok(r.yaml.includes('minimumReleaseAgeExclude:\n  - pkg-a@1.0.0\n'))
  })
  it('行内形式的键 / unparseable → null（不猜、不产生重复块）', () => {
    assert.equal(registerExclusionInYaml('minimumReleaseAgeExclude: []\n', { pkg: 'a', version: '1.0.0' }), null)
    assert.equal(registerExclusionInYaml('minimumReleaseAgeExclude:\n  - pkg@1.0.0 # x\n', { pkg: 'a', version: '1.0.0' }), null)
  })
})

describe('parseNpmSpec', () => {
  it('npm 精确 spec → {pkg, version}（含 scoped 与引号形态）', () => {
    assert.deepEqual(parseNpmSpec('pkg-a@1.2.3'), { pkg: 'pkg-a', version: '1.2.3' })
    assert.deepEqual(parseNpmSpec('@scope/pkg-a@1.2.3'), { pkg: '@scope/pkg-a', version: '1.2.3' })
  })
  it('github:/含冒号/裸名/range → null', () => {
    assert.equal(parseNpmSpec('github:owner/repo#abcd'), null)
    assert.equal(parseNpmSpec('pkg-a'), null)
    assert.equal(parseNpmSpec('pkg-a@^1.2.0'), null)
    assert.equal(parseNpmSpec('pkg-a@latest'), null)
  })
})

// ---------- 落盘封装（T4） ----------

function makeProfileDir(yaml) {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-excl-'))
  if (yaml !== undefined) writeFileSync(join(dir, 'pnpm-workspace.yaml'), yaml)
  return dir
}

describe('governExcludeBlock（落盘治理：原子写 + 同款锁 + fail-open）', () => {
  beforeEach(_resetReleaseAgeCachesForTests)

  it('同名两条 → 原子写合并，文件落为规范形态', async () => {
    const dir = makeProfileDir(SAMPLE)
    const r = await governExcludeBlock(dir)
    assert.equal(r.ok, true)
    assert.equal(r.changed, true)
    assert.deepEqual(r.mergedNames, ['dsh-m'])
    const after = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')
    assert.ok(after.includes('  - dsh-m@0.9.0 || 0.9.1 || 0.9.18'))
    assert.ok(after.includes('nodeLinker: hoisted'))
  })
  it('文件缺席 → { ok:false, no-file }；块缺失 → no-block；# → unparseable', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'dshm-excl-'))
    assert.deepEqual(await governExcludeBlock(empty), { ok: false, changed: false, reason: 'no-file' })
    const noBlock = makeProfileDir('packages:\n  - .\n')
    assert.equal((await governExcludeBlock(noBlock)).reason, 'no-block')
    const dirty = makeProfileDir('minimumReleaseAgeExclude:\n  - pkg@1.0.0 # x\n')
    assert.equal((await governExcludeBlock(dirty)).reason, 'unparseable')
  })
  it('profileDir 缺席 → no-dir 不抛；writeFile 注入抛错 → write-failed 且文件不动', async () => {
    assert.equal((await governExcludeBlock('')).reason, 'no-dir')
    const dir = makeProfileDir(SAMPLE)
    let calls = 0
    const r = await governExcludeBlock(dir, { writeFile: async () => { calls += 1; throw new Error('disk full') } })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'write-failed')
    assert.equal(calls, 1)
    assert.ok(existsSync(join(dir, 'pnpm-workspace.yaml')))
    assert.ok(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8').includes('  - dsh-m@0.9.18'))
  })
  it('注入 writeFile 收到完整新文本（恰好一次）', async () => {
    const dir = makeProfileDir(SAMPLE)
    const seen = []
    await governExcludeBlock(dir, { writeFile: async (p, text) => { seen.push(text) } })
    assert.equal(seen.length, 1)
    assert.ok(seen[0].includes('  - dsh-m@0.9.0 || 0.9.1 || 0.9.18'))
  })
  it('留痕纪律：返回 record 不含 yaml 全文', async () => {
    const dir = makeProfileDir(SAMPLE)
    const r = await governExcludeBlock(dir)
    assert.ok(!JSON.stringify(r).includes('nodeLinker'))
  })
})

describe('registerExclusion（落盘登记：young 判定内聚 + fail-open）', () => {
  beforeEach(_resetReleaseAgeCachesForTests)
  const MIN = 60_000
  const isoAgo = (ms, now) => new Date(now - ms).toISOString()
  const NOW = Date.parse('2026-10-03T12:00:00.000Z')

  it('young（11min 龄）→ applied + 文件并入；返回 record 无 yaml 全文', async () => {
    const dir = makeProfileDir(SAMPLE)
    const r = await registerExclusion(
      dir,
      { pkg: '@scope/pkg', version: '2.0.0' },
      { packumentTimes: async () => ({ '2.0.0': isoAgo(11 * MIN, NOW) }), nowMs: NOW },
    )
    assert.equal(r.applied, true)
    assert.equal(r.form, 'merged')
    assert.ok(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8').includes("  - '@scope/pkg@1.0.0 || 2.0.0'"))
    assert.ok(!JSON.stringify(r).includes('nodeLinker'))
  })
  it('非 young（25h 龄）/ 时刻不可得 → not-young 且文件不动', async () => {
    const dir = makeProfileDir(SAMPLE)
    const old = await registerExclusion(dir, { pkg: '@scope/pkg', version: '2.0.0' }, { packumentTimes: async () => ({ '2.0.0': isoAgo(25 * 60 * MIN, NOW) }), nowMs: NOW })
    assert.deepEqual(old, { applied: false, reason: 'not-young' })
    const noTimes = await registerExclusion(dir, { pkg: '@scope/pkg', version: '2.0.0' }, { packumentTimes: async () => null, nowMs: NOW })
    assert.deepEqual(noTimes, { applied: false, reason: 'not-young' })
    assert.ok(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8').includes("  - '@scope/pkg@1.0.0'"))
  })
  it('显式 minimumReleaseAge 窗口生效：60min 窗口下 30min 龄 applied、90min 龄 not-young', async () => {
    const tight = makeProfileDir('minimumReleaseAge: 60\nminimumReleaseAgeExclude:\n  - dshmarket\n')
    const young = await registerExclusion(tight, { pkg: 'pkg-a', version: '1.0.0' }, { packumentTimes: async () => ({ '1.0.0': isoAgo(30 * MIN, NOW) }), nowMs: NOW })
    assert.equal(young.applied, true)
    const loose = makeProfileDir('minimumReleaseAge: 60\nminimumReleaseAgeExclude:\n  - dshmarket\n')
    const aged = await registerExclusion(loose, { pkg: 'pkg-a', version: '1.0.0' }, { packumentTimes: async () => ({ '1.0.0': isoAgo(90 * MIN, NOW) }), nowMs: NOW })
    assert.equal(aged.applied, false)
  })
  it('文件缺席 → no-file 不建文件；profileDir 缺席 → no-dir', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'dshm-excl-'))
    const noFile = await registerExclusion(empty, { pkg: 'a', version: '1.0.0' }, { packumentTimes: async () => ({ '1.0.0': isoAgo(MIN, NOW) }), nowMs: NOW })
    assert.equal(noFile.reason, 'no-file')
    assert.equal(existsSync(join(empty, 'pnpm-workspace.yaml')), false)
    const noDir = await registerExclusion('', { pkg: 'a', version: '1.0.0' }, { packumentTimes: async () => ({ '1.0.0': isoAgo(MIN, NOW) }), nowMs: NOW })
    assert.equal(noDir.reason, 'no-dir')
  })
})
