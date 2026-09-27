/**
 * 开关写路径编排（0.4.0，plan Task 5；ADR-0001 委派降级）。
 *
 * 判定顺序（Rev2.1 定稿）：
 * ① 保护门最先（纯名单检查，无需枚举已装清单——空 profile 下 CLI 冒烟也得 protected）；
 * ② 不在已装清单 → not-installed；
 * ③ 粒度路由：单 insert 行插件 → 行覆盖；多行/不可解析 → Bundle 选择；
 * ④ 委派优先：`getService()` 探测官方 pluginManager（运行时探测，不判版本号），
 *    官方 readOnlyReason 映射：'management-required'→protected、'unaddressable'→unaddressable；
 *    applied 以复读为准（官方富结果 application 字段鸭子读兜底）；
 * ⑤ 降级：行级 = 锁内保注释 YAML 编辑 + `setLivePluginDisabled(pkg, !enabled)` 活体
 *    （注意 live-plugin.ts 第二参是 disabled，方向取反）；bundle 级 = 锁内 bundles 数组
 *    编辑，恒 restart-required。
 *
 * 锁：与官方同款 `withFileLock(<profile>/package.json)`（dsh-atomic-write，锁文件
 * `package.json.lock`、wx 独占）——防与官方 UI 并发编辑 cordis.patch.yml 丢更新。
 * 开关不经 Profile 变更事务（grilling Q1）：单文件轻量编辑、幂等可逆。
 */
import { readFile as fsReadFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { listInstalledPlugins, type InstalledPlugin } from './installed.js'
import { isSingleRowPlugin, planRowOverride } from './patch-yaml.js'
import { PROTECTED_MODULES } from './enablement.js'
import { setLivePluginDisabled, loaderHost, type LoaderEntry, type LoaderHost } from './live-plugin.js'
import { webProfileDir } from './env.js'

export interface ToggleResult {
  pkg: string
  enabled: boolean
  applied: 'live' | 'restart-required'
  via: 'delegate' | 'fallback'
  warnings: string[]
}

export interface PluginManagerRow {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase?: string | null
  readOnlyReason?: 'management-required' | 'unaddressable'
}

/** 官方 pluginManager 服务的最小结构投影（ctx.get 运行时探测，无静态依赖）。 */
export interface PluginManagerLike {
  listPlugins(): Promise<PluginManagerRow[]>
  setPluginEnabled(id: string, enabled: boolean): Promise<unknown>
  setBundleEnabled(name: string, enabled: boolean): Promise<unknown>
}

export type ToggleErrorCode = 'protected' | 'not-installed' | 'unaddressable' | 'unknown-plugin'

export class ToggleError extends Error {
  readonly code: ToggleErrorCode
  constructor(code: ToggleErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface ToggleIo {
  readFile: typeof fsReadFile
}

export interface ToggleDeps {
  profileDir?: string
  getService?: () => PluginManagerLike | undefined
  loaderHost?: LoaderHost | undefined
  io?: ToggleIo
}

/** 官方 change() 富结果的鸭子读（不建类型依赖）。 */
function applicationOf(result: unknown): { application?: string; warnings: string[] } {
  if (result && typeof result === 'object') {
    const record = result as { application?: unknown; warnings?: unknown }
    return {
      application: typeof record.application === 'string' ? record.application : undefined,
      warnings: Array.isArray(record.warnings) ? record.warnings.map((w) => String(w)) : [],
    }
  }
  return { warnings: [] }
}

async function readPatchText(io: ToggleIo, path: string): Promise<string> {
  try {
    return await io.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '[]\n'
    throw error
  }
}

interface BundlesManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: unknown } }
  [key: string]: unknown
}

