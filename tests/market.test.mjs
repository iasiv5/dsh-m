/**
 * Task 3：服务端分页、latest cache、deadline/abort、unavailable 契约与 host/cli namespace。
 * Task 3 桥接：transaction 注入与 legacy 槽位逐操作回退。
 * 运行：npm run build && node --test tests/market.test.mjs
 */
import { describe, it, beforeEach, afterEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listMarket, listInstalledWithMeta, installFromRegistry, upgradePlugin, uninstallPlugin, communityOutcome, capturePreMutationState, derivePrior } from '../lib/core/market.js'
import { IncompatibleError } from '../lib/core/compat-check.js'
import { latestCacheKey, readLatestCache, writeLatestCache, resetLatestCacheForTest } from '../lib/core/latest-cache.js'

// 0.9.14 Task 4b：latest 落盘接线后，listMarket/listInstalledWithMeta 会读写真实 cacheRoot——
// 全文件统一隔离到临时目录（评审 R1-#4：本文件原先零 DSHM_CACHE_DIR，不补则触碰真实 ~/.dsh）。
const marketTestCacheRoot = mkdtempSync(join(tmpdir(), 'dshm-market-'))
process.env.DSHM_CACHE_DIR = marketTestCacheRoot
after(() => {
  delete process.env.DSHM_CACHE_DIR
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

describe('listMarket：服务端分页', () => {
  it('1,000 条第一页 limit=50 只查询当前页 latest，total/counts 反映完整 registry', async () => {
    const { deps, calls } = fakeDeps()
    const res = await listMarket(cfg, { limit: 50 }, deps)
    assert.equal(res.items.length, 50)
    assert.ok(calls.npm.length <= 50, `latest 调用 ${calls.npm.length} 次`)
    assert.equal(res.total, 1000)
    const sum = Object.values(res.categoryCounts).reduce((a, b) => a + b, 0)
    assert.equal(sum, 1000)
    assert.equal(res.offset, 0)
    assert.equal(res.limit, 50)
    assert.equal(res.items[0].id, 'p-0')
    assert.equal(res.registryState.status, 'ready')
    assert.equal(res.installedComplete, true)
    assert.equal(res.latestComplete, true)
    assert.equal(res.latestTimedOut, false)
  })

  it('withLatest:false 不触发 latest，limit 默认 80', async () => {
    const { deps, calls } = fakeDeps()
    const res = await listMarket(cfg, { withLatest: false }, deps)
    assert.equal(calls.npm.length, 0)
    assert.equal(calls.github.length, 0)
    assert.equal(res.limit, 80)
    assert.equal(res.items.length, 80)
  })

  it('core 硬 clamp：withLatest 最多 96（0.7.0 Task 7），metadata-only 最多 80', async () => {
    const { deps } = fakeDeps()
    const a = await listMarket(cfg, { limit: 1000 }, deps)
    assert.equal(a.limit, 96)
    assert.equal(a.items.length, 96)
    const b = await listMarket(cfg, { limit: 1000, withLatest: false }, deps)
    assert.equal(b.limit, 80)
    assert.equal(b.items.length, 80)
  })

  it('query/category 过滤与 offset 归一到最后有效页', async () => {
    const { deps } = fakeDeps()
    const filtered = await listMarket(cfg, { query: 'p1', withLatest: false, limit: 10 }, deps)
    assert.ok(filtered.total > 0 && filtered.total < 1000)
    assert.ok(filtered.items.every((it) => `${it.id} ${it.name} ${it.description}`.toLowerCase().includes('p1')))

    const last = await listMarket(cfg, { offset: 2000, limit: 50, withLatest: false }, deps)
    assert.equal(last.offset, 950)
    assert.equal(last.items[0].id, 'p-950')
    assert.equal(last.items.length, 50)

    const cat = await listMarket(cfg, { category: 'market', withLatest: false, limit: 5 }, deps)
    assert.equal(cat.total, 200)
    assert.ok(cat.items.every((it) => it.category === 'market'))
  })

  it('worker pool 最大 in-flight ≤ 8', async () => {
    const { deps, maxInFlight } = fakeDeps()
    await listMarket(cfg, { limit: 50 }, deps)
    assert.ok(maxInFlight() <= 8, `实际最大并发 ${maxInFlight()}`)
    assert.ok(maxInFlight() > 1)
  })
})

describe('listMarket：latest cache 与 deadline', () => {
  it('latest cache 命中不重复请求', async () => {
    const { deps, calls } = fakeDeps()
    await listMarket(cfg, { limit: 50 }, deps)
    assert.equal(calls.npm.length, 50)
    await listMarket(cfg, { limit: 50 }, deps)
    assert.equal(calls.npm.length, 50, '第二次应全部命中 cache')
  })

  it('latest probe 永不 resolve 时按 deadline 收敛为 partial', async () => {
    const { deps } = fakeDeps({
      npmLatest: () => new Promise(() => {}),
    })
    const startedAt = Date.now()
    const res = await listMarket(cfg, { limit: 50, deadlineMs: 40 }, deps)
    assert.ok(Date.now() - startedAt < 5000, 'deadline 应收敛而不是永久等待')
    assert.equal(res.items.length, 50)
    assert.equal(res.latestComplete, false)
    assert.equal(res.latestTimedOut, true)
    assert.ok(res.items.every((it) => it.latestErrorCode === 'timeout'))
  })

  it('registry 在 deadline 内未就绪 → 空页 + unavailable 状态', async () => {
    const { deps } = fakeDeps({
      loadRegistry: () => new Promise(() => {}),
    })
    const startedAt = Date.now()
    const res = await listMarket(cfg, { deadlineMs: 40 }, deps)
    assert.ok(Date.now() - startedAt < 5000)
    assert.equal(res.items.length, 0)
    assert.equal(res.total, 0)
    assert.equal(res.registryState.status, 'unavailable')
    assert.equal(res.installedComplete, false)
    assert.equal(res.latestTimedOut, true)
  })
})

describe('listMarket：unavailable 与 abort', () => {
  it('registry unavailable：空 items、counts 0、不调用 latest', async () => {
    const { deps, calls } = fakeDeps({
      loadRegistry: async () => unavailableLoaded(),
    })
    const res = await listMarket(cfg, {}, deps)
    assert.deepEqual(res.items, [])
    assert.equal(res.total, 0)
    const sum = Object.values(res.categoryCounts).reduce((a, b) => a + b, 0)
    assert.equal(sum, 0)
    assert.equal(calls.npm.length, 0)
    // M1 Task 5：主 unavailable 不再提前返回（Q42 统一路径）→ installed 正常 join，完整性如实反映
    assert.equal(res.installedComplete, true)
    assert.equal(res.community.status, 'disabled')
  })

  it('外部 signal abort 抛 AbortError，不返回 partial page', async () => {
    const ac = new AbortController()
    const { deps } = fakeDeps({
      loadRegistry: (cfg2, opts) =>
        new Promise((_, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
        }),
    })
    setTimeout(() => ac.abort(), 10)
    await assert.rejects(
      () => listMarket(cfg, { signal: ac.signal }, deps),
      (err) => err.name === 'AbortError',
    )
  })
})

describe('namespace 传递', () => {
  it('默认 host，显式 cli 生效', async () => {
    const { deps, calls } = fakeDeps()
    await listMarket(cfg, {}, deps)
    assert.equal(calls.loadRegistry[0]?.namespace, 'host')
    await listMarket(cfg, { namespace: 'cli' }, deps)
    assert.equal(calls.loadRegistry[1]?.namespace, 'cli')
  })
})

describe('listInstalledWithMeta', () => {
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
    }],
    others: 2,
    complete: true,
    profileDir: '/tmp/profile',
  }

  it('registry unavailable 仍返回已装插件，跳过 matching', async () => {
    const { deps, calls } = fakeDeps({
      loadRegistry: async () => unavailableLoaded(),
      listInstalledPlugins: async () => installed,
    })
    const res = await listInstalledWithMeta(cfg, {}, deps)
    assert.equal(res.items.length, 1)
    assert.equal(res.others, 2)
    assert.equal(res.profileDir, '/tmp/profile')
    assert.equal(res.items[0].registryId, undefined)
    assert.equal(res.registryState.status, 'unavailable')
    assert.equal(calls.npm.length, 0, 'unavailable 时不做 registry matching 的 latest 查询')
  })

  it('registry ready 时 matching 命中并查询 latest', async () => {
    const { deps, calls } = fakeDeps({
      listInstalledPlugins: async () => installed,
    })
    const res = await listInstalledWithMeta(cfg, {}, deps)
    assert.equal(res.items[0].registryId, 'p-1')
    assert.equal(res.items[0].latestVersion, '2.0.0')
    assert.equal(res.items[0].outdated, true)
    assert.ok(calls.npm.includes('pkg-1'))
    assert.equal(res.registryState.status, 'ready')
  })
})

