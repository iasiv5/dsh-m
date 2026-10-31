/**
 * registry 分类发布态校验（retro 2026-11-01 第 3 项）。
 *
 * 未知分类会让旧版 dsh-m 整份拒绝 registry（0.11.8 与 0.11.11 实录）。顺序约束是：
 * 先发版 → 宿主升级 → 再推 registry。本模块把它机械化：registry 中每个 category 都必须属于
 * npm 上最新已发布 dsh-m 的 CATEGORIES；validate-registry.mjs 在线模式调用。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 从 dsh-m 的 registry.js 文本解析 CATEGORIES（兼容 `as const` 与双/单引号）；找不到返回 null。 */
export function parseCategories(text) {
  const m = typeof text === 'string' ? text.match(/export const CATEGORIES = \[([^\]]*)\]/) : null
  if (!m) return null
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
}

/** 纯函数：registry 中分类不在 supported 内的条目（{ id, category }）。 */
export function unsupportedCategories(registry, supported) {
  const set = new Set(supported)
  return (registry?.plugins ?? [])
    .filter((p) => !set.has(p?.category))
    .map((p) => ({ id: p?.id, category: p?.category }))
}

/**
 * 在线：读取 npm 上最新已发布 dsh-m 的 CATEGORIES（tarball 内 package/lib/core/registry.js）。
 * fetchFn 可注入（默认全局 fetch）；临时目录在 finally 中清理。
 */
export async function fetchPublishedCategories(fetchFn = fetch) {
  const metaRes = await fetchFn('https://registry.npmjs.org/dsh-m/latest', { headers: { accept: 'application/json' } })
  if (!metaRes.ok) throw new Error(`npm 查询 dsh-m/latest → HTTP ${metaRes.status}`)
  const meta = await metaRes.json()
  const version = meta?.version
  const tarball = meta?.dist?.tarball
  if (typeof version !== 'string' || typeof tarball !== 'string') {
    throw new Error('npm latest 元数据缺少 version 或 dist.tarball')
  }
  const tgzRes = await fetchFn(tarball)
  if (!tgzRes.ok) throw new Error(`下载 dsh-m@${version} tarball → HTTP ${tgzRes.status}`)
  const dir = mkdtempSync(join(tmpdir(), 'dshm-categories-'))
  try {
    const file = join(dir, 'pkg.tgz')
    writeFileSync(file, Buffer.from(await tgzRes.arrayBuffer()))
    const text = execFileSync('tar', ['-xzOf', file, 'package/lib/core/registry.js'], { encoding: 'utf8' })
    const categories = parseCategories(text)
    if (!categories) throw new Error(`dsh-m@${version} 的 lib/core/registry.js 中未找到 CATEGORIES`)
    return { version, categories }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
