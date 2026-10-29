/**
 * dsh-version：DSH 运行版本解析（市场头部 chip 数据源）。
 * 覆盖：spawn 输出解析、launcher package.json 定位（真实临时目录布局）、
 * CLI/PATH 模式与不可读路径的 null 降级。spawn 真进程不测（薄壳）。
 * 运行：npm run build && node --test tests/dsh-version.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseDshVersionOutput, readAppAsarVersion, readLauncherPackageVersion, resetDshVersionCacheForTest, resolveDshVersion, resolveDshVersionWith } from '../lib/core/dsh-version.js'

describe('dsh-version：parseDshVersionOutput', () => {
  it('裸版本 / v 前缀 / 带散文 / rc 与 build 元数据', () => {
    assert.equal(parseDshVersionOutput('0.1.5-rc.2\n'), '0.1.5-rc.2')
    assert.equal(parseDshVersionOutput('v1.2.3'), '1.2.3')
    assert.equal(parseDshVersionOutput('dsh version 2.10.0 (node v24)'), '2.10.0')
    assert.equal(parseDshVersionOutput('1.2.3-beta.1+build.5'), '1.2.3-beta.1+build.5')
  })
  it('空 / 垃圾输入 → null', () => {
    assert.equal(parseDshVersionOutput(''), null)
    assert.equal(parseDshVersionOutput('not a version'), null)
    assert.equal(parseDshVersionOutput(''), null)
  })
})

describe('dsh-version：readLauncherPackageVersion', () => {
  const makeTree = () => {
    const root = mkdtempSync(join(tmpdir(), 'dshm-dshver-'))
    const lib = join(root, '@deepseek-ai', 'dsh', 'lib')
    mkdirSync(lib, { recursive: true })
    return { root, lib }
  }

  it('生产布局：argv[1]=lib/bin.js → 就近读 @deepseek-ai/dsh/package.json', () => {
    const { root, lib } = makeTree()
    try {
      writeFileSync(join(root, '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.5-rc.2' }))
      writeFileSync(join(lib, 'bin.js'), '// launcher entry stub')
      const v = readLauncherPackageVersion({ argv: ['node', join(lib, 'bin.js')] })
      assert.equal(v, '0.1.5-rc.2')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('bin 无扩展名形态（…/bin/dsh）同样命中', () => {
    const { root, lib } = makeTree()
    try {
      writeFileSync(join(root, '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '1.0.0' }))
      writeFileSync(join(lib, 'dsh'), '// stub')
      const v = readLauncherPackageVersion({ argv: ['node', join(lib, 'dsh')] })
      assert.equal(v, '1.0.0')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('CLI/PATH 模式（entry 不像 launcher bin）→ null', () => {
    const { root } = makeTree()
    try {
      writeFileSync(join(root, 'cli.mjs'), '// not a launcher entry')
      assert.equal(readLauncherPackageVersion({ argv: ['node', join(root, 'cli.mjs')] }), null)
      assert.equal(readLauncherPackageVersion({ argv: ['node'] }), null)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('package.json 缺失 / version 非法 → null（向上三级封顶后放弃）', () => {
    const { lib } = makeTree()
    try {
      writeFileSync(join(lib, 'bin.js'), '// stub，无任何 package.json')
      assert.equal(readLauncherPackageVersion({ argv: ['node', join(lib, 'bin.js')] }), null)
      // version 非字符串同样降级
      const pkgDir = join(lib, '..')
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: 42 }))
      assert.equal(readLauncherPackageVersion({ argv: ['node', join(lib, 'bin.js')] }), null)
    } finally {
      rmSync(lib, { recursive: true, force: true })
    }
  })

  it('pnpm 全局 shim 形态（F1，0.9.29 装机验收实证）：argv[1] 是指向真实 bin.js 的符号链接 → realpath 后解析出版本', () => {
    const { root, lib } = makeTree()
    try {
      // 真实包树：@deepseek-ai/dsh/package.json + lib/bin.js
      writeFileSync(join(root, '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2' }))
      writeFileSync(join(lib, 'bin.js'), '// launcher entry stub')
      // pnpm home 里的全局 shim：符号链接（本机实况 ~/.local/share/pnpm/dsh 同形态）
      const pnpmHome = join(root, 'pnpm-home')
      mkdirSync(pnpmHome, { recursive: true })
      symlinkSync(join(lib, 'bin.js'), join(pnpmHome, 'dsh'))
      const v = readLauncherPackageVersion({ argv: ['node', join(pnpmHome, 'dsh')] })
      assert.equal(v, '0.2.0-rc.2')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('dsh-version：readAppAsarVersion（issue #32 桌面 asar 通路）', () => {
  // 计划 T0 纪律：fixture 已按评审探针修正——headerSize 含 pickle 两层 u32（= j + 8），
  // 与实现读点 8 + headerSize 及真实 asar 布局三方自洽（probe-task1-fixed.log 14/14）。
  function makeAsarBuffer({ pkg, headerRaw, u32Fixes = {}, truncateTo } = {}) {
    const pkgBuf = Buffer.from(pkg ?? JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.3' }), 'utf8')
    const headerStr = Buffer.from(headerRaw ?? JSON.stringify({ files: { 'package.json': { size: String(pkgBuf.length), offset: '0' } } }), 'utf8')
    const headerSize = headerStr.length + 8
    const buf = Buffer.alloc(16 + headerStr.length + pkgBuf.length)
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    dv.setUint32(0, 4, true); dv.setUint32(4, headerSize, true)
    dv.setUint32(8, headerSize - 4, true); dv.setUint32(12, headerStr.length, true)
    headerStr.copy(buf, 16); pkgBuf.copy(buf, 16 + headerStr.length)
    for (const [off, val] of Object.entries(u32Fixes)) dv.setUint32(Number(off), Number(val), true)
    return truncateTo != null ? buf.subarray(0, truncateTo) : buf
  }
  const writeAsar = (dir, name, buf) => { const p = join(dir, name); writeFileSync(p, buf); return p }
  const makeNodeStub = (dir) => { const p = join(dir, 'node'); writeFileSync(p, '// node stub'); return p }

  it('resourcesPath 候选命中：A 放 app.asar，execPath 指向无 resources 的 B', () => {
    const a = mkdtempSync(join(tmpdir(), 'dshm-asar-a1-'))
    const b = mkdtempSync(join(tmpdir(), 'dshm-asar-b1-'))
    try {
      writeAsar(a, 'app.asar', makeAsarBuffer())
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath: makeNodeStub(b) }), '0.2.1-rc.3')
    } finally {
      rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true })
    }
  })

  it('第二候选回退可达：resourcesPath 空目录（候选 ENOENT），execPath 侧 resources/app.asar 有效', () => {
    const a = mkdtempSync(join(tmpdir(), 'dshm-asar-a2-'))
    const b = mkdtempSync(join(tmpdir(), 'dshm-asar-b2-'))
    try {
      mkdirSync(join(b, 'resources'), { recursive: true })
      writeAsar(join(b, 'resources'), 'app.asar', makeAsarBuffer({ pkg: JSON.stringify({ name: '@deepseek-ai/dsh', version: '1.0.0' }) }))
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath: makeNodeStub(b) }), '1.0.0')
    } finally {
      rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true })
    }
  })

  it('name 精确形态 / version 严格 semver 守卫：不符 → null（P1/P2 收紧）', () => {
    const a = mkdtempSync(join(tmpdir(), 'dshm-asar-a3-'))
    const b = mkdtempSync(join(tmpdir(), 'dshm-asar-b3-'))
    try {
      writeAsar(a, 'app.asar', makeAsarBuffer({ pkg: JSON.stringify({ name: '@evil/pkg', version: '9.9.9' }) }))
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath: makeNodeStub(b) }), null)
      // P1：近形名拒收（无分隔符的 dshx 不是 @deepseek-ai/dsh 系）
      writeAsar(a, 'app.asar', makeAsarBuffer({ pkg: JSON.stringify({ name: '@deepseek-ai/dshx', version: '9.9.9' }) }))
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath: makeNodeStub(b) }), null)
      // P1 正边界：合法连字符后缀仍是 @deepseek-ai/dsh 系
      writeAsar(a, 'app.asar', makeAsarBuffer({ pkg: JSON.stringify({ name: '@deepseek-ai/dsh-skill', version: '0.2.1-rc.3' }) }))
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath: makeNodeStub(b) }), '0.2.1-rc.3')
      // P2：非严格 semver 拒收（前导零）
      writeAsar(a, 'app.asar', makeAsarBuffer({ pkg: JSON.stringify({ name: '@deepseek-ai/dsh', version: 'not-semver' }) }))
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath: makeNodeStub(b) }), null)
      writeAsar(a, 'app.asar', makeAsarBuffer({ pkg: JSON.stringify({ name: '@deepseek-ai/dsh', version: '01.2.3' }) }))
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath: makeNodeStub(b) }), null)
    } finally {
      rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true })
    }
  })

  it('结构守卫全 null（5 组断言）：截断 / 坏 pickle 标记 / JSON 损坏 / 无 package.json 条目 / size 越界', () => {
    const a = mkdtempSync(join(tmpdir(), 'dshm-asar-a4-'))
    const b = mkdtempSync(join(tmpdir(), 'dshm-asar-b4-'))
    try {
      const execPath = makeNodeStub(b) // b 无 resources → 第二候选恒 null，噪声排除
      writeAsar(a, 'app.asar', makeAsarBuffer({ truncateTo: 10 }))
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath }), null)
      writeAsar(a, 'app.asar', makeAsarBuffer({ u32Fixes: { 0: 9 } }))
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath }), null)
      writeAsar(a, 'app.asar', makeAsarBuffer({ headerRaw: '{"files":' }))
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath }), null)
      writeAsar(a, 'app.asar', makeAsarBuffer({ headerRaw: '{"files":{}}' }))
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath }), null)
      writeAsar(a, 'app.asar', makeAsarBuffer({ headerRaw: JSON.stringify({ files: { 'package.json': { size: '999999999', offset: '0' } } }) }))
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath }), null)
    } finally {
      rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true })
    }
  })

  it('生产默认（零注入）：本测试进程 execPath 旁无 resources/app.asar → null', () => {
    assert.equal(readAppAsarVersion(), null)
  })

  it('双候选并存钉顺序：A/B 同时有效 → 返回 resourcesPath 侧（Task 4 锚①红灯判据）', () => {
    const a = mkdtempSync(join(tmpdir(), 'dshm-asar-a6-'))
    const b = mkdtempSync(join(tmpdir(), 'dshm-asar-b6-'))
    try {
      writeAsar(a, 'app.asar', makeAsarBuffer({ pkg: JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.3' }) }))
      mkdirSync(join(b, 'resources'), { recursive: true })
      writeAsar(join(b, 'resources'), 'app.asar', makeAsarBuffer({ pkg: JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.4' }) }))
      assert.equal(readAppAsarVersion({ resourcesPath: a, execPath: makeNodeStub(b) }), '0.2.1-rc.3')
    } finally {
      rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true })
    }
  })
})

describe('dsh-version：resolveDshVersionWith（issue #32 编排与门控）', () => {
  const makeDeps = ({ asarV = null, launcherV = null, spawnV = null, isElectron = false } = {}) => {
    const counts = { launcher: 0, spawn: 0 }
    const deps = {
      readAsar: () => asarV,
      readLauncher: () => { counts.launcher += 1; return launcherV },
      spawnVersion: async () => { counts.spawn += 1; return spawnV },
      isElectron,
    }
    return { deps, counts }
  }

  it('asar 桩命中 → 不触 launcher/spawn（asar 优先）', async () => {
    const { deps, counts } = makeDeps({ asarV: '9.9.9', launcherV: '0.2.0-rc.2', spawnV: '0.1.0-rc.6' })
    assert.equal(await resolveDshVersionWith(deps), '9.9.9')
    assert.equal(counts.launcher, 0)
    assert.equal(counts.spawn, 0)
  })

  it('asar null → launcher 命中，spawn 零调用', async () => {
    const { deps, counts } = makeDeps({ launcherV: '0.2.0-rc.2', spawnV: '0.1.0-rc.6' })
    assert.equal(await resolveDshVersionWith(deps), '0.2.0-rc.2')
    assert.equal(counts.spawn, 0)
  })

  it('双 null + 非 Electron → 采信 spawn（web/CLI 兼容守卫锚）', async () => {
    const { deps, counts } = makeDeps({ spawnV: '0.1.0-rc.6', isElectron: false })
    assert.equal(await resolveDshVersionWith(deps), '0.1.0-rc.6')
    assert.equal(counts.spawn, 1)
  })

  it('双 null + Electron → null 且 spawn 零调用（桌面门控核心锚）', async () => {
    const { deps, counts } = makeDeps({ spawnV: '0.1.0-rc.6', isElectron: true })
    assert.equal(await resolveDshVersionWith(deps), null)
    assert.equal(counts.spawn, 0)
  })

  it('不记忆化：同一 deps 两次调用 spawn 计数 2', async () => {
    const { deps, counts } = makeDeps({ spawnV: '0.1.0-rc.6' })
    await resolveDshVersionWith(deps)
    await resolveDshVersionWith(deps)
    assert.equal(counts.spawn, 2)
  })
})

describe('dsh-version：resolveDshVersion 生产 memo（S3 备案随版落地）', () => {
  it('两次调用同一 Promise 身份（memo 契约：宿主预热与预检共用一次解析）', async () => {
    resetDshVersionCacheForTest()
    try {
      const p1 = resolveDshVersion({ deps: { readAsar: () => '9.9.9' } })
      const p2 = resolveDshVersion({ deps: { readAsar: () => '9.9.9' } })
      assert.strictEqual(p1, p2)
      assert.equal(await p1, '9.9.9')
      assert.equal(await p2, '9.9.9')
    } finally {
      resetDshVersionCacheForTest()
    }
  })

  it('memo 下解析只做一次；reset 后换新 Promise 重做（spawn 计费 1 → 2）；deps 超时缝优先级 opts > deps（P3 修复）', async () => {
    resetDshVersionCacheForTest()
    try {
      const counts = { spawn: 0, timeout: 0 }
      const spawnDeps = {
        readAsar: () => null,
        readLauncher: () => null,
        fallbackTimeoutMs: 1234,
        spawnVersion: async (timeoutMs) => { counts.spawn += 1; counts.timeout = timeoutMs; return '0.1.0-rc.6' },
      }
      await resolveDshVersion({ deps: spawnDeps })
      await resolveDshVersion({ deps: spawnDeps })
      assert.equal(counts.spawn, 1)
      assert.equal(counts.timeout, 1234) // P3：deps 缝的 fallbackTimeoutMs 不得被 opts 的 undefined 覆写
      const before = resolveDshVersion({ deps: spawnDeps })
      resetDshVersionCacheForTest()
      assert.notStrictEqual(before, resolveDshVersion({ deps: spawnDeps, fallbackTimeoutMs: 4321 }))
      assert.equal(counts.spawn, 2)
      assert.equal(counts.timeout, 4321) // 显式 opts 仍最高优先
    } finally {
      resetDshVersionCacheForTest()
    }
  })

  it('空串 asar 结果被编排层拒收 → 落 launcher/spawn 桩；结果恒不 reject', async () => {
    resetDshVersionCacheForTest()
    try {
      const v = await resolveDshVersion({
        deps: { readAsar: () => '', readLauncher: () => null, spawnVersion: async () => '0.2.0' },
      })
      assert.equal(v, '0.2.0')
    } finally {
      resetDshVersionCacheForTest()
    }
  })
})
