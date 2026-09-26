/**
 * settings-compat：DSH settings 服务双代兼容层（0.1.7-rc.1 / rc.2 新 API vs ≤0.1.5 旧 API）。
 * 运行：npm run build && node --test tests/settings-compat.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeVolatileRef } from './fixtures/volatile-ref.mjs'

import {
  detectSettingsKind,
  isVolatileRef,
  ownEntryId,
  unwrapConfig,
  unwrapValue,
  createFormsRegistryStore,
  createFormsRegistryStoreWithoutNs,
  createLegacyRegistryStore,
  wireRegistrySettings,
} from '../lib/core/settings-compat.js'
import { createRegistryController } from '../lib/core/registry-controller.js'

function entry(i) {
  return {
    id: `plug-${i}`,
    name: `Plug ${i}`,
    description: `entry ${i}`,
    category: 'tools',
    tags: [],
    source: 'npm',
    npm: `pkg-${i}`,
  }
}

function localRegistryFile(ids) {
  const file = join(mkdtempSync(join(tmpdir(), 'dshm-compat-')), 'registry.json')
  writeFileSync(file, JSON.stringify({ version: 1, plugins: ids.map(entry) }, null, 2))
  return file
}

/** 真实协议形态的 Volatile 引用（协议同 cosmokit createVolatile）。 */
function makeRef(value) {
  return makeVolatileRef(value)
}

function fakeCtx({ loaderEntries, fiber } = {}) {
  const handlers = new Map()
  const ctx = {
    fiber,
    on(event, cb) {
      handlers.set(event, cb)
      return () => handlers.delete(event)
    },
    emit(event, ...args) {
      const cb = handlers.get(event)
      if (cb) cb(...args)
    },
  }
  if (loaderEntries) ctx.loader = { entries: () => loaderEntries }
  return ctx
}

function fakeFormsSettings() {
  const updates = []
  return {
    updates,
    describe: () => [],
    update: async (ns, patch) => {
      updates.push({ ns, patch })
    },
  }
}

function fakeLegacyScope(initial = {}) {
  let value = { ...initial }
  const watchers = []
  const fire = () => watchers.forEach((w) => w({ ...value }, { ...value }))
  return {
    scope: {
      get: () => ({ ...value }),
      update: async (patch) => {
        value = { ...value, ...patch }
      },
      watch: (cb) => {
        watchers.push(cb)
        return () => {
          const i = watchers.indexOf(cb)
          if (i >= 0) watchers.splice(i, 1)
        }
      },
    },
    /** 模拟外部变更（经由宿主写入后回放 watch） */
    set(patch) {
      value = { ...value, ...patch }
      fire()
    },
  }
}

describe('unwrapValue / unwrapConfig', () => {
  it('普通值原样通过，Volatile 引用解包为快照', () => {
    assert.equal(unwrapValue('abc'), 'abc')
    assert.equal(unwrapValue(42), 42)
    assert.equal(unwrapValue(undefined), undefined)
    const ref = makeRef('https://example.com/r.json')
    assert.equal(unwrapValue(ref), 'https://example.com/r.json')
  })

  it('isVolatileRef 判定：引用为真，普通对象/原始值为假', () => {
    assert.equal(isVolatileRef(makeRef(1)), true)
    assert.equal(isVolatileRef({ get: () => 1 }), false)
    assert.equal(isVolatileRef(null), false)
    assert.equal(isVolatileRef('x'), false)
  })

  it('unwrapConfig 从带引用的 config 提取 plain 字段，脏值丢弃', () => {
    const cfg = unwrapConfig({
      registryUrl: makeRef('/tmp/registry.json'),
      timeoutMs: makeRef(5000),
      cacheTtlMin: 30,
    })
    assert.deepEqual(cfg, { registryUrl: '/tmp/registry.json', timeoutMs: 5000, cacheTtlMin: 30 })
    assert.deepEqual(unwrapConfig({ registryUrl: 123, timeoutMs: 'x', extra: true }), {})
    assert.deepEqual(unwrapConfig(null), {})
    assert.deepEqual(unwrapConfig(undefined), {})
  })
})

