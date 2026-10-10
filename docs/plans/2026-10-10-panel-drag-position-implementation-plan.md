# 还原态面板头部拖拽与位置记忆 实施计划

## 目标

- dsh-m 市场面板（`.dshm-panel`）在**还原态**下，按住头部（`.dshm-head`，即用户截图蓝框）可自由拖拽，释放后位置记忆、下次打开还原。
- 四条验收：① 头部现有菜单（tab / 全屏 / 关闭 / chips）点击行为零影响；② 拖拽跟手（rAF + compositor transform，不触发 React 重渲）；③ 全屏态禁止拖拽；④ 运动范围 = 浏览器视口内 8px 边距，desktop profile 额外让出顶部系统拖拽带（quota-watch titlebar 契约：0.1.20 引入、0.1.24 核对）。
- 拖拽期间面板**强制实心**（计算值固化），玻璃皮肤（openbmc / uefi 等 bg-base 带 α 的皮肤）下不透光，且性能不降。

## 架构快照

- 纯逻辑与 DOM 接线分离（复刻 `dsh-quota-watch` 的 `prefs.mjs`/`drag.mjs` ↔ `client.mjs` 分层）：新模块 `src/client/window-drag.js` 只放可单测的纯函数与存取；`main.jsx` 内 `MarketPanel` 用 `useEffect` 挂 pointerdown、手势期才挂 document 级 move/up/cancel。
- 位置模型：无记录 → 保持现有 flex 居中（渲染路径与现状逐字节一致）；有记录 → 面板加 `.abs`（`position:absolute` + left/top，overlay 是 inset:0 的 fixed，绝对定位坐标 = 视口坐标）。拖拽中 pointermove 只更新 lastPoint 并调度 rAF 帧回调，`transform: translate3d` 的写操作集中在帧内执行（写合帧，不逐事件同步写；帧回调守卫拦截过期帧），释放一次性烘焙为 left/top + localStorage 持久化，随后 `setPos` 让 React 收口一次——**拖拽帧绝不走 React state**。
- clamp 公式：`clampPoint` 四周 `PANEL_MARGIN=8`，top 额外叠加 `titlebarTopInset`（读 `<html>` 的 `data-windows-titlebar` + `--dsh-windows-titlebar-height`，`data-fullscreen` 时清零；web/无变量 = 0，公式与 quota-watch 契约逐字对齐——契约自 0.1.20 引入、参照核对于 0.1.24）。
- 皮肤免疫：手势开始时读 `getComputedStyle(panel).backgroundColor`（引擎已解析皮肤变量与 color-mix 的最终 rgba），**强制 α=1** 写入内联 `--dshm-drag-bg`；`.dshm-panel--dragging` 用 `!important` 自持 `background` 并关闭 blur（每帧最贵的合成操作）。拖拽中 transform ≠ none 维持包含块，blur 关闭无 fixed 后代逃逸风险。静止态玻璃（86% + blur）完全不动。
- 全屏联动：`full` 态 pointerdown 直接不启动拖拽；双击头部非按钮区切换全屏（还原态→全屏、全屏→还原均可）；还原→全屏→还原位置不丢，还原渲染后 layout effect 内重夹紧。

## 全局约束

- 术语遵循 `dsh-m/GLOSSARY.md`（本批次已定稿）：**还原态 / 拖拽手柄 / 位置记忆**；注释与文档用这三个词，不再出现「normal 化」。
- 性能红线：拖拽帧禁止 React state；样式写集中在 rAF 帧回调内（pointermove 只更新 lastPoint + 调度，不逐事件写样式）+ `translate3d` + 手势期 `will-change:transform`；document 级监听仅手势期存在，静止零监听。（评审 R2-1：不声明「同帧合并/每帧一次读写」——无去重机制，与 quota-watch 同款为「帧内写」语义。）
- `!important` 清单纪律：main.jsx 内 `!important` 总数由 `tests/client-lightbox.test.mjs` 定长断言把守（现为 4；计数正则对**注释提及同样生效**）。本次新增 = 规则 3 处（`background` + 两个 `backdrop-filter`）+ 注释 0 处（新注释措辞刻意不含该字面量，评审 R1-2）→ 断言改 7 并显式登记。
- 桌面 titlebar 契约逐字对齐 quota-watch（`titlebarTopInset`）：`titlebar && !fullscreen && height>0` 才非 0；不判 DSH 版本号，只认属性存在性。契约自 quota-watch 0.1.20 引入，参照核对基于其在库版本 0.1.24——版本标签只作溯源不作对齐依据（评审 R1-9）。
- 0.9.27 防拖拽误关守卫（`backdropCloseHandlers`）语义不破坏：pointer capture 使拖拽释放的 click 重定向到头部，守卫路径不触发；另加 `suppressNextClick` 双保险。
- 无位置记忆时首开渲染与现状逐字节一致（flex 居中、无 `.abs`、无内联 style）。
- 文案双语规则：i18n 走 zh/en 双表（`lookup`），CHANGELOG 中英双区块各补一条目。
- 版本：本次发版号 **0.9.69**（0.9.68 已被 ADR-0016 合并市场物化占用并发布；计划初稿按未发布的 0.9.68 编写，评审 R1-1 修正）。
- 环境：bash + Node；所有命令在 `dsh-m/` 仓库根执行；`npm test` = `pretest(build) + node --test tests/*.test.mjs`。

