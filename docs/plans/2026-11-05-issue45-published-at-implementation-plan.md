# issue #45「最后发布时间」实施计划（方案 A′：读时取数 + 24h 磁盘缓存）

## 目标

- `dshm search`（agent 工具）与 `dshm search`（CLI）每条 npm 条目显示「最后发布时间」；GUI 详情弹窗加同一行。
- 取数语义：npm packument `time.modified`（缺席回退各版本发布时刻最大值）；非 npm 条目不显示、不用 `added` 兜底。
- 成本形态 A′：读时逐条 packument 取数 + 本地磁盘持久缓存（TTL 24h 硬过期、同步重取、只存成功值），跨进程/跨重启摊销到「每包每天至多一次」。
- 缺省态（功能关）三端输出**逐字节零漂移**（golden 钉例不重生成）。
- 明确不做（本轮裁决）：上游目录烘焙（不碰 awesome-dsh）、GUI 搜索卡片 sub-line、SWR、`added` 兜底、全目录预热、`PACKUMENT_CAP` 扩容（保持 4）、任何配置面、发版与 issue 回帖/关闭。

## 架构快照

- 新模块 `src/core/published-at.ts` = 发布时刻取数与磁盘缓存的唯一属主：`fetchPublishedAt(pkg)` 先查磁盘 store（TTL 24h 内直回，零网络），未命中经 `packumentTimes`（packument 访问器，单一取数通道）取 `time.modified`，**成功才回写磁盘**。store 为 profile 无关共享文件 `<cacheDir()>/published-at/store.json`（`npm-route.ts` 的 `<cacheDir()>/npm-route.json` 先例），键 = `pkg\n生效registry`，写路径 `withFileLock` + `writeFileAtomic`。
- core `listMarket` 拥有编排：新查询选项 `withPublishedAt`（**默认 false**），开启时对**当前页** npm 条目并发 ≤8（复用 `LATEST_WORKERS`）、共享 `remaining()` deadline 逐条取数；单条失败/超时 → 该条 `publishedAt` 缺席 + 页级 `publishedAtComplete=false`（fail-open，不阻塞列表、不冒充）。
- 三端接线：tools/CLI `withPublishedAt: true` 恒开；GUI 列表**不开**（零列表成本），详情弹窗打开时经新 host-api 单条 action `published-at` 取数（磁盘命中零网络）。
- 与 ADR-0006 的界线：latest 是快变量（内存缓存、重启即失效是特性）；发布时刻是慢变量（磁盘持久、24h 误差上界在天粒度展示下不可见）——此界线由 ADR-0031 记录。

## 全局约束

- 依赖预检：任何 build/test/typecheck 前 `test -d node_modules`（workspace AGENTS.md）。
- `src/core/*.ts` 的测试从 `lib/core/*.js`（构建产物）引入；单套件跑之前先 `npm run build`，否则测到旧产物。
- 测试输出过过滤管道时 Bash `set -o pipefail`，以原测试进程退出码判定（退出码卫生）。
- 源串锚禁含 `\n`（CRLF 检出）；中文文案锚一律走源结构锚；量化断言用出现次数语义（`src.split(needle).length - 1`）。
- client 文案断言 ZH/EN 双语容忍（node 环境 `browserLang()` 实测取 `en`，钉中文必红）。
- 注入型测试夹具逐字段对照生产调用点，顶层字段不得同时注进内层缺省对象。
- **store 键测试确定性（R3）**：凡触达 store 键（`activeNpmRegistry()`）的测试（Task 2/6），`before()` 须在临时 `DSHM_CACHE_DIR` 下预置路由决策文件 `npm-route.json`（内容 `{"base":"https://registry.npmjs.org"}`——`readDecisionFile` 第 4 优先级命中后内存稳定、无 TTL 重探，`src/core/npm-route.ts` ≈:164-170）并调 `resetNpmRouteForTests()`（≈:120-126）；否则回退链第 5 步 probe-once 真网探测（≈:171-186，`PROBE_BUDGET_MS=2500` ≈:19）且 60s 回退 TTL（≈:20/:159）内外键漂移。预置 store 键一律写死 `pkg-a\nhttps://registry.npmjs.org`。
- `PACKUMENT_CAP = 4` 与 `PACKUMENT_TTL_MS = 5min` 不动（`tests/packument.test.mjs` cap 钉例零改动）。
- 无新增配置面（TTL/上限均为命名常量）。
- 发版（`npm run release`）不在本计划内。

## 输入工件

- issue：https://github.com/iasiv5/dsh-m/issues/45（报告者推荐方案 A，本轮 grill 改定 A′）
- 设计共识：本轮 grill-with-docs 8 项决策（2026-11-05，见会话记录；GLOSSARY 两条已随定稿落盘）
- 关联 ADR：ADR-0006（latest 缓存制度）、ADR-0013（两段加载/probeMode）、ADR-0031（本役产出）

## 文件结构与职责

