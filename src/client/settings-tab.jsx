/**
 * ADR-0023 第三刀 T11 组件出仓·批次二（settings-tab.jsx）：自 main.jsx verbatim 迁移，函数体零重写。
 * 成员：regSourceLabel, configStatusLabel, Section, SettingsTab
 */
import React from "react";
const h = React.createElement;
const { useState, useEffect } = React;
import { api, useAsync, fmtDate } from "./hooks.js";
import { lookup } from "./i18n.js";
import { registrySourceKey } from "./installed-view.js";
import { REGISTRY_DEFAULT_TARGET } from "./operations.js";
import { recordSettingsOp } from "./panel-ops.js";
import { Spin } from "./chrome.jsx";
import { OperationsCard } from "./operations-card.jsx";
import { createMarkdown } from "./markdown.js";

// markdown 渲染件工厂（createMarkdown 注入 h，与 main.jsx 同款）
const { ExtLink } = createMarkdown(h);

function regSourceLabel(data) {
  const key = registrySourceKey(data);
  return key === null ? "—" : lookup(key);
}

function configStatusLabel(status) {
  return lookup(`settings.status.${status || "loading"}` || "settings.status.loading");
}

function SettingsTab({ notify, onRegistryChanged, onForceMarket, opsRecords, onOpsClearFinished, onOpsRemove, version }) {
  const reg = useAsync((force) => api("registry", force ? { force: true } : {}), []);
  const cfgState = useAsync(() => api("registry-config"), []);
  const [busy, setBusy] = useState(false);
  const [draftAddress, setDraftAddress] = useState(null); // null = 尚未从 configuredAddress 初始化
  const [applying, setApplying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [applyError, setApplyError] = useState(null);
  // 社区开关（0.8.0）：null = 尚未从 registry-config 初始化；切换乐观更新，失败回滚
  const [communityOn, setCommunityOn] = useState(null);
  const [communityBusy, setCommunityBusy] = useState(false);

  const cfgData = cfgState.data;
  useEffect(() => {
    if (draftAddress === null && cfgData) setDraftAddress(cfgData.registryUrl ?? "");
  }, [cfgData, draftAddress]);
  useEffect(() => {
    if (communityOn === null && cfgData) setCommunityOn(cfgData.communityCatalog === true);
  }, [cfgData, communityOn]);

  const refresh = async () => {
    setBusy(true);
    try {
      await reg.reload(true);
      // 0.9.21：强刷后连带重载 registry-config——面板展示的 registryState 优先读 cfgData
      // （挂载时快照，host 侧 controller.snapshot() 内存态），只刷 reg 会出现
      // 「toast 已强制刷新、来源/更新时间/条目数纹丝不动」的假死（实机 2026-10-03 实证）。
      // force 已更新 controller 内存快照，这里零成本取新值。
      await reloadRegistryState().catch(() => undefined);
      // 0.9.45 P2（ADR-0013）：强刷穿透探测缓存——市场两区以 force 重取（core peek 旧值兜底 + 全页重探）
      onForceMarket?.();
      notify({ kind: "ok", text: lookup("registry.refreshed"), needsRestart: false });
    } finally {
      setBusy(false);
    }
  };

  const reloadRegistryState = async () => {
    await cfgState.reload().catch(() => undefined);
  };

  const applyAddress = async (raw) => {
    setApplying(true);
    setApplyError(null);
    // from 值取点击时的配置态（草稿仅在 cfgData 到位后可编辑，按钮 disabled: draftAddress===null，
    // 故能走到这里 cfgData 必已加载）；外部直改窗口期 from 取面板视角，可陈旧（apply 响应只含后态，
    // 无更优数据源，可接受）。空地址与恢复默认统一记 REGISTRY_DEFAULT_TARGET。
    const prevAddress = typeof (cfgData && cfgData.registryUrl) === "string" ? cfgData.registryUrl.trim() : "";
    try {
      await api("registry-config-apply", { registryUrl: raw });
      // 设置类终态直落记录（2026-10-10）：清单源 = 信任根变更，记成功——校验拒绝不记录
      //（无状态变更且卡片红字就地呈现，高频试错入记录只会制造红点噪音）。
      const to = typeof raw === "string" ? raw.trim() : "";
      recordSettingsOp("registry-url", to === "" ? REGISTRY_DEFAULT_TARGET : to, "done", { from: prevAddress === "" ? REGISTRY_DEFAULT_TARGET : prevAddress });
      setDraftAddress(typeof raw === "string" ? raw.trim() : "");
      notify({ kind: "ok", text: raw.trim() === "" ? lookup("settings.reset.ok") : lookup("settings.apply.ok"), needsRestart: false });
      // 先同步配置状态，再让父层按顺序重载市场/已装
      await reloadRegistryState();
      onRegistryChanged?.();
    } catch (e) {
      const message = String((e && e.message) || e);
      setApplyError(message);
      await reloadRegistryState().catch(() => undefined);
    } finally {
      setApplying(false);
    }
  };

  const downloadDefault = async () => {
    setDownloading(true);
    try {
      const res = await api("registry-default-download");
      const text = JSON.stringify(res.registry, null, 2);
      const blob = new Blob([text], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "registry.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify({ kind: "ok", text: lookup("settings.download.ok"), needsRestart: false });
    } catch (e) {
      notify({ kind: "err", text: lookup("settings.download.failed", { err: (e && e.message) || e }) });
    } finally {
      setDownloading(false);
    }
  };

  const snap = cfgData || {};
  const state = snap.registryState || (reg.data ? reg.data.registryState : null) || null;
  // 设置页社区 summary 数据源 = registry 响应（Task 6 契约：registry 分支携带 community）
  const communitySummary = reg.data && reg.data.community && typeof reg.data.community === "object" ? reg.data.community : null;

  // 社区开关（0.8.0）：乐观更新 + 失败回滚；成功后面板内数据全部重载（市场两分区/已装/配置态）——真正的「实时生效」
  const applyCommunity = async (enabled) => {
    const prev = communityOn;
    setCommunityOn(enabled);
    setCommunityBusy(true);
    try {
      await api("set-community", { enabled });
      // 设置类终态直落记录（2026-10-10）：社区目录开关 = 供给面/信任边界变更，成败皆记——
      // 失败 = 已接受的变更尝试中途失败回滚，有「以为关了其实没关」的误信风险，红点值得点亮。
      // 落点紧贴 api 成功（= Host 事务边界，镜像 applyAddress），不依赖刷新链的吞错行为。
      recordSettingsOp("community-toggle", "community-catalog", "done", { on: enabled });
      await reloadRegistryState();
      await (onRegistryChanged ? onRegistryChanged() : reg.reload(false));
      notify({ kind: "ok", text: lookup(enabled ? "settings.community.on.ok" : "settings.community.off.ok"), needsRestart: false });
    } catch (e) {
      setCommunityOn(prev);
      recordSettingsOp("community-toggle", "community-catalog", "failed", { on: enabled }, String((e && e.message) || e));
      notify({ kind: "err", text: lookup("settings.community.toggle.failed", { err: (e && e.message) || e }) });
    } finally {
      setCommunityBusy(false);
    }
  };

  const communityLive = communitySummary && (communitySummary.status === "ready" || communitySummary.status === "stale");
  const communityStatusBadge = !communityLive
    ? { cls: "err", label: lookup("settings.status.unavailable") }
    : communitySummary.status === "stale"
      ? { cls: "warn", label: lookup("settings.community.status.stale") }
      : { cls: "ok", label: lookup("settings.status.ready") };

  // 社区卡（0.9.x 布局重构）：清爽列表行复用器；开关 = 列表末行，关态 = 提示 + 开关行
  const kvlineRow = (labelKey, valueNode) =>
    h(
      "div",
      { className: "dshm-kvline-row" },
      h("span", { className: "rl" }, lookup(labelKey)),
      h("span", { className: "rv" }, valueNode),
    );
  // 开关入标题行（2026-10-13 UX 修复·方案A）：原先开关行固定在 body 末尾，关态 5 行元信息
  // 消失会把开关上提约 5 行高；标题行位置恒定 → 开关 ON/OFF 零移动，且与已装卡片右上角
  // 开关同一交互语言。语义保留在 title tooltip（settings.community.toggle）。
  const communitySwitch = h(
    "label",
    {
      className: `dshm-switch${communityOn ? " on" : ""}${communityBusy || communityOn === null ? " locked" : ""}`,
      title: lookup("settings.community.toggle"),
    },
    h("input", {
      type: "checkbox",
      checked: communityOn === true,
      disabled: communityBusy || communityOn === null,
      onChange: (e) => applyCommunity(e.target.checked),
    }),
    h("span", { className: "dshm-switch-slider" }),
  );
  const communityBody =
    communityOn === false
      ? h(
          React.Fragment,
          null,
          h("div", { className: "dshm-hint" }, lookup("settings.community.off")),
        )
      : h(
          "div",
          { className: "dshm-kvlines" },
          kvlineRow("settings.community.status", h(
            "span",
            null,
            h("span", { className: `dshm-dot${communityStatusBadge.cls === "ok" ? "" : ` ${communityStatusBadge.cls}`}` }),
            communityStatusBadge.label,
          )),
          kvlineRow("settings.community.version", communityLive ? communitySummary.version || "—" : "—"),
          kvlineRow("settings.community.route", communityLive ? communitySummary.route || "—" : "—"),
          kvlineRow("settings.community.count", communityLive ? lookup("settings.community.count.v", { n: communitySummary.acceptedCount ?? 0, up: communitySummary.upstreamCount ?? "—" }) : "—"),
          kvlineRow("settings.community.displaced", communityLive ? lookup("settings.community.displaced.v", { n: communitySummary.displaced ?? 0 }) : "—"),
        );
  // 两清单并排（终审 2026-10-09 mock 定稿；0.9.88 门控改容器宽）：常态 4:7；容器 ≥1100px 关于升三卡行（0.9.91 起 4:7:4，左右窄卡等宽）；≤760px 视口单列
  return h(
    "div",
    { className: "dshm-settings-grid" },
    // ① 社区清单（awesome-dsh-plugin）：左卡；开关在标题行右侧（位置恒定，2026-10-13 方案A）
    h(
      "div",
      { className: "dshm-section" },
      h("div", { className: "dshm-section-title" }, lookup("settings.community"), communitySwitch),
      communityBody,
      communitySummary && Array.isArray(communitySummary.errors) && communitySummary.errors.length && communityOn !== false
        ? h("div", { className: "dshm-err" }, communitySummary.errors.join("；"))
        : null,
    ),
    // ② 精选清单（registry.json）：自定义源整体替换主清单，仅影响市场「精选」区
    Section(lookup("settings.registry"),
      h("div", { className: "dshm-row", style: { flexDirection: "column", alignItems: "stretch", gap: "4px" } },
        h("input", {
          className: "dshm-input",
          placeholder: lookup("settings.address.ph"),
          value: draftAddress ?? "",
          onChange: (e) => setDraftAddress(e.target.value),
          spellcheck: "false",
        }),
        h("div", { className: "dshm-note" }, lookup("settings.note.custom")),
      ),
      h("div", { className: "dshm-actions" },
        h("button", { className: "dshm-btn sm", disabled: busy || reg.loading, onClick: refresh }, busy || reg.loading ? h(Spin) : lookup("settings.force")),
        h("button", {
          className: "dshm-btn primary sm",
          // 空草稿时禁用：回到默认只走「恢复默认」一条路，避免与右侧按钮双通道等价
          disabled: applying || draftAddress === null || (draftAddress ?? "").trim() === "",
          onClick: () => applyAddress(draftAddress ?? ""),
        }, applying ? h("span", null, lookup("settings.apply.applying"), " ", h(Spin)) : lookup("settings.apply")),
        h("button", {
          className: "dshm-btn sm",
          disabled: applying || draftAddress === null || (draftAddress ?? "").trim() === "",
          onClick: () => applyAddress(""),
        }, lookup("settings.reset")),
        h("button", {
          className: "dshm-btn sm",
          disabled: downloading,
          title: lookup("settings.download.title"),
          onClick: downloadDefault,
        }, downloading ? h("span", null, lookup("settings.download.downloading"), " ", h(Spin)) : lookup("settings.download")),
      ),
      applyError ? h("div", { className: "dshm-err" }, lookup("settings.apply.failed", { err: applyError })) : null,
      // 配置状态仅在异常态出现（ready 是无信息量的常态，不再常驻）
      snap.configStatus && snap.configStatus !== "ready"
        ? h("div", { className: snap.configStatus === "pending" ? "dshm-note warn" : "dshm-err" },
            `${lookup("settings.status.label")}：${configStatusLabel(snap.configStatus)}${snap.configErrors && snap.configErrors.length ? `（${snap.configErrors.slice(0, 2).join("；")}）` : ""}`)
        : null,
      h("div", { className: "dshm-kv", style: { marginTop: "4px" } },
        h("span", { className: "k" }, lookup("settings.configured")),
        h("span", null, snap.registryUrl ? h("span", { className: "dshm-code dshm-code-1line", title: snap.registryUrl }, snap.registryUrl) : h("span", { className: "dshm-hint" }, lookup("settings.address.default"))),
        h("span", { className: "k" }, lookup("settings.effective")),
        h("span", null, regSourceLabel(state), state && !state.isDefault ? h("span", { className: "dshm-badge info", style: { marginLeft: "6px" } }, lookup("badge.custom")) : null),
        h("span", { className: "k" }, lookup("settings.updated")), h("span", null, fmtDate(state && state.fetchedAt)),
        h("span", { className: "k" }, lookup("settings.count")), h("span", null, state ? lookup("settings.count.v", { n: state.count ?? 0 }) : "—"),
      ),
      state && !state.isDefault
        ? h("div", { className: "dshm-note warn" }, lookup("settings.trust.hint"))
        : null,
      snap.warnings && snap.warnings.length
        ? h("div", { className: "dshm-note warn" }, `${lookup("settings.warnings")}：${snap.warnings.join("；")}`)
        : null,
      state && state.errors && state.errors.length
        ? h("div", { className: "dshm-err" }, `${lookup("settings.remotehint")}：${state.errors.slice(0, 5).join("；")}`)
        : null,
    ),
    // ③ 关于：当前定位 + 仓库/反馈链接（dsh-m 自身卡已按主人要求移除——升级走市场卡片/CLI，self-check/self-upgrade API 保留）。
    //    版本号挂链接行尾（0.9.85 主人定稿：0.9.84 曾挂标题 sub，真机对照后迁此——与 GitHub/npm 等
    //    外向元数据同组更协调）；缺失（ping 失败 → null）时整段不渲染，不留悬空分隔点；
    //    不放升级入口——头部 ⬆ + 市场卡片/CLI 所有权不变。
    Section(lookup("settings.about"),
      h("div", { className: "dshm-hint" }, lookup("settings.about.text")),
      h("div", { className: "dshm-links" },
        h(ExtLink, { href: "https://github.com/iasiv5/dsh-m" }, "GitHub"),
        h("span", { className: "dshm-links-sep" }, "·"),
        h(ExtLink, { href: "https://github.com/iasiv5/dsh-m/issues" }, lookup("settings.about.issues")),
        h("span", { className: "dshm-links-sep" }, "·"),
        h(ExtLink, { href: "https://www.npmjs.com/package/dsh-m" }, lookup("settings.about.npm")),
        version
          ? [
              h("span", { className: "dshm-links-sep" }, "·"),
              h("span", { className: "dshm-links-ver" }, `v${version}`),
            ]
          : null,
      ),
    ),
    // ④ 操作记录：恒通宽卡（第二批搬迁），进行中常驻 + 已结束滚动区，空态 hint 导览
    h(OperationsCard, { records: opsRecords, onClearFinished: onOpsClearFinished, onRemove: onOpsRemove }),
  );
}

function Section(title, sub, ...children) {
  // 兼容无 sub 的调用：第一个参数不是字符串时视为 children，避免内容被塞进标题行右侧
  if (sub != null && typeof sub !== "string") {
    children = [sub, ...children];
    sub = null;
  }
  return h(
    "div",
    { className: "dshm-section" },
    h("div", { className: "dshm-section-title" },
      title,
      sub ? h("span", { className: "dshm-section-sub" }, sub) : null,
    ),
    ...children,
  );
}

export { regSourceLabel, configStatusLabel, Section, SettingsTab };
