# Profile 变更事务（Profile Transaction）实施计划

> v3（2026-09-07）：吸收第二轮评审修订。变更要点：`TransactionResult` 改为**真正的四分支判别联合**（`failure?: never` / `ok: true` 字面量类型；`TransactionError` 只收失败分支）；事实字段更名 `snapshotRestoreVerified` / `profileConverged` 并定义各态证据来源；signal 贯通完整调用链（含 uninstall/warmPackument/sleep/PluginRunner/host-api 四 mutation doorway）；Task 1 改为导出 `makeAddViaLadder` 工厂（可测试 seam）；修正 B1 测试的 fake 返回序列；FIFO 锁测试改用真实事务函数；Task 11 grep 范围收窄并新增 `renderFailure` 契约测试；快照/原子写加固改为可注入 fs 操作的确定性测试；Windows 回退加备份协议；`InstallDeps` 删除孤儿字段 `npmPackument`；阶段范围描述更正；`BASE_SHA` 固定基线验证 GUI/publish.yml 零 diff。
> v4（2026-09-07）：终审五项修订——基线改 `git update-ref refs/dsh-plan/profile-transaction-base` + 单参数工作树比较（覆盖已提交/staged/unstaged，不依赖跨任务 shell 变量；实现前先提交在案文档）；生产 `warmPackument` 缺省绑定 `makeNpmWarmPackument(timeoutMs)`（保留 timeout/signal，未绑定时 B3 跳过预热绝不调 undefined）；消费矩阵 remove/frozen/rebuild 行六类全枚举补全；`INTERNAL_ERROR` 改 **phase-aware**（快照后异常照常走统一回滚，不绕过恢复流程）；畸形 request 零写入测试落点（Task 2/5）。阶段①更名「npm 事务抽取 + 明示行为加固」。
> v5（2026-09-07，最终）：Task 3 桥接契约补清——`InstallDeps` 自 Task 3 起**非破坏性新增** `transaction?: TransactionDeps`（不再称「形状不变」）；legacy `npmPackument` 桥接必须传 `(pkg, timeoutMs, signal)` 三参；partial legacy deps 逐槽位回退生产 runner（仅注入查询类依赖时不得构造残缺 runner）+ 回退专项测试。正文版本括注统一去版本号。
> v6（2026-09-07，执行期复查修订）：执行前批判性复查发现 `tests/npm-integrity.test.mjs:226` 注入 legacy `readProfileDeps` 返回与文件内容不同的 spec（`1.2.4` vs `~1.2.3`）并断言 fail closed——verify 链入事务后该注入无桥接槽位，「现有测试零改动通过」无法达成。修法：`TransactionDeps` 增加 `readProfileDeps?: (profileDir) => Promise<Record<string,string>>` 测试缝（缺省 = 模块私有严格读取器，仿 `stripPatchedEntries`「注入仅为可测试性」先例）；Task 3 桥接映射 `deps.readProfileDeps`；Task 9 删桥时**删除该槽位**，该用例改为 fake add 真实写入漂移 spec（断言零改动，钉同一 fail-closed 行为）。

## 目标

把 profile 变更路径（npm 安装 / GitHub 安装 / 自升级 / 卸载）收进一个深模块 `src/core/profile-transaction.ts`，四个入口同一事务契约：

- **两阶段不变量（精确措辞）**：
  1. **还原阶段**：变更失败时，先把三个关键文件（package.json / pnpm-lock.yaml / pnpm-workspace.yaml）**逐字节还原到变更前快照**，还原后**立即重读比对验证**（`snapshotRestoreVerified` 报告此历史事实，不承诺终态）；
  2. **收敛阶段**：随后跑 frozen 收敛阶梯处理依赖一致性。阶梯中的 overrides 对齐 / `--no-frozen-lockfile` 重建**允许对 manifest/lockfile 做受控改写**——每一次改写以 `healActions` 记录在案。
  - 失败终态承诺「**一致**」（`status='rolled-back'`：还原已验证 + 终态一致性已证），不必然「等同」；收敛阶梯耗尽则 `status='manual-repair'`（`snapshotRestoreVerified` 独立如实报告）。参数化不变量测试在收敛 mock 返回 ok 的场景断言**最终字节等同**；B2 改写场景专项断言改写仅经记录路径发生。
- pnpm 结果只以**六类分类**穿过接缝：分类器唯一产地 `dsh-cli.ts`，**分类发生在任何文案改写之前**；事务与 market.ts 永不 regex pnpm 原始输出、只消费 `PNPM_OUTCOME_CODES` 常量。
- 结果为**四分支判别联合**：`committed` / `rejected`（快照失败、前置校验失败、排队期 abort——零写入）/ `rolled-back` / `manual-repair`；`healActions[{code, note}]` + `failure{code, note}`；中文散文只在展示层由 `renderFailure` 生成。
- 变更互斥锁收编进模块内部；外层 **10 处**调用包裹（host-api.ts ×4 含 self-upgrade、tools.ts ×3、cli.ts ×3）全部拆除。
- 顺手修掉既有缺陷：GitHub 分支绕过依赖注入（market.ts:907）、`tag` 取回即弃（market.ts:913）、卸载先动手后校验（market.ts:948）、自升级裸调 `addDshPlugin`（host-api.ts:202）、`snapshotFiles` 吞任意读取错误（npm-integrity.ts:157-165）、`atomicWriteFile` 先删后 rename 窗口（npm-integrity.ts:150-151）。

分三个各自可发版的阶段（v3 更正范围描述）：
- **阶段①**：npm 事务抽取 + 明示行为加固（B1 复验 fail-closed、快照/原子写原语加固、signal seam、生产 runner 就绪）——**不是「纯抽取」**，发版评审按加固项逐项评估；
- **阶段②**：GitHub / 卸载 / 自升级接入 + GitHub 校验收紧 + 锁收编；
- **阶段③**：删除兼容桥 + 结构化结果贯通消费方。

**行为保持的边界**：阶段①验收 = 现有测试全绿。两处现有测试未钉住的显式收紧（任务内声明并新增测试）：B1 复验失败 fail-closed（阶段①）；github spec 逐字节 + 前态比对（阶段②）。

## 架构快照

```
编排层 market.ts / host-api.ts / tools.ts / cli.ts
  （版本/收录条目解析在事务外：npmLatest/npmVersion/githubLatestTag/registry 查找）
        │ TransactionRequest（判别联合；三门均带 signal）
        ▼
runProfileTransaction(req, deps?)     ← src/core/profile-transaction.ts（唯一新模块）
  内部：validate-first（严格读取）→ 三文件字节快照 → mutate → verify → commit
        │ 或 rollback：字节还原（重读比对）→ frozen 收敛阶梯 → 孤儿移除 → live 补偿
  内部：模块级 FIFO 互斥锁；B1/B2/B3 自愈阶梯；分类消费矩阵
        │ 只消费 RunnerOutcome（class + code 常量；四操作统一收 signal）
        ▼
PnpmRunner（add/remove/frozenInstall/rebuildInstall）
  生产 adapter：makeDshRunner（dsh-cli.ts，阶段①起即为缺省）
    └─ add 走 makeAddViaLadder 工厂（导出、可注入、可测试）
  测试 adapter：mock runner（对 tmpdir 做破坏性写入后返回分类）
独立小注入：warmPackument(pkg, signal?)、setLiveDisabled
```

文件级职责：

- `src/core/profile-transaction.ts`（新建，单文件）：事务本体 + `renderFailure` + `TransactionError`；内部调用 `npm-integrity.ts` 原语（该文件两处手术式加固）。
- `src/core/dsh-cli.ts`：唯一进程适配器。阶段①：类型/`PNPM_OUTCOME_CODES`/`classifyPnpmError`/`makeAddViaLadder`/`makeDshRunner`；在途重试留在此层。
- `src/core/market.ts`：缩回纯编排；删除 B1/B2/B3、回滚、互斥锁、直接 pnpm spawn。
- `src/core/npm-integrity.ts`：两处手术式加固（快照仅吞 ENOENT；原子写 rename 优先 + Windows 备份回退），并为两者增加**模块内部可注入 fs 操作**（自测用，不进对外接口）。
- `installed.ts`、`versions.ts`、`live-plugin.ts`、`registry*.ts`、`src/client/**` 不改。

### 接口定稿（全计划唯一权威定义）

