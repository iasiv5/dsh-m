# 社区浏览视图收录「让位条目」实施计划（精选 ∧ 社区双收录可见性）

- 日期：2026-10-27（R1 评审修订版）
- 仓库：`/home/ubuntu/workspace/dsh-m`（分支：main，直接开工——主人已确认本仓 main 直改惯例）
- 设计来源：`docs/specs/2026-10-27-community-zone-displaced-entries-design.md`（已批准，含自检增补的「身份索引排除」边界）
- 评审修订记录：R1-Q1（T1/T2 合并为单一可验证单元）、R1-Q2（L198-206 等价域适配显式化）、R1-Q3（golden displaced 条目名勘正为 dup/keepc）；行号漂移（HEAD 07f4b69）以「路径 + 符号锚」为准

## 目标

1. 社区浏览视图（社区 tab 翻页）成为社区目录**完整镜像**：被主清单让位的社区条目（撞 npm/github/id）保留出现，卡片带「精选收录」徽章；
2. **搜索语义零变化**：搜索态（`terms` 非空，恒跨区）结果与今天逐字节一致——让位条目不进搜索池；
3. **安装/升级路径零变化**：`mergedIndex` 身份解析域不含打标条目（primary 同 id 恒优先、`lookupInstalled` 对 displaced undefined、displaced 经 `fullIndex` 仍可升级——三条既有断言为回归锚）；
4. 社区计数从 6586 → 6586+N 属预期镜像语义（N = 主清单重叠让位数）。

## 架构快照（只讲本次相关接线；行号为 R1 时点参考，以符号锚为准）

- `mergeRegistries`（merged-market.ts）：主清单恒优先；社区条目撞 `primaryNpm`/`primaryGithub`/`primaryIds` → `displaced.push` **丢弃**；社区内部 `seenNpm` 撞 → 同样丢弃；返回 `{ items: [...primary, ...sorted(kept)], displaced: number, warnings }`。
- `buildGeneration`：`merged = merge.items`；`mergedIndex = buildMatchIndex(merge.items)`；`fullIndex = buildMatchIndex([...primary, ...adapted.entries])`（含 displaced——升级全量域）。`buildMatchIndex` 单域首现（min-ord）。
- `communityOutcome`（无 memo 路径）调 `mergeRegistries`，返回 `merged = merge.items`（无索引）；**全仓库唯一调用点 = `listInstalledWithMeta` 的 deadline 臂**（对 `community.merged` 是 `void` 丢弃，安装语义天然不受影响）；getCommunitySummary 走的是 **mergedOutcome**（community.ts，只取 outcome.summary）——merged 扩容对其零影响（评审 R2-Q5 勘正路径）。
- `listMarket`：`zoned` = merged 按 source 过滤（community/primary/全部）；`filtered` = zoned 上 category/query 过滤（terms 非空走 relevanceScore）；`counts`/`sourceCounts`/`total` 皆自 zoned/filtered 派生。
- client 卡片：`cardOf` 的 `badges` 数组，既有徽章键 `badge.deprecated` / `badge.internal` / `badge.update` / `badge.community` 等；i18n 双语块（zh 徽章键区 / en 徽章键区）。
- 验证基建：market-golden（`UPDATE_GOLDEN=1` 重生成基线；golden fixture 含 2 条 displaced：**`dup`（npm 撞）/ `keepc`（id 撞）**）；merged-market.test.mjs（fixture 含 `dualrepo`（github 撞）/ `keepc`（id 撞）；`displaced=2` 断言 + 三条身份解析回归锚）。

## 全局约束（从已批设计逐字继承）

1. **mergedIndex 身份解析域排除打标条目**（设计「关键边界 3」）：打标条目只进展示列表、chips 计数与徽章渲染，不进身份索引——merged-market.test.mjs 三条身份解析断言（findById primary 同 id 恒优先 / lookupInstalled 对 displaced undefined / displaced 经 fullIndex 仍可升级）零改动继续绿。
2. **搜索态过滤**：`terms` 非空时 `primaryOverlap` 条目不进 `filtered`（在既有过滤回调内实现，不新增并行管道）；浏览态（terms 空）放行。
3. **让位判定三键不变**；社区内部 `seenNpm` 重复**维持丢弃**（打标仅针对主清单重叠——徽章语义是「精选收录」，内部重复无此身份）。
4. `identityKey` 不动（不含 registry 内容的既有备案独立存在，本设计不搭车）。
5. `primaryOverlap?: true` 只由 `mergeRegistries` 物化层打标，community-adapter 不产出（非上游字段）。
6. 其余不动面：收藏区、安装/升级流、ADR-0025 图标链、`validateRegistry`、img-chain。

