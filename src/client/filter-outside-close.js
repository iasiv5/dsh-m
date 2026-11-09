/**
 * 筛选浮层「点外部即收」判定（DOM-free 纯逻辑，node:test 直测：tests/client-filter-outside-close.test.mjs）。
 *
 * 为什么不用 DOM 背板（bug 实录 2026-11-09，主人肉眼实证 + headless 探针矩阵 A/B/C 定谳）：
 * 旧方案是 .dsvm-filterback{position:fixed;inset:0;z-index:25} 全屏透明背板。dsh-skins frost
 * 家族给 .dsvm-chipswrap（sticky 分类行）加 backdrop-filter 玻璃——backdrop-filter 会把元素
 * 变成 fixed 后代的包含块，背板遂从全屏塌缩成分类行盒（实测 43px 细条），面板内其余区域点击
 * 全部穿透到卡片，浮层永不收回。灯箱 v2 / compat 遮罩同困过面板级 backdrop-filter 包含块
 * （chrome.jsx 灯箱注释），靠 portal 逃逸；筛选背板隔离态更碎（分类行/面板两层都可能出现），
 * 文档级捕获监听对任意祖先 containment/backdrop-filter/z 层战争免疫，一次根治。
 *
 * 防拖拽误关沿 backdrop.js（0.9.27 教训：面板内按下、拖出释放不关）同族语义：
 * pointerdown/click 配对 + 位移超阈值视为拖拽不关。键盘 click（无 pointerdown）天然不关。
 */

/** 纯判定：target 是否在 wrap 之外。wrap 缺失 / 无 contains 桩 / 无 target 一律视为「在内」（早退保护，宁可不关不误关）。 */
export function isOutsideWrap(wrapEl, target) {
  return Boolean(
    wrapEl &&
      typeof wrapEl.contains === "function" &&
      target &&
      !wrapEl.contains(target),
  );
}

/**
 * 构造文档级守卫。attach(doc) 挂 pointerdown+click 捕获监听并返回卸载函数；
 * onClose 在「按下与释放都在浮层外且位移未超阈值」时触发一次。
 */
export function createOutsideCloseGuard({ getWrapEl, onClose, dragThresholdPx = 6 }) {
  let down = null; // { x, y, outside }——上一(pointerdown)的落点与内外判定
  const onPointerDown = (e) => {
    down = e
      ? { x: e.clientX, y: e.clientY, outside: isOutsideWrap(getWrapEl ? getWrapEl() : null, e.target) }
      : null;
  };
  const onClick = (e) => {
    const started = down;
    down = null; // 单次消费：无按下配对的 click（键盘）不关
    if (!started || !started.outside) return;
    if (
      e &&
      Number.isFinite(e.clientX) &&
      Number.isFinite(e.clientY) &&
      Number.isFinite(started.x) &&
      Number.isFinite(started.y) &&
      Math.hypot(e.clientX - started.x, e.clientY - started.y) > dragThresholdPx
    ) {
      return; // 位移超阈值 = 拖拽（面板拖动 / 列表惯性滚动摩擦），0.9.27 语义不关
    }
    if (isOutsideWrap(getWrapEl ? getWrapEl() : null, e && e.target) && typeof onClose === "function") {
      onClose();
    }
  };
  const attach = (doc) => {
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("click", onClick, true);
    return () => {
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("click", onClick, true);
    };
  };
  return { onPointerDown, onClick, attach };
}
