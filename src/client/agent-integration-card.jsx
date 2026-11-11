/**
 * Agent 集成卡（issue #57 / 0.12.15 R3）：官方插件页设置区的会话注入开关。
 *
 * 机制（渲染门解码，子代理报告 2026-11-11）：
 * - 宿主 GUI 插件详情页的配置区 = `plugins.bundle.config` 槽位（座位制：插件自注册、自绘 UI）；
 *   未注册座位的插件，其 Config 不会在插件页出现（settings 服务注册与插件页互斥）。
 * - 槽位契约：`ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register(
 *     { name, key: <npm 包名>, locale: <ns>, inject }, (el) => createElement(Card, el) ))`。
 * - 值/写：`configForms.get(ns)` 控制器（getSnapshot / subscribe / set）——values 为 Config
 *   volatile 投影（settings describe 自动服务运行中条目）；set 直写宿主 settings 服务
 *   （config-editor 落 patch + loader 原地提交），失败重读控制器回滚。
 * - 两个 id 不同是头号坑：座位 key = npm 包名 "dsh-m"；settings ns = entry id "dshm"。
 *
 * 级联语义（GLOSSARY「级联钳制」）：sessionTools=false ⇒ 提示词引导强制关闭，
 * 存储保留原值、仅显示与生效被钳制。
 */
import React from "react";
import { lookup } from "./i18n.js";

const h = React.createElement;

/** 会话注入开关的响应式 store（宿主 ConfigForm 控制器的附着封装）。 */
export function createSessionGateStore() {
  let state = { status: "loading", sessionTools: true, sessionPrompt: true };
  const subs = new Set();
  const notify = () => { for (const fn of subs) fn() };
  const same = (o) => Object.keys(o).every((k) => state[k] === o[k]);
  const apply = (next) => { if (!same(next)) { state = next; notify(); } };
  let controller = null;
  const syncFrom = (ctrl) => {
    let snap;
    try { snap = ctrl.getSnapshot() } catch { return }
    const vals = (snap && typeof snap === "object" && snap.value && typeof snap.value === "object") ? snap.value : {};
    apply({
      status: snap.status === "ready" || snap.status === "unavailable" ? snap.status : "loading",
      sessionTools: vals.sessionTools !== false,
      sessionPrompt: vals.sessionPrompt !== false,
    });
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
    /** 乐观翻转 + 控制器直写；失败重读控制器回滚。 */
    setField(field, value) {
      apply({ ...state, [field]: value });
      const ctrl = controller;
      if (ctrl === void 0 || typeof ctrl.set !== "function") return Promise.resolve();
      return Promise.resolve(ctrl.set(field, value)).catch(() => { syncFrom(ctrl) });
    },
    dispose() { controller = null },
  };
}

/** 「AI 会话集成」卡（自绘；props.store = createSessionGateStore 实例）。 */
export function AgentCard({ store }) {
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const toolsOn = state.sessionTools !== false;
  const promptOn = state.sessionPrompt !== false;
  const toolsLocked = state.status === "loading";
  const promptLocked = state.status === "loading" || toolsOn === false;
  const switchRow = (labelKey, descKey, on, locked, onChange, titleKey) => [
    h("div", { className: "dshm-kvline-row" },
      h("span", { className: "rl" }, lookup(labelKey)),
      h("label", { className: `dshm-switch${on ? " on" : ""}${locked ? " locked" : ""}`, title: lookup(titleKey) },
        h("input", { type: "checkbox", checked: on, disabled: locked, onChange: (e) => onChange(e.target.checked) }),
        h("span", { className: "dshm-switch-slider" })),
    ),
    h("div", { className: "dshm-hint" }, lookup(descKey)),
  ];
  return h("div", { className: "dshm-agent-card" },
    h("div", { className: "dshm-agent-card-title" }, lookup("settings.agent.title")),
    ...switchRow("settings.agent.tools", "settings.agent.tools.desc", toolsOn, toolsLocked,
      (v) => store.setField("sessionTools", v), "settings.agent.tools"),
    ...switchRow("settings.agent.prompt", "settings.agent.prompt.desc", promptOn, promptLocked,
      (v) => store.setField("sessionPrompt", v), "settings.agent.prompt.cascade"),
    toolsOn === false ? h("div", { className: "dshm-hint" }, lookup("settings.agent.prompt.cascade")) : null,
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
