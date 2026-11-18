/**
 * packument 访问器（ADR-0019）单测：取数双面（strict 抛终末错误 / lenient 得 null）、
 * 视图派生、缓存语义（TTL / 负缓存 / single-flight / cap / route-switch 作废）、
 * warm 生效源单腿 bypass + 回填、packumentDocViewsActive 专测、readme 阶梯三态（URL host 锚）、
 * 搬迁函数回归。全部注入 fetch stub 零真网络；路由用 DSHM_NPM_REGISTRY env override
 * （decideNpmRoute 第 1 优先级：直采不探测不落盘）+ resetNpmRouteForTests 控制。
 * 运行：npm run build --silent && node --test tests/packument.test.mjs
 */
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import {
  fetchDocThrowing,
  fetchPackumentDoc,
  packumentViews,
  packumentTimes,
  packumentDocViews,
  packumentDocViewsActive,
  warmPackumentFor,
  clearPackumentAccessorCache,
  npmPackumentReadme,
  npmLatest,
  npmPackument,
  npmVersion,
  npmTarballUrl,
} from '../lib/core/packument.js'
import { resetNpmRouteForTests } from '../lib/core/npm-route.js'

const NPMJS = 'https://registry.npmjs.org'
const MIRROR = 'https://registry.npmmirror.com'

const doc = (over = {}) => ({
  time: { '1.0.0': '2026-01-01T00:00:00Z', '1.1.0': '2026-02-01T00:00:00Z', created: '2026-01-01T00:00:00Z', bad: 123 },
  versions: { '1.0.0': {}, '1.1.0': {} },
  'dist-tags': { latest: '1.1.0' },
  readme: 'hello readme',
  repository: { type: 'git', url: 'git+https://github.com/foo/bar.git' },
  ...over,
})

/** 按 host 路由的 fetch stub：routes[host] = 结果对象 | {throw:msg} | fn(url)。 */
function stubWire(routes) {
  const calls = { npmjs: 0, mirror: 0, other: 0 }
  const log = []
  const optsLog = []
  const fn = async (url, opts) => {
    const host = url.startsWith(NPMJS) ? 'npmjs' : url.startsWith(MIRROR) ? 'mirror' : 'other'
    calls[host] += 1
    log.push(url)
    optsLog.push({ url, timeoutMs: opts?.timeoutMs })
    const route = routes[host]
    if (typeof route === 'function') return route(url)
    if (route && route.throw) throw new Error(route.throw)
    return route ?? null
  }
  return { fn, calls, log, optsLog }
}

const setRoute = (base) => {
  process.env.DSHM_NPM_REGISTRY = base
  resetNpmRouteForTests()
}

before(() => setRoute(NPMJS))
after(() => {
  delete process.env.DSHM_NPM_REGISTRY
  resetNpmRouteForTests()
  clearPackumentAccessorCache()
})
beforeEach(() => clearPackumentAccessorCache())

describe('取数双面：两腿阶梯（npmjs 首腿 5s 收紧 → 生效源备腿）', () => {
  it('首腿成功直达不付备腿；首腿失败降备腿；strict 全败抛终末腿原始错误 / lenient 得 null', async () => {
    setRoute(MIRROR)
    const w1 = stubWire({ npmjs: doc(), mirror: { throw: 'mirror down' } })
    const d1 = await fetchDocThrowing('p1', 12_000, undefined, { fetchJsonLimited: w1.fn })
    assert.ok(d1 && d1.time, '首腿成功返回 doc')
    assert.equal(w1.calls.npmjs, 1)
    assert.equal(w1.calls.mirror, 0, '首腿成功不付备腿')

    const w2 = stubWire({ npmjs: { throw: 'npmjs timeout' }, mirror: doc() })
    const d2 = await fetchDocThrowing('p1', 12_000, undefined, { fetchJsonLimited: w2.fn })
    assert.ok(d2 && d2.time, '备腿命中')
    assert.equal(w2.calls.mirror, 1)
    assert.deepEqual(
      w2.optsLog.filter((e) => e.url.startsWith(NPMJS)).map((e) => e.timeoutMs),
      [5000],
      '首腿超时收紧 min(timeoutMs, 5s)（评审 R1-3）',
    )
    assert.deepEqual(
      w2.optsLog.filter((e) => e.url.startsWith(MIRROR)).map((e) => e.timeoutMs),
      [12_000],
      '备腿满额超时（评审 R1-3）',
    )

    const w3 = stubWire({ npmjs: { throw: 'npmjs timeout' }, mirror: { throw: '终末腿错误' } })
    await assert.rejects(() => fetchDocThrowing('p1', 12_000, undefined, { fetchJsonLimited: w3.fn }), /终末腿错误/)
    assert.equal(await fetchPackumentDoc('p1', 12_000, undefined, { fetchJsonLimited: w3.fn }), null, 'lenient 全败 null')
  })
  it('生效源即 npmjs 时首腿失败直接抛首腿错误（无同源备腿）', async () => {
    setRoute(NPMJS)
    const w = stubWire({ npmjs: { throw: 'npmjs 首腿失败' } })
    await assert.rejects(() => fetchDocThrowing('p2', 12_000, undefined, { fetchJsonLimited: w.fn }), /npmjs 首腿失败/)
  })
})

