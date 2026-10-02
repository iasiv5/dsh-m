/**
 * 0.7.0 Task 5：dshm_search 新契约——source 分区 / 默认 limit 10 / offset 翻页与 nextOffset /
 * 输出补 community·downloads·stars·categoryLabel / renderSearch 文本（[社区] 标记 + 翻页尾行）。
 * 规则出处：DESIGN.md §2.6「agent/CLI 契约」+ 实施计划 Task 5 契约。
 * 运行：npm run build && node --test tests/tools-search.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const cfg = {}
const emptyCounts = { market: 0, tools: 0, ui: 0, search: 0, other: 0 }
const readyState = { isDefault: true, status: 'ready', stale: false }
const readyCommunity = {
  enabled: true, status: 'ready', version: '2026.929.1', checkedAt: 't', fetchedAt: 't',
  route: 'jsdelivr', acceptedCount: 0, upstreamCount: 0, displaced: 0,
  skippedDirty: 0, skippedSubpathNoNpm: 0, errors: [], warnings: [],
}

const communityItem = (over = {}) => ({
  id: 'o1--demo', name: 'demo', description: '社区演示', category: 'theme', tags: [],
  source: 'npm', npm: 'demo-pkg', installed: false, outdated: false,
  community: true, downloads: 1234, stars: 45,
  ...over,
})
const primaryItem = (over = {}) => ({
  id: 'p-1', name: '精选演示', description: '主清单条目', category: 'tools', tags: ['工具'],
  source: 'npm', npm: 'primary-pkg', installed: false, outdated: false,
  ...over,
})

function resultOf(items, extra = {}) {
  return {
    items,
    total: extra.total ?? items.length,
    offset: extra.offset ?? 0,
    limit: extra.limit ?? 10,
    categoryCounts: { ...emptyCounts },
    registryState: readyState,
    installedComplete: true,
    latestComplete: true,
    latestTimedOut: false,
    community: readyCommunity,
  }
}

async function loadSearch(listMarketImpl, calls = []) {
  const { registerTools } = await import('../lib/tools.js')
  const registered = []
  const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {} }
  registerTools(ctx, cfg, { listMarket: async (_c, opts) => { calls.push(opts); return listMarketImpl(opts) } })
  const search = registered.find((t) => t.name === 'dshm_search')
  assert.ok(search, 'dshm_search 已注册')
  return search
}

function renderTextOf(tool, out) {
  const chunks = tool.output.render({}, out)
  assert.ok(Array.isArray(chunks) && chunks.length >= 1)
  return chunks.map((c) => c.text).join('\n')
}

describe('dshm_search 新契约（0.7.0 Task 5）', () => {
  it('默认 limit=10 / source=all / offset=0；非法 source 报错；primary_only 参数已不存在', async () => {
    const calls = []
    const search = await loadSearch(() => resultOf([communityItem()]), calls)
    const out = await search.execute({ query: 'demo' })
    assert.equal(calls[0].limit, 10)
    assert.equal(calls[0].source, 'all')
    assert.equal(calls[0].offset, 0)
    assert.equal(calls[0].primaryOnly, undefined)
    assert.equal(out.source, 'all')
    assert.equal(out.offset, 0)
    assert.equal('primary_only' in search.parameters, false, 'primary_only 参数已删除')
    await assert.rejects(() => search.execute({ source: 'zone' }), /非法 source/)
  })

  it('source=community 透传到 listMarket；limit clamp 1..80', async () => {
    const calls = []
    const search = await loadSearch(() => resultOf([communityItem()]), calls)
    await search.execute({ source: 'community', limit: 999 })
    assert.equal(calls[0].source, 'community')
    assert.equal(calls[0].limit, 80)
    await search.execute({ source: 'primary', limit: 0 })
    assert.equal(calls[1].source, 'primary')
    assert.equal(calls[1].limit, 10, 'limit<=0 走默认 10')
  })

  it('offset 翻页：nextOffset 指向下一批；末页为 null', async () => {
    const pool = [communityItem({ id: 'a1' }), communityItem({ id: 'a2' }), communityItem({ id: 'a3' })]
    const search = await loadSearch((opts) =>
      resultOf(pool.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 10)), { total: pool.length, offset: opts.offset ?? 0, limit: opts.limit }))
    const p1 = await search.execute({ query: 'a', limit: 2 })
    assert.equal(p1.items.length, 2)
    assert.equal(p1.nextOffset, 2)
    const p2 = await search.execute({ query: 'a', limit: 2, offset: 2 })
    assert.equal(p2.items.length, 1)
    assert.equal(p2.nextOffset, null)
  })

  it('输出 item 携带 community/downloads/stars/categoryLabel（社区分类中文直出）', async () => {
    const search = await loadSearch(() => resultOf([communityItem({ category: 'memory' }), primaryItem({ category: 'essentials' })], { total: 2 }))
    const out = await search.execute({})
    const [c, p] = out.items
    assert.equal(c.community, true)
    assert.equal(c.downloads, 1234)
    assert.equal(c.stars, 45)
    assert.equal(c.categoryLabel, '记忆', '社区分类中文标签直出，不回退英文 slug')
    assert.equal(p.community, false)
    assert.equal(p.downloads, null)
    assert.equal(p.categoryLabel, '装机必备', '精选策展桶中文标签')
  })

  it('renderSearch：[社区] 标记 + 中文分类 + 翻页尾行 / 已到末尾', async () => {
    const search = await loadSearch((opts) => resultOf([communityItem()], { total: (opts?.limit ?? 10) >= 80 ? 1 : 5 }))
    const paged = await search.execute({ limit: 2 })
    assert.equal(paged.nextOffset, 1, 'total 5 > 已显示 1 → 下一批从 offset=1 起（offset+shown）')
    const text = renderTextOf(search, paged)
    assert.ok(text.includes('[社区]'), '社区条目带 [社区] 标记')
    assert.ok(text.includes('主题与外观'), '分类显示中文标签')
    const tail = text.trim().split('\n').filter((l) => l.includes('共 ')).pop()
    assert.ok(tail.includes('offset='), `翻页尾行含 offset 提示: ${tail}`)
    // 末页：nextOffset=null → 已到末尾
    const last = await search.execute({ limit: 99 })
    assert.equal(last.nextOffset, null)
    const text2 = renderTextOf(search, last)
    assert.ok(text2.includes('已到末尾'))
  })
})
