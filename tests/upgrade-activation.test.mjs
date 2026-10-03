/**
 * 升级接线 × 生效判定（生效判定 T3/T4 / 0.9.22）：
 * - upgradePlugin（web/CLI 路径）npm 源产出 activation、github 源不产出、分类异常 fail-open unknown
 * - selfUpgrade 不接判定（回归）
 * - desktopUpgradeFromRegistry（desktop 路径）npm 源产出 activation
 * 替身构造沿用 tests/market.test.mjs（fakeDeps/txProfile/mockTxRunner）与 tests/profile-ops.test.mjs（managerStub）。
 * 运行：npm run build && node --test tests/upgrade-activation.test.mjs
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { upgradePlugin, selfUpgrade } from '../lib/core/market.js'
import { desktopUpgradeFromRegistry } from '../lib/core/profile-ops.js'

// 隔离 cacheRoot（registry/latest 缓存不触碰真实 ~/.dsh，同 market.test.mjs 纪律）
const testCacheRoot = mkdtempSync(join(tmpdir(), 'dshm-activation-'))
process.env.DSHM_CACHE_DIR = testCacheRoot
afterEach(() => {})
const cleanup = () => {}

const sha512 = (tag) => `sha512-${tag}${'A'.repeat(20)}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cfg = { timeoutMs: 50 }

function readyLoaded(plugins) {
  return {
    configuredAddress: '', activeAddress: 'https://example.com/r.json', source: 'default-raw',
    status: 'ready', isDefault: true, stale: false, fetchedAt: '2026-10-03T00:00:00.000Z',
    errors: [], count: plugins.length, registry: { version: 1, plugins },
  }
}

function txProfile(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-activation-tx-'))
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

const NPM_ENTRY = { id: 'sa', name: 'SA', description: 'd', category: 'tools', tags: [], source: 'npm', npm: '@scope/pkg-a' }
const GH_ENTRY = { id: 'gh', name: 'GH', description: 'd', category: 'tools', tags: [], source: 'github', github: 'owner/repo' }
const communityDisabled = async () => ({ state: { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] }, catalog: null })

/** npm 源升级的完整替身（转写 market.test.mjs L1719-1756 用例）。 */
function npmUpgradeDeps(overrides = {}) {
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

describe('upgradePlugin × 生效判定（T3）', () => {
  let dir = ''
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = '' } })

  it('npm 源 + classifyActivation=client-only → activation client-only、needsRestart false', async () => {
    const { deps, profileDir } = npmUpgradeDeps({ classifyActivation: async () => 'client-only' })
    dir = profileDir
    const res = await upgradePlugin('@scope/pkg-a', cfg, {}, deps)
    assert.equal(res.version, '2.0.0')
    assert.equal(res.fromVersion, '1.2.3')
    assert.equal(res.activation, 'client-only')
    assert.equal(res.needsRestart, false)
  })

  it('npm 源 + classifyActivation=restart-required → needsRestart true', async () => {
    const { deps, profileDir } = npmUpgradeDeps({ classifyActivation: async () => 'restart-required' })
    dir = profileDir
    const res = await upgradePlugin('@scope/pkg-a', cfg, {}, deps)
    assert.equal(res.activation, 'restart-required')
    assert.equal(res.needsRestart, true)
  })

  it('classifyActivation 抛错 → fail-open unknown、needsRestart true、升级仍成功', async () => {
    const { deps, profileDir } = npmUpgradeDeps({ classifyActivation: async () => { throw new Error('boom') } })
    dir = profileDir
    const res = await upgradePlugin('@scope/pkg-a', cfg, {}, deps)
    assert.equal(res.version, '2.0.0', '升级成功态不受判定失败影响')
    assert.equal(res.activation, 'unknown')
    assert.equal(res.needsRestart, true)
  })

  it('github 源升级：不产出 activation、不调分类器、needsRestart true', async () => {
    const oldSha = 'b'.repeat(40)
    const newSha = 'a'.repeat(40)
    const profileDir = txProfile({
      'package.json': JSON.stringify({ name: 'p', private: true, dependencies: { 'owner-repo': `github:owner/repo#${oldSha}` } }, null, 2) + '\n',
      // lock 键写成无冒号形态（lockResolutionOf 的键捕获在首个冒号处截断，带 github: 的键匹配不到）
      'pnpm-lock.yaml': `lockfileVersion: '9.0'\n\npackages:\n  'owner-repo@${oldSha}':\n    commit: ${oldSha}\n    resolution: {tarball: owner/repo/${oldSha}}\n`,
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    dir = profileDir
    let classifyCalls = 0
    const { runner } = mockTxRunner({
      add: [async () => {
        writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { 'owner-repo': `github:owner/repo#${newSha}` } }, null, 2) + '\n')
        writeInstalledMarkerPkg(profileDir, 'owner-repo')
        return { class: 'ok', output: 'add-ok', buildApprovals: [], fallbackAllBuilds: false }
      }],
    }, profileDir)
    const deps = {
      loadRegistry: async () => readyLoaded([GH_ENTRY]),
      listInstalledPlugins: async () => ({ items: [{ pkg: 'owner-repo', name: 'owner-repo', version: '9.9.9', source: 'github', spec: `github:owner/repo#${oldSha}` }], others: 0, complete: true, profileDir }),
      githubLatestTag: async () => ({ tag: 'v1.0.0', sha: newSha }),
      candidateKey: async () => 'owner-repo',
      precheck: async () => null,
      fetchCommunityCatalog: communityDisabled,
      transaction: { runner: () => runner, profileDir },
      classifyActivation: async () => { classifyCalls += 1; return 'client-only' },
    }
    const res = await upgradePlugin('owner-repo', cfg, {}, deps)
    assert.equal(res.needsRestart, true)
    assert.equal('activation' in res, false)
    assert.equal(classifyCalls, 0)
  })

  it('selfUpgrade 回归：不产出 activation、needsRestart true', async () => {
    const profileDir = txProfile({
      'package.json': JSON.stringify({ name: 'p', private: true, dependencies: { 'dsh-m-like': '1.0.0' } }, null, 2) + '\n',
      'pnpm-lock.yaml': `lockfileVersion: '9.0'\n\npackages:\n  'dsh-m-like@2.0.0':\n    resolution: {integrity: ${sha512('good')}}\n`,
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    dir = profileDir
    const { runner } = mockTxRunner({
      add: [async () => {
        writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { 'dsh-m-like': '2.0.0' } }, null, 2) + '\n')
        writeInstalledMarkerPkg(profileDir, 'dsh-m-like')
        return { class: 'ok', output: 'add-ok', buildApprovals: [], fallbackAllBuilds: false }
      }],
    }, profileDir)
    const res = await selfUpgrade('dsh-m-like', '1.0.0', cfg, {}, {
      npmLatest: async () => ({ version: '2.0.0', integrity: sha512('good') }),
      transaction: { runner: () => runner, profileDir },
    })
    assert.equal(res.needsRestart, true)
    assert.equal('activation' in res, false)
  })
})

