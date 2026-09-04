/**
 * Task 2：统一安全 HTTP primitive（手动重定向/loop 检测/signal/body cap/最终 URL）。
 * 运行：npm run build && node --test tests/httpx.test.mjs
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import {
  HttpError,
  assertSafeUrl,
  decodeUtf8Fatal,
  fetchJsonLimited,
  fetchJsonLimitedMeta,
  fetchTextLimited,
  isReachable,
} from '../lib/core/httpx.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function start(handler) {
  let hits = 0
  const server = createServer((req, res) => {
    hits += 1
    handler(req, res, req.url || '/')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const handle = { port, hits: () => hits, close: () => new Promise((resolve) => server.close(resolve)) }
  servers.push(handle)
  return handle
}

const servers = []
afterEach(async () => {
  while (servers.length) await servers.pop().close()
})

describe('assertSafeUrl', () => {
  it('HTTPS 与 loopback HTTP 放行', () => {
    assert.equal(assertSafeUrl('https://example.com/r.json').protocol, 'https:')
    assert.equal(assertSafeUrl('http://127.0.0.1:9/x').protocol, 'http:')
    assert.equal(assertSafeUrl('http://localhost/x').protocol, 'http:')
  })
  it('非 loopback HTTP 与其他协议拒绝', () => {
    for (const bad of ['http://example.com/x', 'http://192.168.1.5/x', 'ftp://x/y', 'file:///etc/passwd']) {
      assert.throws(() => assertSafeUrl(bad))
    }
  })
})

describe('decodeUtf8Fatal', () => {
  it('合法 UTF-8 解码，非法序列拒绝', () => {
    assert.equal(decodeUtf8Fatal(Buffer.from('中文 ok', 'utf8')), '中文 ok')
    assert.throws(() => decodeUtf8Fatal(Buffer.from([0xff, 0xfe, 0xfa])))
  })
})

describe('fetchLimited 重定向', () => {
  it('跟随 loopback 重定向（含相对 Location），返回最终 URL 与解析后的 JSON', async () => {
    const s = await start((req, res, u) => {
      if (u === '/a') {
        res.writeHead(302, { location: '/b' })
        res.end()
      } else if (u === '/b') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, at: 'b' }))
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    const { data, finalUrl } = await fetchJsonLimitedMeta(`http://127.0.0.1:${s.port}/a`, { timeoutMs: 5000 })
    assert.deepEqual(data, { ok: true, at: 'b' })
    assert.equal(finalUrl, `http://127.0.0.1:${s.port}/b`)
  })

  it('拒绝重定向到非 loopback HTTP', async () => {
    const s = await start((req, res) => {
      res.writeHead(302, { location: 'http://192.168.1.5/evil' })
      res.end()
    })
    await assert.rejects(
      () => fetchJsonLimited(`http://127.0.0.1:${s.port}/a`, { timeoutMs: 5000 }),
      (err) => err instanceof HttpError,
    )
  })

  it('拒绝重定向到非 http(s) 协议', async () => {
    const s = await start((req, res) => {
      res.writeHead(302, { location: 'ftp://example.com/x' })
      res.end()
    })
    await assert.rejects(() => fetchJsonLimited(`http://127.0.0.1:${s.port}/a`, { timeoutMs: 5000 }))
  })

  it('检测重定向循环', async () => {
    const s = await start((req, res) => {
      res.writeHead(302, { location: '/loop' })
      res.end()
    })
    await assert.rejects(
      () => fetchJsonLimited(`http://127.0.0.1:${s.port}/loop`, { timeoutMs: 5000 }),
      (err) => err instanceof HttpError && /循环|redirect/i.test(err.message),
    )
  })

  it('超过 3 跳拒绝', async () => {
    let n = 0
    const s = await start((req, res) => {
      n += 1
      res.writeHead(302, { location: `/hop${n}` })
      res.end()
    })
    await assert.rejects(
      () => fetchJsonLimited(`http://127.0.0.1:${s.port}/hop0`, { timeoutMs: 5000 }),
      (err) => err instanceof HttpError && /跳/.test(err.message),
    )
  })
})

describe('fetchLimited 超时与 signal', () => {
  it('超时中断请求', async () => {
    const s = await start(async (req, res) => {
      await sleep(500)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
    await assert.rejects(() => fetchJsonLimited(`http://127.0.0.1:${s.port}/slow`, { timeoutMs: 50 }))
  })

  it('外部 signal abort 中断请求', async () => {
    const s = await start(async (req, res) => {
      await sleep(1000)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    await assert.rejects(() => fetchJsonLimited(`http://127.0.0.1:${s.port}/slow`, { timeoutMs: 10000, signal: ac.signal }))
  })

  it('已 abort 的 signal 立即失败', async () => {
    const s = await start((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
    const ac = new AbortController()
    ac.abort()
    await assert.rejects(() => fetchJsonLimited(`http://127.0.0.1:${s.port}/x`, { timeoutMs: 5000, signal: ac.signal }))
  })
})

describe('fetchLimited body 边界', () => {
  it('body 超过 maxBytes 拒绝', async () => {
    const s = await start((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('x'.repeat(64 * 1024))
    })
    await assert.rejects(
      () => fetchJsonLimited(`http://127.0.0.1:${s.port}/big`, { timeoutMs: 5000, maxBytes: 1024 }),
      (err) => err instanceof HttpError && /上限/.test(err.message),
    )
  })

  it('content-length 预检超限直接拒绝', async () => {
    const s = await start((req, res) => {
      res.writeHead(200, { 'content-length': '99999999', 'content-type': 'application/json' })
      res.end()
    })
    await assert.rejects(() => fetchJsonLimited(`http://127.0.0.1:${s.port}/declared`, { timeoutMs: 5000, maxBytes: 1024 }))
  })

  it('非法 UTF-8 JSON 拒绝', async () => {
    const s = await start((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]))
    })
    await assert.rejects(
      () => fetchJsonLimited(`http://127.0.0.1:${s.port}/badutf8`, { timeoutMs: 5000 }),
      (err) => err instanceof HttpError && /UTF-8/.test(err.message),
    )
  })

  it('非法 JSON 拒绝', async () => {
    const s = await start((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('not json')
    })
    await assert.rejects(() => fetchJsonLimited(`http://127.0.0.1:${s.port}/badjson`, { timeoutMs: 5000 }))
  })

  it('HTTP 错误状态抛 HttpError 且带 status', async () => {
    const s = await start((req, res) => {
      res.writeHead(503)
      res.end()
    })
    await assert.rejects(
      () => fetchJsonLimited(`http://127.0.0.1:${s.port}/err`, { timeoutMs: 5000 }),
      (err) => err instanceof HttpError && err.status === 503,
    )
  })
})

describe('fetchTextLimited / isReachable', () => {
  it('fetchTextLimited 返回文本', async () => {
    const s = await start((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('hello')
    })
    assert.equal(await fetchTextLimited(`http://127.0.0.1:${s.port}/t`, { timeoutMs: 5000 }), 'hello')
  })

  it('isReachable：200 true、404 false、405 true', async () => {
    const s = await start((req, res, u) => {
      if (u === '/ok') {
        res.writeHead(200)
        res.end()
      } else if (u === '/nope') {
        res.writeHead(404)
        res.end()
      } else if (u === '/method') {
        res.writeHead(405)
        res.end()
      } else {
        res.writeHead(500)
        res.end()
      }
    })
    assert.equal(await isReachable(`http://127.0.0.1:${s.port}/ok`, 5000), true)
    assert.equal(await isReachable(`http://127.0.0.1:${s.port}/nope`, 5000), false)
    assert.equal(await isReachable(`http://127.0.0.1:${s.port}/method`, 5000), true)
  })
})
