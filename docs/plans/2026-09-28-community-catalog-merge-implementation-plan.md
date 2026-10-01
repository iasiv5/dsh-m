# 社区清单合并（M1）实施计划 · v10（第九轮复审修订）

> v10 变更（第九轮复审）：① 架构快照「总 deadline」行同步为 waiter-scoped 契约（删除 min(deadlineAt−now) 旧公式）；② **两种 waiter deadline 顺序测试落位 Task 5 ⑫e**（3s summary 先建 flight → 长 market 后加入且完成；market 先建 → summary 3s 提前返回、flight 继续完成）；③ 记账规则去重——合并为单一表述（绑定一次、每物理 fetch reserve 一次、joiner 不重复计）；④ Q46 范围 DESIGN 一致性复核完成（§2.5 与 Q46 均已写「仅被动探测」）。
> v9 变更（第八轮复审）：① Task 5 残留矛盾清除——listMarket 启动社区 flight 后**只由 waiter race 自己的绝对 deadline**，不再向共享 loader 传 deadlineAt（与 Task 3/6 的 waiter-scoped 契约统一）；② `listInstalledWithMeta` 的 60s deadline 改为**贯穿整个 probe 的绝对 deadline/AbortSignal**（多跳 githubLatestTag 不逐子请求重置预算；到点时在途条目标 timeout、未启动条目标未完成并停止派发）；③ reserve 记账措辞修正（flight 创建时只**绑定** leader 预算对象；reserve() 每物理 fetch 前各一次，fallback 三请求各计）；④ 重定向钩子测试措辞改为「单次 redirect → 2 次、两次连续 redirect → 3 次」+ 逐跳次序断言；⑤ pin/latest **metadata 文件分离**（`meta.json` latest 专用 + `meta-pin-<version>.json`，pin 绝不更新 latest 指针）；⑥ Q46「仅被动探测受 50/h 预算」同步写入 DESIGN §2.5 与 Q46。
> v8 变更（第七轮复审 + 补充意见）：① 共享 loader 与调用者 deadline 彻底分离——`CommunityFetchOptions` 删除 `deadlineAt`，共享加载只认自身 `flightStartedAt + 30s` hard cap；deadline race 全在 waiter 层（market 用请求 deadline、registry summary 用 3s），两顺序测试入列；② 策略池测试 ⑫d 改为断言**两条独立 flight**（互不 join）；③ 预算 reserve 时序：每次实际 fetch 前调用、每个重定向 hop 各 reserve 一次、exhausted → 该跳不发 fetch 并返回可识别 `budget-exhausted` 错误；④ **pin 与 unpinned 的 meta 分离**（pin 不覆盖 latest 的 checkedAt/version）+ pin→unpinned 回退测试；⑤ latestError 按 code 呈现且不静默省略检查状态；⑥ 标题版本号修正。
> v7 变更（第六轮复审）：**共享 flight 硬上限与 waiter deadline 分离**——flight 自身 30s hard cap（flight-scoped），每个 waiter 用自己的 deadline/signal 与共享 Promise race（waiter-scoped）；flight key 不含 deadline。`dshm_list`/`dshm_outdated` 补 `ToolRunContext.signal` + `deadlineMs`（工具 timeout 65s > core installed deadline 60s + 5s 回包余量）。passive 池记账规则定稿：宿主滚动窗口对一条物理 wire 请求只计一次；request-scoped reserve 在 flight 创建时由 leader 计一次，joiner 不重复 reserve（join 零 wire 成本，预算已耗尽的 waiter 可免费加入既有 flight）。`getCommunitySummary` 禁止内部调用 `loadRegistry`（primaryEntries 单一来源），⑥b 为强制回归。
> v6 变更（第五轮复审）：single-flight key 纳入**预算策略池**（passive-budgeted 与 active-unbudgeted 分池——两种 leader 顺序都测，杜绝被动借用主动 flight 绕预算、或主动被被动预算拒绝）；`httpx` 的 `onRequest` 钩子上移到 **Task 1**（贯穿全部 fetch 原语、重定向逐跳调用、reserve 拒绝即中止该跳），Task 5 文件与 staging 清单补入 `src/core/httpx.ts`；**pin 隔离**：pin 非空时缓存命中必须 meta.version === pin 且优先读 `catalog-<pin>.json`，in-flight key = namespace + 生效 pin + 配置代（force 分池），A/B 并发与 pin/unpinned 并发互不串版本；`getCommunitySummary` 签名改为接收**本次 registry snapshot 的 primaryEntries**（displaced 与本次响应同代、不重复加载主清单）；latestError 增加结构化 code（budget-exhausted/rate-limited/timeout/network-error），文案统一「检查未完成」+ 按 code 安全化原因，不再一律归因预算。
> v5 变更（第四轮复审）：Q46 预算改为 **request-scoped**（`listInstalledWithMeta` 每次检查建预算对象，跨 repo 与 fallback 共享）且**只在物理 outbound fetch 层计数**（httpx 增加 `onRequest` 钩子，重定向每一跳都计）；50/h 滚动窗口**只作用于被动探测**——用户主动 install/upgrade/诊断不经预算（限额提示沿用）；single-flight 改由内部 AbortController 管理（leader/waiter abort 互不连坐，最后一个 waiter 离开才 abort）；社区 loader 增加 **host namespace in-flight 合并**（并发冷 miss 只加载一次、waiter abort 隔离）；registry summary 定义 **3s 短 deadline** + 传请求 signal，超时返回 unavailable summary 不阻塞主响应；新增 `getCommunitySummary` 单一深接口（fetch→adapt→merge→summary，完整字段口径）；`dshm_outdated` 投影与标题携带 latestError/未完成数；fixture 改为入库的人工裁剪工件（不依赖 /tmp 临时文件）。
> v4 变更（第三轮复审）：修正剩余预算公式（`min(BUDGET − 已耗时, deadlineAt − now)`，v3 的「已耗时」笔误）；开放分类/`primaryOnly` 的 **Host API 请求解析**与 GUI `fetchPage()` 请求体写入列入 Task 6/9 契约与测试；`registry` 响应的社区 summary 指定数据源 = registry 分支内 **cache-first 调用 `fetchCommunityCatalog`**（不进 controller、无重复网络压力）；`InstalledResult` 增加 community summary（CLI outdated 双源判定的状态来源）；Q46 预算下沉到 **versions.ts 请求层**（真实 HTTP 计数、fallback 三请求路径、single-flight 合并 abort）；超预算 `latestError` 三端呈现且禁止「全部最新」结论；缓存读取顺序（meta 校验 → exact 校验 → 路径 containment）与恶意 meta/过期同版本测试；Task 7 测试文件归位（summary 单测独立、CLI 契约在 market.test.mjs）；DESIGN §2.5「陈旧」措辞统一。
> v3 变更（第二轮复审）：stale 语义定稿为「运行时缓存 + 显式 stale 标注」（DESIGN/ADR 已同步）；主/社区加载并发 + 共享 listMarket deadline；controller bootstrap 同步社区初始值（legacy/forms 两代）；CLI `list` 保持本地清单契约、`DSHM_COMMUNITY_CATALOG=0` 接入 `cliConfig()`；`dshm_search` 传 deadlineMs/signal。
> v2 变更：`src/host.ts` 路径与 settings-compat 接线；`RegistryConfig` 扩展与 `InstallableEntry` 收窄；开放分类/`primaryOnly` 全链路；CLI 双层语义；dist-tags 注入与 `checkedAt` TTL；版本串安全；已装页匹配/豁免/provenance；计数与 route 进 summary；共享桶分组；截图消费端校验；fixture 入库。

