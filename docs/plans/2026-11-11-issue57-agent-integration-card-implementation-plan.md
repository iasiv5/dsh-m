# issue #57「AI 会话集成卡」实施计划（会话注入开关收编面板，目标 0.12.15）

## 目标

把 `sessionTools` / `sessionPrompt` 两个会话注入开关从「宿主自动生成设置卡（用户找不到）」收进市场面板自己的「设置」tab，新增**「AI 会话集成」通宽卡**：

1. 卡内两行开关（Agent 工具 / 系统提示词注入），级联锁定态可视（tools off ⇒ prompt 开关锁定 + 白话 hint）；
2. 写入走新 `set-session` 路由（仿 `set-community`：内存即时 + store 持久化 + 失败回滚），live 链零改动复用；
3. `session-toggle` 操作记录（成败皆记，客户端 `recordSettingsOp` 直落，对齐 `community-toggle` 口径）；
4. Config schema 两字段加 `.hidden()` meta 收敛为面板单入口（真机验证 + 已定义 fallback）；
5. README「级联」白话扫除 + GLOSSARY 三词条（已落盘，见输入工件）。

非目标：其余三卡（社区/精选/关于）与操作记录卡零改动；`dshm` CLI 零改动；持久化形态零迁移（仍走 Config → unwrapConfig → watch 链）；不改 V1-V5 已验证的装配语义。

## 架构快照

```
面板「设置」tab（dshm-settings-grid 四卡流）
  └─ 新增 child 4「AI 会话集成」通宽卡（CSS 新增 nth-child(4) 通宽规则，其余断点规则零改动）
       ├─ 开关行 1：Agent 工具（dshm_*）  → api("set-session", { sessionTools })
       ├─ 开关行 2：系统提示词注入        → api("set-session", { sessionPrompt })
       │    └─ 级联锁定：cfg.sessionTools === false 时行 2 switch 渲染 locked + hint
       └─ 读写数据源 = registry-config 响应里的 controller.config（0.12.14 已含 session 两键）
写入链（面板）：
  set-session 路由 → controller.setSessionFields(patch)（内存原地 + 失败回滚内存）
    → RegistrySettingsStore.update(patch)（store 持久化，签名放宽收编两字段）
    → store watch 广播（经真实 unwrapConfig）→ handleExternalWatch 仅落键同步（0.12.14 已就位）
    → 装配期谓词/段函数读到新值 → 新装配生效
宿主设置卡：Config 两字段加 .hidden(true)（schemastery 标准 meta，guarded 兼容 ≤0.1.5）→ 真机验证是否被
  设置卡渲染器尊重；不尊重则回退保留双入口 + 文档标注（决策已在设计简报 D2 定稿）
```

## 全局约束

- **TDD 红先**：core/host-api 任务先落失败测试（跑前 `npm run build`）；client 渲染锚走 SSR 冒烟文件（`tests/client-render-smoke.test.mjs` 直接引 `src/client/`，跑前也 build）。
- **源锚形态**：CRLF 单行锚禁含 `\n`；计数用 needle 全文出现次数（`split(n).length - 1`）；过滤管道 `set -o pipefail`。
- **计划外不夹带**：diff 逐文件可归因；`src/cli.ts`、`scripts/`、`registry.json`、其余三卡 DOM 零改动。
- **计数纪律**：引用测试/套件计数必附文件组合（如「host-api 71 + tools-search 13 = 84」）——评审批 4 I-3 教训收编。
- **P1 教训收编**：路由/集成测试必须走真实生产通路——`set-session` 路由测试打真 dispatcher；涉及 unwrapConfig 广播形态的测试用「广播包真实 unwrapConfig」镜像（0.12.14 已有先例用例可直接参照）。
- **文案钉死**：§文案定稿（C' 版）逐字实现（主人 2026-11-11 确认）；i18n ZH/EN 同步（client-i18n 守卫）

## 文案定稿（钉死，C' 版 2026-11-11 主人确认）

