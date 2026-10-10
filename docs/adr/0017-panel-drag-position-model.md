# 还原态面板拖拽与位置记忆：绝对定位烘焙 + titlebar 契约 + 拖拽观感不变量（ADR-0017；v1 = 0.9.69，v2 = 0.9.70）

市场面板（`.dshm-panel`）自 0.7.7 起有了窗口化形态（最大化/还原 + `dshm-panel-fullscreen` 记忆），但还原态下位置恒为 overlay flex 居中，用户无法摆放。本卡为它补上窗口的最后一半语义：按住头部（`.dshm-head`）自由拖拽、释放位置记忆、下次打开还原。四条硬性需求（需求方原话）：① 头部现有菜单点击零影响；② 性能 OK 跟手跟鼠标；③ 全屏后不允许移动；④ 运动范围 web profile 受浏览器约束、desktop profile 避开壳层系统按钮区——第 ④ 条正是 dsh-quota-watch 胶囊悬浮框踩过的坑（`-webkit-app-region:drag` 带按布局吞点击、无视 z-index，胶囊停进去就再也抓不回来，quota-watch 0.1.20 以 `titlebarTopInset` 契约修复）。

设计走 `/grill-with-docs` 三轮对齐（2026-10-10；Q1–Q9 全部按推荐锁定，Q9 因需求方实测 openbmc 皮肤下 quota-watch 胶囊拖拽变半透明而修订为「计算值固化强制实心」）；实施计划 `docs/plans/2026-10-10-panel-drag-position-implementation-plan.md` 经独立评审 Agent 三轮对抗审核（R1-1～R1-10、R2-1～R2-3 共 13 条，全部「修改并复核通过」，含版本基线陈旧、CJS/ESM 误判、`!important` 定长算术、rAF 残帧竞态、grabbing 光标死代码五个实质缺陷）后执行；执行结果另经同评审 Agent 逐项复核（E1-1 latest-ref 镜像同步时序竞态为唯一阻断项，已修复并以结构锚钉住 render 期赋值规格）。0.9.69 发布当日用户双态实拍裁决：拖拽期实心在浅色模式下实/玻璃跳变观感突兀 → **本 ADR 修订 v2（0.9.70）：实心固化退役，改为「拖拽观感与静止态逐像素一致」**（见决策 3）。参考实现：`dsh-quota-watch` 的 `prefs.mjs`/`drag.mjs`/`client.mjs attachDrag`（公式契约自 0.1.20 引入，参照核对于 0.1.24——版本标签只作溯源不作对齐依据）。

## 决策

1. **位置模型 = 绝对定位烘焙；无记录 = flex 居中逐字节不变**：位置记忆（localStorage `dshm-panel-pos`，`{"x","y"}` = 面板视口左上角绝对坐标）存在时面板加 `.abs`（`position:absolute;margin:0`）——overlay 本身是 `inset:0` 的 fixed，绝对定位坐标即视口坐标；无记录时面板完全走旧渲染路径。拖拽中 `transform: translate3d` 直写面板节点（**拖拽帧绝不走 React state**），释放一次性烘焙为 left/top + 持久化 + `setPos` 收口一次。纯逻辑与接线分离：`src/client/window-drag.js`（DOM-free，node:test 直测）+ main.jsx 手势状态机（pointer capture + 手势期才挂 document 监听 + pointermove 只存点、样式写集中在 rAF 帧内——不声明「同帧合并/每帧一次读写」，帧回调首行 `!dragging || !lastPoint` 守卫拦释放后在途残帧）。
2. **clamp = 四周 8px + titlebar 契约**：`clampPoint` 四周 `PANEL_MARGIN=8`（拖拽是用户显式动作，不复用 overlay 静止态的 24/16/24 padding）；top 额外叠加 `titlebarTopInset`——读 `<html>` 的 `data-windows-titlebar` + `--dsh-windows-titlebar-height`，`data-fullscreen` 清零，Web/浏览器/jsdom 无属性恒 0（与 quota-watch 契约逐字同源，属性存在性判定、不判版本号）。inset 只抬 minY 不削 maxY；`Math.max` 退化守卫兜 size 大于视口。还原态渲染后（挂载/全屏往返）与 resize 时重夹紧（layout effect paint 前生效）；全屏态与拖拽中跳过。
3. **皮肤免疫 = 拖拽观感与静止态逐像素一致（v2 修订，替代 v1 计算值固化）**：玻璃皮肤把 `--dsw-alias-bg-base` 定义成 α=0.55（openbmc/uefi 实测），v1（0.9.69）为此做「手势开始读 `getComputedStyle` 最终色强制 α=1 写 `--dshm-drag-bg` + `!important` 自持 background + 关 blur」，用不透明对抗透字；0.9.69 发布当日用户浅色模式双态实拍裁决**实/玻璃跳变观感不可接受**。v2 反转：**拖拽态与静止态同玻璃同 blur，外观逐像素一致**——透字防护回归静止态既有不变量（毛玻璃模糊背景自持；透字病灶的成因是「关 blur 还留半透明」，两样都不动即无此病，openbmc 静止态可读性本就由 blur 兜住并被用户接受）。拖拽可供性只剩 grabbing 光标与投影加深；`solidifyColor`/`--dshm-drag-bg`/拖拽态 `!important` 全部退役（清单回归 4，定长断言于 `tests/client-lightbox.test.mjs`）。代价是拖拽期恢复每帧 backdrop 重滤镜（GPU 合成承担，弱机若报告掉帧再评估）；capture/手势期监听/帧内写/translate3d/will-change 等其余性能手段全部保留。
4. **手柄 = 头部全域、button 让位、双击全屏**：pointerdown 落 `.dshm-head` 即启动拖拽，`closest("button")` 门卫让位（tab/全屏/关闭钮点击语义原样）；多指重入 `if (dragging) return`；slop 鼠标 6px/触屏笔 10px；头部 `touch-action:none` + `user-select:none`（无条件，全屏双击不闪选中）。双击头部非按钮区切换全屏（还原↔全屏均可）；全屏态 pointerdown 直接不启动拖拽；还原↔全屏往返不丢位置。grab 光标规则 `.dshm-panel:not(.full):not(.dshm-panel--dragging) .dshm-head` ——cursor 按「元素自有声明 > 继承」解析，拖拽中 head 无自有声明才能继承面板根的 grabbing（否则死代码）。
5. **无磁吸**：释放即停（「自由拖拽」语义）。quota-watch ADR-0002 的边缘磁吸停靠不搬——胶囊小、贴边是收纳；面板 920×680 大、用户摆放就是终态。

