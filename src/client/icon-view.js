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
