# dsh-m 已装页两段加载（列表秒开 + 探测就地补 ⬆）实施计划

## 目标

- 打开 dsh-m 面板时已装列表**立即出现**（不等待 latest 探测），更新提示（⬆ 徽标 / tab 红点 / 「全部升级 (N)」/ 「检查未完成」）在探测完成后**就地补上**——复刻 dsh-market 打开即见升级提示的使用感受。
- 不新增任何按钮或手动刷新入口；已装页第二段探测 **TTL=0 永远新鲜**（每次面板挂载真实探测）。
- 范围仅已装页：市场浏览页探测（60min TTL 现状）、`dshm_list`/`dshm_outdated` 工具、CLI 行为零变化。

## 架构快照

```
main.jsx App 挂载（两段并行发起，互不阻塞）
 ├─ installed = useAsync(() => api("installed", { probe: false }), [])   ← 第一段：快列表
 │    host-api → listInstalledWithMeta({ probeMode: 'none' })             （保留 registry 匹配/enablement，跳过探测段）
 └─ updates   = useAsync(() => api("installedUpdates"))                   ← 第二段：探测
      host-api → listInstalledWithMeta({ probeMode: 'only' })             （ttlMin=0 强制新鲜，响应裁剪为 updates 数组·含全部已装项）
       ↓ 纯函数合并（installed-updates.js：applyInstalledUpdates / installedUpdateStats）
   InstalledTab / tab 红点 / 「全部升级」消费 merged 视图（渲染判定逻辑零改动，只换数据源）
mutation 后 refreshViews：market + installed(probe:false) + installedUpdates 三者同刷（现状编排扩展）
```

- `probeMode: 'none'`：跳过 `ensureLatestCacheSwept` + `probeLatest`，其余（registry/社区加载、matching、enablement）不变——registry 走磁盘缓存 + SWR，暖态近即时。
- `probeMode: 'only'`：完整管线不变，`probeLatest` 的 `ttlMin` 传 `0`——`readLatestCache(key, 0)` 现成语义即「弃缓存强制重探」，`latest-cache.ts` 零改动；探测结果照常 write-back。
- 已知副作用（有意接受，ADR-0008 如实留痕）：`ttl=0` 会**先删除共享缓存条目再重探**（latest-cache.ts L42 注释明示该语义，此处为有意援引）——已装页 matched 键与浏览页/`dshm_list`/`dshm_outdated` 的探测键同处 `host` namespace、共享同一内存 Map，面板每次挂载会使这些消费者在 TTL 内改吃新鲜 write-back 值：数据只会更新鲜，各消费者的代码路径与自身 TTL 制度不变（R7「零变化」界定为代码路径与制度）；代价是探测流量与 GitHub 被动预算消耗速率上升，超限走 `latestError` 优雅降级（预算上限 25/req、50/h 滚动不变）。
- 响应契约：`installedUpdates` 返回 `{ updates: Array<{ pkg, latestVersion, latestTag, latestSha, outdated, latestError, latestErrorCode }> }`；**`updates` 含全部已装项**——`outdated=false` 与 `latestError` 项一律在内（client 的「检查未完成」呈现依赖它，缺一即破坏 R6）。不设顶层 `checked`/`failed`（无消费者，不留死契约）。
- 诚实性立场：phase-2 in-flight（约 1–3s）期间卡片暂无提示、与「没得更新」瞬时同形——**有意接受**（与 dsh-market 同款瞬态窗口；常态安静原则）；探测**完成后**的失败经 `latestError` 走「检查未完成」，不冒充「没得更新」。

## 全局约束

