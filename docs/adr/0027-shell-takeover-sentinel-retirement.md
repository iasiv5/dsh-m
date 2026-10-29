# 壳接管哨兵退役——市场入口恒在场（issue #33）

dsh-m issue #33（2026-10-29）：dsh-better-workspace（`sidebar.workspaces` 座位以 priority -1 遮蔽官方工作区树）与 dsh-m 共存时，市场入口整行消失、无任何报错——`MarketEntry` 的壳接管哨兵把「负 priority 占位者」判为敌意换壳主动让位。报告者根因链经执行侧逐字复核成立。

## 背景

- **2026-10-13（0.9.81，commit e8eb324）**：ds-bot 页脚错乱实证（其皮肤 CSS 挤压官方页脚、其他插件 footer.action 条目排布错乱）→ 裁定「`sidebar.workspaces` 出现负 priority 占位者即整行让位」。该裁定在当时的实证语境下成立。
- **2026-10-24（issue #4，commit 9b80477）**：dsh-codex-ui 整壳替换（经 `sidebar` 槽）但 `.dcu-foot` 逐条渲染 footer.action——入口本会被正常承载，哨兵先一步藏掉了它。引入 `COOPERATIVE_SHELL_LOCALES` locale 白名单分档（合作换壳豁免）。
- **2026-10-29（issue #33）**：better-workspace 误伤曝光——它只做座位遮蔽、零处消费 `footer.action`，官方页脚从未离开。执行侧复核（0.2.1-rc.3 与 rc.4 双版取证，副本 `.dsh-research/issue33/sb-rc3.js`）发现哨兵地基两处不成立：
  1. **官方契约被截断误读**：SidebarRoot 原文「The workspace/session browsing region **between global panel rows and the foot** is the `sidebar.workspaces` registrant's, and the foot holds `sidebar.settings` plus `sidebar.footer.action`」——中段区域归注册者，页脚恒由官方壳**无条件**渲染（渲染代码 footArea 无任何条件分支）。旧注释砍掉限定语后句意反转。页脚脱离官方之手的唯一方式是整壳经 `sidebar` 槽被替换——此时 footer.action 条目根本不挂载，天然隐身，无需让位。
  2. **locale 白名单结构性失效**：ds-bot 0.2.4（2026-10-29，main 与 npm tgz 双证，副本 `.dsh-research/issue33/dsbot/`）的接管条目经 `freePriority()` 动态取位，**无 locale/id/key**——名单两方向（合作豁免/敌意点名）都无法命名它；且其 0.1.7（#164，2026-10-16）起即为其他插件页脚条目留行，10-13 实证所针对的伤害上游三天后已自愈。九天内同类事故两起（#4、#33）+ 潜伏一起（ds-bot Bot 模式），每次漏录表现为市场无声、彻底、不可自诊消失。

## 我们决定（2026-10-30，grill 决议 Q1–Q10）

1. **门控退役**：`MarketEntry` 删 `shellTakeover()` 门控，市场入口在一切壳形态下恒在场。
2. **判定降级为诊断信号**：`isNativeFootShell` 收敛改名 `hasShellTakeover`（只判「负 priority 占位者存在」），接管环境下 `console.info` 至多一条（会话级 flag 防重复）；不建 client→host 上报通道、不进 `dshm_list`/doctor（无现成通道，且退役后「隐藏状态需解释」的需求消失）。
3. **分档机制退役**：`COOPERATIVE_SHELL_LOCALES` 删除，locale 不再参与判定；「敌意换壳/合作换壳」二分类随门控退役（决策史保留于本 ADR 与 `docs/specs/2026-10-30-issue33-shell-takeover-sentinel-retirement-design.md` 的三分类学：整壳替换/座位遮蔽/皮肤覆盖）。
4. **不建敌意名单**（见备案 2）。
5. **可见性探针挂账**（见备案 1）。
6. **生态动作范围**：仅 issue #33 公开回复（0.11.1 发版后，中文，链接本 ADR）；ds-bot 上游不留言。

## Considered Options

- **仅白名单热修（补录 `betterWorkspace`）**：一行解 #33，但 ds-bot 无 locale 结构性够不着，潜伏误伤原样保留；名单跑步机已两度漏录。**否决**。
- **在场探针（挂载后自测可见性决定去留）**：三态推演无真实增益——不挂载场景本就隐身、不可见本就无害、「可见但丑」探针测不出。**否决，转备案 1**。
- **维持现状 + 继续按源码证据补录白名单**：把哨兵的地基错误原样保留，每个新换壳插件重演一次「无声消失 → 用户读源码立案」。**否决**。

## Consequences

- **官方壳（绝大多数安装）零变化**：旧门控在 priority≥0 时本来就不触发，DOM/几何/样式逐项一致。
- **接管环境入口恒在场**：better-workspace（issue #33 解除）、ds-bot Bot 模式（潜伏误伤解除，且上游 #164 明确为其他插件条目留行）、codex-ui（行为等价：白名单豁免 → 恒在场）。接管视图下入口以 order 9 参与页脚排序（DS Bot 条目 -200/-300 在前，工具行贴后；order 数值零变化，main.jsx order 注释第二处哨兵叙事同步更新）。
- **诊断面**：接管环境下 console.info 至多一条；晚挂载补打点为尽力而为语义（宿主侧订阅实现不在仓内取证范围，漏报仅少一条诊断行）。
- **白名单教义退役**：「源码证据锚才入名单」的维护项消失；locale 耦合清零。
- **测试资产重定向**：分档判别 10 it → 存在判定 5 it + 退役源锚 4 it；关键接线锚单点变异红绿留证（`.dsh-research/redlight-issue33/`）。全量 1842 → 1841（Δ = 9 − 10），typecheck 0。
- **术语**：GLOSSARY 新增「壳接管（Shell Takeover）」词条（接管环境概念，诊断话术引用），并消解与「让位（Displacement）」（目录合并概念，0.10.22 定）的撞名——入口避让旧语义随哨兵退役。

## 备案

1. **可见性探针挂账**：触发条件 = 未来出现挤压/错乱类皮肤实证（「可见但丑」类伤害，可见性判据无法在台账字段层表达）。届时在 `MarketEntry` 挂载后自测按钮可见性（zero-rects / clipped），不可见再自我隐藏并落诊断信息。
2. **不建敌意名单**：ds-bot 型接管条目无声明字段（locale/id/key 经 `freePriority` 动态取位）不可名状；名单只能事后追认、漏录即静默消失——已被两次用户可见事故证明。若将来重建判据，只能建在渲染层（探针方向），不建在台账字段层。

## 实施与验证

实施计划 `docs/plans/2026-10-30-issue33-shell-takeover-retirement-implementation-plan.md`（独立评审 6 项 R1–R6 全闭环）；设计文档 `docs/specs/2026-10-30-issue33-shell-takeover-sentinel-retirement-design.md`。commit 62fd187（代码 + 测试）。
