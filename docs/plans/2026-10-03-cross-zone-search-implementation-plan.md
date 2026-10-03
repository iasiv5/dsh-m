# dsh-m 0.9.25 跨区搜索实施计划（浏览分区、搜索全局）

## 目标

社区区/精选区的搜索框升级为**跨区全局搜索**（社区 + 精选一并命中），清空关键词回到本区浏览态；搜索态结果按「精选段置顶 + 摘要行精确计数」呈现。数据层浏览分区制（ADR-0004）与排序管线（相关性为搜索唯一主键）一字不动；唯一服务端增量是 `MarketResult.sourceCounts` 分桶计数。

## 共识记录（2026-10-03 grilling Round 1 定稿）

1. **生效范围**：两区搜索框都全局（「搜索 = 全局，浏览 = 分区」统一心智；社区目录面板挂载已在共享 flight 加载，精选区触发全局搜索无额外请求成本）。
2. **搜索态 chips**：分类 chips 整行隐藏（跨区语义下两套分类法口径失义），清空关键词恢复；「筛选」按钮保留——搜索态挪到摘要行尾部、只渲染页大小组（排序组隐藏：query 命中时相关性恒优先，排序只剩 tie-break 作用）。筛选按钮维持社区区限定（精选区本就无筛选、96 单页直出）。
3. **呈现形态**：页内分组（精选命中置顶成段 + 段头）+ 摘要行「精选 N · 社区 M」；不做服务端精选加权（保护 `dshm_search`/CLI 三端同序）。
4. **计数数据源**：服务端 `sourceCounts: { primary, community }`（filtered 集合按 `isCommunityEntry` 分桶，host-api `{...result}` 整包透传现状零接线）。
5. **tab 计数去污染**：顶部「社区/精选」tab 计数改从响应现有字段推导（社区 = `community.acceptedCount - displaced`、精选 = `registryState.count`），不再读「最近一次查询的 total」——否则本方案落地后社区 tab 会被跨区 total 污染。
6. **收口范围**：版本号/README/CHANGELOG 一次备齐到 0.9.25；push 与 npm publish 前经主人确认（仓库既有纪律）。
7. **防呆（grilling 中发现）**：搜索提交时清空激活分类——chips 已隐藏，残留分类会变成不可见过滤，把精选结果静默滤没。

## 架构快照

- 搜索态 source 覆盖发生在**客户端组参处**：`useMarketData` 的 `fetchPage` 组装 params 时用新纯函数 `searchSourceOf(query)` 计算——query 非空 → `'all'`，否则维持 `query.source`（本区）。服务端 `listMarket` 的 `source: 'all'` 合并视图 + 相关性管线 0.7.0 已就绪（market.ts:696-697、747-782），零新查询语义。
- `sourceCounts` 是唯一服务端增量：`filtered`（分区 ∩ query ∩ category）集合按 `isCommunityEntry` 分桶计数，加入 `MarketResult`；host-api market case 现状 `payload = { ...result }` 整包透传（host-api.ts:442），无需改动。
- GUI 响应收敛：`normalizeMarketResponse` 增收 `sourceCounts`（可选、缺失 → 键不存在，形状漂移免疫原则延续——旧宿主响应/旧快照不含此键时摘要行整体不渲染）。
- 快照秒开不受影响：`isDefaultFirstPageQuery` 只认 query 为空的默认首页形态（market-snapshot.js:36-44），搜索态从不写快照，无需改动。
- 呈现层全部为 `MarketTab` 内派生渲染（`searching = Boolean(query.query)`），不新增 hooks、不新增状态实例、不改 `ZONE_TABS` 分区模型。
- i18n：新增 `search.summary` 一对（zh/en）；改写 `search.ph` 一对；段头与精选徽章复用现有 `zone.primary`/`zone.community` 键，不新增段头键。

## 全局约束

