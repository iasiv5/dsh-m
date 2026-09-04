// dsh-m client (web bundle)。构建产物 lib/client.js 由 scripts/build.mjs 包裹为
// window.__ModuleLoader__.load({ id: "dsh-m", factory: (require) => { ... } })。
// 运行环境由 loader 提供 react / react-dom（peer，零自带运行时依赖）。
// UI：3 视图（市场/已装/设置）+ 卡片展开详情 + 重启横幅。中文，跟随 DSH Web 深色主题。
const React = require("react");
const rd = require("react-dom");
const h = React.createElement;
const { useState, useEffect, useCallback, useMemo, useRef } = React;

const PLUGIN_ID = "dsh-m";
const API = "/dshm";

// 市场面板 pure state（Node tests 直接覆盖）
const { MARKET_PAGE_SIZE, normalizeMarketQuery, resetPageOnFilterChange, normalizeMarketResponse, registryNotice } = require("./market-state.js");

// ---------- i18n（skillhub 同款：host locale.register + client lookup + {param} 插值） ----------
const ZH = {
  "market.title": "插件市场",
  "tab.market": "市场", "tab.installed": "已装", "tab.settings": "设置",
  "cat.all": "全部", "cat.market": "市场", "cat.tools": "工具", "cat.ui": "界面", "cat.search": "搜索", "cat.media": "多媒体", "cat.other": "其他",
  "search.ph": "搜索名称 / 描述 / 标签…",
  "common.refresh": "刷新", "common.close": "关闭", "common.later": "稍后", "common.ok": "知道了", "common.none": "—",
  "market.loading": "加载收录清单中… ", "market.empty": "没有匹配的收录条目",
  "installed.loading": "读取 web profile 中… ", "installed.empty": "web profile 尚未安装任何 dsh 插件", "installed.none": "未安装",
  "installed.others": "另有 {n} 个非 dsh 依赖（未识别为插件），已默认折叠。",
  "badge.installed": "已安装", "badge.update": "可升级", "badge.market": "市场安装", "badge.nonmarket": "非市场安装",
  "action.install": "安装", "action.upgrade": "升级", "action.uninstall": "卸载",
  "confirm.uninstall": "确认卸载？", "confirm.unlink": "确认移除本地引用？", "confirm.core": "⚠️ 确认卸载核心包？",
  "detail.id": "收录 id", "detail.source": "来源", "detail.latest": "最新", "detail.installed": "已装", "detail.tags": "标签",
  "detail.pkg": "包名", "detail.spec": "安装 spec", "detail.listed": "收录", "detail.listed.no": "不在收录清单中", "detail.path": "路径", "detail.note": "注意", "detail.links": "详情",
  "link.home": "官网",
  "manage.hint": "已安装，可在「已装」页管理",
  "version.failed": "版本查询失败",
  "src.npm": "npm", "src.github": "github", "src.link": "本地 link", "src.file": "本地 file", "src.unknown": "未知",
  "sub.latest": "最新 v{v}", "sub.head": "HEAD {sha}", "sub.installed": "已装 v{v}",
  "settings.registry": "收录清单（registry）", "settings.source": "当前来源", "settings.updated": "更新时间",
  "settings.count": "条目数", "settings.count.v": "{n} 条", "settings.policy": "缓存策略",
  "settings.policy.v": "TTL 60 分钟；设置 registryUrl 可覆盖源", "settings.remotehint": "远端提示",
  "settings.force": "强制刷新", "settings.self": "dsh-m 自身", "settings.current": "当前版本",
  "settings.npmlatest": "npm 最新", "settings.lookupfailed": "查询失败：{err}", "settings.upgradeself": "升级 dsh-m",
  "settings.upgradehint": "升级后同样需要重启生效", "settings.about": "关于",
  "settings.about.text": "DSH Marketplace（dsh-m）— 可自定义收录清单的个人 DSH 插件市场：浏览、安装、卸载、升级，全部本机完成。默认使用官方清单，可下载副本自行编辑后整体覆盖，应用即时生效；同包提供 7 个 dshm_* agent 工具与 dshm CLI。",
  "src.override": "自定义源", "src.jsdelivr": "jsDelivr（@main）", "src.raw": "raw.githubusercontent（@main）", "src.cache": "本地缓存", "src.bundled": "包内快照（兜底）",
  "src.default.raw": "raw.githubusercontent（@main）", "src.default.jsdelivr": "jsDelivr（@main）", "src.default.cache": "默认清单缓存",
  "src.custom.url": "自定义 URL 源", "src.custom.file": "本地文件源", "src.custom.cache": "自定义源（缓存）", "src.custom.unavailable": "自定义源（不可用）",
  "settings.address": "Registry 地址", "settings.address.hint": "空 = 官方默认清单；支持 HTTPS URL 或本机绝对路径 / file://。整体覆盖默认清单，不做合并。",
  "settings.configured": "配置地址", "settings.activecfg": "当前生效配置", "settings.effective": "生效来源",
  "settings.status.label": "配置状态", "settings.status.loading": "加载中", "settings.status.ready": "已生效", "settings.status.pending": "待写入（校验已通过）", "settings.status.rejected": "已拒绝（保持旧配置）", "settings.status.unavailable": "不可用",
  "settings.apply": "校验并应用", "settings.apply.applying": "校验中…", "settings.apply.ok": "Registry 地址已生效（无需重启）", "settings.apply.failed": "应用失败：{err}",
  "settings.reset": "恢复默认", "settings.reset.ok": "已恢复默认收录清单",
  "settings.download": "下载默认 registry.json", "settings.download.downloading": "下载中…", "settings.download.ok": "默认清单已下载（当前配置不变）", "settings.download.failed": "下载失败：{err}",
  "settings.diagnose": "检查条目可达性", "settings.diagnose.running": "诊断中…", "settings.diagnose.failed": "诊断失败：{err}",
  "settings.diagnose.result": "探测 {checked} 项 · 通过 {passed} · 失败 {failed}{trunc}",
  "settings.diagnose.truncated": "（仅显示前 100 条问题）",
  "settings.diagnose.none": "未发现问题",
  "settings.trust.hint": "⚠️ 自定义收录清单未经官方 CI 校验，条目来源请确认可信后再安装。",
  "settings.cache.hint": "切换后旧自定义源缓存将被清理（默认缓存保留）；自定义源失败时保留其最近一次成功缓存。",
  "settings.warnings": "维护提示",
  "notice.default": "官方默认收录清单 · 共 {count} 条", "notice.custom": "自定义收录清单 · 共 {count} 条",
  "notice.stale": "来源为本地缓存（共 {count} 条），可用「强制刷新」更新", "notice.unavailable": "收录清单不可用 · 请到设置页检查地址",
  "market.page.prev": "上一页", "market.page.next": "下一页", "market.page.info": "第 {page} / {pages} 页 · 共 {total} 条",
  "market.perf": "收录超过 200 条：仅查询当前页的最新版本（每页 50 条），如需全部请用搜索/分类过滤",
  "notice.toolview.err": "收录清单暂不可用",
  "self.upgraded": "dsh-m 已更新到 v{v}，重启后生效", "self.failed": "自更新失败：{err}",
  "registry.refreshed": "收录清单已强制刷新",
  "notify.installed": "已安装 {pkg}{version}", "notify.allowbuilds": "（注意：该插件执行了构建脚本，已按策略放行）",
  "notify.uninstalled": "已卸载 {pkg}", "notify.livedisabled": "（已先下线运行中的界面）",
  "notify.leftovers": "；检测到疑似残留数据：{paths}",
  "notify.upgraded": "已升级 {pkg}（{from} → {to}）", "notify.upgradehint": "（注意：该插件执行了构建脚本）",
  "failed.install": "安装失败：{err}", "failed.uninstall": "卸载失败：{err}", "failed.upgrade": "升级失败：{err}", "failed.selfupdate": "自更新失败：{err}",
  "failed.load": "加载失败：{err}", "failed.read": "读取失败：{err}", "failed.open": "打开市场面板失败:",
  "banner.done": "变更完成，需要重启 DSH Web 后生效。",
  "restart.doing": "正在请求重启…", "restart.waiting": "已请求重启，等待 DSH Web 恢复…",
  "restart.now": "⚡ 一键重启", "restart.failed": "重启失败：{err}",
  "restart.timeout": "重启超时，请手动检查 dsh web 服务状态",
  "restart.hint.done": "已请求重启 DSH web（via {via}）。服务几秒内恢复，之后让用户刷新页面即可。",
  "phase.resolving": "解析依赖", "phase.downloading": "下载", "phase.linking": "链接安装", "phase.building": "构建脚本", "phase.ready": "准备中",
  "readme.show": "📖 README", "readme.hide": "收起 README", "readme.loading": "加载 README… ", "readme.none": "（该插件没有 README）",
  "readme.truncated": "…（超过 64KB 已截断，完整内容见插件目录）",
  "warn.unlink": "卸载只移除 profile 对本地目录的引用（{path}），不会删除目录本身。",
  "warn.core": "这是 file: 安装的核心/归档包，卸载可能影响 DSH 功能，且需要手动恢复。",
  "profile.hint": "web profile：{path}",
  "title.panel": "插件市场", "title.full": "DeepSeek Harness 插件市场",
};
const EN = {
  "market.title": "Plugin Marketplace", "title.panel": "Plugin Marketplace", "title.full": "DeepSeek Harness Plugin Marketplace",
  "tab.market": "Market", "tab.installed": "Installed", "tab.settings": "Settings",
  "cat.all": "All", "cat.market": "Market", "cat.tools": "Tools", "cat.ui": "UI", "cat.search": "Search", "cat.media": "Media", "cat.other": "Other",
  "search.ph": "Search name, description, tags…",
  "common.refresh": "Refresh", "common.close": "Close", "common.later": "Later", "common.ok": "OK", "common.none": "—",
  "market.loading": "Loading listings… ", "market.empty": "No matching listings",
  "installed.loading": "Reading web profile… ", "installed.empty": "No DSH plugins installed in this web profile", "installed.none": "Not installed",
  "installed.others": "{n} non-DSH dependencies (not recognized as plugins) are collapsed.",
  "badge.installed": "Installed", "badge.update": "Update", "badge.market": "Via market", "badge.nonmarket": "Non-market",
  "action.install": "Install", "action.upgrade": "Upgrade", "action.uninstall": "Uninstall",
  "confirm.uninstall": "Confirm uninstall?", "confirm.unlink": "Confirm remove link?", "confirm.core": "⚠️ Remove core package?",
  "detail.id": "Listing id", "detail.source": "Source", "detail.latest": "Latest", "detail.installed": "Installed", "detail.tags": "Tags",
  "detail.pkg": "Package", "detail.spec": "Spec", "detail.listed": "Listed", "detail.listed.no": "Not in the registry", "detail.path": "Path", "detail.note": "Note", "detail.links": "Details",
  "link.home": "Homepage",
  "manage.hint": "Installed — manage it on the Installed tab",
  "version.failed": "version lookup failed",
  "src.npm": "npm", "src.github": "github", "src.link": "local link", "src.file": "local file", "src.unknown": "unknown",
  "sub.latest": "Latest v{v}", "sub.head": "HEAD {sha}", "sub.installed": "Installed v{v}",
  "settings.registry": "Registry", "settings.source": "Source", "settings.updated": "Updated",
  "settings.count": "Listings", "settings.count.v": "{n} listings", "settings.policy": "Caching",
  "settings.policy.v": "60 min TTL; override via registryUrl", "settings.remotehint": "Remote notice",
  "settings.force": "Force refresh", "settings.self": "dsh-m itself", "settings.current": "Current version",
  "settings.npmlatest": "npm latest", "settings.lookupfailed": "lookup failed: {err}", "settings.upgradeself": "Upgrade dsh-m",
  "settings.upgradehint": "A restart is required after upgrading", "settings.about": "About",
  "settings.about.text": "DSH Marketplace (dsh-m) — a personal DSH plugin marketplace with a customizable registry: browse, install, uninstall and upgrade, all local. Uses the official registry by default; download a copy, edit it and apply to override — live effect. Also ships 7 dshm_* agent tools and the dshm CLI.",
  "src.override": "Custom source", "src.jsdelivr": "jsDelivr (@main)", "src.raw": "raw.githubusercontent (@main)", "src.cache": "Local cache", "src.bundled": "Bundled snapshot (fallback)",
  "src.default.raw": "raw.githubusercontent (@main)", "src.default.jsdelivr": "jsDelivr (@main)", "src.default.cache": "Default registry cache",
  "src.custom.url": "Custom URL source", "src.custom.file": "Local file source", "src.custom.cache": "Custom source (cache)", "src.custom.unavailable": "Custom source (unavailable)",
  "settings.address": "Registry address", "settings.address.hint": "Empty = official default registry; accepts an HTTPS URL or a local absolute path / file://. Replaces (not merges) the default registry. Live effect.",
  "settings.configured": "Configured address", "settings.activecfg": "Active config", "settings.effective": "Effective source",
  "settings.status.label": "Config status", "settings.status.loading": "Loading", "settings.status.ready": "Applied", "settings.status.pending": "Pending write (validated)", "settings.status.rejected": "Rejected (previous config kept)", "settings.status.unavailable": "Unavailable",
  "settings.apply": "Validate & apply", "settings.apply.applying": "Validating…", "settings.apply.ok": "Registry address applied (no restart needed)", "settings.apply.failed": "Apply failed: {err}",
  "settings.reset": "Restore default", "settings.reset.ok": "Restored to the default registry",
  "settings.download": "Download default registry.json", "settings.download.downloading": "Downloading…", "settings.download.ok": "Default registry downloaded (current config unchanged)", "settings.download.failed": "Download failed: {err}",
  "settings.diagnose": "Check entries reachability", "settings.diagnose.running": "Checking…", "settings.diagnose.failed": "Diagnose failed: {err}",
  "settings.diagnose.result": "Probes {checked} · passed {passed} · failed {failed}{trunc}",
  "settings.diagnose.truncated": " (showing first 100 issues)",
  "settings.diagnose.none": "No issues found",
  "settings.trust.hint": "⚠️ Custom registries are not validated by official CI. Only install entries from sources you trust.",
  "settings.cache.hint": "Old custom-source caches are cleaned after switching (the default cache is kept); a failed custom source keeps its last good cache.",
  "settings.warnings": "Maintenance notice",
  "notice.default": "Official default registry · {count} listings", "notice.custom": "Custom registry · {count} listings",
  "notice.stale": "Served from local cache ({count} listings) — force refresh to update", "notice.unavailable": "Registry unavailable · check the address in Settings",
  "market.page.prev": "Previous", "market.page.next": "Next", "market.page.info": "Page {page} / {pages} · {total} listings",
  "market.perf": "200+ listings: latest versions are queried for the current page only (50 per page); use search/category filters",
  "notice.toolview.err": "Registry temporarily unavailable",
  "self.upgraded": "dsh-m updated to v{v} — restart to take effect", "self.failed": "Self-update failed: {err}",
  "registry.refreshed": "Registry force-refreshed",
  "notify.installed": "Installed {pkg}{version}", "notify.allowbuilds": " (note: this plugin ran build scripts, allowed by policy)",
  "notify.uninstalled": "Uninstalled {pkg}", "notify.livedisabled": " (live UI disabled first)",
  "notify.leftovers": "; possible leftover data: {paths}",
  "notify.upgraded": "Upgraded {pkg} ({from} → {to})", "notify.upgradehint": " (note: this plugin ran build scripts)",
  "failed.install": "Install failed: {err}", "failed.uninstall": "Uninstall failed: {err}", "failed.upgrade": "Upgrade failed: {err}", "failed.selfupdate": "Self-update failed: {err}",
  "failed.load": "Load failed: {err}", "failed.read": "Read failed: {err}", "failed.open": "Failed to open the marketplace panel:",
  "banner.done": "Changes applied. Restart DSH Web to take effect.",
  "restart.doing": "Requesting restart…", "restart.waiting": "Restart requested, waiting for DSH Web…",
  "restart.now": "⚡ Restart", "restart.failed": "Restart failed: {err}",
  "restart.timeout": "Restart timed out — check the dsh web service manually",
  "restart.hint.done": "Restart requested (via {via}). The service will be back in seconds; ask the user to refresh afterwards.",
  "phase.resolving": "Resolving", "phase.downloading": "Downloading", "phase.linking": "Linking", "phase.building": "Building", "phase.ready": "Preparing",
  "readme.show": "📖 README", "readme.hide": "Hide README", "readme.loading": "Loading README… ", "readme.none": "(No README)",
  "readme.truncated": "…(truncated at 64KB — see the plugin directory for full content)",
  "warn.unlink": "Uninstalling only removes the profile's reference to the local directory ({path}); the directory itself is kept.",
  "warn.core": "This is a core/archive package installed via file:. Uninstalling may affect DSH features and requires manual restore.",
  "profile.hint": "web profile: {path}",
  "title.panel": "Plugin Marketplace", "title.full": "DeepSeek Harness Plugin Marketplace",
};
function browserLang() {
  const lang = (typeof document !== "undefined" && document.documentElement.lang)
    || (typeof navigator !== "undefined" && navigator.language)
    || "zh";
  return /^en\b/i.test(String(lang)) ? "en" : "zh";
}
function interpolate(tpl, params) {
  if (!params) return String(tpl)
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`))
}
function lookup(key, params) {
  const dict = browserLang() === "en" ? EN : ZH;
  return interpolate(dict[key] ?? ZH[key] ?? key, params);
}

const CATEGORIES = ["market", "tools", "ui", "search", "media", "other"];

// ---------- 样式（跟随 DSH Web 主题变量，深浅色自适应） ----------
const CSS = `
.dshm-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-mask-3,rgba(15,23,42,.48));display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box}
.dshm-panel{width:min(920px,100%);height:min(680px,86vh);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-3,#fff));border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:14px;box-shadow:0 18px 48px rgba(2,6,23,.25);overflow:hidden;font-family:inherit;color:var(--dsw-alias-label-primary,inherit)}
.dshm-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.dshm-title{font-weight:700;font-size:15px;margin-right:6px}
.dshm-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2,#e2e4e8);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#f5f6f8)}
.dshm-seg button{appearance:none;border:0;background:transparent;height:28px;padding:0 14px;border-radius:7px;font:inherit;font-size:12px;color:var(--dsw-alias-label-tertiary,#7b8088);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background .15s,color .15s,box-shadow .15s}
.dshm-seg button:hover{color:var(--dsw-alias-label-secondary,#4b5058)}
.dshm-seg button.on{background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#17191c);font-weight:600;box-shadow:var(--dsw-shadow-lv1,0 2px 8px rgb(20 24 32 / 8%))}
.dshm-seg .dshm-count{font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption,#9ca3af);margin:0}
.dshm-seg button.on .dshm-count{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dshm-spacer{flex:1}
.dshm-body{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px}
.dshm-hint{color:var(--dsw-alias-label-caption,#6b7280);font-size:12px;line-height:18px;margin:0}
.dshm-err{color:var(--dsw-alias-state-error-primary,#b91c1c);font-size:12px;line-height:18px}
.dshm-btn{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,inherit);border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dshm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dshm-btn:disabled{opacity:.5;cursor:default}
.dshm-btn.primary{background:var(--dsw-alias-interactive-bg-selected,#4f46e5);border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5);color:#fff}
.dshm-btn.primary:hover{filter:brightness(1.08)}
.dshm-btn.danger{color:var(--dsw-alias-state-error-primary,#b91c1c);border-color:var(--dsw-alias-state-error-primary,#b91c1c)}
.dshm-btn.sm{padding:3px 9px;font-size:11px}
.dshm-input{flex:1;min-width:120px;border:1px solid var(--dsw-alias-border-l2,#c7d2fe);background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary,inherit);border-radius:8px;padding:6px 10px;font:inherit;font-size:13px;outline:none}
.dshm-input:focus{border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5)}
.dshm-chips{display:flex;flex-wrap:wrap;gap:6px}
.dshm-chip{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);border-radius:999px;padding:2px 10px;font:inherit;font-size:11px;cursor:pointer}
.dshm-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dshm-chip.on{background:var(--dsw-specific-sidebar-nav-item-active,rgba(38,49,72,.08));border-color:transparent;color:var(--dsw-alias-label-primary,inherit);font-weight:500}
.dshm-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@media (max-width:680px){.dshm-cards{grid-template-columns:1fr}}
.dshm-card{display:flex;gap:12px;align-items:flex-start;background:var(--dsw-alias-bg-layer-2,rgba(38,49,72,.04));border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:12px;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;min-width:0;font:inherit;color:var(--dsw-alias-label-primary,inherit);transition:border-color .16s,background .16s}
.dshm-card:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));border-color:var(--dsw-alias-label-dimmed,#c7d2fe)}
.dshm-icon{width:40px;height:40px;border-radius:10px;object-fit:cover;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);flex-shrink:0;background:linear-gradient(135deg,#c7d2fe,#fbcfe8);display:grid;place-items:center;font-weight:700;font-size:16px;color:#374151}
.dshm-meta{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.dshm-top{display:flex;align-items:center;gap:8px;min-width:0}
.dshm-name{flex:1;min-width:0;font-weight:600;font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshm-badge{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-state-success-tertiary,#ecfdf5);color:var(--dsw-alias-state-success-primary,#047857)}
.dshm-badge.warn{background:var(--dsw-alias-state-warn-tertiary,#fffbeb);color:var(--dsw-alias-state-warn-primary,#b45309)}
.dshm-badge.info{background:var(--dsw-alias-state-business-tertiary,#eef2ff);color:var(--dsw-alias-state-business-primary,#4338ca)}
.dshm-badge.err{background:var(--dsw-alias-state-error-secondary,#fee2e2);color:var(--dsw-alias-state-error-primary,#b91c1c)}
.dshm-desc{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dshm-sub{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-caption,#6b7280)}
.dshm-detail{margin-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,#e5e7eb);padding-top:8px;display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563)}
.dshm-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.dshm-banner{display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-state-warn-tertiary,#fffbeb);color:var(--dsw-alias-state-warn-primary,#b45309);font-size:12px}
.dshm-banner .dshm-banner-text{flex:1}
.dshm-row{display:flex;align-items:center;gap:8px}
.dshm-kv{display:grid;grid-template-columns:110px 1fr;gap:4px 10px;font-size:12px}
.dshm-kv .k{color:var(--dsw-alias-label-caption,#6b7280)}
.dshm-spin{display:inline-block;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2,#c7d2fe);border-top-color:var(--dsw-alias-interactive-bg-selected,#4f46e5);border-radius:50%;animation:dshm-rot .8s linear infinite;vertical-align:-2px}
@keyframes dshm-rot{to{transform:rotate(360deg)}}
.dshm-others{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px dashed var(--dsw-alias-border-l2,#e2e4e8);border-radius:10px;color:var(--dsw-alias-label-caption,#9ca3af);font-size:12px;line-height:18px}
.dshm-readme{max-height:280px;overflow:auto;background:var(--dsw-alias-bg-layer-2,rgba(38,49,72,.04));border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;padding:10px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#4b5563);margin:0}
.dshm-readme.md{font-family:inherit;white-space:normal;word-break:break-word}
.dshm-readme.md h1,.dshm-readme.md h2,.dshm-readme.md h3,.dshm-readme.md h4,.dshm-readme.md h5,.dshm-readme.md h6{margin:8px 0 4px;font-weight:700;line-height:1.4;color:var(--dsw-alias-label-primary,inherit)}
.dshm-readme.md h1{font-size:15px}.dshm-readme.md h2{font-size:14px}.dshm-readme.md h3{font-size:13px}.dshm-readme.md h4,.dshm-readme.md h5,.dshm-readme.md h6{font-size:12px}
.dshm-readme.md>:first-child{margin-top:0}
.dshm-readme.md p{margin:4px 0}
.dshm-readme.md a{color:var(--dsw-alias-state-business-primary,#4d6bfe);text-decoration:none}
.dshm-readme.md a:hover{text-decoration:underline}
.dshm-readme.md code{background:rgba(127,127,127,.16);border-radius:4px;padding:1px 4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.dshm-readme.md pre{background:rgba(127,127,127,.12);border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:8px;padding:8px 10px;overflow:auto;margin:6px 0}
.dshm-readme.md pre code{background:transparent;padding:0;font-size:11px;line-height:16px}
.dshm-readme.md img{max-height:20px;max-width:100%;vertical-align:middle}
.dshm-readme.md ul,.dshm-readme.md ol{margin:4px 0;padding-left:20px}
.dshm-readme.md li{margin:2px 0}
.dshm-readme.md blockquote{margin:6px 0;padding:2px 10px;border-left:3px solid var(--dsw-alias-border-l2,#cbd5e1);color:var(--dsw-alias-label-caption,#6b7280)}
.dshm-readme.md table{border-collapse:collapse;margin:6px 0;font-size:11px}
.dshm-readme.md th,.dshm-readme.md td{border:1px solid var(--dsw-alias-border-l2,#cbd5e1);padding:3px 8px;text-align:left}
.dshm-readme.md th{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1))}
.dshm-readme.md hr{border:0;border-top:1px solid var(--dsw-alias-border-l2,#cbd5e1);margin:8px 0}
.dshm-readme.md .dshm-md-note{margin-top:8px;padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l2,#cbd5e1);color:var(--dsw-alias-label-caption,#9ca3af);font-size:11px}
.dshm-links{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:7px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb);font-size:11px;color:var(--dsw-alias-label-caption,#6b7280)}
.dshm-links-k,.dshm-links-sep{color:var(--dsw-alias-label-caption,#9ca3af)}
.dshm-links a{color:var(--dsw-alias-state-business-primary,#4d6bfe);text-decoration:none;font-weight:500}
.dshm-links a:hover{text-decoration:underline}
.dshm-prog{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563)}
.dshm-prog .bar{flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2,rgba(38,49,72,.08));overflow:hidden;min-width:80px}
.dshm-prog .bar i{display:block;height:100%;background:var(--dsw-alias-interactive-bg-selected,#4f46e5);transition:width .3s}
.dshm-entry{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:4px -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden}
.dshm-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dshm-entry svg{flex:none;width:16px;height:16px}
.dshm-entry span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-slot="sidebar.footer.action"]{display:flex!important;flex-direction:column;width:100%;min-width:0}
[data-slot="sidebar.footer.action"]>*{flex:none;min-width:0}
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
async function api(method, params, signal) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, ...(params || {}) }),
    ...(signal ? { signal } : {}),
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

// ---------- 市场数据唯一 owner（服务端分页 + generation/abort） ----------
function useMarketData() {
  const [query, setQuery] = useState(() => normalizeMarketQuery({}));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const genRef = useRef(0);
  const abortRef = useRef(null);
  const queryRef = useRef(query);

  const fetchPage = useCallback((nextQuery, force) => {
    const gen = ++genRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    const params = {
      query: nextQuery.query || undefined,
      category: nextQuery.category || undefined,
      offset: nextQuery.offset,
      limit: nextQuery.limit,
      ...(force ? { force: true } : {}),
    };
    return api("market", params, ac.signal)
      .then((raw) => {
        if (genRef.current !== gen || ac.signal.aborted) return;
        setData(normalizeMarketResponse(raw));
        setLoading(false);
      })
      .catch((e) => {
        if (genRef.current !== gen || ac.signal.aborted) return;
        setError(String((e && e.message) || e));
        setLoading(false);
      });
  }, []);

  const updateQuery = useCallback((patch, opts = {}) => {
    const next = resetPageOnFilterChange(queryRef.current, normalizeMarketQuery({ ...queryRef.current, ...patch }));
    queryRef.current = next;
    setQuery(next);
    if (opts.fetch !== false) fetchPage(next, opts.force);
  }, [fetchPage]);

  const reload = useCallback((force) => fetchPage(queryRef.current, force), [fetchPage]);

  useEffect(() => {
    fetchPage(queryRef.current, false);
    return () => abortRef.current?.abort();
  }, [fetchPage]);

  return { query, data, loading, error, reload, updateQuery };
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

// ---------- 极简 Markdown 渲染（零依赖，输出 React 元素；文本经 React 天然转义，链接只放行安全协议） ----------
function safeUrl(u) {
  const t = String(u || "").trim();
  if (/^(https?:\/\/|mailto:)/i.test(t)) return t;
  if (/^[/#]/.test(t)) return t;
  return "#";
}

// 外链统一 target/rel，且阻止冒泡（卡片点击会折叠详情）
function ExtLink({ href, className, children }) {
  return h(
    "a",
    {
      className: className || "dshm-md-a",
      href: safeUrl(href),
      target: "_blank",
      rel: "noopener noreferrer",
      onClick: (e) => e.stopPropagation(),
    },
    children,
  );
}

function MdImg({ src, alt }) {
  return h("img", {
    className: "dshm-md-img",
    src: safeUrl(src),
    alt: alt || "",
    referrerPolicy: "no-referrer",
    onError: (e) => {
      e.currentTarget.style.display = "none";
    },
  });
}

// 行内语法（按优先级）：徽章链接 [![a](i)](l) · 图片 · 链接 · `code` · **粗体** · ~~删除~~ · *斜体* · <autolink> · 裸 URL
function mdInline(text, kb) {
  const re = /(\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\))|(!\[[^\]]*\]\([^)]*\))|(\[[^\]]*\]\([^)]*\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*\s][^*]*\*)|(<https?:\/\/[^>\s]+>)|(https?:\/\/[^\s<>()\[\]{}"'「」【】]+[^\s<>()\[\]{}"'「」【】.,;:!?…，。；：！？）】」"')])/g;
  const src = String(text);
  const nodes = [];
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) nodes.push(src.slice(last, m.index));
    const tok = m[0];
    const k = `${kb}-${i++}`;
    if (tok.startsWith("[![")) {
      // [![徽章](img)](link)：badge 常见嵌套，图在链内
      const im = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(tok.slice(1));
      const lm = /\]\(([^)]*)\)\s*$/.exec(tok);
      const img = h(MdImg, { src: im && im[2], alt: im && im[1] });
      const href = lm && lm[1];
      nodes.push(href && safeUrl(href) !== "#" ? h(ExtLink, { key: k, href }, img) : h("span", { key: k }, img));
    } else if (tok.startsWith("![") || tok.startsWith("<![")) {
      const im = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(tok);
      nodes.push(h(MdImg, { key: k, src: im && im[2], alt: im && im[1] }));
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(tok);
      nodes.push(h(ExtLink, { key: k, href: lm && lm[2] }, mdInline(lm ? lm[1] : tok, k)));
    } else if (tok.startsWith("`")) {
      nodes.push(h("code", { key: k }, tok.slice(1, -1)));
    } else if (tok.startsWith("**")) {
      nodes.push(h("strong", { key: k }, mdInline(tok.slice(2, -2), k)));
    } else if (tok.startsWith("~~")) {
      nodes.push(h("del", { key: k }, mdInline(tok.slice(2, -2), k)));
    } else if (tok.startsWith("*")) {
      nodes.push(h("em", { key: k }, mdInline(tok.slice(1, -1), k)));
    } else if (tok.startsWith("<")) {
      const u = tok.slice(1, -1);
      nodes.push(h(ExtLink, { key: k, href: u }, u));
    } else {
      nodes.push(h(ExtLink, { key: k, href: tok }, tok.length > 72 ? `${tok.slice(0, 69)}…` : tok));
    }
    last = m.index + tok.length;
  }
  if (last < src.length) nodes.push(src.slice(last));
  return nodes;
}

// 块级语法：围栏代码 · ATX 标题 · 分隔线 · 引用 · 无序/有序列表 · GFM 表格 · 段落
function mdBlocks(lines, kb) {
  const out = [];
  let i = 0;
  let n = 0;
  const isFence = (s) => /^\s*```/.test(s);
  const isHeading = (s) => /^#{1,6}\s+/.test(s);
  const isHr = (s) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(s);
  const isQuote = (s) => /^\s*>/.test(s);
  const isUl = (s) => /^\s*[-*+]\s+/.test(s);
  const isOl = (s) => /^\s*\d+[.)]\s+/.test(s);
  const isTableRow = (s) => s.includes("|") && /^\s*\|/.test(s);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const k = `${kb}-b${n++}`;
    if (isFence(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++; // 闭合 ```（缺失则到尾部）
      out.push(h("pre", { key: k }, h("code", null, buf.join("\n"))));
      continue;
    }
    if (isHeading(line)) {
      const hm = /^(#{1,6})\s+(.*)$/.exec(line);
      out.push(h(`h${hm[1].length}`, { key: k }, mdInline(hm[2], k)));
      i++;
      continue;
    }
    if (isHr(line)) {
      out.push(h("hr", { key: k }));
      i++;
      continue;
    }
    if (isQuote(line)) {
      const buf = [];
      while (i < lines.length && isQuote(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(h("blockquote", { key: k }, mdBlocks(buf, k)));
      continue;
    }
    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line);
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items = [];
      while (i < lines.length && (ordered ? isOl(lines[i]) : isUl(lines[i]))) {
        items.push(h("li", { key: `li${items.length}` }, mdInline(re.exec(lines[i])[1], `${k}-${items.length}`)));
        i++;
      }
      out.push(h(ordered ? "ol" : "ul", { key: k }, items));
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && lines[i + 1].includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const cells = (s) => s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const head = cells(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(cells(lines[i]));
        i++;
      }
      out.push(
        h("table", { key: k },
          h("thead", null, h("tr", null, head.map((c, x) => h("th", { key: x }, mdInline(c, `${k}h${x}`))))),
          h("tbody", null, rows.map((r, y) => h("tr", { key: y }, r.map((c, x) => h("td", { key: x }, mdInline(c, `${k}${y}x${x}`)))))),
        ),
      );
      continue;
    }
    // 段落：收集到空行或下一个块结构为止
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isFence(lines[i]) && !isHeading(lines[i]) && !isHr(lines[i]) && !isQuote(lines[i]) && !isUl(lines[i]) && !isOl(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(h("p", { key: k }, mdInline(buf.join(" "), k)));
  }
  return out;
}

function renderMarkdown(src) {
  return mdBlocks(String(src || "").replace(/\r\n?/g, "\n").split("\n"), "md");
}

// ---------- 「详情」官方外链（GitHub / npm / homepage） ----------
function officialLinks({ npm, github, homepage }) {
  const links = [];
  if (github) links.push(["GitHub", `https://github.com/${github}`]);
  if (npm) links.push(["npm", `https://www.npmjs.com/package/${npm}`]);
  if (!links.length && homepage) links.push([lookup("link.home"), homepage]);
  return links;
}

function LinksRow(props) {
  const links = officialLinks(props);
  if (!links.length) return null;
  const kids = [];
  links.forEach(([label, href], idx) => {
    if (idx) kids.push(h("span", { key: `sep${idx}`, className: "dshm-links-sep" }, "·"));
    kids.push(h(ExtLink, { key: label, href }, label));
  });
  return h("div", { className: "dshm-links" }, h("span", { className: "dshm-links-k" }, `${lookup("detail.links")}：`), ...kids);
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
        if (Date.now() > deadline) throw new Error(lookup("restart.timeout"));
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
      phase === "restarting" ? lookup("restart.doing") :
      phase === "waiting" ? lookup("restart.waiting") :
      err ? lookup("restart.failed", { err }) :
      note || lookup("banner.done")),
    phase === "idle" && !err ? h("button", { className: "dshm-btn primary sm", onClick: restart }, lookup("restart.now")) : null,
    phase === "restarting" || phase === "waiting" ? Spin() : null,
    phase === "idle" && err ? h("button", { className: "dshm-btn sm", onClick: () => onDone(false) }, lookup("common.ok")) : null,
    phase === "idle" && !err ? h("button", { className: "dshm-btn sm", onClick: () => onDone(false) }, lookup("common.later")) : null,
  );
}

// ---------- 市场页（数据由 MarketPanel 唯一持有，本组件只消费 props） ----------
function MarketTab({ notify, market }) {
  const { data, loading, error, reload, query, updateQuery } = market;
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [qInput, setQInput] = useState(query.query);
  const debounceRef = useRef(null);

  // 服务端分页数据
  const items = (data && data.items) || [];
  const total = (data && data.total) || 0;
  const limit = (data && data.limit) || MARKET_PAGE_SIZE;
  const offset = (data && data.offset) || 0;
  const page = total > 0 ? Math.floor(offset / limit) + 1 : 1;
  const pages = total > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  const counts = (data && data.categoryCounts) || {};
  const notice = data ? registryNotice(data.registryState, total) : null;

  const onSearchInput = (value) => {
    setQInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateQuery({ query: value }), 300);
  };

  const doInstall = async (it, version) => {
    setBusyId(it.id);
    try {
      const res = await api("install", { id: it.id, ...(version ? { version } : {}) });
      notify({
        kind: "ok",
        needsRestart: true,
        text: lookup("notify.installed", { pkg: res.pkg, version: res.version ? ` v${res.version}` : "" }) +
          (res.usedAllowAllBuilds ? lookup("notify.allowbuilds") : ""),
      });
      await reload(false);
    } catch (e) {
      notify({ kind: "err", text: lookup("failed.install", { err: (e && e.message) || e }) });
    } finally {
      setBusyId(null);
    }
  };

  return h(
    React.Fragment,
    null,
    notice
      ? h("div", { className: notice.key === "notice.unavailable" ? "dshm-err" : "dshm-hint" },
          lookup(notice.key, { count: notice.count }))
      : null,
    total > 200 ? h("div", { className: "dshm-hint" }, lookup("market.perf")) : null,
    h(
      "div",
      { className: "dshm-row" },
      h("input", {
        className: "dshm-input",
        placeholder: lookup("search.ph"),
        value: qInput,
        onChange: (e) => onSearchInput(e.target.value),
      }),
      h("button", { className: "dshm-btn", onClick: () => reload(true), title: lookup("settings.policy.v") }, loading ? Spin() : `↻ ${lookup("common.refresh")}`),
    ),
    h(
      "div",
      { className: "dshm-chips" },
      h("button", { className: `dshm-chip${query.category === null ? " on" : ""}`, onClick: () => updateQuery({ category: null, offset: 0 }) }, lookup("cat.all")),
      CATEGORIES.map((key) => {
        const n = typeof counts[key] === "number" ? counts[key] : 0;
        return h(
          "button",
          { key, className: `dshm-chip${query.category === key ? " on" : ""}`, onClick: () => updateQuery({ category: query.category === key ? null : key, offset: 0 }) },
          `${lookup("cat." + key)}${n ? ` ${n}` : ""}`,
        );
      }),
    ),
    busyId ? h(ProgressLine, { key: "prog" }) : null,
    loading && !data
      ? h("div", { className: "dshm-empty" }, lookup("market.loading"), Spin())
      : error
        ? h("div", { className: "dshm-err" }, lookup("failed.load", { err: error }))
        : items.length === 0
          ? h("div", { className: "dshm-empty" }, lookup("market.empty"))
          : h(
              React.Fragment,
              null,
              h(
                "div",
                { className: "dshm-cards" },
                items.map((it) => Card({
                  key: it.id,
                  icon: h(Icon, { entry: it }),
                  name: it.name,
                  badges: [
                    it.outdated ? h("span", { className: "dshm-badge warn", key: "u" }, lookup("badge.update")) : null,
                    it.installed ? h("span", { className: "dshm-badge", key: "i" }, lookup("badge.installed")) : null,
                    h("span", { className: "dshm-badge info", key: "s" }, it.source === "npm" ? "npm" : "github"),
                  ],
                  desc: it.description,
                  sub: [
                    it.latestVersion ? lookup("sub.latest", { v: it.latestVersion }) : it.latestTag ? it.latestTag : it.latestSha ? lookup("sub.head", { sha: it.latestSha.slice(0, 7) }) : null,
                    it.installedVersion ? lookup("sub.installed", { v: it.installedVersion }) : null,
                    it.latestError ? lookup("version.failed") : null,
                  ].filter(Boolean).join(" · "),
                  links: h(LinksRow, { npm: it.npm, github: it.github, homepage: it.homepage }),
                  open: openId === it.id,
                  onToggle: () => setOpenId(openId === it.id ? null : it.id),
                  detail: DetailRows([
                    [lookup("detail.id"), it.id],
                    [lookup("detail.source"), it.source === "npm"
                      ? h(ExtLink, { href: `https://www.npmjs.com/package/${it.npm}` }, `npm · ${it.npm}`)
                      : h(ExtLink, { href: `https://github.com/${it.github}` }, `GitHub · ${it.github}`)],
                    [lookup("detail.latest"), it.latestVersion ? `v${it.latestVersion}` : it.latestTag ? it.latestTag : it.latestSha ? it.latestSha : it.latestError || "—"],
                    [lookup("detail.installed"), it.installedPkg ? `${it.installedPkg} v${it.installedVersion || "?"}` : lookup("installed.none")],
                    [lookup("detail.tags"), (it.tags || []).join(", ") || "—"],
                    it.latestError ? [lookup("version.failed"), it.latestError] : null,
                  ]),
                  actions: [
                    it.installed
                      ? h("span", { className: "dshm-hint", key: "hint" }, lookup("manage.hint"))
                      : h("button", {
                          key: "install",
                          className: "dshm-btn primary sm",
                          disabled: busyId === it.id,
                          onClick: (e) => {
                            e.stopPropagation();
                            doInstall(it);
                          },
                        },
                        busyId === it.id ? h(Spin) : lookup("action.install")),
                  ],
                })),
              ),
              pages > 1
                ? h("div", { className: "dshm-row", style: { justifyContent: "center", marginTop: "4px" } },
                    h("button", {
                      className: "dshm-btn sm",
                      disabled: page <= 1 || loading,
                      onClick: () => updateQuery({ offset: Math.max(0, offset - limit) }),
                    }, lookup("market.page.prev")),
                    h("span", { className: "dshm-hint" }, lookup("market.page.info", { page, pages, total })),
                    h("button", {
                      className: "dshm-btn sm",
                      disabled: page >= pages || loading,
                      onClick: () => updateQuery({ offset: Math.min(total - 1, offset + limit) }),
                    }, lookup("market.page.next")),
                  )
                : null,
            ),
  );
}

// ---------- 安装进度（轮询 host status 端点，pnpm ndjson） ----------
const PHASE_LABEL = { resolving: "phase.resolving", downloading: "phase.downloading", linking: "phase.linking", building: "phase.building" };

function ProgressLine() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const d = await api("status");
        if (live) setSt(d);
      } catch {
        /* 瞬时失败忽略 */
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, []);
  if (!st) return null;
  const pct = st.total ? Math.min(100, Math.round((st.done / st.total) * 100)) : null;
  const phaseLabel = lookup(PHASE_LABEL[st.phase] || "phase.ready");
  return h(
    "div",
    { className: "dshm-prog" },
    Spin(),
    h("span", null, `${st.target} · ${phaseLabel}${st.done ? ` ${st.done}${st.total ? "/" + st.total : ""}` : ""}`),
    pct !== null ? h("span", { className: "bar" }, h("i", { style: { width: pct + "%" } })) : null,
    st.currentPackage ? h("span", { className: "dshm-hint" }, String(st.currentPackage).slice(0, 44)) : null,
  );
}

// ---------- README 预览 ----------
function ReadmeBlock({ pkg }) {
  const [state, setState] = useState({ loading: true, text: "", err: "", truncated: false });
  useEffect(() => {
    let live = true;
    api("readme", { pkg })
      .then((d) => live && setState({ loading: false, text: d.readme, err: "", truncated: d.truncated }))
      .catch((e) => live && setState({ loading: false, text: "", err: String((e && e.message) || e) }));
    return () => {
      live = false;
    };
  }, [pkg]);
  if (state.loading) return h("div", { className: "dshm-hint" }, lookup("readme.loading"), Spin());
  if (state.err) return h("div", { className: "dshm-err" }, state.err);
  if (!state.text) return h("div", { className: "dshm-hint" }, lookup("readme.none"));
  return h(
    "div",
    { className: "dshm-readme md", onClick: (e) => e.stopPropagation() },
    renderMarkdown(state.text),
    state.truncated ? h("div", { className: "dshm-md-note" }, lookup("readme.truncated")) : null,
  );
}

// ---------- 卸载护栏（方案 B：全放开 + 上下文警告） ----------
function uninstallGuard(it) {
  if (it.source === "link") {
    return {
      confirm: lookup("confirm.unlink"),
      warn: lookup("warn.unlink", { path: it.path }),
    };
  }
  if (it.source === "file") {
    return { confirm: lookup("confirm.core"), warn: lookup("warn.core") };
  }
  return { confirm: lookup("confirm.uninstall"), warn: null };
}

// ---------- 已装页 ----------
function InstalledTab({ notify, installed }) {
  const { loading, data, error, reload } = installed;
  const [openPkg, setOpenPkg] = useState(null);
  const [readmePkg, setReadmePkg] = useState(null);
  const [busyPkg, setBusyPkg] = useState(null);

  const doUninstall = async (it) => {
    setBusyPkg(it.pkg);
    try {
      const res = await api("uninstall", { pkg: it.pkg });
      notify({
        kind: "ok",
        needsRestart: true,
        text: lookup("notify.uninstalled", { pkg: res.pkg }) +
          (res.liveDisabled ? lookup("notify.livedisabled") : "") +
          (res.leftovers && res.leftovers.length ? lookup("notify.leftovers", { paths: res.leftovers.join(", ") }) : ""),
      });
      await reload();
    } catch (e) {
      notify({ kind: "err", text: lookup("failed.uninstall", { err: (e && e.message) || e }) });
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
        needsRestart: true,
        text: lookup("notify.upgraded", {
          pkg: res.pkg,
          from: res.fromVersion ? `v${res.fromVersion}` : "—",
          to: res.version ? `v${res.version}` : res.sha ? res.sha.slice(0, 7) : "latest",
        }) + (res.usedAllowAllBuilds ? lookup("notify.upgradehint") : ""),
      });
      await reload();
    } catch (e) {
      notify({ kind: "err", text: lookup("failed.upgrade", { err: (e && e.message) || e }) });
    } finally {
      setBusyPkg(null);
    }
  };

  if (loading && !data) return h("div", { className: "dshm-empty" }, lookup("installed.loading"), Spin());
  if (error) return h("div", { className: "dshm-err" }, lookup("failed.read", { err: error }));
  const items = (data && data.items) || [];
  if (!items.length) return h("div", { className: "dshm-empty" }, `${lookup("installed.empty")} (${data.profileDir})`);

  return h(
    React.Fragment,
    null,
    h("div", { className: "dshm-hint" }, lookup("profile.hint", { path: data.profileDir })),
    data.others > 0
      ? h("div", { className: "dshm-others" }, lookup("installed.others", { n: data.others }))
      : null,
    busyPkg ? h(ProgressLine, { key: "prog" }) : null,
    h(
      "div",
      { className: "dshm-cards" },
      items.map((it) => {
        const guard = uninstallGuard(it);
        return Card({
          key: it.pkg,
          icon: h(Icon, { entry: { name: it.name, github: it.registryGithub || it.githubRepo || (it.spec.startsWith("github:") ? it.spec.slice(7).split("#")[0] : null), icon: null } }),
          name: it.name,
          badges: [
            it.outdated ? h("span", { className: "dshm-badge warn", key: "u" }, `⬆ ${it.latestTag || (it.latestVersion ? `v${it.latestVersion}` : "")}`.trim()) : null,
            it.registryId ? h("span", { className: "dshm-badge", key: "r" }, lookup("badge.market")) : h("span", { className: "dshm-badge info", key: "r" }, lookup("badge.nonmarket")),
          ],
          desc: it.description || "（无描述）",
          sub: [
            `v${it.version || "?"}`,
            { npm: lookup("src.npm"), github: lookup("src.github"), link: lookup("src.link"), file: lookup("src.file"), unknown: lookup("src.unknown") }[it.source] || it.source,
          ].join(" · "),
          links: h(LinksRow, {
            npm: it.source === "npm" ? it.pkg : null,
            github: it.registryGithub || it.githubRepo || (it.spec.startsWith("github:") ? it.spec.slice(7).split("#")[0] : null),
          }),
          open: openPkg === it.pkg,
          onToggle: () => setOpenPkg(openPkg === it.pkg ? null : it.pkg),
          detail: readmePkg === it.pkg
            ? h(ReadmeBlock, { pkg: it.pkg })
            : DetailRows([
                [lookup("detail.pkg"), it.pkg],
                [lookup("detail.spec"), it.spec],
                [lookup("detail.latest"), it.latestTag || (it.latestVersion ? `v${it.latestVersion}` : "—")],
                [lookup("detail.listed"), it.registryId || lookup("detail.listed.no")],
                [lookup("detail.path"), it.path],
                guard.warn ? [lookup("detail.note"), guard.warn] : null,
              ]),
          actions: [
            h("button", {
              key: "rd",
              className: "dshm-btn sm",
              onClick: (e) => {
                e.stopPropagation();
                setReadmePkg(readmePkg === it.pkg ? null : it.pkg);
              },
            }, readmePkg === it.pkg ? lookup("readme.hide") : lookup("readme.show")),
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
                busyPkg === it.pkg ? h(Spin) : lookup("action.upgrade"))
              : null,
            h(TwoStepButton, {
              key: "un",
              label: lookup("action.uninstall"),
              confirmLabel: guard.confirm,
              className: "dshm-btn sm",
              disabled: busyPkg === it.pkg,
              onConfirm: () => doUninstall(it),
            }),
          ],
        });
      }),
    ),
  );
}

// ---------- 设置页 ----------
function regSourceLabel(data) {
  if (!data) return "—";
  const map = {
    "default-raw": "src.default.raw",
    "default-jsdelivr": "src.default.jsdelivr",
    "default-cache": "src.default.cache",
    bundled: "src.bundled",
    "custom-url": "src.custom.url",
    "custom-file": "src.custom.file",
    "custom-cache": "src.custom.cache",
    "custom-unavailable": "src.custom.unavailable",
    // 旧字段兼容
    override: "src.override", jsdelivr: "src.jsdelivr", raw: "src.raw", cache: "src.cache",
  };
  return lookup(map[data.source] || data.source);
}

function configStatusLabel(status) {
  return lookup(`settings.status.${status || "loading"}` || "settings.status.loading");
}

function SettingsTab({ notify, onRegistryChanged }) {
  const reg = useAsync((force) => api("registry", force ? { force: true } : {}), []);
  const cfgState = useAsync(() => api("registry-config"), []);
  const self = useAsync(() => api("self-check"), []);
  const [busy, setBusy] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [draftAddress, setDraftAddress] = useState(null); // null = 尚未从 configuredAddress 初始化
  const [applying, setApplying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [applyError, setApplyError] = useState(null);
  const [diagnosticResult, setDiagnosticResult] = useState(null);
  const diagnoseAbort = useRef(null);

  const cfgData = cfgState.data;
  useEffect(() => {
    if (draftAddress === null && cfgData) setDraftAddress(cfgData.registryUrl ?? "");
  }, [cfgData, draftAddress]);
  // 关闭/切换设置页时中止诊断请求
  useEffect(() => () => diagnoseAbort.current?.abort(), []);

  const refresh = async () => {
    setBusy(true);
    try {
      await reg.reload(true);
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
    try {
      await api("registry-config-apply", { registryUrl: raw });
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

  const runDiagnose = async () => {
    diagnoseAbort.current?.abort();
    const ac = new AbortController();
    diagnoseAbort.current = ac;
    setDiagnosing(true);
    setDiagnosticResult(null);
    try {
      const res = await api("registry-diagnose", {}, ac.signal);
      if (!ac.signal.aborted) setDiagnosticResult(res.check);
    } catch (e) {
      if (!ac.signal.aborted) notify({ kind: "err", text: lookup("settings.diagnose.failed", { err: (e && e.message) || e }) });
    } finally {
      if (!ac.signal.aborted) setDiagnosing(false);
    }
  };

  const snap = cfgData || {};
  const state = snap.registryState || (reg.data ? reg.data.registryState : null) || null;

  return h(
    React.Fragment,
    null,
    Section(lookup("settings.registry"),
      h("div", { className: "dshm-row", style: { flexDirection: "column", alignItems: "stretch", gap: "4px" } },
        h("div", { className: "dshm-hint" }, lookup("settings.address")),
        h("div", { className: "dshm-row" },
          h("input", {
            className: "dshm-input",
            placeholder: lookup("settings.address.hint"),
            value: draftAddress ?? "",
            onChange: (e) => setDraftAddress(e.target.value),
            spellcheck: "false",
          }),
        ),
        h("div", { className: "dshm-hint" }, lookup("settings.address.hint")),
      ),
      h("div", { className: "dshm-actions" },
        h("button", {
          className: "dshm-btn primary sm",
          disabled: applying || diagnosing || draftAddress === null,
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
          onClick: downloadDefault,
        }, downloading ? h("span", null, lookup("settings.download.downloading"), " ", h(Spin)) : lookup("settings.download")),
        h("button", {
          className: "dshm-btn sm",
          disabled: diagnosing || applying,
          onClick: runDiagnose,
        }, diagnosing ? h("span", null, lookup("settings.diagnose.running"), " ", h(Spin)) : lookup("settings.diagnose")),
        h("button", { className: "dshm-btn sm", disabled: busy || reg.loading, onClick: refresh }, busy || reg.loading ? h(Spin) : lookup("settings.force")),
      ),
      applyError ? h("div", { className: "dshm-err" }, lookup("settings.apply.failed", { err: applyError })) : null,
      h("div", { className: "dshm-kv", style: { marginTop: "4px" } },
        h("span", { className: "k" }, lookup("settings.configured")), h("span", { style: { wordBreak: "break-all" } }, snap.registryUrl === "" || snap.registryUrl ? `${snap.registryUrl === "" ? "（默认）" : snap.registryUrl}` : "—"),
        h("span", { className: "k" }, lookup("settings.activecfg")), h("span", { style: { wordBreak: "break-all" } }, snap.activeConfigAddress === "" || snap.activeConfigAddress ? `${snap.activeConfigAddress === "" ? "（默认）" : snap.activeConfigAddress}` : "—"),
        h("span", { className: "k" }, lookup("settings.status.label")), h("span", null, configStatusLabel(snap.configStatus)),
        h("span", { className: "k" }, lookup("settings.effective")), h("span", null, regSourceLabel(state)),
        h("span", { className: "k" }, lookup("settings.updated")), h("span", null, fmtDate(state && state.fetchedAt)),
        h("span", { className: "k" }, lookup("settings.count")), h("span", null, state ? lookup("settings.count.v", { n: state.count ?? 0 }) : "—"),
        h("span", { className: "k" }, lookup("settings.policy")), h("span", null, lookup("settings.policy.v")),
      ),
      state && state.stale && state.status !== "unavailable"
        ? h("div", { className: "dshm-hint" }, lookup("settings.cache.hint"))
        : null,
      state && !state.isDefault
        ? h("div", { className: "dshm-hint" }, lookup("settings.trust.hint"))
        : null,
      snap.warnings && snap.warnings.length
        ? h("div", { className: "dshm-hint" }, `${lookup("settings.warnings")}：${snap.warnings.join("；")}`)
        : null,
      state && state.errors && state.errors.length
        ? h("div", { className: "dshm-err" }, `${lookup("settings.remotehint")}：${state.errors.slice(0, 5).join("；")}`)
        : null,
      diagnosticResult
        ? h("div", { className: "dshm-hint", style: { wordBreak: "break-all" } },
            lookup("settings.diagnose.result", {
              checked: diagnosticResult.checked ?? 0,
              passed: diagnosticResult.passed ?? 0,
              failed: diagnosticResult.failed ?? 0,
              trunc: diagnosticResult.truncated ? lookup("settings.diagnose.truncated") : "",
            }),
            diagnosticResult.issues && diagnosticResult.issues.length
              ? h("div", { style: { marginTop: "4px" } },
                  diagnosticResult.issues.slice(0, 100).map((iss, i) =>
                    h("div", { key: i, className: "dshm-err" }, `· [${iss.id}] ${iss.field}: ${iss.message}`)),
                )
              : h("div", null, lookup("settings.diagnose.none")),
          )
        : null,
    ),
    Section(lookup("settings.self"),
      h("div", { className: "dshm-kv" },
        h("span", { className: "k" }, lookup("settings.current")), h("span", null, self.data ? `v${self.data.current}` : "—"),
        h("span", { className: "k" }, lookup("settings.npmlatest")), h("span", null, self.data ? (self.data.latest ? `v${self.data.latest}` : lookup("settings.lookupfailed", { err: self.data.error || "" })) : "…"),
      ),
      self.data && self.data.outdated
        ? h("div", { className: "dshm-actions" },
            h("button", { className: "dshm-btn primary sm", disabled: upgrading, onClick: upgradeSelf }, upgrading ? h(Spin) : lookup("settings.upgradeself")),
            h("span", { className: "dshm-hint" }, lookup("settings.upgradehint")),
          )
        : null,
    ),
    Section(lookup("settings.about"),
      h("div", { className: "dshm-hint" }, lookup("settings.about.text")),
    ),
  );

  async function upgradeSelf() {
    setUpgrading(true);
    try {
      const res = await api("self-upgrade");
      notify({ kind: "ok", text: lookup("self.upgraded", { v: res.version }), needsRestart: true });
      await self.reload();
    } catch (e) {
      notify({ kind: "err", text: lookup("failed.selfupdate", { err: (e && e.message) || e }) });
    } finally {
      setUpgrading(false);
    }
  }
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
      h("span", { key: `${k}-v`, style: { wordBreak: "break-all" } }, v),
    ]),
  );
}

// ---------- 卡片（市场/已装共用） ----------
function Card({ icon, name, badges, desc, sub, links, open, onToggle, detail, actions }) {
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
      links || null,
      open ? h("div", { className: "dshm-detail" }, detail) : null,
      open && actions && actions.length ? h("div", { className: "dshm-actions" }, ...actions) : null,
    ),
  );
}

// ---------- 面板（3 视图容器） ----------
const TABS = [
  ["market", "tab.market", "market"],
  ["installed", "tab.installed", "installed"],
  ["settings", "tab.settings", null],
];

function MarketPanel({ onClose }) {
  const [tab, setTab] = useState("market");
  // 市场数据唯一 owner：服务端分页 + query generation + AbortController（Task 7）
  const market = useMarketData();
  const installed = useAsync(() => api("installed"), []);
  // registry 配置应用后：先刷新市场页，再刷新已装页（顺序执行，旧请求被 generation 丢弃）
  const onRegistryChanged = useCallback(async () => {
    await market.reload(false);
    await installed.reload().catch(() => undefined);
  }, [market, installed]);
  const counts = {
    market: market.data ? market.data.total : null,
    installed: installed.data ? installed.data.items.length : null,
  };
  const [banner, setBanner] = useState(null); // { text } | null
  const [toast, setToast] = useState(null); // { kind, text } | null
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  // needsRestart 为 true 才出重启横幅（安装/卸载/升级/自更新）；registry 配置只 toast
  const notify = useCallback(({ kind, text, needsRestart }) => {
    setToast({ kind, text });
    if (kind === "ok" && needsRestart) setBanner({ text: lookup("banner.done") });
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
        h("span", { className: "dshm-title" }, lookup("title.full")),
        h(
          "div",
          { className: "dshm-seg", role: "tablist" },
          TABS.map(([key, labelKey, countKey]) =>
            h("button", {
              key,
              type: "button",
              role: "tab",
              "aria-selected": tab === key,
              className: tab === key ? "on" : "",
              onClick: () => setTab(key),
            },
              lookup(labelKey),
              countKey && counts[countKey] != null ? h("span", { className: "dshm-count" }, String(counts[countKey])) : null,
            ),
          ),
        ),
        h("span", { className: "dshm-spacer" }),
        h("button", { className: "dshm-btn", onClick: onClose }, lookup("common.close")),
      ),
      h(
        "div",
        { className: "dshm-body" },
        tab === "market" ? h(MarketTab, { notify, market }) : null,
        tab === "installed" ? h(InstalledTab, { notify, installed }) : null,
        tab === "settings" ? h(SettingsTab, { notify, onRegistryChanged }) : null,
      ),
      toast
        ? h("div", { className: `dshm-banner`, style: toast.kind === "err" ? { background: "var(--dsw-alias-state-error-secondary,#fee2e2)", color: "var(--dsw-alias-state-error-primary,#b91c1c)" } : null },
            h("span", { className: "dshm-banner-text" }, toast.text))
        : null,
      banner ? h(RestartBanner, { note: banner.text, onDone: () => setBanner(null) }) : null,
    ),
  );
}

// ---------- 侧栏入口（命令式挂载，规避宿主 React 与 bundle React 的双实例 state 问题） ----------
function mountPanel() {
  if (typeof document === "undefined") return;
  ensureCss();
  if (document.getElementById("dshm-panel-root")) return;
  const container = document.createElement("div");
  container.id = "dshm-panel-root";
  document.body.appendChild(container);
  // react-dom 可能为 CJS 或 ESM namespace，做一层互操作
  const rdom = rd && rd.default && (rd.default.createRoot || rd.default.render) ? rd.default : rd;
  let root = null;
  const close = () => {
    try {
      if (root && typeof root.unmount === "function") root.unmount();
      else if (rdom && typeof rdom.unmountComponentAtNode === "function") rdom.unmountComponentAtNode(container);
    } catch {
      /* ignore */
    }
    container.remove();
  };
  if (rdom && typeof rdom.createRoot === "function") {
    root = rdom.createRoot(container);
    root.render(h(MarketPanel, { onClose: close }));
  } else if (rdom && typeof rdom.render === "function") {
    rdom.render(h(MarketPanel, { onClose: close }), container);
  } else {
    container.remove();
  }
}

// 同系列线性图标（16×16 / stroke currentColor / 1.4，与 PlazaIcon 同约定）：宫格 + 放大镜
function MarketIcon() {
  return h("svg", { viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
    h("rect", { x: "1.75", y: "1.75", width: "5.5", height: "5.5", rx: "1.2", stroke: "currentColor", strokeWidth: "1.4" }),
    h("rect", { x: "8.75", y: "1.75", width: "5.5", height: "5.5", rx: "1.2", stroke: "currentColor", strokeWidth: "1.4" }),
    h("rect", { x: "1.75", y: "8.75", width: "5.5", height: "5.5", rx: "1.2", stroke: "currentColor", strokeWidth: "1.4" }),
    // 右下：放大镜（收一点，光学尺寸与其他宫格图标一致）
    h("circle", { cx: "10.5", cy: "10.5", r: "2.9", stroke: "currentColor", strokeWidth: "1.4" }),
    h("path", { d: "M12.6 12.6 14.3 14.3", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round" }),
  );
}

function MarketEntry(props) {
  useEffect(() => ensureCss(), []);
  return h(
    "button",
    {
      className: "dshm-entry",
      onClick: () => {
        try {
          mountPanel();
        } catch (e) {
          console.error("[dsh-m] 打开市场面板失败:", e);
        }
      },
      title: "插件市场",
    },
    h(MarketIcon),
    props && props.wide ? h("span", null, lookup("market.title")) : null,
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
      h(LinksRow, { npm: it.npm, github: it.github, homepage: it.homepage }),
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
      .catch(() => {
        if (live) {
          setItems([]);
          setErr(lookup("notice.toolview.err"));
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
  // 双语：向宿主注册 locale 字典（侧栏 label 随系统语言切换）
  ctx.inject(["locale"], (c) => {
    if (!c.locale || typeof c.locale.register !== "function") return;
    c.effect(() => {
      try {
        return c.locale.register("dshm", { zh: ZH, en: EN });
      } catch {
        return () => {};
      }
    }, "dshm-locale");
  });
  slots.inject("sidebar.footer.action", () =>
    slots.register(
      { name: "sidebar.footer.action", id: "dshm-market", key: "dshm-market", order: 9, locale: "dshm", label: () => lookup("market.title") },
      function DshmMarketEntry(actionProps) {
        return h(MarketEntry, actionProps);
      },
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