## 文件结构与职责

**修改**

| 文件 | 职责 |
|---|---|
| `src/core/merged-market.ts` | `mergeRegistries`：主清单重叠让位条目保留并打标 `primaryOverlap: true`（内部 `seenNpm` 重复维持丢弃）；warnings 文案改双语语义（精选重叠 N 条标注 + 内部去重 M 条丢弃，各一行）；`buildGeneration` 的 `mergedIndex` 构建排除 `primaryOverlap` 条目（`fullIndex` 不动） |
| `src/core/market.ts` | `listMarket` 的 `filtered` 回调：terms 非空时排除 `primaryOverlap` 条目 |
| `src/client/market-tab.jsx` | `cardOf` badges 增「精选收录」徽章（`it.primaryOverlap === true`） |
| `src/client/i18n.js` | 双语各增 `badge.inCurated`（zh「精选收录」/ en "In curated"） |
| `tests/merged-market.test.mjs` | 既有断言适配（displaced 计数语义、warning 文案、**读路径等价循环的计算域排除打标条目**）+ 新增：打标保留 / 内部去重丢弃 / 三条身份解析回归锚显式化 |
| `tests/market-golden`（fixtures + 基线） | displaced 条目（`dup` / `keepc`）带 `primaryOverlap` 进 items → 重生成基线并 diff 审查 |
| `tests/market-query.test.mjs`（或 market.test.mjs，以现场 harness 为准） | 视图测试：无 query 社区区含打标条目；有 query 搜索不含 |
| `src/client` 渲染锚测试 | 徽章渲染锚（client-render-smoke 或源码锚，按既有守卫形态） |
| `GLOSSARY.md` | 新增「让位（Displacement）」术语条目 |

**新建**：无（全部落既有文件）。

**边界保持稳定**：`identityKey`、`adaptCommunityCatalog`、`buildMatchIndex` 本体、安装/升级目标解析、收藏区、ADR-0025 图标链。

## 任务间接口契约（Consumes / Produces）

- **T1 Produces** → **T2/T3 Consumes**：`CommunityEntry.primaryOverlap?: true`（仅主清单重叠让位条目为 true；内部重复条目仍被丢弃不产键）；`mergeRegistries` 返回 `items` 含打标条目（参与既有下载量排序）；`displaced` 计数 = 打标条目总数；`mergedIndex` 身份解析域不含打标条目（findById/lookupInstalled 今日契约维持）。
- **T2 Produces** → **T3 Consumes**：`MarketItem.primaryOverlap` 经 `toMarketItem` 的 `...entry` 展开天然透传（MarketItem 类型显式增 `primaryOverlap?: true` 供 client）。
- **T3 Produces**：卡片徽章渲染 `it.primaryOverlap === true` → `lookup("badge.inCurated")`。

## 任务清单

### T1：`mergeRegistries` 打标 + `mergedIndex` 身份域排除（TDD，单一可验证单元）

> 评审 R1-Q1 修正：打标与索引排除互为同一语义变更的两半——拆开则中间态「merged 列表含打标条目但身份索引未排除」必然打红「merged 域不含 displaced」断言（lookupInstalled 命中打标条目），故合并为一个任务；读路径等价循环需同步适配（第 1 步），属预期适配而非回归。

