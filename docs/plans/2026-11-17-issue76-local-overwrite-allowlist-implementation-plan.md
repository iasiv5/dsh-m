# issue #76 本地热部署升级白名单 — 实施计划（2026-11-17）

设计定稿：方案甲（默认挡 + opt-in 白名单），主人 2026-11-17 三项确认——① 方向（同意）；② adopt-online 要 + 详情弹窗一行提示；③ 名单内容 12 项（自研插件全带，npm 身份逐一核验 maintainer=iasiv5）。名单形态终版为**源码写死**（v1.3，见下节；此前 v1.1/v1.2 的 profile 文件通道已撤除）。语义裁定见 [ADR-0038](../adr/0038-local-overwrite-allowlist.md)。

## 红绿证据（先红后绿，日志在 `.dsh-research/dshm-issue76-scratch/`）

- **红**：`red-upgrade-target.test.log`（32 tests / fail 6）——设计内红 5（R1/R1b/R2/R2c/R3）+ R1c 红因不纯（夹具漏 `registryId`，红落在错误期望上，已修夹具）；`red-market.test.log`（107 / fail 3 = R4/R5/R6 全设计内红）。
- **R4 二轮修正**：`outdated` 断言 `undefined`→`false`——`InstalledItem.outdated` 是必填 boolean、装配层有 false 基线，红点判据是 `outdated !== true`（installed-updates.js `installedUpdateStats`）；红因在断言口径不在实现。
- **绿（v1.3 终版，`v13-*.log`）**：build 无 TS 错误；定向四套件 local-allow 4/4、upgrade-target 32/32、market 107/107、host-api 69/69；全量 `npm test` exit 0（2439 用例：2438 pass / 0 fail / 1 skipped——`win32 盘符大小写折叠` 为平台条件跳过的既有用例）；`npm run typecheck` exit 0。
- **收窄修正（终版审查）**：写侧与投影的本地早退由「全部 unsupported」收窄为仅 `local-spec`——非本地 unsupported 维持既有判定序，避免行为面外溢（ADR-0038 决策 1 与后果）。

## 改动清单（文件 → 内容 → 对应用例）

| 文件 | 改动 | 用例 |
|---|---|---|
| `src/core/local-allow.ts`（新） | 写死名单 `LOCAL_UPGRADE_ALLOWLIST`（12 项，第 14 行起）；判定集合 `localUpgradeAllowSet(cfg)` = 写死名单 ∪ CLI 环境变量注入（trim、去空、去重） | `tests/local-allow.test.mjs` 4 用例 |
| `src/core/upgrade-target.ts` | 判定原子 `localOverwriteAllowed`（仅 `local-spec` 适用）；`upgradePathFor`：本地未入白名单 → unsupported 先于 catalog，非本地维持既有序；`stampUpgradeProjection` 条件加标 `localUpgradeAllowed`；`synthesizeInstallableEntry` 白名单例外（adopt npm 同名）；`resolveUpgradeTarget`：本地未入白名单在 registry 加载前早退，非本地维持既有序 | R1/R1b/R1c/R2/R2b/R2c/R2d/R3 |
| `src/core/market.ts` | 两装配点传 allow（`localUpgradeAllowSet(cfg)`）；`probeLatest`：仅本地未入白名单早退（非本地维持既有探测），白名单内双 miss 走 npm-only 归一键；`InstalledItem` 类型 +`localUpgradeAllowed?: true` | R4/R5/R6 |
| `src/core/registry.ts` | `RegistryConfig.localUpgradeAllow`（脚本面注入，宿主面不进设置服务） | 类型面 |
| `src/cli.ts` | 脚本面 env：`DSHM_LOCAL_UPGRADE_ALLOW`（逗号/空白分隔，临时追加，不持久） | 既有套件回归 |
| `src/tools.ts` | `dshm_list` / updates 两处序列化放行 `localUpgradeAllowed`（普查无形状钉） | 既有套件回归 |
| `src/client/installed-tab.jsx` | 详情弹窗一行提示（`localUpgradeAllowed` 条件行） | client-i18n / render-smoke |
| `src/client/i18n.js` | `detail.localOverwrite.title/text` 双语键 | client-i18n 守卫 |
| `tests/upgrade-target.test.mjs` / `tests/market.test.mjs`（增） | 白名单形态 R1–R3（8 用例）/ 探测边界 R4–R6（3 用例） | 11 用例 |
| **无净改动（已回到 HEAD）**：`market-mutation.ts` / `profile-ops.ts`（v1.2 曾透传 profileDir，v1.3 撤除）；`host.ts` / `settings-compat.ts` / `registry-controller.ts`（settings 通道撤除后无净改动） | | |
| **不改**：`matchInstalledByEntry`（身份层，ADR-0038 决策 5）；host-api `installedUpdates` 投影（七字段冻结形状，客户端经 `...it` 保留首段标记）；client 合并白名单（同前） | | |

