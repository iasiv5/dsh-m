/**
 * 已装插件识别（DESIGN.md §3）：profile 的 package.json 是唯一事实源，
 * 不引入额外状态文件。移植自 skillhub installed-plugins.ts（去 README 暂缓）。
 *
 * 完整性契约（2026-09-09）：枚举结果必含 `complete`——只有当顶层 manifest 与每个
 * 依赖的 package.json 都可读、可解析为非数组对象、且每项都能归类（DSH 插件 → items /
 * 确认非 DSH → others）时才为 true；任一项「无法判断」即 complete:false（partial 结果
 * 保留，该依赖不计入 others）。当前 complete 仅被 listMarket → dshm_search 消费；
 * 已装列表（listInstalledWithMeta）/ dshm_list / CLI list·outdated / 升级路径的
 * incomplete 展示与处理为后续独立任务。
 */
import { open, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { webProfileDir } from './env.js'
import { readBundlePatchRows, type BundlePatchRows } from './patch-yaml.js'

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
  /** package.json repository 解析出的 github owner/repo（头像用） */
  githubRepo?: string | null
  /** 包内 cordis.patch.yml（dsh.bundle.patch 层）的行枚举——开关粒度判定原料；文件缺失 → readable:false */
  patchRows?: BundlePatchRows
  /** package.json 顶层 icon 原始字符串（未校验，ADR-0025 声明图标链①原料；未声明 → undefined） */
  manifestIcon?: string
}

export interface InstalledPluginsResult {
  items: InstalledPlugin[]
  /** 已完整判定 profile dependencies 中每一项是否为 DSH 插件；任一项无法判断即为 false（partial 结果保留）。 */
  complete: boolean
  /** 已成功读取合法 package.json 且确认不含 dsh 字段的依赖数；无法读取或解析的依赖不计入，并令 complete=false。 */
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

/**
 * 解析依赖的包目录：
 * - `link:` 是活的开发目录符号链接，解析真实目标（已装页展示本地路径有价值）；
 * - 其余（npm / github / file-tarball / file-dir）pnpm 都会把内容物化到 node_modules/<pkg>，
 *   统一从那里读。skillhub 同款语义——file: 特判回 tarball 路径是错的（读不到 package.json）。
 */
export function resolvePluginDir(profileDir: string, pkg: string, spec: string): string | null {
  if (!isSafePkgName(pkg)) return null
  const source = parseSpecSource(spec)
  if (source === 'link') {
    const target = String(spec).slice('link:'.length).trim()
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
  repository?: unknown
  /** 顶层声明图标（ADR-0025；原样透传 manifestIcon，解析与校验在 installed-icon.ts） */
  icon?: unknown
}

/** 从 repository 字段（字符串或 {url}，git+/ssh/https 形态）提取 github owner/repo。
 * 0.9.49：尾部放宽到 [/?#] 或结尾（与 versions.ts extractGithubRepo 同口径）——
 * 此前 github.com/o/r/（尾斜杠）与更深路径解析不出。 */
export function githubRepoFromRepository(raw: unknown): string | null {
  let url = ''
  if (typeof raw === 'string') url = raw
  else if (raw && typeof raw === 'object') {
    const u = (raw as { url?: unknown }).url
    if (typeof u === 'string') url = u
  }
  const m = /github\.com[/:]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#]|$)/i.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

/** JSON 合法根：非 null、非数组的对象（typeof [] === 'object'，数组必须显式排除）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export interface PkgJsonReadResult {
  ok: boolean
  value?: PkgJson
}

/** 单包 package.json 唯一读取实现：读不到 / 坏 JSON / 根非对象一律 ok:false。 */
async function readPkgJsonResult(dir: string): Promise<PkgJsonReadResult> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  } catch {
    return { ok: false }
  }
  if (!isRecord(raw)) return { ok: false }
  return { ok: true, value: raw as PkgJson }
}

export async function readPkgJson(dir: string): Promise<PkgJson | null> {
  const result = await readPkgJsonResult(dir)
  return result.ok ? result.value ?? null : null
}

export interface ProfileDepsReadResult {
  complete: boolean
  /** 已确认合法的依赖（partial）：顶层不可读时为空；个别非法项只降 complete，不丢弃其他合法项。 */
  deps: Record<string, string>
}

/** 空 deps 统一无原型容器：与逐项解析产物保持同一原型语义，继承属性不得伪装成依赖成员。 */
function emptyDeps(): Record<string, string> {
  return Object.create(null)
}

/**
 * 顶层 profile package.json 唯一读取实现（完整性 + partial 语义）：
 * - 读不到 / 坏 JSON / 根非数组对象 → complete:false, deps:{}（manifest 缺失 ≠ 合法空 profile）；
 * - 合法但无 dependencies 字段，或 dependencies 为空对象 → complete:true, deps:{}（唯一合法空形态）；
 * - dependencies 存在但类型非法（null/数组/标量）→ complete:false, deps:{}；
 * - 逐项：key 不安全（isSafePkgName 拒绝 `__proto__`、`_`/`.` 开头分段等）或 spec 非字符串/纯空白
 *   → 该项计入 incomplete（complete:false）并跳过，其余合法项保留。
 *   容器为无原型对象（Object.create(null)）——第二层防御：特殊属性名不受 Object.prototype
 *   setter/继承语义影响，数据结构与早退路径的空容器保持一致。
 */
async function readProfileDepsResult(profileDir: string): Promise<ProfileDepsReadResult> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  } catch {
    return { complete: false, deps: emptyDeps() }
  }
  if (!isRecord(raw)) return { complete: false, deps: emptyDeps() }
  if (!Object.prototype.hasOwnProperty.call(raw, 'dependencies')) return { complete: true, deps: emptyDeps() }
  const dependencies = raw.dependencies
  if (!isRecord(dependencies)) return { complete: false, deps: emptyDeps() }
  let complete = true
  const deps: Record<string, string> = emptyDeps()
  for (const [name, spec] of Object.entries(dependencies)) {
    if (!isSafePkgName(name)) {
      complete = false
      continue
    }
    if (typeof spec !== 'string' || spec.trim() === '') {
      complete = false
      continue
    }
    deps[name] = spec
  }
  return { complete, deps }
}

