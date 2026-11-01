/**
 * ADR-0023 第三刀 T10 组件出仓·批次一（card.jsx）：自 main.jsx verbatim 迁移，
 * 函数体零重写；依赖经 ESM import 显式接线（由抽取脚本按标识符使用自动生成）。
 * 成员：Card, snapshotOf, verifiedByline
 */
import React from "react";
const h = React.createElement;
import { lookup } from "./i18n.js";

// B 方案（2026-10-13）：verified 从卡面徽章降级为 byline 灰字——徽章位让给例外信号（弃用/自用/可升级），
// 兼容信息零丢失（详情弹窗「实测版本」行保留全量清单；tooltip 仍挂完整列表）。
// 取 verified 末位＝按 008/022 纪律按时间顺序追加的最新复验版本。
const verifiedByline = (it) =>
  it.community !== true && Array.isArray(it.verified) && it.verified.length
    ? { text: lookup("byline.verified", { v: it.verified[it.verified.length - 1] }), title: it.verified.join("、") }
    : null;

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

export { Card, snapshotOf, verifiedByline };
