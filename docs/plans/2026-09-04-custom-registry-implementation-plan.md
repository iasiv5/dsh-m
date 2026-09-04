# 可自定义 Registry 收录清单 v1 实施计划

## 目标

在不引入多源合并和逐条编辑器的前提下，为 dsh-m 增加单一自定义 `registry.json` 覆盖能力：

- `registryUrl` 为空时使用官方默认清单；
- `registryUrl` 非空时使用一个远程 HTTPS URL 或 DSH Web 主机上的本地文件，整体覆盖默认清单；
- 在「插件市场 → 设置」中显示配置地址与当前生效地址；
- 提供「下载默认 registry.json」按钮，用户编辑副本后自行配置 URL/路径；
- 对远程和本地清单执行严格 v1 schema 校验；
- 自定义源失败时保留当前配置源的最后一次成功缓存，不把官方清单静默伪装成自定义清单；
- 让 1,000 条上限下的市场加载只查询当前服务端页面，而不是对整份清单逐条查询最新版本；
- 保留 `dshm_*` agent 工具和薄 CLI，并补齐 npm integrity 的实际校验。

## 架构快照

- `src/core/registry.ts` 负责地址规范化、严格 schema、default/custom 读取、状态和缓存；`LoadedRegistry.registry` 始终是非 nullable 的 `Registry`，不可用时返回空 `plugins` 与 `status: 'unavailable'`，避免消费者在类型迁移期间解引用 `null`。
- `RegistryConfig.registryUrl?: string` 仍是唯一用户配置键：空字符串表示默认源，非空字符串表示一个自定义覆盖源；不新增多源数组或运行时合并模式。
- `src/core/registry-controller.ts` 维护 configured address、active config、pending address、config phase 和真实 active registry 的分离状态。Host settings 的外部写入进入同一串行队列，异步加载通过 generation fence 防止旧结果覆盖新结果；`rejected` 只属于 config phase，不污染 active registry 的真实 source。最后一次 accepted address 通过受限的 host cache metadata 跨重启保存，外部无效值会被自动回滚。
- Registry loader 将 candidate cache 写入与 active-source prune 拆开：候选验证只允许写自己的 cache，不删除旧 active cache；settings 提交成功后 controller 才 commit/prune。Host 与 CLI 使用不同 cache namespace，CLI 不会删除 Host cache；Host 只保留 default cache 和当前 custom cache，切换源后不承诺切回旧源仍有缓存。
- 默认源按 raw.githubusercontent → jsDelivr → default cache → 包内快照工作；自定义源只尝试自身 URL/文件与当前配置源的 cache，不回退官方源。
- `src/core/httpx.ts` 提供所有 HTTP JSON/text/HEAD 请求共享的安全重定向 primitive：每一跳校验协议、限制跳数、检测循环、传播 signal、返回最终 URL；registry、homepage/icon 诊断不得各自实现另一套 redirect。
- `listMarket` 由 Host 服务端执行 query/category/offset/limit 过滤，只对当前页最多 50 条执行最新版本查询；客户端由 `MarketPanel` 独占 market 数据，`MarketTab` 不再重复 fetch。Host 强制 `withLatest=true` 且 hard clamp 50，agent/CLI 使用明确的 metadata-only policy。
- 配置 API 经 Host settings 持久化，但在写入前先加载并校验候选源；除极轻量 `ping` 外，所有 `/dshm` POST 都要求 JSON Content-Type 和现有 `trustedRestartRequest` 的 host-equivalence guard。部署新 Host 代码需要一次用户确认后的 DSH Web 重启；部署完成后改变 registry 地址不需要重启。
- client bundle 继续由 `scripts/build.mjs` 使用 esbuild 打包，React/React DOM 由 module loader 提供；纯 UI 状态逻辑抽到 `src/client/market-state.js` 以便 Node 测试，不能把 `npm run typecheck` 误当成 JSX 类型检查。

## 全局约束

- 沿用 `package.json` 的 Node.js `>=22`、ES2022/Node16 TypeScript 配置和 DSH Web profile 目标。
- 沿用现有 DSH 插件协议：`type: module`、Host 入口 `lib/host.js`、client 入口 `lib/client.js`、`dsh.client.platform: "web"`、现有 client inject 列表和 `cordis.patch.yml`。
- Registry 文件上限为 **2 MiB（2 * 1024 * 1024 bytes）**，`plugins` 最多 **1,000 条**；超过 200 条显示性能提示，超过 1,000 条拒绝整份清单。
- schema 固定为 `version: 1`；顶层和条目拒绝未知字段；错误条目不会被静默截断或部分加载。
- `id` 使用小写字母/数字开头，允许小写字母、数字、`.`、`_`、`-`，最多 64 字符且同一清单内唯一。
- `name` 最多 100 字符，`description` 最多 500 字符，最多 10 个 tag、每个最多 30 字符；超限拒绝，不截断。
- npm 包名使用标准 scoped/unscoped 名称规则：最多 214 字符，只允许小写包名、一个可选 `@scope/` 前缀，不接受版本号、range、URL、空白或安装命令；GitHub 使用 `owner/repo` 格式并限制 segment 长度；homepage/icon 只允许 HTTPS，最多 2,048 字符。
- URL 规范化时 trim 外层空白、拒绝控制字符和 userinfo、移除 fragment、保留合法 query；已知凭据 query key（`token`、`access_token`、`api_key`、`password`、`secret`）拒绝；HTTPS 允许用户明确指定的内网地址，HTTP 只允许 localhost、127.0.0.1、::1，并在文档中明确这是本机管理员信任边界，不声称提供 DNS rebinding 防护。
- 本地 registry 仅读取 DSH Web 主机上的可读普通文件，支持绝对路径和 `file://`，最终目标可为普通文件符号链接；拒绝非空 host、query、fragment、相对路径、目录、设备文件、管道等特殊文件；通过同一 file descriptor 执行类型/大小检查和分块读取，严格拒绝非法 UTF-8；cache 使用 0700/0600、临时文件、fsync、原子 rename 和同 key 写锁。
- 安装来源仍只有 npm 和 GitHub：npm 精确版本和 dist integrity 必须核对 profile `pnpm-lock.yaml`；GitHub 锁定 release/tag 指向的 commit SHA；自定义 registry 不开放任意 tarball、任意 Git URL 或 registry 私有认证。integrity 失败使用受控的 best-effort manifest/lock/workspace 快照恢复，不能声称 node_modules 已完整回滚。
- 不创建或修改任何监听 3080 的服务，不修改 `~/.config/systemd/user/dsh-web.service`，不改变现有 systemd shim 架构。
- 保留薄 CLI `dshm`，不新增 per-call registry 参数；Web profile 设置影响 Web 与 agent 工具，CLI 继续使用 `DSHM_REGISTRY_URL` 等环境变量。
- Registry URL 是 live 设置；`timeoutMs`/`cacheTtlMin` 仍可由既有 Host settings 修改，下一次 core 请求读取新值，但 agent 框架注册时的静态 tool deadline 不承诺热更新；新 UI 只编辑 `registryUrl`。
- 当前工作区已有用户手动修改的 `README.md` 与同步后的 `README.en.md` 未提交改动；实现和文档任务不得 reset、checkout 或覆盖这些改动，应在其基础上更新。

## 输入工件

- 已批准的 `/grilling` 设计共识（当前对话）：单一地址覆盖、浏览器下载默认 registry、严格 v1 schema、profile 级配置、live 应用、缓存与性能边界。
- 评审后修订要求：服务端分页/两阶段版本查询、settings 双状态与 generation fence、非 nullable unavailable 结果、当前源 cache 保留策略、fd/原子写、统一安全 HTTP、npm integrity、同源 API 防护、唯一 market 数据 owner、Host 重启 checkpoint、CLI unavailable 退出码、CI path 和实际 `lib/cli.js` 打包预期。
- `DESIGN.md` §2 Registry、§3 安装安全基线、§4 GUI、§5 Agent 工具与 CLI、§11 本机约束；旧的 registry 覆盖、缓存和设置描述需在文档任务中同步为最终语义。
- `src/core/registry.ts`、`src/core/httpx.ts`、`src/core/market.ts`、`src/core/versions.ts`、`src/core/dsh-cli.ts` 的现有实现。
- `src/host.ts` 的 `Config` schema、`settings.register('dshm', ...)`、`/dshm` method 分发和 `src/core/restart.ts` 的 `trustedRestartRequest`。
- `src/client/main.jsx` 的 `SettingsTab`、`MarketTab`、`MarketPanel`、`useAsync` 和现有本地 API 封装。
- DSH settings contract：Host `SettingsScope.get/watch/update`，client settings scope 的 live namespace contract；Host controller 负责网络校验事务，client 不直接持久化未经验证的地址。

## 文件结构与职责

### Create

