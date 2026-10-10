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

const RGB_RE = /^rgba?\(([^)]+)\)$/i;
const COLOR_SRGB_RE = /^color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\)$/i;

/**
 * 拖拽态实心固化（皮肤免疫，ADR-0017）：输入 getComputedStyle 的最终背景色
 * （引擎已解析皮肤变量与 color-mix），把 α 数学上强制为 1，输出不透明 rgb()。
 * 玻璃皮肤（openbmc/uefi 的 bg-base α=0.55 病类）因此无法让拖拽中面板透光——
 * 变量是皮肤的自由度，计算值才是真相。α<0.05（病态近全透明）或不可解析格式
 * （oklab/transparent 等）返回 null，调用方不写变量，CSS 回落 Canvas 系统色。
 */
export function solidifyColor(computedColor) {
  if (typeof computedColor !== "string") return null;
  const srgb = COLOR_SRGB_RE.exec(computedColor.trim());
  if (srgb) {
    const alpha = srgb[4] !== undefined ? Number.parseFloat(srgb[4]) : 1;
    if (!Number.isFinite(alpha) || alpha < 0.05) return null;
    const to255 = (v) => Math.round(Number.parseFloat(v) * 255);
    return `rgb(${to255(srgb[1])}, ${to255(srgb[2])}, ${to255(srgb[3])})`;
  }
  const rgb = RGB_RE.exec(computedColor.trim());
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => p.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    const r = Number.parseFloat(parts[0]);
    const g = Number.parseFloat(parts[1]);
    const b = Number.parseFloat(parts[2]);
    const a = parts.length === 4 ? Number.parseFloat(parts[3]) : 1;
    if (![r, g, b, a].every(Number.isFinite)) return null;
    if (a < 0.05) return null;
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }
  return null;
}

/** 读取位置记忆：JSON + 有限性校验，storage 缺席/损坏/异常一律 null（居中兜底）。 */
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
