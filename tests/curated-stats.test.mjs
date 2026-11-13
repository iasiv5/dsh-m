/**
 * 精选缺口直查（ADR-0036 R10：gh star 直查退役，npm 下载量族单源）：
 * 缺口键集纯函数 / 缓存箱解析（TTL+形态+空箱防污染）/ 编排（bulk 一枪+scoped %2F
 * +bulk 省略键缺键逐包回退+bulk 失败逐包回退+缓存写盘+TTL 内免网络
 * +过期拉取失败旧值保留+GC prune+全失败不落盘+被污染空箱重拉）。
 * 运行：npm run build && node --test tests/curated-stats.test.mjs
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { curatedGapKeys, parseCuratedStatsBox, loadCuratedStats, annotateDirectStats, CURATED_STATS_TTL_MS } from '../lib/core/curated-stats.js'
import { isCommunityEntry } from '../lib/core/merged-market.js'

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
  it('TTL 过期 / 畸形形态 / entries 缺失 / 非对象 / 空箱 → null（R5：空箱不得抑制重试）', () => {
    assert.equal(parseCuratedStatsBox(box, now + CURATED_STATS_TTL_MS + 1, CURATED_STATS_TTL_MS), null)
    assert.equal(parseCuratedStatsBox('x', now, CURATED_STATS_TTL_MS), null)
    assert.equal(parseCuratedStatsBox({ version: 1, fetchedAt: new Date(now).toISOString() }, now, CURATED_STATS_TTL_MS), null)
    assert.equal(parseCuratedStatsBox({ version: 1, fetchedAt: new Date(now).toISOString(), entries: 'no' }, now, CURATED_STATS_TTL_MS), null)
    assert.equal(parseCuratedStatsBox(null, now, CURATED_STATS_TTL_MS), null)
    assert.equal(parseCuratedStatsBox({ version: 1, fetchedAt: new Date(now).toISOString(), entries: {} }, now, CURATED_STATS_TTL_MS), null)
  })
})

describe('loadCuratedStats 编排（R10：npm 下载量单源）', () => {
  it('bulk 一枪 + scoped %2F + 缓存写盘；TTL 内免网络', async () => {
    const dir = join(cacheRoot, 'case1')
    const calls = []
    const fetchJson = async (url) => {
      calls.push(String(url))
      if (String(url).includes('downloads/point/last-month/')) return { 'pkg-a': { downloads: 100, start: '2026-10-14', end: '2026-11-12' }, 'pkg-b': { downloads: 200, start: '2026-10-14', end: '2026-11-12' } }
      throw new Error('unexpected ' + url)
    }
    const r1 = await loadCuratedStats({ npmKeys: ['pkg-a', 'pkg-b'], dir, deps: { fetchJson } })
    assert.equal(r1.stats['npm:pkg-a'].downloads, 100)
    assert.equal(r1.stats['npm:pkg-a'].downloadsStart, '2026-10-14')
    assert.equal(r1.errors.length, 0)
    assert.equal(calls.filter((u) => u.includes('last-month')).length, 1, 'bulk 一枪')
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8')).entries).sort(), ['npm:pkg-a', 'npm:pkg-b'])
    const before = calls.length
    const r2 = await loadCuratedStats({ npmKeys: ['pkg-a'], dir, deps: { fetchJson } })
    assert.equal(calls.length, before, 'TTL 内零网络')
    assert.equal(r2.stats['npm:pkg-a'].downloads, 100)
  })

  it('scoped 包名以 %2F 形态请求', async () => {
    const urls = []
    const r = await loadCuratedStats({ npmKeys: ['@iasiv5/x'], dir: join(cacheRoot, 'case2'), deps: { fetchJson: async (url) => { urls.push(String(url)); return { '@iasiv5/x': { downloads: 5, start: 's', end: 'e' } } } } })
    assert.ok(urls[0].includes('%2F'), 'scoped 斜杠编码：' + urls[0])
    assert.equal(r.stats['npm:@iasiv5/x'].downloads, 5)
  })

  it('bulk 省略键（无记录/0 下载包，npm bulk 实测行为）→ 缺键逐包 point 回退补齐（R7）', async () => {
    const urls = []
    const fetchJson = async (url) => {
      urls.push(String(url))
      if (String(url).includes(',')) return { 'pkg-hot': { downloads: 500, start: 's', end: 'e' } }
      if (String(url).includes('pkg-zero')) return { downloads: 0, start: 's', end: 'e' }
      throw new Error('unexpected ' + url)
    }
    const r = await loadCuratedStats({ npmKeys: ['pkg-hot', 'pkg-zero'], dir: join(cacheRoot, 'case7'), deps: { fetchJson } })
    assert.equal(r.stats['npm:pkg-hot'].downloads, 500)
    assert.equal(r.stats['npm:pkg-zero'].downloads, 0, 'point 对 0 下载返回 0（键级补齐）')
    assert.ok(urls.filter((u) => u.includes('pkg-zero') && !u.includes(',')).length >= 1, '缺键逐包回退发生')
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
    const r = await loadCuratedStats({ npmKeys: ['pkg-a', 'pkg-b'], dir: join(cacheRoot, 'case3'), deps: { fetchJson } })
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
    const _r1 = await loadCuratedStats({ npmKeys: ['pkg-a'], dir, ttlMs: CURATED_STATS_TTL_MS, deps: { fetchJson, now: () => now } })
    now = t0 + CURATED_STATS_TTL_MS + 1
    const r2 = await loadCuratedStats({ npmKeys: ['pkg-a'], dir, ttlMs: CURATED_STATS_TTL_MS, deps: { fetchJson, now: () => now } })
    assert.equal(_r1.stats['npm:pkg-a'].downloads, 1, '首次拉取正常（对照）')
    assert.equal(r2.stats['npm:pkg-a'].downloads, 1, '过期拉取失败 → 旧值保留（fail-open）')
    assert.ok(r2.errors.length > 0, 'errors 非空')
    const box = JSON.parse(readFileSync(join(dir, 'stats.json'), 'utf8'))
    assert.deepEqual(Object.keys(box.entries), ['npm:pkg-a'], 'GC prune 不在当前 keys 的键')
  })

  it('全失败降级：stats 空对象 + errors 非空，不抛；不落盘空箱（防污染抑制重试，评审 R5）', async () => {
    const dir = join(cacheRoot, 'case5')
    const r = await loadCuratedStats({ npmKeys: ['x'], dir, deps: { fetchJson: async () => { throw new Error('down') } } })
    assert.deepEqual(r.stats, {})
    assert.ok(r.errors.length >= 1)
    assert.equal(existsSync(join(dir, 'stats.json')), false, '全失败不写箱')
  })

  it('被污染的新鲜空箱 → 视为无缓存并重拉（评审 R5 现场复演：真实目录空箱抑制数字 24h）', async () => {
    const dir = join(cacheRoot, 'case6')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'stats.json'), JSON.stringify({ version: 1, fetchedAt: new Date().toISOString(), entries: {} }))
    const r = await loadCuratedStats({ npmKeys: ['pkg-a'], dir, deps: { fetchJson: async (url) => String(url).includes('pkg-a') ? { 'pkg-a': { downloads: 100, start: 's', end: 'e' } } : Promise.reject(new Error('no')) } })
    assert.equal(r.stats['npm:pkg-a'].downloads, 100, '空箱不抑制重试')
  })
})

describe('annotateDirectStats 社区门（评审 P2）', () => {
  it('社区条目与精选缺口同 npm 直查键 → 不被注记（toMarketItem 社区分支 statsVia 硬置 catalog，不得被 direct 预写失真）', () => {
    const curated = { id: 'p-1', npm: 'pkg-x' }
    const comm = { id: 'cz--mirror', npm: 'pkg-x', descriptionEn: 'community mirror of pkg-x', owner: 'cz', stars: null, downloads: null }
    assert.equal(isCommunityEntry(comm), true, '夹具前置：isCommunityEntry 判据（descriptionEn 在场）')
    const out = annotateDirectStats([curated, comm], { 'npm:pkg-x': { downloads: 99, checkedAt: '2026-11-14T00:00:00.000Z' } })
    assert.equal(out[0].downloads, 99, '精选缺口条目照常注记')
    assert.equal(out[0].statsVia, 'direct', '精选缺口条目来源标记 direct')
    assert.equal(out[1].statsVia, undefined, '社区条目不被直查注记（镜像与精选同 npm 且 downloads=null 的 latent 边界）')
    assert.equal(out[1].downloads, null, '社区条目自身字段原样（不覆写）')
    assert.equal(out[1].downloadsCheckedAt, undefined, '社区条目无直查查于时点')
  })
})
