/**
 * cordis 补丁层 YAML 的三个纯函数（0.4.0 开关功能，DESIGN/plan Task 2）：
 *
 * 1) readBundlePatchRows —— 包内 `cordis.patch.yml`（dsh.bundle.patch 层）行枚举，
 *    供「单行/多行插件」粒度判定（GLOSSARY.md：行覆盖 vs Bundle 选择）；
 * 2) planRowOverride —— 官方 `writePluginEnabled`（dsh-plugin-manager L881-916）的纯函数版：
 *    在 profile `cordis.patch.yml` 文本上做保注释的 `disabled` 覆盖编辑（findLast 按 id 匹配、
 *    跳过含 insert 的行、name 可选限定、已是目标态 changed:false、无匹配 append `{id, disabled}`；
 *    启用写显式 `disabled: false` 以压过更低层）。文件 IO 留给调用方（toggle.ts 持锁后落盘）；
 * 3) readProfileOverrides —— 读 profile 补丁层的覆盖行（id → disabled），enablement 读路径用。
 * 4) declaredBundlePatchFiles —— dsh.bundle.patch 声明解析（官方 bundlePatchFiles 同口径，
 *    issue #72）：string | string[] → 相对包目录路径表；未声明/非法 → null（调用方回退根级）。
 * 5) mergeBundlePatchRows —— 多补丁文件行枚举合并（全有全无：任一文件缺失/不可解析 → 整体不可读）。
 *
 * 解析约定与官方一致：customTags `tag:yaml.org,2002:js` 原样保留（官方补丁可含 `!!js`
 * disabled 表达式）；planRowOverride 对坏 YAML / 根非序列 throw（调用方映射为失败），
 * readBundlePatchRows 对不可解析形态返回 readable:false（调用方按多行 → Bundle 级处理），
 * readProfileOverrides 宽松（读路径，坏文件 → []）。
 */
import { isMap, isSeq, parseDocument, type Document, type YAMLSeq } from 'yaml'

/** 官方同款 customTags：`!!js` 标量原样解析为字符串，不因未知标签炸解析。 */
const YAML_OPTIONS = {
  customTags: [
    {
      tag: 'tag:yaml.org,2002:js',
      resolve(value: string) {
        return value
      },
    },
  ],
}

export interface BundlePatchRowInsert {
  id: string
  name?: string
}

export interface BundlePatchRows {
  /** insert 行声明的合成条目（每项至少有 id，可带 name） */
  inserts: BundlePatchRowInsert[]
  /** 非 insert 行数（配置补丁行 / 覆盖行——都是「行开关关不干净」的形态） */
  configRows: number
  /** 根非序列 / 坏 YAML / insert 元素畸形 → false（调用方按多行处理） */
  readable: boolean
}

function scalarString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * 包内补丁层行枚举。判定口径：
 * - map 且含 `insert` 键 → 其值必须是序列，逐元素取 {id, name?}；元素非 map / 缺 id → 整体不可读；
 * - map 无 `insert`（含 `- id: x` 的配置补丁行与覆盖行）→ configRows +1；
 * - 非映射项（纯标量等畸形）→ 整体不可读。
 */
export function readBundlePatchRows(text: string): BundlePatchRows {
  const result: BundlePatchRows = { inserts: [], configRows: 0, readable: true }
  let seq: YAMLSeq
  try {
    seq = parsePatchSeq(text).seq
  } catch {
    return { ...result, readable: false }
  }
  for (const item of seq.items) {
    if (!isMap(item)) return { inserts: [], configRows: 0, readable: false }
    if (item.has('insert')) {
      const inserted = item.get('insert')
      if (!isSeq(inserted)) return { inserts: [], configRows: 0, readable: false }
      for (const element of inserted.items) {
        if (!isMap(element)) return { inserts: [], configRows: 0, readable: false }
        const id = scalarString(element.get('id'))
        if (id === null) return { inserts: [], configRows: 0, readable: false }
        const name = scalarString(element.get('name'))
        result.inserts.push(name === null ? { id } : { id, name })
      }
      continue
    }
    result.configRows += 1
  }
  return result
}

/** JSON 合法根：非 null、非数组的对象（installed.ts 同判，此处自持一份防跨模块耦合）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * dsh.bundle.patch 声明解析（@deepseek-ai/dsh-app-boot bundlePatchFiles 同口径，issue #72）：
 * string → 单文件；string[] → 多文件（声明序）；未声明 dsh/bundle/patch 或类型非法 → null
 * （调用方回退根级 cordis.patch.yml——官方 loader 对未声明 bundle 是整体 skip、不读根级，
 * dsh-m 保留回退只为自身标注的向后兼容，永不伪造活体状态）。空数组 = 合法声明零补丁文件。
 */
