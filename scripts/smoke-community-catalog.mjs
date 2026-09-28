#!/usr/bin/env node
/**
 * M1 Task 4 opt-in 冒烟：用本机真实社区目录样本跑「容器校验 → 适配层」全链，
 * 核对收录/跳过规模与产物卫生（计划期望：accepted ≈ 4,100+、subpath ≈ 188、零异常）。
 *
 * 用法：node scripts/smoke-community-catalog.mjs [path]
 *   默认读 /tmp/awesome-plugins.json（真实 4,377 条目录样本，不入库不依赖）；
 *   文件缺失时打印提示并以 0 退出（CI 与测试绝不调用本脚本）。
 */
import { readFileSync } from 'node:fs'
import { validateCommunityContainer } from '../lib/core/community.js'
import { adaptCommunityCatalog } from '../lib/core/community-adapter.js'

const SAMPLE = process.argv[2] ?? '/tmp/awesome-plugins.json'

const V1_ID_RE = /^[a-z0-9][a-z0-9._-]*$/

let raw
try {
  raw = JSON.parse(readFileSync(SAMPLE, 'utf8'))
} catch (err) {
  console.log(`[smoke] 样本不可读（${SAMPLE}）：${err instanceof Error ? err.message : err}`)
  console.log('[smoke] opt-in 工具：放置真实样本后重跑；CI 与测试不依赖本脚本。')
  process.exit(0)
}

const t0 = Date.now()
const v = validateCommunityContainer(raw)
if (!v.ok || !v.catalog) {
  console.error('[smoke] 容器校验失败（整份拒收）—', v.errors.slice(0, 5))
  process.exit(1)
}
const r = adaptCommunityCatalog(v.catalog)
const ms = Date.now() - t0

// 零异常卫生断言
const problems = []
const ids = new Set()
for (const e of r.entries) {
  if (!V1_ID_RE.test(e.id)) problems.push(`id 不满足 v1 规则: ${e.id}`)
  if (ids.has(e.id)) problems.push(`id 重复: ${e.id}`)
  ids.add(e.id)
  if (e.source === 'npm' && !e.npm) problems.push(`npm 条目缺 npm 键: ${e.id}`)
  if (e.source === 'github' && !e.github) problems.push(`github 条目缺 github 键: ${e.id}`)
  if (typeof e.description !== 'string' || e.description === '') problems.push(`描述为空: ${e.id}`)
}
if (r.entries.length + r.skippedDirty + r.skippedSubpathNoNpm !== v.catalog.plugins.length) {
  problems.push('收录 + 跳过 ≠ 上游条数（有条目失踪）')
}

console.log('[smoke] 样本:', SAMPLE)
console.log('[smoke] 上游条数:', v.catalog.plugins.length)
console.log('[smoke] accepted:', r.entries.length)
console.log('[smoke] skippedSubpathNoNpm:', r.skippedSubpathNoNpm)
console.log('[smoke] skippedDirty:', r.skippedDirty)
console.log('[smoke] warnings:', r.warnings.length ? r.warnings.join('；') : '（无）')
console.log(`[smoke] 耗时: ${ms}ms`)

if (problems.length > 0) {
  console.error('[smoke] 卫生断言失败', problems.length, '条 —', problems.slice(0, 10))
  process.exit(1)
}
console.log('[smoke] 卫生断言通过：id 全量合法唯一、来源键配套、无条目失踪')
