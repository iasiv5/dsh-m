// 0.9.84/0.9.85 设置页「关于」版本号源锚（client-lightbox.test.mjs 同款惯例：includes 级，
// 红灯语义是「文本变了」而非「行为变了」）。
// ADR-0023 T11：SettingsTab 锚随组件迁 settings-tab.jsx；调用点锚留 main.jsx（MarketPanel 保留区）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/client/main.jsx"), "utf8");
const stSrc = readFileSync(join(root, "src/client/settings-tab.jsx"), "utf8");

test("0.9.85 关于卡链接行尾挂裸版本号（缺失态零占位、零悬空点；settings-tab.jsx）", () => {
  assert.ok(stSrc.includes('h("span", { className: "dshm-links-ver" }, `v${version}`)'), "链接行版本 span 在（settings-tab.jsx）");
  assert.ok(/version\s*\?\s*\[\s*h\("span", \{ className: "dshm-links-sep" \}/.test(stSrc), "分隔点与版本同现（null 整段不渲染）在");
  // 0.9.84 的标题行 sub 挂法退役（真机对照后迁链接行）
  assert.ok(!stSrc.includes('Section(lookup("settings.about"), version'), "标题 sub 挂法已退役（settings-tab.jsx）");
});

test("0.9.84 pluginVersion 接线 SettingsTab（ping 单一事实源，不新增数据通路）", () => {
  assert.ok(stSrc.includes("function SettingsTab({ notify, onRegistryChanged, onForceMarket, onForceUpdates, opsRecords, onOpsClearFinished, onOpsRemove, version })"), "SettingsTab 签名收 version 在（settings-tab.jsx；onForceUpdates 为 ADR-0008 修订第四腿，0.12.12）");
  assert.ok(/h\(SettingsTab, \{[^}]*version: pluginVersion/s.test(src), "调用点传 version: pluginVersion 在（MarketPanel，main.jsx 保留区）");
});
