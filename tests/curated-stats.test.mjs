/**
 * 精选缺口直查（ADR-0036）：缺口键集纯函数 / 缓存箱解析（TTL+形态）/ 编排
 * （npm bulk 一枪+scoped %2F+逐包回退+gh 逐 repo 并发≤4+缓存写盘+TTL 内免网络
 * +过期拉取失败旧值保留+GC prune+全失败降级）。
 * 运行：npm run build && node --test tests/curated-stats.test.mjs
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { curatedGapKeys, parseCuratedStatsBox, loadCuratedStats, CURATED_STATS_TTL_MS } from '../lib/core/curated-stats.js'

const cacheRoot = mkdtempSync(join(tmpdir(), 'dshm-curated-'))
process.env.DSHM_CACHE_DIR = cacheRoot
after(() => {
  delete process.env.DSHM_CACHE_DIR
  rmSync(cacheRoot, { recursive: true, force: true })
})

describe('curatedGapKeys', () => {
  it('npm/github 拆分：双键条目两边都进；无 npm 只进 ghKeys；无键不入', () => {
    const gap = curatedGapKeys([
      { id: 'a', npm: 'pkg-a', github: 'o/a' },
      { id: 'b', github: 'o/b' },
      { id: 'c' },
    ])
    assert.deepEqual(gap, { npmKeys: ['pkg-a'], githubKeys: ['o/a', 'o/b'] })
    assert.deepEqual(curatedGapKeys([]), { npmKeys: [], githubKeys: [] })
    assert.deepEqual(curatedGapKeys(null), { npmKeys: [], githubKeys: [] })
  })
})

describe('parseCuratedStatsBox', () => {
  const now = 1_700_000_000_000
  const box = { version: 1, fetchedAt: new Date(now).toISOString(), entries: { 'npm:p': { downloads: 1, checkedAt: 'x' } } }
  it('新鲜箱命中 entries', () => {
    assert.deepEqual(parseCuratedStatsBox(box, now, CURATED_STATS_TTL_MS), box.entries)
  })
  it('TTL 过期 / 畸形形态 / entries 缺失 / 非对象 → null', () => {
    assert.equal(parseCuratedStatsBox(box, now + CURATED_STATS_TTL_MS + 1, CURATED_STATS_TTL_MS), null)
    assert.equal(parseCuratedStatsBox('x', now, CURATED_STATS_TTL_MS), null)
    assert.equal(parseCuratedStatsBox({ version: 1, fetchedAt: new Date(now).toISOString() }, now, CURATED_STATS_TTL_MS), null)
    assert.equal(parseCuratedStatsBox({ version: 1, fetchedAt: new Date(now).toISOString(), entries: 'no' }, now, CURATED_STATS_TTL_MS), null)
    assert.equal(parseCuratedStatsBox(null, now, CURATED_STATS_TTL_MS), null)
  })
})

describe('loadCuratedStats 编排', () => {
  it('npm bulk 一枪 + scoped %2F + gh 逐 repo（并发≤4）+ 缓存写盘；TTL 内免网络', async () => {
    const dir = join(cacheRoot, 'case1')
    const calls = []
    const fetchJson = async (url) => {
      calls.push(String(url))
      if (String(url).includes('downloads/point/last-month/')) return { 'pkg-a': { downloads: 100, start: '2026-10-14', end: '2026-11-12' }, 'pkg-b': { downloads: 200, start: '2026-10-14', end: '2026-11-12' } }
      if (String(url).includes('api.github.com/repos/o/a')) return { stargazers_count: 7 }
      if (String(url).includes('api.github.com/repos/o/b')) return { stargazers_count: 9 }
      throw new Error('unexpected ' + url)
    }
    const r1 = await loadCuratedStats({ npmKeys: ['pkg-a', 'pkg-b'], githubKeys: ['o/a', 'o/b'], dir, deps: { fetchJson } })
    assert.equal(r1.stats['npm:pkg-a'].downloads, 100)
    assert.equal(r1.stats['npm:pkg-a'].downloadsStart, '2026-10-14')
    assert.equal(r1.stats['gh:o/a'].stars, 7)
    assert.equal(r1.errors.length, 0)
    assert.equal(calls.filter((u) => u.includes('last-month')).length, 1, 'bulk 一枪')
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8')).entries).sort(), ['gh:o/a', 'gh:o/b', 'npm:pkg-a', 'npm:pkg-b'])
    // TTL 内免网络：新调用 fetchJson 计数 0
    const before = calls.length
    const r2 = await loadCuratedStats({ npmKeys: ['pkg-a'], githubKeys: ['o/a'], dir, deps: { fetchJson } })
    assert.equal(calls.length, before, 'TTL 内零网络')
    assert.equal(r2.stats['npm:pkg-a'].downloads, 100)
    assert.deepEqual(r2.errors, [])
  })

  it('scoped 包名以 %2F 形态请求', async () => {
    const urls = []
    const r = await loadCuratedStats({ npmKeys: ['@iasiv5/x'], githubKeys: [], dir: join(cacheRoot, 'case2'), deps: { fetchJson: async (url) => { urls.push(String(url)); return { '@iasiv5/x': { downloads: 5, start: 's', end: 'e' } } } } })
    assert.ok(urls[0].includes('%2F'), 'scoped 斜杠编码：' + urls[0])
    assert.equal(r.stats['npm:@iasiv5/x'].downloads, 5)
  })

  it('bulk 失败 → 逐包回退（并发≤4）', async () => {
    const urls = []
    const fetchJson = async (url) => {
      urls.push(String(url))
      if (String(url).includes(',')) throw new Error('bulk 4xx')
      if (String(url).includes('pkg-a')) return { downloads: 11, start: 's', end: 'e' }
      if (String(url).includes('pkg-b')) return { downloads: 22, start: 's', end: 'e' }
      throw new Error('unexpected')
    }
    const r = await loadCuratedStats({ npmKeys: ['pkg-a', 'pkg-b'], githubKeys: [], dir: join(cacheRoot, 'case3'), deps: { fetchJson } })
    assert.equal(r.stats['npm:pkg-a'].downloads, 11)
    assert.equal(r.stats['npm:pkg-b'].downloads, 22)
    assert.ok(urls.filter((u) => u.includes('last-month/')).length >= 3, 'bulk 1 + 逐包 2')
  })

  it('TTL 过期拉取失败 → 旧值保留 + errors 非空；GC prune 不在当前 keys 的键', async () => {
    const dir = join(cacheRoot, 'case4')
    const t0 = 1_700_000_000_000
    let now = t0
    let calls = 0
    const fetchJson = async (url) => {
      calls += 1
      if (calls === 1 && String(url).includes('last-month/')) return { 'pkg-a': { downloads: 1, start: 's', end: 'e' } }
      throw new Error('网络挂了')
    }
    const r1 = await loadCuratedStats({ npmKeys: ['pkg-a'], githubKeys: ['o/old'], dir, ttlMs: CURATED_STATS_TTL_MS, deps: { fetchJson, now: () => now } })
    assert.equal(r1.stats['gh:o/old'], undefined, 'gh 失败不入 stats')
    // 前进到 TTL 过期：pkg-a 网络仍挂 → 旧值保留；o/old 不再请求 → GC
    now = t0 + CURATED_STATS_TTL_MS + 1
    const r2 = await loadCuratedStats({ npmKeys: ['pkg-a'], githubKeys: [], dir, ttlMs: CURATED_STATS_TTL_MS, deps: { fetchJson, now: () => now } })
    assert.equal(r2.stats['npm:pkg-a'].downloads, 1, '过期拉取失败 → 旧值保留（fail-open）')
    assert.ok(r2.errors.length > 0, 'errors 非空')
    const box = JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8'))
    assert.deepEqual(Object.keys(box.entries), ['npm:pkg-a'], 'GC prune 不在当前 keys 的键')
  })

  it('全失败降级：stats 空对象 + errors 非空，不抛', async () => {
    const r = await loadCuratedStats({ npmKeys: ['x'], githubKeys: ['o/x'], dir: join(cacheRoot, 'case5'), deps: { fetchJson: async () => { throw new Error('down') } } })
    assert.deepEqual(r.stats, {})
    assert.ok(r.errors.length >= 2)
  })
})
