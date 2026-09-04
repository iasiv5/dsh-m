# dsh-m — DeepSeek Harness 插件市场

[![Release](https://img.shields.io/github/v/release/iasiv5/dsh-m?label=Release&sort=semver)](../../releases)
[![npm](https://img.shields.io/npm/v/dsh-m?label=npm)](https://www.npmjs.com/package/dsh-m)
[![Registry Check](https://img.shields.io/github/actions/workflow/status/iasiv5/dsh-m/registry.yml?branch=main&label=Registry%20Check)](../../actions/workflows/registry.yml)
[![License](https://img.shields.io/github/license/iasiv5/dsh-m?label=License)](./LICENSE)
[![DSH Web](https://img.shields.io/badge/DSH%20Web-0.1.1--rc.2%20verified-2563eb)](#faq)

[English](./README.en.md) · 中文

个人自用的 DeepSeek Harness (DSH) 插件市场：**收录 · 安装 · 卸载 · 升级**，全部本机完成。以 DSH web 插件形态运行——侧栏「插件市场」打开三视图面板，同时提供 `dshm_*` agent 工具与 `dshm` CLI。

## 30 秒上手

```sh
npm install -g dsh-m          # 或 dsh plugin --profile web add dsh-m@<version>
```

1. 安装后**重启 DSH Web**（一键重启亦可）。
2. 刷新页面，点击侧栏底部的「**插件市场**」。

收录清单里的首批插件：DSH Skins、DSH Web Search、Lark / QQ / 微信 / 企业微信 / 钉钉通道桥，以及 dsh-m 自身。

## 界面（侧栏「插件市场」）

| 视图 | 能力 |
|---|---|
| **市场** | 收录卡片流；关键词搜索、分类筛选、标签；卡片展开详情与「安装」；npm 源锁定最新精确版本，GitHub 源锁定 release/tag 指向的 commit |
| **已装** | web profile 实装列表，标注「市场安装 / 非市场安装」；可升级徽标、升级、两段式确认卸载；📖 README 预览（64KB 截断） |
| **设置** | 收录清单缓存状态与强制刷新、registry 源覆盖、dsh-m 自更新 |

安装 / 卸载 / 升级完成后出现「⚡ 一键重启」横幅——重启走 systemd 单元（同源校验，兜底 detached helper），按 boot id 轮询直至服务恢复。安装过程实时显示 pnpm 进度（解析 → 下载 → 链接 → 构建）。

## Agent 工具（7 个）

| 工具 | 用途 |
|---|---|
| `dshm_search` | 搜收录清单（对话内出卡片） |
| `dshm_list` | 列已装插件（市场/非市场标注） |
| `dshm_install` | 按收录 id 安装 |
| `dshm_uninstall` | 卸载（先确认；不删数据，报告残留路径） |
| `dshm_outdated` | 检查最新版本 |
| `dshm_upgrade` | 升级到最新 |
| `dshm_restart` | 一键重启 DSH Web（先征得同意） |

## CLI

```sh
dshm search [--query 主题] [--category ui]
dshm list | outdated | registry
dshm install --id dsh-web-search
dshm upgrade --pkg dsh-web-search --yes
dshm uninstall --pkg dsh-web-search --yes
dshm restart --yes
```

## 收录清单（registry）

`registry.json` 手工 curated，运行时经 **raw.githubusercontent / jsDelivr `@main`** 分发（本地 60 分钟 TTL 缓存 + 包内快照兜底）——收录更新与插件发版**解耦**。收录 / 修订直接改 `registry.json` 发 PR，CI 自动校验：schema、npm 包与 GitHub 仓库存在性、重复 id、URL 可达性。

安全基线：拉取仅 HTTPS + 体积上限 + 超时；npm 安装按 lock integrity 校验 + 装后版本核对；GitHub 安装强制锁定 commit SHA；pnpm 构建脚本被拦时按策略放行并明确报告。

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

**为什么 GitHub 来源的更新提示不走 main HEAD？**
main 上的中间提交可能不稳定。dsh-m 只跟踪 **release / tag**（优先 `releases/latest`，无 release 回退 tags 列表），安装时锁定 tag 指向的 commit SHA。

**卸载会删我的数据吗？**
不会。只移除 profile 中的包引用（卸载前先下线运行中的界面），并把疑似残留路径报告给你。

**支持第三方皮肤吗？**
支持。全部配色来自 DSH 主题语义 token（`state-*` / `brand-*` / `bg-overlay` 等），官方深浅色与第三方皮肤均已验证。

## License

MIT