```ts
// ===== src/core/dsh-cli.ts 追加（阶段①）=====
export type PnpmOutcomeClass =
  | 'ok' | 'retryable-lag' | 'config-drift' | 'unused-patch' | 'needs-builds' | 'hard-fail'

export const PNPM_OUTCOME_CODES = {
  CONFIG_MISMATCH: 'ERR_PNPM_LOCKFILE_CONFIG_MISMATCH',
  OUTDATED_LOCKFILE: 'ERR_PNPM_OUTDATED_LOCKFILE',
  NO_MATCHING_VERSION: 'ERR_PNPM_NO_MATCHING_VERSION',
  UNUSED_PATCH: 'ERR_PNPM_UNUSED_PATCH',
  PUBLIC_HOIST_PATTERN_DIFF: 'ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF',
} as const

export interface RunnerOutcome {
  readonly class: PnpmOutcomeClass
  readonly code?: string                 // 已知决策 code 取 PNPM_OUTCOME_CODES 的值；hard-fail 可保留其他 ERR_PNPM_* 诊断码
  readonly output: string                // ≤800 字符（runner 边界统一截断）
  readonly usedAllowAllBuilds?: boolean  // 仅 add·ok
}

export function classifyPnpmError(text: string): { class: PnpmOutcomeClass; code?: string }

/** PluginRunner seam 增补 signal（runDshPlugin 透传到 runCommand.options.signal） */
export type PluginRunner = (
  profile: string, pluginArgs: string[], options?: { signal?: AbortSignal },
) => Promise<string>

/** 加装阶梯工厂（v3：导出、可注入、可测试）。永不 throw，一律 RunnerOutcome。 */
export function makeAddViaLadder(deps: {
  runDshPlugin: PluginRunner
  allowAllBuilds?: (profileDirectory: string) => boolean
}): (source: string, profileDir: string, signal?: AbortSignal) => Promise<RunnerOutcome>

export interface PnpmRunner {
  add(spec: string, signal?: AbortSignal): Promise<RunnerOutcome>
  remove(pkg: string, signal?: AbortSignal): Promise<RunnerOutcome>
  frozenInstall(signal?: AbortSignal): Promise<RunnerOutcome>
  rebuildInstall(signal?: AbortSignal): Promise<RunnerOutcome>
}

export function makeDshRunner(profileDir: string): PnpmRunner
// add = makeAddViaLadder({runDshPlugin})；remove 包 removeDshPlugin（原始文本分类）；
// frozen/rebuild = runCommand('pnpm', …) 包装 + 分类；四操作收 signal；output 截 800

// ===== src/core/profile-transaction.ts（新模块全部导出）=====
export type TransactionRequest =
  | { kind: 'install-npm';    pkg: string; version: string; integrity: string; signal?: AbortSignal }
  | { kind: 'install-github'; repo: string; sha: string; tag?: string; signal?: AbortSignal }
  | { kind: 'uninstall';      pkg: string; signal?: AbortSignal }
// 自升级 = install-npm + pkg=自身（语义等同，不设独立 kind）

export interface HealAction { code: (typeof TX_HEAL_CODES)[number]; note: string }

export const TX_HEAL_CODES = [
  'RANGE_ANCHOR_ACCEPTED', 'B1_MANIFEST_KEYS_RESTORED', 'B1_FROZEN_REVERIFY_FAILED',
  'B2_OVERRIDES_ALIGNED', 'B2_FROZEN_REVERIFY_OK', 'B2_LOCKFILE_REBUILT',
  'B3_LAG_RETRY', 'B3_PACKUMENT_WARMED', 'BUILDS_ALLOWED',
  'ROLLBACK_BYTES_RESTORED', 'ROLLBACK_CONVERGED_FROZEN', 'ROLLBACK_FALLBACK_REMOVED',
  'ROLLBACK_VERIFY_FAILED', 'LIVE_DISABLED', 'LIVE_REENABLED', 'LIVE_REENABLE_FAILED',
  'PATCH_ENTRIES_STRIPPED',
] as const

export const TX_FAILURE_CODES = [
  'DEP_MISSING_AFTER_ADD', 'DEP_VERSION_MISMATCH', 'LOCKFILE_MISSING', 'LOCK_INTEGRITY_MISMATCH',
  'GITHUB_SPEC_MISMATCH', 'ADD_RETRY_EXHAUSTED', 'ADD_FAILED', 'POST_MUTATION_CONVERGENCE_FAILED',
  'NOT_INSTALLED', 'NOT_DSH_PLUGIN', 'REMOVE_FAILED', 'STILL_PRESENT_AFTER_REMOVE',
  'ROLLBACK_FAILED', 'SNAPSHOT_FAILED', 'ABORTED', 'INTERNAL_ERROR',
  'PROFILE_MANIFEST_UNREADABLE', 'PROFILE_MANIFEST_INVALID', 'PLUGIN_METADATA_UNREADABLE',
] as const

export interface TransactionFailure { code: (typeof TX_FAILURE_CODES)[number]; note: string }

export interface TransactionDeps {
  runner?: (profileDir: string) => PnpmRunner   // 缺省 = makeDshRunner
  warmPackument?: (pkg: string, signal?: AbortSignal) => Promise<void>
  setLiveDisabled?: (pkg: string, disabled: boolean) => Promise<boolean>
  /** 卸载门的补丁条目摘除（缺省 = dsh-cli removePatchedDependencyEntries）；注入仅为可测试性 */
  stripPatchedEntries?: (profileDir: string, pkg: string) => { changed: boolean; orphanedPatchFiles: string[] }
  retryDelaysMs?: readonly number[]             // 默认 [5_000, 15_000]；测试 [0, 0]
  profileDir?: string                           // 缺省 webProfileDir()；测试 tmpdir
  /** verify 相读取 profile 依赖（缺省 = 模块私有严格读取器）；仅为桥接/可测试性注入，Task 9 删桥时移除 */
  readProfileDeps?: (profileDir: string) => Promise<Record<string, string>>
}

/**
 * 生产预热绑定：market.ts / host-api.ts 生产路径使用
 * `warmPackument: deps?.transaction?.warmPackument ?? makeNpmWarmPackument(cfg.timeoutMs ?? 20_000)`。
 * fetcher 参数仅测试注入；失败吞错。deps 未提供且调用方未绑定时，
 * 事务内 B3 跳过预热仅重试——绝不调用 undefined。
 */
export function makeNpmWarmPackument(
  timeoutMs: number,
  fetcher: (pkg: string, timeoutMs: number, signal?: AbortSignal) => Promise<unknown> = npmPackument,
): (pkg: string, signal?: AbortSignal) => Promise<void>

// ---------- 四分支判别联合 ----------
interface TransactionBase {
  readonly kind: TransactionRequest['kind']
  readonly healActions: HealAction[]            // 按发生顺序；committed 也可非空
  readonly output: string                       // ≤800
}
interface CommittedResult extends TransactionBase {
  readonly status: 'committed'
  readonly ok: true
  readonly failure?: never
  readonly snapshotRestoreVerified: false       // 未发生还原
  readonly profileConverged: true               // 证据：安装/卸载专属 verify 成功
  readonly needsRestart: true
  // 载荷（按门）：
  readonly pkg?: string; readonly spec?: string; readonly version?: string
  readonly sha?: string; readonly tag?: string; readonly usedAllowAllBuilds?: boolean
  readonly liveDisabled?: boolean; readonly orphanedPatchFiles?: string[]
}
interface RejectedResult extends TransactionBase {
  readonly status: 'rejected'
  readonly ok: false
  readonly failure: TransactionFailure          // SNAPSHOT_FAILED / NOT_* / ABORTED / …
  readonly snapshotRestoreVerified: false
  readonly profileConverged: false              // 未执行
  readonly needsRestart?: never
}
interface RolledBackResult extends TransactionBase {
  readonly status: 'rolled-back'
  readonly ok: false
  readonly failure: TransactionFailure
  readonly snapshotRestoreVerified: true        // 证据：还原后重读比对通过
  readonly profileConverged: true               // 证据：收敛阶梯最终通过
  readonly needsRestart?: never
}
interface ManualRepairResult extends TransactionBase {
  readonly status: 'manual-repair'
  readonly ok: false
  readonly failure: TransactionFailure
  readonly snapshotRestoreVerified: boolean     // 还原本身可能也失败（ROLLBACK_FAILED）
  readonly profileConverged: false
  readonly needsRestart?: never
}
export type TransactionResult =
  | CommittedResult | RejectedResult | RolledBackResult | ManualRepairResult
export type FailedTransactionResult = Exclude<TransactionResult, CommittedResult>

export function renderFailure(r: FailedTransactionResult): string

export class TransactionError extends Error {
  constructor(readonly result: FailedTransactionResult)  // super(renderFailure(result))
}

export async function runProfileTransaction(
  req: TransactionRequest,
  deps?: TransactionDeps,
): Promise<TransactionResult>
```

**分类消费矩阵**（模块内部 switch 的权威定义）：

| runner 操作 | ok | retryable-lag | config-drift | unused-patch | needs-builds | hard-fail |
|---|---|---|---|---|---|---|
| add（npm） | → verify 相 | B3：退避（abort-aware sleep）→warm→重试；耗尽 → `ADD_RETRY_EXHAUSTED` → 回滚 | → `ADD_FAILED` → 回滚 | → `ADD_FAILED` → 回滚 | → `ADD_FAILED` → 回滚（在途 allowAllBuilds 重试已在 adapter 耗尽） | → `ADD_FAILED` → 回滚 |
| add（github） | → verify 相 | 不适用，按 hard-fail | → `ADD_FAILED` → 回滚 | → `ADD_FAILED` → 回滚 | → `ADD_FAILED` → 回滚 | → `ADD_FAILED` → 回滚 |
| remove | → verify gone | → `REMOVE_FAILED` → 回滚 | → `REMOVE_FAILED` → 回滚 | → `REMOVE_FAILED` → 回滚 | → `REMOVE_FAILED` → 回滚 | → `REMOVE_FAILED` → 回滚 |
| frozenInstall（还原后收敛 / B1 复验） | 收敛完成 | → 收敛失败 → manual-repair | code=CONFIG_MISMATCH：B2-L1 对齐 → 复验；仍失配 → rebuild；code=OUTDATED_LOCKFILE：直接 rebuild | → 收敛失败 → manual-repair（不 rebuild，保持还原字节） | → 收敛失败 → manual-repair | → 收敛失败 → manual-repair |
| rebuildInstall | 收敛完成（`B2_LOCKFILE_REBUILT`） | → manual-repair | → manual-repair | → manual-repair | → manual-repair | → manual-repair |

