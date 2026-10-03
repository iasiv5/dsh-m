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
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseDocument } from 'yaml'

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
