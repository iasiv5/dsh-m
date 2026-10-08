// 灯箱 v2（0.9.60）真浏览器验证脚本——手动运行，不进 npm test（需 playwright-core + 可用的 Chromium）。
// 动机（评审 R5）：CI 的 node:test/renderToString 测不了真 DOM 行为，而 CHANGELOG 引用的验证必须可复现；
// 首轮 16 断言只测几何不测计算样式，恰好漏过 .dsvm-btn 级联反杀（评审 R1）——本脚本把该盲区补上。
// 用法：node scripts/verify-lightbox.mjs [--out DIR]（默认 node_modules/.dshm/lightbox-probe，已 gitignore）
// 方法：esbuild 打包 main.jsx + 测试导出入口（必须放 src/client/ 才能解析相对 require，用后即删），
// 内嵌 react/react-dom UMD 于页面，__Apply 注入真实样式表，复刻 .dshm-overlay > .dshm-panel 真实语境
// （backdrop-filter + overflow:hidden 包含块），http 源让 localStorage 可用（等价真实宿主）。
// 覆盖：包含块实证 / portal 挂 body / 全视口覆盖 / 控件常驻 / 导航与键盘 / 点图与 Esc 关闭 /
// 计算样式（R1 级联）/ Windows 拖拽带避让（R2）/ 焦点还原（R3）/ 全屏回归 / 矮窗口。
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require2 = createRequire(join(root, 'package.json'))
const esbuild = require2('esbuild')
const { chromium } = require2('playwright-core')

const argv = process.argv.slice(2)
const outArg = argv.indexOf('--out')
const OUT = join(root, outArg >= 0 ? argv[outArg + 1] : 'node_modules/.dshm/lightbox-probe')
mkdirSync(OUT, { recursive: true })

// 1) 打包 main.jsx + 测试导出（与 client-render-smoke 同法）
const entry = join(root, 'src/client/.verify-lightbox-entry.jsx')
writeFileSync(entry, readFileSync(join(root, 'src/client/main.jsx'), 'utf8') + '\nmodule.exports = { __DetailModal: DetailModal, __Lightbox: Lightbox, __Apply: apply };\n')
let bundle
try {
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: 'browser', format: 'cjs',
    outfile: join(OUT, 'bundle.cjs'), external: ['react', 'react-dom'],
    loader: { '.jsx': 'jsx' }, logLevel: 'silent',
  })
  bundle = readFileSync(join(OUT, 'bundle.cjs'), 'utf8')
} finally {
  try { rmSync(entry, { force: true }) } catch { /* 清理失败不阻塞 */ }
}
const reactUmd = readFileSync(join(root, 'node_modules/react/umd/react.development.js'), 'utf8')
const reactDomUmd = readFileSync(join(root, 'node_modules/react-dom/umd/react-dom.development.js'), 'utf8')

