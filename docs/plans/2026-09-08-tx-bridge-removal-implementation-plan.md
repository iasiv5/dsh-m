# Profile 变更事务删桥收尾实施计划

## 目标

删除三处 pre-transaction 旁门，让 `src/core/profile-transaction.ts`（Profile 变更事务）成为变更类操作的唯一代码入口，把 DESIGN.md §3.1 的两条不变量从文档承诺变成代码事实：

1. 安装 / 升级 / 自升级 / 卸载全部经事务入口（旁门 `removeInstalledPlugin` 绕过快照、回滚、live-disable 定序与补丁摘除）；
2. pnpm 原始输出只经六类 pnpm 结果分类 seam 穿过（旁门 `addDshPlugin` + `rewritePnpmError` 是自带 regex 的第二个解释器）。

纯删除任务：不新增任何函数、接口、行为或文案。三个符号全仓零调用方（src / tests / scripts / .github 已 grep 验证；`lib/` 为 gitignored 构建镜像）。

## 架构快照

- 本次只删不加。删后 `src/core/installed.ts` 收缩为纯只读识别模块（不再 import `dsh-cli.js`）；`src/core/dsh-cli.ts` 收缩为「六类分类器 + PnpmRunner adapter + 进程原语」。
- 保留不动的相邻符号（生产在用，勿误删）：`removePatchedDependencyEntries`、`removeDshPlugin`、`runDshPlugin`、`makeAddViaLadder`、`makeDshRunner`、`classifyPnpmError`。
- 任务采用「先删测试引用、再删实现」顺序，保证每一步结束时测试套件全绿。
- 测试从构建产物 `lib/` 加载（tests 内均为 `import ... from '../lib/...'`），且只有 `npm run build` 会重建 `lib/`——因此凡修改 `src/` 的任务，验证前必须先 build，否则测试加载的是旧产物（假绿）。

## 全局约束

- **只删不加**：不新增任何接口、行为、文案（grilling Q1 共识——邻接清理如 `tools.ts` 重复合并、`versions.ts` 内部复制，各自独立成 commit，不进本计划）。
- `rewritePnpmError` 的三段中文指引文案随函数消亡，**不在本次**搬移到分类 seam 后侧做 note 富化（Q2 共识；富化作为独立后续任务排期）。
- 不修改 `DESIGN.md` / `CONTEXT.md`，不写 ADR（Q3 + domain-modeling 结论：不满足 ADR 三条件）。
- `docs/plans/` 历史计划文档（含 2026-09-07 事务计划）对已删符号的历史提及**保留不动**——它们是时间点记录。
- `lib/` 为 gitignored 构建产物：不提交构建产物，但最终验证必须含 `npm run build` 证明可构建。
- 验证命令沿用仓库 npm scripts；环境 Node ≥ 22、bash。

## 输入工件

- 设计来源：`docs/DESIGN.md` §3.1（Profile 变更事务；pnpm 结果只以六类分类穿过接缝）。
- 共识记录：2026-09-08 `/pick-one-arch-task` 深度分析 + grilling 四问（Q1 纯删 / Q2 文案消亡+后续排期 / Q3 只写 commit message / Q4 计划交评审后执行）。
- 评审记录：2026-09-08 评审轮（Request Changes）——阻塞项 ×2（陈旧 `lib/` 假绿、Git 状态快照失效）与建议项 ×3 已全部吸收；修订决策：计划文档在实现前单独提交（沿 8c90e8c / 11d39ec 的 `docs(tx)` 惯例）。

## 文件结构与职责

- Modify: `src/core/installed.ts` —— 删除 `removeInstalledPlugin`（含其过时 doc comment）与文件顶部对 `dsh-cli.js` 的整行 import；职责收缩为只读识别 + README 预览。
- Modify: `src/core/dsh-cli.ts` —— 删除 `rewritePnpmError` 与 `addDshPlugin` 两个导出函数。
- Modify: `tests/uninstall-patch.test.mjs` —— import 行去掉 `rewritePnpmError`；删除文末 `describe('rewritePnpmError', ...)` 块。
- 不新建文件；无接口依赖变化（删除的符号无人消费）。

## 任务清单

### Task 0: 前置状态检查、基线验证与计划文档落盘

- 目标：确认仓库状态与计划假设一致、基线全绿，并把本计划文档单独提交（实现 commit 保持纯净）。
- 涉及文件：`docs/plans/2026-09-08-tx-bridge-removal-implementation-plan.md`（仅提交，不改动内容）。
- 接口契约
  - Consumes: 无。
  - Produces: 干净的暂存区 + 已落盘的计划 commit（Task 4 收口 commit 只含三个实现文件的前提）；`lib/` 基线产物为最新（Task 1 的前提）。
- 验证范围：Git 状态匹配、build/typecheck/test 基线全绿、单文件 commit。

