/**
 * Task 8：npm exact metadata、pnpm lock integrity 与失败回滚。
 * 运行：npm run build && node --test tests/npm-integrity.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { npmVersion } from '../lib/core/versions.js'
import { readPnpmLockIntegrity, assertNpmIntegrity, snapshotFiles, restoreSnapshots } from '../lib/core/npm-integrity.js'
import { installFromRegistry } from '../lib/core/market.js'

const sha512 = (tag) => `sha512-${tag}${'A'.repeat(20)}`

const LOCK_WITH = (pkg, version, integrity, { quoted = false, peer = '' } = {}) => `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:
  .:
    dependencies:
      ${quoted ? `'${pkg}'` : pkg}:
        specifier: ${version}
        version: ${version}

packages:
  ${quoted ? `'` : ''}${pkg}@${version}${peer}${quoted ? `'` : ''}:
    resolution: {integrity: ${integrity}}

  other@2.0.0:
    resolution: {integrity: ${sha512('other')}}
`

describe('npmVersion：精确版本 metadata', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function stubFetch(url, body) {
    globalThis.fetch = async (got) => {
      if (String(got) === url) {
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected fetch ${got}`)
    }
  }

  it('查询该精确版本 endpoint（不是 /latest）', async () => {
    stubFetch('https://registry.npmjs.org/fake-pkg/1.2.3', {
      version: '1.2.3',
      dist: { integrity: sha512('x'), tarball: 'https://example.com/fake-pkg-1.2.3.tgz' },
    })
    const meta = await npmVersion('fake-pkg', '1.2.3', 1000)
    assert.equal(meta.version, '1.2.3')
    assert.equal(meta.integrity, sha512('x'))
    assert.ok(meta.tarball)
  })

  it('接受 prerelease 与 build metadata', async () => {
    stubFetch('https://registry.npmjs.org/fake-pkg/1.2.3-rc.1', { version: '1.2.3-rc.1', dist: { integrity: sha512('r') } })
    assert.equal((await npmVersion('fake-pkg', '1.2.3-rc.1', 1000)).integrity, sha512('r'))
    stubFetch('https://registry.npmjs.org/fake-pkg/1.2.4+build.1', { version: '1.2.4+build.1', dist: { integrity: sha512('b') } })
    assert.equal((await npmVersion('fake-pkg', '1.2.4+build.1', 1000)).version, '1.2.4+build.1')
  })

  it('拒绝 v 前缀 / range / tag / 脏尾缀（不发请求）', async () => {
    globalThis.fetch = async () => {
      throw new Error('不应发起请求')
    }
    for (const bad of ['v1.2.3', '^1.2.3', '~1.2.3', '>=1.2.3', 'latest', 'next', '1.2.3evil', '1.2', '1.2.3.4']) {
      await assert.rejects(() => npmVersion('fake-pkg', bad, 1000), (err) => /精确版本/.test(err.message))
    }
  })
})

describe('readPnpmLockIntegrity', () => {
  it('unscoped 精确定位 resolution.integrity', () => {
    const text = LOCK_WITH('pkg-a', '1.2.3', sha512('aaa'))
    assert.equal(readPnpmLockIntegrity(text, 'pkg-a', '1.2.3'), sha512('aaa'))
  })

  it('scoped 引号键定位', () => {
    const text = LOCK_WITH('@scope/pkg', '2.0.0', sha512('sss'), { quoted: true })
    assert.equal(readPnpmLockIntegrity(text, '@scope/pkg', '2.0.0'), sha512('sss'))
  })

  it('唯一 peer suffix 可剥离', () => {
    const text = LOCK_WITH('pkg-a', '1.2.3', sha512('ppp'), { peer: '(peer@2.0.0)' })
    assert.equal(readPnpmLockIntegrity(text, 'pkg-a', '1.2.3'), sha512('ppp'))
  })

  it('未找到返回 null', () => {
    const text = LOCK_WITH('pkg-a', '1.2.3', sha512('aaa'))
    assert.equal(readPnpmLockIntegrity(text, 'pkg-a', '9.9.9'), null)
    assert.equal(readPnpmLockIntegrity(text, 'missing-pkg', '1.0.0'), null)
  })

  it('多个 peer suffix integrity 不一致 → fail closed', () => {
    const text = `lockfileVersion: '9.0'
packages:
  pkg-a@1.2.3(peerA@1.0.0):
    resolution: {integrity: ${sha512('one')}}
  pkg-a@1.2.3(peerB@2.0.0):
    resolution: {integrity: ${sha512('two')}}
`
    assert.throws(() => readPnpmLockIntegrity(text, 'pkg-a', '1.2.3'), /唯一|fail closed/)
  })

  it('键重复 → fail closed', () => {
    const text = `lockfileVersion: '9.0'
packages:
  pkg-a@1.2.3:
    resolution: {integrity: ${sha512('one')}}
  pkg-a@1.2.3:
    resolution: {integrity: ${sha512('one')}}
`
    assert.throws(() => readPnpmLockIntegrity(text, 'pkg-a', '1.2.3'), /重复/)
  })

  it('lockfileVersion 非 9.0 → fail closed', () => {
    for (const v of ["'6.0'", "'9.1'", '5.4']) {
      const text = `lockfileVersion: ${v}\npackages:\n  pkg-a@1.2.3:\n    resolution: {integrity: x}\n`
      assert.throws(() => readPnpmLockIntegrity(text, 'pkg-a', '1.2.3'), /9\.0/)
    }
  })

  it('相似包名不会误匹配（pkg-a vs pkg）', () => {
    const text = LOCK_WITH('pkg-a', '1.2.3', sha512('aaa'))
    assert.equal(readPnpmLockIntegrity(text, 'pkg', '1.2.3'), null)
  })
})

describe('assertNpmIntegrity', () => {
  it('一致通过；缺失与不一致都抛错', () => {
    assertNpmIntegrity(sha512('x'), sha512('x'), 'pkg', '1.0.0')
    assert.throws(() => assertNpmIntegrity(sha512('x'), null, 'pkg', '1.0.0'), /找不到/)
    assert.throws(() => assertNpmIntegrity(sha512('x'), sha512('y'), 'pkg', '1.0.0'), /不一致/)
  })
})

describe('snapshot/restore', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dshm-snap-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('原先存在的恢复原字节，原先不存在的删除新文件', async () => {
    const keep = join(dir, 'package.json')
    const created = join(dir, 'pnpm-lock.yaml')
    writeFileSync(keep, '{"original":true}')
    const snaps = await snapshotFiles([keep, created])
    assert.equal(snaps[0].existed, true)
    assert.equal(snaps[1].existed, false)
    // 模拟安装改动/新建
    writeFileSync(keep, '{"mutated":true}')
    writeFileSync(created, 'lockfileVersion: \'9.0\'\n')
    await restoreSnapshots(snaps)
    assert.equal(readFileSync(keep, 'utf8'), '{"original":true}')
    assert.equal(existsSync(created), false)
  })
})

describe('installEntry：integrity fail-closed 与回滚', () => {
  let profile = ''
  beforeEach(() => {
    profile = mkdtempSync(join(tmpdir(), 'dshm-profile-'))
  })
  afterEach(() => {
    rmSync(profile, { recursive: true, force: true })
  })

  const entry = { id: 'p', name: 'P', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'pkg-a' }

  function baseDeps(overrides = {}) {
    return {
      loadRegistry: async () => ({
        configuredAddress: '', activeAddress: null, source: 'default-raw', status: 'ready',
        isDefault: true, stale: false, fetchedAt: null, errors: [], count: 1,
        registry: { version: 1, plugins: [entry] },
      }),
      npmLatest: async () => ({ version: '1.2.3', integrity: sha512('good') }),
      profileDir: profile,
      restoreInstall: async () => undefined,
      ...overrides,
    }
  }

  it('fake install 写入一致 lock → 安装成功', async () => {
    const fakeAdd = async () => {
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'pkg-a': '1.2.3' } }))
      writeFileSync(join(profile, 'pnpm-lock.yaml'), LOCK_WITH('pkg-a', '1.2.3', sha512('good')))
      return { output: 'ok', usedAllowAllBuilds: false }
    }
    const res = await installFromRegistry('p', {}, {}, baseDeps({ addDshPlugin: fakeAdd, readProfileDeps: async () => ({ 'pkg-a': '1.2.3' }) }))
    assert.equal(res.version, '1.2.3')
    assert.equal(res.needsRestart, true)
  })

  it('integrity mismatch → 抛错并 best-effort 回滚到原字节', async () => {
    const originalPkg = JSON.stringify({ dependencies: { existing: '^1.0.0' } })
    const originalLock = 'lockfileVersion: \'9.0\'\npackages:\n  existing@1.0.0:\n    resolution: {integrity: old}\n'
    writeFileSync(join(profile, 'package.json'), originalPkg)
    writeFileSync(join(profile, 'pnpm-lock.yaml'), originalLock)
    let restored = false
    const fakeAdd = async () => {
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }))
      // 写入错误 integrity
      writeFileSync(join(profile, 'pnpm-lock.yaml'), LOCK_WITH('pkg-a', '1.2.3', sha512('EVIL')))
      return { output: 'ok', usedAllowAllBuilds: false }
    }
    await assert.rejects(
      () => installFromRegistry('p', {}, {}, baseDeps({
        addDshPlugin: fakeAdd,
        readProfileDeps: async () => ({ existing: '^1.0.0', 'pkg-a': '1.2.3' }),
        restoreInstall: async () => {
          restored = true
        },
      })),
      (err) => /integrity/.test(err.message),
    )
    assert.equal(readFileSync(join(profile, 'package.json'), 'utf8'), originalPkg, 'manifest 恢复原字节')
    assert.equal(readFileSync(join(profile, 'pnpm-lock.yaml'), 'utf8'), originalLock, 'lockfile 恢复原字节')
    assert.equal(restored, true, '执行了恢复安装')
  })

  it('npm metadata 缺 integrity → 拒绝安装且不触碰 profile', async () => {
    let touched = false
    await assert.rejects(
      () => installFromRegistry('p', {}, {}, baseDeps({
        npmLatest: async () => ({ version: '1.2.3' }),
        addDshPlugin: async () => {
          touched = true
          return { output: '', usedAllowAllBuilds: false }
        },
      })),
      (err) => /缺少 dist integrity/.test(err.message),
    )
    assert.equal(touched, false)
  })

  it('回滚失败同时报告 integrity 与 rollback 两类错误', async () => {
    const fakeAdd = async () => {
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'pkg-a': '1.2.3' } }))
      writeFileSync(join(profile, 'pnpm-lock.yaml'), LOCK_WITH('pkg-a', '1.2.3', sha512('EVIL')))
      return { output: 'ok', usedAllowAllBuilds: false }
    }
    await assert.rejects(
      () => installFromRegistry('p', {}, {}, baseDeps({
        addDshPlugin: fakeAdd,
        readProfileDeps: async () => ({ 'pkg-a': '1.2.3' }),
        restoreInstall: async () => {
          throw new Error('frozen install 也失败')
        },
      })),
      (err) => /integrity 校验失败/.test(err.message) && /人工修复/.test(err.message) && /frozen install 也失败/.test(err.message),
    )
  })

  it('user-specified exact version 走精确 endpoint 而不是 /latest', async () => {
    const realFetch = globalThis.fetch
    afterEach(() => {
      globalThis.fetch = realFetch
    })
    globalThis.fetch = async (got) => {
      const url = String(got)
      if (url === 'https://registry.npmjs.org/pkg-a/1.0.5') {
        return new Response(JSON.stringify({ version: '1.0.5', dist: { integrity: sha512('exact') } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`不应请求 ${url}`)
    }
    const fakeAdd = async () => {
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'pkg-a': '1.0.5' } }))
      writeFileSync(join(profile, 'pnpm-lock.yaml'), LOCK_WITH('pkg-a', '1.0.5', sha512('exact')))
      return { output: 'ok', usedAllowAllBuilds: false }
    }
    const res = await installFromRegistry('p', {}, { version: '1.0.5' }, baseDeps({
      addDshPlugin: fakeAdd,
      readProfileDeps: async () => ({ 'pkg-a': '1.0.5' }),
    }))
    assert.equal(res.version, '1.0.5')
    globalThis.fetch = realFetch
  })
})
