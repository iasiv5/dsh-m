# 精选卡统计对齐实施计划

## 目标

- 精选（primary）市场卡 byline 与社区卡统一为「by owner + 下载↓ + star★」，标签/实测行自卡面退役（详情弹窗既有「标签」「实测版本」行承接，零新增开发）
- 统计数据混合源：24 条目录镜像 join（单一真值源）+ 缺口条目 core 直查（动态缺口集、24h TTL 落盘缓存），上游补录后自愈交接
- 口径恒为 npm 近 30 天窗口，悬浮 title 口径透明（区分「目录快照」与「npm 直查」）；不做 all-time 总量
- joined 数值参与显式排序（golden/测试锚刻意更新）；收藏卡 owner 门放宽（有数字就显数字）
- 决议落档 ADR-0036 + GLOSSARY 三词条

## 架构快照

- **join 层**：`mergeRegistries`（src/core/merged-market.ts）本来就以 npm 名 → owner/repo → id 三键计算主清单/社区撞名。本次在合并时用同源映射把镜像社区条目的统计字段浅拷贝注记到 primary 条目（**新对象**，不改写 loadRegistry 缓存条目，L2 物化代安全），并产出 `directGap`（未获得镜像统计的 primary 条目清单）。
- **直查层**：新模块 `src/core/curated-stats.ts`——纯函数（缺口键集、缓存箱解析）+ IO 编排（npm bulk point/last-month ≤128 包/批 + GitHub stars 逐 repo，并发 ≤4）+ 24h TTL 落盘缓存（沿用 community.ts 的 `cacheRoot(profile)/namespace/<dir>` 布局与 `atomicWrite` 姿势）。TTL 过期后拉取失败**保留旧值**（装饰性指标 fail-open，ADR Consequences 备案）。
- **接线**：`mergedOutcome` 在 registry+community 就绪后以第三任务（与既有 deadline 竞速）调用 `loadCuratedStats`，对 `directGap` 条目注记 `statsVia:'direct'`；整体失败/超时静默，绝不阻塞市场加载。
- **客户端**：`market-tab.jsx` cardOf 双分支合一（两区同一条 byline 组装）；`existingMarketIds` 的 stats 透出（收藏卡 overlay）因 join 自动覆盖精选条目，**零改动**；`dlOf/starsOf/sortEntries` 读 entry 字段，join 后自然参与排序，**排序代码零改动**。
- 传播链：merged 条目字段 → `toMarketItem` spread 自动携带 → MarketItem（GUI/tools/CLI 三端同源）。

## 全局约束

- 口径恒为 npm 近 30 天窗口；不实现 all-time 总量（npm 官方 API 无该端点，ADR-0036 备案）
- GitHub-only 条目（无 npm 包，当前仅 registry.json 的 qiaomu-rss-dsh 一条）不做下载量；star 正常拉取显示
- 直查失败逐项静默缺省（数字不渲染），绝不阻塞市场主流程；绝不因统计拉取失败丢弃已有目录数据
- 缓存 TTL 24 小时（主人钦定「24 小时内只拉一次」）；刷新周期末对不在当前缺口集的键做 GC
- Node >= 22.19.0（package.json engines 逐字继承）；工作树为 LF 检出（2026-11-13 hex 实测），单行/多行源锚均可用，仍优先单行计数锚
- 测试纪律逐字沿用 docs/CODING-STANDARDS.md：core 套件从 lib/ 产物引入（先 build）、client 套件直跑 src/、量化断言用出现次数语义、改输出形态必清点 deepEqual 断言面

## 输入工件

- 设计共识：grill-with-docs 八问决议（2026-11-13 本会话；Q1–Q8 全部确认，含「精选集增删→动态缺口集」约束）
- 事实普查：card-facts（卡片 byline/merged 数据面/重叠率 24:37/排序语义/i18n 键）与 dshmarket-dissect（上游零运行时取数、formatCount、GitHub Release 口径不引入）两份子代理报告
- 上游目录样张：`.dsh-research/dshm-stats-probe/package/plugins.json`（2026.1113.20393，字段 downloads/downloadsStart/End/CheckedAt/stars 实测）

