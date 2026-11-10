# issue #57「会话面双开关」实施计划（ADR-0035，目标 0.12.14）

## 目标

为 dsh-m 的两个会话注入面各加一个默认开启的 live 设置开关，关闭后**新会话**即时生效：

1. `sessionTools`（boolean，缺省 true）：8 个 `dshm_*` agent 工具经 `when` 谓词门控注册；
2. `sessionPrompt`（boolean，缺省 true）：`tool:dshm` 系统提示词段 text 改函数、按级联真值表返回空段；
3. 级联：`sessionTools=false ⇒ 提示词段强制不注入`（三个可达态：全开/仅工具/全关，见 ADR-0035）；
4. 顺带瘦身提示词段（约 230 词 → 约 60 词，去重依据见 §文案钉死处置表）。

非目标（ADR-0035 已声明）：CLI 开关、per-tool/分组细粒度、提示词文案运行时可配、已发生会话的追溯清洗、client 面任何改动。

## 架构快照

```
设置页（Config schema 自动生成，新增两字段）
  └─ settings 三代通路（wireRegistrySettings：legacy register / forms volatile / unknown 降级）
       └─ store.watch(next=unwrapConfig 全量快照)
            └─ handleExternalWatch：syncCommunityFields 旁新增 session 两字段「仅落键」同步   ← 新
                 （必须置于 registryUrl early-return 之前，否则 ready 态短路跳过同步）
                      ↓ 原地写共享 config 对象（controller.config，host.ts:103 传给 registerTools）
装配期（每次 agent 装配逐步求值）：
  ├─ 8× ctx.tools.register(defineTool({...}), { when: () => sessionToolsEnabled(cfg) })
  │    宿主 dsh-tools：:551 when 逐步求值 / :533 谓词非空 → 工具不进可见视图（schema 不进装配）
  └─ systemPrompt 段 text: () => resolveSessionPromptText(cfg)
       宿主 dsh-system-prompt：:389 函数 text 每次装配求值 / :119 空段被 renderPrompt 过滤（评审批 4 澄清：现场函数名 renderPrompt，行为同）
零 disposer、零重注册；unknown settings 形态降级无 watch → 开关变化需插件重载（文档如实标注）。
```

## 全局约束

- **TDD 红先**：每任务先落新测试跑红（core 测试从 `lib/core/*.js` 构建产物引入，跑前必 `npm run build`），再实现转绿；红的前提写进任务。
- **源锚形态**：盘上源文件 CRLF——单行锚禁含 `\n`；计数用 needle 全文出现次数（`src.split(n).length - 1`），不用 `grep -c` 行数语义；过滤管道一律 `set -o pipefail`。
- **计划外不夹带**：diff 逐文件可归因到任务；`src/client/`、`src/cli.ts`、`scripts/`、`registry.json` 零改动。
- **文案钉死**：§文案钉死的瘦身文本与两字段设置描述按字面实现（R1 评审点，审阅通过即定稿）。
- **仅落键惯例**：watch 同步 `if (next.sessionX !== undefined) config.sessionX = next.sessionX`，缺字段广播不落 undefined 键（mirror `userDisabled`）。
- **发版与回帖单独请批**：`npm run release` 与 issue #57 回帖属不可逆公开动作，执行到二者前停下等主人确认（AGENTS.md 规则）。
- 归一化口径：`cfg?.sessionX !== false`（undefined = 开，兼容缺省传播边界）。

## 输入工件

| 工件 | 位置 |
|---|---|
| ADR-0035（决策与理由，含 CLI 不加开关存档） | `docs/adr/0035-session-tools-and-prompt-switches.md` |
| 注入点现场 | `src/tools.ts` systemPrompt 注入块（`ctx.inject(['systemPrompt'], …)`，段 `tool:dshm`、order 211）与 8 处 `ctx.tools.register(defineTool({...}))` |
| live config 共享对象 | `src/host.ts`（`registerTools(ctx, controller.config, …)`）+ `src/core/registry-controller.ts`（`handleExternalWatch` / `syncCommunityFields`） |
| 宿主机制证据（2026-11-10 checkout 实证） | dsh-tools lib/index.js :533/:551（when）、dsh-system-prompt lib/index.js :120/:389（text 函数/空段过滤）、settings-compat.ts :135/:166/:187（三代 watch 全量快照） |
| 断言面清点（2026-11-10 现场） | tests/ 对提示词段文本零锚（`tool:dshm\|Plugin categories\|order: 211\|personal marketplace\|never claim` 0 命中）；`register` 单参桩忽略第二参——全仓 **13 处**（market 7、tools-install 4、tools-restart 1、tools-search 1，`register: (t)` 字面量 grep 实测；工具桩 sites 含 tools-search:49、tools-install:20/103/196/264、tools-restart:18、market:617/689 等）；registry-controller.test.mjs watch fixture 广播 `{...value}` 全量 config（:45/:63） |

