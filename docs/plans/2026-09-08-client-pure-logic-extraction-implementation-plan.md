# Client 纯逻辑迁出实施计划（markdown / installed-view / tool-view / restart-wait）

> **收口标注（2026-09-08）**：本计划已执行完毕，4 个 checkpoint commit 见 `6b02d3d..3854ff1`；
> 最终验收 315 pass / 0 fail、build 5 marker 过、typecheck OK；经第四轮独立收口评审「执行合格，放行」。
> 评审观察备忘：快照中「573/756-757 被直接消费」实际均为 ExtLink 消费点，基线无 MdImg 外部消费
> （MdImg 仅被 mdInline 内部消费，已随工厂整组迁出）——历史正文保留原措辞，以此备忘为准。

## 目标

把 `src/client/main.jsx`（1,629 行，近 60 次提交中变更 11 次、全库第一热）里的高风险纯逻辑迁出到可 Node 直测的 client 模块，全程零行为变化，补齐旗舰 GUI 唯一缺失的测试面：

1. markdown 渲染器（含 `safeUrl` 安全闸门——第三方 README 与 `href` 注入间唯一协议白名单）；
2. 已装页视图模型（两处逐字重复的 `github:` spec 解析、卸载护栏、来源标签，全部 key 化）；
3. 工具卡片 payload 解析（`pickPayload`/`parseToolArgs`，契约漂移时静默返回空）；
4. 重启等待决策（超时优先于 boot 变化的边界语义，用测试钉死）。

## 架构快照

- 延伸仓库已验证的 seam：`src/client/market-state.js`（ESM `export` 的纯 JS 模块 + `tests/client-market-state.test.mjs` Node 直测；main.jsx 第 14 行以 CJS `require` 引入，esbuild interop 已在生产验证）。四个新模块照同一模式。
- **markdown.js 用工厂注入 `h`**：`createMarkdown(h)` 返回 `{ ExtLink, MdImg, renderMarkdown }`。这是评审意见「`renderMarkdown(text, h)` 注入 h」的落地形态偏差：因 `ExtLink`/`MdImg` 在 main.jsx 573/756-757 被直接消费（`officialLinks`/`LinksRow`/`MarketTab`），工厂让注入只发生一处（main.jsx 模块顶部），内部函数签名与函数体逐字保留，diff 最小。测试注入模仿 React.createElement 语义的假 `h`（展平数组 children + 解析函数组件，完整代码见 Task 1 Step 1），零 React 依赖做纯结构断言。
- **installed-view.js 按 key 化接口**：视图模型只产出 i18n key + 参数（照 `registryNotice` 返回 `{key, count}` 先例），`lookup` 留在 main.jsx 调用方，接口不注入 `lookup`、不搬字典。
- **restart-wait.js 用 phase 显式钉死边界语义**：现行实现在同一轮迭代内先查超时再 ping（超时优先于 boot 变化），`phase: 'before-ping' | 'after-ping'` 忠实保留该顺序，不改变轮询时序。
- main.jsx 只删被迁符号与相应调用点表达式，其余（组件、i18n 字典、CSS、market-state 消费）不动。发布面不变：`src/client/*.js` 只经 esbuild bundle 进 `lib/client.js`，`files` 无需改动。
- **明确不在本计划内**（独立提案/后续）：`api()` 透传 `detail`（行为变更，违背 DESIGN.md L71「GUI 零改动只读 error」的 v1 桥接决策，需自己的验收标准）；硬编码中文 i18n 化（1516/1524/1586-1587）；market.ts latest-probe 三份拷贝去重；CSS/中英字典外迁；`safeUrl` 行为加固（本计划只钉死现行为）。

## 全局约束

- **零行为变化**：迁移批次（Task 1-8）的验收线。所有迁出函数体逐字保留；只允许新增模块壳（注释/export/factory/return）与调用点等价表达式替换。
- **零新增运行时依赖**：React 仍从 module loader require（DESIGN.md §4）；新模块不得 import react/react-dom/lookup。
- **bundle 契约**：`lib/client.js` 必须继续被 `window.__ModuleLoader__.load` 包裹且 marker 检查（`dshm-overlay`/`MarketPanel`/`InstalledTab`/`SettingsTab`/`RestartBanner`）通过（scripts/build.mjs verify 段）。
- **模块形态**：新 client 模块一律 ESM `export` 的 `.js`，被 main.jsx 以 CJS `require` 引入（market-state.js 先例）；测试以 ESM `import` 直测源文件。
- Node >= 22；测试框架为 Node 内置 test runner；注释与测试描述沿用仓库中文惯例。
- 分支：当前在 `main`、工作树干净。仓库惯例是直接提交 main（近 60 次提交均为直提），本计划获批即视为同意在 main 上按批次 checkpoint commit。

## 输入工件

- 任务卡 v2（本对话内，含评审 Agent 五条修改清单，全部采纳）：
  1. installed-view 接口 key 化（照 `registryNotice` 先例）；
  2. `api()` detail 项拆出本计划；
  3. 分批执行 + 每批验收（新测试 + 全量绿 + build marker 过）；
  4. 收益表述修正：spec 解析收敛是客户端内部两处→一处，不按跨端文法收敛报账（`installed.ts parseSpecSource` 只做类型判别，不抽 owner/repo）；
  5. `ExtLink`/`MdImg` 必须随 markdown.js 整组随迁；restart-wait 测试须钉死「超时优先于 boot 变化」。
