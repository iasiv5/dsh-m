# issue #53/#59「意图停用 × 更新聚合口径 × 探测 TTL 化」实施计划（ADR-0033 + ADR-0008 修订，目标 0.12.12）

## 目标

- **聚合口径**：已装页 tab 红点计数（`installedUpdateStats`）与「全部更新 (n)」目标集（`batchUpgradeOrder`）排除且仅排除「意图停用」插件（`userDisabled === true`，唯一判据、无附加守卫）；门控挡下 / 加载失败 / no-entry 纯依赖 / self / protected 照旧计入。
- **意图层字段**：`composeEnablement` 每包派生 `userDisabled`（Bundle 退选 ∪ 行覆盖 `disabled:true`；活体分支也查 `overrideIndex`），仅 `true` 落键；经 `installed` 载荷到达客户端（join 在 probeMode 分支前，快慢两段都携带）。
- **呈现**：已装列表停用行排序沉底（稳定分区）；行级「更新」按钮、卡片徽标零变化；不做披露行。
- **耗时治理（#59 真实成本）**：`installedUpdates` 第二段探测 `ttlMin: 0 → 30`（独立常量，对齐 dshmarket `UPDATES_TTL_MS`；不动浏览页 `cacheTtlMin` 60）；新增 `force` 请求参数（true 时跳过缓存捷径全量重探，失败项只标 `latestError` 不动缓存）；设置页「强制刷新」按钮扩展第四腿（fire-and-forget 预热共享缓存，已装页下次挂载即时命中）。
- **文档**：ADR-0033 新增 + ADR-0008 修订节 + GLOSSARY 三术语**均已落盘在工作树**（见「输入工件」，随本役实现提交一并入库）；CHANGELOG 0.12.12 条目按本计划撰写。

**明确不做**（grill 三轮决议 + ADR-0033 否决项）：

- 按 `enabled` 过滤、`phase!=='failed'` 附加守卫（ADR-0033 Considered Options 前两条，被否）；
- dshmarket 静默体系（ignore 会话静默 / updateExempt 持久静默 / blocked 黑名单）——另开 issue；
- 「另有 N 个停用插件有更新」披露行——不做；
- #53 重开——只在两帖回帖（回帖草案另行送审，沿 2026-11-02 #42 纪律）；
- `enabled` / `phase` / `lockReason` / `toggleable` 字段语义与形状任何变化——`userDisabled` 是纯新增；
- `installedUpdates` 响应白名单（pkg + 7 更新字段）扩容——`userDisabled` 走 `installed` join 通道；
- 手改 `lib/` 构建产物——`src/core/*.ts` 测试引 `lib/core/*.js`，单套件前 `npm run build`；
- heldUpdate / maturity / restoreRequired 等 dshmarket 更新语义移植（desktop pnpm 特有，web 无痛点）。

## 架构快照

- **现状（0.12.11）**：`installedUpdateStats`（`src/client/installed-updates.js` :42）对 `outdated === true` 全量计数；`batchUpgradeOrder`（同文件 :67）全量收编进批量目标（self 收尾定序不变）；`composeEnablement`（`src/core/enablement.ts` :131-178 区段，`export function composeEnablement`）在活体分支（loaderEntries 非 null）只看 `matches.some(row => !row.disabled)` + `liveRow.fiber`，`overrideIndex` 只在 CLI 分支（:156）参与；`installedUpdates` 端点（`src/core/host-api.ts` :622）以 `probeMode:'only'` 调 `listInstalledWithMeta`，`src/core/market.ts` :999 把 `'only'` 映射为 `ttlMin: 0`（先删共享条目再重探）；设置页强刷（`src/client/settings-tab.jsx` :49-64 `refresh()`）做三件事（`reg.reload(true)` + registryState 重载 + `onForceMarket`），`main.jsx` :818 接线 `marketReloadAll(true)`。
- **目标**：意图信号从活体观察中分离出来——`userDisabled` 由持久层两类记录派生（bundle 退选 = 有补丁层但不在 `dsh.profile.bundles`；行覆盖 = `profileOverrides` 命中 `disabled:true`），两类记录都只有用户开关动作会写入、宿主门控不会写，因此 dsh-ops 0.4.4 形态（in bundles、无 override、无 live row）`userDisabled` 恒缺席，聚合照计、自愈无损（ADR-0033 守护红例）。探测成本治在缓存层：第二段 TTL 30min 消灭「每次挂载删共享条目全量重探」，手动穿透走 force 参数（跳过缓存捷径，失败不动缓存），设置页按钮作为穿透入口。