export async function togglePlugin(pkg: string, enabled: boolean, deps: ToggleDeps = {}): Promise<ToggleResult> {
  const key = String(pkg || '').trim()
  // ① 保护门最先：纯名单检查（空 profile 也先于 not-installed 命中）
  if (key === 'dsh-m' || PROTECTED_MODULES.includes(key)) {
    throw new ToggleError('protected', `受保护插件不可开关: ${key}（dsh-m 自身或官方宿主命脉）`)
  }
  const io = deps.io ?? { readFile: fsReadFile }
  const profileDir = deps.profileDir ?? webProfileDir()
  // ② 在装判定
  const installed = await listInstalledPlugins(profileDir)
  const item = installed.items.find((it) => it.pkg === key)
  if (item === undefined) throw new ToggleError('not-installed', `web profile 未安装该插件: ${key}`)

  const granularity = item.patchRows && isSingleRowPlugin(item.patchRows) ? 'row' : 'bundle'
  const service = deps.getService?.()

  if (service !== undefined) {
    // 委派一律走 Bundle 选择（官方插件页主开关同层，两层 UI 状态一致；
    // 行覆盖残留由启用路径的清理扫描兜底）。行覆盖仅是降级路径的实现细节。
    return toggleViaService(service, item, enabled)
  }
  // 降级：Bundle 退选态的「启用」必须走 bundles 编辑（行覆盖救不回未合成的树）
  let inBundles = false
  try {
    const manifest = JSON.parse(await io.readFile(join(profileDir, 'package.json'), 'utf8')) as BundlesManifest
    const bundles = manifest?.dsh?.profile?.bundles
    inBundles = Array.isArray(bundles) && bundles.includes(item.pkg)
  } catch {
    /* 读不到按不在 bundles 处理 */
  }
  const route: 'row' | 'bundle' = enabled && !inBundles ? 'bundle' : granularity
  return toggleFallback(item, enabled, route, { profileDir, io, loaderHost: deps.loaderHost ?? loaderHost() })
}

// ---------- 委派路径 ----------

async function toggleViaService(
  service: PluginManagerLike,
  item: InstalledPlugin,
  enabled: boolean,
): Promise<ToggleResult> {
  const warnings: string[] = []
  // 启用前清理本插件的历史行覆盖（dsh-m 单开关模型：行覆盖是它自己写下的，
  // 不清则 bundle 重选后旧行仍 disabled，官方页第二层会出现一开一关）
  if (enabled) {
    const cleared = await clearRowOverrides(service, item.pkg, warnings)
    if (cleared > 0) warnings.push(`已清理 ${cleared} 条历史行覆盖`)
  }
  const raw = await service.setBundleEnabled(item.pkg, enabled)
  const rich = applicationOf(raw)
  warnings.push(...rich.warnings)
  if (enabled) {
    // selectBundle 后才可见的行覆盖（bundle 退选期 loader 无条目）再扫一遍
    await clearRowOverrides(service, item.pkg, warnings)
  }
  // applied 复读：bundle on → 该模块行应存在且启用；bundle off → 行消失或全禁用
  const after = (await service.listPlugins()).filter((r) => r.moduleName === item.pkg)
  const running = after.some((r) => r.enabled)
  let applied: ToggleResult['applied']
  if (rich.application === 'restart-required') applied = 'restart-required'
  else applied = running === enabled ? 'live' : 'restart-required'
  if (rich.application === 'overridden') warnings.push('被更高补丁层覆盖，落盘状态与请求不符——重启后以下层为准')
  return { pkg: item.pkg, enabled, applied, via: 'delegate', warnings }
}

/** 清理本插件可见的 disabled 行覆盖（跳过官方 readOnly 行）；返回清理条数。 */
async function clearRowOverrides(
  service: PluginManagerLike,
  pkg: string,
  warnings: string[],
): Promise<number> {
  const rows = (await service.listPlugins()).filter(
    (r) => r.moduleName === pkg && !r.readOnlyReason && r.enabled === false,
  )
  let cleared = 0
  for (const row of rows) {
    const rich = applicationOf(await service.setPluginEnabled(row.entryId, true))
    warnings.push(...rich.warnings)
    cleared += 1
  }
  return cleared
}

// ---------- 降级路径 ----------

interface FallbackCtx {
  profileDir: string
  io: ToggleIo
  loaderHost: LoaderHost | undefined
}

