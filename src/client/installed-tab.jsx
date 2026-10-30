/**
 * ADR-0023 第三刀 T11 组件出仓·批次二（installed-tab.jsx）：自 main.jsx verbatim 迁移，函数体零重写。
 * 成员：DetailRows, InstalledTab
 */
import React from "react";
const h = React.createElement;
const { useState } = React;
import { api } from "./hooks.js";
import { lookup } from "./i18n.js";
import { installedViewModel } from "./installed-view.js";
import { toggleViewModel, toggleNoticeKeys } from "./toggle-view.js";
import { applyInstalledUpdates, batchUpgradeOrder, summarizeBatch, skippedUnsupportedNotice } from "./installed-updates.js";
import { activeMutateOp, activeProgressOp } from "./operations-view.js";
import { performUpgradeFlow } from "./upgrade-flow.js";
import { restartBannerDecision } from "./panel-ops.js";
import { Icon, Spin, PhaseDot, ToggleSwitch, TwoStepButton, LinksRow, ProgressLine, ReadmeBlock } from "./chrome.jsx";
import { Card } from "./card.jsx";

import { createOpOutcome } from "./op-outcome.js";
// op-outcome 模块级实例（与 main.jsx 同款装配）
const oc = createOpOutcome(lookup);

function InstalledTab({ notify, installed, updates, onMutation, ops }) {
  const { loading, data, error, reload } = installed;
  const updateRows = updates && updates.data && Array.isArray(updates.data.updates) ? updates.data.updates : [];
  const [openPkg, setOpenPkg] = useState(null);
  const [readmePkg, setReadmePkg] = useState(null);
  // 乐观开关（2026-10-13 UX 修复）：点击瞬间本地记录 {pkg → enabled}，开关立即翻转；
  // set-enabled 返回并重取已装数据后在 finally 清除（服务端态已收敛，无闪烁）；
  // 失败路径同样在 finally 清除＝回滚到服务端态，配合 err toast。PhaseDot/副行文案一并跟随。
  const [pendingToggles, setPendingToggles] = useState({});
  // busy 派生自操作记录（0.7.0 Task 13）——首个进行中的非 install 操作
  // #36：谓词收权 operations-view（activeMutateOp），变量名与语义不变
  const activeMutateTarget = (activeMutateOp(ops.records) || {}).target || null;
  // 进度条只服务有 pnpm 阶段的操作（install/upgrade/self-upgrade）。toggle/uninstall 挂它只会
  // 显示无信息量的「· 准备中」，还要付出 47px×2 的卡片栅格位移——开关原地丢失命中 0.6–1.3s
  // （2026-10-13 CDP 实测，01_docs/research/2026-10-13-dshm-toggle-ux-cdp-probe.md）。
  // 注意别合并进 activeMutateTarget：后者还负责逐行禁用按钮（含 toggle 自身）。
  const progressTarget = (activeProgressOp(ops.records) || {}).target || null;

  const doToggle = async (it, enabled) => {
    setPendingToggles((m) => ({ ...m, [it.pkg]: enabled }));
    const call = () => api("set-enabled", { pkg: it.pkg, enabled });
    try {
      let res;
      try {
        res = await ops.runOp("toggle", it.pkg, call, { on: enabled });
      } catch (first) {
        if (first && first.opSuperseded) throw first;
        // hmr 重组窗口可能瞬断传输（set-enabled 幂等，重试一次安全）；复用原记录（审计 #12）
        await new Promise((r) => setTimeout(r, 1500));
        res = await ops.runOp("toggle", it.pkg, call, { on: enabled }, first && first.opId);
      }
      const note = toggleNoticeKeys(res);
      const extra = (res.warnings && res.warnings.length ? `（${res.warnings.join("；")}）` : "");
      // ADR-0023 第二刀：needsRestart 判定单源（委派 toggleNoticeKeys：live→false/restart→true）；文案仍走 note.textKey
      notify({ kind: "ok", needsRestart: restartBannerDecision("toggle", res).needsRestart, text: lookup(note.textKey, note.params) + extra });
      // toggle 只重取已装视图：开关不改变 installed-ness 与版本，市场×2/updates 无需跟随
      // （原 refreshViews 五连请求 → 1 个；渲染churn 同步下降，不稳定窗口缩短）
      await reload();
    } catch (e) {
      // 0.9.94 变更结局描述（op-outcome）：toggle 无守卫路径，guard 分支自然不触发
      const m = oc.mutationFailed(e, { verb: "toggle", target: it.pkg });
      notify({ kind: m.kind, text: m.text });
    } finally {
      // 成功＝服务端数据已收敛后摘除乐观覆盖；失败＝直接回滚到服务端态
      setPendingToggles((m) => {
        if (!(it.pkg in m)) return m;
        const { [it.pkg]: _drop, ...rest } = m;
        return rest;
      });
    }
  };

  const doUninstall = async (it) => {
    try {
      const res = await ops.runOp("uninstall", it.pkg, () => api("uninstall", { pkg: it.pkg }));
      notify({
        kind: "ok",
        // ADR-0023 第二刀：横幅判定单源（uninstall 字面 true）
        needsRestart: restartBannerDecision("uninstall").needsRestart,
        text: lookup("notify.uninstalled", { pkg: res.pkg }) +
          (res.liveDisabled ? lookup("notify.livedisabled") : "") +
          (res.leftovers && res.leftovers.length ? lookup("notify.leftovers", { paths: res.leftovers.join(", ") }) : ""),
      });
      await (onMutation ? onMutation() : reload());
    } catch (e) {
      // 0.9.94 变更结局描述（op-outcome）
      const m = oc.mutationFailed(e, { verb: "uninstall", target: it.pkg });
      notify({ kind: m.kind, text: m.text });
    }
  };

  // issue #10 修复② + ADR-0026 三态化：返回 'ok'（成功含降级恢复/良性跳过）/ 'target'（目标级
  // 失败——批量跳过继续）/ 'systemic'（系统性失败——批量短路，issue #10 语义保留）。
  // 单点升级按钮不看返回值，行为零变化；transport 语义零特判（R6 不变，见 installed-view 锚测试）。
  // #36：编排出仓 upgrade-flow 单点（enqueue-meta/opMeta 落账/degraded→notify 链单源——
  // cdc8404 一处 bug 多站同步修病灶消除；0.9.75 版本变迁落账 + 0.10.3 toVersion 对账依据 +
  // 0.10.20 from 持久化语义随编排走，注释信息并集见 upgrade-flow.js doc）。
  const doUpgrade = async (it) => {
    return performUpgradeFlow({
      ops, oc, target: it.pkg,
      apiCall: () => api("upgrade", { pkg: it.pkg }),
      refresh: onMutation ? onMutation : reload,
      notify,
      from: it.version, toVersion: it.latestVersion
    });
  };

  if (loading && !data) return h("div", { className: "dshm-empty" }, lookup("installed.loading"), Spin());
  if (error) return h("div", { className: "dshm-err" }, lookup("failed.read", { err: error }));
  // 两段加载（ADR-0008）：items 指向 merged 视图；updates 未到时即第一段原样（卡片暂无更新提示，常态安静）
  const items = applyInstalledUpdates((data && data.items) || [], updateRows);
  // issue #10 修复③：批量目标定序单源（dsh-m 收尾）——按钮计数/可见性/批量循环共用一份
  const batch = batchUpgradeOrder(items);
  if (!items.length) return h("div", { className: "dshm-empty" }, `${lookup("installed.empty")} (${data.profileDir})`);

  return h(
    React.Fragment,
    null,
    h("div", { className: "dshm-hint" }, lookup("profile.hint", { path: data.profileDir })),
    data.others > 0
      ? h("div", { className: "dshm-others" }, lookup("installed.others", { n: data.others }))
      : null,
    batch.targets.length > 0
      ? h(
          "div",
          { className: "dsvm-sortrow" },
          h(
            "button",
            {
              className: "dshm-btn primary sm",
              disabled: activeMutateTarget != null,
              onClick: async () => {
                // issue #10 修复①②：逐项 await 串行 + systemic 短路（旧实现一次性 void 丢 Promise 全发——
                // 后端事务 FIFO 虽串行，但市场插件自换装（宿主重载本体）夹在普通项之间时，后续项
                // 的事务/frozen 复验在刚变过的 profile 上必炸，0.10.8/0.10.13 实机实证「一项成功一项
                // exit 1、单项重试即愈」；短路同时避免在 manual-repair 半残 profile 上继续后续项。
                // 定序：batchUpgradeOrder——dsh-m 收尾，自换装永无后续项。
                // 失败项的「哪一项 + 错误原文」由 doUpgrade 既有 per-item 通知保留（串行后不再互相淹没）。
                // ADR-0026（issue #30）：三态收集——target 失败跳过继续（B4），systemic 失败短路
                //（issue #10 语义保留）；unsupported 项已被 batchUpgradeOrder 排除、零请求直入汇总。
                const outcomes = [];
                let stoppedAt = null;
                for (const it of batch.targets) {
                  const outcome = await doUpgrade(it);
                  outcomes.push({ pkg: it.pkg, outcome });
                  if (outcome === "systemic") {
                    stoppedAt = it.pkg;
                    break;
                  }
                }
                const summary = summarizeBatch(outcomes, batch.unsupported.length);
                // B8 行为零变化：全成功 + 无 unsupported = 无新增横幅；有失败/跳过才汇总（非对称 notify：失败必须响）
                if (summary.targetFailed > 0) {
                  notify({ kind: "warn", text: lookup("installed.upgradeBatch.targetFailed", { n: summary.targetFailed }) });
                }
                if (summary.stopped && stoppedAt) {
                  notify({ kind: "err", text: lookup("installed.upgradeBatch.stopped", { target: stoppedAt }) });
                }
                if (summary.skippedUnsupported > 0) {
                  // #35：按成因码分组提示（退役单段「本地链接安装」文案——unsupported 还涵盖
                  // github-spec-unparseable / source-unresolvable，硬编码成因失实）
                  const skippedNotice = skippedUnsupportedNotice(batch.unsupported, lookup);
                  if (skippedNotice) notify({ kind: "warn", text: skippedNotice });
                }
              },
            },
            lookup("installed.upgradeAll", { n: batch.targets.length }),
          ),
          batch.selfIncluded
            ? h("span", { className: "dshm-hint", key: "self-last" }, lookup("installed.upgradeAll.selfLast"))
            : null,
        )
      : null,
    progressTarget ? h(ProgressLine, { key: "prog" }) : null,
    h(
      "div",
      { className: "dshm-cards" },
      items.map((it) => {
        const vm = installedViewModel(it);
        const pendingOn = pendingToggles[it.pkg];
        const tvm0 = toggleViewModel(it);
        // 乐观翻转覆盖开关视觉；停用时相位点按不变量清空（enabled===false → 相位 null）
        const tvm = pendingOn === undefined
          ? tvm0
          : { ...tvm0, switchOn: pendingOn, ...(pendingOn === false ? { phaseDotClass: "", phaseLabelKey: null } : {}) };
        return Card({
          key: it.pkg,
          icon: h(Icon, { entry: { name: it.name, github: vm.githubRepo, icon: null, iconDataUri: it.iconDataUri ?? null } }),
          name: it.name,
          topRight: h(ToggleSwitch, {
            vm: tvm,
            disabled: activeMutateTarget === it.pkg,
            onChange: (enabled) => doToggle(it, enabled),
          }),
          badges: [
            it.outdated ? h("span", { className: "dshm-badge warn", key: "u" }, `⬆ ${vm.latestLabel}`.trim()) : null,
            it.community === true
              ? h("span", { className: "dshm-badge info", key: "r" }, lookup("badge.community"))
              : it.registryId
                ? h("span", { className: "dshm-badge", key: "r" }, lookup("badge.market"))
                : h("span", { className: "dshm-badge info", key: "r" }, lookup("badge.nonmarket")),
          ],
          desc: it.description || "（无描述）",
          sub: [
            h(PhaseDot, { key: "dot", vm: tvm }),
            pendingOn === undefined
              ? (vm.phaseKey ? lookup(vm.phaseKey) : lookup(vm.enabledLabelKey))
              : lookup(pendingOn ? "toggle.state.on" : "toggle.state.off"),
            `v${it.version || "?"}`,
            vm.sourceLabelKey ? lookup(vm.sourceLabelKey) : it.source,
            vm.latestIssue ? lookup("installed.check.incomplete") : null,
          ]
            .filter(Boolean)
            .map((part, i) => (i === 0 ? part : [" · ", part]))
            .flat(),
          links: h(LinksRow, {
            npm: it.source === "npm" ? it.pkg : null,
            github: vm.githubRepo,
          }),
          open: openPkg === it.pkg,
          onToggle: () => setOpenPkg(openPkg === it.pkg ? null : it.pkg),
          detail: readmePkg === it.pkg
            ? h(ReadmeBlock, { pkg: it.pkg, repo: vm.githubRepo }) // 0.9.49：已装行走视图模型三级兜底（registryGithub/package.json repository/spec 解析），此前误传不存在的 it.github 导致相对链接全归 #
            : DetailRows([
                [lookup("detail.pkg"), it.pkg],
                [lookup("detail.spec"), it.spec],
                [lookup("detail.latest"), vm.latestLabelDetail],
                [lookup("detail.listed"), it.registryId || lookup("detail.listed.no")],
                [lookup("detail.path"), it.path],
                vm.latestIssue ? [lookup("installed.check.incomplete"), vm.latestIssue.note] : null,
                vm.guard.warnKey ? [lookup("detail.note"), lookup(vm.guard.warnKey, vm.guard.warnParams)] : null,
              ]),
          actions: [
            h("button", {
              key: "rd",
              className: "dshm-btn sm",
              onClick: (e) => {
                e.stopPropagation();
                setReadmePkg(readmePkg === it.pkg ? null : it.pkg);
              },
            }, readmePkg === it.pkg ? lookup("readme.hide") : lookup("readme.show")),
            it.outdated
              ? h("button", {
                  key: "up",
                  className: "dshm-btn primary sm",
                  disabled: activeMutateTarget === it.pkg,
                  onClick: (e) => {
                    e.stopPropagation();
                    doUpgrade(it);
                  },
                },
                activeMutateTarget === it.pkg ? h(Spin) : lookup("action.upgrade"))
              : null,
            h(TwoStepButton, {
              key: "un",
              label: lookup("action.uninstall"),
              confirmLabel: lookup(vm.guard.confirmKey),
              className: "dshm-btn sm",
              disabled: activeMutateTarget === it.pkg,
              onConfirm: () => doUninstall(it),
            }),
          ],
        });
      }),
    ),
  );
}

function DetailRows(rows) {
  const list = rows.filter(Boolean);
  return h(
    "div",
    { className: "dshm-kv" },
    list.flatMap(([k, v]) => [
      h("span", { className: "k", key: `${k}-k` }, k),
      h("span", { key: `${k}-v`, style: { wordBreak: "break-all" } }, v),
    ]),
  );
}

export { DetailRows, InstalledTab };