## 全局约束

- 依赖预检 `test -d node_modules`；`src/core/*.ts` 测试从 `lib/core/*.js` 引入，跑 core 套件前 `npm run build`；`src/client/*.js(x)` 测试直接引 `src/client/`。
- 源串锚禁含 `\n`（CRLF 检出）；量化断言用 `src.split(needle).length - 1`（`grep -c` 计 0 即 exit 1）。
- 测试输出过管道保留原退出码（`set -o pipefail`）。
- i18n：本役**零新键零值改**（设置页按钮文案 `settings.force` 身份本就是「强制刷新」，toast `registry.refreshed` 语义涵盖第四腿）。
- 基线：执行时 Step 0 实跑刷新（0.12.11 发布时 `npm test` 全绿 exit 0）。
- 目标版本 0.12.12；**发版（`npm run release`）与 issue 回帖属不可逆公开动作，执行到二者前停下等主人当轮批准**（AGENTS.md 在案纪律）。
- 无额外全局约束项。

## 输入工件

- ADR-0033：`docs/adr/0033-intent-disabled-update-aggregate-scope.md`（本役设计裁决，已落盘工作树）
- ADR-0008 修订节：`docs/adr/0008-installed-two-phase-probe.md`「## 修订记录（2026-11-10 · 0.12.12 · 同批 ADR-0033）」（已落盘）
- GLOSSARY：「意图停用」「未运行」「更新聚合口径」+「运行相位」修正（已落盘 `GLOSSARY.md`）
- issue #53 / #59（经 `gh api repos/iasiv5/dsh-m/issues/53|59` 与 `/comments` 读取全文）
- 参考实现：`~/workspace/.dsh-research/dsh-market-fresh` @ f76b5f5（1.73.17，只作行为与取舍参照，零代码搬运：`client/client.js` :13508-13514 聚合过滤、:13846 排序沉底、:16756 行级按钮无条件；`src/routes.ts` :655/:1084-1085/:3504 三源持久层；`src/updates.ts` :148 `UPDATES_TTL_MS`）

## 文件结构与职责

- Modify: `src/core/enablement.ts` —— `composeEnablement` 派生 `userDisabled`（活体/CLI 两分支共用一次 `disabledByOverride` 计算；`hasPatchLayer` 提升至分支前）
- Modify: `src/client/installed-updates.js` —— `installedUpdateStats` / `batchUpgradeOrder` 排除 `userDisabled === true`
- Modify: `src/client/installed-view.js` —— 新增纯函数 `sortDisabledLast(items)`（稳定分区，Node tests 直引）
- Modify: `src/client/installed-tab.jsx` —— 卡片渲染前调用 `sortDisabledLast`
- Modify: `src/core/market.ts` —— `probeLatest` 的 ttl 语义（`'only'` → 常量 30）+ `ctx.force` 跳过缓存捷径
- Modify: `src/core/host-api.ts` —— `installedUpdates` case 透传 `body.force === true`
- Modify: `src/client/settings-tab.jsx` —— `refresh()` 追加第四腿回调调用
- Modify: `src/client/main.jsx` —— SettingsTab 新 prop `onForceUpdates` 接线（fire-and-forget `api("installedUpdates", { force: true })`）
- Modify: `CHANGELOG.md` —— 0.12.12 条目
- Test: `tests/enablement.test.mjs` / `tests/client-installed-updates.test.mjs` / `tests/client-installed-view.test.mjs` / `tests/market.test.mjs` / `tests/host-api.test.mjs`

只读核对面（零改动）：`src/client/main.jsx` :693（`outdatedCount` 消费点）与 ：779（tab 红点渲染）——统计函数内部变 smarter 后自动承接；`src/core/toggle.ts`（写路径零变化）；`src/client/installed-view.js` 既有内容（`enabledLabelKey`/`installedViewModel`/`registrySourceKey` 等不动——Task 3 仅追加新函数）；`lib/**`（构建产物）；`tests/latest-cache.test.mjs`（`ttlMin=0` 过期语义原样保留——force 不再用它，但语义仍被其它调用方依赖）。

关键现场锚（时点 2026-11-10，0.12.11 工作树，符号优先）：

