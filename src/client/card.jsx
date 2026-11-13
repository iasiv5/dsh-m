/**
 * ADR-0023 第三刀 T10 组件出仓·批次一（card.jsx）：自 main.jsx verbatim 迁移，
 * 函数体零重写；依赖经 ESM import 显式接线（由抽取脚本按标识符使用自动生成）。
 * 成员：Card, snapshotOf, statsTitle
 */
import React from "react";
const h = React.createElement;
import { lookup } from "./i18n.js";

// 下载量口径透明 title（ADR-0036）：目录快照无前缀、直查带「npm · 」前缀，携带 30 天窗口与查于时点
//（数据缺失段留空）。原「实测 ≤v」灰字（B 方案 2026-10-13）随卡面统一退役——实测全量清单仍在详情
// 弹窗「实测版本」行（唯一权威呈现）。
const statsTitle = (it) => {
  const win = it.downloadsStart && it.downloadsEnd ? it.downloadsStart + "~" + it.downloadsEnd : "";
  const via = it.statsVia === "direct" ? "npm · " : "";
  return via + lookup("byline.statsTitle", { win, at: it.downloadsCheckedAt || "" });
};

function Card({ icon, name, nameTitle, badges, desc, sub, links, open, onToggle, detail, actions, topRight, byline, clampLines }) {
  return h(
    "div",
    {
      className: "dshm-card",
      role: "button",
      tabIndex: 0,
      onClick: onToggle,
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") onToggle();
      },
    },
    icon,
    h(
      "div",
      { className: "dshm-meta" },
      h("div", { className: "dshm-top" }, h("span", { className: "dshm-name", title: nameTitle }, name), ...badges.filter(Boolean), topRight || null),
      byline && byline.length
        ? h("div", { className: "dsvm-byline" }, ...byline.map((b, i) => h("span", { key: i, title: b.title || undefined }, b.text)))
        : null,
      h("div", { className: "dshm-desc", style: open ? { WebkitLineClamp: "unset" } : clampLines ? { WebkitLineClamp: String(clampLines) } : null }, desc),
      sub ? h("div", { className: "dshm-sub" }, sub) : null,
      links || null,
      open ? h("div", { className: "dshm-detail" }, detail) : null,
      open && actions && actions.length ? h("div", { className: "dshm-actions" }, ...actions) : null,
    ),
  );
}

function snapshotOf(it) {
  const s = {
    id: it.id,
    name: it.name,
    description: it.description,
    category: it.category,
    categoryLabel: it.categoryLabel,
    source: it.source,
  };
  // 收藏头像修复（2026-10-31）：icon/iconDataUri 入快照——快照此前无图标字段，收藏卡头像
  // 恒退化到 GitHub owner 头像（ADR-0025 候选序末位）；新收藏离线也有图标。存量收藏由
  // favorite-zone 的 market-ids-exist icons 覆盖 + 已装 iconDataUri join 兜底（icon-view.js）。
  for (const k of ["descriptionEn", "npm", "github", "homepage", "owner", "downloads", "stars", "added", "deprecated", "verified", "audience", "decoupled", "icon", "iconDataUri"]) {
    if (it[k] !== undefined && it[k] !== null) s[k] = it[k];
  }
  return s;
}

export { Card, snapshotOf, statsTitle };
