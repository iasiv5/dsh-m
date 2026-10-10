# 合并市场物化（Materialized Merged Market）实施计划

> v2（2026-10-10 评审轮次 1 修订）：吸收评审 R1-1～R1-16 全部意见；关键变更：L2 代不再存储 summary（每调用现算，消灭 stale/checkedAt 漂移）、取消第三级 adaptedCommunityEntries（安装路径三处直接消费 mergedOutcome）、删除 inFlight Map 改为同步临界区不变量、新增 Task 0 golden 等价测试、L1 cap 收紧为 2、COMMUNITY_CATEGORY_LABELS 随迁解环、补回退章节。
> v3（2026-10-10 评审轮次 2 修订）：R2-1 deadlineRace 随迁 + 环验证补第三方向；R2-2 mergedOutcome reject 透传（安装侧窄 try/catch 保留）；R2-3 代内增设全量索引 findById/lookupInstalledAll（含 displaced 让位条目），安装/升级三处用全量索引——read 路径维持 merged 语义，安装路径维持 adapt 全量语义，双侧零行为变化；R2-4 样例名单修正；R2-5 回退措辞改「逆序回退」；R2-6 lookupInstalled github 候选补 source 守卫。
> 设计共识来源：ADR-0016 v2（`docs/adr/0016-merged-market-materialization.md`）+ GLOSSARY「物化合并市场（Materialized Merged Market）」+ 性能审查钢人过滤版报告（`~/tmp/architecture-review-20261010-0300-steelman.html`）。

## 目标

- 消灭「每次市场请求重付 5MB 目录解析 + 4,400 条适配 + 全量合并」的宿主事件循环阻塞（实测 65–180ms/请求，搜索再加 330ms 冷评分）——同一身份的请求从第二次起走物化代，~100ms → ~10ms，搜索评分 330ms → ~8ms（WeakMap 热命中）。
- 「合并市场」获得拥有模块：adapt→merge→匹配索引的产物按身份键物化，失败形态不落代。
- 顺带消解 market.ts ↔ community.ts 的 import 环；installed↔条目匹配从 O(I×M) 双重扫描降为 O(I) 查表。

## 架构快照

两级 memo，各持天然安全的键；**summary 永不入代**：

| 层 | 位置 | 键 | 消灭的成本 | 上限 |
|---|---|---|---|---|
| L1 已解析目录 memo | community.ts `readCache` 内部 | `(dir, version)`——body 文件名 version-pin 不可变，同键即同字节 | 5.36MB 磁盘读 + JSON.parse + 容器校验（30–55ms） | cap=2（每条 ≈15–20MB 解析对象，最坏 ≈40MB） |
| L2 物化合并市场 | 新模块 `src/core/merged-market.ts` | `(namespace, profile, configuredAddress, fetchedAt, 目录 version, pin, 开关)` | adapt 4,400 条（30–90ms）+ merge+排序（5–35ms）+ 匹配索引重建 | cap=4（每代 ≈6–10MB，最坏 ≈40MB） |

