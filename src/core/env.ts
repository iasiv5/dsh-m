/** 路径与环境约定（DESIGN.md §11：profile 是唯一事实源） */
import { homedir } from 'node:os'
import { join } from 'node:path'

export const WEB_PROFILE = 'web'
export const DESKTOP_PROFILE = 'desktop'

/**
 * 已知桌面宿主的 profile 名全集（issue #3/#6：名字只是快路径，事实升级见
 * active-profile.ts 的 generation 投影探测）。官方 dsh-desktop 用 `desktop`；
 * dsh-tauri 0.2.1-rc.2 起实际 profile 名是 `tauri`（宿主以 --profile tauri 启动，
 * 旧 desktop 目录留作 legacy）；dataelement/dsh-desktop 的日常 profile 甚至叫
 * `web`——名字枚举必然继续漏，漏网的靠投影事实兜住。
 */
export const DESKTOP_PROFILE_NAMES: readonly string[] = ['desktop', 'tauri']

export function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function webProfileDir(): string {
  return join(dshHome(), 'profiles', WEB_PROFILE)
}

/** 0.9.31（ADR-0011）：doctor 只读体检的 desktop 目录解析（其余 CLI 命令仍恒 web）。 */
export function desktopProfileDir(): string {
  return join(dshHome(), 'profiles', DESKTOP_PROFILE)
}

/**
 * profile 名路径段安全性（ADR-0030，同业对齐 dsh-market `isDshProfileName`）：
 * 非空、非 `.`/`..`/`node_modules`、不含 `/`、`\`、`\0` 即可作目录段。
 * 这是名字校验的**唯一**判定源——kind 判定（active-profile）与 CLI 门禁（cli.ts）
 * 都消费它，不各自维护第二份字面规则。语义是「能不能安全地做路径段」，
 * 不是「认不认识这个名字」：自定义名（如 aqua）与官方名同权。
 */
export function isDshProfileName(profile: unknown): boolean {
  if (typeof profile !== 'string') return false
  return profile !== ''
    && profile !== '.'
    && profile !== '..'
    && profile !== 'node_modules'
    && !profile.includes('/')
    && !profile.includes('\\')
    && !profile.includes('\0')
}

/** 按名字解析 profile 目录（ADR-0030）：desktop 名走专用目录，其余安全名走 `profiles/<名>`。 */
export function dshProfileDirByName(name: string): string {
  if (name === DESKTOP_PROFILE) return desktopProfileDir()
  return join(dshHome(), 'profiles', name)
}

/**
 * 缓存根（0.9.0 双 profile，ADR-0005）：web 恒走旧路径（DSHM_CACHE_DIR 或
 * `$DSH_HOME/dshm/cache`）——不迁移不清空；非 web profile 加同名段
 * （`<root>/<profile>`），实现 profile 专属缓存互不污染。
 * 测试经 DSHM_CACHE_DIR 指到临时目录（红线路径与既有用例一致）。
 */
export function cacheRoot(profile: string = WEB_PROFILE): string {
  const base = process.env.DSHM_CACHE_DIR || join(dshHome(), 'dshm', 'cache')
  if (profile === WEB_PROFILE) return base
  return join(base, profile)
}

/** registry 缓存目录（可被 DSHM_CACHE_DIR 覆盖，便于测试）。web 语义的历史别名 = cacheRoot('web')。 */
export function cacheDir(): string {
  return cacheRoot(WEB_PROFILE)
}

/** 安装类操作的超时（毫秒） */
export function installTimeoutMs(): number {
  return Number(process.env.DSHM_INSTALL_TIMEOUT_MS) || 15 * 60 * 1000
}
