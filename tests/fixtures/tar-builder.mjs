/**
 * 测试专用：内存构造 ustar 字节流（+gzip）。只为 ustar / activation 测试服务。
 * 手写 512 字节头，校验和按 POSIX 规则（chksum 字段本身按 8 空格计）。
 * 不处理 base-256 编码超长 size（npm registry 产出用不到）。
 */
import { gzipSync } from 'node:zlib'

function octal(value, length) {
  return value.toString(8).padStart(length - 1, '0') + '\0'
}

function headerFor(name, size, typeflag) {
  const block = Buffer.alloc(512, 0)
  block.write(name.slice(0, 100), 0, 'utf8')
  block.write('0000644', 100, 'utf8') // mode
  block.write('0000000', 108, 'utf8') // uid
  block.write('0000000', 116, 'utf8') // gid
  block.write(octal(size, 12), 124, 'utf8') // size
  block.write(octal(0, 12), 136, 'utf8') // mtime
  block.write('        ', 148, 'utf8') // chksum 占位（计算时按空格）
  block.write(typeflag, 156, 'utf8')
  block.write('ustar\0', 257, 'utf8') // magic
  block.write('00', 263, 'utf8') // version
  let sum = 0
  for (const b of block) sum += b
  block.write(octal(sum, 8), 148, 'utf8')
  return block
}

function contentBlocks(data) {
  const pad = (512 - (data.length % 512)) % 512
  return Buffer.concat([data, Buffer.alloc(pad, 0)])
}

/** pax 记录："%d %s" 的长度不动点（%d 为整条记录字节数，含自身位数与空格）。 */
function paxRecord(key, value) {
  const payload = `${key}=${value}\n`
  let total = payload.length + 2
  for (;;) {
    const next = payload.length + String(total).length + 1
    if (next === total) break
    total = next
  }
  return `${total} ${payload}`
}

/**
 * entries: [{ name, data?: Buffer|string, type?: 'file'|'dir', pax?: boolean, gnuLong?: boolean }]
 * - pax: 先写 'x' 扩展头（path= 完整名），随后文件条目 name 字段截断到 100 字符（真实 tar 形态）
 * - gnuLong: 先写 'L' 条目（内容为 NUL 结尾长名）
 * - 尾部写 1024 零字节结束块
 */
export function buildTar(entries) {
  const parts = []
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8')
    if (entry.pax) {
      const record = Buffer.from(paxRecord('path', entry.name), 'utf8')
      parts.push(headerFor('././@PaxHeader', record.length, 'x'), contentBlocks(record))
      parts.push(headerFor(entry.name.slice(0, 100), data.length, '0'), contentBlocks(data))
    } else if (entry.gnuLong) {
      const longName = Buffer.from(entry.name + '\0', 'utf8')
      parts.push(headerFor('././@LongLink', longName.length, 'L'), contentBlocks(longName))
      parts.push(headerFor(entry.name.slice(0, 100), data.length, '0'), contentBlocks(data))
    } else {
      const typeflag = entry.type === 'dir' ? '5' : '0'
      parts.push(headerFor(entry.name, typeflag === '5' ? 0 : data.length, typeflag), contentBlocks(data))
    }
  }
  parts.push(Buffer.alloc(1024, 0))
  return Buffer.concat(parts)
}

export function buildTarGz(entries) {
  return gzipSync(buildTar(entries))
}
