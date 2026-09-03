/** 路径与环境约定（DESIGN.md §11：profile 是唯一事实源） */
import { homedir } from 'node:os'
import { join } from 'node:path'

export const WEB_PROFILE = 'web'

export function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function webProfileDir(): string {
  return join(dshHome(), 'profiles', WEB_PROFILE)
}

/** registry 缓存目录（可被 DSHM_CACHE_DIR 覆盖，便于测试） */
export function cacheDir(): string {
  return process.env.DSHM_CACHE_DIR || join(dshHome(), 'dshm', 'cache')
}

/** 安装类操作的超时（毫秒） */
export function installTimeoutMs(): number {
  return Number(process.env.DSHM_INSTALL_TIMEOUT_MS) || 15 * 60 * 1000
}
