# 壳接管哨兵退役——市场入口恒在场 设计文档（issue #33）

- 日期：2026-10-30
- 状态：已批准（grill-with-docs 共识 Q1–Q10 + 独立评审 6 项全闭环 R1–R6，3/5 轮收尾）
- 实施计划：`docs/plans/2026-10-30-issue33-shell-takeover-retirement-implementation-plan.md`
- 决策记录：`docs/adr/0027-shell-takeover-sentinel-retirement.md`
- 取证副本（仓库外，只读）：`.dsh-research/issue33/`（`sb-rc3.js` = @deepseek-ai/dsh-client-ui-sidebar 0.2.1-rc.3 lib/client.js；`bw-client.js` = dsh-better-workspace src/client.js；`dsbot/` = Fei2411/DeepSeek-Bot main 分支源 + npm ds-bot@0.2.4 tgz 解包）

## 1. 背景与症状

issue #33（2026-10-29）：dsh-m 0.10.25 与 dsh-better-workspace 0.36.13（DSH Desktop 0.2.1-rc.3，Windows 11）共存时，市场入口图标整行消失——安装正常、`dshm_list` 正常、无任何报错与控制台异常，「除了看代码，用户无法从 UI 发现 dsh-m 存在」。报告者从打包产物读出根因链：`src/client/shell-takeover.js` 的 `isNativeFootShell()` 凭「`sidebar.workspaces` 台账存在负 priority 且 locale 不在 `COOPERATIVE_SHELL_LOCALES` 白名单」判敌意换壳 → `MarketEntry` 首行 `if (shellTakeover()) return null` 主动隐藏。报告者复现：移除 better-workspace 后图标立即恢复；共存时**其他插件的 footer.action 图标全部在场、唯独 dsh-m 缺席**。执行侧复核：报告者根因链与仓库源码逐字一致，全部成立。

## 2. 证据链（七条，每条带锚）

1. **哨兵判据与门控现状（改前）**：`src/client/shell-takeover.js`（`COOPERATIVE_SHELL_LOCALES` + `isNativeFootShell`）+ `src/client/main.jsx` MarketEntry 门控行；断言面普查（2026-10-30 grep 实证）：三标识符全部消费点 = 两个 src 文件 + `tests/client-shell-takeover.test.mjs`，无其他引用。
2. **官方契约原文与渲染无条件性**：`sb-rc3.js` L176-178（0.2.1-rc.3；rc.4 同文双版核实）：「The workspace/session browsing region **between global panel rows and the foot** is the `sidebar.workspaces` registrant's, and the foot holds `sidebar.settings` plus `sidebar.footer.action`; the shell hands them the wide flag」——**中段区域**归注册者；渲染侧 `sb-rc3.js` L504/L509-518：`regionArea` 渲染 workspaces 槽后，`footArea` **无条件**渲染 `renderSlot("sidebar.footer.action")` + `sidebar.settings`，无任何按接管者分支的条件。
3. **better-workspace 形态（座位遮蔽）**：`bw-client.js` L29 `const NS = 'betterWorkspace'`；L11489-11498 `slots.inject('sidebar.workspaces', …, { priority: -1, …, locale: NS }, BetterBrowser)`（其文件头自述 founding feature：替换官方工作区树为两层目录）；全文 **0 处** `sidebar.footer.action`、**0 处** `sidebar` 整壳替换——官方页脚根本未被触碰，dsh-m 的消失是哨兵独自造成的。
4. **ds-bot 0.2.4 形态（皮肤覆盖，已转合作）**：main 分支与 npm tgz 双证（`dsbot/`）。`index.js` L790 `BOT_PRIORITY = -100`、L791-792 `shadow()` 经 `freePriority()` 动态取位、L876 `shadow('sidebar.workspaces', { priority: BOT_PRIORITY, inject: face }, TeamSidebar)`——**无 locale/id/key**；L879/L936 它自己向官方 `sidebar.footer.action` 注册 `bot-account`（order -200）与 `bot-return`（order -300，源码注释原文「The only entry registered in every mode … this button in the shell's own footer is the way back」）；`sidebar.js` L876-879 CSS 是对官方 footArea 的**增格**而非替换。时间线：CHANGELOG L238 #127（0.1.6，2026-10-15，与 codex-ui 共存修复）、L215 #164（0.1.7，2026-10-16，「**In Bot mode, entries that other plugins add to the sidebar footer get a row each**」——2026-10-13 实证所针对的页脚挤压伤害，上游三天后自愈）、L370 Classic Agent mode（双模式，Agent 模式整皮肤撤出）。
5. **误伤史**：issue #4（2026-10-24，dsh-codex-ui 整壳替换 + `.dcu-foot` 逐条渲染 footer.action，白名单分档修复，commit 9b80477）→ issue #33（better-workspace，白名单无其 locale）→ ds-bot 0.2.4 Bot 模式潜伏误伤（接管条目无 locale，白名单结构性够不着；且上游 #164 已明确欢迎其他插件条目在场）。九天内同类事故两起 + 潜伏一起。
6. **契约误读勘误**：旧 `shell-takeover.js` 模块头引「the foot is the `sidebar.workspaces` registrant's」——对照官方原文，砍掉了句首限定语「The workspace/session browsing region between global panel rows and」，句意反转（官方说中段归注册者、页脚恒官方；旧注释读成页脚归注册者）。哨兵的整个推断链（负 priority 接管 ⇒ 页脚移交 ⇒ 入口会错乱 ⇒ 让位）第一步即不成立；页脚真正脱离官方之手的唯一方式是整壳经 `sidebar` 槽被替换——此时 footer.action 条目根本不挂载，**天然隐身，无需任何让位判定**。
7. **三分类学**：整壳替换（codex-ui 型，经 `sidebar` 槽换壳）/ 座位遮蔽（better-workspace 型，只占 workspaces 座位）/ 皮肤覆盖（ds-bot 型，覆盖官方壳上的皮肤、页脚增格）。台账字段层面（locale/id/key 缺席，见第 4 条）任何名单式判定都无法稳定表达三者及未来形态；只有渲染层有真值——而渲染层的自动事实是：官方壳恒渲染页脚；不渲染页脚的壳让条目根本不挂载。

