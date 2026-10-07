/**
 * M1 Task 5：GitHub 请求预算（request-scoped ≤25 + 宿主滚动 1h ≤50 仅被动）+
 * 同仓库 single-flight（预算策略池分池 / waiter-scoped signal / join 零 wire 成本）。
 * wire 层以 mock globalThis.fetch 计数（每个物理 fetch 一次，重定向跳由 fetchLimited 循环自然触发）。
 * 运行：npm run build && node --test tests/versions.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listInstalledWithMeta, installFromRegistry } from '../lib/core/market.js'
import { npmLatest, npmPackument, npmPackumentReadme, npmVersion } from '../lib/core/versions.js'
import {
  createGithubRequestBudget,
  githubLatestTag,
  githubTagSha,
  GithubBudgetExhaustedError,
  _backdateGithubHourlyWindowForTests,
  _resetGithubHourlyWindowForTests,
} from '../lib/core/versions.js'
import { _setWireFetchForTests } from '../lib/core/httpx.js'

const SHA = 'a'.repeat(40)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchCalls = []
function installMockFetch(handler) {
  // L0（ADR-0012）：wire 已迁至 undici 包 fetch，mock 走 httpx 测试缝隙（语义不变：每物理请求一次）。
  _setWireFetchForTests(async (input) => {
    const url = String(input)
    fetchCalls.push(url)
    return handler(url)
  })
}

/** api.github.com 假路由：releases/latest / commits/{ref} / tags。 */
function ghHandler(opts = {}) {
  return async (url) => {
    if (opts.delayMs) await sleep(opts.delayMs)
    if (url.includes('/releases/latest')) {
      if (opts.releases === '404') return jsonResponse('not found', 404)
      if (opts.releases === 'redirect') {
        if (url.includes('hop=2')) return jsonResponse({ tag_name: 'v1.2.3' })
        return new Response(null, { status: 302, headers: { location: 'https://api.github.com/repos/o/r/releases/latest?hop=2' } })
      }
      return jsonResponse({ tag_name: 'v1.2.3' })
    }
    if (url.includes('/commits/')) return jsonResponse({ sha: opts.commitSha ?? SHA })
    if (url.endsWith('/tags')) return jsonResponse([{ name: 'v0.1.0', commit: { sha: SHA } }])
    throw new Error('unexpected url: ' + url)
  }
}

function npmThousand() {
  const CATEGORIES = ['market', 'tools', 'ui', 'search', 'other']
  return Array.from({ length: 1000 }, (_, i) => ({
    id: `p-${i}`,
    name: `P${i}`,
    description: `d${i}`,
    category: CATEGORIES[i % 5],
    tags: [],
    source: 'npm',
    npm: `pkg-${i}`,
  }))
}

describe('createGithubRequestBudget：request-scoped 池与宿主滚动窗口', () => {
  beforeEach(() => _resetGithubHourlyWindowForTests())

  it('默认 25 次 reserve ok，第 26 次 exhausted', () => {
    const b = createGithubRequestBudget()
    for (let i = 0; i < 25; i++) assert.equal(b.reserve(), 'ok')
    assert.equal(b.reserve(), 'exhausted')
  })

  it('perRequestMax 可注入；耗尽后该对象持续拒绝', () => {
    const b = createGithubRequestBudget({ perRequestMax: 2 })
    assert.equal(b.reserve(), 'ok')
    assert.equal(b.reserve(), 'ok')
    assert.equal(b.reserve(), 'exhausted')
    assert.equal(b.reserve(), 'exhausted')
  })

  it('滚动窗口 49/50 ok、51 exhausted；不同预算对象共享宿主窗口', () => {
    const b1 = createGithubRequestBudget({ perRequestMax: 100 })
    const b2 = createGithubRequestBudget({ perRequestMax: 100 })
    for (let i = 0; i < 49; i++) assert.equal(b1.reserve(), 'ok')
    assert.equal(b2.reserve(), 'ok', '第 50 次仍在窗口内')
    assert.equal(b1.reserve(), 'exhausted', '第 51 次被宿主窗口拒绝')
  })

  it('1 小时前的命中滑出窗口后配额恢复', () => {
    const b = createGithubRequestBudget({ perRequestMax: 100 })
    for (let i = 0; i < 50; i++) assert.equal(b.reserve(), 'ok')
    assert.equal(b.reserve(), 'exhausted')
    _backdateGithubHourlyWindowForTests(2 * 3_600_000)
    assert.equal(b.reserve(), 'ok', '全部命中已过期 → 恢复')
  })
})

