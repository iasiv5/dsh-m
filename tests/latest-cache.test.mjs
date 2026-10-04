/**
 * 0.9.20：latest 探测缓存纯内存语义（ADR-0006：0.9.14 磁盘信封层退役）。
 * 运行：npm run build && node --test tests/latest-cache.test.mjs
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { beforeEach, afterEach, describe, it } from 'node:test'
import { writeLatestCache, readLatestCache, invalidateLatestCache, ensureLatestCacheSwept, resetLatestCacheForTest, latestCacheKey, latestItemId } from '../lib/core/latest-cache.js'

describe('clearAllLatestCache（L1 路由切换，ADR-0012）', () => {
  it('写入两条 → clearAll → 读回空', async () => {
    const { clearAllLatestCache } = await import('../lib/core/latest-cache.js')
    writeLatestCache('host|k|npm:p', { version: '1' })
    writeLatestCache('cli|k|npm:q', { version: '2' })
    clearAllLatestCache()
    assert.equal(readLatestCache('host|k|npm:p', 60), null)
    assert.equal(readLatestCache('cli|k|npm:q', 60), null)
  })
})

describe('latest-cache 纯内存（ADR-0006）', () => {
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

  it('写入即可读（纯内存，无落盘依赖）', () => {
    const key = latestCacheKey('host', '', { source: 'npm', id: 'a', npm: 'a' })
    writeLatestCache(key, { version: '1.2.3' })
    assert.equal(readLatestCache(key, 60)?.version, '1.2.3')
  })

  it('ttlMin=0 视为过期：返回 null 且条目被删（不复活）', () => {
    const key = latestCacheKey('host', '', { source: 'npm', id: 'a', npm: 'a' })
    writeLatestCache(key, { version: '1.2.3' })
    assert.equal(readLatestCache(key, 0), null)
    assert.equal(readLatestCache(key, 60), null, '过期条目已从内存删除')
  })

  it('namespace 隔离保持：host 写入，cli 读不到', () => {
    const key = latestCacheKey('host', '', { source: 'npm', id: 'a', npm: 'a' })
    writeLatestCache(key, { version: '1.2.3' })
    assert.equal(readLatestCache(latestCacheKey('cli', '', { source: 'npm', id: 'a', npm: 'a' }), 60), null)
  })

  it('不落盘：写入后 latest/<ns>.json 不存在（磁盘信封已退役）', async () => {
    writeLatestCache(latestCacheKey('host', '', { source: 'npm', id: 'a', npm: 'a' }), { version: '1.2.3' })
    await ensureLatestCacheSwept({ namespace: 'host' })
    assert.equal(existsSync(join(cacheRoot, 'latest', 'host.json')), false)
  })

  it('遗留信封清扫：旧 host.json 被删且只清扫一次；他 namespace 信封不误删', async () => {
    mkdirSync(join(cacheRoot, 'latest'), { recursive: true })
    const hostFile = join(cacheRoot, 'latest', 'host.json')
    const cliFile = join(cacheRoot, 'latest', 'cli.json')
    writeFileSync(hostFile, '{"version":1,"namespace":"host","entries":{}}')
    writeFileSync(cliFile, '{"version":1,"namespace":"cli","entries":{}}')
    await ensureLatestCacheSwept({ namespace: 'host' })
    assert.equal(existsSync(hostFile), false, '遗留 host 信封被清扫')
    assert.equal(existsSync(cliFile), true, 'cli 信封不受 host 清扫影响')
    writeFileSync(hostFile, '{}')                       // 清扫后重建
    await ensureLatestCacheSwept({ namespace: 'host' }) // 记忆化：不再扫
    assert.equal(existsSync(hostFile), true, '每 (namespace,profile) 只清扫一次')
  })
})

describe('invalidateLatestCache（0.9.20 ①：mutation 定向失效）', () => {
  let cacheRoot
  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'dshm-latest-inv-'))
    process.env.DSHM_CACHE_DIR = cacheRoot
  })
  afterEach(() => {
    delete process.env.DSHM_CACHE_DIR
    rmSync(cacheRoot, { recursive: true, force: true })
    resetLatestCacheForTest()
  })

  it('按 itemId 尾段跨 registryKey 全清；跨 namespace / 他条目不误伤', () => {
    const item = { source: 'npm', id: 'a', npm: 'a' }
    const browseKey = latestCacheKey('host', 'addr-a', item)
    const npmOnlyKey = latestCacheKey('host', 'npm-only', item)
    const cliKey = latestCacheKey('cli', 'addr-a', item)
    const otherKey = latestCacheKey('host', 'addr-a', { source: 'npm', id: 'b', npm: 'b' })
    for (const key of [browseKey, npmOnlyKey, cliKey, otherKey]) writeLatestCache(key, { version: '1.0.0' })

    assert.equal(invalidateLatestCache('host', latestItemId(item)), 2)
    assert.equal(readLatestCache(browseKey, 60), null)
    assert.equal(readLatestCache(npmOnlyKey, 60), null)
    assert.ok(readLatestCache(cliKey, 60), '跨 namespace 不误伤')
    assert.ok(readLatestCache(otherKey, 60), '他条目不误伤')
  })

  it('github 条目按 gh:owner/repo 失效', () => {
    const item = { source: 'github', id: 'g', github: 'o/r' }
    const key = latestCacheKey('host', 'addr-g', item)
    writeLatestCache(key, { tag: 'v1' })
    assert.equal(invalidateLatestCache('host', latestItemId(item)), 1)
    assert.equal(readLatestCache(key, 60), null)
  })
})