- `src/core/registry-controller.ts`：active/configured/rejected 状态、settings store 适配、generation fence、校验后应用和恢复默认。
- `src/core/registry-check.ts`：npm/GitHub/homepage/icon probe，有限并发、全局 deadline、稳定 issue 顺序和结果截断。
- `src/core/host-api.ts`：可注入的 `/dshm` method dispatcher、JSON/Origin 防护和 HTTP 状态映射，供 Host 与契约测试共用。
- `src/core/npm-integrity.ts`：读取 profile pnpm lockfile 的包/version integrity、比较 npm dist integrity、失败回滚辅助。
- `src/client/market-state.js`：市场 query 规范化、分页状态、API response narrowing、短 registry summary/notice 的纯函数。
- `scripts/assert-pack.mjs`：读取 `npm pack --dry-run --json` 并断言实际运行时包文件清单。
- `tests/registry.test.mjs`：严格 schema、地址规则、容量边界。
- `tests/httpx.test.mjs`：统一 redirect、signal、body/UTF-8 边界。
- `tests/registry-controller.test.mjs`：配置事务、外部写入、generation fence、失败保留 active、dispose。
- `tests/registry-check.test.mjs`：probe 统计、并发、deadline、稳定顺序和 issue 截断。
- `tests/market.test.mjs`：服务端 query/page、有限并发、latest cache、unavailable 和 abort。
- `tests/host-api.test.mjs`：method response、422/404/413/500、同源/Content-Type 防护、默认下载和诊断。
- `tests/npm-integrity.test.mjs`：exact npm metadata、pnpm lockfile fixture、mismatch rollback contract。
- `tests/client-market-state.test.mjs`：分页、query reset、response narrowing、summary 隐私规则。
- `docs/plans/2026-09-04-custom-registry-implementation-plan.md`：本实施计划。

### Modify

- `src/core/registry.ts`：严格 validator、地址解析、`LoadedRegistry` 状态、default/custom loader、版本化 cache、candidate/commit prune 边界。
- `src/core/httpx.ts`：统一安全 fetch/redirect/final URL/signal/body cap。
- `src/core/versions.ts`：精确 npm version metadata、可取消的 npm/GitHub 查询。
- `scripts/build.mjs`：增加 `lib/cli.js` bundle marker；`scripts/assert-pack.mjs`：断言 npm pack JSON 文件清单。
- `src/core/market.ts`：服务端 query/page、`RegistryState`、有限并发 latest、latest cache、unavailable 处理、npm integrity 接入。
- `src/host.ts`：live settings store/controller 接线、`/dshm` 路由接线、registry methods 和配置错误映射。
- `src/tools.ts`：短 `RegistrySummary`、unavailable 业务错误、工具结果不泄露路径。
- `src/cli.ts`：配置/实际生效源输出、unavailable 退出码和本地终端诊断信息。
- `src/client/main.jsx`：设置页、下载/应用/恢复/诊断、唯一 market data owner、分页、来源提示。
- `package.json`：增加 Node 内置 test runner 的 `test` script，不增加运行时依赖。
- `DESIGN.md`：同步最终覆盖模型、严格 schema、安全、缓存、分页、integrity、API 和重启边界。
- `README.md`、`README.en.md`：同步用户操作说明、地址格式、下载自定义流程、缓存提示、容量、诊断和安全提示；保留中文 README 现有手动改动及其英文同步内容。
- `.github/workflows/registry.yml`：让 registry/core/httpx/schema/tests/package 相关变更也触发校验，并执行 Node tests。

### 不修改

- `registry.json`：官方清单内容不因本功能改变。
- `.github/workflows/publish.yml`：发版流程保持不变。
- DSH Web shell、skillhub 源码、systemd unit 和 3080 服务。

## 接口契约

### Registry core contract

`src/core/registry.ts` 产出并由后续任务消费以下名称：

```ts
export type RegistryAddressKind = 'default' | 'url' | 'file'

export interface RegistryAddress {
  kind: RegistryAddressKind
  input: string
  normalized: string       // default 为 ''，URL 为规范化 URL，file 为真实绝对路径
  cacheKey: string         // default 或带算法版本的稳定 key
}

export type RegistrySource =
  | 'default-raw'
  | 'default-jsdelivr'
  | 'default-cache'
  | 'bundled'
  | 'custom-url'
  | 'custom-file'
  | 'custom-cache'
  | 'custom-unavailable'

export type RegistryStatus = 'ready' | 'stale' | 'unavailable'
export type RegistryCacheNamespace = 'host' | 'cli'
export type RegistryConfigPhase = 'loading' | 'ready' | 'pending' | 'rejected' | 'unavailable'

export interface RegistryState {
  configuredAddress: string  // '' 表示默认；描述 active registry 的配置地址
  activeAddress: string | null
  source: RegistrySource       // 只描述真实 active registry 来源
  status: RegistryStatus       // 只描述真实 active registry 状态
  isDefault: boolean           // 当前 active registry 是否为默认源
  stale: boolean
  fetchedAt: string | null
  errors: string[]
  count: number
}

export interface RegistrySummary {
  isDefault: boolean
  status: RegistryStatus
  stale: boolean
}

export interface LoadedRegistry extends RegistryState {
  // unavailable 也返回 { version: 1, plugins: [] }，不使用 null
  registry: Registry
}

export function parseRegistryAddress(raw: string | undefined): RegistryAddress
export function validateRegistry(raw: unknown): {
  ok: boolean
  errors: string[]
  registry: Registry | null  // 仅 validator result；LoadedRegistry.registry 永不为 null
}
export interface RegistryLoadOptions {
  force?: boolean
  signal?: AbortSignal
  namespace?: RegistryCacheNamespace
  prune?: boolean
  deadlineMs?: number
}

export function loadRegistry(
  cfg: RegistryConfig,
  opts?: RegistryLoadOptions,
): Promise<LoadedRegistry>
export function loadRegistryCandidate(
  cfg: RegistryConfig,
  opts?: Omit<RegistryLoadOptions, 'prune'>,
): Promise<LoadedRegistry>
export function loadDefaultRegistry(
  cfg?: RegistryConfig,
  opts?: RegistryLoadOptions,
): Promise<LoadedRegistry>
export interface ActiveSourceCommitResult {
  metadataCommitted: boolean
  pruned: boolean
  warning: string | null
}

export function commitActiveSource(
  address: RegistryAddress,
  namespace: RegistryCacheNamespace,
): Promise<ActiveSourceCommitResult>
export function registrySummary(loaded: LoadedRegistry): RegistrySummary

export interface CacheFile {
  version: 2
  namespace: RegistryCacheNamespace
  cacheKey: string
  configuredAddress: string
  activeAddress: string | null
  source: RegistrySource
  fetchedAt: string
  registry: Registry
}
```

严格规则必须明确实现：

- 顶层允许且只允许 `version`、`plugins`；条目允许且只允许 `id`、`name`、`description`、`category`、`tags`、`source`、`npm`、`github`、`homepage`、`icon`。
- 条目必需 `id/name/description/category/tags/source`；`tags` 必须是字符串数组；`source: npm` 必须有合法 npm 包名，`source: github` 必须有合法 `owner/repo`；另一个 npm/GitHub 字段可作为官方链接元数据。
- npm 采用 `^(?:@[a-z0-9][a-z0-9._~-]*/)?[a-z0-9][a-z0-9._~-]*$` 形状与 214 字符上限；GitHub 保留现有 owner/repo regex，并增加 owner ≤39、repo ≤100 和整体长度限制；homepage/icon 通过 URL parser 后只接受 HTTPS、≤2,048 字符、无 userinfo。
- ID、名称、描述、tag、URL 先 trim 外层空白；ID/npm/GitHub 内部空白直接拒绝；tag 不能重复；未知键、版本、枚举、source 联动、超限和重复 ID 均产生字段路径错误。
- JSON 文档读取使用 UTF-8 fatal decoder；2 MiB 是原始 UTF-8 bytes 上限，不是字符数；`plugins` 1,001 条拒绝。

`loadRegistry` 行为：

- 空地址：default raw → default jsDelivr → default cache → bundled；网络成功记录最终 URL，cache/bundled 明确标记 default/stale。
- 非空 URL/文件：只尝试这一自定义源，失败只读该**当前配置 source key**的 cache；没有数据返回空 registry、`status: 'unavailable'`，不调用官方 bundled snapshot。
- cache 读取重新严格 validate；cache schema 版本与 key 算法不匹配直接忽略。
- `force: true` 绕过 TTL；普通加载遵循 `cacheTtlMin`。
- `loadRegistryCandidate` 只读取并验证候选、可以写入候选 cache，但绝不 prune 旧 source；controller 只有在 settings update 成功后调用 `commitActiveSource`。
- `loadRegistry` 的普通 active 读取可以在所属 namespace 内 commit/prune；CLI 使用 `namespace: 'cli'`，Host 使用 `namespace: 'host'`，两个 namespace 的 cache 文件互不删除。
- Host 成功切换 custom source 后只保留 host namespace 的 default cache 与当前 custom cache；CLI 成功读取只在 cli namespace 内执行同样 prune；候选验证或 update 失败不会删除旧 active cache。
- `commitActiveSource` 在 host namespace 先原子写 `AcceptedSourceMetadata`，再 prune 非当前 custom cache；cli namespace 不写 host accepted metadata。metadata 写失败时不 prune、active 仍可切换但返回 warning；prune 失败时 metadata/active 仍有效、旧 cache 保留并返回 warning，不反向撤销已成功的 settings update。
- `CacheFile v2` 必须同时保存 `namespace` 与 `cacheKey`；cache 路径包含 `host/` 或 `cli/` namespace。cache 写入使用原子临时文件和同 key lock；跨进程只依赖不同 namespace 隔离、`O_EXCL`/rename 的完整性，单 Host 架构不支持多个 Host writer 同时管理同一 namespace。

### Registry controller contract

`src/core/registry-controller.ts` 产出：

