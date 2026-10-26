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

import { listInstalledWithMeta, listMarket } from '../lib/core/market.js'
import { listInstalledPlugins, readProfileDeps, readInstalledPluginReadme } from '../lib/core/installed.js'
import { githubRepoFromRepository } from '../lib/core/installed.js'

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

describe('listInstalledPlugins：多依赖输出排序（并行化重构的钉住不变量）', () => {
  it('5 个乱序写入的依赖（1 个非 DSH）：items 恒按依赖键字典序、others 计 1、complete:true', async () => {
    // 键序刻意与字典序不同（zeta 最先写、alpha 最后写），钉住「输出序 = Object.keys(deps).sort()」
    manifest({ dependencies: { zeta: '1.0.0', mid: '2.0.0', alpha: '1.0.0', omega: '3.0.0', beta: '2.0.0' } })
    pkgJson('zeta', { name: 'Z', version: '1.0.0', dsh: {} })
    pkgJson('mid', { name: 'M', version: '2.0.0', dsh: {} })
    pkgJson('alpha', { name: 'A', version: '1.0.0', dsh: {} })
    pkgJson('omega', { name: 'O', version: '3.0.0' }) // 合法 manifest 无 dsh 字段 → 非 DSH
    pkgJson('beta', { name: 'B', version: '2.0.0', dsh: {} })
    const res = await listInstalledPlugins(dir)
    assert.equal(res.complete, true)
    assert.equal(res.others, 1)
    assert.deepEqual(res.items.map((it) => it.pkg), ['alpha', 'beta', 'mid', 'zeta'])
  })
})

