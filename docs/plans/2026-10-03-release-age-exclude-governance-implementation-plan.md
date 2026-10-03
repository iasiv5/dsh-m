# 排除条目治理（minimumReleaseAgeExclude 代管）实施计划 · 0.9.x

> v2（2026-10-03，评审第 1 轮后修订）：ADR 改号 **0009**（0008 已被并行发布的 0.9.23 installed-two-phase-probe 占用）；`cachedPackumentTimes` 缓存复用；web ladder 三挂点覆盖全部成功/失败出口并补 `previousVersion` 捕获；pnpm-outcome 测试防被动出网；治理/登记加 `withFileLock` 同款锁并记载残余风险；留痕契约闭合（含失败路径载体）；E2E 断言去时限化（改为「验收时点窗口内的自研包」）；`profileDir` 缺席规格；020 §2.4 原地改判标注；ADR-0005 supersede 指针。

## 目标

把 dsh-m 对 desktop profile 供应链等待期（minimumReleaseAge）的处理从「委派前只读预检 + 提前拒绝」升级为 dshmarket 同款且更强的**排除条目代管**：委派前治理（修复坏形态）、委派成功后登记（等待期内目标并入规范形态）、委派失败双码时治理+重试一次；预检收敛为「显式设置 age 或 strict 开启才拒绝」，默认策略放行并附陈述。消灭 2026-10-03 实证的假阳性拒绝（copilot-auth@1.2.4 / quota-watch@0.1.21 发布后数分钟即被 dsh-market 装上、dsh-m 却拒之门外）。

设计共识来源：2026-10-03 /grill-with-docs 三轮对齐（本计划「全局约束」逐字继承）。机理裁定：**首条规则生效**（pnpm `evaluateVersionPolicy` 每包名只认第一条排除规则，同名后续规则死亡——dshmarket profile.ts:1272 生产级实证）；know-how 020 §2.4 的「非 scoped 形态不认可」改判为「同名第二规则死亡」的误读，020 §8 随验收改写。

## 架构快照

```
                     ┌─ 挂点1（委派前）：governExcludeBlock(profileDir) ── 修坏形态（只修不建）
desktopInstallLocked ┤
desktopUpgradeLocked ┼─ 预检 releaseAgePrecheck（重构后）：显式 age / strict + 目标 young → 拒绝；
                     │   默认策略 → 放行 + notice 陈述
                     ┤
                     └─ runManagedInstall ──┬─ 首跑 installBundle
                                            ├─ 挂点3（双码失败）：govern → changed 则重试一次 → 再失败走既有翻译
                                            └─ 成功 → 挂点2：registerExclusion（仅 young 目标）→ output 留痕

web（dsh-cli.ts makeAddViaLadder）：同一套三挂点——首跑前治理、成功后登记、双码失败治理+重试一次；
治理/登记发生在事务快照窗口内，回滚语义天然一致。
```

参考实现（只读）：`.dsh-research/dsh-market-clone/src/profile.ts:1310-1385`（merge 语义：同名合并为版本并集复合、保留 CRLF/缩进、scoped 名加引号、含 `#` 或解析不出整体放弃）。

## 全局约束（逐字继承设计共识）