- **代的内容**：`{ merged, counts, adaptWarnings, categoryLabelsEn, lookupInstalled }`——全部随 version 稳定。**不含 summary**：summary 由 `communitySummary(state, counts, warnings, labelsEn)` 每调用现算，state 取当次 community task 结果——status/checkedAt/errors 永远新鲜，SWR 窗口与⑫同版本短路（只更新 checkedAt）不再产生任何可观察漂移（R1-3）。
- **落代/读代条件**：community task 正常 resolve 且 **catalog 在场**（status ready 或 stale——同 version 内容恒等，二者等价）。deadline 逃逸、unavailable、disabled、task=null（source=primary）一律**透传**（现算、不读不写 L2）；disabled 透传成本 ≈ 主清单 22 条 join，无物化价值（ADR-0016 v2 对决策 3 的精化）。
- **并发去重 = 同步临界区不变量**（R1-11 修正，替代 inFlight Map）：`mergedOutcome` 的全部 await 都在键派生**之前**（deadline race / community task resolve）；键派生→查 store→adapt→merge→index→set 是**全同步区**——JS 单线程下并发调用串行穿越该区，第一个到达者完成 set，后来者必命中。「只建一次」由不变量保证，测试以 `builds` 计数断言。实现侧约束：该临界区内**禁止引入任何 await**（含看似无害的 I/O）。
- **探测驱动换代**：每请求照常走 loadRegistry / fetchCommunityCatalog 廉价快路径（registry ~10KB + meta.json 141B ≈ 1–2ms），以返回身份字段查 L2 键；命中即回。无事件/callback 连线。force 语义免费：force 后 fetchedAt 变化 → 自然 miss。
- **匹配索引与胜者语义**（R1-6/R2-6）：随 merge 一遍构建两张首现 Map（npm 名→{entry, ord}、github owner/repo→{entry, ord}，首现 = merged 序最前）；`lookupInstalled(installed)` 取三候选——`npm[it.pkg]`、`npm[it.name]`、`github[spec 前缀]`（**仅当 `it.source === 'github'`**，与 matchInstalledByEntry :430 守卫一致；spec 解析复用其正则，提为私有函数共用）——中 **ord 最小**者胜，与今日 `merged.find(matchInstalledByEntry)` 逐点等价。
- **双索引：merged 索引供读路径，全量索引供安装/升级路径**（R2-3）：mergeRegistries 的四类让位（displaced）社区条目不在 merged 内，但今日安装/升级的社区兜底在 **adapt 全量** entries 上查（:1813 按 id、:1833/profile-ops:607 按匹配）——id-让位条目今日可装可升。代内另存全量索引：`findById(id)`（[primary..., adapt 全量...] 序首现）与 `lookupInstalledAll(installed)`（同序 min-ord，三候选同上）——adapt 全量数组本来就是 merge 的输入，displaced 仅数条，边际成本可忽略。读路径（listMarket/listInstalledWithMeta）用 merged/lookupInstalled（今日语义即 merged），安装/升级三处用 findById/lookupInstalledAll（今日语义即全量），双侧零行为变化。
- **registry 未决降级**：`listInstalledWithMeta` 的 registry deadline 路径走无 memo 的 `communityOutcome`（原函数原签名保留），不把残缺身份写进 L2。
- **settings 页摘要**：`getCommunitySummary` 身份残缺（无 registry fetchedAt），固定走无 memo 的 `communityOutcome`。

## 全局约束（逐字继承 ADR-0016 v2）

- **行为零变化**：ADR-0003 运行时合并语义、ADR-0006 latest 内存制度、ADR-0008/0013 两段加载与探测模式、ADR-0012 读分类路由全部不动；两段加载第一段（cache-only）只是不再重付管线。
- 物化的是**本地文件的派生数据**，不是 latest 探测值（与 ADR-0006 划界）。
- 失败/超时/unavailable/disabled/task=null 形态**不落代**；并发去重由同步临界区不变量保证（builds 计数断言）；L1 cap=2、L2 cap=4。
- 发布形态：单版本 **0.9.68**，commit 分层：⓪golden ①L1 memo ②模块+搬家+解环 ③消费点接线 ④score-once ⑤release chore（⓪可并入 ① 提交或独立）。
- 无新增依赖；Node ≥ 22；命名遵循 GLOSSARY「物化合并市场（Materialized Merged Market）」。
- **风险与回退**（R1-16/R2-5）：本设计纯内存 memo——无持久化格式、无数据迁移、无 feature flag 需求；commit ①（L1 memo）与 ④（score-once）可独立 revert，②③ 存在符号依赖须**逆序回退**（revert ③④ 或 ②③④），revert 即回到逐请求重算现状。已知残余风险：L1/L2 常驻内存（最坏 ≈80MB，常态 ≈25MB，见架构快照表）；L2 临界区不变量被未来改动破坏（以 builds 计数断言为哨兵）。
- 验收五断言（ADR-0016 v2 Consequences）：①代命中=同身份两调 `merged` 数组引用同一（模块直测）+ `builds===1`（listMarket 集成）；②并发去重=双并发调用 `builds===1`；③失败不落代=deadline/unavailable 后正常调用无残留；④L1=同 version 两次 readCache，body 只读一次；⑤回归=golden 全字段等价 + 全量套件绿 + typecheck 零错误。

