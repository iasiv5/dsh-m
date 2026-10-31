/**
 * 发版前 lock 版本三处一致判定（retro 2026-11-01 第 1 项；0.11.8 实录：lock 未同步致 CI 门禁红）。
 *
 * package.json 的 version 必须与 package-lock.json 的根 version、packages[""].version 三处一致。
 * scripts/release.mjs 发现不一致时自动执行 `npm install --package-lock-only --ignore-scripts` 同步。
 */

/**
 * 纯函数：返回不一致的描述；一致返回 null。
 * 缺少 package.json version（或为空串）一律判为不一致，不因两边都缺失而误判通过。
 */
export function lockVersionMismatch(pkg, lock) {
  const want = pkg?.version
  if (typeof want !== 'string' || want === '') return 'package.json 缺少 version'
  const root = lock?.version
  const inner = lock?.packages?.['']?.version
  if (root === want && inner === want) return null
  return `package.json=${want}，lock 根=${root ?? '—'}，lock packages[""]=${inner ?? '—'}`
}
