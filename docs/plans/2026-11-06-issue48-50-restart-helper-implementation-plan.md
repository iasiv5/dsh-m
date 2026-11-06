# issue #48/#50「Windows 自重启 helper」实施计划（windowsHide 一行修复 + PID 判定 helper 时序重写）

## 目标

- **#48（闪窗）**：`restartHelperSource()` 生成的 helper 源码中，内层 spawn（`src/core/restart.ts` ≈:251）加 `windowsHide: true`——helper 自身 detached 无控制台，控制台子系统子进程不设此 flag 时 Windows 会新分配可见窗口。修法 = 报告者对照实验的单参数结论：**只改内层这一处**（外层 helper spawn 是 `detached: true`，不分配控制台，无需改动）。
- **#50-A（重复实例）**：helper 以 **PID 存活判定**（`process.kill(pid, 0)`）等旧进程退出（上限 5s，实测 449ms 的 10 倍余量），取代 30s 端口轮询；旧进程退出后端口仍被占（= 外部进程占用）时**放弃启动**，`note()` 写明 `restart failed: port N still held by another process ...; replacement NOT started`，彻底删除 `starting anyway` 路径。
- **#50-B（20s 恒误报）**：替代进程就绪判定改为 **child `exit` 句柄 + 端口探测双条件**，上限 180s（报告者 43 对日志实测冷启动 38–73s），删除 20s 判据；child 早退 / spawn error 即刻记失败，不空转。
- **#50-C（30s 白等）**：并入 PID 退出等待（5s），30s 端口等待循环删除。
- **null-port 路径治理（grill R2-Q2）**：`dshm_restart` 工具（`src/tools.ts` ≈:529 `restart(null)`）与 CLI（`src/cli.ts` ≈:468 `scheduleRestart(null)`）两条主生产路径现状盲睡 1500/3000ms——统一纳入同一时序：等旧进程退出 → 拒绝规则同上 → spawn → 无端口可探，仅监测 child 秒退（宽限 10s），成功/失败都留 note。
- **note 协议（grill R2-Q3）**：helper 日志补成功行（`replacement bound port N after X.Xs` / null 路径 `replacement still running after 10s ...`），失败行统一 `restart failed:` 前缀；`[dsh-m]` 包裹前缀与 `%TEMP%/dshm-restart-*.{out,err}.log` 通道不变。
- **测试盲区收口**（两 issue 共同根因）：helper 源码从「零覆盖」变为 vm 沙箱真跑 + spawn options 纯函数断言 + 源锚三件套；`if (port)` 两段现状从未执行的分支获得行为级测试。

**明确不做**（grill 两轮裁决，2026-11-06，Q1–Q6 / R2-Q1–Q4 全按推荐）：

- 重启结果回传 UI/文件通道（#50 独立问题段）——阶段二另开 issue 追踪（正文引用 #50），届时配 ADR；本役 `RestartResult` 形状零变化。
- `dsh-cli.ts` ≈:522 / `dsh-version.ts` ≈:68 同族 spawn 点——宿主拉起、stdio 全 pipe、Windows 上本就非 detached，未复现不修（Q1）；CHANGELOG 注明「已知同族点」。
- 外层 helper spawn options 与 `respawnInvocation()`（`-WindowStyle Hidden` 保留，冗余双保险零成本）。
- PID 复用防御（对比进程启动时间等）——5s 窗口内复用风险接受（R1-Q3）。
- ADR：本役不写（grill R1-Q5——bug fix 决策记录落本计划与 CHANGELOG；结果回传阶段二立项时再配）。
- `scheduleRestart` 返回值形状、`servingPort`、app-exit/systemd 两分支代码、宿主侧 500ms `SIGTERM` 击杀逻辑——全部零改动。

## 架构快照

- 三层结构（`src/core/restart.ts`）：宿主 `scheduleRestart(port)` → detached helper（`spawn(nodeExecutable(), ['-e', helper源码], { detached: true })`）+ 宿主侧 500ms 后 `kill(pid, 'SIGTERM')`（Windows 上 = `TerminateProcess` 无条件终止，Node 文档明确）→ helper 等待后 spawn 替代进程（经 `respawnInvocation()`：Windows 走 `powershell.exe -WindowStyle Hidden`，其余平台 detached node）。
- 三条生产路径的端口面：面板 `host-api.ts` ≈:798 `servingPort(req)`（唯一带端口）；`dshm_restart` 工具与 CLI 恒 null（见上）。helper 源码**跨平台共用**（Linux 无 systemd/appExit 也走 helper），`windowsHide` 非 Windows 为 no-op。
- 缺陷单点：`listening()` 探的是端口不是进程——分不清「我刚杀的进程」与「别人家的 dsh」，一个选择同时造成 #50 三缺陷；而 null-port 分支连端口都不探，纯盲睡。helper 源码内逻辑此前零测试（普查见断言面节）。
- 修复形态：#48 = flags 纯函数（`replacementSpawnFlags()`）内插模板；#50 = 模板 `main()` 重写为「**等旧进程死（PID）→ 两则拒绝（旧进程未死 / 端口被外部占用）→ spawn → 就绪双判据（child exit + 端口）或 null-port 宽限监测**」，常量宿主侧内插（单一来源）；测试 = `node:vm` 注入 stub 真跑 helper 源码，虚拟时钟确定性地覆盖全部时序分支。

## 全局约束

- 依赖预检：任何 build/test/typecheck 前 `test -d node_modules`（缺失按 workspace AGENTS.md「仓内构建与依赖恢复」恢复）。
- `src/core/*.ts` 的测试从 `lib/core/*.js`（构建产物）引入；单套件跑之前先 `npm run build`，否则测到旧产物。
- 源串锚禁含 `\n`（CRLF 检出）；本役全部锚为单行 needle；量化断言一律出现次数语义（`src.split(needle).length - 1`），禁 `grep -c`。
- 测试输出过过滤管道时保留原进程退出码（bash `set -o pipefail`）；门禁用恒稳形态（`! grep -q` / 计数入输出值）。
- 注入型测试夹具形态镜像生产调用面：vm 沙箱 stub 逐个对照 helper 源码 require 面与全局面（`node:child_process.spawn` / `node:fs.appendFileSync+openSync` / `node:net.connect` / `process.kill+env` / `setTimeout` / `Date.now`），不注多余 stub。
- **双机执行环境**：代码改动与测试在 web 机（Linux bash）执行；Windows 实机验收为主人可选手动步骤（Task 4，PowerShell 单步形态、退出码读 `$LASTEXITCODE`、不用 `&&` 链）。
- 基线：web 机 2026-11-06 `npm test` **2087/2087 全绿（exit 0，本役开工前实测）**；最终全量以此对照，出现基线外红例停下排查，不猜。
- 无新增依赖、无新增配置面；CHANGELOG 与版本 bump 随发版批次另行批准（本役任务清单不含）。
- 无额外全局约束项（平台要求/版本下限：helper 路径行为以 Node ≥18 的 `node:vm` 为测试面，无版本下限变更）。

