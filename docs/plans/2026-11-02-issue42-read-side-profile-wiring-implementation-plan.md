# issue #42 读侧 profile 接线修复 实施计划

## 目标

修复 dsh-m 0.12.0 的两处读侧 profile 接线缺陷（issue #42，ADR-0030 收尾）：

1. `upgradePluginLocked` 已装枚举误读 `opts.profileDir`（恒 undefined）→ 自定义 profile 下升级必报「web profile 未安装该插件」；
2. CLI 三条只读命令（`list`/`outdated`/`search`）不传 `profileDir`/`profile` → 无论 `--profile` 传什么都静默读 `profiles/web`。

连带交付：两处误导性「web profile」硬编码文案、help 文案更新到 ADR-0030 口径、删除 `opts.profileDir` 死字段、先合入 dependabot #40 后一并发 0.12.1、回帖 issue #42。

## 架构快照

- 修复方向由 ADR-0030 决议②「目录权威：读写恒用宿主给的 dir」直接强制：升级读侧改用与同文件 `installEntryLocked`（market-mutation.ts `installEntryLocked` 内 `deps?.transaction?.profileDir ?? deps?.profileDir ?? webProfileDir()`）、uninstall 事务、selfUpgrade 三处一致的 deps 形态。
- CLI 读命令与写命令消费同一对变量 `cliProfileName`/`cliProfileDir`（cli.ts `CLI 目标 profile 唯一解析点` 注记处，switch 之前已就绪），单一事实源。
- 不改任何门禁：CLI 门禁（`case` 分发前的 `isDshProfileName` / `DESKTOP_PROFILE_NAMES` 拒绝段）逐字冻结；desktop/tauri 名依旧仅 doctor 可达。
- 零漂移：不传 profile 时 deps 形态解析结果为 `undefined` → 落 `webProfileDir()`，与 0.12.0 现行为逐字节一致；profile 恰名为 `web` 的用户不受任何影响。

## 全局约束

- **零漂移纪律**：不传 `--profile`（CLI）/ deps 无 profileDir（core）时，输出与行为必须与 0.12.0 完全一致。
- **门禁冻结**：desktop/tauri 名拒绝逻辑、doctor 例外、`WRITE_GUIDANCE_UNKNOWN` 等文案逐字不动（ADR-0030 决议④）。
- **文案规则**：「未安装」报错沿用 `installed.ts:344` 既有形态 `` `${profileName} profile 未安装该插件: ${key}` ``；market-mutation 侧取 `deps?.profileName ?? opts.profile ?? WEB_PROFILE` 为名。
- **测试导入约定**：`src/core/*.ts` 无可直接 import 的 JS，相关测试从 `lib/core/*.js` 引入；**单文件跑测前必须 `npm run build`**，否则测的是旧产物。
- **退出码卫生**：验证输出经管道时一律 `set -o pipefail`；由此注意 `grep -o … | wc -l` 零命中时管道整体 exit 1（grep 的 1 经 pipefail 透传）——计数 0 的判据一律用 `! grep -q …` 或 `test "$(…)" = 0` 恒稳形态（评审 R1-Q1 探针实录）。
- **npm 缓存前置**（工作区 agent-ops「npm 调用」纪律）：任何联网/写缓存的 npm 调用一律前缀 `npm_config_cache=$HOME/workspace/.npm-ci-cache`——含 `npm install`、`npm run release`（内部 assert-pack 触发 pack）、`npm view`；沙箱默认 `~/.npm` 只读，2026-10-24/10-29 两次 EROFS 实录。
- **发版纪律**：版本三处一致（package.json + package-lock.json 根 version + packages[""].version，release 脚本自动同步 lock）；CHANGELOG 双语顶条；发版只走 `npm run release`，不手动打 tag。
- **命令环境**：bash / Linux 本机（`/home/ubuntu/workspace/dsh-m`）；预计超 90 秒的命令用 `run_in_background` 起跑。Windows 侧验收由报告者执行，不进本计划。
- 无额外版本/依赖约束（#40 为 devDep 小版本 bump，随本计划 Task 1 合入）。

## 冻结面与文案改动断言清点（评审 R1-Q6/Q8 复核结论，锚已双端亲验）

**冻结面**（哪些测试钉住「不许变」的东西；执行后按此核对未被破坏）：