| 锚 | 位置 |
|---|---|
| `composeEnablement` 函数体 | `src/core/enablement.ts` :131-178（文件共 178 行） |
| `overrideIndex` 现成 Map | 同文件 :134 |
| CLI 分支 `disabledByOverride`（:156，需提升共用） | 同文件 :155-157 |
| `hasPatchLayer`（:162，需提升至分支前） | 同文件 :162 |
| 结果落键区（`result.set(pkg, {...})`） | 同文件 :168-175 |
| `installedUpdateStats` 计数行 `if (it.outdated === true)`（完整 needle 唯一——:31 有形近行 `outdated: u.outdated === true`，禁短 needle） | `src/client/installed-updates.js` :48 |
| `batchUpgradeOrder` 过滤行 `if (!it \|\| typeof it !== 'object' \|\| it.outdated !== true) continue` | 同文件 :73 |
| 已装卡片渲染 `items.map(...)` | `src/client/installed-tab.jsx` :180 |
| `items = applyInstalledUpdates(...)` / `const batch = batchUpgradeOrder(items)` | 同文件 :113 / :115 |
| `'only'` ttl 映射行 | `src/core/market.ts` :999 |
| `opts.force` 现有馈入点（仅两 flight，`'only'` 臂未馈） | 同文件 :582（loadRegistry）/ :588（fetchCommunityCatalog） |
| `probeLatest` def（`async function probeLatest`） | 同文件 :1024 |
| 缓存捷径 `const cached = readLatestCache(cacheKey, ctx.ttlMin)` | 同文件 :1040 |
| 失败臂（`catch (err)` → `latestError/latestErrorCode`，不动缓存；`classifyLatestError` :1067） | 同文件 :1065-1068 |
| `installedUpdates` case（`payload = { updates: ... }` 七字段白名单） | `src/core/host-api.ts` :622-646 |
| 设置页 `refresh()` | `src/client/settings-tab.jsx` :49-64（`onForceMarket?.()` :59） |
| SettingsTab props 解构 | 同文件 :29 |
| `onForceMarket` 接线 | `src/client/main.jsx` :818 |

## 任务清单

### Task 1: `composeEnablement` 派生 `userDisabled`

- 目标：每包新增派生字段 `userDisabled`（仅 `true` 落键），判据 `(!inBundles && hasPatchLayer) || rowIds.some(id => overrideIndex.get(id) === true)`；活体分支与 CLI 分支共用同一次 `disabledByOverride` 计算（现 :156 提升至 `for` 循环内分支前，与 `hasPatchLayer` :162 提升同处）。
- 涉及文件：`src/core/enablement.ts`；`tests/enablement.test.mjs`
- 接口契约
  - Consumes: 现有输入 `{ items, loaderEntries, bundles, profileOverrides }` 形状不变（`listInstalledWithMeta` 调用点零变化）；`overrideIndex`（:134 现成 Map）
  - Produces: `result` 每包可能多 `userDisabled: true` 键；后续 Task 2/3 按键名 `userDisabled` 消费（**全仓库唯一生产点**）
- 验证范围：六形态各一例——(a) Bundle 退选：`inBundles=false` + `patchRows.inserts` 非空可读 → `userDisabled===true` 且 `lockReason` 缺席（有补丁层非 no-entry）；(b) 行覆盖活体分支：`loaderEntries` 非 null + row disabled + `profileOverrides` 命中 `disabled:true` → `userDisabled===true`；(c) **dsh-ops 守护红例**：`inBundles=true` + 无 override + loaderEntries 非 null 但零匹配 → `enabled===false` 且 `'userDisabled' in row === false`；(d) no-entry：`inBundles=false` + patchRows 缺失 → `userDisabled` 缺席 + `lockReason==='no-entry'`；(e) CLI 分支回归：`disabledByOverride` 原 `enabled` 语义不变 + `userDisabled===true` 同例共存；(f) **多行包混合形态（评审 R2-P6）**：双行包首行 override `disabled:true` + 次行活体启用（`toggle.ts` :234 只取 `inserts[0]` 写覆盖 + :249 `setLivePluginDisabled` 活体包级翻转、`enablement.ts` :148-150「任一行启用即整包启用」在案先例——可达）→ `userDisabled===true` 且 `enabled===true` 并存（意图停用与活体运行正交的最强钉子）。

