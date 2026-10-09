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
writeFileSync(entry, readFileSync(join(root, 'src/client/main.jsx'), 'utf8') + '\nmodule.exports = { __DetailModal: DetailModal, __Lightbox: Lightbox, __Apply: apply, __UseImgChainProbe: UseImgChainProbe };\n')
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
window.__epoch = Math.random();
window.__req = (n) => (n === 'react' ? window.React : n === 'react-dom' ? window.ReactDOM : null);
window.__dshm = (function (module, exports, require) {
${bundle}
  return module.exports;
})({ exports: {} }, {}, window.__req);
window.__dshm.__Apply({ effect: (fn) => fn(), inject: () => {}, slots: { inject: () => {}, register: () => {} } });
window.__mountProbe = null;
window.__boot = function (shots) {
  const it = { id: 'o1--demo', name: 'demo', description: 'demo desc', category: 'tools', source: 'npm', npm: 'demo', community: true, github: 'elysia395/dsh-wallpaper-engine', screenshots: shots };
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
  let page = await browser.newPage({ viewport: { width: 1055, height: 764 } })
  const reqLog = []
  const wirePage = (p) => {
    p.on('pageerror', (e) => console.log('PAGEERROR', e.message))
    p.on('request', (r) => { const u = r.url(); if (u.includes('images.weserv.nl') || u.includes('github.com')) reqLog.push(u) })
  }
  wirePage(page)
  // 0.9.61 执行期教训：勿对本 page 外挂 CDP session（如 Network.setCacheDisabled）——Playwright 拦截
  // 自身走 CDP，外部 session 在若干次 reload 后会互相踩踏，路由静默失效、请求真网泄漏（canary 实证）。
  // 确定性由「代次 URL（全局唯一）+ fulfill 带 no-store」承担，无需 CDP。
  const SVG = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="${c}"/><text x="60" y="120" font-size="72" fill="#fff" font-family="monospace">SHOT</text></svg>`
  await page.route('https://github.com/fake/**', (route) => {
    const url = route.request().url()
    const color = url.endsWith('1.png') ? '#334155' : url.endsWith('2.png') ? '#7c3aed' : '#0e7490'
    route.fulfill({ contentType: 'image/svg+xml', body: SVG(color), headers: { 'cache-control': 'no-store' } })
  })
  // 0.9.61 图片加载链 harness：三域 route（域名为指称，pattern 须匹配完整 URL——Playwright glob 全 URL 锚定）
  const WESERV_PAT = '**images.weserv.nl**'
  const FAKE_PAT = 'https://github.com/fake/**'
  const AVATAR_PAT = '**/elysia395.png*'
  // 代次化 URL（0.9.61 执行期·确定性根基）：已解码位图按 URL 复用且不受 CDP 禁缓存管辖——
  // 凡在本页生命周期内成功过的 URL，后续失败场景不再发请求（无 error → 链不走）。
  // 故每个 freshState 生成全新代次 URL（?g=N），失败场景的 URL 保证全局唯一。
  let gen = 0
  const shotsOf = (g) => [1, 2, 3].map((i) => `https://github.com/fake/shot${i}.png?g=${g}`)
  const SHOTS = shotsOf(0)

  const directHits = []
  const mountDirect = async (mode) => {
    await page.unroute(FAKE_PAT).catch(() => {})
    await page.unroute(AVATAR_PAT).catch(() => {})
    if (mode === 'abort') {
      await page.route(FAKE_PAT, (r) => { directHits.push(`abort:${r.request().url().slice(0, 50)}`); r.abort() })
      await page.route(AVATAR_PAT, (r) => { directHits.push(`abort-av:${r.request().url().slice(0, 50)}`); r.abort() })
    } else {
      await page.route(FAKE_PAT, (route) => {
        const url = route.request().url()
        const color = url.endsWith('1.png') ? '#334155' : url.endsWith('2.png') ? '#7c3aed' : '#0e7490'
        route.fulfill({ contentType: 'image/svg+xml', body: SVG(color), headers: { 'cache-control': 'no-store' } })
      })
      await page.route(AVATAR_PAT, (r) => r.fulfill({ contentType: 'image/svg+xml', body: SVG('#7c3aed'), headers: { 'cache-control': 'no-store' } }))
    }
  }
  const mountWeserv = async (mode, delayMs = 0) => {
    await page.unroute(WESERV_PAT).catch(() => {})
    if (mode === 'abort') await page.route(WESERV_PAT, (r) => { weservHits.push(`abort:${r.request().url()}`); r.abort() })
    else if (mode === 'delay') await page.route(WESERV_PAT, async (r) => { weservHits.push(`delay:${r.request().url()}`); await new Promise((t) => setTimeout(t, delayMs)); await r.fulfill({ contentType: 'image/svg+xml', body: SVG('#0e7490'), headers: { 'cache-control': 'no-store' } }).catch(() => {}) })
    else await page.route(WESERV_PAT, (r) => { weservHits.push(`fulfill:${r.request().url()}`); r.fulfill({ contentType: 'image/svg+xml', body: SVG('#0e7490'), headers: { 'cache-control': 'no-store' } }) })
  }
  const weservHits = []
  // Route 生命周期协议：凡 reload 场景开头 unrouteAll 后仅重挂本场景所需 route（评审 R2-5）
  // 0.9.61 执行期定稿：每场景全新 page（独立 context）——零路由历史（消灭 unroute/复挂竞态与
  // 「同页多轮 reload 后路由静默失效」的现场性怪病）、零共享缓存（消灭跨场景已解码位图复用）、
  // 模块态天然归零（赢家记忆重置不再依赖 reload 语义）。
  const freshState = async ({ direct = 'fulfill', weserv = 'fulfill', weservDelayMs = 0 } = {}) => {
    gen += 1
    const oldPage = page
    page = await browser.newPage({ viewport: { width: 1055, height: 764 } })
    wirePage(page)
    reqLog.length = 0
    await oldPage.close().catch(() => {})
    await mountDirect(direct)
    await mountWeserv(weserv, weservDelayMs)
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' })
    await page.evaluate((s) => window.__boot(s), shotsOf(gen))
    await page.locator('.dsvm-shotbox').first().waitFor({ state: 'visible', timeout: 15000 })
    return gen
  }
  // 初始化即挂 weserv fulfill——A0-A15 与新场景全程零真网 weserv 依赖（评审 R2-3）
  await mountWeserv('fulfill')
  // http 源（localStorage 可用，等价真实宿主）；setContent 的 opaque origin 会禁 localStorage
  const http = await import('node:http')
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html) })
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready))
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' })
    await page.evaluate((shots) => window.__boot(shots), SHOTS)
    await page.locator('.dsvm-shotbox').first().waitFor({ state: 'visible', timeout: 15000 })
    console.log('INIT-EPOCH:', await page.evaluate(() => window.__epoch))

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
    await page.keyboard.press('Escape')

    // ---------- 0.9.61 图片加载链场景（A16-A23；评审定稿：reload 场景 unrouteAll+重挂，杜绝真网泄漏） ----------
    // A16 默认双通：三类消费方均走 weserv，参数逐字正确（route 命中记录断言）
    await freshState({ direct: 'fulfill', weserv: 'fulfill' })
    await open()
    const imgSrc16 = await page.evaluate(() => { const i = document.querySelector('.dsvm-lightbox img'); return i ? i.src : '' })
    ok('A16 灯箱 tier0=weserv（w=1600 参数串逐字）', imgSrc16.startsWith('https://images.weserv.nl/?url=') && imgSrc16.includes('&w=1600&fit=inside&we=1&output=webp&q=80'), imgSrc16.slice(0, 96))
    ok('A16 缩略图经 weserv h=300', reqLog.some((u) => u.includes('images.weserv.nl') && u.includes('&h=300&')), `命中 ${reqLog.filter((u) => u.includes('&h=300&')).length} 张`)
    ok('A16 图标经 weserv h=96（avatar 桶）', reqLog.some((u) => u.includes('images.weserv.nl') && u.includes('url=github.com%2Felysia395.png%3Fsize%3D64') && u.includes('&h=96&')))
    await page.keyboard.press('Escape')

    // A17 断直连：链停在 weserv 层照常渲染（waitFor 消解码竞态——decoding=async 下 open() 可见≠已解码）
    await freshState({ direct: 'abort', weserv: 'fulfill' })
    await open()
    let a17 = false
    try { await page.waitForFunction(() => { const i = document.querySelector('.dsvm-lightbox img'); return i && i.src.includes('images.weserv.nl') && i.naturalWidth > 0 }, null, { timeout: 10000 }); a17 = true } catch { a17 = false }
    ok('A17 断直连：图经 weserv 层渲染（naturalWidth>0）', a17)
    await page.keyboard.press('Escape')

    // A18 断 weserv：img src 翻转直连并渲染（缩略图同经直连成功 → 记忆翻转为 direct；
    // 同批竞态回归门：缩略图 2/3 不得因偏好翻转跳过 direct 兜底而全灭）
    await freshState({ direct: 'fulfill', weserv: 'abort' })
    let a18boxes = -1
    try { await page.waitForFunction(() => document.querySelectorAll('.dsvm-shotbox').length === 3, null, { timeout: 8000 }); a18boxes = 3 } catch { a18boxes = await page.evaluate(() => document.querySelectorAll('.dsvm-shotbox').length) }
    await open()
    let a18 = false
    try { await page.waitForFunction(() => { const i = document.querySelector('.dsvm-lightbox img'); return i && i.src.includes('github.com/fake') && i.naturalWidth > 0 }, null, { timeout: 10000 }); a18 = true } catch { a18 = false }
    ok('A18 断 weserv：src 翻转直连并渲染', a18 && a18boxes === 3, `shotbox=${a18boxes}（3=同批竞态未误灭） ${await page.evaluate(() => { const i = document.querySelector('.dsvm-lightbox img'); return i ? i.src.slice(0, 50) : 'no img' })}`)

    // A19 双断占位（weserv 先通后断设计：缩略图经 weserv 存活、灯箱 shot1 已渲染——无剔除竞速、
    // 无解码复用干扰；断 weserv 后切 shot2，其 w=1600 URL 全新 → 双兜底全程 → 占位）
    const g19 = await freshState({ direct: 'abort', weserv: 'fulfill' })
    await open()
    await mountWeserv('abort')
    await page.locator('.dsvm-lbarrow.next').click()
    let a19 = false
    try { await page.locator('.dsvm-lbfail').waitFor({ state: 'visible', timeout: 15000 }); a19 = true } catch { a19 = false }
    const failInfo = await page.evaluate(() => { const a = document.querySelector('.dsvm-lbfail a'); return { href: a ? a.href : '', hasRetry: !!document.querySelector('.dsvm-lbfail button'), msg: (document.querySelector('.dsvm-lbfailmsg') || {}).textContent || '' } })
    ok('A19 双断占位：⚠+重试+打开原图（href=原 URL）', a19 && failInfo.hasRetry && failInfo.href === `https://github.com/fake/shot2.png?g=${g19}` && failInfo.msg.includes('⚠'), JSON.stringify(failInfo))
    // A19b 对称双兜底不跳层：shot2 在 weserv 与 direct 两层的请求都实际发出（reqLog 断言——
    // page.on('request') 不依赖路由拦截，可观测绕过路由的真网请求；同页 unroute+复挂在个别现场
    // 会让 route 静默失效，但请求本身与双败行为不受影响）
    const a19bWeserv = reqLog.filter((u) => u.includes(`shot2.png%3Fg%3D${g19}`) && u.includes('w=1600')).length
    const a19bDirect = reqLog.filter((u) => u.includes(`shot2.png?g=${g19}`)).length
    ok('A19b 双层全试（weserv→direct 两层请求均发出）', a19bWeserv >= 1 && a19bDirect >= 1, `weserv=${a19bWeserv} direct=${a19bDirect}`)
    await page.screenshot({ path: join(OUT, '05-fail-placeholder.png') })

    // A20 重试：双断下点重试 → 该图请求计数增加（tier 无关）且占位重现（再败）
    const before20 = reqLog.filter((u) => u.includes(`shot2.png?g=${g19}`) || u.includes(`shot2.png%3Fg%3D${g19}`)).length
    await page.locator('.dsvm-lbfail button').click()
    let a20retry = false
    try { await page.locator('.dsvm-lbfail').waitFor({ state: 'visible', timeout: 12000 }); a20retry = true } catch { a20retry = false }
    const after20 = reqLog.filter((u) => u.includes(`shot2.png?g=${g19}`) || u.includes(`shot2.png%3Fg%3D${g19}`)).length
    ok('A20 重试再发请求并如实再败', after20 > before20 && a20retry, `${before20} → ${after20}`)

    // A21 weserv 挂起 30s：8s 守卫换层直连渲染（≤9.5s）
    await freshState({ direct: 'fulfill', weserv: 'delay', weservDelayMs: 30000 })
    const t0 = Date.now()
    await open()
    let a21 = false
    try { await page.waitForFunction(() => { const i = document.querySelector('.dsvm-lightbox img'); return i && i.src.includes('github.com/fake') && i.naturalWidth > 0 }, null, { timeout: 9500 }); a21 = true } catch { a21 = false }
    ok('A21 weserv 挂起 8s 守卫换层', a21, a21 ? `${((Date.now() - t0) / 1000).toFixed(1)}s 内翻转直连` : '9.5s 内未翻转')
    await page.keyboard.press('Escape')

    // A22 赢家记忆：weserv 断、直连成功后，新图首请求走直连（最近成功层翻转实证）
    const g22 = await freshState({ direct: 'fulfill', weserv: 'abort' })
    await open()
    await page.waitForFunction(() => { const i = document.querySelector('.dsvm-lightbox img'); return i && i.src.includes('github.com/fake') && i.naturalWidth > 0 }, null, { timeout: 10000 }).catch(() => {})
    reqLog.length = 0
    await page.locator('.dsvm-lbarrow.next').click()
    await page.waitForFunction(() => { const i = document.querySelector('.dsvm-lightbox img'); return i && i.naturalWidth > 0 }, null, { timeout: 10000 }).catch(() => {})
    // direct-first 证据改为 src 形态（直连层与缩略图同 URL 的已解码复用会让「首请求」不再发——
    // 复用本身即记忆生效的体现：src 直接落在直连层，不经过 weserv 形态）
    const src22 = await page.evaluate(() => { const i = document.querySelector('.dsvm-lightbox img'); return i ? i.src : '' })
    const a22WeservReq = reqLog.filter((u) => u.includes('weserv') && u.includes(`shot2.png%3Fg%3D${g22}`)).length
    ok('A22 赢家记忆：新图起点=直连层（src 直连形态 + 全程零 weserv 形态请求）',
      src22.startsWith('https://github.com/fake/shot2.png') && a22WeservReq === 0,
      `src=${src22.slice(0, 52)} weserv形式请求=${a22WeservReq}`)
    await page.keyboard.press('Escape')

    // A23 缩略图剔除：双断下双败上报 → shotbox 递减至 0、整条隐藏
    await freshState({ direct: 'abort', weserv: 'abort' })
    let rowGone = false
    try { await page.waitForFunction(() => document.querySelectorAll('.dsvm-shotbox').length === 0 && !document.querySelector('.dsvm-shotrow'), null, { timeout: 20000 }); rowGone = true } catch { rowGone = false }
    const boxCount23 = await page.evaluate(() => document.querySelectorAll('.dsvm-shotbox').length)
    ok('A23 双断缩略图全败剔除、整条隐藏', rowGone && boxCount23 === 0, `shotbox=${boxCount23}`)
    await page.screenshot({ path: join(OUT, '06-strip-removed.png') })

    // A24 direct-first 换层（记忆翻转后的 url 变化路径，Probe 单 root 场景——规避
    // 缩略图/灯箱 direct 同 URL 的已解码位图复用）：shot1 经直连成功（raw 桶记忆翻转为 direct）→
    // FAKE 翻 abort → url 换 shot2 → tier0=direct 败 → 按序换 weserv 败 → failed 终态
    const g24 = await freshState({ direct: 'fulfill', weserv: 'abort' })
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.id = 'probe-host';
      document.body.appendChild(host);
      let root = null;
      window.__mountProbe = (url) => {
        if (!root) root = window.ReactDOM.createRoot(host);
        root.render(window.React.createElement(window.__dshm.__UseImgChainProbe, { url, w: 1600 }));
      };
    })
    weservHits.length = 0
    directHits.length = 0
    await page.evaluate((u) => window.__mountProbe(u), `https://github.com/fake/shot1.png?g=${g24}x`)
    await page.waitForFunction(() => { const i = document.querySelector('#probe-host img'); return i && i.src.includes('github.com/fake') && i.naturalWidth > 0 }, null, { timeout: 10000 })
    await mountDirect('abort')
    await page.evaluate((u) => window.__mountProbe(u), `https://github.com/fake/shot2.png?g=${g24}x`)
    let a24 = false
    try { await page.locator('#probe-host .dsvm-probe-failed').waitFor({ state: 'visible', timeout: 12000 }); a24 = true } catch { a24 = false }
    // 层序证据走 reqLog（同 A19b：同页 unroute+复挂的 route 静默失效不影响请求本身）
    const a24Shot2Reqs = reqLog.filter((u) => u.includes(`shot2.png?g=${g24}x`) || u.includes(`shot2.png%3Fg%3D${g24}x`))
    const a24Weserv = a24Shot2Reqs.filter((u) => u.includes('weserv')).length
    const a24Direct = a24Shot2Reqs.filter((u) => !u.includes('weserv')).length
    ok('A24 direct-first 换层：首请求=direct 形态，败后按序试 weserv→failed 终态',
      a24 && a24Direct >= 1 && a24Weserv >= 1 && !a24Shot2Reqs[0].includes('weserv'),
      `failed=${a24} 首请求=${a24Shot2Reqs[0] ? (a24Shot2Reqs[0].includes('weserv') ? 'weserv' : 'direct') : '无'} direct=${a24Direct} weserv=${a24Weserv}`)
    await page.screenshot({ path: join(OUT, '07-direct-first-chain.png') })

    // A25 成功驻留（评审 R1-1 行为钉子）：weserv 成功渲染后停留 >8.5s——src 须仍为 weserv 形态、
    // 该图零 direct 形态请求（8s 守卫在 settled 后解除；失败形态=成功图被强制换层重载）
    const g25 = await freshState({ direct: 'abort', weserv: 'fulfill' })
    await open()
    const srcAt0 = await page.evaluate(() => { const i = document.querySelector('.dsvm-lightbox img'); return i ? i.src : '' })
    await page.waitForTimeout(8800)
    const stateAfter = await page.evaluate(() => { const i = document.querySelector('.dsvm-lightbox img'); return i ? { src: i.src, nw: i.naturalWidth } : null })
    const a25DirectReqs = reqLog.filter((u) => !u.includes('weserv') && u.includes(`shot1.png?g=${g25}`)).length
    ok('A25 成功驻留 >8.5s：src 不离 weserv 层、无 direct 重载请求',
      stateAfter && stateAfter.src === srcAt0 && stateAfter.src.includes('images.weserv.nl') && stateAfter.nw > 0 && a25DirectReqs === 0,
      `src=${stateAfter ? stateAfter.src.slice(0, 52) : 'no-img'} direct请求=${a25DirectReqs}`)
    await page.keyboard.press('Escape')

    // --live：A0-A23 照旧（route 伪造不变），仅追加真网压缩对比（样图不经任何 route；评审 R2-D）
    if (process.argv.includes('--live')) {
      const SAMPLE = 'https://raw.githubusercontent.com/elysia395/dsh-wallpaper-engine/HEAD/docs/images/mascot-drawer.png'
      const { weservUrl } = await import(join(root, 'src/client/img-chain.js'))
      const getBuf = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); const ct = r.headers.get('content-type') || ''; if (!ct.startsWith('image/')) throw new Error(ct || 'no content-type'); return r.arrayBuffer() }
      const [directBuf, viaBuf] = await Promise.all([
        getBuf(SAMPLE),
        getBuf(weservUrl(SAMPLE, { w: 1600 })),
      ]).catch(() => [null, null])
      if (!directBuf || !viaBuf) {
        ok('--live 压缩实证（mascot-drawer.png w=1600 webp）', false, 'fetch 失败或非 image/* 响应（错误页不得假 PASS）')
      } else {
        const dKB = Math.round(directBuf.byteLength / 1024), wKB = Math.round(viaBuf.byteLength / 1024)
        ok('--live 压缩实证（mascot-drawer.png w=1600 webp）', viaBuf.byteLength <= directBuf.byteLength, `直连 ${dKB}KB vs weserv ${wKB}KB（两侧均 image/* 且 ok）`)
      }
    }
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
