# 0.9.0 双 profile（DSH Web + 官方 Desktop）实施计划

设计来源：`01_docs/research/2026-09-30-dsh-m-dual-profile-analysis.md`（权威报告，独立评审无 P0/P1 分歧）+ 交接拍板项。基线：dsh-m `main` @ `dc2f18d`（v0.8.5，与 origin/main 同步，工作树干净）。目标版本 0.9.0。

报告行号锚点基于 `3f16e94`，0.8.x 已漂移；本计划锚点全部按符号重定位至 `dc2f18d` 实测（见 §锚点对照）。

## 全局约束（逐字继承）

- 环境：生产 3080 唯一实例，不重启、不抢端口、不动 user 级 shim；测试一律隔离 fixture（`DSHM_CACHE_DIR`/临时目录），绝不触碰 `~/.dsh`。
- push / tag / npm publish 均须用户确认后执行；本计划只产本地提交。
- registry verified 不新增条目（未实测 Desktop，know-how 008 纪律）。
- dsh-market 仅作语义参照；本项目不复制其代码（许可证未核）。
- 拍板项：`/dshm` 全 method（含 ping、未知 method）委派官方 `connection.requestRejection` 且 fail-closed（服务缺失/抛错 → 一律拒绝）；Desktop 首发只做只读市场 + 安装新包 + 开关；upgrade/uninstall/self-upgrade/restart 在 Desktop 结构化拒绝并指引官方入口；CLI 维持 Web-only 并对 `--profile desktop` 明确拒绝；Desktop 禁止一切 Web fallback 写路径（禁写 allowBuilds 文件、禁自实现 pnpm 编排）。
- 无额外全局约束（版本/依赖/平台规则无新变化：node ≥22、peer 不动）。

## 架构快照

三个官方接缝（全部经 `dc2f18d` 依赖树实读核验）：

1. **`ctx.get('connection').requestRejection({headers}) → 401|403|undefined`**（`@deepseek-ai/dsh-client-connection@0.2.0-rc.2` `lib/types/rpc.d.ts:77-82`，服务注册名 `"connection"`）。`ConnectionTrustRequest.headers` 接受 node:http 的 headers 记录。缺席 Origin 放行、`Origin: null`/跨站/非可信 Host 拒绝——Desktop 桥剥 Origin 后可合法到达。
2. **`ctx.get('profileContext')`**（`@deepseek-ai/dsh-app-boot@0.2.0-rc.2` `lib/types/profile-context.d.ts`：`name/dir/patchPath/installAnchor/cwd/home/startedBundles/packageManager/overlays/telemetryDisabledEnv`；仅 dsh 启动的 profile 存在）。
3. **`ctx.get('pluginManager')`**：既有 `PluginManagerLike`（listPlugins/setPluginEnabled/setBundleEnabled）之外，desktop 安装需 `installBundle(spec, {enabled?, approvedBuilds?}) → ChangeResult`、`listBundles() → BundleInfo[]`（`@deepseek-ai/dsh-plugin-manager@0.2.0-rc.2` `lib/types/index.d.ts:83-135`、`types.d.ts:93-128`）。ChangeResult 判定语义（报告 §5.2 #703/#772）：以 `application`/`stage` 为准（`stage:'enable'`+`application:'failed'` 可跟在 exitCode 0 后；`overridden` 非失败）；`pendingBuilds` 精确名单回传 `approvedBuilds` 重试（键格式由官方管理器自己写，dsh-m 绝不直接编辑 desktop profile 的 pnpm-workspace.yaml）。

**能力表**（ActiveProfile.kind × 动作）：

| 动作 | web | desktop | unknown profile |
|---|---|---|---|
| ping / registry / market / installed / readme / status / self-check / registry-config 读 / registry-diagnose / registry-default-download | ✓ | ✓（读自己 profile） | ✓（读自己 dir，缺 profileContext 时退 web 目录） |
| install（新包） | 既有事务 | 官方 pluginManager 委派 | ✗ 409 |
| set-enabled | 既有 toggle | 委派官方（服务缺席 → ✗ 拒绝，禁 fallback 文件写） | ✗ 409 |
| upgrade / uninstall / self-upgrade / restart | 既有路径 | ✗ 409 结构化拒绝 + 官方入口指引 | ✗ 409 |
| registry-config-apply / set-community | 既有 | ✓（dsh-m 自身配置，写宿主 settings store，非包操作；报告 B.3 证设置页本就可写，HTTP 单侧拦截无意义） | ✓ |