## 输入工件

- issue #48：https://github.com/iasiv5/dsh-m/issues/48（appllove；闪窗根因 + WinEvent 探针复现法 + 对照实验表 + 「顺带同族 spawn 点」清单——修法与「只改一处」结论采纳）
- issue #50：https://github.com/iasiv5/dsh-m/issues/50（appllove；43 对 `%TEMP%` 日志统计 29/43 恒误报、绑定耗时 38–73s、端口释放实测 449ms——三缺陷定性与超时预算数据采纳；其「pid 变量就在闭包里」一句与代码现状不符，已修正为「需先注入 pid」）
- PR #49：https://github.com/iasiv5/dsh-m/pull/49（作者 AlirezaAghaee1996，OpenSourcePilot 自主流程生成——评审 R1-Q7 署名校正；windowsHide 方向与本役一致，实现删除整个模块已关闭，回帖留证：#issuecomment-6675339378）
- 设计共识：grill 两轮 10 项决策（2026-11-06 会话记录，Q1–Q6 + R2-Q1–Q4 全按推荐）
- 先例：#46/#47 计划格式（`docs/plans/2026-11-05-issue46-47-link-path-implementation-plan.md`）；dsh-m/AGENTS.md「发版动作需当轮明确批准」

## 文件结构与职责

- Modify: `src/core/restart.ts` —— 唯一行为改动文件：①新增三个时序常量 + `replacementSpawnFlags()` 导出；②`restartHelperSource()` 改 export、签名加 `pid` 形参、模板 `main()` 重写（等退出/拒绝/双判据/note 协议/flags 内插）；③`scheduleRestart()` detached-helper 分支调用处补传 `pid` 实参（一行）
- Modify: `tests/restart.test.mjs` —— import 块补新导出；新增三个 describe：flags/源锚（Task 1）、vm 沙箱主流程 9 例（Task 2）、scheduleRestart 接线钉（Task 3）；既有 6 例零改动
- 只读核对面（零改动）：`src/core/tools.ts`（restart 工具文案）、`src/core/host-api.ts`（restart 端点）、`src/host.ts`（restart 包装）、`src/cli.ts`、`src/client/i18n.js`（`restart.*` 文案）、`src/core/dsh-cli.ts`、`src/core/dsh-version.ts`、`tests/host-api.test.mjs` / `tests/host-api-profile.test.mjs`（scheduleRestart 注入桩断言面）

关键现场锚（时点 2026-11-06，符号优先，行号为 web 机工作树参考）：

| 锚 | 位置 |
|---|---|
| `restartHelperSource`（私有 def，模板 `return [...]` 起点） | `src/core/restart.ts` ≈:211-265 |
| helper 模板内层 spawn 行（`child = spawn(file, args, { cwd, detached, ...`） | 同文件 ≈:251 |
| helper 模板 20s 判据行（`const upBy = Date.now() + 20000`） | 同文件 ≈:258-261 |
| helper 模板 30s 端口等待行（`const until = Date.now() + 30000`） | 同文件 ≈:240-246 |
| `scheduleRestart` def（`const pid = deps.pid ?? process.pid` 在 ≈:269） | 同文件 ≈:267-347 |
| detached helper spawn 调用（`helper = (deps.spawn ?? spawn)(`，`restartHelperSource(spawned, launch, { out: logOut, err: logErr }, port)` 实参处） | 同文件 ≈:323-333 |
| `respawnInvocation`（powershell `-WindowStyle Hidden`；本役不动） | 同文件 ≈:110-131 |
| systemd 分支 spawn（本役不动） | 同文件 ≈:296-320 |
| 测试 import 块 / `fakeTimer` 夹具 | `tests/restart.test.mjs` ≈:10-17 / ≈:19-29 |
| `RestartResult` deepEqual 钉例（形状零变化面） | 同文件 ≈:63 / ≈:113 |
| `restart(null)` 生产调用点（只读面） | `src/tools.ts` ≈:529；`src/cli.ts` ≈:468；`src/core/host-api.ts` ≈:798；`src/host.ts` ≈:64 |

## 行为零变化承诺（每特性必填格）

| 口径 | 承诺 |
|---|---|
| `scheduleRestart` 返回值 `RestartResult` 形状 | 零变化：`{ pid, helperPid, via }` 键集不变；`tests/restart.test.mjs` ≈:63/:113 两处 deepEqual 零改动全绿；host-api 两测试文件的注入桩断言面（calls 计数 + 桩返回值）零改动全绿；`tools.ts`/`i18n.js`/`cli.ts` 的「已请求重启（via …）」文案链零变化 |
| app-exit 分支（managed 宿主） | 零变化：代码段不动；既有钉例（timer 150ms/unref/exit code 断言）全绿 |
| systemd transient 分支 | 零变化：代码段不动；既有两例（systemd-run argv 形状断言）全绿 |
| `respawnInvocation` / `servingPort` / `readProcCgroup` / `systemd*` / `appExitFromContext` | 零变化（#48 报告者对照实验背书外层无需改；本役不验证不动的面） |
| 外层 helper spawn options（`detached: true, stdio: 'ignore'`） | 零变化（grill R1-Q1 严格一处裁决） |
| helper 日志通道 | `%TEMP%/dshm-restart-*.{out,err}.log` 路径与 `[dsh-m]` 包裹前缀不变；**声明变化面**：行内容新增 `restart failed:` 失败前缀与成功行，旧 `starting anyway` / `did not bind ... within 20s` 字样消失（tests/ 对旧字样锚零命中，普查见下节——无既有断言破坏） |
| **声明变化面（本役目的）** | ① Windows helper 内层 spawn 带 `windowsHide: true`（闪窗消除）；② 端口被外部占用 / 旧进程 5s 未退出时**不再强行启动**替代进程（从静默孤儿/`starting anyway` 变为明确失败 + 保留现场，安全可重试）；占用判定为 **2s 有界重探**（首探 held 后每 250ms 重探，窗内释放即放行——覆盖实测 449ms 释放窗，评审 R1-Q4；成功路径不再有无条件 300ms sleep）；③ 就绪判定 20s 端口判据 → child exit + 端口双判据 180s（67% 假失败消除）；④ null-port 路径盲睡 1500/3000ms → PID 退出等待 + child 秒退监测 10s；⑤ helper 常驻上限从 ~53s（30+20+3）变为最长 ~186s（5+180+1，detached+unref 无宿主影响） |
| Linux detached-helper 路径（无 systemd/appExit 宿主） | 时序随 ②③④ 变化（声明面），外部契约不变：仍为「杀旧 → 起替代」；`windowsHide` 为 no-op；`process.kill(pid, 0)` 跨平台可用 |
| golden / market / client 面 | 零接触（restart 不入 golden fixture；client restart 文案键不动） |

