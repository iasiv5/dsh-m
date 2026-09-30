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
import { TransactionError } from '../lib/core/profile-transaction.js'

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

function setup(overrides = {}, controllerInitial = {}) {
  const controller = createRegistryController(controllerInitial)
  const calls = { listMarket: [], listInstalled: [], diagnose: [], npm: [] }
  const dispatcher = createApiDispatcher({
    controller,
    pkg: { name: 'dsh-m', version: '0.0.0-test' },
    // 0.9.0：契约测试默认注入 pass-through 信任检查（守卫委派语义在 host-api-profile.test.mjs 单独覆盖）
    profile: { name: 'web', kind: 'web', dir: '/tmp/profile', source: 'fallback' },
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
          community: {
            enabled: true, status: 'ready', version: '2026.928.1', checkedAt: 't', fetchedAt: 't',
            route: 'jsdelivr', acceptedCount: 2, upstreamCount: 2, displaced: 0,
            skippedDirty: 0, skippedSubpathNoNpm: 0, errors: [], warnings: [],
            categoryLabels: { theme: '主题与外观' },
            categoryLabelsEn: { theme: 'Themes & Appearance' },
          },
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
      // 缺省注入，避免 dispatcher 预热时真实 spawn `dsh --version`（ping 契约测试单独覆盖）
      resolveDshVersion: async () => '0.0.0-dsh-test',
      // 0.9.0：信任检查委派的 pass-through（Desktop 路由/守卫用例经 overrides 覆盖）
      rejectRequest: () => undefined,
      // 缺省 disabled 社区 summary：registry 契约测试不触真实社区网络；社区用例经 overrides 覆盖
      getCommunitySummary: async () => ({
        enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null,
        route: null, acceptedCount: 0, upstreamCount: null, displaced: 0,
        skippedDirty: 0, skippedSubpathNoNpm: 0, errors: [], warnings: [],
      }),
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

  it('trust 委派 pass-through：无 Origin 请求按注入语义放行（Desktop 桥剥 Origin 后可达）', async () => {
    const { dispatcher } = setup()
    assert.equal((await callApi(dispatcher, { headers: { 'content-type': 'application/json' }, body: { method: 'ping' } })).status, 200)
    assert.equal((await callApi(dispatcher, { headers: { 'content-type': 'application/json', host: '127.0.0.1:3080' }, body: { method: 'registry' } })).status, 200)
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'installed' } })).status, 200)
  })

  it('trust 委派 403：不可信 Origin 由宿主检查拒绝，业务零调用', async () => {
    const { dispatcher, calls } = setup({
      rejectRequest: (req) => (String(req.headers.origin || '') === 'http://evil.example' ? 403 : undefined),
    })
    assert.equal((await callApi(dispatcher, { headers: { 'content-type': 'application/json', origin: 'http://evil.example', host: '127.0.0.1:3080' }, body: { method: 'market' } })).status, 403)
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market' } })).status, 200)
    assert.equal(calls.listMarket.length, 1, '被拒请求零业务调用')
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

  it('restart 委派注入的生命周期调度器并传递 serving port', async () => {
    let calledWith = undefined
    const { dispatcher } = setup({
      scheduleRestart: (port) => {
        calledWith = port
        return { pid: 1, helperPid: undefined, via: 'app-exit' }
      },
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'restart' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.via, 'app-exit')
    assert.equal(calledWith, 3080)
  })

  it('registry 返回 plugins + registryState；force 放行同源', async () => {
    const { dispatcher } = setup()
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry', force: true } })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.plugins))
    assert.ok(['ready', 'stale'].includes(res.body.registryState.status), `force 加载状态 ${res.body.registryState.status}`)
  })

  it('market 转发 query/offset/limit/source/sort，忽略客户端 withLatest，limit clamp 1..96（0.7.0 Task 7）', async () => {
    const { dispatcher, calls } = setup()
    const res = await callApi(dispatcher, {
      headers: JSON_HEADERS,
      body: {
        method: 'market', query: '主题', offset: 50, limit: 1000, withLatest: false,
        source: 'community', sort: { field: 'stars', dir: 'asc' },
      },
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.total, 2)
    const opts = calls.listMarket[0]
    assert.equal(opts.namespace, 'host')
    assert.equal(opts.withLatest, true, 'withLatest 固定 true')
    assert.equal(opts.limit, 96, '超 96 clamp 到 96')
    assert.equal(opts.offset, 50)
    assert.equal(opts.query, '主题')
    assert.equal(opts.source, 'community', 'source 透传')
    assert.deepEqual(opts.sort, { field: 'stars', dir: 'asc' }, 'sort 透传')
    // 非法 source/sort → 400
    const badSource = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', source: 'zone' } })
    assert.equal(badSource.status, 400)
    assert.ok(badSource.body.error.includes('非法 source'))
    const badSort = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', sort: { field: 'name' } } })
    assert.equal(badSort.status, 400)
    assert.ok(badSort.body.error.includes('非法 sort'))
  })

  it('market limit 缺省为 24、负数归一（0.7.0 Task 7）', async () => {
    const { dispatcher, calls } = setup()
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market' } })
    assert.equal(calls.listMarket[0].limit, 24)
    assert.equal(calls.listMarket[0].source, 'all', 'source 缺省 all')
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', limit: -5 } })
    assert.equal(calls.listMarket[1].limit, 24)
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

  it('set-community 切换 communityCatalog 并在 registry-config 回显（0.8.0 设置页开关）', async () => {
    const { dispatcher } = setup()
    const off = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'set-community', enabled: false } })
    assert.equal(off.status, 200)
    assert.equal(off.body.applied, true)
    assert.equal(off.body.communityCatalog, false)
    const cfg = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry-config' } })
    assert.equal(cfg.body.communityCatalog, false)
    const on = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'set-community', enabled: true } })
    assert.equal(on.status, 200)
    assert.equal(on.body.communityCatalog, true)
  })

  it('set-community 缺 enabled → 400', async () => {
    const { dispatcher } = setup()
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'set-community' } })
    assert.equal(res.status, 400)
  })

  it('set-community 非布尔 enabled → 400', async () => {
    const { dispatcher } = setup()
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'set-community', enabled: 'yes' } })
    assert.equal(res.status, 400)
  })

  it('self-check 本地版本领先 npm → ahead=true 且 outdated=false（0.8.0 dev 版显示）', async () => {
    const { dispatcher } = setup({
      npmLatest: async () => ({ version: '0.0.0-alpha', integrity: 'sha512-x' }),
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'self-check' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.outdated, false)
    assert.equal(res.body.ahead, true)
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

// ---------- Task 7：self-upgrade 走事务 + 互斥锁收编 ----------

const committedUpgrade = {
  kind: 'install-npm',
  status: 'committed',
  ok: true,
  healActions: [],
  output: 'upgraded',
  snapshotRestoreVerified: false,
  profileConverged: true,
  needsRestart: true,
  pkg: 'dsh-m',
  spec: 'dsh-m@9.9.9',
  version: '9.9.9',
  buildApprovals: [], fallbackAllBuilds: false,
}

describe('host-api：self-upgrade 事务委派（Task 7）', () => {
  it('锁收编：dispatcher 不再接受 onMutation，install 直接委派 market', async () => {
    const { dispatcher } = setup({
      installFromRegistry: async (id, cfg2, opts) => ({
        id, pkg: 'pkg-1', spec: 'pkg-1@1.0.0', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true, output: 'ok',
      }),
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'install', id: 'plug-1' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.pkg, 'pkg-1')
    assert.equal(res.body.ok, true)
  })

  it('M2 收编：selfUpgrade 抛错 → 500 透传（integrity 检查在 market.selfUpgrade 内，⑦ 已测）', async () => {
    const { dispatcher } = setup({
      selfUpgrade: async () => {
        throw new Error('npm metadata 缺少 dist integrity：dsh-m@9.9.9，拒绝升级')
      },
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'self-upgrade' } })
    assert.equal(res.status, 500)
    assert.match(res.body.error, /缺少 dist integrity/)
  })

  it('M2 收编：self-upgrade 委派 market.selfUpgrade（pkg/signal 透传）', async () => {
    const calls = []
    const { dispatcher } = setup({
      selfUpgrade: async (pkgName, currentVersion, cfg, opts) => {
        calls.push({ pkgName, currentVersion, signal: opts?.signal })
        return { pkg: pkgName, version: '9.9.9', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true }
      },
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'self-upgrade' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.version, '9.9.9')
    assert.deepEqual(res.body.buildApprovals, [])
    assert.equal(res.body.fallbackAllBuilds, false)
    assert.equal(res.body.needsRestart, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].pkgName, 'dsh-m')
    assert.ok(calls[0].signal instanceof AbortSignal, 'signal 贯通到 selfUpgrade')
  })

  it('rolled-back → 500 且 message 含「已回滚到安装前状态」（兼容契约端到端）', async () => {
    const rolled = {
      kind: 'install-npm',
      status: 'rolled-back',
      ok: false,
      failure: { code: 'ADD_FAILED', note: '命令失败 (exit 1): boom' },
      healActions: [],
      output: '',
      snapshotRestoreVerified: true,
      profileConverged: true,
    }
    const { dispatcher } = setup({
      selfUpgrade: async () => {
        const err = new Error('安装失败，已回滚到安装前状态（三文件已按快照逐字节还原并重读复验）：boom')
        err.result = rolled
        throw err
      },
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'self-upgrade' } })
    assert.equal(res.status, 500)
    assert.equal(res.body.ok, false)
    assert.match(res.body.error, /已回滚到安装前状态/)
  })
})

// ---------- Task 10：结构化结果 detail 白名单投影 ----------

describe('host-api：TransactionError → detail 白名单投影（Task 10）', () => {
  it('rolled-back（LOCK_INTEGRITY_MISMATCH）→ 500 + detail.failure.code + 无 raw output + legacy 文案', async () => {
    const rolled = {
      kind: 'install-npm',
      status: 'rolled-back',
      ok: false,
      failure: { code: 'LOCK_INTEGRITY_MISMATCH', note: 'integrity 不一致：pkg-a@1.2.3 期望 X，lockfile 实际 Y' },
      healActions: [{ code: 'ROLLBACK_BYTES_RESTORED', note: '三文件已按快照逐字节还原并重读复验' }],
      output: 'raw pnpm output that must not leak',
      snapshotRestoreVerified: true,
      profileConverged: true,
    }
    const { dispatcher } = setup({
      installFromRegistry: async () => {
        throw new TransactionError(rolled)
      },
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'install', id: 'plug-1' } })
    assert.equal(res.status, 500)
    assert.equal(res.body.ok, false)
    assert.equal(res.body.detail.status, 'rolled-back')
    assert.equal(res.body.detail.kind, 'install-npm')
    assert.equal(res.body.detail.failure.code, 'LOCK_INTEGRITY_MISMATCH')
    assert.equal(res.body.detail.snapshotRestoreVerified, true)
    assert.equal(res.body.detail.profileConverged, true)
    assert.equal(Array.isArray(res.body.detail.healActions), true)
    assert.equal(res.body.detail.output, undefined, 'detail 不含 raw output')
    assert.equal('output' in res.body.detail, false)
    assert.match(res.body.error, /已回滚到安装前状态/)
    assert.ok(!res.raw.includes('raw pnpm output'), '原始 runner 输出不外泄')
  })
})

describe('host-api：ping.dshVersion（市场头部 chip 数据源）', () => {
  it('注入 resolver → ping 携带 dshVersion', async () => {
    const { dispatcher } = setup({ resolveDshVersion: async () => '0.1.5-rc.2' })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'ping' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.dshVersion, '0.1.5-rc.2')
    assert.equal(res.body.plugin, 'dsh-m')
    assert.equal(typeof res.body.boot, 'string')
  })

  it('resolver 返回 null → dshVersion 字段整个缺席（undefined 不序列化）', async () => {
    const { dispatcher } = setup({ resolveDshVersion: async () => null })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'ping' } })
    assert.equal(res.status, 200)
    assert.equal('dshVersion' in res.body, false)
  })
})