- 分支纪律：实施前从**当下 main HEAD**（执行时 `git rev-parse main` 实测为准——0.9.22 系列并行提交活跃，不锚定本计划撰写时点的任何 SHA）拉分支 `feat/installed-two-phase`；本计划不 push、不 tag、不 npm publish（发版另行经主人确认）。
- 版本纪律：**不 bump `package.json`、不预写 `CHANGELOG.md` 版本行**——并行 agent 已占用 0.9.22（commit `7673375`），最终版本号与 CHANGELOG 条目在合并时由主人统一确定，不在本计划内。
- 交互纪律：零新增按钮/手动动作/设置旋钮（`src/host.ts` 设置 schema 不动）；失败呈现复用现有 `installed.check.incomplete` i18n（中英文案表零改动）。
- 平台环境：node ≥22；Windows + PowerShell；所有命令在 `dsh-m/` 目录下执行。
- 测试纪律：测试用 `DSHM_CACHE_DIR` 指向 `mkdtempSync` 临时目录 + 本地 `node:http` server，绝不触碰 `~/.dsh`；core 测试 import `../lib/core/*.js`（改动 TS 后先 `npm run build`），client 纯模块测试 import `../src/client/*.js`（免构建）。
- 行为保持：`probeMode` 缺省 `'full'`——`dshm_list`/`dshm_outdated` 工具、CLI `list/outdated`、浏览页调用点代码路径逐字节不变（共享探测缓存键的写入副作用见架构快照「已知副作用」，消费者代码路径与 TTL 制度不变）。

## 输入工件

- 设计共识：本会话 2026-10-03 grill 轮次 Q1–Q9（全部按推荐落定）。
- 分析底稿：`01_docs/research/2026-10-03-dshm-update-hint-vs-dshmarket-analysis.md`（工作区根，不在本仓库）。
- 前序决策：`docs/adr/0006-latest-cache-memory-only.md`（内存缓存制度对浏览页/工具继续有效，本计划只给已装面板开「永远新鲜」通道）。
- 同业参照：`.dsh-research/dsh-market-clone`——`src/updates.ts`（checkUpdates/TTL=30min）、`src/client/MarketSection.tsx` L2293（列表与 `/updates` 两段模式原型）。
- 基线与锚点：并行 agent 活跃提交中（0.9.22 系列），main HEAD 是移动目标——**分支基线 = 执行时 `git rev-parse main` 实测值**，计划不锚定具体 SHA；计划内一切行号均为撰写时点参考，执行时一律以符号/grep 定位。已核查（评审时点 HEAD `16ab737`）：并行提交未触及主锚点 `listInstalledWithMeta`/`probeLatest`（market.ts 约 L866–995）与 main.jsx 数据加载区；`docs/DESIGN.md` 的「2. 已装页」小节已漂移至约 L165——Task 5 执行前先 grep『已装页』复核。

## 文件结构与职责

- Create: `src/client/installed-updates.js` — 已装页两段合并纯逻辑：`applyInstalledUpdates(items, updates)` 按 pkg 补 `latestVersion/latestTag/latestSha/outdated/latestError/latestErrorCode`（不可变，安全降级）；`installedUpdateStats(items)` → `{ outdatedCount, incompleteCount }`。不依赖 DOM/React，Node tests 直接 import（同 `installed-view.js` 纪律）。
- Create: `tests/client-installed-updates.test.mjs` — 上述纯逻辑用例。
- Create: `docs/adr/0008-installed-two-phase-probe.md` — 已装页两段加载决策（ADR-0007 已被 0.9.22 占用，顺延 0008）。
- Modify: `src/core/market.ts` — `listInstalledWithMeta` opts 增 `probeMode?: 'full' | 'none' | 'only'`（缺省 `'full'`）；`'none'` 跳过探测段；`'only'` 以 `ttlMin: 0` 调 `probeLatest`。
- Modify: `src/core/host-api.ts` — `case 'installed'`（约 L446）读取 `body.probe === false` → 传 `probeMode: 'none'`；新增 `case 'installedUpdates'` → `probeMode: 'only'`，响应裁剪为 `{ updates }`（接线 profileDir/profile 与 `installed` case 同款）。
- Modify: `src/client/main.jsx` — `installed` useAsync（L2459）改传 `{ probe: false }`；新增 `updates` useAsync（`api("installedUpdates")`，挂载即并行）；`refreshViews`（L2524–2527）增 `updatesReload`；`stillApplies`（L2533）改 `api("installed", { probe: false })`（`opAppliesTo` 不消费更新字段，安全）；红点 `outdatedCount`（L2582–2584）与 `counts.installed`（L2578–2581）改由 merged 视图计算；`InstalledTab`（L1670）增 `updates` prop，渲染前 `applyInstalledUpdates` 合并，卡内判定（L1767/L1802/L1815/L1834/L1846）零改动。（行号均为撰写时点参考，执行以符号/grep 定位。）
- Modify: `src/client/view-refresh.js` — `refreshAfterMutation` 增 `updatesReload` 通道。
- Modify: `tests/market.test.mjs` — 新增 `describe('listInstalledWithMeta probeMode', ...)`。
- Modify: `tests/host-api.test.mjs` — 新增 `installed {probe:false}` 与 `installedUpdates` 用例（沿用 `callApi(dispatcher, ...)` harness，L190/L280 邻例同款）。
- Modify: `tests/client-view-refresh.test.mjs` — `updatesReload` 用例（含失败透传）。
- Modify: `docs/DESIGN.md` — 「2. 已装页」（grep『已装页』定位；评审时点约 L165）补两段加载一句；缓存语义段（约 L24）补 `installedUpdates` TTL=0 例外一句。
- Modify: `GLOSSARY.md` — 增「两段加载（two-phase load）」词条（沿用 0.9.22 增补格式）。

