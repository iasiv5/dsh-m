# 探测透明度 + refresh + npm single-flight 实施计划

## 目标

把 [spec §7](../specs/2026-11-18-merge-dshm-status-tool-design.md) 的三项残留风险落成代码与文档（主人 2026-11-18 grill 第一轮七问全部按推荐批准）：

1. **D13（检查时刻透出）**：已装探测逐项盖 `probedAt`（缓存命中 = 缓存写入时刻，新探 = 完成时刻，未探测项缺席）；`renderList` 以最旧时刻聚合，按批准文案透出「检查结果截至 HH:MM」。
2. **D14（refresh 参数）**：`dshm_list` 新增 `refresh`（boolean，缺省 false），透传 core `force`；已装 `'full'` 路径开放 force（浏览页已有同款先例）；peek 纪律继承（重探成功覆盖缓存、失败保留旧值并如实标「检查未完成」）。
3. **D15（npm single-flight）**：`npmLatest` 增加 in-flight 合并——单一 Map、键 `生效registry|pkg`、flight 内部 AbortController、硬上限 30s、waiter 自带超时/signal、leader/waiter abort 互不连坐、全部离开才中止底层请求；npm 无预算记账故不分 passive/active 池（与 GitHub versions.ts 分池先例的差异写进 ADR-0040）。

**不在本计划范围**：GUI 卡片与 CLI 透出时间（Q2 批准只做 agent 文字）；GitHub 未收录安装的探测扩大；发版、CHANGELOG、宿主重启、热部署（留待发版轮）。

## 架构快照

