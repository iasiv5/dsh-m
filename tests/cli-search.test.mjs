/**
 * 自研元数据 v1.1（2026-10-05）：dshm search 输出对 audience=internal 条目加 [作者自用] 标。
 * 经 runCli deps 注入 mock listMarket，不触网。
 * 运行：npm run build && node --test tests/cli-search.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

function item(over = {}) {
  return {
    id: 'dsh-surf', name: 'DSH Surf', description: '网络冲浪入口', category: 'self-dev', tags: [],
    source: 'npm', npm: '@iasiv5/dsh-surf', installed: false, outdated: false,
    ...over,
  }
}

function resultOf(items) {
  return {
    items,
    total: items.length,
    offset: 0,
    limit: 10,
    categoryCounts: {},
    registryState: { isDefault: true, status: 'ready', stale: false },
    installedComplete: true,
    latestComplete: true,
    latestTimedOut: false,
    community: {
      enabled: true, status: 'ready', version: 'v', checkedAt: 't', fetchedAt: 't',
      route: 'jsdelivr', acceptedCount: 0, upstreamCount: 0, displaced: 0,
      skippedDirty: 0, skippedSubpathNoNpm: 0, errors: [], warnings: [],
    },
  }
}

async function runSearch(listMarketImpl) {
  const { runCli } = await import('../lib/cli.js')
  const lines = []
  const code = await runCli(['search', '--query', 'surf'], { listMarket: async () => listMarketImpl() }, {
    out: (l) => lines.push(l),
    err: () => {},
  })
  return { code, text: lines.join('\n') }
}

describe('dshm search 标注（自研元数据 v1.1）', () => {
  it('audience=internal 条目行含 [作者自用]', async () => {
    const { code, text } = await runSearch(() => resultOf([item({ audience: 'internal' })]))
    assert.equal(code, 0)
    assert.ok(text.includes('[作者自用]'), 'internal 条目行带作者自用标')
  })

  it('audience 缺省条目行不含 [作者自用]', async () => {
    const { code, text } = await runSearch(() => resultOf([item()]))
    assert.equal(code, 0)
    assert.ok(!text.includes('[作者自用]'), 'audience 缺省不加作者自用标')
  })
})