- [ ] Step 1: 写失败测试——`tests/enablement.test.mjs` 新 describe「userDisabled 派生（ADR-0033）」五形态
- Run: `npm run build && node --test tests/enablement.test.mjs`
- Expected: 新五例红（`userDisabled` 键不存在），既有用例全绿
- [ ] Step 2: 最小实现——提升 `disabledByOverride`/`hasPatchLayer` 到分支前，结果落键区加 `...(userDisabled ? { userDisabled: true } : {})`
- Change: 仅 `src/core/enablement.ts`
- [ ] Step 3: 全绿确认
- Run: `npm run build && node --test tests/enablement.test.mjs`
- Expected: exit 0，新旧全绿

### Task 2: 聚合口径过滤（红点 + 全部更新）

- 目标：`installedUpdateStats` 计数行改 `if (it.outdated === true && it.userDisabled !== true)`（:48）；`batchUpgradeOrder` 在 outdated 过滤后追加 `if (it.userDisabled === true) continue`（:73 后）；`incompleteCount`、self 收尾定序、`unsupported` 分桶零变化。
- 涉及文件：`src/client/installed-updates.js`；`tests/client-installed-updates.test.mjs`
- 接口契约
  - Consumes: Task 1 的 `userDisabled` 键名与「仅 true 落键」形状（`it.userDisabled !== true` 与 `=== true` 两种读法都要在测试里钉）
  - Produces: 统计/定序新口径——`main.jsx` 两个消费点（outdatedCount 红点、batch.targets）自动承接，零接线改动
- 验证范围：混合清单断言——停用 outdated 不入 `outdatedCount` 不入 `targets`；门控形态（enabled:false 但无 `userDisabled` 键）、`phase:'failed'`、`lockReason:'no-entry'`、`pkg==='dsh-m'`（self）各自照旧入两者；`userDisabled: false` 显式值视为非停用；**混合形态钉子（评审 R2-P6）**：`userDisabled===true && enabled===true && outdated===true` 仍被两者排除（「无附加守卫」的最强形态——意图停用与活体运行正交）。

- [ ] Step 1: 写失败测试——`tests/client-installed-updates.test.mjs` 新 describe「聚合口径排除意图停用（ADR-0033）」
- Run: `node --test tests/client-installed-updates.test.mjs`
- Expected: 新例红（停用项仍被计入），既有用例全绿（src 直引，无需 build）
- [ ] Step 2: 两处最小实现（:49 计数条件、:71 后 continue）
- Change: 仅 `src/client/installed-updates.js`
- [ ] Step 3: 全绿确认
- Run: `node --test tests/client-installed-updates.test.mjs`
- Expected: exit 0

### Task 3: 已装列表停用行沉底（纯函数落 installed-view.js）

- 目标：分区纯函数 `sortDisabledLast(items)` 落 `src/client/installed-view.js`（该文件头注自述「不依赖 DOM/React/lookup，Node tests 直接 import」，命名沿 `installedViewModel` camelCase 风格）——稳定分区，非 `userDisabled` 在前、`userDisabled === true` 沉底，各自保持原相对顺序（`Array.prototype.sort` 现行 V8 稳定；比较函数 `(a.userDisabled === true ? 1 : 0) - (b.userDisabled === true ? 1 : 0)`，或显式写稳定分区归并，执行者二选一、断言同形）。`installed-tab.jsx` 在卡片渲染（:180 `items.map`）前调用之；`batch`（:115）仍取自原 `items`（集合相同，顺序无关）。
- **测试落点约束（评审 R1-P4 在案）**：`node --test` 加载不了 `.jsx` 组件模块（全 tests/ 对 .jsx 仅 readFileSync 文本锚先例、零 import 先例），故行为级混合顺序断言**必须直引纯函数**（client-installed-view.test.mjs import `sortDisabledLast`）；installed-tab.jsx 调用点以 readFileSync 源串锚补一条存在性断言（先例形态：tests/client-installed-updates.test.mjs :140-141）。
- 涉及文件：`src/client/installed-view.js`（Create 函数）；`src/client/installed-tab.jsx`（调用）；`tests/client-installed-view.test.mjs`
- 接口契约
  - Consumes: Task 1 的 `userDisabled` 键（经 `installed` 载荷 + `applyInstalledUpdates` 的 `...it` 展开存活）
  - Produces: `sortDisabledLast` 导出（Task 3 内自洽消费，不外溢）；渲染顺序契约——行级按钮/徽标/开关零变化（`client-installed-view` 既有断言不漂移为前提）
