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

  it('等价性：规范锁上 A 形无约束捕获 ≡ C 形前缀约束捕获（决议 5；A 探针快照自 market-mutation.ts:296）', () => {
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
