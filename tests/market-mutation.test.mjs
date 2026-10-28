/**
 * 市场变更编排（market-mutation）写侧测试：安装/卸载/升级/自升级、守卫接线与
 * mutation session、prior 快照、mutation → latest 缓存定向失效。
 * 自 market.test.mjs 整块迁出（ADR-0024 分册），夹具独立、可独立运行。
 * 运行：npm run build && node --test tests/market-mutation.test.mjs
 */
import { describe, it, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listMarket, listInstalledWithMeta, existingMarketIds } from '../lib/core/market.js'
import { installFromRegistry, upgradePlugin, uninstallPlugin, capturePreMutationState, derivePrior, withMutationSession, selfUpgrade, synthesizeInstallableEntry, UpgradePathUnsupportedError } from '../lib/core/market-mutation.js'
import { communityOutcome, _resetMergedMarketForTests, _mergedMarketStatsForTests } from '../lib/core/merged-market.js'
import { IncompatibleError } from '../lib/core/compat-check.js'
import { latestCacheKey, readLatestCache, writeLatestCache, resetLatestCacheForTest } from '../lib/core/latest-cache.js'
import { _setProjectionIoForTests } from '../lib/core/generation-projection.js'
// R1-1：L2 物化代跨用例隔离（fixture 假身份可能同键；node --test 文件内共享模块状态）
beforeEach(() => _resetMergedMarketForTests())

// 0.9.14 Task 4b：latest 落盘接线后，listMarket/listInstalledWithMeta 会读写真实 cacheRoot——
// 全文件统一隔离到临时目录（评审 R1-#4：本文件原先零 DSHM_CACHE_DIR，不补则触碰真实 ~/.dsh）。
// 0.9.79：直调变更入口的用例会以 'external' 兜底通道落外部操作日志——同款纪律隔离 journal。
const marketTestCacheRoot = mkdtempSync(join(tmpdir(), 'dshm-market-'))
process.env.DSHM_CACHE_DIR = marketTestCacheRoot
process.env.DSHM_EXTERNAL_JOURNAL_FILE = join(marketTestCacheRoot, 'external-operations.json')
after(() => {
  delete process.env.DSHM_CACHE_DIR
  delete process.env.DSHM_EXTERNAL_JOURNAL_FILE
  rmSync(marketTestCacheRoot, { recursive: true, force: true })
})

const CATEGORIES = ['market', 'tools', 'ui', 'search', 'other']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeThousand() {
  return Array.from({ length: 1000 }, (_, i) => ({
    id: `p-${i}`,
    name: `P${i}`,
    description: `d${i}`,
    category: CATEGORIES[i % 5],
    tags: [],
    source: 'npm',
    npm: `pkg-${i}`,
  }))
}

function readyLoaded(plugins, overrides = {}) {
  return {
    configuredAddress: '',
    activeAddress: 'https://example.com/r.json',
    source: 'default-raw',
    status: 'ready',
    isDefault: true,
    stale: false,
    fetchedAt: '2026-09-04T00:00:00.000Z',
    errors: [],
    count: plugins.length,
    registry: { version: 1, plugins },
    ...overrides,
  }
}

function unavailableLoaded(configuredAddress = '') {
  return {
    configuredAddress,
    activeAddress: null,
    source: configuredAddress ? 'custom-unavailable' : 'default-cache',
    status: 'unavailable',
    isDefault: configuredAddress === '',
    stale: false,
    fetchedAt: null,
    errors: ['unavailable'],
    count: 0,
    registry: { version: 1, plugins: [] },
  }
}

let fakeSeq = 0
function fakeDeps(overrides = {}) {
  // 每个实例唯一的 registry 身份：隔离模块级 latest cache，避免跨测试污染
  const registryId = `reg-${++fakeSeq}`
  const calls = { loadRegistry: [], npm: [], github: [], listInstalled: 0 }
  let inFlight = 0
  let maxInFlight = 0
  const deps = {
    loadRegistry: async (cfg, opts) => {
      calls.loadRegistry.push(opts ?? null)
      return readyLoaded(makeThousand(), { configuredAddress: registryId })
    },
    listInstalledPlugins: async () => {
      calls.listInstalled += 1
      return { items: [], others: 0, complete: true, profileDir: '/tmp/profile' }
    },
    npmLatest: async (pkg) => {
      calls.npm.push(pkg)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await sleep(2)
      inFlight -= 1
      return { version: '2.0.0', integrity: 'sha512-x', tarball: `https://example.com/${pkg}.tgz` }
    },
    githubLatestTag: async (repo) => {
      calls.github.push(repo)
      return { tag: 'v1.0.0', sha: 'a'.repeat(40) }
    },
    // 默认 disabled 社区 loader：既有用例语义与 0.4.x（无社区层）一致；社区用例经 withCommunity 覆盖
    fetchCommunityCatalog: async () => ({
      state: {
        enabled: false, status: 'disabled', version: null, checkedAt: null,
        fetchedAt: null, route: null, count: 0, errors: [], warnings: [],
      },
      catalog: null,
    }),
  }
  return { deps: { ...deps, ...overrides }, calls, maxInFlight: () => maxInFlight }
}

const cfg = { timeoutMs: 50 }


describe('install/upgrade：unavailable 抛业务错误', () => {
  it('installFromRegistry unavailable 时业务报错而不是 TypeError', async () => {
    const { deps } = fakeDeps({
      loadRegistry: async () => unavailableLoaded(),
    })
    await assert.rejects(
      () => installFromRegistry('p-1', cfg, {}, deps),
      (err) => err instanceof Error && /不可用/.test(err.message),
    )
  })

  // ADR-0026 改写：原「upgradePlugin unavailable 时业务报错」钉的是收录硬阻断——升级已与收录
  // 解耦，unavailable 不再硬抛；新语义用例整体迁至下方 ADR-0026 describe（unavailable → 合成条目
  // 升级成功）。installFromRegistry 的 unavailable 硬抛保留（安装仍收录门禁，B5）。
})

// ---------- Task 3：npm 分支事务桥接 ----------

const sha512 = (tag) => `sha512-${tag}${'A'.repeat(20)}`

function txProfile(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-txbridge-'))
  for (const [name, content] of Object.entries(files || {})) writeFileSync(join(dir, name), content)
  return dir
}

function txRegistryDeps(entry, npmLatestResult) {
  return {
    loadRegistry: async () => ({
      configuredAddress: '', activeAddress: null, source: 'default-raw', status: 'ready',
      isDefault: true, stale: false, fetchedAt: null, errors: [], count: 1,
      registry: { version: 1, plugins: [entry] },
    }),
    npmLatest: async () => npmLatestResult,
    precheck: async () => null, // 预检桩：兼容（不打网络）
  }
}

const TX_ENTRY = { id: 'p', name: 'P', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'pkg-a' }
const LOCK_GOOD = `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      pkg-a:
        specifier: 1.2.3
        version: 1.2.3

packages:
  pkg-a@1.2.3:
    resolution: {integrity: ${sha512('good')}}
`