// 2) 组装页面：真实 CSS 由 __Apply→ensureCss 注入；面板树复刻 .dshm-overlay > .dshm-panel
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="dshm-overlay" id="ov"><div class="dshm-panel" id="panel"><div id="modalhost" style="flex:1;min-height:0"></div></div></div>
<script>${reactUmd}<\/script>
<script>${reactDomUmd}<\/script>
<script>
window.__req = (n) => (n === 'react' ? window.React : n === 'react-dom' ? window.ReactDOM : null);
window.__dshm = (function (module, exports, require) {
${bundle}
  return module.exports;
})({ exports: {} }, {}, window.__req);
window.__dshm.__Apply({ effect: (fn) => fn(), inject: () => {}, slots: { inject: () => {}, register: () => {} } });
window.__boot = function (shots) {
  const it = { id: 'o1--demo', name: 'demo', description: 'demo desc', category: 'tools', source: 'npm', npm: 'demo', community: true, screenshots: shots };
  const root = window.ReactDOM.createRoot(document.getElementById('modalhost'));
  root.render(window.React.createElement(window.__dshm.__DetailModal, {
    it, labels: {}, busy: false, onClose: () => {}, onInstall: () => {}, onUpgrade: () => {}, upgradeBusy: false, profileKind: 'web',
  }));
};
<\/script></body></html>`

// 3) 断言
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }
const box = (loc) => loc.boundingBox()
const inViewport = (b, vw, vh, pad = 1) => b && b.x >= -pad && b.y >= -pad && b.x + b.width <= vw + pad && b.y + b.height <= vh + pad

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 1055, height: 764 } })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  const SVG = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="${c}"/><text x="60" y="120" font-size="72" fill="#fff" font-family="monospace">SHOT</text></svg>`
  await page.route('https://github.com/fake/**', (route) => {
    const url = route.request().url()
    const color = url.endsWith('1.png') ? '#334155' : url.endsWith('2.png') ? '#7c3aed' : '#0e7490'
    route.fulfill({ contentType: 'image/svg+xml', body: SVG(color) })
  })
  // http 源（localStorage 可用，等价真实宿主）；setContent 的 opaque origin 会禁 localStorage
  const http = await import('node:http')
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html) })
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' })
    await page.evaluate((shots) => window.__boot(shots), ['https://github.com/fake/shot1.png', 'https://github.com/fake/shot2.png', 'https://github.com/fake/shot3.png'])
    await page.locator('.dsvm-shotbox').first().waitFor({ state: 'visible', timeout: 15000 })

    const VW = 1055, VH = 764
    const open = async () => { await page.locator('.dsvm-shotbox').first().click(); await page.locator('.dsvm-lightbox').waitFor({ state: 'visible', timeout: 5000 }) }

    // A0 语境自证：面板内 fixed inset:0 探针的盒=面板盒（backdrop-filter 包含块真实存在，即旧版灯箱被夹原理）
    const [pb, probe] = await page.evaluate(() => {
      const d = document.createElement('div')
      d.style.cssText = 'position:fixed;inset:0'
      document.getElementById('panel').appendChild(d)
      const r = d.getBoundingClientRect(), p = document.getElementById('panel').getBoundingClientRect()
      d.remove()
      return [[p.x, p.y, p.width, p.height], [r.x, r.y, r.width, r.height]]
    })
    ok('A0 复刻语境成立：面板内 fixed 盒 ≡ 面板盒（包含块生效）',
      Math.abs(probe[0] - pb[0]) <= 3 && Math.abs(probe[2] - pb[2]) <= 3 && pb[2] < VW - 50,
      `panel=${pb.map((n) => Math.round(n)).join('x')} probe=${probe.map((n) => Math.round(n)).join('x')}（≠视口 ${VW}x${VH}）`)

    // A1/A2 portal 逃逸：挂 body、盒=全视口（旧版=面板盒）
    await open()
    ok('A1 灯箱 createPortal 挂 body（逃出面板包含块）',
      await page.evaluate(() => document.querySelector('.dsvm-lightbox').parentElement === document.body))
    const lb = await box(page.locator('.dsvm-lightbox'))
    ok('A2 窗口态灯箱覆盖全视口（非面板盒）', Math.abs(lb.x) <= 2 && Math.abs(lb.y) <= 2 && Math.abs(lb.width - VW) <= 3 && Math.abs(lb.height - VH) <= 3, `${Math.round(lb.width)}x${Math.round(lb.height)}`)

    // A3 控件全部在视口内可见
    for (const [name, sel] of [['✕ 关闭钮', '.dsvm-lbclose'], ['‹ 箭头', '.dsvm-lbarrow.prev'], ['› 箭头', '.dsvm-lbarrow.next'], ['底部计数/圆点 pill', '.dsvm-lbbar']]) {
      const b = await box(page.locator(sel))
      ok(`A3 ${name} 在视口内`, inViewport(b, VW, VH), b ? `y=${Math.round(b.y)} h=${Math.round(b.height)}` : 'missing')
    }
    ok('A4 计数 1 / 3', (await page.locator('.dsvm-lbcount').innerText()) === '1 / 3')

    // A13 计算样式（评审 R1 回归门）：复合选择器必须真的赢过源顺序靠后的 .dsvm-btn 基础规则
    const styles = await page.evaluate(() => {
      const gs = (el) => { const s = getComputedStyle(el); return { fs: s.fontSize, pad: s.padding, br: s.borderRadius } }
      return { arrow: gs(document.querySelector('.dsvm-lbarrow.next')), close: gs(document.querySelector('.dsvm-lbclose')) }
    })
    ok('A5 级联正确（评审 R1）：‹› 字形 26px/padding 0/radius 10，✕ padding 0/radius 10',
      styles.arrow.fs === '26px' && styles.arrow.pad === '0px' && styles.arrow.br === '10px' && styles.close.pad === '0px' && styles.close.br === '10px',
      JSON.stringify(styles))

    // A6-A8 导航：› 到 2，圆点到 3，‹ 步进
    await page.locator('.dsvm-lbarrow.next').click()
    ok('A6 › 导航 2 / 3', (await page.locator('.dsvm-lbcount').innerText()) === '2 / 3')
    await page.locator('.dsvm-lbdot').nth(2).click()
    ok('A7 圆点直达 3 / 3', (await page.locator('.dsvm-lbcount').innerText()) === '3 / 3')
    await page.locator('.dsvm-lbarrow.prev').click()
    ok('A8 ‹ 步进 2 / 3', (await page.locator('.dsvm-lbcount').innerText()) === '2 / 3')
    await page.screenshot({ path: join(OUT, '01-windowed-lightbox.png') })

    // A9/A10 键盘：←→ 与 Esc（文档级监听在 portal 下仍生效）
    await page.keyboard.press('ArrowRight')
    ok('A9 → 键盘 3 / 3', (await page.locator('.dsvm-lbcount').innerText()) === '3 / 3')
    await page.keyboard.press('Escape')
    ok('A10 Esc 关灯箱', (await page.locator('.dsvm-lightbox').count()) === 0)

    // A11 点图即关（旧版点图 stopPropagation 无动作）
    await open()
    await page.locator('.dsvm-lightbox img').click()
    ok('A11 点图即关', (await page.locator('.dsvm-lightbox').count()) === 0)

    // A12 焦点还原（评审 R3）：关闭后焦点回到触发的截图缩略图（键盘用户不丢位置）
    await open()
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.activeElement && String(document.activeElement.className).includes('dsvm-shotbox'), null, { timeout: 2000 }).catch(() => {})
    const activeCls = await page.evaluate(() => String((document.activeElement || {}).className || ''))
    ok('A12 关闭后焦点还原到截图缩略图', activeCls.includes('dsvm-shotbox'), `activeElement=.${activeCls}`)

    // A13 Windows 拖拽带避让（评审 R2）：--dsh-windows-titlebar-height:40px 时灯箱顶让带、✕ 在带下
    await page.evaluate(() => document.documentElement.style.setProperty('--dsh-windows-titlebar-height', '40px'))
    await open()
    const lbBand = await box(page.locator('.dsvm-lightbox'))
    const closeBand = await box(page.locator('.dsvm-lbclose'))
    ok('A13 拖拽带避让：灯箱 top=40px、✕ 落带外', Math.abs(lbBand.y - 40) <= 2 && closeBand.y >= 40, `lb.y=${Math.round(lbBand.y)} close.y=${Math.round(closeBand.y)}`)
    await page.screenshot({ path: join(OUT, '02-titlebar-band.png') })
    await page.keyboard.press('Escape')
    await page.evaluate(() => document.documentElement.style.removeProperty('--dsh-windows-titlebar-height'))

    // A14 全屏态回归：面板铺满视口后依旧正常
    await page.evaluate(() => { document.getElementById('ov').classList.add('full'); document.getElementById('panel').classList.add('full') })
    await open()
    const lb2 = await box(page.locator('.dsvm-lightbox'))
    ok('A14 全屏态灯箱=全视口、控件在位', Math.abs(lb2.width - VW) <= 3 && inViewport(await box(page.locator('.dsvm-lbbar')), VW, VH))
    await page.screenshot({ path: join(OUT, '03-fullscreen-lightbox.png') })
    await page.keyboard.press('Escape')

    // A15 矮窗口（500px）：面板更小，灯箱控件仍常驻（旧版此处必裁）
    await page.setViewportSize({ width: 1055, height: 500 })
    await open()
    ok('A15 矮窗口控件可见', inViewport(await box(page.locator('.dsvm-lbbar')), 1055, 500) && inViewport(await box(page.locator('.dsvm-lbclose')), 1055, 500))
    await page.screenshot({ path: join(OUT, '04-short-window-lightbox.png') })
  } finally {
    server.close()
  }
} finally {
  await browser.close()
}
const fails = results.filter((r) => !r.pass)
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1))
console.log(`\n${results.length - fails.length}/${results.length} passed${fails.length ? ' — FAILURES: ' + fails.map((f) => f.name).join('; ') : ''}\n输出目录：${OUT}`)
process.exit(fails.length ? 1 : 0)
