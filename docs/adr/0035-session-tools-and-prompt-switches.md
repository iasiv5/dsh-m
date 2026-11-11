# 会话面双开关：dshm_* 工具与系统提示词段分轴可控（ADR-0035）

## 决策

dsh-m 新增两个**默认开启**的 live 设置字段，把「会话注入面」按轴拆分为两个独立开关：

| 字段 | 类型/缺省 | 治理的注入面 | 关闭效果（新会话干净；已开对话下一次回复起工具消失） |
|---|---|---|---|
| `sessionTools` | boolean / `true` | 8 个 `dshm_*` agent 工具注册（`src/tools.ts`） | 工具不再出现在模型装配的工具列表 |
| `sessionPrompt` | boolean / `true` | `tool:dshm` 系统提示词段（order 211） | 提示词段不再进入系统提示词 |

> **0.12.16 增补（核实后补注）**：① 生效口径——工具 `when` 谓词每次模型调用求值（宿主 agent-loop 每步 `preStep` 先 `tools.resolve`），已开对话里工具从下一次回复起消失；系统提示词段每次装配重新渲染，并经 `systemPrompt.project` 提交（替换首条系统消息，或在历史内追加更新，因模型提供方而异），但已发生的上下文不追溯清洗，历史里的旧提示词可能仍在——对外口径以「新会话干净」为准。② UI 呈现——0.12.15 起插件页设置区以单个开关「Agent 工具（dshm_*）与系统提示词注入」呈现，同时写入 `sessionTools` / `sessionPrompt`；UI 只可达「全开 / 全关」，「仅工具」仍可经配置达到（此时开关显示为关）。字段语义、级联规则与存储层均不变；下文「单总开关被否」针对的是存储层的轴划分。

- **级联规则**：`sessionTools=false ⇒ 提示词段强制不注入`（与 `sessionPrompt` 取值无关）——工具缺席时提示词是悬空噪声。三个可达态全部自洽：
  1. **全开**（缺省）：现状体验，提示词段用瘦身版（全文定稿在配套实施计划「文案钉死」节）；
  2. **仅工具**（`sessionPrompt=false`）：工具保留、引导段移除——模型仅在用户显式要求时使用 dshm_* 工具，不再主动接管插件类请求（「库不噪音」态）；
  3. **全关**：纯 UI 市场态——设置页、dshm CLI、宿主侧 `dshm_toggle` 整插件开关均不受影响（UI 独立性实证见 §证据）。
- **live 机制（零 disposer、零重注册）**：工具注册改为 `ctx.tools.register(defineTool({...}), { when: () => sessionToolsEnabled(cfg) })`——dsh-tools 对 `when` 谓词逐步求值（宿主 dsh-tools lib/index.js:551 `await registration.when(context)`，:533 谓词非空即从可见视图剔除）；提示词段 `text` 改为函数 `() => resolveSessionPromptText(cfg)`——dsh-system-prompt 对函数 text 每次装配求值（宿主 dsh-system-prompt lib/index.js:389），renderAssembly 过滤空段（:120）。两个谓词闭包持有 `registerTools` 已接收的共享 config 对象（`controller.config`，host.ts:103），settings 变更经 `handleExternalWatch` 原地同步字段（`registry-controller.ts`，新增 session 两字段显式同步行，置于 early-return 之前）。settings 三代通路（legacy register / forms volatile / 未知形态降级）由既有 `wireRegistrySettings` 兼容层覆盖；**未知形态降级无 watch**，开关变化退化为插件重载后生效（文档如实标注）。
- **CLI 不加开关**：CLI 没有注入轴——每次调用是人手敲的显式动作、变更类强制 `--yes`；`sessionTools` 治理的轴是「未经邀请进入 agent 上下文」。bash 经 CLI 的旁路治理归宿主沙箱/审批策略层（唯一有强制力的层）；给显式命令加闸门制造虚假安全感（同一 agent 还可 curl 宿主 HTTP API / npm 写 profile）。此决策存档于本节，后续问询以此为准。
- **市场 UI 零触及**：UI 走 HTTP `/dshm` 路由（`host.ts` webServer dispatcher）→ Host API → core，与 tools service 是平行消费面；开关只门控 tools 注册与提示词段。

