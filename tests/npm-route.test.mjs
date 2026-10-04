/**
 * T4（ADR-0012）：npm 路由层——候选/single-flight probe-once/持久化/切换通知/npmmirror sync 原语。
 * 运行：npm run build && node --test tests/npm-route.test.mjs
 * scoped sync URL 形态证据（Task 4 Step 3，2026-10-05 实测）：PUT
 * https://registry-direct.npmmirror.com/@inventec%2Fdsh-copilot-auth/sync?sync_upstream=true → HTTP 201（受理），
 * encodeURIComponent 形态成立（本机 Windows 实机留痕）。
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_NPM_REGISTRY,
  NPM_MIRROR,
  candidates,
  decideNpmRoute,
  onRouteSwitch,
  readNpmrcRegistry,
  resetNpmRouteForTests,
  syncNpmmirrorPackage,
} from '../lib/core/npm-route.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let tmp = ''
let rcPath = ''
const envKeys = ['DSHM_NPM_REGISTRY', 'DSHM_MIRROR_SYNC', 'DSHM_CACHE_DIR']
const savedEnv = new Map()

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'npm-route-'))
  rcPath = join(tmp, '.npmrc')
  savedEnv.clear()
  for (const k of envKeys) savedEnv.set(k, process.env[k])
  process.env.DSHM_CACHE_DIR = tmp
  delete process.env.DSHM_NPM_REGISTRY
  delete process.env.DSHM_MIRROR_SYNC
  resetNpmRouteForTests()
})

afterEach(() => {
  for (const [k, v] of savedEnv.entries()) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  resetNpmRouteForTests()
  rmSync(tmp, { recursive: true, force: true })
})

describe('readNpmrcRegistry', () => {
  it('顶层 registry= 取值并去尾斜杠；scope 键与注释忽略', () => {
    writeFileSync(rcPath, '# c\n; c2\n@scope:registry=https://x.com/\nregistry=https://example.com/\n', 'utf8')
    assert.equal(readNpmrcRegistry(rcPath), 'https://example.com')
  })
  it('文件缺失 → null', () => {
    assert.equal(readNpmrcRegistry(join(tmp, 'absent.npmrc')), null)
  })
})

describe('candidates', () => {
  it('env 覆盖 → 单元素（跳过 .npmrc/官方源/镜像）', () => {
    process.env.DSHM_NPM_REGISTRY = 'https://forced.example'
    assert.deepEqual(candidates(), ['https://forced.example'])
  })
  it('无 env → 含官方源与镜像、去重、至多三条（本机 .npmrc 源参与）', () => {
    const c = candidates()
    assert.ok(c.includes(DEFAULT_NPM_REGISTRY))
    assert.ok(c.includes(NPM_MIRROR))
    assert.equal(new Set(c).size, c.length)
    assert.ok(c.length <= 3)
  })
})

describe('decideNpmRoute', () => {
  it('快者胜（first-past-the-post）、落盘、内存复用不再探测', async () => {
    let calls = 0
    const probeFetch = async (base) => {
      calls++
      if (base === DEFAULT_NPM_REGISTRY) {
        await sleep(80)
        return '9.9.9'
      }
      await sleep(5)
      return '1.0.0'
    }
    const first = await decideNpmRoute({ probeFetch })
    assert.notEqual(first, DEFAULT_NPM_REGISTRY, '慢者（官方源腿）不该赢')
    const doc = JSON.parse(readFileSync(join(tmp, 'npm-route.json'), 'utf8'))
    assert.equal(doc.base, first)
    const before = calls
    assert.equal(await decideNpmRoute({ probeFetch }), first)
    assert.equal(calls, before, '内存决策复用，不再探测')
  })

  it('全 reject → 回退 DEFAULT 且不落盘；TTL 内不重探，过期后重探（R1-8/R2-3）', async () => {
    let calls = 0
    const probeFetch = async () => {
      calls++
      throw new Error('net down')
    }
    const perRound = candidates().length
    const first = await decideNpmRoute({ probeFetch, fallbackTtlMs: 50 })
    assert.equal(first, DEFAULT_NPM_REGISTRY)
    assert.equal(existsSync(join(tmp, 'npm-route.json')), false, '回退不落盘')
    assert.equal(calls, perRound)
    await decideNpmRoute({ probeFetch, fallbackTtlMs: 50 })
    assert.equal(calls, perRound, '回退 TTL 内复用，不重探')
    await sleep(60)
    await decideNpmRoute({ probeFetch, fallbackTtlMs: 50 })
    assert.equal(calls, perRound * 2, '回退过期触发重探')
  })

  it('single-flight：决策缺失时并发共享同一轮 probe（R1-7）', async () => {
    let calls = 0
    const probeFetch = async () => {
      calls++
      await sleep(20)
      return '1.0.0'
    }
    const expectedCalls = candidates().length
    const [a, b, c] = await Promise.all([
      decideNpmRoute({ probeFetch }),
      decideNpmRoute({ probeFetch }),
      decideNpmRoute({ probeFetch }),
    ])
    assert.equal(a, b)
    assert.equal(b, c)
    assert.equal(calls, expectedCalls, 'N 候选各探一次，而非 N×并发')
  })

  it('决策文件存在 → 不探测直接采用', async () => {
    writeFileSync(join(tmp, 'npm-route.json'), JSON.stringify({ base: NPM_MIRROR, decidedAt: 'x', candidates: [] }), 'utf8')
    let calls = 0
    const probeFetch = async () => {
      calls++
      return '1'
    }
    assert.equal(await decideNpmRoute({ probeFetch }), NPM_MIRROR)
    assert.equal(calls, 0)
  })

  it('onRouteSwitch：生效值变化触发 listener（env 直采优先于决策文件）', async () => {
    const seen = []
    onRouteSwitch((b) => seen.push(b))
    writeFileSync(join(tmp, 'npm-route.json'), JSON.stringify({ base: 'https://file.example', decidedAt: 'x', candidates: [] }), 'utf8')
    process.env.DSHM_NPM_REGISTRY = 'https://env.example'
    assert.equal(await decideNpmRoute(), 'https://env.example')
    assert.deepEqual(seen, ['https://env.example'])
  })
})

describe('syncNpmmirrorPackage', () => {
  it('kill switch：不发请求直接 false', async () => {
    process.env.DSHM_MIRROR_SYNC = '0'
    let called = 0
    const r = await syncNpmmirrorPackage('@scope/pkg', {
      fetcher: async () => {
        called++
        return { ok: true }
      },
    })
    assert.equal(r, false)
    assert.equal(called, 0)
  })

  it('2xx → true；URL 为 encodeURIComponent 形态 + sync_upstream=true', async () => {
    let seenUrl = ''
    const r = await syncNpmmirrorPackage('@inventec/dsh-copilot-auth', {
      fetcher: async (url) => {
        seenUrl = String(url)
        return { ok: true }
      },
    })
    assert.equal(r, true)
    assert.ok(seenUrl.startsWith('https://registry-direct.npmmirror.com/%40inventec%2Fdsh-copilot-auth/sync?'), seenUrl)
    assert.ok(seenUrl.includes('sync_upstream=true'))
  })

  it('fetcher 抛错 → false 不抛', async () => {
    const r = await syncNpmmirrorPackage('pkg', {
      fetcher: async () => {
        throw new Error('down')
      },
    })
    assert.equal(r, false)
  })
})

// ---------- env 尾斜杠归一（评审 R1-3，ADR-0012） ----------

describe('DSHM_NPM_REGISTRY 尾斜杠归一（评审 R1-3）', () => {
  it('candidates 与 decideNpmRoute 对带尾斜杠的 env 值统一去尾斜杠', async () => {
    process.env.DSHM_NPM_REGISTRY = `${NPM_MIRROR}/`
    assert.deepEqual(candidates(), [NPM_MIRROR])
    assert.equal(await decideNpmRoute(), NPM_MIRROR)
  })
})