## 输入工件

- 设计共识：本会话 `/grill-with-docs` 三轮问答记录（Q1–Q9 全部按推荐锁定，Q9 修订为「计算值固化强制实心」）。
- 术语定稿：`dsh-m/GLOSSARY.md`（还原态 / 拖拽手柄 / 位置记忆 三词条已落）。
- 参考实现（只读）：`dsh-quota-watch/src/client/prefs.mjs`（clampPoint / titlebarTopInset / loadFloatPosition）、`dsh-quota-watch/src/client/drag.mjs`（slop / grabOffset）、`dsh-quota-watch/src/client.mjs` `attachDrag`（手势状态机范本，约 529–646 行）。
- 皮肤病例：`dsh-skins/src/client/skins/openbmc-harness/index.js` 151/194 行（`--dsw-alias-bg-base` α=0.55）及其 340–352 行病类注释。

## 文件结构与职责

- Create: `dsh-m/src/client/window-drag.js` — DOM-free 纯逻辑：slop、grabOffset、clamp、titlebar inset、solidifyColor、位置存取。ESM 具名导出（与 `backdrop.js` 同风格——仓库 `"type":"module"`，`src/client/*.js` 全按 ESM 解析，node:test 可直接命名导入）。
- Create: `dsh-m/tests/client-window-drag.test.mjs` — 上述纯函数的 node:test 单测。
- Create: `dsh-m/docs/adr/0017-panel-drag-position-model.md` — 拖拽位置模型与 titlebar 契约 ADR（结构沿 0016）。
- Modify: `dsh-m/src/client/main.jsx` — CSS（头部手柄样式、`.abs`、`.dshm-panel--dragging` 自持）、i18n 双表（`panel.dragHint`）、`MarketPanel` 位置状态 + 拖拽状态机接线 + resize/全屏联动。
- Modify: `dsh-m/tests/client-lightbox.test.mjs` — `!important` 清单定长断言 4→7 + 新规则登记断言。
- Modify: `dsh-m/CHANGELOG.md`、`dsh-m/package.json` — 0.9.69 双语条目与版本号。
- 不变边界：`scripts/build.mjs`（esbuild 以 `src/client/main.jsx` 为入口整包打包，新模块被 require 即自动入 bundle，无构建配置改动）；`scripts/assert-pack.mjs`（产物清单不变，仍是单文件 `lib/client.js`）；`.dshm-overlay` 居中布局、`.dshm-panel.full` 全屏布局。

## 任务清单

### Task 1: `window-drag.js` 纯逻辑模块 + 单测（TDD）

- 目标：落地全部可单测的纯逻辑，主工程一行未动时它们已绿。
- 涉及文件
  - Create: `src/client/window-drag.js`
  - Test: `tests/client-window-drag.test.mjs`