```ts
export interface RegistrySettingsStore {
  get(): RegistryConfig
  update(patch: { registryUrl: string }): Promise<void>
  watch(callback: (next: RegistryConfig, prev: RegistryConfig) => void): () => void
}

export interface RegistryControllerSnapshot {
  configuredAddress: string
  activeConfigAddress: string
  pendingAddress: string | null
  configStatus: RegistryConfigPhase
  configErrors: string[]
  warnings: string[]
  loaded: LoadedRegistry  // 始终描述真实 active registry，不污染 source/status
}

export interface RegistryController {
  readonly config: RegistryConfig  // active config object，供 tools/API 共用
  attachStore(store: RegistrySettingsStore): void
  ensureReady(opts?: { signal?: AbortSignal }): Promise<void>
  snapshot(opts?: { force?: boolean; signal?: AbortSignal }): Promise<RegistryControllerSnapshot>
  loadDefault(opts?: { force?: boolean; signal?: AbortSignal }): Promise<LoadedRegistry>
  apply(rawAddress: string, opts?: { signal?: AbortSignal }): Promise<RegistryControllerSnapshot>
  dispose(): void
}

export function createRegistryController(initial: RegistryConfig): RegistryController

interface AcceptedSourceMetadata {
  version: 1
  namespace: 'host'
  configuredAddress: string
  cacheKey: string
  savedAt: string
}
```

状态机契约：

- controller 创建后处于 `configStatus: 'loading'`；未 attach 前只保留 apply entry-config 作为临时 initial，不对外宣称 ready；`attachStore(store)` 以 `store.get()` 覆盖 initial 并启动 bootstrap，`ensureReady()`/`snapshot()` 在首次请求时等待 bootstrap 完成，避免返回未初始化的 active registry。
- bootstrap/外部 watch/apply 共用一个 promise queue 和 generation。成功 candidate（ready 或同源 stale cache）才替换 active config/registry；旧 generation 只丢弃结果，不得回写。
- `apply` trim/规范化地址，调用 `loadRegistryCandidate`；candidate 成功后才 `store.update({ registryUrl })`，再原子切换 active memory，最后调用 `commitActiveSource`（先写 accepted metadata、再 prune）；保证 update 失败时旧 active cache 不被 prune。
- `store.update` 成功后 metadata/prune 失败不撤销已验证的 active config：active registry 继续生效，snapshot/API 返回 warning，metadata 未成功时不 prune，prune 失败时保留旧 cache；只有 candidate/update 失败才保持旧 active。
- 外部 settings 写入即使已经持久化但不可达，也不能直接改变 active config；snapshot 保持 `loaded` 中旧 active 的真实 source/status，设置 `configStatus: 'rejected'`、`configErrors` 保存候选错误，并将无效持久化值回滚到最近一次 accepted address。rollback update 失败时 active 仍保持旧值，snapshot 增加 warning，并在下次 bootstrap 再次尝试恢复，不伪称回滚完成。
- controller 在 `cacheDir()/host/active-source.json` 中持久化最近一次 accepted address、cacheKey 和 metadata version；文件使用 0600/atomic write。重启 bootstrap 发现持久化值无效时，先尝试 accepted address 的 cache/源；成功后恢复该地址并抑制 rollback watch 循环；没有 accepted metadata 时恢复空地址的 default。rejected address/error 只保留在当前进程的 controller snapshot，不假装跨重启保留。
- settings provider 当前 Host contract 没有 CAS 参数；计划不虚构跨进程 revision 保证，明确采用 provider 的写入顺序、持久化 accepted metadata 和 controller generation fence，确保运行态不被旧异步结果覆盖。
- `dispose` 取消/忽略后续 watch 任务；已开始的读请求完成后不得写 active state。

### Market query and result contract

`src/core/market.ts` 产出：

```ts
export interface RegistryRuntimeOptions {
  namespace?: RegistryCacheNamespace  // Host API/Agent tools 固定 host；独立 CLI 固定 cli
  signal?: AbortSignal
}

export interface MarketQuery extends RegistryRuntimeOptions {
  query?: string
  category?: RegistryEntry['category'] | null
  offset?: number
  limit?: number       // core 根据 withLatest hard clamp：true 最大 50，false 最大 80
  withLatest?: boolean // Host GUI 忽略 caller 值；core 默认 true，tool/CLI 显式 false
  force?: boolean
  deadlineMs?: number  // default 60_000; tests inject a short deadline
}

export interface MarketDeps {
  loadRegistry: typeof loadRegistry
  listInstalledPlugins: typeof listInstalledPlugins
  npmLatest: typeof npmLatest
  githubLatestTag: typeof githubLatestTag
}

export type CategoryCounts = Record<RegistryEntry['category'], number>

export type LatestErrorCode = 'LATEST_TIMEOUT' | 'LATEST_ERROR'

export interface MarketResult {
  // MarketItem 增加可选 latestErrorCode: LatestErrorCode
  items: MarketItem[]
  total: number
  offset: number
  limit: number
  categoryCounts: CategoryCounts
  registryState: RegistryState
  installedComplete: boolean
  latestComplete: boolean
  latestTimedOut: boolean
}

export interface InstalledResult {
  items: InstalledItem[]
  others: number
  profileDir: string
  registryState: RegistryState
}

export function listMarket(cfg: RegistryConfig, opts?: MarketQuery, deps?: MarketDeps): Promise<MarketResult>

export function listInstalledWithMeta(
  cfg: RegistryConfig,
  opts?: RegistryRuntimeOptions & { deadlineMs?: number },
): Promise<InstalledResult>

export function installFromRegistry(
  id: string,
  cfg: RegistryConfig,
  opts?: { version?: string } & RegistryRuntimeOptions,
): Promise<InstallResult>

export function installEntry(
  entry: RegistryEntry,
  cfg: RegistryConfig,
  opts?: { version?: string } & RegistryRuntimeOptions,
): Promise<InstallResult>

export function upgradePlugin(
  pkg: string,
  cfg: RegistryConfig,
  opts?: RegistryRuntimeOptions,
): Promise<UpgradeResult>
```

- `listMarket` 先加载 registry、按 query/category 过滤并计算 `total/categoryCounts`，只对当前 page 的 items 查询 latest；结果顺序必须与 registry 顺序一致。
- core 的 `listMarket` 对所有调用者强制 normalize：`withLatest:true` 的 limit 最大 50，`withLatest:false` 的 limit 最大 80；超限统一 clamp，不依赖调用者自觉。Host GUI policy 固定 `withLatest: true` 且把 limit clamp 到 1..50；dispatcher 忽略客户端传入的 withLatest。`dshm_search` 和 CLI search 直接把 query/category/limit 传给 core，并固定 `withLatest: false`，禁止先全量 latest 后过滤。
- page `limit` 默认按 policy 为 50（withLatest）或 80（metadata-only）；`offset` 非负且超过 total 时归一到最后有效页；负数、NaN、Infinity、非数字统一归一为默认值。
- `listMarket` 的全局 deadline 从函数入口开始，默认 60 秒；registry load、installed profile load、同步过滤/分页和 latest probes 共享同一个 deadline budget 与 caller signal，latest 只使用剩余预算。
- latest 查询使用内存 TTL cache（key = namespace + source + package/repo + stable config key），worker pool 最大并发 8；core 的 `withLatest:true` 永远最多 50，`withLatest:false` 永远最多 80。
- internal deadline 到达时：若 registry 已就绪，返回完整当前页的稳定顺序，`latestComplete:false`、`latestTimedOut:true`，未完成 item 的 latest 保持空并设置稳定 `latestErrorCode: 'LATEST_TIMEOUT'`；若 registry/profile 在 deadline 内未就绪，返回空页并标记相应 unavailable/timeout state；外部 request signal abort 时停止生成并抛 AbortError，不返回 partial page，dispatcher 不再向已关闭连接写 response；旧请求结果由 controller/client generation 丢弃。测试使用 20ms 等短 deadline，不真实等待 60 秒；另测永不 resolve 的 registry/latest fake probe。
- registry unavailable 时 `items=[]`、counts 全 0、`installedComplete:false`，HTTP/API 仍可返回 200 + unavailable state；不进行任何 latest 请求；安装/升级抛出业务错误而不是 TypeError。
- `listInstalledWithMeta` 即使 registry unavailable 仍返回已安装插件；不做 registry matching，`registryId` 为空且 registryState 标记 unavailable，并返回 `InstalledResult.registryState`；market UI 在 `installedComplete:false` 时不把插件误标成“未安装”。

### Host API contract

`src/core/host-api.ts` 与 `src/host.ts` 继续使用 `POST /dshm`：

```text
registry
  request:  { method: 'registry', force?: boolean }
  response: { ok, plugins, registryState }

market
  request:  { method: 'market', query?, category?, offset?, limit?, force?: boolean, withLatest?: boolean }
  response: { ok, items, total, offset, limit, categoryCounts, registryState, installedComplete, latestComplete, latestTimedOut }

registry-config
  response: { ok, registryUrl, configuredAddress, activeConfigAddress, pendingAddress, configStatus, configErrors, warnings, registryState }

registry-config-apply
  request:  { method: 'registry-config-apply', registryUrl: string }
  success:  { ok, applied: true, registryUrl, configuredAddress, activeConfigAddress, pendingAddress, configStatus, configErrors, warnings, registryState }
  failure:  HTTP 422 { ok: false, error, errors }

registry-default-download
  response: { ok, registry, registryState }

registry-diagnose
  response: { ok, registryState, check }
```

