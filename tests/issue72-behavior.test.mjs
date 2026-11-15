/**
 * issue #72 行为回归：包内补丁位于 dsh.bundle.patch 自定义路径（cc-safety-net 2.7.13 形态）时
 * ①已启用插件被市场显示为未启用（patchRows 退化为空 → enablement 归属落空）；
 * ②委派复读/行覆盖清理恒 miss（pluginManager 行 moduleName 是 file:// URL，`=== pkg` 永假）；
 * ③install-guard 壳豁免误拦 + id 冲突漏检（守卫只读根级 cordis.patch.yml）；
 * ④bundle 身份观察误报 no-patch-layer。
 * 官方口径锚（本机 app.asar @deepseek-ai/dsh-app-boot/lib/index.js bundlePatchFiles 实测）：
 * dsh.bundle.patch = string | string[]（相对包目录）；未声明的 bundle 被 loader 整体 skip。
 * desktop/web 双形态同构（profile 只是参数）：临时 profile 目录夹具覆盖两形态共享代码；
 * file:// URL 夹具用 pathToFileURL(真实临时路径) 构造，Windows 本机与 ubuntu CI 双侧可跑。
 * 运行：npm run build && node --test tests/issue72-behavior.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'

import { listInstalledPlugins } from '../lib/core/installed.js'
import { composeEnablement } from '../lib/core/enablement.js'
import { togglePlugin } from '../lib/core/toggle.js'
import { verifyInstalledAdditions } from '../lib/core/install-guard.js'
import { runProfileTransaction } from '../lib/core/profile-transaction.js'

// toggle 直调以 'external' 兜底落外部操作日志——隔离 journal（toggle.test.mjs 同款纪律）
process.env.DSHM_EXTERNAL_JOURNAL_FILE = join(mkdtempSync(join(tmpdir(), 'dshm-issue72-journal-')), 'external-operations.json')

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dshm-issue72-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 装 cc-safety-net 形态包：dsh.bundle.patch 声明自定义路径，补丁文件在包内深层目录。 */
function installCustomPathPkg(pkg, { insertId, insertName = './index.js', patchRel = './dist/deepseek-harness/cordis.patch.yml' } = {}) {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'profile', private: true, dependencies: { [pkg]: '2.7.13' } }),
  )
  const pkgDir = join(dir, 'node_modules', pkg)
  const patchAbs = join(pkgDir, patchRel)
  mkdirSync(join(patchAbs, '..'), { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name: pkg,
    version: '2.7.13',
    dsh: { bundle: { patch: patchRel } },
  }))
  writeFileSync(patchAbs, `- insert: [{id: ${insertId ?? pkg}, name: ${insertName}}]\n`)
  return pkgDir
}