- **ADR-0004 浏览分区制不动**：`ZONE_TABS`、双分区状态实例（`markets.community`/`markets.primary`）、各区浏览态的 chips/排序/分页语义全部保持现状；本计划只改「query 非空」时的查询与呈现。
- **排序管线不动**：`listMarket` 相关性优先、sort 仅 tie-break 的语义（market.ts:774-782）不改；`dshm_search` 与 `dshm search` 三端同序不动（tools.ts/cli.ts 零改动）。
- **数据层不动**：`mergeRegistries` 去重（ADR-0003）、社区拉取链、`source='primary'` 零社区加载优化全部保持。
- **缺失字段容错**：客户端对 `sourceCounts` 只做形状收敛，缺失 = 功能降级（无摘要行），不得报错。
- **文案双语同步**：新增/改写文案 zh 与 en 两表同改（zh 表约 main.jsx:34-90 区、en 表约 main.jsx:142-198 区）。
- 无新增依赖；Node >=22 不变；不触碰 registry.json。

## 文件结构与职责

- Modify: `src/core/market.ts`——`MarketResult` 增 `sourceCounts: { primary: number; community: number }`；`listMarket` 在 filtered 后分桶计数；deadline 早退路径补零值。
- Modify: `src/client/market-state.js`——导出纯函数 `searchSourceOf(query)`；`normalizeMarketResponse` 收敛 `sourceCounts`（可选）。
- Modify: `src/client/main.jsx`——`fetchPage` 组参接 `searchSourceOf`；SearchBox 提交清空激活分类；tab 计数改字段推导；搜索态摘要行 + 页内分组 + 精选徽章 + chips 隐藏 + 筛选弹层搜索态只留页大小组；内嵌样式表补 `.dsvm-searchmeta`/`.dsvm-grouphead` 两条规则；i18n `search.summary` 新增与 `search.ph` 改写。
- Test: `tests/market.test.mjs`——新增 ⑭ `sourceCounts` 用例（all/community/primary × 有无 query）。
- Test: `tests/client-market-state.test.mjs`——新增 `searchSourceOf` 用例组 + `normalizeMarketResponse` 的 sourceCounts 收敛用例。
- Modify: `package.json`（version 0.9.25）、`README.md`/`README.en.md`（市场章节补跨区搜索描述）、`CHANGELOG.md`（0.9.25 条目）、`docs/DESIGN.md`（§2.6 补跨区搜索语义 + 通读核对）、`GLOSSARY.md`（社区区/精选区条目补搜索语义或新增术语）。

边界保持稳定：`src/core/host-api.ts`、`src/tools.ts`、`src/cli.ts`、`registry.json`、`scripts/build.mjs`（无组件改名，marker 校验列表不涉及）、`src/client/market-snapshot.js` 不动。

## 任务清单

### Task 1: core `sourceCounts` 分桶计数

- 目标：GUI 摘要行「精选 N · 社区 M」的服务端数据源。
- 涉及文件：`src/core/market.ts`、`tests/market.test.mjs`
- 接口契约：
  - Consumes: `listMarket` 现有 `filtered` 计算（分区 ∩ query ∩ category，market.ts:768-773）与 `isCommunityEntry` 判别（market.ts:592-594）。
  - Produces: `MarketResult.sourceCounts: { primary: number; community: number }`——**filtered 集合**（非 zoned 全集）按 `isCommunityEntry` 分桶：`community = filtered.filter(isCommunityEntry).length`、`primary = filtered.length - community`。`listMarket` 仅有的**两处** return 全覆盖：正常路径（market.ts:851-863）、registry deadline 早退路径（market.ts:721-733，补 `{ primary: 0, community: 0 }`）。
  - 语义注记：source='all' 时两桶都有值；source='community' 恒 `{ primary: 0, community: N }`；source='primary' 恒 `{ primary: N, community: 0 }`（filtered 单桶，数学上自动成立，无需分支）；社区 unavailable 时 merged 仅主清单，community 桶自然为 0（真实态如实呈现）。
- 验证范围：三源分桶正确、query 过滤后计数收缩、无 query 等于分区总数。

