# dsh-m v1 设计共识（grilling 定稿）

> 2026-09-04 与 owner 三轮对齐的完整共识。实现以本文档为准；与本文冲突的实现细节以本文档为准。

## 1. 定位与形态

- **dsh-m** = 个人自用的 DSH（DeepSeek Harness）插件市场。
- 形态：**一个 DSH web 插件**（旗舰是 Web GUI）+ **7 个 agent 工具** + **薄 CLI `dshm`**，全部在同一个 npm 包里，不搞 monorepo。
- npm 包名 `dsh-m`（已占位发布 0.0.x），插件 id `dsh-m`，显示名 **DSH Marketplace**。
- 管理对象：**只管 DSH 插件**，不管 Agent Skills（skills 归 skillhub）。
- 与 `@cocofhu/skillhub` **完全独立并存**：不读不写它的数据与配置，仅在实现机制上借鉴（其源码镜像见 §10）。
- 单机自用：无服务端、无账号、无提交入口；收录变更 = 改本仓库的 registry（他人可发 PR）。

## 2. Registry（收录清单）

### 2.1 载体与分发（v1.1 可自定义 registry 定稿）
- repo 内**单文件 `registry.json`**，手工 curated，版本号**不写死**（运行时实查 npm/GitHub）。
- **默认源**获取顺序：raw.githubusercontent `@main` → jsDelivr `@main` → 默认 TTL 缓存 → npm 包内快照兜底。jsDelivr 是 GitHub 内容的免费 CDN 镜像，仅作 raw 拉取失败时的**备用线路**（覆盖大陆可达性与 GitHub 故障；CDN 缓存可能滞后数小时，可用 purge.jsdelivr.net 手动清理）。收录更新与插件发版**解耦**。
- **自定义覆盖源（单一地址，整体覆盖，不合并）**：`registryUrl` 为空 = 官方默认清单；非空 = 一个 HTTPS URL（或 loopback HTTP，仅本机管理员信任边界，不承诺 DNS rebinding 防护）或 DSH Web 主机上的本地普通文件（绝对路径 / `file://`，`realpath` + `O_NOFOLLOW` 同 fd 读取与复核，严格 UTF-8，2 MiB 原始字节上限）。自定义源失败只回退**该源自己的缓存**，绝不静默改用官方清单；无可缓存数据时返回空清单 + 不可用状态。
- **「新增插件」流程**：设置页下载默认 `registry.json` → 用户自行编辑副本 → 填入副本地址「校验并应用」。副本是独立快照，不自动同步官方新条目。
- **严格 v1 schema**：顶层只允许 `version/plugins`，条目只允许 `id/name/description/category/tags/source/npm/github/homepage/icon`；未知字段、非法 ID/npm/GitHub/URL、重复 ID/tag、字段超限、`plugins` 超过 1,000 条均拒绝整份清单（不截断、不部分加载）；超过 200 条提示性能边界。
- **缓存模型**：cache 按 namespace 分目录（Host 与 Agent tools 用 `host/`，独立 CLI 用 `cli/`，互不删除），按带算法版本的 cacheKey 分文件（`CacheFile v2`：原子临时文件 + fsync + rename，0700/0600，symlink 拒写，同 key 进程内写锁）。**候选验证只写候选 cache，绝不 prune 旧源**；settings 写入成功后才 `commitActiveSource`：先原子写 accepted-source metadata（`host/active-source.json`，仅 Host），再清理非当前 custom cache；metadata 失败不 prune、prune 失败保留旧 cache，均只降级为 warning，不撤销已生效的配置。切换后只保留默认缓存与当前 custom 缓存。
- **统一安全 HTTP**：所有 JSON/text/HEAD 请求共享同一 primitive——手动重定向（每跳校验协议、最多 3 跳、循环检测、signal 传播、返回最终 URL）+ 响应大小上限 + 超时。
- **live 语义**：registry 地址是 live 设置，应用成功即时生效（无需重启）；只有**首次部署新 Host 代码**需要一次用户确认后的 DSH Web 重启。`timeoutMs`/`cacheTtlMin` 亦为 live 读取；agent 框架注册时的静态工具 deadline 不承诺热更新。

### 2.2 Schema（v1 定稿，严格校验）

规则补充（与 `scripts/validate-registry.mjs`、`tests/registry.test.mjs` 同源实现）：
- `id`：小写字母/数字开头，仅小写字母、数字、`.`、`_`、`-`，≤64 字符且清单内唯一；
- `name` ≤100、`description` ≤500、`tags` ≤10 个且单个 ≤30 字符、tag 不重复；超限拒绝，不截断；
- npm 包名：标准 scoped/unscoped 形状（≤214 字符，不接受版本/range/URL/空白）；GitHub：`owner/repo`（owner ≤39、repo ≤100）；
- `homepage`/`icon`：HTTPS、≤2,048 字符、无 userinfo；
- registry 地址规范化：trim 外层空白、拒控制字符与 userinfo、去 fragment 留 query、拒绝已知凭据 query key（`token`/`access_token`/`api_key`/`password`/`secret`）。
```jsonc
{
  "version": 1,
  "plugins": [
    {
      "id": "dsh-skins",              // slug，唯一
      "name": "DSH Skins",
      "description": "中文描述",        // v1 只有中文
      "category": "ui",               // market|tools|ui|search|other 五选一
      "tags": ["主题"],
      "source": "github",             // npm|github
      "npm": "可选；source=npm 时必填",
      "github": "owner/repo",         // source=github 时必填；npm 条目也可附
      "homepage": "https://...",
      "icon": "可选；覆盖自动头像"
    }
  ]
}
```

