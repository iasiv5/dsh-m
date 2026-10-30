/**
 * 0.9.0 Task 6：Desktop adapter（profile-ops）——官方 manager 委派、ChangeResult 判定、
 * 复读校验、needsBuildApproval 结构化、desktopToggle 服务缺席拒绝。
 * 运行：npm run build && node --test tests/profile-ops.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  desktopInstallFromRegistry,
  desktopToggle,
  desktopUninstall,
  desktopUpgradeFromRegistry,
  desktopSelfUpgradeViaTarball,
  DesktopOpsError,
  _setEnableRetryDelayForTests,
} from '../lib/core/profile-ops.js'
import { _resetReleaseAgeCachesForTests } from '../lib/core/release-age.js'
import { readUpgradeIntent } from '../lib/core/upgrade-intent.js'
import '../lib/core/toggle.js';
import { IncompatibleError } from '../lib/core/compat-check.js'
import { _resetMergedMarketForTests } from '../lib/core/merged-market.js'
// R1-1：L2 物化代跨用例隔离（fixture 假身份可能同键；node --test 文件内共享模块状态）
beforeEach(() => _resetMergedMarketForTests())

// 0.9.79：desktop 入口自记外部操作日志（'external' 兜底）——隔离 journal（同 cacheRoot 纪律）
process.env.DSHM_EXTERNAL_JOURNAL_FILE = join(mkdtempSync(join(tmpdir(), 'dshm-profileops-journal-')), 'external-operations.json')
// 0.10.0：自升级 intent ledger 同款隔离（D3/T17 钉例走真实 writeUpgradeIntent 时绝不碰真机 $DSH_HOME）
process.env.DSHM_UPGRADE_INTENT_FILE = join(mkdtempSync(join(tmpdir(), 'dshm-profileops-intent-')), 'self-upgrade-intent.json')

const ENTRY = {
  id: 'plug-a',
  name: 'Plug A',
  description: 'entry a',
  category: 'tools',
  tags: [],
  source: 'npm',
  npm: 'pkg-a',
}

function registryWith(entries) {
  return { configuredAddress: 'reg-test', activeAddress: 'reg-test', source: 'custom-url', status: 'ready', isDefault: false, stale: false, fetchedAt: new Date().toISOString(), errors: [], count: entries.length, registry: { version: 1, plugins: entries } }
}

/** 官方 manager 桩：记录 installBundle/removeBundle 调用；行为可编排。 */
function managerStub(overrides = {}) {
  const calls = { installBundle: [], removeBundle: [], listBundles: 0 }
  const bundles = overrides.bundles ?? [{ name: 'pkg-a', installed: true, enabled: true }]
  const service = {
    listPlugins: async () => [],
    setPluginEnabled: async () => ({}),
    setBundleEnabled: async () => ({}),
    installBundle: overrides.installBundle ?? (async (spec, options) => {
      calls.installBundle.push({ spec, options })
      return overrides.change ?? { changed: true, application: 'applied', stage: 'install', bundle: 'pkg-a', packageResult: { exitCode: 0 } }
    }),
    removeBundle: overrides.removeBundle ?? (async (name) => {
      calls.removeBundle.push(name)
      return overrides.removeChange ?? { changed: true, application: 'applied', stage: 'remove', bundle: name }
    }),
    listBundles: overrides.listBundles === null ? undefined : async () => {
      calls.listBundles += 1
      return typeof overrides.listBundles === 'function' ? overrides.listBundles() : bundles
    },
  }
  return { service, calls }
}

function depsFor(service, overrides = {}) {
  return {
    getService: () => service,
    resolveEntry: overrides.resolveEntry ?? (async () => overrides.entry ?? ENTRY),
    npmLatest: overrides.npmLatest ?? (async () => ({ version: '1.2.3', integrity: 'sha512-x', tarball: 'https://example.com/pkg-a.tgz' })),
    githubLatestTag: overrides.githubLatestTag ?? (async () => ({ tag: 'v0.9.0', sha: 'a'.repeat(40) })),
    precheck: overrides.precheck ?? (async () => null),
    ...(overrides.loadRegistry ? { loadRegistry: overrides.loadRegistry } : {}),
    ...(overrides.packumentTimes ? { packumentTimes: overrides.packumentTimes } : {}),
    ...(overrides.workspacePolicy ? { workspacePolicy: overrides.workspacePolicy } : {}),
    ...(overrides.governExclude ? { governExclude: overrides.governExclude } : {}),
    ...(overrides.registerExclude ? { registerExclude: overrides.registerExclude } : {}),
    ...(overrides.listInstalled ? { listInstalled: overrides.listInstalled } : {}),
  }
}