## 断言面普查（web 机现场核证 2026-11-06，执行时复核）

- **A restart.js 的测试 import 面**：`grep -rn "core/restart" tests/` 恰 1 处——`tests/restart.test.mjs:17`。无其他套件引 restart 导出 → 新增导出零破坏面、无迁移动作。
- **B helper 源串/关键字锚**：`restartHelperSource` / `windowsHide` / `starting anyway` / `did not bind` / `listening` 在 tests/ **全部零命中**（唯一命中为 `tests/fixtures/search-normalize-corpus.json:233` 无关语料行）→ helper 内部零既有覆盖、旧日志字样无断言钉住，模板重写不炸任何既有用例。
- **C `RestartResult` 形状断言面**：`tests/restart.test.mjs` ≈:63/:113 两处 `deepEqual(result, { pid, helperPid, via })`；`tests/host-api.test.mjs` ≈:246-248 与 `tests/host-api-profile.test.mjs` ≈:60/:98-100 的注入桩（桩返回 `{ pid: 1, helperPid: undefined, via: 'app-exit' }` + calls 计数断言 ≈:168/:185/:249/:388）。本役返回形状零变化 → 全部兼容。
- **D 全对象 deepEqual / 键集合断言**：restart 面无其他 `deepEqual`/`Object.keys` 断言（普查零命中）→ 无形状联动。
- **E 既有 6 例全部不触 helper 分支**：`scheduleRestart` 三例全部 `scheduleRestart(null, {...})` 且走 app-exit/systemd（cgroup 夹具含 `.service`）；`restart.test.mjs` 中 "port" 3 次命中均为 `import` 单词子串（假阳性）——`if (port)` 分支现状零执行、零断言，Task 2 的红形态不受既有用例干扰。

## 任务间验收映射（计划追溯）

| 需求（issue 断言 / grill 决议） | 落点 |
|---|---|
| #48：内层 spawn 闪窗 → `windowsHide: true` 单点修复 | Task 1（flags 纯函数 + 模板内插 + 锚变异自证） |
| #50-A：端口被外部占用仍启动 → 拒绝 + 显式失败 | Task 2（vm 例 ③③b，2s 有界重探——评审 R1-Q4）+ Task 3 接线钉 |
| #50-A'：旧进程 5s 未退出 → 拒绝（grill R2-Q1 fail-closed） | Task 2（vm 例 ②） |
| #50-B：20s 恒误报 → child exit + 端口双判据 180s | Task 2（vm 例 ①⑥⑦⑧） |
| #50-C：30s 白等 → PID 退出等待 5s | Task 2（vm 例 ①② 时序面） |
| null-port 三路径统一（grill R2-Q2） | Task 2（vm 例 ④⑤⑨）+ Task 3 接线钉 |
| note 协议：成功行 + `restart failed:` 前缀（grill R2-Q3） | Task 2（vm 例 ①④⑤⑧⑨ 断言面） |
| pid 注入（#50 修法前提，评审修正项） | Task 2（可选形参 + 模板 `const pid` 行）+ Task 3（scheduleRestart 实参 + 签名收紧必填 + 接线钉） |
| `RestartResult`/文案链零变化（grill R1-Q6 前提） | Task 3 既有 6 例回归 + Task 4 全量 |
| 结果回传 UI 不入本役（grill R1-Q6） | 计划外：发版后另开 issue（执行纪律尾注） |
| 评审计划外建议三条（主人指令纳入，2026-11-06）：①成功行秒值 toFixed(1) 恒一位小数（+例①格式钉）；②alive 只认 ESRCH 判死（+vm 例 ⑫ 与 harness eperm 注入）；③变异副本用后即删 | Task 2（成功行模板块 + 例 ① 格式钉 / 例 ⑫ + harness）/ 执行纪律清理条款 |
| 发版 0.12.7 + 关 #48/#50（grill R1-Q5/Q6） | 计划外停点：当轮另行批准（执行纪律） |

---

### Task 1: windowsHide 单点修复（#48）——flags 纯函数 + 模板内插

- 目标：两条失败测试先红（今日实现：无导出、模板无 windowsHide），单点修复后全绿。
- 涉及文件：Modify `tests/restart.test.mjs`、Modify `src/core/restart.ts`
- 接口契约
  - Consumes：无新依赖（`node:vm` 等仅 Task 2 引入；本任务只动 import 块的具名导出清单）
  - Produces（Task 2/3 消费）：`export function replacementSpawnFlags(): Record<string, boolean>`（恒返回 `{ windowsHide: true }`）；`restartHelperSource` 加 `export` 关键字（**签名本任务不变**，仍 4 形参）
- 验证范围：flags 返回值 deepEqual；helper 源码 `windowsHide` 字面量出现次数 = 1；关键锚变异自证

- [ ] Step 0: 断言面普查复核（上节 A/B/E 为 2026-11-06 现场证据；执行时复核——`grep -rn "core/restart" tests/` 仍恰 1 处、helper 关键字 tests/ 仍零命中）
- [ ] Step 1: 写失败测试。`tests/restart.test.mjs` import 块（≈:10-17）补 `restartHelperSource` 与 `replacementSpawnFlags` 两个具名导入；文件末尾追加：

  ```js
  describe('helper spawn flags 与 windowsHide 源锚（issue #48）', () => {
    const base = { file: 'node.exe', args: ['-NoProfile', '-Command', 'x'], viaShell: false, detached: false }
    it('replacementSpawnFlags 恒返回 { windowsHide: true }', () => {
      assert.deepEqual(replacementSpawnFlags(), { windowsHide: true })
    })
    it('helper 源码内插 flags——windowsHide 字面量恰 1 处（出现次数语义）', () => {
      const src = restartHelperSource(base, { cwd: '/c' }, { out: '/o', err: '/e' }, 3081)
      assert.equal(src.split('"windowsHide":true').length - 1, 1)
    })
  })
  ```

