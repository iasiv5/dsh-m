# dsh-m — DeepSeek Harness 插件市场

[![Release](https://img.shields.io/github/v/release/iasiv5/dsh-m?label=Release&sort=semver)](https://github.com/iasiv5/dsh-m/releases)
[![npm](https://img.shields.io/npm/v/dsh-m?label=npm)](https://www.npmjs.com/package/dsh-m)
[![Registry Check](https://img.shields.io/github/actions/workflow/status/iasiv5/dsh-m/registry.yml?branch=main&label=Registry%20Check)](https://github.com/iasiv5/dsh-m/actions/workflows/registry.yml)
[![License](https://img.shields.io/github/license/iasiv5/dsh-m?label=License)](./LICENSE)
[![DSH Web](https://img.shields.io/badge/DSH%20Web-0.1.2--rc.1%20%E2%86%92%200.2.0--rc.2-2563eb)](#兼容与常见问题)

[English](./README.en.md) · 中文

dsh-m 把 DeepSeek Harness（DSH）的插件**发现、安装、管理与更新**放进同一个界面。社区目录与人工精选同时可搜；侧栏面板、8 个 Agent 工具和 `dshm` CLI 共用一套市场数据。无需额外的市场服务器或账号，插件操作仍由本机 DSH 宿主管理。

![侧栏插件市场：精选分区、分类与插件卡片](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/marketplace.webp)

## 30 秒上手

在 DSH 官方「插件管理 → 添加插件」中输入 `dsh-m`，选择可用的安装源并安装。**Web 重启服务并刷新页面；Desktop 退出并重新打开应用**。随后从侧栏底部进入「插件市场」。

![在 DSH 官方插件管理界面安装 dsh-m](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/official-plugin-install.webp)

无图形界面的 Web 宿主也可执行 `dsh plugin --profile web add dsh-m`。Node.js 需 ≥ 22；支持的 DSH 代际见[兼容表](#兼容与常见问题)。`npm install -g dsh-m` **仅安装独立 `dshm` CLI**，不会把市场插件注册到 DSH profile。

> 官方插件管理界面的就地更新能力以宿主版本和界面提示为准；如果明确提示不支持，请按提示卸载旧版后重新安装。卸载不会自动清除插件数据。

## 浏览、搜索与安装

- **社区 + 精选**：社区目录默认开启，收录 4,000+ 个条目；精选清单按「装机必备 / 崔添翼精选 / iasi自研 / 腾讯轻量云专区 / 观察区」策展。重名条目以精选为准，社区区不重复展示。
- **分区浏览、全局搜索**：分类、排序和分页在各区独立保留；输入中文或英文关键词时，同时搜索社区与精选，并分别展示命中数。收藏是本机当前 profile 的便捷入口。
- **安装前先看详情**：卡片显示来源、安装状态与版本；详情展示说明、兼容信息和可用的安装入口。npm 包锁定**精确版本并校验 integrity**，GitHub 来源锁定 **commit SHA**；peer 不兼容时先提示风险，未经确认不强行安装。

| 社区分类 | 精选策展 |
|---|---|
| ![社区目录与开放分类筛选](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/community-catalog.webp) | ![精选清单的五类策展分区](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/curated-registry.webp) |

![跨区搜索「皮肤」：精选命中置顶，社区命中分组呈现](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/search-results.webp)

![插件详情：分类、版本、来源、安装命令和安装入口](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/plugin-detail.webp)

> **社区收录不是安全审查。** 4,000+ 条目录来源广泛，安装前请核对作者、代码与所需能力；能力字段缺失表示「未扫描」，不表示「未发现风险」。

## 已装插件与设置

「**已装**」只反映当前宿主 profile 的实际插件：区分市场/非市场来源，显示运行相位与可用更新，并提供开关、升级和确认后卸载；相关操作进度与结果会统一记录。开关可能即时生效或需要重启，应以操作结果为准。卸载只移除插件引用，不会默默删除用户数据，疑似残留路径会单独报告。

![已装页：版本、来源、运行状态与开关；截图已隐藏本机 profile 路径](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/installed.webp)

「**设置**」可查看社区目录的版本、获取线路和缓存状态，开关或锁定社区目录版本；也可下载默认精选清单、填入自定义地址并**校验后整体替换精选区**（社区区不变）。校验失败不改当前生效配置；恢复默认或成功应用均无需重启。

![设置页：社区目录状态与精选清单配置](https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/settings.webp)

自定义地址支持 HTTPS、本机绝对路径或 `file://`（HTTP 仅限 loopback 调试），清单大小 ≤ 2 MiB、条目 ≤ 1,000。自定义源是独立快照，**不会自动同步默认精选**；源失效时保留该源最近的成功缓存，不会暗中切回默认。添加精选条目或了解完整校验规则，请看 [清单文案指南](https://github.com/iasiv5/dsh-m/blob/main/docs/registry-copy-guide.md)与[设计文档](https://github.com/iasiv5/dsh-m/blob/main/docs/DESIGN.md)。

## Agent 工具与 CLI

| Agent 工具 | 能做什么 |
|---|---|
| `dshm_search` | 同时搜索社区与精选，在对话内展示插件卡片 |
| `dshm_list` · `dshm_outdated` | 列当前 profile 实装与可更新插件 |
| `dshm_install` · `dshm_upgrade` · `dshm_uninstall` | 安装、升级、确认后卸载；兼容风险先行提示 |
| `dshm_toggle` · `dshm_restart` | 切换运行状态；经用户同意后重启 Web |

```sh
dshm search --query 主题 --source all
dshm list
dshm outdated
dshm install --id dsh-web-search
dshm upgrade --pkg dsh-web-search --yes
dshm uninstall --pkg dsh-web-search --yes
dshm toggle --pkg dsh-web-search --off --yes
dshm restart --yes
```

GUI 与 Agent 工具始终跟随**当前宿主 profile**（Web / Desktop）；独立 CLI 则**只操作 web profile**，`--profile desktop` 会拒绝。`--force` 可在用户已确认 peer 不兼容风险后用于安装或升级。`registry`、`search`、`outdated` 在清单不可用时明确失败，`list` 仍可列已装插件。完整参数与运行策略见[设计文档](https://github.com/iasiv5/dsh-m/blob/main/docs/DESIGN.md)。

## 兼容与常见问题

| DSH Web 代际 | 设置通路 | 核验情况 |
|---|---|---|
| `0.1.2-rc.1` | cordis 配置降级 | 契约核对 |
| `0.1.5-rc.1 / rc.2` | `register()` scope | 已核对；rc.1 另有页面实测 |
| `0.1.7-rc.1 / rc.2` | `.volatile()` + `settings.update` | 已核对 |
| `0.2.0-rc.1 / rc.2` | 同 0.1.7 通路 | rc.2 与重启链路实测 |

**Desktop 与 Web 完全一样吗？** 不是。Desktop 的浏览、安装新包和开关作用于 desktop profile；升级/卸载等操作需宿主官方 `pluginManager` 提供相应能力，缺失时返回结构化拒绝和指引。Desktop 不提供 Web 的一键重启；变更需按应用提示退出并重新打开。两边的收藏、操作记录和已装状态互不串联。

**安装、更新后何时生效？** Web 按操作返回的激活要求处理：仅客户端更新可刷新页面；需要重启时先征得同意，再由宿主完成重启与后台重连。使用 systemd 时须有 `Restart=on-failure` 或 `Restart=always`；否则采用部署方的重启方式。

**为什么 GitHub 插件的更新不跟踪 `main`？** 中间提交可能不稳定，dsh-m 跟踪 release / tag，并锁定其 commit SHA。匿名 GitHub 配额有限，未完成的检查会如实显示，不冒充「全部最新」。

**自定义清单不可用怎么办？** 优先使用该源上次成功的缓存；没有缓存时会提示清单不可用，已装管理仍能工作。修正地址或在设置页恢复默认即可。

完整沿革见 [CHANGELOG](https://github.com/iasiv5/dsh-m/blob/main/CHANGELOG.md)，设计与开发细节见 [DESIGN](https://github.com/iasiv5/dsh-m/blob/main/docs/DESIGN.md)、[ADR](https://github.com/iasiv5/dsh-m/tree/main/docs/adr)。截图取自 Web 实例；面板版本、条目数与安装状态会随时间和 profile 变化。在源码仓库运行 `npm install && npm run capture:readme` 可复现截图（需 Web 实例已装 dsh-m；此开发脚本不随 npm 插件包分发）。

## License

[MIT](./LICENSE)
