/**
 * ADR-0023 第三刀 T11 组件出仓·批次二（market-tab.jsx）：自 main.jsx verbatim 迁移，函数体零重写。
 * 成员：MarketTab
 */
import React from "react";
const ZONE_TABS = [
  { id: "community", labelKey: "zone.community" },
  { id: "primary", labelKey: "zone.primary" },
  { id: "favorites", labelKey: "zone.favorites" },
];

const h = React.createElement;
const { useState, useEffect, useLayoutEffect } = React;
import { api } from "./hooks.js";
import { lookup, browserLang, communityLabels } from "./i18n.js";
import { DEFAULT_PAGE_SIZE, MARKET_PAGE_SIZES, pageItems, zoneChips, marketNotice, scrollBodyTop, preferredPagerBehavior, filterScrollKey } from "./market-state.js";
import { backdropCloseHandlers } from "./backdrop.js";
import { opAppliesTo } from "./operations.js";
import { opUpgradeMeta } from "./operations-view.js";
import { restartBannerDecision } from "./panel-ops.js";
import { Icon, Spin, SearchBox, LinksRow, compactCount, ProgressLine } from "./chrome.jsx";
import { Card, snapshotOf, verifiedByline } from "./card.jsx";
import { FavoriteZone } from "./favorite-zone.jsx";
import { ZoneChips } from "./zone-chips.jsx";
import { DetailModal, useModalDepth } from "./detail-modal.jsx";

import { createOpOutcome } from "./op-outcome.js";
// op-outcome 模块级实例（与 main.jsx 同款装配）
const oc = createOpOutcome(lookup);