- Run: `npm run build` → `node --test tests/restart.test.mjs`（两条分开跑，各自记退出码）
- Expected: **红，且红形态恰好为**——文件加载即红：`SyntaxError: The requested module '...restart.js' does not provide an export named 'replacementSpawnFlags'`（具名导出不存在，链接期失败，全文件用例报错）。若出现其他红，停下排查，不猜。
- [ ] Step 2: 确认失败形态吻合（进程退出码非 0 + SyntaxError 文本）
- [ ] Step 3: 最小实现 `src/core/restart.ts`，三处（顺序即 diff 顺序）：
  1. `restartHelperSource` 函数头加 `export`（签名不变，仍 4 形参）；模板行区在 `const port = ...` 行之后**追加一行**声明（与相邻行同形态、无尾逗号）：

     ```ts
     `const flags = ${JSON.stringify(replacementSpawnFlags())}`,
     ```

     内插后 helper 源码获得 `const flags = {"windowsHide":true}` 一行；
  2. 内层 spawn 行（≈:251）替换为（行尾追加 `...flags` 展开）：

     ```ts
     '    child = spawn(file, args, { cwd, detached, stdio: ["ignore", out, err], env: process.env, shell: viaShell, ...flags })',
     ```

  3. `restartHelperSource` 函数之后（与 `scheduleRestart` 之间）新增导出：

     ```ts
     /**
      * #48：helper 内层 spawn 必须带 windowsHide —— helper 自身 detached 无控制台，
      * 不设此 flag 时 Windows 会为控制台子系统子进程新分配可见窗口（闪窗）；非 Windows 为 no-op。
      */
     export function replacementSpawnFlags(): Record<string, boolean> {
       return { windowsHide: true }
     }
     ```
- [ ] Step 4: 复跑同两条命令 → 全绿（既有 6 例 + 新 2 例；本套件现状 6 例全不触 helper 分支，无联动）
- [ ] Step 5: **关键锚变异自证**（该源锚是 #48 修复的唯一自动防线；按 CODING-STANDARDS:57「隔离副本」执行，评审 R1-Q5）：`cp -a` 仓库到 `/home/ubuntu/workspace/.dsh-research/issue4850-mutation-check/`（含 node_modules）→ 在**副本**把内层 spawn 行的 `, ...flags` 删掉 → 副本内 `npm run build` → `node --test tests/restart.test.mjs` 确认恰 windowsHide 锚例红（`split('"windowsHide":true').length - 1` 计 0）→ 副本内恢复 → 复跑绿。变异与恢复的命令输出落盘留存；真实工作树全程零改动。
- [ ] Step 6: checkpoint commit（可选，自然边界；commit message 列改动点与本步变异自证结论）

### Task 2: helper 主流程重写（#50）——时序常量 + 模板 main() 重写 + vm 沙箱套件

- 目标：12 条行为测试先红（今日模板：无 pid 注入、无拒绝路径、无成功行、无常量锚、旧字样在场、不消费 alive stub），模板重写后全绿。
- 涉及文件：Modify `tests/restart.test.mjs`、Modify `src/core/restart.ts`
- 接口契约
  - Consumes：Task 1 的 `restartHelperSource`（export）与 `replacementSpawnFlags()`
  - Produces（Task 3 消费）：`restartHelperSource` 签名扩为 `(spawned, launch, logs, port, pid?)`——第 5 形参**可选** `pid?: number`（评审 R1-Q2：本任务即设必填会让 `npm run build` 的 tsc 门（scripts/build.mjs:23，execFileSync 传播非零退出）对仍传 4 参的调用点报 TS2554，build 红门横跨 Task 2→3；可选形参使 build 门全程绿。缺省时模板行内插 `const pid = undefined`——合法 JS，`alive(undefined)` 恒 false，与今日无 pid 感知等价；Task 3 接线时收紧为必填。模板含 `const pid = ${JSON.stringify(pid)}` 行）；导出常量 `OLD_EXIT_TIMEOUT_MS = 5_000`、`REPLACEMENT_UP_TIMEOUT_MS = 180_000`、`NULL_PORT_GRACE_MS = 10_000`、`PORT_HELD_GRACE_MS = 2_000`（评审 R1-Q4：端口占用判定的有界重探窗，≈实测 449ms 释放延迟的 4.5 倍；数值供模板内插与断言引用）
- 验证范围：vm 沙箱真跑 helper `main()`，虚拟时钟覆盖：成功绑定（含秒值恒一位小数格式钉）/ 旧进程拒启 / 占口拒启 / 占用窗内释放放行（例 ③b，评审 R1-Q4）/ null-port 两种收尾 / 早退 / 超时 / spawn error / 同步 throw / EPERM 视同存活（例 ⑫，评审计划外建议②硬化）/ 时序常量与 pid 内插同源锚 + 删除面负向锚（例 ⑩，评审 R1-Q6）

