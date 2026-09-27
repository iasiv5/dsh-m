/**
 * peer 兼容预检（0.4.0，plan Task 6；语义逐条对齐官方 evaluatePluginCompatibility
 * ——dsh-app-boot L286-313，源码在 app-boot 而非 plugin-manager 本体）：
 *
 * - 只检 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 键；
 * - `workspace:^` / `workspace:~` / `workspace:*` 视为当前运行时版本（workspace 依赖
 *   在发布时由运行时替换）；
 * - 空 range 不满足；semver satisfies 带 includePrerelease（rc 生态必需）；
 * - 运行时版本解析失败（null）→ 不拦（结果由调用方注明「未检」）；
 * - github 源不在此路径（无 packument），由 market 层提示 compatSkipped；
 * - 无豁免机制（grilling Q6 定稿）：确认/force 即通道。
 */
import { satisfies } from 'semver'
import { npmVersion } from './versions.js'
import { resolveDshVersion } from './dsh-version.js'

const WORKSPACE_SPECS = ['workspace:^', 'workspace:~', 'workspace:*']

export interface CompatIssue {
  pkg: string
  version: string
  runtimeVersion: string | null
  /** 不满足的 dsh peers（键 = 包名，值 = 声明的 range） */
  peers: Record<string, string>
}

export class IncompatibleError extends Error {
  readonly issue: CompatIssue
  constructor(issue: CompatIssue) {
    super(`插件 ${issue.pkg}@${issue.version} 与 DSH ${issue.runtimeVersion} 不兼容（peerDependencies: ${JSON.stringify(issue.peers)}）`)
    this.issue = issue
  }
}

/**
 * 纯函数：peers 中不满足运行时版本的 dsh 系键（空对象 = 兼容）。
 * 非法 range 按 semver 抛错口径让位给 satisfies（异常上抛，调用方如实报告）。
 */
export function evaluatePeers(peers: Record<string, string>, runtimeVersion: string): Record<string, string> {
  const failing: Record<string, string> = {}
  for (const [name, range] of Object.entries(peers)) {
    if (typeof range !== 'string') continue
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
    const requirement = WORKSPACE_SPECS.includes(range) ? runtimeVersion : range
    if (requirement.trim() === '' || !satisfies(runtimeVersion, requirement, { includePrerelease: true })) {
      failing[name] = range
    }
  }
  return failing
}

export interface PrecheckOptions {
  timeoutMs: number
  signal?: AbortSignal
  /** 运行时版本注入（测试用）；缺省 = resolveDshVersion()（进程内缓存） */
  runtimeVersion?: string | null
  /** 版本元数据读取注入（测试用）；缺省 = npmVersion */
  fetchVersion?: typeof npmVersion
}

/**
 * npm 源预检：拉该精确版本的 peerDependencies 与运行时版本比对。
 * 返回 null = 兼容或无法判定（runtime 解析失败 → 不拦）。
 */
export async function precheckNpmCompat(
  pkg: string,
  version: string,
  opts: PrecheckOptions,
): Promise<CompatIssue | null> {
  const runtime = opts.runtimeVersion !== undefined ? opts.runtimeVersion : await resolveDshVersion()
  if (runtime === null || runtime === '') return null
  const fetchVersion = opts.fetchVersion ?? npmVersion
  const meta = await fetchVersion(pkg, version, opts.timeoutMs, opts.signal)
  const failing = evaluatePeers(meta.peers ?? {}, runtime)
  if (Object.keys(failing).length === 0) return null
  return { pkg, version, runtimeVersion: runtime, peers: failing }
}
