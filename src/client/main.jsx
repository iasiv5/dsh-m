// dsh-m client (web bundle)。构建产物 lib/client.js 由 scripts/build.mjs 包裹为
// window.__ModuleLoader__.load({ id: "dsh-m", factory: (require) => { ... } })。
// 运行环境由 loader 提供 react / react-dom（peer，零自带运行时依赖）。
// UI：3 视图（市场/已装/设置）+ 卡片展开详情 + 重启横幅。中文，跟随 DSH Web 深色主题。
const React = require("react");
const rd = require("react-dom");
const h = React.createElement;
const { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } = React;

const PLUGIN_ID = "dsh-m";
const API = "/dshm";

// 市场面板 pure state（Node tests 直接覆盖；0.7.0 Task 8 分区化：zone 状态工厂/页码窗口/分区 chips）
const { DEFAULT_PAGE_SIZE, MARKET_PAGE_SIZES, pageItems, createZoneState, normalizeMarketQuery, resetPageOnFilterChange, normalizeMarketResponse, registryNotice, zoneChips, marketNotice } = require("./market-state.js");
const { createMarkdown } = require("./markdown.js");
const { ExtLink, MdImg, renderMarkdown } = createMarkdown(h);
const { installedViewModel, registrySourceKey } = require("./installed-view.js");
const { toggleViewModel, toggleNoticeKeys } = require("./toggle-view.js");
const { pickPayload, parseToolArgs } = require("./tool-view.js");
const { RESTART_POLL_MS, RESTART_DEADLINE_MS, nextRestartWait, isAmbiguousRestartRequestError } = require("./restart-wait.js");
const { refreshAfterMutation } = require("./view-refresh.js");
const { createOperationsStore, restoreRecords } = require("./operations.js");
const { createFavoritesStore, partitionStale } = require("./favorites.js");