describe('host-api：0.4.0 set-enabled / forceIncompatible（Task 14）', () => {
  const TOGGLE_LIVE = { pkg: 'demo-pkg', enabled: false, applied: 'live', via: 'delegate', warnings: [] }
  const TOGGLE_RESTART = { pkg: 'demo-pkg', enabled: false, applied: 'restart-required', via: 'fallback', warnings: [] }

  function setupToggle({ toggleImpl, installImpl } = {}) {
    const controller = createRegistryController({})
    const seen = { toggle: [], install: null }
    const dispatcher = createApiDispatcher({
      controller,
      pkg: { name: 'dsh-m', version: '0.0.0-test' },
      // 0.9.0：pass-through 信任检查 + web profile（能力表委派语义在 host-api-profile.test.mjs）
      profile: { name: 'web', kind: 'web', dir: '/tmp/profile', source: 'fallback' },
      deps: {
        rejectRequest: () => undefined,
        togglePlugin: async (pkg, enabled, deps) => {
          seen.toggle.push({ pkg, enabled, hasService: typeof deps?.getService === 'function' })
          return toggleImpl(pkg, enabled)
        },
        installFromRegistry: installImpl ?? (async () => {
          throw new Error('不应触达')
        }),
        getService: () => undefined, // 生产由 host.ts 注入 ctx.get('pluginManager')
      },
    })
    return { dispatcher, seen }
  }

  it('set-enabled：live 生效透传 ToggleResult', async () => {
    const { dispatcher, seen } = setupToggle({ toggleImpl: async () => TOGGLE_LIVE })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'set-enabled', pkg: 'demo-pkg', enabled: false } })
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.deepEqual(res.body, { ok: true, ...TOGGLE_LIVE })
    assert.deepEqual(seen.toggle, [{ pkg: 'demo-pkg', enabled: false, hasService: true }])
  })

  it('set-enabled：restart-required 透传（fallback 降级形态）', async () => {
    const { dispatcher } = setupToggle({ toggleImpl: async () => TOGGLE_RESTART })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'set-enabled', pkg: 'demo-pkg', enabled: false } })
    assert.equal(res.status, 200)
    assert.equal(res.body.applied, 'restart-required')
    assert.equal(res.body.via, 'fallback')
  })

  it('set-enabled：protected → 403 + code；not-installed → 404', async () => {
    const { ToggleError } = await import('../lib/core/toggle.js')
    const { dispatcher } = setupToggle({
      toggleImpl: async () => { throw new ToggleError('protected', '受保护插件不可开关: dsh-m') },
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'set-enabled', pkg: 'dsh-m', enabled: false } })
    assert.equal(res.status, 403)
    assert.equal(res.body.code, 'protected')

    const { dispatcher: d2 } = setupToggle({
      toggleImpl: async () => { throw new ToggleError('not-installed', 'web profile 未安装该插件: ghost') },
    })
    const res2 = await callApi(d2, { headers: JSON_HEADERS, body: { method: 'set-enabled', pkg: 'ghost', enabled: true } })
    assert.equal(res2.status, 404)
    assert.equal(res2.body.code, 'not-installed')
  })

  it('set-enabled：缺参/类型错 → 400', async () => {
    const { dispatcher } = setupToggle({ toggleImpl: async () => TOGGLE_LIVE })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'set-enabled', pkg: 'x' } })
    assert.equal(res.status, 400)
    const res2 = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'set-enabled', pkg: 'x', enabled: 'yes' } })
    assert.equal(res2.status, 400)
  })

  it('install：forceIncompatible 透传到 market opts', async () => {
    const seenInstall = {}
    const { dispatcher } = setupToggle({
      toggleImpl: async () => TOGGLE_LIVE,
      installImpl: async (id, cfg, opts) => {
        Object.assign(seenInstall, opts)
        return {
          id, pkg: 'pkg-1', spec: 'pkg-1@1.0.0', version: '1.0.0',
          buildApprovals: [], fallbackAllBuilds: false, needsRestart: true, output: 'ok',
        }
      },
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'install', id: 'p', forceIncompatible: true } })
    assert.equal(res.status, 200)
    assert.equal(seenInstall.forceIncompatible, true)
  })

  it('install：IncompatibleError → 409 + 结构化 issue（GUI 弹确认用）', async () => {
    const { IncompatibleError } = await import('../lib/core/compat-check.js')
    const issue = { pkg: 'pkg-1', version: '1.0.0', runtimeVersion: '0.1.7-rc.2', peers: { '@deepseek-ai/dsh': '<=0.1.6' } }
    const { dispatcher } = setupToggle({
      toggleImpl: async () => TOGGLE_LIVE,
      installImpl: async () => { throw new IncompatibleError(issue) },
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'install', id: 'p' } })
    assert.equal(res.status, 409)
    assert.deepEqual(res.body.issue, issue)
  })
})

