/**
 * registry screenshots 同步脚本（ADR-0015 决策修订 / 计划 T6）。
 *
 * 逐条目从作者仓库 CDN 两腿（raw → jsDelivr，无 api.github.com）拉根 screenshots.json，
 * 外科手术式写回 registry.json 的单行 "screenshots" 字段（紧凑单行风格，
 * tests/registry-format.test.mjs 门禁：禁 JSON.parse→stringify 整库重排）。
 *
 * 状态三态（评审 F3，按腿结果分类）：
 * - ok            → 写回清单；
 * - missing       → 作者权威 404 / 解析不合规：字段在场保留现值 + warn（删除需人工），缺席静默；
 * - probe-failed  → 网络层失败：逐条 warn 提示检查代理 env（HTTPS_PROXY）。
 *
 * 用法：npm run build && node scripts/sync-registry-screenshots.mjs [--dry-run]
 * 退出码：0 = 成功（含 warn）；1 = registry 读取失败或写盘失败。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { fetchTextLimited } from '../lib/core/httpx.js'
import { screenshotPathError } from '../lib/core/primary-screenshots.js'

const rawUrl = (slug) => `https://raw.githubusercontent.com/${slug}/HEAD/screenshots.json`
const mirrorUrl = (slug) => `https://cdn.jsdelivr.net/gh/${slug}@HEAD/screenshots.json`
// 与 src/core/primary-screenshots.ts PRIMARY_SCREENSHOT_LIMIT 同值（8）；脚本面独立常量，
// 注释即锚：两处同步变更需对照。
const MAX_SCREENSHOTS = 8

/**
 * 外科手术式行编辑：updates（id → 路径数组）逐条目写入单行 screenshots 字段。
 * 规则：字段插在 "github" 行之后（schema 保证携带 screenshots 的条目必有 github）；
 * 已有行原位替换（尾逗号随旧行）；github 为块内最后字段时新行不带尾逗号、github 行补逗号。
 * EOL 风格按原文件保持（CRLF/LF 不混）。返回 { text, changed, skipped }。
 */
export function applyScreenshotsEdits(text, updates) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const hadTrailingEol = text.endsWith(eol)
  const lines = text.split(eol)
  if (hadTrailingEol) lines.pop()
  const changed = []
  const skipped = []
  for (const [id, paths] of updates) {
    const idIdx = lines.indexOf(`      "id": "${id}",`)
    if (idIdx === -1) { skipped.push(id); continue }
    let start = idIdx
    while (start >= 0 && lines[start].trim() !== '{') start -= 1
    let end = idIdx
    while (end < lines.length && !lines[end].startsWith('    }')) end += 1
    if (start < 0 || end >= lines.length) { skipped.push(id); continue }
    const shotIdx = lines.findIndex((l, i) => i > start && i < end && /^\s*"screenshots": /.test(l))
    if (shotIdx !== -1) {
      const keepComma = /,\s*$/.test(lines[shotIdx])
      lines[shotIdx] = screenshotsLine(paths, keepComma)
      changed.push(id)
      continue
    }
    const ghIdx = lines.findIndex((l, i) => i > start && i < end && /^\s*"github": "/.test(l))
    if (ghIdx === -1) { skipped.push(id); continue }
    const isLastField = ghIdx + 1 === end
    if (!lines[ghIdx].endsWith(',')) lines[ghIdx] += ','
    lines.splice(ghIdx + 1, 0, screenshotsLine(paths, !isLastField))
    changed.push(id)
  }
  return { text: lines.join(eol) + (hadTrailingEol ? eol : ''), changed, skipped }
}

function screenshotsLine(paths, withComma) {
  const body = paths.map((p) => JSON.stringify(p)).join(',')
  return `      "screenshots": [${body}]${withComma ? ',' : ''}`
}

