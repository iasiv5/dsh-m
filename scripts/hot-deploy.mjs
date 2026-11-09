#!/usr/bin/env node
/**
 * 热部署（dsh-m 版，镜像 dsh-skins scripts/hot-deploy.sh 姿势）：把本地构建的 lib/client.js
 * 覆盖进本机 DSH web profile（未发版态预览）。严格 fail-fast：
 *   守卫 → build → npm test（裸退出码）→ 备份 → 原子替换（断硬链接）→ sha 校验 → 打印回滚。
 * 任一步失败即停、不碰 profile。
 *
 * 与 dsh-skins 版的两处差异（2026-11-09 retro S1）：
 * 1. 部署面只有 lib/client.js（client-only，浏览器刷新即生效，know-how 037；宿主面文件
 *    lib/host.js|tools.js|cli.js|core/* 一律不部署——只对账并在有差异时提示「随发版+重启到位」，
 *    避免活宿主的盘上/内存混合态）；
 * 2. 原子替换内建**硬链接防呆**：profile 文件常与 pnpm content-addressable store 硬链接
 *    （blob 文件名编码旧内容哈希），原地 cp 会连坐改写 store——本脚本一律走「临时文件
 *    + rename」，替换后断言 dest nlink===1，从结构上排除该陷阱（2026-11-09 实录：原地 cp
 *    改写 store blob，靠 find -inum 取证后手工恢复）。
 *
 * 用法：node scripts/hot-deploy.mjs [--skip-tests]
 * 环境变量：DSH_M_PROFILE（profile 包根，默认 ~/.dsh/profiles/web/node_modules/dsh-m）、
 *          DSH_M_HOTFIX_BACKUP_DIR（备份根，默认 ~/.dsh-m-hotfix-backups）。
 * 须在无沙箱写限制的会话执行（esbuild 子进程 + profile 写）。
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = 'lib/client.js'
const HOST_FILES = ['lib/host.js', 'lib/tools.js', 'lib/cli.js']

export const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/**
 * 原子替换（测试与主流程共用）：临时文件写入 → chmod 回原 mode → rename 断链覆盖 →
 * sha 双读校验 + dest nlink===1 断言。dest 原为硬链接（nlink>1）时返回 wasHardlinked=true
 * 供调用方留痕；原 inode 上的旧内容（pnpm store blob 等）不受影响。
 */
export function atomicReplace(src, dest) {
  const st = statSync(dest)
  const wasHardlinked = st.nlink > 1
  const stageDir = mkdtempSync(join(tmpdir(), 'hotdeploy-'))
  const stage = join(stageDir, 'payload')
  try {
    copyFileSync(src, stage)
    chmodSync(stage, st.mode & 0o777)
    renameSync(stage, dest)
  } finally {
    rmSync(stageDir, { recursive: true, force: true })
  }
  if (sha256(src) !== sha256(dest)) throw new Error(`sha mismatch after deploy: ${dest}`)
  if (statSync(dest).nlink !== 1) throw new Error(`dest still hardlinked after deploy: ${dest}`)
  return { wasHardlinked }
}

const main = () => {
  const skipTests = process.argv.includes('--skip-tests')
  const profileRoot = process.env.DSH_M_PROFILE || join(process.env.HOME, '.dsh/profiles/web/node_modules/dsh-m')
  const backupRoot = process.env.DSH_M_HOTFIX_BACKUP_DIR || join(process.env.HOME, '.dsh-m-hotfix-backups')
  const profileClient = join(profileRoot, CLIENT)

  console.log('== 守卫 ==')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (pkg.name !== 'dsh-m') throw new Error('not running from dsh-m repo root')
  if (!existsSync(join(root, CLIENT))) throw new Error(`repo build artifact missing: ${CLIENT}（先 npm run build）`)
  const profilePkg = JSON.parse(readFileSync(join(profileRoot, 'package.json'), 'utf8'))
  if (profilePkg.name !== 'dsh-m') throw new Error(`profile root is not dsh-m package: ${profileRoot}`)
  if (!existsSync(profileClient)) throw new Error(`profile client missing: ${profileClient}`)
  console.log(`profile=${profilePkg.version} repo=${pkg.version}${profilePkg.version !== pkg.version ? '（跨版本热部署属正常，发版前记得 bump）' : ''}`)

  console.log('== build ==')
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
  if (build.status !== 0) throw new Error(`build failed (exit ${build.status})`)

  if (!skipTests) {
    console.log('== npm test（裸退出码）==')
    const test = spawnSync('npm', ['test'], { cwd: root, stdio: 'inherit' })
    if (test.status !== 0) throw new Error(`npm test failed (exit ${test.status})——红状态不部署`)
  } else {
    console.log('== npm test 跳过（--skip-tests）==')
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const backupDir = join(backupRoot, stamp)
  mkdirSync(backupDir, { recursive: true })
  const backupFile = join(backupDir, 'client.js')
  copyFileSync(profileClient, backupFile)
  console.log(`== 备份 ${profileClient} -> ${backupFile} ==`)

  console.log('== 对账宿主面（只读，不部署）==')
  const hostDiffs = HOST_FILES.filter((f) => {
    const a = join(root, f)
    const b = join(profileRoot, f)
    return existsSync(a) && existsSync(b) && sha256(a) !== sha256(b)
  })
  console.log(hostDiffs.length > 0
    ? `!! 宿主面与 profile 有差异（不部署，随发版+重启到位）：${hostDiffs.join(', ')}`
    : '宿主面无差异。')

  console.log('== 原子替换（断硬链接）==')
  const { wasHardlinked } = atomicReplace(join(root, CLIENT), profileClient)
  if (wasHardlinked) console.log('!! dest 原为硬链接（pnpm store 连坐风险）——本次以 rename 断链替换')

  console.log('== sha 校验 ==')
  console.log(sha256(join(root, CLIENT)), join(root, CLIENT))
  console.log(sha256(profileClient), profileClient)

  console.log('✓ 已部署（client-only：浏览器刷新即生效；禁在 agent 会话内重启宿主，know-how 037）。')
  console.log(`  回滚: mv ${backupFile} ${profileClient}`)
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invoked) {
  try {
    main()
  } catch (err) {
    console.error(`hot-deploy failed: ${err.message}`)
    process.exit(1)
  }
}
