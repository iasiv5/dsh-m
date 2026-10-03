/**
 * renderUpgrade × 生效判定三态（生效判定 T5 / 0.9.22）。
 * 运行：npm run build && node --test tests/tools-upgrade-message.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { renderUpgrade } from '../lib/tools.js'

const base = { pkg: 'x', version: '2.0.0', fromVersion: '1.0.0', buildApprovals: [], fallbackAllBuilds: false }

describe('renderUpgrade × 生效判定三态（0.9.22）', () => {
  it('client-only → 明示刷新生效且禁止询问 dshm_restart', () => {
    const text = renderUpgrade({ ...base, activation: 'client-only' })
    assert.match(text, /✅ x 已升级（v1\.0\.0 → v2\.0\.0）/)
    assert.match(text, /纯客户端更新：刷新页面即可生效，无需重启/)
    assert.match(text, /不要询问 dshm_restart/)
  })

  it('unknown → 保守建议重启并询问', () => {
    const text = renderUpgrade({ ...base, activation: 'unknown' })
    assert.match(text, /生效判定未完成（网络或解析失败）：为确保生效建议重启/)
    assert.match(text, /询问是否 dshm_restart/)
  })

  it('restart-required 与字段缺席 → 现状文案', () => {
    for (const activation of ['restart-required', undefined]) {
      const text = renderUpgrade({ ...base, activation })
      assert.match(text, /需要重启生效——询问是否 dshm_restart/)
    }
  })

  it('guard 分支回归：不受 activation 影响', () => {
    const text = renderUpgrade({ pkg: 'x', guard: true, message: 'm', compensation: { status: 'rolled-back', note: 'n' }, restartSafe: false })
    assert.match(text, /⛔ 升级被装后守卫拦截/)
    assert.match(text, /不得说「已升级成功」/)
    assert.doesNotMatch(text, /^✅/)
  })
})
