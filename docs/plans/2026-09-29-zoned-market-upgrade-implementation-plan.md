# dsh-m 0.7.0 双清单分区市场实施计划

## 目标

按 DESIGN.md §2.6 / ADR-0004 落地：市场从「合并混排」改为**分区制**（社区默认 tab / 精选 / 收藏），补齐社区区浏览设施（分类 chips 折叠、排序、byline 信号、页码窗口化、相关性搜索），详情升级为 Modal 超集，操作状态升级为全局持久化操作记录（含恢复执行器），`dshm_search`/CLI 契约重签。数据层（获取链、适配层校验、`mergeRegistries` 去重、ADR-0003）不动。

> v2（2026-09-29）：经独立评审与碰撞修订，共识记录见 [2026-09-29-zoned-market-upgrade-plan-review.md](./2026-09-29-zoned-market-upgrade-plan-review.md)。

## 架构快照

- 分区发生在**展示与查询层**：`listMarket` 增加 `source`（primary/community/all）与 `sort`，`categoryCounts` 改为分区计数；`mergeRegistries` 输出的 merged 序保持不变（primary 原序 + community downloads 降序），天然即两区的默认序。
- 搜索升级为**服务端相关性管线**（新 `src/core/search-relevance.ts` 纯函数），query 命中时相关性优先于用户排序；归一化结果按条目 memoize。
- GUI：`main.jsx` 的 MarketTab 拆为三分区（状态实例独立），纯逻辑下沉 `src/client/market-state.js`；新增 `src/client/operations.js`（操作记录 + 恢复执行器）与 `src/client/favorites.js`（收藏）两个纯模块 + Node 测试。
- 三端契约：`dshm_search` 与 `dshm search` 改用 `source`/`offset`，默认 limit 10。
- 社区原生 `version`（上游 dist-tags.latest 日更快照，npm 源条目 100% 携带）透传后作为 withLatest 探测失败时的展示兜底。

## 全局约束（逐字继承 DESIGN.md §2.6 + 评审共识）

- 数据层 `mergeRegistries` 去重不变（ADR-0003 架构不动）；社区区排除与主清单重复的条目（merged 中 `community === true` 者天然已排除 displaced）。
- 「分类保留原生值不转译」；Q40 共享过滤桶退役（各区 chips 独立）。
- 排序：`downloads | stars | added × asc/desc`，社区区默认 `downloads-desc`；**无下载量（github-only）≠ 0 下载**（永远排在有真实计数条目之后，彼此按 stars）。时间窗过滤**明确不做**。
- `source='primary'` 保留「零社区加载」优化：communityTask 不启动，community summary 以 skipped 语义呈现。
- 详情 Modal = 卡片超集；能力披露 + 红线**默认收起**；截图灯箱 **禁自动轮播**；安装确认走 Modal。
- 图片本机直连原图（IntersectionObserver + `loading=lazy` + `fetchPriority=low` 三层），**不引第三方缩略代理服务**。
- **目录版本兜底铁律**：社区原生 `version` 展示必须带「（目录快照）」来源标注，**不得参与 outdated 判定**（outdated 只认 withLatest 实时探测）。
- **deprecated/replacement 为前瞻性防御字段**：上游目录当前 0 次出现（字段形状对齐 dsh-market registry 类型）；展示层 truthy 判断、缺失 = 不渲染，无强依赖。
- **语言判定唯一源**：复用 main.jsx 现有 `browserLang()`（document lang 优先；映射 `en*` → en、其余（含未识别语言）→ zh、缺省 zh，与现实现 main.jsx:208-213 逐字一致）；不得另立 `navigator.language` 判定。
- 操作记录持久化 localStorage，恢复时逐条校验「此刻仍成立才**执行**，否则报告」；收藏只存浏览器 localStorage，不进 profile、不进服务端。
- 操作状态机含 `superseded`（良性前提消失，UI 中性样式呈现，不得显示为红色错误）。
- 工具/CLI：`source` 默认 `all`；`limit` 默认 10、clamp 1–80；`primary_only` / `--primary-only` 删除。
- 探测预算权衡（Q46 不动）：96/页为 opt-in（默认 24，低于现状默认 50），最坏情况被 60s deadline 框死为 latestError；人工验收阈值——**96/页冷缓存 latestError 比例 > 20% 即回退默认页大小并重议**。
- Backlog（本计划不做）：UI 完整双语字典、时间窗过滤、浏览层兼容徽章/过滤、组管理、个人备注、giscus 评论、静态官网、withLatest 探测上限。

## 输入工件

- 设计定稿：`docs/DESIGN.md` §2.6（0.7.0 grilling 定稿 2026-09-29）+ §2.5 修订标注
- 决策记录：`docs/adr/0004-zoned-market-display.md`
- 术语表：`GLOSSARY.md`（社区区/精选区/收藏/操作记录）
- 评审与碰撞共识：`docs/plans/2026-09-29-zoned-market-upgrade-plan-review.md`
- 现状证据：`/home/ubuntu/workspace/dshm-community-catalog-report.md`（行号可能随重构漂移，以符号定位为准）

## 文件结构与职责

