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
      "category": "ui",               // market|tools|ui|search|media|other 六选一
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

## 3. 安装 / 卸载 / 升级 / 重启

底层原语（本机实证）：`dsh plugin --profile web add|remove|update`（转发 pnpm，作用于 `$DSH_HOME/profiles/web`）。**profile 的 `package.json` 就是唯一事实源**——不引入任何额外状态文件。

- **安装（npm 源）**：装最新版并以**精确版本锁定**（不用 `^` 范围；用户指定版本必须为精确 semver，经该精确版本 endpoint 查询）。安装前对 profile 的 `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` 做**字节快照**；安装后核验 importer 依赖为该精确版本，并在 lockfile `packages` 条目中比对与 npm dist 一致的 `resolution.integrity`——缺失或不一致 **fail closed** 并执行 **best-effort dependency rollback**：原子恢复快照字节 + frozen 自愈阶梯（`pnpm install --frozen-lockfile` → 仍报 `CONFIG_MISMATCH` 时把 lockfile 记录的 overrides 对齐回 `package.json#pnpm.overrides` 再复验 → `CONFIG_MISMATCH` / `OUTDATED_LOCKFILE` 顽固失配才降级 `--no-frozen-lockfile` 重建并明确告知「lockfile 已重建」；全阶梯失败才报「可能需要人工修复」）。成功路径若发现安装链丢失了 manifest 顶层未知键（如 `pnpm.overrides`，2026-09-05 升级回滚事故），从快照找回并复验 frozen 一致性，输出带 `[dsh-m 自愈]` 报告。刚发布 ~1 分钟内的 `ERR_PNPM_NO_MATCHING_VERSION` 多为 packument CDN 滞后：退避重试 2 次（5s/15s），每次重试前拉一次完整 packument 预热。不声称 node_modules 与间接依赖已字节级回滚。
- **安装（GitHub 源）**：解析并**锁定 commit SHA**（`github:owner/repo#sha`），skillhub 同款。
- **已装识别**：读 profile `package.json` dependencies，与 registry 匹配 → 标注「市场安装」；不匹配的也列出，标注「非市场安装 / 来源未知」。卸载/升级对两类都可用。
- **卸载**：live-disable（先让 client bundle 下线，避免 404）→ 摘除该包在 profile 的补丁条目（`pnpm-workspace.yaml` 顶层 `patchedDependencies` 与 `package.json#pnpm.patchedDependencies`；依赖移除后残留条目会令 pnpm 以 `ERR_PNPM_UNUSED_PATCH` 整单失败，只精确匹配 `pkg` / `pkg@ver`，补丁文件本体保留并计入残留报告）→ `dsh plugin remove`。**不清理插件产生的数据/配置**，但把检测到的疑似残留路径（如 `~/.dsh/<plugin>.json`）列出报告。
- **升级**：**按需检查**（`dshm_outdated` / `dshm_list` 时实时比对本地版本 vs npm latest / GitHub main），半自动——展示升级计划，确认后执行。**不做后台定时器**。
- **自更新**：dsh-m 对自己同样做版本比对 + 提示升级（设置页呈现）。
- **重启**：内置**一键重启**，复用 skillhub 验证过的重启路径（本机 `dsh-web.service` 是转发 shim，不新建 systemd 单元、不监听 3080）。安装/卸载/升级完成后 GUI 弹「需重启生效 [一键重启]」横幅，工具返回重启提示。
- **安全基线（5 条）**：
  1. 所有拉取仅 HTTPS + 响应大小上限 + 超时；
  2. npm 安装校验 integrity；
  3. GitHub 安装强制 pinned SHA；
  4. pnpm 构建脚本被拦时，沿用 skillhub 的 `dangerouslyAllowAllBuilds` 重试，但**必须明确报告**「该插件需要执行构建脚本」；
  5. 不做签名/验签体系（自用，明确不做）。

