# 0.7.0 分区市场实施计划 · 独立评审与碰撞记录（2026-09-29）

独立评审会话对 `2026-09-29-zoned-market-upgrade-implementation-plan.md` 出具 16 条发现（2 BLOCKER / 5 MAJOR / 6 MINOR / 3 NIT），基线实跑 `npm run build && npm test` = 692 pass / 0 fail，上游事实以本机缓存目录 `dsh-plugin-catalog@2026.929.4715`（4,382 条）核实。随后计划编写方与碰撞会话逐条对峙，本文记录结论；全部共识已打回计划 v2。

## 一、全盘接受（13 项）

| 级别 | 发现 | 共识修法（落点） |
|---|---|---|
| BLOCKER | 操作记录「恢复后执行」无任务落点；stillApplies 在 installed 数据（useAsync 异步）resolve 前判定恒假 | Task 13 补恢复执行器 `drainRestored`（FIFO、复用现有调用链、不新建事务路径）；restore 必须等待 installed 数据到位（Task 13） |
| BLOCKER | Task 12 消费的字段（install、下载量窗口三要素）无生产任务，Modal 按文实现必然「无窗口数据」 | Task 1 透传清单扩为 added/deprecated/replacement + install + downloadsStart/downloadsEnd/downloadsCheckedAt + version（Task 1） |
| MAJOR | deprecated/replacement 上游 0 次出现，「与上游一致」表述失实 | 改为前瞻性防御字段 + fixture 注入验证 + 上游落地核对动作（Task 1/10） |
| MAJOR | Task 8 删导出 / Task 13 删 busyPkg 留下「构建测试全绿但 GUI 崩」中间态（esbuild CJS 解构缺失不报错） | 引用清理并入产生删除的任务：Task 8 同步最小适配 main.jsx、Task 13 一次删净状态与全部 UI 引用，Task 15 只做增量（Task 8/13/15） |
| MAJOR | 既有测试将被打破而计划未列清单（market.test.mjs:132-138/1025-1028/1172、host-api.test.mjs:243-264/603-617、community.test.mjs:13/98-110） | Task 4/7 增加「既有测试改造清单」逐条点名；source='primary' 保留零社区加载优化并写进契约（Task 2/4/7） |
| MAJOR | 收藏 stale 检测依赖未定义的搜索语义：合成 id `owner--name` 归一化拆词后受「多词同字段全命中」约束会 0 分；limit:1 可被同名主清单条目挤出 | Task 3 定 normalized-id 精确匹配为最高优先命中；Task 14 lookup 放宽 limit 8 + 结果集成员判定，测试锁 owner--name 场景（Task 3/14） |
| MINOR | Task 3 漏「按条目缓存归一化结果」 | 补 WeakMap memoize + 测试锚点（Task 3） |
| MINOR | Task 6 漏 CLI HELP 文本同步（cli.ts:157） | 补 HELP 同步 + `node lib/cli.js help` 验证（Task 6） |
| MINOR | Task 4 验证打在 mock 回声上；「现内部表」失实（COMMUNITY_KNOWN_CATEGORIES 已导出） | 真实断言落 market/community 测试，host-api 仅透传冒烟；措辞改「改名并附加」（Task 4） |
| MINOR | 精选区「22 条直出」与自定义源 ≤1,000 条上限冲突 | 精选区自适应：total ≤ 96 单页，超过降级复用分页器（Task 11） |
| MINOR | categoryCounts/total 新口径含糊 | 明确：categoryCounts = 分区集合（不含 query/category 过滤）；total = 分区 ∩ query ∩ category（Task 2） |
| MINOR | navigator.language 判定与现有 browserLang()（main.jsx:208-213）分叉 | 复用 browserLang() 为唯一语言源，映射 `en*`→en、其余→zh（与现实现逐字一致；全局约束 + Task 10） |
| NIT×3 | 截图懒加载缺 IntersectionObserver 层；组件改名会触发 build.mjs marker 校验失败；个别断言不决/陈旧 | Task 12 补 IO 层；Task 9 加 marker 提示；primaryOnly 断言定 400、smoke 预期改区间 4,000–4,600、Task 6 Step 1 预期精确为「静默忽略」（Task 6/7/9/12/终验） |

## 二、碰撞分歧（2 处反议，均已收敛）

### 反议 1：MAJOR 4（WITH_LATEST_MAX 50→96 探测预算）的缓解方案

- 评审建议：给 withLatest 探测设条目上限（如前 48 条）或仅依赖 TTL cache。
- 编写方反议：探测上限造成**类内分裂**（同页社区 npm 条目前 48 有版本、后 48 没有，看似随机失败），比类间分裂（github 条目整体不探测，Q46 既成事实）更伤；且单方面加上限是对 Q46「探测对象=页面条目」的静默修订。替代方案：(a) 探测预算权衡写进 Task 7 决策记录（96 为 opt-in、默认 24 低于现状 50、最坏情况被 60s deadline 框死为 latestError）；(b) Task 1 顺带透传社区原生 `version`（上游 dist-tags.latest 日更快照；实测 npm 源 2,253 条 100% 非空、github 条目 100% null 恰为探测豁免集），探测失败时卡片回退显示目录版本，不动 Q46 语义。
- **结论：接受编写方方案，不加探测上限。** 附 2 条硬条件（已采纳）：
  1. 目录版本不得冒充实时探测：展示须带「（目录快照）」来源标注，且**不参与 outdated 判定**（写进 Task 1 数据契约，非 UI 细节）。
  2. 观察项阈值化：「96/页冷缓存 latestError 比例 > 20% 即回退默认页大小并重议」，不做无终止观察。

### 反议 2：MAJOR 3 的处理力度（保留还是砍掉前瞻字段）