/** M2 Task 3：写入最小 marker 包（守卫三项检查的最小通过形态：dsh 键 + main 入口 + patch 文件）。 */
function writeInstalledMarkerPkg(profileDir, pkg) {
  // marker = package.json 的 dsh 键（不写 cordis.patch.yml——保留 bundleWarning/no-patch-layer 语义，
  // 且 loader id 集合贡献为空，不干扰冲突判定）
  const pkgDir = join(profileDir, 'node_modules', ...pkg.split('/'))
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version: '9.9.9', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(pkgDir, 'index.js'), 'module.exports = {}\n')
}

/** 记录调用的 mock PnpmRunner（四操作俱全，永不 spawn）。 */
function mockTxRunner(script = {}, profileDir = null) {
  const calls = { add: [], remove: [], frozen: [], rebuild: [] }
  const op = (name) => async (arg, signal) => {
    calls[name].push({ arg, signal })
    // M2 Task 3：add 成功后写最小 marker 包（装后守卫三项检查需要真实包内容）
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

describe('installEntry npm 分支：事务注入（Task 9 起生产原生形态）', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  it('事务注入①：仅注入查询类依赖 + transaction.runner → 全部操作落在注入 runner（零真实 spawn）', async () => {
    dir = txProfile({
      'package.json': JSON.stringify({ dependencies: { existing: '^1.0.0' } }, null, 2) + '\n',
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    assert.ok(dir.startsWith(tmpdir()), 'transaction.profileDir 必须位于 os.tmpdir() 下')
    const tx = mockTxRunner({
      add: [async () => {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }, null, 2) + '\n')
        writeFileSync(join(dir, 'pnpm-lock.yaml'), LOCK_GOOD)
        return { class: 'ok', output: 'added-via-tx-runner', buildApprovals: [], fallbackAllBuilds: false }
      }],
    }, dir)
    const res = await installFromRegistry('p', {}, {}, {
      ...txRegistryDeps(TX_ENTRY, { version: '1.2.3', integrity: sha512('good') }),
      transaction: { runner: () => tx.runner, profileDir: dir },
    })
    assert.equal(res.version, '1.2.3')
    assert.equal(res.pkg, 'pkg-a')
    assert.equal(res.spec, 'pkg-a@1.2.3')
    assert.deepEqual(res.buildApprovals, [])
    assert.equal(res.fallbackAllBuilds, false)
    assert.deepEqual(tx.calls.add, [{ arg: 'pkg-a@1.2.3', signal: undefined }], 'add 落在注入 runner')
    assert.equal(tx.calls.frozen.length, 0, 'committed 且无 B1 时不跑 frozen')
    assert.equal(tx.calls.remove.length, 0)
  })

  it('事务注入②：github 分支同样委派 transaction.runner', async () => {
    dir = txProfile({
      'package.json': JSON.stringify({ dependencies: { existing: '^1.0.0' } }, null, 2) + '\n',
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const tx = mockTxRunner({
      add: [async () => {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { existing: '^1.0.0', 'owner-repo': `github:owner/repo#${'a'.repeat(40)}` } }, null, 2) + '\n')
        writeInstalledMarkerPkg(dir, 'owner-repo')
        return { class: 'ok', output: 'gh-added', buildApprovals: [], fallbackAllBuilds: false }
      }],
    }, dir)
    const res = await installFromRegistry('p', {}, {}, {
      loadRegistry: async () => ({
        configuredAddress: '', activeAddress: null, source: 'default-raw', status: 'ready',
        isDefault: true, stale: false, fetchedAt: null, errors: [], count: 1,
        registry: {
          version: 1,
          plugins: [{ id: 'p', name: 'P', description: 'd', category: 'tools', tags: [], source: 'github', github: 'owner/repo' }],
        },
      }),
      githubLatestTag: async () => ({ tag: 'v2.0.0', sha: 'a'.repeat(40) }),
      candidateKey: async () => 'owner-repo',
      transaction: { runner: () => tx.runner, profileDir: dir },
    })
    assert.equal(res.sha, 'a'.repeat(40))
    assert.equal(res.tag, 'v2.0.0')
    assert.equal(res.pkg, 'owner-repo')
    assert.deepEqual(tx.calls.add, [{ arg: `github:owner/repo#${'a'.repeat(40)}`, signal: undefined }])
  })
})

