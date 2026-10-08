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

// 市场面板 pure state（Node tests 直接覆盖；0.7.0 Task 8 分区化：zone 状态工厂/页码窗口/分区 chips；0.9.25 跨区搜索：searchSourceOf）
const { DEFAULT_PAGE_SIZE, MARKET_PAGE_SIZES, pageItems, createZoneState, normalizeMarketQuery, resetPageOnFilterChange, normalizeMarketResponse, registryNotice, zoneChips, marketNotice, searchSourceOf, mergeLatestFields, chipRows, countBeyondRows, autoExpandDecision } = require("./market-state.js");
const { readMarketSnapshot, writeMarketSnapshot, isDefaultFirstPageQuery } = require("./market-snapshot.js");
const { backdropCloseHandlers } = require("./backdrop.js");
const { createMarkdown } = require("./markdown.js");
const { ExtLink, MdImg, renderMarkdown } = createMarkdown(h);
const { installedViewModel, registrySourceKey } = require("./installed-view.js");
const { toggleViewModel, toggleNoticeKeys } = require("./toggle-view.js");
const { pickPayload, parseToolArgs } = require("./tool-view.js");
const { RESTART_POLL_MS, RESTART_DEADLINE_MS, nextRestartWait, isAmbiguousRestartRequestError } = require("./restart-wait.js");
const { refreshAfterMutation } = require("./view-refresh.js");
const { applyInstalledUpdates, installedUpdateStats } = require("./installed-updates.js");
const { createOperationsStore, restoreRecords, createOpsPump, opAppliesTo, TERMINAL_CLEARABLE, upgradeNotify } = require("./operations.js");
const { createFavoritesStore, partitionStale } = require("./favorites.js");
const { readSelfCheckCache, writeSelfCheckCache, clearSelfCheckCache, deriveChipState } = require("./self-check.js");
const { shouldShowInstallCmd } = require("./install-cmd.js");

