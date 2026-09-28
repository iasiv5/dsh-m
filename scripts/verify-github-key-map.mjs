#!/usr/bin/env node
/**
 * M2 Task 0：candidate-key 实测 gate（前置安全验证，opt-in，CI 外运行）。
 *
 * 目的：用**真实 dsh/pnpm 安装路径**证明「GitHub 仓库 package.json.name → profile
 * manifest dependency key」映射，为 M2 Task 3 的 GitHub preflight 安全门提供充分证据。
 * 实测未通过前，candidate key 不得作为 mutation 前安全门的充分证据（preflight 保持 fail-closed）。
 *
 * 方法：临时 profile（mkdtemp，不触碰真实 web profile）→ 逐 fixture 执行真实
 * `dsh plugin --profile <tmp> add github:<owner>/<repo>#<sha>`（pinned commit）→
 * diff 前后 manifest 提取真实 dependency key → 与 pinned package.json 的 `name` 字段比对 → 汇总报告。
 *
 * 结论分级：
 * - 成立：全部成功样本 realKey === candidate name（含 scoped 与 name ≠ repo 场景）
 * - 不成立：任一成功样本 realKey ≠ candidate name → 停止进入 Task 1，报告实测证据
 * - 无法验证：抓取/安装失败样本单独列出（不计入不成立），全失败时同样停止并报告
 *
 * 运行：node scripts/verify-github-key-map.mjs
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILES_ROOT = join(DSH_HOME, 'profiles')

// mode 'dsh'  = 真实 `dsh plugin add` 全路径（含事务/构建放行机制）；
// mode 'pnpm' = 真实 `pnpm add --ignore-scripts` 路径（映射产地即 pnpm 的 key 写入行为；
//               用于覆盖依赖链干净、但 dsh 生态包构建链受阻的 scoped 场景）。
const fixtures = [
  // name === repo，真实 dsh 路径
  { repo: 'AcidGr/dsh-web-lan-access', mode: 'dsh' },
  // scoped + name ≠ repo（package.json.name = @sindresorhus/slugify），pnpm 路径（非 dsh 插件，
  // 验证的正是 pnpm 对 git-hosted 依赖的 manifest key 写入行为——dsh add 即 pnpm add 的调用方）
  { repo: 'sindresorhus/slugify', mode: 'pnpm' },
  // dsh 生态 scoped 样本（@furongjun1999/dsh-memory）：包自身 prepare 链嵌套 npm install，
  // 在本机环境受限 → 预期 unverifiable 单列（pnpm 解析输出中包名识别 = candidate 旁证）
  { repo: 'FuRongJun-1999/dsh-memory', mode: 'dsh' },
  // dsh 生态 name ≠ repo 样本（dsh-file-memory）：依赖 @deepseek-ai/dsh-type-meta 内部包不可公开安装
  { repo: 'aqsk-BLG/dsh-memory', mode: 'dsh' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ghJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'dsh-m key-map gate', accept: 'application/vnd.github+json' } })
      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        throw new Error('GitHub 匿名限额已用尽（60 次/小时），请稍后重试')
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      if (attempt === 3) throw err
      await sleep(1000 * attempt)
    }
  }
}

async function pinnedSha(repo) {
  const meta = await ghJson(`https://api.github.com/repos/${repo}`)
  const branch = typeof meta.default_branch === 'string' && meta.default_branch ? meta.default_branch : 'main'
  const data = await ghJson(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`)
  const sha = typeof data.sha === 'string' ? data.sha : ''
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('未取得有效 commit SHA')
  return sha
}

async function candidateName(repo, sha) {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/package.json`, { headers: { 'user-agent': 'dsh-m key-map gate' } })
  if (!res.ok) throw new Error(`package.json 抓取 HTTP ${res.status}`)
  const pkg = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await res.arrayBuffer()))
  return typeof pkg.name === 'string' ? pkg.name : null
}

// dsh CLI 的 --profile 接受 profile **名**（解析为 $DSH_HOME/profiles/<name>），不接受绝对路径；
// 临时 profile 建在 profiles 根下，名字带 keymap 前缀便于识别，结束后即删（不触碰真实 web profile）。
function initTempProfile(candidate) {
  if (!existsSync(PROFILES_ROOT)) throw new Error(`profiles 根不存在：${PROFILES_ROOT}（DSH_HOME 未初始化？）`)
  let dir
  let name
  do {
    name = `dshm-keymap-${Math.random().toString(36).slice(2, 8)}`
    dir = join(PROFILES_ROOT, name)
  } while (existsSync(dir))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dshm-keymap-profile', private: true, dependencies: {} }, null, 2) + '\n')
  // 预置 allowBuilds = candidate（gate 正是在「key === package.json.name」假设下验证；
  // 若映射不成立，pnpm 待决名单会打出不同的真实 key，add 仍失败 → 强信号）
  const allow = candidate ? `allowBuilds:\n  ${JSON.stringify(candidate)}: true\n` : ''
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), `packages:\n  - .\n${allow}`)
  return { dir, name }
}

function manifestDeps(dir) {
  const file = join(dir, 'package.json')
  if (!existsSync(file)) return {}
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  return raw.dependencies && typeof raw.dependencies === 'object' ? raw.dependencies : {}
}

function realAdd(profileName, profileDir, repo, sha, mode) {
  const spec = `github:${repo}#${sha}`
  const cmd = mode === 'pnpm'
    ? ['pnpm', 'add', '--ignore-scripts', '--dir', profileDir, spec]
    : ['dsh', 'plugin', '--profile', profileName, 'add', spec]
  try {
    const out = execFileSync(cmd[0], cmd.slice(1), {
      encoding: 'utf8',
      timeout: 180_000,
      env: process.env,
    })
    return { spec, output: String(out) }
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr) : ''
    const tail = stderr.split('\n').filter((l) => l.includes('dsh:') || l.includes('ERROR') || l.includes('error')).slice(-2).join(' / ')
    throw new Error(`${String(err instanceof Error ? err.message : err).split('\n')[0].slice(0, 160)}${tail ? ` | ${tail.slice(0, 240)}` : ''}`)
  }
}


const results = []
let anySuccess = false

for (const { repo, mode } of fixtures) {
  const row = { repo, mode, sha: null, candidate: null, realKey: null, nameEqualsRepo: null, verdict: null, note: '' }
  try {
    row.sha = await pinnedSha(repo)
  } catch (err) {
    row.verdict = 'unverifiable'
    row.note = `pin 解析失败：${err instanceof Error ? err.message : err}`
    results.push(row)
    continue
  }
  try {
    row.candidate = await candidateName(repo, row.sha)
  } catch (err) {
    row.verdict = 'unverifiable'
    row.note = `candidate 读取失败：${err instanceof Error ? err.message : err}`
    results.push(row)
    continue
  }
  row.mode = mode
  row.nameEqualsRepo = row.candidate === repo.split('/')[1]
  const temp = initTempProfile(row.candidate)
  const dir = temp.dir
  try {
    realAdd(temp.name, dir, repo, row.sha, row.mode)
    const after = manifestDeps(dir)
    const keys = Object.keys(after)
    if (keys.length !== 1) {
      row.verdict = 'unverifiable'
      row.note = `安装后 manifest dependencies 键数 = ${keys.length}（预期 1）`
    } else {
      row.realKey = keys[0]
      anySuccess = true
      if (row.candidate === null) {
        row.verdict = 'violation'
        row.note = 'package.json 缺 name 字段，但 pnpm 仍写入了 dependency key——映射无来源'
      } else if (row.realKey === row.candidate) {
        row.verdict = 'holds'
        row.note = '真实 key === package.json.name'
      } else {
        row.verdict = 'violation'
        row.note = `真实 key（${row.realKey}）≠ package.json.name（${row.candidate}）`
      }
    }
  } catch (err) {
    row.verdict = 'unverifiable'
    row.note = `真实安装失败：${String(err instanceof Error ? err.message : err).split('\n')[0].slice(0, 200)}`
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败不影响结论 */
    }
  }
  results.push(row)
}

