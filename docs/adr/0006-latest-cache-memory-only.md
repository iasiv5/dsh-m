# latest 探测缓存退回纯内存 + mutation 定向失效：「重启即失效」回归为特性（0.9.20，ADR-0006）

dsh-m 的「最新版本」探测结果（latest probe）自 0.9.14 起采用「内存 Map + 磁盘信封 write-through + 懒 seed」的落盘缓存，跨服务重启存活，失效通道只有 TTL 一条（`cacheTtlMin`，默认 60 分钟）。2026-10-03 凌晨的事故实证了该制度在发布方场景下的失败：00:22:58 缓存写入（latest=0.1.15）→ 00:27–01:05 连发 0.1.16–0.1.19 → 01:07 重启 DSH → 01:13 打开市场面板仍显「最新 v0.1.15」，`dshm_outdated` 同步误报全部最新——重启与重开面板都在 TTL 盲区内，唯一出路是等过期或手删 `<cacheRoot>/latest/<ns>.json`。我们决定两件事（0.9.20）：① **latest 缓存退回纯内存**（Map + TTL，磁盘信封层整体退役），「重启即失效」从缺陷回归为特性——发版后「重启一下就好」重新成立，代价是重启后首轮受限重探（8 并发 + deadline 兜底，TTL 内只付一次）；0.9.14 遗留的 `latest/<ns>.json` 惰性文件由探测段一次性 best-effort 清扫。② **mutation 定向失效**：install/upgrade/uninstall 事务成功点按 itemId 尾段作废该条目的全部 registryKey 缓存变体（浏览页键 / 已装页 matched 键 / npm-only 键），升级后卡片不再出现「已装新版 / 最新旧版」自相矛盾；**只失效不回写**——故意装旧版（`opts.version`）时回写会伪造 latest=已装，registry 真值交给下一次探测。

设计依据：移交分析报告《dsh-m latest 探测缓存：事故复盘 × dshmarket 1.66.8 制度对照 × 移植评估》（2026-10-03 01:45）与对 repo 0.9.19（commit 32033df）的逐条源码核验；同业 dshmarket 的 updates 缓存为「纯内存 + 30 分钟 + force=1 穿透 + mutation 后失效 + 输入变化弃缓存」的多通道制度，其中「纯内存 + mutation 失效」两条与本决策同构。

## Considered Options

- **保留落盘，靠调低 `cacheTtlMin` / 手删信封缓解（零改码）**：盲区压缩但不消除，且依赖人工记忆，无制度保证——被否。
- **force 穿透探测缓存（对照 dshmarket `force=1`）**：技术上可行（客户端→host-api 的 force 通道已存在；实现须用「peek 不删除」语义而非 `ttlMin=0`——后者会先删旧值再探测，失败时旧值丢失），但主人拍板暂缓：设置页「强制刷新」的语义就是精选清单刷新，保持不动；残余盲区仅「不重启 + TTL 内」一种，将来需要时可便宜补上。
- **mutation 后回写刚装版本**：被否——`opts.version` 允许故意装旧版，回写会把 latest 伪造为已装版本；失效后重探得到的才是 registry 真值。
- **浏览页 GitHub 探测补预算（对齐已装页 `createGithubRequestBudget`）**：暂缓——现行精选清单 19 条全部 npm 源、社区 github 条目又被 Q46 豁免，浏览页 github 分支今天走不到，收益为零；将来收录 github 源条目前补齐即可。
- **照搬 dshmarket 的 git smart-HTTP 绕 REST**：不采纳——dsh-m 的收录模型、预算治理与错误四分类都建立在 REST 语义上，改造成本大且已有自己的配额制度（DESIGN §2.5 Q46）。

## Consequences

- **重启语义反转**：重启后首次打开市场/已装页，当前页条目全部重探（首页最多 96 条、8 workers、60s deadline 兜底，正常网络约 1–4 秒；TTL 内存续期内后续打开照旧秒开）。registry/社区**目录正文**的落盘缓存与 SWR 不受影响，页面骨架照旧秒开。0.9.14 CHANGELOG「Persistent probe cache … no probe replay on the first open after a DSH service restart」一项自此退役。
- **卡片自洽**：经 dsh-m 升级后，该插件卡片下次打开即显示 registry 真值；`dshm_outdated` 对刚升级包诚实。
- **卸载尽力而为**：uninstall 只持有 pkg 名，npm 源的 `npm:<pkg>` 键可清；github 源条目的 `gh:<owner/repo>` 键不可逆推，交由 TTL 自然过期（卸载后已装列表无此条目，不存在「已装/最新」自相矛盾场景）。
- **命名空间与 profile**：`host`/`cli` 双 namespace、按 profile 分段的语义不变（清扫按 (namespace, profile) 记忆化执行）；`latest/` 在 nsDir 之外、不受 `pruneCaches` 顶层 `*.json` 清扫的不变量不变（registry.test.mjs 回归用例保留，文件改为用例自植）。
