#!/usr/bin/env node
/**
 * golden 差分语料生成器（2026-10-16 搜索归一化计划 Task 1，评审 R1-P1/P2/P9 + R2-R1/R3/R7/R2-R3 修订后口径）。
 *
 * 职责：用「当前实现」normalizeSearchText 计算期望值并冻结进 tests/fixtures/search-normalize-corpus.json。
 * oracle 冻结必须先于实现改动（差分护栏的基线）。
 *
 * 再生纪律：fixture 永不自动再生；仅在有意语义变更时手动重跑本脚本（届时 oracle=当时实现，属预期）。
 * 确定性：mulberry32(20261016) + 目录 JSON 原序遍历 + 去重 Set 插入序（不排序）——同 seed 再生同语料。
 *
 * 运行：npm run build && node scripts/gen-search-normalize-corpus.mjs [catalog绝对路径]
 * 预算（R2-R1）：硬顶 1MB（超则砍随机桶重写）；目标 800KB（超仅如实报告）。随机桶是唯一旋钮。
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adaptCommunityCatalog } from '../lib/core/community-adapter.js'
import { normalizeSearchText } from '../lib/core/search-relevance.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(ROOT, 'tests', 'fixtures', 'search-normalize-corpus.json')
const CACHE_DIR = join(process.env.HOME ?? '', '.dsh', 'dshm', 'cache', 'host', 'awesome')
const SEED = 20261016
const BUDGET_TARGET = 800 * 1024
const BUDGET_HARD = 1024 * 1024

/** mulberry32 确定性 PRNG（R1-P7）。 */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 目录选择：文件名内嵌版本按 `.` 分段数值比较取最新——禁字典序（R2-R3：字典序会错选 2026.930 覆盖 2026.1015）。 */
function pickCatalog(dir) {
  const files = readdirSync(dir).filter((f) => /^catalog-.+\.json$/.test(f))
  if (files.length === 0) throw new Error(`目录缓存缺失：${dir}（可传 argv[2] 指定 catalog 文件路径）`)
  const verOf = (f) => f.replace(/^catalog-/, '').replace(/\.json$/, '')
  const segs = (v) => v.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const cmp = (a, b) => {
    const sa = segs(a)
    const sb = segs(b)
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      const d = (sa[i] ?? 0) - (sb[i] ?? 0)
      if (d !== 0) return d
    }
    return 0
  }
  let best = files[0]
  for (const f of files.slice(1)) if (cmp(verOf(f), verOf(best)) > 0) best = f
  return { path: join(dir, best), version: verOf(best) }
}

const catalogArg = process.argv[2]
const catalog = catalogArg
  ? { path: catalogArg, version: (catalogArg.match(/catalog-(.+)\.json$/) ?? ['', 'unknown'])[1] }
  : pickCatalog(CACHE_DIR)
const raw = JSON.parse(readFileSync(catalog.path, 'utf8'))
const adapted = adaptCommunityCatalog(raw, {})
const entries = Array.isArray(adapted) ? adapted : (adapted.entries ?? [])

// —— 抽串字段（同 fieldsOf 消费面）；目录 JSON 原序遍历；去重 Set 插入序不排序 ——
const fieldStrings = []
for (const e of entries) {
  for (const k of ['id', 'name', 'npm', 'owner', 'description', 'descriptionEn', 'category']) {
    const v = e[k]
    if (typeof v === 'string' && v !== '') fieldStrings.push(v)
  }
  if (Array.isArray(e.tags)) for (const t of e.tags) if (typeof t === 'string' && t !== '') fieldStrings.push(t)
}
const dedup = new Set()
for (const s of fieldStrings) dedup.add(s)
const all = [...dedup]