## 任务清单

依赖关系：Task 1 → Task 2（host-api 依赖 core 的 probeMode）；Task 3 独立可并行；Task 4a 独立可并行；Task 4b 依赖 1+2+3+4a；Task 5 依赖全部落地后收口。

### Task 1: market.ts 增 `probeMode`（'none' 跳探测 / 'only' 强制新鲜）

- 目标：`listInstalledWithMeta` 支持三种探测模式，缺省行为逐字节不变。
- 涉及文件：`src/core/market.ts`（`listInstalledWithMeta` 签名与 L920–922 探测段）、`tests/market.test.mjs`。
- 接口契约：
  - Consumes: 现有 `probeLatest`（`ctx.ttlMin` 已流入 `readLatestCache`）、`MarketDeps` 注入缝（`npmLatest` 计数桩）、`tests/market.test.mjs` L253 `describe('listInstalledWithMeta')` 既有注入风格（`DSHM_CACHE_DIR` fixture + fake deps）。
  - Produces: `listInstalledWithMeta` opts 内联交叉类型（market.ts `opts: RegistryRuntimeOptions & { deadlineMs?... }`）增 `probeMode?: 'full' | 'none' | 'only'` 字段（不新增导出类型，Task 2 的 host-api 消费）；`'only'` 语义 = ttlMin 强制 0、探测结果照常 write-back。
- 验证范围：新 describe 三用例 + 既有用例零回归。

- [ ] Step 1: 写失败测试（`tests/market.test.mjs` 追加 `describe('listInstalledWithMeta probeMode', ...)`，注入风格仿 L253 既有用例）：
  - 用例 a `'none'：跳过探测段`——`npmLatest` 桩计数 0；registry 匹配仍生效（断言 `items[0].registryId` 非空）。
  - 用例 b `'only'：缓存预热仍强制重探`——先以缺省模式跑一次（桩返回 0.0.1），再以 `probeMode: 'only'` 跑一次（桩改返 0.0.2）→ 断言第二次 `npmLatest` 仍被调用且 `items[0].latestVersion === '0.0.2'`（ttlMin=0 穿透生效；不断言 outdated——既有 fixture 已装版本为 '1.0.0'，避免照抄 fixture 后断言方向相反）。
  - 用例 c `缺省 'full'：TTL 内走缓存`——同桩连续两次缺省调用 → `npmLatest` 桩仅被调用一次。
- [ ] Step 2: 运行并确认失败
  - Run: `npm run build; node --test tests/market.test.mjs`
  - Expected: 新 describe 三用例红（`probeMode` 未实现：'none' 仍探测 / 'only' 不穿透 / TS 不识别该 opts——以测试红为准）。
- [ ] Step 3: 写最小实现
  - Change: `listInstalledWithMeta` opts 增 `probeMode`（缺省 `'full'`）；`'none'` → 跳过 `ensureLatestCacheSwept` + `probeLatest`（L920–922 探测段外包裹条件）；`'only'` → `probeLatest` 的 `ctx.ttlMin` 传 `0`；`'full'` → 现状 `Math.max(0, cfg.cacheTtlMin ?? 60)` 不动。