## 文件结构与职责

Create:
- `docs/adr/0036-catalog-stats-alignment.md` — 决策存档（混合源/口径/排序/卡面退役/动态缺口集/fail-open）
- `src/core/curated-stats.ts` — 缺口直查模块（DOM-free 纯逻辑 + IO 编排 + TTL 缓存），全部可注入依赖直测
- `tests/curated-stats.test.mjs` — 上模块单测
Modify:
- `src/core/merged-market.ts` — `mergeRegistries` join 注记 + `MergeRegistriesResult.directGap` + `mergedOutcome` 第三任务接线 + `CuratedStatsFields` 类型定义
- `src/core/market.ts` — `MarketItem.statsVia` 键、`MarketDeps.fetchCuratedStats` 注入位、`toMarketItem` owner 派生（stats 字段经既有 spread 自动透传，核对即可）
- `src/client/market-tab.jsx` — cardOf byline 双分支合一 + `statsTitle` 组装（≈:427-435，符号锚 cardOf）
- `src/client/card.jsx` — `verifiedByline` 定义/导出退役（:13-16、:65）
- `src/client/favorite-zone.jsx` — byline owner 门放宽（:97-103 附近，符号锚 FavoriteZone byline）
- `src/client/i18n.js` — 删 `byline.verified`（zh :8 / en :145），增 `byline.statsTitle`（双语对）
- `GLOSSARY.md` — +镜像条目 / 目录快照窗口 / 缺口直查 三词条
- `tests/market.test.mjs` — 新增 ⑧ 镜像 join、⑨ 缺口直查注记/失败静默 两用例
- `tests/client-render-smoke.test.mjs` — :525-528 verifiedByline/byline.verified 锚迁移为统一 byline 锚
- `tests/market-golden.test.mjs` + `tests/fixtures/market-golden.json` — 刻意重生成（diff 仅允许统计字段类新增）
- `tests/tools-search.test.mjs` — 审计后按需更新（primary 条目新增 downloads/stars/owner/statsVia 键）
不动：`src/core/market.ts` 的 sortEntries/dlOf/starsOf（语义不变）、`src/tools.ts`（类型已含 downloads/stars，输出自然扩展）、`registry.json`、`host.js`、`cordis.patch.yml`、`CHANGELOG.md`（随发版轮）

## 统一接口契约（跨任务，名称逐字）

```ts
// merged-market.ts 导出（Task 2 产出，Task 3/5 消费）
export interface CuratedStatsFields {
  downloads?: number
  stars?: number
  downloadsStart?: string
  downloadsEnd?: string
  downloadsCheckedAt?: string
  statsVia?: 'catalog' | 'direct'
}
export interface DirectGapEntry { id: string; npm?: string; github?: string }
// MergeRegistriesResult 增字段：
//   directGap: DirectGapEntry[]   // 未获得镜像统计的 primary 条目（join 后仍无 statsVia 者）
// mergeRegistries 注记语义：npm 名优先、github 兜底；镜像字段 null → 不注记该键；statsVia:'catalog'
```

```ts
// curated-stats.ts 导出（Task 4 产出，Task 5 消费）
export const CURATED_STATS_TTL_MS = 24 * 60 * 60 * 1000
export interface CuratedStat {
  downloads?: number; downloadsStart?: string; downloadsEnd?: string
  stars?: number; checkedAt: string
}
export interface LoadCuratedStatsInput {
  npmKeys: string[]; githubKeys: string[]
  dir: string                     // join(cacheRoot(profile), namespace, 'curated-stats')
  ttlMs?: number; deadlineAt?: number; signal?: AbortSignal
  deps?: { fetchJson?: (url: string, opts?: unknown) => Promise<unknown>; now?: () => number }
}
export interface LoadCuratedStatsResult { stats: Record<string, CuratedStat>; errors: string[] }
export function curatedGapKeys(entries: DirectGapEntry[]): { npmKeys: string[]; githubKeys: string[] }
export function parseCuratedStatsBox(raw: unknown, now: number, ttlMs: number): Record<string, CuratedStat> | null
export async function loadCuratedStats(input: LoadCuratedStatsInput): Promise<LoadCuratedStatsResult>
```