// —— 手写边界与静态桶（与随机量无关，先备好）——
const B = String.fromCodePoint(0x20000) // CJK 扩展 B，NFKC 稳定 astral 词符
const HANDWRITTEN = [
  '', '   ', '\t\n ', '——!!', 'MCP管理', 'ＭＣＰ', '中文English中文',
  'a𝕏管', // NFKC×astral 交互：数学字母先折 ASCII
  `a${B}管`, `a,${B}`, `管${B}a`, `${B}${B}管`, // astral 词对透明四钉
  'a😀b', // emoji 非词对折叠
  'a\uFA6Eb', '\uFA6E一', // FA 段未赋值洞折叠
  'a\uD800b', '\uDC00x', // lone surrogate 折叠
  'theme 皮肤', 'mcp 管理', 'A.B', 'foo_bar', '……', '！？', 'Ⅷⅷ', 'ｶﾞ', '𝟏𝟐𝟑',
  '㐀', '㿿', '鿼', '\u4DB6', '一', // 稳定核边界与版本敏感缘（鿼=U+9FFC、\u4DB6 走 regex 回退）
  'a b', 'a  b', ' !!a', 'a!! ',
]
const cats = new Set()
for (const e of entries) if (typeof e.category === 'string' && e.category !== '') cats.add(e.category)
const byLen = [...all].sort((a, b) => b.length - a.length) // 稳定 sort：tie 保持插入序（数据派生）
const longestSeeds = []
for (const s of byLen) {
  if (longestSeeds.length >= 30) break
  if (s.length > 1024) continue
  longestSeeds.push(s)
}

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)]
const NFKC_SAMPLES = ['ＭＣＰ', 'ﬁ', 'ﬂ', 'ⅷ', 'Ⅷ', '㎏', '㎡', '¹', '²', '³', '𝕏', '𝟏', '𝟐', 'ｶ', 'ﾞ', 'ﾝ', '℀', '①', '½']
const ASCII_SAMPLES = 'aZ09-_./\\*+# \t\n!@#$%^&*()[]{}|;:\'",<>?~`='.split('')
const LONE_SAMPLES = ['\uD800', '\uDC00']
// 八个纯池（顺序固定）：BMP / CJK / FA 段（含洞）/ NFKC 变换串 / ASCII / emoji 非词对 / 扩展 B 词对 / lone surrogate
const POOLS = [
  (rnd) => String.fromCodePoint(1 + Math.floor(rnd() * 0x2fff)),
  (rnd) => String.fromCodePoint(0x3400 + Math.floor(rnd() * (0x9fff - 0x3400 + 1))),
  (rnd) => String.fromCodePoint(0xf900 + Math.floor(rnd() * (0xfaff - 0xf900 + 1))),
  (rnd) => pick(NFKC_SAMPLES, rnd),
  (rnd) => pick(ASCII_SAMPLES, rnd),
  (rnd) => String.fromCodePoint(0x1f600 + Math.floor(rnd() * 0x50)),
  (rnd) => String.fromCodePoint(0x20000 + Math.floor(rnd() * (0x2a6df - 0x20000 + 1))),
  (rnd) => pick(LONE_SAMPLES, rnd),
]

