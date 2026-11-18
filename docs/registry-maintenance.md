# 收录面维护台账

registry.json 条目的收录后生命周期记录：上游变动触发的链接降级与下架，逐次一行一条，含依据与回滚路径。收录标准与政策见 [CONTRIBUTING](../CONTRIBUTING.md)；条目文案规范见 [registry-copy-guide](./registry-copy-guide.md)。

| 日期 | 条目 | 动作 | 依据（当场实测） | 回滚 |
|---|---|---|---|---|
| 2026-11-15 | `dsh-claude-slides` / `dsh-claude-design` / `dsh-claude-design-system` / `dsh-claude-dashboard` / `dsh-claude-motion`（baoyu 分类） | **纯 npm 化**：删 `github` + `homepage` 双字段，安装/升级/README 全走 npm 通道不变 | 上游仓库 `JimLiu/baoyu-design` 已从 GitHub 公开面消失（API 404 无重定向 = 删除或转私，改名会 301）；npm 侧五包均 2.16.0、作者 jimliu 本人 2026-11-13 仍在发版，安装面不受影响；repo 内容有第三方镜像存档（agent-skills-mirror `mirrors/repos/JimLiu@baoyu-design/`）。0.12.17 发版评估（2026-11-15）由 Registry check 联网段揪出 | 作者仓库恢复公开后单 commit 改回 github/homepage，并可经 `scripts/sync-registry-screenshots.mjs` 挂内嵌截图 |
| 2026-11-15 | `browser-skill-dsh-plugin`（tencent-lighthouse 分类，3→2 条） | **下架** | 上游 0.5.0（2026-11-12 发布官方 npm 包装后一天）随 [#731](https://github.com/Tencent/BrowserSkill/pull/731) 主动退役插件形态：上游 CHANGELOG 明文 "Retired and removed `packages/dsh-plugin-browserskill` … DeepSeek Harness now uses the standard skill installation path"；官方接棒通道 = `bsk install-skill --harness dsh`（技能形态，不在插件市场范畴）。npm 包装包 0.5.0 为终版（源码目录已删，不再更新），对 0.5.0 后 daemon（protocol 2.0 基线）的可用性未实证——精选面不背书上游已弃的冻结形态 | `git revert` 单条恢复；npm 包 `@wxg-prc-cpg/browser-skill-dsh-plugin` 仍在，已装用户升级面不受影响 |
| 2026-11-18 | `dsh-claude-slides` / `dsh-claude-design` / `dsh-claude-design-system` / `dsh-claude-dashboard` / `dsh-claude-motion`（baoyu 分类）维持纯 npm；新增 `dsh-open-artifact`（baoyu，npm + github 双源，继任者条目） | **不恢复旧 5 条的 github / homepage**；2026-11-15 行「作者恢复后单 commit 改回」的回滚路径失效（原仓库名已被新项目占用） | 旧名 `JimLiu/baoyu-design` API 301 → 仓库 ID 1460814476 = `JimLiu/open-artifact`（created 2026-11-17；默认分支 16 个提交，最早为 "Initial commit: Open Artifact (formerly baoyu-design)"；默认分支历史中从未出现 `dsh-plugins/` 路径）；其 `artifact-types` 仅 design-system / design / slides / whiteboard，无 dashboard / motion 对应；npm `dsh-open-artifact` 0.7.0（2026-11-17，`repository.directory = plugins/dsh`，engines.dsh ≥0.2.0-0、node ≥22.18，icon@0 可达）；旧 5 包 npm 2.16.0 未弃用，`repository` 仍指向旧 `dsh-plugins/` 路径 | 撤回新增：删除 `dsh-open-artifact` 条目，并把 copy-guide 与 registry.test 计数锚回退 37→36；若作者重新公开发布 `dsh-plugins/` 源码，可单 commit 改回旧 5 条的 github / homepage |

## 记账口径

- **历史文档不追溯修订**：本台账只记「动作发生时点」的事实。ADR-0025 图标缺席名单、CHANGELOG 0.11.x 收录条目中的 baoyu-design 提述均为当时点历史记录，保持原样。
- **`client-operations.test.mjs` 与 search 语料夹具中的 baoyu-design/browser-skill 字符串是合成测试锚**（不读 registry.json），随条目下架/降级不联动修改。
- 迁移面：条目删 `github` 后，升级/操作匹配不受影响（`opAppliesTo` 按 pkg/npm/registryId 匹配，不读 github 键）；卡片图标回退首字母块（`icon-view.js` 候选链为空时的既有行为）。