- 仓库锚点（行号为 2026-09-08 main@0f6ce6a 读数，仅辅助定位）：`src/client/main.jsx` — safeUrl 391-396、ExtLink 399-411、MdImg 413-423、mdInline 426-468、mdBlocks 471-552、renderMarkdown 554-556、officialLinks/LinksRow 559-576（留守）、uninstallGuard 857-868、spec 解析 937/950、source map 946、latest 标签 940/959、regSourceLabel 1001-1016（唯一调用点 1165）、pickPayload/parseToolArgs 1445-1483（调用点 1529/1530/1573）、RestartBanner.restart 608-632。
- 基线：`npm test` = 290 pass / 66 suites / 0 fail；分支 main 干净。

## 文件结构与职责

- Create: `src/client/markdown.js` — `safeUrl` + `createMarkdown(h)`（markdown 渲染纯逻辑，唯一安全闸门所在）
- Create: `src/client/installed-view.js` — `installedViewModel(it)` + `registrySourceKey(data)`（已装页/设置页视图模型，key 化）
- Create: `src/client/tool-view.js` — `pickPayload(props)` + `parseToolArgs(props)`（工具视图 payload 解析）
- Create: `src/client/restart-wait.js` — 轮询常量 + `nextRestartWait(...)`（重启等待纯决策）
- Modify: `src/client/main.jsx` — 删除被迁符号，新增 4 处 require + 调用点等价替换
- Test: `tests/client-markdown.test.mjs`、`tests/client-installed-view.test.mjs`、`tests/client-tool-view.test.mjs`、`tests/client-restart-wait.test.mjs`
- 不修改：`scripts/build.mjs`（marker 名全部留守 main.jsx）、`package.json`、tsconfig（`include: ["src/**/*.ts"]` 不含 client JS）

## 任务清单

### Task 1: markdown.js 模块 + 测试（先红后绿）

- 目标：把 markdown 渲染纯逻辑迁入 `src/client/markdown.js`，测试钉死 `safeUrl` 白名单与渲染结构。
- 涉及文件：Create `src/client/markdown.js`、`tests/client-markdown.test.mjs`
- 接口契约：
  - Consumes: main.jsx 391-556 的现行为（逐字搬迁源）；无其他依赖。
  - Produces: `safeUrl(u)`、`createMarkdown(h) → { ExtLink, MdImg, renderMarkdown }`（Task 2 消费）。
- 验证范围：`node --test tests/client-markdown.test.mjs`

- [ ] Step 1: 写测试文件 `tests/client-markdown.test.mjs`：

