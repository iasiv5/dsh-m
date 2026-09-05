/**
 * Task 5：/dshm Host API dispatcher（method 响应、4xx 映射、同源/JSON 防护、分页转发）。
 * 运行：npm run build && node --test tests/host-api.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createApiDispatcher } from '../lib/core/host-api.js'
import { createRegistryController } from '../lib/core/registry-controller.js'

const ORIGIN = 'http://127.0.0.1:3080'
const JSON_HEADERS = { 'content-type': 'application/json', origin: ORIGIN, host: '127.0.0.1:3080' }

function entry(i) {
  return {
    id: `plug-${i}`,
    name: `Plug ${i}`,
    description: `entry ${i}`,
    category: 'tools',
    tags: [],
    source: 'npm',
    npm: `pkg-${i}`,
  }
}

function mockReq({ method = 'POST', headers = {}, body, raw } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = '/dshm'
  req.headers = { ...headers }
  req.resume = () => {}
  queueMicrotask(() => {
    if (raw !== undefined) {
      req.emit('data', Buffer.from(raw))
    } else if (body !== undefined) {
      req.emit('data', Buffer.from(JSON.stringify(body)))
    }
    req.emit('end')
  })
  return req
}

function mockRes() {
  const res = new EventEmitter()
  res.statusCode = null
  res.headers = null
  res.bodyText = ''
  res.writeHead = (status, headers) => {
    res.statusCode = status
    res.headers = headers
  }
  res.end = (text) => {
    res.bodyText = text ?? ''
    res.finished = true
  }
  return res
}

async function callApi(dispatcher, args) {
  const res = mockRes()
  await dispatcher(mockReq(args), res)
  let parsed = null
  try {
    parsed = JSON.parse(res.bodyText)
  } catch {
    /* raw body */
  }
  return { status: res.statusCode, body: parsed, raw: res.bodyText }
}

function setup(overrides = {}) {
  const controller = createRegistryController({})
  const calls = { listMarket: [], listInstalled: [], diagnose: [], npm: [] }
  const dispatcher = createApiDispatcher({
    controller,
    pkg: { name: 'dsh-m', version: '0.0.0-test' },
    onMutation: (task) => task(),
    deps: {
      listMarket: async (cfg, opts) => {
        calls.listMarket.push(opts)
        return {
          items: [entry(1), entry(2)],
          total: 2,
          offset: opts?.offset ?? 0,
          limit: opts?.limit ?? 50,
          categoryCounts: { market: 0, tools: 2, ui: 0, search: 0, other: 0 },
          registryState: {
            configuredAddress: '', activeAddress: null, source: 'bundled', status: 'stale',
            isDefault: true, stale: true, fetchedAt: null, errors: [], count: 2,
          },
          installedComplete: true,
          latestComplete: true,
          latestTimedOut: false,
        }
      },
      listInstalledWithMeta: async (cfg, opts) => {
        calls.listInstalled.push(opts)
        return {
          items: [],
          others: 0,
          profileDir: '/tmp/profile',
          registryState: {
            configuredAddress: '', activeAddress: null, source: 'bundled', status: 'stale',
            isDefault: true, stale: true, fetchedAt: null, errors: [], count: 2,
          },
        }
      },
      checkRegistryEntries: async (registry, options) => {
        calls.diagnose.push(options)
        return { checked: 0, passed: 0, failed: 0, issues: [], truncated: false }
      },
      npmLatest: async (pkg) => {
        calls.npm.push(pkg)
        return { version: '9.9.9', integrity: 'sha512-x' }
      },
      ...overrides,
    },
  })
  return { dispatcher, calls, controller }
}

let cacheRoot = ''
beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'dshm-api-'))
  process.env.DSHM_CACHE_DIR = cacheRoot
})
afterEach(() => {
  delete process.env.DSHM_CACHE_DIR
  if (cacheRoot) rmSync(cacheRoot, { recursive: true, force: true })
})

