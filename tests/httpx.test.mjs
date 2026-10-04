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
  fetchBytesLimited,
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

describe('fetchBytesLimited（M1 Task 1）', () => {
  it('200 二进制 body：bytes 原样返回、finalUrl 正确', async () => {
    const payload = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x7f, 0x80])
    const s = await start((req, res, u) => {
      if (u === '/bin') {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(payload.length) })
        res.end(payload)
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    const { bytes, finalUrl } = await fetchBytesLimited(`http://127.0.0.1:${s.port}/bin`, { timeoutMs: 5000 })
    assert.deepEqual(bytes, payload)
    assert.equal(finalUrl, `http://127.0.0.1:${s.port}/bin`)
  })

  it('超过 maxBytes：抛 HttpError 且文案含「超过」', async () => {
    const s = await start((req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(Buffer.alloc(64 * 1024, 1))
    })
    await assert.rejects(
      () => fetchBytesLimited(`http://127.0.0.1:${s.port}/big`, { timeoutMs: 5000, maxBytes: 1024 }),
      (err) => err instanceof HttpError && err.message.includes('超过'),
    )
  })

  it('非 2xx：抛 HttpError(status, "HTTP <status>")', async () => {
    const s = await start((req, res) => {
      res.writeHead(500)
      res.end()
    })
    await assert.rejects(
      () => fetchBytesLimited(`http://127.0.0.1:${s.port}/e`, { timeoutMs: 5000 }),
      (err) => err instanceof HttpError && err.status === 500 && err.message === 'HTTP 500',
    )
  })

  it('301 重定向：finalUrl 为目标、body 为目标响应', async () => {
    const payload = Buffer.from('redirected-bytes')
    const s = await start((req, res, u) => {
      if (u === '/a') {
        res.writeHead(301, { location: '/b' })
        res.end()
      } else {
        res.writeHead(200, { 'content-length': String(payload.length) })
        res.end(payload)
      }
    })
    const { bytes, finalUrl } = await fetchBytesLimited(`http://127.0.0.1:${s.port}/a`, { timeoutMs: 5000 })
    assert.deepEqual(bytes, payload)
    assert.equal(finalUrl, `http://127.0.0.1:${s.port}/b`)
  })
})

describe('onRequest 钩子（M1 Task 1，wire 层逐物理请求计数）', () => {
  const jsonHandler = (req, res, u) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  }

  it('无重定向：恰好调用 1 次，URL 为请求地址', async () => {
    const s = await start(jsonHandler)
    const calls = []
    await fetchJsonLimited(`http://127.0.0.1:${s.port}/x`, { timeoutMs: 5000, onRequest: (u) => calls.push(u) })
    assert.deepEqual(calls, [`http://127.0.0.1:${s.port}/x`])
  })

  it('单次 redirect（初始+目标）：调用 2 次，逐跳 URL 按序', async () => {
    const s = await start((req, res, u) => {
      if (u === '/a') {
        res.writeHead(302, { location: '/b' })
        res.end()
      } else {
        jsonHandler(req, res, u)
      }
    })
    const calls = []
    await fetchJsonLimited(`http://127.0.0.1:${s.port}/a`, { timeoutMs: 5000, onRequest: (u) => calls.push(u) })
    assert.deepEqual(calls, [`http://127.0.0.1:${s.port}/a`, `http://127.0.0.1:${s.port}/b`])
  })

  it('两次连续 redirect：调用 3 次，逐跳 URL 按序', async () => {
    const s = await start((req, res, u) => {
      if (u === '/a') {
        res.writeHead(302, { location: '/b' })
        res.end()
      } else if (u === '/b') {
        res.writeHead(302, { location: '/c' })
        res.end()
      } else {
        jsonHandler(req, res, u)
      }
    })
    const calls = []
    await fetchJsonLimited(`http://127.0.0.1:${s.port}/a`, { timeoutMs: 5000, onRequest: (u) => calls.push(u) })
    assert.deepEqual(calls, [
      `http://127.0.0.1:${s.port}/a`,
      `http://127.0.0.1:${s.port}/b`,
      `http://127.0.0.1:${s.port}/c`,
    ])
  })

  it('钩子抛错：该跳 fetch 立即中止、错误上抛、服务器零命中', async () => {
    const s = await start(jsonHandler)
    await assert.rejects(
      () =>
        fetchJsonLimited(`http://127.0.0.1:${s.port}/x`, {
          timeoutMs: 5000,
          onRequest: () => {
            throw new Error('budget-exhausted')
          },
        }),
      (err) => err.message === 'budget-exhausted',
    )
    assert.equal(s.hits(), 0)
  })
})