- [ ] Step 4: 运行并确认通过
  - Run: `npm run build; node --test tests/market.test.mjs`
  - Expected: 全绿（新增三用例 + 既有零回归；`tests/latest-cache.test.mjs` 不受影响——`latest-cache.ts` 零改动）。
- [ ] Step 5: checkpoint commit
  - Run: `git add src/core/market.ts tests/market.test.mjs; git commit -m "feat(core): listInstalledWithMeta probeMode（none 跳探测 / only 强制新鲜）"`

### Task 2: host-api `installed` probe 标志 + `installedUpdates` 方法

- 目标：面板第一段走 `probe:false`，第二段走新方法；工具/CLI 路径（缺省 body）行为不变。
- 涉及文件：`src/core/host-api.ts`（`case 'installed'` 约 L446；新增 `case 'installedUpdates'`）、`tests/host-api.test.mjs`。
- 接口契约：
  - Consumes: Task 1 的 `probeMode`；`boolArg`/`strArg` 既有 arg 解析；`case 'installed'` 的 profileDir/profile 接线（0.9.5 注释块）。
  - Produces: HTTP 契约——`installed` 增可选 `body.probe`（`false` → `'none'`，其余/缺席 → `'full'`）；`installedUpdates` 响应 `{ ok, updates: [{ pkg, latestVersion, latestTag, latestSha, outdated, latestError, latestErrorCode }] }`，**`updates` 含全部已装项**（Task 3/4 消费）。
- 验证范围：`tests/host-api.test.mjs` 新用例 + 既有用例零回归（含 `host-api-profile.test.mjs`）。

- [ ] Step 1: 写失败测试（`tests/host-api.test.mjs`，仿 L190/L280 邻例；**前置：setup() 增可选 installedResult override**——现有 mock 硬编码 `items: []`（约 L109–120），deps 注入缝在 host-api.ts 约 L269 已备）：
  - 用例 a：`{ method: 'installed', probe: false }` → 200，mock 断言 `listInstalledWithMeta` 收到 `probeMode: 'none'`，响应 `items` 任一项**无** `latestVersion` 字段。
  - 用例 b：`{ method: 'installedUpdates' }` → 200，override 注入两插件（一 outdated 一 latestError）→ 断言 `updates.length === 2`（**latestError 项在内**）、每项仅含白名单七字段、响应**不含** `items`/`others` 全量负载。
  - 用例 c：`{ method: 'installed' }`（无 probe）→ mock 收到 `probeMode: 'full'`（向后兼容护栏）。
- [ ] Step 2: 运行并确认失败
  - Run: `npm run build; node --test tests/host-api.test.mjs`
  - Expected: 用例 a/b/c 红（`installedUpdates` 分支不存在；probe 标志未接线）。
- [ ] Step 3: 写最小实现
  - Change: `case 'installed'` 增 `probeMode: body.probe === false ? 'none' : 'full'` 传入 `listInstalledWithMeta`；新增 `case 'installedUpdates'`（`probeMode: 'only'`，profileDir/profile 与 installed 同款接线），响应裁剪为七字段 `updates` 数组（**含全部已装项**，不做 outdated 过滤）。
- [ ] Step 4: 运行并确认通过
  - Run: `npm run build; node --test tests/host-api.test.mjs; node --test tests/host-api-profile.test.mjs`
  - Expected: 全绿。
- [ ] Step 5: checkpoint commit
  - Run: `git add src/core/host-api.ts tests/host-api.test.mjs; git commit -m "feat(host-api): installed probe 标志 + installedUpdates 探测专用方法"`

### Task 3: client 纯模块 `installed-updates.js`

- 目标：合并与统计逻辑独立成 Node 可测纯模块（DESIGN §4 纪律）。
- 涉及文件：`src/client/installed-updates.js`（新建）、`tests/client-installed-updates.test.mjs`（新建）。
- 接口契约：
  - Consumes: Task 2 的 `updates` 数组形状（七字段）。
  - Produces: `applyInstalledUpdates(items, updates)` → 新数组（缺 updates/非数组 → 原样浅拷贝；未知 pkg 忽略；items 原对象不可变）；`installedUpdateStats(items)` → `{ outdatedCount, incompleteCount }`（Task 4 的 main.jsx 消费）。
