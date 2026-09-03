/**
 * 已装插件识别（DESIGN.md §3）：profile 的 package.json 是唯一事实源，
 * 不引入额外状态文件。移植自 skillhub installed-plugins.ts（去 README 暂缓）。
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isSafePluginTarget, removeDshPlugin, type PluginRunner } from './dsh-cli.js'
import { webProfileDir } from './env.js'

const PKG_NAME_RE = /^(@[A-Za-z0-9-*~][A-Za-z0-9-*._~]*\/)?[A-Za-z0-9-._~]+$/

export type PluginSource = 'github' | 'npm' | 'link' | 'file' | 'unknown'

export interface InstalledPlugin {
  /** profile package.json dependencies 里的键名 */
  pkg: string
  name: string
  version: string
  description: string
  homepage: string
  /** profile package.json 中记录的安装 spec */
  spec: string
  source: PluginSource
  /** package.json 含 dsh 字段即视为 dsh 插件 */
  dsh: boolean
  path: string
}

export interface InstalledPluginsResult {
  items: InstalledPlugin[]
  /** 非 dsh 依赖（含解析失败）的数量 */
  others: number
  profileDir: string
}

export function isSafePkgName(raw: string): boolean {
  const name = String(raw || '').trim()
  if (!name || name.length > 214) return false
  if (!PKG_NAME_RE.test(name)) return false
  return !name.split('/').some((part) => part === '' || part === '.' || part.startsWith('.') || part.startsWith('_') || part.includes('..'))
}

export function parseSpecSource(spec: string): PluginSource {
  const raw = String(spec || '').trim()
  if (raw.startsWith('link:')) return 'link'
  if (raw.startsWith('file:')) return 'file'
  if (raw.startsWith('github:') || /^https:\/\/github\.com\//i.test(raw)) return 'github'
  if (raw) return 'npm'
  return 'unknown'
}

/** 解析依赖的包目录：普通依赖限制在 profile node_modules 内；link:/file: 仅接受绝对路径。 */
export function resolvePluginDir(profileDir: string, pkg: string, spec: string): string | null {
  if (!isSafePkgName(pkg)) return null
  const source = parseSpecSource(spec)
  if (source === 'link' || source === 'file') {
    const target = String(spec).slice(spec.indexOf(':') + 1).trim()
    if (!target.startsWith('/') || target.includes('\0')) return null
    return resolve(target)
  }
  return join(resolve(profileDir), 'node_modules', pkg)
}

interface PkgJson {
  name?: unknown
  version?: unknown
  description?: unknown
  homepage?: unknown
  dsh?: unknown
}

export async function readPkgJson(dir: string): Promise<PkgJson | null> {
  try {
    const raw = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as PkgJson
    return raw && typeof raw === 'object' ? raw : null
  } catch {
    return null
  }
}

export async function readProfileDeps(profileDir: string): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dependencies?: unknown }
    if (!raw || typeof raw !== 'object' || !raw.dependencies || typeof raw.dependencies !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [name, spec] of Object.entries(raw.dependencies as Record<string, unknown>)) {
      if (typeof spec === 'string' && spec !== '') out[name] = spec
    }
    return out
  } catch {
    return {}
  }
}

function sanitizePkgJson(raw: PkgJson, fallbackName: string): Omit<InstalledPlugin, 'pkg' | 'spec' | 'source' | 'dsh'> {
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : fallbackName,
    version: typeof raw.version === 'string' ? raw.version.trim().slice(0, 64) : '',
    description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 500) : '',
    homepage: typeof raw.homepage === 'string' && /^https?:\/\//i.test(raw.homepage) ? raw.homepage.slice(0, 300) : '',
    path: '',
  }
}

/** 枚举 web profile 已安装插件（只读）。 */
export async function listInstalledPlugins(profileDir: string = webProfileDir()): Promise<InstalledPluginsResult> {
  const root = resolve(profileDir)
  const deps = await readProfileDeps(root)
  const items: InstalledPlugin[] = []
  let others = 0
  for (const pkg of Object.keys(deps).sort()) {
    const spec = deps[pkg]
    const dir = resolvePluginDir(root, pkg, spec)
    const raw = dir ? await readPkgJson(dir) : null
    if (!raw || !('dsh' in raw)) {
      others += 1
      continue
    }
    const info = sanitizePkgJson(raw, pkg)
    items.push({
      pkg,
      name: info.name,
      version: info.version,
      description: info.description,
      homepage: info.homepage,
      spec,
      source: parseSpecSource(spec),
      dsh: true,
      path: dir as string,
    })
  }
  return { items, others, profileDir: root }
}

/** 从 web profile 卸载已安装的 dsh 插件。pkg 必须来自 profile 依赖（先 live-disable，见 market.ts）。 */
export async function removeInstalledPlugin(
  pkg: string,
  profileDir: string = webProfileDir(),
  deps: { runDshPlugin?: PluginRunner } = {},
): Promise<{ pkg: string }> {
  const key = String(pkg || '').trim()
  if (!isSafePkgName(key) || !isSafePluginTarget(key)) throw new Error(`无效插件包名: ${pkg}`)
  const root = resolve(profileDir)
  const listed = await readProfileDeps(root)
  if (!(key in listed)) throw new Error(`web profile 未安装该插件: ${key}`)
  const dir = resolvePluginDir(root, key, listed[key])
  const raw = dir ? await readPkgJson(dir) : null
  if (!raw || !('dsh' in raw)) throw new Error(`不是 dsh 插件: ${key}`)
  await removeDshPlugin(key, deps)
  return { pkg: key }
}