describe('desktopInstallFromRegistry：守门与委派', () => {
  it('服务缺席 / installBundle 缺席 → DesktopOpsError(no-manager)，零委派', async () => {
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, {}, depsFor(undefined)),
      (err) => err instanceof DesktopOpsError && err.code === 'no-manager',
    )
    const bare = { listPlugins: async () => [], setPluginEnabled: async () => ({}), setBundleEnabled: async () => ({}) }
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, {}, depsFor(bare)),
      (err) => err.code === 'no-manager',
    )
  })

  it('npm 新包成功（applied + listBundles 复读在装）→ InstallResult 形状 + via=desktop-manager', async () => {
    const { service, calls } = managerStub()
    const res = await desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service))
    assert.equal(res.ok, undefined)
    assert.equal(res.pkg, 'pkg-a')
    assert.equal(res.spec, 'pkg-a@1.2.3', 'npm 精确锁定语义保持')
    assert.equal(res.version, '1.2.3')
    assert.equal(res.needsRestart, true)
    assert.equal(res.via, 'desktop-manager')
    assert.deepEqual(res.buildApprovals, [])
    assert.equal(res.fallbackAllBuilds, false)
    assert.equal(calls.installBundle.length, 1)
    assert.equal(calls.installBundle[0].spec, 'pkg-a@1.2.3')
    assert.equal(calls.installBundle[0].options.enabled, true)
    assert.equal(calls.listBundles, 1, '复读必须发生')
  })

  it('application=restart-required 同成功路径；overridden 如实标注', async () => {
    const { service } = managerStub({ change: { changed: true, application: 'restart-required', stage: 'install', bundle: 'pkg-a' } })
    const res = await desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service))
    assert.equal(res.needsRestart, true)
    const { service: s2 } = managerStub({ change: { changed: true, application: 'overridden', stage: 'install', bundle: 'pkg-a' } })
    const res2 = await desktopInstallFromRegistry('plug-a', {}, {}, depsFor(s2))
    assert.equal(res2.overridden, true, 'overridden 非失败，如实标注')
  })

  it('stage=enable + application=failed（可跟在 exitCode 0 后）→ enable-failed', async () => {
    const { service } = managerStub({ change: { changed: true, application: 'failed', stage: 'enable', error: { code: 'operation-error' }, packageResult: { exitCode: 0 } } })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service)),
      (err) => err instanceof DesktopOpsError && err.code === 'enable-failed',
    )
  })

  it('build-blocked + pendingBuilds（未带 approvedBuilds）→ 结构化 needsBuildApproval，不抛', async () => {
    const { service, calls } = managerStub({
      change: { changed: false, application: 'failed', stage: 'install', packageResult: { exitCode: 1, kind: 'build-blocked' }, pendingBuilds: ['pkg-a', 'esbuild-dep'] },
    })
    const res = await desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service))
    assert.equal(res.ok, false)
    assert.equal(res.needsBuildApproval, true)
    assert.deepEqual(res.pendingBuilds, ['pkg-a', 'esbuild-dep'])
    assert.equal(calls.installBundle[0].options.approvedBuilds, undefined)
  })

  it('approvedBuilds 重试：名单原样传给官方管理器；成功后 buildApprovals 回填', async () => {
    let attempt = 0
    const { service, calls } = managerStub({
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        attempt += 1
        if (attempt === 1) {
          return { changed: false, application: 'failed', stage: 'install', packageResult: { exitCode: 1, kind: 'build-blocked' }, pendingBuilds: ['pkg-a'] }
        }
        return { changed: true, application: 'applied', stage: 'install', bundle: 'pkg-a', approvedBuilds: options.approvedBuilds, packageResult: { exitCode: 0 } }
      },
    })
    const deps = depsFor(service)
    const first = await desktopInstallFromRegistry('plug-a', {}, {}, deps)
    assert.equal(first.needsBuildApproval, true)
    const second = await desktopInstallFromRegistry('plug-a', {}, { approvedBuilds: first.pendingBuilds }, deps)
    assert.equal(second.ok, undefined)
    assert.deepEqual(second.buildApprovals, ['pkg-a'])
    assert.equal(calls.installBundle[0].options.approvedBuilds, undefined, '首次尝试不带放行名单')
    assert.deepEqual(calls.installBundle[1].options.approvedBuilds, ['pkg-a'], '重试把官方 pending 名单原样回传')
  })

  it('application=cancelled → install-refused', async () => {
    const { service } = managerStub({ change: { changed: false, application: 'cancelled', stage: 'install' } })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service)),
      (err) => err.code === 'install-refused' && /取消/.test(err.message),
    )
  })

  it('0.9.19：ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION → release-age-wait，全量违规解析 + 目标/旁包分述（0.9.10 只取首条的实证修复）', async () => {
    const diagnostic = [
      '? Verifying lockfile against supply-chain policies (8 entries)...',
      '✗ Lockfile failed supply-chain policy check (8 entries in 350ms)',
      '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:',
      '  dsh-m@0.9.8 was published at 2026-10-01T14:26:10.989Z, within the minimumReleaseAge cutoff (2026-09-30T15:08:06.630Z)',
    ].join('\n')
    const { service } = managerStub({ change: { application: 'failed', error: { code: 'operation-error', diagnostic } } })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service)),
      (err) => {
        assert.ok(err instanceof DesktopOpsError && err.code === 'release-age-wait', `应归类 release-age-wait：${err.message.slice(0, 80)}`)
        assert.ok(err.message.includes('dsh-m@0.9.8'), '应点名锁内违规条目')
        assert.ok(err.message.includes('不在违规名单'), '应说明本次目标未违规（旁包连坐），而非冒充目标被拦')
        assert.ok(err.message.includes('pkg-a@1.2.3'), '应点名本次目标')
        assert.ok(err.message.includes('minimumReleaseAge'), '应说明是供应链等待期策略')
        assert.ok(!err.message.includes('DSH Web'), '不应再给「改用 DSH Web」的失配指引')
        assert.ok(!err.message.includes('ERR_PNPM'), '不应向用户甩 pnpm 原始码')
        assert.equal(err.details?.violations?.length, 1, '结构化违规清单随错误携带')
        assert.equal(err.details?.targetViolating, false)
        return true
      },
    )
  })

  it('0.9.19：等待期失败 + 账实分裂复读——node_modules 已是新版而 manifest 仍旧版时，明示回退风险', async () => {
    const diagnostic = '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:\n  dsh-m@0.9.8 was published at 2026-10-01T14:26:10.989Z, within the minimumReleaseAge cutoff (2026-09-30T15:08:06.630Z)'
    const { service } = managerStub({ change: { application: 'failed', error: { code: 'operation-error', diagnostic } } })
    const deps = depsFor(service, {
      listInstalled: async () => ({ items: [{ pkg: 'pkg-a', version: '1.2.3', spec: '1.0.0', isDsh: true }], others: [], complete: true }),
    })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps),
      (err) => {
        assert.equal(err.code, 'release-age-wait')
        assert.ok(err.message.includes('账实分裂'), '应明示账实分裂形态')
        assert.ok(err.message.includes('1.0.0'), '应点名 manifest 仍旧版')
        assert.ok(err.message.includes('回退'), '应明示下次包操作的回退风险')
        assert.equal(err.details?.splitState?.manifestSpec, '1.0.0')
        assert.equal(err.details?.splitState?.installedVersion, '1.2.3')
        return true
      },
    )
  })

  it('0.9.19：账实分裂复读不可用（无 listInstalled）→ 只给等待指引，不遮蔽原错误', async () => {
    const diagnostic = '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION]\n  dsh-m@0.9.8 was published at 2026-10-01T14:26:10.989Z, within the minimumReleaseAge cutoff (2026-09-30T15:08:06.630Z)'
    const { service } = managerStub({ change: { application: 'failed', error: { code: 'operation-error', diagnostic } } })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, depsFor(service)),
      (err) => err.code === 'release-age-wait' && !err.message.includes('账实分裂'),
    )
  })

  it('复读校验：listBundles 未见目标在装 → verify-failed（不冒充成功）', async () => {
    const { service } = managerStub({ bundles: [{ name: 'other-pkg', installed: true, enabled: true }] })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service)),
      (err) => err.code === 'verify-failed',
    )
  })

  it('复读校验：listBundles 缺席且无 bundle 字段 → verify-failed', async () => {
    const { service } = managerStub({ listBundles: null, change: { changed: true, application: 'applied', stage: 'install' } })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service)),
      (err) => err.code === 'verify-failed',
    )
  })

  it('零 Web fallback：desktop 路径不触事务/快照/allowBuilds 文件', async () => {
    // 结构性保证：deps 里根本没有事务/快照注入点；此处锁行为——成功结果不走 capturePreMutationState
    // （若未来有人给它加 web 事务，这里会因 no-manager 之外的路径变化而失败）
    const { service } = managerStub()
    const res = await desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service))
    assert.equal(res.via, 'desktop-manager')
    assert.equal(res.fallbackAllBuilds, false, 'desktop 恒不做全量放行')
  })
})

describe('desktopInstallFromRegistry：compat 预检与 github 源', () => {
  it('npm 源 peer 不兼容且未 force → IncompatibleError；force → 放行且 compat 随结果携带', async () => {
    const issue = { pkg: 'pkg-a', version: '1.2.3', runtimeVersion: '0.2.0-rc.2', peers: { '@deepseek-ai/dsh-tools': '^0.1.0' } }
    const precheck = async () => issue
    const { service } = managerStub()
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service, { precheck })),
      (err) => err instanceof IncompatibleError,
    )
    const res = await desktopInstallFromRegistry('plug-a', {}, { forceIncompatible: true }, depsFor(service, { precheck }))
    assert.deepEqual(res.compat, issue)
  })

  it('github 源：spec=github:repo#sha、compatSkipped=github-source、sha/tag 随结果', async () => {
    const { service, calls } = managerStub()
    const res = await desktopInstallFromRegistry('plug-gh', {}, {}, depsFor(service, {
      entry: { id: 'plug-gh', name: 'GH', description: '', category: 'tools', tags: [], source: 'github', github: 'owner/repo' },
    }))
    const sha = 'a'.repeat(40)
    assert.equal(res.spec, `github:owner/repo#${sha}`)
    assert.equal(res.sha, sha)
    assert.equal(res.tag, 'v0.9.0')
    assert.equal(res.compatSkipped, 'github-source')
    assert.equal(calls.installBundle[0].spec, `github:owner/repo#${sha}`)
  })

  it('registry 解析走注入链（loadRegistry 透传 profile 段）', async () => {
    const seen = []
    const { service } = managerStub()
    const loadRegistry = async (cfg, opts) => {
      seen.push(opts)
      return registryWith([ENTRY])
    }
    const deps = depsFor(service, { loadRegistry })
    delete deps.resolveEntry
    await desktopInstallFromRegistry('plug-a', {}, { profile: 'desktop' }, deps)
    assert.equal(seen[0].profile, 'desktop')
  })
})

describe('desktopToggle', () => {
  let profileDir = ''
  beforeEach(() => {
    profileDir = mkdtempSync(join(tmpdir(), 'dshm-dtop-'))
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile', private: true, dependencies: { 'pkg-x': '1.0.0' } }))
    mkdirSync(join(profileDir, 'node_modules', 'pkg-x'), { recursive: true })
    writeFileSync(join(profileDir, 'node_modules', 'pkg-x', 'package.json'), JSON.stringify({ name: 'pkg-x', version: '1.0.0', dsh: true }))
  })
  afterEach(() => {
    rmSync(profileDir, { recursive: true, force: true })
  })

  it('服务缺席 → ToggleError(unaddressable)，绝不走 fallback 文件写', async () => {
    await assert.rejects(
      () => desktopToggle('pkg-x', true, { getService: () => undefined, profileDir }),
      (err) => err.code === 'unaddressable',
    )
  })

  it('服务在用 → 委派官方 setBundleEnabled 并复读（与 web 委派同代码路径）', async () => {
    const calls = { setBundle: [] }
    const service = {
      listPlugins: async () => [{ entryId: 'e1', moduleName: 'pkg-x', enabled: true }],
      setPluginEnabled: async () => ({}),
      setBundleEnabled: async (name, enabled) => {
        calls.setBundle.push([name, enabled])
        return { application: 'applied' }
      },
    }
    const res = await desktopToggle('pkg-x', true, { getService: () => service, profileDir })
    assert.deepEqual(calls.setBundle, [['pkg-x', true]])
    assert.equal(res.via, 'delegate')
    assert.equal(res.applied, 'live')
  })

  it('ensureService 拉起：同步探测缺席但 ensureService 返回服务 → 委派成功（0.9.8 服务解析回归门）', async () => {
    const service = {
      listPlugins: async () => [{ entryId: 'e1', moduleName: 'pkg-x', enabled: true }],
      setPluginEnabled: async () => ({}),
      setBundleEnabled: async () => ({ application: 'applied' }),
    }
    const res = await desktopToggle('pkg-x', true, {
      getService: () => undefined,
      ensureService: async () => service,
      profileDir,
    })
    assert.equal(res.via, 'delegate')
  })
})

// ---------- 0.9.8：desktop 卸载（removeBundle）与升级（installBundle 覆盖安装）----------