| 冻结面 | 钉住它的断言 | 本次验证面 |
|---|---|---|
| CLI 门禁（desktop/tauri 名拒绝、不安全名拒绝） | `tests/cli-custom-profile.test.mjs` desktop/tauri/`../evil` 三例；`tests/market.test.mjs`「--profile desktop 显式拒绝（exit 1、零 core 调用、文案点名收到的值）」 | Task 6 Step 3 验证面内 |
| doctor 例外（desktop 名仅 doctor 可达） | `tests/doctor.test.mjs`「--profile desktop 对 doctor 以外命令被拒绝」+ desktop 路由/文案钉子群 | Task 8 全量兜底 |
| `WRITE_GUIDANCE_UNKNOWN` 文案（定义于 `src/core/active-profile.ts`，本计划零触碰，冻结属预防性） | `tests/active-profile.test.mjs`「WRITE_GUIDANCE_UNKNOWN：模板函数」例 | Task 8 全量兜底 |
| 缺省零漂移（无 `--profile` → web） | `tests/cli-custom-profile.test.mjs` 无 flag 例；`tests/market.test.mjs` list/outdated 缺省输出例 | Task 6 Step 3 验证面内 |

**文案改动面**（三处改动各自与既有断言的冲突清点，结论零冲突）：

- 「未安装该插件」既有断言全部位于 installed.ts / toggle / host-api 桩侧（`tests/installed.test.mjs`、`tests/host-api.test.mjs`、`tests/profile-ops.test.mjs`，后者钉的是 desktop 侧文案）——`market-mutation.ts` 的 `upgradePluginLocked` 报错**零既有断言**（tests 全文零命中，探针复核），Task 3 改文案不触任何既有红绿判读。
- 「还没有已装」「恒作用于」在 tests/ 零命中；HELP 文本仅 `tests/cli-bin-symlink.test.mjs` 钉标题（不在改动面）。

## 输入工件

- issue #42（appllove，2026-11-02）：缺陷报告 + 修法建议 + 验收对照表
- `docs/adr/0030-custom-profile-write-support.md`：读侧收尾的不变量来源
- grill 共识（2026-11-02 会话）：单 PR 原子修、正向断言、死字段删除、#40 并入 0.12.1、发布后回帖口径

## 文件结构与职责

- Modify: `src/core/market-mutation.ts`（`upgradePluginLocked` 读侧一行 + 未安装文案 + 两处 opts 类型删 `profileDir`）
- Modify: `src/cli.ts`（`case 'search'` / `case 'list'` / `case 'outdated'` 三处 opts 补字段 + `case 'list'` 空目录文案 + HELP 文案段）
- Modify: `package.json`（version → 0.12.1；lock 两处由 release 脚本同步）
- Modify: `CHANGELOG.md`（双语顶条）
- Test: `tests/market-mutation.test.mjs`（新增读侧正向断言 describe，3 例）
- Test: `tests/cli-custom-profile.test.mjs`（新增读侧 opts 接线 it，3 例）
- 边界：`toggle.ts:137`、`profile-transaction.ts:912` 的同类「web profile」硬编码**不进本计划**（见「范围外注记」）

## 任务清单

### Task 1: 合入 dependabot #40 并建立全量基线

- 目标：#40（@types/node 26.6.5→26.6.6 devDep）进 main，本地依赖与 lock 同步，全量测试基线绿。
- 涉及文件：无源码改动（远端 merge + 本地 pull + `npm install`）。
- 接口契约
  - Consumes: 远端 PR #40 处于 open 且 CI 可合。
  - Produces: main 含 squash 提交 `chore(deps-dev): bump @types/node ... (#40)`；本地 node_modules 与 lock 一致，供后续 typecheck 使用。
- 验证范围：`git log --oneline -1` 显示 #40 squash 提交；全量 `npm test` exit 0。