- [ ] Step 1: 写失败测试。`tests/restart.test.mjs` 顶部加 `import vm from 'node:vm'`；文件末尾追加（夹具与 harness 一并落入，测试自带全部依赖、不跨 describe 引用）。**本步不含例 ⑩ 与四常量具名导入**——具名导入在导出缺失时会模块链接期 SyntaxError、淹没行为红形态（执行注记，主人批准的实施修正）：⑩ 移至 Step 5 绿侧补入，其红形态（内插锚今日计 0 / 负向锚今日计 1）已由评审 probe1b/1c 独立实证：

  ```js
  describe('restart helper 主流程（vm 沙箱真跑，issue #50）', () => {
    const base = { file: 'node.exe', args: ['-NoProfile', '-Command', 'x'], viaShell: false, detached: false }
    const logs = { out: '/tmp/out.log', err: '/tmp/err.log' }
    const src5 = (port, pid = 4242) => restartHelperSource(base, { cwd: '/c' }, logs, port, pid)

    /** helper 源码沙箱：stub 逐个对照 helper 内 require 面与全局面（node:child_process/fs/net、
     *  process.kill+env、setTimeout、Date.now），虚拟时钟由 pump 推进，时序确定、零真 sleep。 */
    function runHelper(src, { alive = () => false, probes = [], spawnThrows = null, eperm = false } = {}) {
      const notes = []
      const spawnCalls = []
      let clock = 0
      let probeIndex = 0
      let aliveIndex = 0
      let exitHandler = null
      let errorHandler = null
      let doneFlag = false
      const timers = []
      const child = {
        on(event, cb) {
          if (event === 'exit') exitHandler = cb
          if (event === 'error') errorHandler = cb
        },
        unref() {},
      }
      const sandbox = {
        require(spec) {
          if (spec === 'node:child_process') {
            return { spawn: (file, args, o) => { spawnCalls.push({ file, args, o }); if (spawnThrows) throw spawnThrows; return child } }
          }
          if (spec === 'node:fs') {
            return { appendFileSync: (f, line) => notes.push(line), openSync: () => 7 }
          }
          if (spec === 'node:net') {
            return {
              connect: () => {
                const outcome = probes.length === 0 ? 'error' : probes[Math.min(probeIndex, probes.length - 1)]
                probeIndex += 1
                const cbs = {}
                const socket = { destroy() {}, on(event, cb) { cbs[event] = cb; return socket } }
                queueMicrotask(() => { const cb = outcome === 'connect' ? cbs.connect : cbs.error; if (cb) cb() })
                return socket
              },
            }
          }
          throw new Error(`unexpected require in helper harness: ${spec}`)
        },
        process: {
          env: {},
          kill(p) {
            const isAlive = alive(aliveIndex)
            aliveIndex += 1
            if (isAlive && eperm) { const e = new Error(`kill EPERM ${p}`); e.code = 'EPERM'; throw e }
            if (!isAlive) { const e = new Error(`kill ESRCH ${p}`); e.code = 'ESRCH'; throw e }
          },
        },
        Date: { now: () => clock },
        setTimeout(fn, ms) { timers.push({ at: clock + ms, fn }); return timers.length },
        __finish() { doneFlag = true },
      }
      const context = vm.createContext(sandbox)
      const body = src.replace(/\nmain\(\)\s*$/u, '')
      vm.runInContext(`${body}\n;main().then(() => __finish(), () => __finish())`, context, { timeout: 5000 })
      return {
        notes,
        spawnCalls,
        emitExit(code, signal) { if (exitHandler) exitHandler(code, signal) },
        emitError(error) { if (errorHandler) errorHandler(error) },
        async pump(steps) {
          for (let i = 0; i < steps && timers.length > 0; i += 1) {
            timers.sort((a, b) => a.at - b.at)
            const next = timers.shift()
            clock = next.at
            next.fn()
            await new Promise((r) => setImmediate(r))
          }
        },
        async pumpUntilDone(maxSteps = 5000) {
          for (let i = 0; i < maxSteps && !doneFlag; i += 1) {
            if (timers.length === 0) break
            await this.pump(1)
          }
        },
      }
    }

    it('① 旧进程退出+端口空闲 → 绑定成功记成功行，spawn 带 windowsHide，无失败行', async () => {
      let polls = 3 // alive 三轮后退出（SIGTERM 在 helper 启动后 ~500ms 才落地）
      const h = runHelper(src5(3081), { alive: () => polls-- > 0, probes: ['error', 'error', 'error', 'connect'] })
      await h.pumpUntilDone()
      assert.equal(h.spawnCalls.length, 1)
      assert.equal(h.spawnCalls[0].o.windowsHide, true)
      assert.ok(h.notes.some((n) => n.includes('replacement bound port 3081 after')), h.notes.join(' | '))
      const okLine = h.notes.find((n) => n.includes('replacement bound port 3081 after'))
      assert.ok(okLine && /after \d+\.\ds/u.test(okLine), `成功行秒值恒一位小数: ${okLine}`)
      assert.ok(!h.notes.some((n) => n.includes('restart failed')), h.notes.join(' | '))
    })
    it('② 旧进程 5s 未退出 → 拒绝启动（fail-closed），无 spawn', async () => {
      const h = runHelper(src5(3081), { alive: () => true })
      await h.pumpUntilDone()
      assert.equal(h.spawnCalls.length, 0)
      const line = h.notes.find((n) => n.includes('still alive after 5s'))
      assert.ok(line && line.includes('replacement NOT started'), h.notes.join(' | '))
    })
    it('③ 旧进程退出但端口仍被外部占用 → 拒绝启动，无 spawn', async () => {
      const h = runHelper(src5(3081), { alive: () => false, probes: ['connect'] })
      await h.pumpUntilDone()
      assert.equal(h.spawnCalls.length, 0)
      const line = h.notes.find((n) => n.includes('port 3081 still held by another process'))
      assert.ok(line && line.includes('replacement NOT started'), h.notes.join(' | '))
    })
    it('③b 首探 held → 2s 窗内端口释放 → 放行启动（评审 R1-Q4 补分支）', async () => {
      const h = runHelper(src5(3081), { alive: () => false, probes: ['connect', 'error', 'error', 'connect'] })
      await h.pumpUntilDone()
      assert.equal(h.spawnCalls.length, 1)
      assert.ok(h.notes.some((n) => n.includes('replacement bound port 3081 after')), h.notes.join(' | '))
      assert.ok(!h.notes.some((n) => n.includes('restart failed')), h.notes.join(' | '))
    })
    it('④ port=null + child 10s 未退 → 记 still running 成功行（dshm_restart/CLI 路径）', async () => {
      const h = runHelper(src5(null))
      await h.pumpUntilDone()
      assert.equal(h.spawnCalls.length, 1)
      assert.ok(h.notes.some((n) => n.includes('replacement still running after 10s')), h.notes.join(' | '))
      assert.ok(!h.notes.some((n) => n.includes('restart failed')), h.notes.join(' | '))
    })
    it('⑤ port=null + child 秒退 → 记 exited early 失败行', async () => {
      const h = runHelper(src5(null))
      await h.pump(2) // main 同步完成 spawn 并已进入宽限循环；推进两拍后在循环中触发 exit
      h.emitExit(1, null)
      await h.pumpUntilDone()
      assert.ok(h.notes.some((n) => n.includes('replacement exited early') && n.includes('code 1')), h.notes.join(' | '))
    })
    it('⑥ 带端口路径 child 绑定前退出 → 记 exited before binding 失败行', async () => {
      const h = runHelper(src5(3081), { alive: () => false, probes: ['error'] })
      await h.pump(2) // 就绪循环进行中触发 exit（probes 耗尽后重复最后一项，'error' 恒不绑定）
      h.emitExit(null, 'SIGTERM')
      await h.pumpUntilDone()
      assert.ok(h.notes.some((n) => n.includes('replacement exited before binding port 3081') && n.includes('signal SIGTERM')), h.notes.join(' | '))
    })
    it('⑦ 带端口路径 180s 从未绑定且 child 未退 → 记 did not bind 超时失败行', async () => {
      const h = runHelper(src5(3081), { alive: () => false, probes: ['error'] })
      await h.pumpUntilDone()
      assert.ok(h.notes.some((n) => n.includes('did not bind port 3081 within 180s')), h.notes.join(' | '))
    })
    it('⑧ spawn error 事件 → 记 could not start 失败行，不空转 180s', async () => {
      const h = runHelper(src5(3081), { alive: () => false, probes: ['error'] })
      await h.pump(2) // 就绪循环进行中触发 error
      h.emitError(new Error('spawn ENOENT'))
      await h.pumpUntilDone() // spawnError 置位后主流程即刻 return——提前退出即「不空转」的体现
      assert.ok(h.notes.some((n) => n.includes('restart failed: could not start the replacement') && n.includes('spawn ENOENT')), h.notes.join(' | '))
    })
    it('⑨ spawn 同步 throw → catch 记 could not start，无后续等待', async () => {
      const h = runHelper(src5(3081), { alive: () => false, probes: ['error'], spawnThrows: new Error('boom') })
      await h.pumpUntilDone()
      assert.ok(h.notes.some((n) => n.includes('restart failed: could not start the replacement') && n.includes('boom')), h.notes.join(' | '))
    })
    it('⑫ 旧进程存在但 EPERM（进程在、信号被拒）→ 视同存活，5s 后拒绝启动（评审计划外建议②硬化）', async () => {
      const h = runHelper(src5(3081), { alive: () => true, eperm: true })
      await h.pumpUntilDone()
      assert.equal(h.spawnCalls.length, 0)
      const line = h.notes.find((n) => n.includes('still alive after 5s'))
      assert.ok(line && line.includes('replacement NOT started'), h.notes.join(' | '))
    })
  })
  ```

  （用例 ⑤⑥⑧ 的「spawn 后触发事件」分两段 pump：main 同步跑到第一个 await 时 spawn 已发生（同步段无 timer），`pump(2)` 推进两拍后 `emitExit`/`emitError` 在循环进行中调用——由实现顺序保证；若首段 pump 后 handler 仍为 null，即实现未 spawn，断言红，形态可判读。）