1. 先改 `tests/merged-market.test.mjs`：
   - 新增用例：①主清单重叠条目出现在 `merge.items` 且 `primaryOverlap === true`；②社区内部 `seenNpm` 重复条目（两社区条目同 npm、主清单无）仍被丢弃且不计入 displaced——其中第二条附加 github 撞主清单字段（owner/repo 与主清单某条相同），断言其**仍被丢弃**（钉死段序读法①：内部去重短路优先于 github 撞打标，终审建议 1）；③warnings 含「同时被主清单收录」与内部去重计数（按第 3 步最终文案断言）；④组合用例：主清单有 npm X + 两条社区条目同 npm X → 双打标（两条都 `primaryOverlap: true` 进 items）、`displaced === 2`（评审 R2-Q6：钉死主清单判定先于内部去重的顺序语义）；
   - 预期适配点（非回归，评审 R1-Q2）：读路径等价循环的 `readExpected = outcome.merged.find(...)` 计算域需排除打标条目（`.filter((e) => e.primaryOverlap !== true)`）——merged 列表扩容后，等价断言两侧必须同域（mergedIndex 排除域），否则两条 displaced 夹具必红；
   - 三条身份解析回归锚**零改动**保留在原位——本任务验收红线。
2. 跑 `npm run build && node --test tests/merged-market.test.mjs` → 确认新增用例红（现状丢弃无打标；此时等价循环尚未适配，可能连带红——红灯记入日志，不作实现信号）。
3. 实现（同一提交单元，两处必须同步落地）：
   - `mergeRegistries`：循环内判定顺序规范（评审 R2-Q6）——**主清单身份撞（`primaryNpm`/`primaryGithub`/`primaryIds`）判定先于 `seenNpm` 内部去重**：主清单撞 → `kept.push({ ...c, primaryOverlap: true })`（主清单有 X 时，社区多条同 npm X 条目一律打标保留——镜像语义，用例④钉死）；仅内部 `seenNpm` 撞 → 维持丢弃（仅计数）。**段序读法锚定（终审建议 1）**：保持现有段结构——npm 段内 `primaryNpm` 先于 `seenNpm`，github/id 段维持现状段序；读法②「三键整体前置」不采纳（社区条目 npm 内部撞 ∧ github 撞主清单的组合今日 `seenNpm` 短路丢弃，读法②会静默改判打标，属 B4 边缘静默变化）；返回 `displaced` = 打标条目数（主清单重叠口径）；warnings 双行：`N 条社区条目同时被主清单收录（社区列表中标注）` + `M 条社区内部重复条目已去重`（M>0 时才出现）；排序段不变（kept+打标混排，均带 downloads 参与降序）。
   - `buildGeneration` 的 `mergedIndex`：`buildMatchIndex(merge.items.filter((e) => (e as CommunityEntry).primaryOverlap !== true))`，附注释引设计「关键边界 3」与回归锚位置；`fullIndex` 行不动。
   - 适配测试：读路径等价循环的 `readExpected` 按第 1 步口径排除打标条目。
4. `displaced === 2` 断言预期零改动即绿（dualrepo=github 撞、keepc=id 撞，皆主清单重叠）；若三条身份解析回归锚任一需改动才绿 → 实现错了，停下对设计复查。
5. `communityOutcome` 消费方核实（无索引构建，merged 自动含打标条目）：全仓库唯一调用点 = listInstalledWithMeta deadline 臂（`void community.merged` 丢弃，不受影响）；getCommunitySummary 走 mergedOutcome 只取 outcome.summary（merged 扩容零影响）——两处各留一行注释（评审 R2-Q5 勘正路径）。

验证：`npm run build && node --test tests/merged-market.test.mjs` 全绿（含零改动回归锚 + 适配后等价循环）；`npm run typecheck` 零错误。

### T2：`listMarket` 搜索池过滤 + 视图测试

1. `filtered` 回调 `if (terms.length === 0) return true` 之后插入：`if (terms.length > 0 && (entry as CommunityEntry).primaryOverlap === true) return false`，附注释引设计「搜索态零变化」。
2. `MarketItem` 类型增 `primaryOverlap?: true`（`...entry` 展开自动透传，显式声明供 client 消费）。
3. 视图测试（参照 market-golden.test.mjs 的 `goldDeps` 全桩形态——评审 R2-Q8：market-query.test.mjs 现无 listMarket harness、iconWiringDeps 是 listInstalledWithMeta 桩；落 market-query.test.mjs 新建，registry fixture 带 1 条社区重复条目）：
   - 无 query、source='community' → items 含打标条目（`primaryOverlap === true`）；
   - 同 query 命中该条目名称 → 结果不含它（其余条目照常）；
   - source='primary' 浏览 → 不含它（精选区现状不变）。