- 验证范围：纯函数混合顺序断言（停用行全部位于非停用行之后，组内原序保持；含「无停用项原样返回」「全停用项原样返回」两边界）；调用点源串锚存在；既有视图断言不漂移。

- [ ] Step 1: 写失败测试——`tests/client-installed-view.test.mjs` import `sortDisabledLast` 新 describe「停用行沉底（ADR-0033）」（行为断言）+ readFileSync 锚 `installed-tab.jsx` 调用点（存在性）
- Run: `node --test tests/client-installed-view.test.mjs`
- Expected: 新例红（`sortDisabledLast` 不存在——import 报 SyntaxError，文件级加载失败：新例与既有用例**均不运行**，node --test 对该文件报 fail；Step 2 落地后恢复全绿）；调用点锚红
- [ ] Step 2: `installed-view.js` 实现纯函数 + `installed-tab.jsx` 渲染前调用
- Change: 仅 `src/client/installed-view.js` 与 `src/client/installed-tab.jsx`
- [ ] Step 3: 全绿 + 渲染冒烟
- Run: `node --test tests/client-installed-view.test.mjs tests/client-render-smoke.test.mjs`
- Expected: exit 0（冒烟零漂移——本役无新 DOM 分支）

### Task 4a: `installedUpdates` TTL 30min + force 语义（core 侧）

- 目标：(a) `src/core/market.ts` :999 的 `'only'` 映射从 `0` 改为新常量 `INSTALLED_UPDATES_TTL_MIN = 30`（模块顶部 export，latest-cache 语义零改动）；(b) `probeLatest` 的 `ctx` 增 `force?: boolean`，缓存捷径（:1040）改 `ctx.force === true ? null : readLatestCache(...)`——force 全量重探，失败臂现状（:1065-1068 只标 `latestError` 不动缓存）天然保证旧值存活；(c) `src/core/host-api.ts` `installedUpdates` case（:622）读 `body.force === true` 透传 `listInstalledWithMeta` `opts.force`；(d) `listInstalledWithMeta` 的 `opts.force` 现仅馈 registry/community 两 flight（`src/core/market.ts` :582 `loadRegistry` / :588 `fetchCommunityCatalog` 同形），本役将其同时馈入 `'only'` 臂的 `probeLatest ctx.force`（浏览页 `'full'` 路径的 force 行为零变化）。
- 涉及文件：`src/core/market.ts`；`src/core/host-api.ts`；`tests/market.test.mjs`；`tests/host-api.test.mjs`
- 接口契约
  - Consumes: `readLatestCache`/`writeLatestCache`/`peekLatestCache` 现有签名零变化；与 Task 1-3 无依赖，可并行
  - Produces: `installedUpdates` 请求协议新增可选 `force`（缺省 false，旧客户端零影响）+ `INSTALLED_UPDATES_TTL_MIN` 导出常量 + `'only'` 臂 force 透传——Task 4b 消费
- 验证范围：`'only'` 臂 TTL=30（缓存预热 + 未过期命中即秒回）；force 穿透——**红侧必须钉「失败保留旧缓存条目」**（预热 2.0.0 → force 调用且 npmLatest 抛错 → 断言缓存条目仍在/后续 TTL 命中仍 2.0.0；现状 ttlMin=0 先删后探、失败条目已删，此处行为分叉）；**「预热 + force → 探测计数 2」成功路径断言现状永真（现状 force 不进 probeLatest，ttlMin=0 同样全量重探），禁单独成例**；host-api 透传断言。**既有红例改向**：`tests/market.test.mjs` :573「'only'：缓存预热仍强制重探（ttlMin=0 穿透）」改为「TTL 30min 内命中缓存（秒回零探测）+ force 穿透失败保留旧值」两例；`tests/host-api.test.mjs` :457「installedUpdates：TTL=0 探测 + 七字段全量裁剪」改为「TTL=30 + force 透传 + 七字段裁剪不变」。