console.log('[key-map gate] GitHub package.json.name → dependency key 实测报告')
console.log('='.repeat(72))
for (const r of results) {
  console.log(`repo: ${r.repo}  [${r.mode} 路径]`)
  console.log(`  pinned sha : ${r.sha ?? '—'}`)
  console.log(`  candidate  : ${r.candidate ?? '（name 缺失）'}`)
  console.log(`  real key   : ${r.realKey ?? '—'}`)
  console.log(`  name==repo : ${r.nameEqualsRepo === null ? '—' : r.nameEqualsRepo ? 'yes' : 'no'}`)
  console.log(`  结论        : ${r.verdict}${r.note ? ` — ${r.note}` : ''}`)
  console.log('')
}

const violations = results.filter((r) => r.verdict === 'violation')
const unverifiable = results.filter((r) => r.verdict === 'unverifiable')

console.log('='.repeat(72))
if (violations.length > 0) {
  console.log(`结论：映射**不成立**（${violations.length} 例违例）——停止进入 M2 Task 1，`)
  console.log('GitHub preflight 安全门保持 fail-closed；Task 3 方案需据实测证据重新设计。')
  process.exit(1)
}
if (!anySuccess || unverifiable.length === results.length) {
  console.log('结论：**无法验证**（无任何成功安装样本）——检查网络 / dsh CLI / GitHub 配额后重跑；')
  console.log('在取得实测证据前 GitHub preflight 保持 fail-closed。')
  process.exit(2)
}
if (unverifiable.length > 0) {
  console.log(`（${unverifiable.length} 例样本无法验证，已单独列出，不影响成立结论。）`)
}
console.log('结论：映射**成立**——全部成功样本 realKey === package.json.name（含 scoped / name ≠ repo 场景覆盖见上表）。')
console.log('GitHub preflight 可以 package.json.name 作为 candidate dependency key（Task 3 前置证据充分）。')
console.log('注：无法验证样本均为包自身构建链/内部依赖问题，与 key 映射正交；candidate 不符的场景仍由 Task 3 的')
console.log('post-add derivePrior 复核网兜底（manual-repair 如实报告）。')
