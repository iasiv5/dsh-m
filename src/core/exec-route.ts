/**
 * 执行能力门（ADR-0034 Layer 2，issue #65）：web-kind profile 四写操作的进事务前路由。
 *
 * 判据链（零进程派生）：launch 识别（resolveDshLaunch）→ PATH 上 dsh 纯 FS 探测
 * （probePathDshUsable）→ 残局才探测官方 pluginManager（resolveManager 同源：
 * getService 直取 → ensureService 惰性拉起）。三出口：
 * - spawn：launch 命中 entry/carrier，或 PATH dsh 可执行——现状零漂移；
 * - delegate：残局且 manager 具备该操作所需方法——desktop ops 同路同账；
 * - refuse：残局且服务/方法缺席——DesktopOpsError('no-exec-capability')，事务未动。
 * desktop kind 不进本门（tools/host-api 分派点原样）。
 */
import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { resolveDshLaunch } from './dsh-cli.js'
import { DesktopOpsError, resolveManager } from './profile-ops.js'
import type { DesktopManagerLike } from './profile-ops.js'
import type { DshLaunchSource } from './dsh-cli.js'

export interface PathDshProbeDeps {
  pathEnv?: string
  platform?: NodeJS.Platform
  exists?: (p: string) => boolean
  accessX?: (p: string) => boolean
}

/** PATH 上是否存在可执行的 dsh CLI（win32 找 dsh.cmd/dsh.exe，其余找 dsh）。 */
export function probePathDshUsable(deps: PathDshProbeDeps = {}): boolean {
  const platform = deps.platform ?? process.platform
  const pathEnv = deps.pathEnv ?? process.env.PATH ?? ''
  const names = platform === 'win32' ? ['dsh.cmd', 'dsh.exe'] : ['dsh']
  const exists = deps.exists ?? existsSync
  const accessX = deps.accessX ?? ((p: string) => {
    try {
      accessSync(p, constants.X_OK)
      return true
    } catch {
      return false
    }
  })
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === '') continue
    for (const name of names) {
      const p = join(dir, name)
      try {
        if (exists(p) && accessX(p)) return true
      } catch {
        /* 该目录不可读/探测异常 → 跳过 */
      }
    }
  }
  return false
}

export type WebMutationOp = 'install' | 'upgrade' | 'uninstall' | 'self-upgrade'

const OP_METHOD: Record<WebMutationOp, 'installBundle' | 'removeBundle'> = {
  install: 'installBundle',
  upgrade: 'installBundle',
  'self-upgrade': 'installBundle',
  uninstall: 'removeBundle',
}

const OP_LABEL: Record<WebMutationOp, string> = {
  install: '安装',
  upgrade: '升级',
  uninstall: '卸载',
  'self-upgrade': '自升级',
}

export type WebMutationRoute =
  | { route: 'spawn' }
  | { route: 'delegate'; manager: DesktopManagerLike }
  | { route: 'refuse'; error: DesktopOpsError }

/** 纯决策矩阵（测试直驱面；编排层先做 spawn 短路，残局才进本函数）。 */
export function decideWebMutationRoute(input: {
  launchSource: DshLaunchSource
  pathDshUsable: boolean
  manager: DesktopManagerLike | undefined
  op: WebMutationOp
}): WebMutationRoute {
  if (input.launchSource !== 'path-fallback') return { route: 'spawn' }
  if (input.pathDshUsable) return { route: 'spawn' }
  const method = OP_METHOD[input.op]
  if (!input.manager || typeof input.manager[method] !== 'function') {
    const servicePart = !input.manager ? '官方 pluginManager 服务不可用' : `官方 pluginManager 缺 ${method} 方法`
    return {
      route: 'refuse',
      error: new DesktopOpsError(
        'no-exec-capability',
        `无法创建子进程（launch 落 PATH 回退且 PATH 上没有可执行的 dsh CLI），且${servicePart}；${OP_LABEL[input.op]}已拒绝（fail-closed，profile 未被修改）。请在支持子进程的环境重试，或改用官方插件管理界面。`,
      ),
    }
  }
  return { route: 'delegate', manager: input.manager }
}

export interface RouteWebMutationDeps {
  getService?: () => DesktopManagerLike | undefined
  ensureService?: (timeoutMs?: number) => Promise<DesktopManagerLike | undefined>
  op: WebMutationOp
  launch?: typeof resolveDshLaunch
  probe?: typeof probePathDshUsable
}

/** 编排缝：先 spawn 短路（零 manager 探测），残局才 resolveManager。 */
export async function routeWebMutation(deps: RouteWebMutationDeps): Promise<WebMutationRoute> {
  const launch = (deps.launch ?? resolveDshLaunch)()
  if (launch.source !== 'path-fallback') return { route: 'spawn' }
  const usable = (deps.probe ?? probePathDshUsable)()
  if (usable) return { route: 'spawn' }
  const manager = await resolveManager(deps)
  return decideWebMutationRoute({ launchSource: launch.source, pathDshUsable: usable, manager, op: deps.op })
}