## Considered Options

- **常驻 transform 位置模型（flex 居中为 rest + 持久 translate3d 偏移）**：少一次定位形态切换，但 transform 常驻让「rest 随视口变化」的语义变绕，resize 后偏移漂移需反向补偿——被否（绝对定位烘焙语义直白，释放后零 transform）。
- **拖拽走 React state（setPos 每帧）**：每帧重渲整棵面板树（两分区市场数据 + 卡片林），必然掉帧——被否（红线：拖拽帧不经 React）。
- **clamp 复用 overlay 静止态 padding（24/16/24）**：拖拽是显式动作，静止态留白不该约束运动范围，8px 更符合窗口直觉——被否（quota-watch MARGIN=8 先例）。
- **底色取皮肤变量 + 关 blur（quota-watch 原方案）**：openbmc/uefi 玻璃皮肤下 α=0.55 透字，需求方实测否决——被否。
- **模糊常开不切换（= v2 最终方案）**：v1 以「每帧重滤镜是全链最贵合成操作、弱 GPU 必掉帧」为由否决本条、选了实心固化；0.9.69 实拍证明实心的观感代价更高——**v2 推翻 v1 的否决**（观感连续性优先，重滤镜成本由 GPU 合成承担，弱机掉帧再评估）。
- **边缘磁吸停靠**：见决策 5——被否。
- **维持现状（不可拖）**：面板已是事实上的「窗口」（有全屏/还原钮），却不能移动——被否（需求方主诉）。

## Consequences

- **性能预期**：静止零额外监听（手势期才挂 document 级）；拖拽每帧 = compositor 平移 + 一次 backdrop 重滤镜（v2：blur 常开换观感连续，GPU 合成承担，弱机掉帧再评估），全程零 React 重渲，释放才 commit 一次。
- **验收门**：全量测试 ≥ 1324（0.9.70 实测，含实心固化用例随退役移除）；typecheck 零错误；`lib/client.js` 含 `dshm-panel--dragging`/`dshm-panel-pos` 锚、零 `--dshm-drag-bg` 残留（负向锚）。手工冒烟六条：web 拖拽+菜单零影响+记忆还原、全屏禁拖+双击+按钮负向、首开居中零变化、desktop 标题带避让、openbmc 皮肤拖拽观感与静止态一致（v2）、触屏双指不跳变。
- **行为零变化承诺**：无位置记忆时首开渲染与旧版逐字节一致；`.dshm-overlay` 居中布局、`.dshm-panel.full` 全屏布局、0.9.27 防拖拽误关守卫（pointer capture 下守卫路径本就不触发，另加 suppressNextClick 双保险）、Esc 关面板、灯箱/详情 modal 语义全部不动。
- **GLOSSARY**：新增「还原态（Restore State）」「拖拽手柄（Drag Handle）」「位置记忆（Position Memory）」三词条（已入档）。
- **反哺候选（不在本卡范围）**：quota-watch 胶囊的拖拽半透明病修法随 v2 更新——拖拽期保留 blur 与半透明底（本 ADR v2 同款观感不变量），而非 v1 的实心固化。
- **发布形态**：v1 = 0.9.69（OIDC tag 流程已发）；v2 修订随 0.9.70 发版。
