# Doctor Day1 实施计划（农场测活 / 残留物清点 / 账实一致）

## 目标

- 交付 ADR-0010 的 Day1 范围：新增只读体检子系统——`src/core/doctor.ts` 纯函数核心、`/dshm` 新 method `doctor`、CLI 子命令 `dshm doctor`，覆盖三项检查（农场测活 / 残留物清点 / 账实一致）。
- 不新增 agent 工具、不做 GUI、不做任何修复动作。

## 架构快照

- 核心是 `src/core/doctor.ts` 一组纯函数：输入 profile 目录路径，输出结构化 `DoctorReport`；无进程、无网络、无写入。
- 三端落位：host-api 的 `/dshm` 单路由 method 分发表新增 `doctor` case（照 `registry-diagnose` 先例，`src/core/host-api.ts` 的 method 表约 L306-627）；CLI 在 `src/cli.ts`（约 L230-439 命令区）新增子命令直调核心函数。GUI 折叠区留待下一批经 method 接入。
- 复用既有读法：已装清单读 `src/core/installed.ts`（`InstalledPlugin` / `resolvePluginDir`）；当前运行时版本解析用 `src/core/dsh-version.ts` 的 `readLauncherPackageVersion`（纯 FS 通路；**注意 `resolveDshVersion` 含 spawn `dsh --version` 回退，doctor 禁用**，见全局约束）。

## 全局约束

- 只读边界：doctor 全链路无进程派生、无网络请求、无文件写入/删除。
- 无进程派生的版本解析细化：doctor 禁用 `dsh-version.ts` 中 `resolveDshVersion` 的 spawn 回退——method 通路在宿主进程内经 `readLauncherPackageVersion` 纯 FS 可得运行时版本；CLI 通路同函数解析，得 null 时 stale 判定整体降级为 unknown（unknown≠broken），**绝不 spawn**。
- 三级严重度 + unknown≠broken 从第一天进数据结构：error / warning / 结构化清单（零告警渲染）；每条 error/warning 必须含「发生了什么 / 为什么 / 现在怎么办」三要素（title / detail / hint 字段）。
- 绝不读取或转储 `cordis.patch.yml` 等含密钥**配置文件**内容；报告只含包名、路径、版本号等结构化事实（链接目标目录的 package.json `version` 字段属包元数据，不在禁令内）。
- 双布局适配：hoisted（本机形态，共享店在 profile **祖先链上级目录**的 node_modules——实测农场 236 条全部位于 `~/.dsh/profiles/node_modules/@deepseek-ai/`，即 profile 父目录）与 isolated（.pnpm 虚拟店）都必须扫得到；布局判定为 unknown 时在 `summary.unknowns` 显式标注扫描受限，不得输出空报告冒充健康。
- 三端同序契约不受影响：本计划只新增 method / 命令，不改任何既有 method、工具、命令的语义与输出。
- CLI 恒 web profile：`--profile desktop` 直接拒绝（仓内既有惯例）。
- 报告信封：`schema: 'dsh-m/doctor/v1'`。
- 版本号 0.9.29（发版时若仓内节奏另有安排，在 Task 8 一并调整并回写本行）。
- 验证命令：`npm run typecheck`、`npm run build && node --test tests/doctor.test.mjs`（单文件）、`npm test`（全量回归，pretest 自动 build）。

## 输入工件

- 决策：`docs/adr/0010-doctor-read-only-diagnostics.md`
- 对比与接缝依据：`/home/ubuntu/workspace/01_docs/research/2026-10-04-dshm-vs-dshmarket-full-comparison-and-doctor-pick.md`（§4 能力域对照、§9 冲刺决议）
- 学习对象（只读参考）：`.dsh-research/dsh-market-clone-20261004/src/check.ts`（严重度纪律与残留扫描有界策略）
- 本机事故证据：`01_docs/dsh-intall-know-how/014-symlink-farm-heal-log-20260928.log`、`01_docs/dsh-intall-know-how/023-dsh-desktop-registry-injection-snapshot-race.md`（工作区根相对路径）

