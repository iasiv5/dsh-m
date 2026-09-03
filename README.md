# dsh-m — DSH Marketplace

**个人自用的 DeepSeek Harness (DSH) 插件市场**：收录、安装、卸载、升级 DSH 插件，全部本机完成。

以 **DSH web 插件**形态运行：侧栏「🛍 DSH 市场」打开三视图界面（市场 / 已装 / 设置），同时提供 7 个 `dshm_*` agent 工具和 `dshm` CLI。设计共识见 [DESIGN.md](./DESIGN.md)。

## 安装（进 DSH）

```bash
npm install -g dsh-m   # 或由你的 DSH 插件市场/手动装进 web profile
```

装好后**重启 dsh web** 即生效：侧栏底部出现「🛍 DSH 市场」。

## 界面

- **市场页**：收录卡片流，关键词搜索 + 分类筛选 + 标签；点卡片展开详情与「安装」。
- **已装页**：web profile 实际安装列表，标注「市场安装 / 非市场安装」与可升级徽标；升级 / 两段式确认卸载。
- **设置页**：收录清单缓存状态与强制刷新、registry 源覆盖、dsh-m 自更新。

安装/卸载/升级完成后出现「需重启生效 [⚡ 一键重启]」横幅——重启走 systemd 单元（同源校验，兜底 detached helper），恢复后自动就绪。

## Agent 工具

| 工具 | 用途 |
|---|---|
| `dshm_search` | 搜收录清单（对话内出卡片） |
| `dshm_list` | 列 web profile 已装插件（市场/非市场标注） |
| `dshm_install` | 按收录 id 安装（npm 精确锁定 / GitHub 锁 SHA） |
| `dshm_uninstall` | 卸载（先确认；不删数据，报告残留路径） |
| `dshm_outdated` | 检查最新版本 |
| `dshm_upgrade` | 升级到最新 |
| `dshm_restart` | 一键重启 DSH Web（先征得同意） |

## CLI

```bash
dshm search [--query 主题] [--category ui]
dshm list
dshm outdated
dshm install --id dsh-web-search
dshm upgrade --pkg dsh-web-search --yes
dshm uninstall --pkg dsh-web-search --yes
dshm restart --yes
```

## 收录清单（registry）

`registry.json` 手工 curated，运行时经 **jsDelivr/raw `@main`** 分发（本地 TTL 缓存 + 包内快照兜底）——收录更新与插件发版解耦。收录/修订直接改 `registry.json` 发 PR，CI 会校验 schema、npm 包 / GitHub 仓库存在性、重复 id 与 URL 可达性。

安全基线：拉取仅 HTTPS + 体积上限 + 超时；npm 安装按 lock integrity 校验 + 装后版本核对；GitHub 安装强制锁定 commit SHA；pnpm 构建脚本被拦时按策略放行并明确报告。

## 开发

```bash
npm ci
npm run build        # tsc（host/core/cli）+ esbuild（client，tree-shaking 关闭）
npm run typecheck
node scripts/validate-registry.mjs
```

发版：`npm version patch|minor|major && git push --tags` → 现有 OIDC trusted publishing 流水线发布。

## License

MIT
