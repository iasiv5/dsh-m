/**
 * T4（ADR-0013）：截图纯逻辑单元——图床白名单、jsDelivr 线路改写、README 抽图与语义打分、
 * 会话缓存、多候选抓取链（content-length 预检 + chunked 边读边限 + 超时 + 失败静默）。
 * 运行：node --test tests/screenshots.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  CARD_SHOT_LIMIT,
  GALLERY_SHOT_LIMIT,
  README_MAX_BYTES,
  isSafeShotUrl,
  shotSrcCandidates,
  extractReadmeImageUrls,
  rankReadmeShots,
  createReadmeShotCache,
  fetchReadmeShots,
} from '../src/client/screenshots.js'

const RAW = (p) => `https://raw.githubusercontent.com/o1/r1/HEAD/${p}`

describe('isSafeShotUrl（GitHub 图床白名单）', () => {
  it('放行 github.com 与 *.githubusercontent.com 的 HTTPS URL', () => {
    assert.equal(isSafeShotUrl(RAW('a.png')), true)
    assert.equal(isSafeShotUrl('https://github.com/o1/r1/raw/HEAD/a.png'), true)
    assert.equal(isSafeShotUrl('https://user-images.githubusercontent.com/123/456.png'), true)
  })
  it('拒绝非 HTTPS / 非 GitHub 图床 / 超长 / 非字符串', () => {
    assert.equal(isSafeShotUrl('http://raw.githubusercontent.com/o1/r1/HEAD/a.png'), false)
    assert.equal(isSafeShotUrl('https://cdn.example.com/a.png'), false)
    assert.equal(isSafeShotUrl(`https://raw.githubusercontent.com/o1/r1/HEAD/${'a'.repeat(2049)}.png`), false)
    for (const bad of [42, null, undefined, '', '  ']) assert.equal(isSafeShotUrl(bad), false)
  })
})

describe('shotSrcCandidates（jsDelivr 改写优先的回退链）', () => {
  it('raw 仓库路径 → [jsDelivr@HEAD 改写, 原 URL]', () => {
    assert.deepEqual(shotSrcCandidates(RAW('docs/s.png')), [
      'https://cdn.jsdelivr.net/gh/o1/r1@HEAD/docs/s.png',
      RAW('docs/s.png'),
    ])
  })
  it('分支引用同样改写为 @HEAD', () => {
    assert.deepEqual(shotSrcCandidates('https://raw.githubusercontent.com/o1/r1/main/docs/s.png'), [
      'https://cdn.jsdelivr.net/gh/o1/r1@HEAD/docs/s.png',
      'https://raw.githubusercontent.com/o1/r1/main/docs/s.png',
    ])
  })
  it('github.com/<o>/<r>/raw/ 形态归一改写', () => {
    assert.deepEqual(shotSrcCandidates('https://github.com/o1/r1/raw/HEAD/s.png'), [
      'https://cdn.jsdelivr.net/gh/o1/r1@HEAD/s.png',
      'https://github.com/o1/r1/raw/HEAD/s.png',
    ])
  })
  it('user-images 等非仓库路径仅原 URL；非白名单为空', () => {
    assert.deepEqual(shotSrcCandidates('https://user-images.githubusercontent.com/123/456.png'), [
      'https://user-images.githubusercontent.com/123/456.png',
    ])
    assert.deepEqual(shotSrcCandidates('https://cdn.example.com/s.png'), [])
  })
})

describe('extractReadmeImageUrls（内联/参考式/HTML img）', () => {
  it('三类语法全抽出，http 与 data URI 不收', () => {
    const md = [
      '![shot](https://raw.githubusercontent.com/o/r/HEAD/a.png)',
      '![b][ref1]',
      '',
      '[ref1]: https://raw.githubusercontent.com/o/r/HEAD/b.png',
      '<img src="https://raw.githubusercontent.com/o/r/HEAD/c.png" alt="">',
      '![http](http://raw.githubusercontent.com/o/r/HEAD/d.png)',
      '![data](data:image/png;base64,xxx)',
    ].join('\n')
    const urls = extractReadmeImageUrls(md)
    assert.ok(urls.includes('https://raw.githubusercontent.com/o/r/HEAD/a.png'))
    assert.ok(urls.includes('https://raw.githubusercontent.com/o/r/HEAD/b.png'))
    assert.ok(urls.includes('https://raw.githubusercontent.com/o/r/HEAD/c.png'))
    assert.equal(urls.some((u) => u.startsWith('http://')), false)
    assert.equal(urls.some((u) => u.startsWith('data:')), false)
  })
  it('空/非字符串 → 空数组', () => {
    assert.deepEqual(extractReadmeImageUrls(''), [])
    assert.deepEqual(extractReadmeImageUrls(null), [])
  })
})

describe('rankReadmeShots（语义打分：剔 badge/logo/svg，偏好 screenshots/docs）', () => {
  it('剔除与排序', () => {
    const urls = [
      RAW('assets/banner.png'),
      RAW('badge.svg'),
      RAW('logo.png'),
      RAW('docs/screenshots/main.png'),
      RAW('other.png'),
      RAW('avatar.png'),
    ]
    const ranked = rankReadmeShots(urls, 6)
    assert.equal(ranked.includes(RAW('badge.svg')), false, 'svg 剔除')
    assert.equal(ranked.includes(RAW('logo.png')), false, 'logo 剔除')
    assert.equal(ranked.includes(RAW('avatar.png')), false, 'avatar 剔除')
    assert.equal(ranked[0], RAW('docs/screenshots/main.png'), '语义加分者居首')
    assert.ok(ranked.includes(RAW('assets/banner.png')) && ranked.includes(RAW('other.png')))
  })
  it('limit 截断与稳定保序', () => {
    const urls = [RAW('b.png'), RAW('a.png')]
    assert.deepEqual(rankReadmeShots(urls, 1), [RAW('b.png')], '同分保序')
    assert.equal(CARD_SHOT_LIMIT, 3)
    assert.equal(GALLERY_SHOT_LIMIT, 6)
    assert.equal(README_MAX_BYTES, 262144)
  })
})

describe('createReadmeShotCache（会话缓存工厂）', () => {
  it('get/set/clear roundtrip；set 收敛非数组为空数组', () => {
    const c = createReadmeShotCache()
    assert.equal(c.get('a'), undefined)
    c.set('a', [RAW('x.png')])
    assert.deepEqual(c.get('a'), [RAW('x.png')])
    c.set('b', 'junk')
    assert.deepEqual(c.get('b'), [])
    c.clear()
    assert.equal(c.get('a'), undefined)
  })
})

describe('fetchReadmeShots（多候选抓取链）', () => {
  const mdWith = (...urls) => urls.map((u, i) => `![s${i}](${u})`).join('\n')

  function fakeRes(text, opts = {}) {
    return {
      ok: opts.ok !== false,
      status: opts.status ?? 200,
      headers: { get: (k) => String(k).toLowerCase() === 'content-length' ? (opts.len ?? String(text.length)) : null },
      body: opts.body ?? null,
      text: async () => text,
    }
  }

  it('jsDelivr 首候选成功：抽图打分且只发一次请求', async () => {
    const calls = []
    const fetchImpl = async (url, opts) => {
      calls.push({ url, signal: opts && opts.signal })
      return fakeRes(mdWith(RAW('docs/a.png'), 'https://raw.githubusercontent.com/o1/r1/HEAD/badge.svg'))
    }
    const shots = await fetchReadmeShots({ id: 'e1', github: 'o1/r1' }, { fetchImpl })
    assert.deepEqual(shots, [RAW('docs/a.png')])
    assert.equal(calls.length, 1)
    assert.ok(calls[0].url.startsWith('https://cdn.jsdelivr.net/gh/o1/r1@HEAD/README.md'))
    assert.ok(calls[0].signal, '携带 AbortSignal（超时可控）')
  })

  it('首候选 404 → 回退 raw 直连成功', async () => {
    const calls = []
    const fetchImpl = async (url) => {
      calls.push(url)
      if (calls.length === 1) return fakeRes('nope', { ok: false, status: 404 })
      return fakeRes(mdWith(RAW('docs/b.png')))
    }
    const shots = await fetchReadmeShots({ id: 'e2', github: 'o1/r1' }, { fetchImpl })
    assert.deepEqual(shots, [RAW('docs/b.png')])
    assert.deepEqual(calls, [
      'https://cdn.jsdelivr.net/gh/o1/r1@HEAD/README.md',
      'https://raw.githubusercontent.com/o1/r1/HEAD/README.md',
    ])
  })

  it('content-length 超限 → 两候选都跳过 → []', async () => {
    let n = 0
    const fetchImpl = async () => {
      n += 1
      return fakeRes('x', { len: String(README_MAX_BYTES + 1) })
    }
    const shots = await fetchReadmeShots({ id: 'e3', github: 'o1/r1' }, { fetchImpl })
    assert.deepEqual(shots, [])
    assert.equal(n, 2)
  })

  it('chunked 无长度头 + 正文超限：读满上限即停（cancel），截断处之后的图不出现', async () => {
    const enc = new TextEncoder()
    const big = 'x'.repeat(README_MAX_BYTES)
    const md = `# t\n${big}\n![a](https://raw.githubusercontent.com/o1/r1/HEAD/z.png)\n`
    let cancelCalled = false
    const chunks = [enc.encode(big), enc.encode(md.slice(big.length))]
    const body = {
      getReader() {
        let i = 0
        return {
          read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
          cancel: async () => { cancelCalled = true },
        }
      },
    }
    let n = 0
    const fetchImpl = async () => {
      n += 1
      return { ok: true, status: 200, headers: { get: () => null }, body, text: async () => { throw new Error('不应走 text()') } }
    }
    const shots = await fetchReadmeShots({ id: 'e4', github: 'o1/r1' }, { fetchImpl })
    assert.deepEqual(shots, [], '截断处之后的图不出现')
    assert.equal(cancelCalled, true, 'reader 被 cancel')
    assert.equal(n, 1, '首候选成功（即使截断无图）即停——同仓库两候选内容相同，不做无意义重试')
  })

  it('两候选均网络错误 → []（静默）', async () => {
    const fetchImpl = async () => { throw new Error('fetch failed') }
    const shots = await fetchReadmeShots({ id: 'e5', github: 'o1/r1' }, { fetchImpl })
    assert.deepEqual(shots, [])
  })

  it('无 github 或形状不合法 → [] 且零请求', async () => {
    let n = 0
    const fetchImpl = async () => { n += 1; return fakeRes(mdWith(RAW('a.png'))) }
    assert.deepEqual(await fetchReadmeShots({ id: 'e6', github: 'nope' }, { fetchImpl }), [])
    assert.deepEqual(await fetchReadmeShots({ id: 'e7' }, { fetchImpl }), [])
    assert.equal(n, 0)
  })

  it('缓存短路：命中零请求；未命中写回并复用', async () => {
    const cache = createReadmeShotCache()
    cache.set('hit', [RAW('cached.png')])
    let n = 0
    const fetchImpl = async () => { n += 1; return fakeRes(mdWith(RAW('docs/fresh.png'))) }
    assert.deepEqual(await fetchReadmeShots({ id: 'hit', github: 'o1/r1' }, { fetchImpl, cache }), [RAW('cached.png')])
    assert.equal(n, 0, '命中缓存零请求')
    const first = await fetchReadmeShots({ id: 'miss', github: 'o1/r1' }, { fetchImpl, cache })
    assert.deepEqual(first, [RAW('docs/fresh.png')])
    const second = await fetchReadmeShots({ id: 'miss', github: 'o1/r1' }, { fetchImpl, cache })
    assert.deepEqual(second, [RAW('docs/fresh.png')])
    assert.equal(n, 1, '未命中只抓一次，第二次走缓存')
  })
})
