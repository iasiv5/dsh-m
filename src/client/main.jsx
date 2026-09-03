// dsh-m client (web bundle)。构建产物 lib/client.js 由 scripts/build.mjs 包裹为
// window.__ModuleLoader__.load({ id: "dsh-m", factory: (require) => { ... } })。
// 运行环境由 loader 提供 react / react-dom（peer，零自带运行时依赖）。
const React = require("react");
const rd = require("react-dom");
const h = React.createElement;
const { useState, useEffect, useCallback } = React;

const PLUGIN_ID = "dsh-m";
const API = "/dshm";

// ---------- 样式（跟随 DSH Web 主题变量） ----------
const CSS = `
.dshm-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-mask-3,rgba(15,23,42,.48));display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box}
.dshm-panel{width:min(880px,100%);max-height:78vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:14px;box-shadow:0 18px 48px rgba(2,6,23,.25);overflow:hidden;font-family:inherit;color:var(--dsw-alias-label-primary,inherit)}
.dshm-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.dshm-title{flex:1;font-weight:700;font-size:15px}
.dshm-body{padding:16px;overflow:auto;display:flex;flex-direction:column;gap:10px}
.dshm-hint{color:var(--dsw-alias-label-caption,#6b7280);font-size:12px;line-height:18px;margin:0}
.dshm-err{color:var(--dsw-alias-state-danger-primary,#dc2626);font-size:12px;line-height:18px}
.dshm-btn{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,inherit);border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer}
.dshm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dshm-entry{display:inline-flex;align-items:center;gap:6px}
`;

function ensureCss() {
  if (typeof document === "undefined" || document.getElementById("dshm-css")) return;
  const el = document.createElement("style");
  el.id = "dshm-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ---------- 本地 API（host: /dshm, method 分发） ----------
async function api(method, params) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, ...(params || {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `API ${res.status}`);
  return data;
}

// ---------- 市场面板（M0 占位；M2 换成 市场/已装/设置 3 视图） ----------
function MarketPanel({ onClose }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    api("ping")
      .then((data) => alive && setState({ loading: false, data }))
      .catch((err) => alive && setState({ loading: false, error: String(err && err.message || err) }));
    return () => {
      alive = false;
    };
  }, []);
  return h(
    "div",
    { className: "dshm-overlay", onClick: onClose },
    h(
      "div",
      { className: "dshm-panel", onClick: (e) => e.stopPropagation() },
      h(
        "div",
        { className: "dshm-head" },
        h("div", { className: "dshm-title" }, "DSH 市场"),
        h("button", { className: "dshm-btn", onClick: onClose }, "关闭"),
      ),
      h(
        "div",
        { className: "dshm-body" },
        state.loading
          ? h("div", { className: "dshm-hint" }, "连接宿主插件中…")
          : state.error
            ? h("div", { className: "dshm-err" }, `连接失败：${state.error}`)
            : h(
                React.Fragment,
                null,
                h("div", { className: "dshm-hint" },
                  `宿主插件 ${state.data.plugin} v${state.data.version} · 连接正常`),
                h("div", { className: "dshm-hint" },
                  "市场页 / 已装页 / 设置页开发中（里程碑 M2）。收录清单与安装能力随 M1/M2 落地。"),
              ),
      ),
    ),
  );
}

// ---------- 侧栏入口 ----------
function MarketEntry() {
  useEffect(() => ensureCss(), []);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);
  const portal =
    open && typeof document !== "undefined"
      ? rd.createPortal(h(MarketPanel, { onClose: close }), document.body)
      : null;
  return h(
    "div",
    { className: "dshm-entry" },
    h(
      "button",
      {
        className: "dshm-btn",
        onClick: () => setOpen(true),
        title: "DSH Marketplace",
      },
      "🛍 DSH 市场",
    ),
    portal,
  );
}

// ---------- loader 契约：factory 返回 { inject, apply } ----------
const inject = ["slots"];

function apply(ctx) {
  const slots = ctx.slots;
  if (!slots) return;
  ctx.effect(() => ensureCss(), "dshm-style");
  slots.inject("sidebar.footer.action", () =>
    slots.register(
      { name: "sidebar.footer.action", id: "dshm-market", key: "dshm-market", order: 9, label: "DSH 市场" },
      MarketEntry,
    ),
  );
}
