#!/usr/bin/env node
// registry-style.mjs — registry.json 的唯一格式化器（retro R4）。
// 用法:
//   node scripts/registry-style.mjs --fix    # 把 registry.json 重写为规范风格（默认）
//   node scripts/registry-style.mjs --check  # 当前文件与规范输出逐字节比对，不一致 exit 1
// 规范风格：2 空格骨架；条目 4 空格花括号；字段 6 空格逐行；数组行内（JSON.stringify 语义）；
// 结尾换行。验收面 = tests/registry-format.test.mjs（改风格先改这里与该测试，两处同源）。
// 编辑 registry 条目后先跑 --fix（或 --check），再跑三测，再谈推送。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const registryPath = fileURLToPath(new URL("../registry.json", import.meta.url));
const mode = process.argv.includes("--check") ? "check" : "fix";

const data = JSON.parse(readFileSync(registryPath, "utf8"));
const fieldLines = (obj) =>
  Object.entries(obj)
    .map(([key, value]) => `      ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join(",\n");
const entryBlock = (plugin) => `    {\n${fieldLines(plugin)}\n    }`;
const canonical = `{\n  "version": ${JSON.stringify(data.version)},\n  "plugins": [\n${data.plugins
  .map(entryBlock)
  .join(",\n")}\n  ]\n}\n`;

const current = readFileSync(registryPath, "utf8");
if (mode === "check") {
  if (current !== canonical) {
    console.error("registry-style: --check 不通过——当前文件与规范风格不一致，跑 --fix 修复");
    process.exit(1);
  }
  console.log(`registry-style: check 通过（${data.plugins.length} 条，规范风格）`);
} else {
  if (current === canonical) {
    console.log(`registry-style: 已是规范风格（${data.plugins.length} 条）`);
  } else {
    writeFileSync(registryPath, canonical);
    console.log(`registry-style: 已重写为规范风格（${data.plugins.length} 条）`);
  }
}
