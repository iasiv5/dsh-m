/**
 * 已装页 pure view：InstalledItem → 视图模型（i18n key + 参数，不产出成品文案）。
 * lookup 留在 main.jsx 调用方（照 market-state.js registryNotice 先例）。
 * 运行：node --test tests/client-installed-view.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { installedViewModel, registrySourceKey } from '../src/client/installed-view.js'

describe('installedViewModel', () => {
  it('githubRepo 优先级：registryGithub > githubRepo > spec 抽取 > null', () => {
    assert.equal(installedViewModel({ registryGithub: 'o/r', githubRepo: 'o2/r2', spec: 'github:x/y#s' }).githubRepo, 'o/r')
    assert.equal(installedViewModel({ githubRepo: 'o2/r2', spec: 'github:x/y#s' }).githubRepo, 'o2/r2')
    assert.equal(installedViewModel({ spec: 'github:x/y#abc123' }).githubRepo, 'x/y')
    assert.equal(installedViewModel({ spec: 'github:x/y' }).githubRepo, 'x/y')
    assert.equal(installedViewModel({ spec: 'npm:x' }).githubRepo, null)
  })

  it('sourceLabelKey：五类白名单，未知来源归 null（调用方回退原始字符串）', () => {
    assert.equal(installedViewModel({ source: 'npm', spec: 'npm:x' }).sourceLabelKey, 'src.npm')
    assert.equal(installedViewModel({ source: 'github', spec: 'npm:x' }).sourceLabelKey, 'src.github')
    assert.equal(installedViewModel({ source: 'link', spec: 'npm:x' }).sourceLabelKey, 'src.link')
    assert.equal(installedViewModel({ source: 'file', spec: 'npm:x' }).sourceLabelKey, 'src.file')
    assert.equal(installedViewModel({ source: 'unknown', spec: 'npm:x' }).sourceLabelKey, 'src.unknown')
    assert.equal(installedViewModel({ source: 'weird', spec: 'npm:x' }).sourceLabelKey, null)
  })

  it('guard：link 带 path 参数，file 无参 warn，其余仅 confirm（key 化，不渲染文案）', () => {
    assert.deepEqual(
      installedViewModel({ source: 'link', path: '/x/y', spec: 'npm:x' }).guard,
      { confirmKey: 'confirm.unlink', warnKey: 'warn.unlink', warnParams: { path: '/x/y' } },
    )
    assert.deepEqual(
      installedViewModel({ source: 'file', spec: 'npm:x' }).guard,
      { confirmKey: 'confirm.core', warnKey: 'warn.core', warnParams: {} },
    )
    assert.deepEqual(
      installedViewModel({ source: 'npm', spec: 'npm:x' }).guard,
      { confirmKey: 'confirm.uninstall', warnKey: null, warnParams: {} },
    )
  })

  it('latestLabel：tag 优先，其次 v{version}；徽标空串与详情 — 两种 fallback', () => {
    assert.equal(installedViewModel({ latestTag: 'v2', latestVersion: '1.0.0', spec: 'npm:x' }).latestLabel, 'v2')
    assert.equal(installedViewModel({ latestVersion: '1.2.3', spec: 'npm:x' }).latestLabel, 'v1.2.3')
    assert.equal(installedViewModel({ spec: 'npm:x' }).latestLabel, '')
    assert.equal(installedViewModel({ spec: 'npm:x' }).latestLabelDetail, '—')
    assert.equal(installedViewModel({ latestTag: 'v2', spec: 'npm:x' }).latestLabelDetail, 'v2')
  })

  it('缺 spec 抛 TypeError（现状钉死：急切求值不加固，与模块注释一致）', () => {
    assert.throws(() => installedViewModel({ source: 'npm' }), TypeError)
  })

  it('输出不含成品文案：所有 *Key 值都是 i18n key 形状', () => {
    const vm = installedViewModel({ source: 'link', path: '/home/u/x', spec: 'github:o/r' })
    const s = JSON.stringify(vm)
    assert.ok(!s.includes('已安装') && !s.includes('卸载'))
  })
})

describe('registrySourceKey', () => {
  it('官方/自定义/旧字段 → i18n key；无数据 null；未知 source 原样返回', () => {
    assert.equal(registrySourceKey(null), null)
    assert.equal(registrySourceKey({ source: 'default-raw' }), 'src.default.raw')
    assert.equal(registrySourceKey({ source: 'default-jsdelivr' }), 'src.default.jsdelivr')
    assert.equal(registrySourceKey({ source: 'default-cache' }), 'src.default.cache')
    assert.equal(registrySourceKey({ source: 'bundled' }), 'src.bundled')
    assert.equal(registrySourceKey({ source: 'custom-url' }), 'src.custom.url')
    assert.equal(registrySourceKey({ source: 'custom-file' }), 'src.custom.file')
    assert.equal(registrySourceKey({ source: 'custom-cache' }), 'src.custom.cache')
    assert.equal(registrySourceKey({ source: 'custom-unavailable' }), 'src.custom.unavailable')
    assert.equal(registrySourceKey({ source: 'override' }), 'src.override')
    assert.equal(registrySourceKey({ source: 'jsdelivr' }), 'src.jsdelivr')
    assert.equal(registrySourceKey({ source: 'raw' }), 'src.raw')
    assert.equal(registrySourceKey({ source: 'cache' }), 'src.cache')
    assert.equal(registrySourceKey({ source: 'brand-new' }), 'brand-new')
  })
})
