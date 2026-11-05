/**
 * published-at（ADR-0031）单测：纯派生（modifiedOf / publishedAtParts）与磁盘缓存层
 * （fetchPublishedAt：TTL 24h 硬过期 / 成功才落盘 / 回盘失败吞错 / evictOldest / 并发写）。
 * 全部注入 stub 零真网络；路由用 DSHM_NPM_REGISTRY env override（decideNpmRoute 第 1
 * 优先级：直采不探测不落盘，packument.test.mjs 同款先例）+ resetNpmRouteForTests 控制；
 * 缓存落点经 DSHM_CACHE_DIR 指临时目录（env.ts 红线先例）。
 * 运行：npm run build --silent && node --test tests/published-at.test.mjs
 */
import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PUBLISHED_AT_TTL_MS,
  PUBLISHED_AT_STORE_MAX,
  modifiedOf,
  publishedAtParts,
  fetchPublishedAt,
  evictOldest,
  clearPublishedAtCacheForTest,
} from '../lib/core/published-at.js'
import { resetNpmRouteForTests } from '../lib/core/npm-route.js'

describe('publishedAtParts / modifiedOf 纯派生', () => {
  it('modifiedOf：modified 键在场且可解析时原样返回', () => {
    assert.equal(
      modifiedOf({ modified: '2026-10-27T08:00:00.000Z', '1.0.0': '2026-10-01T00:00:00.000Z' }),
      '2026-10-27T08:00:00.000Z',
    )
  })

  it('modifiedOf：modified 缺席时取非 created 键的最大时刻', () => {
    assert.equal(
      modifiedOf({
        created: '2026-01-01T00:00:00.000Z',
        '1.0.0': '2026-10-01T00:00:00.000Z',
        '2.0.0': '2026-10-02T00:00:00.000Z',
      }),
      '2026-10-02T00:00:00.000Z',
    )
  })

  it('modifiedOf：空表 / 全不可解析 → null', () => {
    assert.equal(modifiedOf({}), null)
    assert.equal(modifiedOf({ '1.0.0': 'not-a-date', created: 'also-bad' }), null)
  })

  it('modifiedOf：不可解析的 modified 键回退版本键最大值', () => {
    assert.equal(
      modifiedOf({ modified: 'garbage', '1.0.0': '2026-10-01T00:00:00.000Z' }),
      '2026-10-01T00:00:00.000Z',
    )
  })

  it('publishedAtParts：跨月日界取整（7d23h → days 7）', () => {
    assert.deepEqual(publishedAtParts('2026-10-27T00:00:00.000Z', Date.parse('2026-11-03T23:00:00.000Z')), {
      date: '2026-10-27',
      days: 7,
    })
  })

  it('publishedAtParts：同刻 → days 0；未来时刻 clamp 为 0', () => {
    const now = Date.parse('2026-11-05T10:00:00.000Z')
    assert.deepEqual(publishedAtParts('2026-11-05T10:00:00.000Z', now), { date: '2026-11-05', days: 0 })
    assert.deepEqual(publishedAtParts('2026-11-05T11:00:00.000Z', now), { date: '2026-11-05', days: 0 })
  })

  it('publishedAtParts：非法 ISO → null', () => {
    assert.equal(publishedAtParts('not-a-date'), null)
  })

  it('常量口径：TTL 24h、store 上限 2 万（B4）', () => {
    assert.equal(PUBLISHED_AT_TTL_MS, 24 * 60 * 60_000)
    assert.equal(PUBLISHED_AT_STORE_MAX, 20_000)
  })
})