- 缓存键：`'npm:' + pkg` / `'gh:' + owner/repo`；箱文件 `<dir>/stats.json`，形如 `{ version: 1, fetchedAt: string, entries: Record<key, CuratedStat> }`；写盘用 `atomic-write.js` 的 `writeFileAtomic`（src/core/npm-route.ts import :12 同款先例）
- MarketItem 增键：`statsVia?: 'catalog' | 'direct'`（owner/downloads/stars/窗口字段接口已有）
- MarketDeps 增可选注入：`fetchCuratedStats?: (input: LoadCuratedStatsInput) => Promise<LoadCuratedStatsResult>`，默认 `defaultFetchCuratedStats = loadCuratedStats`（**缺省真实兜底仅存在于 marketDeps() 生产工厂；测试夹具必须显式惰性桩，禁走真实网络**——评审 R4⑩，测试注入形态纪律）
- i18n 新键（文案钉死）：zh `"byline.statsTitle": "下载量（30 天窗口）{win} · 查于 {at}"`；en `"byline.statsTitle": "Downloads (30-day window) {win} · checked {at}"`；客户端组装 `const via = it.statsVia === "direct" ? "npm · " : ""` 前缀拼接，`win = downloadsStart && downloadsEnd ? downloadsStart + "~" + downloadsEnd : ""`（缺席空串），`at = downloadsCheckedAt || ""`
- 收藏卡 tooltip 保持 `title: String(n)` 现状（snapshot 不携带窗口字段，scope 收口，ADR 备案）

## 任务清单

### Task 1: ADR-0036 与 GLOSSARY 词条落档

- 目标：决议存档，后续任务可引用
- 涉及文件：Create `docs/adr/0036-catalog-stats-alignment.md`；Modify `GLOSSARY.md`（Language 节内追加）
- 接口契约：Consumes 无；Produces ADR 文件（Task 2-6 注释可引用「ADR-0036」）
- ADR 骨架沿用 0035（# 标题含（ADR-0036）/ ## 决策 / ## 背景 / ## Considered Options / ## Consequences）：决策四条 = ①混合源（镜像 join 优先 + 缺口直查兜底 + 上游补录自愈）②口径 30 天窗不做总量（npm 无 all-time 端点实证）③joined 数值参与显式排序（无数据垫底语义保留）④卡面标签/实测退役（详情弹窗承接）；Consequences 必须含：缺口直查 TTL 过期拉取失败**保留旧值**的 fail-open 备案、收藏卡 tooltip 不携带窗口、GitHub-only 条目不引入上游 githubReleaseDownloads 口径
- GLOSSARY 三词条（沿用「**术语（EN）**:
定义
_Avoid_: …」格式）：
  - **镜像条目（primary-overlap mirror）**: 主清单条目在上游社区目录中的同插件条目；merge 撞名时带 primaryOverlap 标记保留（社区浏览可见、搜索池排除），其统计字段是精选卡数字的首选来源。_Avoid_: 重复条目、displaced 条目（displaced 仅指让位事件与被让位的社区条目）
  - **目录快照窗口（catalog snapshot window）**: 上游目录随条目下发的 downloads 统计区间（downloadsStart~downloadsEnd）与采集时点（downloadsCheckedAt），约 30 天、每日重建；市场数字的默认口径。_Avoid_: 实时下载量、总下载量
  - **缺口直查（gap direct fetch）**: 精选条目无目录镜像时，dsh-m core 对 npm bulk 下载量与 GitHub star 的直接拉取；动态缺口集（当前 registry − 目录镜像）驱动，24h TTL 落盘缓存，失败静默。_Avoid_: 实时行情、客户端拉取（本实现为宿主端）
- 验证范围：
- [ ] Step 1: 写两文件
- [ ] Step 2: Run（分号双计数，规避 grep -c 计 0 = exit 1 的 && 短路）：`grep -c "ADR-0036" docs/adr/0036-catalog-stats-alignment.md; grep -c "_Avoid_" GLOSSARY.md`
- Expected: 前者 ≥1；后者较改前 +3（改前基线 92，评审 R1 实测）