- 接口契约
  - Consumes: 无
  - Produces（Task 3 按名 require，命名必须逐字一致）:
    `POS_KEY="dshm-panel-pos"`、`PANEL_MARGIN=8`、`DRAG_SLOP_MOUSE=6`、`DRAG_SLOP_TOUCH=10`、
    `dragSlop(pointerType)`（touch/pen→10，其余→6）、
    `grabOffset(point, rect)`→`{dx,dy}`（point 相对 rect 左上）、
    `titlebarTopInset({titlebar, fullscreen, height})`（三者条件同 quota-watch：`!titlebar||fullscreen`→0；`parseFloat(height)>0` 才取值）、
    `clampPoint(point, viewport, size, insets)`（insets `{left,right,top,bottom}`，min = MARGIN+inset，`Math.max(min, …)` 防退化，公式同 quota-watch `prefs.clampPoint`）、
    `solidifyColor(computedColor)`→`"rgb(r, g, b)"`|`null`（解析 `rgb()/rgba()` 逗号式与 `color(srgb r g b [/ a])`；α<0.05 或不可解析→`null`）、
    `loadPanelPos(storage)`→`{x,y}`|`null`（JSON 解析 + Number.isFinite 校验，storage 为 null 或异常→null）、
    `savePanelPos(storage, point)`（非有限点抛 TypeError；setItem 异常静默——位置退化为会话级）、
    `isDragTarget(el)`→Boolean（`el?.closest?.("button")` 命中即 true）。
- 验证范围：`node --test tests/client-window-drag.test.mjs` 全绿。

- [ ] Step 1: 写失败测试。测试文件头部注释仿 `client-backdrop.test.mjs`（说明用途 + 运行命令），`import { describe, it } from "node:test"`、`import assert from "node:assert/strict"`、`import { POS_KEY, PANEL_MARGIN, DRAG_SLOP_MOUSE, DRAG_SLOP_TOUCH, dragSlop, grabOffset, titlebarTopInset, clampPoint, solidifyColor, loadPanelPos, savePanelPos, isDragTarget } from "../src/client/window-drag.js"`。用例清单（每条都是硬断言）：
  - dragSlop：`"mouse"→6`、`"touch"→10`、`"pen"→10`、`undefined→6`；
  - grabOffset：`grabOffset({x:130,y:90},{left:100,top:60})→{dx:30,dy:30}`；
  - titlebarTopInset：`{titlebar:true,fullscreen:false,height:"40px"}→40`；`{titlebar:true,fullscreen:true,height:"40px"}→0`；`{titlebar:false,fullscreen:false,height:"40px"}→0`；`{titlebar:true,fullscreen:false,height:""}→0`；`{titlebar:true,fullscreen:false,height:"abc"}→0`；
  - clampPoint：视口 1000×800、size 400×300、零 insets 时 `{x:-50,y:2000}`→`{x:8,y:492}`（800−8−300）；top inset 40 时 y 可行域变 `[48, 492]`（insetTop 只抬 minY、不削 maxY——quota-watch 公式），如 `{x:-50,y:20}`→`{x:8,y:48}`；size 大于视口时回落 `{x:8,y:8}`（Math.max 退化守卫）；
  - solidifyColor：`"rgb(255, 255, 255)"→"rgb(255, 255, 255)"`；`"rgba(12, 26, 38, 0.47)"→"rgb(12, 26, 38)"`；`"color(srgb 0.047 0.102 0.149 / 0.47)"→"rgb(12, 26, 38)"`（0–1 分量×255 四舍五入）；`"rgba(0, 0, 0, 0)"→null`（α<0.05 病态）；`"rgba(0, 0, 0, 0.04)"→null`；`"oklab(0.5 0 0)"→null`；`"transparent"→null`；
  - loadPanelPos：Map stub 存 `{"x":12.5,"y":-3}`→`{x:12.5,y:-3}`；存 `"garbage"`→null；存 `{"x":"a"}`→null；`loadPanelPos(null)`→null；getItem 抛异常→null；
  - savePanelPos：roundtrip 存取一致；`savePanelPos(map, {x:"a"})` 抛 TypeError；storage.setItem 抛异常（stub 里 throw）→不向外抛；
  - isDragTarget：`{closest:()=>"button"}`→true；`{closest:()=>null}`→false；`null`→false；`{}`→false。
- [ ] Step 2: 运行并确认失败
  - Run: `node --test tests/client-window-drag.test.mjs`
  - Expected: 导入失败（`Cannot find module '../src/client/window-drag.js'`），全套用例红。
