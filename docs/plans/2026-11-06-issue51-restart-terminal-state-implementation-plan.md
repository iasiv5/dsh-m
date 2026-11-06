# issue #51「重启终态回传 UI」实施计划（last-restart 状态文件 + 惰性折叠 + 三面呈现，ADR-0032）

## 目标

- **单一事实源**：helper 对全部九个终态原子写 `last-restart.json`（`join(dshHome(), 'dshm', 'last-restart.json')`，`DSHM_LAST_RESTART_FILE` 整文件覆盖供测试），形状 `{ ok, via:'helper', tag, sha, port, requestChannel, at, elapsedMs, assumed?, reason? }`；文件持久保留到下次重启覆盖；`foldedAt` 由 host 折叠后回写（幂等标记，非消费即焚）。
- **呈现面 (a)**：host-api 新 action `last-restart`（纯磁盘读零网络，镜像 0.12.5 `published-at` 单条 action 惯例）→ 处理器内惰性折叠：`requestChannel ?? 'external' ∈ {cli, host-tool, external}` 且无 `foldedAt` 时经 `journalExternalOperation` 补 `kind:'restart'` journal 记录（成功失败都记）并回写 `foldedAt`；**panel 显式跳过折叠**（append 层 `channel='panel'` 拒绝不变量之上在折叠层可测地跳过），面板终态走 action + 横幅呈现。
- **呈现面 (b)**：RestartBanner 在 `ping.boot` 变化确认后 fetch `last-restart`——成功经新回调 `onOutcome` 通知宿主组件（notify「重启完成（X.Xs）」）、失败通知原因、不可得静默保持现状；90s 超时文案改「重启未在 90 秒内确认完成——真实结果已落盘，可稍后查看操作记录」（双语值改，键不动）。
- **呈现面 (c)**：`dshm_restart` 工具与 CLI restart 在发起请求时读状态文件，输出尾行「上次重启终态：…」（无文件/首次使用不输出）。
- **测试盲区收口**：`src/core/restart-state.ts` 新属主模块全测；vm 沙箱 harness 扩 mkdir/writeFileSync 捕获，终态落盘行为级断言；host-api/客户端/工具面新钉例。

**明确不做**（grill 决议 Q1–Q5 + 设计总账 + ADR-0032 否决项）：

- appExit/systemd 托管路径不写终态（helper 不存在；systemd Restart 语义自带呈报），「已请求重启」主文案逐字节不变（仅 (c) 尾行追加）；
- desktop 委派路径不动（Electron 生命周期本就禁 helper）；`RestartResult` 形状不动（新信息全走状态文件通道）；
- wait 期跨进程实时失败推送（ADR-0032 否决：helper 反向监听端口复杂度不成比例且端口本身可能被占）；
- rename-claim 消费状态文件（与文件常驻冲突，ADR-0032 否决，改 `foldedAt` 回写）；
- HEAD 安装的 SHA 比对更新徽章（涉及被动探测比较机制改造，出本范围，后续另立）；
- helper 直写 journal（ADR-0032 否决：模板膨胀且绕过钩子层 panel 跳过）。

## 架构快照

- 现状（0.12.7）：helper 九个终态只 `note()` 进 `%TEMP%` 日志；调用方 `RestartResult = { pid, helperPid, via }` 恒「已请求重启」；客户端 `RestartBanner`（chrome.jsx :208）2s 轮询 `ping.boot`（host-api :368，BOOT_ID 来自 dsh-cli.js）90s deadline。
- 目标：`scheduleRestart` 新可选 dep `channel?: OperationChannel` 与缺省解析的 `statePath`（`restart-state.lastRestartFile()`）注入 helper（新参 `statePath`/`stateDir`/`requestChannel`，沿 flags/pid 注入先例）；helper 侧新增 `t0`/`finish(ok, extra)` 模板行，九终态各加一行 `finish(...)` 调用（`note()` 行不动）；host 侧 `src/core/restart-state.ts` 新属主（write/read/foldLastRestart）；host-api `last-restart` action = read + fold；呈现三层接线。
- 折叠复用 `journalExternalOperation`（external-journal.ts :170）：钩子层已吞错、截断 reason、**panel 自动跳过**——折叠层仍显式判 panel 返回 `skipped-panel`（语义可测，不依赖钩子隐式行为）。

## 全局约束

- 依赖预检 `test -d node_modules`；`src/core/*.ts` 测试从 `lib/core/*.js` 引入，单套件前 `npm run build`。
- 源串锚禁含 `\n`（CRLF 检出）；量化断言出现次数语义（`src.split(needle).length - 1`）。
- 测试输出过管道保留原退出码（`set -o pipefail`）；门禁恒稳形态。
- 注入夹具逐字段对照生产调用面（vm harness fs stub 扩展 = helper 内 fs 触面：`appendFileSync/openSync/mkdirSync/writeFileSync`）。
- i18n 新键双语同步（`tests/client-i18n.test.mjs` 守卫）；文案断言双语容忍（node 环境 lookup 取 en——钉死中文必红的先例纪律）。
- 基线：web 机 2026-11-06 `npm test` **2104/2104 全绿 exit 0**（0.12.7 发布实测）；执行时以实跑刷新。
- 本计划与 ADR-0032（`docs/adr/0032-restart-terminal-state-reporting.md`）**已入库**（docs commit，R3-1 勘误——原「已入库」声称先于实际 commit，已修正为实态）；二者互为引用；目标版本 0.12.8（发版另行批准）。
- 无额外全局约束项。

## 输入工件

- issue #51（本役标靶，含 #50「独立问题」段全文与阶段二方案方向）
- ADR-0032：`docs/adr/0032-restart-terminal-state-reporting.md`（本计划的设计裁决记录）
- 设计共识：grill 两轮（Q1–Q5 / R1–Q4）+ 设计总账主人确认（2026-11-06）
- 先例：ADR-0031 published-at 单条 action（host-api :568 形态镜像）；`published-at.ts` 属主模块先例；ADR-0018 journal 钩子纪律（吞错/截断/终态后记）
- 参考实现：dsh-market-fresh `src/sources.ts`（HEAD 语义与 codeload 钉定，只作行为参照不入依赖）