- [ ] Step 1: 写失败测试——`tests/market.test.mjs` 在 ⑧b alsoCategories 用例（:1159）之后新增 **⑭**（编号依据：同 describe「M1 Task 5：合并市场」内 ⑨–⑬ 均已占用——⑨:1174、⑩:1188、⑪:1201、⑫:1214、⑬:1236）：
  - 夹具沿用既有模式：`fakeDeps({ loadRegistry: async () => readyLoaded(primary) })` + `withCommunity(base, communityLoaded([...communityRaw(...)]))`（helpers 见 tests/market.test.mjs:1020-1075 区）。主清单 2 条（id `p-1`/`p-2`，description 含 `alpha` 的 1 条）、社区 3 条（description 含 `alpha` 的 1 条）。
  - 断言四组：`source: 'all'` 无 query → `{ primary: 2, community: 3 }`；`source: 'all', query: 'alpha'` → `{ primary: 1, community: 1 }` 且 `total === 2`；`source: 'community'` → `{ primary: 0, community: 3 }`；`source: 'primary'` → `{ primary: 2, community: 0 }`。
- [ ] Step 2: Run: `node --test tests/market.test.mjs` — Expected: ⑭ 失败（`res.sourceCounts` 为 undefined）
- [ ] Step 3: 实现——`MarketResult` 接口加 `sourceCounts` 字段；`listMarket` 在 `filtered` 计算后（market.ts:773 之后、排序之前均可，计数与排序无关）分桶；正常与 deadline 两处 return 补齐。
- [ ] Step 4: Run: `node --test tests/market.test.mjs` — Expected: 全部通过

### Task 2: client 纯函数 `searchSourceOf` 与响应收敛

- 目标：搜索态 source 覆盖的可测纯逻辑 + `sourceCounts` 穿过响应收敛层。
- 涉及文件：`src/client/market-state.js`、`tests/client-market-state.test.mjs`
- 接口契约：
  - Consumes: `normalizeMarketQuery` 产出的 query 形状 `{ zone, source: 'community'|'primary', query, ... }`（market-state.js:50-68）。
  - Produces:
    - `searchSourceOf(query)`：`query` 为对象且 `typeof query.query === 'string' && query.query !== ''` → 返回 `'all'`；否则返回 `query.source === 'primary' ? 'primary' : 'community'`（防御缺 source 的旧调用方）。
    - `normalizeMarketResponse` 返回对象增可选键 `sourceCounts`：raw.body 中 `sourceCounts` 为对象且 `primary`/`community` 均为有限数字时收敛为 `{ primary, community }`，否则**不产生该键**（缺失 = 摘要行不渲染的降级信号）。
- 验证范围：searchSourceOf 三分支；收敛正反例。

- [ ] Step 1: 写失败测试——`tests/client-market-state.test.mjs` 解构区（:11-22）加 `searchSourceOf`，新增 describe：
  - `{ query: 'x' }` → `'all'`；`{ query: '' , source: 'community' }` → `'community'`；`{ query: '', source: 'primary' }` → `'primary'`；`{ query: 'x', source: 'primary' }` → `'all'`（搜索态无视本区 source）；`undefined`/非对象 → `'community'`。
  - `normalizeMarketResponse`：body 带 `sourceCounts: { primary: 2, community: 3 }` → 返回值同键同值；body 不带 → 返回值 `'sourceCounts' in result === false`；畸形值（字符串/缺字段）→ 同样不产生键。
- [ ] Step 2: Run: `node --test tests/client-market-state.test.mjs` — Expected: 新用例失败
- [ ] Step 3: 实现 `searchSourceOf` 导出 + `normalizeMarketResponse` 收敛段（sourceCounts 置于返回对象 `categoryCounts` 之后）。
- [ ] Step 4: Run: `node --test tests/client-market-state.test.mjs` — Expected: 全部通过

### Task 3: GUI 接线——搜索全局、提交清分类、tab 计数去污染

