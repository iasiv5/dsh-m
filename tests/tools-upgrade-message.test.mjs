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

describe('renderUpgrade × needsBuildApproval 未遂（issue #41）', () => {
  const blocked = { ok: false, needsBuildApproval: true, id: 'dsh-x', pkg: 'plug-a', spec: 'plug-a@1.2.3', pendingBuilds: ['plug-a@1.2.3', 'esbuild-dep'], message: '该插件需要执行构建脚本（plug-a@1.2.3）。确认后带同样的包名名单重试（approvedBuilds）；dsh-m 不做全量放行（ADR-0002 同语义）' }

  it('① 未遂 → ⛔ 升级未完成（名单/处理路径/目标版本），无 ✅ 无重启尾巴', () => {
    const text = renderUpgrade(blocked)
    assert.match(text, /^⛔ 升级未完成：需要批准构建脚本/)
    assert.match(text, /待批准：/)
    assert.match(text, /- plug-a@1\.2\.3/)
    assert.match(text, /- esbuild-dep/)
    assert.match(text, /目标版本：plug-a@1\.2\.3（未安装）/)
    assert.match(text, /approvedBuilds 重试本工具/)
    assert.match(text, /官方 Settings → Plugins/)
    assert.match(text, /当前版本未变更/)
    assert.doesNotMatch(text, /^✅/)
    assert.ok(!text.includes('需要重启生效') && !text.includes('询问是否 dshm_restart'), '未遂不得带成功臂重启尾巴（尾巴句式：需要重启生效/询问是否 dshm_restart）')
  })

  it('② ok:false 兜底 → ⛔ 操作未完成，永不渲染成功', () => {
    const text = renderUpgrade({ ok: false, message: '未知形态' })
    assert.match(text, /⛔ 操作未完成/)
    assert.match(text, /不要对用户宣称成功/)
    assert.doesNotMatch(text, /^✅/)
  })

  it('③ 臂序回归：guard 优先于未遂，双标志并存走守卫文案', () => {
    const text = renderUpgrade({ ok: false, guard: true, needsBuildApproval: true, message: 'm', compensation: { status: 'rolled-back', note: 'n' } })
    assert.match(text, /守卫拦截/)
    assert.ok(!text.includes('需要批准构建脚本'), '双标志并存不得落入未遂臂')
  })
})
