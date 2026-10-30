// ---------- 样式（跟随 DSH Web 主题变量，深浅色自适应） ----------
const CSS = `
/* 0.11.6 还原态对齐官方设置弹窗（2026-10-30 Desktop 实拍：图二重灰 vs 官方设置页；官方配方
   取证 dsh-client-ui-settings-general .AnXs9G_overlay/_mask/_panel@rc.5）：①遮罩
   mask-3（两主题恒 #0000007a＝48% 黑）→ mask-1（浅 24%/深 50% 随主题）+ 官方同款
   var(--dsw-mask-blur)（当前主题 none，token 对齐防主题演进翻车）；②面板 86% 玻璃 +
   blur(14px) → 不透明 --dsw-alias-bg-layer-2（官方 .AnXs9G_panel 同款，「玻璃垫重幕」
   闷灰根除）；③圆角/阴影换官方 token（--dsw-radius-panel/--dsw-elevation-prominent），
   旧字面值留作回落。ADR-0017 v2「拖拽态与静止态同玻璃同 blur」随玻璃退役自然成立
   （两态同不透明，无双态跳变）。④遮罩几何（二轮，2026-10-30 像素实测收尾）：官方 mask 是
   子元素 .AnXs9G_mask{inset:var(--dsh-frame-chrome-top,0px) 0 0}——天生从标题栏下缘起画；
   本仓 mask 若画在 overlay 本体（inset:0）会盖住页面顶带：面板开着时条带左段被压成
   #f9fafb×0.76=#bdbec1、右段 WCO（OS 画在网页之上）仍 #f9fafb——两截色。故 mask 挪
   ::before（inset: var(--dsh-windows-titlebar-height,0px) 0 0），overlay 继续全视口居中
   （面板位置与 0.11.5 逐像素一致，web 无变量回落 0 零漂移）。 */
.dshm-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-windows-titlebar-height,0px)) 16px 24px;box-sizing:border-box}
.dshm-overlay::before{content:'';position:absolute;inset:var(--dsh-windows-titlebar-height,0px) 0 0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));backdrop-filter:var(--dsw-mask-blur,none)}
.dshm-panel{position:relative;width:min(920px,100%);height:min(680px,86vh);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base,#fff)));border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:var(--dsw-radius-panel,14px);box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(2,6,23,.25));overflow:hidden;font-family:inherit;color:var(--dsw-alias-label-primary,inherit)}
/* 0.9.70 还原态拖拽：.abs = 有位置记忆时的绝对定位形态（overlay 为 inset:0 fixed，
   绝对定位坐标即视口坐标）；无记录时面板仍走 overlay flex 居中，渲染路径与旧版逐字节一致。
   拖拽观感不变量（0.9.70 修订，ADR-0017 v2）：拖拽态与静止态同玻璃同 blur，外观逐像素一致
   ——用户双态实拍裁决：0.9.69 的拖拽期实心固化在浅色模式下实/玻璃跳变观感突兀，退役；
   透字防护回归静止态既有不变量（毛玻璃模糊背景自持——透字病灶的成因是「关 blur 还留
   半透明」，两样都不动即无此病）。拖拽可供性只剩 grabbing 光标与投影加深；代价是拖拽期
   恢复每帧 backdrop 重滤镜（GPU 合成承担，弱机若报告掉帧再评估），帧内写/capture/
   手势期监听等其余性能手段全部保留。0.11.6 注：玻璃随还原态官方对齐退役（见文件头
   .dshm-overlay 注），两态同不透明，「无双态跳变」不变量自然成立。 */
.dshm-panel.abs{position:absolute;margin:0}
.dshm-panel--dragging{cursor:grabbing;box-shadow:0 24px 64px rgba(2,6,23,.38)}
/* 0.9.69 拖拽手柄：user-select/touch-action/tap-highlight 无条件生效（全屏双击切换时
   标题不出现选中闪现）；grab 光标仅在「还原态且非拖拽中」直接命中 head——拖拽中 head
   无自有 cursor 声明，自然继承面板根 .dshm-panel--dragging 的 grabbing（cursor 按
   「元素自有声明 > 继承」解析：grab 若在拖拽中仍直接命中 head，grabbing 永远继承不进
   成为死代码——评审 R2-2）。全屏禁拖（硬性要求③），光标不误导（评审 R1-6）。 */
.dshm-head{user-select:none;touch-action:none;-webkit-tap-highlight-color:transparent}
.dshm-panel:not(.full):not(.dshm-panel--dragging) .dshm-head{cursor:grab}
/* 0.9.4 Windows Desktop 全屏修复：壳在 html 上设 --dsh-windows-titlebar-height（40px，
   titleBarStyle:hidden + titleBarOverlay:42 系统绘制 — □ ✕），其上还有全宽
   -webkit-app-region:drag 拖拽带——该带按布局参与拖拽判定、无视 z-index/绘制顺序，
   面板头部落进去点击会被窗口拖拽吞掉，还原/关闭键更被系统键悬浮遮挡。
   与壳自家 overlay 同款对策（padding/inset-top: var(--dsh-windows-titlebar-height)）让出该带；
   DSH Web / 浏览器无此变量 → 回落 0px，行为与旧版逐字节一致。 */
.dshm-overlay.full{padding:0;top:var(--dsh-windows-titlebar-height,0px)}
.dshm-panel.full{width:100%;height:100%;border-radius:0}
/* 0.11.6 全屏态与原生标题栏带脱开（2026-10-30 Desktop 实拍：0.9.4 让位只做了「让」没做
   「退开」——面板顶缘精确压在条带底缘（top=40px），1px border-l2 hairline 正好垫在
   — □ ✕ 字形底下＝压线；且 overlay 暗色 mask 在 full 态原样保留，86% 玻璃背后垫着暗幕，
   头部发灰，与原生条带（探针喂 titleBarOverlay 的侧栏填充色）形成灰白断层。对策：
   ①+8px 呼吸位——露出的是 app 头部（侧栏填充），与条带同色同源，视觉上条带变厚、
   按钮脱开；②full 态摘 mask——玻璃背后换真实页面，断层消失，全屏态本无「聚焦暗示」
   语义。门控谓词与 readTitlebarInsets/titlebarTopInset 同款（有 data-windows-titlebar
   且 OS 非全屏）；DSH Web / 浏览器无该属性 → 规则不适用，行为零漂移（0.9.4 同款回落
   哲学）。 */
html[data-windows-titlebar]:not([data-fullscreen]) .dshm-overlay.full{top:calc(var(--dsh-windows-titlebar-height,0px) + 8px)}
/* full 态 mask 收尾（0.11.6 二轮）：mask 已挪 ::before，full 态不画——门控 full 藏 ::before；
   非门控 full（Web / OS 全屏）overlay 盒 top 已由 0.9.4 规则让位，::before 相对盒归 0，
   不再叠让 40px 留未遮带。 */
.dshm-overlay.full::before{top:0}
html[data-windows-titlebar]:not([data-fullscreen]) .dshm-overlay.full::before{display:none}
/* resize 热区（panel resize）：透明贴内缘（面板 overflow:hidden 不可外置）。
   边 6/8px、角 14×14（Q8 定稿 12–16px 带内；扫描期可校准）。右热区盖住 .dshm-body
   纵向滚动条外缘 ~6px（余 ~9px 可拖）、角热区与滚动条 corner 死区基本重合（Q4 接受）。
   cursor 即全部供性——无视觉控件（Q8）。z-index 压过 body 内容但不进头部交互区
   （head padding 14px > 6px 热区，winctl 按钮无碰撞）。 */
.dshm-rz{position:absolute;z-index:5;touch-action:none}
.rz-e{top:0;right:0;width:6px;height:100%;cursor:ew-resize}
.rz-s{bottom:0;left:0;width:100%;height:8px;cursor:ns-resize}
.rz-se{right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize}
.dshm-panel.full .dshm-rz{display:none} /* belt ①：全屏态手柄不渲染，CSS 兜底 */
@media (pointer:coarse){.dshm-rz{display:none}} /* belt ②：coarse 指针整组隐藏（Q8） */
/* 窗口控制组（0.7.7）：最大化/关闭连体按钮组——等宽两格 + 发丝分隔线，统一线条图标 */
/* 窗口控制组（0.7.7/0.7.8）：最大化/关闭连体按钮组——透明底 + 发丝外框，与搜索清除钮同一配色语言；宽格防误触 */
.dshm-winctl{display:inline-flex;align-items:center;height:34px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:9px;background:transparent;overflow:hidden;flex:none}
.dshm-winctl button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);width:44px;height:28px;padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s,color .15s}
.dshm-winctl button + button{border-left:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}
.dshm-winctl button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,inherit)}
.dshm-winctl button:active{background:var(--dsw-alias-fill-secondary,rgba(127,127,127,.2))}
.dshm-winctl button.danger:hover{background:#e5484d;color:#fff}
.dshm-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.dshm-title{font-weight:600;font-size:15px;margin-right:2px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.dshm-head-divider{width:1px;height:18px;background:var(--dsw-alias-border-l2,#e5e7eb);flex:none}
.dshm-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2,#e2e4e8);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#f5f6f8)}
.dshm-seg button{appearance:none;border:0;background:transparent;height:28px;padding:0 14px;border-radius:7px;font:inherit;font-size:12px;color:var(--dsw-alias-label-tertiary,#7b8088);cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:background .15s,color .15s,box-shadow .15s}
.dshm-seg button:hover{color:var(--dsw-alias-label-secondary,#4b5058)}
.dshm-seg button.on{background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#17191c);font-weight:600;box-shadow:var(--dsw-shadow-lv1,0 2px 8px rgb(20 24 32 / 8%))}
.dsvm-filterbtn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-elevated,transparent);color:var(--dsw-alias-label-secondary,#4b5563);border-radius:8px;padding:4px 12px;font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:color .15s,border-color .15s,background .15s}
.dsvm-filterbtn:hover{color:var(--dsw-alias-label-primary,inherit);border-color:var(--dsw-alias-label-caption,#9ca3af)}
.dsvm-filterbtn.on{color:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:var(--dsw-alias-state-business-primary,#4d6bfe);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 8%,transparent)}
.dsvm-filterchev{font-size:10px;line-height:1}
.dshm-seg .dshm-count{font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption,#9ca3af);margin:0}
.dshm-seg button.on .dshm-count{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dshm-spacer{flex:1}
/* 0.9.76 分类行吸顶高频跳动根治：Chrome 滚动锚定（scroll anchoring）把「吸顶收展的
   高度变化」翻译成 scrollTop 补偿（≈一个行高），哨兵（wrap 内 top:-5px）因此被来回送进/
   送出视口 → IO stuck 每帧翻转 → chips 行高频蹦跳。触发条件：tab 条件渲染重挂回到市场
   （stuck=false + IO 重新武装）且 .dshm-body 保留的 scrollTop 恰落在哨兵边界 ±30px 带内
   （翻页 scrollIntoView 会把 scrollTop 精确送到 bar 边缘，命中概率大增）。锚定在本滚动
   容器停用后，stuck 翻转不再移动哨兵，循环在驱动器处断开；面板内容只向下分页追加、
   无上方懒加载布局，锚定损失趋零。 */
.dshm-body{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px;overflow-anchor:none}
.dshm-hint{color:var(--dsw-alias-label-caption,#6b7280);font-size:12px;line-height:18px;margin:0}
.dshm-err{color:var(--dsw-alias-state-error-primary,#b91c1c);font-size:12px;line-height:18px}
.dshm-ok{color:var(--dsw-alias-state-success-primary,#047857);font-size:12px;line-height:18px;word-break:break-word}
.dshm-btn{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,inherit);border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dshm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dshm-btn:disabled{opacity:.5;cursor:default}
.dshm-btn.primary{background:var(--dsw-alias-interactive-bg-selected,#4f46e5);border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5);color:#fff}
.dshm-btn.primary:hover{filter:brightness(1.08)}
.dshm-btn.danger{color:var(--dsw-alias-state-error-primary,#b91c1c);border-color:var(--dsw-alias-state-error-primary,#b91c1c)}
.dshm-btn.sm{padding:3px 9px;font-size:11px}
.dshm-input{flex:1;min-width:120px;border:1px solid var(--dsw-alias-border-l2,#c7d2fe);background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary,inherit);border-radius:999px;padding:7px 14px;font:inherit;font-size:12px;outline:none}
.dshm-input:focus{border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5)}
.dshm-chips{display:flex;flex-wrap:wrap;gap:6px;position:relative}
.dshm-chips-clip{overflow:hidden}
.dshm-chips-gutter{padding-right:var(--dshm-clip-gutter,96px)}
/* +N/筛选分别占右侧 60/96px；保留优先级高于单独的筛选 gutter。 */
.dshm-chips.dshm-chips-clip.dshm-chips-reserve{padding-right:60px}
.dshm-chips.dshm-chips-clip.dshm-chips-gutter.dshm-chips-reserve{padding-right:calc(var(--dshm-clip-gutter,96px) + 60px)}
.dsvm-chipmore{position:absolute;right:8px}
.dsvm-chipmore-plus{position:absolute;z-index:1;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;background-color:var(--dsw-alias-bg-base,#fff);background-image:linear-gradient(var(--dsw-alias-bg-base,#fff),var(--dsw-alias-bg-base,#fff)),linear-gradient(var(--dsw-alias-bg-base,#fff),var(--dsw-alias-bg-base,#fff))}
.dsvm-searchrow{display:flex;align-items:center;gap:8px}
.dsvm-searchrow .dshm-search{flex:1;display:flex}
.dshm-search{position:relative}
.dshm-search .dshm-xbtn-infield{position:absolute;right:4px;top:50%;transform:translateY(-50%)}
.dshm-xbtn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);width:26px;height:26px;padding:0;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;transition:border-color .15s,color .15s,box-shadow .15s}
.dshm-xbtn:hover{border-color:var(--dsw-alias-label-caption,#9ca3af);color:var(--dsw-alias-label-primary,inherit);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 1px 2px rgba(0,0,0,.18)}
.dshm-xbtn:active{box-shadow:inset 0 2px 3px rgba(0,0,0,.15)}
.dsvm-filterwrap{position:relative;margin-left:auto;display:inline-flex}
.dsvm-filterback{position:fixed;inset:0;z-index:25}
.dsvm-filterpop{position:absolute;top:calc(100% + 6px);right:0;z-index:30;width:250px;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base,#fff));background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 92%,transparent);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;box-shadow:0 18px 48px rgba(2,6,23,.25);padding:12px}
.dsvm-filtergroup{display:flex;flex-direction:column}
.dsvm-filtergt{font-size:11px;color:var(--dsw-alias-label-caption,#9ca3af);margin-bottom:4px}
.dsvm-filteropt{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:12px;text-align:left;padding:5px 6px;border-radius:7px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px}
.dsvm-filteropt:hover{background:var(--dsw-alias-fill-secondary,rgba(127,127,127,.12))}
.dsvm-filteropt.on{color:var(--dsw-alias-state-business-primary,#4d6bfe);font-weight:600}
.dsvm-filtercheck{font-size:11px}
.dshm-chip{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);border-radius:999px;padding:2px 10px;font:inherit;font-size:11px;cursor:pointer}
.dshm-chip.zero{opacity:.55}
.dshm-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dshm-chip.on{background:var(--dsw-specific-sidebar-nav-item-active,rgba(38,49,72,.08));border-color:transparent;color:var(--dsw-alias-label-primary,inherit);font-weight:500}
.dsvm-chipswrap{position:sticky;top:-14px;z-index:5;background:var(--dsw-alias-bg-base,#fff);padding:8px 0;margin:-8px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14))}
/* 0.9.59 分类行左缘内缩 8px：与搜索框/卡片左缘齐平时胶囊行视觉憋仄，整体右移留出呼吸空间。
   仅作用分类行（ZoneChips），上方分区 chips 行不随动；offsetLeft 与 absolute 定位同以
   .dshm-chips 的 padding 盒为原点 → +N 跟随、右侧筛选钉位、offsetTop 裁剪几何均不受影响。 */
.dsvm-chipswrap .dshm-chips{padding-left:8px}
.dsvm-pagejump{display:inline-flex;align-items:center;gap:4px;margin-left:8px}
.dsvm-pagejump-input{width:56px;height:24px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);border-radius:999px;padding:0 10px;font:inherit;font-size:12px;outline:none;text-align:center;transition:border-color .15s,color .15s}
.dsvm-pagejump-input:hover{color:var(--dsw-alias-label-primary,inherit)}
.dsvm-pagejump-input:focus{border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5);color:var(--dsw-alias-label-primary,inherit)}
.dsvm-pagejump-btn{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsvm-pagejump-btn:disabled{opacity:.4;cursor:default}
.dsvm-sortrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.dsvm-byline{display:flex;flex-wrap:wrap;gap:8px;color:var(--dsw-alias-label-caption,#6b7280);font-size:11px;line-height:16px;margin:2px 0 0;font-variant-numeric:tabular-nums}
.dsvm-pager{display:flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:center;margin-top:4px}
.dsvm-pagebtn{min-width:26px;height:24px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:12px;cursor:pointer}
.dsvm-pagebtn.on{border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5);color:var(--dsw-alias-interactive-bg-selected,#4f46e5);font-weight:600}
.dsvm-pagebtn:disabled{opacity:.4;cursor:default}
.dsvm-modal{position:fixed;inset:0;z-index:2147483100;background:var(--dsw-alias-bg-mask-3,rgba(15,23,42,.55));display:flex;align-items:center;justify-content:center;padding:24px 16px}
.dsvm-modalbox{width:min(720px,100%);max-height:86vh;overflow:hidden;background:var(--dsw-alias-bg-elevated,#fff);background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 94%,transparent);backdrop-filter:blur(14px);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:14px;box-shadow:0 18px 48px rgba(2,6,23,.25);padding:16px;display:flex;flex-direction:column;gap:10px}
.dsvm-modalbody{overflow:auto;min-height:0;overscroll-behavior:contain;display:flex;flex-direction:column;gap:10px}
.dsvm-modalhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsvm-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:12px;margin:0}
.dsvm-kv dt{color:var(--dsw-alias-label-caption,#6b7280);white-space:nowrap}
.dsvm-kv dd{margin:0;color:var(--dsw-alias-label-secondary,#4b5563);overflow-wrap:anywhere}
.dsvm-fold{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;padding:6px 10px;font-size:12px}
.dsvm-fold summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#4b5563)}
.dsvm-cmdrow{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap}
.dsvm-code{background:rgba(127,127,127,.12);padding:3px 8px;border-radius:6px;font-size:11px;overflow-wrap:anywhere}
.dsvm-modalactions{display:flex;justify-content:flex-end;gap:8px}
/* 0.9.73 详情截图条统一瓷砖：两病灶——①盒子无固定几何（min 120×84 盒 / img max 220×130）跟着
   图片固有比例走，整条参差（「大的大小的小」）；②shotbox 显式 min-width:120px 顶掉 flex 的
   automatic minimum size，N 张图自然总宽超行（8×220px ≫ 弹窗内容宽 ~688px）触发 flex 收缩时，
   盒子被压到 120px 地板而盒内 img（替换元素）不受盒宽约束保持固有宽度、盒子 overflow:visible
   ——图片居中外溢盖住左右邻图（发生在滚动条出现之前，两症状同屏）；加载完成瞬间行高还被
   撑高一次（行高随最高图 84→130px 跳变，CLS）。修复 = 统一瓷砖 176×110 + flex:0 0 auto
   （永不收缩，几何与图片多少/加载态无关）+ overflow:hidden（外溢兜底双保险），img 改
   width/height:100% + object-fit:cover + object-position:top（顶锚定保住截图标题栏，裁切只
   发生在底部，竖图/方图露上半段，全图看灯箱）；scroll-snap proximity 给横滚翻页手感。 */
.dsvm-shotrow{display:flex;gap:6px;overflow-x:auto;padding:2px 0;scroll-snap-type:x proximity}
.dsvm-shotbox{flex:0 0 auto;width:176px;height:110px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.08);border-radius:6px;cursor:zoom-in;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));scroll-snap-align:start}
.dsvm-shot{width:100%;height:100%;object-fit:cover;object-position:top center;border-radius:6px;display:block}
/* 灯箱 v2（0.9.60）：组件 createPortal 挂 body（逃出面板 backdrop-filter 包含块），
   控件全部绝对定位贴视口边——✕ 常驻右上、‹› 两侧居中、底部计数+圆点 pill，
   任何面板状态/任意图片高度下都不会被挤出屏幕；图片降到 74vh 给底部控件留位。
   评审 R1：✕/‹› 用 .dsvm-btn.dsvm-lb* 复合选择器——基础 .dsvm-btn 规则源顺序靠后
   （padding:5px 14px/font-size:13px/radius:8px），同特异性下会反杀单类规则（实测字形 13px≠26px）。
   评审 R2：top 让出 Windows Desktop 拖拽带 var(--dsh-windows-titlebar-height)（0.9.4 先例，
   壳顶 -webkit-app-region:drag 吞点击、无视 z-index）；Web 无此变量回落 0px 行为不变。
   0.9.62 影院遮罩自持：灯箱是图片影院面，「深色遮罩 + 浅色控件」是组件自有可读性
   不变量，不随颜色模式/皮肤翻转。实证碰撞：dsh-skins ADR-0007 浮层毛玻璃并集按
   [role=dialog][aria-modal=true] 命中本根（浅色模式 86% 暖白 tint+blur14），白色控件
   在浅底上不可见（用户双模式实拍）。双侧修复——皮肤侧 :not(.dsvm-lightbox) 豁免
   （dsh-skins 1.5.1 起）；本侧 background !important 自持：marketplace 社区皮肤不可
   枚举，影院不变量必须由组件自己兜底。!important 清单定长（注释提及×2 + 本规则
   + sidebar footer 兼容规则），新增须改 client-lightbox 断言显式登记，注释即守卫。
   0.9.65：touch-action:pan-y pinch-zoom——横滑判向交给灯箱滑动切换，纵向原生
   手势与 pinch 缩放（低视力可达性）不被劫持。 */
.dsvm-lightbox{position:fixed;top:var(--dsh-windows-titlebar-height,0px);left:0;right:0;bottom:0;z-index:2147483200;background:rgba(0,0,0,.88)!important;display:flex;align-items:center;justify-content:center;touch-action:pan-y pinch-zoom}
.dsvm-lightbox img{max-width:min(92vw,1500px);max-height:74vh;border-radius:8px;cursor:zoom-out;box-shadow:0 10px 44px rgba(0,0,0,.55);display:block}
.dsvm-btn:focus-visible{outline:2px solid rgba(255,255,255,.75);outline-offset:2px}
.dsvm-btn.dsvm-lbclose{position:absolute;top:12px;right:12px;width:38px;height:38px;padding:0;border-radius:10px;display:flex;align-items:center;justify-content:center}
.dsvm-btn.dsvm-lbarrow{position:absolute;top:50%;transform:translateY(-50%);width:46px;height:60px;padding:0;font-size:26px;line-height:1;border-radius:10px}
.dsvm-lbarrow.prev{left:12px}
.dsvm-lbarrow.next{right:12px}
/* 0.9.62 控件深色玻璃芯片：‹›/✕ 原随基础 .dsvm-btn 裸透明白（rgba(255,255,255,.14) 底
   + 白字白边），遮罩一旦被任何来源改浅即整体隐形（本次事故的另一半）。改用与底部
   pill 同族的深色芯片（slate-900 55% + 白描边 + blur + 投影）——深遮罩上靠描边/blur/投影
   出层次，浅遮罩上芯片本身就是对比面，任何颜色模式与皮肤下都可读；hover 提亮。
   显式 :hover（特异性 0,3,0）压过基础 .dsvm-btn:hover（0,2,0）——即便本块排在基础规则
   之前也不被源顺序反杀（评审 R1 同族教训）。 */
.dsvm-btn.dsvm-lbclose,.dsvm-btn.dsvm-lbarrow{background:rgba(15,23,42,.55);border-color:rgba(255,255,255,.28);box-shadow:0 4px 16px rgba(0,0,0,.35);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.dsvm-btn.dsvm-lbclose:hover,.dsvm-btn.dsvm-lbarrow:hover{background:rgba(15,23,42,.8);border-color:rgba(255,255,255,.5)}
.dsvm-lbbar{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;max-width:94vw;background:rgba(15,23,42,.62);border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:7px 16px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.dsvm-lbcount{color:rgba(255,255,255,.82);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dsvm-lbhint{color:rgba(255,255,255,.55);font-size:11px;white-space:nowrap}
.dsvm-lbdots{display:flex;gap:2px}
.dsvm-lbdot{box-sizing:content-box;width:8px;height:8px;padding:5px;border-radius:50%;background:rgba(255,255,255,.32);background-clip:content-box;cursor:pointer}
.dsvm-lbdot.on{background:#fff;background-clip:content-box}
/* 0.9.62 加载指示与淡入：灯箱走链期间（weserv 慢速/8s 守卫换层/直连大图）此前是
   空黑黑洞，现转圈占位；图片 onLoad（useImgChain settled）后 160ms 淡入换场。
   prefers-reduced-motion 下转场停用（转圈降速保留活动指示）。 */
@keyframes dsvm-lbspin{to{transform:rotate(360deg)}}
.dsvm-lbspin{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid rgba(255,255,255,.25);border-top-color:rgba(255,255,255,.92);animation:dsvm-lbspin .8s linear infinite}
.dsvm-lightbox .dsvm-lbimg{opacity:0;transition:opacity .16s ease-out}
.dsvm-lightbox .dsvm-lbimg.dsvm-lbimg-on{opacity:1}
@media (prefers-reduced-motion:reduce){.dsvm-lbspin{animation-duration:1.6s}.dsvm-lightbox .dsvm-lbimg{transition:none}}
@media (max-width:640px){.dsvm-lbhint{display:none}.dsvm-btn.dsvm-lbarrow{width:40px;height:54px}}
/* 0.9.61 双败终态占位：居中列——⚠ 文案 + 重试（复用 dsvm-btn）+ 打开原图（ExtLink 新标签） */
.dsvm-lbfail{display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px 32px;background:rgba(15,23,42,.55);border:1px solid rgba(255,255,255,.14);border-radius:12px}
.dsvm-lbfailmsg{color:rgba(255,255,255,.85);font-size:14px}
.dsvm-lbfail a{color:rgba(255,255,255,.75);font-size:13px;text-decoration:underline}
.dsvm-card-clickable, .dshm-card{cursor:pointer}
.dshm-card:hover{border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5)}
.dsvm-btn{border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.14);color:#fff;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;cursor:pointer}
.dsvm-btn:hover{background:rgba(255,255,255,.24)}
.dsvm-ops-caption{font-size:11px;color:var(--dsw-alias-label-caption,#9ca3af);margin:2px 0 -3px}
/* 0.9.72 滚轮治理（useScrollableContain）：contain 只在真的可滚时挂——Chrome 144+ 对
   「无可滚溢出的滚动容器」也执行 contain，恒挂会把不满高的滚动区变成滚轮黑洞 */
.dshm-ops-scroll{max-height:220px;overflow-y:auto}
.dshm-ops-scroll.is-scrollable{overscroll-behavior:contain}
.dshm-ops-scroll::-webkit-scrollbar{width:8px}
.dshm-ops-scroll::-webkit-scrollbar-thumb{background:rgba(127,127,127,.28);border-radius:4px}
.dshm-ops-scroll::-webkit-scrollbar-thumb:hover{background:rgba(127,127,127,.45)}
.dsvm-opgroup{display:flex;flex-direction:column;gap:3px}
.dsvm-opgroup.done{opacity:.75}
/* 0.9.67 移动端字号自洽（用户实机截图反馈）：oprow 原不声明 font-size——移动端宿主
   基础字号（≈15-16px）下整行被放大，与设置卡 12px 家族（dsvm-kv/dshm-hint/dsvm-fold）
   明显脱节。显式 12px 入族（状态 11px/注记 11px 的次级层级保持）；flex-wrap 让长目标名
   与错误注记自然折行不挤压；✕ 单条移除钮钉行尾与社区卡行惯例一致。 */
.dsvm-oprow{display:flex;align-items:center;gap:8px;min-height:22px;font-size:12px;flex-wrap:wrap}
.dsvm-oprow .dshm-xbtn{margin-left:auto}
.dsvm-opstatus{min-width:44px;font-size:11px;color:var(--dsw-alias-label-caption,#6b7280)}
.dsvm-oprow.ok .dsvm-opstatus{color:#15803d}
.dsvm-oprow.warn .dsvm-opstatus, .dsvm-oprow.run .dsvm-opstatus{color:#b45309}
.dsvm-oprow.err .dsvm-opstatus{color:var(--dsw-alias-state-error-primary,#b91c1c)}
.dsvm-oprow.sup .dsvm-opstatus{color:var(--dsw-alias-label-caption,#6b7280)}
.dsvm-opkind{color:var(--dsw-alias-label-secondary,#4b5563)}
.dsvm-optarget{font-weight:500;overflow-wrap:anywhere}
.dsvm-opnote{color:var(--dsw-alias-label-caption,#6b7280);font-size:11px;overflow-wrap:anywhere}
/* 0.9.75 操作记录信息增强：行内时间/耗时（tabular-nums 对齐）、按日分组头、开关方向徽章、
   升级版本变迁。字号守 0.9.67 的 12px 家族（次级 11px），颜色沿用既有语义：
   方向「开」用 ok 同款绿，「关」用次级灰；徽章 currentColor 描边自适应深浅主题。
   （0.9.76：「对话」来源徽章随其 CSS 退役——meta.session 是泵所有权标记非来源语义。） */
.dsvm-optime,.dsvm-opdur{font-size:11px;color:var(--dsw-alias-label-caption,#9ca3af);font-variant-numeric:tabular-nums}
.dsvm-opday{font-size:11px;font-weight:600;color:var(--dsw-alias-label-caption,#9ca3af);margin:6px 0 0}
.dsvm-opgroup.done .dsvm-opday:first-child{margin-top:0}
.dsvm-opdir{font-size:11px;line-height:16px;padding:0 6px;border-radius:8px;border:1px solid currentColor}
.dsvm-opdir.on{color:#15803d}
.dsvm-opdir.off{color:var(--dsw-alias-label-secondary,#4b5563)}
/* 0.9.79 外部记录渠道徽标（Agent 工具/命令行/外部）：中性描边胶囊，与方向徽章同形不同色 */
.dsvm-opchan{font-size:11px;line-height:16px;padding:0 6px;border-radius:8px;border:1px solid currentColor;color:var(--dsw-alias-label-caption,#9ca3af)}
.dsvm-opver{font-size:11px;color:var(--dsw-alias-label-secondary,#4b5563);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.dsvm-favbtn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-caption,#9ca3af);font-size:15px;line-height:1;cursor:pointer;padding:0 2px;margin-left:auto}
.dsvm-favbtn:hover{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsvm-favbtn.on{color:#e0a33c}
.dsvm-reddot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-error-primary,#ef4444);margin-left:5px;vertical-align:middle}
/* 依卡片容器宽度自动决定列数：N=max(1,floor((W+8)/(360+8)))，单卡宽度均分剩余空间。
   普通窗口、全屏和窄屏都走同一规则；min(100%,360px) 保证极窄容器不横向溢出。 */
.dshm-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:8px}
.dsvm-searchmeta{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-caption,#6b7280);font-size:12px;line-height:18px;margin:2px 0}
.dsvm-grouphead{grid-column:1/-1;color:var(--dsw-alias-label-caption,#6b7280);font-size:11px;line-height:16px;margin:2px 0 0;font-weight:600;letter-spacing:.02em}

.dshm-card{display:flex;gap:12px;align-items:flex-start;background:var(--dsw-alias-bg-layer-2,rgba(38,49,72,.04));border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:12px;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;min-width:0;font:inherit;color:var(--dsw-alias-label-primary,inherit);transition:border-color .16s,background .16s}
.dshm-card:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));border-color:var(--dsw-alias-label-dimmed,#c7d2fe)}
.dshm-icon{width:40px;height:40px;border-radius:10px;object-fit:contain;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);flex-shrink:0;display:grid;place-items:center;font-weight:700;font-size:16px;color:#374151}
div.dshm-icon{background:linear-gradient(135deg,#c7d2fe,#fbcfe8)}
img.dshm-icon{background:var(--dsw-alias-bg-layer-1,#f5f6f8)}
.dshm-meta{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.dshm-top{display:flex;align-items:center;gap:8px;min-width:0}
.dshm-name{flex:1;min-width:0;font-weight:600;font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshm-badge{appearance:none;border:0;font:inherit;flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-state-success-tertiary,#ecfdf5);color:var(--dsw-alias-state-success-primary,#047857)}
button.dshm-badge{cursor:pointer}
button.dshm-badge:hover{filter:brightness(.95)}
.dshm-badge.warn{background:var(--dsw-alias-state-warn-tertiary,#fffbeb);color:var(--dsw-alias-state-warn-primary,#b45309)}
.dshm-badge.info{background:var(--dsw-alias-state-business-tertiary,#eef2ff);color:var(--dsw-alias-state-business-primary,#4338ca)}
.dshm-badge.curated{background:#f5f3ff;color:#6d28d9}
.dshm-badge.err{background:var(--dsw-alias-state-error-secondary,#fee2e2);color:var(--dsw-alias-state-error-primary,#b91c1c)}
.dshm-desc{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dshm-sub{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-caption,#6b7280)}
.dshm-detail{margin-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,#e5e7eb);padding-top:8px;display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563)}
.dshm-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.dshm-banner-stack{position:absolute;left:0;right:0;bottom:0;z-index:30;display:flex;flex-direction:column;pointer-events:none}
.dshm-banner-stack .dshm-banner{pointer-events:auto}
.dshm-banner{display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-state-warn-tertiary,#fffbeb);color:var(--dsw-alias-state-warn-primary,#b45309);font-size:12px}
.dshm-banner.err{background:rgba(239,68,68,.13);color:var(--dsw-alias-state-error-primary,#b91c1c)}
/* 0.9.72 同款滚轮治理（见 dshm-ops-scroll 注）：横幅文本不满 140px 时不得吞滚轮 */
.dshm-banner .dshm-banner-text{flex:1;max-height:140px;overflow:auto;white-space:pre-wrap;word-break:break-word;line-height:18px}
.dshm-banner .dshm-banner-text.is-scrollable{overscroll-behavior:contain}
.dshm-row{display:flex;align-items:center;gap:8px}
.dshm-kv{display:grid;grid-template-columns:96px 1fr;gap:6px 10px;font-size:12px;align-items:baseline}
.dshm-kv .k{color:var(--dsw-alias-label-caption,#6b7280);font-size:11px}
.dshm-settings-grid{display:grid;gap:10px;grid-template-columns:4fr 7fr;min-width:0}
.dshm-settings-grid>.dshm-section{margin:0;min-width:0}
.dshm-settings-grid>.dshm-section:nth-child(3){grid-column:1/-1}
.dshm-settings-grid>.dshm-ops-card{grid-column:1/-1}
/* 三列制门控 = 容器宽度而非全屏态（0.9.88，panel resize 伴生修复）：还原态可拉到
   任意宽，≥1100px 时「关于」升第三列；顺带修正旧账——
   小视口全屏（<1100）不再被强塞三列，回落两列。≤760px 视口单列媒体查询原样保留。
   0.9.91 三列 4:7:3 → 4:7:4（主人 2026-10-16 定稿）：左右窄卡等宽，视觉对称。 */
@container (min-width:1100px){
  .dshm-settings-grid{grid-template-columns:4fr 7fr 4fr}
  .dshm-settings-grid>.dshm-section:nth-child(3){grid-column:auto}
}
@media (max-width:760px){.dshm-settings-grid,.dshm-panel.full .dshm-settings-grid{grid-template-columns:minmax(0,1fr)}.dshm-settings-grid>.dshm-section:nth-child(3),.dshm-settings-grid>.dshm-ops-card{grid-column:1/-1}}
.dshm-kvlines{display:flex;flex-direction:column}
.dshm-kvline-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:5px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.14));min-width:0}
.dshm-kvline-row:last-child{border-bottom:0}
.dshm-kvline-row .rl{font-size:11px;color:var(--dsw-alias-label-caption,#6b7280);flex:none}
.dshm-kvline-row .rv{font-size:12px;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;min-width:0}
.dshm-kvline-row .dshm-switch{margin-left:0;align-self:center}
.dshm-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:1px;background:var(--dsw-alias-state-success-primary,#22c55e)}
.dshm-dot.warn{background:var(--dsw-alias-state-warn-primary,#b45309)}
.dshm-dot.err{background:var(--dsw-alias-state-error-primary,#b91c1c)}
.dshm-code-1line{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.dshm-section{background:var(--dsw-alias-bg-layer-2,rgba(38,49,72,.04));border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:9px;margin:0 0 10px}
.dshm-section:last-child{margin-bottom:2px}
.dshm-section-title{display:flex;align-items:center;gap:7px;font-weight:700;font-size:12px;letter-spacing:.2px;color:var(--dsw-alias-label-primary,inherit)}
.dshm-section-title::before{content:"";width:3px;height:11px;border-radius:2px;background:var(--dsw-alias-interactive-bg-selected,#4f46e5)}
.dshm-section-sub{margin-left:auto;font-weight:400;font-size:11px;color:var(--dsw-alias-label-caption,#9ca3af)}
.dshm-note{border-left:3px solid var(--dsw-alias-border-l2,#cbd5e1);padding:3px 10px;color:var(--dsw-alias-label-caption,#9ca3af);font-size:11px;line-height:17px;word-break:break-word}
.dshm-note.warn{border-left-color:var(--dsw-alias-state-warn-primary,#b45309)}
.dshm-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));padding:1px 7px;border-radius:5px;word-break:break-all}
.dshm-spin{display:inline-block;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2,#c7d2fe);border-top-color:var(--dsw-alias-interactive-bg-selected,#4f46e5);border-radius:50%;animation:dshm-rot .8s linear infinite;vertical-align:-2px}
@keyframes dshm-rot{to{transform:rotate(360deg)}}
.dshm-others{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px dashed var(--dsw-alias-border-l2,#e2e4e8);border-radius:10px;color:var(--dsw-alias-label-caption,#9ca3af);font-size:12px;line-height:18px}
.dshm-readme{max-height:280px;overflow:auto;background:var(--dsw-alias-bg-layer-2,rgba(38,49,72,.04));border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;padding:10px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#4b5563);margin:0}
.dshm-readme.md{font-family:inherit;white-space:normal;word-break:break-word}
.dshm-readme.md h1,.dshm-readme.md h2,.dshm-readme.md h3,.dshm-readme.md h4,.dshm-readme.md h5,.dshm-readme.md h6{margin:8px 0 4px;font-weight:700;line-height:1.4;color:var(--dsw-alias-label-primary,inherit)}
.dshm-readme.md h1{font-size:15px}.dshm-readme.md h2{font-size:14px}.dshm-readme.md h3{font-size:13px}.dshm-readme.md h4,.dshm-readme.md h5,.dshm-readme.md h6{font-size:12px}
.dshm-readme.md>:first-child{margin-top:0}
.dshm-readme.md p{margin:4px 0}
.dshm-readme.md a{color:var(--dsw-alias-state-business-primary,#4d6bfe);text-decoration:none}
.dshm-readme.md a:hover{text-decoration:underline}
.dshm-readme.md code{background:rgba(127,127,127,.16);border-radius:4px;padding:1px 4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.dshm-readme.md pre{background:rgba(127,127,127,.12);border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:8px;padding:8px 10px;overflow:auto;margin:6px 0}
.dshm-readme.md pre code{background:transparent;padding:0;font-size:11px;line-height:16px}
.dshm-readme.md img{max-height:20px;max-width:100%;vertical-align:middle}
.dshm-readme.md ul,.dshm-readme.md ol{margin:4px 0;padding-left:20px}
.dshm-readme.md li{margin:2px 0}
.dshm-readme.md blockquote{margin:6px 0;padding:2px 10px;border-left:3px solid var(--dsw-alias-border-l2,#cbd5e1);color:var(--dsw-alias-label-caption,#6b7280)}
.dshm-readme.md table{border-collapse:collapse;margin:6px 0;font-size:11px}
.dshm-readme.md th,.dshm-readme.md td{border:1px solid var(--dsw-alias-border-l2,#cbd5e1);padding:3px 8px;text-align:left}
.dshm-readme.md th{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}
.dshm-readme.md hr{border:0;border-top:1px solid var(--dsw-alias-border-l2,#cbd5e1);margin:8px 0}
.dshm-readme.md .dshm-md-note{margin-top:8px;padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l2,#cbd5e1);color:var(--dsw-alias-label-caption,#9ca3af);font-size:11px}
/* 0.9.47 HTML 子集：details/summary/kbd/mark 与 li·td 内层 p 间距收敛 */
.dshm-readme.md details{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;padding:4px 10px;margin:6px 0}
.dshm-readme.md summary{cursor:pointer;font-weight:600;margin:2px 0}
.dshm-readme.md kbd{background:rgba(127,127,127,.16);border:1px solid var(--dsw-alias-border-l2,#cbd5e1);border-bottom-width:2px;border-radius:4px;padding:0 4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.dshm-readme.md mark{background:rgba(255,213,0,.35);color:inherit;border-radius:2px;padding:0 2px}
.dshm-readme.md li>p,.dshm-readme.md td>p,.dshm-readme.md th>p,.dshm-readme.md summary>p,.dshm-readme.md p>p{margin:2px 0}
.dshm-links{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:7px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb);font-size:11px;color:var(--dsw-alias-label-caption,#6b7280)}
.dshm-links-k,.dshm-links-sep{color:var(--dsw-alias-label-caption,#9ca3af)}
.dshm-links a{color:var(--dsw-alias-state-business-primary,#4d6bfe);text-decoration:none;font-weight:500}
.dshm-links-ver{font-weight:500;color:var(--dsw-alias-label-caption,#6b7280);font-variant-numeric:tabular-nums}
.dshm-links a:hover{text-decoration:underline}
.dshm-prog{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563)}
.dshm-prog .bar{flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2,rgba(38,49,72,.08));overflow:hidden;min-width:80px}
.dshm-prog .bar i{display:block;height:100%;background:var(--dsw-alias-interactive-bg-selected,#4f46e5);transition:width .3s}
.dshm-entry{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:4px -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden}
.dshm-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dshm-entry svg{flex:none;width:16px;height:16px}
.dshm-entry span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 收起（rail）态：与宿主设置入口 / dsh-skins 同几何——36×36 圆形、margin 8/10、
   图标 18、内容水平居中。缺这套会导致收起时图标偏离轴线且行距不齐（实测左偏 ~4px）。
   2026-10-14：左右 margin 改 auto——槽位出口是列向 flex，36px 定宽按钮默认贴交叉轴
   起点（左侧）；桌面 rail 窄只有 ~4px 可感知，手机宽 rail 左偏 ~22px（手机截图像素
   实测：齿轮/调色盘/鲸鱼 cx≈99-100，市场四宫格 cx=77.5，rail 中线≈100）。auto
   margin 与 dsh-skins rail 包装层 justify-content:center 等效（palette cx=100.5）。 */
.dshm-entry.rail{width:36px;height:36px;margin:8px auto 10px;padding:0;justify-content:center;border-radius:50%;gap:0}
.dshm-entry.rail svg{width:18px;height:18px}
[data-slot="sidebar.footer.action"]{display:flex!important;flex-direction:column;width:100%;min-width:0}
[data-slot="sidebar.footer.action"]>*{flex:none;min-width:0}
.dshm-empty{text-align:center;color:var(--dsw-alias-label-caption,#6b7280);font-size:13px;padding:32px 0}
/* 头部 dsh-m 版本角标：等宽小字圆角，静态展示不加粗不可点（0.7.5 起改显 dsh-m 版本） */
.dshm-dshchip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#f5f6f8);color:var(--dsw-alias-label-secondary,#4b5563);border-radius:999px;padding:5px 10px;font:11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;flex:none}
.dshm-dshchip-v{font-weight:400;color:inherit}
/* 0.9.1：仅 self-check 判 outdated 才点亮——warn 态为可点按钮（点击即自升级）；其余静默复用静态样式 */
button.dshm-dshchip{cursor:pointer}
button.dshm-dshchip:disabled{cursor:default;opacity:.75}
.dshm-dshchip.warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b45309) 45%,transparent);background:var(--dsw-alias-state-warn-tertiary,#fffbeb);color:var(--dsw-alias-state-warn-primary,#b45309)}
.dshm-dshchip.warn:hover:not(:disabled){filter:brightness(.96)}
.dshm-dshchip .dshm-up{font-weight:600}

/* 0.4.0：开关 / 相位点 / 兼容确认弹窗 */
.dshm-dot{font-size:9px;line-height:1;vertical-align:middle;margin-right:2px}
.dshm-dot.ok{color:#22c55e}
.dshm-dot.err{color:#ef4444}
.dshm-dot.idle{color:#9ca3af}
.dshm-dot.busy{color:#f59e0b}
.dshm-switch{position:relative;display:inline-flex;align-items:center;width:34px;height:19px;border-radius:10px;background:var(--dsw-alias-fill-secondary,#d1d5db);cursor:pointer;transition:background .15s;flex:none;margin-left:auto}
/* 热区扩展（2026-10-13 UX 修复）：视觉 34×19 不变，可点面积经伪元素扩到 46×31——
   小目标 + 整卡大目标相邻的误触半径收敛；开关距卡边 12px，-6px 外溢不越出自身卡片 */
.dshm-switch::before{content:"";position:absolute;inset:-6px;border-radius:14px}
.dshm-switch input{display:none}
.dshm-switch.on{background:#22c55e}
.dshm-switch.locked{opacity:.45;cursor:not-allowed}
.dshm-switch-slider{position:absolute;left:2px;top:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.dshm-switch.on .dshm-switch-slider{left:17px}
/* 兼容确认遮罩 z 层（issue #31，0.10.24）：阻断式顶层弹层须压过自家面板(2147483000)/
   详情 Modal(2147483100)/灯箱(2147483200)——0.10.23 及以前 z-index:60 是自家 z 方案离群值，
   dsh-mobile 移动层（235–250）亦能压过它；组件侧已 portal 挂 body（market-tab.jsx），
   fixed 在 body 层恢复视口定界。 */
.dshm-compat-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2147483300}
.dshm-compat-dialog{max-width:420px;width:calc(100% - 32px);background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base,#1c2230));background:color-mix(in srgb,var(--dsw-alias-bg-base,#1c2230) 86%,transparent);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);border:1px solid var(--dsw-alias-border-l2,#333b4d);border-radius:12px;padding:16px}
.dshm-compat-title{font-weight:600;margin-bottom:8px;color:#f87171}
.dshm-compat-body{font-size:12px;margin-bottom:6px}
.dshm-compat-peers{margin:0 0 8px;padding-left:18px;font-size:12px}
.dshm-compat-peers li{font-family:ui-monospace,monospace}
.dshm-compat-risk{font-size:12px;color:#f87171;margin-bottom:12px}
/* ---------- 手机窄屏自适应（0.9.83，主人手机截图驱动） ---------- */
/* 病灶（0.9.82 实拍）：.dshm-head 单行 no-wrap flex 最小内容宽 ~440-470px，手机面板
   内容宽仅 330-365px → 行尾溢出被 .dshm-panel overflow:hidden 裁掉——winctl（还原/关闭）
   不可见不可点、版本 chip 拦腰截断、标题逐词换行、seg 键逐字竖排。
   载体选型：容器查询而非视口媒体查询——面板有还原居中/.abs 拖拽位/.full 全屏三形态，
   视口宽 ≠ 面板宽（600px 视口→568px 面板仍溢出）；容器查询跟随面板实际宽度。面板宽高
   均为 min(920px,100%)/min(680px,86vh) 公式派生、不依赖内容，inline-size 包含安全；
   灯箱 portal 挂 body（0.9.73）、分类行 sticky 在 .dshm-body 滚动容器内，均不受祖先
   inline-size 包含影响。断点：容器 720px（两行重排）与视口 600px（默认全屏判定 +
   overlay 8px）——两断点 0.9.88 起解耦：panel resize 的 min 640 落在 601–720 带时旧
   600px 断点不触发，长标题折行/seg 挤压（主人实测 2026-10-15），720 断点让 min 恒入
   两行区；副作用 = 600–720px 视口的手机全屏也两行，属修复而非回归。
   兜底语义说明（共识 Q3 + 评审 R7）：「不支持容器查询的浏览器新规则零生效」按 CSS
   条件规则组机制等效落地——.dshm-title-short 基础隐藏不依赖容器查询（老浏览器也要
   生效）；其余新规则都是整块 at-rule（@supports/@container/@media 顶层兄弟），不支持
   容器查询的浏览器对未知 at-rule 整块忽略，效果等同全部包进 @supports。不要机械再
   嵌套一层。 */
.dshm-title-short{display:none}
/* 兜底：不支持容器查询的浏览器只生效本条——短标题隐藏，视觉与旧版逐字节一致 */
@supports (container-type: inline-size) {
  .dshm-panel{container-type:inline-size}
}
/* 两行重排：行1 [短标题 ⋯spacer⋯ chip winctl]，行2 [seg 拉通]。DOM 顺序不动
  （title→divider→seg→spacer→chip→winctl），全靠 order+wrap——源锚/tab 序/读屏序
  零扰动；视觉序与 DOM 序不一致（seg 在 DOM 前、视觉在后），面板内元素少可接受 */
@container (max-width:720px){
  .dshm-head{flex-wrap:wrap;row-gap:6px}
  .dshm-head-divider{display:none}
  /* 0.9.89：两行态保留完整标题（主人提议实测采纳）——seg 让行后首行空间充裕
     （640 宽实测 612px 内容区只需 ~300px），短标题切换反而制造断点换字闪烁；
     极端窄由 .dshm-title 的 nowrap+ellipsis 兜底。DOM 双 span 与基础隐藏规则
     保留（短标题永不显示，回退零成本）。 */
  .dshm-spacer{order:1}
  .dshm-head>.dshm-dshchip{order:2}
  .dshm-winctl{order:3}
  /* 0.9.89：winctl 触控加大（36px）从容器断点迁至 pointer:coarse——按钮大小不该随
     两行/单行模式跳变（主人实测 720 边界忽大忽小），真正变量是输入方式；触屏设备
     全模式恒 36px，鼠标设备全模式恒 28px */
  .dshm-seg{order:4;flex:1 1 100%}
  .dshm-seg button{flex:1;justify-content:center;white-space:nowrap;padding:0 10px;height:36px}
  /* 版本 chip（共识 Q7 + 评审 R5 收窄）：常态隐藏（设置页随时可见）；warn 态缩为 ⬆
     icon——文字 span 全隐藏，tooltip 与点击自升级语义不变。规则以版本 chip 专属类
     .dshm-verchip 收窄：头部另有 profile 徽标（span.dshm-dshchip，仅非 web profile
     渲染），不在共识范围内，不得连带隐藏 */
  .dshm-head>.dshm-verchip:not(.warn){display:none}
  .dshm-verchip.warn .dshm-dshchip-name,.dshm-verchip.warn .dshm-dshchip-v,.dshm-verchip.warn .dshm-up-v{display:none}
}
/* overlay 窄视口兜底：还原态 8px（.full 的 padding:0 特异性 (0,2,0)>(0,1,0) 自然保持）；
   窄视口默认全屏的 JS 判定在 MarketPanel full 初始化 */
@media (max-width:600px){.dshm-overlay{padding:8px}}
/* 触控目标加大随输入方式而非宽度（0.9.89 迁移，见 720 块内注释） */
@media (pointer:coarse){.dshm-winctl{height:38px}.dshm-winctl button{height:36px}}
`;

/** CSS 内容哈希（djb2）：bundle 更新 → 哈希变 → 旧样式自动替换（GUI 长驻页面热更自愈，0.7.8）。 */
function cssVersionOf(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function ensureCss() {
  if (typeof document === "undefined") return;
  const ver = cssVersionOf(CSS);
  const el = document.getElementById("dshm-css");
  if (el) {
    // 旧 bundle 留下的样式表：不替换的话新类名（如全屏/窗口控制组）没有规则可套
    if (el.getAttribute("data-ver") === ver) return;
    el.remove();
  }
  const n = document.createElement("style");
  n.id = "dshm-css";
  n.setAttribute("data-ver", ver);
  n.textContent = CSS;
  document.head.appendChild(n);
}

export { CSS, cssVersionOf, ensureCss };
