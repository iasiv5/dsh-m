/**
 * #36：client 升级编排单点（installed-tab / market-tab 薄壳的共同核心）。
 * 收编前双胞胎病灶实证：cdc8404（0.10.20）一处 bug 三站同步修；enqueue-meta
 * `{ from, toVersion }` 是跨文件隐式不变量（operations.js restoreRecords 仅在
 * meta.toVersion 存在时对账）。DOM-free 纯编排，副作用（notify/noteSink/refresh）注入。
 * 返回 ADR-0026 批量三态：'ok'（成功含降级恢复/良性跳过）/ 'target'（目标级失败，跳过继续）/
 * 'systemic'（系统性失败，批量短路——issue #10 语义）。
 */
import { opUpgradeMeta } from './operations-view.js'
import { restartBannerDecision } from './panel-ops.js'
import { classifyBatchOutcome } from './installed-updates.js'

/**
 * 升级编排（0.9.75 opMeta 落账 + 0.10.3 toVersion 随 enqueue 落 meta = 中断恢复对账比对依据 +
 * 0.10.20 from 持久化 = 恢复对账改判后渲染 v旧→v新 数据源；0.10.0 R4 降级恢复结局 warn 投影，
 * 绝不进成功臂——「升级成功 vX→vY」与回滚事实相反；0.9.94 结局描述单源 op-outcome；
 * ADR-0023 第二刀：needsRestart 判定单源 restartBannerDecision）。
 * @param {object} p
 * @param {object} p.ops 操作泵（runOp）
 * @param {object} p.oc createOpOutcome 实例
 * @param {string} p.target 操作记录 target（已装页 = it.pkg；市场 = it.installedPkg）
 * @param {string|undefined} p.from enqueue-meta.from（当前实装版）
 * @param {string|undefined} p.toVersion enqueue-meta.toVersion（对账比对依据，缺席不对账）
 * @param {() => Promise<object>} p.apiCall 升级 API 调用（薄壳构造）
 * @param {({kind, text}) => void} [p.noteSink] Modal 内摘要等站点附加投影（market setInstallNote 包装）
 * @param {() => (any|undefined)} [p.refresh] 成功臂数据刷新（installed = onMutation?:reload；market = onMutation）
 * @param {(n: {kind, needsRestart?, text}) => void} p.notify 横幅/toast 通道
 * @returns {Promise<'ok'|'target'|'systemic'>} 单点升级按钮不看返回值；批量循环消费三态
 */
export async function performUpgradeFlow({ ops, oc, target, from, toVersion, apiCall, noteSink, refresh, notify }) {
  try {
    const res = await ops.runOp('upgrade', target, async () => {
      const r = await apiCall();
      const m = opUpgradeMeta(r);
      return m ? { ...r, opMeta: m } : r;
    }, { from, toVersion });
    // 降级恢复结局：升级失败但已自动回装旧版 → warn 投影（与回滚事实相反的「成功」绝不出现）
    const degraded = oc.degradedOutcome(res);
    if (degraded) {
      notify({ kind: 'warn', text: degraded.text });
      noteSink?.({ kind: 'warn', text: degraded.text });
    } else {
      const ok = oc.upgradeOkText(res);
      notify({ kind: 'ok', needsRestart: restartBannerDecision('upgrade', res).needsRestart, text: ok.text });
      noteSink?.({ kind: 'ok', text: ok.text });
    }
    await (refresh ? refresh() : undefined);
    return 'ok';
  } catch (e) {
    // 变更结局描述（op-outcome）：superseded → ok / guard → err / 其余 → err failed.upgrade（与已装页同款文案链）
    const m = oc.mutationFailed(e, { verb: 'upgrade', target });
    notify({ kind: m.kind, text: m.text });
    noteSink?.({ kind: m.kind === 'ok' ? 'hint' : 'err', text: m.text });
    // ADR-0026：superseded（前提消失良性跳过）归 ok 不中断；真实失败按 failureClass 三态
    //（e.failureClass 由 hooks api() 透传，Task 6；字段缺席缺省 target——评审 F1）
    return m.kind !== 'err' ? 'ok' : classifyBatchOutcome(e);
  }
}
