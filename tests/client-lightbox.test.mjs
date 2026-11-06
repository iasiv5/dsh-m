/**
 * 0.9.60 截图灯箱 v2 回归门（含评审吸收轮 R1-R4）。
 * 根因：灯箱 position:fixed 原是 .dshm-panel（backdrop-filter + overflow:hidden）的后代，
 * 面板盒成为包含块——窗口态图片按视口单位放大必然超出 ≤680px 面板盒，‹›/圆点被裁出屏外、
 * 又无 ✕（全屏态面板恰为视口才可见）。v2：createPortal 挂 body + 控件绝对定位 + 点图即关。
 * 评审吸收：R1 复合选择器防 .dsvm-btn 级联反杀；R2 top 让出 Windows 拖拽带；
 * R3 焦点还原；R4 key 用序号防 URL 撞车。
 * 0.9.62 批次：影院遮罩自持（background !important，清单定长）+ ‹›/✕ 深色玻璃芯片
 * （浅色皮肤 tint 碰撞实拍修复，双侧修复的 dsh-m 侧）+ 走链转圈/settled 淡入
 * （useImgChain 暴露 settled）+ prefers-reduced-motion。
 * 0.9.65 批次：邻图预取（settled 后同形 weservUrl 预热左右邻，URL 去重）+
 * 触屏滑动切换（pointer 只认 touch，swipeDir 判向，滑动后吞合成 click）+
 * 焦点圈闭（灯箱开着时 Tab/Shift+Tab 圈在灯箱内，焦点逃逸拉回）。
 * 本文件：lbStep 纯逻辑单测 + main.jsx 结构锚（includes 级，避免整表达式逐字正则——
 * 那种断言红灯语义是「文本变了」而非「行为变了」）；渲染结构走 client-render-smoke（SSR 回退树），
 * 行为/计算样式/拖拽带走 scripts/verify-lightbox.mjs（手动跑，需 playwright-core+chromium）。
 * 运行：npm test 自动发现。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const src = readFileSync(join(root, 'src/client/main.jsx'), 'utf8')
// ADR-0023 第一刀：CSS 锚改读 styles.js（JSX 锚仍读 main.jsx）；T10：Lightbox/Shot 面改读 chrome.jsx
const stylesSrc = readFileSync(join(root, 'src/client/styles.js'), 'utf8')
const chromeSrc = readFileSync(join(root, 'src/client/chrome.jsx'), 'utf8')
const detailModalSrc = readFileSync(join(root, 'src/client/detail-modal.jsx'), 'utf8')
// win32 盘符路径作 ESM specifier 会 ERR_UNSUPPORTED_ESM_URL_SCHEME——统一 pathToFileURL（跨平台）
const { lbStep, lbNeighbors, swipeDir } = await import(pathToFileURL(join(root, 'src/client/lightbox.js')).href)

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
  it('portal 逃逸 .dshm-panel 包含块：挂 document.body（Lightbox 体迁 chrome.jsx——ADR-0023 T10）', () => {
    assert.ok(chromeSrc.includes('rd.createPortal(node, document.body)'), '浏览器走 createPortal 挂 body')
    assert.ok(chromeSrc.includes('typeof document !== "undefined" && document.body'), '无 document（SSR）回退非 portal 树')
  })
  it('R1：✕/‹› 用复合选择器，防基础 .dsvm-btn 规则（源顺序靠后）级联反杀', () => {
    assert.ok(stylesSrc.includes('.dsvm-btn.dsvm-lbclose{position:absolute;top:12px;right:12px'), '✕ 复合选择器在')
    assert.ok(stylesSrc.includes('.dsvm-btn.dsvm-lbarrow{position:absolute;top:50%'), '‹› 复合选择器在')
    assert.ok(stylesSrc.includes('.dsvm-btn.dsvm-lbarrow{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:60px;padding:0;font-size:26px'), '设计值 padding:0/font-size:26px 随复合选择器生效')
    assert.ok(!/(?<!\.dsvm-btn)\.dsvm-lbarrow\{position:absolute/.test(stylesSrc), '单类 .dsvm-lbarrow 规则不得存在（会被反杀成摆设）')
    assert.ok(!/(?<!\.dsvm-btn)\.dsvm-lbclose\{position:absolute/.test(stylesSrc), '单类 .dsvm-lbclose 规则不得存在')
  })
  it('R2：top 让出 Windows 拖拽带（0.9.4 先例），Web 回落 0px 行为不变', () => {
    assert.ok(stylesSrc.includes('.dsvm-lightbox{position:fixed;top:var(--dsh-windows-titlebar-height,0px)'), '拖拽带避让在')
    assert.ok(!stylesSrc.includes('.dsvm-lightbox{position:fixed;inset:0'), 'inset:0 形态退役（会把 ✕ 顶进拖拽带）')
  })
  it('R3：焦点还原——捕获声明在聚焦 ✕ 之前，卸载归还触发元素（chrome.jsx）', () => {
    assert.ok(chromeSrc.includes('prevFocusRef.current = document.activeElement;'), '捕获 activeElement 在')
    const capture = chromeSrc.indexOf('prevFocusRef.current = document.activeElement;')
    const focus = chromeSrc.indexOf('closeRef.current.focus()')
    assert.ok(capture > -1 && focus > -1 && capture < focus, '捕获先于聚焦（effect 按声明序执行）')
    assert.ok(chromeSrc.includes('if (el && el.isConnected) el.focus();'), '卸载还原且防已卸载元素')
  })
  it('R4：圆点 key 用序号（URL 重复不撞车；chrome.jsx）', () => {
    assert.ok(chromeSrc.includes('h("span", { key: i, className: `dsvm-lbdot'), '圆点 key=i')
    assert.ok(!chromeSrc.includes('key: s, className: `dsvm-lbdot'), '旧 key:s（URL）退役')
  })
  it('✕ 常驻 + 点图即关（0.9.61 走链后仍保留 onClick=onClose 与 referrerPolicy 语义）', () => {
    assert.ok(chromeSrc.includes('src: chain.src, alt: "", onClick: onClose, referrerPolicy: "no-referrer", decoding: "async", onError: chain.onError, onLoad: chain.onLoad'), 'img 走链 + 点图即关 + 属性保持')
    assert.ok(chromeSrc.includes('className: "dsvm-btn dsvm-lbclose"'), '✕ 走 dsvm-btn 视觉 + dsvm-lbclose 定位')
  })
  it('底部 pill 绝对定位 + 图片 74vh 留位（构造上不可能被挤出屏）', () => {
    assert.ok(stylesSrc.includes('.dsvm-lbbar{position:absolute;left:50%;bottom:14px'), 'pill 绝对定位')
    assert.ok(stylesSrc.includes('.dsvm-lightbox img{max-width:min(92vw,1500px);max-height:74vh'), '图片降位（旧 80vh 在窗口态必然溢出面板盒）')
    assert.ok(!stylesSrc.includes('.dsvm-lbnav{'), '旧 in-flow 导航行退役')
  })
  it('键盘 ‹› 与组件统一走 lbStep（内联取模退役；0.9.61 键盘基准随 visible；ADR-0023 T10：‹› 半边随 Lightbox 迁 chrome.jsx，键盘半边在 DetailModal 留 main.jsx——拆双断言分别落位）', () => {
    assert.ok(chromeSrc.includes('lbStep(index, -1, shots.length)') && chromeSrc.includes('lbStep(index, 1, shots.length)'), '组件 ‹› 走 lbStep（chrome.jsx）')
    assert.ok(detailModalSrc.includes('lbStep(i, -1, visible.length)') && detailModalSrc.includes('lbStep(i, 1, visible.length)'), '键盘 ←→ 走 lbStep（DetailModal 迁 detail-modal.jsx——ADR-0023 T11；0.9.61 基准 visible.length）')
    assert.ok(!chromeSrc.includes('(index - 1 + shots.length) % shots.length') && !detailModalSrc.includes('(index - 1 + shots.length) % shots.length'), '内联取模退役（双文件扫描）')
  })
})

describe('灯箱 0.9.62 影院自持（皮肤碰撞修复）+ 加载指示', () => {
  it('影院遮罩自持：background !important（清单定长，新增须显式登记；ADR-0023 第一刀：计数随 CSS 迁 styles.js，实测四处全在 styles.js）', () => {
    assert.ok(stylesSrc.includes('.dsvm-lightbox{position:fixed;top:var(--dsh-windows-titlebar-height,0px);left:0;right:0;bottom:0;z-index:2147483200;background:rgba(0,0,0,.88)!important'), '影院深色遮罩 !important 自持（dsh-skins ADR-0007 浅色 tint 碰撞实拍）')
    assert.equal((stylesSrc.match(/!important/g) || []).length, 4, '!important 定长：注释提及×2 + 影院自持×1 + sidebar footer 兼容×1（0.9.70 拖拽自持退役清单回归）——新增须改本断言登记')
    assert.equal((src.match(/!important/g) || []).length, 0, 'main.jsx 侧零残留（CSS 出仓后 JS 面不得新增）')
  })
  it('拖拽态观感与静止态一致（0.9.70 修订）：仅光标/阴影变化，玻璃与 blur 不动', () => {
    assert.ok(stylesSrc.includes('.dshm-panel--dragging{cursor:grabbing;box-shadow:0 24px 64px rgba(2,6,23,.38)}'), '拖拽态只动光标与投影加深（0.9.69 实心固化浅色模式跳变实拍，退役）')
    assert.equal(stylesSrc.includes('--dshm-drag-bg') || src.includes('--dshm-drag-bg'), false, '计算值固化退役无残留（styles.js CSS/变量面 + main.jsx JS/注释面双扫）')
    assert.ok(stylesSrc.includes('.dshm-panel.abs{position:absolute;margin:0}'), '还原态绝对定位形态在（无记忆时 flex 居中不变）')
    assert.ok(stylesSrc.includes('.dshm-panel:not(.full):not(.dshm-panel--dragging) .dshm-head{cursor:grab}'), 'grab 仅还原态非拖拽中直接命中 head（拖拽中继承 grabbing；全屏不误导）')
  })
  it('‹›/✕ 深色玻璃芯片：任何遮罩上可读，显式 :hover 压基础规则源顺序', () => {
    assert.ok(stylesSrc.includes('.dsvm-btn.dsvm-lbclose,.dsvm-btn.dsvm-lbarrow{background:rgba(15,23,42,.55)'), '芯片深底在（与底部 pill 同族 slate-900）')
    assert.ok(stylesSrc.includes('border-color:rgba(255,255,255,.28);box-shadow:0 4px 16px rgba(0,0,0,.35);backdrop-filter:blur(8px)'), '描边+投影+blur 在')
    assert.ok(stylesSrc.includes('.dsvm-btn.dsvm-lbclose:hover,.dsvm-btn.dsvm-lbarrow:hover{background:rgba(15,23,42,.8)'), '显式 :hover 提亮（特异性 0,3,0 压 .dsvm-btn:hover 0,2,0）')
  })
  it('加载转圈：走链期间占位，settled 即卸载', () => {
    assert.ok(stylesSrc.includes('@keyframes dsvm-lbspin{to{transform:rotate(360deg)}}'), 'keyframes 在')
    assert.ok(stylesSrc.includes('.dsvm-lbspin{position:absolute;left:50%;top:50%'), '转圈居中定位在')
    assert.ok(chromeSrc.includes('!chain.settled && chain.src ? h("div", { className: "dsvm-lbspin", "aria-hidden": "true", onClick: onClose }) : null'), 'JSX 门控：未 settled 且有 src 才渲染；onClick=onClose（backdrop 守卫只认根元素，转圈子元素须显式接关；chrome.jsx）')
  })
  it('图片淡入：onLoad（settled）后 160ms 淡入，img 类名随 chain.settled', () => {
    assert.ok(stylesSrc.includes('.dsvm-lightbox .dsvm-lbimg{opacity:0;transition:opacity .16s ease-out}'), '淡入规则在')
    assert.ok(stylesSrc.includes('.dsvm-lightbox .dsvm-lbimg.dsvm-lbimg-on{opacity:1}'), 'settled 显影类在')
    assert.ok(chromeSrc.includes('className: `dsvm-lbimg${chain.settled ? " dsvm-lbimg-on" : ""}`'), 'img 类名接 settled（chrome.jsx）')
    assert.ok(chromeSrc.includes('src: chain.src, alt: "", onClick: onClose, referrerPolicy: "no-referrer", decoding: "async", onError: chain.onError, onLoad: chain.onLoad'), 'img 既有属性锚保持（点图即关/走链；chrome.jsx）')
  })
  it('useImgChain 暴露 settled（灯箱转圈/淡入的数据源；chrome.jsx）', () => {
    assert.ok(chromeSrc.includes('return { src, failed, retry, onError, onLoad, settled };'), 'hook 返回 settled')
  })
  it('prefers-reduced-motion：淡入停用、转圈降速', () => {
    assert.ok(stylesSrc.includes('@media (prefers-reduced-motion:reduce){.dsvm-lbspin{animation-duration:1.6s}.dsvm-lightbox .dsvm-lbimg{transition:none}}'), 'reduced-motion 块在')
  })
})

describe('灯箱 0.9.65 邻图预取 + 触屏滑动 + 焦点圈闭', () => {
  it('lbNeighbors：左右邻去重保序，length<=1 空表（单图无邻可预取）', () => {
    assert.deepEqual(lbNeighbors(0, 3), [1, 2])
    assert.deepEqual(lbNeighbors(1, 3), [2, 0])
    assert.deepEqual(lbNeighbors(2, 3), [0, 1])
    assert.deepEqual(lbNeighbors(0, 2), [1], '双图左右邻同一张 → 去重成一项')
    assert.deepEqual(lbNeighbors(0, 1), [])
    assert.deepEqual(lbNeighbors(0, 0), [])
    assert.deepEqual(lbNeighbors(NaN, 3), [])
    assert.deepEqual(lbNeighbors(0, NaN), [])
  })
  it('swipeDir：横滑达阈值且 |dx|≥2|dy| 才判向；竖/斜/短滑归零', () => {
    assert.equal(swipeDir(60, 10), 1, '手指右拖 → +1（纯函数只报手指方向，翻页映射在调用点取反）')
    assert.equal(swipeDir(-60, -10), -1, '手指左拖 → -1')
    assert.equal(swipeDir(47, 0), 0, '未达 48px 阈值')
    assert.equal(swipeDir(60, 40), 0, '斜滑 |dx| < 2|dy| 不判向')
    assert.equal(swipeDir(0, 200), 0, '纯竖滑不判向（纵向手势留原生）')
    assert.equal(swipeDir(NaN, 0), 0, '非有限输入归零')
    assert.equal(swipeDir(60, 10, { threshold: 100 }), 0, '阈值可调')
    assert.equal(swipeDir(60, 31, { ratio: 3 }), 0, '方向比可调')
  })
  it('邻图预取：settled 后以同形 weservUrl(w=1600) 预热左右邻，URL 去重不重复发起（chrome.jsx）', () => {
    assert.ok(chromeSrc.includes('if (!chain.settled || chain.failed) return;'), '仅当前图 settled 后预热（走链期间不抢带宽）')
    assert.ok(chromeSrc.includes('lbNeighbors(index, shots.length)'), '邻图取数走 lbNeighbors')
    assert.ok(chromeSrc.includes('img.src = weservUrl(url, { w: 1600 })'), '预取 URL 与 useImgChain 灯箱请求逐字节同形（翻页命中缓存）')
    assert.ok(chromeSrc.includes('prefetchedRef.current.has(url)'), 'URL 去重（来回翻页不重复发起）')
    assert.ok(chromeSrc.includes('if (prefetchedRef.current === null) prefetchedRef.current = new Set();'), 'Set 随挂载期生命周期')
  })
  it('触屏滑动：pointer 只认 touch，判向走 swipeDir，滑动后吞合成 click（chrome.jsx）', () => {
    assert.ok(chromeSrc.includes('if (e.pointerType !== "touch") return;'), 'pointerdown/up 只认 touch（鼠标保持原生拖拽/点击语义）')
    assert.ok(chromeSrc.includes('swipeDir(e.clientX - swipeRef.current.x, e.clientY - swipeRef.current.y)'), '位移交给 swipeDir 判向')
    assert.ok(chromeSrc.includes('onNav(lbStep(index, -dir, shots.length))'), '滑动翻页走 lbStep 且取反映射（内容拖拽隐喻：手指左拖＝下一张；0.9.66 实机反馈修正）')
    assert.ok(chromeSrc.includes('if (Date.now() - swipedAtRef.current < 500) e.stopPropagation();'), '滑动后 500ms 内 capture 吞合成 click（防落在 ✕/遮罩上误触发其点击语义）')
  })
  it('焦点圈闭：Tab 仅灯箱开着时拦截，回绕 + 逃逸拉回（DetailModal 键盘 effect 迁 detail-modal.jsx——ADR-0023 T11）', () => {
    assert.ok(detailModalSrc.includes('if (e.key === "Tab" && lb !== null) {'), 'Tab 分支仅灯箱开着时生效（DetailModal 自身 U8 债不变）')
    assert.ok(detailModalSrc.includes('document.querySelector(".dsvm-lightbox")'), '圈闭范围限灯箱根（portal 挂 body 后 Tab 本会走到背景）')
    assert.ok(detailModalSrc.includes('box.querySelectorAll("button, a[href]")'), '可聚焦集=按钮+链接（✕/‹›/失败态重试+打开原图）')
    assert.ok(detailModalSrc.includes('el.offsetWidth > 0 && el.offsetHeight > 0'), '可见性过滤')
    assert.ok(detailModalSrc.includes('!box.contains(active)'), '焦点逃出灯箱（如点遮罩落 body）时拉回首/尾')
    assert.ok(detailModalSrc.includes('(e.shiftKey ? last : first).focus();'), 'Shift+Tab 反向回绕')
  })
  it('touch-action：横滑交给灯箱，纵向原生与 pinch 缩放可达性保留', () => {
    assert.ok(stylesSrc.includes('justify-content:center;touch-action:pan-y pinch-zoom}'), 'touch-action 在遮罩规则上（styles.js）')
  })
})