- Run: `npm run build` → `node --test tests/restart.test.mjs`
- Expected: **红，且红形态恰好为**——Task 1 后模板仍是旧 main()：①③④⑤⑥⑦ 红在 note 断言（今日模板无任何 `restart failed:` / 成功行）；③b 红在成功行断言（今日模板对该 probe 序列放行 spawn，`spawnCalls` 断言本身绿、成功行缺失）；② 红 在 `spawnCalls.length === 0`（今日模板端口等待后照常 spawn）且无拒绝行；⑧⑨ 红在 `restart failed: could not start the replacement` **前缀断言**（今日模板已有裸 `could not start the replacement` 行——`src/core/restart.ts` ≈:252/:255，评审 R1-Q3 基线实测：无前缀断言对这两例恒绿）；⑩ 红 在 `const pid = 4242` 与四个时序常量锚计 0、三个删除面负向锚计 1（`starting anyway` / `Date.now() + 20000` / `Date.now() + 30000` 今日在场——评审 R1-Q6）；⑫ 红 在 `spawnCalls.length === 0` 与 still-alive 拒绝行（今日模板不消费 alive stub、对 `alive: () => true + eperm` 照常 spawn）；既有 6 例 + Task 1 两例保持绿。红例 12、绿 8；列表外红停下排查（例 ⑩ 移 Step 5，其红形态由 probe1b/1c 背书）。
- [ ] Step 2: 确认失败形态逐一吻合（红确认纪律：退出码非 0 + 具体红例名）
- [ ] Step 3: 实现 `src/core/restart.ts`：
  1. `restartHelperSource` 函数 def（≈:211）上方新增导出常量（放在 Task 1 的 `replacementSpawnFlags` 附近，同区块）：

     ```ts
     /** 等旧进程退出上限：Windows 实测 TerminateProcess 后端口释放 449ms（issue #50 实测），5s 为 10 倍余量。 */
     export const OLD_EXIT_TIMEOUT_MS = 5_000
     /** 等替代进程绑定端口的就绪上限：冷启动实测 38–73s（issue #50 报告者 43 对日志）；20s 判据恒误报已删。 */
     export const REPLACEMENT_UP_TIMEOUT_MS = 180_000
     /** port=null（dshm_restart 工具 / CLI 路径）无端口可探，仅监测替代进程秒退的宽限窗口。 */
     export const NULL_PORT_GRACE_MS = 10_000
     /** 端口占用判定有界重探窗（评审 R1-Q4）：旧进程死后端口释放实测 449ms（issue #50 单样本，20ms 轮询），
      *  2s ≈ 4.5 倍。首探 held 后每 250ms 重探，窗内释放即放行；窗满仍 held 判外部占用，拒绝启动。 */
     export const PORT_HELD_GRACE_MS = 2_000
     ```

  2. `restartHelperSource` 签名改为 `(spawned, launch, logs, port, pid?)`（第 5 形参**可选** `pid?: number`，评审 R1-Q2——必填会使 `npm run build` 在 Task 2→3 之间横亘 TS2554 红门；Task 3 接线时收紧为必填）；模板行区改为（`const port = ...` 行后追加**五行**）：

     ```ts
     `const pid = ${JSON.stringify(pid)}`,
     `const oldExitTimeout = ${JSON.stringify(OLD_EXIT_TIMEOUT_MS)}`,
     `const upTimeout = ${JSON.stringify(REPLACEMENT_UP_TIMEOUT_MS)}`,
     `const nullPortGrace = ${JSON.stringify(NULL_PORT_GRACE_MS)}`,
     `const heldGrace = ${JSON.stringify(PORT_HELD_GRACE_MS)}`,
     ```

  3. `listening` 行之后追加 alive 行：

     ```ts
     'const alive = (p) => { try { process.kill(p, 0); return true } catch (e) { return e && e.code === "ESRCH" ? false : true } }',
     ```

  4. **整个 `const main = async () => { ... }` 模板块（从 `'const main = async () => {'` 到 `'}'`、`'main()'` 之前）替换为**：

     ```ts
     'const main = async () => {',
     '  const exitBy = Date.now() + oldExitTimeout',
     '  while (Date.now() < exitBy && alive(pid)) await sleep(100)',
     '  if (alive(pid)) {',
     '    note(`restart failed: old instance (pid ${pid}) still alive after ${oldExitTimeout / 1000}s; replacement NOT started — safe to retry`)',
     '    return',
     '  }',
     '  if (port) {',
     '    const heldBy = Date.now() + heldGrace',
     '    while (await listening()) {',
     '      if (Date.now() >= heldBy) {',
     '        note(`restart failed: port ${port} still held by another process after the old instance exited; replacement NOT started`)',
     '        return',
     '      }',
     '      await sleep(250)',
     '    }',
     '  }',
     "  let child",
     '  let spawnError = null',
     '  let exitInfo = null',
     '  try {',
     '    const out = fs.openSync(logOut, "a")',
     '    const err = fs.openSync(logErr, "a")',
     '    child = spawn(file, args, { cwd, detached, stdio: ["ignore", out, err], env: process.env, shell: viaShell, ...flags })',
     '  } catch (error) {',
     '    note(`restart failed: could not start the replacement: ${error && error.message ? error.message : error}`)',
     '    return',
     '  }',
     '  child.on("error", (error) => {',
     '    spawnError = error',
     '    note(`restart failed: could not start the replacement: ${error && error.message ? error.message : error}`)',
     '  })',
     '  child.on("exit", (code, signal) => { exitInfo = { code, signal } })',
     '  child.unref()',
     '  if (!port) {',
     '    const graceBy = Date.now() + nullPortGrace',
     '    while (Date.now() < graceBy && exitInfo === null && spawnError === null) await sleep(500)',
     '    if (spawnError !== null) return',
     '    if (exitInfo !== null) {',
     '      note(`restart failed: replacement exited early (code ${exitInfo.code === null ? "null" : exitInfo.code} signal ${exitInfo.signal === null ? "none" : exitInfo.signal}) — see the output log beside this one`)',
     '    } else {',
     '      note(`replacement still running after ${nullPortGrace / 1000}s (no port to probe; assuming started)`)',
     '    }',
     '    return',
     '  }',
     '  const startedAt = Date.now()',
     '  const upBy = Date.now() + upTimeout',
     '  let bound = false',
     '  while (Date.now() < upBy && exitInfo === null && spawnError === null && !bound) {',
     '    bound = await listening()',
     '    if (!bound) await sleep(500)',
     '  }',
     '  if (spawnError !== null) return',
     '  if (exitInfo !== null) {',
     '    note(`restart failed: replacement exited before binding port ${port} (code ${exitInfo.code === null ? "null" : exitInfo.code} signal ${exitInfo.signal === null ? "none" : exitInfo.signal})`)',
     '  } else if (bound) {',
     '    note(`replacement bound port ${port} after ${(Math.round((Date.now() - startedAt) / 100) / 10).toFixed(1)}s`)',
     '  } else {',
     '    note(`restart failed: replacement did not bind port ${port} within ${upTimeout / 1000}s — see the output log beside this one`)',
     '  }',
     '}',
     ```

     （注意 TS 侧引号形态：含 helper 运行期 `${...}` 的行一律写成 TS **单引号**串——`${}` 与反引号保持字面量直达 helper 运行时；TS 侧插值仅限 `${JSON.stringify(...)}` 行。`exitInfo.signal` 的假值分支用 `=== null` 判断（Node exit 事件 signal 为 null 时表正常退出），与 vm 例 ⑤⑥ 的 `signal none`/`signal SIGTERM` 断言对应。）
  5. `scheduleRestart` 的实参传递**不在本任务**（挪至 Task 3 作接线钉的 TDD 红起点；本任务 vm 例直调 `restartHelperSource`，不依赖该实参）。