## 目标

- 为 dsh-m 叠加只读的社区清单（awesome-dsh-plugin 目录，锚定 npm 包 `dsh-plugin-catalog`），与主清单合并为合并市场（主清单恒优先），GUI / agent 工具 / CLI 三端一致。
- 全部语义以 `docs/DESIGN.md` §2.5 与 §9.3（Q38–Q46）为准；术语以 `GLOSSARY.md` 为准。

## 架构快照

- **数据流**：`community.ts`（版本探测 + 三线路获取 + 版本缓存）→ `community-adapter.ts`（原生条目 → `CommunityEntry`）→ `market.ts`（`mergeRegistries` 合并、排序、过滤分页、探测边界）→ `host-api.ts` / `tools.ts` / `cli.ts` / client。
- **社区层不进 registry-controller**：cfg 驱动的固定源 + 缓存；配置通路经 `unwrapConfig` 透传 + controller watch/bootstrap 同步到共享 config 对象。`registry` 响应的社区 summary 由 host-api 分支 **cache-first 调用 `fetchCommunityCatalog`** 生成（版本缓存 + TTL 保证无重复网络压力），不进 controller snapshot。
- **版本号即 revalidate 验证器**：dist-tags 探测得最新版本；`meta.checkedAt` 在 TTL 内 → 跳过探测；版本未变 → 不重拉正文；pin 非空 → 跳过探测。版本串必须先过 `isExactVersion` 才能进 URL 与缓存文件名。
- **类型边界**：`RegistryEntry.category` 保持 5 值封闭联合；`CommunityEntry = Omit<RegistryEntry,'category'> & { category: string; …旁路字段 }`；安装接口收窄为 `InstallableEntry`。
- **探测边界（Q46）**：市场浏览页只探测「主清单条目 + 社区 npm 条目」；已装页豁免但按**真实 wire HTTP 请求数**计量（httpx `onRequest` 钩子逐物理请求计数，重定向每一跳都计）：**request-scoped 预算 ≤25/次检查** + **宿主滚动 1 小时 ≤50 仅作用于被动探测**（用户主动 install/upgrade/诊断不经此预算）+ 同仓库 in-flight single-flight 且 **key 含预算策略池**（passive-budgeted / active-unbudgeted 分池，互不 join）；`githubLatestTag` 一次调用 ≈ 1–3 个 wire 请求。
- **总 deadline**：主清单与社区 loader 并发启动；**listMarket / registry summary 各自作为 waiter race 自己的 deadline/signal**——共享社区 flight **不接收调用者 deadline**，只受自身 30s hard cap 与 waiter 生命周期控制（最后一个 waiter 离开才 abort）。

