import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createPrimaryScreenshotReader, resolveEmbeddedScreenshotUrls, screenshotPathError } from '../lib/core/primary-screenshots.js'

const REPO = 'iasiv5/dsh-skins'
const ROOT_MANIFEST = `https://raw.githubusercontent.com/${REPO}/HEAD/screenshots.json`
const MIRROR_MANIFEST = `https://cdn.jsdelivr.net/gh/${REPO}@HEAD/screenshots.json`
const FIVE_PATHS = [
  'docs/assets/preview-meirenzhi-1.webp',
  'docs/assets/preview-switcher.webp',
  'docs/assets/preview-openbmc-1.webp',
  'docs/assets/preview-uefi-1.webp',
  'docs/assets/preview-personalization.webp',
]
const rawUrl = (path) => `https://raw.githubusercontent.com/${REPO}/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`

function fakeFetch(body, calls, { error = null } = {}) {
  return async (url, options = {}) => {
    calls.push({ url, options })
    options.onRequest?.(url)
    if (error) throw error
    return typeof body === 'string' ? body : JSON.stringify(body)
  }
}

describe('Primary screenshots manifest reader', () => {
  it('reads the root manifest and resolves ordered repo-relative image paths', async () => {
    const calls = []
    const loader = createPrimaryScreenshotReader({
      fetchText: fakeFetch(FIVE_PATHS, calls),
      now: () => 0,
    })

    const screenshots = await loader(REPO)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, ROOT_MANIFEST)
    assert.equal(calls[0].options.timeoutMs, 5_000)
    assert.equal(calls[0].options.maxBytes, 65_536)
    assert.deepEqual(screenshots, FIVE_PATHS.map(rawUrl))
  })

  it('encodes path segments without changing slash separators', async () => {
    const calls = []
    const path = 'docs/assets/preview with space.webp'
    const loader = createPrimaryScreenshotReader({
      fetchText: fakeFetch([path], calls),
      now: () => 0,
    })

    assert.deepEqual(await loader(REPO), [rawUrl(path)])
    assert.equal(rawUrl(path).includes('preview%20with%20space.webp'), true)
  })

  it('accepts github name forms allowed by the Primary Registry', async () => {
    const repo = 'owner/.repo_name'
    const calls = []
    const loader = createPrimaryScreenshotReader({ fetchText: fakeFetch(['docs/a.webp'], calls), now: () => 0 })
    assert.deepEqual(await loader(repo), ['https://raw.githubusercontent.com/owner/.repo_name/HEAD/docs/a.webp'])
    assert.equal(calls[0].url, 'https://raw.githubusercontent.com/owner/.repo_name/HEAD/screenshots.json')
  })

  it('trims surrounding whitespace on github and manifest entries before validation', async () => {
    const calls = []
    const loader = createPrimaryScreenshotReader({ fetchText: fakeFetch(['  docs/assets/a.webp  '], calls), now: () => 0 })
    assert.deepEqual(await loader('  iasiv5/dsh-skins  '), ['https://raw.githubusercontent.com/iasiv5/dsh-skins/HEAD/docs/assets/a.webp'])
    assert.equal(calls[0].url, 'https://raw.githubusercontent.com/iasiv5/dsh-skins/HEAD/screenshots.json')
  })

  it('does not fetch when the Registry github value is not an owner/repo pair', async () => {
    const badValues = ['', 'owner', 'https://raw.githubusercontent.com/a/b', 'owner/../repo', 'owner/.', 'owner/..', 'owner/repo/extra', 'owner/repo?x']
    for (const github of badValues) {
      const calls = []
      const loader = createPrimaryScreenshotReader({
        fetchText: fakeFetch(FIVE_PATHS, calls),
        now: () => 0,
      })
      assert.deepEqual(await loader(github), [], `github=${JSON.stringify(github)}`)
      assert.equal(calls.length, 0, `must not fetch github=${JSON.stringify(github)}`)
    }
  })

  it('rejects malformed or unsupported manifest shapes', async () => {
    const badDocuments = [
      { screenshots: FIVE_PATHS },
      null,
      'not an array',
      [],
      FIVE_PATHS.concat('docs/assets/nine.webp', 'docs/assets/ten.webp', 'docs/assets/eleven.webp', 'docs/assets/twelve.webp'),
      ['docs/assets/ok.webp', ''],
      ['docs/assets/ok.webp', 42],
    ]
    for (const document of badDocuments) {
      const calls = []
      const loader = createPrimaryScreenshotReader({
        fetchText: fakeFetch(document, calls),
        now: () => 0,
      })
      assert.deepEqual(await loader(REPO), [], `document=${JSON.stringify(document)}`)
    }
  })

  it('rejects absolute, protocol-relative, escaping, query, fragment, backslash and control paths', async () => {
    const badPaths = [
      '/etc/passwd',
      '//evil.example/track.png',
      '../outside.png',
      'docs/../../outside.png',
      'https://evil.example/track.png',
      'docs/assets/a.png?token=x',
      'docs/assets/a.png#fragment',
      'docs\\assets\\a.png',
      'docs/assets/\u0001a.png',
    ]
    for (const path of badPaths) {
      const calls = []
      const loader = createPrimaryScreenshotReader({
        fetchText: fakeFetch([path], calls),
        now: () => 0,
      })
      assert.deepEqual(await loader(REPO), [], `path=${JSON.stringify(path)}`)
    }
  })

  it('checks every outbound hop against the per-leg host allowlist (raw leg poisoned → mirror leg also poisoned → empty)', async () => {
    const calls = []
    const loader = createPrimaryScreenshotReader({
      fetchText: async (url, options = {}) => {
        calls.push(url)
        options.onRequest?.(url)
        options.onRequest?.('https://evil.example/redirect-target')
        return JSON.stringify(FIVE_PATHS)
      },
      now: () => 0,
    })

    assert.deepEqual(await loader(REPO), [])
    assert.deepEqual(calls, [ROOT_MANIFEST, MIRROR_MANIFEST])
  })

  it('distinguishes initial-URL and redirect-hop host-guard failure messages', async () => {
    const messages = []
    const loader = createPrimaryScreenshotReader({
      fetchText: async (requested, options = {}) => {
        for (const hop of ['http://raw.githubusercontent.com/iasiv5/dsh-skins/HEAD/screenshots.json', 'https://evil.example/redirect-target']) {
          try {
            options.onRequest?.(hop)
          } catch (err) {
            messages.push(err.message)
          }
        }
        options.onRequest?.(requested)
        return JSON.stringify(FIVE_PATHS)
      },
      now: () => 0,
    })

    assert.deepEqual(await loader(REPO), FIVE_PATHS.map(rawUrl))
    assert.deepEqual(messages, [
      'screenshot manifest request URL must be https://raw.githubusercontent.com',
      'screenshot manifest redirects must remain on raw.githubusercontent.com',
    ])
  })

  it('caches successful results for ten minutes and refreshes after expiry', async () => {
    let now = 0
    const calls = []
    const loader = createPrimaryScreenshotReader({
      fetchText: async (url, options = {}) => {
        calls.push(url)
        options.onRequest?.(url)
        return JSON.stringify(FIVE_PATHS)
      },
      now: () => now,
    })

    const first = await loader(REPO)
    now = 599_999
    const cached = await loader(REPO)
    assert.deepEqual(cached, first)
    assert.equal(calls.length, 1)

    now = 600_001
    await loader(REPO)
    assert.equal(calls.length, 2)
  })

  it('404 与 timeout 逐腿兜底（两腿各一次），损坏 JSON 是权威空结果（不打镜像）', async () => {
    const failures = [
      { calls: 2, error: Object.assign(new Error('HTTP 404'), { status: 404 }) },
      { calls: 2, error: Object.assign(new Error('timeout'), { name: 'TimeoutError' }) },
      { calls: 1, body: '{broken json' },
    ]
    for (const failure of failures) {
      const calls = []
      const loader = createPrimaryScreenshotReader({
        fetchText: async (url, options = {}) => {
          calls.push(url)
          options.onRequest?.(url)
          if (failure.error) throw failure.error
          return failure.body
        },
        now: () => 0,
      })
      assert.deepEqual(await loader(REPO), [])
      assert.equal(calls.length, failure.calls, `calls=${calls.length} failure=${JSON.stringify(failure)}`)
    }
  })

  it('negative-caches failures and empty results for one minute, then retries', async () => {
    let now = 0
    let offline = true
    const calls = []
    const loader = createPrimaryScreenshotReader({
      fetchText: async (url, options = {}) => {
        calls.push(url)
        options.onRequest?.(url)
        if (offline) throw new Error('offline')
        return '[]'
      },
      now: () => now,
    })

    assert.deepEqual(await loader(REPO), [])
    assert.deepEqual(await loader(REPO), [])
    assert.equal(calls.length, 2, '两腿全败结果在 1 分钟内负缓存（raw + mirror 各一次）')

    now = 60_001
    offline = false
    assert.deepEqual(await loader(REPO), [])
    assert.deepEqual(await loader(REPO), [])
    assert.equal(calls.length, 3, '空数组结果也在 1 分钟内负缓存（raw 成功即权威，不打镜像）')

    now = 120_002
    assert.deepEqual(await loader(REPO), [])
    assert.equal(calls.length, 4, '负缓存过期后重新读取')
  })

  it('falls back to the jsDelivr mirror when raw is unreachable, rewriting image URLs to the raw canonical form', async () => {
    const calls = []
    const loader = createPrimaryScreenshotReader({
      fetchText: async (url, options = {}) => {
        calls.push(url)
        options.onRequest?.(url)
        if (url === ROOT_MANIFEST) throw Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
        return JSON.stringify(FIVE_PATHS)
      },
      now: () => 0,
    })

    // 图片 URL 恒为 raw 规范形：客户端 safeScreenshots 白名单只放行 github.com / *.githubusercontent.com，
    // 镜像腿若原样回 jsdelivr URL 会被客户端整体过滤。
    assert.deepEqual(await loader(REPO), FIVE_PATHS.map(rawUrl))
    assert.deepEqual(calls, [ROOT_MANIFEST, MIRROR_MANIFEST])
  })

  it('both legs failing degrades to an empty gallery', async () => {
    const calls = []
    const loader = createPrimaryScreenshotReader({
      fetchText: async (url, options = {}) => {
        calls.push(url)
        options.onRequest?.(url)
        throw Object.assign(new Error('timeout'), { name: 'TimeoutError' })
      },
      now: () => 0,
    })

    assert.deepEqual(await loader(REPO), [])
    assert.deepEqual(calls, [ROOT_MANIFEST, MIRROR_MANIFEST])
  })

  it('mirror redirects must remain on the jsDelivr host', async () => {
    const calls = []
    const messages = []
    const loader = createPrimaryScreenshotReader({
      fetchText: async (url, options = {}) => {
        calls.push(url)
        options.onRequest?.(url)
        if (url === ROOT_MANIFEST) throw new Error('raw unreachable')
        if (url === MIRROR_MANIFEST) {
          try {
            options.onRequest?.('https://evil.example/redirect-target')
          } catch (err) {
            messages.push(err.message)
            throw err
          }
        }
        return JSON.stringify(FIVE_PATHS)
      },
      now: () => 0,
    })

    assert.deepEqual(await loader(REPO), [])
    assert.deepEqual(calls, [ROOT_MANIFEST, MIRROR_MANIFEST])
    assert.deepEqual(messages, ['screenshot manifest redirects must remain on cdn.jsdelivr.net'])
  })

  it('coalesces concurrent reads for the same repo into one fetch', async () => {
    let release
    let calls = 0
    const loader = createPrimaryScreenshotReader({
      fetchText: async (url, options = {}) => {
        calls += 1
        options.onRequest?.(url)
        await new Promise((resolve) => { release = resolve })
        return JSON.stringify(FIVE_PATHS)
      },
      now: () => 0,
    })

    const first = loader(REPO)
    const second = loader(REPO)
    assert.equal(calls, 1)
    release()
    assert.deepEqual(await first, FIVE_PATHS.map(rawUrl))
    assert.deepEqual(await second, FIVE_PATHS.map(rawUrl))
    assert.equal(calls, 1)
  })
})