- Modify: `src/core/community.ts`（CommunityRawEntry 补 `deprecated?/replacement?` 前瞻声明；分类标签表改名导出）
- Modify: `src/core/community-adapter.ts`（CommunityEntry bypass 补 `added/deprecated/replacement/install/downloadsStart/downloadsEnd/downloadsCheckedAt/version`）
- Modify: `src/core/market.ts`（MarketQuery 加 `source/sort`；分区过滤、分区计数、排序语义、相关性接入、toMarketItem 投影新字段、WITH_LATEST_MAX 50→96、source='primary' 跳过社区加载）
- Create: `src/core/search-relevance.ts`（归一化 + 相关性评分纯函数 + memoize）
- Modify: `src/core/host-api.ts`（market case：source/sort 透传、limit clamp 1..96 默认 24、categoryLabels 透传）
- Modify: `src/tools.ts`（dshm_search 重签 + renderSearch 重写）
- Modify: `src/cli.ts`（search 子命令参数、输出与 HELP 文本）
- Modify: `src/client/market-state.js`（分区化：状态工厂、chips 构建器、页码窗口化；删客户端标签副本/sortMergedItems/SHARED_BUCKETS）
- Modify: `src/client/main.jsx`（三分区 tab 壳、社区区 UI、精选区 UI、详情 Modal、操作面板、收藏区、已装侧跟随）
- Create: `src/client/operations.js`（操作记录纯模块 + localStorage 持久化 + 恢复校验 + 恢复执行器）
- Create: `src/client/favorites.js`（收藏纯模块 + stale 检测）
- Modify（条件）: `scripts/build.mjs`（组件改名时同步 marker 校验列表）
- Test: `tests/market.test.mjs`、`tests/community-adapter.test.mjs`、`tests/community.test.mjs`、`tests/host-api.test.mjs`、`tests/client-market-state.test.mjs`、`tests/tools-search.test.mjs`（新）、`tests/search-relevance.test.mjs`（新）、`tests/client-operations.test.mjs`（新）、`tests/client-favorites.test.mjs`（新）
- Modify: `package.json`（version 0.7.0）、`README.md` / `README.en.md`（市场章节）

边界保持稳定：`registry.json`、profile-transaction、community 拉取链（runChain）、设置页、`dshm_list`/`dshm_outdated` 等其余工具签名不动。

**收口纪律**：删除导出/状态的任务必须同任务内清理 `main.jsx` 全部引用——每个任务收口后仓库处于「构建 ✓ 测试 ✓ GUI 可运行」三态（GUI 可运行无法自动化，至少保证无悬空引用）。

## 任务清单

### Task 1: 适配层透传 bypass 字段全集

- 目标：社区条目的收录日期、弃用信息（前瞻）、安装命令、下载量窗口三要素、目录版本进入 MarketItem。
- 涉及文件：`src/core/community.ts`、`src/core/community-adapter.ts`、`src/core/market.ts`（toMarketItem）
- 接口契约：
  - Consumes: 上游原生字段——`added`（已声明 community.ts:43）、`owner`（已声明 community.ts:26，上游 4,382/4,382 条全携带，现仅用于 id 合成不进条目）、`install`、`downloadsStart/downloadsEnd/downloadsCheckedAt`、`version`（均已声明）；`deprecated?/replacement?` 为**前瞻性声明**（上游当前无此键，形状对齐 dsh-market registry 类型，上游落地后核对，见 Task 10）
  - Produces: `CommunityEntry` 与 `MarketItem` 同名 bypass/投影字段：`added?: string`、`deprecated?: boolean`、`replacement?: string | null`、`install?: string`、`downloadsStart?: string`、`downloadsEnd?: string`、`downloadsCheckedAt?: string`、`version?: string | null`、`owner?: string`（第 9 字段；truthy 缺失不渲染——精选条目无 owner 自然省略 byline 段；**不得**从合成 id 前缀解析 owner，id 经非法字符折叠展示会失真）。**version 铁律**：仅作展示兜底（带「目录快照」标注），不参与 outdated 判定；deprecated/replacement 展示层 truthy 判断、缺失 = 不渲染
- 验证范围：正反两例 fixture（带/不带 deprecated）的透传行为；缺省不产生键。

- [ ] Step 1: 写失败测试——`tests/community-adapter.test.mjs` 追加：全字段条目适配后 9 个新字段齐备；无这些字段的条目适配后 9 键均不存在
- [ ] Step 2: Run: `node --test tests/community-adapter.test.mjs` — Expected: 新用例失败
- [ ] Step 3: raw 类型补声明 + 适配层透传 + `toMarketItem` 投影
- [ ] Step 4: Run: `node --test tests/community-adapter.test.mjs && node --test tests/market.test.mjs` — Expected: 全部通过

### Task 2: `listMarket` 分区与排序契约

- 目标：核心列表服务支持 source 分区过滤、分区计数、显式排序；primary 保持零社区加载。
- 涉及文件：`src/core/market.ts`（`MarketQuery`、`listMarket` 过滤/计数/分页段、communityTask 启动逻辑）
- 接口契约：
  - Consumes: 现有 `MarketResult { items, total, offset, limit, categoryCounts, ... }` 结构；现有 `opts.primaryOnly` 跳过社区加载逻辑（market.ts communityTask 段）
  - Produces:
    - `MarketQuery.source?: 'primary' | 'community' | 'all'`（默认 `'all'`）；`MarketQuery.sort?: { field: 'downloads' | 'stars' | 'added'; dir: 'asc' | 'desc' }`
    - **source='primary' 时 communityTask 不启动**（零社区加载优化保留），community summary 以 `skipped` 语义呈现（status 值新增 `skipped`，非 disabled 非 error）
    - 分区过滤：primary = merged 非 community 保持原序；community = merged 中 `community === true`。**计数口径**：`categoryCounts` = 分区集合（不含 query/category 过滤，chips 需要全区计数）；`total` = 分区集合 ∩ query ∩ category
    - 默认序：不传 sort 时维持 merged 现序；显式 sort 覆盖：`downloads` 缺失 ≠ 0（无计数者恒排有计数者之后，彼此按 stars 再 name）；`stars` 缺失视为 -1；`added` 缺失视为最旧（空串日期），YYYY-MM-DD 字符串比较；末级 tie-break `name` localeCompare
    - 过渡 shim：`primaryOnly === true` 内部映射为 `source: 'primary'`（标注 `@deprecated`，Task 7 删除）