## 文件结构与职责

- Create: `src/core/doctor.ts` — 体检核心：类型定义、`detectLayout` / `analyzeFarm` / `listResidue` / `checkAccount` / `runDoctor` 纯函数。
- Create: `tests/doctor.test.mjs` — 核心函数单测 + CLI 子命令测试（临时目录 fixture 构造布局冲突、残留/悬空/账实分裂形态）。
- Create: `tests/doctor-api.test.mjs` — `doctor` method 接线测试（照 `tests/host-api.test.mjs` 的 createApiDispatcher 先例）。
- Modify: `src/core/host-api.ts` — method 分发表新增 `doctor` case（锚点：`registry-diagnose` case，约 L621-627）。
- Modify: `src/cli.ts` — 新增 `dshm doctor` 子命令（默认人读文本输出，`--json` 机器可读；error 级发现 > 0 时 exit 1，否则 0）+ HELP 命令枚举更新（约 L167-191）。
- Modify: `CHANGELOG.md` — 0.9.29 双语条目。
- Modify: `docs/DESIGN.md` — 按仓内 ADR 引用惯例增补体检小节/指针（参照 ADR-0008/0009 被引用方式）。
- Modify: `package.json` — version 0.9.29。

## 任务清单

### Task 1: doctor.ts 骨架——类型契约 + 布局探测 detectLayout

- 目标：定下 `DoctorReport` 数据契约（三级严重度的载体），并实现布局探测。
- 涉及文件：`src/core/doctor.ts`、`tests/doctor.test.mjs`
- 接口契约
  - Consumes: 无（首个任务，定义本计划全部后续类型）。
  - Produces:
    - `export type Severity = 'error' | 'warning'`
    - `export interface DoctorFinding { check: 'farm-liveness' | 'residue' | 'account-reality' | 'meta'; severity: Severity; title: string; detail: string; hint: string }`
    - `export interface FarmLinkItem { name: string; target: string; state: 'dangling' | 'stale-target' | 'healthy'; targetVersion: string | null }`
    - `export interface ResidueItem { kind: 'no-manifest' | 'empty-scope' | 'tmp-dir' | 'bak-file'; path: string; note: string | null }`
    - `export interface AccountItem { name: string; pin: string | null; installed: string | null; lockfile: string | null; consistent: boolean }`
    - `export interface DoctorReport { schema: 'dsh-m/doctor/v1'; profileDir: string; layout: 'hoisted' | 'isolated' | 'unknown'; runtimeVersion: string | null; scannedAt: string; summary: { errors: number; warnings: number; farmChecked: number; farmDangling: number; farmStale: number; residueCount: number; accountChecked: number; accountMismatched: number; unknowns: string[] }; farm: FarmLinkItem[]; residue: ResidueItem[]; account: AccountItem[]; findings: DoctorFinding[]; dualMarket: string[] | null }`
    - `export function detectLayout(profileDir: string): Promise<'hoisted' | 'isolated' | 'unknown'>`——判据与优先级：**workspace 声明优先**，pnpm-workspace.yaml 声明 `nodeLinker: hoisted` 即判 hoisted，残留的 `.pnpm` 目录不推翻声明（本机实况即「声明 hoisted + .pnpm 仅含 lock.yaml」并存形态）；isolated = 无 hoisted 声明且 `node_modules/.pnpm` 存在**且含包目录**（仅 lock.yaml 不算）；其余 unknown。
- 验证范围：类型可编译；四种布局 fixture 各自判对（含冲突并存形态）。

