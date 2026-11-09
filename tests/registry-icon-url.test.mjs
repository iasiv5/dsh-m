/**
 * T7 守卫：bundled registry.json 的 icon 字段只能是 https URL（用户 Q7 定案 + 评审 Q1 三层结构之③）。
 * 校验层（validateRegistry）兜底整份拒绝；此测试把违规拦在 PR 阶段、先于发布。
 *
 * 第二用例（retro 2026-11-09 ②）：copy-guide §10「jsdelivr 钉浮动大版本 @<major>，禁止钉全版本」
 * 原本纯靠自觉（archive-trash@0.4.0 全钉在 main 躺到 0.6.x 无人发现），现机械化为 ratchet：
 * - 新增全钉违规 → 红；
 * - GRANDFATHERED_PINNED 只减不增：名单内条目修为 @<major> 后也会红，提示移出名单（名单自己收缩）。
 * 存量 12 条的迁移战役待主人裁决（retro ②）。
 * 运行：node --test tests/registry-icon-url.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'))

// jsdelivr 浮动大版本形态：/npm/<pkg>@<major>/…；scoped 为 /npm/@scope/pkg@<major>/…。
// 版本段紧贴包名无斜杠；包名段不含 @，否则 [^/]* 会吞掉版本段。
const isMajorPinned = (icon) => /^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:@[^/]+\/[^/@]+|[^/@]+)@\d+\//.test(icon)

// 存量豁免（ratchet）：2026-11-09 立守卫时 icon 仍全钉具体版本的 12 条。只减不增。
const GRANDFATHERED_PINNED = new Set([
  'dsh-tui', 'dsh-better-sidebar', 'dsh-market', 'dsh-context', 'dsh-ops', 'dsh-quota-watch',
  'dsh-surf', 'dsh-obmc-web', 'dsh-onetree-log', 'dsh-chat-manager', 'dsh-mcp-tools', 'dsh-skills',
])

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

  it('jsdelivr icon 钉浮动大版本 @<major>（copy-guide §10）：新增全钉即红，存量名单只减不增', () => {
    const violating = new Set()
    for (const e of registry.plugins) {
      if (e.icon === undefined || !e.icon.includes('cdn.jsdelivr.net/npm/')) continue
      if (!isMajorPinned(e.icon)) violating.add(e.id)
    }
    const newViolations = [...violating].filter((id) => !GRANDFATHERED_PINNED.has(id))
    const staleExemptions = [...GRANDFATHERED_PINNED].filter((id) => !violating.has(id))
    assert.deepEqual(newViolations, [], `新增 icon 全钉违规（§10 只许 @<major>，禁止 @x.y.z 与无版本 URL）：${newViolations.join(', ')}`)
    assert.deepEqual(staleExemptions, [], `存量名单内条目已合规或已移除，请从 GRANDFATHERED_PINNED 移出：${staleExemptions.join(', ')}`)
  })
})

describe('isMajorPinned 判定（fixture 自证，不依赖当前 registry 数据）', () => {
  const cases = [
    ['https://cdn.jsdelivr.net/npm/dsh-archive-trash@0/icon.svg', true],
    ['https://cdn.jsdelivr.net/npm/@iasiv5/dsh-skins@1/icon.svg', true],
    ['https://cdn.jsdelivr.net/npm/dsh-m@0/icon.svg', true],
    ['https://cdn.jsdelivr.net/npm/dsh-archive-trash@0.4.0/icon.svg', false],
    ['https://cdn.jsdelivr.net/npm/@iasiv5/dsh-skins@1.0.0/icon.svg', false],
    ['https://cdn.jsdelivr.net/npm/dsh-ops@0.4.1/docs/assets/icon.png', false],
    ['https://cdn.jsdelivr.net/npm/dsh-archive-trash/icon.svg', false],
  ]
  for (const [icon, expected] of cases) {
    it(`${expected ? '合规' : '违规'}：${icon}`, () => assert.equal(isMajorPinned(icon), expected))
  }
})
