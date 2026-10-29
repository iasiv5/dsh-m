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
  const { code, text, _captured } = await runSearchCapture(['search', '--query', 'surf'], listMarketImpl)
  return { code, text }
}

/** 位置参数修复（2026-10-16）：可传任意 argv 并捕获 listMarket 收到的 opts；err 行收集（0.9.92 文法钉例用）。 */
async function runSearchCapture(argv, listMarketImpl) {
  const { runCli } = await import('../lib/cli.js')
  const lines = []
  const errLines = []
  let capturedOpts
  const code = await runCli(argv, { listMarket: async (_cfg, opts) => { capturedOpts = opts; return listMarketImpl() } }, {
    out: (l) => lines.push(l),
    err: (l) => errLines.push(l),
  })
  return { code, text: lines.join('\n'), errText: errLines.join('\n'), captured: capturedOpts }
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

describe('dshm search 位置参数（2026-10-16 修复：位置关键词等价 --query，flag 优先）', () => {
  it('① 位置参数作 query：dshm search 主题 ≡ --query 主题', async () => {
    const { code, text, captured } = await runSearchCapture(['search', '主题'], () => resultOf([item()]))
    assert.equal(code, 0)
    assert.equal(captured?.query, '主题', '位置参数应透传为 query（现状 parseArgs 丢弃 → undefined）')
    assert.ok(text.includes('• '), '输出含条目行（计划 Task 5 Step 1 明文断言，R4-P1 补齐）')
  })

  it('② flag 优先：--query x 压过位置参数', async () => {
    const { captured } = await runSearchCapture(['search', '主题', '--query', 'x'], () => resultOf([item()]))
    assert.equal(captured?.query, 'x', '字符串形态的 --query 恒优先')
  })

  it('③ --query 缺值（true 形态）宽容回退位置参数（有意微改：旧行为走无评分浏览）', async () => {
    const { captured } = await runSearchCapture(['search', '主题', '--query'], () => resultOf([item()]))
    assert.equal(captured?.query, '主题', 'flags.query===true 非字符串 → 回退 positionals[0]')
  })
})

describe('dshm search 三端查询文法（0.9.92：market-query 单一入口，非法 category 不再吞错）', () => {
  it('① 非法 category → stderr 报错 + exit 1（今日静默空结果——吞错修复回归钉例）', async () => {
    const { code, errText } = await runSearchCapture(['search', '--category', '非法!!'], () => resultOf([item()]))
    assert.equal(code, 1, '非法 category 必须非零退出（今日 exit 0 吞错）')
    assert.ok(errText.includes('错误：非法分类: 非法!!'), `stderr 应含统一文法报错，实际: ${errText}`)
  })

  it('② 非法 source → stderr 报错 + exit 1（现状补钉，防 rewiring 回退）', async () => {
    const { code, errText } = await runSearchCapture(['search', '--source', 'zone'], () => resultOf([item()]))
    assert.equal(code, 1)
    assert.ok(errText.includes('错误：非法 source: zone'), `stderr 应含统一文法报错，实际: ${errText}`)
  })
})