describe('githubLatestTag 预算接线（wire 层 reserve）', () => {
  beforeEach(() => {
    _resetGithubHourlyWindowForTests()
    fetchCalls = []
  })
  afterEach(() => {
    _setWireFetchForTests(null)
  })

  it('release 路径 2 个 wire 请求，budget 恰好 reserve 2 次', async () => {
    installMockFetch(ghHandler())
    const budget = createGithubRequestBudget({ perRequestMax: 5 })
    const tag = await githubLatestTag('o/r', 20_000, undefined, budget)
    assert.equal(tag.tag, 'v1.2.3')
    assert.equal(fetchCalls.length, 2)
    for (let i = 0; i < 3; i++) assert.equal(budget.reserve(), 'ok')
    assert.equal(budget.reserve(), 'exhausted', '5-2=3 后耗尽')
  })

  it('fallback 路径（releases 404 → tags → commits 解引用）逐次计数：3 请求（M2 Task 1 起）', async () => {
    installMockFetch(ghHandler({ releases: '404' }))
    const budget = createGithubRequestBudget({ perRequestMax: 5 })
    const tag = await githubLatestTag('o/r', 20_000, undefined, budget)
    assert.equal(tag.tag, 'v0.1.0')
    assert.equal(fetchCalls.length, 3, 'releases 404 + tags + commits/{ref} 解引用')
  })

  it('重定向跳也计数：releases 302 → 第二跳 reserve', async () => {
    installMockFetch(ghHandler({ releases: 'redirect' }))
    const budget = createGithubRequestBudget({ perRequestMax: 3 })
    const tag = await githubLatestTag('o/r', 20_000, undefined, budget)
    assert.equal(tag.tag, 'v1.2.3')
    assert.equal(fetchCalls.length, 3, '302 跳 + 200 releases + commits')
    assert.equal(budget.reserve(), 'exhausted', '3/3 计满')
  })

  it('预算耗尽 → 该跳不发 fetch、抛可识别 GithubBudgetExhaustedError', async () => {
    installMockFetch(ghHandler())
    const budget = createGithubRequestBudget({ perRequestMax: 1 })
    await assert.rejects(
      () => githubLatestTag('o/r', 20_000, undefined, budget),
      (err) => err instanceof GithubBudgetExhaustedError,
    )
    assert.equal(fetchCalls.length, 1, '第一跳已发、第二跳（commits）被拒未发')
  })

  it('无 budget 参数：滚动窗口耗尽后仍成功（active 池零预算交互）', async () => {
    installMockFetch(ghHandler())
    const filler = createGithubRequestBudget({ perRequestMax: 100 })
    for (let i = 0; i < 50; i++) filler.reserve()
    const tag = await githubLatestTag('o/r')
    assert.equal(tag.tag, 'v1.2.3')
    assert.equal(fetchCalls.length, 2)
  })
})

