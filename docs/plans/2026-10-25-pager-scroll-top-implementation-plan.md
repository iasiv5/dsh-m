# 市场分页回顶（pager scroll-to-top · 方案 C）实施计划

## 目标

修复市场 tab 替换式分页翻页后视口滞留页尾的缺陷（根因：`scrollIntoView` 以 sticky 吸顶元素为锚点，stuck 态下判定空转），并落地两层回顶不变式：

- **Layer-1（页移动）**：页码 / ‹ › / 页号跳转后，滚动容器直滚回顶；smooth，`prefers-reduced-motion: reduce` 时瞬时。
- **Layer-2（筛选身份变化）**：分区 + 查询词 + 分类 + 排序 + 页大小任一变化（即 offset 归零回第一页）时，paint 前瞬时回顶；`offset` 显式不在身份键内，页移动绝不误触发。
- **不回顶白名单**：mutation 后 `reload()`、后台静默换新、快照 background 刷新——身份键不变且不经 `gotoPage`，滚动位置原样保留。

零新增依赖、零路由/服务端改动、`package.json` 版本号不动。

## 架构快照

- 滚动容器 `.dshm-body` 由 shell（`main.jsx`）渲染并持 `bodyRef`，经 prop 下传 `MarketTab`——容器是共享基础设施，所有权在渲染者（dsh-market `bodyRef` 同款）。
- `market-state.js` 是客户端纯函数之家（`node:test` 直 import 源文件、不依赖 DOM/React）：新增 `filterScrollKey` / `scrollBodyTop` / `preferredPagerBehavior` 三个具名导出。
- `market-tab.jsx`（`MarketTab`）内：`gotoPage` 弃用 sticky 锚点 `scrollIntoView`，改调 `scrollBodyTop`；新增 `useLayoutEffect` 以 `filterScrollKey(zone, query)` 为唯一 dep 做瞬时回顶。**所有 hooks 必须位于 favorites 早退（现 273 行 `if (zone === "favorites")`）之前**——与 38 行 compatConfirm 注释同款纪律。
- `normalizeMarketQuery` 产物形状 `{ zone, source, query, category, sort, offset, limit }`（`sort` = `{field, dir} | null`，构造序稳定）；`sameSort` 的 `JSON.stringify` 比较是既有先例，`filterScrollKey` 沿用同一序列化思路。
- 取数期间旧页内容保留显示（`loading && !data` 才换 spinner），点击即滚不会闪现空区。

## 全局约束（自设计稿逐字继承）

- 动效纪律：页移动 smooth + reduced-motion 降级瞬时；筛选变化恒瞬时。全链路不得引入新依赖。
- 冻结面清点（评审 #2；以下四者本计划零改动，`styles.js` 与 `zone-chips.jsx` 不出现在任何任务 Files 清单）：
  - `src/client/styles.js:70` `.dshm-body{…overflow-anchor:none}` —— 已有自动防线：`tests/client-render-smoke.test.mjs:431` 源码断言 `\.dshm-body\{[^}]*overflow-anchor:none`（Task 6 Step 1 全量测试覆盖）；
  - `src/client/styles.js:111` `.dsvm-chipswrap{position:sticky;top:-14px;…}` —— 已有自动防线：`tests/client-render-smoke.test.mjs:432` 断言 `position:sticky;top:-14px` 在位（评审 #6 修正：原「无自动断言」陈述有误）；Task 6 Step 4 改动面收口探针为第二道防线；
  - `src/client/zone-chips.jsx` 吸顶 IO 测量/哨兵契约（wrap 内 top:"-5px" 哨兵、offsetTop 分组测量）—— 已有自动防线：`tests/client-render-smoke.test.mjs:433` 断言 zone-chips.jsx `top: "-5px"` 哨兵契约，另有换区测量/空容器恢复守卫用例；Task 6 Step 4 收口探针为第二道防线；
  - `package.json` `"version"` 字段 —— 靠收口探针（diff 不含 package.json 即版本号未动的机械化断言）。
