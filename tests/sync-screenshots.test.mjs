/**
 * 计划 T6：registry screenshots 同步脚本——行手术纯函数 + fetchAuthorScreenshotPaths 三态分类。
 * 运行：npm run build && node --test tests/sync-screenshots.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyScreenshotsEdits, fetchAuthorScreenshotPaths } from '../scripts/sync-registry-screenshots.mjs'

const LF_FIXTURE = `{
  "version": 1,
  "plugins": [
    {
      "id": "alpha",
      "name": "Alpha",
      "github": "o/alpha",
      "homepage": "https://alpha"
    },
    {
      "id": "beta",
      "name": "Beta",
      "github": "o/beta",
      "icon": "https://cdn.example/b.svg",
      "homepage": "https://beta"
    }
  ]
}
`

const CRLF_FIXTURE = LF_FIXTURE.replace(/\n/g, '\r\n')

describe('applyScreenshotsEdits：行手术纯函数', () => {
  it('① 无该字段条目：github 行后插入 screenshots 单行（LF）', () => {
    const { text, changed, skipped } = applyScreenshotsEdits(LF_FIXTURE, new Map([['alpha', ['docs/a.png', 'docs/b.png']]]))
    const lines = text.split('\n')
    const ghIdx = lines.indexOf('      "github": "o/alpha",')
    assert.equal(lines[ghIdx + 1], '      "screenshots": ["docs/a.png","docs/b.png"],')
    assert.deepEqual(changed, ['alpha'])
    assert.deepEqual(skipped, [])
    // 其余条目字节不动
    assert.ok(text.includes('      "icon": "https://cdn.example/b.svg",'))
  })

  it('② 已有 screenshots 行原位替换', () => {
    const withField = LF_FIXTURE.replace('      "github": "o/alpha",', '      "github": "o/alpha",\n      "screenshots": ["old.png"],')
    const { text, changed } = applyScreenshotsEdits(withField, new Map([['alpha', ['new.png']]]))
    assert.ok(text.includes('      "screenshots": ["new.png"],'))
    assert.ok(!text.includes('old.png'))
    assert.deepEqual(changed, ['alpha'])
    assert.equal(text.split('\n').length, withField.split('\n').length, '替换不改行数')
  })

  it('③ CRLF 输入 → CRLF 输出（逐行 \\r 保持）', () => {
    const { text } = applyScreenshotsEdits(CRLF_FIXTURE, new Map([['alpha', ['crlf.png']]]))
    assert.ok(text.includes('\r\n'), '应保持 CRLF')
    assert.ok(!text.replace(/\r\n/g, '').includes('\r'), '不得混入裸 \\r')
    const shotLine = text.split('\r\n').find((l) => l.includes('"screenshots"'))
    assert.equal(shotLine, '      "screenshots": ["crlf.png"],')
  })

  it('④ 无 github 行条目 → skipped 且 text 不变', () => {
    const noGithub = `{
  "version": 1,
  "plugins": [
    {
      "id": "solo",
      "name": "Solo",
      "homepage": "https://solo"
    }
  ]
}
`
    const { text, changed, skipped } = applyScreenshotsEdits(noGithub, new Map([['solo', ['x.png']]]))
    assert.equal(text, noGithub)
    assert.deepEqual(changed, [])
    assert.deepEqual(skipped, ['solo'])
  })

  it('⑤ 紧凑风格自证：screenshots 行单行闭合（逐行先剥 \\r 再判定）', () => {
    const { text } = applyScreenshotsEdits(CRLF_FIXTURE, new Map([['alpha', ['a.png', 'b.png', 'c.png']]]))
    const shotLines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.includes('"screenshots"'))
    assert.equal(shotLines.length, 1)
    assert.match(shotLines[0], /^ {6}"screenshots": \[[^\]]*\],?$/)
    assert.ok(!shotLines[0].includes(', '), '紧凑分隔：逗号后无空格')
  })

  it('⑥ changed/skipped 名单正确（含未知 id 进 skipped）', () => {
    const { text, changed, skipped } = applyScreenshotsEdits(LF_FIXTURE, new Map([['alpha', ['a.png']], ['ghost', ['g.png']]]))
    assert.deepEqual(changed, ['alpha'])
    assert.deepEqual(skipped, ['ghost'])
    assert.ok(text.includes('"screenshots": ["a.png"],'))
  })

  it('⑦ 多条目混改：改一条插一条、其余条目字节不动', () => {
    const { text, changed } = applyScreenshotsEdits(LF_FIXTURE, new Map([['alpha', ['a1.png']], ['beta', ['b1.png']]]))
    assert.deepEqual(changed, ['alpha', 'beta'])
    const lines = text.split('\n')
    assert.equal(lines[lines.indexOf('      "github": "o/alpha",') + 1], '      "screenshots": ["a1.png"],')
    assert.equal(lines[lines.indexOf('      "github": "o/beta",') + 1], '      "screenshots": ["b1.png"],')
    assert.ok(text.includes('      "homepage": "https://alpha"'))
  })

  it('⑨ github 为块内最后字段（无尾逗号）时插入不产生尾逗号、github 行补逗号', () => {
    const ghLast = `{
  "version": 1,
  "plugins": [
    {
      "id": "tail",
      "name": "Tail",
      "github": "o/tail"
    }
  ]
}
`
    const { text } = applyScreenshotsEdits(ghLast, new Map([['tail', ['t.png']]]))
    const lines = text.split('\n').map((l) => l.replace(/\r$/, ''))
    const ghIdx = lines.indexOf('      "github": "o/tail",')
    assert.equal(lines[ghIdx + 1], '      "screenshots": ["t.png"]', '块内最后字段：新行无尾逗号')
    assert.ok(!text.includes(',\n    }') || !text.includes(',\r\n    }'), '不得产生 JSON 尾逗号')
    // JSON 合法性终审
    JSON.parse(text)
  })

  it('⑩ 产物 JSON 可解析（替换路径同样合法）', () => {
    const withField = LF_FIXTURE.replace('      "github": "o/beta",', '      "github": "o/beta",\n      "screenshots": ["x.png"],')
    const { text } = applyScreenshotsEdits(withField, new Map([['beta', ['y.png', 'z.png']]]))
    const parsed = JSON.parse(text)
    assert.deepEqual(parsed.plugins[1].screenshots, ['y.png', 'z.png'])
  })
})

describe('fetchAuthorScreenshotPaths：三态分类（评审 F3，按腿结果）', () => {
  const stub = (behavior) => async (url, options = {}) => {
    options.onRequest?.(url)
    return behavior(url)
  }
  const http404 = () => Object.assign(new Error('HTTP 404'), { status: 404 })
  const netReset = () => Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })

  it('raw 2xx + 合规 → ok', async () => {
    const r = await fetchAuthorScreenshotPaths('o/a', stub(() => JSON.stringify(['a.png'])))
    assert.deepEqual(r, { status: 'ok', paths: ['a.png'] })
  })
  it('raw 2xx + 不合规（坏路径/非数组/空数组/>8）→ missing', async () => {
    for (const body of ['{broken', '"str"', '[]', JSON.stringify(['../bad.png']), JSON.stringify(Array.from({ length: 9 }, (_, i) => `${i}.png`))]) {
      const r = await fetchAuthorScreenshotPaths('o/a', stub(() => body))
      assert.equal(r.status, 'missing', `body=${body}`)
    }
  })
  it('raw 404 + mirror 404 → missing（双权威缺席）', async () => {
    const r = await fetchAuthorScreenshotPaths('o/a', stub(() => { throw http404() }))
    assert.deepEqual(r, { status: 'missing' })
  })
  it('raw throw + mirror 2xx → ok（镜像救回）', async () => {
    const r = await fetchAuthorScreenshotPaths('o/a', stub((url) => {
      if (url.includes('raw.githubusercontent.com')) throw netReset()
      return JSON.stringify(['m.png'])
    }))
    assert.deepEqual(r, { status: 'ok', paths: ['m.png'] })
  })
  it('raw throw + mirror 404 → probe-failed（保守：不能证伪作者文件）', async () => {
    const r = await fetchAuthorScreenshotPaths('o/a', stub((url) => {
      if (url.includes('raw.githubusercontent.com')) throw netReset()
      throw http404()
    }))
    assert.equal(r.status, 'probe-failed')
    assert.ok(typeof r.reason === 'string' && r.reason !== '')
  })
  it('raw 404 + mirror throw → probe-failed', async () => {
    const r = await fetchAuthorScreenshotPaths('o/a', stub((url) => {
      if (url.includes('raw.githubusercontent.com')) throw http404()
      throw netReset()
    }))
    assert.equal(r.status, 'probe-failed')
  })
  it('raw throw + mirror throw → probe-failed（双故障腿第七分支）', async () => {
    const r = await fetchAuthorScreenshotPaths('o/a', stub(() => { throw netReset() }))
    assert.equal(r.status, 'probe-failed')
  })
  it('两腿 URL 模板与 core 模块逐字同源（raw HEAD + jsDelivr @HEAD）', async () => {
    const seen = []
    await fetchAuthorScreenshotPaths('o/a', stub((url) => { seen.push(url); throw http404() }))
    assert.deepEqual(seen, ['https://raw.githubusercontent.com/o/a/HEAD/screenshots.json', 'https://cdn.jsdelivr.net/gh/o/a@HEAD/screenshots.json'])
  })
})
