// dsh-m client (web bundle)。构建产物 lib/client.js 由 scripts/build.mjs 包裹为
// window.__ModuleLoader__.load({ id: "dsh-m", factory: (require) => { ... } })。
// 运行环境由 loader 提供 react / react-dom（peer，零自带运行时依赖）。
// UI：3 视图（市场/已装/设置）+ 卡片展开详情 + 重启横幅。中文，跟随 DSH Web 深色主题。
const React = require("react");
const rd = require("react-dom");
const h = React.createElement;
const { useState, useEffect, useCallback, useMemo } = React;

const PLUGIN_ID = "dsh-m";
const API = "/dshm";
const CATEGORIES = [
  ["market", "市场"],
  ["tools", "工具"],
  ["ui", "界面"],
  ["search", "搜索"],
  ["media", "多媒体"],
  ["other", "其他"],
];

// ---------- 样式（跟随 DSH Web 主题变量，深浅色自适应） ----------
const CSS = `
.dshm-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-mask-3,rgba(15,23,42,.48));display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box}
.dshm-panel{width:min(920px,100%);height:min(680px,86vh);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:14px;box-shadow:0 18px 48px rgba(2,6,23,.25);overflow:hidden;font-family:inherit;color:var(--dsw-alias-label-primary,inherit)}
.dshm-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.dshm-title{font-weight:700;font-size:15px;margin-right:6px}
.dshm-tab{border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);border-radius:8px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}
.dshm-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dshm-tab.on{background:var(--dsw-alias-bg-layer-4,#eef2ff);color:var(--dsw-alias-label-primary,inherit);border-color:var(--dsw-alias-border-l2,#e5e7eb);font-weight:600}
.dshm-spacer{flex:1}
.dshm-body{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px}
.dshm-hint{color:var(--dsw-alias-label-caption,#6b7280);font-size:12px;line-height:18px;margin:0}
.dshm-err{color:var(--dsw-alias-state-danger-primary,#dc2626);font-size:12px;line-height:18px}
.dshm-btn{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,inherit);border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dshm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dshm-btn:disabled{opacity:.5;cursor:default}
.dshm-btn.primary{background:var(--dsw-alias-interactive-bg-selected,#4f46e5);border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5);color:#fff}
.dshm-btn.primary:hover{filter:brightness(1.08)}
.dshm-btn.danger{color:var(--dsw-alias-state-danger-primary,#dc2626);border-color:var(--dsw-alias-state-danger-primary,#dc2626)}
.dshm-btn.sm{padding:3px 9px;font-size:11px}
.dshm-input{flex:1;min-width:120px;border:1px solid var(--dsw-alias-border-l2,#c7d2fe);background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary,inherit);border-radius:8px;padding:6px 10px;font:inherit;font-size:13px;outline:none}
.dshm-input:focus{border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5)}
.dshm-chips{display:flex;flex-wrap:wrap;gap:6px}
.dshm-chip{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);border-radius:999px;padding:2px 10px;font:inherit;font-size:11px;cursor:pointer}
.dshm-chip.on{background:var(--dsw-alias-bg-layer-4,#eef2ff);color:var(--dsw-alias-label-primary,inherit);border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5)}
.dshm-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@media (max-width:680px){.dshm-cards{grid-template-columns:1fr}}
.dshm-card{display:flex;gap:12px;align-items:flex-start;background:var(--dsw-alias-bg-layer-2,rgba(38,49,72,.04));border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:12px;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;min-width:0;font:inherit;color:var(--dsw-alias-label-primary,inherit);transition:border-color .16s,background .16s}
.dshm-card:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));border-color:var(--dsw-alias-label-dimmed,#c7d2fe)}
.dshm-icon{width:40px;height:40px;border-radius:10px;object-fit:cover;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);flex-shrink:0;background:linear-gradient(135deg,#c7d2fe,#fbcfe8);display:grid;place-items:center;font-weight:700;font-size:16px;color:#374151}
.dshm-meta{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.dshm-top{display:flex;align-items:center;gap:8px;min-width:0}
.dshm-name{flex:1;min-width:0;font-weight:600;font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshm-badge{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-state-success-tertiary,#ecfdf5);color:var(--dsw-alias-state-success-primary,#047857)}
.dshm-badge.warn{background:var(--dsw-alias-state-warning-tertiary,#fffbeb);color:var(--dsw-alias-state-warning-primary,#b45309)}
.dshm-badge.info{background:var(--dsw-alias-bg-layer-4,#eef2ff);color:var(--dsw-alias-label-secondary,#4b5563)}
.dshm-badge.err{background:var(--dsw-alias-state-danger-tertiary,#fef2f2);color:var(--dsw-alias-state-danger-primary,#dc2626)}
.dshm-desc{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dshm-sub{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-caption,#6b7280)}
.dshm-detail{margin-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,#e5e7eb);padding-top:8px;display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563)}
.dshm-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.dshm-banner{display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-state-warning-tertiary,#fffbeb);color:var(--dsw-alias-state-warning-primary,#b45309);font-size:12px}
.dshm-banner .dshm-banner-text{flex:1}
.dshm-row{display:flex;align-items:center;gap:8px}
.dshm-kv{display:grid;grid-template-columns:110px 1fr;gap:4px 10px;font-size:12px}
.dshm-kv .k{color:var(--dsw-alias-label-caption,#6b7280)}
.dshm-spin{display:inline-block;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2,#c7d2fe);border-top-color:var(--dsw-alias-interactive-bg-selected,#4f46e5);border-radius:50%;animation:dshm-rot .8s linear infinite;vertical-align:-2px}
@keyframes dshm-rot{to{transform:rotate(360deg)}}
.dshm-empty{text-align:center;color:var(--dsw-alias-label-caption,#6b7280);font-size:13px;padding:32px 0}
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

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("zh-CN", { hour12: false }) : "—";
}

function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const run = useCallback((force) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    return fn(force)
      .then((data) => setState({ loading: false, data, error: null }))
      .catch((err) => setState({ loading: false, data: null, error: String((err && err.message) || err) }));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    run(false);
  }, [run]);
  return { ...state, reload: run };
}

// ---------- 通用小组件 ----------
function Icon({ entry }) {
  const [broken, setBroken] = useState(false);
  const letter = String(entry.name || entry.id || "?").charAt(0).toUpperCase();
  const url = entry.icon || (entry.github ? `https://github.com/${entry.github.split("/")[0]}.png?size=64` : null);
  if (!url || broken) {
    return h("div", { className: "dshm-icon", "aria-hidden": "true" }, letter);
  }
  return h("img", {
    className: "dshm-icon",
    src: url,
    alt: "",
    onError: () => setBroken(true),
    referrerPolicy: "no-referrer",
  });
}

