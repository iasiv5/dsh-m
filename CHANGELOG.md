# 更新日志 · Changelog

dsh-m 的完整版本历史，双语维护：**中文在前，英文在后**，同版本号对齐；各语言区块内按版本倒序排列。发版时请在两个区块各补一条目。

The full release history of dsh-m, maintained bilingually: **Chinese first, English second**, aligned by version; entries within each section are newest-first. When releasing, prepend an entry to both sections.

---

## 中文

### 0.9.66 修复：触屏滑动方向与移动端惯例相反（用户实机反馈）

- **根因**：0.9.65 触屏滑动把映射锚在了键盘光标隐喻上（`ArrowRight=next` ⇒ 手指右拖=下一张），而触屏的正确隐喻是**内容拖拽**——手指拖着图像条走，**往左拖露出右边那张＝下一张**（相册/微信/车龙全部如此）。`swipeDir` 返回的手指位移方向被原样喂给了 `lbStep`，致真机上「左滑出上一张、右滑出下一张」，与全部肌肉记忆相反。
- **修复**：调用点取反映射 `lbStep(index, -dir, …)`；`swipeDir` 纯函数语义不变（仍报手指方向），文档注释明确「返回值是手指方向而非翻页方向，调用点必须取反」。键盘 ←→ 不动（桌面光标惯例：←=上一张、→=下一张，两者隐喻各自成立互不干扰）。
- **探针同批修正**：`verify-lightbox.mjs` A31a/A31b 断言按正确惯例重写（修正后旧断言转红即方向确已翻转的实证）；附带修正探针编号撞车——尾部既有 Primary 场景 A26–A29 保留，新特性场景编为 A30（预取命中）/A31（滑动）/A32（焦点圈闭）；A19 重写为时序确定性版双断占位（当轮验证附带产出：疑似回归经消融+worktree 对比+确定性时序三重取证定谳为「预取预热了场景前提图」，非回归，取证记录见探针内注释）。
- **验证**：1289 项测试全绿、typecheck 零错误；浏览器探针 50/50（A31 五断言含方向翻转实证 + A32 圈闭六断言 + A30 预取命中 + A19/A20–A25 既有锚全数保持）。

### 0.9.65 优化：灯箱邻图预取 + 触屏滑动切换 + 焦点圈闭

- **邻图预取**：当前图加载完成（`useImgChain` settled）后静默预热左右邻——URL 用与灯箱真实请求**逐字节同形**的 `weservUrl(w=1600)`，翻页直接命中浏览器缓存近零等待。纯 best-effort：不碰赢家记忆/链状态，预取失败对真实链零影响（导航时照常走 weserv→原图双兜底）；`prefetchedRef` Set 去重防来回翻页重复发起，Set 随灯箱挂载期生命周期（重开重新预热）；单图由 `lbNeighbors` 空表自然短路。
- **触屏滑动切换**：touch 指针横向滑过阈值即翻页（`swipeDir` 纯函数判向：|dx| ≥ 48px 且 |dx| ≥ 2|dy|；不设时长门槛，慢拖也算；竖滑/斜滑归零——纵向手势与 pinch 缩放可达性留给原生，`touch-action:pan-y pinch-zoom`）。只认 `pointerType==="touch"`——鼠标拖拽维持原生语义（图=原生拖拽、遮罩=按下+点击才关，0.9.27 防拖拽误关守卫不破）；滑动终结后 500ms 内根上 capture 吞掉合成 click（双保险：即便滑动止于 ✕/遮罩也不触发其点击语义）。判向/邻图两枚纯函数入 `lightbox.js`（`swipeDir`/`lbNeighbors`，Node 单测覆盖）。
- **焦点圈闭**：灯箱开着时 Tab/Shift+Tab 只在灯箱内可聚焦控件（按钮/链接：✕/‹›/失败态重试+打开原图）间回绕；焦点已逃出灯箱（如点击遮罩落在 body）时拉回首/尾。portal 挂 body 后 Tab 本会走到背景面板，此处收口；DetailModal 自身 U8 债（无圈闭）维持不变，Esc 仍只关最上层弹层。
- **验证**：1289 项测试全绿、typecheck 零错误；`client-lightbox.test.mjs` 新增 6 项（`lbNeighbors`/`swipeDir` 纯逻辑单测 + 预取/滑动/圈闭/touch-action 结构锚），0.9.60/0.9.62 批次既有锚全数保持。

### 0.9.64 优化：设置页双清单并排重排 + 操作记录整体搬迁设置 tab

- **设置页网格（mock 驱动终审）**：社区清单/精选清单两卡并排 **4:7**（社区卡只读五项 ~250px 足矣，宽度让给交互更多的精选卡）；全屏态「关于」升入三卡行（`4fr 7fr 3fr`，不封顶——对齐市场「加列不加宽」哲学，设置页恰有三个卡片单元可用）；视口 ≤760px 单列回落；关于卡常态通栏、操作记录恒通栏（`nth-child` 定位，与 `Section()` 签名解耦）。
- **社区卡清爽列表**：标题行回归纯标题（去 `from` 前缀）；状态徽章降为绿/黄/红**小圆点**；行间发丝分隔线 + 数值右对齐等宽数字；「社区目录开关」入列表为末行（开关是目录属性，钉底反而脱离语境）；关态 = 提示行 + 开关行（重开入口不丢）。中途方案「统计带」（白盒大数字）经实评否决——卡片中的卡片是视觉噪音。
- **精选卡减行**：说明行缩短（被删的「条目格式可参照下载的默认清单」与下载按钮 tooltip 重复，零信息损失）；配置地址长 URL 单行省略 + `title` 悬浮全文。
- **操作记录搬迁（第二批）**：三 tab 共用的底部常驻区退役；`OperationsPanel` → `OperationsCard` 落位设置 tab 末位通宽卡——进行中组滚动区外常驻（进度不被滚走），已结束组进 220px 滚动区（展示上限 50 条防 DOM 无界，store/恢复校验不动），「清除已结束」钉底，空态 hint 卡常驻导览。
- **可见性补偿**：底部消失后失败/带警告终态无人主动发现 → 设置 tab 红点（复用 outdated 红点样式，清除/移除后随 syncOps 自灭）；市场卡「进行中」徽章点击改道：切设置 tab + 滚动定位操作记录卡（文案「查看操作面板」→「查看操作记录」）。
- **验证**：构建 verify 通过、typecheck 零错误、全量 1283 项测试连续 4 轮全绿（首轮 1 例与改动无关的瞬时 flake 未复现）；布局终稿经交互式 HTML mock 三宽度 × 三布局 × 多状态现场评审定稿（`docs/settings-layout-mock.html` 入库作设计记录）。

### 0.9.63 修复：点在加载转圈上不再无动作——转圈显式接 onClick=onClose

- **背景**：0.9.62 给灯箱加了走链转圈占位，但转圈是遮罩根的**子元素**，而 `backdropCloseHandlers`（0.9.27 防拖拽误关）只在 `mousedown` 与 `click` 都命中遮罩自身（`target === currentTarget`）时才关——点在 34px 转圈正中因此无动作。转圈显式接 `onClick: onClose`，与「点图即关」同语义：走链期间的任何一次点击都是有效的关闭逃生门。
- **验证**：`client-lightbox.test.mjs` 转圈锚随签名更新（门控 + onClick 语义）；全量测试/typecheck 照常。

### 0.9.62 修复：灯箱控件浅色模式下不可见——影院遮罩自持 + 控件深色玻璃芯片 + 加载转圈/淡入

- **根因（2026-10-09 用户浅/深双模式实拍）**：dsh-skins ADR-0007 浮层毛玻璃并集按 `[role="dialog"][aria-modal="true"]` 命中灯箱根（灯箱根带 dialog 语义），浅色模式下 86% 暖白 tint + blur14 把影院式黑遮罩改成了浅色毛玻璃；而 ‹›/✕ 沿用基础 `.dsvm-btn` 白色半透配方（`rgba(255,255,255,.14)` 底 + 白字白边），浅底上整体隐形。深色模式走皮肤 `rgb(18,18,26)` 分支尚可读，故「浅色看不清、深色还行」。无皮肤的原生形态（黑遮罩恒在）无症状——这正是它漏网到 0.9.61 的原因。
- **双侧修复**：① dsh-m 侧（本版）：灯箱 `background` 加 `!important` 自持——「深色遮罩 + 浅色控件」是影院面的组件自有可读性不变量，不随颜色模式/皮肤翻转；marketplace 社区皮肤不可枚举，不变量必须组件自己兜底（`!important` 清单定长 4，回归门钉住，新增须显式登记）。② dsh-skins 侧：三皮肤 `[role="dialog"][aria-modal="true"]` 追加 `:not(.dsvm-lightbox)` 豁免（1.5.1，ADR-0007 amendment）——语义上「弹窗毛玻璃」本就不该染指图片影院。
- **控件深色玻璃芯片**：‹›/✕ 从裸透明白改为与底部 pill 同族的深色芯片（slate-900 55% + 白描边 + blur8 + 投影）——深遮罩上靠描边/blur/投影出层次，浅遮罩上芯片本身就是对比面，任何颜色模式与皮肤下都可读；显式 `:hover` 提亮（特异性 0,3,0 压基础 `.dsvm-btn:hover` 0,2,0，免疫源顺序——评审 R1 同族教训）。
- **加载指示与淡入（UX 补强）**：灯箱走链期间（weserv 慢速/8s 守卫换层/直连大图）此前是空黑黑洞，现转圈占位（`useImgChain` 暴露 `settled`）；图片 onLoad 后 160ms 淡入换场；`prefers-reduced-motion` 下停用淡入、转圈降速。已知小瑕疵：转圈是遮罩的子元素，`backdropCloseHandlers` 防拖拽误关只认根元素——点在 34px 转圈正中无动作（点周边遮罩可关），0.9.63 补 `onClick` 收口。
- **验证**：1283 项测试全绿、typecheck 零错误；`client-lightbox.test.mjs` 新增 6 项结构锚（遮罩 `!important` 定长清单/芯片规则与显式 hover/转圈门控/淡入类名/settled 暴露/reduced-motion），0.9.60 批次既有锚（portal/复合选择器/拖拽带/焦点还原/序号 key）全数保持。

### 0.9.61 修复：大陆浏览器拉不到插件截图/图标——图片加载链 weserv 优先双兜底