- Create: `src/core/published-at.ts` —— 发布时刻派生函数（`modifiedOf`/`publishedAtParts`）、磁盘 store（读写/锁/TTL/淘汰）、`fetchPublishedAt`、`clearPublishedAtCacheForTest`
- Modify: `src/core/market.ts` —— `MarketQuery.withPublishedAt`、`MarketItem.publishedAt`、`MarketResult.publishedAtComplete`（条件键）、`MarketDeps.publishedAt` 注入点、`listMarket` 时间探查段
- Modify: `src/tools.ts` —— `dshm_search` 开启选项、`SearchOut` 增字段、`renderSearch` 条目行尾段时间
- Modify: `src/cli.ts` —— `search` 开启选项、条目下加「最后发布」行
- Modify: `src/core/host-api.ts` —— 新 action `published-at`（单条、磁盘优先）
- Modify: `src/client/detail-modal.jsx` —— 详情弹窗「最后发布」kv 行（prop 直读 + 打开时单条拉取）
- Modify: `src/client/i18n.js` —— 中英字典各加 `modal.publishedAt` / `modal.today` / `modal.daysAgo`
- Test: `tests/published-at.test.mjs`（新）
- Test: `tests/market.test.mjs`、`tests/tools-search.test.mjs`、`tests/cli-search.test.mjs`、`tests/host-api.test.mjs`、`tests/host-api-profile.test.mjs`（ALL_METHODS 审计数组）、`tests/client-render-smoke.test.mjs` 各增用例
- Create: `docs/adr/0031-published-at-search-probe.md`

关键现场锚（时点 2026-11-05，符号优先）：

| 锚 | 位置 |
|---|---|
| `MarketQuery` / `withLatest` 选项注释 | `src/core/market.ts` `interface MarketQuery`（≈:126） |
| `MarketItem` 社区旁路字段区（`added`/`version`） | 同上 `interface MarketItem`（≈:99-118） |
| `MarketResult`（`latestComplete` 相邻） | 同上 `interface MarketResult`（≈:202-216） |
| `MarketDeps` / `marketDeps()` / `listMarket` | 同上（≈:158 / :536 / :546） |
| 时间段插入点：latest 块收尾 `}` 与 `return {` 之间 | `src/core/market.ts`（≈:765-767） |
| `LATEST_WORKERS = 8` | `src/core/market.ts`（≈:262） |
| `packumentTimes`（deps 位置式签名 `(pkg, timeoutMs, signal, deps)`） | `src/core/packument.ts`（≈:211） |
| `packumentViews` 对 `time` 全键拷贝（含 `created`/`modified`） | `src/core/packument.ts`（≈:130-138） |
| `cacheDir()`（= `cacheRoot(WEB_PROFILE)`） | `src/core/env.ts`（≈:77）；`DSHM_CACHE_DIR` 供测试指临时目录（env.ts ≈:65-70 注释） |
| `writeFileAtomic` / `withFileLock` | `src/core/atomic-write.ts`（≈:70 / :156） |
| `<cacheDir()` 共享文件先例 | `src/core/npm-route.ts` `DECISION_FILE` |
| `dshm_search` execute（`withLatest: false` ≈:186） | `src/tools.ts`（≈:169-233）；`interface SearchOut`（≈:553）；`renderSearch`（≈:621-639，条目行模板 ≈:628） |
| CLI search（`withLatest: false` ≈:271；条目循环 ≈:289-294） | `src/cli.ts` |
| host-api `case 'market'` 结束 / `case 'market-ids-exist'` 之间 = 新 case 插入点 | `src/core/host-api.ts`（≈:565-567） |
| `DetailModal` props（≈:29）、`added` kv 行（≈:191） | `src/client/detail-modal.jsx`；`import { api, fmtDate } from "./hooks.js"` |
| zh 字典 `modal.*` 锚 / en 字典 | `src/client/i18n.js`（≈:9 / ≈:141） |
| golden captures（8 个，均**不含** `withPublishedAt`） | `tests/market-golden.test.mjs`（≈:146-155） |
| CLI deps 注入（`runCli(argv, { listMarket })` + `capturedOpts` 捕获） | `tests/cli-search.test.mjs`（≈:36-52） |
| `ALL_METHODS` 审计数组 | `tests/host-api-profile.test.mjs`（≈:132） |
| DetailModal SSR 冒烟先例（`entry` + `base` 夹具） | `tests/client-render-smoke.test.mjs`（≈:323-333） |

## 行为零变化承诺（每特性必填格）

