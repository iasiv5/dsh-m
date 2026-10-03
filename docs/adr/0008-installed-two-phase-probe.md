# 已装页两段加载：列表与更新探测拆分 + 第二段 TTL=0 永远新鲜（ADR-0008）

## 决策

已装页从「单段阻塞」改为**两段加载**：第一段 `installed {probe:false}`（`listInstalledWithMeta` probeMode `'none'`）立即返回已装列表（保留 registry 匹配与 enablement，仅跳过探测段）；第二段 `installedUpdates`（probeMode `'only'`，**ttlMin=0 永远新鲜**）与第一段在面板挂载时并行发起，探测完成后 ⬆ 徽标 / tab 红点 / 「全部升级 (N)」就地补上。背景：单段模式把探测焊在已装列表接口里且带 60min 内存 TTL（ADR-0006），2026-10-03 实录发版后 17 分钟重开面板仍无提示（同刻 dshmarket 已见）——同业 dshmarket 的「列表与 `/updates` 分离」即本决策原型。呈现纪律：探测**完成后**的失败逐项复用「检查未完成」（latestError 路径，不冒充「全部最新」）；phase-2 in-flight（约 1–3s）瞬时无提示、与「没得更新」同形——有意接受（常态安静）；第二段传输级整体失败静默（与浏览页后台刷新失败同语义）。范围仅已装页：市场浏览页探测（60min TTL）、`dshm_list`/`dshm_outdated` 工具、CLI 行为零变化（全部调用点缺省 probeMode `'full'`）。

## Considered Options

- **单段全量 TTL=0（已装页每次打开阻塞重探）**：被否——牺牲已装页秒开，弱网下每次打开都吃探测延迟；两段化以一次结构改动同时保住秒开与新鲜。
- **仅降探测 TTL（独立 5min）**：被否——发布连发窗口内仍盲（实测 38 分钟连发四版的节奏会零星踩到），「打开即见」不可靠。
- **维持 60min TTL 现状**：被否——「发版→重开面板→无提示」正是本决策要消灭的痛点。
- **拆段结构对齐 dshmarket（本决策）**：列表与更新分离是同业生产验证过的结构；第二段不做 TTL（与 dshmarket 的 30min 不同）是因为主人的发布-查验节奏要求「打开即见」。

## Consequences

- 每次面板挂载一轮真实探测：GitHub 被动预算**上限**不变（25/req、50/h 滚动）但**消耗速率**上升（现状 TTL 内开面板 0 探测），超限走 `latestError` 优雅降级；**预算回退通道**——若实机预算触顶常态化（latestError 增多），回退 = `'only'` 路径改独立 namespace，代价是 write-back 不再跨视图受益。
- **ttl=0 先删共享条目**（latest-cache.ts L42 警示语义的有意援引）：已装页 matched 键与浏览页/`dshm_list`/`dshm_outdated` 键同处 host namespace、共享同一内存 Map，面板挂载使这些消费者在 TTL 内改吃新鲜 write-back 值——数据只会更新鲜，各消费者代码路径与自身 TTL 制度不变。
- 版本错配降级：新面板对旧宿主调 `installedUpdates` 得结构化错误 → `updates.data` 为 null → 无徽标（静默）；旧宿主忽略 `probe:false` 未知字段 → 回落全量探测（无害）。
- ADR-0006 的内存缓存制度对浏览页/工具/CLI 继续有效；mutation 定向失效保留（对 ttl=0 路径无害，与「每次挂载重探」构成双保险）。
- npm staged 发布窗口（~17min，know-how 018）是任何客户端方案共同的下限，本决策不改变它。