## 文件结构与职责

- Create: `src/core/restart-state.ts` —— 状态文件唯一属主：`lastRestartFile()`（env 覆盖）/`readLastRestart()`/`writeLastRestart()`/`foldLastRestartIntoJournal(deps?)`（读+判通道+调钩子+回写 foldedAt）；`LastRestartState` 类型
- Modify: `src/core/restart.ts` —— `restartHelperSource` 三新参（`statePath`/`stateDir`/`requestChannel`）+ 模板 `t0`/`finish`/九终态 `finish(...)` 调用；`scheduleRestart` deps 扩 `channel?: OperationChannel`，缺省 `statePath = lastRestartFile()`、`stateDir = dirname`、`requestChannel = channel` 注入模板调用
- Modify: `src/core/external-journal.ts` —— `ExternalOperationKind` 枚举加 `'restart'`（一行）
- Modify: `src/core/host-api.ts` —— 新 case `'last-restart'`（读 + 折叠，deps 注入 `foldLastRestart`）
- Modify: `src/tools.ts` —— restart 工具 execute 读终态、text 尾行追加（channel='host-tool' 接线）
- Modify: `src/cli.ts` —— restart case 读终态输出行（channel='cli' 接线）
- Modify: `src/host.ts` —— wrapper 透传 channel（:64 一行签名 + :155 注入不变）
- Modify: `src/client/chrome.jsx` —— RestartBanner boot 变化后 fetch `last-restart` + 新 prop `onOutcome`
- Modify: `src/client/i18n.js` —— `restart.done.ok`/`restart.done.failed`/`op.kind.restart` 双语 + `restart.timeout` 值改（键不动）
- Modify: `src/client/main.jsx` —— RestartBanner `onOutcome` 接线 notify（定位见锚表，grep 复核）
- Create: `tests/restart-state.test.mjs` —— 属主模块套件
- Modify: `tests/restart.test.mjs` —— vm harness fs stub 扩 `mkdirSync/writeFileSync` 捕获 + 新 describe「终态落盘」+ 新 describe「注入锚」
- Modify: `tests/host-api.test.mjs` —— `last-restart` action describe（缺失/有文件/panel 不折叠/external 折叠幂等）

只读核对面（零改动）：`src/core/external-journal.ts` 除枚举行外（append/list/clear/normalize 逻辑不动）、`src/core/market-mutation.ts`（web 安装路径，RestartResult 消费面）、`src/core/profile-ops.ts`（desktop 装升级）、`src/client/operations-card.jsx`（kind 标签经 `lookup("op.kind."+kind)` 自动承接新键）、`tests/external-journal*.test.mjs`、`tests/client-render-smoke.test.mjs`（渲染冒烟不加新 DOM 分支则零漂移，如冒烟覆盖 banner 文本分支需按实况补——Step 0 普查判定）。

关键现场锚（时点 2026-11-06，0.12.7 后工作树，符号优先）：

| 锚 | 位置 |
|---|---|
| `restartHelperSource` def（现 4 形参 port/pid 之后扩三参） | `src/core/restart.ts` :211 |
| 模板注入区（flags :230 / pid :231 行后追三行） | 同文件 :230-231 |
| `const main = async () => {`（模板主流程起点，`t0`/`finish` 插其前后） | 同文件 :246 |
| 九终态 `note(...)` 行（finish 调用各紧随其后插入） | 同文件 :249-303 区段（grep `note(\`restart failed` / `note(\`replacement` 全列） |
| `replacementSpawnFlags` / 常量区 / `scheduleRestart` def / deps 块 / `appExit?: AppExit` | 同文件 :315 / :320-326 / :329 / :331 / :341 |
| detached-helper spawn 调用（`'-e', restartHelperSource(spawned, launch, …, port, pid)`） | 同文件 :385-387 |
| `ExternalOperationKind` 枚举 | `src/core/external-journal.ts` :29-37 |
| `journalExternalOperation(channel, record, result, deps & {reason?})`（panel 钩子层跳过） | 同文件 :170-194 |
| `journalFile()`（`$DSH_HOME/dshm/external-operations.json`） | 同文件 :54 |
| restart 工具（text :516 / title :523 / execute `restart(null)` :529；wrapper def :127） | `src/tools.ts` |
| CLI restart case（out 行 :469） | `src/cli.ts` :466-471 |
| wrapper def / 注入 | `src/host.ts` :64 / :155 |
| 面板 restart action（`d.scheduleRestart(servingPort(req))`） | `src/core/host-api.ts` ≈:795-801 |
| `published-at` action（形态镜像） | 同文件 :568-573 |
| `boot: BOOT_ID` | 同文件 :368 |
| `listExternalOperations` deps 接线 | 同文件 :26 / :99 / :339 |
| RestartBanner 组件（`nextRestartWait` done 判定 / `restart.timeout` lookup / text 三态） | `src/client/chrome.jsx` :208-262 |
| i18n restart 键（zh :119-122 / en :250-253） | `src/client/i18n.js` |
| 操作卡 kind 标签（`lookup("op.kind." + r.kind)`） | `src/client/operations-card.jsx` :55 |
| RestartBanner 渲染/notify 接线点 | `src/client/main.jsx`（grep `RestartBanner` 定位，Step 0 复核） |

## 行为零变化承诺（每特性必填格）

