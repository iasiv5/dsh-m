/**
 * 0.7.0 审计 B1 教训落地：client 渲染冒烟（SSR renderToString）。
 * esbuild CJS 产物里的自由变量（如未解构的 useLayoutEffect）构建不报错、纯逻辑测试不覆盖、
 * 人工检查单不常跑——只有真实渲染能抓。方法：拷贝 main.jsx 源 + 追加测试导出 →
 * esbuild bundle（CJS，external react/react-dom）→ renderToString 三个视图与关键组件。
 * 运行：npm test 自动发现（node --test tests/）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import 'node:os';
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const src = readFileSync(join(root, 'src/client/main.jsx'), 'utf8')
// ADR-0023 第一刀：词典定义面锚改读 i18n.js；CSS 锚改读 styles.js（调用面锚仍读 main.jsx）
const i18nSrc = readFileSync(join(root, 'src/client/i18n.js'), 'utf8')
const stylesSrc = readFileSync(join(root, 'src/client/styles.js'), 'utf8')
// ADR-0023 T10：批次一出仓组件的接线锚改读新文件
const chromeSrc = readFileSync(join(root, 'src/client/chrome.jsx'), 'utf8')
const cardSrc = readFileSync(join(root, 'src/client/card.jsx'), 'utf8')
const zoneChipsSrc = readFileSync(join(root, 'src/client/zone-chips.jsx'), 'utf8')
const _versionChipSrc = readFileSync(join(root, 'src/client/version-chip.jsx'), 'utf8')
// ADR-0023 T11：批次二出仓组件锚改读新文件
const detailModalSrc = readFileSync(join(root, 'src/client/detail-modal.jsx'), 'utf8')
const marketTabSrc = readFileSync(join(root, 'src/client/market-tab.jsx'), 'utf8')
const _installedTabSrc = readFileSync(join(root, 'src/client/installed-tab.jsx'), 'utf8')
const settingsTabSrc = readFileSync(join(root, 'src/client/settings-tab.jsx'), 'utf8')
// 入口必须与 main.jsx 同目录（相对 require ./market-state.js 等才能解析）；构建后即删
const dir = join(root, 'src/client')
const entry = join(dir, '.render-smoke-entry.jsx')
// bundle 放进仓库 node_modules/.dshm/：external 的 react/react-dom 靠 Node 向上解析命中（/tmp 下解析不到）
const outDir = join(root, 'node_modules', '.dshm')
mkdirSync(outDir, { recursive: true })
const out = join(outDir, 'render-smoke.cjs')
let mod
try {
  // ADR-0023 T11 终态：全部出仓组件直接 require 新文件；追加导出仅剩 MarketPanel（组合根，main.jsx 保留区）
  writeFileSync(
    entry,
    src +
      '\n// ---- 测试追加导出（不进生产：build.mjs 打包的是 main.jsx 本体，此文件不入库不发布）----\n' +
      'module.exports = { __MarketPanel: MarketPanel };\n',
  )
  const compEntry = join(dir, '.render-smoke-components-entry.jsx')
  writeFileSync(
    compEntry,
    'const { SearchBox, RestartBanner, Lightbox, UseImgChainProbe } = require("./chrome.jsx");\n' +
      'const { ZoneChips } = require("./zone-chips.jsx");\n' +
      'const { FavoriteZone } = require("./favorite-zone.jsx");\n' +
      'const { DshmVersionChip } = require("./version-chip.jsx");\n' +
      'const { DetailModal } = require("./detail-modal.jsx");\n' +
      'const { InstalledTab } = require("./installed-tab.jsx");\n' +
      'const { MarketTab } = require("./market-tab.jsx");\n' +
      'const { OperationsCard } = require("./operations-card.jsx");\n' +
      'module.exports = { __SearchBox: SearchBox, __ZoneChips: ZoneChips, __FavoriteZone: FavoriteZone, __DshmVersionChip: DshmVersionChip, __RestartBanner: RestartBanner, __Lightbox: Lightbox, __UseImgChainProbe: UseImgChainProbe, __DetailModal: DetailModal, __InstalledTab: InstalledTab, __MarketTab: MarketTab, __OperationsCard: OperationsCard };\n',
  )
  const compOut = join(outDir, 'render-smoke-components.cjs')
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: out,
    external: ['react', 'react-dom'],
    loader: { '.jsx': 'jsx' },
    logLevel: 'silent',
  })
  await build({
    entryPoints: [compEntry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: compOut,
    external: ['react', 'react-dom'],
    loader: { '.jsx': 'jsx' },
    logLevel: 'silent',
  })
  const require2 = createRequire(import.meta.url)
  const React = require2(join(root, 'node_modules/react'))
  const { renderToString } = require2(join(root, 'node_modules/react-dom/server'))
  mod = { React, renderToString, mod: require2(out), comps: require2(compOut) }
} finally {
  try {
    rmSync(entry, { force: true })
    rmSync(join(dir, '.render-smoke-components-entry.jsx'), { force: true })
  } catch {
    /* 清理失败不阻塞测试 */
  }
}
const { React, renderToString } = mod
const components = { ...mod.mod, ...mod.comps }
const h = React.createElement