describe('0.4.0：兼容预检门 / 卸载保护门 / 结果透传（Tasks 11-13）', () => {
  const installed = {
    items: [{
      pkg: 'pkg-1',
      name: 'P1',
      version: '1.0.0',
      description: '',
      homepage: '',
      spec: '1.0.0',
      source: 'npm',
      dsh: true,
      path: '/tmp/node_modules/pkg-1',
    }, {
      pkg: 'dsh-m',
      name: 'dshm',
      version: '0.4.0',
      description: '',
      homepage: '',
      spec: '0.4.0',
      source: 'npm',
      dsh: true,
      path: '/tmp/node_modules/dsh-m',
    }],
    others: 0,
    complete: true,
    profileDir: '/tmp/profile',
  }
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  const ISSUE = {
    pkg: 'pkg-a', version: '1.2.3', runtimeVersion: '0.1.7-rc.2',
    peers: { '@deepseek-ai/dsh': '<=0.1.6' },
  }
  const issueDeps = (extra = {}) => ({
    ...txRegistryDeps(TX_ENTRY, { version: '1.2.3', integrity: sha512('good') }),
    precheck: async () => ({ ...ISSUE }),
    ...extra,
  })
  const okTx = (dirPath, bundleWarning) => ({
    runner: () => ({
      add: async () => {
        writeFileSync(join(dirPath, 'package.json'), JSON.stringify({ dependencies: { 'pkg-a': '1.2.3' } }, null, 2) + '\n')
        writeFileSync(join(dirPath, 'pnpm-lock.yaml'), LOCK_GOOD)
        // M2 Task 3：写最小 marker 包（装后守卫三项检查）
        writeInstalledMarkerPkg(dirPath, 'pkg-a')
        return { class: 'ok', output: 'ok', buildApprovals: [], fallbackAllBuilds: false, ...(bundleWarning ? { bundleWarning } : {}) }
      },
      remove: async () => ({ class: 'ok', output: 'ok' }),
      frozenInstall: async () => ({ class: 'ok', output: 'ok' }),
      rebuildInstall: async () => ({ class: 'ok', output: 'ok' }),
    }),
    profileDir: dirPath,
  })

  it('Task 11：预检不兼容且未 force → IncompatibleError（结构化 issue）', async () => {
    await assert.rejects(
      () => installFromRegistry('p', {}, {}, issueDeps()),
      (err) => err instanceof IncompatibleError && err.issue.peers['@deepseek-ai/dsh'] === '<=0.1.6',
    )
  })

  it('Task 11：force → 放行且结果记录 compat issue（已强制）', async () => {
    dir = txProfile({
      'package.json': JSON.stringify({ dependencies: {} }, null, 2) + '\n',
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const res = await installFromRegistry('p', {}, { forceIncompatible: true }, {
      ...issueDeps(),
      transaction: okTx(dir),
    })
    assert.equal(res.version, '1.2.3')
    assert.deepEqual(res.compat, ISSUE)
  })

  it('Task 11：github 源 → compatSkipped 明示', async () => {
    dir = txProfile({
      'package.json': JSON.stringify({ dependencies: {} }, null, 2) + '\n',
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const ghSpec = `github:owner/repo#${'a'.repeat(40)}`
    const res = await installFromRegistry('p', {}, {}, {
      loadRegistry: async () => ({
        configuredAddress: '', activeAddress: null, source: 'default-raw', status: 'ready',
        isDefault: true, stale: false, fetchedAt: null, errors: [], count: 1,
        registry: { version: 1, plugins: [{ id: 'p', name: 'P', description: 'd', category: 'tools', tags: [], source: 'github', github: 'owner/repo' }] },
      }),
      githubLatestTag: async () => ({ tag: 'v2.0.0', sha: 'a'.repeat(40) }),
      candidateKey: async () => 'owner-repo',
      transaction: {
        runner: () => ({
          add: async () => {
            writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'owner-repo': ghSpec } }, null, 2) + '\n')
            writeInstalledMarkerPkg(dir, 'owner-repo')
            return { class: 'ok', output: 'gh-added', buildApprovals: [], fallbackAllBuilds: false }
          },
          remove: async (pkg) => {
            const doc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
            delete doc.dependencies[pkg]
            writeFileSync(join(dir, 'package.json'), JSON.stringify(doc, null, 2) + '\n')
            rmSync(join(dir, 'node_modules', ...pkg.split('/')), { recursive: true, force: true })
            return { class: 'ok', output: 'ok' }
          },
          frozenInstall: async () => ({ class: 'ok', output: 'ok' }),
          rebuildInstall: async () => ({ class: 'ok', output: 'ok' }),
        }),
        profileDir: dir,
      },
    })
    assert.equal(res.compatSkipped, 'github-source')
    assert.equal(res.compat, undefined)
  })

  it('Task 12：卸载 dsh-m / 官方命脉 → 拒绝（零事务调用）；普通插件正常进入事务', async () => {
    let txCalls = 0
    const guardDeps = { transaction: { runner: () => ({ add: async () => { throw new Error('不应装') }, remove: async () => { txCalls += 1; return { class: 'ok', output: 'ok' } }, frozenInstall: async () => ({ class: 'ok', output: 'ok' }), rebuildInstall: async () => ({ class: 'ok', output: 'ok' }) }) } }
    await assert.rejects(
      () => uninstallPlugin('dsh-m', {}, {}, guardDeps),
      (err) => /拒绝卸载受保护插件/.test(err.message),
    )
    await assert.rejects(
      () => uninstallPlugin('@deepseek-ai/dsh-hmr', {}, {}, guardDeps),
      (err) => /受保护/.test(err.message),
    )
    assert.equal(txCalls, 0, '保护门零事务调用')
  })

  it('Task 13：bundleWarning 从事务透传到 InstallResult', async () => {
    dir = txProfile({
      'package.json': JSON.stringify({ dependencies: {} }, null, 2) + '\n',
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const res = await installFromRegistry('p', {}, {}, {
      ...txRegistryDeps(TX_ENTRY, { version: '1.2.3', integrity: sha512('good') }),
      transaction: okTx(dir, 'no-patch-layer'),
    })
    assert.equal(res.bundleWarning, 'no-patch-layer')
  })

  it('Task 13：listInstalledWithMeta join enablement（注入 composeEnablement）', async () => {
    const base = fakeDeps({ listInstalledPlugins: async () => installed })
    const map = new Map([
      ['pkg-1', { pkg: 'pkg-1', enabled: true, phase: 'active', granularity: 'row', toggleable: true }],
      ['dsh-m', { pkg: 'dsh-m', enabled: true, phase: 'active', granularity: 'bundle', toggleable: false, lockReason: 'self' }],
    ])
    const res = await listInstalledWithMeta(cfg, {}, { ...base.deps, composeEnablement: async () => map })
    const byPkg = Object.fromEntries(res.items.map((it) => [it.pkg, it]))
    assert.equal(byPkg['pkg-1'].phase, 'active')
    assert.equal(byPkg['pkg-1'].toggleable, true)
    assert.equal(byPkg['dsh-m'].lockReason, 'self')
    assert.equal(byPkg['dsh-m'].toggleable, false)
  })

  it('Task 13：composeEnablement 缺省注入也工作（真实 compose，fake profileDir → no-entry 兜底不抛）', async () => {
    const { deps } = fakeDeps({ listInstalledPlugins: async () => installed })
    const res = await listInstalledWithMeta(cfg, {}, deps)
    assert.equal(res.items.length >= 1, true)
    assert.equal(res.items[0].enabled, false, '/tmp/profile 无 bundles → 推断未启用')
    assert.equal(res.items[0].toggleable, false)
  })
})

// ---------- M1 Task 5：合并市场（主清单 ∪ 社区清单，主恒优先） ----------

function communityRaw(name, owner, props = {}) {
  return {
    name,
    owner,
    url: `https://github.com/${owner}/${name}`,
    category: 'c-ui',
    description: { en: `${name} awesome thing`, zh: `${name} 中文描述` },
    npm: `${name}-pkg`,
    downloads: 100,
    ...props,
  }
}

function communityLoaded(plugins, stateOverrides = {}, categories = {}) {
  const count = plugins.length
  return {
    state: {
      enabled: true,
      status: 'ready',
      version: '2026.928.1',
      checkedAt: '2026-09-28T00:00:00.000Z',
      fetchedAt: '2026-09-28T00:00:00.000Z',
      route: 'jsdelivr',
      count,
      errors: [],
      warnings: [],
      ...stateOverrides,
    },
    catalog: {
      name: 'awesome-dsh-plugin',
      url: 'https://awesome.example',
      source: 'https://github.com/x/y',
      updated: '2026-09-28',
      count,
      categories,
      plugins,
    },
  }
}

/** 注入社区 loader（记录调用与 opts）；base = fakeDeps() 产物。 */
function withCommunity(base, loaded, overrides = {}) {
  const ccalls = { n: 0, opts: [] }
  const deps = {
    ...base.deps,
    fetchCommunityCatalog: async (cfg2, opts) => {
      ccalls.n += 1
      ccalls.opts.push(opts ?? null)
      if (overrides.hangForever) return new Promise(() => {})
      if (overrides.slowMs) await sleep(overrides.slowMs)
      if (overrides.rejectAbort && opts?.signal) {
        return new Promise((_, rej) => {
          opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
        })
      }
      return loaded
    },
  }
  return { deps, ccalls }
}

describe('M2 Task 3：守卫接线与 mutation session', () => {
  const GUARD_DIR_BASE = () => mkdtempSync(join(tmpdir(), 'dshm-guard3-'))

  it('㉑b npm prior 为 link/file → mutation 前 GUARD_MANUAL_REQUIRED（add/remove 零调用、零写入）', async () => {
    const profileDir = GUARD_DIR_BASE()
    try {
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { 'pkg-a': 'link:../local/pkg-a' } }, null, 2) + '\n')
      writeFileSync(join(profileDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
      writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
      let addCalls = 0
      const tx = { runner: () => ({ add: async () => { addCalls += 1; return { class: 'ok', output: '' } }, remove: async () => ({ class: 'ok', output: '' }), frozenInstall: async () => ({ class: 'ok', output: '' }), rebuildInstall: async () => ({ class: 'ok', output: '' }) }), profileDir }
      let caught = null
      try {
        await installFromRegistry('p-a', {}, {}, {
          loadRegistry: async () => readyLoaded([{ id: 'p-a', name: 'A', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'pkg-a' }]),
          npmLatest: async () => ({ version: '2.0.0', integrity: 'sha512-x' }),
          precheck: async () => null,
          transaction: tx,
        })
      } catch (e) {
        caught = e
      }
      assert.ok(caught, '应拒绝')
      assert.equal(caught.kind, 'manual_required')
      assert.equal(caught.needsRestart, false)
      assert.equal(caught.restartSafe, false)
      assert.equal(addCalls, 0, 'runner.add 零调用（mutation 前拒绝）')
      assert.ok(!readFileSync(join(profileDir, 'package.json'), 'utf8').includes('2.0.0'), '零写入')
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })

  it('⑫ 守卫不可定 → fail-open committed + guardWarning', async () => {
    const profileDir = GUARD_DIR_BASE()
    try {
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: {} }, null, 2) + '\n')
      // node_modules 全量不可定：模拟 deps 读失败由 guard readDeps 缺省路径触发（坏 JSON）
      const tx = mockTxRunner({
        add: [async () => {
          // 安装链写入完整依赖状态 + marker；其 cordis.patch.yml 是目录（EISDIR）→ guard insertIdsOf unreadable → fail-open
          writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dependencies: { 'pkg-a': '1.2.3' } }, null, 2) + '\n')
          writeFileSync(join(profileDir, 'pnpm-lock.yaml'), LOCK_GOOD)
          writeInstalledMarkerPkg(profileDir, 'pkg-a')
          mkdirSync(join(profileDir, 'node_modules', 'pkg-a', 'cordis.patch.yml'), { recursive: true })
          return { class: 'ok', output: 'added', buildApprovals: [], fallbackAllBuilds: false }
        }],
      }, profileDir)
      const res = await installFromRegistry('p', {}, {}, {
        ...txRegistryDeps(TX_ENTRY, { version: '1.2.3', integrity: sha512('good') }),
        transaction: { runner: () => tx.runner, profileDir },
      })
      assert.equal(res.needsRestart, true, 'fail-open 返回 committed 形态结果')
      assert.ok(res.guardWarning && res.guardWarning.includes('守卫不可用'))
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })

  it('⑰ selfUpgrade：导出可用且 integrity 缺失 fail-closed', async () => {
    const { selfUpgrade } = await import('../lib/core/market-mutation.js')
    await assert.rejects(
      () => selfUpgrade('dsh-m', '0.0.0', {}, {}, { npmLatest: async () => ({ version: '9.9.9' }) }),
      /缺少 dist integrity/,
    )
  })

  it('㉓ withMutationSession 串行：并发安装/卸载不交错（FIFO）', async () => {
    const { withMutationSession } = await import('../lib/core/market-mutation.js')
    const events = []
    const p1 = withMutationSession(async () => {
      events.push('a-start')
      await sleep(30)
      events.push('a-end')
      return 'a'
    })
    const p2 = withMutationSession(async () => {
      events.push('b-start')
      events.push('b-end')
      return 'b'
    })
    assert.deepEqual(await Promise.all([p1, p2]), ['a', 'b'])
    assert.deepEqual(events, ['a-start', 'a-end', 'b-start', 'b-end'], 'b 在 a 完成后才开始')
  })
})

