# 生效判定双胞胎收编（activation post-executor）实施计划（issue #34）

## 目标

- **零行为收编**：ADR-0007 引入、两把升级锁尾段逐字双份的生效判定块（npm 门判定 + try/fail-open unknown + client-only 压制 needsRestart）收编为 `activation.ts` 单点 `resolveUpgradeActivation`——判定一处产地、backend 差异（needsRestart 初值 / toVersion 来源）留边缘参数，形态参照 ADR-0028 upgrade-target 样板（issue #34 主张）。
- **零行为承诺（含主人裁决 B 的一条已归因边角落差）**：activation 三态分类语义（client-only / restart-required / unknown）、fail-open 行为（一切异常 → unknown、绝不影响升级成功态）、deps 注入位（`classifyActivation`）与两 Locked 返回形态**全部不变**。**唯一例外（主人 2026-10-30 裁决 B）**：desktop 侧 toVersion 为空串场景（npmLatest 畸形 doc 可达，packument.ts:400）——现场门 `version !== undefined` 进门 classify 必归 unknown（含一次必败网络探测），收编真值门不进门 → activation 缺席；此落差为「省一次必败探测 + 文案从不误导」，CHANGELOG 明示归因 + Task 1 表驱动钉住新语义。
- **不动的**：`classifyUpgradeActivation` 本体（分类算法）、`upgradeEffectLine`、GLOSSARY「生效判定 / 纯客户端更新」口径、selfUpgrade 不接判定的现状（回归用例钉住）。

## 架构快照

- **双胞胎现状**（逐字对照，2026-10-30 现场）：
  - web `market-mutation.ts:934-945`（`upgradePluginLocked` 尾段）：`let needsRestart = result.needsRestart`（初值=安装事务判定）；toVersion=`result.version`；`deps?.classifyActivation`（可选链）。
  - desktop `profile-ops.ts:1196-1206`（`desktopUpgradeLocked` 尾段）：`let needsRestart = true`（初值恒）；toVersion=局部 `version`；`deps.classifyActivation`（必传 deps）。
  - 逐字共同核心：注释行、`let activation` 声明、npm 门 `entry.source === 'npm' && entry.npm && target.version && <toVersion>`、try/classify/client-only 压制/catch→unknown。
- **收编形态**：`activation.ts` 导出
  - `export interface UpgradeActivationOutcome { activation: ActivationClassification | undefined; needsRestart: boolean }`
  - `export async function resolveUpgradeActivation(entry: { source: string; npm?: string }, fromVersion: string | undefined, toVersion: string | undefined, needsRestartInitial: boolean, classify?: (pkg: string, fromVersion: string, toVersion: string) => Promise<ActivationClassification>): Promise<UpgradeActivationOutcome>`——块体逐字迁移：门内 `entry.source === 'npm' && entry.npm && fromVersion && toVersion`（**真值门，对齐 web 现场**；desktop '' 场景落差已裁决归因，见零行为承诺节）、`classify ?? classifyUpgradeActivation` 缺省、client-only 压制、catch → `'unknown'`。
- **消费点**（一行解构，return 组装留各自 backend 原样）：
  - web：`const { activation, needsRestart } = await resolveUpgradeActivation(entry, target.version, result.version, result.needsRestart, deps?.classifyActivation)`。
  - desktop：`const { activation, needsRestart } = await resolveUpgradeActivation(entry, target.version, version, true, deps.classifyActivation)`。
  - 两文件 import 收敛：`classifyUpgradeActivation` 值导入不再需要（改 `import type { ActivationClassification } from './activation.js'`）。

## 全局约束