/**
 * 作者 manifest 三态抓取（腿结果分类，评审 F3）：
 * - 腿结果：2xx=成功；HTTP 404=权威缺席腿；HTTP 5xx/其它 4xx/网络层 throw=故障腿。
 * - raw 2xx → 解析分级（JSON 解析失败/非数组/空数组/任一路径 screenshotPathError 非空/条数
 *   >8 → missing＝权威缺席，与运行时 parseManifest 同判；合规 → ok+paths）。
 * - raw 404 → mirror 腿（mirror 2xx → 解析分级；mirror 404 → missing；mirror 故障 → probe-failed）。
 * - raw 故障 → mirror 腿（mirror 2xx → 解析分级；mirror 404 或故障 → probe-failed——raw 不可达
 *   时 mirror 404 不能证伪作者文件存在性，保守归探测失败）。
 */
export async function fetchAuthorScreenshotPaths(slug, fetchText) {
  const urls = [rawUrl(slug), mirrorUrl(slug)]
  let lastReason = ''
  let rawFaulted = false
  for (let i = 0; i < urls.length; i++) {
    let text
    try {
      text = await fetchText(urls[i], { timeoutMs: 5_000, headers: { accept: 'application/json' } })
    } catch (err) {
      if (err && err.status === 404) {
        if (i === 1) {
          if (rawFaulted) return { status: 'probe-failed', reason: lastReason || 'raw unreachable; mirror 404 inconclusive' }
          return { status: 'missing' }
        }
        continue // raw 权威缺席 → mirror 腿复核
      }
      if (i === 0) rawFaulted = true
      lastReason = err && err.message ? err.message : String(err)
      continue
    }
    return gradeManifest(text)
  }
  return { status: 'probe-failed', reason: lastReason || 'both legs failed' }
}

function gradeManifest(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { status: 'missing' }
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_SCREENSHOTS) return { status: 'missing' }
  const paths = []
  for (const rawPath of parsed) {
    if (screenshotPathError(rawPath) !== null) return { status: 'missing' }
    paths.push(rawPath.trim())
  }
  return { status: 'ok', paths }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const regPath = join(root, 'registry.json')
  let plugins
  try {
    plugins = JSON.parse(readFileSync(regPath, 'utf8')).plugins
  } catch (err) {
    console.error(`registry.json 读取失败：${err && err.message ? err.message : err}`)
    process.exitCode = 1
    return
  }
  const targets = plugins.filter((e) => typeof e.github === 'string' && e.github.trim() !== '')
  const updates = new Map()
  let okCount = 0
  let missingWithField = 0
  let probeFailed = 0
  for (const entry of targets) {
    const result = await fetchAuthorScreenshotPaths(entry.github.trim(), fetchTextLimited)
    if (result.status === 'ok') {
      updates.set(entry.id, result.paths)
      okCount += 1
    } else if (result.status === 'missing') {
      if (Array.isArray(entry.screenshots) && entry.screenshots.length > 0) {
        missingWithField += 1
        console.warn(`⚠ ${entry.id} 作者仓库无 manifest（权威 404/不合规），保留清单现值——删除需人工`)
      }
    } else {
      probeFailed += 1
      console.warn(`⚠ ${entry.id} 探测失败（网络层）：${result.reason}——检查代理 env（HTTPS_PROXY）后重跑`)
    }
  }
  if (!dryRun && updates.size > 0) {
    const text = readFileSync(regPath, 'utf8')
    const { text: nextText, changed, skipped } = applyScreenshotsEdits(text, updates)
    try {
      writeFileSync(regPath, nextText)
    } catch (err) {
      console.error(`registry.json 写盘失败：${err && err.message ? err.message : err}`)
      process.exitCode = 1
      return
    }
    console.log(`已写回：changed=${changed.length} skipped=${skipped.length}`)
  } else if (dryRun) {
    console.log(`--dry-run：将变更 ${updates.size} 条${updates.size > 0 ? `：${[...updates.keys()].join(', ')}` : ''}`)
  }
  console.log(`变更 ${updates.size} 条 / 探测到 manifest ${okCount} 条 / 权威缺席 ${missingWithField} 条 / 网络失败 ${probeFailed} 条`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