验证：`npm run build && node --test tests/market-query.test.mjs tests/market.test.mjs` 全绿；`npm run typecheck` 零错误。

### T3：client 徽章 + i18n

1. `i18n.js`：zh 徽章键区与 en 徽章键区各增 `"badge.inCurated": "精选收录"` / `"badge.inCurated": "In curated"`。
2. `cardOf` badges 数组尾部：`it.primaryOverlap === true ? h("span", { className: "dshm-badge info", key: "cur" }, lookup("badge.inCurated")) : null`。双徽章语义定案（评审 R2-Q7）：打标条目在社区区「社区收录」+「精选收录」并显是**预期视觉**——两个徽章各陈述一个事实（来自社区目录 ∧ 被精选收录），不做互斥抑制。
3. 渲染锚：按既有守卫形态补一条（client-render-smoke SSR 断言或源码锚，与 client-i18n 键完整性守卫全绿为准）。

验证：`npm run build && node --test tests/client-i18n.test.mjs tests/client-render-smoke.test.mjs` 全绿。

### T4：golden 重生成 + GLOSSARY + 提交

1. `UPDATE_GOLDEN=1 npm run build && node --test tests/market-golden.test.mjs` 重生成基线；`git diff tests/fixtures/market-golden.json` 人工审查按**三类白名单**（评审 R2-Q4——golden 捕获 8 场景全量返回，计数/文案衍生变化是镜像语义的必然 diff 面，不判漂移）：① 5 个浏览态场景：items 新增 `dup`/`keepc`（带 `primaryOverlap`、downloads 混排），且 total / categoryCounts / sourceCounts.community 同步 +2；② installed-none/installed-full：community.summary.warnings 双行文案变化；③ market-search（query:'gold'）：**items / total / sourceCounts 零变化**（B2 搜索语义核心承诺的 golden 级验证项——dup 今天不在搜索池，打标后仍被排除）；categoryCounts（zoned 派生，镜像语义必然 +2）与 warnings 文案的衍生变化按 R2-Q4 总则不判漂移（评审 R2-Q4/P1 口径统一）。白名单之外无其他漂移（github-撞维度由 merged-market.test 的 `dualrepo` 夹具覆盖，评审 R1-Q3）。
2. `GLOSSARY.md` 新增术语：

   > **让位（Displacement）**:
   > 合并去重时社区条目与主清单撞身份键（npm / github / id 任一）而让出展示位的动作。让位条目自 0.10.22 起保留在社区浏览列表（带「精选收录」徽章），但不进搜索池与身份解析域。
   > _Avoid_: 去重（只是结果之一，语义核心是主清单优先的让位）、冲突（无动作含义）、降级（等级含义错位）

3. `npm run typecheck && npm test` 全量绿后，分两个 commit：
   - ① `feat(core): 社区浏览视图收录让位条目——mergeRegistries 打标 primaryOverlap + mergedIndex 身份域排除 + 搜索池维持现状（设计 docs/specs/2026-10-27）`
   - ② `feat(client): 社区卡片「精选收录」徽章 + golden 重生成 + GLOSSARY 让位术语`

## 执行纪律

- 开工前批判性复查本计划；行号漂移以「路径 + 符号锚」为准；发现计划与仓库现实不符先停下说明。
- 按任务顺序执行，不无声跳步；每任务完成即跑其验证；阻塞即停。
- 当前在 main（主人已确认本仓 main 直改惯例）；**两个 commit 均在 T4 全量绿后按文件分组打入**（评审 R2-Q9）：core 文件含测试进①，client+golden+GLOSSARY 进②；T2/T4 为文件分组逻辑边界而非中途 commit 点（T1 起 golden 预期红至 T4.1 重生成）。
- 全部完成后输出修改摘要（文件 × 变更 × 验证结果）。

## 最终验证

1. `npm run typecheck` 零错误。
2. `npm test` 全量绿（以 T4 现场数字为准；基线 1783+ 新增）。
3. 实机手验（发版后或 link 态）：社区 tab 翻页见「精选收录」徽章卡、计数 6586→6586+N；搜索同名仅精选版本置顶单显；精选 tab 无变化；面板升级 dsh-m 自身（自换装）无异常。
