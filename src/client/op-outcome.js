/**
 * 变更结局描述（GLOSSARY）：一次变更操作（安装/升级/卸载/开关/自升级）终态
 * （成功/守卫拦截/已跳过/失败）的统一文案装配。工厂注入 i18n lookup 出成品文案
 * （createMarkdown(h) 同款注入先例）；文案键在 main.jsx 字典，装配在此单源。
 * 流程特有分支（兼容确认弹窗、能力表拒绝横幅、乐观提示）不入内，由调用点自理。
 * Node tests 直接覆盖（0.9.94）。
 */
import { upgradeNotify } from './operations.js'

/** 纯失败兜底 key：verb → i18n 键（五枚，仅 key 不同）。 */
const PLAIN_FAIL_KEY = {
  install: 'failed.install',
  upgrade: 'failed.upgrade',
  uninstall: 'failed.uninstall',
  toggle: 'toggle.failed',
  self: 'notify.selfupgraded.failed',
}

/**
 * @param {(key: string, params?: Record<string, string>) => string} lookup
 * @returns {{ guardBlockedText, buildsSuffix, upgradeOkText, degradedOutcome, mutationFailed }}
 */
export function createOpOutcome(lookup) {
  /** 守卫全版五段装配（原 main.jsx 三处逐字收敛，字节不变）：拦截头 | 补偿状态 | 修复依据(可选) | 无强装 | 重启安全性。 */
  const guardBlockedText = (guard) =>
    [
      lookup('guard.blocked'),
      `${lookup('guard.compstatus')}: ${guard.compensation?.status || '—'}（${guard.compensation?.note || ''}）`,
      guard.repairBasis ? `${lookup('guard.repairbasis')}: ${guard.repairBasis}` : null,
      lookup('guard.noforce'),
      guard.restartSafe ? lookup('guard.restartsafenow') : lookup('guard.restartunsafe'),
    ].filter(Boolean).join(' | ')

  /** builds 后缀（原四处拼装收敛）：approvals 非空优先，次选 fallback，皆无空串。 */
  const buildsSuffix = (res) =>
    res.buildApprovals && res.buildApprovals.length
      ? lookup('notify.builds', { names: res.buildApprovals.join(', ') })
      : res.fallbackAllBuilds
        ? lookup('notify.builds.fallback')
        : ''

  /** 升级成功文案（原两处逐字收敛）：from/to 箭头 + builds 后缀 + 生效判定三态后缀（组合 operations.upgradeNotify）。 */
  const upgradeOkText = (res) => {
    const note = upgradeNotify(res.activation)
    return {
      needsRestart: note.needsRestart,
      text:
        lookup('notify.upgraded', {
          pkg: res.pkg,
          from: res.fromVersion ? `v${res.fromVersion}` : '—',
          to: res.version ? `v${res.version}` : res.sha ? res.sha.slice(0, 7) : 'latest',
        }) + buildsSuffix(res) + (note.suffixKey ? lookup(note.suffixKey) : ''),
    }
  }

  /** 降级恢复结局（0.10.0 R4）：升级失败但已自动回装旧版——core 成功形态 + degraded 标记的
   *  统一 warn 投影；非 degraded 输入返回 null（调用点不命中新分支，走既有成功臂）。 */
  const degradedOutcome = (res) =>
    res && res.degraded === true
      ? { kind: "warn", text: lookup("op.degraded", { restoredTo: res.restoredTo || "—" }) }
      : null

  /** needsBuildApproval 未遂文案（issue #41）：单一共享键；verbKey 指向本地化动词键
   *  （动态 lookup(verbKey) 不在 i18n 直接量审计面——键在场由 client-i18n.test 在场断言钉住）。 */
  const buildBlockedText = (res, verbKey) =>
    lookup("notify.buildApprovalPending", { verb: lookup(verbKey), pkg: res?.pkg || "" })

  /** 变更失败描述：superseded → ok；guard → err（guardBlockedText）；其余 → err failed.<verb>。副作用（notify/setInstallNote）留守调用点。 */
  const mutationFailed = (e, { verb, target }) => {
    if (e && e.opSuperseded) return { kind: 'ok', text: lookup('op.superseded.note', { target }) }
    if (e && e.guard) return { kind: 'err', text: guardBlockedText(e.guard) }
    return { kind: 'err', text: lookup(PLAIN_FAIL_KEY[verb], { err: (e && e.message) || e }) }
  }

  return { guardBlockedText, buildsSuffix, upgradeOkText, degradedOutcome, buildBlockedText, mutationFailed }
}
