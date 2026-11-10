# issue #65「载体 launch 识别 + 执行能力门」实施计划（ADR-0034，目标 0.12.13）

## 目标

修复 web-kind profile（含鸿蒙端侧 `ondevice`）安装/升级/卸载/自升级在宿主入口不可识别环境下的必然失败（`spawn dsh EACCES`）：

1. **Layer 1**：`dshArgv` port dshmarket 载体分支（`@deepseek-ai/dsh-desktop-host/lib/cli.js`，#975）与 asar 入口 cwd 豁免（#1146）；新增 `resolveDshLaunch` 带 `source` 溯源；`runDshPlugin` 对 spawn 级失败错误追加溯源行。
2. **Layer 2**：新增 `exec-route` 执行能力门——launch 落 `path-fallback` 且 PATH `dsh` 不可执行时，四写操作（install/upgrade/uninstall/self-upgrade）委派官方 pluginManager（desktop ops 同路）或结构化 fail-fast（`no-exec-capability`，事务未动）。
3. **chip 同链**：`spawnDshVersion` 改用 `dshArgv()` 解析结果 spawn。

非目标（scope out，ADR-0034 Consequences 已声明）：ladder pnpm 恢复步骤的端侧 EACCES、`readLauncherPackageVersion` 载体语义、restart 端侧专门适配、CLI 三命令加门、client/i18n 面（本役零 client 改动）。

## 架构快照

```
dshm_install / panel install / dshm_upgrade / panel upgrade / dshm_uninstall / panel uninstall / panel self-upgrade
  └─ tools.ts / host-api.ts 站点（7 处）
       ├─ profile.kind !== 'web'  → desktop ops（现状不变）
       └─ web → routeWebMutation({getService, ensureService, op})      ← 新门（事务/session 之前）
            ├─ launch.source ∈ {entry, carrier}      → spawn（现状零漂移）
            ├─ path-fallback 且 probePathDshUsable()  → spawn（现状零漂移）
            ├─ path-fallback 且不可执行 且 manager+方法在场 → delegate → desktop ops 同路
            └─ path-fallback 且不可执行 且服务/方法缺席 → refuse: DesktopOpsError('no-exec-capability')
spawn 路径本体：runDshPlugin → dshArgv(=resolveDshLaunch 投影) → runCommand(spawn)
     载体/asar 分支：spawn(node, […execArgv, abs])，carrier/asar → cwd=undefined
```

## 全局约束

- **TDD 红先**：每任务先落新测试跑红（`npm run build && node --test tests/<file>`，core 测试从 `lib/core/*.js` 引入，跑前必 build），再实现转绿；红的前提写进任务。
- **hermetic 纪律（本役新增硬约束）**：单测不得依赖机器 PATH 上是否存在 `dsh`。既有 mutation 测试经 6 个构造点注入 `routeWebMutation: spawnRouteStub`（恒 spawn 的常量桩，见迁移表）；新门测试全部走注入缝（launch/probe/manager），生产真实探测只在生产接线出现。
- **源锚形态**：盘上源文件 CRLF——单行锚禁含 `\n`；计数用 `needle 全文出现次数`（`src.split(n).length-1`），不用 `grep -c` 行数语义；验证管道一律 `set -o pipefail` 保留原退出码。
- **计划外不夹带**：diff 逐文件可归因到任务；`restart.ts`/`cli.ts`/`toggle.ts`/client 面零改动。
- **文案钉死**：refuse 文案、溯源行格式按本计划字面实现，i18n 不涉（core 错误串，非 client lookup）。

## 输入工件

| 工件 | 位置 |
|---|---|
| ADR-0034（决策与证据） | `docs/adr/0034-desktop-host-carrier-launch-and-exec-gate.md` |
| 对比分析（上游蓝本） | `~/.dsh-research/issue65-dshmarket-compare/COMPARE.md` |
| 上游载体分支 | dshmarket `47e8e27`（v1.73.5，#975）；asar `1e86641`（1.73.17，#1146）；形态见 `.dsh-research/dsh-market-fresh/src/dsh-cli.ts:480-503` |
| issue #65 | 设备报错原文、`host-ready.json`、dshmarket 同机成功事实（gh api 已取） |
| 基线（2026-11-10，main b40542b） | 2228 pass / 1 fail：`tests/run-command-error-digest.test.mjs:217` F1-R/C（200ms 进程组计时敏感，环境既有失败） |
| 本机实测 | `node ~/.local/share/pnpm/dsh --version` → `0.2.2-rc.1` exit 0（shim 为 node shebang JS，`node <shim>` 直跑成立） |

