# dsh-m — DeepSeek Harness 插件市场

[![Release](https://img.shields.io/github/v/release/iasiv5/dsh-m?label=Release&sort=semver)](../../releases)
[![npm](https://img.shields.io/npm/v/dsh-m?label=npm)](https://www.npmjs.com/package/dsh-m)
[![Registry Check](https://img.shields.io/github/actions/workflow/status/iasiv5/dsh-m/registry.yml?branch=main&label=Registry%20Check)](../../actions/workflows/registry.yml)
[![License](https://img.shields.io/github/license/iasiv5/dsh-m?label=License)](./LICENSE)
[![DSH Web](https://img.shields.io/badge/DSH%20Web-0.1.2--rc.1%20%E2%86%92%200.2.0--rc.2-2563eb)](#faq)

[English](./README.en.md) · 中文

dsh-m 是 DeepSeek Harness（DSH）的插件市场：**收录 · 安装 · 卸载 · 升级**，全部本机完成——无服务端、无账号。侧栏「插件市场」即开即用，agent 工具与 CLI 同源同语义。

**亮点**

- **双 profile**：同一包装入 Web（`web`）与官方 Desktop（`desktop`），管理对象始终跟随宿主当前 profile；
- **双清单市场**：4,000+ 条社区目录（awesome-dsh-plugin）为默认清单，叠加手工精选，分区浏览、卡片即点即装；
- **三端同源**：GUI 面板、8 个 `dshm_*` agent 工具与 `dshm` CLI 共享同一套数据与语义；
- **安全基线**：npm 精确版本 integrity 校验、GitHub 锁定 commit SHA、委派官方 pluginManager，构建脚本逐键精确放行。

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/marketplace.webp" alt="侧栏「插件市场」面板——市场视图：社区 / 精选 / 收藏三分区、分类 chips 与插件卡片（已实测 / 已安装徽标、npm 与 GitHub 详情链接）" width="100%">
  <p><sub>侧栏「插件市场」· 市场视图：社区、精选与收藏分区，浏览插件并查看兼容与安装状态</sub></p>
</div>

## 目录

- [环境要求](#环境要求)
- [30 秒上手](#30-秒上手)
- [界面（侧栏「插件市场」）](#界面侧栏插件市场)
- [Agent 工具（8 个）](#agent-工具8-个)
- [CLI](#cli)
- [社区清单（awesome-dsh-plugin 目录）](#社区清单awesome-dsh-plugin-目录)
- [精选清单（registry.json）](#精选清单registryjson)
- [文档](#文档)
- [FAQ](#faq)

本页不展开版本变更，完整历史见 [`CHANGELOG.md`](https://github.com/iasiv5/dsh-m/blob/main/CHANGELOG.md)。

## 环境要求

- Node.js ≥ 22（宿主侧）；
- DSH Web 或官方 Desktop（支持的宿主代际见 [FAQ 支持矩阵](#faq)）；
- 无需额外服务或账号，安装与管理全部本机完成。

## 30 秒上手

1. 在 DSH 官方插件管理界面点击「添加插件」。
2. 输入包名 `dsh-m`，按网络情况选择安装源，然后点击「安装」。
3. 安装完成后按宿主生命周期使插件生效：DSH Web 重启后刷新页面；官方 Desktop 退出并重新打开应用。
4. 加载完成后，从侧栏底部打开「插件市场」。

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/official-plugin-install.webp" alt="DSH 官方插件管理界面：添加插件对话框中填写 dsh-m，并选择安装源" width="86%">
  <p><sub>推荐方式 · 在 DSH 官方插件管理界面添加并安装 dsh-m</sub></p>
</div>

> **升级提示：** 当前官方插件管理界面提示暂不支持自动更新；若通过该界面升级，请先卸载 `dsh-m` 再安装新版，具体以界面最新提示为准。

## 界面（侧栏「插件市场」）

| 视图 | 能力 |
|---|---|
| **市场** | 社区（4,000+ 条）/ 精选 / 收藏三分区；浏览态各分区独立保留分类、排序与分页状态，搜索为跨区全局（社区 + 精选一并命中）；卡片点开详情 Modal，安装进度与结果就地显示。 |
| **操作记录** | 安装、升级、卸载、开关统一进入全局操作日志，状态不挂卡片；宿主重载后自动恢复未完成操作。 |
| **已装** | 当前 profile 实装列表：来源标注、运行相位徽标、一键开关、升级与两段式确认卸载。 |
| **设置** | 精选清单配置与状态、社区目录开关、dsh-m 自更新。 |

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/settings.webp" alt="设置视图——社区清单状态卡（目录版本 / 获取线路 / 收录条目）、精选清单配置卡（地址草稿与强制刷新 / 校验并应用 / 恢复默认 / 下载默认清单）与关于卡" width="86%">
  <p><sub>设置视图 · 社区清单状态、精选清单配置与 dsh-m 自更新</sub></p>
</div>

变更生效与重启（仅 Web）：

- 安装 / 卸载 / 升级完成后，市场页与已装页自动同步最新状态，无需关闭重开面板；
- 随后出现「⚡ 一键重启」横幅：受 systemd 管理时经 DSH launcher 的 `appExit` 交还服务的 `Restart` 策略拉起，无 `appExit` 的宿主按设计兜底；
- 客户端按 boot id 确认新进程后关闭横幅，页面经 DSH Web 自身的后台重连恢复，不强制整页刷新；
- 安装过程实时显示 pnpm 进度（解析 → 下载 → 链接 → 构建）。

Desktop 的变更经官方应用生命周期生效——安装完成后退出并重新打开应用即可。重启链路的机制细节与实机核验记录见 [`docs/DESIGN.md`](https://github.com/iasiv5/dsh-m/blob/main/docs/DESIGN.md)。

## Agent 工具（8 个）

| 工具 | 用途 |
|---|---|
| `dshm_search` | 搜精选与社区清单（对话内出卡片） |
| `dshm_list` | 列已装插件（市场/非市场标注） |
| `dshm_install` | 按清单 id 安装（装前 peer 兼容预检；不兼容时回结构化结果，用户确认后 `force` 重试） |
| `dshm_uninstall` | 卸载（先确认；不删数据，报告残留路径） |
| `dshm_outdated` | 检查最新版本 |
| `dshm_upgrade` | 升级到最新 |
| `dshm_toggle` | 切换插件运行状态（默认先确认，用户同句已明确可直接执行） |
| `dshm_restart` | 一键重启 DSH Web（先征得同意） |

## CLI

```sh
dshm search [--query 主题] [--category ui] [--source community|primary|all] [--limit N] [--offset N]
dshm list | outdated | registry
dshm install --id dsh-web-search [--force]   # --force：确认兼容风险后跳过预检拦截
dshm upgrade --pkg dsh-web-search --yes [--force]
dshm uninstall --pkg dsh-web-search --yes
dshm toggle --pkg dsh-web-search --on|--off --yes   # 文件级编辑，重启生效
dshm restart --yes
```

清单不可用时 `registry` / `search` / `outdated` 打印配置与实际生效地址并退出码 1；`list` 仍列出已装插件。CLI 固定独立缓存命名空间，不影响 Web 端。

**profile 目标**：CLI 恒作用于 web profile——`--profile web` 为显式声明；`--profile desktop` 直接拒绝（Desktop 的插件管理走官方 Desktop 应用）。无图形界面的宿主也可用官方 `dsh` CLI 安装插件：`dsh plugin --profile web add dsh-m`。

> `npm install -g dsh-m` 只安装 `dshm` CLI（终端管理用），**不会**把插件注册进 web profile；与通过官方插件管理界面安装不冲突，可并存。

## 社区清单（awesome-dsh-plugin 目录）

**社区清单是 dsh-m 的默认清单**：锚定 npm 包 [`dsh-plugin-catalog`](https://www.npmjs.com/package/dsh-plugin-catalog)（CC0-1.0，awesome-dsh-plugin 全量目录，4,000+ 条）。其上叠加手工 curated 的**精选清单**（registry.json），数据层合并去重（**精选清单恒优先**，重名条目社区侧让位），展示层按「社区 / 精选」分区呈现（ADR-0004）——社区区不再显示与精选清单重复的条目，精选区保持策展序单页直出。

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/community-catalog.webp" alt="市场视图社区分区——社区 / 精选 / 收藏分区 tabs、搜索行与带计数的开放分类 chips" width="86%">
  <p><sub>社区清单 · 默认落地分区：分区 tabs、常驻搜索与带计数的开放分类 chips</sub></p>
</div>

- **数据获取**：dist-tags 探测最新版本 → jsDelivr 按精确版本直取 → npmmirror → unpkg 三线路兜底；版本未变不重拉正文，TTL 内跳过探测。「最新版本」探测结果为纯内存缓存：**重启 DSH 即失效**（发版后重启即可看到新版本），经 dsh-m 安装/升级/卸载成功后该条目缓存立即作废。失败回落 `<缓存目录>/awesome/` 运行时缓存先展示（先回缓存、后台自愈）——过期数据绝不冒充最新；缓存状态（缓存快照/目录版本/获取线路/更新时间）在**设置页**可见，浏览页不打扰。
- **开关与锁定**：设置页 `communityCatalog` 开关（默认开，live 生效）、`communityCatalogPin` 可锁定目录版本（精确 semver）；CLI 用 `DSHM_COMMUNITY_CATALOG=0` 退出、`DSHM_COMMUNITY_CATALOG_PIN` 锁版本。
- **分类与搜索**：社区分类是开放集（已知 23 个分类带中英双语标签：中文由包内单一事实源维护、英文取上游目录，按界面语言下发）；搜索走相关性加权管线（中英文双匹配），且为**跨区全局**——任一分区的搜索框同时命中社区与精选（浏览保持分区，摘要行报两分区精确命中数、精选命中置顶分组）；社区区排序可切（下载量/Star/收录日期 × 升降，默认下载量降序，无下载量 ≠ 0 下载）。
- **安装语义**：社区条目与精选条目走同一安装链路（npm 锁精确版本 / GitHub 锁 commit SHA）；市场浏览页只对 npm 条目做更新探测，GitHub 条目不做页面级探测（匿名配额 60 次/小时不可控）。
- **已装页预算（best-effort）**：已装页对 GitHub 来源插件做更新检查，单次请求 ≤25 个、宿主进程滚动 1 小时 ≤50 个（仅被动检查；主动安装/升级不受限）；超限条目如实标注「检查未完成」而不冒充「全部最新」。独立 CLI 进程不共享宿主内预算，并发场景不承诺 60 次/小时绝不耗尽。
- **能力披露**：社区条目的 capabilities/红线只出现在详情折叠区（**缺省 = 未扫描 ≠ 未检出**），卡片不打标；截图仅在详情层加载并经客户端白名单校验。
- **非安全审查警示**：社区目录为全量收录，**未经安全审查**——安装前请自行确认插件来源与能力；精选清单的策展与 CI 校验不适用于社区条目。

## 精选清单（registry.json）

精选清单手工 curated，叠加在社区清单之上（重名条目恒优先），按**策展五桶**分类：装机必备 / 崔添翼精选 / iasi自研 / 腾讯轻量云专区 / 观察区，当前收录 DSH Skins、DSH TUI、ModSearch、Better Sidebar、DSH Context 等插件。

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/curated-registry.webp" alt="市场视图精选分区——社区 / 精选 / 收藏分区 tabs 与策展五桶分类 chips（装机必备 / 崔添翼精选 / iasi自研 / 腾讯轻量云专区 / 观察区）" width="86%">
  <p><sub>精选清单 · 策展五桶分类：装机必备 / 崔添翼精选 / iasi自研 / 腾讯轻量云专区 / 观察区</sub></p>
</div>

清单运行时经 **GitHub 原始文件（raw @main）→ GitHub 镜像（jsDelivr CDN，备用线路）** 双线路获取（按上次成功线路自适应排序），失败回落本地 60 分钟 TTL 缓存与包内快照——清单更新与插件发版**解耦**，push 后最多等一个缓存周期（可在设置页强制刷新）。增补 / 修订条目直接改 `registry.json` 发 PR，CI 自动校验：严格 schema、npm 包与 GitHub 仓库存在性、重复 id、URL 可达性。

**自定义精选清单（整体替换默认清单）**：设置页支持单一自定义 registry 地址，**整体替换**默认精选清单（不合并），且**仅影响精选区**——社区目录不受影响：

1. 「下载默认清单」得到一份官方清单副本；
2. 自行编辑副本（增删条目）；
3. 在设置页填入副本地址并「校验并应用」——支持 **HTTPS URL**、本机**绝对路径 / `file://`**（HTTP 仅限 127.0.0.1/localhost 本机调试）；
4. 校验失败（字段错误、路径不存在、超过 2 MiB / 1,000 条等）不会保存配置，当前生效清单保持不变；应用成功**即时生效，无需重启**（仅首次部署新版本 dsh-m 需要一次重启）；
5. 「恢复默认」一键回到官方清单。

规则与边界：严格 v1 schema（未知字段 / 非法 ID / 超限 / 重复一律拒绝，不截断）；副本是独立快照，**不会自动同步**官方新条目；自定义源失败时保留其最近一次成功缓存，绝不静默回退官方清单；切换后旧自定义源缓存会被清理（默认缓存保留）；自定义清单未经官方 CI 校验，请确认来源可信再安装；完整本地路径只在设置页显示，工具与卡片只显示短状态。

安全基线：拉取仅 HTTPS（loopback HTTP 除外）+ 重定向逐跳校验 + 体积上限 + 超时；npm 安装按精确版本 dist integrity 对照 pnpm lockfile 校验，不一致 fail closed 并回滚；GitHub 安装强制锁定 commit SHA；pnpm 构建脚本被拦时按策略放行并明确报告。

## 文档

| 文档 | 什么时候读 |
|---|---|
| [CHANGELOG.md](https://github.com/iasiv5/dsh-m/blob/main/CHANGELOG.md) | 查看任意版本的变更明细（双语，自 0.4.x 起完整收录） |
| [docs/DESIGN.md](https://github.com/iasiv5/dsh-m/blob/main/docs/DESIGN.md) | 设计共识、面板行为细则、双代兼容与重启链路；开发与发版流程见其 §6 |
| [docs/adr/](https://github.com/iasiv5/dsh-m/tree/main/docs/adr) | 架构决策记录：委派与降级、精确构建放行、社区清单合并、分区市场、双 profile |
| [docs/registry-copy-guide.md](https://github.com/iasiv5/dsh-m/blob/main/docs/registry-copy-guide.md) | 为精选清单条目撰写 description 与 tags |
| [docs/plans/](https://github.com/iasiv5/dsh-m/tree/main/docs/plans) | 各版本实施计划存档 |

## FAQ

**1. 为什么 GitHub 来源的更新提示不走 main HEAD？**
main 上的中间提交可能不稳定。dsh-m 只跟踪 **release / tag**（优先 `releases/latest`，无 release 回退 tags 列表），安装时锁定 tag 指向的 commit SHA。

**1.5 官方 Desktop 上能用哪些功能？**
Desktop（desktop profile）支持浏览市场、**安装新包**和插件开关。自 0.9.8 起，升级、卸载与 dsh-m 自更新也已委派官方 `pluginManager`；服务不可用时会返回结构化拒绝与操作指引。一键重启仍由官方 Desktop 应用生命周期负责，请退出并重新打开应用。市场安装标注与已装列表只反映 Desktop 当前 profile；收藏和操作记录不与 Web 同步。

**2. 卸载 dsh-m 会删我的数据吗？**
不会。只移除 profile 中的包引用（卸载前先下线运行中的界面），并把疑似残留路径报告给你。

**3. 自定义清单会让市场变慢吗？**
市场列表是服务端分页（每页 24/48/96 可选），1,000 条清单第一页也只查询当前页的最新版本，浏览仍然流畅。

**4. 自定义源挂了怎么办？**
优先使用该源最近一次成功的缓存（设置页「生效来源」会如实标注）；完全没有缓存时市场会提示清单不可用，已安装插件仍可正常管理。修正地址或恢复默认即可。

**5. 支持哪些 DSH Web 版本？**

| DSH 版本 | 设置服务通路 | 核验状态 |
|---|---|---|
| `0.1.2-rc.1` | 形态探测降级 cordis 配置通路 | 契约核对 |
| `0.1.5-rc.1` / `rc.2` | `register()` scope 通路 | 已核对；rc.1 另有 `/dshm` ping 与带认证页面 `303 → 200` 实测 |
| `0.1.7-rc.1` / `rc.2` | Config `.volatile()` 字段 + `settings.update` + `loader/volatile-update` 事件 | 已核对；两个 rc 的 dsh-settings 逐字节一致，一套实现通吃 |
| `0.2.0-rc.1` / `rc.2` | 同 `0.1.7` 通路 | `rc.2` 为当前实机运行代际，重启链路于 2026-10-01 实机核验 |

- 通路在运行时按**形态探测**选择，不按版本号分支；未识别的形态自动降级 cordis 配置文件通路，市场主功能不受影响。实现细节见 [`docs/DESIGN.md`](https://github.com/iasiv5/dsh-m/blob/main/docs/DESIGN.md) §12。
- systemd 部署需为 unit 配置 `Restart=on-failure` 或 `Restart=always`，否则请使用部署方的手动重启方式。

## License

MIT