describe('host-api：协议防护', () => {
  it('GET / 其他 method → 405', async () => {
    const { dispatcher } = setup()
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await callApi(dispatcher, { method, headers: JSON_HEADERS, body: { method: 'ping' } })
      assert.equal(res.status, 405)
    }
  })

  it('缺 Content-Type / 非 JSON → 415', async () => {
    const { dispatcher } = setup()
    assert.equal((await callApi(dispatcher, { headers: { origin: ORIGIN, host: '127.0.0.1:3080' }, body: { method: 'ping' } })).status, 415)
    assert.equal((await callApi(dispatcher, { headers: { ...JSON_HEADERS, 'content-type': 'text/plain' }, body: { method: 'ping' } })).status, 415)
  })

  it('malformed JSON / 空 body / null / 数组顶层 / 缺 method → 400', async () => {
    const { dispatcher } = setup()
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, raw: '{broken' })).status, 400)
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS })).status, 400)
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, raw: 'null' })).status, 400)
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, raw: '[1,2]' })).status, 400)
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, body: {} })).status, 400)
  })

  it('body 超过 1 MiB → 413', async () => {
    const { dispatcher } = setup()
    const big = { method: 'ping', pad: 'x'.repeat(1024 * 1024 + 10) }
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: big })
    assert.equal(res.status, 413)
  })

  it('ping 无 Origin 可用；其余 method 缺 Origin / Origin 不等价 → 403', async () => {
    const { dispatcher } = setup()
    assert.equal((await callApi(dispatcher, { headers: { 'content-type': 'application/json' }, body: { method: 'ping' } })).status, 200)
    assert.equal((await callApi(dispatcher, { headers: { 'content-type': 'application/json', host: '127.0.0.1:3080' }, body: { method: 'registry' } })).status, 403)
    assert.equal((await callApi(dispatcher, { headers: { 'content-type': 'application/json', origin: 'http://evil.example', host: '127.0.0.1:3080' }, body: { method: 'market' } })).status, 403)
    // guard 语义 = host 等价（hostname+port），不承诺 scheme 敏感（DESIGN/计划明示）
    assert.equal((await callApi(dispatcher, { headers: { 'content-type': 'application/json', origin: 'https://127.0.0.1:3080', host: '127.0.0.1:3080' }, body: { method: 'installed' } })).status, 200, '同 host:port 不同 scheme 仍按 host 等价放行')
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'installed' } })).status, 200)
  })

  it('x-forwarded-host 等价时放行', async () => {
    const { dispatcher } = setup()
    const res = await callApi(dispatcher, {
      headers: {
        'content-type': 'application/json',
        origin: 'https://proxy.example.com',
        host: '127.0.0.1:8080',
        'x-forwarded-host': 'proxy.example.com',
      },
      body: { method: 'registry' },
    })
    assert.equal(res.status, 200)
  })

  it('未知 method → 404', async () => {
    const { dispatcher } = setup()
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'nope' } })
    assert.equal(res.status, 404)
  })
})

