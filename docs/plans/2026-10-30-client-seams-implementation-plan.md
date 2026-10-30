# client 接缝收敛三件套实施计划（issue #36：doUpgrade 编排 / ops 在途谓词 / market-state 归位）

## 目标

- **零行为收编三件**（client 侧架构走查 backlog，ADR-0028 Follow-up ③）：
  1. `installed-tab.jsx` / `market-tab.jsx` 的 generic 升级编排（近逐字双份，cdc8404 一处 bug 三站同步修实证）出仓 `src/client/upgrade-flow.js` 单点；version-chip（self-upgrade 专用通道，语义族不同）部分收——enqueue-meta 构造注释锚定同源关系。
  2. ops 在途谓词五处手写镜像收权 `operations-view.js`（`isInflightStatus` / `activeMutateOp` / `activeProgressOp` / `activeKindOp`），status 闭集变更从此单点。
  3. market-state 裁剪几何五件套迁 `zone-chips-geometry.js`（唯一消费者 zone-chips 旁）；`drainRestored` 死导出退役。
- **零行为承诺**：一切渲染产物（DOM 形态/toast/横幅/操作记录落账/批量三态语义）不变；组件变量名全保留（`activeMutateTarget`/`progressTarget`/`activeInstallRec`/`activeUpgradeRec`），仅换右值——渲染冒烟与源锚最小扰动。
- **不动的**：opsStore/opsPump 生命周期（ADR-0023 decision 3）、op-outcome.js、panel-ops.js（restartBannerDecision 单源消费）、hooks.js、opUpgradeMeta 本体、selfUpgrade 通道（version-chip 的 self-upgrade 请求路径）。

## 架构快照

- **① upgrade-flow**（Create `src/client/upgrade-flow.js`，DOM-free）：
  - `performUpgradeFlow({ ops, oc, target, from, toVersion, noteSink?, refresh?, notify })` → `Promise<'ok'|'target'|'systemic'>`：
    1. `ops.runOp("upgrade", target, async () => { const r = await apiCall(); const m = opUpgradeMeta(r); return m ? { ...r, opMeta: m } : r; }, { from, toVersion })`——`apiCall` 由薄壳传入（installed = `() => api("upgrade", { pkg: target })`，market 同形 `it.installedPkg`）；enqueue-meta 字面（`{ from: it.installedVersion, toVersion: it.latest }` 等）留薄壳调用点；
    2. degraded 臂：`oc.degradedOutcome(res)` → `notify({ kind:'warn', text })` + `noteSink?.({ kind:'warn', text })`；
    3. 成功臂：`oc.upgradeOkText(res)` → `notify({ kind:'ok', needsRestart: restartBannerDecision('upgrade', res).needsRestart, text })` + `noteSink?.({ kind:'ok', text })`；
    4. `await (refresh ? refresh() : undefined)`；返回 `'ok'`；
    5. catch：`oc.mutationFailed(e, { verb:'upgrade', target })` → notify + `noteSink?.({ kind: m.kind === 'ok' ? 'hint' : 'err', text })`；返回 `m.kind !== 'err' ? 'ok' : classifyBatchOutcome(e)`（ADR-0026 三态，e.failureClass 由 hooks 透传）。
  - 薄壳：installed-tab（无 noteSink；refresh = `onMutation ? onMutation : reload` 包装；透传返回值给批量循环）；market-tab（noteSink = `(s) => setInstallNote({ id: it.id, kind: s.kind, text: s.text })`；refresh = onMutation）。version-chip：不入编排（self-upgrade 专用通道：method/成功臂自拼文案/clearSelfCheckCache 副作用/unsupported info 分支/busy 守卫五处差异，另有 opMeta 手拼与 enqueue 含 npm 字段两处——评审批量1 补证），函数头注释锚定「enqueue-meta/opMeta 构造与 upgrade-flow 同源关系」。**注释合并策略（评审建议采纳）**：双胞胎注释出仓时取信息量并集（market 版 0.10.0 R4「与回滚事实相反」、catch「与已装页同款文案链」等细节保留），防收敛丢注释信息。
