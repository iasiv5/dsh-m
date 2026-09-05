/**
 * 卸载 × patchedDependencies：残留补丁条目会让 pnpm remove 以
 * ERR_PNPM_UNUSED_PATCH 整单失败（v0.2.1 真实案例：dsh-web-search 手工补丁）。
 * 运行：npm run build && node --test tests/uninstall-patch.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { removePatchedDependencyEntries, rewritePnpmError } from '../lib/core/dsh-cli.js'
import { uninstallPlugin } from '../lib/core/market.js'

function fixture(profileFiles) {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-patch-'))
  for (const [name, content] of Object.entries(profileFiles)) {
    const file = join(dir, name)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content)
  }
  return dir
}

const WS_WITH_OTHER = `packages:
  - .

nodeLinker: hoisted
patchedDependencies:
  dsh-web-search: patches/dsh-web-search.patch
  other-pkg: patches/other-pkg.patch
minimumReleaseAgeExclude:
  - dsh-m@0.2.1
`

describe('removePatchedDependencyEntries', () => {
  it('只摘目标包条目，保留同块其他包与后续顶层键', () => {
    const dir = fixture({ 'pnpm-workspace.yaml': WS_WITH_OTHER })
    const res = removePatchedDependencyEntries(dir, 'dsh-web-search')
    assert.equal(res.changed, true)
    const text = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')
    assert.ok(!text.includes('dsh-web-search: patches'), '目标条目应被移除')
    assert.ok(text.includes('other-pkg: patches/other-pkg.patch'), '其他补丁应保留')
    assert.ok(text.includes('patchedDependencies:'), '块内仍有条目时头部应保留')
    assert.ok(text.includes('minimumReleaseAgeExclude:'), '后续顶层键应保留')
    assert.deepEqual(res.orphanedPatchFiles, [], '补丁文件不存在时不报告孤儿')
  })

  it('块内条目被摘空时连同头部一起移除', () => {
    const dir = fixture({
      'pnpm-workspace.yaml': `packages:
  - .

patchedDependencies:
  dsh-web-search: patches/dsh-web-search.patch

nodeLinker: hoisted
`,
    })
    const res = removePatchedDependencyEntries(dir, 'dsh-web-search')
    assert.equal(res.changed, true)
    const text = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')
    assert.ok(!text.includes('patchedDependencies'), '空块头部应移除')
    assert.ok(text.includes('nodeLinker: hoisted'), '其余内容应保留')
  })

  it('匹配带版本号的键 pkg@ver，并报告磁盘上存在的孤儿补丁文件', () => {
    const dir = fixture({
      'pnpm-workspace.yaml': `patchedDependencies:
  dsh-web-search@0.1.2: patches/dsh-web-search.patch
`,
      'patches/dsh-web-search.patch': 'diff --git a b\n',
    })
    const res = removePatchedDependencyEntries(dir, 'dsh-web-search')
    assert.equal(res.changed, true)
    assert.equal(res.orphanedPatchFiles.length, 1)
    assert.ok(res.orphanedPatchFiles[0].endsWith('patches/dsh-web-search.patch'))
    assert.ok(existsSync(res.orphanedPatchFiles[0]), '补丁文件本体应保留在磁盘')
  })

  it('清理 package.json 的 pnpm.patchedDependencies（pnpm<10 落点）', () => {
    const dir = fixture({
      'package.json': JSON.stringify({
        name: 'dsh-profile-web',
        dependencies: { 'dsh-web-search': '^0.1.2' },
        pnpm: { patchedDependencies: { 'dsh-web-search': 'patches/dsh-web-search.patch' } },
      }),
    })
    const res = removePatchedDependencyEntries(dir, 'dsh-web-search')
    assert.equal(res.changed, true)
    const doc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(doc.pnpm, undefined, '摘空后应连带删除 pnpm 字段')
    assert.equal(doc.dependencies['dsh-web-search'], '^0.1.2', '依赖本体不动')
  })

  it('无补丁配置时 no-op，不写文件不报错', () => {
    const dir = fixture({ 'pnpm-workspace.yaml': 'packages:\n  - .\n' })
    const res = removePatchedDependencyEntries(dir, 'dsh-web-search')
    assert.equal(res.changed, false)
    assert.deepEqual(res.orphanedPatchFiles, [])
    assert.equal(removePatchedDependencyEntries(dir, 'not/installed').changed, false)
  })

  it('非法包名直接 no-op', () => {
    const dir = fixture({ 'pnpm-workspace.yaml': WS_WITH_OTHER })
    assert.equal(removePatchedDependencyEntries(dir, '../evil').changed, false)
    assert.equal(removePatchedDependencyEntries(dir, '').changed, false)
  })
})

describe('uninstallPlugin × 补丁清理', () => {
  it('先摘补丁条目再移除插件，孤儿补丁并入 leftovers', async () => {
    const calls = []
    const res = await uninstallPlugin('dsh-web-search', {}, {}, {
      removePatchedEntries: (profileDir, pkg) => {
        calls.push(['patch', profileDir, pkg])
        return { changed: true, orphanedPatchFiles: ['/profile/patches/dsh-web-search.patch'] }
      },
      removeInstalled: async (pkg) => {
        calls.push(['remove', pkg])
        return { pkg }
      },
    })
    assert.deepEqual(calls, [
      ['patch', calls[0][1], 'dsh-web-search'],
      ['remove', 'dsh-web-search'],
    ], '补丁摘除必须发生在 pnpm remove 之前')
    assert.equal(res.pkg, 'dsh-web-search')
    assert.ok(res.leftovers.includes('/profile/patches/dsh-web-search.patch'))
    assert.equal(res.needsRestart, true)
  })
})

describe('rewritePnpmError', () => {
  it('ERR_PNPM_UNUSED_PATCH 转译为可读指引', () => {
    const err = rewritePnpmError(new Error('[ERR_PNPM_UNUSED_PATCH] The following patches were not used: dsh-web-search'))
    assert.match(err.message, /patchedDependencies/)
    assert.doesNotMatch(err.message, /ERR_PNPM_UNUSED_PATCH/)
  })
})
