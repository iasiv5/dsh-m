/**
 * 0.9.0 Task 7/8：/dshm 宿主信任检查委派（fail-closed）+ profile 能力表路由 + ping.profile。
 * 运行：npm run build && node --test tests/host-api-profile.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createApiDispatcher } from '../lib/core/host-api.js'
import { createRegistryController } from '../lib/core/registry-controller.js'

const JSON_HEADERS = { 'content-type': 'application/json' }

function mockReq({ method = 'POST', headers = {}, body } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = '/dshm'
  req.headers = { ...headers }
  req.resume = () => {}
  queueMicrotask(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

function mockRes() {
  const res = new EventEmitter()
  res.statusCode = null
  res.bodyText = ''
  res.writeHead = (status) => {
    res.statusCode = status
  }
  res.end = (text) => {
    res.bodyText = text ?? ''
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
    /* raw */
  }
  return { status: res.statusCode, body: parsed }
}

/** 独立 setup：trust/profile/desktop 行为全可编排；业务 deps 为记录型桩。 */
function setupTrust({ trust, profile, overrides = {} } = {}) {
  const controller = createRegistryController({})
  const calls = { listInstalled: [], scheduleRestart: [], upgrade: [], uninstall: [], selfUpgrade: [], desktopInstall: [], desktopToggle: [], toggle: [] }
  const dispatcher = createApiDispatcher({
    controller,
    pkg: { name: 'dsh-m', version: '0.0.0-test' },
    profile: profile ?? { name: 'web', kind: 'web', dir: '/tmp/profile', source: 'fallback' },
    deps: {
      resolveDshVersion: async () => '0.0.0-dsh-test',
      getCommunitySummary: async () => ({
        enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null,
        route: null, acceptedCount: 0, upstreamCount: null, displaced: 0,
        skippedDirty: 0, skippedSubpathNoNpm: 0, errors: [], warnings: [],
      }),
      ...(trust !== undefined ? { rejectRequest: trust } : {}),
      listInstalledWithMeta: async (cfg, opts) => {
        calls.listInstalled.push(opts)
        return { items: [], others: 0, profileDir: '/tmp/profile', registryState: { configuredAddress: '', activeAddress: null, source: 'bundled', status: 'stale', isDefault: true, stale: true, fetchedAt: null, errors: [], count: 0 } }
      },
      upgradePlugin: async (pkg) => {
        calls.upgrade.push(pkg)
        return { id: 'x', pkg, spec: `${pkg}@2.0.0`, version: '2.0.0', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true, output: '' }
      },
      uninstallPlugin: async (pkg) => {
        calls.uninstall.push(pkg)
        return { pkg, liveDisabled: false, needsRestart: true, leftovers: [] }
      },
      selfUpgrade: async () => {
        calls.selfUpgrade.push('dsh-m')
        return { pkg: 'dsh-m', version: '9.9.9', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true }
      },
      scheduleRestart: (port) => {
        calls.scheduleRestart.push(port)
        return { pid: 1, helperPid: undefined, via: 'app-exit' }
      },
      togglePlugin: async (pkg, enabled) => {
        calls.toggle.push([pkg, enabled])
        return { pkg, enabled, applied: 'restart-required', via: 'fallback', warnings: [] }
      },
      desktopInstall: async (id, cfg, opts) => {
        calls.desktopInstall.push({ id, opts })
        return { id, pkg: 'pkg-d', spec: 'pkg-d@1.0.0', version: '1.0.0', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true, output: '', via: 'desktop-manager' }
      },
      desktopToggle: async (pkg, enabled, opts) => {
        calls.desktopToggle.push({ pkg, enabled, opts })
        return { pkg, enabled, applied: 'live', via: 'delegate', warnings: [] }
      },
      ...overrides,
    },
  })
  return { dispatcher, calls }
}

const ALL_METHODS = ['ping', 'self-check', 'registry', 'market', 'installed', 'readme', 'status', 'install', 'uninstall', 'set-enabled', 'upgrade', 'restart', 'registry-config', 'registry-config-apply', 'set-community', 'registry-default-download', 'registry-diagnose', 'self-upgrade', 'no-such-method']

let cacheRoot = ''
beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'dshm-apip-'))
  process.env.DSHM_CACHE_DIR = cacheRoot
})
afterEach(() => {
  delete process.env.DSHM_CACHE_DIR
  if (cacheRoot) rmSync(cacheRoot, { recursive: true, force: true })
})