function Spin() {
  return h("span", { className: "dshm-spin" });
}

function TwoStepButton({ label, confirmLabel, className, onConfirm, disabled }) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 4000);
    return () => clearTimeout(t);
  }, [arm]);
  return h(
    "button",
    {
      className: `${className || "dshm-btn"} ${arm ? "danger" : ""}`.trim(),
      disabled,
      onClick: (e) => {
        e.stopPropagation();
        if (!arm) {
          setArm(true);
        } else {
          setArm(false);
          onConfirm();
        }
      },
    },
    arm ? confirmLabel : label,
  );
}

// ---------- 重启横幅 ----------
function RestartBanner({ note, onDone }) {
  const [phase, setPhase] = useState("idle"); // idle | restarting | waiting
  const [err, setErr] = useState(null);
  const restart = useCallback(async () => {
    setErr(null);
    setPhase("restarting");
    try {
      const ping0 = await api("ping");
      await api("restart");
      setPhase("waiting");
      const deadline = Date.now() + 90_000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        if (Date.now() > deadline) throw new Error("重启超时，请手动检查 dsh web 服务状态");
        try {
          const ping = await api("ping");
          if (ping.boot !== ping0.boot) break;
        } catch {
          /* 服务重启中，继续轮询 */
        }
      }
      setPhase("idle");
      onDone(true);
    } catch (e) {
      setPhase("idle");
      setErr(String((e && e.message) || e));
    }
  }, [onDone]);
  return h(
    "div",
    { className: "dshm-banner" },
    h("span", { className: "dshm-banner-text" },
      phase === "restarting" ? "正在请求重启…" :
      phase === "waiting" ? "已请求重启，等待 DSH Web 恢复…" :
      err ? `重启失败：${err}` :
      note || "本次变更需要重启 DSH Web 后生效。"),
    phase === "idle" && !err ? h("button", { className: "dshm-btn primary sm", onClick: restart }, "⚡ 一键重启") : null,
    phase === "restarting" || phase === "waiting" ? Spin() : null,
    phase === "idle" && err ? h("button", { className: "dshm-btn sm", onClick: () => onDone(false) }, "知道了") : null,
    phase === "idle" && !err ? h("button", { className: "dshm-btn sm", onClick: () => onDone(false) }, "稍后") : null,
  );
}