describe('desktopUninstall：removeBundle 委派（dsh-market 同策略）', () => {
  it('applied + listBundles 复读不在装 → 成功形态（needsRestart=false）', async () => {
    const { service, calls } = managerStub({ bundles: [{ name: 'pkg-a', installed: false }] })
    const res = await desktopUninstall('pkg-a', { getService: () => service })
    assert.deepEqual(calls.removeBundle, ['pkg-a'])
    assert.equal(res.pkg, 'pkg-a')
    assert.equal(res.needsRestart, false)
    assert.equal(res.via, 'desktop-manager')
    assert.deepEqual(res.leftovers, [])
  })

  it('restart-required → needsRestart=true', async () => {
    const { service } = managerStub({ removeChange: { application: 'restart-required', stage: 'remove', bundle: 'pkg-a' }, bundles: [{ name: 'pkg-a', installed: false }] })
    const res = await desktopUninstall('pkg-a', { getService: () => service })
    assert.equal(res.needsRestart, true)
  })

  it('application=failed → remove-failed', async () => {
    const { service } = managerStub({ removeChange: { application: 'failed', error: { code: 'E-REMOVE' } } })
    await assert.rejects(
      () => desktopUninstall('pkg-a', { getService: () => service }),
      (err) => err instanceof DesktopOpsError && err.code === 'remove-failed' && err.message.includes('E-REMOVE'),
    )
  })

  it('复读仍在装 → verify-failed（不冒充卸载成功）', async () => {
    const { service } = managerStub({ bundles: [{ name: 'pkg-a', installed: true }] })
    await assert.rejects(
      () => desktopUninstall('pkg-a', { getService: () => service }),
      (err) => err instanceof DesktopOpsError && err.code === 'verify-failed',
    )
  })

  it('服务缺席（同步与 ensure 均无）→ no-manager；removeBundle 缺席同样拒绝', async () => {
    await assert.rejects(() => desktopUninstall('pkg-a', {}), (err) => err.code === 'no-manager')
    await assert.rejects(() => desktopUninstall('pkg-a', { getService: () => undefined, ensureService: async () => undefined }), (err) => err.code === 'no-manager')
    const bare = managerStub({ listBundles: null }).service
    delete bare.removeBundle
    await assert.rejects(() => desktopUninstall('pkg-a', { getService: () => bare }), (err) => err.code === 'no-manager')
  })

  it('ensureService 拉起：同步探测缺席但 ensure 返回服务 → 委派成功（服务解析回归门）', async () => {
    const { service, calls } = managerStub({ bundles: [{ name: 'pkg-a', installed: false }] })
    const res = await desktopUninstall('pkg-a', { getService: () => undefined, ensureService: async () => service })
    assert.deepEqual(calls.removeBundle, ['pkg-a'])
    assert.equal(res.via, 'desktop-manager')
  })
})

// ADR-0028 T5：本 describe 的升级用例仅保留「接线 + 信封映射」薄层（合成接线×2、upgrade-unsupported
// 信封×1）；解析梯判定分支归 tests/upgrade-target.test.mjs 表驱动套件，勿在此重繁殖镜像判定用例。
describe('desktopUpgradeFromRegistry：覆盖安装（dsh-market 同策略）', () => {
  function upgradeDeps(service, overrides = {}) {
    return {
      getService: () => service,
      loadRegistry: overrides.loadRegistry ?? (async () => registryWith(overrides.entries ?? [ENTRY])),
      listInstalled: overrides.listInstalled ?? (async () => ({ items: overrides.installed ?? [{ pkg: 'pkg-a', name: 'Plug A', version: '1.0.0' }] })),
      npmLatest: overrides.npmLatest ?? (async () => ({ version: '1.2.3', integrity: 'sha512-x' })),
      precheck: async () => null,
      // 0.9.22 生效判定缝：缺省会真实出网 diff tarball——既有用例统一桩 unknown（保持 needsRestart=true 语义）
      classifyActivation: overrides.classifyActivation ?? (async () => 'unknown'),
    }
  }

  it('覆盖安装：registry 命中 → installBundle(pkg@latest) → 成功 + fromVersion + via=desktop-manager', async () => {
    const { service, calls } = managerStub()
    const res = await desktopUpgradeFromRegistry('pkg-a', {}, {}, upgradeDeps(service))
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3'])
    assert.equal(res.via, 'desktop-manager')
    assert.equal(res.version, '1.2.3')
    assert.equal(res.fromVersion, '1.0.0')
    assert.equal(res.needsRestart, true)
  })

  it('desktop profile 未安装该插件 → install-refused', async () => {
    const { service } = managerStub()
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-a', {}, {}, upgradeDeps(service, { installed: [] })),
      (err) => err instanceof DesktopOpsError && err.code === 'install-refused' && /未安装/.test(err.message),
    )
  })

  // ADR-0026 改写（原「非收录插件 → install-refused」）：主清单+社区 miss 不再硬拒——
  // github 已装项经合成条目重锁 HEAD；installBundle 收到 github:<repo>#<sha> 精确 spec。
  it('主清单与社区均 miss 的 github 已装项 → 合成条目重锁 HEAD（installBundle 收到 github spec）', async () => {
    const { service, calls } = managerStub({
      bundles: [{ name: 'owner-repo', installed: true, enabled: true }],
      change: { changed: true, application: 'applied', stage: 'install', bundle: 'owner-repo', packageResult: { exitCode: 0 } },
    })
    const deps = {
      getService: () => service,
      loadRegistry: async () => registryWith([]),
      listInstalled: async () => ({ items: [{ pkg: 'owner-repo', name: 'owner-repo', version: '0.1.0', source: 'github', spec: `github:owner/repo#${'d'.repeat(40)}` }] }),
      githubLatestTag: async () => ({ tag: 'v2.0.0', sha: 'c'.repeat(40) }),
      precheck: async () => null,
    }
    const res = await desktopUpgradeFromRegistry('owner-repo', {}, {}, deps)
    assert.deepEqual(calls.installBundle.map((c) => c.spec), [`github:owner/repo#${'c'.repeat(40)}`])
    assert.equal(res.fromVersion, '0.1.0')
    assert.equal(res.needsRestart, true)
  })

  // ADR-0026 改写（原「收录清单不可用 → install-refused」）：unavailable 不再硬抛——
  // npm 已装项经合成条目继续升级（条目查找 = 元数据增强，非前置条件）。
  it('收录清单不可用 → npm 已装项经合成条目升级成功（installBundle 收到 pkg@latest）', async () => {
    const { service, calls } = managerStub()
    const res = await desktopUpgradeFromRegistry('pkg-a', {}, {}, upgradeDeps(service, {
      loadRegistry: async () => ({ ...registryWith([]), status: 'unavailable' }),
      installed: [{ pkg: 'pkg-a', name: 'Plug A', version: '1.0.0', source: 'npm', spec: '^1.0.0' }],
    }))
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3'])
    assert.equal(res.version, '1.2.3')
    assert.equal(res.fromVersion, '1.0.0')
  })

  it('本地 file: spec 已装项 → upgrade-unsupported（B5 边界，结构化指引）', async () => {
    const { service } = managerStub()
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-a', {}, {}, upgradeDeps(service, {
        entries: [],
        installed: [{ pkg: 'pkg-a', name: 'Plug A', version: '1.0.0', source: 'npm', spec: 'file:../pkg-a' }],
      })),
      (err) => err instanceof DesktopOpsError && err.code === 'upgrade-unsupported' && /本地/.test(err.message),
    )
  })

  it('no-manager（同步与 ensure 均无）→ no-manager', async () => {
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-a', {}, {}, upgradeDeps(undefined, { deps: { ensureService: async () => undefined } })),
      (err) => err instanceof DesktopOpsError && err.code === 'no-manager',
    )
  })
})

// ---------- 0.10.0 Task 3：宿主 0.2.1 already-installed 守卫适配（两步化 + 兜底回装 + 降级恢复） ----------

