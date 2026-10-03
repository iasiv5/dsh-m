# 升级生效判定三态分类：tarball 差异决定「刷新即可」还是「需要重启」（0.9.22，ADR-0007）

## Context

dsh-m 对安装/升级/卸载成功后的提示是**无条件**「需要重启生效」。2026-10-03 实证（@iasiv5/dsh-skins 1.2.3→1.3.0）：纯客户端皮肤插件升级后未重启即已生效（客户端 bundle 带 `rev=hash(mtime+ctime+size)`，文件变化即触发 HMR 整卡热更），提示为噪声。无条件提示的代价是**警报疲劳**——用户学会忽略它，等真正宿主侧变更时提示失去权威性；重启本身也不免费（web 服务瞬断、desktop 要手动重开应用）。同时 `InstallResult.needsRestart` 是字面量 `true`，三端消费方从未有能力区分「这次变更要不要重启」。

## Decision

升级（**仅 npm 源**）成功点后，拉取新旧两版 tarball（`npmVersion` 元数据 + `fetchBytesLimited` 下载，并行、总 deadline 10s、单包 8MiB、无缓存），零依赖 ustar 只读解析（`src/core/ustar.ts`，支持 pax 长名；解析失败抛错），逐文件 sha256 diff 后按五条规则分类为 `activation: 'client-only' | 'restart-required' | 'unknown'`（新字段挂 `UpgradeResult` / desktop 升级结果；`needsRestart` 仅在 `client-only` 时覆写为 `false`——**源头放宽** `InstallResult.needsRestart` 为 `boolean`，TS2430 禁止派生接口放宽属性）：

1. client 集合 = 新版 `package.json` `exports['./client']` 指向的文件；
2. `dsh.bundle.patch` **声明**的补丁目标文件变更 → 宿主侧（规则 4 的显式强调与前向保护）；
3. `package.json` 忽略**顶层** `version` 后语义比较：仅 version 差异不算宿主侧，dependencies/peerDependencies/engines/exports 结构等任一差异算宿主侧；
4. 其余任何文件的变更/新增/删除按路径归属：client 集合内 → 客户端，否则 → 宿主侧；
5. client 指向本身变化 → 保守判宿主侧。

**fail-open 立场**：判定路径任何异常（元数据缺失、下载失败、超时、超限、tar/JSON 解析）→ `'unknown'`，三端按现状保守提示重启；判定失败**绝不**影响升级成功态。接线点两处：`upgradePluginLocked`（web/CLI）与 `desktopUpgradeLocked`（desktop GUI——本机主升级路径）；`selfUpgrade`、install/uninstall、github 源升级不产出 `activation`。零依赖（只用 Node 内置）与「判定不做缓存」延续 [ADR-0006](./0006-latest-cache-memory-only.md) 的纪律。

## Consequences

- 纯客户端升级不再出现重启横幅：GUI toast 提示「刷新页面即可生效」（`needsRestart=false`，横幅门自然不亮）；agent 工具与 CLI 文案按三态分流；`unknown` 保守回退现状。
- **已知局限（有意接受）**：① client 入口若 require 同包 chunk 文件（code-splitting），按规则 4 保守判宿主侧（安全方向误判）；② README/CHANGELOG 等 docs 类随版差异按规则 4 保守判宿主侧——真实发版的 client-only 命中率取决于上游发版习惯，验收以构造用例为主（from==to / 降级再升）。
- 误判方向安全性：把「其实只需刷新」判成「需重启」只是回到旧行为；反向误判（宿主变更判成 client-only）被规则 4 的默认宿主归属 + fail-open 挡住。
- 测试纪律：升级接线使既有替身若不注入 `classifyActivation` 缝会隐式真实出网——既有升级用例统一补缝 `'unknown'`（market.test.mjs / profile-ops.test.mjs）。