describe('issue #72：installed patchRows 按 dsh.bundle.patch 声明解析', () => {
  it('cc-safety-net 形态：声明自定义路径 → patchRows 可读且含 insert id（修复前恒 readable:false）', async () => {
    installCustomPathPkg('cc-safety-net')
    const res = await listInstalledPlugins(dir)
    const item = res.items.find((i) => i.pkg === 'cc-safety-net')
    assert.equal(item.patchRows.readable, true)
    assert.deepEqual(item.patchRows.inserts, [{ id: 'cc-safety-net', name: './index.js' }])
  })

  it('string[] 多文件声明 → inserts 按声明序拼接、configRows 求和', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { 'pkg-multi': '1.0.0' } }))
    const pkgDir = join(dir, 'node_modules', 'pkg-multi')
    mkdirSync(join(pkgDir, 'dist', 'a'), { recursive: true })
    mkdirSync(join(pkgDir, 'dist', 'b'), { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'pkg-multi', dsh: { bundle: { patch: ['./dist/a/p.yml', './dist/b/p.yml'] } } }))
    writeFileSync(join(pkgDir, 'dist', 'a', 'p.yml'), '- insert: [{id: row-a}]\n- id: cfg-a\n  config: {x: 1}\n')
    writeFileSync(join(pkgDir, 'dist', 'b', 'p.yml'), '- insert: [{id: row-b, name: ./index.js}]\n')
    const res = await listInstalledPlugins(dir)
    const item = res.items.find((i) => i.pkg === 'pkg-multi')
    assert.deepEqual(item.patchRows, {
      inserts: [{ id: 'row-a' }, { id: 'row-b', name: './index.js' }],
      configRows: 1,
      readable: true,
    })
  })

  it('声明文件缺失 → 全有全无 readable:false（不冒充可读）', async () => {
    installCustomPathPkg('pkg-missing', { patchRel: './dist/gone/cordis.patch.yml' })
    rmSync(join(dir, 'node_modules', 'pkg-missing', 'dist'), { recursive: true, force: true })
    const res = await listInstalledPlugins(dir)
    assert.deepEqual(res.items[0].patchRows, { inserts: [], configRows: 0, readable: false })
  })

  it('未声明 → 回退根级 cordis.patch.yml（历史行为零漂移）', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { 'pkg-legacy': '1.0.0' } }))
    const pkgDir = join(dir, 'node_modules', 'pkg-legacy')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'pkg-legacy', dsh: {} }))
    writeFileSync(join(pkgDir, 'cordis.patch.yml'), '- insert: [{id: legacy-row}]\n')
    const res = await listInstalledPlugins(dir)
    assert.deepEqual(res.items[0].patchRows.inserts, [{ id: 'legacy-row' }])
  })

  it('声明非法类型 → 回退根级（不炸枚举）', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', private: true, dependencies: { 'pkg-bad-decl': '1.0.0' } }))
    const pkgDir = join(dir, 'node_modules', 'pkg-bad-decl')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'pkg-bad-decl', dsh: { bundle: { patch: 42 } } }))
    writeFileSync(join(pkgDir, 'cordis.patch.yml'), '- insert: [{id: root-row}]\n')
    const res = await listInstalledPlugins(dir)
    assert.equal(res.complete, true)
    assert.deepEqual(res.items[0].patchRows.inserts, [{ id: 'root-row' }])
  })

  it('composeEnablement 端到端：issue 原样 loader fixture（name=./index.js、裸 id=包名）→ enabled+active', async () => {
    installCustomPathPkg('cc-safety-net')
    const { items } = await listInstalledPlugins(dir)
    const rows = composeEnablement({
      items,
      loaderEntries: [
        { id: 'include:cc-safety-net', options: { name: './index.js' }, disabled: false, fiber: { state: 2 } },
        { id: 'include:dsh-pet', options: { name: 'dsh-pet' }, disabled: false, fiber: { state: 2 } },
      ],
      bundles: ['cc-safety-net'],
      profileOverrides: [],
    })
    const row = rows.get('cc-safety-net')
    assert.equal(row.enabled, true)
    assert.equal(row.phase, 'active')
  })
})