describe('listInstalledWithMeta probeMode', () => {
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
    }],
    others: 0,
    complete: true,
    profileDir: '/tmp/profile',
  }

  it("probeMode 'none'：跳过探测段，registry matching 仍生效", async () => {
    const { deps, calls } = fakeDeps({ listInstalledPlugins: async () => installed })
    const res = await listInstalledWithMeta(cfg, { probeMode: 'none' }, deps)
    assert.equal(calls.npm.length, 0, "'none' 不得发起 latest 探测")
    assert.equal(res.items[0].registryId, 'p-1', 'matching/enablement 不受探测段跳过影响')
    assert.equal(res.items[0].latestVersion, undefined)
  })

  it("probeMode 'only'：缓存预热仍强制重探（ttlMin=0 穿透）", async () => {
    const { deps, calls } = fakeDeps({ listInstalledPlugins: async () => installed })
    let stub = '2.0.0'
    const probeDeps = {
      ...deps,
      npmLatest: async (pkg) => {
        calls.npm.push(pkg)
        return { version: stub, integrity: 'sha512-x', tarball: `https://example.com/${pkg}.tgz` }
      },
    }
    await listInstalledWithMeta(cfg, {}, probeDeps)
    assert.equal(calls.npm.length, 1)
    stub = '3.0.0'
    const res = await listInstalledWithMeta(cfg, { probeMode: 'only' }, probeDeps)
    assert.equal(calls.npm.length, 2, "'only' 应穿透缓存重新探测")
    assert.equal(res.items[0].latestVersion, '3.0.0')
  })

  it("缺省 'full'：TTL 内二次调用走缓存", async () => {
    const { deps, calls } = fakeDeps({ listInstalledPlugins: async () => installed })
    await listInstalledWithMeta(cfg, {}, deps)
    await listInstalledWithMeta(cfg, {}, deps)
    assert.equal(calls.npm.length, 1, '缺省模式 TTL 内不得重复探测')
  })
})

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

  it('upgradePlugin unavailable 时业务报错', async () => {
    const { deps } = fakeDeps({
      loadRegistry: async () => unavailableLoaded(),
      listInstalledPlugins: async () => installed,
    })
    await assert.rejects(
      () => upgradePlugin('pkg-1', cfg, {}, deps),
      (err) => err instanceof Error && /不可用/.test(err.message),
    )
  })
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

describe('dshm_* Agent tools：host namespace 与 metadata-only search', () => {
  async function loadTools() {
    const { registerTools } = await import('../lib/tools.js')
    const registered = []
    const ctx = {
      tools: { register: (t) => registered.push(t) },
      inject: () => {},
    }
    const searchCalls = []
    const installedCalls = []
    const marketResult = await (async () => {
      const { deps } = fakeDeps()
      return listMarket(cfg, { limit: 5, withLatest: false }, deps)
    })()
    const installedResult = await (async () => {
      const { deps } = fakeDeps({ listInstalledPlugins: async () => ({ items: [], others: 0, complete: true, profileDir: '/tmp/p' }) })
      return listInstalledWithMeta(cfg, {}, deps)
    })()
    registerTools(ctx, cfg, {
      listMarket: async (c, opts) => {
        searchCalls.push(opts)
        return marketResult
      },
      listInstalledWithMeta: async (c, opts) => {
        installedCalls.push(opts)
        return installedResult
      },
    })
    return { registered, searchCalls, installedCalls }
  }

  it('dshm_search 使用 namespace:host + withLatest:false + limit clamp 80', async () => {
    const { registered, searchCalls } = await loadTools()
    const search = registered.find((t) => t.name === 'dshm_search')
    assert.ok(search, 'dshm_search 已注册')
    const out = await search.execute({ query: '主题', limit: 999 })
    const opts = searchCalls[0]
    assert.equal(opts.namespace, 'host')
    assert.equal(opts.withLatest, false)
    assert.equal(opts.limit, 80)
    assert.equal(opts.offset, 0)
    assert.equal(out.total, marketTotal(out))
    assert.ok(out.registry && out.registry.isDefault === true)
  })

  it('dshm_list / dshm_outdated 使用 host namespace 并携带 registry summary', async () => {
    const { registered, installedCalls } = await loadTools()
    const list = registered.find((t) => t.name === 'dshm_list')
    const out = await list.execute({})
    assert.equal(installedCalls.at(-1)?.namespace, 'host')
    assert.ok(out.registry && typeof out.registry.status === 'string')
    const outdated = registered.find((t) => t.name === 'dshm_outdated')
    const out2 = await outdated.execute({})
    assert.ok(out2.registry && typeof out2.registry.stale === 'boolean')
  })
})

describe('dshm_search：安装标注单快照契约（Tier B + fail-closed）', () => {
  // 唯一哨兵条目：npm 名不可能真实安装，避免开发机已装导致假绿
  const sentinel = {
    id: 'sentinel-dshm-review',
    name: 'Sentinel',
    description: 'installed-annotation sentinel',
    category: 'tools',
    tags: [],
    source: 'npm',
    npm: 'definitely-not-installed-dshm-review',
    homepage: 'https://example.com/sentinel',
    installed: true,
    installedPkg: 'definitely-not-installed-dshm-review',
    installedVersion: '1.2.3',
  }
  const emptyCounts = { market: 0, tools: 0, ui: 0, search: 0, other: 0 }
  const readyState = { isDefault: true, status: 'ready', stale: false }

  async function searchToolWith(result) {
    const { registerTools } = await import('../lib/tools.js')
    const registered = []
    const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {} }
    registerTools(ctx, cfg, { listMarket: async () => result })
    const search = registered.find((t) => t.name === 'dshm_search')
    assert.ok(search, 'dshm_search 已注册')
    return search
  }

  it('原样透传 listMarket 的 installed 标注（唯一来源）', async () => {
    const search = await searchToolWith({
      items: [sentinel],
      total: 1,
      offset: 0,
      limit: 5,
      categoryCounts: { ...emptyCounts, tools: 1 },
      registryState: readyState,
      installedComplete: true,
      latestComplete: true,
      latestTimedOut: false,
    })
    const out = await search.execute({ query: 'sentinel' })
    assert.equal(out.items.length, 1)
    assert.equal(out.items[0].installed, true)
    assert.equal(out.items[0].installedPkg, 'definitely-not-installed-dshm-review')
    assert.equal(out.items[0].installedVersion, '1.2.3')
  })

  it('非空结果的安装状态不完整时 fail-closed（不把未知当未装）', async () => {
    const search = await searchToolWith({
      items: [{ ...sentinel, installed: false, installedPkg: undefined, installedVersion: undefined }],
      total: 1,
      offset: 0,
      limit: 5,
      categoryCounts: { ...emptyCounts, tools: 1 },
      registryState: readyState,
      installedComplete: false,
      latestComplete: true,
      latestTimedOut: false,
    })
    await assert.rejects(() => search.execute({ query: 'sentinel' }), /安装标注不可用/)
  })

  it('空结果的安装状态不完整时保持空结果（不误伤 unavailable/超时路径）', async () => {
    const search = await searchToolWith({
      items: [],
      total: 0,
      offset: 0,
      limit: 5,
      categoryCounts: emptyCounts,
      registryState: { isDefault: true, status: 'unavailable', stale: false },
      installedComplete: false,
      latestComplete: false,
      latestTimedOut: true,
    })
    const out = await search.execute({ query: 'no-match' })
    assert.deepEqual(out.items, [])
    assert.equal(out.total, 0)
    assert.equal(out.registry.status, 'unavailable')
  })

  it('端到端：真实枚举（坏 JSON profile）→ 真实 listMarket 组装 → fail-closed reject', async () => {
    // 不 fake 最终 MarketResult——真实枚举代码跑在坏 profile 上，信号从源头贯通到门禁
    const badProfile = mkdtempSync(join(tmpdir(), 'dshm-bad-profile-'))
    try {
      writeFileSync(join(badProfile, 'package.json'), '{ broken')
      const realInstalled = await import('../lib/core/installed.js')
      const readyRegistry = readyLoaded([
        { id: 'p-1', name: 'P1', description: 'd1', category: 'tools', tags: [], source: 'npm', npm: 'pkg-1' },
      ])
      const { registerTools } = await import('../lib/tools.js')
      const registered = []
      const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {} }
      registerTools(ctx, cfg, {
        listMarket: (c, opts) => listMarket(c, opts, {
          loadRegistry: async () => readyRegistry,
          listInstalledPlugins: () => realInstalled.listInstalledPlugins(badProfile),
        }),
      })
      const search = registered.find((t) => t.name === 'dshm_search')
      assert.ok(search, 'dshm_search 已注册')
      await assert.rejects(() => search.execute({ query: 'p' }), /安装标注不可用/)
    } finally {
      rmSync(badProfile, { recursive: true, force: true })
    }
  })

  it('端到端：真实枚举（合法 profile）→ 真实 listMarket 匹配 → 标注透传且枚举恰好一次', async () => {
    // 成功路径同样不 fake 最终 MarketResult：真实枚举 + 真实 matchInstalledByEntry 命中 + 单快照计数
    const okProfile = mkdtempSync(join(tmpdir(), 'dshm-ok-profile-'))
    try {
      mkdirSync(join(okProfile, 'node_modules', 'pkg-a'), { recursive: true })
      writeFileSync(join(okProfile, 'package.json'), JSON.stringify({ dependencies: { 'pkg-a': '1.2.3' } }))
      writeFileSync(
        join(okProfile, 'node_modules', 'pkg-a', 'package.json'),
        JSON.stringify({ name: 'A', version: '1.2.3', dsh: { client: { platform: 'web' } } }),
      )
      const realInstalled = await import('../lib/core/installed.js')
      let installedCalls = 0
      const readyRegistry = readyLoaded([
        { id: 'p-1', name: 'P1', description: 'd1', category: 'tools', tags: [], source: 'npm', npm: 'pkg-a' },
      ])
      const { registerTools } = await import('../lib/tools.js')
      const registered = []
      const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {} }
      registerTools(ctx, cfg, {
        listMarket: (c, opts) => listMarket(c, opts, {
          loadRegistry: async () => readyRegistry,
          listInstalledPlugins: async () => {
            installedCalls += 1
            return realInstalled.listInstalledPlugins(okProfile)
          },
        }),
      })
      const search = registered.find((t) => t.name === 'dshm_search')
      const out = await search.execute({ query: 'P1' })
      assert.equal(installedCalls, 1, '一次搜索只消费一个安装快照')
      const item = out.items.find((e) => e.id === 'p-1')
      assert.ok(item, '收录条目在结果中')
      assert.equal(item.installed, true, '真实 matcher 命中已装依赖')
      assert.equal(item.installedPkg, 'pkg-a')
      assert.equal(item.installedVersion, '1.2.3')
    } finally {
      rmSync(okProfile, { recursive: true, force: true })
    }
  })
})

