/**
 * M1 Task 7：tools.ts summary 纯函数直测（client-tool-view 只测客户端 payload，不承担服务端工具契约）。
 * 运行：npm run build && node --test tests/tools-summary.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { communityToolSummary, latestErrorCodeReason } from '../lib/tools.js'

function readySummary(overrides = {}) {
  return {
    enabled: true, status: 'ready', version: '2026.928.1', checkedAt: 't', fetchedAt: 't',
    route: 'jsdelivr', acceptedCount: 4189, upstreamCount: 4377, displaced: 3,
    skippedDirty: 0, skippedSubpathNoNpm: 188, errors: [], warnings: [],
    ...overrides,
  }
}

describe('communityToolSummary（dshm_search/list/outdated 的 community 四键）', () => {
  it('② ready → 四键齐全（acceptedCount/route/status/version）', () => {
    const s = communityToolSummary(readySummary())
    assert.deepEqual(s, { acceptedCount: 4189, route: 'jsdelivr', status: 'ready', version: '2026.928.1' })
  })

  it('stale → 计数字段保留（缓存快照仍展示收录规模）', () => {
    const s = communityToolSummary(readySummary({ status: 'stale' }))
    assert.equal(s.status, 'stale')
    assert.equal(s.acceptedCount, 4189)
    assert.equal(s.route, 'jsdelivr')
  })

  it('disabled/unavailable → 计数字段 null 不伪造；缺省输入 → unavailable 形状', () => {
    for (const status of ['disabled', 'unavailable']) {
      const s = communityToolSummary(readySummary({ status, acceptedCount: 0, route: null, version: null }))
      assert.equal(s.acceptedCount, null)
      assert.equal(s.route, null)
      assert.equal(s.status, status)
    }
    const missing = communityToolSummary(undefined)
    assert.deepEqual(missing, { acceptedCount: null, route: null, status: 'unavailable', version: null })
  })
})

describe('latestErrorCodeReason（⑨ 按 code 安全化原因）', () => {
  it('四类 code 各自归类，不得一律归因预算', () => {
    assert.equal(latestErrorCodeReason('budget-exhausted'), '因 GitHub 预算未完成')
    assert.equal(latestErrorCodeReason('rate-limited'), 'GitHub 限流')
    assert.equal(latestErrorCodeReason('timeout'), '检查超时')
    assert.equal(latestErrorCodeReason('network-error'), '网络错误')
    assert.equal(latestErrorCodeReason(null), '网络错误')
  })
})