describe('issue #72：委派复读与行覆盖清理按 file:// 模块路径归属', () => {
  /** 有状态官方服务模拟器（toggle.test.mjs 同款最小形态）。 */
  function mkService(initialRows) {
    const calls = []
    const state = { rows: initialRows.map((r) => ({ ...r })), bundleOn: true }
    const service = {
      async listPlugins() {
        return state.bundleOn ? state.rows.map((r) => ({ ...r })) : []
      },
      async setPluginEnabled(id, enabled) {
        calls.push(['setPluginEnabled', id, enabled])
        const row = state.rows.find((r) => r.entryId === id)
        if (row) row.enabled = enabled
        return { application: 'applied' }
      },
      async setBundleEnabled(name, enabled) {
        calls.push(['setBundleEnabled', name, enabled])
        state.bundleOn = enabled
        return { application: 'applied' }
      },
    }
    return { service, calls }
  }

  it('moduleName 为包目录内 file:// URL → 复读命中 → applied:live（修复前恒 restart-required）', async () => {
    const pkgDir = installCustomPathPkg('cc-safety-net')
    const moduleName = pathToFileURL(join(pkgDir, 'dist', 'deepseek-harness', 'index.js')).href
    const { service, calls } = mkService([{ entryId: 'include:cc-safety-net', moduleName, enabled: true, fiberPhase: 'active' }])
    const res = await togglePlugin('cc-safety-net', false, { profileDir: dir, getService: () => service })
    assert.deepEqual(calls, [['setBundleEnabled', 'cc-safety-net', false]])
    assert.equal(res.applied, 'live')
    assert.equal(res.via, 'delegate')
  })

  it('moduleName 在包目录外 → 行覆盖清理不认领 → 启用后诚实 restart-required', async () => {
    installCustomPathPkg('cc-safety-net')
    const elsewhere = pathToFileURL(join(dir, 'elsewhere', 'index.js')).href
    const { service, calls } = mkService([{ entryId: 'x', moduleName: elsewhere, enabled: false, fiberPhase: null }])
    const res = await togglePlugin('cc-safety-net', true, { profileDir: dir, getService: () => service })
    assert.equal(calls.some(([op]) => op === 'setPluginEnabled'), false, '包外行不得清理')
    assert.equal(res.applied, 'restart-required')
  })

  it('名字型行回归：moduleName 精确等于包名 → 仍命中（零漂移）', async () => {
    installCustomPathPkg('cc-safety-net')
    const { service } = mkService([{ entryId: 'x', moduleName: 'cc-safety-net', enabled: true, fiberPhase: 'active' }])
    const res = await togglePlugin('cc-safety-net', false, { profileDir: dir, getService: () => service })
    assert.equal(res.applied, 'live')
  })

  it('启用路径行覆盖清理认领包内 file:// 行', async () => {
    const pkgDir = installCustomPathPkg('cc-safety-net')
    const inside = pathToFileURL(join(pkgDir, 'index.js')).href
    const { service, calls } = mkService([{ entryId: 'row-1', moduleName: inside, enabled: false, fiberPhase: null }])
    const res = await togglePlugin('cc-safety-net', true, { profileDir: dir, getService: () => service })
    assert.equal(calls.some(([op, id]) => op === 'setPluginEnabled' && id === 'row-1'), true)
    assert.equal(res.applied, 'live')
  })

  it('win32 盘符大小写折叠（NTFS 语义）', { skip: process.platform !== 'win32' }, async () => {
    const pkgDir = installCustomPathPkg('cc-safety-net')
    const url = pathToFileURL(join(pkgDir, 'index.js')).href
    const flipped = url.replace(/^file:\/\/\/([A-Za-z]):/, (_m, d) => `file:///${d === d.toUpperCase() ? d.toLowerCase() : d.toUpperCase()}:`)
    const { service } = mkService([{ entryId: 'x', moduleName: flipped, enabled: true, fiberPhase: 'active' }])
    const res = await togglePlugin('cc-safety-net', false, { profileDir: dir, getService: () => service })
    assert.equal(res.applied, 'live')
  })
})

