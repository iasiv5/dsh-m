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

/** issue #10 批量升级排序的自换装包名（单点；与 core SELF_PKG 同值，客户端只有此一处字面）。 */
export const BATCH_SELF_PKG = 'dsh-m'

/**
 * 「全部更新」批量目标排序（issue #10 修复①③，pure）：outdated 项中 dsh-m 自身固定收尾，
 * 其余项保持列表序在前。依据：自升级事务 committed 后宿主换装/重载市场插件本体，同批
 * 后续项在刚变过的 profile 上做事务与 frozen 复验必炸（0.10.8/0.10.13 实机实证——一项成功
 * 一项 exit 1、单项重试即愈）；排最后 = 自换装永无后续项。
 * ADR-0026（issue #30）：upgradePath==='unsupported'（本地链接/非线上来源）的 outdated 项
 * 不发起请求——排除出队列、单独收集进 unsupported 供汇总通知（零请求直入汇总）。
 * 返回 { targets, selfIncluded, unsupported }：targets 为已排序的升级队列（引用原 item
 * 对象），selfIncluded 供按钮旁提示，unsupported 为被排除项。非数组/垃圾项安全降级空队列。
 */
export function batchUpgradeOrder(items) {
  const arr = Array.isArray(items) ? items : []
  const normal = []
  const self = []
  const unsupported = []
  for (const it of arr) {
    if (!it || typeof it !== 'object' || it.outdated !== true) continue
    if (typeof it.pkg !== 'string' || it.pkg === '') continue
    if (it.upgradePath === 'unsupported') {
      unsupported.push(it)
      continue
    }
    if (it.pkg === BATCH_SELF_PKG) self.push(it)
    else normal.push(it)
  }
  return { targets: [...normal, ...self], selfIncluded: self.length > 0, unsupported }
}

/**
 * 批量升级单项结局三态（ADR-0026，评审 F1）：ok = 成功；systemic = 服务端显式标注系统性
 * 失败（守卫拦截/事务半残）→ 批量短路；target = 其余一切（显式 target、字段缺席缺省、
 * build 审批等待）→ 跳过继续。字段缺席按 target——单包网络错走裸 Error 兜底臂，
 * 缺省 systemic 会把 B4 主诉场景（单包网络错跳过继续）变成整批停止。
 */
export function classifyBatchOutcome(res) {
  if (res && res.ok === true) return 'ok'
  if (res && res.failureClass === 'systemic') return 'systemic'
  return 'target'
}

/**
 * 批量结局汇总（ADR-0026）：outcomes = Array<{ pkg, outcome: 'ok'|'target'|'systemic' }>
 * （由批量循环把 classifyBatchOutcome 结果按 pkg 收集而成，评审 N4 形状）；
 * skippedUnsupported 计数由调用方取 batchUpgradeOrder().unsupported.length 传入；
 * stopped = 出现任一 systemic（循环短路旁证）。
 */
export function summarizeBatch(outcomes, skippedUnsupported = 0) {
  const arr = Array.isArray(outcomes) ? outcomes : []
  let targetFailed = 0
  let systemic = 0
  for (const o of arr) {
    if (!o || typeof o !== 'object') continue
    if (o.outcome === 'systemic') systemic += 1
    else if (o.outcome === 'target') targetFailed += 1
  }
  return {
    targetFailed,
    systemic,
    skippedUnsupported: Number.isFinite(skippedUnsupported) ? skippedUnsupported : 0,
    stopped: systemic > 0,
  }
}

// ---------- #35：批量升级跳过提示按成因分组 ----------

const SKIPPED_UNSUPPORTED_ORDER = ['local-spec', 'github-spec-unparseable', 'source-unresolvable', 'other']

/**
 * 批量升级被跳过项（batchUpgradeOrder().unsupported）按成因码分桶（#35）：
 * 三闭集码各归其桶；码缺席或不在闭集内（含垃圾项）归 other（防御兜底）。非数组安全降级全零。
 */
export function summarizeUnsupportedReasons(items) {
  const counts = { 'local-spec': 0, 'github-spec-unparseable': 0, 'source-unresolvable': 0, other: 0 }
  const arr = Array.isArray(items) ? items : []
  for (const it of arr) {
    if (!it || typeof it !== 'object') { counts.other += 1; continue }
    const code = it.upgradePathReason
    if (code === 'local-spec' || code === 'github-spec-unparseable' || code === 'source-unresolvable') counts[code] += 1
    else counts.other += 1
  }
  return counts
}

/**
 * 跳过提示文案（#35）：固定序（local-spec → github-spec-unparseable → source-unresolvable → other）
 * 按非零桶经 lookup('installed.upgradeBatch.skipped.<code>', { n }) 拼接（空格连接）；全零 → null。
 * lookup 注入保持 DOM-free 可测；退役单段键 installed.upgradeBatch.skippedUnsupported。
 */
export function skippedUnsupportedNotice(items, lookup) {
  const counts = summarizeUnsupportedReasons(items)
  const parts = []
  for (const code of SKIPPED_UNSUPPORTED_ORDER) {
    if (counts[code] > 0) parts.push(lookup(`installed.upgradeBatch.skipped.${code}`, { n: counts[code] }))
  }
  return parts.length ? parts.join(' ') : null
}
