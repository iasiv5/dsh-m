/**
 * 升级目标解析（ADR-0028，GLOSSARY「升级目标解析」）：已装项 → 收录命中 / 合成条目 /
 * unsupported 的判定唯一产地。读侧投影（market.upgradePathFor）与写侧执行
 * （market-mutation / profile-ops 双梯）消费同一判定；「分支口径逐点一致」的评审义务
 * 自此消灭（c9faf21 漂移实证）。判据原子 isLocalSpec / GITHUB_SPEC_RE 产地不变
 * （merged-market，ADR-0026 修订段口径）。
 */
import { GITHUB_SPEC_RE, isLocalSpec, matchInstalledByEntry, mergedOutcome } from './merged-market.js'
import type { UpgradePath } from './market.js'
import type { InstalledPlugin } from './installed.js'
import type { InstallableEntry } from './market-mutation.js'
import { loadRegistry as defaultLoadRegistry, type LoadedRegistry, type RegistryConfig, type RegistryCacheNamespace } from './registry.js'
import { fetchCommunityCatalog as defaultFetchCommunityCatalog } from './community.js'
import { WEB_PROFILE } from './env.js'

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
 * InstalledItem 升级通路单点装配（#35）：upgradePath 三态 + unsupported 项的成因码
 * upgradePathReason（条件赋值——catalog/synthesized 项字段缺席，金样零 diff 前提）。
 * market.ts 两装配点（早退臂/健康臂）共用；判定经 unsupportedReasonFor 单源驱动。
 */
export function stampUpgradeProjection(item: { registryId?: string; spec?: string; source?: string; upgradePath?: UpgradePath; upgradePathReason?: UnsupportedReasonCode }): void {
  item.upgradePath = upgradePathFor(item)
  const reason = unsupportedReasonFor(item)
  if (reason) item.upgradePathReason = reason.code
}

/** unsupported 成因短标签（#35，CLI/tools 渲染消费；client 走 i18n 键系不经此）。default 臂防投影字段缺席或 null。 */
export function unsupportedCauseLabel(code: UnsupportedReasonCode | null | undefined): string {
  switch (code) {
    case 'local-spec': return '本地链接安装'
    case 'github-spec-unparseable': return 'github spec 无法解析'
    case 'source-unresolvable': return '来源不支持线上升级'
    default: return '不支持线上升级'
  }
}

/**
 * 升级通路不支持错误（ADR-0026 边界）：本地开发安装（file:/link:）与非 npm/github
 * 源不从线上自动升级——结构化指引（upgradePath='unsupported'），不落普通 Error。
 * ADR-0028：自 market-mutation.ts 迁入；message 模板与 upgradePath 字段逐字冻结（B5）。
 */