- 代码片段风格随所在文件既有惯例（评审 #5）：`market-state.js` 单引号、无分号；`market-tab.jsx` / `main.jsx` 双引号、分号——计划内片段已按此书写。
- 术语纪律：文档与代码注释用词遵循 `GLOSSARY.md` 四词条（回顶 / 页移动 / 筛选身份键 / 滚动容器）。
- 测试文化：`node:test`、直接 import 源文件、不依赖 DOM/React；不引入 jsdom / 浏览器自动化。
- SSR 安全：所有新 effect 内对 `bodyRef.current` 做 null 守卫，`renderToString` 冒烟必须保持绿。
- 版本纪律：`package.json` 版本号不动，随下一次常规发版走。
- 命令环境：web 机 Linux + bash 工具；仓库惯例 `npm run build` / `npm test`（`pretest` 自动 build）/ `npm run typecheck`。构建类命令（esbuild 家族会 spawn 子进程）需 完全权限（full-access） 会话执行。
- 分支纪律：仓库当前在 `main`；开始实现前向主人确认分支策略（worktree / 直接 main），未确认不动第一刀。
- 非范围（grill Q8，一律不做）：顶部页码器副本、读屏公告 / 翻页后焦点移交、收藏区内部滚动行为改造、无限滚动 / load-more 模式。

## 输入工件

- 设计稿：`docs/specs/2026-10-25-pager-scroll-top-design.md`（已对齐稿，含 grill Q1–Q9 裁决回填）。
- grill 裁决：2026-10-25 Round 1 九项全按推荐落定（时机=点击即滚、动效=smooth+降级、键范围、白名单、zone 进键、bodyRef 下传、测试策略、非范围、不立 ADR）。
- 词汇表：`GLOSSARY.md` 四词条已入库（页移动 / 筛选身份键 / 滚动容器 / 回顶）。
- 参考实现：`.dsh-research/dsh-market-clone/client/client.js` `usePagination.goToPage` + `scrollToTop`（不变式出处）。
- 病灶锚点：`src/client/market-tab.jsx:77-85`（失效的 `scrollIntoView` 分支）、`src/client/styles.js:111`（`.dsvm-chipswrap` sticky）。

## 文件结构与职责

- Modify: `src/client/market-state.js` —— 追加三个具名导出（纯函数区，文件尾接在既有导出之后）：`filterScrollKey(zone, query)`、`scrollBodyTop(el, behavior)`、`preferredPagerBehavior()`。
- Modify: `tests/client-market-state.test.mjs` —— 追加两组 `describe`：筛选身份键、回顶原语；顶部解构清单同步扩名。
- Modify: `src/client/main.jsx` —— 渲染 `.dshm-body` 的 shell 组件挂 `bodyRef` 并作为 prop 下传 `MarketTab`（仅此一处接线，不动其他 tab）。
- Modify: `src/client/market-tab.jsx` —— React 解构加 `useLayoutEffect`（13 行）；market-state import 行（16 行）扩名；`MarketTab` 签名接 `bodyRef`；`gotoPage` 换容器直滚并删除 sticky 锚点分支；favorites 早退前新增 layer-2 effect。
- 不入本计划（已完成）：`GLOSSARY.md` 词条、`docs/specs/` 设计稿。

## 任务清单

### Task 1: `filterScrollKey` 纯函数（TDD）

- 目标：筛选身份键可判定「是否同一份筛选结果」，`offset` 显式排除。
- Files
  - Modify: `tests/client-market-state.test.mjs`（顶部 `const { ... } = ms` 解构加 `filterScrollKey`）
  - Modify: `src/client/market-state.js`（文件尾追加导出）
- 验证范围：`node --test tests/client-market-state.test.mjs` 全绿。
- 接口契约
  - Consumes: 无（独立纯函数）。
  - Produces: `market-state.js` 具名导出 **`filterScrollKey(zone, query) -> string`**。`zone`: `"community" | "primary" | "favorites"`；`query`: `normalizeMarketQuery` 产物形状或 `undefined`/falsy（收藏区 `market=null`）。字段防御式读取：`query` 文本 / `category` / `sort` / `limit` 进键；`offset` 与 `source` 不进键；任意输入不抛错。

- [ ] Step 1: 在 `tests/client-market-state.test.mjs` 追加 `describe("filterScrollKey", ...)`，用例八条：① 同入参恒同串（Q4 白名单回归锚）；② 仅 `offset` 不同 → 键相同（**防页移动误触 layer-2 的核心锚**）；③ `query` 文本变化 → 异；④ `category` 变化（含 `null ↔ slug`）→ 异；⑤ `sort` 的 field 变 / dir 变 / `null ↔ object` → 异；⑥ `limit` 变化 → 异；⑦ `zone` 变化 → 异；⑧ `filterScrollKey("favorites", undefined)` 稳定且不抛。断言用 `node:assert/strict` 的 `equal` / `notEqual`。
- [ ] Step 2: Run: `node --test tests/client-market-state.test.mjs`。Expected: 新 describe 内用例失败（`filterScrollKey` is not a function / undefined），既有用例全绿。
- [ ] Step 3: `src/client/market-state.js` 文件尾实现（建议形态，注释带 GLOSSARY 术语）：