- Host GUI `market` 忽略请求中的 `withLatest`，固定 `withLatest: true`，并把 limit clamp 到 1..50；metadata-only 仅由 dshm_search/CLI 内部调用 core 时使用，不能由浏览器 body 放大。
- `/dshm` 只接受 POST；GET/其他 method 返回 405；`ping` 也只能通过 POST。所有 POST 都必须是 `application/json`，且 JSON 顶层必须是非 null、非数组的普通对象。unavailable 的 `registry`/`market` 返回 HTTP 200、空 items/plugins 和结构化 `registryState`；配置输入错误、schema/读取失败返回 422；未知 method 返回 404；body 超过 1 MiB 返回 413；不支持的 Content-Type 返回 415；未预期异常返回 500。
- 只有极轻量 `ping` 豁免 `trustedRestartRequest` host-equivalence guard；其他所有 POST method 都要求该 guard，至少涵盖 registry force、market force、registry-default-download、registry-diagnose、registry-config-apply、install、uninstall、upgrade、self-upgrade、restart。`trustedRestartRequest` 的实际语义必须按 host/x-forwarded-host 等价检查测试，不描述成严格 scheme-sensitive Origin 同源。
- `readBody` 对错误 JSON 返回 400，不再把错误 body 静默当成 `{}`；空 body、非对象顶层或缺 method 返回 400；超限时停止收集并 drain request，不盲目 destroy socket；错误消息在 agent summary 中使用脱敏版本，不把凭据、query secret 或本地路径泄露到对话。
- 定义 `BadJsonError`、`BodyTooLargeError`、`UnsupportedMediaTypeError` 等 typed errors，由 dispatcher/最外层统一映射 400/413/415；`RegistryConfigError` 专门映射 422，不能被总 catch 改成 500。

`src/core/host-api.ts` 的解析顺序固定为：只接受 POST → 校验 JSON Content-Type → 有上限读取并 drain body → 顶层必须为非 null/非数组对象且有 method（否则 400）→ method 为 `ping` 时跳过 guard，否则校验 `trustedRestartRequest` host-equivalence → typed method/业务错误映射 4xx → 其他错误映射 500。

```ts
export class BadJsonError extends Error {}
export class BodyTooLargeError extends Error {}
export class UnsupportedMediaTypeError extends Error {}
```

### Registry diagnostic contract

`src/core/registry-check.ts`：

```ts
export interface RegistryCheckIssue {
  id: string
  field: string
  message: string
}

export interface RegistryCheckResult {
  checked: number  // 已发起的 probe 次数，不是条目数
  passed: number   // 成功 probe 次数
  failed: number   // 失败 probe 次数
  issues: RegistryCheckIssue[]
  truncated: boolean
}

export interface RegistryCheckDeps {
  npmLatest(pkg: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown>
  githubLatestTag(repo: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown>
  reachable(url: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean>
}

export function checkRegistryEntries(
  registry: Registry,
  options?: { timeoutMs?: number; concurrency?: number; deadlineMs?: number; signal?: AbortSignal },
  deps?: RegistryCheckDeps,
): Promise<RegistryCheckResult>
```

- 每个 npm、GitHub、homepage、icon 字段是一个 probe；issue 顺序按 registry 条目顺序、字段顺序 `npm → github → homepage → icon` 稳定排列。
- concurrency 的 NaN/Infinity/≤0 使用默认 8，正数向下取整并 clamp 到 1–8；默认全局 deadline 60 秒；达到 deadline 后不启动新 probe，已启动 probe 收敛后返回。
- 最多返回 100 个 issue，但继续启动未完成 probe 直到 deadline，以保持 checked/passed/failed 统计含义；超时不等待忽略 AbortSignal 的永不结束 probe，返回当时可得的 partial 统计；`truncated` 表明 issue 响应被截断。`HEAD 405` 按 reachable 成功处理。
- 外部 request signal abort 时停止启动新 probe，已启动 probe 通过 race 收敛后由 dispatcher 丢弃 response；诊断只读当前 active registry，不改配置、不写 cache、不修改条目。

### npm integrity contract

`src/core/versions.ts` 和 `src/core/npm-integrity.ts`：

```ts
export interface NpmVersionMetadata {
  version: string
  integrity?: string
  tarball?: string
}

export function npmVersion(pkg: string, version: string, timeoutMs?: number, signal?: AbortSignal): Promise<NpmVersionMetadata>
export function readPnpmLockIntegrity(lockText: string, pkg: string, version: string): string | null
export function assertNpmIntegrity(expected: string, actual: string | null, pkg: string, version: string): void
```

- exact version 采用 `^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`；接受 prerelease/build metadata，拒绝 `v1.2.3`、range、tag 和 `1.2.3evil`；lockfileVersion 非 `9.0`、scoped package key 重复或 peer suffix 无法唯一剥离时 fail closed。
- `source: npm` 无论是 latest 还是用户指定 exact version，都先读取**该精确版本**的 dist metadata；integrity 缺失直接拒绝安装。
- `addDshPlugin` 成功后读取 profile `package.json` 和 `pnpm-lock.yaml`，确认 importer dependency 是目标 exact version，并在 lockfile `packages` entry 中找到与 npm metadata 相同的 `resolution.integrity`；找不到或不一致视为失败。
- integrity 失败时使用安装前的 package manifest、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 字节快照；每个快照记录原先是否存在，原先不存在的文件在恢复时删除安装过程中新生成的文件；恢复后执行 `pnpm install --frozen-lockfile`；这定义为 **best-effort dependency rollback**，不声称 node_modules 和间接依赖字节级恢复；恢复失败必须同时报告 integrity failure 与 rollback failure。
- lockfile 解析和快照恢复只使用 Node 内置代码，遇到无法唯一定位 package/version/integrity 时 fail closed，不新增 yaml 运行时依赖。

### Client pure-state contract

`src/client/market-state.js` 产出并由 `main.jsx`/测试消费：

```js
export const MARKET_PAGE_SIZE = 50
export function normalizeMarketQuery(input) { /* returns stable query/category/offset/limit */ }
export function resetPageOnFilterChange(previous, next) { /* returns offset 0 when query/category changes */ }
export function normalizeMarketResponse(raw) { /* returns safe page/counts/registryState */ }
export function registryNotice(summary, total) { /* returns short UI notice data, no path */ }
```

- client 不自行根据 source 字符串推断状态；只消费 Host 返回的 `registryState`/`RegistrySummary`。
- GUI 设置页可以显示完整本地路径；market/tool card 和 agent output 只显示“默认/自定义/缓存/不可用”等短 summary，不显示本地绝对路径。
- `MarketPanel` 是 market/installed 数据唯一 owner；`MarketTab` 只接收 data/loading/error/reload/query props，不再调用 `useAsync` 获取第二份 market 数据。

## 任务清单

### Task 1: Registry 地址与严格 v1 schema

- **目标**：固定所有 custom registry 输入、字段、ID、容量和错误规则，并保持 `LoadedRegistry.registry` 非 nullable。
- **涉及文件**：
  - Modify: `src/core/registry.ts`
  - Modify: `package.json`
  - Create: `tests/registry.test.mjs`
- **接口契约**：
  - Consumes: 现有 `Registry`、`RegistryEntry`、`RegistryConfig`、`CATEGORIES`、`validateRegistry`。
  - Produces: `RegistryAddress`、`RegistrySource`、`RegistryStatus`、`RegistryState`、`RegistrySummary`、非 nullable `LoadedRegistry`、`parseRegistryAddress`、严格 `validateRegistry`；`package.json` 的 `test` script 为 `node --test tests/*.test.mjs`。
- **验证范围**：ID/npm/GitHub/URL 规则、未知字段、source 联动、重复 tag/ID、长度/条目/字节上限、地址分类和错误路径。

#### Step 1: 写失败测试或失败检查

在 `tests/registry.test.mjs` 写 Node `node:test` 用例，覆盖：

- 当前 `registry.json` 通过；
- 空地址、HTTPS URL、loopback HTTP、本地绝对路径、`file://` 和其他协议；
- userinfo、known credential query、URL fragment/file URL host、相对路径和控制字符被拒绝；
- 大写/非法 ID、未知字段、重复 ID/tag、错误 category/source、缺失 source-specific 字段被拒绝；
- npm scoped/unscoped 合法边界、版本/range/URL 形式被拒绝；
- 字段超限、1,000/1,001 条边界，且超限不截断。

同时在 `package.json` 增加 test script。

- Run: `npm run build && node --test tests/registry.test.mjs`
- Expected: 测试失败，当前 validator 会截断字段、接受未知/非法内容，且没有 `parseRegistryAddress` 与新状态 contract。

#### Step 2: 运行并确认当前失败

- Run: `npm run build && node --test tests/registry.test.mjs`
- Expected: 非零退出，失败来自新增测试断言，不是 TypeScript 编译错误。

#### Step 3: 写最小实现

- 在 `src/core/registry.ts` 增加精确常量、允许键集合、严格 npm/GitHub/URL/id/tag 校验、2 MiB/1,000 条限制和 `RegistryState` 类型。
- 将现有 `.slice()` 静默截断改为字段路径错误；保留 `validateRegistry` 返回 `{ ok, errors, registry }`，错误时 `registry` 为 null 仅作为 validator result，不作为 `LoadedRegistry.registry` 类型。
- 实现 `parseRegistryAddress` 的 URL/path normalization 和 cache key；保持 `RegistryConfig` 仍为单字符串。
- 实现 `registrySummary`，只返回 `isDefault/status/stale`。

#### Step 4: 运行并确认通过

- Run: `npm run build && node --test tests/registry.test.mjs`
- Expected: build 成功，所有 contract tests 通过，官方 `registry.json` 被严格 validator 接受。

### Task 2: 统一安全 HTTP、本地 fd 读取与分源 cache