- 目标：三处行为接线，全部为 `main.jsx` 内小改。
- 涉及文件：`src/client/main.jsx`
- 接口契约：
  - Consumes: Task 1 `MarketResult.sourceCounts`（透传可达）、Task 2 `searchSourceOf`、`normalizeMarketResponse` 已收敛的 `community.acceptedCount/displaced` 与 `registryState.count`（market-state.js:125-147 现状即可，零改动）。
  - Produces:
    - `useMarketData` 解构区（main.jsx:14）加 `searchSourceOf`；`fetchPage` params 的 `source: nextQuery.source || "community"`（main.jsx:595）改为 `source: searchSourceOf(nextQuery)`。
    - SearchBox 的 `onCommit`（main.jsx:1274）改为 `(v) => updateQuery(v ? { query: v, category: null } : { query: v })`——提交非空搜索时清空激活分类（共识 #7 防呆；清空搜索不恢复分类，回纯浏览态）。
    - tab 计数（main.jsx:1251-1256）：`z.id === "community"` 分支改为 `markets.community.data && markets.community.data.community.status !== "disabled" && markets.community.data.community.status !== "unavailable" ? Math.max(0, markets.community.data.community.acceptedCount - markets.community.data.community.displaced) : 0`；`z.id === "primary"` 分支改为 `(markets.primary.data && markets.primary.data.registryState.count) || 0`；favorites 分支不变。计数语义：与查询状态无关的恒定值；社区加载失败（unavailable）时计 0（现有 `zCount ? ... : ""` 渲染会隐藏 0，可接受）。
- 验证范围：构建 + 渲染冒烟 + 人工检查单（搜索态 tab 计数恒定、社区区搜索返回含精选条目）。

- [ ] Step 1: 改动前观察——Run: `npm run build` — Expected: 基线构建通过
- [ ] Step 2: 实现三处接线（组参 / onCommit / zCount）
- [ ] Step 3: Run: `npm run build && node --test tests/client-render-smoke.test.mjs` — Expected: 构建与 SSR 渲染冒烟通过（自由变量/接线炸弹回归门）

### Task 4: 搜索态呈现——摘要行、页内分组、精选徽章、chips 隐藏、筛选迁移

