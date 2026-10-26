/**
 * 0.7.0 Task 3：搜索相关性管线——归一化边界 / id 精确匹配保证 / 权重序 / 命中类型序 /
 * 多词同字段约束 / memoize。规则出处：DESIGN.md §2.6 + 实施计划 Task 3 契约 + 评审共识
 * （id 精确匹配豁免多词约束，收藏 stale 检测依赖）。
 * 运行：npm run build && node --test tests/search-relevance.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  normalizeSearchText,
  tokenizeSearchText,
  relevanceScore,
  ID_EXACT_SCORE,
} from '../lib/core/search-relevance.js'

function terms(q) {
  return tokenizeSearchText(normalizeSearchText(q))
}

function mk(over = {}) {
  return { id: 'x', name: 'n', description: 'd', category: 'c', ...over }
}

describe('normalizeSearchText — 归一化边界', () => {
  it('NFKC 全角→半角 + 小写', () => {
    assert.equal(normalizeSearchText('ＭＣＰ'), 'mcp')
  })

  it('中西文边界插空格（MCP管理 ≈ MCP 管理）', () => {
    assert.equal(normalizeSearchText('MCP管理'), 'mcp 管理')
    assert.equal(normalizeSearchText('MCP管理'), normalizeSearchText('MCP 管理'))
  })

  it('标点归空格（中英文标点、连字符、空白折叠）', () => {
    assert.equal(normalizeSearchText('主题、皮肤！theme--skin'), '主题 皮肤 theme skin')
  })

  it('CJK 两侧夹拉丁（双向边界）', () => {
    assert.equal(normalizeSearchText('中文English中文'), '中文 english 中文')
  })

  it('空串/纯标点 → 空串（tokenize → 空数组）', () => {
    assert.equal(normalizeSearchText('   '), '')
    assert.equal(normalizeSearchText('——!!'), '')
    assert.deepEqual(tokenizeSearchText(normalizeSearchText('——!!')), [])
  })
})

describe('relevanceScore — id 精确匹配最高优先（收藏 stale 检测依赖）', () => {
  it('owner--name 合成 id 整串命中（含大小写/标点变体）→ ID_EXACT_SCORE', () => {
    const e = mk({ id: 'furongjun-1999--dsh-memory', name: 'dsh-memory', description: 'd', category: 'memory' })
    assert.equal(relevanceScore(e, terms('furongjun-1999--dsh-memory')), ID_EXACT_SCORE)
    assert.equal(relevanceScore(e, terms('FURONGJUN—1999 -- dsh memory')), ID_EXACT_SCORE)
  })

  it('id 整串之外多一个词 → 不触发 ID_EXACT（未命中同字段则 0 分）', () => {
    const e = mk({ id: 'owner--name', name: 'name', description: 'd', category: 'c' })
    assert.equal(relevanceScore(e, terms('owner--name extra')), 0)
  })
})

describe('relevanceScore — 权重序与命中类型序', () => {
  it('字段权重序：name(700) > 描述(280) > 分类(180) > tags(150)', () => {
    const eName = mk({ id: 'x1', name: 'alpha', description: 'x', category: 'c', tags: ['t'] })
    const eDesc = mk({ id: 'x2', name: 'n', description: 'alpha', category: 'c', tags: ['t'] })
    const eCat = mk({ id: 'x3', name: 'n', description: 'x', category: 'alpha', tags: ['t'] })
    const eTag = mk({ id: 'x4', name: 'n', description: 'x', category: 'c', tags: ['alpha'] })
    const sName = relevanceScore(eName, terms('alpha'))
    const sDesc = relevanceScore(eDesc, terms('alpha'))
    const sCat = relevanceScore(eCat, terms('alpha'))
    const sTag = relevanceScore(eTag, terms('alpha'))
    assert.equal(sName, 700 + 300)
    assert.equal(sDesc, 280 + 300)
    assert.ok(sName > sDesc && sDesc > sCat && sCat > sTag && sTag > 0)
  })

  it('owner 字段权重 400（社区条目 byline 作者可搜）', () => {
    const e = mk({ id: 'x', name: 'n', description: 'd', category: 'c', owner: 'alice' })
    assert.equal(relevanceScore(e, terms('alice')), 400 + 300)
  })

  it('命中类型序：精确 > 前缀 > 包含（同字段同权重）', () => {
    const eExact = mk({ id: 'x1', name: 'n', description: 'alpha', category: 'c' })
    const ePrefix = mk({ id: 'x2', name: 'n', description: 'alphax', category: 'c' })
    const eContains = mk({ id: 'x3', name: 'n', description: 'xalphax', category: 'c' })
    assert.equal(relevanceScore(eExact, terms('alpha')), 280 + 300)
    assert.equal(relevanceScore(ePrefix, terms('alpha')), 280 + 250)
    assert.equal(relevanceScore(eContains, terms('alpha')), 280 + 200)
  })

  it('双语描述：zh 命中(280) > en 命中(240)', () => {
    const e = mk({ id: 'x', name: 'n', description: '主题皮肤', descriptionEn: 'theme skin', category: 'c' })
    assert.ok(relevanceScore(e, terms('皮肤')) > relevanceScore(e, terms('skin')))
  })
})

describe('relevanceScore — 多词约束与 memoize', () => {
  it('多词同字段全命中 → 加 +150；跨字段 → 0 分', () => {
    const same = mk({ id: 'x1', name: 'n', description: 'skin theme', category: 'c' })
    const cross = mk({ id: 'x2', name: 'skin', description: 'theme', category: 'c' })
    assert.equal(relevanceScore(same, terms('skin theme')), 280 + 200 + 150)
    assert.equal(relevanceScore(cross, terms('skin theme')), 0)
  })

  it('memoize：同一条目二次评分命中 WeakMap 缓存，不重算归一化（改名后仍按旧缓存得分）', () => {
    const e = mk({ id: 'x1', name: 'original', description: 'd', category: 'c' })
    const s1 = relevanceScore(e, terms('original'))
    assert.ok(s1 > 0)
    e.name = 'renamed' // 同一对象引用 → 应命中缓存而非重算
    assert.equal(relevanceScore(e, terms('original')), s1)
  })
})

// 0.10.20 补：fixture「同运行时」契约显式化（2026-10-26 真机实证：node22 红 / node24 绿，3888 例仅 2 例不合）。
// 实现（src/core/search-relevance.ts 头注）对版本敏感码点回退 WORD_RE——\p{L} 判定随运行时 Unicode 数据
// 漂移：U+0CDC / U+088F 在 Unicode 16.0（node22+ICU77）未赋值、17.0（node24+ICU78）起赋值为字母，fuzz
// 边界字节不合属预期行为而非实现漂移。fixture 冻结于 Unicode 17.0 数据运行时，据此辖域化：数据版本匹配
// （CI node 24）恒钉住；更老运行时带理由跳过——基线切换必须显式再生，绝不静默。
const FIXTURE_RUNTIME_UNICODE = '17.0'

describe('normalizeSearchText — golden 差分语料（2026-10-16 计划 Task 1）', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/search-normalize-corpus.json', import.meta.url), 'utf8'),
  )
  it(`golden 冻结语料字节等价（${fixture.cases.length} 条，catalog ${fixture.catalogVersion}，seed ${fixture.seed}）`, {
    skip:
      process.versions.unicode !== FIXTURE_RUNTIME_UNICODE &&
      `fixture 冻结于 Unicode ${FIXTURE_RUNTIME_UNICODE} 数据运行时，当前运行时 Unicode ${process.versions.unicode || '未知'}——跨运行时 \\p{L} 漂移属实现「同谓词同运行时」契约内预期；如切换基线：npm run build && node scripts/gen-search-normalize-corpus.mjs（再生纪律见脚本头注）`,
  }, () => {
    assert.ok(Array.isArray(fixture.cases) && fixture.cases.length >= 3800, 'fixture 条数下限 3800')
    const bad = []
    for (let i = 0; i < fixture.cases.length; i++) {
      const { input, expected } = fixture.cases[i]
      const actual = normalizeSearchText(input)
      if (actual !== expected) {
        bad.push({ i, input: JSON.stringify(input).slice(0, 120), expected: JSON.stringify(expected).slice(0, 120), actual: JSON.stringify(actual).slice(0, 120) })
        if (bad.length >= 5) break
      }
    }
    assert.deepStrictEqual(bad, [], 'golden 差分出现 mismatch：修实现，绝不改 fixture（等价红线）')
  })
})

describe('normalizeSearchText — astral 与边界 quirk 钉（全部经现实现实测核验）', () => {
  const B = String.fromCodePoint(0x20000) // 𠀀 CJK 扩展 B：NFKC 稳定 astral 词符
  // 字节等价红线：以下断言钉住「现实现行为」而非理想行为——quirk 保真不修（评审 R1-P1/P2/P9）。
  it('NFKC 稳定 astral 词对透明：保留原样、转角不触发、重置转角状态', () => {
    assert.equal(normalizeSearchText(`a${B}管`), `a${B}管`)
    assert.equal(normalizeSearchText(`a,${B}`), `a ${B}`)
    assert.equal(normalizeSearchText(`管${B}a`), `管${B}a`)
    assert.equal(normalizeSearchText(`${B}${B}管`), `${B}${B}管`)
  })
  it('NFKC×astral 交互：数学字母 𝕏 被先折成 ASCII（到不了 astral 分支）', () => {
    assert.equal(normalizeSearchText('a𝕏管'), 'ax 管')
  })
  it('emoji 非词对折叠为单空格', () => {
    assert.equal(normalizeSearchText('a😀b'), 'a b')
  })
  it('FA 段未赋值洞码点按非词折叠（CJK_RE 命中而 WORD_RE 不命中）', () => {
    assert.equal(normalizeSearchText('a\uFA6Eb'), 'a b')
    assert.equal(normalizeSearchText('\uFA6E一'), '一')
  })
  it('lone surrogate 孤立代理半区按非词折叠', () => {
    assert.equal(normalizeSearchText('a\uD800b'), 'a b')
    assert.equal(normalizeSearchText('\uDC00x'), 'x')
  })
  it('中西文边界归一回归锚', () => {
    assert.equal(normalizeSearchText('MCP管理'), 'mcp 管理')
  })
})
