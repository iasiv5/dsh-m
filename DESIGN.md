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

### 2.1 载体与分发
- repo 内**单文件 `registry.json`**，手工 curated，版本号**不写死**（运行时实查 npm/GitHub）。
- 运行时获取：**jsDelivr / raw.githubusercontent 读 `@main`**，本地 **TTL 1h 缓存**；npm 包内附带一份快照作离线兜底。收录更新与插件发版**解耦**。
- 设置页提供 **registry 源地址覆盖**（可指向 raw / 本地文件，用于调试与预览未合并条目）。

### 2.2 Schema（v1 定稿）
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
PR / push 到 main 时校验：
1. schema 合法（字段、枚举、source 与 npm/github 的必填联动）；
2. npm 条目 `npm view <pkg> version` 可查；GitHub 条目 repo 存在；
3. 无重复 `id`；
4. `icon` / `homepage` URL 可达（icon 允许为空）。

## 3. 安装 / 卸载 / 升级 / 重启

底层原语（本机实证）：`dsh plugin --profile web add|remove|update`（转发 pnpm，作用于 `$DSH_HOME/profiles/web`）。**profile 的 `package.json` 就是唯一事实源**——不引入任何额外状态文件。

- **安装（npm 源）**：装最新版并以**精确版本锁定**（不用 `^` 范围）；安装后校验 tarball `integrity`（对照 `npm view dist.integrity`）。
- **安装（GitHub 源）**：解析并**锁定 commit SHA**（`github:owner/repo#sha`），skillhub 同款。
- **已装识别**：读 profile `package.json` dependencies，与 registry 匹配 → 标注「市场安装」；不匹配的也列出，标注「非市场安装 / 来源未知」。卸载/升级对两类都可用。
- **卸载**：live-disable（先让 client bundle 下线，避免 404）→ `dsh plugin remove`。**不清理插件产生的数据/配置**，但把检测到的疑似残留路径（如 `~/.dsh/<plugin>.json`）列出报告。
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

1. **市场页**（默认）：registry 卡片流；顶部关键词搜索 + 分类筛选 + 标签；卡片 = 图标 / 名称 / 描述 / 来源徽标 / 最新版本；按钮「安装」；点卡片展开详情。
2. **已装页**：profile 实际安装列表，标注来源（市场/非市场/未知）；「可升级 → x.y.z」徽标 +「升级」；「卸载」。
3. **设置页**：缓存状态 + 手动刷新（显示 registry commit/时间）；registry 源覆盖；dsh-m 自更新提示与升级。

技术：`src/client.js` 经 **esbuild** 打包为 `lib/client.js`；`window.__ModuleLoader__.load({ id: "dsh-m", factory })` 注册；**React 从 module loader require**（零额外运行时依赖）；manifest 注入 `@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-settings`。
图标：GitHub 来源自动用 `https://github.com/<owner>.png?size=64`；`icon` 字段可覆盖；npm-only 条目首字母色块回退。

## 5. Agent 工具（host）与 CLI

- 工具前缀 `dshm_`，共 7 个：`dshm_search` / `dshm_list` / `dshm_install` / `dshm_uninstall` / `dshm_outdated` / `dshm_upgrade` / `dshm_restart`。
- CLI bin `dshm`：同名同义命令集（`dshm list|search|install|uninstall|outdated|upgrade|restart`）。
- 实现顺序：**GUI 先行，CLI 收尾**（核心逻辑同一层，CLI 是薄封装）。

## 6. 仓库与发版

- 单包结构；现有 `.github/workflows/publish.yml`（tag `v*` → OIDC trusted publishing）**一字不改**。
- 发版 = `npm version patch|minor|major && git push --tags`。
- npm 包 `dsh-m` 的 `files` 需覆盖：`lib/`（host+client 产物）、`registry.json`（离线快照）、`bin/`。

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

## 10. 实现参考（本地镜像）

- **skillhub 完整源码**：`~/.research-skillhub/all`（工作区内）。重点借鉴：`src/install.ts`（zip 原子写入、防穿越）、`src/plugin-market.ts`（install-plan、pinned SHA、spawn dsh CLI、dangerouslyAllowAllBuilds 重试）、`src/installed-plugins.js`（卸载前 live-disable）、`src/live-plugin.js`、`src/restart.ts`（重启路径）、`src/client.js`（GUI 模式范本）、`src/self-update.ts`。
- **dshmarketplace 源码**：`~/research-dshmarketplace/`。借鉴：registry 校验两段式（无密钥校验 + 受信写入）、HMAC 常量时间比对（若将来需要）、收录启发式（topic + 最少 commits + marker 文件，备将来自动发现）。

## 11. 已知事实约束（本机）

- profile 根：`$DSH_HOME/profiles/web`（默认 `~/.dsh/profiles/web`）；已装插件 = 其 `package.json` dependencies + `dsh.profile.bundles`。
- 新装插件需**重启 dsh web** 才加载；HMR 仅在 `pnpm run dev:web` watcher 存活时有效。
- 禁止创建监听 3080 的进程；`dsh-web.service` 为 shim，重启走其转发路径。
- 插件包协议要点：`type: module`、`main` host 入口、`exports["./client"]` 指向打包产物、`dsh.client.platform: "web"`、`dsh.bundle.patch: ./cordis.patch.yml`（`- insert: - id: dsh-m; name: dsh-m`）。