- [ ] Step 1: 写失败测试——fixture 构造四种形态：isolated（node_modules/.pnpm 含包目录）、hoisted（pnpm-workspace.yaml 含 `nodeLinker: hoisted`）、**冲突并存（声明 hoisted + .pnpm 仅 lock.yaml → 必须判 hoisted）**、unknown（皆无），断言 `detectLayout` 返回值。
- Run: `npm run build && node --test tests/doctor.test.mjs`
- Expected: 失败——`Cannot find module` doctor.ts 尚不存在（或等价失败信号）。
- [ ] Step 2: 运行并确认失败（同上命令，确认失败源于模块缺失而非 fixture 语法错误）。
- [ ] Step 3: 写最小实现——`src/core/doctor.ts` 内落全部类型定义与 `detectLayout`（读 pnpm-workspace.yaml 用仓内既有 yaml 依赖；文件缺失按 unknown 分支处理，不抛异常）。
- [ ] Step 4: 运行并确认通过。
- Run: `npm run build && node --test tests/doctor.test.mjs && npm run typecheck`
- Expected: doctor.test.mjs 全部 pass；typecheck 零错误。
- [ ] Step 5: checkpoint commit（`feat(core): doctor 类型契约与布局探测`）。

### Task 2: 农场测活 analyzeFarm

- 目标：遍历 profile 可见范围内的 `@deepseek-ai/*` 符号链接，判定悬空 / 指向旧运行时 store / 健康。
- 涉及文件：`src/core/doctor.ts`、`tests/doctor.test.mjs`
- 接口契约
  - Consumes: Task 1 的 `FarmLinkItem` 类型；`src/core/dsh-version.ts` 的 `readLauncherPackageVersion`（仅此纯 FS 函数，禁用 `resolveDshVersion` 的 spawn 回退）。
  - Produces: `export async function analyzeFarm(profileDir: string, layout: 'hoisted' | 'isolated' | 'unknown', runtimeVersion: string | null): Promise<{ farm: FarmLinkItem[]; findings: DoctorFinding[]; unknowns: string[] }>`——
    - 遍历规则：**从 profileDir 逐级向上至 DSH_HOME/homedir 边界，扫描每级 node_modules/@deepseek-ai**。（本机实况：农场 236 条全部位于 profile **父目录**的 node_modules；含 pnpm-workspace.yaml 的「工作区根」= profile 自身，其 @deepseek-ai 下 0 条链接——遍历不得以「工作区根」为限，否则 0 命中空转。）
    - 悬空目标 → severity 'error'（check 'farm-liveness'，title 含包名，hint 给「重装该包或按 know-how 014 重跑 heal」）；`stale-target` → 只进 `farm` 清单不产生 finding。
    - `targetVersion` 两级提取：目标目录名版本段 `@deepseek-ai+<pkg>@<ver>_<hash>` 优先；无版本段则读链接目标目录 package.json 的 `version` 字段（包元数据只读，不触密钥红线——本机 236 条中 235 条指向无版本段的 `.pnpm/node_modules/@deepseek-ai/<pkg>` 形态，必须走第二级）；两级皆失败置 null 并聚合计入 unknowns（unknowns 呈现为聚合计数 + 代表例，不得逐条刷屏）。
    - `runtimeVersion === null` 时：全部链不判 stale、记 healthy，unknowns 记一条聚合说明「运行时版本未解析，stale 判定降级」。
- 验证范围：悬空 / 陈旧（两种目标形态）/ 健康三态判对；祖先链遍历命中「父目录共享店」形态；runtimeVersion=null 降级路径判对。

- [ ] Step 1: 写失败测试——fixture 复刻本机形态（profile 根 + **父级** node_modules/@deepseek-ai 农场）：悬空链、指向带版本段旧 store 的链（stale）、指向无版本段但 package.json 可读目标的链（healthy，targetVersion 经第二级提取）、当前版本健康链；断言三态、targetVersion 两级提取、findings 只含悬空项；另加 runtimeVersion=null 用例断言不判 stale。
- Run: `npm run build && node --test tests/doctor.test.mjs`
- Expected: 新增用例失败（analyzeFarm 未实现）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现——符号链接枚举限 `@deepseek-ai/` scope；遍历按上述祖先链规则；`runtimeVersion` 为调用方注入参数（method 通路在宿主进程内 `readLauncherPackageVersion` 可得；CLI 通路同函数 null 即降级，绝不 spawn）。
- [ ] Step 4: 运行并确认通过。
- Run: `npm run build && node --test tests/doctor.test.mjs && npm run typecheck`
- Expected: 全部 pass。
- [ ] Step 5: checkpoint commit（`feat(core): 农场测活检查`）。

