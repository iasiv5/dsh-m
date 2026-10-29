/**
 * 已装页 pure view：InstalledItem → 视图模型（i18n key + 参数，不产出成品文案）。
 * lookup 留在 main.jsx 调用方（照 market-state.js registryNotice 先例）。
 * 0.10.0 Task 11 ④：入口回归钉——已装列表升级走通用 upgrade API，对 dsh-m 零客户端特判。
 * 运行：node --test tests/client-installed-view.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

describe('installedViewModel：0.4.0 相位/开关字段（Task 17）', () => {
  const base = { source: 'npm', spec: 'pkg@1.0.0' }
  it('有相位 → phaseKey；enabled:false → off 标签', () => {
    const vm = installedViewModel({ ...base, phase: 'failed', enabled: false })
    assert.equal(vm.phaseKey, 'phase.failed')
    assert.equal(vm.enabledLabelKey, 'toggle.state.off')
  })
  it('无相位 → null；enabled:true → on 标签', () => {
    const vm = installedViewModel({ ...base, phase: null, enabled: true })
    assert.equal(vm.phaseKey, null)
    assert.equal(vm.enabledLabelKey, 'toggle.state.on')
  })
  it('旧字段缺省（无 phase/enabled）→ on 标签兼容', () => {
    const vm = installedViewModel({ ...base })
    assert.equal(vm.enabledLabelKey, 'toggle.state.on')
  })
})

// ---------- 0.10.0 Task 11 ④：入口回归钉——已装列表升级对 dsh-m 零客户端特判（R6：改道唯一执行点在服务端 core 缝） ----------
describe('已装列表升级入口零特判（0.10.0 Task 11 ④）', () => {
  const src = readFileSync(new URL('../src/client/main.jsx', import.meta.url), 'utf8')

  it('已装列表 doUpgrade 走通用 upgrade API，零 self-upgrade/SELF_PKG/dsh-m 特判（ADR-0023 T11：切片随 Tab 出仓分文件）', () => {
    const mt = readFileSync(new URL('../src/client/market-tab.jsx', import.meta.url), 'utf8')
    const itSrc = readFileSync(new URL('../src/client/installed-tab.jsx', import.meta.url), 'utf8')
    const first = mt.indexOf('const doUpgrade = async (it) => {')
    assert.ok(first >= 0, '市场卡升级站点在（market-tab.jsx）')
    const start = itSrc.indexOf('const doUpgrade = async (it) => {')
    assert.ok(start >= 0, '已装列表升级站点在（installed-tab.jsx）')
    const end = itSrc.indexOf('if (loading && !data) return', start)
    assert.ok(end > start, '切片边界在（installed-tab.jsx）')
    const body = itSrc.slice(start, end)
    assert.ok(body.includes('api("upgrade", { pkg: it.pkg })'), '走通用 upgrade API')
    assert.ok(!body.includes('self-upgrade'), '零 self-upgrade 特判')
    assert.ok(!body.includes('SELF_PKG'), '零 SELF_PKG 特判')
    assert.ok(!body.includes('dsh-m'), '零 dsh-m 字面特判（D3 语义由服务端 core 缝自动覆盖）')
  })
})

// ---------- issue #10：「全部更新」批量串行 + 失败短路 + dsh-m 收尾（定序在 installed-updates.batchUpgradeOrder） ----------
// 行为纯逻辑测在 client-installed-updates.test.mjs；本块只锚 installed-tab.jsx 的接线结构。
describe('全部更新批量接线（issue #10）', () => {
  const itSrc = readFileSync(new URL('../src/client/installed-tab.jsx', import.meta.url), 'utf8')

  it('① 旧的一次性全发（void 丢 Promise）绝迹', () => {
    assert.equal(itSrc.split('void doUpgrade(').length - 1, 0, '批量旧实现已删；逐项 await 是唯一发起方式')
  })

  it('② 批量循环逐项 await + systemic 短路（单处；ADR-0026 改写：target 失败跳过继续）', () => {
    assert.equal(itSrc.split('for (const it of batch.targets) {').length - 1, 1, '串行循环唯一')
    assert.equal(itSrc.split('if (outcome === "systemic") {').length - 1, 1, 'systemic 即停（守卫拦截/事务半残不在半残 profile 上继续；目标级失败由循环继续 + 末尾汇总）')
  })

  it('③ 批量定序单源 batchUpgradeOrder（计数/可见性/循环共用一份）', () => {
    assert.equal(itSrc.split('batchUpgradeOrder(items)').length - 1, 1, '定序调用唯一')
    assert.ok(itSrc.includes('lookup("installed.upgradeAll", { n: batch.targets.length })'), '计数用排序后 targets（dsh-m 含入，收尾）')
    assert.ok(itSrc.includes('batch.selfIncluded'), '自升级收尾提示接线在')
  })

  it('④ doUpgrade 三态契约（ADR-0026 改写）：成功臂返回 "ok"；失败臂按 failureClass 分类', () => {
    const start = itSrc.indexOf('const doUpgrade = async (it) => {')
    const end = itSrc.indexOf('if (loading && !data) return', start)
    assert.ok(end > start, 'doUpgrade 切片边界在')
    const body = itSrc.slice(start, end)
    assert.ok(body.includes('return "ok";'), '成功臂（含降级恢复/良性跳过面）返回 ok')
    assert.ok(body.includes('classifyBatchOutcome(e)'), '失败臂按 failureClass 三态（superseded 良性跳过归 ok；字段缺席缺省 target）')
  })

  it('⑤ 收尾提示文案双字典在位（i18n.js zh/en 各一枚）', () => {
    const i18nSrc = readFileSync(new URL('../src/client/i18n.js', import.meta.url), 'utf8')
    assert.equal(i18nSrc.split('"installed.upgradeAll.selfLast"').length - 1, 2, 'zh/en 各一枚')
  })
})