/** 以给定随机桶配额从全新 PRNG 完整生成一遍（砍路径=换参数重跑，天然确定性）。 */
function generate(nRandom) {
  const rnd = mulberry32(SEED)
  const cases = []
  const seen = new Set()
  function addCase(input) {
    if (seen.has(input)) return false
    seen.add(input)
    cases.push({ input, expected: normalizeSearchText(input) })
    return true
  }
  const counts = { hand: 0, categories: 0, longest: 0, random: 0, fuzz: 0 }
  for (const s of HANDWRITTEN) if (addCase(s)) counts.hand++
  for (const c of cats) if (addCase(c)) counts.categories++
  for (const s of longestSeeds) if (addCase(s)) counts.longest++
  let attempts = 0
  while (counts.random < nRandom && attempts < all.length * 12) {
    attempts++
    if (addCase(all[Math.floor(rnd() * all.length)])) counts.random++
  }
  const pureString = (poolIdx) => {
    const draw = POOLS[poolIdx]
    const len = 1 + Math.floor(rnd() * 4)
    let s = ''
    for (let i = 0; i < len; i++) s += draw(rnd)
    return s
  }
  const mixedString = () => {
    const len = 1 + Math.floor(rnd() * 40)
    let s = ''
    for (let i = 0; i < len; i++) s += POOLS[Math.floor(rnd() * POOLS.length)](rnd)
    return s
  }
  const FUZZ_TARGET = 3000
  const PURE_EACH = 225 // 1800 / 8
  for (let p = 0; p < POOLS.length; p++) for (let i = 0; i < PURE_EACH; i++) if (addCase(pureString(p))) counts.fuzz++
  for (let i = 0; i < 1200; i++) if (addCase(mixedString())) counts.fuzz++
  // 补足：同 seed 续抽混合池；连续 5 轮（轮=100 抽）无新增即停，如实记录 kept
  let noNewRounds = 0
  while (counts.fuzz < FUZZ_TARGET) {
    let added = 0
    for (let i = 0; i < 100 && counts.fuzz < FUZZ_TARGET; i++) {
      if (addCase(mixedString())) {
        counts.fuzz++
        added++
      }
    }
    if (added === 0) {
      noNewRounds++
      if (noNewRounds >= 5) break
    } else noNewRounds = 0
  }
  return {
    generator: 'scripts/gen-search-normalize-corpus.mjs',
    catalogVersion: catalog.version,
    generatedAt: new Date().toISOString(),
    seed: SEED,
    stats: { entries: entries.length, dedupedFieldStrings: all.length, randomTarget: nRandom, ...counts },
    cases,
  }
}

// 固定格式：顶层元数据单行，cases 每条独占一行（grep 友好；与 tests/search-normalize-corpus-format.test.mjs 对齐）
function serializeCorpus(p) {
  const { cases, ...rest } = p
  const head = JSON.stringify(rest).slice(0, -1)
  return `${head},"cases":[\n${cases.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`
}

let nRandom = Number.parseInt(process.env.CORPUS_RANDOM ?? '800', 10) || 800
let payload = generate(nRandom)
let bytes = Buffer.byteLength(serializeCorpus(payload))
let cutApplied = false
if (bytes > BUDGET_HARD && nRandom > 0) {
  // >1MB 硬顶 → 砍随机桶（唯一旋钮）换参重跑；随机桶砍尽仍超 → 停下如实报告（不静默降 fuzz）
  nRandom = Math.max(0, Math.floor(nRandom * (BUDGET_HARD / bytes)))
  console.log(`[corpus] ${bytes}B > 1MB 硬顶 → 随机桶砍至 ${nRandom} 换参重跑`)
  payload = generate(nRandom)
  bytes = Buffer.byteLength(serializeCorpus(payload))
  cutApplied = true
  if (bytes > BUDGET_HARD) {
    console.error(`[corpus] 随机桶已砍尽仍 ${bytes}B > 1MB 硬顶——停下如实报告，不静默降 fuzz`)
    process.exit(1)
  }
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, serializeCorpus(payload))
const { stats } = payload
console.log(`[corpus] catalog=${catalog.version} entries=${stats.entries} dedup=${stats.dedupedFieldStrings}`)
console.log(`[corpus] buckets: hand=${stats.hand} categories=${stats.categories} longest=${stats.longest} random=${stats.random}/${nRandom}${cutApplied ? '(已砍)' : ''} fuzz=${stats.fuzz}/${3000}`)
console.log(`[corpus] total cases: ${payload.cases.length}（下限 3800）`)
console.log(`[corpus] bytes: ${bytes}（目标 ≤${BUDGET_TARGET} / 硬顶 ${BUDGET_HARD}）→ ${bytes <= BUDGET_TARGET ? '目标内' : bytes <= BUDGET_HARD ? '超目标未超硬顶（如实报告，属允许态）' : '超硬顶'}`)
console.log(`[corpus] written: ${OUT}`)