## 全局约束

- Node `>=22`、零新运行时依赖；主清单严格校验与 2 MiB/1000 上限不改。
- 社区清单容器层严格（32 MiB / 30,000 条整份拒收）、条目层宽松（跳过计数）；绝不做包内快照；stale 运行时缓存可展示但必须显式标注（过期数据不得冒充最新）。
- 安全基线 5 条不放宽；安装走同一 `installEntry` 语义。
- GUI 文案三原则；能力披露「缺省=未扫描≠未检出」，卡片不打标；agent 工具输出不泄露本地路径。
- **执行顺序约束**：与 M2 共享 `market.ts`/`httpx.ts`/`tests/market.test.mjs`/`tests/httpx.test.mjs`，可分阶段验证、不支持并行落地；按 M1 → M2 串行、同一特性分支。

## 输入工件

- `docs/DESIGN.md` §2.5、§9.3、§4/§5；`docs/adr/0003-community-catalog-merge.md`；`GLOSSARY.md`
- fixture：`tests/fixtures/community-catalog-sample.json`（入库的人工裁剪工件；字段对照上游 schema 核对，不依赖工作站临时文件）

## 文件结构与职责

- Create: `src/core/community.ts`、`src/core/community-adapter.ts`、`tests/fixtures/community-catalog-sample.json`、`scripts/smoke-community-catalog.mjs`、`tests/tools-summary.test.mjs`
- Modify: `src/core/registry.ts`（仅 RegistryConfig 两字段）、`src/core/market.ts`、`src/core/host-api.ts`、`src/core/httpx.ts`、`src/core/settings-compat.ts`、`src/core/registry-controller.ts`、`src/core/versions.ts`（GitHub 请求预算：计数/single-flight/滚动窗口）、`src/host.ts`、`src/tools.ts`、`src/cli.ts`、`src/client/market-state.js`、`src/client/main.jsx`、`src/client/installed-view.js`（latestError 呈现）、`README.md`、`README.en.md`
- Test: `tests/community.test.mjs`、`tests/community-adapter.test.mjs`、`tests/market.test.mjs`、`tests/host-api.test.mjs`、`tests/settings-compat.test.mjs`、`tests/registry-controller.test.mjs`、`tests/client-market-state.test.mjs`、`tests/versions.test.mjs`、`tests/tools-summary.test.mjs`

不改动：`registry.ts` 的加载/校验/prune 逻辑、`registry-check.ts`、`scripts/validate-registry.mjs`、`package.json` 依赖。

## 任务清单

### Task 1: `httpx.ts` 增加 `fetchBytesLimited`

- Files: Modify `src/core/httpx.ts`；Test `tests/httpx.test.mjs`
- 接口契约：Produces `fetchBytesLimited(url, { timeoutMs, maxBytes, signal, headers? }): Promise<{ bytes: Buffer; finalUrl: string }>`，以及 **`FetchOptions.onRequest?(url: string): void` 钩子——贯穿 httpx 全部原语（`fetchLimited`/`fetchJsonLimited`/`fetchTextLimited`/`fetchBytesLimited`），每个物理 outbound 请求调用一次（重定向每一跳都调）；钩子抛错/reserve 拒绝 → 该跳 fetch 立即中止**（Task 5 的 GitHub 预算 reserve 挂在此钩子上）
- 验证范围：`npm run build && node --test tests/httpx.test.mjs`
- [ ] Step 1: 失败测试：200 二进制 body 断言 bytes/finalUrl；超 `maxBytes` 抛错；301 跳转 finalUrl；**onRequest 钩子**：无重定向调 1 次；**单次 redirect（初始+目标）→ 2 次；两次连续 redirect → 3 次**；逐跳 URL 与 reserve 调用次序断言；钩子抛错时该请求中止且错误上抛
- [ ] Step 2: Run — Expected: 失败（未导出）
- [ ] Step 3: 实现（复用手动重定向循环语义）
- [ ] Step 4: Run — Expected: 通过
- [ ] Step 5: `git add src/core/httpx.ts tests/httpx.test.mjs && git commit -m "feat(0.5.0): httpx fetchBytesLimited primitive"`

### Task 2: `community.ts` 类型、容器校验、分类标签表与入库 fixture