**缓存隔离**（报告 §4）：`cacheRoot(profile)`：web 恒走旧路径 `$DSH_HOME/dshm/cache`（DSHM_CACHE_DIR 可覆盖）——不迁移不清空；非 web → `<root>/<profile>`。registry nsDir、latest cache、社区 cache、accepted-source metadata 全部带 profile；web 默认值不变，零行为漂移。

## 锚点对照（3f16e94 → dc2f18d 实测）

- `host-api.ts`：guard 在 `parseRequest()` L136-137（`method !== 'ping' && !trustedRestartRequest(req)`）；method 数 17→**18**（0.8.0 增 `set-community`）。restarter `servingPort` 用于 `restart` method L432。
- `installed.ts`：`listInstalledPlugins(profileDir=webProfileDir())` L195、`readInstalledPluginReadme(pkg, profileDir=webProfileDir())` L280——参数已就位，只差调用方传值。
- `market.ts`：`listInstalledWithMeta` L879（`d.listInstalledPlugins()` 无参默认 web）、`installEntryLocked` L1412（`deps?.transaction?.profileDir ?? webProfileDir()`）、`capturePreMutationState` L1342、`withMutationSession` L1079、`installFromRegistry` L1048（前半段 registry/社区条目解析，可抽出共用）、`marketDeps().listInstalledPlugins` L699（无参闭包）。
- `registry-controller.ts`：`readAcceptedSourceMetadata()` L75（`cacheDir()/host/active-source.json`）、`commitActiveSource(…, 'host')` 调用点 L256/L347、bootstrap L178、外部 watch L233。
- `registry.ts`：`nsDir(namespace)` L455、`cacheDir()` L464、`commitActiveSource(address, namespace)` L564、`RegistryCacheNamespace = 'host'|'cli'` L85。
- `toggle.ts`：`togglePluginLocked` L112（`deps.profileDir ?? webProfileDir()`）、委派路径 L121-125、fallback 文件写 L196-290。
- `restart.ts`：`trustedRestartRequest` L55-70（删除目标）、`servingPort` L46（保留）、`scheduleRestart` L289。
- `tools.ts`：8 工具 L115-469、systemPrompt L471-489。
- `cli.ts`：全部命令 L215-437（0.8.x 已补 `--yes` 于 upgrade/uninstall/toggle/restart；install 仍无——维持现状，不在本计划扩大）。
- `client/main.jsx`：`api()` L494、RestartBanner L700-751、ping 调用 L711/L729/L2327。
- `host.ts`：apply L47（controller/appExit/restart/getService/registerTools 接线）、webServer inject L94-121。

## 文件结构与职责

新建：
- `src/core/active-profile.ts` — ActiveProfile 解析 + kind 判定 + 能力表 + `ProfileUnsupportedError`。
- `src/core/profile-ops.ts` — Desktop adapter：installBundle 委派、ChangeResult 判定、复读校验、desktop toggle 门禁。
- `tests/active-profile.test.mjs`、`tests/profile-ops.test.mjs`、`tests/host-api-profile.test.mjs`。
- `docs/adr/0005-dual-profile-support.md`。

修改：`src/host.ts`、`src/core/host-api.ts`、`src/core/env.ts`、`src/core/registry.ts`、`src/core/registry-controller.ts`、`src/core/market.ts`、`src/core/restart.ts`（删 trustedRestartRequest）、`src/tools.ts`、`src/cli.ts`、`src/client/main.jsx`、`README.md`、`README.en.md`、`package.json`（0.9.0）、`tests/host-api.test.mjs`（guard 断言改造）、`tests/restart.test.mjs`（删对应 describe）、`tests/market.test.mjs`（listInstalledPlugins 注入签名适配，如破）。

验证命令（仓库既有门禁，均在 `dsh-m/` 下）：`npm run typecheck`、`npm test`（pretest 自动 build）、`node scripts/validate-registry.mjs`。

## 关键接口契约（Consumes / Produces）