describe('desktopUpgradeFromRegistry：already-installed 两步化 + 兜底回装 + 降级恢复（0.10.0）', () => {
  function twoStepDeps(service, overrides = {}) {
    return {
      getService: () => service,
      loadRegistry: async () => registryWith([ENTRY]),
      listInstalled: async () => ({ items: overrides.installed ?? [{ pkg: 'pkg-a', name: 'Plug A', version: '0.9.0' }] }),
      npmLatest: async () => ({ version: '1.2.3', integrity: 'sha512-x' }),
      precheck: async () => null,
      classifyActivation: async () => 'unknown',
    }
  }
  const GUARD_FAIL = { changed: false, application: 'failed', stage: 'install', error: { code: 'already-installed' } }
  const ADD_FAIL = { changed: false, application: 'failed', stage: 'install', error: { code: 'operation-error' }, packageResult: { exitCode: 1 } }
  const OK = { changed: true, application: 'applied', stage: 'install', bundle: 'pkg-a', packageResult: { exitCode: 0 } }

  it('T2：首腿 already-installed → remove+重试（installBundle 2 次同 spec）→ 成功且 output 含 two-step', async () => {
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      return calls.installBundle.length === 1 ? { ...GUARD_FAIL } : { ...OK }
    } })
    const res = await desktopUpgradeFromRegistry('pkg-a', {}, {}, twoStepDeps(service, { installed: [{ pkg: 'pkg-a', name: 'Plug A', version: '1.0.0' }] }))
    assert.deepEqual(calls.removeBundle, ['pkg-a'], '恰好卸载旧版一次')
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3'], '第二腿仍装新 spec')
    assert.match(res.output, /two-step/)
  })

  it('T3：第二腿失败 → 兜底回装旧版 0.9.0 → degraded=true + restoredTo=0.9.0', async () => {
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      if (calls.installBundle.length === 1) return { ...GUARD_FAIL }
      if (calls.installBundle.length === 2) return { ...ADD_FAIL }
      return { ...OK }
    } })
    const res = await desktopUpgradeFromRegistry('pkg-a', {}, {}, twoStepDeps(service))
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3', 'pkg-a@0.9.0'], '第三腿=旧版 spec（回装）')
    assert.deepEqual(calls.removeBundle, ['pkg-a'])
    assert.equal(res.degraded, true)
    assert.equal(res.restoredTo, '0.9.0')
    // 评审 R1-2：降级结果 version 落账为回装后实际版本（账实相符）；spec 保留尝试目标
    assert.equal(res.version, '0.9.0')
    assert.equal(res.spec, 'pkg-a@1.2.3')
  })

  it('T4：回装也失败 → rejects rollback-failed（缺席硬错误）', async () => {
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      if (calls.installBundle.length === 1) return { ...GUARD_FAIL }
      if (calls.installBundle.length === 2) return { ...ADD_FAIL }
      return { ...ADD_FAIL, error: { code: 'rollback-boom' } }
    } })
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-a', {}, {}, twoStepDeps(service)),
      (err) => err instanceof DesktopOpsError && err.code === 'rollback-failed',
    )
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3', 'pkg-a@0.9.0'])
  })

  it('T5：remove 腿失败（bundle-in-use）→ remove-failed 短路且零回装（installBundle 恰 1 次）', async () => {
    const { service, calls } = managerStub({
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        return { ...GUARD_FAIL }
      },
      removeBundle: async (name) => {
        calls.removeBundle.push(name)
        return { changed: false, application: 'failed', stage: 'remove', bundle: name, error: { code: 'bundle-in-use' } }
      },
    })
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-a', {}, {}, twoStepDeps(service)),
      (err) => err instanceof DesktopOpsError && err.code === 'remove-failed',
    )
    assert.equal(calls.installBundle.length, 1, 'remove 失败不回装不重试')
    assert.deepEqual(calls.removeBundle, ['pkg-a'])
  })

  it('T8：第二腿 cancelled → 兜底回装旧版成功 → rejects install-refused 且文案含「已恢复旧版 0.9.0」「未做升级」', async () => {
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      if (calls.installBundle.length === 1) return { ...GUARD_FAIL }
      if (calls.installBundle.length === 2) return { changed: false, application: 'cancelled', stage: 'install' }
      return { ...OK }
    } })
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-a', {}, {}, twoStepDeps(service)),
      (err) => err instanceof DesktopOpsError && err.code === 'install-refused'
        && err.message.includes('已恢复旧版 0.9.0') && err.message.includes('未做升级'),
    )
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3', 'pkg-a@0.9.0'], '取消腿同样兜底回装')
  })

  it('T9：第二腿 build-blocked → 先回装旧版，再经既有映射给结构化 needsBuildApproval（审批语义优先，公开入口不抛）', async () => {
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      if (calls.installBundle.length === 1) return { ...GUARD_FAIL }
      if (calls.installBundle.length === 2) return { changed: false, application: 'failed', stage: 'install', packageResult: { kind: 'build-blocked' }, pendingBuilds: ['pkg-a'] }
      return { ...OK }
    } })
    const res = await desktopUpgradeFromRegistry('pkg-a', {}, {}, twoStepDeps(service))
    assert.equal(res.ok, false)
    assert.equal(res.needsBuildApproval, true)
    assert.deepEqual(res.pendingBuilds, ['pkg-a'])
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3', 'pkg-a@0.9.0'], '回装已兜住旧版')
  })

  it('T9b：回装腿自身 build-blocked → rejects rollback-failed 且 details.pendingBuilds 非空（降级失败真相优先）', async () => {
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      if (calls.installBundle.length === 1) return { ...GUARD_FAIL }
      return { changed: false, application: 'failed', stage: 'install', packageResult: { kind: 'build-blocked' }, pendingBuilds: ['pkg-a'] }
    } })
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-a', {}, {}, twoStepDeps(service)),
      (err) => err instanceof DesktopOpsError && err.code === 'rollback-failed'
        && Array.isArray(err.details?.pendingBuilds) && err.details.pendingBuilds.length > 0,
    )
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3', 'pkg-a@0.9.0'])
  })

  // ---------- 0.10.16：post-write 伪失败账实改判（0.4.3 批量升级真机事件，D3 0.10.2 先例镜像） ----------

  it('T10：第二腿 post-write 伪失败（already-installed 但账面已写穿目标版）→ 改判成功，零回装零降级', async () => {
    // 账本是演化的：升级前 1.0.0 → 第二腿写穿三面账后为 1.2.3（随后完成路径自触守卫）
    let ledgerVersion = '1.0.0'
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      if (calls.installBundle.length === 1) return { ...GUARD_FAIL }
      ledgerVersion = '1.2.3'
      return { ...GUARD_FAIL }
    } })
    const deps = twoStepDeps(service, { installed: [{ pkg: 'pkg-a', name: 'Plug A', version: '1.0.0', spec: '1.0.0' }] })
    deps.listInstalled = async () => ({ items: [{ pkg: 'pkg-a', name: 'Plug A', version: ledgerVersion, spec: ledgerVersion }] })
    const res = await desktopUpgradeFromRegistry('pkg-a', {}, { profileDir: 'X:/profile-demo' }, deps)
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3'], '改判成功：零回装腿')
    assert.deepEqual(calls.removeBundle, ['pkg-a'])
    assert.equal(res.version, '1.2.3', '账实相符：目标版落账')
    assert.equal(res.needsRestart, true)
    assert.equal(res.degraded, undefined)
    assert.match(res.output, /改判成功/)
    assert.match(res.output, /post-write 伪失败/)
  })

  it('T11：第二腿失败且账面仍为旧版（真失败，非伪失败）→ 改判不误触发，既有回装语义不变', async () => {
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      if (calls.installBundle.length === 1) return { ...GUARD_FAIL }
      if (calls.installBundle.length === 2) return { ...ADD_FAIL }
      return { ...OK }
    } })
    const res = await desktopUpgradeFromRegistry('pkg-a', {}, {}, twoStepDeps(service))
    assert.equal(res.degraded, true)
    assert.equal(res.restoredTo, '0.9.0')
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3', 'pkg-a@0.9.0'])
    assert.doesNotMatch(res.output, /改判成功/)
  })

  it('T12：第一腿真失败（pnpm 未写入，旧版本就还在）→ 既有语义：报失败零回装，改判不误触发', async () => {
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      return calls.installBundle.length === 1 ? { ...ADD_FAIL } : { ...OK }
    } })
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-a', {}, {}, twoStepDeps(service)),
      (err) => err instanceof DesktopOpsError,
    )
    assert.equal(calls.installBundle.length, 1, '首腿真失败零回装（旧版未被 remove，无需回装）')
    assert.deepEqual(calls.removeBundle, [], '零卸载')
  })
})

// ---------- 0.10.0 Task 5：install 路径静默两步化（R5）+ 全新安装单步回归（R1×R5 张力的 T6 消解钉） ----------

describe('desktopInstallFromRegistry：install 路径静默两步化 + 全新安装单步回归（0.10.0）', () => {
  const OK = { changed: true, application: 'applied', stage: 'install', bundle: 'pkg-a', packageResult: { exitCode: 0 } }
  const GUARD_FAIL = { changed: false, application: 'failed', stage: 'install', error: { code: 'already-installed' } }
  /** 全离线桩：等待期预检/治理/登记全部注入 no-op，profileDir 仅用于 previousVersion 探测。 */
  function offlineDeps(service, overrides = {}) {
    return depsFor(service, {
      packumentTimes: async () => ({}),
      workspacePolicy: async () => ({ explicitAge: false, minimumReleaseAgeMin: null, strict: false, excludes: [] }),
      governExclude: async () => ({ changed: false }),
      registerExclude: async () => ({ applied: false }),
      ...overrides,
    })
  }

  it('T6：全新安装（listInstalled 空）→ removeBundle 恒零调用（单步语义不回归）', async () => {
    const { service, calls } = managerStub()
    const res = await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-t6' }, offlineDeps(service, {
      listInstalled: async () => ({ items: [], others: [], complete: true }),
    }))
    assert.deepEqual(calls.removeBundle, [], '全新安装零 removeBundle')
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3'])
    assert.equal(res.via, 'desktop-manager')
  })

  it('T7：目标已装（pkg-a@0.5.0）且首腿 already-installed → 静默两步化，output 含 already-installed → two-step', async () => {
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      return calls.installBundle.length === 1 ? { ...GUARD_FAIL } : { ...OK }
    } })
    const res = await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-t7' }, offlineDeps(service, {
      listInstalled: async () => ({ items: [{ pkg: 'pkg-a', name: 'Plug A', version: '0.5.0', spec: '0.5.0' }], others: [], complete: true }),
    }))
    assert.deepEqual(calls.removeBundle, ['pkg-a'], '守卫命中 → 卸载旧版一次')
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3'], '第二腿仍装新 spec')
    assert.match(res.output, /already-installed → two-step/)
  })
})

