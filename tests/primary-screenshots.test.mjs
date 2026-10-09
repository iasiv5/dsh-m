import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createPrimaryScreenshotReader } from '../lib/core/primary-screenshots.js'

const REPO = 'iasiv5/dsh-skins'
const ROOT_MANIFEST = `https://raw.githubusercontent.com/${REPO}/HEAD/screenshots.json`
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

  it('checks every outbound hop against the raw.githubusercontent.com host allowlist', async () => {
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
    assert.deepEqual(calls, [ROOT_MANIFEST])
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

  it('404、timeout 与损坏 JSON 均返回空列表', async () => {
    const failures = [
      { error: Object.assign(new Error('HTTP 404'), { status: 404 }) },
      { error: Object.assign(new Error('timeout'), { name: 'TimeoutError' }) },
      { body: '{broken json' },
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
      assert.equal(calls.length, 1)
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
    assert.equal(calls.length, 1, '失败结果在 1 分钟内负缓存')

    now = 60_001
    offline = false
    assert.deepEqual(await loader(REPO), [])
    assert.deepEqual(await loader(REPO), [])
    assert.equal(calls.length, 2, '空数组结果也在 1 分钟内负缓存')

    now = 120_002
    assert.deepEqual(await loader(REPO), [])
    assert.equal(calls.length, 3, '负缓存过期后重新读取')
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
