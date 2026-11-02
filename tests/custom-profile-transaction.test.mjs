/**
 * ADR-0030（issue #39）Task 9：自定义 profile 全链集成——安装/卸载事务在注入的
 * profileDir 上真实执行（变更前快照、runner 工厂、事务路径三件全在注入目录），
 * 并钉「落点不变量」：任何接线回退（写路径静默落回 webProfileDir()）在此红。
 * 运行：npm run build && node --test tests/custom-profile-transaction.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { webProfileDir } from '../lib/core/env.js'

const sha512 = (tag) => `sha512-${tag}${'A'.repeat(20)}`
const cfg = { timeoutMs: 50 }
const TX_ENTRY = { id: 'p', name: 'P', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'pkg-a' }

let cacheRoot = ''
beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'dshm-cptx-'))
  process.env.DSHM_EXTERNAL_JOURNAL_FILE = join(cacheRoot, 'external-operations.json')
})
afterEach(() => {
  delete process.env.DSHM_EXTERNAL_JOURNAL_FILE
  if (cacheRoot) rmSync(cacheRoot, { recursive: true, force: true })
})

/** 造一个最小合法的假 profile 目录（fakeDir 恒 ≠ webProfileDir()——落点不变量的前提）。 */
function fakeProfile(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-aqua-'))
  writeFileSync(join(dir, 'package.json'), files['package.json'] ?? JSON.stringify({ dependencies: { existing: '^1.0.0' } }, null, 2) + '\n')
  writeFileSync(join(dir, 'pnpm-lock.yaml'), files['pnpm-lock.yaml'] ?? "lockfileVersion: '9.0'\n")
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), files['pnpm-workspace.yaml'] ?? 'packages:\n  - .\n')
  return dir
}

function txRegistryDeps(npmLatestResult) {
  return {
    loadRegistry: async () => ({
      configuredAddress: '', activeAddress: null, source: 'default-raw', status: 'ready',
      isDefault: true, stale: false, fetchedAt: null, errors: [], count: 1,
      registry: { version: 1, plugins: [TX_ENTRY] },
    }),
    npmLatest: async () => npmLatestResult,
    precheck: async () => null,
  }
}

describe('ADR-0030 Task 9：自定义 profile 全链落点（横切回归面）', () => {
  it("installFromRegistry：快照/runner/事务三件全落 fakeDir，工厂收到 (fakeDir,'aqua')；落点 ≠ webProfileDir()", async () => {
    const fakeDir = fakeProfile()
    try {
      assert.notEqual(fakeDir, webProfileDir(), '夹具前提：fakeDir 与 webProfileDir() 不同')
      const factories = []
      let addArg = null
      const { installFromRegistry: install } = await import('../lib/core/market-mutation.js')
      const res = await install('p', cfg, {}, {
        ...txRegistryDeps({ version: '1.2.3', integrity: sha512('good') }),
        profileDir: fakeDir,
        profileName: 'aqua',
        transaction: {
          runner: (profileDir, profileName) => {
            factories.push([profileDir, profileName])
            return {
              add: async (spec) => {
                addArg = { profileDir, spec }
                writeFileSync(join(fakeDir, 'package.json'), JSON.stringify({ dependencies: { existing: '^1.0.0', 'pkg-a': '1.2.3' } }, null, 2) + '\n')
                writeFileSync(join(fakeDir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\n\npackages:\n  pkg-a@1.2.3:\n    resolution: {integrity: ${sha512('good')}}\n`)
                // marker 包（market-mutation.test.mjs writeInstalledMarkerPkg 同款）：装后守卫三项检查需要真实包内容
                const pkgDir = join(fakeDir, 'node_modules', 'pkg-a')
                mkdirSync(pkgDir, { recursive: true })
                writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'pkg-a', version: '1.2.3', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
                writeFileSync(join(pkgDir, 'index.js'), 'module.exports = {}\n')
                return { class: 'ok', output: 'added', buildApprovals: [], fallbackAllBuilds: false }
              },
              remove: async () => ({ class: 'ok', output: 'remove-ok' }),
              frozenInstall: async () => ({ class: 'ok', output: 'frozen-ok' }),
              rebuildInstall: async () => ({ class: 'ok', output: 'rebuild-ok' }),
            }
          },
        },
      })
      assert.equal(res.version, '1.2.3', '安装提交')
      assert.deepEqual(factories[0], [fakeDir, 'aqua'], 'runner 工厂收到注入目录与真实 profile 名')
      assert.equal(addArg.profileDir, fakeDir, 'add 操作的 profileDir 即注入目录')
      assert.equal(addArg.spec, 'pkg-a@1.2.3')
      assert.notEqual(factories[0][0], webProfileDir(), '落点不变量：绝不允许落到 webProfileDir()')
    } finally {
      rmSync(fakeDir, { recursive: true, force: true })
    }
  })

  it('canary：fakeDir/package.json 非法 JSON → 快照读取失败拒绝（证明变更前快照读的是 fakeDir）', async () => {
    const fakeDir = fakeProfile({ 'package.json': '{not-json' })
    try {
      const { installFromRegistry: install } = await import('../lib/core/market-mutation.js')
      await assert.rejects(
        install('p', cfg, {}, {
          ...txRegistryDeps({ version: '1.2.3', integrity: sha512('good') }),
          profileDir: fakeDir,
          profileName: 'aqua',
          transaction: { runner: () => { throw new Error('不应到达 runner') } },
        }),
        /变更前状态捕获失败/,
        'fail-closed 快照门读的是 fakeDir/package.json（接线断了好坏在此分辨）',
      )
    } finally {
      rmSync(fakeDir, { recursive: true, force: true })
    }
  })

  it("uninstallPlugin：runner 工厂收到 (fakeDir,'aqua')，validate 走注入目录", async () => {
    const fakeDir = fakeProfile()
    try {
      const factories = []
      const { uninstallPlugin: uninstall } = await import('../lib/core/market-mutation.js')
      await uninstall('pkg-nope', cfg, {}, {
        profileDir: fakeDir,
        profileName: 'aqua',
        transaction: {
          runner: (profileDir, profileName) => {
            factories.push([profileDir, profileName])
            return {
              add: async () => ({ class: 'ok', output: 'add-ok' }),
              remove: async () => ({ class: 'ok', output: 'remove-ok' }),
              frozenInstall: async () => ({ class: 'ok', output: 'frozen-ok' }),
              rebuildInstall: async () => ({ class: 'ok', output: 'rebuild-ok' }),
            }
          },
        },
      }).catch(() => undefined)
      assert.deepEqual(factories[0], [fakeDir, 'aqua'])
      assert.notEqual(factories[0][0], webProfileDir(), '落点不变量：卸载同样不得触碰 webProfileDir()')
    } finally {
      rmSync(fakeDir, { recursive: true, force: true })
    }
  })
})