矩阵测试以六类**全枚举参数化**覆盖 remove 与 rebuildInstall 行（防表格与实现 switch 漏列）。

**类型之外的契约**（写进模块头注释）：

1. 前置：request 必须已解析到底；模块内除 `warmPackument` 外零网络。
2. **throw 政策与未预期异常（v4 phase-aware）**：预期的领域失败一律返回 `TransactionResult`；仅**畸形 request** 抛 TypeError——畸形定义为：`isSafePkgName`/`isSafePluginTarget` 不通过、github repo 非 `owner/repo` 形状、SHA 非 40 位十六进制、integrity 空白——**校验先于 runner factory 调用与任何读写**，零写入。未预期异常（依赖抛错、runner 违反「永不 throw」约定、文件写失败等）由顶层 catch 捕获并**按阶段分流**：快照完成前且无写入 → `rejected` + `INTERNAL_ERROR`；快照后或 mutation 已开始 → failure code 保留 `INTERNAL_ERROR`，**照常执行不可取消的统一回滚/收敛/live 补偿**——回滚成功 → `rolled-back` + `INTERNAL_ERROR`；回滚失败 → `manual-repair`（note 合并 `ROLLBACK_FAILED` 信息）。模块内部维护 `snapshotTaken`/`mutationStarted` 阶段标志。
3. 四态语义与证据来源：`snapshotRestoreVerified`（还原后重读比对的历史事实；committed 恒 false 因为未发生还原）、`profileConverged`（committed=门专属 verify 成功；rolled-back=收敛阶梯通过；rejected/manual-repair=false）。不声称 node_modules 字节级回滚。
4. **signal 语义（v3 贯通）**：`req.signal` 贯通 `PnpmRunner` 四操作、`warmPackument` 与 B3 退避 sleep（abort 即醒）；排队期或 mutate 前 abort → `rejected` + `ABORTED`；mutate 已开始后 abort → 中止在途调用并执行**不可取消的**回滚（failure code 保留 `ABORTED`，终态 rolled-back 或 manual-repair）；回滚/收敛阶段不传外部 signal（不变量优先于取消）。
5. 串行：模块级 FIFO promise 链，进程内互斥；不得在 runner 回调里再调 `runProfileTransaction`；跨进程并发不在覆盖范围。
6. uninstall 定序固定：validate（严格读取）→ 快照 → live-disable → 摘补丁 → remove → verify gone；失败回滚时 live 尽力反向。
7. 事务内一切 profile 读取用**严格读取器**（模块私有）：manifest 读异常 → `PROFILE_MANIFEST_UNREADABLE`、JSON 非法 → `PROFILE_MANIFEST_INVALID`、插件元数据不可读 → `PLUGIN_METADATA_UNREADABLE`；宽容读取只属列表页。
8. github 校验：存在键 `k` 使 `depsNow[k] === spec` **且** `snapshotDeps[k] !== spec`（相对前态变化，防旧依赖误命中）；无 → `GITHUB_SPEC_MISMATCH`。
9. 拒绝的假想 seam：FsPort、时钟 port、锁 port、每 doorway 一模块、版本解析 port。（`npm-integrity.ts` 加固用的可注入 fs 操作是**内部 seam**，仅供其自测，不进对外接口。）演化路径：第 5 个 doorway 或策略式扩展真出现时再评估「计划解释器 + 自愈策略链」。

## 全局约束

- Node.js `>=22`、单包 ESM；`lib/` 是构建产物——**每次验证前必须 `npm run build`**。
- profile 的 `package.json` 是唯一事实源，不引入任何额外状态文件（快照瞬态）。
- 不承诺 node_modules 字节级回滚；还原承诺按「目标」节两阶段精确措辞执行。
- npm 安装精确版本锁定 + dist integrity fail closed；GitHub 安装锁定 commit SHA。
- 三条现有中文报错**逐字保持**（`renderFailure` 契约测试钉住）：`安装失败，已回滚到安装前状态（…）：…`、`integrity 校验失败，已回滚到安装前状态（…）：…`、`…依赖回滚也失败（…），profile 可能需要人工修复`；成功 `output` 追加 `\n[dsh-m 自愈] …` 后缀。文案唯一产地 `renderFailure`。
- `code` 英文稳定串；用户可见文案中文。
- 不创建或修改任何监听 3080 的进程/服务；不改 systemd shim；`publish.yml` 一字不改（最终门禁机器验证）。
- `npm run typecheck` 不覆盖 client JSX；`src/client/main.jsx` 零 diff（基线 ref 工作树比较机器验证）。
- **测试不得触碰真实 web profile**：经 `installFromRegistry`/`uninstallPlugin`/host-api 的测试必须注入 `transaction: { profileDir: <tmpdir>, runner: mock }`；迁移后加 tmpdir 守护断言。
- 每阶段收口一次 checkpoint commit，独立可发版。

## 输入工件

- grilling 共识（17 项决定，2026-09-07 定稿）。
- design-it-twice 定稿接口（v3 按两轮评审修订）。
- 评审报告第一轮（🔴×6、🟡×7、准确性 ×2）与第二轮（🔴×6、🟡×8、裁决接受 ×3）——处置见「评审处置记录」。
- `CONTEXT.md`（v3 同步修订）。
- `docs/DESIGN.md` §3（阶段③重写）。

## 文件结构与职责

- Create: `src/core/profile-transaction.ts`
- Create: `tests/profile-transaction.test.mjs`（参数化不变量 + 消费矩阵/B1/B2/abort/FIFO/renderFailure 契约）
- Create: `tests/pnpm-outcome.test.mjs`（分类表 + `makeAddViaLadder` + `makeDshRunner` 四操作×六类）
- Create: `tests/fixtures/pnpm-errors.mjs`（原始 pnpm 文本；标注来源）
- Modify: `src/core/dsh-cli.ts`（①：常量/类型/分类器/`makeAddViaLadder`/`makeDshRunner`；`PluginRunner`/`runDshPlugin`/`removeDshPlugin` 增补 signal）
- Modify: `src/core/npm-integrity.ts`（①：两处加固 + 内部可注入 fs 操作）
- Modify: `src/core/market.ts`（① npm 接入 → ② github/uninstall 接入 → ③ 删桥缩型）
- Modify: `src/core/host-api.ts`（② self-upgrade + onMutation 删除 + signal 贯通四 doorway；③ TransactionError→detail）
- Modify: `src/tools.ts`（② 拆锁 ×3；③ render 消费结构）
- Modify: `src/cli.ts`（② 拆锁 ×3）
- Modify: `src/host.ts`（② 删 import/传参）
- Modify: `tests/rollback-heal.test.mjs`（③ 注入迁移、断言迁 code）
- Modify: `tests/npm-integrity.test.mjs`（③ 旧注入迁移 + 加固原语的新测试承载于本文件或 profile-transaction 测试）
- Modify: `tests/uninstall-patch.test.mjs`（② market 级迁移；直测保留）
- Modify: `tests/host-api.test.mjs`（② self-upgrade 委派用例；③ detail 投影用例）
- Modify: `docs/DESIGN.md` §3（③）；`CONTEXT.md`（v3 已同步）
- 边界保持稳定：`installed.ts`、`versions.ts`、`live-plugin.ts`、`registry*.ts`、`src/client/**`。

## 任务清单

### Task 0: 固定实现基线（git ref）

- 目标：为最终零 diff 门禁固定基线；**不依赖跨任务 shell 变量**。
- [ ] Step 1: 提交在案文档（当前工作区有未提交的 `CONTEXT.md` 与本计划文件）
- Run: `git add CONTEXT.md docs/plans/2026-09-07-profile-transaction-implementation-plan.md && git commit -m "docs(tx): Profile 变更事务实施计划（终稿）+ 领域术语" && git status --porcelain`
- Expected: 提交成功且 `git status --porcelain` 无输出（工作区干净；若仍有其他未跟踪/修改文件，先与用户确认处理方式）。
- [ ] Step 2: 创建基线 ref
- Run: `git update-ref refs/dsh-plan/profile-transaction-base HEAD && git rev-parse refs/dsh-plan/profile-transaction-base`
- Expected: 输出基线 sha。最终验证用 `git diff --exit-code refs/dsh-plan/profile-transaction-base -- <paths>`（单参数形式比较**基线提交 vs 当前工作树**，同时覆盖已提交/staged/unstaged 改动）。

### Task 1: dsh-cli.ts 分类器、code 常量与可测试加装阶梯工厂

- 目标：分类先于文案改写；加装阶梯成为导出、可注入、可测试的 seam。
- Files:
  - Modify: `src/core/dsh-cli.ts`（锚点：`rewritePnpmError`/`addDshPlugin`/`PluginRunner`/`runDshPlugin`/`removeDshPlugin`）
  - Test: `tests/pnpm-outcome.test.mjs`
- 接口契约:
  - Consumes: 现有阶梯逻辑（:457-493）、`isPrepareBlocked`、`writeDangerouslyAllowAllBuilds`、`runCommand`
  - Produces: `PnpmOutcomeClass`、`RunnerOutcome`、`PNPM_OUTCOME_CODES`、`classifyPnpmError`、`PluginRunner`（增补 signal）、`makeAddViaLadder`（Task 2 依赖）
