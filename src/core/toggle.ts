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
    return toggleViaService(service, item, enabled, granularity)
  }
  return toggleFallback(item, enabled, granularity, { profileDir, io, loaderHost: deps.loaderHost ?? loaderHost() })
}

// ---------- 委派路径 ----------

async function toggleViaService(
  service: PluginManagerLike,
  item: InstalledPlugin,
  enabled: boolean,
  granularity: 'row' | 'bundle',
): Promise<ToggleResult> {
  const warnings: string[] = []
  const before = await service.listPlugins()
  if (granularity === 'row') {
    const row = before.find((r) => r.moduleName === item.pkg)
    if (row === undefined) throw new ToggleError('unknown-plugin', `官方服务未列出该插件的合成条目: ${item.pkg}`)
    if (row.readOnlyReason === 'management-required') {
      throw new ToggleError('protected', `官方管理判定受保护: ${item.pkg}`)
    }
    if (row.readOnlyReason === 'unaddressable') {
      throw new ToggleError('unaddressable', `官方管理无法经 profile 补丁寻址: ${item.pkg}`)
    }
    const raw = await service.setPluginEnabled(row.entryId, enabled)
    const rich = applicationOf(raw)
    warnings.push(...rich.warnings)
    // applied 以复读为准；application 字段兜底
    const after = (await service.listPlugins()).find((r) => r.moduleName === item.pkg)
    let applied: ToggleResult['applied']
    if (rich.application === 'restart-required') {
      applied = 'restart-required'
    } else if (after === undefined) {
      applied = 'restart-required'
    } else {
      const fiberOk = enabled ? after.fiberPhase !== null && after.fiberPhase !== undefined : after.fiberPhase === null || after.fiberPhase === undefined
      applied = after.enabled === enabled && fiberOk ? 'live' : 'restart-required'
    }
    if (rich.application === 'overridden') warnings.push('被更高补丁层覆盖，落盘状态与请求不符——重启后以下层为准')
    return { pkg: item.pkg, enabled, applied, via: 'delegate', warnings }
  }
  const raw = await service.setBundleEnabled(item.pkg, enabled)
  const rich = applicationOf(raw)
  warnings.push(...rich.warnings)
  const applied = rich.application === 'restart-required' ? 'restart-required' : 'live'
  return { pkg: item.pkg, enabled, applied, via: 'delegate', warnings }
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