```ts
// active-profile.ts（produces；Task 1）
export type ProfileKind = 'web' | 'desktop' | 'unknown'
export interface ActiveProfile {
  readonly name: string            // profileContext.name ?? 'web'
  readonly kind: ProfileKind       // name==='desktop'→'desktop'; 'web'→'web'; 其余→'unknown'
  readonly dir: string             // profileContext.dir ?? webProfileDir()
  readonly source: 'host' | 'fallback'  // profileContext 缺席 = 'fallback'
}
export type ProfileAction = 'install' | 'set-enabled' | 'upgrade' | 'uninstall' | 'self-upgrade' | 'restart'
export class ProfileUnsupportedError extends Error {
  readonly code: 'unsupported-on-profile'; readonly action: ProfileAction; readonly profile: string; readonly guidance: string
}
export function resolveActiveProfile(ctx: unknown): ActiveProfile   // 守卫式 ctx.get('profileContext')
export function assertWriteAllowed(profile: ActiveProfile, action: ProfileAction): void  // 违反抛 ProfileUnsupportedError
export const WRITE_GUIDANCE: Record<ProfileAction, string>          // 官方入口指引文案（zh）

// profile-ops.ts（produces；Task 6，消费 active-profile + market 的 resolveRegistryEntry）
export interface DesktopManagerLike {   // 鸭子类型：官方 pluginManager 超集投影
  listPlugins(): Promise<PluginManagerRow[]>; setPluginEnabled(id: string, enabled: boolean): Promise<unknown>
  setBundleEnabled(name: string, enabled: boolean): Promise<unknown>
  installBundle?(spec: string, options?: { enabled?: boolean; approvedBuilds?: string[] }): Promise<unknown>
  listBundles?(): Promise<Array<{ name: string; installed?: boolean; enabled?: boolean }>>
}
export class DesktopOpsError extends Error { readonly code: 'no-manager' | 'install-refused' | 'enable-failed' | 'verify-failed' }
export interface DesktopInstallOptions { version?: string; forceIncompatible?: boolean; approvedBuilds?: string[] } & RegistryRuntimeOptions
export async function desktopInstallFromRegistry(id: string, cfg: RegistryConfig, opts: DesktopInstallOptions, deps?): Promise<InstallResult-shaped>
export async function desktopToggle(pkg: string, enabled: boolean, deps: { getService?: () => DesktopManagerLike | undefined; profileDir: string }): Promise<ToggleResult>

// env.ts（produces；Task 2）
export function cacheRoot(profile: string = WEB_PROFILE): string   // web=旧路径；非 web=<root>/<profile>

// market.ts（produces；Task 4/5）
// MarketQuery/RegistryRuntimeOptions 增 profile?: string；InstallDeps 增 profileDir?: string
// 新导出 resolveRegistryEntry(id, cfg, opts, deps): Promise<{ entry: InstallableEntry; community: boolean }>（installFromRegistry 复用）
// MarketDeps.listInstalledPlugins 签名改为 (profileDir?: string) => Promise<InstalledPluginsResult>

// registry.ts / registry-controller.ts（produces；Task 2/3）
// RegistryLoadOptions 增 profile?: string；commitActiveSource(address, namespace, profile='web')
// readAcceptedSourceMetadata(profile='web')；createRegistryController(initial, opts?: { profile?: string })

// host-api.ts（produces；Task 5/6）
// HostApiContext 增 profile: ActiveProfile、deps.rejectRequest?: (req) => 401|403|undefined（缺省 fail-closed 403）
// parseRequest 首位（先于 POST/Content-Type/body）调用 rejectRequest；ping 携带 profile: { name, kind, source }
```

## 任务清单

### Task 1 — active-profile 模块（TDD）

文件：`tests/active-profile.test.mjs`（先写）→ `src/core/active-profile.ts`。
步骤：①测试：ctx 带/不带 profileContext（getter 抛错也算缺席）、name→kind 映射（desktop/web/未知名）、dir 优先级、source 标注；assertWriteAllowed 能力表全矩阵（web 全过、desktop 仅 install/set-enabled、unknown 全拒）；错误字段（code/action/profile/guidance）。②最小实现。
验证：`npm run build && node --test tests/active-profile.test.mjs` 全绿。

### Task 2 — cacheRoot + registry.ts profile 贯穿（TDD）