describe('同仓库 single-flight（预算策略池分池）', () => {
  beforeEach(() => {
    _resetGithubHourlyWindowForTests()
    fetchCalls = []
  })
  afterEach(() => {
    _setWireFetchForTests(null)
  })

  it('同池并发合并：两 waiter 共享一条 flight（releases+commits 各一次）', async () => {
    installMockFetch(ghHandler({ delayMs: 30 }))
    const [a, b] = await Promise.all([githubLatestTag('o/r'), githubLatestTag('o/r')])
    assert.equal(a.tag, 'v1.2.3')
    assert.equal(b.tag, 'v1.2.3')
    assert.equal(fetchCalls.length, 2)
  })

  it('leader abort → waiter 正常完成（共享请求不受 leader signal 影响）', async () => {
    installMockFetch(ghHandler({ delayMs: 30 }))
    const ac = new AbortController()
    const leaderP = githubLatestTag('o/r', 20_000, ac.signal)
    const waiterP = githubLatestTag('o/r')
    await sleep(5)
    ac.abort()
    await assert.rejects(() => leaderP, (err) => err.name === 'AbortError')
    const tag = await waiterP
    assert.equal(tag.tag, 'v1.2.3')
    assert.equal(fetchCalls.length, 2, '共享请求未被中止')
  })

  it('waiter abort → leader 与共享请求继续', async () => {
    installMockFetch(ghHandler({ delayMs: 30 }))
    const ac = new AbortController()
    const waiterP = githubLatestTag('o/r', 20_000, ac.signal)
    const leaderP = githubLatestTag('o/r')
    await sleep(5)
    ac.abort()
    await assert.rejects(() => waiterP, (err) => err.name === 'AbortError')
    const tag = await leaderP
    assert.equal(tag.tag, 'v1.2.3')
    assert.equal(fetchCalls.length, 2)
  })

  it('分池：passive（带预算）与 active 同仓库并发 → 两条独立 flight 互不 join', async () => {
    installMockFetch(ghHandler({ delayMs: 30 }))
    const budget = createGithubRequestBudget({ perRequestMax: 25 })
    await Promise.all([githubLatestTag('o/r', 20_000, undefined, budget), githubLatestTag('o/r')])
    assert.equal(fetchCalls.length, 4, '两条 flight 各自 2 请求')
    for (let i = 0; i < 23; i++) assert.equal(budget.reserve(), 'ok')
    assert.equal(budget.reserve(), 'exhausted', 'passive 池只计自己 flight 的 2 次')
  })

  it('join 零 wire 成本：预算已耗尽的 waiter 免费加入既有 flight 拿到结果', async () => {
    installMockFetch(ghHandler({ delayMs: 40 }))
    const leaderBudget = createGithubRequestBudget({ perRequestMax: 25 })
    const drained = createGithubRequestBudget({ perRequestMax: 0 })
    assert.equal(drained.reserve(), 'exhausted')
    const [a, b] = await Promise.all([
      githubLatestTag('o/r', 20_000, undefined, leaderBudget),
      githubLatestTag('o/r', 20_000, undefined, drained),
    ])
    assert.equal(a.tag, 'v1.2.3')
    assert.equal(b.tag, 'v1.2.3', 'joiner 不产生新请求则不被拒绝')
    assert.equal(fetchCalls.length, 2, '仍是一条 flight')
    for (let i = 0; i < 23; i++) assert.equal(leaderBudget.reserve(), 'ok')
    assert.equal(leaderBudget.reserve(), 'exhausted', 'leader 池计 2/25，joiner 未重复消耗')
  })
})