- **目标**：完成 default/custom loader、统一 redirect、fd 级本地读取、版本化原子 cache 和当前 custom cache 保留策略。
- **涉及文件**：
  - Modify: `src/core/registry.ts`
  - Modify: `src/core/httpx.ts`
  - Create: `tests/httpx.test.mjs`
  - Modify: `tests/registry.test.mjs`
- **接口契约**：
  - Consumes: Task 1 的地址/状态/严格 validator。
  - Produces: `loadRegistry`、`loadRegistryCandidate`、`loadDefaultRegistry`、`commitActiveSource`、`CacheFile v2`、`fetchJsonLimitedMeta`/统一安全 fetch；`fetchJsonLimited` 旧返回值保持兼容。
- **验证范围**：default/custom 不同 fallback、URL/file 成功读取、候选 cache 不 prune、同一当前源 stale cache、Host/CLI namespace 隔离、原子写、fd TOCTOU、redirect/signal/UTF-8/body cap。

#### Step 1: 写失败测试或失败检查

扩展 registry tests：

- 合法本地文件通过绝对路径和 `file://` 读取；非法 custom 文件返回空 registry + unavailable，不出现官方条目；
- 合法 custom A 先写入候选 cache，验证 loader 不 prune 旧 source；`commitActiveSource` 后才清理旧 source；
- 切换到 B 后 A cache 在 host namespace 被清理，切回 A 离线返回 unavailable；CLI namespace 的 B 成功读取不得删除 host namespace 的 A cache；
- default 与 custom cache 不串用；旧单文件 cache 和错误 cache 被忽略；cache 目标为 symlink 时拒绝写入；并发进程写同一 cache key 不产生半写 JSON；
- cache 文件写入中断/损坏/权限异常不破坏其他 cache；2 MiB 精确通过、2 MiB+1 拒绝；通过可控 fs fixture 模拟 stat 后文件增长/替换，确认 fd 读取与复核不接受超限内容。

在 `tests/httpx.test.mjs` 启动 loopback server，覆盖 loopback redirect、unsafe HTTP redirect、redirect loop、timeout/signal abort、body cap、非法 UTF-8。

- Run: `npm run build && node --test tests/registry.test.mjs tests/httpx.test.mjs`
- Expected: 当前实现会静默回退官方、使用单一 cache、跟随不安全 redirect，且没有 local file/fd 读取。

#### Step 2: 运行并确认当前失败

- Run: `npm run build && node --test tests/registry.test.mjs tests/httpx.test.mjs`
- Expected: 非零退出，失败点明确落在 fallback/cache/redirect/local read 断言。

#### Step 3: 写最小实现

- 在 `src/core/httpx.ts` 建立一个手动 redirect primitive：`redirect:'manual'`、相对 Location 解析、每跳 `assertSafeUrl`、最多 3 跳、loop detection、`AbortSignal`、最终 URL和统一 body reader；`fetchJsonLimited`、`fetchTextLimited`、`isReachable` 全部复用它。
- 在 `src/core/registry.ts` 实现默认/自定义分离 loader；custom 无数据返回 `{version:1,plugins:[]}` 与 unavailable state，不调用 bundled default。
- 本地文件先 `realpath`，对最终路径用 `open`/`O_NOFOLLOW`，同一个 fd 做 `fstat`、regular-file 判断、分块读取、实时 2 MiB cap、读取后 identity/size 再核验；用 fatal UTF-8 decoder 解析。
- cache 目录 0700、cache 文件 0600；使用 `O_CREAT|O_EXCL|O_NOFOLLOW` 临时文件、写入/flush/fsync/close 后 atomic rename；按 cache key 的 in-process lock 串行写；候选写入不 prune。
- 增加 `commitActiveSource(address, namespace)`：只有 settings update 成功后才在对应 namespace 内写 accepted-source metadata 并清理旧 custom cache；返回 `ActiveSourceCommitResult`，metadata/prune 任一失败只返回 warning，不删除旧 active cache；Host 与 CLI 使用不同 namespace，CLI 不删除 Host cache；candidate/update 失败时不调用该函数。
- cache 读取先检查 cache version/key/source，再重新执行严格 validator；旧 `registry.json` 单文件 cache 不作为新 cache。

#### Step 4: 运行并确认通过

- Run: `npm run build && node --test tests/registry.test.mjs tests/httpx.test.mjs`
- Expected: 本地/远程/缓存/redirect/UTF-8/size 测试全部通过；custom source 不再回退官方清单，cache 写入为原子安全写。

### Task 3: 服务端分页、latest cache 与所有消费者迁移

- **目标**：让 1,000 条 registry 不再触发 1,000 条 latest 网络查询，并同步迁移 market/tools/CLI/installed result contract。
- **涉及文件**：
  - Modify: `src/core/market.ts`
  - Modify: `src/core/versions.ts`
  - Modify: `src/tools.ts`
  - Modify: `src/cli.ts`
  - Create: `tests/market.test.mjs`
- **接口契约**：
  - Consumes: Task 2 的非 nullable `LoadedRegistry`、`RegistryState`、`RegistryRuntimeOptions` 和 safe HTTP signal。
  - Produces: `MarketQuery`、`MarketDeps`、`MarketResult`、`InstalledResult`、带 runtime namespace 的 list/install/upgrade signatures、`mapWithConcurrency`、`RegistrySummary` 消费路径；Host 后续可传 `query/category/offset/limit/withLatest/signal`，并固定 namespace=`host`。
- **验证范围**：服务端过滤/分页、当前页 latest 调用上限、全局 deadline/abort、latest cache、unavailable、CLI exits、工具不泄露路径。

#### Step 1: 写失败测试或失败检查

在 `tests/market.test.mjs`：

- 构造 1,000 条 registry，第一页 limit=50 时 fake latest 调用不超过 50；`withLatest:false` 时为 0；total/categoryCounts 仍反映完整 registry；
- 验证 query/category/offset/limit clamp、结果顺序、页码边界，以及 limit=1000 时 core/API policy 仍只允许 GUI 50；
- 验证 worker pool 最大 in-flight=8，注入 20ms page deadline 后返回 partial result，不等待永不 resolve 的 fake registry/latest probe；
- 验证 latest cache 命中不重复请求；unavailable 不调用 latest；
- 验证 `listInstalledWithMeta` 在 unavailable 时仍列已装插件；
- 验证 dshm_search/list/outdated/install/upgrade Agent tool 路径与 Host GUI 共用 `namespace:'host'`，不读取/写入 `cli/`；
- 验证 CLI search 直接传 query/category/limit 且 withLatest=false、`namespace:'cli'`，不先构造全量 latest。

- Run: `npm run build && node --test tests/market.test.mjs`
- Expected: 当前 `listMarket` 会遍历整份 registry 串行查询，且没有 query/page/latest cache/unavailable contract。

#### Step 2: 运行并确认当前失败

- Run: `npm run build && node --test tests/market.test.mjs`
- Expected: 非零退出，失败来自调用数量、分页或并发断言，而不是编译错误。

#### Step 3: 写最小实现

- 将 `listMarket` 改为先过滤/统计，再 slice 当前页；只对当前页执行 latest；`withLatest:false` 给 dshm_search 使用。
- 增加稳定顺序的 `mapWithConcurrency`，并发上限 8；增加内存 latest cache，使用 `cacheTtlMin` 判断；page 使用全局 60 秒 deadline 和 signal，旧 generation 结果不回写。
- internal deadline 通过每个 probe 的 `Promise.race` 收敛，即使依赖忽略 AbortSignal 也不会永久阻塞；已完成/已生成 item 保留，未完成 item 标为 timeout，外部 signal 触发则抛 AbortError 且不向已关闭 response 写入。
- `listMarket` 返回 `total/offset/limit/categoryCounts/registryState`；unavailable 返回空 items/counts 和 200-friendly state；`installFromRegistry`/`upgradePlugin` 使用相同的 `RegistryRuntimeOptions.namespace` 读取对应 registry/cache，unavailable 时抛出业务错误。
- `listInstalledWithMeta` 返回 `InstalledResult.registryState`，unavailable 时仍返回已装 items，跳过 registry matching；`dshm_search` 使用 `withLatest:false`、`limit≤80` 和 `namespace:'host'`，返回短 `RegistrySummary`；`dshm_list/outdated` 同样携带 summary 并使用 host namespace。
- CLI 保留 `DSHM_REGISTRY_URL`：`registry` 在 unavailable 时打印明确错误、配置/实际生效地址并 exit 1；`search` 直接调用 `listMarket({ query, category, offset: 0, limit, withLatest: false, namespace: 'cli' })`，unavailable 时打印清单不可用并 exit 1，绝不先全量 latest 后 slice；`list` 仍显示已装插件并标记 registry unavailable；`outdated` 在 registry unavailable 时打印状态并 exit 1；install/upgrade 返回业务错误 exit 1。CLI 本地终端可显示完整本地路径，agent/tool output 不显示路径。
- 在 `src/core/versions.ts` 为 npm/GitHub 查询增加可取消 signal；保留安装 pin 语义，integrity 具体校验由 Task 8 完成。
- Host/controller 和所有 dshm_* Agent tools 的 `loadRegistry`/market/list/install/upgrade 固定使用 `namespace: 'host'`；只有独立 CLI 的 registry/search/list/outdated/install/upgrade 使用 `namespace: 'cli'`，不能使用默认共享 namespace 或跨 namespace prune。

#### Step 4: 运行并确认通过

- Run: `npm run build && node --test tests/market.test.mjs`
- Expected: 1,000 条第一页只触发当前页 latest；并发/deadline/cache/unavailable/CLI contract tests 通过。