## 文件结构与职责

- Create: `src/core/session-gate.ts` —— 门控纯逻辑单一事实源（归一化、级联真值表、瘦身文本常量、段名/序常量）
- Create: `tests/session-gate.test.mjs` —— 纯逻辑真值表 + tools.ts 接线断言（捕获桩）
- Modify: `src/host.ts`（Config 接口 + schema 两字段，沿 `communityCatalog` 的 `live()` 包装同款）
- Modify: `src/core/registry-controller.ts`（`handleExternalWatch` 增两字段仅落键同步）
- Modify: `src/core/registry.ts`（`RegistryConfig` 接口加 `sessionTools?`/`sessionPrompt?` 可选字段——registry-controller.ts 经 `./registry.js` import 消费，不加则 Task 3 build TS2339）
- Modify: `src/tools.ts`（8 处 register 加第二参 options + systemPrompt 块 text 改函数/常量引用）
- Modify: `tests/registry-controller.test.mjs`（新增 watch 同步用例，沿用既有 fixture 风格）
- Modify: `CHANGELOG.md`、`README.md`（0.12.14 双语条目 + 会话开关用法段）

任务依赖：Task 1 →（Produces 门控 API）→ Task 4；Task 3 →（Produces 同步链）→ Task 4 的 live 语义实机验证；Task 2/3 相互独立；Task 5 收口；Task 6/7 文档与发版准备；Task 8/9 受批准门。

## 任务清单

### Task 1: session-gate.ts 纯逻辑模块（TDD）

- 目标：建立门控单一事实源模块。
- 涉及文件：Create `tests/session-gate.test.mjs`、`src/core/session-gate.ts`
- 接口契约：
  - Consumes: 无（新模块）
  - Produces: `sessionToolsEnabled(cfg)` / `sessionPromptEnabled(cfg)` / `resolveSessionPromptText(cfg)` / `SLIM_PROMPT_SECTION` / `SESSION_PROMPT_SECTION_NAME`（='tool:dshm'）/ `SESSION_PROMPT_SECTION_ORDER`（=211）/ `interface SessionGateConfig { sessionTools?: boolean; sessionPrompt?: boolean }`（Task 4 消费）
- 验证范围：`npm run build && node --test tests/session-gate.test.mjs`

- [ ] Step 1: 写失败测试——`tests/session-gate.test.mjs`：
  - T1 归一化：`sessionToolsEnabled(undefined)===true`；`({})===true`；`({sessionTools:false})===false`；`({sessionTools:true})===true`
  - T2 级联真值表：`resolveSessionPromptText` 五态——undefined→SLIM；`{sessionTools:true,sessionPrompt:true}`→SLIM；`{sessionTools:false,sessionPrompt:true}`→`''`；`{sessionTools:true,sessionPrompt:false}`→`''`；均 false→`''`
  - T3 文本锚：SLIM 含 `'dshm_restart'`、`'web_search'`、`'desktop'`（split 计数 ≥1）
  - T4 常量：`SESSION_PROMPT_SECTION_NAME==='tool:dshm'`、`SESSION_PROMPT_SECTION_ORDER===211`
  - import 自 `../lib/core/session-gate.js`
- [ ] Step 2: 跑红——`npm run build && node --test tests/session-gate.test.mjs`
  - Expected: import 失败（模块不存在 ERR_MODULE_NOT_FOUND）= 红
