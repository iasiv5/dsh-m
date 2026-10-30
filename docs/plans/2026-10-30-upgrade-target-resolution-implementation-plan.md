# 升级目标解析单源（upgrade-target）实施计划

## 目标

- 零行为搬家：把「已装项 → 可装条目 / unsupported」的判定从三处并存（web 梯 `upgradePluginLocked`、desktop 梯 `desktopUpgradeLocked`、读侧投影 `upgradePathFor`）收敛为唯一产地 `src/core/upgrade-target.ts`。
- 消灭两类既有失败模式：双梯「同构」复制义务（六周三次锁步落地）、读写判据漂移（c9faf21 实证）。
- 测试面收敛：梯子分支判定迁往新 seam 表驱动套件，双 backend 镜像用例瘦身为「接线 + 信封映射」薄层。
- 对外一切语义不变：错误信封（字节级）、`upgradePath` 三态投影、金样、client/tools/cli 零触碰。

## 架构快照

- `src/core/upgrade-target.ts` 分两层：
  - **纯判定核心**（无 I/O，表驱动可测）：`unsupportedReasonFor(target)` 为判定原子（分支序固定：local-spec → npm → github-spec-unparseable → source-unresolvable）；`upgradePathFor`（自 market.ts 迁入，签名不变）与 `synthesizeInstallableEntry`（自 market-mutation.ts 迁入，throws 行为不变）均改为它的消费方；`UpgradePathUnsupportedError` 类迁入（构造形态与 message 字节不变）。
  - **薄 async 壳** `resolveUpgradeTarget(target, cfg, opts?, deps?)`：双梯的 I/O 编排收编——registryUsable 门 → 主清单 `matchInstalledByEntry` → `mergedOutcome(...).lookupInstalledAll`（窄 catch 吞为 miss）→ `synthesizeInstallableEntry` 兜底；返回判别联合。
- 消费端直连 import（不留转手 re-export，ADR-0024 惯例）：`market-mutation.ts`（web 梯）、`profile-ops.ts`（desktop 梯）、`market.ts`（投影 stamp 点）。
- 信封映射留边缘：web 收到 `unsupported` 联合后重抛 `new UpgradePathUnsupportedError(pkg, reason.detail)`（与现行由 synthesize 直接抛出的 message 字节一致）；desktop 翻译 `DesktopOpsError('upgrade-unsupported', reason.message)`（现行语义）。
- 判据原子 `isLocalSpec` / `GITHUB_SPEC_RE` / `matchInstalledByEntry` 产地不变（merged-market，ADR-0026 修订段口径），upgrade-target 消费。
- 性能避坑（dsh-market #589 教训）：async 壳消费 ADR-0016 物化代（`mergedOutcome` 生成级缓存），不逐项重 adapt 全量社区目录、不新增缓存层（#485 教训：也不引入任何可能合并语义不同输入的新缓存键）。
- 社区 deadline 归一：module 内 `UPGRADE_COMMUNITY_DEADLINE_MS = 60_000`（web 现用 market.ts `DEFAULT_DEADLINE_MS`、desktop 现用私有 `DEFAULT_COMMUNITY_DEADLINE_MS`，值同 60s，语义零变化）。

## 全局约束

