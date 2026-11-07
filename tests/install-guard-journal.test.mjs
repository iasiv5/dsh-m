/**
 * guardJournalLine：装后守卫拦截的结构化 journal 行（2026-11-07 agentero-dsh 实录沉淀）。
 * 实录：守卫拦截补偿后 violations（code/detail）只在 GUI 文案里，host 端零落账，
 * 事后诊断只能读码 + tarball 取证重建根因。本函数把 wire 投影成单行 JSON，
 * 由 throwCompensated 四个 throw 位点与 guardManualRequired 经 console.error 落 journal。
 * 运行：npm run build && node --test tests/install-guard-journal.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { guardJournalLine, InstallGuardError } from '../lib/core/market-mutation.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function blockedErr(overrides = {}) {
  return new InstallGuardError({
    kind: 'compensated',
    message: '安装违例（ENTRY_UNRESOLVABLE: 测试细节），已自动卸载（补偿事务 committed）',
    violations: [{ pkg: 'pkg-shell', code: 'ENTRY_UNRESOLVABLE', detail: 'package.json 缺少 exports/main 入口声明' }],
    needsRestart: true,
    restartSafe: true,
    compensation: { status: 'committed', note: 'done' },
    ...overrides,
  })
}

describe('guardJournalLine 单行结构化 journal', () => {
  it('单行 JSON：pkg/kind/violations code/compensation 齐全，无换行', () => {
    const line = guardJournalLine(blockedErr())
    const LF = String.fromCharCode(10) // 源锚卫生：测试源禁含 \n 字面量（CRLF 工作树恒真），LF 经码点构造
    assert.equal(line.includes(LF), false, 'journal 行不得含换行')
    const parsed = JSON.parse(line.startsWith('[dsh-m:guard] ') ? line.slice('[dsh-m:guard] '.length) : line)
    assert.equal(parsed.pkg, 'pkg-shell')
    assert.equal(parsed.kind, 'compensated')
    assert.deepEqual(parsed.violations, [{ code: 'ENTRY_UNRESOLVABLE', detail: 'package.json 缺少 exports/main 入口声明' }])
    assert.equal(parsed.compensation, 'committed')
  })

  it('violations 为空（manual 场景）→ pkg=unknown 不炸', () => {
    const line = guardJournalLine(blockedErr({ violations: [], compensation: { status: 'pre-mutation', note: 'n' } }))
    const parsed = JSON.parse(line.replace(/^\[dsh-m:guard\] /, ''))
    assert.equal(parsed.pkg, 'unknown')
    assert.deepEqual(parsed.violations, [])
  })

  it('detail 超 200 字符截断（journal 行防刷屏）', () => {
    const long = 'x'.repeat(500)
    const line = guardJournalLine(blockedErr({ violations: [{ pkg: 'p', code: 'ENTRY_UNRESOLVABLE', detail: long }] }))
    assert.ok(line.length < 600, `journal 行应截断 detail，实际 ${line.length} 字符`)
    assert.equal(line.includes('x'.repeat(201)), false)
  })

  it('源结构锚：journal 行在 InstallGuardError 构造器单点接线（覆盖全部 7 个构造位点）', () => {
    const src = readFileSync(join(root, 'src', 'core', 'market-mutation.ts'), 'utf8')
    const wired = src.split('console.error(guardJournalLine(this))').length - 1
    assert.equal(wired, 1, `期望构造器内单点接线（覆盖 7 处 new InstallGuardError），实为 ${wired}`)
    assert.equal(src.split('export function guardJournalLine(').length - 1, 1, 'guardJournalLine 应恰好导出一处')
  })
})
