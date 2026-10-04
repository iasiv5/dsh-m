# npm registry 路由自适应：元数据预取按读分类选源（检测读权威链、履约读生效源优先）

dsh-m 的元数据预取（版本探测/兼容预检/packument 预热/publish-time 查询）自 0.4.x 起写死直连 `registry.npmjs.org`（`src/core/versions.ts` `registryBase` 缺省值、`release-age.ts` `npmPackumentTimes` 字面量）。2026-10-04 在上海 Windows 桌面机（desktop profile）上，该直连间歇性超时/失败，`@inventec/dsh-copilot-auth@1.2.8` 连续两次升级在**委派 pnpm 之前**夭折（操作报错原文 `fetch failed`、`The operation was aborted due to timeout`；判别特征：`.plugin-manager/logs` 无对应 pnpm.log）。同日网络取证：npmmirror 上 1.2.8 早已同步、排除块包名级已在、pnpm 通道当日三连成功——故障唯一落在 dsh-m 自己的 npmjs 直连。同批部署在首尔腾讯云的机器 npmjs 直连良好且快。另一层隐患：`httpx.ts` 用裸全局 `fetch`，既不吃 `HTTP(S)_PROXY`（Node 全局 fetch 无视代理 env，官方 dsh-market `net.ts` 实测），也暴露在宿主进程 undici 全局 dispatcher 污染之下（`net.ts` #742 实录：宿主 undici 写 `.1` 槽后全局 fetch 拿到 gzip 空头响应、JSON.parse 失败）。

我们决定（2026-10-04，评审三轮 20 项闭环后拍板；实施计划 `docs/plans/2026-10-04-npm-route-adaptive-implementation-plan.md`）：

1. **读分类是选源中枢**——不同读对「新鲜度」与「可用性」的敏感度不同，不搞一刀切：

   | 读 | 分类 | 主源 | 次源 |
   |---|---|---|---|
   | `npmLatest`（升级探测） | 检测读，新鲜度敏感 | npmjs（首腿超时 `Math.min(timeoutMs, 5_000)`） | 生效源 |
   | `npmPackumentTimes`（发布时刻） | 检测读，权威敏感 | npmjs（同上收紧） | 生效源 |
   | `npmVersion`（精确版本元数据） | 履约读，滞后敏感（镜像未同步即 404） | 生效源 | 失败/404 → sync+等待+重试一次 → npmjs |
   | `npmPackument`（B3 预热等） | 履约读 | 生效源 | — |

   检测读走权威链的理由：`npmLatest` 决定「有没有新版」。若它落到滞后镜像，自研包发布窗口内探测返回「已是最新」→ 升级根本不发起 → 一切下游自愈（sync/B3）永不触发。这是 ADR-0006 刚定性为事故的「误报已是最新」形态，且会破坏 020 §8.4 验收过的「窗口内自研包产品内即时升级」产品承诺。权威链首腿 5s 封顶，把 npmjs 抖动的代价从「20s×N 硬失败」压到「每检测至多一次 5s 后降级」。
2. **L1 路由层（新模块 `npm-route.ts`）**：候选源 = `DSHM_NPM_REGISTRY` env（最高优先，设了跳过探测）> `[.npmrc registry, npmjs, npmmirror]` 去重；probe-once（`Promise.any` 探 `semver/latest`，2.5s 共享预算，胜者须 ok+完整 body+合法 JSON 带 `version`）+ single-flight（并发共享 in-flight）；决策持久化 `<cacheDir()>/npm-route.json`，生效源变化时广播清缓存。**对官方 region-probe 立场的一处显式偏离**：全候选失败仅内存回退 npmjs、不落盘，且回退态 60s TTL 过期后允许重探——官方持久化回退值，但 dsh-m 跑在长驻 GUI 宿主进程里，坏决策用户不可见、恢复口（删文件/设 env）不可发现；瞬时全断网首跑不得把错误决策钉死整个进程生命周期。
3. **L2 自愈边界：sync 只救「镜像滞后」，不救「网络中断」**。npmmirror 按需同步（know-how 020 §2.2/§3.1：`PUT registry-direct.npmmirror.com/<pkg>/sync?sync_upstream=true`，受理后 12–15s 可见）只部署在两个「已知目标版本」的触发点：①`npmVersion` 履约阶梯（生效镜像 404 → sync → 有界等待 10s → 同源重试一次 → npmjs 兜底）；②pnpm 委派 `NO_MATCHING_VERSION`（B3，经 dsh-cli 分类层结构化的 `registry` 字段识别，上层零 regex）→ sync → 既有退避重试。检测读权威链**不设** sync 腿：两腿全败属网络型失败，sync 无的放矢。sync 成功后作废 latest 缓存。`DSHM_MIRROR_SYNC=0` 一键关闭（行为回到现状）。
4. **L0 传输层**：`httpx.ts` 换 undici 自带 fetch + 自建 dispatcher（`Agent`/`EnvHttpProxyAgent`，后者以 `resolveProxyConfig()` 结果**显式构造**——官方 net.ts:110 点名 EnvHttpProxyAgent 自身只读 http(s)_proxy，npm_config_* 不显式交接会静默直连）；代理来源 = 标准 env（小写优先）+ `npm_config_*` 兜底；method 联合扩 `'PUT'`（唯一扩面，仅供 sync 原语）；网络层错误附 `via`（掩码代理 URL 或 `direct`），`describeFetchFailure` 仅对代理渲染「（经 …）」。loopback 目标不自动豁免代理（跟随官方语义，交 NO_PROXY）。安全基线 §17.1 逐字不动。
5. **版本**：0.9.32。