- [ ] Step 4: 复跑同两条命令 → 全绿（既有 6 例 + Task 1 两例 + 新 12 例；若 ⑤⑥⑧ 首段 pump 时序与实现不符，先核实现 spawn 是否发生在首轮推进，不改断言迁就实现）
- [ ] Step 5: 补例 ⑩ 并更新 import 块（`OLD_EXIT_TIMEOUT_MS, NULL_PORT_GRACE_MS, PORT_HELD_GRACE_MS, REPLACEMENT_UP_TIMEOUT_MS` 四个具名导入，此时导出已存在、链接安全）：

  ```js
  // import 块（≈:10-17）补入四个常量后，describe 末尾（例 ⑫ 之后）追加：
  it('⑩ 时序常量与模板内插同源 + 删除面负向锚（出现次数语义，评审 R1-Q6）', () => {
    const src = src5(3081)
    assert.equal(src.split(`const oldExitTimeout = ${JSON.stringify(OLD_EXIT_TIMEOUT_MS)}`).length - 1, 1)
    assert.equal(src.split(`const upTimeout = ${JSON.stringify(REPLACEMENT_UP_TIMEOUT_MS)}`).length - 1, 1)
    assert.equal(src.split(`const nullPortGrace = ${JSON.stringify(NULL_PORT_GRACE_MS)}`).length - 1, 1)
    assert.equal(src.split(`const heldGrace = ${JSON.stringify(PORT_HELD_GRACE_MS)}`).length - 1, 1)
    assert.equal(src.split('const pid = 4242').length - 1, 1)
    assert.equal(src.split('starting anyway').length - 1, 0)
    assert.equal(src.split('Date.now() + 20000').length - 1, 0)
    assert.equal(src.split('Date.now() + 30000').length - 1, 0)
  })
  ```

- Run: `npm run build` → `node --test tests/restart.test.mjs`
- Expected: 全绿（⑩ 四内插锚计 1 + pid 锚计 1 + 三负向锚计 0；其余 20 例保持绿）
- [ ] Step 6: checkpoint commit（可选）

### Task 3: scheduleRestart 接线（TDD）+ 既有回归

- 目标：接线钉先红（helper 分支模板调用缺 pid 实参），一行实参后全绿；既有 6 例与 host-api 注入桩断言面回归绿。
- 涉及文件：Modify `tests/restart.test.mjs`（加接线钉用例）；Modify `src/core/restart.ts`（两处：detached-helper 分支模板调用补第 5 实参 `pid` + `restartHelperSource` 第 5 形参从可选收紧为必填 `pid: number`）
- 接口契约
  - Consumes：Task 2 的 `restartHelperSource(spawned, launch, logs, port, pid?)` 可选签名与模板 pid 行（本任务把 `scheduleRestart` 的调用点接上并收紧签名）
  - Produces：接线钉用例（pid 注入与 windowsHide 的 scheduleRestart 级唯一自动防线）
- 验证范围：helper 分支 spawn 的 `-e` 源码含 pid 实参与 flags；500ms kill 定时器照常（`RestartResult` 形状钉例回归）

- [ ] Step 1: 写失败测试。`tests/restart.test.mjs` 文件末尾追加：

  ```js
  describe('scheduleRestart helper 分支接线（issue #48/#50）', () => {
    it('helper 源码携带真实 pid 与 windowsHide；500ms kill 定时器照常', () => {
      const timer = fakeTimer()
      const killed = []
      let spawned = null
      const result = scheduleRestart(3081, {
        pid: 4242,
        uid: 1039,
        // 无 .service 结尾段 → systemdRestartArgv 返回 null；无 appExit → managed false → 落 detached-helper 分支
        cgroup: '0::/user.slice/user-1039.slice/user@1000.service/app.slice/plain.slice',
        env: {},
        setTimeout: timer.setTimeout,
        kill: (p, sig) => killed.push([p, sig]),
        nodeExecutable: () => '/usr/bin/node',
        restartLaunch: () => ({ file: 'dsh', args: [], cwd: '/c', viaShell: false }),
        spawn(file, args, options) {
          spawned = { file, args, options }
          return { pid: 8000, unref() {}, once() {} }
        },
      })
      assert.equal(result.via, 'helper')
      assert.equal(result.helperPid, 8000)
      assert.ok(spawned, 'detached helper 已 spawn')
      assert.equal(spawned.file, '/usr/bin/node')
      assert.equal(spawned.args[0], '-e')
      const src = spawned.args[1]
      assert.equal(src.split('const pid = 4242').length - 1, 1)
      assert.equal(src.split('"windowsHide":true').length - 1, 1)
      assert.equal(spawned.options.detached, true)
      assert.deepEqual(killed, [])
      timer.timers.at(-1).fn()
      assert.deepEqual(killed, [[4242, 'SIGTERM']])
    })
  })
  ```

  （`restartLaunch` 注入桩消除真实 `dshArgv()` 对测试进程 argv 的依赖；spawn 桩带 `once()`——生产分支调 `helper.once?.('error', ...)`。）

