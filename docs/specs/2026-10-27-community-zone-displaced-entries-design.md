# 社区浏览视图收录「让位条目」设计（精选 ∧ 社区双收录可见性）

- 日期：2026-10-27
- 状态：待审批（CHECKPOINT B）
- 上游共识：主人 2026-10-27 两轮澄清（Q1 展示形态选 A；Q2 搜索语义选 A），brainstorming 记录见当轮会话

## 背景与目标

`mergeRegistries`（merged-market.ts:122-147，ADR-0003）的合并语义是「主清单恒优先」：社区条目撞 npm / github / id 任一身份键即**被丢弃**，仅在 summary 留 `displaced` 计数与一条 warning。后果：一个插件若同时被精选清单收录、又被社区目录收录，则在社区 tab 翻页**永远不可见**（主人 2026-10-27 发现并确认）。

目标：

1. 社区浏览视图（社区 tab 翻页）成为社区目录的**完整镜像**——双收录条目翻得到，卡片以「精选收录」徽章标注身份；
2. **搜索语义零变化**——搜索态（有关键词，恒跨区）的结果集与今天逐字节一致，让位条目不进搜索池；
3. 安装/升级路径零变化——让位条目沿用社区条目既有 spec 与流程。

## 范围与非范围

**范围**：`mergeRegistries` 物化层保留带标让位条目；`listMarket` 分区/搜索过滤语义拆分；社区卡片「精选收录」徽章（client + i18n）；相关单测/golden/实机验证。

**非范围**：让位判定规则本身（npm/github/id 三键与「社区内部首条优先」不变）；收藏区；安装/升级流；上游 `dsh-plugin-catalog` 数据格式；ADR-0025 图标链（正交）；identityKey 内容指纹备案（独立软项）。

## 方案比较（已裁决，主人 2026-10-27）

| 方案 | 结论 |
|---|---|
| A. 社区条目原样 + 「精选收录」徽章；搜索池维持现状（让位条目不进池） | **采纳** |
| B. 显示精选条目版本 + 「来自社区」标记 | 否——社区特有元数据（stars/downloads/双语描述/截图）缺失；社区区混入非社区数据源，口径混乱 |
| C. 尾部独立分组，不混入主流分页 | 否——仍难发现，分组与 chips 计数语义纠缠 |
| 搜索池纳入让位条目（双显或另选代表） | 否——搜索无增量价值（精选版本已置顶），双显是噪音、另选代表是口径混乱 |

## 关键边界、组件与职责

1. **`mergeRegistries`（merged-market.ts）**：让位条目从「丢弃」改「**保留并打标**」。`CommunityEntry` 增 `primaryOverlap?: true`（dsh-m 物化层自身语义标记，非上游字段，community-adapter 不产出）。`items` = 主清单 + kept + displaced（打标后全部参与既有排序：30 天下载量降序，让位条目自带 downloads 自然归位）。`displaced` 计数语义沿用（= primaryOverlap 条目总数）；warning 文案随语义改为「N 条社区条目同时被主清单收录（社区列表中标注）」。
2. **`listMarket`（market.ts）**：
   - 浏览态（`terms` 为空）：`zoned` 全量放行——社区区（source='community'）含打标条目，counts/total/分页天然含之（「社区 6586」→「6586+N」属预期镜像语义）；
   - 搜索态（`terms` 非空）：`filtered` 排除 `primaryOverlap` 条目——搜索结果与今天逐字节一致（精选版本作为唯一代表置顶，curatedFirst 逻辑不动）。
3. **身份索引与安装/升级目标解析排除打标条目（自检增补，2026-10-27）**：merged-market 为双索引架构——`mergedIndex`（身份解析域：findById / byNpm / byGithub / lookupInstalled）与 `fullIndex`（全量域：升级按 npm 跨全量查找）。打标条目**只进展示列表、chips 计数与徽章渲染，不进 `mergedIndex`**——即「merged 域身份解析不含 displaced、primary 同 id 恒优先、displaced 经 fullIndex 仍可升级」的今日契约逐字维持（回归锚：tests/merged-market.test.mjs L210-215 三断言零改动继续绿）。若打标条目混入 mergedIndex，升级目标解析与安装语义将偏离，违反本设计「安装/升级路径零变化」承诺。
3. **client `market-tab.jsx`**：卡片 `badges` 数组增「精选收录」徽章（`entry.primaryOverlap` 为真时），i18n 新键（拟 `badge.inCurated`，zh「精选收录」/ en "In curated"），样式复用 `.dshm-badge.info`。
4. **类型**：`CommunityEntry` 增 `primaryOverlap?: true`；market-golden fixture 的 displaced 条目（dup / keepc）将带此字段。

## 数据流 / 控制流

```
社区 catalog → mergeRegistries（kept + displaced 打标，合并集参与排序）
  → 物化代际（identityKey 语义不变）
  → listMarket
      ├─ terms 空（浏览）：zoned 全量 → counts/total 含让位条目 → 卡片带徽章
      └─ terms 非空（搜索）：过滤 primaryOverlap → 结果与今日一致（curated 置顶）
```

浏览态边界钉死：浏览态恒有 `source ∈ {community, primary}`（面板市场区只有社区/精选两个浏览子 tab，收藏走 favorites.list 独立通道）；`source` 缺省（undefined，即聚合池）**只出现在搜索态**。因此不存在「无 query + 聚合池」的浏览视图，精选条目与打标条目不会在任何浏览视图同屏双显。

注意：物化代际的 `identityKey` **不含 registry 内容**（既有已知备案），本设计不改变其键语义——让位条目纳入后 merged 内容随源数据变化，代际按既有 fetchedAt 机制正常换代。

## 错误处理

无新增失败面：让位条目安装/详情/收藏沿用社区条目既有路径（spec、install 命令、compat 检查全部同构）；徽章为纯展示字段，缺省不渲染。

## 测试策略

1. `mergeRegistries` 单测：让位条目保留且 `primaryOverlap: true`；kept 语义不变；`displaced` 计数正确；社区内部首条优先不受影响。
2. merged-market 既有回归锚零改动继续绿：findById primary 同 id 恒优先 / lookupInstalled 对 displaced undefined / displaced 经 fullIndex 仍可升级（merged-market.test.mjs L210-215）。
3. market-golden：fixture 含 2 条 displaced（dup / keepc）→ `UPDATE_GOLDEN=1` 重生成基线，diff 审查其只增加徽章字段与条目。
4. `listMarket` 视图测试：无 query 的社区区含 displaced 条目（带 `primaryOverlap`）；带 query 的搜索结果不含（与改造前基线一致）。
5. client：徽章渲染（源码锚/渲染冒烟）+ i18n 键完整性守卫。
6. 实机：社区 tab 翻页见「精选收录」徽章卡；搜索同名无双显；精选 tab 无变化。

## 未决事项

- 徽章最终文案与 i18n 键名（默认「精选收录」/ `badge.inCurated`，实施计划层定稿）；
- 顺带：GLOSSARY 增「让位（Displacement）」术语条目（本设计落地时一并写）。