- 评审建议：向上游确认字段形状后再定字段名。
- 编写方反议：dsh-market registry 类型已声明 deprecated?/replacement?，生态方向明确；防御性透传（optional + truthy 判断 + fixture 驱动）成本为零，砍掉需二次发版。
- **结论：保留前瞻字段。** 附 3 条条件（已采纳）：
  1. 展示层无强依赖：truthy 判断、缺失 = 不渲染，钉进 Task 契约。
  2. 「上游落地后核对」为可执行动作：上游新版本出现该键后，跑 `scripts/smoke-community-catalog.mjs` 对比字段形状与 dsh-market 类型（尤其 replacement 是 string 还是对象）——写入 Task 10 检查单。
  3. fixture 加正反两例（带/不带 deprecated），测试锁透传行为而非字段形状假设。

## 三、编写方自查补丁（评审未提，碰撞中补充并获认可）

恢复执行器 dispatch 前的**二次校验**：恢复校验时成立、轮到执行时前提又消失（如用户已手动装同款）的操作，dispatch 前以执行时实读复核，不成立转 failed 并注明原因——与 compensate-install「以执行时实况为准」语义同源（market.ts rejected 分支传统）。碰撞会话认可并补 2 个边界（已采纳）：

1. 区分「前提消失」与「真失败」：OpStatus 增加 `superseded`，良性前提消失以中性样式呈现，UI 不得把「已手动安装」显示成红色错误。
2. 二次校验数据源必须是执行时实读（listInstalledPlugins 直读 profile），不得复用恢复流程开头缓存的 installed 快照——BLOCKER 1 同一时序坑的执行器版本，计划点名写死。

## 四、对照终审（碰撞会话出具，2026-09-29）

共识打回计划 v2 后，碰撞会话对 v2 全文做对照终审（所引代码/测试行号逐一在仓库核实）：

- **转写忠实度 100%**：三个表态结论、7 条附加条件、13 项接受项全部落位且相互一致。
- **转写新伤 3 项，均已修入终稿**：
  1. （高）`owner` 字段三处消费（Task 10 byline / Task 12 Modal / Task 14 收藏快照）零处生产——Task 1 透传清单补第 9 字段 `owner?: string`（truthy 缺失不渲染；不得从合成 id 前缀解析，id 折叠会失真）。
  2. （中）browserLang 映射描述与被复用的实现相反（计划误写 `zh*→zh、其余→en`，实现是 `en*→en、其余→zh`）——全局约束与 Task 10 措辞改为与实现逐字一致，代码零改动；本记录第一节 MINOR 表同步勘误。
  3. （中）`skipped` 语义引入（Task 2）与 `community=disabled` 断言改造（原排 Task 7）时点错位，Task 2 收口必红——断言改写前移进 Task 2 Step 3，Task 7 清单保留其余三条。
- 轻微提示（已采纳入计划执行纪律）：实现开始前先 commit 本批输入工件（DESIGN.md / CONTEXT.md / ADR-0004 / 两份 plan 文档），避免分支操作丢失 grilling 产出。

## 五、执行审计与碰撞（2026-09-30，实施完成后）

实施 16 任务收口（`3fe5c89`）后，独立审计会话对执行结果出具 21 条发现（2 BLOCKER / 7 MAJOR / 8 MINOR / 4 NIT），并 SSR 实证 GUI 根组件打开即崩——「构建 ✓ 测试 ✓ GUI 可运行」三态纪律在最关键一环失实。碰撞（与考古会话）后全部处置落地（`5cbb0ca`，741/741 全绿）：

- **两 BLOCKER（均实证）**：①`useLayoutEffect` 未解构（esbuild CJS 自由变量炸弹——正是第三节预警的那类）；②favorites 早退跳过 `useState(compatConfirm)`（hooks 规则）。修复并落地 **SSR 渲染冒烟回归门**（`tests/client-render-smoke.test.mjs`：main.jsx 副本+测试导出 → esbuild → renderToString 五组件，4 用例进 npm test）。
- **碰撞新发现（21 条之外的地基洞，共 4 个）**：①操作记录 store 为 per-hook 实例，关面板后新旧实例全量 persist 互相覆盖丢记录——提为模块级单例；②waiters 需持原始 Error 引用（`e.guard/e.issue` 结构保真，`err.opId` 附回）；③恢复执行器与前台泵必须合一（独立 drainRestored 循环会双 dispatch 同一条 queued）——恢复只做改标后启动同一泵，dispatch 前统一 stillApplies 实读校验；④取队首同步纪律（判空到退出零 await）。
- **恢复执行器死路径（MAJOR 3+6+12 一并重构）**：runOp 改 `queued→running→终态` 泵化生命周期（「全部更新 N 条」真实逐条流转、重载恢复 queued 从不可达变为真实行为）；stillApplies 对 install 同时比对 `meta.npm`；确认/重试经 `reuseId` 复用同一记录（消双重记录）；CompatDialog 取消 → superseded「用户放弃」。
- **其余修复**：Esc 弹层深度互斥（`dsvmModalDepth`）；Modal 补 LinksRow（恢复超集）；Enter `isComposing/keyCode 229` 守卫；host-api 对 `primaryOnly` 显式 400（计划钉过、实施曾缩水为静默忽略）；分区计数各取自身 total；卡片「进行中」徽章 + cursor/hover 可点击暗示；收藏 stale 校验 800ms debounce；ToolCardRow 顺手写操作记录；死键/陈旧注释/lookup 遮蔽改名清理。
- **显式偏离（碰撞接受）**：卡片描述展开钮由 Modal 取代（渐进披露唯一出口=卡片点击，行内展开与其竞争）；组件层 debounce 时序不进 Node 测试（纯函数 partitionStale 已覆盖、渲染路径归冒烟门）。