describe('client 渲染冒烟（SSR）——自由变量/接线炸弹回归门', () => {
  it('MarketPanel 首渲染不抛（默认社区 tab，含 ZoneChips/SearchBox/Card 树）', () => {
    const html = renderToString(h(components.__MarketPanel, { onClose: () => {} }))
    assert.ok(typeof html === 'string' && html.length > 0)
    assert.ok(html.includes('社区') || html.includes('Community'), '默认落地社区分区')
    // 0.7.2/0.7.3 复刻 dsh-market 首页：整宽搜索行 + 分类行尾「筛选」触发器（任务/刷新按钮按主人要求移除）
    assert.ok(html.includes('dsvm-searchrow'), '整宽搜索行在')
    assert.ok(html.includes('dsvm-filterwrap'), '筛选触发器在')
    assert.ok(!html.includes('dsvm-opsbtn'), '任务按钮已移除')
    assert.ok(!html.includes('申请收录'), '发现行已移除（dsh-m 不支持收录功能）')
    // 0.7.7 窗口控制组：最大化/关闭连体按钮 + 全屏态 SSR 安全降级（无 localStorage 即 false）
    assert.ok(html.includes('dshm-winctl'), '窗口控制组在')
    assert.ok(!html.includes('dshm-panel full'), 'SSR 无 localStorage 时默认非全屏')
    // 0.7.1 信息性来源横幅退役：缓存 stale 文案不得再出现
    assert.ok(!html.includes('来源为本地缓存'), '「来源为本地缓存」横幅已退役')
  })

  it('插件卡片列数按容器宽度自适应，不受固定两列或视口断点限制', () => {
    assert.match(stylesSrc, /\.dshm-cards\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,360px\),1fr\)\);gap:8px\}/, '按 360px 最小卡宽与 8px 间距自动填列，并均分剩余宽度')
    assert.doesNotMatch(stylesSrc, /@media\s*\(\s*max-width\s*:\s*680px\s*\)\s*\{\s*\.dshm-cards\s*\{[^}]*1fr/, '不再用视口断点覆盖容器实际宽度（含空白/等价写法形态）')
  })

  // 0.9.4 Windows Desktop 全屏修复（实机回归：全屏后面板头部 tab/还原键落在壳 40px
  // -webkit-app-region:drag 拖拽带内——拖拽带按布局吞点击、无视 z-index/绘制顺序；右上角
  // 还有 titleBarOverlay 系统绘制的 — □ ✕ 悬浮于一切之上。对策与壳自家 overlay 同款：
  // 消费壳在 html 上设的 --dsh-windows-titlebar-height 让出该带。该变量仅 Windows Desktop
  // 宿主存在，DSH Web/浏览器回落 0px，行为零漂移。）
  it('Windows 标题栏让位：全屏 top 与浮动态 padding-top 消费壳标题栏变量，Web 回落 0', () => {
    assert.match(stylesSrc, /\.dshm-overlay\.full\{[^}]*top:var\(--dsh-windows-titlebar-height,0px\)\}/, '全屏态顶部让位在')
    assert.match(stylesSrc, /padding:max\(24px,var\(--dsh-windows-titlebar-height,0px\)\) 16px 24px/, '浮动态 padding-top 下限在（矮窗口浮板不被拖拽带压住）')
  })

  // 0.11.6 全屏态与原生条带脱开（2026-10-30 Desktop 实拍：顶缘压线 + mask 垫灰）：呼吸位
  // +8px 且 full 态摘 overlay 暗色 mask；门控谓词与 readTitlebarInsets/titlebarTopInset
  // 同款（data-windows-titlebar 存在且 OS 非全屏），DSH Web / 浏览器无属性 → 规则不适用
  // 零漂移。第二锚钉住 0.9.4 基线让位规则原样保留（门控外的回落路径）。
  it('Windows 全屏态脱开：呼吸位 +8px 与摘 mask 门控在 titlebar 存在且 OS 非全屏', () => {
    assert.match(stylesSrc, /html\[data-windows-titlebar\]:not\(\[data-fullscreen\]\) \.dshm-overlay\.full\{top:calc\(var\(--dsh-windows-titlebar-height,0px\) \+ 8px\)\}/, '全屏态脱开规则在（+8px 呼吸位）')
    assert.match(stylesSrc, /\.dshm-overlay\.full::before\{top:0\}/, 'full 态 ::before 相对盒归 0（非门控 full 不叠让 40px）')
    assert.match(stylesSrc, /html\[data-windows-titlebar\]:not\(\[data-fullscreen\]\) \.dshm-overlay\.full::before\{display:none\}/, '门控 full 藏 ::before（不遮条带）')
    assert.match(stylesSrc, /\.dshm-overlay\.full\{padding:0;top:var\(--dsh-windows-titlebar-height,0px\)\}/, '0.9.4 基线让位规则保持原样（门控外回落路径不被改写）')
  })

  // 0.11.6 还原态对齐官方设置弹窗（Desktop 实拍：图二重灰闷暗 vs 官方设置页；官方配方取证
  // dsh-client-ui-settings-general .AnXs9G_overlay/_mask/_panel@0.2.1-rc.5）：遮罩
  // mask-3（两主题恒 48% 黑）→ mask-1（浅 24%/深 50% 随主题）+ 官方同款 --dsw-mask-blur；
  // 面板 86% 玻璃 + blur(14px) → 不透明 --dsw-alias-bg-layer-2；圆角/阴影换官方 token，
  // 旧字面值留作回落。负向锚为源级 ASCII 字面量缺席（合法形态，CRLF 安全）。
  it('还原态官方对齐：mask-1 + mask-blur 遮罩、面板不透明 layer-2、官方圆角/阴影 token', () => {
    assert.match(stylesSrc, /\.dshm-overlay::before\{content:'';position:absolute;inset:var\(--dsh-windows-titlebar-height,0px\) 0 0;background:var\(--dsw-alias-bg-mask-1,rgba\(0,0,0,\.24\)\);backdrop-filter:var\(--dsw-mask-blur,none\)\}/, '遮罩挪 ::before 且从标题栏下缘起画（官方 .AnXs9G_mask 同构，条带不两截色）')
    assert.match(stylesSrc, /\.dshm-panel\{[^}]*background:var\(--dsw-alias-bg-layer-2,var\(--dsw-alias-bg-elevated,var\(--dsw-alias-bg-base,#fff\)\)\)/, '面板不透明 layer-2 在（玻璃退役）')
    assert.doesNotMatch(stylesSrc, /color-mix\(in srgb,var\(--dsw-alias-bg-base,#fff\) 86%,transparent\)/, '86% 玻璃底字面量已从源移除')
    assert.match(stylesSrc, /\.dshm-panel\{[^}]*border-radius:var\(--dsw-radius-panel,14px\);box-shadow:var\(--dsw-elevation-prominent,0 18px 48px rgba\(2,6,23,\.25\)\)/, '官方圆角/阴影 token 在（旧字面值回落）')
  })

  it('InstalledTab 空数据渲染不抛', () => {
    const installed = {
      loading: false,
      error: null,
      data: { items: [], others: 0, profileDir: '/tmp/profile', registryState: {} },
      reload: () => {},
    }
    const html = renderToString(
      h(components.__InstalledTab, { notify: () => {}, installed, onMutation: null, ops: { records: [], runOp: async () => {} } }),
    )
    assert.ok(typeof html === 'string')
  })

  it('SearchBox / ZoneChips / FavoriteZone 独立渲染不抛', () => {
    renderToString(h(components.__SearchBox, { placeholder: 'p', initial: '', onCommit: () => {} }))
    renderToString(h(components.__ZoneChips, { zone: 'community', counts: { theme: 2 }, labels: { theme: '主题与外观' }, active: null, onPick: () => {}, trailing: null }))
    renderToString(h(components.__FavoriteZone, { favorites: { list: [], toggle: () => {}, removeIds: () => {} }, onOpen: () => {} }))
  })

  it('ZoneChips 全量渲染（0.9.53 方案A）：每颗分类 chip 均在 HTML 中（无 slice 折叠）', () => {
    const labels = { theme: '主题与外观', tools: '工具与能力', market: '用量与计费' }
    const html = renderToString(h(components.__ZoneChips, { zone: 'community', counts: { theme: 2, tools: 3, market: 4 }, labels, active: null, onPick: () => {}, trailing: null }))
    // 「全部」按钮文案走 i18n（zh=全部/en=All，随环境 locale），断言用 locale 无关的结构计数：
    // data-chip 元素 = 1「全部」+ 3 分类 = 4（方案A 全量渲染，绝不 slice）
    const chipCount = (html.match(/data-chip="1"/g) || []).length
    assert.equal(chipCount, 4, `data-chip 元素应为 4（全部+3 分类），实际 ${chipCount}`)
    for (const label of Object.values(labels)) assert.ok(html.includes(label), `缺少分类 chip：${label}`)
  })

  it('ZoneChips 精选分区可渲染且换区测量/空容器恢复有回归守卫', () => {
    const html = renderToString(h(components.__ZoneChips, {
      zone: 'primary', counts: { essentials: 5, 'cui-picks': 4, 'self-dev': 8, 'tencent-lighthouse': 3, watchlist: 3 },
      labels: null, active: null, onPick: () => {}, trailing: null,
    }))
    assert.equal((html.match(/data-chip="1"/g) || []).length, 6, '精选区=全部+固定五类')
    assert.match(zoneChipsSrc, /const chipsSignature = JSON\.stringify\(chips\.map/, '分类内容签名而非不稳定的对象引用')
    assert.match(zoneChipsSrc, /\[chipsSignature, active, expanded, zone, stuck, rowHeight, measure\]/, '布局测量不依赖自身的 geom')
    assert.match(src, /if \(existing\.querySelector\("\.dshm-panel"\)\) return;\s*existing\.remove\(\);/, '崩溃遗留空容器不得永久阻挡重新打开（挂载区，main.jsx 保留）')
    assert.match(stylesSrc, /\.dshm-chips\.dshm-chips-clip\.dshm-chips-gutter\.dshm-chips-reserve\{padding-right:calc\(var\(--dshm-clip-gutter,96px\) \+ 60px\)\}/, '社区区 +N/筛选右侧槽不被 gutter 覆盖')
    assert.match(zoneChipsSrc, /const moreLeft = geom \? geom\.lastVisRight \+ 6 : 0;/, '+N 动态紧贴末可见 chip，而非固定在筛选旁')
    assert.match(zoneChipsSrc, /const moreHeight = geom \? geom\.lastVisHeight/, '+N 框高来自最后可见分类的实测高度')
    assert.match(zoneChipsSrc, /height: `\$\{moreHeight\}px`/, '+N 显式应用与分类相同的边框高度')
  })

  it('FavoriteZone 带一条收藏快照渲染不抛（卡片路径）', () => {
    const fav = {
      id: 'o1--demo',
      savedAt: 1,
      snapshot: { id: 'o1--demo', name: 'demo', description: 'd', category: 'theme', source: 'npm', npm: 'demo-pkg', owner: 'o1', downloads: 5, stars: 2 },
    }
    const html = renderToString(h(components.__FavoriteZone, { favorites: { list: [fav], toggle: () => {}, removeIds: () => {} }, onOpen: () => {} }))
    assert.ok(html.includes('demo'))
    // 0.7.2 修复回归门：收藏卡可点击（Card role=button；onToggle→onOpen 接线为客户端事件，SSR 验语义结构）
    assert.ok(html.includes('role="button"'), '收藏卡是可点按钮语义')
  })

  // 0.9.1 头部版本角标三态（initialCheck 注入，SSR 不跑 effect 不联网）：
  // 静默口径——无更新/ahead 必须是静态 span，只有 outdated 点亮为 warn 可点按钮
  it('DshmVersionChip 静默态（无缓存/已最新）渲染为静态 span，无升级入口', () => {
    for (const initialCheck of [null, { current: '0.9.1', latest: '0.9.1', outdated: false, ahead: false }]) {
      const html = renderToString(h(components.__DshmVersionChip, { version: '0.9.1', notify: () => {}, initialCheck }))
      assert.ok(html.includes('dshm-dshchip'), '角标在')
      assert.ok(!html.includes('<button'), '静默态不可点（无 button）')
      assert.ok(!html.includes('⬆'), '静默态无升级箭头')
    }
  })

  it('DshmVersionChip outdated 点亮 warn 可点按钮并带最新版本号', () => {
    const html = renderToString(h(components.__DshmVersionChip, {
      version: '0.9.0',
      notify: () => {},
      initialCheck: { current: '0.9.0', latest: '0.9.1', outdated: true, ahead: false },
    }))
    assert.ok(html.includes('<button'), 'outdated 是可点按钮')
    assert.ok(html.includes('dshm-verchip warn'), 'warn 样式在')
    assert.ok(html.includes('⬆<span class="dshm-up-v"> v0.9.1</span>'), '箭头 + 最新版本号在')
    // Node 21+ 有全局 navigator.language → browserLang 可能落 en；两语言都合法
    assert.ok(html.includes('发现新版本 v0.9.1') || html.includes('New version v0.9.1'), 'title 提示在')
  })

  it('DshmVersionChip ahead（本地 dev 领先 npm）静默，仅 title 提示', () => {
    const html = renderToString(h(components.__DshmVersionChip, {
      version: '0.9.1',
      notify: () => {},
      initialCheck: { current: '0.9.1', latest: '0.9.0', outdated: false, ahead: true },
    }))
    assert.ok(!html.includes('<button'), 'ahead 态不可点')
    assert.ok(!html.includes('⬆'), 'ahead 态无升级箭头')
    assert.ok(html.includes('本地开发版') || html.includes('Local dev build'), 'title 提示本地开发版')
  })

  it('DshmVersionChip 版本护栏：initialCheck 的 current 与 version 不符 → 静默（跨服务重启旧判定）', () => {
    const html = renderToString(h(components.__DshmVersionChip, {
      version: '0.9.1',
      notify: () => {},
      initialCheck: { current: '0.9.0', latest: '0.9.1', outdated: true, ahead: false },
    }))
    assert.ok(!html.includes('<button'), '旧进程判定不得点亮')
    assert.ok(!html.includes('⬆'), '旧进程判定不得出箭头')
    assert.ok(html.includes('v0.9.1'), '显示当前真实版本')
  })
  // 0.10.2（主人 2026-10-17 裁决）：0.10.1 的自升级确认框已撤除（点击即升级，静默）——
  // 相应 SSR 钉随交互退役；升级结局仍由成功/失败横幅如实报告（needsRestart 透传钉在 client-self-check）。

  it('RestartBanner idle 态渲染不抛（0.9.2 onRestarted 接线）', () => {
    const html = renderToString(h(components.__RestartBanner, {
      note: '变更完成，需要重启 DSH Web 后生效。',
      onDone: () => {},
      desktop: false,
      onRestarted: () => {},
    }))
    assert.ok(typeof html === 'string' && html.includes('dshm-banner'), '横幅在')
    assert.ok(html.includes('变更完成'), 'note 文案在')
    // desktop 态不渲染一键重启按钮（0.9.0 能力表口径保持不变）
    const htmlDesktop = renderToString(h(components.__RestartBanner, { note: 'n', onDone: () => {}, desktop: true, onRestarted: () => {} }))
    assert.ok(!htmlDesktop.includes('dshm-btn primary'), 'desktop 无一键重启')
  })

  // 0.9.14 详情 Modal「安装命令」折叠行显隐：desktop 上下文/已安装条目整行隐藏，
  // web 未安装与旧宿主（profileKind 缺席）保持现状——命令两来源都是 --profile web 语义
  it('DetailModal 安装命令折叠行：web 未安装显示，desktop 或已安装隐藏', () => {
    const entry = { id: 'o1--demo', name: 'demo', description: 'd', category: 'theme', source: 'npm', npm: 'demo-pkg' }
    const base = { labels: {}, busy: false, onClose: () => {}, onInstall: () => {} }
    const web = renderToString(h(components.__DetailModal, { it: entry, ...base, profileKind: 'web' }))
    assert.ok(web.includes('dsvm-cmdrow'), 'web 未安装：折叠行在')
    assert.ok(web.includes('dsh plugin --profile web add demo-pkg'), 'web 推导命令在')
    const desktop = renderToString(h(components.__DetailModal, { it: entry, ...base, profileKind: 'desktop' }))
    assert.ok(!desktop.includes('dsvm-cmdrow'), 'desktop：整行隐藏')
    const installed = renderToString(h(components.__DetailModal, { it: { ...entry, installed: true }, ...base, profileKind: 'web' }))
    assert.ok(!installed.includes('dsvm-cmdrow'), '已安装：整行隐藏')
    const legacy = renderToString(h(components.__DetailModal, { it: entry, ...base }))
    assert.ok(legacy.includes('dsvm-cmdrow'), 'profileKind 缺席（旧宿主）按 web 保留')
  })

  // 0.9.15 安装信息就地进 Modal：终态行按 kind 着色 + ok 附重启提示；running record 渲染不抛
  //（ProgressLine 依赖 effect 轮询，SSR 首渲染为 null——冒烟只验终态行与不抛）
  it('DetailModal 安装终态行：ok/err/hint 着色 + ok 附重启提示；running record 渲染不抛', () => {
    const entry = { id: 'o1--demo', name: 'demo', description: 'd', category: 'theme', source: 'npm', npm: 'demo-pkg' }
    const base = { labels: {}, busy: false, onClose: () => {}, onInstall: () => {}, profileKind: 'web' }
    const ok = renderToString(h(components.__DetailModal, { it: entry, ...base, installNote: { id: entry.id, kind: 'ok', text: '已安装 demo v1.0.0' } }))
    assert.ok(ok.includes('dshm-ok'), 'ok 行着色类在')
    assert.ok(ok.includes('已安装 demo v1.0.0'), '终态文案在')
    assert.ok(ok.includes('变更完成，需要重启') || ok.includes('Changes applied'), 'ok 附重启提示在（zh/en 随环境）')
    const err = renderToString(h(components.__DetailModal, { it: entry, ...base, installNote: { id: entry.id, kind: 'err', text: '安装失败：boom' } }))
    assert.ok(err.includes('dshm-err'), 'err 行着色类在')
    assert.ok(err.includes('安装失败：boom'), '失败文案在')
    assert.ok(!err.includes('dshm-ok') && !err.includes('Changes applied') && !err.includes('变更完成，需要重启'), 'err 不附重启提示')
    const hint = renderToString(h(components.__DetailModal, { it: entry, ...base, installNote: { id: entry.id, kind: 'hint', text: 'demo 已跳过' } }))
    assert.ok(hint.includes('dshm-hint'), 'hint 中性着色在')
    const running = renderToString(h(components.__DetailModal, { it: entry, ...base, installRec: { kind: 'install', target: entry.id, status: 'running' } }))
    assert.ok(typeof running === 'string' && running.length > 0, 'running record 渲染不抛（进度行 SSR 为 null）')
  })

  // 0.9.60 灯箱 v2：SSR 无 document → 走非 portal 回退树，结构可见可断言；
  // 浏览器端才走 createPortal 挂 body（逃出面板 backdrop-filter 包含块，结构守卫在 client-lightbox）
  it('灯箱 v2 多图：✕/‹›/计数/圆点齐备且单图收敛；点图即关语义在 SSR 树可查', () => {
    const shots = ['a.png', 'b.png', 'c.png']
    const html = renderToString(h(components.__Lightbox, { shots, index: 0, onNav: () => {}, onClose: () => {} }))
    assert.ok(html.includes('dsvm-lightbox'), '灯箱根在（SSR 回退树）')
    assert.ok(html.includes('role="dialog"') && html.includes('aria-modal="true"'), 'dialog 语义在')
    assert.match(html, /aria-label="[^"]+"/, 'aria-label 在（文案随 locale）')
    assert.ok(html.includes('dsvm-lbclose'), '✕ 常驻')
    assert.ok(html.includes('dsvm-lbarrow prev') && html.includes('dsvm-lbarrow next'), '‹› 在')
    assert.ok(html.includes('1 / 3'), '计数在')
    assert.equal((html.match(/dsvm-lbdot[" ]/g) || []).length, 3, '三张图三颗圆点')
    assert.ok(html.includes('dsvm-lbhint'), '操作提示在')
    assert.ok(html.match(/<img[^>]*src="https:\/\/images\.weserv\.nl\/\?url=a\.png&amp;w=1600&amp;fit=inside&amp;we=1&amp;output=webp&amp;q=80"/), '当前图渲染（0.9.61 tier0=weserv，url=a.png 原样）')
    const single = renderToString(h(components.__Lightbox, { shots: ['only.png'], index: 0, onNav: () => {}, onClose: () => {} }))
    assert.ok(single.includes('dsvm-lbclose'), '单图 ✕ 仍在')
    assert.ok(!single.includes('dsvm-lbarrow') && !single.includes('dsvm-lbcount') && !single.includes('dsvm-lbdot'), '单图无 ‹›/计数/圆点死控件')
    // 评审 R4：重复 URL 不撞 key——圆点数仍 = shots 数（key 用序号）
    const dup = renderToString(h(components.__Lightbox, { shots: ['a.png', 'a.png', 'b.png'], index: 0, onNav: () => {}, onClose: () => {} }))
    assert.equal((dup.match(/dsvm-lbdot[" ]/g) || []).length, 3, '重复 URL 三颗圆点全渲染（key=序号）')
  })

  // 0.9.61 图片加载链：useImgChain 初始态 SSR 可见（tier0 = weserv；Q18 初始偏好）。
  // Shot 因 IO 门控不进 SSR（见 client-img-chain 源锚），Probe 是 hook 初始 src 的唯一 SSR 出口。
  it('useImgChain Probe：初始 src 为 weserv URL（scheme 剥离 + w 参数 + 固定参数串）', () => {
    const html = renderToString(
      h(components.__UseImgChainProbe, { url: 'https://raw.githubusercontent.com/a/b/HEAD/c.png', w: 1600 }),
    )
    assert.ok(
      html.includes('src="https://images.weserv.nl/?url=raw.githubusercontent.com%2Fa%2Fb%2FHEAD%2Fc.png&amp;w=1600&amp;fit=inside&amp;we=1&amp;output=webp&amp;q=80"'),
      `weserv tier0 src 应逐字在 SSR 输出：${html.slice(0, 200)}`,
    )
  })

  // ADR-0025 T5：Icon 懒加载门控下 SSR（useEffect 不执行、show 恒 false）→ 字母占位、无 img src；
  // 走链初始 src 的 SSR 覆盖由上方 Probe 断言独立承担（评审 R-2Q2）。
  it('Icon SSR：懒加载未可见 → 字母占位 div（aria-hidden），不产出头像 weserv src', () => {
    const entry = { id: 'o1--demo', name: 'demo', description: 'd', category: 'theme', source: 'npm', npm: 'demo-pkg', community: true, github: 'elysia395/dsh-wallpaper-engine' }
    const html = renderToString(h(components.__DetailModal, { it: entry, labels: {}, busy: false, onClose: () => {}, onInstall: () => {}, profileKind: 'web' }))
    assert.ok(
      html.includes('aria-hidden="true">D</div>'),
      `Icon SSR 应渲染字母占位 D：${html.slice(0, 160)}`,
    )
    assert.ok(
      !html.includes('images.weserv.nl/?url=github.com'),
      `SSR 不应产出头像 weserv src：${html.slice(0, 160)}`,
    )
  })
})

// ---------- 0.9.45 市场页两段加载（ADR-0013）+ P2 设置页强刷接线 ----------

describe('0.9.45 两段加载接线（源码断言；ADR-0023 T9：useMarketData 迁 hooks.js，锚随迁）', () => {
  it('市场页两段加载接线（0.9.45 ADR-0013，R2 修正断言形态）', () => {
    const hooksSrc = readFileSync(join(root, 'src/client/hooks.js'), 'utf8')
    assert.match(hooksSrc, /probeMode = "cache-only"/, '第一段默认 cache-only（默认参数形态）')
    assert.match(hooksSrc, /latestComplete === false/, '以 latestComplete 缺口判定发起第二段')
    assert.match(hooksSrc, /return fetchPage\(nextQuery, force, true, "full"\)/, '第二段 background 换新（force 走入参，core peek 重探）')
    assert.match(hooksSrc, /mergeLatestFields\(/, '徽标不回退 merge 接线')
  })

  it('P2 接线：设置页强刷 → 市场区 force 重取（R4；ADR-0023 T11：SettingsTab 锚随迁 settings-tab.jsx，接线锚留 main.jsx）', () => {
    assert.match(settingsTabSrc, /onForceMarket/, 'SettingsTab 新增强刷回调 prop（settings-tab.jsx）')
    assert.match(src, /marketReloadAll\(true\)/, '强刷回调以 force 重取两区（MarketPanel，main.jsx 保留区）')
    assert.match(settingsTabSrc, /refresh = async \(\) => \{[\s\S]{0,600}onForceMarket\?\.\(\)/, 'refresh 成功路径触发市场强取（settings-tab.jsx）')
  })

  it('详情 Modal：已装且可升级 → 「升级」主按钮；已装未过期 → 仅 manage 提示（0.9.45 U10）', () => {
    const base = { id: 'x', name: 'X', description: 'd', source: 'npm', npm: 'pkg-x', installed: true, installedPkg: 'pkg-x', installedVersion: '1.0.0', category: 'tools', tags: [] }
    const up = renderToString(h(components.__DetailModal, { it: { ...base, outdated: true }, labels: {}, busy: false, onClose: () => {}, onInstall: () => {}, onUpgrade: () => {}, upgradeBusy: false, profileKind: 'web' }))
    assert.match(up, /dsvm-modalactions[\s\S]*?dshm-btn primary/, 'outdated → 动作区主按钮在（语言无关）')
    const ok = renderToString(h(components.__DetailModal, { it: base, labels: {}, busy: false, onClose: () => {}, onInstall: () => {}, onUpgrade: () => {}, upgradeBusy: false, profileKind: 'web' }))
    assert.doesNotMatch(ok, /dsvm-modalactions[\s\S]*?dshm-btn primary/, '非 outdated → 动作区无主按钮')
    assert.match(marketTabSrc, /target: it\.installedPkg/, 'record.target = 安装包名（R1：upgrade record 语义是 pkg；#36 薄壳经 target 传参表达，runOp 落账在 upgrade-flow 单源——ADR-0023 T11 在 market-tab.jsx）')
    assert.match(marketTabSrc, /activeUpgradeRec\.target === detailItem\.installedPkg/, '进度行比对走 installedPkg（R1；market-tab.jsx）')
  })

  it('详情 Modal：README 折叠页（npm 条目）与收录日期 fmtDate（0.9.45 U10b）', () => {
    const it = { id: 'r', name: 'R', description: 'd', source: 'npm', npm: 'pkg-r', category: 'tools', tags: [], added: '2026-09-28T00:00:00.000Z' }
    const html = renderToString(h(components.__DetailModal, { it, labels: {}, busy: false, onClose: () => {}, onInstall: () => {}, profileKind: 'web' }))
    assert.ok(html.includes('dsvm-fold'), 'README 折叠容器在')
    assert.ok(html.includes('📖 README'), '折叠摘要用既有 readme.show 文案（emoji 语言无关）')
    assert.ok(!html.includes('2026-09-28T00:00:00.000Z'), '收录日期不再裸 ISO（语言无关）')
    assert.match(detailModalSrc, /kv\(lookup\("modal\.added"\), fmtDate\(it\.added\)\)/, 'added 走 fmtDate（R9 源码断言替代文案断言；detail-modal.jsx）')
  })

  it('U9：错误重试按钮 + 空态三分支键（ZH/EN 成对；MarketTab 锚随迁 market-tab.jsx——ADR-0023 T11）', () => {
    assert.match(marketTabSrc, /lookup\("failed\.load", \{ err: error \}\)[\s\S]{0,200}lookup\("market\.retry"\)/, '错误行内联重试（market-tab.jsx）')
    assert.match(marketTabSrc, /market\.empty\.unavailable/, 'unavailable 主文案分支（market-tab.jsx）')
    assert.match(marketTabSrc, /market\.empty\.category/, '分类空桶文案分支（market-tab.jsx）')
    for (const k of ['market.retry', 'market.empty.category', 'market.empty.unavailable']) {
      assert.ok(new RegExp(`"${k}":`).test(i18nSrc), `键 ${k} 存在（i18n.js 词典）`)
      assert.equal(i18nSrc.split(`"${k}":`).length - 1, 2, `键 ${k} ZH/EN 各一次（i18n.js）`)
    }
  })

  it('U12：精选条目收藏卡保留身份（精选徽标）；verified 徽标退役（2026-10-13 B 方案）；受众/解耦不打标（§2.7 裁决⑤）', () => {
    const favs = { list: [{ id: 'p', snapshot: { id: 'p', name: 'P', description: 'd', source: 'npm', npm: 'pkg-p', verified: ['0.2.0-rc.2'] }, addedAt: 1 }], toggle: () => {}, removeIds: () => {} }
    const html = renderToString(h(components.__FavoriteZone, { favorites: favs, onOpen: () => {} }))
    assert.ok(html.includes('精选') || html.includes('Curated'), '无 owner 快照 → 精选徽标（R9 双语兜底）')
    assert.ok(!html.includes('已实测') && !html.includes('Verified'), 'verified 徽标已退役（卡面只留例外信号，实测信息归详情弹窗）')
    assert.ok(!html.includes('作者自用') && !html.includes("Author's own"), '收藏区不打受众标（R7）')
    assert.ok(!html.includes('版本无关') && !html.includes('Version-independent'), '收藏区不打解耦标（R7）')
  })

  it('U8：Modal role=dialog/aria-modal/初始聚焦 + Shot 键盘（子集，无焦点圈闭）', () => {
    const html = renderToString(h(components.__DetailModal, { it: { id: 'a', name: 'A', description: 'd', source: 'npm', npm: 'p', category: 'tools', tags: [] }, labels: {}, busy: false, onClose: () => {}, onInstall: () => {}, profileKind: 'web' }))
    assert.ok(html.includes('role="dialog"'), 'role=dialog')
    assert.ok(html.includes('aria-modal="true"'), 'aria-modal')
    assert.match(detailModalSrc, /role: "dialog"/, '容器接线（detail-modal.jsx——ADR-0023 T11）')
    assert.match(detailModalSrc, /closeRef\.current\.focus\(\)/, '初始聚焦关闭钮（detail-modal.jsx）')
    assert.match(chromeSrc, /role: "button", tabIndex: 0[\s\S]{0,400}onKeyDown: \(e\) => \{\s*if \(\(e\.key === "Enter" \|\| e\.key === " "\)/, 'Shot Enter/Space（含既有 role/tabIndex 锚段；Shot 迁 chrome.jsx）')
    assert.doesNotMatch(src, /focus-trap|focusTrap/, '不做焦点圈闭（Q5 边界）')
  })

  it('U3/U7：0 计数桶显式 0 + zero 样式 + 跨桶 title 说明', () => {
    const html = renderToString(h(components.__ZoneChips, { zone: 'primary', counts: { essentials: 4, 'cui-picks': 0, 'self-dev': 8, 'tencent-lighthouse': 3, watchlist: 3 }, labels: null, active: null, onPick: () => {} }))
    assert.ok(html.includes('zero'), '0 计数桶带 zero 类')
    assert.match(stylesSrc, /\.dshm-chip\.zero\{opacity/, 'zero 降透明 CSS 在')
    assert.match(i18nSrc, /chips\.crossbucket\.tip/, '跨桶说明键存在（i18n.js 词典）')
  })
})

describe('0.9.76「版本无关」徽章退役（源码断言）——展示层两处退役、Modal Compat 行为唯一权威呈现', () => {
  it('市场卡与 Modal 头不再渲染解耦徽章；徽章 i18n 键退役', () => {
    assert.equal(src.includes('lookup("badge.decoupled")'), false, '卡片/Modal 头徽章渲染调用不得残留')
    assert.equal(i18nSrc.includes('badge.decoupled.tip'), false, '徽章 tooltip 键不得残留（词典面）')
    assert.equal(i18nSrc.includes('"badge.decoupled"'), false, 'i18n 徽章键不得残留（词典面）')
  })
  it('Modal Compat 行保留为唯一权威呈现；snapshotOf 数据字段照常透传（收藏/快照完整性）', () => {
    assert.ok(i18nSrc.includes('modal.decoupled.label') && i18nSrc.includes('modal.decoupled.value'), 'Compat 行 i18n 键在（词典面）')
    assert.match(detailModalSrc, /it\.decoupled === true \? kv\(lookup\("modal\.decoupled\.label"\)/, 'Compat 行条件渲染在（detail-modal.jsx）')
    assert.match(cardSrc, /"verified", "audience", "decoupled"\]/, 'snapshotOf 数据字段保留（card.jsx）')
  })
})

describe('2026-10-13「已实测」徽章退役（B 方案）——卡面徽章三处退役、byline 灰字承接、Modal 实测版本行为唯一权威呈现', () => {
  it('市场卡/收藏卡/Modal 头徽章渲染调用与 i18n 键退役；badges 应标记例外而非常态', () => {
    assert.equal(src.includes('lookup("badge.verified")'), false, '徽章渲染调用不得残留')
    assert.equal(i18nSrc.includes('"badge.verified"'), false, 'i18n 徽章键不得残留（ZH/EN 均退役，词典面）')
  })
  it('byline 灰字承接（低显著度，末位=最新复验版本）；Modal「实测版本」行保留为唯一权威呈现', () => {
    assert.match(cardSrc, /const verifiedByline = \(it\) =>/, 'byline 灰字构造器在（card.jsx）')
    assert.match(marketTabSrc, /verifiedByline\(it\),/, '市场卡 byline 接线在（market-tab.jsx——ADR-0023 T11）')
    assert.match(cardSrc, /lookup\("byline\.verified", \{ v: it\.verified\[it\.verified\.length - 1\] \}\), title: it\.verified\.join\("、"\)/, '灰字取末位（时间序最新）+ tooltip 全量清单（card.jsx）')
    assert.equal(i18nSrc.split('"byline.verified":').length - 1, 2, 'byline.verified ZH/EN 各一次（键定义计口径，带冒号，i18n.js）')
    assert.match(detailModalSrc, /it\.community !== true && Array\.isArray\(it\.verified\) && it\.verified\.length \? kv\(lookup\("modal\.verified"\)/, 'Modal「实测版本」行条件渲染在（唯一权威呈现；detail-modal.jsx）')
  })
})

describe('0.9.76 分类行吸顶高频跳动修复（源码断言）——滚动锚定在面板滚动容器停用', () => {
  it('.dshm-body 关闭 overflow-anchor（断自激循环驱动器）；吸顶/哨兵几何不动', () => {
    assert.match(stylesSrc, /\.dshm-body\{[^}]*overflow-anchor:none/, '滚动锚定停用在位（.dshm-body 是面板唯一滚动容器）')
    assert.ok(stylesSrc.includes('position:sticky;top:-14px'), '吸顶几何不变（哨兵契约依赖 top:-14px）')
    assert.ok(zoneChipsSrc.includes('top: "-5px"'), '哨兵 -5px 契约不变（JSX 面，zone-chips.jsx）')
  })
})

describe('0.9.85 头部自升级入本地操作泵（源码断言）——主人真机反馈：自升级在操作日志无记录', () => {
  it('DshmVersionChip 走 ops.runOp（kind upgrade/target dsh-m + opMeta from/to 落账）且 ops 接线到头部', () => {
    const versionChipSrc = readFileSync(join(root, 'src/client/version-chip.jsx'), 'utf8')
    assert.match(versionChipSrc, /ops\.runOp\("upgrade", "dsh-m", async \(\) => \{\s*const r = await api\("self-upgrade"\);/, '自升级入泵（目标=自身包名，与 marketplace upgrade 锚 it.installedPkg 区分；chip 迁 version-chip.jsx）')
    assert.match(versionChipSrc, /opMeta: \{ from: version, to: r\.version \|\| "latest" \}/, 'from/to 版本变迁落账（opRowVm 渲染 vX→vY 的数据源）')
    assert.ok(src.includes('h(DshmVersionChip, { version: pluginVersion, notify, ops })'), 'ops 接线头部 chip 在（head 渲染，main.jsx 保留区；SSR/探针无 ops 时回退直连 api）')
  })
})

describe('panel resize 渲染接线（T2）——三手柄 restore 在/full 无 + 尺寸记忆进 inline 宽高', () => {
  it('还原态渲染三手柄（data-dshm-resize=e|s|se 各恰一次，aria-hidden）', () => {
    const html = renderToString(h(components.__MarketPanel, { onClose: () => {} }))
    for (const zone of ['e', 's', 'se']) {
      const n = html.split(`data-dshm-resize="${zone}"`).length - 1
      assert.equal(n, 1, `手柄 ${zone} 应恰出现 1 次，实际 ${n}`)
    }
    assert.ok(html.includes('dshm-rz rz-se'), '右下角手柄类名在')
  })

  it('全屏态不渲染手柄（窄视口桩命中强制全屏初始化；key 定向桩评审 R1-7②）', () => {
    globalThis.window = {
      matchMedia: () => ({ matches: true }),
      localStorage: { getItem: (k) => (k === 'dshm-panel-fullscreen' ? '1' : null) },
    }
    try {
      const html = renderToString(h(components.__MarketPanel, { onClose: () => {} }))
      const n = html.split('data-dshm-resize=').length - 1
      assert.equal(n, 0, `全屏态手柄应为 0，实际 ${n}`)
      assert.ok(html.includes('dshm-panel full'), '全屏类名在（桩生效佐证）')
    } finally {
      delete globalThis.window
    }
  })

  it('尺寸记忆注入 inline 宽高；无记忆时不产生内联 width', () => {
    globalThis.window = {
      matchMedia: () => ({ matches: false }),
      localStorage: { getItem: (k) => (k === 'dshm-panel-size' ? JSON.stringify({ w: 1200, h: 800 }) : null) },
    }
    try {
      const html = renderToString(h(components.__MarketPanel, { onClose: () => {} }))
      assert.ok(html.includes('width:1200px'), `size.w 应进 inline style，实际无 width:1200px`)
      assert.ok(html.includes('height:800px'), 'size.h 应进 inline style')
    } finally {
      delete globalThis.window
    }
    const bare = renderToString(h(components.__MarketPanel, { onClose: () => {} }))
    assert.ok(!bare.includes('width:1200px'), '无记忆渲染不得出现 1200 内联宽')
  })
})

describe('T7 验收三修（源锚）——头部 720 断点 / 弹窗 body 结构 / 设置网格容器门控', () => {
  it('头部两行重排断点 600→720（resize min 640 恒入两行区）；title/seg 基础 nowrap 防挤压带', () => {
    assert.ok(stylesSrc.includes('@container (max-width:720px){'), '容器断点 720 在')
    assert.ok(!stylesSrc.includes('@container (max-width:600px){'), '旧 600 容器断点已退役')
    assert.ok(stylesSrc.includes('.dshm-title{font-weight:600;font-size:15px;margin-right:2px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}'), 'title nowrap+ellipsis 在（flex 子项块化，ellipsis 生效）')
    assert.ok(stylesSrc.includes('display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:background .15s,color .15s,box-shadow .15s}'), 'seg button 基础 nowrap 在')
    assert.ok(stylesSrc.includes('@media (max-width:600px){.dshm-overlay{padding:8px}}'), '视口 600 overlay 断点不动')
  })

  it('详情弹窗：✕ 与「安装」双端常驻（modalbody 结构化滚动；切片随迁 detail-modal.jsx——ADR-0023 T11）', () => {
    assert.ok(detailModalSrc.includes('className: "dsvm-modalbody"'), 'body 包裹层在（detail-modal.jsx）')
    assert.match(stylesSrc, /\.dsvm-modalbox\{[^}]*overflow:hidden/, 'box 攂滚动改 hidden')
    assert.ok(!/\.dsvm-modalbox\{[^}]*overflow:auto/.test(stylesSrc), 'box 不再整体滚动')
    assert.match(stylesSrc, /\.dsvm-modalbody\{overflow:auto;min-height:0;overscroll-behavior:contain/, 'body 滚动 + min-height:0 + 防链式在')
    const m = detailModalSrc.slice(detailModalSrc.indexOf('function DetailModal('))
    assert.ok(m.indexOf('dsvm-modalbody') < m.indexOf('dsvm-kv') && m.indexOf('dsvm-modalbody') < m.indexOf('dsvm-modalactions'), 'body 包住 kv 到 actions 之前的中段')
  })

  it('设置网格三列门控 = 容器宽 ≥1100 而非全屏（panel resize 伴生修复；0.9.91 三列 4:7:4 左右窄卡等宽）', () => {
    assert.ok(stylesSrc.includes('@container (min-width:1100px){'), '容器门控在')
    assert.ok(stylesSrc.includes('.dshm-settings-grid{grid-template-columns:4fr 7fr 4fr}'), '三列规则在（容器版，4:7:4）')
    assert.ok(!stylesSrc.includes('.dshm-panel.full .dshm-settings-grid{grid-template-columns:4fr 7fr 4fr}'), '.full 三列规则已退役')
    assert.ok(stylesSrc.includes('@media (max-width:760px){.dshm-settings-grid'), '≤760 视口单列保留')
  })
})

// ---------- ADR-0023 T12：出仓组件 props 变体扩面（每组件 1-2 代表态，SSR 首渲染语义，不穷举） ----------
describe('ADR-0023 T12 扩面：MarketTab / OperationsCard 代表性 props 变体', () => {
  const mkQuery = () => ({ zone: 'community', source: 'community', query: '', category: null, sort: { field: 'downloads', dir: 'desc' }, offset: 0, limit: 32 })
  const emptyMarket = (loading) => ({ data: null, loading, error: null, reload: () => {}, query: mkQuery(), updateQuery: () => {} })
  const normalized = (items, total) => ({ items, total, offset: 0, limit: 32, categoryCounts: {}, registryState: { count: 0 }, community: { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, acceptedCount: 0, displaced: 0, categoryLabels: {}, categoryLabelsEn: {} }, installedComplete: true, latestComplete: true, latestTimedOut: false })
  it('MarketTab loading 骨架态与有数据态首渲染不抛（分区壳 + 卡片网格路径）', () => {
    const markets = { community: emptyMarket(true), primary: emptyMarket(true) }
    const loading = renderToString(h(components.__MarketTab, { notify: () => {}, markets, onMutation: null, ops: { records: [], runOp: async () => {} }, favorites: null, profileKind: 'web', onOpenOps: () => {} }))
    assert.ok(typeof loading === 'string' && loading.length > 0, 'loading 态渲染出非空 HTML')
    const item = { id: 'x', name: 'X', description: 'd', source: 'npm', npm: 'pkg-x', category: 'tools', tags: [], latest: '1.0.0' }
    const loaded = renderToString(h(components.__MarketTab, {
      notify: () => {},
      markets: { community: { ...emptyMarket(false), data: normalized([item], 1) }, primary: emptyMarket(false) },
      onMutation: null, ops: { records: [], runOp: async () => {} }, favorites: { list: [], toggle: () => {}, removeIds: () => {} }, profileKind: 'web', onOpenOps: () => {},
    }))
    assert.ok(loaded.includes('pkg-x') || loaded.includes('X'), '有数据态卡片渲染在')
  })
  it('OperationsCard 有记录态首渲染不抛（进行中组 + 已结束组 + 滚动区路径）', () => {
    const records = [
      { id: 'r1', kind: 'install', target: 'pkg-a', status: 'running', meta: { npm: 'pkg-a', session: true }, updatedAt: 1 },
      { id: 'r2', kind: 'upgrade', target: 'pkg-b', status: 'done', meta: { toVersion: '2.0.0' }, updatedAt: 2 },
      { id: 'r3', kind: 'toggle', target: 'pkg-c', status: 'failed', error: 'boom', updatedAt: 3 },
    ]
    const html = renderToString(h(components.__OperationsCard, { records, onClearFinished: () => {}, onRemove: () => {} }))
    assert.ok(typeof html === 'string' && html.includes('dsvm-oprow'), '记录行渲染在')
  })
})

// ── 评审 P2（displaced-impl 实施评审）：「精选收录」徽章接线源码锚——
// primaryOverlap 条件 → badge.inCurated 徽章的接线无 SSR 出口（cardOf 为 MarketTab 内部件，
// 需重 props 不可轻渲染），按计划 T3.3「或源码锚」形态钉死接线；键名漂移由 client-i18n
// 直接量↔字典自动审计兜底，本锚钉「条件与键名同时在位」。
describe('评审 P2 源码锚：primaryOverlap → 精选收录徽章接线', () => {
  it('market-tab 徽章条件与 i18n 键同时在位（条件改写/键改名任一即红）', () => {
    const cond = 'it.primaryOverlap === true ? h("span", { className: "dshm-badge curated", key: "cur" }, lookup("badge.inCurated")) : null'
    assert.ok(
      marketTabSrc.includes(cond),
      'cardOf 徽章接线漂移：primaryOverlap → badge.inCurated 条件未在 market-tab.jsx 找到',
    )
    assert.ok(i18nSrc.includes('"badge.inCurated": "精选"') && i18nSrc.includes('"badge.inCurated": "Curated"'), 'i18n 双语键缺失')
  })
})