### Task 2: mergeRegistries 镜像 join（红先行）

- 目标：带镜像的 primary 条目获得目录统计字段（浅拷贝注记），并产出 directGap
- 涉及文件：Modify `src/core/merged-market.ts`（符号锚 `mergeRegistries`、`MergeRegistriesResult`）；Test `tests/market.test.mjs`
- 接口契约：Consumes 无（本任务定义 CuratedStatsFields/DirectGapEntry）；Produces 统一接口契约的 mergeRegistries 注记行为与 directGap 字段（Task 3/5 消费）
- 验证范围：`npm run build && node --test tests/market.test.mjs`
- [ ] Step 1: 写失败测试 ⑧（describe existingMarketIds 之后、listInstalledWithMeta 之前的位置不强制，放 existingMarketIds describe 同级新 describe `mergeRegistries 镜像 join（ADR-0036）`——直接经 `listMarket` 断言端到端）：fixture primary `{ id: 'j-1', name: 'J1', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'join-pkg', github: 'o/j-repo' }`；community `communityRaw('jkeep', 'oJ', { npm: 'join-pkg', downloads: 3218, stars: 2, downloadsCheckedAt: '2026-11-12T00:00:00.000Z' })`（communityRaw 测试夹具已支持第三参扩展，tests/market.test.mjs ⑤ 同款）；断言 `listMarket(cfg, { withLatest: false }, deps)` 结果中 id 'j-1' 的 item：`downloads===3218`、`stars===2`、`statsVia==='catalog'` 三件（owner 不在本任务断言——Task 3 Step 1 再追加 `owner==='o'` 红绿，保持红先行排序）+ 另含一条无镜像 primary `{ id: 'j-2', name: 'J2', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'gap-pkg' }`：断言其 item `statsVia` 为 undefined、`downloads` 为 undefined，且 `displaced` 计数恰 +1（join 不得改变让位语义）
- Run: `npm run build && node --test tests/market.test.mjs`
- Expected: ⑧ 红（downloads undefined）
- [ ] Step 2: 确认红
- [ ] Step 3: 实现：mergeRegistries 内建 `statsByNpm/statsByGithub` 两 Map（首条优先），primary.map 浅拷贝注记（npm 优先、github 兜底；镜像字段 null → 该键不注记；`statsVia: 'catalog' as const`）；未命中者收进 `directGap`（`{ id, npm?, github? }`，仅含至少有 npm 或 github 的条目）；items 与 directGap 一起返回；类型按统一接口契约
- [ ] Step 4: Run 同 Step 2
- Expected: 全绿（⑧ 绿、既有 ①–⑦ 不变）
- [ ] Step 5: checkpoint commit（可选）：`git add -A && git commit -m "feat(core): mergeRegistries 镜像 join 与 directGap（ADR-0036 Task 2）"`

### Task 3: MarketItem.statsVia 与 owner 派生

- 目标：MarketItem 类型补 `statsVia`；primary 条目 owner 自 github 派生（社区条目 owner 原样）
- 涉及文件：Modify `src/core/market.ts`（符号锚 `toMarketItem`、`MarketItem` 接口）；Test `tests/market.test.mjs`（⑧ 补 owner 断言）
- 接口契约：Consumes Task 2 的注记字段（spread 已透传，核对 `const item: MarketItem = { ...entry, ... }` 行为即可）；Produces `MarketItem.statsVia`（Task 6 客户端消费）、primary 条目 `owner`
- 验证范围：`npm run build && node --test tests/market.test.mjs`
- [ ] Step 1: ⑧ 追加断言 `item.owner === 'o'`（github 'o/j-repo' 派生）与社区条目 owner 不受影响
- Run: build + node --test 同上
- Expected: 红（owner undefined）
- [ ] Step 2: 确认红
- [ ] Step 3: 实现：MarketItem 接口加 `statsVia?: 'catalog' | 'direct'`（注释标注 ADR-0036）；toMarketItem 在 community 分支外补 `const via = (entry as CuratedStatsFields).statsVia; if (via !== undefined) item.statsVia = via`（community 分支内显式 `item.statsVia = 'catalog'`）；owner 派生两行：`if (item.owner === undefined && typeof entry.github === 'string' && entry.github.includes('/')) item.owner = entry.github.slice(0, entry.github.indexOf('/'))`
- [ ] Step 4: Run 同上
- Expected: 全绿
- [ ] Step 5: checkpoint commit（可选）

