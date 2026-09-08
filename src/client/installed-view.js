/**
 * 已装页 pure view（DESIGN.md §4）：InstalledItem → 视图模型。
 * 只产出 i18n key + 参数，不产出成品文案；lookup 留在 main.jsx 调用方。
 * 不依赖 DOM/React/lookup，Node tests 直接 import。
 * 注意：githubRepo/latestLabel 与 main.jsx 937/950/940/959 现行为逐字一致——
 * it.spec 缺失会抛 TypeError（现状如此，本次不加固）。
 */

/** 卸载护栏 key 化（原 uninstallGuard 857-868：confirm/warn 文案改 key+参数）。 */
function uninstallGuardKeys(it) {
  if (it.source === "link") {
    return { confirmKey: "confirm.unlink", warnKey: "warn.unlink", warnParams: { path: it.path } };
  }
  if (it.source === "file") {
    return { confirmKey: "confirm.core", warnKey: "warn.core", warnParams: {} };
  }
  return { confirmKey: "confirm.uninstall", warnKey: null, warnParams: {} };
}

/** 已装卡片视图模型：一次计算，卡片内多处消费（Icon 937 / 徽标 940 / 来源 946 / LinksRow 950 / 详情 959）。 */
export function installedViewModel(it) {
  return {
    githubRepo: it.registryGithub || it.githubRepo || (it.spec.startsWith("github:") ? it.spec.slice(7).split("#")[0] : null),
    sourceLabelKey: { npm: "src.npm", github: "src.github", link: "src.link", file: "src.file", unknown: "src.unknown" }[it.source] || null,
    guard: uninstallGuardKeys(it),
    latestLabel: it.latestTag || (it.latestVersion ? `v${it.latestVersion}` : ""),
    latestLabelDetail: it.latestTag || (it.latestVersion ? `v${it.latestVersion}` : "—"),
  };
}

/** registryState.source → i18n key（含旧字段兼容，原 regSourceLabel 1001-1016 的 map）；无数据 null（调用方显示 '—'）；未知 source 原样返回（调用方仍 lookup，与现行为一致）。 */
export function registrySourceKey(data) {
  if (!data) return null;
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
  return map[data.source] || data.source;
}
