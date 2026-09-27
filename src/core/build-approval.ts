/**
 * 精确构建放行（0.4.0，ADR-0002；plan Task 3）：
 * pnpm 11 拦下依赖构建脚本时会在 `pnpm-workspace.yaml` 的 `allowBuilds` 映射里留下
 * 待决占位（值为 "set this to true or false"）。本模块提供两个纯函数：
 *
 * - readPendingBuilds：解析待决名单（键不含通配符、值精确等于占位串）——官方
 *   `readPendingBuilds`（dsh-plugin-manager L941）同款判定；官方对坏结构 throw，
 *   此处收窄为返回 []（调用方据此走全量兜底，ADR-0002 的保守回退）；
 * - applyPreciseBuilds：为名单逐键写 `allowBuilds.<name>: true`（保注释 YAML 编辑）。
 *
 * 官方 `approveBuilds` 的调用前提是「caller 持 profile manifest 锁」；dsh-m 事务
 * 只有进程内 FIFO，与官方 UI 并发安装时此处存在低概率写竞态窗口——按 ADR-0002
 * 声明为已知风险，相关整单失败走既有回滚语义，不额外加锁。
 */
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'

/** pnpm 11 写下的待决占位值（逐字，官方同款）。 */
const PENDING_PLACEHOLDER = 'set this to true or false'

/** 键含通配符的规则不进精确放行（官方同款排除）。 */
function isPlainKey(key: string): boolean {
  return !/[*?]/.test(key)
}

/**
 * 读 pnpm-workspace.yaml 文本的待决构建名单。
 * 保守口径：坏 YAML / 根非映射 / allowBuilds 非映射 / 条目含锚点或别名 / 值非标量
 * 一律返回 []——调用方走 `withDangerouslyAllowAllBuilds` 全量兜底并如实标注。
 */
export function readPendingBuilds(text: string): string[] {
  let document
  try {
    document = parseDocument(text)
  } catch {
    return []
  }
  if (document.errors.length > 0) return []
  if (!isMap(document.contents)) return []
  const builds = document.contents.get('allowBuilds')
  if (builds === undefined || builds === null) return []
  if (!isMap(builds)) return []
  const pending: string[] = []
  for (const pair of builds.items) {
    const { key, value } = pair
    if (!isScalar(key) || typeof key.value !== 'string') continue
    if (isAlias(key) || isAlias(value)) return []
    // 锚点定义同样拒绝（官方 visit 检查的保守化）
    if ((isMap(value) || isSeq(value)) && 'anchor' in value && value.anchor) return []
    if (!isScalar(value) || value.value !== PENDING_PLACEHOLDER) continue
    if (!isPlainKey(key.value)) continue
    pending.push(key.value)
  }
  return pending
}

/**
 * 为名单逐键写 `allowBuilds.<name>: true`（保注释；allowBuilds 缺失时创建）。
 * 坏 YAML / 根非映射 → throw（调用方按放行写入失败处理，走既有 hard-fail 转换契约）。
 * names 为空返回原文。
 */
export function applyPreciseBuilds(text: string, names: string[]): string {
  if (names.length === 0) return text
  const document = parseDocument(text)
  const error = document.errors[0]
  if (error !== undefined) throw error
  if (!isMap(document.contents)) throw new Error('pnpm-workspace.yaml 必须是 YAML 映射')
  const existing = document.contents.get('allowBuilds')
  if (existing !== undefined && existing !== null && !isMap(existing)) {
    throw new Error('allowBuilds 必须是 YAML 映射')
  }
  for (const name of names) {
    if (typeof name !== 'string' || !isPlainKey(name)) {
      throw new Error(`精确放行拒绝通配/非法键: ${JSON.stringify(name)}`)
    }
    // setIn 自动创建缺失的中间映射（allowBuilds 缺失时一并创建）
    document.setIn(['allowBuilds', name], true)
  }
  return String(document)
}