describe('视图派生（packumentViews）', () => {
  it('times 过滤非字符串值；versions/distTags/readme/repo 归一', () => {
    const v = packumentViews(doc())
    assert.deepEqual(v.times, { '1.0.0': '2026-01-01T00:00:00Z', '1.1.0': '2026-02-01T00:00:00Z', created: '2026-01-01T00:00:00Z' })
    assert.deepEqual(v.versions, ['1.0.0', '1.1.0'])
    assert.deepEqual(v.distTags, { latest: '1.1.0' })
    assert.equal(v.readme, 'hello readme')
    assert.equal(v.repo, 'foo/bar', '.git 剥离 + git+ 前缀归一')
  })
  it('空/畸形 doc 回落默认值', () => {
    const v = packumentViews({})
    assert.deepEqual(v.times, {})
    assert.deepEqual(v.versions, [])
    assert.deepEqual(v.distTags, {})
    assert.equal(v.readme, '')
    assert.equal(v.repo, '')
    assert.equal(packumentViews(doc({ readme: '   ' })).readme, '', '空白 readme 归空串')
  })
})

describe('缓存：single-flight / TTL / cap / 负缓存 / route-switch', () => {
  it('single-flight：并发同键 3 调用只取一次（builds 哨兵）', async () => {
    const w = stubWire({ npmjs: doc() })
    const [a, b, c] = await Promise.all([
      packumentTimes('sf-pkg', 12_000, undefined, { fetchJsonLimited: w.fn }),
      packumentTimes('sf-pkg', 12_000, undefined, { fetchJsonLimited: w.fn }),
      packumentTimes('sf-pkg', 12_000, undefined, { fetchJsonLimited: w.fn }),
    ])
    assert.equal(w.calls.npmjs, 1, 'builds 哨兵：只取一次')
    assert.equal(a['1.0.0'], '2026-01-01T00:00:00Z')
    assert.equal(b['1.0.0'], a['1.0.0'])
    assert.equal(c['1.0.0'], a['1.0.0'])
  })
  it('TTL：命中免取；过期重取', async () => {
    mock.timers.enable({ now: 10_000 })
    try {
      const w = stubWire({ npmjs: doc() })
      await packumentTimes('ttl-pkg', 12_000, undefined, { fetchJsonLimited: w.fn })
      await packumentTimes('ttl-pkg', 12_000, undefined, { fetchJsonLimited: w.fn })
      assert.equal(w.calls.npmjs, 1, 'TTL 内命中免取')
      mock.timers.tick(5 * 60_000 + 1)
      await packumentTimes('ttl-pkg', 12_000, undefined, { fetchJsonLimited: w.fn })
      assert.equal(w.calls.npmjs, 2, '过期重取')
    } finally {
      mock.timers.reset()
    }
  })
  it('cap=4：第 5 键写入淘汰最旧，旧键再访问重取', async () => {
    const w = stubWire({ npmjs: (_url) => doc() })
    for (const p of ['cap1', 'cap2', 'cap3', 'cap4']) await packumentTimes(p, 12_000, undefined, { fetchJsonLimited: w.fn })
    assert.equal(w.calls.npmjs, 4)
    await packumentTimes('cap5', 12_000, undefined, { fetchJsonLimited: w.fn })
    assert.equal(w.calls.npmjs, 5)
    await packumentTimes('cap1', 12_000, undefined, { fetchJsonLimited: w.fn })
    assert.equal(w.calls.npmjs, 6, 'cap1 已被淘汰 → 重取')
    assert.ok(w.log.filter((u) => u.endsWith('/cap1')).length >= 2)
  })
  it('负缓存：取数失败与 regex-invalid 的 null 同按 TTL 入缓存（TTL 内零 fetch）', async () => {
    const w = stubWire({ npmjs: { throw: 'npmjs down' } })
    assert.equal(await packumentTimes('neg-pkg', 12_000, undefined, { fetchJsonLimited: w.fn }), null)
    assert.equal(await packumentTimes('neg-pkg', 12_000, undefined, { fetchJsonLimited: w.fn }), null)
    assert.equal(w.calls.npmjs, 1, '失败结果负缓存，不二次打网')
    const before = w.calls.npmjs
    assert.equal(await packumentTimes('!!!invalid', 12_000, undefined, { fetchJsonLimited: w.fn }), null)
    assert.equal(await packumentTimes('!!!invalid', 12_000, undefined, { fetchJsonLimited: w.fn }), null)
    assert.equal(w.calls.npmjs, before, 'regex-invalid 零网络（确定性 null 亦入缓存）')
  })
  it('route-switch：生效源翻转触发 onRouteSwitch → 缓存作废重取', async () => {
    const w = stubWire({ npmjs: doc(), mirror: doc() })
    await packumentTimes('rs-pkg', 12_000, undefined, { fetchJsonLimited: w.fn })
    assert.equal(w.calls.npmjs, 1)
    setRoute(MIRROR) // reset 后下次 decide → setEffective(mirror) → 监听器清缓存
    await packumentTimes('rs-pkg', 12_000, undefined, { fetchJsonLimited: w.fn })
    assert.equal(w.calls.npmjs, 2, '缓存已被路由作废，重新取数（两腿首腿仍 npmjs）')
  })
})

