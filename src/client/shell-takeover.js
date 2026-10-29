/**
 * 壳接管诊断（DOM-free 纯函数；2026-10-30 哨兵退役，issue #33）。
 *
 * 裁定史：
 * - 2026-10-13（0.9.81）ds-bot 页脚错乱实证 → 负 priority 接管即整行让位；
 * - 2026-10-24（issue #4）codex-ui 合作换壳白名单分档（locale 白名单，已随本裁定退役）；
 * - 2026-10-29（issue #33）better-workspace 误伤曝光。复核发现地基两处不成立：
 *   ① 官方契约被截断误读——SidebarRoot 原文（dsh-client-ui-sidebar 0.2.1-rc.3 与
 *   rc.4 双版核实，注释与渲染逻辑两证；取证副本 .dsh-research/issue33/sb-rc3.js）：
 *   「The workspace/session browsing region between global panel rows and the foot
 *   is the `sidebar.workspaces` registrant's, and the foot holds `sidebar.settings`
 *   plus `sidebar.footer.action`」——中段区域归注册者，页脚（settings + footer.action）
 *   恒由官方壳无条件渲染（footArea 渲染无任何条件分支）。旧注释引「the foot is the
 *   registrant's」砍掉「between global panel rows and」限定语，句意反转。页脚真正
 *   脱离官方之手的唯一方式是整壳经 `sidebar` 槽被替换——此时 footer.action 条目
 *   根本不挂载，天然隐身，无需任何让位判定。
 *   ② locale 白名单结构性失效——ds-bot 0.2.4（2026-10-29，main 与 npm tgz 双证）
 *   接管条目经 freePriority 动态取位，无 locale/id/key 可锚定，名单两方向（合作豁免/
 *   敌意点名）都够不着；且其 0.1.7（#164，2026-10-16）起即为其他插件页脚条目留行，
 *   10-13 实证所针对的伤害上游三天后已自愈。
 * - 2026-10-30 裁定（ADR-0027）：入口恒在场，本模块降级为诊断信号——只回答
 *   「接管环境是否存在」，不再分档、不再参与渲染门控。备案（可见性探针挂账 /
 *   不建敌意名单）见 ADR-0027。
 */

/**
 * sidebar.workspaces 台账 → 是否存在壳接管环境（负 priority 占位者）。
 * 条目形状：{ options?: { priority? }, locale? }（locale 仅形状兼容，不再参与判定）。
 */
export function hasShellTakeover(entries) {
  if (!Array.isArray(entries)) return false
  return entries.some((entry) => {
    if (!entry) return false
    return (entry.options?.priority ?? 0) < 0
  })
}