文件：`tests/registry.test.mjs` 增补 → `src/core/env.ts`、`src/core/registry.ts`。
契约：见上（nsDir(namespace, profile)、cacheFilePath、commitActiveSource 第三参、pruneCaches、RegistryLoadOptions.profile；默认 `'web'`）。
步骤：①测试：`cacheRoot('web')` 恒等旧 `cacheDir()`（DSHM_CACHE_DIR 两种形态）、`cacheRoot('desktop')` 加段；`commitActiveSource(addr,'host','desktop')` 写 `<root>/desktop/host/active-source.json` 且不触 web 路径。②实现（env.ts 先行，registry.ts 参数穿透）。
验证：`node --test tests/registry.test.mjs` + 既有断言零回归。

### Task 3 — registry-controller profile 贯穿（TDD）

文件：`tests/registry-controller.test.mjs` 增补 → `src/core/registry-controller.ts`。
步骤：①测试：controller 以 `opts.profile='desktop'` 引导时，accepted-source 读写落 desktop 段、bootstrap/apply/handleExternalWatch 的 loadRegistry 调用带 profile。②实现：`createRegistryController(initial, opts)`；`readAcceptedSourceMetadata(profile)`；内部三处 `commitActiveSource` 传 profile。
验证：`node --test tests/registry-controller.test.mjs` 全绿（既有用例默认 web 不动）。

### Task 4 — market.ts 读模型与缓存 profile 贯穿

文件：`tests/market.test.mjs` 增补 → `src/core/market.ts`。
步骤：①`MarketQuery`/`RegistryRuntimeOptions` 增 `profile?: string`（默认 'web'），贯穿 `loadRegistry`/`fetchCommunityCatalog`/latest cache 读写（latestCacheKey 组装处）与 `d.listInstalledPlugins(opts.profileDir)`；`MarketDeps.listInstalledPlugins` 签名参数化；`InstallDeps` 增 `profileDir?: string`，`installEntryLocked`/`capturePreMutationState` 的 `webProfileDir()` 兜底改为 `deps?.profileDir ?? webProfileDir()`（uninstall/upgrade/selfUpgrade 同查）。②测试：注入 profileDir 时已装枚举/enablement join 使用它；latest cache 路径带 profile 段（desktop 不读 web 缓存）。
验证：`node --test tests/market.test.mjs` 全绿；既有 mock 签名适配只限必要处。

### Task 5 — market.ts 抽出 resolveRegistryEntry（行为不变重构）

文件：`src/core/market.ts`。
契约：新导出 `resolveRegistryEntry(id, cfg, opts, deps) → { entry, community }`（主清单 find → findCommunityInstallEntry 兜底 → 未找到抛既有同文案错误）；`installFromRegistry` 改为 `resolveRegistryEntry + installEntry`。
验证：`node --test tests/market.test.mjs tests/tools-install.test.mjs` 全绿（纯等价重构，无新测试，靠既有安装用例锁定）。

### Task 6 — profile-ops Desktop adapter（TDD）

文件：`tests/profile-ops.test.mjs`（先写）→ `src/core/profile-ops.ts`。消费 Task 1/5 契约。
步骤：①测试（全 mock 官方 manager，不发真实 pnpm/网络）：
- `desktopInstallFromRegistry`：injectBundle 成功（`application:'applied'`+`bundle`）→ 复读 `listBundles()` 见目标且 `installed!==false` → 返回 InstallResult 同形状（`needsRestart:true`、`buildApprovals: approvedBuilds ?? []`、`via:'desktop-manager'`）；`application:'restart-required'` 同成功路径；`stage:'enable'`+`application:'failed'` → `DesktopOpsError('enable-failed')`；`packageResult.kind==='build-blocked'`+`pendingBuilds` 且无 approvedBuilds → 结构化结果 `{ ok:false, needsBuildApproval:true, pendingBuilds }`（不抛）；带 approvedBuilds 重试路径正确传参；`application:'cancelled'` → `install-refused`；复读不一致 → `verify-failed`；`installBundle` 缺席/`getService()` 为空 → `DesktopOpsError('no-manager')`；全程断言：零 `capturePreMutationState` 调用、零 allowBuilds 文件写（deps spy）。
- compat 预检复用：直接调用 `precheckNpmCompat(pkg, version, { timeoutMs, signal })`（compat-check.ts 既有导出，market.ts 安装路径同一调用形态；预检自身异常 → 视为未检不拦安装的 fail-open 语义保持一致），`forceIncompatible` 不为 true 且返回非 null → 抛 `IncompatibleError`。
- `desktopToggle`：service 缺席 → `ToggleError`（code `'unaddressable'`，文案指引 Desktop 插件页）；service 在 → 行为与既有委派路径一致（注入 mock 验证）。
②实现。
验证：`npm run build && node --test tests/profile-ops.test.mjs` 全绿。