- 验证范围：分区过滤、两种计数口径、三种排序字段 × 方向、无数据语义、shim 等价性、primary 零社区加载。

- [ ] Step 1: 写失败测试——`tests/market.test.mjs` 追加：source=primary 只含主清单条目且 categoryCounts 只计主清单（chips 口径：叠加 category 过滤后 categoryCounts 不变、total 变小）；source=community 反之；sort stars/added/asc-desc 各一例；downloads 排序无计数条目排在有计数之后；source=primary 时社区 loader 零调用（mock 断言）；primaryOnly 与 source=primary 等价
- [ ] Step 2: Run: `node --test tests/market.test.mjs` — Expected: 新用例失败
- [ ] Step 3: 实现 `MarketQuery` 扩展 + 分区过滤 + `sortEntries(entries, sort)` + 双口径计数 + communityTask 按 source 短路；**同步改写** `tests/market.test.mjs:1025-1028` 的 community 断言（primaryOnly 场景 summary 由 disabled → skipped，否则本任务收口必红）
- [ ] Step 4: Run: `node --test tests/market.test.mjs` — Expected: 全部通过

### Task 3: 搜索相关性管线

- 目标：query 搜索从「substring 命中」升级为归一化 + 字段加权相关性，命中时相关性优先；id 精确查找有保证。
- 涉及文件：Create `src/core/search-relevance.ts`；`src/core/market.ts`（`searchableText` 替换为相关性调用）
- 接口契约：
  - Consumes: 条目字段 `id/name/description/tags/category`（社区另含 `descriptionEn`）
  - Produces:
    - `normalizeSearchText(input: string): string`——NFKC + 小写 + 中西文边界插空格（`MCP管理` ≈ `MCP 管理`）+ 标点归空格
    - `relevanceScore(entry, terms: string[]): number`——**id 为单列评分字段且优先级最高**：normalized id 精确匹配 = 最高分并保证命中返回且排首（收藏 stale 检测依赖此语义）；其余字段权重 name/npm 包名 700 · owner 400（社区条目取合成 id `owner--` 前缀段）· 首选语言描述 280 · 次选语言描述 240 · 分类 id 180；命中类型加分：精确 +300 / 前缀 +250 / 包含 +200 / 多词全命中 +150；多词要求同字段全命中，否则 0 分（id 精确匹配豁免此约束）
    - **按条目 memoize 归一化字段串**（模块级 WeakMap，键为 entry 对象）——4,400+ 条 × 每次搜索全量归一化的性能护栏
    - `listMarket` 中 query 非空时：`filtered = entries.filter(score > 0)`，排序 score 降序 →（用户 sort 或默认序）→ name；score 为 0 的条目不返回
- 验证范围：归一化边界（全半角/CJK 边界/标点）、id 精确匹配保证（含 `owner--name` 合成 id）、权重序、多词同字段、零分剔除、memoize 命中（同条目二次评分不重算归一化）。

- [ ] Step 1: 写失败测试——Create `tests/search-relevance.test.mjs`：normalizeSearchText 五类边界；id 精确匹配排首且 `owner--name` 形态命中；权重序（name 命中 > 描述命中 > 分类命中）与命中类型序（精确 > 前缀 > 包含）；多词跨字段不命中；memoize 二次调用不重算（计数器侧信道）
- [ ] Step 2: Run: `node --test tests/search-relevance.test.mjs` — Expected: 失败（模块不存在）
- [ ] Step 3: 实现 `search-relevance.ts`；`market.ts` 过滤段替换为相关性调用
- [ ] Step 4: Run: `node --test tests/search-relevance.test.mjs && node --test tests/market.test.mjs` — Expected: 全部通过（market 既有 substring 用例按新语义修正：单词包含命中仍返回，仅排序变化）

### Task 4: 分类标签单一事实源

- 目标：社区分类中文标签由 core 独家提供，GUI 消费服务端数据。
- 涉及文件：`src/core/community.ts`（改名导出）、`src/core/market.ts`（community summary 附 labels）、`src/core/host-api.ts`（透传）
- 接口契约：
  - Consumes: `community.ts:66` **已导出的** `COMMUNITY_KNOWN_CATEGORIES`（本任务为改名，非首次导出）
  - Produces: 改名 `export const COMMUNITY_CATEGORY_LABELS: Record<string, string>`（内部消费点同步）；`MarketResult.community.categoryLabels?: Record<string, string>`（status 非 disabled/skipped 时携带）；host-api market 响应原样透传该键
- 验证范围：真实断言落 core 层（summary 附带），host-api 仅透传冒烟。

- [ ] Step 1: 写失败测试——`tests/market.test.mjs` 追加：listMarket 结果 `community.categoryLabels` 存在且含 `theme: '主题与外观'`；`tests/host-api.test.mjs` 仅追加透传冒烟（mock fixture 加键 → 响应含键）
- [ ] Step 2: Run: `node --test tests/market.test.mjs` — Expected: 新用例失败
- [ ] Step 3: 改名 + summary 附带 + host-api 透传 + **改造既有具名导入**：`tests/community.test.mjs:13`（`COMMUNITY_KNOWN_CATEGORIES` → `COMMUNITY_CATEGORY_LABELS`）及其用例（:98-110）同步改名
- [ ] Step 4: Run: `node --test tests/market.test.mjs && node --test tests/community.test.mjs && node --test tests/host-api.test.mjs` — Expected: 全部通过

### Task 5: `dshm_search` 工具重签

