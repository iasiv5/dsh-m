/**
 * 安装枚举完整性契约（installed.ts complete/others）：
 * - 顶层 manifest 读不到 / 坏 JSON / 根非数组对象 / dependencies 类型非法 / spec 非法 → complete:false；
 * - 合法空 profile（无 dependencies 或空对象）→ complete:true；
 * - others 只数「确认非 DSH」（合法 manifest 无 dsh 字段）；无法读取的依赖不计 others 且令 complete:false；
 * - partial 语义：个别非法项只降 complete，合法项保留（宽松 readProfileDeps 与 README 路径不受污染）；
 * - `__proto__` 等特殊 key 不得被对象原型语义静默吞掉（无原型容器契约）。
 * 读取失败场景用真实临时文件系统构造（package.json 为目录在 Linux/CI 上表现为 EISDIR；
 * 契约只承诺「读取/解析失败 → complete:false」，不承诺特定 errno）。
 * 运行：npm run build && node --test tests/installed.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listInstalledPlugins, readProfileDeps, readInstalledPluginReadme } from '../lib/core/installed.js'

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dshm-installed-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 写顶层 manifest（字符串按原样写入，可表达坏 JSON；'EISDIR' 哨兵：manifest 本身是目录）。 */
function manifest(content) {
  const p = join(dir, 'package.json')
  if (content === undefined) return // 不写文件（ENOENT 场景）
  if (content === 'EISDIR') {
    mkdirSync(p) // package.json 本身是目录 → readFile 抛 EISDIR（确定性读取错误）
    return
  }
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
}

/** 在 node_modules/<pkg> 放一个 package.json（undefined：不写文件即缺失；'EISDIR'：建目录）。 */
function pkgJson(pkg, content) {
  const p = join(dir, 'node_modules', pkg, 'package.json')
  mkdirSync(join(p, '..'), { recursive: true })
  if (content === undefined) return // package.json 缺失
  if (content === 'EISDIR') {
    mkdirSync(p) // package.json 本身是目录 → readFile 抛 EISDIR（确定性读取错误）
  } else {
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  }
}

describe('listInstalledPlugins：顶层 manifest 结构 → complete', () => {
  // 表驱动：坏输入一律 complete:false（items 空、others 0）
  const badManifests = [
    ['坏 JSON', '{ broken'],
    ['根为 null', 'null'],
    ['根为数组', '[]'],
    ['根为字符串', '"x"'],
    ['根为数字', '123'],
    ['文件缺失（ENOENT）', undefined],
    ['package.json 是目录（EISDIR）', 'EISDIR'],
    ['dependencies 为 null', { dependencies: null }],
    ['dependencies 为数组', { dependencies: [] }],
    ['dependencies 为字符串', { dependencies: 'pkg-a' }],
    ['dependencies 为数字', { dependencies: 123 }],
    ['dependency spec 为 null', { dependencies: { 'pkg-a': null } }],
    ['dependency spec 为数字', { dependencies: { 'pkg-a': 123 } }],
    ['dependency spec 为空串', { dependencies: { 'pkg-a': '' } }],
    ['dependency spec 为纯空格', { dependencies: { 'pkg-a': '   ' } }],
    ['dependency spec 含 Tab 与换行', { dependencies: { 'pkg-a': '\t\n' } }],
    ['dependency spec 为对象', { dependencies: { 'pkg-a': {} } }],
  ]
  for (const [name, content] of badManifests) {
    it(`${name} → complete:false`, async () => {
      manifest(content)
      const res = await listInstalledPlugins(dir)
      assert.equal(res.complete, false)
      assert.deepEqual(res.items, [])
      assert.equal(res.others, 0)
    })
  }

  it('合法空 profile：无 dependencies 与空 dependencies 均为 complete:true、零条目', async () => {
    for (const m of [{}, { dependencies: {} }]) {
      manifest(m)
      const res = await listInstalledPlugins(dir)
      assert.equal(res.complete, true)
      assert.deepEqual(res.items, [])
      assert.equal(res.others, 0)
    }
  })
})

describe('listInstalledPlugins：单包 manifest 分类（others 只数确认非 DSH）', () => {
  const dep = { dependencies: { 'pkg-a': '1.0.0', 'pkg-b': '2.0.0' } }

  const unreadable = [
    ['package.json 缺失', undefined],
    ['坏 JSON', '{ broken'],
    ['根为数组', '[]'],
    ['根为 null', 'null'],
    ['package.json 是目录（EISDIR）', 'EISDIR'],
  ]
  for (const [name, content] of unreadable) {
    it(`pkg-b ${name} → complete:false 且不计 others（无法判断 ≠ 非 DSH）`, async () => {
      manifest(dep)
      pkgJson('pkg-a', { name: 'A', version: '1.0.0', dsh: {} })
      pkgJson('pkg-b', content)
      const res = await listInstalledPlugins(dir)
      assert.equal(res.complete, false)
      assert.equal(res.others, 0, '无法读取的依赖不得计入 others')
      assert.equal(res.items.length, 1, '已确认部分保留（partial）')
      assert.equal(res.items[0].pkg, 'pkg-a')
    })
  }

  it('合法 manifest 无 dsh 字段 → 确认非 DSH：others+1 且 complete:true', async () => {
    manifest(dep)
    pkgJson('pkg-a', { name: 'A', version: '1.0.0', dsh: {} })
    pkgJson('pkg-b', { name: 'B', version: '2.0.0' })
    const res = await listInstalledPlugins(dir)
    assert.equal(res.complete, true)
    assert.equal(res.items.length, 1)
    assert.equal(res.others, 1)
  })

  it('合法 manifest 含 dsh 字段 → 进入 items（name/version 取自包内 manifest）', async () => {
    manifest({ dependencies: { 'pkg-a': 'github:o/r#abc' } })
    pkgJson('pkg-a', { name: 'A', version: '1.2.3', dsh: { client: { platform: 'web' } } })
    const res = await listInstalledPlugins(dir)
    assert.equal(res.complete, true)
    assert.equal(res.items.length, 1)
    assert.equal(res.items[0].pkg, 'pkg-a')
    assert.equal(res.items[0].name, 'A')
    assert.equal(res.items[0].version, '1.2.3')
    assert.equal(res.items[0].source, 'github')
  })

  it('不安全依赖键（目录无法解析）→ complete:false 且不计 others', async () => {
    manifest({ dependencies: { '..': '1.0.0' } })
    const res = await listInstalledPlugins(dir)
    assert.equal(res.complete, false)
    assert.equal(res.others, 0)
    assert.deepEqual(res.items, [])
  })
})

