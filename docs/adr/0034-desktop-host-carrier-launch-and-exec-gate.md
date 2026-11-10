# 载体 launch 识别与执行能力门：宿主入口三形态 + PATH 残局委派（ADR-0034）

## 决策

issue #65（鸿蒙端侧 DSHM `ondevice` profile 安装必败：`spawn dsh EACCES`）的修复分两层，外加诊断与 chip 同链：

1. **载体入口识别（Layer 1，port 上游已验证修复）**：`dshArgv` 的宿主入口判定在共享正则 `/bin.(js|ts)|dsh$/` 之外，port dshmarket 的两个分支——①官方载体（1.73.5 起，commit `47e8e27`，#975）：`…/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js` 视为合法入口（**窄 regex 只认该 scoped 包**，不接受任意 `cli.js`，防 PATH 遮蔽）；②asar 豁免（1.73.17，commit `1e86641`，#1146）：entry 在 `.asar` 归档内 → `cwd` 置 `undefined`（Electron fs shim 能读、OS 不能 chdir 进归档，把归档内目录交给子进程 = `spawn <exe> ENOENT`）。载体命中时与 dshmarket 同形态：`spawn(nodeExecutable(), [...execArgv, abs])` 且 **cwd=undefined**（继承 launcher cwd）。
2. **launch 溯源（issue 方案 A）**：新增 `resolveDshLaunch`（`dshArgv` 的超集：返回值多 `source ∈ {entry, carrier, path-fallback}` 与原始 entry），`dshArgv` 保持四字段形状委托之；`runDshPlugin` 对 spawn 级失败（`spawn … EACCES/ENOENT/EPERM` 类原始错误）在错误信息追加一行 ASCII 溯源（source/entry/file），让现场报告自带「为什么落到 PATH 回退」的答案。
3. **执行能力门（Layer 2）**：web-kind profile 的四写操作（install / upgrade / uninstall / self-upgrade）在**进入事务前**判定：launch 落 `path-fallback` 且 PATH 上 `dsh` 探测不可执行（纯 FS：PATH 目录 walk + 存在性 + X_OK，零进程派生）时——官方 pluginManager 服务可用（`resolveManager` 同源探测：getService 直取 → ensureService 惰性拉起）且具备该操作所需方法（install/upgrade/self-upgrade 要 `installBundle`，uninstall 要 `removeBundle`）→ **委派 desktop ops**（与 desktop profile 完全同路同账）；服务或方法缺席 → `DesktopOpsError('no-exec-capability')` 结构化快速失败（事务未动，不产生「依赖回滚也失败…profile 可能需要人工修复」恐慌文案）。launch 命中 entry/carrier、或 PATH `dsh` 可执行 → 一切如旧，零漂移。
4. **版本 chip 同链**：`spawnDshVersion`（通路③）从 spawn 字面 `'dsh'` 改用 `dshArgv()` 解析结果——载体宿主上 chip 复活，与安装共用同一条 launch 识别。`readLauncherPackageVersion`（通路②）不动：载体场景它读到的是 desktop-host 包版本，语义另议（scope out）。

背景与证据：dshmarket 与 dsh-m 的 `dshArgv` 除上述两分支外逐字一致（共享正则、PATH 回退、`nodeExecutable`、`winCmdShim` 全同；对照全文见本役对比分析 `~/.dsh-research/issue65-dshmarket-compare/COMPARE.md`）。issue #65 设备差集论证锁死根因：同一台设备、同一宿主进程，dshmarket 1.73.16（带载体分支）安装成功、dsh-m 0.12.10（无）必败——设备宿主 `argv[1]` 只能是载体形态。issue 原方案 B（「manager 存在即委派」）被同证据削弱：dshmarket 在设备上成功走的是载体 spawn 而非 manager（`ondevice` 非 desktop 名单，dshmarket 只对 desktop 名单 profile 委派，`src/index.ts:280-360`）；本决策把委派严格限定在「spawn 已知不可用」的残局，与 ADR-0005「pluginManager 存在性 ≠ 桌面」的既判不冲突（门不判身份、只判能力，且仅影响已残的路径）。

## Considered Options

- **只做 Layer 1（载体 port）不加门**：被否——若设备 `argv[1]` 还有第五形态（差集论证依赖报告者引文准确），Layer 1 不命中则设备彻底无出路且报错依旧黑盒；门是 fail-closed 保底，正常宿主零漂移。
- **issue 原方案 B（manager 存在即委派，不分环境）**：被否——见背景；全局按存在性委派引入 web profile 双写者（dsh-m pnpm 事务账 vs 官方 manager 账）与路由哲学冲突（两库均按 profile 身份委派，不按能力）。
- **方案 C（真实 spawn 探测 `node -e` + 降级）**：本役不做——纯 FS 判据已覆盖设备形态（`EACCES` 即 PATH 目录不可搜/shim 不可执行）；真实探测引入进程派生成本与不确定性。若设备复测仍有残余（shim 在但 execve 被沙箱拦），按后续 issue 另议，届时溯源行会给出现场值。
- **维持现状**：被否——ondevice 四写操作必败 + 回滚失败恐慌文案；上游同构修复已存在两个多月（1.73.5，2026-10-22）。

## Consequences

- **正常宿主零漂移**：entry/carrier 命中或 PATH `dsh` 可执行的宿主，launch 形态、安装/升级/卸载/自升级路由、错误文案逐字节不变（含 cwd 语义与 `DshArgv` 四字段形状）。
- `restartLaunch`（`restart.ts` 与 `dshArgv` 同源）在载体宿主上随之修正——端侧 `dshm_restart` 的 launch 身份一并复活，未做专门适配（scope out ③）。
- ladder 的 pnpm 恢复步骤（build-blocks 重试、hoist-diff 重建）在无 pnpm 环境仍会 EACCES（scope out ①）：dshmarket 实证常规安装不经这些恢复步骤，仅失败恢复路径触发。
- CLI（`cli.ts` 三命令）不加门：standalone 进程无 pluginManager 服务可委派；Layer 1 溯源行自动惠及 CLI 报错（scope out，CLI 在端侧非真实操作面）。
- `DesktopOpsErrorCode` 新增 `'no-exec-capability'`：host-api 信封走既有 DesktopOpsError 映射（非 target 白名单 → `failureClass: 'systemic'`，409），零新增映射代码；批量升级短路语义随之成立（systemic）。
- GLOSSARY 入库三术语：「载体入口」「launch 溯源」「执行能力门」。
- CHANGELOG 0.12.13 双语条目，附零漂移声明与新错误码说明；设备最终验证依赖报告者复测（发版后回帖附复测指引与溯源行说明）。