- **红线例外边界**：dsh-m 对 desktop profile 的 `pnpm-workspace.yaml` 仅允许编辑 `minimumReleaseAgeExclude` 块；仅限委派前后挂点；原子写（复用 `@deepseek-ai/dsh-atomic-write` 的 `writeFileAtomic`，参照 `toggle.ts:21` 用法）；解析失败即弃；每次编辑在结果 `output` 留痕。
- **留痕纪律**：操作记录/返回值只落排除块的 name@version 集合与动作短语，**绝不整文件转储**（该文件的 allowBuilds git 键可含凭据——dshmarket backup.ts:26 SECRET_FILE_HINTS 同因）。
- **机理**：首条规则生效；规范形态 = **每包一条、版本并集复合**（`name@a || b || c`）。登记细则：并入既有规则；无既有规则时 scoped → 精确单条、非 scoped 且有上一版本 → 目标+上一版双选择器复合、全新包首装 → 精确单条（运行期观察项，预案见 T9）。
- **双码**：`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 或 `ERR_PNPM_NO_MATURE_MATCHING_VERSION`；仅此双码触发「治理+重试一次」，重试至多一次。
- **fail-open**：治理/登记任何失败（无文件、解析不出、写失败）不阻塞委派，pnpm 是最终执行者；登记仅对发布时刻可判「窗口内」的目标触发，时刻不可得一律不登记。
- **UI 陈述不警告**：等待期内成功装机在 `output` 附陈述句（常态化信息），不新增警告形态、不改 client/tools 渲染（output 附加句即达三端）。
- **版本**：停在 0.9.x，**具体版本号推送前由主人定**（另一 agent 并行开发 dsh-m 功能）——本计划不动 `package.json`，CHANGELOG 挂「0.9.x（待定）」标题。
- 无额外全局约束（Node ≥22 既有 engines 不变；零新依赖——`@deepseek-ai/dsh-atomic-write` 已在依赖清单）。

## 输入工件

- 设计共识：本会话 2026-10-03 /grill-with-docs 三轮问答（第 1/2/3 轮全部按推荐落定，Q6 改 (b)：版本号推送前定）。
- 实证与机理：`01_docs/dsh-intall-know-how/020-dshm-desktop-immediate-install-channel.md`（§2/§7 现行口径，§8 待本计划验收后改写）。
- 参考实现：`.dsh-research/dsh-market-clone/src/install.ts`（withHoistRecovery）、`src/profile.ts`（merge）、`src/pnpm-compat.ts:358-364`（双码判定）。

## 文件结构与职责

| 文件 | 新建/修改 | 职责 |
|---|---|---|
| `docs/adr/0009-release-age-exclude-governance.md` | 新建 | 决策记录：红线例外、三挂点、登记规则、机理改判、栅栏附录（评估过不做的 9 项+理由）、观察预案 |
| `GLOSSARY.md` | 修改 | 新词条：首条规则、排除条目、治理、登记、等待期（含旧称「认可形态」的退役标注） |
| `src/core/exclude-governance.ts` | 新建 | 纯函数（排除块解析/合并/登记文本变换、`parseNpmSpec`）+ 落盘封装（`governExcludeBlock` / `registerExclusion`，原子写 + fail-safe + young 判定） |
| `src/core/release-age.ts` | 修改 | `parseWorkspacePolicy` 增 `explicitAge`/`strict`；预检收敛（②腿退役、①腿仅显式/strict 拒绝、新增 notice）；`excludeMatch` 语义改判（`unreliable-unscoped-exact` 退役）；`splitExactSelector` 与锁内腿探测删除；**导出 `cachedPackumentTimes`**（T4 新增，T5 改写时保留）；模块头注释重写（引 ADR-0009） |
| `src/core/profile-ops.ts` | 修改 | 挂点 1（两闸门：治理→预检）；挂点 2/3（`runManagedInstall`：成功后登记、双码失败治理+重试一次）；`ManagedInstallCtx.previousVersion`；注入缝与 output 留痕 |
| `src/core/dsh-cli.ts` | 修改 | web 挂点：`makeAddViaLadder` 首跑前治理、成功后登记、双码失败治理+重试一次 |
| `tests/exclude-governance.test.mjs` | 新建 | 纯函数矩阵 + 落盘封装矩阵（mkdtemp 隔离） |
| `tests/release-age.test.mjs` | 修改 | 策略解析/预检按新语义改写；失败翻译回归保留 |
| `tests/profile-ops.test.mjs` | 修改 | 闸门/双码重试/登记接线断言（旧②腿用例改写） |
| `tests/dsh-cli-governance.test.mjs` | 新建 | web ladder 三挂点断言 |
| `docs/DESIGN.md` | 修改 | §3 加一行引用 ADR-0009（原文不在 DESIGN，不硬造红线条款） |
| `CHANGELOG.md` | 修改 | 双语「0.9.x（待定）」条目 |
| `01_docs/dsh-intall-know-how/020-….md` | 修改 | §8：机理改判 + 本次实录 + 观察预案（**gate：T9 端到端验收后**） |

不改动：`package.json`（版本号推送前定）、client/、tools.ts、cli.ts、registry.json、依赖清单、profile-transaction.ts（web 侧治理在事务窗口内天然一致，无需改事务）、desktop 卸载/开关路径（remove/toggle 不产生 young 登记需求）。

## 任务间接口契约（Consumes / Produces）

- **T3 → T4**：`parseExcludeBlock(yaml)` / `mergeExcludeRules(yaml)` / `registerExclusionInYaml(yaml, target)` / `parseNpmSpec(spec)`（签名见 T3）。
- **T4 → T6/T7**：`governExcludeBlock(profileDir, deps?): Promise<GovernResult>`；`registerExclusion(profileDir, target, deps?): Promise<RegisterResult>`（签名见 T4）。
- **T5 → T6**：`WorkspacePolicy` 新形状 `{ explicitAge: boolean; minimumReleaseAgeMin: number | null; strict: boolean; excludes: string[] }`；`releaseAgePrecheck` 返回 `{ blocked: false; notice?: string } | { blocked: true; message: string; blockers: ReleaseAgeBlocker[] }`（`ReleaseAgeBlocker.role` 收敛为 `'target'`）。
- **T4 → T4/T6/T7**：young 判定内聚在 `registerExclusion`（deps.packumentTimes 注入，缺省 `cachedPackumentTimes`——release-age.ts 新导出的带缓存探测）。
- **T6/T7 → T8**：`output` 留痕短语格式：`；排除条目已登记 <name>@<ver>（<form>）`、`；排除条目治理：合并 <names>`（仅在有动作时附加）；**失败/拒绝路径的治理短语**（含挂点3「双码治理后重试仍败」形态）并入 `DesktopOpsError.message`（desktop）或 `RunnerOutcome.output`（web）——已落盘的编辑必须留痕，不以操作失败为由消失。

## 任务清单

### T1 · ADR-0009 落稿与 ADR-0005 指针

1. 新建 `docs/adr/0009-release-age-exclude-governance.md`（**开工当日先重查 `docs/adr/` 序号占用，并行开发下以实际顺延为准**——0008 已被 0.9.23 的 installed-two-phase-probe 占用），结构沿 ADR-0005 惯例（背景/决策/后果）：
   - 背景：0.9.19 预检假阳性实录（copilot-auth@1.2.4 发布 8 分钟被 dshmarket 装上、dsh-m 拒绝；quota-watch@0.1.21 同型）；红线分层事实（web 已有四条成文写入通道，红线实为「desktop 不编辑 + 预检模块只读」两条特定纪律）；dshmarket 考古结论（只治不登、无锁裸写、desktop 桥跳过 bypass）。
   - 决策：ADR-0005 ③「绝不直接编辑 desktop profile 的 pnpm-workspace.yaml」收窄出例外——仅 `minimumReleaseAgeExclude` 块、仅委派前后挂点、原子写、解析失败即弃、留痕纪律；三挂点设计；登记规则四分支；机理改判（首条规则生效，020 §2.4 形态论退役）；双码重试一次；fail-open；**并发策略 = `withFileLock`（官方同款锁）+ 残余风险如实记载**（pnpm/官方桥自身追加不持该锁；dsh-m 写入只发生在自己委派前后、mutation session 串行自身操作，跨工具残余窗口接受；**恢复路径如实记载：竞态丢失的追加条目 = 重新安装该 young 版本（pnpm 重追加）或操作员按 020 §3 手动补条目——「治理挂点自愈」仅适用于重复条目形态，不覆盖丢失条目**）。
   - 后果与风险：四方共写（官方客户端/dshmarket/pnpm/操作员）收敛到规范形态；机理改判若被观察证伪的预案（登记回退包名级）；与并行 agent 的版本合流约定。
   - 栅栏附录（评估过不做）：hoist 重建（#20，desktop 桥不可传 flag、web 罕见）、host peer 关装（#289，零病例）、fetch 超时（#615）、瞬时网络重试（#83，误判有非幂等风险）、allowBuilds 坏键清除（#698，pnpm 版本窗外）、一次性 bypass（#39，desktop 不可用 + web 侧与 #594 立场一致不代豁免）、notOnMirror 裸名回退（与精确 pin 语义冲突）、heldRelease「仍安装」（前置拒绝下走不到）、清理满期条目（无害卫生项，后置）。
2. `docs/adr/0005-dual-profile-support.md` ③ 句尾加一行指针：「desktop profile 的 pnpm-workspace.yaml 编辑禁令已由 ADR-0009 收窄出 `minimumReleaseAgeExclude` 例外（仅该块、仅委派前后挂点，原子写+留痕）」，正文其余不改。
3. 验证：文档内引用的文件路径全部存在（`.dsh-research/dsh-market-clone/...` 为只读镜像，允许引用）；GLOSSARY/ADR/DESIGN 术语一致。

### T2 · GLOSSARY 词条

1. `GLOSSARY.md` Language 节追加五条（沿用现有「术语：定义 + _Avoid:_」格式）：
   - **首条规则（First Rule）**：pnpm 每包名只认第一条排除规则、同名后续规则死亡（#732 实证）；治理的目标形态是每包一条。_Avoid:_ 认可形态/不认可形态（020 §2.4 旧口径，机理误称）
   - **排除条目（Release-Age Exclusion）**：`minimumReleaseAgeExclude` 中一条豁免规则；规范形态 = 每包一条版本并集复合。_Avoid:_ 白名单、排除项
   - **治理（Govern）**：委派前/失败后把排除块修复为规范形态的动作；只修不建。_Avoid:_ 修复、清理
   - **登记（Register）**：装机成功后把等待期内目标版本以规范形态并入排除块的动作；仅窗口内触发。_Avoid:_ 追加（pnpm 自动行为另有其名）、pin
   - **等待期（Release Age）**：`minimumReleaseAge` 窗口，缺省 1440 分钟；显式设置或 strict 时点名新版本会被拒。_Avoid:_ 冷却期、隔离期
2. 验证：词条词汇与 T1 ADR、T5 代码注释一致（「首条规则/治理/登记/等待期」四个词在后续任务中不出现同义异名）。

### T3 · 排除块纯函数

1. 写 `tests/exclude-governance.test.mjs`（先失败；`DSHM_CACHE_DIR` 指向 mkdtemp，绝不触碰 `~/.dsh`）：
   - `parseExcludeBlock(yaml)`：本机真实形态（含 scoped 引号条目、复合条目、包名级）可解析；含 `#` 行或不可解析条目 → 返回 null；CRLF/缩进被探测保留。
   - `mergeExcludeRules(yaml)`：同名两条精确 → 一条复合（版本并集、原顺序）；精确+复合 → 合一；含包名级 → 收敛为包名级；已规范单条 → changed=false；scoped 名输出带引号；块缺失 → changed=false（**治理只修不建**）；含 `#` → null。
   - `registerExclusionInYaml(yaml, { pkg, version, previousVersion? })`：既有复合含该版本 → noop；不含 → 追加选择器；既有包名级 → noop；scoped 精确同版本 → noop、异版本 → 复合化；无规则时 scoped → 精确单条、非 scoped 有异于目标的 previousVersion → `pkg@new || prev` 双选择器、非 scoped 无 previous（或 prev===version）→ 精确单条；块缺失 → 在文件尾追加块（保留/补 eol）；解析不出 → changed=false。
   - `parseNpmSpec(spec)`：`pkg@1.2.3` 与带引号 scoped → `{ pkg, version }`；`github:...`、裸名、range（`^1.2.0`）→ null。