- Files: Create `src/core/community.ts`、`tests/fixtures/community-catalog-sample.json`；Test `tests/community.test.mjs`
- 接口契约：Produces `COMMUNITY_NPM_PACKAGE`、`MAX_COMMUNITY_BYTES=32MiB`、`MAX_COMMUNITY_ENTRIES=30_000`、`CATALOG_BODY_TIMEOUT_MS=15_000`、`COMMUNITY_CHAIN_BUDGET_MS=30_000`、`CommunityRawEntry`、`CommunityCatalog`、`validateCommunityContainer`、`COMMUNITY_KNOWN_CATEGORIES`（23 id 全量中文标签——agi/ui/usage/theme/model/identity/session/memory/tools/wsl/browser/vision/voice/docs/skill/workflow/git/notify/dev/security/remote/market/fun；ui/tools/market 与精选共享桶，不进筛选栏社区组）
- 验证范围：`npm run build && node --test tests/community.test.mjs`
- [ ] Step 1: fixture 为**入库的人工裁剪工件**（不依赖工作站 /tmp 文件；字段对照上游 build-site.mjs schema 人工核对）：30 条——全分类覆盖、2 组同名异 owner、无 npm 子包、有 npm 子包、tarball-only、zh>500、缺 zh、categories 全表。可选再生脚本 `scripts/gen-community-fixture.mjs`（opt-in，下载 `dsh-plugin-catalog@<脚本内写死版本>` 裁剪输出）。失败测试：合法最小 catalog 通过；未知顶层键/plugins 非数组/30,001 条拒收；标签表 23 id 全覆盖
- [ ] Step 2: Run — Expected: 失败
- [ ] Step 3: 实现类型/常量/校验
- [ ] Step 4: Run — Expected: 通过
- [ ] Step 5: `git add src/core/community.ts tests/community.test.mjs tests/fixtures/community-catalog-sample.json && git commit -m "feat(0.5.0): community catalog container schema + fixture"`

### Task 3: `community.ts` 版本探测、三线路获取、TTL 与预算

- Files: Modify `src/core/community.ts`；Test `tests/community.test.mjs`
- 接口契约
  - Consumes: Task 1 `fetchBytesLimited`；`npmLatest(pkg, timeoutMs, signal, registryBase)` 第 4 参注入；`isExactVersion`
  - Produces: `CommunityFetchOptions { namespace?; force?; signal?; routes?: { registryBase?; fileBases? } }`（**不含调用者 deadline——共享加载只认自身 30s hard cap；deadline race 在 waiter 层**）；`CommunityCatalogState { enabled; status; version; checkedAt; fetchedAt; route; count; errors; warnings }`；`fetchCommunityCatalog(cfg, opts)`
  - 预算公式（v8）：**共享加载只受 flight 自身 hard cap 约束：`flightDeadline = flightStartedAt + COMMUNITY_CHAIN_BUDGET_MS`——调用者的 deadlineAt/signal 不进入共享 loader（deadline race 在 waiter 层）**；探测单跳超时 `min(8s, flight 剩余)`；正文线路 `min(15s, flight 剩余)`；flight 到点 → abort 在途 + stale/unavailable 收场
  - 安全与缓存读取顺序：**meta 结构校验 → `isExactVersion(meta.version)` → join 后路径 containment 校验（仍位于 `<ns>/awesome/` 内）→ 才读正文**；meta.version 非法/路径越界/正文容器校验失败 → 视为无缓存并清理该损坏文件
  - 缓存语义：`meta.json`（**latest 专用**：version/checkedAt/fetchedAt/route）+ `meta-pin-<version>.json`（**pin 专用**）+ `catalog-<version>.json`——**pin 加载绝不更新 latest 指针**，A/B pin 并发各写各的 pin meta；TTL 只约束探测；版本一致不重拉正文；探测失败有缓存 → stale（显式状态，UI 必须标注）；force 跳过短路
  - **pin 隔离**：pin 非空时缓存命中必须 `meta.version === pin` 且优先读 `catalog-<pin>.json`——未 pin 的 latest meta 不得充当 pin 命中
  - **in-flight 合并**：合并 key = `namespace + 生效 pin/unpinned + 配置代（force 与否分池）`——**不含 deadline（deadline 是 waiter-scoped，不是 flight-scoped）**。并发加载合并为同一在途 Promise：**flight 自身 30s hard cap（flight-scoped，内部 AbortController）**；每个 waiter 用**自己的 deadline/signal** 与共享 Promise race（waiter-scoped）——3s 的 summary waiter 不缩短 flight，长 deadline 的 market waiter 也不被 3s flight 拖死；最后一个 waiter 离开才 abort 共享加载。并发冷 miss 只发一次 dist-tags 与正文请求，不同 pin/force 配置互不串版本