// ---------- i18n（skillhub 同款：host locale.register + client lookup + {param} 插值） ----------
const ZH = {
  "market.title": "插件市场",
  "tab.market": "市场", "tab.installed": "已装", "tab.settings": "设置",
  "cat.all": "全部", "cat.essentials": "装机必备", "cat.cui-picks": "崔添翼精选", "cat.self-dev": "iasi自研", "cat.tencent-lighthouse": "腾讯轻量云专区", "cat.watchlist": "观察区",
  "zone.community": "社区", "zone.primary": "精选", "zone.favorites": "收藏",
  "badge.deprecated": "已弃用", "sub.snapshot": "v{v}（目录快照）", "badge.verified": "已实测", "badge.internal": "作者自用", "badge.decoupled": "版本无关", "badge.decoupled.tip": "DSH 升级无需跟随适配",
  "modal.category": "分类", "modal.added": "收录日期", "modal.dlwindow": "下载量（30 天窗口）", "modal.checkedat": "核对于", "modal.dlnone": "无窗口数据",
  "modal.verified": "实测版本", "modal.tags": "标签", "modal.replacement": "已弃用 · 替代", "modal.installcmd": "安装命令", "modal.copy": "复制", "modal.copied": "已复制",
  "modal.audience.label": "受众", "modal.audience.value": "作者自用（不面向大众推广）", "modal.decoupled.label": "适配", "modal.decoupled.value": "版本无关（DSH 升级无需跟随适配）",
  "op.clear": "清除已结束", "op.clear.none": "没有可清除的已结束记录",
  "op.superseded.note": "{target} 已跳过（前提已不成立或已手动处理）", "op.cancelled": "用户放弃确认", "op.remove": "移除记录", "op.panel.jump": "查看操作面板",
  "op.kind.install": "安装", "op.kind.upgrade": "升级", "op.kind.uninstall": "卸载", "op.kind.toggle": "开关",
  "op.status.queued": "排队中", "op.status.running": "进行中", "op.status.input": "待决", "op.status.done": "完成", "op.status.warned": "带警告", "op.status.failed": "失败", "op.status.superseded": "已跳过",
  "favorites.hint": "还没有收藏——去社区/精选页点插件卡片右上角的 ☆ 收藏",
  "favorites.stale": "{n} 条收藏已从目录下架", "favorites.clean": "清理失效收藏", "favorites.checking": "校验收藏有效性中…", "favorites.stalebadge": "已下架",
  "fav.add": "收藏", "fav.remove": "取消收藏",
  "common.clear": "清空",
  "search.ph": "搜索名称 / 描述 / 标签（社区 + 精选）…",
  "common.refresh": "刷新", "common.close": "关闭", "common.later": "稍后", "common.ok": "知道了", "common.none": "—",
  "market.loading": "加载收录清单中… ", "market.empty": "无匹配插件，试试其他关键词或分类",
  "market.retry": "重试", "market.empty.category": "该分类暂无收录，换个桶或清空筛选看看", "market.empty.unavailable": "收录清单不可用，暂时无法列出插件",
  "chips.crossbucket.tip": "跨桶条目会在多个分类重复计数，故分类计数之和大于总数",
  "installed.loading": "读取已装列表中… ", "installed.empty": "当前 profile 尚未安装任何 dsh 插件", "installed.none": "未安装",
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
  "settings.registry": "精选清单（registry.json）", "settings.source": "当前来源", "settings.updated": "更新时间",
  "settings.count": "条目数", "settings.count.v": "{n}", "settings.remotehint": "远端提示",
  "settings.force": "强制刷新", "settings.about": "关于",
  "settings.about.text": "dsh-m 插件市场：「Awesome DSH Plugin」社区 + 「精选策展」的双清单分区市场，收录、安装、卸载、升级一站完成。",
  "settings.about.issues": "问题反馈", "settings.about.npm": "npm",
  "src.override": "自定义源", "src.jsdelivr": "GitHub 镜像（备用）", "src.raw": "raw.githubusercontent（@main）", "src.cache": "本地缓存", "src.bundled": "包内快照（兜底）",
  "src.default.raw": "GitHub 原始文件（@main）", "src.default.jsdelivr": "GitHub 镜像（备用）", "src.default.cache": "默认清单缓存",
  "src.custom.url": "自定义 URL 源", "src.custom.file": "本地文件源", "src.custom.cache": "自定义源（缓存）", "src.custom.unavailable": "自定义源（不可用）",
  "settings.address": "Registry 地址", "settings.address.default": "内置默认清单",
  "settings.note.custom": "自定义源将整体替换「精选清单」；条目格式可参照下载的默认清单。留空 = 使用内置默认清单。",
  "settings.address.ph": "https://example.com/registry.json 或 /path/to/registry.json",
  "settings.configured": "配置地址", "settings.effective": "生效来源",
  "settings.status.label": "配置状态", "settings.status.loading": "加载中", "settings.status.ready": "正常", "settings.status.pending": "待写入（校验已通过）", "settings.status.rejected": "已拒绝（保持旧配置）", "settings.status.unavailable": "不可用",
  "settings.apply": "校验并应用", "settings.apply.applying": "校验中…", "settings.apply.ok": "Registry 地址已生效（无需重启）", "settings.apply.failed": "应用失败：{err}",
  "settings.reset": "恢复默认", "settings.reset.ok": "已恢复默认收录清单",
  "settings.download": "下载默认清单", "settings.download.title": "下载默认 registry.json（可作自定义模板与格式参照）", "settings.download.downloading": "下载中…", "settings.download.ok": "默认清单已下载（当前配置不变）", "settings.download.failed": "下载失败：{err}",
  "settings.trust.hint": "⚠️ 自定义收录清单未经官方 CI 校验，条目来源请确认可信后再安装。",
  "settings.warnings": "维护提示",
  "notice.unavailable": "收录清单不可用 · 请到设置页检查地址",
  "pager.jump": "跳转", "pager.jump.ph": "页号",
  "panel.fullscreen": "全屏", "panel.restore": "还原",
  "filter.title": "筛选", "filter.sortfield": "排序字段", "filter.sortdir": "排列方向", "filter.pagesize": "每页条数",
  "filter.field.downloads": "npm 下载量（近 30 天）", "filter.field.stars": "Star 数", "filter.field.added": "收录日期",
  "filter.dir.desc": "降序", "filter.dir.asc": "升序",
  "market.page.prev": "上一页", "market.page.next": "下一页", "market.page.info": "第 {page} / {pages} 页 · 共 {total} 条",
  "notice.toolview.err": "收录清单暂不可用",
  "badge.community": "社区收录", "search.summary": "⭐ 精选 {n} · 社区 {m}",
  "community.fallback": "收录清单不可用，当前展示社区清单条目",
  "detail.capabilities": "能力披露", "detail.capabilities.unscanned": "未扫描 ≠ 未检出", "detail.redlines": "能力红线",
  "guard.blocked": "安装被装后守卫拦截", "guard.compstatus": "补偿终态", "guard.repairbasis": "修复依据",
  "guard.restartsafenow": "可以重启 DSH Web", "guard.restartunsafe": "修复后再重启（不要现在一键重启）",
  "guard.noforce": "守卫拦截无「仍要安装」通道，请按修复依据人工处理",
  "detail.screenshots": "截图", "installed.check.incomplete": "检查未完成",
  "settings.community": "社区清单（from awesome-dsh-plugin）", "settings.community.toggle": "社区目录开关",
  "settings.community.off": "社区目录已关闭：市场仅显示精选清单，重新开启即时生效。",
  "settings.community.on.ok": "社区目录已开启（即时生效）", "settings.community.off.ok": "社区目录已关闭（即时生效）",
  "settings.community.toggle.failed": "切换失败：{err}",
  "settings.community.status": "状态", "settings.community.status.stale": "缓存快照", "settings.community.version": "目录版本", "settings.community.route": "获取线路",
  "settings.community.count": "收录条目", "settings.community.count.v": "{n}（上游 {up}）",
  "settings.community.displaced": "与精选重复", "settings.community.displaced.v": "{n} 条",
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
  "notify.upgraded": "已升级 {pkg}（{from} → {to}）", "notify.upgraded.clientonly": "。纯客户端更新：刷新页面即可生效，无需重启", "notify.upgraded.activationUnknown": "。生效判定未完成：为确保生效请重启 DSH Web", "notify.upgradehint": "（注意：该插件执行了构建脚本）",
  "notify.selfupgraded": "dsh-m 已升级（v{from} → v{to}）", "notify.selfupgraded.failed": "dsh-m 升级失败：{err}",
  "failed.install": "安装失败：{err}", "failed.uninstall": "卸载失败：{err}", "failed.upgrade": "升级失败：{err}",
  "failed.load": "加载失败：{err}", "failed.read": "读取失败：{err}", "failed.open": "打开市场面板失败:",
  "banner.done": "变更完成，需要重启 DSH Web 后生效。",
  "restart.doing": "正在请求重启…", "restart.waiting": "已请求重启，等待 DSH Web 恢复…",
  "restart.now": "⚡ 一键重启", "restart.failed": "重启失败：{err}",
  "restart.timeout": "重启超时，请手动检查 dsh web 服务状态",
  "restart.hint.done": "已请求重启 DSH web（via {via}）。服务恢复后 DSH Web 会在后台自动重连。",
  "profile.restartHint": "变更完成。Desktop 插件由官方应用管理：请退出并重新打开 Desktop 应用（关闭窗口可能只是隐藏）以加载新状态。",
  "profile.chipTitle": "当前生效 Profile",
  "selfupdate.available": "发现新版本 v{v}，点击升级", "selfupdate.ahead": "本地开发版（领先 npm：v{v}）", "selfupdate.checking": "检查更新中…",
  "phase.resolving": "解析依赖", "phase.downloading": "下载", "phase.linking": "链接安装", "phase.building": "构建脚本", "phase.ready": "准备中",
  "readme.show": "📖 README", "readme.hide": "收起 README", "readme.loading": "加载 README… ", "readme.none": "（该插件没有 README）",
  "readme.truncated": "…（超过 64KB 已截断，完整内容见插件目录）",
  "warn.unlink": "卸载只移除 profile 对本地目录的引用（{path}），不会删除目录本身。",
  "warn.core": "这是 file: 安装的核心/归档包，卸载可能影响 DSH 功能，且需要手动恢复。",
  "profile.hint": "profile：{path}",
  "title.panel": "插件市场", "title.full": "DeepSeek Harness 插件市场",
};
const EN = {
  "market.title": "Plugin Marketplace",
  "tab.market": "Market", "tab.installed": "Installed", "tab.settings": "Settings",
  "cat.all": "All", "cat.essentials": "Essentials", "cat.cui-picks": "Cui Picks", "cat.self-dev": "iasi Self-dev", "cat.tencent-lighthouse": "Tencent Lighthouse", "cat.watchlist": "Watchlist",
  "zone.community": "Community", "zone.primary": "Curated", "zone.favorites": "Favorites",
  "badge.deprecated": "Deprecated", "sub.snapshot": "v{v} (catalog snapshot)", "badge.verified": "Verified", "badge.internal": "Author's own", "badge.decoupled": "Version-independent", "badge.decoupled.tip": "Survives DSH upgrades without per-release adaptation",
  "modal.category": "Category", "modal.added": "Added", "modal.dlwindow": "Downloads (30-day window)", "modal.checkedat": "checked at", "modal.dlnone": "No window data",
  "modal.verified": "Verified runtimes", "modal.tags": "Tags", "modal.replacement": "Deprecated · replacement", "modal.installcmd": "Install command", "modal.copy": "Copy", "modal.copied": "Copied",
  "modal.audience.label": "Audience", "modal.audience.value": "Author's own (not for general promotion)", "modal.decoupled.label": "Compat", "modal.decoupled.value": "Version-independent (no per-release adaptation)",
  "op.clear": "Clear ended", "op.clear.none": "Nothing finished to clear",
  "op.superseded.note": "{target} skipped (precondition gone or already handled)", "op.cancelled": "user cancelled", "op.remove": "Dismiss", "op.panel.jump": "Open operations panel",
  "op.kind.install": "Install", "op.kind.upgrade": "Upgrade", "op.kind.uninstall": "Uninstall", "op.kind.toggle": "Toggle",
  "op.status.queued": "Queued", "op.status.running": "Running", "op.status.input": "Pending", "op.status.done": "Done", "op.status.warned": "Warned", "op.status.failed": "Failed", "op.status.superseded": "Skipped",
  "favorites.hint": "No favorites yet — tap ☆ on a plugin card in Community/Curated to bookmark it",
  "favorites.stale": "{n} favorites no longer in the catalog", "favorites.clean": "Clean up stale favorites", "favorites.checking": "Checking favorites…", "favorites.stalebadge": "Delisted",
  "fav.add": "Bookmark", "fav.remove": "Remove bookmark",
  "common.clear": "Clear",
  "search.ph": "Search all plugins — name, description, tags…",
  "common.refresh": "Refresh", "common.close": "Close", "common.later": "Later", "common.ok": "OK", "common.none": "—",
  "market.loading": "Loading listings… ", "market.empty": "No matching plugins — try another keyword or category",
  "market.retry": "Retry", "market.empty.category": "Nothing curated in this category yet — try another bucket or clear the filter", "market.empty.unavailable": "Registry unavailable — listings are temporarily down",
  "chips.crossbucket.tip": "Cross-bucket entries count in every bucket, so chip counts add up above the total",
  "installed.loading": "Reading installed list… ", "installed.empty": "No DSH plugins installed in this profile", "installed.none": "Not installed",
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
  "settings.registry": "Curated registry (registry.json)", "settings.source": "Source", "settings.updated": "Updated",
  "settings.count": "Listings", "settings.count.v": "{n}", "settings.remotehint": "Remote notice",
  "settings.force": "Force refresh", "settings.about": "About",
  "settings.about.text": "The DeepSeek Harness plugin marketplace — a zoned dual-catalog market of the \"Awesome DSH Plugin\" community plus a curated registry; install, uninstall and upgrade in one place.",
  "settings.about.issues": "Issues", "settings.about.npm": "npm",
  "src.override": "Custom source", "src.jsdelivr": "GitHub mirror (backup)", "src.raw": "raw.githubusercontent (@main)", "src.cache": "Local cache", "src.bundled": "Bundled snapshot (fallback)",
  "src.default.raw": "GitHub raw (@main)", "src.default.jsdelivr": "GitHub mirror (backup)", "src.default.cache": "Default registry cache",
  "src.custom.url": "Custom URL source", "src.custom.file": "Local file source", "src.custom.cache": "Custom source (cache)", "src.custom.unavailable": "Custom source (unavailable)",
  "settings.address": "Registry address", "settings.address.default": "Built-in default registry",
  "settings.note.custom": "A custom source replaces the whole Curated registry; use the downloaded default registry as the format reference. Leave empty for the built-in default.",
  "settings.address.ph": "https://example.com/registry.json or /path/to/registry.json",
  "settings.configured": "Configured address", "settings.effective": "Effective source",
  "settings.status.label": "Config status", "settings.status.loading": "Loading", "settings.status.ready": "Online", "settings.status.pending": "Pending write (validated)", "settings.status.rejected": "Rejected (previous config kept)", "settings.status.unavailable": "Unavailable",
  "settings.apply": "Validate & apply", "settings.apply.applying": "Validating…", "settings.apply.ok": "Registry address applied (no restart needed)", "settings.apply.failed": "Apply failed: {err}",
  "settings.reset": "Restore default", "settings.reset.ok": "Restored to the default registry",
  "settings.download": "Download default registry", "settings.download.title": "Download the default registry.json (a template and format reference for custom registries)", "settings.download.downloading": "Downloading…", "settings.download.ok": "Default registry downloaded (current config unchanged)", "settings.download.failed": "Download failed: {err}",
  "settings.trust.hint": "⚠️ Custom registries are not validated by official CI. Only install entries from sources you trust.",
  "settings.warnings": "Maintenance notice",
  "notice.unavailable": "Registry unavailable · check the address in Settings",
  "pager.jump": "Go", "pager.jump.ph": "Page",
  "panel.fullscreen": "Fullscreen", "panel.restore": "Restore",
  "filter.title": "Filter", "filter.sortfield": "Sort by", "filter.sortdir": "Direction", "filter.pagesize": "Per page",
  "filter.field.downloads": "npm downloads (30-day)", "filter.field.stars": "Stars", "filter.field.added": "Date added",
  "filter.dir.desc": "Descending", "filter.dir.asc": "Ascending",
  "market.page.prev": "Previous", "market.page.next": "Next", "market.page.info": "Page {page} / {pages} · {total} listings",
  "notice.toolview.err": "Registry temporarily unavailable",
  "badge.community": "Community", "search.summary": "⭐ Curated {n} · Community {m}",
  "community.fallback": "Registry unavailable — showing community listings",
  "detail.capabilities": "Capabilities", "detail.capabilities.unscanned": "Not scanned ≠ not detected", "detail.redlines": "Capability red lines",
  "guard.blocked": "Install blocked by post-install guard", "guard.compstatus": "Compensation status", "guard.repairbasis": "Repair basis",
  "guard.restartsafenow": "You can restart DSH Web now", "guard.restartunsafe": "Fix before restarting (do not one-click restart now)",
  "guard.noforce": "Guard blocks have no force channel — repair manually per the basis above",
  "detail.screenshots": "Screenshots", "installed.check.incomplete": "Check incomplete",
  "settings.community": "Community catalog (from awesome-dsh-plugin)", "settings.community.toggle": "Community catalog toggle",
  "settings.community.off": "Community catalog is off: the market shows only the Curated registry. Toggle back on anytime — it applies live.",
  "settings.community.on.ok": "Community catalog enabled (live)", "settings.community.off.ok": "Community catalog disabled (live)",
  "settings.community.toggle.failed": "Toggle failed: {err}",
  "settings.community.status": "Status", "settings.community.status.stale": "Cached snapshot", "settings.community.version": "Catalog version", "settings.community.route": "Route",
  "settings.community.count": "Entries", "settings.community.count.v": "{n} (upstream {up})",
  "settings.community.displaced": "Displaced (duplicates)", "settings.community.displaced.v": "{n}",
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
  "notify.upgraded": "Upgraded {pkg} ({from} → {to})", "notify.upgraded.clientonly": ". Client-only update: refresh the page to take effect — no restart needed", "notify.upgraded.activationUnknown": ". Activation classification unavailable: restart DSH Web to ensure the new version is live", "notify.upgradehint": " (note: this plugin ran build scripts)",
  "notify.selfupgraded": "dsh-m upgraded (v{from} → v{to})", "notify.selfupgraded.failed": "dsh-m upgrade failed: {err}",
  "failed.install": "Install failed: {err}", "failed.uninstall": "Uninstall failed: {err}", "failed.upgrade": "Upgrade failed: {err}",
  "failed.load": "Load failed: {err}", "failed.read": "Read failed: {err}", "failed.open": "Failed to open the marketplace panel:",
  "banner.done": "Changes applied. Restart DSH Web to take effect.",
  "restart.doing": "Requesting restart…", "restart.waiting": "Restart requested, waiting for DSH Web…",
  "restart.now": "⚡ Restart", "restart.failed": "Restart failed: {err}",
  "restart.timeout": "Restart timed out — check the dsh web service manually",
  "restart.hint.done": "Restart requested (via {via}). DSH Web will reconnect in the background after the service returns.",
  "profile.restartHint": "Changes applied. Desktop plugins are managed by the official app: quit and reopen the Desktop app (closing the window may only hide it) to load the new state.",
  "profile.chipTitle": "Active profile",
  "selfupdate.available": "New version v{v} available — click to upgrade", "selfupdate.ahead": "Local dev build (ahead of npm: v{v})", "selfupdate.checking": "Checking for updates…",
  "phase.resolving": "Resolving", "phase.downloading": "Downloading", "phase.linking": "Linking", "phase.building": "Building", "phase.ready": "Preparing",
  "readme.show": "📖 README", "readme.hide": "Hide README", "readme.loading": "Loading README… ", "readme.none": "(No README)",
  "readme.truncated": "…(truncated at 64KB — see the plugin directory for full content)",
  "warn.unlink": "Uninstalling only removes the profile's reference to the local directory ({path}); the directory itself is kept.",
  "warn.core": "This is a core/archive package installed via file:. Uninstalling may affect DSH features and requires manual restore.",
  "profile.hint": "profile: {path}",
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
// 社区分类标签按界面语言取值（i18n）：en 用服务端 categoryLabelsEn 覆盖中文映射（缺 en 的 id 回退中文）
function communityLabels(data) {
  const c = data && data.community && typeof data.community === "object" ? data.community : {};
  const zh = c.categoryLabels && typeof c.categoryLabels === "object" ? c.categoryLabels : {};
  if (browserLang() !== "en") return zh;
  const en = c.categoryLabelsEn && typeof c.categoryLabelsEn === "object" ? c.categoryLabelsEn : {};
  return { ...zh, ...en };
}

// （0.7.0 Task 8：客户端 CATEGORIES 表已由 market-state.js zoneChips 取代）

// ---------- 样式（跟随 DSH Web 主题变量，深浅色自适应） ----------
const CSS = `
.dshm-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-mask-3,rgba(15,23,42,.48));display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-windows-titlebar-height,0px)) 16px 24px;box-sizing:border-box}
.dshm-panel{width:min(920px,100%);height:min(680px,86vh);display:flex;flex-direction:column;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base,#fff));background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 86%,transparent);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:14px;box-shadow:0 18px 48px rgba(2,6,23,.25);overflow:hidden;font-family:inherit;color:var(--dsw-alias-label-primary,inherit)}
/* 0.9.4 Windows Desktop 全屏修复：壳在 html 上设 --dsh-windows-titlebar-height（40px，
   titleBarStyle:hidden + titleBarOverlay:42 系统绘制 — □ ✕），其上还有全宽
   -webkit-app-region:drag 拖拽带——该带按布局参与拖拽判定、无视 z-index/绘制顺序，
   面板头部落进去点击会被窗口拖拽吞掉，还原/关闭键更被系统键悬浮遮挡。
   与壳自家 overlay 同款对策（padding/inset-top: var(--dsh-windows-titlebar-height)）让出该带；
   DSH Web / 浏览器无此变量 → 回落 0px，行为与旧版逐字节一致。 */
.dshm-overlay.full{padding:0;top:var(--dsh-windows-titlebar-height,0px)}
.dshm-panel.full{width:100%;height:100%;border-radius:0}
/* 窗口控制组（0.7.7）：最大化/关闭连体按钮组——等宽两格 + 发丝分隔线，统一线条图标 */
/* 窗口控制组（0.7.7/0.7.8）：最大化/关闭连体按钮组——透明底 + 发丝外框，与搜索清除钮同一配色语言；宽格防误触 */
.dshm-winctl{display:inline-flex;align-items:stretch;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:9px;background:transparent;overflow:hidden;flex:none}
.dshm-winctl button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);width:44px;height:28px;padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s,color .15s}
.dshm-winctl button + button{border-left:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18))}
.dshm-winctl button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,inherit)}
.dshm-winctl button:active{background:var(--dsw-alias-fill-secondary,rgba(127,127,127,.2))}
.dshm-winctl button.danger:hover{background:#e5484d;color:#fff}
.dshm-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.dshm-title{font-weight:600;font-size:15px;margin-right:2px}
.dshm-head-divider{width:1px;height:18px;background:var(--dsw-alias-border-l2,#e5e7eb);flex:none}
.dshm-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2,#e2e4e8);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#f5f6f8)}
.dshm-seg button{appearance:none;border:0;background:transparent;height:28px;padding:0 14px;border-radius:7px;font:inherit;font-size:12px;color:var(--dsw-alias-label-tertiary,#7b8088);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background .15s,color .15s,box-shadow .15s}
.dshm-seg button:hover{color:var(--dsw-alias-label-secondary,#4b5058)}
.dshm-seg button.on{background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#17191c);font-weight:600;box-shadow:var(--dsw-shadow-lv1,0 2px 8px rgb(20 24 32 / 8%))}
.dsvm-filterbtn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-elevated,transparent);color:var(--dsw-alias-label-secondary,#4b5563);border-radius:8px;padding:4px 12px;font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:color .15s,border-color .15s,background .15s}
.dsvm-filterbtn:hover{color:var(--dsw-alias-label-primary,inherit);border-color:var(--dsw-alias-label-caption,#9ca3af)}
.dsvm-filterbtn.on{color:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:var(--dsw-alias-state-business-primary,#4d6bfe);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 8%,transparent)}
.dsvm-filterchev{font-size:10px;line-height:1}
.dshm-seg .dshm-count{font-size:11px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-caption,#9ca3af);margin:0}
.dshm-seg button.on .dshm-count{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dshm-spacer{flex:1}
.dshm-body{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px}
.dshm-hint{color:var(--dsw-alias-label-caption,#6b7280);font-size:12px;line-height:18px;margin:0}
.dshm-err{color:var(--dsw-alias-state-error-primary,#b91c1c);font-size:12px;line-height:18px}
.dshm-ok{color:var(--dsw-alias-state-success-primary,#047857);font-size:12px;line-height:18px;word-break:break-word}
.dshm-btn{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,inherit);border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dshm-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dshm-btn:disabled{opacity:.5;cursor:default}
.dshm-btn.primary{background:var(--dsw-alias-interactive-bg-selected,#4f46e5);border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5);color:#fff}
.dshm-btn.primary:hover{filter:brightness(1.08)}
.dshm-btn.danger{color:var(--dsw-alias-state-error-primary,#b91c1c);border-color:var(--dsw-alias-state-error-primary,#b91c1c)}
.dshm-btn.sm{padding:3px 9px;font-size:11px}
.dshm-input{flex:1;min-width:120px;border:1px solid var(--dsw-alias-border-l2,#c7d2fe);background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary,inherit);border-radius:999px;padding:7px 14px;font:inherit;font-size:12px;outline:none}
.dshm-input:focus{border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5)}
.dshm-chips{display:flex;flex-wrap:wrap;gap:6px;position:relative}
.dshm-chips-clip{overflow:hidden}
.dshm-chips-gutter{padding-right:var(--dshm-clip-gutter,96px)}
.dsvm-chipmore{position:absolute;right:8px}
.dsvm-searchrow{display:flex;align-items:center;gap:8px}
.dsvm-searchrow .dshm-search{flex:1;display:flex}
.dshm-search{position:relative}
.dshm-search .dshm-xbtn-infield{position:absolute;right:4px;top:50%;transform:translateY(-50%)}
.dshm-xbtn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);width:26px;height:26px;padding:0;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;transition:border-color .15s,color .15s,box-shadow .15s}
.dshm-xbtn:hover{border-color:var(--dsw-alias-label-caption,#9ca3af);color:var(--dsw-alias-label-primary,inherit);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 1px 2px rgba(0,0,0,.18)}
.dshm-xbtn:active{box-shadow:inset 0 2px 3px rgba(0,0,0,.15)}
.dsvm-filterwrap{position:relative;margin-left:auto;display:inline-flex}
.dsvm-filterback{position:fixed;inset:0;z-index:25}
.dsvm-filterpop{position:absolute;top:calc(100% + 6px);right:0;z-index:30;width:250px;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base,#fff));background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 92%,transparent);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;box-shadow:0 18px 48px rgba(2,6,23,.25);padding:12px}
.dsvm-filtergroup{display:flex;flex-direction:column}
.dsvm-filtergt{font-size:11px;color:var(--dsw-alias-label-caption,#9ca3af);margin-bottom:4px}
.dsvm-filteropt{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:12px;text-align:left;padding:5px 6px;border-radius:7px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px}
.dsvm-filteropt:hover{background:var(--dsw-alias-fill-secondary,rgba(127,127,127,.12))}
.dsvm-filteropt.on{color:var(--dsw-alias-state-business-primary,#4d6bfe);font-weight:600}
.dsvm-filtercheck{font-size:11px}
.dshm-chip{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);border-radius:999px;padding:2px 10px;font:inherit;font-size:11px;cursor:pointer}
.dshm-chip.zero{opacity:.55}
.dshm-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}
.dshm-chip.on{background:var(--dsw-specific-sidebar-nav-item-active,rgba(38,49,72,.08));border-color:transparent;color:var(--dsw-alias-label-primary,inherit);font-weight:500}
.dsvm-chipswrap{position:sticky;top:-14px;z-index:5;background:var(--dsw-alias-bg-base,#fff);padding:8px 0;margin:-8px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14))}
.dsvm-pagejump{display:inline-flex;align-items:center;gap:4px;margin-left:8px}
.dsvm-pagejump-input{width:56px;height:24px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);border-radius:999px;padding:0 10px;font:inherit;font-size:12px;outline:none;text-align:center;transition:border-color .15s,color .15s}
.dsvm-pagejump-input:hover{color:var(--dsw-alias-label-primary,inherit)}
.dsvm-pagejump-input:focus{border-color:var(--dsw-alias-interactive-bg-selected,#4f46e5);color:var(--dsw-alias-label-primary,inherit)}
.dsvm-pagejump-btn{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsvm-pagejump-btn:disabled{opacity:.4;cursor:default}
.dsvm-sortrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
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
/* 依卡片容器宽度自动决定列数：N=max(1,floor((W+8)/(360+8)))，单卡宽度均分剩余空间。
   普通窗口、全屏和窄屏都走同一规则；min(100%,360px) 保证极窄容器不横向溢出。 */
.dshm-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:8px}
.dsvm-searchmeta{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-caption,#6b7280);font-size:12px;line-height:18px;margin:2px 0}
.dsvm-grouphead{grid-column:1/-1;color:var(--dsw-alias-label-caption,#6b7280);font-size:11px;line-height:16px;margin:2px 0 0;font-weight:600;letter-spacing:.02em}

.dshm-card{display:flex;gap:12px;align-items:flex-start;background:var(--dsw-alias-bg-layer-2,rgba(38,49,72,.04));border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:12px;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;min-width:0;font:inherit;color:var(--dsw-alias-label-primary,inherit);transition:border-color .16s,background .16s}
.dshm-card:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));border-color:var(--dsw-alias-label-dimmed,#c7d2fe)}
.dshm-icon{width:40px;height:40px;border-radius:10px;object-fit:cover;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);flex-shrink:0;background:linear-gradient(135deg,#c7d2fe,#fbcfe8);display:grid;place-items:center;font-weight:700;font-size:16px;color:#374151}
.dshm-meta{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.dshm-top{display:flex;align-items:center;gap:8px;min-width:0}
.dshm-name{flex:1;min-width:0;font-weight:600;font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshm-badge{appearance:none;border:0;font:inherit;flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-state-success-tertiary,#ecfdf5);color:var(--dsw-alias-state-success-primary,#047857)}
button.dshm-badge{cursor:pointer}
button.dshm-badge:hover{filter:brightness(.95)}
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
/* 0.9.47 HTML 子集：details/summary/kbd/mark 与 li·td 内层 p 间距收敛 */
.dshm-readme.md details{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;padding:4px 10px;margin:6px 0}
.dshm-readme.md summary{cursor:pointer;font-weight:600;margin:2px 0}
.dshm-readme.md kbd{background:rgba(127,127,127,.16);border:1px solid var(--dsw-alias-border-l2,#cbd5e1);border-bottom-width:2px;border-radius:4px;padding:0 4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.dshm-readme.md mark{background:rgba(255,213,0,.35);color:inherit;border-radius:2px;padding:0 2px}
.dshm-readme.md li>p,.dshm-readme.md td>p,.dshm-readme.md th>p,.dshm-readme.md summary>p,.dshm-readme.md p>p{margin:2px 0}
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
/* 头部 dsh-m 版本角标：等宽小字圆角，静态展示不加粗不可点（0.7.5 起改显 dsh-m 版本） */
.dshm-dshchip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#f5f6f8);color:var(--dsw-alias-label-secondary,#4b5563);border-radius:999px;padding:5px 10px;font:11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;flex:none}
.dshm-dshchip-v{font-weight:400;color:inherit}
/* 0.9.1：仅 self-check 判 outdated 才点亮——warn 态为可点按钮（点击即自升级）；其余静默复用静态样式 */
button.dshm-dshchip{cursor:pointer}
button.dshm-dshchip:disabled{cursor:default;opacity:.75}
.dshm-dshchip.warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b45309) 45%,transparent);background:var(--dsw-alias-state-warn-tertiary,#fffbeb);color:var(--dsw-alias-state-warn-primary,#b45309)}
.dshm-dshchip.warn:hover:not(:disabled){filter:brightness(.96)}
.dshm-dshchip .dshm-up{font-weight:600}

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

/** CSS 内容哈希（djb2）：bundle 更新 → 哈希变 → 旧样式自动替换（GUI 长驻页面热更自愈，0.7.8）。 */
function cssVersionOf(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function ensureCss() {
  if (typeof document === "undefined") return;
  const ver = cssVersionOf(CSS);
  const el = document.getElementById("dshm-css");
  if (el) {
    // 旧 bundle 留下的样式表：不替换的话新类名（如全屏/窗口控制组）没有规则可套
    if (el.getAttribute("data-ver") === ver) return;
    el.remove();
  }
  const n = document.createElement("style");
  n.id = "dshm-css";
  n.setAttribute("data-ver", ver);
  n.textContent = CSS;
  document.head.appendChild(n);
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
    // 0.9.6：能力表结构化拒绝（ProfileUnsupportedError 409）全字段透传——GUI 据此把
    // 「官方入口指引」渲染成中性 info 横幅，而非红色「升级失败」（Windows 实机反馈）
    if (data && typeof data === "object" && data.code === "unsupported-on-profile") {
      err.unsupported = { action: data.action, profile: data.profile, guidance: typeof data.guidance === "string" ? data.guidance : "" };
    }
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

// ---------- 市场数据唯一 owner（服务端分页 + generation/abort + 0.9.14 默认首页快照秒开） ----------
function useMarketData(zone = "community") {
  const [query, setQuery] = useState(() => normalizeMarketQuery(createZoneState(zone), zone));
  // 0.9.14 快照秒开：仅首渲染读一次 localStorage（useState 惰性初始化），命中即先渲染上次
  // 默认首页响应（loading=false），background 换新；读侧再过一次 normalize 兜形状漂移
  const [boot] = useState(() => {
    const snap = readMarketSnapshot(typeof window !== "undefined" && window.localStorage ? window.localStorage : null, { zone });
    return snap ? { data: normalizeMarketResponse(snap), has: true } : { data: null, has: false };
  });
  const [data, setData] = useState(boot.data);
  const [loading, setLoading] = useState(!boot.has);
  const [error, setError] = useState(null);
  const genRef = useRef(0);
  const abortRef = useRef(null);
  const queryRef = useRef(query);
  const dataRef = useRef(boot.data);
  const storage = () => (typeof window !== "undefined" && window.localStorage ? window.localStorage : null);

  const fetchPage = useCallback((nextQuery, force, background = false, probeMode = "cache-only") => {
    const gen = ++genRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    // background 且已有数据可显示：不置 loading、不清 error（静默换新，失败保留旧数据）
    if (!background || !dataRef.current) {
      setLoading(true);
      setError(null);
    }
    const params = {
      query: nextQuery.query || undefined,
      category: nextQuery.category || undefined,
      // 0.9.25 跨区搜索：query 非空 → source=all（社区+精选一并命中），浏览态维持本区 source
      source: searchSourceOf(nextQuery),
      ...(nextQuery.sort ? { sort: nextQuery.sort } : {}),
      offset: nextQuery.offset,
      limit: nextQuery.limit,
      // 0.9.45 两段加载（ADR-0013）：第一段 cache-only 零网络回页；'full' 为终态语义不下传（core 缺省等价）
      ...(probeMode !== "full" ? { probeMode } : {}),
      ...(force ? { force: true } : {}),
    };
    return api("market", params, ac.signal)
      .then((raw) => {
        if (genRef.current !== gen || ac.signal.aborted) return;
        const next = normalizeMarketResponse(raw);
        // 会话内徽标不回退：上一轮响应有 latest 族值而本响应缺 → 按 id 叠加（快照不含 latest 族字段）
        const prevItems = dataRef.current && Array.isArray(dataRef.current.items) ? dataRef.current.items : null;
        const mergedItems = mergeLatestFields(next.items, prevItems);
        const merged = mergedItems === next.items ? next : { ...next, items: mergedItems };
        dataRef.current = merged;
        setData(merged);
        setLoading(false);
        // 第二段：仅 cache-only 首段有缺口时发起（'full' 恒为终态——防 latestTimedOut 死循环）；
        // force 由 params 传递 → core peek 旧值兜底 + 全页重探（P2）
        if (probeMode === "cache-only" && next.latestComplete === false) {
          return fetchPage(nextQuery, force, true, "full");
        }
        // 快照只在终态写（第一段无缺口，或第二段 merge 完成）——首段缺口 intermediate 态不写，防快照质量降级
        if (isDefaultFirstPageQuery(nextQuery, zone)) writeMarketSnapshot(storage(), { zone, response: merged });
      })
      .catch((e) => {
        if (genRef.current !== gen || ac.signal.aborted) return;
        if (background && dataRef.current) return;   // 第二段失败静默保留（Q11②）
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

  // 0.9.45：reload（mutation 后 refreshViews / 显式刷新）直发终态语义 full；force 走 params → core peek 旧值兜底 + 全页重探
  const reload = useCallback((force) => fetchPage(queryRef.current, force, false, "full"), [fetchPage]);

  useEffect(() => {
    fetchPage(queryRef.current, false, boot.has);
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

// ---------- 重启横幅（0.9.2：boot id 确认新进程后回调 onRestarted——面板就地重取 ping，角标/profile chip 不再停留旧进程数据） ----------
function RestartBanner({ note, onDone, desktop, onRestarted }) {
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
      // 0.9.2：先就地刷新 ping（版本角标/profile chip），再关横幅；回调异常不影响横幅收尾
      if (onRestarted) {
        try { onRestarted(); } catch { /* 回调异常不阻塞横幅关闭 */ }
      }
      onDone(true);
    } catch (e) {
      setPhase("idle");
      setErr(String((e && e.message) || e));
    }
  }, [onDone, onRestarted]);
  return h(
    "div",
    { className: "dshm-banner" },
    h("span", { className: "dshm-banner-text" },
      phase === "restarting" ? lookup("restart.doing") :
      phase === "waiting" ? lookup("restart.waiting") :
      err ? lookup("restart.failed", { err }) :
      note || lookup("banner.done")),
    phase === "idle" && !err && !desktop ? h("button", { className: "dshm-btn primary sm", onClick: restart }, lookup("restart.now")) : null,
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
      style: draft ? { paddingRight: "32px" } : null,
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
          className: "dshm-xbtn dshm-xbtn-infield",
          title: lookup("common.clear"),
          onClick: () => {
            setDraft("");
            if (timerRef.current) clearTimeout(timerRef.current);
            onCommit("");
            if (inputRef.current) inputRef.current.focus();
          },
        }, h(XIcon))
      : null,
  );
}

// ---------- 分区分类 chips（0.7.0 Task 10：两行折叠 + 吸顶自动收缩；0.7.2 尾部挂筛选触发器；
//            0.7.9 顺序恒定；0.9.53 方案A「隐身全量测量」；0.9.55 切换钮内联化（dsh-market 对齐）+
//            折行减类（主人方案）——+N in-flow 插在末可见分类与被裁分类之间，flow 布局永不重叠；
//            被裁分类 display:none 不占位，+N 折行时 hiddenCount+1 令其退位、+N 退回末可见行）----------
function ZoneChips({ zone, counts, labels, active, onPick, trailing, wrapTitle }) {
  const chips = useMemo(() => zoneChips(counts, labels, zone), [counts, labels, zone]);
  const [expanded, setExpanded] = useState(false);
  const [stuck, setStuck] = useState(false);
  // 折叠态测量快照（0.9.55）：{tops: 「展示中」data-chip 的 offsetTop（[全部, ...可见分类]，
  // display:none 不计）, hiddenCount: display:none 的分类颗数, plusWrapped: +N 是否被折行}。
  // expanded 期间不重测、沿用快照。
  const [geom, setGeom] = useState(null);
  const [rowHeight, setRowHeight] = useState(0);
  const wrapRef = useRef(null);
  const sentinelRef = useRef(null);
  const autoRef = useRef(null);
  const maxRows = stuck ? 1 : 2;
  const activeIdx = active ? chips.findIndex((c) => c.id === active) : -1;
  const plusWrapped = !!(geom && geom.plusWrapped);
  const maxRowsEff = maxRows + (plusWrapped ? 1 : 0);
  const maxH = maxRowsEff * (rowHeight || 22) + (maxRowsEff - 1) * 6;
  // 测量：只测「展示中」chip（display:none 不占位不计），值比较防抖（幂等不动点）。
  // +N 折行判定：+N 顶 > 末可见 chip 行顶 ⇒ 折到裁剪线外 ⇒ hiddenCount +1（减少一个显示类型，
  // 让 +N 退回末可见行——主人方案）；display:none 的被裁分类不占位不计。
  const measure = useCallback(() => {
    const el = wrapRef.current;
    if (!el || expanded) return;
    const tops = [];
    let rh = 0;
    let plusTopMeas = null;
    let hiddenMeas = 0;
    for (const k of el.children) {
      if (!(k instanceof HTMLElement)) continue;
      if (k.getAttribute("data-more") === "1") {
        plusTopMeas = k.offsetTop;
        continue;
      }
      if (k.getAttribute("data-chip") !== "1") continue;
      if (getComputedStyle(k).display === "none") {
        hiddenMeas += 1;
        continue;
      }
      tops.push(k.offsetTop);
      if (!rh && k.offsetHeight) rh = k.offsetHeight;
    }
    if (!tops.length) return;
    const lastRowTop = tops[tops.length - 1];
    const plusWrappedNow = plusTopMeas != null && plusTopMeas > lastRowTop;
    setGeom((prev) => {
      // 种子（prev=null，全显示首测）：越界数 = countBeyondRows(全部+分类 tops, maxRows)
      const prevHC = prev ? prev.hiddenCount : countBeyondRows(tops.slice(1), maxRows);
      const hiddenCount = plusWrappedNow ? prevHC + 1 : prevHC;
      const next = { tops, hiddenCount };
      const same = prev && prev.hiddenCount === next.hiddenCount && prev.tops.length === next.tops.length && prev.tops.every((t, i) => t === next.tops[i]);
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
  // ② 决策（D8）：激活分类 display:none（被裁）⇒ 必然越界；可见则按索引与可见数比较。
  // 传入 (activeIdx, visCats) 与纯函数「值 >= 边界」语义一致；展开态仅记录不施裁（R1-Q3）。
  useEffect(() => {
    if (!active || !geom) return;
    const visCats = geom.tops.length - 1; // tops[0] = 「全部」
    const d = autoExpandDecision(activeIdx, visCats, autoRef.current === active, expanded);
    if (d.record) autoRef.current = active;
    if (d.expand) setExpanded(true);
  }, [active, activeIdx, expanded, geom]);
  // 确定性重测主路径（D7③）：数据/业务态/吸顶/行高变化即重测（expanded 早退在 measure 内）。
  // 评审 R1-Q1：deps 用 `chips` 引用（useMemo 随 counts/labels 重算）替代 `chips.length`，并叠加
  // `active`（.dshm-chip.on 加粗变宽可重排）——同长度内容变化（计数刷新/加粗）也有确定性重测，
  // 消除「RO 因 max-height 钳制失聪」的陈旧 geom 盲区。
  useLayoutEffect(() => {
    if (!expanded) measure();
    // geom 入 deps：+N in-flow 化后，其折行（plusWrapped）会驱动 max-height 扩行，需复测收敛
  }, [chips, active, expanded, zone, stuck, rowHeight, measure, geom]);
  // RO 兜底（D7①）：宽度变化 / 字体重排 / max-height 变化（stuck 切换）触发；rAF 节流 + 幂等。
  // feature-detect 降级：无 RO 时仅靠 deps 主路径（先例 :947 IO 守卫）。
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || expanded || typeof ResizeObserver === "undefined") return;
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
  }, [expanded, measure]);
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
  // gutter 仅承载钉住的筛选（0.9.55 对齐 dsh-market 参考设计：+N/⌃ 内联化，不再进 overlay 组；
  // 精选区无 trailing 时不预留——R3-N4 语义保持）
  const filterPinned = clip && trailing != null;
  const hiddenCount = geom ? geom.hiddenCount : 0;
  // 可见分类数 = 总数 − 被裁数；首测前（geom=null）全量渲染
  const visCount = geom ? Math.max(0, chips.length - hiddenCount) : chips.length;
  // hide=true ⇒ display:none：不占位、不进 tab 序/无障碍树（与「未渲染」语义一致）；
  // 测量只统计展示中 chip 的 offsetTop，display:none 元素 offsetTop 无效故必须剔除。
  const btn = (c, i, hide) =>
    h(
      "button",
      {
        key: c.id,
        "data-chip": "1",
        style: hide ? { display: "none" } : undefined,
        className: `dshm-chip${active === c.id ? " on" : ""}${c.count === 0 ? " zero" : ""}`,
        onClick: () => onPick(active === c.id ? null : c.id),
      },
      // 0.9.45 U3/U7：0 计数桶显式渲染「0」+ 降透明（社区区 chip 计数恒 >0，行为不变）
      `${c.labelKey ? lookup(c.labelKey) : c.label} ${c.count || 0}`,
    );
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
          className: `dshm-chips${clip ? " dshm-chips-clip" : ""}${filterPinned ? " dshm-chips-gutter" : ""}`,
          title: wrapTitle || undefined,
          style: { maxHeight: clip ? `${maxH}px` : "none" },
        },
        h("button", { "data-chip": "1", className: `dshm-chip${active == null ? " on" : ""}`, onClick: () => onPick(null) }, lookup("cat.all")),
        // 0.9.55 对齐 dsh-market 参考设计：+N 以 in-flow 插在「末可见分类」与「被裁分类」之间——
        // flow 布局永不与 chip 重叠（绝对定位夹取方案在末行剩余空间不足时会压 chip，真机已复现）；
        // 被裁分类 display:none 不占位；+N 若被折行（挤不下）则 hiddenCount+1 令其退回末可见行
        // （主人方案），同时 max-height 扩一行容纳 +N 独占行——两态均无重叠。
        ...chips.slice(0, visCount).map((c, i) => btn(c, i, false)),
        clip && chips.length > 0 && hiddenCount > 0
          ? h("button", { key: "more", "data-more": "1", className: "dshm-chip", onClick: () => setExpanded(true) }, `+${hiddenCount}`)
          : null,
        ...chips.slice(visCount).map((c, i) => btn(c, visCount + i, clip)), // hide 仅折叠态生效；展开态全量可见
        expanded
          ? [
              h("button", {
                key: "collapse",
                "data-chip": "1",
                className: "dshm-chip",
                // 评审 R1-Q6：手动收起即记录 autoRef——展开态下激活的分类若真实越界（geom 陈旧或
                // 收起重测后越界），决策 effect 不得立即弹回，「手动收起」无条件被尊重。
                onClick: () => {
                  if (active) autoRef.current = active;
                  setExpanded(false);
                },
              }, "⌃"),
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
    {
      ref,
      className: "dsvm-shotbox",
      onClick, role: "button", tabIndex: 0,
      // 0.9.45 U8：键盘可达（此前 role=button 但键盘无法开灯箱）
      onKeyDown: (e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.isComposing) {
          e.preventDefault();
          onClick();
        }
      },
    },
    show
      ? h("img", { className: "dsvm-shot", src, alt: "", loading: "lazy", referrerPolicy: "no-referrer", fetchPriority: "low" })
      : null,
  );
}

// ---------- 截图灯箱（←→/Esc 键盘、圆点导航、禁自动轮播——大图必须停住直到观看者主动移动） ----------
function Lightbox({ shots, index, onNav, onClose }) {
  return h(
    "div",
    { className: "dsvm-lightbox", ...backdropCloseHandlers(onClose) },
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

function DetailModal({ it, labels, busy, onClose, onInstall, onUpgrade, upgradeBusy, upgradeRec, profileKind, installRec, installNote }) {
  useModalDepth(true);
  const shots = it.community === true ? safeScreenshots(it) : [];
  const [lb, setLb] = useState(null);
  const [copied, setCopied] = useState(false);
  // 0.9.45 U10b：README 折叠页——展开才拉取（收起态零请求）
  const [rmOpen, setRmOpen] = useState(false);
  // 0.9.45 U8：初始聚焦关闭钮（role/aria 语义 + 键盘入口；Tab 圈闭与焦点还原不在本批边界内）
  const closeRef = useRef(null);
  useEffect(() => {
    if (closeRef.current) closeRef.current.focus();
  }, []);
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
        it.community !== true && Array.isArray(it.verified) && it.verified.length ? h("span", { className: "dshm-badge", title: it.verified.join("、") }, lookup("badge.verified")) : null,
        it.audience === "internal" ? h("span", { className: "dshm-badge" }, lookup("badge.internal")) : null,
        it.decoupled === true ? h("span", { className: "dshm-badge", title: lookup("badge.decoupled.tip") }, lookup("badge.decoupled")) : null,
        it.installed ? h("span", { className: "dshm-badge" }, lookup("badge.installed")) : null,
        it.community === true ? h("span", { className: "dshm-badge info" }, lookup("badge.community")) : null,
        h("span", { className: "dshm-badge info" }, it.source === "npm" ? "npm" : "github"),
        h("span", { className: "dshm-spacer" }),
        h("button", { ref: closeRef, className: "dshm-xbtn", "aria-label": lookup("common.close"), title: lookup("common.close"), onClick: onClose }, h(XIcon)),
      ),
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
      h(
        "div",
        { className: "dsvm-modalactions" },
        it.installed
          ? h(
              React.Fragment,
              null,
              it.outdated
                ? h("button", { className: "dshm-btn primary", disabled: upgradeBusy, onClick: () => onUpgrade(it) }, upgradeBusy ? h(Spin) : lookup("action.upgrade"))
                : null,
              h("span", { className: "dshm-hint" }, lookup("manage.hint")),
            )
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

// 社区区排序（0.7.2 起选项入「筛选」弹层：filter.field 系 + filter.dir 系键，下拉 SORT_OPTIONS 退役）。

function MarketTab({ notify, markets, onMutation, ops, favorites, profileKind }) {
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
  // 翻页：offset 定位 + 回滚列表顶部（吸顶 chips 行为锚点）
  const gotoPage = (p) => {
    updateQuery({ offset: Math.max(0, (p - 1) * limit) });
    if (typeof document !== "undefined") {
      // 0.9.25：搜索态 chips 行隐藏 → 摘要行接管回顶锚点
      const el = document.querySelector(searching ? ".dsvm-searchmeta" : ".dsvm-chipswrap");
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
    }
  };
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

  // 0.9.15：成功文案拆出——底层 toast 与 Modal 内终态行共用同一份
  const installResultText = (res) =>
    lookup("notify.installed", { pkg: res.pkg, version: res.version ? ` v${res.version}` : "" }) +
    (res.buildApprovals && res.buildApprovals.length ? lookup("notify.builds", { names: res.buildApprovals.join(", ") }) : res.fallbackAllBuilds ? lookup("notify.builds.fallback") : "") +
    (res.bundleWarning === "no-patch-layer" ? lookup("notify.bundlewarning") : "");
  const installDone = (it2, res) => {
    notify({ kind: "ok", needsRestart: true, text: installResultText(res) });
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
      if (e && e.opSuperseded) {
        notify({ kind: "ok", text: lookup("op.superseded.note", { target: it.name }) });
        setInstallNote({ id: it.id, kind: "hint", text: lookup("op.superseded.note", { target: it.name }) });
      } else if (e && e.guard) {
        // 装后守卫拦截（M2 Task 3）：无 force 通道；一键重启只读 restartSafe
        const guardText = [
          lookup("guard.blocked"),
          `${lookup("guard.compstatus")}: ${e.guard.compensation?.status || "—"}（${e.guard.compensation?.note || ""}）`,
          e.guard.repairBasis ? `${lookup("guard.repairbasis")}: ${e.guard.repairBasis}` : null,
          lookup("guard.noforce"),
          e.guard.restartSafe ? lookup("guard.restartsafenow") : lookup("guard.restartunsafe"),
        ].filter(Boolean).join(" | ");
        notify({ kind: "err", text: guardText });
        setInstallNote({ id: it.id, kind: "err", text: guardText });
      } else if (e && e.issue) {
        // peer 预检拦截 → 弹「仍要安装」确认（确认后带 force 重发；复用原记录 id——审计 #12）
        setCompatConfirm({ it, version, issue: e.issue, opId: e.opId });
      } else {
        const failText = lookup("failed.install", { err: (e && e.message) || e });
        notify({ kind: "err", text: failText });
        setInstallNote({ id: it.id, kind: "err", text: failText });
      }
    }
  };

  // 0.9.45 U10：市场/收藏详情 Modal 内升级（动线修复——此前已装条目只能去已装页操作）。
  // record.target = 安装包名（R1：opAppliesTo 以 x.pkg === rec.target 判定前提，收录 id ≠ 包名会被误判 superseded）
  const doUpgrade = async (it) => {
    try {
      const res = await ops.runOp("upgrade", it.installedPkg, () => api("upgrade", { pkg: it.installedPkg }));
      const note = upgradeNotify(res.activation); // 0.9.22 生效判定三态分流（client-only 不弹重启横幅）
      const text = lookup("notify.upgraded", { pkg: res.pkg, from: res.fromVersion ? `v${res.fromVersion}` : "—", to: res.version ? `v${res.version}` : res.sha ? res.sha.slice(0, 7) : "latest" })
        + (res.buildApprovals && res.buildApprovals.length ? lookup("notify.builds", { names: res.buildApprovals.join(", ") }) : res.fallbackAllBuilds ? lookup("notify.builds.fallback") : "")
        + (note.suffixKey ? lookup(note.suffixKey) : "");
      notify({ kind: "ok", needsRestart: note.needsRestart, text });
      setInstallNote({ id: it.id, kind: "ok", text });
      await (onMutation ? onMutation() : undefined);
    } catch (e) {
      if (e && e.opSuperseded) {
        const sup = lookup("op.superseded.note", { target: it.installedPkg });
        notify({ kind: "ok", text: sup });
        setInstallNote({ id: it.id, kind: "hint", text: sup });
      } else if (e && e.guard) {
        // 装后守卫拦截（与已装页同款文案链；无 force 通道，一键重启只读 restartSafe）
        const guardText = [
          lookup("guard.blocked"),
          `${lookup("guard.compstatus")}: ${e.guard.compensation?.status || "—"}（${e.guard.compensation?.note || ""}）`,
          e.guard.repairBasis ? `${lookup("guard.repairbasis")}: ${e.guard.repairBasis}` : null,
          lookup("guard.noforce"),
          e.guard.restartSafe ? lookup("guard.restartsafenow") : lookup("guard.restartunsafe"),
        ].filter(Boolean).join(" | ");
        notify({ kind: "err", text: guardText });
        setInstallNote({ id: it.id, kind: "err", text: guardText });
      } else {
        const failText = lookup("failed.upgrade", { err: (e && e.message) || e });
        notify({ kind: "err", text: failText });
        setInstallNote({ id: it.id, kind: "err", text: failText });
      }
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
      key: it.id,
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
                  // 评审 P7：徽章点击打开（滚动到）操作面板
                  if (typeof document !== "undefined") {
                    const el = document.querySelector(".dsvm-ops");
                    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
                  }
                },
              },
              lookup("op.status.running"),
            )
          : null,
        it.deprecated === true ? h("span", { className: "dshm-badge warn", key: "dep" }, lookup("badge.deprecated")) : null,
        it.community !== true && Array.isArray(it.verified) && it.verified.length ? h("span", { className: "dshm-badge", key: "v", title: it.verified.join("、") }, lookup("badge.verified")) : null,
        it.audience === "internal" ? h("span", { className: "dshm-badge dshm-badge-internal", key: "internal" }, lookup("badge.internal")) : null,
        it.decoupled === true ? h("span", { className: "dshm-badge", key: "decoupled", title: lookup("badge.decoupled.tip") }, lookup("badge.decoupled")) : null,
        it.outdated ? h("span", { className: "dshm-badge warn", key: "u" }, lookup("badge.update")) : null,
        it.installed ? h("span", { className: "dshm-badge", key: "i" }, lookup("badge.installed")) : null,
        it.community === true ? h("span", { className: "dshm-badge info", key: "c" }, lookup("badge.community")) : null,
        searching && it.community !== true ? h("span", { className: "dshm-badge", key: "cz" }, lookup("zone.primary")) : null,
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
function ReadmeBlock({ pkg, repo }) {
  const [state, setState] = useState({ loading: true, text: "", err: "", truncated: false, repo: "" });
  useEffect(() => {
    let live = true;
    api("readme", { pkg })
      .then((d) => live && setState({ loading: false, text: d.readme, err: "", truncated: d.truncated, repo: d.repo || "" }))
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
    renderMarkdown(state.text, { repo: state.repo || repo }),
    state.truncated ? h("div", { className: "dshm-md-note" }, lookup("readme.truncated")) : null,
  );
}

// ---------- 已装页 ----------
function InstalledTab({ notify, installed, updates, onMutation, ops }) {
  const { loading, data, error, reload } = installed;
  const updateRows = updates && updates.data && Array.isArray(updates.data.updates) ? updates.data.updates : [];
  const [openPkg, setOpenPkg] = useState(null);
  const [readmePkg, setReadmePkg] = useState(null);
  // busy 派生自操作记录（0.7.0 Task 13）——首个进行中的非 install 操作
  const activeMutateTarget = (ops.records.find((r) => r.kind !== "install" && (r.status === "running" || r.status === "queued" || r.status === "input")) || {}).target || null;

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
      // 0.9.22 生效判定：needsRestart 分流 + 文案后缀（缺席 = github 源等未判定，维持现状横幅）
      const note = upgradeNotify(res.activation);
      notify({
        kind: "ok",
        needsRestart: note.needsRestart,
        text: lookup("notify.upgraded", {
          pkg: res.pkg,
          from: res.fromVersion ? `v${res.fromVersion}` : "—",
          to: res.version ? `v${res.version}` : res.sha ? res.sha.slice(0, 7) : "latest",
        }) + (res.buildApprovals && res.buildApprovals.length ? lookup("notify.builds", { names: res.buildApprovals.join(", ") }) : res.fallbackAllBuilds ? lookup("notify.builds.fallback") : "") + (note.suffixKey ? lookup(note.suffixKey) : ""),
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
  // 两段加载（ADR-0008）：items 指向 merged 视图；updates 未到时即第一段原样（卡片暂无更新提示，常态安静）
  const items = applyInstalledUpdates((data && data.items) || [], updateRows);
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
              disabled: activeMutateTarget != null,
              onClick: () => {
                // 全部入队（0.7.0 Task 15）：逐条 runOp 记录，后端 Profile 变更事务 FIFO 保证串行
                for (const it of items.filter((x) => x && x.outdated)) void doUpgrade(it);
              },
            },
            lookup("installed.upgradeAll", { n: items.filter((x) => x && x.outdated).length }),
          ),
        )
      : null,
    activeMutateTarget ? h(ProgressLine, { key: "prog" }) : null,
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
            disabled: activeMutateTarget === it.pkg,
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
            ? h(ReadmeBlock, { pkg: it.pkg, repo: vm.githubRepo }) // 0.9.49：已装行走视图模型三级兜底（registryGithub/package.json repository/spec 解析），此前误传不存在的 it.github 导致相对链接全归 #
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
                  disabled: activeMutateTarget === it.pkg,
                  onClick: (e) => {
                    e.stopPropagation();
                    doUpgrade(it);
                  },
                },
                activeMutateTarget === it.pkg ? h(Spin) : lookup("action.upgrade"))
              : null,
            h(TwoStepButton, {
              key: "un",
              label: lookup("action.uninstall"),
              confirmLabel: lookup(vm.guard.confirmKey),
              className: "dshm-btn sm",
              disabled: activeMutateTarget === it.pkg,
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

function SettingsTab({ notify, onRegistryChanged, onForceMarket }) {
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
      await reloadRegistryState();
      await (onRegistryChanged ? onRegistryChanged() : reg.reload(false));
      notify({ kind: "ok", text: lookup(enabled ? "settings.community.on.ok" : "settings.community.off.ok"), needsRestart: false });
    } catch (e) {
      setCommunityOn(prev);
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

  return h(
    React.Fragment,
    null,
    // ① 社区清单（from awesome-dsh-plugin）：标题行右侧开关；开态紧凑 kv，关态单行说明
    h(
      "div",
      { className: "dshm-section" },
      h(
        "div",
        { className: "dshm-section-title" },
        lookup("settings.community"),
        h("span", { className: "dshm-spacer" }),
        h(
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
        ),
      ),
      communityOn === false
        ? h("div", { className: "dshm-hint" }, lookup("settings.community.off"))
        : h(
            "div",
            { className: "dshm-kv" },
            h("span", { className: "k" }, lookup("settings.community.status")),
            h("span", null, h("span", { className: `dshm-badge ${communityStatusBadge.cls}` }, communityStatusBadge.label)),
            h("span", { className: "k" }, lookup("settings.community.version")), h("span", null, communityLive ? communitySummary.version || "—" : "—"),
            h("span", { className: "k" }, lookup("settings.community.route")), h("span", null, communityLive ? communitySummary.route || "—" : "—"),
            h("span", { className: "k" }, lookup("settings.community.count")), h("span", null, communityLive ? lookup("settings.community.count.v", { n: communitySummary.acceptedCount ?? 0, up: communitySummary.upstreamCount ?? "—" }) : "—"),
            h("span", { className: "k" }, lookup("settings.community.displaced")), h("span", null, communityLive ? lookup("settings.community.displaced.v", { n: communitySummary.displaced ?? 0 }) : "—"),
          ),
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
        h("span", null, snap.registryUrl ? h("span", { className: "dshm-code" }, snap.registryUrl) : h("span", { className: "dshm-hint" }, lookup("settings.address.default"))),
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
    // ③ 关于：当前定位 + 仓库/反馈链接（dsh-m 自身卡已按主人要求移除——升级走市场卡片/CLI，self-check/self-upgrade API 保留）
    Section(lookup("settings.about"),
      h("div", { className: "dshm-hint" }, lookup("settings.about.text")),
      h("div", { className: "dshm-links" },
        h(ExtLink, { href: "https://github.com/iasiv5/dsh-m" }, "GitHub"),
        h("span", { className: "dshm-links-sep" }, "·"),
        h(ExtLink, { href: "https://github.com/iasiv5/dsh-m/issues" }, lookup("settings.about.issues")),
        h("span", { className: "dshm-links-sep" }, "·"),
        h(ExtLink, { href: "https://www.npmjs.com/package/dsh-m" }, lookup("settings.about.npm")),
      ),
    ),
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
  for (const k of ["descriptionEn", "npm", "github", "homepage", "owner", "downloads", "stars", "added", "deprecated", "verified", "audience", "decoupled"]) {
    if (it[k] !== undefined && it[k] !== null) s[k] = it[k];
  }
  return s;
}

function FavoriteZone({ favorites, onOpen }) {
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
            // 0.9.45 U12（R7 收窄）：无 owner = 精选条目——补「精选」身份徽标；verified 质量徽标恢复；
            // 受众/解耦徽标不进收藏区（DESIGN §2.7 裁决⑤「已装视图与收藏页不打标」），快照仅存字段
            s.owner
              ? h("span", { className: "dshm-badge info", key: "c" }, lookup("badge.community"))
              : h("span", { className: "dshm-badge", key: "cz" }, lookup("zone.primary")),
            Array.isArray(s.verified) && s.verified.length && s.community !== true ? h("span", { className: "dshm-badge", key: "v", title: s.verified.join("、") }, lookup("badge.verified")) : null,
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

// ---------- 全局操作记录（0.7.0 Task 13 + 审计碰撞修正 + 评审 P4：泵迁 operations.js） ----------
/** 模块级单例（审计碰撞·洞1）：per-hook 实例会让关面板后的旧 runOp 闭包与新面板各自
 *  全量 persist 互相覆盖丢记录——排队窗口越长越恶性。 */
const opsStore = createOperationsStore(typeof window !== "undefined" && window.localStorage ? window.localStorage : null);
/** 泵上下文（MarketPanel 渲染时注册；卸载置空——记录本体持久在 localStorage）。 */
let opsPumpCtx = null;
/** 单一执行泵（0.7.0 评审 P4：实现与测试都在 operations.js——createOpsPump）。 */
const opsPump = createOpsPump(opsStore, () => opsPumpCtx);


const OP_STATUS_CLS = {
  queued: "", running: "run", input: "warn", done: "ok", warned: "warn", failed: "err", superseded: "sup",
};

function OperationsPanel({ records, onClearFinished, onRemove }) {
  const active = records.filter((r) => r.status === "queued" || r.status === "running" || r.status === "input");
  const finished = records.filter((r) => active.indexOf(r) < 0).slice(-6);
  if (!active.length && !finished.length) return null;
  // 0.9.6：清除按钮覆盖全部终态（含 failed/superseded，主人裁决）——无可清终态时置灰并说明，
  // 不再做无声 no-op（Windows 实机反馈：按钮对着失败记录点了没反应）。
  const clearable = records.some((r) => TERMINAL_CLEARABLE.has(r.status));
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
      // 单条移除（终审·新伤2）：input/failed/superseded 行给出口（对话区来源的 input 不再永挂）
      (r.status === "input" || r.status === "failed" || r.status === "superseded") && onRemove
        ? h("button", { className: "dshm-xbtn", title: lookup("op.remove"), onClick: () => onRemove(r.id) }, h(XIcon))
        : null,
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
          h("button", { className: "dshm-btn sm", disabled: !clearable, title: clearable ? undefined : lookup("op.clear.none"), onClick: onClearFinished }, lookup("op.clear")),
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

// ---------- 头部 dsh-m 版本角标（0.9.1：常态静默只显版本；self-check 判 outdated 才点亮为可点升级角标） ----------
// 数据源：host self-check（npm latest vs 装机版本）；localStorage TTL 缓存防每次开面板都打 npm。
// 静默口径（主人 2026-10-01）：已最新 / 检查失败 / 本地 dev 领先 npm 一律维持 0.7.5 静态样式。
function DshmVersionChip({ version, notify, initialCheck }) {
  const [check, setCheck] = useState(() =>
    initialCheck !== undefined
      ? initialCheck
      : (typeof window !== "undefined" && window.localStorage
          ? readSelfCheckCache(window.localStorage, { version })
          : null),
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initialCheck !== undefined) return; // 测试注入态不联网
    let live = true;
    api("self-check")
      .then((data) => {
        if (!live) return;
        if (data && typeof data === "object" && typeof data.current === "string") {
          writeSelfCheckCache(typeof window !== "undefined" && window.localStorage ? window.localStorage : null, data);
          setCheck(data);
        }
      })
      .catch(() => {}); // 检查失败静默——「没有新版本」不打扰
    return () => { live = false; };
  }, [initialCheck]);
  const doUpgrade = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api("self-upgrade");
      clearSelfCheckCache(typeof window !== "undefined" && window.localStorage ? window.localStorage : null);
      // 升级成功：缓存已清、本地判回最新态；重启横幅由 notify 的 needsRestart 通道给出
      setCheck({ current: version, latest: null, outdated: false, ahead: false });
      notify({
        kind: "ok",
        needsRestart: true,
        text: lookup("notify.selfupgraded", { from: version, to: res.version || "latest" }) +
          (res.buildApprovals && res.buildApprovals.length
            ? lookup("notify.builds", { names: res.buildApprovals.join(", ") })
            : res.fallbackAllBuilds ? lookup("notify.builds.fallback") : ""),
      });
    } catch (e) {
      // Desktop 能力表拒绝（结构化 409）：不是失败——按官方入口指引出中性 info 横幅
      // （guidance 单一事实源在服务端 active-profile.ts），不再伪装红色「升级失败」（0.9.6 实机反馈）
      if (e && e.unsupported) {
        notify({ kind: "info", text: e.unsupported.guidance || (e && e.message) || String(e) });
      } else {
        notify({ kind: "err", text: lookup("notify.selfupgraded.failed", { err: (e && e.message) || e }) });
      }
    } finally {
      setBusy(false);
    }
  };
  const state = deriveChipState(check, version);
  if (state.kind === "outdated") {
    return h(
      "button",
      {
        type: "button",
        className: "dshm-dshchip warn",
        title: lookup("selfupdate.available", { v: state.latest }),
        onClick: doUpgrade,
        disabled: busy,
      },
      "dsh-m ",
      h("span", { className: "dshm-dshchip-v" }, `v${version}`),
      busy ? h(Spin) : h("span", { className: "dshm-up" }, `⬆ v${state.latest}`),
    );
  }
  const title = state.kind === "ahead" && state.latest
    ? lookup("selfupdate.ahead", { v: state.latest })
    : `dsh-m v${version}`;
  return h(
    "span",
    { className: "dshm-dshchip", title },
    "dsh-m ",
    h("span", { className: "dshm-dshchip-v" }, `v${version}`),
  );
}

// ---------- 通用 × 关闭/清除图标（SVG 线条替代字符 ×，配 .dshm-xbtn 使用） ----------
function XIcon() {
  return h("svg", { viewBox: "0 0 24 24", width: "12", height: "12", fill: "none", "aria-hidden": "true" },
    h("path", { d: "M6 6l12 12M18 6L6 18", stroke: "currentColor", strokeWidth: "2.2", strokeLinecap: "round" }));
}

// ---------- 最大化/还原图标（窗口控制组用；full 态切换为叠层矩形） ----------
function FsIcon({ full }) {
  return full
    ? h("svg", { viewBox: "0 0 24 24", width: "12", height: "12", fill: "none", "aria-hidden": "true" },
        h("path", { d: "M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }),
        h("rect", { x: "8", y: "8", width: "12", height: "12", rx: "1", stroke: "currentColor", strokeWidth: "2" }))
    : h("svg", { viewBox: "0 0 24 24", width: "12", height: "12", fill: "none", "aria-hidden": "true" },
        h("path", { d: "M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }));
}

function MarketPanel({ onClose }) {
  const [tab, setTab] = useState("market");
  // 全屏态（0.7.7 移植 dsh-market）：localStorage 记忆（dshm-panel-fullscreen），
  // SSR/无 localStorage 环境安全降级为 false；Esc 关面板语义不变
  const FS_KEY = "dshm-panel-fullscreen";
  const [full, setFull] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage ? window.localStorage.getItem(FS_KEY) === "1" : false;
    } catch {
      return false;
    }
  });
  const toggleFull = useCallback(() => {
    setFull((v) => {
      const next = !v;
      try {
        if (typeof window !== "undefined" && window.localStorage) window.localStorage.setItem(FS_KEY, next ? "1" : "0");
      } catch {
        /* 配额/隐私模式静默——状态仅本页生效 */
      }
      return next;
    });
  }, []);
  // 市场数据唯一 owner（0.7.0 Task 9：两分区独立状态实例，切 tab 互不重置；
  // 收藏区数据在 Task 14 落地，本地 localStorage 不走 market 通道）
  const marketCommunity = useMarketData("community");
  const marketPrimary = useMarketData("primary");
  const markets = { community: marketCommunity, primary: marketPrimary };
  const installed = useAsync(() => api("installed", { probe: false }), []);
  // 两段加载（ADR-0008）第二段：探测 TTL=0 永远新鲜，挂载即与第一段并行发起；未到时卡片暂无更新提示
  const updates = useAsync(() => api("installedUpdates"), []);
  // 全局操作记录（0.7.0 Task 13 + 审计碰撞修正）：单例 store + 泵执行（queued 真实生命周期）
  const [opRecords, setOpRecords] = useState(() => opsStore.list().map((r) => ({ ...r })));
  const syncOps = useCallback(() => setOpRecords(opsStore.list().map((r) => ({ ...r }))), []);
  const runOp = useCallback(
    (kind, target, exec, meta = {}, reuseId) =>
      // session:true = 活会话标记（终审·新伤1）：重挂载的 restore 跳过（泵仍拥有）；persist 时剥离。
      // 入队与 waiters/原始错误保真都在 createOpsPump（评审 P4：实现与测试同源）。
      opsPump.enqueue({ ...(reuseId ? { id: reuseId } : {}), kind, target, status: "queued", meta: { ...meta, session: true } }, exec),
    [],
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
  // dsh-m 自身版本：挂载时随 ping 带回（0.7.5 起头部 chip 改显 dsh-m 版本，DSH 运行版本看设置页）；失败/缺席 → chip 整个隐藏（不留占位）
  // 0.9.2：提取 reloadPing——一键重启确认新进程后与页面回前台时各重取一次，
  // 修「面板不关跨服务重启 → 角标/能力提示停留旧进程数据」（0.9.1 实测：芯片升级 + 重启后仍显 v0.9.0）
  const [pluginVersion, setPluginVersion] = useState(null);
  // 0.9.0 双 profile：ping.profile { name, kind, source }——chip 与重启引导的数据源；缺席 = 旧宿主，按 web 处理
  const [profile, setProfile] = useState(null);
  const reloadPing = useCallback(() => {
    let live = true;
    api("ping")
      .then((r) => {
        if (!live) return;
        setPluginVersion(typeof r?.version === "string" && r.version ? r.version : null);
        setProfile(r?.profile && typeof r.profile === "object" ? r.profile : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => reloadPing(), [reloadPing]);
  // 页面回到前台时重取（面板常开、服务在后台被外部重启的场景；visibilitychange 零轮询成本）
  useEffect(() => {
    const onVis = () => {
      if (typeof document !== "undefined" && !document.hidden) reloadPing();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reloadPing]);
  // Registry 配置或任一 profile mutation 后，视图一起刷新，避免单页快照不同步（两分区同刷）。
  const marketReloadAll = useCallback(
    (force) => {
      marketCommunity.reload(force)
      marketPrimary.reload(force)
    },
    [marketCommunity.reload, marketPrimary.reload],
  )
  const refreshViews = useCallback(
    () => refreshAfterMutation({ marketReload: marketReloadAll, installedReload: installed.reload, updatesReload: updates.reload }),
    [marketReloadAll, installed.reload, updates.reload],
  );
  const onRegistryChanged = refreshViews;
  // 恢复/泵共用上下文（审计碰撞·洞3：单一执行路径）。stillApplies 一律执行时实读（禁止复用快照）。
  const stillApplies = useCallback(async (r) => {
    let fresh = null;
    try {
      fresh = await api("installed", { probe: false });
    } catch {
      fresh = null;
    }
    const items = fresh && Array.isArray(fresh.items) ? fresh.items : null;
    if (!items) return true; // 读不到已装数据：保守放行（泵 dispatch 前还会再校验）
    // 评审 P2：github 源 install 经 registryGithub ∪ meta.github 比对（核心判定在 opAppliesTo，可测）
    return opAppliesTo(r, items);
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
        void opsPump.kick(); // 洞3：恢复并入前台泵（单一执行路径；drainRestored 循环退役）
      }
    })();
  }, [installed.data, stillApplies, syncOps]);
  const counts = {
    market: marketCommunity.data ? marketCommunity.data.total : null,
    installed: installed.data ? installed.data.items.length : null,
  };
  // 两段加载（ADR-0008）：updates 就地合并出 merged 视图；updates 未到时 merged 即第一段原样（红点 0，不误点亮）
  const mergedItems = installed.data && Array.isArray(installed.data.items)
    ? applyInstalledUpdates(installed.data.items, updates.data && Array.isArray(updates.data.updates) ? updates.data.updates : [])
    : null;
  // 更新红点（0.7.0 Task 15）：已装页存在 outdated 时已装 tab 打点
  const outdatedCount = installedUpdateStats(mergedItems || []).outdatedCount;
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
    // err 文案可能带回滚/自愈长报告，6s 读不完；ok 6s、info 12s（官方入口指引）、err 15s
    const t = setTimeout(() => setToast(null), toast.kind === "err" ? 15000 : toast.kind === "info" ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [toast]);
  // needsRestart 为 true 才出重启横幅（安装/卸载/升级/自更新）；registry 配置只 toast
  const notify = useCallback(({ kind, text, needsRestart }) => {
    setToast({ kind, text });
    if (kind === "ok" && needsRestart) {
      // 0.9.0：Desktop 不由 dsh-m 重启——横幅改为官方生命周期指引（无一键重启按钮）
      setBanner(
        profile && profile.kind === "desktop"
          ? { desktop: true, text: lookup("profile.restartHint") }
          : { text: lookup("banner.done") },
      );
    }
  }, [profile]);
  return h(
    "div",
    // 0.9.27 防拖拽误关：面板内按下拖选到遮罩释放时，click 落在公共祖先（遮罩）上——旧 onClick: onClose 会误关面板
    { className: full ? "dshm-overlay full" : "dshm-overlay", ...backdropCloseHandlers(onClose) },
    h(
      "div",
      { className: full ? "dshm-panel full" : "dshm-panel", onClick: (e) => e.stopPropagation() },
      h(
        "div",
        { className: "dshm-head" },
        h("span", { className: "dshm-title" }, lookup("title.full")),
        h("span", { className: "dshm-head-divider", "aria-hidden": "true" }),
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
        pluginVersion ? h(DshmVersionChip, { version: pluginVersion, notify }) : null,
        profile && profile.kind !== "web"
          ? h("span", { className: "dshm-dshchip", title: lookup("profile.chipTitle", { name: profile.name }) }, profile.name)
          : null,
        // 窗口控制组（0.7.7）：最大化/还原 + 关闭，连体设计（系统化窗口按钮）
        h(
          "div",
          { className: "dshm-winctl", role: "group", "aria-label": lookup("panel.fullscreen") },
          h("button", {
            type: "button",
            title: lookup(full ? "panel.restore" : "panel.fullscreen"),
            "aria-label": lookup(full ? "panel.restore" : "panel.fullscreen"),
            onClick: toggleFull,
          }, h(FsIcon, { full })),
          h("button", {
            type: "button",
            className: "danger",
            title: lookup("common.close"),
            "aria-label": lookup("common.close"),
            onClick: onClose,
          }, h(XIcon)),
        ),
      ),
      h(
        "div",
        { className: "dshm-body" },
        tab === "market" ? h(MarketTab, { notify, markets, onMutation: refreshViews, ops, favorites, profileKind: profile?.kind ?? null }) : null,
        tab === "installed" ? h(InstalledTab, { notify, installed, updates, onMutation: refreshViews, ops }) : null,
        tab === "settings" ? h(SettingsTab, { notify, onRegistryChanged, onForceMarket: () => marketReloadAll(true) }) : null,
        h(OperationsPanel, {
          records: opRecords,
          onClearFinished: () => {
            opsStore.clearFinished();
            syncOps();
          },
          onRemove: (id) => {
            opsStore.remove(id);
            syncOps();
          },
        }),
      ),
      toast
        ? h("div", { className: toast.kind === "err" ? "dshm-banner err" : "dshm-banner" },
            h("span", { className: "dshm-banner-text" }, toast.text))
        : null,
      banner ? h(RestartBanner, { note: banner.text, onDone: () => setBanner(null), desktop: banner.desktop === true, onRestarted: reloadPing }) : null,
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
    const rec = opsStore.upsert({ kind: "install", target: it.id, status: "running", meta: { npm: it.npm, github: it.github, session: true } });
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
