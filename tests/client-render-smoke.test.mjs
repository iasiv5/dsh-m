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
      'module.exports = { __MarketPanel: MarketPanel, __InstalledTab: InstalledTab, __SearchBox: SearchBox, __ZoneChips: ZoneChips, __FavoriteZone: FavoriteZone, __DshmVersionChip: DshmVersionChip };\n',
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
})
