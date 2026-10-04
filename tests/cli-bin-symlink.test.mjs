/**
 * F2（0.9.28-0.9.29 实证）：pnpm 的 node_modules/.bin/dshm 是指向 lib/cli.js 的
 * 符号链接——node 对入口做 realpath，import.meta.url 是真实路径而 argv[1] 仍是
 * 链接路径，invokedDirectly 直接比较永假 → bin 入口全命令静默 exit 0。
 * 修复：比较前对 argv[1] 同样 realpath。本文件经符号链接调用 CLI 验证复活。
 * 运行：npm run build && node --test tests/cli-bin-symlink.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CLI_JS = fileURLToPath(new URL('../lib/cli.js', import.meta.url))

describe('CLI bin 符号链接入口（F2）', () => {
  /** 建符号链接；无权限环境（Windows 未开开发者模式）照仓内先例 skip。 */
  function makeLink(target, link, t) {
    try {
      symlinkSync(target, link)
    } catch (err) {
      if (err?.code === 'EPERM') t.skip('当前环境无符号链接权限（Windows 未开开发者模式/非管理员）')
      throw err
    }
  }

  it('经指向 lib/cli.js 的符号链接调用 --help → 输出 HELP（修复前静默 exit 0）', (t) => {
    const home = mkdtempSync(join(tmpdir(), 'dshm-binf2-'))
    try {
      const link = join(home, 'dshm') // 模拟 node_modules/.bin/dshm 的符号链接形态
      makeLink(CLI_JS, link, t)
      const r = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' })
      assert.equal(r.status, 0)
      assert.ok(r.stdout.includes('dshm — DSH Marketplace'), `stdout 应含 HELP 标题，实际：${JSON.stringify((r.stdout || '').slice(0, 80))}`)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('经符号链接调用 doctor --json → 命令真实执行（对空 profile 出报告信封）', (t) => {
    const home = mkdtempSync(join(tmpdir(), 'dshm-binf2b-'))
    try {
      const profile = join(home, 'profiles', 'web')
      mkdirSync(profile, { recursive: true })
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: {} }))
      const link = join(home, 'dshm')
      makeLink(CLI_JS, link, t)
      const r = spawnSync(process.execPath, [link, 'doctor', '--json'], {
        encoding: 'utf8',
        env: { ...process.env, DSH_HOME: home },
      })
      assert.equal(r.status, 0)
      const report = JSON.parse(r.stdout)
      assert.equal(report.schema, 'dsh-m/doctor/v1')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
