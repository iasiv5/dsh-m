/**
 * 本地热部署升级白名单（issue #76 / ADR-0038 v1.3）。
 *
 * 名单写死在本文件（主人 2026-11-17 定）：名单内的 npm 包名，其 file:/link: 本地部署允许被同名线上版本
 * 覆盖升级（adopt-online）；名单外的本地部署一律不线上升级（默认挡，兑现 #30 承诺）。
 * 名单内每个名字都是 npm 上 maintainer=iasiv5 的包（2026-11-17 逐一核验）：第三方无法发布同名包，
 * 因此覆盖的目标只可能是维护者自己的包。
 *
 * 增删插件：编辑下方 LOCAL_UPGRADE_ALLOWLIST 后发版。CLI 可用环境变量 DSHM_LOCAL_UPGRADE_ALLOW
 * （逗号/空白分隔）临时追加，不持久。列表按完整包名字典序排列（顺序不影响判定，仅便于阅读）。
 */

/** 维护者白名单（写死）。 */
export const LOCAL_UPGRADE_ALLOWLIST: readonly string[] = [
  '@iasiv5/dsh-obmc-web',
  '@iasiv5/dsh-quota-watch',
  '@iasiv5/dsh-skills',
  '@iasiv5/dsh-skins',
  '@iasiv5/dsh-skip-browser-auth',
  '@iasiv5/dsh-surf',
  '@inventec/dsh-copilot-auth',
  '@inventec/dsh-onetree-log',
  'dsh-l',
  'dsh-m',
  'dsh-send-later',
  'dsh-stock-kanban',
]

export interface LocalUpgradeAllowConfig {
  /** 脚本面注入（CLI env DSHM_LOCAL_UPGRADE_ALLOW）；宿主面恒 undefined */
  localUpgradeAllow?: string[]
}

/** 判定用名单集合：写死名单 ∪ 注入名单（trim、去空、去重）。 */
export function localUpgradeAllowSet(cfg: LocalUpgradeAllowConfig | undefined): ReadonlySet<string> {
  const raw: unknown = cfg?.localUpgradeAllow
  const inline: unknown[] = Array.isArray(raw) ? raw : []
  const extra = inline.map((n) => (typeof n === 'string' ? n.trim() : '')).filter((n) => n !== '')
  return new Set([...LOCAL_UPGRADE_ALLOWLIST, ...extra])
}