### Task 3: 残留物清点 listResidue

- 目标：清点四类残留物，全部结构化清单、零告警。
- 涉及文件：`src/core/doctor.ts`、`tests/doctor.test.mjs`
- 接口契约
  - Consumes: Task 1 的 `ResidueItem` 类型与 `detectLayout` 结果。
  - Produces: `export async function listResidue(profileDir: string, layout: 'hoisted' | 'isolated' | 'unknown'): Promise<{ residue: ResidueItem[]; unknowns: string[] }>`——`no-manifest`：node_modules 顶层非点前缀、非 scope 的无 package.json 目录；`empty-scope`：空 scope 目录（独立分类，不并入 no-manifest——本机实况 8 个，dsh-market 扫描器曾把它们误报为 incomplete-package）；`tmp-dir`：匹配 `^(.+)_tmp_\d+_\w+$` 的目录（isolated 布局另扫 `.pnpm` 顶层一层，照 check.ts 有界策略不递归全店；hoisted 布局不做 .pnpm 扫描，unknowns 记中性事实「hoisted 布局不扫 .pnpm 店」——本机 hoisted 下存在仅含 lock.yaml 的残留 .pnpm 目录，属正常并存形态，可在该条目 note 一笔，不告警）；`bak-file`：profile 根 `*.bak-*` 文件（计数 + 最旧 mtime 入 note）。**不产生任何 DoctorFinding**。
- 验证范围：四类残留 fixture 各自命中；空报告仅在布局已知且确无残留时出现。

- [ ] Step 1: 写失败测试——fixture 构造无 manifest 目录、空 scope、`foo_tmp_123_abc` 目录、`package.json.bak-20260903` 文件；断言四类各命中且 findings 为空。
- Run: `npm run build && node --test tests/doctor.test.mjs`
- Expected: 新增用例失败（listResidue 未实现）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现——只 `readdir` + `stat`，scope 目录判定 = 名字以 `@` 开头；`bak-file` 仅 stat profile 根一层。
- [ ] Step 4: 运行并确认通过。
- Run: `npm run build && node --test tests/doctor.test.mjs && npm run typecheck`
- Expected: 全部 pass。
- [ ] Step 5: checkpoint commit（`feat(core): 残留物清点`）。

### Task 4: 账实一致 checkAccount

- 目标：对 profile 每个依赖核对 pin / 实装 / lockfile 三处记账。
- 涉及文件：`src/core/doctor.ts`、`tests/doctor.test.mjs`
- 接口契约
  - Consumes: Task 1 的 `AccountItem`；已装清单读法参考 `src/core/installed.ts`（`InstalledPlugin` L21-38）。lockfile 解析**直接自建最小实现**：仓内无可复用的 importers 解析（`npm-integrity.ts` 仅导出 readPnpmLockIntegrity / readPnpmLockOverrides；profile-transaction 的 lock 解析为模块私有），按本机实测形状解析 `importers.'.'.dependencies.{specifier, version}`（lockfileVersion 9.0），其他 lockfileVersion 记 unknown 不猜。
  - Produces: `export async function checkAccount(profileDir: string): Promise<{ account: AccountItem[]; findings: DoctorFinding[] }>`——不一致项 severity 'warning'（check 'account-reality'，hint 指向「升级/安装事务结果核验或按 know-how 023 §6.2 处置」）；pin 含 range（如 `^`）时按 range 判定而非字串相等；lockfile 解析不出该包置 null 且不计为不一致（unknown≠broken）；`link:` 协议依赖记 pin 原文、installed 取 link 目标 package.json version、lockfile 置 null。
