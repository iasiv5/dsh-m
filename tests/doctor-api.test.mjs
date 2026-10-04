/**
 * Doctor Day1（ADR-0010）Task 6：/dshm `doctor` method 接线。
 * 照 tests/host-api.test.mjs 先例：createApiDispatcher + mock req/res + 注入 profile.dir，
 * 直测真实 runDoctor（测试进程 runtimeVersion 必为 null——正好覆盖降级路径，评审 R2.1 分工）。
 * 运行：npm run build && node --test tests/doctor-api.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createApiDispatcher } from '../lib/core/host-api.js'
import { createRegistryController } from '../lib/core/registry-controller.js'

const ORIGIN = 'http://127.0.0.1:3080'

function mockReq(body) {
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = '/dshm'
  req.headers = { 'content-type': 'application/json', origin: ORIGIN, host: '127.0.0.1:3080' }
  req.resume = () => {}
  queueMicrotask(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

function mockRes() {
  const res = new EventEmitter()
  res.statusCode = null
  res.bodyText = ''
  res.writeHead = (status) => {
    res.statusCode = status
  }
  res.end = (text) => {
    res.bodyText = text ?? ''
  }
  return res
}

async function callDoctor(profileDir) {
  const dispatcher = createApiDispatcher({
    controller: createRegistryController({}),
    pkg: { name: 'dsh-m', version: '0.0.0-test' },
    profile: { name: 'web', kind: 'web', dir: profileDir, source: 'fallback' },
    deps: { rejectRequest: () => undefined },
  })
  const res = mockRes()
  await dispatcher(mockReq({ method: 'doctor' }), res)
  return { status: res.statusCode, body: JSON.parse(res.bodyText) }
}

describe('doctor method', () => {
  let home, profile
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dshm-docapi-'))
    profile = join(home, 'profiles', 'web')
    mkdirSync(join(profile, 'node_modules'), { recursive: true })
    mkdirSync(join(home, 'node_modules', '@deepseek-ai'), { recursive: true })
    process.env.DSH_HOME = home
  })
  afterEach(() => {
    delete process.env.DSH_HOME
    rmSync(home, { recursive: true, force: true })
  })

  it('响应信封 { ok:true, report } 且 report 为完整 DoctorReport（对 fixture profile 真跑）', async () => {
    writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')
    symlinkSync(join(home, 'gone'), join(home, 'node_modules', '@deepseek-ai', 'dsh-x')) // 1 悬空
    writeFileSync(join(profile, 'package.json.bak-20260903'), '{}') // 1 残留
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: {} }))
    const { status, body } = await callDoctor(profile)
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.report.schema, 'dsh-m/doctor/v1')
    assert.equal(body.report.profileDir, profile)
    assert.equal(body.report.layout, 'hoisted')
    assert.equal(body.report.summary.errors, 1)
    assert.equal(body.report.summary.farmChecked, 1)
    assert.equal(body.report.summary.farmDangling, 1)
    assert.equal(body.report.summary.residueCount, 1)
    // 测试进程（node --test）非 dsh launcher → runtimeVersion 必 null——降级路径覆盖（评审 R2.1）
    assert.equal(body.report.runtimeVersion, null)
    assert.ok(body.report.summary.unknowns.some((u) => u.includes('stale')))
  })

  it('空 profile（无 farm/残留/依赖）→ errors=0 信封正常', async () => {
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: {} }))
    const { status, body } = await callDoctor(profile)
    assert.equal(status, 200)
    assert.equal(body.report.summary.errors, 0)
    assert.equal(body.report.dualMarket, null)
  })

  it('desktop-kind active profile：doctor method 免改生效（active-profile 无关钉子，ADR-0011）', async () => {
    const desk = join(home, 'profiles', 'desktop')
    mkdirSync(join(desk, 'node_modules', 'some-pkg'), { recursive: true })
    writeFileSync(join(desk, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')
    writeFileSync(join(desk, 'package.json'), JSON.stringify({ dependencies: { 'some-pkg': '1.0.0' } }))
    writeFileSync(join(desk, 'node_modules', 'some-pkg', 'package.json'), JSON.stringify({ name: 'some-pkg', version: '1.0.0' }))
    const dispatcher = createApiDispatcher({
      controller: createRegistryController({}),
      pkg: { name: 'dsh-m', version: '0.0.0-test' },
      profile: { name: 'desktop', kind: 'desktop', dir: desk, source: 'host' },
      deps: { rejectRequest: () => undefined },
    })
    const res = mockRes()
    await dispatcher(mockReq({ method: 'doctor' }), res)
    const body = JSON.parse(res.bodyText)
    assert.equal(res.statusCode, 200)
    assert.equal(body.ok, true)
    assert.equal(body.report.profileDir, desk)
    assert.equal(body.report.layout, 'hoisted')
    assert.equal(body.report.summary.accountChecked, 1)
  })
})