### Task 4: Registry 条目可达性诊断核心

- **目标**：实现用户主动触发的 probe，不把外部可达性检查混入 schema 应用事务。
- **涉及文件**：
  - Create: `src/core/registry-check.ts`
  - Create: `tests/registry-check.test.mjs`
- **接口契约**：
  - Consumes: Task 2 的统一 safe HTTP 和 Task 1 的 `Registry`；Task 3 的并发/abort 约定。
  - Produces: `RegistryCheckIssue`、`RegistryCheckResult`、`RegistryCheckDeps`、`checkRegistryEntries`；Task 5 Host API 调用该函数。
- **验证范围**：probe 统计定义、稳定顺序、concurrency 输入、deadline、abort、100 issue 截断、405 HEAD。

#### Step 1: 写失败测试或失败检查

使用 fake `RegistryCheckDeps`：

- 分别模拟 npm、GitHub、homepage、icon 成功/失败；断言 `checked/passed/failed` 统计的是 probe 次数；
- 记录最大 in-flight，验证默认/异常 concurrency 均不超过 8；
- 构造超过 100 个 issue，验证仍完成 deadline 内 probe、`issues.length===100`、`truncated===true`；
- 注入永不 resolve 的 fake probe 和短 deadline，验证函数返回 partial 统计而不是永久等待；外部 signal abort 后不启动新的 probe，输入 registry 深度不变；
- 验证 issue 按 registry 顺序和字段顺序稳定。

- Run: `npm run build && node --test tests/registry-check.test.mjs`
- Expected: 测试失败，诊断模块不存在。

#### Step 2: 运行并确认当前失败

- Run: `npm run build && node --test tests/registry-check.test.mjs`
- Expected: 非零退出，失败点为缺失 `checkRegistryEntries` contract。

#### Step 3: 写最小实现

- 使用 worker pool 默认并发 8，NaN/Infinity/≤0 fallback 8，正数 clamp 1–8；统一传 signal/timeout。
- 每个 npm/GitHub/homepage/icon 字段是一个 probe，issue 按条目和字段稳定排序；最多返回 100 issue，统计继续到 deadline 或所有 probe 收敛。
- 使用 Task 2 的 `isReachable`，因此诊断 redirect 与 registry fetch 使用同一协议/loop/body/timeout 安全规则；HEAD 405 视为可达。

#### Step 4: 运行并确认通过

- Run: `npm run build && node --test tests/registry-check.test.mjs`
- Expected: 诊断统计、并发、deadline、abort 和截断测试通过。

### Task 5: Live settings controller、Host API dispatcher 与同源防护

- **目标**：把配置事务、外部 settings 写入、API method、请求防护和 registry query 接线落实到 Host。
- **涉及文件**：
  - Create: `src/core/registry-controller.ts`
  - Create: `src/core/host-api.ts`
  - Modify: `src/host.ts`
  - Create: `tests/registry-controller.test.mjs`
  - Create: `tests/host-api.test.mjs`
- **接口契约**：
  - Consumes: Task 2 loader/cache、Task 3 market query/InstalledResult、Task 4 diagnostic、`trustedRestartRequest`。
  - Produces: `RegistrySettingsStore`、`RegistryController`、`RegistryControllerSnapshot`、`RegistryConfigError`、Host API contract；`MarketPanel`/SettingsTab 后续只调用这些 methods。
- **验证范围**：controller active/configured/rejected、generation fence、settings watch、API 200/400/404/413/422/500、JSON/Origin 防护、market query forwarding、default download、diagnose。

#### Step 1: 写失败测试或失败检查

在 `tests/registry-controller.test.mjs` 使用 fake store 和临时 local registry：

- bootstrap 时 snapshot 等待首次 load；合法 default/custom 初始配置进入 ready，初始 custom 不可达时按 accepted metadata/default 恢复并显示 configStatus；
- 有效 apply 先读取校验，再 update；无效 apply 不 update；空地址恢复 default；candidate B 验证成功但 store.update 失败时 active A、A cache 和 accepted metadata 都保持；
- 模拟 store.update 成功但 accepted metadata 写失败、prune 失败，验证 B active 仍有效、warning 可见、旧 A cache 不被误删，不能谎称完整提交；
- 外部 settings 写入不可达地址不会改变 active config/registry，controller 回滚持久化值，snapshot 显示 configured-but-rejected；模拟重新 attach 后仍能恢复 accepted A，不形成 rollback watch 循环；rejected B 时 loaded 保持 A 的真实 source/status；
- 两个 apply、外部 watch、延迟旧 load 交错时，旧 generation 不得覆盖新 active；
- store update rejection、watch 延迟、dispose 后 watcher 都有明确结果。

在 `tests/host-api.test.mjs` 使用可注入 fake deps/HTTP request metadata：

- registry unavailable 200 + empty plugins；`market` 请求 `limit=1000, withLatest:true` 时实际 latest 调用不超过 50，query/category/offset/limit 规范化并正确转发；config apply success 及 422；default download；diagnose；unknown method 404；malformed JSON 400；body 413；unexpected error 500；
- 所有 GET/非 POST、缺 Content-Type/非 JSON、空 body、null/array 顶层、缺 method 的请求拒绝；ping 只接受 POST JSON 但可无 Origin；其他 POST（包括 registry/market force、default-download、diagnose、config-apply 和 plugin mutations）缺 Origin、Origin/Host 不等价时拒绝；覆盖 scheme、显式/默认端口、Host 缺失、多值 header、x-forwarded-host 以及代理覆盖假设；合法同源 JSON 才进入 dispatcher。

- Run: `npm run build && node --test tests/registry-controller.test.mjs tests/host-api.test.mjs`
- Expected: 测试失败，controller/dispatcher 文件不存在，当前 Host 也不能处理新 method 或安全边界。

#### Step 2: 运行并确认当前失败

- Run: `npm run build && node --test tests/registry-controller.test.mjs tests/host-api.test.mjs`
- Expected: 非零退出，失败清楚指向缺失 controller/API contract。

#### Step 3: 写最小实现

- 创建 `registry-controller.ts`：维护 active config object、active loaded registry、configured/pending address、config phase、generation 和 promise queue；`attachStore` 通过 watch 入队，禁止裸 `Object.assign`；旧结果 generation 不匹配时丢弃；`dispose` 停止提交。
- bootstrap 首次以 `store.get()` 为配置来源；snapshot/API 在首次 ready 或 rejected/unavailable 结果确定前等待 bootstrap；启动时使用 `cacheDir()/host/active-source.json` 的 accepted metadata 恢复上次 accepted address，恢复动作带抑制标记避免 rollback watch 循环；rejected 只保存当前进程错误。
- `apply` 先 force load candidate，ready/stale 才 update store；成功后先原子替换 active config 与 snapshot，再调用 `commitActiveSource`（写 accepted metadata、prune），按返回结果显示 warning；失败抛 `RegistryConfigError` 并保持 active/cache/metadata。
- `src/host.ts` 的 settings registration 使用 `applies: 'live'`；适配 Host `SettingsScope.get/update/watch`，把同一 active config object 传给 tools/API；外部 settings invalid 回滚持久化值并形成独立 configStatus，而不是污染 loaded 的真实 source/status。
- 将 `/dshm` method 路由提取到 `src/core/host-api.ts` 的可注入 dispatcher；`handleApi` 负责严格读取 body、Content-Type、Origin/Host guard、AbortController 和 HTTP response；除 `ping` 外所有 POST 都复用 `trustedRestartRequest` host-equivalence guard，并测试 scheme、显式/默认端口、Host 缺失、多值 header、x-forwarded-host 和代理覆盖假设。
- `registry-config-apply` 成功后返回完整 `RegistryControllerSnapshot`；失败专门返回 422；`registry`/`market`/`installed` 先 await `controller.ensureReady()` 再读取 active config；`registry`/`market` 返回 Task 3 的 page/state；`registry-default-download` 调用 `loadDefault({force:true})`；`registry-diagnose` 传 request signal；market API 转发 query/category/offset/limit，忽略客户端 `withLatest` 并强制 GUI policy 为 `withLatest:true`、limit 1..50；所有 Host API 与 dshm_* Agent tool core 调用显式传 `namespace:'host'`，只有独立 CLI core 调用显式传 `namespace:'cli'`。
- 把 `registryUrl` schema 描述改为“空值使用默认；支持 HTTPS URL 或本地绝对路径”；不要新增用户可见 settings 配置文件，accepted metadata 仅为受限 host cache 状态文件。

#### Step 4: 运行并确认通过

- Run: `npm run build && node --test tests/registry-controller.test.mjs tests/host-api.test.mjs`
- Expected: controller/API tests通过；protected methods 在无同源 JSON guard 时拒绝；Host bundle 生成新 dispatcher 和新 registry methods。

### Task 6: 设置页配置、下载、诊断与状态反馈

- **目标**：在「插件市场 → 设置」完成地址草稿、校验应用、恢复默认、下载默认文件、可达性诊断和错误反馈。
- **涉及文件**：
  - Modify: `src/client/main.jsx`
- **接口契约**：
  - Consumes: Task 5 的 `registry-config`、`registry-config-apply`、`registry-default-download`、`registry-diagnose`；Task 3 的 `RegistryState`；现有 `api()`/i18n。
  - Produces: SettingsTab controls、`onRegistryChanged` 回调、registry 配置不触发 restart banner 的通知路径。
- **验证范围**：默认/自定义地址、active/configured/rejected 状态、下载不切换、校验失败不写入、诊断结果、完整路径只在设置页显示。