- **D13 数据流**：`latest-cache` 新增带时间戳的读取函数（不动现有两个读取函数的签名，浏览页零影响）→ `probeLatest` 两个成功分支盖 `probedAt`（`InstalledItem` 新可选字段）→ tools execute 透传 → `renderList` 聚合最旧时刻拼进批准文案。任务顺序：Task 1（core）→ Task 2（tools 文字）。
- **D14 数据流**：`listInstalledWithMeta` 的 force 目前只在 `probeMode === 'only'` 生效（[market.ts:1099](../../src/core/market.ts#L1099)）；改为 `probeMode !== 'none'` 即透传，一行条件，浏览页先例在 [market.ts:766-767](../../src/core/market.ts#L766-L767)（ADR-0013 **缓存层** peek 纪律同源：force 时跳过缓存捷径、成功覆盖缓存条目、失败保留旧条目 + latestError，该纪律已在 probeLatest 内部实现，无需新代码；**item 展示层与浏览页不同**——浏览页 force 有 peek 旧值兜底展示（[market.ts:767](../../src/core/market.ts#L767)），已装页失败臂只标检查未完成、不展示旧值（既有差异，非本计划引入，评审 P6））→ tools 加参数与透传。Task 3（core）→ Task 4（tools）。
- **D15 数据流**：`packument.ts` 现有 `npmLatest` 主体改名 `npmLatestInner`（逻辑不变），公开函数变成 flight 包装：leader 建 flight（内部 AbortController + 30s timer），leader/waiter 都用「自身 timeoutMs + 自身 signal」race 共享 Promise；settle（成功/失败）清键并清 timer；refs 归零且未 settle → abort + 清键。与 ADR-0006 TTL 缓存是两层：flight 合并的是**并发未命中**，缓存合并的是**时间窗内重复**，互不替代。Task 5 独立。
- 文档收口 Task 6；全量门禁 Task 7。Task 5 与 Task 1–4 无依赖，可并行实现但 commit 分开。

## 全局约束

以下逐字继承自 [docs/CODING-STANDARDS.md](../CODING-STANDARDS.md) 与主人批准的决议，执行时不得放宽：

- **测试锚三物理事实**：`treeShaking: false`（禁「bundle 中 grep 不到」负向预言）；esbuild `charset=ascii`（中文文案锚走源结构锚）；源串锚禁含 `\n` 转义（多行语义用切片锚或单行计数锚）。
- **量化/计数一律出现次数语义**（`src.split(needle).length - 1`），禁 `grep -c` 行数语义（该条款针对**测试源锚计数**；文档前后态存在性判据豁免，用 `grep -q` 恒稳形态并显式注明，评审 P11②）。
- **退出码卫生**：所有验证命令 `set -o pipefail`，以原测试进程退出码判定；门禁用恒稳形态。
- **夹具镜像生产调用点**：只注入生产实际传入的字段，不注内层缺省对象。
- **测试导入约定**：`src/core/*.ts` 测试从 `lib/core/*.js` 引入，跑前 `node scripts/build.mjs`；`src/client/*.js` 测试直接引源码。
- **同机禁双全量并发**；环境既有失败 vs 回归用 `node scripts/test-baseline.mjs` 对照。
- **文案逐字定稿（Q3 批准，中文为最终基准）**：
  - 更新摘要行：`更新：可升级 X · 已最新 Y · 未检查 Z · 检查未完成 W · 检查结果截至 HH:MM`
  - 全部最新句：`全部 N 个插件已检查（截至 HH:MM），均已是最新版本。`
  - 无任何已检查项（含注册表不可用早退）→ 不出现「截至」段。
- **命名规则（Q1/Q4/Q5 批准）**：字段 `probedAt`（ms epoch）；参数 `refresh`（不用 `force`，避免与 dshm_install/dshm_upgrade 的兼容预检 force 撞义）；函数 `readLatestCacheStamped` / `LatestCacheHit` / `npmLatestInner`；常量 `NPM_FLIGHT_CAP_MS = 30_000`。
- **行为零变化承诺格**：浏览页探测、CLI 全部命令、已装 `'only'` 路径、既有 TTL 缓存语义——逐字节零变化。本次新行为 = ①已装 items 新增可选 `probedAt` 字段——**golden 处理**：golden 钉的是 core 层 `listInstalledWithMeta` 全量输出（[market-golden.test.mjs:147/157](../../tests/market-golden.test.mjs)，评审 P1 实证；此前「golden 不钉 dshm_list」的核实错层），Task 1 在 capture 管线 sanitize 剥除 probedAt（活时间戳不入基线，fixture 零重生成）；`listRowsOf` 对未知字段无感；②已装 `'full'` + force 新通路（无 force 时路径不变）；③npmLatest 并发语义（单调用结果与错误形态不变）。`renderList` 文案变化按上文批准文案执行。

## 输入工件

- 设计决议：[docs/specs/2026-11-18-merge-dshm-status-tool-design.md](../specs/2026-11-18-merge-dshm-status-tool-design.md)（§7 三项 + grill 第一轮七问推荐答案，主人 2026-11-18 批准）
- 前序：[docs/adr/0039-merge-agent-status-tool.md](../adr/0039-merge-agent-status-tool.md)（本计划在 `feat/merge-dshm-status-tool` 分支续作）
- 分支：`feat/merge-dshm-status-tool`（当前 HEAD `d585c15`）

## 文件结构与职责

- Create: `docs/adr/0040-npm-latest-single-flight.md` — D15 决策记录（背景/决定/替代方案/后果）。
- Modify: `src/core/latest-cache.ts` — 新增 `LatestCacheHit` 接口与 `readLatestCacheStamped(key, ttlMin)`（镜像 `readLatestCache` 的过期删除语义，返回 `{ value, at }`）。
- Modify: `src/core/market.ts` — ① `InstalledItem`（:247 附近接口）加 `probedAt?: number`；② `probeLatest` 缓存命中臂改用 stamped 读取并盖戳、新探成功臂盖 `Date.now()`；③ `listInstalledWithMeta` 探测段 force 条件（锚：`probeMode === 'only' ? opts.force === true : false`，全文唯一）改为 `probeMode === 'none' ? false : opts.force === true`。
- Modify: `src/tools.ts` — `dshm_list`：参数 `refresh`、execute 传 `force: args.refresh === true` 与 items 透传 `probedAt: it.probedAt ?? null`、描述追加 refresh 提示句；`renderList`：新增 `formatProbeHHMM(ms)` 与 `listCheckedAtOf(items)` 两个纯 helper 并按批准文案拼接。
- Modify: `src/core/packument.ts` — flight 层（`NpmFlight` 接口、`npmFlights` Map、`NPM_FLIGHT_CAP_MS`）+ `npmLatest` 包装 + 私有 `npmLatestInner`（现主体改名，逻辑不变）。
- Modify: `tests/market-golden.test.mjs` — `capture()` 管线 sanitize：剥除 `probedAt` 键（D13 豁免：活时间戳不入 golden 基线；fixture `market-golden.json` 零重生成，评审 P1）。
- Modify: `docs/specs/2026-11-18-merge-dshm-status-tool-design.md` — §2 追加 D13/D14/D15 决议行；§3 数据契约补 `probedAt` 与 `refresh`；§4 文字契约按批准文案更新；§7 移除已解决三项、保留其余缺口。
- Test: `tests/market.test.mjs` — Task 1 三例（probedAt 盖戳）、Task 3 一例（`'full'`+force）。
- Test: `tests/tools-list-status.test.mjs` — Task 2 五例（截至段文案）、Task 4 三例（refresh 参数）；夹具 `loadTools` 改为记录 `listInstalledWithMeta` 收到的 opts。
- Test: `tests/packument.test.mjs` — Task 5 新 describe（flight 并发语义八例）。

## 任务清单

### Task 1: core D13 — 已装探测逐项 probedAt 盖戳

- 目标：`probeLatest` 对每个成功取得线上结论的项盖 `probedAt`；缓存命中继承缓存写入时刻，新探取完成时刻；未探测/失败/跳过项不盖。
- 涉及文件：`src/core/latest-cache.ts`、`src/core/market.ts`、`tests/market.test.mjs`、`tests/market-golden.test.mjs`
- 接口契约：
  - Consumes: `readLatestCache`（[latest-cache.ts:44](../../src/core/latest-cache.ts#L44) 过期删除语义）；`probeLatest` 缓存命中臂（锚 `const cached = ctx.force === true ? null : readLatestCache(cacheKey, ctx.ttlMin)`，[market.ts:1146](../../src/core/market.ts#L1146)）与新探成功臂（锚 `if (value) {` … `writeLatestCache(cacheKey, value)`，[market.ts:1167-1170](../../src/core/market.ts#L1167-L1170)）。
  - Produces: `readLatestCacheStamped(key: string, ttlMin: number): LatestCacheHit | null`（`LatestCacheHit = { value: LatestValue; at: number }`）；`InstalledItem.probedAt?: number`。Task 2 消费两者。
- 验证范围：`node --test --test-name-pattern "probedAt" tests/market.test.mjs` 全绿；`node --test tests/market.test.mjs` 全绿（用例计数当轮取数，执行前先跑基线计数）；`node --test tests/market-golden.test.mjs` 全绿（sanitize 后 fixture 零重生成）。

- [ ] Step 1: 写失败测试（`tests/market.test.mjs`，复用 `fakeDeps` 夹具，在「两段加载 / 已装探测」describe 内追加）
  - ① 新探盖戳：单 npm 包 fakeDeps，调用前记 `t0 = Date.now()`，`listInstalledWithMeta(cfg, {}, deps)` 后断言 `typeof res.items[0].probedAt === 'number'` 且 `probedAt >= t0`。
  - ② 缓存命中继承写入时刻：第一次调用记 `probedAt1`，TTL 内第二次调用断言 `res.items[0].probedAt === probedAt1`。
  - ③ 未探测项无戳：link 项（不在 issue #76 白名单）→ `res.items.find(x => x.source === 'link').probedAt === undefined`；registry `unavailableLoaded()` 早退臂 → 全部 items 无 `probedAt` 键。
  - 测试名统一含 `probedAt` 子串（供 name-pattern 定向）。
- [ ] Step 2: 运行并确认失败
  - Run: `set -o pipefail; node scripts/build.mjs && node --test --test-name-pattern "probedAt" tests/market.test.mjs`
  - Expected: ①② 红驱动（`probedAt` 为 undefined）；③ 为负向锚（现状字段缺席即绿，实现后仍须绿，防回归）。既有用例不受影响。
- [ ] Step 3: 写最小实现
  - `latest-cache.ts`：`export interface LatestCacheHit { value: LatestValue; at: number }`；`readLatestCacheStamped` 逐行镜像 `readLatestCache`，命中返回 `{ value: entry.value, at: entry.at }`（同一过期删除分支）。
  - `market.ts`：`InstalledItem` 加 `/** 探测时刻（ms epoch）：缓存命中=写入时刻，新探=完成时刻；未探测项缺席 */ probedAt?: number`；命中臂 `const hit = ctx.force === true ? null : readLatestCacheStamped(cacheKey, ctx.ttlMin)`，`if (hit) { applyProbe(item, hit.value); item.probedAt = hit.at }`（注意原 `else if (rt.remaining() > 0)` 结构保持——命中臂改为 `if (hit) … else if …`）；新探成功臂 `writeLatestCache(cacheKey, value)` 之后加 `item.probedAt = Date.now()`。
  - 浏览页（`listMarket` 探测段，[market.ts:755-800](../../src/core/market.ts#L755-L800)）**不触碰**。
  - `tests/market-golden.test.mjs`：`capture()` 管线加 sanitize——deep walk 剥除 `probedAt` 键，附 D13 豁免注释「活时间戳不入 golden 基线」（镜像该文件 ：127「禁活数字烙入基线」纪律，评审 P1）；`installed-full` 捕获自此与 fixture 继续逐字节等价，fixture 零改动。
- [ ] Step 4: 运行并确认通过
  - Run: `set -o pipefail; node --test --test-name-pattern "probedAt" tests/market.test.mjs && node --test tests/market.test.mjs && node --test tests/market-golden.test.mjs`
  - Expected: 定向用例绿（①② 新语义、③ 仍绿）；market 全绿；golden 全绿。
- [ ] Step 5: checkpoint commit
  - `feat(probe): 已装探测逐项 probedAt 盖戳（缓存命中继承写入时刻，spec D13）`

### Task 2: tools D13 — renderList 截至段与 items 透传

- 目标：`renderList` 按批准文案聚合最旧检查时刻；`dshm_list` execute 输出携带 `probedAt`。
- 涉及文件：`src/tools.ts`、`tests/tools-list-status.test.mjs`
- 接口契约：
  - Consumes: Task 1 的 `InstalledItem.probedAt`；`renderList` 两个锚——更新摘要行的 `更新：可升级 ${upgradable.length}` 开头串与全部最新句的 `全部 ${items.length} 个插件已检查，均已是最新版本。` 全串（均在 `src/tools.ts` 的 `renderList` 函数体内）；现有 `listOf` 测试夹具。
  - Produces: `formatProbeHHMM(ms: number): string`（本地时区 `HH:MM`，`padStart(2,'0')`）；`listCheckedAtOf(items): number | null`（items 中最小非空 `probedAt`，无则 null）。Task 6 文档引用文案。
- 验证范围：`node --test tests/tools-list-status.test.mjs` 全绿；`node --test tests/market.test.mjs` 全绿（host-namespace/summary 用例消费 execute 输出）。

- [ ] Step 1: 写失败测试（`tests/tools-list-status.test.mjs` 新 describe「检查时刻透出（spec D13）」，用例名含 `截至`）
  - ① 更新行：items 带 `probedAt`（两个不同定值），断言更新摘要行含 ` · 检查结果截至 ${hhmm}`，`hhmm` 由测试内独立 padStart 逻辑从最小定值算出（不 import 实现的 helper）。
  - ② 全部最新句：全部项 `latestVersion` 相同且带 `probedAt` → 文本含 `全部 2 个插件已检查（截至 ${hhmm}），均已是最新版本。`。
  - ③ 无戳不显示：items 全部无 `probedAt`（注册表可用、有 `latestVersion`）→ 文本不含 `截至`。
  - ④ 注册表不可用 → 文本不含 `截至`。
  - ⑤ execute 透传：夹具 item 带 `probedAt: 1_700_000_000_000` → `out.items[0].probedAt === 1_700_000_000_000`；无戳夹具 → `out.items[0].probedAt === null`。
- [ ] Step 2: 运行并确认失败
  - Run: `set -o pipefail; node scripts/build.mjs && node --test --test-name-pattern "截至" tests/tools-list-status.test.mjs`
  - Expected: ①②⑤ 红驱动（无 `截至` 段 / probedAt 未透传）；③④ 为负向锚（现状文本无「截至」即绿，实现后仍须绿）。
- [ ] Step 3: 写最小实现
  - `ListOut`（[tools.ts:565](../../src/tools.ts#L565)）items 元素补 `probedAt?: number | null`——缺声明则 renderList 读 `it.probedAt` 时 typecheck 报属性不存在，红点会拖到 Task 7 才爆（评审 P2）。
  - `tools.ts`：`formatProbeHHMM` 与 `listCheckedAtOf` 两个模块级纯函数；`renderList` 中先算一次 `oldest = listCheckedAtOf(items)` 与 `stampSeg`（oldest 非空时为 ` · 检查结果截至 ${formatProbeHHMM(oldest)}`，否则空串），更新摘要行追加 `stampSeg`；全部最新句改为 `全部 ${items.length} 个插件已检查${parenSeg}，均已是最新版本。`（`parenSeg` = oldest 非空时 `（截至 ${formatProbeHHMM(oldest)}）`，否则空串——全部已检查则必有戳，两形态由用例 ①② 分别覆盖）；execute items map 加 `probedAt: it.probedAt ?? null`（插在 `latestErrorCode` 之后）。
- [ ] Step 4: 运行并确认通过
  - Run: `set -o pipefail; node --test tests/tools-list-status.test.mjs && node --test tests/market.test.mjs`
  - Expected: 全绿（tools-list-status 现有 19 例 + 新增 5 例，总数当轮取数为准）。
- [ ] Step 5: checkpoint commit
  - `feat(tools): renderList 检查结果截至段 + items 透传 probedAt（spec D13）`

### Task 3: core D14 — 已装 'full' 路径开放 force

- 目标：`listInstalledWithMeta` 在 `probeMode !== 'none'` 时透传 `opts.force`，已装 `'full'` 路径获得与浏览页（ADR-0013）**缓存层同源**的 peek 纪律全量重探（不删旧条目）；item 展示层与浏览页不同——失败如实标「检查未完成」、不展示旧值（既有差异，非本计划引入，评审 P6 措辞精确化）。
- 涉及文件：`src/core/market.ts`、`tests/market.test.mjs`
- 接口契约：
  - Consumes: `listInstalledWithMeta` opts 的 `force?: boolean`（既有字段，installedUpdates 路径在用）；`probeLatest` 的 force 分支（`ctx.force === true ? null : readLatestCacheStamped(...)`，Task 1 改后形态）。
  - Produces: 已装 `'full'` + force 通路。Task 4 消费。
- 验证范围：`node --test --test-name-pattern "full.*force|force.*full" tests/market.test.mjs` 定向绿；全套件绿；既有 `'only' + force` 用例（[market.test.mjs:672-691](../../tests/market.test.mjs)）不回归。

- [ ] Step 1: 写失败测试（`tests/market.test.mjs`，紧邻既有 `'only' + force` 用例之后）
  - 用例名：`"probeMode 'full' + force：全量重探，失败保留旧缓存条目（镜像 'only' 用例，spec D14）"`（名称含 `full` 与 `force`）。
  - 夹具镜像 [market.test.mjs:672-691](../../tests/market.test.mjs)：先 `listInstalledWithMeta(cfg, {}, deps)` 暖缓存（`calls.npm.length === 1`）；`failDeps` 的 `npmLatest` 抛错；`listInstalledWithMeta(cfg, { force: true }, failDeps)` 断言 `calls.npm.length === 2` 且 `res.items[0].latestError` 真值；再无 force 调用断言 `calls.npm.length === 2`（走旧缓存零新增）且 `latestVersion === '2.0.0'`。
- [ ] Step 2: 运行并确认失败
  - Run: `set -o pipefail; node scripts/build.mjs && node --test --test-name-pattern "force" tests/market.test.mjs`
  - Expected: 新例红（`'full'` + force 时 `calls.npm.length` 不增长——现状 force 被丢弃）。
- [ ] Step 3: 写最小实现
  - `market.ts` 探测段调用锚（[market.ts:1099](../../src/core/market.ts#L1099)）：`force: opts.probeMode === 'only' ? opts.force === true : false` → `force: opts.probeMode === 'none' ? false : opts.force === true`。
- [ ] Step 4: 运行并确认通过
  - Run: `set -o pipefail; node --test --test-name-pattern "force" tests/market.test.mjs && node --test tests/market.test.mjs`
  - Expected: 新例与既有 `'only' + force` 用例全绿；全套件绿。
- [ ] Step 5: checkpoint commit
  - `feat(core): 已装列表 probeMode full 支持 force（ADR-0013 peek 纪律同源，spec D14）`

### Task 4: tools D14 — dshm_list 新增 refresh 参数

- 目标：agent 以 `refresh: true` 触发绕过缓存的全量重探；描述写明预算代价与失败语义。
- 涉及文件：`src/tools.ts`、`tests/tools-list-status.test.mjs`
- 接口契约：
  - Consumes: Task 3 的 `'full'` + force 通路；`defineTool` parameters 规范化形态（断言打 `parameters.properties.<字段>`，[dsh-m AGENTS.md] 纪律）。
  - Produces: `dshm_list` 公开参数 `refresh: boolean`（缺省 false；execute 内 `force: args.refresh === true`）。无后续消费者（工具面即终点）。
- 验证范围：`node --test tests/tools-list-status.test.mjs` 全绿；`node --test tests/market.test.mjs` 全绿。

- [ ] Step 1: 写失败测试（`tests/tools-list-status.test.mjs`）
  - 夹具改造（本任务前置步）：`loadTools` 的 `listInstalledWithMeta` stub 从 `async () => ({…})` 改为 `async (_c, opts) => { capturedOpts.push(opts); return {…} }`，返回值新增 `capturedOpts` 供用例断言（镜像生产调用点：opts 由工具层传入）。
  - ① 参数存在：`list.parameters.properties.refresh?.type === 'boolean'` 且不在 `required`。
  - ② 透传：`list.execute({ refresh: true })` → `capturedOpts.at(-1).force === true`；`list.execute({})` → `capturedOpts.at(-1).force === false`（正向断言——`!== true` 形态在现状 undefined 下永真、红步失效，评审 P8）。
  - ③ 描述提示：`list.description.includes('refresh:true')` 且 `.includes('TTL cache')`。
  - 用例名含 `refresh`。
- [ ] Step 2: 运行并确认失败
  - Run: `set -o pipefail; node scripts/build.mjs && node --test --test-name-pattern "refresh" tests/tools-list-status.test.mjs`
  - Expected: 三例红（无 refresh 参数 / force 未透传 / 描述无提示句）。
- [ ] Step 3: 写最小实现
  - `tools.ts` `dshm_list`：parameters 加 `refresh: { type: 'boolean', description: '绕过 TTL 缓存全量重探（npm / GitHub）。重探失败保留旧值并如实标注检查未完成；GitHub 源消耗被动预算（25/req、50/h 滚动）。用户要求「重新检查」时使用。' }`；execute 的 `listInstalledWithMeta` 调用加 `force: args.refresh === true`（`args` 现形参为 `_args`，改回 `args`）；description 追加 ` Pass refresh:true only when the user asks to re-check (bypasses the TTL cache).`
- [ ] Step 4: 运行并确认通过
  - Run: `set -o pipefail; node --test tests/tools-list-status.test.mjs && node --test tests/market.test.mjs`
  - Expected: 全绿（22 例为 19+3 的推算值，总数当轮取数为准）。
- [ ] Step 5: checkpoint commit
  - `feat(tools): dshm_list 新增 refresh 参数透传 core force（spec D14）`

### Task 5: core D15 — npmLatest in-flight 合并

- 目标：同进程内并发的同 (registry, pkg) `/latest` 请求合并为一次 wire 请求；waiter 超时/signal 与 leader 互不连坐；flight 30s 硬上限。
- 涉及文件：`src/core/packument.ts`、`tests/packument.test.mjs`
- 接口契约：
  - Consumes: `npmLatest` 现主体（[packument.ts:386-418](../../src/core/packument.ts#L386-L418)，双腿阶梯 + `deps.fetchJsonLimited` 注入缝）；`tests/packument.test.mjs` 的 `stubWire` 夹具与 deferred 时序手法（既有 single-flight describe，[packument.test.mjs:127-140](../../tests/packument.test.mjs)）。
  - Produces: 私有 `npmLatestInner(pkg, timeoutMs, signal?, registry?, deps?)`（现主体改名）；模块级 `npmFlights: Map<string, NpmFlight>` 与 `NPM_FLIGHT_CAP_MS = 30_000`。公开 `npmLatest` 签名与单调用行为不变（Task 6 ADR 记录并发语义）。
- 验证范围：`node --test tests/packument.test.mjs` 全绿；`node --test tests/market.test.mjs` 全绿（探测路径回归）；`node scripts/test-baseline.mjs` 不需要（无环境失败牵涉）。

- [ ] Step 0: 实现前探针（只读，判断 cap 用例的 mock 手法）
  - Run: `grep -n "setTimeout\|AbortSignal.timeout" src/core/httpx.ts src/core/packument.ts`
  - 判据（评审 P12 改写）：确认超时实现形态不影响 ⑦ 的 mock 接管面——⑦ 的 reject 由 flight cap timer 承载（JS `setTimeout`，被 `mock.timers` 接管），与 wire 超时实现（JS `setTimeout` 或原生 `AbortSignal.timeout`）无关；两种形态下 ⑦ 的验证命令与「message 含『30s 硬上限』」预期均不变。探针输出落 scratch log 归档，不改变测试写法。
- [ ] Step 1: 写失败测试（`tests/packument.test.mjs` 新 describe「npmLatest in-flight 合并（ADR-0040）」，全部用 deferred 控制时序，不用真实 sleep；**全部新用例挂 per-test 守卫 `{ timeout: 8_000 }`**——红相下任何挂死形态都表现为该例失败而非套件挂死，评审 P3）
  - 红绿矩阵（评审 P9 措辞纪律）：**红驱动 = ①⑥⑦**（现状必红，红步以其为失败信号）；**负向边界锚 = ②③④⑤⑧**（现状即绿，flight 化后钉住不回归，红步不以其判红）。
  - ① 合并（红驱动）：同 pkg 两次 `npmLatest(p)` 并发（deferred 未 resolve 前发起第二笔）→ resolve 后 `calls.npmjs === 1`，两调用同值。现状两根 wire → 红。
  - ② 不同 pkg（边界锚）：→ `calls.npmjs === 2`（不同键不合并）。
  - ③ 显式不同 registry（边界锚）：`npmLatest(p, 1000, undefined, NPMJS)` vs `npmLatest(p, 1000, undefined, MIRROR)` → 2 次（flight 键含 registry）。
  - ④ leader abort 不连坐（边界锚）：leader 发起（deferred 挂起）→ waiter join → abort leader 的 signal → leader reject；resolve deferred → waiter 成功返回同值，且 wire 未被中止（deferred 观测无 abort）。
  - ⑤ waiter abort 不连坐（边界锚）：同上反向——abort waiter 的 signal → waiter reject；resolve → leader 成功。
  - ⑥ 全部离开即中止（红驱动）：**自定义 opts-aware stub**——既有 `stubWire` 的 route fn 只收 url（[packument.test.mjs:52](../../tests/packument.test.mjs#L52)，评审 P7），⑥ 需 fn(url, opts) 形态、deferred 在 `opts.signal` abort 时置位 aborted 并 resolve；同 pkg 两调用并发后先后 abort 各自 signal → 断言 `calls.npmjs === 1` 且 `aborted === true`（现状两根 wire → 计数断言红；flight 化后共享 wire 只在全离开时被中止）。
  - ⑦ cap 30s（红驱动）：**stub 永挂且不感知 signal（故意隔离 cap 通道）**；`npmLatest(p, 60_000, ...)`（timeoutMs > cap，排除 leader 自身超时混淆）+ `mock.timers` 快进 31s → 断言 reject 且 **message 含「30s 硬上限」**（由 raceWaiter 的 ctrl-signal 臂产生，canonical message 确定性；现状无 flight，快进无接管点，该例在 8s per-test 守卫处失败——红信号成立且不挂死套件，评审 P3）。
  - ⑧ settle 清键（边界锚）：第一轮完成后，同 pkg 再调一次 → `calls.npmjs` 再 +1（flight 已清，重新 wire）。
  - 用例名统一含 `flight`。
- [ ] Step 2: 运行并确认失败
  - Run: `set -o pipefail; node scripts/build.mjs && node --test --test-name-pattern "flight" tests/packument.test.mjs`
  - Expected: 红驱动 ①⑥⑦ 红（⑦ 现状在 8s per-test 守卫处失败，不挂死套件）；②③④⑤⑧ 现状即绿（负向边界锚，实现后仍须绿——Step 4 以其全绿为收口）。既有 single-flight 用例（[packument.test.mjs:128](../../tests/packument.test.mjs#L128)，名含 flight 子串）会被 `--test-name-pattern "flight"` 一并选中，现状绿、属预期，不作为红信号（评审 P10）。
- [ ] Step 3: 写最小实现（`packument.ts`）
  - 现 `npmLatest` 主体整体改名 `npmLatestInner`（私有，签名与逻辑逐字节不变）。
  - 新增：`interface NpmFlight { promise: Promise<NpmLatest>; refs: number; ctrl: AbortController; timer: ReturnType<typeof setTimeout> }`；`const npmFlights = new Map<string, NpmFlight>()`；`const NPM_FLIGHT_CAP_MS = 30_000`。
  - 公开 `npmLatest(pkg, timeoutMs = 20_000, signal?, registry?, deps?)`：
    - `const key = `${registry?.trim() || 'implicit'}|${pkg}``
    - 命中 flight → waiter 分支：`flight.refs += 1`；`try { return await raceWaiter(flight.promise, timeoutMs, signal, flight.ctrl.signal) } finally { flight.refs -= 1; if (flight.refs === 0 && npmFlights.get(key) === flight) { npmFlights.delete(key); flight.ctrl.abort(new Error('npmLatest flight：全部等待方已离开')); clearTimeout(flight.timer) } }`
    - 未命中 → leader 分支：建 `ctrl`（内部 signal）与 `timer = setTimeout(() => ctrl.abort(new Error('npmLatest flight 30s 硬上限')), NPM_FLIGHT_CAP_MS)`；`const promise = npmLatestInner(pkg, timeoutMs, ctrl.signal, registry, deps)`；promise 上挂 settle 清理（`.finally(() => { if (npmFlights.get(key) === flight) { npmFlights.delete(key); clearTimeout(flight.timer) } })`——先构造 flight 对象再赋 promise，避免自引用）；写 Map；`flight.refs = 1`；`return raceWaiter(promise, timeoutMs, signal, flight.ctrl.signal)`（leader 与 waiter 同构：自身超时/signal 只裁自己的等待，ctrl 臂承载 flight 级拒绝）。
    - `raceWaiter(p, timeoutMs, signal, ctrlSignal?)`：`Promise.race([p, 超时 reject 定时器（真实 setTimeout，用后清理）, signal abort reject, ctrlSignal abort reject])`；自身 abort reject 用 `signal.reason ?? new Error('npmLatest 被中止')`；**ctrlSignal 臂 reject 用 `ctrlSignal.reason` 承载 canonical message**（cap = `npmLatest flight 30s 硬上限`、全离开 = `npmLatest flight：全部等待方已离开`）——cap 不借 wire 生效，wire 失灵时仍可观测（评审 P3）；leader 与 waiter 均传 `flight.ctrl.signal`。
  - 错误形态：单调用下 wire 错误逐字上抛（inner 原样）；cap/全离开 abort 的 message 见上；waiter 自身超时 message `npmLatest 超时`。
  - 不触碰 packument 访问器缓存层与 `npm-route`。
- [ ] Step 4: 运行并确认通过
  - Run: `set -o pipefail; node --test tests/packument.test.mjs && node --test tests/market.test.mjs && npm run typecheck`
  - Expected: packument 全绿（新增 8 例，总数当轮取数）；market 全绿；typecheck 零错误。
- [ ] Step 5: checkpoint commit
  - `feat(npm): npmLatest in-flight 合并（ADR-0040：waiter-scoped 超时/signal + 30s flight cap，spec D15）`

### Task 6: 文档 — ADR-0040 与 spec 同步

- 目标：决策与契约落盘；spec §7 与实现状态一致。
- 涉及文件：`docs/adr/0040-npm-latest-single-flight.md`（Create）、`docs/specs/2026-11-18-merge-dshm-status-tool-design.md`（Modify）
- 接口契约：
  - Consumes: Task 1–5 的最终命名（`probedAt` / `refresh` / `npmLatestInner` / `NPM_FLIGHT_CAP_MS`）与批准文案（Q3）。
  - Produces: 无代码消费者；Task 7 报告引用。
- 验证范围（非 TDD 文档任务，前后态用 grep 断言）：
  - Run: `set -o pipefail; grep -c "D13\|D14\|D15" docs/specs/2026-11-18-merge-dshm-status-tool-design.md && grep -c "NPM_FLIGHT_CAP_MS\|npmLatestInner" docs/adr/0040-npm-latest-single-flight.md && ! grep -q "并发探测会重复请求 npm" docs/specs/2026-11-18-merge-dshm-status-tool-design.md && ! grep -q "措辞会高估新鲜度" docs/specs/2026-11-18-merge-dshm-status-tool-design.md`（needle 换 spec §7 现行原文特征串，评审 P11①；基线实测：「并行调用时 npm」在 spec 零命中（旧 needle 永真）、两条新 needle 各命中 1）
  - Expected: 前两段计数 > 0；后两段负向断言**开工前跑应红**（基线 needle 命中，自证判据有牙齿，评审 P11）、Step 4 完成后全绿——旧 §7 的并发缺口与措辞高估两条表述均已移除。

- [ ] Step 1: 写 ADR-0040（段落：背景——同进程 6 个 `npmLatest` 调用点在缓存未命中窗口并发重复请求 npm `/latest`，agent `dshm_list` 与 GUI 已装页第二段探测重叠时全部包各请求一遍（当前 18 包）；决定——单一 Map、键构造按实际书写：显式 registry 原样 `| pkg`，隐式调用以 `implicit` 字面入键（生效腿由 inner 两腿阶梯决策，避免 waiter join 前先做异步 registry 解析，评审 P5）、flight 内部 AbortController + 30s cap、waiter-scoped 超时/signal + ctrl-signal 臂、全部离开才中止、不分 passive/active 池（理由：npmLatest 无预算记账，与 GitHub versions.ts 分池先例的差异点）；替代方案——TTL 缩短（增请求量与 GitHub 被动预算，否决）、全响应缓存（与 ADR-0006 内存 TTL 层重复，否决）；后果——doctor/版本角标等主动调用会 join 进行中的被动探测（结果一致、等待可能变长）；waiter 预算大于 leader 时以 leader 的 wire 超时为准（有界，错误如实上抛）；CLI 独立进程不受影响；mutation 定向失效与 ADR-0006 TTL 层不变）
- [ ] Step 2: spec 同步（§2 表追加 D13/D14/D15 行，注明「主人 2026-11-18 grill 第一轮按推荐批准」；§3 数据契约 items 补 `probedAt` 行、工具参数补 `refresh`；§4 两处文案替换为批准文本；§7 改写——移除三条：「并行调用时 npm `/latest` 没有 single-flight」「agent 无法强制刷新」「**『已检查』措辞会高估新鲜度**」（D13 落地解决，评审 P4），保留「GitHub 未收录不探测」「最新版缓存滞后（现在可用 refresh 主动穿透，缺省 TTL 窗口内仍可能滞后）」「CLI github 目标版本」三条）
- [ ] Step 3: GLOSSARY 复核（Q7 收尾物）：核对「更新状态 / 未检查 / 检查未完成」词条与 D13/D14 新文案无冲突；若实现中出现值得入册的新领域词（如「检查时刻」）则补词条，判定无新术语时在 commit message 写明「GLOSSARY 无新增术语」。
- [ ] Step 4: 运行验证命令（见验证范围）并 commit
  - `docs: ADR-0040 npmLatest single-flight + spec D13-D15 决议与缺口同步`

### Task 7: 收口验证与最终报告

- 目标：全部门禁绿；改动可归因；产出执行摘要。
- 涉及文件：无新改动（仅验证与可能的零散修正）。
- 接口契约：
  - Consumes: Task 1–6 全部产物。
  - Produces: 最终验证结论 + 执行摘要（供实现评审与主人）。

- [ ] Step 1: 构建与类型
  - Run: `set -o pipefail; node scripts/build.mjs && npm run typecheck`
  - Expected: build ok；typecheck 零错误。
- [ ] Step 2: 定向套件
  - Run: `set -o pipefail; node --test tests/market.test.mjs tests/tools-list-status.test.mjs tests/packument.test.mjs tests/client-tool-view-list.test.mjs tests/market-golden.test.mjs`
  - Expected: 全绿；用例计数当轮记录（增量预期：market +4、tools-list-status +8、packument +8，执行时以实跑为准）。
- [ ] Step 3: 全量门禁（后台）
  - Run: `set -o pipefail; npm test`（run_in_background，退出码落文件，完成前不判定）
  - Expected: 退出码 0。若出现环境既有失败：跑 `node scripts/test-baseline.mjs` 对照，基线内失败不判回归、基线外失败必须修复或停下说明。
- [ ] Step 4: diff 归因检查
  - Run: `set -o pipefail; git status --short && git diff --stat`
  - Expected: 仅计划内 10 个文件（9 改 1 建，含 `tests/market-golden.test.mjs`；Task 6 Step 3 若补 GLOSSARY 词条则如实计入）有改动，逐文件可归因；无 lib/、无 node_modules。
- [ ] Step 5: 执行摘要
  - 内容：任务完成清单（各 Task 的验证命令与结果）、测试计数（当轮）、行为零变化承诺核验结论、遗留事项（发版/CHANGELOG/宿主重启待批）。修正性改动（若有）单独 commit 并在摘要中列出。

## 执行纪律

- 开始实现前先批判性复查本计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动工。
- 按任务顺序执行（Task 5 可与 1–4 并行，commit 分开）；不无声跳步、合并步或改目标；每任务完成即跑该任务验证。
- 遇阻、重复失败或计划与仓库现实不符（锚计数、夹具形态、Task 5 Step 0 探针发现的 mock 接管面与本判据不符）立即停下说明，不猜。
- 全程在 `feat/merge-dshm-status-tool`；不切 main、不发版、不重启宿主、不热部署。
- 所有验证命令 `set -o pipefail`，以原进程退出码判定；过滤输出不吞退出码。

## 最终验证

- `node scripts/build.mjs && npm run typecheck`：零错误。
- 定向五套件（Task 7 Step 2 命令）：全绿。
- 全量 `npm test`：退出码 0（环境既有失败按基线对照规则处理）。
- `git status --short`：干净（全部已 commit）。

## 审阅 Checkpoint

- 本计划先交计划评审（独立上下文 subagent，按 CODING-STANDARDS 检查单），评审意见闭环后呈主人确认；确认前不进入实现。
