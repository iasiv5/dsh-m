/**
 * 体检（Doctor，ADR-0010）：对单个 profile 的只读健康检查。
 *
 * 纪律（照 dsh-market check.ts 学习所得，详见对比报告 §4）：
 * - 纯文件系统分析：无进程派生、无网络请求、无文件写入/删除——任意时刻可安全调用。
 *   版本解析只用 readLauncherPackageVersion 纯 FS 通路；resolveDshVersion 的
 *   spawn `dsh --version` 回退为 doctor 禁区（CLI 下解析为 null 即降级，绝不 spawn）。
 * - 三级严重度：error（断链或必然阻断启动）/ warning（确认异常但不阻止启动）/
 *   结构化清单（只列不警，零告警渲染）；unknown≠broken——看不见的对象显式标
 *   unknown 并沉默，不推断为损坏。
 * - 每条 error/warning 必须含三要素：发生了什么（title）/ 为什么（detail）/ 现在怎么办（hint）。
 * - 密钥红线：绝不读取或转储 cordis.patch.yml 等含密钥配置文件内容；报告只含
 *   包名、路径、版本号等结构化事实（链接目标目录 package.json 的 version 字段
 *   属包元数据，不在禁令内）。
 * - 修复责任外移：doctor 永不写不删，修复建议以文字形态给出（ADR-0010 决定 5）。
 */
import { readdir, readFile, lstat, stat, readlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseDocument } from 'yaml'
import { dshHome } from './env.js'

// ---------- 报告类型（Task 1 契约；schema 版本化，后续检查项扩展 finding 枚举不破坏消费方） ----------

export type Severity = 'error' | 'warning'

export interface DoctorFinding {
  check: 'farm-liveness' | 'residue' | 'account-reality' | 'meta'
  severity: Severity
  /** 发生了什么（含包名/路径等结构化事实） */
  title: string
  /** 为什么这是问题 */
  detail: string
  /** 现在怎么办（只给建议，doctor 不代执行） */
  hint: string
}

export interface FarmLinkItem {
  name: string
  target: string
  state: 'dangling' | 'stale-target' | 'healthy'
  targetVersion: string | null
}

export interface ResidueItem {
  kind: 'no-manifest' | 'empty-scope' | 'tmp-dir' | 'bak-file'
  path: string
  note: string | null
}

export interface AccountItem {
  name: string
  pin: string | null
  installed: string | null
  lockfile: string | null
  consistent: boolean
}

export interface DoctorReport {
  schema: 'dsh-m/doctor/v1'
  profileDir: string
  layout: 'hoisted' | 'isolated' | 'unknown'
  /** 调用方解析的 DSH 运行时版本（method 通路宿主内可得；CLI 通路可能为 null → stale 判定降级） */
  runtimeVersion: string | null
  scannedAt: string
  summary: {
    errors: number
    warnings: number
    farmChecked: number
    farmDangling: number
    farmStale: number
    residueCount: number
    accountChecked: number
    accountMismatched: number
    /** unknown≠broken：聚合呈现的「看不懂/没扫到」事实（聚合计数+代表例，不逐条刷屏） */
    unknowns: string[]
  }
  farm: FarmLinkItem[]
  residue: ResidueItem[]
  account: AccountItem[]
  findings: DoctorFinding[]
  /** 双市场并存事实（信息级，不产生 finding）：dsh-m 与 dshmarket 同时在 dependencies */
  dualMarket: string[] | null
}

// ---------- 布局探测（Task 1） ----------

/**
 * 判据与优先级（评审 R1.1 定案）：**workspace 声明优先**——pnpm-workspace.yaml 声明
 * `nodeLinker: hoisted` 即判 hoisted，残留的 `.pnpm` 目录（如仅含 lock.yaml 的本机
 * 实况形态）不推翻声明；isolated = 无 hoisted 声明且 `node_modules/.pnpm` 存在且
 * **含包目录**（仅 lock.yaml 的残留形态不算）；其余 unknown。
 * 任何读取/解析失败都走 unknown 分支，不抛异常（unknown≠broken）。
 */
export async function detectLayout(profileDir: string): Promise<'hoisted' | 'isolated' | 'unknown'> {
  const root = resolve(profileDir)
  let wsText: string | null = null
  try {
    wsText = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')
  } catch {
    wsText = null
  }
  if (wsText !== null) {
    try {
      const doc = parseDocument(wsText)
      const nodeLinker = doc.getIn(['nodeLinker'], true)
      if (nodeLinker && typeof nodeLinker.toString === 'function' && nodeLinker.toString() === 'hoisted') {
        return 'hoisted'
      }
    } catch {
      /* 坏 YAML 不构成任何判据，落 .pnpm 存在性判定 */
    }
  }
  let entries: string[]
  try {
    entries = await readdir(join(root, 'node_modules', '.pnpm'))
  } catch {
    return 'unknown'
  }
  const hasPackageDir = entries.some((e) => e !== 'lock.yaml')
  return hasPackageDir ? 'isolated' : 'unknown'
}

// ---------- 农场测活（Task 2，know-how 014 的工具化） ----------

/** pnpm 虚拟店目录名里的版本段：`@deepseek-ai+<pkg>@<ver>_<hash>`（targetVersion 第一级提取）。 */
const STORE_VERSION_RE = /@deepseek-ai\+[^/\\]+@([^_/\\]+)_[0-9a-f]+(?:[\\/]|$)/

/** dsh 伞包：其版本即 DSH 运行时版本，是唯一可与 runtimeVersion 比较的农场成员。 */
const DSH_UMBRELLA = '@deepseek-ai/dsh'

