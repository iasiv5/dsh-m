# 实施计划 · ZoneChips 视觉裁剪方案（方案A：隐身全量测量）

- 日期：2026-10-08
- 状态：待评审
- 需求文档：`docs/plans/2026-10-08-zonechips-visual-clip-requirements.md`（下称【需求】）
- 改造对象：`src/client/main.jsx` ZoneChips（`main.jsx:902-982`）及其内嵌样式表（`main.jsx:324-347` 一带）
- 目标版本：0.9.53

## 0. 方案概述

废除「按预算 slice 渲染 + 事后测量」的现有结构，改为**全量渲染、视觉裁剪**：

- 23（社区）/5（精选）颗分类 chip **始终全部渲染**在 `.dshm-chips` 内；
- 折叠态通过 **`.dshm-chips`（内层 flex 容器）** 上的 `max-height`（= 可见行数 × 实测行高 + 行间距）+ `overflow:hidden` 裁剪；
  **严禁落在 `.dsvm-chipswrap` 上**——0.9.52 哨兵是 wrap 的 `top:-5px` 绝对定位子元素、位于 wrap padding box 之外，
  wrap 一旦 `overflow:hidden` 会将哨兵整体裁掉，IO `intersectionRect` 恒空 → `stuck` 永久 true（评审 R1-Q1，阻断）；
- 被裁剪的 chip 逐颗置 `visibility:hidden`（不渲染 → 不渲染的差异消失，
  测量面对的永远是真实全量布局，§1.3 的棘轮结构上不可能再发生）；
- `+N`/`⌃` 从 in-flow 按钮改为**覆盖徽章**（绝对定位，不参与裁剪）；
- 删除 `fit` 状态与 slice 预算；新增 `clip` 派生状态 `{maxRows, expanded}` 与实测 `hiddenCount`。

## 1. 设计决策

