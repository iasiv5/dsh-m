/**
 * T4：图标解析链纯逻辑（ADR-0025）：catalogIconUrl https-only 过滤 + iconCandidates 候选序。
 * 运行：node --test tests/client-icon-view.test.mjs（直 import src，无需构建）
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { catalogIconUrl, iconCandidates, buildInstalledIconIndex, favoriteInstalledIcon, withFavoriteIcons } from '../src/client/icon-view.js'

describe('catalogIconUrl（目录侧仅认 https URL，用户 Q7 定案）', () => {
  it('https URL 原样返回', () => {
    assert.equal(catalogIconUrl('https://cdn.jsdelivr.net/npm/x@1.0.0/icon.svg'), 'https://cdn.jsdelivr.net/npm/x@1.0.0/icon.svg')
  })
  it('http / data: / 相对路径 / 非字符串 / 空串 / undefined → null', () => {
    assert.equal(catalogIconUrl('http://a/i.png'), null)
    assert.equal(catalogIconUrl('data:image/png;base64,xx'), null)
    assert.equal(catalogIconUrl('icon.svg'), null)
    assert.equal(catalogIconUrl(123), null)
    assert.equal(catalogIconUrl(''), null)
    assert.equal(catalogIconUrl('   '), null)
    assert.equal(catalogIconUrl(undefined), null)
    assert.equal(catalogIconUrl('not a url :://'), null)
  })
})

describe('iconCandidates（候选序：目录声明 → 已装官方 data URI → 头像；去重）', () => {
  it('目录声明 + github → [catalog, avatar]', () => {
    assert.deepEqual(
      iconCandidates({ icon: 'https://a/i.png', github: 'o/r' }),
      ['https://a/i.png', 'https://github.com/o.png?size=64'],
    )
  })
  it('目录侧 data: 不进链（Q7：塞 base64 视为无图标）→ 仅头像', () => {
    assert.deepEqual(
      iconCandidates({ icon: 'data:image/png;base64,xx', github: 'o/r' }),
      ['https://github.com/o.png?size=64'],
    )
  })
  it('已装 iconDataUri（data:image/*）→ [meta, avatar]', () => {
    assert.deepEqual(
      iconCandidates({ iconDataUri: 'data:image/png;base64,xx', github: 'o/r' }),
      ['data:image/png;base64,xx', 'https://github.com/o.png?size=64'],
    )
  })
  it('非 image/* 的 data:（iconDataUri）→ 剔除', () => {
    assert.deepEqual(iconCandidates({ iconDataUri: 'data:text/html,x', github: 'o/r' }), ['https://github.com/o.png?size=64'])
  })
  it('catalog 与 iconDataUri 同现 → 目录声明在前（纯函数序契约；产品上两字段分属不同面板不冲突）', () => {
    assert.deepEqual(
      iconCandidates({ icon: 'https://a/i.png', iconDataUri: 'data:image/png;base64,xx' }),
      ['https://a/i.png', 'data:image/png;base64,xx'],
    )
  })
  it('github 非 owner/repo 形态（无斜杠）→ 无头像', () => {
    assert.deepEqual(iconCandidates({ github: 'o' }), [])
  })
  it('全空 → []', () => {
    assert.deepEqual(iconCandidates({}), [])
    assert.deepEqual(iconCandidates(), [])
  })
  it('重复候选去重', () => {
    assert.deepEqual(
      iconCandidates({ icon: 'https://github.com/o.png?size=64', github: 'o/r' }),
      ['https://github.com/o.png?size=64'],
    )
  })
})

// ---------- 收藏头像修复（2026-10-31）：收藏快照无 icon 字段，收藏卡头像退化到 owner 头像 ----------
// 三层数据源：① market-ids-exist 同批透出的目录声明 icon（present 条目）② 收藏快照自带 icon
// （snapshotOf 新增持久化，新收藏离线也有）③ 已装条目 iconDataUri（registryId/npm/github 别名 join，
// 社区收藏的已装插件用真图标——社区页同款呈现）。DOM-free 纯逻辑直测。

describe('buildInstalledIconIndex（已装图标索引：registryId/npm/github 三别名键族）', () => {
  it('三别名键族各归其位；iconDataUri 缺席不产键', () => {
    const idx = buildInstalledIconIndex([
      { registryId: 'o1--demo', pkg: 'demo-pkg', registryGithub: 'o1/demo', iconDataUri: 'data:image/svg+xml;base64,AA' },
      { pkg: 'no-join', iconDataUri: 'data:image/png;base64,BB' },
      { registryId: 'no-uri' },
      null,
    ])
    assert.equal(idx.byKey['id:o1--demo'], 'data:image/svg+xml;base64,AA')
    assert.equal(idx.byKey['npm:demo-pkg'], 'data:image/svg+xml;base64,AA')
    assert.equal(idx.byKey['gh:o1/demo'], 'data:image/svg+xml;base64,AA')
    assert.equal(idx.byKey['npm:no-join'], 'data:image/png;base64,BB', '无 registryId 的已装项走 npm 别名（非收录已装）')
    assert.equal('id:no-uri' in idx.byKey, false, 'iconDataUri 缺席不产键')
    assert.deepEqual(Object.keys(idx.byKey), ['id:o1--demo', 'npm:demo-pkg', 'gh:o1/demo', 'npm:no-join'], '键集闭包恰好四键')
  })

  it('非数组/垃圾项安全降级空索引', () => {
    assert.deepEqual(buildInstalledIconIndex(null), { byKey: {} })
    assert.deepEqual(buildInstalledIconIndex([1, 'x']), { byKey: {} })
  })
})

describe('favoriteInstalledIcon（收藏 → 已装图标 join：id → npm → github 别名序）', () => {
  const idx = buildInstalledIconIndex([
    { registryId: 'o1--demo', pkg: 'demo-pkg', registryGithub: 'o1/demo', iconDataUri: 'data:image/svg+xml;base64,AA' },
  ])
  it('id 别名命中', () => {
    assert.equal(favoriteInstalledIcon(idx, { id: 'o1--demo', npm: 'other' }), 'data:image/svg+xml;base64,AA')
  })
  it('id 缺位落 npm 别名（社区收藏 id 与 registryId 撞位移身份仍命中）', () => {
    assert.equal(favoriteInstalledIcon(idx, { id: 'displaced--demo', npm: 'demo-pkg' }), 'data:image/svg+xml;base64,AA')
  })
  it('id/npm 双缺落 github 别名', () => {
    assert.equal(favoriteInstalledIcon(idx, { id: 'x--y', github: 'o1/demo' }), 'data:image/svg+xml;base64,AA')
  })
  it('全别名未命中返回 null（回退 iconCandidates 既有链）', () => {
    assert.equal(favoriteInstalledIcon(idx, { id: 'none--x', npm: 'none-pkg', github: 'n/r' }), null)
  })
  it('索引缺席/垃圾形态容错返回 null（存取语义）', () => {
    assert.equal(favoriteInstalledIcon(null, { id: 'o1--demo' }), null)
    assert.equal(favoriteInstalledIcon({ byKey: null }, { id: 'o1--demo' }), null)
    assert.equal(favoriteInstalledIcon(idx, null), null)
  })
})

describe('withFavoriteIcons（收藏卡 Icon entry 装配：目录 icon 覆盖 > 快照自带 > 已装 data URI）', () => {
  it('目录 icon 覆盖快照（目录现行值为准）', () => {
    const out = withFavoriteIcons({ id: 'a', icon: 'https://old/i.png' }, { a: 'https://new/i.png' })
    assert.equal(out.icon, 'https://new/i.png')
    assert.equal('iconDataUri' in out, false, '有 icon 不叠加 data URI')
  })
  it('目录未覆盖时保留快照自带 icon（新收藏离线仍有图标）', () => {
    const out = withFavoriteIcons({ id: 'a', icon: 'https://snap/i.png' }, {})
    assert.equal(out.icon, 'https://snap/i.png')
  })
  it('双缺时已装 data URI 落 iconDataUri 键（metaIconUrl 门同源 data:image/ 前缀）', () => {
    const idx = buildInstalledIconIndex([{ registryId: 'a', iconDataUri: 'data:image/png;base64,CC' }])
    const out = withFavoriteIcons({ id: 'a', npm: 'p' }, null, idx)
    assert.equal(out.iconDataUri, 'data:image/png;base64,CC')
    assert.equal('icon' in out, false, '不造目录 icon 键')
  })
  it('非 data:image/ 的 join 值不落键（与 icon-view metaIconUrl 同门）', () => {
    const idx = buildInstalledIconIndex([{ registryId: 'a', iconDataUri: 'https://not-data/x.png' }])
    const out = withFavoriteIcons({ id: 'a' }, null, idx)
    assert.equal('iconDataUri' in out, false)
  })
  it('输入容错：全缺席返回原 entry 形态不抛（avatar 回退链不受扰）', () => {
    const snap = { id: 'k', github: 'o/r' }
    assert.deepEqual(withFavoriteIcons(snap, null, null), snap)
    assert.deepEqual(withFavoriteIcons(undefined, {}, {}), {})
  })
})