function marketTotal(out) {
  return out.total
}

describe('dshm CLI：cli namespace 与 unavailable 退出码', () => {
  async function run(argv, deps, io) {
    const { runCli } = await import('../lib/cli.js')
    return runCli(argv, deps, io)
  }

  it('0.9.0：--profile desktop 显式拒绝（exit 1、零 core 调用、指引官方入口）', async () => {
    const calls = []
    const errs = []
    const code = await run(
      ['search', '--profile', 'desktop'],
      { listMarket: async () => { calls.push('listMarket'); return { items: [], total: 0, offset: 0, limit: 10, categoryCounts: {}, registryState: unavailableLoaded(), installedComplete: true, latestComplete: true, latestTimedOut: false, community: { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] } } } },
      { out: () => {}, err: (l) => errs.push(l) },
    )
    assert.equal(code, 1)
    assert.equal(calls.length, 0, 'core 不得被触达')
    const joined = errs.join('\n')
    assert.ok(joined.includes('--profile desktop'), '拒绝文案点名收到的值')
    assert.ok(joined.includes('Settings → Plugins') || joined.includes('官方 Desktop'), '指引官方入口')
  })

  it('0.9.0：--profile web 显式声明照常放行', async () => {
    const calls = []
    const lines = []
    const { deps } = fakeDeps()
    const code = await run(
      ['search', '--profile', 'web'],
      {
        listMarket: async (c, opts) => {
          calls.push(opts)
          return listMarket(cfg, { withLatest: false }, deps)
        },
      },
      { out: (l) => lines.push(l) },
    )
    assert.equal(code, 0)
    assert.equal(calls.length, 1)
  })

  it('search 固定 withLatest:false + namespace:cli，直接传 query/limit', async () => {
    const calls = []
    const lines = []
    const { deps } = fakeDeps()
    const code = await run(
      ['search', '--query', '主题', '--limit', '5'],
      {
        listMarket: async (c, opts) => {
          calls.push(opts)
          return listMarket(cfg, { limit: 5, withLatest: false }, deps)
        },
      },
      { out: (l) => lines.push(l) },
    )
    assert.equal(code, 0)
    assert.equal(calls[0].withLatest, false)
    assert.equal(calls[0].namespace, 'cli')
    assert.equal(calls[0].limit, 5)
    assert.equal(calls[0].offset, 0)
    assert.equal(calls[0].query, '主题')
  })

  it('search：registry unavailable → exit 1 + 提示不可用', async () => {
    const lines = []
    const code = await run(
      ['search'],
      { listMarket: async () => ({
        items: [], total: 0, offset: 0, limit: 80,
        categoryCounts: { market: 0, tools: 0, ui: 0, search: 0, other: 0 },
        registryState: unavailableLoaded('/tmp/custom.json'),
        installedComplete: false, latestComplete: false, latestTimedOut: false,
        community: { enabled: false, status: 'unavailable', version: null, checkedAt: null, fetchedAt: null, route: null, acceptedCount: 0, upstreamCount: 0, displaced: 0, skippedDirty: 0, skippedSubpathNoNpm: 0, errors: [], warnings: [] },
      }) },
      { err: (l) => lines.push(l) },
    )
    assert.equal(code, 1)
    assert.ok(lines.join('\n').includes('不可用'))
  })

  it('registry：unavailable → exit 1 并输出配置/实际生效地址', async () => {
    const lines = []
    const code = await run(
      ['registry'],
      { loadRegistry: async () => unavailableLoaded('/tmp/custom.json') },
      { err: (l) => lines.push(l) },
    )
    assert.equal(code, 1)
    const text = lines.join('\n')
    assert.ok(text.includes('/tmp/custom.json'), '应输出配置地址')
  })

  it('list：registry unavailable 仍列出已装并标记', async () => {
    const lines = []
    const code = await run(
      ['list'],
      {
        listInstalledWithMeta: async () => ({
          items: [{ pkg: 'pkg-1', name: 'P1', version: '1.0.0', source: 'npm', outdated: false, registryId: null }],
          others: 0,
          profileDir: '/tmp/profile',
          registryState: unavailableLoaded(),
        }),
      },
      { out: (l) => lines.push(l) },
    )
    assert.equal(code, 0)
    assert.ok(lines.join('\n').includes('不可用'))
    assert.ok(lines.join('\n').includes('P1'))
  })

  it('outdated：registry unavailable → exit 1', async () => {
    const code = await run(
      ['outdated'],
      { listInstalledWithMeta: async () => ({
        items: [], others: 0, profileDir: '/tmp/profile',
        registryState: unavailableLoaded(),
      }) },
      {},
    )
    assert.equal(code, 1)
  })

  it('install：业务错误 → exit 1', async () => {
    const code = await run(
      ['install', '--id', 'p-1'],
      { installFromRegistry: async () => { throw new Error('收录清单不可用，无法安装') } },
      { err: () => {} },
    )
    assert.equal(code, 1)
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

describe('M1 Task 5：合并市场', () => {
  it('① 去重主恒优先：npm 名/github/id 三键撞名 → 社区条目让位并计数进 warnings', async () => {
    const primary = [
      { id: 'p-a', name: 'A', description: 'da', category: 'tools', tags: [], source: 'npm', npm: 'pkg-a' },
      { id: 'own--name', name: 'N', description: 'dn', category: 'ui', tags: [], source: 'github', github: 'own/name' },
    ]
    const base = fakeDeps({
      loadRegistry: async () => readyLoaded(primary),
    })
    const { deps, ccalls } = withCommunity(base, communityLoaded([
      communityRaw('dup-npm', 'o1', { npm: 'pkg-a' }),   // npm 名撞主条目
      communityRaw('name', 'own', { npm: 'other-npm' }), // github owner/repo 与 id 双撞主条目
      communityRaw('keep', 'o2'),                         // 无撞 → 收录
    ]))
    const res = await listMarket(cfg, { withLatest: false }, deps)
    const ids = res.items.map((it) => it.id)
    assert.deepEqual(ids, ['p-a', 'own--name', 'o2--keep'])
    assert.equal(res.community.displaced, 2)
    assert.ok(res.community.warnings.some((w) => w.includes('2')))
    assert.equal(ccalls.n, 1)
  })

  it('② 排序：主清单置顶组内原顺序，社区按 downloads 降序、无数据按名称', async () => {
    const primary = [
      { id: 'p-1', name: 'B', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'pkg-1' },
      { id: 'p-0', name: 'A', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'pkg-0' },
    ]
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary) })
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('zeta', 'o1', { downloads: null }),
      communityRaw('beta', 'o2', { downloads: 50 }),
      communityRaw('alpha', 'o3', { downloads: 500 }),
      communityRaw('yyyy', 'o4', { downloads: null }),
    ]))
    const res = await listMarket(cfg, { withLatest: false }, deps)
    assert.deepEqual(res.items.map((it) => it.id), [
      'p-1', 'p-0',          // 主置顶原序
      'o3--alpha',           // downloads 500
      'o2--beta',            // 50
      'o4--yyyy', 'o1--zeta', // 无数据按名称（yyyy < zeta）
    ])
  })

  it('③（0.7.0 Task 7：primaryOnly 字段已删除，本用例归并入 ⑦ source=primary）', () => {
    // 占位说明：原 primaryOnly shim 用例随 MarketQuery.primaryOnly 删除而退役；
    // 「source=primary 零社区调用 + community=skipped」的等价断言见 ⑦。
  })

  it('⑦ source 分区（0.7.0 Task 2）：primary=只主清单零社区加载；community=只社区条目', async () => {
    const primary = [
      { id: 'p-1', name: 'A', description: 'da', category: 'tools', tags: [], source: 'npm', npm: 'pkg-1' },
    ]
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary) })
    const { deps, ccalls } = withCommunity(base, communityLoaded([communityRaw('c-1', 'o1')]))
    const rp = await listMarket(cfg, { withLatest: false, source: 'primary' }, deps)
    assert.equal(ccalls.n, 0)
    assert.deepEqual(rp.items.map((it) => it.id), ['p-1'])
    assert.equal(rp.community.status, 'skipped')
    const rc = await listMarket(cfg, { withLatest: false, source: 'community' }, deps)
    assert.equal(ccalls.n, 1)
    assert.deepEqual(rc.items.map((it) => it.id), ['o1--c-1'])
    assert.equal(rc.community.status, 'ready')
  })

  it('⑧ 双口径计数：categoryCounts=分区集合（不含过滤），total=分区∩query∩category', async () => {
    const primary = [
      { id: 'p-1', name: 'A', description: 'da', category: 'tools', tags: [], source: 'npm', npm: 'pkg-1' },
    ]
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary) })
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('t1', 'o1', { category: 'theme' }),
      communityRaw('t2', 'o2', { category: 'theme' }),
      communityRaw('d1', 'o3', { category: 'dev' }),
    ]))
    const res = await listMarket(cfg, { withLatest: false, source: 'community', category: 'theme' }, deps)
    assert.equal(res.total, 2)
    assert.deepEqual(res.categoryCounts, { essentials: 0, 'cui-picks': 0, 'self-dev': 0, 'tencent-lighthouse': 0, watchlist: 0, theme: 2, dev: 1 })
    const rp = await listMarket(cfg, { withLatest: false, source: 'primary', category: 'theme' }, deps)
    assert.equal(rp.total, 0)
    assert.deepEqual(rp.categoryCounts, { essentials: 0, 'cui-picks': 0, 'self-dev': 0, 'tencent-lighthouse': 0, watchlist: 0, tools: 1 })
  })

  it('⑧b alsoCategories 次级桶：计数双记、过滤双命中、total 去重（0.9.17）', async () => {
    const primary = [
      { id: 'p-1', name: 'A', description: 'da', category: 'essentials', alsoCategories: ['cui-picks'], tags: [], source: 'npm', npm: 'pkg-1' },
    ]
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary) })
    const { deps } = withCommunity(base, communityLoaded([]))
    const cross = await listMarket(cfg, { withLatest: false, category: 'cui-picks' }, deps)
    assert.equal(cross.total, 1, '次级桶过滤命中跨桶条目')
    assert.equal(cross.items[0].id, 'p-1')
    assert.equal(cross.categoryCounts['cui-picks'], 1, '次级桶计数')
    assert.equal(cross.categoryCounts.essentials, 1, '主桶同记')
    const unfiltered = await listMarket(cfg, { withLatest: false }, deps)
    assert.equal(unfiltered.total, 1, 'total 去重：跨桶条目仍是一条')
  })

  it('⑭ sourceCounts 分桶计数（0.9.25 跨区搜索摘要行）：filtered 集合按 community 标记分桶，两处 return 均携带', async () => {
    const primary = [
      { id: 'p-1', name: 'Alpha', description: 'alpha tool', category: 'tools', tags: [], source: 'npm', npm: 'pkg-1' },
      { id: 'p-2', name: 'B', description: 'db', category: 'ui', tags: [], source: 'npm', npm: 'pkg-2' },
    ]
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary) })
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('alpha-c', 'o1'),
      communityRaw('beta', 'o2'),
      communityRaw('gamma', 'o3'),
    ]))
    const all = await listMarket(cfg, { withLatest: false, source: 'all' }, deps)
    assert.deepEqual(all.sourceCounts, { primary: 2, community: 3 })
    const searched = await listMarket(cfg, { withLatest: false, source: 'all', query: 'alpha' }, deps)
    assert.deepEqual(searched.sourceCounts, { primary: 1, community: 1 })
    assert.equal(searched.total, 2)
    const rc = await listMarket(cfg, { withLatest: false, source: 'community' }, deps)
    assert.deepEqual(rc.sourceCounts, { primary: 0, community: 3 })
    const rp = await listMarket(cfg, { withLatest: false, source: 'primary' }, deps)
    assert.deepEqual(rp.sourceCounts, { primary: 2, community: 0 })
  })

  it('⑮ curatedFirst 稳定前置（0.9.26 GUI 跨区搜索）：source=all+query 时精选命中前置、分区内相关序不变；无 flag 不动（tools/CLI 同序）；单分区/空 query 无效', async () => {
    const primary = [
      { id: 'p-weak', name: 'W', description: 'alpha widget', category: 'tools', tags: [], source: 'npm', npm: 'pkg-1' },
      { id: 'p-no', name: 'N', description: 'nothing here', category: 'ui', tags: [], source: 'npm', npm: 'pkg-2' },
    ]
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary) })
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('alpha', 'o1'),      // name 精确含 alpha → 相关分高于 p-weak（仅描述包含）
      communityRaw('other', 'o2'),
    ]))
    // 无 flag（tools/CLI 路径）：相关序交织——社区强命中排前
    const plain = await listMarket(cfg, { withLatest: false, source: 'all', query: 'alpha' }, deps)
    assert.deepEqual(plain.items.map((it) => it.id), ['o1--alpha', 'p-weak'])
    assert.equal(plain.total, 2)
    // 带 flag（GUI 路径）：精选稳定前置，分区内相关序保持；total/sourceCounts 不变
    const cf = await listMarket(cfg, { withLatest: false, source: 'all', query: 'alpha', curatedFirst: true }, deps)
    assert.deepEqual(cf.items.map((it) => it.id), ['p-weak', 'o1--alpha'])
    assert.equal(cf.total, 2)
    assert.deepEqual(cf.sourceCounts, { primary: 1, community: 1 })
    // 空 query：浏览态 merged 序，flag 无效
    const browse = await listMarket(cfg, { withLatest: false, source: 'all', curatedFirst: true }, deps)
    assert.deepEqual(browse.items.map((it) => it.id), ['p-weak', 'p-no', 'o1--alpha', 'o2--other'])
    // 单分区：flag 无效（community 区本就无精选）
    const rc = await listMarket(cfg, { withLatest: false, source: 'community', query: 'alpha', curatedFirst: true }, deps)
    assert.deepEqual(rc.items.map((it) => it.id), ['o1--alpha'])
  })

  it('⑨ sort downloads：无计数 ≠ 0——无数据恒排有数据之后（组内 stars 降序），dir 只翻转有数据组', async () => {
    const base = fakeDeps()
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('small', 'o1', { downloads: 50, stars: 99 }),
      communityRaw('big', 'o2', { downloads: 500, stars: 10 }),
      communityRaw('nodl-lowstar', 'o3', { downloads: null, stars: 5 }),
      communityRaw('nodl-highstar', 'o4', { downloads: null, stars: 9 }),
    ]))
    const desc = await listMarket(cfg, { withLatest: false, source: 'community', sort: { field: 'downloads', dir: 'desc' } }, deps)
    assert.deepEqual(desc.items.map((it) => it.id), ['o2--big', 'o1--small', 'o4--nodl-highstar', 'o3--nodl-lowstar'])
    const asc = await listMarket(cfg, { withLatest: false, source: 'community', sort: { field: 'downloads', dir: 'asc' } }, deps)
    assert.deepEqual(asc.items.map((it) => it.id), ['o1--small', 'o2--big', 'o4--nodl-highstar', 'o3--nodl-lowstar'])
  })

  it('⑩ sort stars：缺失视为 -1 参与正常比较', async () => {
    const base = fakeDeps()
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('mid', 'o1', { stars: 5 }),
      communityRaw('nostar', 'o2', { stars: null }),
      communityRaw('top', 'o3', { stars: 20 }),
    ]))
    const desc = await listMarket(cfg, { withLatest: false, source: 'community', sort: { field: 'stars', dir: 'desc' } }, deps)
    assert.deepEqual(desc.items.map((it) => it.id), ['o3--top', 'o1--mid', 'o2--nostar'])
    const asc = await listMarket(cfg, { withLatest: false, source: 'community', sort: { field: 'stars', dir: 'asc' } }, deps)
    assert.deepEqual(asc.items.map((it) => it.id), ['o2--nostar', 'o1--mid', 'o3--top'])
  })

  it('⑪ sort added：缺失视为最旧（空串日期）参与比较', async () => {
    const base = fakeDeps()
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('jan', 'o1', { added: '2026-01-01' }),
      communityRaw('noadded', 'o2', {}),
      communityRaw('jun', 'o3', { added: '2026-06-01' }),
    ]))
    const desc = await listMarket(cfg, { withLatest: false, source: 'community', sort: { field: 'added', dir: 'desc' } }, deps)
    assert.deepEqual(desc.items.map((it) => it.id), ['o3--jun', 'o1--jan', 'o2--noadded'])
    const asc = await listMarket(cfg, { withLatest: false, source: 'community', sort: { field: 'added', dir: 'asc' } }, deps)
    assert.deepEqual(asc.items.map((it) => it.id), ['o2--noadded', 'o1--jan', 'o3--jun'])
  })

  it('⑫ community.categoryLabels 单一事实源（0.7.0 Task 4）：ready 携带、skipped 不携带；categoryLabelsEn 取上游 categories.en 随行（i18n）', async () => {
    const base = fakeDeps()
    const { deps } = withCommunity(
      base,
      communityLoaded(
        [communityRaw('a', 'o1', { category: 'theme' })],
        {},
        { theme: { en: 'Themes & Appearance', zh: '主题与外观' }, memory: { zh: '记忆' } },
      ),
    )
    const res = await listMarket(cfg, { withLatest: false }, deps)
    assert.equal(res.community.status, 'ready')
    assert.equal(res.community.categoryLabels?.theme, '主题与外观')
    assert.equal(res.community.categoryLabels?.memory, '记忆')
    assert.equal(res.community.categoryLabelsEn?.theme, 'Themes & Appearance')
    assert.equal(res.community.categoryLabelsEn?.memory, undefined, '缺 en 的 id 不进映射（客户端回退中文）')
    const rp = await listMarket(cfg, { withLatest: false, source: 'primary' }, deps)
    assert.equal(rp.community.status, 'skipped')
    assert.equal(rp.community.categoryLabels, undefined)
    assert.equal(rp.community.categoryLabelsEn, undefined)
  })

  it('⑬ sort × query 组合（审计 #20）：相关性优先于用户排序', async () => {
    const base = fakeDeps()
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('exact', 'o1', { downloads: 10 }),
      communityRaw('vague-exact-thing', 'o2', { downloads: 999 }),
    ]))
    // query 'exact'：o1 name 精确（700+300）> o2 name 包含（700+200）；
    // sort downloads-desc 想把 o2 放前——相关性胜出
    const res = await listMarket(cfg, { withLatest: false, source: 'community', query: 'exact', sort: { field: 'downloads', dir: 'desc' } }, deps)
    assert.deepEqual(res.items.map((it) => it.id), ['o1--exact', 'o2--vague-exact-thing'])
  })

  it('④ 主 unavailable + 社区 ready 有条目 → 出页不返空（Q42）', async () => {
    const base = fakeDeps({ loadRegistry: async () => unavailableLoaded() })
    const { deps } = withCommunity(base, communityLoaded([communityRaw('a', 'o1'), communityRaw('b', 'o2')]))
    const res = await listMarket(cfg, { withLatest: false }, deps)
    assert.equal(res.items.length, 2)
    assert.equal(res.registryState.status, 'unavailable')
    assert.equal(res.community.status, 'ready')
    assert.equal(res.community.acceptedCount, 2)
    assert.equal(res.community.upstreamCount, 2)
  })

  it('⑤ 社区 unavailable：主清单照常出页，community.errors 透传', async () => {
    const base = fakeDeps()
    const { deps } = withCommunity(base, communityLoaded([], { status: 'unavailable', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: ['三线路全挂'] }))
    const res = await listMarket(cfg, { withLatest: false, limit: 10 }, deps)
    assert.equal(res.items.length, 10)
    assert.equal(res.community.status, 'unavailable')
    assert.ok(res.community.errors.includes('三线路全挂'))
    assert.equal(res.community.acceptedCount, 0)
  })

  it('⑥ 浏览页探测边界：社区 github 条目零探测，社区 npm 条目照常', async () => {
    const base = fakeDeps()
    const { deps, ccalls } = withCommunity(base, communityLoaded([
      communityRaw('gh-only', 'o9', { npm: null, tarball: 'https://github.com/o9/gh-only/releases/x.tgz', category: 'c-gh' }),
      communityRaw('npm-ok', 'o8', { category: 'c-npm' }),
    ]))
    const res = await listMarket(cfg, { category: 'c-gh', withLatest: true }, deps)
    assert.equal(res.items.length, 1)
    assert.equal(res.items[0].id, 'o9--gh-only')
    assert.equal(res.items[0].latestTag, undefined, '社区 github 条目浏览页不探测')
    assert.equal(ccalls.n, 1, '社区 loader 每次市场请求各跑一个 waiter')
    const res2 = await listMarket(cfg, { category: 'c-npm', withLatest: true }, deps)
    assert.equal(res2.items[0].latestVersion, '2.0.0', '社区 npm 条目探测照常')
  })

  it('⑦ 搜索匹配英文描述', async () => {
    const base = fakeDeps()
    const { deps } = withCommunity(base, communityLoaded([communityRaw('special', 'o7')]))
    const res = await listMarket(cfg, { query: 'AWESOME Thing', withLatest: false }, deps)
    assert.equal(res.total, 1)
    assert.equal(res.items[0].id, 'o7--special')
  })

  it('⑧ categoryCounts 含社区开放键且保留精选 5 键', async () => {
    const base = fakeDeps()
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('a', 'o1', { category: 'c-ui' }),
      communityRaw('b', 'o2', { category: 'my-slug' }),
      communityRaw('c', 'o3', { category: 'tools' }), // 与精选共享桶
    ]))
    const res = await listMarket(cfg, { withLatest: false }, deps)
    assert.equal(res.categoryCounts['c-ui'], 1)
    assert.equal(res.categoryCounts['my-slug'], 1)
    assert.equal(res.categoryCounts.tools, 201, '共享桶：主清单 200 + 社区 1')
    assert.equal(res.categoryCounts.market, 200)
    assert.equal(typeof res.categoryCounts.other, 'number')
  })

  it('⑩ 已装页合并匹配社区条目并标 community，InstalledResult 携带 community summary', async () => {
    const installed = {
      items: [{
        pkg: 'special-pkg', name: 'S', version: '0.9.0', description: '', homepage: '',
        spec: '0.9.0', source: 'npm', dsh: true, path: '/tmp/node_modules/special-pkg',
      }],
      others: 0,
      complete: true,
      profileDir: '/tmp/profile',
    }
    const base = fakeDeps({ listInstalledPlugins: async () => installed })
    const { deps } = withCommunity(base, communityLoaded([communityRaw('special', 'o5', { npm: 'special-pkg' })]))
    const res = await listInstalledWithMeta(cfg, {}, deps)
    assert.equal(res.items[0].registryId, 'o5--special')
    assert.equal(res.items[0].community, true)
    assert.equal(res.community.status, 'ready')
    assert.equal(res.community.acceptedCount, 1)
  })

  it('⑪ 端到端 deadline：主慢 + 社区慢 → deadline 收敛，community 标超时；社区 waiter abort 传播', async () => {
    const slowBase = fakeDeps({
      loadRegistry: () => new Promise((r) => setTimeout(() => r(readyLoaded(makeThousand())), 400)),
    })
    const { deps } = withCommunity(slowBase, communityLoaded([communityRaw('x', 'o')]), { hangForever: true })
    const t0 = Date.now()
    const res = await listMarket(cfg, { deadlineMs: 120, withLatest: false }, deps)
    assert.ok(Date.now() - t0 < 5000, 'deadline 收敛而不是等慢服务器')
    assert.equal(res.registryState.status, 'unavailable')
    assert.equal(res.community.status, 'unavailable')
    assert.ok(res.community.errors[0]?.includes('超时'), 'waiter 到点 → summary 标超时')

    const abortBase = fakeDeps()
    const { deps: deps2, ccalls: ccalls2 } = withCommunity(abortBase, communityLoaded([communityRaw('x', 'o')]), { rejectAbort: true })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 20)
    await assert.rejects(() => listMarket(cfg, { signal: ac.signal, withLatest: false }, deps2), (err) => err.name === 'AbortError')
    assert.ok(ccalls2.opts[0]?.signal, 'listMarket 以 waiter 身份携带调用者 signal')
  })
})