#### Step 1: 写失败检查

当前 client 设置页没有配置 API/地址输入/诊断操作。运行：

```sh
if grep -q 'registry-config-apply' src/client/main.jsx; then exit 0; else exit 1; fi
```

- Expected: 状态 1；`npm run build` 仍可成功，说明缺少的是 UI/API 接入而不是构建故障。

#### Step 2: 运行并确认当前缺失

- Run: `npm run build`
- Expected: build 成功但源码不包含新配置 method，作为改动前缺失信号。

#### Step 3: 写最小实现

- 增加 ZH/EN 文案：Registry 地址、当前生效地址、默认标识、校验并应用、下载默认、恢复默认、缓存行动提示、自定义源信任提示、诊断结果和字段错误。
- `SettingsTab` 加载 `registry-config`，维护 `draftAddress/applying/downloading/diagnosing/applyError/diagnosticResult`；初始 draft 来自 configuredAddress，apply 失败不覆盖 active state。
- “校验并应用”调用 `registry-config-apply`；成功后调用 `onRegistryChanged` 让父层强制 reload market/installed；失败保留 draft、不写 invalid config、不产生安装类 restart banner。
- “恢复默认”以空地址走同一 apply 事务；“下载默认 registry.json”调用 `registry-default-download`，Blob 下载 UTF-8 格式化 JSON，文件名 `registry.json`，不改变当前配置。
- “检查条目可达性”调用 `registry-diagnose`，显示 checked/passed/failed、最多 100 issue、truncated；取消/关闭页面时 abort，不改配置/cache。
- 设置页同时显示 configured address、active config address、当前生效地址和状态；default/cache/fallback 通过明确 label 展示；完整本地路径只在此处显示；`warnings` 以维护告警展示，不把部分 cache commit 当成配置失败。
- 将 `MarketPanel.notify` 扩展 `needsRestart`；registry settings/refresh/diagnose 只 toast，install/uninstall/upgrade/self-upgrade 保持原重启 banner。

#### Step 4: 运行并确认通过

- Run: `npm run build && npm run typecheck`
- Expected: `npm run build` 的 Host TypeScript 与 esbuild client bundle 通过，`npm run typecheck` 只验证 `src/**/*.ts`；bundle 包含新 API 字符串和 settings controls，不将 typecheck 解释为 JSX 类型检查。
- Runtime acceptance: 延迟到 Task 10 的 Host 部署重启后执行；本任务不要求 F5 调用尚未加载的新 Host methods。

### Task 7: MarketPanel 唯一数据 owner、服务端分页和工具卡片状态

- **目标**：让市场 UI 消费服务端 page，解决父子重复 fetch，并显示分页、完整计数、性能和自定义源提示。
- **涉及文件**：
  - Create: `src/client/market-state.js`
  - Modify: `src/client/main.jsx`
  - Create: `tests/client-market-state.test.mjs`
- **接口契约**：
  - Consumes: Task 3 的 `MarketResult`/`RegistrySummary`，Task 5 的 market API，Task 6 的 `onRegistryChanged`。
  - Produces: `MARKET_PAGE_SIZE=50`、纯 state functions、MarketPanel 唯一 data owner、query generation/AbortController、market/tool notices。
- **验证范围**：page/filter reset、旧请求丢弃、父子数据一致、categoryCounts/total、custom/stale/unavailable notice、路径隐私。

#### Step 1: 写失败测试或失败检查

在 `tests/client-market-state.test.mjs` 覆盖：

- `normalizeMarketQuery` 固定 limit=50、offset clamp；query/category 变化将 offset 置零；
- `normalizeMarketResponse` 对缺失/错误字段给出安全空页；
- `registryNotice` 只返回短状态，不包含 configured/active 路径；
- 旧 response generation 不得替换新状态。

运行：

```sh
if grep -q 'MARKET_PAGE_SIZE' src/client/market-state.js; then exit 0; else exit 1; fi
```

- Expected: 状态 1，且 `tests/client-market-state.test.mjs` 尚不存在。

#### Step 2: 运行并确认当前缺失

- Run: `npm run build`
- Expected: build 成功但 client 没有 `MARKET_PAGE_SIZE` 或唯一 owner 的 page state。

#### Step 3: 写最小实现

- 创建纯 `market-state.js`，实现 query normalize、page reset、response narrowing、short notice；Node tests 直接 import 该文件，不依赖 DOM/React。
- `MarketPanel` 维护 market query、market data、loading/error、request generation 和 AbortController；调用 `/dshm method:'market'` 时传 query/category/offset/limit/force。
- `MarketTab` 删除内部 `useAsync`，只消费父层 data/loading/error/reload/query callbacks；搜索/category/page 改变只触发父层请求；父层 counts 使用 server `total`，不再用当前页长度。
- 应用 registry 配置后按顺序 reload market page，再 reload installed，更新 count/notice；旧请求 result generation 不得覆盖新 registry。
- 增加每页 50 条分页控件；超过 200 条显示性能提示；custom/stale/unavailable/default notice 使用 `RegistrySummary`；ToolCardRow/SearchToolView 只显示短 summary，不显示本地路径或未脱敏错误。
- 保留既有 README markdown 预览、详情外链和详情分隔线，不进行无关 UI 重构。

#### Step 4: 运行并确认通过

- Run: `npm run build && npm run typecheck && node --test tests/client-market-state.test.mjs && git diff --check`
- Expected: Host TypeScript build/typecheck、esbuild bundle 和 pure state tests 通过；父子只存在一个 market data fetch owner，JS client 逻辑由 pure state tests 和运行时验收覆盖。
- Runtime acceptance: 延迟到 Task 10 的 Host 部署重启后执行；本任务只验证纯状态模块、bundle 和唯一 owner 代码，不在旧 Host 进程上调用新分页 API。

### Task 8: npm exact metadata、pnpm lock integrity 与失败回滚

- **目标**：把设计文档中承诺的 npm integrity 变成实际安装后的 fail-closed 校验。
- **涉及文件**：
  - Create: `src/core/npm-integrity.ts`
  - Create: `tests/npm-integrity.test.mjs`
  - Modify: `src/core/versions.ts`
  - Modify: `src/core/market.ts`
- **接口契约**：
  - Consumes: Task 3 的 install flow、Task 2 的 safe HTTP、`addDshPlugin/removeDshPlugin`。
  - Produces: `npmVersion` exact metadata、`readPnpmLockIntegrity`、`assertNpmIntegrity`；npm install result only after package/version/lock integrity all match。
- **验证范围**：latest/exact version metadata、scoped package、lock fixture、missing/mismatch integrity、rollback success/failure。

#### Step 1: 写失败测试或失败检查

在 `tests/npm-integrity.test.mjs`：

- exact version metadata fixture 返回 dist integrity；missing integrity rejects；`1.2.3-rc.1` 和 `1.2.3+build.1` 按规则处理，`v1.2.3`、range、tag、`1.2.3evil` rejects；
- lockfileVersion 非 `9.0`、unscoped/scoped package/version key 重复、peer suffix 无法唯一剥离时 fail closed；合法 fixture 能定位 `resolution.integrity`；
- fake install 的 profile package/lock/workspace manifest 或 integrity mismatch triggers best-effort snapshot restore；每个快照记录“原先存在/不存在”，恢复时删除安装过程中新生成的原不存在文件；rollback failure reports both errors；覆盖原 dependency 为 range/link/file 和 hoist retry；
- user-specified exact version queries that exact version endpoint，不使用 `/latest`。

- Run: `npm run build && node --test tests/npm-integrity.test.mjs`
- Expected: 测试失败，当前 market 只核对 profile package name，不读取 pnpm lock integrity，也没有 exact version metadata API。

#### Step 2: 运行并确认当前失败

- Run: `npm run build && node --test tests/npm-integrity.test.mjs`
- Expected: 非零退出，失败来自 integrity/rollback assertions。

#### Step 3: 写最小实现

- `versions.ts` 增加 `npmVersion(pkg, version, timeoutMs, signal)`，严格验证 package/version，读取 exact metadata；latest flow 也保留 expected integrity。
- `npm-integrity.ts` 使用 Node 内置字符串解析，fail closed 地读取 pnpm lockfile v9 package entry；验证 importer exact version 与 `resolution.integrity`。
- `market.ts installEntry` 在 add 前保存 profile `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`（存在时）的字节快照；add 后读取 package.json/lockfile，比较 expected dist integrity；成功才返回 InstallResult。
- mismatch/missing 时执行 best-effort rollback：原子恢复 manifest/lock/workspace 快照，再运行 `pnpm install --frozen-lockfile`；若原来没有目标包且恢复安装失败，才尝试 remove；rollback 失败在 error 中同时列出 integrity failure 与 rollback failure，明确提示 profile 可能需要人工修复，不能返回成功结果。
- 不改变 GitHub SHA pin、build-script explicit report、profile package.json 唯一事实源和重启提示；不声称 node_modules 或间接依赖已完成字节级回滚。

#### Step 4: 运行并确认通过

- Run: `npm run build && node --test tests/npm-integrity.test.mjs tests/market.test.mjs`
- Expected: exact metadata、lock integrity、rollback 和既有 market flow tests 全部通过。

### Task 9: 双语文档、设计记录、CI trigger 与打包预期

- **目标**：让设计/README/CI 与最终实现一致，并修复实际 npm 包结构的验收描述。
- **涉及文件**：
  - Modify: `DESIGN.md`
  - Modify: `README.md`
  - Modify: `README.en.md`
  - Modify: `.github/workflows/registry.yml`
  - Modify: `scripts/build.mjs`
  - Create: `scripts/assert-pack.mjs`