| # | 决策 | 内容 | 依据 |
|---|---|---|---|
| D1 | 全量渲染 | `shown/chips.slice` 删除；`.dshm-chips` 渲染 `全部 + chips 全量 + trailing` | 需求 G1/G2：测量对象必须与真实布局一致 |
| D2 | 状态模型 | 删 `fit`（`main.jsx:906`）与 `collapsedBudget`（`:913`）；新增 `expanded`（沿用）与 `maxRows = stuck ? 1 : 2`（`:913` 的 stuck 语义平移） | 需求 G3 吸顶语义 |
| D3 | 裁剪宿主与高度 | `max-height + overflow:hidden` 宿主为 **`.dshm-chips`**（内层 flex 容器）；**严禁施加于 `.dsvm-chipswrap`**——哨兵（wrap 内 `top:-5px` 绝对定位子元素，`main.jsx:972-975`）在 wrap padding box 之外，wrap 裁剪会将其整体裁掉 → IO `intersectionRect` 恒空 → stuck 永久 true（R1-Q1）。高度 = `maxRows × rowHeight + (maxRows−1) × 6px`；`rowHeight` 取首颗 chip 实测 `offsetHeight`（初值 CSS 常量 22px 兜底）；`expanded` 时解除 max-height（`overflow:hidden` 保留，无副作用） | R1-Q1 |
| D4 | 隐藏 chip 可见性 | `offsetTop ≥ 裁剪线` 的 chip 置 `visibility:hidden`——与现状「未渲染 = 不进 tab 序/无障碍树」对齐，避免不可见却可聚焦的回归 | 需求 G3 |
| D5 | +N/⌃ 徽章 | **折叠态**：`+N` 为右侧 overlay 组成员（见 D6），绝对定位、不参与裁剪，底衬 scrim 用主题 alias token（`--dsw-alias-bg-base` 系，同 `.dsvm-chipswrap` 配方 `main.jsx:345`）；**展开态**：`⌃` 回归 **in-flow** 行尾按钮（与现状一致，`main.jsx:981-984`）——展开态不使用 overlay，从结构上消除「⌃ overlay 压行尾 in-flow 筛选」的碰撞（R1-Q4③） | R1-Q4③ / R2-N1 |
| D6 | 筛选触发器与碰撞矩阵 | **折叠态**：右侧 overlay 为**水平并排组** `[筛选][+N]`——绝对定位钉在 wrap 内、**末可见行右端**（`right/bottom` 锚定 + `height:rowHeight` 垂直居中于该行；吸顶单行态时末可见行即第 1 行，两按钮仍同行并排——第④类碰撞「单行态两 overlay 目标区重合」由「同组水平 flex + gap 8px」结构性消除，R2-N1）；overlay 宿主为 wrap（wrap 无 overflow，overlay 不被剪；与哨兵为互不干扰的不同子元素）。**gutter 几何保证**：`.dshm-chips` 设 `padding-right: var(--dshm-clip-gutter, 132px)`（筛选 ~70px + +N ~44px + gap 8px + 余量；1 行/2 行态统一取值）——chip 提前换行，overlay 组与 chip 零相交。**展开态**：gutter 移除，⌃ 与筛选均 in-flow 行尾（`margin-left:auto`，`main.jsx:332`），与现状一致。筛选位置变化声明：折叠态由「现状第 3 行行尾 in-flow（0.9.51 截图为证）」改为「末可见行右端 overlay」——贴近现状动线，记入 CHANGELOG。弹层锚点 `.dsvm-filterwrap`（`position:relative`，`main.jsx:332`）与弹层（`top:calc(100%+6px)`，`main.jsx:334`）随 overlay 组定位；V6 断言弹层在面板界内正常开合。四类碰撞对策汇总：①+N↔末行 chip → gutter；②筛选↔行尾 chip → gutter；③展开 ⌃↔行尾筛选 → ⌃ in-flow；④吸顶单行 筛选↔+N → 同组水平并排；N4（R3）：gutter 仅当 overlay 组非空时施加——精选区（trailing=null）且 hiddenCount=0 时不预留 132px，V3 探针补精选区窄宽度断言（R1-Q4 / R2-N1 / R3-N4） | R1-Q4 / R2-N1 / R3-N4 |
| D7 | 重测时机 | ① `ResizeObserver` 观察 `.dshm-chips`（内容盒：宽度变化、字体重排、**stuck 切换引起 max-height 变化**都会触发；rAF 节流）；② `document.fonts.ready.then(重测)`；③ 测量 effect deps：`[chips.length, expanded, zone, stuck, rowHeight]`——**stuck 显式入 deps**（R1-Q2：maxRows 翻转必须确定性重测，不单靠 RO 兜底）；④ feature-detect：`typeof ResizeObserver !== "undefined"`、`document.fonts?.ready` 存在性检查，缺失时降级为仅 deps 驱动（先例 `main.jsx:947` IO 守卫）（R1-Q5） | R1-Q2/Q5 |
| D8 | 自动展开/autoRef | 维护**最后一次折叠态测量快照** `collapsedGeom = {tops[], clipTop}`：expanded 期间不重测、沿用快照（对齐现状 `main.jsx:928` 测量早退 + `:915-925` 依赖最后 fit 的行为）。激活分类变化时（**含展开态**）：以快照评估 `tops[active] > clipTop`，越界则 `autoRef.current = active`；若同时 `!expanded` → `setExpanded(true)`（展开态下仅记录、不施裁剪——现状 `main.jsx:921-922` 在展开态同样写 autoRef，本设计保持该语义）；`active` 变 null 时重置 `autoRef.current = null`（`:916-919` 语义）。`⌃` 手动收起后：`expanded=false` 且 `autoRef.current === active` → 不弹回（V5 断言「展开态激活深层分类 → ⌃ 收起不回弹」） | R1-Q3 |
| D9 | 纯函数抽取 | `market-state.js` 新增：`chipRows(offsets)`（offsetTop 去重计数）、`countBeyondRows(offsets, maxRows)`（第 maxRows 行之外颗数）、`autoExpandDecision(activeTop, clipTop, autoRefMatched, expanded)` → `{record, expand}`；组件内只做实测与派发。**统一坐标系 = `.dshm-chips` 内容盒顶**：给 `.dshm-chips` 设 `position:relative` 使其成为 offsetParent，`offsetTop` 直接相对内容盒，消除 sticky wrap `padding-top:8px` 的系统性偏移（R1-Q7）；D4/D8 判定一律使用该坐标系 | 可 Node 直测；现状 fit 逻辑在组件内不可单测 |
| D10 | 性能 | 24 颗常驻渲染；RO 回调 rAF 节流；visibility 切换仅对越界 chip | 需求 §3 非目标：不虚拟化 |

## 2. 实施步骤

### S1 纯函数抽取 + 单测（红→绿）
- 改动：`src/client/market-state.js` 新增 D9 三函数（纯输入输出，无 DOM）。
- 新增 `tests/client-zonechips-clip.test.mjs`：空数组 / 单行 / 恰好两行 / 越界 1 颗 / 全部越界 /
  autoRef 命中与未命中，以及**展开态激活深层分类 → ⌃ 收起后不弹回**（record-only 路径，R1-Q3）。
- 完成标准：新测试红→绿；`npm test` 全量零新增失败。
- 依赖：无。

### S2 渲染结构改造 + 样式（D1–D6）
- 改动：`main.jsx` ZoneChips 渲染段（`:962-981`）改全量渲染；内嵌样式表新增
  裁剪容器/覆盖徽章/钉住筛选样式（复用既有 alias token）。
