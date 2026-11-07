/**
 * registry-installability：registry 条目 npm 包「装后守卫预检」（2026-11-07 agentero-dsh 实录沉淀）。
 * 实录：agentero-dsh 0.1.6 纯 bundle 壳包被 dsh-m 装后守卫 ② ENTRY_UNRESOLVABLE 拦截补偿，
 * 而收录门禁（npm/GitHub/homepage/icon 存在性）全绿——「收录过但装不上」没有任何机器闸。
 * probeNpmInstallability 拉 latest tarball → 解包到临时 node_modules → 对根包跑
 * verifyInstalledAdditions 三项检查；命中 violation = 市场安装必被拦截补偿 → 收录门禁应红。
 * 供 scripts/validate-registry.mjs 在线段消费。
 * 运行：node --test tests/registry-installability.test.mjs
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const probe = (await import(join(here, '..', 'scripts', 'registry-installability.mjs'))).probeNpmInstallability

let cleanups = []
afterEach(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true })
  cleanups = []
})

function track(dir) {
  cleanups.push(dir)
  return dir
}

/** 造一个包目录并打成 tarball buffer（npm tarball 形态：根目录 package/）。 */
function tarballOf(pkgJson, files = {}) {
  const fixture = track(mkdtempSync(join(tmpdir(), 'dshm-rip-fix-')))
  const pkgDir = join(fixture, 'package')
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(pkgDir, name), content)
  }
  const tgz = join(fixture, 'pkg.tgz')
  execFileSync('tar', ['czf', tgz, '-C', fixture, 'package'])
  return readFileSync(tgz)
}

describe('probeNpmInstallability（tarball 注入形态）', () => {
  it('bundle 壳包（无入口 + patch 带 insert 行）→ guard ok（壳豁免后不拦）', async () => {
    const tgz = tarballOf(
      { name: 'shell-pkg', version: '0.1.0', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'cordis.patch.yml': '- insert:\n  - id: shell-pkg-host\n    name: shell-pkg-host\n' },
    )
    const r = await probe('shell-pkg', { tarballBuffer: tgz })
    assert.equal(r.skip, undefined)
    assert.equal(r.guard.ok, true, `violations=${JSON.stringify(r.guard.violations)}`)
  })

  it('入口声明指向缺失文件 → guard 命中 ENTRY_UNRESOLVABLE（市场必拦，收录门禁应红）', async () => {
    const tgz = tarballOf({ name: 'broken-pkg', version: '1.0.0', main: 'gone.js', dsh: { client: {} } })
    const r = await probe('broken-pkg', { tarballBuffer: tgz })
    assert.equal(r.guard.ok, false)
    assert.equal(r.guard.violations[0].code, 'ENTRY_UNRESOLVABLE')
  })

  it('scoped 包名解到 node_modules/@scope/name', async () => {
    const tgz = tarballOf(
      { name: '@scope/scoped-shell', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { 'cordis.patch.yml': '- insert:\n  - id: scoped-id\n' },
    )
    const r = await probe('@scope/scoped-shell', { tarballBuffer: tgz })
    assert.equal(r.guard.ok, true)
  })

  it('manifest 缺 dist.tarball → skip（不判红）', async () => {
    const r = await probe('any-pkg', { manifest: { name: 'any-pkg' } })
    assert.equal(r.skip, 'latest manifest 缺 dist.tarball')
    assert.equal(r.guard, undefined)
  })
})