| 口径 | 承诺 |
|---|---|
| `RestartResult` 形状与三返回点 | 零变化：`{ pid, helperPid, via }` 键集不动；restart 套件既有 21 例零改动全绿 |
| 「已请求重启」主文案（tools :516 / cli :469） | 主串逐字节不变——仅**追加**可选尾行（状态文件存在时）；缺失态输出与今日逐字节一致 |
| app-exit / systemd 托管分支 | 零变化：无 finish 调用（finish 仅存在于 helper 模板）、无状态文件写入（经测试钉：managed/systemd 用例 stateWrites 恒空——如注入面允许；否则由分支代码不触达声明） |
| desktop 委派路径 | 零变化（host-api restart case 的 `assertWriteAllowed` 与路由不动，仅 channel 实参追加） |
| helper `%TEMP%` 日志与 `[dsh-m]` note 行 | 逐字节不变（finish 是新增并行通道，不改 note 文案） |
| journal 既有记录与读者 | 零变化：枚举**追加** `'restart'`（既有 kind 顺序不动）；append/list/clear/normalize 逻辑不动；既有 external-journal 套件零改动全绿 |
| `published-at` action 与 published-at 面全量 | 零变化 |
| 面板 pump（客户端 OperationRecord） | 零变化（restart 终态经 `last-restart` action + notify 呈现，不入 pump） |
| **声明变化面（本役目的）** | ① helper 九终态写 `last-restart.json`（新文件）；② journal 可能新增 `kind:'restart'` 记录（仅 cli/host-tool/external 通道重启，成功失败都记）；③ `dshm_restart`/CLI 输出可能带「上次重启终态」尾行（状态文件存在时）；④ 重启横幅 boot 变化后可能通知「重启完成/失败」；90s 超时文案双语值变化（键不动）；⑤ `scheduleRestart` 新可选 dep（不传时 channel=undefined → 折叠解析 'external'，statePath 仍缺省解析——行为面与传 channel 一致，仅通道归属兜底） |
| 状态文件缺失/损坏 | 三面全部静默降级为现状行为（无尾行、无通知、action 返回 `{ available: false }`）——缺省态诚实退化 |

## 断言面普查（web 机现场核证 2026-11-06，执行时复核）

- **A journal kind 消费面**：`ExternalOperationKind` 的既有九值无 switch 穷举（normalizeRecord/append/list 均透传 kind）；客户端 `operations-card.jsx` :55 经 `lookup("op.kind." + r.kind)` 动态键渲染——**新键须落双语字典且经动态键在场断言**（CODING-STANDARDS「动态键另行在场断言」纪律，`tests/client-i18n.test.mjs` 补 `op.kind.restart` `in` 断言）。
- **B restart 套件既有 21 例**：0.12.7 产出（git log ee65651），断言面为 note/spawnCalls/锚——本役新增状态写断言全部走**新增 describe**（既有 21 例零改动），红绿互不干扰。
- **C host-api restart 注入桩面**：`tests/host-api.test.mjs` ≈:246-248 / `tests/host-api-profile.test.mjs` ≈:60/:98-100 桩返回 `{pid, helperPid, via}`——`RestartResult` 形状不动 → 兼容；桩未传 channel → 折叠解析 'external' → 新 action 测试自带 env 覆盖隔离。
- **D i18n 值断言面**：`restart.timeout` 当前值「重启超时，请手动检查 dsh web 服务状态」（zh :121）——grep tests/ 该串零命中（2026-11-06 现场核证）→ 值改无既有断言破坏；新键 `restart.done.ok`/`restart.done.failed`/`op.kind.restart` 全新。
- **E chrome.jsx 渲染冒烟**：`tests/client-render-smoke.test.mjs` 对 RestartBanner 的覆盖面 Step 0 现场判定（banner 新分支仅在回调内，不影响首帧渲染断言则零漂移；如冒烟钉了 text 三态 lookup，则新增 outcome 文案不触达首帧）。
- **F helper 源码锚既有面**：restart.test.mjs 内 `"windowsHide":true` / `shell: viaShell, ...flags }` / `const pid = 4242` / 四常量锚——本役注入行追加（`const statePath =` 等）不触碰既有 needle；`finish(` 模板行为新增，无既有锚冲突。

## 任务间验收映射（计划追溯）

| 需求（issue #51 断言 / grill 决议） | 落点 |
|---|---|
| 单一事实源：helper 九终态写状态文件 | Task 2（finish 模板行 + 九调用点 + vm 断言） |
| 状态文件位置/作用域/测试覆盖（Q3） | Task 1（`lastRestartFile` + env 覆盖钉例） |
| 呈现面 (a) journal 折叠 + panel 跳过 + foldedAt 幂等（Q1/Q2） | Task 1（fold 实现）+ Task 3（action 触点 + 四态钉例） |
| 呈现面 (b) 横幅 boot 后终态 + 超时文案诚实化（Q1/Q5） | Task 4（chrome.jsx + i18n 值改 + main.jsx 接线） |
| 呈现面 (c) 工具/CLI 上次终态尾行（Q1） | Task 3（tools/cli 读终态 + 钉例） |
| channel 归属注入（设计总账 3） | Task 2（deps + 注入）+ Task 3（四调用点接线） |
| 不做面四条（Q4） | 零变化格逐行 + Task 4 Step 0 复核 |
| ADR 承载（issue 承诺） | ADR-0032 已入库（输入工件） |
| 发版 0.12.8 + issue #51 关闭回帖 | 计划外停点：当轮另行批准（执行纪律） |

---

### Task 1: `restart-state.ts` 属主模块（写/读/折叠红绿）

