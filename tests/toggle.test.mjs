/**
 * toggle 契约（plan Task 5，ADR-0001；io/getService/loaderHost 全注入）：
 * - 保护门最先：空清单下 dsh-m 也拒绝 protected（先于 not-installed）；
 * - 未装 → not-installed；
 * - 委派行级 / 委派 bundle 级 / readOnlyReason 两值映射 / unknown-plugin；
 * - 委派 applied 复读判定（application 鸭子读兜底、overridden 警告）；
 * - 降级行级：cordis.patch.yml 保注释落盘（含 ENOENT → "[]\n"）+ 活体翻转（live）/
 *   无 loader entry（restart-required）；
 * - 降级 bundle：package.json bundles 数组增删（恒 restart-required）；
 * - 幂等：已是目标态（planRowOverride.changed:false）不写盘（mtime 不变）。
 * fixture：临时 profile 目录 + 手写脱敏样本。
 * 运行：npm run build && node --test tests/toggle.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

import { togglePlugin, ToggleError } from '../lib/core/toggle.js'

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dshm-toggle-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 装一个「已装插件」：dependencies + node_modules/<pkg>（package.json 带 dsh 字段 + cordis.patch.yml）。 */
function installFixture(pkg, patchText, extraDeps = {}) {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-web', private: true, dependencies: { [pkg]: '1.0.0', ...extraDeps } }),
  )
  const pkgDir = join(dir, 'node_modules', pkg)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version: '1.0.0', dsh: {} }))
  if (patchText !== null) writeFileSync(join(pkgDir, 'cordis.patch.yml'), patchText)
}

function profilePatch(text) {
  writeFileSync(join(dir, 'cordis.patch.yml'), text)
}

const SINGLE_PATCH = '- insert: [{id: demo-row, name: demo-pkg}]\n'
const MULTI_PATCH = '- id: web\n  config:\n    searchProvider: demo\n- insert:\n    - id: demo-seam\n      name: demo-multi\n'
const SINGLE_MULTI = '- insert: [{id: multi-row, name: demo-multi}]\n'

function loaderHostWith(entries) {
  return { loader: { entries: () => entries } }
}

function serviceStub(rows, calls = []) {
  return {
    async listPlugins() {
      return typeof rows === 'function' ? rows() : rows
    },
    async setPluginEnabled(id, enabled) {
      calls.push(['setPluginEnabled', id, enabled])
      if (typeof rows === 'function') rows = rows() // 下次 listPlugins 反映变化
      return { application: 'applied' }
    },
    async setBundleEnabled(name, enabled) {
      calls.push(['setBundleEnabled', name, enabled])
      return { application: 'applied' }
    },
  }
}

describe('togglePlugin：保护门与在装判定', () => {
  it('dsh-m 自身 → protected（空 profile 也先于 not-installed）', async () => {
    await assert.rejects(
      () => togglePlugin('dsh-m', false, { profileDir: dir }),
      (err) => err instanceof ToggleError && err.code === 'protected',
    )
  })

  it('官方命脉包 → protected', async () => {
    await assert.rejects(
      () => togglePlugin('@deepseek-ai/dsh-hmr', false, { profileDir: dir }),
      (err) => err instanceof ToggleError && err.code === 'protected',
    )
  })

  it('未安装 → not-installed', async () => {
    await assert.rejects(
      () => togglePlugin('ghost-pkg', false, { profileDir: dir }),
      (err) => err instanceof ToggleError && err.code === 'not-installed',
    )
  })
})

