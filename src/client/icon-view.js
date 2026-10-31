/**
 * 图标解析链纯逻辑（ADR-0025 T4）：候选序 = 目录声明（仅 https URL）→ 已装官方 data URI → GitHub owner 头像。
 * 消费方：chrome.jsx 的 Icon（候选序在外，图片加载链投递在内——GLOSSARY「图标解析链」）。
 * 目录侧 data:/http:/相对路径一律视为无图标（用户 Q7 定案；校验层与 T7 守卫前的最后防线）。
 */

/** 目录侧声明图标只认 https URL；其余一律 null（调用方按「无图标」降级）。 */
export function catalogIconUrl(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v.startsWith('https://')) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? v : null
  } catch {
    return null
  }
}

/** GitHub owner 头像（与既有 Icon 同款构造）：github 必须是 owner/repo 形态。 */
function avatarUrl(github) {
  if (typeof github !== 'string') return null
  const slash = github.indexOf('/')
  if (slash <= 0 || slash === github.length - 1) return null
  return `https://github.com/${github.slice(0, slash)}.png?size=64`
}

/** data: 候选唯一合法入口 = 已装 item 的 iconDataUri，且必须是 image/*（不走 weserv，直连渲染）。 */
function metaIconUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/') ? value : null
}

/**
 * 有序去重候选：目录声明 → 已装官方 data URI → 头像。
 * 注：catalog 与 iconDataUri 同现时目录声明在前，是纯函数的确定性契约——产品上两字段分属
 * 不同面板的数据面（市场页只喂 icon、已装页只喂 iconDataUri），不构成真实冲突。
 */
export function iconCandidates(entry) {
  const e = entry || {}
  const out = []
  const catalog = catalogIconUrl(e.icon)
  if (catalog) out.push(catalog)
  const meta = metaIconUrl(e.iconDataUri)
  if (meta) out.push(meta)
  const avatar = avatarUrl(e.github)
  if (avatar) out.push(avatar)
  return [...new Set(out)]
}

// ---------- 收藏头像修复（2026-10-31）：收藏快照无 icon 字段，收藏卡头像恒退化到 owner 头像 ----------
// 三层数据源装配（与 iconCandidates 候选序同构）：① market-ids-exist 同批透出的目录声明 icon
// （0.11.x core 扩展，present 条目）② 收藏快照自带 icon/iconDataUri（snapshotOf 新增持久化）
// ③ 已装条目 iconDataUri 别名 join（registryId/npm/github——社区收藏的已装插件用真图标，
// 社区页同款呈现，见 ADR-0025 增补「页内 matched 已装条目 join」）。全部 DOM-free 纯逻辑直测。

/** 已装条目 → 图标别名索引（main.jsx 装配一次传 FavoriteZone）：键族 id:<registryId> /
 * npm:<pkg> / gh:<registryGithub>；iconDataUri 缺席不产键；非数组/垃圾项安全降级空索引。 */
export function buildInstalledIconIndex(items) {
  const byKey = {}
  const list = Array.isArray(items) ? items : []
  for (const it of list) {
    if (!it || typeof it !== 'object') continue
    const uri = typeof it.iconDataUri === 'string' && it.iconDataUri !== '' ? it.iconDataUri : null
    if (!uri) continue
    if (typeof it.registryId === 'string' && it.registryId !== '') byKey[`id:${it.registryId}`] = uri
    if (typeof it.pkg === 'string' && it.pkg !== '') byKey[`npm:${it.pkg}`] = uri
    if (typeof it.registryGithub === 'string' && it.registryGithub !== '') byKey[`gh:${it.registryGithub}`] = uri
  }
  return { byKey }
}

/** 收藏快照 → 已装图标 join：id → npm → github 别名序（社区收藏 id 与 registryId 的位移身份
 * 场景由 npm/github 别名兜住）；全别名未命中/索引缺席返回 null（回退 iconCandidates 既有链）。 */
export function favoriteInstalledIcon(installedIcons, entry) {
  const e = entry || {}
  const byKey = installedIcons && typeof installedIcons === 'object' ? installedIcons.byKey : null
  if (!byKey || typeof byKey !== 'object') return null
  const keys = []
  if (typeof e.id === 'string' && e.id !== '') keys.push(`id:${e.id}`)
  if (typeof e.npm === 'string' && e.npm !== '') keys.push(`npm:${e.npm}`)
  if (typeof e.github === 'string' && e.github !== '') keys.push(`gh:${e.github}`)
  for (const k of keys) {
    const v = byKey[k]
    if (typeof v === 'string' && v !== '') return v
  }
  return null
}

/** 收藏卡 Icon entry 装配：目录现行 icon 覆盖快照（目录为准）→ 快照自带 icon 保留（新收藏
 * 离线也有）→ 双缺时已装 data URI 落 iconDataUri 键（data:image/ 门与 metaIconUrl 同源）。
 * 输入容错：全缺席原样返回不抛——iconCandidates 的 https/avatar 门兜底校验。 */
export function withFavoriteIcons(entry, catalogIcons, installedIcons) {
  const e = entry || {}
  const out = { ...e }
  const cat = catalogIcons && typeof catalogIcons === 'object' && typeof e.id === 'string' ? catalogIcons[e.id] : undefined
  if (typeof cat === 'string' && cat !== '') out.icon = cat
  const hasIcon = typeof out.icon === 'string' && out.icon !== ''
  if (!hasIcon) {
    const inst = favoriteInstalledIcon(installedIcons, e)
    if (typeof inst === 'string' && inst.startsWith('data:image/')) out.iconDataUri = inst
  }
  return out
}
