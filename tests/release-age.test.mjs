/**
 * 0.9.19：release-age 纯函数——策略解析、排除条目覆盖判定、违规解析、失败文案、委派前预检。
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
  splitExactSelector,
} from '../lib/core/release-age.js'

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
  it('本机真实形态：读出 4 条 exclude；minimumReleaseAge 未配置 → null（调用方用默认 1440 兜底）', () => {
    const p = parseWorkspacePolicy(REAL_WORKSPACE_YAML)
    assert.equal(p.minimumReleaseAgeMin, null)
    assert.equal(p.excludes.length, 4)
    assert.deepEqual(p.excludes[3], 'dsh-m@0.9.18')
  })
  it('minimumReleaseAge 显式配置（分钟）被读取；缺省常量为 1440', () => {
    assert.equal(parseWorkspacePolicy('minimumReleaseAge: 60\nminimumReleaseAgeExclude:\n  - a@1.0.0\n').minimumReleaseAgeMin, 60)
    assert.equal(DEFAULT_MINIMUM_RELEASE_AGE_MIN, 1440)
  })
  it('坏 YAML / 结构不符 → 空策略（不抛）', () => {
    assert.deepEqual(parseWorkspacePolicy('::: [not yaml'), { minimumReleaseAgeMin: null, excludes: [] })
    assert.deepEqual(parseWorkspacePolicy('- just\n- a\n- list\n'), { minimumReleaseAgeMin: null, excludes: [] })
  })
})

describe('excludeMatch（pnpm 11.7 实证语义）', () => {
  it('包名级与 `||` 复合条目（含裸版本段）→ effective', () => {
    assert.equal(excludeMatch('dshmarket', 'dshmarket', '1.66.8'), 'effective')
    assert.equal(excludeMatch('dsh-m@0.9.0 || 0.9.1 || 0.9.18', 'dsh-m', '0.9.18'), 'effective')
    assert.equal(excludeMatch('dsh-m@0.9.0 || 0.9.1 || 0.9.15', 'dsh-m', '0.9.18'), 'no')
  })
  it('scoped 独立精确条目 → effective（0.1.13 带 4h 龄未被 0:15 校验标记的实证）；版本不等 → no', () => {
    assert.equal(excludeMatch('@iasiv5/dsh-quota-watch@0.1.13', '@iasiv5/dsh-quota-watch', '0.1.13'), 'effective')
    assert.equal(excludeMatch('@iasiv5/dsh-quota-watch@0.1.13', '@iasiv5/dsh-quota-watch', '0.1.15'), 'no')
  })
  it('非 scoped 独立精确条目 → unreliable-unscoped-exact（0.9.14/0.9.18 两次被锁校验拒绝的实证）', () => {
    assert.equal(excludeMatch('dsh-m@0.9.18', 'dsh-m', '0.9.18'), 'unreliable-unscoped-exact')
    assert.equal(excludeMatch('dsh-m@0.9.18', 'dsh-m', '0.9.17'), 'no')
    assert.equal(excludeMatch('other-pkg@1.0.0', 'dsh-m', '0.9.18'), 'no')
  })
})

describe('splitExactSelector', () => {
  it('独立精确条目 → { pkg, version, reliable }；scoped reliable=true', () => {
    assert.deepEqual(splitExactSelector('dsh-m@0.9.18'), { pkg: 'dsh-m', version: '0.9.18', reliable: false })
    assert.deepEqual(splitExactSelector('@iasiv5/dsh-quota-watch@0.1.13'), { pkg: '@iasiv5/dsh-quota-watch', version: '0.1.13', reliable: true })
  })
  it('复合 / 包名级 / 版本段非精确 semver → null（不参与旁包探测）', () => {
    assert.equal(splitExactSelector('dsh-m@0.9.0 || 0.9.1'), null)
    assert.equal(splitExactSelector('dshmarket'), null)
    assert.equal(splitExactSelector('dsh-m@^0.9.18'), null)
    assert.equal(splitExactSelector('dsh-m@next'), null)
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

describe('releaseAgePrecheck（委派前预检）', () => {
  const MIN = 60_000
  const isoAgo = (ms) => new Date(Date.now() - ms).toISOString()

  beforeEach(_resetReleaseAgeCachesForTests)

  it('目标未满期 → blocked（role=target），文案含目标条目与「未触碰 profile」', async () => {
    const r = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(11 * MIN) }),
        workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: [] }),
      },
    })
    assert.equal(r.blocked, true)
    assert.equal(r.blockers[0].role, 'target')
    assert.ok(r.message.includes('pkg-a@1.2.3'))
    assert.ok(r.message.includes('未触碰 profile 文件'))
  })

  it('目标已满期 → 放行', async () => {
    const r = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(25 * 60 * MIN) }),
        workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: [] }),
      },
    })
    assert.equal(r.blocked, false)
  })

  it('目标被 scoped 独立精确条目覆盖 → 放行；被非 scoped 独立精确条目「覆盖」→ 仍拦', async () => {
    const scoped = await releaseAgePrecheck({
      pkg: '@scope/pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(5 * MIN) }),
        workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: ['@scope/pkg-a@1.2.3'] }),
      },
    })
    assert.equal(scoped.blocked, false)
    const unscoped = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(5 * MIN) }),
        workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: ['pkg-a@1.2.3'] }),
      },
    })
    assert.equal(unscoped.blocked, true)
  })

  it('目标已满期但锁内非 scoped 独立精确条目未满期 → blocked（role=lockfile-exclude，旁包连坐形态）', async () => {
    const r = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async (pkg) => (pkg === 'dsh-m' ? { '0.9.18': isoAgo(24 * MIN) } : { '1.2.3': isoAgo(72 * 60 * MIN) }),
        workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: ['dsh-m@0.9.18'] }),
      },
    })
    assert.equal(r.blocked, true)
    assert.equal(r.blockers[0].role, 'lockfile-exclude')
    assert.ok(r.message.includes('dsh-m@0.9.18'))
  })

  it('profileDir 缺席 / 发布时刻不可得 / 复合条目覆盖 → 一律放行（fail-open）', async () => {
    const noDir = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(MIN) }),
        workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: [] }),
      },
    })
    assert.equal(noDir.blocked, false)
    const noTimes = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => null,
        workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: [] }),
      },
    })
    assert.equal(noTimes.blocked, false)
    const compound = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(MIN) }),
        workspacePolicy: async () => ({ minimumReleaseAgeMin: 1440, excludes: ['pkg-a@1.0.0 || 1.2.3'] }),
      },
    })
    assert.equal(compound.blocked, false)
  })

  it('显式 minimumReleaseAgeMin（分钟）生效：60min 窗口下 90min 龄放行', async () => {
    const pass = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(90 * MIN) }),
        workspacePolicy: async () => ({ minimumReleaseAgeMin: 60, excludes: [] }),
      },
    })
    assert.equal(pass.blocked, false)
  })

  it('显式 minimumReleaseAgeMin（分钟）生效：60min 窗口下 30min 龄拦下', async () => {
    const block = await releaseAgePrecheck({
      pkg: 'pkg-a',
      version: '1.2.3',
      profileDir: 'X:/profile-demo',
      deps: {
        packumentTimes: async () => ({ '1.2.3': isoAgo(30 * MIN) }),
        workspacePolicy: async () => ({ minimumReleaseAgeMin: 60, excludes: [] }),
      },
    })
    assert.equal(block.blocked, true)
  })
})