## 背景

issue #57（PrimaryFantasty，2026-11-08）：dsh-m 默认向系统提示词注入 `tool:dshm` 段（约 230 词英文流程指令，`src/tools.ts` systemPrompt 注入块）并注册 8 个 `dshm_*` 工具，无任何开关；用户抱怨「默认且不可移除地注入会话用的工具，容易开缺口」「只想要一个好用的 UI 和便捷入口」。楼内讨论中作者曾提议 per-tool 独立开关（模仿智能体团队插件）。

grill 对齐（2026-11-10）确立：两个注入面抱怨轴不同——提示词段是**行为修正器**（`you MUST call dshm_search`、`reply with AT MOST one short sentence`，改变模型在所有话题上的行为，每轮付 token/注意力税）；工具是**能力面**（schema 同样占装配，抱怨轴是安全/变更）。单总开关无法表达「保留能力、去除行为塑形」；per-tool 8 开关的组合测试成本与设置页膨胀不成比例（「只要变更类不要只读类」逻辑不成立：无搜索发现则模型只能盲装）。

## Considered Options

- **单总开关**：被否——无法表达「仅工具」甜点态；提示词与工具的抱怨轴不同，合并治理是对问题结构的压缩失真。
- **每工具独立开关（作者原案）**：被否——8 态组合中「只要变更类」不自洽；提示词段与工具集的联动映射（关某工具去对应提示词句）引入错位 bug 面；设置页与测试矩阵膨胀无需求驱动。
- **只读/变更分组开关**：被否——「只读 on + 变更 off」是假想需求（issue 全帖无人提出，install 已有 guard+确认纪律）；「只读 off + 变更 on」不成立。
- **双开关 + 级联（本决策）**：采纳——分轴诚实映射问题结构；级联封死不自洽态；实现增量小（一个纯函数模块 + 8 处 `when` + 段 text 函数 + watch 同步两行）。
- **CLI 同步开关**：被否（见 §决策 CLI 节，理由存档）。

## Consequences

- 设置页新增两字段（schemastery live，描述写明级联与 tradeoff）；`RegistrySettingsStore` 接口与 `handleExternalWatch` 增加 session 字段同步；新增 DOM-free 纯逻辑模块 `src/core/session-gate.ts` + `tests/session-gate.test.mjs`（TDD 先红）。
- **提示词段文本有意变更**（非零变化）：约 230 词 → 约 60 词，去重依据是 8 个工具 description 已逐条携带触发规则/确认纪律/needsBuildApproval 协议/`Do not print CLI commands`（`src/tools.ts` 各工具 description 现场，2026-11-10 核对）；`Plugin categories:` 动态行删除——`dshm_search` 的 `category` 参数描述已枚举全部分类（环境即事实源）。瘦身全文与逐行对照在配套实施计划「文案钉死」节（`docs/plans/2026-11-10-issue57-session-switches-implementation-plan.md`），评审逐字定稿。
- 提示词段 text 从字符串改为函数、工具注册增第二参 options：tests 现状无提示词段文本锚（2026-11-10 grep `tool:dshm|Plugin categories|order: 211|personal marketplace|never claim` 于 tests/ 零命中）；ctx 桩 `register: (t) => registered.push(t)` 忽略第二参，加法改动不炸既有套件。
- 版本 0.12.14（patch）；CHANGELOG 双语条目关联 issue #57；实现完成后带版本号与用法回帖（发版与回帖按仓库规则**当轮单独请批**）。
- 回退面：revert 实现提交 + 版本递增；开关字段对旧宿主为纯新增面（`live()` 包装兼容 ≤0.1.5 schemastery）。
