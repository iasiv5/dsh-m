/**
 * Task 1：严格 v1 schema、地址解析、容量边界与 registrySummary 契约。
 * 运行：npm run build && node --test tests/registry.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync, symlinkSync, existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'node:http'

import {
  CATEGORIES,
  MAX_REGISTRY_BYTES,
  MAX_PLUGINS,
  commitActiveSource,
  loadDefaultRegistry,
  loadRegistry,
  loadRegistryCandidate,
  parseRegistryAddress,
  readRegistryFile,
  registrySummary,
  validateRegistry,
} from '../lib/core/registry.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function entry(overrides = {}) {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    description: 'A test plugin',
    category: 'tools',
    tags: ['test'],
    source: 'npm',
    npm: 'test-plugin',
    ...overrides,
  }
}

function reg(plugins, extra = {}) {
  return { version: 1, plugins, ...extra }
}

function validateOrThrow(raw) {
  // parseRegistryAddress 契约是“非法即 throw”；这里帮地址测试收敛断言
  return raw
}

describe('MAX 常量', () => {
  it('2 MiB 字节上限与 1,000 条上限', () => {
    assert.equal(MAX_REGISTRY_BYTES, 2 * 1024 * 1024)
    assert.equal(MAX_PLUGINS, 1000)
  })
})

describe('validateRegistry：官方清单', () => {
  it('当前 registry.json 通过严格校验', () => {
    const raw = JSON.parse(readFileSync(join(ROOT, 'registry.json'), 'utf8'))
    const parsed = validateRegistry(raw)
    assert.equal(parsed.ok, true, parsed.errors.join('; '))
    assert.ok(parsed.registry)
    assert.equal(parsed.registry.plugins.length, 12)
  })
})

describe('validateRegistry：顶层结构', () => {
  it('拒绝 null / 数组 / 标量根', () => {
    for (const bad of [null, [], 'x', 42]) {
      const parsed = validateRegistry(bad)
      assert.equal(parsed.ok, false)
      assert.equal(parsed.registry, null)
    }
  })
  it('version 缺失或非 1 拒绝', () => {
    for (const v of [undefined, 2, '1', null]) {
      const parsed = validateRegistry({ version: v, plugins: [] })
      assert.equal(parsed.ok, false)
      assert.ok(parsed.errors.join().includes('version'))
    }
  })
  it('plugins 缺失或非数组拒绝', () => {
    for (const p of [undefined, {}, 'x']) {
      const parsed = validateRegistry({ version: 1, plugins: p })
      assert.equal(parsed.ok, false)
      assert.ok(parsed.errors.join().includes('plugins'))
    }
  })
  it('顶层未知字段拒绝并给出字段路径', () => {
    const parsed = validateRegistry({ version: 1, plugins: [], sources: 'x' })
    assert.equal(parsed.ok, false)
    assert.ok(parsed.errors.join().includes('sources'))
  })
})

describe('validateRegistry：条目字段', () => {
  it('合法条目通过，且输出使用 trim 后的值', () => {
    const parsed = validateRegistry(reg([entry({
      id: '  test-plugin  ',
      name: '  Padded Name  ',
      description: '  Padded desc  ',
      tags: ['  alpha  ', 'beta'],
      npm: '  test-plugin  ',
      homepage: '  https://example.com  ',
    })]))
    assert.equal(parsed.ok, true, parsed.errors.join('; '))
    const e = parsed.registry.plugins[0]
    assert.equal(e.id, 'test-plugin')
    assert.equal(e.name, 'Padded Name')
    assert.equal(e.description, 'Padded desc')
    assert.deepEqual(e.tags, ['alpha', 'beta'])
    assert.equal(e.npm, 'test-plugin')
    assert.equal(e.homepage, 'https://example.com')
  })

  it('条目未知字段拒绝并指向 plugins[i].key', () => {
    const parsed = validateRegistry(reg([entry({ extra: 1 })]))
    assert.equal(parsed.ok, false)
    assert.ok(parsed.errors.some((e) => e.includes('plugins[0].extra')))
  })

  it('条目不是对象拒绝', () => {
    const parsed = validateRegistry(reg(['nope', null]))
    assert.equal(parsed.ok, false)
    assert.ok(parsed.errors.join().includes('plugins[0]'))
    assert.ok(parsed.errors.join().includes('plugins[1]'))
  })

  it('必需字段 id/name/description/category/tags/source 缺失逐一拒绝', () => {
    for (const key of ['id', 'name', 'description', 'category', 'tags', 'source']) {
      const item = entry()
      delete item[key]
      const parsed = validateRegistry(reg([item]))
      assert.equal(parsed.ok, false, `缺少 ${key} 应拒绝`)
      assert.ok(parsed.errors.join().includes(`.${key}`), `错误应包含 plugins[0].${key}`)
    }
  })

  it('name/description 超限拒绝：100/500 通过，101/501 拒绝', () => {
    assert.equal(validateRegistry(reg([entry({ name: 'a'.repeat(100) })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ name: 'a'.repeat(101) })])).ok, false)
    assert.equal(validateRegistry(reg([entry({ description: 'a'.repeat(500) })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ description: 'a'.repeat(501) })])).ok, false)
  })

  it('id 规则：小写开头、字符集与 64 上限', () => {
    assert.equal(validateRegistry(reg([entry({ id: 'a' })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ id: '1abc' })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ id: 'a-b_c.d9' })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ id: 'a'.repeat(64) })])).ok, true)
    for (const bad of ['Foo', 'ABC', '-abc', '.abc', '_abc', 'a b', 'a/b', 'a: b', 'a'.repeat(65), '']) {
      assert.equal(validateRegistry(reg([entry({ id: bad })])).ok, false, `id=${JSON.stringify(bad)} 应拒绝`)
    }
  })

  it('重复 id 拒绝', () => {
    const parsed = validateRegistry(reg([entry(), entry()]))
    assert.equal(parsed.ok, false)
    assert.ok(parsed.errors.join().includes('重复'))
  })

  it('category 必须在枚举内', () => {
    for (const c of CATEGORIES) assert.equal(validateRegistry(reg([entry({ category: c })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ category: 'nope' })])).ok, false)
  })

  it('tags：数组、字符串元素、非空、去重、10/30 上限', () => {
    assert.equal(validateRegistry(reg([entry({ tags: [] })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ tags: Array.from({ length: 10 }, (_, i) => `t${i}`) })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })])).ok, false)
    assert.equal(validateRegistry(reg([entry({ tags: ['x'.repeat(30)] })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ tags: ['x'.repeat(31)] })])).ok, false)
    assert.equal(validateRegistry(reg([entry({ tags: ['dup', 'dup'] })])).ok, false)
    assert.equal(validateRegistry(reg([entry({ tags: ['ok', ''] })])).ok, false)
    assert.equal(validateRegistry(reg([entry({ tags: ['ok', 42] })])).ok, false)
    assert.equal(validateRegistry(reg([entry({ tags: 'nope' })])).ok, false)
  })

  it('错误条目不会被部分加载：任一条目失败 → registry 为 null', () => {
    const parsed = validateRegistry(reg([entry({ id: 'good-one' }), entry({ id: 'BAD' })]))
    assert.equal(parsed.ok, false)
    assert.equal(parsed.registry, null)
  })
})

describe('validateRegistry：source 联动与 npm/GitHub 名称', () => {
  it('source=npm 必须带合法 npm 名；github 名可作元数据', () => {
    assert.equal(validateRegistry(reg([entry({ npm: undefined })])).ok, false)
    assert.equal(validateRegistry(reg([entry({ npm: '' })])).ok, false)
    assert.equal(validateRegistry(reg([entry({ source: 'github', npm: undefined, github: 'iasiv5/dsh-m' })])).ok, true)
  })

  it('source=github 必须带合法 owner/repo；npm 名可作元数据', () => {
    const base = { source: 'github', npm: undefined }
    assert.equal(validateRegistry(reg([entry({ ...base, github: 'iasiv5/dsh-m' })])).ok, true)
    for (const bad of [undefined, '', 'owner', 'owner/', '/repo', 'ow ner/repo', 'owner/repo/x']) {
      assert.equal(validateRegistry(reg([entry({ ...base, github: bad })])).ok, false, `github=${JSON.stringify(bad)} 应拒绝`)
    }
  })

  it('npm 名：scoped/unscoped 合法边界与 214 上限', () => {
    assert.equal(validateRegistry(reg([entry({ npm: 'a' })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ npm: 'a0._~b' })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ npm: '@inventec/dsh-copilot-auth' })])).ok, true)
    const scoped214 = `@${'a'.repeat(105)}/${'b'.repeat(107)}`
    assert.equal(scoped214.length, 214)
    assert.equal(validateRegistry(reg([entry({ npm: scoped214 })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ npm: `${scoped214}c` })])).ok, false)
    for (const bad of ['Dsh-Skins', 'dsh skins', 'dsh@1.2.3', 'https://registry.npmjs.org/x', 'dsh/skins', '@Scope/x', '@scope/', '-lead', '.dot', '_u', 'a^b']) {
      assert.equal(validateRegistry(reg([entry({ npm: bad })])).ok, false, `npm=${JSON.stringify(bad)} 应拒绝`)
    }
  })

  it('GitHub owner ≤39、repo ≤100、整体 ≤140', () => {
    assert.equal(validateRegistry(reg([entry({ source: 'github', npm: undefined, github: `${'a'.repeat(39)}/${'b'.repeat(100)}` })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ source: 'github', npm: undefined, github: `${'a'.repeat(40)}/${'b'.repeat(100)}` })])).ok, false)
    assert.equal(validateRegistry(reg([entry({ source: 'github', npm: undefined, github: `${'a'.repeat(39)}/${'b'.repeat(101)}` })])).ok, false)
    assert.equal(validateRegistry(reg([entry({ source: 'github', npm: undefined, github: 'iasiv5/DSH-M' })])).ok, true)
  })

  it('source 值只允许 npm/github', () => {
    for (const bad of [undefined, '', 'git', 'npm ', 'NPM']) {
      assert.equal(validateRegistry(reg([entry({ source: bad })])).ok, false, `source=${JSON.stringify(bad)} 应拒绝`)
    }
  })
})

describe('validateRegistry：homepage/icon URL', () => {
  it('只接受无 userinfo 的 HTTPS，≤2,048 字符', () => {
    assert.equal(validateRegistry(reg([entry({ homepage: 'https://example.com' })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ icon: 'https://example.com/i.png' })])).ok, true)
    for (const bad of [
      'http://example.com',
      'ftp://example.com/i.png',
      'javascript:alert(1)',
      'https://user:pass@example.com',
      'https://u@example.com',
      `https://example.com/${'a'.repeat(2049)}`,
      'https://example.com/a\nb',
      'not a url',
    ]) {
      assert.equal(validateRegistry(reg([entry({ homepage: bad })])).ok, false, `homepage=${JSON.stringify(bad.slice(0, 30))} 应拒绝`)
    }
  })

  it('2,048 字符恰好通过，2,049 拒绝', () => {
    const base = 'https://example.com/'
    assert.equal(validateRegistry(reg([entry({ homepage: base + 'a'.repeat(2048 - base.length) })])).ok, true)
    assert.equal(validateRegistry(reg([entry({ homepage: base + 'a'.repeat(2049 - base.length) })])).ok, false)
  })
})

describe('validateRegistry：容量边界', () => {
  it('1,000 条通过，1,001 条拒绝且不截断', () => {
    const thousand = Array.from({ length: 1000 }, (_, i) => entry({ id: `p-${i}`, npm: `pkg-${i}` }))
    const okParsed = validateRegistry(reg(thousand))
    assert.equal(okParsed.ok, true, okParsed.errors.slice(0, 3).join('; '))
    assert.equal(okParsed.registry.plugins.length, 1000)
    const tooMany = validateRegistry(reg([...thousand, entry({ id: 'p-1000', npm: 'pkg-1000' })]))
    assert.equal(tooMany.ok, false)
    assert.equal(tooMany.registry, null)
    assert.ok(tooMany.errors.join().includes('1000'))
  })
})

describe('parseRegistryAddress', () => {
  it('空 / undefined → default', () => {
    for (const raw of [undefined, '', '   ']) {
      const addr = parseRegistryAddress(raw)
      assert.equal(addr.kind, 'default')
      assert.equal(addr.normalized, '')
      assert.equal(addr.cacheKey, 'default')
    }
  })

  it('HTTPS URL：trim、去 fragment、保留 query', () => {
    const addr = parseRegistryAddress('  https://Example.com/r.json?ref=main#frag  ')
    assert.equal(addr.kind, 'url')
    assert.equal(addr.normalized, 'https://example.com/r.json?ref=main')
    assert.ok(!addr.normalized.includes('#'))
  })

  it('cacheKey 稳定、可区分且文件系统安全', () => {
    const a = parseRegistryAddress('https://example.com/a.json')
    const b = parseRegistryAddress('https://example.com/a.json')
    const c = parseRegistryAddress('https://example.com/b.json')
    assert.equal(a.cacheKey, b.cacheKey)
    assert.notEqual(a.cacheKey, c.cacheKey)
    for (const key of [a.cacheKey, c.cacheKey]) {
      assert.match(key, /^[A-Za-z0-9._-]+$/)
    }
    const f1 = parseRegistryAddress('/tmp/a.json')
    const f2 = parseRegistryAddress('file:///tmp/a.json')
    assert.equal(f1.cacheKey, f2.cacheKey)
  })

  it('loopback HTTP 允许，非 loopback HTTP 拒绝', () => {
    assert.equal(parseRegistryAddress('http://127.0.0.1:8080/r.json').kind, 'url')
    assert.equal(parseRegistryAddress('http://localhost/r.json').kind, 'url')
    assert.equal(parseRegistryAddress('http://[::1]/r.json').kind, 'url')
    for (const bad of ['http://192.168.1.5/r.json', 'http://example.com/r.json', 'http://0.0.0.0/r.json']) {
      assert.throws(() => parseRegistryAddress(bad))
    }
  })

  it('非 HTTPS/HTTP 协议拒绝', () => {
    for (const bad of ['ftp://example.com/r.json', 'javascript:alert(1)', 'data:text/plain,x', 'C:\\Users\\r.json']) {
      assert.throws(() => parseRegistryAddress(bad), `协议 ${bad} 应拒绝`)
    }
  })

  it('userinfo 拒绝', () => {
    for (const bad of ['https://user:pass@example.com/r.json', 'https://u@example.com/r.json']) {
      assert.throws(() => parseRegistryAddress(bad))
    }
  })

  it('已知凭据 query key 拒绝，普通 query 保留', () => {
    for (const key of ['token', 'access_token', 'api_key', 'password', 'secret', 'Token', 'API_KEY']) {
      assert.throws(() => parseRegistryAddress(`https://example.com/r.json?${key}=x`), `凭据 query ${key} 应拒绝`)
    }
    const addr = parseRegistryAddress('https://example.com/r.json?ref=main&mirror=1')
    assert.ok(addr.normalized.includes('ref=main'))
  })

  it('控制字符拒绝（外层空白先被 trim，不视为控制字符）', () => {
    assert.throws(() => parseRegistryAddress('ht\u0002tps://example.com/r.json'))
    assert.throws(() => parseRegistryAddress('https://exa\u0000mple.com/r.json'))
    assert.throws(() => parseRegistryAddress('/tmp/r.jso\u0000n'))
    assert.equal(parseRegistryAddress('https://example.com/r.json\n').kind, 'url')
  })

  it('本地绝对路径与 file:// 都解析为 file', () => {
    const a = parseRegistryAddress('/home/user/r.json')
    assert.equal(a.kind, 'file')
    assert.equal(a.normalized, '/home/user/r.json')
    const b = parseRegistryAddress('file:///home/user/r.json')
    assert.equal(b.kind, 'file')
    assert.equal(b.normalized, '/home/user/r.json')
    const c = parseRegistryAddress('/home/user/../user/./r.json')
    assert.equal(c.normalized, '/home/user/r.json')
    const d = parseRegistryAddress('file:///home/u%20ser/r.json')
    assert.equal(d.normalized, '/home/u ser/r.json')
  })

  it('file URL 携带 host、相对路径、目录路径、空路径拒绝', () => {
    for (const bad of [
      'file://host/path/r.json',
      'registry.json',
      './r.json',
      '~/r.json',
      'file://',
      'file:///',
      'file:///home/user/',
      '/home/user/',
      'home/r.json',
    ]) {
      assert.throws(() => parseRegistryAddress(bad), `地址 ${bad} 应拒绝`)
    }
  })

  it('file://localhost 按 WHATWG 归一化为空 host，等同 file:///', () => {
    const addr = parseRegistryAddress('file://localhost/home/r.json')
    assert.equal(addr.kind, 'file')
    assert.equal(addr.normalized, '/home/r.json')
  })
})

describe('registrySummary', () => {
  it('只返回 isDefault/status/stale', () => {
    const summary = registrySummary({
      configuredAddress: '',
      activeAddress: null,
      source: 'default-cache',
      status: 'stale',
      isDefault: true,
      stale: true,
      fetchedAt: '2026-09-04T00:00:00.000Z',
      errors: [],
      count: 10,
      registry: { version: 1, plugins: [] },
    })
    assert.deepEqual(summary, { isDefault: true, status: 'stale', stale: true })
  })
})

// ---------- Task 2：loader、本地 fd 读取与分源 cache ----------

let cacheRoot = ''
function setCacheDir() {
  cacheRoot = mkdtempSync(join(tmpdir(), 'dshm-reg-'))
  process.env.DSHM_CACHE_DIR = cacheRoot
}
function nsDir(ns) {
  return join(cacheRoot, ns)
}
function cacheFile(ns, key) {
  return join(nsDir(ns), `${key}.json`)
}
function writeCacheFixture(ns, key, registry, extra = {}) {
  mkdirSync(nsDir(ns), { recursive: true })
  writeFileSync(cacheFile(ns, key), JSON.stringify({
    version: 2,
    namespace: ns,
    cacheKey: key,
    configuredAddress: extra.configuredAddress ?? '',
    activeAddress: extra.activeAddress ?? null,
    source: extra.source ?? 'custom-url',
    fetchedAt: extra.fetchedAt ?? new Date().toISOString(),
    registry,
  }, null, 2))
}
function writeLocalRegistry(file, plugins) {
  writeFileSync(file, JSON.stringify({ version: 1, plugins }, null, 2))
  return file
}
function localEntry(i) {
  return entry({ id: `local-${i}`, npm: `local-pkg-${i}` })
}

async function startRegistryServer() {
  const hits = { count: 0 }
  const server = createServer((req, res) => {
    hits.count += 1
    const u = req.url || '/'
    if (u === '/a.json' || u === '/b.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(reg([localEntry(u === '/a.json' ? 1 : 2)])))
    } else {
      res.writeHead(500)
      res.end()
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() || { port: 0 }).port
  return {
    port,
    hits,
    url: (p) => `http://127.0.0.1:${port}${p}`,
    close: () =>
      new Promise((r) => {
        // 先断掉 keep-alive 连接，确保 close 之后新请求确实失败
        server.closeAllConnections()
        server.close(() => r())
      }),
  }
}

async function getDeadPort() {
  const server = createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() || { port: 0 }).port
  await new Promise((r) => server.close(r))
  return port
}

let server
beforeEach(() => {
  setCacheDir()
})
afterEach(async () => {
  if (server) {
    await server.close()
    server = undefined
  }
  delete process.env.DSHM_CACHE_DIR
  if (cacheRoot) rmSync(cacheRoot, { recursive: true, force: true })
})

describe('Task 2：本地文件加载', () => {
  it('绝对路径与 file:// 都加载为 custom-file', async () => {
    const file = writeLocalRegistry(join(cacheRoot, 'local.json'), [localEntry(1), localEntry(2)])
    const loaded = await loadRegistry({ registryUrl: file }, { force: true })
    assert.equal(loaded.status, 'ready')
    assert.equal(loaded.source, 'custom-file')
    assert.equal(loaded.isDefault, false)
    assert.equal(loaded.count, 2)
    assert.equal(loaded.activeAddress, file)

    const viaUrl = await loadRegistry({ registryUrl: `file://${file}` }, { force: true })
    assert.equal(viaUrl.status, 'ready')
    assert.equal(viaUrl.source, 'custom-file')
    assert.equal(parseRegistryAddress(file).cacheKey, parseRegistryAddress(`file://${file}`).cacheKey)
  })

  it('非法/缺失 custom 文件返回空 registry + unavailable，不出现官方条目', async () => {
    const bad = join(cacheRoot, 'bad.json')
    writeFileSync(bad, JSON.stringify({ version: 1, plugins: [entry({ oops: true })] }))
    for (const url of [bad, join(cacheRoot, 'missing.json')]) {
      const loaded = await loadRegistry({ registryUrl: url }, { force: true })
      assert.equal(loaded.status, 'unavailable')
      assert.equal(loaded.source, 'custom-unavailable')
      assert.equal(loaded.registry.plugins.length, 0)
      assert.ok(loaded.errors.length > 0)
    }
  })

  it('2 MiB 精确通过、2 MiB+1 拒绝（本地文件）', async () => {
    // 700 条接近上限的条目（homepage 2020 字符 + description 500）→ 略低于 2 MiB，
    // 差额用合法 JSON 空白精确补齐到 MAX_REGISTRY_BYTES
    const plugins = Array.from({ length: 700 }, (_, i) => entry({
      id: `pad-${i}`,
      npm: `pad-pkg-${i}`,
      name: 'n'.repeat(100),
      description: 'x'.repeat(500),
      homepage: `https://example.com/${'a'.repeat(2000)}`,
    }))
    const base = JSON.stringify({ version: 1, plugins }, null, 2)
    const deficit = MAX_REGISTRY_BYTES - Buffer.byteLength(base, 'utf8')
    assert.ok(deficit > 0, `基础文档应低于 2 MiB，实际超出 ${-deficit}`)
    const text = base.slice(0, base.lastIndexOf('}')) + ' '.repeat(deficit) + '}'
    assert.equal(Buffer.byteLength(text, 'utf8'), MAX_REGISTRY_BYTES)
    const file = join(cacheRoot, 'exact.json')
    writeFileSync(file, text)
    const okParsed = validateRegistry(JSON.parse(text))
    assert.equal(okParsed.ok, true, okParsed.errors.slice(0, 2).join('; '))
    const okLoaded = await loadRegistry({ registryUrl: file }, { force: true })
    assert.equal(okLoaded.status, 'ready', okLoaded.errors.join('; '))

    // +1 拒绝：换一个路径（不同 cacheKey），避免回退到上一案例的合法 cache
    const bigFile = join(cacheRoot, 'exact-plus.json')
    writeFileSync(bigFile, text + ' ')
    const tooBig = await loadRegistry({ registryUrl: bigFile }, { force: true })
    assert.equal(tooBig.status, 'unavailable')
    assert.ok(tooBig.errors.join().includes('上限'))
  })

  it('stat 后文件增长被 fd 复核拒绝（可控 fixture）', async () => {
    const file = join(cacheRoot, 'grow.json')
    writeFileSync(file, 'x'.repeat(MAX_REGISTRY_BYTES - 5))
    await assert.rejects(
      () => readRegistryFile(file, { afterStat: () => { writeFileSync(file, 'x'.repeat(MAX_REGISTRY_BYTES + 5)) } }),
      (err) => /上限|超过/.test(err instanceof Error ? err.message : String(err)),
    )
  })
})

describe('Task 2：远程加载与 cache 回退', () => {
  it('loopback HTTP registry 可加载，记录最终 URL', async () => {
    server = await startRegistryServer()
    const loaded = await loadRegistry({ registryUrl: server.url('/a.json') }, { force: true })
    assert.equal(loaded.status, 'ready')
    assert.equal(loaded.source, 'custom-url')
    assert.equal(loaded.activeAddress, server.url('/a.json'))
    assert.equal(loaded.count, 1)
  })

  it('custom 失败回退同源 cache（stale），无 cache 才 unavailable', async () => {
    server = await startRegistryServer()
    const url = server.url('/a.json')
    const first = await loadRegistry({ registryUrl: url }, { force: true })
    assert.equal(first.status, 'ready')
    await server.close()

    const stale = await loadRegistry({ registryUrl: url }, { force: true })
    assert.equal(stale.status, 'stale')
    assert.equal(stale.source, 'custom-cache')
    assert.equal(stale.count, 1)

    const deadPort = await getDeadPort()
    const fresh = await loadRegistry({ registryUrl: `http://127.0.0.1:${deadPort}/a.json` }, { force: true })
    assert.equal(fresh.status, 'unavailable')
    assert.equal(fresh.registry.plugins.length, 0)
  })

  it('force 绕过 TTL，普通读取遵循 cacheTtlMin', async () => {
    server = await startRegistryServer()
    const url = server.url('/a.json')
    await loadRegistry({ registryUrl: url }, { force: true })
    assert.equal(server.hits.count, 1)
    const cached = await loadRegistry({ registryUrl: url, cacheTtlMin: 60 }, {})
    assert.equal(cached.status, 'stale')
    assert.equal(server.hits.count, 1, 'TTL 内不应发起网络请求')
    await loadRegistry({ registryUrl: url }, { force: true })
    assert.equal(server.hits.count, 2)
  })

  it('candidate 只写候选 cache，绝不 prune 旧 source', async () => {
    server = await startRegistryServer()
    const oldAddr = parseRegistryAddress(server.url('/b.json'))
    writeCacheFixture('host', oldAddr.cacheKey, reg([localEntry(9)]), { configuredAddress: oldAddr.normalized })
    const defAddr = parseRegistryAddress(undefined)
    writeCacheFixture('host', defAddr.cacheKey, reg([localEntry(8)]), { source: 'default-cache' })

    const candidate = await loadRegistryCandidate({ registryUrl: server.url('/a.json') })
    assert.equal(candidate.status, 'ready')
    assert.equal(candidate.source, 'custom-url')
    assert.ok(existsSync(cacheFile('host', oldAddr.cacheKey)), 'candidate 不得删除旧 source cache')
    assert.ok(existsSync(cacheFile('host', defAddr.cacheKey)), 'candidate 不得删除 default cache')
    const newAddr = parseRegistryAddress(server.url('/a.json'))
    assert.ok(existsSync(cacheFile('host', newAddr.cacheKey)), '候选 cache 已写入')
  })

  it('commitActiveSource 之后才清理旧 source，并写入 accepted metadata', async () => {
    server = await startRegistryServer()
    const aAddr = parseRegistryAddress(server.url('/a.json'))
    const bAddr = parseRegistryAddress(server.url('/b.json'))
    writeCacheFixture('host', aAddr.cacheKey, reg([localEntry(1)]), { configuredAddress: aAddr.normalized })
    // B 曾作为候选加载成功过 → 已有候选 cache
    writeCacheFixture('host', bAddr.cacheKey, reg([localEntry(2)]), { configuredAddress: bAddr.normalized })
    const result = await commitActiveSource(bAddr, 'host')
    assert.equal(result.metadataCommitted, true)
    assert.equal(result.pruned, true)
    assert.equal(result.warning, null)
    assert.ok(!existsSync(cacheFile('host', aAddr.cacheKey)), '旧 custom cache 应被清理')
    assert.ok(existsSync(cacheFile('host', bAddr.cacheKey)), '当前 cache 保留')
    const meta = JSON.parse(readFileSync(join(nsDir('host'), 'active-source.json'), 'utf8'))
    assert.equal(meta.version, 1)
    assert.equal(meta.configuredAddress, bAddr.normalized)
    assert.equal(meta.cacheKey, bAddr.cacheKey)
  })

  it('切回已被清理的 A 离线返回 unavailable', async () => {
    server = await startRegistryServer()
    const aUrl = server.url('/a.json')
    const aAddr = parseRegistryAddress(aUrl)
    writeCacheFixture('host', aAddr.cacheKey, reg([localEntry(1)]))
    await commitActiveSource(parseRegistryAddress(server.url('/b.json')), 'host')
    assert.ok(!existsSync(cacheFile('host', aAddr.cacheKey)))
    await server.close()
    const loaded = await loadRegistry({ registryUrl: aUrl }, { force: true })
    assert.equal(loaded.status, 'unavailable')
    assert.equal(loaded.source, 'custom-unavailable')
  })

  it('CLI namespace 与 Host namespace 互不删除', async () => {
    server = await startRegistryServer()
    const aAddr = parseRegistryAddress(server.url('/a.json'))
    writeCacheFixture('host', aAddr.cacheKey, reg([localEntry(1)]))
    writeCacheFixture('cli', aAddr.cacheKey, reg([localEntry(1)]))

    const cliLoad = await loadRegistry({ registryUrl: server.url('/b.json') }, { force: true, namespace: 'cli' })
    assert.equal(cliLoad.status, 'ready')
    assert.ok(existsSync(cacheFile('host', aAddr.cacheKey)), 'host namespace 的 A cache 不得被 CLI 读取删除')
    assert.ok(!existsSync(cacheFile('cli', aAddr.cacheKey)), 'cli namespace 的旧 cache 被清理')
    assert.ok(!existsSync(join(nsDir('cli'), 'active-source.json')), 'cli namespace 不写 accepted metadata')
  })

  it('default 与 custom cache 不串用；旧单文件 cache 与损坏 cache 被忽略', async () => {
    // 旧单文件 cache 写在 cacheDir() 根，新 loader 不读它
    mkdirSync(cacheRoot, { recursive: true })
    writeFileSync(join(cacheRoot, 'registry.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), source: 'raw', registry: reg([localEntry(1)]) }))
    const deadPort = await getDeadPort()
    const loaded = await loadRegistry({ registryUrl: `http://127.0.0.1:${deadPort}/a.json` }, { force: true })
    assert.equal(loaded.status, 'unavailable')
    assert.equal(loaded.source, 'custom-unavailable')

    // 损坏 cache 忽略
    const deadAddr = parseRegistryAddress(`http://127.0.0.1:${deadPort}/a.json`)
    mkdirSync(nsDir('host'), { recursive: true })
    writeFileSync(cacheFile('host', deadAddr.cacheKey), '{broken json')
    const corrupt = await loadRegistry({ registryUrl: deadAddr.normalized }, { force: true })
    assert.equal(corrupt.status, 'unavailable')

    // default TTL 命中走 default cache，不产生 custom cache
    const defAddr = parseRegistryAddress(undefined)
    writeCacheFixture('host', defAddr.cacheKey, reg([localEntry(7)]), { source: 'default-cache' })
    const defLoaded = await loadRegistry({ cacheTtlMin: 60 }, {})
    assert.equal(defLoaded.status, 'stale')
    assert.equal(defLoaded.source, 'default-cache')
    assert.equal(defLoaded.isDefault, true)
    assert.equal(defLoaded.count, 1)
  })

  it('错误 namespace 的 cache 不串读', async () => {
    const deadPort = await getDeadPort()
    const addr = parseRegistryAddress(`http://127.0.0.1:${deadPort}/a.json`)
    writeCacheFixture('cli', addr.cacheKey, reg([localEntry(1)]))
    const loaded = await loadRegistry({ registryUrl: addr.normalized }, { force: true, namespace: 'host' })
    assert.equal(loaded.status, 'unavailable')
  })

  it('cache 目标为 symlink 时拒绝写入，加载本身成功', async () => {
    server = await startRegistryServer()
    const addr = parseRegistryAddress(server.url('/a.json'))
    mkdirSync(nsDir('host'), { recursive: true })
    const target = join(cacheRoot, 'symlink-target.json')
    writeFileSync(target, 'KEEP')
    symlinkSync(target, cacheFile('host', addr.cacheKey))
    const loaded = await loadRegistry({ registryUrl: server.url('/a.json') }, { force: true })
    assert.equal(loaded.status, 'ready')
    assert.ok(existsSync(target))
    assert.equal(readFileSync(target, 'utf8'), 'KEEP')
  })

  it('并发写同一 cache key 不产生半写 JSON', async () => {
    server = await startRegistryServer()
    const url = server.url('/a.json')
    const results = await Promise.all(Array.from({ length: 10 }, () => loadRegistry({ registryUrl: url }, { force: true })))
    assert.ok(results.every((r) => r.status === 'ready'))
    const addr = parseRegistryAddress(url)
    const raw = JSON.parse(readFileSync(cacheFile('host', addr.cacheKey), 'utf8'))
    assert.equal(raw.version, 2)
    assert.equal(raw.registry.plugins.length, 1)
  })

  it('commitActiveSource metadata 失败 → 不 prune、返回 warning、旧 cache 保留', async () => {
    const aAddr = parseRegistryAddress('https://example.com/a.json')
    const bAddr = parseRegistryAddress('https://example.com/b.json')
    writeCacheFixture('host', aAddr.cacheKey, reg([localEntry(1)]))
    // active-source.json 变成目录 → metadata rename 失败
    mkdirSync(nsDir('host'), { recursive: true })
    mkdirSync(join(nsDir('host'), 'active-source.json'), { recursive: true })
    const result = await commitActiveSource(bAddr, 'host')
    assert.equal(result.metadataCommitted, false)
    assert.equal(result.pruned, false)
    assert.ok(result.warning)
    assert.ok(existsSync(cacheFile('host', aAddr.cacheKey)), 'metadata 失败不得 prune')
  })

  it('commitActiveSource prune 失败 → metadata 有效、返回 warning', async () => {
    const aAddr = parseRegistryAddress('https://example.com/a.json')
    const bAddr = parseRegistryAddress('https://example.com/b.json')
    writeCacheFixture('host', aAddr.cacheKey, reg([localEntry(1)]))
    mkdirSync(nsDir('host'), { recursive: true })
    // 不可删除的占位目录（.json 后缀目录）让 prune 失败
    mkdirSync(join(nsDir('host'), 'zz-blocker.json'), { recursive: true })
    mkdirSync(join(nsDir('host'), 'zz-blocker.json', 'inner'))
    const result = await commitActiveSource(bAddr, 'host')
    assert.equal(result.metadataCommitted, true)
    assert.equal(result.pruned, false)
    assert.ok(result.warning)
  })

  it('恢复默认的 commit 会清理 custom cache、保留 default cache', async () => {
    const customAddr = parseRegistryAddress('https://example.com/a.json')
    const defAddr = parseRegistryAddress(undefined)
    writeCacheFixture('host', customAddr.cacheKey, reg([localEntry(1)]))
    writeCacheFixture('host', defAddr.cacheKey, reg([localEntry(2)]), { source: 'default-cache' })
    const result = await commitActiveSource(defAddr, 'host')
    assert.equal(result.metadataCommitted, true)
    assert.equal(result.pruned, true)
    assert.ok(!existsSync(cacheFile('host', customAddr.cacheKey)))
    assert.ok(existsSync(cacheFile('host', defAddr.cacheKey)))
    const meta = JSON.parse(readFileSync(join(nsDir('host'), 'active-source.json'), 'utf8'))
    assert.equal(meta.configuredAddress, '')
  })

  it('loadDefaultRegistry 走 default cache（TTL 内不联网）且从不 prune', async () => {
    const defAddr = parseRegistryAddress(undefined)
    writeCacheFixture('host', defAddr.cacheKey, reg([localEntry(5)]), { source: 'default-cache' })
    const customAddr = parseRegistryAddress('https://example.com/a.json')
    writeCacheFixture('host', customAddr.cacheKey, reg([localEntry(6)]))
    const loaded = await loadDefaultRegistry({ cacheTtlMin: 60 })
    assert.equal(loaded.source, 'default-cache')
    assert.ok(existsSync(cacheFile('host', customAddr.cacheKey)), 'loadDefaultRegistry 不做 prune')
    await rm(cacheFile('host', defAddr.cacheKey))
  })
})