### 2.3 CI 校验（`.github/workflows/registry.yml`）
`registry.json`、`src/**`、`tests/**`、`scripts/**`、`package.json`、lockfile 或 workflow 本身变更时触发：
1. `npm run build`（TypeScript + esbuild + bundle marker，含 `lib/cli.js`）；
2. `npm test`（Node 内置 test runner 全量契约测试）；
3. schema 合法（复用 `lib/core/registry.js` 的严格 `validateRegistry`，与运行时同一套规则）；
4. npm 条目可查；GitHub 条目 repo 存在；`icon`/`homepage` URL 可达（icon 允许为空）。
自定义 registry 不经过官方 CI——设置页对自定义源展示未校验信任提示。

### 2.4 收录文案（registry-copy-guide 定稿）
`description`/`tags` 的写法另见 [`docs/registry-copy-guide.md`](./registry-copy-guide.md)：全条 ≤60 全角当量（对齐卡片收起态两行截断）、统一前置/依赖/兼容三种句式、依赖关系不入 tags。CI 对文案超限打软警告不阻断（§2.3 第 4 步之后追加）。

### 2.5 社区清单与合并市场（0.5.0 grilling 定稿 2026-09-28）

- **双层模型**：主清单（§2.1–2.4 全部语义不变）之上叠加只读的**社区清单**——awesome-dsh-plugin 维护的全量社区目录（4,377+ 条，日增约 62）。**合并市场 = 主清单 ∪ 社区清单去重（主清单恒优先）**，GUI / agent 工具 / CLI 三端同源同语义。本节修订 §9.1 Q25「不做运行时多源合并」，架构决策见 [ADR-0003](./adr/0003-community-catalog-merge.md)。
- **数据锚定 npm 包（Q39）**：`dsh-plugin-catalog`（CC0-1.0，版本 `YYYY.MDD.RUN`）为唯一数据锚。获取链：`registry.npmjs.org` dist-tags 探测最新版本（几 KB）→ **版本未变不重拉正文（版本号即 revalidate 验证器）**→ jsDelivr 按精确版本直取 `plugins.json`（版本 pin 后内容不可变，CDN 缓存无害）→ npmmirror files API → unpkg 按精确版本直取（末位兜底；均为纯 JSON 文件线路，不引入 tar 解包依赖）。npm 精确版本不可变 = 完整性锚；**不做包内快照兜底**（对日增 62 条的目录，过期数据不得冒充最新——陈旧必须显式标注），失败如实报错（发生了什么 / 为什么 / 现在怎么办）。
- **目录适配层**：原生条目 → 收录条目。`description.zh`（缺省回退 `en`；>500 字符截断并计数）→ description；`npm` 非空 → `source: npm`，否则 `source: github`（owner/repo 取自 url）；`url` → homepage；tags 置空；**分类保留原生值不转译**（开放集，Q40）；`stars/downloads/capabilities/screenshots` 等不进收录条目本体，仅在市场层作为旁路数据透传展示。id 合成：原生 `name` 是裸名（实测 4,377 条中 190 个重名），合成小写 `owner--name` 形态并满足 v1 id 规则（非法字符折叠为 `-`，超 64 字符截断加哈希尾缀），适配层内冲突追加序号。
- **校验语义（Q43）**：社区清单独立校验——容器层严格（顶层键白名单、`plugins` 数组、32 MiB / 30,000 条上限，超限**整份拒收**）+ 条目层宽松（单条不合格**跳过 + 计数**，汇入 warnings，不整份拒绝）。主清单严格校验（§2.2）不变。**无 npm 的 monorepo 子包条目跳过并计数**（repo 根不是正确安装目标）；有 npm 的子包条目按 npm 安装、正常收录；tarball-only 条目按 github 源收录（dsh-m 不安装 tarball）。
- **分类（Q40）**：精选分类（5 个，主清单 schema 不变）∪ 社区分类（开放集）。已知 20 个社区分类带中文标签进筛选栏「社区」组；`ui`/`tools`/`market` 三 id 与精选同名、共享过滤桶；上游新增的未知分类原样渲染进「社区·新分类」临时组，发版收录标签。
- **降级语义（Q42）**：主清单 unavailable + 社区可用 → 显示社区条目 + 顶部错误横幅 + 安装不禁用；社区 unavailable → 主清单照常 + 静默 notice；探测失败时回落 `<ns>/awesome/` **运行时缓存**并显式标注 stale（市场页可见「缓存快照」提示，绝不冒充 ready）——运行时缓存语义与主清单自定义源一致，被禁止的只是**包内快照**；社区**绝不**回退主清单伪装。
- **开关与缓存**：`communityCatalog`（默认 true，volatile live 生效）+ `communityCatalogPin`（可选锁 npm 版本）；CLI 用 `DSHM_COMMUNITY_CATALOG=0` 退出。社区缓存放 `<namespace>/awesome/` 子目录（不参与 `pruneCaches` 的顶层 `*.json` 清理），正文按版本文件缓存，`fetchedAt`/版本号/线路进设置页展示；TTL 复用 `cacheTtlMin`（只约束 dist-tags 探测频率）。
- **市场行为（Q45/Q46）**：默认排序主清单置顶（组内维持原顺序）+ 社区按 30 天下载量降序（无数据按名称）；搜索同时匹配中英文描述；「只看主清单」chip 常驻筛选栏首位。**探测边界**：市场浏览页对社区 npm 条目做 latest 探测（registry 无配额限制）；社区 github 条目**不做**浏览页 REST 探测（GitHub 匿名 60 次/小时在 50 条/页 × 2 调用下不可控），更新检查收敛到详情/安装时的按需解析——配额耗尽时已有可读提示（versions.ts `githubRateLimitMessage`）。**已装页豁免**：探测对象受已装数量天然约束，继续探测；计量在**真实 GitHub HTTP 请求层**（一次 `githubLatestTag` ≈ 1–3 个请求：release 路径 1–2 个、fallback 路径 releases→tags→commits 最多 3 个）：单请求 ≤25 次、宿主进程滚动 1 小时 ≤50 次（**仅作用于被动探测**——用户主动 install/upgrade/诊断不经此预算）、同仓库 in-flight single-flight、超限标 `latestError` 不阻塞列表——否则用户装的社区 github 插件永远没有更新徽标。独立 CLI 进程不共享宿主内预算，文档如实标注 best-effort（并发场景不承诺 60/h 绝不耗尽）。能力披露（capabilities/红线）只在详情折叠区展示（缺省 = 未扫描 ≠ 未检出），卡片不打标（Q44，防警告疲劳）；截图仅详情层加载（GitHub 图床白名单由上游保证）。