- [ ] Step 0: 计划文档单独入库（本文件当前 untracked——不先入库则 Step 1 的「porcelain 为空」必假，且 Task 9 Step 1 的 `git add -A` 会把计划混进修复提交——评审 R3-Q12；惯例同 `acb5464 docs(plans)`）
- Run: `git add docs/plans/2026-11-02-issue42-read-side-profile-wiring-implementation-plan.md && git commit -m "docs(plans): issue #42 读侧 profile 接线修复实施计划（评审闭环终稿）" && git status --porcelain`
- Expected: 提交成功；porcelain 输出为空（Step 1 前提由此成立）
- [ ] Step 1: 确认仓库工作树干净、当前在 main
- Run: `cd /home/ubuntu/workspace/dsh-m && git status --porcelain && git branch --show-current`
- Expected: porcelain 输出为空；分支名 `main`
- [ ] Step 2: 确认 #40 可合（GitHub 的 mergeable 惰性计算，UNKNOWN 时稍候重查——评审 R1-Q3）
- Run: `gh pr view 40 --repo iasiv5/dsh-m --json state,mergeable,mergeStateStatus`
- Expected: `"state":"OPEN","mergeable":"MERGEABLE"`（mergeStateStatus 非 BLOCKED/DIRTY；本计划撰写时点实测为 CLEAN）
- [ ] Step 3: squash 合入 #40 并拉回本地
- Run: `gh pr merge 40 --squash && git pull --ff-only`
- Expected: merge 成功；pull 无冲突
- [ ] Step 4: 依赖预检与同步（工作区 AGENTS.md 前置：`test -d node_modules`；#40 改了 lock 的 devDep，需同步本地）
- Run: `test -d node_modules && npm_config_cache=$HOME/workspace/.npm-ci-cache npm install --ignore-scripts`
- Expected: 无 EROFS/E401（缓存前置已保障，非碰运气）；`git diff --stat` 输出为空（lock 无意外重写；node_modules 本就 gitignore、不入 diff——评审 R3-Q11）
- [ ] Step 5: 全量基线（超 90 秒，后台起跑）
- Run: `set -o pipefail; npm test 2>&1 | tail -15`
- Expected: exit 0，全部测试绿；基线 **2008/2008**（CHANGELOG 0.12.0 同数；评审副本实跑复核，logs/baseline-npmtest.log，184.7s）——实际输出与该数不符时停下核对，不猜

### Task 2: market-mutation 读侧正向断言测试（写红）

- 目标：钉死「`upgradePluginLocked` 的 `listInstalledPlugins` 实参必须等于 deps 接线的 profileDir」，先红后修。
- 涉及文件：`tests/market-mutation.test.mjs`（新增 describe）。
- 接口契约
  - Consumes: `upgradePlugin`（`lib/core/market-mutation.js`）、该文件既有 `readyLoaded` 助手与临时 profile 目录写法（文件内既有用例同款）、`describe/it/assert` from `node:test`/`node:assert/strict`。
  - Produces: 三个 it（变体 A/B/C），Task 3 修复后转绿，永久作为读侧落点回归。
- 验证范围：`npm run build && node --test tests/market-mutation.test.mjs` 中新增 3 例，A/B 红、C 绿。

- [ ] Step 1: 新增 describe `ADR-0030 读侧接线：upgradePluginLocked 已装枚举目录`，自带全部夹具与断言（不引用兄弟 describe 闭包；`readyLoaded`/`mockTxRunner` 为该文件模块级顶层函数，第 50/188 行，跨 describe 引用合法）。三例公共形态：`loadRegistry` 用 `readyLoaded` 返回含一个条目的清单；`listInstalledPlugins` 桩为 `async (dir) => { captured.push(dir); return { items: [], others: 0, complete: true, profileDir: dir } }`（**返回空 items**，使升级在读侧之后立刻抛「未安装该插件」，避免触达事务层）；断言用 `assert.rejects(..., /未安装该插件/)` 后检查 `captured[0]`。
  - 变体 ①（**生产形态镜像，主红例**）：`deps = { loadRegistry, listInstalledPlugins, profileDir: fakeDir, profileName: 'aqua' }`（**顶层注入，无 transaction**——三个生产入口 host-api/tools/cli 同款形态，遵守「夹具形态镜像生产调用点」纪律，0.12.0 #39 实录条款）→ 断言 `captured[0] === fakeDir`；**rejects 断言收紧为 `/aqua profile 未安装该插件/`**（R4 独立防线：只修实参、漏改文案的中间态即红——评审 R3-Q10）
  - 变体 ②（约定优先级钉）：`deps = { loadRegistry, listInstalledPlugins, transaction: { profileDir: fakeDir } }`（仅 transaction，无顶层）→ 断言 `captured[0] === fakeDir`
  - 变体 ③（零漂移钉）：`deps = { loadRegistry, listInstalledPlugins }`（两者皆无）→ 断言 `captured[0] === undefined`（钉住「不得显式传 webProfileDir() 推导值」——调用方没接线时实参保持 undefined，由 installed 层缺省兜底）；rejects 断言用 `/web profile 未安装该插件/`（`profileLabel` 缺省回退 WEB_PROFILE 恒 'web'，修复前后消息逐字节不变——文案零漂移钉）
  - `fakeDir` 用该文件既有临时目录模式（`mkdtempSync` + finally `rmSync`），并断言 `fakeDir !== webProfileDir()` 作夹具前提（同 `tests/custom-profile-transaction.test.mjs:54` 前提式）。
  - 变异证据说明：评审检查单要求关键接线锚做单点变异确认锚红——本例红例先行即天然满足：Task 3 实施前这些用例对现存 bug（`opts.profileDir` 恒 undefined）必然红，bug 本身就是那次变异；无需额外隔离副本实验。