```js
/**
 * markdown 渲染 pure 逻辑：safeUrl 安全闸门 + 行内/块级结构。
 * 注入假 h 断言纯结构，不依赖 DOM/React。
 * 运行：node --test tests/client-markdown.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { safeUrl, createMarkdown } from '../src/client/markdown.js'

// 假 h：模仿 React.createElement 语义——展平数组 children、解析函数组件
// （现行实现大量使用 h("p", {key}, mdInline(...)) 数组传参与 h(ExtLink, ...) 组件传参）
const h = (type, props, ...children) => {
  const kids = children.flat(Infinity);
  return typeof type === "function"
    ? type({ ...(props || {}), children: kids })
    : { type, props, children: kids };
};

describe('safeUrl', () => {
  it('放行 http/https/mailto/相对与锚点，trim 首尾空白', () => {
    assert.equal(safeUrl('https://a.com'), 'https://a.com')
    assert.equal(safeUrl('HTTP://A.COM'), 'HTTP://A.COM')
    assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c')
    assert.equal(safeUrl('/rel/path'), '/rel/path')
    assert.equal(safeUrl('#frag'), '#frag')
    assert.equal(safeUrl('  https://a.com  '), 'https://a.com')
  })
  it('其余协议与空值一律归 #（安全闸门现行为）', () => {
    assert.equal(safeUrl('javascript:alert(1)'), '#')
    assert.equal(safeUrl('JavaScript:x'), '#')
    assert.equal(safeUrl('data:text/html,<b>x</b>'), '#')
    assert.equal(safeUrl('vbscript:x'), '#')
    assert.equal(safeUrl(''), '#')
    assert.equal(safeUrl(null), '#')
    assert.equal(safeUrl(undefined), '#')
  })
})

describe('createMarkdown(h) 渲染结构', () => {
  const md = createMarkdown(h)

  it('ExtLink 走 safeUrl 且固定 target/rel', () => {
    const n = md.ExtLink({ href: 'https://a.com', className: 'c', children: ['x'] })
    assert.equal(n.type, 'a')
    assert.equal(n.props.href, 'https://a.com')
    assert.equal(n.props.target, '_blank')
    assert.equal(n.props.rel, 'noopener noreferrer')
    assert.equal(typeof n.props.onClick, 'function')
    const bad = md.ExtLink({ href: 'javascript:x', children: ['y'] })
    assert.equal(bad.props.href, '#')
  })

  it('MdImg 固定 no-referrer 且 alt 缺省空串', () => {
    const n = md.MdImg({ src: 'https://i.a/b.png' })
    assert.equal(n.type, 'img')
    assert.equal(n.props.src, 'https://i.a/b.png')
    assert.equal(n.props.alt, '')
    assert.equal(n.props.referrerPolicy, 'no-referrer')
  })

  it('行内：code/粗体/斜体/删除线', () => {
    const [p] = md.renderMarkdown('a `c` **b** *i* ~~d~~')
    assert.equal(p.type, 'p')
    assert.equal(p.children.length, 8)
    assert.equal(p.children[0], 'a ')
    assert.equal(p.children[1].type, 'code')
    assert.deepEqual(p.children[1].children, ['c'])
    assert.equal(p.children[3].type, 'strong')
    assert.equal(p.children[5].type, 'em')
    assert.equal(p.children[7].type, 'del')
  })

  it('链接/图片/徽章链接/自动链接/裸 URL', () => {
    const link = md.renderMarkdown('[t](https://a.com)')
    assert.equal(link[0].children[0].type, 'a')
    assert.equal(link[0].children[0].props.href, 'https://a.com')
    assert.deepEqual(link[0].children[0].children, ['t'])

    const img = md.renderMarkdown('![alt](https://i.a/b.png)')
    assert.equal(img[0].children[0].type, 'img')
    assert.equal(img[0].children[0].props.alt, 'alt')

    const badge = md.renderMarkdown('[![a](https://i.a/b.png)](https://x.y)')
    assert.equal(badge[0].children[0].type, 'a')
    assert.equal(badge[0].children[0].props.href, 'https://x.y')
    assert.equal(badge[0].children[0].children[0].type, 'img')

    const auto = md.renderMarkdown('<https://a.com>')
    assert.equal(auto[0].children[0].type, 'a')
    assert.equal(auto[0].children[0].props.href, 'https://a.com')

    const bare = md.renderMarkdown('see https://a.com/x end')
    assert.equal(bare[0].children[0], 'see ')
    assert.equal(bare[0].children[1].type, 'a')
    assert.equal(bare[0].children[1].props.href, 'https://a.com/x')
    assert.deepEqual(bare[0].children[2], ' end')
  })

  it('块级：围栏代码/标题/分隔线/引用/列表/表格/段落合并', () => {
    const fence = md.renderMarkdown('```\ncode\n```')
    assert.equal(fence[0].type, 'pre')
    assert.equal(fence[0].children[0].type, 'code')
    assert.deepEqual(fence[0].children[0].children, ['code'])

    const open = md.renderMarkdown('```\ncode')
    assert.deepEqual(open[0].children[0].children, ['code'])

    const head = md.renderMarkdown('## T')
    assert.equal(head[0].type, 'h2')
    assert.deepEqual(head[0].children, ['T'])

    assert.equal(md.renderMarkdown('---')[0].type, 'hr')

    const quote = md.renderMarkdown('> q1\n> q2')
    assert.equal(quote[0].type, 'blockquote')
    assert.equal(quote[0].children[0].type, 'p')
    assert.deepEqual(quote[0].children[0].children, ['q1 q2'])

    const ul = md.renderMarkdown('- a\n- b')
    assert.equal(ul[0].type, 'ul')
    assert.equal(ul[0].children.length, 2)
    assert.equal(ul[0].children[0].type, 'li')

    const ol = md.renderMarkdown('1. x\n2. y')
    assert.equal(ol[0].type, 'ol')
    assert.equal(ol[0].children.length, 2)

    const table = md.renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
    assert.equal(table[0].type, 'table')
    assert.equal(table[0].children[0].type, 'thead')
    assert.equal(table[0].children[0].children[0].children[0].children[0], 'a')
    assert.equal(table[0].children[1].type, 'tbody')
    assert.equal(table[0].children[1].children[0].children[1].children[0], '2')

    const para = md.renderMarkdown('x\ny')
    assert.deepEqual(para[0].children, ['x y'])
  })

  it('空输入与 CRLF 归一', () => {
    assert.deepEqual(md.renderMarkdown(''), [])
    const crlf = md.renderMarkdown('a\r\nb')
    assert.deepEqual(crlf[0].children, ['a b'])
  })
})
```

- [ ] Step 2: 运行并确认失败
  - Run: `node --test tests/client-markdown.test.mjs`
  - Expected: 模块加载失败（`Cannot find module .../src/client/markdown.js`），测试全红。
- [ ] Step 3: 写最小实现 `src/client/markdown.js`：新建文件，模块头注释（说明 h 注入与逐字搬迁），然后**从 main.jsx 391-556 逐字剪切**以下符号（函数体一个字符都不改）：
  - `safeUrl`（391-396）→ 顶层 `export function safeUrl(u)`；
  - `ExtLink`（399-411）、`MdImg`（413-423）、`mdInline`（426-468）、`mdBlocks`（471-552）、`renderMarkdown`（554-556，body 为 `return mdBlocks(String(src || "").replace(/\r\n?/g, "\n").split("\n"), "md");`）→ 全部放进 `createMarkdown(h)` 闭包内，`mdInline`/`mdBlocks` 保持私有，工厂返回 `{ ExtLink, MdImg, renderMarkdown }`：

```js
export function createMarkdown(h) {
  // ↓ 以下 5 个函数自 main.jsx 391-556 逐字迁入，禁止任何行为改动
  function ExtLink({ href, className, children }) { /* 逐字 */ }
  function MdImg({ src, alt }) { /* 逐字 */ }
  function mdInline(text, kb) { /* 逐字 */ }
  function mdBlocks(lines, kb) { /* 逐字 */ }
  function renderMarkdown(src) { /* 逐字 */ }
  return { ExtLink, MdImg, renderMarkdown };
}
```

  - Change: 新建 markdown.js；迁移后 main.jsx 此时尚未接线（旧定义仍在，等价双份暂存，Task 2 删旧）。
- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-markdown.test.mjs`
  - Expected: 全部 pass（0 fail）。
- [ ] Step 5: 无 commit（批次边界在 Task 2 统一提交）。

### Task 2: main.jsx 接线 markdown.js（删旧 + 批次 1 验收）

- 目标：main.jsx 改为消费 markdown.js，删除旧定义，批次 1 验收。
- 涉及文件：Modify `src/client/main.jsx`（锚点：第 14 行 require 区、391-556 定义区）
- 接口契约：
  - Consumes: Task 1 的 `safeUrl`/`createMarkdown`；main.jsx 顶部 `const h = React.createElement`（第 7 行，require 必须位于其后）。
  - Produces: main.jsx 内可用 `ExtLink`/`MdImg`/`renderMarkdown`（消费点 573、756-757、851 调用点零改动）。