- 补 `tests/client-render-smoke.test.mjs`：ZoneChips 全量渲染不抛 + 全部 chip 均在 HTML 中
  （`renderToString` 断言，对齐现有 `:105-107`、`:285` 用例风格）。
- 完成标准：smoke 新旧用例绿；无头目检折叠/展开两态结构正确；探针断言 `.dshm-chips`
  `position:relative` 生效、chip `offsetTop` 参照系为 `.dshm-chips` 内容盒顶（R1-Q7）。
- 依赖：S1。

### S3 重测钩子（D7）
- 改动：ZoneChips 内挂 RO（观察 `.dshm-chips`，rAF 节流、卸载时 disconnect，feature-detect 降级）
  与 `document.fonts.ready` 重测；测量逻辑改为「全量 DOM offsetTop 分组 → 调 D9 纯函数 →
  setState(hiddenCount/clipTop/collapsedGeom)」；deps 增补 `stuck`、`rowHeight`。
- 完成标准：无头探针 V1 冷存储首开=两行+正确+N（先红后绿）；V3 多档宽度即时重算
  （含精选区 gutter 不预留断言，R3-N4）。
- 依赖：S2。

### S4 吸顶与 autoExpand 适配（D2/D8）
- 改动：`stuck → maxRows=1`（重测由 deps `stuck` 确定性触发，RO 兜底）；D8 判定替换
  （`:915-925` 一带）；0.9.52 哨兵（`:945-951`、`:971-976` 一带）**不动**。