describe('listInstalledWithMeta 预算集成（request-scoped ≤25）', () => {
  beforeEach(() => {
    _resetGithubHourlyWindowForTests()
    fetchCalls = []
  })
  afterEach(() => {
    _setWireFetchForTests(null)
  })

  it('第 26 个 GitHub wire 请求被拒：超限条目标 latestError，其余条目不受影响', async () => {
    installMockFetch(ghHandler())
    const installed = {
      items: Array.from({ length: 13 }, (_, i) => ({
        pkg: `gh-${i}`,
        name: `G${i}`,
        version: '1.0.0',
        description: '',
        homepage: '',
        spec: `github:o/r${i}#${SHA}`,
        source: 'github',
        dsh: true,
        path: `/x/gh-${i}`,
      })),
      others: 0,
      complete: true,
      profileDir: '/tmp/profile',
    }
    const deps = {
      loadRegistry: async () => ({
        configuredAddress: `reg-${Math.random()}`,
        activeAddress: null,
        source: 'default-raw',
        status: 'ready',
        isDefault: true,
        stale: false,
        fetchedAt: null,
        errors: [],
        count: 13,
        registry: {
          version: 1,
          plugins: Array.from({ length: 13 }, (_, i) => ({
            id: `g-${i}`,
            name: `G${i}`,
            description: `d${i}`,
            category: 'tools',
            tags: [],
            source: 'github',
            github: `o/r${i}`,
          })),
        },
      }),
      listInstalledPlugins: async () => installed,
      // 显式 disabled 社区 loader：避免真实网络请求混入 mock fetch 计数
      fetchCommunityCatalog: async () => ({
        state: { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] },
        catalog: null,
      }),
    }
    const res = await listInstalledWithMeta({ timeoutMs: 20_000, cacheTtlMin: 0 }, {}, deps)
    assert.equal(fetchCalls.length, 25, '13 repo × 2 = 26 → 第 26 个 wire 请求被预算拒绝（收录匹配通道）')
    const errored = res.items.filter((it) => it.latestError !== undefined)
    assert.equal(errored.length, 1)
    assert.ok(errored[0].latestError.length > 0)
    assert.equal(res.items.filter((it) => it.latestTag !== undefined).length, 12, '其余条目检查完成')
  })

  it('用户主动 install 路径不带预算：滚动窗口耗尽后 GitHub 安装解析照常', async () => {
    const filler = createGithubRequestBudget({ perRequestMax: 100 })
    for (let i = 0; i < 50; i++) filler.reserve()
    installMockFetch(ghHandler())
    const dir = mkdtempSync(join(tmpdir(), 'dshm-ghbudget-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { existing: '^1.0.0' } }, null, 2) + '\n')
      writeFileSync(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
      writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
      const runner = {
        add: async () => {
          writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ dependencies: { existing: '^1.0.0', 'owner-repo': `github:owner/repo#${SHA}` } }, null, 2) + '\n',
          )
          const pkgDir = join(dir, 'node_modules', 'owner-repo')
          mkdirSync(pkgDir, { recursive: true })
          writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'owner-repo', version: '1.0.0', main: 'index.js', dsh: {} }))
          writeFileSync(join(pkgDir, 'index.js'), 'x')
          return { class: 'ok', output: 'added', buildApprovals: [], fallbackAllBuilds: false }
        },
        remove: async (pkg) => {
          const doc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
          delete doc.dependencies[pkg]
          writeFileSync(join(dir, 'package.json'), JSON.stringify(doc, null, 2) + '\n')
          rmSync(join(dir, 'node_modules', ...pkg.split('/')), { recursive: true, force: true })
          return { class: 'ok', output: 'removed' }
        },
        frozenInstall: async () => ({ class: 'ok', output: '' }),
        rebuildInstall: async () => ({ class: 'ok', output: '' }),
      }
      const res = await installFromRegistry('p', {}, {}, {
        loadRegistry: async () => ({
          configuredAddress: '', activeAddress: null, source: 'default-raw', status: 'ready',
          isDefault: true, stale: false, fetchedAt: null, errors: [], count: 1,
          registry: { version: 1, plugins: [{ id: 'p', name: 'P', description: 'd', category: 'tools', tags: [], source: 'github', github: 'owner/repo' }] },
        }),
        githubLatestTag,
        candidateKey: async () => 'owner-repo',
        transaction: { runner: () => runner, profileDir: dir },
      })
      assert.equal(res.sha, SHA)
      assert.equal(fetchCalls.length, 2, '主动安装路径完整走完 release 解析，不受 50/h 滚动窗口限制')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------- M2 Task 1：更新语义钉死（semver.gt + apiBase 贯穿 + fallback 解引用） ----------

import { createServer } from 'node:http'
import { isNewerVersion } from '../lib/core/versions.js'

// ---------- 0.9.45 U10b：npmPackumentReadme（未安装条目 README 兜底） ----------

