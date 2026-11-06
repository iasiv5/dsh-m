/**
 * DSH self-restart contract tests.
 *
 * DSH 0.1.2-rc.1 and 0.1.5-rc.1 both publish dsh-cmdline's appExit hook;
 * managed hosts must use that hook instead of guessing a release-specific unit.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

import {
  MANAGED_RESTART_EXIT_CODE,
  NULL_PORT_GRACE_MS,
  OLD_EXIT_TIMEOUT_MS,
  PORT_HELD_GRACE_MS,
  REPLACEMENT_UP_TIMEOUT_MS,
  appExitFromContext,
  replacementSpawnFlags,
  restartHelperSource,
  scheduleRestart,
  serviceManagedEnv,
  systemdRestartArgv,
  systemdUnitName,
} from '../lib/core/restart.js'

function fakeTimer() {
  const timers = []
  return {
    timers,
    setTimeout(fn, ms) {
      const timer = { fn, ms, unrefCalled: false, unref() { this.unrefCalled = true } }
      timers.push(timer)
      return timer
    },
  }
}

describe('restart lifecycle contract', () => {
  it('recognizes service-managed DSH environments', () => {
    assert.equal(serviceManagedEnv({ INVOCATION_ID: 'boot-1' }), true)
    assert.equal(serviceManagedEnv({ NOTIFY_SOCKET: '/run/notify' }), true)
    assert.equal(serviceManagedEnv({}), false)
  })

  it('reads appExit defensively from a Cordis-like context', () => {
    const exit = () => {}
    assert.equal(appExitFromContext({ get: (name) => name === 'appExit' ? exit : undefined }), exit)
    assert.equal(appExitFromContext({ get: () => undefined }), undefined)
    assert.equal(appExitFromContext({ get: () => { throw new Error('not available') } }), undefined)
    assert.equal(appExitFromContext(null), undefined)
  })
})

describe('scheduleRestart', () => {
  it('uses appExit for managed DSH 0.1.x hosts and does not spawn systemctl', () => {
    const timer = fakeTimer()
    const exitCodes = []
    let spawned = false
    const result = scheduleRestart(null, {
      pid: 123,
      uid: 1039,
      cgroup: '0::/system.slice/old-unit.service',
      env: { INVOCATION_ID: 'boot-1' },
      appExit: (code) => exitCodes.push(code),
      restartPolicy: { restart: 'on-failure', successExitStatus: '', restartPreventExitStatus: '' },
      setTimeout: timer.setTimeout,
      spawn: () => { spawned = true; throw new Error('systemctl must not be used') },
    })

    assert.deepEqual(result, { pid: 123, helperPid: undefined, via: 'app-exit' })
    assert.equal(timer.timers.length, 1)
    assert.equal(timer.timers[0].ms, 150)
    assert.equal(timer.timers[0].unrefCalled, true)
    assert.deepEqual(exitCodes, [])
    timer.timers[0].fn()
    assert.deepEqual(exitCodes, [MANAGED_RESTART_EXIT_CODE])
    assert.equal(spawned, false)
  })

  it('uses transient fallback when Restart policy would not revive appExit', () => {
    const timer = fakeTimer()
    const exitCodes = []
    let spawned = null
    const cgroup = '0::/user.slice/user-1039.slice/user@1039.service/app.slice/openbmc-dsh.service'
    const result = scheduleRestart(null, {
      pid: 124,
      uid: 1039,
      cgroup,
      env: { INVOCATION_ID: 'boot-2' },
      appExit: (code) => exitCodes.push(code),
      restartPolicy: { restart: 'no', successExitStatus: '', restartPreventExitStatus: '' },
      setTimeout: timer.setTimeout,
      spawn(file, args) {
        spawned = { file, args }
        return { pid: 790, unref() {} }
      },
    })
    assert.equal(result.via, 'systemd')
    assert.deepEqual(exitCodes, [])
    timer.timers[0].fn()
    assert.equal(spawned.file, 'systemd-run')
  })

  it('uses a manager-owned transient fallback for callers without appExit', () => {
    const timer = fakeTimer()
    let spawned = null
    const cgroup = '0::/user.slice/user-1039.slice/user@1039.service/app.slice/openbmc-dsh.service'
    const result = scheduleRestart(null, {
      pid: 456,
      uid: 1039,
      cgroup,
      env: {},
      setTimeout: timer.setTimeout,
      spawn(file, args, options) {
        spawned = { file, args, options }
        return { pid: 789, unref() {} }
      },
    })

    assert.deepEqual(result, { pid: 456, helperPid: undefined, via: 'systemd' })
    assert.equal(timer.timers.length, 1)
    timer.timers[0].fn()
    assert.equal(spawned.file, 'systemd-run')
    assert.equal(spawned.args[0], '--user')
    assert.match(spawned.args[2], /^dshm-restart-456-.*\.service$/)
    assert.deepEqual(spawned.args.slice(3, 7), ['--collect', '--service-type=exec', '/bin/sh', '-c'])
    assert.match(spawned.args[7], /exec 'systemctl' '--user' 'restart' '--no-block' 'openbmc-dsh\.service'/)
    assert.equal(spawned.options.detached, true)
  })
})

describe('systemd cgroup parsing', () => {
  it('ignores the user manager slice and selects the owning service', () => {
    const cgroup = '0::/user.slice/user-1039.slice/user@1039.service/app.slice/openbmc-dsh.service\n'
    assert.equal(systemdUnitName(cgroup), 'openbmc-dsh.service')
    const plan = systemdRestartArgv({ cgroup, uid: 1039, pid: 456 })
    assert.equal(plan.file, 'systemd-run')
    assert.equal(plan.args[0], '--user')
    assert.match(plan.args[2], /^dshm-restart-456-.*\.service$/)
    assert.deepEqual(plan.args.slice(3, 7), ['--collect', '--service-type=exec', '/bin/sh', '-c'])
    assert.match(plan.args[7], /exec 'systemctl' '--user' 'restart' '--no-block' 'openbmc-dsh\.service'/)
  })
})

// The frontend separately verifies the boot id after this request; a successful
// appExit call alone is only the restart request, not proof of replacement.

describe('helper spawn flags 与 windowsHide 源锚（issue #48）', () => {
  const base = { file: 'node.exe', args: ['-NoProfile', '-Command', 'x'], viaShell: false, detached: false }
  it('replacementSpawnFlags 恒返回 { windowsHide: true }', () => {
    assert.deepEqual(replacementSpawnFlags(), { windowsHide: true })
  })
  it('helper 源码内插 flags——windowsHide 字面量恰 1 处（出现次数语义）', () => {
    const src = restartHelperSource(base, { cwd: '/c' }, { out: '/o', err: '/e' }, 3081, 4242)
    assert.equal(src.split('"windowsHide":true').length - 1, 1)
    // usage 锚：spawn 行必须实际展开 flags（变异自证实证：仅钉声明行时，删 spawn 行 `...flags` 后声明行仍在、锚恒绿）
    assert.equal(src.split('shell: viaShell, ...flags }').length - 1, 1)
  })
})

describe('restart helper 主流程（vm 沙箱真跑，issue #50）', () => {
  const base = { file: 'node.exe', args: ['-NoProfile', '-Command', 'x'], viaShell: false, detached: false }
  const logs = { out: '/tmp/out.log', err: '/tmp/err.log' }
  const src5 = (port, pid = 4242) => restartHelperSource(base, { cwd: '/c' }, logs, port, pid)

  // helper 源码沙箱：stub 逐个对照 helper 内 require 面与全局面（node:child_process/fs/net、
  // process.kill+env、setTimeout、Date.now），虚拟时钟由 pump 推进，时序确定、零真 sleep。
  function runHelper(src, { alive = () => false, probes = [], spawnThrows = null, eperm = false } = {}) {
    const notes = []
    const spawnCalls = []
    let clock = 0
    let probeIndex = 0
    let aliveIndex = 0
    let exitHandler = null
    let errorHandler = null
    let doneFlag = false
    const timers = []
    const child = {
      on(event, cb) {
        if (event === 'exit') exitHandler = cb
        if (event === 'error') errorHandler = cb
      },
      unref() {},
    }
    const sandbox = {
      require(spec) {
        if (spec === 'node:child_process') {
          return { spawn: (file, args, o) => { spawnCalls.push({ file, args, o }); if (spawnThrows) throw spawnThrows; return child } }
        }
        if (spec === 'node:fs') {
          return { appendFileSync: (f, line) => notes.push(line), openSync: () => 7 }
        }
        if (spec === 'node:net') {
          return {
            connect: () => {
              const outcome = probes.length === 0 ? 'error' : probes[Math.min(probeIndex, probes.length - 1)]
              probeIndex += 1
              const cbs = {}
              const socket = { destroy() {}, on(event, cb) { cbs[event] = cb; return socket } }
              queueMicrotask(() => { const cb = outcome === 'connect' ? cbs.connect : cbs.error; if (cb) cb() })
              return socket
            },
          }
        }
        throw new Error(`unexpected require in helper harness: ${spec}`)
      },
      process: {
        env: {},
        kill(p) {
          const isAlive = alive(aliveIndex)
          aliveIndex += 1
          if (isAlive && eperm) { const e = new Error(`kill EPERM ${p}`); e.code = 'EPERM'; throw e }
          if (!isAlive) { const e = new Error(`kill ESRCH ${p}`); e.code = 'ESRCH'; throw e }
        },
      },
      Date: { now: () => clock },
      setTimeout(fn, ms) { timers.push({ at: clock + ms, fn }); return timers.length },
      __finish() { doneFlag = true },
    }
    const context = vm.createContext(sandbox)
    const body = src.replace(/\nmain\(\)\s*$/u, '')
    vm.runInContext(`${body}\n;main().then(() => __finish(), () => __finish())`, context, { timeout: 5000 })
    return {
      notes,
      spawnCalls,
      emitExit(code, signal) { if (exitHandler) exitHandler(code, signal) },
      emitError(error) { if (errorHandler) errorHandler(error) },
      async pump(steps) {
        for (let i = 0; i < steps && timers.length > 0; i += 1) {
          // 先排空微任务：listening() 的 queueMicrotask 连接结果必须先于其 500ms 兜底
          // setTimeout 落定，否则兜底 timer 在 pump 中抢先 done(false) 误判端口未监听
          await new Promise((r) => setImmediate(r))
          if (timers.length === 0) break
          timers.sort((a, b) => a.at - b.at)
          const next = timers.shift()
          clock = next.at
          next.fn()
          await new Promise((r) => setImmediate(r))
        }
      },
      async pumpUntilDone(maxSteps = 5000) {
        for (let i = 0; i < maxSteps && !doneFlag; i += 1) {
          if (timers.length === 0) {
            // S1 护栏：timers 耗尽而 main() 未收口 = 实现存在无 timer 死循环或提前 return 漏挂 then——显式失败，防夹具假绿
            throw new Error('helper harness: timers exhausted before main() settled')
          }
          await this.pump(1)
        }
        if (!doneFlag) throw new Error(`helper harness: main() did not settle within ${maxSteps} pump steps`)
      },
    }
  }

  it('① 旧进程退出+端口空闲 → 绑定成功记成功行，spawn 带 windowsHide，无失败行', async () => {
    let polls = 3 // alive 三轮后退出（SIGTERM 在 helper 启动后 ~500ms 才落地）
    const h = runHelper(src5(3081), { alive: () => polls-- > 0, probes: ['error', 'error', 'error', 'connect'] })
    await h.pumpUntilDone()
    assert.equal(h.spawnCalls.length, 1)
    assert.equal(h.spawnCalls[0].o.windowsHide, true)
    assert.ok(h.notes.some((n) => n.includes('replacement bound port 3081 after')), h.notes.join(' | '))
    const okLine = h.notes.find((n) => n.includes('replacement bound port 3081 after'))
    assert.ok(okLine && /after \d+\.\ds/u.test(okLine), `成功行秒值恒一位小数: ${okLine}`)
    assert.ok(!h.notes.some((n) => n.includes('restart failed')), h.notes.join(' | '))
  })
  it('② 旧进程 5s 未退出 → 拒绝启动（fail-closed），无 spawn', async () => {
    const h = runHelper(src5(3081), { alive: () => true })
    await h.pumpUntilDone()
    assert.equal(h.spawnCalls.length, 0)
    const line = h.notes.find((n) => n.includes('still alive after 5s'))
    assert.ok(line && line.includes('replacement NOT started'), h.notes.join(' | '))
  })
  it('③ 旧进程退出但端口仍被外部占用 → 拒绝启动，无 spawn', async () => {
    const h = runHelper(src5(3081), { alive: () => false, probes: ['connect'] })
    await h.pumpUntilDone()
    assert.equal(h.spawnCalls.length, 0)
    const line = h.notes.find((n) => n.includes('port 3081 still held by another process'))
    assert.ok(line && line.includes('replacement NOT started'), h.notes.join(' | '))
  })
  it('③b 首探 held → 2s 窗内端口释放 → 放行启动（评审 R1-Q4 补分支）', async () => {
    const h = runHelper(src5(3081), { alive: () => false, probes: ['connect', 'error', 'error', 'connect'] })
    await h.pumpUntilDone()
    assert.equal(h.spawnCalls.length, 1)
    assert.ok(h.notes.some((n) => n.includes('replacement bound port 3081 after')), h.notes.join(' | '))
    assert.ok(!h.notes.some((n) => n.includes('restart failed')), h.notes.join(' | '))
  })
  it('④ port=null + child 10s 未退 → 记 still running 成功行（dshm_restart/CLI 路径）', async () => {
    const h = runHelper(src5(null))
    await h.pumpUntilDone()
    assert.equal(h.spawnCalls.length, 1)
    assert.ok(h.notes.some((n) => n.includes('replacement still running after 10s')), h.notes.join(' | '))
    assert.ok(!h.notes.some((n) => n.includes('restart failed')), h.notes.join(' | '))
  })
  it('⑤ port=null + child 秒退 → 记 exited early 失败行', async () => {
    const h = runHelper(src5(null))
    await h.pump(2) // main 同步完成 spawn 并已进入宽限循环；推进两拍后在循环中触发 exit
    h.emitExit(1, null)
    await h.pumpUntilDone()
    assert.ok(h.notes.some((n) => n.includes('replacement exited early') && n.includes('code 1')), h.notes.join(' | '))
  })
  it('⑥ 带端口路径 child 绑定前退出 → 记 exited before binding 失败行', async () => {
    const h = runHelper(src5(3081), { alive: () => false, probes: ['error'] })
    await h.pump(2) // 就绪循环进行中触发 exit（probes 耗尽后重复最后一项，'error' 恒不绑定）
    h.emitExit(null, 'SIGTERM')
    await h.pumpUntilDone()
    assert.ok(h.notes.some((n) => n.includes('replacement exited before binding port 3081') && n.includes('signal SIGTERM')), h.notes.join(' | '))
  })
  it('⑦ 带端口路径 180s 从未绑定且 child 未退 → 记 did not bind 超时失败行', async () => {
    const h = runHelper(src5(3081), { alive: () => false, probes: ['error'] })
    await h.pumpUntilDone()
    assert.ok(h.notes.some((n) => n.includes('did not bind port 3081 within 180s')), h.notes.join(' | '))
  })
  it('⑧ spawn error 事件 → 记 could not start 失败行，不空转 180s', async () => {
    const h = runHelper(src5(3081), { alive: () => false, probes: ['error'] })
    await h.pump(2) // 就绪循环进行中触发 error
    h.emitError(new Error('spawn ENOENT'))
    await h.pumpUntilDone() // spawnError 置位后主流程即刻 return——提前退出即「不空转」的体现
    assert.ok(h.notes.some((n) => n.includes('restart failed: could not start the replacement') && n.includes('spawn ENOENT')), h.notes.join(' | '))
  })
  it('⑨ spawn 同步 throw → catch 记 could not start，无后续等待', async () => {
    const h = runHelper(src5(3081), { alive: () => false, probes: ['error'], spawnThrows: new Error('boom') })
    await h.pumpUntilDone()
    assert.ok(h.notes.some((n) => n.includes('restart failed: could not start the replacement') && n.includes('boom')), h.notes.join(' | '))
  })
  it('⑫ 旧进程存在但 EPERM（进程在、信号被拒）→ 视同存活，5s 后拒绝启动（评审计划外建议②硬化）', async () => {
    const h = runHelper(src5(3081), { alive: () => true, eperm: true })
    await h.pumpUntilDone()
    assert.equal(h.spawnCalls.length, 0)
    const line = h.notes.find((n) => n.includes('still alive after 5s'))
    assert.ok(line && line.includes('replacement NOT started'), h.notes.join(' | '))
  })
  it('⑩ 时序常量与模板内插同源 + 删除面负向锚（出现次数语义，评审 R1-Q6）', () => {
    const src = src5(3081)
    assert.equal(src.split(`const oldExitTimeout = ${JSON.stringify(OLD_EXIT_TIMEOUT_MS)}`).length - 1, 1)
    assert.equal(src.split(`const upTimeout = ${JSON.stringify(REPLACEMENT_UP_TIMEOUT_MS)}`).length - 1, 1)
    assert.equal(src.split(`const nullPortGrace = ${JSON.stringify(NULL_PORT_GRACE_MS)}`).length - 1, 1)
    assert.equal(src.split(`const heldGrace = ${JSON.stringify(PORT_HELD_GRACE_MS)}`).length - 1, 1)
    assert.equal(src.split('const pid = 4242').length - 1, 1)
    assert.equal(src.split('starting anyway').length - 1, 0)
    assert.equal(src.split('Date.now() + 20000').length - 1, 0)
    assert.equal(src.split('Date.now() + 30000').length - 1, 0)
  })
})

describe('scheduleRestart helper 分支接线（issue #48/#50）', () => {
  it('helper 源码携带真实 pid 与 windowsHide；500ms kill 定时器照常', () => {
    const timer = fakeTimer()
    const killed = []
    let spawned = null
    const result = scheduleRestart(3081, {
      pid: 4242,
      uid: 1039,
      // 无 .service 结尾段 → systemdRestartArgv 返回 null；无 appExit → managed false → 落 detached-helper 分支
      cgroup: '0::/user.slice/user-1039.slice/user@1000.service/app.slice/plain.slice',
      env: {},
      setTimeout: timer.setTimeout,
      kill: (p, sig) => killed.push([p, sig]),
      nodeExecutable: () => '/usr/bin/node',
      restartLaunch: () => ({ file: 'dsh', args: [], cwd: '/c', viaShell: false }),
      spawn(file, args, options) {
        spawned = { file, args, options }
        return { pid: 8000, unref() {}, once() {} }
      },
    })
    assert.equal(result.via, 'helper')
    assert.equal(result.helperPid, 8000)
    assert.ok(spawned, 'detached helper 已 spawn')
    assert.equal(spawned.file, '/usr/bin/node')
    assert.equal(spawned.args[0], '-e')
    const src = spawned.args[1]
    assert.equal(src.split('const pid = 4242').length - 1, 1)
    assert.equal(src.split('"windowsHide":true').length - 1, 1)
    assert.equal(spawned.options.detached, true)
    assert.deepEqual(killed, [])
    timer.timers.at(-1).fn()
    assert.deepEqual(killed, [[4242, 'SIGTERM']])
  })
})
