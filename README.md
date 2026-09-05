# dsh-m — DeepSeek Harness 插件市场

[![Release](https://img.shields.io/github/v/release/iasiv5/dsh-m?label=Release&sort=semver)](../../releases)
[![npm](https://img.shields.io/npm/v/dsh-m?label=npm)](https://www.npmjs.com/package/dsh-m)
[![Registry Check](https://img.shields.io/github/actions/workflow/status/iasiv5/dsh-m/registry.yml?branch=main&label=Registry%20Check)](../../actions/workflows/registry.yml)
[![License](https://img.shields.io/github/license/iasiv5/dsh-m?label=License)](./LICENSE)
[![DSH Web](https://img.shields.io/badge/DSH%20Web-0.1.2--rc.1%20verified-2563eb)](#faq)

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
2. 重启 DSH Web 使插件加载（本机：`systemctl --user restart dsh-web.service`；或按你的部署方式重启）
3. 轮询 `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080`，直到恢复 200
4. 执行 `curl -s -X POST http://127.0.0.1:3080/dshm -H 'content-type: application/json' -d '{"method":"ping"}'`，确认返回 `plugin: dsh-m`
5. 完成后提醒我刷新页面，点击侧栏底部的「插件市场」
```

> `npm install -g dsh-m` 只安装 `dshm` CLI（终端管理用），**不会**把插件注册进 web profile；与上面插件安装不冲突，可并存。

默认收录清单里的插件包括：DSH Skins、ModSearch、Lark / QQ / 微信 / 企业微信 / 钉钉通道桥，以及 dsh-m 自身。

## 界面（侧栏「插件市场」）

| 视图 | 能力 |
|---|---|
| **市场** | 收录卡片流；关键词搜索、分类筛选（服务端过滤 + 分页，每页 50 条，1,000 条清单也只探测当前页）；卡片展开详情与「安装」；npm 源锁定最新精确版本，GitHub 源锁定 release/tag 指向的 commit |
| **已装** | web profile 实装列表，标注「市场安装 / 非市场安装」；可升级徽标、升级、两段式确认卸载；📖 README 预览（64KB 截断） |
| **设置** | registry 地址草稿 +「校验并应用 / 恢复默认 / 下载默认 registry.json / 检查条目可达性」；配置地址、生效来源与状态一目了然；强制刷新；dsh-m 自更新 |

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

## License

MIT