- **零行为变化**：`UpgradePathUnsupportedError` 的 message 模板 `「${pkg}」无法自动升级：${reason}` 与三条 detail 文案逐字保留（`本地开发安装（${spec}）不从线上更新；如需线上版本请先卸载后经 dsh-m 安装` / `github 安装的 spec（${spec || '空'}）解析不出 owner/repo，拒绝臆测来源` / `来源 ${target.source} 不可线上解析，不做自动升级`）；desktop `upgrade-unsupported` 信封不变；`upgradePath` 三态投影语义不变。
- **零触碰面**：`tests/fixtures/market-golden.json`、`src/client/**`、`src/tools.ts`、`src/cli.ts`、`src/core/host-api.ts` 不改（零行为面的物理证明）。
- **B5 冻结断言面清点**（评审 R1-b 复核采认，2026-10-30；「零行为/零触碰」承诺的逐文件依据）：

  | 断言面 | 引用形态 | 本计划下处置 |
  |---|---|---|
  | src/core/host-api.ts:294 | 仅注释提及错误类，无 import；未具名错误走 `err.message` 透传（L294-295） | 零触碰 ✓ |
  | src/tools.ts L260/421/542/618/670 | `it.upgradePath` 数据消费 | 零触碰 ✓ |
  | src/cli.ts:348 | `it.upgradePath` 数据消费 | 零触碰 ✓ |
  | src/client/installed-updates.js L62/75 | `it.upgradePath === 'unsupported'` | 零触碰 ✓ |
  | tests/fixtures/market-golden.json | 6 处 `upgradePath` 期望值 | 金样 diff 判据保护 ✓ |
  | tests/profile-ops.test.mjs L461-468 | `DesktopOpsError` code+message 正则 | Task 4 零改动通过（`reason.message` 字节设计对齐现行 L1113-1121 翻译链）✓ |
  | tests/host-api-profile.test.mjs L387/437-438 | import + 构造 `UpgradePathUnsupportedError`（L294 透传链的行为锚） | Task 1 import 改指 `upgrade-target.js`，断言零改动 ✓ |
  | tests/market.test.mjs L12/489-494 | import + `upgradePathFor` 五行直测 | Task 1 import 改指 `upgrade-target.js`，断言零改动 ✓ |
  | tests/market-mutation.test.mjs L14/L1175-1185 | import + 梯子用例③ instanceof 断言 | Task 1 import 残留引用改指，Task 3 零改动通过、Task 5 瘦身 ✓ |
- **ADR 红线**：ADR-0024（读写分缝；不新增转手 re-export）、ADR-0026（判定语义与判据原子产地 merged-market 不变）、ADR-0005（desktop 委派执行器不动）、ADR-0022 D3（服务端单一缝点、客户端与工具层零特判）。
- **CODING-STANDARDS**：源串锚禁含 `\n` 转义；新 describe 自带夹具与 helpers（不引用兄弟 describe 闭包）；管道显示测试输出不得吞原始退出码；改函数返回/输出形态前先清点 tests/ 中全部断言面。
- **环境**：Node ≥ 22.19.0；验证前执行 `test -d node_modules`，缺失按 `package-lock.json` → `npm ci` 恢复；`npm test` 经 `pretest` 自带构建。
- GLOSSARY「升级目标解析」词条已立（2026-10-30）；ADR-0028 已入库；AGENTS.md 导航行随 Task 6 补。

## 输入工件

- 设计共识：本轮 grill 决议 Q1–Q11（2026-10-30，对话在案）＋ `docs/adr/0028-upgrade-target-resolution-single-source.md`。
- 漂移与双梯证据：commit c9faf21；`src/core/market-mutation.ts` `upgradePluginLocked` 梯段；`src/core/profile-ops.ts` `desktopUpgradeLocked` 梯段。
- 上游参照：`.dsh-research/dsh-market-fresh/src/catalog-local-match.ts`（共享判定 + 判别联合 + 闭集 reason 码先例；#485 / #589 避坑）。

## 文件结构与职责

