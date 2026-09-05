/**
 * 2026-09-05 dsh-better-sidebar 安装失败回归：
 * pnpm `--reporter=ndjson` 的错误行 ~1.2KB，错误码/信息/hint 在行首、栈帧在行尾。
 * runCommand 旧实现盲取末 800 字符 → ERR_PNPM_IGNORED_BUILDS 与 node-pty 关键字全丢，
 * isPrepareBlocked 匹配不到 → dangerouslyAllowAllBuilds 自愈重试从未触发，
 * 安装直接失败回滚，用户只看到一屏 pnpm 栈帧。
 * 验收：长输出失败时错误码必须在异常信息里存活，isPrepareBlocked 能接住并触发重试。
 * 运行：npm run build && node --test tests/run-command-error-digest.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { errorDigest, isPrepareBlocked, runCommand } from '../lib/core/dsh-cli.js'

/** 与线上事故同形的 pnpm ndjson 错误行（栈帧拉满到 >800 字符）。 */
const NDJSON_IGNORED_BUILDS_LINE = JSON.stringify({
  time: 1788619870685,
  hostname: 'bmc-build-server1',
  level: 'error',
  name: 'pnpm',
  code: 'ERR_PNPM_IGNORED_BUILDS',
  hint: 'Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.',
  err: {
    message: 'Ignored build scripts: node-pty@1.1.0',
    code: 'ERR_PNPM_IGNORED_BUILDS',
    stack: [
      'pnpm: Ignored build scripts: node-pty@1.1.0',
      ...Array.from(
        { length: 8 },
        (_, i) => `    at async frame${i} (file:///bmc/iasi/.cache/node/corepack/v1/pnpm/11.25.0/dist/pnpm.mjs:${223210 + i * 100}:11)`,
      ),
    ].join('\n'),
  },
})

function ndjsonOutput({ progressLines = 3 } = {}) {
  const progress = Array.from({ length: progressLines }, (_, i) =>
    JSON.stringify({ time: 1788619870000 + i, level: 'info', name: 'pnpm:progress', status: 'fetched', packageId: `dep-${i}@1.0.0` }))
  return [...progress, NDJSON_IGNORED_BUILDS_LINE].join('\n')
}

describe('errorDigest：失败摘要必须让错误码在长输出里存活', () => {
  it('ndjson 错误行超长时提取 code — message — hint，丢弃栈帧', () => {
    assert.ok(NDJSON_IGNORED_BUILDS_LINE.length > 800, 'fixture 应超过旧实现的 800 字符截断线')
    const digest = errorDigest(ndjsonOutput())
    assert.ok(digest.includes('ERR_PNPM_IGNORED_BUILDS'), `错误码应存活：${digest.slice(0, 200)}`)
    assert.ok(digest.includes('node-pty@1.1.0'), '触发构建的包名应存活')
    assert.ok(digest.includes('approve-builds'), '修复 hint 应保留')
    assert.ok(!digest.includes('at async frame'), '栈帧噪音应被丢弃')
  })

  it('preamble 行数多、错误行在末尾时仍能命中（从后往前扫）', () => {
    const digest = errorDigest(ndjsonOutput({ progressLines: 50 }))
    assert.ok(digest.includes('ERR_PNPM_IGNORED_BUILDS'))
    assert.ok(digest.includes('node-pty@1.1.0'))
  })

  it('短输出原样透传（不改变短报错的行为）', () => {
    const short = 'npm error missing script: build'
    assert.equal(errorDigest(short), short)
  })

  it('纯文本长输出保留含 ERR_ 码的行', () => {
    const noise = Array.from({ length: 40 }, (_, i) => `progress step ${i} ok`).join('\n')
    const out = `${noise}\nERR_PNPM_OUTDATED_LOCKFILE: your lockfile is outdated\n${'x'.repeat(900)}`
    const digest = errorDigest(out)
    assert.ok(digest.includes('ERR_PNPM_OUTDATED_LOCKFILE'))
  })

  it('无任何可识别标记时退回尾部截断（向后兼容）', () => {
    const out = Array.from({ length: 100 }, (_, i) => `plain line ${i}`).join('\n')
    const digest = errorDigest(out)
    assert.ok(digest.length <= 800)
    assert.equal(digest, out.trim().slice(-800), '应是完整输出的末 800 字符')
  })

  it('空输出返回空串（runCommand 层继续报 no output）', () => {
    assert.equal(errorDigest('   \n  '), '')
  })
})

describe('runCommand：失败异常必须能被 isPrepareBlocked 接住（端到端回归）', () => {
  it('长 ndjson IGNORED_BUILDS 输出 → 异常含错误码，isPrepareBlocked 命中', async () => {
    const script = `process.stdout.write(${JSON.stringify(ndjsonOutput() + '\n')});process.exit(1)`
    await assert.rejects(
      runCommand(process.execPath, ['-e', script], { timeoutMs: 15_000 }),
      (err) => {
        const text = err instanceof Error ? err.message : String(err)
        assert.ok(text.startsWith('命令失败 (exit 1)'), `应保留退出码前缀：${text.slice(0, 80)}`)
        assert.ok(text.includes('ERR_PNPM_IGNORED_BUILDS'), `错误码必须存活（旧实现被尾截丢弃）：${text.slice(0, 200)}`)
        assert.ok(text.includes('node-pty@1.1.0'), '包名必须存活')
        assert.equal(isPrepareBlocked(text), true, 'isPrepareBlocked 必须命中，否则 dangerouslyAllowAllBuilds 重试不会触发')
        return true
      },
    )
  })

  it('exit 0 仍然正常解析（不误伤成功路径）', async () => {
    const out = await runCommand(process.execPath, ['-e', 'console.log("ok")'], { timeoutMs: 15_000 })
    assert.ok(out.includes('ok'))
  })

  it('短报错的普通命令失败仍带原始输出', async () => {
    await assert.rejects(
      runCommand(process.execPath, ['-e', 'console.error("boom-detail");process.exit(3)'], { timeoutMs: 15_000 }),
      (err) => {
        const text = err instanceof Error ? err.message : String(err)
        assert.ok(text.startsWith('命令失败 (exit 3)'))
        assert.ok(text.includes('boom-detail'))
        return true
      },
    )
  })
})
