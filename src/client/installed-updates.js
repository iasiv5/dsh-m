/**
 * 已装页两段加载（ADR-0008）pure 合并/统计（DESIGN.md §4）：第一段 `installed {probe:false}`
 * 快列表 + 第二段 `installedUpdates` 探测结果，在本模块按 pkg 合并成卡内视图。
 * 不依赖 DOM/React，Node tests 直接 import（同 installed-view.js 纪律）。
 */

/**
 * 把第二段探测结果按 pkg 落到第一段 items 上：返回新数组、不改写原 item 对象（不可变）。
 * - updates 含全部已装项（outdated=false 与 latestError 项也在，缺一即破坏「检查未完成」呈现）；
 * - updates 缺席的 pkg 原样保留（phase-2 未到时整体缺席 = 无提示，不冒充「没得更新」之外的任何状态）；
 * - items/updates 非数组安全降级（null/undefined → 空数组）。
 */
export function applyInstalledUpdates(items, updates) {
  if (!Array.isArray(items)) return []
  const byPkg = new Map()
  if (Array.isArray(updates)) {
    for (const u of updates) {
      if (!u || typeof u !== 'object' || typeof u.pkg !== 'string' || u.pkg === '') continue
      byPkg.set(u.pkg, u)
    }
  }
  return items.map((it) => {
    if (!it || typeof it !== 'object') return it
    const u = byPkg.get(it.pkg)
    if (!u) return it
    return {
      ...it,
      latestVersion: u.latestVersion ?? undefined,
      latestTag: u.latestTag ?? undefined,
      latestSha: u.latestSha ?? undefined,
      outdated: u.outdated === true,
      latestError: u.latestError ?? undefined,
      latestErrorCode: u.latestErrorCode ?? undefined,
    }
  })
}

/**
 * merged 视图统计：outdatedCount 驱动 tab 红点与「全部升级 (N)」，
 * incompleteCount 对应「检查未完成」条数。非数组/null 安全降级为全零。
 */
export function installedUpdateStats(items) {
  const arr = Array.isArray(items) ? items : []
  let outdatedCount = 0
  let incompleteCount = 0
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue
    if (it.outdated === true) outdatedCount += 1
    if (typeof it.latestError === 'string' && it.latestError !== '') incompleteCount += 1
  }
  return { outdatedCount, incompleteCount }
}
