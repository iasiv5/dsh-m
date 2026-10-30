/**
 * Task 3：服务端分页、latest cache、deadline/abort、unavailable 契约与 host/cli namespace。
 * Task 3 桥接：transaction 注入与 legacy 槽位逐操作回退。
 * 运行：npm run build && node --test tests/market.test.mjs
 */
import { describe, it, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listMarket, listInstalledWithMeta, existingMarketIds } from '../lib/core/market.js'
import { upgradePathFor } from '../lib/core/upgrade-target.js'
import { communityOutcome } from '../lib/core/merged-market.js'
import '../lib/core/compat-check.js';
import { resetLatestCacheForTest } from '../lib/core/latest-cache.js'
import { _resetMergedMarketForTests, _mergedMarketStatsForTests } from '../lib/core/merged-market.js'
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

// ADR-0024 分册：写侧 describe 迁出后，本文件仍被读侧社区用例使用的夹具 helper 就地保留。
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

describe('listMarket：installed 匹配索引等价（FP5 2026-10-15，钉住与 matchInstalledByEntry 逐点一致）', () => {
  // 数组序即语义契约：name 域序 0（x-pkg）必须压过 pkg 域序 1（alpha）
  const installed = {
    items: [
      { pkg: 'x-pkg', name: 'alpha', version: '1.0.0', description: '', homepage: '', spec: '^1.0.0', source: 'npm', dsh: true, path: '/tmp/x-pkg' },
      { pkg: 'alpha', name: 'z-name', version: '2.0.0', description: '', homepage: '', spec: '^2.0.0', source: 'npm', dsh: true, path: '/tmp/alpha' },
      { pkg: 'gh-plugin', name: 'gh-plugin', version: '3.0.0', description: '', homepage: '', spec: 'github:owner/repo#abc', source: 'github', dsh: true, path: '/tmp/gh-plugin' },
      // spec 形如 github 但 source=npm → github 域不得命中（守卫用例，repo 与上条隔离）
      { pkg: 'npm-lookalike', name: 'npm-lookalike', version: '4.0.0', description: '', homepage: '', spec: 'github:other/repo#abc', source: 'npm', dsh: true, path: '/tmp/npm-lookalike' },
    ],
    others: 0,
    complete: true,
    profileDir: '/tmp/p',
  }
  const registry = [
    { id: 'e-alpha', name: 'EA', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'alpha' },
    { id: 'e-xpkg', name: 'EX', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'x-pkg' },
    { id: 'e-github', name: 'EG', description: 'd', category: 'tools', tags: [], source: 'github', github: 'owner/repo' },
    { id: 'e-guard', name: 'EG2', description: 'd', category: 'tools', tags: [], source: 'github', github: 'other/repo' },
  ]

  it('name 域序 0 胜 pkg 域序 1；pkg 直接命中；github 命中；source=npm 的 github 形 spec 不命中', async () => {
    const { deps } = fakeDeps({
      loadRegistry: async () => readyLoaded(registry),
      listInstalledPlugins: async () => installed,
    })
    const res = await listMarket(cfg, { withLatest: false }, deps)
    const by = (id) => res.items.find((e) => e.id === id)
    assert.equal(res.items.length, 4)
    assert.equal(by('e-alpha').installed, true)
    assert.equal(by('e-alpha').installedPkg, 'x-pkg', 'name 域序 0（x-pkg）压过 pkg 域序 1（alpha）')
    assert.equal(by('e-alpha').installedVersion, '1.0.0')
    assert.equal(by('e-xpkg').installed, true)
    assert.equal(by('e-xpkg').installedPkg, 'x-pkg')
    assert.equal(by('e-github').installed, true)
    assert.equal(by('e-github').installedPkg, 'gh-plugin')
    assert.equal(by('e-guard').installed, false, 'spec 形如 github 但 installed.source=npm → github 域不命中')
  })
})