describe('detectSettingsKind', () => {
  it('register 在前判 legacy（老服务不会带 describe/update）', () => {
    assert.equal(detectSettingsKind({ register() {} }), 'legacy')
    assert.equal(detectSettingsKind({ register() {}, describe() {}, update() {} }), 'legacy')
  })

  it('describe+update 判 forms（0.1.7-rc.1 / rc.2 SettingsForms）', () => {
    assert.equal(detectSettingsKind({ describe() {}, update() {} }), 'forms')
  })

  it('残缺/空/非对象形态判 unknown', () => {
    assert.equal(detectSettingsKind({ describe() {} }), 'unknown')
    assert.equal(detectSettingsKind({ update() {} }), 'unknown')
    assert.equal(detectSettingsKind({}), 'unknown')
    assert.equal(detectSettingsKind(null), 'unknown')
    assert.equal(detectSettingsKind(undefined), 'unknown')
    assert.equal(detectSettingsKind('settings'), 'unknown')
  })
})

describe('ownEntryId', () => {
  const fiber = { id: 'fiber-1' }

  it('按 fiber 身份精确匹配本插件条目', () => {
    const ctx = fakeCtx({
      fiber,
      loaderEntries: [
        { options: { id: 'other', name: 'dsh-m', disabled: null }, fiber: { id: 'fiber-2' } },
        { options: { id: 'dshm', name: 'dsh-m', disabled: null }, fiber },
      ],
    })
    assert.equal(ownEntryId(ctx, 'dsh-m'), 'dshm')
  })

  it('fiber 不匹配时回退第一个未禁用的同名条目', () => {
    const ctx = fakeCtx({
      fiber,
      loaderEntries: [
        { options: { id: 'disabled-one', name: 'dsh-m', disabled: true }, fiber: { id: 'x' } },
        { options: { id: 'fallback', name: 'dsh-m', disabled: null }, fiber: { id: 'y' } },
      ],
    })
    assert.equal(ownEntryId(ctx, 'dsh-m'), 'fallback')
  })

  it('无 loader / 名字不匹配 / 异常 entries 返回 undefined', () => {
    assert.equal(ownEntryId(fakeCtx(), 'dsh-m'), undefined)
    assert.equal(
      ownEntryId(fakeCtx({ loaderEntries: [{ options: { id: 'x', name: 'other' } }] }), 'dsh-m'),
      undefined,
    )
    assert.equal(ownEntryId({}, 'dsh-m'), undefined)
    assert.equal(ownEntryId(null, 'dsh-m'), undefined)
  })
})

describe('createFormsRegistryStore（0.1.7-rc.1 / rc.2 新 API）', () => {
  it('get 读引用最新值：loader 原地提交后立即可见', () => {
    const ref = makeRef('file:///old.json')
    const store = createFormsRegistryStore(fakeCtx(), fakeFormsSettings(), 'dshm', { registryUrl: ref })
    assert.deepEqual(store.get(), { registryUrl: 'file:///old.json' })
    // 模拟 loader volatile-commit：写入新快照
    ref[Symbol.for('cosmokit.volatile.write')](makeRef('file:///new.json').get())
    assert.deepEqual(store.get(), { registryUrl: 'file:///new.json' })
  })

  it('update 经 settings.update 落 ns 与 patch', async () => {
    const settings = fakeFormsSettings()
    const store = createFormsRegistryStore(fakeCtx(), settings, 'dshm', {})
    await store.update({ registryUrl: 'https://x.test/r.json' })
    assert.deepEqual(settings.updates, [{ ns: 'dshm', patch: { registryUrl: 'https://x.test/r.json' } }])
  })

  it('watch 订阅 loader/volatile-update，变更推送 next/prev；disposer 生效', () => {
    const ref = makeRef('file:///a.json')
    const ctx = fakeCtx()
    const store = createFormsRegistryStore(ctx, fakeFormsSettings(), 'dshm', { registryUrl: ref })
    const seen = []
    const dispose = store.watch((next, prev) => seen.push([next, prev]))

    ref[Symbol.for('cosmokit.volatile.write')]('file:///b.json')
    ctx.emit('loader/volatile-update', [['registryUrl']])
    assert.deepEqual(seen, [[{ registryUrl: 'file:///b.json' }, { registryUrl: 'file:///a.json' }]])

    dispose()
    ref[Symbol.for('cosmokit.volatile.write')]('file:///c.json')
    ctx.emit('loader/volatile-update', [['registryUrl']])
    assert.equal(seen.length, 1)
  })

  it('ctx 无 on 时 watch 返回 noop disposer 不抛', () => {
    const store = createFormsRegistryStore({}, fakeFormsSettings(), 'dshm', {})
    const dispose = store.watch(() => {})
    assert.doesNotThrow(() => dispose())
  })
})