| 位置 | 文案 | i18n 键 |
|---|---|---|
| 卡片标题 | AI 会话集成 | `settings.agent.title` |
| 开关 1 标签 | 会话工具（AI 助手操作插件） | `settings.agent.tools` |
| 开关 1 描述 | 关闭后，AI 助手在新对话中将无法帮你搜索、安装、升级插件；市场页面与 dshm 命令行不受影响 | `settings.agent.tools.desc` |
| 开关 2 标签 | 系统提示词引导 | `settings.agent.prompt` |
| 开关 2 描述 | 关闭后，AI 的新对话不再附带这段插件使用引导；工具仅在你明确要求时使用 | `settings.agent.prompt.desc` |
| 级联锁定 hint | 会话工具已关闭，本开关随之一并关闭 | `settings.agent.prompt.cascade` |
| 操作记录类型名 | 会话注入开关 | `op.kind.session-toggle` |

术语注：卡面文案面向大众（无 Agent / 注入 / 级联行话）；「系统提示词引导」为主人指定保留的术语；内部术语「会话注入开关 / 注入三态 / 级联钳制」见 GLOSSARY.md（已落盘）。EN 译随实现（双语同步纪律）。操作记录行文案派生规则钉死：**取开关主标签（不带括号副标）+ 状态词**——「会话工具已关闭/已开启」「系统提示词引导已关闭/已开启」（评审批 3 H 项修正：旧示例「Agent 工具已关闭」为 C 前口径，作废）。
- **发版与回帖单独请批**：`npm run release`、issue #57 回帖属不可逆公开动作，执行到二者前停下等主人确认。
- 归一化口径：`cfg.sessionX !== false`（undefined = 开）——与 0.12.14 装配谓词一致。

## 输入工件

| 工件 | 位置 |
|---|---|
| 设计简报（主人确认稿） | 本对话 2026-11-11「设计简报（shape 定稿）」节 + 本轮四问裁决（Q1=(a)、Q2=(a)、Q3=修正版文案表、Q4=GLOSSARY 三词条已落盘） |
| 既有先例：开关 + 记录 + 路由 | `src/client/settings-tab.jsx`（communitySwitch :171-180 `dshm-switch`/`locked` 形态；:140 notify；`recordSettingsOp` 调用点）；`src/core/host-api.ts` `set-community` :861-866（干净路由先例）；`tests/host-api.test.mjs` :541-556（set-community 路由测试 + callApi 模式） |
| GLOSSARY 三词条（本轮已落盘） | `GLOSSARY.md`「会话注入开关 / 注入三态 / 级联钳制」（运行相位词条之后） |
| 会话字段数据面（0.12.14 已就位） | `src/core/registry-controller.ts` handleExternalWatch 仅落键同步；`src/core/settings-compat.ts` unwrapConfig 白名单（0.12.14 P1 修复）；`RegistryConfig` 两字段（registry.ts） |
| P1/P2 教训 | .dsh-research/issue57-exec-review-scratch/ledger.md（夹具假绿形态、生产通路测试纪律） |

## 文件结构与职责

- Modify: `src/core/registry-controller.ts` —— `RegistrySettingsStore.update` patch 类型放宽（+`sessionTools?`/`sessionPrompt?`）；新增 `setSessionFields(patch)` controller 方法（setCommunity 同款：内存原地 + store.update + 失败回滚内存并抛错）；RegistryController 接口同步
- Modify: `src/core/host-api.ts` —— 新增 `set-session` case（body 校验至少一个 boolean 字段，空/全非 boolean → 400）
- Modify: `src/core/settings-compat.ts` —— `RegistrySettingsStore` 接口同款 patch 类型放宽（若类型在此声明；以现场为准，接口在 registry-controller.ts :33-38）
- Modify: `src/host.ts` —— Config schema 两字段追加 `.hidden(true)`（guarded helper `hide()`，镜像 `live()` 的旧版兼容形态）
- Modify: `src/client/settings-tab.jsx` —— 新增「AI 会话集成」通宽卡（两开关行 + 描述 + 级联锁定 + notify）；`recordSettingsOp` 记录接入归 Task 4
- Modify: `src/client/i18n.js` —— ZH/EN 两字典新增卡文案与 `op.kind.session-toggle` 键
- Modify: `src/client/styles.js` —— 新增 `.dshm-settings-grid>.dshm-section:nth-child(4){grid-column:1/-1}`（≤760 已有单列规则自动覆盖）
- Modify: `src/client/operations.js` —— `OpKind` typedef 联合类型加 `'session-toggle'`（:56/:63 两处）
- Test: `tests/host-api.test.mjs`（set-session 路由用例，callApi 模式）
- Test: `tests/registry-controller.test.mjs`（setSessionFields 用例：内存即时 + store.update 调用 + 失败回滚）
- Test: `tests/client-render-smoke.test.mjs`（新卡 SSR 渲染锚）
- Test: `tests/client-i18n.test.mjs`（自动守卫，键缺失即红）
- Modify: `README.md`（「级联」白话扫除一行）、`CHANGELOG.md`（0.12.15 双语四段）

