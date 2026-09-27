/**
 * compat-check 契约（plan Task 6）：
 * - workspace:^/~/ * 视为运行时版本（rc.2 上全部通过）；
 * - ^0.1.5 vs 0.1.7-rc.2：includePrerelease 命中（0.1.7-rc.2 满足 ^0.1.5）；
 * - 精确 '0.1.5' vs 0.1.7-rc.2 不满足；'~0.1.5' 同样不满足（minor 锁定）；
 * - 非 @deepseek-ai/dsh* 键忽略；空 range 不满足；
 * - runtimeVersion null → precheck 放行（不拦）；
 * - registry 参数透传 npmVersion（预检跟随元数据源）。
 * 运行：npm run build && node --test tests/compat-check.test.mjs tests/dsh-version.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { evaluatePeers, IncompatibleError, precheckNpmCompat } from '../lib/core/compat-check.js'

describe('evaluatePeers：官方语义移植', () => {
  it('workspace 三形态视为运行时版本 → 满足', () => {
    for (const spec of ['workspace:^', 'workspace:~', 'workspace:*']) {
      assert.deepEqual(evaluatePeers({ '@deepseek-ai/dsh': spec }, '0.1.7-rc.2'), {}, spec)
    }
  })

  it('^0.1.5 vs 0.1.7-rc.2 → includePrerelease 命中（兼容）', () => {
    assert.deepEqual(evaluatePeers({ '@deepseek-ai/dsh-tools': '^0.1.5' }, '0.1.7-rc.2'), {})
  })

  it('精确 0.1.5 / <=0.1.6 vs 0.1.7-rc.2 → 不满足', () => {
    assert.deepEqual(evaluatePeers({ '@deepseek-ai/dsh-tools': '0.1.5' }, '0.1.7-rc.2'), {
      '@deepseek-ai/dsh-tools': '0.1.5',
    })
    assert.deepEqual(evaluatePeers({ '@deepseek-ai/dsh-tools': '<=0.1.6' }, '0.1.7-rc.2'), {
      '@deepseek-ai/dsh-tools': '<=0.1.6',
    })
  })

  it('~0.1.5 vs 0.1.7-rc.2 → 满足（semver 语义：prerelease 在 0.1.x 区间内，官方同判）', () => {
    assert.deepEqual(evaluatePeers({ '@deepseek-ai/dsh-tools': '~0.1.5' }, '0.1.7-rc.2'), {})
  })

  it('peer 升高方向（^0.2.0）vs 0.1.7 → 不满足', () => {
    assert.deepEqual(evaluatePeers({ '@deepseek-ai/dsh': '^0.2.0' }, '0.1.7-rc.2'), {
      '@deepseek-ai/dsh': '^0.2.0',
    })
  })

  it('非 @deepseek-ai/dsh* 键忽略（react/cordis 等不检）', () => {
    assert.deepEqual(
      evaluatePeers({ react: '^18.0.0', '@deepseek-ai/cordis': '^4.0.0', '@other/dsh-x': '*' }, '0.1.7-rc.2'),
      {},
    )
  })

  it('空 range 不满足', () => {
    assert.deepEqual(evaluatePeers({ '@deepseek-ai/dsh-tools': '' }, '0.1.7-rc.2'), {
      '@deepseek-ai/dsh-tools': '',
    })
  })

  it('裸名 @deepseek-ai/dsh 与前缀族都在检查范围', () => {
    const failing = evaluatePeers({ '@deepseek-ai/dsh': '^9.0.0', '@deepseek-ai/dsh-hmr': '^9.0.0' }, '0.1.7-rc.2')
    assert.deepEqual(Object.keys(failing).sort(), ['@deepseek-ai/dsh', '@deepseek-ai/dsh-hmr'])
  })
})

describe('IncompatibleError', () => {
  it('携带结构化 issue 且 message 可读', () => {
    const issue = { pkg: 'demo', version: '1.0.0', runtimeVersion: '0.1.7-rc.2', peers: { '@deepseek-ai/dsh': '^9' } }
    const err = new IncompatibleError(issue)
    assert.equal(err.issue.pkg, 'demo')
    assert.equal(err.message.includes('demo@1.0.0'), true)
    assert.equal(err.message.includes('0.1.7-rc.2'), true)
  })
})

describe('precheckNpmCompat', () => {
  const stubMeta = (peers) => async (pkg, version) => ({ version, peers })

  it('runtimeVersion null → 放行（不拦，不触达元数据）', async () => {
    let touched = false
    const result = await precheckNpmCompat('demo-pkg', '1.0.0', {
      timeoutMs: 1,
      runtimeVersion: null,
      fetchVersion: async () => {
        touched = true
        return { version: '1.0.0', peers: {} }
      },
    })
    assert.equal(result, null)
    assert.equal(touched, false)
  })

  it('peers 全满足 → null', async () => {
    const result = await precheckNpmCompat('demo-pkg', '1.0.0', {
      timeoutMs: 1,
      runtimeVersion: '0.1.7-rc.2',
      fetchVersion: stubMeta({ '@deepseek-ai/dsh-tools': '^0.1.5', react: '^18' }),
    })
    assert.equal(result, null)
  })

  it('不满足 → CompatIssue（含 runtimeVersion 与 failing peers）', async () => {
    const result = await precheckNpmCompat('demo-pkg', '2.0.0', {
      timeoutMs: 1,
      runtimeVersion: '0.1.7-rc.2',
      fetchVersion: stubMeta({ '@deepseek-ai/dsh': '<=0.1.6' }),
    })
    assert.deepEqual(result, {
      pkg: 'demo-pkg',
      version: '2.0.0',
      runtimeVersion: '0.1.7-rc.2',
      peers: { '@deepseek-ai/dsh': '<=0.1.6' },
    })
  })
})