- 验证范围：`npm test` + `npm run build` + grep 断言

- [ ] Step 1: 接线。在第 14 行 market-state require 之后加：

```js
const { createMarkdown } = require("./markdown.js");
const { ExtLink, MdImg, renderMarkdown } = createMarkdown(h);
```

  然后删除 main.jsx 390-556 的旧定义（390 行「极简 Markdown 渲染」段注释 + safeUrl/ExtLink/MdImg/mdInline/mdBlocks/renderMarkdown 及其上方注释行 398/425/470；558 行起的「详情」官方外链注释保留）。
- [ ] Step 2: 验证
  - Run: `grep -n "function safeUrl\|function ExtLink\|function MdImg\|function mdInline\|function mdBlocks\|function renderMarkdown" src/client/main.jsx`
  - Expected: 无输出（旧定义已删净）。
  - Run: `npm test`
  - Expected: 290 pass 基线 + client-markdown 新测试全过，0 fail（main.jsx 不被任何测试 import，全量绿证明无意外破坏）。
  - Run: `npm run build`
  - Expected: `[dsh-m] build ok`，5 个 marker 检查通过（MarketPanel/InstalledTab/SettingsTab/RestartBanner/dshm-overlay 均留守）。
- [ ] Step 3: checkpoint commit
  - Run: `git add src/client/markdown.js tests/client-markdown.test.mjs src/client/main.jsx && git commit -m "refactor(client): markdown 渲染迁出 main.jsx——safeUrl 闸门+解析器 Node 直测（零行为变化）"`
  - Expected: commit 成功。

### Task 3: installed-view.js 模块 + 测试（先红后绿）

- 目标：已装页视图模型 key 化迁出，消灭 937/950 两处逐字重复的 spec 解析（收益为客户端内部两处→一处 + 可测，非跨端文法收敛）。
- 涉及文件：Create `src/client/installed-view.js`、`tests/client-installed-view.test.mjs`
- 接口契约：
  - Consumes: main.jsx 857-868（uninstallGuard）、937/950（spec 解析）、940/959（latest 标签）、946（source map）、1001-1016（regSourceLabel）的现行为。
  - Produces: `installedViewModel(it)`、`registrySourceKey(data)`（Task 4 消费）。
- 验证范围：`node --test tests/client-installed-view.test.mjs`

- [ ] Step 1: 写测试文件 `tests/client-installed-view.test.mjs`：

```js
/**
 * 已装页 pure view：InstalledItem → 视图模型（i18n key + 参数，不产出成品文案）。
 * lookup 留在 main.jsx 调用方（照 market-state.js registryNotice 先例）。
 * 运行：node --test tests/client-installed-view.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { installedViewModel, registrySourceKey } from '../src/client/installed-view.js'

describe('installedViewModel', () => {
  it('githubRepo 优先级：registryGithub > githubRepo > spec 抽取 > null', () => {
    assert.equal(installedViewModel({ registryGithub: 'o/r', githubRepo: 'o2/r2', spec: 'github:x/y#s' }).githubRepo, 'o/r')
    assert.equal(installedViewModel({ githubRepo: 'o2/r2', spec: 'github:x/y#s' }).githubRepo, 'o2/r2')
    assert.equal(installedViewModel({ spec: 'github:x/y#abc123' }).githubRepo, 'x/y')
    assert.equal(installedViewModel({ spec: 'github:x/y' }).githubRepo, 'x/y')
    assert.equal(installedViewModel({ spec: 'npm:x' }).githubRepo, null)
  })

  it('sourceLabelKey：五类白名单，未知来源归 null（调用方回退原始字符串）', () => {
    assert.equal(installedViewModel({ source: 'npm', spec: 'npm:x' }).sourceLabelKey, 'src.npm')
    assert.equal(installedViewModel({ source: 'github', spec: 'npm:x' }).sourceLabelKey, 'src.github')
    assert.equal(installedViewModel({ source: 'link', spec: 'npm:x' }).sourceLabelKey, 'src.link')
    assert.equal(installedViewModel({ source: 'file', spec: 'npm:x' }).sourceLabelKey, 'src.file')
    assert.equal(installedViewModel({ source: 'unknown', spec: 'npm:x' }).sourceLabelKey, 'src.unknown')
    assert.equal(installedViewModel({ source: 'weird', spec: 'npm:x' }).sourceLabelKey, null)
  })

  it('guard：link 带 path 参数，file 无参 warn，其余仅 confirm（key 化，不渲染文案）', () => {
    assert.deepEqual(
      installedViewModel({ source: 'link', path: '/x/y', spec: 'npm:x' }).guard,
      { confirmKey: 'confirm.unlink', warnKey: 'warn.unlink', warnParams: { path: '/x/y' } },
    )
    assert.deepEqual(
      installedViewModel({ source: 'file', spec: 'npm:x' }).guard,
      { confirmKey: 'confirm.core', warnKey: 'warn.core', warnParams: {} },
    )
    assert.deepEqual(
      installedViewModel({ source: 'npm', spec: 'npm:x' }).guard,
      { confirmKey: 'confirm.uninstall', warnKey: null, warnParams: {} },
    )
  })

  it('latestLabel：tag 优先，其次 v{version}；徽标空串与详情 — 两种 fallback', () => {
    assert.equal(installedViewModel({ latestTag: 'v2', latestVersion: '1.0.0', spec: 'npm:x' }).latestLabel, 'v2')
    assert.equal(installedViewModel({ latestVersion: '1.2.3', spec: 'npm:x' }).latestLabel, 'v1.2.3')
    assert.equal(installedViewModel({ spec: 'npm:x' }).latestLabel, '')
    assert.equal(installedViewModel({ spec: 'npm:x' }).latestLabelDetail, '—')
    assert.equal(installedViewModel({ latestTag: 'v2', spec: 'npm:x' }).latestLabelDetail, 'v2')
  })

  it('缺 spec 抛 TypeError（现状钉死：急切求值不加固，与模块注释一致）', () => {
    assert.throws(() => installedViewModel({ source: 'npm' }), TypeError)
  })

  it('输出不含成品文案：所有 *Key 值都是 i18n key 形状', () => {
    const vm = installedViewModel({ source: 'link', path: '/home/u/x', spec: 'github:o/r' })
    const s = JSON.stringify(vm)
    assert.ok(!s.includes('已安装') && !s.includes('卸载'))
  })
})

describe('registrySourceKey', () => {
  it('官方/自定义/旧字段 → i18n key；无数据 null；未知 source 原样返回', () => {
    assert.equal(registrySourceKey(null), null)
    assert.equal(registrySourceKey({ source: 'default-raw' }), 'src.default.raw')
    assert.equal(registrySourceKey({ source: 'default-jsdelivr' }), 'src.default.jsdelivr')
    assert.equal(registrySourceKey({ source: 'default-cache' }), 'src.default.cache')
    assert.equal(registrySourceKey({ source: 'bundled' }), 'src.bundled')
    assert.equal(registrySourceKey({ source: 'custom-url' }), 'src.custom.url')
    assert.equal(registrySourceKey({ source: 'custom-file' }), 'src.custom.file')
    assert.equal(registrySourceKey({ source: 'custom-cache' }), 'src.custom.cache')
    assert.equal(registrySourceKey({ source: 'custom-unavailable' }), 'src.custom.unavailable')
    assert.equal(registrySourceKey({ source: 'override' }), 'src.override')
    assert.equal(registrySourceKey({ source: 'jsdelivr' }), 'src.jsdelivr')
    assert.equal(registrySourceKey({ source: 'raw' }), 'src.raw')
    assert.equal(registrySourceKey({ source: 'cache' }), 'src.cache')
    assert.equal(registrySourceKey({ source: 'brand-new' }), 'brand-new')
  })
})
```