- 目标：agent 工具对齐分区制与真翻页，输出补全信号字段。
- 涉及文件：`src/tools.ts`（dshm_search 定义 + `renderSearch`）
- 接口契约：
  - Consumes: Task 2 的 `source`、Task 1 的 bypass 字段、Task 4 的标签表
  - Produces:
    - 参数：`query` / `category` / `source('primary'|'community'|'all'，默认 all)` / `limit(默认 10，clamp 1–80)` / `offset(默认 0)`；`primary_only` 删除（工具参数不暴露 sort——排序是 GUI 概念）
    - 输出 item 增加 `community: boolean`、`downloads?/stars?`、`categoryLabel?`（社区分类中文标签，未知分类回退 slug）；顶层增加 `source`、`offset`、`nextOffset: number | null`（`offset + items.length < total` 时为 `offset + items.length`，否则 null）
    - 工具 description 重写：说明双清单规模（主清单精选 + 社区 4000+）、`source` 分区语义、`offset` 翻页语义、默认 10 条；删除「registry is curated & small」
    - `renderSearch`：编号列表每条附 `[社区]` 标记与中文分类标签；尾行输出 `共 N 条 · 已显示 offset+1–offset+len · 传 offset=<nextOffset> 翻页`（nextOffset 为 null 时显示 `已到末尾`）
    - presentationMeta 卡片字段随 item 扩展（community/downloads/stars/categoryLabel）
- 验证范围：参数校验、默认值、nextOffset 计算、输出投影、render 文本。

- [ ] Step 1: 写失败测试——Create `tests/tools-search.test.mjs`：默认 limit=10；source=community 结果不含主清单条目；offset 翻页 nextOffset 正确、末页为 null；item 含 community/downloads/stars；非法 source 报错；renderSearch 文本含「[社区]」与翻页尾行
- [ ] Step 2: Run: `node --test tests/tools-search.test.mjs` — Expected: 失败
- [ ] Step 3: 重写 dshm_search 参数/execute/输出投影/renderSearch/description
- [ ] Step 4: Run: `node --test tests/tools-search.test.mjs && node --test tests/tools-summary.test.mjs && node --test tests/tools-install.test.mjs` — Expected: 全部通过

### Task 6: `dshm search` CLI 对齐

- 目标：CLI 与工具同语义，HELP 同步。
- 涉及文件：`src/cli.ts`（`case 'search'` :207 起 + HELP 文本 :157 附近）
- 接口契约：
  - Consumes: Task 2 `source`
  - Produces: `--source primary|community|all`（默认 all）、`--offset N`（默认 0）、`--limit N`（默认 10，clamp 1–80）；`--primary-only` 删除；**HELP 文本同步**（删 `--primary-only` 行、补新参数行）；输出尾行翻页提示（同 renderSearch 语义）；`DSHM_COMMUNITY_CATALOG=0` 行为不变
- 验证范围：参数解析、默认值、输出格式、HELP 一致性。

- [ ] Step 1: 改动前观察——Run: `npm run build && node lib/cli.js search --limit 2 && node lib/cli.js help` — Expected: 默认输出大量条目（现默认 80）；`--source community` 被**静默忽略**（parseArgs 不校验未知 flag，cli.ts:51-62）；HELP 仍列 `--primary-only`
- [ ] Step 2: 实现参数、输出与 HELP 文本
- [ ] Step 3: Run: `npm run build && node lib/cli.js search --limit 2 && node lib/cli.js search --source community --limit 2 --offset 2 && node lib/cli.js help` — Expected: 输出按 limit 截断、尾行有翻页提示；community 源翻页条目与第一页不重叠；HELP 含 `--source/--offset`、不含 `--primary-only`
- [ ] Step 4: Run: `npm test` — Expected: 全部通过

### Task 7: host-api market case 对齐新契约

- 目标：GUI 通道支持 source/sort/页大小，清除 primaryOnly shim；记录探测预算权衡。
- 涉及文件：`src/core/host-api.ts`（market case，约 :310-340）、`src/core/market.ts`（删 `primaryOnly` 字段）
- 接口契约：
  - Consumes: Task 2/4 产物；`WITH_LATEST_MAX`（market.ts，现值 50）
  - Produces: market case 接受 `source/sort/offset/limit`；limit clamp 1..96、默认 24；`WITH_LATEST_MAX` 50→96（**决策记录**：96 为 opt-in 页大小，默认 24 低于现状默认 50 的探测负载；最坏情况被 60s deadline 框死为 latestError，不阻塞列表；Q46「探测对象=页面条目」不动）；`MarketQuery.primaryOnly` 字段与 shim 删除；非法 source/sort 返回 400（与现有非法 category 400 同风格）
- 验证范围：参数透传、clamp、400 分支、既有测试改造、删除 shim 后全仓编译。

- [ ] Step 1: 写失败测试——`tests/host-api.test.mjs` 追加：source=community 生效；limit=96 被接受、limit=200 clamp 到 96、缺省 24；sort 透传（结果序变化）；`primaryOnly` 入参固定断言 400
- [ ] Step 2: **既有测试改造清单**（按文执行必红，逐条改写）：
  - `tests/market.test.mjs:132-138`「withLatest 最多 50」→ 改断言 96
  - `tests/market.test.mjs:1025-1028、1172`（primaryOnly 用例）→ 传参改为 `source='primary'`（community=skipped 断言已于 Task 2 改写；社区 loader 零调用断言保留）
  - `tests/host-api.test.mjs:243-264`「limit clamp 1..50、缺省 50」→ 改 1..96、缺省 24
  - `tests/host-api.test.mjs:603-617`「primaryOnly 透传」→ 改 source 透传
- [ ] Step 3: 实现 + 删 shim；全仓 grep `primaryOnly` 确认仅剩历史测试夹具中的无害引用或一并清理
- [ ] Step 4: Run: `npm run build && npm test` — Expected: 编译通过、全部通过
- [ ] Step 5: 人工检查单（并入 Task 10 后统一执行）——96/页冷缓存首访：记录加载时长与 npm 条目 latestError 比例；**latestError > 20% 即回退默认页大小并重议探测预算**

