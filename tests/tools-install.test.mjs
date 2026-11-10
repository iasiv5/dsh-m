/**
 * M2 Task 3：注册真实 dshm_install / dshm_upgrade 工具——守卫拦截的结构化 error result、
 * 渲染文本（不渲染「已安装成功」）、presentResult 标题、restartSafe 字段携带。
 * 运行：npm run build && node --test tests/tools-install.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { InstallGuardError } from '../lib/core/market-mutation.js'
import { DesktopOpsError } from '../lib/core/profile-ops.js'
import { webProfileDir } from '../lib/core/env.js'

/** ADR-0034 hermetic 桩：既有用例的 gate 恒 spawn（迁移表落点，真探测只在生产）。 */
const spawnRouteStub = async () => ({ route: 'spawn' })

async function registerWith(installBehavior) {
  const { registerTools } = await import('../lib/tools.js')
  const registered = []
  const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {} }
  registerTools(ctx, { timeoutMs: 50 }, {
    installFromRegistry: installBehavior,
    upgradePlugin: installBehavior,
    routeWebMutation: spawnRouteStub,
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

describe('ADR-0030（issue #39）：agent 工具 web 写分支接线（四工具）', () => {
  const aquaCtx = { name: 'aqua', dir: '/h/profiles/aqua' }

  async function registerWithProfile(profileContext, coreOverrides = {}) {
    const { registerTools } = await import('../lib/tools.js')
    const registered = []
    const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {}, get: (n) => (n === 'profileContext' ? profileContext : undefined) }
    registerTools(ctx, { timeoutMs: 50 }, { routeWebMutation: spawnRouteStub, ...coreOverrides })
    return registered
  }

  it('dshm_install web 分支 → installFromRegistry deps 收 profileDir+profileName', async () => {
    const captured = []
    const registered = await registerWithProfile(aquaCtx, {
      installFromRegistry: async (id, cfg, opts, deps) => {
        captured.push({ id, deps })
        return { id, pkg: 'p', spec: 'p@1.0.0', version: '1.0.0', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true, output: '' }
      },
    })
    const tool = registered.find((t) => t.name === 'dshm_install')
    const out = await tool.execute({ id: 'pkg-a' })
    assert.equal(out.version, '1.0.0')
    assert.equal(captured[0].deps.profileDir, '/h/profiles/aqua')
    assert.equal(captured[0].deps.profileName, 'aqua')
  })

  it('dshm_toggle web 分支 → togglePlugin deps 收 profileDir+profileName（issue #43 标签透传）', async () => {
    const captured = []
    const registered = await registerWithProfile(aquaCtx, {
      togglePlugin: async (pkg, enabled, deps) => {
        captured.push({ pkg, enabled, deps })
        return { pkg, enabled, applied: 'restart-required', via: 'fallback', warnings: [] }
      },
    })
    const tool = registered.find((t) => t.name === 'dshm_toggle')
    const out = await tool.execute({ pkg: 'pkg-t', enabled: true })
    assert.equal(out.applied, 'restart-required')
    assert.equal(captured[0].deps.profileDir, '/h/profiles/aqua')
    assert.equal(captured[0].deps.profileName, 'aqua')
  })

  it('dshm_uninstall web 分支 → uninstallPlugin deps 收 profileDir+profileName', async () => {
    const captured = []
    const registered = await registerWithProfile(aquaCtx, {
      uninstallPlugin: async (pkg, cfg, opts, deps) => {
        captured.push({ pkg, deps })
        return { pkg, liveDisabled: false, needsRestart: true, leftovers: [] }
      },
    })
    const tool = registered.find((t) => t.name === 'dshm_uninstall')
    const out = await tool.execute({ pkg: 'pkg-u' })
    assert.equal(out.pkg, 'pkg-u')
    assert.equal(captured[0].deps.profileDir, '/h/profiles/aqua')
    assert.equal(captured[0].deps.profileName, 'aqua')
  })

  it('dshm_upgrade web 分支 → upgradePlugin deps 收 profileDir+profileName', async () => {
    const captured = []
    const registered = await registerWithProfile(aquaCtx, {
      upgradePlugin: async (pkg, cfg, opts, deps) => {
        captured.push({ pkg, deps })
        return { id: 'x', pkg, spec: `${pkg}@2.0.0`, version: '2.0.0', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true, output: '' }
      },
    })
    const tool = registered.find((t) => t.name === 'dshm_upgrade')
    const out = await tool.execute({ pkg: 'pkg-g' })
    assert.equal(out.version, '2.0.0')
    assert.equal(captured[0].deps.profileDir, '/h/profiles/aqua')
    assert.equal(captured[0].deps.profileName, 'aqua')
  })

  it('零漂移锚：web 名 profile 不传 deps 时行为不变（fallback profile，缺省目录）', async () => {
    const captured = []
    const registered = await registerWithProfile(undefined, {
      installFromRegistry: async (id, cfg, opts, deps) => {
        captured.push({ deps })
        return { id, pkg: 'p', spec: 'p@1.0.0', version: '1.0.0', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true, output: '' }
      },
    })
    const tool = registered.find((t) => t.name === 'dshm_install')
    await tool.execute({ id: 'pkg-a' })
    assert.equal(captured[0].deps.profileDir, webProfileDir(), '无 profileContext → fallback web 目录（旧行为）')
    assert.equal(captured[0].deps.profileName, 'web')
  })
})

describe('ADR-0030 源结构锚：tools 四工具 web 写分支接线计数（计划 T7.3 终值 11）', () => {
  it("src/tools.ts 中 'profileDir: profile.dir' 出现次数 = 11（出现次数语义，非行数）", () => {
    const src = readFileSync(new URL('../src/tools.ts', import.meta.url), 'utf8')
    assert.equal(src.split('profileDir: profile.dir').length - 1, 11, 'desktop 4 + 读分支 3 + web 写分支 4（基线 7 + 4）')
  })
})

describe('issue #41：desktop needsBuildApproval 未遂——诚实渲染 + approvedBuilds 通道', () => {
  // 夹具形态对照生产调用点（tools.ts:312/:480）：desktop 分支顶层 opts + getService/ensureService deps；
  // profile 经 registerTools 第四参直注（:113），不走 ctx.get 解析。
  async function registerDesktopWith(stubs = {}) {
    const { registerTools } = await import('../lib/tools.js')
    const registered = []
    const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {} }
    registerTools(ctx, { timeoutMs: 50 }, {
      desktopInstall: stubs.install ?? (async () => ({ ok: false, needsBuildApproval: true, id: 'dsh-x', pkg: 'plug-a', spec: 'plug-a@1.2.3', pendingBuilds: ['plug-a@1.2.3'], message: '该插件需要执行构建脚本（plug-a@1.2.3）。确认后带同样的包名名单重试（approvedBuilds）；dsh-m 不做全量放行（ADR-0002 同语义）' })),
      desktopUpgrade: stubs.upgrade ?? (async () => ({ ok: false, needsBuildApproval: true, id: 'dsh-x', pkg: 'plug-a', spec: 'plug-a@1.2.3', pendingBuilds: ['plug-a@1.2.3'], message: '该插件需要执行构建脚本（plug-a@1.2.3）。确认后带同样的包名名单重试（approvedBuilds）；dsh-m 不做全量放行（ADR-0002 同语义）' })),
    }, { kind: 'desktop', name: 'desktop', dir: '/tmp/dsh-m-test-profile' })
    return registered
  }

  it('④ dshm_upgrade.execute 未遂 → render ⛔ 升级未完成，无 ✅ 无重启尾巴', async () => {
    const registered = await registerDesktopWith()
    const tool = registered.find((t) => t.name === 'dshm_upgrade')
    const out = await tool.execute({ pkg: 'plug-a' })
    assert.equal(out.needsBuildApproval, true)
    const text = tool.output.render({}, out)[0].text
    assert.match(text, /^⛔ 升级未完成：需要批准构建脚本/)
    assert.match(text, /- plug-a@1\.2\.3/)
    assert.match(text, /approvedBuilds 重试本工具/)
    assert.doesNotMatch(text, /^✅/)
    assert.ok(!text.includes('需要重启生效') && !text.includes('询问是否 dshm_restart'), '未遂不得带成功臂重启尾巴（尾巴句式：需要重启生效/询问是否 dshm_restart）')
  })

  it('⑤ dshm_install.execute 未遂 → render ⛔ 安装未完成，无 ✅ 无重启尾巴', async () => {
    const registered = await registerDesktopWith()
    const tool = registered.find((t) => t.name === 'dshm_install')
    const out = await tool.execute({ id: 'plug-a' })
    assert.equal(out.needsBuildApproval, true)
    const text = tool.output.render({}, out)[0].text
    assert.match(text, /^⛔ 安装未完成：需要批准构建脚本/)
    assert.match(text, /未安装任何新版本/)
    assert.match(text, /approvedBuilds 重试本工具/)
    assert.doesNotMatch(text, /^✅/)
    assert.ok(!text.includes('需要重启生效') && !text.includes('询问是否 dshm_restart'), '未遂不得带成功臂重启尾巴（尾巴句式：需要重启生效/询问是否 dshm_restart）')
  })

  it('⑥ schema：两工具均有 approvedBuilds 数组入参', async () => {
    const registered = await registerDesktopWith()
    for (const name of ['dshm_install', 'dshm_upgrade']) {
      const tool = registered.find((t) => t.name === name)
      // defineTool 将 parameters 规范化为 JSON Schema 形态（{type, properties, required}）——字段在 .properties 下
      const p = tool.parameters?.properties?.approvedBuilds
      assert.ok(p, `${name} 缺 approvedBuilds 入参`)
      assert.equal(p.type, 'array')
      assert.equal(p.items.type, 'string')
    }
  })

  it('⑦ 透传与零漂移：名单原样进 opts；不传/空数组 → opts 无该键（core :515 length>0 门同构）', async () => {
    const calls = []
    const registered = await registerDesktopWith({
      upgrade: async (target, cfg, opts) => { calls.push(opts); return { ok: true, pkg: target, version: '9.9.9' } },
    })
    const tool = registered.find((t) => t.name === 'dshm_upgrade')
    await tool.execute({ pkg: 'plug-a', approvedBuilds: ['plug-a@1.2.3'] })
    assert.deepEqual(calls[0].approvedBuilds, ['plug-a@1.2.3'])
    await tool.execute({ pkg: 'plug-a' })
    assert.ok(!('approvedBuilds' in calls[1]), '不传参不得出现显式键')
    await tool.execute({ pkg: 'plug-a', approvedBuilds: [] })
    assert.ok(!('approvedBuilds' in calls[2]), '空数组视为缺省（与 core 条件展开语义对齐）')
  })
})

