# 合并市场物化：两级派生数据 memo 与探测驱动换代（0.9.68，ADR-0016）

「合并市场（Merged Market）」自 0.5.0 起就是 GLOSSARY 在案的领域概念，但代码中没有任何模块**拥有**它的物化形态：装配逻辑内联在 market.ts 的 `communityOutcome`（:558-602）里，每次 listMarket / listInstalledWithMeta 请求（缓存全命中的快路径也在内）都从四个模块的输出现场重组一遍——磁盘读 5.36MB 社区目录 + JSON.parse（实测 30–55ms）→ 容器校验 → 目录适配层重建 4,400 条（30–90ms）→ mergeRegistries + 下载量重排序（5–35ms）。触发面覆盖市场每次翻页/筛选/提交搜索、两段加载（ADR-0013）的每一段、已装页两段（ADR-0008）、`dshm_search` 每次工具调用、收藏 stale 检查每条。两个次生损耗：search-relevance.ts:78 的 WeakMap 归一化护栏因条目对象每请求重建而跨请求永不命中（冷 330ms vs 同对象热 8ms，40×）；installed↔条目匹配是 O(I×M) 双重扫描（market.ts:973 `matchInstalled` 与 :991 `probeLatest` 各一遍）。关键定性：以上全部是**同步 JS，阻塞 DSH 宿主事件循环** 65–400ms——市场每翻一页，宿主的 SSE 对话流、工具调用、一切 API 停摆那么久；「单用户宿主」的辩护在这一点上失效（单用户也会同时开着对话流）。

2026-10-10 性能架构审查（钢人过滤版报告）把本卡定为唯一 Strong 旗舰；grilling 两轮共 12 项裁决（Q1–Q8 + Q1'–Q4'）全部拍板。同日评审轮次 1（R1-1～R1-16）闭环后修订 v2：决策 3 精化（summary 不入代、落代条件按 catalog 在场、同步临界区替代 inFlight Map）、决策 6 精化（安装路径三处直连 mergedOutcome，不设第三级 memo）、决策 5 落实（outdated 循环一并查表）；评审轮次 2（R2-1/2/3）闭环后修订 v3：deadlineRace 随迁环三方向断、reject 透传语义、双索引（merged 域读路径 + 全量域安装路径，id-让位条目语义零变化）。实施计划 `docs/plans/2026-10-10-merged-market-materialization-implementation-plan.md` v3。

## 决策

1. **两级 memo，各持天然安全的键**：
   - **L1（community.ts 内部）**：已解析目录 memo，键 = (namespace, profile, version)。安全性由构造保证——目录 body 文件名 version-pin 不可变（`catalog-{version}.json`，atomicWrite 新版本写新文件），同键即同字节，零失效逻辑。readCache 的 TTL 快路径与同版本短路（⑫）均不再重付 body parse + 容器校验。
   - **L2（新模块 `src/core/merged-market.ts`）**：物化合并市场 memo，键 = (namespace, profile, registry 身份〔cacheKey + configuredAddress + fetchedAt〕, 目录 version + pin + communityCatalog 开关)。value = merged 条目数组 + 社区 summary + 匹配索引。registry 侧不另设 memo（缓存文件 ~10KB，读+校验 ~1ms，顺带取回身份字段）。
2. **探测驱动换代，不做事件驱动**：每次请求照常走 loadRegistry / fetchCommunityCatalog 的廉价快路径（meta.json 141B + registry ~10KB ≈ 1–2ms），以返回的身份字段查代际键；命中即回，miss 即建。不引入 SWR 落地回调（多一处可漏的失效通道——ADR-0006 的教训是失效通道单一就有盲区）；force 语义免费：force 后 fetchedAt 变化 → 自然 miss。
3. **同步临界区保证并发去重；summary 永不入代；失败形态不落代**（v2 精化，R1-3/R1-11）：`mergedOutcome` 的全部 await 位于键派生之前，键派生→查 store→adapt→merge→index→set 为全同步临界区——并发同键调用由单线程串行穿越天然去重，「只建一次」以 builds 计数断言（初版设想的 inFlight Map 在同步临界区设计下是观察不到的死代码，删除）。代内只存随 version 稳定的 `{ merged, counts, adaptWarnings, categoryLabelsEn, lookupInstalled }`；summary 每调用由当次 state 现算——status/checkedAt/errors 永远新鲜，SWR 窗口与⑫同版本短路不再产生可观察漂移。落代/读代条件 = community 正常 resolve 且 catalog 在场（ready 或 stale，同 version 内容恒等）；deadline 逃逸、unavailable、disabled、task=null 一律透传现算（disabled 透传成本 ≈ 主清单 22 条 join，无物化价值）——不改变重试节奏。
4. **内存上界：L1 cap=2、L2 cap=4**（v2 精化，R1-13）：各按身份键存最新代，超限淘汰最旧写入（LATEST_CACHE_MAX 先例）。内存估算：L1 每条 ≈15–20MB（5.36MB JSON 的解析对象 ≈3–4× 放大）、L2 每代 ≈6–10MB（adapt 条目 + 索引）——合计最坏 ≈80MB、常态（各 1 条）≈25MB。不搞 LRU 计数——身份组合常态 ≤2，cap 只防理论爆炸。
5. **匹配索引进代**：随 merge 一遍构建 npm 名→条目 / github owner-repo→条目两张 Map，经模块小方法暴露查询（不外泄 Map 本体）；`matchInstalled`、`probeLatest`、outdated 循环从 O(I×M) 降为 O(I)。
6. **import 环随卡消解；安装路径三处直连物化模块**（v2 精化 R1-2/R1-9；v3 补 R2-1/2/3）：`communityOutcome` + `deadlineRace`（其唯一 await 依赖，market.ts 反向值导入，不构成环）+ `mergeRegistries` + `communitySummary` 及其私有辅助、`COMMUNITY_CATEGORY_LABELS`（communitySummary 的值依赖，不迁则环只是从 market↔community 平移为 merged-market↔community）整体迁入 merged-market.ts；community.ts 对 labels 原位 re-export（cli/tools 零改动）、对 community.js 符号 merged-market 只用 `import type`——环三方向断（community→market、merged-market→community 值导入、merged-market→market 值导入）。模块 interface：入参 `{ namespace, profile, cfg, registry 加载结果, communityTask, deadlineAt }`，出参 `{ merged, summary, lookupInstalled, findById, lookupInstalledAll }`——不越权接管 loadRegistry/fetchCommunityCatalog 的编排（那是 listMarket 的职责），只拥有「结果 → 物化」一段。**双索引**：读路径（listMarket/listInstalledWithMeta）用 merged 域 `lookupInstalled`（今日语义即 merged）；安装/升级三处（resolveRegistryEntry、upgradePlugin 社区查条目、profile-ops desktop 升级——调用现场均已持有 LoadedRegistry）用全量域 `findById`/`lookupInstalledAll`（[primary..., adapt 全量...] 含 displaced 让位条目——id-让位条目今日可装可升，语义零变化）。**reject 语义**：communityTask reject 透传（与 communityOutcome 同构），安装侧既有窄 try/catch 保留。不设「adapt-only」第三级 memo（维持决策 1 的两级制；三处的每装机 4,400 条重 adapt 随之消失，含 desktop 升级）。
7. **score-once 单遍化（第一刀）**：market.ts:781-795 的 filter pass 与 rank pass 合并为单遍 `{entry, score, idx}`（tie-break 按 idx 稳定，语义零变化）。
8. **搜索字段预归一化不进代**：条目对象随代稳定后，search-relevance 的 WeakMap 自动跨请求命中（实测 330ms → 8ms），零新接口；预归一化字段数组是「优化的优化」，等实测不够再说。