- 完成标准：探针 V4（吸顶收一行/**+N 与逐 chip visibility 按一行口径重算**、回滚恢复两行口径，
  且**吸顶态筛选与 +N 互不遮挡、均可点**）、
  V5（展开/收起/自动展开/autoRef，含「展开态激活深层分类 → ⌃ 收起不回弹」）全过。
- 依赖：S2（可与 S3 并行，S3/S4 均改同一组件，落地时按序提交避免冲突）。

### S5 清理
- 改动：删除 `fit`、`collapsedBudget`、slice 相关死代码与孤儿 CSS。
- 完成标准：`grep -nE "rows1|rows2|collapsedBudget|setFit|fit\." src/client/main.jsx` 零命中；
  `npm run typecheck` 零错误。
- 依赖：S3、S4。

### S6 全量验证矩阵
- 跑 V1–V8（无头探针脚本按需求 §4 逐条落成断言，脚本临时不入库，与 0.9.52 惯例一致）；
  V8 = `npm test` 全量 + `npm run typecheck`。
- 完成标准：V1–V8 全过。
- 依赖：S5。

### S7 发版 0.9.53
- 双语 CHANGELOG（0.9.52 体例）→ `npm version 0.9.53` → commit → tag `v0.9.53` → push →
  Actions OIDC 发布（流水线已含发后 10 分钟验证）→ `dshm_upgrade` → 真机 e2e（含冷存储 V1）。
- 完成标准：V9 全过；registry `latest=0.9.53`；本机插件版本一致。
- 依赖：S6。

## 3. 风险与回退

| # | 风险 | 缓解 | 残余风险 |
|---|---|---|---|
| R1 | overlay 与 chip/overlay 间碰撞（①+N↔末行 chip、②筛选↔行尾 chip、③展开 ⌃↔行尾筛选、④吸顶单行 筛选↔+N） | ①② gutter 几何保证；③ ⌃ in-flow 结构性消除；④ 同组水平 flex + gap 结构性消除（D5/D6）；V3/V4/V6 探针加 **包围盒零相交断言** 与 **「吸顶态筛选与 +N 互不遮挡、均可点」断言**（多档宽度） | 极窄宽度下 chip 仍可能与 gutter 边缘相接（视觉降级，无功能损失） |
| R2 | 吸顶两行→一行高度跳变 | 与现状行为一致（现状即跳变），不新增处理 | 无 |
| R3 | RO 自触发循环 | RO 观察对象与裁剪宿主同为 `.dshm-chips`：stuck 切换/max-height 变化触发的一次 RO 回调**正是 Q2 所需的重测入口**，不构成循环——回调按当前几何重算，值无变化则不 setState（幂等不动点），且 deps `stuck` 为确定性主路径、RO 仅兜底；deps 中 `rowHeight` 的自触发同理：chip `offsetHeight` 与 max-height 无耦合（裁剪不改 chip 高度），校正至多一次、同值（差值 ≤0.5px）不写回，按幂等不动点收敛（R2-N2） | 低 |
| R4 | 自动展开与逐 chip visibility 竞态 | 裁剪线/可见性/自动展开在同一重测回调内单点计算 | 低 |
| R5 | 发版后 registry 可见性延迟 | 流水线发后验证窗口 10 分钟（0.9.52 实测 8 分钟延迟教训，CI 已固化） | 低 |
| R6 | 桌面 profile 主题差异 | 仅用既有 alias token；desktop 真机抽查列为 S7 可选项，缺失时以 token 兜底声明 | 低 |

**回退**：单 commit revert；已发布版本可用 `dshm install --id dsh-m --version 0.9.52` 定向回装。
纯客户端改动，无数据迁移、无服务端状态。

## 4. 明确不做（防发散）

- 不重构 `.dshm-chips` 以外头部结构；不动 `zoneChips()` 数据层；不动筛选弹层功能；
- 不在本计划内处理「首挂载测量过早」以外的旧 UI 议题（如 chip 计数口径）。

## 5. 修订记录

- **v2（2026-10-08，评审 R1 后）**：采纳 R1-Q1～Q7 全部七条——
  Q1 裁剪宿主显式化为 `.dshm-chips` 并加「严禁 wrap 裁剪（哨兵安全）」约束（§0/D3，R3 重写）；
  Q2 测量 deps 增补 `stuck`（D7③）+ V4 断言补「+N/visibility 按一行口径重算」（S4）；
  Q3 autoRef 展开态记录路径显式化：折叠态测量快照 + record-only 路径（D8），S1 补测试用例；
  Q4 碰撞矩阵三类对策 + gutter 几何保证 + 删除「位置接近」不实表述 + 弹层锚点影响评估（D5/D6）；
  Q5 RO/document.fonts feature-detect 降级（D7④）；
  Q6 S5 grep 模式补全 + typecheck 统一为 `npm run typecheck`（S5/S6）；
  Q7 offsetTop 参照系统一为 `.dshm-chips` 内容盒（D9）+ S2 断言。
  需求文档 G1–G5/V1–V9 未改动（目标不变，均为实现层细化）。
- **v3（2026-10-08，评审 R2 后）**：采纳 R2-N1～N3——
  N1 碰撞矩阵补第④类：折叠态右侧 overlay 由「筛选右上/+N右下 双列」改为**水平并排组 `[筛选][+N]`**
  钉在末可见行右端（吸顶单行态两按钮同行并排，结构性消除重合），gutter 统一 132px（D5/D6），
  V4 断言补「吸顶态筛选与 +N 互不遮挡、均可点」（S4），R1 碰撞清单补④；
  N2 deps `rowHeight` 自触发收敛论证补入 R3（裁剪不改 chip 高度 → 至多校正一次）；
  N3 行号漂移修正：⌃/＋N 按钮 `:974-977`→`:981-984`（D5）、filterwrap `:331-332`→`:332`（D6）、
  哨兵 `:965-971`→`:971-976`（S4）。
- **v3.1（2026-10-08，S2–S6 实施中落定的两处实现级细化，语义与评审结论一致）**：
  ① D3 微调——`overflow:hidden` 与 `max-height` 均仅折叠态施加（`.dshm-chips-clip` 类）：展开态必须解除裁剪，
  否则筛选弹层（锚定于容器内 `.dsvm-filterwrap`，`top:calc(100%+6px)`）会被剪掉；
  ② D8 实现拆分——「active 置空重置」与「自动展开决策」拆成两个 effect（重置 deps 仅 `[active]`）：
  合并写法 + deps 含 `expanded` 时，无激活分类下点 `+N` 展开的瞬间会被「!active 重置」回滚
  （S6 无头探针暴露，V5 expandWorks 红→绿）。探针另发现：挂载容器包装会改变 sticky 包含块，
  行为验证必须保持 ZoneChips 为 `.dshm-body` 直接子元素（与真实面板同构）。
- **v3.2（2026-10-08，执行结果评审 R1 后）**：采纳 R1-Q1/Q4/Q6——
  Q1 确定性重测 deps 以 `chips` 引用替代 `chips.length` 并叠加 `active`（同长度内容变化/激活加粗
  均确定性重测，消除「RO 因 max-height 钳制失聪」的陈旧 geom 盲区，D7 精神内补全）；
  Q4 overlay 组垂直居中改按 rowHeight 计算 bottom 偏移（28px 组盒在 22px 行上居中）；
  Q6 `⌃` 手动收起无条件记录 autoRef（激活分类存在时）——「手动收起」全路径被尊重，
  消除「展开态 geom 陈旧 → 收起重测 → 越界弹回」的边缘漂移；Q3 主题抽查并入真机 e2e；
  Q5（registry.json 计划外改动混入 tag）按主人规则仅记录不实施。
