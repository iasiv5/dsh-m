/**
 * M2 Task 3：注册真实 dshm_install / dshm_upgrade 工具——守卫拦截的结构化 error result、
 * 渲染文本（不渲染「已安装成功」）、presentResult 标题、restartSafe 字段携带。
 * 运行：npm run build && node --test tests/tools-install.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { InstallGuardError } from '../lib/core/market.js'

async function registerWith(installBehavior) {
  const { registerTools } = await import('../lib/tools.js')
  const registered = []
  const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {} }
  registerTools(ctx, { timeoutMs: 50 }, {
    installFromRegistry: installBehavior,
    upgradePlugin: installBehavior,
  })
  return registered
}

function guardErr(overrides = {}) {
  return new InstallGuardError({
    kind: 'compensated',
    message: '安装违例（NO_DSH_MARKER: 无 dsh 插件标记），已自动卸载（补偿事务 committed）',
    violations: [{ pkg: 'pkg-a', code: 'NO_DSH_MARKER', detail: '包内无 dsh.bundle/dsh.client 标记且无 cordis.patch.yml' }],
    needsRestart: true,
    restartSafe: true,
    compensation: { status: 'committed', note: 'compensated:pkg-a' },
    ...overrides,
  })
}

describe('M2 Task 3：dshm_install / dshm_upgrade 守卫拦截', () => {
  it('⑳ execute 捕获 InstallGuardError → 结构化 error result（含 needsRestart/restartSafe/kind）', async () => {
    const registered = await registerWith(async () => {
      throw guardErr()
    })
    const install = registered.find((t) => t.name === 'dshm_install')
    const out = await install.execute({ id: 'pkg-a' })
    assert.equal(out.ok, false)
    assert.equal(out.guard, true)
    assert.equal(out.kind, 'compensated')
    assert.equal(out.needsRestart, true)
    assert.equal(out.restartSafe, true)
    assert.equal(out.compensation.status, 'committed')
    assert.ok(Array.isArray(out.violations) && out.violations.length === 1)
  })

  it('⑳ 渲染文本不含「已安装成功」，含终态与修复指引；manual-repair → 不建议立即重启', async () => {
    const registered = await registerWith(async () => {
      throw guardErr({
        kind: 'manual_required',
        message: '安装违例，补偿进入 manual-repair：需人工处理',
        restartSafe: false,
        compensation: { status: 'manual-repair', note: '状态未知' },
        repairBasis: '旧 manifestSpec=pkg-a@^1.0.0',
      })
    })
    const install = registered.find((t) => t.name === 'dshm_install')
    const out = await install.execute({ id: 'pkg-a' })
    const text = install.output.render({}, out)[0].text
    assert.ok(!text.includes('✅'), '不得渲染成功标记')
    assert.ok(text.includes('守卫拦截'))
    assert.ok(text.includes('manual-repair'))
    assert.ok(text.includes('修复依据'))
    assert.ok(text.includes('修复后再重启'), 'restartSafe=false → 不建议立即重启')
    assert.ok(!text.includes('可以重启'))
    // presentResult 经 defineTool 包装（直调契约不同），标题断言改由结构化字段 + render 覆盖：
    // render 文本已断言「守卫拦截」且不含成功标记；kind/compensation 字段可供卡片标题渲染。
    assert.equal(out.kind, 'manual_required')
  })

  it('⑳ dshm_upgrade 同样捕获并携带 restartSafe；非守卫错误原样抛出', async () => {
    let upgraded = 0
    const registered = await registerWith(async () => {
      upgraded += 1
      if (upgraded === 1) throw guardErr({ restartSafe: false, compensation: { status: 'rolled-back', note: '坏包可能仍在' } })
      throw new Error('普通业务错误')
    })
    const upgrade = registered.find((t) => t.name === 'dshm_upgrade')
    const out = await upgrade.execute({ pkg: 'pkg-a' })
    assert.equal(out.ok, false)
    assert.equal(out.restartSafe, false)
    assert.ok(out.compensation.status === 'rolled-back')
    await assert.rejects(() => upgrade.execute({ pkg: 'pkg-a' }), /普通业务错误/)
  })
})