// ---------- M2 Task 4：describeFetchFailure 三要素 ----------

describe('describeFetchFailure（M2 Task 4）', () => {
  it('① 四形态原因段：AbortError/超时/HTTP n/安全化根因', async () => {
    const { describeFetchFailure, HttpError: HttpErr } = await import('../lib/core/httpx.js')
    const abort = new Error('This operation was aborted')
    abort.name = 'AbortError'
    const timeout = new Error('The operation was timed out')
    timeout.name = 'TimeoutError'
    const http = new HttpErr(502, 'HTTP 502')
    const other = new Error('响应超过上限 2097152 字节')
    const a = describeFetchFailure({ label: '线路一', err: abort, elapsedMs: 1500 })
    assert.ok(a.startsWith('线路一 失败：请求被取消'), a)
    assert.ok(a.includes('耗时 1.5s'))
    assert.ok(a.endsWith('；可稍后重试或检查网络后重试'))
    const t = describeFetchFailure({ label: '线路一', err: timeout })
    assert.ok(t.includes('请求超时'), t)
    const h = describeFetchFailure({ label: '线路二', err: http, attempts: 2, elapsedMs: 3000 })
    assert.ok(h.includes('HTTP 502'), '502 根因词保留')
    assert.ok(h.includes('2 次尝试，耗时 3.0s'))
    const o = describeFetchFailure({ label: '线路二', err: other })
    assert.ok(o.includes('响应超过上限'), '其余保留安全化根因')
  })

  it('无 attempts/elapsedMs → 不带代价段', async () => {
    const { describeFetchFailure } = await import('../lib/core/httpx.js')
    const out = describeFetchFailure({ label: 'L', err: new Error('boom') })
    assert.equal(out, 'L 失败：boom；可稍后重试或检查网络后重试')
  })
})

// ---------- L0：代理感知 dispatcher（ADR-0012 Task 3） ----------

const { request: l0ForwardRequest } = await import('node:http')
const { default: l0Net } = await import('node:net')

const L0_ENV_KEYS = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'npm_config_https_proxy', 'npm_config_proxy']

async function withL0Env(overrides, fn) {
  const saved = new Map()
  for (const k of L0_ENV_KEYS) saved.set(k, process.env[k])
  const httpx = await import('../lib/core/httpx.js')
  try {
    for (const k of L0_ENV_KEYS) delete process.env[k]
    for (const [k, v] of Object.entries(overrides)) process.env[k] = v
    httpx.resetProxyAgentsForTests()
    return await fn()
  } finally {
    for (const [k, v] of saved.entries()) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    httpx.resetProxyAgentsForTests()
  }
}

/** CONNECT 中继代理：实证 undici EnvHttpProxyAgent 对一切目标（含 http）走 CONNECT；
 * 收到 CONNECT 即计数，回 200 后在客户端与目标端口间裸中继字节（真·代理语义）。 */
async function startForwardProxy() {
  let hits = 0
  const server = createServer((req, res) => {
    hits += 1
    res.writeHead(405)
    res.end('unexpected absolute-form request')
  })
  server.on('connect', (req, socket, head) => {
    hits += 1
    const idx = req.url.lastIndexOf(':')
    const host = req.url.slice(0, idx)
    const port = Number(req.url.slice(idx + 1)) || 443
    const conn = l0Net.connect(port, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head?.length) conn.write(head)
      conn.pipe(socket)
      socket.pipe(conn)
    })
    conn.on('error', () => socket.destroy())
    socket.on('error', () => conn.destroy())
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const handle = { port: server.address().port, hits: () => hits, close: () => new Promise((r) => server.close(r)) }
  servers.push(handle)
  return handle
}

