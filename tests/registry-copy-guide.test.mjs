/**
 * registry-copy-guide 头部计数守卫（收录三连第 2 项机械化，2026-11-01 retro）。
 * 头部「当前 N 条收录条目」必须与 registry.json 的 plugins 长度一致；收录时漏改头部即本测试红。
 * 运行：node --test tests/registry-copy-guide.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('registry-copy-guide 头部计数与 registry.json 一致', () => {
  it('头部「当前 N 条收录条目」== registry.json plugins 长度', () => {
    const guide = readFileSync(join(root, 'docs', 'registry-copy-guide.md'), 'utf8')
    const m = guide.match(/当前 (\d+) 条收录条目/)
    assert.ok(m, 'copy-guide 头部需含「当前 N 条收录条目」')
    const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'))
    assert.equal(
      Number(m[1]),
      registry.plugins.length,
      `copy-guide 头部写 ${m[1]} 条，registry.json 实为 ${registry.plugins.length} 条——收录时须同步更新头部计数与 trail（§11）`,
    )
  })
})