- [ ] Step 3: 写最小实现。`src/client/window-drag.js`：文件头注释写明「DOM-free 纯逻辑，Point/rect 由调用方传入；公式契约与 dsh-quota-watch prefs.mjs/drag.mjs 逐字对齐（契约自 0.1.20 引入，参照核对于 0.1.24；ADR-0017）」；**ESM 具名导出**：`export const …` / `export function …`——仓库 `"type":"module"` 下 `src/client/*.js` 按 ESM 解析，写 `module.exports` 会在模块求值时抛 `ReferenceError: module is not defined`（评审 R1-3）；esbuild 从 main.jsx 的 `require()` 打包 ESM 模块无碍（market-state.js 同款先例）。实现严格按 Produces 契约，不做契约外泛化。
- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-window-drag.test.mjs`
  - Expected: 全部用例绿（0 fail）。
- [ ] Step 5: checkpoint commit
  - Run: `git add src/client/window-drag.js tests/client-window-drag.test.mjs && git commit -m "feat(client): window-drag 纯逻辑模块（拖拽 clamp/titlebar 契约/实心固化解析）"`

### Task 2: main.jsx 静态接线（CSS + i18n + 头部 JSX）+ `!important` 清单登记

- 目标：头部获得手柄外观与双击提示，拖拽态自持规则与登记断言就位；此时还没有任何行为接线，全量测试必须保持绿。
- 涉及文件
  - Modify: `src/client/main.jsx`（CSS 常量区锚点：`.dshm-panel{…}` 规则行 ≈288，新规则插在其后；i18n zh 表 `"panel.fullscreen"` 行 ≈88、en 表 ≈202；头部 JSX `.dshm-head` 元素 ≈3332）
  - Test: `tests/client-lightbox.test.mjs`（清单断言 ≈94–96）
- 接口契约
  - Consumes: 无（不 require Task 1 模块）
  - Produces（Task 3 依赖，逐字）: CSS 类 `dshm-panel--dragging`、`dshm-panel.abs`（选择器写作 `.dshm-panel--dragging` / `.dshm-panel.abs`）、CSS 变量 `--dshm-drag-bg`、i18n key `"panel.dragHint"`。
- 验证范围：`npm run build && node --test tests/client-lightbox.test.mjs` 绿；`grep -c "dshm-panel--dragging" lib/client.js` ≥ 1。

- [ ] Step 1: 写失败断言。`tests/client-lightbox.test.mjs` 清单用例（现断言 count===4）追加两条：
  - `assert.ok(src.includes(".dshm-panel--dragging{cursor:grabbing;background:var(--dshm-drag-bg,Canvas)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important")`, "拖拽态实心自持（计算值固化，皮肤 α 变量免疫——openbmc 0.55 α 病例）")
  - count 断言 `4` 改 `7`。算术：4 + 规则 3 处 + 注释 0 处 = 7——计数正则对 main.jsx 全文（含注释）生效，Step 3 规定的新注释措辞**不含该关键字字面量**（评审 R1-2）；清单注释追加「+ 拖拽态自持 ×3（ADR-0017 登记）」。
  - Run: `node --test tests/client-lightbox.test.mjs`
  - Expected: 新断言红（main.jsx 尚无该规则），count 断言红（4≠7）。
- [ ] Step 2: 运行并确认失败
  - Run: `node --test tests/client-lightbox.test.mjs`
  - Expected: 恰好上述两处失败，其余锚保持绿。
- [ ] Step 3: 写最小实现（四处静态改动）：
  - CSS：`.dshm-panel{…}` 规则之后新增（含守卫注释，注释即纪律）：
    ```
    /* 0.9.69 还原态拖拽：.abs = 有位置记忆时的绝对定位形态（overlay 为 inset:0 fixed，
       绝对定位坐标即视口坐标）；无记录时面板仍走 overlay flex 居中，渲染路径与旧版逐字节一致。
       拖拽态自持（0.9.62 影院同款纪律）：background 取调用方手势开始时写入的 --dshm-drag-bg
       （getComputedStyle 解析后的最终色强制 α=1，见 window-drag.solidifyColor），皮肤对
       --dsw-alias-* 的半透明定义（openbmc/uefi bg-base α=0.55 病类）无法再让拖拽中面板透光；
       blur 关闭是拖拽期最大性能收益（每帧免大面积重滤镜），transform ≠ none 维持包含块，
       fixed 后代不逃逸。自持三处已登记于 client-lightbox.test.mjs 定长断言（4→7）；
       本注释刻意不用清单关键字字面量——计数对注释提及同样生效（评审 R1-2）。 */
    .dshm-panel.abs{position:absolute;margin:0}
    .dshm-panel--dragging{cursor:grabbing;background:var(--dshm-drag-bg,Canvas)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;box-shadow:0 24px 64px rgba(2,6,23,.38)}
    /* 0.9.69 拖拽手柄：user-select/touch-action/tap-highlight 无条件生效（全屏双击切换时
       标题不出现选中闪现）；grab 光标仅在「还原态且非拖拽中」直接命中 head——拖拽中 head
       无自有 cursor 声明，自然继承面板根 .dshm-panel--dragging 的 grabbing（cursor 按
       「元素自有声明 > 继承」解析：grab 若在拖拽中仍直接命中 head，grabbing 永远继承不进
       成为死代码——评审 R2-2）。全屏禁拖（硬性要求③），光标不误导（评审 R1-6）。 */
    .dshm-head{user-select:none;touch-action:none;-webkit-tap-highlight-color:transparent}
    .dshm-panel:not(.full):not(.dshm-panel--dragging) .dshm-head{cursor:grab}
    ```
  - `.dshm-head` 原规则（≈305 行）保持不动（上面是追加的新规则，非改写）。
  - i18n：zh 表 `"panel.fullscreen"` 行同行追加 `"panel.dragHint": "拖拽移动 · 双击切换全屏",`；en 表同行追加 `"panel.dragHint": "Drag to move · Double-click to toggle fullscreen",`。
  - 头部 JSX：`.dshm-head` 元素 props 追加 `title: full ? undefined : lookup("panel.dragHint")`（全屏态拖拽禁用，提示同步隐藏）。
- [ ] Step 4: 运行并确认通过
  - Run: `npm run build && node --test tests/client-lightbox.test.mjs && grep -c "dshm-panel--dragging" lib/client.js`
  - Expected: 测试全绿（含新断言与 count===7），grep 计数 ≥1。
- [ ] Step 5: checkpoint commit
  - Run: `git add src/client/main.jsx tests/client-lightbox.test.mjs && git commit -m "feat(client): 头部手柄静态样式 + 拖拽态实心自持 + i18n 提示（!important 清单 4→7）"`

### Task 3: MarketPanel 位置状态与拖拽状态机接线

- 目标：把纯逻辑接成行为：还原态可拖、菜单零影响、释放烘焙 + 持久化、全屏/resize/双击联动、皮肤下实心。
- 涉及文件
  - Modify: `src/client/main.jsx`（require 区锚点 ≈17 行 `lightbox.js` 之后；`MarketPanel` 函数体锚点：`FS_KEY`/`full` state ≈3127–3147；return 的 overlay/panel/head JSX ≈3323–3332）
- 接口契约
  - Consumes: Task 1 全部命名导出（逐字）；Task 2 的 `dshm-panel--dragging` / `dshm-panel.abs` / `--dshm-drag-bg` / `"panel.dragHint"`。
  - Produces: localStorage key `dshm-panel-pos`（`{"x":number,"y":number}`，语义 = 面板视口左上角绝对坐标）。
- 验证范围：`npm test` 全量绿（基线 1305 项只增不减，实测于 2026-10-10，评审 R1-4）；`grep -c "dshm-panel-pos" lib/client.js` ≥ 1。

- [ ] Step 1: 写行为断言（render-smoke 级）。在 `tests/client-window-drag.test.mjs` 追加一组「接线存在性」结构锚（仓库惯例：断言 main.jsx 源串）：`assert.ok(src.includes('require("./window-drag.js")'))`；`assert.ok(src.includes("onDoubleClick"))` 且同函数域含 `isDragTarget`；`assert.ok(src.includes('loadPanelPos'))` 与 `assert.ok(src.includes('savePanelPos'))`；负向锚 `assert.ok(src.includes('"dshm-panel-pos"') === false)`（key 字面量只允许活在 window-drag.js，防散落硬编码——**实现前后恒绿的防回归 tripwire，不计入下一步失败数对账**，评审 R1-8）。测试文件读源方式仿 client-lightbox（`readFileSync(new URL("../src/client/main.jsx", import.meta.url), "utf8")`）。
  - Run: `node --test tests/client-window-drag.test.mjs`
  - Expected: 新增正向结构锚红（负向锚恒绿不算；main.jsx 未接线）。
- [ ] Step 2: 运行并确认失败
  - Run: `node --test tests/client-window-drag.test.mjs`
  - Expected: 仅正向结构锚失败（负向锚恒绿不算），Task 1 用例仍绿。
- [ ] Step 3: 写最小实现（全部在 main.jsx）：
  - require 行（插在 ≈17 行 `lightbox.js` require 之后）：`const { dragSlop, grabOffset, titlebarTopInset, clampPoint, solidifyColor, loadPanelPos, savePanelPos, isDragTarget } = require("./window-drag.js");`——`POS_KEY`、`PANEL_MARGIN`、`DRAG_SLOP_*` 不导入：margin/slop 已封装在纯函数内，key 字面量只允许活在 window-drag.js（与结构锚断言呼应）。
  - `MarketPanel` 内新增（紧随 `full`/`toggleFull` 定义之后）：
    - `const panelRef = useRef(null); const headRef = useRef(null); const fullRef = useRef(full); fullRef.current = full; const draggingRef = useRef(false); const suppressClickRef = useRef(false);`
    - `const [pos, setPos] = useState(() => loadPanelPos(typeof window !== "undefined" && window.localStorage ? window.localStorage : null));`
    - `readTitlebarInsets()`（组件外模块级函数）：`const htmlEl = document?.documentElement; if (!htmlEl) return {left:0,right:0,top:0,bottom:0}; const cs = window.getComputedStyle(htmlEl); return { left:0, right:0, top: titlebarTopInset({ titlebar: htmlEl.hasAttribute("data-windows-titlebar"), fullscreen: htmlEl.hasAttribute("data-fullscreen"), height: cs.getPropertyValue("--dsh-windows-titlebar-height") }), bottom:0 };`（quota-watch `readTitlebarInset` 同款读法；jsdom 无属性 → 0）。
    - `reclamp` = `useCallback(() => { if (fullRef.current || draggingRef.current || !panelRef.current || typeof window === "undefined") return; setPos((prev) => { if (!prev) return prev; const rect = panelRef.current.getBoundingClientRect(); const next = clampPoint({x:prev.x, y:prev.y}, {width:window.innerWidth, height:window.innerHeight}, {width:rect.width, height:rect.height}, readTitlebarInsets()); return next.x===prev.x && next.y===prev.y ? prev : next; }); }, [])`。
    - `useLayoutEffect(() => { reclamp(); }, [full, reclamp])` — 挂载与全屏往返都在 paint 前重夹紧。
    - `useEffect(() => { window.addEventListener("resize", reclamp); return () => window.removeEventListener("resize", reclamp); }, [reclamp])`。
    - 拖拽状态机 `attachDrag(headEl)`（闭包读 refs，不读 render 局部量）：局部 `dragging/moved/slop/grab/rest/size/lastPoint`。`onPointerDown`：门卫链首行 `if (dragging) return`（多指重入：拖拽中第二指落头部不重启手势、不重置 grab，评审 R1-7），随后 `fullRef.current || event.button!==0 || isDragTarget(event.target)` → return；`dragging=true; draggingRef.current=true; moved=false; slop=dragSlop(event.pointerType);` panel=`panelRef.current`，`rect=panel.getBoundingClientRect()`，`grab=grabOffset({x:event.clientX,y:event.clientY},rect)`，`rest={x:rect.left,y:rect.top}`，`size={width:rect.width,height:rect.height}`；实心固化：`const solid = solidifyColor(window.getComputedStyle(panel).backgroundColor); solid ? panel.style.setProperty("--dshm-drag-bg", solid) : panel.style.removeProperty("--dshm-drag-bg");`；`headEl.setPointerCapture?.(event.pointerId)`；绑定 document `pointermove/pointerup/pointercancel`（仅手势期）。`onPointerMove`：未超 slop 前 return；超阈首帧 `moved=true; document.body.style.userSelect="none"; panel.classList.add("dshm-panel--dragging"); panel.style.willChange="transform";`；此后 `lastPoint={x,y}` + 调度 rAF 帧回调（pointermove 只存点不写样式，样式写集中在帧内；**帧回调首行 `if (!dragging || !lastPoint) return`**——释放/取消后在途残帧一律早退，杜绝烘焙后再写 transform 的竞态，quota-watch client.mjs 同款守卫，评审 R1-5/R2-1）：`const insets=readTitlebarInsets(); const topLeft=clampPoint({x:lastPoint.x-grab.dx, y:lastPoint.y-grab.dy}, {width:window.innerWidth,height:window.innerHeight}, size, insets); panel.style.transform = "translate3d(" + Math.round(topLeft.x-rest.x) + "px, " + Math.round(topLeft.y-rest.y) + "px, 0)";`。`onPointerUp`：`dragging=false; draggingRef.current=false;` 解绑、还原 `userSelect`；`!moved` → return（纯点击，不动位置）；否则算 `final`（同 clamp 公式，用 `event.clientX/Y`），**同步烘焙**：`panel.style.left=final.x+"px"; panel.style.top=final.y+"px"; panel.classList.remove("dshm-panel--dragging"); panel.style.willChange=""; panel.style.transform=""; panel.style.removeProperty("--dshm-drag-bg");`，然后 `savePanelPos(window.localStorage, final); suppressClickRef.current=true; setPos(final);`。`onPointerCancel`：只还原视觉（去 class/will-change/transform/--dshm-drag-bg、userSelect）、解绑，不持久化（quota-watch 语义：取消不落盘）。
    - `useEffect(() => { const headEl = headRef.current; if (!headEl) return; …onPointerDown 定义并 addEventListener…; return () => { headEl.removeEventListener("pointerdown", onPointerDown); 解绑手势监听; document.body.style.userSelect=""; }; }, [])` — deps 空数组，Esc 卸载时监听无泄漏。
  - 头部 JSX props（Task 2 的 title 之外）：`ref: headRef`、`onDoubleClick: (e) => { if (isDragTarget(e.target)) return; toggleFull(); }`、`onClickCapture: (e) => { if (!suppressClickRef.current) return; suppressClickRef.current = false; e.stopPropagation(); e.preventDefault(); }`。
  - panel JSX：`ref: panelRef`；className 改为 `["dshm-panel", full && "full", !full && pos && "abs"].filter(Boolean).join(" ")`；style：`!full && pos ? { left: pos.x + "px", top: pos.y + "px" } : undefined`。
- [ ] Step 4: 运行并确认通过
  - Run: `npm test && grep -c "dshm-panel-pos" lib/client.js`
  - Expected: 全量测试绿（基线 1305 + 本批新增，0 fail），grep ≥1。
- [ ] Step 5: checkpoint commit
  - Run: `git add src/client/main.jsx tests/client-window-drag.test.mjs && git commit -m "feat(client): 还原态面板头部拖拽状态机（位置记忆/全屏联动/resize 重夹紧/实心固化接线）"`

### Task 4: ADR-0017 + CHANGELOG 0.9.69 + 版本号

- 目标：沉淀决策记录与发版工件。
- 涉及文件
  - Create: `docs/adr/0017-panel-drag-position-model.md`
  - Modify: `CHANGELOG.md`（中文区块顶部、英文区块顶部各一条 0.9.69）
  - Modify: `package.json`（`"version": "0.9.68"` → `"0.9.69"`）
- 接口契约
  - Consumes: Task 1–3 的最终形态（ADR 记录的是已实现契约，不得与代码出入）。
  - Produces: 无（文档终点）。
- 验证范围：`npm test` 全绿；`grep -c "0.9.69" CHANGELOG.md` ≥ 2；`grep '"version"' package.json` 含 0.9.69。

- [ ] Step 1: 写 ADR。结构沿 `docs/adr/0016-merged-market-materialization.md`（标题/日期/状态/背景/决策/后果）。决策条目必须覆盖五点：① 位置模型 = 绝对定位烘焙（释放时 transform→left/top，无记录 flex 居中不变）；② clamp = 8px 边距 + `titlebarTopInset` 契约（html `data-windows-titlebar`/`--dsh-windows-titlebar-height`/`data-fullscreen`，与 quota-watch 契约同源——0.1.20 引入、0.1.24 核对；为何不复用 overlay 的 24/16/24 padding——拖拽是显式动作）；③ 皮肤免疫 = 计算值固化（`solidifyColor` 强制 α=1 + `--dshm-drag-bg` + `!important` 自持，openbmc bg-base α=0.55 病例与 quota-watch 胶囊半透明事故为背景，!important 清单 4→7 登记）；④ 性能纪律 = 拖拽帧不经 React state、rAF+translate3d+will-change、手势期才挂 document 监听、拖拽期关 blur；⑤ 无磁吸（区别于 quota-watch ADR-0002 的边缘停靠——面板大，自由停放）。
- [ ] Step 2: 写 CHANGELOG 双语条目。中文区块（`## 中文` 下第一个 `###`）`### 0.9.69 功能：还原态面板头部拖拽 + 位置记忆`：三条要点——「方案」（手柄=头部非按钮区、双击全屏、8px+titlebar clamp、释放烘焙持久化、双保险防误关）；「皮肤免疫」（计算值固化强制实心 + 拖拽期关 blur 的性能收益，openbmc/uefi 玻璃皮肤实测背景）；「验证」（全量测试数、typecheck、手测场景：web/desktop/openbmc）。英文区块对称条目置顶。文风仿 0.9.68 条目（现行最新条目）。
- [ ] Step 3: 版本号 `package.json` `"version"` 从 `"0.9.68"` 改 `"0.9.69"`。
- [ ] Step 4: 运行并确认通过
  - Run: `npm test && grep -c "0.9.69" CHANGELOG.md && grep '"version"' package.json`
  - Expected: 全绿；grep 计数 ≥2；版本串含 0.9.69。
- [ ] Step 5: checkpoint commit
  - Run: `git add docs/adr/0017-panel-drag-position-model.md CHANGELOG.md package.json && git commit -m "docs: ADR-0017 + 0.9.69 双语 changelog + 版本号"`

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项、命名不一致或验证命令失效，先修计划再动手。
- 按任务顺序执行，不无声跳步、合并或改变任务目标；每完成一个任务跑该任务定义的验证。
- 涉及 main.jsx 的改动遵循「先读后写」；main.jsx 是 3600+ 行热区文件，edit 的 old_string 必须带足上下文锚点。
- 若当前在 `main`/`master` 分支且用户未明确同意提交，checkpoint commit 前先询问。
- 遇阻塞、重复失败或计划与仓库现实不符，立即停下说明，不要猜。

## 最终验证

- 命令（dsh-m/ 根，bash + Node）：
  - `npm run typecheck` → 零错误（house 惯例，host/core tsc 不受本批影响但必须过）。
  - `npm test` → 全绿且用例数 ≥ 基线 1305 + 本批新增（Task 1 纯函数 9 组 + Task 3 结构锚 4 条 + Task 2 清单断言 2 条）。
  - `grep -c "dshm-panel--dragging" lib/client.js && grep -c "dshm-panel-pos" lib/client.js` → 均 ≥1（构建产物含新规则与存取）。
- 手工冒烟清单（人工执行，逐条留证）：
  1. Web profile（浏览器开 `http://127.0.0.1:3080`）：头部空白区拖拽跟手；市场/已装/设置 tab、全屏/关闭钮、双 chip 点击全部原样；拖到视口边缘停在 8px；释放后刷新页面位置还原；`localStorage.getItem("dshm-panel-pos")` 为合法 JSON。
  2. 全屏态：按住头部无法拖拽；双击头部空白区进入/退出全屏；**双击 tab/全屏/关闭钮不得触发全屏切换、按钮语义原样**（Q1 门卫负向检查，评审 R1-10）；还原后位置不丢；窗口 resize 后面板收回边界内；**全屏期间缩小窗口 → 还原 → 面板收回新边界内**（E1-1 增补：还原 commit 的 reclamp 是该路径唯一触发源）。
  3. 首开兼容：`localStorage.removeItem("dshm-panel-pos")` 后重开面板 → 与旧版居中渲染一致。
  4. Desktop profile：拖拽上界停在系统标题栏带（40px）之下，面板永不进入按钮区，头部可抓不吞点击。
  5. openbmc 皮肤（dsh-skins 切换）：按住拖动时面板完全实心、背景文字零透出；松手玻璃恢复；深浅色各验一次。
  6. 触屏（如有触屏设备/模拟器）：拖拽进行中第二根手指落到头部，面板不跳变、手势不被重启（评审 R1-7）。

## 审阅 Checkpoint

- 计划正文结束后请求用户审阅；审阅通过前不进入实现。
