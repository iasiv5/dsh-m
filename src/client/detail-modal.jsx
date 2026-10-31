/**
 * ADR-0023 第三刀 T11 组件出仓·批次二（detail-modal.jsx）：自 main.jsx verbatim 迁移，函数体零重写。
 * 成员：useModalDepth, DetailModal
 */
import React from "react";
const h = React.createElement;
const { useState, useEffect, useCallback, useRef } = React;
import { api, fmtDate } from "./hooks.js";
import { lookup, browserLang } from "./i18n.js";
import { backdropCloseHandlers } from "./backdrop.js";
import { lbStep } from "./lightbox.js";
import { shotWheelAction } from "./wheel-strip.js";
import { shouldShowInstallCmd } from "./install-cmd.js";
import { Icon, Spin, XIcon, LinksRow, safeScreenshots, compactCount, Shot, Lightbox, ProgressLine, ReadmeBlock } from "./chrome.jsx";

// 弹层深度计数器（原 main.jsx 模块级可变共享；MarketPanel Escape 判定经 modalDepth() 读取——ADR-0023 T11 单一持有）
let dsvmModalDepth = 0;
export function modalDepth() { return dsvmModalDepth; }

function useModalDepth(active) {
  useEffect(() => {
    if (!active) return;
    dsvmModalDepth += 1;
    return () => {
      dsvmModalDepth -= 1;
    };
  }, [active]);
}

