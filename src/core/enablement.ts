/**
 * 开关读路径合成（0.4.0，plan Task 4；CONTEXT.md：开关/运行相位/委派降级）。
 *
 * 读路径始终自读（ADR-0001）：loader entries（经 live-plugin.ts 绑定的宿主引用）
 * ⋈ 已装清单（installed.ts，含包内补丁层行枚举）⋈ profile bundles 数组 ⋈ profile
 * 覆盖行。委派/降级两模式共用同一读法，读路径零服务依赖。
 *
 * 观察量口径（官方 readPluginInventory 同款）：
 * - enabled = !entry.disabled（entry 顶层有效停用态，含被禁用的祖先组）；
 * - phase = fiber.state 数字枚举投影（0 pending / 1 loading / 2 active / 3 failed /
 *   4 disposed→null / 5 unloading；fiber 不存在即 null）；
 * - CLI 无 loader 形态：enabled 从「在 bundles 且其补丁行无 disabled 覆盖」推断，
 *   phase 恒 null。
 *
 * PROTECTED_MODULES：'dsh-m' 自保护 + 逐字镜像官方 16 项全集（锚点：
 * @deepseek-ai/dsh-plugin-manager@0.1.7-rc.2 lib/index.js 的 protectedModules，
 * L1077-1092）。每次 DSH 升级后 diff 官方名单同步（know-how 008 升级必查口径）。
 */
import type { LoaderEntry } from './live-plugin.js'
import type { InstalledPlugin } from './installed.js'
import { isSingleRowPlugin } from './patch-yaml.js'

export type LivePhase = 'active' | 'failed' | 'pending' | 'loading' | 'unloading' | null

export interface PluginEnablement {
  pkg: string
  enabled: boolean
  phase: LivePhase
  /** 单 insert 行插件 → 行覆盖；多行/不可解析 → Bundle 选择 */
  granularity: 'row' | 'bundle'
  toggleable: boolean
  lockReason?: 'protected' | 'self' | 'no-entry'
}

/** 官方 Cordis FiberState 数字枚举（跨包 const enum 的运行时镜像，inventory 同款）。 */
const FIBER_PHASE: Record<number, Exclude<LivePhase, null>> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  5: 'unloading',
}

export const PROTECTED_MODULES: readonly string[] = [
  'dsh-m',
  '@deepseek-ai/dsh-plugin-manager',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
  '@deepseek-ai/dsh-client-ui-plugin-manager',
  '@deepseek-ai/dsh-host-plugin-inventory',
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-host-frontend-static',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-hmr',
]

export interface ComposeEnablementInput {
  items: InstalledPlugin[]
  /** loader entries（宿主内）；null = CLI 无 loader 形态 */
  loaderEntries: Iterable<LoaderEntry> | null
  /** profile package.json 的 dsh.profile.bundles 数组 */
  bundles: string[]
  /** profile cordis.patch.yml 覆盖行（readProfileOverrides 产物） */
  profileOverrides: Array<{ id: string; disabled: boolean }>
}

function mapPhase(fiber: LoaderEntry['fiber']): LivePhase {
  if (fiber === undefined || fiber === null) return null
  const state = typeof fiber.state === 'string' ? Number(fiber.state) : fiber.state
  if (typeof state !== 'number' || !Number.isInteger(state)) return null
  return FIBER_PHASE[state] ?? null
}

/** 按模块名在 loader 条目中找插件的第一条非 group 条目（官方 moduleName 匹配同款）。 */
function findLoaderEntry(entries: Iterable<LoaderEntry>, pkg: string): LoaderEntry | null {
  for (const entry of entries) {
    if (entry && entry.options?.name === pkg) return entry
  }
  return null
}

/**
 * 已装清单 → 每包 { enabled, phase, granularity, toggleable, lockReason }。
 * toggleable=false 当且仅当：命中保护名单（protected/self）或「不在 bundles 且
 * loader 无 entry」（no-entry——未装载不是被关）。粒度由包内补丁层行枚举决定。
 */
export function composeEnablement(input: ComposeEnablementInput): Map<string, PluginEnablement> {
  const { items, loaderEntries, bundles, profileOverrides } = input
  const result = new Map<string, PluginEnablement>()
  const overrideIndex = new Map(profileOverrides.map((row) => [row.id, row.disabled]))
  for (const item of items) {
    const pkg = item.pkg
    const entry = loaderEntries !== null ? findLoaderEntry(loaderEntries, pkg) : null
    const inBundles = bundles.includes(pkg)
    const rowIds = item.patchRows?.inserts.map((row) => row.id) ?? []

    let enabled: boolean
    let phase: LivePhase = null
    if (loaderEntries !== null) {
      // loader 是活体权威：无 entry = 未运行（bundle 未选 / 树缺条目），enabled:false
      enabled = entry !== null && !entry.disabled
      if (entry !== null) phase = mapPhase(entry.fiber)
    } else {
      // CLI 无 loader 形态：在 bundles 且其补丁行无 disabled 覆盖 → 视为启用
      const disabledByOverride = rowIds.some((id) => overrideIndex.get(id) === true)
      enabled = inBundles && !disabledByOverride
    }

    let lockReason: PluginEnablement['lockReason']
    // 有补丁层却不在 bundles = Bundle 退选（dsh-m / 官方插件页可再开），不是纯依赖
    const hasPatchLayer = Boolean(item.patchRows?.readable && item.patchRows.inserts.length)
    if (pkg === 'dsh-m') lockReason = 'self'
    else if (PROTECTED_MODULES.includes(pkg)) lockReason = 'protected'
    else if (entry === null && !inBundles && !hasPatchLayer) lockReason = 'no-entry'

    const granularity = item.patchRows && isSingleRowPlugin(item.patchRows) ? 'row' : 'bundle'
    result.set(pkg, {
      pkg,
      enabled,
      phase,
      granularity,
      toggleable: lockReason === undefined,
      ...(lockReason === undefined ? {} : { lockReason }),
    })
  }
  return result
}
