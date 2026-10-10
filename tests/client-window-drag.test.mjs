/**
 * 0.9.69 还原态面板拖拽：window-drag 纯逻辑单测。
 * 覆盖：slop 分级、grab 偏移、clamp（8px 边距 + desktop titlebar 契约）、
 * 实心固化色解析（计算值强制 α=1，病态回落 null）、位置存取（垃圾/异常回落 null）。
 * 运行：node --test tests/client-window-drag.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  POS_KEY,
  PANEL_MARGIN,
  DRAG_SLOP_MOUSE,
  DRAG_SLOP_TOUCH,
  dragSlop,
  grabOffset,
  titlebarTopInset,
  clampPoint,
  solidifyColor,
  loadPanelPos,
  savePanelPos,
  isDragTarget,
} from "../src/client/window-drag.js";

const mapStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
};

describe("window-drag 常量（契约锚）", () => {
  it("存储键与边距/slop 契约值", () => {
    assert.equal(POS_KEY, "dshm-panel-pos");
    assert.equal(PANEL_MARGIN, 8);
    assert.equal(DRAG_SLOP_MOUSE, 6);
    assert.equal(DRAG_SLOP_TOUCH, 10);
  });
});

describe("dragSlop 分级（tap 优先于拖）", () => {
  it("mouse→6；touch/pen→10；未知→6", () => {
    assert.equal(dragSlop("mouse"), 6);
    assert.equal(dragSlop("touch"), 10);
    assert.equal(dragSlop("pen"), 10);
    assert.equal(dragSlop(undefined), 6);
  });
});

describe("grabOffset（指针相对面板左上）", () => {
  it("130,90 抓在 100,60 的面板上 → {dx:30,dy:30}", () => {
    assert.deepEqual(grabOffset({ x: 130, y: 90 }, { left: 100, top: 60 }), { dx: 30, dy: 30 });
  });
});

describe("titlebarTopInset（desktop 拖拽带契约：0.1.20 引入，0.1.24 核对）", () => {
  it("titlebar 且非全屏且 height>0 才取值，其余一律 0", () => {
    assert.equal(titlebarTopInset({ titlebar: true, fullscreen: false, height: "40px" }), 40);
    assert.equal(titlebarTopInset({ titlebar: true, fullscreen: true, height: "40px" }), 0);
    assert.equal(titlebarTopInset({ titlebar: false, fullscreen: false, height: "40px" }), 0);
    assert.equal(titlebarTopInset({ titlebar: true, fullscreen: false, height: "" }), 0);
    assert.equal(titlebarTopInset({ titlebar: true, fullscreen: false, height: "abc" }), 0);
  });
});

describe("clampPoint（8px 边距 + insets）", () => {
  const vp = { width: 1000, height: 800 };
  const size = { width: 400, height: 300 };
  const zero = { left: 0, right: 0, top: 0, bottom: 0 };

  it("零 insets：超界点收回 [8, viewport-8-size]", () => {
    assert.deepEqual(clampPoint({ x: -50, y: 2000 }, vp, size, zero), { x: 8, y: 492 });
  });
  it("top inset 40 只抬 minY 不削 maxY（{x:-50,y:20}→{x:8,y:48}）", () => {
    assert.deepEqual(clampPoint({ x: -50, y: 20 }, vp, size, { left: 0, right: 0, top: 40, bottom: 0 }), { x: 8, y: 48 });
  });
  it("size 大于视口：Math.max 退化守卫回落 {x:8,y:8}", () => {
    assert.deepEqual(clampPoint({ x: 0, y: 0 }, { width: 100, height: 100 }, size, zero), { x: 8, y: 8 });
  });
});

describe("solidifyColor（计算色强制 α=1；病态/不可解析→null）", () => {
  it("rgb/rgba/color(srgb) 三形态固化", () => {
    assert.equal(solidifyColor("rgb(255, 255, 255)"), "rgb(255, 255, 255)");
    assert.equal(solidifyColor("rgba(12, 26, 38, 0.47)"), "rgb(12, 26, 38)");
    assert.equal(solidifyColor("color(srgb 0.047 0.102 0.149 / 0.47)"), "rgb(12, 26, 38)");
  });
  it("α<0.05 视为病态透明，回落 null（CSS 侧回退 Canvas）", () => {
    assert.equal(solidifyColor("rgba(0, 0, 0, 0)"), null);
    assert.equal(solidifyColor("rgba(0, 0, 0, 0.04)"), null);
  });
  it("不可解析格式回落 null", () => {
    assert.equal(solidifyColor("oklab(0.5 0 0)"), null);
    assert.equal(solidifyColor("transparent"), null);
  });
});

describe("loadPanelPos（垃圾/null/异常一律 null）", () => {
  it("合法 JSON 读回 {x,y}", () => {
    const s = mapStorage();
    s.setItem(POS_KEY, JSON.stringify({ x: 12.5, y: -3 }));
    assert.deepEqual(loadPanelPos(s), { x: 12.5, y: -3 });
  });
  it("garbage / 缺失字段 / storage=null / getItem 抛异常 → null", () => {
    const s = mapStorage();
    s.setItem(POS_KEY, "garbage");
    assert.equal(loadPanelPos(s), null);
    s.setItem(POS_KEY, JSON.stringify({ x: "a" }));
    assert.equal(loadPanelPos(s), null);
    assert.equal(loadPanelPos(null), null);
    const boom = { getItem: () => { throw new Error("boom"); } };
    assert.equal(loadPanelPos(boom), null);
  });
});

describe("savePanelPos（roundtrip；非法点抛 TypeError；setItem 异常静默）", () => {
  it("存取 roundtrip 一致", () => {
    const s = mapStorage();
    savePanelPos(s, { x: 33, y: 44 });
    assert.deepEqual(loadPanelPos(s), { x: 33, y: 44 });
  });
  it("非有限点抛 TypeError；setItem 抛异常不向外传播（位置退化为会话级）", () => {
    const s = mapStorage();
    assert.throws(() => savePanelPos(s, { x: "a", y: 1 }), TypeError);
    const boom = { getItem: () => null, setItem: () => { throw new Error("boom"); } };
    assert.doesNotThrow(() => savePanelPos(boom, { x: 1, y: 2 }));
  });
});

describe("isDragTarget（拖拽门卫：命中 button 即让位）", () => {
  it("closest 命中 → true；未命中/无 closest/null → false", () => {
    assert.equal(isDragTarget({ closest: () => "button" }), true);
    assert.equal(isDragTarget({ closest: () => null }), false);
    assert.equal(isDragTarget(null), false);
    assert.equal(isDragTarget({}), false);
  });
});

// ---------- 接线存在性结构锚（0.9.69 Task 3；断言 main.jsx 源串，仓库惯例同 client-lightbox） ----------
describe("main.jsx 拖拽接线结构锚", () => {
  const src = readFileSync(new URL("../src/client/main.jsx", import.meta.url), "utf8");

  it("require window-drag 模块（纯逻辑接线入口）", () => {
    assert.ok(src.includes('require("./window-drag.js")'), "main.jsx 必须 require ./window-drag.js");
  });
  it("双击切全屏走 isDragTarget 门卫（button 区不触发）", () => {
    assert.ok(src.includes("onDoubleClick"), "head 需挂 onDoubleClick");
    assert.ok(/onDoubleClick[^}]*isDragTarget/s.test(src), "onDoubleClick 内须经 isDragTarget 门卫");
  });
  it("位置记忆读写接进 MarketPanel（loadPanelPos/savePanelPos）", () => {
    assert.ok(src.includes("loadPanelPos"), "初始化读位置记忆");
    assert.ok(src.includes("savePanelPos"), "释放时写位置记忆");
  });
  it("负向锚：POS_KEY 字面量只允许活在 window-drag.js（恒绿 tripwire，不计入失败数对账）", () => {
    assert.equal(src.includes('"dshm-panel-pos"'), false, "main.jsx 不得硬编码存储键字面量");
  });
});