async function toggleFallback(
  item: InstalledPlugin,
  enabled: boolean,
  granularity: 'row' | 'bundle',
  ctx: FallbackCtx,
): Promise<ToggleResult> {
  if (granularity === 'row') {
    return toggleRowFallback(item, enabled, ctx)
  }
  return toggleBundleFallback(item, enabled, ctx)
}

/** 行覆盖降级：锁内保注释 YAML 编辑 + loader 活体翻转。 */
async function toggleRowFallback(item: InstalledPlugin, enabled: boolean, ctx: FallbackCtx): Promise<ToggleResult> {
  const loaderEntry = findLoaderEntryByName(ctx.loaderHost, item.pkg)
  const insert = item.patchRows?.readable ? item.patchRows.inserts[0] : undefined
  const id = loaderEntry?.id ?? insert?.id
  const name = loaderEntry?.options?.name ?? insert?.name
  if (id === undefined || id === '') {
    throw new ToggleError('unknown-plugin', `无法定位该插件的合成条目 id（loader 与补丁行均无）: ${item.pkg}`)
  }
  const patchPath = join(ctx.profileDir, 'cordis.patch.yml')
  let liveFound = false
  await withFileLock(join(ctx.profileDir, 'package.json'), async () => {
    const text = await readPatchText(ctx.io, patchPath)
    const plan = planRowOverride(text, id, name, enabled)
    if (plan.changed) {
      await writeFileAtomic(patchPath, plan.text, { mode: 0o600 })
    }
  })
  liveFound = await setLivePluginDisabled(item.pkg, !enabled, ctx.loaderHost)
  return {
    pkg: item.pkg,
    enabled,
    applied: liveFound ? 'live' : 'restart-required',
    via: 'fallback',
    warnings: [],
  }
}

function findLoaderEntryByName(host: LoaderHost | undefined, pkg: string): LoaderEntry | null {
  const entries = host?.loader?.entries
  if (typeof entries !== 'function') return null
  for (const entry of entries.call(host!.loader)) {
    if (entry && entry.options?.name === pkg) return entry
  }
  return null
}

/** Bundle 选择降级：锁内 bundles 数组编辑（恒 restart-required）。 */
async function toggleBundleFallback(
  item: InstalledPlugin,
  enabled: boolean,
  ctx: FallbackCtx,
): Promise<ToggleResult> {
  const manifestPath = join(ctx.profileDir, 'package.json')
  await withFileLock(join(ctx.profileDir, 'package.json'), async () => {
    if (enabled) {
      // 启用即清本包历史行覆盖（与委派路径同语义）
      const patchPath = join(ctx.profileDir, 'cordis.patch.yml')
      let patchText = '[]\n'
      try {
        patchText = await ctx.io.readFile(patchPath, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      let patchMutated = false
      for (const insert of item.patchRows?.inserts ?? []) {
        const plan = planRowOverride(patchText, insert.id, insert.name, true)
        if (plan.changed) {
          patchText = plan.text
          patchMutated = true
        }
      }
      if (patchMutated) await writeFileAtomic(patchPath, patchText, { mode: 0o600 })
    }
    let raw: string
    try {
      raw = await ctx.io.readFile(manifestPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') raw = '{}'
      else throw error
    }
    const doc = JSON.parse(raw) as BundlesManifest
    if (typeof doc.dsh !== 'object' || doc.dsh === null) doc.dsh = {}
    if (typeof doc.dsh.profile !== 'object' || doc.dsh.profile === null) doc.dsh.profile = {}
    const previous = Array.isArray(doc.dsh.profile.bundles) ? doc.dsh.profile.bundles : []
    const bundles = enabled
      ? previous.includes(item.pkg) ? previous : [...previous, item.pkg]
      : previous.filter((name) => name !== item.pkg)
    doc.dsh.profile.bundles = bundles
    await writeFileAtomic(manifestPath, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 })
  })
  return { pkg: item.pkg, enabled, applied: 'restart-required', via: 'fallback', warnings: [] }
}