// ---------- 市场页 ----------
function MarketTab({ notify }) {
  const { loading, data, error, reload } = useAsync((force) => api("market", force ? { force: true } : {}), []);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const items = useMemo(() => {
    const list = (data && data.items) || [];
    const kw = q.trim().toLowerCase();
    return list.filter((it) => {
      if (cat && it.category !== cat) return false;
      if (!kw) return true;
      const hay = `${it.id} ${it.name} ${it.description} ${(it.tags || []).join(" ")}`.toLowerCase();
      return hay.includes(kw);
    });
  }, [data, q, cat]);

  const doInstall = async (it, version) => {
    setBusyId(it.id);
    try {
      const res = await api("install", { id: it.id, ...(version ? { version } : {}) });
      notify({
        kind: "ok",
        text: `已安装 ${res.pkg}${res.version ? ` v${res.version}` : ""}` +
          (res.usedAllowAllBuilds ? "（注意：该插件执行了构建脚本，已按策略放行）" : ""),
      });
      await reload(false);
    } catch (e) {
      notify({ kind: "err", text: `安装失败：${(e && e.message) || e}` });
    } finally {
      setBusyId(null);
    }
  };

  return h(
    React.Fragment,
    null,
    h(
      "div",
      { className: "dshm-row" },
      h("input", {
        className: "dshm-input",
        placeholder: "搜索名称 / 描述 / 标签…",
        value: q,
        onChange: (e) => setQ(e.target.value),
      }),
      h("button", { className: "dshm-btn", onClick: () => reload(true), title: "强制刷新（跳过缓存）" }, loading ? Spin() : "↻ 刷新"),
    ),
    h(
      "div",
      { className: "dshm-chips" },
      h("button", { className: `dshm-chip${cat === null ? " on" : ""}`, onClick: () => setCat(null) }, "全部"),
      CATEGORIES.map(([key, label]) => {
        const n = ((data && data.items) || []).filter((it) => it.category === key).length;
        return h(
          "button",
          { key, className: `dshm-chip${cat === key ? " on" : ""}`, onClick: () => setCat(cat === key ? null : key) },
          `${label}${n ? ` ${n}` : ""}`,
        );
      }),
    ),
    loading && !data
      ? h("div", { className: "dshm-empty" }, "加载收录清单中… ", Spin())
      : error
        ? h("div", { className: "dshm-err" }, `加载失败：${error}`)
        : items.length === 0
          ? h("div", { className: "dshm-empty" }, "没有匹配的收录条目")
          : h(
              "div",
              { className: "dshm-cards" },
              items.map((it) => Card({
                key: it.id,
                icon: h(Icon, { entry: it }),
                name: it.name,
                badges: [
                  it.outdated ? h("span", { className: "dshm-badge warn", key: "u" }, "可升级") : null,
                  it.installed ? h("span", { className: "dshm-badge", key: "i" }, "已安装") : null,
                  h("span", { className: "dshm-badge info", key: "s" }, it.source === "npm" ? "npm" : "github"),
                ],
                desc: it.description,
                sub: [
                  it.latestVersion ? `最新 v${it.latestVersion}` : it.latestSha ? `HEAD ${it.latestSha.slice(0, 7)}` : null,
                  it.installedVersion ? `已装 v${it.installedVersion}` : null,
                  it.latestError ? `版本查询失败` : null,
                ].filter(Boolean).join(" · "),
                open: openId === it.id,
                onToggle: () => setOpenId(openId === it.id ? null : it.id),
                detail: DetailRows([
                  ["收录 id", it.id],
                  ["来源", it.source === "npm" ? `npm · ${it.npm}` : `GitHub · ${it.github}`],
                  ["最新", it.latestVersion ? `v${it.latestVersion}` : it.latestSha ? it.latestSha : it.latestError || "—"],
                  ["已装", it.installedPkg ? `${it.installedPkg} v${it.installedVersion || "?"}` : "未安装"],
                  ["标签", (it.tags || []).join("、") || "—"],
                  it.latestError ? ["提示", `版本查询失败：${it.latestError}`] : null,
                ]),
                actions: [
                  it.installed
                    ? h("span", { className: "dshm-hint", key: "hint" }, "已安装，可在「已装」页管理")
                    : h("button", {
                        key: "install",
                        className: "dshm-btn primary sm",
                        disabled: busyId === it.id,
                        onClick: (e) => {
                          e.stopPropagation();
                          doInstall(it);
                        },
                      },
                      busyId === it.id ? h(Spin) : "安装"),
                ],
              })),
            ),
  );
}