- Create: `src/core/upgrade-target.ts` —— 升级目标解析唯一产地（纯核心 + async 壳 + `UpgradePathUnsupportedError` + `UPGRADE_COMMUNITY_DEADLINE_MS`）。
- Create: `tests/upgrade-target.test.mjs` —— 表驱动套件（投影分支 + 合成分支 + 解析六分支 + registry unavailable 降级）。
- Modify: `src/core/market-mutation.ts` —— 三个符号迁出后改直连 import；`upgradePluginLocked` 梯段替换为 `resolveUpgradeTarget` 调用 + 边缘重抛。
- Modify: `src/core/profile-ops.ts` —— `desktopUpgradeLocked` 梯段替换为 `resolveUpgradeTarget` 调用 + `DesktopOpsError` 翻译；删私有 `DEFAULT_COMMUNITY_DEADLINE_MS`。
- Modify: `src/core/market.ts` —— `upgradePathFor` 迁出后改 import 消费；`listInstalledWithMeta` 两处 stamp 点逻辑不动。
- Modify: `tests/market-mutation.test.mjs` —— `synthesizeInstallableEntry` 五分支 describe 迁往新套件；梯子镜像分支瘦身。
- Modify: `tests/profile-ops.test.mjs` —— 梯子镜像分支瘦身；`upgrade-unsupported` 信封用例保留。
- Modify: `AGENTS.md` —— 「Owning code and tests」补「升级目标解析」一行。

## 任务清单

### Task 1: upgrade-target 纯核心迁入（测试先行）

- 目标：`upgradePathFor` / `synthesizeInstallableEntry` / `UpgradePathUnsupportedError` 迁入新 module 并改由 `unsupportedReasonFor` 单源驱动，两产地文件改直连 import，行为零变化。
- Files:
  - Create: `src/core/upgrade-target.ts`、`tests/upgrade-target.test.mjs`
  - Modify: `src/core/market.ts`、`src/core/market-mutation.ts`、`tests/market-mutation.test.mjs`
  - Modify（仅 import 行机械改指，逻辑零触碰）: `src/core/profile-ops.ts`（L24：`synthesizeInstallableEntry` / `UpgradePathUnsupportedError` 改自 `./upgrade-target.js`，其余符号仍出自 `./market-mutation.js`；梯段不动，改道留 Task 4）、`tests/host-api-profile.test.mjs`（L387：`UpgradePathUnsupportedError` 改自 `../lib/core/upgrade-target.js`，`InstallGuardError` 不动，断言零改动）、`tests/market.test.mjs`（L12：`upgradePathFor` 改自 `../lib/core/upgrade-target.js`，其余符号不动，断言零改动）
- 接口契约：
  - Consumes: `isLocalSpec` / `GITHUB_SPEC_RE`（merged-market，产地不动）；`matchInstalledByEntry`（同）；`import type { UpgradePath } from './market.js'`（`UpgradePath = 'catalog' | 'synthesized' | 'unsupported'` 类型定义留 market.ts——全仓现无按名 import 该类型的消费点（host-api/market-mutation/profile-ops 中的 `upgradePath` 均为属性名或注释，非类型引用），留原产地零迁移风险；upgrade-target 的 type-only import 成为唯一按名消费方，运行时零环）。
  - Produces: `export type UnsupportedReasonCode = 'local-spec' | 'github-spec-unparseable' | 'source-unresolvable'`；`unsupportedReasonFor(target: { spec?: string; source?: string }): { code: UnsupportedReasonCode; detail: string } | null`（判定原子，分支序 local-spec → npm → github → source-unresolvable，detail 三文案逐字取自现行 synthesize 抛出点）；`upgradePathFor(item: { registryId?: string; spec?: string; source?: string }): UpgradePath`（签名与分支语义不变，内部改消费 `unsupportedReasonFor`）；`synthesizeInstallableEntry(target: InstalledPlugin): InstallableEntry`（throws 形态不变，内部改消费 `unsupportedReasonFor`）；`export class UpgradePathUnsupportedError extends Error`（`readonly upgradePath = 'unsupported'`、constructor `(pkg: string, reason: string)`、message 模板不变）。