任务依赖：Task 1 →（Produces controller 方法与路由）→ Task 3；Task 2 →（Produces i18n 键）→ Task 3；Task 4 →（Produces OpKind）→ Task 3 的记录调用；Task 3/4 同文件不同函数可并行；Task 5 独立；Task 6 收口。

## 任务清单

### Task 1: controller.setSessionFields + store 签名放宽（TDD）

- 目标：面板写链的 server 侧——内存原地 + 持久化 + 失败回滚。
- 涉及文件：Modify `tests/registry-controller.test.mjs`、`src/core/registry-controller.ts`
- 接口契约：
  - Consumes: `RegistryConfig` 两字段（0.12.14 已入）；既有 `fakeStore`/真 unwrapConfig 广播夹具
  - Produces: `controller.setSessionFields({ sessionTools?, sessionPrompt? }): Promise<RegistryControllerSnapshot>`（后续 Task 3 消费）；store patch 类型放宽
- 验证范围：`npm run build && node --test tests/registry-controller.test.mjs`

- [ ] Step 1: 写失败测试（沿用既有夹具风格；按文件现状选择 fakeStore 或 unwrapConfig 镜像形态——setSessionFields 内部走 store.update，测试断言三件事）：①`setSessionFields({ sessionTools: false })` 后 `controller.config.sessionTools === false` 且 `fs.updates` 收到该 patch；②空 patch / 全非 boolean → 抛错且零写入；③store.update 抛错 → 内存值回滚（先 set true 再模拟失败 set false → config 仍 true）且异常上抛
- [ ] Step 2: 跑红——`npm run build && node --test tests/registry-controller.test.mjs`
  - Expected: `setSessionFields is not a function` 类失败 = 红
- [ ] Step 3: 实现——`RegistrySettingsStore.update` patch 类型放宽两字段（**透传事实修正** per 评审批 2 D：legacy 与 forms 两 store 为 `{...patch}` 透传；**WithoutNs 只读降级 store 的 update 恒抛错**（settings-compat :183-198，`update: async () => { throw }`）——它正是测试③失败回滚路径的真实生产对应：降级形态下 set-session 必然失败回滚 + 面板记 failed，与 set-community 行为同样板，无行为缺口；评审⑤-3 收编：settings-compat :36 接口注释顺带补「0.12.15 起 +session 两字段」一行注释卫生）；controller 新增 `setSessionFields({ sessionTools?, sessionPrompt? })`——**镜像 `setCommunity` 完整形态**（registry-controller :366-388：`if (!bootstrapPromise) startBootstrap()` → `enqueue` + generation guard → `await bootstrapPromise` → 内存先行 → `store.update(patch)` → 失败回滚内存并抛 `RegistryConfigError`、成功 `snapshotInternal()`——**不是裸 async 直改内存**，防绕过任务序列化与 apply/watch 竞态，评审批 2 E）；RegistryController 接口加方法声明
- [ ] Step 4: 跑绿——同 Step 2 命令 + `node --test tests/settings-compat.test.mjs`
  - Expected: 全绿

### Task 2: host-api `set-session` 路由（TDD）