describe('issue #72：行级降级按 insert id 认领（web/CLI 形态，desktop 禁 fallback 不受影响）', () => {
  it('loader 载体条目（裸 id=insert id、name=./index.js）→ 停用落盘 + 活体翻转 live', async () => {
    installCustomPathPkg('carrier-pkg', { insertId: 'carrier-row' })
    let flipped = false
    const host = { loader: { entries: () => [
      { id: 'include:k:carrier-row', options: { name: './index.js' }, disabled: false, fiber: { state: 2 }, update: async () => { flipped = true } },
    ] } }
    const res = await togglePlugin('carrier-pkg', false, { profileDir: dir, loaderHost: host, io: { readFile } })
    assert.equal(res.applied, 'live')
    assert.equal(flipped, true)
    // 行覆盖落盘在 profile 层 cordis.patch.yml（toggleRowFallback 的编辑目标），非包内补丁；
    // "[]" 追加产出 flow 风格（官方 writePluginEnabled 同款）——语义断言而非格式断言
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    assert.equal(patch.includes('id: carrier-row'), true)
    assert.equal(patch.includes('disabled: true'), true)
  })

  it('名字型条目回归：options.name = 包名 → 仍按名字认领（零漂移）', async () => {
    installCustomPathPkg('named-pkg', { insertId: 'named-row', insertName: 'named-pkg' })
    let flipped = false
    const host = { loader: { entries: () => [
      { id: 'named-row', options: { name: 'named-pkg' }, disabled: false, fiber: { state: 2 }, update: async () => { flipped = true } },
    ] } }
    const res = await togglePlugin('named-pkg', false, { profileDir: dir, loaderHost: host, io: { readFile } })
    assert.equal(res.applied, 'live')
    assert.equal(flipped, true)
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    assert.equal(patch.includes('id: named-row'), true)
    assert.equal(patch.includes('disabled: true'), true)
  })
})

describe('issue #72：install-guard 按声明路径取 insert ids', () => {
  function guardFixture(pkg, { patchRel = './dist/p/cordis.patch.yml', insertId, noEntry = false } = {}) {
    const pkgDir = join(dir, 'node_modules', ...pkg.split('/'))
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: pkg,
      version: '1.0.0',
      ...(noEntry ? {} : { main: 'index.js' }),
      dsh: { bundle: { patch: patchRel } },
    }))
    if (!noEntry) writeFileSync(join(pkgDir, 'index.js'), 'module.exports = {}\n')
    const abs = join(pkgDir, patchRel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, `- insert: [{id: ${insertId ?? pkg + '-id'}, name: ${pkg}}]\n`)
  }

  function setDeps(deps) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'profile', private: true, dependencies: deps }))
  }

  it('壳豁免：无入口 + 声明自定义路径带 insert → 不拦（修复前误判 ENTRY_UNRESOLVABLE）', async () => {
    guardFixture('shell-pkg', { noEntry: true, insertId: 'shell-row' })
    setDeps({ 'shell-pkg': '1.0.0' })
    const r = await verifyInstalledAdditions({ profileDir: dir, addedPkgs: ['shell-pkg'] })
    assert.equal(r.ok, true)
    assert.deepEqual(r.violations, [])
    assert.deepEqual(r.unavailable, [])
  })

  it('id 冲突：已装包声明自定义路径的 id 与新增包冲突 → LOADER_ID_CONFLICT（修复前漏检）', async () => {
    guardFixture('installed-custom', { insertId: 'shared-row' })
    guardFixture('pkg-new', { patchRel: 'cordis.patch.yml', insertId: 'shared-row' })
    setDeps({ 'installed-custom': '1.0.0', 'pkg-new': '2.0.0' })
    const r = await verifyInstalledAdditions({ profileDir: dir, addedPkgs: ['pkg-new'] })
    const conflict = r.violations.find((v) => v.code === 'LOADER_ID_CONFLICT')
    assert.ok(conflict, `violations: ${JSON.stringify(r.violations)} | unavailable: ${JSON.stringify(r.unavailable)}`)
    assert.deepEqual(conflict.conflictingIds, [{ id: 'shared-row', source: 'installed-custom' }])
  })

  it('声明文件缺失 → 无 id 贡献且不报 unavailable（loader skip 同判）', async () => {
    guardFixture('ghost-patch', { patchRel: './dist/gone.yml' })
    rmSync(join(dir, 'node_modules', 'ghost-patch', 'dist'), { recursive: true, force: true })
    setDeps({ 'ghost-patch': '1.0.0' })
    const r = await verifyInstalledAdditions({ profileDir: dir, addedPkgs: ['ghost-patch'] })
    assert.equal(r.unavailable.length, 0)
    assert.deepEqual(r.violations, [])
  })
})