## 与 ADR-0006 的划界（本 ADR 的立论前提）

ADR-0006 否决的是 **latest 探测值缓存**——真值在远端 registry、本地无失效信号，落盘后在发版窗口内必然陈旧。本 ADR 物化的是**本地文件的派生数据**：失效键全部来自确定性文件身份（registry cacheKey+fetchedAt、目录 version-pin 文件名、pin、开关），身份变即整体重建。「探测值缓存 ≠ 派生数据 memo」——伤疤不遗传，但纪律遗传：失效通道必须多于零且不可绕过（探测驱动 = 每请求必查身份，无「忘掉失效」的死角）。

## Considered Options

- **一个大模块拥有磁盘→parse→adapt→merge**：需把 runChain 的 SWR/TTL/probe 逻辑搬进新模块，diff 大且逻辑复制——被否（两级各持天然键更小更稳）。
- **只做 L2（合并级 memo），重付 5MB parse**：最大头（30–55ms/请求）没解决——被否。
- **事件驱动失效（SWR 落地回调 + onRouteSwitch 式钩子）**：多一处可漏的同步点；探测驱动天然正确且每请求成本 ~1–2ms——被否。
- **失败/unavailable 形态也落代**：会改变重试节奏（现状每请求重试 probe），且失败态身份不稳定——被否（留作独立决策）。
- **预归一化搜索字段进代**：WeakMap 自然生效已拿到 40×，加层是 YAGNI——暂缓。
- **无上界或全量 LRU**：身份组合常态 ≤2，cap=4 已防理论爆炸，LRU 计数器是复杂度白付——被否。
- **维持现状**：钢人最强辩护（「单用户无人抱怨」「缓存有伤疤」）被两点驳倒——事件循环阻塞影响宿主全部并发响应；目录月增 ~50 条且 0006 伤疤属另一类缓存——被否。

## Consequences

- **性能预期**：翻页/筛选 ~100ms → ~10ms（稳态，同代）；提交搜索 ~400ms → ~20ms（WeakMap 热后评分 8ms）；宿主事件循环不再被市场交互阻塞。首请求（miss）成本与现状相同。
- **验收断言（五条，grilling Q8 在案）**：① 代命中 = 同身份两调返回同一 merged 数组引用，身份变即新引用；② single-flight = 并发双 miss 只执行一次 adapt+merge（maxInFlight 式探针）；③ 失败不落代 = deadline/unavailable 后紧跟正常调用无旧代残留；④ L1 = 同 version 两次 readCache，body 文件只读一次；⑤ 回归 = 现有 1289 例全绿 + typecheck 零错误 + 同 fixture 输出与物化前逐字节等价。
- **行为零变化承诺**：ADR-0003 运行时合并语义、ADR-0006 latest 内存制度、ADR-0008/0013 两段加载与探测模式、ADR-0012 读分类路由全部不动；两段加载第一段（cache-only）只是不再重付管线。
- **发布形态**：单版本 0.9.68，四层 commit（L1 parse memo → 模块+搬家+解环 → 四消费点接线 → score-once）。
- **GLOSSARY**：新增「物化合并市场（Materialized Merged Market）」术语（已入档，紧随「合并市场」）。
- **测试面迁移**：market.test.mjs 的 calls harness 扩展；community.test.mjs 增 body 读计数用例；communityOutcome 相关既有断言改为从 merged-market.ts 导入。