- 目标：写失败测试先红（模块不存在），实现后绿。
- 涉及文件：Create `src/core/restart-state.ts`、Create `tests/restart-state.test.mjs`
- 接口契约
  - Produces（Task 2/3 消费）：`lastRestartFile(): string`（`DSHM_LAST_RESTART_FILE` 覆盖，缺省 `join(dshHome(), 'dshm', 'last-restart.json')`）；`readLastRestart(): Promise<LastRestartState | null>`（缺失/损坏 → null；JSON 解析失败 → null）；`writeLastRestart(state: LastRestartState): Promise<void>`（mkdir recursive + tmp+rename 原子替换）；`foldLastRestartIntoJournal(deps?: { journalExternalOperation?: typeof journalExternalOperation } = {}): Promise<'folded' | 'skipped-panel' | 'already-folded' | 'absent' | 'fold-failed'>`——读 → 无文件 `'absent'`；`requestChannel ?? 'external' === 'panel'` → `'skipped-panel'`；`foldedAt` 在场 → `'already-folded'`；否则 **fold 层 try/catch 包住钩子调用与 foldedAt 回写**：成功 → 回写 `foldedAt` → `'folded'`；任何失败（含注入桩抛错——R1-3：真钩子内部吞错但注入桩绕过内层 try/catch，fold 层必须自设防）→ 返回 `'fold-failed'` 且**不回写 foldedAt**（下次调用重试；「钩子已成功而回写失败」窗口存在重复记录可能，磁盘故障级罕见，接受并记录）；`LastRestartState` 类型导出
- 验证范围：roundtrip / env 覆盖 / 缺失 null / 损坏 null / 折叠四态 / foldedAt 回写 / 折叠吞错不抛

- [ ] Step 0: 普查复核（A–F 上表为 2026-11-06 现场证据；执行时复核 `grep -rn "restart-state" src/ tests/` 零命中 = 全新模块）
- [ ] Step 1: 写失败测试 `tests/restart-state.test.mjs`（import 自 `../lib/core/restart-state.js`；每用例 `mkdtemp` 隔离 + `DSHM_LAST_RESTART_FILE` 指向 tmp 内路径，afterEach 清 env）。夹具常量：`const STATE = { ok: true, via: 'helper', tag: 'v1.2.3', sha: 'a'.repeat(40), port: 3081, requestChannel: 'host-tool', at: Date.now(), elapsedMs: 46300 }`——逐字段对照 Task 2 helper finish 写入形状。九例的编排/断言逐条：

  - ① **roundtrip**：`await writeLastRestart(STATE)` → `readLastRestart()` deepEqual `STATE`（含 `assumed`/`reason` 可选键：另写 `{ ...STATE, ok: false, reason: 'x', assumed: true }` 再读，可选键在场断言）。
  - ② **缺失/损坏 → null**：env 指向不存在路径 → null；env 指向写入 `not json{{{` 的文件 → null 且不抛。
  - ③ **env 覆盖优先**：同一进程内先写路径 A 再切 env 到路径 B → read 为 null（B 未写）→ 证明缺省 `dshHome()` 路径未被触碰。
  - ④ **原子形态**：写后 glob 目录无 `.tmp-` 前缀残留文件。
  - ⑤ **external 折叠**：预置 `requestChannel: 'host-tool'` 状态文件 + 钩子桩 `appendCalls.push(record)` → `foldLastRestartIntoJournal({ journalExternalOperation: 桩 })` 返回 `'folded'`；断言桩收 `{ kind: 'restart', target: 'dsh-m web（v1.2.3）' }` + result `'ok'`；再读文件断言 `foldedAt` 数值在场。
  - ⑥ **panel 跳过**：预置 `requestChannel: 'panel'` → 返回 `'skipped-panel'`、桩零调用、文件**无** foldedAt。
  - ⑦ **幂等**：⑤ 的产物（foldedAt 在场）再折叠 → `'already-folded'`、桩仍 1 次。
  - ⑧ **absent**：无文件 → `'absent'`、桩零调用。
  - ⑨ **fold-failed**：钩子桩抛错实现（`journalExternalOperation: async () => { throw new Error('x') }` 绕过真钩子内层吞错）→ fold 返回 `'fold-failed'` 且文件**无** foldedAt 回写（不抛；R1-3：失败不回写 foldedAt，下次调用可重试）；另：写入损坏文件 + 折叠 → 不抛（read null 走 absent）。

  失败态折叠样例补一例并入 ⑤（同 describe 第 ⑥ 前）：预置 `{ ok: false, reason: 'port 3081 still held by another process' }` → 断言钩子桩收 result `'failed'` + `reason` 透传。
- Run: `npm run build` → `node --test tests/restart-state.test.mjs`
- Expected: **红，且红形态恰好为**——模块不存在：`node --test` 报「Cannot find module '../lib/core/restart-state.js'」加载期失败（全文件红）
- [ ] Step 2: 确认红形态
- [ ] Step 3: 实现 `src/core/restart-state.ts`（~100 行）：头注引用 ADR-0032；`import { dshHome } from './env.js'`、`import { journalExternalOperation } from './external-journal.js'`、`import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'`；四导出按接口契约（fold 内 try/catch 包钩子调用与 foldedAt 回写，失败 → `'fold-failed'` 不回写）；写盘 mkdir recursive + tmp+rename；损坏/缺失 → null（best-effort，与 journal list 同款纪律）
- [ ] Step 4: 复跑同两条命令 → 全绿（9 例）
- [ ] Step 5: checkpoint commit（可选）

### Task 2: helper 注入与九终态落盘（restart.ts + vm 断言红绿）

- 目标：终态写盘断言先红（今日 helper 无 writeFileSync、无三新参注入行），实现后绿。
- 涉及文件：Modify `tests/restart.test.mjs`、Modify `src/core/restart.ts`
- 接口契约
  - Consumes：Task 1 的 `lastRestartFile()`（scheduleRestart 缺省 statePath 解析用）
  - Produces（Task 3 消费）：`restartHelperSource(spawned, launch, logs, port, pid, statePath, stateDir, requestChannel)`（8 形参，后三新增）；`scheduleRestart` deps 新 `channel?: OperationChannel`（`import type { OperationChannel } from './external-journal.js'`）；状态文件形状即 ADR-0032 §1
- 验证范围：vm 沙箱终态落盘断言（成功/refuse/null-port 三形态）+ 注入锚（statePath/stateDir/requestChannel 三行出现次数语义）+ channel 接线钉