// ---------- i18n（skillhub 同款：host locale.register + client lookup + {param} 插值） ----------
const ZH = {
  "market.title": "插件市场",
  "tab.market": "市场", "tab.installed": "已装", "tab.settings": "设置",
  "cat.all": "全部", "cat.market": "市场", "cat.tools": "工具", "cat.ui": "界面", "cat.search": "搜索", "cat.other": "其他",
  "zone.community": "社区", "zone.primary": "精选", "zone.favorites": "收藏",
  "sort.downloads.desc": "下载量 ↓", "sort.downloads.asc": "下载量 ↑", "sort.stars.desc": "Star ↓", "sort.stars.asc": "Star ↑", "sort.added.desc": "最新收录 ↓", "sort.added.asc": "最早收录 ↑",
  "badge.deprecated": "已弃用", "sub.snapshot": "v{v}（目录快照）", "market.pagesize": "{n} 条/页", "badge.verified": "已实测",
  "modal.category": "分类", "modal.added": "收录日期", "modal.dlwindow": "下载量（30 天窗口）", "modal.checkedat": "核对于", "modal.dlnone": "无窗口数据",
  "modal.verified": "实测版本", "modal.tags": "标签", "modal.replacement": "已弃用 · 替代", "modal.installcmd": "安装命令", "modal.copy": "复制", "modal.copied": "已复制",
  "op.clear": "清除已完成",
  "op.superseded.note": "{target} 已跳过（前提已不成立或已手动处理）", "op.cancelled": "用户放弃确认",
  "op.kind.install": "安装", "op.kind.upgrade": "升级", "op.kind.uninstall": "卸载", "op.kind.toggle": "开关",
  "op.status.queued": "排队中", "op.status.running": "进行中", "op.status.input": "待决", "op.status.done": "完成", "op.status.warned": "带警告", "op.status.failed": "失败", "op.status.superseded": "已跳过",
  "favorites.hint": "还没有收藏——去社区/精选页点插件卡片右上角的 ☆ 收藏",
  "favorites.stale": "{n} 条收藏已从目录下架", "favorites.clean": "清理失效收藏", "favorites.checking": "校验收藏有效性中…", "favorites.stalebadge": "已下架",
  "fav.add": "收藏", "fav.remove": "取消收藏",
  "common.clear": "清空",
  "search.ph": "搜索名称 / 描述 / 标签…",
  "common.refresh": "刷新", "common.close": "关闭", "common.later": "稍后", "common.ok": "知道了", "common.none": "—",
  "market.loading": "加载收录清单中… ", "market.empty": "无匹配插件，试试其他关键词或分类",
  "installed.loading": "读取 web profile 中… ", "installed.empty": "web profile 尚未安装任何 dsh 插件", "installed.none": "未安装",
  "installed.others": "另有 {n} 个非 dsh 依赖（未识别为插件），已默认折叠。",
  "installed.upgradeAll": "全部更新 ({n})",
  "badge.installed": "已安装", "badge.update": "可升级", "badge.market": "市场安装", "badge.nonmarket": "非市场安装", "badge.custom": "自定义",
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
  "settings.about.text": "个人 DSH 插件市场：收录、安装、卸载、升级全部本机完成；收录清单支持自定义覆盖，应用即时生效。",
  "src.override": "自定义源", "src.jsdelivr": "GitHub 镜像（备用）", "src.raw": "raw.githubusercontent（@main）", "src.cache": "本地缓存", "src.bundled": "包内快照（兜底）",
  "src.default.raw": "GitHub 原始文件（@main）", "src.default.jsdelivr": "GitHub 镜像（备用）", "src.default.cache": "默认清单缓存",
  "src.custom.url": "自定义 URL 源", "src.custom.file": "本地文件源", "src.custom.cache": "自定义源（缓存）", "src.custom.unavailable": "自定义源（不可用）",
  "settings.address": "Registry 地址", "settings.address.hint": "空 = 官方默认清单；支持 HTTPS URL 或本机绝对路径 / file://。整体覆盖默认清单，不做合并。",
  "settings.address.ph": "https://example.com/registry.json 或 /path/to/registry.json",
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
  "notice.toolview.err": "收录清单暂不可用",
  "badge.community": "社区收录",
  "community.stale": "社区目录为缓存快照（显示的不是最新数据）", "community.fallback": "收录清单不可用，当前展示社区清单条目",
  "detail.capabilities": "能力披露", "detail.capabilities.unscanned": "未扫描 ≠ 未检出", "detail.redlines": "能力红线",
  "guard.blocked": "安装被装后守卫拦截", "guard.compstatus": "补偿终态", "guard.repairbasis": "修复依据",
  "guard.restartsafenow": "可以重启 DSH Web", "guard.restartunsafe": "修复后再重启（不要现在一键重启）",
  "guard.noforce": "守卫拦截无「仍要安装」通道，请按修复依据人工处理",
  "detail.screenshots": "截图", "installed.check.incomplete": "检查未完成",
  "settings.community": "社区清单（awesome-dsh-plugin 目录）", "settings.community.none": "社区清单未启用或不可用",
  "settings.community.status": "状态", "settings.community.version": "目录版本", "settings.community.route": "获取线路",
  "settings.community.accepted": "收录 / 上游", "settings.community.displaced": "与主清单重复让位",
  "self.upgraded": "dsh-m 已更新到 v{v}，重启后生效", "self.failed": "自更新失败：{err}",
  "registry.refreshed": "收录清单已强制刷新",
  "notify.installed": "已安装 {pkg}{version}", "notify.allowbuilds": "（注意：该插件执行了构建脚本，已按策略放行）",
  "notify.builds": "（已精确放行构建脚本：{names}）", "notify.builds.fallback": "（注意：构建脚本名单不可读，已全量兜底放行）",
  "notify.bundlewarning": "（注意：该包无补丁层，已装入为纯依赖不会生效；可卸载或到收录仓库反馈）",
  "notify.toggled.on.live": "已启用 {pkg}（即时生效）", "notify.toggled.off.live": "已停用 {pkg}（即时生效）",
  "notify.toggled.on.restart": "已启用 {pkg}（需重启生效）", "notify.toggled.off.restart": "已停用 {pkg}（需重启生效）",
  "toggle.state.on": "运行中", "toggle.state.off": "已停用",
  "toggle.lock.self": "dsh-m 自身不可开关", "toggle.lock.protected": "官方宿主命脉，不可开关", "toggle.lock.noentry": "未装载（不在加载树）",
  "toggle.failed": "开关操作失败：{err}",
  "phase.active": "active", "phase.failed": "failed", "phase.pending": "pending", "phase.loading": "loading", "phase.unloading": "unloading",
  "compat.title": "兼容性风险确认", "compat.body": "{pkg}@{version} 声明的 peerDependencies 与当前 DSH {runtime} 不兼容：",
  "compat.risk": "继续安装可能导致崩溃或数据丢失。确定仍要安装吗？",
  "compat.force": "仍要安装", "common.cancel": "取消",
  "notify.uninstalled": "已卸载 {pkg}", "notify.livedisabled": "（已先下线运行中的界面）",
  "notify.leftovers": "；检测到疑似残留数据：{paths}",
  "notify.upgraded": "已升级 {pkg}（{from} → {to}）", "notify.upgradehint": "（注意：该插件执行了构建脚本）",
  "failed.install": "安装失败：{err}", "failed.uninstall": "卸载失败：{err}", "failed.upgrade": "升级失败：{err}", "failed.selfupdate": "自更新失败：{err}",
  "failed.load": "加载失败：{err}", "failed.read": "读取失败：{err}", "failed.open": "打开市场面板失败:",
  "banner.done": "变更完成，需要重启 DSH Web 后生效。",
  "restart.doing": "正在请求重启…", "restart.waiting": "已请求重启，等待 DSH Web 恢复…",
  "restart.now": "⚡ 一键重启", "restart.failed": "重启失败：{err}",
  "restart.timeout": "重启超时，请手动检查 dsh web 服务状态",
  "restart.hint.done": "已请求重启 DSH web（via {via}）。服务恢复后 DSH Web 会在后台自动重连。",
  "phase.resolving": "解析依赖", "phase.downloading": "下载", "phase.linking": "链接安装", "phase.building": "构建脚本", "phase.ready": "准备中",
  "readme.show": "📖 README", "readme.hide": "收起 README", "readme.loading": "加载 README… ", "readme.none": "（该插件没有 README）",
  "readme.truncated": "…（超过 64KB 已截断，完整内容见插件目录）",
  "warn.unlink": "卸载只移除 profile 对本地目录的引用（{path}），不会删除目录本身。",
  "warn.core": "这是 file: 安装的核心/归档包，卸载可能影响 DSH 功能，且需要手动恢复。",
  "profile.hint": "web profile：{path}",
  "dsh.chip.copyhint": "点击复制版本号", "dsh.chip.copied": "已复制 ✓",
  "title.panel": "插件市场", "title.full": "DeepSeek Harness 插件市场",
};
const EN = {
  "market.title": "Plugin Marketplace",
  "tab.market": "Market", "tab.installed": "Installed", "tab.settings": "Settings",
  "cat.all": "All", "cat.market": "Market", "cat.tools": "Tools", "cat.ui": "UI", "cat.search": "Search", "cat.other": "Other",
  "zone.community": "Community", "zone.primary": "Curated", "zone.favorites": "Favorites",
  "sort.downloads.desc": "Downloads ↓", "sort.downloads.asc": "Downloads ↑", "sort.stars.desc": "Stars ↓", "sort.stars.asc": "Stars ↑", "sort.added.desc": "Recently added ↓", "sort.added.asc": "Oldest first ↑",
  "badge.deprecated": "Deprecated", "sub.snapshot": "v{v} (catalog snapshot)", "market.pagesize": "{n} / page", "badge.verified": "Verified",
  "modal.category": "Category", "modal.added": "Added", "modal.dlwindow": "Downloads (30-day window)", "modal.checkedat": "checked at", "modal.dlnone": "No window data",
  "modal.verified": "Verified runtimes", "modal.tags": "Tags", "modal.replacement": "Deprecated · replacement", "modal.installcmd": "Install command", "modal.copy": "Copy", "modal.copied": "Copied",
  "op.clear": "Clear finished",
  "op.superseded.note": "{target} skipped (precondition gone or already handled)", "op.cancelled": "user cancelled",
  "op.kind.install": "Install", "op.kind.upgrade": "Upgrade", "op.kind.uninstall": "Uninstall", "op.kind.toggle": "Toggle",
  "op.status.queued": "Queued", "op.status.running": "Running", "op.status.input": "Pending", "op.status.done": "Done", "op.status.warned": "Warned", "op.status.failed": "Failed", "op.status.superseded": "Skipped",
  "favorites.hint": "No favorites yet — tap ☆ on a plugin card in Community/Curated to bookmark it",
  "favorites.stale": "{n} favorites no longer in the catalog", "favorites.clean": "Clean up stale favorites", "favorites.checking": "Checking favorites…", "favorites.stalebadge": "Delisted",
  "fav.add": "Bookmark", "fav.remove": "Remove bookmark",
  "common.clear": "Clear",
  "search.ph": "Search name, description, tags…",
  "common.refresh": "Refresh", "common.close": "Close", "common.later": "Later", "common.ok": "OK", "common.none": "—",
  "market.loading": "Loading listings… ", "market.empty": "No matching plugins — try another keyword or category",
  "installed.loading": "Reading web profile… ", "installed.empty": "No DSH plugins installed in this web profile", "installed.none": "Not installed",
  "installed.others": "{n} non-DSH dependencies (not recognized as plugins) are collapsed.",
  "installed.upgradeAll": "Update all ({n})",
  "badge.installed": "Installed", "badge.update": "Update", "badge.market": "Via market", "badge.nonmarket": "Non-market", "badge.custom": "Custom",
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
  "settings.about.text": "A personal DSH plugin marketplace — browse, install, uninstall and upgrade, all local; registry overrides apply live.",
  "src.override": "Custom source", "src.jsdelivr": "GitHub mirror (backup)", "src.raw": "raw.githubusercontent (@main)", "src.cache": "Local cache", "src.bundled": "Bundled snapshot (fallback)",
  "src.default.raw": "GitHub raw (@main)", "src.default.jsdelivr": "GitHub mirror (backup)", "src.default.cache": "Default registry cache",
  "src.custom.url": "Custom URL source", "src.custom.file": "Local file source", "src.custom.cache": "Custom source (cache)", "src.custom.unavailable": "Custom source (unavailable)",
  "settings.address": "Registry address", "settings.address.hint": "Empty = official default registry; accepts an HTTPS URL or a local absolute path / file://. Replaces (not merges) the default registry. Live effect.",
  "settings.address.ph": "https://example.com/registry.json or /path/to/registry.json",
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
  "notice.toolview.err": "Registry temporarily unavailable",
  "badge.community": "Community",
  "community.stale": "Community catalog served from cache (not the latest data)", "community.fallback": "Registry unavailable — showing community listings",
  "detail.capabilities": "Capabilities", "detail.capabilities.unscanned": "Not scanned ≠ not detected", "detail.redlines": "Capability red lines",
  "guard.blocked": "Install blocked by post-install guard", "guard.compstatus": "Compensation status", "guard.repairbasis": "Repair basis",
  "guard.restartsafenow": "You can restart DSH Web now", "guard.restartunsafe": "Fix before restarting (do not one-click restart now)",
  "guard.noforce": "Guard blocks have no force channel — repair manually per the basis above",
  "detail.screenshots": "Screenshots", "installed.check.incomplete": "Check incomplete",
  "settings.community": "Community catalog (awesome-dsh-plugin)", "settings.community.none": "Community catalog disabled or unavailable",
  "settings.community.status": "Status", "settings.community.version": "Catalog version", "settings.community.route": "Route",
  "settings.community.accepted": "Accepted / upstream", "settings.community.displaced": "Displaced (duplicate of primary)",
  "self.upgraded": "dsh-m updated to v{v} — restart to take effect", "self.failed": "Self-update failed: {err}",
  "registry.refreshed": "Registry force-refreshed",
  "notify.installed": "Installed {pkg}{version}", "notify.allowbuilds": " (note: this plugin ran build scripts, allowed by policy)",
  "notify.builds": " (build scripts precisely allowed: {names})", "notify.builds.fallback": " (note: pending list unreadable; all builds allowed as fallback)",
  "notify.bundlewarning": " (note: no patch layer — installed as a plain dependency; uninstall or report to the listing repo)",
  "notify.toggled.on.live": "Enabled {pkg} (applied live)", "notify.toggled.off.live": "Disabled {pkg} (applied live)",
  "notify.toggled.on.restart": "Enabled {pkg} (restart required)", "notify.toggled.off.restart": "Disabled {pkg} (restart required)",
  "toggle.state.on": "running", "toggle.state.off": "disabled",
  "toggle.lock.self": "dsh-m itself cannot be toggled", "toggle.lock.protected": "host lifeline module; not toggleable", "toggle.lock.noentry": "not composed (absent from loader tree)",
  "toggle.failed": "Toggle failed: {err}",
  "phase.active": "active", "phase.failed": "failed", "phase.pending": "pending", "phase.loading": "loading", "phase.unloading": "unloading",
  "compat.title": "Compatibility risk", "compat.body": "{pkg}@{version} declares peerDependencies incompatible with DSH {runtime}:",
  "compat.risk": "Proceeding may cause crashes or data loss. Install anyway?",
  "compat.force": "Install anyway", "common.cancel": "Cancel",
  "notify.uninstalled": "Uninstalled {pkg}", "notify.livedisabled": " (live UI disabled first)",
  "notify.leftovers": "; possible leftover data: {paths}",
  "notify.upgraded": "Upgraded {pkg} ({from} → {to})", "notify.upgradehint": " (note: this plugin ran build scripts)",
  "failed.install": "Install failed: {err}", "failed.uninstall": "Uninstall failed: {err}", "failed.upgrade": "Upgrade failed: {err}", "failed.selfupdate": "Self-update failed: {err}",
  "failed.load": "Load failed: {err}", "failed.read": "Read failed: {err}", "failed.open": "Failed to open the marketplace panel:",
  "banner.done": "Changes applied. Restart DSH Web to take effect.",
  "restart.doing": "Requesting restart…", "restart.waiting": "Restart requested, waiting for DSH Web…",
  "restart.now": "⚡ Restart", "restart.failed": "Restart failed: {err}",
  "restart.timeout": "Restart timed out — check the dsh web service manually",
  "restart.hint.done": "Restart requested (via {via}). DSH Web will reconnect in the background after the service returns.",
  "phase.resolving": "Resolving", "phase.downloading": "Downloading", "phase.linking": "Linking", "phase.building": "Building", "phase.ready": "Preparing",
  "readme.show": "📖 README", "readme.hide": "Hide README", "readme.loading": "Loading README… ", "readme.none": "(No README)",
  "readme.truncated": "…(truncated at 64KB — see the plugin directory for full content)",
  "warn.unlink": "Uninstalling only removes the profile's reference to the local directory ({path}); the directory itself is kept.",
  "warn.core": "This is a core/archive package installed via file:. Uninstalling may affect DSH features and requires manual restore.",
  "profile.hint": "web profile: {path}",
  "dsh.chip.copyhint": "Click to copy version", "dsh.chip.copied": "Copied ✓",
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

// （0.7.0 Task 8：客户端 CATEGORIES 表已由 market-state.js zoneChips 取代）

// ---------- 样式（跟随 DSH Web 主题变量，深浅色自适应） ----------
const CSS = `
.dshm-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-mask-3,rgba(15,23,42,.48));display:flex;align-items:center;justify-content:center;padding:24px 16px;box-sizing:border-box}
.dshm-panel{width:min(920px,100%);height:min(680px,86vh);display:flex;flex-direction:column;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base,#fff));background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 86%,transparent);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:14px;box-shadow:0 18px 48px rgba(2,6,23,.25);overflow:hidden;font-family:inherit;color:var(--dsw-alias-label-primary,inherit)}
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
.dshm-input{flex:1;min-width:120px;border:1px solid var(--dsw-alias-border-l2,#c7d2fe);background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary,inherit);border-radius:8px;padding:5px 10px;font:inherit;font-size:12px;outline:none}
.dshm-input:focus{border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5)}
.dshm-chips{display:flex;flex-wrap:wrap;gap:6px}
.dshm-chip{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);border-radius:999px;padding:2px 10px;font:inherit;font-size:11px;cursor:pointer}
.dshm-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dshm-chip.on{background:var(--dsw-specific-sidebar-nav-item-active,rgba(38,49,72,.08));border-color:transparent;color:var(--dsw-alias-label-primary,inherit);font-weight:500}
.dsvm-chipswrap{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 94%,transparent);padding:4px 0;margin:-4px 0}
.dsvm-sortrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.dsvm-sort{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-secondary,#4b5563);border-radius:999px;padding:2px 8px;font:inherit;font-size:11px;cursor:pointer}
.dsvm-byline{display:flex;flex-wrap:wrap;gap:8px;color:var(--dsw-alias-label-caption,#6b7280);font-size:11px;line-height:16px;margin:2px 0 0;font-variant-numeric:tabular-nums}
.dsvm-pager{display:flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:center;margin-top:4px}
.dsvm-pagebtn{min-width:26px;height:24px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:12px;cursor:pointer}
.dsvm-pagebtn.on{border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5);color:var(--dsw-alias-interactive-bg-selected,#4f46e5);font-weight:600}
.dsvm-pagebtn:disabled{opacity:.4;cursor:default}
.dsvm-modal{position:fixed;inset:0;z-index:2147483100;background:var(--dsw-alias-bg-mask-3,rgba(15,23,42,.55));display:flex;align-items:center;justify-content:center;padding:24px 16px}
.dsvm-modalbox{width:min(720px,100%);max-height:86vh;overflow:auto;background:var(--dsw-alias-bg-elevated,#fff);background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 94%,transparent);backdrop-filter:blur(14px);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:14px;box-shadow:0 18px 48px rgba(2,6,23,.25);padding:16px;display:flex;flex-direction:column;gap:10px}
.dsvm-modalhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsvm-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:12px;margin:0}
.dsvm-kv dt{color:var(--dsw-alias-label-caption,#6b7280);white-space:nowrap}
.dsvm-kv dd{margin:0;color:var(--dsw-alias-label-secondary,#4b5563);overflow-wrap:anywhere}
.dsvm-fold{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;padding:6px 10px;font-size:12px}
.dsvm-fold summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#4b5563)}
.dsvm-cmdrow{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap}
.dsvm-code{background:rgba(127,127,127,.12);padding:3px 8px;border-radius:6px;font-size:11px;overflow-wrap:anywhere}
.dsvm-modalactions{display:flex;justify-content:flex-end;gap:8px}
.dsvm-shotrow{display:flex;gap:6px;overflow-x:auto;padding:2px 0}
.dsvm-shotbox{min-width:120px;min-height:84px;display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.08);border-radius:6px;cursor:zoom-in;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25))}
.dsvm-shot{max-width:220px;max-height:130px;border-radius:6px;display:block}
.dsvm-lightbox{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.88);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
.dsvm-lightbox img{max-width:94vw;max-height:80vh;border-radius:8px}
.dsvm-lbnav{display:flex;align-items:center;gap:10px}
.dsvm-lbcount{color:rgba(255,255,255,.75);font-size:12px}
.dsvm-lbdots{display:flex;gap:6px}
.dsvm-lbdot{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.3);cursor:pointer}
.dsvm-lbdot.on{background:#fff}
.dsvm-card-clickable, .dshm-card{cursor:pointer}
.dshm-card:hover{border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5)}
.dsvm-btn{border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.14);color:#fff;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;cursor:pointer}
.dsvm-btn:hover{background:rgba(255,255,255,.24)}
.dsvm-ops{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;font-size:12px}
.dsvm-opgroup{display:flex;flex-direction:column;gap:3px}
.dsvm-opgroup.done{opacity:.75}
.dsvm-oprow{display:flex;align-items:center;gap:8px;min-height:22px}
.dsvm-opstatus{min-width:44px;font-size:11px;color:var(--dsw-alias-label-caption,#6b7280)}
.dsvm-oprow.ok .dsvm-opstatus{color:#15803d}
.dsvm-oprow.warn .dsvm-opstatus, .dsvm-oprow.run .dsvm-opstatus{color:#b45309}
.dsvm-oprow.err .dsvm-opstatus{color:var(--dsw-alias-state-error-primary,#b91c1c)}
.dsvm-oprow.sup .dsvm-opstatus{color:var(--dsw-alias-label-caption,#6b7280)}
.dsvm-opkind{color:var(--dsw-alias-label-secondary,#4b5563)}
.dsvm-optarget{font-weight:500;overflow-wrap:anywhere}
.dsvm-opnote{color:var(--dsw-alias-label-caption,#6b7280);font-size:11px;overflow-wrap:anywhere}
.dsvm-favbtn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-caption,#9ca3af);font-size:15px;line-height:1;cursor:pointer;padding:0 2px;margin-left:auto}
.dsvm-favbtn:hover{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsvm-favbtn.on{color:#e0a33c}
.dsvm-reddot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-error-primary,#ef4444);margin-left:5px;vertical-align:middle}
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
.dshm-banner.err{background:rgba(239,68,68,.13);color:var(--dsw-alias-state-error-primary,#b91c1c)}
.dshm-banner .dshm-banner-text{flex:1;max-height:140px;overflow:auto;overscroll-behavior:contain;white-space:pre-wrap;word-break:break-word;line-height:18px}
.dshm-row{display:flex;align-items:center;gap:8px}
.dshm-kv{display:grid;grid-template-columns:96px 1fr;gap:6px 10px;font-size:12px;align-items:baseline}
.dshm-kv .k{color:var(--dsw-alias-label-caption,#6b7280);font-size:11px}
.dshm-section{background:var(--dsw-alias-bg-layer-2,rgba(38,49,72,.04));border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:9px;margin:0 0 10px}
.dshm-section:last-child{margin-bottom:2px}
.dshm-section-title{display:flex;align-items:center;gap:7px;font-weight:700;font-size:12px;letter-spacing:.2px;color:var(--dsw-alias-label-primary,inherit)}
.dshm-section-title::before{content:"";width:3px;height:11px;border-radius:2px;background:var(--dsw-alias-interactive-bg-selected,#4f46e5)}
.dshm-section-sub{margin-left:auto;font-weight:400;font-size:11px;color:var(--dsw-alias-label-caption,#9ca3af)}
.dshm-note{border-left:3px solid var(--dsw-alias-border-l2,#cbd5e1);padding:3px 10px;color:var(--dsw-alias-label-caption,#9ca3af);font-size:11px;line-height:17px;word-break:break-word}
.dshm-note.warn{border-left-color:var(--dsw-alias-state-warn-primary,#b45309)}
.dshm-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));padding:1px 7px;border-radius:5px;word-break:break-all}
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
/* 收起（rail）态：与宿主设置入口 / dsh-skins 同几何——36×36 圆形、margin 8/10、
   图标 18、内容水平居中。缺这套会导致收起时图标偏离轴线且行距不齐（实测左偏 ~4px）。 */
.dshm-entry.rail{width:36px;height:36px;margin:8px 0 10px;padding:0;justify-content:center;border-radius:50%;gap:0}
.dshm-entry.rail svg{width:18px;height:18px}
[data-slot="sidebar.footer.action"]{display:flex!important;flex-direction:column;width:100%;min-width:0}
[data-slot="sidebar.footer.action"]>*{flex:none;min-width:0}
.dshm-empty{text-align:center;color:var(--dsw-alias-label-caption,#6b7280);font-size:13px;padding:32px 0}
/* 头部 DSH 版本 chip：等宽小字圆角，hover 展开详情，点击复制（2026-09-14 定稿） */
.dshm-dshchip{position:relative;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#f5f6f8);color:var(--dsw-alias-label-secondary,#4b5563);border-radius:999px;padding:4px 10px;font:11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;cursor:pointer;white-space:nowrap;flex:none}
.dshm-dshchip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-primary,inherit)}
.dshm-dshchip-v{font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
.dshm-dshchip-tip{position:absolute;top:calc(100% + 7px);right:0;visibility:hidden;opacity:0;transition:opacity .12s;z-index:60;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base,#fff));background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 86%,transparent);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:9px;box-shadow:var(--dsw-shadow-lv1,0 2px 8px rgb(20 24 32 / 8%));padding:7px 10px;text-align:left;pointer-events:none}
.dshm-dshchip:hover .dshm-dshchip-tip,.dshm-dshchip:focus-visible .dshm-dshchip-tip{visibility:visible;opacity:1}
.dshm-dshchip-tiprow{font:12px/16px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
.dshm-dshchip-tipsub{display:block;margin-top:2px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-caption,#9ca3af)}

/* 0.4.0：开关 / 相位点 / 兼容确认弹窗 */
.dshm-dot{font-size:9px;line-height:1;vertical-align:middle;margin-right:2px}
.dshm-dot.ok{color:#22c55e}
.dshm-dot.err{color:#ef4444}
.dshm-dot.idle{color:#9ca3af}
.dshm-dot.busy{color:#f59e0b}
.dshm-switch{position:relative;display:inline-flex;align-items:center;width:34px;height:19px;border-radius:10px;background:var(--dsw-alias-fill-secondary,#d1d5db);cursor:pointer;transition:background .15s;flex:none;margin-left:auto}
.dshm-switch input{display:none}
.dshm-switch.on{background:#22c55e}
.dshm-switch.locked{opacity:.45;cursor:not-allowed}
.dshm-switch-slider{position:absolute;left:2px;top:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.dshm-switch.on .dshm-switch-slider{left:17px}
.dshm-compat-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:60}
.dshm-compat-dialog{max-width:420px;width:calc(100% - 32px);background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base,#1c2230));background:color-mix(in srgb,var(--dsw-alias-bg-base,#1c2230) 86%,transparent);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);border:1px solid var(--dsw-alias-border-l2,#333b4d);border-radius:12px;padding:16px}
.dshm-compat-title{font-weight:600;margin-bottom:8px;color:#f87171}
.dshm-compat-body{font-size:12px;margin-bottom:6px}
.dshm-compat-peers{margin:0 0 8px;padding-left:18px;font-size:12px}
.dshm-compat-peers li{font-family:ui-monospace,monospace}
.dshm-compat-risk{font-size:12px;color:#f87171;margin-bottom:12px}
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
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `API ${res.status}`);
    if (data && typeof data === "object" && data.issue) err.issue = data.issue; // IncompatibleError 结构化载体
    // M2 Task 3：装后守卫拦截的字段全保留（GUI 一键重启只读 restartSafe，不得由 needsRestart 推导）
    if (data && typeof data === "object" && data.kind && Array.isArray(data.violations)) {
      err.guard = { kind: data.kind, violations: data.violations, compensation: data.compensation, needsRestart: data.needsRestart === true, restartSafe: data.restartSafe === true, repairBasis: data.repairBasis };
    }
    throw err;
  }
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
function useMarketData(zone = "community") {
  const [query, setQuery] = useState(() => normalizeMarketQuery(createZoneState(zone), zone));
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
      source: nextQuery.source || "community",
      ...(nextQuery.sort ? { sort: nextQuery.sort } : {}),
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
    const next = resetPageOnFilterChange(queryRef.current, normalizeMarketQuery({ ...queryRef.current, ...patch }, zone));
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


// ---------- 社区截图消费端校验（M1 Task 9 / Q44：GitHub 图床白名单由上游保证，客户端二次校验） ----------
function safeScreenshots(entry) {
  const list = Array.isArray(entry && entry.screenshots) ? entry.screenshots : [];
  return list
    .filter((u) => typeof u === "string" && u.length <= 2048)
    .map((u) => {
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== "https:") return null;
        if (parsed.hostname === "github.com" || parsed.hostname.endsWith(".githubusercontent.com")) return u;
        return null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, 8);
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

// ---------- 0.4.0：开关 Switch 与相位点（Task 18；纯展示，状态来自 toggleViewModel） ----------
function PhaseDot({ vm }) {
  if (!vm.phaseDotClass) return null;
  return h(
    "span",
    { className: `dshm-dot ${vm.phaseDotClass}`, title: vm.phaseLabelKey ? lookup(vm.phaseLabelKey) : null },
    "\u25CF",
  );
}

function ToggleSwitch({ vm, disabled, onChange, title }) {
  return h(
    "label",
    {
      className: `dshm-switch${vm.switchOn ? " on" : ""}${vm.switchDisabled ? " locked" : ""}`,
      title: title || (vm.switchTitleKey ? lookup(vm.switchTitleKey) : null),
      onClick: (e) => {
        e.stopPropagation();
        if (!vm.switchDisabled && !disabled) onChange(!vm.switchOn);
      },
    },
    h("input", { type: "checkbox", checked: vm.switchOn, disabled: vm.switchDisabled || disabled, readOnly: true }),
    h("span", { className: "dshm-switch-slider" }),
  );
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
      try {
        await api("restart");
      } catch (requestError) {
        // The host may have accepted restart and closed the socket before the
        // JSON response flushed. Continue with boot-id verification for that
        // ambiguous network case; definite HTTP errors still fail immediately.
        if (!isAmbiguousRestartRequestError(requestError)) throw requestError;
      }
      setPhase("waiting");
      const deadlineAt = Date.now() + RESTART_DEADLINE_MS;
      for (;;) {
        await new Promise((r) => setTimeout(r, RESTART_POLL_MS));
        if (nextRestartWait({ phase: "before-ping", now: Date.now(), deadlineAt }) === "timeout") {
          throw new Error(lookup("restart.timeout"));
        }
        let bootChanged = false;
        try {
          const ping = await api("ping");
          bootChanged = ping.boot !== ping0.boot;
        } catch {
          /* 服务重启中，继续轮询 */
        }
        if (nextRestartWait({ phase: "after-ping", bootChanged }) === "done") break;
      }
      // Do not force window.location.reload() here. DSH Web owns the browser
      // connection and has its own background recovery/retry loop; a full-page
      // reload during the auth/route handoff can land on a blank error page.
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

// ---------- 搜索框（0.7.0 Task 9：250ms debounce + IME composition 全程不提交 + draft/已提交分离 + 清除回焦） ----------
function SearchBox({ placeholder, initial, onCommit }) {
  const [draft, setDraft] = useState(initial || "");
  const [composing, setComposing] = useState(false);
  const timerRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const schedule = (v) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onCommit(v), 250);
  };
  const onChange = (v) => {
    setDraft(v);
    if (composing) return; // IME 组合期间不排定提交（组合结束再排）
    schedule(v);
  };
  const submitNow = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    onCommit(draft);
  };
  return h(
    "div",
    { className: "dshm-search" },
    h("input", {
      ref: inputRef,
      className: "dshm-input",
      placeholder,
      value: draft,
      onChange: (e) => onChange(e.target.value),
      onCompositionStart: () => setComposing(true),
      onCompositionEnd: (e) => {
        setComposing(false);
        schedule(e && e.target ? e.target.value : draft);
      },
      onKeyDown: (e) => {
        if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          submitNow();
        }
      },
      onBlur: submitNow,
    }),
    draft
      ? h("button", {
          className: "dshm-btn sm",
          title: lookup("common.clear"),
          onClick: () => {
            setDraft("");
            if (timerRef.current) clearTimeout(timerRef.current);
            onCommit("");
            if (inputRef.current) inputRef.current.focus();
          },
        }, "×")
      : null,
  );
}

// ---------- 分区分类 chips（0.7.0 Task 10：两行折叠 + 实测裁剪 + 收起态激活置前 + 吸顶自动收缩） ----------
function ZoneChips({ zone, counts, labels, active, onPick }) {
  const chips = useMemo(() => zoneChips(counts, labels, zone), [counts, labels, zone]);
  const [expanded, setExpanded] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [fit, setFit] = useState({ rows2: 99, rows1: 99 });
  const wrapRef = useRef(null);
  const sentinelRef = useRef(null);
  // 收起态激活置前：仅当激活分类会被裁掉时才移到首位，否则不打乱顺序（dsh-market 反馈驱动方案）
  const ordered = useMemo(() => {
    if (!active) return chips;
    const idx = chips.findIndex((c) => c.id === active);
    if (idx < 0 || idx < Math.min(fit.rows2, chips.length)) return chips;
    return [chips[idx], ...chips.slice(0, idx), ...chips.slice(idx + 1)];
  }, [chips, active, fit.rows2]);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || expanded) return;
    let rows2 = 0;
    let rows1 = 0;
    let rowCount = 0;
    let lastTop = null;
    for (const k of el.children) {
      if (!(k instanceof HTMLElement) || k.getAttribute("data-chip") !== "1") continue;
      const t = k.offsetTop;
      if (lastTop === null || t !== lastTop) {
        rowCount += 1;
        lastTop = t;
      }
      if (rowCount <= 2) rows2 += 1;
      if (rowCount <= 1) rows1 += 1;
    }
    setFit({ rows2, rows1 });
  }, [ordered.length, expanded, zone]);
  useEffect(() => {
    const s = sentinelRef.current;
    if (!s || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setStuck(!entries[0].isIntersecting), { threshold: 0 });
    io.observe(s);
    return () => io.disconnect();
  }, []);
  const budget = expanded ? ordered.length : stuck ? fit.rows1 : fit.rows2;
  const shown = ordered.slice(0, budget);
  const hidden = ordered.length - shown.length;
  const btn = (c) =>
    h(
      "button",
      { key: c.id, "data-chip": "1", className: `dshm-chip${active === c.id ? " on" : ""}`, onClick: () => onPick(active === c.id ? null : c.id) },
      `${c.label}${c.count ? ` ${c.count}` : ""}`,
    );
  return h(
    React.Fragment,
    null,
    h("div", { ref: sentinelRef, style: { height: "1px" } }),
    h(
      "div",
      { className: "dsvm-chipswrap" },
      h(
        "div",
        { ref: wrapRef, className: "dshm-chips" },
        h("button", { "data-chip": "1", className: `dshm-chip${active == null ? " on" : ""}`, onClick: () => onPick(null) }, lookup("cat.all")),
        ...shown.map(btn),
        hidden > 0
          ? h("button", { "data-chip": "1", className: "dshm-chip", onClick: () => setExpanded(!expanded) },
              expanded ? "⌃" : `+${hidden}`)
          : null,
      ),
    ),
  );
}

/** 计数紧凑化（11.9k 形态；title 属性给精确数）。 */
function compactCount(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}k`;
  }
  return String(n);
}