- **零行为验收主锚**：`tests/upgrade-activation.test.mjs`（七用例：T3 web 段 client-only/restart-required/fail-open/github 不产出/selfUpgrade 回归 + T4 desktop 段）**零 diff 全绿**；`tests/market-mutation.test.mjs`、`tests/profile-ops.test.mjs` 零 diff 全绿。
- **断言面清点表**（改形状必清点，2026-10-30 读现文核实）：

  | 断言面 | 现状 | 本计划处置 |
  |---|---|---|
  | tests/upgrade-activation.test.mjs（全档 230 行） | 经真实 upgradePlugin/desktopUpgradeFromRegistry 钉住两尾段接线行为 | **零 diff 全绿**（deps 形态不动 → 注入直通） |
  | tests/market-mutation.test.mjs:656/754 | `classifyActivation: async () => 'unknown'` 注入 | 零 diff（注入位不变） |
  | tests/profile-ops.test.mjs | desktop 升级用例（含 activation 断言形态） | 零 diff |
  | tests/activation.test.mjs | classifyUpgradeActivation/upgradeEffectLine 直测 | 零 diff；另扩 resolveUpgradeActivation 表驱动 describe |
  | src/cli.ts:28 | `upgradeEffectLine` 消费 | 零触碰 |
  | market-mutation.ts:875 / profile-ops.ts:886/1059 | 返回类型 `activation?: ActivationClassification` | 类型零改动（解构变量同名同型） |
- **CODING-STANDARDS**：新 describe 自带夹具；不新增接线 mock（接线处已有真实装配测试）；管道保退出码；改形状先清点断言面（上表）。
- **环境**：Node ≥ 22.19.0；`test -d node_modules` 预检；npm 调用前置 `npm_config_cache=$HOME/workspace/.npm-ci-cache`；>90s 命令 run_in_background。

## 输入工件

- 设计共识：本轮 grill 决议 Q1–Q4 全按推荐（2026-10-30，对话在案）。
- issue #34 正文（证据锚：market-mutation.ts:994-1004 ≈ profile-ops.ts:1212-1222 为 0.11.2 时点行号，现漂移至 934-945 / 1196-1206；commit 7673375 双落地史）。
- ADR-0028 + `docs/plans/2026-10-30-upgrade-target-resolution-implementation-plan.md`（迁移样板）；ADR-0007（分类语义源）。

## 文件结构与职责

- Modify: `src/core/activation.ts` —— 新增 `UpgradeActivationOutcome` + `resolveUpgradeActivation`（post-executor 单点）。
- Modify: `src/core/market-mutation.ts` —— `upgradePluginLocked` 尾段块替换为一行解构；import 收敛 type-only。
- Modify: `src/core/profile-ops.ts` —— `desktopUpgradeLocked` 尾段同上。
- Modify: `tests/activation.test.mjs` —— 新 describe「resolveUpgradeActivation（#34 post-executor）」表驱动。
- 零触碰：`tests/upgrade-activation.test.mjs`、`tests/market-mutation.test.mjs`、`tests/profile-ops.test.mjs`、`src/cli.ts`、GLOSSARY。

## 任务清单

### Task 1: resolveUpgradeActivation 单点（测试先行）

- Files: Modify `src/core/activation.ts`、`tests/activation.test.mjs`
- 接口契约：
  - Consumes: `classifyUpgradeActivation` / `ActivationClassification`（同模块）。
  - Produces: `UpgradeActivationOutcome` + `resolveUpgradeActivation`（签名见架构快照；`classify` 缺省 = `classifyUpgradeActivation`——缺省臂不单测真实现（网络），等价性由块体逐字迁移 + Task 2/3 接线套件零 diff 保证）。
- 验证范围：新表驱动全绿；全量门绿（backend 未接线，其余零变化）。
- [ ] Step 1: 写失败测试——`tests/activation.test.mjs` 新 describe（自带夹具，注入 classify 捕获调用）表驱动：① github 源 → 分类器零调用、`activation === undefined`、needsRestart 透传初值；② npm 门 + from/to **undefined** 各案 → 零调用 + 透传；③ **toVersion `''` → 零调用 + activation 缺席（裁决 B：钉住 desktop 边角新语义，防隐性漂移）**；④ npm 门全真 + client-only → needsRestart 压为 false；⑤ restart-required → 初值维持；⑥ classify 抛错 → activation 'unknown' + 初值维持（fail-open）；⑦ 初值 false + 非 client-only → 维持 false。
- Run: `node scripts/build.mjs && node --test tests/activation.test.mjs`
- Expected: 红（命名导出不存在）。
- [ ] Step 2: 确认失败。
- [ ] Step 3: 最小实现——按契约两符号落地（块体逐字迁移，注释注明 #34 收编与 ADR-0007 出处）。
- [ ] Step 4: 确认通过。
- Run: `npm test && npm run typecheck`
- Expected: 全量绿。
- [ ] Step 5: checkpoint commit——`refactor(activation): #34 resolveUpgradeActivation post-executor 单点（Task 1）`。