describe('desktopUpgradeFromRegistry × 生效判定（T4）', () => {
  let dir = ''
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = '' } })

  function desktopDeps(overrides = {}) {
    const profileDir = txProfile({})
    const manager = {
      installBundle: async () => ({ application: 'applied', bundle: '@scope/pkg-a' }),
      listBundles: async () => [{ name: '@scope/pkg-a', installed: true }],
    }
    const deps = {
      getService: () => manager,
      loadRegistry: async () => readyLoaded([NPM_ENTRY]),
      listInstalled: async () => ({ items: [{ pkg: '@scope/pkg-a', name: '@scope/pkg-a', version: '1.2.3', source: 'npm', spec: '@scope/pkg-a@1.2.3' }], others: 0, complete: true, profileDir }),
      npmLatest: async () => ({ version: '2.0.0', integrity: sha512('good') }),
      precheck: async () => null,
      packumentTimes: async () => ({}),
      fetchCommunityCatalog: communityDisabled,
      ...overrides,
    }
    return { deps, profileDir }
  }

  it('npm 源 + client-only → activation client-only、needsRestart false', async () => {
    const { deps, profileDir } = desktopDeps({ classifyActivation: async () => 'client-only' })
    dir = profileDir
    const res = await desktopUpgradeFromRegistry('@scope/pkg-a', cfg, { profile: 'desktop', profileDir }, deps)
    assert.ok(!res.ok, '不应落入 needsBuildApproval 失败臂')
    assert.equal(res.activation, 'client-only')
    assert.equal(res.needsRestart, false)
  })

  it('classifyActivation 抛错 → unknown、needsRestart true', async () => {
    const { deps, profileDir } = desktopDeps({ classifyActivation: async () => { throw new Error('boom') } })
    dir = profileDir
    const res = await desktopUpgradeFromRegistry('@scope/pkg-a', cfg, { profile: 'desktop', profileDir }, deps)
    assert.ok(!res.ok, '不应落入 needsBuildApproval 失败臂')
    assert.equal(res.activation, 'unknown')
    assert.equal(res.needsRestart, true)
  })
})