| 口径 | 承诺 |
|---|---|
| 缺省态（`withPublishedAt` 未传，= 今日全部调用点） | `listMarket` 返回体**逐字节不变**（golden 8 captures 全绿即证据，不重生成 fixture）；tools/CLI 输出无新键新行；GUI market payload 不变；详情弹窗无新行 |
| 开启态（tools/CLI 搜索） | `MarketItem` 增可选键 `publishedAt`（缺失不产生键，Q44 同款纪律）；`MarketResult` 增**条件键** `publishedAtComplete`（仅 `withPublishedAt===true` 时存在于返回体）；tools JSON 增条目级 `publishedAt` 与顶层 `publishedAtComplete`；renderSearch 条目行尾增 ` · 发布 <date>（<N 天前>|今天）`；CLI 条目下增 `  最后发布 <date>（<N 天前>|今天）` 行 |
| GUI 详情弹窗 | `it.publishedAt` 在场或 action 拉取成功时增一行 kv；其余形态（非 npm 条目、拉取失败）与今日逐点一致 |

## 任务间验收映射（计划追溯）

| issue #45 回归表/共识决策 | 落点 |
|---|---|
| npm 条目带 `publishedAt`（ISO） | Task 2 / Task 3 |
| `packumentTimes` 失败 → 仍返回、`publishedAt` 缺席、不抛 | Task 2 / Task 3（fail-open） |
| 非 npm/git 源条目不显示不兜底 `added` | Task 3（段内 `source==='npm' && npm` 过滤）+ Task 7（弹窗仅 `it.npm` 触发） |
| `--limit 80` 不超时（受控并发 + 共享 deadline） | Task 3（`LATEST_WORKERS` + `remaining()`；deadline 用尽 → `publishedAtComplete=false`） |
| 缓存命中不发请求（TTL 生效） | Task 2（24h 磁盘 + packument 访问器 5min 内存双层） |
| TTL 24h 硬过期同步重取；失败不落盘 | Task 2 |
| 三端展示格式（` · 发布 …` / `最后发布 …` / 弹窗 kv） | Task 4 / Task 5 / Task 7 |
| 缺省零漂移 | Task 3 golden 复证 + Task 8 全量 |

---

### Task 1: `published-at` 纯派生函数与常量

- 目标：DOM-free 纯函数先行——`time` 表 → `modified` 时刻；ISO → 展示部件。
- 涉及文件：Create `src/core/published-at.ts`、Create `tests/published-at.test.mjs`
- 接口契约
  - Consumes：无（纯函数；测试直接 import `src/core/published-at.ts`？**否**——本模块属 `src/core`，测试按仓库约定从 `lib/core/published-at.js` 引入，先 build）
  - Produces（Task 2-5、7 消费）：
    - `export const PUBLISHED_AT_TTL_MS = 24 * 60 * 60_000`
    - `export const PUBLISHED_AT_STORE_MAX = 20_000`
    - `export function modifiedOf(times: Record<string, string>): string | null` —— `times['modified']` 可被 `Date.parse` 解析则原样返回该键值；否则对键 `!== 'created'` 的条目取 `Date.parse` 最大者返回其原键值；无可解析 → `null`
    - `export function publishedAtParts(iso: string, nowMs?: number): { date: string; days: number } | null` —— `date = iso.slice(0, 10)`；`days = Math.max(0, Math.floor(((nowMs ?? Date.now()) - Date.parse(iso)) / 86_400_000))`；`Date.parse` 失败 → `null`
- 验证范围：边界（`modified` 缺席、全表不可解析、`created` 排除、未来时刻 clamp 0、跨月日界）

- [ ] Step 1: 写失败测试 `tests/published-at.test.mjs`（`describe('publishedAtParts / modifiedOf 纯派生')`）：① `modifiedOf({ modified: '2026-10-27T08:00:00.000Z', '1.0.0': '2026-10-01T00:00:00.000Z' })` → `'2026-10-27T08:00:00.000Z'`；② `modifiedOf({ 'created': '…', '1.0.0': '…', '2.0.0': '…' })` → `'2.0.0'` 时刻值；③ `modifiedOf({})` → `null`；④ `publishedAtParts('2026-10-27T08:00:00.000Z', Date.parse('2026-11-04T09:00:00.000Z'))` → `{ date: '2026-10-27', days: 7 }`（注意 08:00→次日 09:00 跨日界：改用 `2026-10-27T00:00:00.000Z` 与 `2026-11-03T23:00:00.000Z` 得 `days: 7`，避免浮边界）；⑤ 同刻 → `days: 0`；⑥ 未来 1h → `days: 0`；⑦ `publishedAtParts('not-a-date')` → `null`
- Run: `npm run build && node --test tests/published-at.test.mjs`
- Expected: 红——`lib/core/published-at.js` 不存在，import 失败
- [ ] Step 2: 确认失败（同上命令，原退出码非 0）
- [ ] Step 3: 最小实现 `src/core/published-at.ts` 头部：模块 docstring（属主声明 + ADR-0031 引用 + **消歧义句（R6）**：「本模块的『最后发布时刻』是**包级** `time.modified` 语义（ISO string，搜索展示）；区别于 `release-age.ts` 的**版本级** `publishedAt`（`times[version]` → epoch ms number，服务发布等待期/排除治理）——同名异义，注释互指」）+ 两个常量 + 两个纯函数
- [ ] Step 4: 复跑同命令
- Expected: 绿（`# pass 7` 量级，以现场为准）
- [ ] Step 5: checkpoint commit（可选，自然边界）