// ---------- 截图三层懒加载（0.7.0 Task 12：IO 200px 挂 src + loading=lazy + fetchPriority=low） ----------
function Shot({ src, onClick }) {
  const [show, setShow] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return h(
    "div",
    { ref, className: "dsvm-shotbox", onClick, role: "button", tabIndex: 0 },
    show
      ? h("img", { className: "dsvm-shot", src, alt: "", loading: "lazy", referrerPolicy: "no-referrer", fetchPriority: "low" })
      : null,
  );
}

// ---------- 截图灯箱（←→/Esc 键盘、圆点导航、禁自动轮播——大图必须停住直到观看者主动移动） ----------
function Lightbox({ shots, index, onNav, onClose }) {
  return h(
    "div",
    { className: "dsvm-lightbox", onClick: onClose },
    h("img", { src: shots[index], alt: "", onClick: (e) => e.stopPropagation(), referrerPolicy: "no-referrer" }),
    h(
      "div",
      { className: "dsvm-lbnav", onClick: (e) => e.stopPropagation() },
      h("button", { className: "dsvm-btn", onClick: () => onNav((index - 1 + shots.length) % shots.length) }, "‹"),
      h("span", { className: "dsvm-lbcount" }, `${index + 1} / ${shots.length}`),
      h("button", { className: "dsvm-btn", onClick: () => onNav((index + 1) % shots.length) }, "›"),
    ),
    h(
      "div",
      { className: "dsvm-lbdots", onClick: (e) => e.stopPropagation() },
      ...shots.map((s, i) => h("span", { key: s, className: `dsvm-lbdot${i === index ? " on" : ""}`, onClick: () => onNav(i) })),
    ),
  );
}