- [ ] Step 1: 前置状态检查（以执行时实测为准，不信任计划编写时的快照）
- Run: `git status --short --branch && git diff --cached --name-status`
- Expected: `## main...origin/main [ahead 1]`，暂存区仅 `A  docs/plans/2026-09-08-tx-bridge-removal-implementation-plan.md`。**任何不符（分支漂移、出现其他暂存/未暂存改动）：立即停下向用户说明，不得自行 reset / stash / unstage / 丢弃任何改动。**（该预期快照录于 2026-09-08 评审轮，状态可能再次漂移，以本步实测为准。）
- [ ] Step 2: 基线验证
- Run: `npm run build && npm run typecheck && npm test`
- Expected: build 成功；tsc 0 error；13 个测试文件全部通过（评审轮实测 291 项）。
- [ ] Step 3: 计划文档单独提交
- Run: `git commit -m "docs(tx): 删桥收尾实施计划（含评审修订）" -- docs/plans/2026-09-08-tx-bridge-removal-implementation-plan.md`
- Expected: commit 仅含该计划文档；随后 `git status --short` 无输出（工作区干净）。

### Task 1: 测试先行——解除 `rewritePnpmError` 的测试引用

- 目标：`tests/uninstall-patch.test.mjs` 不再引用 `rewritePnpmError`，且套件保持全绿（函数本体暂留 src）。
- 涉及文件：`tests/uninstall-patch.test.mjs`
- 接口契约
  - Consumes: Task 0 Step 2 生成的最新基线 `lib/`，以及 Task 0 Step 3 后的干净工作区。
  - Produces: 测试侧对 `rewritePnpmError` 零引用（Task 2 的前置条件）。
- 验证范围：单测文件通过 + 全量测试通过。

- [ ] Step 1: 改动前检查（确认现状）
- Run: `grep -n "rewritePnpmError" tests/uninstall-patch.test.mjs`
- Expected: 命中 **3 行**，分布在 2 个逻辑位置——第 12 行 import、第 155 行 `describe('rewritePnpmError', ...)` 与第 157 行函数调用（后两者同属 155-161 测试块）。行号仅供参考，以符号与测试块锚定。
- [ ] Step 2: 删除引用
- Change: 第 12 行改为 `import { removePatchedDependencyEntries } from '../lib/core/dsh-cli.js'`；删除文件末尾整个 `describe('rewritePnpmError', () => { ... })` 块（第 155-161 行，含块前空行）。文件内其余 `removePatchedDependencyEntries` 用例不动。
- [ ] Step 3: 运行并确认通过
- Run: `npm test`
- Expected: 全部测试通过（本任务不改 `src/`，`lib/` 已由 Task 0 Step 2 重建为最新；被删引用的函数仍在 lib 中，测试只是不再指向它）。

### Task 2: 删除 `dsh-cli.ts` 的 `addDshPlugin` 与 `rewritePnpmError`

- 目标：`src/core/dsh-cli.ts` 不再导出两个 pre-transaction 符号；typecheck 与全量测试通过。
- 涉及文件：`src/core/dsh-cli.ts`
- 接口契约
  - Consumes: Task 1（测试侧零引用）。
  - Produces: `src/` 中不存在 `addDshPlugin` / `rewritePnpmError`（Task 4 终验 grep 的前置）。
- 验证范围：typecheck 0 error + 全量测试通过。

- [ ] Step 1: 改动前检查
- Run: `grep -rn "addDshPlugin\|rewritePnpmError" src/ tests/ scripts/`
- Expected: 仅 `src/core/dsh-cli.ts` 内部命中（定义 + `addDshPlugin` 第 723 行对 `rewritePnpmError` 的唯一调用）；tests 已零命中。
- [ ] Step 2: 删除两个函数
- Change: 删除 `rewritePnpmError`（约 :398-410，`export function rewritePnpmError` 整函数）与 `addDshPlugin`（约 :707-724，`export async function addDshPlugin` 整函数及其 doc comment）。定位以符号名锚定，行号为参考。相邻的 `errorDigest`、`makeAddViaLadder`、`removeDshPlugin` 不动。
- [ ] Step 3: 运行并确认通过
- Run: `npm run build && npm run typecheck && npm test`（顺序与 CI registry.yml 一致；build 重建 `lib/`，防止测试加载旧产物）
- Expected: build 成功并重新生成 `lib/`；typecheck 0 error；测试从最新 `lib/` 加载且全部通过。

### Task 3: 删除 `installed.ts` 的 `removeInstalledPlugin`

- 目标：移除绕过事务的旧卸载路径；`installed.ts` 不再依赖 `dsh-cli.js`。
- 涉及文件：`src/core/installed.ts`
- 接口契约
  - Consumes: 无（与 Task 1/2 无顺序依赖）。
  - Produces: `src/` 中不存在 `removeInstalledPlugin`；`installed.ts` 顶部无 `dsh-cli.js` import。
