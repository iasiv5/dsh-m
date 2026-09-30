# 双 profile（DSH Web + 官方 Desktop）：信任检查委派宿主 + ActiveProfile 单一事实源 + Desktop 包操作委派官方管理器

dsh-m 作为同一 npm 包要同时装入 `web` 与官方 Desktop 的 `desktop` profile（官方 Desktop 承载同一 Web UI，`package.json` 的 `dsh.client.platform: "web"` 声明不变）。我们决定三件事（0.9.0，ADR-0005）：① `/dshm` 全 method（含 ping 与未知 method）的入口信任检查整体委派官方 `connection.requestRejection()`，在任何 body 读取与业务副作用之前执行，服务缺席或抛错一律 fail-closed 403，自制 Origin/Host 守卫（`trustedRestartRequest`）随之删除；② 引入 apply 期解析一次、host 生命周期内不可变的 `ActiveProfile`（官方 `ctx.get('profileContext')` 为真源，缺席降级 fallback web 并如实标注 `source`），GUI、agent 工具、HTTP 与缓存分段只消费这一个对象，未知名 profile 显式拒写；③ Desktop profile 的包操作走能力表——只放行「安装新包（委派官方 `pluginManager.installBundle`）+ 开关（委派官方管理器）」，升级/卸载/dsh-m 自更新/一键重启结构化 409 拒绝并指引官方入口；构建脚本按官方 `pendingBuilds` 名单精确重试，dsh-m 绝不直接编辑 desktop profile 的 pnpm-workspace.yaml、绝不全量放行、绝不文件级 fallback。

设计依据：`01_docs/research/2026-09-30-dsh-m-dual-profile-analysis.md`（独立评审无 P0/P1 分歧）与其实证基础——官方 0.2.0-rc.2 源码（`web-document.ts` 的 Desktop 桥剥 Origin、`rpc.ts` 的 `requestRejection` 契约、`plugin-manager` 的 `ChangeResult` 语义）与同业 dsh-market 的生产实绩（#648/#703/#653/#772：enable 阶段失败可跟在 exitCode 0 后、git 键格式由官方管理器内部处理、PATH 无 node）。

## Considered Options

- **保留自制 guard 并对「缺 Origin」放行**：改动最小，但 trustedHosts 语义要靠手工同步宿主配置（同业 #729 之前的教训是「安装按钮毫无反应」式误拒），且 `Origin: null`、跨站标记等官方语义各代漂移，dsh-m 独自追是长期负债。
- **迁移到官方 `connection.fetch.register({ path: '/api/dshm' })`**：自动获得 admit + 认证，但要把 Node IncomingMessage/ServerResponse dispatcher 改成 Fetch Request/Response 并重写全部前端路径与契约测试——并非打通 Desktop 的必要前置（报告 §3.2 明示），不因偏好官方 URL 扩大第一阶段改动面。
- **Desktop 写路径复用 web 事务（runProfileTransaction / pnpm 自编排）**：与官方插件页并发必竞争（无共享锁纪律），且 Desktop 内置 pnpm 11.7.0 的 allowBuilds 键形态、`$DSH_HOME/profiles/.generations/staging` 工作区、PATH 无 node 等运行时差异是实测坑（#652/#653/#772）；dsh-market #703 已证官方 manager 路线在生产可走通。
- **CLI 支持 `--profile desktop`**：独立 CLI 进程拿不到宿主 profileContext，PATH `dsh plugin --profile desktop` 在普通 npm CLI 里被官方拒绝，只有 Desktop 安装所附命令在受控条件下可用——由 dsh-m 代管会绕过宿主门禁（报告评审 P1），首版直接拒绝。

## Consequences

- **行为变化**：`ping` 不再匿名豁免（与全部 method 一起过宿主信任检查）；无凭据健康探针从「一律 403」变为「按宿主信任判定」；宿主无 `connection.requestRejection` 时 `/dshm` 全拒（旧代宿主升级 dsh-m 前需确认该服务存在，0.1.2-rc.1 起类型可见、待逐代实测）。
- **能力矩阵如实降级**：Desktop 下不做 dsh-m 文件级装后守卫与 npm dist integrity 对照（app.asar 布局探测盲区，#676），改以官方 `ChangeResult` 判定（`application`/`stage`，不看 exitCode）+ `listBundles` 复读替代；成功标准 = 官方结果无 error 且复读见目标 bundle 在装。不能在同一文案下冒充与 Web 同等保证。
- **Desktop 升级/卸载/自更新/重启整体缺席**：官方无独立 upgrade API（`installBundle` 对已装包的语义不等于有事务保证的升级）、`removeBundle` 有 in-use/stop-profile 约束、Desktop 子进程退出会被视为失败而非重启——这些动作在解决 offline handoff 与恢复链前一律结构化拒绝，不回落 Web runner。
- **缓存按 profile 分段**：`cacheRoot(profile)`——web 恒走旧路径（不迁移不清空），desktop 落 `<root>/desktop` 段；registry/社区清单/accepted-source 全部带 profile；latest 探测缓存本就按进程隔离，无需改。共享 home 的 `cordis.patch.yml` 与 SettingsForms legacy 迁移是上游有意的配置层，dsh-m 只做来源展示不承诺跨 profile 隔离（报告 §4.1）。
- **Web 行为零漂移约束**：所有 profile 参数缺省 = `'web'`，旧宿主（无 profileContext）走 fallback 且行为与 0.8.5 一致；CLI `--yes` 面、install 无 `--yes` 的现状均不在本版扩大。
- **未实测项留痕**：Desktop 实机（Win/macOS）E2E 未跑，`registry.json` verified 数组不新增 Desktop 代际（know-how 008 纪律，实测后补录）；逐操作授权模型与 Web 相同（登录 ≠ 逐次安装同意），skip-auth 部署不提供内层身份层——残余风险在 README 0.9.0 节如实声明。