describe('existingMarketIds（FP2 2026-10-15：收藏 stale 批量化，三不原则——不枚举已装/不探测 latest/不分页）', () => {
  it('① 存在/缺席/顺序/重复：present 按输入序过滤，不调用 listInstalledPlugins', async () => {
    const { deps, calls } = fakeDeps()
    const res = await existingMarketIds(['p-0', 'nope', 'p-999', 'p-0'], cfg, {}, deps)
    assert.deepEqual(res.present, ['p-0', 'p-999', 'p-0'])
    assert.equal(calls.listInstalled, 0, '不枚举已装（性能钉）')
    assert.equal(calls.npm.length, 0, '不探测 latest')
  })

  it('② 空 ids 快路：不装载 registry', async () => {
    const { deps, calls } = fakeDeps()
    const res = await existingMarketIds([], cfg, {}, deps)
    assert.deepEqual(res.present, [])
    assert.equal(calls.loadRegistry.length, 0, '空 ids 立即返回，零装载')
  })

  it('③ 同身份 L2 命中钉：listMarket 落代后 existingMarketIds 免重建（builds 不增 + hits 增加）', async () => {
    const primary = [{ id: 'p-0', name: 'P0', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'pkg-0' }]
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary) })
    const { deps } = withCommunity(base, communityLoaded([communityRaw('keep', 'o2')]))
    const first = await listMarket(cfg, { withLatest: false }, deps)
    assert.equal(first.total, 2)
    assert.equal(_mergedMarketStatsForTests().builds, 1, '首次查询落代')
    const res = await existingMarketIds(['p-0', 'o2--keep'], cfg, {}, deps)
    assert.deepEqual(res.present, ['p-0', 'o2--keep'], '主清单 + 社区合成 id（owner--name 小写）均命中')
    assert.equal(_mergedMarketStatsForTests().builds, 1, '同身份第二次查询不重建代')
    assert.ok(_mergedMarketStatsForTests().hits >= 1, '命中代的直接证据')
  })

  it('④ curatedFirst 挤出边界钉：id-exact 社区条目不被 primary 同词命中挤出（旧搜索页扇出在此构造下判 stale，属误判）', async () => {
    // 旧路径 = market {query:'dsh--market', source:'all', limit:8, curatedFirst:true}：query 分词 ['dsh','market']，
    // 10 条 primary name「DSH Market i」同字段全词命中（1050 分）进 filtered，curatedFirst 全部前置 →
    // id-exact（10000 分）的社区条目被挤出前 8 → items.some(id) 为 false → 误判 stale。
    // 批量版 = merged 域 id Set 成员判定 → 判 live（=「已从目录消失」的正确语义），本用例钉住不回归。
    const primary = Array.from({ length: 10 }, (_, i) => ({
      id: `m-${i}`, name: `DSH Market ${i}`, description: 'dm', category: 'tools', tags: [], source: 'npm', npm: `mpkg-${i}`,
    }))
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary) })
    const { deps } = withCommunity(base, communityLoaded([communityRaw('market', 'dsh')]))
    const res = await existingMarketIds(['dsh--market'], cfg, {}, deps)
    assert.deepEqual(res.present, ['dsh--market'])
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

