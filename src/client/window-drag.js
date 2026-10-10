/**
 * window-drag：还原态面板拖拽的 DOM-free 纯逻辑（0.9.69）。
 * Point/rect 值由调用方传入，本模块不触碰 DOM——node:test 可直接单测。
 * 公式契约与 dsh-quota-watch prefs.mjs/drag.mjs 逐字对齐（契约自 0.1.20 引入，
 * 参照核对于 0.1.24；决策记录见 docs/adr/0017-panel-drag-position-model.md）。
 * 仓库 `"type":"module"`：本文件必须用 ESM 具名导出，禁用 module.exports。
 */

/** localStorage 键：{"x":number,"y":number} = 面板视口左上角绝对坐标。 */
export const POS_KEY = "dshm-panel-pos";

/** 拖拽可及边距（四周）；top 额外叠加 titlebar inset。 */
export const PANEL_MARGIN = 8;

/** 拖拽判定门槛：鼠标 6px；触屏/触笔 10px（tap 优先于拖）。 */
export const DRAG_SLOP_MOUSE = 6;
export const DRAG_SLOP_TOUCH = 10;

/** Touch/pen 手势用大门槛，tap 不被误判为拖。 */
export function dragSlop(pointerType) {
  return pointerType === "touch" || pointerType === "pen" ? DRAG_SLOP_TOUCH : DRAG_SLOP_MOUSE;
}

/** 指针相对面板左上的抓取偏移，拖拽中保持抓点不漂。 */
export function grabOffset(point, rect) {
  return { dx: point.x - rect.left, dy: point.y - rect.top };
}

/**
 * Windows Desktop 壳标题栏契约（quota-watch 0.1.20 引入，0.1.24 核对）：壳跑
 * `titleBarStyle:hidden + titleBarOverlay`，窗口顶部是一条全宽 `-webkit-app-region:drag`
 * 拖拽带——按布局吞点击、无视 z-index，面板落进去就再也抓不回来。壳在 <html> 上以
 * `data-windows-titlebar` + `--dsh-windows-titlebar-height` 标记该带，全屏时清除；
 * DSH Web / 浏览器 / jsdom 无此属性 → 恒 0，零漂移。
 */
export function titlebarTopInset({ titlebar = false, fullscreen = false, height } = {}) {
  if (!titlebar || fullscreen) return 0;
  const value = Number.parseFloat(height);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

const ZERO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 };

function normalizeSize(size) {
  if (typeof size === "number") return { width: size, height: size };
  const width = typeof size?.width === "number" ? size.width : 0;
  const height = typeof size?.height === "number" ? size.height : 0;
  return { width, height };
}

function finiteInset(v) {
  return Number.isFinite(v) ? v : 0;
}

/** 面板左上角钳位：四周 PANEL_MARGIN，各向叠加 insets；Math.max 防退化（size 大于视口）。 */
export function clampPoint(point, viewport, size = 0, insets = ZERO_INSETS) {
  const { width, height } = normalizeSize(size);
  const insetLeft = finiteInset(insets?.left);
  const insetRight = finiteInset(insets?.right);
  const insetTop = finiteInset(insets?.top);
  const insetBottom = finiteInset(insets?.bottom);
  const minX = PANEL_MARGIN + insetLeft;
  const minY = PANEL_MARGIN + insetTop;
  const maxX = Math.max(minX, viewport.width - insetRight - PANEL_MARGIN - width);
  const maxY = Math.max(minY, viewport.height - insetBottom - PANEL_MARGIN - height);
  return {
    x: Math.min(Math.max(point.x, minX), maxX),
    y: Math.min(Math.max(point.y, minY), maxY),
  };
}

/** 位置记忆读取：JSON + 有限性校验，storage 缺席/损坏/异常一律 null（居中兜底）。 */
export function loadPanelPos(storage) {
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    const raw = storage.getItem(POS_KEY);
    if (typeof raw !== "string" || raw === "") return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y)
    ) {
      return null;
    }
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

/** 写位置记忆：非有限点属编程错误，抛 TypeError；setItem 异常静默——位置退化为会话级。 */
export function savePanelPos(storage, point) {
  if (
    typeof point !== "object" ||
    point === null ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    throw new TypeError(`invalid panel position: ${JSON.stringify(point)}`);
  }
  try {
    storage.setItem(POS_KEY, JSON.stringify({ x: point.x, y: point.y }));
  } catch {
    /* storage 不可用（配额/隐私模式）；位置仅本会话生效 */
  }
}

/** 拖拽门卫：pointerdown 落在 button（tab/全屏/关闭钮）上即让位，点击语义永远优先于拖拽。 */
export function isDragTarget(el) {
  return Boolean(el?.closest?.("button"));
}
