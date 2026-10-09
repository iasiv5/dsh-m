/**
 * 图片加载链纯逻辑（0.9.61，grilling Q1-Q18 共识 / 实施计划 Task 1）。
 * 根因：大陆浏览器到 raw.githubusercontent.com / github.com 的网络路径时断时通（服务器侧实测 200/0.2s），
 * 缩略图条与灯箱全空；对标 dsh-market 1.66.14——其缩略图无条件 weserv（实测大陆 1.39s/23KB vs 原图 41KB），
 * 但灯箱直连原图零兜底（大陆黑洞）。本模块承载「对称双兜底 + 赢家记忆」的无 React 部分，Node 直测。
 *
 * 语义要点（锚定共识，勿无声改动）：
 * - 两层：weserv（代理+转码）→ direct（原图）→ 消费方终态（缩略图剔除/灯箱占位/图标字母兜底）。
 * - 8s 人工超时仅 weserv 层有资格（needsTimeout）——direct 层零人工超时，防误杀 0.5MB/s 级合法慢速下载。
 * - 赢家记忆：页面生命周期、最近成功层、raw/avatar 两桶（github.com → avatar，其余含未知宿主 → raw）、
 *   仅 rememberSuccess 晋升（结构性不存在失败降级 API——tier0 失败只能经 tier1 成功翻转偏好）。
 * - WESERV_BASE 为模块级单一常量：未来设置项/自建代理只改此处（Q5）。
 */

/** weserv 代理基址（Q5：单一常量，不做设置项）。 */
export const WESERV_BASE = 'https://images.weserv.nl/?'

/** 代理层人工超时（Q7：仅 weserv 层挂此守卫；毫秒）。 */
export const WESERV_TIMEOUT_MS = 8000

/**
 * 构造 weserv 代理 URL（dsh-market thumbUrl 同款形态 + webp 转码）。
 * size 二选一：w（灯箱 1600）或 h（缩略图 300 / 图标 96），同给时 w 优先（契约：调用方只给一个）。
 * 固定参数串 `fit=inside&we=1&output=webp&q=80` 为测试锚，不得改写。
 */
export function weservUrl(src, { w, h } = {}) {
  const bare = String(src).replace(/^https?:\/\//, '')
  const size = Number.isFinite(w) && w > 0 ? `w=${Math.floor(w)}` : Number.isFinite(h) && h > 0 ? `h=${Math.floor(h)}` : ''
  const sizePart = size ? `&${size}` : ''
  return `${WESERV_BASE}url=${encodeURIComponent(bare)}${sizePart}&fit=inside&we=1&output=webp&q=80`
}

/**
 * 服务桶分类（Q8/Q17）：github.com 宿主 → avatar（大陆可达性与 raw 系经常不同步）；
 * githubusercontent 系与其余任意宿主（含不可解析输入）→ raw。两桶制，不为未知宿主加第三桶。
 */
export function serviceBucketOf(url) {
  try {
    return new URL(String(url)).hostname === 'github.com' ? 'avatar' : 'raw'
  } catch {
    return 'raw'
  }
}

/**
 * tier 顺序：偏好层置顶、另一层殿后。非法偏好回落 weserv 优先（Q18 初始语义）。
 */
export function tierOrder(preferred) {
  return preferred === 'direct' ? ['direct', 'weserv'] : ['weserv', 'direct']
}

/**
 * 层间前进（序感知，0.9.61 执行期修正）：以 `tierOrder(preferred)` 为序——当前层在序中的下一层；
 * 已是序末（两层都试过）→ failed（终态幂等；非法输入直落 failed）。
 * 固定阶梯 weserv→direct→failed 是错的：preferred=direct 时 direct 败应换 weserv（对称双兜底 Q3），
 * 而非跳过兜底直判死（探针 A19 场景实证捕获）。
 */
export function nextTier(current, preferred = 'weserv') {
  const order = tierOrder(preferred)
  const idx = order.indexOf(current)
  if (idx === -1 || idx === order.length - 1) return 'failed'
  return order[idx + 1]
}

/**
 * 该层是否有资格挂人工超时（Q7：仅 weserv——正常时亚秒应答，8s 即判不可用立即换层）。
 */
export function needsTimeout(tier) {
  return tier === 'weserv'
}

/** 页面生命周期赢家记忆（模块态；测试经 resetTierPreferences 复原）。非法桶名落 raw。 */
const preferredByBucket = { raw: 'weserv', avatar: 'weserv' }

/** 读该桶当前偏好层（最近成功层；初始恒 weserv）。 */
export function preferredTier(bucket) {
  return preferredByBucket[bucket === 'avatar' ? 'avatar' : 'raw']
}

/**
 * 记一次「已验证的成功」（img onLoad 后调用）：该桶偏好翻至此层。
 * 结构性不存在失败降级 API——tier0 失败不降级偏好，仅当 tier1 成功才翻转（Q8 拍板）。
 */
export function rememberSuccess(bucket, tier) {
  if (tier !== 'weserv' && tier !== 'direct') return
  preferredByBucket[bucket === 'avatar' ? 'avatar' : 'raw'] = tier
}

/** 测试钩子：两桶偏好复原为 weserv。 */
export function resetTierPreferences() {
  preferredByBucket.raw = 'weserv'
  preferredByBucket.avatar = 'weserv'
}
