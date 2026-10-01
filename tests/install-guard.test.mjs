/**
 * M2 Task 2：装后守卫三项检查（NO_DSH_MARKER / ENTRY_UNRESOLVABLE / LOADER_ID_CONFLICT）
 * + 读错误 io taxonomy（ENOENT=语义结论；EACCES/坏 JSON/坏 YAML=unavailable）+ 自撞排除。
 * 运行：npm run build && node --test tests/install-guard.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { verifyInstalledAdditions } from '../lib/core/install-guard.js'

let profileDir = ''
let pkgsDir = ''

beforeEach(() => {
  profileDir = mkdtempSync(join(tmpdir(), 'dshm-guard-'))
  pkgsDir = join(profileDir, 'node_modules')
  mkdirSync(pkgsDir, { recursive: true })
})
afterEach(() => {
  // EACCES 只读目录可能挡 rm——先恢复权限
  try {
    chmodSync(join(pkgsDir, 'locked-pkg'), 0o755)
  } catch {}
  if (profileDir) rmSync(profileDir, { recursive: true, force: true })
})

function makePkg(name, opts = {}) {
  const dir = join(pkgsDir, ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  const pkgJson = opts.pkgJson ?? {
    name,
    version: '1.0.0',
    main: 'index.js',
    ...(opts.marker === false ? {} : { dsh: { bundle: { patch: './cordis.patch.yml' } } }),
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2))
  if (opts.patch !== null) {
    // 默认 insert id 按 name 派生：不同测试包互不冲突（冲突场景由用例显式指定 id）
    writeFileSync(join(dir, 'cordis.patch.yml'), opts.patch ?? `- insert:\n  - id: ${name}-loader-id\n    name: ${name}\n`)
  }
  if (opts.entry !== undefined) {
    if (opts.entry === null) rmSync(join(dir, 'package.json')) // 由 pkgJson===null 分支处理
    else writeFileSync(join(dir, opts.entry), 'module.exports = {}\n')
  }
  return dir
}

function setDeps(deps) {
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile', private: true, dependencies: deps }, null, 2))
}

const GOOD_ENTRY = { entry: 'index.js' }

describe('① NO_DSH_MARKER', () => {
  it('dsh 键 marker → ok', async () => {
    makePkg('pkg-a', GOOD_ENTRY)
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-a'] })
    assert.equal(r.ok, true)
    assert.deepEqual(r.violations, [])
    assert.deepEqual(r.unavailable, [])
  })

  it('仅 cordis.patch.yml（无 dsh 键）也是 marker', async () => {
    makePkg('pkg-b', { marker: false, entry: 'index.js' })
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-b'] })
    assert.equal(r.ok, true)
  })

  it('两键皆无 → NO_DSH_MARKER', async () => {
    makePkg('pkg-c', { marker: false, entry: 'index.js', patch: null })
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-c'] })
    assert.equal(r.ok, false)
    assert.equal(r.violations[0].code, 'NO_DSH_MARKER')
  })

  it('package.json ENOENT → NO_DSH_MARKER（io taxonomy：ENOENT 是语义结论）', async () => {
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['ghost-pkg'] })
    assert.equal(r.violations[0].code, 'NO_DSH_MARKER')
    assert.equal(r.unavailable.length, 0)
  })

  it('package.json 坏 JSON → unavailable', async () => {
    const dir = makePkg('broken-json', { marker: false })
    writeFileSync(join(dir, 'package.json'), '{broken')
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['broken-json'] })
    assert.equal(r.violations.length, 0)
    assert.equal(r.unavailable[0].pkg, 'broken-json')
  })
})

describe('② ENTRY_UNRESOLVABLE', () => {
  it('exports string（root sugar）→ 可检查并命中文件', async () => {
    makePkg('pkg-es', { pkgJson: { name: 'pkg-es', exports: './index.js', dsh: {} }, entry: 'index.js' })
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-es'] })
    assert.equal(r.ok, true)
  })

  it('exports {".": string} 与 {".": {default}} → 可检查', async () => {
    makePkg('pkg-dot', { pkgJson: { name: 'pkg-dot', exports: { '.': './index.js' }, dsh: {} }, entry: 'index.js' })
    makePkg('pkg-dotd', { pkgJson: { name: 'pkg-dotd', exports: { '.': { default: './index.js' } }, dsh: {} }, entry: 'index.js' })
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-dot', 'pkg-dotd'] })
    assert.equal(r.ok, true)
  })

  it('exports 多条件键 → conservative unavailable（不猜入口）', async () => {
    makePkg('pkg-cond', {
      pkgJson: { name: 'pkg-cond', exports: { '.': './a.js', './client': './b.js' }, dsh: {} },
      entry: 'index.js',
    })
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-cond'] })
    assert.equal(r.violations.length, 0)
    assert.equal(r.unavailable[0].pkg, 'pkg-cond')
  })

  it('无 exports 用 main；main 也无 → ENTRY_UNRESOLVABLE', async () => {
    makePkg('pkg-main', { pkgJson: { name: 'pkg-main', main: 'index.js', dsh: {} }, entry: 'index.js' })
    makePkg('pkg-noentry', { pkgJson: { name: 'pkg-noentry', dsh: {} }, entry: 'index.js' })
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-main', 'pkg-noentry'] })
    assert.equal(r.violations.length, 1)
    assert.equal(r.violations[0].pkg, 'pkg-noentry')
    assert.equal(r.violations[0].code, 'ENTRY_UNRESOLVABLE')
  })

  it('入口文件缺失 → ENTRY_UNRESOLVABLE', async () => {
    makePkg('pkg-miss', { pkgJson: { name: 'pkg-miss', main: 'gone.js', dsh: {} } })
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-miss'] })
    assert.equal(r.violations[0].code, 'ENTRY_UNRESOLVABLE')
  })

  it('symlink 逃逸（入口指向包目录外）→ ENTRY_UNRESOLVABLE（containment）', async (t) => {
    const outside = mkdtempSync(join(tmpdir(), 'dshm-guard-outside-'))
    writeFileSync(join(outside, 'evil.js'), 'pwn\n')
    const dir = makePkg('pkg-symlink', { pkgJson: { name: 'pkg-symlink', main: 'index.js', dsh: {} } })
    try {
      symlinkSync(join(outside, 'evil.js'), join(dir, 'index.js'))
    } catch (err) {
      if (err?.code === 'EPERM') return t.skip('当前环境无符号链接权限（Windows 未开开发者模式/非管理员）')
      throw err
    }
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-symlink'] })
    assert.equal(r.violations[0].code, 'ENTRY_UNRESOLVABLE')
    assert.ok(r.violations[0].detail.includes('越出包目录'))
    rmSync(outside, { recursive: true, force: true })
  })
})

describe('③ LOADER_ID_CONFLICT', () => {
  it('根 patch insert id 冲突 → violation 并列出来源', async () => {
    makePkg('pkg-new', { entry: 'index.js', patch: '- insert:\n  - id: dsh-conflict\n    name: C\n' })
    writeFileSync(join(profileDir, 'cordis.patch.yml'), '- insert:\n  - id: dsh-conflict\n    name: R\n')
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-new'] })
    assert.equal(r.violations[0].code, 'LOADER_ID_CONFLICT')
    assert.ok(r.violations[0].conflictingIds.some((c) => c.source === 'profile 根 patch'))
  })

  it('已装依赖包 patch id 冲突；⑩c others 包（无 patch）贡献空集', async () => {
    setDeps({ 'dep-a': '1.0.0', 'plain-dep': '1.0.0' })
    makePkg('dep-a', { entry: 'index.js', patch: '- insert:\n  - id: shared-id\n' })
    makePkg('plain-dep', { marker: false, entry: 'index.js', patch: null })
    makePkg('pkg-new', { entry: 'index.js', patch: '- insert:\n  - id: shared-id\n' })
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-new'] })
    assert.equal(r.violations[0].code, 'LOADER_ID_CONFLICT')
    assert.ok(r.violations[0].conflictingIds.some((c) => c.source === 'dep-a'))
  })

  it('⑧ 自撞排除：冲突 id 来源于被升级包自身（priorPkgs）→ 不算冲突', async () => {
    setDeps({ 'pkg-up': '1.0.0' })
    makePkg('pkg-up', { entry: 'index.js', patch: '- insert:\n  - id: same-id\n' })
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-up'], priorPkgs: ['pkg-up'] })
    assert.equal(r.ok, true, '升级场景：包与自己的旧 id 不构成冲突')
  })

  it('⑧b 双新包 pairwise：两条新包 insert id 相同 → 互为冲突', async () => {
    makePkg('pkg-a1', { entry: 'index.js', patch: '- insert:\n  - id: dup-id\n' })
    makePkg('pkg-a2', { entry: 'index.js', patch: '- insert:\n  - id: dup-id\n' })
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-a1', 'pkg-a2'] })
    assert.equal(r.violations.filter((v) => v.code === 'LOADER_ID_CONFLICT').length, 2)
  })

  it('根 patch ENOENT = 空集；bundles 数组不产生 id', async () => {
    setDeps({ 'pkg-only': '1.0.0' })
    makePkg('pkg-only', { entry: 'index.js', patch: '- insert:\n  - id: fresh-id\n' })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dependencies: { 'pkg-only': '1.0.0' }, dsh: { profile: { bundles: ['fresh-id'] } } }))
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-only'], priorPkgs: ['pkg-only'] })
    assert.equal(r.ok, true, '无根 patch 文件 + bundles 数组（非 insert id 来源）→ 零冲突')
  })

  it('根 patch 坏 YAML → 全局 unavailable；依赖包 patch 坏 YAML → unavailable', async () => {
    makePkg('pkg-ok', GOOD_ENTRY)
    writeFileSync(join(profileDir, 'cordis.patch.yml'), '\tbroken: [yaml')
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-ok'] })
    assert.equal(r.unavailable.some((u) => u.pkg === null), true)
    assert.equal(r.violations.length, 0)

    setDeps({ 'dep-bad': '1.0.0' })
    makePkg('dep-bad', { entry: 'index.js', patch: '\tbroken: [yaml' })
    const r2 = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-ok'] })
    assert.equal(r2.unavailable.some((u) => u.reason.includes('dep-bad')), true)
  })
})

describe('readDeps 快照与注入', () => {
  it('⑪ readDeps 显式失败 → 全局 unavailable（pkg:null）', async () => {
    makePkg('pkg-x', GOOD_ENTRY)
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-x'] }, {
      readDeps: async () => {
        throw new Error('EIO 模拟')
      },
    })
    assert.equal(r.ok, false)
    assert.equal(r.violations.length, 0)
    assert.equal(r.unavailable[0].pkg, null)
    assert.ok(r.unavailable[0].reason.includes('EIO 模拟'))
  })

  it('readDeps 注入替代默认读取；scoped 包路径正确解析', async () => {
    setDeps({ '@scope/dep': '1.0.0' })
    makePkg('@scope/dep', { entry: 'index.js', patch: '- insert:\n  - id: scoped-id\n' })
    makePkg('pkg-new', { entry: 'index.js', patch: '- insert:\n  - id: scoped-id\n' })
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-new'] })
    assert.equal(r.violations[0].code, 'LOADER_ID_CONFLICT')
    assert.ok(r.violations[0].conflictingIds.some((c) => c.source === '@scope/dep'))
  })

  it('与主清单集成语义：结果形状完整（ok/violations/unavailable 三字段恒在）', async () => {
    makePkg('pkg-shape', GOOD_ENTRY)
    const r = await verifyInstalledAdditions({ profileDir, addedPkgs: ['pkg-shape'] })
    assert.deepEqual(Object.keys(r).sort(), ['ok', 'unavailable', 'violations'])
  })
})