/** 宽松读取（README 路径）：只返回可确认的依赖项，个别非法项被跳过而不是整体丢弃。 */
export async function readProfileDeps(profileDir: string): Promise<Record<string, string>> {
  return (await readProfileDepsResult(profileDir)).deps
}

function sanitizePkgJson(raw: PkgJson, fallbackName: string): Omit<InstalledPlugin, 'pkg' | 'spec' | 'source' | 'dsh'> {
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : fallbackName,
    version: typeof raw.version === 'string' ? raw.version.trim().slice(0, 64) : '',
    description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 500) : '',
    homepage: typeof raw.homepage === 'string' && /^https?:\/\//i.test(raw.homepage) ? raw.homepage.slice(0, 300) : '',
    path: '',
    githubRepo: githubRepoFromRepository(raw.repository),
    // ADR-0025：manifest.icon 原始值透传（未校验；解析在 installed-icon.ts）。截断 300 对齐 homepage 惯例。
    manifestIcon: typeof raw.icon === 'string' ? raw.icon.trim().slice(0, 300) || undefined : undefined,
  }
}

/**
 * 单依赖分类（并行化重构 2026-10-15）：完整搬运原串行循环体的判定顺序——
 * 目录解析失败 / package.json 读不到/坏 JSON/根非对象 → 'unknown'（无法判断 ≠ 非 DSH）；
 * 合法 manifest 无 dsh 字段 → 'other'；否则（wantPatch 时读补丁层）组装 InstalledPlugin → { item }。
 * 吞错边界：readPkgJsonResult / readBundlePatchRows 全程吞错，readTextLimited 吞 open 失败；
 * 其 fh.read 阶段的异常（如 EIO）不被吞、沿 Promise.all 整体传播——与旧串行版循环体内
 * 同样整体 reject 的语义等价（句柄在 finally 关闭，纯读无副作用）。
 */
type DepClassification = 'unknown' | 'other' | { item: InstalledPlugin }

async function classifyDep(root: string, pkg: string, spec: string, wantPatch: boolean): Promise<DepClassification> {
  const dir = resolvePluginDir(root, pkg, spec)
  if (!dir) return 'unknown'
  const rawResult = await readPkgJsonResult(dir)
  if (!rawResult.ok) return 'unknown'
  const raw = rawResult.value as PkgJson
  if (!('dsh' in raw)) return 'other'
  const info = sanitizePkgJson(raw, pkg)
  // 包内补丁层行枚举（开关粒度判定原料）：缺失 → readable:false（按多行 → Bundle 级处理）。
  // wantPatch=false（市场查询热路径）省略 patchRows 字段——不伪造 readable:false（那是
  // 「多行插件」的语义谎报）；消费方（enablement/toggle，listInstalledWithMeta 路径）全程 ?. 链。
  if (!wantPatch) {
    return {
      item: {
        pkg,
        name: info.name,
        version: info.version,
        description: info.description,
        homepage: info.homepage,
        spec,
        source: parseSpecSource(spec),
        dsh: true,
        path: dir,
        githubRepo: info.githubRepo,
        manifestIcon: info.manifestIcon,
      },
    }
  }
  const patchText = await readTextLimited(join(dir, 'cordis.patch.yml'), PATCH_MAX_BYTES)
  const patchRows = patchText
    ? readBundlePatchRows(patchText.text)
    : { inserts: [], configRows: 0, readable: false }
  return {
    item: {
      pkg,
      name: info.name,
      version: info.version,
      description: info.description,
      homepage: info.homepage,
      spec,
      source: parseSpecSource(spec),
      dsh: true,
      path: dir,
      githubRepo: info.githubRepo,
      manifestIcon: info.manifestIcon,
      patchRows,
    },
  }
}

