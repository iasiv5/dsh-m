/**
 * Task 0（ADR-0016 / 实施计划 R1-8）：golden 等价基线。
 * 固定 fixture（主清单 + 社区目录 + 已装列表 + 固定探测结果）对 listMarket / listInstalledWithMeta
 * 捕获全量 JSON，与 tests/fixtures/market-golden.json 比对——Task 1-5 全程必须保持绿
 * （「行为零变化」承诺的可执行机制，验收断言⑤）。
 *
 * 重生成：UPDATE_GOLDEN=1 npm run build && node --test tests/market-golden.test.mjs
 * 运行：npm run build && node --test tests/market-golden.test.mjs
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { listMarket, listInstalledWithMeta } from '../lib/core/market.js'
import { resetLatestCacheForTest } from '../lib/core/latest-cache.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, 'fixtures', 'market-golden.json')

// latest cache 落盘隔离（与 market.test.mjs 同款纪律）
const cacheRoot = mkdtempSync(join(tmpdir(), 'dshm-golden-'))
process.env.DSHM_CACHE_DIR = cacheRoot
after(() => {
  delete process.env.DSHM_CACHE_DIR
  rmSync(cacheRoot, { recursive: true, force: true })
})

// ---------- fixture：确定性数据（身份字段与探测结果全部固定） ----------

const GOLD_FETCHED_AT = '2026-10-10T00:00:00.000Z'
const GOLD_COMMUNITY_VERSION = '2026.10.10.1'
const GOLD_CHECKED_AT = '2026-10-10T00:00:00.000Z'

const primary = [
  { id: 'gold-npm', name: 'Gold Npm', description: '主清单 npm 源条目', category: 'tools', tags: [], source: 'npm', npm: 'gold-npm-a' },
  { id: 'gold-gh', name: 'Gold Gh', description: '主清单 github 源条目', category: 'ui', tags: [], source: 'github', github: 'own/gold-repo' },
  { id: 'gold-also', name: 'Gold Also', description: '次级策展桶条目', category: 'tools', tags: [], source: 'npm', npm: 'gold-npm-also', alsoCategories: ['search'] },
  { id: 'goldown--keepc', name: 'Gold IdClash', description: 'id 撞社区合成 id 的主清单条目', category: 'market', tags: [], source: 'npm', npm: 'gold-idclash-npm' },
]

function communityRaw(name, owner, props = {}) {
  return {
    name,
    owner,
    url: `https://github.com/${owner}/${name}`,
    category: 'c-ui',
    description: { en: `${name} golden en`, zh: `${name} 金牌中文` },
    npm: `${name}-pkg`,
    downloads: 100,
    ...props,
  }
}

const communityPlugins = [
  communityRaw('dup', 'o1', { npm: 'gold-npm-a' }), // npm 撞主 → displaced
  communityRaw('keepa', 'goldown', { npm: 'gold-community-a', downloads: 500 }),
  communityRaw('keepb', 'g2', { npm: 'gold-community-b', downloads: 50, description: { en: 'keepb golden en', zh: '' } }), // zh 空 → en 回退
  communityRaw('keepgh', 'g3', { npm: null, downloads: 200 }), // 无 npm + github url → github-only 社区条目
  communityRaw('keepc', 'goldown', { npm: 'gold-community-c', downloads: 10 }), // id 撞主（goldown--keepc）→ displaced（id-让位）
]

const communityLoadedValue = {
  state: {
    enabled: true,
    status: 'ready',
    version: GOLD_COMMUNITY_VERSION,
    checkedAt: GOLD_CHECKED_AT,
    fetchedAt: GOLD_CHECKED_AT,
    route: 'jsdelivr',
    count: communityPlugins.length,
    errors: [],
    warnings: [],
  },
  catalog: {
    name: 'awesome-dsh-plugin',
    url: 'https://awesome.example',
    source: 'https://github.com/x/y',
    updated: '2026-10-10',
    count: communityPlugins.length,
    categories: { 'c-ui': { label: 'UI', en: 'UI' } },
    plugins: communityPlugins,
  },
}

function installedItem(patch) {
  return {
    name: '',
    description: '',
    homepage: '',
    dsh: true,
    ...patch,
  }
}

const installedItems = [
  installedItem({ pkg: 'gold-npm-a', name: 'gold-npm-a', version: '1.0.0', spec: '^1.0.0', source: 'npm', path: '/tmp/gold-profile/node_modules/gold-npm-a' }), // npm/pkg 准则 → gold-npm
  installedItem({ pkg: 'x-pkg', name: 'gold-community-b', version: '1.2.0', spec: '^1.2.0', source: 'npm', path: '/tmp/gold-profile/node_modules/x-pkg' }), // npm/name 准则 → g2--keepb
  installedItem({ pkg: 'y-pkg', name: 'Y Pkg', version: '0.9.0', spec: 'github:own/gold-repo#abc123', source: 'github', path: '/tmp/gold-profile/node_modules/y-pkg', githubRepo: 'own/gold-repo' }), // github spec 准则 → gold-gh
]

function readyLoadedValue() {
  return {
    configuredAddress: '',
    activeAddress: 'https://example.com/r.json',
    source: 'default-raw',
    status: 'ready',
    isDefault: true,
    stale: false,
    fetchedAt: GOLD_FETCHED_AT,
    errors: [],
    count: primary.length,
    registry: { version: 1, plugins: primary },
  }
}

function goldDeps() {
  return {
    loadRegistry: async () => readyLoadedValue(),
    listInstalledPlugins: async () => ({ items: installedItems, others: 0, complete: true, profileDir: '/tmp/gold-profile' }),
    npmLatest: async (pkg) => ({ version: '9.9.9', integrity: 'sha512-gold', tarball: `https://example.com/${pkg}.tgz` }),
    githubLatestTag: async () => ({ tag: 'v9.9.9', sha: 'f'.repeat(40) }),
    fetchCommunityCatalog: async () => communityLoadedValue,
  }
}

const cfg = { timeoutMs: 500 }

/** 每次捕获前重置 latest cache，保证探测段与缓存段行为确定。 */
async function capture(label, fn) {
  resetLatestCacheForTest()
  return [label, JSON.parse(JSON.stringify(await fn()))]
}