- 验证范围：typecheck 0 error + 全量测试通过。

- [ ] Step 1: 改动前检查
- Run: `grep -rn "removeInstalledPlugin" src/ tests/ scripts/`
- Expected: 仅 `src/core/installed.ts` 定义处命中（零调用方）。
- [ ] Step 2: 删除函数与专用 import
- Change: 删除 `removeInstalledPlugin` 整函数及其 doc comment `/** 从 web profile 卸载已安装的 dsh 插件。…（先 live-disable，见 market.ts）。 */`（约 :157-173；注释中「见 market.ts」指向的旧位置已迁入事务，属过时信息）；删除第 7 行 `import { isSafePluginTarget, removeDshPlugin, type PluginRunner } from './dsh-cli.js'`（三个符号在本文件仅该函数使用，已验证）。文件内 `isSafePkgName`（本地定义）与 `resolvePluginDir` 的用法不动。
- [ ] Step 3: 运行并确认通过
- Run: `npm run build && npm run typecheck && npm test`（顺序与 CI registry.yml 一致；build 重建 `lib/`，防止测试加载旧产物）
- Expected: build 成功并重新生成 `lib/`；typecheck 0 error；测试从最新 `lib/` 加载且全部通过。

### Task 4: 重建、全量终验与 checkpoint commit

- 目标：证明删除后可构建、无残留引用，并按共识落 commit。
- 涉及文件：仓库根（无代码改动）。
- 接口契约
  - Consumes: Task 0-3 全部完成。
  - Produces: 一个实现 commit（仅三个实现文件；计划文档已在 Task 0 落盘）；工作区干净。
- 验证范围：build 成功 + typecheck/test 全绿 + 残留 grep 零命中。

- [ ] Step 1: 重建
- Run: `npm run build`
- Expected: tsc + esbuild 成功，`lib/` 全量再生（构建产物不入库）。
- [ ] Step 2: 全量验证
- Run: `npm run typecheck && npm test`
- Expected: 0 error；13 个测试文件全部通过。
- [ ] Step 3: 残留检查（含重建后的 `lib/`，证明发布产物不再暴露旧符号）
- Run: `! grep -rn "removeInstalledPlugin\|addDshPlugin\|rewritePnpmError" src/ lib/ tests/ scripts/ .github/`
- Expected: 零命中；因 `!` 取反，整条命令退出码为 0（bash 语义，零命中即验证通过）。`docs/plans/` 历史文档的提及属时间点记录，不在检查范围。
- [ ] Step 4: checkpoint commit（自然边界，实现改动单 commit 收口）
- Run: `git commit -m "refactor(tx): 删桥收尾——移除 pre-transaction 旁门（removeInstalledPlugin/addDshPlugin/rewritePnpmError），变更类操作唯一入口收敛到事务（DESIGN §3.1）" -- src/core/installed.ts src/core/dsh-cli.ts tests/uninstall-patch.test.mjs`
- Expected: commit **只含上述三个实现文件**（pathspec 限制；计划文档已在 Task 0 单独提交）。提交后 `git status --short` 无输出。若提交前发现暂存区/工作区有计划外内容，停止并说明，不得自行清理。

## 执行纪律

- 开始实现前，先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划。
- 按任务顺序执行（Task 0 → 1 → 2 → 3 → 4），不要无声跳步、合并步或改变任务目标；Task 1 必须先于 Task 2（否则测试 import 悬空导致套件红）。
- 每完成一个任务，运行该任务定义的验证。
- 遇到阻塞、重复失败或计划与仓库现实不符（如行号漂移、符号名对不上、出现计划外的引用点），立即停下说明，不要猜。
- **分支基点三选一**：**已决——2026-09-08 用户拍板方案 ①，直接在当前 `main` 执行**（HEAD = 8edc2a9，本地 ahead origin/main 一个 pick-one-arch-task commit；评审状态 Approved）。执行者不创建新分支、不切 `origin/main`、在任何情况下不得自行 reset / stash / unstage / 丢弃现有改动。
- 全部任务完成后，运行最终验证并输出修改摘要。

## 最终验证

- Run: `npm run build && npm run typecheck && npm test`
- Expected: 构建成功、tsc 0 error、全部测试通过。
- Run: `! grep -rn "removeInstalledPlugin\|addDshPlugin\|rewritePnpmError" src/ lib/ tests/ scripts/ .github/`
- Expected: 零命中（命令退出码 0）。
- Run: `git status --short && git log --oneline -2`
- Expected: 工作区干净；最近两个 commit 依次为 Task 4 的删桥收尾实现 commit 与 Task 0 的 `docs(tx)` 计划 commit。

## 审阅 Checkpoint

- 计划正文结束。请先审阅本计划；通过后由普通编码 agent 或人工按任务执行。
