/**
 * ADR-0023 第三刀 T10 组件出仓·批次一（favorite-zone.jsx）：自 main.jsx verbatim 迁移，
 * 函数体零重写；依赖经 ESM import 显式接线（由抽取脚本按标识符使用自动生成）。
 * 成员：FavoriteZone
 */
import React from "react";
const h = React.createElement;
const { useState, useEffect } = React;
import { api } from "./hooks.js";
import { lookup } from "./i18n.js";
import { partitionStale, withFavoriteStats } from "./favorites.js";
import { LinksRow, Icon, compactCount } from "./chrome.jsx";
import { Card } from "./card.jsx";
import { withFavoriteIcons } from "./icon-view.js";

// 收藏头像修复（2026-10-31）：installedIcons = main.jsx 由已装数据装配的别名索引
// （buildInstalledIconIndex：registryId/npm/github → iconDataUri），社区收藏的已装插件借此
// 用真图标（社区页 iconDataUri join 同款呈现）；缺席（SSR/旧调用面）安全降级既有链。
function FavoriteZone({ favorites, onOpen, installedIcons }) {
  const list = favorites.list;
  const [check, setCheck] = useState(null); // { staleIds: string[], iconsById?: Record<string, unknown> | null, statsById?: Record<string, unknown> | null } | null
  useEffect(() => {
    let live = true;
    setCheck(null);
    if (!list.length) return;
    // 审计 #15：800ms debounce 合并突变（快速 toggle 不逐次全量重查）；
    // toggle 引发的重查保留——顺带校验新收藏是否刚收录就已下架
    const timer = setTimeout(() => {
      void (async () => {
        // 0.9.87 FP2：stale 判定批量化——单次 market-ids-exist（merged 域 id Set 成员判定）取代
        // 逐收藏完整 market 查询扇出（C3 语义保留：只要「id 还在不在」的成员布尔，零 latest 探测）。
        // 失败/形态异常 → 空 Set = 全部保守 stale（与旧逐条 catch→false 同语义）。
        let present = new Set();
        let iconsById = null;
        let statsById = null; // 收藏统计新鲜度（2026-11-13）：目录现行 downloads/stars（同批零新增请求）
        try {
          const res = await api("market-ids-exist", { ids: list.map((f) => f.id) });
          if (res && Array.isArray(res.present)) present = new Set(res.present);
          // 收藏头像修复（2026-10-31）：目录声明 icon 随 membership 同批透出（core 既有字段零
          // 新 IO）——快照无 icon 的存量收藏借此拿回目录图标；旧宿主响应无 icons 键 → null 判缺容错。
          if (res && res.icons && typeof res.icons === "object") iconsById = res.icons;
          if (res && res.stats && typeof res.stats === "object") statsById = res.stats;
        } catch {
          present = new Set();
        }
        const lookupLive = async (fav) => present.has(fav.id);
        const { stale } = await partitionStale(list, lookupLive);
        if (live) setCheck({ staleIds: stale.map((f) => f.id), iconsById, statsById });
      })();
    }, 800);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [list]);
  if (!list.length) {
    return h("div", { className: "dshm-empty" }, lookup("favorites.hint"));
  }
  const staleSet = new Set((check && check.staleIds) || []);
  return h(
    React.Fragment,
    null,
    check && staleSet.size
      ? h(
          "div",
          { className: "dshm-hint" },
          lookup("favorites.stale", { n: staleSet.size }),
          " ",
          h("button", { className: "dshm-btn sm", onClick: () => favorites.removeIds([...staleSet]) }, lookup("favorites.clean")),
        )
      : null,
    !check ? h("div", { className: "dshm-hint" }, lookup("favorites.checking")) : null,
    h(
      "div",
      { className: "dshm-cards" },
      ...list.map((fav) => {
        // 收藏统计新鲜度（2026-11-13）：目录现行 downloads/stars 覆盖收藏时刻的冻结快照（icons 同款 overlay）
        const s = withFavoriteStats(fav.snapshot, check && check.statsById);
        const isStale = staleSet.has(fav.id);
        return Card({
          key: fav.id,
          // 三层装配（icon-view.js DOM-free 直测）：目录现行 icon（本批 market-ids-exist 响应）
          // 覆盖快照 → 快照自带 icon/iconDataUri（新收藏）→ 已装 iconDataUri 别名 join → 头像回退
          icon: h(Icon, { entry: withFavoriteIcons(s, check && check.iconsById, installedIcons) }),
          name: s.name,
          badges: [
            s.deprecated === true ? h("span", { className: "dshm-badge warn", key: "dep" }, lookup("badge.deprecated")) : null,
            // 0.9.45 U12（R7 收窄）：无 owner = 精选条目——补「精选」身份徽标；
            // verified 徽标已移除（2026-10-13 B 方案：卡面只留例外信号，实测信息在详情弹窗「实测版本」行）；
            // 受众/解耦徽标不进收藏区（DESIGN §2.7 裁决⑤「已装视图与收藏页不打标」），快照仅存字段
            s.owner
              ? h("span", { className: "dshm-badge info", key: "c" }, lookup("badge.community"))
              : h("span", { className: "dshm-badge", key: "cz" }, lookup("zone.primary")),
            h("span", { className: "dshm-badge info", key: "s" }, s.source === "npm" ? "npm" : "github"),
            isStale ? h("span", { className: "dshm-badge warn", key: "st" }, lookup("favorites.stalebadge")) : null,
          ],
          // ADR-0036 owner 门放宽：有数字就显数字（精选收藏经 join/直查同源覆盖）；空数组 → Card 不渲染
          byline: [
            s.owner ? { text: `by ${s.owner}` } : null,
            typeof s.downloads === "number" ? { text: `${compactCount(s.downloads)} ↓`, title: String(s.downloads) } : null,
            typeof s.stars === "number" ? { text: `${compactCount(s.stars)} ★`, title: String(s.stars) } : null,
          ].filter(Boolean),
          desc: s.description,
          clampLines: 5,
          links: h(LinksRow, { npm: s.npm, github: s.github, homepage: s.homepage }),
          // 0.7.2 修复：收藏卡点击开详情（此前无 onToggle，点击无响应）；
          // 解析在 onOpen 内做（内存/API/快照三级），★ 移除按钮 stopPropagation 不受影响
          onToggle: () => {
            if (onOpen) onOpen(fav);
          },
          topRight: h("button", {
            className: "dsvm-favbtn on",
            title: lookup("fav.remove"),
            onClick: (e) => {
              e.stopPropagation();
              favorites.toggle(s);
            },
          }, "★"),
        });
      }),
    ),
  );
}

export { FavoriteZone };