- 验证范围：全量 `npm test` + `npm run typecheck` 全绿；`tests/market.test.mjs` 断言面零改动（仅 import 路径行变更）与金样零改动通过（零行为证明）。
- [ ] Step 1: 写失败测试——新套件从 `../lib/core/upgrade-target.js` import `upgradePathFor` / `synthesizeInstallableEntry` / `UpgradePathUnsupportedError` / `unsupportedReasonFor`，先只放从 `tests/market-mutation.test.mjs` 1187 行起「synthesizeInstallableEntry（ADR-0026 合成条目）」describe 整体迁移来的五分支断言（断言原文照搬，import 路径替换）＋ `unsupportedReasonFor` 四分支表驱动（local-spec / null(npm) / github-spec-unparseable / source-unresolvable，detail 逐字比对三条现行文案）＋ `upgradePathFor` 五分支表驱动（registryId→catalog / local→unsupported / 非 npm·github→unsupported / github spec 不解析→unsupported / 其余→synthesized）。
- Run: `node scripts/build.mjs && node --test tests/upgrade-target.test.mjs`
- Expected: `ERR_MODULE_NOT_FOUND: Cannot find module '.../lib/core/upgrade-target.js'`（红）。
- [ ] Step 2: 运行并确认失败。
- Run: `node --test tests/upgrade-target.test.mjs`
- Expected: 同上模块解析失败。
- [ ] Step 3: 最小实现——新建 `src/core/upgrade-target.ts`：迁入三符号（doc comment 原样带走，产地注释补「ADR-0028」）＋新增 `unsupportedReasonFor`；`upgradePathFor` 与 `synthesizeInstallableEntry` 的 if 链改写为 `unsupportedReasonFor` 消费（分支序与文案逐字不变）；`market.ts` / `market-mutation.ts` 删除原定义、改 `import { ... } from './upgrade-target.js'`（消费方直连，不留 re-export）；`tests/market-mutation.test.mjs` 删除已迁移 describe，import 行按残留引用同步改指：梯子用例③（约 L1175-1185，Task 5 前保留）仍引用 `UpgradePathUnsupportedError`，故该符号自本 Task 起改自 `../lib/core/upgrade-target.js` import（残留引用改指，而非「无引用才清理」）；同批完成 Files 所列 profile-ops.ts / tests/host-api-profile.test.mjs / tests/market.test.mjs 三处 import 行机械改指（断言与逻辑零触碰）。
- Change: 上述 Files 全部（Create 2 + Modify 6，共 8 文件，含三处仅 import 行改指文件）。
- [ ] Step 4: 运行并确认通过。
- Run: `npm test && npm run typecheck`
- Expected: 全量绿（含 market / market-mutation / golden 零改动通过）。
- [ ] Step 5: checkpoint commit。
- Run: `git add src/core/upgrade-target.ts tests/upgrade-target.test.mjs src/core/market.ts src/core/market-mutation.ts tests/market-mutation.test.mjs src/core/profile-ops.ts tests/host-api-profile.test.mjs tests/market.test.mjs && git commit -m "refactor(core): ADR-0028 升级目标判定原子单源——upgrade-target 纯核心迁入（Task 1）"`
- Expected: commit 成功。

### Task 2: async 壳 resolveUpgradeTarget（测试先行）

- 目标：双梯的 I/O 编排收进 `upgrade-target.ts`，本任务不接线任何 backend。
- Files:
  - Modify: `src/core/upgrade-target.ts`、`tests/upgrade-target.test.mjs`
