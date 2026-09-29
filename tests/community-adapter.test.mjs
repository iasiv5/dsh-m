/**
 * M1 Task 4：目录适配层——原生条目 → CommunityEntry（id 合成 / 来源归一 / 子包规则 / 脏条目跳过计数）。
 * 规则出处：计划 Task 4 契约 + DESIGN.md §2.5「目录适配层」/ Q40 / Q43。
 * 运行：npm run build && node --test tests/community-adapter.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { validateCommunityContainer } from '../lib/core/community.js'
import { adaptCommunityCatalog } from '../lib/core/community-adapter.js'

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'community-catalog-sample.json'), 'utf8'),
)

/** 便捷构造：走一遍容器校验拿合法 catalog（与生产 fetch 链同型）。 */
function catalogOf(plugins) {
  const raw = {
    name: 'awesome-dsh-plugin',
    url: 'https://example.com',
    source: 'https://github.com/x/y',
    updated: '2026-09-28',
    count: plugins.length,
    categories: {},
    plugins,
  }
  const v = validateCommunityContainer(raw)
  assert.equal(v.ok, true)
  return v.catalog
}

const V1_ID_RE = /^[a-z0-9][a-z0-9._-]*$/
const CATEGORY_RE = /^[a-z0-9-]{1,32}$/

describe('adaptCommunityCatalog — 入库 fixture 全量', () => {
  const r = adaptCommunityCatalog(validateCommunityContainer(fixture).catalog)

  it('30 条原生 → 29 收录；无 npm 子包跳过 1；脏条目 0', () => {
    assert.equal(fixture.plugins.length, 30)
    assert.equal(r.entries.length, 29)
    assert.equal(r.skippedSubpathNoNpm, 1)
    assert.equal(r.skippedDirty, 0)
  })

  it('全部产物 id 满足 v1 规则且适配层内唯一', () => {
    const ids = r.entries.map((e) => e.id)
    assert.equal(ids.length, new Set(ids).size)
    for (const id of ids) assert.match(id, V1_ID_RE)
  })

  it('npm 映射：dsh-j-space → source=npm + npm/homepage/tags 置空', () => {
    const e = r.entries.find((x) => x.id === 'anonyjcy--dsh-j-space')
    assert.ok(e, 'id 应为小写 owner--name 合成')
    assert.equal(e.source, 'npm')
    assert.equal(e.npm, '@anonyjcy/dsh-j-space')
    assert.equal(e.github, undefined)
    assert.equal(e.homepage, 'https://github.com/AnonyJcy/dsh-j-space')
    assert.deepEqual(e.tags, [])
    assert.equal(e.name, 'dsh-j-space')
    assert.equal(e.category, 'agi')
    assert.ok(e.description.includes('J-Space'))
  })

  it('有 npm 的子包按 npm 正常收录（dsh-forge-studio#plugin-usage-billing）', () => {
    const e = r.entries.find((x) => x.npm === '@zzerx/dsh-plugin-usage-billing')
    assert.ok(e)
    assert.equal(e.source, 'npm')
    assert.match(e.id, /^0x7a7a6572--dsh-forge-studio-plugin-usage-billing$/)
  })

  it('无 npm 的子包跳过并计数（amoji#amoji），warnings 汇入', () => {
    assert.equal(r.entries.find((x) => x.name === 'amoji#amoji'), undefined)
    assert.ok(r.warnings.some((w) => w.includes('子包') && w.includes('1')))
  })

  it('同名异 owner 各自合成 id（两条 dsh-memory）', () => {
    const ids = r.entries.filter((x) => x.name === 'dsh-memory').map((x) => x.id)
    assert.deepEqual(ids.sort(), ['aqsk-blg--dsh-memory', 'furongjun-1999--dsh-memory'])
  })

  it('tarball-only 按 github 收录（dsh-session-diff）', () => {
    const e = r.entries.find((x) => x.name === 'dsh-session-diff')
    assert.ok(e)
    assert.equal(e.source, 'github')
    assert.equal(e.github, '2002XiaoYu/dsh-session-diff')
    assert.equal(e.npm, undefined)
  })

  it('zh 缺省回退 en 并聚合 warning（dsh-answer-reviewer）', () => {
    const e = r.entries.find((x) => x.name === 'dsh-answer-reviewer')
    assert.ok(e)
    assert.ok(e.description.startsWith('Agentic answer reviewer'))
    assert.ok(r.warnings.some((w) => w.includes('回退') && w.includes('1')))
  })

  it('zh > 500 字符截断并聚合 warning（dsh-all-usage，573 → 500）', () => {
    const e = r.entries.find((x) => x.name === 'dsh-all-usage')
    assert.ok(e)
    assert.equal(e.description.length, 500)
    assert.ok(r.warnings.some((w) => w.includes('500') && w.includes('截断') && w.includes('1')))
  })

  it('category 保留原生值不转译且全部满足安全 slug', () => {
    for (const e of r.entries) assert.match(e.category, CATEGORY_RE)
    assert.ok(r.entries.some((x) => x.category === 'agi'))
    assert.ok(r.entries.some((x) => x.category === 'usage'))
  })

  it('旁路字段透传：downloads/stars/capabilities/screenshots + 0.7.0 扩展（install/downloadsStart/version）', () => {
    const mem = r.entries.find((x) => x.id === 'furongjun-1999--dsh-memory')
    assert.equal(mem.downloads, 16706)
    assert.equal(mem.stars, 272)
    assert.ok(Array.isArray(mem.capabilities) && mem.capabilities.length > 0)
    const diff = r.entries.find((x) => x.name === 'dsh-session-diff')
    assert.ok(diff.screenshots.length >= 1)
    // 0.7.0 Task 1：白名单扩为 bypass 全集（install/downloadsStart/downloadsEnd/version 等 9 字段，DESIGN §2.6）。
    // 防御口径同步演进：未入白名单的原生键（page/tarball/capabilityCheckedAt）仍不外溢。
    assert.equal(typeof diff.install, 'string')
    assert.equal(typeof mem.downloadsStart, 'string')
    assert.equal(typeof mem.version, 'string')
    assert.equal(diff.page, undefined)
    assert.equal(diff.tarball, undefined)
    assert.equal(diff.capabilityCheckedAt, undefined)
  })
})