/** 祖先链向上遍历的最大层数（防御病态深路径）。 */
const MAX_ANCESTOR_LEVELS = 16

async function existsDir(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true // stat 成功解析即存在（文件或目录皆算存活目标）
  } catch {
    return false
  }
}

/** 从 targetDir 的 package.json 读 version（targetVersion 第二级提取；失败返回 null 不抛）。 */
async function readTargetPkgVersion(targetDir: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof raw?.version === 'string' && raw.version ? raw.version : null
  } catch {
    return null
  }
}

/**
 * 农场测活：遍历 profile 可见范围内 `@deepseek-ai/*` 符号链接，判定悬空 / 指向旧运行时 store / 健康。
 *
 * - 遍历规则（评审 R1.2 定案）：从 profileDir 逐级向上至 DSH_HOME 边界，扫描每级
 *   `node_modules/@deepseek-ai`——本机实况农场在 profile **父目录**的共享 hoisted 店，
 *   不得以「工作区根」为限（否则 0 命中空转，farmChecked=0 是验收失败信号）。
 * - stale 判定只对 dsh 伞包生效：lockstep 店内各核心包（cordis 4.x、dsh-tools 0.1.x…）
 *   与运行时版本**不在同一命名空间**，逐包比较会把 cordis@4.0.1 误标 stale——误报纪律
 *   （健康档误报代价 > 漏报）禁止；其余包 targetVersion 仅作信息呈现。stale-target 只进
 *   farm 清单不产生 finding（提示级，ADR-0010 决定 4）。
 * - runtimeVersion 为 null（CLI 通路纯 FS 解析不可得，绝不 spawn）→ 全部不判 stale、
 *   unknowns 记一条聚合降级说明（unknown≠broken，评审 R1.3）。
 * - targetVersion 两级提取（评审 R1.4）：目录名版本段优先 → 目标 package.json version；
 *   两级皆失败置 null 并聚合计入 unknowns。
 */
export async function analyzeFarm(
  profileDir: string,
  layout: 'hoisted' | 'isolated' | 'unknown',
  runtimeVersion: string | null,
): Promise<{ farm: FarmLinkItem[]; findings: DoctorFinding[]; unknowns: string[] }> {
  const farm: FarmLinkItem[] = []
  const findings: DoctorFinding[] = []
  const unknowns: string[] = []
  let unresolvedVersionCount = 0

  // 祖先链层级收集：profileDir 起向上，含 DSH_HOME 边界（boundary 是祖先时）；越界或到根即止
  const boundary = resolve(dshHome())
  const levels: string[] = []
  let cur = resolve(profileDir)
  for (let i = 0; i < MAX_ANCESTOR_LEVELS; i++) {
    levels.push(cur)
    if (cur === boundary) break
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }

  for (const level of levels) {
    const scopeDir = join(level, 'node_modules', '@deepseek-ai')
    let names: string[]
    try {
      names = await readdir(scopeDir)
    } catch {
      continue // 该级无 node_modules/@deepseek-ai，静默跳过（不是每一级都有）
    }
    for (const name of names) {
      if (name.startsWith('.')) continue
      const linkPath = join(scopeDir, name)
      let isSymlink = false
      try {
        isSymlink = (await lstat(linkPath)).isSymbolicLink()
      } catch {
        continue
      }
      if (!isSymlink) continue // 农场只关心符号链接；真实目录是物化安装，不在测活范围
      const target = await readlinkSafe(linkPath)
      if (target === null) {
        // readlink 失败：链接本身不可读——按 unknown 计，不猜
        unresolvedVersionCount += 1
        farm.push({ name, target: linkPath, state: 'healthy', targetVersion: null })
        continue
      }
      const resolvedTarget = resolve(dirname(linkPath), target)
      const alive = await existsDir(resolvedTarget)
      // targetVersion 两级提取
      let targetVersion: string | null = null
      const m = STORE_VERSION_RE.exec(resolvedTarget)
      if (m) targetVersion = m[1]
      if (targetVersion === null) targetVersion = await readTargetPkgVersion(resolvedTarget)
      if (targetVersion === null) unresolvedVersionCount += 1

      let state: FarmLinkItem['state'] = 'healthy'
      if (!alive) {
        state = 'dangling'
      } else if (
        runtimeVersion !== null &&
        targetVersion !== null &&
        `@deepseek-ai/${name}` === DSH_UMBRELLA &&
        targetVersion !== runtimeVersion
      ) {
        state = 'stale-target'
      }
      farm.push({ name, target: resolvedTarget, state, targetVersion })
      if (state === 'dangling') {
        findings.push({
          check: 'farm-liveness',
          severity: 'error',
          title: `@deepseek-ai/${name} 符号链接悬空`,
          detail: `指向 ${resolvedTarget}，目标不存在（DSH 升级后旧 store 目录被拆的 know-how 014 形态；本链接已不能引导任何加载）`,
          hint: '重装该包（dshm upgrade / install），或按 know-how 014 的 heal 流程重指向新 store；体检不代执行',
        })
      }
    }
  }

  if (runtimeVersion === null) {
    unknowns.push('运行时版本未解析（纯 FS 通路不可得，绝不 spawn）——stale 判定整体降级为 unknown')
  }
  if (unresolvedVersionCount > 0) {
    unknowns.push(`${unresolvedVersionCount} 条链接目标版本无法解析（目录名无版本段且目标 package.json 不可读），详见 farm 清单`)
  }
  return { farm, findings, unknowns }
}

/** readlink 包装：失败返回 null（不抛）。 */
async function readlinkSafe(linkPath: string): Promise<string | null> {
  try {
    return await readlink(linkPath)
  } catch {
    return null
  }
}
