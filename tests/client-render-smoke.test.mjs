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
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const src = readFileSync(join(root, 'src/client/main.jsx'), 'utf8')
// 入口必须与 main.jsx 同目录（相对 require ./market-state.js 等才能解析）；构建后即删
const dir = join(root, 'src/client')
const entry = join(dir, '.render-smoke-entry.jsx')
// bundle 放进仓库 node_modules/.dshm/：external 的 react/react-dom 靠 Node 向上解析命中（/tmp 下解析不到）
const outDir = join(root, 'node_modules', '.dshm')
mkdirSync(outDir, { recursive: true })
const out = join(outDir, 'render-smoke.cjs')
let mod
try {
  writeFileSync(
    entry,
    src +
      '\n// ---- 测试追加导出（不进生产：build.mjs 打包的是 main.jsx 本体，此文件不入库不发布）----\n' +
      'module.exports = { __MarketPanel: MarketPanel, __InstalledTab: InstalledTab, __SearchBox: SearchBox, __ZoneChips: ZoneChips, __FavoriteZone: FavoriteZone, __DshmVersionChip: DshmVersionChip, __RestartBanner: RestartBanner, __DetailModal: DetailModal, __InstallConfirmModal: InstallConfirmModal, __CardShots: CardShots, __GalleryCard: GalleryCard, __snapshotOf: snapshotOf };\n',
  )
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
  const require2 = createRequire(import.meta.url)
  const React = require2(join(root, 'node_modules/react'))
  const { renderToString } = require2(join(root, 'node_modules/react-dom/server'))
  mod = { React, renderToString, mod: require2(out) }
} finally {
  try {
    rmSync(entry, { force: true })
  } catch {
    /* 清理失败不阻塞测试 */
  }
}
const { React, renderToString } = mod
const components = mod.mod
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
    assert.match(src, /\.dshm-cards\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,360px\),1fr\)\);gap:8px\}/, '按 360px 最小卡宽与 8px 间距自动填列，并均分剩余宽度')
    assert.doesNotMatch(src, /@media\s*\(\s*max-width\s*:\s*680px\s*\)\s*\{\s*\.dshm-cards\s*\{[^}]*1fr/, '不再用视口断点覆盖容器实际宽度（含空白/等价写法形态）')
  })

  // 0.9.4 Windows Desktop 全屏修复（实机回归：全屏后面板头部 tab/还原键落在壳 40px
  // -webkit-app-region:drag 拖拽带内——拖拽带按布局吞点击、无视 z-index/绘制顺序；右上角
  // 还有 titleBarOverlay 系统绘制的 — □ ✕ 悬浮于一切之上。对策与壳自家 overlay 同款：
  // 消费壳在 html 上设的 --dsh-windows-titlebar-height 让出该带。该变量仅 Windows Desktop
  // 宿主存在，DSH Web/浏览器回落 0px，行为零漂移。）
  it('Windows 标题栏让位：全屏 top 与浮动态 padding-top 消费壳标题栏变量，Web 回落 0', () => {
    assert.match(src, /\.dshm-overlay\.full\{[^}]*top:var\(--dsh-windows-titlebar-height,0px\)\}/, '全屏态顶部让位在')
    assert.match(src, /padding:max\(24px,var\(--dsh-windows-titlebar-height,0px\)\) 16px 24px/, '浮动态 padding-top 下限在（矮窗口浮板不被拖拽带压住）')
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

  it('FavoriteZone 带一条收藏快照渲染不抛（卡片路径）', () => {
    // 0.9.34 起 theme 分类收藏走画廊卡（见下方用例）；本用例守护非主题文字卡路径的可点击语义
    const fav = {
      id: 'o1--demo',
      savedAt: 1,
      snapshot: { id: 'o1--demo', name: 'demo', description: 'd', category: 'ui', source: 'npm', npm: 'demo-pkg', owner: 'o1', downloads: 5, stars: 2 },
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
    assert.ok(html.includes('dshm-dshchip warn'), 'warn 样式在')
    assert.ok(html.includes('⬆ v0.9.1'), '箭头 + 最新版本号在')
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

  // 0.9.34 ADR-0013：卡面轻确认安装弹层（名称标题/社区信任提示/取消确认按钮）
  it('InstallConfirmModal：名称标题/社区信任提示/取消确认按钮 + 确认容器类', () => {
    const entry = { id: 'o1--demo', name: 'demo', description: 'd', category: 'theme', community: true, source: 'npm', npm: 'demo-pkg' }
    const html = renderToString(h(components.__InstallConfirmModal, { it: entry, busy: false, onClose: () => {}, onConfirm: () => {} }))
    assert.ok(html.includes('dsvm-confirmbox'), '轻确认容器在')
    assert.ok(html.includes('demo'), '名称在')
    assert.ok(html.includes('确认安装') || html.includes('Install'), '标题在')
    assert.ok(html.includes('来源可信') || html.includes('verify the source'), '社区信任提示在')
    assert.ok(html.includes('dshm-btn primary'), '确认按钮在')
  })

  // 0.9.34 ADR-0013：文字卡缩略条（有 screenshots 才渲染，≤3 张，SSR 懒加载空壳）
  it('CardShots：≤3 张、SSR 懒加载空壳、复用 shotbox', () => {
    const shots = ['https://raw.githubusercontent.com/o1/r1/HEAD/docs/a.png', 'https://raw.githubusercontent.com/o1/r1/HEAD/docs/b.png']
    const html = renderToString(h(components.__CardShots, { shots, onOpen: () => {} }))
    assert.ok(html.includes('dshm-shotstrip'), '缩略条容器在')
    assert.ok(!html.includes('<img'), 'SSR 不带 img（IO 挂 src 后才有）')
    assert.ok(html.includes('dsvm-shotbox'), '复用 shotbox 槽位')
    const empty = renderToString(h(components.__CardShots, { shots: [], onOpen: () => {} }))
    assert.equal(empty, '', '无图返回 null')
  })

  // 0.9.34 ADR-0013：主题画廊卡（封面 jsDelivr 改写 + 张数角标 + footer；无图 SSR 占位零请求）
  it('GalleryCard：curated 封面走 jsDelivr 改写 + 张数角标 + footer 操作', () => {
    const it0 = { id: 'o1--skin', name: 'skin', description: 'd', category: 'theme', community: true, source: 'github', github: 'o1/skin',
      screenshots: ['https://raw.githubusercontent.com/o1/skin/HEAD/docs/a.png', 'https://raw.githubusercontent.com/o1/skin/HEAD/docs/b.png'] }
    const html = renderToString(h(components.__GalleryCard, { it: it0, fav: null, onToggleFav: () => {}, onOpenDetail: () => {}, onQuickInstall: () => {}, busy: false, cache: { get: () => undefined, set: () => {}, clear: () => {} } }))
    assert.ok(html.includes('dshm-gcard'), '画廊卡容器在')
    assert.ok(html.includes('cdn.jsdelivr.net/gh/o1/skin@HEAD/docs/a.png'), '封面首选 jsDelivr 改写（封面 img 直接渲染，原生 lazy）')
    assert.ok(html.includes('dshm-gcount'), '张数角标在')
    assert.ok(html.includes('张预览') || html.includes('preview'), '角标文案在')
    assert.ok(html.includes('dshm-btn'), 'footer 操作在')
  })
  it('GalleryCard：无图无兜底前渲染占位（SSR 不发起 fetch）', () => {
    const it0 = { id: 'o1--bare', name: 'bare', description: 'd', category: 'theme', community: true, source: 'github', github: 'o1/bare' }
    const html = renderToString(h(components.__GalleryCard, { it: it0, fav: null, onToggleFav: () => {}, onOpenDetail: () => {}, onQuickInstall: () => {}, busy: false, cache: { get: () => undefined, set: () => {}, clear: () => {} } }))
    assert.ok(html.includes('dshm-gcover-empty'), '占位在')
    assert.ok(!html.includes('<img'), 'SSR 零 img')
  })

  // 0.9.34 ADR-0013：收藏区——主题收藏画廊卡、非主题文字卡（含缩略条）；snapshotOf 断链回归门
  it('FavoriteZone：主题收藏渲染画廊卡，非主题维持文字卡', () => {
    const favs = { list: [
      { id: 'o1--skin', savedAt: 1, snapshot: { id: 'o1--skin', name: 'skin', description: 'd', category: 'theme', source: 'github', github: 'o1/skin', screenshots: ['https://raw.githubusercontent.com/o1/skin/HEAD/a.png'] } },
      { id: 'o1--tool', savedAt: 2, snapshot: { id: 'o1--tool', name: 'tool', description: 'd', category: 'ui', source: 'npm', npm: 'tool' } },
    ], toggle: () => {}, removeIds: () => {} }
    const html = renderToString(h(components.__FavoriteZone, { favorites: favs, onOpen: () => {} }))
    assert.ok(html.includes('dshm-gcard'), '主题条目走画廊卡')
    assert.ok(html.includes('dshm-card'), '非主题维持文字卡')
  })
  it('snapshotOf 保留 screenshots（收藏快照断链回归门）', () => {
    const snap = components.__snapshotOf({ id: 'o1--x', name: 'x', description: 'd', category: 'theme', source: 'github', github: 'o1/x', screenshots: ['https://raw.githubusercontent.com/o1/x/HEAD/a.png'] })
    assert.deepEqual(snap.screenshots, ['https://raw.githubusercontent.com/o1/x/HEAD/a.png'])
  })
})