// ---------- 详情 Modal = 卡片超集（0.7.0 Task 12：「detail 显示少于摘要就是倒退」） ----------
/** Modal/Dialog 打开深度（审计修复 #4）：>0 时面板级 Esc 不关面板——Esc 只关最上层弹层。 */
let dsvmModalDepth = 0;

function useModalDepth(active) {
  useEffect(() => {
    if (!active) return;
    dsvmModalDepth += 1;
    return () => {
      dsvmModalDepth -= 1;
    };
  }, [active]);
}

function DetailModal({ it, labels, busy, onClose, onInstall }) {
  useModalDepth(true);
  const shots = it.community === true ? safeScreenshots(it) : [];
  const [lb, setLb] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (lb !== null) setLb(null);
        else onClose();
      }
      if (lb !== null && shots.length > 1) {
        if (e.key === "ArrowLeft") setLb((i) => (i - 1 + shots.length) % shots.length);
        if (e.key === "ArrowRight") setLb((i) => (i + 1) % shots.length);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lb, shots.length, onClose]);
  const catLabel =
    (labels && labels[it.category]) ||
    (["market", "tools", "ui", "search", "other"].includes(it.category) ? lookup("cat." + it.category) : it.category);
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
  const kv = (k, v) => h(React.Fragment, { key: k }, h("dt", null, k), h("dd", null, v));
  return h(
    "div",
    { className: "dsvm-modal", onClick: onClose },
    h(
      "div",
      { className: "dsvm-modalbox", onClick: (e) => e.stopPropagation() },
      h(
        "div",
        { className: "dsvm-modalhead" },
        h(Icon, { entry: it }),
        h("span", { className: "dshm-name" }, it.name),
        it.deprecated === true ? h("span", { className: "dshm-badge warn" }, lookup("badge.deprecated")) : null,
        it.community !== true && Array.isArray(it.verified) && it.verified.length ? h("span", { className: "dshm-badge", title: it.verified.join("、") }, lookup("badge.verified")) : null,
        it.installed ? h("span", { className: "dshm-badge" }, lookup("badge.installed")) : null,
        it.community === true ? h("span", { className: "dshm-badge info" }, lookup("badge.community")) : null,
        h("span", { className: "dshm-badge info" }, it.source === "npm" ? "npm" : "github"),
        h("span", { className: "dshm-spacer" }),
        h("button", { className: "dshm-btn sm", onClick: onClose }, "×"),
      ),
      it.community === true
        ? h(
            "div",
            { className: "dsvm-byline" },
            it.owner ? h("span", null, `by ${it.owner}`) : null,
            typeof it.stars === "number" ? h("span", { title: String(it.stars) }, `${compactCount(it.stars)} ★`) : null,
          )
        : null,
      h(LinksRow, { npm: it.npm, github: it.github, homepage: it.homepage }),
      h(
        "dl",
        { className: "dsvm-kv" },
        kv(lookup("modal.category"), catLabel),
        it.added ? kv(lookup("modal.added"), it.added) : null,
        it.community === true
          ? kv(
              lookup("modal.dlwindow"),
              typeof it.downloads === "number"
                ? `${compactCount(it.downloads)}（${it.downloadsStart || "?"} ~ ${it.downloadsEnd || "?"}${it.downloadsCheckedAt ? `，${lookup("modal.checkedat")} ${it.downloadsCheckedAt}` : ""}）`
                : lookup("modal.dlnone"),
            )
          : null,
        kv(lookup("detail.latest"), it.latestVersion ? `v${it.latestVersion}` : it.latestTag ? it.latestTag : it.latestSha ? it.latestSha : it.latestError ? (it.version ? lookup("sub.snapshot", { v: it.version }) : it.latestError) : "—"),
        kv(lookup("detail.installed"), it.installedPkg ? `${it.installedPkg} v${it.installedVersion || "?"}` : lookup("installed.none")),
        it.community !== true && Array.isArray(it.verified) && it.verified.length ? kv(lookup("modal.verified"), it.verified.join("、")) : null,
        (it.tags || []).length ? kv(lookup("modal.tags"), it.tags.join(", ")) : null,
        it.deprecated === true && it.replacement ? kv(lookup("modal.replacement"), it.replacement) : null,
      ),
      h("div", { className: "dshm-desc", style: { WebkitLineClamp: "unset" } }, descFull),
      shots.length
        ? h(
            "div",
            { className: "dsvm-shotrow" },
            ...shots.map((src, i) => h(Shot, { key: src, src, onClick: () => setLb(i) })),
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
      h(
        "details",
        { className: "dsvm-fold" },
        h("summary", null, lookup("modal.installcmd")),
        h("div", { className: "dsvm-cmdrow" },
          h("code", { className: "dsvm-code" }, installCmd),
          h("button", { className: "dshm-btn sm", onClick: copyCmd }, copied ? lookup("modal.copied") : lookup("modal.copy"))),
      ),
      h(
        "div",
        { className: "dsvm-modalactions" },
        it.installed
          ? h("span", { className: "dshm-hint" }, lookup("manage.hint"))
          : h("button", { className: "dshm-btn primary", disabled: busy, onClick: () => onInstall(it) }, busy ? h(Spin) : lookup("action.install")),
      ),
    ),
    lb !== null && shots.length ? h(Lightbox, { shots, index: lb, onNav: setLb, onClose: () => setLb(null) }) : null,
  );
}