```js
/** 筛选身份键（GLOSSARY）：分区 + 查询词 + 分类 + 排序 + 页大小；offset 显式不在键内——
 *  键变 ⇒ 必然回第一页并触发瞬时回顶；键不变 ⇒ 页移动与任何刷新都视作同一份结果、滚动位置不动。 */
export function filterScrollKey(zone, query) {
  const q = query && typeof query === 'object' ? query : {}
  return JSON.stringify([zone, typeof q.query === 'string' ? q.query : '', q.category ?? null, q.sort ?? null, q.limit ?? null])
}
```

- [ ] Step 4: Run: `node --test tests/client-market-state.test.mjs`。Expected: 全绿（0 fail）。

### Task 2: `scrollBodyTop` + `preferredPagerBehavior` 纯封装（TDD）

- 目标：容器直滚原语与 reduced-motion 折算各自可测，DOM 接线层只剩薄调用。
- Files
  - Modify: `tests/client-market-state.test.mjs`（追加 `describe("scrollBodyTop / preferredPagerBehavior", ...)`）
  - Modify: `src/client/market-state.js`（Task 1 导出之后追加）
- 验证范围：`node --test tests/client-market-state.test.mjs` 全绿。
- 接口契约
  - Consumes: 无。
  - Produces: **`scrollBodyTop(el, behavior) -> void`**（`behavior`: `"smooth" | "instant"`；`el` 为 null/undefined 时 no-op；`el.scrollTo` 为函数时调 `el.scrollTo({ top: 0, behavior })`，否则 `el.scrollTop = 0`）；**`preferredPagerBehavior() -> "smooth" | "instant"`**（`window.matchMedia` 可用且 `(prefers-reduced-motion: reduce)` 命中 → `"instant"`；matchMedia 不可用（node/SSR）→ 默认 `"smooth"`）。

- [ ] Step 1: 追加测试：伪造容器 `{ scrollTo: (opts) => { captured = opts; } }` 断言 `scrollBodyTop(el, "smooth")` 恰调一次且参数为 `{ top: 0, behavior: "smooth" }`、`"instant"` 同理；`{ scrollTop: 0 }` 无 `scrollTo` 的容器断言 `scrollTop` 被置 0；`scrollBodyTop(null, "smooth")` 不抛；node 环境（无 `window`）`preferredPagerBehavior() === "smooth"`。
- [ ] Step 2: Run: `node --test tests/client-market-state.test.mjs`。Expected: 新用例失败（同名导出不存在）。
- [ ] Step 3: 实现（`market-state.js`，Task 1 导出之后）：

```js
/** 容器直滚原语（GLOSSARY「滚动容器/回顶」）：只作用于滚动容器本身，不依赖子元素几何。 */
export function scrollBodyTop(el, behavior) {
  if (!el) return
  if (typeof el.scrollTo === 'function') el.scrollTo({ top: 0, behavior })
  else el.scrollTop = 0
}

/** 页移动动效折算：系统「减少动态」偏好命中时瞬时，环境无 matchMedia（node/SSR）默认 smooth。 */
export function preferredPagerBehavior() {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
  }
  return 'smooth'
}
```

- [ ] Step 4: Run: `node --test tests/client-market-state.test.mjs`。Expected: 全绿（0 fail）。

### Task 3: shell 持 `bodyRef` 并下传 `MarketTab`

- 目标：滚动容器所有权显式化，ref 只由渲染者持有。
- Files
  - Modify: `src/client/main.jsx`（渲染 `.dshm-body` 的 shell 组件，现 827–829 行一带）
  - Modify: `src/client/market-tab.jsx`（`MarketTab` 签名接 `bodyRef`，本任务不解构使用之外不改动）
- 验证范围：`npm run build` 退出码 0；`node scripts/check-client-imports.mjs` 退出码 0；`node --test tests/client-render-smoke.test.mjs` 全绿。
- 接口契约
  - Consumes: 无（React `useRef` 已在 main.jsx:8 解构）。
  - Produces: **`MarketTab` 新 prop `bodyRef`**（React ref；`.current` 指向 `.dshm-body` 元素或 null）。Task 4/5 消费。

- [ ] Step 1（改动前观察）：`grep -n "bodyRef" src/client/main.jsx src/client/market-tab.jsx`。Expected: 零命中（当前无此 prop）。
- [ ] Step 2: shell 组件体内加 `const bodyRef = useRef(null);`；`.dshm-body` 的 div 加 `ref: bodyRef`；`MarketTab` 调用处 props 加 `bodyRef`。`market-tab.jsx` 的 `MarketTab({ ... })` 解构加 `bodyRef`。
- [ ] Step 3: Run: `npm run build && node scripts/check-client-imports.mjs && node --test tests/client-render-smoke.test.mjs`。Expected: 三者全过（ref 挂 DOM 元素对 SSR 无害）。