2. 实现 `src/core/exclude-governance.ts` 纯函数段（语义对照 clone profile.ts:1310-1385，含 eol/缩进保留与 scoped 引号规则；`@` 开头条目必须单引号包裹）。
   - Produces 签名：`parseExcludeBlock(yaml: string): ParsedBlock | null`；`mergeExcludeRules(yaml: string): { yaml: string; changed: boolean; mergedNames: string[] } | null`；`registerExclusionInYaml(yaml: string, target: { pkg: string; version: string; previousVersion?: string }): { yaml: string; changed: boolean; form: 'merged' | 'created-composite' | 'created-scoped-exact' | 'created-exact' | 'noop' } | null`；`parseNpmSpec(spec: string): { pkg: string; version: string } | null`。
3. 验证：`npm run build && node --test tests/exclude-governance.test.mjs` 全绿。

### T4 · 落盘封装（治理与登记的 I/O 层）

1. 在 `tests/exclude-governance.test.mjs` 追加（先失败）：
   - `governExcludeBlock(profileDir, deps?)`：文件缺席 → `{ ok: false, reason: 'no-file' }` 不抛；块缺失 → no-op；含 `#`/不可解析 → `{ ok: false, reason: 'unparseable' }`；同名两条 → 原子写后 `{ ok: true, changed: true, mergedNames: [...] }`；`deps.writeFile` 注入抛错 → `{ ok: false, reason: 'write-failed' }` 不抛；断言 `deps.writeFile` 被以**完整新文本**调用一次（原子写由默认实现 `writeFileAtomic` 承担，测试注入替身）。
   - `registerExclusion(profileDir, target, deps?)`：`deps.packumentTimes` 注入发布时刻 11 分钟前 → 写入发生且 form 正确；25 小时前 → `{ applied: false, reason: 'not-young' }`；时刻不可得（null）→ `not-young`；**文件存在**但块缺失且 young → 追加块写入；**文件本身缺席** → `{ applied: false, reason: 'no-file' }` 不建文件（无 pnpm workspace 锚点，登记无意义）；`profileDir` 缺席 → 两函数 fail-open no-op（govern `{ ok: true, changed: false, reason: 'no-dir' }`、register `{ applied: false, reason: 'no-dir' }`），绝不抛；窗口值取显式 `minimumReleaseAge`，未配置用 1440。
   - 留痕：两个函数的返回 record 只含 names/form/reason，断言不含 yaml 全文。