// ---------- 市场页（数据由 MarketPanel 唯一持有，本组件只消费 props；0.7.0 Task 9 三分区 tab 壳） ----------
const ZONE_TABS = [
  { id: "community", labelKey: "zone.community" },
  { id: "primary", labelKey: "zone.primary" },
  { id: "favorites", labelKey: "zone.favorites" },
];

/** 社区区排序选项（0.7.0 Task 10）：downloads/stars/added × asc/desc，默认 downloads-desc。 */
const SORT_OPTIONS = [
  ["downloads-desc", "sort.downloads.desc"],
  ["downloads-asc", "sort.downloads.asc"],
  ["stars-desc", "sort.stars.desc"],
  ["stars-asc", "sort.stars.asc"],
  ["added-desc", "sort.added.desc"],
  ["added-asc", "sort.added.asc"],
];

function MarketTab({ notify, markets, onMutation, ops, favorites }) {
  const [zone, setZone] = useState("community");
  const market = zone === "favorites" ? null : markets[zone];
  const { data, loading, error, reload, query, updateQuery } = market || {};
  const [detailId, setDetailId] = useState(null);
  // 兼容确认弹窗状态（Task 18）：{ it, version, issue } | null——必须在 favorites 早退之前（hooks 规则）
  const [compatConfirm, setCompatConfirm] = useState(null);
  // CompatDialog 也是弹层：打开期间面板级 Esc 不关面板（审计 #4 同族）
  useModalDepth(compatConfirm != null);
  // busy 派生自操作记录（0.7.0 Task 13：状态不挂卡片）——首个进行中的 install
  const busyId = (ops.records.find((r) => r.kind === "install" && (r.status === "running" || r.status === "queued" || r.status === "input")) || {}).target || null;

  // 服务端分页数据（0.7.0 Task 8：服务端单一排序源，客户端不再重排）
  const items = (data && data.items) || [];
  const total = (data && data.total) || 0;
  const limit = (data && data.limit) || DEFAULT_PAGE_SIZE;
  const offset = (data && data.offset) || 0;
  const page = total > 0 ? Math.floor(offset / limit) + 1 : 1;
  const pages = total > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  const counts = (data && data.categoryCounts) || {};
  const notice = data ? marketNotice(data.registryState, data.community) : null;
  // 翻页：offset 定位 + 回滚列表顶部（吸顶 chips 行为锚点）
  const gotoPage = (p) => {
    updateQuery({ offset: Math.max(0, (p - 1) * limit) });
    if (typeof document !== "undefined") {
      const el = document.querySelector(".dsvm-chipswrap");
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
    }
  };
  const sortValue = `${(query && query.sort && query.sort.field) || "downloads"}-${(query && query.sort && query.sort.dir) || "desc"}`;
  const detailItem = detailId ? items.find((x) => x.id === detailId) : null;
  const detailLabels = (data && data.community && data.community.categoryLabels) || {};
  const zoneBar = h(
    "div",
    { className: "dshm-chips" },
    ...ZONE_TABS.map((z) => {
      // 计数固定取各自分区自身的数据（修复：不再用当前激活 zone 的 total 冒充）
      const zCount =
        z.id === "community"
          ? (markets.community.data && markets.community.data.total) || 0
          : z.id === "primary"
            ? (markets.primary.data && markets.primary.data.total) || 0
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
  // 收藏区（0.7.0 Task 14：本地 localStorage 收藏 + stale 校验清理）
  if (zone === "favorites") {
    return h(
      React.Fragment,
      null,
      zoneBar,
      h(FavoriteZone, { favorites }),
    );
  }

  const installDone = (res) => {
    notify({
      kind: "ok",
      needsRestart: true,
      text: lookup("notify.installed", { pkg: res.pkg, version: res.version ? ` v${res.version}` : "" }) +
        (res.buildApprovals && res.buildApprovals.length ? lookup("notify.builds", { names: res.buildApprovals.join(", ") }) : res.fallbackAllBuilds ? lookup("notify.builds.fallback") : "") +
        (res.bundleWarning === "no-patch-layer" ? lookup("notify.bundlewarning") : ""),
    });
  };

  const doInstall = async (it, version, forceIncompatible, reuseOpId) => {
    try {
      const res = await ops.runOp(
        "install",
        it.id,
        () => api("install", { id: it.id, ...(version ? { version } : {}), ...(forceIncompatible ? { forceIncompatible: true } : {}) }),
        { version, npm: it.npm, github: it.github }, // 审计 #6：meta 携带 npm 供 stillApplies 比对
        reuseOpId, // 审计 #12：确认/重试复用同一记录，不再新开
      );
      installDone(res);
      await (onMutation ? onMutation() : reload(false));
    } catch (e) {
      if (e && e.opSuperseded) {
        notify({ kind: "ok", text: lookup("op.superseded.note", { target: it.name }) });
      } else if (e && e.guard) {
        // 装后守卫拦截（M2 Task 3）：无 force 通道；一键重启只读 restartSafe
        notify({
          kind: "err",
          text: [
            lookup("guard.blocked"),
            `${lookup("guard.compstatus")}: ${e.guard.compensation?.status || "—"}（${e.guard.compensation?.note || ""}）`,
            e.guard.repairBasis ? `${lookup("guard.repairbasis")}: ${e.guard.repairBasis}` : null,
            lookup("guard.noforce"),
            e.guard.restartSafe ? lookup("guard.restartsafenow") : lookup("guard.restartunsafe"),
          ].filter(Boolean).join(" | "),
        });
      } else if (e && e.issue) {
        // peer 预检拦截 → 弹「仍要安装」确认（确认后带 force 重发；复用原记录 id——审计 #12）
        setCompatConfirm({ it, version, issue: e.issue, opId: e.opId });
      } else {
        notify({ kind: "err", text: lookup("failed.install", { err: (e && e.message) || e }) });
      }
    }
  };

  const CompatDialog = compatConfirm
    ? h(
        "div",
        { className: "dshm-compat-overlay", onClick: () => setCompatConfirm(null) },
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

  return h(
    React.Fragment,
    null,
    CompatDialog,
    zoneBar,
    notice
      ? h("div", { className: notice.key === "notice.unavailable" ? "dshm-err" : "dshm-hint" },
          lookup(notice.key, { count: notice.count }))
      : null,
    notice && notice.communityFallback ? h("div", { className: "dshm-hint" }, lookup("community.fallback")) : null,
    notice && notice.communityStale ? h("div", { className: "dshm-hint" }, lookup("community.stale")) : null,
    h(
      "div",
      { className: "dshm-row" },
      h(SearchBox, { key: zone, placeholder: lookup("search.ph"), initial: query.query, onCommit: (v) => updateQuery({ query: v }) }),
      h("button", { className: "dshm-btn", onClick: () => reload(true), title: lookup("settings.policy.v") }, loading ? Spin() : `↻ ${lookup("common.refresh")}`),
    ),
    zone === "community"
      ? h(
          "div",
          { className: "dsvm-sortrow" },
          h(
            "select",
            {
              className: "dsvm-sort",
              value: sortValue,
              onChange: (e) => {
                const [field, dir] = e.target.value.split("-");
                updateQuery({ sort: { field, dir } });
              },
            },
            ...SORT_OPTIONS.map(([v, key]) => h("option", { key: v, value: v }, lookup(key))),
          ),
        )
      : null,
    h(ZoneChips, {
      zone,
      counts,
      labels: (data && data.community && data.community.categoryLabels) || {},
      active: query.category,
      onPick: (id) => updateQuery({ category: id, offset: 0 }),
    }),
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
                    busyId === it.id ? h("span", { className: "dshm-badge warn", key: "busy" }, lookup("op.status.running")) : null,
                    it.deprecated === true ? h("span", { className: "dshm-badge warn", key: "dep" }, lookup("badge.deprecated")) : null,
                    it.community !== true && Array.isArray(it.verified) && it.verified.length ? h("span", { className: "dshm-badge", key: "v", title: it.verified.join("、") }, lookup("badge.verified")) : null,
                    it.outdated ? h("span", { className: "dshm-badge warn", key: "u" }, lookup("badge.update")) : null,
                    it.installed ? h("span", { className: "dshm-badge", key: "i" }, lookup("badge.installed")) : null,
                    it.community === true ? h("span", { className: "dshm-badge info", key: "c" }, lookup("badge.community")) : null,
                    h("span", { className: "dshm-badge info", key: "s" }, it.source === "npm" ? "npm" : "github"),
                  ],
                  byline: it.community === true
                    ? [
                        it.owner ? { text: `by ${it.owner}` } : null,
                        typeof it.downloads === "number" ? { text: `${compactCount(it.downloads)} ↓`, title: String(it.downloads) } : null,
                        typeof it.stars === "number" ? { text: `${compactCount(it.stars)} ★`, title: String(it.stars) } : null,
                      ].filter(Boolean)
                    : (it.tags || []).map((t) => ({ text: `#${t}` })),
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
                })),
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
                    h(
                      "select",
                      {
                        className: "dsvm-sort",
                        value: String(limit),
                        onChange: (e) => updateQuery({ limit: Number(e.target.value), offset: 0 }),
                      },
                      ...MARKET_PAGE_SIZES.map((n) => h("option", { key: n, value: String(n) }, lookup("market.pagesize", { n }))),
                    ),
                  )
                : null,
            ),
    detailItem
      ? h(DetailModal, {
          it: detailItem,
          labels: detailLabels,
          busy: busyId === detailItem.id,
          onClose: () => setDetailId(null),
          onInstall: (it2) => doInstall(it2),
        })
      : null,
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