- [ ] Step 3: 写最小实现——`src/core/session-gate.ts`（归一化 `!== false`、级联 `sessionToolsEnabled(cfg) && cfg?.sessionPrompt !== false`、SLIM 文本按 §文案钉死逐字、常量导出）
- [ ] Step 4: 跑绿——同 Step 2 命令
  - Expected: 全用例 pass，exit 0

### Task 2: host.ts Config schema 两字段

- 目标：设置页出现两开关字段（缺省 true，live 语义）。
- 涉及文件：Modify `src/host.ts`（`Config` 接口 + `Config` schema，紧随 `communityCatalogPin` 字段）；Modify `src/core/registry.ts`（`RegistryConfig` 接口加两可选字段，与 host Config 平行声明类型面）
- 接口契约：
  - Consumes: 既有 `live()` 包装（host.ts，0.1.7 volatile 兼容）
  - Produces: schema 字段 `sessionTools`/`sessionPrompt` + `RegistryConfig` 同名可选字段（Task 3 的 watch 通路与类型面、Task 4 的 cfg 读取消费）
- 验证范围：typecheck + 结构探针

- [ ] Step 1: 写失败探针——访问器按基线产物复跑钉死：`m.Config.refs` 为 undefined，定义直接挂 `dict[k].meta`（既有字段 `dict['communityCatalog'].meta = {default:true,…,volatile:true}`，评审批 2 与执行方复跑双确认）：
  `node --input-type=module -e "import('./lib/host.js').then(m => { const d = m.Config.dict ?? {}; for (const k of ['sessionTools','sessionPrompt']) { const f = d[k]; if (!f) { console.error('missing', k); process.exit(1) } if (f.meta?.default !== true) { console.error('default!=true', k); process.exit(1) } if (f.meta?.volatile !== true) { console.error('not-volatile', k); process.exit(1) } } console.log('ok') })"`
  （从仓库根跑，`import('./lib/host.js')` 指 lib 构建产物；volatile 断言顺带钉死 live() 语义）
  - Expected 红（区分两态）：路径错/产物缺失 = ERR_MODULE_NOT_FOUND；字段缺失 = `missing sessionTools` + exit 1
- [ ] Step 2: 实现——host.ts 接口加 `sessionTools?: boolean`、`sessionPrompt?: boolean`；registry.ts `RegistryConfig` 加两同名可选字段；schema 加（文案按 §文案钉死逐字）；顺带修正 host.ts:20 过时注释「dshm_* 七个工具」→「八个」（该行紧邻本次 `inject` 导出修改面，评审计划外建议 a 收编）：
  - `sessionTools: live(Schema.boolean().default(true).description('会话工具：关闭后新会话不再提供 dshm_* 工具（即时生效）；市场页面与 dshm 命令行不受影响'))`
  - `sessionPrompt: live(Schema.boolean().default(true).description('会话提示词引导：关闭后新会话不再注入 dshm 用法段，工具仅在显式要求时使用；会话工具关闭时本项不生效'))`
- [ ] Step 3: 跑绿——同 Step 1 探针（`ok` + exit 0，含 default=true 与 volatile=true 断言）+ `npm run typecheck`（覆盖 host.ts 与 registry.ts 两处类型面）
  - Expected: `ok`；typecheck 0 错误

### Task 3: registry-controller watch 同步（仅落键）

- 目标：settings 翻转后 session 字段原地进入共享 config（live 生效链）。
- 涉及文件：Modify `tests/registry-controller.test.mjs`、`src/core/registry-controller.ts`（`handleExternalWatch`）
- 接口契约：
  - Consumes: Task 2 的字段名（host Config schema + `registry.ts` `RegistryConfig` 类型面）；既有 watch fixture（watchers 广播 `{...value}` 全量 config）
  - Produces: `handleExternalWatch` 同步行为（Task 4 live 语义、V5 实机验证依赖）
- 验证范围：`npm run build && node --test tests/registry-controller.test.mjs`