describe('adaptCommunityCatalog — 合成条目契约', () => {
  it('空目录 → 零产物零计数零警告', () => {
    const r = adaptCommunityCatalog(catalogOf([]))
    assert.deepEqual(r, { entries: [], warnings: [], skippedDirty: 0, skippedSubpathNoNpm: 0 })
  })

  it('适配层内 id 冲突追加序号（-2/-3）', () => {
    const r = adaptCommunityCatalog(
      catalogOf([
        { name: 'dup', owner: 'x', category: 'ui', npm: 'pkg-a', description: { en: 'a' } },
        { name: 'dup', owner: 'x', category: 'ui', npm: 'pkg-b', description: { en: 'b' } },
        { name: 'dup', owner: 'x', category: 'ui', npm: 'pkg-c', description: { en: 'c' } },
      ]),
    )
    assert.equal(r.skippedDirty, 0)
    assert.deepEqual(r.entries.map((e) => e.id), ['x--dup', 'x--dup-2', 'x--dup-3'])
  })

  it('非法字符折叠为 -（owner/name 中的空格与符号）', () => {
    const r = adaptCommunityCatalog(
      catalogOf([{ name: 'X!Y', owner: 'A B', category: 'ui', npm: 'pkg-a', description: { en: 'a' } }]),
    )
    assert.equal(r.entries[0].id, 'a-b--x-y')
  })

  it('折叠后首字符非 [a-z0-9] → 剥除前导非法段', () => {
    const r = adaptCommunityCatalog(
      catalogOf([{ name: 'y', owner: '-abc', category: 'ui', npm: 'pkg-a', description: { en: 'a' } }]),
    )
    assert.equal(r.entries[0].id, 'abc--y')
  })

  it('超 64 字符截断加哈希尾缀：≤64、确定性、不同输入不撞', () => {
    const r = adaptCommunityCatalog(
      catalogOf([
        { name: 'a'.repeat(200), owner: 'longowner', category: 'ui', npm: 'pkg-a', description: { en: 'a' } },
        { name: 'b'.repeat(200), owner: 'longowner', category: 'ui', npm: 'pkg-b', description: { en: 'b' } },
      ]),
    )
    const [e1, e2] = r.entries
    for (const e of [e1, e2]) {
      assert.ok(e.id.length <= 64)
      assert.match(e.id, V1_ID_RE)
      assert.match(e.id, /-[0-9a-f]{8}$/)
    }
    assert.notEqual(e1.id, e2.id)
    const again = adaptCommunityCatalog(
      catalogOf([
        { name: 'a'.repeat(200), owner: 'longowner', category: 'ui', npm: 'pkg-a', description: { en: 'a' } },
      ]),
    )
    assert.equal(again.entries[0].id, e1.id)
  })

  it('name/owner 缺失或非字符串 → skippedDirty', () => {
    const r = adaptCommunityCatalog(
      catalogOf([
        { owner: 'x', category: 'ui', npm: 'pkg-a', description: { en: 'a' } },
        { name: '', owner: 'x', category: 'ui', npm: 'pkg-a', description: { en: 'a' } },
        { name: 'y', category: 'ui', npm: 'pkg-a', description: { en: 'a' } },
        { name: 'z', owner: '', category: 'ui', npm: 'pkg-a', description: { en: 'a' } },
      ]),
    )
    assert.equal(r.entries.length, 0)
    assert.equal(r.skippedDirty, 4)
    assert.ok(r.warnings.some((w) => w.includes('跳过') && w.includes('4')))
  })

  it('category 缺失/大写/超 32 → skippedDirty', () => {
    const r = adaptCommunityCatalog(
      catalogOf([
        { name: 'a', owner: 'o', npm: 'pkg-a', description: { en: 'a' } },
        { name: 'b', owner: 'o', category: 'UI', npm: 'pkg-b', description: { en: 'b' } },
        { name: 'c', owner: 'o', category: 'a'.repeat(33), npm: 'pkg-c', description: { en: 'c' } },
      ]),
    )
    assert.equal(r.entries.length, 0)
    assert.equal(r.skippedDirty, 3)
  })

  it('description 全缺 → skippedDirty', () => {
    const r = adaptCommunityCatalog(catalogOf([{ name: 'a', owner: 'o', category: 'ui', npm: 'pkg-a' }]))
    assert.equal(r.skippedDirty, 1)
    assert.equal(r.entries.length, 0)
  })

  it('npm 形状非法 → 视为无 npm 走 github；url 也不可用 → skippedDirty', () => {
    const r = adaptCommunityCatalog(
      catalogOf([
        { name: 'a', owner: 'o', category: 'ui', npm: 'Not A Pkg', url: 'https://github.com/o/r', description: { en: 'a' } },
        { name: 'b', owner: 'o', category: 'ui', npm: 'Not A Pkg', description: { en: 'b' } },
      ]),
    )
    assert.equal(r.entries.length, 1)
    assert.equal(r.skippedDirty, 1)
    assert.equal(r.entries[0].source, 'github')
    assert.equal(r.entries[0].github, 'o/r')
    assert.equal(r.entries[0].npm, undefined)
  })

  it('无 npm 且 url 非 github（缺 url / 非 github 域）→ skippedDirty', () => {
    const r = adaptCommunityCatalog(
      catalogOf([
        { name: 'a', owner: 'o', category: 'ui', npm: null, description: { en: 'a' } },
        { name: 'b', owner: 'o', category: 'ui', npm: null, url: 'https://gitlab.com/x/y', description: { en: 'b' } },
        { name: 'c', owner: 'o', category: 'ui', npm: null, url: 'https://github.com/only-owner', description: { en: 'c' } },
      ]),
    )
    assert.equal(r.entries.length, 0)
    assert.equal(r.skippedDirty, 3)
    assert.equal(r.skippedSubpathNoNpm, 0)
  })

  it('url 含 /tree/ 但 name 无 # 且有 npm → 正常收录（不误判子包）', () => {
    const r = adaptCommunityCatalog(
      catalogOf([
        {
          name: 'dsh-undo-plugin',
          owner: '23swccp',
          url: 'https://github.com/23swccp/dsh-undo/tree/master/packages/bundle-rollback',
          category: 'session',
          npm: 'dsh-undo-plugin',
          description: { en: 'undo' },
        },
      ]),
    )
    assert.equal(r.entries.length, 1)
    assert.equal(r.skippedSubpathNoNpm, 0)
    assert.equal(r.entries[0].source, 'npm')
  })

  it('name 含 # 且无 npm 但 url 干净 → 仍按子包跳过（name 形态优先判定）', () => {
    const r = adaptCommunityCatalog(
      catalogOf([{ name: 'repo#sub', owner: 'o', category: 'ui', npm: null, url: 'https://github.com/o/repo', description: { en: 'a' } }]),
    )
    assert.equal(r.entries.length, 0)
    assert.equal(r.skippedSubpathNoNpm, 1)
    assert.equal(r.skippedDirty, 0)
  })
})