// ---------- 0.5.1 回归：quoted scoped lockfile 键 + 社区条目升级 ----------

describe('0.5.1 修复回归：scoped 包 quoted lockfile 键（升级硬拒根因）', () => {
  it('derivePrior：quoted scoped 键解析出 integrity → restorable=true（旧正则恒 null → false）', async () => {
    const dir = txProfile({
      'package.json': JSON.stringify({ dependencies: { '@scope/pkg-a': '1.2.3' } }, null, 2) + '\n',
      'pnpm-lock.yaml': `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      '@scope/pkg-a':
        specifier: 1.2.3
        version: 1.2.3

packages:
  '@scope/pkg-a@1.2.3':
    resolution: {integrity: ${sha512('good')}}
`,
    })
    try {
      const cap = await capturePreMutationState(dir)
      assert.equal(cap.kind, 'snapshot')
      const prior = derivePrior(cap.snapshot, '@scope/pkg-a')
      assert.equal(prior.kind, 'dependency')
      assert.equal(prior.state.restorable, true, 'quoted scoped 键必须解析出 integrity（旧正则匹配不到带引号键）')
      assert.equal(prior.state.integrity, sha512('good'))
      assert.equal(prior.state.sourceKind, 'npm')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('升级已装 scoped 插件：prior 门放行 → 事务提交（旧正则在此被 GUARD_MANUAL_REQUIRED 硬拒、add 零调用）', async () => {
    const profileDir = txProfile({
      'package.json': JSON.stringify({ name: 'p', private: true, dependencies: { '@scope/pkg-a': '1.2.3' } }, null, 2) + '\n',
      'pnpm-lock.yaml': `lockfileVersion: '9.0'

packages:
  '@scope/pkg-a@1.2.3':
    resolution: {integrity: ${sha512('old')}}
`,
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    try {
      const { runner, calls } = mockTxRunner({
        add: [async () => {
          writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { '@scope/pkg-a': '2.0.0' } }, null, 2) + '\n')
          writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'

packages:
  '@scope/pkg-a@2.0.0':
    resolution: {integrity: ${sha512('good')}}
`)
          writeInstalledMarkerPkg(profileDir, '@scope/pkg-a')
          return { class: 'ok', output: 'add-ok', buildApprovals: [], fallbackAllBuilds: false }
        }],
      }, profileDir)
      const deps = {
        loadRegistry: async () => readyLoaded([{ id: 'sa', name: 'SA', description: 'd', category: 'tools', tags: [], source: 'npm', npm: '@scope/pkg-a' }]),
        listInstalledPlugins: async () => ({ items: [{ pkg: '@scope/pkg-a', name: '@scope/pkg-a', version: '1.2.3', source: 'npm', spec: '@scope/pkg-a@1.2.3' }], others: 0, complete: true, profileDir }),
        npmLatest: async () => ({ version: '2.0.0', integrity: sha512('good') }),
        precheck: async () => null,
        fetchCommunityCatalog: async () => ({ state: { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] }, catalog: null }),
        transaction: { runner: () => runner, profileDir },
        classifyActivation: async () => 'unknown',
      }
      const res = await upgradePlugin('@scope/pkg-a', cfg, {}, deps)
      assert.equal(res.version, '2.0.0')
      assert.equal(res.fromVersion, '1.2.3')
      assert.equal(calls.add.length, 1, 'prior 门放行后 add 恰好执行一次')
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })

  it('带 peer 后缀的 quoted scoped 键（如 \'@scope/pkg-a@2.0.0(@dep@1.0.0)\'）同样可解析', async () => {
    const dir = txProfile({
      'package.json': JSON.stringify({ dependencies: { '@scope/pkg-a': '2.0.0' } }, null, 2) + '\n',
      'pnpm-lock.yaml': `lockfileVersion: '9.0'

packages:
  '@scope/pkg-a@2.0.0(@dep@1.0.0)':
    resolution: {integrity: ${sha512('peer')}}
`,
    })
    try {
      const cap = await capturePreMutationState(dir)
      const prior = derivePrior(cap.snapshot, '@scope/pkg-a')
      assert.equal(prior.kind, 'dependency')
      assert.equal(prior.state.restorable, true)
      assert.equal(prior.state.integrity, sha512('peer'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generation 投影 prior 事实（issue #6 修法 B：投影目录即完整快照，不依赖 lock integrity）', () => {
  afterEach(() => _setProjectionIoForTests(null))

  it('derivePrior：restorable:false 形态 + 投影事实 → restorable true（无事实时维持 false）', () => {
    const snapshot = {
      deps: { 'dsh-x': 'link:../.generations/live/dsh-x+1.0.0+abc/node_modules/dsh-x' },
      lockResolutions: {},
      mapping: { workspace: [], manifest: [] },
    }
    const base = derivePrior(snapshot, 'dsh-x')
    assert.equal(base.kind, 'dependency')
    assert.equal(base.state.restorable, false, '基线：link/别名形态不可自动回退')
    const prior = derivePrior(snapshot, 'dsh-x', { generationProjected: true })
    assert.equal(prior.kind, 'dependency')
    assert.equal(prior.state.restorable, true, '投影事实补上可回退性（代际目录自身可回退）')
    assert.equal(prior.state.sourceKind, 'other', 'sourceKind 仍按 spec 形态如实标注')
  })

  it('升级投影形态已装插件：prior 门放行 → 事务提交（同 fixture 无事实时被硬拒）', async () => {
    // dataelement lock 形态：importer 记 link: 到 .generations，packages 段无 integrity
    const profileDir = txProfile({
      'package.json': JSON.stringify({ name: 'p', private: true, dependencies: { 'dsh-x': '1.0.0' } }, null, 2) + '\n',
      'pnpm-lock.yaml': `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      dsh-x:
        specifier: 1.0.0
        version: link:../.generations/live/dsh-x+1.0.0+abc/node_modules/dsh-x
`,
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    try {
      const pkgPath = join(profileDir, 'node_modules', 'dsh-x')
      _setProjectionIoForTests({
        lstatSync: (p) => {
          if (p === pkgPath) return { isSymbolicLink: () => true }
          throw new Error(`ENOENT ${p}`)
        },
        readlinkSync: (p) => {
          if (p === pkgPath) return '../../.generations/live/dsh-x+1.0.0+abc/node_modules/dsh-x'
          throw new Error(`EINVAL ${p}`)
        },
      })
      const { runner, calls } = mockTxRunner({
        add: [async () => {
          writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { 'dsh-x': '2.0.0' } }, null, 2) + '\n')
          writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'

packages:
  'dsh-x@2.0.0':
    resolution: {integrity: ${sha512('good')}}
`)
          writeInstalledMarkerPkg(profileDir, 'dsh-x')
          return { class: 'ok', output: 'add-ok', buildApprovals: [], fallbackAllBuilds: false }
        }],
      }, profileDir)
      const deps = {
        loadRegistry: async () => readyLoaded([{ id: 'gx', name: 'GX', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'dsh-x' }]),
        listInstalledPlugins: async () => ({ items: [{ pkg: 'dsh-x', name: 'dsh-x', version: '1.0.0', source: 'npm', spec: 'dsh-x@1.0.0' }], others: 0, complete: true, profileDir }),
        npmLatest: async () => ({ version: '2.0.0', integrity: sha512('good') }),
        precheck: async () => null,
        fetchCommunityCatalog: async () => ({ state: { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] }, catalog: null }),
        transaction: { runner: () => runner, profileDir },
        classifyActivation: async () => 'unknown',
      }
      const res = await upgradePlugin('dsh-x', cfg, {}, deps)
      assert.equal(res.version, '2.0.0')
      assert.equal(calls.add.length, 1, '投影事实放行后 add 恰好执行一次')
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })

  it('负控：同 fixture 无投影事实 → prior 门硬拒（事实是放行的唯一原因）', async () => {
    const profileDir = txProfile({
      'package.json': JSON.stringify({ name: 'p', private: true, dependencies: { 'dsh-x': '1.0.0' } }, null, 2) + '\n',
      'pnpm-lock.yaml': `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      dsh-x:
        specifier: 1.0.0
        version: link:../.generations/live/dsh-x+1.0.0+abc/node_modules/dsh-x
`,
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    try {
      const deps = {
        loadRegistry: async () => readyLoaded([{ id: 'gx', name: 'GX', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'dsh-x' }]),
        listInstalledPlugins: async () => ({ items: [{ pkg: 'dsh-x', name: 'dsh-x', version: '1.0.0', source: 'npm', spec: 'dsh-x@1.0.0' }], others: 0, complete: true, profileDir }),
        npmLatest: async () => ({ version: '2.0.0', integrity: sha512('good') }),
        precheck: async () => null,
        fetchCommunityCatalog: async () => ({ state: { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] }, catalog: null }),
        transaction: { profileDir },
        classifyActivation: async () => 'unknown',
      }
      await assert.rejects(upgradePlugin('dsh-x', cfg, {}, deps), /无法自动回退/, 'restorable:false 无事实兜底必须仍被硬拒')
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })
})

describe('0.5.1 修复回归：社区条目升级（主清单 miss → 社区目录查找）', () => {
  it('主清单 miss → 社区目录命中 → 正常升级', async () => {
    const profileDir = txProfile({
      'package.json': JSON.stringify({ name: 'p', private: true, dependencies: { '@scope/pkg-b': '1.0.0' } }, null, 2) + '\n',
      'pnpm-lock.yaml': `lockfileVersion: '9.0'

packages:
  '@scope/pkg-b@1.0.0':
    resolution: {integrity: ${sha512('old')}}
`,
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    try {
      const { runner, calls } = mockTxRunner({
        add: [async () => {
          writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { '@scope/pkg-b': '1.1.0' } }, null, 2) + '\n')
          writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'

packages:
  '@scope/pkg-b@1.1.0':
    resolution: {integrity: ${sha512('good')}}
`)
          writeInstalledMarkerPkg(profileDir, '@scope/pkg-b')
          return { class: 'ok', output: 'add-ok', buildApprovals: [], fallbackAllBuilds: false }
        }],
      }, profileDir)
      const deps = {
        loadRegistry: async () => readyLoaded([]),
        listInstalledPlugins: async () => ({ items: [{ pkg: '@scope/pkg-b', name: '@scope/pkg-b', version: '1.0.0', source: 'npm', spec: '@scope/pkg-b@1.0.0' }], others: 0, complete: true, profileDir }),
        npmLatest: async () => ({ version: '1.1.0', integrity: sha512('good') }),
        precheck: async () => null,
        fetchCommunityCatalog: async () => communityLoaded([communityRaw('pkg-b', 'o', { npm: '@scope/pkg-b' })]),
        transaction: { runner: () => runner, profileDir },
        classifyActivation: async () => 'unknown',
      }
      const res = await upgradePlugin('@scope/pkg-b', cfg, {}, deps)
      assert.equal(res.version, '1.1.0')
      assert.equal(res.id, 'o--pkg-b', '命中社区合成条目 id')
      assert.equal(res.fromVersion, '1.0.0')
      assert.equal(calls.add.length, 1)
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })

  // ADR-0026 改写（原「维持『不是经 dsh-m 收录』报错」）：主清单+社区均 miss 不再硬拒——
  // npm 已装项经合成条目走同一安装管线；新断言钉合成 id 与升级成功。
  it('主清单与社区均未命中 → ADR-0026：npm 已装项经合成条目升级成功（id=installed:<pkg>）', async () => {
    const profileDir = txProfile({
      'package.json': JSON.stringify({ name: 'p', private: true, dependencies: { 'pkg-x': '1.0.0' } }, null, 2) + '\n',
      'pnpm-lock.yaml': `lockfileVersion: '9.0'

packages:
  pkg-x@1.0.0:
    resolution: {integrity: ${sha512('old')}}
`,
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    try {
      const { runner, calls } = mockTxRunner({
        add: [async () => {
          writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { 'pkg-x': '2.0.0' } }, null, 2) + '\n')
          writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'

packages:
  pkg-x@2.0.0:
    resolution: {integrity: ${sha512('good')}}
`)
          return { class: 'ok', output: 'add-ok', buildApprovals: [], fallbackAllBuilds: false }
        }],
      }, profileDir)
      const deps = {
        loadRegistry: async () => readyLoaded([]),
        listInstalledPlugins: async () => ({ items: [{ pkg: 'pkg-x', name: 'pkg-x', version: '1.0.0', source: 'npm', spec: 'pkg-x@1.0.0' }], others: 0, complete: true, profileDir }),
        npmLatest: async () => ({ version: '2.0.0', integrity: sha512('good') }),
        precheck: async () => null,
        fetchCommunityCatalog: async () => communityLoaded([]),
        transaction: { runner: () => runner, profileDir },
        classifyActivation: async () => 'unknown',
      }
      const res = await upgradePlugin('pkg-x', cfg, {}, deps)
      assert.equal(res.version, '2.0.0')
      assert.equal(res.id, 'installed:pkg-x', '未命中任何清单 → 合成条目 id')
      assert.equal(res.fromVersion, '1.0.0')
      assert.equal(calls.add.length, 1)
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })
})

// ---------- 0.7.1 安装修复：社区条目按收录 id 可装（合并市场展示 id = 社区合成 id） ----------

describe('installFromRegistry 社区条目（0.7.1：主清单 miss 查社区目录）', () => {
  it('主清单 miss + 社区命中 → 按合成 id 安装（修复 0.7.0「registry 中没有该条目」回归）', async () => {
    const profileDir = txProfile({
      'package.json': JSON.stringify({ dependencies: { existing: '^1.0.0' } }, null, 2) + '\n',
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    try {
      const { runner, calls } = mockTxRunner({
        add: [async () => {
          writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dependencies: { existing: '^1.0.0', '@scope/pkg-b': '1.1.0' } }, null, 2) + '\n')
          writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'

packages:
  '@scope/pkg-b@1.1.0':
    resolution: {integrity: ${sha512('good')}}
`)
          writeInstalledMarkerPkg(profileDir, '@scope/pkg-b')
          return { class: 'ok', output: 'add-ok', buildApprovals: [], fallbackAllBuilds: false }
        }],
      }, profileDir)
      const deps = {
        loadRegistry: async () => readyLoaded([]),
        npmLatest: async () => ({ version: '1.1.0', integrity: sha512('good') }),
        precheck: async () => null,
        fetchCommunityCatalog: async () => communityLoaded([communityRaw('pkg-b', 'o', { npm: '@scope/pkg-b' })]),
        transaction: { runner: () => runner, profileDir },
      }
      const res = await installFromRegistry('o--pkg-b', {}, {}, deps)
      assert.equal(res.id, 'o--pkg-b', '安装结果携带社区合成 id')
      assert.equal(res.pkg, '@scope/pkg-b')
      assert.equal(res.version, '1.1.0')
      assert.deepEqual(calls.add, [{ arg: '@scope/pkg-b@1.1.0', signal: undefined }], 'add 落在注入 runner')
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })

  it('主清单与社区均未命中 → 维持「registry 中没有该条目」报错', async () => {
    const deps = {
      loadRegistry: async () => readyLoaded([]),
      fetchCommunityCatalog: async () => communityLoaded([]),
    }
    await assert.rejects(
      () => installFromRegistry('o--nope', {}, {}, deps),
      (err) => err instanceof Error && /registry 中没有该条目/.test(err.message),
    )
  })

  it('社区清单加载异常 → 同样维持「registry 中没有该条目」（不误报清单不可用）', async () => {
    const deps = {
      loadRegistry: async () => readyLoaded([]),
      fetchCommunityCatalog: async () => { throw new Error('network down') },
    }
    await assert.rejects(
      () => installFromRegistry('o--nope', {}, {}, deps),
      (err) => err instanceof Error && /registry 中没有该条目/.test(err.message),
    )
  })

  it('主清单命中优先：社区查询异常不阻断主清单条目安装', async () => {
    const profileDir = txProfile({
      'package.json': JSON.stringify({ dependencies: { existing: '^1.0.0' } }, null, 2) + '\n',
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    try {
      const { runner, calls } = mockTxRunner({
        add: [async () => {
          writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }, null, 2) + '\n')
          writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'

packages:
  'pkg-a@1.2.3':
    resolution: {integrity: ${sha512('good')}}
`)
          writeInstalledMarkerPkg(profileDir, 'pkg-a')
          return { class: 'ok', output: 'add-ok', buildApprovals: [], fallbackAllBuilds: false }
        }],
      }, profileDir)
      const deps = {
        ...txRegistryDeps(TX_ENTRY, { version: '1.2.3', integrity: sha512('good') }),
        fetchCommunityCatalog: async () => { throw new Error('network down') },
        transaction: { runner: () => runner, profileDir },
      }
      const res = await installFromRegistry('p', {}, {}, deps)
      assert.equal(res.pkg, 'pkg-a')
      assert.equal(res.version, '1.2.3')
      assert.deepEqual(calls.add, [{ arg: 'pkg-a@1.2.3', signal: undefined }])
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })
})

// ---------- 0.9.0 双 profile：读模型贯穿（plan Task 4） ----------

describe('0.9.20 mutation → latest 缓存定向失效', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
    resetLatestCacheForTest()
  })

  it('① install 成功 → 该条目 latest 缓存被定向作废（跨 registryKey 变体全清，他条目不误伤）', async () => {
    dir = txProfile({
      'package.json': JSON.stringify({ name: 'p', private: true, dependencies: {} }, null, 2) + '\n',
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const browseKey = latestCacheKey('host', 'reg-x', { source: 'npm', id: 'p', npm: 'pkg-a' })
    const npmOnlyKey = latestCacheKey('host', 'npm-only', { source: 'npm', id: 'p', npm: 'pkg-a' })
    const otherKey = latestCacheKey('host', 'reg-x', { source: 'npm', id: 'q', npm: 'pkg-other' })
    writeLatestCache(browseKey, { version: '0.9.9' })
    writeLatestCache(npmOnlyKey, { version: '0.9.9' })
    writeLatestCache(otherKey, { version: '0.9.9' })

    const tx = mockTxRunner({
      add: [async () => {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'pkg-a': '1.2.3' } }, null, 2) + '\n')
        writeFileSync(join(dir, 'pnpm-lock.yaml'), LOCK_GOOD)
        writeInstalledMarkerPkg(dir, 'pkg-a')
        return { class: 'ok', output: 'added', buildApprovals: [], fallbackAllBuilds: false }
      }],
    }, dir)
    const res = await installFromRegistry('p', {}, {}, {
      ...txRegistryDeps(TX_ENTRY, { version: '1.2.3', integrity: sha512('good') }),
      transaction: { runner: () => tx.runner, profileDir: dir },
    })
    assert.equal(res.version, '1.2.3')
    assert.equal(res.needsRestart, true)
    assert.equal(readLatestCache(browseKey, 60), null, '浏览页键已失效')
    assert.equal(readLatestCache(npmOnlyKey, 60), null, 'npm-only 键已失效')
    assert.ok(readLatestCache(otherKey, 60), '他条目不误伤')
  })

  it('① 事务前失败（预检拦截）不作废缓存', async () => {
    const key = latestCacheKey('host', 'reg-x', { source: 'npm', id: 'p', npm: 'pkg-a' })
    writeLatestCache(key, { version: '0.9.9' })
    await assert.rejects(
      () => installFromRegistry('p', {}, {}, {
        ...txRegistryDeps(TX_ENTRY, { version: '1.2.3', integrity: sha512('good') }),
        precheck: async () => ({ pkg: 'pkg-a', version: '1.2.3', runtimeVersion: '0.1.7-rc.2', peers: { '@deepseek-ai/dsh': '<=0.1.6' } }),
      }),
      (err) => err instanceof IncompatibleError,
    )
    assert.ok(readLatestCache(key, 60), '回滚路径零失效')
  })

  it('① uninstall 成功 → npm-only 键作废', async () => {
    dir = txProfile({
      'package.json': JSON.stringify({ name: 'p', dependencies: { 'pkg-a': '1.2.3' } }),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    mkdirSync(join(dir, 'node_modules', 'pkg-a'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'pkg-a', 'package.json'), JSON.stringify({ name: 'pkg-a', version: '1.2.3', dsh: {} }))
    const key = latestCacheKey('host', 'npm-only', { source: 'npm', id: 'p', npm: 'pkg-a' })
    writeLatestCache(key, { version: '1.2.3' })

    const res = await uninstallPlugin('pkg-a', {}, {}, {
      transaction: {
        profileDir: dir,
        runner: () => ({
          add: async () => { throw new Error('不应调用 add') },
          remove: async () => {
            writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: {} }))
            return { class: 'ok', output: 'removed' }
          },
          frozenInstall: async () => ({ class: 'ok', output: 'ok' }),
          rebuildInstall: async () => ({ class: 'ok', output: 'ok' }),
        }),
      },
    })
    assert.equal(res.pkg, 'pkg-a')
    assert.equal(readLatestCache(key, 60), null, '卸载成功后 npm-only 键已失效')
  })

  it('② 重启语义：reset（模拟重启，无磁盘 seed）后同名 key 重探', async () => {
    const { deps, calls } = fakeDeps()
    await listMarket(cfg, { limit: 5 }, deps)
    assert.equal(calls.npm.length, 5)
    resetLatestCacheForTest()
    await listMarket(cfg, { limit: 5 }, deps)
    assert.equal(calls.npm.length, 10, '重启后重探（0.9.14 会 seed 免重探）')
  })

  it('② 探测不再落盘：listMarket 后 cacheRoot 无 latest 信封文件', async () => {
    const { existsSync } = await import('node:fs')
    const { deps } = fakeDeps()
    await listMarket(cfg, { limit: 5 }, deps)
    assert.equal(existsSync(join(marketTestCacheRoot, 'latest', 'host.json')), false)
  })
})

