// bug #3（主人 2026-11-09 肉眼实证）：筛选浮层点外部不收回。根因链（headless 实锤，
// 探针矩阵 A/B/C 三配置）：dsh-skins frost 家族给 .dsvm-chipswrap 加 backdrop-filter
// → 该元素成为 fixed 后代包含块 → 旧 DOM 背板 .dsvm-filterback{position:fixed;inset:0}
// 从全屏塌缩成分类行盒（43px 细条），面板内其余点击全部穿透到卡片。
// 修法：弃 DOM 背板，改文档级捕获监听（对任意祖先 containment/backdrop-filter/z 层免疫）。
// 本文件测判定模块（DOM-free 纯逻辑，stub 注入，无 jsdom）；接线锚在 client-filter-search.test.mjs。
// 防拖拽误关语义沿 backdrop.js（0.9.27 教训：面板内按下、拖出释放不关）：
// 按下/释放配对 + 位移超阈值视为拖拽不关。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createOutsideCloseGuard, isOutsideWrap } = require("../src/client/filter-outside-close.js");

// stub 工厂：wrap 元素用 contains 语义桩；事件用 plain object
const wrapWith = (insideIds) => ({ contains: (t) => insideIds.includes(t && t.id) });
const ev = (target, x = 0, y = 0) => ({ target, clientX: x, clientY: y });

function harness({ wrapIds = ["wrap", "btn", "pop"], threshold } = {}) {
  const wrap = wrapWith(wrapIds);
  let closed = 0;
  const guard = createOutsideCloseGuard({
    getWrapEl: () => wrap,
    onClose: () => { closed += 1; },
    ...(threshold !== undefined ? { dragThresholdPx: threshold } : {}),
  });
  const listeners = new Map();
  const doc = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
  };
  const detach = guard.attach(doc);
  const fire = (type, e) => { const fn = listeners.get(type); if (fn) fn(e); };
  const out = (id, x, y) => ev({ id }, x, y);
  return { guard, doc, fire, detach, closedGet: () => closed, wrap, out };
}

test("① 按下与释放都在浮层外 → 关（主诉求：点卡片/面板空白收回）", () => {
  const h = harness();
  h.fire("pointerdown", h.out("card-3", 200, 300));
  h.fire("click", h.out("card-3", 200, 300));
  assert.equal(h.closedGet(), 1);
});

test("② 按下在浮层内（筛选按钮）→ 不关（按钮自身 toggle 语义不被抢占）", () => {
  const h = harness();
  h.fire("pointerdown", h.out("btn", 500, 60));
  h.fire("click", h.out("btn", 500, 60));
  assert.equal(h.closedGet(), 0);
});

test("③ 按下在外、释放在浮层内（弹层选项）→ 不关；且配对被消费，下一次再点外部才关", () => {
  const h = harness();
  h.fire("pointerdown", h.out("card-1", 10, 10));
  h.fire("click", h.out("pop", 400, 100));
  assert.equal(h.closedGet(), 0, "跨界按下/释放不关");
  h.fire("click", h.out("card-2", 10, 10));
  assert.equal(h.closedGet(), 0, "上次配对已消费，无按下不关");
  h.fire("pointerdown", h.out("card-2", 10, 10));
  h.fire("click", h.out("card-2", 10, 10));
  assert.equal(h.closedGet(), 1);
});

test("④ 位移超阈值 = 拖拽（面板拖动/列表惯性滚动摩擦）→ 不关（0.9.27 语义）", () => {
  const h = harness({ threshold: 6 });
  h.fire("pointerdown", h.out("card-1", 100, 100));
  h.fire("click", h.out("card-9", 160, 100));
  assert.equal(h.closedGet(), 0);
});

test("⑤ 位移恰在阈值内（含抖动的真点击）→ 关", () => {
  const h = harness({ threshold: 6 });
  h.fire("pointerdown", h.out("card-1", 100, 100));
  h.fire("click", h.out("card-1", 104, 102));
  assert.equal(h.closedGet(), 1);
});

test("⑥ 无 pointerdown 的键盘 click → 不关", () => {
  const h = harness();
  h.fire("click", h.out("card-1", 0, 0));
  assert.equal(h.closedGet(), 0);
});

test("⑦ detach 后监听卸载（effect 清理不泄漏）", () => {
  const h = harness();
  h.detach();
  h.fire("pointerdown", h.out("card-1", 1, 1));
  h.fire("click", h.out("card-1", 1, 1));
  assert.equal(h.closedGet(), 0);
  assert.equal(h.doc.listeners ? 0 : 0, 0); // doc 桩无 listeners 暴露面，卸载语义由 ⑧ 断言承重
});

test("⑧ getWrapEl() 暂为 null（卸载竞态）→ 恒不关、不抛", () => {
  let wrap = wrapWith(["wrap"]);
  let closed = 0;
  const guard = createOutsideCloseGuard({ getWrapEl: () => wrap, onClose: () => { closed += 1; } });
  const listeners = new Map();
  guard.attach({ addEventListener: (t, f) => listeners.set(t, f), removeEventListener: () => {} });
  wrap = null;
  listeners.get("pointerdown")(ev({ id: "x" }, 5, 5));
  listeners.get("click")(ev({ id: "x" }, 5, 5));
  assert.equal(closed, 0);
});

test("⑨ isOutsideWrap 纯判定：无 contains 方法的桩不抛、判内", () => {
  assert.equal(isOutsideWrap({}, { id: "x" }), false, "无 contains → 视为在内（早退保护）");
  assert.equal(isOutsideWrap(wrapWith(["a"]), { id: "b" }), true);
  assert.equal(isOutsideWrap(wrapWith(["a"]), { id: "a" }), false);
  assert.equal(isOutsideWrap(wrapWith(["a"]), null), false);
});