describe('npmPackumentReadme（0.9.45 U10b：未安装条目 README 兜底）', () => {
  afterEach(() => _setWireFetchForTests(null))

  it('提取 packument 顶层 readme；显式 registry 参数优先（L1）', async () => {
    fetchCalls = []
    installMockFetch(async (url) => {
      assert.ok(url.startsWith('https://registry.example.com/pkg-x'), '显式 registry 参数优先')
      return jsonResponse({ versions: {}, readme: '# hello' })
    })
    const res = await npmPackumentReadme('pkg-x', 20_000, undefined, 'https://registry.example.com')
    assert.equal(res.readme, '# hello')
  })

  it('缺省走生效源（https，形态断言不写死线路——ADR-0012 路由自适应）', async () => {
    fetchCalls = []
    installMockFetch(async () => jsonResponse({ readme: '# hi' }))
    const res = await npmPackumentReadme('pkg-default')
    assert.equal(res.readme, '# hi')
    assert.match(fetchCalls[0], /\/pkg-default$/)
    assert.ok(fetchCalls[0].startsWith('https://'), '安全基线 HTTPS')
  })

  it('readme 字段缺失/空白 → 返回空串不抛（客户端显示「没有 README」）', async () => {
    installMockFetch(async () => jsonResponse({ versions: {} }))
    assert.equal((await npmPackumentReadme('pkg-y')).readme, '')
    installMockFetch(async () => jsonResponse({ versions: {}, readme: '   ' }))
    assert.equal((await npmPackumentReadme('pkg-y')).readme, '')
  })

  it('repo：packument repository 归一为 owner/repo（0.9.48，字符串与对象两形态）', async () => {
    installMockFetch(async () => jsonResponse({ readme: 'x', repository: 'git+https://github.com/owner/repo.git' }))
    assert.equal((await npmPackumentReadme('pkg-a')).repo, 'owner/repo')
    installMockFetch(async () => jsonResponse({ readme: 'x', repository: { type: 'git', url: 'git@github.com:a.b/c-d.git' } }))
    assert.equal((await npmPackumentReadme('pkg-a')).repo, 'a.b/c-d')
    installMockFetch(async () => jsonResponse({ readme: 'x', repository: 'https://gitlab.com/g/p' }))
    assert.equal((await npmPackumentReadme('pkg-a')).repo, '', '非 GitHub 归空串')
    installMockFetch(async () => jsonResponse({ readme: 'x', versions: {} }))
    assert.equal((await npmPackumentReadme('pkg-a')).repo, '', '缺 repository 归空串')
  })

  it('非法包名抛错（与 npmLatest 同款字符集守卫）', async () => {
    await assert.rejects(() => npmPackumentReadme('has space'), /无效 npm 包名/)
    await assert.rejects(() => npmPackumentReadme('pkg$'), /无效 npm 包名/)
  })

  it('scoped 包名编码进 URL', async () => {
    fetchCalls = []
    installMockFetch(async () => jsonResponse({ readme: 'x' }))
    await npmPackumentReadme('@iasiv5/dsh-skins')
    // fetchCalls 里可能混入 npm-route probe-once 请求——存在编码命中即可（@ → %40）
    assert.ok(fetchCalls.some((u) => u.includes('%40iasiv5%2Fdsh-skins')), 'scoped 包名编码进 URL')
  })
})