/**
 * 枚举 web profile 已安装插件（只读）。complete:false 时 items/others 为 partial 结果（已确认部分保留）。
 * opts.patchRows=false：跳过每插件的 cordis.patch.yml 读取与 YAML 解析（热路径省 ~0.55ms/插件），
 * 产出的 item 不带 patchRows 字段——仅供不需要开关粒度原料的调用方（市场查询）使用。
 */
export async function listInstalledPlugins(
  profileDir: string = webProfileDir(),
  opts?: { patchRows?: boolean },
): Promise<InstalledPluginsResult> {
  const root = resolve(profileDir)
  const result = await readProfileDepsResult(root)
  let complete = result.complete
  const deps = result.deps
  const wantPatch = opts?.patchRows !== false
  // 每依赖文件读并发执行（原串行 for-await 是热路径上每次市场查询都重复支付的一半预算，
  // 14 依赖实测 IO 串行 ~11ms → 并行 ~2.5ms）；Promise.all 保序，输出仍按依赖键字典序。
  const keys = Object.keys(deps).sort()
  const classified = await Promise.all(keys.map((pkg) => classifyDep(root, pkg, deps[pkg], wantPatch)))
  const items: InstalledPlugin[] = []
  let others = 0
  for (const c of classified) {
    if (c === 'unknown') {
      // 依赖键不安全、目录无法解析、package.json 缺失/不可读/坏 JSON → 无法判断（不冒充非 DSH）
      complete = false
    } else if (c === 'other') {
      others += 1
    } else {
      items.push(c.item)
    }
  }
  return { items, others, complete, profileDir: root }
}

// ---------- README 预览（借鉴 skillhub，64KB 截断） ----------

const README_MAX_BYTES = 64 * 1024
const README_FILES = ['README.md', 'README.markdown', 'README']
/** 包内 cordis.patch.yml 读取上限（补丁层是小文件，256KB 远超正常体积）。 */
const PATCH_MAX_BYTES = 256 * 1024

export interface PluginReadme {
  pkg: string
  name: string
  readme: string
  truncated: boolean
  /** 0.9.48：npm packument 兜底时随附的仓库 owner/repo（仅 GitHub），供 README 相对路径锚定；本地读取无此信息 */
  repo?: string
}

/** 限量读取文本文件：只读前 limit 字节，超限标记 truncated。 */
async function readTextLimited(path: string, limit: number): Promise<{ text: string; truncated: boolean } | null> {
  let fh
  try {
    fh = await open(path, 'r')
  } catch {
    return null
  }
  try {
    const buf = Buffer.alloc(limit + 1)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    return {
      text: buf.subarray(0, Math.min(bytesRead, limit)).toString('utf8'),
      truncated: bytesRead > limit,
    }
  } finally {
    await fh.close().catch(() => undefined)
  }
}

/** 读取单个已安装插件的 README（UTF-8，≤64KB，超限截断）。pkg 必须来自 profile 依赖。profileName 仅用于错误文案（0.9.50：desktop 等 profile 不再误报「web profile」，形态对齐 profile-ops 先例）。 */
export async function readInstalledPluginReadme(
  pkg: string,
  profileDir: string = webProfileDir(),
  profileName: string = 'web',
): Promise<PluginReadme> {
  const key = String(pkg || '').trim()
  if (!isSafePkgName(key)) throw new Error(`无效插件包名: ${pkg}`)
  const root = resolve(profileDir)
  const deps = await readProfileDeps(root)
  // 授权边界必须用 own-property 判定：`in` 会沿原型链命中继承属性（如 'constructor'），
  // 绕过「pkg 必须来自 profile dependencies」的成员约束
  if (!Object.hasOwn(deps, key)) {
    throw new Error(`${profileName} profile 未安装该插件: ${key}`)
  }
  const dir = resolvePluginDir(root, key, deps[key])
  if (!dir) throw new Error(`无法解析插件目录: ${key}`)
  const raw = await readPkgJson(dir)
  const name = raw && typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : key
  for (const file of README_FILES) {
    const text = await readTextLimited(join(dir, file), README_MAX_BYTES)
    if (text) return { pkg: key, name, readme: text.text, truncated: text.truncated }
  }
  return { pkg: key, name, readme: '', truncated: false }
}