- 验证范围：`npm run build && node --test tests/community.test.mjs`
- [ ] Step 1: 失败测试：① ready 链路 + meta/body 落盘；② TTL 内二次调用 0 探测 0 正文（服务器计数）；③ dist-tags 新版本 → TTL 内用缓存、force 重拉；④ 线路 1 500 → 线路 2 npmmirror；⑤ 全失败有缓存 → stale（fetchedAt 保留）；⑥ 全失败无缓存 → unavailable + errors 含「怎么办」；⑦ dist-tags 返回 `../../etc` → 该线路失败、cacheDir 零变化；⑧ pin=`1.0.0` 跳过探测；pin 非法 → unavailable；⑨ 全线路挂起 → 总耗时 < 35s 且 abort 传播；⑩ **meta 篡改**（meta.version=`../../etc`）→ 视为无缓存且损坏文件被清理；⑪ checkedAt 非法 → 视为过期重新探测；⑫ TTL 过期 + dist-tags 同版本 → 仅更新 checkedAt、正文 0 拉取；⑬ **并发冷 miss**：同时启动两个加载 → dist-tags/正文各仅 1 次；⑭ 其中一个调用 abort → 另一个仍成功完成；⑮ latest 缓存 B → 改 pin=A → 命中/下载 A 而非 B；⑯ pin=A 与 pin=B 并发 → 各归各版本、meta 互不覆盖；⑰ pin 与 unpinned 并发、force 与非 force 并发 → 互不串版本；⑱ **pin→unpinned 回退**：pin=A 完成后取消 pin，未过 TTL 的 unpinned 请求不得把 A 当 latest（unpinned 的 checkedAt/version 独立存储）
- [ ] Step 2: Run — Expected: 新用例失败
- [ ] Step 3: 实现
- [ ] Step 4: Run — Expected: 通过
- [ ] Step 5: `git add src/core/community.ts tests/community.test.mjs && git commit -m "feat(0.5.0): community fetch chain + ttl + budget"`

### Task 4: `community-adapter.ts` 目录适配层

- Files: Create `src/core/community-adapter.ts`、`scripts/smoke-community-catalog.mjs`；Test `tests/community-adapter.test.mjs`
- 接口契约：Consumes Task 2 类型；Produces `CommunityEntry`、`adaptCommunityCatalog(catalog): { entries; warnings; skippedDirty; skippedSubpathNoNpm }`（规则：id=`owner--name` 合成/冲突加序号；npm 形状→npm，否则 url→github，皆否跳过；`/tree/` 或 name 含 `#` 且无 npm → 子包跳过；zh 回退 en 聚合 warning；>500 截断；category `/^[a-z0-9-]{1,32}$/`；tarball-only 按 github 收录）
- 验证范围：`npm run build && node --test tests/community-adapter.test.mjs`
- [ ] Step 1: 失败测试（入库 fixture：npm 映射、子包两态、同名异 owner、tarball-only、zh 回退/截断、非法 name）
- [ ] Step 2: Run — Expected: 失败
- [ ] Step 3: 实现
- [ ] Step 4: Run — Expected: 通过
- [ ] Step 5: opt-in 冒烟：`node scripts/smoke-community-catalog.mjs` — Expected: accepted ≈ 4,100+、subpath ≈ 188、零异常
- [ ] Step 6: `git add src/core/community-adapter.ts tests/community-adapter.test.mjs scripts/smoke-community-catalog.mjs && git commit -m "feat(0.5.0): community catalog adapter"`

### Task 5: `market.ts` 合并层、并发 deadline、GitHub 请求预算与安装类型收窄

- Files: Modify `src/core/registry.ts`（仅 RegistryConfig 两字段）、`src/core/market.ts`、`src/core/versions.ts`（GitHub 请求预算层）、`src/core/httpx.ts`（onRequest 钩子穿线，Task 1 已建钩子此处接线 reserve）、`src/client/installed-view.js`；Test `tests/market.test.mjs`、`tests/versions.test.mjs`、`tests/httpx.test.mjs`
- 接口契约
  - Consumes: Task 3/4 产物；`MarketDeps.githubLatestTag`
  - Produces:
    - `RegistryConfig` 两新字段；`InstallableEntry = Pick<RegistryEntry,'id'|'source'|'npm'|'github'>`；`installEntry(entry: InstallableEntry, …)`
    - `MarketQuery.category: string|null`（安全 slug）；`MarketQuery.primaryOnly?: boolean`；`MarketResult.community?: CommunityRegistrySummary`；`categoryCounts: Record<string, number>`；`MarketItem` 含 community 旁路字段
    - **`InstalledResult.community?: CommunityRegistrySummary`**（CLI outdated 双源判定的状态来源——v3 缺口）
    - **GitHub 请求预算（httpx + versions.ts）**：`httpx` fetch 原语增加可选 `onRequest(url)` 钩子——**每个物理 outbound 请求（含重定向每一跳）触发一次**，计数点落在 wire 层；versions.ts 提供 ① request-scoped 预算对象 `{ reserve(): 'ok'|'exhausted' }`（`listInstalledWithMeta` 每次检查创建一个、跨 repo 与 fallback 共享、经 `githubLatestTag` 新增末位可选 `budget` 参数下传）②宿主级滚动 1 小时 ≤50 计数器——**只对携带预算的被动探测生效**，用户主动 install/upgrade/registry 诊断不携带预算、不受此限（配额耗尽提示沿用 `githubRateLimitMessage`）；同仓库 in-flight single-flight，**key = 仓库 + 预算策略池**（passive-budgeted 与 active-unbudgeted 分池：主动调用不 join passive flight 故不受被动预算拒绝；passive 不 join active flight 故不绕过预算；内部 AbortController：leader/waiter 各自 signal 只取消各自等待，最后一个 waiter 离开才 abort 共享请求）。**记账规则（单一权威表述）**：flight 创建时只**绑定** leader 的预算对象（一次）；该对象的 `reserve()` 对**每次物理 outbound fetch（含重定向每一跳）各调用一次**——fallback 三请求各计一次；`exhausted` → 该跳不发 fetch、返回可识别的 `budget-exhausted` 错误；宿主滚动窗口对一条物理 wire 请求只计一次；joiner 不对同一 wire 请求重复调用（join 零 wire 成本——预算已耗尽的 waiter 可免费加入既有 flight，不产生新请求则不拒绝）
    - `listMarket`：主/社区并发启动；**社区 loader 不接收调用者 deadline**（只认自身 30s flight hard cap）——listMarket 作为 waiter 在外层 race 自己的绝对 deadlineAt/signal；到点只结束本 waiter 的等待（标 timeout/未完成），共享 flight 照常继续（其他 waiter 不受影响）
  - 行为：合并去重 npm 名→owner/repo→id、主恒优先（displaced 进 warnings）；排序主置顶+社区 downloads 降序；搜索附英文描述；浏览页探测=主清单条目+社区 npm 条目；主 unavailable + 社区有条目 → 出页不返空；两层皆不可用 → unavailable 空页契约；`listInstalledWithMeta` 合并匹配 + **单请求 ≤25 次 GitHub HTTP 请求封顶（预算层计数）**，超限条目标 `latestError`；`InstalledItem.community?: true`
