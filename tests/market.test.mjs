/**
 * Task 3：服务端分页、latest cache、deadline/abort、unavailable 契约与 host/cli namespace。
 * 运行：npm run build && node --test tests/market.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { listMarket, listInstalledWithMeta, installFromRegistry, upgradePlugin } from '../lib/core/market.js'

const CATEGORIES = ['market', 'tools', 'ui', 'search', 'media', 'other']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeThousand() {
  return Array.from({ length: 1000 }, (_, i) => ({
    id: `p-${i}`,
    name: `P${i}`,
    description: `d${i}`,
    category: CATEGORIES[i % 6],
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
      return { items: [], others: 0, profileDir: '/tmp/profile' }
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

  it('core 硬 clamp：withLatest 最多 50，metadata-only 最多 80', async () => {
    const { deps } = fakeDeps()
    const a = await listMarket(cfg, { limit: 1000 }, deps)
    assert.equal(a.limit, 50)
    assert.equal(a.items.length, 50)
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
    assert.equal(cat.total, 167)
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
    assert.ok(res.items.every((it) => it.latestErrorCode === 'LATEST_TIMEOUT'))
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
    assert.equal(res.installedComplete, false)
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
      const { deps } = fakeDeps({ listInstalledPlugins: async () => ({ items: [], others: 0, profileDir: '/tmp/p' }) })
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

function marketTotal(out) {
  return out.total
}

describe('dshm CLI：cli namespace 与 unavailable 退出码', () => {
  async function run(argv, deps, io) {
    const { runCli } = await import('../lib/cli.js')
    return runCli(argv, deps, io)
  }

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
        categoryCounts: { market: 0, tools: 0, ui: 0, search: 0, media: 0, other: 0 },
        registryState: unavailableLoaded('/tmp/custom.json'),
        installedComplete: false, latestComplete: false, latestTimedOut: false,
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