- [ ] Step 2: 构建并运行确认红绿形态
- Run: `set -o pipefail; npm run build && node --test tests/market-mutation.test.mjs 2>&1 | tail -20`
- Expected: 变体 ①② 失败（`captured[0]` 为 `undefined !== fakeDir`；① 的消息断言在「只修实参、漏改文案」的中间态同样红——R4 防线）；变体 ③ 通过（captured 与消息双零漂移）；其余既有用例不受影响

### Task 3: 修 upgradePluginLocked 读侧一行与未安装文案（转绿）

- 目标：`listInstalledPlugins` 实参改 deps 形态；报错携带实际 profile 名。
- 涉及文件：`src/core/market-mutation.ts`（锚：`async function upgradePluginLocked(`，函数体首两行）。
- 接口契约
  - Consumes: Task 2 的三个 it；`WEB_PROFILE`（该文件第 10 行已自 `./env.js` 导入）。
  - Produces: 读侧实参形态 `deps?.transaction?.profileDir ?? deps?.profileDir`；文案模板 `` `${profileLabel} profile 未安装该插件: ${pkg}` ``（Task 9 CHANGELOG 引用）。
- 验证范围：Task 2 全部转绿；`custom-profile-transaction` 不变量家族不红。

- [ ] Step 1: 改实参一行
- Change: `const { items: installed } = await (deps?.listInstalledPlugins ?? defaultListInstalledPlugins)(opts.profileDir)` → `(deps?.transaction?.profileDir ?? deps?.profileDir)`（与 uninstall 事务、selfUpgrade 形态逐字一致）
- [ ] Step 2: 改未安装文案
- Change: `if (!target) throw new Error(\`web profile 未安装该插件: ${pkg}\`)` → 前置 `const profileLabel = deps?.profileName ?? opts.profile ?? WEB_PROFILE`，异常模板改为 `` `${profileLabel} profile 未安装该插件: ${pkg}` ``（不传 deps 时 `profileLabel === 'web'`，与 0.12.0 字节一致）
- [ ] Step 3: 构建并确认转绿
- Run: `set -o pipefail; npm run build && node --test tests/market-mutation.test.mjs tests/custom-profile-transaction.test.mjs 2>&1 | tail -10`
- Expected: 全绿（含 Task 2 的 ①②③）

### Task 4: 删除 upgradePlugin 家族 opts.profileDir 死字段

- 目标：杜绝后续调用方从 opts 传 profileDir 的错觉（本次事故根源形态）。
- 涉及文件：`src/core/market-mutation.ts`（锚：`export function upgradePlugin(` 与 `async function upgradePluginLocked(` 的 opts 参数类型字面量）。
- 接口契约
  - Consumes: Task 3 已完成的运行时修复（两者同一 PR，顺序不限但先修后删使测试始终有实义）。
  - Produces: 两函数 opts 类型不再含 `profileDir`；`src/core/market-mutation.ts` 内 `opts.profileDir` 零命中。
- 验证范围：typecheck 绿 + 源锚零命中 + 单文件测试不红。