function DetailModal({ it, labels, busy, onClose, onInstall, onUpgrade, upgradeBusy, upgradeRec, profileKind, installRec, installNote }) {
  useModalDepth(true);
  const communityScreenshotSource = it.community === true || typeof it.owner === "string";
  const [primaryShotState, setPrimaryShotState] = useState({ id: null, screenshots: [] });
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setPrimaryShotState({ id: it.id, screenshots: [] });
    if (communityScreenshotSource || typeof it.id !== "string" || it.id.trim() === "") {
      return () => {
        live = false;
        controller.abort();
      };
    }
    api("primary-screenshots", { id: it.id }, controller.signal)
      .then((data) => {
        if (!live) return;
        setPrimaryShotState({ id: it.id, screenshots: safeScreenshots({ screenshots: data && data.screenshots }) });
      })
      .catch(() => {
        if (live) setPrimaryShotState({ id: it.id, screenshots: [] });
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [it.id, it.github, it.community, it.owner]);
  const primaryShots = primaryShotState.id === it.id ? primaryShotState.screenshots : [];
  const shots = communityScreenshotSource ? safeScreenshots(it) : primaryShots;
  // 0.9.61 图片加载链（评审 E：DetailModal 作用域内四处 shots 基准同步换 visible——
  // 整条门控/截图条 map 的开灯箱索引/灯箱门控/键盘 lbStep；漏改则剔除后索引错位）
  const [brokenShots, setBrokenShots] = useState([]);
  // 评审建议落盘：条目切换时渲染期重置坏图剔除记录（prev-key 模式）。当前两挂载点
  // 关闭 Modal 即卸载、现状无害；防未来 Modal 复用时旧条目记录错误剔除新条目截图。
  const [brokenShotsKey, setBrokenShotsKey] = useState(it.id);
  if (brokenShotsKey !== it.id) {
    setBrokenShotsKey(it.id);
    setBrokenShots([]);
  }
  const breakShot = useCallback((src) => setBrokenShots((prev) => (prev.includes(src) ? prev : prev.concat(src))), []);
  const visible = shots.filter((src) => !brokenShots.includes(src));
  const [lb, setLb] = useState(null);
  const [copied, setCopied] = useState(false);
  // 0.9.45 U10b：README 折叠页——展开才拉取（收起态零请求）
  const [rmOpen, setRmOpen] = useState(false);
  // 0.9.45 U8：初始聚焦关闭钮（role/aria 语义 + 键盘入口；Tab 圈闭与焦点还原不在本批边界内）
  const closeRef = useRef(null);
  useEffect(() => {
    if (closeRef.current) closeRef.current.focus();
  }, []);
  // 0.9.74 截图条滚轮横滚：裸滚轮 deltaY 映射 scrollLeft（钢人三红线判定全在纯函数
  // shotWheelAction——可滚才拦 / 到头放行 / deltaX 不碰）。接线要点：React onWheel 走
  // document 级 passive 委托，preventDefault 无效，必须手动 addEventListener({passive:false})；
  // deps=visible.length——截图条条件渲染（无图无 div），primary 截图异步到达 / 坏图剔除
  // 都会改变存在性，此时重挂；判定入参逐事件现读 row 布局，无缓存失效问题。
  const shotRowRef = useRef(null);
  useEffect(() => {
    const row = shotRowRef.current;
    if (!row || typeof row.addEventListener !== "function") return;
    const onWheel = (e) => {
      const action = shotWheelAction({ deltaX: e.deltaX, deltaY: e.deltaY, scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, scrollLeft: row.scrollLeft });
      if (!action.preventDefault) return;
      e.preventDefault();
      row.scrollLeft += action.scrollBy;
    };
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, [visible.length]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (lb !== null) setLb(null);
        else onClose();
      }
      if (lb !== null && visible.length > 1) {
        if (e.key === "ArrowLeft") setLb((i) => lbStep(i, -1, visible.length));
        if (e.key === "ArrowRight") setLb((i) => lbStep(i, 1, visible.length));
      }
      if (e.key === "Tab" && lb !== null) {
        // 0.9.65 焦点圈闭：灯箱开着时 Tab/Shift+Tab 只在灯箱内可聚焦控件（按钮/链接）
        // 间回绕；焦点已逃出灯箱（如点击遮罩落在 body）时拉回首/尾。圈闭范围以
        // .dsvm-lightbox 根查询——portal 挂 body 后 Tab 本会走到背景面板，此处收口；
        // DetailModal 自身的 U8 债（无圈闭）维持不变，Esc 仍只关最上层弹层。
        const box = typeof document !== "undefined" ? document.querySelector(".dsvm-lightbox") : null;
        if (!box) return;
        const focusables = Array.from(box.querySelectorAll("button, a[href]")).filter((el) => el.offsetWidth > 0 && el.offsetHeight > 0);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (!box.contains(active) || (e.shiftKey ? active === first : active === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lb, visible.length, onClose]);
  const catLabel =
    (labels && labels[it.category]) ||
    (["essentials", "cui-picks", "self-dev", "tencent-lighthouse", "watchlist"].includes(it.category) ? lookup("cat." + it.category) : it.category);
  const installCmd =
    typeof it.install === "string" && it.install !== ""
      ? it.install
      : it.source === "npm"
        ? `dsh plugin --profile web add ${it.npm}`
        : `dsh plugin --profile web add github:${it.github}`;
  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(installCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板不可用静默 */
    }
  };
  const descFull = browserLang() === "en" && typeof it.descriptionEn === "string" && it.descriptionEn !== "" ? it.descriptionEn : it.description;
  // 0.9.14：desktop 上下文整行隐藏——命令两来源（推导 + 上游原文）都是 --profile web 语义，照抄会装进非当前 profile；
  // desktop 装机走下方「安装」按钮（官方 pluginManager 委派）。已安装条目同样隐藏（命令已无用途）。
  const showInstallCmd = shouldShowInstallCmd(profileKind, it.installed === true);
  const kv = (k, v) => h(React.Fragment, { key: k }, h("dt", null, k), h("dd", null, v));
  return h(
    "div",
    { className: "dsvm-modal", ...backdropCloseHandlers(onClose) },
    h(
      "div",
      { className: "dsvm-modalbox", role: "dialog", "aria-modal": "true", "aria-label": it.name, onClick: (e) => e.stopPropagation() },
      h(
        "div",
        { className: "dsvm-modalhead" },
        h(Icon, { entry: it }),
        h("span", { className: "dshm-name" }, it.name),
        it.deprecated === true ? h("span", { className: "dshm-badge warn" }, lookup("badge.deprecated")) : null,
        it.audience === "internal" ? h("span", { className: "dshm-badge" }, lookup("badge.internal")) : null,
        it.installed ? h("span", { className: "dshm-badge" }, lookup("badge.installed")) : null,
        it.community === true ? h("span", { className: "dshm-badge info" }, lookup("badge.community")) : null,
        h("span", { className: "dshm-badge info" }, it.source === "npm" ? "npm" : "github"),
        h("span", { className: "dshm-spacer" }),
        h("button", { ref: closeRef, className: "dshm-xbtn", "aria-label": lookup("common.close"), title: lookup("common.close"), onClick: onClose }, h(XIcon)),
      ),
      // 0.9.88（T7 验收·主人反馈二）：中段内容包进 modalbody 滚动层——✕（head）与
      // 「安装」（actions）双端常驻，README/能力披露展开多长都关得上、装得了；
      // box 攂 overflow:hidden，滚动收进 body（overscroll-behavior 防链式透传底页）。
      h(
        "div",
        { className: "dsvm-modalbody" },
      it.community === true
        ? h(
            "div",
            { className: "dsvm-byline" },
            it.owner ? h("span", null, `by ${it.owner}`) : null,
            typeof it.stars === "number" ? h("span", { title: String(it.stars) }, `${compactCount(it.stars)} ★`) : null,
            typeof it.downloads === "number" ? h("span", { title: String(it.downloads) }, `${compactCount(it.downloads)} ↓`) : null,
          )
        : null,
      h(LinksRow, { npm: it.npm, github: it.github, homepage: it.homepage }),
      h(
        "dl",
        { className: "dsvm-kv" },
        kv(lookup("modal.category"), catLabel),
        it.added ? kv(lookup("modal.added"), fmtDate(it.added)) : null,
        it.community === true
          ? kv(
              lookup("modal.dlwindow"),
              typeof it.downloads === "number"
                ? h("span", { title: String(it.downloads) }, `${compactCount(it.downloads)}（${it.downloadsStart || "?"} ~ ${it.downloadsEnd || "?"}${it.downloadsCheckedAt ? `，${lookup("modal.checkedat")} ${it.downloadsCheckedAt}` : ""}）`)
                : lookup("modal.dlnone"),
            )
          : null,
        kv(lookup("detail.latest"), it.latestVersion ? `v${it.latestVersion}` : it.latestTag ? it.latestTag : it.latestSha ? it.latestSha : it.latestError ? (it.version ? lookup("sub.snapshot", { v: it.version }) : it.latestError) : "—"),
        kv(lookup("detail.installed"), it.installedPkg ? `${it.installedPkg} v${it.installedVersion || "?"}` : lookup("installed.none")),
        it.community !== true && Array.isArray(it.verified) && it.verified.length ? kv(lookup("modal.verified"), it.verified.join("、")) : null,
        it.audience === "internal" ? kv(lookup("modal.audience.label"), lookup("modal.audience.value")) : null,
        it.decoupled === true ? kv(lookup("modal.decoupled.label"), lookup("modal.decoupled.value")) : null,
        (it.tags || []).length ? kv(lookup("modal.tags"), it.tags.join(", ")) : null,
        it.deprecated === true && it.replacement ? kv(lookup("modal.replacement"), it.replacement) : null,
      ),
      h("div", { className: "dshm-desc", style: { WebkitLineClamp: "unset" } }, descFull),
      it.npm
        ? h(
            "details",
            { className: "dsvm-fold", onToggle: (e) => { if (e.target.open) setRmOpen(true); } },
            h("summary", null, lookup("readme.show")),
            rmOpen ? h(ReadmeBlock, { pkg: it.npm, repo: it.github }) : h("div", { className: "dshm-hint" }, lookup("readme.loading")),
          )
        : null,
      visible.length
        ? h(
            "div",
            { ref: shotRowRef, className: "dsvm-shotrow" },
            // 0.9.61（评审 G）：全量 shots map + 原始索引稳定 key，broken 项由 Shot 内部渲 null——
            // 剔除不引发未 broken 项重挂重载；点击按 src 在 visible 中的实位开灯箱（原始索引≠visible 索引）
            ...shots.map((src, i) => h(Shot, { key: `${i}:${src}`, src, onClick: () => setLb(visible.indexOf(src)), onBroken: breakShot })),
          )
        : null,
      it.community === true
        ? h(
            "details",
            { className: "dsvm-fold" },
            h("summary", null, lookup("detail.capabilities")),
            Array.isArray(it.capabilities) && it.capabilities.length
              ? h("div", null,
                  h("div", null, it.capabilities.join(", ")),
                  Array.isArray(it.capabilityRedLines) && it.capabilityRedLines.length
                    ? h("div", { className: "dshm-err" }, `${lookup("detail.redlines")}: ${it.capabilityRedLines.join("; ")}`)
                    : null)
              : h("div", { className: "dshm-hint" }, lookup("detail.capabilities.unscanned")),
          )
        : null,
      showInstallCmd
        ? h(
            "details",
            { className: "dsvm-fold" },
            h("summary", null, lookup("modal.installcmd")),
            h("div", { className: "dsvm-cmdrow" },
              h("code", { className: "dsvm-code" }, installCmd),
              h("button", { className: "dshm-btn sm", onClick: copyCmd }, copied ? lookup("modal.copied") : lookup("modal.copy"))),
          )
        : null,
      // 0.9.15：安装信息就地进 Modal（主人反馈 2026-10-02：进度/终态原先只隔遮罩在底层透出）。
      // 进度行复用 ProgressLine（自轮询 host status）；底层同源行由 MarketTab 在本 Modal 打开时让位。
      // installRec 派生自全局操作记录（DESIGN §2.6「状态不挂卡片」的所有权模型不变，此处只是展示）：
      // 仅 queued/running 挂行，input（兼容待决）走上层 CompatDialog；installNote 为本次终态摘要。
      installRec && (installRec.status === "running" || installRec.status === "queued")
        ? h(ProgressLine, { key: "opprog" })
        : null,
      upgradeRec && (upgradeRec.status === "running" || upgradeRec.status === "queued")
        ? h(ProgressLine, { key: "upprog" })
        : null,
      installNote
        ? h("div", { key: "opnote", className: installNote.kind === "err" ? "dshm-err" : installNote.kind === "hint" ? "dshm-hint" : "dshm-ok" }, installNote.text)
        : null,
      installNote && installNote.kind === "ok"
        ? h("div", { key: "opnote-rh", className: "dshm-hint" }, lookup(profileKind === "desktop" ? "profile.restartHint" : "banner.done"))
        : null,
      ),
      h(
        "div",
        { className: "dsvm-modalactions" },
        it.installed
          ? h(
              React.Fragment,
              null,
              it.outdated
                ? h("button", { className: "dshm-btn primary", disabled: upgradeBusy, onClick: () => onUpgrade(it) }, upgradeBusy ? [h(Spin, { key: "spin" }), h("span", { key: "t", style: { marginLeft: 6 } }, lookup("action.upgrading"))] : lookup("action.upgrade"))
                : null,
              h("span", { className: "dshm-hint" }, lookup("manage.hint")),
            )
          : h("button", { className: "dshm-btn primary", disabled: busy, onClick: () => onInstall(it) }, busy ? h(Spin) : lookup("action.install")),
      ),
    ),
    // 0.9.61（评审 F）：visible 活引用 + index 钳制（后台剔除收缩防越界）
    lb !== null && visible.length ? h(Lightbox, { shots: visible, index: Math.min(lb, visible.length - 1), onNav: setLb, onClose: () => setLb(null) }) : null,
  );
}

export { useModalDepth, DetailModal };