// ---------- 断言 / 重生成 ----------

describe('Task 0：golden 等价基线（ADR-0016 行为零变化）', () => {
  before(() => {
    // 最新一次 build 之后才可依赖 lib/；此处无需额外动作，占位保持钩子显式
  })

  it('listMarket / listInstalledWithMeta 全量输出与 golden 逐字节等价', async () => {
    const deps = goldDeps()
    const captures = [
      await capture('market-browse', () => listMarket(cfg, { withLatest: false }, deps)),
      await capture('market-paged', () => listMarket(cfg, { withLatest: false, offset: 1, limit: 2 }, deps)),
      await capture('market-search', () => listMarket(cfg, { query: 'gold', withLatest: false }, deps)),
      await capture('market-community-sorted', () => listMarket(cfg, { source: 'community', sort: { field: 'downloads', dir: 'desc' }, withLatest: false }, deps)),
      await capture('market-badges-full', () => listMarket(cfg, {}, deps)),
      await capture('market-badges-warm-cache-only', () => listMarket(cfg, { probeMode: 'cache-only' }, deps)),
      await capture('installed-none', () => listInstalledWithMeta(cfg, { probeMode: 'none' }, deps)),
      await capture('installed-full', () => listInstalledWithMeta(cfg, { probeMode: 'full' }, deps)),
    ]
    const actual = Object.fromEntries(captures)

    if (process.env.UPDATE_GOLDEN === '1') {
      mkdirSync(dirname(FIXTURE), { recursive: true })
      writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + '\n')
      console.log(`[golden] 已重生成 ${FIXTURE}`)
      return
    }
    assert.ok(existsSync(FIXTURE), `golden fixture 缺失：${FIXTURE}（先 UPDATE_GOLDEN=1 生成）`)
    const expected = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort())
    for (const [label, value] of captures) {
      assert.deepEqual(value, expected[label], `golden 不匹配：${label}`)
    }
  })
})