- 验证范围：三处一致 / pin≠实装（023 形态：pin 1.2.5 实装 1.2.7）/ lock 缺席 三种 fixture 判对。

- [ ] Step 1: 写失败测试——fixture 构造三处一致、pin 落后实装、lock 无记录三种形态；断言 consistent 标志与 findings 只含不一致项。
- Run: `npm run build && node --test tests/doctor.test.mjs`
- Expected: 新增用例失败（checkAccount 未实现）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现——读 package.json dependencies（仅 dependencies，与已装页口径一致，本机 profile 无 devDependencies）；实装版本读各包 node_modules/<name>/package.json 的 version；range 判定用仓内既有 semver 依赖。
- [ ] Step 4: 运行并确认通过。
- Run: `npm run build && node --test tests/doctor.test.mjs && npm run typecheck`
- Expected: 全部 pass。
- [ ] Step 5: checkpoint commit（`feat(core): 账实一致检查`）。

### Task 5: 聚合 runDoctor + 双市场信息级事实

- 目标：把三项检查聚合为 `DoctorReport`，附双市场并存信息级事实。
- 涉及文件：`src/core/doctor.ts`、`tests/doctor.test.mjs`
- 接口契约
  - Consumes: Task 2/3/4 的三个函数与 Task 1 全部类型。
  - Produces: `export async function runDoctor(profileDir: string, runtimeVersion: string | null): Promise<DoctorReport>`——`runtimeVersion` 原样透传进报告（两通路差异如实可见）；汇总 farm/residue/account/findings/unknowns 与 summary 计数（含 farmDangling / farmStale）；`dualMarket`：dependencies 同时含 `dsh-m` 与 `dshmarket` 时为 `['dsh-m', 'dshmarket']`，否则 null（信息级，不产生 finding）；`scannedAt` ISO 8601。
- 验证范围：聚合后 summary 计数与各分项一致；dualMarket 两形态判对。

- [ ] Step 1: 写失败测试——组合 fixture 断言 summary 计数、dualMarket 命中与未命中两形态、runtimeVersion 透传。
- Run: `npm run build && node --test tests/doctor.test.mjs`
- Expected: 新增用例失败（runDoctor 未实现）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现。
- [ ] Step 4: 运行并确认通过。
- Run: `npm run build && node --test tests/doctor.test.mjs && npm run typecheck`
- Expected: 全部 pass。
- [ ] Step 5: checkpoint commit（`feat(core): runDoctor 聚合`）。

### Task 6: host-api 接线 doctor method

- 目标：`/dshm` 单路由新增 `doctor` method，照 `registry-diagnose` 先例。
- 涉及文件：`src/core/host-api.ts`、`tests/doctor-api.test.mjs`
- 接口契约
  - Consumes: Task 5 的 `runDoctor`；host-api method 分发表结构（先读 `registry-diagnose` case，锚点约 L621-627，与 method 表约 L306-627）；`readLauncherPackageVersion`（宿主进程内纯 FS 可得，null 容忍）。
  - Produces: method `doctor`——请求 `{ method: 'doctor' }`，响应 `{ ok: true, report: DoctorReport }`（信封形状照既有 method）；不收 force/参数（首期无缓存概念，每次全量跑，纯 FS 成本可控）；profile 取当前 active profile（与既有 method 同源解析）；`runtimeVersion` 在 case 内经 `readLauncherPackageVersion()` 解析后传入 `runDoctor`（测试进程下该函数为 null 属预期，正好覆盖降级路径）。测试覆盖分工：**stale 判定逻辑由 Task 2 单测以注入版本覆盖**；本任务测试只覆盖 method 接线与 null 降级路径；生产宿主内的真实 stale 检出无自动化测试触达，属已知边界。
- 验证范围：method 可调通且响应信封正确。