describe('ADR-0034：web 执行能力门接线（install/upgrade/uninstall 三站点，issue #65）', () => {
  const ondeviceCtx = { name: 'ondevice', dir: '/h/profiles/ondevice' }

  // 本 describe 自带夹具（不引用兄弟 describe 闭包——CODING-STANDARDS 纪律）
  async function registerGateWith(profileContext, coreOverrides = {}) {
    const { registerTools } = await import('../lib/tools.js')
    const registered = []
    const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {}, get: (n) => (n === 'profileContext' ? profileContext : undefined) }
    registerTools(ctx, { timeoutMs: 50 }, { routeWebMutation: spawnRouteStub, ...coreOverrides })
    return registered
  }

  it('install delegate → desktopInstall 接管，installFromRegistry 未被调', async () => {
    const markers = { desktop: 0, web: 0 }
    const registered = await registerGateWith(ondeviceCtx, {
      routeWebMutation: async () => ({ route: 'delegate', manager: { installBundle: async () => ({}) } }),
      desktopInstall: async () => { markers.desktop += 1; return { ok: true, pkg: 'p', via: 'delegate-marker' } },
      installFromRegistry: async () => { markers.web += 1; throw new Error('web 臂不应被调') },
    })
    const tool = registered.find((t) => t.name === 'dshm_install')
    const out = await tool.execute({ id: 'pkg-a' })
    assert.equal(out.via, 'delegate-marker')
    assert.equal(markers.desktop, 1)
    assert.equal(markers.web, 0)
  })

  it('uninstall delegate → desktopUninstall 接管，uninstallPlugin 未被调', async () => {
    const markers = { desktop: 0, web: 0 }
    const registered = await registerGateWith(ondeviceCtx, {
      routeWebMutation: async () => ({ route: 'delegate', manager: { removeBundle: async () => ({}) } }),
      desktopUninstall: async () => { markers.desktop += 1; return { pkg: 'pkg-u', via: 'delegate-marker' } },
      uninstallPlugin: async () => { markers.web += 1; throw new Error('web 臂不应被调') },
    })
    const tool = registered.find((t) => t.name === 'dshm_uninstall')
    const out = await tool.execute({ pkg: 'pkg-u' })
    assert.equal(out.via, 'delegate-marker')
    assert.equal(markers.desktop, 1)
    assert.equal(markers.web, 0)
  })

  it('upgrade refuse → 结构化 DesktopOpsError 透出，upgradePlugin 未被调', async () => {
    let web = 0
    const registered = await registerGateWith(ondeviceCtx, {
      routeWebMutation: async () => ({ route: 'refuse', error: new DesktopOpsError('no-exec-capability', '环境不可执行子进程（测试注入）') }),
      upgradePlugin: async () => { web += 1; throw new Error('web 臂不应被调') },
    })
    const tool = registered.find((t) => t.name === 'dshm_upgrade')
    await assert.rejects(
      () => tool.execute({ pkg: 'pkg-g' }),
      (err) => err instanceof DesktopOpsError && err.code === 'no-exec-capability' && /环境不可执行子进程/.test(err.message),
    )
    assert.equal(web, 0)
  })

  it('spawn 桩 → web 臂照常；routeWebMutation 收到 op 实参', async () => {
    const ops = []
    const registered = await registerGateWith(ondeviceCtx, {
      routeWebMutation: async (deps) => { ops.push(deps.op); return { route: 'spawn' } },
      installFromRegistry: async (id, _cfg, _opts, _deps) => ({ id, pkg: 'p', spec: 'p@1.0.0', version: '1.0.0', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true, output: '' }),
    })
    const tool = registered.find((t) => t.name === 'dshm_install')
    await tool.execute({ id: 'pkg-a' })
    assert.deepEqual(ops, ['install'])
  })
})