describe('resolveProxyConfig（L0 ADR-0012）', () => {
  it('HTTPS_PROXY 压过 npm_config_https_proxy；小写拼写可识别（Windows 大小写同键，跨拼写优先级由 undici 语义保证）', async () => {
    const { resolveProxyConfig } = await import('../lib/core/httpx.js')
    await withL0Env({ HTTPS_PROXY: 'http://b:1', npm_config_https_proxy: 'http://c:1' }, () => {
      assert.equal(resolveProxyConfig().https, 'http://b:1')
    })
    await withL0Env({ https_proxy: 'http://a:1' }, () => {
      assert.equal(resolveProxyConfig().https, 'http://a:1')
    })
  })
  it('空串视为未设；无 scheme 补 http://', async () => {
    const { resolveProxyConfig } = await import('../lib/core/httpx.js')
    await withL0Env({ https_proxy: '   ' }, () => {
      assert.equal(resolveProxyConfig().https, null)
    })
    await withL0Env({ http_proxy: '127.0.0.1:7890' }, () => {
      assert.equal(resolveProxyConfig().http, 'http://127.0.0.1:7890')
    })
  })
  it('仅 npm_config_https_proxy 也生效（undici 不读 npm 命名空间，解析层兜底）', async () => {
    const { resolveProxyConfig } = await import('../lib/core/httpx.js')
    await withL0Env({ npm_config_https_proxy: 'http://d:2' }, () => {
      assert.equal(resolveProxyConfig().https, 'http://d:2')
    })
  })
})

describe('fetchLimited 经代理转发（L0 ADR-0012）', () => {
  it('http_proxy 指向转发代理：请求经代理到达目标，代理命中=1', async () => {
    const { fetchJsonLimited } = await import('../lib/core/httpx.js')
    const target = await start((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ via: 'target' }))
    })
    const proxy = await startForwardProxy()
    await withL0Env({ http_proxy: `http://127.0.0.1:${proxy.port}` }, async () => {
      const data = await fetchJsonLimited(`http://127.0.0.1:${target.port}/x`, { timeoutMs: 5000 })
      assert.equal(data.via, 'target')
      assert.equal(proxy.hits(), 1)
      assert.equal(target.hits(), 1)
    })
  })

  it('仅 npm_config_proxy 设置同样走代理（显式交接证据，R1-5）', async () => {
    const { fetchJsonLimited } = await import('../lib/core/httpx.js')
    const target = await start((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: 1 }))
    })
    const proxy = await startForwardProxy()
    await withL0Env({ npm_config_proxy: `http://127.0.0.1:${proxy.port}` }, async () => {
      const data = await fetchJsonLimited(`http://127.0.0.1:${target.port}/y`, { timeoutMs: 5000 })
      assert.equal(data.ok, 1)
      assert.equal(proxy.hits(), 1)
    })
  })

  it('网络失败错误附 via=掩码代理 URL（Task 3 ④）', async () => {
    const { fetchLimited } = await import('../lib/core/httpx.js')
    await withL0Env({ https_proxy: 'http://user:secret@127.0.0.1:1' }, async () => {
      await assert.rejects(
        fetchLimited('https://registry.npmmirror.com/semver/latest', { timeoutMs: 5000 }),
        (err) => err.via === 'http://***@127.0.0.1:1',
      )
    })
  })

  it('PUT 通路（R1-2 扩面契约钉子）', async () => {
    const { fetchLimited } = await import('../lib/core/httpx.js')
    let seenMethod = ''
    const target = await start((req, res) => {
      seenMethod = req.method
      res.writeHead(200)
      res.end('{}')
    })
    const res = await fetchLimited(`http://127.0.0.1:${target.port}/sync`, { method: 'PUT', timeoutMs: 5000 })
    assert.equal(res.status, 200)
    assert.equal(seenMethod, 'PUT')
  })
})
