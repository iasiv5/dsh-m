/**
 * 生效判定（GLOSSARY：生效判定 Activation Classification，0.9.22）：
 * 对 npm 源升级的新旧两版 tarball 做逐文件 sha256 diff，把「新版本如何生效」分类为
 * 'client-only'（纯客户端更新：刷新页面即生效）/ 'restart-required'（需重启）/ 'unknown'。
 * 任何异常（元数据缺失、下载失败、超时、超限、tar/JSON 解析）一律 fail-open 到 'unknown'，
 * 绝不影响升级成功态。判定预算独立于 pnpm 事务：总 deadline 默认 10s、单 tarball 上限 8MiB、
 * 无缓存（升级是一次性操作，结果随升级返回渲染完即弃——ADR-0006「缓存是优化不是功能」精神）。
 * 分类规则五条与已知局限见 docs/adr/0007-activation-classification.md。
 */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { fetchBytesLimited } from './httpx.js'
import { npmVersion } from './versions.js'
import { parseTarEntries } from './ustar.js'

export type ActivationClassification = 'client-only' | 'restart-required' | 'unknown'

export interface ClassifyActivationDeps {
  /** 精确版本 → dist.tarball URL；缺 tarball 视为 unknown。默认 npmVersion（官方 registry，与 install 路径同源）。 */
  fetchVersionMeta?: (pkg: string, version: string, signal?: AbortSignal) => Promise<{ tarball?: string }>
  /** 下载 tarball 字节（上限由 maxBytes 传导给 fetchBytesLimited）。 */
  fetchTarball?: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<Buffer>
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_TARBALL_BYTES = 8 * 1024 * 1024

function stripPackagePrefix(name: string): string {
  return name.startsWith('package/') ? name.slice('package/'.length) : name
}

function normalizeTarget(target: string): string {
  return target.replace(/^\.\//, '')
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function fileMap(tarBuf: Buffer): Map<string, Buffer> {
  const raw = parseTarEntries(gunzipSync(tarBuf))
  const map = new Map<string, Buffer>()
  for (const [name, content] of raw) map.set(stripPackagePrefix(name), content)
  return map
}

/** 深比较（键序无关）：package.json 忽略顶层 version 后的语义 diff 用。 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== typeof b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a as object).sort()
    const kb = Object.keys(b as object).sort()
    if (!deepEqual(ka, kb)) return false
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return false
}

function parsePackageJson(buf: Buffer | undefined): Record<string, unknown> {
  if (!buf) throw new Error('tar 缺少 package.json')
  const parsed = JSON.parse(buf.toString('utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('package.json 不是对象')
  return parsed as Record<string, unknown>
}

/** 规则 3：package.json 忽略顶层 version 后语义比较（依赖条目里的版本串照常计入）；非法 JSON 抛错。 */
function packageJsonMeaningfulDiff(oldBuf: Buffer | undefined, newBuf: Buffer | undefined): boolean {
  const a = parsePackageJson(oldBuf)
  delete (a as Record<string, unknown>).version
  const b = parsePackageJson(newBuf)
  delete (b as Record<string, unknown>).version
  return !deepEqual(a, b)
}

function exportClientTarget(pkg: Record<string, unknown>): string | null {
  const exports = pkg.exports as Record<string, unknown> | undefined
  const target = exports?.['./client']
  return typeof target === 'string' ? normalizeTarget(target) : null
}

function patchTarget(pkg: Record<string, unknown>): string | null {
  const dsh = pkg.dsh as { bundle?: { patch?: unknown } } | undefined
  const patch = dsh?.bundle?.patch
  return typeof patch === 'string' ? normalizeTarget(patch) : null
}

/** 规则引擎（五条，见 ADR-0007）；输入已解包归一，异常由调用方 fail-open。 */
function classifyDiff(oldFiles: Map<string, Buffer>, newFiles: Map<string, Buffer>): ActivationClassification {
  const oldPkgRaw = oldFiles.get('package.json')
  const newPkgRaw = newFiles.get('package.json')
  const oldPkg = parsePackageJson(oldPkgRaw)
  const newPkg = parsePackageJson(newPkgRaw)
  const clientOld = exportClientTarget(oldPkg)
  const clientNew = exportClientTarget(newPkg)
  if (clientOld !== clientNew) return 'restart-required' // 规则 5：client 指向变化保守判宿主
  const patchOld = patchTarget(oldPkg)
  const patchNew = patchTarget(newPkg)

  const names = new Set([...oldFiles.keys(), ...newFiles.keys()])
  for (const name of names) {
    const o = oldFiles.get(name)
    const n = newFiles.get(name)
    if (o && n && sha256(o) === sha256(n)) continue
    if (name === 'package.json') {
      // 规则 3：仅顶层 version 差异不算宿主侧；其余字段差异算
      if (packageJsonMeaningfulDiff(oldPkgRaw, newPkgRaw)) return 'restart-required'
      continue
    }
    if (name === clientNew || name === clientOld) continue // 规则 1/4：client 集合内
    if (name === patchNew || name === patchOld) return 'restart-required' // 规则 2：强调项（被规则 4 覆盖）
    return 'restart-required' // 规则 4：其余一切差异归宿主侧
  }
  return 'client-only'
}

/**
 * 生效判定主入口：拉取 from/to 两版元数据与 tarball（并行），解包 diff 后分类。
 * 任何异常返回 'unknown'（含被 opts.signal 外部中止）——调用方无需 try/catch。
 */
export async function classifyUpgradeActivation(
  pkg: string,
  fromVersion: string,
  toVersion: string,
  opts: { timeoutMs?: number; maxTarballBytes?: number; signal?: AbortSignal } = {},
  deps: ClassifyActivationDeps = {},
): Promise<ActivationClassification> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxTarballBytes ?? DEFAULT_MAX_TARBALL_BYTES
  const ac = new AbortController()
  const onOuterAbort = () => ac.abort(opts.signal?.reason)
  if (opts.signal) {
    if (opts.signal.aborted) onOuterAbort()
    else opts.signal.addEventListener('abort', onOuterAbort, { once: true })
  }
  const timer = setTimeout(() => ac.abort(new Error('生效判定超时')), timeoutMs)
  try {
    const fetchVersionMeta = deps.fetchVersionMeta ??
      (async (p, v, signal) => ({ tarball: (await npmVersion(p, v, timeoutMs, signal)).tarball }))
    const fetchTarball = deps.fetchTarball ??
      (async (url, max, signal) => (await fetchBytesLimited(url, { maxBytes: max, timeoutMs, signal })).bytes)
    const [oldMeta, newMeta] = await Promise.all([
      fetchVersionMeta(pkg, fromVersion, ac.signal),
      fetchVersionMeta(pkg, toVersion, ac.signal),
    ])
    if (!oldMeta?.tarball || !newMeta?.tarball) return 'unknown'
    const [oldTar, newTar] = await Promise.all([
      fetchTarball(oldMeta.tarball, maxBytes, ac.signal),
      fetchTarball(newMeta.tarball, maxBytes, ac.signal),
    ])
    return classifyDiff(fileMap(oldTar), fileMap(newTar))
  } catch {
    return 'unknown'
  } finally {
    clearTimeout(timer)
    if (opts.signal) opts.signal.removeEventListener('abort', onOuterAbort)
  }
}

/** CLI 行文案（tools/GUI 有各自的专用措辞；此处只服务 cli.ts upgrade case）。 */
export function upgradeEffectLine(activation: ActivationClassification | undefined): string {
  if (activation === 'client-only') return '纯客户端更新：刷新页面即生效，无需重启'
  if (activation === 'unknown') return '生效判定未完成；建议重启 DSH Web 生效：dshm restart --yes'
  return '需要重启 DSH Web 生效：dshm restart --yes'
}