- 验证范围：`npm run build && node --test tests/market.test.mjs && node --test tests/versions.test.mjs && npm run typecheck`
- [ ] Step 1: 失败测试：① 去重主优先+displaced；② 排序；③ primaryOnly 时社区 loader 零调用；④ 主 unavailable+社区 ready 出页；⑤ 社区 unavailable 主照常；⑥ 浏览页社区 github 零探测；⑦ query 匹配英文；⑧ categoryCounts 含社区键；⑨ InstallableEntry typecheck；⑩ 已装页合并匹配+community 标记；⑪ 端到端 deadline（双慢服务器 + abort 断言）；⑫ **预算**：跨多 repo 的第 26 个 wire 请求被拒（fallback 三请求逐次计数、重定向跳也计数）、滚动窗口 49/50/51 临界与过期、预算拒绝只产生 `latestError` 不影响其他条目、**用户主动 install 路径不带预算不被限**；⑫b single-flight 隔离：leader abort → waiter 正常完成；waiter abort → leader/共享请求继续；⑫c 无 budget 参数的调用零预算交互；⑫d **策略池分池**：同仓库 passive 与 active 并发 → 创建**两条独立 flight（互不 join）**：主动不被被动预算拒绝、passive 独立 reserve 计入 passive 单次预算与滚动窗口
- [ ] Step 2: Run — Expected: 失败
- [ ] Step 3: 实现（`MarketDeps` 增加可注入 `fetchCommunityCatalog`；预算层在 versions.ts 三个 GitHub fetch 调用点计数）
- [ ] Step 4: Run — Expected: 通过
- [ ] Step 5: `git add src/core/registry.ts src/core/market.ts src/core/versions.ts src/core/httpx.ts src/client/installed-view.js tests/market.test.mjs tests/versions.test.mjs tests/httpx.test.mjs && git commit -m "feat(0.5.0): merged market core + github request budget"`

### Task 6: 配置接线与 Host API——含 market 请求解析与 registry 响应社区 summary

- Files: Modify `src/host.ts`、`src/core/settings-compat.ts`、`src/core/registry-controller.ts`、`src/core/host-api.ts`；Test `tests/host-api.test.mjs`、`tests/settings-compat.test.mjs`、`tests/registry-controller.test.mjs`
- 接口契约
  - Produces:
    - `src/host.ts` `Config.communityCatalog`（volatile，默认 true）、`Config.communityCatalogPin`
    - `unwrapConfig` 透传；controller watch 同 URL 分支前同步社区字段；bootstrap 从 store 初始值同步（两代）
    - **host-api market 请求解析**：`category` 接受精选 5 + 安全 slug `/^[a-z0-9-]{1,32}$/`（非法 slug → 400），**透传 `primaryOnly` 布尔**；`market`/`registry` 响应含 `community`
    - **`registry` 分支社区 summary 数据源**：调用 `getCommunitySummary(primaryEntries, cfg, { force: body.force, signal, deadlineAt: now + 3_000 })`——**单一深接口**（community.ts 提供）：入参 `primaryEntries` **直接取本次 `snap.loaded.registry.plugins`**（displaced 与本次 registry 响应同代，不重复加载主清单；**接口内部禁止调用 `loadRegistry`**——单一来源约束，⑥b 为强制回归）；内部 fetch → adapt → merge 计数 → `CommunityRegistrySummary`。**3s 是本 waiter 的等待上限（waiter-scoped race）**，不是共享 flight 的上限——flight 按 30s hard cap 继续，后来的 market waiter 不受影响，完整字段口径 = `{ enabled, status, version, checkedAt, fetchedAt, route, acceptedCount, upstreamCount, displaced, skippedDirty, skippedSubpathNoNpm, errors, warnings }`（status=disabled/unavailable 时计数字段为 0/null，不伪造）；**summary deadline 3s**：到点未 materialize → `{ status:'unavailable', errors:['社区目录状态获取超时，可稍后刷新'] }`，**主清单响应按契约照常返回**；请求 signal 传入 loader（waiter 隔离见 Task 3 in-flight 合并）；并发冷 miss 由 in-flight 合并去重