describe('warm：bypass + 生效源单腿直取 + 回填', () => {
  it('缓存命中下仍真发请求；只打生效源（无 npmjs 首腿）；成功后回填可命中', async () => {
    setRoute(MIRROR)
    const w = stubWire({ npmjs: doc(), mirror: doc({ readme: 'from-mirror' }) })
    await packumentTimes('warm-pkg', 12_000, undefined, { fetchJsonLimited: w.fn })
    assert.equal(w.calls.npmjs, 1)
    assert.equal(w.calls.mirror, 0)
    await warmPackumentFor('warm-pkg', 12_000, undefined, { fetchJsonLimited: w.fn })
    assert.equal(w.calls.mirror, 1, 'warm 真发请求且只打生效源单腿')
    assert.equal(w.calls.npmjs, 1, 'warm 不付 npmjs 首腿（镜像机不白等 5s）')
    const v = await packumentDocViews('warm-pkg', 20_000, undefined, { fetchJsonLimited: w.fn })
    assert.equal(w.calls.mirror, 1, 'warm 已回填：后续读零新请求')
    assert.equal(v.readme, 'from-mirror', '回填内容来自 warm 的 mirror 取数')
  })
  it('abort/失败异常向上传播（R4c：预热失败不静默）', async () => {
    setRoute(MIRROR)
    const w = stubWire({ mirror: { throw: 'AbortError: signal is aborted without reason' } })
    await assert.rejects(() => warmPackumentFor('warm-abort', 12_000, undefined, { fetchJsonLimited: w.fn }), /AbortError/)
  })
})

describe('packumentDocViewsActive：生效源单腿带缓存（readme 兜底腿专用）', () => {
  it('miss 走生效源单腿 strict（无 npmjs 首腿）+ 回填；命中零新请求', async () => {
    setRoute(MIRROR)
    const w = stubWire({ npmjs: doc(), mirror: doc() })
    const v1 = await packumentDocViewsActive('act-pkg', 20_000, undefined, { fetchJsonLimited: w.fn })
    assert.equal(w.calls.mirror, 1)
    assert.equal(w.calls.npmjs, 0, '单腿：不付 npmjs 首腿')
    assert.equal(v1.versions.length, 2)
    await packumentDocViewsActive('act-pkg', 20_000, undefined, { fetchJsonLimited: w.fn })
    assert.equal(w.calls.mirror, 1, '命中零新请求')
  })
  it('负缓存 null 条目仅 lenient 面消费：strict 面视 null 为 miss 重取——成功返回 / 失败抛原始错误', async () => {
    setRoute(MIRROR)
    let mirrorDoc = { throw: 'mirror down' }
    const w = stubWire({
      npmjs: { throw: 'npmjs down' },
      mirror: (_url) => {
        if (mirrorDoc.throw) throw new Error(mirrorDoc.throw)
        return mirrorDoc
      },
    })
    assert.equal(await packumentTimes('neg-strict', 12_000, undefined, { fetchJsonLimited: w.fn }), null)
    assert.equal(w.calls.npmjs, 1, 'lenient 面负缓存已建立')
    mirrorDoc = doc({ readme: 'recovered' })
    const v = await packumentDocViewsActive('neg-strict', 20_000, undefined, { fetchJsonLimited: w.fn })
    assert.equal(v.readme, 'recovered', 'strict 面视 null 为 miss 重取成功')
    mirrorDoc = { throw: '终末腿原始错误' }
    await assert.rejects(() => packumentDocViewsActive('neg-strict2', 20_000, undefined, { fetchJsonLimited: w.fn }), /终末腿原始错误/)
  })
})

