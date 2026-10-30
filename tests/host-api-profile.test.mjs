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
import { desktopUpgradeFromRegistry } from '../lib/core/profile-ops.js'
import { readUpgradeIntent } from '../lib/core/upgrade-intent.js'

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
  const calls = { listInstalled: [], scheduleRestart: [], upgrade: [], uninstall: [], selfUpgrade: [], desktopInstall: [], desktopToggle: [], desktopUpgrade: [], desktopUninstall: [], desktopSelfUpgrade: [], toggle: [], existingIds: [] }
  const dispatcher = createApiDispatcher({
    controller,
    pkg: { name: 'dsh-m', version: '0.0.0-test' },
    profile: profile ?? { name: 'web', kind: 'web', dir: '/tmp/profile', source: 'fallback' },
    deps: {
      resolveDshVersion: async () => '0.0.0-dsh-test',
      existingMarketIds: async (ids) => {
        calls.existingIds.push(ids)
        return { present: ids.filter((i) => i !== 'gone') }
      },
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
      desktopSelfUpgradeViaTarball: async (pkg, currentVersion, opts) => {
        calls.desktopSelfUpgrade.push({ pkg, currentVersion, opts })
        return { id: pkg, pkg, spec: `https://example.com/${pkg}-9.9.9.tgz`, version: '9.9.9', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true, output: '', via: 'desktop-manager' }
      },
      desktopToggle: async (pkg, enabled, opts) => {
        calls.desktopToggle.push({ pkg, enabled, opts })
        return { pkg, enabled, applied: 'live', via: 'delegate', warnings: [] }
      },
      desktopUpgrade: async (pkg, cfg, opts, deps) => {
        calls.desktopUpgrade.push({ pkg, opts, deps })
        return { id: 'x', pkg, spec: `${pkg}@2.0.0`, version: '2.0.0', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true, output: '', via: 'desktop-manager', fromVersion: '1.0.0' }
      },
      desktopUninstall: async (pkg, deps) => {
        calls.desktopUninstall.push({ pkg, deps })
        return { pkg, liveDisabled: false, needsRestart: true, leftovers: [], via: 'desktop-manager', output: '' }
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
  // 0.9.79：mutation 用例可能落真实实现的外部操作日志——隔离 journal，不触碰真实 ~/.dsh
  process.env.DSHM_EXTERNAL_JOURNAL_FILE = join(cacheRoot, 'external-operations.json')
  // 0.10.0：D3 全链用例走真实 intent ledger——隔离，不触碰真实 ~/.dsh
  process.env.DSHM_UPGRADE_INTENT_FILE = join(cacheRoot, 'self-upgrade-intent.json')
})
afterEach(() => {
  delete process.env.DSHM_CACHE_DIR
  delete process.env.DSHM_EXTERNAL_JOURNAL_FILE
  delete process.env.DSHM_UPGRADE_INTENT_FILE
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

describe('host-api market-ids-exist（0.9.87 FP2：收藏 stale 批量化）', () => {
  it('合法 ids → 200 + present 透传 + 桩收到 trim 后数组', async () => {
    const { dispatcher, calls } = setupTrust({ trust: () => undefined })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market-ids-exist', ids: ['a', 'gone', ' b '] } })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.present, ['a', 'b'])
    assert.deepEqual(calls.existingIds, [['a', 'gone', 'b']], 'trim 后透传，缺席剔除由 core 负责')
  })

  it('malformed ids → 400（非数组 / 含非字符串 / trim 空串）', async () => {
    const { dispatcher, calls } = setupTrust({ trust: () => undefined })
    for (const ids of ['x', ['a', 1], ['a', '  ']]) {
      const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market-ids-exist', ids } })
      assert.equal(res.status, 400, `ids=${JSON.stringify(ids)} 应 400`)
      assert.match(String(res.body?.error), /非法 ids/)
    }
    assert.equal(calls.existingIds.length, 0, '校验失败不得触达 core')
  })
})

describe('host-api profile 能力表路由（Task 8）', () => {
  const desktopProfile = { name: 'desktop', kind: 'desktop', dir: '/d/profiles/desktop', source: 'host' }

  it('desktop：仅 restart → 409 结构化拒绝（0.9.8 唯一保留项；Electron 生命周期归官方壳）', async () => {
    const { dispatcher, calls } = setupTrust({ trust: () => undefined, profile: desktopProfile })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'restart', pkg: 'pkg-x' } })
    assert.equal(res.status, 409)
    assert.equal(res.body.code, 'unsupported-on-profile')
    assert.equal(res.body.action, 'restart')
    assert.equal(res.body.profile, 'desktop')
    assert.ok(String(res.body.guidance).length > 0, '应携带官方入口指引')
    assert.equal(calls.scheduleRestart.length, 0, 'restart helper 不得被触碰')
  })

  // 0.9.8：upgrade/uninstall/self-upgrade 借鉴 dsh-market 全部改委派官方管理器 adapter
  // （本机实证：dshmarket 正是经 installBundle 覆盖安装把 dsh-m 升 0.9.3→0.9.4/0.9.5 的）
  it('desktop：upgrade / uninstall / self-upgrade → 委派 Desktop adapter（携带 profile 目录与名字）', async () => {
    const { dispatcher, calls } = setupTrust({ trust: () => undefined, profile: desktopProfile })
    const up = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'upgrade', pkg: 'pkg-x' } })
    assert.equal(up.status, 200)
    assert.equal(up.body.via, 'desktop-manager')
    assert.equal(up.body.fromVersion, '1.0.0')
    assert.equal(calls.desktopUpgrade.length, 1)
    assert.equal(calls.desktopUpgrade[0].pkg, 'pkg-x')
    assert.equal(calls.desktopUpgrade[0].opts.profileDir, '/d/profiles/desktop')
    assert.equal(calls.upgrade.length, 0, 'web 事务不得被触达')

    const un = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'uninstall', pkg: 'pkg-y' } })
    assert.equal(un.status, 200)
    assert.equal(un.body.via, 'desktop-manager')
    assert.equal(calls.desktopUninstall.length, 1)
    assert.equal(calls.desktopUninstall[0].pkg, 'pkg-y')
    assert.equal(calls.desktopUninstall[0].deps.profileDir, '/d/profiles/desktop')
    assert.equal(calls.uninstall.length, 0, 'web 事务不得被触达')

    const su = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'self-upgrade' } })
    assert.equal(su.status, 200)
    assert.equal(su.body.needsRestart, true, 'needsRestart 透传（R10）')
    assert.equal(su.body.version, '9.9.9')
    assert.equal(calls.desktopSelfUpgrade.length, 1, 'self-upgrade 走 D3 desktopSelfUpgradeViaTarball(dsh-m)')
    assert.equal(calls.desktopSelfUpgrade[0].pkg, 'dsh-m')
    assert.equal(calls.desktopSelfUpgrade[0].currentVersion, '0.0.0-test')
    assert.equal(calls.desktopInstall.length, 0, '不再走 desktopInstall（0.2.1 守卫必拦路径已弃）')
    assert.equal(calls.selfUpgrade.length, 0, 'web 事务不得被触达')
  })

  // 0.10.0 T17 端到端钉（host-api 面）：upgrade(dsh-m) 经真链 desktopUpgradeFromRegistry → core 缝 → D3，
  // host-api 层零特判（改道唯一执行点在 core 缝）。
  it('0.10.0 改道端到端：desktop upgrade(dsh-m) → installBundle 恰一次收 tarball URL、removeBundle 零调用', async () => {
    const wire = { installBundle: [], removeBundle: [] }
    const service = {
      listPlugins: async () => [],
      setPluginEnabled: async () => ({}),
      setBundleEnabled: async () => ({}),
      installBundle: async (spec, options) => {
        wire.installBundle.push({ spec, options })
        return { changed: true, application: 'restart-required', stage: 'install', bundle: 'dsh-m', packageResult: { exitCode: 0 } }
      },
      removeBundle: async (name) => {
        wire.removeBundle.push(name)
        return { changed: true, application: 'applied', stage: 'remove', bundle: name }
      },
      listBundles: async () => [{ name: 'dsh-m', installed: true, enabled: true }],
    }
    const { dispatcher } = setupTrust({
      trust: () => undefined,
      profile: desktopProfile,
      overrides: {
        desktopUpgrade: desktopUpgradeFromRegistry,
        getService: () => service,
        npmLatest: async () => ({ version: '0.10.0' }),
        npmTarballUrl: async () => 'https://example.com/dsh-m-0.10.0.tgz',
        listInstalled: async () => ({ items: [{ pkg: 'dsh-m', name: 'dsh-m', version: '0.9.94' }], others: [], complete: true }),
      },
    })
    const res = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'upgrade', pkg: 'dsh-m' } })
    assert.equal(res.status, 200)
    assert.deepEqual(wire.installBundle.map((c) => c.spec), ['https://example.com/dsh-m-0.10.0.tgz'])
    assert.deepEqual(wire.removeBundle, [], '自升级绝不 remove+add')
    assert.equal(res.body.needsRestart, true)
    assert.equal((await readUpgradeIntent())?.status, 'resolved', 'D3 intent 已被本进程就地收口')
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

  // 0.9.5 双 profile 读路径接线（Windows 实机回归 2026-10-01）：desktop 下 GUI 的 installed /
  // market 漏传 profile → listInstalledPlugins 落回 webProfileDir，已装页恒显
  // 「web profile 尚未安装任何插件」、市场已装徽标恒空（tools 面同链路已接线故 dshm_list 正常）。
  it('desktop：installed / market 读路径消费 active profile（profileDir + profile 名）', async () => {
    const marketOpts = []
    const { dispatcher, calls } = setupTrust({
      trust: () => undefined,
      profile: desktopProfile,
      overrides: {
        listMarket: async (cfg, opts) => {
          marketOpts.push(opts)
          return { items: [], total: 0, offset: 0, limit: 24, categoryCounts: { primary: 0, community: 0 }, registryState: { configuredAddress: '', activeAddress: null, source: 'bundled', status: 'stale', isDefault: true, stale: true, fetchedAt: null, errors: [], count: 0 } }
        },
      },
    })
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'installed' } })).status, 200)
    assert.equal(calls.listInstalled.length, 1)
    assert.equal(calls.listInstalled[0].profileDir, '/d/profiles/desktop', 'installed 必须读 active profile 目录，不得落回 web')
    assert.equal(calls.listInstalled[0].profile, 'desktop', 'registry/社区缓存必须按 profile 分段')
    assert.equal((await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market' } })).status, 200)
    assert.equal(marketOpts.length, 1)
    assert.equal(marketOpts[0].profileDir, '/d/profiles/desktop', 'market 已装徽标必须读 active profile 目录')
    assert.equal(marketOpts[0].profile, 'desktop')
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

// ---------- ADR-0026：升级失败信封 failureClass（缺省 target、systemic 显式白名单，评审 F1） ----------
import { InstallGuardError } from '../lib/core/market-mutation.js'
import { UpgradePathUnsupportedError } from '../lib/core/upgrade-target.js'
import { TransactionError } from '../lib/core/profile-transaction.js'
import { DesktopOpsError } from '../lib/core/profile-ops.js'
import { readFileSync } from 'node:fs'

describe('ADR-0026：upgrade 失败信封 failureClass', () => {
  const guardErr = () => new InstallGuardError({
    kind: 'compensated',
    message: '安装违例，已自动卸载',
    violations: [{ pkg: 'p', code: 'NO_DSH_MARKER', detail: 'd' }],
    needsRestart: true,
    restartSafe: true,
    compensation: { status: 'committed', note: 'compensated:p' },
  })
  const txErr = () => new TransactionError({
    kind: 'install-npm', healActions: [], output: '', status: 'rejected', ok: false,
    failure: { code: 'ABORTED', note: 'aborted' },
    snapshotRestoreVerified: false, profileConverged: false,
  })

  async function upgradeFailure(err) {
    const { dispatcher } = setupTrust({ trust: () => undefined, overrides: { upgradePlugin: async () => { throw err } } })
    return callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'upgrade', pkg: 'p' } })
  }

  it('① 裸网络错（npmLatest ENOTFOUND 类）→ target（B4：单包网络错跳过继续，绝不整批停止）', async () => {
    const r = await upgradeFailure(new Error('getaddrinfo ENOTFOUND registry.npmjs.org'))
    assert.equal(r.body.failureClass, 'target')
  })

  it('② InstallGuardError（装后守卫拦截）→ systemic', async () => {
    const r = await upgradeFailure(guardErr())
    assert.equal(r.body.failureClass, 'systemic')
  })

  it('③ TransactionError（事务半残）→ systemic', async () => {
    const r = await upgradeFailure(txErr())
    assert.equal(r.body.failureClass, 'systemic')
  })

  it('④ DesktopOpsError(release-age-wait) → target（等待期属单包目标级）', async () => {
    const r = await upgradeFailure(new DesktopOpsError('release-age-wait', '目标版本仍在等待期内'))
    assert.equal(r.body.failureClass, 'target')
  })

  it('⑤ DesktopOpsError(no-manager) → systemic（基建回退码白名单）', async () => {
    const r = await upgradeFailure(new DesktopOpsError('no-manager', '官方 pluginManager 服务不可用'))
    assert.equal(r.body.failureClass, 'systemic')
  })

  it('⑥ UpgradePathUnsupportedError（本地链接/非线上来源）→ target（B5 结构化指引）', async () => {
    const r = await upgradeFailure(new UpgradePathUnsupportedError('p', { code: 'local-spec', detail: '本地开发安装（file:../p）不从线上更新' }))
    assert.equal(r.body.failureClass, 'target')
  })

  it('⑦ 源结构锚：hooks.js api() 透传 failureClass（赋值表达式出现次数语义）', async () => {
    const src = readFileSync(new URL('../src/client/hooks.js', import.meta.url), 'utf8')
    assert.equal(src.split('err.failureClass = data.failureClass').length - 1, 1, `hooks.js 透传赋值恰 1 处，实得 ${src.split('err.failureClass = data.failureClass').length - 1}`)
  })
})