## 判据

```
node --test tests/local-allow.test.mjs      # 4/4
node --test tests/upgrade-target.test.mjs   # 32/32
node --test tests/market.test.mjs           # 107/107
node --test tests/host-api.test.mjs         # 69/69
npm test                                    # 全量（pretest build + import guard + 全套件）：2438 pass / 0 fail / 1 skipped（平台条件）
npm run typecheck
```

## 收尾（门控步骤，逐一请示主人）

1. CHANGELOG 0.12.21 双语条目转正（草稿见下，**须披露「名单随包发布」这一行为变化**）+ 版本三处 bump 由 `npm run release` 闭合；
2. `npm run release`（push/tag/publish——**发版需当轮明确批准**）；
3. 回帖 issue #76（草稿见下，**发帖前主人审稿**——对外动作前置检查）；
4. 升级验证（web 机 + 通知报告人升级路径）后关闭 #76（**关闭需批准**）；
5. 名单内容：已确认 12 项（含 `@iasiv5/dsh-skills`，列表按完整包名字典序排列）。

## 名单内容（写死于 `src/core/local-allow.ts`，12 项）

核验口径：npm `/latest` 的 maintainer 必须为 iasiv5（2026-11-17 逐一核验，12 项全部通过）。`dsh-auth`（hxy91819 的包，本机 runtime link 副本同源同版）**不入名单**，保持 runtime 钉版语义。

```ts
export const LOCAL_UPGRADE_ALLOWLIST: readonly string[] = [
  '@iasiv5/dsh-obmc-web',
  '@iasiv5/dsh-quota-watch',
  '@iasiv5/dsh-skills',
  '@iasiv5/dsh-skins',
  '@iasiv5/dsh-skip-browser-auth',
  '@iasiv5/dsh-surf',
  '@inventec/dsh-copilot-auth',
  '@inventec/dsh-onetree-log',
  'dsh-l',
  'dsh-m',
  'dsh-send-later',
  'dsh-stock-kanban',
]
```

名单只对 `file:`/`link:` 本地部署生效；npm 安装的包无视名单。增删插件 = 编辑该常量后发版；CLI 临时追加用 `DSHM_LOCAL_UPGRADE_ALLOW`。

## v1.3 终版：名单写死在源码（2026-11-17 当日，主人第三次定向）

主人选择：名单写死在 dsh-m 源码中，接受随 npm 包发给所有用户的代价（见 ADR-0038 决策 8）。落地：

- 名单：`src/core/local-allow.ts` 的 `LOCAL_UPGRADE_ALLOWLIST`（12 项，见上节）；增删插件 = 编辑后发版。
- 撤除文件通道：`dshm-allowlist.json`、`localUpgradeAllowFile`、`DSHM_LOCAL_UPGRADE_ALLOW_FILE`、mtime 缓存、profileDir 透传（`upgrade-target.ts` / `market.ts` / `market-mutation.ts` / `profile-ops.ts` 相关改动全部回退）。
- 保留 CLI 环境变量 `DSHM_LOCAL_UPGRADE_ALLOW`（逗号/空白分隔）作为临时追加入口，不持久。
- 测试：`tests/local-allow.test.mjs` 重写为 4 用例（名单内容钉死 / 无注入即名单 / 注入并集去重 / 精确匹配：无 scope 的 `dsh-skins` 属他人不命中）。

## v1.1 增量（历史记录，已被 v1.2、v1.3 取代）

原 settings 内联数组改为「内联 + 文件并集」双通道：名单独立成文件便于随自研插件增长维护。

- 新产地 `src/core/local-allow.ts`：`localUpgradeAllowSet`（并集派生单源）/ `readAllowFileEntries`（mtime 缓存）/ `_resetLocalAllowCacheForTests`；文件形态 = 顶层字符串数组或 `{"allow":[...]}`；坏文件/缺文件/相对路径 fail-closed。
- `upgrade-target.ts` 删本地 `localUpgradeAllowSet` 改从 local-allow 导入；`market.ts` 导入同换源。
- settings 面新增 `localUpgradeAllowFile`（registry 类型 / unwrapConfig / controller bootstrap+watch / host schema / CLI `DSHM_LOCAL_UPGRADE_ALLOW_FILE`）。
- 新套件 `tests/local-allow.test.mjs`（4 用例）。

## v1.2 中间版（历史记录，已被 v1.3 取代）

v1.1 的 settings 字段通道整体撤除（无 schema 字段 → 无设置页 UI），名单唯一用户面 = profile 目录约定文件：