2. 实现 `src/core/exclude-governance.ts` I/O 段：
   - `governExcludeBlock(profileDir: string, deps?: { readFile?: ...; writeFile?: ... }): Promise<{ ok: boolean; changed: boolean; mergedNames?: string[]; reason?: 'no-dir' | 'no-file' | 'no-block' | 'unparseable' | 'write-failed' | 'clean' }>`——`profileDir` 缺席 → `{ ok: true, changed: false, reason: 'no-dir' }`；读-改-写全程包在 `withFileLock(join(profileDir, 'package.json'), …)` 内（`toggle.ts:219` 官方同款锁先例；锁只串行持锁写者，不防不持锁的 pnpm 追加——残余风险在 ADR-0009 如实记载）→ 读文件（缺席 fail-open）→ `mergeExcludeRules` → changed 才 `deps.writeFile ?? writeFileAtomic(file, next, { mode: 0o600 })`。
   - `registerExclusion(profileDir: string, target: { pkg: string; version: string; previousVersion?: string }, deps?: { readFile?; writeFile?; packumentTimes?: typeof cachedPackumentTimes; nowMs?: number }): Promise<{ applied: boolean; form?: string; reason?: 'no-dir' | 'not-young' | 'no-file' | 'unparseable' | 'write-failed' | 'up-to-date' }>`——`profileDir` 缺席 → `{ applied: false, reason: 'no-dir' }`；同样包 `withFileLock`；young 判定用 `deps.packumentTimes ?? cachedPackumentTimes`，超时 12s → 读文件（缺席 → `no-file`）→ `registerExclusionInYaml` → changed 才原子写。
   - 在 `src/core/release-age.ts` 把 `releaseAgePrecheck` 内部的 probe 逻辑提为导出 `cachedPackumentTimes(pkg, timeoutMs?, signal?)`（复用既有 `packumentCache`，precheck 内部改调用之——行为不变，既有测试护航）。本模块 young 判定缺省绑它：同一操作里预检刚拉过的 packument 不二次拉取（8MiB 级全量）。无循环依赖：release-age.ts 不 import 本模块。