- 验证范围：`npm run build && node --test tests/host-api.test.mjs && node --test tests/settings-compat.test.mjs && node --test tests/registry-controller.test.mjs && npm run typecheck`
- [ ] Step 1: 失败测试：① unwrapConfig 透传；② settings-compat 新契约；③ watch 同步；③b bootstrap 初始值（两代）；④ host-api market **请求**：已知社区 slug/未知 slug/非法 slug(400)/`primaryOnly:true` 逐一到 core 参数断言；⑤ `registry-config` 两键；⑥ `market` 与 `registry` 响应均含 community（registry 分支断言数据来自 cache-first loader——第二次调用零探测）；⑥b registry 响应的 `displaced` 与本次 snapshot 的主清单一致（主清单变更后 displaced 同步变化，不重拉主清单）
- [ ] Step 2: Run — Expected: 失败
- [ ] Step 3: 实现五处修改
- [ ] Step 4: Run — Expected: 通过
- [ ] Step 5: `git add src/host.ts src/core/settings-compat.ts src/core/registry-controller.ts src/core/host-api.ts tests/host-api.test.mjs tests/settings-compat.test.mjs tests/registry-controller.test.mjs && git commit -m "feat(0.5.0): community settings wiring + api request/response contract"`

### Task 7: `tools.ts` 与 `cli.ts`——开放分类、summary、CLI 分命令语义与 latestError 呈现

- Files: Modify `src/tools.ts`、`src/cli.ts`、`src/client/installed-view.js`；Test `tests/tools-summary.test.mjs`（新建，直测 `src/tools.ts` summary 纯函数——client-tool-view 只测客户端 payload，不承担服务端工具契约）、`tests/market.test.mjs`（CLI dispatch 契约所在，扩展）
- 接口契约
  - Produces:
    - `dshm_search`：开放 slug 分类 + `primary_only` 参数 + deadline 45s 且调 core 传 `deadlineMs: 44_000`+signal；summary `community: { acceptedCount, route, status, version }`
    - **`dshm_list`/`dshm_outdated` 工具 deadline 对齐（v4 缺口）**：两工具传 `ToolRunContext.signal` + `deadlineMs: 60_000`（= core installed deadline），工具 timeout 提至 65_000ms（core 60s + 5s 回包余量）——工具框架先超时而 core 仍打 GitHub、调用者拿不到 latestError 的缺口闭合。**deadline 贯穿整个 probe**：绝对 deadline/AbortSignal 贯穿 `githubLatestTag` 的 releases→tags→commits 多跳流程（每跳超时 = 剩余预算，**不逐子请求重置**）；deadline 到点时在途条目标 `timeout`、**未启动条目也标未完成并停止派发新 probe**（未完成数不漏计）
    - CLI 分命令语义：`search`/`outdated` 双源判定（依据分别为 `MarketResult.community` / **`InstalledResult.community`**）；`list` 保持本地清单契约（exit 0 + warning）；`dshm registry` 主清单诊断定位；`cliConfig()` 读 `DSHM_COMMUNITY_CATALOG === '0'`
    - **latestError 呈现（禁止「未完成检查」冒充「全部最新」）**：`latestError` 增加结构化 code——`budget-exhausted`/`rate-limited`/`timeout`/`network-error`（预算拒绝、GitHub 60/h 限流、超时、其他网络错误各自归类，不得一律归因预算）；`dshm_outdated` execute **投影增加 code 与未完成数字段**（现 tools.ts 只投影 pkg/name/version/latestVersion/latestTag/outdated）；`presentResult` 标题与 `renderOutdated` 正文都检查未完成数——存在时标题不写「全部最新」、正文列「N 项检查未完成」+ 按 code 的安全化原因；CLI outdated 同语义；GUI 已装视图为含 `latestError` 的行渲染「检查未完成」标注
