#!/usr/bin/env node
/**
 * 基线对照（retro S2，2026-10-24）：本机测试套件有环境既有失败（028 清单）时，
 * 判别「改动回归」vs「环境既有」的手工 ritual（stash → 全量 → 失败按名比对 → pop）
 * 的结构化版本——全程显式退出码，不经过任何管道（CODING-STANDARDS 退出码卫生）。
 *
 * 用法：改动在树上、尚未提交或已部分提交时，跑 `node scripts/test-baseline.mjs`。
 *
 * 流程：①改动态全量（npm test，pretest 自动 build）→ ②`git stash push -u` →
 * ③基线态全量（build 从基线源重建）→ ④`git stash pop` → ⑤失败集合按名 diff →
 * ⑥pop 后自动重建 lib（⑤的产物已被基线轮 build 覆盖为基线源——retro 2026-10-31：
 *   热部署/发版若在判别后直接取 lib，会带出陈旧 bundle）。
 * - 两轮失败集合逐名一致 → 「环境既有」，exit 0；
 * - 不一致 → 打印新增/消失的失败名，exit 1（改动引入回归或修好了既有失败——都值得看一眼）。
 * - 全部通过（两轮 0 fail）→ 无需基线，exit 0。
 *
 * 注意：运行期间本工作树会被 stash 翻转，期间不要编辑仓库文件。
 * 完整测试输出落临时目录（路径打印在末尾），摘要只进 stdout。
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = mkdtempSync(join(tmpdir(), 'dshm-baseline-'))
const die = (message) => {
  console.error(`test-baseline: ${message}`)
  process.exit(1)
}

const status = (() => {
  try {
    return execSync('git status --porcelain', { cwd: root, encoding: 'utf8' })
  } catch (err) {
    die(`git status 失败：${err.message}`)
  }
})()
if (status.trim() === '') {
  console.log('工作树干净，无改动可对照——退出。')
  process.exit(0)
}

/** 跑一遍全量（含 pretest build），返回 { pass, failingNames, logPath }。 */
function runSuite(label) {
  const logPath = join(scratch, `${label}.log`)
  let output
  try {
    output = execSync('npm test', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })
  } catch (err) {
    output = `${err.stdout ?? ''}\n${err.stderr ?? ''}`
  }
  writeFileSync(logPath, output)
  const pass = Number((output.match(/^ℹ pass (\d+)$/m) || [])[1] ?? NaN)
  const fail = Number((output.match(/^ℹ fail (\d+)$/m) || [])[1] ?? NaN)
  if (!Number.isFinite(pass) || !Number.isFinite(fail)) die(`${label} 轮输出缺 pass/fail 汇总（log: ${logPath}）`)
  const failingNames = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('✖ ') && !line.startsWith('✖ failing tests:') && !/^✖ (tests|.*node_modules)/.test(line))
    .map((line) => line.replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, '').trim())
  return { pass, fail, failingNames: [...new Set(failingNames)].sort(), logPath }
}

console.log('[1/4] 改动态全量……')
const current = runSuite('current')
console.log(`      pass=${current.pass} fail=${current.fail}`)

console.log('[2/4] stash（含未跟踪文件；lib/ 为忽略产物不参与）……')
try {
  execSync('git stash push -u -m "test-baseline-auto"', { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
} catch (err) {
  die(`stash 失败（未做任何翻转，树未动）：${err.message}`)
}

let baseline
try {
  console.log('[3/4] 基线态全量……')
  baseline = runSuite('baseline')
  console.log(`      pass=${baseline.pass} fail=${baseline.fail}`)
} finally {
  console.log('[4/4] pop 恢复改动……')
  try {
    execSync('git stash pop', { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
  } catch (err) {
    die(`stash pop 失败——改动仍在 stash（git stash list），请手工恢复后再查：${err.message}`)
  }
}

console.log('[5/4] pop 后重建 lib（基线轮 build 已把产物覆盖为基线源）……')
try {
  execSync('npm run build', { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
} catch (err) {
  console.error(`✗ post-pop 重建失败——lib/ 仍为基线源产物，发版/热部署前请手动 npm run build：${err.message}`)
}
const inCurrentOnly = current.failingNames.filter((name) => !baseline.failingNames.includes(name))
const inBaselineOnly = baseline.failingNames.filter((name) => !current.failingNames.includes(name))
if (current.fail === 0 && baseline.fail === 0) {
  console.log('两轮全部通过——无既有失败基线，无需对照。exit 0')
  process.exit(0)
}
if (inCurrentOnly.length === 0 && inBaselineOnly.length === 0) {
  console.log(`✓ 失败集合与基线逐名一致（${current.fail} 项）——环境既有，非本改动回归。`)
  console.log(`  日志：${current.logPath}`)
  process.exit(0)
}
console.error('✗ 失败集合与基线不一致：')
for (const name of inCurrentOnly) console.error(`  新增失败（疑似回归）：${name}`)
for (const name of inBaselineOnly) console.error(`  基线有而改动态消失（疑似顺手修复，请核实归因）：${name}`)
console.error(`  日志：${current.logPath} | ${baseline.logPath}`)
process.exit(1)
