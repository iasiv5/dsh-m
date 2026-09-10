/**
 * DSH self-restart contract tests.
 *
 * DSH 0.1.2-rc.1 and 0.1.5-rc.1 both publish dsh-cmdline's appExit hook;
 * managed hosts must use that hook instead of guessing a release-specific unit.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MANAGED_RESTART_EXIT_CODE,
  appExitFromContext,
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
