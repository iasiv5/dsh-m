/**
 * registry CI 校验（DESIGN.md §2.3）。复用 lib/core/registry.js 的 validateRegistry，
 * 避免两套 schema 检查漂移。用法：npm run build && node scripts/validate-registry.mjs
 * 可选 env GITHUB_TOKEN：提高 GitHub API 限额（仅读公开数据，无自定义密钥）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateRegistry } from '../lib/core/registry.js'

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

const ghHeaders = {
  accept: 'application/vnd.github+json',
  'user-agent': 'dsh-m-registry-check',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
}

async function existsOnNpm(pkg) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`npm 查询 ${pkg} → HTTP ${res.status}`)
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
console.log('\nregistry 校验通过')