## 4. GUI（旗舰，v1 必须做好）

3 个视图，卡片展开式详情（不做独立详情页），**中文优先**，跟随 DSH Web 深色主题：

1. **市场页**（默认）：registry 卡片流；搜索/分类为**服务端过滤**（Host 强制 `withLatest=true`、每页 50、1,000 条清单第一页只探测当前页）；`MarketPanel` 是市场/已装数据唯一 owner（请求 generation + AbortController 丢弃旧响应）；分页控件 + 超过 200 条性能提示 + 默认/自定义/缓存/不可用短提示（不含本地路径）；卡片详情保留 README markdown 预览与 npm/GitHub 官方外链。
2. **已装页**：profile 实际安装列表，标注来源（市场/非市场/未知）；registry 不可用时仍列出已装并标记；「可升级 → x.y.z」徽标 +「升级」；「卸载」。
3. **设置页**：registry 地址草稿 +「校验并应用」（先校验候选再写 settings，失败不落盘）/「恢复默认」/「下载默认 registry.json」（不改当前配置）/「检查条目可达性」（probe 统计 + 最多 100 条 issue，只读不改配置）；同时展示配置地址、当前生效配置、生效来源与 configStatus（含 rejected/回滚原因与维护性 warnings）；完整本地路径仅在此页显示。registry 配置为 **live 生效，不出现安装类重启横幅**；安装/卸载/升级仍保留重启横幅。

技术：`src/client.js` 经 **esbuild** 打包为 `lib/client.js`；`window.__ModuleLoader__.load({ id: "dsh-m", factory })` 注册；**React 从 module loader require**（零额外运行时依赖）；manifest 注入 `@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-settings`。
图标：GitHub 来源自动用 `https://github.com/<owner>.png?size=64`；`icon` 字段可覆盖；npm-only 条目首字母色块回退。

## 5. Agent 工具（host）与 CLI

- 工具前缀 `dshm_`，共 7 个：`dshm_search` / `dshm_list` / `dshm_install` / `dshm_uninstall` / `dshm_outdated` / `dshm_upgrade` / `dshm_restart`。Agent tools 运行于 Host 进程，与 Web GUI **共用 `host` namespace 缓存与 active config**；`dshm_search` 走服务端过滤（metadata-only，`withLatest=false`、limit ≤80），返回不含本地路径的短 summary。
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

## 10. 实现参考（本地镜像）

- **skillhub 完整源码**：`~/.research-skillhub/all`（工作区内）。重点借鉴：`src/install.ts`（zip 原子写入、防穿越）、`src/plugin-market.ts`（install-plan、pinned SHA、spawn dsh CLI、dangerouslyAllowAllBuilds 重试）、`src/installed-plugins.js`（卸载前 live-disable）、`src/live-plugin.js`、`src/restart.ts`（重启路径）、`src/client.js`（GUI 模式范本）、`src/self-update.ts`。
- **dshmarketplace 源码**：`~/research-dshmarketplace/`。借鉴：registry 校验两段式（无密钥校验 + 受信写入）、HMAC 常量时间比对（若将来需要）、收录启发式（topic + 最少 commits + marker 文件，备将来自动发现）。

## 11. 已知事实约束（本机）

- profile 根：`$DSH_HOME/profiles/web`（默认 `~/.dsh/profiles/web`）；已装插件 = 其 `package.json` dependencies + `dsh.profile.bundles`。
- 新装插件需**重启 dsh web** 才加载；HMR 仅在 `pnpm run dev:web` watcher 存活时有效。
- 禁止创建监听 3080 的进程；`dsh-web.service` 为 shim，重启走其转发路径。
- 插件包协议要点：`type: module`、`main` host 入口、`exports["./client"]` 指向打包产物、`dsh.client.platform: "web"`、`dsh.bundle.patch: ./cordis.patch.yml`（`- insert: - id: dsh-m; name: dsh-m`）。