// ---------- M1 Task 7：三端语义（工具 deadline 对齐 / CLI 双源 / latestError 结构化呈现） ----------

function toolContext(signal) {
  return signal ? { signal } : undefined
}

describe('M1 Task 7：agent 工具契约', () => {
  async function loadToolsWith(overrides = {}) {
    const { registerTools } = await import('../lib/tools.js')
    const registered = []
    const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {} }
    const calls = { search: [], list: [], outdated: [] }
    const marketResult = overrides.marketResult ?? (await (async () => {
      const { deps } = fakeDeps()
      return listMarket(cfg, { limit: 5, withLatest: false }, deps)
    })())
    const installedResult = overrides.installedResult ?? (await (async () => {
      const { deps } = fakeDeps({ listInstalledPlugins: async () => ({ items: [], others: 0, complete: true, profileDir: '/tmp/p' }) })
      return listInstalledWithMeta(cfg, {}, deps)
    })())
    registerTools(ctx, cfg, {
      listMarket: async (c, opts) => {
        calls.search.push(opts)
        return marketResult
      },
      listInstalledWithMeta: async (c, opts) => {
        calls[overrides.tool === 'outdated' ? 'outdated' : 'list'].push(opts)
        return installedResult
      },
    })
    return { registered, calls }
  }

  it('① dshm_search 接受社区 slug 与 source 分区并透传 core（0.7.0：primary_only 已删除）', async () => {
    const { registered, calls } = await loadToolsWith()
    const search = registered.find((t) => t.name === 'dshm_search')
    await search.execute({ category: 'memory', source: 'primary' })
    assert.equal(calls.search[0].category, 'memory')
    assert.equal(calls.search[0].source, 'primary')
    assert.equal(calls.search[0].primaryOnly, undefined, 'primaryOnly 契约已由 source 取代')
    await assert.rejects(() => search.execute({ category: 'BAD!' }), /非法分类/)
    await assert.rejects(() => search.execute({ source: 'zone' }), /非法 source/)
    assert.equal(calls.search.length, 1, '非法参数不下发 core')
  })

  it('⑦ deadline 对齐：search 44s、list/outdated 60s，且透传 exec.signal', async () => {
    const { registered, calls } = await loadToolsWith()
    const search = registered.find((t) => t.name === 'dshm_search')
    const list = registered.find((t) => t.name === 'dshm_list')
    const outdated = registered.find((t) => t.name === 'dshm_outdated')
    assert.equal(search.timeoutMs, 45_000)
    assert.equal(list.timeoutMs, 65_000)
    assert.equal(outdated.timeoutMs, 65_000)
    const ac = new AbortController()
    await search.execute({}, toolContext(ac.signal))
    assert.equal(calls.search[0].deadlineMs, 44_000)
    assert.equal(calls.search[0].signal, ac.signal)
    await list.execute({}, toolContext(ac.signal))
    assert.equal(calls.list[0].deadlineMs, 60_000)
    assert.equal(calls.list[0].signal, ac.signal)
    await outdated.execute({}, toolContext(ac.signal))
    assert.equal(calls.outdated.length + calls.list.length >= 2, true)
    const outdatedCall = calls.outdated[0] ?? calls.list[1]
    assert.equal(outdatedCall.deadlineMs, 60_000)
    assert.equal(outdatedCall.signal, ac.signal)
  })

  it('⑦-2 慢 core + exec.signal abort → 工具 execute 随 signal 中止（不悬挂到 65s）', async () => {
    const { registerTools } = await import('../lib/tools.js')
    const registered = []
    registerTools({ tools: { register: (t) => registered.push(t) }, inject: () => {} }, cfg, {
      listInstalledWithMeta: (_c, opts) => new Promise((_, rej) => {
        opts?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      }),
    })
    const list = registered.find((t) => t.name === 'dshm_list')
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 30)
    const t0 = Date.now()
    await assert.rejects(() => list.execute({}, toolContext(ac.signal)), (err) => err.name === 'AbortError')
    assert.ok(Date.now() - t0 < 5000, 'signal 贯通：abort 即中止而不是等 65s 工具超时')
  })

  it('② dshm_search/list/outdated 投影 community summary 四键', async () => {
    const community = {
      enabled: true, status: 'ready', version: '2026.928.1', checkedAt: 't', fetchedAt: 't',
      route: 'jsdelivr', acceptedCount: 4189, upstreamCount: 4377, displaced: 3,
      skippedDirty: 0, skippedSubpathNoNpm: 188, errors: [], warnings: [],
    }
    const { registered } = await loadToolsWith({
      marketResult: { items: [], total: 0, offset: 0, limit: 80, categoryCounts: {}, registryState: { configuredAddress: '', activeAddress: null, source: 'bundled', status: 'ready', isDefault: true, stale: false, fetchedAt: null, errors: [], count: 0 }, installedComplete: true, latestComplete: true, latestTimedOut: false, community },
      installedResult: { items: [], others: 0, profileDir: '/tmp/p', registryState: { configuredAddress: '', activeAddress: null, source: 'bundled', status: 'ready', isDefault: true, stale: false, fetchedAt: null, errors: [], count: 0 }, community },
    })
    for (const name of ['dshm_search', 'dshm_list', 'dshm_outdated']) {
      const tool = registered.find((t) => t.name === name)
      const out = await tool.execute({})
      assert.deepEqual(out.community, { acceptedCount: 4189, route: 'jsdelivr', status: 'ready', version: '2026.928.1' })
    }
  })

  it('⑨ dshm_outdated：有未完成时标题不写「全部最新」，投影含 code 与未完成数', async () => {
    const installedItem = (i, extra = {}) => ({
      pkg: `p-${i}`, name: `P${i}`, version: '1.0.0', source: 'npm', spec: '1.0.0',
      outdated: false, ...extra,
    })
    const installedResult = {
      items: [
        installedItem(1, { latestVersion: '2.0.0', outdated: true }),
        installedItem(2, { latestErrorCode: 'budget-exhausted', latestError: 'GitHub 更新检查预算已用尽' }),
        installedItem(3),
      ],
      others: 0,
      profileDir: '/tmp/p',
      registryState: { configuredAddress: '', activeAddress: null, source: 'bundled', status: 'ready', isDefault: true, stale: false, fetchedAt: null, errors: [], count: 3 },
      community: { enabled: true, status: 'ready', version: 'v', checkedAt: 't', fetchedAt: 't', route: 'r', acceptedCount: 1, upstreamCount: 1, displaced: 0, skippedDirty: 0, skippedSubpathNoNpm: 0, errors: [], warnings: [] },
    }
    const { registered } = await loadToolsWith({ installedResult, tool: 'outdated' })
    const outdated = registered.find((t) => t.name === 'dshm_outdated')
    const out = await outdated.execute({})
    assert.equal(out.incompleteCount, 1)
    assert.equal(out.items[1].latestErrorCode, 'budget-exhausted')
    const rendered = outdated.output.render({}, out)
    assert.ok(rendered[0].text.includes('1 项检查未完成'))
    assert.ok(rendered[0].text.includes('因 GitHub 预算未完成'))
    const title = outdated.presentResult({}, { isError: false, meta: out }).title
    assert.ok(title.includes('检查未完成'), `标题不得写「全部最新」：${title}`)
  })

  it('⑩ installed-view 视图模型含 latestError 标注字段', async () => {
    const { installedViewModel } = await import('../src/client/installed-view.js')
    const base = { pkg: 'p', spec: '1.0.0', source: 'npm' }
    assert.equal(installedViewModel({ ...base }).latestIssue, null)
    const withIssue = installedViewModel({ ...base, latestError: 'GitHub 更新检查预算已用尽', latestErrorCode: 'budget-exhausted' })
    assert.deepEqual(withIssue.latestIssue, { code: 'budget-exhausted', note: 'GitHub 更新检查预算已用尽' })
  })
})

