# Doctor 的 desktop profile 支持：CLI 例外开口与 farmChecked 语义修订（修订 ADR-0010 决定 6）

dsh-m 0.9.29/0.9.30 落地体检（ADR-0010）后，Windows desktop 机的实机报告（2026-10-04）证实：core 引擎（`runDoctor(profileDir, …)` 与四维检查）本就按 profileDir 参数化、无 web 硬编码；desktop profile 声明 `nodeLinker: hoisted` 且 `@deepseek-ai` 成员全为物化目录——detectLayout 判 hoisted、farmChecked=0 属**常态而非空转**。同时暴露两点缺口：CLI 对 `--profile desktop` 全命令一刀切拒绝（doctor 只读体检被连坐），以及 desktop-only 机器上无 flag 体检扫不存在的 web 目录、得出全 0 报告（已诚实标注 unknown 但易误读）。

我们决定（2026-10-04，用户两项拍板：MCP 维持缓上、空目录提示纳入）：

1. **CLI 例外开口（仅 doctor）**：doctor 是纯 FS 只读体检（无进程/无网络/无写入），成为 CLI 上唯一允许 `--profile desktop` 的子命令，路由到 `desktopProfileDir()`；install/upgrade/uninstall/toggle/restart/list/search/outdated/registry 等命令对 `--profile desktop` 的拒绝语义**逐字不变**（回归钉子测试钉住）——desktop 的变更类管理仍走官方 Desktop 插件页（ADR-0005 语义不动）。
2. **farmChecked 语义修订**：「farmChecked=0 = 祖先链遍历空转」的验收判定**仅适用于存在符号链农场的形态**（web 机 hoisted 共享店）；物化布局（典型 desktop）0 为常态值，不算验收失败。
3. **MCP 工具 `dshm_doctor` 维持 ADR-0010 决定 3 缓上**：宿主 method 已 active-profile 无关（desktop 宿主装上 dsh-m 即免改生效），Windows 机 agent 走 CLI（bin 入口 0.9.30 已修复）；「对 agent 说帮我体检」的高频场景证据未出现，缓上理由不变。
4. **宿主 method 零改动 + 诚实记录**：doctor case 用 active profile（`profile.dir`），desktop-kind 注入的钉子测试钉住该性质；Windows Electron 宿主的 argv[1] 大概率不匹配 launcher 形态 → 该形态下 runtimeVersion 可能仍降级（物化布局 farm=0，stale 无判定对象，实际影响为零）——不为它增加解析分支，如实记录。
5. **空目录提示**：CLI doctor 在目标 profile 目录不存在时提示「desktop-only 机器请加 --profile desktop」；存在但为空的合法 profile 不提示（首版曾用「unknown 布局且三项全 0」判据，会把空 deps 的合法 profile 误伤，已收紧）。

## Considered Options

- **全命令放开 `--profile desktop`**：违背 ADR-0005 的 desktop 变更委派策略（官方管理器兜底、CLI 独立进程拿不到宿主服务）。
- **新增 desktopDoctor method**（Windows 机报告建议）：误读——现有 `doctor` method 本就 active-profile 无关，desktop 宿主自动生效，加方法是无信息量的重复。
- **本期加 `dshm_doctor` 工具**：翻案 ADR-0010 决定 3 需新证据（高频 agent 唤起场景），本期未出现；用户拍板维持缓上。

## Consequences

- HELP 更新为 `dshm doctor [--json] [--profile web|desktop]`；人读输出首行加 `[web|desktop]` 标注。
- 版本 0.9.31；实施计划与 Windows 外机验收清单见 `docs/plans/2026-10-04-doctor-desktop-profile-implementation-plan.md`。
- ADR-0010 决定 6 的「desktop profile 诊断不在 Day1，需要时另议」由本 ADR 落地为「另议完毕」。
- 观察项：desktop 机器上 stale-target 判定依赖的符号链农场目前不存在（物化布局）；若未来 desktop 出现 junction 农场（libuv 将 junction 视作 symlink，STORE_VERSION_RE 已兼容 `\` 分隔），farm 检查自动生效。
