/**
 * ADR-0023 第三刀 T10 组件出仓·批次一（zone-chips.jsx）：自 main.jsx verbatim 迁移，
 * 函数体零重写；依赖经 ESM import 显式接线（由抽取脚本按标识符使用自动生成）。
 * 成员：ZoneChips
 */
import React from "react";
const h = React.createElement;
const { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } = React;
import { lookup } from "./i18n.js";
import { zoneChips } from "./market-state.js";
import { chipRows, countBeyondRows, clipTopOf, visibleRowTop, autoExpandDecision } from "./zone-chips-geometry.js";

function ZoneChips({ zone, counts, labels, active, onPick, trailing, wrapTitle }) {
  const chips = useMemo(() => zoneChips(counts, labels, zone), [counts, labels, zone]);
  // 精选区的 labels 可能每次父组件渲染都新建对象；依赖 chips 引用会在 layout effect
  // setGeom 引发的同步重渲染中无限触发（React #185）。用实际渲染内容作为稳定依赖，
  // 同时保留计数/标签在长度不变时的确定性重测（评审 R1-Q1）。
  const chipsSignature = JSON.stringify(chips.map((c) => [c.id, c.labelKey ? lookup(c.labelKey) : c.label, c.count]));
  const [expanded, setExpanded] = useState(false);
  const [stuck, setStuck] = useState(false);
  // 展开态行数（0.9.59）：⌃ 收起钮的显隐派生依据——全屏等宽容器下 chips 可能 ≤ maxRows 行，
  // 此时收起是零变化空操作（且 hiddenCount=0 连 +N 都不会出现）⇒ 死按钮，按行数隐藏。
  const [expRows, setExpRows] = useState(0);
  // 折叠态测量快照：{tops: 全部 data-chip 的 offsetTop（含 visibility:hidden 占位者——占位才能稳定测量）,
  // clipTop: 首个被裁剪行行顶, hiddenCount: 裁剪线外分类颗数,
  // lastVisTop/lastVisRight/lastVisHeight: 末可见行行顶、最后一颗可见 chip 的右缘和边框高度}。
  // hiddenCount 为展示布局的纯派生量：宽度变窄自动增长、变宽自动回落（双向自愈，无棘轮无反馈）。
  const [geom, setGeom] = useState(null);
  const [rowHeight, setRowHeight] = useState(0);
  const wrapRef = useRef(null);
  const sentinelRef = useRef(null);
  const autoRef = useRef(null);
  const maxRows = stuck ? 1 : 2;
  const activeIdx = active ? chips.findIndex((c) => c.id === active) : -1;
  const maxH = maxRows * (rowHeight || 22) + (maxRows - 1) * 6;
  // 测量（D7/D9）：全量 DOM offsetTop 分组 → 纯函数 → 快照（值比较防抖，幂等不动点）。
  // expanded 早退：沿用快照、不施测。chip.offsetHeight 与 max-height 无耦合 → rowHeight 至多校正一次。
  const measure = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const tops = [];
    let rh = 0;
    for (const k of el.children) {
      if (!(k instanceof HTMLElement) || k.getAttribute("data-chip") !== "1") continue;
      tops.push(k.offsetTop);
      if (!rh && k.offsetHeight) rh = k.offsetHeight;
    }
    if (!tops.length) return;
    if (expanded) {
      // 展开态分支（0.9.59）：只追行数供 ⌃ 显隐；geom 是折叠裁剪快照，展开时无意义，不写以免扰动。
      const rows = chipRows(tops);
      setExpRows((prev) => (prev === rows ? prev : rows));
      return;
    }
    setGeom((prev) => {
      const clipTopV = clipTopOf(tops, maxRows);
      // 全部也占首行：必须从完整 tops 数行，不能 slice(1) 后误把第二行认作第一行。
      const hiddenCount = countBeyondRows(tops, maxRows);
      const lastVisTop = visibleRowTop(tops, maxRows);
      let lastVisRight = 0;
      let lastVisHeight = rh;
      for (const k of el.children) {
        if (!(k instanceof HTMLElement) || k.getAttribute("data-chip") !== "1") continue;
        if (k.offsetTop < clipTopV) {
          lastVisRight = k.offsetLeft + k.offsetWidth;
          lastVisHeight = k.offsetHeight;
        }
      }
      const next = { tops, clipTop: clipTopV, hiddenCount, lastVisTop, lastVisRight, lastVisHeight };
      const same = prev && prev.hiddenCount === next.hiddenCount && prev.clipTop === next.clipTop && prev.lastVisTop === next.lastVisTop && prev.lastVisRight === next.lastVisRight && prev.lastVisHeight === next.lastVisHeight && prev.tops.length === next.tops.length && prev.tops.every((t, i) => t === next.tops[i]);
      return same ? prev : next;
    });
    setRowHeight((prev) => (Math.abs(prev - rh) <= 0.5 ? prev : rh));
  }, [expanded, maxRows, chips.length]);
  // 顺序恒定（0.7.9：点击分类不再换序）。两个 effect 拆分（探针 V5 暴露——合并写法 + deps 含
  // expanded 时，「!active 重置」会在 +N 展开翻转的瞬间把展开回滚；现状 deps 不含 expanded 故无此问题）：
  // ① 重置：仅 active 变化时清 autoRef / 收起；
  useEffect(() => {
    if (!active) {
      autoRef.current = null;
      setExpanded(false);
    }
  }, [active]);
  // ② 决策（D8）：以折叠快照评估激活分类越界 → 记录 autoRef；越界、未记录且未展开 → 自动展开。
  useEffect(() => {
    if (!active || !geom) return;
    const activeTop = geom.tops[activeIdx + 1]; // tops[0] = 「全部」
    const d = autoExpandDecision(activeTop, geom.clipTop, autoRef.current === active, expanded);
    if (d.record) autoRef.current = active;
    if (d.expand) setExpanded(true);
  }, [active, activeIdx, expanded, geom]);
  // 确定性重测主路径（D7③）：数据/业务态/吸顶/行高变化即重测（expanded 早退在 measure 内）。
  // 内容签名捕捉同长度计数/文案变化，active 捕捉加粗重排；geom 改变预留槽后再测一次。
  useLayoutEffect(() => {
    // 0.9.59：展开态也测（measure 内部分支只写 expRows）——⌃ 显隐需要展开行数。
    measure();
  }, [chipsSignature, active, expanded, zone, stuck, rowHeight, measure]);
  // reserve 改变内容宽度时在上一轮状态提交后复测；不可在 layout effect 依赖 geom
  // 同步自递归，否则分区切换时前一状态尚未提交，会触发 React #185。
  useEffect(() => {
    if (expanded || !geom || typeof requestAnimationFrame !== "function") return;
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [geom, expanded, measure]);
  // RO 兜底（D7①）：宽度变化 / 字体重排 / max-height 变化（stuck 切换）触发；rAF 节流 + 幂等。
  // feature-detect 降级：无 RO 时仅靠 deps 主路径（先例 :947 IO 守卫）。
  useEffect(() => {
    const el = wrapRef.current;
    // 0.9.59：展开态也挂 RO——窗口/全屏切换的宽度变化正是 ⌃ 显隐的重测触发源（layout effect
    // 的 deps 在全屏翻转时不变，只有 RO 能捕捉）。展开态 measure 只写 expRows，成本可忽略。
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [measure]);
  // 字体度量就绪后补测一轮（D7②；评审 R2 期间「冷字体」假说虽被证伪，此钩子对度量漂移仍零成本兜底）
  useEffect(() => {
    if (expanded || typeof document === "undefined" || !document.fonts?.ready) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, measure]);
  useEffect(() => {
    const s = sentinelRef.current;
    if (!s || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setStuck(!entries[0].isIntersecting), { threshold: 0 });
    io.observe(s);
    return () => io.disconnect();
  }, []);
  const clip = !expanded;
  // 筛选需要 96px gutter；有隐藏分类时另留 52px 供 +N 独占，精选区不无谓预留筛选槽。
  const filterPinned = clip && trailing != null;
  const clipTop = geom ? geom.clipTop : Infinity;
  const hiddenCount = geom ? geom.hiddenCount : 0;
  const lastVisTop = geom ? geom.lastVisTop : 0;
  const moreLeft = geom ? geom.lastVisRight + 6 : 0;
  const moreHeight = geom ? geom.lastVisHeight : (rowHeight || 22);
  const btn = (c, i) => {
    const top = geom ? geom.tops[i + 1] : null; // tops[0] = 「全部」
    // 仅折叠态施 visibility（D4）；展开态全量可见
    const clipped = clip && geom && typeof top === "number" && top >= clipTop;
    return h(
      "button",
      {
        key: c.id,
        "data-chip": "1",
        style: clipped ? { visibility: "hidden" } : undefined,
        className: `dshm-chip${active === c.id ? " on" : ""}${c.count === 0 ? " zero" : ""}`,
        onClick: () => onPick(active === c.id ? null : c.id),
      },
      // 0.9.45 U3/U7：0 计数桶显式渲染「0」+ 降透明（社区区 chip 计数恒 >0，行为不变）
      `${c.labelKey ? lookup(c.labelKey) : c.label} ${c.count || 0}`,
    );
  };
  return h(
    React.Fragment,
    null,
    h(
      "div",
      { className: "dsvm-chipswrap" },
      // 吸顶检测哨兵（0.9.52）：wrap 内 top:-5px 绝对定位，出视口 ⇒ stuck。⚠️ 裁剪宿主是
      // .dshm-chips（D3）：wrap 决不可 overflow:hidden，否则哨兵被剪 → IO 恒 false → 永久吸顶态。
      h("div", {
        ref: sentinelRef,
        style: { position: "absolute", top: "-5px", left: 0, width: "1px", height: "1px", pointerEvents: "none" },
      }),
      h(
        "div",
        {
          ref: wrapRef,
          className: `dshm-chips${clip ? " dshm-chips-clip" : ""}${filterPinned ? " dshm-chips-gutter" : ""}${clip && hiddenCount > 0 ? " dshm-chips-reserve" : ""}`,
          title: wrapTitle || undefined,
          style: { maxHeight: clip ? `${maxH}px` : "none" },
        },
        h("button", { "data-chip": "1", className: `dshm-chip${active == null ? " on" : ""}`, onClick: () => onPick(null) }, lookup("cat.all")),
        ...chips.map((c, i) => btn(c, i)),
        // 折叠态 +N（0.9.57 终版）：绝对定位钉在「末可见行右端预留槽」——出流不挤压 chip、不参与
        // 行分组（data-more）；预留槽由 .dshm-chips-clip 的 padding-right 划出，几何保证零重叠；
        // 左缘动态紧贴末可见 chip 右侧 6px，仍受右侧预留槽保护；垂直对齐末可见行。
        clip && geom && hiddenCount > 0
          ? h("button", {
              key: "more",
              "data-more": "1",
              className: "dshm-chip dsvm-chipmore-plus",
              style: { top: `${lastVisTop}px`, left: `${moreLeft}px`, height: `${moreHeight}px` },
              onClick: () => setExpanded(true),
            }, `+${hiddenCount}`)
          : null,
        expanded
          ? [
              // 0.9.59：仅当展开布局真实超过 maxRows 行才渲染 ⌃——否则收起是零变化空操作（死按钮）。
              // 行数含 ⌃ 自身：若它恰好独占一行，隐藏后行数回落仍 ≤ maxRows，显隐收敛不振荡。
              expRows > maxRows
                ? h("button", {
                    key: "collapse",
                    "data-chip": "1",
                    className: "dshm-chip",
                    // 评审 R1-Q6：手动收起即记录 autoRef——展开态下激活的分类若真实越界（geom 陈旧或
                    // 收起重测后越界），决策 effect 不得立即弹回，「手动收起」无条件被尊重。
                    onClick: () => {
                      if (active) autoRef.current = active;
                      setExpanded(false);
                    },
                  }, "⌃")
                : null,
              trailing || null,
            ]
          : null,
      ),
      // 折叠态钉住的筛选触发器（gutter 几何保证与 chip 零相交；叠涂 scrim 强化浅色对比度，评审 R1 后主人优化②）
      filterPinned
        ? h(
            "div",
            {
              className: "dsvm-chipmore",
              style: { bottom: `${8 + ((rowHeight || 22) - 28) / 2}px` },
            },
            trailing || null,
          )
        : null,
    ),
  );
}

export { ZoneChips };
