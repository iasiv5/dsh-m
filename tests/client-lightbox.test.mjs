/**
 * 0.9.60 截图灯箱 v2 回归门（含评审吸收轮 R1-R4）。
 * 根因：灯箱 position:fixed 原是 .dshm-panel（backdrop-filter + overflow:hidden）的后代，
 * 面板盒成为包含块——窗口态图片按视口单位放大必然超出 ≤680px 面板盒，‹›/圆点被裁出屏外、
 * 又无 ✕（全屏态面板恰为视口才可见）。v2：createPortal 挂 body + 控件绝对定位 + 点图即关。
 * 评审吸收：R1 复合选择器防 .dsvm-btn 级联反杀；R2 top 让出 Windows 拖拽带；
 * R3 焦点还原；R4 key 用序号防 URL 撞车。
 * 本文件：lbStep 纯逻辑单测 + main.jsx 结构锚（includes 级，避免整表达式逐字正则——
 * 那种断言红灯语义是「文本变了」而非「行为变了」）；渲染结构走 client-render-smoke（SSR 回退树），
 * 行为/计算样式/拖拽带走 scripts/verify-lightbox.mjs（手动跑，需 playwright-core+chromium）。
 * 运行：npm test 自动发现。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const src = readFileSync(join(root, 'src/client/main.jsx'), 'utf8')
const { lbStep } = await import(join(root, 'src/client/lightbox.js'))

describe('lbStep 环形步进（灯箱 ‹›/键盘 ←→ 共用）', () => {
  it('向前/向后回绕', () => {
    assert.equal(lbStep(0, 1, 3), 1)
    assert.equal(lbStep(2, 1, 3), 0, '末张向右回绕到首张')
    assert.equal(lbStep(0, -1, 3), 2, '首张向左回绕到末张')
    assert.equal(lbStep(1, -1, 3), 0)
  })
  it('步进跨零与任意步长仍按模回绕', () => {
    assert.equal(lbStep(0, -4, 3), 2)
    assert.equal(lbStep(2, 4, 3), 0)
  })
  it('length<=1 或非有限输入原地不动（单图灯箱/防御）', () => {
    assert.equal(lbStep(0, 1, 1), 0)
    assert.equal(lbStep(0, 1, 0), 0)
    assert.equal(lbStep(2, -1, 1), 2)
    assert.equal(lbStep(NaN, 1, 3), NaN)
    assert.equal(lbStep(0, NaN, 3), 0)
  })
})

describe('灯箱 v2 结构锚（0.9.60 根因修复 + 评审吸收守卫）', () => {
  it('portal 逃逸 .dshm-panel 包含块：挂 document.body', () => {
    assert.ok(src.includes('rd.createPortal(node, document.body)'), '浏览器走 createPortal 挂 body')
    assert.ok(src.includes('typeof document !== "undefined" && document.body'), '无 document（SSR）回退非 portal 树')
  })
  it('R1：✕/‹› 用复合选择器，防基础 .dsvm-btn 规则（源顺序靠后）级联反杀', () => {
    assert.ok(src.includes('.dsvm-btn.dsvm-lbclose{position:absolute;top:12px;right:12px'), '✕ 复合选择器在')
    assert.ok(src.includes('.dsvm-btn.dsvm-lbarrow{position:absolute;top:50%'), '‹› 复合选择器在')
    assert.ok(src.includes('.dsvm-btn.dsvm-lbarrow{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:60px;padding:0;font-size:26px'), '设计值 padding:0/font-size:26px 随复合选择器生效')
    assert.ok(!/(?<!\.dsvm-btn)\.dsvm-lbarrow\{position:absolute/.test(src), '单类 .dsvm-lbarrow 规则不得存在（会被反杀成摆设）')
    assert.ok(!/(?<!\.dsvm-btn)\.dsvm-lbclose\{position:absolute/.test(src), '单类 .dsvm-lbclose 规则不得存在')
  })
  it('R2：top 让出 Windows 拖拽带（0.9.4 先例），Web 回落 0px 行为不变', () => {
    assert.ok(src.includes('.dsvm-lightbox{position:fixed;top:var(--dsh-windows-titlebar-height,0px)'), '拖拽带避让在')
    assert.ok(!src.includes('.dsvm-lightbox{position:fixed;inset:0'), 'inset:0 形态退役（会把 ✕ 顶进拖拽带）')
  })
  it('R3：焦点还原——捕获声明在聚焦 ✕ 之前，卸载归还触发元素', () => {
    assert.ok(src.includes('prevFocusRef.current = document.activeElement;'), '捕获 activeElement 在')
    const capture = src.indexOf('prevFocusRef.current = document.activeElement;')
    const focus = src.indexOf('closeRef.current.focus()')
    assert.ok(capture > -1 && focus > -1 && capture < focus, '捕获先于聚焦（effect 按声明序执行）')
    assert.ok(src.includes('if (el && el.isConnected) el.focus();'), '卸载还原且防已卸载元素')
  })
  it('R4：圆点 key 用序号（URL 重复不撞车）', () => {
    assert.ok(src.includes('h("span", { key: i, className: `dsvm-lbdot'), '圆点 key=i')
    assert.ok(!src.includes('key: s, className: `dsvm-lbdot'), '旧 key:s（URL）退役')
  })
  it('✕ 常驻 + 点图即关（0.9.61 走链后仍保留 onClick=onClose 与 referrerPolicy 语义）', () => {
    assert.ok(src.includes('src: chain.src, alt: "", onClick: onClose, referrerPolicy: "no-referrer", decoding: "async", onError: chain.onError, onLoad: chain.onLoad'), 'img 走链 + 点图即关 + 属性保持')
    assert.ok(src.includes('className: "dsvm-btn dsvm-lbclose"'), '✕ 走 dsvm-btn 视觉 + dsvm-lbclose 定位')
  })
  it('底部 pill 绝对定位 + 图片 74vh 留位（构造上不可能被挤出屏）', () => {
    assert.ok(src.includes('.dsvm-lbbar{position:absolute;left:50%;bottom:14px'), 'pill 绝对定位')
    assert.ok(src.includes('.dsvm-lightbox img{max-width:min(92vw,1500px);max-height:74vh'), '图片降位（旧 80vh 在窗口态必然溢出面板盒）')
    assert.ok(!src.includes('.dsvm-lbnav{'), '旧 in-flow 导航行退役')
  })
  it('键盘 ‹› 与组件统一走 lbStep（内联取模退役；0.9.61 键盘基准随 visible）', () => {
    assert.ok(src.includes('lbStep(index, -1, shots.length)') && src.includes('lbStep(index, 1, shots.length)'), '组件 ‹› 走 lbStep')
    assert.ok(src.includes('lbStep(i, -1, visible.length)') && src.includes('lbStep(i, 1, visible.length)'), '键盘 ←→ 走 lbStep（0.9.61 基准 visible.length）')
    assert.ok(!src.includes('(index - 1 + shots.length) % shots.length'), '内联取模退役')
  })
})