describe('M1 Task 7：CLI 双源判定与 latestError 呈现', () => {
  async function run(argv, deps, io) {
    const { runCli } = await import('../lib/cli.js')
    return runCli(argv, deps, io)
  }

  function readyCommunitySummary(overrides = {}) {
    return {
      enabled: true, status: 'ready', version: '2026.928.1', checkedAt: 't', fetchedAt: 't',
      route: 'jsdelivr', acceptedCount: 4189, upstreamCount: 4377, displaced: 3,
      skippedDirty: 0, skippedSubpathNoNpm: 188, errors: [], warnings: [], ...overrides,
    }
  }

  it('③④ CLI search 双源：主 unavailable + 社区 ready → exit 0 + 提示；两层不可用 → exit 1', async () => {
    const lines = []
    const errs = []
    const code1 = await run(['search'], {
      listMarket: async () => ({
        items: [{ id: 'o--x', name: 'X', description: 'd', category: 'ui', tags: [], source: 'npm', npm: 'x', installed: false }],
        total: 1, offset: 0, limit: 80, categoryCounts: { ui: 1 },
        registryState: { configuredAddress: '', activeAddress: null, source: 'default-cache', status: 'unavailable', isDefault: true, stale: false, fetchedAt: null, errors: ['x'], count: 0 },
        installedComplete: true, latestComplete: true, latestTimedOut: false,
        community: readyCommunitySummary({ acceptedCount: 1, upstreamCount: 1, displaced: 0, skippedSubpathNoNpm: 0 }),
      }),
    }, { out: (l) => lines.push(l), err: (l) => errs.push(l) })
    assert.equal(code1, 0)
    assert.ok(errs.some((l) => l.includes('社区清单条目')))
    assert.ok(lines.some((l) => l.includes('o--x')))

    const code2 = await run(['search'], {
      listMarket: async () => ({
        items: [], total: 0, offset: 0, limit: 80, categoryCounts: {},
        registryState: { configuredAddress: '', activeAddress: null, source: 'default-cache', status: 'unavailable', isDefault: true, stale: false, fetchedAt: null, errors: ['x'], count: 0 },
        installedComplete: false, latestComplete: false, latestTimedOut: false,
        community: readyCommunitySummary({ status: 'unavailable', acceptedCount: 0, upstreamCount: 0, displaced: 0, skippedSubpathNoNpm: 0, version: null, route: null }),
      }),
    }, { out: (l) => lines.push(l), err: (l) => errs.push(l) })
    assert.equal(code2, 1)
  })

  it('⑥ CLI env 映射：DSHM_COMMUNITY_CATALOG=0 → communityCatalog:false', async () => {
    process.env.DSHM_COMMUNITY_CATALOG = '0'
    try {
      const seen = []
      await run(['search'], {
        listMarket: async (c) => {
          seen.push(c)
          return { items: [], total: 0, offset: 0, limit: 80, categoryCounts: {}, registryState: { configuredAddress: '', activeAddress: null, source: 'bundled', status: 'ready', isDefault: true, stale: false, fetchedAt: null, errors: [], count: 0 }, installedComplete: true, latestComplete: true, latestTimedOut: false, community: readyCommunitySummary({ status: 'disabled', acceptedCount: 0, upstreamCount: null, displaced: 0, skippedSubpathNoNpm: 0, version: null, route: null }) }
        },
      }, { out: () => {}, err: () => {} })
      assert.equal(seen[0].communityCatalog, false)
    } finally {
      delete process.env.DSHM_COMMUNITY_CATALOG
    }
  })

  it('⑧ CLI outdated 双源：主 unavailable + 社区 ready → 正常输出 + warning；stale → 缓存快照行；两层不可用 → exit 1', async () => {
    const lines = []
    const errs = []
    const code1 = await run(['outdated'], {
      listInstalledWithMeta: async () => ({
        items: [], others: 0, profileDir: '/tmp/p',
        registryState: { configuredAddress: '', activeAddress: null, source: 'default-cache', status: 'unavailable', isDefault: true, stale: false, fetchedAt: null, errors: ['x'], count: 0 },
        community: readyCommunitySummary(),
      }),
    }, { out: (l) => lines.push(l), err: (l) => errs.push(l) })
    assert.equal(code1, 0)
    assert.ok(errs.some((l) => l.includes('收录清单不可用')))

    const code2 = await run(['outdated'], {
      listInstalledWithMeta: async () => ({
        items: [], others: 0, profileDir: '/tmp/p',
        registryState: { configuredAddress: '', activeAddress: null, source: 'bundled', status: 'ready', isDefault: true, stale: false, fetchedAt: null, errors: [], count: 0 },
        community: readyCommunitySummary({ status: 'stale' }),
      }),
    }, { out: (l) => lines.push(l), err: (l) => errs.push(l) })
    assert.equal(code2, 0)
    assert.ok(errs.some((l) => l.includes('缓存快照')))

    const code3 = await run(['outdated'], {
      listInstalledWithMeta: async () => ({
        items: [], others: 0, profileDir: '/tmp/p',
        registryState: { configuredAddress: '', activeAddress: null, source: 'default-cache', status: 'unavailable', isDefault: true, stale: false, fetchedAt: null, errors: ['x'], count: 0 },
        community: readyCommunitySummary({ status: 'unavailable', acceptedCount: 0, upstreamCount: 0, displaced: 0, skippedSubpathNoNpm: 0, version: null, route: null }),
      }),
    }, { out: (l) => lines.push(l), err: (l) => errs.push(l) })
    assert.equal(code3, 1)
  })

  it('⑨ CLI outdated：有未完成时不输出「全部最新」，按 code 列原因', async () => {
    const lines = []
    const code = await run(['outdated'], {
      listInstalledWithMeta: async () => ({
        items: [
          { pkg: 'a', name: 'A', version: '1.0.0', source: 'npm', spec: '1.0.0', outdated: false, latestErrorCode: 'timeout', latestError: '更新检查未完成：超时' },
          { pkg: 'b', name: 'B', version: '1.0.0', source: 'npm', spec: '1.0.0', outdated: false },
        ],
        others: 0, profileDir: '/tmp/p',
        registryState: { configuredAddress: '', activeAddress: null, source: 'bundled', status: 'ready', isDefault: true, stale: false, fetchedAt: null, errors: [], count: 2 },
        community: readyCommunitySummary(),
      }),
    }, { out: (l) => lines.push(l), err: () => {} })
    assert.equal(code, 0)
    const text = lines.join('\n')
    assert.ok(!text.includes('均已是最新版本'), '未完成时禁止「全部最新」结论')
    assert.ok(text.includes('1 项检查未完成'))
    assert.ok(text.includes('检查超时'))
  })
})