- **② ops 在途谓词**（operations-view.js +4 导出）：`INFLIGHT` 闭集 `queued|running|input`；`isInflightStatus(status)`；`activeMutateOp(records)`（首个 `kind !== 'install' && inflight` || null）；`activeProgressOp(records)`（首个 `kind ∈ {install,upgrade,self-upgrade} && inflight` || null）；`activeKindOp(records, kind)`（首个 `kind` 且 inflight || null）。五处消费（变量名全保留）：installed-tab:32 `activeMutateTarget = (activeMutateOp(ops.records) || {}).target || null`；:37 `progressTarget = (activeProgressOp(ops.records) || {}).target || null`；market-tab:61-62 `activeInstallRec = activeKindOp(ops.records, 'install')`；:64 `activeUpgradeRec = activeKindOp(ops.records, 'upgrade')`；operations-card:24 `active = records.filter((r) => isInflightStatus(r.status))`。**不收注记（评审侦察补遗 a，防未来误并）**：detail-modal.jsx:254/:257 的二态挂行条件（`running || queued`，**不含 input**——注释明示「input（兼容待决）走上层 CompatDialog」）语义族不同，经评估**不收编**——用三态谓词收将改变行为（input 从不挂行变挂行），违反零行为；chrome.jsx:25（展示色映射）与 main.jsx:559（enqueue 赋值）非谓词，均不算站。
- **③ market-state 归位**：五件套（chipRows / countBeyondRows / clipTopOf / visibleRowTop / autoExpandDecision 及其 doc 注释）自 market-state.js:343-444 **逐字节**迁 `src/client/zone-chips-geometry.js`；zone-chips.jsx import 改源；`drainRestored`（operations.js:539-565，全仓唯一引用 = 自身定义；main.jsx:699 注释即退役记录）整段删除。

## 全局约束

- **零行为验收**：渲染冒烟（SSR renderToString）绿；`tests/client-zonechips-clip.test.mjs` 用例**零改动**（仅 import 改源）绿；`upgradeEffectLine` 等纯函数直测零触碰；源锚迁移表（下）逐项落实并经评审亲验。
- **源锚迁移表**（改形状必清点，2026-10-30 现场核实）：

  | 锚 | 现状 | 处置 |
  |---|---|---|
  | tests/client-installed-updates.test.mjs:147 | `count('const degraded = oc.degradedOutcome(res);') === 2`（市场卡+已装列表） | 改写：upgrade-flow 源内恰 1 处 + 两薄壳消费 `performUpgradeFlow` 各 ≥1 |
  | tests/client-installed-updates.test.mjs:185 | `{ from: it.installedVersion, toVersion: it.latest }` 恰 1 | 零改动（market 薄壳调用点字面保留） |
  | tests/client-installed-view.test.mjs:106-146 | 已装页 doUpgrade 切片锚三处（零 self-upgrade 特判 / 批量旧实现已删 / 三态契约切片） | 改写：薄壳形态锚（doUpgrade 仍存在且调 performUpgradeFlow / 三态契约迁 upgrade-flow 直测断言 / 零 self-upgrade 特判锚保留于薄壳切片） |
  | tests/client-render-smoke.test.mjs:358 | `activeUpgradeRec.target === detailItem.installedPkg` | 零改动（变量名保留设计） |
  | tests/client-zonechips-clip.test.mjs | 几何五件套直测（import 自 market-state.js） | 仅 import 行改源，用例零改动 |
  | tests/client-operations.test.mjs:127-190 | drainRestored describe 三用例 | 随退役整段删除（-3 用例） |
  | tests/client-operations-view.test.mjs:14/:60 | operations-view 导出直测 import 行 | 追加四新导出 import + 新 describe |
- **ADR 红线**：ADR-0023 三桶政策（DOM-free 纯逻辑模块 + node:test 直测；组件文件具名导出；opsStore/opsPump module 级不动）、ADR-0026（批量三态语义不变——classifyBatchOutcome 消费点从 installed-tab 迁 upgrade-flow，语义逐字）。
- **CODING-STANDARDS**：新 describe 自带夹具；中文文案锚走源结构锚；出现次数语义；管道保退出码；i18n lookup 直接量落字典（本轮无新键）。
- **环境**：Node ≥ 22.19.0；`test -d node_modules` 预检；npm 调用前置 `npm_config_cache=$HOME/workspace/.npm-ci-cache`；>90s 命令 run_in_background。

## 输入工件

- 设计共识：本轮 grill 决议 Q1–Q4 全按推荐（2026-10-30，对话在案；Q1 = installed/market 全收 + version-chip 部分收）。
- issue #36 正文（证据锚 file:line 为 0.11.4 时点，现微漂移已按现场重锚）；cdc8404（0.10.20 一处 bug 三站同步修实证）；ADR-0023。
- 样板：#34/#35 计划与评审流水线；`docs/plans/2026-10-30-activation-post-executor-implementation-plan.md`。

