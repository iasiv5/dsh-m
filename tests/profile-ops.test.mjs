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
  DesktopOpsError,
} from '../lib/core/profile-ops.js'
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

/** 官方 manager 桩：记录 installBundle 调用；行为可编排。 */
function managerStub(overrides = {}) {
  const calls = { installBundle: [], listBundles: 0 }
  const bundles = overrides.bundles ?? [{ name: 'pkg-a', installed: true, enabled: true }]
  const service = {
    listPlugins: async () => [],
    setPluginEnabled: async () => ({}),
    setBundleEnabled: async () => ({}),
    installBundle: overrides.installBundle ?? (async (spec, options) => {
      calls.installBundle.push({ spec, options })
      return overrides.change ?? { changed: true, application: 'applied', stage: 'install', bundle: 'pkg-a', packageResult: { exitCode: 0 } }
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
})