### Task 2: 磁盘缓存层与 `fetchPublishedAt`

- 目标：24h TTL 磁盘 store（只存成功值）+ 单条取数入口。
- 涉及文件：Modify `src/core/published-at.ts`、Modify `tests/published-at.test.mjs`
- 接口契约
  - Consumes：Task 1 的 `modifiedOf`/常量；`packumentTimes`（`src/core/packument.ts`）；`cacheDir()`（`src/core/env.js`）；`writeFileAtomic`/`withFileLock`（`src/core/atomic-write.js`）
  - Produces（Task 3/6 消费）：
    - `export interface PublishedAtDeps { packumentTimes?: (pkg: string, timeoutMs?: number, signal?: AbortSignal) => Promise<Record<string, string> | null>; nowMs?: () => number }`
    - `export async function fetchPublishedAt(pkg: string, timeoutMs?: number, signal?: AbortSignal, deps?: PublishedAtDeps): Promise<string | null>` —— 语义：① store 惰性加载（进程内 memo，读失败视为空表）；② TTL 内命中（`nowMs() - at < PUBLISHED_AT_TTL_MS`）直回 `modified`，零网络；③ 未命中/过期 → `(deps?.packumentTimes ?? packumentTimes)(pkg, timeoutMs ?? 12_000, signal)` → `modifiedOf`；成功才经 `withFileLock(store)` 读-改-写回盘（`writeFileAtomic`，写后超 `PUBLISHED_AT_STORE_MAX` 经 `evictOldest` 淘汰 `at` 最旧），并回填进程 memo；**回盘自身失败（锁竞争超时 / `writeFileAtomic` 磁盘错误）吞错不抛，仍返回已取得的值**——持久缓存降级为进程内 memo，不冒充落盘成功（值已取得 ≠ 缓存失败，不得让 Task 3 段误标 `publishedAtComplete=false`）；④ 取数失败/返回 null → 返回 `null`，**不落盘、不写负缓存**
    - `export function evictOldest(entries: Record<string, { modified: string; at: number }>, max: number): Record<string, { modified: string; at: number }>`（纯函数，供单测）
    - `export function clearPublishedAtCacheForTest(): void`（清 memo + 重置「已加载」标记）
    - store 常量：`const STORE_PATH = () => join(cacheDir(), 'published-at', 'store.json')`；键格式 `(`${pkg}\n${await activeNpmRegistry()}`)`（与 `packumentKey` 同形，`activeNpmRegistry` 来自 `./npm-route.js`）
- 验证范围：命中零网络（取数计数器）、TTL 过期重取（`deps.nowMs` 推进 25h）、失败不落盘、回盘失败吞错仍返回值、连败后成功回写、store 文件形态（键含 `\n`、值 `{modified, at}`）、`evictOldest` 纯矩阵、并发双写 store 仍为合法 JSON

- [ ] Step 1: 追加失败测试 `describe('fetchPublishedAt 磁盘缓存')`：`before()` 里 `process.env.DSHM_CACHE_DIR = mkdtempSync(join(tmpdir(), 'dshm-pubat-'))` 并在该目录写入路由决策文件 `npm-route.json`（`{"base":"https://registry.npmjs.org"}`）+ 首次 `resetNpmRouteForTests()`（键确定性，全局约束 R3 条），每个用例前 `clearPublishedAtCacheForTest()`。用例：① 注入 `packumentTimes` 计数 stub（返回含 `modified`）→ 首调（pkg 用 `pkg-a`）返回值正确、`readFile(store.json)` 键**恰为** `pkg-a\nhttps://registry.npmjs.org`（`Object.keys` 精确断言）；② 二调（同 pkg）→ stub 计数不变（磁盘直回）；③ `deps.nowMs` 推进 `PUBLISHED_AT_TTL_MS + 1` → stub 计数 +1；④ stub 返回 `null` 两次 → 两调均 `null` 且 store 文件不存在；⑤ 第 5 用例 stub 改回成功 → 回写成功；⑥ `evictOldest` 三条 + `max: 2` → 剩 `at` 最新的两条；⑦ `Promise.all` 两个不同 pkg 并发首取 → store 可 `JSON.parse` 且含两键；⑧ 回盘失败吞错：`DSHM_CACHE_DIR/published-at` 预置为**同名普通文件**（占位使 mkdir/写必败，POSIX/Windows 同判）→ 取数成功仍返回值且不抛（重置占位后 memo 不回写、下次调用正常落盘）
- Run: `npm run build && node --test tests/published-at.test.mjs`
- Expected: 红——`fetchPublishedAt` 未导出
- [ ] Step 2: 确认失败
- [ ] Step 3: 最小实现（store 读写 + 锁 + memo + `fetchPublishedAt` + `evictOldest` + `clearPublishedAtCacheForTest`）
- [ ] Step 4: 复跑同命令
- Expected: 绿
- [ ] Step 5: checkpoint commit（可选）