describe('adaptCommunityCatalog — bypass 字段全集透传（0.7.0 Task 1）', () => {
  const FULL = {
    name: 'dsh-full',
    owner: 'alice',
    url: 'https://github.com/alice/dsh-full',
    category: 'theme',
    npm: 'dsh-full',
    description: { zh: '全字段条目', en: 'full entry' },
    version: '1.2.3',
    added: '2026-09-01',
    install: 'dsh plugin --profile web add dsh-full',
    downloadsStart: '2026-08-01',
    downloadsEnd: '2026-08-31',
    downloadsCheckedAt: '2026-09-01T00:00:00Z',
    deprecated: true,
    replacement: 'dsh-full-next',
  }
  const BARE = {
    name: 'dsh-bare',
    owner: 'bob',
    url: 'https://github.com/bob/dsh-bare',
    category: 'fun',
    npm: null,
    description: { zh: '裸条目' },
  }

  it('全字段条目 → 9 个 bypass 字段齐备', () => {
    const r = adaptCommunityCatalog(catalogOf([FULL]))
    assert.equal(r.entries.length, 1)
    const e = r.entries[0]
    assert.equal(e.owner, 'alice')
    assert.equal(e.added, '2026-09-01')
    assert.equal(e.deprecated, true)
    assert.equal(e.replacement, 'dsh-full-next')
    assert.equal(e.install, 'dsh plugin --profile web add dsh-full')
    assert.equal(e.downloadsStart, '2026-08-01')
    assert.equal(e.downloadsEnd, '2026-08-31')
    assert.equal(e.downloadsCheckedAt, '2026-09-01T00:00:00Z')
    assert.equal(e.version, '1.2.3')
  })

  it('裸条目 → 8 个可选 bypass 键均不存在；owner 为适配必填字段恒在', () => {
    const r = adaptCommunityCatalog(catalogOf([BARE]))
    assert.equal(r.entries.length, 1)
    const e = r.entries[0]
    for (const k of ['added', 'deprecated', 'replacement', 'install', 'downloadsStart', 'downloadsEnd', 'downloadsCheckedAt', 'version']) {
      assert.equal(k in e, false, `键 ${k} 不应存在`)
    }
    assert.equal(e.owner, 'bob')
  })

  it('deprecated 仅布尔 true 生效；version null（github-only）不产生键', () => {
    const r = adaptCommunityCatalog(catalogOf([{ ...BARE, deprecated: 'yes', version: null }]))
    const e = r.entries[0]
    assert.equal('deprecated' in e, false)
    assert.equal('version' in e, false)
  })
})
