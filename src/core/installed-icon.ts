/**
 * 已装面板图标解析（ADR-0025）：官方 iconOf 语义复刻（dsh-app-boot lib/index.js L2085-2119）。
 * 主来源：manifest.icon 包内相对路径；兜底：exports `<pkg>/icon`（best-effort，resolve 失败即 null）。
 * containment 对齐官方两面 realpath（评审 R-3Q1）：root 与 target 都 realpath 后 relative 判逃逸
 * （官方 L2092-2095）；stat 与读文件亦用 realpath（官方 L2104-2106）。任何失败返回 null，绝不 throw——
 * 图标是装饰性数据，不允许影响已装列表可用性（全局约束 5）。
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 扩展名 → media type（对齐官方 ICON_MEDIA_TYPES，L2078-2084）。 */
export const ICON_MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])

/** 单文件上限（对齐官方 MAX_ICON_BYTES，L2077）。 */
export const MAX_ICON_BYTES = 256 * 1024

const SCHEME_RE = /^[A-Za-z][A-Za-z\d+.-]*:/

/** manifest.icon 主臂（官方 L2090-2095）：相对路径校验 → 两面 realpath containment。 */
function manifestIconTarget(dir: string, raw: string): string | null {
  if (isAbsolute(raw) || win32.isAbsolute(raw) || SCHEME_RE.test(raw)) return null
  let root: string
  try {
    root = realpathSync(dir)
  } catch {
    return null
  }
  const target = resolve(root, raw)
  let real: string
  try {
    real = realpathSync(target)
  } catch {
    return null
  }
  const local = relative(root, real)
  if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) return null
  return target
}

/** exports `<pkg>/icon` 兜底臂（官方 L2096-2100）。best-effort：运行环境无 import.meta.resolve（如打包改写）→ null。 */
type ResolveFn = (specifier: string) => string
let cachedResolve: ResolveFn | null | undefined
function nodeResolve(): ResolveFn | null {
  if (cachedResolve !== undefined) return cachedResolve
  try {
    const fn = (import.meta as unknown as { resolve?: ResolveFn }).resolve
    cachedResolve = typeof fn === 'function' ? (specifier: string) => fn.call(import.meta, specifier) : null
  } catch {
    cachedResolve = null
  }
  return cachedResolve
}

function exportIconTarget(pkg: string): string | null {
  const resolveFn = nodeResolve()
  if (!resolveFn) return null
  let href: unknown
  try {
    href = resolveFn(`${pkg}/icon`)
  } catch {
    return null
  }
  if (typeof href !== 'string' || !href.startsWith('file:')) return null
  try {
    return fileURLToPath(href)
  } catch {
    return null
  }
}

/** 官方 assertPackageOwned（L2113-2119）：realpath 的祖先链上必须存在 name 匹配的 package.json。 */
function ownedByPackage(file: string, pkg: string): boolean {
  let real: string
  try {
    real = realpathSync(file)
  } catch {
    return false
  }
  for (let directory = resolve(real, '..'); ; directory = resolve(directory, '..')) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
        if (
          parsed !== null && typeof parsed === 'object' &&
          (parsed as { name?: unknown }).name === pkg
        ) return true
      } catch {
        /* 坏 manifest 不属于本包，继续向上 */
      }
    }
    const parent = resolve(directory, '..')
    if (parent === directory) return false
  }
}

/** 终态（官方 L2102-2110）：扩展名白名单 → realpath stat isFile → 双重 256KiB → data URI。 */
function emitIcon(target: string): string | null {
  const mediaType = ICON_MEDIA_TYPES.get(extname(target).toLowerCase())
  if (mediaType === undefined) return null
  let file: string
  try {
    file = realpathSync(target)
  } catch {
    return null
  }
  let stat
  try {
    stat = statSync(file)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.size > MAX_ICON_BYTES) return null
  let bytes: Buffer
  try {
    bytes = readFileSync(file)
  } catch {
    return null
  }
  if (bytes.length > MAX_ICON_BYTES) return null
  return `data:${mediaType};base64,${bytes.toString('base64')}`
}

/**
 * 解析已装插件的声明图标为 data URI。
 * @param dir 包目录（可能是 symlink 安装路径——root 面会 realpath，评审 R-3Q1）
 * @param raw manifest.icon 原始字符串（undefined/空 = 未声明，走 exports 兜底臂）
 * @param pkg 包名（exports 兜底臂的 specifier 与归属校验用）
 * @returns data URI；任何一步失败返回 null，绝不 throw
 */
export async function manifestIconToDataUri(dir: string, raw: string | undefined, pkg?: string): Promise<string | null> {
  try {
    if (typeof raw === 'string') {
      const icon = raw.trim()
      if (icon === '') return null
      const target = manifestIconTarget(dir, icon)
      return target ? emitIcon(target) : null
    }
    if (pkg) {
      const exported = exportIconTarget(pkg)
      if (exported && ownedByPackage(exported, pkg)) return emitIcon(exported)
    }
    return null
  } catch {
    return null
  }
}

/**
 * 已装条目就地富化 iconDataUri（ADR-0025 T3）：并行读盘（本机 ≤256KiB/包）；
 * 声明缺席 → 键保持 undefined；声明存在但解析失败 → 显式 null（与「未声明」区分）。
 * 只允许被详情路径（listInstalledWithMeta opts.icon）调用——市场查询热路径豁免（全局约束 4）。
 */
export async function attachInstalledIconDataUris<T extends { pkg: string; path: string; manifestIcon?: string; iconDataUri?: string | null }>(
  items: T[],
): Promise<void> {
  await Promise.all(items.map(async (it) => {
    if (!it.manifestIcon) return
    it.iconDataUri = await manifestIconToDataUri(it.path, it.manifestIcon, it.pkg)
  }))
}

/**
 * 市场条目 join 本机声明图标（ADR-0025 增补，主人修订 2026-10-27）：精选/社区页对「恰好已装本机」
 * 的条目补 iconDataUri——logo 在本机盘上就不该因清单数据未推送而空转链①。
 * 读盘页面级有界：仅返回页内 matched 条目（≤页大小）触发读盘（全局约束 4 修订后的边界）。
 * 客户端候选序不变：目录 icon URL 优先、本机 data URI 次之（icon-view.js 契约）。
 */
export async function attachEntryIconDataUris<T extends { installedPkg?: string; iconDataUri?: string | null }>(
  entries: T[],
  installedItems: ReadonlyArray<{ pkg: string; path: string; manifestIcon?: string }>,
): Promise<void> {
  if (installedItems.length === 0) return
  const byPkg = new Map(installedItems.map((it) => [it.pkg, it]))
  await Promise.all(entries.map(async (e) => {
    const inst = e.installedPkg !== undefined ? byPkg.get(e.installedPkg) : undefined
    if (!inst?.manifestIcon) return
    e.iconDataUri = await manifestIconToDataUri(inst.path, inst.manifestIcon, inst.pkg)
  }))
}
