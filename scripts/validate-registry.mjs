/**
 * registry CI 校验（DESIGN.md §2.3）。复用 lib/core/registry.js 的 validateRegistry，
 * 避免两套 schema 检查漂移。用法：npm run build && node scripts/validate-registry.mjs [--offline]
 * --offline：跳过网络段（npm/GitHub/URL 可达与 verified 污染 packument 检查），
 *   限额耗尽或断网时仍出内容门禁（schema/重复 id/文案软警告，2026-10-30 retro ③）。
 * 可选 env GITHUB_TOKEN：提高 GitHub API 限额（仅读公开数据，无自定义密钥）。
 * 可选 env DSH_RUNTIME_VERSION：提供当前宿主版本时，额外软警告「verified 未覆盖
 * 当前宿主」（know-how 008 升级必查的门禁化；缺省跳过该项）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { validateRegistry, verifiedPollution } from '../lib/core/registry.js'
import { fetchPublishedCategories, unsupportedCategories } from './registry-categories.mjs'
import { probeNpmInstallability } from './registry-installability.mjs'
import { reachable } from './registry-url-probe.mjs'

const OFFLINE = process.argv.includes('--offline')

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
  if (entry.decoupled === true && /已适配/.test(desc)) {
    warned = true
    console.warn(`⚠ ${where} 解耦条目 description 含「已适配」句式——应为「版本无关，详见仓库」（registry-copy-guide §4 第四句式）`)
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

// URL 可达性探测抽至 scripts/registry-url-probe.mjs（纯逻辑 + deps 注入，tests 直测）。
// 判定口径：5xx = 探测面服务器故障（非死链证据）→ fail-open warn 不判红；
// 404 等确定性非 ok / 网络异常 → 抛错走 ✗（retro 2026-11-09 ①：GitHub 匿名超时事故
// 曾把 36 条 homepage 探测成片打红、purge 被 needs 连带跳过两轮）。

// ---------- 分类发布态门禁（retro 2026-11-01 第 3 项；仅在线模式） ----------
// 未知分类会让旧版 dsh-m 整份拒绝 registry：registry 的分类必须已被 npm 上最新已发布版本支持。
if (!OFFLINE) {
  try {
    const { version, categories } = await fetchPublishedCategories()
    const bad = unsupportedCategories(parsed.registry, categories)
    for (const { id, category } of bad) {
      failed = true
      console.error(`✗ [${id}] 分类「${category}」尚未被已发布的 dsh-m@${version} 支持——旧版会整份拒绝 registry。须先发版、宿主升级后再推 registry（见 CHANGELOG 兼容性说明）`)
    }
    if (bad.length === 0) console.log(`✓ 全部分类均受已发布 dsh-m@${version} 支持`)
  } catch (err) {
    warned = true
    console.warn(`⚠ 分类发布态校验跳过：${err instanceof Error ? err.message : err}`)
  }
}

if (OFFLINE) {
  console.log(`⏭ 离线模式：跳过网络段（${(parsed.registry?.plugins || []).length} 个条目的 npm/GitHub/URL 可达与 verified 污染 packument 检查）`)
} else for (const entry of parsed.registry?.plugins || []) {
  const where = `[${entry.id}]`
  try {
    if (entry.npm) {
      await existsOnNpm(entry.npm)
      console.log(`✓ ${where} npm 包存在：${entry.npm}`)
      // 装后守卫预检（2026-11-07 agentero-dsh 实录）：收录时预跑三项检查，命中 violation =
      // 市场安装必被拦截补偿（收录过但装不上没有任何别的机器闸）。网络类失败 skip 不判红。
      try {
        const probe = await probeNpmInstallability(entry.npm)
        if (probe.skip) {
          warned = true
          console.warn(`⚠ ${where} 守卫预检跳过：${probe.skip}`)
        } else if (probe.guard.violations.length > 0) {
          failed = true
          for (const v of probe.guard.violations) {
            console.error(`✗ ${where} 守卫预检不通过：${v.code}: ${v.detail}——市场安装将被拦截补偿`)
          }
        } else {
          // unavailable-only（如多条件 exports 保守跳过）：fail-open，与装后守卫同款取舍——只 warn 不红
          for (const u of probe.guard.unavailable) {
            warned = true
            console.warn(`⚠ ${where} 守卫预检不可定（fail-open）：${u.reason}`)
          }
        }
      } catch (err) {
        warned = true
        console.warn(`⚠ ${where} 守卫预检异常：${err instanceof Error ? err.message : String(err)}`)
      }
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
      const verdict = await reachable(url)
      if (verdict === 'warn') {
        warned = true
        console.warn(`⚠ ${where} ${key} 探测面 5xx（服务器故障，非死链证据）——fail-open 不判红，合并前人工点开确认 ${url}`)
      } else {
        console.log(`✓ ${where} ${key} 可达`)
      }
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