## 文件结构与职责

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/core/merged-market.ts` | 新建 | 深模块：`communityOutcome` 与 `deadlineRace`（原样迁入、无 memo）、`mergedOutcome`（memoized + `lookupInstalled` + `findById`/`lookupInstalledAll`）；迁入 `mergeRegistries`、`communitySummary` 三形态、`isCommunityEntry`、`matchInstalledByEntry`、**`COMMUNITY_CATEGORY_LABELS`**（R1-2）及相关类型；L2 代存储（cap=4）+ stats/reset 测试钩子 |
| `src/core/community.ts` | 修改 | readCache 内加 L1 body memo（cap=2）+ 测试钩子；`import { communityOutcome } from './merged-market.js'`（:14 改向）；`export { COMMUNITY_CATEGORY_LABELS } from './merged-market.js'`（cli.ts/tools.ts 零改动） |
| `src/core/market.ts` | 修改 | 删除迁出代码；re-export 值与**类型**（R1-10，见接口契约）；`listMarket`/`listInstalledWithMeta`/`resolveRegistryEntry`/`upgradePlugin` 切 `mergedOutcome`；`matchInstalled`/`probeLatest`/outdated 循环走查表；:781-795 评分单遍化（保序语义） |
| `src/core/profile-ops.ts` | 修改 | :601-607 社区查条目改走 `mergedOutcome`（R1-9/R1-14；调用处已持有 `loaded`） |
| `tests/market-golden.test.mjs` | 新建 | Task 0：固定 fixture 的全字段 golden 等价测试（UPDATE_GOLDEN=1 重生成） |
| `tests/merged-market.test.mjs` | 新建 | L2 断言①②③ + 胜者等价 + cap 淘汰 |
| `tests/community.test.mjs` | 修改 | L1 断言④ + beforeEach 接 reset 钩子 |
| `tests/market.test.mjs` | 修改 | beforeEach 接 `_resetMergedMarketForTests()`（R1-1：假身份跨用例脏代防护）；其余仅当符号路径变化时核对 |
| `CHANGELOG.md` / `package.json` | 修改 | 0.9.68 版本与条目 |

不动的边界：`community-adapter.ts`、`registry.ts`、`latest-cache.ts`、`search-relevance.ts`（WeakMap 原样）、`host-api.ts`、`tools.ts`、`cli.ts`（经 re-export 零改动；tools.ts 的 `type CommunityRegistrySummary` 由 market.ts 类型 re-export 覆盖）。

## 接口契约（Task 2 产出，Task 3/4 消费的唯一事实源）

```ts
// src/core/merged-market.ts 对外签名
export interface MergedGeneration {
  /** 合并条目（primary 在前 + 社区下载量序，不含让位条目）——同代引用稳定；读路径用 */
  merged: Array<RegistryEntry | CommunityEntry>
  /** summary 组装原料（随 version 稳定）；summary 本身每调用现算 */
  counts: { acceptedCount: number; upstreamCount: number; displaced: number; skippedDirty: number; skippedSubpathNoNpm: number }
  adaptWarnings: string[]
  categoryLabelsEn: Record<string, string>
  /** O(1) 匹配（merged 域）：三候选（npm[it.pkg]、npm[it.name]、github[spec]（仅 it.source==='github'））取 merged 序最前者胜 */
  lookupInstalled(installed: InstalledPlugin): RegistryEntry | CommunityEntry | undefined
  /** O(1)/O(1) 全量索引（[primary..., adapt 全量...] 域，含 displaced 让位条目）：安装/升级路径专用（R2-3） */
  findById(id: string): RegistryEntry | CommunityEntry | undefined
  lookupInstalledAll(installed: InstalledPlugin): RegistryEntry | CommunityEntry | undefined
}