### Task 7 — host-api：trust 委派 + ping.profile（TDD）

文件：`tests/host-api-profile.test.mjs`（新）+ `tests/host-api.test.mjs`（改造）+ `tests/restart.test.mjs` + `src/core/host-api.ts`、`src/core/restart.ts`。
步骤：①新测试：`deps.rejectRequest` 注入 → 全 18 method + 未知 method + GET + 非 JSON 全部先过 trust（spy 断言调用先于 body 消费/业务 deps）；返回 401/403 → JSON `{ok:false,error}` 同状态码、业务零调用；`rejectRequest` 缺省（未注入）→ 403 fail-closed；抛错 → 403。②host-api：`HostApiContext.profile` 必填、`deps.rejectRequest`；`parseRequest` 首位调用；删除 `trustedRestartRequest` import 与调用；ping 增 `profile: { name, kind, source }`。③`restart.ts` 删 `trustedRestartRequest`（`servingPort` 保留）；`tests/host-api.test.mjs` 原「ping 无 Origin 可用；其余缺 Origin 403」用例改写为 rejectRequest 注入语义；`tests/restart.test.mjs` 删对应 describe。
验证：`node --test tests/host-api.test.mjs tests/host-api-profile.test.mjs tests/restart.test.mjs` 全绿。

### Task 8 — host-api：profile 门禁路由（TDD）

文件：`tests/host-api-profile.test.mjs` 增补 → `src/core/host-api.ts`。
步骤：①测试：desktop profile → `upgrade`/`uninstall`/`self-upgrade`/`restart` 返回 409 `{ok:false, code:'unsupported-on-profile', action, profile, guidance}` 且对应 deps spy 零调用（restart 尤其断言 scheduleRestart 未触）；`install` 路由到注入的 `desktopInstall`、`set-enabled` 路由到注入的 `desktopToggle`；web profile → 全部走既有函数（回归锁定）；unknown kind → install/set-enabled 也 409。②实现：dispatcher 内按 `ctx.profile.kind` 分支；`errorStatus` 增 `ProfileUnsupportedError`/`DesktopOpsError`/needsBuildApproval 投影。`readme` method 传 `ctx.profile.dir`。
验证：`node --test tests/host-api-profile.test.mjs` 全绿。

### Task 9 — host.ts 接线

文件：`src/host.ts`。
步骤：`resolveActiveProfile(ctx)`（apply 期一次，host 生命周期内不可变）；`createRequestRejection(ctx)`（守卫 `ctx.get('connection')`，返回 `(req)=>401|403|undefined`，缺席/抛错→403 并 warn 一次）；dispatcher 注入 profile+rejectRequest；`createRegistryController(config, { profile: profile.name })`；tools 增 profile 参数；desktop 下 `getService` 复用既有探测。
验证：`npm run typecheck`；`npm run build` 成功。

### Task 10 — tools.ts 门禁与文案

文件：`tests/tools-*.test.mjs` 增补 → `src/tools.ts`。
步骤：`registerTools(ctx, cfg, deps, profile = resolveActiveProfile(ctx))`；`dshm_upgrade`/`dshm_uninstall`/`dshm_restart` execute 首行 `assertWriteAllowed`（抛 ProfileUnsupportedError → 工具以 error result 呈现 guidance）；`dshm_install`/`dshm_toggle` desktop 分支路由 profile-ops（deps 注入与 host-api 共用）；`dshm_list`/`dshm_outdated`/`dshm_search` 传 `profile.dir`/profile 缓存段；描述微调：list/uninstall 的 "web profile" → "the current DSH profile"；systemPrompt 增一句「 operates on the current host profile; unsupported mutations return structured refusals with guidance」。
验证：`node --test tests/tools-install.test.mjs tests/tools-search.test.mjs tests/tools-summary.test.mjs` + 新增 desktop 门禁用例全绿。

### Task 11 — CLI `--profile` 防线（TDD）