- [ ] Step 1: 写失败测试 `tests/restart.test.mjs`：
  1. vm harness `fs` stub 扩展（逐字段对照 helper 新 fs 触面）：`mkdirSync: (p, o) => { mkdirCalls.push(p) }`、`writeFileSync: (p, txt) => { stateWrites.push(JSON.parse(txt)) }`（`stateWrites`/`mkdirCalls` 随 harness 返回）；
  2. 文件末尾追加新 describe（既有 21 例零改动）：

  ```js
  describe('restart helper 终态落盘（issue #51 / ADR-0032）', () => {
    // runHelper 同款三常量 + src8：8 形参调用（定义于 src5 旁）
    // const src8 = (port, pid = 4242, statePath = '/tmp/dshm-test/last-restart.json', stateDir = '/tmp/dshm-test', requestChannel = 'host-tool') =>
    //   restartHelperSource(base, { cwd: '/c' }, logs, port, pid, statePath, stateDir, requestChannel)
    // 基底 stub 序列 = 既有 vm 例 N 原样（①=例①、②=例②、③=例③、④=例④），既有断言保留不改，新断言纯追加：
    it('① 绑定成功 → writeFileSync 恰 1 次，state.ok=true、elapsedMs 数值、无 reason/assumed 键、mkdir 恰 stateDir', async () => {
      // 基底 = 既有 vm 例 ① 原样（src5→src8）；追加断言：
      // assert.equal(h.stateWrites.length, 1)
      // assert.equal(h.stateWrites[0].ok, true)
      // assert.ok(typeof h.stateWrites[0].elapsedMs === 'number')
      // assert.ok(!('reason' in h.stateWrites[0]) && !('assumed' in h.stateWrites[0]))
      // assert.deepEqual(h.mkdirCalls, [stateDir])
      …（基底照抄既有例 ① 正文，src5(3081, 4242)→src8(3081)）
    })
    it('② 旧进程 5s 未退出 → stateWrites[0] ok=false 且 reason 含 still alive', async () => {
      // 基底 = 既有 vm 例 ② 原样（src5→src8）；追加：assert.equal(h.stateWrites[0].ok, false) + reason 子串断言
      …
    })
    it('③ 端口仍被外部占用 → stateWrites[0] ok=false 且 reason 含 still held', async () => {
      // 基底 = 既有 vm 例 ③ 原样（src5→src8）；追加同款两断言（reason 子串 still held）
      …
    })
    it('④ port=null 成功路径 → stateWrites[0] ok=true 且 assumed=true（无端口可探的假定成功分层）', async () => {
      // 基底 = 既有 vm 例 ④ 原样（src5→src8）；追加：assert.equal(h.stateWrites[0].assumed, true)
      …
    })
    it('⑤ 注入锚：statePath/stateDir/requestChannel 三行内插恰各 1 处 + finish 定义行恰 1 处（出现次数语义）', () => {
      // const src = src8(3081)
      // assert.equal(src.split('const statePath = ').length - 1, 1)（三同款）
      // assert.equal(src.split('const finish = (ok, extra) =>').length - 1, 1)（R2-1 勘误：needle 不带 TS 引号——src 为 join 产物非源行）
      …
    })
  })

  describe('scheduleRestart channel 接线（issue #51 / ADR-0032）', () => {
    it('⑥ channel=host-tool → 注入 requestChannel 进 helper 源码（接线钉；tools 调用点 restart(null, host-tool) 形态——R2-3：Task 2 阶段统一 host-tool，cli 演进移 Task 3 Step 1）', () => {
      // 复用既有接线钉 describe 的 scheduleRestart 夹具，deps 加 channel: 'host-tool'
      // assert.equal(src.split('const requestChannel = "host-tool"').length - 1, 1)（R2-3 勘误：Task 2 阶段统一 'host-tool'——与 tools 调用点一致；'cli' 演进移 Task 3 Step 1）
      …
    })
  })
  ```

  （①–④ 复用 vm 例 ①②③④ 的 stub 序列与断言骨架，新增 stateWrites 断言；⑤ 断言 `src.split('const statePath = …').length - 1 === 1` 等三锚与 `'const finish = (ok, extra) =>'`（无引号 needle，R2-1）计 1；⑥ Task 2 阶段断言 `src.split('const requestChannel = "host-tool"').length - 1 === 1`（R2-3：与块内统一），Task 3 Step 1 演进为 `'cli'`。`stateDir` 由 `path.dirname(statePath)` 宿主侧解析后注入——helper 内不 require node:path。）
- Run: `npm run build` → `node --test tests/restart.test.mjs`
- Expected: **红，且红形态恰好为**——新 6 例红（①②③④ 红在 `stateWrites.length === 1` 断言：今日 helper 无 writeFileSync 调用；⑤ 红在三锚计 0；⑥ 红在 requestChannel 锚计 0——今日 8 形参未传/未内插）；既有 21 例保持绿。红例 6、绿 21；列表外红停下排查。
- [ ] Step 2: 确认失败形态逐一吻合
- [ ] Step 3: 实现 `src/core/restart.ts`：
  1. `restartHelperSource` 形参扩为 `(spawned, launch, logs, port, pid, statePath, stateDir, requestChannel)`；模板注入区（pid 行后）追加三行 `` `const statePath = ${JSON.stringify(statePath)}`, `` / `stateDir` / `requestChannel` 同款；
  2. 模板 `const main` 行前加 `'const t0 = Date.now()',`；其后加 finish 定义行（单行形态，含 `fs.mkdirSync(stateDir, { recursive: true })` + `writeFileSync(statePath, JSON.stringify(Object.assign({ ok, via: "helper", tag, sha, port, requestChannel, at: Date.now(), elapsedMs: Date.now() - t0 }, extra || {})))`，全程 try/catch 吞错；**helper 单写者直写系 ADR-0032 §4 裁决——tmp+rename 原子替换仅宿主侧 foldedAt 回写承担，勿按「原子写」字面给模板加膨胀，R3-2**）；
  3. 九终态 `note(...)` 行后逐一插入 `finish(...)` 调用：旧进程拒绝/占口拒绝/spawn catch/error 事件/早退/绑定前退出/超时 → `finish(false, { reason: '<同义短句>' })`；绑定成功 → `finish(true)`；null-port still running → `finish(true, { assumed: true })`（`note` 行零改动）；
  4. `scheduleRestart` deps 块（:331）加 `channel?: OperationChannel`；import 行补 `import { lastRestartFile } from './restart-state.js'` 与 `import type { OperationChannel } from './external-journal.js'`；detached-helper 调用（:385-387）扩传 `statePath, stateDir, requestChannel`——`const statePath = deps.statePath ?? lastRestartFile()`（deps 亦可注 `statePath?: string` 供测试直控）、`const stateDir = dirname(statePath)`（`import { dirname } from 'node:path'` 补 import）、`const requestChannel = channel`；
  5. 头注补一行：「0.12.8（ADR-0032/#51）：helper 九终态写 last-restart.json（restart-state 属主），channel 随调用方注入」。
