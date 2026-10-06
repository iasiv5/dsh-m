# 市场页两段加载与 force 探测穿透（0.9.45，ADR-0013）

背景：ADR-0006 将 latest 探测缓存定为纯内存（「重启即失效」是特性），代价是重启后首开当前页全部重探 inline 阻塞响应（正常网络 0.6–1.5s，弱网实测 8–16s——0.9.32 记载的网络现实）；ADR-0008 已在已装页确立两段加载范式（probeMode full/none/only）。本 ADR 把两段范式扩展到市场页，并按 ADR-0006 在案的实现约束重开其暂缓的「force 穿透探测缓存」裁决。

## Considered Options

- **服务端 latest SWR**（TTL 过期回旧值 + 后台单飞）：修不了重启冷路径（缓存为空无 stale 可回），且引入「旧值冒充最新」的呈现风险——0.9.20 事故的同类形态，被否。
- **维持现状**：快照已让页面秒开，但徽标滞后在弱网首开可感（8–16s），且随条目增长线性恶化，被否。
- **市场页两段加载（采纳）**：第一段 probeMode:'cache-only' 零网络回页（缺口 → latestComplete=false，缺口判定豁免社区 github 条目——Q46 永久缺口不构成第二段理由），第二段既有 'full' 语义就地补全；服务端缓存制度零改动。

## force 语义（重开 ADR-0006 暂缓裁决）

- **采纳「peek 不删除 + 全页重探」**：force 时以 peekLatestCache 取旧值兜底展示（不判 TTL、不删除），全页重探成功覆盖缓存、失败保留旧值 + latestError——严格落实 ADR-0006 在案约束「实现须用 peek 不删除语义，而非 ttlMin=0 先删后探（失败时旧值丢失）」，重探失败不产生空徽标窗口。
- **不引入市场页 'only' 模式**：已装页 'only'（ttlMin=0 先删后探）是「打开即见新鲜」语义，与 force 的「旧值兜底重探」不同质；把 ADR-0006 明示拒绝的先删后探带进浏览页无正当性。
- 接线：设置页「强制刷新」→ onForceMarket → marketReloadAll(true) → reload(force) → core peek 重探——ADR-0006 暂缓裁决的盲区（「不重启 + TTL 内」）收敛为零。

## Consequences

- latestComplete 语义扩展：cache-only 有缺口时为 false（此前仅探测超时为 false）；消费方只有 GUI 客户端。
- 服务端**永不回 stale**：TTL 过期 = 缺口 → 第二段补全。需求侧研究（2026-10-06 §6.1 P1）原拟「stale 值渲染为显式检查中」的通过条件，被 grill 再裁决（Q10）替代为「第一段安静、不占位」——旧值只在会话内经 mergeLatestFields 保留到第二段完成；第二段失败静默保留（Q11②）为有意接受，不冒充最新。
- mergeLatestFields 的动机口径：会话内上一轮响应 → cache-only 首段（快照不含 latest 族字段，重启场景天然无徽标可保）；不做「快照存 latest」扩展（超出本批）。
- 浏览态每次筛选变化最多 +1 次请求（第一段零网络、第二段即既有探测成本；纯 github 社区页无第二段）。
- 快照写入后移到终态（第二段 merge 完成或第一段无缺口），intermediate 态不入快照。
- tools/CLI 的 withLatest=false 通路与三端搜索契约零变化；probeMode 缺省 'full' 时 core 行为与 0.9.44 等价。
- U12 边界：收藏快照存 verified/audience/decoupled 三字段但收藏区**不打**受众/解耦标（DESIGN §2.7 裁决⑤不动）；「精选」「已实测」徽标为身份/质量呈现，不在裁决射程内。