### Task 4: curated-stats 模块（红先行）

- 目标：缺口直查的纯函数与 IO 编排 + 24h TTL 落盘缓存
- 涉及文件：Create `src/core/curated-stats.ts`、`tests/curated-stats.test.mjs`
- 接口契约：Consumes `CuratedStatsFields`/`DirectGapEntry` import 自 merged-market.ts（Task 2 产出，单一产地不复制）；`CuratedStat` 与输入/输出两接口自含于本模块；`atomic-write.js` 的 `writeFileAtomic`、`env.js` 的 cache 语义由调用方传 `dir`（模块自身不 import env，保持纯度；唯一 node 依赖 = fs 读写经注入或直接 import——PIN：fs 直接 import，dir 由调用方给）；Produces `curatedGapKeys / parseCuratedStatsBox / loadCuratedStats / CURATED_STATS_TTL_MS`（Task 5 消费）
- 验证范围：`npm run build && node --test tests/curated-stats.test.mjs`（测试从 `../lib/core/curated-stats.js` 引入，src/core 惯例）
- [ ] Step 1: 写失败测试，四个 describe：
  - `curatedGapKeys`：DirectGapEntry[] → npmKeys/githubKeys 拆分（双键条目两边都进；无 npm 只进 ghKeys）
  - `parseCuratedStatsBox`：新鲜箱命中 / TTL 过期 null / 畸形箱 null / entries 非对象 null
  - `loadCuratedStats 编排`（deps.fetchJson 注入桩）：npm bulk 一枪（断言 URL 为 `https://api.npmjs.org/downloads/point/last-month/` + 逗号连接、scoped 名 `/`→`%2F`；响应 `{downloads,start,end}` 映射）；bulk 非 2xx → 逐包 point 回退（并发 ≤4）；GitHub `https://api.github.com/repos/<o>/<r>` 取 `stargazers_count`（并发 ≤4）；缓存写盘（读回一致）；TTL 内免网络（fetchJson 桩调用计数 0）；TTL 过期拉取失败 → 旧值保留且 errors 非空；GC：写回箱中不在当前 keys 的键被剔除
  - `降级`：全部失败 → stats 空对象 + errors 非空，不抛
- Run: `npm run build && node --test tests/curated-stats.test.mjs`
- Expected: 红（模块不存在，import 失败）
- [ ] Step 2: 确认红
- [ ] Step 3: 实现（模块头注释标 ADR-0036；请求统一 `fetchJsonLimited` 不可注入时改走 deps.fetchJson 缺省包装——实现取：默认 deps.fetchJson = (url, opts) => fetchJsonLimited(url, { timeoutMs: 8000, ...opts })，测试注入桩替换）；timeoutMs 8000 单请求；scoped %2F 形态由单测桩钉住，真实端点行为风险由逐包回退兜底（评审 R2 备案）
- [ ] Step 4: Run 同上
- Expected: 全绿
- [ ] Step 5: checkpoint commit（可选）

### Task 5: mergedOutcome 直查接线（红先行）