describe('readme 阶梯三态（npmPackumentReadme 隐式 registry；URL host 锚治路由盲）', () => {
  it('leg1（/latest 小端点）命中 readme → 短路，零 packument 请求', async () => {
    setRoute(MIRROR)
    const w = stubWire({ npmjs: doc(), mirror: (url) => (url.endsWith('/latest') ? doc({ readme: 'from-latest' }) : doc()) })
    const r = await npmPackumentReadme('rm-short', 20_000, undefined, undefined, { fetchJsonLimited: w.fn })
    assert.equal(r.readme, 'from-latest')
    assert.ok(w.log.every((u) => u.endsWith('/latest')), '短路：只有 /latest 请求')
  })
  it('leg1 无 readme → leg2 packument 兜底（只打生效源，无 npmjs 首腿——G2-2 腿策略）', async () => {
    setRoute(MIRROR)
    const w = stubWire({ npmjs: doc(), mirror: (url) => (url.endsWith('/latest') ? doc({ readme: '' }) : doc()) })
    const r = await npmPackumentReadme('rm-fallback', 20_000, undefined, undefined, { fetchJsonLimited: w.fn })
    assert.equal(r.readme, 'hello readme')
    assert.ok(w.log.some((u) => u.endsWith('/rm-fallback')), 'packument 兜底腿发生')
    assert.ok(w.log.every((u) => !u.startsWith(NPMJS)), 'URL host 锚：全程零 npmjs 请求')
  })
  it('两腿全败 → 抛终末腿原始错误', async () => {
    setRoute(MIRROR)
    const w = stubWire({ mirror: { throw: '阶梯终末失败' } })
    await assert.rejects(() => npmPackumentReadme('rm-both-fail', 20_000, undefined, undefined, { fetchJsonLimited: w.fn }), /阶梯终末失败/)
  })
})

describe('搬迁函数回归（签名形状锚）', () => {
  it('npmLatest / npmPackument / npmVersion（显式 registry 直取）', async () => {
    const w = stubWire({
      other: (url) => {
        if (url.endsWith('/latest')) return { version: '1.2.3', dist: { integrity: 'sha512-x', tarball: 'https://t/x.tgz' } }
        if (url.includes('/x@') || /\/[\d.]+$/.test(url)) return { version: '1.2.3', dist: { integrity: 'sha512-x' }, peerDependencies: { react: '^18' } }
        return doc()
      },
    })
    const latest = await npmLatest('x', 20_000, undefined, 'https://r.example', { fetchJsonLimited: w.fn })
    assert.deepEqual(latest, { version: '1.2.3', integrity: 'sha512-x', tarball: 'https://t/x.tgz' })
    const pack = await npmPackument('x', 20_000, undefined, 'https://r.example', { fetchJsonLimited: w.fn })
    assert.deepEqual(pack, { versions: ['1.0.0', '1.1.0'] })
    const ver = await npmVersion('x', '1.2.3', 20_000, undefined, 'https://r.example', { fetchJsonLimited: w.fn })
    assert.equal(ver.version, '1.2.3')
    assert.deepEqual(ver.peers, { react: '^18' })
  })
  it('npmPackumentReadme 显式 registry 直取（R1-2 搬迁回归：不走缓存）', async () => {
    const w = stubWire({ other: (url) => (url.endsWith('/latest') ? doc({ readme: 'explicit-readme' }) : doc()) })
    const r = await npmPackumentReadme('x', 20_000, undefined, 'https://r.example', { fetchJsonLimited: w.fn })
    assert.equal(r.readme, 'explicit-readme')
    assert.ok(w.log.every((u) => u.startsWith('https://r.example')), '显式 registry 直取')
  })
})

