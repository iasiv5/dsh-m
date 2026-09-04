/**
 * Task 1：严格 v1 schema、地址解析、容量边界与 registrySummary 契约。
 * 运行：npm run build && node --test tests/registry.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  CATEGORIES,
  MAX_REGISTRY_BYTES,
  MAX_PLUGINS,
  parseRegistryAddress,
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
    assert.equal(parsed.registry.plugins.length, 10)
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