- **接口契约**：
  - Consumes: Task 1–8 的最终 API、schema、限制、缓存、分页、integrity 和安全语义；现有 `scripts/validate-registry.mjs`。
  - Produces: 可执行的双语用户说明、准确的设计记录、core/schema/test 变更触发的 registry CI。
- **验证范围**：文档语义、英文同步、CI path、`npm pack --dry-run` 中实际的 `lib/cli.js`。

#### Step 1: 写失败检查

分别检查中英文最终流程尚不存在：

```sh
if grep -q '下载默认 registry' README.md; then exit 0; else exit 1; fi
if grep -qi 'download.*default.*registry' README.en.md; then exit 0; else exit 1; fi
if grep -q "'src/**'" .github/workflows/registry.yml && test -f scripts/assert-pack.mjs; then exit 0; else exit 1; fi
```

- Expected: 三条都以状态 1 退出，确认中英文用户流程、全路径 CI 和 pack 断言尚未完整写入。

#### Step 2: 运行并确认当前文档/CI 缺口

- Run: `git diff --check`
- Expected: `git diff --check` 通过；Task 9 的文档、workflow 和 pack 断言仍缺失，未因前置检查失败而掩盖格式问题。

#### Step 3: 写最小实现

- 更新 `DESIGN.md` §2.1/§2.2：单地址 default/custom override、下载 fork、严格规则、2 MiB/1,000 条、当前 custom cache 取舍、candidate/commit prune、accepted metadata、fd/atomic cache、统一 HTTP；更新 §4：设置 UI、server page、唯一 owner、诊断和 Host restart boundary；更新 §5：CLI unavailable 退出码、短 summary、exact semver/integrity/best-effort rollback；更新 §9 决策记录。
- 更新 `README.md`/`README.en.md`：地址自动识别、下载默认 registry 后自行编辑、校验并应用、配置/实际生效地址、默认标识、缓存行动提示、容量和性能、诊断、来源信任、公开 HTTPS/本地文件安全边界；英文分别检查，不只用中文 grep；保留用户既有中文 README 手动改动。
- 修改 `.github/workflows/registry.yml` 的 push/pull_request paths 为 `registry.json`、`src/**`、`tests/**`、`scripts/**`、`package.json`、`package-lock.json` 和 workflow；CI 在 build 后执行 `npm test` 与官方 validator。
- 修改 `scripts/build.mjs` 的 sanity marker，加入 `lib/cli.js`；创建 `scripts/assert-pack.mjs`，读取 `npm pack --dry-run --json` 并机器断言 `lib/host.js`、`lib/client.js`、`lib/cli.js`、`registry.json`、双语 README 存在；不要求不存在的 `bin/` 目录。

#### Step 4: 运行并确认通过

- Run: `git diff --check && npm run build && npm run typecheck && npm test && npm pack --dry-run --json | node scripts/assert-pack.mjs`
- Expected: 文档/CI diff 无格式错误，构建、TypeScript、Node tests 和 pack 文件断言全通过；中英文 custom registry 语义一致。

### Task 10: 全量验证、用户确认后的 Host 重启与运行时验收

- **目标**：完成自动验证后，区分“部署新 Host 代码需要一次重启”和“之后切换 registry live 不需重启”。
- **涉及文件**：
  - Test: `tests/*.test.mjs`
  - Verify: `lib/host.js`、`lib/client.js`、`lib/cli.js`、`registry.json`
  - Runtime: 当前 DSH Web `http://127.0.0.1:3080`
- **接口契约**：
  - Consumes: Task 1–9 全部产物；当前 profile 的 `dsh-m` link 指向 `/home/ubuntu/workspace/dsh-m`。
  - Produces: 自动验证结果、用户确认后的单次 Host 部署重启结果和浏览器验收记录；不自动 push、不自动发布 npm。
- **验证范围**：schema、loader/cache、HTTP、controller/API、diagnose、market page、integrity、CLI、CI、pack、live settings 和已有 README/详情 UI 回归。

#### Step 1: 写改动前/最终收口检查

确认环境和 profile：

```sh
npm --version
node --version
grep '"dsh-m"' ~/.dsh/profiles/web/package.json
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080
```

- Expected: Node 满足 `>=22`；profile 显示 `link:/home/ubuntu/workspace/dsh-m`；现有 DSH Web 返回 `200`。profile 不是 link 时停止运行时验收，不自动修改 profile。

#### Step 2: 运行全量自动验证

在当前仓库 shell 环境执行：

```sh
npm run build
npm run typecheck
npm test
node scripts/validate-registry.mjs
npm pack --dry-run --json | node scripts/assert-pack.mjs
git diff --check
```

- Expected: `lib/host.js`、`lib/client.js`、`lib/cli.js` 生成；所有 Node tests 通过；官方 registry schema/npm/GitHub/homepage 校验通过；pack dry-run 包含实际运行时文件；diff check 无输出。GitHub 匿名限额导致的 validator 失败单独记录并用 CI token 重跑，不跳过 schema/tests。

#### Step 3: 用户确认后的 Host 部署 checkpoint

此处必须停下向用户请求一次重启许可：

1. 说明 Task 5 修改了 Host API，当前运行进程仍可能是旧 `lib/host.js`；
2. 获得用户明确同意后，只调用现有 `dshm_restart`/systemd shim 路径；不创建第二个 3080 监听；
3. 轮询 `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080`，直到恢复 `200`；
4. 再让用户刷新页面，验证新 Host methods 已可用。

- Expected: 新 Host 代码部署完成；重启只发生一次且经过用户确认；之后的 registry 地址 apply 不触发重启。

#### Step 4: 运行浏览器与 CLI 验收矩阵

在重启恢复后逐项验证：

1. 设置页显示配置地址与当前生效地址；默认源带“（默认）”，cache/fallback/rejected 状态清楚；
2. 下载默认 registry 得到合法 UTF-8 `registry.json`，下载不改变当前市场；
3. 编辑本地副本、填绝对路径并应用，市场整体切换为 custom；设置成功不要求重启；
4. 同一路径文件外部修改后普通读取遵循 TTL，强制刷新读取变更；
5. schema 错误、路径不存在、1,001 条、2 MiB+1、unsafe URL 均不保存配置，当前 active registry 保持；错误含字段路径且不泄露凭据；
6. 恢复默认回到官方 default；
7. 51+ 条分页，201+ 条性能提示，1,000 条第一页 latest probe 不超过当前页；
8. custom 源显示未经过官方 CI 的信任提示，工具卡片只显示短 summary；
9. 诊断显示 probe 统计/issue 截断，不改变配置/cache；
10. `dshm registry`/`search` unavailable 退出码和错误正确，`list` 可列已装插件；
11. npm 安装/升级的 exact version、lock integrity mismatch rollback、GitHub SHA pin 和原有 build-script report 不回归；
12. README markdown、详情外链、详情分隔线、安装/卸载/升级/重启 UI 不回归。

- Expected: 所有场景符合已批准设计；registry 配置操作没有安装类 restart banner；安装/卸载/升级仍按原约定提示重启。

## 执行纪律

- 开始实现前，先批判性复查本计划；发现接口、命名、缓存语义、HTTP contract 或验证命令与仓库现实不符时，先修订计划，不猜实现。
- 按 Task 1 至 Task 10 顺序执行，不静默跳步、合并步骤或改变任务目标。
- 每完成一个任务，必须运行该任务 Step 4 的验证；失败时停止并报告具体输出。
- 在当前 `main` 分支实现前再次确认用户是否允许在当前分支工作；不自行创建发布 commit、push 或 npm release。
- 不修改用户已有的未提交 README 手动内容，不使用 reset、checkout 或整文件覆盖来消除差异。
- 遇到 settings API、文件权限、profile 状态、网络限额、lockfile 格式或 CI 行为与计划不符时，立即停下来说明，不用旁路行为掩盖问题。
- 不创建新的 3080 监听服务，不修改 systemd shim；Host 部署重启必须经过用户明确确认并走现有路径。
- 除 `ping` 外所有 HTTP POST method 必须保留 JSON Content-Type 与同源 host-equivalence guard；不得为了测试绕过安全检查。
- 全部任务完成后，运行 Task 10 的全量验证并输出修改摘要；本计划不包含自动 push、发版或未经确认的重启。

## 最终验证

在依赖已经安装且当前 shell 能访问 DSH profile 的前提下运行：

```sh
npm run build
npm run typecheck
npm test
node scripts/validate-registry.mjs
npm pack --dry-run --json | node scripts/assert-pack.mjs
git diff --check
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080
```

预期结果：

- TypeScript、esbuild 和 bundle marker 检查全部通过；
- Node 内置测试覆盖 schema、地址、local/remote loader、fd/TOCTOU、atomic cache、redirect、controller、Host API guard、诊断、market page/latest concurrency、client pure state 和 npm integrity，全部通过；
- 官方 registry schema 与外部存在性检查通过；
- npm dry-run 包含 `lib/host.js`、`lib/client.js`、`lib/cli.js`、`registry.json` 和双语文档；
- 工作区差异无 whitespace 错误；
- 用户确认重启后 DSH Web 返回 HTTP 200，新 Host methods 可用；
- registry 配置保存后可 live 切换，安装类变更仍保留重启语义。

## 审阅 Checkpoint

实施计划已根据评审报告修订并完成 inline 自检。请先审阅并确认这份计划；确认后再由普通编码 agent 或人工执行者按 Task 1–10 开始实现。