- [ ] Step 1: 写失败测试——断言出口已钉死（执行期修正）：controller 内部 `const config = { ...initial }` **拷贝**传入对象（registry-controller.ts :117），「共享」发生在 controller→tools 方向而非调用方→controller——断言打 `controller.config` 公开 readonly 访问器（:53/:393，即 registerTools 实际收到的同一对象）；watch 注入口用本文件既有 `fakeStore.externalWrite(patch)`（同文件顶层 fixture，守卫跨 describe 闭包禁令）。**异步冲刷：fixture 广播走 `queueMicrotask`（:45/:63），每次 externalWrite 后必须 `await sleep(30)` 再断言（沿本文件 sleep(30) 先例 :306/:323/:356），同步断言落空 = 永红**：
  - A（placement 关键态）：`const cfg = {}` → `createRegistryController(cfg)` → `attachStore(fs.store)` → `await controller.snapshot()`（ready 态）→ `fs.externalWrite({ sessionTools: false })`（registryUrl 未变 = 走 early-return 路径）→ `await sleep(30)` → 断言 `cfg.sessionTools === false`
  - B（仅落键）：`fs.externalWrite({})`（广播不含 session 字段）→ `await sleep(30)` → 断言 `cfg.sessionTools` 仍为 `false`（不被改写为 undefined）
  - C：`fs.externalWrite({ sessionTools: true, sessionPrompt: true })` → `await sleep(30)` → 断言两键均为 `true`
- [ ] Step 2: 跑红——`npm run build && node --test tests/registry-controller.test.mjs`
  - Expected: 用例 A 失败（`cfg.sessionTools` 为 undefined ≠ false）= 红
- [ ] Step 3: 实现——`handleExternalWatch` 内 `syncCommunityFields(next)` 调用点旁新增：
  - `if (next.sessionTools !== undefined) config.sessionTools = next.sessionTools`
  - `if (next.sessionPrompt !== undefined) config.sessionPrompt = next.sessionPrompt`
  - 位置在 `lastSelfWrite` 判断与 registryUrl early-return **之前**
- [ ] Step 4: 跑绿——同 Step 1 命令 + `node --test tests/settings-compat.test.mjs`（既有套件零漂移）
  - Expected: 两文件全绿

### Task 4: tools.ts 接线（when 谓词 + 段 text 函数）

- 目标：8 工具与提示词段按开关与级联门控。
- 涉及文件：Modify `tests/session-gate.test.mjs`（追加接线用例）、`src/tools.ts`
- 接口契约：
  - Consumes: Task 1 全部导出；Task 3 的同步链（live 语义）
  - Produces: 完整门控行为（Task 5 收口、V1-V4 实机验证依赖）
- 验证范围：`npm run build && node --test tests/session-gate.test.mjs`

- [ ] Step 1: 追加失败测试（捕获桩）：
  - T5 工具门：`const registered = []; ctx = { tools: { register: (t, o) => registered.push([t, o]) }, inject: () => {} }`；`registerTools(ctx, cfg, deps)` → `registered.length===8` 且每项 `[1]?.when` 为函数；`when()` 随 cfg 翻转（`{sessionTools:false}`→false、undefined→true）
  - T6 段门：`const captured = []; ctx.inject = (deps, cb) => cb({ systemPrompt: { section: (s) => captured.push(s) } })` → 收到 `{ name: 'tool:dshm', order: 211, text: fn }`；`fn()` 两态返回 SLIM / `''`
- [ ] Step 2: 跑红——同 Task 1 验证命令
  - Expected: T5 失败（现产物 register 单实参，`[1]` 为 undefined）；T6 失败（text 为字符串非函数）
- [ ] Step 3: 实现——`src/tools.ts`（执行期偏离已证实并收编：dsh-tools 0.2.2-rc.1 **运行时**支持 `register(definition, options)`（lib/index.js :433）但**类型声明滞后单参**（types/index.d.ts:636）→ 直呼二参 TS2554，改经模块级 `registerGated(ctx, definition, when)` helper（内含唯一一处运行时契约窄化 cast + `.call(ctx.tools, …)` 保 this；`ctx.tools.register` 全文件仅存于此 helper））：
  - 8 处 `ctx.tools.register(defineTool({...}))` → `registerGated(ctx, defineTool({...}), () => sessionToolsEnabled(cfg))`（**冻结面 diff 归因约束**：defineTool 第一直参逐字节不动、8 个 description 字面零改动——「工具面与 0.12.13 逐字节一致」承诺的可查锚；宿主机理支撑：when 恒 true 时 admitted 收纳同一 definition 对象引用，dsh-tools :560，缺省态工具面同物）
  - systemPrompt 注入块：`text` 由 `[...].join(' ')` 改为 `() => resolveSessionPromptText(cfg)`；`name`/`order` 改引 `SESSION_PROMPT_SECTION_NAME`/`SESSION_PROMPT_SECTION_ORDER`；删除原 7 行文本与 `PRIMARY_CATEGORY_LABELS` 在该块的引用（其余引用点不动——该符号全仓 4 处：import、`categoryLabelOf`、dshm_search category 参数描述、注入块动态行；删块后仍 3 处在用，无 unused/typecheck 隐患）