文件：`tests/market.test.mjs`（runCli 用例所在，增补）→ `src/cli.ts`。
步骤：①测试：任意命令带 `--profile desktop` → err 输出含 `--profile desktop` 拒绝文案与官方入口指引、exit 1、core deps 零调用；`--profile web` → 正常放行；②实现：`parseArgs` 后置统一检查（help 除外）；HELP 增 profile 段说明（zh，CLI 现为中文）。
验证：`node --test tests/market.test.mjs` 全绿 + `node lib/cli.js search --profile desktop` 手验 exit 1。

### Task 12 — client/main.jsx：profile chip + desktop 重启引导

文件：`src/client/main.jsx`。
步骤：ping 响应 `profile` 存入 App 状态；头部 chip 在 `kind!=='web'` 时追加 profile 名（样式复用 `.dshm-dshchip`）；`kind==='desktop'` 时 RestartBanner 与重启入口渲染指引文案（lookup 新增 `profile.desktopHint` zh/en：退出并重新打开 Desktop 应用；关闭窗口可能只是隐藏），不发起 restart 请求；install 成功在 desktop 下文案按 `needsRestart:true` 既有渲染不变。client 纯逻辑（判断函数）若易测则进 client-render 测试，否则冒烟。
验证：`npm run build` 成功；`node --test tests/client-render-smoke.test.mjs`（如涉及）全绿。

### Task 13 — README 双语 + 版本 0.9.0

文件：`README.md`、`README.en.md`、`package.json`。
步骤：changelog 增 `### 0.9.0 新增：官方 Desktop（双 profile）支持` / `### New in 0.9.0 — Official Desktop (dual profile) support`（能力表：Desktop 只读市场+装新包+开关；upgrade/uninstall/自更新/restart 拒绝并指引；信任检查改委派官方——健康检查类无凭据 probe 从 403 变为按宿主信任判定；收藏与操作记录按浏览器 origin 各自独立、Web 与 Desktop 不自动同步）；CLI 节补 `--profile`；FAQ 增一条 Desktop 常见问题；`package.json` version 0.9.0。**不动 registry.json**（verified 纪律）。
验证：`node scripts/validate-registry.mjs` 全绿（应零变更）；`npm run typecheck && npm test` 全绿。

### Task 14 — ADR-0005 + 收尾

文件：`docs/adr/0005-dual-profile-support.md`（沿用既有 ADR 体例：决策段 + Considered Options + Consequences）。
内容：requestRejection 委派 fail-closed；ActiveProfile 单一事实源与能力表；desktop install 委派官方 manager（不写 allowBuilds、不做文件级装后守卫 v1，复读校验替代——能力矩阵如实降级）；缓存按 profile 分段、web 路径冻结；CLI Web-only。Consequences 列明 v1 未做项（desktop 升级/卸载/自更新、app.asar 探测盲区标 unknown、桌面实机 E2E 待补 → registry verified 待实测）。
验证：`npm run typecheck && npm test`（最终全量）+ `git status` 干净度自查 + `git log --oneline` 提交划分复核。

## 执行纪律

- 开始实现前先批判性复查本计划；与仓库现实冲突时停下修计划，不猜。
- 按任务顺序执行；每任务完成即跑其验证；不无声跳步/合并/改目标。
- 提交划分：Task 1-4（profile 地基）/ Task 5-8（host API 与 adapter）/ Task 9-12（接线与 UI）/ Task 13-14（文档版本）四个 checkpoint commit，message 用仓库既有的 `feat(0.9.0): …` 风格。
- 全程不 push；完成后汇报等用户确认。
- 最终验证：`npm run typecheck && npm test && node scripts/validate-registry.mjs` 全绿 + `git status` 干净。

## 相对报告的显式偏差（汇报时逐条呈现）

1. 报告 B.2 把「registry 配置写」列入 Desktop 阶段拒绝项；本计划允许（拍板项只拒绝包操作与重启；官方设置页本就可写同一字段，HTTP 单侧拦截是假门，见能力表注）。
2. `trustedRestartRequest` 函数删除而非保留为无调用方的遗留 helper（其单测随删）。
3. CLI `install` 仍不要求 `--yes`（0.8.5 现状，不在本计划扩大破坏面；报告 §5.3 的「强制显式 --profile」拍板为 Web-only + `--profile desktop` 显式拒绝）。
4. desktop 安装不做 dsh-m 文件级装后守卫（app.asar 探测盲区），以官方结果判定 + `listBundles` 复读替代——能力矩阵降级如实标注，不冒充同等保证（报告 §7 D.3）。
