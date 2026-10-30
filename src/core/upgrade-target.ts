/**
 * 升级目标解析（ADR-0028，GLOSSARY「升级目标解析」）：已装项 → 收录命中 / 合成条目 /
 * unsupported 的判定唯一产地。读侧投影（market.upgradePathFor）与写侧执行
 * （market-mutation / profile-ops 双梯）消费同一判定；「分支口径逐点一致」的评审义务
 * 自此消灭（c9faf21 漂移实证）。判据原子 isLocalSpec / GITHUB_SPEC_RE 产地不变
 * （merged-market，ADR-0026 修订段口径）。
 */
import { GITHUB_SPEC_RE, isLocalSpec } from './merged-market.js'
import type { UpgradePath } from './market.js'
import type { InstalledPlugin } from './installed.js'
import type { InstallableEntry } from './market-mutation.js'

export type UnsupportedReasonCode = 'local-spec' | 'github-spec-unparseable' | 'source-unresolvable'

/**
 * 升级目标不可线上解析的判定原子（ADR-0028）：分支序固定 local-spec → npm →
 * github-spec-unparseable → source-unresolvable；null = 可解析（npm 源或 github spec
 * 可锁定仓库）。detail 三条文案为 UpgradePathUnsupportedError 现行 message 的成因段，
 * 逐字冻结（B5）；投影（upgradePathFor）与合成（synthesizeInstallableEntry）共用本判定。
 */
export function unsupportedReasonFor(target: { spec?: string; source?: string }): { code: UnsupportedReasonCode; detail: string } | null {
  const spec = typeof target.spec === 'string' ? target.spec : ''
  if (isLocalSpec(spec)) {
    return { code: 'local-spec', detail: `本地开发安装（${spec}）不从线上更新；如需线上版本请先卸载后经 dsh-m 安装` }
  }
  if (target.source === 'npm') return null
  if (target.source === 'github') {
    if (!GITHUB_SPEC_RE.exec(spec)?.[1]) {
      return { code: 'github-spec-unparseable', detail: `github 安装的 spec（${spec || '空'}）解析不出 owner/repo，拒绝臆测来源` }
    }
    return null
  }
  return { code: 'source-unresolvable', detail: `来源 ${target.source} 不可线上解析，不做自动升级` }
}

/**
 * 升级通路投影（ADR-0026，B6）：registryId 命中 → catalog；其余经 unsupportedReasonFor
 * 判定——本地 spec（file:/link:，merged-market isLocalSpec）、source ∉ {npm,github}、
 * github 源 spec 解析不出 owner/repo（GITHUB_SPEC_RE，与 synthesizeInstallableEntry 同规）
 * → unsupported；可解析 → synthesized。ADR-0028：判定原子与合成共用单源，
 * 「与 synthesizeInstallableEntry 的分支口径逐点一致」由构造保证（c9faf21 漂移不再可能）。
 */
export function upgradePathFor(item: { registryId?: string; spec?: string; source?: string }): UpgradePath {
  if (item.registryId) return 'catalog'
  return unsupportedReasonFor(item) ? 'unsupported' : 'synthesized'
}

/**
 * 升级通路不支持错误（ADR-0026 边界）：本地开发安装（file:/link:）与非 npm/github
 * 源不从线上自动升级——结构化指引（upgradePath='unsupported'），不落普通 Error。
 * ADR-0028：自 market-mutation.ts 迁入；message 模板与 upgradePath 字段逐字冻结（B5）。
 */
export class UpgradePathUnsupportedError extends Error {
  readonly upgradePath = 'unsupported' as const
  constructor(pkg: string, reason: string) {
    super(`「${pkg}」无法自动升级：${reason}`)
    this.name = 'UpgradePathUnsupportedError'
  }
}

/**
 * 从已装项自身来源合成最小可安装条目（ADR-0026「合成条目」，GLOSSARY）：
 * 条目查找 miss 时的升级兜底——仅服务当次升级、不进任何清单、不携带策展元数据。
 * 身份口径与 matchInstalledByEntry 同源：npm 名取已装包名、github 仓取 spec 锁定仓库。
 * 非线上来源一律 fail-closed 抛 UpgradePathUnsupportedError（判定原子 unsupportedReasonFor：
 * 本地 spec、github spec 解析不出 owner/repo、PluginSource 其余值（link/file/unknown——
 * installed.ts 五值域；穿透会命中 installEntryLocked 尾行普通 Error「缺少可安装来源」，
 * 违反 B5 结构化指引，故在此拦死）。ADR-0028：自 market-mutation.ts 迁入，
 * 判定经 unsupportedReasonFor 单源驱动。
 */
export function synthesizeInstallableEntry(target: InstalledPlugin): InstallableEntry {
  const spec = typeof target.spec === 'string' ? target.spec : ''
  const reason = unsupportedReasonFor(target)
  if (reason) throw new UpgradePathUnsupportedError(target.pkg, reason.detail)
  if (target.source === 'npm') {
    return { id: `installed:${target.pkg}`, source: 'npm', npm: target.pkg }
  }
  const m = GITHUB_SPEC_RE.exec(spec)
  if (!m || !m[1]) {
    // 不可达：unsupportedReasonFor 已放行 github 可解析形态（fail-closed 兜底，与 ADR-0026 同旨）。
    throw new UpgradePathUnsupportedError(target.pkg, 'github spec 可解析性复核失败（不可达兜底）')
  }
  return { id: `installed:${target.pkg}`, source: 'github', github: m[1] }
}