describe('npmTarballUrl（0.10.0 Task 2：D3 自升级通道取精确版本 tarball URL）', () => {
  it('①正常：返回该版本 dist.tarball（薄封装 npmVersion 阶梯）', async () => {
    const w = stubWire({
      other: () => ({ version: '1.2.3', dist: { integrity: 'sha512-x', tarball: 'https://t/x-1.2.3.tgz' } }),
    })
    const url = await npmTarballUrl('x', '1.2.3', 20_000, undefined, 'https://r.example', { fetchJsonLimited: w.fn })
    assert.equal(url, 'https://t/x-1.2.3.tgz')
  })
  it('②响应缺 dist.tarball → 可读错误「<pkg>@<version> packument 缺 dist.tarball」', async () => {
    const w = stubWire({ other: () => ({ version: '1.2.3', dist: { integrity: 'sha512-x' } }) })
    await assert.rejects(
      () => npmTarballUrl('x', '1.2.3', 20_000, undefined, 'https://r.example', { fetchJsonLimited: w.fn }),
      /x@1\.2\.3 packument 缺 dist\.tarball/,
    )
  })
  it('③版本不存在 → 错误上抛（npmVersion 阶梯终末失败原样透传）', async () => {
    const w = stubWire({ other: { throw: '404 version not found' }, npmjs: { throw: '404 version not found' } })
    await assert.rejects(
      () => npmTarballUrl('x', '9.9.9', 20_000, undefined, 'https://r.example', { fetchJsonLimited: w.fn }),
      /404 version not found/,
    )
  })
})

// ---------- ADR-0040：npmLatest in-flight 合并（红驱动 ①⑥⑦ / 负向边界锚 ②③④⑤⑧） ----------

// 评审 P3 防挂死：⑦ 红相会挂死，需真实定时器哨兵——在 mock.timers 接管前捕获原版
const REAL_SET_TIMEOUT = setTimeout

