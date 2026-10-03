/**
 * ustar 只读解析器（生效判定 T1）：0.9.22 新增，配合 tests/fixtures/tar-builder.mjs。
 * 运行：npm run build && node --test tests/ustar.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'

import { parseTarEntries } from '../lib/core/ustar.js'
import { buildTar, buildTarGz } from './fixtures/tar-builder.mjs'

describe('parseTarEntries：基础解析', () => {
  it('单文件：名与内容 roundtrip', () => {
    const tar = buildTar([{ name: 'package/lib/index.js', data: 'console.log(1)\n' }])
    const files = parseTarEntries(tar)
    assert.equal(files.size, 1)
    assert.equal(files.get('package/lib/index.js').toString('utf8'), 'console.log(1)\n')
  })

  it('多文件：package/ 前缀原样保留（归一是调用方职责）', () => {
    const tar = buildTar([
      { name: 'package/package.json', data: '{"name":"x"}' },
      { name: 'package/lib/client.js', data: 'a' },
      { name: 'package/lib/host.js', data: 'bb' },
    ])
    const files = parseTarEntries(tar)
    assert.deepEqual([...files.keys()].sort(), ['package/lib/client.js', 'package/lib/host.js', 'package/package.json'])
    assert.equal(files.get('package/lib/host.js').toString(), 'bb')
  })

  it('gzip tarball：解压后同样解析', () => {
    const gz = buildTarGz([{ name: 'package/README.md', data: '# hi' }])
    const files = parseTarEntries(gunzipSync(gz))
    assert.equal(files.get('package/README.md').toString(), '# hi')
  })

  it('目录项跳过（不进 Map）', () => {
    const tar = buildTar([
      { name: 'package/lib', type: 'dir' },
      { name: 'package/lib/x.js', data: 'x' },
    ])
    const files = parseTarEntries(tar)
    assert.deepEqual([...files.keys()], ['package/lib/x.js'])
  })

  it('无尾部零块的截短流（buffer 尽头）正常终止', () => {
    const full = buildTar([{ name: 'package/a.js', data: 'a' }])
    const noEnd = full.subarray(0, full.length - 1024)
    const files = parseTarEntries(noEnd)
    assert.equal(files.get('package/a.js').toString(), 'a')
  })
})

describe('parseTarEntries：长文件名', () => {
  const longName = `package/${'深/'.repeat(60)}client.js`

  it('pax 扩展头（x + path=）恢复完整路径', () => {
    const tar = buildTar([{ name: longName, data: 'pax', pax: true }])
    const files = parseTarEntries(tar)
    assert.equal(files.size, 1, '截断名条目不应单独出现')
    assert.equal(files.get(longName).toString(), 'pax')
  })

  it('GNU L 长名恢复完整路径', () => {
    const tar = buildTar([{ name: longName, data: 'gnu', gnuLong: true }])
    const files = parseTarEntries(tar)
    assert.equal(files.size, 1)
    assert.equal(files.get(longName).toString(), 'gnu')
  })

  it('g 全局扩展头跳过（不影响后续条目）', () => {
    // g 条目 = 头 + 携带内容的负载；builder 不产 g，手写一个合法 g 头，再接正常文件
    const filePart = buildTar([{ name: 'package/a.js', data: 'a' }])
    const gContent = Buffer.from('20 comment=hello\n', 'utf8')
    const gBlock = Buffer.alloc(512, 0)
    gBlock.write('./PyGlobalHeader', 0, 'utf8')
    gBlock.write(octalOf(gContent.length), 124, 'utf8')
    gBlock.write('g', 156, 'utf8')
    gBlock.write('ustar\0', 257, 'utf8')
    gBlock.write('00', 263, 'utf8')
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : gBlock[i]
    gBlock.write(octalOf(sum), 148, 'utf8')
    const pad = (512 - (gContent.length % 512)) % 512
    const tar = Buffer.concat([gBlock, gContent, Buffer.alloc(pad, 0), filePart])
    const files = parseTarEntries(tar)
    assert.deepEqual([...files.keys()], ['package/a.js'])
  })
})

describe('parseTarEntries：损坏输入抛错（fail-open 由调用方承接）', () => {
  it('截断的条目内容 → throw', () => {
    const full = buildTar([{ name: 'package/a.js', data: 'x'.repeat(1024) }])
    // 头(512) + 内容(1024)：切到 1200 处，content 在 1536 处才完整 → 必截断
    assert.throws(() => parseTarEntries(full.subarray(0, 1200)), /截断|tar/)
  })

  it('坏 size 字段（非八进制）→ throw', () => {
    const tar = buildTar([{ name: 'package/a.js', data: 'a' }])
    tar.write('zzzzzzz\0\0\0\0', 124, 'utf8')
    assert.throws(() => parseTarEntries(tar), /size|tar/)
  })

  it('头字段被改动（校验和不符）→ throw', () => {
    const tar = buildTar([{ name: 'package/a.js', data: 'a' }])
    tar[42] = tar[42] ^ 0xff
    assert.throws(() => parseTarEntries(tar), /校验和/)
  })
})

function octalOf(value) {
  // 校验和字段共 8 字节：6 位八进制 + NUL（其余留白），严防越界覆盖 typeflag@156
  return value.toString(8).padStart(6, '0') + '\0'
}

describe('parseTarEntries：pendingName 不跨条目泄漏（评审问题 5 回归）', () => {
  function paxRecordOf(key, value) {
    const payload = `${key}=${value}\n`
    let total = payload.length + 2
    for (;;) {
      const next = payload.length + String(total).length + 1
      if (next === total) break
      total = next
    }
    return `${total} ${payload}`
  }

  function rawHeader(name, size, typeflag) {
    const b = Buffer.alloc(512, 0)
    b.write(name.slice(0, 100), 0, 'utf8')
    b.write('0000644', 100, 'utf8')
    b.write('0000000', 108, 'utf8')
    b.write('0000000', 116, 'utf8')
    b.write(octalOf(size), 124, 'utf8')
    b.write(octalOf(0), 136, 'utf8')
    b.write(typeflag, 156, 'utf8')
    b.write('ustar\0', 257, 'utf8')
    b.write('00', 263, 'utf8')
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : b[i]
    b.write(octalOf(sum), 148, 'utf8')
    return b
  }

  function padTo(data) {
    const pad = (512 - (data.length % 512)) % 512
    return Buffer.concat([data, Buffer.alloc(pad, 0)])
  }

  it('pax 长名只属于紧贴条目：后跟目录时被弃用（防泄漏错配）', () => {
    const longName = `package/${'x/'.repeat(60)}orphan.js`
    const paxPayload = Buffer.from(paxRecordOf('path', longName), 'utf8')
    const tar = Buffer.concat([
      rawHeader('././@PaxHeader', paxPayload.length, 'x'), padTo(paxPayload),
      rawHeader('package/lib', 0, '5'), // 目录条目：消费/清除 pendingName
      rawHeader('package/lib/real.js', 1, '0'), padTo(Buffer.from('r', 'utf8')),
      Buffer.alloc(1024, 0),
    ])
    const files = parseTarEntries(tar)
    assert.deepEqual([...files.keys()], ['package/lib/real.js'], '长名不得泄漏给后续无长名条目')
    assert.equal(files.get('package/lib/real.js').toString(), 'r')
  })
})