describe('listInstalledPlugins/readProfileDeps：partial 语义与特殊 key', () => {
  it('混合合法/非法 spec：complete:false，已确认合法 DSH 项保留', async () => {
    manifest({ dependencies: { 'pkg-good': '1.0.0', 'pkg-bad': null, 'pkg-blank': '  ' } })
    pkgJson('pkg-good', { name: 'Good', version: '1.0.0', dsh: {} })
    const res = await listInstalledPlugins(dir)
    assert.equal(res.complete, false)
    assert.equal(res.items.length, 1, '合法项保留（partial）')
    assert.equal(res.items[0].pkg, 'pkg-good')
    assert.equal(res.others, 0)
  })

  it('宽松 readProfileDeps 混合场景：返回合法项、跳过非法项（不整体丢弃）', async () => {
    manifest({ dependencies: { 'pkg-good': '1.0.0', 'pkg-bad': null } })
    const deps = await readProfileDeps(dir)
    assert.deepEqual({ ...deps }, { 'pkg-good': '1.0.0' })
  })

  it('`__proto__` 依赖键：不得被对象原型语义吞掉 → complete:false、items 空、others 0', async () => {
    manifest('{"dependencies":{"__proto__":"1.0.0"}}')
    const res = await listInstalledPlugins(dir)
    assert.equal(res.complete, false)
    assert.deepEqual(res.items, [])
    assert.equal(res.others, 0)
  })

  it('混合合法键与 `__proto__`：complete:false 且合法依赖保留在 partial items 中', async () => {
    manifest('{"dependencies":{"pkg-a":"1.0.0","__proto__":"2.0.0"}}')
    pkgJson('pkg-a', { name: 'A', version: '1.0.0', dsh: {} })
    const res = await listInstalledPlugins(dir)
    assert.equal(res.complete, false)
    assert.equal(res.items.length, 1)
    assert.equal(res.items[0].pkg, 'pkg-a')
  })

  it('readInstalledPluginReadme：无关依赖损坏不影响合法目标——不误报「未安装」', async () => {
    manifest({ dependencies: { 'pkg-a': '1.0.0', 'pkg-b': null } })
    pkgJson('pkg-a', { name: 'A', version: '1.0.0', dsh: {} })
    writeFileSync(join(dir, 'node_modules', 'pkg-a', 'README.md'), '# A readme')
    const readme = await readInstalledPluginReadme('pkg-a', dir)
    assert.equal(readme.pkg, 'pkg-a')
    assert.ok(readme.readme.includes('# A readme'))
  })

  it('继承键不得授权：合法空 profile 下 constructor（不在 dependencies）必须报「未安装」', async () => {
    manifest({}) // 合法空 profile → deps 为空（早退路径）
    // 真实创建 node_modules/constructor/README.md，证明此前可读取未声明文件的完整路径被切断
    mkdirSync(join(dir, 'node_modules', 'constructor'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'constructor', 'README.md'), '# unintended')
    await assert.rejects(
      () => readInstalledPluginReadme('constructor', dir),
      /web profile 未安装该插件/,
    )
  })

  it('继承键不得授权：manifest 缺失时 toString 同样必须报「未安装」', async () => {
    manifest(undefined) // 不写 package.json（早退路径的另一形态）
    mkdirSync(join(dir, 'node_modules', 'toString'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'toString', 'README.md'), '# unintended')
    await assert.rejects(
      () => readInstalledPluginReadme('toString', dir),
      /web profile 未安装该插件/,
    )
  })

  it('显式声明的原型同名合法包名（constructor）不受误伤：枚举/分类/README 全部正常', async () => {
    manifest({ dependencies: { constructor: '1.0.0' } })
    pkgJson('constructor', { name: 'C', version: '1.0.0', dsh: {} })
    writeFileSync(join(dir, 'node_modules', 'constructor', 'README.md'), '# legit')
    const deps = await readProfileDeps(dir)
    assert.equal(Object.hasOwn(deps, 'constructor'), true, 'own property 存在')
    assert.equal(deps.constructor, '1.0.0')
    const res = await listInstalledPlugins(dir)
    assert.equal(res.complete, true)
    assert.equal(res.items.length, 1)
    assert.equal(res.items[0].pkg, 'constructor')
    const readme = await readInstalledPluginReadme('constructor', dir)
    assert.ok(readme.readme.includes('# legit'))
  })
})