## 3. 安装 / 卸载 / 升级 / 重启

底层原语（本机实证）：`dsh plugin --profile web add|remove|update`（转发 pnpm，作用于 `$DSH_HOME/profiles/web`）。**profile 的 `package.json` 就是唯一事实源**——不引入任何额外状态文件。

### 3.1 Profile 变更事务（`src/core/profile-transaction.ts`，2026-09-07 重构）

npm 安装 / GitHub 安装 / 升级 / 自升级 / 卸载是**同一个事务模块的四个入口**（自升级 = `install-npm` + 自身包名）。编排层（market.ts / host-api.ts / tools.ts / cli.ts）只做「版本/收录条目解析（事务外）→ 开事务 → 包装结果」，互斥锁收编在模块内部（模块级 FIFO，进程内串行）。

- **两阶段不变量（失败保证）**：变更失败时，①先把三个关键文件（package.json / pnpm-lock.yaml / pnpm-workspace.yaml）**逐字节还原到变更前快照**，还原后立即重读比对验证（`snapshotRestoreVerified` 报告此历史事实）；②再跑 frozen 收敛阶梯处理依赖一致性——阶梯中的 overrides 对齐 / `--no-frozen-lockfile` 重建允许对 manifest/lockfile 做**有记录的**受控改写（`healActions`）。失败终态承诺「**一致**」（`status='rolled-back'`）不必然「等同」；收敛耗尽则 `status='manual-repair'`（还原事实独立如实报告）。不声称 node_modules 字节级回滚。
- **结果为四分支判别联合**：`committed` / `rejected`（快照失败、前置校验失败、排队期 abort——零写入）/ `rolled-back` / `manual-repair`；`healActions[{code, note}]` + `failure{code, note}`（英文稳定 code，机器可断言）；中文散文只在展示层由 `renderFailure` 生成（唯一产地）。消费方拿结构化结果自行渲染；host-api 失败体附 `detail` 白名单投影（不含 raw output，GUI 零改动只读 `error`）。
- **pnpm 结果只以六类分类穿过接缝**（`dsh-cli.ts` 是分类器唯一产地）：ok / retryable-lag（CDN 滞后）/ config-drift（配置漂移）/ unused-patch / needs-builds / hard-fail；**分类发生在任何文案改写之前**，事务与 market 永不 regex pnpm 原始输出、只消费 `PNPM_OUTCOME_CODES` 常量。分类消费矩阵（add/remove/frozen/rebuild × 六类）由参数化测试全枚举钉死。
- **自愈阶梯**（全部以 healActions 记录）：B1 安装链丢 manifest 顶层键 → 快照找回 + frozen 复验（复验失败 fail-closed 进回滚）；B2 frozen 收敛：CONFIG_MISMATCH → 把 lockfile 记录的 overrides 对齐回 `package.json#pnpm.overrides` 再复验 → 顽固失配（含 OUTDATED_LOCKFILE specifier 漂移）降级 `--no-frozen-lockfile` 重建；B3 刚发布 `ERR_PNPM_NO_MATCHING_VERSION` 退避重试 2 次（5s/15s，abort-aware），每次重试前预热完整 packument（生产绑定 `makeNpmWarmPackument`，失败吞错）；构建脚本被拦 → `dangerouslyAllowAllBuilds` 放行并**必须明确报告**（在途重试在 adapter 的 `makeAddViaLadder` 内耗尽）。
- **signal 语义**：request 可带 AbortSignal，贯通 runner 四操作、预热与退避 sleep（abort 即醒）；mutate 前 abort → `rejected`；mutate 后 abort → 中止在途调用并执行**不可取消的**回滚（不变量优先于取消）；mutation 返回与提交前复查 signal——runner 返回 ok 但已取消的事务同样进 ABORTED 回滚，不提交。
- **互斥边界（已知限制）**：FIFO 锁为**进程内**互斥——Web Host / GUI / Agent tools 与独立 `dshm` CLI 可能运行在不同进程、操作同一 web profile，跨进程并发不在覆盖范围。变更执行期间避免同时从 GUI/Agent/CLI 发起另一次变更；跨进程锁（lockfile + stale 恢复）留作后续演进。
- **快照/原子写原语**（`npm-integrity.ts`）：快照仅吞 ENOENT（其他读取异常 fail closed 零写入）；原子写 POSIX 直接 rename（无「先删后改名」窗口），Windows EPERM/EEXIST 走备份协议；**任何失败路径（含 write/sync/close）都清理 tmp**，备份恢复自身失败时报告 backup 路径与双重错误。

