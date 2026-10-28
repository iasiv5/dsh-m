/**
 * 已装页两段加载合并/统计纯逻辑（ADR-0008）+ 0.10.0 降级恢复站点接线结构锚。
 * 运行：node --test tests/client-installed-updates.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { applyInstalledUpdates, installedUpdateStats, batchUpgradeOrder, classifyBatchOutcome, summarizeBatch, BATCH_SELF_PKG } from '../src/client/installed-updates.js'

const base = { pkg: 'a', name: 'A', version: '1.0.0' }
const upd = (over = {}) => ({
  pkg: 'a', latestVersion: '2.0.0', latestTag: null, latestSha: null,
  outdated: true, latestError: null, latestErrorCode: null, ...over,
})

describe('applyInstalledUpdates', () => {
  it('七字段按 pkg 落位：outdated 与 latestError 项都在 updates 内', () => {
    const items = [{ ...base }, { pkg: 'b', name: 'B', version: '1.0.0' }]
    const updates = [
      upd(),
      { pkg: 'b', latestVersion: null, latestTag: null, latestSha: null, outdated: false, latestError: '更新检查未完成：超时', latestErrorCode: 'timeout' },
    ]
    const merged = applyInstalledUpdates(items, updates)
    assert.equal(merged[0].latestVersion, '2.0.0')
    assert.equal(merged[0].outdated, true)
    assert.equal(merged[1].latestError, '更新检查未完成：超时')
    assert.equal(merged[1].latestErrorCode, 'timeout')
    assert.equal(merged[1].outdated, false)
  })

  it('updates 缺席的 pkg 原样保留；未知 pkg 忽略', () => {
    const items = [{ ...base }, { pkg: 'c', name: 'C', version: '0.1.0' }]
    const merged = applyInstalledUpdates(items, [upd()])
    assert.equal(merged[1].latestVersion, undefined)
    assert.deepEqual(merged[1], { pkg: 'c', name: 'C', version: '0.1.0' })
  })

  it('不可变：原数组与原 item 对象不被改写', () => {
    const item = { ...base }
    const items = [item]
    applyInstalledUpdates(items, [upd()])
    assert.deepEqual(item, { pkg: 'a', name: 'A', version: '1.0.0' })
    assert.equal(items.length, 1)
  })

  it('items/updates 非数组安全降级', () => {
    assert.deepEqual(applyInstalledUpdates(null, [upd()]), [])
    assert.deepEqual(applyInstalledUpdates([{ ...base }], 'nope'), [{ ...base }])
    assert.deepEqual(applyInstalledUpdates(undefined, undefined), [])
  })
})

describe('installedUpdateStats', () => {
  it('分别计数 outdated 与 latestError；null 安全', () => {
    const items = [
      { pkg: 'a', outdated: true },
      { pkg: 'b', outdated: false, latestError: '更新检查未完成：超时' },
      { pkg: 'c', outdated: true, latestError: 'GitHub 更新检查预算已用尽' },
      { pkg: 'd', outdated: false },
    ]
    assert.deepEqual(installedUpdateStats(items), { outdatedCount: 2, incompleteCount: 2 })
    assert.deepEqual(installedUpdateStats(null), { outdatedCount: 0, incompleteCount: 0 })
  })
})

// ---------- issue #10 修复③：「全部更新」批量定序——dsh-m 自升级收尾（pure） ----------
describe('batchUpgradeOrder（issue #10：dsh-m 收尾定序；自换装永无同批后续项）', () => {
  it('① dsh-m 固定收尾，普通项保持列表序在前；targets 元素是原 item 引用', () => {
    const self = { pkg: 'dsh-m', outdated: true }
    const b = { pkg: 'b', outdated: true }
    const c = { pkg: 'c', outdated: true }
    const items = [self, { pkg: 'a', outdated: false }, b, c]
    const { targets, selfIncluded } = batchUpgradeOrder(items)
    assert.deepEqual(targets.map((t) => t.pkg), ['b', 'c', 'dsh-m'], '普通项列表序在前 + 自升级收尾')
    assert.equal(selfIncluded, true)
    assert.equal(targets[2], self, '引用原 item 对象（latestVersion 等视图字段随原对象）')
  })

  it('② 无 dsh-m：targets 全部按列表序，selfIncluded=false（提示不渲染）', () => {
    const items = [{ pkg: 'x', outdated: true }, { pkg: 'y', outdated: true }]
    assert.deepEqual(batchUpgradeOrder(items), { targets: items, selfIncluded: false, unsupported: [] })
  })

  it('③ 只有 dsh-m outdated：targets 仅含自身，selfIncluded=true（批量退化为单点收尾升级）', () => {
    const self = { pkg: 'dsh-m', outdated: true }
    const { targets, selfIncluded } = batchUpgradeOrder([self, { pkg: 'z', outdated: false }])
    assert.deepEqual(targets, [self])
    assert.equal(selfIncluded, true)
  })

  it('④ 非数组/垃圾项/非 outdated 安全降级', () => {
    assert.deepEqual(batchUpgradeOrder(null), { targets: [], selfIncluded: false, unsupported: [] })
    assert.deepEqual(batchUpgradeOrder('nope'), { targets: [], selfIncluded: false, unsupported: [] })
    assert.deepEqual(batchUpgradeOrder([null, 'x', { pkg: 'a', outdated: false }, { outdated: true }]), { targets: [], selfIncluded: false, unsupported: [] })
  })

  it('⑤ BATCH_SELF_PKG 单点常量 = dsh-m（与 core profile-ops SELF_PKG 同值；客户端字面唯一处）', () => {
    assert.equal(BATCH_SELF_PKG, 'dsh-m')
  })
})

// ---------- ADR-0026：批量三态纯逻辑（issue #30，评审 F1/F2/N4） ----------
describe('ADR-0026：batchUpgradeOrder 排除 unsupported + classifyBatchOutcome + summarizeBatch', () => {
  it('① unsupported outdated 项不入 targets、进 unsupported；普通项与 self 收尾定序不变', () => {
    const a = { pkg: 'a', outdated: true }
    const b = { pkg: 'b', outdated: true, upgradePath: 'unsupported' }
    const self = { pkg: 'dsh-m', outdated: true }
    const { targets, selfIncluded, unsupported } = batchUpgradeOrder([a, b, self, { pkg: 'c', outdated: false }])
    assert.deepEqual(targets, [a, self], 'unsupported 排除后普通项 + dsh-m 收尾')
    assert.deepEqual(unsupported, [b])
    assert.equal(selfIncluded, true)
  })

  it('② classifyBatchOutcome 五例（评审 F1：字段缺席缺省 target，systemic 须显式）', () => {
    assert.equal(classifyBatchOutcome({ ok: true }), 'ok')
    assert.equal(classifyBatchOutcome({ failureClass: 'systemic' }), 'systemic')
    assert.equal(classifyBatchOutcome({ failureClass: 'target' }), 'target')
    assert.equal(classifyBatchOutcome({}), 'target', '字段缺席（服务端未标注）→ target')
    assert.equal(classifyBatchOutcome({ needsBuildApproval: true }), 'target', 'build 审批等待属目标级')
  })

  it('③ summarizeBatch：systemic>0 → stopped；skippedUnsupported 由调用方传入（N4 形状）', () => {
    const ok = { pkg: 'a', outcome: 'ok' }
    const tgt = { pkg: 'b', outcome: 'target' }
    const sys = { pkg: 'c', outcome: 'systemic' }
    assert.deepEqual(
      summarizeBatch([ok, tgt, sys], 2),
      { targetFailed: 1, systemic: 1, skippedUnsupported: 2, stopped: true },
    )
    assert.deepEqual(
      summarizeBatch([ok, tgt], 0),
      { targetFailed: 1, systemic: 0, skippedUnsupported: 0, stopped: false },
    )
  })
})

// ---------- 0.10.0 Task 10：降级恢复结局站点接线（main.jsx 源串结构锚；单行锚——避开 CRLF 多行锚陷阱） ----------
describe('降级恢复站点接线（0.10.0 Task 10：市场卡 + 已装列表两处升级站点；ADR-0023 T11：站点随 Tab 出仓，计数改双文件合计）', () => {
  const marketTabSrc = readFileSync(new URL('../src/client/market-tab.jsx', import.meta.url), 'utf8')
  const installedTabSrc = readFileSync(new URL('../src/client/installed-tab.jsx', import.meta.url), 'utf8')
  const both = marketTabSrc + '\n' + installedTabSrc
  const src = both
  const count = (needle) => both.split(needle).length - 1

  it('① 两处升级站点都先问降级分支（恰两处）', () => {
    assert.equal(count('const degraded = oc.degradedOutcome(res);'), 2, '市场卡 doUpgrade + 已装列表 doUpgrade 各一处')
  })

  it('② 降级分支 warn 通知、不进 upgradeOkText 成功臂（守卫分支恰两处）', () => {
    assert.equal(count('if (degraded) {'), 2)
    assert.equal(count('notify({ kind: "warn", text: degraded.text });'), 2, '降级走 warn（零「升级成功 vX→vY」路径）')
  })

  it('③ 市场卡站点同步 setInstallNote 降级句（恰一处；已装列表站点无 installNote 惯例）', () => {
    assert.equal(count('setInstallNote({ id: it.id, kind: "warn", text: degraded.text });'), 1)
  })

  it('④ 文案键双字典同层：op.degraded zh 逐字 + en 键在位（i18n.js 词典面——ADR-0023 T1）', () => {
    const i18nSrc = readFileSync(new URL('../src/client/i18n.js', import.meta.url), 'utf8')
    assert.ok(i18nSrc.includes('"op.degraded": "升级失败：新版安装未成功，已自动恢复旧版 {restoredTo}——插件当前可用，可稍后重试。"'), 'zh 字典逐字锚')
    assert.equal(i18nSrc.split('"op.degraded":').length - 1, 2, 'zh/en 各一枚')
  })
})

// ---------- 0.10.3（挂账 1 数据面）：升级目标版随 enqueue 落 meta（中断恢复对账的比对依据） ----------
// 0.10.20（2026-10-26 真机实证）：增 from（入队时实装版）——中断恢复对账改判后行内渲染 v旧→v新 的原版本号数据源
// ADR-0023 T10：chip 站点锚（:97）随 DshmVersionChip 迁 version-chip.jsx；其余站点留 main.jsx
describe('升级 enqueue meta 携带 toVersion + from（0.10.3 单行锚；0.10.20 增 from；ADR-0023 T11：站点随 Tab/chip 出仓分锚）', () => {
  const versionChipSrc = readFileSync(new URL('../src/client/version-chip.jsx', import.meta.url), 'utf8')
  const marketTabSrc = readFileSync(new URL('../src/client/market-tab.jsx', import.meta.url), 'utf8')
  const installedTabSrc = readFileSync(new URL('../src/client/installed-tab.jsx', import.meta.url), 'utf8')
  const src = marketTabSrc + '\n' + installedTabSrc
  const count = (needle) => src.split(needle).length - 1

  it('① chip 静默升级以运行时探测的 latest 为目标版、运行中版本为 from（version-chip.jsx——ADR-0023 T10）', () => {
    assert.equal(versionChipSrc.split('{ npm: "dsh-m", from: version, toVersion: state.latest }').length - 1, 1)
  })

  it('② 已装列表以 updates 合并的 latestVersion 为目标版、当前实装 it.version 为 from（installed-tab.jsx）', () => {
    assert.equal(installedTabSrc.split('{ from: it.version, toVersion: it.latestVersion }').length - 1, 1)
  })

  it('③ 市场卡以卡片 latest 为目标版、当前实装 it.installedVersion 为 from（升级站点 meta 原为空对象，第 4 参落 meta；market-tab.jsx）', () => {
    assert.equal(marketTabSrc.split('{ from: it.installedVersion, toVersion: it.latest }').length - 1, 1, '市场卡 doUpgrade meta 锚')
  })
})