// ---------- 已装页 ----------
function InstalledTab({ notify }) {
  const { loading, data, error, reload } = useAsync(() => api("installed"), []);
  const [openPkg, setOpenPkg] = useState(null);
  const [busyPkg, setBusyPkg] = useState(null);

  const doUninstall = async (it) => {
    setBusyPkg(it.pkg);
    try {
      const res = await api("uninstall", { pkg: it.pkg });
      notify({
        kind: "ok",
        text: `已卸载 ${res.pkg}${res.liveDisabled ? "（已先下线运行中的界面）" : ""}` +
          (res.leftovers && res.leftovers.length ? `；检测到疑似残留数据：${res.leftovers.join("、")}` : ""),
      });
      await reload();
    } catch (e) {
      notify({ kind: "err", text: `卸载失败：${(e && e.message) || e}` });
    } finally {
      setBusyPkg(null);
    }
  };

  const doUpgrade = async (it) => {
    setBusyPkg(it.pkg);
    try {
      const res = await api("upgrade", { pkg: it.pkg });
      notify({
        kind: "ok",
        text: `已升级 ${res.pkg}${res.fromVersion ? `（v${res.fromVersion} → ${res.version ? `v${res.version}` : res.sha ? res.sha.slice(0, 7) : "最新"}）` : ""}` +
          (res.usedAllowAllBuilds ? "（注意：该插件执行了构建脚本）" : ""),
      });
      await reload();
    } catch (e) {
      notify({ kind: "err", text: `升级失败：${(e && e.message) || e}` });
    } finally {
      setBusyPkg(null);
    }
  };

  if (loading && !data) return h("div", { className: "dshm-empty" }, "读取 web profile 中… ", Spin());
  if (error) return h("div", { className: "dshm-err" }, `读取失败：${error}`);
  const items = (data && data.items) || [];
  if (!items.length) return h("div", { className: "dshm-empty" }, `web profile 尚未安装任何 dsh 插件（${data.profileDir}）`);

  return h(
    React.Fragment,
    null,
    h("div", { className: "dshm-hint" }, `web profile：${data.profileDir}${data.others ? ` · 另有 ${data.others} 个非 dsh 依赖未列出` : ""}`),
    h(
      "div",
      { className: "dshm-cards" },
      items.map((it) => Card({
        key: it.pkg,
        icon: h(Icon, { entry: { name: it.name, github: it.spec.startsWith("github:") ? it.spec.slice(7).split("#")[0] : null, icon: null } }),
        name: it.name,
        badges: [
          it.outdated ? h("span", { className: "dshm-badge warn", key: "u" }, `可升级${it.latestVersion ? ` → v${it.latestVersion}` : ""}`) : null,
          it.registryId ? h("span", { className: "dshm-badge", key: "r" }, "市场安装") : h("span", { className: "dshm-badge info", key: "r" }, "非市场安装"),
        ],
        desc: it.description || "（无描述）",
        sub: [
          `v${it.version || "?"}`,
          { npm: "npm", github: "github", link: "本地 link", file: "本地 file", unknown: "未知" }[it.source] || it.source,
        ].join(" · "),
        open: openPkg === it.pkg,
        onToggle: () => setOpenPkg(openPkg === it.pkg ? null : it.pkg),
        detail: DetailRows([
          ["包名", it.pkg],
          ["安装 spec", it.spec],
          ["最新", it.latestVersion ? `v${it.latestVersion}` : "—"],
          ["收录", it.registryId || "不在收录清单中"],
          ["路径", it.path],
        ]),
        actions: [
          it.outdated
            ? h("button", {
                key: "up",
                className: "dshm-btn primary sm",
                disabled: busyPkg === it.pkg,
                onClick: (e) => {
                  e.stopPropagation();
                  doUpgrade(it);
                },
              },
              busyPkg === it.pkg ? h(Spin) : "升级")
            : null,
          it.registryId || it.source === "npm"
            ? h(TwoStepButton, {
                key: "un",
                label: "卸载",
                confirmLabel: "确认卸载？",
                className: "dshm-btn sm",
                disabled: busyPkg === it.pkg,
                onConfirm: () => doUninstall(it),
              })
            : null,
        ],
      })),
    ),
  );
}