- 接口契约：
  - Consumes: Task 1 `Produces` 全部；`mergedOutcome`（merged-market 直连 import，生成级物化）；`loadRegistry` / `fetchCommunityCatalog` 缺省实现（产地 `registry.js`（定义 registry.ts:943）/ `community.ts`——禁从 market.ts 取值，防 market↔upgrade-target 运行时环）。
  - Produces: `export type UpgradeTargetResolution = { kind: 'resolved'; entry: InstallableEntry; matchPath: 'primary' | 'community' | 'synthesized' } | { kind: 'unsupported'; reason: { code: UnsupportedReasonCode; detail: string; message: string } }`（`detail` = `unsupportedReasonFor` 原文，供 web 边缘构造重抛；`message` = `「${target.pkg}」无法自动升级：${detail}` 完整拼装，供 desktop 翻译直用——两者并存消除二次拼接漂移）；`export interface UpgradeTargetDeps { loaded?: LoadedRegistry; loadRegistry?: typeof loadRegistry; fetchCommunityCatalog?: typeof fetchCommunityCatalog }`（`loaded` 一等直通：backend 已在梯外加载过 registry 时注入复用，缺省壳内自取——TTL 缓存兜底）；`export async function resolveUpgradeTarget(target: InstalledPlugin, cfg: RegistryConfig, opts?: { namespace?: string; profile?: string; signal?: AbortSignal }, deps?: UpgradeTargetDeps): Promise<UpgradeTargetResolution>`；`export const UPGRADE_COMMUNITY_DEADLINE_MS = 60_000`。实现约束：registry `unavailable` → 跳过条目查找直接合成路径（现行语义）；社区查找窄 `catch { miss }`；`unsupported.message` 由壳内构造，不自造文案。
- 验证范围：新套件 async 分支全绿；全量 `npm test`（backend 未接线，其余零变化）。
- [ ] Step 1: 写失败测试——表驱动六分支（注入 fakeDeps 含 `loaded` 直通：primary 命中→`{kind:'resolved', matchPath:'primary'}`；primary miss + 社区让位命中→`matchPath:'community'`；双 miss + npm 已装→`matchPath:'synthesized'` 且 entry 等于现行合成形态；local spec→`{kind:'unsupported', code:'local-spec'}` 且 `message` 逐字等于现行错误文案；github spec 不解析→`code:'github-spec-unparseable'` 同上；`loaded` 为 `status:'unavailable'`→直接 synthesized，社区依赖零调用）＋ 一条「社区 fetch reject → 吞为 miss → synthesized」（窄 catch 语义钉死）＋ 一条「未注入 `loaded` → 壳内经 `deps.loadRegistry` 自取」（直通缺省路径钉死）。
- Run: `node scripts/build.mjs && node --test tests/upgrade-target.test.mjs`
- Expected: 命名导出解析失败（`The requested module ... does not provide an export named 'resolveUpgradeTarget'`，红）。
- [ ] Step 2: 确认失败（同上命令）。
- [ ] Step 3: 最小实现——`resolveUpgradeTarget` 编排照「架构快照」序实现；`deadlineAt: Date.now() + UPGRADE_COMMUNITY_DEADLINE_MS`；捕获 `UpgradePathUnsupportedError` 转 `unsupported` 联合（`reason.detail` 取自 `unsupportedReasonFor`，不自造文案）。**profile 透传逐点复刻现行两梯**（merged-market.ts `mergedOutcome` 的 `profile: string` 必传无内部缺省，错传将使社区物化代缓存段错位）：`mergedOutcome` 传 `opts?.profile ?? WEB_PROFILE`；`communityTask` / `loadRegistry` 传 raw `opts?.profile`（二者内部自缺省）——形态锚 market-mutation.ts L975-978 / profile-ops.ts L1098-1101。
- [ ] Step 4: 确认通过。
- Run: `npm test && npm run typecheck`
- Expected: 全量绿。
- [ ] Step 5: checkpoint commit（`refactor(core): ADR-0028 resolveUpgradeTarget async 壳（Task 2）`）。

### Task 3: web 梯改道

- 目标：`upgradePluginLocked` 梯段替换为 `resolveUpgradeTarget` 调用，unsupported 在边缘重抛，行为零变化。
- Files: Modify `src/core/market-mutation.ts`。
- 接口契约：
  - Consumes: Task 2 `resolveUpgradeTarget` / `UpgradeTargetResolution`。
  - Produces: 无（内部改道）。