- 验证范围：本模块用例全绿（src 直引，免构建）。

- [ ] Step 1: 写失败测试（`tests/client-installed-updates.test.mjs`，风格仿 `tests/client-view-refresh.test.mjs`：`node:test` + `assert/strict`）：
  - merge 正常路径（七字段按 pkg 落位；**outdated=true 与 latestError 项均在 updates 内**）；updates 缺席 pkg 的 item 保持原状；items/updates 传 null/非数组不抛、安全降级；**不可变**断言（原数组与原对象不被改写）；`installedUpdateStats` 对 outdated 与 latestError 分别计数、null 入参返回 `{ outdatedCount: 0, incompleteCount: 0 }`。
- [ ] Step 2: 运行并确认失败
  - Run: `node --test tests/client-installed-updates.test.mjs`
  - Expected: 红（模块不存在，import 报错）。
- [ ] Step 3: 写最小实现（`src/client/installed-updates.js`，头注释标注 DESIGN §4 纯模块纪律与两段加载来源，**不写任何版本号**）
- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-installed-updates.test.mjs`
  - Expected: 全绿。
- [ ] Step 5: checkpoint commit
  - Run: `git add src/client/installed-updates.js tests/client-installed-updates.test.mjs; git commit -m "feat(client): installed-updates 纯合并/统计模块"`

### Task 4a: view-refresh 三路刷新扩展

- 目标：mutation 后编排扩展为 market + installed + updates 三路同刷。
- 涉及文件：`src/client/view-refresh.js`、`tests/client-view-refresh.test.mjs`。
- 接口契约：
  - Consumes: 无新依赖（编排层，不触碰 API 形状）。
  - Produces: `refreshAfterMutation({ marketReload, installedReload, updatesReload })` 新签名（Task 4b 的 main.jsx 消费）。
- 验证范围：view-refresh 用例全绿（src 直引，免构建）。

- [ ] Step 1: 写失败测试（`tests/client-view-refresh.test.mjs`）：既有两用例改造——调用增 `updatesReload`，断言三路同刷且市场刷新保持 `force=false`；失败透传用例补 `updatesReload` 抛错路径。
- [ ] Step 2: 运行并确认失败
  - Run: `node --test tests/client-view-refresh.test.mjs`
  - Expected: 红（`updatesReload` 未被消费/透传）。
- [ ] Step 3: 改 `view-refresh.js`（`Promise.all` 三路）
- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-view-refresh.test.mjs`
  - Expected: 绿。
- [ ] Step 5: checkpoint commit
  - Run: `git add src/client/view-refresh.js tests/client-view-refresh.test.mjs; git commit -m "feat(client): refreshAfterMutation 增 updates 刷新通道"`

### Task 4b: main.jsx 两段接线

- 目标：面板挂载两段并行；红点/徽标/全部升级/检查未完成消费 merged 视图。
- 涉及文件：`src/client/main.jsx`。
- 接口契约：
  - Consumes: Task 2 的 `installedUpdates` 响应形状、Task 3 的 `applyInstalledUpdates`/`installedUpdateStats`、Task 4a 的 `refreshAfterMutation` 新签名、现有 `useAsync`（返回 `{ loading, data, error, reload }`）、`api(method, params)`（body 直传 params）。
  - Produces: `updates` useAsync 实例（后续 mutation 编排唯一消费点）。
- 验证范围：view-refresh 用例回归 + bundle 构建与 render 冒烟。

