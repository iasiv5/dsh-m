/**
 * T7 守卫：bundled registry.json 的 icon 字段只能是 https URL（用户 Q7 定案 + 评审 Q1 三层结构之③）。
 * 校验层（validateRegistry）兜底整份拒绝；此测试把违规拦在 PR 阶段、先于发布。
 * 运行：node --test tests/registry-icon-url.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'))

describe('registry.json icon 字段 https 守卫（ADR-0025）', () => {
  it('凡带 icon 的条目必须是可解析的 https URL', () => {
    const bad = []
    for (const e of registry.plugins) {
      if (e.icon === undefined) continue
      const ok = typeof e.icon === 'string' && e.icon.startsWith('https://') && (() => { try { new URL(e.icon); return true } catch { return false } })()
      if (!ok) bad.push(`${e.id}: ${JSON.stringify(e.icon)}`)
    }
    assert.deepEqual(bad, [], `icon 字段违规条目（只允许 https URL）：\n${bad.join('\n')}`)
  })
})