function localGithubServer(handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const hits = req.socket.localPort
      handler(req, res)
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

describe('M2 Task 1：isNewerVersion（semver.gt 标准语义）', () => {
  const table = [
    ['1.2.3-beta.1', '1.2.3', false, 'prerelease < 正式版（旧实现数字尾段误判回归）'],
    ['1.2.3', '1.2.3-beta.1', true, '正式版 > prerelease'],
    ['1.2.3+build.1', '1.2.3', false, 'build metadata 不参与比较'],
    ['0.10.0', '0.9.0', true, '数字段比较 10 > 9'],
    ['1.2.2', '1.2.3', false, '降级'],
    ['1.2.3', '1.2.3', false, '相等'],
    ['2.0.0', '1.9.9', true, '跨段'],
  ]
  for (const [candidate, current, expected, note] of table) {
    it(`${candidate} vs ${current} → ${expected}（${note}）`, () => {
      assert.equal(isNewerVersion(candidate, current), expected)
    })
  }
  it('非法输入不抛且返回 false', () => {
    for (const bad of ['', 'abc', '1.2', 'v1.2.3', null, undefined, 42, {}]) {
      assert.equal(isNewerVersion(bad, '1.0.0'), false, `candidate=${String(bad)}`)
      assert.equal(isNewerVersion('1.0.0', bad), false, `current=${String(bad)}`)
    }
  })
})

describe('M2 Task 1：github apiBase 贯穿与 fallback 解引用', () => {
  const SHA = 'b'.repeat(40)
  let server
  let apiBase
  let hits

  beforeEach(async () => {
    hits = []
    server = await new Promise((resolve) => {
      const s = createServer((req, res) => {
        hits.push(req.url)
        const url = req.url || ''
        const json = (body, status = 200) => {
          res.writeHead(status, { 'content-type': 'application/json' })
          res.end(JSON.stringify(body))
        }
        if (url.includes('/releases/latest')) return json({ tag_name: 'v2.0.0' })
        if (url.includes('/tags')) return json([{ name: 'v1.0.0', commit: { sha: 'c'.repeat(40) } }])
        if (url.includes('/commits/')) return json({ sha: SHA })
        json({ message: 'not found' }, 404)
      })
      s.listen(0, '127.0.0.1', () => resolve(s))
    })
    apiBase = `http://127.0.0.1:${server.address().port}`
  })
  afterEach(async () => {
    await new Promise((r) => server.close(r))
  })

  it('release 路径：releases + commits 全部命中本地 server', async () => {
    const tag = await githubLatestTag('o/r', 20_000, undefined, undefined, apiBase)
    assert.equal(tag.tag, 'v2.0.0')
    assert.equal(tag.sha, SHA)
    assert.equal(hits.length, 2)
    assert.ok(hits[0].includes('/releases/latest'))
    assert.ok(hits[1].includes('/commits/'))
  })

  it('fallback 路径：tags 首项经 commits/{ref} 解引用（tag object sha 不直接采用）', async () => {
    // releases 404 → tags → commits 解引用
    const s2 = await new Promise((resolve) => {
      const h = []
      const s = createServer((req, res) => {
        h.push(req.url)
        const url = req.url || ''
        const json = (body, status = 200) => {
          res.writeHead(status, { 'content-type': 'application/json' })
          res.end(JSON.stringify(body))
        }
        if (url.includes('/releases/latest')) return json({}, 404)
        if (url.includes('/tags')) return json([{ name: 'v1.0.0', commit: { sha: 'c'.repeat(40) } }])
        if (url.includes('/commits/')) return json({ sha: SHA })
        json({}, 404)
      })
      s.listen(0, '127.0.0.1', () => resolve(s))
      s.__hits = h
    })
    const base2 = `http://127.0.0.1:${s2.address().port}`
    try {
      const tag = await githubLatestTag('o/r', 20_000, undefined, undefined, base2)
      assert.equal(tag.tag, 'v1.0.0')
      assert.equal(tag.sha, SHA, 'fallback 也取 commits 解引用的 commit sha（annotated tag 修正）')
      assert.equal(s2.__hits.length, 3)
      assert.ok(s2.__hits[2].includes('/commits/v1.0.0'))
    } finally {
      await new Promise((r) => s2.close(r))
    }
  })

  it('githubTagSha 直调命中本地 server 的 commits 端点', async () => {
    const sha = await githubTagSha('o/r', 'v9.9.9', 20_000, undefined, undefined, apiBase)
    assert.equal(sha, SHA)
    assert.ok(hits.some((u) => u.includes('/commits/v9.9.9')))
  })
})

// ---------- 读分类路由（ADR-0012 T5）：检测读权威链 / 履约读阶梯 / npmPackument 参数修复 ----------

describe('npmLatest 检测读权威链（L3）', () => {
  it('npmjs 首腿失败 → 生效源成功；首腿超时收紧 ≤5s', async () => {
    process.env.DSHM_NPM_REGISTRY = 'https://registry.npmmirror.com'
    try {
      const calls = []
      const fetcher = async (url, opts) => {
        calls.push({ url: String(url), ms: opts?.timeoutMs })
        if (String(url).startsWith('https://registry.npmjs.org/')) throw new Error('npmjs down')
        return { version: '2.0.0' }
      }
      const latest = await npmLatest('pkg-a', 20_000, undefined, undefined, { fetchJsonLimited: fetcher })
      assert.equal(latest.version, '2.0.0')
      assert.equal(calls.length, 2)
      assert.ok(calls[0].url.startsWith('https://registry.npmjs.org/'))
      assert.ok(calls[0].ms <= 5000, `权威首腿收紧 5s，实际 ${calls[0].ms}`)
      assert.ok(calls[1].url.startsWith('https://registry.npmmirror.com/'))
    } finally {
      delete process.env.DSHM_NPM_REGISTRY
    }
  })

  it('显式 registry 参数优先且不降级（旧契约不变）', async () => {
    const calls = []
    const fetcher = async (url) => {
      calls.push(String(url))
      return { version: '3.0.0' }
    }
    const latest = await npmLatest('pkg-a', 5000, undefined, 'https://registry.npmmirror.com', { fetchJsonLimited: fetcher })
    assert.equal(latest.version, '3.0.0')
    assert.equal(calls.length, 1)
    assert.ok(calls[0].startsWith('https://registry.npmmirror.com/'))
  })
})

describe('npmVersion 履约阶梯（L2①）', () => {
  it('生效镜像 404 → sync → 等待 10s → 同源重试成功（不到 npmjs）', async () => {
    process.env.DSHM_NPM_REGISTRY = 'https://registry.npmmirror.com'
    try {
      let mirrorCalls = 0
      const syncs = []
      const waits = []
      const fetcher = async (url) => {
        const u = String(url)
        if (u.startsWith('https://registry.npmmirror.com/')) {
          mirrorCalls++
          if (mirrorCalls === 1) throw new Error('HTTP 404')
          return { version: '1.2.8', dist: { integrity: 'sha512-x' } }
        }
        throw new Error(`不应到 npmjs: ${u}`)
      }
      const meta = await npmVersion('pkg-a', '1.2.8', 20_000, undefined, undefined, {
        fetchJsonLimited: fetcher,
        syncNpmmirror: async (pkg) => {
          syncs.push(pkg)
          return true
        },
        wait: async (ms) => {
          waits.push(ms)
        },
      })
      assert.equal(meta.version, '1.2.8')
      assert.deepEqual(syncs, ['pkg-a'])
      assert.deepEqual(waits, [10_000])
      assert.equal(mirrorCalls, 2)
    } finally {
      delete process.env.DSHM_NPM_REGISTRY
    }
  })

  it('阶梯全败 → npmjs 兜底 → 仍败抛首因错误', async () => {
    process.env.DSHM_NPM_REGISTRY = 'https://registry.npmmirror.com'
    try {
      const urls = []
      const fetcher = async (url) => {
        urls.push(String(url))
        throw new Error('HTTP 404')
      }
      await assert.rejects(
        npmVersion('pkg-a', '1.2.8', 20_000, undefined, undefined, {
          fetchJsonLimited: fetcher,
          syncNpmmirror: async () => true,
          wait: async () => {},
        }),
        /HTTP 404/,
      )
      assert.equal(urls.length, 3, '镜像×2（重试）+ npmjs 兜底×1')
      assert.ok(urls[2].startsWith('https://registry.npmjs.org/'))
    } finally {
      delete process.env.DSHM_NPM_REGISTRY
    }
  })

  it('主源即 npmjs：失败不 sync、直接抛（权威源无镜像滞后可言）', async () => {
    process.env.DSHM_NPM_REGISTRY = 'https://registry.npmjs.org'
    try {
      const syncs = []
      const fetcher = async () => {
        throw new Error('HTTP 500')
      }
      await assert.rejects(
        npmVersion('pkg-a', '1.2.8', 20_000, undefined, undefined, {
          fetchJsonLimited: fetcher,
          syncNpmmirror: async (pkg) => {
            syncs.push(pkg)
            return true
          },
          wait: async () => {},
        }),
        /HTTP 500/,
      )
      assert.equal(syncs.length, 0)
    } finally {
      delete process.env.DSHM_NPM_REGISTRY
    }
  })
})

describe('npmPackument 履约读（L1，R1-6 参数修复）', () => {
  it('显式 registry 参数生效（此前被忽略）', async () => {
    const calls = []
    const fetcher = async (url) => {
      calls.push(String(url))
      return { versions: { '1.0.0': {} } }
    }
    const doc = await npmPackument('pkg-a', 5000, undefined, 'https://registry.npmmirror.com', { fetchJsonLimited: fetcher })
    assert.deepEqual(doc.versions, ['1.0.0'])
    assert.equal(calls.length, 1)
    assert.ok(calls[0].startsWith('https://registry.npmmirror.com/'))
  })

  it('无显式参数 → 生效源（env 直采，不探测）', async () => {
    process.env.DSHM_NPM_REGISTRY = 'https://registry.npmmirror.com'
    try {
      const calls = []
      const fetcher = async (url) => {
        calls.push(String(url))
        return { versions: { '2.0.0': {} } }
      }
      await npmPackument('pkg-a', 5000, undefined, undefined, { fetchJsonLimited: fetcher })
      assert.equal(calls.length, 1)
      assert.ok(calls[0].startsWith('https://registry.npmmirror.com/'))
    } finally {
      delete process.env.DSHM_NPM_REGISTRY
    }
  })
})

// ---------- 履约阶梯 kill switch 与 via 消费层钉子（评审 R1-2/R1-4，ADR-0012） ----------

describe('npmVersion 履约阶梯 kill switch 与 via（评审 R1-2/R1-4）', () => {
  it('sync 返回 false（kill switch 语义）→ 跳过等待与同源重试，直落 npmjs 兜底', async () => {
    process.env.DSHM_NPM_REGISTRY = 'https://registry.npmmirror.com'
    try {
      const urls = []
      const syncs = []
      const waits = []
      const fetcher = async (url) => {
        urls.push(String(url))
        throw new Error('HTTP 404')
      }
      await assert.rejects(
        npmVersion('pkg-a', '1.2.8', 20_000, undefined, undefined, {
          fetchJsonLimited: fetcher,
          syncNpmmirror: async (pkg) => {
            syncs.push(pkg)
            return false
          },
          wait: async (ms) => {
            waits.push(ms)
          },
        }),
        /HTTP 404/,
      )
      assert.deepEqual(syncs, ['pkg-a'])
      assert.deepEqual(waits, [], 'kill switch 下不付 10s 等待')
      assert.equal(urls.length, 2, '镜像×1 + npmjs 兜底×1（无同源重试）')
      assert.ok(urls[1].startsWith('https://registry.npmjs.org/'))
    } finally {
      delete process.env.DSHM_NPM_REGISTRY
    }
  })

  it('npmVersion 全败抛错带 via（wire 真通路，Task 5 验证清单钉子）', async () => {
    process.env.DSHM_NPM_REGISTRY = 'https://registry.npmjs.org'
    const { _setWireFetchForTests } = await import('../lib/core/httpx.js')
    _setWireFetchForTests(async () => {
      throw new TypeError('fetch failed')
    })
    try {
      await assert.rejects(
        npmVersion('pkg-a', '1.2.8', 5000),
        (err) => /fetch failed/.test(err.message) && err.via === 'direct',
      )
    } finally {
      _setWireFetchForTests(null)
      delete process.env.DSHM_NPM_REGISTRY
    }
  })
})