### Task 8: `market-state.js` 分区化重构

- 目标：客户端纯逻辑切到分区模型，删双份维护；收口时同步清理 main.jsx 引用。
- 涉及文件：`src/client/market-state.js`、`src/client/main.jsx`（最小适配）、`tests/client-market-state.test.mjs`
- 接口契约：
  - Consumes: Task 4 的 `community.categoryLabels`、Task 7 的 96 上限；main.jsx:14 现以 require 解构消费 `MARKET_PAGE_SIZE/splitCategories/sortMergedItems` 等 8 个导出
  - Produces:
    - `MARKET_PAGE_SIZES = [24, 48, 96]`、`DEFAULT_PAGE_SIZE = 24`（`MARKET_PAGE_SIZE = 50` 删除）
    - `createZoneState(zone: 'community' | 'primary')` → `{ zone, query: '', category: null, sort: community 默认 `{ field: 'downloads', dir: 'desc' }` / primary 为 `null`, pageSize: 24, offset: 0 }`
    - `normalizeMarketQuery(input, zone)`：query trim、category 白名单（primary=精选 5 ∪ slug 校验沿用、community=slug）、offset ≥ 0、limit clamp 1..96 默认 24、sort 合法化
    - `pageItems(current: number, total: number): (number | '...')[]`——窗口化 `1 … n-1 n n+1 … total`，总页数 ≤ 7 全显，首末页恒在
    - `zoneChips(categoryCounts, categoryLabels, zone): { id, label, count }[]`——primary 返回精选 5 类（顺序 market/tools/ui/search/other）；community 返回社区分类（已知用 labels 中文，未知 slug 原样进「新分类」尾组），**删除** `splitCategories/SHARED_BUCKETS/COMMUNITY_KNOWN_LABELS 客户端副本`
    - **删除** `sortMergedItems`（服务端单一排序源）
    - `resetPageOnFilterChange` 扩展：query/category/sort 变化均归零 offset
    - **main.jsx 同步最小适配**：更新 :14 解构与 :639-641 调用点（临时内联占位实现或直接切换新 API），保证本任务收口后构建 + 测试 + GUI 可运行（esbuild 对 CJS 解构缺失不报错，悬空引用是运行时炸弹，必须同任务清掉）
- 验证范围：状态工厂初值、normalize 边界、pageItems 窗口各形态、zoneChips 两区分组与未知分类、旧导出已删、main.jsx 无悬空引用。

- [ ] Step 1: 写失败测试——`tests/client-market-state.test.mjs` 重写分区用例（保留仍适用的 normalize/response 用例）：createZoneState 两区初值；pageItems（total≤7 全显 / 大 total 窗口 / 首末页恒在）；zoneChips primary/community/未知 slug；`import * as ms` 断言 `ms.sortMergedItems === undefined && ms.splitCategories === undefined`
- [ ] Step 2: Run: `node --test tests/client-market-state.test.mjs` — Expected: 失败
- [ ] Step 3: 重构实现 + main.jsx 最小适配
- [ ] Step 4: Run: `node --test tests/client-market-state.test.mjs && npm run build` — Expected: 通过；`grep -n "sortMergedItems\|splitCategories\|MARKET_PAGE_SIZE" src/client/main.jsx` 无残留

### Task 9: 市场 tab 壳与三区状态实例

- 目标：MarketTab 顶部分区切换「社区（默认）/ 精选 / 收藏」，各区状态互不重置。
- 涉及文件：`src/client/main.jsx`（MarketTab 及其内部组件）；条件 `scripts/build.mjs`
- 接口契约：
  - Consumes: Task 8 `createZoneState/normalizeMarketQuery`；现有 `useMarketData` 数据通道
  - Produces: 分区 tab 常量 `ZONE_TABS = [{ id: 'community', label: '社区' }, { id: 'primary', label: '精选' }, { id: 'favorites', label: '收藏' }]`，默认激活 community；每区持有独立 state（挂在 MarketTab 层，切 tab 不卸载不清空）；搜索框组件化（250ms debounce、IME composition 期间不提交、Enter/blur 立即提交、draft 与已提交 query 分离、清除按钮回焦）——替换现有 300ms debounce 输入；「只看主清单」chip 与 `total>200` 性能提示删除；双源 notice（marketNotice）保留在面板顶部。**注意**：若重命名 MarketPanel 等组件，同步更新 `scripts/build.mjs` 的 marker 校验列表（现含 MarketPanel/InstalledTab/SettingsTab/RestartBanner）
- 验证范围：DOM 结构无纯逻辑可测项——以构建 + 人工检查单验证。

- [ ] Step 1: 改动前观察——Run: `npm run build` — Expected: 构建通过（基线）
- [ ] Step 2: 实现 tab 壳 + 状态提升 + 搜索框组件；收藏区先渲染占位空态（Task 14 落地）
- [ ] Step 3: Run: `npm run build && npm test` — Expected: 构建与纯逻辑测试通过
- [ ] Step 4: 人工检查单（owner 在 live DSH Web 执行）——打开市场面板：默认落在「社区」tab；切到「精选」再切回，「社区」的搜索词/分类/页码保留；三 tab 互不干扰；IME 输入中文过程中列表不闪动

### Task 10: 社区区浏览设施