- 目标：面板写链的 HTTP 入口。
- 涉及文件：Modify `tests/host-api.test.mjs`、`src/core/host-api.ts`（`set-community` case 旁）
- 接口契约：
  - Consumes: Task 1 的 `controller.setSessionFields`；callApi 测试模式（:541 先例）
  - Produces: `set-session` 路由（body `{ sessionTools?, sessionPrompt? }`）
- 验证范围：`npm run build && node --test tests/host-api.test.mjs`

- [ ] Step 1: 写失败测试（callApi 模式，镜像 :541）：①`{method:'set-session', sessionTools:false}` → `applied:true` 且后续 `registry-config` 回显 `sessionTools:false`；②空 body → 400；③`{sessionTools:'x'}` → 400
- [ ] Step 2: 跑红——同上命令；Expected: 路由不存在类失败 = 红
- [ ] Step 3: 实现——case 'set-session'：校验 `sessionTools`/`sessionPrompt` 至少一个为 boolean（否则 `ApiProtocolError(400,'至少提供一个 boolean 字段')`）→ `ctx.controller.setSessionFields({…})` → `payload = { applied: true, ...snapshotPayload(snap, cfg()) }`
- [ ] Step 4: 跑绿——本文件全绿 + `node --test tests/tools-search.test.mjs` 零漂移
  - Expected: 全绿

### Task 3: settings-tab「AI 会话集成」卡 + i18n + CSS（TDD）

- 目标：用户可见的控制面。
- 涉及文件：Modify `tests/client-render-smoke.test.mjs`、`src/client/settings-tab.jsx`、`src/client/i18n.js`、`src/client/styles.js`
- 接口契约：
  - Consumes: Task 2 的 `set-session` 路由；既有 `dshm-switch`/`locked` 形态、`recordSettingsOp`、`api`/`lookup`/`notify`
  - Produces: 用户可见控制面（Task 6 CHANGELOG 引用；实机 V 探针对象）
- 验证范围：`npm run build && node --test tests/client-render-smoke.test.mjs tests/client-i18n.test.mjs`

- [ ] Step 1: 写失败渲染锚（评审批 1 A 项修正后的形态——现场亲核：client-render-smoke **无任何 SettingsTab SSR 用例**，settings tab 经 main.jsx 条件挂载，既有 SSR 树不含设置卡输出；且 hooks 的 api 调用在 useEffect 内、SSR 不执行 → cfgData 恒 null → 级联锁定态在纯渲染输出中不可触发）：
  **新建 SettingsTab SSR 用例** `renderToString(h(SettingsTab, stubProps))`（SSR 安全——初始态 switch 结构可断言），断言四件事：①渲染输出含「AI 会话集成」标题字面与两个 switch 元素；②**grid child 顺序**（社区→精选→关于→AI 会话集成→操作记录）——钉死插入位置，防「ops-card 失去 :338 last-child margin 几何漂移」与「新卡 nth-child(5) 无通宽规则命中」两类错位；③**级联锁定态走源码锚**：settingsTabSrc 含 `sessionTools === false` 判定与 `locked` 类拼接（源码锚先例形态见本文件既有源码字符串锚；两条锚各自单行——条件行与 locked 拼接若不同行，分两条正则防 CRLF 跨行锚假绿，评审批 2 提醒收编）；④**冻结面守卫**：同一 SSR 树断言既有四卡特征字面在场（「社区清单」「精选清单」「关于」标题 + ops 卡特征类名）——settings tab 三卡 DOM 此前零守卫（评审批 3 I 项），新用例一次性补齐永久防线。i18n 守卫文件自动校验 ZH/EN 键齐备
  - 注：先查 client-render-smoke 现有 settings-tab 用例形态（读该文件现状再落锚——引用测试锚先读）
- [ ] Step 2: 跑红——`npm run build && node --test tests/client-render-smoke.test.mjs`
  - Expected: 新锚断言失败 = 红
