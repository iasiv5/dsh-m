/**
 * ADR-0030（issue #39）：dshm CLI 自定义 profile 门禁放开与写命令接线。
 * 门禁：安全自定义名放行；desktop/tauri 名拒绝（CLI 不做桌面文件事务）；不安全名拒绝。
 * 运行：npm run build && node --test tests/cli-custom-profile.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { webProfileDir, desktopProfileDir, dshHome } from '../lib/core/env.js'

async function runCapture(argv, deps = {}) {
  const { runCli } = await import('../lib/cli.js')
  const lines = []
  const errLines = []
  const code = await runCli(argv, deps, { out: (l) => lines.push(l), err: (l) => errLines.push(l) })
  return { code, text: lines.join('\n'), errText: errLines.join('\n') }
}

let cacheRoot = ''
beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'dshm-cli-cp-'))
  // install/upgrade/uninstall 成功/失败都会落外部操作日志——隔离，不触碰真实 ~/.dsh
  process.env.DSHM_EXTERNAL_JOURNAL_FILE = join(cacheRoot, 'external-operations.json')
})
afterEach(() => {
  delete process.env.DSHM_EXTERNAL_JOURNAL_FILE
  if (cacheRoot) rmSync(cacheRoot, { recursive: true, force: true })
})

const installResult = { id: 'p', pkg: 'p', spec: 'p@1.0.0', version: '1.0.0', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true, output: '' }
const upgradeResult = { id: 'p', pkg: 'p', spec: 'p@2.0.0', version: '2.0.0', buildApprovals: [], fallbackAllBuilds: false, needsRestart: true, output: '', fromVersion: '1.0.0' }
const uninstallResult = { pkg: 'p', liveDisabled: false, needsRestart: true, leftovers: [] }
const toggleResult = { pkg: 'p', enabled: true, applied: 'restart-required', via: 'fallback', warnings: [] }

describe('ADR-0030：dshm CLI 门禁放开 + 写命令接线', () => {
  it("--profile aqua install --id p → 放行，installFromRegistry deps 收 profileDir/profileName", async () => {
    const captured = []
    const { code } = await runCapture(['install', '--id', 'p', '--profile', 'aqua'], {
      installFromRegistry: async (id, cfg, opts, deps) => { captured.push({ id, deps }); return installResult },
    })
    assert.equal(code, 0)
    assert.equal(captured[0].deps.profileDir, join(dshHome(), 'profiles', 'aqua'))
    assert.equal(captured[0].deps.profileName, 'aqua')
  })

  it("--profile aqua upgrade --pkg p --yes → 放行，upgradePlugin deps 接线", async () => {
    const captured = []
    const { code } = await runCapture(['upgrade', '--pkg', 'p', '--yes', '--profile', 'aqua'], {
      upgradePlugin: async (pkg, cfg, opts, deps) => { captured.push({ pkg, deps }); return upgradeResult },
    })
    assert.equal(code, 0)
    assert.equal(captured[0].deps.profileDir, join(dshHome(), 'profiles', 'aqua'))
    assert.equal(captured[0].deps.profileName, 'aqua')
  })

  it("--profile aqua uninstall --pkg p --yes → 放行，uninstallPlugin deps 接线", async () => {
    const captured = []
    const { code } = await runCapture(['uninstall', '--pkg', 'p', '--yes', '--profile', 'aqua'], {
      uninstallPlugin: async (pkg, cfg, opts, deps) => { captured.push({ pkg, deps }); return uninstallResult },
    })
    assert.equal(code, 0)
    assert.equal(captured[0].deps.profileDir, join(dshHome(), 'profiles', 'aqua'))
    assert.equal(captured[0].deps.profileName, 'aqua')
  })

  it("--profile aqua toggle --pkg p --on --yes → 放行，togglePlugin deps 收 profileDir", async () => {
    const captured = []
    const { code } = await runCapture(['toggle', '--pkg', 'p', '--on', '--yes', '--profile', 'aqua'], {
      togglePlugin: async (pkg, enabled, deps) => { captured.push({ pkg, enabled, deps }); return toggleResult },
    })
    assert.equal(code, 0)
    assert.equal(captured[0].deps.profileDir, join(dshHome(), 'profiles', 'aqua'))
  })

  it('--profile desktop install → 拒绝并指引官方 Desktop 插件管理页', async () => {
    const { code, errText } = await runCapture(['install', '--id', 'p', '--profile', 'desktop'], {})
    assert.equal(code, 1)
    assert.ok(errText.includes('desktop'), '拒绝文案应点明 desktop')
  })

  it('--profile tauri install → 拒绝', async () => {
    const { code } = await runCapture(['install', '--id', 'p', '--profile', 'tauri'], {})
    assert.equal(code, 1)
  })

  it('--profile ../evil install → 拒绝（名字不可用作目录段）', async () => {
    const { code, errText } = await runCapture(['install', '--id', 'p', '--profile', '../evil'], {})
    assert.equal(code, 1)
    assert.ok(errText.includes('不可用作目录段') || errText.includes('不支持'), '拒绝文案锚')
  })

  it('无 flag install → web 零漂移（profileName web / dir webProfileDir()）', async () => {
    const captured = []
    const { code } = await runCapture(['install', '--id', 'p'], {
      installFromRegistry: async (id, cfg, opts, deps) => { captured.push({ deps }); return installResult },
    })
    assert.equal(code, 0)
    assert.equal(captured[0].deps.profileDir, webProfileDir())
    assert.equal(captured[0].deps.profileName, 'web')
  })

  it('doctor --profile aqua --json → profileDir 为 profiles/aqua；--profile desktop --json → desktopProfileDir()', async () => {
    const aqua = await runCapture(['doctor', '--json', '--profile', 'aqua'], {})
    assert.equal(aqua.code, 0)
    const aquaReport = JSON.parse(aqua.text)
    assert.equal(aquaReport.profileDir, join(dshHome(), 'profiles', 'aqua'))
    const desktop = await runCapture(['doctor', '--json', '--profile', 'desktop'], {})
    assert.equal(desktop.code, 0)
    const desktopReport = JSON.parse(desktop.text)
    assert.equal(desktopReport.profileDir, desktopProfileDir())
  })

  // ---------- 读侧接线（issue #42）：list/outdated/search 必须把 --profile 传进 core ----------
  // 断言只看 captured opts 与 exit code，不匹配输出文本；夹具 registryState 字面量同
  // host-api-profile.test.mjs 既有 listMarket 形态。注意：outdated 夹具必须带 community.status
  // 走真路径——market.test.mjs :918 既有夹具缺该字段靠 dispatch catch 兜 exit 1，不模仿。
  it('--profile aqua list → listInstalledWithMeta opts 收 profileDir/profile', async () => {
    const captured = []
    const { code } = await runCapture(['list', '--profile', 'aqua'], {
      listInstalledWithMeta: async (cfg, opts) => {
        captured.push(opts)
        return { items: [], others: 0, profileDir: join(dshHome(), 'profiles', 'aqua'), registryState: { status: 'stale', source: 'bundled', stale: true, isDefault: true, fetchedAt: null, errors: [], count: 0 }, community: { status: 'ready', acceptedCount: 0 } }
      },
    })
    assert.equal(code, 0)
    assert.equal(captured[0].profileDir, join(dshHome(), 'profiles', 'aqua'), 'list 已装枚举不得落 webProfileDir()')
    assert.equal(captured[0].profile, 'aqua', 'registry/社区缓存按 profile 分段')
  })

  it('--profile aqua outdated → listInstalledWithMeta opts 收 profileDir/profile', async () => {
    const captured = []
    const { code } = await runCapture(['outdated', '--profile', 'aqua'], {
      listInstalledWithMeta: async (cfg, opts) => {
        captured.push(opts)
        return { items: [{ pkg: 'p', name: 'p', version: '1.2.3', source: 'npm', spec: 'p@1.2.3', outdated: false, latestErrorCode: null, registryId: 'p', latestVersion: '1.2.3' }], others: 0, profileDir: join(dshHome(), 'profiles', 'aqua'), registryState: { status: 'stale', source: 'bundled', stale: true, isDefault: true, fetchedAt: null, errors: [], count: 0 }, community: { status: 'ready', acceptedCount: 0 } }
      },
    })
    assert.equal(code, 0)
    assert.equal(captured[0].profileDir, join(dshHome(), 'profiles', 'aqua'), 'outdated 已装枚举不得落 webProfileDir()')
    assert.equal(captured[0].profile, 'aqua', 'registry/社区缓存按 profile 分段')
  })

  it('--profile aqua search kw → listMarket opts 收 profileDir/profile', async () => {
    const captured = []
    const { code } = await runCapture(['search', 'kw', '--profile', 'aqua'], {
      listMarket: async (cfg, opts) => {
        captured.push(opts)
        return { items: [], total: 0, offset: 0, limit: 10, categoryCounts: { primary: 0, community: 0 }, registryState: { status: 'stale', source: 'bundled', stale: true, isDefault: true, fetchedAt: null, errors: [], count: 0 }, community: { status: 'ready', acceptedCount: 0 } }
      },
    })
    assert.equal(code, 0)
    assert.equal(captured[0].profileDir, join(dshHome(), 'profiles', 'aqua'), 'search 已装徽标不得落 webProfileDir()')
    assert.equal(captured[0].profile, 'aqua', 'registry/社区缓存按 profile 分段')
  })
})
