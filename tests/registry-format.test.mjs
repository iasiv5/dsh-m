/**
 * registry.json 格式稳定守卫：紧凑单行风格是手工维护约定，不是 schema 可表达的。
 * 实录（2026-10-30）：`JSON.parse → JSON.stringify(, null, 2)` 改 3 个字段产出 231 行
 * 整库重排 diff，validate-registry（纯语义）全绿放行——本测试把这类重写拦在 PR 阶段。
 * 规则：字段一律单行（数组同行内闭合）；行数与条目数线性挂钩。
 * 运行：node --test tests/registry-format.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(root, 'registry.json'), 'utf8')
// CRLF 检出（CODING-STANDARDS 测试锚纪律 §3）：先剥 \r 再做行级判定，防止行尾 $ 锚恒不匹配
const lines = raw.split('\n').map((line) => line.replace(/\r$/, ''))
const pluginCount = JSON.parse(raw).plugins.length

describe('registry.json 格式稳定（紧凑单行风格）', () => {
  it('任何条目字段都不开启多行数组（行尾不得是字段名的 "["）', () => {
    const bad = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /^ {4,}"[^"]+": \[$/.test(line))
    assert.deepEqual(
      bad.map(({ n, line }) => `L${n}: ${line.trim()}`),
      [],
      '发现多行数组字段——registry.json 用紧凑单行风格手工编辑，禁止 JSON.parse→stringify 整库重排（见 tests/registry-format.test.mjs 头注实录）',
    )
  })

  it('不存在缩进的独立数组闭合行（"]" 独占一行且缩进 ≥4 空格）', () => {
    const bad = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /^ {4,}\],?$/.test(line))
    assert.deepEqual(
      bad.map(({ n, line }) => `L${n}: ${line.trim()}`),
      [],
      '发现独立数组闭合行——同上，手工按原风格编辑',
    )
  })

  it(`行数与条目数线性挂钩（${lines.length} 行 / ${pluginCount} 条，上界 16N+12）`, () => {
    assert.ok(
      lines.length <= 16 * pluginCount + 12,
      `registry.json ${lines.length} 行超出 ${16 * pluginCount + 12} 上界——疑似整库重排或夹带多行格式`,
    )
    assert.ok(
      lines.length >= pluginCount * 6,
      `registry.json 仅 ${lines.length} 行低于 ${pluginCount * 6} 下界——疑似被压缩成单行`,
    )
  })
})
