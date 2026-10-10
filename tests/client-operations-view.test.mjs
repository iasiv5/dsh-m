/**
 * 0.9.75 操作记录信息增强：operations-view 纯函数（时刻/耗时/版本对/按日分组/行 VM）+
 * main.jsx 接线结构锚（仓库惯例同 client-window-drag / client-lightbox）。
 * 时间断言全部经本地 Date 构造派生期望值，不写死任何时区偏移（任何 TZ 下应全绿）。
 * 运行：node --test tests/client-operations-view.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { pad2, fmtOpClock, fmtOpFull, opDayKey, fmtOpDuration, opUpgradeMeta, groupOpsByDay, opRowVm } from '../src/client/operations-view.js'

const root = join(fileURLToPath(import.meta.url), '..', '..')

// ---------- 格式化纯函数 ----------

describe('fmtOpDuration：终态耗时紧凑格式（TZ 无关）', () => {
  const cases = [
    [0, '<1s'],
    [999, '<1s'],
    [1000, '1s'],
    [59000, '59s'],
    [61000, '1m01s'],
    [3599000, '59m59s'],
    [3720000, '1h02m'],
    [10800000 + 5 * 60000, '3h05m'],
    [-1, ''],
    [NaN, ''],
    ['4200', ''],
    [null, ''],
  ]
  for (const [ms, want] of cases) {
    it(`${ms} → ${want || "''"}`, () => assert.equal(fmtOpDuration(ms), want))
  }
})

describe('时刻与日期键（本地时区派生，不写死偏移）', () => {
  // 2026-10-10 21:58:05 本地时间构造
  const ts = new Date(2026, 9, 10, 21, 58, 5).getTime()
  const y = new Date(2026, 0, 5, 3, 4).getTime() // 2026-01-05 03:04:00 本地
  it('fmtOpClock → HH:mm 且个位补零', () => {
    assert.equal(fmtOpClock(ts), '21:58')
    assert.equal(fmtOpClock(y), '03:04')
  })
  it('fmtOpFull → YYYY-MM-DD HH:mm:ss', () => {
    assert.equal(fmtOpFull(ts), '2026-10-10 21:58:05')
    assert.equal(fmtOpFull(y), '2026-01-05 03:04:00')
  })
  it('opDayKey → YYYY-MM-DD（与本地 Date 各字段一致）', () => {
    assert.equal(opDayKey(ts), '2026-10-10')
    assert.equal(opDayKey(y), '2026-01-05')
    const d = new Date(ts)
    assert.equal(opDayKey(ts), `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`)
  })
})

describe('opUpgradeMeta：升级版本对（from/to，sha 回退 7 位）', () => {
  it('from + to 齐全', () => {
    assert.deepEqual(opUpgradeMeta({ fromVersion: '0.9.71', version: '0.9.72' }), { from: '0.9.71', to: '0.9.72' })
  })
  it('缺 from（首装后直升级）→ from 空串', () => {
    assert.deepEqual(opUpgradeMeta({ version: '1.2.3' }), { from: '', to: '1.2.3' })
  })
  it('github 源缺 version → sha 前 7 位', () => {
    assert.deepEqual(opUpgradeMeta({ fromVersion: '0.1.2', sha: 'abcdef1234567890' }), { from: '0.1.2', to: 'abcdef1' })
  })
  it('两侧皆空 / 非对象 → null（不入账）', () => {
    assert.equal(opUpgradeMeta({}), null)
    assert.equal(opUpgradeMeta(null), null)
    assert.equal(opUpgradeMeta('x'), null)
  })
})

// ---------- 按日分组 ----------

describe('groupOpsByDay：新组在前、组内新→旧、非法时间落末组', () => {
  const now = new Date(2026, 9, 10, 12, 0, 0).getTime() // 2026-10-10 12:00 本地
  const at = (mo, d, h, mi) => new Date(2026, mo, d, h, mi).getTime()
  const records = [
    { id: 'old', createdAt: at(9, 8, 9, 0) }, // 10-08（更早；mo 为 0 基：9 = 十月）
    { id: 'yest', createdAt: at(9, 9, 18, 30) }, // 昨天
    { id: 't1', createdAt: at(9, 10, 9, 0) }, // 今天 09:00
    { id: 't2', createdAt: at(9, 10, 10, 0) }, // 今天 10:00（更新）
    { id: 'bad', createdAt: 'nope' }, // 非法
  ]
  const groups = groupOpsByDay(records, now)
  it('组序：今天 → 昨天 → 更早日期 → 非法末组', () => {
    assert.deepEqual(
      groups.map((g) => g.key),
      ['2026-10-10', '2026-10-09', '2026-10-08', ''],
    )
    assert.deepEqual(
      groups.map((g) => g.kind),
      ['today', 'yesterday', 'date', 'date'],
    )
  })
  it('组内新→旧', () => {
    assert.deepEqual(groups[0].records.map((r) => r.id), ['t2', 't1'])
  })
  it('空入参 / 非数组安全', () => {
    assert.deepEqual(groupOpsByDay([], now), [])
    assert.deepEqual(groupOpsByDay(null, now), [])
  })
})

// ---------- 行视图模型 ----------

describe('opRowVm：方向/来源/版本/耗时派生与优雅回退', () => {
  const base = { id: 'r', createdAt: new Date(2026, 9, 10, 21, 58, 0).getTime() }
  it('toggle meta.on=true → dir on；false → off', () => {
    assert.equal(opRowVm({ ...base, kind: 'toggle', status: 'done', meta: { on: true } }).dir, 'on')
    assert.equal(opRowVm({ ...base, kind: 'toggle', status: 'done', meta: { on: false } }).dir, 'off')
    assert.equal(opRowVm({ ...base, kind: 'community-toggle', status: 'done', meta: { on: false } }).dir, 'off')
  })
  it('缺 meta.on / 非开关类 → dir null（旧记录回退旧行形态）', () => {
    assert.equal(opRowVm({ ...base, kind: 'toggle', status: 'done' }).dir, null)
    assert.equal(opRowVm({ ...base, kind: 'upgrade', status: 'done', meta: { on: true } }).dir, null)
  })
  it('终态给耗时，非终态不给', () => {
    const done = opRowVm({ ...base, kind: 'install', status: 'done', updatedAt: base.createdAt + 61000 })
    assert.equal(done.durText, '1m01s')
    const run = opRowVm({ ...base, kind: 'install', status: 'running', updatedAt: base.createdAt + 61000 })
    assert.equal(run.durText, '')
  })
  it('升级版本串：齐全 / 缺 from / 缺 to', () => {
    const vm = (meta) => opRowVm({ ...base, kind: 'upgrade', status: 'done', meta }).version
    assert.equal(vm({ from: '0.9.71', to: '0.9.72' }), 'v0.9.71→v0.9.72')
    assert.equal(vm({ to: '0.9.72' }), '→v0.9.72')
    assert.equal(vm({ from: '0.9.71' }), 'v0.9.71→')
    assert.equal(vm({}), '')
  })
  it('session 字段退役（0.9.76 自纠）：泵所有权标记不是来源语义，VM 不再暴露', () => {
    const vm = opRowVm({ ...base, kind: 'install', status: 'done', meta: { session: true } })
    assert.equal('session' in vm, false, 'meta.session 不得被展示层消费')
    assert.equal(opRowVm({ ...base, kind: 'toggle', status: 'done', meta: { on: true, session: true } }).dir, 'on', 'dir 派生不受 session 退役影响')
  })
  it('非法/缺失输入不抛：null 记录、非数字时间戳', () => {
    const vm = opRowVm(null)
    assert.equal(vm.clock, '')
    assert.equal(vm.durText, '')
    assert.equal(vm.dir, null)
    assert.equal(opRowVm({ id: 'x', kind: 'toggle', status: 'done' }).clock, '')
  })
  it('full 与 dayKey 自洽（同一本地日期）', () => {
    const vm = opRowVm({ ...base, kind: 'toggle', status: 'done' })
    assert.ok(vm.full.startsWith(vm.full.slice(0, 10)))
    assert.equal(vm.clock.length, 5)
  })
})

// ---------- main.jsx 接线结构锚（仓库惯例：includes 级，不逐字正则） ----------

describe('main.jsx 操作记录增强接线结构锚', () => {
  const src = readFileSync(join(root, 'src/client/main.jsx'), 'utf8')
  it('消费 operations-view 视图模型', () => {
    assert.ok(src.includes('require("./operations-view.js")'), '必须 require ./operations-view.js')
    assert.ok(src.includes('groupOpsByDay(finished)'), '已结束区必须按日分组')
    assert.ok(src.includes('opRowVm(r)'), '行渲染必须走 opRowVm')
    assert.ok(src.includes('opUpgradeMeta(r)'), '升级调用点必须管道 opUpgradeMeta')
  })
  it('新展示元素与新 i18n 键在位', () => {
    assert.ok(src.includes('dsvm-optime'), '行内时刻列')
    assert.ok(src.includes('dsvm-opday'), '按日分组头')
    assert.ok(src.includes('dsvm-opdir'), '开关方向徽章')
    assert.ok(src.includes('dsvm-opver'), '升级版本串')
    assert.ok(src.includes('dsvm-opdur'), '耗时列')
    assert.ok(src.includes('"op.day.today"'), '今天组头键')
    assert.ok(src.includes('"op.day.yesterday"'), '昨天组头键')
    assert.ok(src.includes('settings.ops.group.done.n'), '已结束计数键')
  })
  it('旧病灶负向锚：社区开关专属的方向渲染已退役（被 opRowVm.dir 泛化取代）', () => {
    assert.equal(src.includes('const targetText'), false, 'targetText 局部派生不得残留')
    assert.equal(src.includes('"settings.ops.group.done"'), false, '无计数旧键不得残留（已被 group.done.n 取代）')
  })
  it('旧病灶负向锚：「对话」来源徽章已退役（0.9.76 自纠——meta.session 是泵所有权标记非来源语义）', () => {
    assert.equal(src.includes('dsvm-opsession'), false, '来源徽章类名不得残留')
    assert.equal(src.includes('op.session.tip'), false, '来源徽章 i18n 键不得残留')
    const vmSrc = readFileSync(join(root, 'src/client/operations-view.js'), 'utf8')
    assert.equal(vmSrc.includes('session:'), false, 'opRowVm 不得派生 session 字段')
  })
})