// ---------- 设置页 ----------
function SettingsTab({ notify }) {
  const reg = useAsync((force) => api("registry", force ? { force: true } : {}), []);
  const self = useAsync(() => api("self-check"), []);
  const [busy, setBusy] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      await reg.reload(true);
      notify({ kind: "ok", text: "收录清单已强制刷新" });
    } finally {
      setBusy(false);
    }
  };

  const upgradeSelf = async () => {
    setUpgrading(true);
    try {
      const res = await api("self-upgrade");
      notify({ kind: "ok", text: `dsh-m 已更新到 v${res.version}，重启后生效` });
      await self.reload();
    } catch (e) {
      notify({ kind: "err", text: `自更新失败：${(e && e.message) || e}` });
    } finally {
      setUpgrading(false);
    }
  };

  return h(
    React.Fragment,
    null,
    Section("收录清单（registry）",
      h("div", { className: "dshm-kv" },
        h("span", { className: "k" }, "当前来源"), h("span", null, regSourceLabel(reg.data)),
        h("span", { className: "k" }, "更新时间"), h("span", null, fmtDate(reg.data && reg.data.fetchedAt)),
        h("span", { className: "k" }, "条目数"), h("span", null, reg.data ? `${reg.data.plugins.length} 条` : "—"),
        h("span", { className: "k" }, "缓存策略"), h("span", null, "TTL 60 分钟；设置 registryUrl 可覆盖源"),
      ),
      reg.data && reg.data.errors && reg.data.errors.length
        ? h("div", { className: "dshm-err" }, `远端提示：${reg.data.errors.join("；")}`)
        : null,
      h("div", { className: "dshm-actions" },
        h("button", { className: "dshm-btn sm", disabled: busy || reg.loading, onClick: refresh }, busy || reg.loading ? h(Spin) : "强制刷新"),
      ),
    ),
    Section("dsh-m 自身",
      h("div", { className: "dshm-kv" },
        h("span", { className: "k" }, "当前版本"), h("span", null, self.data ? `v${self.data.current}` : "—"),
        h("span", { className: "k" }, "npm 最新"), h("span", null, self.data ? (self.data.latest ? `v${self.data.latest}` : `查询失败${self.data.error ? `：${self.data.error}` : ""}`) : "…"),
      ),
      self.data && self.data.outdated
        ? h("div", { className: "dshm-actions" },
            h("button", { className: "dshm-btn primary sm", disabled: upgrading, onClick: upgradeSelf }, upgrading ? h(Spin) : "升级 dsh-m"),
            h("span", { className: "dshm-hint" }, "升级后同样需要重启生效"),
          )
        : null,
    ),
    Section("关于",
      h("div", { className: "dshm-hint" },
        "DSH Marketplace（dsh-m）— 个人自用的 DeepSeek Harness 插件市场。收录、安装、卸载、升级，全部本机完成。",
      ),
    ),
  );
}

function regSourceLabel(data) {
  if (!data) return "—";
  const map = { override: "自定义源", jsdelivr: "jsDelivr（@main）", raw: "raw.githubusercontent（@main）", cache: "本地缓存", bundled: "包内快照（兜底）" };
  return map[data.source] || data.source;
}

