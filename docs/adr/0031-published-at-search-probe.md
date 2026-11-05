# 搜索发布时间探查：读时 packument + 24h 磁盘缓存（ADR-0031，2026-11-05）

发起自 issue #45（`dshm search` 结果无任何时效信号，8,655 条社区目录里同类功能高度重复、无法判断谁还在维护）＋ grill 决策（2026-11-05 对话，Q1–Q8）＋ 独立评审（R1–R7 全闭环，台账 `.dsh-research/published-at-plan-review-scratch/ledger.md`）。搜索路径自 0.7.0 起刻意 **metadata-only**（不构造全量 latest，性能护栏在案）；发布时刻的唯一权威源是 npm 全量 packument 的 `time` 字段——abbreviated packument（`install-v1` Accept 头）刻意裁掉 `time`，本仓 packument 访问器全链不带 abbreviated 头（httpx.ts 缺省 `accept: application/json`），取到的即全量文档。搜索页逐条拉全量 packument 冷缓存约 3.7s/10 条（报告者实测），而 latest 探测走 `/pkg/latest` 小端点，两者成本不同量级。

## 我们决定（2026-11-05，grill 决议 Q1–Q8）

1. **路线 A′（Q1）**：读时逐条 packument 取数 + **本地磁盘持久缓存**摊销——store 为 profile 无关共享文件 `<cacheDir()>/published-at/store.json`（`npm-route.json` 先例），键 = `包名 + 生效 registry`，TTL **24h 硬过期 + 同步重取**，只存成功值（失败不落盘，负缓存仍走 packument 访问器内存 5min），上限 2 万条淘汰最旧；不做上游目录烘焙（不碰 awesome-dsh，主人裁决）。
2. **时间语义（Q2）**：`time.modified`（包级最后发布活动时刻，回退各版本时刻最大值、排除 `created`），不用 `dist-tags.latest` 版本时刻——`modified` 恰是「还发过版吗」的维护信号，免 distTags 派生。
3. **架构归属（Q3）**：core `listMarket` 拥有编排（新查询选项 `withPublishedAt`，**默认 false**——缺省态三端输出逐字节零漂移，golden 不重生成）；`src/core/published-at.ts` 为发布时刻取数与磁盘缓存唯一属主；`MarketDeps.publishedAt` 注入。
4. **开启范围（Q4）**：tools `dshm_search` 与 CLI `search` 恒开（含无 query 浏览页，deadline 兜底）；GUI 列表不开（零列表成本），详情弹窗打开时经新 host-api 单条 action `published-at` 取数（磁盘命中零网络）；拒绝全目录预热。
5. **失败形态（Q6）**：fail-open——单条失败/超时 → 该条 `publishedAt` 缺席（缺失不产生键）+ 页级 `publishedAtComplete=false`（条件键，仅选项开启时存在于返回体）；并发 ≤8、共享 deadline；回盘自身失败吞错、仍返回已取得值（持久缓存降级为进程内 memo）。
6. **展示（Q7）**：tools 条目行尾 ` · 发布 <date>（<N> 天前|今天）` + items JSON `publishedAt`；CLI 条目下 `最后发布 …` 行；GUI 弹窗 kv 行（i18n 中英）；非 npm 条目不显示、不用 `added` 兜底（GLOSSARY 明文两者语义不得混用）。

## Considered Options

- **方案 B `--fresh` 阈值过滤**：报告者自测数据证明当前生态（中位 9 天、0 条 >90 天）阈值无区分度——否决。
- **方案 C 仅详情页**：草堆里逐条点开不可行，信号缺席——否决。
- **原案 A 无持久缓存**：每次翻页/重搜全额打网（cap=4 内存缓存形同虚设）——否决。
- **7 天 TTL**：误差上界 7 天，恰落在 0–14 天判断敏感区（34% 条目 7 天内真发版；沉寂复活包被持续显示为陈旧）——否决，改 24h。
- **SWR（先回旧值后台刷新）**：一次性 tools/CLI 调用里后台刷新救不了当次显示——否决。
- **上游目录烘焙 `lastPublishedAt`**：查询时零网络的最优终态，但跨仓 PR 循环不可控（主人裁决不碰上游）——否决，本地缓存先行。
- **扩 `PACKUMENT_CAP`**：内存缓存属安装预检语义（cap=4 钉例在案），发布时刻的广度由磁盘 store 承担——不动。

## Consequences

- **与 ADR-0006 的界线**：latest 是快变量（内存缓存、重启即失效是特性）；发布时刻是慢变量（磁盘持久、24h 误差上界在天粒度展示下不可见——人类/agent 的维护判断阈值是周/月粒度，≤24h 误差不翻转任何判断）。快/慢变量分治自此有案。
- **陈旧度有界**：显示值最多滞后 24h；每包每天至多重取一次，同日重复搜索零网络。
- **零漂移承诺（CODING-STANDARDS 承诺格）**：缺省态 `listMarket` 返回体逐字节不变（golden 8 captures 钉）；`publishedAtComplete` 为条件键。
- **天数口径双产地**：core `publishedAtParts`（tools/CLI）与 client 弹窗内联（展示格式化不入属主，B3）语义一致——**天数口径变化需两处同步**（本条即同步提醒）。
- **大载荷通道（实测修复 2026-11-05）**：重型包会被共享访问器缺省 `maxBytes: 8MB` 确定性拒绝（billion-context：8096 版本 / 32MB packument 实测，929ms 拿到 time.modified）——本模块生产取数通道经 `makeLargeFetcher` 抬至 64MB（`PUBLISHED_AT_MAX_BYTES`），共享访问器缺省值与其余消费面不动；弹窗 action 超时相应 12s → 20s。
- **弹窗占位行（主人实测反馈修复 2026-11-05）**：GUI 详情弹窗对 npm 条目**首帧恒渲染该行**——loading 显「…」、取数失败显「—」（弹窗既有无数据惯例，不冒充「很旧/很新」）、值原位替换——行高恒定，消除行插入引发的弹窗高度跳变（`.dsvm-modalbox` 高度随内容自适应）；列表面（tools/CLI）失败仍为行缺席，口径不变。
- **同名异义**：`MarketItem.publishedAt`（包级 ISO string）区别于 `release-age.ts` 版本级 `publishedAt`（epoch ms，发布等待期）——两处 docstring/注释互指。
- **断言面**：`tests/published-at.test.mjs`（16 例）、market/tools-search/cli-search/host-api/host-api-profile/client-render-smoke 各增 describe；既有钉例零改动（Step 0 四类普查在案：计划 §Task 3）。
