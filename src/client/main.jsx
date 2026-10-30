// dsh-m client (web bundle)。构建产物 lib/client.js 由 scripts/build.mjs 包裹为
// window.__ModuleLoader__.load({ id: "dsh-m", factory: (require) => { ... } })。
// 运行环境由 loader 提供 react / react-dom（peer，零自带运行时依赖）。
// UI：3 视图（市场/已装/设置）+ 卡片展开详情 + 重启横幅。中文，跟随 DSH Web 深色主题。
const React = require("react");
const rd = require("react-dom");
const h = React.createElement;
const { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } = React;

const PLUGIN_ID = "dsh-m";

// 市场面板 pure state（Node tests 直接覆盖；0.7.0 Task 8 分区化：zone 状态工厂/页码窗口/分区 chips；0.9.25 跨区搜索：searchSourceOf）
const { DEFAULT_PAGE_SIZE, MARKET_PAGE_SIZES, pageItems, createZoneState, normalizeMarketQuery, resetPageOnFilterChange, normalizeMarketResponse, registryNotice, zoneChips, marketNotice, searchSourceOf, mergeLatestFields, marketResponseEquivalent } = require("./market-state.js");
const { readMarketSnapshot, writeMarketSnapshot, isDefaultFirstPageQuery } = require("./market-snapshot.js");
const { backdropCloseHandlers } = require("./backdrop.js");
const { lbStep, lbNeighbors, swipeDir } = require("./lightbox.js");
const { shotWheelAction } = require("./wheel-strip.js");
const { dragSlop, grabOffset, titlebarTopInset, clampPoint, loadPanelPos, savePanelPos, isDragTarget } = require("./window-drag.js");
const { clampSize, loadPanelSize, savePanelSize } = require("./window-resize.js");
const { WESERV_TIMEOUT_MS, weservUrl, serviceBucketOf, tierOrder, nextTier, needsTimeout, preferredTier, rememberSuccess } = require("./img-chain.js");
const { createMarkdown } = require("./markdown.js");
const { ExtLink, MdImg, renderMarkdown } = createMarkdown(h);
const { installedViewModel, registrySourceKey } = require("./installed-view.js");
const { toggleViewModel, toggleNoticeKeys } = require("./toggle-view.js");
const { pickPayload, parseToolArgs } = require("./tool-view.js");
const { RESTART_POLL_MS, RESTART_DEADLINE_MS, nextRestartWait, isAmbiguousRestartRequestError } = require("./restart-wait.js");
const { refreshAfterMutation } = require("./view-refresh.js");
const { applyInstalledUpdates, installedUpdateStats } = require("./installed-updates.js");
const { restoreRecords, opAppliesTo, readReconcileNotified, writeReconcileNotified, TERMINAL_CLEARABLE, REGISTRY_DEFAULT_TARGET } = require("./operations.js");
// 面板操作接线（GLOSSARY / ADR-0023 第二刀）：泵持有者 + 显式绑定 + 对账编排纯函数 + 横幅判定单源
const { getSharedOpsStore, getSharedOpsPump, bindPanelOps, unbindPanelOps, recordSettingsOp, planReconcileActions, restartBannerDecision } = require("./panel-ops.js");
const { groupOpsByDay, opRowVm, opUpgradeMeta, canRemoveRow, channelLabelKey } = require("./operations-view.js");
const { createFavoritesStore, partitionStale } = require("./favorites.js");
const { readSelfCheckCache, writeSelfCheckCache, clearSelfCheckCache, deriveChipState } = require("./self-check.js");
const { shouldShowInstallCmd } = require("./install-cmd.js");
const { createOpOutcome } = require("./op-outcome.js");
const { hasShellTakeover } = require("./shell-takeover.js");

// ---------- i18n（ADR-0023 第一刀：词典与取值函数出仓 src/client/i18n.js，main.jsx 仅保留装配） ----------
const { lookup, browserLang, communityLabels, ZH, EN } = require("./i18n.js");
// 变更结局描述（GLOSSARY，0.9.94）：五类变更结局投影的成品文案装配单源；lookup 纯函数（字典静态），模块级实例化
const oc = createOpOutcome(lookup);

// （0.7.0 Task 8：客户端 CATEGORIES 表已由 market-state.js zoneChips 取代）

// ---------- 样式（ADR-0023 第一刀：CSS 出仓 src/client/styles.js，注入端口随迁） ----------
const { ensureCss } = require("./styles.js");

// ---------- 数据 hooks（ADR-0023 第三刀：api/useAsync/useMarketData/fmtDate/useScrollableContain 出仓 src/client/hooks.js） ----------
const { api, useAsync, useMarketData, fmtDate, useScrollableContain } = require("./hooks.js");
// ---------- 组件出仓·批次一（ADR-0023 第三刀 T10） ----------
const { Icon, Spin, PhaseDot, ToggleSwitch, TwoStepButton, RestartBanner, SearchBox, XIcon, FsIcon, officialLinks, LinksRow, safeScreenshots, compactCount, Shot, UseImgChainProbe, Lightbox, useImgChain, ProgressLine, ReadmeBlock } = require("./chrome.jsx");
const { Card, snapshotOf, verifiedByline } = require("./card.jsx");
const { FavoriteZone } = require("./favorite-zone.jsx");
const { ZoneChips } = require("./zone-chips.jsx");
const { OperationsCard } = require("./operations-card.jsx");
const { DshmVersionChip } = require("./version-chip.jsx");
// ---------- 组件出仓·批次二（ADR-0023 第三刀 T11） ----------
const { DetailModal, modalDepth } = require("./detail-modal.jsx");
const { MarketTab } = require("./market-tab.jsx");
const { InstalledTab, DetailRows } = require("./installed-tab.jsx");
const { SettingsTab, Section, regSourceLabel, configStatusLabel } = require("./settings-tab.jsx");
// ---------- 通用小组件 ----------



// ---------- 社区截图消费端校验（M1 Task 9 / Q44：GitHub 图床白名单由上游保证，客户端二次校验） ----------

// ---------- 「详情」官方外链（GitHub / npm / homepage） ----------


// ---------- 0.4.0：开关 Switch 与相位点（Task 18；纯展示，状态来自 toggleViewModel） ----------



// ---------- 重启横幅（0.9.2：boot id 确认新进程后回调 onRestarted——面板就地重取 ping，角标/profile chip 不再停留旧进程数据） ----------

// ---------- 搜索框（0.7.0 Task 9：250ms debounce + IME composition 全程不提交 + draft/已提交分离 + 清除回焦） ----------

// ---------- 分区分类 chips（0.7.0 Task 10：两行折叠 + 吸顶自动收缩；0.7.2 尾部挂筛选触发器；
//            0.7.9 顺序恒定；0.9.53 方案A「隐身全量测量」（visibility:hidden 占位 + 纯派生 hiddenCount）；
//            0.9.55/0.9.56 切换钮内联化两次迭代（绝对定位夹取压 chip / in-flow 反馈振荡 #185）均回退
//            → 0.9.57 终版：被裁分类 visibility:hidden 占位（测量全量稳定、双向自愈），
//            +N 绝对定位钉在「末可见行右端预留槽」（出流，几何保证零重叠，永不挤压）----------


// ---------- 截图三层懒加载（0.7.0 Task 12：IO 200px 挂 src + loading=lazy + fetchPriority=low；
// 0.9.61 图片加载链：weserv(h=300)→原图→双败上报剔除。active:show——IO 未可见不计时 ----------

