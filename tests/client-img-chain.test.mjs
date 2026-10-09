/**
 * 0.9.61 图片加载链纯逻辑单测（grilling Q12 / 实施计划 Task 1）。
 * 覆盖：weservUrl 三参数形态（逐字参数串）、scheme 剥离与编码、桶分类、
 * tier 机（回绕/终态/超时资格）、赢家记忆（初始/覆盖/结构性不降级/reset）。
 * 运行：npm test 自动发现（node --test）。
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WESERV_BASE,
  WESERV_TIMEOUT_MS,
  weservUrl,
  serviceBucketOf,
  tierOrder,
  nextTier,
  needsTimeout,
  preferredTier,
  rememberSuccess,
  resetTierPreferences,
} from '../src/client/img-chain.js'

const here = dirname(fileURLToPath(import.meta.url))
const mainSrc = readFileSync(join(here, '../src/client/main.jsx'), 'utf8')

const RAW_URL = 'https://raw.githubusercontent.com/elysia395/dsh-wallpaper-engine/HEAD/docs/images/main-interface.gif'

describe('weservUrl（0.9.61：代理层 URL 构造，dsh-market thumbUrl 同款形态 + webp 转码）', () => {
  it('缩略图 h=300：参数串逐字 fit=inside&we=1&output=webp&q=80，scheme 剥离 + encodeURIComponent', () => {
    assert.equal(
      weservUrl(RAW_URL, { h: 300 }),
      `${WESERV_BASE}url=${encodeURIComponent('raw.githubusercontent.com/elysia395/dsh-wallpaper-engine/HEAD/docs/images/main-interface.gif')}&h=300&fit=inside&we=1&output=webp&q=80`,
    )
  })
  it('灯箱 w=1600', () => {
    assert.equal(
      weservUrl(RAW_URL, { w: 1600 }),
      `${WESERV_BASE}url=${encodeURIComponent(RAW_URL.replace(/^https?:\/\//, ''))}&w=1600&fit=inside&we=1&output=webp&q=80`,
    )
  })
  it('图标 h=96（github.com 头像带 query 也不受影响）', () => {
    const u = weservUrl('https://github.com/elysia395.png?size=64', { h: 96 })
    assert.ok(u.startsWith(`${WESERV_BASE}url=`), 'base 前缀')
    assert.ok(u.endsWith('&h=96&fit=inside&we=1&output=webp&q=80'), '尺寸与参数串在尾')
    assert.ok(u.includes(encodeURIComponent('github.com/elysia395.png?size=64')), 'query 随 URL 整体编码')
  })
  it('http scheme 同样剥离；w 与 h 同给时 w 优先（契约：调用方只给一个）', () => {
    assert.ok(weservUrl('http://example.com/a.png', { h: 300 }).includes('url=example.com%2Fa.png'))
    assert.ok(weservUrl(RAW_URL, { w: 1600, h: 300 }).includes('&w=1600&'), 'w 优先')
  })
})

describe('serviceBucketOf（Q8/Q17：两桶制，未知宿主归 raw）', () => {
  it('github.com → avatar；githubusercontent 系与任意其它域 → raw', () => {
    assert.equal(serviceBucketOf('https://github.com/elysia395.png?size=64'), 'avatar')
    assert.equal(serviceBucketOf('https://raw.githubusercontent.com/a/b/HEAD/c.png'), 'raw')
    assert.equal(serviceBucketOf('https://user-images.githubusercontent.com/x/1.png'), 'raw')
    assert.equal(serviceBucketOf('https://private-user-images.githubusercontent.com/x/2.jpg'), 'raw')
    assert.equal(serviceBucketOf('https://cdn.example.com/icon.png'), 'raw', '未知宿主归 raw')
    assert.equal(serviceBucketOf('not a url'), 'raw', '不可解析输入归 raw（防御）')
  })
})

describe('tier 机（Q7：8s 仅 weserv 层；Q3：对称双兜底）', () => {
  it('tierOrder：偏好置顶，另一层殿后；非法偏好回落 weserv 优先', () => {
    assert.deepEqual(tierOrder('weserv'), ['weserv', 'direct'])
    assert.deepEqual(tierOrder('direct'), ['direct', 'weserv'])
    assert.deepEqual(tierOrder('bogus'), ['weserv', 'direct'])
  })
  it('nextTier：序感知前进，两序一致的部分 + 直连优先序的兜底（0.9.61 执行期修正）', () => {
    // 默认序 [weserv, direct]：固定阶梯行为保持
    assert.equal(nextTier('weserv'), 'direct')
    assert.equal(nextTier('direct'), 'failed')
    assert.equal(nextTier('failed'), 'failed', '终态幂等')
    assert.equal(nextTier('bogus'), 'failed')
    // 直连优先序 [direct, weserv]：direct 败换 weserv（对称双兜底 Q3——跳过兜底直判死是错的）
    assert.equal(nextTier('direct', 'direct'), 'weserv', '记忆翻转为 direct 后，direct 败仍要试 weserv')
    assert.equal(nextTier('weserv', 'direct'), 'failed')
    // 非法 preferred 回落默认序
    assert.equal(nextTier('direct', 'bogus'), 'failed')
  })
  it('needsTimeout：仅 weserv 层有资格计 8s（direct 层零人工超时，防误杀慢速合法下载）', () => {
    assert.equal(needsTimeout('weserv'), true)
    assert.equal(needsTimeout('direct'), false)
    assert.equal(needsTimeout('failed'), false)
  })
  it('WESERV_TIMEOUT_MS = 8000（Q7 拍板值）', () => {
    assert.equal(WESERV_TIMEOUT_MS, 8000)
  })
})

describe('赢家记忆（Q8：页面生命周期、最近成功层、成功才晋升、两桶独立）', () => {
  beforeEach(() => resetTierPreferences())
  it('初始：两桶均 weserv（Q18）', () => {
    assert.equal(preferredTier('raw'), 'weserv')
    assert.equal(preferredTier('avatar'), 'weserv')
  })
  it('rememberSuccess 覆盖本桶，不动另一桶', () => {
    rememberSuccess('raw', 'direct')
    assert.equal(preferredTier('raw'), 'direct')
    assert.equal(preferredTier('avatar'), 'weserv', 'avatar 桶不受 raw 桶影响')
    rememberSuccess('avatar', 'weserv')
    assert.equal(preferredTier('raw'), 'direct')
  })
  it('结构上无失败 API：tier0 失败只能经「tier1 成功」翻转（无 rememberFailure 可调）', async () => {
    // 该语义由模块导出面结构性保证：不存在 rememberFailure/demote 类导出。
    // 此用例钉住导出面：任何新增降级 API 都应先改计划/共识。
    const exports = Object.keys(await import('../src/client/img-chain.js'))
    assert.ok(!exports.some((k) => /fail|demote|punish/i.test(k)), `不得存在失败降级 API：${exports.join(',')}`)
  })
  it('resetTierPreferences 复原两桶', () => {
    rememberSuccess('raw', 'direct')
    rememberSuccess('avatar', 'direct')
    resetTierPreferences()
    assert.equal(preferredTier('raw'), 'weserv')
    assert.equal(preferredTier('avatar'), 'weserv')
  })
  it('非法桶名按 raw 处理（防御，不抛）', () => {
    assert.equal(preferredTier('bogus'), 'weserv')
    rememberSuccess('bogus', 'direct')
    assert.equal(preferredTier('raw'), 'direct', 'bogus 桶落在 raw')
    assert.equal(preferredTier('avatar'), 'weserv')
  })
})

describe('main.jsx 计时门控源锚（评审 R1-1/R1-4：settled 解除 + active/空 url 守卫）', () => {
  it('8s 守卫四条件齐备（url/active/settled/needsTimeout），依赖数组含 settled；onLoad 置 settled', () => {
    assert.ok(mainSrc.includes('if (!url || !active || settled || !needsTimeout(tier)) return;'), '守卫四条件')
    assert.ok(mainSrc.includes('[url, active, settled, tier]'), 'timer effect 依赖数组')
    assert.ok(/onLoad = useCallback\(\(\) => \{\s*setSettled\(true\);\s*rememberSuccess\(bucket, tier\);/.test(mainSrc), 'onLoad 先置 settled 再记成功')
    assert.ok(/setSettled\(false\);[\s\S]{0,80}setTier\(tierOrder\(startPrefRef\.current\)\[0\]\)/.test(mainSrc), 'startChain 重置 settled 与 tier')
  })
  it('url 变化走渲染期 derived-state 重置（评审 R1-5：无中间帧）', () => {
    assert.ok(/const \[prevUrl, setPrevUrl\] = useState\(url\);[\s\S]{0,200}if \(prevUrl !== url\) \{/.test(mainSrc), 'prevUrl 渲染期比较')
  })
})

describe('main.jsx 接线源锚（实施计划 Task 3：Shot + 截图条四处基准 + 稳定 key）', () => {
  it('Shot 走链：h=300 + active:show（IO 门控计时），img 用 chain.src 且保留既有属性', () => {
    assert.ok(mainSrc.includes('useImgChain(src, { h: 300, active: show })'), 'Shot 内 useImgChain(src, { h: 300, active: show })')
    const shotSeg = mainSrc.slice(mainSrc.indexOf('function Shot('), mainSrc.indexOf('function Lightbox('))
    assert.ok(shotSeg.includes('src: chain.src'), 'img src 用 chain.src')
    assert.ok(shotSeg.includes('decoding: "async"'), 'decoding=async')
    assert.ok(shotSeg.includes('loading: "lazy"') && shotSeg.includes('fetchPriority: "low"') && shotSrcKeepsReferrer(shotSeg), 'lazy/low/referrerPolicy 保留')
    function shotSrcKeepsReferrer(seg) { return seg.includes('referrerPolicy: "no-referrer"') }
  })
  it('onBroken 在 effect 中上报（渲染体内不得直调父 setState），失败渲染 null', () => {
    const shotSeg = mainSrc.slice(mainSrc.indexOf('function Shot('), mainSrc.indexOf('function Lightbox('))
    assert.ok(/useEffect\(\(\) => \{[\s\S]{0,120}onBroken\(src\)/.test(shotSeg), 'onBroken 经 useEffect 调用')
    assert.ok(shotSeg.includes('chain.failed ? null'), '失败渲 null')
  })
  it('DetailModal：visible 过滤 + 去重合并 broken + 四处 shots→visible 基准 + 稳定 key + 钳制', () => {
    const modalSeg = mainSrc.slice(mainSrc.indexOf('function DetailModal('), mainSrc.indexOf('// ---------- 市场页'))
    assert.ok(modalSeg.includes('visible'), 'visible 派生在')
    assert.ok(/prev\.includes\(src\) \? prev : prev\.concat\(src\)/.test(modalSeg) || /prev\.includes\(/.test(modalSeg), 'broken 去重合并')
    assert.ok(/shots\.filter\(\(src\) => !broken/.test(modalSeg) || /filter\(\(src\) => !brokenShots\.includes/.test(modalSeg), 'visible 过滤式')
    // 四处基准：整条门控、灯箱门控、键盘 lbStep、effect 依赖
    assert.ok(/visible\.length\s*\?\s*h\(\s*"div",\s*\{ className: "dsvm-shotrow" \}/.test(modalSeg), '① 整条门控 visible.length')
    assert.ok(modalSeg.includes('lb !== null && visible.length'), '③ 灯箱门控 visible.length')
    assert.ok(modalSeg.includes('lbStep(i, -1, visible.length)') && modalSeg.includes('lbStep(i, 1, visible.length)'), '④ 键盘 lbStep 长度基准 visible.length')
    assert.ok(/\[lb, visible\.length, onClose\]/.test(modalSeg), '键盘 effect 依赖随动')
    // 稳定 key：全量 map + ${i}:${src}
    assert.ok(modalSeg.includes('shots.map((src, i) => h(Shot, { key: `${i}:${src}`'), '② 全量 map + 稳定 key')
    // 钳制 + 活引用（本仓库 h() 调用形态：shots: visible）
    assert.ok(modalSeg.includes('shots: visible'), '灯箱收 visible 活引用')
    assert.ok(modalSeg.includes('Math.min(lb, visible.length - 1)'), 'index 钳制')
  })
  it('Lightbox 走链（w=1600）+ 双败占位三件（重试/打开原图）+ i18n 三键', () => {
    const lbSeg = mainSrc.slice(mainSrc.indexOf('function Lightbox('), mainSrc.indexOf('function DetailModal('))
    assert.ok(lbSeg.includes('useImgChain(shots[index], { w: 1600 })'), '灯箱 w=1600 走链')
    assert.ok(lbSeg.includes('className: "dsvm-lbfail"'), '占位容器 dsvm-lbfail')
    assert.ok(lbSeg.includes('chain.retry'), '重试接 chain.retry')
    assert.ok(/h\(ExtLink, \{ href: shots\[index\] \}/.test(lbSeg), '打开原图 ExtLink href=原 URL')
    assert.ok(lbSeg.includes('lookup("lb.fail")') && lbSeg.includes('lookup("lb.retry")') && lbSeg.includes('lookup("lb.open")'), '三 i18n 键接线')
    assert.ok(mainSrc.includes('"lb.fail": "图片加载失败"') && mainSrc.includes('"lb.retry": "重试"') && mainSrc.includes('"lb.open": "打开原图"'), 'ZH 三键')
    assert.ok(/"lb\.fail": "Failed to load image"/.test(mainSrc) && mainSrc.includes('"lb.retry": "Retry"') && mainSrc.includes('"lb.open": "Open original"'), 'EN 三键')
    assert.ok(mainSrc.includes('.dsvm-lbfail{'), '占位 CSS 在')
  })
})