- [ ] Step 4: 复跑同两条命令 → 全绿（27 例 = 21 + 6）
- [ ] Step 5: `npm run typecheck`（0 错误——`OperationChannel` 导入与 dirname import 类型面）
- [ ] Step 6: checkpoint commit（可选）

### Task 3: 通道接线四点 + (c) 工具/CLI 上次终态尾行

- 目标：四调用点真实通道到位；(c) 呈现先红后绿。
- 涉及文件：Modify `src/tools.ts`、`src/cli.ts`、`src/host.ts`、`src/core/host-api.ts`（channel 实参）+ Modify `tests/restart.test.mjs`（接线钉更新——⑥ 的期望 channel 由缺省变显式）、`tests/host-api.test.mjs`（restart 桩补 channel 断言可选）
- 接口契约
  - Consumes：Task 2 的 `scheduleRestart` deps `channel` 与 `restart-state.readLastRestart`
  - Produces：(c) 呈现（tools 尾行 + **cli 输出行，runCli 两例承载**——R3-5）+ 真实通道接线 + `CliDeps` 新注入位 `scheduleRestart?: typeof scheduleRestart`
- 验证范围：tools 尾行钉（有文件/无文件两态）、cli 输出行钉（runCli 正反两例：正例 env 预置状态文件 → out 含 ⏮ 行；反例缺失 → 输出与今日逐字节一致）、host-api restart 桩 channel 透传断言

- [ ] Step 0: **通道接线普查——已由计划评审 R1 亲核钉死为 (a) wrapper 形态**：`src/host.ts` :102 `registerTools(ctx, controller.config, { restart, getService, ensureService }, profile)` 把 host.ts wrapper 注入 tools（tools.ts :127 本地 wrapper 仅为 `deps.restart ??` 兜底），:155 注入 host-api 链——即生产接线下 tools :529 与 host-api :798 的 restart 都经 host.ts wrapper `(port, channel?)`。执行时复核 :102/:155 两行仍在位即可。
- [ ] Step 1: 写失败测试。`tests/restart.test.mjs` 接线钉（Task 2 ⑥）断言由 `'host-tool'` 改 `'cli'`——⑥ 模拟的是 cli.ts 直调 `scheduleRestart(null, { channel: 'cli' })` 形态，接线后应收到 `'cli'`：`tests/host-api.test.mjs` restart describe 补断言「restart action 以 channel='panel' 调 wrapper」（calls 桩补 channel 捕获）。tools 尾行钉：**新增 describe**（tests/ 无 dshm_restart 工具既有直接用例——R1-2 普查实证）于 tools 套件内：restart 工具 execute 前置状态文件（env 指向预置）→ render 输出含「上次重启终态」正例 + env 指向缺失路径 → 输出与今日逐字节一致的反例。**CLI 输出行钉（R3-5）**：`tests/cli-custom-profile.test.mjs`（runCli 先例 ≈:15-18）同款夹具新增两例——正例：env `DSHM_LAST_RESTART_FILE` 指向预置状态文件 → `runCli(['restart', '--yes'], deps, { out })` 输出含 `⏮ 上次重启终态：`；反例：env 指向缺失路径 → 输出与今日逐字节一致（无 ⏮ 行）。**两例必须经 CliDeps 注入桩走 deps.scheduleRestart——严禁裸 runCli 走真实现**（cgroup 含 .service 时进真 systemd-run、无 systemd 机进真 detached-helper spawn，且 Task 3 后向真实 `$DSH_HOME` 写状态文件——「桩走真实 spawn」先例形态）。
- Run: `npm run build` → `node --test tests/restart.test.mjs tests/host-api.test.mjs`（分跑记退出码）
- Expected: 红——⑥ 改 `'cli'` 后红在 requestChannel 锚（`"cli"` ≠ 今日 undefined）；tools/host-api 新例红在尾行缺失/桩 channel 断言
- [ ] Step 2: 确认红形态
- [ ] Step 3: 实现：
  0. `src/cli.ts` **CliDeps**（:47-56）加注入位 `scheduleRestart?: typeof scheduleRestart`（既有 7 个注入位同款惯例，零生产行为变化——R3-5 选 (a)）；:468 改 `(deps.scheduleRestart ?? scheduleRestart)(null, { channel: 'cli' })`（生产不注入 → 走真实现，行为零变化）；out（:469）前**无条件**读终态 `const last = await readLastRestart().catch(() => null)` → 有才输出 `⏮ 上次重启终态：…` 行（文案同 tools 尾行口径。勘误：本条初稿曾把读挂在 `deps.scheduleRestart` 条件上——生产 CliDeps 不注入该位会导致 ⏮ 行永不显示；读取是纯磁盘操作，无条件读即可，测试反例已覆盖缺失态逐字节一致）；
  1. `src/host.ts` :64 wrapper 签名 `(port: number | null = null, channel?: OperationChannel)` → `scheduleRestart(port, { appExit, channel })`（import type 补）；
  2. `src/tools.ts` :127 本地兜底 wrapper 同款扩签名（fallback 对齐——生产路径经 :102 注入走 host wrapper，R1 已钉）；:529 `restart(null, 'host-tool')`；
  3. **tools 尾行机制（R1-2 勘误后形态）**：execute 改 `const res = cloneJson(restart(null, 'host-tool'))`；调度后 `const last = await readLastRestart().catch(() => null)`；`return { ...res, ...(last ? { lastRestart: last } : {}) }`（条件展开——缺省态返回体与今日**逐字节一致**）；`output.render`（:514-518）改读 `(value as { lastRestart?: LastRestartState | undefined }).lastRestart` 追加尾行：主串不变 + `${value.lastRestart ? `\n上次重启终态：${value.lastRestart.ok ? (value.lastRestart.assumed ? `成功（假定，${value.lastRestart.tag}）` : `成功（${(value.lastRestart.elapsedMs / 1000).toFixed(1)}s，${value.lastRestart.tag}）`) : `失败（${value.lastRestart.reason ?? '未知原因'}）`}` : ''}`（**R2-2：assumed 分支不呈报耗时**——null-port 路径 elapsedMs≈宽限窗轮询时长非真实重启耗时，ADR-0032「assumed 成功不做耗时呈报依据」；`lastRestart` 键经 `presentationMeta: {kind, ...value}` 透传无消费面——presentResult 忽略 meta；`output.schema` 已 `additionalProperties: true` 兼容）；
  4. `src/cli.ts` :468 `scheduleRestart(null, { channel: 'cli' })`；out（:469）前读终态 → 有文件才输出 `⏮ 上次重启终态：…` 行（文案同 tools 尾行口径）；
  5. `src/core/host-api.ts` restart case（≈:798）——**Step 0 已钉 (a) wrapper 形态**：`d.scheduleRestart(servingPort(req), 'panel')`。既有注入桩（host-api 两套件 ≈:246-248 等）同步第二参捕获。