3. 验证：`npm run build && node --test tests/exclude-governance.test.mjs` 全绿。

### T5 · 预检重构（release-age.ts）

1. 改写 `tests/release-age.test.mjs`（先失败；`REAL_WORKSPACE_YAML` / `REAL_DIAGNOSTIC` 实证夹具保留）：
   - `parseWorkspacePolicy`：显式 `minimumReleaseAge: 60` → `{ explicitAge: true, minimumReleaseAgeMin: 60, strict: false, excludes: [...] }`；`minimumReleaseAgeStrict: true` → strict；坏 YAML → 全空且 `explicitAge: false`。
   - `excludeMatch` 语义改判：匹配即 `'effective'`（含非 scoped 精确——首条规则口径），不匹配 `'no'`；`'unreliable-unscoped-exact'` 用例删除并注明机理改判。
   - `splitExactSelector` 与锁内腿（②腿）用例删除（连同导出一并移除）。
   - `releaseAgePrecheck` 新判定表：默认策略+young+无覆盖 → `{ blocked: false, notice }` 且 notice 含「等待期内」「登记」陈述字样；显式 age+young → blocked（消息含目标与可重试时刻）；strict+young（默认窗口）→ blocked；命中任一 exclude 规则 → 放行；发布时刻不可得 → 放行；profileDir 缺席 → 放行。
   - `describeReleaseAgeFailure` 全部既有用例原样保留（回归）。
2. 实现 `src/core/release-age.ts` 修改：
   - `parseWorkspacePolicy` 增读 `minimumReleaseAgeStrict`（boolean）与 `minimumReleaseAge` 显式性；`WorkspacePolicy` 形状按契约更新；`ReleaseAgePrecheckDeps.workspacePolicy` 类型同步。
   - 预检：删除②腿与 `MAX_EXCLUDE_PROBES`/`splitExactSelector`/`ExactSelector`；退役符号先 grep 全仓清点引用（src/ 与 tests/）再逐一移除；`ReleaseAgeBlocker.role` 收敛 `'target'`；①腿未满期且未命中覆盖时按 `explicitAge || strict` 分流——拒绝（消息沿用现格式）或返回 notice（默认策略）：`目标 <pkg>@<ver> 发布于 <本地时刻>（等待期内）：官方管理器将按显式点名安装，装好后 dsh-m 会登记豁免条目`。
   - 模块头注释重写（L1-23）：治理纪律引 ADR-0009，记机理改判与实证出处（operation-zsc4ei/L8oq1z）。
   - **保留 T4 新增的 `cachedPackumentTimes` 导出与 `packumentCache`**（T4→T6/T7 契约依赖），重构 probe 时不得回退该导出。