### 3.2 各入口语义

- **安装（npm 源）**：装最新版并以**精确版本锁定**（不用 `^` 范围；用户指定版本必须为精确 semver，经该精确版本 endpoint 查询；dist integrity 缺失 fail closed 不进事务）。事务内核验 importer 依赖为该精确版本（旧版 CLI 写入的 `^v`/`~v` 锚定 range 视为等价放行并记录 `RANGE_ANCHOR_ACCEPTED`；精确性由紧随的 lockfile 解析与 integrity 兜底，其余 spec 仍 fail closed），并在 lockfile `packages` 条目中比对与 npm dist 一致的 `resolution.integrity`。
- **安装（GitHub 源）**：解析并**锁定 commit SHA**（`github:owner/repo#sha`）。核验采用**前态比对**：新 spec 必须相对快照是新写入（预置同 spec 旧依赖不误命中），否则 `GITHUB_SPEC_MISMATCH` 回滚。
- **已装识别**：读 profile `package.json` dependencies，与 registry 匹配 → 标注「市场安装」；不匹配的也列出，标注「非市场安装 / 来源未知」。卸载/升级对两类都可用。
- **卸载**（事务定序写死）：validate（严格读取：NOT_INSTALLED / NOT_DSH_PLUGIN / PLUGIN_METADATA_UNREADABLE，全部零写入零快照）→ 快照 → live-disable（先让 client bundle 下线，避免 404；回滚时尽力反向）→ 摘除该包补丁条目（`pnpm-workspace.yaml` 顶层 `patchedDependencies` 与 `package.json#pnpm.patchedDependencies`；残留条目会令 pnpm 以 `ERR_PNPM_UNUSED_PATCH` 整单失败，只精确匹配 `pkg` / `pkg@ver`，补丁文件本体保留并计入残留报告）→ remove → verify gone（仍在则回滚）。**不清理插件产生的数据/配置**，但把检测到的疑似残留路径（如 `~/.dsh/<plugin>.json`）列出报告。
- **升级**：**按需检查**（`dshm_outdated` / `dshm_list` 时实时比对本地版本 vs npm latest / GitHub release，半自动——展示升级计划，确认后执行，即重开一次安装事务）。**不做后台定时器**。
- **自更新**：dsh-m 对自己同样做版本比对 + 提示升级（设置页呈现）；执行即 `install-npm` 事务（integrity 缺失直接拒绝，不进事务）。
- **开关（0.4.0，术语见 CONTEXT.md「开关/行覆盖/Bundle 选择/委派降级」）**：已装插件运行状态的可逆切换，**不经 Profile 变更事务**。粒度自动路由——包内补丁层单 insert 行且无配置补丁行 → 行覆盖（`cordis.patch.yml` 保注释 `disabled` 编辑，官方 `writePluginEnabled` 同款语义，启用写显式 `disabled: false`）；多行/不可解析 → Bundle 选择（`dsh.profile.bundles` 数组增删）。写路径委派优先：运行时探测官方 `pluginManager` 服务（`ctx.get`，按存在性不判版本号）→ `setPluginEnabled`/`setBundleEnabled`（白拿保护判定、unaddressable 识别、hmr 活体重组；applied 以复读 `listPlugins()` 为准）；服务缺席降级 loader `entry.update()` 直操作 + 锁内文件编辑（bundle 级恒 restart-required）。**必须持官方同款锁**（`withFileLock(<profile>/package.json)`）防与官方 UI 并发丢更新。架构决策见 [ADR-0001](./adr/0001-delegate-with-fallback-for-plugin-manager.md)。
- **运行相位（0.4.0）**：loader fiber 状态投影（active/failed/pending/loading/unloading；fiber 缺失即已停用），读路径始终自读 loader entries，读路径零服务依赖。
- **保护名单（0.4.0）**：`dsh-m` 自身 + 逐字镜像官方 `protectedModules` 16 项全集（锚点 `dsh-plugin-manager@0.1.7-rc.2 lib/index.js L1077`；DSH 升级后 diff 官方名单）。作用于**开关与卸载**（保护门为开关路径最先判定，纯名单检查先于在装枚举）；升级不受影响；委派路径信任官方 `readOnlyReason`。
- **peer 兼容预检（0.4.0）**：install/upgrade 事务外 metadata 阶段，校验 `@deepseek-ai/dsh(-*)` peers 与运行时版本（`workspace:^/~/ *` 视为运行时版本；semver includePrerelease；官方 `evaluatePluginCompatibility` 同语义）。运行时版本解析失败或预检元数据读取失败 → 不拦（如实标注未检）；不兼容 → GUI 弹确认 / agent 回结构化 issue / CLI `--force`；无豁免机制（确认即通道）；GitHub 源明示 `compatSkipped`。
- **精确构建放行（0.4.0，[ADR-0002](./adr/0002-precise-build-approval.md)）**：needs-builds 拦截点（adapter 的 `makeAddViaLadder`）先读 `pnpm-workspace.yaml` 的 pnpm 待决名单（值为 `set this to true or false` 的无通配符键），逐键写 `allowBuilds.<pkg>: true`；名单空/不可读才走全量兜底并如实标注。放行结果沿 `RunnerOutcome.buildApprovals`/`fallbackAllBuilds` 上行（`usedAllowAllBuilds` 字段已删除）。
- **bundle 身份验证（0.4.0）**：事务 verify 阶段观察——包内无 `cordis.patch.yml` 且不在 bundles 数组 → `bundleWarning: 'no-patch-layer'`（装成纯依赖），只警告不回滚（存在合法的无补丁层 dsh 包）。
- **装后假成功守卫（0.5.0）**：npm/GitHub 安装事务提交后、结果返回前，对**新增包**校验三项——① 包内含 dsh 插件标记（`package.json` 的 `dsh.bundle`/`dsh.client` 键或包内 `cordis.patch.yml`，与 bundle 身份验证同族判定）；② 入口可解析（main/exports 指向的文件在包目录内存在）；③ 新增 loader 条目 id 与 profile 现有 patch 行/bundles 条目无冲突（两个同 id entry 会让下次开机整个 profile 起不来）。任一违例 → 走**专用 `compensate-install` 补偿事务**（不通用，四条边界：① 证据 = 提交后**实读**的 manifest 依赖值——安装源 spec `pkg@version` 与 manifest 值不等，不可混用；② 事务前捕获完整 prior state（manifestSpec/installSpec/version/patch mapping）——**升级与重复安装都携带 prior**，补偿恢复旧版本而非删包，仅真正全新安装才移除；③ 恢复验证 = node_modules 实际版本 + manifest + 旧 patch mapping 三者，不只比 manifest；④ 不接受外部 signal——安装已 committed，清理不可被客户端断连取消），绕开 `NOT_DSH_PLUGIN` 门——无 marker 的包恰好是最需要补偿的对象。live-disable 排序与卸载同款。返回结构化失败而非假成功。守卫自身不可用（读取异常、入口解析歧义、patch 文件损坏等 `unavailable` 非空）时 fail-open：返回 committed 结果 + `guardWarning` 字段（GUI/agent/CLI 三端展示），不执行补偿——宁可带警告放行也不误删刚装好的包，与 0.4.0 兼容预检「预检自身失败不拦安装」同一取舍传统。**残余风险（owner 2026-09-28 确认接受）**：GitHub 安装的真实 dependency key 需 add 后经 manifest diff 确认；pre-mutation 只读预解析 pinned SHA 的 package.json 可覆盖绝大多数场景，但 candidate 与 pnpm 实际 key 不一致且旧 prior 不可自动恢复（link/file 等）的极端场景下，补偿只能是 manual-repair 非成功状态（错误体携带旧 manifestSpec/installSpec/mapping 修复依据）——不承诺该场景 prior 无损。可自动恢复来源限严格白名单：canonical npm exact + dist integrity，或 pinned GitHub commit + 唯一 lock commit identity。
- **更新语义加固（0.5.0）**：`isNewerVersion` 从自定义折叠比较切换为 `semver.gt`（prerelease < 正式版的标准语义——旧实现把 `1.2.3-beta.1` 的数字尾段参与比较、误判为大于 `1.2.3`；semver 已是运行时依赖），补回归测试钉死降级/相等/prerelease/build 边界；GitHub `/tags` 回退路径的 annotated tag 由 tag object sha 修正为经 `commits/{ref}` 解引用的 commit sha（与 release 路径同语义）；GitHub 匿名配额的页面级探测边界按 Q46 收敛（社区 github 条目不做页面级 REST 探测）；`githubTagSha` 走 `commits/{ref}` 自动解引用 annotated tag（peeled 语义已正确），同样补测试钉死。
- **实测版本清单（0.4.0，术语「实测版本清单」）**：registry 条目可选 `verified: string[]`（精确 semver），来自各仓库对照源的实测声明；只展示与收录质量提示，**不做安装拦截依据**。
- **元数据源竞速（0.4.0 引入，0.4.x 退役）**：曾照搬官方 `dsh-client-ui-plugin-manager` 的 `PluginRegistryProbe`（npmjs/npmmirror `/-/ping` 竞速选元数据读取源）。退役理由：官方竞速只服务于「安装对话框 registry 默认预选」这一交互，dsh-m 无此交互；host 实测 npmjs（~175ms）稳定快于 npmmirror（~360-1400ms），探测恒等默认值；且元数据读取已有 TTL cache + deadline 预算。npmjs 真不可达时按官方 host 语义补**失败驱动 fallback**（对 network/timeout/not-found/no-matching-version 顺序重试镜像），不再引入主动探测。残留 `probeEnabled/probeTimeoutMs/probeCacheTtlMin` 配置键被非 strict Config schema 静默忽略，无需迁移。
- **重启**：内置**一键重启**。在服务管理器托管的 DSH 进程内，只有确认 unit 的 `Restart=on-failure` / `Restart=always` 且 `75` 未被 `SuccessExitStatus` / `RestartPreventExitStatus` 覆盖时，才调用 launcher 提供的 `appExit(75)`；策略未知或不满足时改用 manager-owned transient `systemd-run` 调用 `systemctl`，不猜测或硬编码 unit 名称，也不在即将停止的 cgroup 内 detached spawn `systemctl`。无 systemd/appExit 时再退回 detached-helper 兼容路径。安装/卸载/升级完成后 GUI 弹「需重启生效 [一键重启]」横幅；客户端以 boot id 确认替换进程后关闭横幅，交由 DSH Web 自身后台连接恢复，不强制整页刷新；工具返回重启提示。
- **安全基线（5 条）**：
  1. 所有拉取仅 HTTPS + 响应大小上限 + 超时；
  2. npm 安装校验 integrity；
  3. GitHub 安装强制 pinned SHA；
  4. pnpm 构建脚本被拦时，先按 pnpm 待决名单**逐键精确放行**（ADR-0002），名单不可读才 `dangerouslyAllowAllBuilds` 全量兜底，且**必须明确报告**放行了哪些包/是否兜底；
  5. 不做签名/验签体系（自用，明确不做）。