- [ ] Step 1: 照 `tests/host-api.test.mjs` 既有先例（`createApiDispatcher` + mock req/res + 注入 `profile.dir`）写失败测试 `tests/doctor-api.test.mjs`：断言响应 `ok:true`、`report.schema === 'dsh-m/doctor/v1'`、summary 计数与 fixture 相符。
- Run: `npm run build && node --test tests/doctor-api.test.mjs`
- Expected: 失败（method 未接线，返回未知 method 错误）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现——method 表新增 case：解析 runtimeVersion → 直调 `runDoctor(activeProfileDir, runtimeVersion)`。
- [ ] Step 4: 运行并确认通过。
- Run: `npm run build && node --test tests/doctor-api.test.mjs && npm run typecheck`
- Expected: 全部 pass。
- [ ] Step 5: checkpoint commit（`feat(host-api): doctor method`）。

### Task 7: CLI 子命令 dshm doctor

- 目标：CLI 直调核心，人读文本 + `--json` 双输出，HELP 同步。
- 涉及文件：`src/cli.ts`、`tests/doctor.test.mjs`（CLI 用例并入）
- 接口契约
  - Consumes: Task 5 的 `runDoctor`；`src/cli.ts` 既有命令注册模式（约 L230-439）与「恒 web profile、`--profile desktop` 拒绝」惯例（约 L222-227）；HELP 命令枚举（约 L167-191）；测试的 profile 指定机制 = 环境变量 `DSH_HOME`（`src/core/env.ts` 的 `dshHome()`，设 `DSH_HOME=<fixture 根>` 即让 webProfileDir() 解析到 `<root>/profiles/web`，仓内既有机制无需新参数）。
  - Produces: `dshm doctor [--json]`——默认输出：summary 行（布局 / errors / warnings / **farm 维度 total+dangling+stale** / residue 计数 / account 不一致数 / runtimeVersion 是否解析）+ error 与 warning 逐条（含 hint）+ **stale-target 代表例至多 3 条** + 清单类计数与代表样例（全文在 --json）；`--json` 输出完整 DoctorReport；exit code：errors > 0 → 1，否则 0；runtimeVersion 解析为 null 时 stale 维度显示「降级(unknown)」而非 0；**不依赖 registry/网络**——清单不可用时 doctor 照常工作（与既有「registry 不可用 exit 1」的命令互不影响）。
- 验证范围：`--json` 可被 JSON.parse；含 error 的 fixture exit 1；`--profile desktop` 被拒；HELP 含 doctor 行。

- [ ] Step 1: 写失败测试——子进程设 `DSH_HOME=<fixture 根>` 跑 `node lib/cli.js doctor --json`，断言 JSON 可解析、errors>0 时 exit 1、`--profile desktop` 被拒。
- Run: `npm run build && node --test tests/doctor.test.mjs`
- Expected: 新增用例失败（子命令不存在）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现（命令体 + HELP 行同步更新）。
- [ ] Step 4: 运行并确认通过（含 HELP）。
- Run: `npm run build && node --test tests/doctor.test.mjs && npm run typecheck && npm test && node lib/cli.js 2>&1 | grep doctor`
- Expected: doctor 用例全 pass；`npm test` 全量回归零新增失败（基线 1030 pass）；HELP 输出命中 doctor 行 ≥1。
- [ ] Step 5: checkpoint commit（`feat(cli): dshm doctor`）。

### Task 8: 文档同步、发版与本机装机验证

- 目标：0.9.29 发版并在本机验证验收锚点。
- 涉及文件：`CHANGELOG.md`、`docs/DESIGN.md`、`package.json`
- 接口契约
  - Consumes: Task 1–7 全部产物；ADR-0010 验收锚点。
  - Produces: tag `v0.9.29` → publish.yml OIDC 发版；本机 web profile 装机并实测。
- 验证范围：见 Step 4/5。