- 目标：补齐 dsh-market 同款浏览设施。
- 涉及文件：`src/client/main.jsx`（社区区组件）
- 接口契约：
  - Consumes: Task 8 `zoneChips/pageItems/MARKET_PAGE_SIZES`、Task 7 `source/sort`、Task 1 `added/deprecated/version`
  - Produces:
    - 分类 chips：默认收起两行 + 渲染后逐 chip 测量（`offsetTop`）裁剪 + 展开钮流内跟随；收起态激活分类若被裁则移到首位；面板 sticky 吸顶时缩为一行且不改写用户开合选择
    - 排序控件：单 Menu 三组（字段 downloads/stars/added × 方向 asc/desc），默认 downloads-desc
    - 分页器：页码窗口化（pageItems）+ 页大小选择 24/48/96 + 筛选变化重置页 1 + 翻页回滚列表顶部；替换现有 prev/next
    - 卡片 byline：`owner / downloads / ★stars`，hover Tooltip 给精确数（`title` 属性即可，不引组件依赖）；`deprecated` 条目名称旁徽章「已弃用」（truthy 判断、缺失不渲染）；withLatest 探测失败（latestError）时版本行回退显示 `v{version}（目录快照）`——目录版本不参与 outdated 判定
    - 描述 5 行钳制（CSS `-webkit-line-clamp: 5`），真实溢出才显示展开钮；**卡片描述语言取值**：复用现有 `browserLang()`（main.jsx:208-213，en*→en、其余→zh、缺省 zh）为唯一语言源，取 `description` 或 `descriptionEn`，目标语言缺失回退另一语言
    - 空态文案：搜索/筛选无匹配时显示「无匹配插件，试试其他关键词或分类」
    - 现有 50 条/页逻辑与 offset 语义对齐服务端
- 验证范围：构建 + 人工检查单（含 Task 7 Step 5 的探测预算阈值项）。

- [ ] Step 1: 实现全部组件（纯布局，无新纯逻辑——逻辑均已在 Task 8 测试）
- [ ] Step 2: Run: `npm run build && npm test` — Expected: 通过
- [ ] Step 3: 人工检查单——分类行收起两行、激活被裁分类置前、吸顶收缩；排序切换立即生效（downloads 与 added 序肉眼可辨差异）；页码窗口形态正确、末页不越界；byline 三信号与精确数 Tooltip 出现；「已弃用」徽章：**本地 fixture 注入验证**（临时在 tests/fixtures/community-catalog-sample.json 加一条含 deprecated/replacement 的条目走本地数据，或开发态注入，验证后移除注入源）；长描述 5 行截断有展开钮；96/页冷缓存 latestError 比例 ≤ 20%（超限回退默认页大小并重议）
- [ ] Step 4: **上游落地核对动作**（上游目录新版本出现 deprecated/replacement 键后执行）：跑 `node scripts/smoke-community-catalog.mjs` 对比字段形状与 dsh-market registry 类型声明是否一致（尤其 replacement 是 string 还是对象），不一致则修适配层

### Task 11: 精选区 UI

- 目标：主清单独立分区，策展序展示；自定义源边界可容纳。
- 涉及文件：`src/client/main.jsx`（精选区组件）
- 接口契约：
  - Consumes: Task 7 `source='primary'`（不传 sort）、Task 8 `createZoneState('primary')` 与 `zoneChips('primary')`、现有 verified/tags 渲染
  - Produces: **自适应单页**——total ≤ 96 时单页直出（当前 registry 22 条即此形态）、无分页器无排序控件；total > 96（自定义 registryUrl 用户，schema 上限 1,000 条）时降级复用社区区分页器（同套 pageItems/pageSize 组件）；卡片保留 verified 徽章与 tags 行；分类 chips 仅精选 5 枚；搜索框可用（区内搜索）
- 验证范围：构建 + 人工检查单。

- [ ] Step 1: 实现精选区组件（复用 Task 10 卡片骨架与分页组件，默认隐藏分页）
- [ ] Step 2: Run: `npm run build && npm test` — Expected: 通过
- [ ] Step 3: 人工检查单——精选区 22 条、策展序与 registry.json 顺序一致；verified 徽章与 tags 正常；默认无分页器与排序控件（可用自定义 registryUrl 指向 >96 条清单验证降级形态，可选）

### Task 12: 详情 Modal（卡片超集）与卡片瘦身

- 目标：详情升级为 Modal 超集，安装确认入 Modal，卡片迁出重内容。
- 涉及文件：`src/client/main.jsx`（Modal、卡片组件）
- 接口契约：
  - Consumes: Task 1 全部 bypass 字段（`install/downloadsStart/downloadsEnd/downloadsCheckedAt/version/added/deprecated/replacement` 此时均已就位）、Task 9/10/11 卡片数据；现有 peer 兼容确认弹窗与安装调用链
  - Produces:
    - Modal 内容 = 卡片超集：byline（owner/downloads/stars Tooltip 精确数）/ 分类 / 收录日期（added，无则不显示该行）/ 下载量窗口三要素（downloads + downloadsStart–End + checkedAt，缺省显示「无窗口数据」）/ 描述全文（语言取值同 Task 10 规则）/ 截图条 + 灯箱（←→/Esc 键盘、圆点导航、禁自动轮播）/ 能力披露 + 红线 DisclosureRow 默认收起（缺省「未扫描 ≠ 未检出」文案保留）/ 安装命令折叠行（社区原生 `install` 字段存在时优先展示原文；否则按 `source` 推导：npm 源 `dsh plugin --profile web add <npm 包名>`、github 源 `dsh plugin --profile web add github:<owner/repo>`）/ deprecated 条目 replacement 替代链接（truthy 判断）；精选条目另加 verified 清单与 tags
    - 安装/升级确认走 Modal 内主按钮；peer 不兼容确认在 Modal 内联呈现（复用现有确认逻辑，不改事务层）
    - 卡片瘦身：能力披露折叠区、截图、安装命令从卡片删除；社区详情旧折叠区组件删除
    - 截图**三层**懒加载：IntersectionObserver（进入视口 200px 才挂 src）+ `loading="lazy"` + `fetchPriority="low"`，本机直连原图 URL
- 验证范围：构建 + 人工检查单（事务层无改动，回归靠现有 tests）。