describe('listInstalledPlugins：patchRows 按需采集（2026-10-15 市场热路径选择退出）', () => {
  it('缺省带 patchRows（readable + inserts）；{ patchRows: false } 省略字段、其余不变', async () => {
    manifest({ dependencies: { 'pkg-a': '1.0.0' } })
    pkgJson('pkg-a', { name: 'A', version: '1.0.0', dsh: {} })
    const patchPath = join(dir, 'node_modules', 'pkg-a', 'cordis.patch.yml')
    writeFileSync(patchPath, "- insert:\n  - id: \"@x/a\"\n")
    const withPatch = await listInstalledPlugins(dir)
    assert.equal(withPatch.items[0].patchRows?.readable, true)
    assert.deepEqual(withPatch.items[0].patchRows?.inserts, [{ id: '@x/a' }])
    const without = await listInstalledPlugins(dir, { patchRows: false })
    assert.equal(without.items[0].patchRows, undefined)
    assert.equal(without.items[0].pkg, withPatch.items[0].pkg)
    assert.equal(without.items[0].name, withPatch.items[0].name)
    assert.equal(without.items[0].version, withPatch.items[0].version)
    assert.equal(without.complete, true)
    assert.equal(without.others, 0)
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

  it('profileName 参数改写未装文案，缺省仍为 web（0.9.50）', async () => {
    manifest({})
    await assert.rejects(
      () => readInstalledPluginReadme('missing', dir, 'desktop'),
      /desktop profile 未安装该插件/,
    )
  })
})

describe('githubRepoFromRepository（0.9.49 尾部放宽）', () => {
  it('标准/尾斜杠/子路径/.git/git@ 形态归一 owner/repo', () => {
    assert.equal(githubRepoFromRepository('git+https://github.com/o/r.git'), 'o/r')
    assert.equal(githubRepoFromRepository('https://github.com/o/r/'), 'o/r')
    assert.equal(githubRepoFromRepository('https://github.com/o/r/tree/main'), 'o/r')
    assert.equal(githubRepoFromRepository({ url: 'git@github.com:o/r.git' }), 'o/r')
    assert.equal(githubRepoFromRepository('https://gitlab.com/g/p'), null)
  })
})

describe('manifestIcon 透传（ADR-0025，T2）：sanitize 白名单 + 双臂同步', () => {
  it('manifest 带 icon → 双臂 item.manifestIcon 均为原始字符串；不带 → undefined', async () => {
    manifest({ dependencies: { 'dsh-iconic': '1.0.0', 'dsh-plain': '2.0.0' } })
    pkgJson('dsh-iconic', { name: 'dsh-iconic', version: '1.0.0', dsh: {}, icon: './icon.svg' })
    pkgJson('dsh-plain', { name: 'dsh-plain', version: '2.0.0', dsh: {} })
    for (const opts of [undefined, { patchRows: false }]) {
      const res = await listInstalledPlugins(dir, opts)
      const iconic = res.items.find((i) => i.pkg === 'dsh-iconic')
      const plain = res.items.find((i) => i.pkg === 'dsh-plain')
      assert.equal(iconic.manifestIcon, './icon.svg', `wantPatch=${opts?.patchRows === false ? 'patchRows:false' : 'default'} 臂`)
      assert.equal(plain.manifestIcon, undefined)
    }
  })

  it('icon 非字符串 / 空串 → undefined；超长截断 300', async () => {
    manifest({ dependencies: { 'dsh-bad-icon': '1.0.0', 'dsh-empty-icon': '1.0.0', 'dsh-long-icon': '1.0.0' } })
    pkgJson('dsh-bad-icon', { name: 'dsh-bad-icon', dsh: {}, icon: 123 })
    pkgJson('dsh-empty-icon', { name: 'dsh-empty-icon', dsh: {}, icon: '   ' })
    pkgJson('dsh-long-icon', { name: 'dsh-long-icon', dsh: {}, icon: './' + 'a'.repeat(400) + '.svg' })
    const res = await listInstalledPlugins(dir)
    const byPkg = Object.fromEntries(res.items.map((i) => [i.pkg, i.manifestIcon]))
    assert.equal(byPkg['dsh-bad-icon'], undefined)
    assert.equal(byPkg['dsh-empty-icon'], undefined)
    assert.equal(byPkg['dsh-long-icon'], './' + 'a'.repeat(298))
  })
})

describe('listInstalledWithMeta icon 接线（ADR-0025 T3.4，market 级）', () => {
  /** market-golden 同款 deps 桩形态：空主清单 + 空社区目录 → 无匹配无探测，items 原样流经富化点。 */
  function iconWiringDeps(items) {
    const ts = '2026-10-26T00:00:00.000Z'
    return {
      loadRegistry: async () => ({
        configuredAddress: '', activeAddress: 'https://example.com/r.json', source: 'default-raw', status: 'ready',
        isDefault: true, stale: false, fetchedAt: ts, errors: [], count: 0, registry: { version: 1, plugins: [] },
      }),
      listInstalledPlugins: async () => ({ items, others: 0, complete: true, profileDir: '/tmp/icon-wiring' }),
      fetchCommunityCatalog: async () => ({
        state: { enabled: true, status: 'ready', version: 'v0', checkedAt: ts, fetchedAt: ts, route: 'jsdelivr', count: 0, errors: [], warnings: [] },
        catalog: { name: 'x', url: 'https://x.example', source: 'https://x.example/repo', updated: '2026-10-26', count: 0, categories: {}, plugins: [] },
      }),
      npmLatest: async (pkg) => ({ version: '9.9.9', integrity: 'sha512-x', tarball: `https://example.com/${pkg}.tgz` }),
      githubLatestTag: async () => ({ tag: 'v9.9.9', sha: 'f'.repeat(40) }),
    }
  }

  function wiringItems(pkgDir) {
    return [{
      pkg: 'dsh-iconic', name: 'dsh-iconic', version: '1.0.0', description: '', homepage: '',
      spec: '1.0.0', source: 'npm', dsh: true, path: pkgDir, manifestIcon: './icon.svg',
    }]
  }

  it('icon:true → item 产出 iconDataUri（data URI）；接线被删则此测试红', async () => {
    const pkgDir = join(dir, 'node_modules', 'dsh-iconic')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const res = await listInstalledWithMeta({}, { namespace: 'host', probeMode: 'none', icon: true }, iconWiringDeps(wiringItems(pkgDir)))
    assert.match(String(res.items[0]?.iconDataUri), /^data:image\/svg\+xml;base64,/)
  })

  it('缺省（不传 icon）→ 不产出 iconDataUri 键', async () => {
    const pkgDir = join(dir, 'node_modules', 'dsh-iconic')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const res = await listInstalledWithMeta({}, { namespace: 'host', probeMode: 'none' }, iconWiringDeps(wiringItems(pkgDir)))
    assert.equal(res.items[0]?.iconDataUri, undefined)
  })
})

describe('listMarket 市场条目 icon join（ADR-0025 增补，主人修订）', () => {
  const regEntry = (id, npm) => ({ id, name: id, description: 'd', category: 'tools', tags: [], source: 'npm', npm })

  function marketDeps(items) {
    const ts = '2026-10-27T00:00:00.000Z' // 独立 fetchedAt：identityKey 含 fetchedAt（不含 registry 内容），防同进程代际键互串
    return {
      loadRegistry: async () => ({
        configuredAddress: '', activeAddress: 'https://example.com/mkt.json', source: 'default-raw', status: 'ready',
        isDefault: true, stale: false, fetchedAt: ts, errors: [], count: 2, registry: { version: 1, plugins: [regEntry('dsh-iconic', 'dsh-iconic'), regEntry('dsh-other', 'dsh-other')] },
      }),
      listInstalledPlugins: async () => ({ items, others: 0, complete: true, profileDir: '/tmp/icon-market' }),
      fetchCommunityCatalog: async () => ({
        state: { enabled: true, status: 'ready', version: 'v0-market', checkedAt: ts, fetchedAt: ts, route: 'jsdelivr', count: 0, errors: [], warnings: [] },
        catalog: { name: 'x', url: 'https://x.example', source: 'https://x.example/repo', updated: '2026-10-26', count: 0, categories: {}, plugins: [] },
      }),
      npmLatest: async (pkg) => ({ version: '9.9.9', integrity: 'sha512-x', tarball: `https://example.com/${pkg}.tgz` }),
      githubLatestTag: async () => ({ tag: 'v9.9.9', sha: 'f'.repeat(40) }),
    }
  }

  it('页内 matched 已装条目 → iconDataUri；未装条目 → 无键；接线被删则此测试红', async () => {
    process.env.DSHM_CACHE_DIR = mkdtempSync(join(tmpdir(), 'dshm-icon-mkt-'))
    try {
      const pkgDir = join(dir, 'node_modules', 'dsh-iconic')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
      const items = [{ pkg: 'dsh-iconic', name: 'dsh-iconic', version: '1.0.0', description: '', homepage: '', spec: '1.0.0', source: 'npm', dsh: true, path: pkgDir, manifestIcon: './icon.svg' }]
      const res = await listMarket({}, { namespace: 'host', limit: 10 }, marketDeps(items))
      const dump = JSON.stringify({ total: res.total, ids: res.items.map((i) => i.id) })
      const iconic = res.items.find((i) => i.id === 'dsh-iconic')
      const other = res.items.find((i) => i.id === 'dsh-other')
      assert.ok(iconic, `items dump: ${dump} | total ${res.total}`)
      assert.equal(iconic.installed, true, `dump: ${dump}`)
      assert.match(String(iconic.iconDataUri), /^data:image\/svg\+xml;base64,/)
      assert.equal(other?.iconDataUri, undefined)
    } finally {
      rmSync(process.env.DSHM_CACHE_DIR, { recursive: true, force: true })
      delete process.env.DSHM_CACHE_DIR
    }
  })
})