- 目标：mergedOutcome 第三任务消费 directGap → loadCuratedStats → 注记 statsVia:'direct'；失败静默
- 涉及文件：Modify `src/core/merged-market.ts`（符号锚 `mergedOutcome`、`MarketDeps` 定义于 src/core/market.ts）；Test `tests/market.test.mjs`
- 接口契约：Consumes Task 2 directGap/注记、Task 4 loadCuratedStats；Produces 端到端行为「无镜像 primary 条目带直查统计」；`MarketDeps.fetchCuratedStats` 注入位（host-api/tests 桩用）
- 验证范围：`npm run build && node --test tests/market.test.mjs`
- [ ] Step 1: 写失败测试 ⑨（新 describe `缺口直查注记（ADR-0036）`）：deps 注入 `fetchCuratedStats: async (input) => { assert.deepEqual(input.npmKeys, ['gap-pkg']); return { stats: { 'npm:gap-pkg': { downloads: 2468, downloadsStart: '2026-10-14', downloadsEnd: '2026-11-12', stars: 2, checkedAt: '2026-11-13T00:00:00.000Z' } }, errors: [] } }`；fixture primary `{ id: 'g-1', npm: 'gap-pkg', github: 'o/gap' }` 无镜像 → 断言 item `downloads===2468`、`statsVia==='direct'`、`downloadsCheckedAt` 透传；第二用例：桩抛错 → item 无统计字段、listMarket 正常返回（不抛）；第三用例（排序参与，Q4 决议落点）：fixture 追加 communityRaw('lowk', 'oL', { npm: 'low-pkg', downloads: 100 })，断言 `listMarket(cfg, { sort: { field: 'downloads', dir: 'desc' }, withLatest: false }, deps)` 结果序中 'g-1'（2468）位于 'ol--lowk'（100）之前
- Run: build + node --test
- Expected: 红（statsVia undefined）
- [ ] Step 2: 确认红
- [ ] Step 3: 实现：MarketDeps 增 `fetchCuratedStats`（marketDeps() 缺省 = defaultFetchCuratedStats，即 loadCuratedStats 包装：dir = join(cacheRoot(profile ?? WEB_PROFILE), namespace, 'curated-stats')，ttlMs 缺省）；mergedOutcome 在 merge 后：`merge.directGap` 非空 → `curatedGapKeys` → `fetchCuratedStats` 经 deadlineRace（同 communityTask 预算，超时/拒绝 → 空 stats 静默）→ 按 id 注记 `{ ...item 字段, statsVia: 'direct' }`；测试夹具加固（评审 R4⑩）：tests/market.test.mjs `fakeDeps()` 与 tests/market-golden.test.mjs `goldDeps()` 增缺省惰性桩 `fetchCuratedStats: async () => ({ stats: {}, errors: [] })`（先例：fakeDeps 缺省 disabled 社区 loader；⑨/⑧ 用自有数据桩覆盖不受影响；加固后 golden diff 仅剩 join 注记——确定性成立）
- [ ] Step 4: Run 同上
- Expected: 全绿（①–⑨）
- [ ] Step 5: checkpoint commit（可选）

### Task 6: 客户端卡面统一与 verifiedByline 退役