- 实现要点:
  - `classifyPnpmError` 映射：NO_MATCHING_VERSION→retryable-lag；CONFIG_MISMATCH/OUTDATED_LOCKFILE→config-drift（code 区分）；UNUSED_PATCH→unused-patch；`isPrepareBlocked`→needs-builds；其余→hard-fail（code 取首个 `ERR_PNPM_*` 匹配或缺省）。
  - `PluginRunner` 与 `runDshPlugin`/`removeDshPlugin` 的 deps 增补 `signal`，透传到 `runCommand.options.signal`（runCommand 已支持）。
  - `makeAddViaLadder(deps)`：阶梯逻辑自 `addDshPlugin` 提出——ok / prepare-blocked→allowAllBuilds 重试 / PUBLIC_HOIST_DIFF→no-frozen 重建重试 / 耗尽——对**原始错误文本**分类，`RunnerOutcome` 返回永不 throw。`addDshPlugin` 变薄包装（调工厂，非 ok 时 throw，对 legacy 调用方保持现行报错形状）。
- [ ] Step 1: 写失败测试——分类表六类（CONFIG_MISMATCH 与 OUTDATED_LOCKFILE 的 code 不同）；`makeAddViaLadder`（注入 fake `runDshPlugin`/`allowAllBuilds`）：ok / prepare-blocked→重试→ok（`usedAllowAllBuilds:true`）/ PUBLIC_HOIST→重建→重试 / 全耗尽→hard-fail 且永不 throw / signal abort → 在途调用收到 signal。
- Run: `npm run build && node --test tests/pnpm-outcome.test.mjs`
- Expected: 导出不存在，导入失败。
- [ ] Step 2: 确认失败
- [ ] Step 3: 实现（常量/类型/分类器/工厂/seam 增补；`addDshPlugin` 行为保持）
- [ ] Step 4: 确认通过
- Run: `npm run build && node --test tests/pnpm-outcome.test.mjs && npm test`
- Expected: 新旧全 pass。
- [ ] Step 5: checkpoint commit（`feat(tx): 分类器 + PNPM code 常量 + makeAddViaLadder`）

### Task 2: profile-transaction 模块、makeDshRunner 与原语加固

- 目标：事务模块落地（install-npm 门）+ 生产 runner 即刻可用 + 快照/原子写加固（确定性测试）+ B1 复验 fail-closed + 四分支联合结果。
- Files:
  - Create: `src/core/profile-transaction.ts`
  - Modify: `src/core/dsh-cli.ts`（追加 `makeDshRunner`）
  - Modify: `src/core/npm-integrity.ts`（加固 ×2 + 内部可注入 fs 操作）
  - Test: `tests/profile-transaction.test.mjs`
- 接口契约:
  - Consumes: Task 1 全部产物；`npm-integrity.ts` 原语；严格读取器（模块私有）
  - Produces: 接口定稿全部导出（本阶段 kind 仅 `'install-npm'`）；`makeDshRunner` 为 runner 缺省；`makeNpmWarmPackument` 生产预热绑定
- 原语加固（npm-integrity.ts，手术式 + 内部注入缝）:
  1. `snapshotFiles(paths, fsOps?)`：仅 `ENOENT` → `existed:false`；其他异常 throw（事务 catch → `rejected` + `SNAPSHOT_FAILED`，零写入）。
  2. `atomicWriteFile(path, bytes, fsOps?)`：POSIX 直接 `rename`（原子覆盖）；仅 `EPERM`/`EEXIST`（Windows）走**备份协议**：`target→backup`、`tmp→target`、失败 `backup→target` 恢复、成功删 backup；任何失败清理 tmp。`fsOps` 参数缺省真 fs，仅供本文件测试注入（内部 seam）。
- 搬移清单（market.ts → profile-transaction.ts）: `frozenInstallWithHeal`（:683-718，改消费 RunnerOutcome 按矩阵）、`addDshPluginWithRetry`（:725-748，改 runner.add + abort-aware 退避 + warmPackument）、`restoreManifestKeys`（:623-644）、`restoreOverridesFromLock`（:652-675）、`specAnchoredAtVersion`（:768-771）、`errText`/`sleep`（sleep 改 abort-aware）、快照列表（:826-830）、verify 链（:836-852，严格读取器）、B1 成功路径（:853-862）、回滚编排含 originallyAbsent（:872-904）。
- 显式行为收紧（现有测试未钉住，任务内声明并测试）:
  - B1 找回键后复验失败（含 rebuild 后仍失败）→ 进回滚，`failure.code='POST_MUTATION_CONVERGENCE_FAILED'`；`B1_FROZEN_REVERIFY_FAILED` 只是过程 healAction。
  - 回滚还原后重读比对，不一致 → `ROLLBACK_VERIFY_FAILED` + `manual-repair`。
- 结果组装：四个模块私有 builder（committed/rejected/rolledBack/manualRepair）构造联合分支，类型层即防非法组合。
- [ ] Step 1: 写失败测试——
  1. 参数化不变量（install-npm）：mock add 破坏性写入后 ok（验证相必炸）、mock frozen/rebuild ok → `status:'rolled-back'`、`snapshotRestoreVerified:true`、`profileConverged:true`、**三文件最终字节 === before**、healActions 含 `ROLLBACK_BYTES_RESTORED`；
  2. B2 改写专项：frozen 两次 CONFIG_MISMATCH → `B2_OVERRIDES_ALIGNED` + `B2_LOCKFILE_REBUILT` 记录在案、`rolled-back`、`profileConverged:true`（此场景不断言最终字节等同）；
  3. **B1 复验失败（v3 修正 fake 序列）**：fake add 写丢 pnpm 键 → B1 frozen → CONFIG_MISMATCH → B1 rebuild → CONFIG_MISMATCH（触发 `POST_MUTATION_CONVERGENCE_FAILED` 进回滚）→ **回滚后 frozen → ok**；断言 `status:'rolled-back'`、`failure.code==='POST_MUTATION_CONVERGENCE_FAILED'`、`profileConverged:true`；（另立一例：回滚后 frozen/rebuild 也全失败 → `manual-repair`、`profileConverged:false`）；
  4. 快照失败（**注入 `fsOps.readFile` 抛 `EACCES`**，不用 chmod）：`rejected` + `SNAPSHOT_FAILED` + 三文件字节未动；`ENOENT` 单列一例 → 正常 `existed:false`；
  5. 原子写专项（注入 `fsOps.rename`）：首次即 rename 成功（无 rm 路径）；`EPERM` 才走备份协议；第二次 rename 失败 → backup 恢复目标存在；失败后 tmp 清理；
  6. B3：add retryable-lag ×2 后 ok → warm 调 2 次、`B3_LAG_RETRY` ×2；退避中 abort → 立即唤醒；
  7. abort：add 挂起时 abort → `ABORTED`（未写入 → `rejected`；已写入 → `rolled-back`）；
  8. FIFO 锁：**真实 `runProfileTransaction`** ×2 并发（tmpdir + mock runner 记录 in-flight 峰值）→ 峰值 ≤1；
  9. `renderFailure` 契约：三个 legacy 文案逐字断言 + committed 无 failure 的类型/运行时断言；
  10. **畸形 request**：install-npm unsafe pkg、install-npm 空白 integrity → 断言抛 `TypeError`、runner factory 零调用、runner 操作零调用、`setLiveDisabled` 零调用、三文件字节未变；
  11. **INTERNAL_ERROR phase-aware**：a) runner factory 在快照前 throw → `rejected` + `INTERNAL_ERROR`、文件未动；b) mock `add` **先做破坏性写入再 throw** → 事务执行回滚 → `rolled-back` + `INTERNAL_ERROR` + 三文件字节还原；
  12. **makeNpmWarmPackument**：注入 fake fetcher → 断言 `(pkg, timeoutMs, signal)` 逐参传递、失败吞错不抛；
  13. **warm 缺省行为**：不提供 `warmPackument` 时 B3 仍退避重试（不预热、不抛 undefined）。
- Run: `npm run build && node --test tests/profile-transaction.test.mjs`
- Expected: 模块不存在，导入失败。
- [ ] Step 2: 确认失败
- [ ] Step 3: 实现（搬移 + 加固 + 收紧 + builder；`renderFailure` 按 status 产出 legacy 同形文案）
- [ ] Step 4: 确认通过
- Run: `npm run build && node --test tests/profile-transaction.test.mjs && node --test tests/npm-integrity.test.mjs`
- Expected: 全 pass。
- [ ] Step 5: checkpoint commit（`feat(tx): 事务模块（install-npm）+ makeDshRunner + 原语加固`）

### Task 3: market.ts npm 分支接入事务（行为保持桥）

- 目标：npm 分支缩回「解析 → 开事务 → 包装」；现有测试零改动通过（新增的桥接回退专项测试除外）。
- Files:
  - Modify: `src/core/market.ts`（锚点：`installEntry` :789-905 npm 分支、`InstallDeps` 类型）
  - Test: `tests/market.test.mjs`（新增桥接回退用例）
- 接口契约:
  - Consumes: Task 2 全部导出
  - Produces: `installFromRegistry`/`installEntry` 对外**签名**不变；`InstallDeps` 自本任务起**非破坏性新增** `transaction?: TransactionDeps`（**v5：不再称「形状不变」**；旧兼容槽位保留至 Task 9 删除）；Task 9 依赖的最终形状见 Task 9
