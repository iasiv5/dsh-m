// issue #31 移动端 compat 遮罩修复源锚（client-lightbox.test.mjs 同款惯例：includes 级，
// 红灯语义是「接线/文本变了」而非「行为变了」）。触摸关闭的行为级直测在
// tests/client-backdrop.test.mjs；这里只钉两处纯物理事实：z 层跃升与 portal 挂 body 接线。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stylesSrc = readFileSync(join(root, "src/client/styles.js"), "utf8");
const marketTabSrc = readFileSync(join(root, "src/client/market-tab.jsx"), "utf8");

test("issue #31 compat 遮罩 z 层跃升：压过自家面板/Modal/灯箱三层与 dsh-mobile 移动层（styles.js）", () => {
  assert.ok(
    stylesSrc.includes(
      ".dshm-compat-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2147483300}",
    ),
    "compat 遮罩 z-index 2147483300 在（0.10.23 及以前为离群值 60）",
  );
  assert.ok(
    (stylesSrc.match(/2147483300/g) || []).length === 1,
    "z 值出现次数=1（避免误配多条规则）",
  );
});

test("issue #31 compat 遮罩 portal 挂 body（灯箱 v2 同款，脱离 .dshm-panel backdrop-filter 包含块与 dsh-mobile 面板重排）", () => {
  assert.ok(marketTabSrc.includes("rd.createPortal(compatOverlay, document.body)"), "portal 挂 body 接线在");
  assert.ok(marketTabSrc.includes('import rd from "react-dom";'), "react-dom 显式接线在");
  assert.ok(marketTabSrc.includes('className: "dshm-compat-overlay"'), "遮罩类名在");
  assert.ok(marketTabSrc.includes("...backdropCloseHandlers(() => setCompatConfirm(null))"), "遮罩关闭接线在");
});