// ---------- 0.9.45 市场页两段加载（ADR-0013）：probeMode 两态 + force peek 重探 ----------

// ---------- ADR-0026 升级与收录解耦（issue #30）：web upgradePlugin ----------
// 自含夹具（不引用兄弟 describe 闭包；原 unavailable 硬抛用例改写迁入此处）。
describe('ADR-0026：upgradePlugin 与收录解耦（web）', () => {
  const communityDisabled = () => ({ state: { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] }, catalog: null })

  it('① registry unavailable + 非收录 npm 已装项 → 合成条目升级成功（不再硬抛「收录清单不可用」）', async () => {
    const profileDir = txProfile({
      'package.json': JSON.stringify({ name: 'p', private: true, dependencies: { 'non-catalog-pkg': '1.0.0' } }, null, 2) + '\n',
      'pnpm-lock.yaml': `lockfileVersion: '9.0'

packages:
  non-catalog-pkg@1.0.0:
    resolution: {integrity: ${sha512('old')}}
`,
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    try {
      const { runner, calls } = mockTxRunner({
        add: [async () => {
          writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { 'non-catalog-pkg': '2.0.0' } }, null, 2) + '\n')
          writeFileSync(join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'

packages:
  non-catalog-pkg@2.0.0:
    resolution: {integrity: ${sha512('good')}}
`)
          return { class: 'ok', output: 'add-ok', buildApprovals: [], fallbackAllBuilds: false }
        }],
      }, profileDir)
      const res = await upgradePlugin('non-catalog-pkg', cfg, {}, {
        loadRegistry: async () => unavailableLoaded(),
        listInstalledPlugins: async () => ({ items: [{ pkg: 'non-catalog-pkg', name: 'non-catalog-pkg', version: '1.0.0', source: 'npm', spec: '^1.0.0' }], others: 0, complete: true, profileDir }),
        npmLatest: async () => ({ version: '2.0.0', integrity: sha512('good') }),
        precheck: async () => null,
        fetchCommunityCatalog: communityDisabled,
        transaction: { runner: () => runner, profileDir },
        classifyActivation: async () => 'unknown',
      })
      assert.equal(res.pkg, 'non-catalog-pkg')
      assert.equal(res.version, '2.0.0')
      assert.equal(res.fromVersion, '1.0.0')
      assert.equal(res.id, 'installed:non-catalog-pkg', '合成条目 id 语义（评审 F3）')
      assert.equal(calls.add.length, 1)
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })

  it('② registry ready 但主清单+社区均 miss 的 github 已装项 → 合成条目重锁 HEAD（githubLatestTag 收到 owner/repo）', async () => {
    const profileDir = txProfile({
      'package.json': JSON.stringify({ name: 'p', private: true, dependencies: { 'owner-repo': `github:owner/repo#${'b'.repeat(40)}` } }, null, 2) + '\n',
      'pnpm-lock.yaml': `lockfileVersion: '9.0'

packages:
  owner-repo:
    resolution: {commit: ${'b'.repeat(40)}}
`,
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const ghCalls = []
    const newSha = 'a'.repeat(40)
    try {
      const runner = {
        add: async () => {
          writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { 'owner-repo': `github:owner/repo#${newSha}` } }, null, 2) + '\n')
          writeInstalledMarkerPkg(profileDir, 'owner-repo')
          return { class: 'ok', output: 'gh-add-ok', buildApprovals: [], fallbackAllBuilds: false }
        },
        remove: async () => ({ class: 'ok', output: 'ok' }),
        frozenInstall: async () => ({ class: 'ok', output: 'ok' }),
        rebuildInstall: async () => ({ class: 'ok', output: 'ok' }),
      }
      const res = await upgradePlugin('owner-repo', cfg, {}, {
        loadRegistry: async () => readyLoaded([]),
        listInstalledPlugins: async () => ({ items: [{ pkg: 'owner-repo', name: 'owner-repo', version: '0.1.0', source: 'github', spec: `github:owner/repo#${'b'.repeat(40)}` }], others: 0, complete: true, profileDir }),
        githubLatestTag: async (repo) => {
          ghCalls.push(repo)
          return { tag: 'v2.0.0', sha: newSha }
        },
        candidateKey: async () => 'owner-repo',
        fetchCommunityCatalog: communityDisabled,
        transaction: { runner: () => runner, profileDir },
      })
      assert.deepEqual(ghCalls, ['owner/repo'], '合成条目 github 仓 = spec 解析出的 owner/repo')
      assert.ok(new RegExp(`^github:owner/repo#${newSha}$`).test(res.spec), `spec 应重锁 HEAD，实得 ${res.spec}`)
      assert.equal(res.fromVersion, '0.1.0')
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })

  it('③ 本地 file: spec 已装项 → UpgradePathUnsupportedError（结构化不支持，B5 边界）', async () => {
    await assert.rejects(
      () => upgradePlugin('baz', cfg, {}, {
        loadRegistry: async () => readyLoaded([]),
        listInstalledPlugins: async () => ({ items: [{ pkg: 'baz', name: 'baz', version: '1.0.0', source: 'npm', spec: 'file:../baz' }], others: 0, complete: true, profileDir: '/tmp/profile' }),
        fetchCommunityCatalog: communityDisabled,
      }),
      (err) => err instanceof UpgradePathUnsupportedError && err.upgradePath === 'unsupported',
    )
  })
})

// ---------- ADR-0026 合成条目（issue #30）：synthesizeInstallableEntry 五分支 ----------
// 自带夹具（CODING-STANDARDS：新 describe 不引用兄弟 describe 闭包）。
describe('synthesizeInstallableEntry（ADR-0026 合成条目）', () => {
  const mk = (over = {}) => ({ pkg: 'p', name: 'P', version: '1.0.0', description: '', homepage: '', spec: '^1.0.0', source: 'npm', dsh: true, path: '/x', ...over })

  it('① npm 源 → 合成 npm 条目（id=installed:<pkg>，npm 名取已装包名）', () => {
    const e = synthesizeInstallableEntry(mk({ pkg: 'foo', spec: '^1.0.0' }))
    assert.deepEqual(e, { id: 'installed:foo', source: 'npm', npm: 'foo' })
  })

  it('② github 源 → 解析 spec 锁定仓库合成 github 条目（#sha 尾不进 github 字段）', () => {
    const e = synthesizeInstallableEntry(mk({ pkg: 'bar', source: 'github', spec: 'github:owner/repo#abc1234' }))
    assert.deepEqual(e, { id: 'installed:bar', source: 'github', github: 'owner/repo' })
  })

  it('③ npm 源但 file: spec → 抛 UpgradePathUnsupportedError（本地开发安装不从线上更新）', () => {
    assert.throws(
      () => synthesizeInstallableEntry(mk({ pkg: 'baz', spec: 'file:../baz' })),
      (err) => err instanceof UpgradePathUnsupportedError && err.upgradePath === 'unsupported' && /本地/.test(err.message),
    )
  })

  it('④ npm 源但 link: spec → 同③抛不支持（大小写不敏感前缀）', () => {
    assert.throws(
      () => synthesizeInstallableEntry(mk({ pkg: 'baz', spec: 'LINK:../baz' })),
      (err) => err instanceof UpgradePathUnsupportedError && err.upgradePath === 'unsupported',
    )
  })

  it('⑤ github 源但 spec 不匹配 GITHUB_SPEC_RE → 抛不支持（禁止产出双分支都落空的条目）', () => {
    assert.throws(
      () => synthesizeInstallableEntry(mk({ pkg: 'qux', source: 'github', spec: 'not-a-github-spec' })),
      (err) => err instanceof UpgradePathUnsupportedError && err.upgradePath === 'unsupported' && /owner\/repo/.test(err.message),
    )
  })

  it('⑥ 非 npm/github 源（unknown/link/file）→ 抛不支持（PluginSource 五值兜底臂）', () => {
    for (const source of ['unknown', 'link', 'file']) {
      assert.throws(
        () => synthesizeInstallableEntry(mk({ pkg: 'corge', source, spec: 'whatever' })),
        (err) => err instanceof UpgradePathUnsupportedError && err.upgradePath === 'unsupported' && /不可线上解析/.test(err.message),
        `source=${source} 应走兜底臂`,
      )
    }
  })
})