- [ ] Step 1: 从两处 opts 类型字面量删除 `profileDir?: string;`（保留 `forceIncompatible`/`channel`/`RegistryRuntimeOptions` 等其余字段）
- [ ] Step 2: 源锚确认（计数 0 判据用 `! grep -q` 恒稳形态——pipefail 下 `grep -o | wc -l` 零命中管道整体 exit 1，禁用；评审 R1-Q1 探针实录）
- Run: `! grep -q "opts.profileDir" src/core/market-mutation.ts`
- Expected: exit 0（零命中即通过；仍有残留则 exit 1）。基线时点计数=1（仅 `:913` bug 行一处；`:877/:909` 类型字面量是 `profileDir?:` 不含 `opts.` 前缀）——判据非永真/永假
- [ ] Step 3: typecheck 与单文件回归
- Run: `set -o pipefail; npm run typecheck && node --test tests/market-mutation.test.mjs 2>&1 | tail -5`
- Expected: typecheck exit 0；测试全绿（仓内已确认无任何 opts.profileDir 消费者）

### Task 5: CLI 读侧 opts 接线测试三例（写红）

- 目标：钉死 `list`/`outdated`/`search` 必须把 `profileDir`+`profile` 传进 core。
- 涉及文件：`tests/cli-custom-profile.test.mjs`（既有 `describe('ADR-0030：dshm CLI 门禁放开 + 写命令接线')` 内追加三个 it）。
- 接口契约
  - Consumes: 既有 `runCapture(argv, deps)` harness、`dshHome`（该文件已导入）、`upgradeResult` 等夹具同款风格；`listInstalledWithMeta`/`listMarket` 为 runCli 可注入的 deps 键。
  - Produces: 三例接线断言，Task 6 修复后转绿。
- 验证范围：`npm run build && node --test tests/cli-custom-profile.test.mjs` 新增 3 例红。

- [ ] Step 1: 新增三例（断言只看 captured opts 与 exit code，不匹配输出文本）
  - `--profile aqua list → listInstalledWithMeta opts 接线`：`runCapture(['list', '--profile', 'aqua'], { listInstalledWithMeta: async (cfg, opts) => { captured.push(opts); return installedMetaResult } })`；断言 `captured[0].profileDir === join(dshHome(), 'profiles', 'aqua')` 且 `captured[0].profile === 'aqua'`
  - `--profile aqua outdated → opts 接线`：同型，overrides 键 `listInstalledWithMeta`
  - `--profile aqua search kw → listMarket opts 接线`：overrides 键 `listMarket`，argv 含位置参数 `kw`
  - 夹具 `installedMetaResult`（list 用，items 空以顺带走空目录文案分支）：`{ items: [], others: 0, profileDir: join(dshHome(), 'profiles', 'aqua'), registryState: { status: 'stale', source: 'bundled', stale: true, isDefault: true, fetchedAt: null, errors: [], count: 0 }, community: { status: 'ready', acceptedCount: 0 } }`
  - 夹具（outdated 用，单条不 outdated）：items 含 `{ pkg: 'p', name: 'p', version: '1.2.3', source: 'npm', spec: 'p@1.2.3', outdated: false, latestErrorCode: null, registryId: 'p', latestVersion: '1.2.3' }`，registryState/community 同上
  - 夹具（search 用，MarketResult 最小形态，items 空走「没有匹配的收录条目。」早退）：`{ items: [], total: 0, offset: 0, limit: 10, categoryCounts: { primary: 0, community: 0 }, registryState: { status: 'stale', source: 'bundled', stale: true, isDefault: true, fetchedAt: null, errors: [], count: 0 }, community: { status: 'ready', acceptedCount: 0 } }`
  - 若 CLI 打印路径触及夹具未给字段而抛错，按报错补齐夹具字段（断言目标不变）；`registryState` 字面量抄 `tests/host-api-profile.test.mjs` 既有 listMarket 夹具形态。
  - 注意：`tests/market.test.mjs:918` 既有 outdated 夹具缺 `community` 字段、靠 dispatch 层 catch 兜到 exit 1（测试绿但走的是错误路径）——本计划新夹具**必须带 `community.status`** 走真路径，不模仿该夹具形态。
- [ ] Step 2: 构建并运行确认红
- Run: `set -o pipefail; npm run build && node --test tests/cli-custom-profile.test.mjs 2>&1 | tail -20`
- Expected: 新增 3 例失败（`captured[0].profileDir` 为 `undefined`）；既有写命令接线 4 例不受影响

### Task 6: CLI 三 case 补接线与空目录文案（转绿）

