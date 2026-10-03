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
  DesktopOpsError,
  _setEnableRetryDelayForTests,
} from '../lib/core/profile-ops.js'
import { _resetReleaseAgeCachesForTests } from '../lib/core/release-age.js'
import { ToggleError } from '../lib/core/toggle.js'
import { IncompatibleError } from '../lib/core/compat-check.js'

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

  it('非收录插件（主清单与社区目录都 miss）→ install-refused', async () => {
    const { service } = managerStub()
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-foreign', {}, {}, upgradeDeps(service, { installed: [{ pkg: 'pkg-foreign', name: 'F', version: '1.0.0' }] })),
      (err) => err instanceof DesktopOpsError && err.code === 'install-refused' && /收录/.test(err.message),
    )
  })

  it('收录清单不可用 → install-refused', async () => {
    const { service } = managerStub()
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-a', {}, {}, upgradeDeps(service, { loadRegistry: async () => ({ ...registryWith([]), status: 'unavailable' }) })),
      (err) => err instanceof DesktopOpsError && err.code === 'install-refused' && /不可用/.test(err.message),
    )
  })

  it('no-manager（同步与 ensure 均无）→ no-manager', async () => {
    await assert.rejects(
      () => desktopUpgradeFromRegistry('pkg-a', {}, {}, upgradeDeps(undefined, { deps: { ensureService: async () => undefined } })),
      (err) => err instanceof DesktopOpsError && err.code === 'no-manager',
    )
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

describe('0.9.19 供应链等待期委派前预检（releaseAgePrecheck 接线）', () => {
  const MIN = 60_000
  const isoAgo = (ms) => new Date(Date.now() - ms).toISOString()

  beforeEach(_resetReleaseAgeCachesForTests)

  it('目标版本未满等待期 → 委派前 release-age-wait，installBundle 零调用（该挡的挡在门外）', async () => {
    const { service, calls } = managerStub()
    const deps = depsFor(service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
      workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: [] }),
    })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps),
      (err) => err.code === 'release-age-wait' && err.message.includes('pkg-a@1.2.3'),
    )
    assert.equal(calls.installBundle.length, 0, '未委派官方管理器（避免半写 node_modules 的账实分裂）')
  })

  it('目标已满期 → 正常委派', async () => {
    const { service, calls } = managerStub()
    const deps = depsFor(service, {
      packumentTimes: async () => ({ '1.2.3': isoAgo(25 * 60 * MIN) }),
      workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: [] }),
    })
    const res = await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps)
    assert.equal(res.spec, 'pkg-a@1.2.3')
    assert.equal(calls.installBundle.length, 1)
  })

  it('scoped 独立精确排除条目视为有效覆盖（本机 quota-watch@0.1.13 实证）→ 放行', async () => {
    const { service, calls } = managerStub()
    const deps = depsFor(service, {
      entry: { id: 'plug-scoped', name: 'Scoped', description: '', category: 'tools', tags: [], source: 'npm', npm: '@scope/pkg-a' },
      packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
      workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: ['@scope/pkg-a@1.2.3'] }),
    })
    const res = await desktopInstallFromRegistry('plug-scoped', {}, { profileDir: 'X:/profile-demo' }, deps)
    assert.equal(res.spec, '@scope/pkg-a@1.2.3')
    assert.equal(calls.installBundle.length, 1)
  })

  it('目标已满期但锁内非 scoped 独立精确条目未满期 → 拦（dsh-m@0.9.18 连坐形态实证）', async () => {
    const { service, calls } = managerStub()
    const deps = depsFor(service, {
      packumentTimes: async (pkg) => (pkg === 'dsh-m'
        ? { '0.9.18': isoAgo(24 * MIN) }
        : { '1.2.3': isoAgo(72 * 60 * MIN) }),
      workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: ['dsh-m@0.9.18'] }),
    })
    await assert.rejects(
      () => desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps),
      (err) => err.code === 'release-age-wait' && err.message.includes('dsh-m@0.9.18') && err.message.includes('锁内排除条目'),
    )
    assert.equal(calls.installBundle.length, 0)
  })

  it('profileDir 缺席 → 预检跳过（fail-open），照常委派', async () => {
    const { service, calls } = managerStub()
    await desktopInstallFromRegistry('plug-a', {}, {}, depsFor(service))
    assert.equal(calls.installBundle.length, 1)
  })

  it('发布时刻不可得（registry 查询失败）→ fail-open 放行', async () => {
    const { service, calls } = managerStub()
    const deps = depsFor(service, {
      packumentTimes: async () => null,
      workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: [] }),
    })
    await desktopInstallFromRegistry('plug-a', {}, { profileDir: 'X:/profile-demo' }, deps)
    assert.equal(calls.installBundle.length, 1)
  })
})