3. 验证：`npm run build && node --test tests/release-age.test.mjs` 全绿。

### T6 · desktop 接线（profile-ops.ts 三挂点）

1. 改写/追加 `tests/profile-ops.test.mjs`（先失败；沿用既有 deps 组装，`workspacePolicy` 桩补新字段）：
   - 旧用例改写：L507「young → 委派前拒绝」改为「默认策略 young → 委派发生 + 结果 output 含登记短语」；L546-553「锁内排除条目拒绝」改为「治理注入 changed → 委派发生」；L535 命中 exclude 放行保持。
   - 新增：治理注入抛错 → 仍委派成功（fail-open）；显式 age（桩 `explicitAge: true`）+ young → installBundle 零调用 + `release-age-wait`；strict 同理。
   - 双码重试：首跑返回 `{ application: 'failed', error: { diagnostic: REAL_DIAGNOSTIC 形态 } }` → `governExclude` 缝被调且 changed → 第二次 installBundle 成功 → 结果 ok 且 installBundle 恰调 2 次；治理 changed=false → 不重试、走既有翻译（`release-age-wait` + 账实分裂复读断言保留）；两次双码 → 翻译一次，**并断言治理短语出现在最终 message**（挂点3 已落盘编辑必须留痕）；非双码失败（enable-failed/install-refused/build-blocked/cancelled）→ 不治理不重试（既有用例回归）。
   - 登记：upgrade 成功 → `registerExclusion` 缝收到 `previousVersion = target.version`；install 成功 → previousVersion 缺席；output 附加「排除条目已登记 …」仅当缝返回 applied。
   - 留痕：治理 changed → 成功 output 与失败 message（DesktopOpsError）各有一例「排除条目治理：合并 <names>」断言；短语绝不携带 yaml 全文。
2. 实现 `src/core/profile-ops.ts`：
   - 两闸门（`desktopInstallLocked` ~L218-230、`desktopUpgradeLocked` ~L553-564）：`entry.source === 'npm' && version !== undefined && opts.profileDir` 时先 `await (deps.governExclude ?? governExcludeBlock)(opts.profileDir)`（fail-open，不抛），再既有 `releaseAgePrecheck` 调用（deps 透传不变）；`gate.notice` 存入局部变量并在成功返回的 `output` 末尾附加。**留痕载体**：`govRecord.changed` 时——委派成功 → `output` 附加治理短语；委派被拒（gate.blocked）或委派最终失败 → 闸门以 try/catch 包裹委派段，把治理短语并入抛出的 `DesktopOpsError.message` 尾部（已落盘的编辑必须留痕）。
   - `ManagedInstallCtx` 增 `previousVersion?: string`；`runManagedInstall(service, ctx, deps?: { governExclude?; registerExclude? })`：
     - 首跑 `installOnce()` 失败且非 cancelled、非 build-blocked、`DUAL_CODE_RE = /ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION|ERR_PNPM_NO_MATURE_MATCHING_VERSION/` 命中诊断文本 → 调治理 → `changed` 则**至多重试一次** `installOnce()`；重试结果进入既有 mapFailure/成功路径。检测正则收紧为双码；既有 `/minimumReleaseAge/i` 宽匹配**翻译分支原样保留**（不触发重试）。
     - 成功判定（verify 通过）后：npm 源且 `ctx.version` 存在 → `await (deps.registerExclude ?? registerExclusion)(ctx.profileDir, { pkg, version, previousVersion })`，try/catch 吞错（fail-open），applied 时把登记短语并入 `output`。
   - `desktopUpgradeLocked` 传 `previousVersion: target.version`；`DesktopInstallDeps`/`DesktopUpgradeDeps` 增 `governExclude?`/`registerExclude?` 测试缝。
3. 验证：`npm run build && node --test tests/profile-ops.test.mjs tests/release-age.test.mjs` 全绿。

### T7 · web 接线（dsh-cli.ts makeAddViaLadder 三挂点全出口覆盖）