- 目标：三条只读命令与写命令消费同一对 `cliProfileName`/`cliProfileDir`。
- 涉及文件：`src/cli.ts`（锚：`case 'search'`、`case 'list'`、`case 'outdated'` 三个 case 体）。
- 接口契约
  - Consumes: `cliProfileDir`/`cliProfileName`（cli.ts `CLI 目标 profile 唯一解析点` 注记处，switch 前已就绪）；Task 5 三例。
  - Produces: 读命令 opts 携带 `profileDir` + `profile`（字段名沿 `MarketQuery`/`RegistryRuntimeOptions` 既有命名，与 tools.ts host 路径 `listMarket` 调用一致）。
- 验证范围：Task 5 三例转绿；CLI 相关既有套件不红（`doctor.test.mjs` / `active-profile.test.mjs` 的冻结钉子不在单文件面内，由 Task 8 全量覆盖——见「冻结面与文案改动断言清点」）。

- [ ] Step 1: 三处 opts 补字段
- Change: `case 'search'` 的 `listMarket(cfg, { ... })`、`case 'list'` 与 `case 'outdated'` 的 `listInstalledWithMeta(cfg, { ... })` 三个 opts 对象各补 `profileDir: cliProfileDir, profile: cliProfileName`
- [ ] Step 2: 空目录文案去硬编码
- Change: `case 'list'` 内 `` out(`web profile（${result.profileDir}）还没有已装的 dsh 插件。`) `` → `` out(`${cliProfileName} profile（${result.profileDir}）还没有已装的 dsh 插件。`) ``（默认 web 时输出与 0.12.0 逐字节一致）
- [ ] Step 3: 构建并确认转绿（含 list/outdated 既有行为面回归）
- Run: `set -o pipefail; npm run build && node --test tests/cli-custom-profile.test.mjs tests/cli-search.test.mjs tests/market.test.mjs 2>&1 | tail -10`
- Expected: 全绿——market.test.mjs 的 list/outdated 用例（:900/:918）桩忽略 opts 新字段、断言输出串在缺省 `--profile` 下逐字节不变，必须保持绿（零漂移的既有行为面证据）

### Task 7: HELP 文案更新到 ADR-0030 口径

- 目标：help 不再宣称「CLI 恒作用于 web profile」，如实描述读命令尊重 `--profile`。
- 涉及文件：`src/cli.ts`（锚：HELP 模板字符串内 `dshm list` 行与 `profile 目标（0.9.0）` 段）。
- 接口契约
  - Consumes: 无（已确认无测试钉 help 文本）。
  - Produces: 无下游依赖。
- 验证范围：构建后 help 输出含新文案；desktop 拒绝说明保留。

- [ ] Step 1: 改四处（list 行 / outdated 行 / search 行 / profile 段）
- Change: `dshm list` 行 → `dshm list [--profile <名>]                列出目标 profile 已装插件（含市场标注/可升级）`；`dshm outdated` 行加 `[--profile <名>]`；`dshm search` 用法行（`--offset N` 之后）补 `[--profile <名>]`（Task 6 已给 search 接线，help 三读命令口径须一致——评审 R1-Q4）；`profile 目标（0.9.0）` 段改写为：缺省 web；`--profile <安全自定义名>` 与 web 名同权，读写直达 `profiles/<名>`（ADR-0030）；`--profile desktop` 仅 doctor 可用（只读体检，ADR-0011），Desktop profile 的插件管理走官方管理页。
- [ ] Step 2: 构建并目检 help 输出（含 help 行为面回归——`cli-bin-symlink.test.mjs:29` 以 `--help` 实跑断言标题，标题 `dshm — DSH Marketplace` 不在本次改动面，必须保持绿）
- Run: `set -o pipefail; npm run build && node --test tests/cli-bin-symlink.test.mjs 2>&1 | tail -5 && node lib/cli.js --help | grep -A 3 "profile 目标"`
- Expected: 测试绿；help 输出为新文案，含 ADR-0030 与 doctor 例外说明

### Task 8: 全量验证收口

- 目标：全量测试 + typecheck 双绿，作为发版前置。
- 涉及文件：无新改动。
- 接口契约
  - Consumes: Task 1–7 全部完成。
  - Produces: 发版前置条件「npm test 已全绿」达成。
- 验证范围：全量套件。