- [ ] Step 3: 实现——
  - i18n.js：ZH/EN 各加键（§文案表逐字；EN 随译；另加 `op.kind.session-toggle`）
  - settings-tab.jsx：`dshm-settings-grid` child 4（OperationsCard 之前）插入「AI 会话集成」卡——两开关行（label + 描述 + `dshm-switch`，复用既有 switch 渲染形态）、级联锁定（`cfg.sessionTools === false` 时行 2 switch 加 `locked` 类 + 级联 hint，**checked 绑定 = 存储值 `cfg.sessionPrompt !== false`——级联只锁交互不锁显示，Q1=(a) 的落地句，评审批 3 G 项**）、notify（成功/失败）、cfgData 读取扩展 session 两键。**初始化与显示判定一律 `!== false`（undefined = 开）——禁止镜像 communityOn 的 `=== true` 形态**（settings-tab :46 先例是「默认关」字段的写法；session 字段缺省开，镜像即把旧配置 undefined 显示成「关」，与装配语义相反——评审批 1 C 项）。**本 Task 不含操作记录调用**——开关翻转 handler 留出记录挂钩点，Task 4 完成后接入（同文件两 Task 顺序执行，避免交错）
  - styles.js：`.dshm-settings-grid>.dshm-section:nth-child(4){grid-column:1/-1}`
- [ ] Step 4: 跑绿——渲染锚 + i18n 守卫 + `node --test tests/client-i18n.test.mjs`
  - Expected: 全绿

### Task 4: `session-toggle` 操作记录（客户端直落）

- 目标：设置类变更可回看（DESIGN §2.6 口径对齐）。
- 涉及文件：Modify `src/client/operations.js`（OpKind typedef :56/:63）、`src/client/i18n.js`（`op.kind.session-toggle`）、Task 3 的 settings-tab 记录调用
- 接口契约：
  - Consumes: `recordSettingsOp` 既有调用先例（settings-tab community toggle 处，:140 附近——实现时先读现场镜像其参数形态）
  - Produces: 操作记录卡可见 `session-toggle` 条目（成败皆记）
- 验证范围：operations 两测试文件任一（`client-operations-view` = opRowVm 所在，实际落点；或 `client-operations`）+ `client-i18n`——执行评审⑤-a 收编

- [ ] Step 1: 写失败测试——client-operations 既有用例形态：kind `'session-toggle'` 记录的渲染/归组断言（先读 :56 typedef 与既有 community-toggle 用例再落锚）
- [ ] Step 2: 跑红——`node --test tests/client-operations.test.mjs`
- [ ] Step 3: 实现——OpKind 联合 + i18n kind 键 + 记录行渲染规则镜像 community-toggle（成败皆记：成功 done、失败 failed）。**meta 形态钉死**：`meta = { field: 'sessionTools' | 'sessionPrompt', on: boolean }`（评审批 3 H 项；先例 meta={on:enabled} 同族）；记录行文案派生规则钉死：**取开关主标签、不带括号副标**——「会话工具已关闭/已开启」「系统提示词引导已关闭/已开启」
- [ ] Step 4: 跑绿——同 Step 2 命令
  - Expected: 全绿

### Task 5: Config schema `.hidden()` meta

- 目标：宿主自动生成设置卡不再渲染两字段（面板单入口）。
- 涉及文件：Modify `src/host.ts`（Config schema 两字段）
- 接口契约：Consumes: 既有 `live()` guarded 兼容形态（host.ts :36-39 注释）
- 验证范围：schema 探针 + typecheck

- [ ] Step 1: 写失败探针——`node --input-type=module -e "import('./lib/host.js').then(m => { const d = m.Config.dict ?? {}; for (const k of ['sessionTools','sessionPrompt']) if (d[k]?.meta?.hidden !== true) { console.error('not hidden', k); process.exit(1) } console.log('ok') })"`
  - Expected: `not hidden sessionTools` + exit 1 = 红
- [ ] Step 2: 实现——guarded `hide()` helper（镜像 `live()`：`typeof hidden === 'function'` 才调，旧 schemastery 3.18.2 缺方法时静默跳过）+ 两字段套用
- [ ] Step 3: 跑绿——同 Step 1 探针（`ok`）+ `npm run typecheck`
  - Expected: `ok`；typecheck 0 错误