- **桥接构造规则（v5 定稿，`txDepsFrom(deps, timeoutMs)` 内部实现）**:
  ```ts
  const profileDir = deps?.transaction?.profileDir ?? deps?.profileDir ?? webProfileDir()
  const productionRunner = makeDshRunner(profileDir)
  // 仅当存在旧 mutation 注入槽位时才构造 legacy runner；每个未注入的操作回退 productionRunner
  const runner = hasLegacyMutationOverrides(deps)
    ? bridgeLegacyRunnerWithPerOperationFallbacks(deps, productionRunner)
    : (deps?.transaction?.runner ?? productionRunner)
  const txDeps: TransactionDeps = {
    ...deps?.transaction,
    profileDir,
    runner: (dir) => runner,          // 工厂形态；dir 与 profileDir 一致
    warmPackument:
      deps?.transaction?.warmPackument ??
      (deps?.npmPackument
        ? (pkg, signal) => deps.npmPackument!(pkg, timeoutMs, signal)   // v5：三参，不丢 timeout/signal
        : makeNpmWarmPackument(timeoutMs)),
    retryDelaysMs: deps?.transaction?.retryDelaysMs ?? deps?.retryDelaysMs,
    readProfileDeps: deps?.transaction?.readProfileDeps ?? deps?.readProfileDeps,
  }
  ```
  - legacy runner 包装：成功→ok+output+usedAllowAllBuilds，throw→`{...classifyPnpmError(errText), output: errText}`；**未注入的槽位逐操作回退 `productionRunner` 对应方法**；
  - 仅注入查询类依赖（`loadRegistry`/`npmLatest`/`npmVersion` 等）而未注入任何 mutation 槽位时，`hasLegacyMutationOverrides` 为 false——**不得构造残缺 legacy runner**，直接用 `deps?.transaction?.runner ?? productionRunner`；
  - `req.signal` 贯通到 runner 操作与 warm。
- 文案：失败一律 `throw new TransactionError(r)`；旧文案由 `renderFailure` 唯一产出。
- 删除: 已搬走的函数/常量/正则与 `defaultRestoreInstall`/`defaultRebuildInstall`。
- [ ] Step 1: 写失败测试（桥接回退专项）——`tests/market.test.mjs` 新增用例：注入 `{ loadRegistry, npmLatest, profileDir: tmpdir, transaction: { runner: () => mockRunner } }` 而**不注入**任何 add/remove/frozen/rebuild 槽位 → 断言安装流程中 runner 操作全部落在 `mockRunner` 上（回退到注入的 transaction runner，零 undefined 调用、不触碰真实 `dsh`）；另一例：仅注入 `addDshPlugin` 一个槽位 + `transaction.runner` → 断言 add 走 legacy fake、frozen/rebuild 回退 `transaction.runner`。
- Run: `npm run build && node --test tests/market.test.mjs`
- Expected: 新用例失败（桥尚未实现）。
- [ ] Step 2: 确认失败
- [ ] Step 3: 改写 npm 分支 + 桥接构造 + `InstallDeps` 增 `transaction?` 字段 + 删搬走代码（github/uninstall 本阶段不动）
- [ ] Step 4: 确认通过（验收 = rollback-heal 全部正则断言零改动通过 + 新回退用例通过）
- Run: `npm run build && npm test && npm run typecheck`
- Expected: 全 pass（typecheck 确认 `transaction` 字段已入类型）。
- [ ] Step 5: checkpoint commit（`refactor(tx): npm 安装走事务（行为保持 + 桥接逐槽回退）`）

### Task 4: 阶段① 收口验证

- [ ] Step 1: 全量
- Run: `npm run build && npm run typecheck && npm test`
- Expected: 全 pass。
- [ ] Step 2: 文案唯一产地（机器门禁）
- Run: `test "$(grep -rl '已回滚到安装前状态' lib/core/ | sort)" = "lib/core/profile-transaction.js" && echo OK`
- Expected: OK。

### Task 5: 事务模块补 install-github 与 uninstall 两门

- 目标：四门齐备；github 获得保护；卸载获得校验前置 + 快照 + 回滚。
- Files: Modify `src/core/profile-transaction.ts`；Test `tests/profile-transaction.test.mjs`
- 接口契约:
  - Consumes: `removePatchedDependencyEntries`、`setLivePluginDisabled`（作缺省）、`resolvePluginDir`
  - Produces: 完整 `TransactionRequest`（三门均含 signal）；committed 载荷 `pkg/tag/liveDisabled/orphanedPatchFiles` 生效
- install-github: `spec='github:'+repo+'#'+sha`；`runner.add(spec, signal)`（无 B3）；verify 按契约 8（前态比对）；key 回填 `result.pkg`；`tag` 透传；失败回滚同 npm 门。
- uninstall（定序写死）: 1) validate（严格读取：`PROFILE_MANIFEST_UNREADABLE`/`PROFILE_MANIFEST_INVALID`/`NOT_INSTALLED`/`PLUGIN_METADATA_UNREADABLE`/`NOT_DSH_PLUGIN`，全部 `rejected` 零写入零快照）→ 2) 快照 → 3) `setLiveDisabled(pkg,true)` → 4) `removePatchedDependencyEntries` → 5) `runner.remove(pkg, signal)`（非 ok→`REMOVE_FAILED` 回滚）→ 6) verify gone（仍存在→`STILL_PRESENT_AFTER_REMOVE` 回滚）。回滚：还原→收敛→originallyAbsent 补移除→live 反向。
- [ ] Step 1: 写失败测试——参数化扩 4 门（uninstall fixture 含 `node_modules/pkg-a/package.json` dsh 字段）；专项：uninstall 三种 rejected 零写入零快照；github 旧 spec 误命中（预置同 spec 旧依赖、mock add 不改文件）→ `GITHUB_SPEC_MISMATCH`；github 不匹配→回滚字节还原；uninstall 中途 abort → 回滚不可取消、终态 rolled-back；**畸形 request**：install-github unsafe repo、install-github 非 40 位 hex SHA、uninstall unsafe pkg → 抛 `TypeError` + runner factory/操作/`setLiveDisabled` 零调用 + 三文件字节未变；**patch cleanup 部分写入后 throw**：注入 `stripPatchedEntries` fake——先真实改写 tmpdir 的 workspace yaml 一半再 throw → 事务回滚后三文件字节还原且 live 反向补偿被尝试（`LIVE_REENABLED`/`LIVE_REENABLE_FAILED` 记录在案）。
- Run: `npm run build && node --test tests/profile-transaction.test.mjs`
- Expected: 新用例失败。
- [ ] Step 2: 确认失败
- [ ] Step 3: 实现两门
- [ ] Step 4: 确认通过
- Run: `npm run build && node --test tests/profile-transaction.test.mjs`
- Expected: 全 pass（含 Task 2 不回归）。

### Task 6: market.ts github 分支与 uninstallPlugin 接入事务

- 目标/锚点同 v2。`InstallResult` 增 `tag?` 与 `healActions`；`UninstallResult` 增 `healActions`；映射表：`spec/version/sha/tag/usedAllowAllBuilds ← result 同名字段`、`output ← result.output + 自愈后缀`；`UninstallDeps` 改 `{ transaction?: TransactionDeps }`；github 分支修 DI 绕过（`deps?.githubLatestTag ?? defaultGithubLatestTag`）；`leftoverCandidates` 留 market.ts；`opts.signal` 进 request。
- Files: Modify `src/core/market.ts`、`tests/uninstall-patch.test.mjs`（market 级用例迁 `transaction` 注入，直测保留）
- [ ] Step 1: 基线（`npm run build && npm test` 全 pass）
- [ ] Step 2: 两处接入 + 类型映射 + 测试迁移
- [ ] Step 3: 确认通过（`npm run build && npm test && npm run typecheck`）
- [ ] Step 4: checkpoint commit（`refactor(tx): github/卸载走事务，校验前置`）

### Task 7: 自升级接事务 + 互斥锁收编（10 处）+ signal 贯通

- 目标：self-upgrade 获得完整保护；一次拆完全部 10 处外层锁；host-api 四个 mutation doorway 把 `signal` 放进 request。
- Files:
  - Modify: `src/core/host-api.ts`（self-upgrade :200-205；`onMutation` :52-53 与 :202/:261/:269/:277 四处包裹拆除；install/uninstall/upgrade 三 case 的调用增补 `signal`；`HostApiOverrides` 增 `runTransaction?: typeof runProfileTransaction`）
  - Modify: `src/tools.ts`（:200/:226/:288）、`src/cli.ts`（:253/:263/:275）、`src/host.ts`（:5/:79）、`src/core/market.ts`（删 :980-987）
  - Test: `tests/host-api.test.mjs`