### Task 4: Layer-1——`gotoPage` 换容器直滚（页移动回顶）

- 目标：页码 / ‹ › / 页号跳转后点击即滚，smooth + reduced-motion 降级；删除 sticky 锚点 `scrollIntoView` 分支，搜索/浏览两路径合一。
- Files
  - Modify: `src/client/market-tab.jsx`（16 行 import 扩名；77–85 行 `gotoPage` 重写）
- 验证范围：`grep -c "scrollIntoView" src/client/market-tab.jsx` 为 0；`npm run build` 与 `node --test tests/client-market-state.test.mjs`、`tests/client-render-smoke.test.mjs` 全绿。
- 接口契约
  - Consumes: Task 1/2 的 `scrollBodyTop` / `preferredPagerBehavior`；Task 3 的 `bodyRef` prop。
  - Produces: Layer-1 行为（页移动回顶）；无新导出。

- [ ] Step 1（改动前观察；需主人浏览器配合，或经主人同意降级为采纳设计稿已核实根因——styles.js:111 sticky 锚点 + market-tab.jsx:83 空转分支——跳过浏览器复测，直接以改动后为基线）：从市场面板深页位（如第 3 页页尾）点「4」复测现状，确认视口滞留页尾。
- [ ] Step 2: 16 行 import 扩为 `import { DEFAULT_PAGE_SIZE, MARKET_PAGE_SIZES, pageItems, zoneChips, marketNotice, scrollBodyTop, preferredPagerBehavior } from "./market-state.js";`（`filterScrollKey` 由 Task 5 随用随加，避免中间态出现未用 import）。
- [ ] Step 3: `gotoPage` 重写为（「0.9.25 搜索态锚点」注释与 `document.querySelector` 分支整体删除；`searching` 变量保留——摘要行仍在用）：

```js
  // 页移动回顶（GLOSSARY「回顶」）：点击即滚不等响应——直滚滚动容器本身，
  // 不以 sticky 吸顶行为锚点（stuck 态下 scrollIntoView 判定空转，0.10.16 病灶）。
  const gotoPage = (p) => {
    updateQuery({ offset: Math.max(0, (p - 1) * limit) });
    scrollBodyTop(bodyRef && bodyRef.current, preferredPagerBehavior());
  };
```

- [ ] Step 4: Run: `grep -c "scrollIntoView" src/client/market-tab.jsx`（Expected: 输出 `0`；grep 计数为零时退出码为 1，属预期非失败）→ `npm run build && node scripts/check-client-imports.mjs && node --test tests/client-market-state.test.mjs tests/client-render-smoke.test.mjs`（Expected: 全过）。

### Task 5: Layer-2——筛选身份变化瞬时回顶（offset 归零不变式）

- 目标：分区 / 查询词 / 分类 / 排序 / 页大小任一变化时 paint 前瞬时回顶；页移动（仅 offset 变）不触发。
- Files
  - Modify: `src/client/market-tab.jsx`（13 行 React 解构加 `useLayoutEffect`；`gotoPage` 之后、favorites 早退（现 273 行）之前加 effect）
- 验证范围：`npm run build` 退出码 0；`node --test tests/client-market-state.test.mjs tests/client-render-smoke.test.mjs` 全绿；`grep -n "useLayoutEffect" src/client/market-tab.jsx` 命中解构与 effect 两处。
- 接口契约
  - Consumes: Task 1 `filterScrollKey`、Task 2 `scrollBodyTop`、Task 3 `bodyRef`、Task 4 扩好的 import 行。
  - Produces: Layer-2 行为；无新导出。

- [ ] Step 1: 13 行改为 `const { useState, useEffect, useLayoutEffect } = React;`；16 行 import 扩名追加 `filterScrollKey`。
- [ ] Step 2: `gotoPage` 定义之后追加（务必在 273 行 favorites 早退之前，hooks 顺序纪律）：

```js
  // 筛选身份变化 ⇒ 回第一页 ⇒ 瞬时回顶（GLOSSARY「筛选身份键」）；offset 不在键内，
  // 页移动不触发本层；mutation 后 reload / 后台换新键不变，滚动位置原样保留（白名单）。
  const pagerScrollKey = filterScrollKey(zone, query);
  useLayoutEffect(() => {
    scrollBodyTop(bodyRef && bodyRef.current, "instant");
  }, [pagerScrollKey]);
```

