/**
 * ADR-0028：升级目标解析（upgrade-target）表驱动套件。
 * 覆盖：判定原子 unsupportedReasonFor 四分支（detail 文案逐字冻结，B5）、
 * 投影 upgradePathFor 五分支（自 market.test.mjs 同口径）、合成条目 synthesizeInstallableEntry
 * 五分支（自 tests/market-mutation.test.mjs ADR-0026 describe 整体迁移，断言原文照搬）。
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { upgradePathFor, synthesizeInstallableEntry, UpgradePathUnsupportedError, unsupportedReasonFor, resolveUpgradeTarget, UPGRADE_COMMUNITY_DEADLINE_MS } from '../lib/core/upgrade-target.js'
import { _resetMergedMarketForTests } from '../lib/core/merged-market.js'

describe('unsupportedReasonFor（ADR-0028 判定原子）', () => {
  it('① local spec → local-spec + detail 文案逐字', () => {
    assert.deepEqual(unsupportedReasonFor({ pkg: 'a', spec: 'file:../a', source: 'npm' }), {
      code: 'local-spec',
      detail: '本地开发安装（file:../a）不从线上更新；如需线上版本请先卸载后经 dsh-m 安装',
    })
  })

  it('② npm 源可解析 → null', () => {
    assert.equal(unsupportedReasonFor({ pkg: 'b', spec: '^1.0.0', source: 'npm' }), null)
  })

  it('③ github spec 不解析 → github-spec-unparseable + detail 文案逐字（空 spec 归「空」）', () => {
    assert.deepEqual(unsupportedReasonFor({ pkg: 'c', spec: 'not-a-github-spec', source: 'github' }), {
      code: 'github-spec-unparseable',
      detail: 'github 安装的 spec（not-a-github-spec）解析不出 owner/repo，拒绝臆测来源',
    })
    assert.deepEqual(unsupportedReasonFor({ pkg: 'c2', source: 'github' }), {
      code: 'github-spec-unparseable',
      detail: 'github 安装的 spec（空）解析不出 owner/repo，拒绝臆测来源',
    })
  })

  it('④ 非 npm/github 源（unknown/link/file）→ source-unresolvable + detail 文案逐字', () => {
    for (const source of ['unknown', 'link', 'file']) {
      assert.deepEqual(unsupportedReasonFor({ pkg: 'd', spec: 'whatever', source }), {
        code: 'source-unresolvable',
        detail: `来源 ${source} 不可线上解析，不做自动升级`,
      })
    }
  })
})

describe('upgradePathFor（ADR-0028 投影，判据经 unsupportedReasonFor 单源）', () => {
  it('五分支（registryId / 本地 spec / source 兜底 / github 可解析性）', () => {
    assert.equal(upgradePathFor({ registryId: 'p-1', pkg: 'a', spec: '^1.0.0', source: 'npm' }), 'catalog')
    assert.equal(upgradePathFor({ pkg: 'b', spec: 'file:../b', source: 'npm' }), 'unsupported')
    assert.equal(upgradePathFor({ pkg: 'c', spec: 'whatever', source: 'unknown' }), 'unsupported')
    assert.equal(upgradePathFor({ pkg: 'd', spec: 'github:o/r#abc', source: 'github' }), 'synthesized')
    assert.equal(upgradePathFor({ pkg: 'e', spec: 'not-a-github-spec', source: 'github' }), 'unsupported', 'github 畸形 spec：投影与合成判据对齐')
  })
})

// ---------- ADR-0028：async 壳 resolveUpgradeTarget（双梯 I/O 编排收编） ----------

// 自带夹具（CODING-STANDARDS：不引用兄弟 describe/文件闭包；形态对齐 merged-market/market-mutation 既有测试）
const readyLoaded = (plugins) => ({
  configuredAddress: '',
  activeAddress: 'https://example.com/r.json',
  source: 'default-raw',
  status: 'ready',
  isDefault: true,
  stale: false,
  fetchedAt: '2026-10-10T00:00:00.000Z',
  errors: [],
  count: plugins.length,
  registry: { version: 1, plugins },
})
const unavailableLoaded = () => ({ ...readyLoaded([]), status: 'unavailable', activeAddress: null, source: 'unavailable' })
const communityDisabled = () => ({ state: { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, count: 0, errors: [], warnings: [] }, catalog: null })
const communityReady = (plugins) => ({
  state: { enabled: true, status: 'ready', version: '2026.10.10.1', checkedAt: '2026-10-10T00:00:00.000Z', fetchedAt: '2026-10-10T00:00:00.000Z', route: 'jsdelivr', count: plugins.length, errors: [], warnings: [] },
  catalog: { name: 'awesome-dsh-plugin', url: 'https://awesome.example', source: 'https://github.com/x/y', updated: '2026-10-10', count: plugins.length, categories: {}, plugins },
})
const communityRawNpm = (name, owner) => ({
  name,
  owner,
  url: `https://github.com/${owner}/${name}`,
  category: 'c-ui',
  description: { en: `${name} en`, zh: `${name} 中文` },
  npm: name,
  downloads: 100,
})
const mkTarget = (over = {}) => ({ pkg: 'p', name: 'P', version: '1.0.0', description: '', homepage: '', spec: '^1.0.0', source: 'npm', dsh: true, path: '/x', ...over })
const communityMustNotBeCalled = async () => {
  throw new Error('社区依赖不应被调用')
}

describe('resolveUpgradeTarget（ADR-0028 async 壳）', () => {
  beforeEach(() => _resetMergedMarketForTests())

  it('常量：UPGRADE_COMMUNITY_DEADLINE_MS = 60_000（两 backend 现值同 60s 的归一锚）', () => {
    assert.equal(UPGRADE_COMMUNITY_DEADLINE_MS, 60_000)
  })

  it('① primary 命中 → resolved/primary，社区依赖零调用', async () => {
    const entry = { id: 'p-1', name: 'Foo', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'foo' }
    const r = await resolveUpgradeTarget(mkTarget({ pkg: 'foo', name: 'foo' }), {}, {}, { loaded: readyLoaded([entry]), fetchCommunityCatalog: communityMustNotBeCalled })
    assert.equal(r.kind, 'resolved')
    assert.equal(r.matchPath, 'primary')
    assert.deepEqual(r.entry, entry)
  })

  it('② primary miss + 社区命中 → resolved/community（社区条目经物化合并市场全量域）', async () => {
    const r = await resolveUpgradeTarget(mkTarget({ pkg: 'foo', name: 'foo' }), {}, {}, {
      loaded: readyLoaded([]),
      fetchCommunityCatalog: async () => communityReady([communityRawNpm('foo', 'own')]),
    })
    assert.equal(r.kind, 'resolved')
    assert.equal(r.matchPath, 'community')
    assert.equal(r.entry.npm, 'foo')
    assert.equal(r.entry.id, 'own--foo', '社区合成 id 形态（owner--name）')
  })

  it('③ 双 miss + npm 已装 → resolved/synthesized，entry 等于现行合成形态', async () => {
    const r = await resolveUpgradeTarget(mkTarget({ pkg: 'foo', name: 'foo' }), {}, {}, { loaded: readyLoaded([]), fetchCommunityCatalog: communityDisabled })
    assert.equal(r.kind, 'resolved')
    assert.equal(r.matchPath, 'synthesized')
    assert.deepEqual(r.entry, { id: 'installed:foo', source: 'npm', npm: 'foo' })
  })

  it('④ local spec → unsupported（code/detail/message 逐字）', async () => {
    const r = await resolveUpgradeTarget(mkTarget({ pkg: 'baz', spec: 'file:../baz' }), {}, {}, { loaded: readyLoaded([]), fetchCommunityCatalog: communityDisabled })
    assert.deepEqual(r, {
      kind: 'unsupported',
      reason: {
        code: 'local-spec',
        detail: '本地开发安装（file:../baz）不从线上更新；如需线上版本请先卸载后经 dsh-m 安装',
        message: '「baz」无法自动升级：本地开发安装（file:../baz）不从线上更新；如需线上版本请先卸载后经 dsh-m 安装',
      },
    })
  })

  it('⑤ github spec 不解析 → unsupported（message 逐字）', async () => {
    const r = await resolveUpgradeTarget(mkTarget({ pkg: 'qux', source: 'github', spec: 'not-a-github-spec' }), {}, {}, { loaded: readyLoaded([]), fetchCommunityCatalog: communityDisabled })
    assert.equal(r.kind, 'unsupported')
    assert.equal(r.reason.code, 'github-spec-unparseable')
    assert.equal(r.reason.message, '「qux」无法自动升级：github 安装的 spec（not-a-github-spec）解析不出 owner/repo，拒绝臆测来源')
  })

  it('⑥ loaded unavailable → 跳过条目查找直接合成，社区依赖零调用', async () => {
    const r = await resolveUpgradeTarget(mkTarget({ pkg: 'foo', name: 'foo' }), {}, {}, { loaded: unavailableLoaded(), fetchCommunityCatalog: communityMustNotBeCalled })
    assert.equal(r.kind, 'resolved')
    assert.equal(r.matchPath, 'synthesized')
    assert.deepEqual(r.entry, { id: 'installed:foo', source: 'npm', npm: 'foo' })
  })

  it('⑦ 社区 fetch reject → 吞为 miss → synthesized（窄 catch 语义）', async () => {
    const r = await resolveUpgradeTarget(mkTarget({ pkg: 'foo', name: 'foo' }), {}, {}, {
      loaded: readyLoaded([]),
      fetchCommunityCatalog: async () => {
        throw new Error('cdn down')
      },
    })
    assert.equal(r.kind, 'resolved')
    assert.equal(r.matchPath, 'synthesized')
  })

  it('⑧ 未注入 loaded → 壳内经 deps.loadRegistry 自取', async () => {
    const entry = { id: 'p-1', name: 'Foo', description: 'd', category: 'tools', tags: [], source: 'npm', npm: 'foo' }
    const r = await resolveUpgradeTarget(mkTarget({ pkg: 'foo', name: 'foo' }), {}, {}, {
      loadRegistry: async () => readyLoaded([entry]),
      fetchCommunityCatalog: communityMustNotBeCalled,
    })
    assert.equal(r.kind, 'resolved')
    assert.equal(r.matchPath, 'primary')
    assert.deepEqual(r.entry, entry)
  })
})

// ---------- ADR-0026 合成条目（issue #30）：synthesizeInstallableEntry 五分支 ----------
// 自带夹具（CODING-STANDARDS：新 describe 不引用兄弟 describe 闭包）。
// ADR-0028：自 tests/market-mutation.test.mjs 整体迁移，断言原文照搬。
describe('synthesizeInstallableEntry（ADR-0026 合成条目）', () => {
  const mk = (over = {}) => ({ pkg: 'p', name: 'P', version: '1.0.0', description: '', homepage: '', spec: '^1.0.0', source: 'npm', dsh: true, path: '/x', ...over })

  it('① npm 源 → 合成 npm 条目（id=installed:<pkg>，npm 名取已装包名）', () => {
    const e = synthesizeInstallableEntry(mk({ pkg: 'foo', spec: '^1.0.0' }))
    assert.deepEqual(e, { id: 'installed:foo', source: 'npm', npm: 'foo' })
  })

  it('② github 源 → 解析 spec 锁定仓库合成 github 条目（#sha 尾不进 github 字段）', () => {
    const e = synthesizeInstallableEntry(mk({ pkg: 'bar', source: 'github', spec: 'github:owner/repo#abc1234' }))
    assert.deepEqual(e, { id: 'installed:bar', source: 'github', github: 'owner/repo' })
  })

  it('③ npm 源但 file: spec → 抛 UpgradePathUnsupportedError（本地开发安装不从线上更新）', () => {
    assert.throws(
      () => synthesizeInstallableEntry(mk({ pkg: 'baz', spec: 'file:../baz' })),
      (err) => err instanceof UpgradePathUnsupportedError && err.upgradePath === 'unsupported' && /本地/.test(err.message),
    )
  })

  it('④ npm 源但 link: spec → 同③抛不支持（大小写不敏感前缀）', () => {
    assert.throws(
      () => synthesizeInstallableEntry(mk({ pkg: 'baz', spec: 'LINK:../baz' })),
      (err) => err instanceof UpgradePathUnsupportedError && err.upgradePath === 'unsupported',
    )
  })

  it('⑤ github 源但 spec 不匹配 GITHUB_SPEC_RE → 抛不支持（禁止产出双分支都落空的条目）', () => {
    assert.throws(
      () => synthesizeInstallableEntry(mk({ pkg: 'qux', source: 'github', spec: 'not-a-github-spec' })),
      (err) => err instanceof UpgradePathUnsupportedError && err.upgradePath === 'unsupported' && /owner\/repo/.test(err.message),
    )
  })

  it('⑥ 非 npm/github 源（unknown/link/file）→ 抛不支持（PluginSource 五值兜底臂）', () => {
    for (const source of ['unknown', 'link', 'file']) {
      assert.throws(
        () => synthesizeInstallableEntry(mk({ pkg: 'corge', source, spec: 'whatever' })),
        (err) => err instanceof UpgradePathUnsupportedError && err.upgradePath === 'unsupported' && /不可线上解析/.test(err.message),
        `source=${source} 应走兜底臂`,
      )
    }
  })
})