// ---------- 图片加载链 hook（0.9.61，grilling Q1-Q18 / 实施计划架构快照，勿无声改动） ----------


// ---------- 截图灯箱 v2（0.9.60） ----------

// ---------- 详情 Modal = 卡片超集（0.7.0 Task 12：「detail 显示少于摘要就是倒退」） ----------
/** Modal/Dialog 打开深度（审计修复 #4）：>0 时面板级 Esc 不关面板——Esc 只关最上层弹层。 */



// ---------- 市场页（数据由 MarketPanel 唯一持有，本组件只消费 props；0.7.0 Task 9 三分区 tab 壳） ----------

// 社区区排序（0.7.2 起选项入「筛选」弹层：filter.field 系 + filter.dir 系键，下拉 SORT_OPTIONS 退役）。



// ---------- 安装进度（轮询 host status 端点，pnpm ndjson） ----------




// ---------- 面板（3 视图容器） ----------
// ---------- 全局操作记录（0.7.0 Task 13 + 评审 P4；ADR-0023 第二刀：store/pump 持有权迁 panel-ops.js） ----------
/** 模块级单例语义不变（审计碰撞·洞1），创建与私有持有在 panel-ops.js（ToolCardRow 面板外
 *  写入事实，ADR-0023 决策 3）；此处显式取用口让 main.jsx 既有引用零改写（标识符不变）。 */
const opsStore = getSharedOpsStore();
const opsPump = getSharedOpsPump();

const TABS = [
  ["market", "tab.market", "market"],
  ["installed", "tab.installed", "installed"],
  ["settings", "tab.settings", null],
];

// ---------- 头部 dsh-m 版本角标（0.9.1：常态静默只显版本；self-check 判 outdated 才点亮为可点升级角标） ----------

// ---------- 通用 × 关闭/清除图标（SVG 线条替代字符 ×，配 .dshm-xbtn 使用） ----------

// ---------- 最大化/还原图标（窗口控制组用；full 态切换为叠层矩形） ----------

// desktop 壳标题拖拽带读数（0.9.69，quota-watch readTitlebarInset 同款契约）：只认 <html> 的
// data-windows-titlebar / data-fullscreen 属性与 --dsh-windows-titlebar-height 变量，不判版本号；
// DSH Web / 浏览器 / jsdom 无属性 → 0。该 inset 只抬 clamp 的 minY，面板永不落进系统按钮区。
function readTitlebarInsets() {
  if (typeof document === "undefined" || !document.documentElement) {
    return { left: 0, right: 0, top: 0, bottom: 0 };
  }
  const htmlEl = document.documentElement;
  let height = "";
  try {
    height = window.getComputedStyle(htmlEl).getPropertyValue("--dsh-windows-titlebar-height");
  } catch {
    /* 无窗口环境回落空串 → titlebarTopInset 判 0 */
  }
  return {
    left: 0,
    right: 0,
    top: titlebarTopInset({
      titlebar: htmlEl.hasAttribute("data-windows-titlebar"),
      fullscreen: htmlEl.hasAttribute("data-fullscreen"),
      height,
    }),
    bottom: 0,
  };
}