- 目标：共识 #2/#3 的全部呈现层改动。
- 涉及文件：`src/client/main.jsx`
- 接口契约：
  - Consumes: Task 2 收敛后的 `data.sourceCounts`；现有 `zone.primary`/`zone.community` i18n 键；现有 `filterTrigger`/`filterPop`（main.jsx:1429-1470）与 `ZoneChips` 渲染点（main.jsx:1482-1489）。
  - Produces:
    - `const searching = Boolean(query && query.query)`（MarketTab 内派生常量，紧跟 `market` 解构之后；不加 hooks）。
    - **摘要行**：`searching && data && data.sourceCounts && !loading && !error` 时渲染 `div.dsvm-searchmeta`：文案 `lookup("search.summary", { n: sourceCounts.primary, m: sourceCounts.community })`（`lookup` 模板插值有 `notify.installed` 先例）；行尾（社区区）挂现 `filterTrigger`。位置：notice 行之后、卡片列表之前（即搜索态下 `ZoneChips` 行的位置）。`!loading` 门控理由：fetch 期间 `data` 保留上一浏览态响应，其 `sourceCounts` 形如 `{ primary: 0, community: N }`，不门控会先闪现错误数字再跳变；门控后摘要行随新响应一起出现（代价仅瞬态隐藏，与卡片列表的加载行为一致）。`!error` 门控（执行评审 S1 补记，同 motivation）：请求失败时 `data` 仍是旧浏览态响应，卡片位已换错误行，摘要行不得以旧计数冒充搜索命中数。
    - **chips 隐藏**：`searching` 时 `ZoneChips` 整行不渲染（`trailing` 的 filterTrigger 随之消失，由摘要行接管）。
    - **筛选弹层搜索态裁剪**：`filterPop` 的「排序字段」「排列方向」两组仅在 `!searching` 时渲染；「每页条数」组恒渲染（main.jsx:1435-1453）。`filterTrigger` 维持社区区限定不变。
    - **页内分组**：卡片列表渲染改为两段式，两个段头**各自仅在对应段非空时渲染**（三种组合全覆盖：两段均有 → 精选段头+精选卡+社区段头+社区卡；仅精选命中/社区段空 → 只渲染精选段头+精选卡，**不渲染悬空的社区段头**；仅社区命中/精选段空 → 维持现状单列表、无段头）。段头是独立 DOM 元素插在 `.dshm-cards` 容器内卡片序列之间（**不是**往 items 数组里插字符串）。卡片渲染本体复用现有 `Card({...})` 调用，仅 map 的数据源按段拆分。段头样式类 `dsvm-grouphead`。
    - **新样式**：两条规则补在 main.jsx 内嵌样式表（`.dshm-hint`/`.dsvm-filterpop` 所在区，约 main.jsx:300-330）——`.dsvm-searchmeta`（与 `.dshm-hint` 同族的弱化行：caption 色 12px，行内 flex、右侧留筛选按钮间距）与 `.dsvm-grouphead`（弱化小字 + 上下留白，**必须带 `grid-column: 1 / -1`**——`.dshm-cards` 是两列 grid（main.jsx:391 `repeat(2, minmax(0,1fr))`），缺跨列声明段头会占半格与卡片同行错排）。
    - **精选徽章**：卡片 badges 数组（main.jsx:1531-1536）在 `searching && it.community !== true` 时追加 `h("span", { className: "dshm-badge", key: "cz" }, lookup("zone.primary"))`（与 verified 徽章同族样式）。
    - **翻页回顶锚点跟随**：`gotoPage` 的 `querySelector(".dsvm-chipswrap")`（main.jsx:1230-1232）在搜索态下因 chips 行隐藏而静默失锚——改为按态取锚：`searching ? ".dsvm-searchmeta" : ".dsvm-chipswrap"`（守卫写法保持不变）。
    - **i18n**：zh 表 `search.ph`（main.jsx:46）改 `"搜索名称 / 描述 / 标签（社区 + 精选）…"`，新增 `"search.summary": "⭐ 精选 {n} · 社区 {m}"`（与 `badge.community` 同行区，main.jsx:88 附近）；en 表 `search.ph`（main.jsx:154）改 `"Search all plugins — name, description, tags…"`, 新增 `"search.summary": "⭐ Curated {n} · Community {m}"`（main.jsx:196 附近）。`lookup` 的 `{n}/{m}` 插值沿用现有模板机制。
- 验证范围：构建 + 渲染冒烟 + 人工检查单（分组/摘要行/筛选迁移/双语/翻页回顶）。

- [ ] Step 1: 实现 `searching` 派生、摘要行、chips 隐藏、筛选裁剪、分组渲染、徽章、翻页锚点、i18n 八件
- [ ] Step 2: Run: `npm run build && node --test tests/client-render-smoke.test.mjs && npm test` — Expected: 构建通过、SSR 冒烟通过、全量测试通过
- [ ] Step 3: 人工检查单（owner 在 live DSH Web 执行，并入最终验证汇总）：
  - 社区区搜索关键词 → 摘要行出现且计数与卡片数吻合；精选命中置顶带段头与「精选」徽章；分类 chips 消失；「筛选」按钮在摘要行尾且弹层只有页大小组
  - 清空搜索 → 回社区浏览态：chips 恢复、排序组恢复、无摘要行无段头
  - 精选区搜索 → 同样全局命中；清空回精选策展序
  - 搜索前后 tab 计数恒定（社区/精选数字不随查询变）
  - 先点一个分类 chip 再输入关键词提交 → 分类被清空（结果跨区）
  - 刷新面板 → 默认首页快照秒开不受影响；收藏区 stale 检测正常（回归）
  - 搜索态翻页 → 视口回到摘要行顶部（新锚点生效）
  - 切英文界面 → placeholder 与摘要行英文正常

### Task 5: 版本与文档收口