- 目标：cardOf byline 双分支合一（含口径 title）；verifiedByline/byline.verified 退役；收藏卡 owner 门放宽
- 涉及文件：Modify `src/client/market-tab.jsx`（cardOf byline，约 :427-435；:24 import 行删 verifiedByline）、`src/client/card.jsx`（verifiedByline 定义 :13-16、导出 :65）、`src/client/favorite-zone.jsx`（byline 组装段）、`src/client/i18n.js`（:8/:145 删、新增双语行）；Test `tests/client-render-smoke.test.mjs`（:525-528 锚迁移）
- 接口契约：Consumes Task 3 的 `MarketItem.statsVia`/owner、统一接口契约的 i18n 新键文案；Produces 新 smoke 锚（下 Step 1 逐字）
- 验证范围：`node --test tests/client-render-smoke.test.mjs tests/client-i18n.test.mjs tests/client-market-state.test.mjs`（client 族直跑 src 免 build）
- [ ] Step 1: 改 client-render-smoke :525-528 断言块——旧锚共**四条**整块迁移（评审 R2 实核 tests/client-render-smoke.test.mjs:519-531：:525 构造器、:526 接线、:527 card 源锚 lookup("byline.verified") 末位+tooltip 模式——文本不含 verifiedByline 子串、新加负向锚杀不掉、须显式删、:528 ZH/EN 计数 2；:529 Modal 实测行保留），替换为逐字新锚：`assert.ok(marketTabSrc.includes('byline.statsTitle'), '口径透明 title 接线在')`；`assert.ok(marketTabSrc.includes('statsVia === "direct"'), '直查前缀区分在')`；`assert.equal(i18nSrc.split('"byline.statsTitle":').length - 1, 2, 'byline.statsTitle ZH/EN 各一次')`；`assert.ok(!cardSrc.includes('verifiedByline'), 'verifiedByline 已退役')`；`assert.ok(!i18nSrc.includes('byline.verified'), 'byline.verified 键已退役')`
- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 红（旧实现尚在）
- [ ] Step 2: 确认红
- [ ] Step 3: 实现：market-tab.jsx 删 import 中 `verifiedByline`（:24），byline 双分支合一为逐字：
  `byline: [ it.owner ? { text: "by " + it.owner } : null, typeof it.downloads === "number" ? { text: compactCount(it.downloads) + " ↓", title: statsTitle(it) } : null, typeof it.stars === "number" ? { text: compactCount(it.stars) + " ★", title: String(it.stars) } : null ].filter(Boolean),`（拼接式书写，避免嵌套模板串转义）
  （cardOf 上方加 `const statsTitle = (it) => { const win = it.downloadsStart && it.downloadsEnd ? it.downloadsStart + "~" + it.downloadsEnd : ""; const via = it.statsVia === "direct" ? "npm · " : ""; return via + lookup("byline.statsTitle", { win, at: it.downloadsCheckedAt || "" }); };`）
  card.jsx 删 verifiedByline 定义与导出（:13-16、:65）；favorite-zone.jsx byline 改无门放宽（owner 段条件保留、数字段独立条件、空数组 → null）；i18n.js 删 :8/:145 两行、增 byline.statsTitle 双语行（文案钉死见统一接口契约）
- [ ] Step 4: Run: `node --test tests/client-render-smoke.test.mjs tests/client-i18n.test.mjs tests/client-market-state.test.mjs`
- Expected: 全绿（若 client-i18n 对 byline.verified 报键缺失/未使用，按其语义处置——键已随锚删除属预期）
- [ ] Step 5: checkpoint commit（可选）

### Task 7: golden 与断言面刻意更新

- 目标：行为变更类更新的证据化收口（golden diff 审查 + deepEqual 普查）
- 涉及文件：`tests/fixtures/market-golden.json`（重生成）、`tests/tools-search.test.mjs`（按需）
- 接口契约：Consumes Task 2/3/5 的输出形态；Produces 更新后的基线
- 验证范围：见 Steps
- [ ] Step 1: 断言面普查（CODING-STANDARDS 行为关键词复搜；评审 R1 修正：单行 grep 漏多行 deepEqual 续行键——基线实跑漏 market.test:440 `assert.deepEqual(res.stats, {`）：Run: `grep -rn -A3 "deepEqual" tests --include=*.test.mjs | grep -E "downloads|stars|statsVia|owner|stats" || true`；非 deepEqual 形态断言文件单列清点：tools-search.test.mjs（0 处 deepEqual，受影响点为 items 形态/键断言）、client-render-smoke（src 源锚）、client-market-state（源锚）——逐文件清点结果落盘 `.dsh-research/plan-review-scratch/census-task7.md` 供复查；已知至少：market.test ⑦ res.stats（:440 多行）、host-api-profile stats 透传、tools-search SearchOut
- [ ] Step 2: 重生成 golden：Run: `UPDATE_GOLDEN=1 npm run build && node --test tests/market-golden.test.mjs`
- [ ] Step 3: Run: `git diff tests/fixtures/market-golden.json`——审查：diff 只允许出现统计字段类新增（downloads/stars/downloadsStart/End/CheckedAt/statsVia/owner）与由其引起的次序变化；任何其它字段变化 = 实现越界，回 Task 2-5 排查
- [ ] Step 4: Run: `npm run build && node --test tests/tools-search.test.mjs`——红则按新形态更新断言（primary 条目新增字段属预期）
- [ ] Step 5: checkpoint commit（可选）：`git add -A && git commit -m "test: golden 与断言面随 ADR-0036 统计形态刻意更新"`