- [ ] Step 4: 复跑 → 全绿（restart 27 + host-api 58+新例）
- [ ] Step 5: checkpoint commit（可选）

### Task 4: host-api `last-restart` action + 横幅呈现 + i18n

- 目标：(a) action 红绿 + (b) 横幅 boot 后终态通知 + 超时文案诚实化 + `op.kind.restart` 双语键。
- 涉及文件：Modify `src/core/host-api.ts`（新 case + deps 注入）、Modify `src/client/chrome.jsx`、Modify `src/client/i18n.js`、Modify `src/client/main.jsx`、Modify `tests/host-api.test.mjs`、（视 Step 0 普查）`tests/client-render-smoke.test.mjs`
- 接口契约
  - Consumes：Task 1 的 `foldLastRestartIntoJournal` / `readLastRestart`（host-api deps 注入，缺省真实现）
  - Produces：action `last-restart` 返回 `{ available: boolean, state?: LastRestartState & { foldedAt?: number } }`；RestartBanner 新 prop `onOutcome?: (state: LastRestartState) => void`
- 验证范围：action 四态钉（缺失 `{available:false}` / external 折叠 / panel 不折叠 / 幂等）+ client-i18n 新键在场断言 + 冒烟零漂移

- [ ] Step 0: 普查复核——`grep -n "RestartBanner" src/client/main.jsx` 定位渲染点与 notify 可得性；`grep -rn "restart.timeout" tests/` 断言面（期望零命中）；client-render-smoke 对 banner 的覆盖面判定
- [ ] Step 1: 写失败测试 `tests/host-api.test.mjs`（env 覆盖 + 注入桩，镜像 published-at action 测试形态——Step 0 grep `published-at` tests/ 定位既有 describe 惯例）：

  ```js
  describe('host-api last-restart action（issue #51 / ADR-0032）', () => {
    // 前置：env DSHM_LAST_RESTART_FILE **与** DSHM_EXTERNAL_JOURNAL_FILE 均指向 tmp 路径
    // （R1-1：②/④ 走真钩子写 journal——不隔离将向测试机真实 $DSH_HOME/dshm/external-operations.json
    //  追加记录，污染真实用户数据且断言非确定；隔离惯例先例 host-api-profile.test.mjs ≈:139-145；
    //  每用例预置/清空）；restart action 走注入桩
    it('① 状态文件缺失 → { available: false }（不折叠、不抛）', async () => {
      // 合法 body POST action='last-restart' → payload.available === false；payload.state 不在场
    })
    it('② external 状态 → available:true + state 透传 + journal 收 restart 记录', async () => {
      // 预置 requestChannel:'host-tool' 状态文件 → payload.available === true、state.ok/tag 透传；
      // 经 listExternalOperations（或 journal 文件直读）断言新增 kind==='restart' 记录一条
    })
    it('③ panel 状态 → available:true + journal 零新增（不变量在折叠层显式可测）', async () => {
      // 预置 requestChannel:'panel' 状态文件 → available === true 且 journal 记录数不变
    })
    it('④ 二次调用 → already-folded 幂等（journal 记录数仍为 1）', async () => {
      // ② 之后再次 POST → available === true 且 journal 记录数不变
    })
  })
  ```

