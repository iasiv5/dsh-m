/**
 * 开关读路径合成（0.4.0，plan Task 4；GLOSSARY.md：开关/运行相位/委派降级）。
 *
 * 读路径始终自读（ADR-0001）：loader entries（经 live-plugin.ts 绑定的宿主引用）
 * ⋈ 已装清单（installed.ts，含包内补丁层行枚举）⋈ profile bundles 数组 ⋈ profile
 * 覆盖行。委派/降级两模式共用同一读法，读路径零服务依赖。
 *
 * 观察量口径（官方 readPluginInventory 同款，多行聚合）：
 * - enabled = 同包全部 loader entry 中任一行 !entry.disabled（skip-browser-auth 0.4.x
 *   起同包双代门控行：休眠行 disabled:true + 活性行并存，任一启用即整包启用）；
 * - 「同包 entry」按官方 ownsLoaderEntry 归属口径认领（name 精确/真子路径 + 载体
 *   insert id 认领，见 findLoaderEntries 注；issue #2，官方 #156 同口径）；
 * - phase = 首个启用行的 fiber.state 数字枚举投影（0 pending / 1 loading / 2 active /
 *   3 failed / 4 disposed→null / 5 unloading；fiber 不存在即 null）；
 * - CLI 无 loader 形态：enabled 从「在 bundles 且其补丁行无 disabled 覆盖」推断，
 *   phase 恒 null。
 *
 * PROTECTED_MODULES：'dsh-m' 自保护 + 逐字镜像官方全集（锚点：
 * @deepseek-ai/dsh-plugin-manager@0.2.1-rc.3 lib/index.js 的 protectedModules，
 * L1273-1291，17 项；0.2.1 新增 @deepseek-ai/dsh-api-remote-access）。
 * 每次 DSH 升级后 diff 官方名单同步（know-how 008 升级必查口径）。
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
  /** 意图停用（ADR-0033）：Bundle 退选 ∪ 行覆盖 disabled:true；仅 true 落键（沿 community:true 省略惯例）。 */
  userDisabled?: true
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
  '@deepseek-ai/dsh-api-remote-access',
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

/**
 * 条目归属两规则（issue #2；官方 dshmarket themes.ts ownsLoaderEntry / verify.ts
 * carriedRowLive #156 同口径）：
 * 1. name 精确或「pkg/」真子路径（`dsh-ops/shell` 归 `dsh-ops`；斜杠边界防
 *    `@scope/pkg2` 被 `@scope/pkg` 误吞）；
 * 2. name 无关的载体条目（carrier bundle：包自身不挂插件、patch 插入的是别的
 *    模块，如 dsh-complex-project-preset 挂 @deepseek-ai/dsh-agent-preset）——
 *    条目 id 出自本包 patch 插入行，唯一属于本包，按裸 id（剥 include:<key>:<id>
 *    前缀）比对 insert id 集合认领。
 */
function nameMatchesPackage(name: string | undefined, pkg: string): boolean {
  return name !== undefined && (name === pkg || name.startsWith(`${pkg}/`))
}

/** loader 条目 id 双投影：顶层 id（dsh-m 行开关读法）或 options.id（官方读法），取先到非空者。 */
function loaderEntryId(entry: LoaderEntry): string | null {
  if (typeof entry.id === 'string' && entry.id !== '') return entry.id
  const optionId = entry.options?.id
  return typeof optionId === 'string' && optionId !== '' ? optionId : null
}

/** loader id 可能带 include 前缀（include:<key>:<id>）；裸 id 才是补丁行声明的形态（官方同注）。 */
function bareEntryId(id: string): string {
  return id.split(':').pop() ?? id
}

/** 按官方 ownsLoaderEntry 归属口径收集插件的全部条目（同包可有多行：双代门控/多子路径/多载体行）。 */
function findLoaderEntries(entries: Iterable<LoaderEntry>, pkg: string, ownedIds: ReadonlySet<string>): LoaderEntry[] {
  const found: LoaderEntry[] = []
  for (const entry of entries) {
    if (!entry) continue
    if (nameMatchesPackage(entry.options?.name, pkg)) found.push(entry)
    else {
      const id = loaderEntryId(entry)
      if (id !== null && ownedIds.has(bareEntryId(id))) found.push(entry)
    }
  }
  return found
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
    const rowIds = item.patchRows?.inserts.map((row) => row.id) ?? []
    // 本包 patch 声明的 insert id 集合 = 载体条目认领凭据（官方 carriedRowLive 同源）
    const ownedIds = new Set(rowIds)
    const matches = loaderEntries !== null ? findLoaderEntries(loaderEntries, pkg, ownedIds) : []
    const entry = matches[0] ?? null
    const inBundles = bundles.includes(pkg)
    // 用户意图停用的持久层信号（ADR-0033）：行覆盖 disabled:true（活体/CLI 两分支共用）；
    // hasPatchLayer 提前（Bundle 退选判据要用了）——有补丁层却不在 bundles = 用户退选，非纯依赖
    const disabledByOverride = rowIds.some((id) => overrideIndex.get(id) === true)
    const hasPatchLayer = Boolean(item.patchRows?.readable && item.patchRows.inserts.length)
    const userDisabled = (!inBundles && hasPatchLayer) || disabledByOverride

    let enabled: boolean
    let phase: LivePhase = null
    if (loaderEntries !== null) {
      // loader 是活体权威：无 entry = 未运行（bundle 未选 / 树缺条目），enabled:false。
      // 同包多行（双代门控，如 skip-browser-auth 的 webRuntime 行 + webStartup 行）
      // 「任一行启用」即整包启用——单取首行会把首行恰为自门控休眠行（disabled:true）
      // 的整包误报成停用（2026-10-19 实测，官方页口径一致）。
      enabled = matches.some((row) => !row.disabled)
      const liveRow = matches.find((row) => !row.disabled)
      if (liveRow !== undefined) phase = mapPhase(liveRow.fiber)
    } else {
      // CLI 无 loader 形态：在 bundles 且其补丁行无 disabled 覆盖 → 视为启用
      enabled = inBundles && !disabledByOverride
    }

    let lockReason: PluginEnablement['lockReason']
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
      // 意图停用仅 true 落键（沿 community:true 省略惯例）——门控挡下/失败/no-entry 永不构成
      ...(userDisabled ? { userDisabled: true } : {}),
      ...(lockReason === undefined ? {} : { lockReason }),
    })
  }
  return result
}