- [ ] Step 1: 全量测试（超 90 秒，后台起跑）
- Run: `set -o pipefail; npm test 2>&1 | tail -15`
- Expected: exit 0；用例总数 = **2008 + 6 = 2014**（Task 2 三例 + Task 5 三例；基线 2008 经评审副本实跑复核）
- [ ] Step 2: 类型检查
- Run: `set -o pipefail; npm run typecheck 2>&1 | tail -5`
- Expected: exit 0

### Task 9: 发版 0.12.1（版本三处 + CHANGELOG + release 脚本）

- 目标：0.12.1 上架 npm，含 #40 与本修复。
- 涉及文件：`package.json`（version → 0.12.1）、`CHANGELOG.md`（双语顶条）。
- 接口契约
  - Consumes: Task 8 双绿；工作树干净（先提交修复）。
  - Produces: npm `dsh-m@0.12.1`；git tag `v0.12.1` 指向发版提交。
- 验证范围：`npm run release` 内建门禁全过；npm 轮询确认上架。

- [ ] Step 1: 提交修复
- Run: `git add -A && git commit -m "fix(profile): 升级读侧与 CLI 只读命令接线 profileDir（issue #42，ADR-0030 读侧收尾）"`
- Expected: 提交成功，工作树干净
- [ ] Step 2: 版本 bump、lock 同步与 CHANGELOG 顶条
- Change: package.json `"version": "0.12.1"`；随即 `npm_config_cache=$HOME/workspace/.npm-ci-cache npm install --package-lock-only --ignore-scripts` 主动同步 lock 两处根版本（与 release 脚本自动同步同款命令，前置做完使发版脚本该步为 no-op）；CHANGELOG 双语顶条写明：升级读侧与 CLI 只读命令的 profile 接线修复（issue #42）；**行为变化注记**——`dshm list/outdated/search` 自此尊重 `--profile`（此前静默读 web）；**类型面注记**——删除 `upgradePlugin` opts 的 `profileDir` 死字段（0.x patch，全仓无消费者）；devDep @types/node 26.6.6（#40）
- [ ] Step 3: 发版提交
- Run: `git add -A && git commit -m "chore(release): 0.12.1（issue #42 读侧接线收尾；#40 devDep 并入）" && git log --oneline -2 && git diff --stat HEAD~1 HEAD | tail -3`
- Expected: 两笔提交就位；diff 统计含 `package.json`、`package-lock.json`、`CHANGELOG.md`（lock 两处版本已同步入库，release 脚本的三处一致判定为直接通过）
- [ ] Step 4: 发版（脚本内含 lock 同步→干净树→push 预检→tag→check-release→push；超 90 秒，后台起跑）
- Run: `set -o pipefail; npm_config_cache=$HOME/workspace/.npm-ci-cache npm run release 2>&1 | tail -25`
- Expected: 全部门禁绿，main 与 tag 推送成功，脚本打印 npm 轮询指引
- [ ] Step 5: 上架确认（npmjs 直查——本机默认 registry 为腾讯 mirror，分钟级同步延迟不作数；agent-ops README「发版与 npm 轮询」/know-how 018 口径，评审 R1-Q7）
- Run: `npm_config_cache=$HOME/workspace/.npm-ci-cache npm view dsh-m version --registry=https://registry.npmjs.org`
- Expected: `0.12.1`（CI 绿 ≠ 已上架，npmjs 轮询至版本号翻新；窗口内不重推 tag）

### Task 10: 回帖 issue #42 并关闭

- 目标：按 grill 共识⑦口径一次性回帖，请报告者复验，兑现社区引导。
- 涉及文件：无仓库文件（`gh issue comment` / `gh issue close`）。
- 接口契约
  - Consumes: Task 9 的 0.12.1 上架事实。
  - Produces: issue #42 关闭。
- 验证范围：回帖可见、issue 状态 closed。

- [ ] Step 1: 回帖（一次说完，不发过程帖）
- Change: 帖体含四段——①致谢（报告质量与 #39→#42 的战役价值）；②修复清单（两缺陷 + 文案 + 死字段，采纳其修法；测试改用正向断言并说明比否定式强的理由）；③复验指引：先执行其补丁脚本的 `-Revert` 回滚本地补丁，再 `npm i -g dsh-m@0.12.1`，按 issue 内「修复前后对照」表逐项复跑；④PR 意愿引导：欢迎为后续非紧急 issue 提 PR（例：toggle.ts 未安装文案同类硬编码，已记为候选）。
- [ ] Step 2: 关闭 issue
- Run: `gh issue close 42 --reason completed`
- Expected: issue #42 状态 closed