- [ ] Step 2: 运行并确认失败
  - Run: `node --test tests/client-installed-view.test.mjs`
  - Expected: `Cannot find module .../src/client/installed-view.js`，全红。
- [ ] Step 3: 写最小实现 `src/client/installed-view.js`：

```js
/**
 * 已装页 pure view（DESIGN.md §4）：InstalledItem → 视图模型。
 * 只产出 i18n key + 参数，不产出成品文案；lookup 留在 main.jsx 调用方。
 * 不依赖 DOM/React/lookup，Node tests 直接 import。
 * 注意：githubRepo/latestLabel 与 main.jsx 937/950/940/959 现行为逐字一致——
 * it.spec 缺失会抛 TypeError（现状如此，本次不加固）。
 */

/** 卸载护栏 key 化（原 uninstallGuard 857-868：confirm/warn 文案改 key+参数）。 */
function uninstallGuardKeys(it) {
  if (it.source === "link") {
    return { confirmKey: "confirm.unlink", warnKey: "warn.unlink", warnParams: { path: it.path } };
  }
  if (it.source === "file") {
    return { confirmKey: "confirm.core", warnKey: "warn.core", warnParams: {} };
  }
  return { confirmKey: "confirm.uninstall", warnKey: null, warnParams: {} };
}

/** 已装卡片视图模型：一次计算，卡片内多处消费（Icon 937 / 徽标 940 / 来源 946 / LinksRow 950 / 详情 959）。 */
export function installedViewModel(it) {
  return {
    githubRepo: it.registryGithub || it.githubRepo || (it.spec.startsWith("github:") ? it.spec.slice(7).split("#")[0] : null),
    sourceLabelKey: { npm: "src.npm", github: "src.github", link: "src.link", file: "src.file", unknown: "src.unknown" }[it.source] || null,
    guard: uninstallGuardKeys(it),
    latestLabel: it.latestTag || (it.latestVersion ? `v${it.latestVersion}` : ""),
    latestLabelDetail: it.latestTag || (it.latestVersion ? `v${it.latestVersion}` : "—"),
  };
}

/** registryState.source → i18n key（含旧字段兼容，原 regSourceLabel 1001-1016 的 map）；无数据 null（调用方显示 '—'）；未知 source 原样返回（调用方仍 lookup，与现行为一致）。 */
export function registrySourceKey(data) {
  if (!data) return null;
  const map = {
    "default-raw": "src.default.raw",
    "default-jsdelivr": "src.default.jsdelivr",
    "default-cache": "src.default.cache",
    bundled: "src.bundled",
    "custom-url": "src.custom.url",
    "custom-file": "src.custom.file",
    "custom-cache": "src.custom.cache",
    "custom-unavailable": "src.custom.unavailable",
    // 旧字段兼容
    override: "src.override", jsdelivr: "src.jsdelivr", raw: "src.raw", cache: "src.cache",
  };
  return map[data.source] || data.source;
}
```

- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-installed-view.test.mjs`
  - Expected: 全部 pass（0 fail）。
- [ ] Step 5: 无 commit（批次边界在 Task 4 统一提交）。

### Task 4: main.jsx 接线 installed-view.js（删旧 + 批次 2 验收）

- 目标：InstalledTab/SettingsTab 消费视图模型，删除旧定义，批次 2 验收。
- 涉及文件：Modify `src/client/main.jsx`（锚点：第 14 行 require 区、items.map 933-995、uninstallGuard 857-868、regSourceLabel 1001-1016）
- 接口契约：
  - Consumes: Task 3 的 `installedViewModel`/`registrySourceKey`；main.jsx 现有 `lookup`。
  - Produces: 无（叶子任务）。
- 验证范围：`npm test` + `npm run build` + grep 断言

- [ ] Step 1: 接线（六处等价替换）。
  1. 第 14 行 require 区加：`const { installedViewModel, registrySourceKey } = require("./installed-view.js");`
  2. items.map 回调（933-995）开头加一行 `const vm = installedViewModel(it);`，然后：
     - 934 `const guard = uninstallGuard(it);` → 删除，后续 `guard.*` 改 `vm.guard.*`；
     - 962 `guard.warn ? ...` → `vm.guard.warnKey ? [lookup("detail.note"), lookup(vm.guard.warnKey, vm.guard.warnParams)] : null`；
     - 937 Icon entry 的 github 字段 → `vm.githubRepo`；950 `github:` 字段 → `vm.githubRepo`；
     - 940 徽标 latest 表达式 → `` `⬆ ${vm.latestLabel}`.trim() ``（外层 trim 保留）；
     - 946 来源表达式 → `vm.sourceLabelKey ? lookup(vm.sourceLabelKey) : it.source`；
     - 959 详情 latest 表达式 → `vm.latestLabelDetail`；
     - 988 `confirmLabel: guard.confirm` → `confirmLabel: lookup(vm.guard.confirmKey)`（`interpolate` 对 `{}`/无参均安全，已核实）。
  3. 删除 `uninstallGuard`（857-868，含上方注释 856）。
  4. `regSourceLabel`（1001-1016）函数体替换为 key 化薄壳（调用点 1165 零改动）：

```js
function regSourceLabel(data) {
  const key = registrySourceKey(data);
  return key === null ? "—" : lookup(key);
}
```

- [ ] Step 2: 验证
  - Run: `grep -n "uninstallGuard\b\|function regSourceLabel\|spec.startsWith\|registryGithub || it.githubRepo" src/client/main.jsx`
  - Expected: 仅 1 行 `function regSourceLabel` 薄壳定义（1165 调用点不匹配该 pattern，属预期）；无 `uninstallGuard`、无 `spec.startsWith`、无 `registryGithub || it.githubRepo` 内联表达式。
  - Run: `npm test`
  - Expected: 基线 + client-markdown + client-installed-view 全过，0 fail。
  - Run: `npm run build`
  - Expected: `[dsh-m] build ok`，marker 检查通过。
- [ ] Step 3: checkpoint commit
  - Run: `git add src/client/installed-view.js tests/client-installed-view.test.mjs src/client/main.jsx && git commit -m "refactor(client): 已装页视图模型 key 化迁出——installed-view 纯模块+测试（零行为变化）"`
  - Expected: commit 成功。

### Task 5: tool-view.js 模块 + 测试（先红后绿）

- 目标：`pickPayload`/`parseToolArgs` 迁出为纯模块并钉死解析行为（含静默失败的边界）。
- 涉及文件：Create `src/client/tool-view.js`、`tests/client-tool-view.test.mjs`
- 接口契约：
  - Consumes: main.jsx 1445-1483 现行为（逐字搬迁源）。
  - Produces: `pickPayload(props)`、`parseToolArgs(props)`（Task 6 消费）。
- 验证范围：`node --test tests/client-tool-view.test.mjs`

- [ ] Step 1: 写测试文件 `tests/client-tool-view.test.mjs`：

```js
/**
 * 工具视图 payload 解析 pure 逻辑：depth-6 启发式抓取 + argsRaw 容错解析。
 * 运行：node --test tests/client-tool-view.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { pickPayload, parseToolArgs } from '../src/client/tool-view.js'

describe('pickPayload', () => {
  it('沿已知 key 深挖，返回首个含 items 数组的节点', () => {
    assert.deepEqual(pickPayload({ meta: { result: { items: [1, 2] } } }), { items: [1, 2] })
    assert.deepEqual(pickPayload({ content: '{"items":[3]}' }), { items: [3] })
    assert.deepEqual(pickPayload([{ items: ['x'] }]), { items: ['x'] })
  })
  it('深度上限 6（白名单 key 计层）：第 6 层可命中，第 7 层弃抓', () => {
    const d6 = { meta: { meta: { meta: { meta: { meta: { meta: { items: [1] } } } } } } } // meta×6 → items 节点在第 6 层
    assert.deepEqual(pickPayload(d6), { items: [1] })
    const d7 = { meta: { meta: { meta: { meta: { meta: { meta: { meta: { items: [1] } } } } } } } } // meta×7 → 第 7 层，depth > 6 弃抓
    assert.equal(pickPayload(d7), null)
  })
  it('短字符串/非 JSON/无 items 一律 null（静默失败现行为）', () => {
    assert.equal(pickPayload({}), null)
    assert.equal(pickPayload({ block: { argsRaw: '{}' } }), null)
    assert.equal(pickPayload({ content: '{short' }), null)
    assert.equal(pickPayload({ content: 'plain text' }), null)
  })
})

describe('parseToolArgs', () => {
  it('block.argsRaw 为 JSON 时解析；kind 存在时改读 call.argsRaw', () => {
    assert.deepEqual(parseToolArgs({ block: { argsRaw: '{"id":"a"}' } }), { id: 'a' })
    assert.deepEqual(parseToolArgs({ block: { kind: 'x', call: { argsRaw: '{"id":"b"}' } } }), { id: 'b' })
    assert.deepEqual(parseToolArgs({ block: { kind: 'x', argsRaw: '{"ignored":1}' } }), {})
  })
  it('缺失/非字符串/非 JSON 一律 {}（静默失败现行为）', () => {
    assert.deepEqual(parseToolArgs({}), {})
    assert.deepEqual(parseToolArgs({ block: {} }), {})
    assert.deepEqual(parseToolArgs({ block: { argsRaw: 'not json' } }), {})
    assert.deepEqual(parseToolArgs({ block: { argsRaw: 42 } }), {})
  })
})
```

- [ ] Step 2: 运行并确认失败
  - Run: `node --test tests/client-tool-view.test.mjs`
  - Expected: `Cannot find module .../src/client/tool-view.js`，全红。
- [ ] Step 3: 写最小实现 `src/client/tool-view.js`：**从 main.jsx 1445-1483 逐字剪切** `pickPayload`（1445-1471）与 `parseToolArgs`（1473-1483）函数体，各加 `export` 前缀，文件头加模块注释（说明 depth-6 启发式与静默失败语义），其余零改动。
- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-tool-view.test.mjs`
  - Expected: 全部 pass（0 fail）。
- [ ] Step 5: 无 commit（批次边界在 Task 6 统一提交）。

### Task 6: main.jsx 接线 tool-view.js（删旧 + 批次 3a 验收）

- 目标：SearchToolView/ListToolView 消费 tool-view.js，删除旧定义。
- 涉及文件：Modify `src/client/main.jsx`（锚点：第 14 行 require 区、1445-1483 定义区）
- 接口契约：
  - Consumes: Task 5 的 `pickPayload`/`parseToolArgs`。
  - Produces: 无（叶子任务）。
- 验证范围：`npm test` + `npm run build` + grep 断言

- [ ] Step 1: 第 14 行 require 区加：`const { pickPayload, parseToolArgs } = require("./tool-view.js");`；删除 `pickPayload`/`parseToolArgs` 旧定义（基线行号 1445-1483，前序任务删除后已漂移，以符号名定位）。调用点 `pickPayload(props)`/`parseToolArgs(props)`（基线 1529/1530/1573）零改动。
- [ ] Step 2: 验证
  - Run: `grep -n "function pickPayload\|function parseToolArgs" src/client/main.jsx`
  - Expected: 无输出。
  - Run: `npm test && npm run build`
  - Expected: 全量 0 fail；`[dsh-m] build ok`。
- [ ] Step 3: checkpoint commit
  - Run: `git add src/client/tool-view.js tests/client-tool-view.test.mjs src/client/main.jsx && git commit -m "refactor(client): 工具卡片 payload 解析迁出 tool-view 纯模块（零行为变化）"`
  - Expected: commit 成功。

### Task 7: restart-wait.js 模块 + 测试（先红后绿）

- 目标：重启等待纯决策迁出，用测试钉死「同一轮迭代内超时优先于 boot 变化」的边界语义。
- 涉及文件：Create `src/client/restart-wait.js`、`tests/client-restart-wait.test.mjs`
- 接口契约：
  - Consumes: main.jsx RestartBanner.restart 608-632 的轮询决策现行为。
  - Produces: `RESTART_POLL_MS`、`RESTART_DEADLINE_MS`、`nextRestartWait({ phase, now, deadlineAt, bootChanged })`（Task 8 消费）。
- 验证范围：`node --test tests/client-restart-wait.test.mjs`

- [ ] Step 1: 写测试文件 `tests/client-restart-wait.test.mjs`：

```js
/**
 * 重启等待 pure 决策：钉死现行实现（RestartBanner.restart）的时序语义——
 * deadline 只在 before-ping 检查且优先于 boot 变化；after-ping 只产 done/continue。
 * 运行：node --test tests/client-restart-wait.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { RESTART_POLL_MS, RESTART_DEADLINE_MS, nextRestartWait } from '../src/client/restart-wait.js'

describe('常量（与现行字面量一致）', () => {
  it('轮询 2s、deadline 90s', () => {
    assert.equal(RESTART_POLL_MS, 2_000)
    assert.equal(RESTART_DEADLINE_MS, 90_000)
  })
})

describe('nextRestartWait', () => {
  it('before-ping：过 deadline 即 timeout——即使上一轮 boot 已变（超时优先，边界语义钉死）', () => {
    assert.equal(nextRestartWait({ phase: 'before-ping', now: 100, deadlineAt: 90, bootChanged: true }), 'timeout')
  })
  it('before-ping：deadline 内 continue（含恰好等于 deadline 的边界）', () => {
    assert.equal(nextRestartWait({ phase: 'before-ping', now: 90, deadlineAt: 90 }), 'continue')
    assert.equal(nextRestartWait({ phase: 'before-ping', now: 50, deadlineAt: 90 }), 'continue')
  })
  it('after-ping：boot 已变 done，未变 continue；deadline 已过也不产 timeout（deadline 只在 before-ping 查）', () => {
    assert.equal(nextRestartWait({ phase: 'after-ping', bootChanged: true }), 'done')
    assert.equal(nextRestartWait({ phase: 'after-ping', bootChanged: false }), 'continue')
    assert.equal(nextRestartWait({ phase: 'after-ping', bootChanged: false, now: 999, deadlineAt: 90 }), 'continue')
  })
  it('bootChanged 缺省 false', () => {
    assert.equal(nextRestartWait({ phase: 'after-ping' }), 'continue')
  })
})
```

- [ ] Step 2: 运行并确认失败
  - Run: `node --test tests/client-restart-wait.test.mjs`
  - Expected: `Cannot find module .../src/client/restart-wait.js`，全红。
- [ ] Step 3: 写最小实现 `src/client/restart-wait.js`：

```js
/**
 * 重启等待 pure 决策（DESIGN.md §3.2 一键重启）：把 RestartBanner.restart 轮询里的
 * 两个判定点显式化。phase='before-ping' 对应「sleep 后、ping 前」的 deadline 检查
 * （现行实现：超时先于 boot 判定抛出）；phase='after-ping' 对应「ping 成功后」的
 * boot 比对（现行实现：立即 break，deadline 不参与）。时序语义由此测试钉死。
 */