### Task 3: core `listMarket` 时间探查段

- 目标：`withPublishedAt` 选项 + 页内 npm 条目并发探查 + fail-open 完整性旗标；缺省零漂移。
- 涉及文件：Modify `src/core/market.ts`、Modify `tests/market.test.mjs`
- 接口契约
  - Consumes：Task 2 `fetchPublishedAt`/`PublishedAtDeps`；`MarketDeps` 既有注入形态（`composeEnablement?` 可选缺省先例）；`mapWithConcurrency`/`LATEST_WORKERS`/`remaining()`/`abortError()`（market.ts 现有符号）
  - Produces（Task 4/5/6 消费）：
    - `MarketQuery.withPublishedAt?: boolean`（注释注明：默认 false；tools/CLI 恒 true；GUI 列表不开，详情走单条 action）
    - `MarketItem.publishedAt?: string`（全 ISO；缺失不产生键；**消歧义（R6）**：包级 `time.modified` 语义，区别于 `release-age.ts` 版本级 `publishedAt`（epoch ms，发布等待期））
    - `MarketResult.publishedAtComplete?: boolean`（**条件键**：仅 `opts.withPublishedAt === true` 时进入返回体）
    - `MarketDeps.publishedAt?: typeof fetchPublishedAt`（缺省 `fetchPublishedAt`）
    - 段逻辑：latest 块之后、`return {` 之前——`if (opts.withPublishedAt === true && items.length > 0)`：候选 = `items.filter(it => it.source === 'npm' && it.npm)`；`budget = remaining()`，`budget <= 0` → 跳过取数、`publishedAtComplete = false`；否则 `mapWithConcurrency(候选, LATEST_WORKERS, …)` 逐条 `d.publishedAt?.(it.npm, Math.max(1, Math.min(remaining(), 12_000)), signal) ?? fetchPublishedAt(…)`，成功置 `it.publishedAt`，失败/超时 → 完整性置 false；`signal?.aborted` → `throw abortError()`（镜像 latest 块 ≈:743 口径）
- 验证范围：开启态标注、非 npm 不取、失败 fail-open、缺省零漂移、deadline 用尽短路、golden 复证

- [ ] Step 0: 断言面普查（改返回形态必清点；四类形态 + B9 冻结钉例清点，均已现场核证 2026-11-05，执行时复核即可）：
  - A 全对象 `deepEqual`：`grep -rn 'listMarket' tests --include='*.mjs' -l` 逐文件核对——golden captures（`tests/market-golden.test.mjs` ≈:146-155）不传 `withPublishedAt` → 条件键设计下零漂移；其余现场文件执行时复核并逐一列入 commit message。
  - B `Object.keys` 键集合断言（已核三处均不受影响）：`tests/host-api.test.mjs` ≈:470（`installedUpdates` InstalledItem 七键闭包，不同返回路径）；`tests/market-golden.test.mjs` ≈:166（顶层键集合自比 sanity，缺省态恒过）；`tests/client-i18n.test.mjs` ≈:60（ZH/EN 键集逐键相等——恰为 Task 7 双字典三键的同步守卫，非本 Task 断言面）。
  - C 捕获 opts 全对象断言：`deepEqual(calls…)/deepEqual(captured…)` 形态于 `tests/tools-search.test.mjs`/`tests/market.test.mjs`/`tests/cli-search.test.mjs` grep **零命中**（2026-11-05 现场核证）——Task 4/5 给 execute opts 增 `withPublishedAt` 不破坏任何既有断言。
  - D B9 冻结钉例清点（结论：「新增 describe 自带夹具、既有钉例零改动」）：`tests/market.test.mjs` ≈:656 describe「dshm_search：安装标注单快照契约（Tier B + fail-closed）」各例（:684 透传 / :703 fail-closed→rejects ≈:715 / :718 空结果保持 / :736 端到端坏 profile→rejects ≈:756 / :762 端到端合法）——mock 返回体不含新键、fail-closed gate 只读 `installedComplete` → 安全；≈:1603 describe「M1 Task 7：probe deadline 硬上限与双 waiter 顺序」:1604 起——publishedAt 段缺省不执行 → 安全；`tests/packument.test.mjs` ≈:154「cap=4：第 5 键写入淘汰最旧」——`packument.ts` 本役零改动 → 安全。