describe('screenshotPathError：manifest 路径规则单一事实源（ADR-0015 修订）', () => {
  const okPaths = ['docs/a.png', 'a b.png', 'docs/assets/preview with space.webp', '  docs/trim.png  ']
  for (const p of okPaths) it(`合法 → null：${JSON.stringify(p)}`, () => assert.equal(screenshotPathError(p), null))

  const badPaths = [
    '',
    '/abs.png',
    '..\\x.png',
    'a\\b.png',
    '//x.png',
    'https://x/y.png',
    'a?b.png',
    'a#b.png',
    'a/./b.png',
    'a/../b.png',
    'docs/assets/\u0001a.png',
  ]
  for (const p of badPaths) it(`违规 → 非空错误串：${JSON.stringify(p)}`, () => assert.ok(screenshotPathError(p) !== null, `期望违规：${JSON.stringify(p)}`))
  it('非字符串 → 违规', () => {
    assert.ok(screenshotPathError(42) !== null)
    assert.ok(screenshotPathError(null) !== null)
  })
})

describe('resolveEmbeddedScreenshotUrls：内嵌截图主源解析器（ADR-0015 修订）', () => {
  it('相对路径数组 → raw HEAD URL 数组（声明顺序保持，段编码）', () => {
    assert.deepEqual(
      resolveEmbeddedScreenshotUrls('iasiv5/dsh-m', ['docs/a.png', 'shot b.png']),
      ['https://raw.githubusercontent.com/iasiv5/dsh-m/HEAD/docs/a.png', 'https://raw.githubusercontent.com/iasiv5/dsh-m/HEAD/shot%20b.png'],
    )
  })
  it('github 非 owner/repo → 空数组', () => {
    assert.deepEqual(resolveEmbeddedScreenshotUrls('not-a-slug', ['a.png']), [])
    assert.deepEqual(resolveEmbeddedScreenshotUrls('', ['a.png']), [])
  })
  it('非法路径被剔除、合法项保留', () => {
    assert.deepEqual(
      resolveEmbeddedScreenshotUrls('iasiv5/dsh-m', ['../evil.png', 'ok.png']),
      ['https://raw.githubusercontent.com/iasiv5/dsh-m/HEAD/ok.png'],
    )
  })
  it('空数组 → 空数组', () => {
    assert.deepEqual(resolveEmbeddedScreenshotUrls('iasiv5/dsh-m', []), [])
  })
})