## 3. 三路线对比（R1 采纳）

- **R1 退役门控 + 诊断降级（采纳）**：`MarketEntry` 恒在场；`hasShellTakeover` 纯函数保留为诊断信号（接管环境下 `console.info` 至多一条）。自动修复 #33，同时正确处理 codex-ui / better-workspace / ds-bot 0.2.4 全部已知形态；官方壳零变化。
- **R2 仅白名单热修（否决）**：一行补录 `betterWorkspace` 可解 #33，但 ds-bot 0.2.4 接管条目无 locale——白名单结构性够不着，潜伏误伤原样保留；名单跑步机已被 9 天两起事故证伪（每次漏录 = 某类用户处市场无声、彻底、不可自诊消失——发现型产品的最坏失败模式）。
- **R3 在场探针（否决并挂账）**：挂载后自测可见性再决定去留。三态推演：不挂载场景本就隐身（无需探针）；挂载但不可见本就无害（探针无增益）；可见但丑探针测不出（挤压/重叠类伤害无法用可见性判据表达）。故探针无真实增益，作为备案挂账（触发条件见 ADR-0027 备案）。

## 4. 诊断信号设计

`MarketEntry` 内 `useEffect(() => { diagnoseShellTakeover(); });`（无 deps 数组，每次 render 后执行）+ 模块级 `takeoverDiagnosticShown` 一次性 flag。检测到接管环境时 `console.info('[dsh-m] 侧栏工作区座位被外部接管（负 priority），市场入口照常在场')` 至多一条。**级联覆盖为尽力而为语义**：宿主侧 renderSlot/订阅实现不在仓内取证副本，渲染证据 ≠ 订阅证据；漏报后果仅 = 少一条诊断行，首挂载即检出已覆盖主场景（接管插件通常先于 dsh-m 在场），不作为行为正确性依据；坐实路径备查：runtime asar 宿主侧 renderSlot 实现。不建 client→host 上报通道、不进 `dshm_list`/doctor（Q5：无现成通道，且退役后「隐藏状态需解释」的需求消失）。

## 5. 变化面声明

| 场景 | 旧行为 | 新行为 | 口径 |
|---|---|---|---|
| 官方壳（无负 priority 接管） | 入口在场 | 入口在场，零变化 | DOM 节点数/几何/样式逐项一致（旧门控在 priority≥0 时本来就不触发） |
| 接管环境（better-workspace / ds-bot Bot 模式 / codex-ui） | 入口整行消失（codex-ui 经白名单豁免在场） | 入口照常在场 | 修复目的本身；codex-ui 形态行为等价 |
| 接管视图排序（ds-bot Bot 模式等） | 入口不渲染，无排序参与 | 入口以 order 9 参与页脚排序（DS Bot 条目 -200/-300 在前，工具行贴后） | 「在场」的自然推论；order 数值零变化（main.jsx order 注释同步更新） |
| 日志面 | 无 | 接管环境下 console.info 至多一条 | 新增；不进 i18n 字典 |

i18n 零新增键；样式/DOM 结构零变化。

## 6. 测试策略

`tests/client-shell-takeover.test.mjs` 全文重写：`hasShellTakeover` 纯函数直测 5 it（负 priority 无 locale / 负 priority 任意 locale 不再豁免 / 官方树 / 混合 / 畸形输入安全）+ 退役源锚 4 it（门控移除与旧名不残留 / `hasShellTakeover` require+调用恰两处 + flag + 话术 / `COOPERATIVE_SHELL_LOCALES` 双文件清零 / 模块 DOM-free）。源锚全部单行、出现次数语义（`split(needle).length − 1`）；关键接线锚（计数锚）单点变异红绿留证（`.dsh-research/redlight-issue33/red.txt` + `green.txt`）。TDD 序：红灯（import 失败文件级全红）→ T2 中间态 7 绿 / 2 红 → T3 终态 9/9。全量记账：N_base = 1842（2026-10-30 实跑，exit 0）→ 终态 1841（Δ = 9 − 10 = −1，旧文件 10 it / 新文件 9 it），exit 0。

## 7. issue #33 回复策略

0.11.1 发版后中文公开回复（本设计只定策略，草稿落 `.dsh-research/issue33-reply-draft.md`）：确认报告者根因链逐字成立并致谢；补充独立复核事实（官方契约原文与无条件渲染、better-workspace 零处 footer.action）；给出修复版本号；简述裁定变更（10-13 让位裁定语境 → 契约截断误读 → 退役）并链接 ADR-0027；一句带过 ds-bot 0.1.7（#164）已自愈原伤害、本修复同时解除其 Bot 模式潜伏误伤。

## 8. 备案

1. **可见性探针挂账**：触发条件 = 未来出现挤压/错乱类皮肤实证（可见但丑类伤害）。届时在 `MarketEntry` 挂载后自测按钮可见性（zero-rects / clipped），不可见再自我隐藏并落诊断信息；本版不做（三态推演无真实增益，见第 3 章 R3）。
2. **不建敌意名单**：ds-bot 型接管条目无 locale/id/key 可锚定，名单无法命名它；名单只能事后追认、漏录即静默消失——跑步机已被 issue #4 / #33 证明。判据如果将来要建，只能建在渲染层（探针方向），不建在台账字段层。
