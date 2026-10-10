/**
 * 0.9.74 截图条滚轮横滚单测：shotWheelAction 纯判定（钢人三红线）+ main.jsx 接线源锚。
 * 运行：npm test 自动发现（node --test）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shotWheelAction } from '../src/client/wheel-strip.js'

const here = dirname(fileURLToPath(import.meta.url))
const mainSrc = readFileSync(join(here, '../src/client/main.jsx'), 'utf8')

// 满行溢出的基准行：内容 1400px、视口 688px、当前滚到 100px（deltaX=0 = 裸滚轮形态）
const OVERFLOW_ROW = { deltaX: 0, scrollWidth: 1400, clientWidth: 688, scrollLeft: 100 }

describe('shotWheelAction（0.9.74 钢人三红线）', () => {
  it('红线① 可滚才拦：不满行零劫持（滚轮黑洞同构病预防锚）', () => {
    assert.deepEqual(
      shotWheelAction({ deltaX: 0, deltaY: 120, scrollWidth: 688, clientWidth: 688, scrollLeft: 0 }),
      { scrollBy: 0, preventDefault: false },
      '恰好无溢出 → 放行',
    )
    assert.deepEqual(
      shotWheelAction({ deltaX: 0, deltaY: 120, scrollWidth: 689, clientWidth: 688, scrollLeft: 0 }),
      { scrollBy: 0, preventDefault: false },
      '+1 亚像素容差内不算溢出（0.9.72 useScrollableContain 同款口径）',
    )
    assert.deepEqual(
      shotWheelAction({ deltaX: 0, deltaY: 120, scrollWidth: 690, clientWidth: 688, scrollLeft: 0 }),
      { scrollBy: 120, preventDefault: true },
      '+2 起算真溢出 → 拦',
    )
  })
  it('红线② 到头放行：边界上纵滚还给弹窗（滚动链自然语义）', () => {
    const maxScrollLeft = OVERFLOW_ROW.scrollWidth - OVERFLOW_ROW.clientWidth // 712
    assert.deepEqual(
      shotWheelAction({ ...OVERFLOW_ROW, scrollLeft: maxScrollLeft, deltaY: 120 }),
      { scrollBy: 0, preventDefault: false },
      '已到最右 + 继续下滚 → 放行',
    )
    assert.deepEqual(
      shotWheelAction({ ...OVERFLOW_ROW, scrollLeft: maxScrollLeft - 1, deltaY: 120 }),
      { scrollBy: 0, preventDefault: false },
      '到头 -1 容差内也算到头',
    )
    assert.deepEqual(
      shotWheelAction({ ...OVERFLOW_ROW, scrollLeft: 0, deltaY: -120 }),
      { scrollBy: 0, preventDefault: false },
      '已到最左 + 继续上滚 → 放行',
    )
    assert.deepEqual(
      shotWheelAction({ ...OVERFLOW_ROW, scrollLeft: 1, deltaY: -120 }),
      { scrollBy: -120, preventDefault: true },
      '离开左端 1px → 拦负向',
    )
  })
  it('中部正常映射：deltaY 原值直给 scrollLeft', () => {
    assert.deepEqual(shotWheelAction({ ...OVERFLOW_ROW, deltaY: 120 }), { scrollBy: 120, preventDefault: true })
    assert.deepEqual(shotWheelAction({ ...OVERFLOW_ROW, deltaY: -53 }), { scrollBy: -53, preventDefault: true })
  })
  it('红线③ deltaX 不碰：触控板横滑走原生（不拦不重复喂）', () => {
    assert.deepEqual(
      shotWheelAction({ ...OVERFLOW_ROW, deltaX: 120, deltaY: 40 }),
      { scrollBy: 0, preventDefault: false },
      '|deltaX| ≥ |deltaY| → 原生横滚',
    )
    assert.deepEqual(
      shotWheelAction({ ...OVERFLOW_ROW, deltaX: -120, deltaY: 0 }),
      { scrollBy: 0, preventDefault: false },
      '纯 deltaX → 原生',
    )
  })
  it('非有限输入安全短路；deltaY=0 无意义不拦', () => {
    for (const bad of [
      { deltaX: NaN, deltaY: 120, scrollWidth: 1400, clientWidth: 688, scrollLeft: 100 },
      { deltaX: 0, deltaY: undefined, scrollWidth: 1400, clientWidth: 688, scrollLeft: 100 },
      { deltaX: 0, deltaY: 120, scrollWidth: Infinity, clientWidth: 688, scrollLeft: 100 },
    ]) {
      assert.deepEqual(shotWheelAction(bad), { scrollBy: 0, preventDefault: false }, `异常输入零动作: ${JSON.stringify(bad)}`)
    }
    assert.deepEqual(
      shotWheelAction({ ...OVERFLOW_ROW, deltaY: 0, deltaX: 0 }),
      { scrollBy: 0, preventDefault: false },
      'deltaY=0（会被 deltaX 占优分支覆盖，此用例钉 0/0 形态）',
    )
  })
})

describe('main.jsx 截图条滚轮接线源锚（0.9.74）', () => {
  const modalSeg = mainSrc.slice(mainSrc.indexOf('function DetailModal('), mainSrc.indexOf('// ---------- 市场页'))
  it('接线三件：手动 addEventListener({passive:false}) + 事件内现读布局 + visible.length 重挂', () => {
    assert.ok(mainSrc.includes('const { shotWheelAction } = require("./wheel-strip.js")'), '纯函数 require 在')
    assert.ok(/addEventListener\("wheel", onWheel, \{ passive: false \}\)/.test(modalSeg), '手动挂 wheel（React onWheel passive 委托不可 preventDefault）')
    assert.ok(/removeEventListener\("wheel", onWheel\)/.test(modalSeg), '卸载移除')
    assert.ok(modalSeg.includes('row.scrollWidth, clientWidth: row.clientWidth, scrollLeft: row.scrollLeft'), '判定入参逐事件现读（无缓存失效问题）')
    assert.ok(/\}, \[visible\.length\]\)/.test(modalSeg.slice(modalSeg.indexOf('shotRowRef'))), 'deps=visible.length（条件渲染/异步到达/坏图剔除）')
  })
  it('ref 挂在截图条 div 上（条件渲染存在性随 visible.length）', () => {
    assert.ok(/ref: shotRowRef, className: "dsvm-shotrow"/.test(modalSeg), 'shotrow div 挂 shotRowRef')
    assert.ok(modalSeg.includes('const shotRowRef = useRef(null)'), 'shotRowRef 声明在')
  })
})