- [ ] Step 1: 实现 Modal + 灯箱 + 卡片瘦身
- [ ] Step 2: Run: `npm run build && npm test` — Expected: 通过
- [ ] Step 3: 人工检查单——卡片点开 Modal 内容不少于卡片信息；下载量窗口三要素出现（社区 npm 条目）；灯箱左右键与 Esc 可用、不自动轮播；能力披露默认收起；安装命令折叠行显示上游 install 原文（社区条目）；卡片上不再有截图/能力区；从 Modal 发起安装走既有确认流

### Task 13: 全局操作记录模型（含恢复执行器）

- 目标：操作状态脱离卡片，持久化、可恢复、可执行。
- 涉及文件：Create `src/client/operations.js`；`src/client/main.jsx`（OperationsPanel + 接线）；Create `tests/client-operations.test.mjs`
- 接口契约：
  - Consumes: 现有安装/升级/卸载/开关调用链（host-api），`window.localStorage`；installed 数据经 `useAsync(() => api("installed"))` 异步加载（main.jsx:1464）
  - Produces:
    - `type OpStatus = 'queued' | 'running' | 'input' | 'done' | 'warned' | 'failed' | 'superseded'`
    - `interface OperationRecord { id: string; kind: 'install' | 'upgrade' | 'uninstall' | 'toggle'; target: string; status: OpStatus; createdAt: number; updatedAt: number; error?: string; warning?: string; inputKind?: 'peer-incompatible' | 'force-needed' }`
    - `createOperationsStore(storage)`：`list()/upsert(record)/remove(id)/clearFinished()`（clearFinished 不清除 superseded/failed，仅 done/warned）；持久化 key `dshm-operations`，每次变更全量原子写（try/catch 配额/序列化失败静默降级内存态并置 `persistDegraded`）
    - `restoreRecords(records, stillApplies: (rec) => Promise<boolean>)`——**必须在 installed 数据 resolve 之后调用**（时序写死：main.jsx 在 useAsync installed 完成前不执行 restore，未到位时等待而非默认判定）：`queued` 逐条校验，成立 → 保持 queued 待执行；不成立 → `superseded` + note「恢复时前提消失」；`input`（待决确认）→ 一律 `failed` + error「待决确认不可恢复，请重新发起」；`running` → `failed` + error「进程重启中断」；done/warned/failed 原样保留
    - `drainRestored(store, dispatch: (rec) => Promise<void>)`——恢复执行器：按 FIFO 逐条 dispatch（复用现有 UI 调用链发起，**不新建事务路径**；后端 Profile 变更事务 FIFO 保证串行）；**dispatch 前二次校验**：以执行时实读（listInstalledPlugins 直读 profile 的现有 api("installed") 调用）复核前提，**禁止复用 restore 流程开头缓存的 installed 快照**；不成立 → `superseded`（良性前提消失如「已手动安装」，UI 中性样式呈现，不得显示为红色错误）
    - main.jsx：安装/升级/卸载/开关入口全部由 `busyId/busyPkg` 单飞状态改写为 store upsert；**busyId 与 busyPkg 的状态声明及全部 UI 引用（main.jsx:634/796/851/857/943/1033/1046/1098/1104/1111）本任务一次删净**（Task 15 不再承担清理）；OperationsPanel 列表（状态徽章 + 错误/警告文案 + 清除已完成）；卡片只显示「排队中/进行中」徽章点击打开面板；页面加载时序 = installed resolve → restoreRecords → drainRestored
- 验证范围：纯模块（状态机、持久化、恢复四分支、drain 二次校验、superseded 语义、时序）Node 测试；接线靠构建 + 人工检查单。

- [ ] Step 1: 写失败测试——Create `tests/client-operations.test.mjs`：upsert/list/remove/clearFinished；localStorage mock 持久化往返；restoreRecords 四分支（queued 成立 / queued 不成立 → superseded / input 恒 failed / running 标进程中断）；drainRestored 二次校验（成立执行 / 不成立 → superseded 且不 dispatch）+ 二次校验数据源为执行时实读（断言 dispatch 期重新查询而非复用入参快照）；superseded 记录 clearFinished 不清除；persist 异常降级不抛
- [ ] Step 2: Run: `node --test tests/client-operations.test.mjs` — Expected: 失败（模块不存在）
- [ ] Step 3: 实现 `operations.js`
- [ ] Step 4: Run: `node --test tests/client-operations.test.mjs` — Expected: 通过
- [ ] Step 5: main.jsx 接线 + OperationsPanel + busyId/busyPkg 状态与引用一次删净；Run: `npm run build && npm test && grep -n "busyId\|busyPkg" src/client/main.jsx` — Expected: 构建/测试通过、grep 无残留
- [ ] Step 6: 人工检查单——发起安装后立即搜索/翻页，操作不丢且面板可见；刷新页面后：queued 未执行的记录**被真正执行**（恢复执行器 dispatch）且面板状态流转正确；构造「已手动安装」场景显示中性 superseded 而非红色错误；「全部更新」逐条入队（依赖 Task 15）

### Task 14: 收藏