- [ ] Step 4: **真机验证点（fallback 决策）**——发版装机后在宿主设置卡目视确认两字段不再渲染；若渲染器不认 hidden → 按 D2 fallback 移除 hidden meta 保留双入口并在 README 标注主入口（该分支触发时回本计划记录决策）

### Task 6: 全量门禁 + 关键锚变异自证

- 涉及文件：无新改动（验证任务）
- 验证范围：全量测试 + typecheck + 变异记录落盘 `../01_docs/dsh-m-issue57-card-mutation-log.md`

- [ ] Step 1: `npm test`（worktree 或仓库根，后台跑）——Expected: 全绿 exit 0
- [ ] Step 2: `npm run typecheck`——Expected: 0 错误
- [ ] Step 3: 变异自证（单点改坏 → 红 → 恢复 → 绿，输出落盘）：
  - M1：`set-session` 路由校验去掉「至少一个 boolean」→ Task 2 ②③用例红
  - M2：settings-tab 级联锁定源码条件（`sessionTools === false` → `locked`）反转或删除 → Task 3 Step 1 ③**源码锚**红（评审批 1 A 项：SSR 触发不了级联态，锁定态防线只能由源码锚承担）
  - M3：`hide()` helper 去掉 → Task 5 探针红
- [ ] Step 4: 冻结面探针（评审批 3 I 项具体化）——settings-tab.jsx 的 diff 形态判据：**仅允许一段连续插入 hunk（新卡）+ 既有行零 +/-**；styles.js 仅允许一行新增（nth-child(4) 规则）；CLI/scripts/registry.json 零改动。git diff 人工判读按此形状核对，偏离即回查

### Task 7: 文档（README 白话扫除 + CHANGELOG 双语）

- 涉及文件：Modify `README.md`（会话开关段落「并级联关掉提示词引导」→「提示词引导随之一并关闭」，白话扫除）、`CHANGELOG.md`（0.12.15 双语四段：背景=设置卡不可发现（主人反馈），做法=AI 会话集成卡+set-session+session-toggle 记录+hidden 单入口，测试=全量 npm test + typecheck 0（不写 N/N），兼容性=面板新卡纯新增面+宿主设置卡字段隐藏（hidden 不被渲染器尊重时回退双入口）+回退面）
- 验证范围：CHANGELOG `### 0.12.15` 双语 = 2 探针；README 锚
- [ ] Step 1: CHANGELOG 双语条目（随 Task 8 bump 后配对门禁生效）
- [ ] Step 2: README 白话扫除
- [ ] Step 3: 探针（grep -F -c '### 0.12.15' = 2；README 锚 ≥1）
  - Expected: 达标

### Task 8: 发版准备（bump + 发版提交 + 本地 tag + check-release）

- 涉及文件：Modify `package.json`（0.12.14→0.12.15）、`package-lock.json`（`npm install --package-lock-only --ignore-scripts`，`npm_config_cache` 指 `.dsh-research/npm-cache-issue57-release`）
- 接口契约：Consumes: Task 7 CHANGELOG；Produces: 干净树 + 本地 tag `v0.12.15` 指向 HEAD
- 验证范围：`npm run check-release`
- [ ] Step 1: bump → lock 同步 → 发版提交（package.json/lock/CHANGELOG 及全部实现提交物纳入）→ `git tag -f v0.12.15`（本地，幂等；规避 2026-11-01 tag 落错提交实录）
- [ ] Step 2: `npm run check-release`——Expected: 十项全绿。**不执行 release**（Task 9 批准门）

### Task 9: 发版 + 实机复验 + 回帖（⛔ 两次批准门）

- [ ] Step 1: **停下请批**——获当轮批准后 `npm run release`；npm/镜像轮询 0.12.15
- [ ] Step 2: 本机升级 → 实机复验：**面板卡三态轻量验证**（全开=卡在场两开关可翻转；tools 关=行 2 锁定态 + 我方装配工具缺席 + **行 2 仍显示存储值**（Q1=(a) 的实机观察点，评审批 3 G 项）；还原）+ **hidden 真机验证**（宿主设置卡两字段不再渲染；不尊重则走 Task 5 Step 4 fallback）+ ping 版本读数
- [ ] Step 3: issue #57 回帖草案（含面板卡用法 + 截图）**另送审**——**压着等主人对开关位置与新版本的整体发令**，不自行发布

