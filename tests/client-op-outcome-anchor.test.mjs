// 0.9.94 retro：op-outcome 接线锚永久钉（client-about-version.test.mjs 同款源锚惯例，
// 红灯语义是「文本变了」——这里刻意如此：守卫五段装配回流消费方文件本身就该是红灯）。
// join(" | ") 恰为守卫全版五段装配特征（0.9.94 收敛时 3→0，见 CHANGELOG 0.9.94 与
// docs/patrols/2026-10-17.md）；mutationFailed 为六站点接线标识。
// ADR-0023 T10/T11：站点随组件分文件——两锚改为消费面文件集合的目录级合计（op-outcome.js
// 自身的定义处排除在扫描面外；T11 批次二出仓后再把四个 .jsx 加入 CONSUMER_FILES）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// 消费面文件集合（装配回流/站点脱管的可落点；不含 op-outcome.js 定义处）
const CONSUMER_FILES = [
  "src/client/main.jsx",
  "src/client/chrome.jsx",
  "src/client/card.jsx",
  "src/client/favorite-zone.jsx",
  "src/client/zone-chips.jsx",
  "src/client/operations-card.jsx",
  "src/client/version-chip.jsx",
  "src/client/detail-modal.jsx",
  "src/client/installed-tab.jsx",
  "src/client/market-tab.jsx",
  "src/client/settings-tab.jsx",
  "src/client/upgrade-flow.js",
];
const consumerSrc = CONSUMER_FILES.map((f) => readFileSync(join(root, f), "utf8")).join("\n");
const count = (needle) => consumerSrc.split(needle).length - 1;

test("0.9.94 守卫装配特征 join(\" | \") 在消费面文件归零（回流即红；ADR-0023 目录级合计）", () => {
  assert.equal(count('join(" | ")'), 0, "守卫文案装配已单源 op-outcome.js，消费面文件出现 join(\" | \") 即装配回流");
});

test("0.9.94 六站点 mutationFailed 接线在位（出仓前 ≥6；#36 升级编排出仓后 installed/market 两站合一为 upgrade-flow，站点数结构性 −1 → ≥5；卸站点需同步改本锚；ADR-0023 目录级合计）", () => {
  assert.ok(count("mutationFailed") >= 5, "mutationFailed 接线站点不足 5——变更结局投影有站点脱管");
});