- [ ] Step 4: 跑绿——本文件 + 既有工具套件零漂移：`set -o pipefail; node --test tests/session-gate.test.mjs tests/tools-search.test.mjs tests/tools-install.test.mjs tests/tools-restart.test.mjs tests/market.test.mjs 2>&1 | tail -20`（管道只影响显示，退出码以 node --test 为准）
  - Expected: 全绿

### Task 5: 全量门禁 + 关键锚变异自证

- 目标：收口验证 + 评审检查单要求的变异留证。
- 涉及文件：无新改动（验证任务）
- 接口契约：Consumes: Task 1-4 全部产物
- 验证范围：全量测试 + typecheck + 变异记录落盘

- [ ] Step 1: `npm test`（pretest 自动 build）
  - Expected: 全部套件 pass，exit 0
- [ ] Step 2: `npm run typecheck`
  - Expected: 0 错误
- [ ] Step 3: 变异自证（单点改坏 → 红 → 恢复 → 绿，输出落盘 `../01_docs/dsh-m-issue57-mutation-log.md`——私有 01_docs，不入库）：
  - M1：`session-gate.ts` 级联条件去掉 `sessionToolsEnabled` 短路 → T2 红
  - M2：`registry-controller.ts` 同步移到 early-return 之后 → Task 3 用例 A 红（ready 态短路复现）
  - M3：任一工具 `when` 恒 true → T5 红
  - Expected: 每次变异红、恢复绿，三次记录齐全

### Task 6: 文档（CHANGELOG 双语 + README 用法段）

- 目标：0.12.14 条目与用户文档。
- 涉及文件：Modify `CHANGELOG.md`（双语两区块各 prepend 一条）、`README.md`（会话工具开关段，位置随现场结构定，含三态语义表 + unknown 形态降级说明 + 「已发生会话不追溯清洗」说明）
- 接口契约：Consumes: Task 1-5 定稿行为
- 验证范围：CHANGELOG/README 出现次数探针（见 Step 3）

- [ ] Step 1: 写 CHANGELOG 双语条目（中文在前英文在后，同版本号对齐；**四段惯例**：背景=issue #57，做法=双开关+级联+瘦身，**测试**=「全量 npm test + typecheck 0」沿惯例字样——**不写 N/N**，check-release :113-124 计数新鲜度门见「全量 N/N」主张即门禁内实跑全量测试（~100s/次），兼容性=提示词段文本有意变更+两新字段纯新增面+unknown 形态降级重启语义（回退面=revert 实现提交+版本递增））
- [ ] Step 2: 写 README 会话工具开关段
- [ ] Step 3: 验证探针（`set -o pipefail`）：CHANGELOG 双语区块各含 `### 0.12.14` 头——`grep -F -c '### 0.12.14' CHANGELOG.md` 结果 = 2（### 头独占一行，行计数≡出现计数——全局约束「不用 grep -c 行数语义」在此特例下等价成立）；README 含 `sessionTools` 字面量（split 计数 ≥1）
  - Expected: 两探针达标（`npm run check-release` 全绿在 Task 7 bump 后收口；`tests/check-release-metadata.test.mjs` 是提交身份门、与 CHANGELOG 无关，不引用）

### Task 7: 发版准备（bump + 发版提交 + 本地 tag；release 本体另批）

