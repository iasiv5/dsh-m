/**
 * ADR-0023 第三刀 T10 组件出仓·批次一（operations-card.jsx）：自 main.jsx verbatim 迁移，
 * 函数体零重写；依赖经 ESM import 显式接线（由抽取脚本按标识符使用自动生成）。
 * 成员：OperationsCard
 */
import React from "react";
const OP_STATUS_CLS = {
  queued: "", running: "run", input: "warn", done: "ok", warned: "warn", failed: "err", superseded: "sup",
};

const h = React.createElement;
const { useMemo } = React;
import { api, useScrollableContain } from "./hooks.js";
import { lookup } from "./i18n.js";
import { TERMINAL_CLEARABLE } from "./operations.js";
import { groupOpsByDay, opRowVm, canRemoveRow, channelLabelKey, isInflightStatus } from "./operations-view.js";
import { Spin, XIcon } from "./chrome.jsx";

// 操作记录卡（0.9.x 布局重构·第二批）：从面板底部搬迁至设置 tab 末位恒通宽卡。
// 结构契约：进行中组在滚动区外常驻（进度反馈不被滚走）；已结束组进 220px 滚动区；
// 「清除已结束」钉底；空态显示 hint 卡（导览：记录搬到这里了）。终态展示上限 50 条
// （store 无上限，滚动区只管 UI 高度，条数上限防 DOM 无界增长）。
function OperationsCard({ records, onClearFinished, onRemove }) {
  // #36：在途闭集单点 isInflightStatus（queued/running/input），语义不变
  const active = records.filter((r) => isInflightStatus(r.status));
  // 0.9.79（R1-7）：标题计数 = 合并后全量终态总数；slice(-50) 只作渲染截断（最近 50 条照旧），
  // 外部记录并入后计数不再因截断失真。
  const finishedAll = records.filter((r) => active.indexOf(r) < 0);
  const finished = finishedAll.slice(-50);
  // 0.9.6：清除按钮覆盖全部终态（含 failed/superseded，主人裁决）——无可清终态时置灰并说明，
  // 不再做无声 no-op（Windows 实机反馈：按钮对着失败记录点了没反应）。
  const clearable = records.some((r) => TERMINAL_CLEARABLE.has(r.status));
  // 0.9.72 滚轮治理：已结束滚动区可滚才挂 contain；同时补键盘可达（0.9.45 U8 纪律）
  const [scrollRef, scrollCls] = useScrollableContain(finished.length);
  // 0.9.75 信息增强：已结束按日分组（新组在上、组内新→旧，最新一条贴标题可见不用滚动找）
  const dayGroups = useMemo(() => groupOpsByDay(finished), [records]); // eslint-disable-line react-hooks/exhaustive-deps -- finished 派生自 records
  // 行渲染（0.9.75）：展示派生全部收敛到 operations-view.js 的 opRowVm——
  // 行内时刻（title 给完整到秒）、开关/社区开关方向徽章（meta.on，旧记录已持久化立即可读）、
  // 升级版本变迁（meta.from/to，泵 0.9.75 起落账）、终态耗时。
  // 字段缺席逐段省略（等价旧行），target 恒在。0.9.76：「对话」来源徽章退役——meta.session
  // 是泵所有权标记（GUI 的 runOp 与对话镜像两路同打、persist 时剥离），不是来源语义，
  // 展示层不得消费（0.9.75 把它渲染成「对话」徽章属误报，主人界面全点按钮即全员误标）。
  // 0.9.79：外部记录行追加渠道徽标（lookup(channelLabelKey)，Agent 工具/命令行/外部兜底）。
  const row = (r) => {
    const vm = opRowVm(r);
    const tip = [vm.full, vm.durText, r.error || r.warning || ""].filter(Boolean).join(" · ");
    return h(
      "div",
      { key: r.id, className: `dsvm-oprow ${OP_STATUS_CLS[r.status] || ""}` },
      vm.clock ? h("span", { className: "dsvm-optime", title: vm.full }, vm.clock) : null,
      h("span", { className: "dsvm-opstatus" }, lookup("op.status." + r.status)),
      h("span", { className: "dsvm-opkind" }, lookup("op.kind." + r.kind)),
      vm.channel ? h("span", { className: "dsvm-opchan", title: lookup(channelLabelKey(vm.channel)) }, lookup(channelLabelKey(vm.channel))) : null,
      vm.dir ? h("span", { className: `dsvm-opdir ${vm.dir}` }, lookup(vm.dir === "on" ? "op.state.on" : "op.state.off")) : null,
      h("span", { className: "dsvm-optarget", title: tip || undefined }, vm.target),
      vm.version ? h("span", { className: "dsvm-opver", title: tip || undefined }, vm.version) : null,
      vm.durText ? h("span", { className: "dsvm-opdur" }, vm.durText) : null,
      r.status === "running" ? Spin() : null,
      r.error ? h("span", { className: "dsvm-opnote" }, r.error) : null,
      r.warning ? h("span", { className: "dsvm-opnote" }, r.warning) : null,
      // 单条移除（终审·新伤2 → 0.9.79 R3-1/R2-3 → 0.9.82 修订 R2-3）：出口判定下沉 canRemoveRow——
      // 本地 input/failed/superseded 保留 ✕；外部记录 failed 放行（服务端 per-id delete 已建），
      // done 仍不给 ✕。onRemove 收整行 record，onOpsRemove 按 channel 分流（本地 remove / 外部 api）。
      canRemoveRow(r) && onRemove
        ? h("button", { className: "dshm-xbtn", title: lookup("op.remove"), onClick: () => onRemove(r) }, h(XIcon))
        : null,
    );
  };
  return h(
    "div",
    { className: "dshm-section dshm-ops-card" },
    h("div", { className: "dshm-section-title" }, lookup("settings.ops")),
    active.length && finished.length ? h("div", { className: "dsvm-ops-caption" }, lookup("settings.ops.group.active")) : null,
    active.length ? h("div", { className: "dsvm-opgroup" }, ...active.map(row)) : null,
    finished.length
      ? h(
          "div",
          { className: "dsvm-ops-caption", style: { marginTop: active.length ? "7px" : "0" } },
          lookup("settings.ops.group.done.n", { n: finishedAll.length }),
        )
      : null,
    finished.length
      ? h(
          "div",
          {
            className: `dshm-ops-scroll${scrollCls}`,
            ref: scrollRef,
            tabIndex: 0,
            "aria-label": lookup("settings.ops"),
          },
          h(
            "div",
            { className: "dsvm-opgroup done" },
            // 0.9.75 按日分组：组头 今天/昨天/YYYY-MM-DD（lookup 键缺席语言回退由 lookup 承担；
            // createdAt 非法的末组 key='' 不给日期头，行照常渲染）
            ...dayGroups.map((g) =>
              h(
                React.Fragment,
                { key: g.key || "op-day-unknown" },
                g.key
                  ? h("div", { className: "dsvm-opday" }, g.kind === "today" ? lookup("op.day.today") : g.kind === "yesterday" ? lookup("op.day.yesterday") : g.key)
                  : null,
                ...g.records.map(row),
              ),
            ),
          ),
        )
      : null,
    finished.length
      ? h(
          "div",
          { className: "dshm-actions" },
          h("button", { className: "dshm-btn sm", disabled: !clearable, title: clearable ? undefined : lookup("op.clear.none"), onClick: onClearFinished }, lookup("op.clear")),
        )
      : null,
    !active.length && !finished.length ? h("div", { className: "dshm-hint" }, lookup("settings.ops.empty")) : null,
  );
}

export { OperationsCard };