// ---------- 0.10.1（E2E 实证扩面）：enable 竞速自动重试普适到两步第二腿/回装腿/D3 + 回装失败账实复读 ----------

describe('enable 竞速重试普适化 + 回装失败账实复读（0.10.1，真机 skip-auth 事件）', () => {
  const GUARD_FAIL = { changed: false, application: 'failed', stage: 'install', error: { code: 'already-installed' } }
  const ADD_FAIL = { changed: false, application: 'failed', stage: 'install', error: { code: 'operation-error' }, packageResult: { exitCode: 1 } }
  const OK = { changed: true, application: 'applied', stage: 'install', bundle: 'pkg-a', packageResult: { exitCode: 0 } }
  function twoStepDeps(service) {
    return {
      getService: () => service,
      loadRegistry: async () => registryWith([ENTRY]),
      listInstalled: async () => ({ items: [{ pkg: 'pkg-a', name: 'Plug A', version: '0.9.0', spec: '0.9.0' }], others: [], complete: true }),
      npmLatest: async () => ({ version: '1.2.3', integrity: 'sha512-x' }),
      precheck: async () => null,
      classifyActivation: async () => 'unknown',
    }
  }
  const ENABLE_RACE = { changed: false, application: 'failed', stage: 'enable', error: { code: 'operation-error' } }
  function d3Deps(service) {
    return {
      getService: () => service,
      npmLatest: async () => ({ version: '2.0.0', integrity: 'sha512-x', tarball: 'https://example.com/dsh-m-2.0.0.tgz' }),
      npmTarballUrl: async () => 'https://example.com/dsh-m-2.0.0.tgz',
    }
  }

  it('T-A1：第二腿 enable 竞速 → 自动重试即愈 → 两步升级成功（leg1 + leg2×2，同 spec）', async () => {
    _setEnableRetryDelayForTests(0)
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      if (calls.installBundle.length === 1) return { ...GUARD_FAIL }
      if (calls.installBundle.length === 2) return { ...ENABLE_RACE }
      return { ...OK }
    } })
    const res = await desktopUpgradeFromRegistry('pkg-a', {}, {}, twoStepDeps(service))
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3', 'pkg-a@1.2.3'], '第二腿重试一次')
    assert.deepEqual(calls.removeBundle, ['pkg-a'])
    assert.match(res.output, /two-step/)
  })

  it('T-A2：回装腿 enable 竞速 → 自动重试即愈 → 降级恢复（不误报缺席）', async () => {
    _setEnableRetryDelayForTests(0)
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      if (calls.installBundle.length === 1) return { ...GUARD_FAIL }
      if (calls.installBundle.length === 2) return { ...ADD_FAIL }
      if (calls.installBundle.length === 3) return { ...ENABLE_RACE }
      return { ...OK }
    } })
    const res = await desktopUpgradeFromRegistry('pkg-a', {}, {}, twoStepDeps(service))
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3', 'pkg-a@0.9.0', 'pkg-a@0.9.0'], '回装腿重试一次')
    assert.equal(res.degraded, true)
    assert.equal(res.restoredTo, '0.9.0')
    assert.equal(res.version, '0.9.0')
  })

  it('T-B1：回装腿失败但账面已有版本 → rollback-failed 如实报「已写入 + 重启激活」（零缺席误导）', async () => {
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      if (calls.installBundle.length === 1) return { ...GUARD_FAIL }
      if (calls.installBundle.length === 2) return { ...ADD_FAIL }
      return { changed: false, application: 'failed', stage: 'install', error: { code: 'operation-error' } }
    } })
    const deps = twoStepDeps(service)
    deps.listInstalled = async () => ({ items: [{ pkg: 'pkg-a', name: 'Plug A', version: '0.9.0', spec: '0.9.0' }], others: [], complete: true })
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-a', {}, { profileDir: 'X:/profile-tb1' }, deps),
      (err) => err instanceof DesktopOpsError && err.code === 'rollback-failed'
        && err.message.includes('已写入')
        && err.message.includes('重启')
        && !err.message.includes('可能缺席')
        && err.details?.installedVersion === '0.9.0',
    )
  })

  it('T-B2：回装腿失败且账面确实缺席 → 保留缺席文案与手动重装指引（原语义不回归）', async () => {
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      if (calls.installBundle.length === 1) return { ...GUARD_FAIL }
      if (calls.installBundle.length === 2) return { ...ADD_FAIL }
      return { changed: false, application: 'failed', stage: 'install', error: { code: 'operation-error' } }
    } })
    const deps = twoStepDeps(service)
    let liCalls = 0
    deps.listInstalled = async () => {
      liCalls += 1
      // 首查（升级目标定位）返回已装 0.9.0；回装失败复读时返回缺席
      return liCalls === 1
        ? { items: [{ pkg: 'pkg-a', name: 'Plug A', version: '0.9.0', spec: '0.9.0' }], others: [], complete: true }
        : { items: [], others: [], complete: true }
    }
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-a', {}, { profileDir: 'X:/profile-tb2' }, deps),
      (err) => err instanceof DesktopOpsError && err.code === 'rollback-failed'
        && err.message.includes('可能缺席')
        && err.message.includes('手动重装 pkg-a@0.9.0')
        && err.details?.installedVersion === undefined,
    )
  })

  it('T-A3：D3 自升级通道 installBundle enable 竞速 → 自动重试即愈（同 URL 两次，成功收口 intent）', async () => {
    _setEnableRetryDelayForTests(0)
    process.env.DSHM_UPGRADE_INTENT_FILE = join(mkdtempSync(join(tmpdir(), 'dshm-profileops-intent-')), 'self-upgrade-intent.json')
    const { service, calls } = managerStub({
      bundles: [{ name: 'dsh-m', installed: true, enabled: true }],
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        if (calls.installBundle.length === 1) return { ...ENABLE_RACE }
        return { changed: true, application: 'restart-required', stage: 'install', bundle: 'dsh-m', packageResult: { exitCode: 0 } }
      },
    })
    const res = await desktopSelfUpgradeViaTarball('dsh-m', '0.9.94', {}, d3Deps(service))
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['https://example.com/dsh-m-2.0.0.tgz', 'https://example.com/dsh-m-2.0.0.tgz'], 'D3 同 URL 重试一次')
    assert.equal(res.needsRestart, true)
    assert.equal((await readUpgradeIntent())?.status, 'resolved')
  })

  it('T-D3：applied → needsRestart=false（0.10.2 挂账 3：core 层直接钉，替代 client 层间接覆盖）', async () => {
    process.env.DSHM_UPGRADE_INTENT_FILE = join(mkdtempSync(join(tmpdir(), 'dshm-profileops-intent-')), 'self-upgrade-intent.json')
    const { service, calls } = managerStub({
      bundles: [{ name: 'dsh-m', installed: true, enabled: true }],
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        return { changed: true, application: 'applied', stage: 'install', bundle: 'dsh-m', packageResult: { exitCode: 0 } }
      },
    })
    const res = await desktopSelfUpgradeViaTarball('dsh-m', '0.9.94', {}, d3Deps(service))
    assert.equal(res.needsRestart, false, 'R10：applied → 无需重启横幅（core 直钉）')
    assert.equal((await readUpgradeIntent())?.outcome, 'ok')
  })

  // ---------- 0.10.1（E2E 实证 ③）：install 路径守卫命中一律两步化（去掉 previousVersion 前置门） ----------
  // 真机事件：卸载 → 同会话重装，宿主活跃态仍视其在装（守卫命中），而 previousVersion 探测口径为「未安装」
  // → 0.10.0 原样透传 already-installed。修法：守卫命中即 remove+add（官方语义），无旧版时失败走账实复读。

  describe('install 路径守卫命中一律两步化（0.10.1 ③）', () => {
    const GUARD_FAIL_2 = { changed: false, application: 'failed', stage: 'install', error: { code: 'already-installed' } }
    const ADD_FAIL_2 = { changed: false, application: 'failed', stage: 'install', error: { code: 'operation-error' }, packageResult: { exitCode: 1 } }
    const OK_2 = { changed: true, application: 'applied', stage: 'install', bundle: 'pkg-a', packageResult: { exitCode: 0 } }
    function freshDeps(service, listInstalled) {
      return {
        getService: () => service,
        resolveEntry: async () => ENTRY,
        npmLatest: async () => ({ version: '1.2.3', integrity: 'sha512-x' }),
        precheck: async () => null,
        packumentTimes: async () => ({}),
        workspacePolicy: async () => ({ explicitAge: false, minimumReleaseAgeMin: null, strict: false, excludes: [] }),
        governExclude: async () => ({ changed: false }),
        registerExclude: async () => ({ applied: false }),
        listInstalled,
      }
    }

    it('T-C1：全新安装（listInstalled 空）守卫命中 → 仍两步化 → 成功且 output 含 two-step', async () => {
      const { service, calls } = managerStub({ installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        return calls.installBundle.length === 1 ? { ...GUARD_FAIL_2 } : { ...OK_2 }
      } })
      const res = await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-tc1' }, freshDeps(service, async () => ({ items: [], others: [], complete: true })))
      assert.deepEqual(calls.removeBundle, ['pkg-a'], '守卫命中即 remove（宿主说在装，remove 就是官方语义）')
      assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3'])
      assert.match(res.output, /already-installed → two-step/)
    })

    it('T-C2：无旧版可回装且第二腿失败 → 按账实复读给恢复指引（缺席形态）', async () => {
      const { service, calls } = managerStub({ installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        if (calls.installBundle.length === 1) return { ...GUARD_FAIL_2 }
        return { ...ADD_FAIL_2 }
      } })
      await assert.rejects(
        () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-tc2' }, freshDeps(service, async () => ({ items: [], others: [], complete: true }))),
        (err) => err instanceof DesktopOpsError && err.code === 'rollback-failed'
          && err.message.includes('可能缺席')
          && err.details?.installedVersion === undefined,
      )
      assert.deepEqual(calls.installBundle.map((c) => c.spec), ['pkg-a@1.2.3', 'pkg-a@1.2.3'])
    })

    it('T-C3：无旧版可回装、第二腿失败但账面已有版本（卸载窗口实况复刻）→ 「已写入 + 重启激活」', async () => {
      const { service, calls } = managerStub({ installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        if (calls.installBundle.length === 1) return { ...GUARD_FAIL_2 }
        return { ...ADD_FAIL_2 }
      } })
      let liCalls = 0
      const deps = freshDeps(service, async () => {
        liCalls += 1
        // 首查（previousVersion 探测）= 空（卸载窗口的探测口径）；回装失败复读 = 0.4.1 已写入（账实）
        return liCalls === 1
          ? { items: [], others: [], complete: true }
          : { items: [{ pkg: 'pkg-a', name: 'Plug A', version: '0.4.1', spec: '0.4.1' }], others: [], complete: true }
      })
      await assert.rejects(
        () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-tc3' }, deps),
        (err) => err instanceof DesktopOpsError && err.code === 'rollback-failed'
          && err.message.includes('已写入')
          && err.message.includes('重启')
          && err.details?.installedVersion === '0.4.1',
      )
    })
  })
})