## 4. GUI（旗舰，v1 必须做好）

0.4.0 增补：已装卡右上 `dshm-switch` 开关（受 `toggleable` 控制，锁因 title 提示）；sub 行相位点 `● active · v1.0.8 · npm`（相位点只映射 phase 五值，「已停用」归 Switch，两输入源各管各的）；开关结果通知按 `applied` 分流（live → 绿 toast「即时生效」；restart-required → 沿用重启横幅 + 一键重启）；安装遇兼容拦截（409 + issue）弹「仍要安装」确认（红字风险 + peers 清单 → `forceIncompatible` 重发）。

0.5.0 增补（合并市场，详见 §2.5）：筛选栏分组「精选（5）｜社区（已知 20 带计数 + 新分类临时组）」，「只看主清单」chip 常驻首位；市场卡与已装卡对社区条目显示「社区收录」徽标；排序主清单置顶 + 社区按 30 天下载量降序；详情折叠区展示能力披露与截图（仅社区条目、缺省=未扫描≠未检出）；notice 双源状态（主清单状态 + 社区清单状态互相独立，社区失败静默）。

3 个视图，卡片展开式详情（不做独立详情页），**中文优先**，跟随 DSH Web 深色主题：

1. **市场页**（默认）：registry 卡片流；搜索/分类为**服务端过滤**（Host 强制 `withLatest=true`、每页 50、1,000 条清单第一页只探测当前页）；`MarketPanel` 是市场/已装数据唯一 owner（请求 generation + AbortController 丢弃旧响应）；安装/卸载/升级完成后通过统一协调器同时刷新市场与已装快照，不要求关闭并重新打开面板；分页控件 + 超过 200 条性能提示 + 默认/自定义/缓存/不可用短提示（不含本地路径）；卡片详情保留 README markdown 预览与 npm/GitHub 官方外链。
2. **已装页**：profile 实际安装列表，标注来源（市场/非市场/未知）；registry 不可用时仍列出已装并标记；「可升级 → x.y.z」徽标 +「升级」；「卸载」。
3. **设置页**：registry 地址草稿 +「校验并应用」（先校验候选再写 settings，失败不落盘）/「恢复默认」/「下载默认 registry.json」（不改当前配置）/「检查条目可达性」（probe 统计 + 最多 100 条 issue，只读不改配置）；同时展示配置地址、当前生效配置、生效来源与 configStatus（含 rejected/回滚原因与维护性 warnings）；完整本地路径仅在此页显示。registry 配置为 **live 生效，不出现安装类重启横幅**；安装/卸载/升级仍保留重启横幅。