export function declaredBundlePatchFiles(dsh: unknown): string[] | null {
  if (!isRecord(dsh)) return null
  const bundle = dsh.bundle
  if (!isRecord(bundle)) return null
  const patch = bundle.patch
  if (typeof patch === 'string') return [patch]
  if (Array.isArray(patch) && patch.every((file) => typeof file === 'string')) return patch as string[]
  return null
}

/**
 * 多补丁文件行枚举合并（全有全无，issue #72）：任一文件缺失（null）或不可解析 →
 * 整体 { inserts: [], configRows: 0, readable: false }（与单文件缺失契约一致，粒度降 Bundle）；
 * 全部可读 → inserts 按声明序拼接、configRows 求和；空 parts（声明 []）→ 可读零行。
 */
export function mergeBundlePatchRows(parts: Array<BundlePatchRows | null>): BundlePatchRows {
  const merged: BundlePatchRows = { inserts: [], configRows: 0, readable: true }
  for (const part of parts) {
    if (part === null || !part.readable) return { inserts: [], configRows: 0, readable: false }
    merged.inserts.push(...part.inserts)
    merged.configRows += part.configRows
  }
  return merged
}

/** 单行插件：可读、恰好一个 insert 条目、零配置补丁行——行开关即整插件开关。 */
export function isSingleRowPlugin(rows: BundlePatchRows): boolean {
  return rows.readable && rows.inserts.length === 1 && rows.configRows === 0
}

function parsePatchSeq(text: string): { document: Document.Parsed; seq: YAMLSeq } {
  const document = parseDocument(text, YAML_OPTIONS)
  const error = document.errors[0]
  if (error !== undefined) throw error
  // Document.contents 是 accessor，CFA 无法收窄——先落到局部变量再判形
  const seq = document.contents
  if (!isSeq(seq)) throw new Error('cordis.patch.yml 必须是 YAML 序列')
  return { document, seq }
}

export interface RowOverridePlan {
  /** 编辑后的完整文件文本（保注释）；changed:false 时与输入等价 */
  text: string
  /** 是否发生改写（已是目标态 → false，调用方不重复写盘） */
  changed: boolean
}

/**
 * 保注释的行覆盖编辑（官方 writePluginEnabled 纯函数版）。
 * @param text 当前 profile `cordis.patch.yml` 文本（文件缺失由调用方传 `"[]\n"`）
 * @param id 目标合成条目 id（来自 insert 行声明或 loader entry）
 * @param name 模块名（可选限定：行有 name 且不等 → 不匹配；append 时不写 name，与官方一致）
 * @param enabled 目标启停态（true → 写 `disabled: false` 显式正覆盖）
 */
export function planRowOverride(
  text: string,
  id: string,
  name: string | undefined,
  enabled: boolean,
): RowOverridePlan {
  const { document, seq } = parsePatchSeq(text)
  const items = seq.items
  const targetIndex = findLastIndex(items, (item, index) => {
    if (!isMap(item) || item.has('insert')) return false
    if (document.getIn([index, 'id']) !== id) return false
    const expectedName = document.getIn([index, 'name'])
    return !expectedName || expectedName === name
  })
  if (targetIndex >= 0) {
    if (document.getIn([targetIndex, 'disabled']) === !enabled) {
      return { text, changed: false }
    }
    document.setIn([targetIndex, 'disabled'], !enabled)
  } else {
    document.add({ id, disabled: !enabled })
  }
  return { text: String(document), changed: true }
}

/** Array.prototype.findLast 的索引版（官方用 items.findLast 取项，这里需要下标做 setIn）。 */
function findLastIndex<T>(items: T[], predicate: (item: T, index: number) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index], index)) return index
  }
  return -1
}

export interface ProfileOverrideRow {
  id: string
  disabled: boolean
}

/**
 * 读 profile 补丁层覆盖行（读路径，宽松）：坏 YAML / 根非序列 / 非 map 项 → 跳过或整体 []。
 * 只返回带字符串 id 的非 insert 行；`disabled` 键缺省视为 false。
 */
export function readProfileOverrides(text: string): ProfileOverrideRow[] {
  let seq: YAMLSeq
  try {
    seq = parsePatchSeq(text).seq
  } catch {
    return []
  }
  const rows: ProfileOverrideRow[] = []
  for (const item of seq.items) {
    if (!isMap(item) || item.has('insert')) continue
    const id = scalarString(item.get('id'))
    if (id === null) continue
    rows.push({ id, disabled: item.get('disabled') === true })
  }
  return rows
}