## 文件结构与职责

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/core/dsh-cli.ts` | 改 | `resolveDshLaunch`（新导出）+ 载体/asar 分支 + `dshArgv` 委托投影 + `runDshPlugin` 溯源增强 + `launchProvenanceNote`（模块内） |
| `src/core/dsh-version.ts` | 改 | `spawnDshVersion` 改用 `dshArgv(input)`（新可选第二参 + export） |
| `src/core/profile-ops.ts` | 改 | `DesktopOpsErrorCode` 增 `'no-exec-capability'`；`resolveManager` 加 export |
| `src/core/exec-route.ts` | 新 | `probePathDshUsable` / `decideWebMutationRoute`（纯）/ `routeWebMutation`（编排缝） |
| `src/tools.ts` | 改 | dshm_install / dshm_upgrade / dshm_uninstall 三站点门接线；deps 增 `routeWebMutation` |
| `src/core/host-api.ts` | 改 | panel install / upgrade / uninstall / self-upgrade 四站点门接线；deps 增 `routeWebMutation` |
| `tests/dsh-launch.test.mjs` | 新 | Task 1 矩阵（载体/asar/回退/形状稳定） |
| `tests/dsh-cli-governance.test.mjs` | 改 | Task 2 溯源 describe |
| `tests/dsh-version.test.mjs` | 改 | Task 3 spawnDshVersion describe |
| `tests/exec-route.test.mjs` | 新 | Task 4 决策矩阵 + probe 夹具 |
| `tests/tools-install.test.mjs` | 改 | helper 注入迁移 + Task 5 三站点路由用例 |
| `tests/host-api.test.mjs` / `tests/host-api-profile.test.mjs` / `tests/host-api-external.test.mjs` | 改 | helper 注入迁移 + Task 6 四站点路由用例 |
| `GLOSSARY.md` / `CHANGELOG.md` | 改 | Task 7 |

## 任务清单

### Step 0（执行前置）：基线与工作树

- `git status` 干净、HEAD = b40542b（0.12.12）；基线已录（见输入工件）。
- 全量判别基准备忘：**除 `run-command-error-digest` F1-R/C 外任何红 = 本役回归**；F1-R/C 若本轮环境性转绿则 2229 pass。

### Task 1: `resolveDshLaunch` 载体 + asar + source（红先）

- **红前提**：新建 `tests/dsh-launch.test.mjs`（import `../lib/core/dsh-cli.js`），先写下列矩阵断言 → build 后跑红（`resolveDshLaunch` 不存在 / carrier 断言失败）。
- **实现**（`dsh-cli.ts`）：
  - 模块级两个正则常量：`DESKTOP_CARRIER_RE = /[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh-desktop-host[\\/]lib[\\/]cli\.js$/`、`ASAR_ENTRY_RE = /[\\/][^\\/]+\.asar[\\/]/i`（与 dshmarket 逐字对齐，含大小写不敏感的 asar 匹配）。
  - `export type DshLaunchSource = 'entry' | 'carrier' | 'path-fallback'`；`export interface DshLaunch { file; args; cwd; viaShell; source: DshLaunchSource; entry: string | undefined }`。
  - `export function resolveDshLaunch(input: Parameters<typeof dshArgv>[0] = {}): DshLaunch`：entry 分支条件改 `entry !== undefined && (carrier || /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry))`（共享正则保持原字面）；命中 → `abs = resolve(entry)`，`cwd = carrier || ASAR_ENTRY_RE.test(abs) ? undefined : dirname(abs)`，`source: carrier ? 'carrier' : 'entry'`；未命中 → `{ file: 'dsh', args: [], cwd: undefined, viaShell: platform === 'win32', source: 'path-fallback', entry }`。
  - `dshArgv(input)` 改为调 `resolveDshLaunch` 并**显式投影四字段**（不得 spread，防形状漂移）。
- **矩阵用例**（argv/execArgv/execPath/argv0/platform 注入，夹具用 `mkdtempSync` 真实文件）：
  1. entry=`…/lib/bin.js` → file=argv0 注入值，args=[...execArgv, abs]，cwd=dirname(abs)，viaShell=false，source `'entry'`（回归锚）。
  2. entry=`…/bin/dsh`（pnpm shim 形态，本机实况）→ 同上 source `'entry'`。
  3. carrier=`…/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js` → cwd=**undefined**，source `'carrier'`（设备形态红例）。
  4. 窄 regex 负例三连：`…/node_modules/@deepseek-ai/other/lib/cli.js`、`…/node_modules/@deepseek-ai/dsh-desktop-host/lib/other.js`、`…/somewhere/lib/cli.js` → 全部 `path-fallback`（PATH 遮蔽守卫，dshmarket carrier spec 同语义）。
  5. asar：entry=`…/app.asar/inner/@deepseek-ai/dsh/lib/bin.js` → cwd=undefined，source `'entry'`；carrier+asar 组合 → cwd=undefined，source `'carrier'`。
  6. entry undefined / entry=`cli.mjs` → `path-fallback`、file=`'dsh'`、viaShell=platform==='win32'。
  7. **形状稳定锚**：上述每例 `dshArgv(input)` 输出 `deepEqual({file,args,cwd,viaShell})` 四键（防投影漂移）。
- **验收**：`node --test tests/dsh-launch.test.mjs` 绿；`npm test` 既有绿不受影响。
- **零变化格**：非 carrier/asar 宿主的 file/args/cwd/viaShell 逐字节不变（用例 1/2/6/7 钉住）；`restartLaunch`/`dsh-version` 既有用例全绿即证。

### Task 2: `runDshPlugin` spawn 失败溯源行（红先）

- **红前提**：`tests/dsh-cli-governance.test.mjs` 新 describe「spawn 失败溯源」（runCommand 全注入，不 spawn 真进程；**不注入 dshArgv**——生产解析在 node --test 进程 argv[1]=测试文件 → path-fallback，hermetic 且确定）：
  1. 注入 `runCommand` 抛 `Error('spawn dsh EACCES')` → 断言抛出消息含 ` [dsh-m launch: source=path-fallback entry=` 与 ` file=dsh]`（entry 值=测试文件路径，不钉具体值）；先红。
  2. 注入 `dshArgv`（既有 governance 注入形态）+ 同样抛 spawn 错 → 断言**无**溯源行（注入=测试上下文，不 enrich——钉裁决）。
  3. 负例两连：`命令失败 (exit 1): …`、`命令超时 200ms` → 无溯源行。
- **实现**：
  - `runDshPlugin` 内 spawn 变量取值不变（`deps.dshArgv ?? dshArgv`，:649 注入缝不动）；溯源增强**仅在 `deps.dshArgv === undefined`（生产路径）时生效**：`const launch = resolveDshLaunch()`，note = `` ` [dsh-m launch: source=${launch.source} entry=${launch.entry ?? '(none)'} file=${launch.file}]` ``（字面钉死，ASCII）。
  - 触发条件（钉死）：`/^spawn .+ [A-Z][A-Z0-9]*$/.test(err.message)`（Node spawn 错误原始形态 `spawn <file> <ERRNO>`）。命中 → `err.message += note`；顺序钉死：**先 enrich，后 `progress.error` 写入（:674-675 现行两行语义不变），再 rethrow**。
  - **分类防染负例（钉死）**：note 不含 `pnpm`/`ERR_PNPM`/`allowBuilds`/`needs to execute build scripts` 字样；测试断言 `isPrepareBlocked(enriched) === false` 且与原始文本的 `classifyPnpmError` 同 class（DUAL_CODE_RE 按 ERR_PNPM_* 码与 registry host 子串匹配，dsh-cli.ts:18/287——ASCII 溯源行无污染，评审已核）。
  - 非 spawn 级错误（`命令失败 (exit 1): …`、`命令超时 …`）不 enrich（负例用例）。
- **验收**：governance 套件绿；`rollback-heal`/`pnpm-outcome` 既有绿（分类面未染）。
- **零变化格**：健康宿主 spawn 成功路径输出零变化；非 spawn 级错误文案零变化（负例钉住）。

### Task 3: `spawnDshVersion` 走 `dshArgv`（红先）

- **红前提**：`tests/dsh-version.test.mjs` 新 describe：真实子进程——夹具树 stub `bin.js` 打印 `9.9.9`；`spawnDshVersion(3000, { argv: [nodeExec, stubPath], execArgv: [], execPath: nodeExec, argv0: nodeExec, platform: 'linux' })` 解析回 `'9.9.9'`；先红（现实现恒 spawn 字面 `'dsh'`，无 input 参）。
- **实现**（`dsh-version.ts`）：
  - `export async function spawnDshVersion(timeoutMs: number, input: Parameters<typeof dshArgv>[0] = {})`；内部 `const argv = dshArgv(input)`；`spawn(argv.file, [...argv.args, '--version'], { stdio: ['ignore', 'pipe', 'ignore'], shell: argv.viaShell })`——stdio 三通道与现行（dsh-version.ts:68）**逐参一致**（评审 M4/M3 修订：stderr 保持 'ignore'；实装 `shell: argv.viaShell`，DshArgv.viaShell 类型 boolean，与计划原字面 `=== true` 语义等价零行为差）；**不传 cwd**（`--version` 无 cwd 语义，全形态零漂移）；其余 timer/kill/close 逻辑原样。
  - `resolveDshVersionWith` 的 `spawnVersion` 默认臂不变（单参调用，input 缺省走 process.argv）。
- **正/负例**：正例见红前提；负例（hermetic，评审 B3 修订）：`input.argv=['node', '/nonexistent/dir/bin.js']`（命中共享正则走 entry 分支）+ `argv0/execPath=/nonexistent/node` → nodeExecutable 落 execPath → spawn ENOENT 走 error 事件 → `null`（dsh-version.ts:85-88；复审 R2-4 修正机制表述：非退出码路径）。viaShell 断言：platform 注入 `'linux'` → `shell:false` 恒（shell 包装行为不存在，POSIX 直 exec）。
- **验收**：dsh-version 套件绿；`host-api` ping.dshVersion 既有用例绿（deps 注入路径未动）。
- **零变化格**：PATH 回退宿主（file='dsh'）spawn 形态与现状逐参一致（shell=win32 同源）；deps 注入测试路径零变化。

### Task 4: `exec-route.ts` 能力门 + 错误码（红先）

- **红前提**：新建 `tests/exec-route.test.mjs`：
  - `decideWebMutationRoute` 纯矩阵（8 例）：非 path-fallback → spawn（忽略 manager/probe 输入）；path-fallback+usable → spawn；path-fallback+!usable+manager undefined → refuse（`code==='no-exec-capability'`，message 含「服务不可用」「安装已拒绝」「profile 未被修改」）；+manager 无 `installBundle` → refuse（message 含「缺 installBundle 方法」）；uninstall 的方法名是 `removeBundle`（op→方法映射四例）；+方法在场 → delegate（manager 原样透传）。
  - `probePathDshUsable`：tmpdir 夹具（可执行文件命中 / 缺失两态用真实 FS；「存在但 X_OK 否」态走**注入 accessX**——真实 accessSync 在 root 下 X_OK 恒过，永真判据防呆，评审 m9）+ pathEnv 注入 + win32 名单注入（`['dsh.cmd','dsh.exe']` 用例只验名单选择，不真跑 win32）。
  - 先红（模块不存在）。
- **实现**：
  - `profile-ops.ts`：`DesktopOpsErrorCode` 联合加 `| 'no-exec-capability'`（普查：src/tests 对该联合无穷举断言，2026-11-10 已核）；`resolveManager` 加 `export`（符号普查：仅加 export，模块内 5 处调用 :226/:393/:804/:961/:1063 不受影响，评审 m6 实数）。
  - `src/core/exec-route.ts`：`probePathDshUsable(deps?)`（pathEnv/platform/exists/accessX 注入缝；POSIX 名单 `['dsh']`，win32 `['dsh.cmd','dsh.exe']`；`accessSync(p, X_OK)` 异常=不可执行）；`OP_METHOD`/`OP_LABEL` 常量表（install→installBundle/安装、upgrade→installBundle/升级、self-upgrade→installBundle/自升级、uninstall→removeBundle/卸载）；`decideWebMutationRoute(input)` 纯函数；`routeWebMutation(deps)` 编排：`launch = (deps.launch ?? resolveDshLaunch)()`，**先判 spawn 短路（非 path-fallback 或 usable → 直接 spawn，不做任何 manager 探测）**，残局才 `resolveManager(deps)`（getService 直取 → ensureService 惰性拉起，与 desktop ops 同源）→ `decideWebMutationRoute`。
  - refuse 文案（钉死两变体）：`无法创建子进程（launch 落 PATH 回退且 PATH 上没有可执行的 dsh CLI），且官方 pluginManager 服务不可用；${label}已拒绝（fail-closed，profile 未被修改）。请在支持子进程的环境重试，或改用官方插件管理界面。` / 方法缺席变体把「服务不可用」换为「官方 pluginManager 缺 installBundle 方法」（removeBundle 同式）。
- **验收**：exec-route 套件绿；`profile-ops` 既有套件绿（联合扩展与 export 零回归）。

### Task 5: tools.ts 三站点接线（红先）

- **红前提**：`tests/tools-install.test.mjs`（走 `registerWithProfile` helper，coreOverrides 注入）新 describe「web 执行能力门」：
  1. install：注入 `routeWebMutation` 桩返 delegate + `desktopInstall` 桩返标记 → 断言 desktopInstall 被调且 opts 含 `profile: 'ondevice'`/`profileDir`/`channel: 'host-tool'`、`installFromRegistry` 未被调。
  2. uninstall：delegate → `desktopUninstall` 被调（`requiredMethod: 'removeBundle'` 经真实 routeWebMutation + 注入 probe/launch 验证一次映射）。
  3. upgrade：refuse 桩（真 `DesktopOpsError('no-exec-capability', …)`）→ 工具 execute 抛出同 code；`upgradePlugin` 未被调。
  4. spawnRouteStub 恒 spawn → 既有 web 用例行为不变（回归由既有 13 个 it() 用例自证）。
  先红（tools.ts 无 routeWebMutation deps）。
- **实现**：
  - deps 增 `routeWebMutation?: typeof routeWebMutation`，缺省 `deps.routeWebMutation ?? routeWebMutation`（生产恒真实现）。
  - 三站点（install :322-336、uninstall :403-411、upgrade :503-508）统一形态（评审 M5 修订：**gate 仅在 web 分支**，desktop 分支零改动零探测）：
    ```ts
    if (profile.kind !== 'web') return desktopArm()          // 原分支体提取为站点内局部函数，实参逐字不动
    const route = await d.routeWebMutation({ getService, ensureService, op: '<op>' })
    if (route.route === 'refuse') throw route.error
    if (route.route === 'delegate') return desktopArm()      // 同一局部函数复用
    …web 臂原样…
    ```
    desktopArm 提取 = 纯搬移（approvedBuilds 条件展开实参逐字不动）；**assertWriteAllowed 保持现位不动**（复审 R2-3）——install 在 desktop 臂内（tools.ts:329，随臂整体提取；web-kind delegate 路径跑它即返，active-profile.ts:178），upgrade/uninstall 在分派前（tools.ts:501/:406，不在臂内、不随提取）；delegate 时 web-kind 实参（如 `profile: profile.name`）已核实无 kind 拒绝面——opts.profile 仅作 registry 缓存键（registry.ts:520-529）与 upgrade-target.ts:157 投影键。
- **验收**：tools-install 全套件绿（迁移注入后既有用例零改写断言）。
- **零变化格**：desktop 分支零改动且不进 gate（M5 修订后 gate 仅 web 分支）→ desktop 行为逐字节不变；delegate 与 desktop 分支共用同一 desktopArm（纯搬移）；web+spawnRouteStub = 现行为。

### Task 6: host-api.ts 四站点接线（红先）

- **红前提**：`tests/host-api.test.mjs` 新 describe（走 `setup()` helper）：
  1. install delegate：ctx.deps 注入 `routeWebMutation` delegate 桩 + `desktopInstallFromRegistry` 桩（host-api deps :97-110 缝）→ 响应 payload = desktop 桩标记，`installFromRegistry` 桩未被调（calls 计数）。
  2. install refuse：真 refuse 桩 → 409 信封 `{ok:false, code:'no-exec-capability', failureClass:'systemic'}`（走既有 DesktopOpsError 映射臂，host-api.ts:253-256，零新增映射）。
  3. self-upgrade delegate：`desktopSelfUpgradeViaTarball` 桩被调、payload 形态同 desktop 臂（:449-456）。
  4. upgrade/uninstall delegate 同式（upgrade 走 :755 desktop 臂形态）。
  先红。`tests/host-api-profile.test.mjs`（setupTrust helper）加 refuse 信封断言一条（DesktopOpsError 新码 → systemic 白名单外落点）。
- **实现**：`d` bag（:315-340）增 `routeWebMutation: ctx.deps?.routeWebMutation ?? routeWebMutation`；`ctx.deps` 类型（:67-110）增字段；四站点同 Task 5 形态（**gate 仅 web 分支**，desktopArm 提取复用；assertWriteAllowed 现位不动——upgrade/uninstall 在分派前 host-api.ts:752/:723、self-upgrade 在 case 顶 :424，均不随臂提取）：web 臂首行锚 install :709 / uninstall :729 / upgrade :774 / self-upgrade :461，kind 分派点锚 :685 / :725 / :754 / :429（符号锚优先，行号为 2026-11-10 时点）；self-upgrade 的 desktop 臂含其完整 deps 列表（:430-443），原样复用。
- **验收**：host-api 三个套件全绿；dispatcher 消费者 `doctor-api.test.mjs`（仅 doctor 方法，不触 gate）与 CLI 面 `cli-custom-profile.test.mjs`（scope out 不加门）不受影响——实现时跑绿自证（评审 m8 修订：后者非 dispatcher 消费者）。
- **零变化格**：desktop profile 响应信封逐字节不变（既有 desktop 用例自证）；web+spawnRouteStub = 现行为（既有 web 用例自证）。

### Task 7: GLOSSARY 三术语 + CHANGELOG 0.12.13

- **GLOSSARY**（Language 节，术语: 定义 + _Avoid_，无实现细节）：
  - **载体入口（carrier entry）**：宿主以官方桌面载体包（`@deepseek-ai/dsh-desktop-host` 的 `lib/cli.js`）启动时 `process.argv[1]` 的形态；与 launcher bin（`bin.js`/`bin.ts`/无扩展名 `dsh` shim）并列的合法 launch 身份，重启与插件命令共用同一识别。_Avoid_: 桌面入口（与 profile kind 的 desktop 混淆）、cli.js 泛指（只认官方 scoped 包，防 PATH 遮蔽）。
  - **launch 溯源（launch provenance）**：spawn 级失败错误信息里携带的一行现场事实（识别来源 entry/carrier/path-fallback、原始 argv[1]、选定执行文件）；答案面，不是诊断模式开关。
  - **执行能力门（exec capability gate）**：web 写操作进事务前的路径判定——spawn 可用则照旧，spawn 已知不可用才委派官方管理器或结构化拒绝；判据是纯文件系统事实，不做真实进程探测。_Avoid_: 能力降级（不改变任何已可用路径）、manager 优先路由（gate 只作用于残局）。
- **CHANGELOG**：0.12.13 条目（双语，格式随现文件；实现时先读头部对齐），内容：载体入口识别（#65 根因，上游对齐 #975/#1146）、执行能力门与 `no-exec-capability` 新码、chip 同链、零漂移声明、兼容性说明（正常宿主零变化；新错误码随 DesktopOpsError 信封透出）。
- **验收**：`node scripts/…` 无专门门；`npm test` 全量绿（client-i18n 不涉，无 client 改动）。

### Task 8: 最终验证（门禁三连 + 基线判别）

1. `npm run typecheck`（pipefail 原退出码）。
2. `npm test` 全量 → 对照 Step 0 基线：**新增用例全绿；既有仅 F1-R/C 允许红**（按名判别；若 F1-R/C 转绿记 2229 pass）；失败即停、逐条归因。
3. `node scripts/test-baseline.mjs` 不需跑（工作树即基线对照物；如需 stash 对照才用）。
4. `git diff --stat` 逐文件归因核对（计划外 = 0）。

### Task 9（发版与公开动作，**等待主人当轮批准后才执行**）

1. `npm run release`（bump 0.12.13、lock 三处同步、push/tag/publish——脚本前置与门禁 `npm run check-release`）。
2. CI 绿 + npm 上架轮询后，issue #65 回帖（草案先送审）：根因说明（载体分支缺失，上游 #975 对照）、修复版本、复测指引（溯源行说明：若仍失败请附错误里的 `[dsh-m launch: …]` 行）。
3. 主人批准后关 issue。

## 任务间接口契约汇总

```ts
// dsh-cli.ts
type DshLaunchSource = 'entry' | 'carrier' | 'path-fallback'
interface DshLaunch { file: string; args: string[]; cwd: string | undefined; viaShell: boolean; source: DshLaunchSource; entry: string | undefined }
resolveDshLaunch(input?: DshArgvInput): DshLaunch      // dshArgv = 四字段显式投影
// exec-route.ts
type WebMutationOp = 'install' | 'upgrade' | 'uninstall' | 'self-upgrade'
type WebMutationRoute = { route: 'spawn' } | { route: 'delegate'; manager: DesktopManagerLike } | { route: 'refuse'; error: DesktopOpsError }
routeWebMutation({ getService?, ensureService?, op, launch?, probe? }): Promise<WebMutationRoute>
probePathDshUsable({ pathEnv?, platform?, exists?, accessX? }): boolean
// profile-ops.ts
DesktopOpsErrorCode 加 'no-exec-capability'；resolveManager 加 export
```

**注入缝迁移表（hermetic 纪律，评审 B1 + 复审 R2 修订后六落点）**：`routeWebMutation` 生产缺省=真实现；测试缺省=恒 spawn 桩 `routeWebMutation: async () => ({ route: 'spawn' })`，落点六处——
1. `tests/tools-install.test.mjs:13 registerWith`（:37/:52/:76 三个 dshm_install/upgrade 守卫用例经此构造，fallback web kind 会走真 gate——复审 R2 补）；
2. `tests/tools-install.test.mjs:95 registerWithProfile`（其余 10 个 it() 经此构造）；
3. `tests/host-api.test.mjs:79 setup`；
4. `tests/host-api.test.mjs:799 setupToggle`（自带独立 dispatcher :802；其 :868/:886 用例经 install 方法真实执行 web install，必须覆盖）；
5. `tests/host-api-profile.test.mjs:58 setupTrust`；
6. `tests/host-api-external.test.mjs:56 setup`（实测零 gate 触达、PATH 剥离绿——按执行纪律回写豁免注记，非静默偏离，评审 M1）。

`doctor-api.test.mjs` 为 dispatcher 消费者但仅 doctor 方法（不触 gate）；`cli-custom-profile.test.mjs` 为 CLI 面（scope out）——实现时各跑绿自证。

## 执行纪律

- 红先：每任务测试先行且**亲见红**（基线对表：退役锚 HEAD>0、新增锚 HEAD=0）。
- 单套件验证前 `npm run build`（lib/ 产物约定）；全量门 `npm test` 自带 pretest。
- 退出码卫生：所有过滤管道 `set -o pipefail`；门禁恒稳形态（`! grep -q` / `test "$(…)" = 0`）。
- 实施发现与计划冲突 → 停下修计划再动手，不做计划外静默改动。
- 每任务完成后勾进度；Task 8 全绿前不开 Task 9。

## 最终验证

- `npm run typecheck` 绿（原退出码）。
- `npm test` 全量：新增 ~30 用例全绿，既有对照基线（仅 F1-R/C 名单内允许红）。
- Task 5/6 的「关键源码接线锚单点变异」：对 `decideWebMutationRoute` 的 path-fallback 判定与 tools 站点 `route.route === 'delegate'` 分支各做一次隔离副本变异（条件改坏）确认锚红、恢复后绿，输出落盘 `.dsh-research/issue65-dshmarket-compare/mutation-proof.md`。
- ADR-0034 Consequences 逐条核对（GLOSSARY 三术语在库、CHANGELOG 双语条目、scope out 三条未夹带改动）。