- Run: `npm run build` → `node --test tests/host-api.test.mjs`
- Expected: 红——新 4 例红（action 不存在：payload/路由失败形态，如实记录）；既有全绿
- [ ] Step 2: 确认红形态
- [ ] Step 3: 实现 `src/core/host-api.ts`：import `foldLastRestartIntoJournal, readLastRestart`（deps 注入 `lastRestart?: typeof readLastRestart`、`foldLastRestart?: typeof foldLastRestartIntoJournal`，接线 :339 区）；restart case 后邻位新增 case：

  ```ts
  case 'last-restart': {
    // #51（ADR-0032）：重启终态读缝点——磁盘读零网络 + 惰性折叠外部通道进 journal。
    // 折叠返回 'fold-failed' 时不反噬读取（B6：宿主仍正常呈现上次终态，下次调用重试折叠）。
    if (d.foldLastRestart) await d.foldLastRestart()
    else await foldLastRestartIntoJournal()
    const state = d.lastRestart ? await d.lastRestart() : await readLastRestart()
    payload = state === null ? { available: false } : { available: true, state }
    break
  }
  ```

  （import 区补 `import { foldLastRestartIntoJournal, readLastRestart } from './restart-state.js'`；deps 接口加 `lastRestart?: typeof readLastRestart`、`foldLastRestart?: typeof foldLastRestartIntoJournal`，接线在 :339 区同款 `ctx.deps?.x ?? x` 形态。）
- [ ] Step 4: 复跑 → 4 例绿 + 既有绿
- [ ] Step 5: 客户端实现：
  1. `src/client/i18n.js`：zh :119 区追加 `"restart.done.ok": "重启完成（耗时 {elapsed}）", "restart.done.assumed": "重启完成（假定已启动）", "restart.done.failed": "重启失败：{reason}",`、`"op.kind.restart": "重启",`；`"restart.timeout"` 值改 `重启未在 90 秒内确认完成——真实结果已落盘，可稍后查看操作记录`；en :250 区镜像（`"restart.done.ok": "Restart completed (took {elapsed})", "restart.done.assumed": "Restart completed (assumed started)", "restart.done.failed": "Restart failed: {reason}", "op.kind.restart": "Restart",`、timeout 值 `Restart did not confirm within 90s — the real result is on disk; check the operations record later`）。**R3-4 呈现实况（如实记录，不改 err 文案）**：chrome.jsx :229 `throw new Error(lookup("restart.timeout"))` → :249 catch 臂 `lookup("restart.failed", { err })` 包裹 → 横幅实显「**重启失败：**重启未在 90 秒内确认完成——真实结果已落盘…」——「确认失败」语义成立（重启未完成确认），前缀保留；
  2. `src/client/chrome.jsx` RestartBanner：签名加 `onOutcome`；boot 变化 done break 后、`setPhase("idle")` 前：`try { const r = await api("last-restart"); if (r && r.available && onOutcome) onOutcome(r.state); } catch { /* 终态通知失败不阻塞重启完成 */ }`；`onOutcome` 加入 useCallback deps；
  3. `src/client/main.jsx`：RestartBanner 渲染点接线 `onOutcome={(s) => notify(s.ok ? (s.assumed ? { kind: "ok", text: lookup("restart.done.assumed") } : { kind: "ok", text: lookup("restart.done.ok", { elapsed: (s.elapsedMs / 1000).toFixed(1) + "s" }) }) : { kind: "error", text: lookup("restart.done.failed", { reason: s.reason ?? "" }) })}`（**R2-2：assumed 分支不显耗时**——panel 请求经 desktop 桥等场景 servingPort 为 null 时 elapsedMs≈宽限窗轮询时长；notify/lookup 可得性以现场为准——Step 0 已定位渲染点）；
  4. `tests/client-i18n.test.mjs`：`op.kind.restart` 动态键在场断言（双语 `in` 断言，CODING-STANDARDS 动态键纪律）。
- [ ] Step 6: 复跑——`node --test tests/host-api.test.mjs tests/client-i18n.test.mjs tests/client-render-smoke.test.mjs`（分跑）→ 全绿；`npm run typecheck`
- [ ] Step 7: checkpoint commit（可选）

### Task 5: 全量收口

- [ ] Step 1: `npm run build` → `npm test`（预期 2104 + 新增约 21 例量级：restart-state 9 + restart 6 + host-api 4 + tools/cli/host-api 随 Task 3 增量——以实跑为准，与基线 2104 对照零基线外红例）→ `npm run typecheck`（0）
- [ ] Step 2: 输出修改摘要（逐文件可归因；计划外改动为零）
- [ ] Step 3: **停点**——`npm run release`（0.12.8）、issue #51 回帖与关闭、操作记录视图实机验收（重启后看 journal 条目/横幅通知）均待主人当轮批准

## 执行纪律

- 开始实现前批判性复查整份计划；缺项/矛盾/锚漂移先修计划。
- 按任务顺序执行；每任务红→确认形态→实现→绿再进下一任务；红形态清单是判据，列表外红停下排查不猜。
- 两阶段导入陷阱复用上役教训：凡新测试 import 尚不存在的导出，红形态会被模块链接期失败淹没——本计划 Task 1 的红即是链接期失败（模块全新，预期如此）；Task 2/3/4 的红必须是**行为断言级**，import 面全部已存在（restart-state 在 Task 1 已落地）。
- vm harness fs stub 扩展为**加法**（既有 stub 字段零改动）；既有 21 例零改动纪律同前役。
- 当前分支 main：开工前确认工作树干净（HEAD ≥ c484b65）。
- 全部任务后停点：`npm run release`（0.12.8 bump/CHANGELOG/tag/publish）、issue #51 回帖关闭、操作记录实机验收指引，均属不可逆公开动作或主人亲自步骤，另等当轮批准。

## 最终验证

- `npm run build` → `npm test`（全绿 exit 0；与基线 2104 对照 + 新增量）
- `npm run typecheck`（0 错误）
- `node --test tests/restart-state.test.mjs tests/restart.test.mjs tests/host-api.test.mjs tests/client-i18n.test.mjs` 单套件复跑（全绿）
- `node --test tests/external-journal.test.mjs tests/external-journal-channels.test.mjs tests/client-render-smoke.test.mjs tests/market-golden.test.mjs`（journal/渲染/golden 零漂移）
- 实机验收（主人可选）：0.12.8 装机后触发一次 `dshm_restart` → 操作记录出现「重启」条目（外部通道）或横幅通知「重启完成」（面板通道）；制造端口占用场景 → 操作记录/横幅呈失败原因