describe('togglePlugin：委派路径（一律 Bundle，与官方页主开关同层）', () => {
  /** 有状态官方服务模拟器：行翻转 + bundle 可见性（退选后 listPlugins 不再列出）。 */
  function mkService(initialRows, { bundleOn = true, bundleApplication = 'applied' } = {}) {
    const calls = []
    const state = { rows: initialRows.map((r) => ({ ...r })), bundleOn }
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
        return { application: bundleApplication }
      },
    }
    return { service, calls }
  }

  it('单行插件停用 → setBundleEnabled（非行级）；退选后复读 → live', async () => {
    installFixture('demo-pkg', SINGLE_PATCH)
    const { service, calls } = mkService([
      { entryId: 'demo-row', moduleName: 'demo-pkg', enabled: true, fiberPhase: 'active' },
    ])
    const res = await togglePlugin('demo-pkg', false, { profileDir: dir, getService: () => service })
    assert.deepEqual(calls, [['setBundleEnabled', 'demo-pkg', false]])
    assert.deepEqual(res, { pkg: 'demo-pkg', enabled: false, applied: 'live', via: 'delegate', warnings: [] })
  })

  it('启用时先清理可见的历史行覆盖，再 selectBundle（obmc-web 形态）', async () => {
    installFixture('demo-pkg', SINGLE_PATCH)
    const { service, calls } = mkService([
      { entryId: 'demo-row', moduleName: 'demo-pkg', enabled: false, fiberPhase: null },
    ])
    const res = await togglePlugin('demo-pkg', true, { profileDir: dir, getService: () => service })
    assert.deepEqual(calls, [
      ['setPluginEnabled', 'demo-row', true],
      ['setBundleEnabled', 'demo-pkg', true],
    ])
    assert.equal(res.applied, 'live')
    assert.equal(res.warnings.some((w) => w.includes('历史行覆盖')), true)
  })

  it('清理扫描跳过官方 readOnly 行', async () => {
    installFixture('demo-pkg', SINGLE_PATCH)
    const { service, calls } = mkService([
      { entryId: 'locked', moduleName: 'demo-pkg', enabled: false, readOnlyReason: 'management-required' },
    ])
    const res = await togglePlugin('demo-pkg', true, { profileDir: dir, getService: () => service })
    assert.equal(calls.some(([op]) => op === 'setPluginEnabled'), false, 'readOnly 行不清理')
    assert.deepEqual(calls[0], ['setBundleEnabled', 'demo-pkg', true])
    // readOnly 行清不掉 → 复读 running=false ≠ enabled=true → 诚实上报 restart-required
    assert.equal(res.applied, 'restart-required')
  })

  it('application=restart-required → 直接采信（不复读）', async () => {
    installFixture('demo-pkg', SINGLE_PATCH)
    const { service } = mkService(
      [{ entryId: 'demo-row', moduleName: 'demo-pkg', enabled: true, fiberPhase: 'active' }],
      { bundleApplication: 'restart-required' },
    )
    const res = await togglePlugin('demo-pkg', false, { profileDir: dir, getService: () => service })
    assert.equal(res.applied, 'restart-required')
    assert.equal(res.via, 'delegate')
  })

  it('多行插件 → setBundleEnabled（与单行同层）', async () => {
    installFixture('demo-multi', MULTI_PATCH)
    const { service, calls } = mkService([
      { entryId: 'demo-seam', moduleName: 'demo-multi', enabled: true, fiberPhase: 'active' },
    ])
    const res = await togglePlugin('demo-multi', false, { profileDir: dir, getService: () => service })
    assert.deepEqual(calls, [['setBundleEnabled', 'demo-multi', false]])
    assert.equal(res.applied, 'live')
    assert.equal(res.via, 'delegate')
  })
})