- 验证范围：`tests/market-mutation.test.mjs` **零改动**全绿（零行为证明的主锚）；全量 `npm test` 绿。
- [ ] Step 1: 改动前检查——确认该套件现有 ADR-0026 断言面（`err instanceof UpgradePathUnsupportedError && err.upgradePath === 'unsupported'` 等用例）当前绿。
- Run: `node --test tests/market-mutation.test.mjs`
- Expected: 全绿（基线）。
- [ ] Step 2: 最小实现——`upgradePluginLocked` 内：target 查找与 `web profile 未安装该插件` 错误留原地；梯段（registryUsable 门 + primary find + `mergedOutcome` lookup + 合成兜底）整体替换为 `const resolution = await resolveUpgradeTarget(target, cfg, { namespace: opts.namespace ?? 'host', profile: opts.profile, signal: opts.signal }, { loaded, loadRegistry: deps?.loadRegistry, fetchCommunityCatalog: deps?.fetchCommunityCatalog })`（梯外已加载的 `loaded` 直通复用，零重复加载）；`resolution.kind === 'unsupported'` → `throw new UpgradePathUnsupportedError(target.pkg, resolution.reason.detail)`（构造器自拼完整 message，与现行 synthesize 直接抛出字节一致）；`resolved` → `installEntryLocked(resolution.entry, ...)` 继续现行后续（生效判定块不动）。**`DEFAULT_DEADLINE_MS` import 保留**——梯段删除后 install 侧 `resolveRegistryEntry`（约 L151 `deadlineAt` 消费）仍在用（B10 维持现状），勿随梯段一并清理。
- [ ] Step 3: 确认通过。
- Run: `npm test && npm run typecheck`
- Expected: 全量绿；`tests/market-mutation.test.mjs` 无任何 diff。
- [ ] Step 4: checkpoint commit（`refactor(core): ADR-0028 web 升级梯改道 resolveUpgradeTarget（Task 3）`）。

### Task 4: desktop 梯改道

- 目标：`desktopUpgradeLocked` 同型替换；unsupported 翻译 `DesktopOpsError('upgrade-unsupported')`；删私有 deadline 常量。
- Files: Modify `src/core/profile-ops.ts`。
- 接口契约：
  - Consumes: Task 2 全部 Produces；`DesktopOpsError`（本文件既有）。
  - Produces: 无（内部改道；`DEFAULT_COMMUNITY_DEADLINE_MS` 删除）。
- 验证范围：`tests/profile-ops.test.mjs` 零改动全绿（含 461 行「本地 file: spec 已装项 → upgrade-unsupported（B5 边界）」信封用例）；全量绿。
- [ ] Step 1: 改动前检查。
- Run: `node --test tests/profile-ops.test.mjs`
- Expected: 全绿（基线）。
- [ ] Step 2: 最小实现——梯段替换为 `resolveUpgradeTarget` 调用（deps 按 desktop 现行注入名映射：`deps.loadRegistry` / `deps.fetchCommunityCatalog`；`loaded` 直通同 Task 3）；`unsupported` → `throw new DesktopOpsError('upgrade-unsupported', reason.message)`（message 字节同现行由 synthesize 抛出、经 1113-1121 行翻译后的最终值）；删除 `DEFAULT_COMMUNITY_DEADLINE_MS` 定义；生效判定块（classifyActivation 段，梯段之后）不动（B3 不入本轮）。
- [ ] Step 3: 确认通过。
- Run: `npm test && npm run typecheck`
- Expected: 全量绿；`tests/profile-ops.test.mjs` 无任何 diff。
- [ ] Step 4: checkpoint commit（`refactor(core): ADR-0028 desktop 升级梯改道 + deadline 归一（Task 4）`）。

### Task 5: 镜像用例瘦身