// ---------- M1 Task 6：market 请求解析 / registry 社区 summary / registry-config 两键 ----------

function readySummary(overrides = {}) {
  return {
    enabled: true, status: 'ready', version: '2026.928.1', checkedAt: '2026-09-28T00:00:00.000Z',
    fetchedAt: '2026-09-28T00:00:00.000Z', route: 'jsdelivr', acceptedCount: 4189, upstreamCount: 4377,
    displaced: 3, skippedDirty: 0, skippedSubpathNoNpm: 188, errors: [], warnings: [],
    ...overrides,
  }
}

describe('M1 Task 6：host-api 社区契约', () => {
  it('④ market 请求：精选分类与社区 slug 透传、非法 slug → 400、primaryOnly 已由 source 取代（0.7.0 Task 7）', async () => {
    const { dispatcher, calls } = setup()
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', category: 'my-slug' } })
    assert.equal(calls.listMarket[0].category, 'my-slug', '社区开放 slug 透传')
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', category: 'tools' } })
    assert.equal(calls.listMarket[1].category, 'tools', '精选分类照旧')
    const bad = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', category: 'UI!!' } })
    assert.equal(bad.status, 400)
    assert.ok(bad.body.error.includes('非法分类'))
    const long = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', category: 'a'.repeat(33) } })
    assert.equal(long.status, 400, '超 32 字符 slug 拒绝')
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', source: 'primary' } })
    assert.equal(calls.listMarket.at(-1).source, 'primary')
    assert.equal(calls.listMarket.at(-1).primaryOnly, undefined, 'primaryOnly 字段已删除，不再下传 core')
    const legacy = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', primaryOnly: true } })
    assert.equal(legacy.status, 400, 'primaryOnly 显式 400（审计 #8：显式拒绝而非静默忽略）')
    assert.ok(legacy.body.error.includes('primaryOnly'))
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market' } })
    assert.equal(calls.listMarket.at(-1).source, 'all', '缺省 all')
  })

  it('⑤ registry-config 响应携带社区两键（回显数据源）', async () => {
    const { dispatcher } = setup({}, { communityCatalog: false, communityCatalogPin: '2026.928.1' })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry-config' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.communityCatalog, false)
    assert.equal(res.body.communityCatalogPin, '2026.928.1')
  })

  it('⑥ market 与 registry 响应均含 community；categoryLabels 透传冒烟（0.7.0 Task 4）', async () => {
    const { dispatcher } = setup()
    const market = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market' } })
    assert.equal(market.status, 200)
    assert.equal(market.body.community.status, 'ready')
    assert.equal(market.body.community.categoryLabels?.theme, '主题与外观')
    assert.equal(market.body.community.categoryLabelsEn?.theme, 'Themes & Appearance')
    assert.equal(market.body.community.acceptedCount, 2)

    const primaryLens = []
    const { dispatcher: d2 } = setup({
      getCommunitySummary: async (primaryEntries) => {
        primaryLens.push(primaryEntries.length)
        return readySummary()
      },
    })
    const reg = await callApi(d2, { headers: JSON_HEADERS, body: { method: 'registry' } })
    assert.equal(reg.status, 200)
    assert.equal(reg.body.community.status, 'ready')
    assert.equal(reg.body.community.acceptedCount, 4189)
    assert.equal(reg.body.community.skippedSubpathNoNpm, 188)
    assert.ok(primaryLens[0] >= 0 && primaryLens[0] === reg.body.plugins.length, 'primaryEntries 与本次 snapshot 同代')
  })

  it('⑥b registry 数据源 cache-first：两次调用 primaryEntries 为同一 snapshot 引用（不重拉主清单）', async () => {
    const refs = []
    const { dispatcher } = setup({
      getCommunitySummary: async (primaryEntries) => {
        refs.push(primaryEntries)
        return readySummary()
      },
    })
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry' } })
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'registry' } })
    assert.equal(refs.length, 2)
    assert.ok(refs[0] === refs[1], '两次 registry 快照未变 → 同一 plugins 数组引用（单一来源约束）')
  })
})