- [ ] Step 1: `tests/market.test.mjs` 新 `describe('withPublishedAt 时间探查段')`（自带夹具，不引兄弟 describe）：goldDeps 形态夹具 + 注入 `publishedAt` stub。用例：① stub 全成功 → npm 条目 `publishedAt` 在场、github 源条目键缺席、`result.publishedAtComplete === true`；② stub 返回 `null` → 对应条目键缺席、`publishedAtComplete === false`；③ 不传 `withPublishedAt` → items 全员无 `publishedAt` 且 `assert.ok(!('publishedAtComplete' in result))`；④ 注入慢 `loadRegistry`（`async () => { await new Promise(r => setTimeout(r, 20)); return … }`）+ `deadlineMs: 5` + `withPublishedAt: true` → stub 调用计数 `0` 且 `publishedAtComplete === false`
- Run: `npm run build && node --test tests/market.test.mjs`
- Expected: 红——`withPublishedAt` 未实现（①④失败；③今日已绿，作回归钉）
- [ ] Step 2: 确认失败（③绿①②④红即预期形态）
- [ ] Step 3: 最小实现（四处类型/契约 + 段逻辑）
- [ ] Step 4: 复跑同命令 → 绿
- [ ] Step 5: golden 零漂移复证
- Run: `npm run build && node --test tests/market-golden.test.mjs`（**不带** `UPDATE_GOLDEN`）
- Expected: 绿——8 captures 逐字节等价 = 缺省态零漂移证据
- [ ] Step 6: checkpoint commit（可选）

### Task 4: tools `dshm_search` 接线

- 目标：agent 工具搜索开启时间探查并透出字段与文案。
- 涉及文件：Modify `src/tools.ts`、Modify `tests/tools-search.test.mjs`
- 接口契约
  - Consumes：Task 3 的 `MarketItem.publishedAt`/`MarketResult.publishedAtComplete`；Task 1 `publishedAtParts`（`renderSearch` 消费）；既有 `SearchOut`（`src/tools.ts` `interface SearchOut` ≈:553）
  - Produces：`SearchOut.items[]` 增 `publishedAt?: string`、顶层增 `publishedAtComplete?: boolean`；renderSearch 条目行尾段 ` · 发布 ${p.date}（${p.days === 0 ? '今天' : `${p.days} 天前`}）`
- 验证范围：渲染锚（8 天前 / 今天 / 缺席三态）+ execute opts 恒开断言（夹具已核实存在：`loadSearch(listMarketImpl, calls)` 注入 `{ listMarket }` 并 `calls.push(opts)`，`tests/tools-search.test.mjs` ≈:46-54；先例断言 `calls[0].limit` ≈:63-69）

- [ ] Step 1: `tests/tools-search.test.mjs` 新 `describe('renderSearch 发布时间')`：① out.items[0] 带 `publishedAt: new Date(Date.now() - 8 * 86_400_000).toISOString()` → 渲染含 `· 发布 ` 与 `（8 天前）`（整 8 天差避免时区/进位边界）；② `publishedAt: new Date(Date.now() - 2 * 3600_000).toISOString()` → 含 `（今天）`；③ 无 `publishedAt` → 条目行不含 `发布 `（源串锚单行，无 `\n`）；④ execute opts 恒开断言（B5 核心验收面）：经 `loadSearch` 夹具 `execute({ query: 'demo' })` 后 `assert.equal(calls[0].withPublishedAt, true)` 且 `assert.equal(calls[0].withLatest, false)`（对齐 Task 5 用例①口径）
- Run: `npm run build && node --test tests/tools-search.test.mjs`
- Expected: 红
- [ ] Step 2: 确认失败
- [ ] Step 3: 实现：execute 的 `listMarket` opts 在 `withLatest: false,`（≈:186）后增 `withPublishedAt: true,` 并更新该注释块（metadata-only 指latest；发布时刻 opt-in 开启）；items map 增条件展开 `...(e.publishedAt !== undefined ? { publishedAt: e.publishedAt } : {})`；顶层增 `...(result.publishedAtComplete !== undefined ? { publishedAtComplete: result.publishedAtComplete } : {})`；`SearchOut` 同步字段；`renderSearch` 条目行模板（≈:628）尾接段（`publishedAtParts` import 自 `./core/published-at.js`）
- [ ] Step 4: 复跑同命令 → 绿
- [ ] Step 5: checkpoint commit（可选）

### Task 5: CLI `search` 接线

- 目标：CLI 搜索开启选项并在条目下输出「最后发布」行。
- 涉及文件：Modify `src/cli.ts`、Modify `tests/cli-search.test.mjs`
- 接口契约
  - Consumes：Task 3 opts/字段；Task 1 `publishedAtParts`
  - Produces：CLI 输出行 `  最后发布 ${p.date}（${p.days === 0 ? '今天' : `${p.days} 天前`}）`（仅 `it.publishedAt` 存在且可解析时）
- 验证范围：`capturedOpts.withPublishedAt === true` 与 `withLatest === false`（既有 `runSearchCapture` 捕获面）；输出行锚三态

