/**
 * 0.9.60 截图灯箱 v2 回归门。
 * 根因：灯箱 position:fixed 原是 .dshm-panel（backdrop-filter + overflow:hidden）的后代，
 * 面板盒成为包含块——窗口态图片按视口单位放大必然超出 ≤680px 面板盒，‹›/圆点被裁出屏外、
 * 又无 ✕（全屏态面板恰为视口才可见）。v2：createPortal 挂 body + 控件绝对定位 + 点图即关。
 * 本文件：lbStep 纯逻辑单测 + main.jsx 结构断言（portal/✕/点图关/单图收敛/CSS 绝对定位）。
 * 渲染结构走 client-render-smoke（SSR 回退树）；运行：npm test 自动发现。
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

describe('灯箱 v2 结构（0.9.60 根因修复守卫）', () => {
  it('portal 逃逸 .dshm-panel 包含块：createPortal 挂 document.body，无 document 回退原树', () => {
    assert.match(src, /return typeof document !== "undefined" && document\.body && typeof rd\.createPortal === "function"\s*\?\s*rd\.createPortal\(node, document\.body\)\s*:\s*node;/, '浏览器走 portal，SSR/无宿主回退非 portal 树')
  })
  it('✕ 关闭钮常驻 + 点图即关（img onClick=onClose，不再 stopPropagation 吞点击）', () => {
    assert.match(src, /h\("img", \{ src: shots\[index\], alt: "", onClick: onClose, referrerPolicy: "no-referrer" \}\)/, '点图即关')
    assert.match(src, /className: "dsvm-btn dsvm-lbclose"/, '✕ 常驻关闭钮')
    assert.match(src, /dsvm-lbclose", "aria-label": lookup\("common\.close"\)/, '✕ 走 i18n aria')
  })
  it('‹› 两侧箭头 + 底部计数/圆点 pill：绝对定位贴视口，构造上不可能被图片挤出屏', () => {
    assert.match(src, /\.dsvm-lbclose\{position:absolute;top:12px;right:12px/, '✕ 绝对定位右上')
    assert.match(src, /\.dsvm-lbarrow\{position:absolute;top:50%;transform:translateY\(-50%\)/, '‹› 绝对定位两侧居中')
    assert.match(src, /\.dsvm-lbbar\{position:absolute;left:50%;bottom:14px/, '底部 pill 绝对定位')
    assert.match(src, /\.dsvm-lightbox img\{max-width:min\(92vw,1500px\);max-height:74vh/, '图片降位给控件留空间（旧 80vh 在窗口态必然溢出面板盒）')
    assert.doesNotMatch(src, /\.dsvm-lbnav\{/, '旧 in-flow 导航行退役（被 pill 取代）')
  })
  it('单图收敛：不渲染 ‹›/计数/圆点（无死控件），✕ 仍在', () => {
    assert.match(src, /const single = shots\.length <= 1;/, '单图判定')
    assert.match(src, /single \? null : h\("button", \{ className: "dsvm-btn dsvm-lbarrow prev"/, '单图无 ‹')
    assert.match(src, /single\s*\?\s*null\s*:\s*h\(\s*"div",\s*\{ className: "dsvm-lbbar" \}/, '单图无底部 pill')
    assert.doesNotMatch(src, /single \? null : h\("button", \{ ref: closeRef/, '✕ 不受单图收敛影响')
  })
  it('键盘 ‹› 与组件内联取模统一走 lbStep（纯逻辑单测覆盖）', () => {
    assert.equal((src.match(/lbStep\(index, -1, shots\.length\)|lbStep\(i, -1, shots\.length\)/g) || []).length >= 2, true, '‹ 与 ← 都走 lbStep')
    assert.doesNotMatch(src, /\(index - 1 \+ shots\.length\) % shots\.length/, '内联取模退役')
  })
  it('灯箱开箱即聚焦 ✕（键盘用户第一时间可达退出，对齐 DetailModal U8 先例）', () => {
    assert.match(src, /function Lightbox\(\{ shots, index, onNav, onClose \}\) \{[\s\S]*?closeRef\.current\.focus\(\)/, '开箱聚焦关闭钮')
  })
})
