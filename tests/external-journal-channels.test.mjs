/**
 * Task 3（外部操作记录，ADR-0018）：通道插桩单测——
 * ① cli 通道 upgrade 成功恰一条；② host-tool 通道；③ panel 通道零记录；
 * ④ upgrade 失败 → 恰一条 failed（reason ≤300）；⑤ desktopToggle 嵌套 togglePlugin 单条不双记；
 * ⑥ desktop 三入口各自记单条（desktop-* kind）；⑦ append 注入抛错 → 操作仍 ok、调用方无感；
 * ⑧ selfUpgrade 经 panel 零记录。
 * 替身构造沿用 tests/upgrade-activation.test.mjs（mockTxRunner/readyLoaded）与
 * tests/profile-ops.test.mjs（managerStub）、tests/toggle.test.mjs（serviceStub + installFixture）。
 * 运行：npm run build && node --test tests/external-journal-channels.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installFromRegistry, upgradePlugin, selfUpgrade } from '../lib/core/market-mutation.js'
import '../lib/core/toggle.js';
import { desktopInstallFromRegistry, desktopToggle, desktopUninstall, desktopUpgradeFromRegistry } from '../lib/core/profile-ops.js'
import { listExternalOperations, journalFile } from '../lib/core/external-journal.js'
import { _resetMergedMarketForTests } from '../lib/core/merged-market.js'

// 隔离 cacheRoot（registry/latest 缓存不触碰真实 ~/.dsh，同 market.test.mjs 纪律）
process.env.DSHM_CACHE_DIR = mkdtempSync(join(tmpdir(), 'dshm-extchan-cache-'))

let journalPath = ''
let journalDir = ''
beforeEach(() => {
  _resetMergedMarketForTests()
  journalDir = mkdtempSync(join(tmpdir(), 'dshm-extchan-'))
  journalPath = join(journalDir, 'external-operations.json')
  process.env.DSHM_EXTERNAL_JOURNAL_FILE = journalPath
})
afterEach(() => {
  rmSync(journalDir, { recursive: true, force: true })
  delete process.env.DSHM_EXTERNAL_JOURNAL_FILE
})

const sha512 = (tag) => `sha512-${tag}${'A'.repeat(20)}`
const cfg = { timeoutMs: 50 }

const NPM_ENTRY = { id: 'sa', name: 'SA', description: 'd', category: 'tools', tags: [], source: 'npm', npm: '@scope/pkg-a' }

function readyLoaded(plugins) {
  return {
    configuredAddress: '', activeAddress: 'https://example.com/r.json', source: 'default-raw',
    status: 'ready', isDefault: true, stale: false, fetchedAt: '2026-10-03T00:00:00.000Z',
    errors: [], count: plugins.length, registry: { version: 1, plugins },
  }
}

function txProfile(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-extchan-tx-'))
  for (const [name, content] of Object.entries(files || {})) writeFileSync(join(dir, name), content)
  return dir
}

function writeInstalledMarkerPkg(profileDir, pkg) {
  const pkgDir = join(profileDir, 'node_modules', ...pkg.split('/'))
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version: '9.9.9', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(pkgDir, 'index.js'), 'module.exports = {}\n')
}

function mockTxRunner(script = {}, profileDir = null) {
  const calls = { add: [], remove: [], frozen: [], rebuild: [] }
  const op = (name) => async (arg, signal) => {
    calls[name].push({ arg, signal })
    if (name === 'add' && profileDir) {
      const spec = String(arg || '')
      const pkg = spec.startsWith('github:') ? (spec.slice(7).split('#')[0].split('/')[1]) : (spec.split('@').slice(0, -1).join('@') || spec)
      if (pkg) writeInstalledMarkerPkg(profileDir, pkg)
    }
    const seq = script[name] || []
    const step = seq[Math.min(calls[name].length - 1, seq.length - 1)]
    if (!step) return { class: 'ok', output: `${name}-ok` }
    return step(arg, signal, calls[name].length)
  }
  return { runner: { add: op('add'), remove: op('remove'), frozenInstall: op('frozen'), rebuildInstall: op('rebuild') }, calls }
}

const communityDisabled = async () => ({ state: { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] }, catalog: null })

/** npm 源升级/安装的完整替身（转写 upgrade-activation npmUpgradeDeps）。 */
function npmDeps(overrides = {}) {
  const profileDir = txProfile({
    'package.json': JSON.stringify({ name: 'p', private: true, dependencies: { '@scope/pkg-a': '1.2.3' } }, null, 2) + '\n',
    'pnpm-lock.yaml': `lockfileVersion: '9.0'\n\npackages:\n  '@scope/pkg-a@1.2.3':\n    resolution: {integrity: ${sha512('old')}}\n`,
    'pnpm-workspace.yaml': 'packages:\n  - .\n',
  })
  const { runner } = mockTxRunner({
    add: [async () => {
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { '@scope/pkg-a': '2.0.0' } }, null, 2) + '\n')
      writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\n\npackages:\n  '@scope/pkg-a@2.0.0':\n    resolution: {integrity: ${sha512('good')}}\n`)
      writeInstalledMarkerPkg(profileDir, '@scope/pkg-a')
      return { class: 'ok', output: 'add-ok', buildApprovals: [], fallbackAllBuilds: false }
    }],
  }, profileDir)
  const deps = {
    loadRegistry: async () => readyLoaded([NPM_ENTRY]),
    listInstalledPlugins: async () => ({ items: [{ pkg: '@scope/pkg-a', name: '@scope/pkg-a', version: '1.2.3', source: 'npm', spec: '@scope/pkg-a@1.2.3' }], others: 0, complete: true, profileDir }),
    npmLatest: async () => ({ version: '2.0.0', integrity: sha512('good') }),
    precheck: async () => null,
    fetchCommunityCatalog: communityDisabled,
    transaction: { runner: () => runner, profileDir },
    ...overrides,
  }
  return { deps, profileDir }
}

// ---------- toggle 替身（转写 toggle.test.mjs） ----------

let toggleDir = ''
function installFixture(pkg) {
  writeFileSync(
    join(toggleDir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-web', private: true, dependencies: { [pkg]: '1.0.0' } }),
  )
  const pkgDir = join(toggleDir, 'node_modules', pkg)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version: '1.0.0', dsh: {} }))
  writeFileSync(join(pkgDir, 'cordis.patch.yml'), '- insert: [{id: demo-row, name: demo-pkg}]\n')
}

// ---------- desktop 替身（转写 profile-ops managerStub / upgrade-activation desktopDeps） ----------

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

function desktopInstallDeps(service, overrides = {}) {
  return {
    getService: () => service,
    resolveEntry: overrides.resolveEntry ?? (async () => overrides.entry ?? NPM_ENTRY),
    npmLatest: overrides.npmLatest ?? (async () => ({ version: '1.2.3', integrity: 'sha512-x', tarball: 'https://example.com/pkg-a.tgz' })),
    precheck: overrides.precheck ?? (async () => null),
    appendExternalOperation: overrides.appendExternalOperation,
  }
}

function desktopUpgradeDeps(service, overrides = {}) {
  const profileDir = txProfile({})
  return {
    service,
    profileDir,
    deps: {
      getService: () => service,
      loadRegistry: async () => readyLoaded([NPM_ENTRY]),
      listInstalled: async () => ({ items: [{ pkg: '@scope/pkg-a', name: '@scope/pkg-a', version: '1.2.3', source: 'npm', spec: '@scope/pkg-a@1.2.3' }], others: 0, complete: true, profileDir }),
      npmLatest: async () => ({ version: '2.0.0', integrity: sha512('good') }),
      precheck: async () => null,
      packumentTimes: async () => ({}),
      fetchCommunityCatalog: communityDisabled,
      appendExternalOperation: overrides.appendExternalOperation,
    },
  }
}

const dirs = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true })
  toggleDir = ''
})

describe('外部操作直落 × 通道插桩（Task 3）', () => {
  it('① cli 通道 upgrade 成功 → 恰一条 {channel:cli, kind:upgrade, result:ok, from/to}', async () => {
    const { deps } = npmDeps()
    dirs.push(deps.transaction.profileDir)
    const res = await upgradePlugin('@scope/pkg-a', cfg, { channel: 'cli' }, deps)
    assert.equal(res.version, '2.0.0')
    const list = await listExternalOperations()
    assert.equal(list.length, 1, `应恰一条外部记录，实际 ${list.length}`)
    const r = list[0]
    assert.equal(r.channel, 'cli')
    assert.equal(r.kind, 'upgrade')
    assert.equal(r.result, 'ok')
    assert.equal(r.target, '@scope/pkg-a')
    assert.equal(r.fromVersion, '1.2.3')
    assert.equal(r.toVersion, '2.0.0')
    assert.equal(journalFile(), journalPath)
  })

  it('② host-tool 通道 install 成功 → channel:host-tool、kind:install、target=收录 id', async () => {
    const { deps } = npmDeps()
    dirs.push(deps.transaction.profileDir)
    const res = await installFromRegistry('sa', cfg, { channel: 'host-tool' }, deps)
    assert.equal(res.version, '2.0.0')
    const list = await listExternalOperations()
    assert.equal(list.length, 1)
    assert.equal(list[0].channel, 'host-tool')
    assert.equal(list[0].kind, 'install')
    assert.equal(list[0].target, 'sa')
    assert.equal(list[0].toVersion, '2.0.0')
  })

  it('③ panel 通道 upgrade 成功 → 零记录', async () => {
    const { deps } = npmDeps()
    dirs.push(deps.transaction.profileDir)
    await upgradePlugin('@scope/pkg-a', cfg, { channel: 'panel' }, deps)
    assert.deepEqual(await listExternalOperations(), [])
  })

  it('④ upgrade 抛错 → 恰一条 failed 带原因，且 reason ≤300', async () => {
    const { deps } = npmDeps({
      loadRegistry: async () => { throw new Error('x'.repeat(500)) },
    })
    dirs.push(deps.transaction.profileDir)
    await assert.rejects(() => upgradePlugin('@scope/pkg-a', cfg, { channel: 'cli' }, deps), /x{50}/)
    const list = await listExternalOperations()
    assert.equal(list.length, 1)
    assert.equal(list[0].result, 'failed')
    assert.equal(list[0].channel, 'cli')
    assert.equal(list[0].kind, 'upgrade')
    assert.ok(list[0].reason && list[0].reason.length === 300, 'reason 必须被截断至 300 字符')
  })

  it('⑤ desktopToggle 嵌套 togglePlugin → 恰一条（不双记，kind 用透传方的 toggle）', async () => {
    toggleDir = mkdtempSync(join(tmpdir(), 'dshm-extchan-tgl-'))
    dirs.push(toggleDir)
    installFixture('demo-pkg')
    // 有状态官方服务模拟器（转写 toggle.test.mjs mkService）：退选后 listPlugins 不再列出 → 复读 live
    const rows = [{ entryId: 'demo-row', moduleName: 'demo-pkg', enabled: true }]
    let bundleOn = true
    const service = {
      async listPlugins() {
        return bundleOn ? rows.map((r) => ({ ...r })) : []
      },
      async setPluginEnabled(id, enabled) {
        const row = rows.find((r) => r.entryId === id)
        if (row) row.enabled = enabled
        return { application: 'applied' }
      },
      async setBundleEnabled(name, enabled) {
        bundleOn = enabled
        return { application: 'applied' }
      },
    }
    const res = await desktopToggle('demo-pkg', false, { getService: () => service, profileDir: toggleDir, channel: 'cli' })
    assert.equal(res.applied, 'live')
    const list = await listExternalOperations()
    assert.equal(list.length, 1, `嵌套对必须只记一条，实际 ${list.length}`)
    assert.equal(list[0].kind, 'toggle')
    assert.equal(list[0].channel, 'cli')
    assert.equal(list[0].target, 'demo-pkg')
  })

  it('⑥ desktop 三入口各自记单条（desktop-* kind，channel 按 caller）', async () => {
    // desktop-install（host-tool）
    const install = managerStub()
    const resI = await desktopInstallFromRegistry('plug-a', cfg, { channel: 'host-tool' }, desktopInstallDeps(install.service))
    assert.ok(!resI.ok)
    // desktop-uninstall（cli）
    const un = managerStub({ bundles: [{ name: 'pkg-a', installed: false }] })
    const resU = await desktopUninstall('pkg-a', { getService: () => un.service, channel: 'cli' })
    assert.equal(resU.via, 'desktop-manager')
    // desktop-upgrade（host-tool）
    const up = desktopUpgradeDeps(managerStub().service)
    dirs.push(up.profileDir)
    const resUp = await desktopUpgradeFromRegistry('@scope/pkg-a', cfg, { profile: 'desktop', profileDir: up.profileDir, channel: 'host-tool' }, up.deps)
    assert.ok(!resUp.ok)

    const list = await listExternalOperations()
    assert.equal(list.length, 3, `三入口各一条，实际 ${list.length}: ${JSON.stringify(list)}`)
    const byKind = Object.fromEntries(list.map((r) => [r.kind, r]))
    assert.equal(byKind['desktop-install'].channel, 'host-tool')
    assert.equal(byKind['desktop-install'].target, 'plug-a')
    assert.equal(byKind['desktop-install'].toVersion, '1.2.3')
    assert.equal(byKind['desktop-uninstall'].channel, 'cli')
    assert.equal(byKind['desktop-uninstall'].target, 'pkg-a')
    assert.equal(byKind['desktop-upgrade'].channel, 'host-tool')
    assert.equal(byKind['desktop-upgrade'].fromVersion, '1.2.3')
    assert.equal(byKind['desktop-upgrade'].toVersion, '2.0.0')
  })

  it('⑦ append 注入抛错 → 操作仍 ok 返回、journal 原样、调用方无感', async () => {
    const { deps } = npmDeps({
      appendExternalOperation: async () => { throw new Error('disk full') },
    })
    dirs.push(deps.transaction.profileDir)
    const res = await upgradePlugin('@scope/pkg-a', cfg, { channel: 'cli' }, deps)
    assert.equal(res.version, '2.0.0', 'append 失败绝不反噬操作终态')
    assert.deepEqual(await listExternalOperations(), [], 'journal 保持原样')
  })

  it('⑧ selfUpgrade 经 panel 通道 → 零记录（契约就绪断言）', async () => {
    const profileDir = txProfile({
      'package.json': JSON.stringify({ name: 'p', private: true, dependencies: { 'dsh-m-like': '1.0.0' } }, null, 2) + '\n',
      'pnpm-lock.yaml': `lockfileVersion: '9.0'\n\npackages:\n  'dsh-m-like@2.0.0':\n    resolution: {integrity: ${sha512('good')}}\n`,
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    dirs.push(profileDir)
    const { runner } = mockTxRunner({
      add: [async () => {
        writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { 'dsh-m-like': '2.0.0' } }, null, 2) + '\n')
        writeInstalledMarkerPkg(profileDir, 'dsh-m-like')
        return { class: 'ok', output: 'add-ok', buildApprovals: [], fallbackAllBuilds: false }
      }],
    }, profileDir)
    const res = await selfUpgrade('dsh-m-like', '1.0.0', cfg, { channel: 'panel' }, {
      npmLatest: async () => ({ version: '2.0.0', integrity: sha512('good') }),
      transaction: { runner: () => runner, profileDir },
    })
    assert.equal(res.version, '2.0.0')
    assert.deepEqual(await listExternalOperations(), [])
  })
})