function MarketPanel({ onClose }) {
  const [tab, setTab] = useState("market");
  // 全屏态（0.7.7 移植 dsh-market）：localStorage 记忆（dshm-panel-fullscreen），
  // SSR/无 localStorage 环境安全降级为 false；Esc 关面板语义不变
  const FS_KEY = "dshm-panel-fullscreen";
  const [full, setFull] = useState(() => {
    try {
      // 窄视口（手机）恒全屏初始化（0.9.83 共识 Q9）：仅初始挂载判定一次、不随 resize
      // 跟随（旋转后可手动 ⛶ 切换）；FS_KEY 记忆在窄视口下不生效——防「手动还原一次被
      // 永久记住 361px 挤压态」。宽视口行为逐字节同今日（FS_KEY 照旧）。
      // matchMedia 守卫与 FS_KEY 同款防御：SSR 无 window / jsdom 缺 matchMedia 安全回落。
      if (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 600px)").matches) return true;
      return typeof window !== "undefined" && window.localStorage ? window.localStorage.getItem(FS_KEY) === "1" : false;
    } catch {
      return false;
    }
  });
  const toggleFull = useCallback(() => {
    setFull((v) => {
      const next = !v;
      try {
        if (typeof window !== "undefined" && window.localStorage) window.localStorage.setItem(FS_KEY, next ? "1" : "0");
      } catch {
        /* 配额/隐私模式静默——状态仅本页生效 */
      }
      return next;
    });
  }, []);
  // 位置记忆（0.9.69 还原态拖拽，ADR-0017）：{x,y} = 面板视口左上角绝对坐标；
  // null = 无记录 → 保持 overlay flex 居中，渲染与旧版逐字节一致。
  const panelRef = useRef(null);
  const headRef = useRef(null);
  // 滚动容器（.dshm-body）权威引用（GLOSSARY「滚动容器」）：渲染者持有、下传 MarketTab 供翻页回顶
  const bodyRef = useRef(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const [pos, setPos] = useState(() => {
    try {
      return loadPanelPos(typeof window !== "undefined" && window.localStorage ? window.localStorage : null);
    } catch {
      // 阻止 Cookie 等隐私模式下 localStorage getter 本身抛错（评审 E1-3；与 FS_KEY 同款防御）
      return null;
    }
  });
  // 尺寸记忆（panel resize）：{w,h} = 还原态面板宽高 px；null = 无记录 → 类默认
  // min(920px,100%)·min(680px,86vh)，渲染零差异。resizingRef 供 reclamp 与手势机
  // 互斥（同 draggingRef 语义，T3 置位/T4 消费）。
  const [size, setSize] = useState(() => {
    try {
      return loadPanelSize(typeof window !== "undefined" && window.localStorage ? window.localStorage : null);
    } catch {
      return null;
    }
  });
  // latest-ref 镜像用 render 期赋值（计划规格原文）：同一 commit 内 layout effect 与事件处理器
  // 读到的恒为本次 render 的值。禁改 useEffect 同步——全屏→还原 commit 上 layout 的 reclamp
  // 会先于 passive 同步执行，读到旧 fullRef=true 被守卫静默跳过（评审 E1-1 实证复现）。
  const fullRef = useRef(full);
  fullRef.current = full;
  const posRef = useRef(pos);
  posRef.current = pos;
  const sizeRef = useRef(size);
  sizeRef.current = size; // render 期赋值（latest-ref，同 posRef/fullRef 先例；T4 reclamp 禁同 tick 读它）
  const resizingRef = useRef(false);
  // 重夹紧：还原态渲染后（挂载/全屏往返）与窗口 resize 时，把记忆尺寸与记忆位置收回
  // 当前视口 + titlebar 带内；全屏态与拖拽/resize 手势中跳过（手势帧有实时钳位，全屏
  // 无几何语义）。顺序：先夹尺寸、再夹位置（评审 R1-4——位置钳位必须消费夹后尺寸，
  // 否则单次调用内「先夹尺寸再夹位置」退化为单夹，越界要等下一次 resize 才自愈）。
  const reclamp = useCallback(() => {
    if (fullRef.current || draggingRef.current || resizingRef.current || !panelRef.current || typeof window === "undefined") return;
    const vp = { width: window.innerWidth, height: window.innerHeight };
    const insets = readTitlebarInsets();
    // ① 先夹尺寸：同 tick 内 setSize 不重渲（sizeRef 是 render 期赋值），位置钳位必须
    // 复用本地计算结果、禁读 sizeRef——读了拿到的是夹前值（评审 R1-4）
    const prevSize = sizeRef.current;
    const eff = prevSize ? clampSize(prevSize, vp, insets) : null;
    if (eff && prevSize && (eff.w !== prevSize.w || eff.h !== prevSize.h)) setSize(eff);
    // ② 后夹位置：消费上面夹好的 eff（无尺寸记忆回退 rect，行为与旧版逐字节一致）
    const prev = posRef.current;
    if (!prev) return;
    const rect = panelRef.current.getBoundingClientRect();
    const next = clampPoint(
      { x: prev.x, y: prev.y },
      vp,
      eff ? { width: eff.w, height: eff.h } : { width: rect.width, height: rect.height },
      insets,
    );
    if (next.x !== prev.x || next.y !== prev.y) setPos(next);
  }, []);
  useLayoutEffect(() => {
    reclamp();
  }, [full, reclamp]);
  useEffect(() => {
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [reclamp]);
  // 拖拽状态机（0.9.69，ADR-0017）：pointer capture + 手势期才挂 document 监听 + 帧内写。
  // 拖拽帧绝不走 React state——transform 直写面板节点；释放时同步烘焙 left/top 再 setPos 收口。
  useEffect(() => {
    const headEl = headRef.current;
    if (!headEl) return undefined;
    let dragging = false;
    let moved = false;
    let slop = 6;
    let originX = 0;
    let originY = 0;
    let grab = { dx: 0, dy: 0 };
    let rest = { x: 0, y: 0 };
    let size = { width: 0, height: 0 };
    let lastPoint = null;
    const bindGesture = () => {
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerCancel);
    };
    const unbindGesture = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
    };
    const frameStep = () => {
      // 帧回调首行守卫（评审 R1-5）：释放/取消后的在途残帧一律早退，杜绝烘焙后再写 transform
      if (!dragging || !lastPoint || !panelRef.current) return;
      const topLeft = clampPoint(
        { x: lastPoint.x - grab.dx, y: lastPoint.y - grab.dy },
        { width: window.innerWidth, height: window.innerHeight },
        size,
        readTitlebarInsets(),
      );
      panelRef.current.style.transform = `translate3d(${Math.round(topLeft.x - rest.x)}px, ${Math.round(topLeft.y - rest.y)}px, 0)`;
    };
    const onPointerMove = (event) => {
      if (!dragging) return;
      if (!moved) {
        if (Math.hypot(event.clientX - originX, event.clientY - originY) < slop) return;
        moved = true;
        document.body.style.userSelect = "none";
        panelRef.current.classList.add("dshm-panel--dragging");
        panelRef.current.style.willChange = "transform";
      }
      // pointermove 只存点不写样式，样式写集中在 rAF 帧内（评审 R2-1 帧内写语义）
      lastPoint = { x: event.clientX, y: event.clientY };
      if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(frameStep);
      else frameStep();
    };
    const bakeFinal = (event) => {
      const panel = panelRef.current;
      const final = clampPoint(
        { x: event.clientX - grab.dx, y: event.clientY - grab.dy },
        { width: window.innerWidth, height: window.innerHeight },
        size,
        readTitlebarInsets(),
      );
      panel.style.left = `${final.x}px`;
      panel.style.top = `${final.y}px`;
      panel.classList.remove("dshm-panel--dragging");
      panel.style.willChange = "";
      panel.style.transform = "";
      try {
        savePanelPos(window.localStorage, final);
      } catch {
        // localStorage getter 抛错（隐私模式）：位置退化为会话级，烘焙照常生效（评审 E1-3）
      }
      suppressClickRef.current = true;
      setPos(final);
    };
    const onPointerUp = (event) => {
      if (!dragging) return;
      dragging = false;
      draggingRef.current = false;
      unbindGesture();
      document.body.style.userSelect = "";
      if (!moved) return; // 纯点击：不动位置，click/dblclick 语义照旧
      bakeFinal(event);
    };
    const onPointerCancel = () => {
      if (!dragging) return;
      dragging = false;
      draggingRef.current = false;
      unbindGesture();
      document.body.style.userSelect = "";
      // 取消不落盘：只还原视觉，位置保持拖前值（quota-watch 语义）
      const panel = panelRef.current;
      panel.classList.remove("dshm-panel--dragging");
      panel.style.willChange = "";
      panel.style.transform = "";
    };
    const onPointerDown = (event) => {
      if (dragging) return; // 多指重入守卫（评审 R1-7）：拖拽中第二指不重启手势
      if (fullRef.current || event.button !== 0 || isDragTarget(event.target)) return;
      const panel = panelRef.current;
      if (!panel) return;
      dragging = true;
      draggingRef.current = true;
      moved = false;
      lastPoint = null;
      originX = event.clientX;
      originY = event.clientY;
      slop = dragSlop(event.pointerType);
      const rect = panel.getBoundingClientRect();
      grab = grabOffset({ x: event.clientX, y: event.clientY }, rect);
      rest = { x: rect.left, y: rect.top };
      size = { width: rect.width, height: rect.height };
      if (headEl.setPointerCapture) {
        try {
          headEl.setPointerCapture(event.pointerId);
        } catch {
          /* 指针已释放等竞态静默 */
        }
      }
      bindGesture();
    };
    headEl.addEventListener("pointerdown", onPointerDown);
    return () => {
      headEl.removeEventListener("pointerdown", onPointerDown);
      unbindGesture();
      document.body.style.userSelect = "";
    };
  }, []);
  // resize 手势状态机（panel resize，T3）：pointerdown 落手柄启动；主键门卫 +
  // setPointerCapture 防御式捕获（评审 R1-3/R1-5，拖拽机同款三件）；slop 分级复用
  // dragSlop；手势期才挂 document 监听；pointermove 只存点，宽高写集中在 rAF 帧内
  // （帧回调首行守卫拦释放后残帧）；释放 clampSize（.abs 形态带 origin 第二钳，R1-2）
  // 收口 → savePanelSize + setSize 一次；cancel 还原到拖前记忆（与拖拽 cancel 语义
  // 对称）。touch/pen 不启动（Q8）。无 will-change：宽高写触发 layout，transform 的
  // 合成器通道不适用（ADR-0021 性能后果）。
  useEffect(() => {
    const panelEl = panelRef.current;
    if (!panelEl) return undefined;
    let zone = null; // "e" | "s" | "se"
    let resizing = false;
    let moved = false;
    let slop = 6;
    let originX = 0, originY = 0;
    let startW = 0, startH = 0;
    let originRect = null; // .abs 形态第二钳原点（R1-2）：pointerdown 时面板左上角；居中形态恒 null
    let lastPoint = null;
    let raf = 0;
    const ZONE_CURSOR = { e: "ew-resize", s: "ns-resize", se: "nwse-resize" };
    const bindGesture = () => {
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerCancel);
    };
    const unbindGesture = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
    };
    const frameStep = () => {
      // 帧回调首行守卫（拖拽机评审 R1-5 同款）：释放/取消后的在途残帧一律早退
      raf = 0;
      if (!resizing || !moved || !lastPoint || !panelRef.current) return;
      const raw = {
        w: zone === "s" ? startW : startW + (lastPoint.x - originX),
        h: zone === "e" ? startH : startH + (lastPoint.y - originY),
      };
      const next = clampSize(raw, { width: window.innerWidth, height: window.innerHeight }, readTitlebarInsets(), originRect);
      panelRef.current.style.width = `${Math.round(next.w)}px`;
      panelRef.current.style.height = `${Math.round(next.h)}px`;
    };
    const onPointerMove = (event) => {
      if (!resizing) return;
      if (!moved) {
        if (Math.hypot(event.clientX - originX, event.clientY - originY) < slop) return;
        moved = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = ZONE_CURSOR[zone]; // 指针出面板后光标不灭
      }
      // pointermove 只存点不写样式，样式写集中在 rAF 帧内（拖拽机评审 R2-1 帧内写语义）
      lastPoint = { x: event.clientX, y: event.clientY };
      if (!raf) raf = requestAnimationFrame(frameStep);
    };
    const onPointerUp = () => {
      if (!resizing) return;
      const baked = panelRef.current
        ? clampSize(
            moved && lastPoint
              ? { w: zone === "s" ? startW : startW + (lastPoint.x - originX), h: zone === "e" ? startH : startH + (lastPoint.y - originY) }
              : { w: startW, h: startH },
            { width: window.innerWidth, height: window.innerHeight },
            readTitlebarInsets(),
            originRect,
          )
        : null;
      unbindGesture();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizing = false;
      resizingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (!moved) return; // 纯点击手柄：无语义，不动尺寸
      try {
        savePanelSize(typeof window !== "undefined" && window.localStorage ? window.localStorage : null, baked);
      } catch {
        /* 非有限属编程错误（baked 恒有限）；localStorage 缺席由 savePanelSize 内部静默 */
      }
      setSize(baked); // 收口：inline 宽高回归 React 渲染（与拖拽烘焙 left/top 同型）
    };
    const onPointerCancel = () => {
      if (!resizing) return;
      unbindGesture();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizing = false;
      resizingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      // 还原视觉：手势期 inline 写已覆盖记忆值，按记忆回写（无记忆清空回类默认）
      if (panelRef.current) {
        panelRef.current.style.width = sizeRef.current ? `${sizeRef.current.w}px` : "";
        panelRef.current.style.height = sizeRef.current ? `${sizeRef.current.h}px` : "";
      }
    };
    const onPointerDown = (event) => {
      if (resizing) return; // 多指重入守卫（拖拽机评审 R1-7 同款）
      if (event.button !== 0) return; // 只认主键（拖拽机 main.jsx:3607 同款；评审 R1-5①）
      if (event.pointerType !== "mouse") return; // Q8：触屏/触笔不启动（coarse CSS 为 belt）
      const handle = event.target?.closest?.("[data-dshm-resize]");
      if (!handle) return;
      zone = handle.getAttribute("data-dshm-resize");
      const rect = panelRef.current.getBoundingClientRect();
      startW = rect.width; startH = rect.height;
      // origin 第二钳（R1-2）：.abs 形态（pos 记忆在）左上角固定，右/下缘不破 8px 边距；
      // 居中形态传 null——每帧 flex 重居中，传了会拿起始原点过度收紧（封死拉满路径）
      originRect = posRef.current ? { left: rect.left, top: rect.top } : null;
      originX = event.clientX; originY = event.clientY;
      slop = dragSlop(event.pointerType);
      resizing = true;
      resizingRef.current = true;
      moved = false;
      lastPoint = null;
      if (handle.setPointerCapture) {
        try {
          handle.setPointerCapture(event.pointerId); // 拖出窗外释放也能收到 pointerup（拖拽机 main.jsx:3621-3627 同款，评审 R1-3）
        } catch {
          /* 指针已释放等竞态静默；document 监听仍在，行为退化不卡死 */
        }
      }
      bindGesture();
    };
    panelEl.addEventListener("pointerdown", onPointerDown);
    return () => {
      panelEl.removeEventListener("pointerdown", onPointerDown);
      unbindGesture();
      if (raf) cancelAnimationFrame(raf);
      // 卸载时手势中途（如 Esc 关面板）：恢复 body 样式不留残留（评审 R1-5②；拖拽机 cleanup 同款）
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);
  // 市场数据唯一 owner（0.7.0 Task 9：两分区独立状态实例，切 tab 互不重置；
  // 收藏区数据在 Task 14 落地，本地 localStorage 不走 market 通道）
  const marketCommunity = useMarketData("community");
  const marketPrimary = useMarketData("primary");
  const markets = { community: marketCommunity, primary: marketPrimary };
  const installed = useAsync(() => api("installed", { probe: false }), []);
  // 两段加载（ADR-0008）第二段：探测 TTL=0 永远新鲜，挂载即与第一段并行发起；未到时卡片暂无更新提示
  const updates = useAsync(() => api("installedUpdates"), []);
  // 全局操作记录（0.7.0 Task 13 + 审计碰撞修正）：单例 store + 泵执行（queued 真实生命周期）
  // 0.9.79：渲染数据源 = 本地 + 外部合并视图（listMerged，ADR-0018）；泵/恢复仍只看本地 list()
  const [opRecords, setOpRecords] = useState(() => opsStore.listMerged().map((r) => ({ ...r })));
  const syncOps = useCallback(() => setOpRecords(opsStore.listMerged().map((r) => ({ ...r }))), []);
  // 外部操作记录（0.9.79 ADR-0018 R1-6）：面板初始化 + 每次操作完成后（runOp.finally）+
  // 打开操作记录卡（settings tab）时各 fetch 一次——常驻期间他终端变更不做轮询（一期明示）；
  // 拉取失败静默（overlay 保持上次状态，下次时机重试）；id 幂等合并由 store.setExternal 承担。
  const fetchExternalOps = useCallback(async () => {
    try {
      const r = await api("external-operations");
      if (r && Array.isArray(r.records)) {
        opsStore.setExternal(r.records);
        syncOps();
      }
    } catch {
      /* 增量审计面，不干扰主流程 */
    }
  }, [syncOps]);
  useEffect(() => {
    void fetchExternalOps(); // 面板初始化
  }, [fetchExternalOps]);
  // 打开操作记录卡（settings tab）时拉取一次（R1-6）：查看动作即刷新点，不做常驻轮询
  useEffect(() => {
    if (tab === "settings") void fetchExternalOps();
  }, [tab, fetchExternalOps]);
  // 操作记录卡跳转（第二批）：切到设置 tab 后等 React 提交再滚动定位到卡片
  const openOps = useCallback(() => {
    setTab("settings");
    if (typeof document !== "undefined") {
      setTimeout(() => {
        const el = document.querySelector(".dshm-ops-card");
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 60);
    }
  }, [setTab]);
  // 设置 tab 红点（第二批可见性补偿）：仅 failed/warned 终态点亮；清除/移除后随 syncOps 自灭
  const opsAttention = opRecords.some((r) => r.status === "failed" || r.status === "warned");
  const runOp = useCallback(
    (kind, target, exec, meta = {}, reuseId) =>
      // session:true = 活会话标记（终审·新伤1）：重挂载的 restore 跳过（泵仍拥有）；persist 时剥离。
      // 入队与 waiters/原始错误保真都在泵实现（operations.js，评审 P4：实现与测试同源）。
      // 0.9.79（R1-6）：操作终态后连带拉取一次外部记录——他终端（CLI/Agent 工具）的并发变更
      // 尽快可见；拉取失败静默。
      opsPump.enqueue({ ...(reuseId ? { id: reuseId } : {}), kind, target, status: "queued", meta: { ...meta, session: true } }, exec).finally(() => {
        void fetchExternalOps();
      }),
    [fetchExternalOps],
  );
  /** 处置待决记录（CompatDialog 取消 → superseded「用户放弃」）。 */
  const disposeOp = useCallback((id, note) => {
    opsStore.upsert({ id, status: "superseded", error: note });
    syncOps();
  }, [syncOps]);
  const ops = { records: opRecords, runOp, dispose: disposeOp };
  // 收藏（0.7.0 Task 14）：本地 localStorage，不进 profile 不进服务端
  const favStoreRef = useRef(null);
  if (!favStoreRef.current) {
    favStoreRef.current = createFavoritesStore(typeof window !== "undefined" && window.localStorage ? window.localStorage : null);
  }
  const favStore = favStoreRef.current;
  const [favList, setFavList] = useState(() => favStore.list());
  const favorites = {
    list: favList,
    toggle: useCallback((snapshot) => setFavList(favStore.toggle(snapshot)), [favStore]),
    removeIds: useCallback((ids) => setFavList(favStore.removeIds(ids)), [favStore]),
  };
  // dsh-m 自身版本：挂载时随 ping 带回（0.7.5 起头部 chip 改显 dsh-m 版本，DSH 运行版本看设置页）；失败/缺席 → chip 整个隐藏（不留占位）
  // 0.9.2：提取 reloadPing——一键重启确认新进程后与页面回前台时各重取一次，
  // 修「面板不关跨服务重启 → 角标/能力提示停留旧进程数据」（0.9.1 实测：芯片升级 + 重启后仍显 v0.9.0）
  const [pluginVersion, setPluginVersion] = useState(null);
  // 0.9.0 双 profile：ping.profile { name, kind, source }——chip 与重启引导的数据源；缺席 = 旧宿主，按 web 处理
  const [profile, setProfile] = useState(null);
  const reloadPing = useCallback(() => {
    let live = true;
    api("ping")
      .then((r) => {
        if (!live) return;
        setPluginVersion(typeof r?.version === "string" && r.version ? r.version : null);
        setProfile(r?.profile && typeof r.profile === "object" ? r.profile : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => reloadPing(), [reloadPing]);
  // 页面回到前台时重取（面板常开、服务在后台被外部重启的场景；visibilitychange 零轮询成本）
  useEffect(() => {
    const onVis = () => {
      if (typeof document !== "undefined" && !document.hidden) reloadPing();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reloadPing]);
  // Registry 配置或任一 profile mutation 后，视图一起刷新，避免单页快照不同步（两分区同刷）。
  const marketReloadAll = useCallback(
    (force) => {
      marketCommunity.reload(force)
      marketPrimary.reload(force)
    },
    [marketCommunity.reload, marketPrimary.reload],
  )
  const refreshViews = useCallback(
    () => refreshAfterMutation({ marketReload: marketReloadAll, installedReload: installed.reload, updatesReload: updates.reload }),
    [marketReloadAll, installed.reload, updates.reload],
  );
  const onRegistryChanged = refreshViews;
  // 恢复/泵共用上下文（审计碰撞·洞3：单一执行路径）。stillApplies 一律执行时实读（禁止复用快照）。
  const stillApplies = useCallback(async (r) => {
    let fresh = null;
    try {
      fresh = await api("installed", { probe: false });
    } catch {
      fresh = null;
    }
    const items = fresh && Array.isArray(fresh.items) ? fresh.items : null;
    if (!items) return true; // 读不到已装数据：保守放行（泵 dispatch 前还会再校验）
    // 评审 P2：github 源 install 经 registryGithub ∪ meta.github 比对（核心判定在 opAppliesTo，可测）
    return opAppliesTo(r, items);
  }, []);
  const dispatchRestored = useCallback(async (r) => {
    try {
      if (r.kind === "install") {
        await api("install", { id: r.target, ...(r.meta && r.meta.version ? { version: r.meta.version } : {}) });
      } else if (r.kind === "upgrade") {
        await api("upgrade", { pkg: r.target, ...(r.meta && r.meta.force ? { force: true } : {}) });
      } else if (r.kind === "uninstall") {
        await api("uninstall", { pkg: r.target });
      } else {
        await api("set-enabled", { pkg: r.target, enabled: r.meta && r.meta.on === true });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), ...(e && e.issue ? { issue: e.issue } : {}) };
    }
  }, []);
  // ADR-0023 第二刀：泵上下文经显式绑定装配（取代原先的模块级可变单例上下文，见 panel-ops.js 持有者）；
  // deps 无 refreshViews——全库无消费死字段已删（Q16）。未绑定 = 现行降级语义（operations.js 泵侧判空路径零改动）。
  useEffect(() => {
    bindPanelOps({ stillApplies, dispatchRestored, syncOps });
    return () => {
      unbindPanelOps();
    };
  }, [stillApplies, dispatchRestored, syncOps]);
  // 0.10.3（挂账 1）：中断升级的账实复读缝——返回 target 的实装版本（恢复对账用；读法与 stillApplies 同款实读）
  const installedVersionOf = useCallback(async (r) => {
    try {
      const fresh = await api("installed", { probe: false });
      const items = fresh && Array.isArray(fresh.items) ? fresh.items : [];
      const row = items.find((it) => it && it.pkg === r.target);
      return row && typeof row.version === "string" ? row.version : undefined;
    } catch {
      return undefined;
    }
  }, []);
  // 恢复时序（0.7.0 Task 13）：installed resolve → restoreRecords（校验改标）→ 启动**同一个**前台泵
  // ADR-0023 第二刀（Q10/Q17）：判定在 restoreRecords（纯）、副作用编排经 planReconcileActions 出计划；
  // 适配器只执行——逐条落账序与 0.10.7 现行崩溃窗口语义逐字节一致。
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !installed.data) return;
    restoredRef.current = true;
    void (async () => {
      const restored = await restoreRecords(opsStore.list(), stillApplies, installedVersionOf);
      // 0.10.7（Q1-b/Q2-a）：已读集合存独立 localStorage 键（记录生命周期外），键 = id|target|toVersion 元组
      const reconcileStorage = typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
      const seen = readReconcileNotified(reconcileStorage);
      const plan = planReconcileActions(restored, seen);
      // 0.10.7（A 方案·主人裁决）：先落账后补报——persist 抛错则静默放弃该次提醒（丢失一次 < 重复轰炸），
      // 并留诊断（Q5-a：真机「每开必弹」的复活机制未定谳，此行是它的第一手踪迹）
      try {
        opsStore.replaceAll(plan.replacements);
      } catch (err) {
        console.error("[dsh-m] restore persist failed:", err);
        return;
      }
      for (const n of plan.notifications) {
        seen.add(n.dedupeKey);
        writeReconcileNotified(reconcileStorage, seen);
        notify({ kind: "ok", text: lookup(n.i18nKey, n.params) });
      }
      syncOps();
      if (plan.shouldKick) {
        void opsPump.kick(); // 洞3：恢复并入前台泵（单一执行路径；drainRestored 循环退役）
      }
    })();
  }, [installed.data, stillApplies, installedVersionOf, syncOps]);
  const counts = {
    market: marketCommunity.data ? marketCommunity.data.total : null,
    installed: installed.data ? installed.data.items.length : null,
  };
  // 两段加载（ADR-0008）：updates 就地合并出 merged 视图；updates 未到时 merged 即第一段原样（红点 0，不误点亮）
  const mergedItems = installed.data && Array.isArray(installed.data.items)
    ? applyInstalledUpdates(installed.data.items, updates.data && Array.isArray(updates.data.updates) ? updates.data.updates : [])
    : null;
  // 更新红点（0.7.0 Task 15）：已装页存在 outdated 时已装 tab 打点
  const outdatedCount = installedUpdateStats(mergedItems || []).outdatedCount;
  const [banner, setBanner] = useState(null); // { text } | null
  const [toast, setToast] = useState(null); // { kind, text } | null
  // 0.9.72 滚轮治理：toast 长文本同款——可滚才挂 contain，不满限时不吞滚轮
  const [toastTextRef, toastScrollCls] = useScrollableContain(toast ? toast.text : "");
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && modalDepth() === 0 && onClose) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (!toast) return;
    // err 文案可能带回滚/自愈长报告，6s 读不完；ok 6s、info 12s（官方入口指引）、err 15s
    const t = setTimeout(() => setToast(null), toast.kind === "err" ? 15000 : toast.kind === "info" ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [toast]);
  // needsRestart 为 true 才出重启横幅（安装/卸载/升级/自更新）；registry 配置只 toast
  const notify = useCallback(({ kind, text, needsRestart }) => {
    setToast({ kind, text });
    if (kind === "ok" && needsRestart) {
      // 0.9.0：Desktop 不由 dsh-m 重启——横幅改为官方生命周期指引（无一键重启按钮）
      setBanner(
        profile && profile.kind === "desktop"
          ? { desktop: true, text: lookup("profile.restartHint") }
          : { text: lookup("banner.done") },
      );
    }
  }, [profile]);
  return h(
    "div",
    // 0.9.27 防拖拽误关：面板内按下拖选到遮罩释放时，click 落在公共祖先（遮罩）上——旧 onClick: onClose 会误关面板
    { className: full ? "dshm-overlay full" : "dshm-overlay", ...backdropCloseHandlers(onClose) },
    h(
      "div",
      {
        className: ["dshm-panel", full && "full", !full && pos && "abs"].filter(Boolean).join(" "),
        // panel resize：尺寸记忆以 inline 宽高覆盖类默认 min(920px,100%)·min(680px,86vh)；
        // 与位置记忆互不诱发（就地生长：居中形态只带 width/height 仍由 flex 居中）
        style: !full
          ? {
              ...(pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : {}),
              ...(size ? { width: `${size.w}px`, height: `${size.h}px` } : {}),
            }
          : undefined,
        ref: panelRef,
        onClick: (e) => e.stopPropagation(),
      },
      h(
        "div",
        {
          className: "dshm-head",
          title: full ? undefined : lookup("panel.dragHint"),
          ref: headRef,
          onDoubleClick: (e) => {
            if (isDragTarget(e.target)) return;
            toggleFull();
          },
          onClickCapture: (e) => {
            // 拖拽释放后的尾部 click 吞掉（quota-watch suppressNextClick 同款），防误触头部子元素
            if (!suppressClickRef.current) return;
            suppressClickRef.current = false;
            e.stopPropagation();
            e.preventDefault();
          },
        },
        h("span", { className: "dshm-title" },
          h("span", { className: "dshm-title-full" }, lookup("title.full")),
          h("span", { className: "dshm-title-short" }, lookup("title.panel")),
        ),
        h("span", { className: "dshm-head-divider", "aria-hidden": "true" }),
        h(
          "div",
          { className: "dshm-seg", role: "tablist" },
          TABS.map(([key, labelKey, countKey]) =>
            h("button", {
              key,
              type: "button",
              role: "tab",
              "aria-selected": tab === key,
              className: tab === key ? "on" : "",
              onClick: () => setTab(key),
            },
              lookup(labelKey),
              countKey && counts[countKey] != null ? h("span", { className: "dshm-count" }, String(counts[countKey])) : null,
              key === "installed" && outdatedCount > 0 ? h("span", { className: "dsvm-reddot", title: lookup("installed.upgradeAll", { n: outdatedCount }) }) : null,
              // 底部操作区搬迁补偿（第二批）：failed/warned 终态无人主动逛设置页，红点兜底可见性
              key === "settings" && opsAttention ? h("span", { className: "dsvm-reddot", title: lookup("settings.ops.reddot") }) : null,
            ),
          ),
        ),
        h("span", { className: "dshm-spacer" }),
        pluginVersion ? h(DshmVersionChip, { version: pluginVersion, notify, ops }) : null,
        profile && profile.kind !== "web"
          ? h("span", { className: "dshm-dshchip", title: lookup("profile.chipTitle", { name: profile.name }) }, profile.name)
          : null,
        // 窗口控制组（0.7.7）：最大化/还原 + 关闭，连体设计（系统化窗口按钮）
        h(
          "div",
          { className: "dshm-winctl", role: "group", "aria-label": lookup("panel.fullscreen") },
          h("button", {
            type: "button",
            title: lookup(full ? "panel.restore" : "panel.fullscreen"),
            "aria-label": lookup(full ? "panel.restore" : "panel.fullscreen"),
            onClick: toggleFull,
          }, h(FsIcon, { full })),
          h("button", {
            type: "button",
            className: "danger",
            title: lookup("common.close"),
            "aria-label": lookup("common.close"),
            onClick: onClose,
          }, h(XIcon)),
        ),
      ),
      h(
        "div",
        { className: "dshm-body", ref: bodyRef },
        tab === "market" ? h(MarketTab, { notify, markets, onMutation: refreshViews, ops, favorites, profileKind: profile?.kind ?? null, onOpenOps: openOps, bodyRef }) : null,
        tab === "installed" ? h(InstalledTab, { notify, installed, updates, onMutation: refreshViews, ops }) : null,
        tab === "settings" ? h(SettingsTab, {
          notify,
          version: pluginVersion,
          onRegistryChanged,
          onForceMarket: () => marketReloadAll(true),
          opsRecords: opRecords,
          onOpsClearFinished: () => {
            opsStore.clearFinished();
            opsStore.clearExternal(); // 0.9.79：外部记录 overlay 同步清空（R1-3 overlay 语义）
            syncOps();
            // 服务端连带清除（ADR-0018）：失败静默——服务端仍是唯一事实源，下次 fetch 幂等并回
            void api("external-operations-clear").catch(() => {});
          },
          onOpsRemove: (rec) => {
            if (rec && rec.channel) {
              // 0.9.82 修订 R2-3：外部记录 ✕ = 服务端 per-id 删除；成功才动 overlay（强于 clear 的
              // fire-and-forget）；复活由 store 墓碑拦住（clearExternal 重置）；失败行保留 + toast
              // （0.9.6 反无声 no-op 裁决）
              api("external-operations-remove", { id: rec.id })
                .then(() => {
                  opsStore.removeExternal(rec.id);
                  syncOps();
                })
                .catch((err) => {
                  notify({ kind: "err", text: lookup("op.remove.failed", { err: (err && err.message) || "unknown" }) });
                });
            } else {
              opsStore.remove(rec.id); // 面板本地路径：现状逐字节不动（R0 红线）
              syncOps();
            }
          },
        }) : null,
        // 操作记录已整体搬迁至设置 tab 末位通宽卡（0.9.x 布局重构·第二批）：底部不再常驻
      ),
        // toast/横幅 overlay 化（2026-10-13 UX 修复）：原先是面板 column flex 的流内子元素，
        // 出现/消失会压缩 body(flex:1) 造成二次抖动；现挂 absolute 底部浮层（.dshm-banner-stack），
        // 零布局参与。stack 用 pointer-events:none 放行下层点击，banner 自身恢复 auto。
        toast || banner
          ? h(
              "div",
              { className: "dshm-banner-stack" },
              toast
                ? h("div", { className: toast.kind === "err" ? "dshm-banner err" : "dshm-banner" },
                    h("span", { className: `dshm-banner-text${toastScrollCls}`, ref: toastTextRef }, toast.text))
                : null,
              banner ? h(RestartBanner, { note: banner.text, onDone: () => setBanner(null), desktop: banner.desktop === true, onRestarted: reloadPing }) : null,
            )
          : null,
        // resize 热区（panel resize）：透明无视觉；pointer-only 供性（aria-hidden）。
        // 全屏态不渲染（Task 5 CSS @media pointer:coarse 与 .full belt 另有双保险）；
        // data-dshm-resize 供 T3 手势机 closest 门卫。
        !full && h("div", { className: "dshm-rz rz-e", "data-dshm-resize": "e", "aria-hidden": "true" }),
        !full && h("div", { className: "dshm-rz rz-s", "data-dshm-resize": "s", "aria-hidden": "true" }),
        !full && h("div", { className: "dshm-rz rz-se", "data-dshm-resize": "se", "aria-hidden": "true" }),
    ),
  );
}

// ---------- 侧栏入口（命令式挂载，规避宿主 React 与 bundle React 的双实例 state 问题） ----------
function mountPanel() {
  if (typeof document === "undefined") return;
  ensureCss();
  const existing = document.getElementById("dshm-panel-root");
  if (existing) {
    // React 在渲染异常后会清空树，但不移除命令式挂载容器；旧 guard 会使入口永久失效。
    if (existing.querySelector(".dshm-panel")) return;
    existing.remove();
  }
  const container = document.createElement("div");
  container.id = "dshm-panel-root";
  document.body.appendChild(container);
  // react-dom 可能为 CJS 或 ESM namespace，做一层互操作
  const rdom = rd && rd.default && (rd.default.createRoot || rd.default.render) ? rd.default : rd;
  let root = null;
  const close = () => {
    try {
      if (root && typeof root.unmount === "function") root.unmount();
      else if (rdom && typeof rdom.unmountComponentAtNode === "function") rdom.unmountComponentAtNode(container);
    } catch {
      /* ignore */
    }
    container.remove();
  };
  if (rdom && typeof rdom.createRoot === "function") {
    root = rdom.createRoot(container);
    root.render(h(MarketPanel, { onClose: close }));
  } else if (rdom && typeof rdom.render === "function") {
    rdom.render(h(MarketPanel, { onClose: close }), container);
  } else {
    container.remove();
  }
}

// 同系列线性图标（16×16 / stroke currentColor / 1.4，与 PlazaIcon 同约定）：宫格 + 放大镜
function MarketIcon() {
  // 与 DSH 官方图标家族对齐：24 视箱 / strokeWidth 2 / 16px 渲染（Lucide layout-grid 构型）
  return h("svg", { viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", "aria-hidden": "true" },
    h("rect", { x: "3", y: "3", width: "7", height: "7", rx: "1", stroke: "currentColor", strokeWidth: "2" }),
    h("rect", { x: "14", y: "3", width: "7", height: "7", rx: "1", stroke: "currentColor", strokeWidth: "2" }),
    h("rect", { x: "3", y: "14", width: "7", height: "7", rx: "1", stroke: "currentColor", strokeWidth: "2" }),
    h("rect", { x: "14", y: "14", width: "7", height: "7", rx: "1", stroke: "currentColor", strokeWidth: "2" }),
  );
}

// ---------- 壳接管诊断（2026-10-30 哨兵退役，issue #33；裁定史、契约勘误与备案见 shell-takeover.js 模块头 + docs/adr/0027） ----------
// 旧哨兵（负 priority 接管即整行让位）地基两处不成立：① 官方契约被截断误读——
// SidebarRoot 原文是「工作区中段区域归 workspaces 注册者，页脚（settings +
// footer.action）恒由官方壳渲染」（rc.3/rc.4 注释与渲染两证），页脚从不移交；
// 整壳替换场景下 footer.action 条目根本不挂载，天然隐身，无需让位。② locale
// 白名单对无声明字段的接管者（ds-bot 0.2.4，freePriority 动态取位）结构性失效，
// 两次误伤在案（issue #4 codex-ui、issue #33 better-workspace）。现仅诊断：
// MarketEntry 每次 render 后的 useEffect 打点，会话级一次性 flag 防重复；
// 晚挂载接管能否补打点取决于宿主侧槽订阅（尽力而为：漏报仅少一条诊断信息，
// 首挂载即检出已覆盖主场景，不涉行为正确性）。
let dshmSlotsRef = null;
let takeoverDiagnosticShown = false;
const diagnoseShellTakeover = () => {
  if (takeoverDiagnosticShown) return;
  let taken = false;
  try {
    taken = hasShellTakeover(
      (dshmSlotsRef && dshmSlotsRef.entries ? dshmSlotsRef.entries("sidebar.workspaces") : []) || [],
    );
  } catch {
    taken = false;
  }
  if (taken) {
    takeoverDiagnosticShown = true;
    console.info("[dsh-m] 侧栏工作区座位被外部接管（负 priority），市场入口照常在场");
  }
};

function MarketEntry(props) {
  useEffect(() => ensureCss(), []);
  useEffect(() => {
    diagnoseShellTakeover();
  });
  const rail = !(props && props.wide);
  return h(
    "button",
    {
      className: rail ? "dshm-entry rail" : "dshm-entry",
      onClick: () => {
        try {
          mountPanel();
        } catch (e) {
          console.error("[dsh-m] 打开市场面板失败:", e);
        }
      },
      title: "插件市场",
    },
    h(MarketIcon),
    props && props.wide ? h("span", null, lookup("market.title")) : null,
  );
}

// ---------- 工具卡片视图（tool.call.toolview slots） ----------
// props 契约移植自 skillhub：payload 从 props 中寻找含 items 数组的节点；args 读 block.call.argsRaw。
// ---------- 注册兼容层（2026-10-13 ds-bot single-slot 事故的 dsh-m 侧防线） ----------
// single/keyed/list 槽位在「同区分键 + 同 priority」重复注册时，register() 会在
// apply 同步栈内直接抛错，打挂整个插件激活（cordis fiber state=3）。dsh-m 的注册
// 面全是自命名空间（id=dshm-market、key=dshm_*），正常不会撞；这层防线保证万一
// 被占位时降级为告警 + 空释放器——市场面板等其余功能继续存活，而不是整插件熄灭。
function safeRegister(slots, options, component) {
  const label = `${options.name}${options.key != null ? `:${options.key}` : options.id != null ? `#${options.id}` : ""}`;
  try {
    return slots.register(options, component);
  } catch (error) {
    if (!/already has a registration|already has an entry/.test(String((error && error.message) || error))) throw error;
    console.warn(`[dsh-m] slot "${label}" is contested; dsh-m yields it and keeps running`, error);
    return () => {};
  }
}

function registerSlot(slots, options, component) {
  const next = { ...options };
  if (next.id == null && next.key != null) next.id = String(next.key);
  if (next.key == null && next.id != null) next.key = next.id;
  return safeRegister(slots, next, component);
}


function ToolCardRow({ it, onInstalled }) {
  const [busy, setBusy] = useState(false);
  const [guardNote, setGuardNote] = useState(null);
  const install = async (e) => {
    e.stopPropagation();
    setBusy(true);
    // 审计 #13 处置（碰撞建议）：对话区卡片直连 api 保留本地反馈，但顺手 upsert 一条记录——
    // 事后打开面板可见（纯写不读，单例 store 不依赖面板挂载）
    const rec = opsStore.upsert({ kind: "install", target: it.id, status: "running", meta: { npm: it.npm, github: it.github, session: true } });
    try {
      const res = await api("install", { id: it.id });
      opsStore.upsert({ id: rec.id, status: "done" });
      onInstalled({ ...it, installed: true, installedPkg: res.pkg, installedVersion: res.version });
    } catch (err) {
      // M2 Task 3：静默分支不再吞守卫拦截——工具卡片就地标注（对话区文本仍为主通道）
      opsStore.upsert({ id: rec.id, status: err && err.issue ? "input" : "failed", error: String((err && err.message) || err) });
      // 已知残余（0.9.94 grill Q1）：工具卡片短版守卫文案有意留守——单点、形状与全版不同（无 repairBasis/restartSafe 段），不为它扩接口。
      if (err && err.guard) {
        setGuardNote(`${lookup("guard.blocked")} · ${err.guard.compensation?.status || "—"} · ${lookup("guard.noforce")}`);
      }
    } finally {
      setBusy(false);
    }
  };
  return h(
    "div",
    { className: "dshm-card", style: { cursor: "default" } },
    h(Icon, { entry: it }),
    h(
      "div",
      { className: "dshm-meta" },
      h(
        "div",
        { className: "dshm-top" },
        h("span", { className: "dshm-name" }, it.name),
        h("span", { className: "dshm-badge info" }, it.source === "npm" ? "npm" : "github"),
        it.installed ? h("span", { className: "dshm-badge" }, "已安装") : null,
      ),
      h("div", { className: "dshm-desc" }, it.description),
      guardNote ? h("div", { className: "dshm-err" }, guardNote) : null,
      h("div", { className: "dshm-sub" }, `${it.id} · ${(it.tags || []).join("、") || it.category}`),
      h(LinksRow, { npm: it.npm, github: it.github, homepage: it.homepage }),
      h(
        "div",
        { className: "dshm-actions" },
        !it.installed
          ? h("button", { className: "dshm-btn primary sm", disabled: busy, onClick: install }, busy ? h(Spin) : "安装")
          : null,
      ),
    ),
  );
}

function SearchToolView(props) {
  useEffect(() => ensureCss(), []);
  const payload = pickPayload(props);
  const args = parseToolArgs(props);
  const query = String(payload?.query || args.query || "").trim();
  const fromTool = Array.isArray(payload?.items) && payload.items.length ? payload.items : null;
  const running = !!(props?.block && !("kind" in props.block));
  const [items, setItems] = useState(fromTool || []);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (fromTool) setItems(fromTool);
  }, [fromTool]);
  useEffect(() => {
    if (fromTool || running) return;
    let live = true;
    api("search", { query, category: args.category, limit: args.limit })
      .then((d) => {
        if (live) setItems(d.items || []);
      })
      .catch(() => {
        if (live) {
          setItems([]);
          setErr(lookup("notice.toolview.err"));
        }
      });
    return () => {
      live = false;
    };
  }, [query, running, !!fromTool]); // eslint-disable-line react-hooks/exhaustive-deps
  if (running) return null;
  if (!items.length) return err ? h("div", { className: "dshm-err" }, err) : null;
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "8px" } },
    items.map((it) =>
      h(ToolCardRow, {
        key: it.id,
        it,
        onInstalled: (next) => setItems((cur) => cur.map((x) => (x.id === next.id ? next : x))),
      }),
    ),
  );
}