- self-upgrade 实现: `npmLatest` → 缺 integrity 直接 throw（不进事务）→ `runTransaction({kind:'install-npm', pkg:ctx.pkg.name, version, integrity, signal}, { warmPackument: makeNpmWarmPackument(cfg().timeoutMs ?? 20_000) })`（生产 warm 绑定）→ `!r.ok` 时 `throw new TransactionError(r)`；成功 payload `{pkg, version, usedAllowAllBuilds, needsRestart:true}`。
- [ ] Step 1: 写失败测试——**（v3 分层修正）** host-api 层只验委派：a) npmLatest 无 integrity → 报错且 `runTransaction` 零调用；b) 委派参数含 `signal`（fake 断言收到）；c) committed → 200 payload；d) rolled-back → 500 且 message 含「已回滚到安装前状态」（兼容契约端到端）。**FIFO 并发不在本文件测**（已在 Task 2 Step 1 用例 8 用真实事务函数覆盖）；如需端到端，override 形如 `runTransaction: (req) => runProfileTransaction(req, { profileDir: tmp, runner: () => mock })`（保留真实函数只注入依赖）。
- Run: `npm run build && node --test tests/host-api.test.mjs`
- Expected: 新用例失败。
- [ ] Step 2: 确认失败
- [ ] Step 3: 六文件同步修改
- [ ] Step 4: 确认通过 + 锁清零
- Run: `npm run build && npm test && npm run typecheck && ! grep -rn "withMutationLock\|onMutation" src/`
- Expected: 全 pass；grep 零命中。
- [ ] Step 5: checkpoint commit（`refactor(tx): 自升级接事务，10 处锁包裹拆除，signal 贯通`）

### Task 8: 阶段② 收口验证

- [ ] Step 1: 全量
- Run: `npm run build && npm run typecheck && npm test`
- Expected: 全 pass。
- [ ] Step 2: 四门覆盖由 `tests/profile-transaction.test.mjs` 参数化用例本身保证（缺任何一门即该用例失败）——运行该文件确认全 pass。

### Task 9: 删除 market 桥，收窄 InstallDeps，迁移全部旧注入测试

- 目标：生产路径完全原生；旧槽位删除；全部旧注入测试迁移。
- Files:
  - Modify: `src/core/market.ts`（删 `txDepsFrom`；`InstallDeps` 收窄为 `{ loadRegistry?, npmLatest?, npmVersion?, githubLatestTag?, listInstalledPlugins?, transaction?: TransactionDeps }`——**v3：删除顶层 `npmPackument`**，B3 预热统一走 `transaction.warmPackument`；**v6：`TransactionDeps` 同步删除 `readProfileDeps` 桥接槽**）
  - Modify: `tests/rollback-heal.test.mjs`、`tests/npm-integrity.test.mjs`
- 迁移规则: 旧槽位 → `transaction: { profileDir, retryDelaysMs:[0,0], runner: (dir)=>({…旧 fake 按桥规则包装}), warmPackument: 旧 npmPackument fake }`；断言暂不改动（Task 11 再迁 code）。`readProfileDeps` 注入不再迁移——与文件内容等价的注入直接删除；`npm-integrity.test.mjs` 漂移 spec 用例（fake 返回 `1.2.4`）改为 fake add 真实写入 `1.2.4`（严格读取器钉同一 fail-closed，断言零改动）。
- 真实 profile 防护: 迁移后共用 helper 断言 `transaction.profileDir` 以 `os.tmpdir()` 开头。
- 删除前全仓搜索: `grep -rn "addDshPlugin\|readProfileDeps\|npmPackument\|removeInstalled\|readLockIntegrity" tests/`——除 uninstall-patch 对 `removePatchedDependencyEntries` 的直测外无残留。（v7 修订：原模式含 `restoreInstall`/`rebuildInstall`，与接口定稿 `PnpmRunner.frozenInstall/rebuildInstall` 方法名撞名，mock runner 必然命中——字面门禁不可能通过，属验证命令无效；改为只匹配新世界不存在的 legacy 槽名。）
- [ ] Step 1: 基线（全 pass）
- [ ] Step 2: 迁移两测试文件 + 删桥 + 收窄 + 防护断言（同一提交）
- [ ] Step 3: 确认通过（机器门禁）
- Run: `npm run build && npm test && npm run typecheck && ! grep -rn "addDshPlugin\|readProfileDeps\|npmPackument\|removeInstalled\|readLockIntegrity" tests/`
- Expected: 全 pass；grep 零命中。
- [ ] Step 4: checkpoint commit（`refactor(tx): 删桥，测试注入全迁移`）

### Task 10: 结构化结果贯通 tools / CLI / host-api（GUI 零改动）

- 目标：消费方从结构生成散文；host-api 错误体附白名单投影 detail。
- Files: Modify `src/core/market.ts`（失败统一 `TransactionError`）、`src/core/host-api.ts`（`errorStatus` instanceof 分支）、`src/tools.ts`（execute 带 `healActions`/`tag`；render 结构源）、`src/cli.ts`（验证文案经 `TransactionError.message`）；Test `tests/host-api.test.mjs`
- 接口契约:
  - Produces: `/dshm` 失败响应体 `{ok:false, error, detail}`；**detail 白名单（v3 修正字段）**：`{status, kind, failure, healActions, snapshotRestoreVerified, profileConverged}`——不含 raw `output`；GUI 只读 `error`（零改动）
- [ ] Step 1: 写失败测试——`runTransaction` 返回 rolled-back（LOCK_INTEGRITY_MISMATCH）→ 500 + `body.detail.failure.code` 正确 + `body.detail.output === undefined` + `body.error` 含 legacy 文案。
- Run: `npm run build && node --test tests/host-api.test.mjs`
- Expected: 失败（无 detail）。
- [ ] Step 2: 确认失败
- [ ] Step 3: 实现
- [ ] Step 4: 确认通过（`npm run build && npm test && npm run typecheck`）
- [ ] Step 5: checkpoint commit（`feat(tx): 结构化结果贯通消费方`）

### Task 11: rollback-heal 断言迁 code + 事故 fixtures 共享

- 目标：散文正则迁 code；原始 pnpm 文本共享。
- Files:
  - Create: `tests/fixtures/pnpm-errors.mjs`——`CONFIG_MISMATCH_TEXT`/`NO_MATCHING_TEXT`（**标注「事故同形摘要」**，与 rollback-heal 现有 fixture 同源）；`UNUSED_PATCH_TEXT`（**原始文本，含 `ERR_PNPM_UNUSED_PATCH`**，取自 `tests/uninstall-patch.test.mjs:135-138` 样本）
  - Modify: `tests/rollback-heal.test.mjs`、`tests/npm-integrity.test.mjs`、`tests/pnpm-outcome.test.mjs`
- 迁移对应表: `/已回滚到安装前状态/`→`err.result.status==='rolled-back'`；`/还原进 manifest/`→healActions 含 `B2_OVERRIDES_ALIGNED`；`/lockfile 已重建/`→含 `B2_LOCKFILE_REBUILT`；`/人工修复/`→`status==='manual-repair'`；`/\[dsh-m 自愈\]/`→healActions 非空。断言数不少于迁移前。
- **grep 范围收窄**：仅 rollback-heal 与 npm-integrity 两文件禁散文（host-api 的兼容文案断言与 Task 2 的 `renderFailure` 契约测试**保留**——它们正是 legacy 文案的守护测试）。
- [ ] Step 1: 迁移断言与 fixtures
- [ ] Step 2: 确认通过（机器门禁）
- Run: `npm run build && node --test tests/rollback-heal.test.mjs tests/npm-integrity.test.mjs tests/pnpm-outcome.test.mjs && npm test && ! grep -n "已回滚到安装前状态" tests/rollback-heal.test.mjs tests/npm-integrity.test.mjs`
- Expected: 全 pass；grep 零命中。
- [ ] Step 3: checkpoint commit（`test(tx): 断言迁 code，原始 pnpm 文本入 fixtures`）

### Task 12: DESIGN.md §3 重写 + 模块头契约注释

- 同前（契约注释落地「接口定稿」的 9 条：含 throw 政策、signal 语义、证据来源措辞）。
- Files: Modify `docs/DESIGN.md` §3、`src/core/profile-transaction.ts` 头注释
- [ ] Step 1: 重写两处
- [ ] Step 2: 验证（`npm run build && npm test` 全 pass）

### Task 13: 最终验证

- [ ] Step 1: 全套
- Run: `npm run build && npm run typecheck && npm test`
- Expected: 全 pass。
- [ ] Step 2: 收口断言（v4：基于 Task 0 的基线 ref，单参数工作树比较）
- Run: `! grep -rn "withMutationLock\|onMutation" src/ && ! grep -rnE "ERR_PNPM_[A-Z_]+" src/core/market.ts src/core/profile-transaction.ts && test "$(grep -rl '已回滚到安装前状态' lib/core/ | sort)" = "lib/core/profile-transaction.js" && grep -q "runProfileTransaction" src/core/market.ts && grep -q "runTransaction\|runProfileTransaction" src/core/host-api.ts && git diff --exit-code refs/dsh-plan/profile-transaction-base -- src/client/main.jsx .github/workflows/publish.yml && echo ALL-GATES-OK`
- Expected: `ALL-GATES-OK`（任一门失败即非零退出）。说明：`ERR_PNPM_` 字面量禁止出现在 market/transaction（消费走 `PNPM_OUTCOME_CODES`）；基线 ref 与**当前工作树**（含 staged/unstaged）比较，验证 GUI 与 publish.yml 零 diff。
- [ ] Step 3: 输出修改摘要（新模块行数、market.ts 缩减、四门用例清单、10 处锁拆除清单），最终 checkpoint commit（`refactor(tx): Profile 变更事务三阶段落地`）
- [ ] Step 4: 清理基线 ref
- Run: `git update-ref -d refs/dsh-plan/profile-transaction-base`
- Expected: ref 删除成功。

## 评审处置记录