## 范围外注记（同类发现，明确不进本计划）

- `src/core/toggle.ts:137` 未安装报错硬编码「web profile」：`ToggleDeps` 无 `profileName`，修复需接线扩展而非纯文案——记为后续候选 issue（Task 10 回帖中向报告者提及）。
- `src/core/profile-transaction.ts:912` `NOT_INSTALLED` note 同类硬编码：语义牵涉 web 事务拒绝上下文，另行评估。
- 报告者建议的否定式断言（「不得等于 webProfileDir() 推导值」）不采用：按共识③以正向断言替代（`captured[0] ===` 接线目录），错误形态抓得更准。

## 验收项追溯表（计划追溯）

| 验收项（来源） | 任务 | 钉住它的测试 | 复现命令 |
|---|---|---|---|
| 升级读侧实参 = deps 接线目录（#42 缺陷①） | Task 3 | tests/market-mutation.test.mjs 新 describe 变体 ①② | `npm run build && node --test tests/market-mutation.test.mjs` |
| 调用方不接线时实参保持 undefined（零漂移） | Task 3 | 同上变体 ③ | 同上 |
| 未安装报错携带实际 profile 名（共识④） | Task 3 | 变体 ① 断言 `/aqua profile 未安装该插件/`（漏改文案即红、双修才绿——真红绿，非宽松 regex）；变体 ③ 断言 `/web profile 未安装该插件/`（缺省 profileLabel 零漂移钉） | `npm run build && node --test tests/market-mutation.test.mjs` |
| CLI 读命令 opts 接线 profileDir+profile（#42 缺陷②） | Task 6 | tests/cli-custom-profile.test.mjs 新增三例 | `npm run build && node --test tests/cli-custom-profile.test.mjs` |
| 缺省无 `--profile` 行为零变化（全局约束） | Task 6 | tests/market.test.mjs :900/:918 既有用例保持绿 | `node --test tests/market.test.mjs` |
| 死字段 `opts.profileDir` 删除（共识⑤） | Task 4 | typecheck + `! grep -q` 源锚（与 Task 4 Step 2 同形态） | `npm run typecheck` + `! grep -q "opts.profileDir" src/core/market-mutation.ts` |
| help 文案 ADR-0030 口径（共识④ 扩展） | Task 7 | tests/cli-bin-symlink.test.mjs help 行为面 + 目检 | `node --test tests/cli-bin-symlink.test.mjs` |
| #40 并入 0.12.1（共识⑥） | Task 1/9 | `git log` squash 提交 + release 门禁 | `gh pr merge 40 --squash`、`npm run release` |
| 0.12.1 上架（共识⑥） | Task 9 | `npm view dsh-m version --registry=https://registry.npmjs.org` | 同左 |
| 回帖与关闭（共识⑦） | Task 10 | issue #42 state = closed | `gh api repos/iasiv5/dsh-m/issues/42 --jq .state` |

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项、矛盾或命令无效先修计划再动手。
- 按任务顺序执行，不无声跳步、合并步或改变任务目标；每完成一个任务立即跑该任务验证。
- 单文件跑测前必须 `npm run build`（测试引 lib/ 构建产物）。
- 预计超 90 秒的命令（全量 npm test、npm run release）用后台方式起跑，结果经日志或 job_output 取。
- 遇阻、重复失败或计划与仓库现实不符，立即停下说明，不猜。
- 全部任务完成后输出修改摘要与验证结果。

## 最终验证

- `set -o pipefail; npm test 2>&1 | tail -15` → exit 0（2014 = 2008 + 6）
- `npm run typecheck` → exit 0
- `npm_config_cache=$HOME/workspace/.npm-ci-cache npm view dsh-m version --registry=https://registry.npmjs.org` → `0.12.1`
- `gh api repos/iasiv5/dsh-m/issues/42 --jq .state` → `closed`
- 手工抽验（本机无自定义 profile，抽查零漂移即可）：`node lib/cli.js list`（无 --profile）输出与 0.12.0 语义一致。

## 审阅 Checkpoint

- 计划正文到此结束。请审阅；批准前不进入实现。
- 默认执行方：普通编码 agent 或人工执行者（本会话可直接执行，你此前已授权在拍板后开工）。