export class UpgradePathUnsupportedError extends Error {
  readonly upgradePath = 'unsupported' as const
  /** #35：结构化成因（闭集码 + detail 冻结文案），供 host-api envelope 透出；message 模板字节不变（B5）。 */
  readonly reason: { code: UnsupportedReasonCode; detail: string }
  constructor(pkg: string, reason: { code: UnsupportedReasonCode; detail: string }) {
    super(`「${pkg}」无法自动升级：${reason.detail}`)
    this.reason = reason
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
  if (reason) throw new UpgradePathUnsupportedError(target.pkg, reason)
  if (target.source === 'npm') {
    return { id: `installed:${target.pkg}`, source: 'npm', npm: target.pkg }
  }
  const m = GITHUB_SPEC_RE.exec(spec)
  if (!m || !m[1]) {
    // 不可达：unsupportedReasonFor 已放行 github 可解析形态（fail-closed 兜底，与 ADR-0026 同旨）。
    // 若本兜底未来可达（如 GITHUB_SPEC_RE 被改坏引入状态性 flag），desktop 边缘 catch 会将其
    // 保真翻译为 upgrade-unsupported 信封（评审 W2），web 边缘本就以此为信封。
    // #35（评审 #1）：code 归 github-spec-unparseable 同域（github spec 可解析性失败），detail 原文冻结。
    throw new UpgradePathUnsupportedError(target.pkg, { code: 'github-spec-unparseable', detail: 'github spec 可解析性复核失败（不可达兜底）' })
  }
  return { id: `installed:${target.pkg}`, source: 'github', github: m[1] }
}

// ---------- ADR-0028：async 壳——双梯（web/desktop）I/O 编排收编 ----------

/** 社区解析 deadline（归一锚：web 曾用 market DEFAULT_DEADLINE_MS、desktop 曾用私有副本，两处现值同 60s）。 */
export const UPGRADE_COMMUNITY_DEADLINE_MS = 60_000

export type UpgradeTargetResolution =
  | { kind: 'resolved'; entry: InstallableEntry; matchPath: 'primary' | 'community' | 'synthesized' }
  | { kind: 'unsupported'; reason: { code: UnsupportedReasonCode; detail: string; message: string } }

export interface UpgradeTargetDeps {
  /** 直通：backend 已在梯外加载过 registry 时注入复用（零重复加载）；缺省壳内自取。 */
  loaded?: LoadedRegistry
  loadRegistry?: typeof defaultLoadRegistry
  fetchCommunityCatalog?: typeof defaultFetchCommunityCatalog
}

/**
 * 把已装插件解析为当次升级目标（ADR-0028）：编排序与现行双梯逐点一致——
 * registryUsable 门 → 主清单 matchInstalledByEntry → 物化合并市场 lookupInstalledAll
 * （含 displaced 让位条目；reject 窄 catch 吞为 miss）→ 合成兜底 / unsupported。
 * profile 透传逐点复刻现行两梯（mergedOutcome 的 profile 必传且无内部缺省，错传将使
 * 社区物化代缓存段错位）：mergedOutcome 传 `opts.profile ?? WEB_PROFILE`；
 * communityTask / loadRegistry 传 raw `opts.profile`（二者内部自缺省）。
 * 只读不副作用：不做 journal、不进 mutation session、不抛业务错误——unsupported 以
 * 判别联合返回，信封映射（web 重抛 UpgradePathUnsupportedError / desktop 翻译
 * DesktopOpsError('upgrade-unsupported')）留在各 backend 边缘。
 */
export async function resolveUpgradeTarget(
  target: InstalledPlugin,
  cfg: RegistryConfig,
  opts: { namespace?: RegistryCacheNamespace; profile?: string; signal?: AbortSignal } = {},
  deps: UpgradeTargetDeps = {},
): Promise<UpgradeTargetResolution> {
  const loaded = deps.loaded ?? await (deps.loadRegistry ?? defaultLoadRegistry)(cfg, { namespace: opts.namespace ?? 'host', profile: opts.profile })
  if (loaded.status !== 'unavailable') {
    const primary = loaded.registry.plugins.find((e) => matchInstalledByEntry(e, [target]))
    if (primary) return { kind: 'resolved', entry: primary, matchPath: 'primary' }
    try {
      const communityTask = (deps.fetchCommunityCatalog ?? defaultFetchCommunityCatalog)(cfg, { namespace: opts.namespace ?? 'host', signal: opts.signal, profile: opts.profile })
      const outcome = await mergedOutcome({
        namespace: opts.namespace ?? 'host',
        profile: opts.profile ?? WEB_PROFILE,
        cfg,
        registry: loaded,
        communityTask,
        deadlineAt: Date.now() + UPGRADE_COMMUNITY_DEADLINE_MS,
      })
      const community = outcome.lookupInstalledAll(target) as InstallableEntry | undefined
      if (community) return { kind: 'resolved', entry: community, matchPath: 'community' }
    } catch {
      /* 社区失败/异常吞为 miss（现行双梯语义） */
    }
  }
  const reason = unsupportedReasonFor(target)
  if (reason) {
    return { kind: 'unsupported', reason: { code: reason.code, detail: reason.detail, message: `「${target.pkg}」无法自动升级：${reason.detail}` } }
  }
  return { kind: 'resolved', entry: synthesizeInstallableEntry(target), matchPath: 'synthesized' }
}