### 第一轮（v2 已处置，摘要）
🔴1 采纳备选方案（两阶段措辞）；🔴2/🔴3/🔴4/🔴6 采纳；🔴5.1 采纳、🔴5.2 部分（不做目录 fsync）；🟡1-4/🟡6/🟡7 采纳；🟡5 部分（不做排队取消）；准确性 2 条采纳。

### 第二轮（v3 处置）
| 评审项 | 处置 |
|---|---|
| 🔴1 非真判别联合 + detail 引用已删字段 | 采纳：四分支联合（`failure?: never`/`ok:true` 字面量）；`FailedTransactionResult`；detail 改 `{status, kind, failure, healActions, snapshotRestoreVerified, profileConverged}` |
| 🔴2 signal 断链 | 采纳：三门 request + warmPackument + abort-aware sleep + PluginRunner/runDshPlugin/removeDshPlugin + host-api 四 doorway 全贯通；状态规则入契约 4 |
| 🔴3 不可测内部函数 | 采纳方案 A：导出 `makeAddViaLadder(deps)` 工厂，生产与测试共用 |
| 🔴4 B1 测试矩阵矛盾 | 采纳：fake 按调用序列（B1 失败→回滚 frozen ok→rolled-back）；另立全失败→manual-repair 用例 |
| 🔴5 并发测试替换被测锁 | 采纳分层：FIFO 用真实事务函数在 profile-transaction 测试；host-api 只验委派；e2e override 必须包真实函数仅注入依赖 |
| 🔴6 grep 与 Task 7 冲突 | 采纳：grep 收窄至 rollback-heal/npm-integrity；保留 renderFailure 契约测试与 host-api 兼容文案断言作为 legacy 守护 |
| 🟡1 Windows 回退二次失败 | 采纳：备份协议（target→backup / 失败恢复 / 成功删 backup） |
| 🟡2 chmod 不稳定 + 原子写无专项 | 采纳：`fsOps` 内部注入缝 + 确定性用例（ENOENT/EACCES、rename 优先、EPERM 才回退、二次失败恢复、tmp 清理） |
| 🟡3 字段语义不一致 | 采纳：更名 `snapshotRestoreVerified`/`profileConverged` + 各态证据来源 |
| 🟡4 「永不 throw」过强 | 采纳：领域失败返回值 + 顶层 catch 兜底 `INTERNAL_ERROR`(manual-repair) + 畸形 request 定义与零写入测试 |
| 🟡5 零 diff 无基线 | 采纳：Task 0 记录 `BASE_SHA`；最终 `git diff --exit-code $BASE_SHA..HEAD` 覆盖 main.jsx + publish.yml |
| 🟡6 npmPackument 孤儿 | 采纳：删除顶层字段，统一 `transaction.warmPackument` |
| 🟡7 fixture 非原始文本 | 采纳：`UNUSED_PATCH_TEXT` 用 rewrite 前原始文本；另两个标注「事故同形摘要」 |
| 🟡8 阶段范围描述 | 采纳：①npm+B1+原语 / ②三门+github 收紧+锁 / ③删桥+贯通 |
| 终审三裁决（B2 语义/fsync/排队取消） | 均已按接受意见落实；字段更名同步 CONTEXT.md |

### 第三轮终审（v4 处置）
| 评审项 | 处置 |
|---|---|
| 🔴1 BASE_SHA 不跨任务/漏检工作树/当前工作区不干净 | 采纳：Task 0 改「先提交在案文档 → `git update-ref refs/dsh-plan/profile-transaction-base HEAD`」；Task 13 用单参数 `git diff --exit-code <ref> -- paths`（基线 vs 工作树，覆盖已提交/staged/unstaged）；Task 13 Step 4 删 ref |
| 🔴2 生产 warmPackument 无缺省 | 采纳方案 A 变体：新增 `makeNpmWarmPackument(timeoutMs, fetcher?)`（保留 timeout/signal、失败吞错、fetcher 仅测试注入）；market/host-api 生产路径显式绑定（Task 3/7）；未绑定时 B3 跳过预热仅重试（契约写明，绝不调 undefined）；测试：绑定单测（fetcher 断言三参）+ warm 缺省重试行为 |
| 🔴3 矩阵 remove/rebuild 行缺格 | 采纳：两行六类全枚举写满（frozen 行同步补全）；矩阵测试以全枚举参数化覆盖 remove/rebuild |
| 🔴4 INTERNAL_ERROR 绕过回滚 | 采纳 phase-aware：契约 2 重写（快照前→rejected；快照后→保留 code 走统一回滚→rolled-back 或 manual-repair）；`snapshotTaken`/`mutationStarted` 阶段标志；测试：runner 写后 throw→rolled-back、factory 快照前 throw→rejected、patch cleanup 半写 throw→还原+live 补偿（经新增 `TransactionDeps.stripPatchedEntries` 薄注入槽构造） |
| 🔴5 畸形 request 无测试 | 采纳：Task 2（install-npm unsafe pkg/空白 integrity）+ Task 5（github unsafe repo/非 hex SHA、uninstall unsafe pkg）参数化用例，断言 TypeError + runner factory/操作/setLiveDisabled 零调用 + 三文件字节未变；畸形定义补「github repo 非 owner/repo 形状」 |
| 🟡2 code 注释与 hard-fail 不一致 | 采纳：注释改为「已知决策 code 取 PNPM_OUTCOME_CODES；hard-fail 可保留其他 ERR_PNPM_* 诊断码」 |
| 🟡3 阶段①「纯抽取」误导 | 采纳：更名「npm 事务抽取 + 明示行为加固」，标注非纯抽取 |
| 🟡1 committed 态字段读法 | 评审确认接受，无需改动 |

### 第四轮 Diff 级终审（v5 处置，条件批准 → 已补清）
| 评审项 | 处置 |
|---|---|
| 🟡 `InstallDeps`「形状不变」与 `deps.transaction` 冲突 | 采纳：Task 3 起非破坏性新增 `transaction?: TransactionDeps`，措辞改「签名不变 + 非破坏性扩展」；Task 9 最终形状不变 |
| 🟡 legacy warm 丢 timeout/signal | 采纳：桥接规则写死 `(pkg, signal) => deps.npmPackument(pkg, timeoutMs, signal)` 三参 |
| 🟡 partial legacy deps 残缺 runner | 采纳：`hasLegacyMutationOverrides` 门 + 逐操作回退 `productionRunner`；仅查询类注入不构造 legacy runner；新增两例桥接回退专项测试（Task 3 Step 1） |
| 非阻塞版本括注清理 | 采纳：正文版本括注去除，历史仅存于头部变更记录 |

### 执行期复查修订（v6/v7，执行 agent 依「执行纪律」第一条自行修复并记录）
| 发现 | 处置 |
|---|---|
| `tests/npm-integrity.test.mjs:226` 注入 `readProfileDeps` 返回 `1.2.4`（文件实为 `~1.2.3`）并断言 fail closed；verify 链入事务后无桥接槽位，Task 3「现有测试零改动通过」不可达成 | `TransactionDeps` 增 `readProfileDeps` 测试缝（缺省=严格读取器）；Task 3 桥接映射；Task 9 删桥时删槽，该用例改 fake add 真实写 `1.2.4`（断言零改动） |
| Task 9 grep 门禁的 `restoreInstall\|rebuildInstall` 与接口定稿 `PnpmRunner.frozenInstall/rebuildInstall` 方法名撞名——所有 mock runner 必然命中，验证命令无效 | 门禁模式改为 `addDshPlugin\|readProfileDeps\|npmPackument\|removeInstalled\|readLockIntegrity`（仅 legacy 槽名，新世界零存在） |

### 第五轮：实施产物终审（执行后复审）处置
> 复审裁决 Changes Requested（🔴×4、🟡×2、残余风险×1）；全部 🔴/🟡 已按建议修复并配确定性反例回归（254 → 273 测试）。

