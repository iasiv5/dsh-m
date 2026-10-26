/**
 * ADR-0023 第三刀 T10 组件出仓·批次一（version-chip.jsx）：自 main.jsx verbatim 迁移，
 * 函数体零重写；依赖经 ESM import 显式接线（由抽取脚本按标识符使用自动生成）。
 * 成员：DshmVersionChip
 */
import React from "react";
const h = React.createElement;
const { useState, useEffect } = React;
import { api } from "./hooks.js";
import { lookup } from "./i18n.js";
import { readSelfCheckCache, writeSelfCheckCache, clearSelfCheckCache, deriveChipState } from "./self-check.js";
import { restartBannerDecision } from "./panel-ops.js";
import { createOpOutcome } from "./op-outcome.js";
import { Spin } from "./chrome.jsx";

// op-outcome 模块级实例（与 main.jsx 同款装配）
const oc = createOpOutcome(lookup);

// 数据源：host self-check（npm latest vs 装机版本）；localStorage TTL 缓存防每次开面板都打 npm。
// 静默口径（主人 2026-10-01）：已最新 / 检查失败 / 本地 dev 领先 npm 一律维持 0.7.5 静态样式。
function DshmVersionChip({ version, notify, initialCheck, ops }) {
  const [check, setCheck] = useState(() =>
    initialCheck !== undefined
      ? initialCheck
      : (typeof window !== "undefined" && window.localStorage
          ? readSelfCheckCache(window.localStorage, { version })
          : null),
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initialCheck !== undefined) return; // 测试注入态不联网
    let live = true;
    api("self-check")
      .then((data) => {
        if (!live) return;
        if (data && typeof data === "object" && typeof data.current === "string") {
          writeSelfCheckCache(typeof window !== "undefined" && window.localStorage ? window.localStorage : null, data);
          setCheck(data);
          // 0.10.4（0.10.3 dogfood 挂账）：对账改判补横幅——0.10.3 事件实证自指重载会吞掉成功横幅，
          // 开机对账确认的结局在此补报（host 侧每进程一次 memoize，不重复打扰）
          const ir = data.intentResolved;
          if (ir && ir.ok) {
            notify({ kind: "ok", text: lookup("selfupgrade.reconciled.done", { from: ir.fromVersion ? `v${ir.fromVersion}` : "—", to: `v${ir.installedVersion}` }) });
          } else if (ir) {
            notify({ kind: "warn", text: lookup("selfupgrade.reconciled.failed", { to: `v${ir.intentVersion}`, current: `v${version}` }) });
          }
        }
      })
      .catch(() => {}); // 检查失败静默——「没有新版本」不打扰
    return () => { live = false; };
  }, [initialCheck]);
  // 0.10.2（主人 2026-10-17 裁决）：静默自升级——角标点击直接升级（0.10.1 确认框撤除：
  // 多一步确认破坏既有「点击即升级」体验；失败无损语义由 D3 通道本体保证，结局由横幅如实报告）。
  const doUpgrade = async () => {
    if (busy) return;
    return performUpgrade();
  };
  // 升级臂——self-upgrade 请求全文件唯一直呼点。
  const performUpgrade = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 0.9.85（主人真机反馈：头部自升级在操作日志无记录）：入本地操作泵——渠道归属面板
      // 通道零外部日志是 ADR-0018 不变量（host-api self-upgrade 显式 channel:'panel'），
      // 泵记录才是面板操作的账本；opMeta {from,to} 落账 → 已结束渲染「升级 dsh-m vX→vY」。
      // SSR/探针无 ops 时直连 api（行为同 0.9.84-）。stillApplies：dsh-m 恒已装 → 恒 applies。
      // 0.10.0 历史注记：自升级 tarball 直覆盖通道（D3）已恢复——desktop 上「升级 dsh-m 自身」
      // 的全部入口（头部角标 + 已装/市场卡片通用升级按钮 + Agent 工具）经服务端 core 缝改道
      // （SELF_PKG 单点，SELF_PKG='dsh-m'），0.9.6-0.9.94 间「desktop 自升级不可用」状态自此终结。
      // 0.10.3（挂账 1 数据面）：toVersion 随 enqueue 落 meta——中断恢复对账的比对依据。
      // 0.10.20：from（当前实装版）随 enqueue 持久化——中断恢复对账改判后渲染 v旧→v新 的原版本号数据源
      //（2026-10-26 真机实证：改判行此前只回填 toVersion，展示键 from/to 双缺 →「升级 dsh-m」无版本串）。
      const res = await (ops
        ? ops.runOp("upgrade", "dsh-m", async () => {
            const r = await api("self-upgrade");
            return { ...r, opMeta: { from: version, to: r.version || "latest" } };
          }, { npm: "dsh-m", from: version, toVersion: state.latest })
        : api("self-upgrade"));
      clearSelfCheckCache(typeof window !== "undefined" && window.localStorage ? window.localStorage : null);
      // 升级成功：缓存已清、本地判回最新态；重启横幅由 notify 的 needsRestart 通道给出（builds 段 0.9.94 换 op-outcome）
      setCheck({ current: version, latest: null, outdated: false, ahead: false });
      notify({
        kind: "ok",
        // 0.10.0 R10：生效语义忠实透传宿主 application——applied/overridden → false（不弹重启横幅）、
        // restart-required → true；响应缺席时保守 true（旧行为兜底）
        // ADR-0023 第二刀：判定单源（保守默认 ?? true 收进 restartBannerDecision，conservative 见其直测）
        needsRestart: restartBannerDecision("self-upgrade", res).needsRestart,
        text: lookup("notify.selfupgraded", { from: version, to: res.version || "latest" }) + oc.buildsSuffix(res),
      });
    } catch (e) {
      // Desktop 能力表拒绝（结构化 409）：不是失败——按官方入口指引出中性 info 横幅
      // （guidance 单一事实源在服务端 active-profile.ts），不再伪装红色「升级失败」（0.9.6 实机反馈）
      if (e && e.unsupported) {
        notify({ kind: "info", text: e.unsupported.guidance || (e && e.message) || String(e) });
      } else {
        // 0.9.94 变更结局描述（op-outcome）：与其余站点一致取 m.kind（今日 self-upgrade 无守卫/superseded 路径，恒 err；未来自升级接守卫时文案不错色）
        const m = oc.mutationFailed(e, { verb: "self", target: "dsh-m" });
        notify({ kind: m.kind, text: m.text });
      }
    } finally {
      setBusy(false);
    }
  };
  const state = deriveChipState(check, version);
  if (state.kind === "outdated") {
    return h(
      "button",
      {
        type: "button",
        className: "dshm-dshchip dshm-verchip warn",
        title: lookup("selfupdate.available", { v: state.latest }),
        onClick: doUpgrade,
        disabled: busy,
      },
      h("span", { className: "dshm-dshchip-name" }, "dsh-m "),
      h("span", { className: "dshm-dshchip-v" }, `v${version}`),
      busy ? h(Spin) : h("span", { className: "dshm-up" }, "⬆", h("span", { className: "dshm-up-v" }, ` v${state.latest}`)),
    );
  }
  const title = state.kind === "ahead" && state.latest
    ? lookup("selfupdate.ahead", { v: state.latest })
    : `dsh-m v${version}`;
  return h(
    "span",
    { className: "dshm-dshchip dshm-verchip", title },
    h("span", { className: "dshm-dshchip-name" }, "dsh-m "),
    h("span", { className: "dshm-dshchip-v" }, `v${version}`),
  );
}

export { DshmVersionChip };