技术：`src/client.js` 经 **esbuild** 打包为 `lib/client.js`；`window.__ModuleLoader__.load({ id: "dsh-m", factory })` 注册；**React 从 module loader require**（零额外运行时依赖）；manifest 注入 `@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-settings`。
图标：GitHub 来源自动用 `https://github.com/<owner>.png?size=64`；`icon` 字段可覆盖；npm-only 条目首字母色块回退。

## 5. Agent 工具（host）与 CLI

- 工具前缀 `dshm_`，共 7 个：`dshm_search` / `dshm_list` / `dshm_install` / `dshm_uninstall` / `dshm_outdated` / `dshm_upgrade` / `dshm_restart`。Agent tools 运行于 Host 进程，与 Web GUI **共用 `host` namespace 缓存与 active config**；`dshm_search` 走服务端过滤（metadata-only，`withLatest=false`、limit ≤80），返回不含本地路径的短 summary。
- 0.5.0：`dshm_search`/`dshm_install` 消费**合并市场**（§2.5）；category 参数接受精选 5 分类 + 任意社区分类 slug；summary 增加社区清单状态（条数/来源/是否 stale）；CLI 默认合并社区清单，`DSHM_COMMUNITY_CATALOG=0` 退出，缓存用 `cli/awesome/` 子目录。
- CLI bin `dshm`：同名同义命令集（`dshm list|search|install|uninstall|outdated|upgrade|restart`），固定 `cli` namespace。`registry`/`search`/`outdated` 在清单不可用时打印配置/实际生效地址并 **exit 1**；`list` 仍列出已装并标记不可用；本地终端可显示完整路径。
- 本地 API：`POST /dshm` 单路由 method 分发；除 `ping` 外全部要求 JSON Content-Type + `trustedRestartRequest` host 等价同源防护；typed 错误映射 400/403/404/405/413/415/422/500；`registry-config-apply` 校验失败 422；清单不可用的 `registry`/`market` 仍返回 200 + 结构化状态。
- 实现顺序：**GUI 先行，CLI 收尾**（核心逻辑同一层，CLI 是薄封装）。

## 6. 仓库与发版

- 单包结构；现有 `.github/workflows/publish.yml`（tag `v*` → OIDC trusted publishing）**一字不改**。
- 发版 = `npm version patch|minor|major && git push --tags`。
- npm 包 `dsh-m` 的 `files` 覆盖：`lib/`（`host.js` + `client.js` + `cli.js`）、`registry.json`（离线快照）、`cordis.patch.yml`、双语 README 与 `DESIGN.md`；`scripts/assert-pack.mjs` 对 `npm pack --dry-run --json` 做机器断言。

## 7. 首批收录

- `dsh-skins`（github 源）、`dsh-web-search`（实现时核实其 npm/GitHub 身份后录入）。
- **skillhub 不进首批**。
- 核心 `deepseek-harness-*` 包永不收录。

## 8. 里程碑（GUI 先行）

