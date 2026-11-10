/**
 * exec-route：执行能力门（ADR-0034 Layer 2，issue #65）。
 *
 * 三层：probePathDshUsable（纯 FS PATH 探测）→ decideWebMutationRoute（纯决策矩阵）→
 * routeWebMutation（编排缝：resolveManager 同源探测，spawn 短路时零探测）。
 * 全部 hermetic：launch/probe/manager 均注入，不触真实 PATH。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { decideWebMutationRoute, probePathDshUsable, routeWebMutation } from '../lib/core/exec-route.js'
import { DesktopOpsError } from '../lib/core/profile-ops.js'

describe('exec-route：decideWebMutationRoute 决策矩阵（纯）', () => {
  const manager = { installBundle: async () => ({}) }

  it('entry / carrier 命中 → spawn（忽略 manager 与 probe 输入）', () => {
    assert.deepEqual(decideWebMutationRoute({ launchSource: 'entry', pathDshUsable: false, manager: undefined, op: 'install' }), { route: 'spawn' })
    assert.deepEqual(decideWebMutationRoute({ launchSource: 'carrier', pathDshUsable: true, manager, op: 'install' }), { route: 'spawn' })
  })

  it('path-fallback + PATH dsh 可执行 → spawn（现状零漂移）', () => {
    assert.deepEqual(decideWebMutationRoute({ launchSource: 'path-fallback', pathDshUsable: true, manager: undefined, op: 'install' }), { route: 'spawn' })
  })

  it('path-fallback + 不可执行 + manager 缺席 → refuse(no-exec-capability)，文案钉三锚', () => {
    const r = decideWebMutationRoute({ launchSource: 'path-fallback', pathDshUsable: false, manager: undefined, op: 'install' })
    assert.equal(r.route, 'refuse')
    assert.ok(r.error instanceof DesktopOpsError)
    assert.equal(r.error.code, 'no-exec-capability')
    assert.match(r.error.message, /官方 pluginManager 服务不可用/)
    assert.match(r.error.message, /安装已拒绝/)
    assert.match(r.error.message, /profile 未被修改/)
  })

  it('path-fallback + 不可执行 + manager 缺方法 → refuse 文案点名缺的方法', () => {
    const r = decideWebMutationRoute({ launchSource: 'path-fallback', pathDshUsable: false, manager: {}, op: 'install' })
    assert.equal(r.route, 'refuse')
    assert.match(r.error.message, /缺 installBundle 方法/)
  })

  it('方法齐备 → delegate（manager 原样透传）；四操作方法映射', () => {
    for (const op of ['install', 'upgrade', 'self-upgrade']) {
      const r = decideWebMutationRoute({ launchSource: 'path-fallback', pathDshUsable: false, manager, op })
      assert.deepEqual(r, { route: 'delegate', manager }, `op=${op} 要 installBundle`)
    }
    const remover = { removeBundle: async () => ({}) }
    const ru = decideWebMutationRoute({ launchSource: 'path-fallback', pathDshUsable: false, manager: remover, op: 'uninstall' })
    assert.deepEqual(ru, { route: 'delegate', manager: remover })
  })

  it('uninstall 用 removeBundle 判定：只有 installBundle → refuse 点名 removeBundle', () => {
    const r = decideWebMutationRoute({ launchSource: 'path-fallback', pathDshUsable: false, manager, op: 'uninstall' })
    assert.equal(r.route, 'refuse')
    assert.match(r.error.message, /缺 removeBundle 方法/)
    assert.match(r.error.message, /卸载已拒绝/, 'op 文案映射')
  })
})

describe('exec-route：probePathDshUsable（PATH 纯 FS 探测）', () => {
  it('可执行 dsh 命中（真实 FS）', () => {
    const home = mkdtempSync(join(tmpdir(), 'dshm-probe-'))
    try {
      const bin = join(home, 'bin')
      mkdirSync(bin, { recursive: true })
      const dsh = join(bin, 'dsh')
      writeFileSync(dsh, '#!/bin/sh\n')
      chmodSync(dsh, 0o755)
      assert.equal(probePathDshUsable({ pathEnv: `${bin}${delimiter}/nowhere`, platform: 'linux' }), true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('缺失 / 前目录不可执行后目录命中 → 按 PATH 序 walk', () => {
    const home = mkdtempSync(join(tmpdir(), 'dshm-probe-'))
    try {
      const bin = join(home, 'bin')
      mkdirSync(bin, { recursive: true })
      const dsh = join(bin, 'dsh')
      writeFileSync(dsh, '#!/bin/sh\n')
      chmodSync(dsh, 0o755)
      assert.equal(probePathDshUsable({ pathEnv: `${home}/empty${delimiter}${bin}`, platform: 'linux' }), true)
      assert.equal(probePathDshUsable({ pathEnv: `${home}/empty`, platform: 'linux' }), false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('存在但 X_OK 拒绝 → false（注入 accessX，root 下真实 accessSync 恒过——永真判据防呆）', () => {
    const home = mkdtempSync(join(tmpdir(), 'dshm-probe-'))
    try {
      const bin = join(home, 'bin')
      mkdirSync(bin, { recursive: true })
      const dsh = join(bin, 'dsh')
      writeFileSync(dsh, '#!/bin/sh\n')
      const denyOthers = (p) => p !== dsh
      assert.equal(probePathDshUsable({ pathEnv: bin, platform: 'linux', accessX: denyOthers }), false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('win32 名单选择 dsh.cmd', () => {
    const home = mkdtempSync(join(tmpdir(), 'dshm-probe-'))
    try {
      const bin = join(home, 'bin')
      mkdirSync(bin, { recursive: true })
      const cmd = join(bin, 'dsh.cmd')
      writeFileSync(cmd, '@echo off\r\n')
      chmodSync(cmd, 0o755)
      assert.equal(probePathDshUsable({ pathEnv: bin, platform: 'win32' }), true)
      assert.equal(probePathDshUsable({ pathEnv: bin, platform: 'linux' }), false, 'POSIX 名单只找 dsh')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('exec-route：routeWebMutation 编排（注入缝）', () => {
  const manager = { installBundle: async () => ({}) }
  const launchOf = (source) => () => ({ file: 'dsh', args: [], cwd: undefined, viaShell: false, source, entry: undefined })
  const probeFalse = () => false

  it('entry 命中 → spawn 且零 manager 探测（getService 触发即炸）', async () => {
    const r = await routeWebMutation({
      getService: () => { throw new Error('should not probe manager') },
      ensureService: async () => { throw new Error('should not probe manager') },
      op: 'install',
      launch: launchOf('entry'),
      probe: probeFalse,
    })
    assert.deepEqual(r, { route: 'spawn' })
  })

  it('path-fallback + 不可执行 + getService 直取 manager → delegate', async () => {
    let ensureCalled = false
    const r = await routeWebMutation({
      getService: () => manager,
      ensureService: async () => { ensureCalled = true; return manager },
      op: 'install',
      launch: launchOf('path-fallback'),
      probe: probeFalse,
    })
    assert.deepEqual(r, { route: 'delegate', manager })
    assert.equal(ensureCalled, false, '直取命中不走惰性拉起')
  })

  it('path-fallback + 直取缺席 → ensureService 惰性拉起（resolveManager 同源语义）', async () => {
    const r = await routeWebMutation({
      getService: () => undefined,
      ensureService: async () => manager,
      op: 'install',
      launch: launchOf('path-fallback'),
      probe: probeFalse,
    })
    assert.deepEqual(r, { route: 'delegate', manager })
  })

  it('path-fallback + 服务彻底缺席 → refuse(no-exec-capability)', async () => {
    const r = await routeWebMutation({
      op: 'upgrade',
      launch: launchOf('path-fallback'),
      probe: probeFalse,
    })
    assert.equal(r.route, 'refuse')
    assert.equal(r.error.code, 'no-exec-capability')
    assert.match(r.error.message, /升级已拒绝/)
  })

  it('path-fallback + probe 可执行 → spawn（不探测 manager）', async () => {
    const r = await routeWebMutation({
      getService: () => { throw new Error('should not probe manager') },
      op: 'install',
      launch: launchOf('path-fallback'),
      probe: () => true,
    })
    assert.deepEqual(r, { route: 'spawn' })
  })
})
