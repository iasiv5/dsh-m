/**
 * registry CI 校验（DESIGN.md §2.3）。复用 lib/core/registry.js 的 validateRegistry，
 * 避免两套 schema 检查漂移。用法：npm run build && node scripts/validate-registry.mjs
 * 可选 env GITHUB_TOKEN：提高 GitHub API 限额（仅读公开数据，无自定义密钥）。
 * 可选 env DSH_RUNTIME_VERSION：提供当前宿主版本时，额外软警告「verified 未覆盖
 * 当前宿主」（know-how 008 升级必查的门禁化；缺省跳过该项）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateRegistry, verifiedPollution } from '../lib/core/registry.js'

const root = dirname(fileURLToPath(import.meta.url)) + '/..'
const raw = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'))
const parsed = validateRegistry(raw)

let failed = false
if (!parsed.ok || !parsed.registry) {
  failed = true
  console.error('✗ registry.json schema 校验失败：')
  for (const e of parsed.errors) console.error('  -', e)
} else {
  console.log(`✓ schema 合法，共 ${parsed.registry.plugins.length} 条`)
}

const ids = new Set((parsed.registry?.plugins || []).map((p) => p.id))
if (ids.size !== (parsed.registry?.plugins.length || 0)) {
  failed = true
  console.error('✗ 存在重复 id')
}

// ---------- 文案软警告（docs/registry-copy-guide.md；只 warn 不 fail） ----------
const widthUnits = (s) => [...s].reduce((acc, ch) => acc + (/[ -~]/.test(ch) ? 0.5 : 1), 0)
const COPY_LIMIT = 60

let warned = false
const runtimeVersion = process.env.DSH_RUNTIME_VERSION || null
for (const entry of parsed.registry?.plugins || []) {
  const where = `[${entry.id}]`
  const desc = entry.description || ''
  const w = widthUnits(desc)
  if (w > COPY_LIMIT) {
    warned = true
    console.warn(`⚠ ${where} description ${w.toFixed(1)} 当量超 ${COPY_LIMIT}（卡片收起态两行会截出残句），压缩或细节归 homepage`)
  }
  for (const tag of entry.tags || []) {
    if (/^(需|推荐|requires?)/i.test(tag)) {
      warned = true
      console.warn(`⚠ ${where} tag「${tag}」是依赖关系词——关系应写在 description 句式里（需 …/可选集成 …），见 registry-copy-guide §4/§5`)
    }
  }
  const tail = desc.match(/（[^（）]*(?:适配|需|依赖|推荐)[^（）]*）/)
  if (tail) {
    warned = true
    console.warn(`⚠ ${where} description 含全角括号尾巴「${tail[0]}」——兼容/前置应改写为末句句式（已适配 …，详见仓库 / 需 …），见 registry-copy-guide §4`)
  }
  // 008 升级必查的门禁化（只 warn 不 fail）：
  // a) description 里的版本号必须 ⊆ verified——兼容句与实测清单的最低一致性。
  //    只对含「适配」兼容句式的描述生效：「需 better-sidebar ≥0.4.0」这类
  //    依赖版本不是 DSH 兼容声明，不在检查范围（copy-guide §4 的两种句式）。
  if (/适配/.test(desc)) {
    for (const v of desc.match(/\b0\.\d+\.\d+(?:-(?:rc|alpha)\.\d+)?\b/g) ?? []) {
      if (!(entry.verified || []).includes(v)) {
        warned = true
        console.warn(`⚠ ${where} description 提到 ${v} 但 verified 未收录——升级后必查（know-how 008）`)
      }
    }
  }
  // b) 已声明 verified 的条目应覆盖当前宿主版本（DSH_RUNTIME_VERSION 提供时检查）
  if (runtimeVersion && Array.isArray(entry.verified) && entry.verified.length > 0) {
    if (!entry.verified.includes(runtimeVersion)) {
      warned = true
      console.warn(`⚠ ${where} verified 未覆盖当前宿主 ${runtimeVersion}——升级后必查（know-how 008）`)
    }
  }
  // c) verified 污染检测（know-how 022）：verified 只记 DSH 运行时版本；命中插件
  //    自身 npm 已发布版本即高度可疑（历史实证：dsh-quota-watch 曾混入插件版本 0.1.0）。
  //    放在网络检查段统一做（需要 packument），此处仅登记入口。
}

const ghHeaders = {
  accept: 'application/vnd.github+json',
  'user-agent': 'dsh-m-registry-check',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
}

async function existsOnNpm(pkg) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`npm 查询 ${pkg} → HTTP ${res.status}`)
}

async function publishedVersions(pkg) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, { headers: { accept: 'application/vnd.npm.install-v1+json' } })
  if (!res.ok) throw new Error(`npm packument ${pkg} → HTTP ${res.status}`)
  const doc = await res.json()
  return Object.keys(doc.versions || {})
}

async function existsOnGithub(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: ghHeaders })
  if (res.status === 403 && String(res.headers.get('x-ratelimit-remaining')) === '0') {
    throw new Error(`GitHub API 限额用尽（设置 GITHUB_TOKEN 可解）`)
  }
  if (!res.ok) throw new Error(`GitHub 仓库 ${repo} → HTTP ${res.status}`)
}

async function reachable(url, attempt = 0) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': 'dsh-m-registry-check' } })
      if (res.ok || res.status === 405) return
      throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      if (i === 1) throw new Error(`URL 不可达：${url}（${err instanceof Error ? err.message : err}）`)
      await new Promise((r) => setTimeout(r, 1500))
      void attempt
    }
  }
}

for (const entry of parsed.registry?.plugins || []) {
  const where = `[${entry.id}]`
  try {
    if (entry.npm) {
      await existsOnNpm(entry.npm)
      console.log(`✓ ${where} npm 包存在：${entry.npm}`)
      if (Array.isArray(entry.verified) && entry.verified.length > 0) {
        try {
          for (const v of verifiedPollution(entry.verified, await publishedVersions(entry.npm))) {
            warned = true
            console.warn(`⚠ ${where} verified 含 ${v}——命中插件自身 npm 已发布版本：verified 只记 DSH 运行时版本，勿填插件版本（know-how 022）`)
          }
        } catch (err) {
          warned = true
          console.warn(`⚠ ${where} verified 污染检查跳过：${err instanceof Error ? err.message : err}`)
        }
      }
    }
    if (entry.github) {
      await existsOnGithub(entry.github)
      console.log(`✓ ${where} GitHub 仓库存在：${entry.github}`)
    }
    for (const [key, url] of [['homepage', entry.homepage], ['icon', entry.icon]]) {
      if (!url) continue
      await reachable(url)
      console.log(`✓ ${where} ${key} 可达`)
    }
  } catch (err) {
    failed = true
    console.error(`✗ ${where} ${err instanceof Error ? err.message : err}`)
  }
}

if (failed) {
  console.error('\nregistry 校验未通过')
  process.exit(1)
}
if (warned) {
  console.log('\nregistry 校验通过（含文案软警告，见上；合并前请逐条给出理由）')
} else {
  console.log('\nregistry 校验通过')
}