describe('host-api trust 委派（ADR-0005）', () => {
  it('全 method（含 ping、未知 method）先过 trust：401/403 原样投影，业务零调用', async () => {
    const seen = []
    const { dispatcher, calls } = setupTrust({
      trust: (req) => {
        seen.push(String(req.headers['x-probe'] ?? ''))
        return 401
      },
    })
    for (const method of ALL_METHODS) {
      const res = await callApi(dispatcher, { headers: { ...JSON_HEADERS, 'x-probe': method }, body: { method, pkg: 'x', id: 'x' } })
      assert.equal(res.status, 401, `method=${method} 应 401`)
      assert.equal(res.body?.ok, false)
      assert.match(String(res.body?.error), /认证/)
    }
    assert.equal(seen.length, ALL_METHODS.length)
    assert.equal(calls.listInstalled.length, 0)
    assert.equal(calls.upgrade.length, 0)
    assert.equal(calls.scheduleRestart.length, 0)
  })

  it('trust 先于 POST/Content-Type 检查：GET 与非 JSON 也在被拒时返回宿主状态码', async () => {
    const { dispatcher } = setupTrust({ trust: () => 403 })
    assert.equal((await callApi(dispatcher, { method: 'GET', headers: {}, body: { method: 'ping' } })).status, 403)
    assert.equal((await callApi(dispatcher, { headers: { 'content-type': 'text/plain' }, body: { method: 'ping' } })).status, 403)
    assert.equal((await callApi(dispatcher, { headers: {}, body: undefined })).status, 403)
  })

  it('未注入 trust → fail-closed：一切请求（含 ping）403，业务零调用', async () => {
    const { dispatcher, calls } = setupTrust({})
    for (const method of ['ping', 'market', 'restart', 'no-such']) {
      const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method } })
      assert.equal(res.status, 403, `method=${method} 应 fail-closed 403`)
    }
    assert.equal(calls.listInstalled.length, 0)
    assert.equal(calls.scheduleRestart.length, 0)
  })

  it('trust 抛错 → fail-closed 403（宿主异常不外泄）', async () => {
    const { dispatcher } = setupTrust({ trust: () => { throw new Error('connection service exploded') } })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'ping' } })
    assert.equal(res.status, 403)
    assert.match(String(res.body?.error), /信任检查/)
    assert.doesNotMatch(String(res.body?.error), /exploded/)
  })

  it('Desktop 场景语义：无 Origin 请求被 trust 放行后可达只读 method', async () => {
    const { dispatcher, calls } = setupTrust({ trust: () => undefined })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'installed' } })
    assert.equal(res.status, 200)
    assert.equal(calls.listInstalled.length, 1)
  })
})

describe('host-api ping.profile（GUI chip 数据源）', () => {
  it('ping 携带 profile { name, kind, source }', async () => {
    const { dispatcher } = setupTrust({
      trust: () => undefined,
      profile: { name: 'desktop', kind: 'desktop', dir: '/d/profiles/desktop', source: 'host' },
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'ping' } })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.profile, { name: 'desktop', kind: 'desktop', source: 'host' })
  })
})

describe('host-api profile 能力表路由（Task 8）', () => {
  const desktopProfile = { name: 'desktop', kind: 'desktop', dir: '/d/profiles/desktop', source: 'host' }

  it('desktop：upgrade / uninstall / self-upgrade / restart → 409 结构化拒绝 + 指引，业务零调用', async () => {
    const { dispatcher, calls } = setupTrust({ trust: () => undefined, profile: desktopProfile })
    for (const method of ['upgrade', 'uninstall', 'self-upgrade', 'restart']) {
      const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method, pkg: 'pkg-x' } })
      assert.equal(res.status, 409, `method=${method} 应 409`)
      assert.equal(res.body.code, 'unsupported-on-profile')
      assert.equal(res.body.action, method)
      assert.equal(res.body.profile, 'desktop')
      assert.ok(String(res.body.guidance).length > 0, '应携带官方入口指引')
    }
    assert.equal(calls.upgrade.length, 0)
    assert.equal(calls.uninstall.length, 0)
    assert.equal(calls.selfUpgrade.length, 0)
    assert.equal(calls.scheduleRestart.length, 0, 'restart helper 不得被触碰')
  })

  it('desktop：install 路由到 Desktop adapter（携带 profile 名），不走 web 事务', async () => {
    const { dispatcher, calls } = setupTrust({ trust: () => undefined, profile: desktopProfile })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'install', id: 'plug-d' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.via, 'desktop-manager')
    assert.equal(calls.desktopInstall.length, 1)
    assert.equal(calls.desktopInstall[0].opts.profile, 'desktop')
  })

  it('desktop：set-enabled 路由到 desktopToggle（携带 profileDir）', async () => {
    const { dispatcher, calls } = setupTrust({ trust: () => undefined, profile: desktopProfile })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'set-enabled', pkg: 'pkg-d', enabled: false } })
    assert.equal(res.status, 200)
    assert.equal(res.body.via, 'delegate')
    assert.equal(calls.desktopToggle.length, 1)
    assert.equal(calls.desktopToggle[0].opts.profileDir, '/d/profiles/desktop')
    assert.equal(calls.toggle.length, 0, 'web toggle 不得被触达')
  })

  it('desktop：只读 method 照常可达', async () => {
    const { dispatcher } = setupTrust({ trust: () => undefined, profile: desktopProfile })
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'installed' } })).status, 200)
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'status' } })).status, 200)
  })

  it('unknown profile：install / set-enabled 也拒绝', async () => {
    const { dispatcher, calls } = setupTrust({
      trust: () => undefined,
      profile: { name: 'dev', kind: 'unknown', dir: '/d/profiles/dev', source: 'host' },
    })
    for (const method of ['install', 'set-enabled', 'upgrade', 'restart']) {
      const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method, pkg: 'x', id: 'x', enabled: true } })
      assert.equal(res.status, 409, `method=${method} 应 409`)
    }
    assert.equal(calls.desktopInstall.length, 0)
    assert.equal(calls.desktopToggle.length, 0)
  })

  it('web：行为零漂移（install/upgrade/restart 走既有 deps）', async () => {
    const { dispatcher, calls } = setupTrust({ trust: () => undefined })
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'restart' } })).status, 200)
    assert.equal(calls.scheduleRestart.length, 1)
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'set-enabled', pkg: 'p', enabled: true } })).status, 200)
    assert.equal(calls.toggle.length, 1)
  })
})
