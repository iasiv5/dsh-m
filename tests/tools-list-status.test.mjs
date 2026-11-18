/**
 * ADR-0039（合并 agent 工具）：dshm_list 承担已装清单与更新状态；dshm_outdated 不再注册。
 * 夹具镜像生产调用点：只注入 listInstalledWithMeta 与 registryState，不注入内层缺省对象。
 * 数据契约见 docs/specs/2026-11-18-merge-dshm-status-tool-design.md §3。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const cfg = { registryUrl: '', cacheTtlMin: 60 }
const profile = { name: 'web', kind: 'web', dir: '/tmp/dshm-status-profile', source: 'fallback' }
const readyState = { configuredAddress: '', activeAddress: null, source: 'bundled', status: 'ready', isDefault: true, stale: false, fetchedAt: null, errors: [], count: 3 }
const unavailableState = { configuredAddress: '', activeAddress: null, source: 'default-cache', status: 'unavailable', isDefault: true, stale: false, fetchedAt: null, errors: ['registry 加载超出 deadline'], count: 0 }
const community = { enabled: false, status: 'disabled', version: null, checkedAt: null, fetchedAt: null, route: null, acceptedCount: 0, errors: [], warnings: [] }

function item(pkg, extra = {}) {
  return { pkg, name: pkg, version: '1.0.0', description: '', homepage: '', spec: '1.0.0', source: 'npm', dsh: true, path: `/tmp/${pkg}`, outdated: false, upgradePath: 'catalog', ...extra }
}

function localItem(pkg, extra = {}) {
  return item(pkg, { source: 'link', spec: `link:../${pkg}`, upgradePath: 'unsupported', upgradePathReason: 'local-spec', ...extra })
}

async function loadTools({ items, registryState = readyState }) {
  const { registerTools } = await import('../lib/tools.js')
  const registered = []
  const capturedOpts = []
  const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {} }
  registerTools(ctx, cfg, {
    listInstalledWithMeta: async (_c, opts) => {
      capturedOpts.push(opts)
      return { items, others: 0, profileDir: profile.dir, registryState, community }
    },
  }, profile)
  return { registered, tool: (name) => registered.find((t) => t.name === name), capturedOpts }
}

async function listOf({ items, registryState }) {
  const { tool } = await loadTools({ items, registryState })
  const list = tool('dshm_list')
  const out = await list.execute({})
  const text = list.output.render({}, out)[0].text
  const title = list.presentResult({}, { isError: false, meta: out }).title
  return { list, out, text, title }
}

describe('ADR-0039：agent 工具清单与描述', () => {
  it('7 个工具：不含 dshm_outdated，保留 dshm_list 与 dshm_toggle', async () => {
    const { registered } = await loadTools({ items: [] })
    assert.deepEqual(
      registered.map((t) => t.name).sort(),
      ['dshm_install', 'dshm_list', 'dshm_restart', 'dshm_search', 'dshm_toggle', 'dshm_uninstall', 'dshm_upgrade'],
    )
  })

  it('dshm_upgrade 只引用 dshm_list（描述与 pkg 参数）', async () => {
    const { tool } = await loadTools({ items: [] })
    const up = tool('dshm_upgrade')
    assert.ok(!up.description.includes('dshm_outdated'), up.description)
    assert.ok(up.description.includes('dshm_list'), up.description)
    assert.ok(!up.parameters.properties.pkg.description.includes('dshm_outdated'))
  })

  it('dshm_list 描述覆盖「已最新」与「未检查」的区分', async () => {
    const { tool } = await loadTools({ items: [] })
    const list = tool('dshm_list')
    assert.ok(list.description.includes('未检查'), list.description)
    assert.ok(list.description.includes('已最新'), list.description)
  })

  it('dshm_list 保留 registry summary 投影', async () => {
    const { out } = await listOf({ items: [item('a', { latestVersion: '1.0.0' })] })
    assert.equal(out.registry.status, 'ready')
    assert.equal(typeof out.registry.stale, 'boolean')
  })
})

describe('ADR-0039：市场归属三态', () => {
  it('注册表可用：registryId 命中为 market，未命中为 non-market', async () => {
    const { out, text } = await listOf({ items: [item('p-a', { registryId: 'p-a' }), item('p-b')] })
    assert.equal(out.items[0].market, 'market')
    assert.equal(out.items[1].market, 'non-market')
    assert.ok(text.includes('市场 1 · 非市场 1 · 未知 0'), text)
  })

  it('注册表不可用：全部为 unknown，清单行不标「非市场」，首行声明收录清单不可用', async () => {
    const { out, text } = await listOf({ items: [item('p-npm'), localItem('p-link')], registryState: unavailableState })
    assert.deepEqual(out.items.map((it) => it.market), ['unknown', 'unknown'])
    const rows = text.split('\n').filter((l) => /^\d+\. /.test(l))
    assert.equal(rows.length, 2, text)
    assert.ok(rows.every((l) => !l.includes('非市场')), rows.join('\n'))
    assert.ok(text.includes('收录清单不可用'), text)
  })
})

describe('ADR-0039：更新状态', () => {
  it('四态与未检查原因：可升级 / 已最新 / 未检查（本地安装、未探测）/ 检查未完成', async () => {
    const { out } = await listOf({
      items: [
        item('up', { outdated: true, latestVersion: '2.0.0' }),
        item('lt', { latestVersion: '1.0.0' }),
        item('inc', { latestErrorCode: 'timeout', latestError: '更新检查未完成：时间预算已用尽' }),
        localItem('loc'),
        item('gh', { source: 'github', spec: 'github:o/r#aaa', upgradePath: 'synthesized' }),
      ],
    })
    const by = Object.fromEntries(out.items.map((it) => [it.pkg, it]))
    assert.equal(by.up.update, 'upgradable')
    assert.equal(by.lt.update, 'latest')
    assert.equal(by.inc.update, 'incomplete')
    assert.equal(by.loc.update, 'unchecked')
    assert.equal(by.loc.uncheckedReason, 'local-install')
    assert.equal(by.gh.update, 'unchecked')
    assert.equal(by.gh.uncheckedReason, 'not-probed')
  })

  it('注册表不可用：全部为 unchecked，原因 registry-unavailable', async () => {
    const { out } = await listOf({ items: [item('a', { latestVersion: '1.0.0' })], registryState: unavailableState })
    assert.equal(out.items[0].update, 'unchecked')
    assert.equal(out.items[0].uncheckedReason, 'registry-unavailable')
  })

  it('GitHub 可升级项：目标写 latestTag', async () => {
    const { out, text } = await listOf({
      items: [item('gh2', { source: 'github', spec: 'github:o/r#aaa', outdated: true, latestTag: 'v3.0.0', latestSha: 'bbb' })],
    })
    assert.equal(out.items[0].update, 'upgradable')
    assert.equal(out.items[0].latestTag, 'v3.0.0')
    assert.ok(text.includes('→ v3.0.0'), text)
  })

  it('意图停用的可升级项仍列出，并标注「意图停用」', async () => {
    const { out, text } = await listOf({ items: [item('off', { outdated: true, latestVersion: '2.0.0', userDisabled: true })] })
    assert.equal(out.items[0].userDisabled, true)
    assert.equal(out.items[0].update, 'upgradable')
    assert.ok(text.includes('可升级（1）'), text)
    assert.ok(text.includes('意图停用'), text)
  })

  it('unsupported 成因：可升级的不可自动升级项附「——不参与自动升级」，成因按码区分', async () => {
    const { text } = await listOf({
      items: [
        item('p-local', { spec: 'file:../p-local', outdated: true, latestVersion: '9.9.9', upgradePath: 'unsupported', upgradePathReason: 'local-spec' }),
        item('p-gh', { source: 'github', spec: 'not-a-github-spec', outdated: true, latestVersion: '9.9.9', upgradePath: 'unsupported', upgradePathReason: 'github-spec-unparseable' }),
      ],
    })
    const upLines = text.split('\n').filter((l) => l.startsWith('· '))
    const lineOf = (pkg) => upLines.find((l) => l.includes(`(${pkg})`)) ?? ''
    assert.ok(lineOf('p-local').includes('本地链接安装——不参与自动升级'), text)
    assert.ok(lineOf('p-gh').includes('github spec 无法解析——不参与自动升级'), text)
    assert.ok(!lineOf('p-gh').includes('本地链接安装'), text)
  })
})

describe('ADR-0039：文字契约（不说谎、不双层、比例化指引）', () => {
  it('全部已检查且全部最新：才允许出现「全部…已是最新」', async () => {
    const { text } = await listOf({ items: [item('a', { latestVersion: '1.0.0' }), item('b', { latestVersion: '1.0.0' })] })
    assert.ok(text.includes('全部 2 个插件已检查，均已是最新版本。'), text)
    assert.ok(!text.includes('未检查（'), text)
    assert.ok(!text.includes('可升级（'), text)
  })

  it('有未检查项时，任何位置都不出现「全部…最新」', async () => {
    const { text } = await listOf({ items: [item('a', { latestVersion: '1.0.0' }), localItem('loc')] })
    assert.ok(!text.includes('全部'), text)
    assert.ok(text.includes('未检查（1）'), text)
  })

  it('注册表不可用：文字不出现「全部」「均已是最新版本」，且不重复整份清单', async () => {
    const { text } = await listOf({ items: [item('p-npm'), localItem('p-link')], registryState: unavailableState })
    assert.ok(!text.includes('全部'), text)
    assert.ok(!text.includes('均已是最新版本'), text)
    assert.ok(!text.includes('未检查（'), text)
  })

  it('检查未完成：输出原因短文案，不输出原始 latestError 文本', async () => {
    const { text } = await listOf({
      items: [item('bud', { latestErrorCode: 'budget-exhausted', latestError: 'GitHub 更新检查预算已用尽' })],
    })
    assert.ok(text.includes('检查未完成（1）'), text)
    assert.ok(text.includes('因 GitHub 预算未完成'), text)
    assert.ok(!text.includes('GitHub 更新检查预算已用尽'), text)
  })

  it('指引语：不再要求「最多回一句短话」，改为比例化概括', async () => {
    const { text } = await listOf({ items: [item('a', { latestVersion: '1.0.0' })] })
    assert.ok(!text.includes('最多回一句短话'), text)
    assert.ok(text.includes('3 行以内'), text)
  })
})

describe('ADR-0039：标题投影', () => {
  it('标题：已装 · N 个，按非零计数追加可升级 / 未检查 / 未完成', async () => {
    const { title } = await listOf({
      items: [
        item('up', { outdated: true, latestVersion: '2.0.0' }),
        localItem('loc'),
        item('inc', { latestErrorCode: 'timeout', latestError: 'x' }),
        item('lt', { latestVersion: '1.0.0' }),
      ],
    })
    assert.equal(title, '已装 · 4 个 · 可升级 1 · 未检查 1 · 未完成 1')
  })

  it('全部已最新：标题只写已装数量，不写「全部最新」', async () => {
    const { title } = await listOf({ items: [item('a', { latestVersion: '1.0.0' }), item('b', { latestVersion: '1.0.0' })] })
    assert.equal(title, '已装 · 2 个')
  })

  it('注册表不可用：标题追加未检查计数，不写「全部最新」', async () => {
    const { title } = await listOf({ items: [item('a'), item('b')], registryState: unavailableState })
    assert.ok(title.includes('未检查 2'), title)
    assert.ok(!title.includes('全部最新'), title)
  })
})

describe('ADR-0039 spec D13：检查时刻透出', () => {
  const STAMPS = [1_700_000_000_000, 1_700_000_000_500]
  const expectHHMM = (ms) => {
    const d = new Date(ms)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  it('截至段：更新摘要行含「 · 检查结果截至 HH:MM」（最旧时刻）', async () => {
    const { text } = await listOf({
      items: [item('up', { outdated: true, latestVersion: '2.0.0', probedAt: STAMPS[1] }), item('lt', { latestVersion: '1.0.0', probedAt: STAMPS[0] })],
    })
    const line = text.split('\n').find((l) => l.startsWith('更新：'))
    assert.ok(line, text)
    assert.ok(line.includes(` · 检查结果截至 ${expectHHMM(STAMPS[0])}`), line)
  })

  it('截至段：全部最新句带「（截至 HH:MM）」', async () => {
    const { text } = await listOf({
      items: [item('a', { latestVersion: '1.0.0', probedAt: STAMPS[0] }), item('b', { latestVersion: '1.0.0', probedAt: STAMPS[1] })],
    })
    assert.ok(text.includes(`全部 2 个插件已检查（截至 ${expectHHMM(STAMPS[0])}），均已是最新版本。`), text)
  })

  it('截至段：无任何 probedAt 时两处均不出现（负向锚，现状即绿）', async () => {
    const { text } = await listOf({ items: [item('a', { latestVersion: '1.0.0' }), item('b', { latestVersion: '1.0.0' })] })
    assert.ok(!text.includes('截至'), text)
  })

  it('截至段：注册表不可用不出现（负向锚，现状即绿）', async () => {
    const { text } = await listOf({ items: [item('p-npm', { probedAt: STAMPS[0] }), localItem('p-link', { probedAt: STAMPS[1] })], registryState: unavailableState })
    assert.ok(!text.includes('截至'), text)
  })

  it('execute 透传 probedAt：有值透传、无值为 null', async () => {
    const { out } = await listOf({ items: [item('a', { latestVersion: '1.0.0', probedAt: 1_700_000_000_000 }), item('b', { latestVersion: '1.0.0' })] })
    assert.equal(out.items[0].probedAt, 1_700_000_000_000)
    assert.equal(out.items[1].probedAt, null)
  })
})

describe('ADR-0039 spec D14：dshm_list refresh 参数', () => {
  it('refresh 参数存在且非必填', async () => {
    const { tool } = await loadTools({ items: [] })
    const list = tool('dshm_list')
    assert.equal(list.parameters.properties.refresh?.type, 'boolean')
    assert.ok(!(list.parameters.required ?? []).includes('refresh'))
  })

  it('refresh 透传 core force：refresh:true → force true；缺省 → force false', async () => {
    const { tool, capturedOpts } = await loadTools({ items: [item('a', { latestVersion: '1.0.0' })] })
    const list = tool('dshm_list')
    await list.execute({ refresh: true })
    assert.equal(capturedOpts.at(-1).force, true, 'refresh:true 应透传 force:true')
    await list.execute({})
    assert.equal(capturedOpts.at(-1).force, false, '缺省应透传 force:false')
  })

  it('描述含 refresh 使用提示（缓存穿透语义）', async () => {
    const { tool } = await loadTools({ items: [] })
    const list = tool('dshm_list')
    assert.ok(list.description.includes('refresh:true'), list.description)
    assert.ok(list.description.includes('TTL cache'), list.description)
  })
})
