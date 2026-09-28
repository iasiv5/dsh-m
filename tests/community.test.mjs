/**
 * M1 Task 2：社区清单容器层——常量、严格容器校验、23 分类标签表、入库 fixture 契约。
 * 运行：npm run build && node --test tests/community.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  COMMUNITY_CHAIN_BUDGET_MS,
  COMMUNITY_KNOWN_CATEGORIES,
  COMMUNITY_NPM_PACKAGE,
  MAX_COMMUNITY_BYTES,
  MAX_COMMUNITY_ENTRIES,
  validateCommunityContainer,
} from '../lib/core/community.js'

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'community-catalog-sample.json'), 'utf8'),
)

describe('常量（容器契约）', () => {
  it('锚定 npm 包与容量上限', () => {
    assert.equal(COMMUNITY_NPM_PACKAGE, 'dsh-plugin-catalog')
    assert.equal(MAX_COMMUNITY_BYTES, 32 * 1024 * 1024)
    assert.equal(MAX_COMMUNITY_ENTRIES, 30_000)
    assert.equal(COMMUNITY_CHAIN_BUDGET_MS, 30_000)
  })
})

describe('validateCommunityContainer', () => {
  it('合法最小 catalog 通过（2 条）', () => {
    const raw = {
      name: 'awesome-dsh-plugin',
      url: 'https://example.com',
      source: 'https://github.com/x/y',
      updated: '2026-09-28',
      count: 2,
      categories: { ui: { en: 'UI', zh: 'UI 增强' } },
      plugins: [
        { name: 'a', owner: 'o1', category: 'ui', npm: 'a' },
        { name: 'b', owner: 'o2', category: 'ui', npm: null },
      ],
    }
    const r = validateCommunityContainer(raw)
    assert.equal(r.ok, true)
    assert.equal(r.catalog?.plugins.length, 2)
    assert.equal(r.errors.length, 0)
  })

  it('未知顶层键报错且 catalog=null', () => {
    const r = validateCommunityContainer({ ...fixture, extra: 1 })
    assert.equal(r.ok, false)
    assert.equal(r.catalog, null)
    assert.ok(r.errors.some((e) => e.includes('extra') && e.includes('未知顶层字段')))
  })

  it('plugins 缺失/非数组 → 整份拒收', () => {
    for (const bad of [{}, { plugins: 'x' }, { plugins: {} }]) {
      const r = validateCommunityContainer(bad)
      assert.equal(r.ok, false)
      assert.equal(r.catalog, null)
      assert.ok(r.errors.some((e) => e.startsWith('plugins:')))
    }
  })

  it('plugins 超过 30,000 条 → 整份拒收并注明上限', () => {
    const big = Array.from({ length: MAX_COMMUNITY_ENTRIES + 1 }, () => ({ name: 'x' }))
    const r = validateCommunityContainer({ plugins: big })
    assert.equal(r.ok, false)
    assert.equal(r.catalog, null)
    assert.ok(r.errors.some((e) => e.includes('30001') && e.includes('30000')))
  })

  it('条目非对象 → 拒收（容器层保底；条目字段校验属适配层）', () => {
    const r = validateCommunityContainer({ plugins: [{ name: 'ok' }, 'bad', null] })
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.includes('plugins[1]')))
  })

  it('根非对象 → 拒收', () => {
    for (const bad of [null, 'x', [], 42]) {
      const r = validateCommunityContainer(bad)
      assert.equal(r.ok, false)
      assert.equal(r.catalog, null)
    }
  })

  it('入库 fixture 通过容器校验', () => {
    const r = validateCommunityContainer(fixture)
    assert.equal(r.ok, true)
    assert.equal(r.catalog?.plugins.length, fixture.plugins.length)
  })
})

describe('COMMUNITY_KNOWN_CATEGORIES 与 fixture 一致', () => {
  it('23 个分类 id 全覆盖（含共享桶 ui/tools/market）', () => {
    assert.equal(Object.keys(COMMUNITY_KNOWN_CATEGORIES).length, 23)
    for (const id of Object.keys(fixture.categories)) {
      assert.ok(COMMUNITY_KNOWN_CATEGORIES[id], `标签表缺分类: ${id}`)
    }
    for (const id of Object.keys(COMMUNITY_KNOWN_CATEGORIES)) {
      assert.ok(fixture.categories[id], `fixture 缺分类: ${id}`)
    }
  })

  it('标签为中文非空字符串', () => {
    for (const [id, label] of Object.entries(COMMUNITY_KNOWN_CATEGORIES)) {
      assert.equal(typeof label, 'string', id)
      assert.ok(label.length > 0, id)
    }
  })

  it('fixture 覆盖全部 23 个分类', () => {
    const seen = new Set(fixture.plugins.map((p) => p.category))
    assert.equal(seen.size, 23)
  })
})

// ================= Task 3：获取链 / TTL / pin 隔离 / in-flight =================

import { mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { fetchCommunityCatalog } from '../lib/core/community.js'

const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms))
const catalogJson = (version) =>
  JSON.stringify({
    name: 'awesome-dsh-plugin',
    url: 'https://example.com',
    source: 'https://github.com/x/y',
    updated: version,
    count: 2,
    categories: { ui: { en: 'UI', zh: 'UI 增强' } },
    plugins: [
      { name: 'a', owner: 'o1', category: 'ui', npm: 'a' },
      { name: 'b', owner: 'o2', category: 'ui', npm: null },
    ],
  })

function makeState(over = {}) {
  return { version: '1.0.0', probeHits: 0, bodyHits: 0, bodyVersions: [], badHits: 0, failProbe: false, failBody: false, failBad: true, hangBody: false, bodyDelayMs: 0, ...over }
}

const task3Servers = []
async function startCatalog(st) {
  const server = createServer((req, res) => {
    const u = req.url
    if (u === '/npm/dsh-plugin-catalog/latest') {
      st.probeHits += 1
      if (st.failProbe) { res.writeHead(500); return res.end() }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ version: st.version }))
    }
    const bad = /^\/bad\/([^/]+)\/plugins\.json$/.exec(u)
    if (bad) {
      st.badHits += 1
      res.writeHead(500)
      return res.end()
    }
    const m = /^\/file\/([^/]+)\/plugins\.json$/.exec(u)
    if (m) {
      st.bodyHits += 1
      st.bodyVersions.push(decodeURIComponent(m[1]))
      if (st.failBody) { res.writeHead(500); return res.end() }
      if (st.hangBody) return
      const respond = () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(catalogJson(decodeURIComponent(m[1]))) }
      return st.bodyDelayMs ? setTimeout(respond, st.bodyDelayMs) : respond()
    }
    res.writeHead(404); res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  task3Servers.push({ close: () => new Promise((r) => server.close(r)) })
  const port = server.address().port
  return {
    port,
    routes: {
      registryBase: `http://127.0.0.1:${port}/npm`,
      fileBases: [`http://127.0.0.1:${port}/file/{version}/plugins.json`],
    },
    badFirstRoutes: {
      registryBase: `http://127.0.0.1:${port}/npm`,
      fileBases: [
        `http://127.0.0.1:${port}/bad/{version}/plugins.json`,
        `http://127.0.0.1:${port}/file/{version}/plugins.json`,
      ],
    },
  }
}

describe('fetchCommunityCatalog（获取链）', () => {
  let cacheRoot
  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'dshm-community-'))
    process.env.DSHM_CACHE_DIR = cacheRoot
  })
  afterEach(async () => {
    delete process.env.DSHM_CACHE_DIR
    rmSync(cacheRoot, { recursive: true, force: true })
    while (task3Servers.length) await task3Servers.pop().close()
  })

  const awesome = () => join(cacheRoot, 'host', 'awesome')

  it('① ready 链路：meta/body 落盘、route=jsdelivr', async () => {
    const st = makeState()
    const s = await startCatalog(st)
    const { state, catalog } = await fetchCommunityCatalog({}, { routes: s.routes })
    assert.equal(state.status, 'ready')
    assert.equal(state.version, '1.0.0')
    assert.equal(state.route, 'jsdelivr')
    assert.equal(state.count, 2)
    assert.ok(catalog)
    assert.ok(existsSync(join(awesome(), 'meta.json')))
    assert.ok(existsSync(join(awesome(), 'catalog-1.0.0.json')))
  })

  it('② TTL 内二次调用：0 探测 0 正文（版本号即 revalidate）', async () => {
    const st = makeState()
    const s = await startCatalog(st)
    await fetchCommunityCatalog({}, { routes: s.routes })
    const second = await fetchCommunityCatalog({}, { routes: s.routes })
    assert.equal(second.state.status, 'ready')
    assert.equal(st.probeHits, 1)
    assert.equal(st.bodyHits, 1)
  })

  it('③ dist-tags 新版本：TTL 内仍用缓存、force 后重拉', async () => {
    const st = makeState()
    const s = await startCatalog(st)
    await fetchCommunityCatalog({}, { routes: s.routes })
    st.version = '2.0.0'
    const cached = await fetchCommunityCatalog({}, { routes: s.routes })
    assert.equal(cached.state.version, '1.0.0')
    assert.equal(st.probeHits, 1)
    const forced = await fetchCommunityCatalog({}, { routes: s.routes, force: true })
    assert.equal(forced.state.version, '2.0.0')
    assert.equal(st.probeHits, 2)
    assert.equal(st.bodyHits, 2)
  })

  it('④ 线路 1 500 → 线路 2 成功 route=npmmirror', async () => {
    const st = makeState()
    const s = await startCatalog(st)
    const { state } = await fetchCommunityCatalog({}, { routes: s.badFirstRoutes })
    assert.equal(state.status, 'ready')
    assert.equal(state.route, 'npmmirror')
    assert.equal(st.badHits, 1)
  })

  it('⑤ 全失败有缓存 → stale（fetchedAt 保留）', async () => {
    const st = makeState()
    const s = await startCatalog(st)
    const first = await fetchCommunityCatalog({}, { routes: s.routes })
    st.failProbe = true
    st.failBody = true
    // force 跳过缓存快速路径 → 探测失败 → 回落缓存（TTL 内非 force 会被快速路径挡住，探测不发生）
    const second = await fetchCommunityCatalog({}, { routes: s.routes, force: true })
    assert.equal(second.state.status, 'stale')
    assert.equal(second.state.version, '1.0.0')
    assert.equal(second.state.fetchedAt, first.state.fetchedAt)
    assert.ok(second.catalog)
    assert.ok(second.state.errors.length > 0)
  })

  it('⑥ 全失败无缓存 → unavailable + errors 含「怎么办」', async () => {
    const st = makeState({ failProbe: true, failBody: true })
    const s = await startCatalog(st)
    const { state, catalog } = await fetchCommunityCatalog({}, { routes: s.routes })
    assert.equal(state.status, 'unavailable')
    assert.equal(catalog, null)
    assert.ok(state.errors.some((e) => e.includes('可稍后重试')))
  })

  it('⑦ dist-tags 返回 ../../etc：该线路失败、cacheDir 零变化', async () => {
    const st = makeState({ version: '../../etc' })
    const s = await startCatalog(st)
    const { state } = await fetchCommunityCatalog({}, { routes: s.routes })
    assert.equal(state.status, 'unavailable')
    assert.ok(state.errors.some((e) => e.includes('非精确版本')))
    assert.ok(!existsSync(awesome()) || readdirSync(awesome()).length === 0)
  })

  it('⑧ pin=1.0.0 跳过探测；pin 非法 → unavailable 零网络', async () => {
    const st = makeState({ version: '9.9.9' })
    const s = await startCatalog(st)
    const pinned = await fetchCommunityCatalog({ communityCatalogPin: '1.0.0' }, { routes: s.routes })
    assert.equal(pinned.state.status, 'ready')
    assert.equal(pinned.state.version, '1.0.0')
    assert.equal(st.probeHits, 0)
    assert.deepEqual(st.bodyVersions, ['1.0.0'])
    const badPin = await fetchCommunityCatalog({ communityCatalogPin: 'not-a-version' }, { routes: s.routes })
    assert.equal(badPin.state.status, 'unavailable')
    assert.ok(badPin.state.errors.some((e) => e.includes('非法')))
    assert.equal(st.probeHits, 0)
  })

  it('⑨ 全线路挂起：预算耗尽、总耗时受 flight hard cap 约束', async () => {
    const st = makeState({ hangBody: true })
    const s = await startCatalog(st)
    const t0 = Date.now()
    const { state } = await fetchCommunityCatalog({}, { routes: s.routes, flightBudgetMs: 400 })
    const elapsed = Date.now() - t0
    assert.equal(state.status, 'unavailable')
    assert.ok(state.errors.some((e) => e.includes('预算耗尽')))
    assert.ok(elapsed < 2000, `elapsed=${elapsed}`)
  })

  it('⑩ meta 篡改（version=../../etc）：视为无缓存且损坏文件被清理', async () => {
    const st = makeState()
    const s = await startCatalog(st)
    await fetchCommunityCatalog({}, { routes: s.routes })
    writeFileSync(join(awesome(), 'meta.json'), JSON.stringify({ version: '../../etc', checkedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), route: 'jsdelivr' }))
    const second = await fetchCommunityCatalog({}, { routes: s.routes })
    assert.equal(second.state.status, 'ready')
    assert.equal(second.state.version, '1.0.0')
    const meta = JSON.parse(readFileSync(join(awesome(), 'meta.json'), 'utf8'))
    assert.equal(meta.version, '1.0.0')
    assert.deepEqual(readdirSync(awesome()).filter((f) => f.includes('..')), [])
  })

  it('⑪ checkedAt 非法：视为过期重新探测（同版本不重拉正文）', async () => {
    const st = makeState()
    const s = await startCatalog(st)
    await fetchCommunityCatalog({}, { routes: s.routes })
    const metaPath = join(awesome(), 'meta.json')
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    meta.checkedAt = 'garbage'
    writeFileSync(metaPath, JSON.stringify(meta))
    const second = await fetchCommunityCatalog({}, { routes: s.routes })
    assert.equal(second.state.status, 'ready')
    assert.equal(st.probeHits, 2)
    assert.equal(st.bodyHits, 1)
  })

  it('⑫ TTL 过期 + dist-tags 同版本：仅更新 checkedAt、正文 0 拉取', async () => {
    const st = makeState()
    const s = await startCatalog(st)
    await fetchCommunityCatalog({ cacheTtlMin: 0 }, { routes: s.routes })
    const first = JSON.parse(readFileSync(join(awesome(), 'meta.json'), 'utf8'))
    await sleep2(20)
    const second = await fetchCommunityCatalog({ cacheTtlMin: 0 }, { routes: s.routes })
    const secondMeta = JSON.parse(readFileSync(join(awesome(), 'meta.json'), 'utf8'))
    assert.equal(second.state.status, 'ready')
    assert.equal(st.probeHits, 2)
    assert.equal(st.bodyHits, 1)
    assert.notEqual(secondMeta.checkedAt, first.checkedAt)
  })

  it('⑬ 并发冷 miss：dist-tags/正文各仅 1 次（in-flight 合并）', async () => {
    const st = makeState({ bodyDelayMs: 120 })
    const s = await startCatalog(st)
    const [a, b] = await Promise.all([
      fetchCommunityCatalog({}, { routes: s.routes }),
      fetchCommunityCatalog({}, { routes: s.routes }),
    ])
    assert.equal(a.state.status, 'ready')
    assert.equal(b.state.status, 'ready')
    assert.equal(st.probeHits, 1)
    assert.equal(st.bodyHits, 1)
  })

  it('⑭ 一个调用 abort：另一个仍成功完成（waiter 隔离）', async () => {
    const st = makeState({ bodyDelayMs: 150 })
    const s = await startCatalog(st)
    const ctrl = new AbortController()
    // 并发 join：second 与 first 共享同一 flight；first 的 abort 只取消自己的等待
    const second = fetchCommunityCatalog({}, { routes: s.routes })
    const first = fetchCommunityCatalog({}, { routes: s.routes, signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 30)
    await assert.rejects(() => first, (err) => err.name === 'AbortError')
    const result = await second
    assert.equal(result.state.status, 'ready')
    assert.equal(st.bodyHits, 1)
  })

  it('⑮ latest 缓存 1.0.0 → 改 pin=2.0.0：命中/下载 2.0.0 且 latest 指针不变', async () => {
    const st = makeState({ version: '1.0.0' })
    const s = await startCatalog(st)
    await fetchCommunityCatalog({}, { routes: s.routes })
    const pinned = await fetchCommunityCatalog({ communityCatalogPin: '2.0.0' }, { routes: s.routes })
    assert.equal(pinned.state.version, '2.0.0')
    assert.ok(existsSync(join(awesome(), 'meta-pin-2.0.0.json')))
    const latestMeta = JSON.parse(readFileSync(join(awesome(), 'meta.json'), 'utf8'))
    assert.equal(latestMeta.version, '1.0.0')
  })

  it('⑯ pin=A 与 pin=B 并发：各归各版本、meta 互不覆盖', async () => {
    const st = makeState({ bodyDelayMs: 60 })
    const s = await startCatalog(st)
    const [a, b] = await Promise.all([
      fetchCommunityCatalog({ communityCatalogPin: '1.0.0' }, { routes: s.routes }),
      fetchCommunityCatalog({ communityCatalogPin: '2.0.0' }, { routes: s.routes }),
    ])
    assert.equal(a.state.version, '1.0.0')
    assert.equal(b.state.version, '2.0.0')
    assert.equal(JSON.parse(readFileSync(join(awesome(), 'meta-pin-1.0.0.json'), 'utf8')).version, '1.0.0')
    assert.equal(JSON.parse(readFileSync(join(awesome(), 'meta-pin-2.0.0.json'), 'utf8')).version, '2.0.0')
  })

  it('⑰ pin 与 unpinned 并发、force 与非 force 并发：互不串版本', async () => {
    const st = makeState({ version: '2.0.0', bodyDelayMs: 60 })
    const s = await startCatalog(st)
    const [pinned, latest] = await Promise.all([
      fetchCommunityCatalog({ communityCatalogPin: '1.0.0' }, { routes: s.routes }),
      fetchCommunityCatalog({}, { routes: s.routes }),
    ])
    assert.equal(pinned.state.version, '1.0.0')
    assert.equal(latest.state.version, '2.0.0')
    const [forced, normal] = await Promise.all([
      fetchCommunityCatalog({}, { routes: s.routes, force: true }),
      fetchCommunityCatalog({}, { routes: s.routes }),
    ])
    assert.equal(forced.state.version, '2.0.0')
    assert.equal(normal.state.version, '2.0.0')
  })

  it('⑱ pin→unpinned 回退：不得把 pin 版本当 latest', async () => {
    const st = makeState({ version: '2.0.0' })
    const s = await startCatalog(st)
    await fetchCommunityCatalog({ communityCatalogPin: '1.0.0' }, { routes: s.routes })
    const latest = await fetchCommunityCatalog({}, { routes: s.routes })
    assert.equal(latest.state.version, '2.0.0')
    assert.ok(st.probeHits >= 1)
    assert.ok(!existsSync(join(awesome(), 'meta.json')) || JSON.parse(readFileSync(join(awesome(), 'meta.json'), 'utf8')).version === '2.0.0')
  })

  it('disabled：零网络零缓存', async () => {
    const st = makeState()
    const s = await startCatalog(st)
    const { state, catalog } = await fetchCommunityCatalog({ communityCatalog: false }, { routes: s.routes })
    assert.equal(state.status, 'disabled')
    assert.equal(state.enabled, false)
    assert.equal(catalog, null)
    assert.equal(st.probeHits, 0)
    assert.equal(st.bodyHits, 0)
  })
})

// ---------- M1 Task 6：getCommunitySummary（registry 响应社区 summary 单一深接口） ----------

describe('getCommunitySummary', () => {
  it('disabled 配置 → disabled summary（零网络立即返回）', async () => {
    const { getCommunitySummary } = await import('../lib/core/community.js')
    const summary = await getCommunitySummary([], { communityCatalog: false }, { deadlineAt: Date.now() + 1000 })
    assert.equal(summary.enabled, false)
    assert.equal(summary.status, 'disabled')
    assert.equal(summary.acceptedCount, 0)
    assert.equal(summary.upstreamCount, null)
  })

  it('非法 pin → unavailable summary（零网络零写入）', async () => {
    const { getCommunitySummary } = await import('../lib/core/community.js')
    const summary = await getCommunitySummary([], { communityCatalogPin: '../../etc' }, { deadlineAt: Date.now() + 1000 })
    assert.equal(summary.status, 'unavailable')
    assert.ok(summary.errors.some((e) => e.includes('communityCatalogPin')))
  })
})