- [ ] Step 1: main.jsx 接线（改动点全列，防遗漏）：
  - imports 区（L20 附近 require 风格）增 `const { applyInstalledUpdates, installedUpdateStats } = require("./installed-updates.js");`
  - L2459 `useAsync(() => api("installed", { probe: false }), [])`；紧随新增 `const updates = useAsync(() => api("installedUpdates"), []);`
  - L2524–2527 `refreshViews` 增 `updatesReload: updates.reload`（deps 数组同步补 `updates.reload`）。
  - L2533 `stillApplies` 改 `api("installed", { probe: false })`（`opAppliesTo` 不消费更新字段，安全）。
  - 红点/counts 段（L2578–2584）：`const mergedItems = installed.data && Array.isArray(installed.data.items) ? applyInstalledUpdates(installed.data.items, Array.isArray(updates.data && updates.data.updates) ? updates.data.updates : []) : null;`；`outdatedCount` 改读 `installedUpdateStats(mergedItems || []).outdatedCount`（updates 未到时自然为 0，不误点亮）；`counts.installed` 维持 `installed.data.items.length`。
  - tab 渲染调用点（约 L2670）：`h(InstalledTab, { notify, installed, onMutation: refreshViews, ops })` 增传 `updates`——漏传不报错（`applyInstalledUpdates` 对 undefined 安全降级）、render-smoke 仍绿，但卡内 ⬆/全部升级/检查未完成全部静默失效且 App 层红点照亮（状态自相矛盾），属必须防的静默失效模式。
  - `InstalledTab`（L1670）签名增 `updates`；组件内以同款 `applyInstalledUpdates(installed.data.items, ...)` 求合并视图，`items` 常量指向合并结果——loading 判定（约 L1757）**保持只看 phase-1**（updates 未到不显全页 spinner），卡内消费点（约 L1767/L1802/L1815/L1834/L1846）吃合并字段，判定式零改动。
- [ ] Step 2: 构建与冒烟
  - Run: `npm run build; node --test tests/client-render-smoke.test.mjs`
  - Expected: 构建成功、冒烟绿（bundle 内 require 路径有效）；目视核对 updates 链路可达——L2670 调用点 → `updates` prop → 卡内判定字段（⬆/全部升级/检查未完成的数据源）。
- [ ] Step 3: 回归 view-refresh 用例
  - Run: `node --test tests/client-view-refresh.test.mjs`
  - Expected: 绿。
- [ ] Step 4: checkpoint commit
  - Run: `git add src/client/main.jsx; git commit -m "feat(client): 已装页两段加载——列表秒开，探测结果就地补 ⬆"`

### Task 5: 文档收口（ADR-0008 + DESIGN + GLOSSARY）

- 目标：决策留痕 + 设计文档同步 + 术语入册。
- 涉及文件：`docs/adr/0008-installed-two-phase-probe.md`（新建）、`docs/DESIGN.md`、`GLOSSARY.md`。
- 接口契约：
  - Consumes: Task 1–4 的最终形态（方法名 `installedUpdates`、opts `probeMode`、ttl=0 语义、失败呈现复用 `installed.check.incomplete`）。
  - Produces: 后续发版 CHANGELOG 引用的决策依据。
- 验证范围：文档存在 + 锚点 grep 命中 + 与实现名称一致。

- [ ] Step 1: 写 `docs/adr/0008-installed-two-phase-probe.md`，沿用 ADR-0006 结构（决策段 / Considered Options / Consequences）：
  - 决策：已装页两段加载；第二段 `installedUpdates`（`probeMode:'only'`）**TTL=0 永远新鲜**、挂载即并行发起；失败逐项复用「检查未完成」，传输级整体失败静默（与浏览页后台刷新失败同语义，接受）；范围仅已装页。
  - Considered Options：单段全量 TTL=0（方案一，被否——牺牲已装页秒开）；仅降探测 TTL 至 5min（方案二，被否——连发版窗口仍盲）；维持 60min（现状痛点）；拆段结构对齐 dshmarket（本决策）。
  - Consequences：每次面板挂载一轮真实探测——GitHub 被动预算**上限**不变（25/req、50/h 滚动）但**消耗速率**上升（现状 TTL 内开面板 0 探测），超限走 `latestError` 优雅降级；**预算回退通道**——若实机预算触顶常态化（latestError 增多），回退 = `'only'` 路径改独立 namespace，代价是 write-back 不再跨视图受益；**ttl=0 先删共享条目**（latest-cache.ts L42 警示语义的有意援引）：host namespace 下浏览页/dshm_list/dshm_outdated 的 TTL 内命中被面板挂载刷新为更新值（数据只更新鲜、代码路径与自身 TTL 制度不变）；phase-2 in-flight（1–3s）瞬时无提示、与「没得更新」同形——有意接受（常态安静；完成后失败走 latestError）；版本错配降级——新面板对旧宿主调 `installedUpdates` 得结构化错误 → `updates.data` 为 null → 无徽标（静默），旧宿主忽略 `probe:false` 未知字段 → 回落全量探测（无害）；ADR-0006 内存缓存制度对浏览页/工具/CLI 继续有效；mutation 定向失效保留（对 ttl=0 路径无害）；npm staged 发布窗口（~17min，know-how 018）是任何客户端方案共同的下限。
