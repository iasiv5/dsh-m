/**
 * registry 条目 npm 包「装后守卫预检」（2026-11-07 agentero-dsh 实录沉淀）。
 * 实录：agentero-dsh 0.1.6 纯 bundle 壳包被 dsh-m 装后守卫 ② ENTRY_UNRESOLVABLE 拦截补偿，
 * 而收录门禁（npm/GitHub/homepage/icon 存在性）全绿——「收录过但装不上」没有任何机器闸。
 * probeNpmInstallability 拉 latest tarball → 解包到临时 node_modules → 对根包跑
 * verifyInstalledAdditions 三项检查；命中 violation = 市场安装必被拦截补偿 → 收录门禁应红。
 * 网络类失败返回 skip（不判红，与「预检自身失败不拦安装」同一取舍传统）。
 * 供 scripts/validate-registry.mjs 在线段消费；lib 构建产物依赖同 validate（先 npm run build）。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { verifyInstalledAdditions } from '../lib/core/install-guard.js'

const DEFAULT_TIMEOUT_MS = 30000

/** latest manifest 拉取：HTTP 非 2xx 抛错（调用方归入 skip）。 */
async function fetchLatestManifest(pkg, timeoutMs) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`npm latest 查询 HTTP ${res.status}`)
  return res.json()
}

/** tarball buffer → 临时 node_modules/<pkg> → install-guard 三项检查。 */
async function guardFromTarball(pkg, buffer) {
  const dir = mkdtempSync(join(tmpdir(), 'dshm-regprobe-'))
  try {
    const tgzPath = join(dir, 'pkg.tgz')
    writeFileSync(tgzPath, buffer)
    execFileSync('tar', ['xzf', tgzPath, '-C', dir])
    const nm = join(dir, 'node_modules')
    const dest = join(nm, ...pkg.split('/'))
    mkdirSync(dirname(dest), { recursive: true })
    renameSync(join(dir, 'package'), dest)
    return await verifyInstalledAdditions({ profileDir: dir, addedPkgs: [pkg], pkgsDir: nm })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * @param pkg npm 包名
 * @param opts.manifest 注入 latest manifest（跳过网络首跳；测试用）
 * @param opts.tarballBuffer 注入 tarball buffer（跳过网络两跳；测试用）
 * @returns {skip: reason} 网络类失败不判红；{guard} 三项检查结果
 */
export async function probeNpmInstallability(pkg, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    let buffer = opts.tarballBuffer
    if (!buffer) {
      const manifest = opts.manifest ?? (await fetchLatestManifest(pkg, timeoutMs))
      const tarball = manifest?.dist?.tarball
      if (!tarball) return { skip: 'latest manifest 缺 dist.tarball' }
      const tgzRes = await fetch(tarball, { signal: AbortSignal.timeout(timeoutMs) })
      if (!tgzRes.ok) return { skip: `tarball 下载 HTTP ${tgzRes.status}` }
      buffer = Buffer.from(await tgzRes.arrayBuffer())
    }
    return { guard: await guardFromTarball(pkg, buffer) }
  } catch (err) {
    return { skip: `预检异常：${err instanceof Error ? err.message : String(err)}` }
  }
}