- 目标：树内处于可发版状态。两个门禁事实决定本任务形态（评审批 3 实证）：①check-release 的 tag=HEAD 门要求本地 tag 先行（脚本头用法明文「bump 版本 → 建 tag → `npm run check-release` → push」）；②release.mjs 干净树检查（:50）要求 bump/CHANGELOG/lock 改动**已提交**。
- 涉及文件：Modify `package.json`（0.12.13→0.12.14）、`package-lock.json`（`npm install --package-lock-only --ignore-scripts` 同步根两字段）；`locale/` 无版本键（0.12.13 起即不落键，评审批 3 事实补充），不涉及
- 接口契约：Consumes: Task 6 CHANGELOG 双语顶条；Produces: 干净树 + 本地 tag `v0.12.14` 指向 HEAD（Task 8 release.mjs `git tag -f` 幂等重钉兼容）
- 验证范围：`npm run check-release`
- [ ] Step 1: bump `package.json` → lock 同步 → **发版提交**（package.json/package-lock.json/CHANGELOG 一并纳入）→ `git tag -f v0.12.14`（纯本地、指向已提交 HEAD——规避 2026-11-01「tag 落缺 registry.json 提交」实录；release.mjs 侧 `git tag -f v${version}` 幂等重钉，AGENTS.md「不要手动打 tag」指勿绕过 release 手动推远端 tag，本地门禁前置 tag 是 check-release 脚本头用法明文）
- [ ] Step 2: `npm run check-release`
  - Expected: 门禁全绿（版本三处一致/双语顶条配对/tag=HEAD/发布物断言；测试计数门因顶条无「全量 N/N」主张而跳过实跑）。**不执行 release**——push/publish 等主人当轮批准（Task 8 批准门）

### Task 8: 发版（⛔ 批准门）

- 目标：发布 0.12.14。
- [ ] Step 1: **停下请批**——获主人当轮明确批准后：`npm run release`（release.mjs 人工前置三项已由 Task 6/7 满足：版本三处 bump、CHANGELOG 双语顶条、npm test 全绿；脚本内自动依次 lock 同步→干净树检查→push 预检→`git tag -f` 幂等重钉→check-release→push main→push tag）
- [ ] Step 2: npm 上架轮询（agent-ops「发版与 npm 轮询」口径）
  - Expected: registry 可查 0.12.14

### Task 9: 实机验证 + issue 回帖（⛔ 批准门）

- 目标：装回本机按 V1-V5 定义表逐项验证 + 交付回帖草案送审。
- [ ] Step 1: 升级 + **生效步骤**——本机 dsh-m 升级到 0.12.14。dsh-m 改动含 host 入口（host.ts/tools.ts），activation=restart-required：宿主进程 ESM import 缓存使「只升级不重启」时全部验证对着 0.12.13 旧代码跑（假绿）。**禁在会话内当轮直接 restart（腰斩会话）**：宿主重启由主人执行，或执行 Agent 按 know-how 037 分离式姿势（分离上下文走 sudo 系统总线 `sudo systemctl restart deepseek-harness.service`；禁 `systemctl --user`——detached 上下文无 user bus，静默失败 + 健康检查假绿）。
- [ ] Step 2: 生效探针（非恒真——能抓「新代码未生效」；HTTP 200 类健康信号不作数）：①settings 页出现 `sessionTools`/`sessionPrompt` 两字段（0.12.13 无此结构面）；②V1 双字面探针——新会话系统提示词含 SLIM 字面 `route to the dshm_* tools` **且**不含旧段字面 `Finding / recommending / browsing DSH plugins`（旧字面唯一性已核：工具 description 用 find/recommend/browse 斜杠形态，不含该旧段短语；旧代码在场则旧字面在场 → 红）。
- [ ] Step 3: 按 V1-V5 定义表逐项验证并记录（新会话观察）：

| # | 态 | 操作 | 预期 |
|---|---|---|---|
| V1 | 缺省全开 | 升级后不改设置 | 8 工具在列；SLIM 段注入（Step 2 双字面探针过）；除段文本外其余行为同 0.12.13 基线 |
| V2 | 级联全关 | `sessionTools=false` | 工具消失 + 提示词段消失（**无论 `sessionPrompt` 取值**——加验 `sessionPrompt=true` 时段仍缺席，级联钳真值） |
| V3 | 仅工具 | `sessionTools=true, sessionPrompt=false` | 工具在列 + 段消失 |
| V4 | UI/CLI 不受损 | 两开关全关 | 市场页搜索/安装/升级/卸载全功能（/dshm HTTP 通路）；`dshm` CLI 正常；宿主侧 `dshm_toggle` 整插件开关正常 |
| V5 | live | 开关来回翻转 | 新 agent session 逐次反映，无需重启（forms 通路 watch 链；unknown 形态降级例外已在文档声明） |

