/**
 * T1：已装面板图标解析器（官方 iconOf 语义复刻；评审 R-3Q1 两面 realpath + symlink fixture）。
 * 运行：npm run build && node --test tests/installed-icon.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

import { manifestIconToDataUri, attachInstalledIconDataUris, MAX_ICON_BYTES } from '../lib/core/installed-icon.js'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 造一个真实包目录（root 实体），返回其路径。 */
function makeRealPkg(withIcon = true) {
  const real = join(mkdtempSync(join(tmpdir(), 'dshm-icon-')), 'pkg')
  mkdirSync(real, { recursive: true })
  if (withIcon) writeFileSync(join(real, 'icon.svg'), SVG)
  return real
}

describe('manifestIconToDataUri', () => {
  it('合法 svg（经 symlink 安装目录访问）→ 逐字节 data URI（R-3Q1 root 面）', async (t) => {
    if (process.platform === 'win32') t.skip('symlink 需要特权，CI Windows 跳过')
    const real = makeRealPkg()
    const link = join(dirname(real), 'pkg-link')
    symlinkSync(real, link, 'dir')
    const uri = await manifestIconToDataUri(link, './icon.svg')
    assert.equal(uri, `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`)
  })

  it('合法 png → data:image/png', async () => {
    const real = makeRealPkg(false)
    writeFileSync(join(real, 'icon.png'), PNG_1PX)
    assert.equal(await manifestIconToDataUri(real, 'icon.png'), `data:image/png;base64,${PNG_1PX.toString('base64')}`)
  })

  it('绝对路径（posix / win32）与带 scheme 一律 null', async () => {
    const real = makeRealPkg()
    assert.equal(await manifestIconToDataUri(real, '/etc/passwd'), null)
    assert.equal(await manifestIconToDataUri(real, 'C:\\x\\icon.png'), null)
    assert.equal(await manifestIconToDataUri(real, 'https://example.com/i.png'), null)
    assert.equal(await manifestIconToDataUri(real, 'data:image/png;base64,xxx'), null)
  })

  it('../escape 逃出包目录 → null', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dshm-icon-'))
    const real = join(tmp, 'pkg')
    mkdirSync(real)
    writeFileSync(join(real, 'icon.svg'), SVG)
    writeFileSync(join(tmp, 'escape.svg'), SVG)
    assert.equal(await manifestIconToDataUri(real, '../escape.svg'), null)
  })

  it('icon 文件为指向包外的 symlink → null（R-3Q1 target 面，官方点名防御场景）', async (t) => {
    if (process.platform === 'win32') t.skip('symlink 需要特权，CI Windows 跳过')
    const tmp = mkdtempSync(join(tmpdir(), 'dshm-icon-'))
    const real = join(tmp, 'pkg')
    mkdirSync(real)
    writeFileSync(join(tmp, 'outside.svg'), SVG)
    symlinkSync(join(tmp, 'outside.svg'), join(real, 'icon.svg'))
    assert.equal(await manifestIconToDataUri(real, './icon.svg'), null)
  })

  it('扩展名白名单：.txt 与无扩展名 → null', async () => {
    const real = makeRealPkg(false)
    writeFileSync(join(real, 'icon.txt'), 'x')
    writeFileSync(join(real, 'icon'), 'x')
    assert.equal(await manifestIconToDataUri(real, './icon.txt'), null)
    assert.equal(await manifestIconToDataUri(real, './icon'), null)
  })

  it('超过 256KiB → null（stat 前置）', async () => {
    const real = makeRealPkg(false)
    writeFileSync(join(real, 'icon.svg'), Buffer.alloc(MAX_ICON_BYTES + 1))
    assert.equal(await manifestIconToDataUri(real, './icon.svg'), null)
  })

  it('文件不存在 / 目录不存在 / raw 非字符串或空串 → null（绝不 throw）', async () => {
    const real = makeRealPkg()
    assert.equal(await manifestIconToDataUri(real, './nope.svg'), null)
    assert.equal(await manifestIconToDataUri(join(real, 'missing-dir'), './icon.svg'), null)
    assert.equal(await manifestIconToDataUri(real, 123), null)
    assert.equal(await manifestIconToDataUri(real, ''), null)
    assert.equal(await manifestIconToDataUri(real, '   '), null)
    assert.equal(await manifestIconToDataUri(real, undefined), null)
  })

  it('exports <pkg>/icon 兜底：best-effort 永不 throw，成功则 data URI（评审 R-3Q1 契约钉「永不炸」）', async (t) => {
    if (process.platform === 'win32') t.skip('symlink 需要特权，CI Windows 跳过')
    const real = makeRealPkg(false)
    writeFileSync(join(real, 'icon.svg'), SVG)
    writeFileSync(join(real, 'package.json'), JSON.stringify({ name: 'dshm-icon-fixture-pkg', exports: { './icon': './icon.svg' } }))
    const link = join(dirname(real), 'pkg-link')
    symlinkSync(real, link, 'dir')
    const uri = await manifestIconToDataUri(link, undefined, 'dshm-icon-fixture-pkg')
    // 临时目录不在任何 node_modules 链上时 resolve 失败 → null；解析成功 → data URI。两者皆合法。
    assert.ok(uri === null || uri.startsWith('data:image/svg+xml;base64,'), `unexpected: ${String(uri).slice(0, 80)}`)
  })
})

describe('attachInstalledIconDataUris（T3 富化）', () => {
  it('有声明 → 写入 data URI；解析失败 → 显式 null；未声明 → 键保持 undefined；保序', async () => {
    const good = makeRealPkg()
    const bad = makeRealPkg()
    const none = makeRealPkg(false)
    const items = [
      { pkg: 'good', path: good, manifestIcon: './icon.svg' },
      { pkg: 'bad', path: bad, manifestIcon: '../escape.svg' },
      { pkg: 'none', path: none },
    ]
    await attachInstalledIconDataUris(items)
    assert.ok(items[0].iconDataUri?.startsWith('data:image/svg+xml;base64,'), 'good → data URI')
    assert.equal(items[1].iconDataUri, null, '解析失败 → 显式 null')
    assert.equal(items[2].iconDataUri, undefined, '未声明 → undefined')
    assert.deepEqual(items.map((i) => i.pkg), ['good', 'bad', 'none'], '保序')
  })
})