### Task 8: 全量门禁与预览指引

- 目标：收口验证
- 验证范围：
- [ ] Step 1: Run: `npm test`
- Expected: 全绿（pass 计数以当轮输出为准，禁止引用历史数字——计数新鲜度纪律）
- [ ] Step 2: Run: `npm run typecheck`
- Expected: 0 错
- [ ] Step 3: 预览（owner 动作，非门禁）：`node scripts/hot-deploy.mjs --skip-tests` 部署 lib/client.js（脚本部署面仅 client、宿主面只对账——评审 R2 实核 scripts/hot-deploy.mjs :9-11/:30-31）；本次宿主面为 **3 个文件**：lib/core/merged-market.js（改→替换：050 §3 同目录 temp+mv 断链，backup + nlink + sha 断言）、lib/core/market.js（改→替换同前）、lib/core/curated-stats.js（**新建**→atomicWrite 到新路径，sha 对照 repo 产物；漏部署 = merged-market.js 静态 import 失败 → 市场整页死，非静默降级——部署核验必须三文件 `ls` 齐全 + sha 双读）；宿主面就绪后按 know-how 037 分离式重启，生效判据 = 服务 ActiveEnterTimestamp 变化 + 部署文件构建指纹（grep 新符号），禁当轮直接 restart
- [ ] Step 4: owner 验收精选/社区/收藏三区卡面与悬浮口径后，进入发版轮（bump + CHANGELOG + `npm run release`，当轮单独请批）

## 执行纪律

- 开始实现前批判性复查整份计划；发现缺项/矛盾/锚漂移先修计划再动手
- 按任务顺序执行，不无声跳步/合并步/改变任务目标；每任务完成即跑该任务验证
- 源锚写入前对 `git show HEAD:<file>` 核对计数方向（退役锚 HEAD>0、新增锚 HEAD=0）
- 遇阻（测试红原因不明、锚不匹配、命令不存在）立即停下说明，不猜
- 当前分支 main；checkpoint commit 直接落 main（owner 已确认连续在 main 工作）；发版（push/tag/publish）不在本计划，执行到发版前停下等 owner 批准
- 对活宿主的部署/重启遵循 know-how 037（分离式）与 050（原子替换断链）； `npm test` 全量约 3-4 分钟，`run_in_background` 起跑、经日志收结果

## 最终验证

- `npm test` 全绿 + `npm run typecheck` 0 错（两命令输出当轮原样留存于会话证据）
- `git status --short` 仅含本计划文件结构节列出的文件；`git diff --stat` 逐文件可归因
- 预览验收（owner）：精选卡出现「by owner ↓ ★」、缺口条目数字经直查补齐（**条数以当轮 directGap 计数为准，样本时点约 12**——qiaomu-rss-dsh 经 github 兜底 join 得 stars=28：镜像字段为 null 只是不注记该键，stars 非 null 即注记 → statsVia='catalog'、不入缺口；随上游每日重建浮动，勿硬编码样本数）、口径 title 区分目录快照/npm 直查、收藏卡精选条目有数字、标签实测行仅存详情弹窗

## 审阅 Checkpoint

- 计划正文结束后请求 owner 审阅；审阅通过前不进入实现
- 默认执行方：普通编码 agent 或人工执行者；本计划自含（接口契约逐字可查，无「参考前文」）

## 评审记录（2026-11-13）

独立评审（plan-reviewer，只读 5 轮，零仓库改动；台账与探针日志在 `.dsh-research/plan-review-scratch/`，不入库）：发现 10 项——重要 4（断言面普查盲区 / 宿主面三文件含新建 / smoke 旧锚四条 / 直查缺省兜底漏真实网络进测试面）+ 建议 6，全部闭环：8 项修改并复核通过、1 项反驳被接受关闭（缺口计数 per-key 语义）、1 项备案。结论 = **可进入执行**；覆盖度声明：评审未跑 build/test/typecheck（章程禁令），golden 实际 diff、全量门禁、宿主面部署验收留待执行轮实测。终版 md5 5c6bc482001e7b81b4f201ec4183488a。
