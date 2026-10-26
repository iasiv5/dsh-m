#!/usr/bin/env node
/**
 * 发版前门禁（0.9.94 retro 落地，validate-registry.mjs 同款独立脚本惯例）。
 * 一条命令跑完 know-how 031/018 检查单的机器可判部分：
 *   1. 版本三处一致：package.json ≡ lock 根两字段；
 *   2. CHANGELOG 双语顶条均含该版本号（顶条版本号此前是人工核对项，现门禁化）；
 *   3. 本地 tag v<version> 存在且指向 HEAD（0.9.94 实录教训：tag 未建先 push 报 refspec 错）；
 *   4. 发布物断言（0.10.7 接线 assert-pack）：pack --dry-run 清单齐备、DESIGN/CHANGELOG 不回潜。
 * 用法：bump 版本 → 建 tag → `npm run check-release` → push。任一项不符 exit 1。
 */
import { readFileSync } from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { packIssues, extractPackFiles } from './assert-pack.mjs'
import { unapprovedEmails } from './commit-identity.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const version = pkg.version

const fails = []
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!cond) fails.push(label)
}

check(`package.json version = ${version}`, typeof version === 'string' && version.length > 0)
check('lock 根字段 version 一致', lock.version === version, `lock.version = ${lock.version}`)
check('lock packages."" version 一致', lock.packages?.['']?.version === version, `packages."" = ${lock.packages?.['']?.version}`)

const lines = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/)
const topAfter = (marker) => {
  const idx = lines.indexOf(marker)
  return idx === -1 ? null : lines.slice(idx + 1).find((l) => l.startsWith('### '))
}
const zhTop = topAfter('## 中文')
const enTop = topAfter('## English')
check(`CHANGELOG 中文顶条含 ${version}`, Boolean(zhTop && zhTop.includes(version)), zhTop ?? '（未找到条目）')
check(`CHANGELOG English 顶条含 ${version}`, Boolean(enTop && enTop.includes(version)), enTop ?? '（未找到条目）')

let tagHead = ''
const tagRev = spawnSync('git', ['rev-parse', `v${version}^{commit}`], { cwd: root, encoding: 'utf8' })
if (tagRev.status === 0 && typeof tagRev.stdout === 'string') {
  tagHead = tagRev.stdout.trim()
}
/* status ≠ 0 → tag 不存在，留空，下方判 ✗ */
const head = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim()
check(
  `tag v${version} 存在且指向 HEAD`,
  tagHead === head,
  tagHead === '' ? '本地无此 tag——先 git tag 再 push' : tagHead === head ? 'tag = HEAD' : `tag 指向 ${tagHead.slice(0, 8)} ≠ HEAD ${head.slice(0, 8)}`,
)

// retro S1（2026-10-24）：发版即公开历史——未推提交的 author/committer 必须是核准
// 公开身份（GitHub noreply，或主人核准名单 iasi@163.com，与 dsh-quota-watch 同口径）。
// 只查 origin/main..HEAD：仓库历史已有历史邮箱，不追溯；无未推提交 = 跳过。
try {
  const identityOut = execSync('git log --format=%ae%n%ce origin/main..HEAD', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const lines = identityOut.split(/\r?\n/).filter(Boolean)
  const bad = unapprovedEmails(lines)
  const commitCount = lines.length / 2
  check(
    `提交身份（未推 ${commitCount} 笔）`,
    bad.length === 0,
    lines.length === 0 ? '无未推提交——跳过' : bad.length === 0 ? '全部核准' : `未核准邮箱：${bad.join('、')}（核准名单见 scripts/lib/commit-identity.mjs）`,
  )
} catch (err) {
  check('提交身份', false, String(err?.message ?? err))
}

// 0.10.7：发布物断言接线（assert-pack 同一份规则）——pack --dry-run（含 prepare 构建，~40s）
try {
  const packOut = execSync('npm pack --dry-run --json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const files = extractPackFiles(packOut)
  if (!files) throw new Error('pack 输出缺少 files 数组')
  const issues = packIssues(files)
  check(`发布物清单（${files.length} 文件；DESIGN/CHANGELOG 移出 + 运行时齐备）`, issues.length === 0, issues.join('；'))
} catch (err) {
  check('发布物清单断言', false, String(err?.message ?? err))
}

// 0.10.9 retro C2（评审 O-3/O-5 两轮实证）：CHANGELOG 顶部条目的测试计数会随增测试静默过期——
// 门禁化：中文顶条含「全量 N/N」时对实测通过数断言（门禁内实跑一遍 npm test，~100s；pack 步
// 的 prepare 已完成构建，此处不重复 build）。
try {
  const zhIdx = lines.indexOf('## 中文')
  const zhBodyEnd = lines.findIndex((l, i) => i > zhIdx && l.startsWith('### ') && i > lines.indexOf(zhTop))
  const zhBody = lines.slice(lines.indexOf(zhTop), zhBodyEnd === -1 ? undefined : zhBodyEnd).join('\n')
  const claimed = zhBody.match(/全量 (\d+)\/\1/)
  if (!claimed) {
    check('CHANGELOG 测试计数新鲜度', true, '中文顶条无「全量 N/N」主张——跳过')
  } else {
    const want = Number(claimed[1])
    const testOut = execSync('node --test tests/*.test.mjs', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const got = Number((testOut.match(/^ℹ pass (\d+)$/m) || [])[1] ?? NaN)
    check(`CHANGELOG 计数新鲜度（主张 ${want} = 实测 ${got}）`, got === want, got === want ? '' : '实测与主张不符——先回写 CHANGELOG 再发版')
  }
} catch (err) {
  check('CHANGELOG 测试计数新鲜度', false, String(err?.message ?? err))
}

if (fails.length > 0) {
  console.error(`\n发版门禁未过（${fails.length} 项）：${fails.join('；')}`)
  process.exit(1)
}
console.log('\n发版门禁全过，可推送。')