function Section(title, ...children) {
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "8px" } },
    h("div", { style: { fontWeight: 600, fontSize: "13px" } }, title),
    ...children,
  );
}

function DetailRows(rows) {
  const list = rows.filter(Boolean);
  return h(
    "div",
    { className: "dshm-kv" },
    list.flatMap(([k, v]) => [
      h("span", { className: "k", key: `${k}-k` }, k),
      h("span", { key: `${k}-v`, style: { wordBreak: "break-all" } }, String(v)),
    ]),
  );
}

// ---------- 卡片（市场/已装共用） ----------
function Card({ icon, name, badges, desc, sub, open, onToggle, detail, actions }) {
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
      h("div", { className: "dshm-top" }, h("span", { className: "dshm-name" }, name), ...badges.filter(Boolean)),
      h("div", { className: "dshm-desc", style: open ? { WebkitLineClamp: "unset" } : null }, desc),
      sub ? h("div", { className: "dshm-sub" }, sub) : null,
      open ? h("div", { className: "dshm-detail" }, detail) : null,
      open && actions && actions.length ? h("div", { className: "dshm-actions" }, ...actions) : null,
    ),
  );
}

// ---------- 面板（3 视图容器） ----------
const TABS = [
  ["market", "市场"],
  ["installed", "已装"],
  ["settings", "设置"],
];

function MarketPanel({ onClose }) {
  const [tab, setTab] = useState("market");
  const [banner, setBanner] = useState(null); // { text } | null
  const [toast, setToast] = useState(null); // { kind, text } | null
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const notify = useCallback(({ kind, text }) => {
    setToast({ kind, text });
    if (kind === "ok") setBanner({ text: "变更完成，需要重启 DSH Web 后生效。" });
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
        h("span", { className: "dshm-title" }, "🛍 DSH 市场"),
        TABS.map(([key, label]) =>
          h("button", { key, className: `dshm-tab${tab === key ? " on" : ""}`, onClick: () => setTab(key) }, label),
        ),
        h("span", { className: "dshm-spacer" }),
        h("button", { className: "dshm-btn", onClick: onClose }, "关闭"),
      ),
      h(
        "div",
        { className: "dshm-body" },
        tab === "market" ? h(MarketTab, { notify }) : null,
        tab === "installed" ? h(InstalledTab, { notify }) : null,
        tab === "settings" ? h(SettingsTab, { notify }) : null,
      ),
      toast
        ? h("div", { className: `dshm-banner`, style: toast.kind === "err" ? { background: "var(--dsw-alias-state-danger-tertiary,#fef2f2)", color: "var(--dsw-alias-state-danger-primary,#dc2626)" } : null },
            h("span", { className: "dshm-banner-text" }, toast.text))
        : null,
      banner ? h(RestartBanner, { note: banner.text, onDone: () => setBanner(null) }) : null,
    ),
  );
}

// ---------- 侧栏入口 ----------
function MarketEntry({ wide }) {
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
    "button",
    { className: "dshm-btn dshm-entry", onClick: () => setOpen(true), title: "DSH Marketplace", style: { margin: "4px" } },
    "🛍",
    wide ? " DSH 市场" : null,
  );
}

// ---------- 工具卡片视图（tool.call.toolview slots） ----------
// props 契约移植自 skillhub：payload 从 props 中寻找含 items 数组的节点；args 读 block.call.argsRaw。
function registerSlot(slots, options, component) {
  const next = { ...options };
  if (next.id == null && next.key != null) next.id = String(next.key);
  if (next.key == null && next.id != null) next.key = next.id;
  return slots.register(next, component);
}