## 文件结构与职责

- Create: `src/client/upgrade-flow.js`（升级编排单点）、`src/client/zone-chips-geometry.js`（几何五件套）、`tests/client-upgrade-flow.test.mjs`（编排直测）。
- Modify: `src/client/operations-view.js`（+4 导出）、`installed-tab.jsx`、`market-tab.jsx`（薄壳化 + 谓词消费）、`version-chip.jsx`（注释锚定）、`operations-card.jsx`（谓词消费）、`zone-chips.jsx`（import 改源）、`market-state.js`（删五件套）、`operations.js`（删 drainRestored）、`main.jsx`（:13 解构移除五件套死名字，评审 #2——仅此一行）。
- Modify tests: `client-installed-updates.test.mjs`、`client-installed-view.test.mjs`、`client-zonechips-clip.test.mjs`、`client-operations.test.mjs`、`client-operations-view.test.mjs`（+describe）。
- 零触碰：`hooks.js`、`panel-ops.js`、`op-outcome.js`、`installed-updates.js`、`i18n.js`（main.jsx 因评审 #2 进 Modify，仅 :13 解构一行）。

## 任务清单

### Task 1: ops 在途谓词收权（测试先行）

- Files: Modify `src/client/operations-view.js`、`installed-tab.jsx`、`market-tab.jsx`、`operations-card.jsx`、`tests/client-operations-view.test.mjs`
- 接口契约：Produces 四导出（签名见架构快照 ②；`activeMutateOp`/`activeProgressOp`/`activeKindOp` 无命中返回 null——market 现场以 `|| null` 收尾，installed 以 `|| {}).target` 消费，两形态由调用方保持）。
- 验证范围：新 describe 绿；渲染冒烟绿；:358 锚零改动通过。
- [ ] Step 1: 失败测试——`tests/client-operations-view.test.mjs` 新 describe：`isInflightStatus` 三真值 + 终态假值 + 非法输入 false；`activeMutateOp`（install 排除语义 + 顺序首个）；`activeProgressOp`（三 kind 收/其余排）；`activeKindOp`（命中/无命中 null）。
- Run: `node --test tests/client-operations-view.test.mjs`（红：导出不存在）。
- [ ] Step 2: 确认红。
- [ ] Step 3: 实现 + 五处消费替换（变量名全保留）。
- [ ] Step 4: 确认绿（含渲染冒烟 `node --test tests/client-render-smoke.test.mjs`）。
- Run: `npm test && npm run typecheck`（全量门）。
- [ ] Step 5: checkpoint commit——`refactor(client): #36 ops 在途谓词收权 operations-view 四导出（Task 1，零行为）`。

### Task 2: market-state 归位 + drainRestored 退役

- Files: Create `src/client/zone-chips-geometry.js`；Modify `src/client/market-state.js`、`zone-chips.jsx`、`operations.js`、`tests/client-zonechips-clip.test.mjs`、`tests/client-operations.test.mjs`
- 验证范围：zonechips-clip 套件用例零改动（仅 import 行）绿；operations 套件绿（-3 用例）；渲染冒烟绿。
- [ ] Step 1: 搬迁——五件套函数体与 doc 注释逐字节迁 zone-chips-geometry.js（market-state 删除原段）；zone-chips.jsx 与 clip 测试 import 改源；**main.jsx:13 解构中五件套名字同步移除（评审 #2，方向 A：该解构为死解构——:13 之外全文件零使用；不移除则五名字成「守卫声明位合法的悬空解构」，check-client-imports 自由变量守卫对其永久失明）**；删 drainRestored——**含四处**（评审 #1/补遗 b）：:539 函数体 + :538 函数头 doc + :18 文件头 doc 列表行条目 + `tests/client-operations.test.mjs` :10 import 链名字同步移除（eslint no-unused-vars 为 error，describe 删除后 import 残留必拦红）+ :127-190 describe 三用例。
- [ ] Step 2: 验证——`node --test tests/client-zonechips-clip.test.mjs tests/client-operations.test.mjs`；`git diff` 核验搬迁段逐字节（-行与 +行集合相等）。
- Run: `npm test && npm run typecheck`。
- [ ] Step 3: checkpoint commit——`refactor(client): #36 裁剪几何归位 zone-chips-geometry + drainRestored 退役（Task 2，零行为）`。

### Task 3: upgrade-flow 出仓（测试先行）