export const RESTART_POLL_MS = 2_000;
export const RESTART_DEADLINE_MS = 90_000;

export function nextRestartWait({ phase, now = 0, deadlineAt = Infinity, bootChanged = false }) {
  if (phase === "before-ping") {
    return now > deadlineAt ? "timeout" : "continue";
  }
  return bootChanged ? "done" : "continue";
}
```

- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-restart-wait.test.mjs`
  - Expected: 全部 pass（0 fail）。
- [ ] Step 5: 无 commit（批次边界在 Task 8 统一提交）。

### Task 8: main.jsx 接线 restart-wait.js + 最终验证（批次 3b 验收）

- 目标：RestartBanner 消费纯决策与常量，全计划收口验证。
- 涉及文件：Modify `src/client/main.jsx`（锚点：第 14 行 require 区、RestartBanner.restart 608-632）
- 接口契约：
  - Consumes: Task 7 的 `RESTART_POLL_MS`/`RESTART_DEADLINE_MS`/`nextRestartWait`；main.jsx 现有 `api`/`lookup`。
  - Produces: 无（收口任务）。
- 验证范围：`npm test` + `npm run build` + `npm run typecheck` + grep 断言

- [ ] Step 1: 接线。第 14 行 require 区加：`const { RESTART_POLL_MS, RESTART_DEADLINE_MS, nextRestartWait } = require("./restart-wait.js");`。`restart` 回调（608-632）等价替换为：