// ---------- ADR-0026：upgradePath 投影（issue #30，双落点装配 + 直测） ----------
describe('ADR-0026：upgradePath 投影', () => {
  const mkInstalled = (items) => ({ items, others: 0, complete: true, profileDir: '/tmp/profile' })
  const mkItem = (over = {}) => ({ pkg: 'x', name: 'X', version: '1.0.0', description: '', homepage: '', spec: '^1.0.0', source: 'npm', dsh: true, path: '/tmp/x', ...over })

  it('健康臂：收录命中 → catalog；ready 但 miss 的 npm 项 → synthesized（matchInstalled 后装配）', async () => {
    const { deps } = fakeDeps({
      listInstalledPlugins: async () => mkInstalled([
        mkItem({ pkg: 'pkg-1' }),
        mkItem({ pkg: 'pkg-other' }),
        mkItem({ pkg: 'pkg-local2', spec: 'file:../local2' }),
      ]),
    })
    const res = await listInstalledWithMeta(cfg, { probeMode: 'none' }, deps)
    const byPkg = Object.fromEntries(res.items.map((it) => [it.pkg, it.upgradePath]))
    assert.equal(byPkg['pkg-1'], 'catalog', 'registryId 命中 → catalog')
    assert.equal(byPkg['pkg-other'], 'synthesized', 'registry ready 但未命中 → synthesized')
    // #35（评审 #2 修订 + 建议采纳）：装配层成因码——健康臂 stamp 点真实执行的 unsupported 覆盖
    const byReason = Object.fromEntries(res.items.map((it) => [it.pkg, it.upgradePathReason]))
    assert.equal(byReason['pkg-local2'], 'local-spec', '健康臂 file: 项携带 local-spec 成因码')
    assert.equal(byReason['pkg-1'], undefined, 'catalog 项不携带成因码')
  })

  it('早退臂：registry unavailable → 非收录 npm 项 synthesized、file: 项 unsupported（不经 matchInstalled）', async () => {
    const { deps, calls } = fakeDeps({
      loadRegistry: async () => unavailableLoaded(),
      listInstalledPlugins: async () => mkInstalled([
        mkItem({ pkg: 'pkg-1' }),
        mkItem({ pkg: 'pkg-local', spec: 'file:../local' }),
        mkItem({ pkg: 'pkg-mystery', source: 'unknown', spec: 'whatever' }),
        mkItem({ pkg: 'pkg-gh-bad', source: 'github', spec: 'not-a-github-spec' }),
      ]),
    })
    const res = await listInstalledWithMeta(cfg, {}, deps)
    const byPkg = Object.fromEntries(res.items.map((it) => [it.pkg, it.upgradePath]))
    assert.equal(byPkg['pkg-1'], 'synthesized', 'unavailable 早退臂：registryId 必空 + npm 非本地 spec → synthesized')
    assert.equal(byPkg['pkg-local'], 'unsupported', 'file: spec → unsupported')
    assert.equal(byPkg['pkg-mystery'], 'unsupported', 'source 兜底（评审 F8）→ unsupported')
    assert.equal(byPkg['pkg-gh-bad'], 'unsupported', 'github 畸形 spec → unsupported（判据对齐修订：投影与合成一致）')
    // #35（评审 #2 修订）：装配层成因码三码断言 + synthesized 项字段缺席
    const byReason = Object.fromEntries(res.items.map((it) => [it.pkg, it.upgradePathReason]))
    assert.equal(byReason['pkg-local'], 'local-spec', 'file: 项成因码 local-spec')
    assert.equal(byReason['pkg-mystery'], 'source-unresolvable', 'source 兜底项成因码 source-unresolvable')
    assert.equal(byReason['pkg-gh-bad'], 'github-spec-unparseable', 'github 畸形 spec 成因码 github-spec-unparseable')
    const pkg1 = res.items.find((it) => it.pkg === 'pkg-1')
    assert.ok(!('upgradePathReason' in pkg1), 'synthesized 项不携带成因码')
    assert.equal(calls.npm.length, 0)
  })

  it('upgradePathFor 直测五行（判据单源：registryId / 本地 spec / source 兜底 / github 可解析性）', () => {
    assert.equal(upgradePathFor({ registryId: 'p-1', pkg: 'a', spec: '^1.0.0', source: 'npm' }), 'catalog')
    assert.equal(upgradePathFor({ pkg: 'b', spec: 'file:../b', source: 'npm' }), 'unsupported')
    assert.equal(upgradePathFor({ pkg: 'c', spec: 'whatever', source: 'unknown' }), 'unsupported')
    assert.equal(upgradePathFor({ pkg: 'd', spec: 'github:o/r#abc', source: 'github' }), 'synthesized')
    assert.equal(upgradePathFor({ pkg: 'e', spec: 'not-a-github-spec', source: 'github' }), 'unsupported', 'github 畸形 spec：投影与合成判据对齐')
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

describe('M1 Task 5：合并市场', () => {
  it('① 三键撞名 → 社区条目保留打标进社区镜像（设计 2026-10-27：主清单恒优先的代表制只约束搜索态）', async () => {
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
    // 浏览镜像：撞名条目保留出现（id-让位形态与主条目同 id → 列表含两份 'own--name'，client key 分域）
    const ids = res.items.map((it) => it.id)
    assert.deepEqual(ids, ['p-a', 'own--name', 'o1--dup-npm', 'o2--keep', 'own--name'])
    const marked = res.items.filter((it) => it.primaryOverlap === true)
    assert.deepEqual(marked.map((it) => it.id).sort(), ['o1--dup-npm', 'own--name'])
    assert.equal(marked.length, res.community.displaced, 'displaced = 打标条目总数')
    assert.ok(res.community.warnings.some((w) => w.includes('2') && w.includes('同时被主清单收录')))
    assert.equal(ccalls.n, 1)
  })

  it('①-b 0.9.51 补全：社区 npm 条目经 github 碰撞 → 保留打标（npm 名不撞、repo 撞；设计 2026-10-27）', async () => {
    const primary = [
      { id: 'p-g', name: 'G', description: 'dg', category: 'tools', tags: [], source: 'npm', npm: 'pkg-g', github: 'own/g-repo' },
    ]
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary) })
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('g-repo', 'own', { npm: 'fresh-npm' }), // npm 名不撞；url 默认 github.com/own/g-repo → 撞主条目 github
      communityRaw('other', 'o2'),                         // 无撞 → 收录
    ]))
    const res = await listMarket(cfg, { withLatest: false }, deps)
    const gRepo = res.items.find((it) => it.id === 'own--g-repo')
    assert.ok(gRepo, 'github 撞条目保留在社区镜像')
    assert.equal(gRepo.primaryOverlap, true)
    assert.deepEqual(res.items.map((it) => it.id), ['p-g', 'own--g-repo', 'o2--other'])
    assert.equal(res.community.displaced, 1)
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

  it('⑩-b 0.9.51 补全：GitHub 源手装可被社区 npm 条目匹配（Q5 钉子）', async () => {
    const installed = {
      items: [{
        pkg: 'g-repo', name: 'G', version: '0.0.0', description: '', homepage: '',
        spec: `github:own/g-repo#${'a'.repeat(40)}`, source: 'github', dsh: true, path: '/tmp/node_modules/g-repo',
      }],
      others: 0,
      complete: true,
      profileDir: '/tmp/profile',
    }
    const base = fakeDeps({ listInstalledPlugins: async () => installed })
    const { deps } = withCommunity(base, communityLoaded([communityRaw('g-repo', 'own', { npm: 'fresh-npm' })]))
    const res = await listInstalledWithMeta(cfg, {}, deps)
    assert.equal(res.items[0].registryId, 'own--g-repo', 'github 分支命中社区 npm 条目（改动前无 github 字段 → 红）')
    assert.equal(res.items[0].registryGithub, 'own/g-repo')
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

  it('ADR-0026：dshm_list/dshm_outdated items 携带 upgradePath，unsupported 项双渲染标注本地链接', async () => {
    const installedResult = {
      items: [
        { pkg: 'p-1', name: 'P1', version: '1.0.0', source: 'npm', spec: '1.0.0', outdated: false, upgradePath: 'catalog' },
        { pkg: 'p-local', name: 'PLocal', version: '1.0.0', source: 'npm', spec: 'file:../p-local', outdated: true, latestVersion: '9.9.9', upgradePath: 'unsupported', upgradePathReason: 'local-spec' },
      ],
      others: 0,
      profileDir: '/tmp/p',
      registryState: { configuredAddress: '', activeAddress: null, source: 'bundled', status: 'ready', isDefault: true, stale: false, fetchedAt: null, errors: [], count: 2 },
      community: { enabled: true, status: 'ready', version: 'v', checkedAt: 't', fetchedAt: 't', route: 'r', acceptedCount: 1, upstreamCount: 1, displaced: 0, skippedDirty: 0, skippedSubpathNoNpm: 0, errors: [], warnings: [] },
    }
    const { registered } = await loadToolsWith({ installedResult })
    const list = registered.find((t) => t.name === 'dshm_list')
    const out = await list.execute({})
    assert.equal(out.items[0].upgradePath, 'catalog')
    assert.equal(out.items[1].upgradePath, 'unsupported')
    // #35（评审 #2 修订）：tools 投影 map 白名单行——fixture 字段透传链（tools 层只透传不产生成因码）
    assert.equal(out.items[1].upgradePathReason, 'local-spec', 'dshm_list 应透传 upgradePathReason')
    const listText = list.output.render({}, out)[0].text
    assert.ok(listText.includes('本地链接安装'), `renderList 应标注 unsupported 项：${listText}`)
    const outdated = registered.find((t) => t.name === 'dshm_outdated')
    const out2 = await outdated.execute({})
    assert.equal(out2.items[1].upgradePath, 'unsupported')
    const outdatedText = outdated.output.render({}, out2)[0].text
    assert.ok(outdatedText.includes('本地链接安装——不参与自动升级'), `renderOutdated 应标注：${outdatedText}`)
  })

  it('ADR-0026/#35：unsupported 成因按码标注——github-spec 场景不再误标本地链接（行级断言）', async () => {
    const installedResult = {
      items: [
        { pkg: 'p-gh', name: 'PGh', version: '1.0.0', source: 'github', spec: 'not-a-github-spec', outdated: true, latestVersion: '9.9.9', upgradePath: 'unsupported', upgradePathReason: 'github-spec-unparseable' },
      ],
      others: 0,
      profileDir: '/tmp/p',
      registryState: { configuredAddress: '', activeAddress: null, source: 'bundled', status: 'ready', isDefault: true, stale: false, fetchedAt: null, errors: [], count: 1 },
      community: { enabled: true, status: 'ready', version: 'v', checkedAt: 't', fetchedAt: 't', route: 'r', acceptedCount: 1, upstreamCount: 1, displaced: 0, skippedDirty: 0, skippedSubpathNoNpm: 0, errors: [], warnings: [] },
    }
    const { registered } = await loadToolsWith({ installedResult })
    const outdated = registered.find((t) => t.name === 'dshm_outdated')
    const out = await outdated.execute({})
    const outdatedText = outdated.output.render({}, out)[0].text
    const ghLine = outdatedText.split('\n').find((l) => l.includes('p-gh'))
    assert.ok(ghLine, `renderOutdated 应含 p-gh 行：${outdatedText}`)
    assert.ok(ghLine.includes('github spec 无法解析——不参与自动升级'), `github 项行级成因标注：${ghLine}`)
    assert.ok(!ghLine.includes('本地链接安装'), `github 项不得误标本地链接：${ghLine}`)
    const list = registered.find((t) => t.name === 'dshm_list')
    const outL = await list.execute({})
    const listText = list.output.render({}, outL)[0].text
    const ghLineL = listText.split('\n').find((l) => l.includes('p-gh'))
    assert.ok(ghLineL && ghLineL.includes('github spec 无法解析') && !ghLineL.includes('本地链接安装'), `renderList 行级成因标注：${ghLineL}`)
  })

  it('ADR-0026/#35：源结构锚——成因标签单源 upgrade-target，tools/cli 按码消费（出现次数语义）', async () => {
    const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
    const targetSrc = read('../src/core/upgrade-target.ts')
    const toolsSrc = read('../src/tools.ts')
    const cliSrc = read('../src/cli.ts')
    assert.ok(targetSrc.split('本地链接安装').length - 1 >= 1, `三码标签字面应迁往 upgrade-target 单源，实得 ${targetSrc.split('本地链接安装').length - 1}`)
    assert.ok(toolsSrc.split('unsupportedCauseLabel').length - 1 >= 2, `tools.ts 消费 ≥2（renderList + renderOutdated），实得 ${toolsSrc.split('unsupportedCauseLabel').length - 1}`)
    assert.ok(cliSrc.split('unsupportedCauseLabel').length - 1 >= 1, `cli.ts 消费 ≥1，实得 ${cliSrc.split('unsupportedCauseLabel').length - 1}`)
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

// ---------- 0.9.68 score-once（ADR-0016 决策 7 / 评审 R1-4）：tie-break 保序回归 ----------

describe('score-once：单遍评分 + 显式排序 tie-break 保序', () => {
  const dlEntry = (id, npm, downloads) => ({
    id, name: npm.replace('pkg-', 'theme-'), description: `d ${id}`, category: 'tools', tags: [], source: 'npm', npm,
    ...(downloads !== undefined ? { downloads } : {}),
  })
  // 注：主清单条目无 downloads 旁路字段（社区专属），此处用社区目录侧构造同分不同下载量场景

  it('sort=downloads,desc + query 命中同分条目：同分 tie-break 跟随显式排序序（不回退 merged 原序）', async () => {
    const primary = [dlEntry('p-1', 'pkg-1')]
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary, { configuredAddress: 'reg-scoreonce' }) })
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('alpha', 'o1', { npm: 'theme-alpha', downloads: 10 }),
      communityRaw('beta', 'o2', { npm: 'theme-beta', downloads: 500 }),
      communityRaw('gamma', 'o3', { npm: 'theme-gamma', downloads: 100 }),
    ]))
    // 三条社区条目 name 均为 theme-* 前缀命中（同权重同命中类型 → 同分）；downloads 互异
    const res = await listMarket(cfg, { query: 'theme', source: 'community', sort: { field: 'downloads', dir: 'desc' }, withLatest: false }, deps)
    assert.deepEqual(res.items.map((it) => it.id), ['o2--beta', 'o3--gamma', 'o1--alpha'], '同分组内按显式排序（downloads 降序）排布')
  })

  it('sort=downloads,asc + query 命中同分条目：tie-break 跟随升序显式排序（区分性用例——显式序与 merged 现序相反，锁 R1-4）', async () => {
    const primary = [dlEntry('p-1', 'pkg-1')]
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary, { configuredAddress: 'reg-scoreonce3' }) })
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('alpha', 'o1', { npm: 'theme-alpha', downloads: 10 }),
      communityRaw('beta', 'o2', { npm: 'theme-beta', downloads: 500 }),
      communityRaw('gamma', 'o3', { npm: 'theme-gamma', downloads: 100 }),
    ]))
    // 显式 asc 序 [alpha(10), gamma(100), beta(500)] 与 merged 缺省序 [beta,gamma,alpha] 相反——
    // 若实现错取排序前位置或丢弃显式 sort，本断言必败
    const res = await listMarket(cfg, { query: 'theme', source: 'community', sort: { field: 'downloads', dir: 'asc' }, withLatest: false }, deps)
    assert.deepEqual(res.items.map((it) => it.id), ['o1--alpha', 'o3--gamma', 'o2--beta'], '同分组内按显式升序排布（区分 merged 现序）')
  })

  it('无显式 sort 时同分 tie-break 维持 merged 现序（downloads 降序缺省序）', async () => {
    const primary = [dlEntry('p-1', 'pkg-1')]
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary, { configuredAddress: 'reg-scoreonce2' }) })
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('alpha', 'o1', { npm: 'theme-alpha', downloads: 10 }),
      communityRaw('beta', 'o2', { npm: 'theme-beta', downloads: 500 }),
      communityRaw('gamma', 'o3', { npm: 'theme-gamma', downloads: 100 }),
    ]))
    const res = await listMarket(cfg, { query: 'theme', source: 'community', withLatest: false }, deps)
    assert.deepEqual(res.items.map((it) => it.id), ['o2--beta', 'o3--gamma', 'o1--alpha'], 'merged 现序即 downloads 降序，同分保持该序')
  })
})
