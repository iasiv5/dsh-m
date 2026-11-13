# 精选卡统计对齐：混合源、30 天口径与缺口直查（ADR-0036）

## 决策

- **卡面统一**：精选（primary）市场卡 byline 与社区卡同语法「by owner + 下载↓ + star★」；标签/实测行自卡面退役，信息由详情弹窗既有「标签」「实测版本」行承接（行内存续，查看动线变化：know-how 008 升级核对改走详情弹窗/dshm CLI）。
- **混合源**：①目录镜像 join 优先——`mergeRegistries` 以 npm 名优先、github 兜底把镜像社区条目的统计字段键级注记到 primary 条目（镜像字段 null → 不注记该键；两字段全缺的镜像不产生注记）；②缺口直查兜底——join 后仍无统计的精选条目（directGap）由 core 直接拉 npm bulk 下载量（point/last-month，≤128 包/批，scoped `/`→`%2F`）与 GitHub star（逐 repo，并发 ≤4），24h TTL 落盘缓存（`<cacheRoot>/<namespace>/curated-stats/stats.json`，atomicWrite）+ 刷新周期 GC。上游目录补录后 join 自然接管，直查对该条目自愈退场。缺口集 = 当前精选清单 − 目录镜像（动态，不硬编码；精选集增删自愈）。
- **口径**：恒为 npm 近 30 天窗口；不做 all-time 总量（npm 官方 API 无该端点——point 仅 last-day/week/month/year，range 全历史聚合对万级包不可行且有限流实测）。数字悬浮 title 口径透明：目录快照无前缀、直查带「npm · 」前缀，均携带窗口与查于时点。
- **排序**：joined 数值参与显式排序（downloads/stars 排序时精选条目按数值参与，「无数据垫底」语义保留——无统计条目仍垫底）。排序代码零改动（dlOf/starsOf 读 entry 字段）。
- **GitHub-only 条目**（无 npm 包）不做下载量；star 正常显示（镜像有则镜像供、缺口则直查拉）。不引入上游 githubReleaseDownloads（Release 资产全时累计）口径。
- **测试纪律**：真实直查兜底仅存在于生产工厂（marketDeps()/mergedOutcome 缺省）；测试夹具（fakeDeps/goldDeps）必须显式惰性桩，禁走真实网络。

## 背景

2026-11-13 主人对照两个市场界面：精选卡（标签+实测）与社区卡（by owner+下载↓+star★）信息语法不一致，且提出统计口径之问（总量 vs 30 天）。grill-with-docs 八问决议（Q1–Q8）+ 独立评审 10 项闭环（本计划 `docs/plans/2026-11-13-catalog-stats-alignment-implementation-plan.md`）。事实底座（当日实测）：上游目录 `dsh-plugin-catalog` 每日重建，条目自带 downloads/downloadsStart/End/CheckedAt/stars；37 条精选中镜像命中 25（npm 24 + github 兜底 1）、缺口 12 全带 npm；GitHub-only 1 条（joeseesun/qiaomu-rss-dsh，镜像 stars=28、downloads 全 null → join 注记 star、不入缺口）。上游 dshmarket 插件解剖：运行时零 API 调用、全部数字目录预计算——「上游预计算」是生态共识架构。

## 决策修订（2026-11-14，C 方案）

预览实测后修订：**精选卡只显示 npm 下载量，不显示 star**。动机：①区内统一优先于免费数据——B 案（join star 白拿、砍直查 gh）会让精选区 26 张有 ★/11 张没有，斑驳观感在实测中被主人判读为缺陷；②直查链路收窄为 npm bulk 单源（免认证、无限额、任何用户机器行为一致）——dsh-m 是公开发布插件，通用性权重高于本机完整度；③社区区保留 ★（上游目录保证完整），跨区语法差有可解释边界：社区数字=上游目录保证，精选数字=npm 单源自取。

落地口径：core 数据层执行（非渲染层）——join 只注记 downloads+窗口三要素+statsVia（不注记 stars，镜像仅有 star 无 downloads 的条目不入注记、进缺口）；直查 npmKeys-only（githubKeys/配对不传，gh 调用运行时归零，模块 gh/token 能力保留作未来 github-only 条目扩展）；annotateDirectStats 不注记 stars；客户端零改动（条件渲染自然隐藏）。收藏 overlay 语义修订：overlay 命中即权威——number 覆盖、**null 剥除**（精选收藏旧 star 残留随剥；原「null 保留快照」语义废止）。

## 决策修订三（2026-11-14，R10：gh star 直查整链退役）

预览复检后三次修订：精选/缺口的 **gh star 直查整链退役**（R6 配对合并、R8 token 通道、gh 拉取段与 githubKeys/entries 契约面一并删除）。动机：GitHub 匿名限额被宿主常规探测与直查共同耗尽（60/时/IP，实测 403），star 拉取在限额窗口内恒失败——时有时无的装饰性字段不值得持续消耗额度与故障面；且 C 方案已裁定精选卡不上 star，star 唯一来源是**上游目录镜像**（免费、随目录每日刷新——指社区区条目自身的 star，社区卡 star 来自目录条目，非 join 注记）。github-only 精选条目即使上游收录，join 按 C 方案也只注记 downloads 族：卡面仍无 star；镜像有下载量时经 join 点亮的也只是下载量。

落地：loadCuratedStats 收敛为 npm bulk + 缺键逐包 point 回退（下载量族单源，R7 缺键回退保留）；契约面移除 githubKeys/entries/ghToken；R6 mergePairedStars / R8 parseGhToken 代码退役。

## Considered Options

- **显示口径**：all-time 总量（否——npm 无端点、全历史聚合不可行）/ 30 天窗（采纳）/ 双显（否——成本翻倍、观感更挤）。
- **数据源**：registry.json 手工维护（否——必腐化）/ 自建全量统计管线（否——第二真值源造成同面板数字漂移）/ 镜像 join + 缺口直查混合（采纳——单一真值源优先、缺口兜底、自愈交接）。
- **直查发起端**：client 现拉（否——无跨端复用、缓存各自为政）/ core 服务端（采纳——GUI/tools/CLI 三端同源）。
- **排序**：display-only 字段（否——同一语义两个字段名）/ 参与排序（采纳——golden 与测试锚刻意更新）。
- **卡面**：保留标签+实测并加数字（否——观感不统一）/ 对齐替换（采纳——详情弹窗零信息损失）。

## Consequences

- merge 层 primary 条目新增注记字段（downloads/stars/downloadsStart/End/CheckedAt/statsVia）；MarketItem 同步；`dshm_search` 输出与 golden 基线刻意更新（diff 白名单：统计字段类新增与次序变化）。
- `existingMarketIds` stats 同批透出自动覆盖精选条目（join/直查同源），收藏卡 owner 门放宽（有数字即显数字；收藏 tooltip 保持 String(n)，不携带窗口）。
- 缺口直查 TTL 过期拉取失败**保留旧值**（装饰性指标 fail-open，本 ADR 备案）；缓存箱 `{version:1, fetchedAt, entries}`。
- 直查缺省真实兜底仅存在于生产工厂；测试夹具显式惰性桩（评审 R4⑩ 纪律，防 golden/单测竞速漏真实网络）。
- 版本与 CHANGELOG 随配套实施计划发版轮处理（当轮单独请批）。
