/**
 * CHANGELOG 区间覆盖门禁纯函数单测（scripts/release-range-coverage.mjs；2026-11-18 retro）。
 * 夹具 = 0.12.22 战役区间真实提交主题（v0.12.21..v0.12.22，git log --oneline 逐字）；
 * 红队 = 首发条目（仅 #77/#78，当晚事故形态）应抓出全部 8 笔漏账，绿队 = 补正条目全过。
 * 运行：node --test tests/release-range-coverage.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { rangeCoverage, previousVersionTag, BEARING_COMMIT_RE } from '../scripts/release-range-coverage.mjs'

const RANGE = [
  '3e09afb release: 0.12.22 CHANGELOG 双语条目 + 版本三处 bump（issue #77/#78 win32 回滚阶梯与 npmmirror 缺失依赖同步）',
  '3281039 fix(core): win32 回滚阶梯 viaShell + npmmirror 缺失依赖优先同步（issue #77/#78）',
  '2b17ccb docs(standards): retro 2026-11-18 四条收紧（候选 2-5）',
  '2abc6fe test(session-gate): DESIGN §5 工具枚举与注册清单一致性守卫（retro 2026-11-18 候选 1）',
  '641a51c docs(adr): ADR-0040 补键 trim 口径说明（impl-review 建议 3）',
  'b1d7a13 fix(probe): probedAt 与缓存写入同钟取值（impl-review Q1 选 b：消除跨毫秒断言脆弱性）',
  '635ce44 docs: ADR-0040 npmLatest single-flight + spec D13-D15 决议与缺口同步（GLOSSARY 无新增术语）',
  'e63d5fe feat(npm): npmLatest in-flight 合并（ADR-0040：waiter-scoped 超时/signal + 30s flight cap，spec D15）',
  'c9d6e3c feat(tools): dshm_list 新增 refresh 参数透传 core force（spec D14）',
  '874b042 feat(core): 已装列表 probeMode full 支持 force（ADR-0013 peek 纪律同源，spec D14）',
  'bc80cf9 feat(tools): renderList 检查结果截至段 + items 透传 probedAt（spec D13）',
  '7519d84 feat(probe): 已装探测逐项 probedAt 盖戳（缓存命中继承写入时刻，spec D13）',
  'ba0206f docs(plans): 探测透明度 + refresh + npm single-flight 实施计划',
  'd585c15 docs(spec): 修正设计记录 §7 的残留风险描述',
  'faadfbb refactor(tools): 合并 agent 工具 dshm_outdated 并入 dshm_list（ADR-0039）',
  'cedbcf0 registry: 收录 dsh-open-artifact 到宝玉专区（npm + github 双源）',
]

/** 0.12.22 首发条目摘录（当晚事故形态：仅覆盖 #77/#78 一役，无区间其余战役的任何留痕）。 */
const FIRST_ENTRY = [
  '### 0.12.22 修复：win32 回滚阶梯 ENOENT + npmmirror 缺失依赖同步空转（issue #77/#78）',
  '- 修复（issue #77）：pnpmInstallSpawnPlan + deps.runCommand 注入缝。',
  '- 修复（issue #78）：missingPackage 提取 + 主包兜底。',
  '- 测试：tests/pnpm-outcome.test.mjs、tests/profile-transaction.test.mjs。',
].join('\n')

/** 补正条目摘录（0f50c92 形态：区间各战役留痕齐备）。 */
const AMENDED_ENTRY = [
  '### 0.12.22 修复：…（issue #77/#78）+ agent 工具合并与探测透明度（ADR-0039/0040）',
  '- 修复（issue #77）：pnpmInstallSpawnPlan；修复（issue #78）：missingPackage。',
  '- 工具面（ADR-0039）：dshm_outdated 并入 dshm_list。',
  '- 探测透明度（spec D13/D14）：probedAt 逐项盖戳；refresh 参数；renderList 截至段。',
  '- 性能（ADR-0040，spec D15）：npmLatest single-flight；probedAt 同钟取值。',
  '- 收录：registry 收录 dsh-open-artifact 至宝玉专区。',
].join('\n')

describe('rangeCoverage：区间覆盖判定', () => {
  it('红队（事故复现）：首发条目应抓出全部 8 笔漏账，#77/#78 提交仍过', () => {
    const { missing, unverifiable } = rangeCoverage(RANGE, FIRST_ENTRY)
    assert.equal(missing.length, 8, `实际：${JSON.stringify(missing)}`)
    assert.ok(missing.some((s) => s.includes('dshm_outdated') && s.includes('ADR-0039')))
    assert.ok(missing.some((s) => s.includes('dsh-open-artifact')))
    assert.ok(missing.some((s) => s.includes('probedAt 与缓存写入同钟取值')))
    assert.ok(!missing.some((s) => s.includes('issue #77/#78）')), '带引用号且命中的提交不得误报')
    assert.deepEqual(unverifiable, [])
  })

  it('绿队（补正形态）：missing/unverifiable 双空', () => {
    const r = rangeCoverage(RANGE, AMENDED_ENTRY)
    assert.deepEqual(r, { missing: [], unverifiable: [] }, JSON.stringify(r))
  })

  it('类型过滤：docs/test/release/chore 提交不计入；非 conventional 的纯中文行为提交入 unverifiable', () => {
    assert.ok(!BEARING_COMMIT_RE.test('docs(standards): retro 2026-11-18 四条收紧'))
    assert.ok(!BEARING_COMMIT_RE.test('test(session-gate): DESIGN §5 工具枚举'))
    assert.ok(!BEARING_COMMIT_RE.test('release: 0.12.22 CHANGELOG 双语条目'))
    const r = rangeCoverage(['f00f00f fix(ui): 修复面板闪烁与残影', 'a1b2c3d chore: 依赖 bump'], '任意')
    assert.deepEqual(r.missing, [])
    assert.deepEqual(r.unverifiable, ['fix(ui): 修复面板闪烁与残影'])
  })

  it('引用号路径不回落标识符：带 ADR-NN/DN 的提交只认引用号命中', () => {
    const r = rangeCoverage(['1111111 feat(x): dshm_list 刷新（spec D14）'], '条目只提到 dshm_list，未出现任何引用号')
    assert.equal(r.missing.length, 1, '引用号在场未命中即 missing，不因标识符偶然命中而放行')
  })

  it('空输入与非数组形态：零误报', () => {
    assert.deepEqual(rangeCoverage([], ''), { missing: [], unverifiable: [] })
    assert.deepEqual(rangeCoverage(undefined, undefined), { missing: [], unverifiable: [] })
  })
})

describe('previousVersionTag：上一版本 tag 解析', () => {
  const tags = ['v0.12.2', 'v0.12.20', 'v0.12.21', 'v0.12.22', 'not-a-tag']
  it('取严格小于 current 的最大版本', () => {
    assert.equal(previousVersionTag(tags, '0.12.22'), 'v0.12.21')
    assert.equal(previousVersionTag(tags, 'v0.12.21'), 'v0.12.20')
    assert.equal(previousVersionTag(tags, '0.12.20'), 'v0.12.2')
  })
  it('current 非法 / 无更早版本 / 空列表 → null', () => {
    assert.equal(previousVersionTag(tags, 'banana'), null)
    assert.equal(previousVersionTag(['v0.1.0'], '0.1.0'), null)
    assert.equal(previousVersionTag([], '0.12.22'), null)
    assert.equal(previousVersionTag(undefined, '0.12.22'), null)
  })
})