describe('npmLatest in-flight 合并（ADR-0040）', () => {
  /** fn(url, opts) 形态 stub（stubWire 的 route fn 只收 url，:52）。
   *  逐调用 gate：release() 手动放行全部在途 wire（①④⑤）；opts.signal abort 时仅该调用结算
   *  （镜像生产 wire 尊重自身 signal；绿相下 wire 信号 = flight ctrl.signal，只在全离开/cap 时到达）。 */
  function deferredWire() {
    const calls = { npmjs: 0, mirror: 0, other: 0 }
    const state = { aborted: false }
    const resolvers = new Set()
    const fn = async (url, opts) => {
      const host = url.startsWith(NPMJS) ? 'npmjs' : url.startsWith(MIRROR) ? 'mirror' : 'other'
      calls[host] += 1
      const settled = new Promise((resolveGate) => { resolvers.add(resolveGate) })
      const abortLane = opts?.signal
        ? new Promise((_, reject) => {
            if (opts.signal.aborted) {
              state.aborted = true
              reject(new Error('aborted'))
              return
            }
            opts.signal.addEventListener('abort', () => {
              state.aborted = true
              reject(new Error('aborted'))
            }, { once: true })
          })
        : null
      return Promise.race([settled.then(() => ({ version: '9.9.9' })), ...(abortLane ? [abortLane] : [])])
    }
    return { fn, calls, state, release: () => { for (const r of [...resolvers]) r() } }
  }

  it('flight-merge：并发同 pkg 两调用合并为一根 wire（红驱动，ADR-0040）', { timeout: 8_000 }, async () => {
    const wire = deferredWire()
    const p1 = npmLatest('p-flight-merge', 20_000, undefined, undefined, { fetchJsonLimited: wire.fn })
    const p2 = npmLatest('p-flight-merge', 20_000, undefined, undefined, { fetchJsonLimited: wire.fn })
    wire.release()
    const [r1, r2] = await Promise.all([p1, p2])
    assert.equal(r1.version, '9.9.9')
    assert.equal(r2.version, '9.9.9')
    assert.equal(wire.calls.npmjs, 1, '同 pkg 并发应合并为一根 wire')
  })

  it('flight-边界：不同 pkg 不合并（负向锚，现状即绿）', { timeout: 8_000 }, async () => {
    const wire = stubWire({ npmjs: { version: '9.9.9' } })
    const [r1, r2] = await Promise.all([
      npmLatest('p-flight-a', 20_000, undefined, undefined, { fetchJsonLimited: wire.fn }),
      npmLatest('p-flight-b', 20_000, undefined, undefined, { fetchJsonLimited: wire.fn }),
    ])
    assert.equal(r1.version, '9.9.9')
    assert.equal(r2.version, '9.9.9')
    assert.equal(wire.calls.npmjs, 2)
  })

  it('flight-边界：显式不同 registry 不合并（负向锚，现状即绿）', { timeout: 8_000 }, async () => {
    const wire = stubWire({ npmjs: { version: '9.9.9' }, mirror: { version: '8.8.8' } })
    await Promise.all([
      npmLatest('p-flight-reg', 20_000, undefined, NPMJS, { fetchJsonLimited: wire.fn }),
      npmLatest('p-flight-reg', 20_000, undefined, MIRROR, { fetchJsonLimited: wire.fn }),
    ])
    assert.equal(wire.calls.npmjs, 1)
    assert.equal(wire.calls.mirror, 1)
  })

  it('flight-边界：leader abort 不连坐，waiter 仍成功（负向锚，现状即绿）', { timeout: 8_000 }, async () => {
    const wire = deferredWire()
    const ac1 = new AbortController()
    const ac2 = new AbortController()
    const p1 = npmLatest('p-flight-lead-abort', 20_000, ac1.signal, undefined, { fetchJsonLimited: wire.fn })
    const p2 = npmLatest('p-flight-lead-abort', 20_000, ac2.signal, undefined, { fetchJsonLimited: wire.fn })
    ac1.abort()
    await assert.rejects(p1)
    wire.release()
    const r2 = await p2
    assert.equal(r2.version, '9.9.9', 'leader 自身中止不得殃及 waiter')
  })

  it('flight-边界：waiter abort 不连坐，leader 仍成功（负向锚，现状即绿）', { timeout: 8_000 }, async () => {
    const wire = deferredWire()
    const ac1 = new AbortController()
    const ac2 = new AbortController()
    const p1 = npmLatest('p-flight-wait-abort', 20_000, ac1.signal, undefined, { fetchJsonLimited: wire.fn })
    const p2 = npmLatest('p-flight-wait-abort', 20_000, ac2.signal, undefined, { fetchJsonLimited: wire.fn })
    ac2.abort()
    await assert.rejects(p2)
    wire.release()
    const r1 = await p1
    assert.equal(r1.version, '9.9.9', 'waiter 自身中止不得殃及 leader')
  })

  it('flight-全离开：refs 归零中止共享 wire（红驱动）', { timeout: 8_000 }, async () => {
    const wire = deferredWire()
    const ac1 = new AbortController()
    const ac2 = new AbortController()
    const p1 = npmLatest('p-flight-allleft', 20_000, ac1.signal, undefined, { fetchJsonLimited: wire.fn })
    const p2 = npmLatest('p-flight-allleft', 20_000, ac2.signal, undefined, { fetchJsonLimited: wire.fn })
    ac1.abort()
    ac2.abort()
    await Promise.allSettled([p1, p2])
    assert.equal(wire.calls.npmjs, 1, '共享 wire 只应有一根')
    assert.equal(wire.state.aborted, true, '全部等待方离开后共享 wire 应被中止')
  })

  it('flight-cap：30s 硬上限拒绝，不借 wire 生效（红驱动，评审 P3）', { timeout: 8_000 }, async () => {
    const wire = stubWire({ npmjs: () => new Promise(() => {}) })  // 永挂且不感知 signal（故意隔离 cap 通道）
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const p = npmLatest('p-flight-cap', 60_000, undefined, undefined, { fetchJsonLimited: wire.fn })
      mock.timers.tick(31_000)
      const verdict = await Promise.race([
        p.then(() => 'resolved', (e) => String(e?.message ?? e)),
        new Promise((resolve) => REAL_SET_TIMEOUT(resolve, 5_000, 'HANG')),
      ])
      assert.notEqual(verdict, 'HANG', 'cap 快进后未拒绝（挂死防线）')
      assert.match(String(verdict), /30s 硬上限/)
    } finally {
      mock.timers.reset()
    }
  })

  it('flight-边界：settle 清键后同 pkg 重探新 wire（负向锚，现状即绿）', { timeout: 8_000 }, async () => {
    const wire = stubWire({ npmjs: { version: '2.0.0' } })
    await npmLatest('p-flight-resettle', 20_000, undefined, undefined, { fetchJsonLimited: wire.fn })
    await new Promise((resolve) => setImmediate(resolve))
    const before = wire.calls.npmjs
    await npmLatest('p-flight-resettle', 20_000, undefined, undefined, { fetchJsonLimited: wire.fn })
    assert.equal(wire.calls.npmjs, before + 1, 'flight settle 清键后应重新发起 wire')
  })
})
