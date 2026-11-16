// 锁档观测 · packages 面表驱动套件（ADR-0037 T1；从构建产物引入——跑前先 npm run build）
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseLockfile } from '../lib/core/lockfile.js'
import {
  caseRegistryKey,
  caseScopedQuoted,
  caseDoubleQuoted,
  caseNodeModulesPrefixV6,
  casePeerSuffix,
  caseIntegrityPrefixConstraint,
  caseEquivalence,
  caseCommitField,
  caseGitHttpsKey,
  caseGitTarballUrlKey,
  caseDupKeys,
  caseNestedColonLines,
  caseSnapshotsSection,
  caseSimNames,
  caseNoVersionLine,
  caseNoPackages,
  caseUnquotedVersion,
  caseImportersVersions,
  caseBadYaml,
} from './fixtures/lockfile-cases.mjs'

describe('锁档观测 · packages 面（ADR-0037 T1）', () => {
  it('registry 引号键：integrity 观测', () => {
    assert.deepEqual(parseLockfile(caseRegistryKey).observationOf('pkg-a'), { integrity: 'sha512-aaa' })
  })

  it('scoped 引号键观测（A 0.5.1 修复语义延续）', () => {
    assert.deepEqual(parseLockfile(caseScopedQuoted).observationOf('@scope/pkg'), { integrity: 'sha512-sss' })
  })

  it('双引号键现在可观测（包络①：并集归一）', () => {
    const obs = parseLockfile(caseDoubleQuoted).observationOf('pkg-b')
    assert.equal(obs?.version, '1.0.0')
    assert.equal(obs?.integrity, 'sha512-bbb')
  })

  it('node_modules/ 前缀键（v6 形态）并集容忍', () => {
    assert.deepEqual(parseLockfile(caseNodeModulesPrefixV6).observationOf('pkg-c'), { integrity: 'sha512-ccc' })
  })

  it('version 归一：剥引号 + 全部尾部括号组（B1/doctor 权威）', () => {
    assert.equal(parseLockfile(casePeerSuffix).observationOf('pkg-d')?.version, '4.5.6')
  })

  it('integrity 前缀约束：notintegrity 不捕获；无证据字段 → observationOf null（A:305 同语义）', () => {
    const v = parseLockfile(caseIntegrityPrefixConstraint)
    assert.equal(v.observationOf('pkg-i'), null)
    assert.deepEqual(v.anomalies.duplicateKeys, [])
  })

  it('等价性：规范锁上 A 形无约束捕获 ≡ C 形前缀约束捕获（决议 5；A 探针快照自 market-mutation 旧 integrity 正则形态，见夹具注）', () => {
    const aForm = /integrity:\s*([^,}\s'"]+)/.exec(caseEquivalence.body)?.[1]
    const cForm = parseLockfile(caseEquivalence.lock).observationOf('pkg-x')?.integrity
    assert.equal(cForm, aForm)
    assert.equal(cForm, 'sha512-eqq')
  })

  it('commit 三级·第一级：体内 commit: 压过键内/tarball hex（A ??-链序）', () => {
    assert.equal(
      parseLockfile(caseCommitField).observationOf('pkg-h')?.commit,
      '1111111111111111111111111111111111111111',
    )
  })

  it('commit 三级·第二级：键内 40-hex（体无 commit 字段、tarball 无 hex）', () => {
    assert.equal(
      parseLockfile(caseGitHttpsKey).observationOf('pkg-g')?.commit,
      'eeee222222222222222222222222222222222222',
    )
  })

  it('commit 三级·第三级：tarball URL 内 40-hex（键无 hex、体无 commit 字段）', () => {
    assert.equal(
      parseLockfile(caseGitTarballUrlKey).observationOf('pkg-f')?.commit,
      'dddd333333333333333333333333333333333333',
    )
  })

  it('observationOf 文件序首条目胜 + 重复键 anomalies 透出', () => {
    const v = parseLockfile(caseDupKeys)
    assert.equal(v.observationOf('pkg-dup')?.integrity, 'sha512-111')
    assert.deepEqual(v.anomalies.duplicateKeys, ['pkg-dup@1.0.0'])
  })

  it('嵌套冒号行：入 body 不入键、不截断、anomalies 空（R2-1）', () => {
    const v = parseLockfile(caseNestedColonLines)
    assert.equal(v.observationOf('pkg-n')?.version, '1.0.0')
    assert.equal(v.observationOf('pkg-n')?.integrity, 'sha512-nnn')
    assert.equal(v.observationOf('peerDependencies'), null)
    assert.equal(v.observationOf('pkg-n2')?.integrity, 'sha512-n2n')
    assert.deepEqual(v.anomalies.duplicateKeys, [])
  })

  it('顶格 snapshots: 段键不入 packages 观测（D1 段终止承重墙）', () => {
    const v = parseLockfile(caseSnapshotsSection)
    assert.equal(v.observationOf('@antfu/install-pkg'), null)
    assert.equal(v.observationOf('real')?.integrity, 'sha512-rrr')
  })

  it('candidatesOf：精确 + peer 后缀候选；observationOf 相似包名不误匹配', () => {
    const v = parseLockfile(caseSimNames)
    assert.equal(v.candidatesOf('pkg', '1.2.3').length, 1)
    assert.equal(v.candidatesOf('pkg', '1.2.3')[0]?.integrity, 'sha512-111')
    assert.equal(v.observationOf('pkg')?.integrity, 'sha512-111')
    assert.equal(v.observationOf('pkg-a')?.integrity, 'sha512-222')
    const p = parseLockfile(casePeerSuffix)
    assert.equal(p.candidatesOf('pkg-d', '4.5.6').length, 1)
    assert.deepEqual(p.candidatesOf('pkg-missing', '1.0.0'), [])
  })

  it('lockfileVersion 观测：引号/无引号/缺失行 → null（只观测不做门）', () => {
    assert.equal(parseLockfile(caseRegistryKey).lockfileVersion, '9.0')
    assert.equal(parseLockfile(caseUnquotedVersion).lockfileVersion, '9.0')
    assert.equal(parseLockfile(caseNoVersionLine).lockfileVersion, null)
  })

  it('无 packages: 段：观测 null、anomalies 空', () => {
    const v = parseLockfile(caseNoPackages)
    assert.equal(v.observationOf('pkg-a'), null)
    assert.deepEqual(v.anomalies.duplicateKeys, [])
  })
})

// T2：overrides 面——期望值与 tests/rollback-heal.test.mjs overrides describe 现值逐字对齐（B9 冻结语义）
describe('锁档观测 · overrides 面（ADR-0037 T2）', () => {
  it('引号 scoped 键与无引号键混排（rollback-heal :373 现值）', () => {
    const v = parseLockfile(`lockfileVersion: '9.0'

overrides:
  '@deepseek-ai/dsh-credentials-local': 0.1.1-rc.2
  isarray: 2.0.0
  'nested@1>child': 3.0.0

importers:
`)
    assert.deepEqual(v.overrides, {
      '@deepseek-ai/dsh-credentials-local': '0.1.1-rc.2',
      isarray: '2.0.0',
      'nested@1>child': '3.0.0',
    })
  })

  it('双引号键（三引号形态齐备）', () => {
    const v = parseLockfile(`lockfileVersion: '9.0'

overrides:
  "quoted-double@1": 2.0.0
`)
    assert.deepEqual(v.overrides, { 'quoted-double@1': '2.0.0' })
  })

  it('首条解析失败即停：保留此前已解析条目（宁可少配，不可错配）', () => {
    const v = parseLockfile(`lockfileVersion: '9.0'

overrides:
  good-one: 1.0.0
  malformed line without colon
  good-two: 2.0.0
`)
    assert.deepEqual(v.overrides, { 'good-one': '1.0.0' })
  })

  it('无 overrides 区块 → {}；空区块 → {}（rollback-heal :389/:390 现值）', () => {
    assert.deepEqual(parseLockfile("lockfileVersion: '9.0'\npackages:\n").overrides, {})
    assert.deepEqual(parseLockfile("lockfileVersion: '9.0'\noverrides:\nimporters:\n").overrides, {})
  })
})

// T3：importers 面——doctor readLockImporters 的 yaml 解析语义（门除外，门留 doctor T7）
describe('锁档观测 · importers 面（ADR-0037 T3）', () => {
  it('9.0 形状解析：importers.\'.\'.dependencies 版本观测（caseNoPackages 复用）', () => {
    const map = parseLockfile(caseNoPackages).importersRootDependencies()
    assert.ok(map instanceof Map)
    assert.deepEqual(map, new Map([['pkg-a', '1.2.3']]))
  })

  it('version 归一：多组 peer 后缀剥净；link: 依赖无 version 落空', () => {
    const map = parseLockfile(caseImportersVersions).importersRootDependencies()
    assert.deepEqual(map, new Map([['@deepseek-ai/dsh-client-ui', '0.9.28']]))
  })

  it('yaml 硬错误（重复映射键）→ null（fail-open-null，不猜）', () => {
    assert.equal(parseLockfile(caseBadYaml).importersRootDependencies(), null)
  })

  it('无 importers → 空 Map（非 null）', () => {
    const map = parseLockfile(caseRegistryKey).importersRootDependencies()
    assert.ok(map instanceof Map)
    assert.equal(map.size, 0)
  })

  it('惰性 memoized：同一 view 二次调用返回同引用', () => {
    const v = parseLockfile(caseNoPackages)
    assert.equal(v.importersRootDependencies(), v.importersRootDependencies())
  })
})