// ---------- 0.10.2（D3 dogfood 实证）：宿主自身 bundle 换装的 post-write 伪失败 → 账实改判 ----------

describe('D3 账实改判（0.10.2，0.10.0→0.10.1 真机伪失败事件）', () => {
  function d3Deps2(service, listInstalled) {
    return {
      getService: () => service,
      npmLatest: async () => ({ version: '0.10.1', integrity: 'sha512-x' }),
      npmTarballUrl: async () => 'https://registry.npmmirror.com/dsh-m/-/dsh-m-0.10.1.tgz',
      listInstalled,
    }
  }
  const AI_FAIL = { changed: false, application: 'failed', stage: 'install', error: { code: 'already-installed' } }

  it('T-D1：终态失败但账面已写入目标版 → 改判成功（needsRestart=true、intent resolved ok、already-installed 非竞速形态不重试）', async () => {
    process.env.DSHM_UPGRADE_INTENT_FILE = join(mkdtempSync(join(tmpdir(), 'dshm-profileops-intent-')), 'self-upgrade-intent.json')
    const { service, calls } = managerStub({
      bundles: [{ name: 'dsh-m', installed: true, enabled: true }],
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        return { ...AI_FAIL }
      },
    })
    const res = await desktopSelfUpgradeViaTarball('dsh-m', '0.10.0', { profileDir: 'X:/d3-d1' }, d3Deps2(service, async () => ({
      items: [{ pkg: 'dsh-m', name: 'dsh-m', version: '0.10.1', spec: 'https://registry.npmmirror.com/dsh-m/-/dsh-m-0.10.1.tgz' }],
      others: [],
      complete: true,
    })))
    assert.equal(res.version, '0.10.1')
    assert.equal(res.needsRestart, true, '改判成功仍需重启激活')
    assert.match(res.output, /改判/)
    assert.equal(calls.installBundle.length, 1, 'already-installed 非 enable 竞速形态：不重试')
    const intent = await readUpgradeIntent()
    assert.equal(intent?.status, 'resolved')
    assert.equal(intent?.outcome, 'ok')
  })

  it('T-D2：终态失败且账面未到目标版 → 真失败原语义（intent resolved failed）', async () => {
    process.env.DSHM_UPGRADE_INTENT_FILE = join(mkdtempSync(join(tmpdir(), 'dshm-profileops-intent-')), 'self-upgrade-intent.json')
    const { service, calls } = managerStub({
      bundles: [{ name: 'dsh-m', installed: true, enabled: true }],
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        return { ...AI_FAIL }
      },
    })
    await assert.rejects(
      () => desktopSelfUpgradeViaTarball('dsh-m', '0.10.0', { profileDir: 'X:/d3-d2' }, d3Deps2(service, async () => ({
        items: [{ pkg: 'dsh-m', name: 'dsh-m', version: '0.10.0', spec: '0.10.0' }],
        others: [],
        complete: true,
      }))),
      (err) => err instanceof DesktopOpsError && err.code === 'install-refused' && /自升级失败/.test(err.message) && /0\.10\.1/.test(err.message),
    )
    const intent = await readUpgradeIntent()
    assert.equal(intent?.status, 'resolved')
    assert.equal(intent?.outcome, 'failed')
  })
})

// ---------- 0.10.0 Task 7：D3 自升级专用通道（tarball 直覆盖）+ SELF_PKG core 缝改道 ----------

describe('desktopSelfUpgradeViaTarball：D3 tarball 直覆盖（0.10.0）', () => {
  function d3Deps(service, overrides = {}) {
    return {
      getService: () => service,
      npmLatest: overrides.npmLatest ?? (async () => ({ version: '2.0.0', integrity: 'sha512-x', tarball: 'https://example.com/dsh-m-2.0.0.tgz' })),
      npmTarballUrl: overrides.npmTarballUrl ?? (async () => 'https://example.com/dsh-m-2.0.0.tgz'),
      listInstalled: overrides.listInstalled,
    }
  }
  const D3_OK = { changed: true, application: 'restart-required', stage: 'install', bundle: 'dsh-m', packageResult: { exitCode: 0 } }
  /** 每钉独立 intent 文件（同文件内共享模块 env；防跨钉残留串扰）。 */
  const freshIntentFile = () => {
    process.env.DSHM_UPGRADE_INTENT_FILE = join(mkdtempSync(join(tmpdir(), 'dshm-profileops-intent-')), 'self-upgrade-intent.json')
  }

  it('T10：同版本 → install-refused no-op，零 installBundle、零 intent 落盘', async () => {
    freshIntentFile()
    const { service, calls } = managerStub({ bundles: [{ name: 'dsh-m', installed: true, enabled: true }] })
    await assert.rejects(
      () => desktopSelfUpgradeViaTarball('dsh-m', '2.0.0', {}, d3Deps(service)),
      (err) => err instanceof DesktopOpsError && err.code === 'install-refused' && /已是最新|无需升级/.test(err.message),
    )
    assert.equal(calls.installBundle.length, 0)
    assert.equal(await readUpgradeIntent(), undefined)
  })

  it('T11：精确版本 → tarball URL + enabled:true 直覆盖 → needsRestart 透传 + intent 落 delegated 后就地 resolve ok', async () => {
    freshIntentFile()
    const { service, calls } = managerStub({
      bundles: [{ name: 'dsh-m', installed: true, enabled: true }],
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        return { ...D3_OK }
      },
    })
    const res = await desktopSelfUpgradeViaTarball('dsh-m', '0.9.94', {}, d3Deps(service))
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['https://example.com/dsh-m-2.0.0.tgz'])
    assert.equal(calls.installBundle[0].options?.enabled, true)
    assert.equal(res.needsRestart, true, 'restart-required 忠实透传（R10）')
    assert.equal(res.version, '2.0.0')
    const intent = await readUpgradeIntent()
    assert.equal(intent?.status, 'resolved')
    assert.equal(intent?.outcome, 'ok')
    assert.equal(intent?.installedVersion, '2.0.0')
    assert.equal(intent?.fromVersion, '0.9.94')
  })

  it('T12：npmTarballUrl 抛错 → rejects 且零 installBundle、零 intent 残留（写入前失败不落盘）', async () => {
    freshIntentFile()
    const { service, calls } = managerStub({ bundles: [{ name: 'dsh-m', installed: true, enabled: true }] })
    await assert.rejects(
      () => desktopSelfUpgradeViaTarball('dsh-m', '0.9.94', {}, d3Deps(service, {
        npmTarballUrl: async () => { throw new Error('packument boom') },
      })),
      /packument boom/,
    )
    assert.equal(calls.installBundle.length, 0)
    assert.equal(await readUpgradeIntent(), undefined)
  })
})