1. 新建 `tests/dsh-cli-governance.test.mjs`（先失败；注入 `runDshPlugin`/`govern`/`register` 替身，**参照 `tests/pnpm-outcome.test.mjs:82-243` 的 ladder 驱动方式（fakeRunner/ladderOf）**）：
   - 登记覆盖**全部成功出口**：首跑成功（L692）、prepare 放行重试成功（retryAfterPrepare，L685）、hoist 重建后重试成功（L704）——三条路径 register 均被调恰一次；`github:`/裸名 spec → register 不被调。
   - previousVersion：ladder 入口（首跑前）对 npm spec 的 pkg 做本地已装版本读取（`installed.ts` 的 listInstalled，fail-open → undefined），register 缝收到 `{ pkg, version, previousVersion }`。
   - 双码治理+重试覆盖**全部四个失败出口**：①首跑 add 失败（L693）、②hoist 重建 install 自身失败（L698-701）、③重建后 add 失败（L705-708）、④retryAfterPrepare 内部 catch（L686-688，异常自吞不到外层）——任一出口诊断命中双码 → govern → changed 则重试**该命令**一次（②的重试对象是重建 install 本身）；govern 无变化或重试再败 → 返回分类失败；全局布尔保证每次 ladder 调用至多一次治理重试。测试含②③两出口的双码用例。
   - 留痕：治理短语（changed 时）与登记短语（applied 时）并入对应 `RunnerOutcome.output`——成功与失败出口都附加（失败出口 output 本就承载诊断文本），**重试后仍失败的出口同样附加**。
   - `profileDir` 无 pnpm-workspace.yaml → 全链 no-op、行为与现状一致。
2. 实现 `src/core/dsh-cli.ts` `makeAddViaLadder`（L666-717）：
   - deps 增 `govern?: (profileDirectory: string) => Promise<{ changed: boolean; mergedNames?: string[] }>` 与 `register?: (profileDirectory: string, target: { pkg: string; version: string; previousVersion?: string }) => Promise<{ applied: boolean }>`，缺省绑 `governExcludeBlock`/`registerExclusion`；生产工厂 `makeDshRunner`（L759-764）无需改签名（默认绑定即生效）。
   - 返回函数体改造：入口 `await safeGovern(profileDir)`（try/catch 吞错，记录 changed 供 output）+ `const previousVersion = safeInstalledVersion(profileDir, parseNpmSpec(source)?.pkg)`；提取 `okOutcome(...)` 帮助函数（safeRegister → 附加登记/治理短语 → 返回 ok 形态），三条成功路径统一走它；`attemptAdd(cmd)` 包装阶梯内每次真实 pnpm 命令（①首跑 add、②重建 `install --no-frozen-lockfile`、③重建后 add、④prepare 放行重试 add），任一次失败文本命中双码 → govern → changed 则重试**该命令**一次——四个失败出口共用该语义，全局布尔保证每次 ladder 调用至多一次治理重试。治理/登记在事务快照窗口内，回滚语义一致（设计共识，无需改 profile-transaction）。
3. **防被动出网（评审【4】）**：`tests/pnpm-outcome.test.mjs` 的 ladder 用例补 no-op 替身——`ladderOf` 工厂增 `govern`/`register` 参数，既有用例（以 grep `ladderOf` 全量清点）注入 `govern: async () => ({ changed: false })`、`register: async () => ({ applied: false })`；验证命令不变。
4. 验证：`npm run build && node --test tests/dsh-cli-governance.test.mjs tests/pnpm-outcome.test.mjs tests/build-approval.test.mjs` 全绿（后两者为回归）。

### T8 · DESIGN 引用与 CHANGELOG

1. `docs/DESIGN.md` §3 末尾加一行：排除条目治理与登记见 [ADR-0009](./adr/0009-release-age-exclude-governance.md)（desktop 红线例外的唯一记载处为 ADR，DESIGN 不复述条款）。
2. `CHANGELOG.md` 中文区头部与 English 区头部各新增「### 0.9.x（待定）变更：」条目：三挂点代管、预检收敛（默认策略放行+陈述）、机理改判、双码重试一次、红线例外引 ADR-0009。版本号推送前由主人统一改定（另一 agent 并行开发中）。
3. 验证：`npm run build && npm run typecheck` 绿；三份文档（GLOSSARY/ADR-0009/DESIGN）互链可达、术语一致。

### T9 · 全量门禁与端到端验收