// ---------- 已装页 ----------
function InstalledTab({ notify, installed, onMutation, ops }) {
  const { loading, data, error, reload } = installed;
  const [openPkg, setOpenPkg] = useState(null);
  const [readmePkg, setReadmePkg] = useState(null);
  // busy 派生自操作记录（0.7.0 Task 13）——首个进行中的非 install 操作
  const busyPkg = (ops.records.find((r) => r.kind !== "install" && (r.status === "running" || r.status === "queued" || r.status === "input")) || {}).target || null;

  const doToggle = async (it, enabled) => {
    const call = () => api("set-enabled", { pkg: it.pkg, enabled });
    try {
      let res;
      try {
        res = await ops.runOp("toggle", it.pkg, call, { on: enabled });
      } catch (first) {
        if (first && first.opSuperseded) throw first;
        // hmr 重组窗口可能瞬断传输（set-enabled 幂等，重试一次安全）；复用原记录（审计 #12）
        await new Promise((r) => setTimeout(r, 1500));
        res = await ops.runOp("toggle", it.pkg, call, { on: enabled }, first && first.opId);
      }
      const note = toggleNoticeKeys(res);
      const extra = (res.warnings && res.warnings.length ? `（${res.warnings.join("；")}）` : "");
      notify({ kind: "ok", needsRestart: note.needsRestart, text: lookup(note.textKey, note.params) + extra });
      await (onMutation ? onMutation() : reload());
    } catch (e) {
      if (e && e.opSuperseded) {
        notify({ kind: "ok", text: lookup("op.superseded.note", { target: it.pkg }) });
      } else {
        notify({ kind: "err", text: lookup("toggle.failed", { err: (e && e.message) || e }) });
      }
    }
  };

  const doUninstall = async (it) => {
    try {
      const res = await ops.runOp("uninstall", it.pkg, () => api("uninstall", { pkg: it.pkg }));
      notify({
        kind: "ok",
        needsRestart: true,
        text: lookup("notify.uninstalled", { pkg: res.pkg }) +
          (res.liveDisabled ? lookup("notify.livedisabled") : "") +
          (res.leftovers && res.leftovers.length ? lookup("notify.leftovers", { paths: res.leftovers.join(", ") }) : ""),
      });
      await (onMutation ? onMutation() : reload());
    } catch (e) {
      if (e && e.opSuperseded) {
        notify({ kind: "ok", text: lookup("op.superseded.note", { target: it.pkg }) });
      } else {
        notify({ kind: "err", text: lookup("failed.uninstall", { err: (e && e.message) || e }) });
      }
    }
  };

  const doUpgrade = async (it) => {
    try {
      const res = await ops.runOp("upgrade", it.pkg, () => api("upgrade", { pkg: it.pkg }));
      notify({
        kind: "ok",
        needsRestart: true,
        text: lookup("notify.upgraded", {
          pkg: res.pkg,
          from: res.fromVersion ? `v${res.fromVersion}` : "—",
          to: res.version ? `v${res.version}` : res.sha ? res.sha.slice(0, 7) : "latest",
        }) + (res.buildApprovals && res.buildApprovals.length ? lookup("notify.builds", { names: res.buildApprovals.join(", ") }) : res.fallbackAllBuilds ? lookup("notify.builds.fallback") : ""),
      });
      await (onMutation ? onMutation() : reload());
    } catch (e) {
      if (e && e.guard) {
        notify({
          kind: "err",
          text: [
            lookup("guard.blocked"),
            `${lookup("guard.compstatus")}: ${e.guard.compensation?.status || "—"}（${e.guard.compensation?.note || ""}）`,
            e.guard.repairBasis ? `${lookup("guard.repairbasis")}: ${e.guard.repairBasis}` : null,
            lookup("guard.noforce"),
            e.guard.restartSafe ? lookup("guard.restartsafenow") : lookup("guard.restartunsafe"),
          ].filter(Boolean).join(" | "),
        });
      } else if (e && e.opSuperseded) {
        notify({ kind: "ok", text: lookup("op.superseded.note", { target: it.pkg }) });
      } else {
        notify({ kind: "err", text: lookup("failed.upgrade", { err: (e && e.message) || e }) });
      }
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
    items.some((x) => x && x.outdated)
      ? h(
          "div",
          { className: "dsvm-sortrow" },
          h(
            "button",
            {
              className: "dshm-btn primary sm",
              disabled: busyPkg != null,
              onClick: () => {
                // 全部入队（0.7.0 Task 15）：逐条 runOp 记录，后端 Profile 变更事务 FIFO 保证串行
                for (const it of items.filter((x) => x && x.outdated)) void doUpgrade(it);
              },
            },
            lookup("installed.upgradeAll", { n: items.filter((x) => x && x.outdated).length }),
          ),
        )
      : null,
    busyPkg ? h(ProgressLine, { key: "prog" }) : null,
    h(
      "div",
      { className: "dshm-cards" },
      items.map((it) => {
        const vm = installedViewModel(it);
        const tvm = toggleViewModel(it);
        return Card({
          key: it.pkg,
          icon: h(Icon, { entry: { name: it.name, github: vm.githubRepo, icon: null } }),
          name: it.name,
          topRight: h(ToggleSwitch, {
            vm: tvm,
            disabled: busyPkg === it.pkg,
            onChange: (enabled) => doToggle(it, enabled),
          }),
          badges: [
            it.outdated ? h("span", { className: "dshm-badge warn", key: "u" }, `⬆ ${vm.latestLabel}`.trim()) : null,
            it.community === true
              ? h("span", { className: "dshm-badge info", key: "r" }, lookup("badge.community"))
              : it.registryId
                ? h("span", { className: "dshm-badge", key: "r" }, lookup("badge.market"))
                : h("span", { className: "dshm-badge info", key: "r" }, lookup("badge.nonmarket")),
          ],
          desc: it.description || "（无描述）",
          sub: [
            h(PhaseDot, { key: "dot", vm: tvm }),
            vm.phaseKey ? lookup(vm.phaseKey) : lookup(vm.enabledLabelKey),
            `v${it.version || "?"}`,
            vm.sourceLabelKey ? lookup(vm.sourceLabelKey) : it.source,
            vm.latestIssue ? lookup("installed.check.incomplete") : null,
          ]
            .filter(Boolean)
            .map((part, i) => (i === 0 ? part : [" · ", part]))
            .flat(),
          links: h(LinksRow, {
            npm: it.source === "npm" ? it.pkg : null,
            github: vm.githubRepo,
          }),
          open: openPkg === it.pkg,
          onToggle: () => setOpenPkg(openPkg === it.pkg ? null : it.pkg),
          detail: readmePkg === it.pkg
            ? h(ReadmeBlock, { pkg: it.pkg })
            : DetailRows([
                [lookup("detail.pkg"), it.pkg],
                [lookup("detail.spec"), it.spec],
                [lookup("detail.latest"), vm.latestLabelDetail],
                [lookup("detail.listed"), it.registryId || lookup("detail.listed.no")],
                [lookup("detail.path"), it.path],
                vm.latestIssue ? [lookup("installed.check.incomplete"), vm.latestIssue.note] : null,
                vm.guard.warnKey ? [lookup("detail.note"), lookup(vm.guard.warnKey, vm.guard.warnParams)] : null,
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
              confirmLabel: lookup(vm.guard.confirmKey),
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
  const key = registrySourceKey(data);
  return key === null ? "—" : lookup(key);
}

function configStatusLabel(status) {
  return lookup(`settings.status.${status || "loading"}` || "settings.status.loading");
}

const STATUS_BADGE = { ready: "", pending: "info", rejected: "warn", unavailable: "err", loading: "info" };

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
  // 设置页社区 summary 数据源 = registry 响应（Task 6 契约：registry 分支携带 community）
  const communitySummary = reg.data && reg.data.community && typeof reg.data.community === "object" ? reg.data.community : null;
  const communityRows = communitySummary && (communitySummary.status === "ready" || communitySummary.status === "stale")
    ? [
        [lookup("settings.community.status"), communitySummary.status === "stale" ? lookup("community.stale") : lookup("settings.status.ready")],
        [lookup("settings.community.version"), communitySummary.version || "—"],
        [lookup("settings.community.route"), communitySummary.route || "—"],
        [lookup("settings.community.accepted"), `${communitySummary.acceptedCount} / ${communitySummary.upstreamCount ?? "—"}`],
        [lookup("settings.community.displaced"), String(communitySummary.displaced ?? 0)],
      ]
    : [[lookup("settings.community.status"), lookup("settings.community.none")]];

  return h(
    React.Fragment,
    null,
    Section(lookup("settings.community"),
      ...communityRows.map(([k, v]) => h("div", { key: k, className: "dshm-row", style: { justifyContent: "space-between" } },
        h("span", { className: "dshm-hint" }, k),
        h("span", null, v))),
      communitySummary && Array.isArray(communitySummary.errors) && communitySummary.errors.length
        ? h("div", { className: "dshm-err" }, communitySummary.errors.join("；"))
        : null,
    ),
    Section(lookup("settings.registry"),
      h("div", { className: "dshm-row", style: { flexDirection: "column", alignItems: "stretch", gap: "4px" } },
        h("input", {
          className: "dshm-input",
          placeholder: lookup("settings.address.ph"),
          value: draftAddress ?? "",
          onChange: (e) => setDraftAddress(e.target.value),
          spellcheck: "false",
        }),
        h("div", { className: "dshm-note" }, lookup("settings.address.hint")),
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
        h("span", { className: "k" }, lookup("settings.configured")),
        h("span", null, snap.registryUrl ? h("span", { className: "dshm-code" }, snap.registryUrl) : h("span", { className: "dshm-hint" }, "（默认）")),
        h("span", { className: "k" }, lookup("settings.activecfg")),
        h("span", null, snap.activeConfigAddress ? h("span", { className: "dshm-code" }, snap.activeConfigAddress) : h("span", { className: "dshm-hint" }, "（默认）")),
        h("span", { className: "k" }, lookup("settings.status.label")),
        h("span", null, h("span", { className: `dshm-badge ${STATUS_BADGE[snap.configStatus] || ""}` }, configStatusLabel(snap.configStatus))),
        h("span", { className: "k" }, lookup("settings.effective")),
        h("span", null, regSourceLabel(state), state && !state.isDefault ? h("span", { className: "dshm-badge info", style: { marginLeft: "6px" } }, lookup("badge.custom")) : null),
        h("span", { className: "k" }, lookup("settings.updated")), h("span", null, fmtDate(state && state.fetchedAt)),
        h("span", { className: "k" }, lookup("settings.count")), h("span", null, state ? lookup("settings.count.v", { n: state.count ?? 0 }) : "—"),
        h("span", { className: "k" }, lookup("settings.policy")), h("span", null, lookup("settings.policy.v")),
      ),
      state && state.stale && state.status !== "unavailable"
        ? h("div", { className: "dshm-note" }, lookup("settings.cache.hint"))
        : null,
      state && !state.isDefault
        ? h("div", { className: "dshm-note warn" }, lookup("settings.trust.hint"))
        : null,
      snap.warnings && snap.warnings.length
        ? h("div", { className: "dshm-note warn" }, `${lookup("settings.warnings")}：${snap.warnings.join("；")}`)
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
              : h("div", { className: "dshm-note" }, lookup("settings.diagnose.none")),
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
      if (e && e.guard) {
        notify({
          kind: "err",
          text: [
            lookup("guard.blocked"),
            `${lookup("guard.compstatus")}: ${e.guard.compensation?.status || "—"}（${e.guard.compensation?.note || ""}）`,
            e.guard.repairBasis ? `${lookup("guard.repairbasis")}: ${e.guard.repairBasis}` : null,
            lookup("guard.noforce"),
            e.guard.restartSafe ? lookup("guard.restartsafenow") : lookup("guard.restartunsafe"),
          ].filter(Boolean).join(" | "),
        });
      } else {
        notify({ kind: "err", text: lookup("failed.selfupdate", { err: (e && e.message) || e }) });
      }
    } finally {
      setUpgrading(false);
    }
  }
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
function Card({ icon, name, badges, desc, sub, links, open, onToggle, detail, actions, topRight, byline, clampLines }) {
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
      h("div", { className: "dshm-top" }, h("span", { className: "dshm-name" }, name), ...badges.filter(Boolean), topRight || null),
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

// ---------- 收藏区（0.7.0 Task 14：本地快照卡片 + stale 校验 + 一键清理） ----------
function snapshotOf(it) {
  const s = {
    id: it.id,
    name: it.name,
    description: it.description,
    category: it.category,
    categoryLabel: it.categoryLabel,
    source: it.source,
  };
  for (const k of ["descriptionEn", "npm", "github", "homepage", "owner", "downloads", "stars", "added", "deprecated"]) {
    if (it[k] !== undefined && it[k] !== null) s[k] = it[k];
  }
  return s;
}

function FavoriteZone({ favorites }) {
  const list = favorites.list;
  const [check, setCheck] = useState(null); // { staleIds: string[] } | null
  useEffect(() => {
    let live = true;
    setCheck(null);
    if (!list.length) return;
    // 审计 #15：800ms debounce 合并突变（快速 toggle 不逐次全量重查）；
    // toggle 引发的重查保留——顺带校验新收藏是否刚收录就已下架
    const timer = setTimeout(() => {
      void (async () => {
        // stale 判定 = listMarket id 精确查询的结果集成员判定（Task 3 保证 id 整串精确命中）
        const lookupLive = async (fav) => {
          try {
            const res = await api("market", { query: fav.id, source: "all", limit: 8 });
            const items = res && Array.isArray(res.items) ? res.items : [];
            return items.some((x) => x && x.id === fav.id);
          } catch {
            return false;
          }
        };
        const { stale } = await partitionStale(list, lookupLive);
        if (live) setCheck({ staleIds: stale.map((f) => f.id) });
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
        const s = fav.snapshot;
        const isStale = staleSet.has(fav.id);
        return Card({
          key: fav.id,
          icon: h(Icon, { entry: s }),
          name: s.name,
          badges: [
            s.deprecated === true ? h("span", { className: "dshm-badge warn", key: "dep" }, lookup("badge.deprecated")) : null,
            s.owner ? h("span", { className: "dshm-badge info", key: "c" }, lookup("badge.community")) : null,
            h("span", { className: "dshm-badge info", key: "s" }, s.source === "npm" ? "npm" : "github"),
            isStale ? h("span", { className: "dshm-badge warn", key: "st" }, lookup("favorites.stalebadge")) : null,
          ],
          byline: s.owner
            ? [
                s.owner ? { text: `by ${s.owner}` } : null,
                typeof s.downloads === "number" ? { text: `${compactCount(s.downloads)} ↓`, title: String(s.downloads) } : null,
                typeof s.stars === "number" ? { text: `${compactCount(s.stars)} ★`, title: String(s.stars) } : null,
              ].filter(Boolean)
            : null,
          desc: s.description,
          clampLines: 5,
          links: h(LinksRow, { npm: s.npm, github: s.github, homepage: s.homepage }),
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

// ---------- 全局操作记录（0.7.0 Task 13 + 审计碰撞修正） ----------
/** 模块级单例（审计碰撞·洞1）：per-hook 实例会让关面板后的旧 runOp 闭包与新面板各自
 *  全量 persist 互相覆盖丢记录——排队窗口越长越恶性。 */
const opsStore = createOperationsStore(typeof window !== "undefined" && window.localStorage ? window.localStorage : null);

/** 会话内执行器与 waiters（按记录 id；恢复记录无执行器，走 ctx.dispatchRestored）。 */
const opsExecutors = new Map();
const opsWaiters = new Map();
let opsPumpRunning = false;
/** 泵上下文（MarketPanel 渲染时注册；卸载置空——记录本体持久在 localStorage）。 */
let opsPumpCtx = null;

/**
 * 单一执行泵（审计碰撞·洞2/3/4）：queued→running→终态 FIFO；恢复与前台共用同一条执行路径
 * （独立的 drainRestored 循环退役，杜绝两个循环双 dispatch 同一条 queued）。
 * - 洞2：waiters 持有 dispatch 抛出的**原始 Error 引用**（附 opId）——调用方 catch 读
 *   e.guard/e.issue 不受 record.error 字符串化影响；
 * - 洞4：取队首用同步 store.list()，判空到退出之间不插任何 await；
 * - dispatch 前统一 stillApplies 实读校验（恢复与前台无差别）；前提消失 → superseded
 *   （良性，中性呈现），前台调用方经 e.opSuperseded 分支消化。
 */
async function runOpsPump() {
  if (opsPumpRunning) return;
  opsPumpRunning = true;
  try {
    for (;;) {
      const queued = opsStore.list().find((r) => r.status === "queued"); // 同步取队首（洞4）
      if (!queued) break;
      const waiters = opsWaiters.get(queued.id);
      const executor = opsExecutors.get(queued.id);
      opsWaiters.delete(queued.id);
      opsExecutors.delete(queued.id);
      const finalize = (patch) => {
        opsStore.upsert({ id: queued.id, ...patch });
        if (opsPumpCtx) opsPumpCtx.syncOps();
      };
      if (opsPumpCtx && opsPumpCtx.stillApplies) {
        let applies = true;
        try {
          applies = await opsPumpCtx.stillApplies(queued);
        } catch {
          applies = false;
        }
        if (!applies) {
          finalize({ status: "superseded", error: "执行时前提消失（已手动处理？）" });
          if (waiters) {
            waiters.reject(Object.assign(new Error("op superseded"), { opSuperseded: true, opId: queued.id }))
          }
          continue;
        }
      }
      opsStore.upsert({ id: queued.id, status: "running" });
      if (opsPumpCtx) opsPumpCtx.syncOps();
      let value
      let err = null
      try {
        if (executor) {
          value = await executor.exec()
        } else if (opsPumpCtx) {
          const r = await opsPumpCtx.dispatchRestored(queued)
          if (!r || !r.ok) err = Object.assign(new Error((r && r.error) || "unknown"), r && r.issue ? { issue: r.issue } : {})
        } else {
          err = new Error("无执行上下文（面板未挂载）")
        }
      } catch (e) {
        err = e
      }
      if (!err) {
        finalize({ status: value && value.opWarning ? "warned" : "done", warning: value && value.opWarning })
        if (waiters) waiters.resolve(value)
      } else {
        const isInput = Boolean(err.issue) // 恢复遇 peer 冲突 → input（待决，面板可见后手动重发）
        finalize(isInput ? { status: "input", inputKind: "peer-incompatible" } : { status: "failed", error: String(err.message || err) })
        err.opId = queued.id // 洞2：原始错误保真传递
        if (waiters) waiters.reject(err)
      }
    }
  } finally {
    opsPumpRunning = false
  }
}

const OP_STATUS_CLS = {
  queued: "", running: "run", input: "warn", done: "ok", warned: "warn", failed: "err", superseded: "sup",
};

function OperationsPanel({ records, onClearFinished }) {
  const active = records.filter((r) => r.status === "queued" || r.status === "running" || r.status === "input");
  const finished = records.filter((r) => active.indexOf(r) < 0).slice(-6);
  if (!active.length && !finished.length) return null;
  const row = (r) =>
    h(
      "div",
      { key: r.id, className: `dsvm-oprow ${OP_STATUS_CLS[r.status] || ""}` },
      h("span", { className: "dsvm-opstatus" }, lookup("op.status." + r.status)),
      h("span", { className: "dsvm-opkind" }, lookup("op.kind." + r.kind)),
      h("span", { className: "dsvm-optarget", title: r.error || r.warning || undefined }, r.target),
      r.status === "running" ? Spin() : null,
      r.error ? h("span", { className: "dsvm-opnote" }, r.error) : null,
      r.warning ? h("span", { className: "dsvm-opnote" }, r.warning) : null,
    );
  return h(
    "div",
    { className: "dsvm-ops" },
    active.length ? h("div", { className: "dsvm-opgroup" }, ...active.map(row)) : null,
    finished.length
      ? h(
          "div",
          { className: "dsvm-opgroup done" },
          ...finished.map(row),
          h("button", { className: "dshm-btn sm", onClick: onClearFinished }, lookup("op.clear")),
        )
      : null,
  );
}


// ---------- 面板（3 视图容器） ----------
const TABS = [
  ["market", "tab.market", "market"],
  ["installed", "tab.installed", "installed"],
  ["settings", "tab.settings", null],
];

// ---------- 头部 DSH 版本 chip（数据源 ping.dshVersion；hover 详情、点击复制） ----------
function DshVersionChip({ version }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(version);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板不可用（非安全上下文/权限）静默——chip 保持展示 */
    }
  };
  return h(
    "button",
    { type: "button", className: "dshm-dshchip", onClick: copy, "aria-label": `DSH ${version}` },
    "DSH ",
    h("span", { className: "dshm-dshchip-v" }, version),
    h(
      "span",
      { className: "dshm-dshchip-tip", role: "tooltip" },
      h("span", { className: "dshm-dshchip-tiprow" }, `DSH ${version}`),
      h("span", { className: "dshm-dshchip-tipsub" }, lookup(copied ? "dsh.chip.copied" : "dsh.chip.copyhint")),
    ),
  );
}

function MarketPanel({ onClose }) {
  const [tab, setTab] = useState("market");
  // 市场数据唯一 owner（0.7.0 Task 9：两分区独立状态实例，切 tab 互不重置；
  // 收藏区数据在 Task 14 落地，本地 localStorage 不走 market 通道）
  const marketCommunity = useMarketData("community");
  const marketPrimary = useMarketData("primary");
  const markets = { community: marketCommunity, primary: marketPrimary };
  const installed = useAsync(() => api("installed"), []);
  // 全局操作记录（0.7.0 Task 13 + 审计碰撞修正）：单例 store + 泵执行（queued 真实生命周期）
  const [opRecords, setOpRecords] = useState(() => opsStore.list().map((r) => ({ ...r })));
  const syncOps = useCallback(() => setOpRecords(opsStore.list().map((r) => ({ ...r }))), []);
  const runOp = useCallback(
    (kind, target, exec, meta = {}, reuseId) => {
      const stored = opsStore.upsert({ ...(reuseId ? { id: reuseId } : {}), kind, target, status: "queued", meta });
      syncOps();
      return new Promise((resolve, reject) => {
        opsWaiters.set(stored.id, { resolve, reject });
        opsExecutors.set(stored.id, { exec });
        void runOpsPump(); // 同步入队后立即泵（单线程无漏队）
      });
    },
    [syncOps],
  );
  /** 处置待决记录（CompatDialog 取消 → superseded「用户放弃」）。 */
  const disposeOp = useCallback((id, note) => {
    opsStore.upsert({ id, status: "superseded", error: note });
    syncOps();
  }, [syncOps]);
  const ops = { records: opRecords, runOp, dispose: disposeOp };
  // 收藏（0.7.0 Task 14）：本地 localStorage，不进 profile 不进服务端
  const favStoreRef = useRef(null);
  if (!favStoreRef.current) {
    favStoreRef.current = createFavoritesStore(typeof window !== "undefined" && window.localStorage ? window.localStorage : null);
  }
  const favStore = favStoreRef.current;
  const [favList, setFavList] = useState(() => favStore.list());
  const favorites = {
    list: favList,
    toggle: useCallback((snapshot) => setFavList(favStore.toggle(snapshot)), [favStore]),
    removeIds: useCallback((ids) => setFavList(favStore.removeIds(ids)), [favStore]),
  };
  // DSH 运行版本：挂载时随 ping 一次性带回；失败/缺席 → chip 整个隐藏（不留占位）
  const [dshVersion, setDshVersion] = useState(null);
  useEffect(() => {
    let live = true;
    api("ping")
      .then((r) => {
        if (live) setDshVersion(typeof r?.dshVersion === "string" && r.dshVersion ? r.dshVersion : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  // Registry 配置或任一 profile mutation 后，视图一起刷新，避免单页快照不同步（两分区同刷）。
  const marketReloadAll = useCallback(
    (force) => {
      marketCommunity.reload(force)
      marketPrimary.reload(force)
    },
    [marketCommunity.reload, marketPrimary.reload],
  )
  const refreshViews = useCallback(
    () => refreshAfterMutation({ marketReload: marketReloadAll, installedReload: installed.reload }),
    [marketReloadAll, installed.reload],
  );
  const onRegistryChanged = refreshViews;
  // 恢复/泵共用上下文（审计碰撞·洞3：单一执行路径）。stillApplies 一律执行时实读（禁止复用快照）。
  const stillApplies = useCallback(async (r) => {
    let fresh = null;
    try {
      fresh = await api("installed");
    } catch {
      fresh = null;
    }
    const items = fresh && Array.isArray(fresh.items) ? fresh.items : null;
    if (!items) return true; // 读不到已装数据：保守放行（泵 dispatch 前还会再校验）
    // 审计 #6：install 的 target 是收录 id，与 installed.pkg 不同名——同时比对 meta.npm
    const has = items.some((x) => x && (x.pkg === r.target || (r.meta && typeof r.meta.npm === "string" && x.pkg === r.meta.npm)));
    return r.kind === "install" ? !has : has;
  }, []);
  const dispatchRestored = useCallback(async (r) => {
    try {
      if (r.kind === "install") {
        await api("install", { id: r.target, ...(r.meta && r.meta.version ? { version: r.meta.version } : {}) });
      } else if (r.kind === "upgrade") {
        await api("upgrade", { pkg: r.target, ...(r.meta && r.meta.force ? { force: true } : {}) });
      } else if (r.kind === "uninstall") {
        await api("uninstall", { pkg: r.target });
      } else {
        await api("set-enabled", { pkg: r.target, enabled: r.meta && r.meta.on === true });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), ...(e && e.issue ? { issue: e.issue } : {}) };
    }
  }, []);
  useEffect(() => {
    opsPumpCtx = { stillApplies, dispatchRestored, syncOps, refreshViews };
    return () => {
      if (opsPumpCtx && opsPumpCtx.syncOps === syncOps) opsPumpCtx = null;
    };
  }, [stillApplies, dispatchRestored, syncOps, refreshViews]);
  // 恢复时序（0.7.0 Task 13）：installed resolve → restoreRecords（校验改标）→ 启动**同一个**前台泵
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !installed.data) return;
    restoredRef.current = true;
    void (async () => {
      const restored = await restoreRecords(opsStore.list(), stillApplies);
      opsStore.replaceAll(restored);
      syncOps();
      if (restored.some((r) => r.status === "queued")) {
        void runOpsPump(); // 洞3：恢复并入前台泵（单一执行路径；drainRestored 循环退役）
      }
    })();
  }, [installed.data, stillApplies, syncOps]);
  const counts = {
    market: marketCommunity.data ? marketCommunity.data.total : null,
    installed: installed.data ? installed.data.items.length : null,
  };
  // 更新红点（0.7.0 Task 15）：已装页存在 outdated 时已装 tab 打点
  const outdatedCount = installed.data && Array.isArray(installed.data.items)
    ? installed.data.items.filter((x) => x && x.outdated).length
    : 0;
  const [banner, setBanner] = useState(null); // { text } | null
  const [toast, setToast] = useState(null); // { kind, text } | null
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && dsvmModalDepth === 0 && onClose) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (!toast) return;
    // err 文案可能带回滚/自愈长报告，6s 读不完；ok 6s、err 15s
    const t = setTimeout(() => setToast(null), toast.kind === "err" ? 15000 : 6000);
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
              key === "installed" && outdatedCount > 0 ? h("span", { className: "dsvm-reddot", title: lookup("installed.upgradeAll", { n: outdatedCount }) }) : null,
            ),
          ),
        ),
        h("span", { className: "dshm-spacer" }),
        dshVersion ? h(DshVersionChip, { version: dshVersion }) : null,
        h("button", { className: "dshm-btn", onClick: onClose }, lookup("common.close")),
      ),
      h(
        "div",
        { className: "dshm-body" },
        tab === "market" ? h(MarketTab, { notify, markets, onMutation: refreshViews, ops, favorites }) : null,
        tab === "installed" ? h(InstalledTab, { notify, installed, onMutation: refreshViews, ops }) : null,
        tab === "settings" ? h(SettingsTab, { notify, onRegistryChanged }) : null,
        h(OperationsPanel, {
          records: opRecords,
          onClearFinished: () => {
            opsStore.clearFinished();
            syncOps();
          },
        }),
      ),
      toast
        ? h("div", { className: toast.kind === "err" ? "dshm-banner err" : "dshm-banner" },
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
  // 与 DSH 官方图标家族对齐：24 视箱 / strokeWidth 2 / 16px 渲染（Lucide layout-grid 构型）
  return h("svg", { viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", "aria-hidden": "true" },
    h("rect", { x: "3", y: "3", width: "7", height: "7", rx: "1", stroke: "currentColor", strokeWidth: "2" }),
    h("rect", { x: "14", y: "3", width: "7", height: "7", rx: "1", stroke: "currentColor", strokeWidth: "2" }),
    h("rect", { x: "3", y: "14", width: "7", height: "7", rx: "1", stroke: "currentColor", strokeWidth: "2" }),
    h("rect", { x: "14", y: "14", width: "7", height: "7", rx: "1", stroke: "currentColor", strokeWidth: "2" }),
  );
}

function MarketEntry(props) {
  useEffect(() => ensureCss(), []);
  const rail = !(props && props.wide);
  return h(
    "button",
    {
      className: rail ? "dshm-entry rail" : "dshm-entry",
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


function ToolCardRow({ it, onInstalled }) {
  const [busy, setBusy] = useState(false);
  const [guardNote, setGuardNote] = useState(null);
  const install = async (e) => {
    e.stopPropagation();
    setBusy(true);
    // 审计 #13 处置（碰撞建议）：对话区卡片直连 api 保留本地反馈，但顺手 upsert 一条记录——
    // 事后打开面板可见（纯写不读，单例 store 不依赖面板挂载）
    const rec = opsStore.upsert({ kind: "install", target: it.id, status: "running", meta: { npm: it.npm, github: it.github } });
    try {
      const res = await api("install", { id: it.id });
      opsStore.upsert({ id: rec.id, status: "done" });
      onInstalled({ ...it, installed: true, installedPkg: res.pkg, installedVersion: res.version });
    } catch (err) {
      // M2 Task 3：静默分支不再吞守卫拦截——工具卡片就地标注（对话区文本仍为主通道）
      opsStore.upsert({ id: rec.id, status: err && err.issue ? "input" : "failed", error: String((err && err.message) || err) });
      if (err && err.guard) {
        setGuardNote(`${lookup("guard.blocked")} · ${err.guard.compensation?.status || "—"} · ${lookup("guard.noforce")}`);
      }
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
      guardNote ? h("div", { className: "dshm-err" }, guardNote) : null,
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