## 执行纪律

- 开始实现前先批判性复查本计划；发现缺项/矛盾/锚漂移先修计划再动工
- 按任务顺序执行；每任务完成即跑该任务验证；遇阻立即停下说明，不猜
- Task 3 Step 1 / Task 4 Step 1 均有「先读现场文件再落锚」要求（引用测试锚先读纪律）
- Task 9 为批准门：回帖与发版未获当轮明确批准不执行

## 最终验证

- `npm test` 全绿 + `npm run typecheck` 0 + `npm run check-release` 十项全绿（Task 8 后）
- 实机：面板卡三态 + hidden 真机 + ping 读数（Task 9 Step 2）
- 行为零变化承诺：其余三卡 DOM/几何/样式零变化（不触碰其渲染路径）；宿主设置卡两字段按 hidden 生效与否如实呈现；CLI/装配语义（V1-V5）零变化——面板只是新增一个写入口，写链终点与 0.12.14 完全相同

## 审阅 Checkpoint

实施计划已写好并保存到 `docs/plans/2026-11-11-issue57-agent-integration-card-implementation-plan.md`（GLOSSARY 三词条已按 domain-modeling 纪律先行落盘）。请先确认本计划——特别是 Task 3 的渲染锚落点（先读现场再定锚的纪律已在任务内声明）与 Task 9 的双批准门顺序；没问题即可由普通编码 agent 或人工执行，发版与回帖到时仍单独请批。

## 修订 R1（2026-11-11 主人裁决）：迁移到官方插件页设置区，面板卡回退

主人实机查看后裁决：面板设置 tab 的卡片是噪声，两开关迁往**官方插件页**（插件 → dsh-m 详情页设置区），摆放参考 dsh-context 插件页的分组设置形态（实机截图解码：Config 平铺字段 + 渲染器按字段名前缀归组 + locale 键 settings.group.<前缀>=组标题、settings.<字段>=字段标签——dsh-context client 字典三组样本实锚）。

回退清单（git checkout v0.12.14 恢复 + 手动编辑混合）：
- 整文件 checkout v0.12.14：settings-tab.jsx / i18n.js / operations.js / operations-view.js / styles.js / client-render-smoke.test.mjs / client-operations-view.test.mjs / host-api.test.mjs / host-api.ts（各文件 v0.12.14 后仅有本役变更，逐文件核实过）
- registry-controller.ts 手动：移除 setSessionFields（接口声明/实现/return 导出）+ store update 签名回宽；**保留** P1 同步、:35 注释卫生（I-1）、无 WithoutNs 变更
- host.ts 手动：移除 hide() 与 live(hide()) 包装（字段本身保留——hidden 移除 = 字段回归插件页，D2 反向定稿）
- registry-controller.test.mjs 手动：删 setSessionFields describe（保留 session watch describe——P1 轮产物）
- host-api.test.mjs 手动：删 set-session 3 用例（checkout 已含——见下）
- 保留不动：session-gate.ts、tools.ts 装配谓词、registry.ts 字段、settings-compat.ts、GLOSSARY、装配语义与级联钳制

新增清单：
- locale/zh.json + en.json：settings.group.session（组标题「AI 会话集成」）、settings.sessionTools / settings.sessionPrompt（字段标签）——渲染器归组/标签约定的实证落点
- README/GLOSSARY/CHANGELOG 0.12.15 条目：入口描述改「官方插件页设置区」

验收（真机）：插件 → dsh-m 详情页设置区出现「AI 会话集成」组 + 两开关；翻转经宿主设置服务 → watch 链 → 新装配生效（V2/V3 语义不变，0.12.14 已实机验证）；市场面板设置 tab 回归三卡。

## 修订 R2（2026-11-11 主人裁决）：开关入口迁移至官方插件页设置区，面板卡回退

