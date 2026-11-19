/**
 * issue #79：座位注册必须返回 `ctx.slots.inject` 的 disposer——`configForms.whileServed`
 * 是边缘触发闩锁（`off = register(served)`，返回值非空才停止重跑），花括号形态丢掉
 * return 会让闩锁永不生效：`dshm` 被 serve 期间的每次 settings 镜像通知都重新 inject，
 * 同 key "dsh-m" 同优先级 0 撞宿主 keyed 槽位去重 → 同步 throw，被 client-store 的
 * subscriber 包装捕获成 `[client-store] subscriber failed` 控制台 error（功能无损）。
 *
 * 夹具为宿主契约镜像（逐字段对照生产调用点，不额外注入内层缺省对象）：
 * - whileServed 闩锁语义：@deepseek-ai/dsh-client-ui-settings 0.2.2-rc.5 src/client/config-form.ts L308-327；
 * - slots.inject 契约：@deepseek-ai/dsh-cordis-client-runner 0.2.2-rc.5 api-catalog.ts L253-257
 *   （槽位已声明时同步执行 callback；返回幂等 disposer 撤「等待 + 已生效效果」；callback 装配失败同步抛）；
 * - SlotCore.register keyed 去重：@deepseek-ai/dsh-web-frontend rc.5 内置 ui-slots 包
 *   （同 key + 同优先级（缺省 0）即 throw，register 返回撤销函数）。
 * 本地复现取证：.dsh-research/issue79-repro/（活体 CDP 堆栈 + 节点级 harness，8/8 PASS）。
 *
 * 运行：npm test 自动发现；单文件 `node --test tests/agent-card-seat.test.mjs`。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dir = join(root, 'src/client')
const outDir = join(root, 'node_modules', '.dshm')
mkdirSync(outDir, { recursive: true })
const entry = join(dir, '.seat-test-entry.jsx')
const out = join(outDir, 'agent-card-seat.cjs')
try {
  writeFileSync(entry, 'module.exports = require("./agent-integration-card.jsx");\n')
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: out,
    external: ['react'],
    loader: { '.jsx': 'jsx' },
    logLevel: 'silent',
  })
} finally {
  rmSync(entry, { force: true })
}
const require2 = createRequire(import.meta.url)
const { registerAgentIntegrationCard } = require2(out)

/** 宿主契约镜像：settings describe 镜像 + slots 服务 + configForms + cordis ctx 三面桩。 */
function makeFixture() {
  const mirrorSubs = new Set()
  // 快照形态镜像生产：SettingsDescribeMirror 快照 = { view: { namespaces } }（rc.5 settings-mirror）
  let mirrorView = { view: { namespaces: [{ ns: 'dshm' }] } }
  const mirror = {
    getSnapshot: () => mirrorView,
    subscribe(fn) { mirrorSubs.add(fn); return () => { mirrorSubs.delete(fn) } },
    ensure: () => Promise.resolve(),
    setServed(served) { mirrorView = { view: { namespaces: served ? [{ ns: 'dshm' }] : [] } } },
    emit() { for (const fn of [...mirrorSubs]) fn() },
  }
  const entries = []
  const calls = { inject: 0, register: 0 }
  const slots = {
    register(options, component) {
      calls.register += 1
      const priority = options.priority ?? 0
      if (entries.some((e) => e.options.key === options.key && (e.options.priority ?? 0) === priority)) {
        throw new Error(`keyed slot "${options.name}" already has an entry for key "${options.key}" at priority ${priority}`)
      }
      const entry = { options: { ...options }, component }
      entries.push(entry)
      return () => {
        const i = entries.indexOf(entry)
        if (i >= 0) entries.splice(i, 1)
      }
    },
    inject(_slotName, callback) {
      calls.inject += 1
      let effectOff = null
      let disposed = false
      const off = callback()
      if (disposed) { if (typeof off === 'function') off(); return () => {} }
      effectOff = typeof off === 'function' ? off : null
      return () => {
        if (disposed) return
        disposed = true
        if (effectOff) effectOff()
      }
    },
  }
  const controller = {
    getSnapshot: () => ({ status: 'loading', value: {} }),
    subscribe: () => () => {},
    set: () => Promise.resolve(true),
  }
  const forms = {
    get: () => controller,
    // verbatim 语义：rc.5 config-form.ts L308-327（闩锁 + 摘 serve 撤销）
    whileServed(namespaces, register) {
      let off
      const sync = () => {
        const served = new Set(mirror.getSnapshot().view?.namespaces.map((v) => v.ns) ?? [])
        const watched = namespaces.some((ns) => served.has(ns))
        if (watched && off === undefined) off = register(served)
        else if (!watched && off !== undefined) {
          off()
          off = undefined
        }
      }
      const unsubscribe = mirror.subscribe(sync)
      void mirror.ensure()
      sync()
      return () => {
        unsubscribe()
        off?.()
        off = undefined
      }
    },
  }
  const ctx = {
    inject(_deps, cb) { cb({ configForms: forms }) },
    effect(cb, _name) {
      const off = cb()
      return () => { if (typeof off === 'function') off() }
    },
    slots,
  }
  return { ctx, mirror, entries, calls }
}

describe('registerAgentIntegrationCard 座位闩锁（issue #79）', () => {
  it('座位回调返回 inject disposer：镜像重复通知不重注册（红驱动）', () => {
    const f = makeFixture()
    registerAgentIntegrationCard(f.ctx)
    assert.equal(f.calls.register, 1, '首次 serve 注册一次')
    f.mirror.emit()
    f.mirror.emit()
    f.mirror.emit()
    assert.equal(f.calls.inject, 1, `inject 应只调用一次，实测 ${f.calls.inject} 次（闩锁未生效即重触发）`)
    assert.equal(f.calls.register, 1, `register 应只调用一次，实测 ${f.calls.register} 次（同 key 同优先级重注册在真宿主会 throw）`)
    assert.equal(f.entries.length, 1, '座位条目始终只有一份')
  })

  it('注册参数钉死：keyed 槽位 key=dsh-m、locale=dshm、缺省优先级（现状即绿的负向锚）', () => {
    const f = makeFixture()
    registerAgentIntegrationCard(f.ctx)
    assert.equal(f.entries.length, 1)
    const options = f.entries[0].options
    assert.equal(options.name, 'plugins.bundle.config')
    assert.equal(options.key, 'dsh-m')
    assert.equal(options.locale, 'dshm')
    assert.equal(options.priority, undefined, '不显式给优先级（缺省 0，语义与 0.12.15 落地时一致）')
  })

  it('摘 serve 撤座位、重 serve 重挂（返回值经 whileServed 正确交接）', () => {
    const f = makeFixture()
    registerAgentIntegrationCard(f.ctx)
    assert.equal(f.entries.length, 1)
    f.mirror.setServed(false)
    f.mirror.emit()
    assert.equal(f.entries.length, 0, '摘 serve 后座位应被撤销（disposer 交接生效）')
    f.mirror.setServed(true)
    f.mirror.emit()
    assert.equal(f.entries.length, 1, '重新 serve 后重挂')
    assert.equal(f.calls.register, 2, '撤销后的重注册是合法的第二次 register（同 key 不同期不冲突）')
  })
})