describe('SELF_PKG core 缝改道：desktopUpgrade/desktopInstall(dsh-m) 一律 D3（0.10.0 T17）', () => {
  const DSH_M_ENTRY = { ...ENTRY, id: 'dsh-m', name: 'dsh-m', npm: 'dsh-m' }
  const D3_OK = { changed: true, application: 'restart-required', stage: 'install', bundle: 'dsh-m', packageResult: { exitCode: 0 } }
  function seamDeps(service, overrides = {}) {
    return {
      getService: () => service,
      loadRegistry: async () => registryWith([DSH_M_ENTRY]),
      listInstalled: async () => ({ items: overrides.installed ?? [{ pkg: 'dsh-m', name: 'dsh-m', version: '0.9.94' }], others: [], complete: true }),
      npmLatest: async () => ({ version: '0.10.0', integrity: 'sha512-x' }),
      npmTarballUrl: async () => 'https://example.com/dsh-m-0.10.0.tgz',
      precheck: async () => null,
      classifyActivation: async () => 'unknown',
      packumentTimes: async () => ({}),
      workspacePolicy: async () => ({ explicitAge: false, minimumReleaseAgeMin: null, strict: false, excludes: [] }),
    }
  }
  it('T17a：desktopUpgradeFromRegistry(dsh-m) → installBundle 恰一次收 tarball URL，removeBundle 零调用（绝不两步）', async () => {
    const { service, calls } = managerStub({
      bundles: [{ name: 'dsh-m', installed: true, enabled: true }],
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        return { ...D3_OK }
      },
    })
    const res = await desktopUpgradeFromRegistry('dsh-m', {}, {}, seamDeps(service))
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['https://example.com/dsh-m-0.10.0.tgz'])
    assert.deepEqual(calls.removeBundle, [], '自升级绝不走 remove+add')
    assert.equal(res.needsRestart, true)
  })

  it('T17b：desktopInstallFromRegistry(dsh-m, 已装态) → 同样改道 D3', async () => {
    const { service, calls } = managerStub({
      bundles: [{ name: 'dsh-m', installed: true, enabled: true }],
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        return { ...D3_OK }
      },
    })
    const res = await desktopInstallFromRegistry('dsh-m', {}, { profileDir: 'X:/profile-t17' }, seamDeps(service))
    assert.deepEqual(calls.installBundle.map((c) => c.spec), ['https://example.com/dsh-m-0.10.0.tgz'])
    assert.deepEqual(calls.removeBundle, [], '自升级绝不走 remove+add')
    assert.equal(res.needsRestart, true)
  })
})

// ---------- 本地增强（2026-10-02，未随计划发版）：enable 阶段失败自动重试一次 + 文案按 packageResult 精确化 ----------
// 背景：desktop 高频装卸/插件树重载窗口下，官方管理器 enable 阶段竞速返回 application=failed/stage=enable/
// error=operation-error（实机实证 dsh-copilot-auth 三装卸两败，失败 pnpm.log 均为 0 字节——失败在 pnpm 之前）。

const ENABLE_FAIL = { changed: false, application: 'failed', stage: 'enable', error: { code: 'operation-error' } }

describe('desktopInstallFromRegistry：enable 失败自动重试与文案精确化', () => {
  it('enable 失败（operation-error）→ 自动重试一次；重试成功则安装成功', async () => {
    _setEnableRetryDelayForTests(0)
    let n = 0
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      n += 1
      return n === 1
        ? { ...ENABLE_FAIL }
        : { changed: true, application: 'applied', stage: 'enable', bundle: 'pkg-a', packageResult: { exitCode: 0 } }
    } })
    const res = await desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service))
    assert.equal(res.ok, undefined, '成功形态沿用 InstallResult（无 ok 布尔）')
    assert.equal(res.via, 'desktop-manager')
    assert.equal(calls.installBundle.length, 2, '恰好自动重试一次')
  })

  it('重试仍 enable 失败且 packageResult 缺席 → 文案不得声称「包已写入」（enable 先行失败 = 安装未执行）', async () => {
    _setEnableRetryDelayForTests(0)
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      return { ...ENABLE_FAIL }
    } })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service)),
      (err) => err instanceof DesktopOpsError && err.code === 'enable-failed'
        && !err.message.includes('包已写入')
        && err.message.includes('官方未回传包写入结果'),
    )
    assert.equal(calls.installBundle.length, 2, '受限单次重试')
  })

  it('重试仍失败且 packageResult.exitCode===0 → 文案如实「包已写入」', async () => {
    _setEnableRetryDelayForTests(0)
    const { service } = managerStub({ installBundle: async () => ({ ...ENABLE_FAIL, packageResult: { exitCode: 0 } }) })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service)),
      (err) => err instanceof DesktopOpsError && err.code === 'enable-failed' && err.message.includes('包已写入但未能启用'),
    )
  })

  it('非 enable 阶段失败（install stage）不重试：installBundle 恰一次', async () => {
    _setEnableRetryDelayForTests(0)
    const { service, calls } = managerStub({ installBundle: async (spec, options) => {
      calls.installBundle.push({ spec, options })
      return { changed: false, application: 'failed', stage: 'install', error: { code: 'boom' }, packageResult: { exitCode: 1 } }
    } })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service)),
      (err) => err instanceof DesktopOpsError && err.code === 'install-refused',
    )
    assert.equal(calls.installBundle.length, 1, '非 enable 失败不触发重试')
  })
})