- 目标：双套件中与 `tests/upgrade-target.test.mjs` 表驱动重复的梯子分支用例收敛为「接线 + 信封映射」薄断言。
- Files: Modify `tests/market-mutation.test.mjs`、`tests/profile-ops.test.mjs`。
- 接口契约：
  - Consumes: Task 2 产出的六分支表驱动覆盖。
  - Produces: 无。
- 验证范围：全量 `npm test` + `npm run lint` 绿；两套件保留 not-installed、信封映射、journal、事务边界、两步升级用例。
- [ ] Step 1: 改动前检查——grep 清点两套件中「梯子分支判定」类用例清单（primary/community/synthesized/unsupported 四类各出现在哪些 describe），与 `tests/upgrade-target.test.mjs` 覆盖表逐条对照，确定可瘦身名单。
- Run: `grep -n "unsupported\|synthes\|lookupInstalledAll\|matchInstalledByEntry" tests/market-mutation.test.mjs tests/profile-ops.test.mjs`
- Expected: 得到名单（判定类用例 ≥ 首轮迁移后剩余量）。
- [ ] Step 2: 瘦身——判定类用例删除（其分支语义已由新 seam 表驱动钉死），每个 backend 保留：① 一条「接线」断言（升级路径确实经过 resolver——以行为级断言为准，不加源码锚）；② 各自信封映射用例（web `UpgradePathUnsupportedError` instanceof；desktop `upgrade-unsupported` code）；③ not-installed / journal / 事务边界用例原样保留。
- [ ] Step 3: 确认通过。
- Run: `npm test && npm run lint`
- Expected: 全量绿。
- [ ] Step 4: checkpoint commit。
- Run: `git add tests/market-mutation.test.mjs tests/profile-ops.test.mjs && git commit -m "test: ADR-0028 镜像梯子用例瘦身——接线与信封薄层（Task 5）"`

### Task 6: AGENTS.md 导航补行

- 目标：「Owning code and tests」列出升级目标解析的 owning code 与 tests。
- Files: Modify `AGENTS.md`。
- 接口契约：Consumes Task 1–2 产出路径；Produces 无。
- 验证范围：人工核对路径与符号存在。
- [ ] Step 1: 增行——`- **Upgrade-target resolution（升级目标解析，ADR-0028）**: src/core/upgrade-target.ts; tests: tests/upgrade-target.test.mjs.`
- [ ] Step 2: 核对——`test -f src/core/upgrade-target.ts && test -f tests/upgrade-target.test.mjs && echo OK`。
- Expected: `OK`。
- [ ] Step 3: checkpoint commit（`docs(agent): ADR-0028 导航补升级目标解析（Task 6）`）。

## 执行纪律

- 开始实现前，先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划。
- 按任务顺序执行，不无声跳步、合并步或改变任务目标；每完成一个任务运行该任务定义的验证。
- 遇阻塞、重复失败或计划与仓库现实不符（尤其 Task 3/4 的 `loaded` 直通与 message 字节比对），立即停下说明，不猜。
- 若当前在 `main` 且主人未明确同意，开工前先确认分支策略。
- 全部任务完成后运行最终验证并输出修改摘要。

## 最终验证

- Run: `npm test && npm run typecheck && npm run lint`
- Expected: 三门全绿（`npm test` 经 `pretest` 构建含 client import guard）。
- Run: `git diff --exit-code <开工ref> -- tests/fixtures/market-golden.json src/client src/tools.ts src/cli.ts src/core/host-api.ts`
- Expected: exit 0（金样与零触碰面自开工起点零差异）。`<开工ref>` = 开工时 HEAD（执行时实际记录；本计划评审基线为 f6acbef）——对照开工 ref 而非工作树 vs index，防 checkpoint commit 吸收改动后判据恒绿失效。
- 输出修改摘要：列出全部改动文件与各 Task 对应 commit。

## 审阅 Checkpoint

- 计划正文结束；审阅通过前不进入实现。默认执行方为普通编码 agent 或人工执行者。
