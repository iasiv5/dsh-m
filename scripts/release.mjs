#!/usr/bin/env node
/**
 * 发布编排（0.10.7）：npm test 全绿后一条命令收尾，消灭手搓八步的机械错误面
 * （0.10.2–0.10.6 五轮发布实录：tag 重钉舞步、日志文件险些入库、推错分支、网络断连手搓重试）。
 *
 * 前置（人工部分，脚本不代跑）：版本三处已 bump（031）、CHANGELOG 双语顶条已写、npm test 已全绿。
 * 步骤：lock 三处同步（不一致时自动同步，并要求纳入发版提交）→ 干净树检查 → push 预检（fetch + 快进判定）→ tag 重钉 HEAD（幂等）→ check-release 门禁（版本三处/双语顶条/tag=HEAD/发布物断言）
 *       → push main（3 次退避重试）→ push tag（同）→ 打印轮询与 sync 指引（018：绿 ≠ 已上架）。
 * 任一步失败 exit 1（push 幂等可重跑；tag 已重钉则按门禁口径处理）。
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lockVersionMismatch } from './release-lock.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, tries = 1) => {
  for (let i = 1; i <= tries; i++) {
    try {
      console.log(`+ ${cmd}${tries > 1 ? `（第 ${i} 次）` : ''}`)
      return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    } catch (err) {
      if (i === tries) throw err
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000) // 5s 退避（跨平台；原 `ping -n` 为 Windows 专供，Linux 重试路径必炸——2026-10-26 retro）
    }
  }
}

// lock 三处同步（retro 2026-11-01；0.11.8 实录：lock 未同步致 CI 门禁红）：不一致则自动同步，
// 并要求把 package-lock.json 纳入发版提交——避免在版本不一致或脏树上打 tag
{
  const pkgJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const lockJson = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const mismatch = lockVersionMismatch(pkgJson, lockJson)
  if (mismatch) {
    console.log(`[lock] 版本三处不一致（${mismatch}），自动同步：npm install --package-lock-only --ignore-scripts`)
    // 0.12.2 发版实录：npm 11.19 EALLOWSCRIPTS 一过性（~/.npmrc allow-scripts 触发 policy 检查），
    // release 内失败、同命令手动重跑即过——lock 同步是发版最贵失败点，吃 5s 退避重试
    run('npm install --package-lock-only --ignore-scripts', 3)
    const after = lockVersionMismatch(pkgJson, JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')))
    if (after) throw new Error(`lock 同步后仍不一致：${after}`)
    if (run('git status --porcelain -- package-lock.json') !== '') {
      throw new Error('已同步 package-lock.json 的版本号，请先把它纳入发版提交（git add package-lock.json && git commit）后重跑 release')
    }
  }
}

const status = run('git status --porcelain')
if (status !== '') throw new Error(`工作树不干净，先提交或清理：\n${status}`)

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
console.log('[0] push 预检：fetch + 快进判定（retro 2026-10-31：远端漂移此前要烧完整 tag 舞步才失败）……')
run('git fetch origin main')
try {
  execSync('git merge-base --is-ancestor origin/main HEAD', { cwd: root, stdio: 'ignore' })
} catch {
  throw new Error('origin/main 有本地没有的提交（非快进）——先 `git pull --rebase origin main` 重验后再发')
}
run(`git tag -f v${version}`) // 幂等重钉：发布前多笔增量提交后 tag 始终落最终 HEAD
run('npm run check-release') // 门禁（含 tag=HEAD）；失败直接抛，中止发布
run('git push origin main', 3)
run(`git push origin v${version}`, 3)

console.log(`\n✓ v${version} 已推送。`)
console.log('下一步（018：绿 ≠ 已上架）：')
console.log('  1. gh run list --repo iasiv5/dsh-m → 等 Publish to npm 绿')
console.log(`  2. 轮询 https://registry.npmjs.org/dsh-m 出现 ${version}`)
console.log('  3. PUT https://registry-direct.npmmirror.com/dsh-m/sync?sync_upstream=true → 轮询镜像')