- [ ] Step 1: `tests/cli-search.test.mjs` 追加：① `runSearchCapture` 断言 `captured.withPublishedAt === true && captured.withLatest === false`；② `item({ publishedAt: new Date(Date.now() - 8 * 86_400_000).toISOString() })` → text 含 `最后发布 ` 与 `（8 天前）`；③ 无 `publishedAt` → text 不含 `最后发布`
- Run: `npm run build && node --test tests/cli-search.test.mjs`
- Expected: 红（①失败：opts 未传）
- [ ] Step 2: 确认失败
- [ ] Step 3: 实现：`src/cli.ts` `withLatest: false,`（≈:271）后增 `withPublishedAt: true,`；条目循环（≈:293 description 行之后）增条件输出行（`publishedAtParts` import）
- [ ] Step 4: 复跑同命令 → 绿
- [ ] Step 5: checkpoint commit（可选）

### Task 6: host-api 单条 action `published-at`

- 目标：GUI 详情弹窗的取数缝点（单条、磁盘优先、零列表成本）。
- 涉及文件：Modify `src/core/host-api.ts`、Modify `tests/host-api.test.mjs`、Modify `tests/host-api-profile.test.mjs`
- 接口契约
  - Consumes：Task 2 `fetchPublishedAt`；host-api 既有 `ApiProtocolError`/`strArg`/`case` 分派形态（`case 'market'` ≈:505-565）
  - Produces：action `published-at`，body `{ npm: string }`；payload `{ publishedAt: string | null }`（取数失败 → `null`，不 500）；非法 `npm`（空/非串）→ `ApiProtocolError(400, …)`
- 验证范围：store 预置命中（零网络）、400 校验、`ALL_METHODS` 审计数组同步

- [ ] Step 1: 失败测试：① `tests/host-api.test.mjs` 新 describe：`DSHM_CACHE_DIR` 指临时目录 + 预置路由决策文件 `npm-route.json` + `resetNpmRouteForTests()`（全局约束 R3 条），并预置 `published-at/store.json` 含键 `pkg-a\nhttps://registry.npmjs.org`（值 `{ modified: '2026-11-01T00:00:00.000Z', at: Date.now() }`，TTL 内），`clearPublishedAtCacheForTest()` 后调用 → `callApi({ method: 'published-at', body: { npm: 'pkg-a' } })` 返回该 `modified`（零网络命中路径）；② `npm: ''` → 400。③ `tests/host-api-profile.test.mjs` `ALL_METHODS`（≈:132）数组加入 `'published-at'`（**已核语义**：该数组是 trust-401 审计的输入清单，非实现方法白名单——消费点 ≈:159-165 逐 method 断 401，`no-such-method` 同在数组即证 trust 先于方法分派；`seen.length === ALL_METHODS.length` 与数组自身长度自洽。加 `'published-at'` 仅为保持审计覆盖，**不产生先行红、也不是绿信号**；本 Task 的红由用例①承担——实现前新方法落 `src/core/host-api.ts` default 分派 `ApiProtocolError(404, 未知 method)` ≈:839）
- Run: `npm run build && node --test tests/host-api.test.mjs tests/host-api-profile.test.mjs`
- Expected: 红（仅由用例①承担：实现前 `published-at` 落 default 分派 `ApiProtocolError(404)` → store 值断言失败；②③不构成红，见 ③ 的已核语义）
- [ ] Step 2: 确认失败
- [ ] Step 3: 实现：`case 'published-at'` 插入 `case 'market'` 与 `case 'market-ids-exist'` 之间（≈:565-567），`payload = { publishedAt: await fetchPublishedAt(String(body.npm).trim(), 12_000, signal) }`
- [ ] Step 4: 复跑同命令 → 绿
- [ ] Step 5: checkpoint commit（可选）

### Task 7: GUI 详情弹窗行 + i18n

- 目标：弹窗「最后发布」kv 行；prop 直读优先，缺失且 `it.npm` 在场时打开时单条拉取。
- 涉及文件：Modify `src/client/detail-modal.jsx`、Modify `src/client/i18n.js`、Modify `tests/client-render-smoke.test.mjs`
- 接口契约
  - Consumes：Task 6 action `published-at`；`api`/`fmtDate`（`./hooks.js`，detail-modal 既有 import）；`lookup`（`./i18n.js`）；`it.publishedAt`（Task 3 字段，搜索态条目可能已携带）
  - Produces：i18n 键 `modal.publishedAt`（zh `最后发布` / en `Published`）、`modal.today`（zh `今天` / en `today`）、`modal.daysAgo`（zh `{n} 天前` / en `{n}d ago`）；kv 行渲染 `${fmtDate(pub)}（${days === 0 ? lookup("modal.today") : lookup("modal.daysAgo", { n: days })}）`，仅在 `it.npm` 条目且有值时渲染
  - 客户端不引 core 模块：日期/天数在组件内内联（`fmtDate` + `Math.max(0, Math.floor((Date.now() - Date.parse(pub)) / 86_400_000))`，展示格式化非领域判定，不入 core 单一产地）
- 验证范围：i18n 守卫（`tests/client-i18n.test.mjs` 直接量审计随键自动覆盖）；SSR 冒烟在场/缺席两态（ZH/EN 双语容忍——node 下断言用 en 词 `Published`）

