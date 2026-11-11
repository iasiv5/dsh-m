/**
 * README 中英标题结构配对守卫（issue #57 retro）：README.en.md 曾缺失整节会话开关说明，
 * 直到文档清理轮才被发现。级别序列（H2/H3）逐位一致 + 数量相等 = 结构不缺节；
 * 标题文本各用各的语言，不比对内容。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const levels = (f) =>
  readFileSync(join(root, f), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^#{2,3} /.test(l))
    .map((l) => (l.startsWith('### ') ? 'h3' : 'h2'))

describe('README 中英标题结构配对（issue #57 retro）', () => {
  it('H2/H3 级别序列逐位一致且数量相等（防单语缺节）', () => {
    const zh = levels('README.md')
    const en = levels('README.en.md')
    assert.equal(zh.length, en.length, `标题数失配：zh=${zh.length} en=${en.length}`)
    assert.deepEqual(zh, en, '级别序列失配（首个差异位即单语缺节/多节）')
  })
})
