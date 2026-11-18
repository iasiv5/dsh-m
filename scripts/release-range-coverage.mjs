#!/usr/bin/env node
/**
 * CHANGELOG 顶条 × tag 区间提交覆盖判定（2026-11-18 retro：0.12.22 首发条目只覆盖一役、
 * 区间另一半战役漏账，主人审计问出后 0f50c92 补正）——check-release 门禁的纯函数部分，
 * release-lock.mjs 同款惯例（可被 tests/ 直接 import）。
 *
 * 规则：行为承载提交（feat/fix/refactor/perf/registry 前缀）须在顶条留痕——
 *   ① 主题带引用号（#N / ADR-NN / DN）→ 任一命中顶条即过（不回落标识符）；
 *   ② 无引用号 → 主题内标识符（≥6 字符 latin 词；conventional scope 如 core/tools 天然短于阈值）任一命中即过；
 *   ③ 纯中文无标识符 → 不可机械判定，入 unverifiable（门禁仅警告不拦）。
 * docs/test/chore/release 型提交不拦（文档与守卫随条目概述即可，0.12.22 补正形态）。
 */
export const BEARING_COMMIT_RE = /^(feat|fix|refactor|perf|registry)[:(]/

const REF_RE = /#[0-9]+|ADR-[0-9]+|\bD[0-9]+\b/g
const ID_RE = /[A-Za-z][A-Za-z0-9_-]{5,}/g

/** `git log --oneline` 行（可带 hash 前缀）× 顶条文本 → { missing, unverifiable }（保序）。 */
export function rangeCoverage(commitSubjects, entryText) {
  const missing = []
  const unverifiable = []
  const entry = String(entryText ?? '')
  for (const raw of Array.isArray(commitSubjects) ? commitSubjects : []) {
    const subject = String(raw).replace(/^[0-9a-f]{7,40} /, '')
    if (!BEARING_COMMIT_RE.test(subject)) continue
    const refs = [...subject.matchAll(REF_RE)].map((m) => m[0])
    if (refs.length > 0) {
      if (!refs.some((r) => entry.includes(r))) missing.push(subject)
      continue
    }
    const ids = [...subject.matchAll(ID_RE)].map((m) => m[0])
    if (ids.length === 0) unverifiable.push(subject)
    else if (!ids.some((w) => entry.includes(w))) missing.push(subject)
  }
  return { missing, unverifiable }
}

/** 版本 tag 列表 → 严格小于 current 的最大版本 tag（原样返回，如 'v0.12.21'）；无可比者返回 null。 */
export function previousVersionTag(tags, current) {
  const parse = (t) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(t ?? '').trim())
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  const cur = parse(current)
  if (!cur) return null
  let best = null
  let bestV = null
  for (const t of Array.isArray(tags) ? tags : []) {
    const v = parse(t)
    if (!v || cmp(v, cur) >= 0) continue
    if (bestV === null || cmp(v, bestV) > 0) {
      best = String(t).trim()
      bestV = v
    }
  }
  return best
}