- [ ] Step 1: 改写既有红例为新语义（先红后绿的红侧）；force 例**必须含失败保留断言**（npmLatest 抛错 → 缓存条目仍在）——成功路径探测计数断言现状永真，不可单独成例
- Run: `npm run build && node --test tests/market.test.mjs tests/host-api.test.mjs`
- Expected: 改向后的新断言红（实现仍是 ttlMin=0 无 force），其余全绿
- [ ] Step 2: 实现 (a)-(d)
- Change: `src/core/market.ts`（常量 + :999 + `probeLatest` ctx）、`src/core/host-api.ts`（:622 case 透传）
- [ ] Step 3: core 侧全绿
- Run: `npm run build && node --test tests/market.test.mjs tests/host-api.test.mjs tests/latest-cache.test.mjs`
- Expected: exit 0（latest-cache 套件零漂移）

### Task 4b: 设置页强刷第四腿接线（client 侧）

- 目标：`src/client/settings-tab.jsx` props 解构（:29）加 `onForceUpdates`，`refresh()` 内 `onForceMarket?.()`（:59）后追加 `onForceUpdates?.()`；`src/client/main.jsx` SettingsTab 接线区（:814-820，`onForceMarket` :818 邻区）加 `onForceUpdates: () => { void api("installedUpdates", { force: true }).catch(() => undefined) }`——fire-and-forget 预热共享内存缓存，已装页下次挂载 `readLatestCache(key, 30)` 即时命中；在途时用户切到已装页的普通拉取会并发重探一次——接受（与今日双挂载行为同形，不引入跨 tab 旗标）。
- 涉及文件：`src/client/settings-tab.jsx`；`src/client/main.jsx`；`tests/client-render-smoke.test.mjs`
- 接口契约
  - Consumes: Task 4a 的 `installedUpdates` force 协议与端点透传
  - Produces: 设置页强刷 = 四腿（registry 强刷 + registryState 重载 + 市场两区 force + 已装更新 force）
- 验证范围：SettingsTab props 契约锚（`tests/client-render-smoke.test.mjs` 如覆盖则按实况补锚，Step 0 普查判定，grep `onForceMarket`）；i18n 零漂移（零新键）。

- [ ] Step 1: 普查渲染冒烟对 SettingsTab props 的覆盖面
- Run: `grep -n "onForceMarket" tests/client-render-smoke.test.mjs src/client/settings-tab.jsx src/client/main.jsx`
- Expected: 现有锚点位置可见；冒烟若断言 props 集合形状则本任务需同步补 `onForceUpdates` 锚
- [ ] Step 2: 实现 settings-tab props + refresh 追加 + main.jsx 接线
- Change: `src/client/settings-tab.jsx`（props + :59 后追加）、`src/client/main.jsx`（:818 邻区接线）
- [ ] Step 3: 客户端侧全绿
- Run: `node --test tests/client-render-smoke.test.mjs tests/client-i18n.test.mjs`
- Expected: exit 0（i18n 套件零漂移——零新键）

### Task 5: CHANGELOG 0.12.12 双语条目

- 目标：`CHANGELOG.md` **中英两区各**新增 `### 0.12.12 特性：更新聚合口径排除「意图停用」插件 + 已装页探测 TTL 化（issue #53/#59，ADR-0033 + ADR-0008 修订）`（英文区同版本号对齐，标题 `### ` 后首段版本号逐字一致——`check-release.mjs` :51-64 配对键即标题首段按空白/冒号/全角括号切分）。两段正文：①红点/「全部更新」不再计入停用（Bundle 退选 / 行覆盖关闭）的插件，被宿主门控挡下、加载失败、纯依赖插件照常计入，停用行排序沉底，每卡片「更新」按钮不变；②已装页更新探测从每次全量重探改为 30 分钟 TTL 缓存，设置页「强制刷新」新增穿透已装更新缓存（对齐 dshmarket 30min 取值）。句式沿既有条目（特性 + issue + ADR 引用）。CHANGELOG.md:3 头注明文「发版时请在两个区块各补一条目」；`check-release.mjs` :41-42 双语顶条断言 + :51-64 近 10 条配对断言（`zhVersions.length >= 10` 窗口）是发版门禁，单区条目必红。
- 涉及文件：`CHANGELOG.md`
- 接口契约
  - Consumes: Task 1-4b 落地后的实际行为（文案不得超出已实现语义——`docs/CODING-STANDARDS.md` evidence-discipline 对 CHANGELOG claims 的在案约束）
  - Produces: 发版提交的 CHANGELOG 素材（`npm run release` 前置核对项；version 字段仍由 release 流程 bump）
