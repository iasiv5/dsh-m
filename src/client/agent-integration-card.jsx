/**
 * Agent 集成卡（issue #57 / 0.12.15 R3.1 单开关版）：官方插件页设置区的会话注入总开关。
 *
 * 机制（渲染门解码，子代理报告 2026-11-11）：
 * - 宿主 GUI 插件详情页的配置区 = `plugins.bundle.config` 槽位（座位制：插件自注册、自绘 UI）；
 *   未注册座位的插件，其 Config 不会在插件页出现（settings 服务注册与插件页互斥）。
 * - 槽位契约：`ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register(
 *     { name, key: <npm 包名>, locale: <ns>, inject }, (el) => createElement(Card, el) ))`。
 * - 值/写：`configForms.get(ns)` 控制器（getSnapshot / subscribe / set）——values 为 Config
 *   volatile 投影；set 直写宿主 settings 服务（config-editor 落 patch + loader 原地提交）。
 * - 两个 id 不同是头号坑：座位 key = npm 包名 "dsh-m"；settings ns = entry id "dshm"。
 *
 * 单开关语义（主人裁决 R3.1）：一个开关同步写 sessionTools/sessionPrompt 两字段；
 * 混合持久态（手改 patch）保守显示关，翻开即双写归位。级联钳制语义保留在
 * session-gate（安全网，正常操作不触发）。
 */
import React from "react";
import { lookup } from "./i18n.js";

const h = React.createElement;

/** 会话注入总开关的响应式 store（宿主 ConfigForm 控制器的附着封装）。 */
export function createSessionGateStore() {
  let state = { status: "loading", enabled: true };
  const subs = new Set();
  const notify = () => { for (const fn of subs) fn() };
  let controller = null;
  const syncFrom = (ctrl) => {
    let snap;
    try { snap = ctrl.getSnapshot() } catch { return }
    const vals = (snap && typeof snap === "object" && snap.value && typeof snap.value === "object") ? snap.value : {};
    apply({
      status: snap.status === "ready" || snap.status === "unavailable" ? snap.status : "loading",
      enabled: vals.sessionTools !== false && vals.sessionPrompt !== false,
    });
  };
  const apply = (next) => {
    if (state.enabled !== next.enabled || state.status !== next.status) { state = next; notify() }
  };
  return {
    getSnapshot: () => state,
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } },
    attach(ctrl) {
      controller = ctrl;
      syncFrom(ctrl);
      const unsub = typeof ctrl.subscribe === "function" ? ctrl.subscribe(() => syncFrom(ctrl)) : () => {};
      return () => { unsub(); if (controller === ctrl) controller = null };
    },
    /** 总开关翻转：双字段同写；失败重读控制器回滚。 */
    setEnabled(value) {
      apply({ ...state, enabled: value });
      const ctrl = controller;
      if (ctrl === void 0 || typeof ctrl.set !== "function") return Promise.resolve();
      return Promise.allSettled([
        ctrl.set("sessionTools", value),
        ctrl.set("sessionPrompt", value),
      ]).then(() => syncFrom(ctrl));
    },
    dispose() { controller = null },
  };
}

/** 「AI 会话集成」卡（自绘单开关；props.store = createSessionGateStore 实例）。 */
export function AgentCard({ store }) {
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const locked = state.status === "loading" || state.status === "unavailable";
  const on = state.enabled !== false;
  return h("div", { className: "dshm-agent-card" },
    h("div", { className: "dshm-agent-card-title" }, lookup("settings.agent.title")),
    h("div", { className: "dshm-agent-row" },
      h("div", { className: "dshm-agent-row-main" },
        h("div", { className: "dshm-agent-label" }, lookup("settings.agent.label")),
        h("div", { className: "dshm-agent-desc" }, lookup("settings.agent.desc"))),
      h("label", { className: `dshm-switch${on ? " on" : ""}${locked ? " locked" : ""}` },
        h("input", { type: "checkbox", checked: on, disabled: locked, onChange: (e) => store.setEnabled(e.target.checked) }),
        h("span", { className: "dshm-switch-slider" })),
    ),
  );
}

/**
 * 座位注册入口（main.jsx apply 调用）：
 * 守卫 configForms 可用性 → 附着 store（ns="dshm"）→ whileServed(["dshm"]) 期间注册座位。
 * 座位 key 用 npm 包名 "dsh-m"（ledger/pkg.name 比对），附着 ns 用 entry id "dshm"——两 id 不同。
 */
export function registerAgentIntegrationCard(ctx) {
  ctx.inject(["configForms"], (c) => {
    const forms = c.configForms;
    if (forms === void 0 || typeof forms.get !== "function" || typeof forms.whileServed !== "function") return;
    const store = createSessionGateStore();
    ctx.effect(() => store.attach(forms.get("dshm")), "dshm-agent-card: attach");
    const card = (el) => h(AgentCard, { ...el, store });
    ctx.effect(() => forms.whileServed(["dshm"], () => {
      ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register(
        { name: "plugins.bundle.config", key: "dsh-m", locale: "dshm" },
        (el) => h(card, el),
      ));
    }), "dshm-agent-card: seat");
  });
}