- **根因（2026-10-09 实测）**：截图（raw.githubusercontent.com）与图标（github.com 头像）由用户浏览器直连拉取——服务器侧 200/0.2s，大陆浏览器路径时断时通，当日故障样本 dsh-wallpaper-engine 五图（22.5MB，含 10.4MB GIF）缩略图条与灯箱全空；0.9.60 已排除灯箱 v2 回归，图标「能显示」实为本地字母兜底。对标 dsh-market 1.66.14：缩略图无条件 weserv（其源码实测大陆 1.39s/23KB vs 原图 41KB）但灯箱直连零兜底——大陆点开大图同款黑洞。
- **图片加载链（ADR-0014）**：三类消费方（缩略图 h=300 / 灯箱 w=1600 / 图标 h=96）共用 `useImgChain`——weserv 层（`fit=inside&we=1&output=webp&q=80` 服务端缩放转码）优先，失败或 8s 人工超时（仅此层；直连层零人工超时防误杀慢速合法下载）换原图直连，再败走终态：缩略图剔除（全败隐藏整条）、灯箱占位「⚠ 失败 + 重试 + 打开原图 ↗」、图标字母渐变兜底。赢家记忆按 raw/avatar 两桶记最近成功层，**链启动时快照次序**——同批多图竞态下兄弟图不因偏好翻转跳层（执行期实证：缩略图 1 经直连成功翻转偏好后 2/3 全灭的竞态）；链内前进序感知（偏好为 direct 时 direct 败仍按序试 weserv，固定阶梯会跳过兜底直判死）。四处 shots 基准同步换 visible（整条门控/截图条 map/灯箱门控/键盘导航+effect 依赖），列表保持全量 map + `${i}:${src}` 稳定 key，灯箱 index 钳制防越界。
- **配套**：纯逻辑入 `src/client/img-chain.js`（URL 构造/桶分类/序感知 tier 机/赢家记忆，`WESERV_BASE` 单常量——未来设置项只改一处）；GLOSSARY 增「图片加载链（Image Chain）」一条；探针扩展 A16-A24（断直连/断 weserv/双断占位+重试/weserv 挂起 8s 守卫/赢家记忆/缩略图剔除/direct-first 换层 Probe 场景）+ `--live` 真网压缩实证；执行期探针 harness 三大确定性根基：**每场景全新 page（独立 context，消灭路由复挂竞态与跨场景解码复用）**、代次化 URL（凡需失败的 URL 全页生命周期唯一）、层序断言走 reqLog（page.on('request') 不依赖路由拦截）。
- **验证**：1256 项测试全绿（基线 1236 + 新增 20）、typecheck 零错误；探针 31/31 三连跑稳定；`--live` 压缩实证 mascot-drawer.png 直连 2859KB vs weserv 151KB（≈18.9×）。评审吸收轮（完整多轮独立 subagent 评审）：R1-1【阻断】8s 守卫在成功加载后不清除——成功图 8s 后被强制换层重载（大陆场景缩略图误剔除/图标字母化/灯箱变占位），修以 settled 语义（onLoad 置真、链启动/翻页重置、timer 四条件守卫含空 url），并新增探针 A25（成功驻留 >8.5s 行为钉子，旧代码必红）与计时门控源锚；R1-2 A22 补负向断言（导航后零 weserv 形态请求）、A24 断言首请求形态（赢家记忆翻转获得证伪力）；R1-3 freshState 清 reqLog（场景封闭）；R1-5 url 变化改渲染期 derived-state 重置（消除中间帧幽灵请求）；R1-6 --live 双侧校验 r.ok + image/*（错误页不得假 PASS）；R2-3 advance 防御性 settled 重置。第二轮终局裁决：共识 approve。遗留后续项：中间帧消除的行为级探针（现由源锚防回归）。

### 0.9.60 修复：截图灯箱窗口态无导航/无法退出——createPortal 逃出面板包含块 + 控件常驻

- **根因**：灯箱 `position:fixed` 是 `.dshm-panel`（`backdrop-filter` + `overflow:hidden`）的后代，面板盒成了它的包含块——图片按视口单位放大（旧 94vw/80vh），在 ≤680px 高的窗口态面板里必然溢出，in-flow 的 ‹›/圆点被裁出屏外，又没有 ✕；全屏态面板恰为视口才「碰巧」可见（即「只有全屏才有导航按钮，窗口态图片占满小屏且无法退出」）。
- **v2 修复（`b89af18`）**：① 灯箱 `createPortal` 挂 `document.body`——逃出包含块，窗口/全屏/窄屏任何状态都按真实视口定位（SSR/无 document 回退原树，冒烟测试照常渲染）；② 控件全部绝对定位贴边，构造上不可能被图片挤出屏——右上 ✕ 常驻、两侧 ‹› 大热区、底部「计数+圆点+操作提示」pill，图片降为 74vh 给控件留位；③ 退出路径四条：点图即关（zoom-out 光标）、点遮罩关、Esc 关、✕ 关——键盘 ←→/Esc 语义不变（DetailModal 文档级监听不受 portal 影响）；④ 单图不渲染 ‹›/计数/圆点（无死控件），圆点热区 `background-clip:content-box` 扩到 18px，开灯箱即聚焦 ✕（对齐 DetailModal U8 先例）。
- **配套**：环形步进抽纯函数 `lbStep`（`lightbox.js`，组件与键盘共用，单测覆盖回绕/单图/非有限输入）；新增 `client-lightbox.test.mjs` 结构守卫（portal/✕/点图关/单图收敛/CSS 绝对定位/内联取模退役），SSR 冒烟补灯箱多图/单图结构断言。
- **评审吸收轮（独立 subagent 评审，发布前落码）**：R1 CSS 级联——`.dsvm-btn` 基础规则源顺序靠后，实测反杀 ✕/‹› 的 `padding:0/font-size:26px/radius:10px`（‹› 字形实渲 13px），改复合选择器 `.dsvm-btn.dsvm-lb*`（特异性 0,2,0，顺序免疫）；R2 Windows Desktop 拖拽带——灯箱 `top:var(--dsh-windows-titlebar-height,0px)` 让带（0.9.4 先例，Web 无变量回落 0px 行为不变），✕ 不再落进壳顶 `-webkit-app-region:drag` 吞点击带；R3 焦点还原——关闭灯箱把焦点归还触发的截图缩略图（捕获 effect 声明于聚焦 ✕ 之前，`isConnected` 防已卸载元素）；R4 灯箱圆点与缩略图条 key 改序号（URL 重复不撞车）；R5 无头探针固化为 `scripts/verify-lightbox.mjs` 入库（手动跑，需 playwright-core），结构断言收敛为 includes 级锚（逐字正则红灯语义是「文本变了」非「行为变了」），SSR 冒烟补 `role=dialog/aria-modal` 与重复 URL 圆点断言。
- **验证**：1236 项测试全绿、typecheck 零错误；`scripts/verify-lightbox.mjs` 复刻 `.dshm-overlay > .dshm-panel` 真实语境 19/19 断言——面板内 fixed 探针盒=面板盒（包含块实证）、灯箱盒=全视口、✕/‹›/pill 全程在视口内、**计算样式级联正确（R1 回归门）**、›/圆点/‹/←→ 导航与 Esc/点图关闭正确、**关闭后焦点还原缩略图（R3）**、**拖拽带 40px 避让（R2）**、全屏态回归、500px 矮窗口控件仍常驻（旧版此处必裁）。

### 0.9.59 优化：分类行左缘内缩 8px + 全屏下空转 ⌃ 收起钮按行数派生隐藏

- **分类行内缩（`f42e5be`）**：分类 chips 行与搜索框/卡片左缘齐平，小颗粒胶囊贴着大元素左缘视觉憋仄；分类行整体右移 8px 留出呼吸空间。仅作用分类行（ZoneChips），上方分区 chips 行不随动。`offsetLeft` 与 absolute 定位同以 `.dshm-chips` 的 padding 盒为原点 → `+N` 跟随、右侧筛选钉位、`offsetTop` 裁剪几何均不受影响。
- **⌃ 空转修复（`7cbdf11`）**：全屏等宽容器下分类 chips 可能排进 ≤ maxRows（2）行，展开态 `⌃` 收起钮点击后布局零变化（`hiddenCount=0` 连 `+N` 都不会出现），成死按钮。新增展开态行数测量 `expRows`（复用 `chipRows` 纯函数，measure 展开态分支只写 `expRows` 不动 `geom`），`⌃` 仅当展开行数 > maxRows 时渲染；ResizeObserver 在展开态也挂载——全屏↔窗口切换的宽度变化正是重测触发源，全屏下 `⌃` 自动隐藏、退回窗口自动恢复，行数含 `⌃` 自身故显隐收敛不振荡。
- **验证**：1224 项测试全绿；真实 DSH Web 实测窗口/全屏两态 `⌃` 显隐与收起行为、分类行 8px 内缩生效。

### 0.9.58 优化：+N 动态紧跟末可见分类，并与其框高一致

- **位置（`4ade54f`）**：在 0.9.57 的独立安全槽位中，根据末可见分类 chip 的实测右缘设置 `+N` 左缘 = 右缘 + 6px；槽位由 52px 扩为 60px，窄宽时仍不与分类或筛选重叠。精选区没有筛选时不额外预留筛选 gutter；展开态 `⌃` 仍位于列表尾部。
- **框高（`aeed14c`）**：`+N` 直接采用末可见分类的实测 border-box 高度，并以 inline-flex 居中数字，不再依赖西文数字与中文标签各自的浏览器自动行高。只改 `+N`，不改变分区 chip 的尺寸。
- **验证**：1224 项测试与 typecheck 全绿；用真实 DSH 目录数据在 880/700/520/420/320px 社区区测得两框同高 21px、顶边差 0、水平间距约 5–6px、相交面积 0；260px 精选区也无重叠，精选↔社区往返正常。

### 0.9.57 修复：精选切换后面板崩溃/无法重开 + 折叠筛选双框与 +N 重叠

- **根因（0.9.56 真机复现）**：精选区的标签对象可能每次父级重渲染都重建；layout effect 依赖 `chips` 数组引用及自身更新的 `geom`，同步测量反复进入、最终触发 React `Maximum update depth exceeded`（#185）。React 清空面板树但留下 `#dshm-panel-root`，旧入口守卫只检查容器存在，导致点击入口永久无效。叠加折叠筛选定位壳和按钮的双边框、以及 +N 位置夹取/文档流试验在窄宽下压住相邻 chip。
- **修复**：按实际渲染的分类 id/文案/计数生成稳定内容签名，layout effect 不再同步依赖自身 `geom`；预留槽变化改在上一轮状态提交后的 rAF 复测。回退 0.9.56 的 `display:none`/in-flow 反馈链，恢复分类全量占位 + 越界 `visibility:hidden`，以完整 `offsetTop` 按行纯派生隐藏数；+N 脱离文档流，独占右侧 52px 槽（筛选另占 96px），双类 CSS 选择器确保总预留不被 gutter 覆盖。末可见行顶按**去重行**而非第 N 颗 chip 计算。筛选外壳去边框仅保留定位；若崩溃留下无可见面板的空容器，再次点击时先移除再挂载。
- **取舍**：+N 优先保证零重叠、正确计数和可重开；不再强求其贴着最后一颗分类。窄宽下边界分类自然少显示，`+N` 如实计入；展开态 `⌃` 仍在分类列表末尾。
- **验证**：新增 3 个回归断言，累计 1224 测试全绿、typecheck 零错误；真实 DSH Web 加载候选客户端验证精选↔社区连续三次、关闭再开及崩溃残留空容器恢复；260–880px 六档 +N/chip/筛选相交面积恒 0，精选五类不出现错误 +N。

### 0.9.56 变更：ZoneChips +N 重叠根治——in-flow 文档流布局 + 折行减类（主人方案）

- **缺陷（0.9.55 真机复现）**：折叠态 `+N` 采用「绝对定位 + contentW−48 夹取」，当末可见行剩余空间小于徽章宽时，徽章压住末可见 chip（真机：+9 压住「文档与渲染 61」右端计数）。
- **根治（in-flow 文档流布局）**：`+N` 弃绝对定位，以 in-flow 插在「末可见分类」与「被裁分类」之间——flow 布局与 chip 的重叠在构造上不可能。
- **折行减类（主人方案）**：被裁分类 `visibility:hidden` → **`display:none`**（不占位，折行减类生效前提）；测量发现 `+N` 顶 > 末可见 chip 行顶（被折出）⇒ `hiddenCount +1`，一枚可见分类退位、`+N` 退回末可见行，同时 `max-height` 扩一行给 `+N` 独占；棘轮单向下行，宽度增大时保守不多显（+N 计数仍真实）。
- **测试**：全量 1221 例零失败、typecheck 零错误；无头探针实证常宽 880/窄宽 420/展开/收起/Q1 回归全部 `chipOverlapPx = 0`、`+N` 全程可见、展开态 23+⌃+筛选全量、收起后 +N 回归蓝筐位。

### 0.9.55 变更：ZoneChips 折叠/展开切换钮内联化（对齐 dsh-market 参考设计）+ overlay 叠涂 scrim 强化对比度

- **切换钮内联化（主人提出，dsh-market v1.66.11 参考设计）**：`+N` 从右侧 overlay 组改为**绝对定位内联**——钉在「末可见分类 chip 右侧 +6px」（即末可见行剩余空位），与展开态 `⌃`（列表末尾 in-flow）构成统一位置语义「紧跟当前列表末尾」，只翻方向不挪位；窄宽度放不下时贴内容右缘收口（不侵入筛选槽）。gutter 随 `+N` 移出由 132px 瘦身至 96px（仅承载钉住筛选），同宽度可多显示约 1 颗分类。overlay 组内 `+N` 移除后仅剩钉住筛选，第④类碰撞（R2-N1）自然消解。
- **overlay 叠涂 scrim（主人提出：浅色主题对比度偏低）**：根因是 `--dsw-alias-bg-base` token 本身 0.55 半透明；overlay 底衬改同 token **三层叠涂**（background-color + 双 linear-gradient 层），有效不透明度 ≈ 1−0.45³ ≈ 91%，深浅主题自适应（深色 rgba(12,26,38,·) / 浅色 rgba(247,250,252,·) 均显著强化），不引入硬编码色值。
- **测试**：全量 1221 例零失败、typecheck 零错误；无头探针实证：折叠态 `+N` 左缘 = 末可见 chip 右缘 +6px 同行对齐、scrim 双梯度、筛选单钮零碰撞、收起/展开往复位置稳定、Q1 回归（长文案 hidden>0）；真机截图见发版记录。

### 0.9.54 变更：评审修复随版（ZoneChips 重测盲区/⌃ 弹回/overlay 居中）+ dsh-skip-browser-auth 收录文案对账

- **ZoneChips 三处评审修复（执行结果评审 R1，`b2aab5f`）**：① 测量 deps 以 `chips` 引用替代 `chips.length` 并叠加 `active`——同长度内容变化（计数刷新/激活加粗变宽）确定性重测，消除 RO 因 max-height 钳制失聪导致的陈旧 geom 盲区（被裁 chip 保持可聚焦/激活分类越界不自动展开的失效窗口，D4 违背态）；② `⌃` 手动收起无条件记录 autoRef——手动收起全路径被尊重，消除展开态 geom 陈旧时收起被决策 effect 弹回的边缘漂移；③ overlay 组按 rowHeight 垂直居中（bottom 补偿偏移）。
- **收录文案对账（回应评审 Q5/Q7）**：dsh-skip-browser-auth 描述两轮更新随版生效（`ed6043a` 判别修复说明 + 缺陷警示、`23da0fd` 警示期结束瘦身保留保持最新版提示）；自本版起发版前执行 tag↔CHANGELOG 对账，提交弃用 `git add -A` 改显式定点添加。
- **测试**：全量 1221 例零失败、typecheck 零错误；定向探针实证 Q1（同长度文案变化 hidden 0→5 即时重算）与 Q6（⌃ 收起后 +500ms 不弹回）；真机 e2e（V1 冷存储/V4 吸顶/V6 筛选/V7 深色）见 0.9.53 证据链。

### 0.9.53 变更：ZoneChips 方案A「隐身全量测量」——冷挂载分类行错误折叠根除 + 行容量即时重测

- **动机（0.9.52 端到端验证发现）**：新浏览器 profile（无 localStorage 快照）首开面板时，市场数据未到 → `fit` 在空列表上测量 → 数据到达后重测面对的是按陈旧预算折叠的 DOM（只渲染 1 颗 + 「+N」）→ 棘轮式冻结在「3 颗 + +20」单行折叠。暖会话（快照命中）首挂载即全量数据、一次测准，故 0.7.0 以来从未暴露。姊妹问题：测量 effect 不监听宽度变化，窗口缩放后 `+N` 与实际容量脱节。完整根因链与无头实证见 `docs/plans/2026-10-08-zonechips-visual-clip-requirements.md`。
- **方案（方案A「隐身全量测量」，经独立评审三轮 11 条意见收敛，评审记录见计划文档修订记录）**：废除 slice 预算，分类 chips **全量渲染**，折叠改为 `.dshm-chips` 上的 `max-height`（实测行高 × 行数）+ `overflow:hidden` 视觉裁剪；越界 chip 逐颗 `visibility:hidden`（与现状「未渲染不进 tab 序」对齐）；`+N`/`⌃` 改右侧 overlay 组（水平并排、钉末可见行右端，gutter `--dshm-clip-gutter:132px` 几何保证与 chip 零相交）；筛选触发器折叠态钉 overlay、展开态维持 in-flow；重测钩子 = deps（`chips.length/expanded/zone/stuck/rowHeight`）+ `ResizeObserver`（rAF 节流）+ `document.fonts.ready`，均 feature-detect 降级（先例 `:947`）。测量纯函数（`chipRows/countBeyondRows/clipTopOf/autoExpandDecision`）下沉 `market-state.js`，20 例 Node 单测直测。
- **语义保持**：吸顶收一行/回滚两行（0.9.52 哨兵链路不动，裁剪宿主为 `.dshm-chips`、严禁 wrap 裁剪——wrap 裁剪会剪掉哨兵致 stuck 永久误判，评审 Q1 阻断项）；`+N` 展开/`⌃` 收起；激活分类越界自动展开 + autoRef「手动收起后不弹回」（实现拆分为重置/决策两 effect，评审 Q3）；0 计数降透明。行为改进一处：折叠态筛选由「行尾第 3 行 in-flow」改为「末可见行右端 overlay 常驻」。
- **测试**：新增 `client-zonechips-clip.test.mjs` 20 例 + smoke 全量渲染断言 1 例，全量 1221 例零失败、typecheck 零错误；无头探针 V1–V6 矩阵实证（冷数据到达两行折叠正确 / 三档宽度即时重算 / 精选区不预留 gutter / 吸顶一行重算且回滚恢复 / 筛选与 +N 零遮挡均可点 / 自动展开与 autoRef 不弹回），探针不入库（0.9.52 惯例）。

### 0.9.52 变更：头部行距统一——吸顶哨兵移出 flex 流，消除搜索框与分类行间 25px 空带

- **动机（主人截图发现）**：市场头部「搜索框行 → 分类 chips 行」间距实测 25px（12 gap + 1px 哨兵 + 12 gap），是「分区 chips → 搜索框行」12px 节奏的两倍余，社区/精选两区一致，视觉上是一条全宽无内容死带；搜索态下 ZoneChips 连带哨兵整体卸载、空带自动消失——证明是布局副作用而非设计节奏。
- **根因**：0.7.0 Task 10 引入的吸顶检测哨兵（1px div，IntersectionObserver 观察其滚出视口 → chips 吸顶自动收一行）是 `.dshm-body`（flex column, gap:12px）的直接子项，多吃一份 gap。哨兵必须在流内才能服务吸顶：直接删除 / `display:contents` / 与 wrap 外包 wrapper 三种朴素方案分别杀死 IO、令收缩永久生效、锁死吸顶行程，均否决。
- **改动（单点，ZoneChips 渲染尾）**：哨兵移入 `.dsvm-chipswrap` 内部绝对定位（`position:sticky` 本身即定位上下文），`top:-5px` 复刻旧几何——旧兄弟哨兵顶边恰在 wrap 上沿上方 5px，IO 出视口触发点逐像素等价。无头 Chromium 探针实证吸顶链路完整：pin 后 wrapTop=0、哨兵 −5px 出视口、IO `isIntersecting=false`（stuck 触发正常）。行距恢复 `zoneBar |12| searchRow |12| chips`：搜索框→分类行 24.36px→12px，头部净省 ~13px，浏览态与搜索态节奏一致。
- **测试**：全量 1200 例零失败、typecheck 零错误；几何与吸顶行为以临时无头探针实证后移除（不入正式套件）。

### 0.9.51 变更：社区条目 github 字段补全（图标覆盖 45.6% → 100%）

- **动机**：社区区 npm 源条目卡片恒为首字母色块——适配层 npm 分支只产出 `npm` 字段即定源，上游目录 `url` 里的 GitHub repo 映射只被降级进 homepage，`github` 字段恒缺，客户端 Icon 的 owner 头像兜底（`github.com/<owner>.png?size=64`）无从触发。实测 `dsh-plugin-catalog@2026.1007.4837`：4,226 条可收录条目中 npm 源 2,298 条 **100% 带 github.com url**，纯数据丢弃，非上游缺失。
- **改动（单点）**：适配层 npm 分支补派生 `github = githubFromUrl(url)`（子包 `/tree/` 取 repo 根、原样大小写；派生失败不产出键、不跳过条目，条目层宽松 Q43）。`source` 语义不变；客户端零改动——Icon 兜底、详情行「GitHub · npm」、已装 `registryGithub`（README 基址三级兜底第一级）既有链路自动生效。
- **语义激活（已在案接受）**：①合并层 github 碰撞分支开始作用于社区 npm 条目（同 repo 让位精选恒优先）——全量真实目录模拟新增让位 0 条（4,215 → 4,215）；②GitHub 源手装的插件可被社区 npm 条目匹配，升级走 npm 源（与精选双源条目既有语义一致）。性能面零回归：宿主侧零新增网络请求、latest 探测路径与缓存键不变、Q46 社区 github 探测豁免与 GithubBudget 不触及。
- **测试**：适配层翻转 1 断言 + 净增 4 例（github url 派生与原样大小写、非 github 域、无 url、非法形状），既有子包用例补 1 断言（取 repo 根）；合并层净增 2 例（github 碰撞让位、GitHub 源手装匹配，均红→绿）；全量与基线对照零新增失败、typecheck 零错误。

### 0.9.50 变更：README 兜底 /latest 两腿阶梯 + 未装文案 profile-aware + 兜底失败摘要

- **动机（上海 Windows 桌面机实机实证）**：desktop profile（生效源 npmmirror）打开 billion-context（705k 周下载）详情 Modal 的 README 折叠页恒报「web profile 未安装该插件」——npmmirror packument 实测 8,586,604 字节，超过 npmPackumentReadme 的 8MB（8,388,608）上限被 readCapped 拒（`502 响应超过上限`），兜底腿必失败后按 0.9.45 语义如实重抛原始本地错误；同期 npmjs packument 8,195,089 字节恰低于帽、readme 为空，web 侧显示「没有 README」只是帽下侥幸——该包高频发版，npmjs 超帽只是时间问题。
- **README 兜底两腿阶梯**：`npmPackumentReadme` 内部改两腿（对外签名与返回形状 `{readme, repo}` 不变）——腿1 `GET <生效源>/<pkg>/latest` 版本文档优先（KB 级小载荷、packument 超帽免疫；URL 拼法同 npmLatest 先例；**超时收紧 `Math.min(timeoutMs, 5_000)`**，同 npmLatest 首腿先例——生效源不可达时兜底最坏时延 40s→25s），readme 命中即短路；空/失败落腿2 packument（20s 满额，行为同 0.9.45）。任一腿成功即成功：readme 空渲染「没有 README」（含 latest 空白 readme + packument 失败的降级，不抛）；两腿全败抛终末腿（packument）错误。两腿均在生效源（ADR-0012），**不跨源**；两腿 readme 判空同一 trim 规则；repo 随到达的腿取 repository（packument 到达时以 packument 为准）。
- **未装文案 profile-aware**：`readInstalledPluginReadme` 新增第三参 profileName（缺省 'web'），host-api readme 分支传 `profile.name`——desktop profile 报「desktop profile 未安装该插件: X」（形态对齐 profile-ops 先例）；market/toggle/profile-transaction 等 web 事务专用路径的「web profile」文案不变（desktop 走官方 pluginManager 委派，到不了那些代码）。
- **兜底失败摘要（0.9.45「兜底失败如实抛原始错误」的语义修订）**：两腿全败时抛 `<本地未装错误>（npm README 兜底失败: <终末腿原因>）`——真实死因（如「响应超过上限 8388608 字节」）不再被吞，红字自解释；`cause` 保留原始本地错误。
- **测试**：versions.test.mjs describe 重写为阶梯用例组（显式 registry 贯穿两腿、缺省生效源形态断言、latest 命中短路、空落 packument、latest 失败兜住、空白 readme 降级、终末腿错误、两腿都空、超时收紧 deps spy、repo 归一语义注记），红→绿全程断言（红集合 {2,3,4,6,8,9} 与计划推演逐条吻合）；installed.test.mjs 增 profileName 用例；host-api.test.mjs readme 用例改断言 + 增 profile.name 传递与合成错误形态两用例。全量测试零新增失败（Windows 本机 symlink 族既有基线豁免）；typecheck 零错误。

### 0.9.49 变更：已装 README 基址贯通 + 链接归一三件（0.9.48 深入分析跟进）

- **已装视图基址贯通（P0，主缺口）**：0.9.48 已装详情挂载点误传不存在的 `it.github`，而已装插件走本地读取路径（`repo` 字段只在 npm 兜底路径附带）→ 已装 README 相对链接全部归 `#`。现改传 `vm.githubRepo`——installed-view 视图模型现成的三级兜底（registry 匹配 `registryGithub` → 已装包 package.json `repository` 解析 → 安装 spec `github:o/r` 解析），图标与 LinksRow 早就在用。装机浏览场景的相对链接/图片自此全部可锚定。
- **链接归一（P1）**：①协议相对 `//host/x` 补 `https:`——此前有基址时被错剥成仓库内路径、无基址时跳 DSH 站内；②`git@github.com:o/r(.git)` 内联链接归一 https 形态（README 的 clone 指引段落）；③有基址时 `#anchor` 锚 `github.com/<o>/<r>#anchor`（仓库首页 README 同名锚，裸 `#` 与图片 kind 不参与）。
- **host 侧解析口径统一（P2）**：`githubRepoFromRepository` 尾部从 `$` 放宽到 `[/?#]`——`github.com/o/r/`（尾斜杠）与 `…/tree/main` 等更深路径此前解析不出；与 versions.ts `extractGithubRepo` 同口径。
- **测试**：client-markdown 净增 4 例（协议相对两态、git@ 两形态、锚点四断言含 img kind 不锚）、installed 净增 1 例（repository 五形态含尾斜杠与子路径）；锚点断言随新行为更新；全量 1185/1185、typecheck 零错误。纯客户端+host 只读字段透传变更，刷新页面即生效。

### 0.9.48 变更：README 实体解码 + 相对路径仓库基址锚定（0.9.47 实装反馈两连修）

- **HTML 实体解码**：0.9.47 解析了标签但未解码实体——dsh-task-board 类 README 徽章间独立成行的 `&nbsp;` 按字面漏出。现命名实体（nbsp/amp/lt/gt/quot/copy/mdash/箭头/分数等 60+ 高频集）与数字实体（十进制/十六进制）均解码；文本段与 HTML 属性值都解（徽章 src 里 `&amp;labelColor` → `&labelColor`，shields 参数不再丢失）；`code`/`pre` 内不解码；未知实体与裸 `&` 原样保留；单趟解码不回炉（`&amp;lt;` → `&lt;` 文本，与浏览器一致），解码结果只作为文本节点、绝不重新参与标签解析，无注入面。
- **行内优先判定**：包裹标签（`<p align="center">` 等）剥壳后，若内部无空行分段、无 markdown 块结构、且行首标签均为行内/void 标签，则整块按行内 token 流渲染——徽章 + `&nbsp;` 连排在同一居中行（GitHub 语义），不再每行拆成独立段落；含块级结构（`tr/td/ul/li` 开头等）仍走 markdown 递归保结构。
- **相对路径仓库基址锚定**：`[README.md](README.md)` 这类相对链接此前被 safeUrl 归 `#`（点击无反应——既有安全归化，非 0.9.47 回归）。现 README 预览可携带仓库基址：相对链接锚 `github.com/<o>/<r>/blob/HEAD/<path>`、相对图片锚 `raw.githubusercontent.com/<o>/<r>/HEAD/<path>`（`./`/`../` 前缀归一）；绝对 URL 与页内锚点不受影响；无基址时保持归 `#` 旧行为。数据链路：npm packument 兜底时顺带提取 `repository` 归一为 `owner/repo`（仅 GitHub，git+https/git@/.git 形态归一，host-api 透传 `repo` 字段）；客户端以卡片 `github` 字段兜底；渲染基址为 renderMarkdown 级同步设置、进出恢复，不跨渲染泄漏。
- **测试**：client-markdown 净增 6 例（实体四类、独立 `&nbsp;` 徽章块、code 不解码与属性解码、基址锚定七断言、无基址回归与跨渲染泄漏）；versions 净增 1 例（repository 两形态归一 + 非 GitHub 归空）；全量 1181/1181、typecheck 零错误；真实数据端到端——dsh-TUI 25926 字符零泄漏零回归、task-board 真实徽章块三徽章一行居中 + `&amp;` 解码、相对链接正确锚 blob/HEAD。纯客户端变更，刷新页面即生效。

### 0.9.47 变更：README 预览内嵌 HTML 子集渲染（GitHub 风 README 不再满屏标签）

- **问题**：市场/收藏/已装详情 Modal 的 README 折叠页，遇到 GitHub 风重度内嵌 HTML 的 README（`<p align="center">` 徽章墙、`<img>` Logo、`<details>` 折叠等——npm packument 兜底与本地读取都常见）会把标签按字面整屏显示，观感如「乱码」。根因是渲染端自研 markdown 渲染器此前完全不解析 HTML 标签（原始内容本身没有问题，GitHub 上渲染正常）。
- **渲染子集（`src/client/markdown.js`）**：块级包裹标签（`p/div/center/blockquote/details/ul/ol/li/table/thead/tbody/tr/td/th/h1-6/figure/section/dl` 等）剥壳后按完整 markdown 递归渲染，内部标题/列表/表格/围栏结构全保留；行内标签（`a/img/strong/em/del/code/kbd/mark/sub/sup/u/small/span/br/hr` 等）token 化构造元素；`align` 属性映射 `textAlign`，`<img width/height>` 映射显式尺寸并放开徽章 20px 高度帽（无 width 的徽章仍走小图帽）；`<details>/<summary>` 原生折叠；文本含标签的普通段落/标题/表格单元格也走行内 token 流（`Press <kbd>Ctrl</kbd>` 类可渲染）。
- **安全模型（不变式）**：绝不向 DOM 注入原始 HTML 字符串——只解析出白名单标签与白名单属性，全部经 `h()` 构造 React 元素，URL 一律过 `safeUrl` 闸门（`javascript:` 等归 `#`）；未知标签剥壳留文本，`script/style/svg/iframe` 等容器连同内容整体丢弃；递归深度护栏（>8 层降级纯文本）。无 `dangerouslySetInnerHTML`，不存在 XSS 注入面。
- **已知边界**：npm packument 兜底的 README 不携带仓库基址，相对路径图片（如 `docs/assets/logo.svg`）按 safeUrl 归 `#` 后由 onError 隐藏（徽章等外链图片不受影响）；`<picture><source>` 的 source 分支丢弃、保 `img` 回退。
- **测试**：`client-markdown.test.mjs` 净增 10 例（块级剥壳递归、徽章行连排、行内混排、script 丢弃与 javascript: 归化、未知标签剥壳、details/summary、整篇 div 包裹、HTML 表格、HTML 标题与行内元素、未闭合标签降级与深度护栏）；真实 dsh-TUI README（25926 字符）渲染验证零标签泄漏、64 个徽章链接正常构造；全量测试 1175/1175，typecheck 零错误。纯客户端变更，刷新页面即生效。

### 0.9.46 变更：双语 README 精简重构＋实拍 WebP 截图集（文档版）

- **README×2 重构**：中文 17.5KB → 8.3KB、英文 18.1KB → 9.4KB——以用户任务动线重组（30 秒上手 → 浏览/搜索/安装 → 已装与设置 → Agent 工具与 CLI → 兼容与 FAQ）；获取线路、缓存语义等实现细节不再展开，统一移交 [`docs/DESIGN.md`](docs/DESIGN.md) 与 ADR 承接；运行相位/生效时机表述与激活分桶语义对齐（不硬承诺「一定重启/一定刷新」，以操作返回为准）。
- **截图集（`docs/images/`，8 张 WebP ≈248KB）**：市场首页、社区分类条、精选分类条、跨区搜索（精选置顶＋社区分组）、插件详情（未装态安装入口）、已装管理、设置页全部换为当前实机实拍；官方安装对话框图沿用。已装图对宿主本机 profile 绝对路径做脱敏改写。
- **新增 `scripts/capture-readme.mjs`（开发用，不入 npm 包——`assert-pack` 的 scripts/ 禁带清单继续兜底）**：playwright 只读驱动当前 Web 实例复现整套截图（`npm run capture:readme`）；不执行安装/升级/开关/删除，仅浏览态与弹窗；每张截图前断言面板内无未脱敏的 profile 绝对路径。新增 devDependency `playwright-core@1.62.1`（锁官方 registry 解析）。
- **验证**：typecheck 零错误；全量测试 1165/1165（首轮 1 项进程树终止时序断言在并发负载下偶发，单跑与全量重跑均通过，未改运行时代码）；`npm pack --dry-run` + `assert-pack` 白名单通过；双语 README 各 8 处 WebP 引用与文件一一对应、无缺失无冗余。

### 0.9.45 变更：市场页两段加载 + 强制刷新穿透探测 + 精选页动线批

- **市场页两段加载（[ADR-0013](docs/adr/0013-market-two-phase-probe.md)）**：浏览态 market 查询拆两段——第一段 `probeMode:'cache-only'` 只回 TTL 内缓存命中、零网络瞬时回页，有缺口（`latestComplete=false`，豁免社区 github 条目——Q46 永久缺口不构成第二段理由）才自动发起第二段既有探测语义就地补徽标；重启后首开不再被全页重探阻塞（弱网 8–16s → 恒秒开 + 徽标异步补全）。`mergeLatestFields` 纯函数保证会话内切换筛选态时徽标不回退；快照只在终态写入。服务端 latest 缓存保持纯内存不动（ADR-0006 不翻案）；tools/CLI 的 `withLatest:false` 通路零变化。
- **force 探测穿透（重开 ADR-0006 暂缓裁决）**：设置页「强制刷新」新链路 onForceMarket → marketReloadAll(true) → core「peek 旧值兜底 + 全页重探」——严格落实 ADR-0006 在案约束「peek 不删除语义而非 ttlMin=0 先删后探」，重探失败保留旧值 + latestError，不产生空徽标窗口；强刷后精选清单与「有更新」徽标同时刷新。市场页 probeMode 只有 full/cache-only 两态（不设 'only'）。
- **详情 Modal 升级动线（U10）**：已装且可升级条目的 Modal 动作区新增「升级」主按钮（市场区与收藏区两挂载点；record.target=安装包名，走 ops 泵与 0.9.22 生效判定分流文案，guard/opSuperseded/普通失败三分支对齐已装页）；新增 README 折叠页（展开才拉取，收起态零请求）；「收录日期」走 fmtDate 本地化。**修复（实机验收发现）**：README 折叠页原直接复用已装页本地读取接口，未安装条目（市场浏览的主体）恒报「web profile 未安装该插件」——现本地未装时回源 npm packument 顶层 readme 字段兜底（HTTPS/8MB 上限/超时；无 readme 字段显示「没有 README」；兜底失败如实抛原始错误），已装条目仍走本地读取。
- **错误恢复与空态（U9）**：错误行内联「重试」按钮（此前只能关开面板或绕道设置页）；空态三分支——registry unavailable 主文案 / 分类空桶专用文案 / 通用文案。
- **收藏身份（U12）**：收藏快照增补 verified/audience/decoupled 三字段（只存不标——§2.7 裁决⑤「收藏页不打标」不动）；收藏区为精选条目补「精选」身份徽标与「已实测」质量徽标（此前精选条目进收藏区连「精选」标识都丢失）。
- **可达性与杂项（U8/U3/U7）**：详情 Modal 补 role=dialog/aria-modal/aria-label 与打开时聚焦关闭钮，截图缩放支持键盘 Enter/Space（Tab 圈闭明确不做）；精选区 0 计数桶显式渲染「0」+ 降透明；跨桶条目使分类计数之和大于总数时 chips 行容器给出 title 说明。
- **测试**：market/host-api/client-market-state/client-render-smoke 净增用例与断言（probeMode 两态与 force peek 语义、缺口豁免、cache-only outdated、mergeLatestFields、两段与强刷接线、Modal 升级/README/可达性、收藏徽标、0 计数桶）；全量测试 Windows 本机除既有 symlink 族基线 15 项外零新增失败；typecheck 零错误。

### 0.9.44 变更：插件卡片网格按容器宽度自适应列数（全屏显出更多卡片）

- **自适应网格**：市场/已装/收藏三视图共用的卡片网格从固定两列改为按容器实际可用宽度自适应——`grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))`。列数 ≈ `max(1, floor((W+8)/368))`（最小卡宽 360px、列距 8px，剩余宽度各列均分）：浮动态（~920px 面板）保持 2 列零回归；全屏 1920 宽约 5 列、1280 宽 3 列，显著显出更多插件卡片。
- **删视口断点**：移除 `@media (max-width:680px)` 的单列覆盖——视口宽度不代表面板实际可用宽度；极窄容器由 `min(100%,360px)` 兜底自动单列，不横向溢出。
- **范围与边界**：搜索分组段头（`.dsvm-grouphead`）仍以 `grid-column:1/-1` 跨满整行；纯客户端变更，刷新页面即生效。
- **测试**：新增 SSR 冒烟回归 1 例（锁定自适应网格规则与断点删除）；typecheck 零错误。

### 0.9.33 变更：自研条目元数据 v1.1——`audience`/`decoupled` 两字段与三端标注

- **schema**：registry 条目增补可选 `decoupled?: true`（解耦条目，实操口径判定；与 `verified` 互斥——同条目共存报 error）与 `audience?: 'public' | 'internal'`（缺省 public 不产生键；`'team'` 值集预留未开放）。决策共识与五项裁决记录见 DESIGN §2.7，术语见 GLOSSARY「解耦条目 / 自用条目」。
- **三端标注**：GUI 卡片与 Modal 头新增「作者自用」「版本无关」徽章＋Modal 受众/适配详情行；`dshm_search` 输出投影携带 `audience`/`decoupled`、条目行加 `[作者自用]` 标，工具描述写明推荐纪律（internal 勿向普通用户主动推荐，点名或内部推广场景除外）；CLI `dshm search` 行内同标（新增 `tests/cli-search.test.mjs`）。已装视图与收藏页不打标——推荐发现链路才是纪律靶面。
- **CI**：validate-registry 新增软警告——decoupled 条目 description 含「已适配」句式即 warn（copy-guide §4 第四句式「版本无关，详见仓库」，空间不足用紧凑形「版本无关。」）。
- **registry 数据**：八个自研条目终态——surf / obmc-web / onetree-log 打 `decoupled`＋`audience: internal`，quota-watch 打 `decoupled`；四条 `verified` 数组删除（历史归 git 与各仓库文档），兼容句换第四句式；四条 coupled 条目（dsh-m / dsh-skins / skip-browser-auth / copilot-auth）verified 原样保留。
- **测试**：净增 9 例（registry 字段校验 5、tools-search 标注 2、cli-search 2）；全量 1133 tests，本机 1108 pass / 15 fail——15 项全部为 Windows 平台既有 symlink 语义用例（与基线集合逐项一致，零回归）；typecheck 零错误。

### 0.9.32 变更：npm registry 路由自适应——元数据预取换源/镜像自愈（ADR-0012）

- **动机**：2026-10-04 上海 Windows 桌面机实证——元数据预取写死直连 registry.npmjs.org，间歇性超时使升级在委派 pnpm 之前夭折（`fetch failed` / `The operation was aborted due to timeout`，且 `.plugin-manager/logs` 无对应操作日志），而 npmmirror 镜像早已同步目标版本；同期首尔腾讯云机 npmjs 直连良好。两台机器需要零配置各自可用。
- **读分类路由（L1/L3）**：检测读（`npmLatest` 升级探测 / `npmPackumentTimes` 发布时刻）恒以 npmjs 权威源优先、首腿超时收紧 ≤5s、失败降级生效源；履约读（`npmVersion` 精确版本元数据 / `npmPackument` 预热）走生效源优先。`npmPackument` 的 registry 参数此前被静默忽略，本版修复（显式参数开始生效，测试钉住）。
- **L0 传输层**：httpx 换 undici 自带 fetch + 自建 dispatcher（`EnvHttpProxyAgent` 显式交接代理解析）——元数据预取开始感知 `HTTP(S)_PROXY` / `npm_config_*` 代理，并规避宿主 undici 全局 dispatcher 污染（dsh-market net.ts #742 同族）；`fetchLimited` 新增 PUT 方法（仅供 sync 原语）；网络失败错误附 `via` 上下文，失败摘要仅在代理路径渲染「（经 <掩码代理>）」。
- **L2 镜像滞后自愈**：`NO_MATCHING_VERSION` 且 registry 字段指名 npmmirror（分类层结构化识别、完整文本上判定、上层零 regex）→ 按需同步镜像（`registry-direct.npmmirror.com/<pkg>/sync`，PUT）→ 既有退避重试（heal 记 `B3_NPMMIRROR_SYNC`）；`npmVersion` 履约阶梯同步适用（404 → sync → 等待 10s → 同源重试 → npmjs 兜底）；sync 受理后作废 latest 缓存。`DSHM_MIRROR_SYNC=0` 一键关闭。
- **新模块 `src/core/npm-route.ts`**：`DSHM_NPM_REGISTRY` 源覆盖（最高优先，设了跳过探测）> [.npmrc registry, npmjs, npmmirror]；probe-once（2.5s 共享预算、single-flight、胜者须完整响应带 version）；决策持久化 `<cacheDir>/npm-route.json`（删文件即重探）；全候选失败仅内存回退 npmjs（60s TTL 后重探、不落盘）。生效源切换自动作废 latest / packument 两级缓存。
- **wire 测试缝隙迁移**：既有 mock `globalThis.fetch` 的测试缝隙迁至 `_setWireFetchForTests`（versions / npm-integrity / registry-check 三文件，断言与计数语义不变）。
- **测试**：净增 41 例（L0 代理解析/wire 转发/via/PUT、npm-route 12 例、读分类路由、registry 分类字段、B3 sync、L4 摘要、kill-switch 阶梯/集成、尾斜杠归一）；全量 1128 tests，本机 1103 pass / 15 fail——15 项全部为 Windows 平台既有 symlink 语义用例（与改动前基线集合逐项一致，零回归）；typecheck 零错误。真机验收（上海机 scoped 自研包窗口内升级 + 首尔机 `dshm outdated`）随发版执行。

### 0.9.31 变更：doctor 支持 desktop profile（CLI 例外开口 + farmChecked 语义修订，ADR-0011）

- **动机**：Windows desktop 机实机报告证实 core 引擎本就 profileDir 参数化无 web 硬编码（desktop 物化布局判 hoisted、farm=0 属常态），但 CLI 全命令一刀切拒绝 `--profile desktop` 把只读体检连坐；desktop-only 机器无 flag 体检还会扫不存在的 web 目录得全 0 报告。
- **CLI 例外（仅 doctor）**：`dshm doctor --profile desktop` 允许并路由 `desktopProfileDir()`，输出首行加 `[web|desktop]` 标注；HELP 同步；**其余命令对 `--profile desktop` 的拒绝语义逐字不变**（回归钉子测试钉住），desktop 变更管理仍走官方 Desktop 插件页。
- **空目录提示**：目标 profile 目录不存在时提示「desktop-only 机器请加 --profile desktop」——判据为目录不存在（存在但为空的合法 profile 不误伤）。
- **宿主 method 零改动**：doctor case 本就 active-profile 无关，desktop 宿主免改生效（新增 desktop-kind 注入钉子测试）；MCP 工具 `dshm_doctor` 维持 ADR-0010 决定 3 缓上；Windows Electron 宿主 runtimeVersion 可能仍降级（物化布局 farm=0，stale 无判定对象，实际影响为零，如实记录）。
- **farmChecked 语义修订**：「0=遍历空转」判定仅适用于存在符号链农场的形态；物化布局 0 为常态（ADR-0011）。
- **验证**：新增 8 例（desktop 路由/标注、他命令拒绝、非法值、空提示、正常不提示、显式 desktop 不出矛盾文案、显式 web 路由、method 钉子）+ 改写 1 例旧拒绝样本（净增 8，全量 1079→1087）；全量 1087 pass / 0 fail / 0 skipped；typecheck 零错误。Windows 外机验收清单见实施计划（本机无法执行 Windows E2E）。

### 0.9.30 变更：修复 bin 符号链接静默 no-op（F2）+ 版本解析 realpath 第三源（F1）

- **根因同源**：pnpm 生态里两类关键入口都是**符号链接**——`node_modules/.bin/dshm`（指向 lib/cli.js）与全局 shim `PNPM_HOME/dsh`（指向真实 bin.js）——而两处代码都在 realpath 之前做了路径身份判定。
- **F2（自 v0.2.0 bin 入口引入以来潜在，本机 0.9.28 装机形态首次踩中并实证；🔴 bin 入口全命令静默 exit 0）**：cli.ts `invokedDirectly` 比较 `argv[1]`（链接路径）与 `import.meta.url`（node realpath 后的真实路径）永假，`dshm <任何命令>` 无输出直接退出。修复：比较前对 `argv[1]` 同样 realpath。新增 `tests/cli-bin-symlink.test.mjs`（经符号链接调用 --help 与 doctor --json 的复活验证，EPERM 环境照仓内先例 skip）。
- **F1（0.9.29 装机验收实证）**：dsh-version.ts `readLauncherPackageVersion` 从 shim 位置直接向上三级找 package.json，落在 pnpm home 目录树上空走——宿主内纯 FS 版本解析在本机拓扑（`node PNPM_HOME/dsh web`）不可得，doctor 的 stale 判定降级、ping chip 被迫吃 spawn 回退。修复：判定 entry 形态后先 realpath 再上溯（本机实测解析得 0.2.0-rc.2）。新增 dsh-version.test.mjs shim 形态用例。
- **验证**：专项 9/9（含两新用例）；全量 1079 pass / 0 fail / 0 skipped；typecheck 零错误。装机后预期：`dshm doctor`（bin 入口）可用；宿主 method 通路 runtimeVersion=0.2.0-rc.2、stale 判定复活（装机时农场 dsh 链接 0.1.7-rc.2 为现成 stale 形态，heal 后归零）。**装机实测（2026-10-04）**：预期逐项兑现——`.bin/dshm doctor` 经符号链接复活出报告；宿主 method `runtimeVersion=0.2.0-rc.2 / stale=1（dsh→0.1.7-rc.2 现场点名）`；同日按 know-how 014 heal 该链接并清理 20 项残留后，双通路终验 `farm 236 / dangling 0 / stale 0 / residue 0 / errors 0`。

### 0.9.29 变更：profile 体检 Doctor——`dshm doctor` 上线（只读：农场测活 / 残留物清点 / 账实一致）

- **动机**：dsh-m 至今没有诊断能力——know-how 014 的「每次 DSH 升级后重跑农场测活」是唯一现役周期必查项（曾 81 条悬空、230 行手工映射留档），know-how 023 实录「账实分裂」形态；本机实扫另发现 8 个空 scope 目录 + 12 个 `*.bak-*` 累积。学 dsh-market check.ts 的设计纪律（纯 FS 边界、三级严重度、unknown≠broken、误报记账、修复责任外移）落地 Day1 子集，选点裁决与对比详见 ADR-0010 与对比报告（2026-10-04）。
- **新增**：`src/core/doctor.ts` 纯函数核心（无进程/无网络/无写入，任意时刻可安全调用）+ `/dshm` 新 method `doctor` + CLI `dshm doctor [--json]`（error 级发现 exit 1；HELP 同步）。三项检查：**农场测活**（`@deepseek-ai/*` 符号链祖先链遍历；悬空=error；dsh 伞包指向旧运行时 store=提示级——lockstep 店内非伞包版本不与 runtimeVersion 比较，防 cordis 等误报）、**残留物清点**（空 scope / 无 manifest 目录 / pnpm `*_tmp_*` / `*.bak-*`，全部零告警清单，「可见而非清理」）、**账实一致**（pin/实装/lock 三处核对，不一致=warning；lockfile 仅认 9.0 importers 形状，其余 unknown 不猜）。
- **边界纪律（ADR-0010）**：runtimeVersion 仅用 `readLauncherPackageVersion` 纯 FS 通路（CLI 进程下为 null → stale 判定整体降级 unknown，绝不 spawn）；密钥红线只禁含密钥**配置文件**内容（包元数据 version 字段可读）；布局判定 workspace 声明优先（本机「hoisted 声明 + 仅 lock.yaml 的残留 .pnpm」并存形态实证）；双市场并存（dsh-m+dshmarket 同装）信息级呈现；doctor 永不修复，建议以文字给出。
- **验收结算（2026-10-04 装机实测）**：farmChecked=236（精确命中评审实测值）/ 悬空 0 / 8 空 scope + 12 bak 入清单 / 账实 13:0 / 双市场信息级 / errors=0 → exit=0 / `--json` 可解析。宿主 method 信封正确但 runtimeVersion=null——**发版日新发现**：本机宿主经 pnpm 全局 shim 启动（`node ~/.local/share/pnpm/dsh web`），`readLauncherPackageVersion` 从 shim 三级上溯落空，stale 判定双通路降级（底层事实人工核对成立：农场 dsh 链接 0.1.7-rc.2 vs 运行时 0.2.0-rc.2；版本第三源列下一批）。另录既有 bug：`.bin/dshm` 符号链接静默 no-op（后经考古为 v0.2.0 起潜在、本机 0.9.28 装机形态首次踩中，见 0.9.30 条目——`invokedDirectly` 比较 symlink 路径与 realpath 永假，bin 入口全命令静默 exit 0；修复列 0.9.30 候选，期间用 `node …/dsh-m/lib/cli.js` 直达）。
- **验证**：新增 `tests/doctor.test.mjs`（36 例：布局冲突并存/祖先链反空转/两级 targetVersion/降级路径/零告警清单/023 形态/link 协议/lock peer 后缀/CLI 子进程）+ `tests/doctor-api.test.mjs`（2 例：method 信封真跑 + 空 profile）；全量 1076 pass / 0 fail / 0 skipped。

### 0.9.28 变更：页大小档位去上游化——32/64/96 取代 24/48/96，默认 32

- **动机**：24/48/96 是复刻 dsh-market 筛选面板（0.7.2）时带过来的上游血统数字。甄别后发现 96 早已被 dsh-m 内化为核心参数（`WITH_LATEST_MAX` 探测上限、精选区默认页、fast-open 快照判定基准），真正的上游痕迹只有 24——「砍 24、保 96」即去上游化与兼容性的交集。
- **新档位**：`MARKET_PAGE_SIZES = [32, 64, 96]`（等差 +32，读序顺）、社区区默认 `DEFAULT_PAGE_SIZE = 32`（首页更满，仍低于 0.6.x 历史默认 50 的探测负载，Q46 预算姿态不变）；精选区默认 96 与 core clamp 1..96 不动。
- **联动**：host-api GUI 通道兜底默认 24 → 32（三端一致，不留暗默认）；探测预算注释同步（market.ts / host-api.ts）；README×2 与 DESIGN.md 措辞同步；GLOSSARY「精选区」词条按代码实态锐化（单页无分页 → 常态单页直出 + 超限降级分页）；测试断言与快照 fixture 同步（偏离档位断言改用组内值 64，覆盖「档位内但非默认仍拒写/判假」）。
- **已知一次性影响**：升级后社区区旧快照（limit=24）不再命中 fast-open 判定，首次打开市场多一次正常请求，快照按新默认重建后自愈；不加 legacy 兼容分支。
- **验证**：`npm run build` 成功；全量 1030 pass / 0 fail（8 skipped）。

### 0.9.27 变更：修复遮罩拖选误关——面板内按下、拖出释放不再关面板

- **问题（装机实测 2026-10-03）**：在市场搜索框内左键按下向左拖选（越过面板边界）释放，整个面板被关闭。非浏览器鼠标手势——面板遮罩是裸 `onClick: onClose`，而在面板内容里按下、拖到遮罩上释放时，浏览器把 `click` 派发到按下/释放目标的公共祖先（恰是遮罩），被误判为「点遮罩关面板」。详情 Modal、截图灯箱、兼容确认弹层同属该缺陷类。
- **修复**：新增纯函数 `backdropCloseHandlers`（src/client/backdrop.js）——仅当 **mousedown 与 click 都落在遮罩自身**时才关闭（其余组合一律不关，click 后按位状态复位）；四处遮罩（主面板/详情/灯箱/兼容弹层）统一切换。点遮罩关闭、Esc 关闭、✕ 按钮行为不变。
- **验证**：新增 `tests/client-backdrop.test.mjs`（关闭/两类拖选不关/状态复位/畸形输入安全，5 组断言）；全量 1030 pass / 0 fail。

### 0.9.26 变更：跨区搜索精选稳定前置——摘要行计数与首页所见一致

- **问题（装机实测 2026-10-03）**：搜索「sidebar」摘要行报「⭐ 精选 3 · 社区 315」，首页精选段只见 1 条。非重复计算——`sourceCounts` 不读分类计数（`alsoCategories` 无涉），3 条为真实精选命中；错位根因是摘要行报全局命中数，而相关性排序叠加社区区默认 downloads 降序 tie-break 把弱命中精选压进后页。
- **修复**：`listMarket` 新增 `curatedFirst`——`source='all'` 且 query 非空时精选命中**稳定前置**（稳定分区，分区内相关序不变，社区命中随后）；仅 host-api GUI 通道携带，tools/CLI 不传，搜索排序三端同序不变；单分区/浏览态天然无效。跨页精选段头悬空与计数错位随之消失（精选命中 ≤ 页大小时全数落在首页段内）。
- **验证**：新增测试 ⑮（无 flag 保持交织相关序 / 带 flag 精选前置 / 空 query 与单分区无效）；全量 1025 pass / 0 fail。

### 0.9.25 变更：跨区搜索——浏览分区、搜索全局（社区 + 精选一并命中）

- **跨区搜索**：任一分区（社区/精选）的搜索框升级为全局——`query` 非空时底层查询切 `source=all`，两分区条目统一相关性排序；清空关键词回到本区浏览态。分区制浏览（ADR-0004）与 `dshm_search`/CLI 三端同序不动；服务端唯一增量是 `MarketResult.sourceCounts` 分桶计数。
- **搜索态呈现**：摘要行「⭐ 精选 N · 社区 M」精确计数（`!loading` 门控防旧数字闪现）；精选命中页内置顶分组（段头各自仅在对应段非空时渲染，跨两列 grid）；非社区卡补「精选」徽章；分类 chips 搜索态隐藏、「筛选」按钮随摘要行保留（搜索态只剩页大小组，排序被相关性优先覆盖）；翻页回顶锚点随态切换。
- **修复**：分区 tab 计数改从恒定字段推导（社区 = `acceptedCount - displaced`、精选 = `registryState.count`），不再随查询变化（此前读「最近一次查询的 total」，跨区搜索会污染计数）；搜索提交时清空激活分类（chips 已隐藏，残留分类会成为不可见过滤）。
- **降级**：`sourceCounts` 缺失/畸形时摘要行整体不渲染，列表行为不变；旧快照/旧宿主响应形状漂移免疫。

### 0.9.24 变更：排除条目代管——供应链等待期从「提前拒绝」到「治理 + 登记」（ADR-0009）

- **问题（实机 2026-10-03 实证）**：0.9.19 的委派前预检把「目标版本未满 24h 等待期」预测成"官方管理器必拦"并提前拒绝——同目标 dsh-market 却能装上（copilot-auth@1.2.4 发布 8 分钟、quota-watch@0.1.21 两例）。pnpm 11.7 默认非严格策略对显式点名的新版本本来就放行并自动登记排除条目，预检的墙并不存在。
- **三挂点代管**：① 委派前治理——desktop profile 排除块的坏形态（pnpm 自追加的死规则）合并为"每包一条、版本并集复合"；② 装机成功后登记——等待期内目标并入排除块（scoped 精确单条 / 非 scoped 目标+上一版双选择器）；③ 双码失败（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` / `ERR_PNPM_NO_MATURE_MATCHING_VERSION`）→ 治理 → 至多重试一次，仍败走既有失败翻译与账实分裂复读。web ladder 同套三挂点。
- **边界与安全**：红线收窄出唯一例外（desktop 仅此块、仅委派前后挂点、原子写、解析失败即弃、留痕不落全文）；治理/登记全程持官方同款锁并 fail-open——任何失败不阻塞委派，pnpm 仍是最终执行者；显式设置 age 或 strict 的 profile 仍前置拒绝并给可重试时刻；机理按"首条规则生效"口径改判（know-how 020 §2.4 形态论退役）。
- **文档**：决策全文 `docs/adr/0009-release-age-exclude-governance.md`（含 9 项评估过不做的栅栏附录与观察预案）；GLOSSARY 新词「首条规则/排除条目/治理/登记/等待期」。

### 0.9.23 变更：已装页两段加载——列表秒开 + 更新提示就地补 ⬆（ADR-0008）

- **问题（实机 2026-10-03 实证）**：更新探测焊在已装列表接口里且带 60min 内存 TTL——发版后重开面板吃到陈旧缓存，升级提示迟迟不出现（quota-watch 新版发布 17 分钟后面板仍无提示，dshmarket 同刻已见）。
- **两段并行（零新增按钮）**：第一段 `installed {probe:false}` 立即返回已装列表（registry 匹配与开关相位不受影响）；第二段新方法 `installedUpdates`（`probeMode: 'only'`，**TTL=0 每次挂载真实探测**）完成后把 ⬆ 徽标 / tab 红点 / 「全部升级 (N)」就地补上；探测失败仍逐项走「检查未完成」，不冒充「没得更新」。
- **边界与副作用（ADR-0008 如实留痕）**：范围仅已装页——市场浏览页探测、`dshm_list`/`dshm_outdated` 工具、CLI 行为不变（缺省 `probeMode: 'full'`）；ttl=0 会先删 host namespace 共享缓存条目再重探，浏览页/工具的 TTL 内命中被刷新为更新值（数据只更新鲜、代码路径与自身 TTL 制度不变），GitHub 被动预算消耗速率上升（上限 25/req、50/h 滚动不变），超限走 latestError 优雅降级。
- **文档**：决策全文 `docs/adr/0008-installed-two-phase-probe.md`；DESIGN「已装页/缓存语义」补句；GLOSSARY 新词「两段加载」。

### 0.9.22 变更：升级生效判定——tarball 差异三态分类 + 三端重启提示分流（ADR-0007）

- **问题（0.9.21 实证）**：`@iasiv5/dsh-skins` 1.2.3→1.3.0 升级后未重启即已生效（客户端 bundle rev 热更），三端仍无条件提示「需要重启」——警报疲劳会侵蚀提示的权威性，重启本身也有真实成本（web 服务瞬断 / desktop 手动重开）。
- **生效判定（GLOSSARY「生效判定/纯客户端更新」）**：npm 源升级成功点拉取新旧两版 tarball（并行、总 deadline 10s、单包 8MiB、无缓存），零依赖 ustar 只读解析（支持 pax 长名）+ 逐文件 sha256 diff，分类 `activation: 'client-only' | 'restart-required' | 'unknown'`。规则五条：client 集合 = `exports['./client']` 目标；`dsh.bundle.patch` 声明的补丁目标变更 → 宿主；`package.json` 忽略顶层 version 后语义比较（dependencies 等字段变化照常算宿主）；其余差异按路径归属；client 指向变化保守判宿主。**fail-open**：一切异常 → unknown → 现状提示，绝不影响升级成功态。
- **三端分流**：agent 工具消息 client-only 明示「刷新页面即可生效，不要询问 dshm_restart」、unknown 保守建议重启；GUI toast 后缀 + `needsRestart` 门（client-only 不亮重启横幅；纯函数 `upgradeNotify` 可单测）；CLI 行文案换挡。`needsRestart` 源头放宽 boolean（TS2430 规避），`UpgradeResult`/desktop 升级结果新增 `activation` 字段；接线点 `upgradePluginLocked` + `desktopUpgradeLocked`，selfUpgrade/install/uninstall/github 源维持现状。
- **测试与文档**：新增 ustar 解析 11 例、分类规则+fail-open 18 例、升级接线 7 例（npm/github/selfUpgrade/desktop）、renderUpgrade 4 例、upgradeNotify 3 例；既有升级替身统一补 `classifyActivation` 缝（防隐式出网）。决策与已知局限全文见 `docs/adr/0007-activation-classification.md`（client chunk require 图不追踪；docs 类随版差异保守判宿主侧）。

### 0.9.21 变更：设置页「强制刷新」显示连带修复 + registry.json 变更自动清 jsDelivr 缓存

- **设置页强刷显示修复（实机 2026-10-03 实证）**：设置页「强制刷新」只重载 `registry` 接口（force 同步强刷全链路），但面板展示的 registryState **优先读 `registry-config` 的挂载时快照**——于是出现「toast 报已强制刷新、生效来源/更新时间/条目数纹丝不动」的假死，重开设置页才对齐。现在强刷成功后连带重载 `registry-config`（force 已更新 controller 内存快照，零成本取新值），显示即时跟随生效数据。
- **jsDelivr 自动清缓存（`registry.yml` 新增 `purge-jsdelivr` job）**：默认链「线路粘性 + CDN 恒 200 即成功」会让 jsDelivr 的滞后快照**无限钉死**精选清单——实证：0.9.18 收录 DSH Market（18→19）后，粘性在 jsDelivr 的本机持续拉回 18 条旧版，raw 主线路永远轮不到，用户侧强制刷新也无解（唯有手动 `purge.jsdelivr.net`）。现在 push 到 main 且 `registry.json` 实际变更时（`github.event.before` diff 判定），`validate` 全绿后自动调 purge 接口清缓存并回读 cdn 验证条目数，结果写入 step summary；registry.json 未变的 push 与 PR 全部跳过。

### 0.9.20 变更：latest 探测缓存退回纯内存（重启即失效）+ mutation 定向失效（ADR-0006）

- **事故复盘落地（2026-10-03 凌晨）**：0.9.14 起 latest 探测缓存 write-through 落盘、跨重启存活，失效通道只有 TTL 一条——00:22:58 缓存写入后，00:27–01:05 连发四版、01:07 重启 DSH、01:13 重开面板全部吃到陈旧值，卡片与 `dshm_outdated` 双双误报「已是最新」。本次推翻该设计，决策与取舍全文见 `docs/adr/0006-latest-cache-memory-only.md`。
- **缓存退回纯内存**：latest 探测结果只存内存 Map + TTL（`cacheTtlMin`，默认 60 分钟），**重启即失效**——「发完版重启一下就能看到」重新成立。代价是重启后首轮受限重探（当前页条目、8 并发 + deadline 兜底，TTL 内只付一次）；registry/社区**目录正文**的落盘缓存与 SWR 不受影响，页面骨架照旧秒开。0.9.14 遗留的 `<cacheRoot>/latest/<ns>.json` 惰性文件由探测段一次性 best-effort 清扫。
- **mutation 定向失效**：install/upgrade/uninstall 事务**成功点**按 itemId 作废该条目全部 registryKey 缓存变体（浏览页键 / 已装页 matched 键 / npm-only 键）——升级后卡片不再出现「已装新版 / 最新旧版」自相矛盾；`dshm_outdated` 对刚升级包诚实。只失效不回写（故意装旧版时回写会伪造 latest=已装）；事务回滚路径零失效；卸载对 github 源条目的 `gh:` 键尽力而为（pkg 名不可逆推 repo，交由 TTL 自然过期）。
- **不做项留痕**：force 穿透探测缓存与浏览页 GitHub 预算对齐经主人拍板暂缓——前者残余盲区仅「不重启 + TTL 内」窗口，后者对现行全 npm 源精选清单收益为零（ADR-0006 §Considered Options）。

### 0.9.19 变更：供应链等待期「锁文件校验」实证修复——委派前预检 + 全量违规解析 + 账实分裂明示

- **根因（本机 2026-10-03 00:15 实证）**：pnpm 11.7 对 desktop profile 做**锁文件级**供应链校验（`Verifying lockfile against supply-chain policies (180 entries)`），而它给每次成功安装自动追加的 `minimumReleaseAgeExclude` **非 scoped 独立精确条目不被这次校验认可**（`dsh-m@0.9.18` 即被拒；scoped 的 `'@iasiv5/dsh-quota-watch@0.1.13'` 则认可）——装过一个「太新」版本后，**等待期内任何官方包操作都会被这个旁包条目拦死**，与本次目标无关；且校验失败前目标包已被写入 node_modules、官方管理器只回滚 manifest/lockfile → 界面显示新版 active、操作记录却是失败（**「账实分裂」**），下次包操作还会把插件静默回退。
- **委派前预检（`releaseAgePrecheck`，只读、零文件级红线不破、fail-open）**：npm 源安装/升级在委派官方管理器前，对目标版本与锁内「不被校验认可的独立精确排除条目」逐个核对 registry 发布时刻，任一未满等待期 → 结构化 `release-age-wait` 拒绝（含各自可重试时刻），不再产生半写状态；发布时刻不可得 / 策略不可读 / 命中有效排除条目（包名级、`||` 复合、scoped 独立精确）→ 放行，pnpm 仍是最终执行者。
- **失败翻译换新（替代 0.9.10 单条解析）**：解析全部违规条目，按「本次目标 vs 锁内旁包」分述发布时刻与可重试时刻——旁包连坐不再被冒充成目标被拦；移除「改用 DSH Web 安装」的失配指引。`DesktopOpsError` 新增结构化 `details`（violations/targetViolating/splitState/blockers）。
- **账实分裂复读**：等待期失败后复读实装状态，node_modules 已是目标版本而 manifest 仍旧版时，在错误信息中明示「下次包操作会回退到旧版，等待期满重新升级即可对齐」。
- **接线**：desktop install / self-upgrade 调用点补穿 `profileDir`（升级路径此前已有）。

### 0.9.18 变更：精选收录 DSH Market + README 重构与变更日志外迁

- **新收录 DSH Market**（npm `dshmarket`，精选 18→19）：三方可视化插件市场——浏览、搜索社区插件并一键安装，主题一键热切换；主桶装机必备、次桶崔添翼精选（`alsoCategories` 次级归属）。文案按收录规范三句式，三方条目不设 `verified`。
- **文档面重构**：README/README.en 重写为精简结构（亮点、TOC、环境要求、文档索引、支持矩阵 FAQ），推荐安装路径改为 DSH 官方插件管理界面（附截图与升级限制提示）；本变更日志自 README 外迁（双语维护）；Desktop FAQ 对齐 0.9.8 后能力面；DESIGN §3/§12 补实机核验与实测代际记录。
- **附带**：registry 守卫测试条数 18→19；`package.json` files 新增 CHANGELOG.md 随包发布。

### 0.9.17 变更：策展桶次级归属（一插件跨桶）+「iasi自研」更名

- **次级归属 `alsoCategories`**：收录条目可声明次级策展桶——chips 计数与桶过滤按「主桶 ∪ 次桶」计（跨桶条目在每个桶里都出现），详情页分类标签仍随主桶。首批双席位：**better-sidebar**（装机必备 ⊕ 崔添翼精选）、**dsh-m**（装机必备 ⊕ iasi自研）；better-sidebar 原第 5 个「崔添翼精选」tag 由真实席位取代（tags 回归 ≤4 软规范）。
- **更名**：策展桶「我的自研」→「**iasi自研**」（slug `self-dev` 不变，chips/工具/CLI/详情标签四端同步）。
- **例行过渡**：schema 加字段后旧客户端校验拒收新 registry → 回落缓存/包内快照显示旧数据，升级即愈。

### 0.9.16 变更：精选策展五桶分类法 + 严筛收录（23→19）+ 新收录 DSH TUI

- **策展分类法**：精选区分类从功能五分类（市场/工具/界面/搜索/其他）改为**策展五桶**——装机必备 / 崔添翼精选 / iasi自研 / 腾讯轻量云专区 / 观察区（chips 按此序，腾讯轻量云垫后）。分类语义从「插件是什么」转为「为什么值得进精选」；重叠归属按 装机必备 > 崔添翼精选 > 自研 > 腾讯轻量云 优先级归桶，功能属性转 tags 保留检索，旧分类值仍可作开放 slug 命中自定义源（ADR-0004 修订）。
- **严筛收录 23→19**：通道五件套（lark/qqbot/weixin/wecom/dingtalk）退出精选——社区层（4,000+ 条）仍收录可装，只是退出策展位；新增收录 **DSH TUI**（崔添翼 9/26 X 推荐：终端 TUI 客户端，`dsh-tui`，走 DSH 客户端契约 ctx.remote）；better-sidebar 因优先级归装机必备，以 tag「崔添翼精选」保留 9/27 推荐出处。
- **同版本携带**（本地增强随发版收编）：desktop 安装 enable 阶段失败自动重试一次（高频装卸/插件树重载竞速实证）+ 失败文案按 packageResult 精确化；市场页「缓存快照」横幅退役——stale 状态由设置页社区卡承接，浏览页不再提示临时缓存状态。

### 0.9.15 变更：安装进度/终态就地进详情 Modal

- **场景**：从详情 Modal 点「安装」后，安装信息（pnpm 阶段进度行、「变更完成」横幅/toast）都渲染在面板底层，隔着 Modal 遮罩半透明透出——弹窗内只有按钮转圈，看不出装到哪一步（实机截图反馈 2026-10-02）。卸载无此问题：不弹 Modal，状态本来就挂在已装卡片上。
- **变更**：安装进行中，Modal 内直接挂进度行（复用 host status 轮询：阶段/进度条/当前包）；终态在 Modal 内就地显示结果行——成功附版本与构建脚本说明 + 重启提示（desktop 给官方应用生命周期指引），失败/守卫拦截附原因且按钮回到可重试，「已跳过」中性呈现；Modal 打开时底层同源进度行让位（关闭 Modal 后照常回归）。信息全部派生自全局操作记录与安装结果，「状态不挂卡片」的所有权模型不变（DESIGN §2.6）。

### 0.9.14 变更（市场秒开四件套 + 详情 Modal 安装命令显隐）

- **市场秒开四件套**：针对「每次打开市场必现『加载收录清单中…』」的加速组合拳——
  - **SWR 先回缓存**：精选清单与社区目录的 TTL 过期不再同步等网络——磁盘缓存存在即**立即返回快照**（社区侧照常显示「缓存快照」横幅，绝不冒充最新），后台单飞自愈，下次打开即新；「强制刷新」按钮语义不变（始终同步强刷，社区卡不连坐）。
  - **线路粘性**：默认双线路（GitHub 原始文件 → jsDelivr 镜像）按缓存记录的**上次成功线路**排序——镜像成功过就先走镜像，不再每次白等主线路失败（大陆网络实测每次冷打开省 10-20s 等待）。
  - **探测缓存落盘**：页条目 npm/GitHub 版本探测缓存从纯内存改为磁盘信封（`latest/`，跨重启存活）——DSH 服务重启后首次打开市场不再重放探测。
  - **客户端快照**：默认首页响应存浏览器本地（10 分钟 TTL），打开面板先渲染上次数据再后台换新——加载 spinner 仅首次使用（无任何快照）出现。
- **详情 Modal「安装命令」折叠行按上下文显隐**：
  - **场景**：折叠行命令推导写死 `dsh plugin --profile web add …`，社区条目的上游 install 原文也同为 --profile web 语义——两个来源都不看当前宿主 profile。desktop 上下文里照抄会把包装进 web profile（当前界面看不见）；已安装条目还挂着命令纯属噪音（实机截图实证：desktop + dsh-m 自身条目，`已安装` 徽章与命令同屏）。
  - **变更**：desktop 上下文与已安装条目**整行隐藏**；web 未安装条目行为不变（CLI bootstrap 路径保留，「30 秒上手」同款命令）。desktop 装机正路是弹窗内「安装」按钮（官方 pluginManager 委派，ADR 0005 纪律）。不做「精简命令去掉 --profile」——显式 `--profile web` 是 0.9.0 拍板的设计（README「profile 目标」节），裸命令的默认 profile 语义含糊，精简反而更差。

### 0.9.13 变更：desktop 角标悬停文案更新（主人拍板）

- 旧文案「当前 DSH profile：{name}（Desktop 首发仅支持只读市场、安装新包与开关）」在 0.9.8 开放升级/卸载/自升级后已过时；按主人拍板改为「**当前生效 Profile**」（en: Active profile）。

### 0.9.12 变更：0.9.11 的重发

0.9.11 在 npmjs 遭遇幽灵发布：OIDC 发布被受理并 **staged**（CLI exit 0、provenance 已上 Transparency Log），但从未 commit 进注册表——GET 404、同版本重发 409 `Cannot publish over previously staged version`。等待自愈无果后按标准解法换号重发。**内容与 0.9.11 完全一致：设置页「强制刷新」不再连坐社区清单卡。**

### 0.9.11 修复：设置页「强制刷新」不再连坐社区清单卡（force 语义只属精选链）

- **场景**：弱网下点精选清单的「强制刷新」，社区清单卡跟着变「不可用 + 获取超时」——根因是 host 把 `force` 一路透传给社区目录 summary，强制重开获取 flight；弱网下 flight 3s 完不成，waiter 超时返回占位摘要（flight 本身在后台 30s hard cap 内继续，跑完即自愈）。
- **修复**：`registry` 的 force 不再透传社区 summary——「强制刷新」语义只属精选链（registry 链）；社区目录走自己的 TTL/共享 flight（首次打开等边界场景在极差网络下仍可能瞬时超时，但强刷不再触发）。

### 0.9.10 修复：Desktop 自升级撞上官方供应链等待期（minimumReleaseAge）→ 诚实指引发成可读

- **场景**：点升级角标走官方管理器时，desktop profile 的 pnpm 供应链策略（`minimumReleaseAge`，发布满 24h 才可安装）拒绝了刚发布的版本——`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`。**这是策略在正确工作**（防供应链攻击的发布等待期），不是故障；但 dsh-m 此前把它当普通失败甩一屏 pnpm 原文。
- **修复**：管理器结果判定识别该策略码，翻译成诚实指引——点名等待期内的条目与发布时刻、按策略推算「预计何时可重试」，并给出等待期内的替代路径（DSH Web 安装同版本）。绝不做策略绕过（等待期是防供应链攻击的红线，dsh-market #732 同态度）。
- 附带：community 获取链 ⑨ 的挂起上限断言 2s→10s（全量套件并行定时器饥饿下两次闪断；契约「不永久挂起」不变）。

### 0.9.9 修复：备用线路接住后不再弹红色「主线路失败」提示（提示收敛）

- **场景**：默认精选清单双线路（raw → jsDelivr）里主线路 `default-raw` 失败、备用线路成功接管时，设置页仍弹红色「远端提示：default-raw 失败：fetch failed…可稍后重试或检查网络后重试」——对着已经自愈的数据报警，还带着不成立的建议（大陆网络下 raw 间歇不可达是常态，这正是备用线路存在的原因）。
- **修复**：后续线路成功 = 先行失败已自愈，`errors` 不再携带（设置页「生效来源」行已如实标注当前线路，如「GitHub 镜像（备用）」）；全线路失败落 cache/bundled 时错误照常保留——那才是需要行动的信号。custom 链（自定义源失败回退缓存）行为不变，仍然提示。
- 顺带补了 default 链的测试缝（`defaultRoutes` 覆写），双线路收敛与全挂保留各有回归门。

### 0.9.8 修复：Desktop 包操作全面接通官方管理器（安装恒 no-manager；升级/卸载/自升级开放）

- **安装恒失败的根因**：Host API 的 desktop 安装分支调 `desktopInstall(id, cfg, opts)` 漏传第 4 参 deps——`getService` 根本没进适配器，desktop 安装恒报「官方 pluginManager 服务不可用（fail-closed）」（100% 必现，与时机无关）。工具面 `dshm_install` 同病。
- **服务解析与 dsh-market 同源**（借鉴其 official-desktop 接线，本机两轮覆盖安装实证）：探测改双上下文（webServer 注入回调的 hostCtx 优先）+ cordis inject 惰性拉起兜底（短超时）——官方 pluginManager 是惰性服务，未被拉起前一次性 get 恒 undefined；仍缺席才结构化拒绝（绝不文件级回退的红线不动）。
- **能力表扩充（主人裁决，借鉴 dsh-market 策略）**：desktop 的 upgrade（installBundle 覆盖安装）/ uninstall（removeBundle）/ self-upgrade（installBundle('dsh-m@latest')）全部开放——dshmarket 正是这样完成 dsh-m 0.9.3→0.9.4/0.9.5 两轮升级的；判定纪律沿用（application/stage 为准、overridden 非失败、build-blocked 结构化回传 pendingBuilds、listBundles 复读不冒充成功）。restart 继续拒绝（Electron 生命周期归官方壳）。
- GUI 与工具面（dshm_install / dshm_uninstall / dshm_upgrade）三入口同批接线。

### 0.9.7 修复：Desktop 下点升级角标弹红色「升级失败」（能力表拒绝应为指导而非报错）

- **根因**：0.9.1 的升级角标点击后一律调 `self-upgrade`；Desktop 能力表按设计 409 结构化拒绝，但客户端把 409 当普通失败渲染成红色「升级失败」横幅——按能力表这根本不是失败，是「该走官方入口」的指引。
- **修复**：`api()` 透传能力表拒绝的结构化字段（code/action/profile/guidance），角标点击收到 409 时改出**中性 info 横幅**展示官方入口指引（guidance 单一事实源仍在服务端 `active-profile.ts`，客户端零复制）；info 横幅停留 12s。Web 端真实失败仍走红色 err 横幅，行为不变。

### 0.9.6 修复：「清除已完成」对失败记录无声 no-op

- **根因**：0.7.0 评审共识把「失败/已跳过」排除在清除范围外（保留供回看），于是按钮对着一条失败记录点击毫无反应、也无任何反馈——Windows 实机被当成 bug 上报（2026-10-01）。显式点击清除不是「静默抹掉」，旧共识被推翻。
- **修复**：「清除已结束」（原「清除已完成」）现在清除**全部终态**（done/warned/failed/superseded），在途态（queued/running/input）不受影响；没有可清终态时按钮置灰并带说明 tooltip，不再无声 no-op。单条 ✕ 照旧逐条删除。
- **英文文案**同步改为 "Clear ended"。

### 0.9.5 修复：Desktop 下 GUI 读路径漏接 active profile（已装页恒显 web）

- **根因**：0.9.0 双 profile 接线时，Host API 的 `installed` / `market` 两个读路径漏传 active profile——`listInstalledWithMeta` / `listMarket` 内部落回 `webProfileDir()`：Desktop 下已装页恒显「web profile 尚未安装任何插件」、市场「已安装」徽标恒空（agent 工具面 `dshm_list` 同链路已接线，故只有 GUI 错）。
- **修复**：两处补齐 `profileDir: profile.dir` + `profile: profile.name`（与 tools 面同款，profileContext 单一事实源）；registry/社区缓存随 `profile` 参数自动落到 desktop 段。
- **文案**：已装空态/加载态与 profile 提示里的「web profile」硬编码改为 profile 中性表述（实际路径照旧展示）。

### 0.9.4 修复：Windows Desktop 全屏后头部不可点（tab / 还原键被系统标题栏吞掉）

- **根因**：Desktop（Windows）以 `titleBarStyle:hidden + titleBarOverlay` 运行——窗口顶部 40px 是壳的全宽 `-webkit-app-region:drag` 拖拽带（按布局参与拖拽判定、无视 z-index 与绘制顺序），右上角另有系统绘制的 — □ ✕ 悬浮于一切内容之上。面板全屏后头部（tab、还原/关闭键）正好落进这条带：点击被窗口拖拽吞掉、还原键被系统键遮挡，全屏无法退出。
- **修复**：与壳自家 overlay 同款对策——消费壳在 `html` 上设的 `--dsh-windows-titlebar-height` 让出该带（全屏态 `top:var(…)`；浮动态 `padding-top:max(24px,var(…))` 顺带修掉矮窗口下浮板顶边被带压住的边缘情况）。
- **Web 零漂移**：DSH Web / 浏览器无此变量，回落 0px，行为与 0.9.3 完全一致。

### 0.9.3 修复：Windows 原生适配（Windows 宿主实机回归）

- **registry 原子写**：临时文件名此前用 `split('/')` 从绝对路径取尾段，而 Windows 路径分隔符是 `\`——取到的是整条路径（内嵌 `\` 即目录分隔符），临时文件 open 必败且被吞，cache 与 accepted metadata 写入**静默全失败**；改用 `basename()`，三平台一致。
- **本地文件清单地址解析**：`C:\…` 盘符与 `\\server\share` UNC 此前被误当 URL scheme（报「只允许 HTTPS」的误导性错误），`file://C:/…` 会归一成无盘符悬空路径必 ENOENT；现 POSIX 绝对 / Windows 盘符 / UNC 三形态均正确解析为 file kind。
- **构建**：`node_modules/.bin/tsc` 是 POSIX sh shim，Windows 下 `spawnSync ENOENT`；改用当前 Node 直跑 TypeScript 的 JS 入口，`npm run build` 三平台一致。
- **测试面**：Windows 实机全量 829 用例 41 败 → **0**（821 pass / 8 skipped）；POSIX 进程组/SIGTERM 时序、symlink 权限、平台路径断言、固定 sleep 时序假设逐项标注 skip 或平台无关化/有界轮询，测试契约不变。

### 0.9.2 修复：跨服务重启后头部角标停留旧版本

- **一键重启确认新进程后就地刷新**：boot id 确认 DSH Web 已恢复的瞬间，面板立即重取 ping——`dsh-m vX.Y.Z` 角标与 profile chip 同步到新进程数据，不再停留旧版本（0.9.1 实测：芯片升级 + 重启后仍显 v0.9.0）。
- **页面回前台时重取**：面板常开、服务在后台被外部重启的场景，`visibilitychange` 回前台即重取 ping（零轮询成本）。
- **角标版本护栏**：self-check 判定携带的版本与当前进程不符（旧进程残留判定）时一律静默，杜绝「v0.9.1 ⬆ v0.9.1」式误渲染。

### 0.9.1 新增：头部版本角标升级提示（有更新才点亮）

- **静默口径**：面板头部 `dsh-m vX.Y.Z` 角标常态维持 0.7.5 起的静态展示——已是最新、检查失败、本地 dev 版领先 npm（ahead）一律不打扰（ahead 仅在悬停 title 里提示「本地开发版」）。
- **仅 outdated 点亮**：`self-check`（npm latest vs 装机版本，只读）判定有新版本时，角标点亮为 warn 态并显示 `⬆ v<最新>`；点击即触发 `self-upgrade`（同一 mutation session + 装后守卫），成功后出「⚡ 一键重启」横幅。Desktop 下点击按能力表结构化拒绝（409，带官方生命周期指引）。
- **TTL 缓存 + 版本护栏**：检查结果在浏览器 localStorage 缓存 30 分钟，开面板不重复打 npm registry；升级重启后缓存按版本号自动作废。检查失败静默，不弹任何错误。

### 0.9.0 新增：官方 Desktop（双 profile）支持

- **同一包、两个 profile**：dsh-m 现在可装入官方 Desktop 的 `desktop` profile（`~/.dsh/profiles/desktop`），与 Web 的 `web` profile 并列；市场目录、面板与 agent 工具同一套，管理对象始终是宿主当前 profile（官方 `profileContext` 单一事实源）。
- **入口信任检查改委派官方**：`/dshm` 全部 method（含 ping 与未知 method）在读取请求体之前委派官方 `connection.requestRejection()` 判定（trustedHosts / loopback / 跨站 / `Origin: null` 语义随宿主），被拒请求零 body 消耗、零业务调用；宿主缺该能力时 fail-closed 全拒。**行为变化**：旧版自制守卫「缺 Origin 一律 403」不再存在——Desktop 桥合法剥除 Origin 的请求按官方语义放行，无凭据的健康检查探针从「一律 403」变为「按宿主信任判定」。
- **Desktop 首发能力表**：只读市场 + **安装新包**（委派官方 `pluginManager.installBundle`，完整性/锁/生效相位归官方）+ **开关**（委派官方管理器，服务缺席结构化拒绝、绝不文件级 fallback）；**升级 / 卸载 / dsh-m 自更新 / 一键重启**在 Desktop 结构化拒绝（409，带官方入口指引——官方暂无 upgrade API，重启归 Electron 生命周期）；构建脚本按官方 `pendingBuilds` 名单精确重试，绝不全量放行。
- **读模型与缓存按 profile 隔离**：市场安装标注、已装列表、README 预览只读当前 profile；registry / 社区清单 / accepted-source 缓存按 profile 分段（web 沿用旧路径，零迁移零清空）；收藏与操作记录按浏览器 origin 各自独立，Web 与 Desktop 不自动同步。
- **CLI 恒作用于 web profile**：`--profile web` 显式声明；`--profile desktop` 明确拒绝并指引官方 Desktop 插件管理页。
- **如实声明**：Desktop 实机（Win/macOS）E2E 未跑，`registry.json` verified 数组**不新增** Desktop 代际（实测后按收录纪律补录）；Desktop 下不做 dsh-m 文件级装后守卫（app.asar 打包布局探测盲区），以官方结果判定 + `listBundles` 复读替代。

### 0.8.5 修复

- **dshm_upgrade 守卫拦截假成功**：升级命中装后守卫拦截时（如 link/file 来源插件无法自动回退），文本输出误渲染为「✅ undefined 已升级（最新）」；现如实输出拦截原因、补偿终态与修复依据，与卡片标题（守卫拦截）一致。

### 0.8.4 变更：分类标签随界面语言双语化

- **社区分类**：已知 23 个分类的英文名直接取上游目录 `categories.en`，英文界面下分类 chips 与详情/收藏 Modal 的分类行显示英文；缺英文名的上游新分类回退中文，仍按原样渲染进临时组，等发版收录。中文界面不变。
- **精选分类**：五个分类 chip 改走双语字典（市场/工具/界面/搜索/其他 ⇄ Market/Tools/UI/Search/Other），与详情 Modal 口径一致。
- **实现**：summary 新增 `categoryLabelsEn`（`communityOutcome` 从上游目录派生，缺 en 的 id 不进映射，不手养第二张表），客户端按界面语言合并取值。0.8.1–0.8.3 为本地迭代号，无独立变更面，不单列。

### 0.8.0 变更：设置页重做（对齐双清单分区定位）

- **信息架构**：社区清单（from awesome-dsh-plugin）→ 精选清单（registry.json）→ dsh-m 自身 → 关于；「主清单」的 UI 可见名统一为「精选清单」。
- **社区目录开关**：新增 GUI 开关（live 生效，即时切换无确认；关闭态整卡收为一行说明）；新增 `set-community` API。
- **精选清单瘦身**：状态字段 7 行收敛为 4 行（配置地址合并、删除写死的「缓存策略」行）；「配置状态」仅异常时出现；按钮组精简为「强制刷新 / 校验并应用 / 恢复默认 / 下载默认 registry.json」，「检查条目可达性」从 GUI 移除（`registry-diagnose` API 保留）。
- **文案修正**：自定义源说明明确「整体替换主清单、仅影响『精选』区」；删除与实际不符的 TTL 写死描述（`timeoutMs`/`cacheTtlMin` 仍走 config 配置）。
- **dsh-m 自身**：本地 dev 版领先 npm 发布时改显「本地为开发版」而非误导性的旧「npm 最新」（新增 `ahead` 字段）。
- **关于**：文案对齐当前定位，新增 GitHub 仓库与问题反馈链接。

### 0.7.10 美化

- **头部三段分组**：标题与 tab 导航之间加发丝竖分隔线，「标题 | 导航 | 状态+窗口控制」边界清晰。
- **版本角标同色**：v 版本号不再用主文字亮色，与 dsh-m 名称统一为次级灰。
- **垂直节奏收敛**：窗口控制组按钮 26→28px 与 tab 按钮等高；版本角标微调至 24px 高；最大化/还原图标统一 12px；标题字重 700→600。

### 0.7.9 修复

- **分类 chips 顺序恒定**：退役「激活分类置前」的换序逻辑（此前每点一个被折叠裁掉的分类，它就会跳到首位，顺序随点击不断变化）。替换为：激活分类落在收起态裁剪区时自动展开完整分类行——「当前激活的分类始终可见」目标不变，顺序从此稳定；同一激活分类下手动收起会被尊重，换选其他被裁掉的分类或点「全部」时重置。

### 0.7.8 变更

- **修复「最大化没作用」的根因——CSS 热更自愈**：面板样式表此前只在首次注入（`#dshm-css` 存在即跳过），服务热更后旧 bundle 留下的样式表不含新类名规则（全屏/窗口控制组），导致新功能「点了没反应」、按钮裸奔成原生样式。现给注入的样式表带内容哈希（djb2）版本标记，bundle 更新后重新打开面板即自动替换旧样式，无需刷新页面。
- **窗口控制组重新配色**：去掉浮起底色，改透明底 + 发丝外框（与搜索清除钮同一配色语言），单格加宽 34→44px 防误触；关闭悬停仍为红色警示。

### 0.7.7 变更

- **移植 dsh-market 的全屏功能**：面板头部新增「最大化/还原」（连体窗口控制组设计：最大化 + 关闭等宽两格、发丝分隔线、统一 SVG 线条图标；关闭悬停红色警示）。全屏铺满视口、去圆角，状态 localStorage 记忆，Esc 关面板语义不变。
- 0.7.6 补记：版本角标去粗体、去点击复制（改静态展示）；吸顶分类行上沿镂空修复（sticky 锚点上移抵消容器 padding）；关闭/清除按钮改框线平面风。

### 0.7.5 变更

- **头部版本 chip 改显 dsh-m 自身版本**（`dsh-m v0.7.5`，点击复制；DSH 运行版本看设置页与 `dshm ping`）。
- **× 关闭/清除按钮统一重绘**：搜索清除、详情 Modal 关闭、操作记录行移除三处改用 SVG 线条图标 + 悬停浅底的专用按钮样式；搜索清除钮悬浮于输入框右缘（胶囊内对齐）。
- **修复 dsh-market 的 peer 告警**：`@deepseek-ai/dsh-tools` peer 由 `*`（semver 严格口径不匹配 rc 预发布版本）改为显式 range `^0.1.7-rc.2 || ^0.2.0-rc.1 || >=0.2.0`；未来更新的 rc 线（如 0.3.0-rc.x）需再追加。

### 0.7.4 变更

- **面板 tab 回退旧版分段按钮风格**（0.7.2 误改下划线样式，按主人要求还原圆角按钮组 + 高亮态）。
- **搜索框通长**：修复搜索容器缺 `display:flex` 导致输入框未拉伸的问题，恢复整行宽度。
- **筛选按钮与页号跳转控件重新配色**：筛选按钮改浮起面板底色 + 方角与分类 chips 区分（激活态品牌色描边）；页号输入改胶囊形细描边，「跳转」用品牌色文字钮。
- **吸顶分类行彻底不透**：背景直接使用不透明底色 token（此前的 color-mix 半透明配方在深色主题下仍会透出下方卡片文字），保留底部分隔线。

### 0.7.3 变更（含 0.7.2）

- **首页布局复刻 dsh-market**：市场页改为「分区 chips → 整宽搜索行 → 分类 chips + 行尾筛选弹层」结构；筛选弹层独立样式（方角矩形 + 前置 chevron），收纳排序字段（npm 下载量/Star 数/收录日期）、排列方向与每页条数（原排序下拉与分页器条数选择退役）。
- **收藏卡可点开详情**：修复收藏区卡片点击无响应——收藏快照字段不全，打开时按 id 从两分区内存 → market API → 快照三级解析完整条目，详情 Modal 与安装链路（含兼容确认）全量复用。
- **翻页页号跳转**：页码行新增页号输入框，输入有效页号回车或点「跳转」直达。
- **吸顶分类行毛玻璃**：滚动时吸顶的分类行加 backdrop blur 与底部分隔线，下方卡片文字不再透出干扰。
- **按需求移除**：「发现社区/申请收录」行（dsh-m 不支持收录功能）、「任务」按钮（操作记录面板恢复常驻）、「刷新」按钮（强制刷新在设置页）。
- 说明：收录条目不携带宿主版本要求字段，dsh-market 的「宿主版本」筛选项无数据源，未复刻。

### 0.7.1 修复

- **社区条目可安装**：修复 0.7.0 回归——社区区里的条目点安装报「registry 中没有该条目」（安装按收录 id 只查主清单，未查社区目录）；现与升级路径同构，主清单 miss 时按 id 查社区目录再装。
- **市场页第一行紧凑化**：搜索框、刷新、排序（社区区）并入分区 chips 行右侧；信息性来源横幅（「官方默认收录清单 / 自定义收录清单 / 来源为本地缓存」）退役——其「共 {count} 条」计数从未接线（恒显 0）；错误态「收录清单不可用」与社区兜底/陈旧提示保留。

### 0.7.0 新增

- **分区制市场**（[ADR-0004](./docs/adr/0004-zoned-market-display.md)）：数据层双清单合并不变，展示层按「社区（默认）/ 精选 / 收藏」三分区呈现；`dshm_search` 与 `dshm search` 改用 `--source community|primary|all` + `--offset` 真翻页（默认 10 条），`primary_only` 退役。
- **搜索相关性**：NFKC 归一化 + 中西文边界 + 字段加权（name/npm > owner > 描述 > 分类 > tags），多词同字段全命中；id 整串精确匹配最高优先。
- **操作记录 + 恢复执行器**、**本地收藏 + 下架清理**、**详情 Modal + 截图灯箱**、社区卡 byline/deprecated 徽章/目录版本快照兜底（不参与 outdated 判定）。

### 0.4.0 新增

- **开关（Enablement Toggle）**：已装卡片一键启停，内部自动路由行覆盖（单行插件，即时生效）或 Bundle 选择（多行插件）；写路径委派官方 `pluginManager` 服务、缺席时降级 loader 直操作（[ADR-0001](./docs/adr/0001-delegate-with-fallback-for-plugin-manager.md)）。
- **运行相位徽标**：loader fiber 状态投影，failed 一眼可见。
- **保护名单**：`dsh-m` 自身与官方宿主命脉 16 项不可开关、不可卸载（升级不受影响）。
- **精确构建放行**：needs-builds 拦截后按 pnpm 待决名单逐键放行，全量放行降为兜底并如实标注（[ADR-0002](./docs/adr/0002-precise-build-approval.md)）。
- **peer 兼容预检**：安装/升级前校验 `@deepseek-ai/dsh(-*)` peers 与运行时版本（GitHub 源明示未检）；不兼容时 GUI 弹确认、agent 回结构化结果、CLI `--force`。
- **实测版本清单（verified）**：registry 条目可选 `verified` 数组记录实测过的 DSH 运行时版本——实测声明而非预测声明，只展示不拦截。
- **bundle 身份验证**：装后检测无补丁层的包并警告「已装入为纯依赖」。

### 0.4.x 退役

- **元数据源竞速**：0.4.0 曾引入 npmjs / npmmirror ping 竞速选择元数据读取源，现整体移除（含 `probeEnabled` / `probeTimeoutMs` / `probeCacheTtlMin` 三个设置项与设置页展示）。官方同款探测只服务于「安装对话框 registry 默认预选」，dsh-m 无此交互；实测宿主机 npmjs 稳定更快，探测恒等默认行为。元数据读取固定走 npmjs，与安装链路（profile `.npmrc` 默认源）一致。

---

## English

### Fixed in 0.9.66 — touch swipe direction inverted vs mobile convention (user report from a real phone)

- **Root cause**: 0.9.65 anchored the swipe mapping on the keyboard cursor metaphor (`ArrowRight=next` ⇒ finger-right = next image), while touch follows the **content-drag** metaphor - the finger drags the filmstrip, so **swiping left reveals the image on the right = next** (photo libraries, chat apps, every carousel). `swipeDir`'s finger-direction result was fed straight into `lbStep`, producing "swipe left → previous, swipe right → next" on real devices - inverted against all muscle memory.
- **Fix**: the call site flips the mapping (`lbStep(index, -dir, …)`); `swipeDir` semantics unchanged (still reports the finger direction), now documented as "the return value is the finger direction, not the page direction - callers must negate". Keyboard ←→ untouched (desktop cursor convention: ←=previous, →=next - the two metaphors each hold in their own domain).
- **Probe fixes in the same batch**: `verify-lightbox.mjs` A31a/A31b rewritten to the correct convention (the old assertion going red after the fix is direct proof the direction flipped); probe numbering collision fixed - the pre-existing Primary scenarios keep A26-A29, the new-feature scenarios become A30 (prefetch warm-hit) / A31 (swipe) / A32 (focus trap); A19 rewritten as a timing-deterministic double-fail placeholder scenario (byproduct of this verification round: the suspected regression was triply disproven - ablation probe, worktree bisect, deterministic timing - the prefetch had legitimately pre-warmed the scenario's premise image; forensics live in the probe comments).
- **Verification**: 1289 tests green, typecheck clean; browser probe 50/50 (A31 five assertions incl. the flip proof + A32 six trap assertions + A30 prefetch warm-hit + A19/A20-A25 legacy anchors all held).

### Added in 0.9.65 — lightbox: neighbor prefetch + touch swipe navigation + focus trap

- **Neighbor prefetch**: once the current image settles (`useImgChain` settled), the left/right neighbors are warmed silently - using a `weservUrl(w=1600)` URL **byte-identical** to the lightbox's real request, so a swipe/arrow navigation hits the browser cache with near-zero wait. Strictly best-effort: no winner-memory or chain-state mutation, a failed prefetch leaves the real chain untouched (navigation still runs the weserv→original dual fallback); a `prefetchedRef` Set dedupes repeated crossings (no re-issuing when bouncing back), the Set lives for the lightbox mount lifetime (a fresh open warms again); single-image boxes short-circuit naturally via `lbNeighbors` returning an empty list.
- **Touch swipe navigation**: a horizontal touch drag past the threshold flips images (`swipeDir` pure predicate: |dx| ≥ 48px and |dx| ≥ 2|dy|; no time gate - slow deliberate drags count; vertical/diagonal drags return 0 - vertical gestures and pinch-zoom accessibility stay native, via `touch-action:pan-y pinch-zoom`). Only `pointerType==="touch"` is recognized - mouse drags keep their native semantics (image = native drag, backdrop = press+click to close, the 0.9.27 drag-misfire guard intact); for 500ms after a recognized swipe the root's capture phase swallows the synthetic click (double belt: a swipe ending on ✕ or the backdrop triggers neither).
- **Focus trap**: while the lightbox is open, Tab/Shift+Tab cycles only among focusable controls inside it (buttons/links: ✕/‹›/failed-state retry + open-original); if focus has escaped (e.g. a backdrop click left it on body), the next Tab pulls it back to the first/last control. After the portal-to-body change, Tab used to walk into the background panel - this closes that gap; DetailModal's own U8 debt (no trap) is unchanged and Esc still closes only the topmost layer.
- **Verification**: 1289 tests green, typecheck clean; `client-lightbox.test.mjs` gains 6 items (`lbNeighbors`/`swipeDir` pure-logic units + prefetch/swipe/trap/touch-action structural anchors); all 0.9.60/0.9.62-era anchors retained.

### Changed in 0.9.64 — settings page: dual-catalog side-by-side layout + operations history moved into the settings tab

- **Settings grid (mock-driven final review)**: the Community and Curated cards now sit side by side at **4:7** (the read-only community card needs ~250px; width goes to the more interactive registry card); in fullscreen the About card joins a three-card row (`4fr 7fr 3fr`, uncapped — the same "add columns, don't stretch units" philosophy as the market tab); below a 760px viewport it falls back to a single column; About spans full width in normal mode, the operations card is always full width.
- **Community card, clean list**: the title row is a pure title again (`from` prefix dropped); the status badge becomes a small green/amber/red dot; hairline row separators + right-aligned tabular figures; the catalog toggle joins the list as its last row (the toggle is an attribute of the catalog — pinning it to the card bottom detached it from context); off state = hint line + toggle row (the re-entry control is preserved). The intermediate "stat band" design (boxed big numbers) was rejected in live review — cards inside a card are visual noise.
- **Curated card trim**: the note line is shortened (the removed clause duplicated the download button tooltip — zero information loss); long configured URLs render as a single ellipsized line with the full value on hover.
- **Operations history migration (batch 2)**: the bottom strip shared by all three tabs is retired; `OperationsPanel` becomes `OperationsCard` at the bottom of the settings tab — active rows stay outside the scroll area (progress never scrolls away), finished records live in a 220px scroll region (display cap 50 to bound the DOM; store/restore validation untouched), "Clear finished" is pinned below, and an empty-state hint card doubles as wayfinding.
- **Visibility compensation**: with the bottom strip gone, failed/warned records would go unnoticed — the settings tab now shows a red dot (reuses the outdated-dot style; clears on remove/clear); the market card's "running" badge now switches to the settings tab and scrolls to the operations card (label 查看操作面板 → 查看操作记录).
- **Verification**: build verify passes, typecheck clean, full 1283-test suite green in 4 consecutive runs (one transient unrelated flake in the first run did not reproduce); the final layout was settled via an interactive HTML mock across three widths × three layouts × multiple states (`docs/settings-layout-mock.html` committed as a design record).

### Fixed in 0.9.63 — clicking dead-center on the loading spinner no longer no-ops: spinner gets an explicit onClick=onClose

- **Background**: 0.9.62 added the chain-loading spinner, but the spinner is a **child** of the backdrop root, and `backdropCloseHandlers` (0.9.27 drag-misfire guard) closes only when both `mousedown` and `click` land on the backdrop itself (`target === currentTarget`) - so a click dead-center on the 34px spinner did nothing. The spinner now carries `onClick: onClose`, same semantics as click-image-to-close: during loading, any click is a valid escape hatch.
- **Verification**: the spinner anchor in `client-lightbox.test.mjs` follows the new signature (gating + onClick semantics); full suite/typecheck as usual.

### Fixed in 0.9.62 — lightbox controls invisible in light color schemes: self-owned cinema backdrop + dark glass control chips + loading spinner/fade

- **Root cause (user photos, both color schemes, 2026-10-09)**: the dsh-skins ADR-0007 overlay-frost union targets `[role="dialog"][aria-modal="true"]` - which matches the lightbox root (it carries dialog semantics). In light schemes the 86% warm-white tint + blur14 turned the cinema-black backdrop into light frosted glass, while ‹›/✕ reuse the base `.dsvm-btn` translucent-white recipe (`rgba(255,255,255,.14)` fill, white glyph/border) - invisible on a light surface. Dark schemes hit the skin's `rgb(18,18,26)` branch and stayed readable, hence "light mode unreadable, dark mode okay". Vanilla installs (backdrop always near-black) never showed it - which is how it slipped past 0.9.61.
- **Two-sided fix**: ① dsh-m side (this release): the lightbox `background` is now `!important`-owned - "dark backdrop + light controls" is the component's own readability invariant for a cinema surface and must not flip with color schemes or skins; marketplace community skins are un-enumerable, so the component must defend itself (the `!important` inventory is pinned at a fixed length of 4 by the regression gate; additions must register explicitly). ② dsh-skins side: all three skins exempt `.dsvm-lightbox` via `:not(...)` (1.5.1, ADR-0007 amendment) - semantically a "dialog frost" never should have tinted an image theater.
- **Dark glass control chips**: ‹›/✕ move from bare translucent white to a chip in the same family as the bottom pill (slate-900 55% + white border + blur8 + shadow) - on dark backdrops the border/blur/shadow provide edge definition, on light backdrops the chip itself is the contrast surface; readable under any scheme or skin. Explicit `:hover` brightening (specificity 0,3,0 beats base `.dsvm-btn:hover` 0,2,0 regardless of source order - the R1 family lesson).
- **Loading indicator & fade (UX)**: while the image chain runs (slow weserv / 8s guard tier-swap / large direct original) the lightbox used to be a silent black void; it now shows a spinner (`useImgChain` exposes `settled`). The image fades in over 160ms on onLoad; under `prefers-reduced-motion` the fade is disabled and the spinner slows down. Known nit: the spinner is a child of the backdrop and `backdropCloseHandlers` only honors the root element (drag-misfire guard), so a click dead-center on the 34px spinner does nothing (the surrounding backdrop still closes) - `onClick` added in 0.9.63.
- **Verification**: 1283 tests green, typecheck clean; `client-lightbox.test.mjs` gains 6 structural anchors (backdrop `!important` fixed-length inventory / chip rules with explicit hover / spinner gating / fade class / settled exposure / reduced-motion); all 0.9.60-era anchors (portal / compound selectors / titlebar offset / focus restore / index keys) retained.

### Fixed in 0.9.61 — screenshots/icons unreachable from mainland browsers: weserv-first dual-fallback image chain

- **Root cause (measured 2026-10-09)**: screenshots (raw.githubusercontent.com) and icons (github.com avatars) load browser-direct - fine from the server (200/0.2s), intermittently dead from mainland browsers. That day's failure sample dsh-wallpaper-engine (5 images, 22.5MB incl. a 10.4MB GIF) rendered an empty strip and a black lightbox; 0.9.60 ruled out a lightbox-v2 regression, and "working" icons were the local letter fallback. Benchmark dsh-market 1.66.14: thumbnails unconditionally via weserv (their in-source mainland measurement: 1.39s/23KB vs 41KB original) but the lightbox loads direct with zero fallback - the same mainland black hole.
- **Image chain (ADR-0014)**: three consumers (thumbnail h=300 / lightbox w=1600 / icon h=96) share `useImgChain` - weserv tier first (`fit=inside&we=1&output=webp&q=80` server-side resize/recode), on failure or an 8s guard (that tier only; the direct tier gets no artificial timeout so slow-but-legal downloads are never killed) fall back to the original URL, then to per-consumer finals: thumbnails dropped (whole strip hidden when all fail), lightbox placeholder "failed + retry + open original", icon letter fallback. Winner memory per service bucket (raw/avatar) remembers the last successful tier, and **each chain snapshots the order at start** - sibling images racing in the same batch never skip a tier because a preference flipped mid-flight (found in execution: thumbnail 1 succeeding via direct flipped the preference and killed thumbnails 2/3); advancement is order-aware (with direct preferred, a direct failure still tries weserv - a fixed ladder would skip the fallback entirely). All four shots references switch to visible (strip gating / strip map / lightbox gating / keyboard nav + effect deps), the strip keeps a full-list map with stable `${i}:${src}` keys, and the lightbox index is clamped against shrinkage.
- **Supporting**: pure logic in `src/client/img-chain.js` (URL builder / bucket classifier / order-aware tier machine / winner memory; `WESERV_BASE` single constant - a future setting changes one line); one GLOSSARY term (Image Chain); probe extended A16-A24 (direct-blocked / weserv-blocked / dual-block placeholder+retry / weserv-hang 8s guard / winner memory / strip removal / direct-first Probe scenario) plus `--live` real-network compression; three probe-harness determinism pillars learned during execution: **a fresh page (fresh context) per scenario** (kills route-remount races and cross-scenario decoded-image reuse), generation URLs (`?g=N` - any URL that must fail is unique for the page lifetime), and tier-order assertions via reqLog (`page.on('request')` survives route interception quirks).
- **Verification**: 1256 tests green (1236 baseline + 20 new), typecheck clean; probe 31/31 stable across three runs; `--live` compression: mascot-drawer.png direct 2859KB vs weserv 151KB (~18.9x). Review absorption round (full multi-round independent subagent review): R1-1 [blocker] the 8s guard survived a successful load - a displayed image was force-advanced 8s later (mainland: thumbnails wrongly dropped, icons degraded, lightbox mutating into the placeholder); fixed with settled semantics (set by onLoad, reset on chain start/navigation, four-condition timer guard incl. empty url), pinned by new probe A25 (dwell >8.5s; the old code cannot pass it) plus timer-gating source anchors. R1-2 A22 gains the negative assertion (zero weserv-form requests after navigation) and A24 asserts the first request's form (winner-memory flip now falsifiable). R1-3 freshState clears reqLog (scenario closure). R1-5 url change resets via render-phase derived state (the one-frame ghost request is gone). R1-6 --live validates r.ok + image/* on both fetches. R2-3 defensive settled reset in advance. Round-2 verdict: consensus approve. Deferred: a behavioral probe for the middle-frame elimination (currently pinned by source anchors).

### Fixed in 0.9.60 — screenshot lightbox unusable when windowed: portal out of the panel containing block + always-visible controls

- **Root cause**: the lightbox was a `position:fixed` descendant of `.dshm-panel` (`backdrop-filter` + `overflow:hidden`), so the panel box became its containing block. The image sized in viewport units (old 94vw/80vh) inevitably overflows the ≤680px-tall windowed panel and the in-flow ‹›/dots row gets clipped off-screen, with no close button at all; fullscreen only worked because the panel then equals the viewport (the reported "nav buttons appear only in fullscreen; windowed fills the small screen and cannot exit").
- **v2 fix (`b89af18`)**: ① portal the lightbox to `document.body` — it escapes the containing block and is positioned against the real viewport in every panel state (SSR/no-document falls back to the plain tree so the smoke test still renders it); ② every control is absolutely positioned to the edges and can never be pushed off-screen by an image — persistent top-right ✕, large side ‹ › arrows, a bottom counter+dots+hint pill, and the image capped at 74vh; ③ four ways out: click the image (zoom-out cursor), click the backdrop, Esc, or ✕ — keyboard ←→/Esc semantics unchanged (DetailModal document-level listeners are unaffected by the portal); ④ single-image shots hide ‹›/counter/dots (no dead controls), dot hit areas grow to 18px via `background-clip:content-box`, and the close button is focused on open (same pattern as DetailModal U8).
- **Supporting changes**: the ring step is extracted as the pure `lbStep` helper (`lightbox.js`, shared by the component and the keyboard handler; unit-tested for wrap-around, single image and non-finite input); new `client-lightbox.test.mjs` structural guards (portal/✕/click-image-close/single-image/CSS absolutes/inline-modulo retired); SSR smoke extended with multi- and single-image lightbox assertions.
- **Review absorption round (independent subagent review, landed pre-release)**: R1 CSS cascade — the base `.dsvm-btn` rule sits later in source order and measurably overrode the ✕/‹› `padding:0/font-size:26px/radius:10px` (arrows actually rendered a 13px glyph); switched to compound selectors `.dsvm-btn.dsvm-lb*` (specificity 0,2,0, order-immune). R2 Windows Desktop drag band — the lightbox now yields the top band via `top:var(--dsh-windows-titlebar-height,0px)` (the 0.9.4 precedent; web falls back to 0px with zero drift) so ✕ never lands in the shell's `-webkit-app-region:drag` strip that swallows clicks. R3 focus restore — closing the lightbox returns focus to the triggering screenshot thumbnail (capture effect declared before the focus-✕ effect; `isConnected` guard). R4 lightbox dots and the thumbnail strip now key by index (duplicate URLs no longer collide). R5 the headless probe is persisted as `scripts/verify-lightbox.mjs` (manual run, needs playwright-core); structural assertions converged to includes-level anchors (verbatim regex red lights mean "text changed", not "behavior changed"); SSR smoke gains `role=dialog/aria-modal` and duplicate-URL dots assertions.
- **Verification**: 1236 tests pass and typecheck is clean; `scripts/verify-lightbox.mjs` reproducing the real `.dshm-overlay > .dshm-panel` context passed 19/19 assertions — a fixed probe inside the panel equals the panel box (containing block proven), the lightbox box equals the viewport, ✕/‹›/pill stay within the viewport at all times, **computed cascade styles correct (R1 regression gate)**, ›/dot/‹/←→ navigation plus Esc/click-image close behave correctly, **focus restored to the thumbnail on close (R3)**, **40px titlebar band avoided (R2)**, fullscreen regresses nothing, and controls remain present in a 500px-tall window (always clipped before).

### Improved in 0.9.59 — 8px category-row inset and a derived visibility for the no-op collapse toggle

- **Category-row inset (`f42e5be`)**: the category chip row sat flush with the search box and card grid, and small pills hugging large elements felt cramped; the row now starts 8px further right for breathing room. Only the category row (ZoneChips) moves — the zone chip row above stays put. `offsetLeft` and absolute positioning share the `.dshm-chips` padding-box origin, so `+N` tracking, the pinned Filter trigger and `offsetTop`-based clip geometry are all unaffected.
- **No-op `⌃` fix (`7cbdf11`)**: at fullscreen width all category chips can fit within maxRows (2) rows, where clicking the expanded-state `⌃` collapse toggle changed nothing visually (`hiddenCount=0`, not even a `+N` appears) — a dead button. Added an expanded-state row measurement `expRows` (reusing the pure `chipRows` helper; the expanded measure branch only writes `expRows`, never `geom`), and `⌃` renders only when expanded rows exceed maxRows. The ResizeObserver now also observes while expanded — the width change of fullscreen↔window switches is exactly the remeasure trigger — so `⌃` hides itself in fullscreen and returns back in the window; counting includes `⌃` itself, so visibility converges without oscillation.
- **Verification**: 1224 tests pass; verified against real DSH Web for `⌃` visibility and collapse behavior in both window and fullscreen, and for the 8px category-row inset.

### Improved in 0.9.58 — the +N toggle follows the last visible category at matching height

- **Position (`4ade54f`)**: within the 0.9.57 reserved, overlap-free slot, position `+N` from the measured right edge of the last visible category chip plus 6px. The slot grows from 52px to 60px to preserve clearance at narrow widths. Curated rows without a Filter trigger still reserve no unnecessary Filter gutter; expanded `⌃` remains at list end.
- **Equal height (`aeed14c`)**: use the last visible chip’s measured border-box height for `+N` and center its text with inline-flex, rather than letting Latin-only text and CJK category labels acquire different automatic line heights. Other chips keep their existing dimensions.
- **Verification**: 1224 tests and typecheck pass. Against the real DSH catalog, community layouts at 880/700/520/420/320px showed equal 21px boxes, 0px top-edge delta, roughly 5–6px horizontal separation, and zero overlap; the 260px curated layout had zero overlap and curated↔community switching remained stable.

### Fixed in 0.9.57 — curated-zone update loop, dead panel entry, and collapsed filter/overflow overlaps

- **Root cause (reproduced on 0.9.56)**: curated labels may get a fresh object on every parent render; the layout effect depended on the `chips` array identity and on its own `geom` update. Synchronous remeasurement repeatedly entered the same commit, eventually throwing React `Maximum update depth exceeded` (#185). React emptied the panel tree while leaving `#dshm-panel-root`; the old entry guard checked only for a container and silently blocked every later open. The pinned Filter wrapper also added a second border around its bordered button, while the clamped/inline `+N` iterations overlapped neighboring chips at narrow widths.
- **Fix**: depend on a stable signature of rendered category IDs, labels and counts; defer geometry-dependent remeasurement to an animation frame after state commits. Retire the 0.9.56 `display:none`/in-flow feedback path in favor of a full in-flow chip layout with `visibility:hidden` beyond the clip; derive the hidden count from all chip row offsets. Give out-of-flow `+N` its own 52px right slot, separate from Filter's 96px, with a more specific selector so the total reservation wins the cascade. Measure the last visible **distinct row** rather than the Nth chip. Strip the redundant Filter-wrapper border; discard an orphaned panel root on the next open.
- **Tradeoff**: correctness, zero overlap and reopenability take precedence over keeping `+N` flush against the last chip. Its count remains truthful; expanded `⌃` remains at list end.
- **Verification**: three additional regression assertions, 1224 tests passing and clean typecheck; real DSH Web with the candidate client survived three curated↔community round trips, close/reopen and stale-root recovery; six widths from 260–880px showed zero badge/chip/Filter intersection, and curated's five categories showed no spurious `+N`.

### Fixed in 0.9.56 — ZoneChips +N overlap eradicated: in-flow document layout + wrap-yield-a-category (owner's design)

- **Defect (reproduced on 0.9.55)**: the collapsed `+N` used "absolute positioning + contentW−48 clamp"; when the last visible row's leftover was narrower than the badge, the badge covered the last visible chip (real panel: +9 covering the tail of 文档与渲染 61).
- **Fix (in-flow document layout)**: `+N` abandons absolute positioning and flows inline between the last visible category and the clipped categories — chip/badge overlap is impossible by construction.
- **Wrap-yield-a-category (owner's design)**: clipped categories switch `visibility:hidden` → **`display:none`** (no space — the prerequisite for yielding to work); when the measure finds the `+N` top beyond the last visible chip's row top (wrapped), `hiddenCount +1` — one visible category yields, `+N` pulls back into the last visible row, and `max-height` grows one row to give `+N` its own line; the ratchet is single-direction (down), staying conservative on width growth while the count stays truthful.
- **Tests**: full suite 1221 cases zero failures, typecheck clean; headless probe verified 880px/420px/expanded/collapsed/Q1-regression all at `chipOverlapPx = 0` with `+N` visible throughout, expanded view showing 23+⌃+filter in full, and `+N` returning to its inline slot after collapse.

### Changed in 0.9.55 — ZoneChips expand/collapse toggle inline (aligned with the dsh-market reference design) + overlay stacked scrim for contrast

- **Inline toggle (owner-requested, reference: dsh-market v1.66.11)**: `+N` moves out of the right-side overlay group into an **absolutely-positioned inline slot** pinned at "last visible category chip's right edge + 6px" (the leftover of the last visible row), sharing one position semantic with the expanded `⌃` (in-flow at list end): "hug the current end of the list", flipping direction without relocating; when the leftover is too narrow it clamps to the content right edge without entering the filter gutter. The gutter slims from 132px to 96px (hosting only the pinned filter), showing ~1 more category per width. With `+N` removed, the overlay group hosts only the pinned filter and the R2-N1 4th collision class dissolves naturally.
- **Overlay stacked scrim (owner-requested: low contrast in light theme)**: root cause is that the `--dsw-alias-bg-base` token itself is 0.55-translucent; the overlay scrim now paints the same token in a **three-layer stack** (background-color + two linear-gradient layers), effective opacity ≈ 1−0.45³ ≈ 91%, theme-adaptive (dark rgba(12,26,38,·) / light rgba(247,250,252,·) both significantly strengthened) with zero hard-coded colors.
- **Tests**: full suite 1221 cases zero failures, typecheck clean; headless probe verified collapsed-state `+N` left edge = last visible chip right edge + 6px on the same row, double scrim gradients, single-button zero-collision filter, stable toggle position across collapse/expand cycles, and the Q1 regression (long labels: hidden > 0); real-panel screenshots in the release record.

### Changed in 0.9.54 — review fixes ship (ZoneChips stale-geom / ⌃ bounce / overlay centering) + dsh-skip-browser-auth catalog copy reconciliation

- **ZoneChips review fixes (execution-review R1, `b2aab5f`)**: ① measure deps use the `chips` reference instead of `chips.length` plus `active` — same-length content changes (count refresh / active bold reflow) now deterministically re-measure, closing the stale-geom blind window where RO is deafened by the max-height clamp (clipped-but-focusable chips / missed auto-expand, a D4 violation); ② manual `⌃` collapse unconditionally records autoRef — manual collapse is respected on every path, removing the edge drift where a stale-geom decision effect bounced the collapse back; ③ the overlay group is vertically centered per measured row-height (compensated bottom offset).
- **Catalog copy reconciliation (review Q5/Q7)**: two rounds of dsh-skip-browser-auth description updates ship with this release (`ed6043a` fixed-branch note + defect warning, `23da0fd` warning-period ended, slimmed to keep-latest hint); from this release onward a tag↔CHANGELOG reconciliation runs before publishing, and commits use explicit `git add <files>` instead of `-A`.
- **Tests**: full suite 1221 cases zero failures, typecheck clean; directed probes verified Q1 (same-length label change: hidden 0→5 live recompute) and Q6 (post-⌃ +500ms stays collapsed); real-panel e2e (V1 cold storage / V4 sticky / V6 filter / V7 dark theme) in the 0.9.53 evidence chain.

### Changed in 0.9.53 — ZoneChips Plan A "invisible full-list measurement": cold-mount mis-collapse eradicated + live row-capacity re-measurement

- **Motivation (found during 0.9.52 end-to-end verification)**: with a fresh browser profile (no localStorage snapshot), the market data had not arrived when the panel first mounted, so the old `fit` measurement ran on an EMPTY list; when data arrived the re-measure faced a DOM already collapsed by the stale budget (1 chip + "+N") and ratcheted to a frozen "3 chips + +20" single row. Warm sessions hit the snapshot on first mount and measured correctly — which is why this 0.7.0-era defect never surfaced. Sister issue: the measure effect ignores width changes, so `+N` drifts from real capacity after window resizes. Full causal chain with headless evidence: `docs/plans/2026-10-08-zonechips-visual-clip-requirements.md`.
- **Change (Plan A "invisible full-list measurement", converged through an independent 3-round review with 11 findings)**: the slice-budget is gone — category chips **always render in full**; collapsing is a `max-height` (measured row-height × rows) + `overflow:hidden` visual clip on `.dshm-chips`; chips beyond the clip get per-chip `visibility:hidden` (parity with today's "unrendered = not in tab order"); `+N`/`⌃` become a right-side overlay group (horizontal pair pinned to the last visible row, gutter `--dshm-clip-gutter:132px` geometrically guarantees zero chip intersection); the filter trigger is pinned as an overlay while collapsed and stays in-flow when expanded; re-measure hooks = deps (`chips.length/expanded/zone/stuck/rowHeight`) + `ResizeObserver` (rAF-throttled) + `document.fonts.ready`, all feature-detected with graceful degradation (precedent `:947`). Measurement pure functions (`chipRows/countBeyondRows/clipTopOf/autoExpandDecision`) moved to `market-state.js` with 20 direct Node unit tests.
- **Semantics preserved**: sticky collapse to one row / restore on scroll-up (the 0.9.52 sentinel chain untouched; the clip host is `.dshm-chips` and clipping the wrap is forbidden — it would clip the sentinel and permanently mis-set stuck, review blocker Q1); `+N` expand / `⌃` collapse; auto-expand when the active category falls beyond the clip + autoRef "manual collapse is respected" (implemented as split reset/decision effects, review Q3); zero-count dimming. One intentional behavior improvement: while collapsed, the filter trigger moved from "third in-flow row end" to a persistent overlay at the last visible row's right end.
- **Tests**: new `client-zonechips-clip.test.mjs` (20 cases) + 1 full-render smoke assertion; full suite 1221 cases zero failures, typecheck clean; headless probe matrix V1–V6 verified (cold data arrival collapses correctly at two rows / three-width live recompute / curated zone reserves no gutter / sticky one-row recompute and restore / filter & +N zero-overlap and clickable / auto-expand & autoRef no-bounce); probes not committed (0.9.52 convention).

### Changed in 0.9.52 — uniform header rhythm: sticky sentinel leaves the flex flow, killing the 25px dead band between search row and category chips

- **Motivation (spotted in the owner's screenshots)**: the market header gap between the search row and the category chips row measures 25px (12 gap + 1px sentinel + 12 gap) — more than double the 12px rhythm between zone chips and the search row, identical in both community and curated zones, visually a full-width empty dead band; in search mode ZoneChips (and its sentinel) unmount entirely and the band disappears — proof it is a layout side effect, not designed rhythm.
- **Root cause**: the sticky-detection sentinel added in 0.7.0 Task 10 (a 1px div watched by an IntersectionObserver — leaving the viewport means the chips row is pinned → auto-collapse to one row) is a direct flex child of `.dshm-body` (flex column, gap:12px) and consumes an extra gap. The sentinel must stay in-flow to serve stickiness: naive alternatives were all rejected — removing it / `display:contents` kills the observer (permanent one-row state), wrapping sentinel+wrap in a div locks the sticky travel.
- **Change (single point, ZoneChips render tail)**: the sentinel moves inside `.dsvm-chipswrap` as an absolutely-positioned child (`position:sticky` is itself a positioning context), with `top:-5px` replicating the old geometry — the old sibling sentinel's top edge sat exactly 5px above the wrap's top edge, so the IO exit trigger is pixel-equivalent. A headless-Chromium probe verified the full stuck chain when pinned: wrapTop=0, sentinel at −5px out of viewport, IO `isIntersecting=false`. Spacing returns to `zoneBar |12| searchRow |12| chips`: search→chips 24.36px → 12px, header ~13px shorter, browse-mode rhythm now matches search mode.
- **Tests**: full suite 1200 cases with zero failures and a clean typecheck; geometry and sticky behavior verified via temporary headless probes, then removed (not added to the formal suite).

### Added in 0.9.51 — community entries gain a derived github field (icon coverage 45.6% → 100%)

- **Motivation**: community npm-source cards always fell back to the initial letter — the adapter's npm branch only produced the `npm` field and discarded the GitHub repo mapping inside the upstream `url` (demoted to `homepage` only), so `github` stayed unset and the client Icon owner-avatar fallback (`github.com/<owner>.png?size=64`) never fired. Measured against `dsh-plugin-catalog@2026.1007.4837`: 2,298 of 2,298 npm-source entries among 4,226 adaptable ones (**100%**) carry a github.com url — pure data discarding, not an upstream gap.
- **Change (single point)**: the adapter npm branch now derives `github = githubFromUrl(url)` (`/tree/` subpaths resolve to the repo root; original casing preserved; derivation failure produces no key and never skips the entry — lenient entry semantics, Q43). `source` semantics unchanged; zero client changes — Icon fallback, the details row gaining "GitHub · npm", and installed-view `registryGithub` (first tier of the README base-URL fallback) all light up through existing pipelines.
- **Activated semantics (accepted on record)**: ① the merge layer's github-collision branch now applies to community npm entries (same-repo entries yield to curated, curated always wins) — full real-catalog simulation shows zero new displacements (4,215 → 4,215); ② plugins installed from GitHub source can now match community npm entries, upgrading via the npm source (same semantics curated dual-source entries already had). Zero performance regression: no new host-side network requests, latest-probe path and cache keys unchanged, the Q46 community-github probe exemption and GithubBudget untouched.
- **Tests**: adapter flips 1 assertion + nets 4 cases (github url derivation with original casing, non-github host, missing url, invalid shape), plus 1 added assertion in the existing subpath case (repo root); merge layer nets 2 cases (github-collision displacement, GitHub-source installed matching; both red → green); full suite shows zero new failures against the captured baseline and zero typecheck errors.

### Added in 0.9.50 — two-leg /latest README fallback ladder + profile-aware not-installed copy + fallback failure summary

- **Motivation (verified on the Shanghai Windows desktop)**: on the desktop profile (effective registry npmmirror), the README fold for billion-context (705k weekly downloads) always failed with "web profile 未安装该插件" — npmmirror's packument measures 8,586,604 bytes, above dsh-m's 8MB (8,388,608) maxBytes cap (readCapped throws a 502 "response over limit"), so the fallback leg always failed and the original local error was rethrown per the 0.9.45 contract; npmjs's packument (8,195,089 bytes) merely happens to sit under the cap with an empty readme field — the web profile's "(no README)" was luck, and this fast-releasing package will outgrow the cap on npmjs too.
- **Two-leg fallback ladder**: `npmPackumentReadme` now tries `/latest` internally (public signature and `{readme, repo}` shape unchanged) — leg 1 fetches the KB-sized version document (immune to oversized packuments; URL shape per the npmLatest precedent; **timeout tightened to `Math.min(timeoutMs, 5_000)`** like npmLatest's first leg — worst-case fallback latency drops from 40s to 25s) and short-circuits on a non-empty readme; empty/failed falls through to the packument leg (full 20s, unchanged 0.9.45 behavior). Any successful leg wins: an empty readme renders "no README" (including the degraded blank-latest + failed-packument case, no throw); both legs failing throws the terminal (packument) error. Both legs hit the effective registry (ADR-0012), never cross-source; both legs share the same trim-based emptiness rule; repo follows whichever leg was reached (packument wins when it responds).
- **Profile-aware not-installed copy**: `readInstalledPluginReadme` gains a third parameter profileName (default 'web'), and the host-api readme branch passes `profile.name` — the desktop profile now reports "desktop profile 未安装该插件: X" (shape aligned with the profile-ops precedent); the "web profile" copy in web-transaction-only paths (market/toggle/profile-transaction) is intentionally unchanged (desktop delegates to the official pluginManager and never reaches them).
- **Fallback failure summary (semantic revision of 0.9.45's "rethrow the original local error")**: when both legs fail, the error becomes `<local error>（npm README 兜底失败: <terminal leg reason>）` — the real cause (e.g. the over-cap 502) is no longer swallowed; the original local error is preserved as `cause`.
- **Testing**: versions.test.mjs describe rewritten as a ladder suite (explicit registry across both legs, default-registry shape assertions, latest short-circuit, empty-readme fallthrough, latest-failure recovery, blank-readme degradation, terminal-leg error, both-empty, tightened-timeout deps spy, repo-normalization note), asserted red→green throughout (red set {2,3,4,6,8,9} matched the plan case by case); installed.test.mjs adds a profileName case; host-api.test.mjs extends the readme case and adds profile.name pass-through plus composed-error shape cases. Full suite shows zero new failures (existing Windows symlink-family baseline exempt); typecheck clean.

### Added in 0.9.49 — installed-view repo base + three link normalizations (follow-up to the 0.9.48 deep-dive)

- **Installed-view base wired through (P0, the main gap)**: the 0.9.48 installed-detail mount passed a non-existent `it.github`, and installed plugins take the local-read path (the `repo` field only rides on the npm fallback) → every relative link in installed READMEs collapsed to `#`. Now passes `vm.githubRepo` — the ready three-level fallback in the installed view model (registry match `registryGithub` → installed package.json `repository` parse → install spec `github:o/r` parse), which the icon and LinksRow already consumed. Relative links and images now anchor in the installed-browsing scenario too.
- **Link normalizations (P1)**: ① protocol-relative `//host/x` gains `https:` — previously mangled into a repo path with a base, or pointed at the DSH origin without; ② inline `git@github.com:o/r(.git)` links normalize to https form (clone-instruction paragraphs); ③ with a base, `#anchor` anchors to `github.com/<o>/<r>#anchor` (same-name anchor on the repo home README; bare `#` and the img kind do not participate).
- **Host-side parse alignment (P2)**: `githubRepoFromRepository` tail relaxed from `$` to `[/?#]` — `github.com/o/r/` (trailing slash) and deeper paths like `…/tree/main` previously failed to parse; now aligned with versions.ts `extractGithubRepo`.
- **Testing**: 4 new cases in client-markdown (protocol-relative both modes, git@ two shapes, four anchor assertions incl. img kind), 1 new installed case (five repository shapes incl. trailing slash and subpath); the anchor assertion updated to the new behavior; full suite 1185/1185, typecheck clean. Client-only plus a read-only host passthrough — a page refresh takes effect.

### Added in 0.9.48 — README entity decoding + repo-base anchoring for relative paths (two fixes from 0.9.47 field feedback)

- **HTML entity decoding**: 0.9.47 parsed tags but left entities raw — standalone `&nbsp;` lines between badges (dsh-task-board-style READMEs) leaked literally. Named entities (nbsp/amp/lt/gt/quot/copy/mdash/arrows/fractions — 60+ common set) and numeric entities (decimal/hex) now decode; both text runs and HTML attribute values decode (badge src `&amp;labelColor` → `&labelColor`, shields params no longer dropped); `code`/`pre` content stays literal; unknown entities and bare `&` are preserved; single-pass decoding without re-processing (`&amp;lt;` → `&lt;` as text, matching browsers). Decoded output only ever becomes text nodes — never re-parsed as tags, no injection surface.
- **Inline-first heuristic**: after unwrapping a block wrapper (`<p align="center">` etc.), if the inner content has no blank-line paragraph breaks, no markdown block structures, and every line starts with an inline/void tag, the whole block renders through the inline token stream — badges + `&nbsp;` flow on one centered line (GitHub semantics) instead of one paragraph per line; content with block structures (lines starting with `tr/td/ul/li` etc.) still goes through the markdown recursion to preserve structure.
- **Repo-base anchoring for relative paths**: relative links like `[README.md](README.md)` previously collapsed to `#` via safeUrl (inert click — long-standing normalization, not a 0.9.47 regression). The README preview can now carry a repository base: relative links anchor to `github.com/<o>/<r>/blob/HEAD/<path>`, relative images anchor to `raw.githubusercontent.com/<o>/<r>/HEAD/<path>` (`./`/`../` prefixes normalized); absolute URLs and in-page anchors are untouched; without a base the old `#` behavior applies. Data flow: the npm packument fallback now also extracts `repository`, normalized to `owner/repo` (GitHub only; git+https/git@/.git forms normalized) and passed through host-api as `repo`; the client falls back to the card's `github` field; the render base is set per renderMarkdown call and restored on exit — no cross-render leakage.
- **Testing**: 6 new cases in client-markdown (four entity classes, standalone-`&nbsp;` badge block, code no-decode + attribute decoding, seven anchoring assertions, no-base regression + cross-render leakage); 1 new versions case (repository normalization in both shapes + non-GitHub → empty); full suite 1181/1181, typecheck clean; real-data end-to-end — dsh-TUI 25,926 chars zero leaks zero regression, the real task-board badge block renders three badges on one centered line with `&amp;` decoded, relative links anchor to blob/HEAD correctly. Client-only change — a page refresh takes effect.

### Added in 0.9.47 — embedded-HTML subset rendering for the README preview (GitHub-style READMEs no longer show raw tags)

- **Problem**: the README fold in the detail Modal (market/curated/installed) showed GitHub-style HTML-heavy READMEs (`<p align="center">` badge walls, `<img>` logos, `<details>` blocks — common in both the npm packument fallback and local reads) with every tag rendered literally, looking like mojibake. Root cause: the in-house markdown renderer never parsed HTML tags at all. The source content itself was fine — GitHub renders it normally.
- **Rendering subset (`src/client/markdown.js`)**: block-level wrapper tags (`p/div/center/blockquote/details/ul/ol/li/table/thead/tbody/tr/td/th/h1-6/figure/section/dl` etc.) are unwrapped and their inner content re-rendered as full markdown, preserving headings/lists/tables/fences; inline tags (`a/img/strong/em/del/code/kbd/mark/sub/sup/u/small/span/br/hr` etc.) are tokenized into React elements; `align` maps to `textAlign`; `<img width/height>` maps to explicit size and lifts the 20px badge height cap (badges without width keep the small-image cap); `<details>/<summary>` render as native disclosure; ordinary paragraphs/headings/table cells whose text contains tags also go through the inline token stream (`Press <kbd>Ctrl</kbd>` renders properly).
- **Security model (invariant)**: raw HTML is never injected into the DOM — only whitelisted tags with whitelisted attributes are parsed, everything is built via `h()` React elements, and URLs pass the `safeUrl` gate (`javascript:` etc. collapse to `#`); unknown tags are unwrapped keeping their text, `script/style/svg/iframe` containers are dropped together with their content, and a recursion depth guard (>8) degrades to plain text. No `dangerouslySetInnerHTML` — no XSS surface.
- **Known limits**: the npm packument fallback carries no repository base URL, so relative-path images (e.g. `docs/assets/logo.svg`) collapse to `#` via safeUrl and hide on error (externally hosted badge images are unaffected); inside `<picture><source>` the source branch is dropped and the `img` fallback kept.
- **Testing**: 10 new cases in `client-markdown.test.mjs` (block unwrap recursion, badge rows, inline mix, script dropping + `javascript:` neutralization, unknown-tag unwrap, details/summary, whole-document div wrapper, HTML tables, HTML headings + inline elements, unclosed-tag degradation + depth guard); the real dsh-TUI README (25,926 chars) renders with zero tag leaks and 64 badge links constructed; full suite 1175/1175, typecheck clean. Client-only change — a page refresh takes effect.

### Added in 0.9.46 — bilingual README restructure + live-captured WebP screenshot set (docs release)

- **README×2 restructured**: zh-CN 17.5KB → 8.3KB, en 18.1KB → 9.4KB — reorganized around the user's task flow (quick start → browse/search/install → installed & settings → agent tools & CLI → compatibility & FAQ). Fetch-chain and cache-semantics details no longer live here; they are delegated to [`docs/DESIGN.md`](docs/DESIGN.md) and the ADRs. Runtime-phase / takes-effect wording now matches the activation-bucket semantics (no hard promises of "always restart" or "always refresh" — follow the operation result).
- **Screenshot set (`docs/images/`, 8 WebP ≈248KB)**: marketplace home, community category strip, curated category strip, cross-catalog search (curated hits first, community grouped), plugin detail (not-installed state with install action), installed management, and settings are all re-captured from the current live Web instance; the official install-dialog shot is retained. The installed shot redacts the host's absolute profile path.
- **New `scripts/capture-readme.mjs` (development-only, not shipped in the npm package — `assert-pack`'s scripts/ deny-list keeps enforcing that)**: drives the running Web instance read-only via playwright to reproduce the full set (`npm run capture:readme`); performs no install/upgrade/toggle/uninstall — browsing and modals only; every shot first asserts no unredacted absolute profile path inside the panel. New devDependency `playwright-core@1.62.1` (pinned to the official registry resolution).
- **Verification**: typecheck clean; full suite 1165/1165 (one process-tree termination timing assertion flaked once under concurrent load; passed both in isolation and on a full rerun, with no runtime code changes); `npm pack --dry-run` + `assert-pack` allowlist green; each README's 8 WebP references match files one-to-one — nothing missing, nothing unreferenced.

### Added in 0.9.45 — market two-phase loading + force probe passthrough + curated-zone motion batch

- **Market two-phase loading ([ADR-0013](docs/adr/0013-market-two-phase-probe.md))**: browsing market queries split into two phases — phase 1 sends `probeMode:'cache-only'` (TTL-fresh cache hits only, zero network, instant page), and only when gaps exist (`latestComplete=false`, community github entries exempt — a Q46 permanent gap is never a phase-2 reason) does phase 2 run the existing probe semantics to patch badges in place. First open after a DSH restart is no longer blocked by a full-page re-probe (8–16s on weak networks → always instant page + async badge completion). `mergeLatestFields` keeps badges from regressing during in-session filter switches; snapshots are written at terminal states only. The server-side latest cache stays memory-only (ADR-0006 untouched); the tools/CLI `withLatest:false` path is unchanged.
- **Force probe passthrough (reopens ADR-0006's deferred ruling)**: the settings-page "Force refresh" gains the onForceMarket → marketReloadAll(true) → core "peek old values as fallback + full-page re-probe" chain — strictly honoring ADR-0006's on-record constraint ("peek without delete, not ttlMin=0 delete-then-probe"); a failed re-probe keeps old values + latestError with no empty-badge window, and one click now refreshes both the curated list and the update badges. Market probeMode has exactly two values (full/cache-only) — no 'only'.
- **Detail Modal upgrade motion (U10)**: installed-and-outdated entries get a primary "Upgrade" button in the Modal actions (both the market and favorites mount points; record.target = installed package name, routed through the ops pump with 0.9.22 activation-based messaging; guard/opSuperseded/generic failure branches aligned with the Installed tab); a README fold (fetched on expand, zero requests while collapsed); "Added" date localized via fmtDate. **Fix (found in real-machine acceptance)**: the fold originally reused the Installed tab's local-read endpoint, so every not-installed entry (the majority of market browsing) errored with "web profile 未安装该插件" — not-installed entries now fall back to the npm packument top-level readme field (HTTPS/8MB cap/timeout; a missing readme field renders "no README"; a failed fallback surfaces the original error honestly), while installed entries keep the local read.
- **Error recovery & empty states (U9)**: inline "Retry" button on the error row (previously only panel reopen or a detour to Settings); three-way empty copy — registry-unavailable primary message / curated-bucket-specific message / generic.
- **Favorites identity (U12)**: favorite snapshots store verified/audience/decoupled (stored but not labeled — DESIGN §2.7 ruling ⑤ "favorites stay unmarked" untouched); curated entries in Favorites regain a "Curated" identity badge plus the "Verified" quality badge (previously they lost even the Curated marker).
- **Accessibility & misc (U8/U3/U7)**: Detail Modal gains role=dialog/aria-modal/aria-label and initial focus on the close button; screenshot lightboxes open via keyboard Enter/Space (focus trap explicitly out of scope); zero-count curated buckets render an explicit "0" at reduced opacity; the chips row gets a title explanation whenever cross-bucket double counting pushes Σchip counts above the total.
- **Tests**: new cases and assertions across market / host-api / client-market-state / client-render-smoke (two-state probeMode and force peek semantics, gap exemption, cache-only outdated, mergeLatestFields, two-phase and force-refresh wiring, Modal upgrade/README/a11y, favorites badges, zero-count chips); on this Windows machine the full suite has zero new failures beyond the 15 pre-existing symlink-family baseline cases; typecheck clean.

### Added in 0.9.44 — plugin card grid adapts column count to available width (more cards in fullscreen)

- **Adaptive grid**: the card grid shared by the Market / Installed / Favorites views switches from a fixed two-column layout to container-width adaptation — `grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))`. Column count ≈ `max(1, floor((W+8)/368))` (360px min card width, 8px gap, remaining width split evenly): the floating panel (~920px) keeps its 2 columns with zero regression; fullscreen at 1920px shows ~5 columns and 1280px shows 3 — noticeably more plugin cards on screen.
- **Viewport breakpoint removed**: the `@media (max-width:680px)` single-column override is gone — viewport width does not describe the width actually available to the panel; very narrow containers fall back to a single column via `min(100%,360px)` without horizontal overflow.
- **Scope and edges**: search group headers (`.dsvm-grouphead`) still span the full row via `grid-column:1/-1`; client-only change — refresh the page to take effect.
- **Tests**: 1 new SSR smoke regression case (locks the adaptive grid rule and the breakpoint removal); typecheck clean.

### Added in 0.9.33 — self-dev entry metadata v1.1: `audience`/`decoupled` fields with three-surface marking

- **Schema**: registry entries gain optional `decoupled?: true` (decoupled entries, operational criterion; mutually exclusive with `verified` — co-occurrence is an error) and `audience?: 'public' | 'internal'` (defaults to public, no key emitted; `'team'` reserved, not accepted this release). The decision record and five rulings live in DESIGN §2.7; terms in GLOSSARY (Decoupled Entry / Internal Entry).
- **Three-surface marking**: GUI cards and the Modal head gain 「作者自用」 (Author's own) and 「版本无关」 (Version-independent) badges plus Modal audience/compat rows; `dshm_search` output projects `audience`/`decoupled` with an inline [作者自用] line marker, and the tool description states the recommendation discipline (never proactively recommend internal entries to general users unless named or for internal rollout); CLI `dshm search` marks lines identically (new `tests/cli-search.test.mjs`). Installed views and favorites stay unmarked — the discovery path is the discipline's target.
- **CI**: validate-registry gains a soft warning — a decoupled entry whose description contains the 「已适配」 pattern (copy-guide §4 fourth pattern 「版本无关，详见仓库」, compact form 「版本无关。」 when space is tight).
- **Registry data**: final state for the eight self-dev entries — surf / obmc-web / onetree-log gain `decoupled`＋`audience: internal`, quota-watch gains `decoupled`; the four `verified` arrays are removed (history lives in git and per-repo docs) and compatibility sentences switch to the fourth pattern; the four coupled entries (dsh-m / dsh-skins / skip-browser-auth / copilot-auth) keep verified as-is.
- **Tests**: 9 net-new cases (registry validation 5, tools-search marking 2, cli-search 2); full suite 1133 tests, locally 1108 pass / 15 fail — all 15 are the pre-existing Windows symlink-semantics baseline (item-for-item identical, zero regression); typecheck clean.

### Added in 0.9.32 — npm registry route adaptation: metadata prefetch source switching / mirror self-heal (ADR-0012)

- **Motivation**: on 2026-10-04 a Shanghai Windows desktop machine proved the metadata prefetch is hardcoded to registry.npmjs.org; intermittent timeouts aborted upgrades before pnpm was ever invoked (`fetch failed` / `The operation was aborted due to timeout`, with no operation log under `.plugin-manager/logs`), while npmmirror had already synced the target version. A Seoul (Tencent Cloud) box enjoys fast direct npmjs. Both machines must work with zero configuration.
- **Read-class routing (L1/L3)**: detection reads (`npmLatest` upgrade probe / `npmPackumentTimes` publish times) prefer the authoritative npmjs (first leg timeout tightened to ≤5s) and degrade to the effective source; fulfillment reads (`npmVersion` exact metadata / `npmPackument` warm) prefer the effective source. `npmPackument` previously ignored its registry parameter — fixed this release (explicit parameter now takes effect, pinned by tests).
- **L0 transport**: httpx now uses undici's own fetch with a self-built dispatcher (`EnvHttpProxyAgent` handed the resolved proxies explicitly) — metadata prefetch honours `HTTP(S)_PROXY` / `npm_config_*` proxies and is immune to host undici global-dispatcher pollution (dsh-market net.ts #742 family); `fetchLimited` gains a PUT method (sync primitive only); network failures carry a `via` context, and the failure digest renders 「(via <masked proxy>)」 only on proxy paths.
- **L2 mirror-lag self-heal**: on `NO_MATCHING_VERSION` whose registry field names npmmirror (structured recognition in the classification layer, judged on the full text — upper layers never regex) → on-demand mirror sync (`registry-direct.npmmirror.com/<pkg>/sync`, PUT) → the existing backoff retry (heal `B3_NPMMIRROR_SYNC`); the same ladder applies to `npmVersion` (404 → sync → wait 10s → same-source retry → npmjs fallback); latest cache is invalidated after a sync. `DSHM_MIRROR_SYNC=0` switches it all off.
- **New module `src/core/npm-route.ts`**: `DSHM_NPM_REGISTRY` override (highest priority, skips probing) > [.npmrc registry, npmjs, npmmirror]; probe-once (2.5s shared budget, single-flight, winner must return a complete body with version); decision persisted at `<cacheDir>/npm-route.json` (delete to re-probe); total failure falls back to npmjs in memory only (60s TTL then re-probe, never persisted). Effective-source switches invalidate both latest and packument caches.
- **Wire test seam migration**: the existing mock-`globalThis.fetch` seam moved to `_setWireFetchForTests` (versions / npm-integrity / registry-check; assertion and counting semantics unchanged).
- **Tests**: 41 new cases (L0 proxy parsing/wire forwarding/via/PUT, npm-route ×12, read-class routing, registry classification field, B3 sync, L4 digest, kill-switch ladder/integration, trailing-slash normalization); full suite 1128 tests — 1103 pass / 15 fail on this machine, all 15 being pre-existing Windows symlink-semantics cases (item-for-item identical to the pre-change baseline: zero regression); typecheck clean. Real-machine acceptance (in-window scoped self-published upgrade on the Shanghai box, `dshm outdated` on Seoul) ships with the release.

### Added in 0.9.31 — doctor desktop profile support (CLI exception + farmChecked semantics revision, ADR-0011)

- **Motivation**: a Windows desktop machine's report confirmed the core engine is profileDir-parameterized with no web hardcoding (materialized desktop layout detects as hoisted with farm=0 — the norm, not a short-circuit), yet the CLI's blanket `--profile desktop` rejection swept up the read-only doctor; desktop-only machines scanning a nonexistent web dir got an all-zero report.
- **CLI exception (doctor only)**: `dshm doctor --profile desktop` is allowed and routed to `desktopProfileDir()`, with a `[web|desktop]` tag on the first output line; HELP synced; **every other command's rejection of `--profile desktop` stays byte-identical** (pinned by regression tests) — desktop mutation management remains with the official Desktop plugin page.
- **Missing-dir hint**: when the target profile dir does not exist, suggest `--profile desktop` (an existing-but-empty legit profile is not flagged).
- **Host method untouched**: the doctor case was already active-profile agnostic — desktop hosts get it for free (new desktop-kind injection pin test); the `dshm_doctor` MCP tool stays deferred per ADR-0010 decision 3; on Windows Electron hosts runtimeVersion may still degrade (materialized layout means farm=0, so stale has nothing to judge — zero practical impact, recorded honestly).
- **farmCount semantics revision**: "0 = walk short-circuited" applies only to shapes with a symlink farm; 0 is the norm for materialized layouts (ADR-0011).
- **Verification**: 8 new cases (desktop routing/tag, other-command rejection, invalid value, missing-dir hint, no-hint-on-normal, explicit-desktop no contradictory hint, explicit-web routing, method pin) + 1 rewritten legacy rejection sample (net +8, 1079→1087); full suite 1087 pass / 0 fail / 0 skipped; typecheck clean. The Windows on-machine acceptance checklist ships with the implementation plan (no Windows E2E possible on this machine).

### Fixed in 0.9.30 — bin symlink silent no-op (F2) + realpath third source for version resolution (F1)

- **Shared root cause**: two critical pnpm-ecosystem entry points are **symlinks** — `node_modules/.bin/dshm` (→ lib/cli.js) and the global shim `PNPM_HOME/dsh` (→ the real bin.js) — while both code sites made path-identity decisions before realpath.
- **F2 (latent since the bin entry shipped in v0.2.0; first hit and proven on this machine's 0.9.28 install shape; 🔴 every command via the bin entry silently exits 0)**: cli.ts `invokedDirectly` compared `argv[1]` (link path) against `import.meta.url` (node's realpath) — never equal, so `dshm <any command>` printed nothing and exited. Fix: realpath `argv[1]` before comparing. New `tests/cli-bin-symlink.test.mjs` (revival via symlinked --help and doctor --json; EPERM environments skip per repo precedent).
- **F1 (proven at 0.9.29 install acceptance)**: dsh-version.ts `readLauncherPackageVersion` walked up three levels from the shim location, landing in the pnpm home tree — pure-FS version resolution was unreachable under this host topology (`node PNPM_HOME/dsh web`), degrading doctor's stale judgment and forcing the ping chip onto the spawn fallback. Fix: realpath the entry after the shape check, then walk (locally verified resolving 0.2.0-rc.2). New shim-shape case in dsh-version.test.mjs.
- **Verification**: targeted 9/9 (two new cases); full suite 1079 pass / 0 fail / 0 skipped; typecheck clean. Post-install expectations: `dshm doctor` works via the bin entry; host method path reports runtimeVersion=0.2.0-rc.2 with stale judgment live (the farm's dsh link at 0.1.7-rc.2 is a ready-made stale form until healed).

### Added in 0.9.29 — profile Doctor: `dshm doctor` (read-only: farm liveness / residue inventory / manifest-reality consistency)

- **Motivation**: dsh-m had no diagnostics at all — know-how 014's "re-run farm liveness after every DSH upgrade" was the only standing periodic check (81 dangling links and a 230-line manual heal log), know-how 023 documented the manifest-reality split, and a live scan found 8 empty scope dirs + 12 `*.bak-*` files. Day1 subset adopting dsh-market check.ts's design disciplines (pure-FS boundary, three-tier severity, unknown≠broken, false-positive bookkeeping, repair responsibility shifted outward). See ADR-0010 and the comparison report (2026-10-04).
- **Added**: `src/core/doctor.ts` pure-function core (no processes, no network, no writes — safe to call any time) + new `/dshm` method `doctor` + CLI `dshm doctor [--json]` (exit 1 on error-tier findings; HELP synced). Three checks: **farm liveness** (ancestor-chain walk over `@deepseek-ai/*` symlinks; dangling = error; dsh umbrella pointing at an old runtime store = info-tier — non-umbrella versions are never compared against the runtime version, avoiding cordis-style false positives), **residue inventory** (empty scope dirs / no-manifest dirs / pnpm `*_tmp_*` / `*.bak-*`, all zero-alarm lists, "visible rather than cleaned"), **manifest-reality consistency** (pin vs installed vs lockfile; mismatch = warning; only lockfileVersion 9.0 importers shape is parsed, anything else stays unknown).
- **Boundary disciplines (ADR-0010)**: runtimeVersion comes only from the pure-FS `readLauncherPackageVersion` (null under the CLI → stale judgment degrades to unknown, never spawns); the secrets red line covers credential-bearing config files only (package metadata version fields are readable); layout detection is workspace-declaration-first (proven on the local "hoisted declaration + vestigial lock.yaml-only .pnpm" shape); dual-market coexistence (dsh-m + dshmarket installed together) surfaces as an informational fact; doctor never repairs — advice is text only.
- **Acceptance anchors (to verify after install)**: first local run expects farmChecked ≈236 (0 means the walk short-circuited), 0 dangling, 8 empty scopes + 12 bak files listed, dual market flagged.
- **Verification**: new `tests/doctor.test.mjs` (36 cases) + `tests/doctor-api.test.mjs` (2 cases); full suite 1076 pass / 0 fail / 0 skipped.

### Changed in 0.9.28 — page-size set de-upstreamed: 32/64/96 replaces 24/48/96, default 32

- **Motivation**: 24/48/96 came bundled with the dsh-market filter-panel replica (0.7.2). On inspection, 96 has long been internalized as a dsh-m core parameter (`WITH_LATEST_MAX` probe cap, primary-zone default page, fast-open snapshot baseline); the only real upstream trace is 24 — "drop 24, keep 96" is exactly the intersection of de-upstreaming and compatibility.
- **New set**: `MARKET_PAGE_SIZES = [32, 64, 96]` (arithmetic +32), community default `DEFAULT_PAGE_SIZE = 32` (fuller first page, still below the 0.6.x default of 50 in probe load; Q46 posture unchanged); primary default 96 and the core clamp 1..96 untouched.
- **Ripple**: host-api GUI fallback default 24 → 32 (three ends consistent, no hidden default); probe-budget comments updated (market.ts / host-api.ts); README×2 and DESIGN.md wording synced; GLOSSARY "Primary Zone" entry sharpened to match the code (single-page-no-pager → normally single page, degraded to the community pager beyond capacity); test assertions and snapshot fixtures synced (off-default assertions now use in-set value 64, covering "in set but not default is still rejected/false").
- **Known one-time impact**: after upgrading, a community snapshot with limit=24 no longer matches the fast-open check — the first market open makes one extra normal request, then the snapshot rebuilds on the new default; no legacy-compat branch added.
- **Verification**: `npm run build` clean; full suite 1030 pass / 0 fail (8 skipped).

### Changed in 0.9.27 — fix accidental drag-out close: press inside, release on backdrop no longer closes the panel

- **Problem (observed on install, 2026-10-03)**: pressing inside the market search box and dragging left past the panel edge closed the whole panel. Not a browser mouse gesture — the panel backdrop used a bare `onClick: onClose`; when a press inside the panel content drags onto the backdrop and releases, the browser dispatches `click` to the common ancestor of the press/release targets (the backdrop itself), misread as "clicked the backdrop". The detail modal, screenshot lightbox, and compat dialog shared the same defect class.
- **Fix**: new pure helper `backdropCloseHandlers` (src/client/backdrop.js) — close only when **both mousedown and click land on the backdrop itself** (all other combinations are ignored; the pressed state resets after each click); all four overlays (main panel/detail/lightbox/compat dialog) switched over. Backdrop-click close, Esc, and the ✕ button behave exactly as before.
- **Verification**: new `tests/client-backdrop.test.mjs` (close / two drag-out scenarios ignored / state reset / malformed input safe — 5 assertions); full suite 1030 pass / 0 fail.

### Changed in 0.9.26 — curated hits first in cross-zone search: summary counts now match page one

- **Problem (observed on install, 2026-10-03)**: searching "sidebar" showed "⭐ Curated 3 · Community 315" but only one curated card on the first page. Not double counting — `sourceCounts` never reads category counts (`alsoCategories` is unrelated) and all 3 were genuine curated hits. The mismatch: the summary line reports global hit counts while the relevance ranking plus the community zone's default downloads-desc tie-break pushed weakly-matching curated entries onto later pages.
- **Fix**: `listMarket` gains `curatedFirst` — with `source='all'` and a non-empty query, curated hits are stably moved to the front (stable partition; relevance order preserved within each segment, community hits follow). Carried only by the host-api GUI channel — tools/CLI don't pass it, so the shared search ordering across the three surfaces is unchanged; single-zone and browse states are naturally unaffected. Dangling cross-page section headers and the count mismatch disappear (with curated hits ≤ page size, all of them land in the first-page section).
- **Verification**: new test ⑮ (no flag keeps the interleaved relevance order / flag moves curated first / empty query and single-zone are no-ops); full suite 1025 pass / 0 fail.

### Changed in 0.9.25 — cross-zone search: browsing stays zoned, searching goes global (community + curated together)

- **Cross-zone search**: either zone's (Community/Curated) search box now searches globally — with a non-empty `query` the underlying query switches to `source=all` and both zones' entries are ranked by the shared relevance pipeline; clearing the keyword returns to the zone's own browse state. The zoned browsing model (ADR-0004) and the `dshm_search`/CLI shared ordering are untouched; the only server-side addition is the `MarketResult.sourceCounts` bucket count.
- **Search-mode presentation**: a summary line "⭐ Curated N · Community M" with exact per-zone counts (`!loading`-gated so stale numbers never flash); curated hits grouped on top within the page (section headers render only when their section is non-empty, spanning both grid columns); non-community cards gain a "Curated" badge; category chips hide during search while the Filter button moves onto the summary line (page-size group only — relevance outranks sort while searching); the pagination scroll anchor follows the mode.
- **Fixes**: zone tab counts now derive from stable fields (community = `acceptedCount - displaced`, curated = `registryState.count`) instead of "the last query's total" — cross-zone searches no longer pollute them; committing a search clears the active category (chips are hidden, so a leftover category would act as an invisible filter).
- **Degradation**: a missing/malformed `sourceCounts` hides the summary line entirely; list behavior unchanged; old snapshots/old host responses stay shape-drift immune.

### Changed in 0.9.24 — release-age exclusion governance: from pre-flight refusal to govern + register (ADR-0009)

- **Problem (observed live 2026-10-03)**: the 0.9.19 pre-flight precheck predicted "the official manager will block a target inside the 24h release-age window" and refused up front — while dsh-market installed the very same targets (copilot-auth@1.2.4 published 8 minutes prior; quota-watch@0.1.21). pnpm 11.7's default non-strict policy admits explicitly named fresh releases and auto-registers their exclusion entries; the wall the precheck predicted did not exist.
- **Three governance hooks**: (1) pre-delegation govern — merge malformed exclusion shapes (pnpm's auto-appended dead rules) into "one rule per package, version union"; (2) post-success register — fold in-window targets into the exclusion block (scoped exact / non-scoped target+previous composite); (3) on dual-code failure (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` / `ERR_PNPM_NO_MATURE_MATCHING_VERSION`) → govern → retry the command at most once, then fall through to the existing failure translation. The web ladder gets the same three hooks.
- **Boundary & safety**: the red line narrows by exactly one exception (desktop: this block only, delegation hooks only, atomic write, parse-failure bail-out, tracing without file dumps); govern/register hold the official same lock and fail open — any failure never blocks delegation, pnpm stays the final enforcer; profiles that explicitly set `minimumReleaseAge` or `minimumReleaseAgeStrict` still get refused up front with a retry time; the mechanism verdict follows "first rule wins" (know-how 020 §2.4 form-theory retired).
- **Docs**: full decision record in `docs/adr/0009-release-age-exclude-governance.md` (with a fence appendix of 9 evaluated-and-skipped items and the observation contingency); GLOSSARY terms "First Rule / Release-Age Exclusion / Govern / Register / Release Age".

### Changed in 0.9.23 — two-phase Installed tab: instant list + update hints filled in place (ADR-0008)

- **Problem (observed live 2026-10-03)**: update probes were welded into the installed-list endpoint behind a 60-min in-memory TTL — after publishing a release, reopening the panel served the stale cache and update hints lagged (quota-watch's new version stayed invisible 17 minutes after publish while dsh-market already showed it).
- **Two parallel phases (zero new buttons)**: phase 1 `installed {probe:false}` returns the installed list immediately (registry matching and toggle phase untouched); phase 2 is a new `installedUpdates` method (`probeMode: 'only'`, **TTL=0 — a real probe on every panel mount**) that fills in ⬆ badges / the tab dot / "Upgrade all (N)" in place; failed checks still surface per item as "check incomplete" instead of pretending "up to date".
- **Scope & side effects (documented in ADR-0008)**: installed tab only — browse-page probes, `dshm_list`/`dshm_outdated` tools and CLI are unchanged (default `probeMode: 'full'`); ttl=0 evicts shared host-namespace cache entries before re-probing, so browse/tools TTL hits receive fresher write-backs (data only gets fresher; code paths and their own TTL regimes unchanged); GitHub passive budget consumption rate rises (limits unchanged: 25/req, 50/h rolling) with graceful `latestError` degradation.
- **Docs**: full decision record in `docs/adr/0008-installed-two-phase-probe.md`; DESIGN notes on the installed page / cache semantics; GLOSSARY term "Two-phase Load".

### Changed in 0.9.22 — upgrade activation classification (tarball diff, three states) + three-surface restart-hint split (ADR-0007)

- **Problem (observed in 0.9.21)**: after upgrading `@iasiv5/dsh-skins` 1.2.3→1.3.0 the plugin was already live without a restart (client bundle rev hot-reload), yet all three surfaces still said "restart required" — the noise trains users to ignore the hint, and restarts have real costs (web service blip / manual desktop reopen).
- **Activation classification** (GLOSSARY「生效判定 / 纯客户端更新」): npm-source upgrades now fetch both tarballs at the success point (parallel, 10s total deadline, 8MiB per tarball, no cache), parse them with a zero-dependency read-only ustar reader (pax long names supported) and classify by per-file sha256 diff into `activation: 'client-only' | 'restart-required' | 'unknown'`. Five rules: client set = `exports['./client']` target; a changed `dsh.bundle.patch`-declared patch file → host; `package.json` compared semantically with the top-level `version` ignored (dependency changes still count as host); every other added/removed/changed file attributed by path; a changed client pointer conservatively counts as host. **Fail-open**: any error → unknown → current conservative hint, never affecting the upgrade's success.
- **Three-surface split**: the agent tool message for `client-only` says a page refresh suffices and explicitly forbids offering `dshm_restart`; the GUI toast gains a suffix and its restart banner gate follows `needsRestart` (pure helper `upgradeNotify`, unit-tested); the CLI line switches accordingly. `needsRestart` widened to boolean at the source (TS2430 avoidance); `UpgradeResult` and the desktop upgrade result carry the new `activation` field; wired at `upgradePluginLocked` + `desktopUpgradeLocked`; selfUpgrade/install/uninstall/github sources unchanged.
- **Tests & docs**: 11 new ustar parser cases, 18 classifier rule/fail-open cases, 7 upgrade-wiring cases (npm/github/selfUpgrade/desktop), 4 renderUpgrade cases, 3 upgradeNotify cases; existing upgrade fixtures gained a `classifyActivation` seam (no implicit network). Full decision record and known limitations in `docs/adr/0007-activation-classification.md` (no client chunk require-graph tracking; docs-only diffs conservatively count as host).

### Changed in 0.9.21 — Settings force-refresh display fix + automatic jsDelivr purge on registry.json changes

- **Settings force-refresh display fix (observed live 2026-10-03)**: the Settings tab's "Force refresh" only reloaded the `registry` API (synchronous full-chain force fetch), but the panel renders the registryState **from the `registry-config` snapshot taken at mount** — so the toast said "Registry force-refreshed" while source / fetched-at / entry-count stayed frozen until the settings tab was remounted. A successful force refresh now also reloads `registry-config` (force already updated the controller's in-memory snapshot, so this costs nothing) and the display follows the live data immediately.
- **Automatic jsDelivr purge (new `purge-jsdelivr` job in `registry.yml`)**: the default chain's "sticky route + CDN always answers 200" combo lets a lagging jsDelivr snapshot **pin the curated list indefinitely** — observed: after 0.9.18 added DSH Market (18→19), a machine sticky to jsDelivr kept receiving the 18-entry snapshot; the raw primary route was never retried, and even the user-facing force refresh could not escape (only a manual `purge.jsdelivr.net` call fixed it). Now a push to main that actually changes `registry.json` (diffed against `github.event.before`) triggers a CDN purge **after** `validate` goes green, re-reads the CDN to verify the entry count, and writes both into the step summary; pushes without registry.json changes and PRs skip the job entirely.

### Changed in 0.9.20 — latest probe cache back to memory-only (restart invalidates) + mutation-scoped invalidation (ADR-0006)

- **Post-mortem landed (night of 2026-10-03)**: since 0.9.14 the latest-version probe cache was written through to disk and survived restarts, with TTL as the only invalidation channel — after a cache write at 00:22:58, four releases (00:27–01:05), a DSH restart (01:07) and a panel reopen (01:13) all served the stale value; cards and `dshm_outdated` both wrongly reported "up to date". That design is overturned; the full decision record lives in `docs/adr/0006-latest-cache-memory-only.md`.
- **Memory-only cache**: probe results now live in an in-memory Map + TTL (`cacheTtlMin`, default 60) — **a DSH restart drops them**, so "publish, restart, see the new version" works again. The cost is one bounded re-probe wave on the first open after a restart (current page, 8 workers + deadline cap, paid once per TTL window); the registry/community **catalog body** disk cache and SWR are untouched, so the page skeleton still opens instantly. Leftover inert `latest/<ns>.json` envelopes from 0.9.14 are swept once, best-effort, before the probe segment.
- **Mutation-scoped invalidation**: on **success** of install/upgrade/uninstall, the entry's cached latest value is invalidated across all registryKey variants (browse key / installed matched key / npm-only key) by itemId — no more "installed new / latest old" self-contradicting cards; `dshm_outdated` is honest about freshly upgraded packages. Invalidate-only, no writeback (a deliberate old-version install would otherwise fabricate latest = installed); rollback paths never invalidate; uninstall invalidates npm keys on a best-effort basis (a `gh:` key cannot be reconstructed from a pkg name and expires via TTL).
- **Not done, on record**: force passthrough of the probe cache and browse-page GitHub budget alignment were deferred by the owner — the former's residual blind spot is only the "no restart, within TTL" window; the latter has zero benefit for today's all-npm curated list (ADR-0006 §Considered Options).

### Changed in 0.9.19 — supply-chain release-age: pre-delegation gate, full violation parsing, split-state disclosure

- **Root cause (observed 2026-10-03 00:15 on this machine)**: pnpm 11.7 runs a **lockfile-wide** supply-chain verification on desktop installs (`Verifying lockfile against supply-chain policies (180 entries)`), and the standalone exact `minimumReleaseAgeExclude` entries it auto-appends after each successful install are **not honored by that verification when unscoped** (`dsh-m@0.9.18` flagged; scoped `'@iasiv5/dsh-quota-watch@0.1.13'` honored) — so one freshly installed version bricks every package operation for 24h, regardless of the current target. The target package gets written into node_modules before the verification fails while the official manager rolls back only manifest/lockfile → **"split state"**: the UI shows the new version active, the operation record says failed, and the next operation silently downgrades the plugin.
- **Pre-delegation gate (`releaseAgePrecheck`; read-only, fail-open)**: npm installs/upgrades now check the target version and untrusted lockfile exclude entries against registry publish times **before** delegating; anything inside its waiting window is refused up front as structured `release-age-wait` with per-entry ready times — no more half-written states. Missing publish data / unreadable policy / entries covered by effective selectors (package-level, `||` compound, scoped standalone exact) → proceed; pnpm remains the final enforcer.
- **Failure translation rewritten** (replacing the 0.9.10 single-match parser): all violations are parsed and reported as "target vs lockfile bystanders" with their own publish times and retry deadlines; the misleading "install via DSH Web instead" hint is gone. `DesktopOpsError` gained structured `details` (violations/targetViolating/splitState/blockers).
- **Split-state re-read**: after a release-age failure the installed state is re-read; when node_modules already holds the target version while the manifest still records the old one, the error explains the upcoming silent downgrade and how to converge.
- **Wiring**: desktop install / self-upgrade call sites now pass `profileDir` (upgrade already did).

### Changed in 0.9.18 — DSH Market added to Curated + README restructure, changelog extracted

- **DSH Market added** (npm `dshmarket`, Curated 18→19): a third-party visual plugin market — browse, search community plugins, and one-click install; one-click live theme switching. Primary bucket Essentials, secondary Cui's Picks (via `alsoCategories`). Copy follows the registry guide; third-party entries carry no `verified` claims.
- **Docs restructure**: README/README.en rewritten into a lean shape (highlights, TOC, requirements, documentation index, support-matrix FAQ); the recommended install path is now DSH's official plugin manager (with a screenshot and the upgrade caveat); this changelog moved out of the READMEs (bilingual); the Desktop FAQ reflects the post-0.9.8 capability table; DESIGN §3/§12 gained live-verification and tested-generation records.
- **Also**: the registry guard test moved 18→19; CHANGELOG.md now ships in the npm package (package.json files).

### Changed in 0.9.17 — secondary curated-bucket membership (one plugin across buckets) + the "iasi自研" rename

- **Secondary buckets `alsoCategories`**: curated entries can now declare a secondary curated bucket — chip counts and bucket filtering count "primary ∪ secondary" (a cross-bucket entry appears in every bucket it belongs to), while the detail page's category labels still follow the primary bucket. First dual seats: **better-sidebar** (Essentials ⊕ Cui's Picks) and **dsh-m** (Essentials ⊕ iasi In-house); better-sidebar's former fifth "崔添翼精选" tag is replaced by the real seat (tags return to the ≤4 soft rule).
- **Rename**: curated bucket "我的自研" (My in-house) → "**iasi自研**" (slug `self-dev` unchanged; synced across chips / tools / CLI / detail labels).
- **Routine transition**: once the schema gains a field, old clients reject the new registry on validation → they fall back to cache / bundled snapshot and show old data; upgrading fixes it.

### Changed in 0.9.16 — curated five-bucket taxonomy + stricter curation (23→19) + DSH TUI added

- **Curated taxonomy**: the Curated zone's categories change from the functional five (Market/Tools/UI/Search/Other) to five curated buckets — Essentials / Cui's Picks / iasi In-house / Tencent Lighthouse / Watchlist (chips in this order, Tencent Lighthouse last). Category semantics shift from "what the plugin is" to "why it deserves curation"; overlapping membership is bucketed by priority Essentials > Cui's Picks > In-house > Tencent Lighthouse, functional attributes move into tags for search, and old category values still hit custom sources as open slugs (ADR-0004 revision).
- **Stricter curation 23→19**: the channel five (lark/qqbot/weixin/wecom/dingtalk) leave Curated — still listed and installable in the community layer (4,000+ entries), just off the curated stage; **DSH TUI** is added (Cui's 9/26 X recommendation: a terminal TUI client, `dsh-tui`, speaking the DSH client contract ctx.remote); better-sidebar is bucketed to Essentials by priority and keeps its 9/27 recommendation provenance via the "Cui's Picks" tag.
- **Same-version carry-over** (local enhancements folded into the release): desktop installs retry the enable stage once on failure (proven against high-frequency install/uninstall and plugin-tree reload races) + failure copy keyed precisely to packageResult; the market page's "cached snapshot" banner retires — stale status is now carried by the settings page's community card, and browse pages no longer show transient cache state.

### Changed in 0.9.15 — install progress/result now live inside the detail modal

- **Scenario**: clicking Install in the detail modal rendered all install feedback (the pnpm phase line, the "changes applied" banner/toast) on the panel layer beneath, half-visible through the modal mask — inside the modal the button just spun, with no sense of progress (live screenshot feedback, 2026-10-02). Uninstall never had this problem: no modal is involved and status already lives on the installed card.
- **Change**: while an install runs, the modal hosts the progress line itself (same host-status polling: phase / bar / current package); terminal states render an inline result row — success with version + build-script notes and a restart hint (desktop gets the official app lifecycle guide), failure / guard block with the reason and a re-enabled retry button, "skipped" presented neutrally; while the modal is open the underlying twin line steps aside (and returns once the modal closes). Everything still derives from the global operation log and the install result — the "state lives off cards" ownership model is unchanged (DESIGN §2.6).

### Changed in 0.9.14 (instant-open quartet + context-aware "Install command" row)

- **Instant-open quartet** — a fix combo for the marketplace spinner that used to show on every panel open:
  - **SWR (serve-stale-while-revalidate)**: expired TTL no longer blocks on the network — the disk cache is returned immediately as a snapshot (the community zone keeps its honest "cached snapshot" banner; never pretending to be fresh), a background single-flight refreshes it for the next open. "Force refresh" semantics unchanged (always synchronous; community card stays decoupled).
  - **Route stickiness**: the default two-route chain (GitHub raw → jsDelivr mirror) is ordered by the **last successful route** recorded in the cache — once the mirror has worked it goes first, instead of re-paying the raw timeout on every cold open (~10-20s saved per cold open on CN networks).
  - **Persistent probe cache**: per-page npm/GitHub latest-version probes now persist to a disk envelope (`latest/`, survives restarts) — no probe replay on the first open after a DSH service restart.
  - **Client snapshot**: the default first page is cached browser-locally (10-min TTL); opening the panel renders the last response first and refreshes in the background — the spinner now only appears on the very first use (no snapshot yet).
- **Detail modal "Install command" row is context-aware**:
  - **Scenario**: the row's derived command hardcodes `dsh plugin --profile web add …`, and community entries' upstream `install` text carries the same web-profile semantics — neither source looks at the current host profile. Copying it on Desktop installs into the web profile (invisible in the current UI); for already-installed entries the command is pure noise (live screenshot evidence: desktop + the dsh-m self entry, `installed` badge and the command on screen together).
  - **Change**: the row is hidden entirely on desktop and for installed entries; web + not-installed keeps today's behavior (the CLI bootstrap path, same command as Quick start). The sanctioned Desktop path is the modal's own Install button (official pluginManager delegation, ADR 0005 discipline). No "simplify by dropping --profile": the explicit `--profile web` flag is a settled 0.9.0 decision (see the "profile target" section), and a bare `dsh plugin add` has ambiguous default-profile semantics — not simpler, just worse.

### Changed in 0.9.13 — desktop chip hover copy updated (owner decision)

- The old copy "当前 DSH profile：{name}（Desktop 首发仅支持只读市场、安装新包与开关）" was stale after 0.9.8 opened upgrades/uninstall/self-upgrade; per owner decision it now reads "当前生效 Profile" (Active profile).

### Changed in 0.9.12 — re-issue of 0.9.11

0.9.11 hit a npmjs ghost publish: the OIDC publish was accepted and **staged** (CLI exit 0, provenance published to the transparency log) but never committed into the registry — GET 404, and re-publishing the same version is rejected with 409 `Cannot publish over previously staged version`. After waiting out any propagation, the standard workaround applies: re-issue under a new number. **Content is identical to 0.9.11: settings force-refresh no longer takes down the community catalog card.**

### Fixed in 0.9.11 — Settings "force refresh" no longer takes down the community catalog card (force semantics belong to the curated chain only)

- **Scenario**: on a weak network, clicking the curated registry card's force refresh also flipped the community catalog card to "unavailable / fetch timeout" — the host forwarded `force` into the community summary, restarting its fetch flight; under a weak network the flight couldn't finish within the 3s waiter, which returned the timeout placeholder (the flight itself keeps running under its 30s hard cap and self-heals).
- **Fix**: the `registry` force is no longer forwarded to the community summary — force semantics belong to the curated chain; the community catalog keeps its own TTL/shared-flight cadence (a first-ever load on a terrible network can still transiently time out, but force refresh no longer triggers it).

### Fixed in 0.9.10 — Desktop self-upgrade hitting the official supply-chain release-age policy now yields an honest wait guide

- **Scenario**: clicking the upgrade chip routes through the official manager, whose pnpm supply-chain policy (`minimumReleaseAge`, releases must age 24h before installation) rejected the just-published version — `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. **The policy is working as designed** (anti-supply-chain-attack release waiting period); dsh-m just dumped a screen of raw pnpm output as a generic failure.
- **Fix**: the manager-result judgment recognizes the policy code and translates it into an honest guide — naming the pending entry and its publish time, deriving when a retry will pass, and offering the interim path (install the same version from DSH Web). No policy bypass, ever (the waiting period is the anti-attack red line; same stance as dsh-market #732).
- Also: community chain ⑨ hang-cap assertion 2s→10s (timer starvation under the full parallel suite tripped it twice; the "never hangs forever" contract is unchanged).

### Fixed in 0.9.9 — No more red "primary route failed" notice once the mirror line took over (notice convergence)

- **Scenario**: with the default dual-line registry (raw → jsDelivr), when the primary `default-raw` failed and the mirror succeeded, the settings page still showed a red "Remote notice: default-raw 失败：fetch failed…可稍后重试或检查网络后重试" — alarming against data that had already self-healed, with advice that didn't apply (intermittent raw.githubusercontent.com unreachability is exactly why the mirror line exists).
- **Fix**: a later line succeeding means the earlier failure self-healed — `errors` no longer carries it (the "effective source" row already states the live line, e.g. "GitHub 镜像（备用）"). When ALL lines fail into cache/bundled, the errors are still kept — that's the actionable signal. The custom chain (custom source failing into cache) keeps its warning, unchanged.
- Added a test seam for the default chain (`defaultRoutes` override); regression gates cover both convergence and the keep-on-total-failure cases.

### Fixed in 0.9.8 — Desktop package operations fully wired to the official manager (install always failed; upgrade/uninstall/self-upgrade opened)

- **Why every install failed**: the Host API's desktop install branch called `desktopInstall(id, cfg, opts)` without the 4th `deps` argument — `getService` never reached the adapter, so desktop installs always failed with "official pluginManager service unavailable (fail-closed)" (100% reproducible, timing irrelevant). The `dshm_install` tool had the same defect.
- **Service resolution aligned with dsh-market** (borrowed from its official-desktop wiring, proven on this machine by two managed upgrades): the probe now checks both contexts (the hostCtx from the webServer inject callback first) and falls back to a short-timeout cordis `inject` to lazily wake the official service — `pluginManager` is lazy, so a one-shot `get` returns undefined until something used it. Only a genuinely absent service still refuses (the no-file-level-fallback red line is untouched).
- **Capability table widened (owner decision, following dsh-market strategy)**: desktop upgrade (installBundle over the installed bundle), uninstall (removeBundle) and self-upgrade (installBundle('dsh-m@latest')) are now delegated to the official manager — exactly how dshmarket performed the dsh-m 0.9.3→0.9.4/0.9.5 upgrades on this machine. Judgment discipline unchanged (application/stage first, overridden is not a failure, build-blocked returns structured pendingBuilds, listBundles re-read never fakes success). restart stays refused (Electron lifecycle belongs to the shell).
- All three entry points (GUI, installed-view actions, and the dshm_install / dshm_uninstall / dshm_upgrade tools) are wired in the same pass.

### Fixed in 0.9.7 — Upgrade chip on Desktop showed a red "upgrade failed" banner (capability refusal is guidance, not an error)

- **Root cause**: the 0.9.1 upgrade chip always calls `self-upgrade`; the Desktop capability table refuses by design with a structured 409, but the client rendered that 409 like any other failure — a red "upgrade failed" banner. Per the capability table this is not a failure, it's a pointer to the official entry.
- **Fix**: `api()` now forwards the structured refusal fields (code/action/profile/guidance); on a 409 the chip click shows a **neutral info banner** with the official-entry guidance (the guidance text's single source stays server-side in `active-profile.ts`, zero duplication in the client); info banners stay for 12s. Real failures on Web still use the red error banner — unchanged.

### Fixed in 0.9.6 — "Clear finished" silently no-opped on failed records

- **Root cause**: the 0.7.0 review consensus excluded failed/superseded records from clearing (kept for review), so clicking the button against a failed record did nothing with zero feedback — reported as a bug from the real Windows host (2026-10-01). An explicit clear click is not a "silent wipe"; the old consensus is overruled.
- **Fix**: "Clear ended" (formerly "Clear finished") now clears **all terminal states** (done/warned/failed/superseded); in-flight records (queued/running/input) are untouched. When there is nothing terminal to clear, the button is disabled with an explanatory tooltip instead of silently no-oping. The per-row ✕ still removes single records.
- English copy updated accordingly.

### Fixed in 0.9.5 — GUI read paths missed the active profile on Desktop (Installed tab always showed web)

- **Root cause**: the 0.9.0 dual-profile wiring missed the `installed` / `market` read paths in the Host API — `listInstalledWithMeta` / `listMarket` fell back to `webProfileDir()`: on Desktop the Installed tab always said "no plugins installed in this web profile" and the market "installed" badges stayed empty (the agent-tool surface `dshm_list` was wired correctly, so only the GUI was wrong).
- **Fix**: both now pass `profileDir: profile.dir` + `profile: profile.name` (same as the tools surface; profileContext as the single source of truth); registry/community cache segments follow the `profile` parameter automatically.
- **Copy**: the hardcoded "web profile" in the installed empty/loading states and the profile hint is now profile-neutral (the actual path is still shown).

### Fixed in 0.9.4 — Fullscreen header eaten by the Windows Desktop titlebar (tabs / restore unreachable)

- **Root cause**: on Windows Desktop the shell runs `titleBarStyle:hidden + titleBarOverlay` — the top 40px of the window is a full-width `-webkit-app-region:drag` band (drag hits are decided by layout and ignore z-index / paint order), and the OS-drawn — □ ✕ caption buttons float above everything. The maximized panel header landed inside that band: tab clicks were swallowed by window dragging and the restore/close buttons were covered by the system buttons — no way back.
- **Fix**: the same approach the shell uses for its own overlays — consume the `--dsh-windows-titlebar-height` variable the shell sets on `html` (fullscreen `top:var(…)`; floating `padding-top:max(24px,var(…))`, which also fixes the short-window edge case where the floating panel's top edge sat under the band).
- **Zero drift on Web**: browsers / DSH Web have no such variable — it falls back to 0px, byte-identical to 0.9.3.

### Fixed in 0.9.3 — Windows native support (verified on a real Windows host)

- **Registry atomic writes**: temp file names were derived with `split('/')`, but Windows paths separate with `\` — the "basename" came out as the entire path, the temp-file open always failed silently, and every cache / accepted-metadata write silently failed; now uses `basename()`, identical on all three platforms.
- **Local-file registry address parsing**: `C:\…` drive paths and `\\server\share` UNC were misread as URL schemes (with a misleading "HTTPS only" error), and `file://C:/…` normalized to a drive-less dangling path that always failed with ENOENT; all three local forms (POSIX absolute / Windows drive / UNC) now parse correctly as file kind.
- **Build**: `node_modules/.bin/tsc` is a POSIX sh shim; on Windows `spawnSync` failed with ENOENT — the build now runs TypeScript's JS entry with the current Node, identical on all platforms.
- **Test surface**: on a real Windows host the full 829-case suite went from 41 failures to **0** (821 pass / 8 skipped); POSIX-only contracts (process-group/SIGTERM timing, symlink privileges, platform path assertions, fixed-sleep timing) are now labeled skips, platform-neutral, or poll-based — test contracts unchanged.

### Fixed in 0.9.2 — Header chip stuck on the old version after a service restart

- **In-place refresh once the restart is confirmed**: the moment the boot id confirms DSH Web is back, the panel re-fetches ping — the `dsh-m vX.Y.Z` chip and the profile chip sync to the new process's data instead of lingering on the old version (observed on 0.9.1: chip upgrade + restart still showed v0.9.0).
- **Refetch when the page becomes visible again**: with the panel left open while the service is restarted externally, returning to the tab refetches ping via `visibilitychange` (zero polling cost).
- **Chip version guard**: a self-check verdict whose version doesn't match the current process (stale verdict from the old process) is treated as silent, preventing "v0.9.1 ⬆ v0.9.1"-style misrenders.

### New in 0.9.1 — Header version chip upgrade notice (lights up only when an update exists)

- **Silent by default**: the panel-header `dsh-m vX.Y.Z` chip keeps the static look introduced in 0.7.5 — up to date, failed check, or a local dev build ahead of npm (ahead) never interrupt (ahead only shows a "local dev build" hint in the hover title).
- **Lights up only when outdated**: when `self-check` (npm latest vs the installed version, read-only) finds a newer version, the chip turns into a warn state showing `⬆ v<latest>`; clicking it runs `self-upgrade` (same mutation session + post-install guard) and a "⚡ Restart" banner follows on success. On Desktop the click is rejected structurally by the capability table (409, with official lifecycle guidance).
- **TTL cache + version guard**: check results are cached in browser localStorage for 30 minutes so opening the panel doesn't hit npm every time; after an upgrade + restart the cache auto-invalidates by version. Failed checks stay silent — no error is shown.

### New in 0.9.0 — Official Desktop (dual profile) support

- **One package, two profiles**: dsh-m now installs into the official Desktop's `desktop` profile (`~/.dsh/profiles/desktop`) alongside the Web `web` profile; the catalog, panel, and agent tools are shared, and everything manages the host's current profile (official `profileContext` as the single source of truth).
- **Entrust admission to the host**: every `/dshm` method (including ping and unknown methods) delegates to the official `connection.requestRejection()` before any body is read (trustedHosts / loopback / cross-site / `Origin: null` semantics come from the host); rejected requests consume no body and call no business logic; hosts without the capability fail closed. **Behavior change**: the old home-grown "missing Origin → 403" guard is gone — Origin-less requests from the Desktop bridge are admitted per official semantics, and unauthenticated health probes now follow host trust instead of a blanket 403.
- **Desktop first-release capability table**: read-only market + **installing new packages** (delegated to the official `pluginManager.installBundle`; integrity, locking, and application phases stay with the official manager) + **toggles** (delegated; structured refusal when the service is absent, never a file-level fallback); **upgrade / uninstall / self-update / one-click restart** return structured 409 refusals with official-entry guidance (no official upgrade API exists; restarts belong to the Electron lifecycle); build scripts retry with the exact official `pendingBuilds` list — never an allow-all.
- **Per-profile read model and cache**: market installed-badges, the installed list, and README previews only read the current profile; registry / community / accepted-source caches are segmented per profile (web keeps its legacy paths — zero migration, zero clearing); favorites and operation logs stay per browser origin and do not sync between Web and Desktop.
- **CLI always targets the web profile**: `--profile web` is explicit; `--profile desktop` is rejected with a pointer to the official Desktop plugin management page.
- **Honest limitations**: Desktop on-device (Win/macOS) E2E has not been run; the `registry.json` verified arrays gain **no** Desktop generation (to be recorded after real testing); dsh-m's file-level post-install guard is skipped on Desktop (app.asar probing blind spot) and replaced by official result checks plus a `listBundles` re-read.

### Fixed in 0.8.5

- **dshm_upgrade fake success on guard blocks**: when an upgrade hit the post-install guard (e.g. link/file-sourced plugins cannot be auto-rolled-back), the text output was mis-rendered as "✅ undefined 已升级（最新）"; it now reports the block reason, compensation status and repair basis honestly, consistent with the card title (Guard block).

### Changed in 0.8.4 — Category labels now follow the UI language

- **Community categories**: English names for the 23 known categories come straight from the upstream catalog's `categories.en`; under the English UI, category chips and the category row in detail/favorite modals show English. Upstream categories without an English name fall back to Chinese and keep rendering as raw slugs in the temporary group until labels land in a release. The Chinese UI is unchanged.
- **Curated categories**: the five chips now go through the bilingual dictionary (Market/Tools/UI/Search/Other ⇄ 市场/工具/界面/搜索/其他), consistent with the detail modal.
- **Implementation**: the summary carries `categoryLabelsEn` (derived from the upstream catalog in `communityOutcome`; ids without English are omitted — no second hand-maintained table), and the client merges per UI language. 0.8.1–0.8.3 were local iteration numbers with no separate changelog surface.

### Changed in 0.8.0 — Settings page redo (aligned with the zoned dual-catalog positioning)

- **Information architecture**: Community catalog (from awesome-dsh-plugin) → Curated registry (registry.json) → dsh-m itself → About; the primary registry's user-facing name is now unified as "Curated registry".
- **Community catalog toggle**: a new GUI switch (live effect, instant, no confirm; when off the whole card collapses to one line); new `set-community` API.
- **Curated registry slimmed**: status fields consolidated from 7 rows to 4 (merged address, removed the hard-coded "caching" row); config status only appears when abnormal; buttons reduced to "Force refresh / Validate & apply / Restore default / Download default registry"; "Check entries reachability" removed from the GUI (`registry-diagnose` API kept).
- **Copy fixes**: the custom-source note now says it replaces the whole primary registry and only affects the Curated zone; removed the hard-coded TTL description that didn't match reality (`timeoutMs`/`cacheTtlMin` remain config-file settings).
- **dsh-m itself**: when the local dev build is ahead of npm, show "local dev build" instead of the misleading old "npm latest" (new `ahead` field).
- **About**: copy aligned with the current positioning, plus GitHub repo and issue-tracker links.

### Polished in 0.7.10

- **Head split into three groups**: a hairline divider between the title and tab navigation — "title | nav | status + window controls" reads clearly.
- **Version badge unified color**: the v-number no longer uses the bright primary text color; it matches the dsh-m name in secondary gray.
- **Vertical rhythm consolidated**: window-control cells 26→28px to match tab height; version badge adjusted to 24px; maximize/restore icons unified at 12px; title weight 700→600.

### Fixed in 0.7.9

- **Category chips keep a stable order**: retired the "promote active to front" reordering (every click on a clipped category used to jump it to first place). Instead, when the active category falls inside the collapsed clip region, the row auto-expands so the active filter stays visible — same goal, stable order; a manual collapse under the same active category is respected, and picking another clipped category or "All" resets it.

### Changed in 0.7.8

- **Root cause fix for "maximize does nothing" — CSS hot-update self-healing**: the panel stylesheet was only injected once (`#dshm-css` present → skip), so after a hot update the stale stylesheet lacked rules for new classes (fullscreen/window controls) — new features appeared dead and buttons rendered as unstyled natives. The injected stylesheet now carries a content hash (djb2); reopening the panel after a bundle update swaps in the fresh styles automatically, no page refresh needed.
- **Window-control group recolored**: dropped the raised surface for a transparent background + hairline outline (same language as the search clear button); cells widened 34→44px against mis-clicks; close keeps its red hover.

### Changed in 0.7.7

- **Fullscreen ported from dsh-market**: a maximize/restore control joins the panel head as a unified window-control group (equal-width maximize + close cells, hairline divider, shared SVG line icons; close tints red on hover). Fullscreen fills the viewport without rounded corners, the state is remembered in localStorage, and Esc still closes the panel.
- 0.7.6 catch-up: version badge de-bolded and made static (no copy-on-click); sticky category row's top gap fixed (sticky anchor shifted to offset container padding); close/clear buttons moved to the outlined flat style.

### Changed in 0.7.5

- **Header version chip now shows dsh-m's own version** (`dsh-m v0.7.5`, click to copy; the DSH runtime version lives in Settings and `dshm ping`).
- **× close/clear buttons redrawn**: search clear, detail-modal close, and operation-row remove now use an SVG line icon on a dedicated hover-tinted button; the search clear button floats inside the pill's right edge.
- **Fixed the dsh-market peer warning**: `@deepseek-ai/dsh-tools` peer changed from `*` (strict semver never matches rc prereleases) to the explicit range `^0.1.7-rc.2 || ^0.2.0-rc.1 || >=0.2.0`; newer rc lines (e.g. 0.3.0-rc.x) need another entry.

### Changed in 0.7.4

- **Panel tabs reverted to the classic segmented style** (0.7.2 mistakenly introduced underline tabs; the rounded button group with a highlighted active tab is back).
- **Full-width search**: fixed the search wrapper missing `display:flex`, which kept the input from stretching to the row.
- **Filter button and page-jump control recolored**: the filter button now uses an elevated surface with squared corners to stand apart from the pill category chips (accent outline when open); the page input is a slim pill with a hairline border and an accent-colored "Go" text button.
- **Sticky category row fully opaque**: the background now uses the opaque base token directly (the previous color-mix translucency still let card text bleed through on the dark theme); the bottom divider stays.

### Changed in 0.7.3 (includes 0.7.2)

- **Home layout modeled after dsh-market**: the market view becomes "zone chips → full-width search row → category chips with a trailing Filter popover"; the popover gets its own look (rounded rectangle + leading chevron) and holds sort field (npm downloads/stars/date added), direction, and page size (the old sort dropdown and pager page-size select are retired).
- **Favorites cards open the detail modal**: fixed favorites-zone cards not responding to clicks — favorite snapshots lack full fields, so opening resolves the complete entry by id (in-memory zones → market API → snapshot fallback), reusing the detail modal and the full install path (peer confirm included).
- **Page-number jump**: the pager gains a page input — type a valid page and hit Enter or "Go" to jump.
- **Frosted sticky category row**: the sticky row now blurs content beneath it (backdrop blur + divider), so card text no longer bleeds through.
- **Removed by request**: the "discover/request listing" line (dsh-m does not accept listings), the "Tasks" button (operations panel is always visible again), and the "Refresh" button (force refresh lives in Settings).
- Note: registry entries carry no host-version requirement field, so dsh-market's "host version" filter has no data source here and was not replicated.

### Fixed in 0.7.1

- **Community entries are installable again**: fixes a 0.7.0 regression where installing a community listing failed with "registry 中没有该条目" (install-by-id only consulted the primary registry, never the community catalog); the path now mirrors upgrades — on a primary miss the catalog is searched by id.
- **Compact market header**: search, refresh, and sort (community zone) move into the zone chips row; informational source banners ("official default registry / custom registry / served from local cache") are retired — their "{count} listings" figure was never wired up (always 0); the "registry unavailable" error and community fallback/stale hints remain.

### New in 0.7.0

- **Zoned market** ([ADR-0004](./docs/adr/0004-zoned-market-display.md)): the dual-catalog data merge stays, but the display splits into Community (default) / Curated / Favorites zones; `dshm_search` and `dshm search` switch to `--source community|primary|all` + `--offset` real pagination (default 10 cards) — `primary_only` is retired.
- **Relevance search**: NFKC normalization + CJK↔Latin boundaries + field weighting (name/npm > owner > description > category > tags), multi-term same-field matching; whole-id exact match takes top priority.
- **Operation log + resume executor**, **local favorites + delisted cleanup**, **detail modal + screenshot lightbox**, community byline/deprecated badges/catalog-snapshot version fallback (never used for outdated).

### New in 0.4.0

- **Enablement toggle**: one-click on/off per installed card; internally routed to a row override (single-row plugins, applies live) or bundle selection (multi-row); the write path delegates to the official `pluginManager` service and falls back to direct loader operations when absent ([ADR-0001](./docs/adr/0001-delegate-with-fallback-for-plugin-manager.md)).
- **Live phase badges**: a projection of loader fiber state — failed plugins are visible at a glance.
- **Protection roster**: `dsh-m` itself plus the 16 official host lifeline modules cannot be toggled or uninstalled (upgrades unaffected).
- **Precise build approval**: when pnpm blocks build scripts, only the pending list is approved key-by-key; the allow-everything fallback is labeled honestly ([ADR-0002](./docs/adr/0002-precise-build-approval.md)).
- **Peer compatibility precheck**: install/upgrade validates `@deepseek-ai/dsh(-*)` peers against the runtime version before touching the profile (GitHub sources state the check was skipped); on mismatch the GUI asks, the agent tool returns structured data, the CLI takes `--force`.
- **Verified runtimes**: an optional `verified` array per registry entry records DSH runtimes actually tested — a claim of record, not a prediction; display-only, never gates installs.
- **Bundle identity check**: post-install warning when a package lands without a patch layer ("installed as a plain dependency").

### Retired in 0.4.x

- **Metadata source probe**: 0.4.0 introduced an npmjs / npmmirror ping race to pick the metadata read source; it has been removed entirely (including the `probeEnabled` / `probeTimeoutMs` / `probeCacheTtlMin` settings and the settings-page display). The official counterpart probe only pre-selects a registry in the interactive install dialog, which dsh-m does not have, and npmjs measured consistently faster from the host, so the probe always equaled the default. Metadata reads now always use npmjs, matching the install path (profile `.npmrc` default).