- 验证范围（评审 R2-P8 修正）：**本任务阶段跑 `npm run check-release` 必然红，属预期，不作判据**——:41 断言的 version 取自 package.json（此时仍 0.12.11，中文顶条已换 0.12.12 必失配）、:66-77 tag 断言要求 v0.12.11 指向 HEAD（未打 tag 必红）。自查判据：grep 两区标题各见一条 0.12.12 且首段版本号逐字一致、两区条目数各 +1。

- [ ] Step 1: 撰写双语条目（中文区、英文区各一）
- Change: 仅 `CHANGELOG.md`
- [ ] Step 2: 自查——条目内每个行为声明都能在 diff 中找到对应实现行；双语配对自查
- Run: `git diff --stat && grep -c "^### 0.12.12" CHANGELOG.md && grep -A2 "^## English" CHANGELOG.md | head -5`
- Expected: 八个代码文件 + 五个测试文件在 diff stat 中；`grep -c` 结果 2（两区各一条）；英文区顶条可见 0.12.12（grep 计数语义自证：计 0 = exit 1，此处期望 2、exit 0）

### Task 6: 最终验证（门禁三连）

- 目标：全仓库门禁全绿后停——**不执行发版、不在 issue 回帖**（不可逆公开动作，等主人当轮批准；回帖草案届时另送审）。
- 涉及文件：无新改动
- 接口契约
  - Consumes: Task 1-5 全部完成
  - Produces: 可发版状态（main 工作树或特性分支，由主人在 Step 0 决定）

- [ ] Step 1: 全量门禁
- Run: `npm test && npm run typecheck`
- Expected: 两者 exit 0（`pretest` 自带 build；套件计数以实跑输出为准，记录进交接摘要）
- [ ] Step 2: 汇总修改清单（文件、测试增删数、红例改向两处）输出给主人

### Step 0（执行前置，非独立任务）：基线与分支

- Run: `test -d node_modules || npm ci`；`git status -sb`（大量幻影 M 见 workspace AGENTS「git 幻影 M」，勿慌）；`npm run build && npm test` 记录基线计数；当前在 `main`/`master` 时**先问主人**是否开特性分支（执行纪律在案：未经同意不动 main）。
- Expected: 基线全绿 exit 0，计数写入执行日志。

## 任务间接口契约汇总

- `userDisabled` 键名 + 「仅 true 落键」形状：Task 1 Produces → Task 2（统计/定序消费）、Task 3（排序消费）——三任务必须同分支同批合入，任何单独回滚需三任务一起回滚（口径半新半旧 = 红点与列表排序不一致）。
- `installedUpdates` 协议新可选 `force` + `INSTALLED_UPDATES_TTL_MIN`：Task 4a Produces → Task 4b Consumes（设置页接线依赖端点透传先落地）；Task 4a 与 Task 1-3 无依赖，可并行。
- Task 5 依赖 Task 1-4 实际语义定稿；Task 6 依赖全部。

## 执行纪律

- 开始实现前先批判性复查本计划：锚点行号以 grep 符号复核为准（行号是时点快照不是契约）；发现缺项/矛盾/验证命令失效先修计划再动手。
- 按任务顺序执行（Task 4 可与 1-3 并行），不无声跳步、不合并步；每任务完成即跑该任务验证。
- 测试注入形态纪律：enablement 五形态夹具逐字段对照 `composeEnablement` 真实输入面（`items[].patchRows.{readable,inserts}` / `loaderEntries` 行对象 `{id,disabled,fiber}` / `bundles` 数组 / `profileOverrides` 行 `{id,disabled}`）——写夹具前先读 `tests/enablement.test.mjs` 既有 fixture 构造器，不另起炉灶。
- 阻塞、重复失败、计划与仓库现实不符：立即停下说明，不猜。
- `npm test` 前确认 `src/core` 有改动时先 `npm run build`（pretest 自带，但单套件手跑不含）。

## 最终验证

- `npm test && npm run typecheck` 双 exit 0（Task 6）。
- 手工验收清单（可选，发版前）：停用一插件 → 已装页红点数减一、停用行沉底、卡片 ⬆ 徽标与「更新」按钮仍在；「全部更新」不含该插件；设 `dsh-ops` 形态夹具（手动构造 peer 失配难，以 Task 1 红例 (c) 单测为准）；强刷按钮 → 已装页秒开且数据新鲜（`latestError` 不冒泡为弹窗）。