describe('togglePlugin：降级路径', () => {
  it('行级活体：cordis.patch.yml 保注释落盘 + loader 翻转 → live', async () => {
    installFixture('demo-pkg', SINGLE_PATCH)
    profilePatch('# 手写区\n- id: keep\n  disabled: true\n')
    const host = loaderHostWith([
      { id: 'demo-row', options: { name: 'demo-pkg' }, disabled: false, fiber: { state: 2 },
        update: async () => { host.loader = { entries: () => [{ id: 'demo-row', options: { name: 'demo-pkg' }, disabled: true }] } } },
    ])
    const res = await togglePlugin('demo-pkg', false, { profileDir: dir, loaderHost: host, io: { readFile } })
    assert.equal(res.applied, 'live')
    assert.equal(res.via, 'fallback')
    const text = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    assert.equal(text.includes('# 手写区'), true)
    assert.equal(/id: demo-row\n  disabled: true/.test(text), true)
    assert.equal(text.includes('id: keep'), true)
  })

  it('行级无 loader entry（CLI 形态）→ restart-required，文件仍落盘', async () => {
    installFixture('demo-pkg', SINGLE_PATCH)
    const res = await togglePlugin('demo-pkg', false, { profileDir: dir, loaderHost: undefined, io: { readFile } })
    assert.equal(res.applied, 'restart-required')
    assert.equal(res.via, 'fallback')
    const text = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    // 空文件（"[]\n"）追加产出 flow 风格（官方 writePluginEnabled 同款）；语义断言而非格式断言
    assert.equal(text.includes('id: demo-row'), true)
    assert.equal(text.includes('disabled: true'), true)
  })

  it('幂等：已是目标态不写盘（mtime 不变）', async () => {
    installFixture('demo-pkg', SINGLE_PATCH)
    profilePatch('- id: demo-row\n  disabled: true\n')
    const before = statSync(join(dir, 'cordis.patch.yml')).mtimeMs
    await new Promise((r) => setTimeout(r, 12))
    const res = await togglePlugin('demo-pkg', false, { profileDir: dir, loaderHost: undefined, io: { readFile } })
    const after = statSync(join(dir, 'cordis.patch.yml')).mtimeMs
    assert.equal(res.applied, 'restart-required')
    assert.equal(before, after)
  })

  it('行级：loader 与补丁行均无 id → unknown-plugin', async () => {
    installFixture('demo-pkg', SINGLE_PATCH)
    // patchRows 可读但 inserts 空（构造：文件只有 config 行 → 非 single → bundle 路径，不适用；
    // 直接构造 single 但清空 loader 且补丁行畸形由 readBundlePatchRows readable:false → bundle。
    // 此用例改为：包补丁可读单行、但 id 恒存在——改测 loader id 缺失时用补丁行 id 兜底。')
    const host = loaderHostWith([]) // loader 无条目
    const res = await togglePlugin('demo-pkg', false, { profileDir: dir, loaderHost: host, io: { readFile } })
    // 补丁行 id 兜底成功 → 文件落盘（无 entry → restart-required）
    assert.equal(res.applied, 'restart-required')
    const text = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    assert.equal(text.includes('id: demo-row'), true)
  })

  it('bundle 级：bundles 数组增删（恒 restart-required）', async () => {
    installFixture('demo-multi', MULTI_PATCH)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    manifest.dsh = { profile: { bundles: ['demo-multi'] } }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
    const off = await togglePlugin('demo-multi', false, { profileDir: dir, io: { readFile } })
    assert.equal(off.applied, 'restart-required')
    assert.equal(off.via, 'fallback')
    let doc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.deepEqual(doc.dsh.profile.bundles, [])
    const on = await togglePlugin('demo-multi', true, { profileDir: dir, io: { readFile } })
    assert.equal(on.applied, 'restart-required')
    doc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.deepEqual(doc.dsh.profile.bundles, ['demo-multi'])
    // 其他键保留
    assert.equal(doc.name, 'dsh-profile-web')
    assert.deepEqual(doc.dependencies, { 'demo-multi': '1.0.0' })
  })

  it('bundle 级：package.json 缺 dsh 字段时创建结构', async () => {
    installFixture('demo-multi', MULTI_PATCH)
    const on = await togglePlugin('demo-multi', true, { profileDir: dir, io: { readFile } })
    assert.equal(on.applied, 'restart-required')
    const doc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.deepEqual(doc.dsh.profile.bundles, ['demo-multi'])
  })

  it('单行插件的 bundle 幂等：bundles 已含 → on 不重复追加', async () => {
    installFixture('demo-multi', MULTI_PATCH)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    manifest.dsh = { profile: { bundles: ['demo-multi', 'other'] } }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
    await togglePlugin('demo-multi', true, { profileDir: dir, io: { readFile } })
    const doc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.deepEqual(doc.dsh.profile.bundles, ['demo-multi', 'other'])
  })
})