- 约定路径 `<profileDir>/dshm-allowlist.json`（与 profile package.json 同层，web/desktop 各一份）；
- 脚本面 env：`DSHM_LOCAL_UPGRADE_ALLOW`（逗号/空白分隔）与 `DSHM_LOCAL_UPGRADE_ALLOW_FILE`（自定义路径，绝对或 `~/`）经 RegistryConfig 注入（宿主面恒 undefined）；
- `resolveUpgradeTarget` opts 增 `profileDir`，双梯透传；
- `tests/local-allow.test.mjs` 5 用例（双形态 / fail-closed 四态 / mtime live / 约定文件发现 / 并集去重）。

## CHANGELOG 0.12.21 草稿

**中文**：
### 0.12.21 安全修复：本地热部署撞名保护 + 升级白名单（ADR-0038）

- **安全修复（issue #76）**：`file:`/`link:` 本地部署的插件与市场同名条目撞名时，此前会误报「可升级」红点，且点升级会**静默装成别人发布的同名 npm 包**。现在：未列入白名单的本地部署一律不参与线上升级与更新探测（红点消失、批量升级跳过、点升级给出结构化指引）——v0.11.0（#30）承诺的「本地开发安装不从线上更新」首次在全部场景成立。
- **新功能：本地热部署升级白名单（写死在源码）**：名单位于 `src/core/local-allow.ts`，当前 12 项为维护者自研插件（均为 npm 上 iasiv5 所有的包）。名单内包名的 `file:`/`link:` 本地部署保留覆盖升级通路——npm 发布新版后点升级即以线上版本覆盖本地副本。CLI 可用环境变量 `DSHM_LOCAL_UPGRADE_ALLOW` 临时追加。
- **行为变化须知**：白名单随包发布。若你本地部署了与名单同名的插件（例如自己 fork 的同名包），会出现可升级红点，点升级会被覆盖为维护者的线上版本。
- 名单内插件的详情弹窗新增「本地热部署」提示行（升级将以线上同名版本覆盖本地副本）。

**English**：
### 0.12.21 Security fix: local-deploy collision guard + upgrade allowlist (ADR-0038)

- **Security fix (issue #76)**: when a locally deployed (`file:`/`link:`) plugin shared its npm name with a market entry, dsh-m falsely flagged it as upgradable and clicking upgrade would **silently install someone else's same-named npm package**. Now local deploys not on the allowlist never upgrade online nor get probed (no red dot, skipped in batch upgrade, structured guidance on demand) — the v0.11.0 (#30) promise "local dev installs do not update from online" finally holds in every scenario.
- **New: local upgrade allowlist (hardcoded in source)**: the list lives in `src/core/local-allow.ts`; its 12 current entries are the maintainer's own plugins (all npm packages owned by iasiv5). Allowlisted `file:`/`link:` local deploys keep the overwrite-upgrade path — after publishing a new version to npm, one click upgrades the local copy to the online version. CLI temporary append: `DSHM_LOCAL_UPGRADE_ALLOW`.
- **Behavior change to note**: the allowlist ships with the package. If you locally deploy a plugin whose name matches an entry, it may show an upgrade red dot, and upgrading overwrites it with the maintainer's online version.
- Allowlisted plugins show a "Local deploy" row in the detail modal (upgrading overwrites the local copy with the online version).

## issue #76 回帖草稿（发前主人审）

> 感谢这份高质量的报告——四处根因指控（`matchInstalledByEntry` 无来源守卫、`probeLatest` 查同名条目线上版本、读侧 `registryId` 短路、写侧解析短路）我们逐一对照最新 main 核实，**全部属实**；同名社区条目与 npm 包的证据链也完整成立。这是「静默装错包」级别的漏洞，报告里五包对照表的写法尤其专业。
>
> 修复随 **v0.12.21** 发布，方向与你的建议一致但多了一层：本地 spec 的 `unsupported` 判定提到 `registryId` 之前（你的修 1/2）、本地 spec 不再参与线上探测（你的修 3）——但保留了**显式白名单**（写死在源码的维护者插件名单，见 `src/core/local-allow.ts`）：名单内包名的本地部署保留「npm 出新版 → 点升级覆盖本地副本」的通路。名单中的每个名字在 npm 上都归维护者所有，覆盖的目标只可能是维护者自己的包。原因：这条通路同时服务另一类真实场景——插件作者本地热部署调试、发布后一键切回线上版（我们自己就这么用，这也是这个 bug 长期没被发现的原因）。你的 `dsh-update-guard` 不在名单中，所以默认全挡；`isLocalSpec` 单源判定（你的修 4 的身份层守卫我们评估后暂不动——它会让本地安装失去市场徽章/图标，列为后续可选项）。
>
> 升级方式：`dshm upgrade --pkg dsh-m --yes`（或市场内更新）。升级后你的 `dsh-update-guard` 将显示「本地链接安装 · 不参与自动升级」、红点消失。再次感谢🙏——这个报告的质量（复现步骤、根因行号、对照表、自带取证）是社区报告的范本。