- [ ] Step 1: 失败测试 `tests/client-render-smoke.test.mjs` DetailModal 区（≈:323 先例旁）：① `it: { ...entry, publishedAt: '2026-10-27T08:00:00.000Z', npm: 'pkg-a' }` → `renderToString` 结果含 `Published`；② 基线 `it: entry`（无 `publishedAt`）→ 不含 `Published`
- Run: `npm run build && node --test tests/client-render-smoke.test.mjs`
- Expected: 红（①失败：行未实现）
- [ ] Step 2: 确认失败
- [ ] Step 3: 实现：i18n 两字典三键；detail-modal 增 `const [pubAt, setPubAt] = useState(it.publishedAt ?? null)` + effect（`it.npm && it.publishedAt === undefined` 时 `api("published-at", { npm: it.npm }).then(r => setPubAt(r?.publishedAt ?? null)).catch(() => {})`，失败静默）；kv 行插在 `added` 行（≈:191）相邻
- [ ] Step 4: 复跑同命令 → 绿；再跑 `node --test tests/client-i18n.test.mjs` → 绿（守卫随键）
- [ ] Step 5: checkpoint commit（可选）

### Task 8: ADR-0031 + 全量收口

- 目标：决策记录与全仓门禁收口。
- 涉及文件：Create `docs/adr/0031-published-at-search-probe.md`；GLOSSARY **不再动**（两条已随 grill 定稿于 2026-11-05 落盘：`最后发布时间（Published At）` 新术语 + `packument 访问器` 消费面扩围）
- ADR 必备论点（执行时按 `docs/adr/` 既有格式展开）：
  - Context：issue #45；搜索路径刻意 metadata-only 的性能护栏；发布时刻唯一权威源是全量 packument（abbreviated 无 `time`）
  - Decision：读时逐条 packument + 24h 磁盘持久缓存（成功值 only、键含生效 registry、上限 2 万条）+ `withPublishedAt` opt-in（tools/CLI 恒开、GUI 仅详情单条 action）+ 非 npm 条目不兜底 `added`
  - Alternatives rejected（各附一句理由）：`--fresh` 过滤（生态无区分度，报告者数据）；仅详情页（信号缺席）；原案 A 无持久缓存（每次翻页全额打网）；7 天 TTL（误差落在 0–14 天判断敏感区，34% 条目 7 天内真发版）；SWR（一次性 tools/CLI 调用后台刷新救不了当次显示）；上游目录烘焙（跨仓 PR 循环不可控，主人裁决不碰上游）；`PACKUMENT_CAP` 扩容（内存缓存属预检语义，cap 钉例零改动）
  - Consequences：显示误差上界 24h（天粒度展示不可见，论证写入）；与 ADR-0006 的快/慢变量界线；缺省态逐字节零漂移承诺（golden 钉）
- [ ] Step 1: 写 ADR-0031
- Run: `ls docs/adr/0031-published-at-search-probe.md`
- Expected: 文件存在且含 Context/Decision/Alternatives/Consequences 四节
- [ ] Step 2: 全量收口
- Run: `test -d node_modules && set -o pipefail && npm run build && npm test 2>&1 | tail -20` 与 `set -o pipefail && npm run typecheck 2>&1 | tail -5`
- Expected: 两命令原退出码均 0（`npm test` 含 pretest build + import guard + 全部 `tests/*.test.mjs`；golden 无 `UPDATE_GOLDEN` 仍绿）
- [ ] Step 3: 输出修改摘要（逐文件可归因，计划外改动为零）

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行；每任务先跑该任务验证再进下一任务；不无声跳步、合并步或改变任务目标。
- 遇阻塞、重复失败或计划与仓库现实不符（含行号锚漂移——一律以符号锚重定位），立即停下说明，不猜。
- 当前分支 `main`：开工前向主人确认（或按主人指示开分支）。
- 全部任务完成后运行最终验证并输出修改摘要；**停在这里**——`npm run release`、issue #45 回帖、issue 关闭均属不可逆公开动作，另等当轮明确批准（AGENTS.md 发版规矩）。

## 最终验证

- `test -d node_modules && npm run build && npm test`（`set -o pipefail`，全绿，原退出码 0）
- `npm run typecheck`（0 错误）
- `node --test tests/market-golden.test.mjs` 单跑复证（不带 `UPDATE_GOLDEN`，绿 = 缺省零漂移）
- 人工抽检（**可归因判据**，R7）：`node lib/cli.js search memory --limit 5` 首跑输出含「最后发布」行，且跑后 `<cacheDir()>/published-at/store.json` 在场并含本次命中包名的键（形如 `<pkg>\nhttps://registry.npmjs.org`，cat 可见）；二跑输出仍含「最后发布」行。速度对比仅作附带印象、**不作判据**——二跑变快可归因于 store 命中、npm-route 决策文件命中（免 probe-once 真网）与网络抖动三者，不可归因即不可验收。