1. 全量门禁：`npm run build && npm run typecheck && npm test && node scripts/validate-registry.mjs` 全绿（`tests/exclude-governance.test.mjs`、`tests/release-age.test.mjs`、`tests/profile-ops.test.mjs`、`tests/dsh-cli-governance.test.mjs` 全部在列）。
2. 端到端验收（**gate：版本号与另一 agent 合流、发布并装机后执行**；0.9.23 装机内跑不到新代码）：
   - 主断言（young 自研包，**去时限化**）：任一**验收时点仍处窗口内**的自研包最新版——验收前以 `npm view <pkg> time` 确认发布时刻 < 24h（quota-watch@0.1.21 窗口至 2026-10-04 11:00，过期即换目标，或由主人现场发布一版作 young 目标）→ DSH 会话内 `dshm_upgrade <pkg>` → 升级成功、`desktop/pnpm-workspace.yaml` 该包线并入新版本选择器（规范复合形态）、操作记录 output 含「排除条目已登记」陈述。
   - 备选（目标已被装上时）：操作员从排除块临时移除该版本选择器 → 再执行同版本升级（覆盖安装）→ 断言同上；验收后恢复。
   - 运行期观察项（**不在本轮测试**）：首个「young 非 scoped 全新首装」发生后立即执行任意一次官方包操作——锁文件校验通过 = 机理改判成立；若被 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` flag = 改判证伪，登记回退规则切换为包名级（bare name），同步修订 ADR-0009 与 020 §8。
3. 提交纪律：在 main 直接工作（仓库惯例）；提交切分为「T1+T2 文档」「T3+T4 核心纯函数」「T5 预检」「T6 desktop」「T7 web」「T8+T9 门禁后」；提交前 `git pull --rebase`——**另一 agent 并行开发中**，若 CHANGELOG/DESIGN/GLOSSARY/package.json 冲突，停下报告不猜。

### T10 · know-how 020 §8（gate：T9 端到端验收证据）

1. `01_docs/dsh-intall-know-how/020-dshm-desktop-immediate-install-channel.md` 追加 §8：机理改判裁定（首条规则生效，§2.4 形态论退役的理由与出处）、copilot-auth/quota-watch 假阳性实录（operation-zsc4ei pnpm.log 逐字已在 §7 链路内，补交叉引用）、dsh-m 0.9.x 三挂点代管语义、观察项与回退预案、索引表该行「升级/重装后必查」列同步；**§2.4 的「非 scoped 独立精确不生效」结论原地加改判标注**（『首条规则生效口径下改判为：同名第二规则死亡，见 §8』，原实录保留作历史）——不留新旧口径并存的矛盾。
2. 遵守 know-how 写作规范：报错原文逐字收录；更新 `01_docs/dsh-intall-know-how/AGENTS.md` 索引表 020 行。
3. 验证：主人目视确认（私有文档区按惯例 push 前经主人确认）。

## 执行纪律

- 开工前先批判性复查本计划；发现缺项/矛盾/命令失效（含锚点行号漂移——以符号/区段锚点重新定位），先修计划再动手。
- 开工当日重查 `docs/adr/` 序号占用与 `package.json`/`CHANGELOG` 现状（并行开发持续移动中）；本计划 ADR 编号以开工当日实际顺延为准（当前定为 0009），冲突即改号并同步计划全文。
- 按任务顺序执行（T1→T10 存在 Consumes 依赖，不得跳序）；每完成一个任务立即跑该任务定义的验证。
- 测试一律 `DSHM_CACHE_DIR` 指向 mkdtemp 临时目录 + 注入替身，绝不触碰 `~/.dsh`（fixture 红线：本机 profile 文件不拷入 tests/，脱敏结构等价样本手写）。
- 版本号不动（package.json）；与并行 agent 冲突即停（见 T9.3）。
- Windows 环境：全部验证命令为 npm scripts / node --test / git，跨平台，不用 bash-only 语法。
- 阻塞、重复失败或仓库现实与计划不符 → 停下说明，不猜。

## 最终验证

`npm run build && npm run typecheck && npm test && node scripts/validate-registry.mjs` 全绿；T9 端到端主断言（发布装机后）通过；T10 完成后 020 §8 与索引表更新。发布（版本号、tag、publish、npmmirror 同步、装机）按 018/020 纪律由主人合流后执行，不在本计划自动化范围内。

## 审阅 Checkpoint

- 计划正文结束后请求审阅；审阅通过前不进入实现。
- 本计划将先交评审 agent 评审；评审修订意见回流入本计划（版本号 v2 注记）后再执行。