- Run: `npm run build` → `node --test tests/restart.test.mjs`
- Expected: **红，且红形态恰好为**——新接线钉恰 1 条断言红：`src.split('const pid = 4242').length - 1` 计 0（调用点未传第 5 实参 → 模板内插 `const pid = undefined`）；同例 `via`/`helperPid`/`windowsHide` needle/kill 定时器断言全绿（Task 1/2 已落地）。红例 1、其余全绿；列表外红停下排查。
- [ ] Step 2: 确认失败形态吻合
- [ ] Step 3: 实现 `src/core/restart.ts` 两处——①detached-helper 分支模板调用（≈:323-333 一带）补第 5 实参：

  ```ts
  ['-e', restartHelperSource(spawned, launch, { out: logOut, err: logErr }, port, pid)],
  ```

  ②`restartHelperSource` 第 5 形参收紧为必填 `pid: number`（此时调用点已传，类型门全绿；全仓唯一调用点即此处——断言面普查 A，无其他消费方）。

- [ ] Step 4: 复跑同两条命令 → 全绿（接线钉转绿；既有 6 例零改动全绿——helper 分支非其覆盖面，`RestartResult` deepEqual 钉例形状零变化）
- [ ] Step 5: **关键锚变异自证**（pid 注入的唯一自动防线；同 Task 1 Step 5 在隔离副本执行，评审 R1-Q5）：副本内把第 5 实参 `pid` 删掉 → build + 单套件确认接线钉恰 `const pid = 4242` 锚红（TS 类型层若先行报错，属同义红灯，记录形态即可）→ 副本内恢复 → 绿。输出落盘留存；真实工作树零改动。
- [ ] Step 6: 回归确认：`node --test tests/host-api.test.mjs` → `node --test tests/host-api-profile.test.mjs`（两套件全绿——注入桩断言面零变化）

### Task 4: 全量收口 + Windows 实机验收（可选）+ 停点

- 目标：全仓门禁绿；验收判据闭环；发版前停点交主人。
- 涉及文件：无代码改动（纯验证）

- [ ] Step 1: 全量收口（web 机，逐条跑、各记退出码）
  - `npm run build`
  - `npm test`
  - `npm run typecheck`
- Expected: 三条命令退出码全 0；`npm test` 2087 + 新增 15 例（Task 1 两例 + Task 2 十二例 + Task 3 一例）量级全绿，与基线 2087/2087（2026-11-06）对照零基线外红例
- [ ] Step 2（可选，主人手动，Windows 实机——#48/#50 的真实环境形态）：普通 web 宿主 `node <dsh>/lib/bin.js --profile <名> --port <端口> --no-open` 升到含本修复的版本后：
  1. 面板/`dshm_restart` 触发重启 → 观察无命令行闪窗（可用 #48 报告者的 WinEvent 探针方法论；普通肉眼观察即可初判）；
  2. `%TEMP%\dshm-restart-*.err.log` 最新一对出现 `[dsh-m] replacement bound port <端口> after X.Xs`，无 `restart failed:`；
  3. 占口实验：另起任意进程监听该端口后触发重启 → err.log 出现 `[dsh-m] restart failed: port ... still held by another process ... replacement NOT started`，且无新 dsh 进程产生。
- [ ] Step 3: 输出修改摘要（逐文件可归因：`restart.ts` 常量（含 PORT_HELD_GRACE_MS）+flags 纯函数+模板重写+接线实参与签名收紧；`restart.test.mjs` 三个 describe 15 例；计划外改动为零）

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行；每任务先跑该任务验证再进下一任务；不无声跳步、合并步或改变任务目标。
- Task 1/Task 2 的红形态清单是**判据**：红例多、少、或名不符 → 停下排查（夹具/环境/锚漂移），不猜。行号锚漂移一律以符号锚重定位。
- 两处关键锚变异自证（Task 1 Step 5 windowsHide、Task 3 Step 5 pid）输出落盘留证——它们各自是该修复点的唯一自动防线。
- 变异自证副本（`.dsh-research/issue4850-mutation-check/`）证据 log 落盘 `.dsh-research/issue4850-plan-review-scratch/` 后**即刻删除副本**（评审计划外建议③），避免占盘；后续评审需要现场可按本计划重建。
- 当前分支 `main`：实现提交前向主人确认（grill R2-Q4 已批「docs(plan) → 单个 fix 提交 → 发版」结构；开工前仍按纪律确认工作树状态）。
- 全部任务完成后运行最终验证并输出修改摘要；**停在这里**——`npm run release`（0.12.7 版本 bump/CHANGELOG/tag/publish）、#48/#50 回帖（@appllove，附 Windows 验收邀请）与关闭、结果回传新 issue 开设，均属不可逆公开动作，另等当轮明确批准（dsh-m AGENTS.md 发版规矩）。
- CHANGELOG 顶条要点（供发版批次起草，非本任务）：中文/英文各一条 0.12.7 修复条目——Windows 自重启闪窗修复（helper 内层 spawn `windowsHide`）；helper 端口判定改为 PID 存活判定（修复重复实例、67% 假失败、30s 白等三缺陷）；端口被外部占用/旧进程未退出时不再强行启动（明确失败日志，可安全重试）；`dshm_restart`/CLI null-port 路径纳入同一时序治理。compatibility 注明：helper 日志行格式变化（新增 `restart failed:` 前缀与成功行）、`dshm-restart-*.err.log` 中旧 `starting anyway`/`20s` 字样消失、失败时不再产生替代进程（行为变更）。

## 最终验证

- `npm run build` → `npm test`（全绿，原退出码 0；与基线 2087 对照 +15 例）
- `npm run typecheck`（0 错误）
- `node --test tests/restart.test.mjs` 单套件复跑（既有 6 例零改动 + 新 15 例全绿）
- `node --test tests/host-api.test.mjs tests/host-api-profile.test.mjs`（注入桩断言面回归绿）
- 两处关键锚变异自证记录齐全（Task 1 Step 5 / Task 3 Step 5）
- Windows 实机验收（Task 4 Step 2）为主人可选步骤；未执行时以 vm 行为套件 + 停点说明交付，发版后回帖邀请报告者复验