describe('createFormsRegistryStoreWithoutNs（ns 缺失只读降级）', () => {
  it('get/watch 仍可用，update 拒绝并带说明', async () => {
    const ctx = fakeCtx()
    const store = createFormsRegistryStoreWithoutNs(ctx, { registryUrl: '/tmp/r.json' }, 'loader 中未找到本插件条目')
    assert.deepEqual(store.get(), { registryUrl: '/tmp/r.json' })
    await assert.rejects(() => store.update({ registryUrl: 'x' }), /loader 中未找到本插件条目/)
    const seen = []
    store.watch((next) => seen.push(next))
    ctx.emit('loader/volatile-update', [])
    assert.deepEqual(seen, [{ registryUrl: '/tmp/r.json' }])
  })
})

describe('createLegacyRegistryStore（≤0.1.5 旧 API）', () => {
  it('get/watch 出站值统一解包（防御混合形态引用）', () => {
    const scope = fakeLegacyScope({ registryUrl: makeRef('/tmp/r.json'), timeoutMs: 20 })
    const store = createLegacyRegistryStore(scope.scope)
    assert.deepEqual(store.get(), { registryUrl: '/tmp/r.json', timeoutMs: 20 })
    const seen = []
    store.watch((next) => seen.push(next))
    scope.set({ registryUrl: makeRef('/tmp/r2.json') })
    assert.deepEqual(seen, [{ registryUrl: '/tmp/r2.json', timeoutMs: 20 }])
  })

  it('update 透传 patch', async () => {
    const scope = fakeLegacyScope()
    const store = createLegacyRegistryStore(scope.scope)
    await store.update({ registryUrl: 'file:///tmp/r.json' })
    assert.equal(scope.scope.get().registryUrl, 'file:///tmp/r.json')
  })
})