- [ ] Step 3: Run: `npm run build && node scripts/check-client-imports.mjs && node --test tests/client-market-state.test.mjs tests/client-render-smoke.test.mjs`。Expected: 全过；`grep -n "useLayoutEffect" src/client/market-tab.jsx` 命中 13 行解构与新 effect。

### Task 6: 全量收口验证 + 手工回归清单

- 目标：自动化全绿 + 六项手工回归过闸，行为与设计稿逐条对上。
- Files：无新改动（只验证）。
- 验证范围：本任务全部 Step 的 Expected 逐条满足。
- 接口契约
  - Consumes: Task 1–5 全部产物。
  - Produces: 验收结论（回填会话）。

- [ ] Step 1: Run: `npm test`（`pretest` 自动 build）。Expected: `check-client-imports` 过 + 全部 `tests/*.test.mjs` 0 fail。
- [ ] Step 2: Run: `npm run typecheck`。Expected: 退出码 0。
- [ ] Step 3: Run: `grep -rn "scrollIntoView" src/client/`（评审 #1 修订：`lightbox.js` 实测零命中，删除原判据里无谓的 `-v lightbox`）。Expected: 恰好 2 处——`main.jsx:545`（`openOps` 设置 tab 操作记录卡跳转，与市场分页无关、不在改动清单）与 `styles.js:67`（0.9.76 修复注释原文提及 scrollIntoView，styles.js 不在改动清单）；`market-tab.jsx` 零命中（病灶已由 Task 4 移除）。若出现第 3 处命中，按执行纪律停下核查。
- [ ] Step 4（改动面收口断言，评审 #2）：Run: `git diff --name-only -- src tests package.json`。Expected: 恰 4 文件——`src/client/market-state.js`、`src/client/market-tab.jsx`、`src/client/main.jsx`、`tests/client-market-state.test.mjs`；`package.json` 不出现（= 版本号未动的机械化断言）；`styles.js` / `zone-chips.jsx` 不在 diff（= 冻结面未破）。docs/ 下设计稿/计划/GLOSSARY 变更不在该判据范围（路径限定 `-- src tests package.json`）。
- [ ] Step 5（手工回归，需主人浏览器；生效探针前置，评审 #3）：**装机动作由主人执行**（仓库无本地装载流程惯例文档，agent 不代装、不代判装载完成；主人按惯用方式把新构建装入 web profile）；装入后生效探针（agent 可只读代跑）——`sha256sum lib/client.js` 与 `sha256sum ~/.dsh/profiles/web/node_modules/dsh-m/lib/client.js` 读数一致（版本号冻结 0.10.16，版本读数无法区分新旧构建），且 `grep -c "filterScrollKey" ~/.dsh/profiles/web/node_modules/dsh-m/lib/client.js` 输出 ≥ 1（计 0 = exit 1，单独执行、不入 && 链）；探针过闸后执行六项：① 第 3 页页尾点「4」→ 平滑回顶；② 系统「减少动态」开启 → 瞬时回顶；③ 搜索态翻页 → 回顶（原 searchmeta 路径并入后不回退）；④ 深页位切分类 / 改页大小 / 改排序 / 清搜索 → 瞬时回顶；⑤ 社区 ↔ 精选 ↔ 收藏切换 → 回顶；⑥ 翻页后 chips 吸顶行无高频蹦跳（0.9.76 回归项），且安装/升级插件触发**原地数据刷新（reload）后不回顶**（Q4 白名单；非浏览器 F5——F5 整页重载回顶属正常行为，评审建议 #2 措辞澄清）。

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- **当前分支为 `main`：第一刀动代码前，向主人确认分支策略（worktree / 直接 main），未确认不开工。**
- 按任务顺序执行，不无声跳步、合并步或改变任务目标；每完成一个任务即跑该任务定义的验证。
- 遇阻塞、重复失败或计划与仓库现实不符（行号锚点漂移、命令不存在等），立即停下说明，不猜。
- 全部任务完成后输出修改摘要；手工回归清单（Task 6 Step 5）需主人在浏览器执行，agent 不得代判通过。

## 最终验证

- `npm test`（含 build 与 import 纪律检查）0 fail；
- `npm run typecheck` 退出码 0；
- `grep -c "scrollIntoView" src/client/market-tab.jsx` 为 0；
- Task 6 Step 4 改动面收口断言：`git diff --name-only -- src tests package.json` 恰 4 文件、不含 package.json；
- Task 6 Step 5 生效探针（产物指纹一致 + filterScrollKey 计数 ≥ 1）过闸后，六项手工回归由主人过闸确认。