- 目标：本地收藏 + 收藏区 + stale 清理。
- 涉及文件：Create `src/client/favorites.js`；`src/client/main.jsx`（收藏区 + 卡片收藏钮）；Create `tests/client-favorites.test.mjs`
- 接口契约：
  - Consumes: `window.localStorage`；host-api market case（`query` 精确检索做存在性校验）；Task 3 的 id 精确匹配保证
  - Produces:
    - `interface FavoriteEntry { id: string; savedAt: number; snapshot: { id; name; description; descriptionEn?; category; categoryLabel?; source; npm?; github?; homepage?; owner?; downloads?; stars?; added?; deprecated? } }`
    - `loadFavorites(storage): FavoriteEntry[]` / `saveFavorites(storage, list)`（key `dshm-favorites`，原子写 + 静默降级同 Task 13）
    - `partitionStale(favorites, lookup: (fav) => Promise<boolean>): Promise<{ live; stale }>`——并行 ≤ 8；main.jsx 侧 `lookup` 实现 = `listMarket({ query: fav.id, source: 'all', limit: 8 })` 后**结果集成员判定**（存在 `id === fav.id` 的条目即 live；不依赖 top-1，规避同名主清单条目挤位与合成 id 分词歧义——Task 3 已保证 id 精确匹配命中返回）
    - 收藏区 UI：卡片同社区区骨架（快照数据渲染）+ stale 提示条「N 条已从目录下架」+「清理失效收藏」按钮（remove stale）；卡片收藏钮 toggle（已收藏高亮）；空态文案「去市场点书签收藏」
- 验证范围：纯模块 Node 测试；UI 靠构建 + 人工检查单。

- [ ] Step 1: 写失败测试——Create `tests/client-favorites.test.mjs`：load/save 往返；partitionStale（mock lookup 命中/未命中/部分 reject 不中断，reject 视为 stale）；`owner--name` 形态 id 的 lookup 行为（配 Task 3 语义：id 精确命中）；持久化异常静默
- [ ] Step 2: Run: `node --test tests/client-favorites.test.mjs` — Expected: 失败
- [ ] Step 3: 实现 `favorites.js` — Run: `node --test tests/client-favorites.test.mjs` — Expected: 通过
- [ ] Step 4: main.jsx 收藏区 + 收藏钮接线；Run: `npm run build && npm test` — Expected: 通过
- [ ] Step 5: 人工检查单——收藏两条插件后刷新页面收藏仍在；构造 stale（临时改 localStorage 里一个 id）后提示条与清理按钮生效

### Task 15: 已装侧跟随一致化

- 目标：管理侧视觉与操作模型对齐发现侧（纯增量；busyPkg 清理已在 Task 13 完成）。
- 涉及文件：`src/client/main.jsx`（InstalledTab）
- 接口契约：
  - Consumes: Task 13 操作记录（升级/卸载/开关已入队）；现有 `listInstalledWithMeta` 数据
  - Produces: 「全部更新 (N)」按钮（N = outdated 计数，点击把全部 outdated 升级入队，串行由后端 FIFO 保证）+ 市场面板入口处的更新红点；已装卡片视觉对齐（byline/徽章/按钮风格与发现区同套类名）
- 验证范围：构建 + 人工检查单（升级事务链路无改动）。

- [ ] Step 1: 实现按钮 + 红点 + 视觉对齐
- [ ] Step 2: Run: `npm run build && npm test` — Expected: 通过
- [ ] Step 3: 人工检查单——有可更新插件时红点与「全部更新 (N)」出现；点击后操作面板逐条 running→done；无 outdated 时按钮隐藏

### Task 16: 版本、README 与文档交叉核对

- 目标：收口发版材料。
- 涉及文件：`package.json`、`README.md`、`README.en.md`、`docs/DESIGN.md`
- 接口契约：
  - Consumes: 全部前序任务
  - Produces: `package.json` version `0.7.0`；README 双语市场章节改为分区制描述（社区/精选/收藏、排序、翻页、操作记录）与 `dshm search --source/--offset` 用法；DESIGN.md 通读一遍确认 §2.6 与实现无冲突表述
- 验证范围：构建 + 全量测试 + 文本核对。

- [ ] Step 1: 版本号 + README 双语章节更新
- [ ] Step 2: Run: `npm run build && npm test` — Expected: 通过
- [ ] Step 3: 通读 DESIGN.md §2.5/§2.6 核对无自相矛盾 — Expected: 无需改动或仅措辞级修正

## 执行纪律

- 开始实现前，先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行（Task 1→16），不要无声跳步、合并步或改变任务目标；M3 内 Task 9 必须先于 10/11/12/14。
- **收口纪律**：删除导出/状态的任务必须同任务内清理 main.jsx 全部引用（Task 8/13 已按此拆分）；每个任务收口后「构建 ✓ 测试 ✓ GUI 无悬空引用」。
- 每完成一个任务，运行该任务定义的验证；人工检查单项目由 owner 在 live DSH Web（127.0.0.1:3080）执行，涉及插件重装遵循 workspace 既有流程。
- 遇到阻塞、重复失败或计划与仓库现实不符（行号漂移按符号定位），立即停下说明，不要猜。
- 当前分支若在 `main`/`master` 且未获明确同意，开始实现前先向 owner 确认分支策略。
- **实现开始前先把本批输入工件 commit 入库**（DESIGN.md / GLOSSARY.md / ADR-0004 / 两份 plan 文档），避免分支操作丢失 grilling 产出。
- 全部任务完成后，运行最终验证并输出修改摘要。

## 最终验证

- Run: `npm run build && npm test` — Expected: TypeScript + esbuild 构建零错误；Node test runner 全量通过（含 5 个新测试文件与 Task 7 改造清单中的改写用例）。
- Run: `node lib/cli.js search --limit 3 && node lib/cli.js search --source community --offset 3 --limit 3 && node lib/cli.js help` — Expected: 翻页不重叠、尾行有翻页提示、HELP 含新参数。
- 可选（网络可用时）：`node scripts/smoke-community-catalog.mjs` — Expected: accepted 条数在 4,000–4,600 区间（随上游日增漂移）、无 dirty。
- 人工检查单汇总执行（Task 9/10/11/12/13/14/15 各 Step 末项），在 live DSH Web 完成并逐项打勾。

## 审阅 Checkpoint

- 计划正文结束。审阅通过前不进入实现；执行方默认为普通编码 agent 或人工执行者。