describe('wireRegistrySettings × createRegistryController 集成', () => {
  it('forms 形态（0.1.7）：volatile 引用初始值进 bootstrap，写经 settings.update，外部提交经事件采纳', async () => {
    const fileA = localRegistryFile([1, 2])
    const fileB = localRegistryFile([1, 2, 3])
    const ref = makeRef(fileA)
    const ctx = fakeCtx({
      fiber: { id: 'f' },
      loaderEntries: [{ options: { id: 'dshm', name: 'dsh-m', disabled: null }, fiber: { id: 'f' } }],
    })
    const settings = fakeFormsSettings()
    const controller = createRegistryController(unwrapConfig({ registryUrl: ref }))

    const outcome = wireRegistrySettings({
      ctx,
      settings,
      schema: {},
      parsedConfig: { registryUrl: ref },
      packageName: 'dsh-m',
      attachStore: (store) => controller.attachStore(store),
    })
    assert.equal(outcome, 'forms')

    // bootstrap：初始地址来自引用快照
    await controller.ensureReady()
    const snap1 = await controller.snapshot()
    assert.equal(snap1.configStatus, 'ready')
    assert.equal(snap1.loaded.count, 2)

    // 控制器 apply（客户端设置页路径）：写经 settings.update 落 ns
    await controller.apply(fileB)
    assert.deepEqual(settings.updates, [{ ns: 'dshm', patch: { registryUrl: fileB } }])

    // 外部变更（DSH 设置页写入 → loader 提交引用 + 事件）：控制器采纳新地址
    ref[Symbol.for('cosmokit.volatile.write')](fileA)
    ctx.emit('loader/volatile-update', [['registryUrl']])
    // 外部 watch 是异步入队的，轮询等采纳完成
    let snap2 = await controller.snapshot()
    for (let i = 0; i < 50 && snap2.loaded.count !== 2; i++) {
      await new Promise((r) => setTimeout(r, 10))
      snap2 = await controller.snapshot()
    }
    assert.equal(snap2.loaded.count, 2)
    assert.equal(snap2.configStatus, 'ready')
  })

  it('legacy 形态（≤0.1.5）：register 接线不变，外部 set 走 watch 采纳', async () => {
    const fileA = localRegistryFile([1])
    const fileB = localRegistryFile([1, 2, 3, 4])
    const legacy = fakeLegacyScope({ registryUrl: fileA })
    const controller = createRegistryController({})
    const registered = []
    const outcome = wireRegistrySettings({
      ctx: {},
      settings: {
        register: (ns, schema, opts) => {
          registered.push({ ns, schema, opts })
          return legacy.scope
        },
      },
      schema: { marker: 'Config schema' },
      parsedConfig: {},
      packageName: 'dsh-m',
      attachStore: (store) => controller.attachStore(store),
    })
    assert.equal(outcome, 'legacy')
    assert.deepEqual(registered.map((r) => r.ns), ['dshm'])
    assert.deepEqual(registered.map((r) => r.opts), [{ base: {}, applies: 'live' }])

    await controller.ensureReady()
    assert.equal((await controller.snapshot()).loaded.count, 1)

    legacy.set({ registryUrl: fileB })
    await new Promise((r) => setTimeout(r, 10))
    const snap = await controller.snapshot()
    assert.equal(snap.loaded.count, 4)
  })

  it('forms 但 loader 无条目：接只读降级 store，bootstrap 仍走引用值', async () => {
    const fileA = localRegistryFile([1, 2])
    const ref = makeRef(fileA)
    const warnings = []
    const controller = createRegistryController(unwrapConfig({ registryUrl: ref }))
    let attached = null
    const outcome = wireRegistrySettings({
      ctx: fakeCtx(),
      settings: fakeFormsSettings(),
      schema: {},
      parsedConfig: { registryUrl: ref },
      packageName: 'dsh-m',
      logger: { warn: (...args) => warnings.push(args.join(' ')) },
      attachStore: (store) => {
        attached = store
      },
    })
    assert.equal(outcome, 'forms-without-ns')
    assert.notEqual(attached, null)
    assert.match(warnings.join(' '), /loader 中未找到本插件条目/)
    await controller.ensureReady()
    assert.equal((await controller.snapshot()).loaded.count, 2)
    await assert.rejects(() => attached.update({ registryUrl: 'x' }), /无法持久化/)
  })

  it('unknown 形态：不 attach、不抛、只 warn', () => {
    const warnings = []
    let attached = 'not-called'
    const outcome = wireRegistrySettings({
      ctx: {},
      settings: {},
      schema: {},
      parsedConfig: {},
      packageName: 'dsh-m',
      logger: { warn: (...args) => warnings.push(args.join(' ')) },
      attachStore: (store) => {
        attached = store
      },
    })
    assert.equal(outcome, 'unknown')
    assert.equal(attached, 'not-called')
    assert.match(warnings.join(' '), /形态未识别/)
  })
})

describe('host Config schema 的 volatile 标记（环境自适应）', () => {
  it('schemastery 有 .volatile 时三个字段全标记；没有时保持普通字段', async () => {
    const host = await import('../lib/host.js')
    const Schema = (await import('@deepseek-ai/schemastery')).default
    const hasVolatile = typeof Schema.prototype.volatile === 'function'
    const dict = host.Config.dict ?? host.Config
    const fields = ['registryUrl', 'timeoutMs', 'cacheTtlMin']
    for (const key of fields) {
      const marked = Boolean(dict[key]?.meta?.volatile ?? dict[key]?.extra?.volatile)
      assert.equal(marked, hasVolatile, `字段 ${key} 的 volatile 标记应与 schemastery 能力一致`)
    }
    assert.equal(typeof host.apply, 'function')
    assert.deepEqual(host.inject, ['tools'])
    assert.equal(host.name, 'dshm')
  })
})