export interface MergedOutcome {
  merged: Array<RegistryEntry | CommunityEntry>
  summary: CommunityRegistrySummary   // 每调用由 communitySummary(state, counts, warnings, labelsEn) 现算
  lookupInstalled(installed: InstalledPlugin): RegistryEntry | CommunityEntry | undefined
  findById(id: string): RegistryEntry | CommunityEntry | undefined
  lookupInstalledAll(installed: InstalledPlugin): RegistryEntry | CommunityEntry | undefined
}

/** memoized 主入口：内部 resolve communityTask → 派生身份键 → 查/建代（临界区全同步） */
export async function mergedOutcome(input: {
  namespace: RegistryCacheNamespace
  profile: string
  cfg: Pick<RegistryConfig, 'communityCatalogPin' | 'communityCatalog'>
  registry: LoadedRegistry
  communityTask: Promise<LoadedCommunity> | null
  deadlineAt: number
}): Promise<MergedOutcome>
// 落代/读代：仅 community 正常 resolve 且 catalog 在场（ready|stale）；
// deadline / unavailable / disabled / task=null → 透传现算（不读不写 store）。
// reject 语义（R2-2）：communityTask reject 时与今日 communityOutcome 同构——异常透传给调用方；
// listMarket/listInstalledWithMeta 维持冒泡（现状），安装/升级三处调用侧保留既有窄 try/catch。

/** 原样迁入、无 memo（getCommunitySummary 与 registry-deadline 降级路径专用；签名与今日 communityOutcome 一致） */
export async function communityOutcome(
  task: Promise<LoadedCommunity> | null, deadlineAt: number, primary: RegistryEntry[],
): Promise<{ summary: CommunityRegistrySummary; merged: Array<RegistryEntry | CommunityEntry> }>

export { mergeRegistries, matchInstalledByEntry, isCommunityEntry, COMMUNITY_CATEGORY_LABELS }
export type { CommunityRegistrySummary, CommunityOutcome, MergeRegistriesResult, CommunityEntry }

// market.ts 侧 re-export（既有消费方零改动，值 + 类型）：
//   export { communityOutcome, matchInstalledByEntry } from './merged-market.js'
//   export type { CommunityRegistrySummary, CommunityOutcome, MergeRegistriesResult } from './merged-market.js'
// community.ts 侧 re-export：export { COMMUNITY_CATEGORY_LABELS } from './merged-market.js'