describe('M1 Task 7：probe deadline 硬上限与双 waiter 顺序', () => {
  it('⑪b probe 级硬上限：deadline 后排队条目标未完成且停止派发新 probe', async () => {
    const { deps } = fakeDeps()
    let probeCalls = 0
    const sha = 'a'.repeat(40)
    const installed = {
      items: Array.from({ length: 20 }, (_, i) => ({
        pkg: `gh-${i}`, name: `G${i}`, version: '1.0.0', description: '', homepage: '',
        spec: `github:o/r${i}#${sha}`, source: 'github', dsh: true, path: `/x/gh-${i}`,
      })),
      others: 0, complete: true, profileDir: '/tmp/profile',
    }
    const registryPlugins = Array.from({ length: 20 }, (_, i) => ({
      id: `g-${i}`, name: `G${i}`, description: 'd', category: 'tools', tags: [], source: 'github', github: `o/r${i}`,
    }))
    const testDeps = {
      ...deps,
      listInstalledPlugins: async () => installed,
      loadRegistry: async () => readyLoaded(registryPlugins, { configuredAddress: `probe-cap-${Date.now()}` }),
      githubLatestTag: async () => {
        probeCalls += 1
        await sleep(300)
        return { tag: 'v1.0.0', sha }
      },
      fetchCommunityCatalog: async () => ({
        state: { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] },
        catalog: null,
      }),
    }
    const res = await listInstalledWithMeta({ timeoutMs: 20_000, cacheTtlMin: 0 }, { deadlineMs: 590 }, testDeps)
    assert.ok(probeCalls <= 16, `deadline 后停止派发新 probe（实际 ${probeCalls}）`)
    const unfinished = res.items.filter((it) => it.latestErrorCode === 'timeout')
    assert.ok(unfinished.length >= 4, `排队条目标未完成（实际 ${unfinished.length}）`)
    assert.ok(res.items.every((it) => it.latestTag !== undefined || it.latestErrorCode !== undefined), '每条要么完成要么标未完成（不漏计）')
  })

  it('⑫e (A) 短 deadline summary waiter 先建共享 flight → 长 deadline market waiter 加入且社区加载完成', async () => {
    const loaded = communityLoaded([communityRaw('x', 'o')])
    const slowTask = () => new Promise((resolve) => setTimeout(() => resolve(loaded), 400))
    const primary = [{ id: 'p-0', name: 'P', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'pkg-0' }]
    const sharedTask = slowTask()
    const summaryOutcome = await communityOutcome(sharedTask, Date.now() + 120, primary)
    assert.equal(summaryOutcome.summary.status, 'unavailable', 'summary waiter 120ms 到点返回 unavailable')
    const marketOutcome = await communityOutcome(sharedTask, Date.now() + 5000, primary)
    assert.equal(marketOutcome.summary.status, 'ready', 'flight 未被 3s/120ms 截断——market waiter 正常完成')
  })

  it('⑫e (B) listMarket 先建 flight → summary waiter 提前退出 → market 照常完成', async () => {
    const loaded = communityLoaded([communityRaw('x', 'o')])
    const primary = [{ id: 'p-0', name: 'P', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'pkg-0' }]
    const sharedTask = new Promise((resolve) => setTimeout(() => resolve(loaded), 400))
    const marketP = communityOutcome(sharedTask, Date.now() + 5000, primary)
    const summaryOutcome = await communityOutcome(sharedTask, Date.now() + 120, primary)
    assert.equal(summaryOutcome.summary.status, 'unavailable')
    const marketOutcome = await marketP
    assert.equal(marketOutcome.summary.status, 'ready', 'summary 提前退出不中止共享 flight')
  })
})