- **M0 脚手架**：单包结构（TS + esbuild）、manifest（`dsh.client` + `cordis.patch.yml` + `dsh.bundle.patch`）、构建脚本。
- **M1 core 层**：registry 拉取/缓存/覆盖、profile 读取、install/uninstall/upgrade/outdated 封装（spawn `dsh` CLI，非 shell 拼接，超时 + SIGTERM，保留末 256KB 输出）。
- **M2 GUI**：3 视图 + 卡片展开 + 重启横幅。
- **M3 host 工具**：7 个 `dshm_*` + cordis patch 注册。
- **M4 CLI**：`dshm` bin。
- **M5 收尾**：registry CI workflow、首批收录两条、自更新、发 `0.1.0`。

## 9. 决策记录（三轮 19 条）

| # | 决策 | 结论 |
|---|------|------|
| Q1 | 形态 | DSH 插件主体；**GUI 旗舰（Q9 修订：比 CLI 重要，v1 必须做好）**+ 工具 + 薄 CLI |
| Q2 | 管理范围 | 只管插件，skills 归 skillhub |
| Q3 | registry 维护 | repo 内手工 curated；版本不写死 |
| Q4 | 安装来源 | npm 优先 + GitHub 兜底，schema 留 `source` |
| Q5 | 自用边界 | 单机自用，收录靠 repo/PR，无服务端 |
| Q6 | 升级提示 | v1 包含，半自动；全自动后台升级不做 |
| Q7 | 与 skillhub 关系 | 完全独立并存 |
| Q8 | 重启 | 内置一键重启，复用已验证路径 |
| Q9 | v1 边界 | ✏️ 修订：GUI 必须进 v1 且优先级最高 |
| Q10 | registry 分发 | 运行时拉 `@main` + TTL 缓存 + 包内快照兜底 |
| Q11 | schema | 精简中文 schema（icon 经 Q22 修订为可选覆盖） |
| Q12 | pin 策略 | npm 精确版本；GitHub 锁 SHA |
| Q13 | 已装识别 | 读 profile package.json，零额外状态 |
| Q14 | 卸载语义 | 删包不删数据，报告残留 |
| Q15 | 命名 | `dshm_` 前缀 / `dshm` bin |
| Q16 | 升级检查时机 | 纯按需 + 自更新检查进 v1 |
| Q17 | 安全基线 | §3 的 5 条 |
| Q18 | 仓库发版 | 单包；publish.yml 不改；tag 发版 |
| Q19 | 首批收录 | ✏️ 修订：dsh-skins + dsh-web-search（不含 skillhub） |
| Q20–24 | GUI 细节 | 3 视图 / esbuild+React / 自动头像 / CLI 薄封装 / 设置页三件事 |

### 9.1 可自定义 Registry v1 追加决策（2026-09-04 grilling + 评审）

| # | 决策 | 结论 |
|---|------|------|
| Q25 | 覆盖模型 | 单一 registry 地址**整体覆盖**默认清单；不做运行时多源合并、不做逐条 UI 编辑器 |
| Q26 | 新增插件 | 下载默认 registry.json → 自行编辑副本 → 填地址应用；副本为独立快照不同步官方 |
| Q27 | schema | 严格 v1：未知字段/非法 ID/超限/重复拒绝整份清单；2 MiB / 1,000 条上限；>200 条提示性能 |
| Q28 | 地址类型 | HTTPS URL（外网）；HTTP 仅 loopback（本机管理员信任边界，不做 DNS rebinding 防护声明）；本地普通文件（fd 级安全读取） |
| Q29 | 失败语义 | 自定义源失败只回退该源自身缓存，绝不伪装成官方清单；无数据返回空清单 + 不可用状态 |
| Q30 | 缓存 | host/cli 双 namespace、CacheFile v2 原子写、candidate 不 prune、commitActiveSource 先 metadata 后 prune、失败降级 warning |
| Q31 | live | registry 地址 live 生效；仅首次部署新 Host 代码需一次用户确认的重启 |
| Q32 | 性能 | 服务端分页：GUI withLatest 最多 50/页，Agent/CLI metadata-only 最多 80；latest probe 并发 ≤8 + TTL cache + 全局 deadline |
| Q33 | 诊断 | 用户主动触发的 probe（npm/GitHub/homepage/icon），统计 + 稳定排序 + 100 条截断；不改配置不写缓存 |
| Q34 | API 防护 | 除 ping 外全部 POST 要求 JSON + host 等价同源 guard；typed 错误 400/413/415/422/500 |
| Q35 | integrity | npm 精确版本 dist integrity 对照 pnpm lockfile v9，fail closed + best-effort 快照回滚（Q12 的落地实现） |
| Q36 | namespace | Agent tools 与 Host GUI 共用 host namespace 及 active config；仅独立 CLI 用 cli namespace（Q48-A 修正） |
| Q37 | CLI | registry/search/outdated 不可用 exit 1 并输出配置/实际生效地址；agent 输出不泄露本地路径 |

### 9.3 双层 Registry 追加决策（0.5.0 grilling 定稿 2026-09-28，修订 Q25）

