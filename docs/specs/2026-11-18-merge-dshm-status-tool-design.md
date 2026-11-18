# 合并 agent 工具：dshm_outdated 并入 dshm_list（设计记录）

- 日期：2026-11-18
- 状态：工作决议。按「不再征求批准」的会话策略，grill 的推荐答案直接落地；未发版、未重启宿主、未热部署到活宿主、未合并到 main。下文每条决议都可在复核时推翻，推翻后改动面见 §9。
- 关联：[ADR-0039](../adr/0039-merge-agent-status-tool.md)；前序问题来自「插件双层卡片 + 非市场误标」的排查。

## 1. 问题与前提（均已实测或逐行核对）

前提 A：两个工具调用同一个探测。`dshm_list` 与 `dshm_outdated` 都调用 `listInstalledWithMeta`（host namespace，缺省 `probeMode: 'full'`，[tools.ts:282-289](../../src/tools.ts#L282-L289) 与 [tools.ts:467-474](../../src/tools.ts#L467-L474)）。两者的 items 只差两个字段：`dshm_list` 有 `registryId`，`dshm_outdated` 有 `latestTag`。

前提 B：文字层各有缺口，合在一起才完整。
- `dshm_list` 只在 `outdated && latestVersion` 时写「可升级」（[tools.ts:699](../../src/tools.ts#L699)，CLI 同款 [cli.ts:338](../../src/cli.ts#L338)）。GitHub 源的升级因为没有 `latestVersion` 而不出现在文字里。
- `dshm_list` 文字不输出 `latestErrorCode`，「检查未完成」对模型不可见（[tools.ts:693-708](../../src/tools.ts#L693-L708)）。
- `dshm_outdated` 文字与标题只看 `outdated` 与未完成数，不看注册表状态（[tools.ts:759-781](../../src/tools.ts#L759-L781)、[tools.ts:452-464](../../src/tools.ts#L452-L464)）。

前提 C：注册表不可用（含 deadline）时，两个工具都说谎。
- 早退路径不做任何探测（[market.ts:1076-1085](../../src/core/market.ts#L1076-L1085)）；超时状态为 `unavailable`（[market.ts:352-363](../../src/core/market.ts#L352-L363)）。
- `dshm_list` 把 `registryId` 的 `undefined` 经 `?? null` 变成 `null`，于是每个插件都被标为「非市场」（[tools.ts:300](../../src/tools.ts#L300)、[tools.ts:697](../../src/tools.ts#L697)）。市场归属其实是未知的。
- `dshm_outdated` 输出「全部 N 个插件均已是最新版本」，标题「全部最新」。插件根本没有被检查。
- 实测（2026-11-18，当前 `lib/tools.js`，两个插件，注册表 unavailable）：`dshm_outdated` 输出「全部 2 个插件均已是最新版本。」，标题「全部最新」；`dshm_list` 两个插件的 `registryId` 都是 `null`，文字都标「非市场」。

前提 D：沉默的假阴性（既有缺陷，本次要如实呈现）。没有收录条目的 GitHub 安装不会进入探测：`cacheKey` 对它为 `null`，整段探测被跳过（[market.ts:1138-1142](../../src/core/market.ts#L1138-L1142)），却因为 `outdated` 缺省为 `false` 被当作已最新。ADR-0026 声称「github 源按已装 spec 探 HEAD」，与代码不符。当前 20 个已装插件里没有 GitHub 源（18 个 npm、2 个 link），所以眼下不会暴露。

前提 E：意图停用口径不一致。已装页红点与批量升级排除 `userDisabled`（[installed-updates.js:50](../../src/client/installed-updates.js#L50)、[installed-updates.js:77](../../src/client/installed-updates.js#L77)）；两个工具的映射与卡片都不带、也不过滤该字段。

前提 F：指引语与状态概括冲突。`renderList` 末行写「对用户最多回一句短话」（[tools.ts:706](../../src/tools.ts#L706)），而「检查插件状态」需要几行概括。

前提 G：外部引用面。profile 的 node_modules 中（排除 dsh-m 自身）没有任何其它插件或 skill 引用 `dshm_list`/`dshm_outdated`（2026-11-18 grep 零命中）。仓内引用集中在 README（两份）、DESIGN.md、CHANGELOG、ADR 与计划文档；其中 README 与 DESIGN.md 是当前文档，需要更新，CHANGELOG 与计划/ADR 是历史记录，保持原样。

前提 H：工具清单本身已陈旧。当前注册的 agent 工具是 8 个：`dshm_search`、`dshm_list`、`dshm_install`、`dshm_toggle`、`dshm_uninstall`、`dshm_outdated`、`dshm_upgrade`、`dshm_restart`。[DESIGN.md](../DESIGN.md) §5 写的是 7 个，且漏列 `dshm_toggle`。GLOSSARY 中「会话注入开关」写的 8 个是对的。

## 2. 决议

| 编号 | 议题 | 决议 | 依据 |
|---|---|---|---|
| D1 | 合并范围 | 只合并 agent 工具面。CLI 的 `dshm list` / `dshm outdated` 命令与参数不变；CLI list 只修正未知态标签。 | CLI 是人与脚本的稳定契约；合并收益在 agent 侧（前提 A、B）。 |
| D2 | 存活工具的名字 | 保留 `dshm_list`。不改名为 `dshm_status`。 | GLOSSARY 把「状态」列为过载词（运行相位条目）；改名会扩大迁移面（前提 G）。 |
| D3 | 被合并工具 | `dshm_outdated` 不再注册给 agent，不保留别名。历史会话里的旧调用按通用卡片展示，不做兼容。 | 别名会让两个入口重新并存（前提 A）。 |
| D4 | 探测 | 合并后维持缺省 `full` 探测，与今日 `dshm_list` 一致。v1 不新增参数（不做 `updates_only`，不做探测开关）。 | 两个工具今天本来就都探测；参数越多，模型误用越多。 |
| D5 | 市场归属 | 三态：市场 / 非市场 / 未知。收录清单不可用（含 deadline）时，全部为未知。 | 前提 C；DESIGN.md §4 的已装页本来就要求「市场/非市场/未知」三态。 |
| D6 | 更新状态 | 四态：可升级 / 已最新 / 未检查 / 检查未完成。未检查的原因分三类：`registry-unavailable`、`local-install`（file:/link: 不做线上检查）、`not-probed`（当前只可能是未收录的 GitHub 安装）。 | 前提 C、D；「未检查」与「已最新」必须可区分（GLOSSARY 新增词条）。 |
| D7 | 文字契约 | 顺序：计数头 → 更新摘要（或收录清单不可用的声明）→ 可升级 → 未检查 → 检查未完成 → 清单。只有「全部已检查且全部已最新」时，才允许出现「全部…已是最新」。 | 前提 C、D；过去所有假阴性都是「未检查被说成已最新」。 |
| D8 | 指引语 | 替换「对用户最多回一句短话」：状态类问题 3 行以内概括，不逐条复述清单；升级或卸载前先与用户确认。 | 前提 F。 |
| D9 | 意图停用 | 可升级项照常列出，标注「意图停用」。已装页红点口径（ADR-0033）不变。术语只用「意图停用」，不用「已停用」。 | 前提 E；GLOSSARY 对「已停用」有 _Avoid_ 约束。 |
| D10 | GUI 卡片 | `dshm_list` 的卡片改为三态市场标签加更新徽标；`dshm_outdated` 的卡片槽位移除。卡片只保留一张列表卡。 | 前提 B；解决「双层」本身。 |
| D11 | GitHub 非收录安装 | 本次不扩大探测范围。以「未检查（未探测）」如实呈现。 | 扩大探测会增加 GitHub 被动预算的消耗，属于独立决策（前提 D）。 |
| D12 | 发布与执行边界 | 本次不发版、不改版本号、不写 CHANGELOG（随发版写入）、不重启宿主、不热部署到活宿主、不合并到 main。改动在 `feat/merge-dshm-status-tool` 分支。 | 会话已禁用批准；这些动作都需要明确批准（dsh-m AGENTS.md）。 |
| D13 | 检查时刻透出 | 已装探测逐项盖 `probedAt`（缓存命中=缓存写入时刻，新探=完成时刻，未探测项缺席）；`renderList` 以最旧时刻聚合，更新摘要行追加「 · 检查结果截至 HH:MM」，全部最新句带「（截至 HH:MM）」；只做 agent 文字（卡片与 CLI 不透出）。golden 基线经 capture 管线 sanitize 豁免活时间戳。 | 主人 2026-11-18 grill 第一轮按推荐批准（Q1-Q3）。 |
| D14 | refresh 参数 | `dshm_list` 新增 `refresh`（boolean，缺省 false，不用 force——该名已被安装/升级的兼容预检占用），透传 core force；已装 `'full'` 路径开放（缓存层 peek 纪律同源，item 展示层失败如实标检查未完成）；不加用户确认步骤；描述注明预算与失败语义。 | 主人 2026-11-18 grill 第一轮按推荐批准（Q4）。 |
| D15 | npm single-flight | `npmLatest` in-flight 合并：单一 Map、键=显式 registry 原样或 `implicit` 字面 + pkg、flight 内部 AbortController、30s 硬上限、waiter-scoped 超时/signal + ctrl 臂、全部离开才中止、不分 passive/active 池。 | 主人 2026-11-18 grill 第一轮按推荐批准（Q5）；决策全文见 [ADR-0040](./adr/0040-npm-latest-single-flight.md)。 |

## 3. 数据契约（`dshm_list` 输出，逐字段标注来源作用域）

| 字段 | 含义 | 来源作用域 |
|---|---|---|
| `pkg` `name` `version` `source` | 已装清单 | `listInstalledWithMeta` 枚举（profile package.json） |
| `registryId` | 收录命中的条目 id，未命中为 `null` | 收录匹配；注册表不可用时匹配不执行，为 `undefined`，映射后为 `null` |
| `market` | `market` / `non-market` / `unknown` | **工具层派生**：`registry.status === 'unavailable'` → `unknown`；否则 `registryId` 有值 → `market`，否则 `non-market` |
| `latestVersion` | 线上最新版本（npm） | 探测段 |
| `latestTag` | 线上最新 tag（GitHub）。**新增到 dshm_list** | 探测段 |
| `probedAt` | 探测时刻（ms）：缓存命中=缓存写入时刻，新探=完成时刻；未探测/失败/跳过项缺席 | 探测段盖戳（`readLatestCacheStamped` / `probeLatest` 两分支） |
| `outdated` | 是否有更新 | 探测段 |
| `latestError` `latestErrorCode` | 探测失败的文字与结构化原因码 | 探测段（`classifyLatestError`，[market.ts:434-439](../../src/core/market.ts#L434-L439)） |
| `userDisabled` | 意图停用 | enablement（profile bundles 与行覆盖），[enablement.ts:150](../../src/core/enablement.ts#L150) |
| `upgradePath` `upgradePathReason` `localUpgradeAllowed` | 升级通路投影 | upgrade-target 单源（ADR-0026） |
| `update` | `upgradable` / `latest` / `unchecked` / `incomplete` | **工具层派生**，优先级见下 |
| `uncheckedReason` | `registry-unavailable` / `local-install` / `not-probed` / `null` | **工具层派生**，仅 `update === 'unchecked'` 时非空 |

工具参数（D14）：`refresh`（boolean，缺省 false）→ core `force`；描述注明绕过缓存全量重探、失败保留旧值并如实标注检查未完成、GitHub 源消耗被动预算（25/req、50/h 滚动）。

`update` 的派生顺序（先命中先返回）：
1. 注册表不可用 → `unchecked`，原因 `registry-unavailable`。
2. `latestErrorCode` 有值 → `incomplete`。
3. `outdated === true` → `upgradable`。
4. `latestVersion` / `latestTag` / `latestSha` 之一有值 → `latest`。
5. `upgradePath === 'unsupported'` 且 `upgradePathReason === 'local-spec'` 且 `localUpgradeAllowed !== true` → `unchecked`，原因 `local-install`。这与探测段的跳过条件同源（[market.ts:1132-1133](../../src/core/market.ts#L1132-L1133)）。
6. 其它 → `unchecked`，原因 `not-probed`。

顶层字段不变：`registry`（`isDefault` `status` `stale`）、`community`、`profileDir`、`others`。`dshm_outdated` 的 `outdatedCount` / `incompleteCount` 不再存在。

## 4. 文字契约（`renderList`）

正常情形（有可升级、有未检查、有未完成）：

```
已装 20 个插件 · 市场 19 · 非市场 1 · 未知 0
更新：可升级 1 · 已最新 16 · 未检查 2 · 检查未完成 1 · 检查结果截至 HH:MM
可升级（1）：
· p-up (p-up) v1.0.0 → v2.0.0
未检查（2）——不代表已是最新：
· dsh-auth (dsh-auth)——本地安装，不做线上检查
· dsh-l (dsh-l)——本地安装，不做线上检查
检查未完成（1）：
· p-err (p-err)——网络错误
清单（内部序号，禁止复述给用户）：
1. ...（每项一行：名 (pkg) vX · 来源 · 市场标签 · 更新状态）
对用户：状态类问题用 3 行以内概括（可升级的名单与版本、未检查与未完成的数量与原因，其余已最新），不逐条复述清单。升级或卸载前先与用户确认，再调 dshm_upgrade / dshm_uninstall（pkg）。
```

注册表不可用：

```
已装 2 个插件 · 市场 0 · 非市场 0 · 未知 2
收录清单不可用：市场归属未知，更新均未检查，无法判断是否有更新。
清单（内部序号，禁止复述给用户）：
1. p-npm (p-npm) v1.0.0 · npm · 未知 · 未检查
2. p-link (p-link) v0.1.0 · link · 未知 · 未检查 · 本地链接安装
对用户：……（同上）
```

全部已检查且全部最新：`全部 2 个插件已检查（截至 HH:MM），均已是最新版本。`，之后只留清单与指引语。这是唯一允许出现「全部…最新」的情形。

有未检查或未完成项时，任何位置都不得出现「全部…最新」（测试钉住）。

注册表不可用时不输出「未检查」段：清单行已逐项标注「未检查」，再列一遍只会制造双层（实现与测试一致）。

GitHub 可升级项的目标写 tag（`latestTag`），npm 写 `v` + `latestVersion`。`unsupported` 且可升级的项附「——不参与自动升级」，成因文字沿用 `unsupportedCauseLabel`。

意图停用的可升级项在可升级区末尾标「· 意图停用」；清单行同样标注。

检查未完成只输出 `latestErrorCodeReason(code)` 的短文案，不输出原始 `latestError` 文本（它可能含路径或请求细节）。

标题（`presentResult`）：`已装 · N 个`，有非零计数时追加 `· 可升级 k`、`· 未检查 u`、`· 未完成 f`。

## 5. 卡片契约（GUI）

- 槽位：`tool.call.toolview` 的 `dshm_list` 使用新的 `ListToolView`（读取纯函数 `listRowsOf`）；`dshm_outdated` 的槽位移除。
- 行：名 · `(pkg)` · `vX` · 市场标签（市场 / 非市场 / 未知）· 更新徽标（`可升级 → 目标`、`未检查`、`检查未完成`）· `意图停用` 徽标。
- 「已最新」不显示徽标，避免噪音。
- 旧会话数据（没有 `market` / `update` 字段）的回退：市场标签按 `registryId` 判定；更新徽标按 `outdated` 判定。与旧版一致。
- 不新增 i18n 键（沿用卡片现有的中文字面量），不新增 CSS 类（复用 `dshm-row`、`dshm-hint`、`dshm-badge`、`dshm-badge warn`、`dshm-badge info`）。

## 6. CLI

- `dshm list`：注册表不可用时，市场标签输出「未知」，不再输出「非市场」。其它不变。
- `dshm outdated`：完全不变（命令、退出码、输出）。

## 7. 已知缺口与残留风险（本次不解决，如实记录）

- 没有收录条目的 GitHub 安装不探测（[market.ts:1138-1142](../../src/core/market.ts#L1138-L1142)）。本次以「未检查」呈现。扩大探测需要单独决定 GitHub 被动预算的消耗（ADR-0008、ADR-0026）。
- **「最新版本」缓存最长滞后 60 分钟。** 缓存只在进程内存中，默认 TTL 60 分钟（[market.ts:1099](../../src/core/market.ts#L1099)），重启即清空；已装版本每次从 profile 实时读取，外部升级后「可升级」不会残留（本段初版「最长 60 分钟仍显示可升级」的说法有误，已更正）。真正的滞后在「最新版本」一侧：TTL 窗口内发布的新版本看不到——D14 的 `refresh` 参数可主动穿透（重探失败保留旧值并如实标注检查未完成）。
- CLI list 没有显示 GitHub 源的目标版本（[cli.ts:338](../../src/cli.ts#L338)），与 agent 文字层的缺口同源，本次只修未知态标签。

## 8. 测试计划（先红后绿）

新增 `tests/tools-list-status.test.mjs`（夹具镜像生产调用点：注入 `listInstalledWithMeta` 与 `registryState`，不注入内层缺省对象）：

1. agent 工具清单为 7 个，不含 `dshm_outdated`，含 `dshm_list`、`dshm_toggle`。
2. 注册表可用：`registryId` 命中为 `market`，未命中为 `non-market`。
3. 注册表不可用：全部为 `unknown`；文字中不出现「非市场」标签；首行声明收录清单不可用。
4. 更新状态四态：`outdated` → `upgradable`；`latestVersion` 相同 → `latest`；`latestErrorCode` → `incomplete`；本地 link 未白名单 → `unchecked`/`local-install`；注册表不可用 → `unchecked`/`registry-unavailable`；无收录的 GitHub 安装 → `unchecked`/`not-probed`。
5. 全部已检查且全部最新：文字含「全部 2 个插件已检查，均已是最新版本」；不含未检查段。
6. 有未检查项：文字不含「全部…最新」。
7. 注册表不可用：文字与标题不含「全部…最新」。
8. GitHub 可升级项的目标写 tag。
9. 意图停用的可升级项标注「意图停用」，并仍被列出。
10. 检查未完成：输出短文案，不输出原始 `latestError` 文本。
11. unsupported 成因：可升级的不可自动升级项附「——不参与自动升级」；清单行标注成因。
12. 指引语：不含「最多回一句短话」，含「3 行以内」。
13. 标题：`已装 · N 个`，按非零计数追加后缀。
14. `dshm_upgrade` 的描述只引用 `dshm_list`，不含 `dshm_outdated`。

迁移 `tests/market.test.mjs`（逐条对应 §1 中的断言面，删除对 `dshm_outdated` 的调用，改断言到 `dshm_list`）：
- 746–755 行：`dshm_list` 的 registry summary 断言保留，删除 outdated 分支。
- 1476–1495 行（⑦ deadline）：删除 outdated 的 timeoutMs 与调用断言；`calls.list` 断言保留。
- 1523 行（②）：循环去掉 `dshm_outdated`。
- 1530–1556 行（⑨）：改写为对 `dshm_list` 的「检查未完成」断言，覆盖 §4 的标题与原因文字。
- 1558–1583 行（ADR-0026）：`dshm_list` 的 upgradePath 断言保留；outdated 文字断言改为合并后可升级区的「——不参与自动升级」断言。
- 1585–1608 行（github unparseable）：改为合并后文字的行级断言。
- 1610–1618 行（源结构锚）：`unsupportedCauseLabel` 在 tools.ts 的消费次数改为 ≥2（清单行 + 可升级区），仍成立；cli.ts ≥1 不变。

新增 `tests/client-tool-view.test.mjs` 用例：`listRowsOf`（纯函数）映射三态市场标签、更新徽标、意图停用，并回退旧数据形状。

验证命令（在 dsh-m 目录，经 `set -o pipefail`，以原进程退出码为准）：
- `node scripts/build.mjs`
- `node --test tests/tools-list-status.test.mjs tests/market.test.mjs tests/client-tool-view.test.mjs`
- `npm run typecheck`
- `npm test`（后台运行，记录退出码；失败按 know-how 028 的环境基线对照，不做手工管道对照）

## 9. 验收与复核点

验收：
- agent 工具清单为 7 个，不含 `dshm_outdated`。
- 注册表不可用时，任何文字或标题都不出现「全部…最新」，市场标签不出现「非市场」。
- 有未检查或未完成项时，不出现「全部…最新」。
- GitHub 可升级项显示目标 tag。
- 意图停用的可升级项标注「意图停用」。
- GUI 只有一张列表卡。

复核点（若推翻某项决议，改动面如下）：
- D2 改名为 `dshm_status`：工具名、GUI 槽位键、`dshm_upgrade` 描述、§8 测试、README、DESIGN。
- D3 保留别名：再注册一个 `dshm_outdated`，只做 `updates_only` 过滤，并在描述里声明已并入 `dshm_list`。
- D9 改为排除意图停用：在可升级项上加过滤，并在 §4 标注「已停用，未计入」。
- D11 扩大探测：`cacheKey` 增加 GitHub 分支，并核对 GitHub 预算（ADR-0026、ADR-0008）。

不做的事（本次）：发版与版本号、CHANGELOG、宿主重启、热部署到活宿主、合并 CLI 命令、扩大 GitHub 探测、并行去重与缓存失效。
