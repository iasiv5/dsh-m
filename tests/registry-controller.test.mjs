/**
 * Task 5：registry-controller 配置事务（bootstrap/apply/外部 watch/回滚/generation/dispose）。
 * 运行：npm run build && node --test tests/registry-controller.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, rmSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'

import { createRegistryController, readAcceptedSourceMetadata } from '../lib/core/registry-controller.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

function localRegistryFile(dir, name, ids) {
  const file = join(dir, name)
  writeFileSync(file, JSON.stringify({ version: 1, plugins: ids.map(entry) }, null, 2))
  return file
}

function fakeStore(initial = {}) {
  let value = { ...initial }
  const watchers = []
  const updates = []
  let failUpdates = false
  const store = {
    get: () => ({ ...value }),
    update: async (patch) => {
      if (failUpdates) throw new Error('settings 写入失败（模拟）')
      updates.push({ ...patch })
      value = { ...value, ...patch }
      for (const w of watchers) queueMicrotask(() => w({ ...value }, { ...value }))
    },
    watch: (cb) => {
      watchers.push(cb)
      return () => {
        const i = watchers.indexOf(cb)
        if (i >= 0) watchers.splice(i, 1)
      }
    },
  }
  return {
    store,
    updates,
    failNextUpdates: () => {
      failUpdates = true
    },
    externalWrite: (patch) => {
      value = { ...value, ...patch }
      for (const w of watchers) queueMicrotask(() => w({ ...value }, { ...value }))
    },
  }
}

async function deadPort() {
  const server = createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  await new Promise((r) => server.close(r))
  return `http://127.0.0.1:${port}/registry.json`
}

let cacheRoot = ''
beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'dshm-ctrl-'))
  process.env.DSHM_CACHE_DIR = cacheRoot
})
afterEach(() => {
  delete process.env.DSHM_CACHE_DIR
  if (cacheRoot) rmSync(cacheRoot, { recursive: true, force: true })
})

describe('registry-controller：bootstrap', () => {
  it('attach 后 snapshot 等待首次加载，默认配置进入 ready', async () => {
    const fs = fakeStore()
    const controller = createRegistryController({})
    controller.attachStore(fs.store)
    const snap = await controller.snapshot()
    assert.equal(snap.configStatus, 'ready')
    assert.equal(snap.activeConfigAddress, '')
    assert.equal(snap.configuredAddress, '')
    assert.ok(snap.loaded.registry)
    assert.ok(Array.isArray(snap.loaded.registry.plugins))
    controller.dispose()
  })

  it('初始 custom 可达 → ready 且 loaded 描述 custom', async () => {
    const file = localRegistryFile(cacheRoot, 'custom.json', [1, 2])
    const fs = fakeStore({ registryUrl: file })
    const controller = createRegistryController({ registryUrl: file })
    controller.attachStore(fs.store)
    const snap = await controller.snapshot()
    assert.equal(snap.configStatus, 'ready')
    assert.equal(snap.activeConfigAddress, file)
    assert.equal(snap.loaded.source, 'custom-file')
    assert.equal(snap.loaded.count, 2)
    controller.dispose()
  })

  it('初始 custom 不可达 → 按 accepted metadata 恢复并回滚持久化值', async () => {
    const dead = await deadPort()
    const acceptedFile = localRegistryFile(cacheRoot, 'accepted.json', [7])
    // 预置 accepted metadata 指向 acceptedFile
    mkdirSync(join(cacheRoot, 'host'), { recursive: true })
    const { parseRegistryAddress } = await import('../lib/core/registry.js')
    const addr = parseRegistryAddress(acceptedFile)
    writeFileSync(join(cacheRoot, 'host', 'active-source.json'), JSON.stringify({
      version: 1,
      namespace: 'host',
      configuredAddress: acceptedFile,
      cacheKey: addr.cacheKey,
      savedAt: new Date().toISOString(),
    }))
    const fs = fakeStore({ registryUrl: dead })
    const controller = createRegistryController({ registryUrl: dead })
    controller.attachStore(fs.store)
    const snap = await controller.snapshot()
    assert.equal(snap.configStatus, 'rejected', '持久化的不可达地址被拒绝')
    assert.ok(snap.configErrors.length > 0)
    assert.equal(snap.activeConfigAddress, acceptedFile, 'active 恢复为 accepted 地址')
    assert.equal(snap.loaded.count, 1)
    assert.ok(fs.updates.some((u) => u.registryUrl === acceptedFile), '持久化值被回滚')
    assert.ok(snap.warnings.some((w) => /回滚/.test(w)))
    controller.dispose()
  })

  it('初始 custom 不可达且无 accepted metadata → 恢复默认', async () => {
    const dead = await deadPort()
    const fs = fakeStore({ registryUrl: dead })
    const controller = createRegistryController({ registryUrl: dead })
    controller.attachStore(fs.store)
    const snap = await controller.snapshot()
    assert.equal(snap.activeConfigAddress, '')
    assert.equal(snap.loaded.isDefault, true)
    assert.ok(fs.updates.some((u) => u.registryUrl === ''), '持久化值回滚为空（默认）')
    controller.dispose()
  })
})

describe('registry-controller：apply 事务', () => {
  it('有效 apply：先校验再 update，再切换 active 并 commit', async () => {
    const fileA = localRegistryFile(cacheRoot, 'a.json', [1])
    const fileB = localRegistryFile(cacheRoot, 'b.json', [1, 2, 3])
    const fs = fakeStore({ registryUrl: fileA })
    const controller = createRegistryController({ registryUrl: fileA })
    controller.attachStore(fs.store)
    await controller.snapshot()

    const snap = await controller.apply(fileB)
    assert.equal(snap.applied === undefined, true)
    assert.equal(snap.configStatus, 'ready')
    assert.equal(snap.activeConfigAddress, fileB)
    assert.equal(snap.loaded.count, 3)
    assert.equal(fs.updates.at(-1).registryUrl, fileB)
    // commit 后旧 A cache 被清理
    assert.ok(!existsSync(join(cacheRoot, 'host', 'active-source.json')) === false)
    controller.dispose()
  })

  it('空地址 apply 恢复默认', async () => {
    const file = localRegistryFile(cacheRoot, 'a.json', [1])
    const fs = fakeStore({ registryUrl: file })
    const controller = createRegistryController({ registryUrl: file })
    controller.attachStore(fs.store)
    await controller.snapshot()
    const snap = await controller.apply('  ')
    assert.equal(snap.activeConfigAddress, '')
    assert.equal(snap.loaded.isDefault, true)
    assert.equal(fs.updates.at(-1).registryUrl, '')
    controller.dispose()
  })

  it('无效地址不 update、抛 RegistryConfigError', async () => {
    const fileA = localRegistryFile(cacheRoot, 'a.json', [1])
    const fs = fakeStore({ registryUrl: fileA })
    const controller = createRegistryController({ registryUrl: fileA })
    controller.attachStore(fs.store)
    await controller.snapshot()
    await assert.rejects(
      () => controller.apply('not-a-valid-address'),
      (err) => err.name === 'RegistryConfigError',
    )
    assert.equal(fs.updates.length, 0, '不写 settings')
    const snap = await controller.snapshot()
    assert.equal(snap.activeConfigAddress, fileA, 'active 保持')
    assert.equal(snap.configStatus, 'rejected')
    controller.dispose()
  })

  it('候选不可达不 update，active/cache/metadata 保持', async () => {
    const fileA = localRegistryFile(cacheRoot, 'a.json', [1])
    const dead = await deadPort()
    const fs = fakeStore({ registryUrl: fileA })
    const controller = createRegistryController({ registryUrl: fileA })
    controller.attachStore(fs.store)
    await controller.snapshot()
    await assert.rejects(() => controller.apply(dead), (err) => err.name === 'RegistryConfigError')
    const snap = await controller.snapshot()
    assert.equal(snap.activeConfigAddress, fileA)
    assert.equal(snap.loaded.source, 'custom-file')
    assert.equal(fs.updates.length, 0)
    controller.dispose()
  })

  it('candidate 成功但 store.update 失败：active 保持旧值并抛错', async () => {
    const fileA = localRegistryFile(cacheRoot, 'a.json', [1])
    const fileB = localRegistryFile(cacheRoot, 'b.json', [1, 2])
    const fs = fakeStore({ registryUrl: fileA })
    const controller = createRegistryController({ registryUrl: fileA })
    controller.attachStore(fs.store)
    await controller.snapshot()
    fs.failNextUpdates()
    await assert.rejects(() => controller.apply(fileB), (err) => err.name === 'RegistryConfigError')
    const snap = await controller.snapshot()
    assert.equal(snap.activeConfigAddress, fileA, 'active 保持 A')
    assert.equal(snap.loaded.count, 1)
    controller.dispose()
  })

  it('两个 apply 交错时最终状态 = 后提交者，旧结果不回写', async () => {
    const fileA = localRegistryFile(cacheRoot, 'a.json', [1])
    const fileB = localRegistryFile(cacheRoot, 'b.json', [1, 2, 3, 4])
    const fs = fakeStore({ registryUrl: '' })
    const controller = createRegistryController({})
    controller.attachStore(fs.store)
    await controller.snapshot()
    const pA = controller.apply(fileA)
    const pB = controller.apply(fileB)
    await Promise.all([pA, pB])
    const snap = await controller.snapshot()
    assert.equal(snap.activeConfigAddress, fileB)
    assert.equal(snap.loaded.count, 4)
    assert.equal(snap.configStatus, 'ready')
    controller.dispose()
  })
})

describe('registry-controller：外部 settings 写入', () => {
  it('外部写入有效地址 → 采纳并切 active', async () => {
    const fileA = localRegistryFile(cacheRoot, 'a.json', [1])
    const fileB = localRegistryFile(cacheRoot, 'b.json', [1, 2])
    const fs = fakeStore({ registryUrl: fileA })
    const controller = createRegistryController({ registryUrl: fileA })
    controller.attachStore(fs.store)
    await controller.snapshot()
    fs.externalWrite({ registryUrl: fileB })
    await sleep(30)
    const snap = await controller.snapshot()
    assert.equal(snap.activeConfigAddress, fileB)
    assert.equal(snap.configStatus, 'ready')
    controller.dispose()
  })

  it('外部写入不可达地址：active/loaded 保持真实来源，持久化回滚，状态 rejected', async () => {
    const fileA = localRegistryFile(cacheRoot, 'a.json', [1])
    const dead = await deadPort()
    const fs = fakeStore({ registryUrl: fileA })
    const controller = createRegistryController({ registryUrl: fileA })
    controller.attachStore(fs.store)
    await controller.snapshot()
    fs.externalWrite({ registryUrl: dead })
    await sleep(30)
    const snap = await controller.snapshot()
    assert.equal(snap.configStatus, 'rejected')
    assert.ok(snap.configErrors.length > 0)
    assert.equal(snap.pendingAddress, null, '回滚后无 pending')
    assert.equal(snap.activeConfigAddress, fileA, 'active 保持')
    assert.equal(snap.loaded.source, 'custom-file', 'loaded 是 A 的真实来源')
    assert.equal(snap.loaded.status, 'ready')
    assert.ok(fs.updates.some((u) => u.registryUrl === fileA), '持久化回滚到 accepted')
    controller.dispose()
  })

  it('外部写入与自身写入不会形成 rollback 循环', async () => {
    const fileA = localRegistryFile(cacheRoot, 'a.json', [1])
    const fs = fakeStore({ registryUrl: fileA })
    const controller = createRegistryController({ registryUrl: fileA })
    controller.attachStore(fs.store)
    await controller.snapshot()
    const updatesBefore = fs.updates.length
    fs.externalWrite({ registryUrl: fileA })
    await sleep(30)
    assert.equal(fs.updates.length - updatesBefore, 0, '同值外部写入不触发回滚')
    controller.dispose()
  })
})

describe('registry-controller：dispose 与辅助方法', () => {
  it('dispose 后 apply 拒绝，watch 事件不再改变状态', async () => {
    const fileA = localRegistryFile(cacheRoot, 'a.json', [1])
    const fs = fakeStore({ registryUrl: fileA })
    const controller = createRegistryController({ registryUrl: fileA })
    controller.attachStore(fs.store)
    await controller.snapshot()
    controller.dispose()
    await assert.rejects(() => controller.apply(''), (err) => /disposed/.test(err.message))
    const before = await controller.snapshot()
    fs.externalWrite({ registryUrl: '' })
    await sleep(30)
    const after = await controller.snapshot()
    assert.equal(after.activeConfigAddress, before.activeConfigAddress)
  })

  it('loadDefault 不改变 active 配置', async () => {
    const fileA = localRegistryFile(cacheRoot, 'a.json', [1])
    const controller = createRegistryController({ registryUrl: fileA })
    const loaded = await controller.loadDefault()
    assert.equal(loaded.isDefault, true)
    const snap = await controller.snapshot()
    assert.equal(snap.activeConfigAddress, fileA)
  })

  it('readAcceptedSourceMetadata 缺失/损坏返回 null', async () => {
    assert.equal(await readAcceptedSourceMetadata(), null)
    mkdirSync(join(cacheRoot, 'host'), { recursive: true })
    writeFileSync(join(cacheRoot, 'host', 'active-source.json'), '{broken')
    assert.equal(await readAcceptedSourceMetadata(), null)
  })
})