function MarketTab({ notify, markets, onMutation, ops, favorites, profileKind, onOpenOps, bodyRef }) {
  const [zone, setZone] = useState("community");
  const market = zone === "favorites" ? null : markets[zone];
  const { data, loading, error, reload, query, updateQuery } = market || {};
  // 0.9.25 跨区搜索态派生：query 非空即搜索（两区通用「搜索=全局、浏览=分区」；收藏区 market=null 时恒 false）
  const searching = Boolean(query && query.query);
  const [detailId, setDetailId] = useState(null);
  // 兼容确认弹窗状态（Task 18）：{ it, version, issue } | null——必须在 favorites 早退之前（hooks 规则）
  const [compatConfirm, setCompatConfirm] = useState(null);
  // CompatDialog 也是弹层：打开期间面板级 Esc 不关面板（审计 #4 同族）
  useModalDepth(compatConfirm != null);
  // 筛选弹层（0.7.2，社区区）：打开期间面板级 Esc 不关面板，Esc 只关弹层
  const [filterOpen, setFilterOpen] = useState(false);
  useModalDepth(filterOpen);
  useEffect(() => {
    if (!filterOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setFilterOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filterOpen]);
  // 收藏详情（0.7.2 修复）：收藏卡点击可开详情 Modal——快照字段不全，打开时先解析完整条目
  //（两分区当前页内存直查 → market API 按 id 精确查 → 快照兜底，下架条目也能看基本信息）
  const [favDetailItem, setFavDetailItem] = useState(null);
  // 页号跳转输入（0.7.3）：草稿态纯数字，合法页号回车/点「跳转」直达
  const [pageJump, setPageJump] = useState("");
  // busy 派生自操作记录（0.7.0 Task 13：状态不挂卡片）——首个进行中的 install
  // 0.9.15：保留完整 record——详情 Modal 内嵌进度行的数据源（展示仍是记录的派生，所有权不变）
  const activeInstallRec = ops.records.find((r) => r.kind === "install" && (r.status === "running" || r.status === "queued" || r.status === "input")) || null;
  const activeInstallTarget = activeInstallRec ? activeInstallRec.target : null;
  // 0.9.45 U10：升级操作记录派生（与 install 同款「状态不挂卡片」所有权模型）；record.target = 安装包名（R1）
  const activeUpgradeRec = ops.records.find((r) => r.kind === "upgrade" && (r.status === "running" || r.status === "queued" || r.status === "input")) || null;
  // 0.9.15：安装终态的 Modal 内摘要（{ id, kind: "ok"|"err"|"hint", text }）——Modal 是安装入口，
  // 终态也应就地可见；与底层 toast/横幅并行不冲突，仅在该条目自己的 Modal 内显示
  const [installNote, setInstallNote] = useState(null);

  // 服务端分页数据（0.7.0 Task 8：服务端单一排序源，客户端不再重排）
  const items = (data && data.items) || [];
  const total = (data && data.total) || 0;
  const limit = (data && data.limit) || DEFAULT_PAGE_SIZE;
  const offset = (data && data.offset) || 0;
  const page = total > 0 ? Math.floor(offset / limit) + 1 : 1;
  const pages = total > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  const counts = (data && data.categoryCounts) || {};
  const notice = data ? marketNotice(data.registryState, data.community) : null;
  // 页移动回顶（GLOSSARY「回顶」）：点击即滚不等响应——直滚滚动容器本身，
  // 不以 sticky 吸顶行为锚点（stuck 态下按当前几何误判「已在视口内」而空转，0.10.16 病灶）。
  const gotoPage = (p) => {
    updateQuery({ offset: Math.max(0, (p - 1) * limit) });
    scrollBodyTop(bodyRef && bodyRef.current, preferredPagerBehavior());
  };
  // 筛选身份变化 ⇒ 回第一页 ⇒ 瞬时回顶（GLOSSARY「筛选身份键」）；offset 不在键内，
  // 页移动不触发本层；mutation 后 reload / 后台换新键不变，滚动位置原样保留（白名单）。
  const pagerScrollKey = filterScrollKey(zone, query);
  useLayoutEffect(() => {
    scrollBodyTop(bodyRef && bodyRef.current, "instant");
  }, [pagerScrollKey]);
  // 页号跳转（0.7.3）：仅接受 1..pages 且非当前页；跳转后清空草稿
  const pageJumpNum = pageJump ? parseInt(pageJump, 10) : 0;
  const pageJumpValid = pageJumpNum >= 1 && pageJumpNum <= pages && pageJumpNum !== page;
  const jumpToPage = () => {
    if (!pageJumpValid) return;
    gotoPage(pageJumpNum);
    setPageJump("");
  };
  const detailItem = detailId ? items.find((x) => x.id === detailId) : null;
  const detailLabels = communityLabels(data);
  // 头部（0.7.3 精简）：分区 chips 行 + 整宽搜索行；分类 chips 行由 ZoneChips 渲染，
  // 社区区尾部挂「筛选」弹层（发现行/刷新按钮/任务按钮均已按主人要求移除）
  const zoneChips = h(
    "div",
    { className: "dshm-chips" },
    ...ZONE_TABS.map((z) => {
      // 计数取分区恒定值，与查询状态无关（0.9.25 修复：不再读「最近一次查询的 total」——跨区搜索会污染 tab 计数）：
      // 社区 = 存活社区条目（acceptedCount - displaced）；精选 = 主清单条数（registryState.count）；社区不可用时计 0（渲染层隐藏）
      const cd = markets.community.data;
      const pd = markets.primary.data;
      const zCount =
        z.id === "community"
          ? (cd && cd.community.status !== "disabled" && cd.community.status !== "unavailable"
              ? Math.max(0, cd.community.acceptedCount - cd.community.displaced)
              : 0)
          : z.id === "primary"
            ? (pd && pd.registryState.count) || 0
            : favorites && favorites.list.length;
      return h(
        "button",
        {
          key: z.id,
          className: `dshm-chip${zone === z.id ? " on" : ""}`,
          onClick: () => setZone(z.id),
        },
        lookup(z.labelKey),
        zCount ? ` ${zCount}` : "",
      );
    }),
  );
  // 搜索行只在有 market 数据源的分区渲染（收藏区无 query/reload；h() 参数急切求值须先守卫）
  const searchRow = market
    ? h(
        "div",
        { className: "dsvm-searchrow" },
        h(SearchBox, { key: zone, placeholder: lookup("search.ph"), initial: query.query, onCommit: (v) => updateQuery(v ? { query: v, category: null } : { query: v }) }),
      )
    : null;
  const zoneBar = zoneChips;

  // 0.9.15：成功文案拆出——底层 toast 与 Modal 内终态行共用同一份（0.9.94：builds 段换 op-outcome）
  const installResultText = (res) =>
    lookup("notify.installed", { pkg: res.pkg, version: res.version ? ` v${res.version}` : "" }) +
    oc.buildsSuffix(res) +
    (res.bundleWarning === "no-patch-layer" ? lookup("notify.bundlewarning") : "");
  const installDone = (it2, res) => {
    // ADR-0023 第二刀：横幅判定单源（install 字面 true）
    notify({ kind: "ok", needsRestart: restartBannerDecision("install", res).needsRestart, text: installResultText(res) });
    setInstallNote({ id: it2.id, kind: "ok", text: installResultText(res) });
  };

  const doInstall = async (it, version, forceIncompatible, reuseOpId) => {
    setInstallNote(null); // 0.9.15：新一轮安装先清上一轮 Modal 终态行
    try {
      const res = await ops.runOp(
        "install",
        it.id,
        () => api("install", { id: it.id, ...(version ? { version } : {}), ...(forceIncompatible ? { forceIncompatible: true } : {}) }),
        { version, npm: it.npm, github: it.github }, // 审计 #6：meta 携带 npm 供 stillApplies 比对
        reuseOpId, // 审计 #12：确认/重试复用同一记录，不再新开
      );
      installDone(it, res);
      await (onMutation ? onMutation() : reload(false));
    } catch (e) {
      if (e && e.issue) {
        // peer 预检拦截 → 弹「仍要安装」确认（确认后带 force 重发；复用原记录 id——审计 #12）
        setCompatConfirm({ it, version, issue: e.issue, opId: e.opId });
      } else {
        // 0.9.94 变更结局描述（op-outcome）：superseded/guard/plain 三分支合一；M2 Task 3 守卫语义（无 force 通道、一键重启只读 restartSafe）随文案入模块
        const m = oc.mutationFailed(e, { verb: "install", target: it.name });
        notify({ kind: m.kind, text: m.text });
        setInstallNote({ id: it.id, kind: m.kind === "ok" ? "hint" : "err", text: m.text });
      }
    }
  };

  // 0.9.45 U10：市场/收藏详情 Modal 内升级（动线修复——此前已装条目只能去已装页操作）。
  // record.target = 安装包名（R1：opAppliesTo 以 x.pkg === rec.target 判定前提，收录 id ≠ 包名会被误判 superseded）
  const doUpgrade = async (it) => {
    try {
      // 0.9.75：升级结果版本变迁（from/to，github 源回退 sha 前 7 位）经 opMeta 落账进操作记录
      // 0.10.3（挂账 1 数据面）：toVersion 随 enqueue 落 meta（中断恢复对账的比对依据）
      // 0.10.20：from（当前实装版 it.installedVersion）随 enqueue 持久化——恢复对账改判后渲染 v旧→v新 的数据源
      const res = await ops.runOp("upgrade", it.installedPkg, async () => {
        const r = await api("upgrade", { pkg: it.installedPkg });
        const m = opUpgradeMeta(r);
        return m ? { ...r, opMeta: m } : r;
      }, { from: it.installedVersion, toVersion: it.latest });
      // 0.10.0 R4：降级恢复结局（升级失败但已自动回装旧版）→ warn 投影，绝不进成功臂（「升级成功 vX→vY」与回滚事实相反）
      const degraded = oc.degradedOutcome(res);
      if (degraded) {
        notify({ kind: "warn", text: degraded.text });
        setInstallNote({ id: it.id, kind: "warn", text: degraded.text });
      } else {
        // 0.9.94：升级成功文案（from/to 箭头 + builds 后缀 + 0.9.22 生效判定三态分流，client-only 不弹重启横幅）单源 op-outcome
        // ADR-0023 第二刀：needsRestart 判定单源 restartBannerDecision（委派 upgradeNotify 三态）；文案仍单源 op-outcome
        const ok = oc.upgradeOkText(res);
        notify({ kind: "ok", needsRestart: restartBannerDecision("upgrade", res).needsRestart, text: ok.text });
        setInstallNote({ id: it.id, kind: "ok", text: ok.text });
      }
      await (onMutation ? onMutation() : undefined);
    } catch (e) {
      // 0.9.94 变更结局描述（op-outcome）：superseded/guard/plain 三分支合一（与已装页同款文案链）
      const m = oc.mutationFailed(e, { verb: "upgrade", target: it.installedPkg });
      notify({ kind: m.kind, text: m.text });
      setInstallNote({ id: it.id, kind: m.kind === "ok" ? "hint" : "err", text: m.text });
    }
  };

  const CompatDialog = compatConfirm
    ? h(
        "div",
        { className: "dshm-compat-overlay", ...backdropCloseHandlers(() => setCompatConfirm(null)) },
        h(
          "div",
          { className: "dshm-compat-dialog", onClick: (e) => e.stopPropagation() },
          h("div", { className: "dshm-compat-title" }, lookup("compat.title")),
          h("div", { className: "dshm-compat-body" }, lookup("compat.body", {
            pkg: compatConfirm.issue.pkg || compatConfirm.it.pkg,
            version: compatConfirm.issue.version || "?",
            runtime: compatConfirm.issue.runtimeVersion || "?",
          })),
          h(
            "ul",
            { className: "dshm-compat-peers" },
            ...Object.entries(compatConfirm.issue.peers || {}).map(([name, range]) =>
              h("li", { key: name }, `${name}: ${range}`)),
          ),
          h("div", { className: "dshm-compat-risk" }, lookup("compat.risk")),
          h(
            "div",
            { className: "dshm-actions" },
            h("button", {
              className: "dshm-btn sm",
              onClick: () => {
                // 审计碰撞建议 a：取消确认 → 记录处置为 superseded「用户放弃」，不再永挂 input
                if (compatConfirm.opId && ops.dispose) ops.dispose(compatConfirm.opId, lookup("op.cancelled"));
                setCompatConfirm(null);
              },
            }, lookup("common.cancel")),
            h("button", {
              className: "dshm-btn primary sm",
              onClick: () => {
                const pending = compatConfirm;
                setCompatConfirm(null);
                doInstall(pending.it, pending.version, true, pending.opId); // 复用原记录（审计 #12）
              },
            }, lookup("compat.force")),
          ),
        ),
      )
    : null;

  // 收藏详情打开（0.7.2 修复）：两分区当前页内存直查 → market API 按 id 精确查 → 快照兜底
  //（收藏快照字段不全；解析出完整条目，详情 Modal 才有最新版本/已装状态等）
  const openFavDetail = async (fav) => {
    const id = fav && fav.id;
    const scan = (d) => (d && Array.isArray(d.items) ? d.items.find((x) => x && x.id === id) : null);
    const hit = scan(markets.community.data) || scan(markets.primary.data);
    if (hit) {
      setFavDetailItem(hit);
      return;
    }
    try {
      const res = await api("market", { query: id, source: "all", limit: 8 });
      const exact = res && Array.isArray(res.items) ? res.items.find((x) => x && x.id === id) : null;
      if (exact) {
        setFavDetailItem(exact);
        return;
      }
    } catch {
      /* 查询失败走快照兜底 */
    }
    setFavDetailItem((fav && fav.snapshot) || null);
  };

  // 收藏区（0.7.0 Task 14；0.7.2 起卡片可点开详情）：分支后移到 doInstall/CompatDialog 之后，
  // 收藏卡才能复用安装链路与兼容确认弹层（hooks 全部在集群区，早退位置不涉 hooks 规则）
  if (zone === "favorites") {
    return h(
      React.Fragment,
      null,
      CompatDialog,
      zoneBar,
      h(FavoriteZone, { favorites, onOpen: openFavDetail }),
      favDetailItem
        ? h(DetailModal, {
            it: favDetailItem,
            labels: communityLabels(markets.community.data),
            busy: activeInstallTarget === favDetailItem.id,
            onClose: () => setFavDetailItem(null),
            onInstall: (it2) => doInstall(it2),
            onUpgrade: (it2) => doUpgrade(it2),
            upgradeBusy: activeUpgradeRec != null,
            upgradeRec: activeUpgradeRec && activeUpgradeRec.target === favDetailItem.installedPkg ? activeUpgradeRec : null,
            profileKind,
            installRec: activeInstallRec && activeInstallRec.target === favDetailItem.id ? activeInstallRec : null,
            installNote: installNote && installNote.id === favDetailItem.id ? installNote : null,
          })
        : null,
    );
  }

  // 筛选弹层（0.7.2，社区区）：排序字段/排列方向/每页条数——复刻 dsh-market 筛选面板；
  // 宿主版本兼容过滤无数据源（收录条目不携带宿主要求字段），不做
  const optRow = (label, activeOpt, onPick) =>
    h(
      "button",
      { key: label, className: `dsvm-filteropt${activeOpt ? " on" : ""}`, onClick: onPick },
      h("span", null, label),
      activeOpt ? h("span", { className: "dsvm-filtercheck" }, "✓") : null,
    );
  const curSortField = (query && query.sort && query.sort.field) || "downloads";
  const curSortDir = (query && query.sort && query.sort.dir) || "desc";
  const filterPop = zone === "community" && filterOpen
    ? h(
        "div",
        { className: "dsvm-filterpop", onClick: (e) => e.stopPropagation() },
        // 0.9.25 跨区搜索：搜索态排序两组隐藏（query 命中时相关性恒优先，排序只剩 tie-break）；页大小组恒在
        ...(searching
          ? []
          : [
              h(
                "div",
                { className: "dsvm-filtergroup" },
                h("div", { className: "dsvm-filtergt" }, lookup("filter.sortfield")),
                ...[["downloads", "filter.field.downloads"], ["stars", "filter.field.stars"], ["added", "filter.field.added"]].map(([f, key]) =>
                  optRow(lookup(key), curSortField === f, () => updateQuery({ sort: { field: f, dir: curSortDir } }))),
              ),
              h(
                "div",
                { className: "dsvm-filtergroup" },
                h("div", { className: "dsvm-filtergt" }, lookup("filter.sortdir")),
                ...[["desc", "filter.dir.desc"], ["asc", "filter.dir.asc"]].map(([d, key]) =>
                  optRow(lookup(key), curSortDir === d, () => updateQuery({ sort: { field: curSortField, dir: d } }))),
              ),
            ]),
        h(
          "div",
          { className: "dsvm-filtergroup" },
          h("div", { className: "dsvm-filtergt" }, lookup("filter.pagesize")),
          ...MARKET_PAGE_SIZES.map((n) =>
            optRow(String(n), limit === n, () => updateQuery({ limit: n, offset: 0 }))),
        ),
      )
    : null;
  const filterTrigger = zone === "community"
    ? h(
        "div",
        { className: "dsvm-filterwrap", key: "__filter" },
        filterOpen ? h("div", { className: "dsvm-filterback", onClick: () => setFilterOpen(false) }) : null,
        h(
          "button",
          // 0.7.3：独立于分类 chips 的筛选按钮样式（方角矩形 + 前置 chevron，参考 dsh-market）
          { className: `dsvm-filterbtn${filterOpen ? " on" : ""}`, onClick: () => setFilterOpen(!filterOpen) },
          h("span", { className: "dsvm-filterchev", "aria-hidden": "true" }, filterOpen ? "⌃" : "⌄"),
          lookup("filter.title"),
        ),
        filterPop,
      )
    : null;

  // 0.9.25 跨区搜索摘要行：两分区命中精确计数（!loading && !error 门控——fetch 期间 data 保留旧浏览态响应，
  // 其 sourceCounts 形如 {primary:0, community:N} 会闪现错误数字，门控后随新响应同帧出现；
  // error 态一并隐藏——请求失败时卡片位已是错误行，旧浏览态计数不得冒充搜索命中数）；
  // 行尾挂筛选触发器（搜索态 chips 行隐藏，filterTrigger 随行迁移；维持社区区限定）
  const sc = data && data.sourceCounts;
  const summaryRow = searching && sc && !loading && !error
    ? h(
        "div",
        { className: "dsvm-searchmeta" },
        h("span", null, lookup("search.summary", { n: sc.primary, m: sc.community })),
        filterTrigger,
      )
    : null;

  // 卡片渲染单例（0.9.25）：浏览态单列表与搜索态两段分组共用同一映射；搜索态给非社区卡补「精选」徽章
  const cardOf = (it) =>
    Card({
      // id-让位镜像条目与主条目同 id（设计 2026-10-27）：key 分域防 React 重排歧义
      key: it.primaryOverlap === true ? `x:${it.id}` : it.id,
      icon: h(Icon, { entry: it }),
      name: it.name,
      badges: [
        activeInstallTarget === it.id
          ? h(
              "button",
              {
                className: "dshm-badge warn",
                key: "busy",
                title: lookup("op.panel.jump"),
                onClick: (e) => {
                  e.stopPropagation();
                  // 评审 P7 → 0.9.x 第二批：操作记录卡搬进设置 tab，点击 = 切 tab + 滚动定位
                  if (typeof onOpenOps === "function") onOpenOps();
                },
              },
              lookup("op.status.running"),
            )
          : null,
        it.deprecated === true ? h("span", { className: "dshm-badge warn", key: "dep" }, lookup("badge.deprecated")) : null,
        it.audience === "internal" ? h("span", { className: "dshm-badge dshm-badge-internal", key: "internal" }, lookup("badge.internal")) : null,
        it.outdated ? h("span", { className: "dshm-badge warn", key: "u" }, lookup("badge.update")) : null,
        it.installed ? h("span", { className: "dshm-badge", key: "i" }, lookup("badge.installed")) : null,
        // 「社区收录」仅在跨区搜索结果中有区分度（与精选结果区分来源）；社区区浏览态是同义反复，且徽章拥挤挤压卡名
        searching && it.community === true ? h("span", { className: "dshm-badge info", key: "c" }, lookup("badge.community")) : null,
        it.primaryOverlap === true ? h("span", { className: "dshm-badge info", key: "cur" }, lookup("badge.inCurated")) : null,
        searching && it.community !== true ? h("span", { className: "dshm-badge", key: "cz" }, lookup("zone.primary")) : null,
        h("span", { className: "dshm-badge info", key: "s" }, it.source === "npm" ? "npm" : "github"),
      ],
      byline: it.community === true
        ? [
            it.owner ? { text: `by ${it.owner}` } : null,
            typeof it.downloads === "number" ? { text: `${compactCount(it.downloads)} ↓`, title: String(it.downloads) } : null,
            typeof it.stars === "number" ? { text: `${compactCount(it.stars)} ★`, title: String(it.stars) } : null,
          ].filter(Boolean)
        : [
            ...(it.tags || []).map((t) => ({ text: `#${t}` })),
            verifiedByline(it),
          ].filter(Boolean),
      desc: browserLang() === "en" && typeof it.descriptionEn === "string" && it.descriptionEn !== "" ? it.descriptionEn : it.description,
      clampLines: it.community === true ? 5 : 2,
      sub: [
        it.latestVersion ? lookup("sub.latest", { v: it.latestVersion }) : it.latestTag ? it.latestTag : it.latestSha ? lookup("sub.head", { sha: it.latestSha.slice(0, 7) }) : null,
        it.installedVersion ? lookup("sub.installed", { v: it.installedVersion }) : null,
        it.latestError ? (it.version ? lookup("sub.snapshot", { v: it.version }) : lookup("version.failed")) : null,
      ].filter(Boolean).join(" · "),
      links: h(LinksRow, { npm: it.npm, github: it.github, homepage: it.homepage }),
      onToggle: () => setDetailId(it.id),
      topRight: favorites
        ? h("button", {
            className: `dsvm-favbtn${favorites.list.some((f) => f.id === it.id) ? " on" : ""}`,
            title: favorites.list.some((f) => f.id === it.id) ? lookup("fav.remove") : lookup("fav.add"),
            onClick: (e) => {
              e.stopPropagation();
              favorites.toggle(snapshotOf(it));
            },
          },
          favorites.list.some((f) => f.id === it.id) ? "★" : "☆")
        : null,
    });

  // 搜索态页内分组：精选命中置顶成段；两个段头各自仅在对应段非空时渲染（三组合全覆盖，不渲染悬空段头）；
  // 段头是 .dshm-cards 容器内独立 DOM 元素（非 items 数组插桩），跨列占满由 .dsvm-grouphead 的
  // grid-column:1/-1 保证（.dshm-cards 按容器宽度自适应列数，main.jsx 内嵌样式表）
  const curatedHits = searching ? items.filter((it) => it.community !== true) : [];
  const communityHits = searching ? items.filter((it) => it.community === true) : [];
  const marketCards =
    searching && curatedHits.length > 0
      ? [
          h("div", { className: "dsvm-grouphead", key: "gh-c" }, `⭐ ${lookup("zone.primary")}`),
          ...curatedHits.map(cardOf),
          ...(communityHits.length > 0 ? [h("div", { className: "dsvm-grouphead", key: "gh-m" }, lookup("zone.community"))] : []),
          ...communityHits.map(cardOf),
        ]
      : items.map(cardOf);

  return h(
    React.Fragment,
    null,
    CompatDialog,
    zoneBar,
    searchRow,
    notice && notice.notice
      ? h("div", { className: "dshm-err" }, lookup(notice.notice.key))
      : null,
    notice && notice.communityFallback ? h("div", { className: "dshm-hint" }, lookup("community.fallback")) : null,
    // 0.9.25 跨区搜索：搜索态隐藏分类 chips（两套分类法跨区口径失义）、「筛选」随摘要行保留；浏览态照旧
    summaryRow,
    searching
      ? null
      : h(ZoneChips, {
          zone,
          counts,
          labels: communityLabels(data),
          active: query.category,
          onPick: (id) => updateQuery({ category: id, offset: 0 }),
          trailing: filterTrigger,
          // 0.9.45 U3：跨桶条目在每桶双计（alsoCategories）→ Σchips 可大于总数；有跨桶时给容器 title 说明
          wrapTitle:
            zone === "primary" && data
              ? Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0) > ((data.registryState && data.registryState.count) || 0)
                ? lookup("chips.crossbucket.tip")
                : undefined
              : undefined,
        }),
    // 0.9.15：安装目标条目的详情 Modal 打开时，进度行入 Modal、底层行让位（避免隔着遮罩双重透出）；
    // Modal 关闭后底层行照常回归（关闭弹窗的安装仍可见）
    activeInstallTarget && !(detailItem && detailItem.id === activeInstallTarget)
      ? h(ProgressLine, { key: "prog" })
      : null,
    loading && !data
      ? h("div", { className: "dshm-empty" }, lookup("market.loading"), Spin())
      : error
        ? h(
            "div",
            { className: "dshm-err" },
            lookup("failed.load", { err: error }), " ",
            // 0.9.45 U9：错误就地恢复出口（此前只能关开面板或绕道设置页）
            h("button", { className: "dshm-btn sm", onClick: () => reload(false) }, lookup("market.retry")),
          )
        : items.length === 0
          ? h(
              "div",
              { className: "dshm-empty" },
              lookup(
                data && data.registryState.status === "unavailable" && !query.query && !query.category
                  ? "market.empty.unavailable"
                  : query.category
                    ? "market.empty.category"
                    : "market.empty",
              ),
            )
          : h(
              React.Fragment,
              null,
              h(
                "div",
                { className: "dshm-cards" },
                ...marketCards,
              ),
              pages > 1
                ? h(
                    "div",
                    { className: "dsvm-pager" },
                    h("button", { className: "dsvm-pagebtn", disabled: page <= 1 || loading, onClick: () => gotoPage(page - 1) }, "‹"),
                    ...pageItems(page, pages).map((p, i) =>
                      p === "..."
                        ? h("span", { key: `e${i}`, className: "dshm-hint" }, "…")
                        : h("button", { key: p, className: `dsvm-pagebtn${p === page ? " on" : ""}`, onClick: () => gotoPage(p) }, String(p))),
                    h("button", { className: "dsvm-pagebtn", disabled: page >= pages || loading, onClick: () => gotoPage(page + 1) }, "›"),
                    // 页号跳转（0.7.3）：输入有效页号回车或点「跳转」直达
                    h(
                      "span",
                      { className: "dsvm-pagejump" },
                      h("input", {
                        className: "dsvm-pagejump-input",
                        value: pageJump,
                        placeholder: lookup("pager.jump.ph"),
                        inputMode: "numeric",
                        "aria-label": lookup("pager.jump.ph"),
                        onChange: (e) => setPageJump(e.target.value.replace(/\D/g, "").slice(0, 4)),
                        onKeyDown: (e) => {
                          if (e.key === "Enter" && !e.isComposing) jumpToPage();
                        },
                      }),
                      h("button", { className: "dsvm-pagebtn dsvm-pagejump-btn", disabled: !pageJumpValid || loading, onClick: jumpToPage }, lookup("pager.jump")),
                    ),
                  )
                : null,
            ),
    detailItem
      ? h(DetailModal, {
          it: detailItem,
          labels: detailLabels,
          busy: activeInstallTarget === detailItem.id,
          onClose: () => setDetailId(null),
          onInstall: (it2) => doInstall(it2),
          onUpgrade: (it2) => doUpgrade(it2),
          upgradeBusy: activeUpgradeRec != null,
          upgradeRec: activeUpgradeRec && activeUpgradeRec.target === detailItem.installedPkg ? activeUpgradeRec : null,
          profileKind,
          installRec: activeInstallRec && activeInstallRec.target === detailItem.id ? activeInstallRec : null,
          installNote: installNote && installNote.id === detailItem.id ? installNote : null,
        })
      : null,
  );
}

export { MarketTab };