// ---------- M2 Task 3：统一 session + 装后守卫接线 ----------

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
    const { selfUpgrade } = await import('../lib/core/market.js')
    await assert.rejects(
      () => selfUpgrade('dsh-m', '0.0.0', {}, {}, { npmLatest: async () => ({ version: '9.9.9' }) }),
      /缺少 dist integrity/,
    )
  })

  it('㉓ withMutationSession 串行：并发安装/卸载不交错（FIFO）', async () => {
    const { withMutationSession } = await import('../lib/core/market.js')
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

  it('主清单与社区均未命中 → 维持「不是经 dsh-m 收录」报错', async () => {
    const deps = {
      loadRegistry: async () => readyLoaded([]),
      listInstalledPlugins: async () => ({ items: [{ pkg: 'pkg-x', name: 'pkg-x', version: '1.0.0', source: 'npm', spec: 'pkg-x@1.0.0' }], others: 0, complete: true, profileDir: '/tmp/profile' }),
      fetchCommunityCatalog: async () => communityLoaded([]),
    }
    await assert.rejects(
      () => upgradePlugin('pkg-x', cfg, {}, deps),
      (err) => err instanceof Error && /不是经 dsh-m 收录/.test(err.message),
    )
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

describe('0.9.0 双 profile：读模型贯穿', () => {
  const disabledCommunity = async () => ({
    state: {
      enabled: false, status: 'disabled', version: null, checkedAt: null,
      fetchedAt: null, route: null, count: 0, errors: [], warnings: [],
    },
    catalog: null,
  })

  it('listInstalledWithMeta 透传 profileDir（已装枚举）与 profile（缓存段）', async () => {
    const seen = { listInstalled: [], loadRegistry: [], community: [] }
    const deps = {
      loadRegistry: async (cfg, opts) => {
        seen.loadRegistry.push(opts)
        return unavailableLoaded()
      },
      listInstalledPlugins: async (dir) => {
        seen.listInstalled.push(dir ?? null)
        return { items: [], others: 0, complete: true, profileDir: dir ?? '/web-default' }
      },
      fetchCommunityCatalog: async (cfg, opts) => {
        seen.community.push(opts)
        return disabledCommunity()
      },
    }
    const res = await listInstalledWithMeta({}, { profileDir: '/d/profiles/desktop', profile: 'desktop' }, deps)
    assert.deepEqual(seen.listInstalled, ['/d/profiles/desktop'])
    assert.equal(seen.loadRegistry[0].profile, 'desktop')
    assert.equal(seen.community[0].profile, 'desktop')
    assert.equal(res.profileDir, '/d/profiles/desktop')
  })

  it('缺省（web）行为零漂移：listInstalledPlugins 收到 undefined', async () => {
    const seen = { listInstalled: [] }
    const deps = {
      loadRegistry: async () => unavailableLoaded(),
      listInstalledPlugins: async (dir) => {
        seen.listInstalled.push(dir ?? null)
        return { items: [], others: 0, complete: true, profileDir: '/web-default' }
      },
      fetchCommunityCatalog: disabledCommunity,
    }
    await listInstalledWithMeta({}, {}, deps)
    // dir ?? null 归一化后记录；undefined 透传给 listInstalledPlugins → 触发其 webProfileDir() 缺省
    assert.deepEqual(seen.listInstalled, [null])
  })

  it('listMarket 透传 profile 缓存段（loadRegistry/fetchCommunityCatalog）', async () => {
    const seen = { loadRegistry: [], community: [] }
    const deps = {
      loadRegistry: async (cfg, opts) => {
        seen.loadRegistry.push(opts)
        return unavailableLoaded()
      },
      listInstalledPlugins: async () => ({ items: [], others: 0, complete: true, profileDir: '/w' }),
      fetchCommunityCatalog: async (cfg, opts) => {
        seen.community.push(opts)
        return disabledCommunity()
      },
    }
    await listMarket({}, { profile: 'desktop' }, deps)
    assert.equal(seen.loadRegistry[0].profile, 'desktop')
    assert.equal(seen.community[0].profile, 'desktop')
  })
})

// ---------- 0.9.20：latest 缓存纯内存 + mutation 定向失效（ADR-0006） ----------

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

describe('market probeMode 与 force 探测（0.9.45 两段加载，ADR-0013）', () => {
  beforeEach(() => resetLatestCacheForTest())
  const oneEntry = (id, npm) => [{ id, name: id.toUpperCase(), description: 'd', category: 'tools', tags: [], source: 'npm', npm }]

  it('cache-only：缓存命中直用、零网络、无缺口 latestComplete=true', async () => {
    const { deps, calls } = fakeDeps({ loadRegistry: async () => readyLoaded(oneEntry('a', 'pkg-a'), { configuredAddress: 'reg-co-warm' }) })
    await listMarket({}, { source: 'primary', limit: 32 }, deps) // 暖缓存（full 缺省）
    assert.equal(calls.npm.length, 1)
    const res = await listMarket({}, { source: 'primary', limit: 32, probeMode: 'cache-only' }, deps)
    assert.equal(calls.npm.length, 1, 'cache-only 零网络')
    assert.equal(res.items[0].latestVersion, '2.0.0', '缓存命中直用')
    assert.equal(res.latestComplete, true, '无缺口不需要第二段')
  })

  it('cache-only：冷缓存有缺口 → latestComplete=false 且零网络（客户端据此发起第二段）', async () => {
    const { deps, calls } = fakeDeps({ loadRegistry: async () => readyLoaded(oneEntry('b', 'pkg-b'), { configuredAddress: 'reg-co-cold' }) })
    const res = await listMarket({}, { source: 'primary', limit: 32, probeMode: 'cache-only' }, deps)
    assert.equal(calls.npm.length, 0)
    assert.equal(res.latestComplete, false)
    assert.equal(res.items[0].latestVersion, undefined)
  })

  it('cache-only：缺口判定豁免社区 github 条目（Q46）——github 缺口不构成第二段理由', async () => {
    // 构造镜像本文件既有 ⑥ 用例（R13：catalog 键为 plugins、条目无显式 id——适配层派生
    // `${owner}--${name}`；github 条目 npm 置 null；withCommunity 签名以文件内既有用例为准）
    // R16：withCommunity 返回 { deps, ccalls }——npm 捕获在 fakeDeps 的 base.calls.npm
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(oneEntry('g', 'pkg-g'), { configuredAddress: 'reg-gh' }) })
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('gh-only', 'o9', { npm: null, tarball: 'https://example.com/gh-only.tgz', category: 'c-gh' }),
    ]))
    await listMarket({}, { source: 'all', limit: 32 }, deps) // 暖缓存（npm 探测 1 次）
    assert.equal(base.calls.npm.length, 1)
    const res = await listMarket({}, { source: 'all', limit: 32, probeMode: 'cache-only' }, deps)
    assert.equal(base.calls.npm.length, 1, '第二段零网络（github 缺口被豁免）')
    assert.equal(res.latestComplete, true, 'github 条目不构成缺口（Q46 永久缺口，R5）')
  })

  it('cache-only：已装条目照常计算 outdated（暖缓存不丢「可升级」徽标，R3）', async () => {
    const { deps } = fakeDeps({
      loadRegistry: async () => readyLoaded(oneEntry('h', 'pkg-h'), { configuredAddress: 'reg-co-out' }),
      listInstalledPlugins: async () => ({ items: [{ pkg: 'pkg-h', name: 'H', version: '1.0.0', source: 'npm', spec: 'npm:pkg-h' }], others: 0, complete: true, profileDir: '/tmp/profile' }),
    })
    await listMarket({}, { source: 'primary', limit: 32 }, deps) // 暖缓存
    const res = await listMarket({}, { source: 'primary', limit: 32, probeMode: 'cache-only' }, deps)
    assert.equal(res.items[0].latestVersion, '2.0.0')
    assert.equal(res.items[0].outdated, true, 'cache-only 也产出 outdated')
  })

  it('force：peek 旧值兜底 + 全页重探，成功覆盖旧值（不走 ttlMin=0）', async () => {
    let n = 0
    const { deps, calls } = fakeDeps({
      loadRegistry: async () => readyLoaded(oneEntry('i', 'pkg-i'), { configuredAddress: 'reg-force-ok' }),
      npmLatest: async (pkg) => { n += 1; calls.npm.push(pkg); return { version: n === 1 ? '2.0.0' : '3.0.0' } },
    })
    await listMarket({}, { source: 'primary', limit: 32 }, deps) // 暖缓存 2.0.0
    const res = await listMarket({}, { source: 'primary', limit: 32, force: true }, deps)
    assert.equal(calls.npm.length, 2, 'TTL 内也全页重探')
    assert.equal(res.items[0].latestVersion, '3.0.0')
    assert.equal(res.latestComplete, true)
  })

  it('force：重探失败保留旧值 + latestError（peek 不删除，ADR-0006 在案约束，R6）', async () => {
    const { deps, calls } = fakeDeps({
      loadRegistry: async () => readyLoaded(oneEntry('j', 'pkg-j'), { configuredAddress: 'reg-force-fail' }),
      npmLatest: async (pkg) => { calls.npm.push(pkg); if (calls.npm.length === 1) return { version: '2.0.0' }; throw new Error('boom') },
    })
    await listMarket({}, { source: 'primary', limit: 32 }, deps) // 暖缓存 2.0.0
    const res = await listMarket({}, { source: 'primary', limit: 32, force: true }, deps)
    assert.equal(calls.npm.length, 2)
    assert.equal(res.items[0].latestVersion, '2.0.0', '旧值兜底未被删除')
    assert.ok(res.items[0].latestError, '探测失败如实标注')
  })

  it('withLatest=false：probeMode/force 均不生效（tools/CLI 契约不变）', async () => {
    const { deps, calls } = fakeDeps({ loadRegistry: async () => readyLoaded(oneEntry('k', 'pkg-k'), { configuredAddress: 'reg-wl' }) })
    const res = await listMarket({}, { source: 'primary', limit: 32, withLatest: false, probeMode: 'cache-only', force: true }, deps)
    assert.equal(calls.npm.length, 0)
    assert.equal(res.latestComplete, true, '未进探测段，维持既有 true 契约')
  })
})