describe('ADR-0009 排除条目治理 + 供应链等待期（治理/预检/双码重试/登记 接线）', () => {
  const MIN = 60_000
  const isoAgo = (ms) => new Date(Date.now() - ms).toISOString()
  const defaultPolicy = () => ({ explicitAge: false, minimumReleaseAgeMin: null, strict: false, excludes: [] })
  const explicitPolicy = (min, excludes = []) => ({ explicitAge: true, minimumReleaseAgeMin: min, strict: false, excludes })
  const DUAL = '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:\n  dsh-m@0.9.8 was published at 2026-10-01T14:26:10.989Z, within the minimumReleaseAge cutoff (2026-09-30T15:08:06.630Z)'

  beforeEach(_resetReleaseAgeCachesForTests)

  it('默认策略 + young → 放行委派；register 缝被调且 output 含登记短语（install 无 previousVersion）', async () => {
    const { service, calls } = managerStub()
    const registered = []
    const deps = depsFor(service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
      workspacePolicy: defaultPolicy,
      registerExclude: async (profileDir, target) => {
        registered.push({ profileDir, target })
        return { applied: true, form: 'created-exact' }
      },
    })
    const res = await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps)
    assert.equal(calls.installBundle.length, 1, '默认策略不拦截（官方管理器对显式点名直接安装）')
    assert.equal(registered.length, 1)
    assert.deepEqual(registered[0].target, { pkg: 'pkg-a', version: '1.2.3' })
    assert.ok(res.output.includes('；排除条目已登记 pkg-a@1.2.3（created-exact）'), `output 应含登记短语：${res.output}`)
  })

  it('显式 age / strict + young → release-age-wait，installBundle 零调用', async () => {
    const { service, calls } = managerStub()
    const deps = depsFor(service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
      workspacePolicy: () => explicitPolicy(1440),
    })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps),
      (err) => err.code === 'release-age-wait' && err.message.includes('pkg-a@1.2.3') && err.message.includes('未触碰 profile 文件'),
    )
    assert.equal(calls.installBundle.length, 0, '显式策略是真的会拦（NO_MATURE_MATCHING_VERSION）')
    const { service: s2, calls: c2 } = managerStub()
    const deps2 = depsFor(s2, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
      workspacePolicy: () => ({ explicitAge: false, minimumReleaseAgeMin: null, strict: true, excludes: [] }),
    })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps2),
      (err) => err.code === 'release-age-wait',
    )
    assert.equal(c2.installBundle.length, 0)
  })

  it('命中任一排除规则（scoped 与非 scoped 独立精确，首条规则口径）→ 放行委派', async () => {
    const scoped = managerStub()
    const scopedDeps = depsFor(scoped.service, {
      entry: { id: 'plug-scoped', name: 'Scoped', description: '', category: 'tools', tags: [], source: 'npm', npm: '@scope/pkg-a' },
      packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
      workspacePolicy: () => explicitPolicy(1440, ['@scope/pkg-a@1.2.3']),
    })
    const res = await desktopInstallFromRegistry('plug-scoped', {}, { profileDir: 'X:/profile-demo' }, scopedDeps)
    assert.equal(res.spec, '@scope/pkg-a@1.2.3')
    const unscoped = managerStub()
    const unscopedDeps = depsFor(unscoped.service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
      workspacePolicy: () => explicitPolicy(1440, ['pkg-a@1.2.3']),
    })
    await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, unscopedDeps)
    assert.equal(unscoped.calls.installBundle.length, 1)
  })

  it('目标已满期 → 正常委派', async () => {
    const { service, calls } = managerStub()
    const deps = depsFor(service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(25 * 60 * MIN) }),
      workspacePolicy: defaultPolicy,
    })
    const res = await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps)
    assert.equal(res.spec, 'pkg-a@1.2.3')
    assert.equal(calls.installBundle.length, 1)
  })

  it('profileDir 缺席 → 预检与治理跳过（fail-open），照常委派', async () => {
    const { service, calls } = managerStub()
    await desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service))
    assert.equal(calls.installBundle.length, 1)
  })

  it('发布时刻不可得（registry 查询失败）→ fail-open 放行', async () => {
    const { service, calls } = managerStub()
    const deps = depsFor(service, {
      packumentTimes: async () => null,
      workspacePolicy: defaultPolicy,
    })
    await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps)
    assert.equal(calls.installBundle.length, 1)
  })

  it('治理 changed → 委派发生 + output 含治理短语（旧②腿连坐形态由治理修复，不再预拒绝）', async () => {
    const { service, calls } = managerStub()
    const deps = depsFor(service, {
      packumentTimes: async (pkg) => (pkg === 'dsh-m' ? { '0.9.18': isoAgo(24 * MIN) } : { '1.2.3': isoAgo(72 * 60 * MIN) }),
      workspacePolicy: () => explicitPolicy(1440, ['dsh-m@0.9.18']),
      governExclude: async () => ({ ok: true, changed: true, mergedNames: ['dsh-m'] }),
    })
    const res = await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps)
    assert.equal(calls.installBundle.length, 1)
    assert.ok(res.output.includes('；排除条目治理：合并 dsh-m'), `output 应含治理短语：${res.output}`)
  })

  it('治理注入抛错 → fail-open 仍委派', async () => {
    const { service, calls } = managerStub()
    const deps = depsFor(service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(25 * 60 * MIN) }),
      workspacePolicy: defaultPolicy,
      governExclude: async () => {
        throw new Error('disk full')
      },
    })
    await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps)
    assert.equal(calls.installBundle.length, 1)
  })

  it('拒绝路径留痕：显式 age + young + 治理 changed → message 含治理短语', async () => {
    const { service, calls } = managerStub()
    const deps = depsFor(service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
      workspacePolicy: () => explicitPolicy(1440),
      governExclude: async () => ({ ok: true, changed: true, mergedNames: ['dsh-m'] }),
    })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps),
      (err) => err.code === 'release-age-wait' && err.message.includes('排除条目治理：合并 dsh-m'),
    )
    assert.equal(calls.installBundle.length, 0)
  })

  it('双码失败 → 治理 changed → 重试一次成功（恰 2 次委派），output 含治理+登记短语', async () => {
    let attempt = 0
    const { service, calls } = managerStub({
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        attempt += 1
        if (attempt === 1) return { application: 'failed', error: { code: 'operation-error', diagnostic: DUAL } }
        return { changed: true, application: 'applied', stage: 'install', bundle: 'pkg-a', packageResult: { exitCode: 0 } }
      },
    })
    const deps = depsFor(service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(25 * 60 * MIN) }),
      workspacePolicy: defaultPolicy,
      governExclude: async () => ({ ok: true, changed: true, mergedNames: ['dsh-m'] }),
      registerExclude: async () => ({ applied: true, form: 'merged' }),
    })
    const res = await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps)
    assert.equal(calls.installBundle.length, 2, '治理生效后恰好重试一次')
    assert.ok(res.output.includes('；排除条目治理：合并 dsh-m'))
    assert.ok(res.output.includes('；排除条目已登记 pkg-a@1.2.3（merged）'))
  })

  it('双码失败 + 治理无变化 → 不重试，走既有翻译', async () => {
    const { service, calls } = managerStub({
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        return { application: 'failed', error: { code: 'operation-error', diagnostic: DUAL } }
      },
    })
    const deps = depsFor(service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(25 * 60 * MIN) }),
      workspacePolicy: defaultPolicy,
      governExclude: async () => ({ ok: true, changed: false }),
    })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps),
      (err) => err.code === 'release-age-wait' && err.message.includes('可重试'),
    )
    assert.equal(calls.installBundle.length, 1)
  })

  it('两次双码 → 翻译一次，治理短语出现在 message（挂点3 已落盘编辑必须留痕）', async () => {
    let _attempt = 0
    const { service, calls } = managerStub({
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        _attempt += 1
        return { application: 'failed', error: { code: 'operation-error', diagnostic: DUAL } }
      },
    })
    const deps = depsFor(service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(25 * 60 * MIN) }),
      workspacePolicy: defaultPolicy,
      governExclude: async () => ({ ok: true, changed: true, mergedNames: ['dsh-m'] }),
    })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps),
      (err) => err.code === 'release-age-wait' && err.message.includes('排除条目治理：合并 dsh-m') && err.message.includes('可重试'),
    )
    assert.equal(calls.installBundle.length, 2)
  })

  it('cancelled / build-blocked → 不治理重试（闸门层治理照常，installBundle 不二次调用）', async () => {
    let governCalls = 0
    const countingGovern = async () => {
      governCalls += 1
      return { ok: true, changed: true, mergedNames: ['x'] }
    }
    const cancelled = managerStub({ change: { changed: false, application: 'cancelled', stage: 'install' } })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, depsFor(cancelled.service, { governExclude: countingGovern })),
      (err) => err.code === 'install-refused',
    )
    const blocked = managerStub({
      change: { changed: false, application: 'failed', stage: 'install', packageResult: { exitCode: 1, kind: 'build-blocked' }, pendingBuilds: ['pkg-a'] },
    })
    const res = await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, depsFor(blocked.service, { governExclude: countingGovern }))
    assert.equal(res.needsBuildApproval, true)
    // 两例各有 1 次闸门层治理（委派前），挂点3 未触发（installBundle 均无二次调用）
    assert.equal(governCalls, 2)
    assert.equal(cancelled.calls.installBundle.length, 1)
    assert.equal(blocked.calls.installBundle.length, 1)
  })

  it('upgrade 成功 → register 缝收到 previousVersion = target.version', async () => {
    const { service, calls } = managerStub()
    const registered = []
    const deps = {
      getService: () => service,
      loadRegistry: async () => registryWith([ENTRY]),
      listInstalled: async () => ({ items: [{ pkg: 'pkg-a', name: 'Plug A', version: '1.1.0' }] }),
      npmLatest: async () => ({ version: '1.2.3', integrity: 'sha512-x' }),
      precheck: async () => null,
      classifyActivation: async () => 'unknown',
      packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
      workspacePolicy: defaultPolicy,
      registerExclude: async (_profileDir, target) => {
        registered.push(target)
        return { applied: true, form: 'created-composite' }
      },
    }
    const res = await desktopUpgradeFromRegistry('pkg-a', {}, { profileDir: 'X:/profile-demo' }, deps)
    assert.equal(res.fromVersion, '1.1.0')
    assert.deepEqual(registered, [{ pkg: 'pkg-a', version: '1.2.3', previousVersion: '1.1.0' }])
    assert.equal(calls.installBundle.length, 1)
    assert.ok(res.output.includes('；排除条目已登记 pkg-a@1.2.3（created-composite）'))
  })

  it('评审执行轮：hook1 clean + 挂点3 changed（重试成功）→ output 含挂点3 治理短语', async () => {
    let governCalls = 0
    let attempt = 0
    const { service, calls } = managerStub({
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        attempt += 1
        if (attempt === 1) return { application: 'failed', error: { code: 'operation-error', diagnostic: DUAL } }
        return { changed: true, application: 'applied', stage: 'install', bundle: 'pkg-a', packageResult: { exitCode: 0 } }
      },
    })
    const deps = depsFor(service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(25 * 60 * MIN) }),
      workspacePolicy: defaultPolicy,
      governExclude: async () => {
        governCalls += 1
        return governCalls === 1 ? { ok: true, changed: false } : { ok: true, changed: true, mergedNames: ['dsh-m'] }
      },
    })
    const res = await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps)
    assert.equal(calls.installBundle.length, 2)
    assert.equal(governCalls, 2)
    assert.ok(res.output.includes('；排除条目治理：合并 dsh-m'), `挂点3 治理短语应留痕：${res.output}`)
  })

  it('评审执行轮：hook1 clean + 挂点3 changed（重试仍败）→ message 含挂点3 治理短语', async () => {
    let governCalls = 0
    let _attempt = 0
    const { service, calls } = managerStub({
      installBundle: async (spec, options) => {
        calls.installBundle.push({ spec, options })
        _attempt += 1
        return { application: 'failed', error: { code: 'operation-error', diagnostic: DUAL } }
      },
    })
    const deps = depsFor(service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(25 * 60 * MIN) }),
      workspacePolicy: defaultPolicy,
      governExclude: async () => {
        governCalls += 1
        return governCalls === 1 ? { ok: true, changed: false } : { ok: true, changed: true, mergedNames: ['dsh-m'] }
      },
    })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps),
      (err) => err.code === 'release-age-wait' && err.message.includes('排除条目治理：合并 dsh-m'),
    )
    assert.equal(calls.installBundle.length, 2)
  })
})