describe('fetchPublishedAt 磁盘缓存', () => {
  const KEY_A = 'pkg-a\nhttps://registry.npmjs.org'
  const times = { modified: '2026-11-01T00:00:00.000Z', '1.0.0': '2026-10-01T00:00:00.000Z' }
  let cacheDir
  let calls
  const stub = async () => { calls += 1; return times }

  before(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'dshm-pubat-'))
    process.env.DSHM_CACHE_DIR = cacheDir
    process.env.DSHM_NPM_REGISTRY = 'https://registry.npmjs.org' // decideNpmRoute 第 1 优先级：直采不探测（packument.test.mjs 先例）
    resetNpmRouteForTests()
  })
  beforeEach(() => {
    clearPublishedAtCacheForTest()
    calls = 0
  })

  it('① 首取成功：返回值正确，store 键恰为 pkg-a + 生效 registry（R3 精确键断言）', async () => {
    const got = await fetchPublishedAt('pkg-a', 12_000, undefined, { packumentTimes: stub })
    assert.equal(got, times.modified)
    const store = JSON.parse(readFileSync(join(cacheDir, 'published-at', 'store.json'), 'utf8'))
    assert.deepEqual(Object.keys(store.entries), [KEY_A])
    assert.equal(store.entries[KEY_A].modified, times.modified)
    assert.equal(typeof store.entries[KEY_A].at, 'number')
    assert.equal(calls, 1)
  })

  it('② TTL 内二调：磁盘直回，取数 stub 零调用', async () => {
    const got = await fetchPublishedAt('pkg-a', 12_000, undefined, { packumentTimes: stub })
    assert.equal(got, times.modified)
    assert.equal(calls, 0)
  })

  it('③ nowMs 推进 TTL+1 → 过期重取', async () => {
    const got = await fetchPublishedAt('pkg-a', 12_000, undefined, {
      packumentTimes: stub,
      nowMs: () => Date.now() + PUBLISHED_AT_TTL_MS + 1,
    })
    assert.equal(got, times.modified)
    assert.equal(calls, 1)
  })

  it('④ 取数失败不落盘：连败两次均 null，store 不增益该键', async () => {
    let nullCalls = 0
    const nullStub = async () => { nullCalls += 1; return null }
    assert.equal(await fetchPublishedAt('pkg-null', 12_000, undefined, { packumentTimes: nullStub }), null)
    assert.equal(await fetchPublishedAt('pkg-null', 12_000, undefined, { packumentTimes: nullStub }), null)
    assert.equal(nullCalls, 2)
    const store = JSON.parse(readFileSync(join(cacheDir, 'published-at', 'store.json'), 'utf8'))
    assert.ok(!('pkg-null\nhttps://registry.npmjs.org' in store.entries))
  })

  it('⑤ 失败后成功：回写生效', async () => {
    const got = await fetchPublishedAt('pkg-back', 12_000, undefined, { packumentTimes: stub })
    assert.equal(got, times.modified)
    const store = JSON.parse(readFileSync(join(cacheDir, 'published-at', 'store.json'), 'utf8'))
    assert.equal(store.entries['pkg-back\nhttps://registry.npmjs.org'].modified, times.modified)
  })

  it('⑥ evictOldest：超限淘汰 at 最旧', () => {
    const out = evictOldest(
      { a: { modified: 'x', at: 1 }, b: { modified: 'y', at: 2 }, c: { modified: 'z', at: 3 } },
      2,
    )
    assert.deepEqual(Object.keys(out).sort(), ['b', 'c'])
  })

  it('⑦ 并发双写：store 仍为合法 JSON 且含两键', async () => {
    await Promise.all([
      fetchPublishedAt('pkg-x', 12_000, undefined, { packumentTimes: stub }),
      fetchPublishedAt('pkg-y', 12_000, undefined, { packumentTimes: stub }),
    ])
    const store = JSON.parse(readFileSync(join(cacheDir, 'published-at', 'store.json'), 'utf8'))
    assert.ok('pkg-x\nhttps://registry.npmjs.org' in store.entries)
    assert.ok('pkg-y\nhttps://registry.npmjs.org' in store.entries)
  })

  it('⑧ 回盘失败吞错（R2）：占位必败仍返回值；解除后过期重取正常落盘', async () => {
    const dir = join(cacheDir, 'published-at')
    rmSync(dir, { recursive: true, force: true }) // 移除①-⑦累积的 store 目录后占位为同名普通文件（POSIX/Windows 同判）
    writeFileSync(dir, 'placeholder')
    try {
      const got = await fetchPublishedAt('pkg-8', 12_000, undefined, { packumentTimes: stub })
      assert.equal(got, times.modified, '回盘失败吞错，仍返回已取得值')
    } finally {
      rmSync(dir, { force: true })
    }
    calls = 0
    const got2 = await fetchPublishedAt('pkg-8', 12_000, undefined, {
      packumentTimes: stub,
      nowMs: () => Date.now() + PUBLISHED_AT_TTL_MS + 1,
    })
    assert.equal(got2, times.modified)
    const store = JSON.parse(readFileSync(join(cacheDir, 'published-at', 'store.json'), 'utf8'))
    assert.ok('pkg-8\nhttps://registry.npmjs.org' in store.entries, '解除占位后正常落盘')
  })
})
