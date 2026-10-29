// 0.9.83 手机窄屏自适应源锚（client-lightbox.test.mjs 同款惯例：includes 级，
// 红灯语义是「文本变了」而非「行为变了」；几何/计算样式走 scripts/verify-panel-mobile.mjs）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/client/main.jsx"), "utf8");
// ADR-0023 第一刀：CSS 锚改读 styles.js（JSX/接线锚仍读 main.jsx）
const stylesSrc = readFileSync(join(root, "src/client/styles.js"), "utf8");

test("0.9.83 容器查询载体与断点（共识 Q1/Q2/Q3）", () => {
  assert.ok(stylesSrc.includes("@supports (container-type: inline-size)"), "@supports 兜底在");
  assert.ok(stylesSrc.includes(".dshm-panel{container-type:inline-size}"), "面板容器声明在");
  assert.ok(stylesSrc.includes("@container (max-width:720px){"), "容器断点 720 在（0.9.88 起与视口 600 解耦：resize min 640 恒入两行区）");
  assert.ok(stylesSrc.includes("@media (max-width:600px){.dshm-overlay{padding:8px}}"), "overlay 窄视口 8px 在");
  assert.ok(stylesSrc.includes(".dshm-title-short{display:none}"), "短标题基础隐藏（老浏览器逐字节同旧版）");
});

test("0.9.83 头部两行重排（共识 Q4/Q6/Q8）", () => {
  assert.ok(stylesSrc.includes(".dshm-head{flex-wrap:wrap;row-gap:6px}"), "头部换行在");
  assert.ok(stylesSrc.includes(".dshm-head-divider{display:none}"), "分隔线窄容器隐藏在");
  assert.ok(stylesSrc.includes(".dshm-spacer{order:1}"), "spacer order 在");
  assert.ok(stylesSrc.includes(".dshm-head>.dshm-dshchip{order:2}"), "chip order 在（版本 chip 与 profile 徽标都靠右）");
  assert.ok(stylesSrc.includes(".dshm-winctl{order:3}"), "winctl order 在");
  assert.ok(!/@container \(max-width:720px\)\{[^@]*\.dshm-winctl button\{height:36px\}/.test(stylesSrc), "winctl 触控 36 不再挂容器断点（0.9.89：按钮大小不随两行/单行跳变）");
  assert.ok(stylesSrc.includes("@media (pointer:coarse){.dshm-winctl{height:38px}.dshm-winctl button{height:36px}}"), "winctl 触控 36 随输入方式（coarse）在");
  assert.ok(stylesSrc.includes(".dshm-seg{order:4;flex:1 1 100%}"), "seg 换行拉通在");
  assert.ok(stylesSrc.includes(".dshm-seg button{flex:1;justify-content:center;white-space:nowrap;padding:0 10px;height:36px}"), "seg 均分/nowrap/36px 在");
});

test("0.9.83 标题双 span 切换（共识 Q5）", () => {
  assert.ok(src.includes('className: "dshm-title-full"'), "全称 span 在");
  assert.ok(src.includes('className: "dshm-title-short"'), "短标题 span 在");
  assert.ok(src.includes('lookup("title.panel")'), "短标题用现成 title.panel key");
});

test("0.9.83 版本 chip 窄容器收拢（共识 Q7 + 评审 R5 专属类收窄；JSX 面随 chip 迁 version-chip.jsx——ADR-0023 T10）", () => {
  const versionChipSrc = readFileSync(join(root, "src/client/version-chip.jsx"), "utf8");
  assert.ok(stylesSrc.includes(".dshm-head>.dshm-verchip:not(.warn){display:none}"), "常态版本 chip 隐藏在（profile 徽标不命中）");
  assert.ok(stylesSrc.includes(".dshm-verchip.warn .dshm-dshchip-name,.dshm-verchip.warn .dshm-dshchip-v,.dshm-verchip.warn .dshm-up-v{display:none}"), "warn 收拢为 icon 在");
  assert.ok(versionChipSrc.includes('className: "dshm-dshchip dshm-verchip"'), "常态分支专属类在（version-chip.jsx）");
  assert.ok(versionChipSrc.includes('className: "dshm-dshchip dshm-verchip warn"'), "warn 分支专属类在（version-chip.jsx）");
  assert.ok(versionChipSrc.includes('className: "dshm-dshchip-name"'), "前缀文本节点已包 span（version-chip.jsx）");
  assert.ok(versionChipSrc.includes('className: "dshm-up-v"'), "升级版本号文本节点已包 span（version-chip.jsx）");
});

test("0.9.83 窄视口默认全屏初始化（共识 Q9）", () => {
  assert.ok(src.includes('window.matchMedia("(max-width: 600px)")'), "窄视口判定在");
  assert.ok(src.includes('window.matchMedia("(max-width: 600px)").matches) return true'), "窄视口恒全屏先于 FS_KEY");
});