主人实机查看后裁决：面板设置 tab 的卡片是噪声，两开关迁往**官方插件页**（插件 → dsh-m 详情页设置区），摆放参考 dsh-context 插件页的分组设置形态（实机截图解码：dsh-context Config 为**平铺字段**、无嵌套分组对象；渲染器按字段名前缀归组，组标题/字段标签来自插件 locale/client 字典键 `settings.group.<组名>` / `settings.<字段>`——三组样本实锚：entry/view/prompt）。

落地（R1 面板卡整体回退 + 官方插件页分组）：
- **回退**（git checkout v0.12.14 八文件 + registry-controller.ts/host.ts 行级手术）：settings-tab 卡与 state/handler/switch、i18n 卡键 12 枚、styles nth-child(4) 规则、set-session 路由、setSessionFields（接口/实现/导出）、store update 签名放宽、session-toggle 记录（OpKind typedef ×2 + operations-view isToggle + op.kind 键 ×2）、hidden meta 与 hide() helper、三测试文件的卡片用例——registry-controller.test.mjs 仅删 setSessionFields describe（保留 P1 轮 session watch describe）
- **保留**：session-gate.ts、tools.ts 装配谓词与级联钳制、registry.ts 字段、settings-compat.ts、unwrapConfig 白名单（P1）、watch 同步（P1）、:35 注释卫生（I-1）、GLOSSARY/README 白话扫除
- **新增**：locale/zh.json + en.json 三键（settings.group.session=「AI 会话集成」、settings.sessionTools=「会话工具（AI 助手操作插件）」、settings.sessionPrompt=「系统提示词引导」）
- 记录口径：插件页翻转走 DSH 设置表单（DESIGN §2.6：不留痕）——session-toggle 记录类型随面板卡一并移除
- 版本仍为 0.12.15（未发布，条目改写自由）

## 修订 R3（2026-11-11 主人裁决）：开关落位官方插件页（plugins.bundle.config 座位卡），面板卡方案作废

主人实机后两次裁决收敛：①面板设置 tab 的卡是噪声（R2 已回退 ✓）；②dsh-market 的 `plugins.detail.section` 折叠槽「点开才显示」不可接受。解码实证（子代理报告，锚点充分）：**官方插件页设置区的正确扩展点 = 插件自注册 `plugins.bundle.config` 槽位**（slot-contract.d.ts 契约定义；dsh-context 活样本：自绘分组卡 + configForms 读写，直接平铺无折叠）。

R3 最终形态（替代 R1 面板卡路线）：
- **新增（客户端唯一增量）**：`src/client/agent-integration-card.jsx` —— ①`plugins.bundle.config` 座位注册（`key: "dsh-m"` = npm 包名；`whileServed(["dshm"])` = settings ns=entry id "dshm"；两 id 不同=头号坑）②自绘「AI 会话集成」卡：分组标题 + 两行开关（会话工具/系统提示词引导）+ 描述 + 级联锁定，值读 `configForms.get("dshm")` 快照、写 `form.mutate`
- **服务端零改动**：R2 的回退状态即最终状态（写路径 = form.mutate → remote.settings.mutate → 宿主 settings 服务 → config-editor 落 patch + loader 原地提交 → **P1 watch 同步链原样工作** → 装配谓词读新值）
- **消解项**：session-toggle 操作记录（插件页卡写入 = DSH 设置表单通道，DESIGN §2.6 口径不留痕——比 R1 的定制记录更一致）；hidden meta（R2 已移除 ✓ 保持）；级联钳制语义不变（session-gate 保留）
- **C' 文案**：b49ac87 的 i18n 键 git 恢复（7 键 + 失败键）
- 文档：README/GLOSSARY 的入口措辞已是插件页形态（R2 落 ✓）；CHANGELOG 0.12.15 条目的「做法/兼容性」行改写为座位卡机制

验收：插件 → dsh-m 详情页出现 `section[data-plugin-config]` 内的「AI 会话集成」卡；翻转 → PATCH `id: dshm` 条目 config 增键 + UI 即时回读；市场设置 tab 三卡不变。
