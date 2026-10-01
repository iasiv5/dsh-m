/**
 * 0.9.14 Task 4a：latest 探测缓存落盘（信封 seed + write-through，双 profile 隔离）。
 * 运行：npm run build && node --test tests/latest-cache.test.mjs
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { beforeEach, afterEach, describe, it } from 'node:test'
import { writeLatestCache, readLatestCache, ensureLatestCacheSeeded, resetLatestCacheForTest, latestCacheKey } from '../lib/core/latest-cache.js'

describe('latest-cache 落盘', () => {
  let cacheRoot
  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'dshm-latest-'))
    process.env.DSHM_CACHE_DIR = cacheRoot
  })
  afterEach(() => {
    delete process.env.DSHM_CACHE_DIR
    rmSync(cacheRoot, { recursive: true, force: true })
    resetLatestCacheForTest()
  })

  it('write-through：写入 → reset 模拟重启 → seed → readLatestCache 命中（零网络）', async () => {
    const key = latestCacheKey('host', '', { source: 'npm', id: 'a', npm: 'a' })
    writeLatestCache(key, { version: '1.2.3' })
    resetLatestCacheForTest()
    await ensureLatestCacheSeeded({ namespace: 'host' })
    assert.equal(readLatestCache(key, 60)?.version, '1.2.3')
  })

  it('TTL 过期条目 readLatestCache 返回 null（语义不变）', async () => {
    const key = latestCacheKey('host', '', { source: 'npm', id: 'a', npm: 'a' })
    writeLatestCache(key, { version: '1.2.3' })
    await ensureLatestCacheSeeded({ namespace: 'host' })   // 排空 write-through 队列，信封文件已落盘
    // 把信封里的 at 回拨 2h（仍在 24h seed 上限内、但超出 60min TTL）
    const file = join(cacheRoot, 'latest', 'host.json')
    const env = JSON.parse(readFileSync(file, 'utf8'))
    env.entries[key].at = Date.now() - 2 * 60 * 60 * 1000
    writeFileSync(file, JSON.stringify(env))
    resetLatestCacheForTest()
    await ensureLatestCacheSeeded({ namespace: 'host' })
    assert.equal(readLatestCache(key, 60), null)
  })

  it('损坏信封静默弃、seed 后照常可写', async () => {
    const { mkdirSync, writeFileSync: wf } = await import('node:fs')
    mkdirSync(join(cacheRoot, 'latest'), { recursive: true })
    wf(join(cacheRoot, 'latest', 'host.json'), 'not-json')
    await ensureLatestCacheSeeded({ namespace: 'host' })   // 不抛
    const key = latestCacheKey('host', '', { source: 'npm', id: 'b', npm: 'b' })
    writeLatestCache(key, { version: '2.0.0' })
    assert.equal(readLatestCache(key, 60)?.version, '2.0.0')
  })

  it('namespace 隔离：host 写入，cli seed 不命中', async () => {
    const key = latestCacheKey('host', '', { source: 'npm', id: 'a', npm: 'a' })
    writeLatestCache(key, { version: '1.2.3' })
    resetLatestCacheForTest()
    await ensureLatestCacheSeeded({ namespace: 'cli' })
    assert.equal(readLatestCache(key, 60), null)
  })
})
