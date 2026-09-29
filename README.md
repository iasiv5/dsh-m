# dsh-m — DeepSeek Harness 插件市场

[![Release](https://img.shields.io/github/v/release/iasiv5/dsh-m?label=Release&sort=semver)](../../releases)
[![npm](https://img.shields.io/npm/v/dsh-m?label=npm)](https://www.npmjs.com/package/dsh-m)
[![Registry Check](https://img.shields.io/github/actions/workflow/status/iasiv5/dsh-m/registry.yml?branch=main&label=Registry%20Check)](../../actions/workflows/registry.yml)
[![License](https://img.shields.io/github/license/iasiv5/dsh-m?label=License)](./LICENSE)
[![DSH Web](https://img.shields.io/badge/DSH%20Web-0.1.2--rc.1%20%E2%86%92%200.1.7--rc.2%20dual--API-2563eb)](#faq)

[English](./README.en.md) · 中文

可自定义收录清单（Registry）的 DeepSeek Harness (DSH) 插件市场：**收录 · 安装 · 卸载 · 升级**，全部本机完成。以 DSH web 插件形态运行——侧栏「插件市场」打开三视图面板，同时提供 `dshm_*` agent 工具与 `dshm` CLI。

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/marketplace.webp" alt="侧栏「插件市场」面板——市场视图：收录卡片流、关键词搜索与分类筛选" width="100%">
  <p><sub>侧栏「插件市场」· 市场视图：收录卡片流 · 搜索 · 分类筛选 · 展开即装</sub></p>
</div>

## 30 秒上手

**把下面整段贴给 agent 即可完成安装**：

```text
安装并启用 DSH 插件 dsh-m：
1. 执行 `dsh plugin --profile web add dsh-m`
2. 重启 DSH Web 使插件加载（按部署方式重启对应的 DSH user unit；unit 名称不要硬编码）
3. 轮询 `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080`，直到恢复 200
4. 执行 `curl -s -X POST http://127.0.0.1:3080/dshm -H 'content-type: application/json' -d '{"method":"ping"}'`，确认返回 `plugin: dsh-m`
5. 完成后提醒我刷新页面，点击侧栏底部的「插件市场」
```

> `npm install -g dsh-m` 只安装 `dshm` CLI（终端管理用），**不会**把插件注册进 web profile；与上面插件安装不冲突，可并存。

默认收录清单里的插件包括：DSH Skins、ModSearch、Lark / QQ / 微信 / 企业微信 / 钉钉通道桥，以及 dsh-m 自身。

## 界面（侧栏「插件市场」）

| 视图 | 能力 |
|---|---|
| **市场** | **分区制**（0.7.0）：**社区**（默认落地页，4,000+ 条全量目录）与**精选**（手工策展主清单，单页直出）两个独立分区，各有自己的分类/搜索/排序/分页状态（切 tab 互不重置）；另有**收藏**分区（浏览器本地书签，自动检测下架条目并一键清理）。社区区：分类 chips 两行折叠 + 吸顶收缩、排序（下载量/Star/收录日期 × 升降）、页码窗口化分页（24/48/96 每页）、卡片 byline（作者/下载量/Star）；卡片点开**详情 Modal**（卡片信息超集：下载量窗口三要素、截图灯箱、能力披露默认收起、安装命令）；npm 源锁定最新精确版本，GitHub 源锁定 release/tag 指向的 commit |
| **操作记录** | 安装/升级/卸载/开关全部走全局操作记录（0.7.0）：状态不挂卡片，翻页/搜索/切 tab 不丢；localStorage 持久化，宿主重载后自动恢复未完成操作（逐条校验「此刻仍成立才执行」）；良性前提消失以中性「已跳过」呈现；已装页支持「全部更新 (N)」批量入队 |
| **已装** | web profile 实装列表，标注「市场安装 / 非市场安装」；可升级徽标、升级、两段式确认卸载；📖 README 预览（64KB 截断）；**运行相位徽标**（●active / ●failed / ○pending）与**一键开关**（0.4.0：委派官方 pluginManager 服务活体生效，服务缺席时文件级编辑 + 重启提示；dsh-m 自身与官方宿主命脉锁定不可开关） |
| **设置** | registry 地址草稿 +「校验并应用 / 恢复默认 / 下载默认 registry.json / 检查条目可达性」；配置地址、生效来源与状态一目了然；强制刷新；dsh-m 自更新 |

安装 / 卸载 / 升级完成后，当前已打开的市场页与已装页会一起重新读取 profile 状态并同步徽标/卡片，不需要关闭后重新打开插件市场；随后出现「⚡ 一键重启」横幅——受 systemd 管理时通过 DSH launcher 的 `appExit` 交给服务的 `Restart` 策略，避免在待停止 unit 的 cgroup 内启动 `systemctl` helper；无 `appExit` 的 systemd 兜底改用 manager-owned transient `systemd-run`，最后才退回 detached-helper。客户端按 boot id 确认新进程已恢复后关闭横幅，交由 DSH Web 自身的后台连接重试恢复页面，不强制整页刷新，避免认证/路由切换期间白屏。已完成当前 DSH Web `0.1.5-rc.1` 运行时的 live 核验：web profile 已加载 dsh-m `0.2.11`，重启后 `/dshm` ping 返回 `version: 0.2.11`，携带当前认证 token 的页面请求流程为 `303 → 200`；无认证请求会被拒绝。此次白屏截图对应的 404 在服务稳定后未复现；journal 显示截图时段发生多次 `status=75/TEMPFAIL` 重启，当前暂判定为重启/认证过渡窗口现象，未发现 dsh-m Host 路由崩溃。DSH `0.1.2-rc.1` live E2E、transient fallback live E2E，以及连续安装/卸载实验仍是正式发布前的验证 gap。安装过程实时显示 pnpm 进度（解析 → 下载 → 链接 → 构建）。

### 0.7.0 新增

- **分区制市场**（[ADR-0004](./docs/adr/0004-zoned-market-display.md)）：数据层双清单合并不变，展示层按「社区（默认）/ 精选 / 收藏」三分区呈现；`dshm_search` 与 `dshm search` 改用 `--source community|primary|all` + `--offset` 真翻页（默认 10 条），`primary_only` 退役。
- **搜索相关性**：NFKC 归一化 + 中西文边界 + 字段加权（name/npm > owner > 描述 > 分类 > tags），多词同字段全命中；id 整串精确匹配最高优先。
- **操作记录 + 恢复执行器**、**本地收藏 + 下架清理**、**详情 Modal + 截图灯箱**、社区卡 byline/deprecated 徽章/目录版本快照兜底（不参与 outdated 判定）。

### 0.4.0 新增

- **开关（Enablement Toggle）**：已装卡片一键启停，内部自动路由行覆盖（单行插件，即时生效）或 Bundle 选择（多行插件）；写路径委派官方 `pluginManager` 服务、缺席时降级 loader 直操作（[ADR-0001](./docs/adr/0001-delegate-with-fallback-for-plugin-manager.md)）。
- **运行相位徽标**：loader fiber 状态投影，failed 一眼可见。
- **保护名单**：`dsh-m` 自身与官方宿主命脉 16 项不可开关、不可卸载（升级不受影响）。
- **精确构建放行**：needs-builds 拦截后按 pnpm 待决名单逐键放行，全量放行降为兜底并如实标注（[ADR-0002](./docs/adr/0002-precise-build-approval.md)）。
- **peer 兼容预检**：安装/升级前校验 `@deepseek-ai/dsh(-*)` peers 与运行时版本（GitHub 源明示未检）；不兼容时 GUI 弹确认、agent 回结构化结果、CLI `--force`。
- **实测版本清单（verified）**：registry 条目可选 `verified` 数组记录实测过的 DSH 运行时版本——实测声明而非预测声明，只展示不拦截。
- **bundle 身份验证**：装后检测无补丁层的包并警告「已装入为纯依赖」。

### 0.4.x 退役

- **元数据源竞速**：0.4.0 曾引入 npmjs / npmmirror ping 竞速选择元数据读取源，现整体移除（含 `probeEnabled` / `probeTimeoutMs` / `probeCacheTtlMin` 三个设置项与设置页展示）。官方同款探测只服务于「安装对话框 registry 默认预选」，dsh-m 无此交互；实测宿主机 npmjs 稳定更快，探测恒等默认行为。元数据读取固定走 npmjs，与安装链路（profile `.npmrc` 默认源）一致。

## Agent 工具（8 个）

| 工具 | 用途 |
|---|---|
| `dshm_search` | 搜收录清单（对话内出卡片） |
| `dshm_list` | 列已装插件（市场/非市场标注） |
| `dshm_install` | 按收录 id 安装（装前 peer 兼容预检；不兼容时回结构化结果，用户确认后 `force` 重试） |
| `dshm_uninstall` | 卸载（先确认；不删数据，报告残留路径） |
| `dshm_outdated` | 检查最新版本 |
| `dshm_upgrade` | 升级到最新 |
| `dshm_toggle` | 切换插件运行状态（0.4.0；默认先确认，用户同句已明确可直接执行） |
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

## 收录清单（registry）

`registry.json` 手工 curated，运行时按 **GitHub 原始文件（raw @main）→ GitHub 镜像（jsDelivr CDN，备用线路）→ 本地 60 分钟 TTL 缓存 → 包内快照** 的顺序获取——收录更新与插件发版**解耦**，push 后最多等一个缓存周期（可在设置页强制刷新）。收录 / 修订直接改 `registry.json` 发 PR，CI 自动校验：严格 schema、npm 包与 GitHub 仓库存在性、重复 id、URL 可达性。

**自定义收录清单（可覆盖官方清单）**：设置页支持单一自定义 registry 地址，**整体覆盖**默认清单（不合并）：

1. 「下载默认 registry.json」得到一份官方清单副本；
2. 自行编辑副本（增删条目）；
3. 在设置页填入副本地址并「校验并应用」——支持 **HTTPS URL**、本机**绝对路径 / `file://`**（HTTP 仅限 127.0.0.1/localhost 本机调试）；
4. 校验失败（字段错误、路径不存在、超过 2 MiB / 1,000 条等）不会保存配置，当前生效清单保持不变；应用成功**即时生效，无需重启**（仅首次部署新版本 dsh-m 需要一次重启）；
5. 「恢复默认」一键回到官方清单。

规则与边界：严格 v1 schema（未知字段 / 非法 ID / 超限 / 重复一律拒绝，不截断）；副本是独立快照，**不会自动同步**官方新条目；自定义源失败时保留其最近一次成功缓存，绝不静默回退官方清单；切换后旧自定义源缓存会被清理（默认缓存保留）；自定义清单未经官方 CI 校验，请确认来源可信再安装；完整本地路径只在设置页显示，工具与卡片只显示短状态。

安全基线：拉取仅 HTTPS（loopback HTTP 除外）+ 重定向逐跳校验 + 体积上限 + 超时；npm 安装按精确版本 dist integrity 对照 pnpm lockfile 校验，不一致 fail closed 并回滚；GitHub 安装强制锁定 commit SHA；pnpm 构建脚本被拦时按策略放行并明确报告。

## 社区清单（awesome-dsh-plugin 目录，0.5.0）

除手工 curated 的主清单外，市场还会叠加一层**只读的社区清单**：锚定 npm 包 [`dsh-plugin-catalog`](https://www.npmjs.com/package/dsh-plugin-catalog)（CC0-1.0，awesome-dsh-plugin 全量目录，4,000+ 条），数据层与主清单合并去重（**主清单恒优先**，重名条目社区侧让位），展示层按「社区 / 精选」分区呈现（ADR-0004）——社区区不再显示与主清单重复的条目，精选区保持策展序单页直出。

- **数据获取**：dist-tags 探测最新版本 → jsDelivr 按精确版本直取 → npmmirror → unpkg 三线路兜底；版本未变不重拉正文，TTL 内跳过探测。失败回落 `<缓存目录>/awesome/` 运行时缓存并**显式标注「缓存快照」**——过期数据绝不冒充最新。
- **开关与锁定**：设置页 `communityCatalog` 开关（默认开，live 生效）、`communityCatalogPin` 可锁定目录版本（精确 semver）；CLI 用 `DSHM_COMMUNITY_CATALOG=0` 退出、`DSHM_COMMUNITY_CATALOG_PIN` 锁版本。
- **分类与搜索**：社区分类是开放集（已知 20+ 个带中文标签，由服务端单一事实源下发）；搜索走相关性加权管线（中英文双匹配）；社区区排序可切（下载量/Star/收录日期 × 升降，默认下载量降序，无下载量 ≠ 0 下载）。
- **安装语义**：社区条目与主清单走同一 `installEntry`（npm 锁精确版本 / GitHub 锁 commit SHA）；市场浏览页只对 npm 条目做更新探测，GitHub 条目不做页面级探测（匿名配额 60 次/小时不可控）。
- **已装页预算（best-effort）**：已装页对 GitHub 来源插件做更新检查，单次请求 ≤25 个、宿主进程滚动 1 小时 ≤50 个（仅被动检查；主动安装/升级不受限）；超限条目如实标注「检查未完成」而不冒充「全部最新」。独立 CLI 进程不共享宿主内预算，并发场景不承诺 60 次/小时绝不耗尽。
- **能力披露**：社区条目的 capabilities/红线只出现在详情折叠区（**缺省 = 未扫描 ≠ 未检出**），卡片不打标；截图仅在详情层加载并经客户端白名单校验。
- **非安全审查警示**：社区目录为全量收录，**未经安全审查**——安装前请自行确认插件来源与能力；主清单的手工 curated 与 CI 校验不适用于社区条目。

## 开发

```sh
npm ci
npm run build        # tsc（host/core/cli）+ esbuild（client，tree-shaking 已关闭）
npm run typecheck
node scripts/validate-registry.mjs
```

本地调试推荐 `link:` 模式（与 dsh-skins 相同）：profile 依赖指向本仓库目录，`npm run build` + 重启即生效。

发版：`npm version patch|minor|major && git push --tags` → OIDC trusted publishing 自动发布。

## FAQ

**1. 为什么 GitHub 来源的更新提示不走 main HEAD？**
main 上的中间提交可能不稳定。dsh-m 只跟踪 **release / tag**（优先 `releases/latest`，无 release 回退 tags 列表），安装时锁定 tag 指向的 commit SHA。

**2. 卸载 dsh-m 会删我的数据吗？**
不会。只移除 profile 中的包引用（卸载前先下线运行中的界面），并把疑似残留路径报告给你。

**3. 自定义清单会让市场变慢吗？**
收录超过 200 条时会提示性能边界。市场列表是服务端分页（每页 50 条），1,000 条清单第一页也只查询当前页的最新版本，浏览仍然流畅。

**4. 自定义源挂了怎么办？**
优先使用该源最近一次成功的缓存并标记「缓存来源」；完全没有缓存时市场显示「收录清单不可用」，已安装插件仍可正常管理。修正地址或恢复默认即可。

**5. 支持哪些 DSH Web 版本？**
与 dsh-skip-browser-auth 同一口径：`0.1.2-rc.1`、`0.1.5-rc.1/rc.2`、`0.1.7-rc.1`、`0.1.7-rc.2` 的公开包契约均已核对。其中 0.1.7 把 settings 服务重塑为 `SettingsForms`（旧的 `settings.register` 消失），dsh-m 以运行时形态探测双代兼容：≤0.1.5 全代际走 `register()` scope 通路（0.1.5-rc.2 的 dsh-settings 仍为旧 API，已并入核对），0.1.7-rc.1 / rc.2 走 Config `.volatile()` 字段 + `settings.update` + `loader/volatile-update` 通路（经 tarball 逐字节比对，两个 rc 的 dsh-settings 完全相同、loader 同版，一套实现通吃）；形态不识别时自动降级 cordis 配置文件通路，市场主功能不受影响。重启方面各版本都提供 dsh-m 使用的 `appExit` launcher hook；0.1.5-rc.1 运行时已实际加载并完成 `/dshm` ping 与带认证页面 `303 → 200` 核验。0.1.7 适配的 live E2E 结论（2026-09-28 回写）：装机与 `/dshm` 工具链活性已在 0.1.7-rc.2 实证——0.4.0 → 0.4.2 连续三个版本发布收编，跨两次服务重启后 `dshm list/upgrade` 全链路可用，registry 21 条（自研七件套齐）下发正常；设置页写值持久化未单独核验（0.1.7 已迁移用户层设置存储，旧 `~/.dsh/settings.yaml` 不复存在，核验需 GUI 会话写值后重启对照，留待首次实际使用设置面板时顺手完成）。systemd 部署需要 unit 配置 `Restart=on-failure` 或 `Restart=always`，否则请使用部署方的手动重启方式。

## License

MIT