- [ ] Step 2: `docs/DESIGN.md` 两处补句：「2. 已装页」小节（先 `Select-String -Path docs\DESIGN.md -Pattern '已装页'` 定位；评审时点约 L165）补「两段加载：列表不等待探测（`probe:false`），更新提示由 `installedUpdates`（TTL=0）就地补上（ADR-0008）」；缓存语义段（约 L24）句末补「已装面板第二段探测为 TTL=0 例外（ADR-0008）」。
- [ ] Step 3: `GLOSSARY.md` 增「两段加载」词条（定义 + 指向 ADR-0008）。
- [ ] Step 4: 验证（无测试命令的文档任务，用可观察检查替代）
  - Run: `Select-String -Path docs\adr\0008-installed-two-phase-probe.md,docs\DESIGN.md,GLOSSARY.md -Pattern '两段加载' | Measure-Object | Select-Object -ExpandProperty Count`
  - Expected: `≥ 4`（ADR 标题+正文、DESIGN、GLOSSARY 各有命中）；人工目视三处方法名/字段名与代码一致（`installedUpdates`、`probeMode`、`applyInstalledUpdates`）。
- [ ] Step 5: checkpoint commit
  - Run: `git add docs/adr/0008-installed-two-phase-probe.md docs/DESIGN.md GLOSSARY.md; git commit -m "docs: ADR-0008 已装页两段加载 + DESIGN/GLOSSARY 同步"`

## 执行纪律

- 开工顺序：`git rev-parse main` 实测当下 HEAD（不依赖本计划撰写时点的 SHA）→ `git checkout -b feat/installed-two-phase` → **先把计划文档单独入库**（`git add docs/plans/2026-10-03-installed-two-phase-implementation-plan.md` + commit `docs(plans): 已装页两段加载实施计划`），此后所有 checkpoint commit 一律精确路径 `git add`（禁用 `git add -A`，防夹带并行 agent 的未跟踪文件）；不 push（发版/推送另行经主人确认）。
- 开始实现前先批判性复查本计划；发现缺项、矛盾或与仓库现实不符，先修计划再动码。
- 按任务顺序执行，不无声跳步；每任务四步验证（红→绿→commit）闭环。
- 全程不 bump `package.json`、不写 `CHANGELOG.md`、不动 `src/host.ts` 设置 schema、不改中英文案表。
- 遇阻塞或重复失败，立即停下说明，不猜。

## 最终验证

- Run: `npm run typecheck`
  - Expected: 无类型错误（market.ts / host-api.ts 签名变更收敛）。
- Run: `npm test`
  - Expected: 全部测试绿（含新增 `client-installed-updates.test.mjs`、market/host-api/view-refresh 新用例；pretest 自动 build）。
- Run: `git log --oneline main..feat/installed-two-phase`
  - Expected: 7 个 commit（1 个计划文档入库 + 6 个 checkpoint），无版本号变更。
- 实机验收（对照 grill 验收标准，需主人配合、不在自动验证范围）：(i) 暖缓存开面板已装列表 1s 内出现，⬆/红点/全部升级在探测完成后就地出现（本机 ≤3s）；(ii) 发布任一新版本后重开面板必见提示（npm staged ~17min 窗口内除外）；(iii) 自动化部分即上述两命令；(iv) Windows desktop 与 Ubuntu web 各验证一轮。

## 审阅 Checkpoint

- 计划正文结束。请主人审阅；批准前不进入实现。默认执行方为普通编码 agent 或人工执行者。