| 评审项 | 处置 |
|---|---|
| 🔴R1 快照恢复失败/收敛失败时 fallback remove ok 即返回 `rolled-back`（事实字段与真实状态相反） | 采纳：`restoreVerified=false` 一律 manual-repair（remove 仅作补偿动作记录，ROLLBACK_FALLBACK_REMOVED 保留）；收敛失败后 remove ok 必须再经严格 verify-gone + frozen 复验（复验过才 rolled-back，否则 manual-repair）。原钉住错误行为的测试拆为复验通过/仍失败两组，另增恢复失败专项（manual-repair + 事实字段如实） |
| 🔴R2 回滚收敛异常（frozen throw / B2 写失败 / runner 违约）可 reject 逃出四态联合；uninstall 回滚异常阻断 live 反向 | 采纳三层：`rollbackAndConverge` total 化（收敛阶梯/补移除/复验异常一律转 manual-repair）；各门 catch 内 `return await`；`executeTransaction` 增 phase-aware 最后防线；`rollbackWithLiveReverse` 先兜底再 live 反向（异常不阻断）。新增 4 例反例回归（frozen/rebuild/remove throw + uninstall live 反向） |
| 🔴R3 B1/B2 rebuild 改写 lockfile 后提交前未重新校验 integrity | 采纳：抽 `verifyNpmCommitState`（可重复执行），B1/B2 受控改写后于 commit builder 前重跑完整验证（firstPass 控制 range heal 不重复）；复验失败 → LOCK_INTEGRITY_MISMATCH 进回滚。新增 evil rebuild 反例 + 正常 rebuild 对照两例 |
| 🔴R4 pre-aborted signal 仍 spawn 子进程；mutation 返回后不复查 signal（可 committed）；warm 吞取消异常 | 采纳：`runCommand` spawn 前检查 `signal.aborted`（检查与 listener 注册为同步块，窗口按构造封死）+ 统一 AbortError 形态；三门在 mutation 返回后与提交前复查 signal（runner ok + 已取消 → ABORTED 不可取消回滚）；B3 循环 sleep 后检查；`makeNpmWarmPackument` 取消异常上抛、普通失败仍吞。新增 npm/github/uninstall 三门取消回归 + warm 取消不重试 + runCommand pre-abort marker 反例 + 运行中 abort 快速拒绝 |
| 🟡Y1 `atomicWriteFile` write/sync 失败遗留 `.restore-*`；备份恢复失败静默 | 采纳：tmp 创建成功起统一外层 try/finally 清理；备份恢复自身失败抛含 backup 路径与双重错误的复合信息。新增 write/sync 失败清理 + 备份恢复失败双报三例 |
| 🟡Y2 `makeAddViaLadder` 的 allowAllBuilds 写入在 try 外，违反「永不 throw」 | 采纳：写入失败转 hard-fail RunnerOutcome（≤800 截断），不再发起第二次 add。新增 EROFS 反例 |
| ⚠️残余风险 跨进程并发不受 FIFO 保护 | 采纳文档化：DESIGN.md §3.1「互斥边界（已知限制）」+ `dshm` 帮助文案显著提示；跨进程锁列为后续演进（本轮不做，与计划「跨进程并发不在覆盖范围」一致） |

### 第五轮补充：新增测试质量 + F1–F5（复审补充处置）
> 复审补充指出 5 项测试未证明标题声称的行为（T1–T5），并连带发现 5 项真缺陷（F1–F5）；全部同轮修复（273 → 279 测试）。

| 评审项 | 处置 |
|---|---|
| F1 abort/timeout 后 Promise 立即 settle，不等 child 退出；无 SIGKILL 升级（忽略 SIGTERM 的子进程在 reject 后继续写文件） | 采纳：`runCommand` 停止协议重做——SIGTERM 进程组 → 宽限（`killGraceMs`，缺省 5s）升级 SIGKILL；settle 一律等 child `close`（子进程真正停止后才 resolve/reject）。新增忽略 SIGTERM 的 marker 反例 ×2（abort + 超时，均断言 reject 晚于宽限且 marker 永不写出） |
| F2 恢复复验吞所有读取错误（EACCES 被当作「不存在」） | 采纳：`assertRestoredBytes` 仅 ENOENT 视为不存在，其他读取异常按复验失败 fail closed（→ manual-repair，`ROLLBACK_VERIFY_FAILED` 在案）。其确定性触发需 chmod/fs-seam，按复审测试清单（仅 T1–T5）不另设用例 |
| F3 close 失败被吞 | 采纳：write/sync 与 close 的错误合并传播（close 错误不掩盖原始异常）；新增真实句柄 close 失败测试（错误上抛 + 目录无 .restore-*） |
| F4 warm 吞掉取消并正常 resolve 时仍会再次 add | 采纳：B3 循环在 warm 之后复查 signal（不信任 warm 传播取消）；新增坏 fetcher 反例（warm 正常返回但已取消 → 不得二次 add） |
| F5 open 未成功也清理 tmp（可能删掉他人 in-flight 碰撞文件） | 采纳：`O_EXCL` open 成功才取得所有权（`tmpOwned`），未取得所有权绝不 rm；新增 open EEXIST 反例（rm 零调用） |
| T1 Y1 write/sync 测试只证明 rm 被调用 | 采纳：改为真实 open + 包装句柄 + 真实 rm 的集成原语测试，`readdir` 断言目录无 `.restore-*`/`.backup-*` 残留（write/sync/close 三例） |
| T2 R1 verify-gone 测试真空 | 采纳：新增非真空反例——remove 谎报 ok 且把依赖重新插回 manifest → verify-gone 拦截（manual-repair、profileConverged:false、不再进第二轮 frozen，调用数断言 =2） |
| T3 R3 正向对照 rebuild 实为 no-op | 采纳：rebuild mock 真实改写 lockfile（带重建标记、integrity 仍正确）→ committed 且断言最终 lockfile 字节 === rebuild 产物（非 add 遗留） |
| T4 github abort 未验字节恢复 | 采纳：补 before 快照比对 + `snapshotRestoreVerified`/`profileConverged` 断言，与 npm/uninstall 兄弟用例对齐 |
| T5 在途取消只验快速 reject，未验 child death | 采纳：由 F1 的两例 marker 测试覆盖（reject 等待退出 + SIGKILL 升级 + marker 不存在），abort 与 timeout 各一 |

### 第六轮：第三轮修复复审处置（F1-R + Y1/Y2）
> 复审裁决：F2-F5/T1-T4 通过；F1 因「direct child close ≠ 进程组停止」未收口（detached leader 先退时 SIGKILL 定时器被清除；生产 frozen/rebuild 未 detached，组杀退化为只杀 leader）。已全部修复（279 → 288 测试）。

| 评审项 | 处置 |
|---|---|
| 🔴F1-R-1 direct child close 后无条件清除 SIGKILL 定时器 | 采纳：停止状态机重做——close 到达时探测进程组存活（`kill(-pgid, 0)`，ESRCH=消失，EPERM 保守视为存活）；组仍存活则保留 SIGKILL 定时器不 settle；SIGKILL 后 25ms 轮询直至组消失（硬上限 10s 防 D 态进程永不 settle） |
| 🔴F1-R-2 生产 frozen/rebuild 未 detached，负 PGID kill 无效 | 采纳：`makeDshRunner` 的 frozen/rebuild 显式 `detached: process.platform !== 'win32'`（add/remove 经 runDshPlugin 本已 detached），四操作组终止语义一致 |
| 🔴F1-R-3 child.on('error') 可在停止中提前收口 | 采纳：error 处理在 `stopping` 时仅作诊断忽略（spawn 失败等非停止路径仍立即 reject）；停止协议由「组消失」判定收口 |
| 🔴F1-R-4 Windows 边界 | 采纳（文档化）：组语义仅 POSIX+detached 成立；Windows/非 detached 退化为 direct-child 终止（代码注释明示） |
| 测试 A/C：detached leader 先退 + 同组 grandchild 忽略 SIGTERM | 新增两例（abort + timeout 各一）：leader 收 SIGTERM 即退（grandchild stdio ignore 不持管道）、grandchild 1500ms 后写 marker——断言 settle 晚于 grace（≥400ms，证伪「leader close 即 settle」）、越过 marker 时刻后文件不存在（证伪「组幸存」） |
| 测试 B：生产 frozenInstall 进程树 | 新增：临时 PATH 注入假 pnpm（sh 派生忽略 SIGTERM 的同组后代 + trap TERM 退出）→ `makeDshRunner().frozenInstall(signal)` abort → 断言 RunnerOutcome 晚于 grace 返回、后代 marker 不写出（经 DSH_KILL_GRACE_MS 环境调节加速） |
| 🟡Y1 多错误合并传播名不符实（close 错误被首个 write 错误覆盖；清理失败被吞） | 采纳：write/sync+close 双失败 → `AggregateError`（单错误仍原样抛，保留 code 供既有断言）；清理失败聚合为主错误之后的第二项，错误信息含残留 tmp 路径。新增双失败聚合 + 三类事实（主错误/清理错误/tmp 路径）两例 |
| 🟡Y2 F2 缺确定性回归 | 采纳：复验下沉为 `npm-integrity.verifySnapshots(snapshots, fsOps?)`（事务消费并包装为 RestoreVerifyMismatch，语义不变）；fsOps 缝注入读取异常——originally-absent + ENOENT 通过 / EACCES 失败 / EIO 失败、existed+字节不一致失败/一致通过，共 4+1 例，不依赖 chmod |

## 执行纪律

- 开始实现前，先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- **Task 0 必须最先执行**（提交在案文档 + 创建基线 ref `refs/dsh-plan/profile-transaction-base`）。
- 按任务顺序执行，不无声跳步、合并步或改变任务目标；Task 7 的锁拆除必须在该任务内一次完成。
- 每完成一个任务，运行该任务定义的验证；测试 import 的是 `lib/`，**任何验证前先 `npm run build`**。
- 遇到阻塞、重复失败或计划与仓库现实不符（行号锚点漂移时以符号名为准），立即停下说明，不要猜。
- 当前在默认分支上直接工作时，开始前与用户确认；每阶段 checkpoint commit 后不主动 push tag。
- 全部任务完成后，运行最终验证并输出修改摘要。

## 最终验证

- `npm run build && npm run typecheck && npm test` 全绿。
- `tests/profile-transaction.test.mjs`：四门参数化不变量、B1/B2/abort/FIFO/renderFailure 契约全 pass。
- Task 13 Step 2 合并门禁输出 `ALL-GATES-OK`（锁清零 / pnpm 字面量不外泄 / 文案唯一产地 / 基于基线 ref 的 GUI 与 publish.yml 工作树零 diff）。
- 测试不触碰真实 web profile（tmpdir 防护断言存在且生效）。

## 审阅 Checkpoint

- 计划正文结束。请先审阅这份计划；批准后默认执行方为普通编码 agent 或人工执行者，按任务顺序推进。