- 验证范围：`npm run build && node --test tests/tools-summary.test.mjs && node --test tests/market.test.mjs && npm test`
- [ ] Step 1: 失败测试：① search 接受社区 slug/primary_only；② summary 四键（tools-summary.test.mjs 直测）；③ CLI search 双源 exit 语义；④ search 两层不可用 exit 1；⑤ list 本地契约回归；⑥ env 映射；⑦ deadline 传递注入断言；⑧ **outdated**：主 unavailable + `InstalledResult.community.status='ready'` → 正常输出 + warning；社区 stale → 「缓存快照」行；两层不可用 → exit 1；⑨ latestError **按 code 呈现**：`budget-exhausted`→「因 GitHub 预算未完成」、`rate-limited`→「GitHub 限流」、`timeout`/`network-error`→各自原因；存在任一 code 时 outdated/CLI 不输出「全部最新」并列出未完成项（含 dshm_outdated 投影/标题断言；预算与网络失败不静默省略检查状态）；⑩ installed-view 视图模型含 latestError 标注字段；⑪ **list/outdated 超时对齐**：注入慢 GitHub 服务器，工具在 65s 内返回且 core 侧请求随 signal abort（latestError 呈现，不悬挂）；⑪b **probe 级硬上限**：>8 个仓库 + 慢 fallback（三跳）场景，deadline 前仍在排队的条目被标未完成、无新 probe 派发、在途条目标 timeout；⑫e **双 waiter deadline 顺序（核心契约回归）**：同一慢社区服务器下，(A) `getCommunitySummary`（3s waiter）先建 flight → `listMarket`（长 deadline waiter）后加入 → **market 的社区加载正常完成**（flight 未被 3s 截断）；(B) `listMarket` 先建 flight → `getCommunitySummary` 3s 到点返回 unavailable summary → **market 照常完成**（summary 提前退出不 abort 共享 flight）
- [ ] Step 2: Run — Expected: 失败
- [ ] Step 3: 实现
- [ ] Step 4: Run — Expected: 通过
- [ ] Step 5: `git add src/tools.ts src/cli.ts src/client/installed-view.js tests/tools-summary.test.mjs tests/market.test.mjs && git commit -m "feat(0.5.0): tools & cli merged market semantics + latestError surfacing"`

### Task 8: client 纯状态 `market-state.js`

- Files: Modify `src/client/market-state.js`；Test `tests/client-market-state.test.mjs`
- 接口契约：Produces `normalizeMarketQuery`（primaryOnly + 安全 slug）、`normalizeMarketResponse`（community 缺省形状）、`splitCategories`（共享桶规则）、`marketNotice`（主 down+社区 up；**社区 stale → `notice.communityStale` 显式标注**；社区 unavailable 静默）、`sortMergedItems`
- 验证范围：`npm run build && node --test tests/client-market-state.test.mjs`
- [ ] Step 1: 失败测试（共享桶不重复、未知 id、primaryOnly、非法 slug、community 缺省、stale notice）
- [ ] Step 2: Run — Expected: 失败
- [ ] Step 3: 实现
- [ ] Step 4: Run — Expected: 通过
- [ ] Step 5: `git add src/client/market-state.js tests/client-market-state.test.mjs && git commit -m "feat(0.5.0): client market-state community helpers"`

### Task 9: client `main.jsx` 合并市场 UI

- Files: Modify `src/client/main.jsx`
- 接口契约：Consumes Task 8 产物、Task 6 `registry`（summary）与 `registry-config`（两配置键）、Task 5 `InstalledItem.community`
- 行为要点：筛选栏（精选组→只看主清单 chip→社区 20 chip→「社区·新分类」分组标题+逐 slug 可筛 chip）；**`fetchPage()` 请求体写入 `primaryOnly`（与 category/offset/limit 同级）**；截图消费端校验（HTTPS + github.com/*.githubusercontent.com + ≤8 张 + ≤2048 字符 + no-referrer + lazy）；详情折叠能力披露；已装卡徽标与「检查未完成」行标注；设置页 summary 数据源 = `registry` 响应；i18n 中英各 ~14 条
- 验证范围：`npm run build && npm test` + 人工验收
- [ ] Step 1: 当前状态检查：`fetchPage()` 仅发送 query/category/offset/limit
- [ ] Step 2: 实现全部
- [ ] Step 3: Run — Expected: 构建成功、测试通过
- [ ] Step 4: 人工验收（含社区 stale 提示、预算未完成检查的已装行标注）
- [ ] Step 5: `git add src/client/main.jsx && git commit -m "feat(0.5.0): merged market UI"`

### Task 10: README 双语更新

- Files: Modify `README.md`、`README.en.md`
- [ ] Step 1: 增补社区清单小节（CC0 署名、开关、pin、env、非安全审查警示、已装页预算 best-effort 说明）
- [ ] Step 2: Run: `git diff --stat` — Expected: 仅两 README
- [ ] Step 3: `git add README.md README.en.md && git commit -m "docs(0.5.0): community catalog readme"`

## 执行纪律

- 开始前复查计划；顺序 1→2→3→4→5→6→{7,8}→9→10（7/8 可并行）；不无声跳步。
- 每任务运行其验证；checkpoint 按显式清单 stage（不用 `git add -A`，提交前 `git status`）。
- 遇阻或与仓库现实不符立即停下说明。
- 在 `feat/community-catalog` 分支执行。

## 最终验证

- `npm run typecheck && npm test` — Expected: 全部通过
- `npm pack --dry-run --json` — Expected: 无社区缓存/fixture 泄漏
- `node scripts/smoke-community-catalog.mjs`（opt-in）— Expected: accepted ≈ 4,100+、零异常
- 本机人工验收（Task 9 Step 4）+ 真实网络 `community.status='ready'`

## 审阅 Checkpoint

- 计划正文结束后请求用户审阅；审阅通过前不进入实现。