function pickPayload(props) {
  const found = [];
  const visit = (node, depth) => {
    if (!node || depth > 6) return;
    if (typeof node === "string") {
      const t = node.trim();
      if ((t.startsWith("{") || t.startsWith("[")) && t.length > 8) {
        try {
          visit(JSON.parse(t), depth + 1);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x, depth + 1);
      return;
    }
    if (Array.isArray(node.items)) found.push(node);
    for (const key of ["block", "meta", "result", "resultView", "view", "data", "value", "payload", "content", "message"]) {
      if (node[key] != null) visit(node[key], depth + 1);
    }
  };
  visit(props, 0);
  return found.find((x) => x && Array.isArray(x.items)) || null;
}

function parseToolArgs(props) {
  const block = props?.block;
  const raw = (block && "kind" in block ? block.call?.argsRaw : block?.argsRaw) || "";
  if (!raw || typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function ToolCardRow({ it, onInstalled }) {
  const [busy, setBusy] = useState(false);
  const install = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const res = await api("install", { id: it.id });
      onInstalled({ ...it, installed: true, installedPkg: res.pkg, installedVersion: res.version });
    } catch {
      /* 安装失败静默：对话区文本已给出结果 */
    } finally {
      setBusy(false);
    }
  };
  return h(
    "div",
    { className: "dshm-card", style: { cursor: "default" } },
    h(Icon, { entry: it }),
    h(
      "div",
      { className: "dshm-meta" },
      h(
        "div",
        { className: "dshm-top" },
        h("span", { className: "dshm-name" }, it.name),
        h("span", { className: "dshm-badge info" }, it.source === "npm" ? "npm" : "github"),
        it.installed ? h("span", { className: "dshm-badge" }, "已安装") : null,
      ),
      h("div", { className: "dshm-desc" }, it.description),
      h("div", { className: "dshm-sub" }, `${it.id} · ${(it.tags || []).join("、") || it.category}`),
      h(
        "div",
        { className: "dshm-actions" },
        !it.installed
          ? h("button", { className: "dshm-btn primary sm", disabled: busy, onClick: install }, busy ? h(Spin) : "安装")
          : null,
      ),
    ),
  );
}

function SearchToolView(props) {
  useEffect(() => ensureCss(), []);
  const payload = pickPayload(props);
  const args = parseToolArgs(props);
  const query = String(payload?.query || args.query || "").trim();
  const fromTool = Array.isArray(payload?.items) && payload.items.length ? payload.items : null;
  const running = !!(props?.block && !("kind" in props.block));
  const [items, setItems] = useState(fromTool || []);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (fromTool) setItems(fromTool);
  }, [fromTool]);
  useEffect(() => {
    if (fromTool || running) return;
    let live = true;
    api("search", { query, category: args.category, limit: args.limit })
      .then((d) => {
        if (live) setItems(d.items || []);
      })
      .catch((e) => {
        if (live) {
          setItems([]);
          setErr((e && e.message) || String(e));
        }
      });
    return () => {
      live = false;
    };
  }, [query, running, !!fromTool]); // eslint-disable-line react-hooks/exhaustive-deps
  if (running) return null;
  if (!items.length) return err ? h("div", { className: "dshm-err" }, err) : null;
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "8px" } },
    items.map((it) =>
      h(ToolCardRow, {
        key: it.id,
        it,
        onInstalled: (next) => setItems((cur) => cur.map((x) => (x.id === next.id ? next : x))),
      }),
    ),
  );
}

function ListToolView(props) {
  useEffect(() => ensureCss(), []);
  const payload = pickPayload(props);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) return null;
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" } },
    items.map((it) =>
      h(
        "div",
        { key: it.pkg, className: "dshm-row" },
        h("span", { style: { fontWeight: 600 } }, it.name),
        h("span", { className: "dshm-hint" }, `(${it.pkg})`),
        h("span", { className: "dshm-hint" }, `v${it.version || "?"}`),
        it.registryId ? h("span", { className: "dshm-badge" }, "市场") : h("span", { className: "dshm-badge info" }, "非市场"),
        it.outdated ? h("span", { className: "dshm-badge warn" }, `可升级${it.latestVersion ? ` → v${it.latestVersion}` : ""}`) : null,
      ),
    ),
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
  // 对话区内 dshm_* 工具结果的自定义卡片
  slots.inject("tool.call.toolview", () =>
    registerSlot(slots, { name: "tool.call.toolview", key: "dshm_search" }, SearchToolView),
  );
  slots.inject("tool.call.toolview", () =>
    registerSlot(slots, { name: "tool.call.toolview", key: "dshm_list" }, ListToolView),
  );
  slots.inject("tool.call.toolview", () =>
    registerSlot(slots, { name: "tool.call.toolview", key: "dshm_outdated" }, ListToolView),
  );
}