describe('issue #72：bundle 身份观察认声明补丁层（不再误报 no-patch-layer）', () => {
  const sha512 = (tag) => `sha512-${tag}${'A'.repeat(20)}`
  const manifest = (doc) => JSON.stringify(doc, null, 2) + '\n'

  function lockFile({ pkg = 'pkg-a', version = '1.2.3', integrity = sha512('good') } = {}) {
    return `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      ${pkg}:
        specifier: ${version}
        version: ${version}

packages:
  ${pkg}@${version}:
    resolution: {integrity: ${integrity}}
`
  }

  function makeProfile(files) {
    const tdir = mkdtempSync(join(tmpdir(), 'dshm-issue72-tx-'))
    for (const [name, content] of Object.entries(files || {})) writeFileSync(join(tdir, name), content)
    return tdir
  }

  function mockRunner(script = {}) {
    const calls = { add: [], remove: [], frozen: [], rebuild: [] }
    const op = (name) => async (arg, signal) => {
      calls[name].push({ arg, signal })
      const seq = script[name] || []
      const step = seq[Math.min(calls[name].length - 1, seq.length - 1)]
      if (!step) return { class: 'ok', output: `${name}-ok` }
      return await step(arg, signal, calls[name].length)
    }
    return { runner: { add: op('add'), remove: op('remove'), frozenInstall: op('frozen'), rebuildInstall: op('rebuild') }, calls }
  }

  const baseTx = (tdir, runner, extra = {}) => ({ runner: () => runner, profileDir: tdir, retryDelaysMs: [0, 0], ...extra })

  it('声明 dsh.bundle.patch 自定义路径 + 不在 bundles → 无 no-patch-layer 误报', async () => {
    const tdir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile({ pkg: 'existing' }),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const committedAdd = async () => {
      writeFileSync(join(tdir, 'package.json'), manifest({ dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }))
      writeFileSync(join(tdir, 'pnpm-lock.yaml'), lockFile())
      const pkgDir = join(tdir, 'node_modules', 'pkg-a')
      mkdirSync(join(pkgDir, 'dist', 'p'), { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'pkg-a', dsh: { bundle: { patch: './dist/p/cordis.patch.yml' } } }))
      writeFileSync(join(pkgDir, 'dist', 'p', 'cordis.patch.yml'), '- insert: [{id: demo, name: pkg-a}]\n')
      return { class: 'ok', output: 'added', buildApprovals: [], fallbackAllBuilds: false }
    }
    const { runner } = mockRunner({ add: [committedAdd] })
    try {
      const r = await runProfileTransaction(
        { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
        baseTx(tdir, runner),
      )
      assert.equal(r.status, 'committed')
      assert.equal(r.bundleWarning, undefined)
    } finally {
      rmSync(tdir, { recursive: true, force: true })
    }
  })

  it('声明 dsh.bundle.patch 但文件缺失 + 不在 bundles → 仍报 no-patch-layer（空头声明 = 官方 skip 口径，Task 13 marker 同形）', async () => {
    const tdir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile({ pkg: 'existing' }),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const committedAdd = async () => {
      writeFileSync(join(tdir, 'package.json'), manifest({ dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }))
      writeFileSync(join(tdir, 'pnpm-lock.yaml'), lockFile())
      const pkgDir = join(tdir, 'node_modules', 'pkg-a')
      mkdirSync(pkgDir, { recursive: true })
      // 只声明、不写补丁文件（writeInstalledMarkerPkg 的「空头声明」形态）
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'pkg-a', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
      return { class: 'ok', output: 'added', buildApprovals: [], fallbackAllBuilds: false }
    }
    const { runner } = mockRunner({ add: [committedAdd] })
    try {
      const r = await runProfileTransaction(
        { kind: 'install-npm', pkg: 'pkg-a', version: '1.2.3', integrity: sha512('good') },
        baseTx(tdir, runner),
      )
      assert.equal(r.status, 'committed')
      assert.equal(r.bundleWarning, 'no-patch-layer')
    } finally {
      rmSync(tdir, { recursive: true, force: true })
    }
  })
})
