/**
 * 2026-09-05 dshm_upgrade 回滚缺陷回归（移交文档验收标准 1/2/3）：
 * 1. 必然失败的升级后 profile package.json 字节级等于升级前（含 pnpm.overrides 等未知键）；
 * 2. 回滚后的 pnpm install --frozen-lockfile 通过（frozen CONFIG_MISMATCH 走自愈阶梯）；
 * 3. registry packument 滞后（ERR_PNPM_NO_MATCHING_VERSION）在重试窗口内自愈；
 * 另覆盖：B1 成功路径 manifest 顶层键找回、B2 no-frozen 重建降级、人工修复兜底保留。
 * 运行：npm run build && node --test tests/rollback-heal.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installFromRegistry } from '../lib/core/market.js'
import { readPnpmLockOverrides } from '../lib/core/npm-integrity.js'
import { classifyPnpmError } from '../lib/core/dsh-cli.js'
import { TransactionError } from '../lib/core/profile-transaction.js'
import { CONFIG_MISMATCH_TEXT, NO_MATCHING_TEXT } from './fixtures/pnpm-errors.mjs'

const sha512 = (tag) => `sha512-${tag}${'A'.repeat(20)}`
const OVERRIDE = { '@deepseek-ai/dsh-credentials-local': '0.1.1-rc.2' }

/** 带 overrides 区块的 pnpm lockfile v9 fixture（键与线上事故同形）。 */
function lockFile({ pkg, version, integrity, overrides = OVERRIDE }) {
  const overrideLines = Object.entries(overrides).map(([k, v]) => `  '${k}': ${v}`).join('\n')
  return `lockfileVersion: '9.0'

overrides:
${overrideLines}

importers:
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

const CONFIG_MISMATCH = CONFIG_MISMATCH_TEXT
const NO_MATCHING = NO_MATCHING_TEXT

const entry = { id: 'p', name: 'P', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'pkg-a' }

// ---------- Task 9 迁移：legacy 注入槽位 → transaction 注入 ----------

const outcomeOf = (err) => {
  const text = err instanceof Error ? err.message : String(err)
  return { ...classifyPnpmError(text), output: text }
}
const wrapAdd = (fake) => async () => {
  try {
    const r = await fake()
    return { class: 'ok', output: r.output, usedAllowAllBuilds: r.usedAllowAllBuilds === true }
  } catch (err) {
    return outcomeOf(err)
  }
}
const wrapInstall = (fake) => async () => {
  try {
    await fake()
    return { class: 'ok', output: 'install ok' }
  } catch (err) {
    return outcomeOf(err)
  }
}
/** Task 11：散文正则迁 code 的共用断言器（断言数不少于迁移前）。 */
const txFailure = (checks) => (err) => {
  assert.ok(err instanceof TransactionError, `应抛 TransactionError（实际 ${err?.constructor?.name}: ${err?.message}）`)
  for (const [label, fn] of Object.entries(checks)) {
    assert.ok(fn(err.result), `${label}：${JSON.stringify({ status: err.result.status, failure: err.result.failure, heals: err.result.healActions?.map((h) => h.code) })}`)
  }
  return true
}
const healCodes = (r) => r.healActions.map((h) => h.code)

describe('rollback-heal：升级失败回滚与 frozen 自愈', () => {
  let profile = ''
  beforeEach(() => {
    profile = mkdtempSync(join(tmpdir(), 'dshm-heal-'))
  })
  afterEach(() => {
    rmSync(profile, { recursive: true, force: true })
  })

  const manifestPath = () => join(profile, 'package.json')
  const lockPath = () => join(profile, 'pnpm-lock.yaml')

  /**
   * 事务注入构造（真实 profile 防护断言：profileDir 必须在 tmpdir 下）。
   * 默认 frozen/rebuild 成功、remove 失败（对应旧默认：真实 dsh 移除未安装包必失败）。
   */
  function baseDeps(overrides = {}) {
    assert.ok(profile.startsWith(tmpdir()), 'transaction.profileDir 必须位于 os.tmpdir() 下（不触碰真实 web profile）')
    return {
      loadRegistry: async () => ({
        configuredAddress: '', activeAddress: null, source: 'default-raw', status: 'ready',
        isDefault: true, stale: false, fetchedAt: null, errors: [], count: 1,
        registry: { version: 1, plugins: [entry] },
      }),
      npmLatest: async () => ({ version: '1.2.3', integrity: sha512('good') }),
      transaction: {
        profileDir: profile,
        retryDelaysMs: [0, 0],
        runner: () => ({
          add: wrapAdd(async () => { throw new Error(NO_MATCHING) }),
          remove: async () => outcomeOf(new Error('命令失败 (exit 1): 移除 pkg-a 失败（未安装）')),
          frozenInstall: wrapInstall(async () => undefined),
          rebuildInstall: wrapInstall(async () => undefined),
          ...overrides.runnerOps,
        }),
        ...overrides.transaction,
      },
    }
  }

  it('验收1：必然失败的升级后，package.json/pnpm-lock.yaml 字节级等于升级前（含 pnpm.overrides）', async () => {
    // 无尾换行的原始字节 + pnpm 键：字节级断言更严格
    const originalManifest = JSON.stringify({
      name: 'scratch-profile',
      private: true,
      pnpm: { overrides: OVERRIDE },
      dependencies: { existing: '^1.0.0' },
    }, null, 2)
    const originalLock = lockFile({ pkg: 'existing', version: '1.0.0', integrity: sha512('old') })
    const originalWorkspace = 'packages:\n  - .\n'
    writeFileSync(manifestPath(), originalManifest)
    writeFileSync(lockPath(), originalLock)
    writeFileSync(join(profile, 'pnpm-workspace.yaml'), originalWorkspace)
    // 模拟安装链破坏性写入：丢 pnpm 键 + lockfile 换成错误 integrity（必然 fail closed）
    const fakeAdd = async () => {
      writeFileSync(manifestPath(), JSON.stringify({ name: 'scratch-profile', private: true, dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }, null, 2) + '\n')
      writeFileSync(lockPath(), lockFile({ pkg: 'pkg-a', version: '1.2.3', integrity: sha512('EVIL') }))
      return { output: 'ok', usedAllowAllBuilds: false }
    }
    await assert.rejects(
      () => installFromRegistry('p', {}, {}, baseDeps({ runnerOps: { add: wrapAdd(fakeAdd) } })),
      txFailure({
        '回滚完成 rolled-back': (r) => r.status === 'rolled-back',
        'integrity 校验失败': (r) => r.failure.code === 'LOCK_INTEGRITY_MISMATCH',
        '字节还原已验证': (r) => r.snapshotRestoreVerified === true,
        '终态一致（非人工修复）': (r) => r.profileConverged === true && r.status !== 'manual-repair',
      }),
    )
    assert.equal(readFileSync(manifestPath(), 'utf8'), originalManifest, 'manifest 字节级还原（含 pnpm.overrides 与无尾换行）')
    assert.equal(readFileSync(lockPath(), 'utf8'), originalLock, 'lockfile 字节级还原')
    assert.equal(readFileSync(join(profile, 'pnpm-workspace.yaml'), 'utf8'), originalWorkspace, 'workspace yaml 原样')
  })

  it('验收2：回滚后 frozen 报 overrides 失配 → 从 lockfile 还原 overrides → frozen 复验通过', async () => {
    // 事故前态：manifest 无 pnpm 键，lockfile 记录着一条 override
    const originalManifest = JSON.stringify({ name: 'scratch-profile', private: true, dependencies: { existing: '^1.0.0' } }, null, 2) + '\n'
    writeFileSync(manifestPath(), originalManifest)
    writeFileSync(lockPath(), lockFile({ pkg: 'existing', version: '1.0.0', integrity: sha512('old') }))
    let frozenCalls = 0
    const restoreInstall = async () => {
      frozenCalls += 1
      if (frozenCalls === 1) throw new Error(CONFIG_MISMATCH)
      // 第二次调用前自愈必须已完成：manifest.pnpm.overrides 与 lockfile 一致
      const doc = JSON.parse(readFileSync(manifestPath(), 'utf8'))
      assert.deepEqual(doc.pnpm?.overrides, OVERRIDE, '自愈写入了与 lockfile 一致的 overrides')
      assert.equal(doc.dependencies.existing, '^1.0.0', '自愈不动 dependencies')
    }
    const fakeAdd = async () => { throw new Error(NO_MATCHING) }
    await assert.rejects(
      () => installFromRegistry('p', {}, {}, baseDeps({ runnerOps: { add: wrapAdd(fakeAdd), frozenInstall: wrapInstall(restoreInstall) } })),
      txFailure({
        '安装失败（rolled-back）': (r) => r.status === 'rolled-back',
        'B3 重试耗尽': (r) => r.failure.code === 'ADD_RETRY_EXHAUSTED',
        'overrides 还原进 manifest': (r) => healCodes(r).includes('B2_OVERRIDES_ALIGNED'),
        'frozen 复验通过': (r) => healCodes(r).includes('B2_FROZEN_REVERIFY_OK'),
        '非人工修复': (r) => r.status !== 'manual-repair',
      }),
    )
    assert.equal(frozenCalls, 2, 'frozen 复验跑了一次')
    const finalDoc = JSON.parse(readFileSync(manifestPath(), 'utf8'))
    assert.deepEqual(finalDoc.pnpm?.overrides, OVERRIDE)
  })

  it('B2：overrides 对齐后 frozen 仍失配 → 降级 --no-frozen-lockfile 重建并明确告知', async () => {
    writeFileSync(manifestPath(), JSON.stringify({ name: 'scratch-profile', private: true, dependencies: { existing: '^1.0.0' } }, null, 2) + '\n')
    writeFileSync(lockPath(), lockFile({ pkg: 'existing', version: '1.0.0', integrity: sha512('old') }))
    let rebuildCalls = 0
    const rebuildInstall = async () => {
      rebuildCalls += 1
    }
    const fakeAdd = async () => { throw new Error(NO_MATCHING) }
    await assert.rejects(
      () => installFromRegistry('p', {}, {}, baseDeps({
        runnerOps: {
          add: wrapAdd(fakeAdd),
          frozenInstall: wrapInstall(async () => { throw new Error(CONFIG_MISMATCH) }),
          rebuildInstall: wrapInstall(rebuildInstall),
        },
      })),
      txFailure({
        '回滚完成 rolled-back': (r) => r.status === 'rolled-back',
        'lockfile 已重建': (r) => healCodes(r).includes('B2_LOCKFILE_REBUILT'),
        '非人工修复': (r) => r.status !== 'manual-repair',
      }),
    )
    assert.equal(rebuildCalls, 1, '重建只执行一次')
    assert.deepEqual(JSON.parse(readFileSync(manifestPath(), 'utf8'))?.pnpm?.overrides, OVERRIDE, '重建前 overrides 已对齐进 manifest')
  })

  it('B2 扩展：回滚后 frozen 报 OUTDATED_LOCKFILE（specifier 漂移）→ 同样降级重建', async () => {
    writeFileSync(manifestPath(), JSON.stringify({ dependencies: { existing: '^1.0.0' } }))
    writeFileSync(lockPath(), lockFile({ pkg: 'existing', version: '1.0.0', integrity: sha512('old') }))
    let rebuildCalls = 0
    const rebuildInstall = async () => { rebuildCalls += 1 }
    const fakeAdd = async () => { throw new Error(NO_MATCHING) }
    await assert.rejects(
      () => installFromRegistry('p', {}, {}, baseDeps({
        runnerOps: {
          add: wrapAdd(fakeAdd),
          frozenInstall: wrapInstall(async () => { throw new Error('命令失败 (exit 1): ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with <ROOT>/package.json') }),
          rebuildInstall: wrapInstall(rebuildInstall),
        },
      })),
      txFailure({
        '回滚完成 rolled-back': (r) => r.status === 'rolled-back',
        'lockfile 已重建': (r) => healCodes(r).includes('B2_LOCKFILE_REBUILT'),
        '非人工修复': (r) => r.status !== 'manual-repair',
      }),
    )
    assert.equal(rebuildCalls, 1)
  })

  it('B2 兜底：frozen 与重建全部失败 → 仍报告「可能需要人工修复」并列出两类错误', async () => {
    writeFileSync(manifestPath(), JSON.stringify({ dependencies: { existing: '^1.0.0' } }))
    writeFileSync(lockPath(), lockFile({ pkg: 'existing', version: '1.0.0', integrity: sha512('old') }))
    const fakeAdd = async () => { throw new Error(NO_MATCHING) }
    await assert.rejects(
      () => installFromRegistry('p', {}, {}, baseDeps({
        runnerOps: {
          add: wrapAdd(fakeAdd),
          frozenInstall: wrapInstall(async () => { throw new Error(CONFIG_MISMATCH) }),
          rebuildInstall: wrapInstall(async () => { throw new Error('重建也炸了') }),
        },
      })),
      txFailure({
        '人工修复态': (r) => r.status === 'manual-repair',
        '重建错误在案': (r) => r.failure.note.includes('重建也炸了'),
        'frozen 失败文本（CONFIG_MISMATCH）在案': (r) => r.failure.note.includes('CONFIG_MISMATCH'),
        '原始失败码保留': (r) => r.failure.code === 'ADD_RETRY_EXHAUSTED',
      }),
    )
  })

  it('验收3：ERR_PNPM_NO_MATCHING_VERSION 在退避重试窗口内自愈（packument 预热）', async () => {
    const originalManifest = JSON.stringify({ dependencies: { existing: '^1.0.0' } })
    writeFileSync(manifestPath(), originalManifest)
    writeFileSync(lockPath(), lockFile({ pkg: 'existing', version: '1.0.0', integrity: sha512('old') }))
    let addCalls = 0
    const packumentCalls = []
    let restoreInstallCalls = 0
    const fakeAdd = async () => {
      addCalls += 1
      if (addCalls < 3) throw new Error(NO_MATCHING)
      // 成功写入：保留 pnpm 键 + 一致 lock（好 integrity）
      writeFileSync(manifestPath(), JSON.stringify({ name: 'scratch-profile', private: true, pnpm: { overrides: OVERRIDE }, dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }, null, 2) + '\n')
      writeFileSync(lockPath(), lockFile({ pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') }))
      return { output: 'ok', usedAllowAllBuilds: false }
    }
    const res = await installFromRegistry('p', {}, {}, baseDeps({
      runnerOps: {
        add: wrapAdd(fakeAdd),
        frozenInstall: wrapInstall(async () => { restoreInstallCalls += 1 }),
      },
      transaction: {
        warmPackument: async (pkg) => {
          packumentCalls.push(pkg)
        },
      },
    }))
    assert.equal(res.version, '1.2.3')
    assert.equal(addCalls, 3, '共尝试 3 次')
    assert.equal(packumentCalls.length, 2, '每次重试前预热一次 packument')
    assert.equal(packumentCalls[0], 'pkg-a')
    assert.equal(restoreInstallCalls, 0, '成功且无键丢失时不触发 frozen 复验')
    // 失败的尝试不得污染 manifest/lock（最终状态即成功安装态）
    assert.deepEqual(JSON.parse(readFileSync(manifestPath(), 'utf8'))?.pnpm?.overrides, OVERRIDE)
  })

  it('验收3兜底：重试耗尽仍 NO_MATCHING_VERSION → 原样报错且回滚干净', async () => {
    const originalManifest = JSON.stringify({ dependencies: { existing: '^1.0.0' } })
    writeFileSync(manifestPath(), originalManifest)
    writeFileSync(lockPath(), lockFile({ pkg: 'existing', version: '1.0.0', integrity: sha512('old') }))
    let addCalls = 0
    const fakeAdd = async () => {
      addCalls += 1
      throw new Error(NO_MATCHING)
    }
    let restoreInstallCalls = 0
    await assert.rejects(
      () => installFromRegistry('p', {}, {}, baseDeps({
        runnerOps: {
          add: wrapAdd(fakeAdd),
          frozenInstall: wrapInstall(async () => { restoreInstallCalls += 1 }),
        },
      })),
      txFailure({
        '回滚完成 rolled-back': (r) => r.status === 'rolled-back',
        'NO_MATCHING 原文在案': (r) => r.failure.note.includes('ERR_PNPM_NO_MATCHING_VERSION'),
        '重试耗尽': (r) => r.failure.code === 'ADD_RETRY_EXHAUSTED',
        '非人工修复': (r) => r.status !== 'manual-repair',
      }),
    )
    assert.equal(addCalls, 3, '默认重试 2 次（共 3 次）')
    assert.equal(restoreInstallCalls, 1, '回滚走了一次 frozen 校验')
    assert.equal(readFileSync(manifestPath(), 'utf8'), originalManifest, 'manifest 原样')
  })

  it('B1（成功路径）：安装链丢失 manifest 顶层键（pnpm.overrides）→ 从快照找回并 frozen 复验', async () => {
    const originalManifest = JSON.stringify({
      name: 'scratch-profile',
      private: true,
      pnpm: { overrides: OVERRIDE },
      dependencies: { existing: '^1.0.0' },
    }, null, 2) + '\n'
    writeFileSync(manifestPath(), originalManifest)
    writeFileSync(lockPath(), lockFile({ pkg: 'existing', version: '1.0.0', integrity: sha512('old') }))
    let verifyCalls = 0
    const restoreInstall = async () => { verifyCalls += 1 }
    // 模拟「丢键写入者」：安装成功但 manifest 丢了 pnpm 键
    const fakeAdd = async () => {
      writeFileSync(manifestPath(), JSON.stringify({ name: 'scratch-profile', private: true, dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }, null, 2) + '\n')
      writeFileSync(lockPath(), lockFile({ pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') }))
      return { output: 'ok', usedAllowAllBuilds: false }
    }
    const res = await installFromRegistry('p', {}, {}, baseDeps({ runnerOps: { add: wrapAdd(fakeAdd), frozenInstall: wrapInstall(restoreInstall) } }))
    assert.equal(res.version, '1.2.3', '安装本身不受影响')
    assert.equal(verifyCalls, 1, '找回键后执行了一次 frozen 复验')
    assert.ok(res.healActions?.length > 0, '自愈动作非空（[dsh-m 自愈] 结构源）')
    assert.ok(res.healActions.some((h) => h.code === 'B1_MANIFEST_KEYS_RESTORED'), 'B1 键找回在案')
    assert.ok(res.healActions.some((h) => h.note.includes('pnpm')), '自愈 note 点名找回的键')
    const finalDoc = JSON.parse(readFileSync(manifestPath(), 'utf8'))
    assert.deepEqual(finalDoc.pnpm?.overrides, OVERRIDE, 'pnpm.overrides 找回')
    assert.equal(finalDoc.dependencies['pkg-a'], '1.2.3', '安装写入的依赖变更保留')
  })
})

describe('readPnpmLockOverrides：lockfile overrides 区块解析', () => {
  it('引号 scoped 键与无引号键混排', () => {
    const text = `lockfileVersion: '9.0'

overrides:
  '@deepseek-ai/dsh-credentials-local': 0.1.1-rc.2
  isarray: 2.0.0
  'nested@1>child': 3.0.0

importers:
`
    assert.deepEqual(readPnpmLockOverrides(text), {
      '@deepseek-ai/dsh-credentials-local': '0.1.1-rc.2',
      isarray: '2.0.0',
      'nested@1>child': '3.0.0',
    })
  })

  it('无 overrides 区块返回空对象；空区块返回空对象', () => {
    assert.deepEqual(readPnpmLockOverrides("lockfileVersion: '9.0'\npackages:\n"), {})
    assert.deepEqual(readPnpmLockOverrides("lockfileVersion: '9.0'\noverrides:\nimporters:\n"), {})
  })
})