function ListToolView(props) {
  useEffect(() => ensureCss(), []);
  const payload = pickPayload(props);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) return null;
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" } },
    items.map((it) =>
      h(
        "div",
        { key: it.pkg, className: "dshm-row" },
        h("span", { style: { fontWeight: 600 } }, it.name),
        h("span", { className: "dshm-hint" }, `(${it.pkg})`),
        h("span", { className: "dshm-hint" }, `v${it.version || "?"}`),
        it.registryId ? h("span", { className: "dshm-badge" }, "市场") : h("span", { className: "dshm-badge info" }, "非市场"),
        it.outdated ? h("span", { className: "dshm-badge warn" }, `可升级${it.latestVersion ? ` → v${it.latestVersion}` : ""}`) : null,
      ),
    ),
  );
}

// ---------- loader 契约：factory 返回 { inject, apply } ----------
const inject = ["slots"];

function apply(ctx) {
  const slots = ctx.slots;
  if (!slots) return;
  dshmSlotsRef = slots;
  ctx.effect(() => ensureCss(), "dshm-style");
  // 双语：向宿主注册 locale 字典（侧栏 label 随系统语言切换）
  ctx.inject(["locale"], (c) => {
    if (!c.locale || typeof c.locale.register !== "function") return;
    c.effect(() => {
      try {
        return c.locale.register("dshm", { zh: ZH, en: EN });
      } catch {
        return () => {};
      }
    }, "dshm-locale");
  });
  slots.inject("sidebar.footer.action", () =>
    safeRegister(
      slots,
      // 页脚 order 维持正数工具位（9）：order 只影响页脚条目排序——官方 harness
      // 页脚与接管视图（ds-bot Bot 模式等）读同一台账，DS Bot 入口（-200）恒在
      // 本工具行之上。2026-10-13 曾试装深负 order（-400/-500）让 ds-bot 集群贴底，
      // 壳接管哨兵上线后该做法只剩 harness 视图副作用（DS Bot 入口沉底），已回撤
      // （裁定：让位归哨兵、排序归 order）。2026-10-30 哨兵退役（ADR-0027）：接管
      // 视图下入口照常在场，order 9 照常参与排序（工具行贴在 DS Bot 条目之后）。
      { name: "sidebar.footer.action", id: "dshm-market", key: "dshm-market", order: 9, locale: "dshm", label: () => lookup("market.title") },
      function DshmMarketEntry(actionProps) {
        return h(MarketEntry, actionProps);
      },
    ),
  );
  // 对话区内 dshm_* 工具结果的自定义卡片
  slots.inject("tool.call.toolview", () =>
    registerSlot(slots, { name: "tool.call.toolview", key: "dshm_search" }, SearchToolView),
  );
  slots.inject("tool.call.toolview", () =>
    registerSlot(slots, { name: "tool.call.toolview", key: "dshm_list" }, ListToolView),
  );
  slots.inject("tool.call.toolview", () =>
    registerSlot(slots, { name: "tool.call.toolview", key: "dshm_outdated" }, ListToolView),
  );
}
