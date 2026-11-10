/**
 * dsh-launch：resolveDshLaunch 三形态识别（ADR-0034 Layer 1，issue #65）。
 *
 * 载体分支（@deepseek-ai/dsh-desktop-host/lib/cli.js）与 asar 入口 cwd 豁免
 * port 自 dshmarket（47e8e27/#975 与 1e86641/#1146）；对照蓝本
 * .dsh-research/dsh-market-fresh/src/dsh-cli.ts:480-503。
 * 全部用例纯注入（argv/execArgv/execPath/argv0/platform），不触真实 PATH（hermetic）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { dshArgv, resolveDshLaunch } from '../lib/core/dsh-cli.js'

describe('dsh-launch：resolveDshLaunch 三形态识别（ADR-0034）', () => {
  const NODE = process.execPath
  const BASE = { argv0: NODE, execPath: NODE, platform: 'linux' }
  let home = ''

  // 夹具树：core node_modules（bin.js 真实存在，entry 分支无 existsSync 依赖，仅形态真实性）
  function makeTree() {
    home = mkdtempSync(join(tmpdir(), 'dshm-launch-'))
    const lib = join(home, 'node_modules', '@deepseek-ai', 'dsh', 'lib')
    mkdirSync(lib, { recursive: true })
    writeFileSync(join(lib, 'bin.js'), '// launcher entry stub')
    const carrierLib = join(home, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib')
    mkdirSync(carrierLib, { recursive: true })
    writeFileSync(join(carrierLib, 'cli.js'), '// carrier stub')
    return home
  }

  it('entry：argv[1]=…/lib/bin.js → node 直启 + cwd=dirname(abs)（回归锚）', () => {
    makeTree()
    try {
      const entry = join(home, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      const l = resolveDshLaunch({ argv: ['node', entry], execArgv: ['--no-warnings'], ...BASE })
      assert.equal(l.file, NODE)
      assert.deepEqual(l.args, ['--no-warnings', entry])
      assert.equal(l.cwd, dirname(entry))
      assert.equal(l.viaShell, false)
      assert.equal(l.source, 'entry')
      assert.equal(l.entry, entry)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('entry：argv[1]=…/bin/dsh（pnpm shim 形态，本机实况）→ 同语义', () => {
    makeTree()
    try {
      const entry = join(home, 'bin', 'dsh')
      const l = resolveDshLaunch({ argv: ['node', entry], execArgv: [], ...BASE })
      assert.equal(l.file, NODE)
      assert.deepEqual(l.args, [entry])
      assert.equal(l.cwd, dirname(entry))
      assert.equal(l.source, 'entry')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('carrier：…/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js → cwd=undefined（设备形态红例）', () => {
    makeTree()
    try {
      const entry = join(home, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
      const l = resolveDshLaunch({ argv: ['node', entry], execArgv: [], ...BASE })
      assert.equal(l.file, NODE)
      assert.deepEqual(l.args, [entry])
      assert.equal(l.cwd, undefined, '载体入口 cwd=undefined：子进程继承 launcher cwd（#975）')
      assert.equal(l.viaShell, false)
      assert.equal(l.source, 'carrier')
      assert.equal(l.entry, entry)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('窄 regex 负例三连 → path-fallback（不接受任意 cli.js，防 PATH 遮蔽）', () => {
    makeTree()
    try {
      const cases = [
        join(home, 'node_modules', '@deepseek-ai', 'other', 'lib', 'cli.js'),
        join(home, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'other.js'),
        join(home, 'somewhere', 'lib', 'cli.js'),
      ]
      for (const entry of cases) {
        const l = resolveDshLaunch({ argv: ['node', entry], execArgv: [], ...BASE })
        assert.equal(l.source, 'path-fallback', `负例应回退：${entry}`)
        assert.equal(l.file, 'dsh')
        assert.deepEqual(l.args, [])
        assert.equal(l.cwd, undefined)
        assert.equal(l.entry, entry)
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('asar：entry 在 .asar 内 → cwd=undefined；carrier+asar 组合同样', () => {
    makeTree()
    try {
      const asarEntry = join(home, 'app.asar', 'inner', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      const l1 = resolveDshLaunch({ argv: ['node', asarEntry], execArgv: [], ...BASE })
      assert.equal(l1.source, 'entry')
      assert.equal(l1.cwd, undefined, 'asar 入口 OS 不能 chdir（#1146）')
      const asarCarrier = join(home, 'app.asar', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
      const l2 = resolveDshLaunch({ argv: ['node', asarCarrier], execArgv: [], ...BASE })
      assert.equal(l2.source, 'carrier')
      assert.equal(l2.cwd, undefined)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('path-fallback：entry undefined / 不像入口 → PATH 回退形态', () => {
    makeTree()
    try {
      const l1 = resolveDshLaunch({ argv: ['node'], execArgv: [], ...BASE })
      assert.equal(l1.source, 'path-fallback')
      assert.equal(l1.file, 'dsh')
      assert.deepEqual(l1.args, [])
      assert.equal(l1.cwd, undefined)
      assert.equal(l1.viaShell, false)
      assert.equal(l1.entry, undefined)
      const l2 = resolveDshLaunch({ argv: ['node', 'cli.mjs'], execArgv: [], ...BASE, platform: 'win32' })
      assert.equal(l2.source, 'path-fallback')
      assert.equal(l2.viaShell, true, 'win32 回退走 cmd shim')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('形状稳定锚：dshArgv 恒四字段显式投影（entry/carrier/fallback 三形态）', () => {
    makeTree()
    try {
      const bin = join(home, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
      const carrier = join(home, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
      const cases = [
        { input: { argv: ['node', bin], execArgv: [], ...BASE }, file: NODE, args: [bin], cwd: dirname(bin), viaShell: false },
        { input: { argv: ['node', carrier], execArgv: [], ...BASE }, file: NODE, args: [carrier], cwd: undefined, viaShell: false },
        { input: { argv: ['node'], execArgv: [], ...BASE }, file: 'dsh', args: [], cwd: undefined, viaShell: false },
      ]
      for (const c of cases) {
        const argv = dshArgv(c.input)
        assert.deepEqual(
          argv,
          { file: c.file, args: c.args, cwd: c.cwd, viaShell: c.viaShell },
          '四字段形状（deepEqual 全键集比对，多余键必炸）',
        )
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
