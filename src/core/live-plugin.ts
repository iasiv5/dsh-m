/**
 * 卸载前先让 loader 里的 live fiber 下线，否则 client-modules 仍列出该包，
 * 浏览器请求 /plugins/<name>/client.js 会 404。移植自 skillhub live-plugin.ts。
 */

export interface LoaderEntry {
  /** 合成条目 id（cordis.patch.yml 覆盖行的匹配键，官方 pluginEntryId 同源） */
  id?: string
  /**
   * options.id 也是合成条目 id 的在位投影——官方 themes.ts `ownsLoaderEntry` 读
   * `entry.options.id` 做条目归属判定（载体包认领，#156/#619 同源）；顶层 id 是
   * dsh-m 0.4.0 行开关读法。两处形态在宿主对象上并存与否随代际浮动，读方双查。
   */
  options?: { name?: string; id?: string; disabled?: boolean | null }
  /**
   * entry 顶层的有效停用态（含被禁用的祖先组）——官方 readPluginInventory 的
   * `enabled = !entry.disabled` 读法（dsh-host-plugin-inventory L131）。与
   * options.disabled 不同层：后者只是本行声明，前者是合成后的有效值。
   */
  disabled?: boolean
  /** root fiber 存在性即活体判定（flipEntry 现行用法）；state 为数字枚举 0-5 */
  fiber?: { state?: number | string } | undefined
  update?(patch: { disabled: boolean | null }, ...rest: unknown[]): Promise<unknown> | unknown
}

export interface LoaderHost {
  loader?: {
    entries(): Iterable<LoaderEntry>
  }
}

let boundHost: LoaderHost | undefined

export function bindLoaderHost(host: LoaderHost | undefined): void {
  boundHost = host
}

export function loaderHost(): LoaderHost | undefined {
  return boundHost
}

/**
 * 条目归属（issue #72）：名字精确命中，或裸 id（剥 include: 前缀；顶层 id / options.id
 * 双投影，enablement.ts loaderEntryId 同口径）∈ ownedIds——载体条目的 options.name 是
 * 相对模块路径（如 ./index.js），只按名字永远认领不到。ownedIds 缺省 = 旧名字口径（零漂移）。
 */
export function entryMatchesPkg(entry: LoaderEntry, name: string, ownedIds?: ReadonlySet<string>): boolean {
  if (entry.options?.name === name) return true
  if (ownedIds === undefined || ownedIds.size === 0) return false
  const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id
    : typeof entry.options?.id === 'string' && entry.options.id !== '' ? entry.options.id : null
  if (id === null) return false
  return ownedIds.has(id.split(':').pop() ?? id)
}

export async function setLivePluginDisabled(
  pkg: string,
  disabled: boolean,
  host: LoaderHost | undefined = boundHost,
  /** 本包补丁 insert id 集合（issue #72 载体形态的认领凭据） */
  ownedIds?: ReadonlySet<string>,
): Promise<boolean> {
  const name = String(pkg || '').trim()
  const entries = host?.loader?.entries
  if (!name || typeof entries !== 'function') return false
  let found = false
  for (const entry of entries.call(host!.loader)) {
    if (!entry || !entryMatchesPkg(entry, name, ownedIds)) continue
    if (typeof entry.update !== 'function') continue
    found = (await flipEntry(entry, disabled)) || found
  }
  return found
}

async function flipEntry(entry: LoaderEntry, disabled: boolean): Promise<boolean> {
  const flag = disabled ? true : null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await entry.update!({ disabled: flag }, false, true)
    } catch {
      return false
    }
    const live = entry.fiber !== undefined
    if (live !== disabled) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return true
}
