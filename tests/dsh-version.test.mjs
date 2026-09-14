/**
 * dsh-version：DSH 运行版本解析（市场头部 chip 数据源）。
 * 覆盖：spawn 输出解析、launcher package.json 定位（真实临时目录布局）、
 * CLI/PATH 模式与不可读路径的 null 降级。spawn 真进程不测（薄壳）。
 * 运行：npm run build && node --test tests/dsh-version.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseDshVersionOutput, readLauncherPackageVersion } from '../lib/core/dsh-version.js'

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
    assert.equal(parseDshVersionOutput(undefined ?? ''), null)
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
})
