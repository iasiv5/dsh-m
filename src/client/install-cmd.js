/**
 * 详情 Modal「安装命令」折叠行可见性（0.9.14）：DetailModal → 折叠行显隐纯函数。
 * 只做判定，不产出文案；不依赖 DOM/React/lookup，Node tests 直接 import。
 *
 * 背景（0.9.13 及以前）：折叠行命令推导写死 `dsh plugin --profile web add …`，
 * 社区条目的上游 install 原文在野外同为 --profile web 语义——两个来源都不看当前
 * 宿主 profile。desktop 上下文照抄会把包装进 web profile（当前界面看不见）；
 * 而 desktop 的装机正路就是弹窗内「安装」按钮（官方 pluginManager 委派，ADR 0005：
 * desktop 插件管理走官方门禁，dsh-m 不代管 CLI 语义）。
 */

/**
 * @param {string|null} profileKind ping.profile.kind（'web' | 'desktop' | 'unknown'）；缺席 = 旧宿主，按 web 处理（现状保持）
 * @param {boolean} installed 该条目在当前 profile 已安装
 * @returns {boolean} true = 渲染折叠行
 */
export function shouldShowInstallCmd(profileKind, installed) {
  if (profileKind === "desktop") return false;
  if (installed === true) return false;
  return true;
}