// 测试钩子（_waitForCommunityBackgroundForTests 命名先例）：
//   _resetMergedMarketForTests(): void            // 清 store 与 stats
//   _mergedMarketStatsForTests(): { builds: number; hits: number; evictions: number }
```

身份键派生规则（mergedOutcome 内部）：`namespace§profile§registry.configuredAddress§registry.fetchedAt(??'never')§community.state.version(??'off')§pin(??'')§enabled`。等价性注记（R1-12）：`configuredAddress` 即规范化地址，registry cacheKey 是它的纯函数（default→`DEFAULT_CACHE_KEY`，否则 `stableKey(url)`），故键含 configuredAddress 与「cacheKey + configuredAddress」等价；不另加 plugins.length（同 fetchedAt ⇒ 同文件 ⇒ 同内容）。

L1 实现要点（community.ts）：模块级 `Map<string, CommunityCatalog>`，键 `join(dir, '§', version)`，cap=2 淘汰最旧；readCache 在 meta 解析成功后先查 memo，命中直接返回 `{ meta, catalog }`（meta 每次实读——checkedAt 会更新）；未命中走既有 readFile+JSON.parse+validateCommunityContainer 后写入；**parse/validate 失败路径照旧 rm 且不写 memo**。测试钩子：`_communityBodyReadsForTests(): number` 与 `_resetCommunityBodyMemoForTests()`。

## 任务清单

### Task 0 — golden 等价基线（R1-8）

文件：`tests/market-golden.test.mjs`（新建）、`tests/fixtures/market-golden.json`（新建）

步骤：
1. 构造确定性 fixture：合成 LoadedRegistry（固定 fetchedAt/configuredAddress，主清单含 npm 源、github 源、alsoCategories 各至少 1 条）+ 合成 LoadedCommunity（固定 version/checkedAt，≥3 条：含与主清单 npm 撞名让位者、github-only、descriptionEn 命中）+ 合成已装列表（命中 npm/pkg、npm/name、github spec 三准则各 1）；deps 注入固定 fake（probes 返回固定版本）。
2. 用例：`listMarket`（source all/community + query 命中 + sort=downloads + 分页）与 `listInstalledWithMeta`（probeMode none/full）各捕一条，全量 JSON（items/total/offset/limit/categoryCounts/sourceCounts/registryState/installedComplete/latest*/community summary 全字段）与 fixture 比对。
3. `UPDATE_GOLDEN=1 node --test tests/market-golden.test.mjs` 生成并提交 fixture；默认模式 deepEqual 断言。**此测试在 Task 1-5 全程必须保持绿**（断言⑤的可执行机制）。
4. 随 Commit ① 一并提交。

验证：`npm run build && node --test tests/market-golden.test.mjs` → exit 0。

### Task 1 — L1：community.ts readCache 的 body memo

文件：`src/core/community.ts`、`tests/community.test.mjs`

步骤：
1. 先写失败用例：(a) 同 version 两次 `fetchCommunityCatalog`（DSHM_CACHE_DIR 临时目录，预置 meta+body）→ 两次返回 `catalog` **同一引用**，且第二次后 `_communityBodyReadsForTests()` 仍为 1；(b) 预置脏 body（非法 JSON）→ readCache 返回 null 路径照旧（rm 触发、计数不写入），重写合法 body 后再读 → 计数重新计；(c) `_resetCommunityBodyMemoForTests()` 后重读 → 计数增加；(d) cap=2：三个不同 version 顺序读后，最早 version 重读 → 计数增加（被淘汰）。
2. `npm run build && node --test tests/community.test.mjs` 确认失败（钩子不存在）。
3. 实现模块级 body memo（cap=2）+ 两个钩子。
4. **community.test.mjs 的 beforeEach 接入 `_resetCommunityBodyMemoForTests()`**（R1-1 的 L1 面）。
5. 重跑全绿（既有用例零回归，含 Task 0 golden）。
6. Commit ①：`perf(community): 目录 body 按不可变 version 键 memo——readCache 免重付 5MB parse（ADR-0016 L1）`

验证：`npm run build && node --test tests/community.test.mjs tests/market-golden.test.mjs` → exit 0。

Produces：`_communityBodyReadsForTests()`、`_resetCommunityBodyMemoForTests()`、body memo。

### Task 2 — L2 模块：merged-market.ts 建立与迁入解环

文件：`src/core/merged-market.ts`（新建）、`src/core/market.ts`、`src/core/community.ts`、`tests/merged-market.test.mjs`（新建）、`tests/market.test.mjs`

步骤：
1. 新建 `tests/merged-market.test.mjs`，先写失败用例：(a) **断言①**——合成 registry（fetchedAt='T1'）+ 已 resolve communityTask（version='1.0.0'），两次 `mergedOutcome` → `merged` 引用同一、`stats.builds===1`、`stats.hits>=1`；summary 两次均由现算得出（checkedAt 取当次 state）；(b) **断言②**——communityTask 用延迟 20ms resolve 的 promise，两并发 `mergedOutcome` → `builds===1` 且两者 merged 引用同一；(c) **断言③**——悬挂 task 超过 deadlineAt → timeout summary 且 `builds===0`（透传不建代）；随后正常 task 同 version 调用 → summary 正常（无 timeout 残留）；unavailable task 同理 `builds===0`；task=null（source=primary）同理；(d) 身份变即换代——fetchedAt='T2' → 新引用、`builds` +1；(e) cap=4——5 个不同身份顺序调用后最早身份重调 → `builds` +1、`evictions>=1`；(f) **胜者等价**（R1-6/R2-3）——fixture 构造四场景：双源碰撞（社区 github-only 条目与 npm 条目派生同 repo）、社区 npm 重名让位、npm/name 准则命中、**id-让位**（社区条目 id 撞主清单 id 但 npm/github 不撞——displaced 且可装可升的窄场景）。断言两组全等：读路径 `lookupInstalled` ≡ `merged.find(e=>matchInstalledByEntry(e,[inst]))`；安装路径 `findById`/`lookupInstalledAll` ≡ `[...loaded.registry.plugins, ...adaptCommunityCatalog(catalog).entries].find(...)`（含 id-让位条目可装可升）。
2. `npm run build && node --test tests/merged-market.test.mjs` 确认全失败（模块不存在）。
3. 新建 `src/core/merged-market.ts`：从 market.ts **原样迁入** `communityOutcome`（:558-602）、`deadlineRace`（:335-349，communityOutcome 的唯一 await 依赖；market.ts 侧改为从 merged-market.js 值导入——方向合法不构成环，R2-1）、`mergeRegistries`（:454-484）、`communitySummary` 四形态（:486-537）、`isCommunityEntry`（:604-606）、`matchInstalledByEntry`（:426-436）与相关类型；从 community.ts 迁入 `COMMUNITY_CATEGORY_LABELS`（:70，R1-2）；新增 L2 store（cap=4）、`mergedOutcome`（reject 透传语义见契约）、`lookupInstalled`（三候选 min-ord + source 守卫）、`findById`/`lookupInstalledAll`（全量索引，R2-3）、stats/reset 钩子。**对 community.js 只用 `import type`**（LoadedCommunity/CommunityCatalog/CommunityConfig 等——类型擦除不构成运行时环）。
4. market.ts：删除迁出代码；import + re-export（值与类型，见接口契约）。此 Task 内 listMarket/listInstalledWithMeta 暂改调 `communityOutcome`（行为等价、无 memo），接线留给 Task 3。
5. community.ts：:14 改 import 自 merged-market.js；新增 `export { COMMUNITY_CATEGORY_LABELS } from './merged-market.js'`。**环双向断**。
6. **tests/market.test.mjs：beforeEach 接 `_resetMergedMarketForTests()`（从 lib/core/merged-market.js import）**；并 grep 全 tests/ 目录注入 fetchCommunityCatalog/loadRegistry fake 的用例文件（R1-1 实施时逐一核对。已核样例：market.test.mjs 命中两者；profile-ops.test.mjs 命中 **loadRegistry** fake（fetchCommunityCatalog 实为 0 处）；uninstall-patch.test.mjs 经核**不**注入、不触 L2，无需接线——以 grep 实际结果为准，勿按文件名猜测，R2-4）。
7. `npm run typecheck && npm run build && node --test tests/market.test.mjs tests/community.test.mjs tests/merged-market.test.mjs tests/market-golden.test.mjs` 全绿。
8. Commit ②：`refactor(core): 物化合并市场模块 merged-market——迁入解环，market↔community 双向断（ADR-0016 L2）`

验证：上述命令 exit 0；`grep -n "from './market.js'" src/core/community.ts` 与 `grep -n "from './community.js'" src/core/merged-market.ts`（值导入）均无结果（环双向断，R1-2）。

Produces：接口契约全部符号 + `_resetMergedMarketForTests` + `_mergedMarketStatsForTests`。Consumes：Task 1 无依赖（可并行**原型**，落盘与提交串行保持 ①→②，R1-15）。

### Task 3 — 消费点接线：listMarket / listInstalledWithMeta / 匹配索引

文件：`src/core/market.ts`、`tests/merged-market.test.mjs`

步骤：
1. `listMarket`（:755）→ `mergedOutcome({ namespace, profile: opts.profile ?? WEB_PROFILE, cfg: { communityCatalogPin: cfg.communityCatalogPin, communityCatalog: cfg.communityCatalog }, registry: loaded, communityTask, deadlineAt })`；`community.merged/summary` → `outcome.merged/summary`。
2. `listInstalledWithMeta`（:948）：`loaded === 'deadline'` 保持 `communityOutcome`（降级路径）；否则切 `mergedOutcome`。
3. 匹配索引消费：`matchInstalled`（:973-982）与 `probeLatest` 内 `ctx.merged.find`（:991-992）→ `outcome.lookupInstalled(item)`（probeLatest 签名增可选 `lookup` 参数，缺省回退旧 find 保旧测试可注入）；**outdated 循环（:878-886）改查表**（R1-7）：循环前 `const instByPkg = new Map(installedItems.map(i => [i.pkg, i]))`，循环内 `instByPkg.get(item.installedPkg)`。
4. `toMarketItem`（:656）保持 `matchInstalledByEntry` 直调（页内小量）。
5. 集成断言（R1-5 修正）：同身份两次 `listMarket`（deps fake 返回相同身份字段）→ `_mergedMarketStatsForTests().builds === 1 && hits >= 1`，且两次结果 deepEqual（不再断言 items 引用——`toMarketItem` 的 `{...entry}` 展开必然新对象）。
6. `npm run build && node --test tests/market.test.mjs tests/merged-market.test.mjs tests/market-golden.test.mjs` 全绿。本 Task 验证即完成标志；**提交与 Task 4 合一**（Commit ③ 在 Task 4 末，R1-15 明示节奏：Task 3 验证绿后不单独提交）。

验证：命令 exit 0；golden 全字段零变化。

Consumes：Task 2 全部符号。Produces：接线完成的市场读路径。

### Task 4 — 消费点接线：安装/升级三处直连 mergedOutcome（R1-9：取消 L2b）

文件：`src/core/market.ts`、`src/core/profile-ops.ts`

步骤：
1. `resolveRegistryEntry`（:1092-1108，已持有 `loaded`）：`loaded.registry.plugins.find(...) ?? findCommunityInstallEntry(...)` → 构造 `communityTask = (deps?.fetchCommunityCatalog ?? ...)(cfg, {...})`，在**既有窄 try/catch 内**调 `mergedOutcome`（communityTask reject 透传、由该 catch 吞为 miss——reject 语义与今日同构，R2-2），条目查询用 `outcome.findById(id)`（全量索引含 displaced——id-让位条目今日可装，语义零变化，R2-3）；删除 `findCommunityInstallEntry`。
2. `upgradePlugin` 的 :1780 调用点（已持有 loaded）同构：`findCommunityUpgradeEntry(target, ...)` → mergedOutcome + `outcome.lookupInstalledAll(target)`（全量域 min-ord = 今日「先主清单 find 后社区 adapt 全量 find」的合成语义）；调用侧窄 try/catch 保留；删除 `findCommunityUpgradeEntry`。
3. `profile-ops.ts` :601-607（desktop 升级，已持有 loaded）：`fetchCommunityCatalog + adaptCommunityCatalog + find(matchInstalledByEntry)` → `mergedOutcome` + `lookupInstalledAll(target)`（R1-14/R2-3）；既有 try/catch 保留。
4. **不再引入 `adaptedCommunityEntries`**（评审 R1-9 采纳：安装路径三处均已持有 LoadedRegistry，直接消费 L2，维持「两级 memo」决策 1 不增第三级）。
5. `npm run build && node --test tests/market.test.mjs tests/upgrade-activation.test.mjs tests/uninstall-patch.test.mjs tests/rollback-heal.test.mjs tests/profile-ops.test.mjs tests/market-golden.test.mjs` 全绿。
6. Commit ③：`perf(market): 读/安装/升级路径接线物化合并市场——匹配查表 O(I×M)→O(I)（ADR-0016）`

验证：命令 exit 0；安装/升级/desktop 语义用例零变化。

Consumes：Task 2 `mergedOutcome`/`findById`/`lookupInstalledAll`。

### Task 5 — score-once 单遍化（保序语义，R1-4 修正）

文件：`src/core/market.ts`（:781-795）

步骤：
1. 单遍只合并 filter/rank 的**重复评分**；排序链保持现状精确语义：`scored = zoned 过滤`（类别不匹配先短路、不付评分；terms 非空时评一次分存 `{entry, score}`）→ 存活集按显式 sort 排序（`opts.sort ? sortEntries(...) : 原序`）→ rank 阶段按 `score desc, 排序后位置 asc` 排——**idx 取 afterSort 之后的位置**（与今日 :789-794 行为逐点一致，sort+query 并存时同分条目仍按显式排序序）。
2. 新增回归用例（tests/market.test.mjs）：sort=downloads,desc + query 命中 ≥2 条**同分**条目（同类目同字段命中），断言顺序与显式排序一致（锁 tie-break）。
3. `npm run build && node --test tests/market.test.mjs tests/cli-search.test.mjs tests/market-golden.test.mjs` 全绿。
4. Commit ④：`perf(market): 搜索评分单遍化——filter+rank 合一，tie-break 保序（ADR-0016）`

验证：命令 exit 0；三端搜索同序断言零变化。

### Task 6 — 发布收口

文件：`CHANGELOG.md`、`package.json`

步骤：
1. `package.json` version → `0.9.68`。
2. `CHANGELOG.md` 按仓库 0.9.x 条目格式（中英双语）写 0.9.68：合并市场物化（两级 memo、summary 现算、同步临界区、匹配查表、解环、score-once、golden 基线），引用 ADR-0016 v2 与 GLOSSARY 术语，如实声明行为零变化承诺与性能预期。
3. 最终验证（见下）。
4. Commit ⑤：`chore(release): 0.9.68 合并市场物化（ADR-0016）`

## 执行纪律

- 开始实现前，先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划。
- 按任务顺序执行（Task 1/2 可并行**原型**，落盘与提交严格 ①→②；Task 3 验证绿后不单独提交，与 Task 4 合为 Commit ③）；不无声跳步、合并步或改变任务目标。
- 每完成一个任务，运行该任务定义的验证；验证失败先修复再前进。
- 行号基于 0.9.67 现场，以符号锚点为准；遇到计划与仓库现实不符，立即停下说明，不猜。
- 全部任务完成后，运行最终验证并输出修改摘要。

## 最终验证

```bash
cd /home/ubuntu/workspace/dsh-m
npm run typecheck          # 预期：零错误
npm test                   # 预期：全量套件通过（0.9.67 基线 1289 例 + golden/merged-market/community 新增），exit 0
node --test tests/merged-market.test.mjs tests/community.test.mjs   # 预期：五断言相关用例全过
grep -n "from './market.js'" src/core/community.ts                  # 预期：无输出（环断·向 A）
grep -nE "^import \{.*\} from './community.js'" src/core/merged-market.ts  # 预期：无输出（环断·向 B，import type 不计）
grep -nE "^import \{.*\} from './market.js'" src/core/merged-market.ts      # 预期：无输出（环断·向 C，R2-1）
git log --oneline -6                    # 预期：⓪-⑤ 分层清晰（⓪随 ①）
```

可选性能冒烟（本机，社区目录已缓存）：

```bash
npm run build && node -e "
import('./lib/core/market.js').then(async ({ listMarket }) => {
  const t0 = Date.now(); await listMarket({}, { probeMode: 'cache-only', withLatest: false });
  const t1 = Date.now(); await listMarket({}, { probeMode: 'cache-only', withLatest: false });
  const t2 = Date.now();
  console.log('first(建代):', t1-t0, 'ms  second(代命中):', t2-t1, 'ms');
})"
# 预期：second 显著低于 first（<15ms 量级；first 含 5MB parse + adapt + merge）
```
