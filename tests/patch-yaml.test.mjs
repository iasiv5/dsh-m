/**
 * patch-yaml 契约（plan Task 2）：
 * - readBundlePatchRows：dsh-m 单 insert / 注释头单行 / modsearch 双行（config 行 + insert 行）/
 *   坏 YAML / 根非序列 / insert 元素畸形 → readable:false；`!!js` 标量可解析；
 * - isSingleRowPlugin：可读 && inserts===1 && configRows===0；
 * - planRowOverride（官方 writePluginEnabled 纯函数版语义）：
 *   · 无匹配 → append `{id, disabled: !enabled}`（启用写显式 false）；
 *   · 命中且已是目标态 → changed:false（幂等）；
 *   · 命中 → 只翻转 disabled 键；name 限定（行 name 不等 → 不匹配）；
 *   · 跳过含 insert 的行；注释逐字保留；坏 YAML / 根非序列 → throw；
 * - readProfileOverrides：宽松读取，非 map / insert 行 / 无字符串 id 跳过。
 * fixture 全部手写脱敏样本（C2 红线：禁止拷贝生产 profile 文件）。
 * 运行：npm run build && node --test tests/patch-yaml.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  isSingleRowPlugin,
  planRowOverride,
  readBundlePatchRows,
  readProfileOverrides,
} from '../lib/core/patch-yaml.js'

describe('readBundlePatchRows：行枚举', () => {
  it('dsh-m 形态——单 insert 行（flow 风格）→ 单行插件', () => {
    const rows = readBundlePatchRows("- insert: [{id: dshm, name: 'dsh-m'}]\n")
    assert.deepEqual(rows, { inserts: [{ id: 'dshm', name: 'dsh-m' }], configRows: 0, readable: true })
    assert.equal(isSingleRowPlugin(rows), true)
  })

  it('surf 形态——block 风格 insert + name 带引号', () => {
    const rows = readBundlePatchRows('- insert: [{id: surf, name: "@iasiv5/dsh-surf"}]\n')
    assert.deepEqual(rows.inserts, [{ id: 'surf', name: '@iasiv5/dsh-surf' }])
    assert.equal(isSingleRowPlugin(rows), true)
  })

  it('better-sidebar 形态——注释头 + 单 insert，注释不影响枚举', () => {
    const text = [
      '# dsh-better-sidebar bundle patch',
      '#',
      '# This file is the `dsh.bundle.patch` layer of the published npm package.',
      '- insert: [{id: better-sidebar, name: dsh-better-sidebar}]',
      '',
    ].join('\n')
    const rows = readBundlePatchRows(text)
    assert.deepEqual(rows, {
      inserts: [{ id: 'better-sidebar', name: 'dsh-better-sidebar' }],
      configRows: 0,
      readable: true,
    })
    assert.equal(isSingleRowPlugin(rows), true)
  })

  it('modsearch 形态——config 补丁行 + insert 行 → 非单行（Bundle 级）', () => {
    const text = [
      '# 注释：路由 web seam 的搜索能力',
      '- id: web',
      '  config:',
      '    searchProvider: modsearch',
      '',
      '- insert:',
      "    - id: modsearch",
      "      name: '@liustack/modsearch'",
      '',
    ].join('\n')
    const rows = readBundlePatchRows(text)
    assert.equal(rows.readable, true)
    assert.equal(rows.configRows, 1)
    assert.deepEqual(rows.inserts, [{ id: 'modsearch', name: '@liustack/modsearch' }])
    assert.equal(isSingleRowPlugin(rows), false)
  })

  it('覆盖行（- id: x + disabled）也计入 configRows', () => {
    const rows = readBundlePatchRows('- id: ui-theme\n  disabled: true\n')
    assert.deepEqual(rows, { inserts: [], configRows: 1, readable: true })
    assert.equal(isSingleRowPlugin(rows), false)
  })

  it('坏 YAML → readable:false（调用方按多行处理）', () => {
    assert.equal(readBundlePatchRows('- id: [broken').readable, false)
  })

  it('根非序列 → readable:false', () => {
    assert.equal(readBundlePatchRows('id: web\n').readable, false)
    assert.equal(readBundlePatchRows('[]\n').readable, true) // 空序列合法
  })

  it('insert 元素畸形（非 map / 缺 id）→ readable:false', () => {
    assert.equal(readBundlePatchRows('- insert: [plain-scalar]\n').readable, false)
    assert.equal(readBundlePatchRows('- insert:\n    - name: no-id\n').readable, false)
  })

  it('非映射顶层项 → readable:false', () => {
    assert.equal(readBundlePatchRows('- just-a-string\n').readable, false)
  })

  it('`!!js` disabled 表达式可解析（customTags 原样保留）', () => {
    const text = '- id: preset-row\n  disabled: !!js "process.env.DSH_DISABLE === \'1\'"\n'
    const rows = readBundlePatchRows(text)
    assert.equal(rows.readable, true)
    assert.equal(rows.configRows, 1)
    assert.equal(isSingleRowPlugin(rows), false)
  })
})

describe('planRowOverride：保注释覆盖编辑', () => {
  it('无匹配 → append {id, disabled}；启用写显式 disabled: false', () => {
    const plan = planRowOverride('[]\n', 'better-sidebar', 'dsh-better-sidebar', true)
    assert.equal(plan.changed, true)
    assert.equal(plan.text.includes('id: better-sidebar'), true)
    assert.equal(plan.text.includes('disabled: false'), true)
  })

  it('无匹配 → 停用写 disabled: true', () => {
    const plan = planRowOverride('[]\n', 'skins', undefined, false)
    assert.equal(plan.changed, true)
    assert.equal(plan.text.includes('disabled: true'), true)
  })

  it('命中且已是目标态 → changed:false 幂等（不重复写盘）', () => {
    const text = '- id: skins\n  disabled: true\n'
    const plan = planRowOverride(text, 'skins', undefined, false)
    assert.equal(plan.changed, false)
    assert.equal(plan.text, text)
  })

  it('命中 → 只翻转 disabled 键，其余行与注释逐字保留', () => {
    const text = [
      '# 手写配置块（脱敏样本）',
      '- id: agentchat',
      '  name: agentchat-web-channel',
      '  config:',
      '    cwd: "/opt/demo"',
      '',
      '# 开关覆盖区',
      '- id: skins',
      '  disabled: false',
      '',
    ].join('\n')
    const plan = planRowOverride(text, 'skins', undefined, false)
    assert.equal(plan.changed, true)
    assert.equal(plan.text.includes('# 手写配置块（脱敏样本）'), true)
    assert.equal(plan.text.includes('# 开关覆盖区'), true)
    assert.equal(plan.text.includes('cwd: "/opt/demo"'), true)
    assert.equal(/id: skins\n  disabled: true/.test(plan.text), true)
    // 其他行不被改写
    assert.equal(plan.text.includes('name: agentchat-web-channel'), true)
  })

  it('name 限定：行 name 与目标不等 → 不匹配（走 append）', () => {
    const text = '- id: web\n  name: other-module\n  disabled: true\n'
    const plan = planRowOverride(text, 'web', 'my-module', true)
    // name 不等不命中既有行；append 新行，旧行保留
    assert.equal(plan.changed, true)
    assert.equal(plan.text.includes('name: other-module'), true)
    assert.equal((plan.text.match(/id: web/g) ?? []).length, 2)
  })

  it('name 缺省的行可被任意 name 的目标命中（官方 !expectedName 语义）', () => {
    const text = '- id: bare\n  disabled: true\n'
    const plan = planRowOverride(text, 'bare', 'whatever', true)
    assert.equal(plan.changed, true)
    assert.equal(plan.text.includes('disabled: false'), true)
  })

  it('跳过含 insert 的行（insert 声明不是覆盖目标）', () => {
    const text = "- insert: [{id: dshm, name: 'dsh-m'}]\n"
    const plan = planRowOverride(text, 'dshm', 'dsh-m', false)
    assert.equal(plan.changed, true)
    assert.equal(plan.text.includes('insert'), true)
    assert.equal(plan.text.includes('disabled: true'), true)
  })

  it('findLast 语义：多条同 id 覆盖行只改最后一条', () => {
    const text = '- id: x\n  disabled: true\n- id: x\n  disabled: false\n'
    const plan = planRowOverride(text, 'x', undefined, false)
    assert.equal(plan.changed, true)
    const lines = plan.text.split('\n').filter((l) => l.includes('disabled:'))
    assert.deepEqual(lines, ['  disabled: true', '  disabled: true'])
  })

  it('坏 YAML / 根非序列 → throw（调用方映射失败）', () => {
    assert.throws(() => planRowOverride('- broken: [', 'x', undefined, true))
    assert.throws(() => planRowOverride('mapping: true\n', 'x', undefined, true))
  })

  it('append 结果可再被 planRowOverride 解析（往返一致）', () => {
    const first = planRowOverride('[]\n', 'skins', undefined, false)
    const second = planRowOverride(first.text, 'skins', undefined, true)
    assert.equal(second.changed, true)
    const third = planRowOverride(second.text, 'skins', undefined, true)
    assert.equal(third.changed, false)
  })
})

describe('readProfileOverrides：宽松读取', () => {
  it('混合行：覆盖行返回、insert 行跳过、无 disabled 视为 false', () => {
    const text = [
      '- id: skins',
      '  disabled: true',
      '- id: web',
      '  config:',
      '    searchProvider: demo',
      "- insert: [{id: dshm, name: 'dsh-m'}]",
      '',
    ].join('\n')
    assert.deepEqual(readProfileOverrides(text), [
      { id: 'skins', disabled: true },
      { id: 'web', disabled: false },
    ])
  })

  it('坏 YAML / 根非序列 → []（读路径不抛）', () => {
    assert.deepEqual(readProfileOverrides('- broken: ['), [])
    assert.deepEqual(readProfileOverrides('a: 1\n'), [])
  })

  it('无字符串 id 的行跳过', () => {
    assert.deepEqual(readProfileOverrides('- disabled: true\n'), [])
    assert.deepEqual(readProfileOverrides('- id: 42\n  disabled: true\n'), [])
  })
})