- [ ] Step 4: 回帖草案（双开关用法、三态语义、版本号，@PrimaryFantasty @Niefee）**另送审**，批准后发布并按主人指示决定 issue 是否关闭（关闭同样单独请批）

## 文案钉死（评审点 R1——审阅通过即定稿，实现逐字照抄）

### 瘦身提示词段全文（SLIM_PROMPT_SECTION）

```text
Plugin marketplace requests (finding / recommending / browsing / installing DSH plugins) route to the dshm_* tools ahead of web_search or bash — each tool's own description carries the confirmation and retry discipline. dsh-m follows the current host profile (web or desktop): on desktop only dshm_restart is refused; relay its guidance instead of retrying.
```

### 现文本 7 行处置表（去重依据 = 8 工具 description 现文，2026-11-10 逐条核对）

| 行 | 内容摘要 | 处置 | 去重证据 |
|---|---|---|---|
| L1 | MUST dshm_search / once per message / keyword / one short sentence / no install commands | 删，留一句路由强化 | `dshm_search` description 逐句携带（ALWAYS / EXACTLY ONCE / AT MOST one short sentence / Do not print install commands） |
| L2 | `Plugin categories: …` 动态行 | 删 | `dshm_search` `category` 参数描述已枚举全部分类 |
| L3 | install 确认 + 重启提及 | 删 | `dshm_install` description（after the user names one / offer dshm_restart） |
| L4 | list/outdated 用途 + upgrade/uninstall 确认 + needsBuildApproval 协议 | 删 | `dshm_list`/`dshm_outdated`（Use when…）、`dshm_upgrade`（确认+activation）、`dshm_install`/`dshm_upgrade`（needsBuildApproval verbatim 协议） |
| L5 | toggle 确认 + live/restart-required | 删 | `dshm_toggle` description（默认先与用户确认 / applied=live / restart-required） |
| L6 | restart 纪律 | 删 | `dshm_restart` description（ONLY call after the user agrees） |
| L7 | web/desktop profile 差异 | 保留压缩 | 段独有跨工具策略 |

评审要点：①路由句强度（原 `you MUST … never` vs 候选 `route to … ahead of`——description 已带 ALWAYS，是否仍需施压）；②desktop 句取舍（原文枚举 desktop 可用的五类操作 vs 候选只留「仅 restart 被拒+转述不重试」）。

## 执行纪律

- 开始实现前先批判性复查本计划；发现缺项/矛盾/命名不一致/验证命令无效先修计划再动工。
- 按任务顺序执行，不无声跳步、合并或改目标；每任务完成即跑该任务验证。
- 遇阻、重复失败或计划与仓库现实不符（如 Task 3 Step 1 的断言取口与现场接口不符）立即停下说明，不猜。
- Task 8/9 为批准门：未获当轮明确批准不执行 release/回帖/关 issue。

## 最终验证

- `npm test` 全绿 + `npm run typecheck` 0 错误 + `npm run check-release` 门禁绿（Task 7 后）
- 实机 V1-V5 逐项通过（Task 9）
- 行为零变化承诺（缺省态）：工具面 schema/执行/输出与 0.12.13 逐字节一致（`when` 缺省恒 true）；提示词段文本有意变更（§文案钉死）；市场页 UI 零变化（零 client 改动）；设置页新增两字段行

## 审阅 Checkpoint

实施计划已写好并保存到 `docs/plans/2026-11-10-issue57-session-switches-implementation-plan.md`（ADR-0035 为设计存档；此前误写的 specs/-design 文件已删除、内容并入本计划）。请先确认这份计划——**特别是「文案钉死」节的瘦身文本定稿（评审点 R1：路由句强度与 desktop 句取舍）**；如果没问题，下一步可按计划由普通编码 agent 或人工继续执行。
