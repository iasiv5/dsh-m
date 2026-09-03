/**
 * 卸载前先让 loader 里的 live fiber 下线，否则 client-modules 仍列出该包，
 * 浏览器请求 /plugins/<name>/client.js 会 404。移植自 skillhub live-plugin.ts。
 */

export interface LoaderEntry {
  options?: { name?: string; disabled?: boolean | null }
  fiber?: unknown
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

export async function setLivePluginDisabled(
  pkg: string,
  disabled: boolean,
  host: LoaderHost | undefined = boundHost,
): Promise<boolean> {
  const name = String(pkg || '').trim()
  const entries = host?.loader?.entries
  if (!name || typeof entries !== 'function') return false
  let found = false
  for (const entry of entries.call(host!.loader)) {
    if (!entry || entry.options?.name !== name) continue
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