### Task 2: web 尾段消费（零行为）

- Files: Modify `src/core/market-mutation.ts`
- 接口契约：Consumes Task 1 函数；Produces 无（内部改道）。
- 验证范围：`tests/upgrade-activation.test.mjs`（T3 段）与 `tests/market-mutation.test.mjs` **零 diff 全绿**；全量门绿。
- [ ] Step 1: 基线确认——两套件当前绿。
- [ ] Step 2: 最小实现——L934-945 块替换为一行解构（参数：`entry, target.version, result.version, result.needsRestart, deps?.classifyActivation`）；`return { ...result, fromVersion: target.version, needsRestart, ...(activation ? { activation } : {}) }` 原样；import 改 type-only。
- [ ] Step 3: 确认通过（两套件零 diff + 全量）。
- Run: `npm test && npm run typecheck`
- [ ] Step 4: checkpoint commit——`refactor(core): #34 web upgradePluginLocked 尾段消费 resolveUpgradeActivation（Task 2，零行为）`。

### Task 3: desktop 尾段消费（零行为）

- Files: Modify `src/core/profile-ops.ts`
- 验证范围：`tests/upgrade-activation.test.mjs`（T4 段）与 `tests/profile-ops.test.mjs` **零 diff 全绿**；全量门绿。
- [ ] Step 1: 基线确认。
- [ ] Step 2: 最小实现——L1196-1206 块替换为一行解构（参数：`entry, target.version, version, true, deps.classifyActivation`）；return 组装原样；import 改 type-only。
- [ ] Step 3: 确认通过。
- Run: `npm test && npm run typecheck`
- [ ] Step 4: checkpoint commit——`refactor(core): #34 desktop desktopUpgradeLocked 尾段消费（Task 3，零行为）`。

### Task 4: 0.11.4 发版 + 本机自升级

- Files: Modify `CHANGELOG.md`、`package.json`、`package-lock.json`、`docs/adr/0028-upgrade-target-resolution-single-source.md`
- [ ] Step 1: CHANGELOG 双语顶条（零行为轮定位：双 Locked 尾段收编 `resolveUpgradeActivation`；三态语义/fail-open/注入位/返回形态全部不变；**裁决 B 边角落差归因**：desktop toVersion 空串场景 activation `unknown`→缺席、省一次必败网络探测）+ ADR-0028 Follow-up ① 注记「已实施（0.11.4）」+ 版本三处（0.11.3 → 0.11.4）。
- [ ] Step 2: 全量门 `npm test && npm run typecheck`（基线 1868 + 新增 7 = 1875，逐条归因）。
- [ ] Step 3: release commit → `npm_config_cache=$HOME/workspace/.npm-ci-cache npm run release`（后台）→ 018 两阶段监视（Actions 绿 → npmjs 三键）→ npmmirror sync PUT 收尾。
- [ ] Step 4: issue #34 关闭（评论附收编 diff 形态与零行为证据）。
- [ ] Step 5: 本机自升级 0.11.3 → 0.11.4（profile 内 cli.js selfUpgrade 通道，danger-full-access）+ 分离式重启（037 §3，当轮最后动作）+ 下一轮只读探针（ActiveEnterTimestamp / 3080 / `/dshm` ping version=0.11.4 / profile 实装）。

## 执行纪律

- 按任务顺序执行；每任务完成即跑该任务验证；管道 `set -o pipefail`；行号为时点参考、符号锚优先；计划与仓库现实不符即停。
- 零行为轮红线：Task 2/3 的 diff 若引发 `tests/upgrade-activation.test.mjs`、`tests/market-mutation.test.mjs`、`tests/profile-ops.test.mjs` 任何一行改动即视为行为漂移，立即停下归因。

## 最终验证

- `npm test && npm run typecheck` 全绿（预期 1868 + 6 ≈ 1874，逐条归因）。
- 三套件零 diff（评审 #2 修订：commit 区间判据，最终时点不恒真）：`git diff --exit-code 1ad16e9..HEAD -- tests/upgrade-activation.test.mjs tests/market-mutation.test.mjs tests/profile-ops.test.mjs` = 0（Task 2/3 各自 Step 3 的工作树判据照旧保留为过程防线）。
- 发版后 `/dshm` ping version = 0.11.4。