- Files: Create `src/client/upgrade-flow.js`、`tests/client-upgrade-flow.test.mjs`；Modify `installed-tab.jsx`、`market-tab.jsx`、`version-chip.jsx`（注释锚定）、`tests/client-installed-updates.test.mjs`、`tests/client-installed-view.test.mjs`
- 接口契约：Produces `performUpgradeFlow`（签名与五臂语义见架构快照 ①；真 `createOpOutcome(lookup)` + `restartBannerDecision` 直用，无 mock 面）。
- 验证范围：新直测绿（degraded 臂/成功臂 notify+noteSink 形态/failureClass 三态返回/refresh 调用/缺省 noteSink·refresh）；渲染冒烟绿；源锚迁移表 :147/:106-146 两行按表改写，:185/:358 零改动通过。
- [ ] Step 1: 失败测试——`tests/client-upgrade-flow.test.mjs`：注入 fake ops（runOp 捕获 enqueueMeta 并执行传入 call）+ 真 `createOpOutcome(lookup)` + notify/noteSink/refresh 收集数组。用例：① 成功臂（upgradeOkText 文案 + needsRestart 通道 + noteSink {kind:'ok'} + refresh 调用 + 返回 'ok'）；② degraded 臂（warn 投影 + noteSink {kind:'warn'}）；③ catch target 失败（failureClass:'target' → 返回 'target' + noteSink {kind:'err'}）；④ catch systemic（返回 'systemic'）；⑤ catch superseded 类（m.kind !== 'err' → 返回 'ok' + noteSink {kind:'hint'}）；⑥ opUpgradeMeta 落账（runOp call 产出的 res 含 opMeta）。
- Run: `node --test tests/client-upgrade-flow.test.mjs`（红：模块不存在）。
- [ ] Step 2: 确认红。
- [ ] Step 3: 实现 upgrade-flow.js + 两薄壳改造（installed：doUpgrade = 薄壳透传返回值；market：noteSink/refresh 包装）+ version-chip 函数头注释锚定 + 源锚迁移表两行改写。
- [ ] Step 4: 确认绿（新直测 + 渲染冒烟 + 迁移表全项）。
- Run: `npm test && npm run typecheck`。
- [ ] Step 5: checkpoint commit——`refactor(client): #36 升级编排出仓 upgrade-flow 单点（Task 3，零行为）`。

### Task 4: 0.11.5 发版 + 本机自升级（client-only 免重启）

- Files: Modify `CHANGELOG.md`、`package.json`、`package-lock.json`、`docs/adr/0028-upgrade-target-resolution-single-source.md`
- [ ] Step 1: CHANGELOG 双语顶条（client 零行为重构三件套定位 + 源锚迁移表摘要 + 验证数据）+ ADR-0028 Follow-up ③ 注记「已实施（0.11.5）」+ 版本三处（0.11.4 → 0.11.5）。
- [ ] Step 2: 全量门（基线 1875 对照，Δ = +编排直测 −drainRestored 三用例 + 谓词 describe，逐条归因）。
- [ ] Step 3: release commit → `npm_config_cache=$HOME/workspace/.npm-ci-cache npm run release`（后台）→ 018 两阶段监视 → npmmirror sync PUT。
- [ ] Step 4: issue #36 关闭（评论附三件套收编形态与零行为证据）。
- [ ] Step 5: 本机自升级 0.11.4 → 0.11.5（selfUpgrade 通道；腾讯镜像滞后时按 0.11.4 先例轮询重试）——**client-only 变更免重启**（037 §5.2），升级完成后 `/dshm` ping version = 0.11.5 + 构建指纹探针（client bundle 新构建特有字面）即收口，无重启断连。

## 执行纪律

- 按任务顺序执行；每任务完成即跑该任务验证；`set -o pipefail`；行号为时点参考（0.11.4 现场已重锚）、符号锚优先；计划与现实不符即停。
- 零行为红线：渲染冒烟任何用例改动即视为行为漂移（源锚迁移表明示的两行除外），立即停下归因。

## 最终验证

- `npm test && npm run typecheck` 全绿（1875 − 3 + 谓词 ≈4 + 编排 ≈6 ≈ 1882，逐条归因）。
- 源锚迁移表逐项核验（评审亲验）；`tests/client-zonechips-clip.test.mjs` 用例部分零 diff（仅 import 行）。
- 发版后 `/dshm` ping version = 0.11.5 + client bundle 指纹探针（HMR 生效判据）。