## 与 0.4.x「元数据源竞速」退役决策的关系

DESIGN.md 在案：0.4.0 曾引入 npmjs/npmmirror `/-/ping` 竞速选元数据源，0.4.x 退役。退役三理由在新前提下重新回答：①「官方竞速只服务安装对话框预选交互，dsh-m 无此交互」——本 ADR 的探测同样不服务任何对话框，它服务于「元数据预取存活」本身，是可用性基建而非交互；②「host 实测 npmjs（~175ms）稳定快于 npmmirror，探测恒等默认值」——该实测来自当时的部署环境，已被 2026-10-04 上海机实录推翻（npmjs 直连间歇不可达，fetch failed/timeout）；探测正是为了不再假设「哪个源快」恒定不变；③「元数据读取已有 TTL cache + deadline 预算」——保留不动，本 ADR 只换「cache miss 时打谁」。且本方案非逐请求竞速（0.4.x 形态），是 probe-once 持久化 + 按读分类，探测成本一次 2.5s 预算而非每请求双发。结论：不构成翻案冲突，是前提变化后的重新决策。

## Considered Options

- **静态 env-only（`DSHM_NPM_REGISTRY`，无探测）**：保留为逃生口（候选链最高优先），但不作为主机制——要求每台机器手工配置，违背「上海/首尔零配置各自正确」的目标；且不解决 #742/代理不可知。
- **每次启动自动重探（无持久化）**：官方明确否决过（region-probe.ts：「re-probing every boot would let a market silently change routes between runs」——「昨天还很快」将不可调试）。probe-once + 持久化 + 显式重置保留官方立场。
- **逐请求双源竞速（hedged request）**：读请求翻倍、边际收益小；0.4.x 竞速的教训 + 官方 first-past-the-post 一次性探测已覆盖需求。
- **全败回退落盘（官方形态）**：见决定 2 的偏离理由。
- **读分类只做权威链、履约读不设阶梯**：兼容预检会在滞后镜像上 404、升级死于预检阶段、到不了 B3——履约阶梯与检测权威链缺一不可。

## Consequences

- 新模块 `src/core/npm-route.ts`；`httpx.ts`/`versions.ts`/`release-age.ts`/`latest-cache.ts`/`dsh-cli.ts`/`profile-transaction.ts` 按实施计划接线；新增依赖 `undici`（7.x 精确 pin，dsh-market 生产同款线）。
- 新环境变量：`DSHM_NPM_REGISTRY`（元数据预取源覆盖；设了跳过探测，最高优先）、`DSHM_MIRROR_SYNC=0`（关闭镜像同步自愈）。注意与既有 `DSHM_REGISTRY_URL`（收录清单源，非 npm registry）无关。
- 决策文件 `<cacheDir()>/npm-route.json`（`{ base, decidedAt, candidates }`）为机器级事实：跨重启稳定、删文件即重探；与 ADR-0006 的 memory-only latest 缓存不冲突（后者是探测结果缓存，本文件是路由决策）。
- 行为变化两处如实声明：`npmPackument` 的 registry 参数从被忽略变为生效；`npmLatest`/`npmPackumentTimes` 在 npmjs 抖动时最坏多付一次 5s 首腿等待（换检测新鲜度）。
- non-goals：GitHub 路由加速、WinINET 系统代理读取、settings UI、社区目录/市场 catalog 换源、安装委派通路本身（B3 消费字段除外）。
- 真机验收（发布装机后）：上海机 scoped 自研包产品内升级一次成功（或 B3+sync 自愈，验收记录显式断言 sync 触发）；首尔机 `dshm outdated` 正常且决策文件 `base` 为 npmjs。