- 目标：0.9.25 发版材料一次备齐（push/publish 动作不在本计划内，留主人确认）；设计文档与术语表随实现同步，避免漂移（先例：0.7.0 分区制计划 Task 16 Step 3 的 DESIGN.md 通读核对）。
- 涉及文件：`package.json`、`README.md`、`README.en.md`、`CHANGELOG.md`、`docs/DESIGN.md`、`GLOSSARY.md`
- 接口契约：
  - Produces:
    - `package.json` version `0.9.25`。
    - README 双语市场章节补一句「搜索为跨区全局（社区 + 精选一并命中），浏览保持分区」。
    - CHANGELOG 0.9.25 条目列四件事：跨区搜索、摘要行与页内分组、tab 计数修复、搜索提交清空激活分类。
    - `docs/DESIGN.md` §2.6：在市场行为语义处补「搜索为跨区全局（社区 + 精选一并命中），浏览保持分区；各区状态实例独立性不因搜索态改变」一句，并**通读 §2.5/§2.6 全文核对**无与本实现自相矛盾的残留表述（尤其「各区独立状态实例：分类、搜索、排序、分页互不重置」一句——实例独立性未被破坏，但「搜索」语义已变，须与 README 措辞一致）。
    - `GLOSSARY.md`：「社区区/精选区」条目（自带独立的分类、搜索、排序、分页状态处）补「搜索 = 跨区全局」半句，或新增「跨区搜索」术语条目（二选一，以改动最小为准）。
- 验证范围：构建 + 全量测试 + 文本核对。

- [ ] Step 1: 版本号 + README 双语 + CHANGELOG
- [ ] Step 2: DESIGN.md §2.6 补句 + 通读核对；GLOSSARY 术语同步
- [ ] Step 3: Run: `npm run build && npm test` — Expected: 全部通过

## 风险与回退

1. **sourceCounts 缺失/畸形**：客户端按形状收敛降级（缺失 = 摘要行不渲染，列表行为不变）——已内建于 Task 2 收敛契约，无新增风险面。
2. **回退方式**：revert 本次提交即可整体回退。无持久化格式变更（localStorage 快照读写双侧均有形状护栏 market-snapshot.js:108-114，新旧版本互害不成立；收藏/操作记录存储不触碰）。
3. **主要运行时风险 = 精选区首次搜索触发社区目录加载**：共识 #1 已论证无额外成本——社区区是默认落地 tab，面板挂载即启动社区共享 flight，精选区搜索命中的是已加载/在途缓存；即便社区加载失败，`source='all'` 降级返回主清单命中（Q42 出页不返空），摘要行如实显示 `社区 0`。
4. **瞬态旧计数**：fetch 期间摘要行不渲染（`!loading` 门控，Task 4），无错误数字闪现。

## 执行纪律

- 开始实现前，先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行（Task 1→5），不要无声跳步、合并步或改变任务目标。
- 每完成一个任务，运行该任务定义的验证；人工检查单项目由 owner 在 live DSH Web 执行。
- 当前分支若在 `main`/`master` 且未获明确同意，开始实现前先向 owner 确认分支策略。
- 遇到阻塞、重复失败或计划与仓库现实不符（行号漂移按符号定位），立即停下说明，不要猜。
- push 与 npm publish 前经主人确认；publish 注意 staged 发布现象（know-how 018：绿 ≠ 已上架）。
- 全部任务完成后，运行最终验证并输出修改摘要。

## 最终验证

- Run: `npm run build && npm test` — Expected: 构建零错误；全量测试通过（含 ⑭ sourceCounts 与 searchSourceOf 新用例）。
- Run: `node lib/cli.js search --limit 3` — Expected: CLI 回归无变化（source 默认 all 语义不变）。
- Task 4 Step 3 人工检查单在 live DSH Web 逐项打勾。
- 可选：`dshm_search` 工具抽查一次社区关键词（回归三端同序未被本计划破坏）。

## 审阅 Checkpoint

- 计划正文结束。审阅通过前不进入实现；执行方默认为普通编码 agent 或人工执行者。