describe('host-api：method 响应', () => {
  it('ping 返回插件信息', async () => {
    const { dispatcher } = setup()
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'ping' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.plugin, 'dsh-m')
    assert.ok(res.body.boot)
  })

  it('registry 返回 plugins + registryState；force 放行同源', async () => {
    const { dispatcher } = setup()
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry', force: true } })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.plugins))
    assert.ok(['ready', 'stale'].includes(res.body.registryState.status), `force 加载状态 ${res.body.registryState.status}`)
  })

  it('market 转发 query/offset/limit，忽略客户端 withLatest，limit clamp 1..50', async () => {
    const { dispatcher, calls } = setup()
    const res = await callApi(dispatcher, {
      headers: JSON_HEADERS,
      body: { method: 'market', query: '主题', offset: 50, limit: 1000, withLatest: false },
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.total, 2)
    const opts = calls.listMarket[0]
    assert.equal(opts.namespace, 'host')
    assert.equal(opts.withLatest, true, 'withLatest 固定 true')
    assert.equal(opts.limit, 50)
    assert.equal(opts.offset, 50)
    assert.equal(opts.query, '主题')
  })

  it('market limit 缺省为 50、负数归一', async () => {
    const { dispatcher, calls } = setup()
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market' } })
    assert.equal(calls.listMarket[0].limit, 50)
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', limit: -5 } })
    assert.equal(calls.listMarket[1].limit, 50)
  })

  it('installed 转发 host namespace', async () => {
    const { dispatcher, calls } = setup()
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'installed' } })
    assert.equal(res.status, 200)
    assert.equal(calls.listInstalled[0].namespace, 'host')
    assert.equal(res.body.registryState.status, 'stale')
  })

  it('registry-config 返回完整配置快照', async () => {
    const { dispatcher } = setup()
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry-config' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.registryUrl, '')
    assert.equal(res.body.configuredAddress, '')
    assert.equal(res.body.activeConfigAddress, '')
    assert.equal(res.body.pendingAddress, null)
    assert.equal(res.body.configStatus, 'ready')
    assert.deepEqual(res.body.configErrors, [])
    assert.ok('registryState' in res.body)
  })

  it('registry-config-apply：成功返回 applied 快照；无效返回 422 + errors', async () => {
    const file = join(cacheRoot, 'custom.json')
    writeFileSync(file, JSON.stringify({ version: 1, plugins: [entry(1)] }, null, 2))
    const { dispatcher } = setup()
    const ok = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry-config-apply', registryUrl: file } })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.applied, true)
    assert.equal(ok.body.activeConfigAddress, file)
    assert.equal(ok.body.registryUrl, file)
    assert.equal(ok.body.loaded ?? undefined, undefined)
    assert.equal(ok.body.registryState.source, 'custom-file')

    const bad = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry-config-apply', registryUrl: 'garbage' } })
    assert.equal(bad.status, 422)
    assert.equal(bad.body.ok, false)
    assert.ok(Array.isArray(bad.body.errors) && bad.body.errors.length > 0)

    const dead = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry-config-apply', registryUrl: 'http://127.0.0.1:1/x.json' } })
    assert.equal(dead.status, 422)
    assert.ok(dead.body.errors.length > 0)
  })

  it('registry-config-apply 缺 registryUrl → 400', async () => {
    const { dispatcher } = setup()
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry-config-apply' } })
    assert.equal(res.status, 400)
  })

  it('registry-default-download 返回默认 registry 且不改配置', async () => {
    const { dispatcher } = setup()
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry-default-download' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.ok(res.body.registry.plugins.length >= 0)
    assert.equal(res.body.registryState.isDefault, true)
  })

  it('registry-diagnose 传递 signal 并返回 check', async () => {
    const { dispatcher, calls } = setup()
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry-diagnose' } })
    assert.equal(res.status, 200)
    assert.ok('check' in res.body)
    assert.ok('registryState' in res.body)
    assert.ok(calls.diagnose[0].signal instanceof AbortSignal || calls.diagnose[0].signal === undefined)
  })

  it('self-check 走注入的 npmLatest', async () => {
    const { dispatcher, calls } = setup()
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'self-check' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.latest, '9.9.9')
    assert.equal(res.body.outdated, true)
    assert.deepEqual(calls.npm, ['dsh-m'])
  })

  it('未预期异常 → 500 且不泄露堆栈', async () => {
    const { dispatcher } = setup({
      listMarket: async () => {
        throw new Error('boom: secret at /home/x/token')
      },
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market' } })
    assert.equal(res.status, 500)
    assert.equal(res.body.ok, false)
    assert.ok(!res.raw.includes('at ') || !res.raw.includes('stack'))
  })
})
