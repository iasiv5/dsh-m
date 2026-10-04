/** 路径与环境约定（DESIGN.md §11：profile 是唯一事实源） */
import { homedir } from 'node:os'
import { join } from 'node:path'

export const WEB_PROFILE = 'web'
export const DESKTOP_PROFILE = 'desktop'

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
