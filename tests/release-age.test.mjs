/**
 * release-age 纯函数——策略解析（explicit/strict）、排除条目覆盖判定（首条规则口径）、
 * 违规解析、失败文案、委派前预检（ADR-0009 收敛语义）。
 * 实证基准：2026-10-03 本机 desktop profile 的 pnpm 11.7 行为与真实策略文件/诊断原文。
 * 运行：npm run build && node --test tests/release-age.test.mjs
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_MINIMUM_RELEASE_AGE_MIN,
  _resetReleaseAgeCachesForTests,
  describeReleaseAgeFailure,
  excludeMatch,
  parseViolations,
  parseWorkspacePolicy,
  releaseAgePrecheck,
} from '../lib/core/release-age.js'

describe('npmPackumentTimes 权威链（L3，ADR-0012）', () => {
  it('npmjs 首腿失败 → 生效镜像源二次成功；首腿超时收紧 ≤5s', async () => {
    const { npmPackumentTimes } = await import('../lib/core/release-age.js')
    process.env.DSHM_NPM_REGISTRY = 'https://registry.npmmirror.com'
    try {
      const calls = []
      const fetcher = async (url, opts) => {
        calls.push({ url: String(url), ms: opts?.timeoutMs })
        if (String(url).startsWith('https://registry.npmjs.org/')) throw new Error('npmjs down')
        return { time: { '1.0.0': '2026-10-04T00:00:00.000Z' } }
      }
      const times = await npmPackumentTimes('pkg-a', 20_000, undefined, { fetchJsonLimited: fetcher })
      assert.equal(times['1.0.0'], '2026-10-04T00:00:00.000Z')
      assert.equal(calls.length, 2)
      assert.ok(calls[0].url.startsWith('https://registry.npmjs.org/'))
      assert.ok(calls[0].ms <= 5000, `权威首腿收紧 5s，实际 ${calls[0].ms}`)
      assert.ok(calls[1].url.startsWith('https://registry.npmmirror.com/'))
    } finally {
      delete process.env.DSHM_NPM_REGISTRY
      const { _resetReleaseAgeCachesForTests } = await import('../lib/core/release-age.js')
      _resetReleaseAgeCachesForTests()
    }
  })

  it('两腿全败 → null 不抛（fail-open 口径不变）', async () => {
    const { npmPackumentTimes } = await import('../lib/core/release-age.js')
    process.env.DSHM_NPM_REGISTRY = 'https://registry.npmmirror.com'
    try {
      const fetcher = async () => {
        throw new Error('all down')
      }
      assert.equal(await npmPackumentTimes('pkg-a', 20_000, undefined, { fetchJsonLimited: fetcher }), null)
    } finally {
      delete process.env.DSHM_NPM_REGISTRY
    }
  })

  it('clearPackumentCache 清空进程内缓存（cachedPackumentTimes 再次拉取）', async () => {
    const { cachedPackumentTimes, clearPackumentCache } = await import('../lib/core/release-age.js')
    let calls = 0
    const fetcher = async () => {
      calls++
      return { time: { '1.0.0': '2026-10-04T00:00:00.000Z' } }
    }
    await cachedPackumentTimes('pkg-c', 12_000, undefined, { fetchJsonLimited: fetcher })
    await cachedPackumentTimes('pkg-c', 12_000, undefined, { fetchJsonLimited: fetcher })
    assert.equal(calls, 1, 'TTL 内命中缓存')
    clearPackumentCache()
    await cachedPackumentTimes('pkg-c', 12_000, undefined, { fetchJsonLimited: fetcher })
    assert.equal(calls, 2, '清缓存后重新拉取')
  })
})

// 本机 desktop profile 的真实策略文件形态（2026-10-03 00:15 快照，无敏感值）
const REAL_WORKSPACE_YAML = [
  'packages:',
  '  - .',
  '',
  'nodeLinker: hoisted',
  'autoInstallPeers: false',
  'minimumReleaseAgeExclude:',
  '  - dsh-m@0.9.0 || 0.9.1 || 0.9.3 || 0.9.4 || 0.9.5 || 0.9.8 || 0.9.10 || 0.9.12 || 0.9.13 || 0.9.14 || 0.9.16 || 0.9.17 || 0.9.15',
  '  - dshmarket',
  "  - '@iasiv5/dsh-quota-watch@0.1.13'",
  '  - dsh-m@0.9.18',
  '',
].join('\n')

// 本机 0:15 失败操作的 pnpm.log 诊断原文（operation-l5fXEd，逐字）
const REAL_DIAGNOSTIC = [
  '? Verifying lockfile against supply-chain policies (180 entries)...',
  'Progress: resolved 1, reused 0, downloaded 0, added 0',
  '[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.',
  '',
  '✗ Lockfile failed supply-chain policy check (180 entries in 1.7s)',
  'Packages: +1 -2',
  '+--',
  '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:',
  '  dsh-m@0.9.18 was published at 2026-10-02T15:51:25.988Z, within the minimumReleaseAge cutoff (2026-10-01T16:15:35.858Z)',
  '',
].join('\n')

describe('parseWorkspacePolicy', () => {
  it('本机真实形态：读出 4 条 exclude；minimumReleaseAge 未配置 → explicitAge=false、min=null（调用方用默认 1440 兜底）', () => {
    const p = parseWorkspacePolicy(REAL_WORKSPACE_YAML)
    assert.equal(p.explicitAge, false)
    assert.equal(p.minimumReleaseAgeMin, null)
    assert.equal(p.strict, false)
    assert.equal(p.excludes.length, 4)
    assert.deepEqual(p.excludes[3], 'dsh-m@0.9.18')
  })
  it('显式 minimumReleaseAge（分钟）→ explicitAge=true；minimumReleaseAgeStrict: true → strict', () => {
    const p = parseWorkspacePolicy('minimumReleaseAge: 60\nminimumReleaseAgeStrict: true\nminimumReleaseAgeExclude:\n  - a@1.0.0\n')
    assert.equal(p.explicitAge, true)
    assert.equal(p.minimumReleaseAgeMin, 60)
    assert.equal(p.strict, true)
    assert.equal(parseWorkspacePolicy('minimumReleaseAgeStrict: false\n').strict, false)
  })
  it('坏 YAML / 结构不符 → 空策略（不抛）', () => {
    assert.deepEqual(parseWorkspacePolicy('::: [not yaml'), { explicitAge: false, minimumReleaseAgeMin: null, strict: false, excludes: [] })
    assert.deepEqual(parseWorkspacePolicy('- just\n- a\n- list\n'), { explicitAge: false, minimumReleaseAgeMin: null, strict: false, excludes: [] })
  })
})

describe('excludeMatch（首条规则生效口径，ADR-0009）', () => {
  it('包名级 / `||` 复合（含裸版本段）命中 → effective', () => {
    assert.equal(excludeMatch('dshmarket', 'dshmarket', '1.66.8'), 'effective')
    assert.equal(excludeMatch('dsh-m@0.9.0 || 0.9.1 || 0.9.18', 'dsh-m', '0.9.18'), 'effective')
    assert.equal(excludeMatch('dsh-m@0.9.0 || 0.9.1 || 0.9.15', 'dsh-m', '0.9.18'), 'no')
  })
  it('独立精确条目命中 → effective（scoped 与非 scoped 同口径）；版本不等 / 他包 → no', () => {
    assert.equal(excludeMatch('@scope/pkg@1.2.3', '@scope/pkg', '1.2.3'), 'effective')
    assert.equal(excludeMatch('pkg-a@1.2.3', 'pkg-a', '1.2.3'), 'effective')
    assert.equal(excludeMatch('@scope/pkg@1.2.3', '@scope/pkg', '1.2.4'), 'no')
    assert.equal(excludeMatch('other-pkg@1.0.0', 'dsh-m', '0.9.18'), 'no')
  })
})

describe('parseViolations / describeReleaseAgeFailure（0:15 quota-watch 事件原样诊断）', () => {
  const NOW = Date.parse('2026-10-02T16:15:38.000Z')

  it('解析违规条目与满期时刻（publishedAt + (now − cutoff)）', () => {
    const vs = parseViolations(REAL_DIAGNOSTIC, NOW)
    assert.equal(vs.length, 1)
    assert.equal(vs[0].entry, 'dsh-m@0.9.18')
    assert.equal(vs[0].pkg, 'dsh-m')
    assert.equal(vs[0].version, '0.9.18')
    const publishedAt = Date.parse('2026-10-02T15:51:25.988Z')
    const cutoff = Date.parse('2026-10-01T16:15:35.858Z')
    assert.equal(vs[0].deadline, publishedAt + (NOW - cutoff))
  })
  it('目标不在违规名单（旁包连坐）→ 文案分述目标与旁包，不再冒充、不再给 DSH Web 失配指引', () => {
    const view = describeReleaseAgeFailure({ pkg: '@iasiv5/dsh-quota-watch', version: '0.1.15', diagnostic: REAL_DIAGNOSTIC, nowMs: NOW })
    assert.equal(view.targetViolating, false)
    assert.ok(view.message.includes('@iasiv5/dsh-quota-watch@0.1.15'), '应点名本次目标')
    assert.ok(view.message.includes('不在违规名单'), '应说明目标是连坐而非被拦')
    assert.ok(view.message.includes('dsh-m@0.9.18'), '应点名真正的违规条目')
    assert.ok(view.message.includes('可重试'))
    assert.ok(!view.message.includes('ERR_PNPM'))
    assert.ok(!view.message.includes('DSH Web'))
  })
  it('目标在违规名单 → 首行分述目标自身', () => {
    const view = describeReleaseAgeFailure({ pkg: 'dsh-m', version: '0.9.18', diagnostic: REAL_DIAGNOSTIC, nowMs: NOW })
    assert.equal(view.targetViolating, true)
    assert.ok(view.message.includes('本次目标 dsh-m@0.9.18'))
    assert.equal(view.violations.length, 1)
  })
  it('解析不出违规 → 保守 fallback 文案（不抛）', () => {
    const view = describeReleaseAgeFailure({ pkg: 'pkg-a', version: '1.0.0', diagnostic: 'some unrelated error', nowMs: NOW })
    assert.equal(view.violations.length, 0)
    assert.equal(view.targetViolating, false)
    assert.ok(view.message.includes('minimumReleaseAge'))
    assert.ok(view.message.includes('稍后再点升级'))
  })
})

describe('releaseAgePrecheck（委派前预检，ADR-0009 收敛语义）', () => {
  const MIN = 60_000
  const isoAgo = (ms) => new Date(Date.now() - ms).toISOString()
  /** 默认策略桩：未显式设置 age、未开 strict（本机现状） */
  const defaultPolicy = () => ({ explicitAge: false, minimumReleaseAgeMin: null, strict: false, excludes: [] })
  const explicitPolicy = (min) => ({ explicitAge: true, minimumReleaseAgeMin: min, strict: false, excludes: [] })

  beforeEach(_resetReleaseAgeCachesForTests)

  it('默认策略 + young + 无覆盖 → 放行 + notice 陈述（含「等待期内」「登记」）', async () => {
    const r = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
        workspacePolicy: defaultPolicy,
      },
    })
    assert.equal(r.blocked, false)
    assert.ok(r.notice && r.notice.includes('等待期内'), 'notice 应说明处于等待期')
    assert.ok(r.notice && r.notice.includes('登记'), 'notice 应说明将登记豁免')
    assert.ok(r.notice && r.notice.includes('pkg-a@1.2.3'))
  })

  it('显式设置 age + young → blocked（role=target），文案含目标与可重试时刻', async () => {
    const r = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
        workspacePolicy: () => explicitPolicy(1440),
      },
    })
    assert.equal(r.blocked, true)
    if (!r.blocked) return
    assert.equal(r.blockers[0].role, 'target')
    assert.ok(r.message.includes('pkg-a@1.2.3'))
    assert.ok(r.message.includes('未触碰 profile 文件'))
    assert.ok(r.message.includes('可重试'))
  })

  it('strict 开启（默认窗口）+ young → blocked', async () => {
    const r = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
        workspacePolicy: () => ({ explicitAge: false, minimumReleaseAgeMin: null, strict: true, excludes: [] }),
      },
    })
    assert.equal(r.blocked, true)
  })

  it('目标已满期 → 放行且无 notice', async () => {
    const r = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(25 * 60 * MIN) }),
        workspacePolicy: defaultPolicy,
      },
    })
    assert.equal(r.blocked, false)
    assert.equal(r.notice, undefined)
  })

  it('命中任一排除规则（含非 scoped 独立精确，首条规则口径）→ 放行', async () => {
    const scoped = await releaseAgePrecheck({
      pkg: '@scope/pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(5 * MIN) }),
        workspacePolicy: () => ({ ...explicitPolicy(1440), excludes: ['@scope/pkg-a@1.2.3'] }),
      },
    })
    assert.equal(scoped.blocked, false)
    const unscoped = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(5 * MIN) }),
        workspacePolicy: () => ({ ...explicitPolicy(1440), excludes: ['pkg-a@1.2.3'] }),
      },
    })
    assert.equal(unscoped.blocked, false)
  })

  it('fail-open：profileDir 缺席 / 发布时刻不可得 / 复合条目覆盖 → 一律放行', async () => {
    const noDir = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(MIN) }),
        workspacePolicy: () => explicitPolicy(1440),
      },
    })
    assert.equal(noDir.blocked, false)
    const noTimes = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => null,
        workspacePolicy: () => explicitPolicy(1440),
      },
    })
    assert.equal(noTimes.blocked, false)
    const compound = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(MIN) }),
        workspacePolicy: () => ({ ...explicitPolicy(1440), excludes: ['pkg-a@1.0.0 || 1.2.3'] }),
      },
    })
    assert.equal(compound.blocked, false)
  })

  it('显式窗口值生效：60min 窗口下 30min 龄拦、90min 龄放', async () => {
    const block = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(30 * MIN) }),
        workspacePolicy: () => explicitPolicy(60),
      },
    })
    assert.equal(block.blocked, true)
    const pass = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(90 * MIN) }),
        workspacePolicy: () => explicitPolicy(60),
      },
    })
    assert.equal(pass.blocked, false)
  })
})