| # | 决策 | 结论 |
|---|------|------|
| Q38 | 双层定位 | 修订 Q25：主清单（§2.1–2.4 不变）+ 社区清单只读叠加 = 合并市场，三端一致；主清单保留 verified/文案差异化，npm 包内快照仍只含主清单。ADR-0003 |
| Q39 | 社区数据源 | 只锚定 npm `dsh-plugin-catalog`：dist-tags 版本号即 revalidate 验证器；jsDelivr pinned → npmmirror files → unpkg pinned 兜底；无包内快照；`communityCatalogPin` 可锁版本 |
| Q40 | 分类 | 开放集：社区分类保留原生值不转译；精选 5 + 社区已知 20（ui/tools/market 共享桶）；未知分类进「社区·新分类」临时组 |
| Q41 | 合并语义 | 去重键 npm 包名 → owner/repo → 合成 id；主清单恒优先；被让位条目计数进 warnings；`registryUrl` 替换只作用于主清单层，社区叠加与其无关 |
| Q42 | 降级 | 主 unavailable + 社区可用 → 显示社区 + 错误横幅 + 不禁装；社区失败 → 主照常 + 静默 notice；社区绝不伪装/不做包内快照 |
| Q43 | 容量与卫生 | 社区 32 MiB / 30,000 条超限整份拒收；条目层宽松（脏条目跳过计数）；无 npm 的子包条目跳过计数；tarball-only 按 github 收录 |
| Q44 | 能力披露 | capabilities/红线只进详情折叠区（缺省=未扫描≠未检出）；卡片不打标；截图仅详情层 |
| Q45 | 排序与筛选 | 主清单置顶（原顺序）+ 社区按 30 天下载量降序；筛选栏「精选｜社区」分组 + 常驻「只看主清单」 |
| Q46 | 探测边界 | 市场浏览页：社区 npm 条目探测、社区 github 条目不探测（60/h 配额），详情/安装时按需解析；已装页豁免但按**真实 GitHub HTTP 请求数**计量：单请求 ≤25 次 + 宿主进程滚动 1 小时 ≤50 次（仅被动探测；主动安装/升级/诊断不受限）+ 同仓库 in-flight single-flight（`githubLatestTag` 一次调用 ≈ 1–3 个 HTTP 请求，fallback 路径最多 3 个）；独立 CLI 进程不共享宿主预算——文档如实标注 best-effort |

## 10. 实现参考（本地镜像）

- **skillhub 完整源码**：`~/.research-skillhub/all`（工作区内）。重点借鉴：`src/install.ts`（zip 原子写入、防穿越）、`src/plugin-market.ts`（install-plan、pinned SHA、spawn dsh CLI、dangerouslyAllowAllBuilds 重试）、`src/installed-plugins.js`（卸载前 live-disable）、`src/live-plugin.js`、`src/restart.ts`（重启路径）、`src/client.js`（GUI 模式范本）、`src/self-update.ts`。
- **dshmarketplace 源码**：`~/research-dshmarketplace/`。借鉴：registry 校验两段式（无密钥校验 + 受信写入）、HMAC 常量时间比对（若将来需要）、收录启发式（topic + 最少 commits + marker 文件，备将来自动发现）。

## 11. 已知事实约束（本机）

- profile 根：`$DSH_HOME/profiles/web`（默认 `~/.dsh/profiles/web`）；已装插件 = 其 `package.json` dependencies + `dsh.profile.bundles`。
- 新装插件需**重启 dsh web** 才加载；HMR 仅在 `pnpm run dev:web` watcher 存活时有效。
- 禁止创建监听 3080 的进程；部署 unit 名称（例如 `openbmc-dsh.service`、`deepseek-harness.service` 或 `dsh-web.service`）只作运行时事实，不硬编码到 dsh-m；managed host 的重启由 `appExit` + unit `Restart` 策略完成。
- 插件包协议要点：`type: module`、`main` host 入口、`exports["./client"]` 指向打包产物、`dsh.client.platform: "web"`、`dsh.bundle.patch: ./cordis.patch.yml`（`- insert: - id: dsh-m; name: dsh-m`）。

## 12. settings 服务双代兼容（2026-09-27 定稿）

DSH 0.1.7 把 settings 服务重塑为 `@deepseek-ai/dsh-settings` 的 `SettingsForms`：旧的
`settings.register(ns, schema, …)`（get/update/watch scope）消失，改为「Config schema 标
`.volatile()` 的字段 + loader 原地提交 + 自动生成设置页」。经 npm tarball 逐字节比对，
**0.1.7-rc.1 与 rc.2 的 dsh-settings 完全相同、loader 同为 ~1.0.5**——一套新通路通吃两个 rc。

兼容层 `src/core/settings-compat.ts`，运行时形态探测（不按版本号分支）：

| runtime 代际 | 判据 | 读 | 写 | 变更通知 |
|---|---|---|---|---|
| ≤0.1.5 | `settings.register` 存在 | `scope.get()` | `scope.update()` | `scope.watch()` |
| 0.1.7-rc.1 / rc.2 | `settings.describe`+`update` 存在 | loader 解析的 Config（Volatile 引用 `.get()`） | `settings.update(ns, patch)`（config-editor 落 profile patch，重启持久） | `loader/volatile-update` 事件 |
| 未识别 | 两者皆无 | cordis 配置文件 | 同左（仅启动期生效） | 无 |

不变量：

1. **controller 只见 plain 值**——所有 store 出站值统一过 `unwrapConfig`（含 Volatile 引用解包与脏值丢弃），旧 API 混合形态（老 runtime + 新 schemastery）同样被挡在边界上；
2. **设置集成绝不炸插件**——`wireRegistrySettings` 不抛，失败以 warn + 降级收场，webServer / tools 不受影响；
3. **新 API 不调 `configure({ auto: false })`**——保留 `autoGenerate`（默认开），设置页由宿主按 volatile 字段自动生成；
4. **`.volatile()` 受控调用**——仅当 schemastery 有该方法时标记（0.1.5-rc.3 精确 pin 3.18.2 无此方法，老 runtime 不受影响）；方法重复包裹会 throw，每字段只调一次；
5. **写省略 `expectedRevision`**——与旧 API 相同的末写胜语义，并发防护由 controller 串行队列 + `lastSelfWrite` 回声去重承担。