- [ ] Step 1: CHANGELOG 双语条目（新命令 `dshm doctor` + `/dshm` method；按仓内既有条目风格）；DESIGN.md 增补体检小节（含 ADR-0010 指针）；package.json version 0.9.29。
- Run: `npm test`
- Expected: 全量 pass（文档改动零回归）。
- [ ] Step 2: 提交并打 tag `v0.9.29`，push 后确认 publish.yml OIDC 绿。
- Run: `git log --oneline -1 && git tag -l 'v0.9.29'`
- Expected: tag 存在；Actions 发布成功、npm 上架可查（`npm view dsh-m version` = 0.9.29，注意 staged 发布 ~17min 延迟，know-how 018）。
- [ ] Step 3: 本机 web profile 升级 dsh-m（`dshm upgrade dsh-m`，生效判定若报 restart-required 则按 know-how 015 纪律 `sudo systemctl restart deepseek-harness.service`，这是唯一 3080 实例，遵守 `~/.dsh/AGENTS.md` 红线）。
- Run: `grep '"version"' ~/.dsh/profiles/web/node_modules/dsh-m/package.json`
- Expected: 0.9.29。
- [ ] Step 4: 实测验收锚点（ADR-0010 Consequences）：`dshm doctor` 首跑——8 个空 scope 目录与 12 个 `*.bak-*` 以结构化清单呈现（数量以届时实况为准）；**farmChecked > 0（预期 ≈236：2026-10-04 评审实测 236 条于父目录共享店；farmChecked=0 视为祖先链遍历空转，验收不通过）**、悬空符号链 0 条（farmDangling=0）；stale 维度在 CLI 通路因版本源降级显示 unknown 属预期（stale 判定逻辑由 Task 2 单测以注入版本覆盖、Task 6 测 method 接线与降级路径，生产宿主内的真实 stale 检出无自动化测试触达属已知边界——本机 `dsh` 链接指向 0.1.7-rc.2 旧店而运行时 0.2.0-rc.2，为现成人工核对形态，装机后可经宿主 method 人工验证一次）；账实一致或如实报告不一致（本机 2 条 link: 依赖按契约处理）；双市场并存以信息级出现；`dshm doctor --json` 可解析。
- Run: `dshm doctor; echo "exit=$?"; dshm doctor --json | head -5`
- Expected: 输出与锚点相符；errors = 0 时 exit=0。
- [ ] Step 5: 验收记录回写：CHANGELOG 待定条目结算（若沿用 0.9.24 惯例）+ know-how 014 索引行补「已工具化：`dshm doctor`」标注（对 `01_docs/dsh-intall-know-how/AGENTS.md` 索引表的修订属工作区仓库，单独提交）。

## 执行纪律

- 开始实现前，先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划。
- 按任务顺序执行，不无声跳步、合并步或改变任务目标。
- 每完成一个任务，运行该任务定义的验证。
- 遇阻塞、重复失败或计划与仓库现实不符（尤其 lockfile 形状、HELP 打印路径、DSH_HOME 机制的边角），立即停下来说明，不要猜。
- 若当前就在 main 且用户未明确同意，开始实现前先确认。
- 全部任务完成后，运行最终验证并输出修改摘要。

## 最终验证

- Run: `npm run typecheck && npm test`
- Expected: typecheck 零错误；全量测试 pass（基线 1030 + 新增 doctor 用例）。
- Run: `dshm doctor --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);if(r.schema!=='dsh-m/doctor/v1')process.exit(1);if(r.summary.farmChecked<1)process.exit(2);console.log('schema ok, errors='+r.summary.errors+', farmChecked='+r.summary.farmChecked)})`
- Expected: `schema ok, errors=0, farmChecked>0`（本机验收锚点；farmChecked=0 即遍历空转必须回炉；若实况有 error 级发现，如实评估是否为新问题而非掩盖）。

## 审阅 Checkpoint

- 计划正文结束；请用户审阅通过后再进入实现（见会话内交接说明）。