```js
  const restart = useCallback(async () => {
    setErr(null);
    setPhase("restarting");
    try {
      const ping0 = await api("ping");
      await api("restart");
      setPhase("waiting");
      const deadlineAt = Date.now() + RESTART_DEADLINE_MS;
      for (;;) {
        await new Promise((r) => setTimeout(r, RESTART_POLL_MS));
        if (nextRestartWait({ phase: "before-ping", now: Date.now(), deadlineAt }) === "timeout") {
          throw new Error(lookup("restart.timeout"));
        }
        let bootChanged = false;
        try {
          const ping = await api("ping");
          bootChanged = ping.boot !== ping0.boot;
        } catch {
          /* 服务重启中，继续轮询 */
        }
        if (nextRestartWait({ phase: "after-ping", bootChanged }) === "done") break;
      }
      setPhase("idle");
      onDone(true);
    } catch (e) {
      setPhase("idle");
      setErr(String((e && e.message) || e));
    }
  }, [onDone]);
```

- [ ] Step 2: 验证
  - Run: `grep -n "90_000\|90,000\|setTimeout(r, 2000)" src/client/main.jsx`
  - Expected: 无输出（字面量已收敛为常量）。
  - Run: `npm test`
  - Expected: 全量通过：基线 290 + 四个新测试文件全部 pass，0 fail。
  - Run: `npm run build`
  - Expected: `[dsh-m] build ok`，5 个 marker 全过。
  - Run: `npm run typecheck`
  - Expected: 无输出退出码 0（tsconfig 只含 `src/**/*.ts`，client JS 不参与，此步为回归守卫）。
- [ ] Step 3: checkpoint commit
  - Run: `git add src/client/restart-wait.js tests/client-restart-wait.test.mjs src/client/main.jsx && git commit -m "refactor(client): 重启等待决策迁出 restart-wait 纯模块并钉死边界语义（零行为变化）"`
  - Expected: commit 成功。

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行（Task 1→8 批次串行），不无声跳步、不合并步、不改任务目标。
- 批次边界：批次 1 = Task 1-2，批次 2 = Task 3-4，批次 3 = Task 5-8。批次 3 是评审批次 3 顺手项，若执行前被砍掉，批次 1-2 仍完整可交付、可单独收口（此时最终验证去掉 tool-view/restart-wait 相关断言）。
- 本文行号均为基线 main@0f6ce6a 读数；Task 2/4 删除代码后，后续任务（Task 5-8）的行号必然漂移，一律以符号名定位（`pickPayload`/`parseToolArgs`/`RestartBanner` 等），行号仅作背景参考。
- 每完成一个任务立即运行该任务定义的验证；验证不过不进下一任务。
- 「逐字搬迁」的符号：迁移后逐一与 git 历史版本 diff 确认零改动（`git show HEAD:src/client/main.jsx` 提取对照）。
- 遇到阻塞、重复失败或计划与仓库现实不符（如行号漂移导致锚点找不到），立即停下说明，不猜。
- 当前在 `main`：本计划获批即视为同意按仓库惯例直提 main（每批次一个 checkpoint commit）。

## 最终验证

- Run: `npm test`
  - Expected: 全量 pass（基线 290 + 新增 4 个测试文件），0 fail。
- Run: `npm run build`
  - Expected: `[dsh-m] build ok: lib/host.js + lib/client.js`，marker 检查通过。
- Run: `npm run typecheck`
  - Expected: 退出码 0。
- Run: `git log --oneline -4`
  - Expected: 4 个批次 checkpoint commit。
- Run: `grep -c "require(\"./market-state.js\")\|require(\"./markdown.js\")\|require(\"./installed-view.js\")\|require(\"./tool-view.js\")\|require(\"./restart-wait.js\")" src/client/main.jsx`
  - Expected: 5（market-state 原有 + 新增 4）。

## 审阅 Checkpoint

- 计划正文到此结束。请先审阅本计划；批准后才进入实现，默认执行方为普通编码 agent 或人工执行者。
