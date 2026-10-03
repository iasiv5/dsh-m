/**
 * ustar/pax 只读解析器（0.9.22 生效判定专用）：把（已解压的）tar 字节流解析为
 * 「条目路径 → 内容」的 Map。支持：常规文件（'0'/NUL）、目录（'5'，跳过）、
 * pax 扩展头（'x'，path= 记录应用于下一条件目）、GNU 长名（'L'）、全局头（'g'，跳过）。
 * 任何结构异常（截断、坏 size、校验和不符）抛 Error——调用方 fail-open 到 unknown。
 * 只读不落盘；零第三方依赖（npm-integrity 同款纪律）。npm registry 产出的 tar 足够规整，
 * 不支持 base-256 超长 size 编码。
 */

const BLOCK = 512

function isZeroBlock(block: Buffer): boolean {
  for (const b of block) if (b !== 0) return false
  return true
}

/** 八进制字段：容忍 NUL/space 填充；空串返回 0；非八进制返回 null。 */
function parseOctal(field: Buffer): number | null {
  const text = field.toString('utf8')
  const cleaned = text.replace(/[\0 ].*$/, '').trim()
  if (cleaned === '') {
    // 全 NUL/space 的 size 视为 0（目录/空文件常态）；完全空白的 checksum 视为非法
    return /^[\0 ]*$/.test(text) && text.includes('\0') ? 0 : null
  }
  if (!/^[0-7]+$/.test(cleaned)) return null
  const value = Number.parseInt(cleaned, 8)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function cString(field: Buffer): string {
  const end = field.indexOf(0)
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8')
}

/** ustar 头：name(100)@0 + prefix(155)@345（magic 为 ustar 时拼接）。 */
function entryName(header: Buffer): string {
  const name = cString(header.subarray(0, 100))
  const magic = cString(header.subarray(257, 263))
  const prefix = magic === 'ustar' ? cString(header.subarray(345, 500)) : ''
  return prefix !== '' ? `${prefix}/${name}` : name
}

/** pax 'x' 负载：每行 "%d key=value\n"；只关心 path= 记录（取最后一次出现的值）。 */
function paxPathRecord(content: Buffer): string | null {
  let found: string | null = null
  for (const line of content.toString('utf8').split('\n')) {
    const m = /^\d+ path=(.*)$/.exec(line)
    if (m) found = m[1] ?? null
  }
  return found
}

/**
 * 解析 tar 字节流。键为条目原始路径（保留 npm 的 `package/` 前缀，归一是调用方职责）；
 * 仅收录常规文件；目录与元数据条目不进 Map。
 */
export function parseTarEntries(tar: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  let offset = 0
  let pendingName: string | null = null // 来自 pax 'x' / GNU 'L'
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (isZeroBlock(header)) break
    // 校验和：计算时 chksum 字段（148-156）按 8 个空格计
    let sum = 0
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!
    const stored = parseOctal(header.subarray(148, 156))
    if (stored === null || stored !== sum) throw new Error('tar 头校验和不符')
    const size = parseOctal(header.subarray(124, 136))
    if (size === null || size < 0) throw new Error('tar size 字段非法')
    const typeflag = String.fromCharCode(header[156] ?? 0x30)
    const contentStart = offset + BLOCK
    const contentEnd = contentStart + size
    if (contentEnd > tar.length) throw new Error('tar 条目内容截断')
    const content = tar.subarray(contentStart, contentEnd)

    if (typeflag === 'x') {
      const path = paxPathRecord(content)
      if (path !== null) pendingName = path
    } else if (typeflag === 'L') {
      pendingName = cString(content)
    } else if (typeflag === 'g') {
      // 全局扩展头：整段跳过
    } else if (typeflag === '0' || typeflag === '\0') {
      const name = pendingName ?? entryName(header)
      pendingName = null
      entries.set(name, Buffer.from(content)) // 拷贝，避免 subarray 挂住整块底层 buffer
    } else {
      // 目录/链接等其他类型：长名只属于紧贴其后的条目，未消费即弃用（防跨条目错名归属）
      pendingName = null
    }

    offset = contentEnd + ((BLOCK - (size % BLOCK)) % BLOCK)
  }
  return entries
}
