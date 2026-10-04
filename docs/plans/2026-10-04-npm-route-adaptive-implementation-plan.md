# npm registry 路由自适应（元数据预取换源/探活/镜像同步重试）实施计划

> v2（2026-10-04 深夜）：按评审轮次 1 修订——吸收 R1-1～R1-16 全部意见；关键变更：检测/履约读分离（npmLatest 纳入权威链）、全败回退不落盘、PUT 走 fetchLimited 扩 method、registry 分类下沉 dsh-cli 分类层、L0 补 reset 钩子与显式代理构造、probe single-flight、新增「风险与回退」章节。
> v3（2026-10-04）：按评审轮次 2 修订——R2-1 取方案 b（删 L2② 探测 sync 腿与 npmPackument 次源 npmjs，sync 收敛为「已知目标版本」的两触发点）；R2-2 履约阶梯 sync 后加有界等待 10s；R2-3 全败内存回退加 60s TTL；R2-4 Task 6 注入机制写明走 TransactionDeps deps 槽。

## 目标

- 消灭「dsh-m 升级/安装元数据预取直连 `registry.npmjs.org` 抖动 → 升级在委派 pnpm 之前夭折（`fetch failed` / `The operation was aborted due to timeout`）」这一类故障（2026-10-04 copilot-auth 1.2.8 双连失败实录，将录入 know-how 020 §9）。
- 元数据预取（版本探测/兼容预检/packument 预热/publish-time）改为**代理感知 + registry 路由自适应**：上海机自动落到镜像、首尔机自动留在官方源，两台机器零配置。
- 镜像滞后场景产品内自愈，且**不牺牲自研包发布窗口内的新鲜度检测**（020 §8.4「窗口内自研包产品内即时升级」的产品承诺必须保住）。

设计共识来源：本仓库会话 2026-10-04 + 评审轮次 1（R1-1～R1-16）；官方 dsh-market 取证（`net.ts` / `region-probe.ts` / `regions.ts` / `updates.ts`，装机副本 `~/.dsh/profiles/desktop/node_modules/dshmarket/src/`）。

## 架构快照

**读分类是本设计的中枢**（评审 R1-1 的产物）——不同读对「新鲜度」与「可用性」的敏感度不同，路由策略按读分类：

| 读 | 分类 | 主源 | 次源 |
|---|---|---|---|
| `npmLatest`（升级探测：有没有新版） | 检测读，新鲜度敏感 | npmjs（权威，首腿超时收紧至 5s） | 生效源 |
| `npmPackumentTimes`（发布时刻→release-age 预检） | 检测读，权威敏感 | npmjs（同上收紧） | 生效源 |
| `npmVersion`（精确版本元数据→兼容预检/integrity） | 履约读，滞后敏感（镜像未同步会 404） | 生效源 | 失败/404 → sync+重试一次 → npmjs |
| `npmPackument`（B3 预热等） | 履约读 | 生效源 | — |

- **L0 传输层**：`httpx.ts` 的 `fetchLimited` 从裸全局 `fetch` 换成 **undici 自带 fetch + 自建 dispatcher**（`Agent` / `EnvHttpProxyAgent`）。代理从标准 env（`https_proxy`/`HTTPS_PROXY`/`http_proxy`/`HTTP_PROXY`，小写优先）+ `npm_config_https_proxy`/`npm_config_proxy` 兜底解析；空值视为未设；无 scheme 补 `http://`。**proxyAgent 必须以 `resolveProxyConfig()` 的结果显式构造**（官方 net.ts:110-118：EnvHttpProxyAgent 自身只读 http(s)_proxy，npm_config_* 代理不显式交接会静默直连）。同时规避宿主 undici 全局 dispatcher 污染（#742）。loopback 回环目标**不自动豁免代理**（跟随官方语义，交 NO_PROXY 处理，README 写明组合用法）。安全基线不动：每跳 `assertSafeUrl`、手动重定向、body cap、超时全部保留。
- **L1 路由层**：新模块 `npm-route.ts`——候选源 = `DSHM_NPM_REGISTRY` env（最高优先，设了就不探测）> `[.npmrc registry, npmjs, npmmirror]` 去重；**probe-once + single-flight**：`Promise.any` 探测 `semver/latest`（全镜像必有、几 KB），2.5s 总预算共享 AbortController，胜者须 ok + 完整 body + JSON 带 `version`；并发调用共享同一 in-flight probe。决策持久化到 `<cacheDir()>/npm-route.json`；**全候选失败 → 仅内存回退 npmjs、不落盘，下次进程重新探测**（对官方 region-probe 立场的显式偏离，理由与取舍见 ADR-0012：GUI 宿主长驻进程里坏决策用户不可见、恢复口不可发现）。重置 = 删文件或设 env。
- **L2 自愈层**（两个触发点共用同一 sync 原语，每条升级链路至多各一次；**sync 只救「镜像滞后」，不救「网络中断」——检测读权威链因此不设 sync 腿**，取舍见 ADR-0012，评审 R2-1 决策 b）：①`npmVersion` 履约读在生效镜像上失败/404 → `syncNpmmirrorPackage(pkg)` → 有界等待 10s（镜像受理后 12–15s 可见，020 §2.2）→ 同源重试一次 → 仍败 → npmjs 兜底；②pnpm 委派 `NO_MATCHING_VERSION`（B3）→ sync → 既有退避重试（B3 自带退避即等待）。sync 成功后作废该包 latest 缓存（`clearAllLatestCache()`，事件罕见，不做 namespace 精细化）。`DSHM_MIRROR_SYNC=0` 一键关闭全部 sync。
- **L3 权威层**：即上表检测读的权威链；publish-time 查不到 → 维持既有 null=fail-open（ADR-0009 立场不动）。
- **L4 报错层**：网络层失败在错误对象上附带 `via`（`direct` 或掩码代理 URL）；`describeFetchFailure` **仅在 via 为代理时**追加「（经 <掩码代理>）」，direct 不渲染（避免无代理机器满屏噪音）。registry 分类信息由 dsh-cli 分类层结构化产出（见 Task 6），上层不 regex 原始输出。
- **只升不降**：`versions.ts` 已有 semver.gt 守卫，本计划不改比较逻辑，仅最终验证核对。
- **范围外（non-goals）**：GitHub 路由加速、WinINET 系统代理读取、settings UI、社区目录/市场 catalog 换源、安装委派通路本身（除 B3 消费结构化字段）。

## 全局约束

- 安全基线 DESIGN.md §17.1 逐字保留：仅 HTTPS（loopback http 例外）+ 响应大小上限 + 超时 + 手动重定向；`assertSafeUrl` 每跳不豁免。`fetchLimited` method 联合类型扩为 `'GET' | 'HEAD' | 'PUT'`（唯一扩面，PUT 仅限 sync 原语使用，补 wire 级用例）。
- 分层纪律（dsh-cli.ts 头注「分类发生在任何文案改写之前；上层只消费 class + code，永不 regex 原始输出」）：registry 识别在分类层结构化，B3 消费字段。
- versions.ts 头注立场 DESIGN.md §3「版本不写死，运行时实查」。
- 用户可见文案沿用 `describeFetchFailure` 三要素格式（中文、不泄露内部 URL/凭据；代理 userinfo `//***@` 掩码）。
- 依赖精确 pin 惯例：undici 锁 7.x 最新精确版（dsh-market 生产同款线 `^7.29.0`）。
- `engines.node >= 22` 不动。
- ADR-0006 latest 探测缓存 memory-only 不破坏：路由决策文件是独立的小文件（机器级事实），ADR-0012 写明差异理由。
- 命令环境：Windows PowerShell；构建 `npm run build`，单测 `node --test tests/<file>.test.mjs`（依赖先 build），全量 `npm test`。

## 输入工件

- 设计共识：本仓库 2026-10-04 会话 + 评审轮次 1；无独立设计文档，本文档即设计载体。
- 取证参考（只读）：`~/.dsh/profiles/desktop/node_modules/dshmarket/src/{net,region-probe,regions,updates,dsh-cli}.ts`。
- 故障实录：know-how 020（§3.1 sync 接口、§8 治理闭环、§8.4 E2E 断言）；索引行 020/023。
- 在案前例：`docs/DESIGN.md`「元数据源竞速（0.4.0 引入，0.4.x 退役）」——ADR-0012 必须回应（Task 1）。

## 风险与回退

| 层 | 风险 | 回退/开关 |
|---|---|---|
| L0 传输 | undici dispatcher 行为差异、代理误配 | 无运行时开关；回退 = 市场装回 0.9.31（升级线天然支持，账实一致）；wire 级用例 + 全量回归为发布门 |
| L1 路由 | 探测选中坏镜像、决策文件陈旧、首跑全断网钉死错误决策 | `DSHM_NPM_REGISTRY=https://registry.npmjs.org` 强制官方源（跳过探测）；删 `<cacheDir()>/npm-route.json` 重探；全败不落盘（本计划决策）防钉死 |
| L2 自愈 | sync 接口失效/限流、scoped URL 形态不符 | `DSHM_MIRROR_SYNC=0` 全关（行为回到现状）；sync 失败静默 false 不阻断既有重试 |
| 检测权威链 | npmjs 首腿失败付出 5s 延迟 | 首腿超时 `Math.min(timeoutMs, 5_000)` 封顶；降级后仍可用（镜像源） |
| 发版 | 0.9.32 回归 | 市场升级线装回 0.9.31；真机验收失败处置：先 `DSHM_NPM_REGISTRY`/`DSHM_MIRROR_SYNC` 二开关定位层，再决定回滚 |

## 文件结构与职责

- Create: `docs/adr/0012-npm-registry-route.md` —— 路由自适应决策记录（含读分类表、0.4.x 前例回应、对官方 probe 立场的偏离及理由）
- Create: `src/core/npm-route.ts` —— L1 路由层（候选、single-flight probe、持久化、生效源、切换通知）+ L2 sync 原语
- Modify: `src/core/httpx.ts` —— L0 dispatcher/代理解析/`via` 附着/method 扩 PUT；新增导出 `resolveProxyConfig`、`resetProxyAgentsForTests`
- Modify: `src/core/versions.ts` —— 检测/履约读路由（`npmLatest` 权威链、`npmVersion` 履约阶梯、`npmPackument` 修复被忽略的 registry 参数并接默认路由）
- Modify: `src/core/release-age.ts` —— `npmPackumentTimes` 权威链；新增导出 `clearPackumentCache`
- Modify: `src/core/latest-cache.ts` —— 新增导出 `clearAllLatestCache`（复用既有 sweep 内部实现）
- Modify: `src/core/dsh-cli.ts` —— 分类层增结构化字段 `registry: 'npmmirror' | 'npmjs' | null`（在截断前的完整文本上识别）
- Modify: `src/core/profile-transaction.ts` —— B3 分支消费 `registry` 字段接入 sync + 清缓存
- Modify: `package.json` —— dependencies 增 `undici`（精确 pin）；version → `0.9.32`
- Modify: `src/cli.ts` —— 帮助文本 env 表（锚点 `src/cli.ts:194` 一带）增 `DSHM_NPM_REGISTRY` / `DSHM_MIRROR_SYNC`，并写明与 `DSHM_REGISTRY_URL`（收录清单源）的区别
- Test: `tests/httpx.test.mjs`、`tests/npm-route.test.mjs`（新建）、`tests/versions.test.mjs`、`tests/release-age.test.mjs`、`tests/latest-cache.test.mjs`、`tests/pnpm-outcome.test.mjs`（分类字段）、`tests/profile-transaction.test.mjs`（B3 消费字段；既有 B3 用例在 profile-transaction.test.mjs ⑤ 与 rollback-heal.test.mjs 验收3）
- Modify: `README.md` —— env 文档（锚点：`DSHM_COMMUNITY_CATALOG` 段落一带，约 :123）+ loopback×代理 NO_PROXY 组合提示
- Modify: `CHANGELOG.md` —— 0.9.32 条目
- Modify（跨仓库，dsh-workspace 私有仓）: `D:\_dsh-workspace\01_docs\dsh-intall-know-how\020-dshm-desktop-immediate-install-channel.md` §9 + `AGENTS.md` 索引表 020 行

## 任务清单

### Task 1: ADR-0012 路由自适应决策记录

- 目标：把读分类 + L0–L4 决策固化成 ADR；不改代码。
- Files
  - Create: `docs/adr/0012-npm-registry-route.md`
- 接口契约
  - Consumes: `docs/adr/0010-doctor-read-only-diagnostics.md`（章节格式模板）
  - Produces: ADR 编号 `0012`；后续任务 rationale 引用它
- 验证范围

- [ ] Step 1: 读 `docs/adr/0009-*.md` 与 `docs/adr/0011-*.md` 确认骨架与措辞风格；读 `docs/DESIGN.md`「元数据源竞速（0.4.0 引入，0.4.x 退役）」段落原文
- [ ] Step 2: 写 ADR-0012，必须覆盖：问题（2026-10-04 实录 + npmjs 直连抖动 + #742 风险）；**读分类表**（检测读权威链 vs 履约读生效源优先的完整理由，引用 020 §8.4 产品承诺与 ADR-0006「误报已是最新」事故定性回应评审 R1-1）；**与 0.4.x 竞速退役决策的关系**（R1-9：其前提「npmjs 恒快」已被 2026-10-04 实录推翻；本方案非逐请求竞速而是 probe-once + 读分类，且回应「探测恒等默认值」「无此交互」两条在新前提下是否仍成立）；备选否决（静态 env-only / 每次自动重探 / 双源竞速）；**对官方 probe 立场的偏离**（全败回退不落盘 + 回退态 60s TTL，R1-8/R2-3，理由：GUI 长驻进程坏决策不可见、恢复口不可发现）；**L2 边界**（sync 只救镜像滞后：检测读权威链不设 sync 腿——两腿全败属网络型失败 sync 救不了；两个 sync 触发点均在「已知目标版本」场景，R2-1 决策 b）；non-goals
- [ ] Step 3: 自查 ADR 中模块名/env 名与本计划一致（`DSHM_NPM_REGISTRY`、`DSHM_MIRROR_SYNC`）
- Run: `Get-Content D:\_dsh-workspace\dsh-m\docs\adr\0012-npm-registry-route.md | Select-String 'DSHM_'`
- Expected: 两个环境变量名各至少出现一次，拼写一致

### Task 2: 引入 undici 依赖

- 目标：`undici` 进入 dependencies 并可被 tsc 产物导入。
- Files
  - Modify: `package.json`、`package-lock.json`
- 接口契约
  - Consumes: 无
  - Produces: `import { Agent, EnvHttpProxyAgent, fetch as undiciFetch } from 'undici'` 可编译可运行
- 验证范围

- [ ] Step 1: 查 7.x 最新精确版本
- Run: `npm view undici dist-tags --registry https://registry.npmmirror.com/`
- Expected: 看到 `latest`；若为 8.x，用 `npm view undici versions --json` 取最大 `7.x`
- [ ] Step 2: 精确安装
- Run: `npm install -E undici@<Step1 的 7.x 精确版本>`
- Expected: dependencies 出现无 `^` 的精确版本
- [ ] Step 3: 构建产物可导入
- Run: `npm run build; node -e "import('undici').then(m => console.log('undici ok', typeof m.EnvHttpProxyAgent))"`
- Expected: `undici ok function`，build 无错误

### Task 3: httpx.ts 传输层换 undici dispatcher（L0）+ PUT 扩面 + via 附着

- 目标：`fetchLimited` 走代理感知的 undici fetch；支持 PUT（供 sync 原语）；网络层错误附 `via`；安全基线与重定向行为不变。
- Files
  - Modify: `src/core/httpx.ts`（锚点：`fetchLimited`、`FetchOptions`、文件头安全基线注释）
  - Test: `tests/httpx.test.mjs`
- 接口契约
  - Consumes: Task 2 的 undici
  - Produces: ①导出 `resolveProxyConfig(): { http: string | null; https: string | null }`；②导出 `resetProxyAgentsForTests(): void`（重建两个模块级单例；评审 R1-4）；③`FetchOptions['method']` 联合类型 = `'GET' | 'HEAD' | 'PUT'`；④网络层抛出的 Error 附 `via: string`（`direct` 或掩码代理 URL）；⑤**proxyAgent 以 `resolveProxyConfig()` 结果显式构造**（`new EnvHttpProxyAgent({ httpProxy, httpsProxy })`，评审 R1-5）；⑥**wire 层测试缝隙 `_setWireFetchForTests`（实现期发现，2026-10-05）**：仓库既有 wire 测试缝隙是 mock `globalThis.fetch`（versions 头注原文），httpx 换 undici 包 fetch 后 mock 被绕开 → 新增模块内可替换 fetch 引用，versions/npm-integrity/registry-check 三文件的 mock 迁至该缝隙（断言与计数语义零变化）
- 验证范围：新增用例绿 + `tests/httpx.test.mjs` 既有用例（真实 loopback server）全绿 = 无回归

- [ ] Step 1: 写失败测试（追加）：
  1. `resolveProxyConfig` 组：`https_proxy` 压过 `HTTPS_PROXY` 与 `npm_config_https_proxy`；空串=null；`127.0.0.1:7890` → `http://127.0.0.1:7890`；仅 `npm_config_https_proxy` 也生效。env 赋值 + try/finally 还原，每组先 `resetProxyAgentsForTests()`。
  2. 经代理转发（标准 env）：目标 http server + 转发代理 http server（计数）；`http_proxy=http://127.0.0.1:<proxyPort>` + reset → `fetchJsonLimited('http://127.0.0.1:<targetPort>/x')` 成功且代理命中=1。
  3. 经代理转发（仅 npm_config_*，评审 R1-5）：同上但只设 `npm_config_proxy` → 命中=1（证明显式交接）。
  4. via 附着：env 指向必拒连代理端口（`http://127.0.0.1:1`）+ reset → reject 的 Error `.via` = 该掩码 URL。
  5. PUT 通路：目标 server 断言收到 `method === 'PUT'` → `fetchLimited(url, { method: 'PUT' })` 成功。
- Run: `npm run build; node --test tests/httpx.test.mjs`
- Expected: 新增用例红（函数未导出/命中=0/via undefined/PUT 类型不可编译或 404），既有用例绿
- [ ] Step 2: 实现：undici import；惰性单例 + `resetProxyAgentsForTests()`；`fetchLimited` 换 `undiciFetch(current, { …, dispatcher }) as unknown as Response`，网络类错误（非 HttpError）挂 `err.via = maskProxy(resolveProxyConfig().https ?? resolveProxyConfig().http) ?? 'direct'`；method 联合扩 PUT；重定向/body/超时零改动
- Run: `npm run build; node --test tests/httpx.test.mjs`
- Expected: 全绿
- [ ] Step 3: 全量回归
- Run: `npm test`
- Expected: 全绿（尤其 market/release-age/versions 这些 fetch 用户）
- [ ] Step 4: checkpoint commit
- Run: `git add src/core/httpx.ts tests/httpx.test.mjs package.json package-lock.json && git commit -m "httpx: undici dispatcher + proxy awareness + PUT + via context (L0)"`
- Expected: commit 成功

### Task 4: 新建 npm-route.ts 路由层（L1）+ sync 原语（L2）

- 目标：候选解析、single-flight probe-once、持久化、生效源、切换通知、npmmirror 同步原语，收敛为一个可单测模块。
- Files
  - Create: `src/core/npm-route.ts`
  - Test: `tests/npm-route.test.mjs`（新建，骨架参考 `tests/latest-cache.test.mjs`）
- 接口契约
  - Consumes: Task 3 的 `fetchLimited`（现支持 PUT）；`cacheDir()`（`src/core/env.ts`）；`@deepseek-ai/dsh-atomic-write`（既有用法 grep `atomic` `src/core/`）
  - Produces（后续任务按名引用）:
    - `const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org'`；`const NPM_MIRROR = 'https://registry.npmmirror.com'`
    - `function readNpmrcRegistry(): string | null`（`~/.npmrc` 顶层 `registry=` 键，ini-lite，去尾斜杠；scope 键 v1 忽略；缺失/解析失败=null）
    - `function candidates(): string[]`（`DSHM_NPM_REGISTRY` 设置时=`[该值]`；否则 dedupe 保序 `[readNpmrcRegistry(), DEFAULT_NPM_REGISTRY, NPM_MIRROR]` 去 null）
    - `async function decideNpmRoute(deps?: { probeFetch?: (base: string, signal: AbortSignal) => Promise<string> }): Promise<string>`——顺序：内存缓存 → env 直采（不探测不落盘）→ 决策文件 `<cacheDir()>/npm-route.json`（`{ base, decidedAt, candidates }`，读写失败一律当无决策）→ **single-flight probe**（in-flight promise 记忆化；`Promise.any` 探 `<base>/semver/latest`，共享 2500ms AbortController，胜者须 ok+完整 body+JSON 含 string `version`）；生效值变化时逐个触发 listener；**全候选失败 → 内存回退 DEFAULT、不落盘，回退态 TTL 60s 过期后允许重探**（single-flight 仍对并发去重；评审 R1-8 决策 a + R2-3）
    - `async function activeNpmRegistry(deps?): Promise<string>`（decideNpmRoute 薄封装）
    - `function onRouteSwitch(fn: (base: string) => void): void`；`function resetNpmRouteForTests(): void`（同时清 in-flight）
    - `async function syncNpmmirrorPackage(pkg: string, deps?: { fetcher?: typeof fetchLimited; timeoutMs?: number }): Promise<boolean>`——`DSHM_MIRROR_SYNC=0` → false 不发请求；否则 `fetchLimited('https://registry-direct.npmmirror.com/' + encodeURIComponent(pkg) + '/sync?sync_upstream=true', { method: 'PUT', timeoutMs: 默认 8_000 })`；2xx=true，任何失败=false 不抛
- 验证范围：新测试全绿；probe/sync 全部注入，零真网（scoped URL 真网证据核对放 Step 3，一次性人工步骤）

- [ ] Step 1: 写失败测试：
  1. `readNpmrcRegistry`：tmp `.npmrc` 写 `registry=https://example.com/` → 返回去尾斜杠值；无文件 → null。
  2. `candidates`：设 env → 单元素；删 env → 含 DEFAULT 与 NPM_MIRROR 且去重保序。
  3. `decideNpmRoute` probe 注入：慢者 3s/快者 10ms → 快者胜且落盘正确；全 reject → 返回 DEFAULT 且**不产生决策文件**（R1-8）；已有决策文件 → probeFetch 计数=0。
  3b. **回退 TTL（R2-3）**：全 reject 后用 node:test mock timers（或 TTL 注入）推进 60s 再调 → probeFetch 计数再 +1（回退过期触发重探），期间并发调用仍只探一次。
  4. **single-flight（R1-7）**：决策文件不存在时并发 3 个 `decideNpmRoute` → probeFetch 计数=1，三者同值。
  5. `onRouteSwitch`：生效从文件 A 变为 env B → listener 收到 B。
  6. `syncNpmmirrorPackage`：kill switch → false 且 fetcher 未调；fetcher 注入 201 → true 且 URL 含 `sync_upstream=true` 与 `encodeURIComponent` 形态包名；fetcher throw → false。
  - tmp 目录走 `DSHM_CACHE_DIR` + `fs.mkdtempSync`，afterEach 清理 + `resetNpmRouteForTests()`。
- Run: `npm run build; node --test tests/npm-route.test.mjs`
- Expected: 红（模块不存在）
- [ ] Step 2: 写 `src/core/npm-route.ts` 最小实现
- Run: `npm run build; node --test tests/npm-route.test.mjs`
- Expected: 全绿
- [ ] Step 3: scoped sync URL 形态真网证据核对（评审 R1-16，一次性人工）：本机执行一次真实 PUT 并留痕到测试文件头注释——
  Run: `curl.exe -sS -o NUL -w "%{http_code}" -X PUT "https://registry-direct.npmmirror.com/@inventec%2Fdsh-copilot-auth/sync?sync_upstream=true"`
  Expected: `201`（受理）。若非 2xx，改测 literal slash 形态 `@inventec/dsh-copilot-auth`，按胜者订正 `syncNpmmirrorPackage` 的 URL 构造并在测试 6 的断言同步修改
- [ ] Step 4: checkpoint commit
- Run: `git add src/core/npm-route.ts tests/npm-route.test.mjs && git commit -m "npm-route: single-flight probe-once routing + npmmirror sync primitive (L1/L2)"`
- Expected: commit 成功

### Task 5: 元数据预取接线（L1 接线 · L2 履约阶梯 · L3 权威链）

- 目标：按「读分类」接线 versions/release-age；生效源变化清两级缓存。
- Files
  - Modify: `src/core/versions.ts`（锚点：`registryBase` 注释「空/缺省 → 官方 npmjs」；`npmVersion`（:52）；`npmPackument`（:80，**现状接受 `registry` 参数但 URL 写死 npmjs——本任务修复**）；`npmLatest`（:90））
  - Modify: `src/core/release-age.ts`（锚点：`npmPackumentTimes` 硬编码 npmjs URL（:215）、模块内 `packumentCache`）
  - Modify: `src/core/latest-cache.ts`（锚点：`latestCache.clear()` / `swept.clear()` 所在 sweep 函数）
  - Test: `tests/versions.test.mjs`、`tests/release-age.test.mjs`、`tests/latest-cache.test.mjs`
- 接口契约
  - Consumes: Task 4 的 `activeNpmRegistry` / `onRouteSwitch` / `DEFAULT_NPM_REGISTRY` / `NPM_MIRROR` / `syncNpmmirrorPackage`
  - Produces: ①`clearAllLatestCache(): void`（latest-cache.ts）；②`clearPackumentCache(): void`（release-age.ts）；③`npmLatest` 权威链：npmjs（首腿 `Math.min(timeoutMs, 5_000)`）→ 生效源（≠npmjs 时）；④`npmVersion` 履约阶梯：显式 registry 参数 > 生效源 → 失败/非 2xx 且生效源为镜像 → `syncNpmmirrorPackage(pkg)` → **有界等待 10s（abort-aware，`deps.wait?: (ms: number, signal?: AbortSignal) => Promise<void>` 注入，默认真 sleep）** → 同源重试一次 → 仍败 → npmjs 兜底 → 抛（带 via）——sync+重试为尽力而为，npmjs 兜底是主安全网（取舍入 ADR-0012，评审 R2-2）；`deps?: { fetchJsonLimited?: …; syncNpmmirror?: typeof syncNpmmirrorPackage; wait?: … }` 注入；⑤`npmPackument` 修复被忽略的 registry 参数并接「显式 > 生效源」（评审 R1-6，行为变化：显式传参开始生效，用测试钉住）；⑥`npmPackumentTimes` 权威链（同 ③ 超时收紧）→ 查不到返回 null（fail-open 不变）；⑦latest-cache 与 release-age 模块加载时各自 `onRouteSwitch` 注册清缓存
- 可测性约定：`npmLatest`/`npmPackumentTimes` 若既有测试无 fetch mock 手法，增可选末位 `deps?: { fetchJsonLimited?: … }` 注入（与 ④ 同风格）；**禁止单测依赖真实外网**
- 验证范围：三个测试文件新增用例绿 + 既有用例绿

- [ ] Step 1: 写失败测试：
  1. `latest-cache`：写两条 → `clearAllLatestCache()` → 读回空。
  2. `release-age`：注入 fetch 记录器，npmjs 腿失败 → 生效镜像源（`DSHM_NPM_REGISTRY` 指 loopback http server）二次成功 → 返回 times；两腿全败 → null 不抛；npmjs 腿超时上限 = 5s（记录器断言传入 timeoutMs ≤ 5000）。
  3. `versions`——`npmLatest` 权威链：注入器 npmjs 腿失败 → 生效源成功；`npmVersion` 履约阶梯：生效镜像 404 → sync mock 调 1 次 → wait mock 以 10000 调 1 次 → 同源重试成功；镜像始终 404 且 sync 后仍 404 → npmjs 兜底成功；三处全败 → 抛且错误带 via；`npmPackument`：显式 `registry` 参数终于生效（打到注入器声明的 URL）+ 默认走生效源。
- Run: `npm run build; node --test tests/latest-cache.test.mjs tests/release-age.test.mjs tests/versions.test.mjs`
- Expected: 新增用例红
- [ ] Step 2: 实现（严格按 Produces ③–⑦；清缓存注册放各模块加载处，npm-route 不得反向 import release-age/latest-cache 以防循环）
- Run: `npm run build; node --test tests/latest-cache.test.mjs tests/release-age.test.mjs tests/versions.test.mjs`
- Expected: 全绿
- [ ] Step 3: 循环依赖自查 + 全量回归
- Run: `npm run build; npm test`
- Expected: build 通过（ESM 循环会以 TDZ/undefined 暴露）；全量绿
- [ ] Step 4: checkpoint commit
- Run: `git add src/core/versions.ts src/core/release-age.ts src/core/latest-cache.ts tests/ && git commit -m "metadata: read-class routing (authority chain / fulfillment ladder) + switch invalidation"`
- Expected: commit 成功

### Task 6: registry 分类下沉分类层 + B3 接入 sync（L2）

- 目标：`NO_MATCHING_VERSION` 且失败来自 npmmirror 时，退避重试前先镜像同步；识别逻辑结构化，上层零 regex。
- Files
  - Modify: `src/core/dsh-cli.ts`（锚点：`classifyPnpmError` / `PNPM_OUTCOME_CODES` / 头注「分类发生在任何文案改写之前」）
  - Modify: `src/core/profile-transaction.ts`（锚点：`B3_LAG_RETRY` heal note 的退避重试分支，`addWithLagRetry` 一带）
  - Test: `tests/pnpm-outcome.test.mjs`（分类字段）、`tests/profile-transaction.test.mjs`（B3 消费字段；既有 B3 用例在 profile-transaction.test.mjs ⑤ 与 rollback-heal.test.mjs 验收3）
- 接口契约
  - Consumes: Task 4 的 `syncNpmmirrorPackage`；Task 5 的 `clearAllLatestCache`；既有 B3 机制
  - Produces: ①`RunnerOutcome`（或 classify 产物）增字段 `registry: 'npmmirror' | 'npmjs' | null`——在**截断前的完整文本**上识别（评审 R1-3：dsh-cli.ts:307-310 的 tail-800 截断会吃掉特征串）；②B3 分支改消费 `outcome.registry === 'npmmirror'`，触发 `await syncNpmmirrorPackage(req.pkg)` → 成功后 `clearAllLatestCache()` → 既有退避重试；字段为 null/npmjs 时行为与现状一致；`DSHM_MIRROR_SYNC=0` 时整体旁路（现状语义）；③**注入机制（评审 R2-4）**：`syncNpmmirrorPackage` / `clearAllLatestCache` 经 TransactionDeps deps 槽进入 B3 路径（先例：`warmPackument`；默认真实现，测试注 mock）；若 deps 扩展不现实，退级为模块级可替换导出——实现时二者取一并在测试中体现
- 验证范围

- [ ] Step 1: 写失败测试：
  1. `pnpm-outcome`：含 `from https://registry.npmmirror.com/` 的样例输出 → `registry==='npmmirror'`；含 `registry.npmjs.org` → `'npmjs'`；无关输出 → null；**特征串位于 800 字截断线之外的长输出** → 仍识别（证明在完整文本上跑）。
  2. `profile-transaction`：B3 路径注入 `syncNpmmirrorPackage` mock——registry=npmmirror → sync 调 1 次且 `clearAllLatestCache` 被调；`DSHM_MIRROR_SYNC=0` → 不调；registry=null → 不调。
- Run: `npm run build; node --test tests/pnpm-outcome.test.mjs tests/profile-transaction.test.mjs`
- Expected: 红
- [ ] Step 2: 实现（分类字段在 dsh-cli 分类处提取；B3 分支按 Produces 接线；heal note 追加 `+npmmirror sync` 标记）
- Run: `npm run build; node --test tests/pnpm-outcome.test.mjs tests/profile-transaction.test.mjs; npm test`
- Expected: 目标文件绿 + 全量绿
- [ ] Step 3: checkpoint commit
- Run: `git add src/core/dsh-cli.ts src/core/profile-transaction.ts tests/ && git commit -m "b3: registry-aware npmmirror sync before lag retry (L2)"`
- Expected: commit 成功

### Task 7: describeFetchFailure 输出代理上下文（L4）

- 目标：失败摘要带「经哪个代理」，direct 不渲染；凭据掩码。
- Files
  - Modify: `src/core/httpx.ts`（锚点：`describeFetchFailure`）
  - Test: `tests/httpx.test.mjs`
- 接口契约
  - Consumes: Task 3 的 `err.via` 附着与 `maskProxy`
  - Produces: `describeFetchFailure` 仅当 via 为代理 URL 时在 reason 后追加「（经 <掩码代理>）」；`via === 'direct'` 或缺失 → 输出与现状逐字一致（评审 R1-13）
- 验证范围

- [ ] Step 1: 写失败测试：`{ via: 'http://user:secret@127.0.0.1:7890' }` → 输出含 `经 http://***@127.0.0.1:7890` 且不含 `secret`；`{ via: 'direct' }` → 无「经 」段；无 via → 逐字现状
- Run: `npm run build; node --test tests/httpx.test.mjs`
- Expected: 红
- [ ] Step 2: 实现（文件内 `maskProxy` 小函数供 Task 3/7 共用）
- Run: `npm run build; node --test tests/httpx.test.mjs`
- Expected: 全绿
- [ ] Step 3: checkpoint commit
- Run: `git add src/core/httpx.ts tests/httpx.test.mjs && git commit -m "httpx: proxy context in fetch failure digest (L4)"`
- Expected: commit 成功

### Task 8: 文档收口（README / cli.ts 帮助 / CHANGELOG / 版本号 / know-how 020 §9）

- 目标：发布面文档与 know-how 同步；版本 0.9.32；跨仓提交留痕。
- Files
  - Modify: `README.md`（锚点：`DSHM_COMMUNITY_CATALOG` env 段落一带，约 :123——评审 R1-10 订正：本仓库 README 无 `DSHM_REGISTRY_URL` 段）
  - Modify: `src/cli.ts`（锚点：`src/cli.ts:194` 帮助文本 env 表）
  - Modify: `CHANGELOG.md`、`package.json`（version → `0.9.32`）
  - Modify（跨仓库）: `D:\_dsh-workspace\01_docs\dsh-intall-know-how\020-*.md`（文末 §9）+ 同目录 `AGENTS.md`（索引表 020 行）
- 接口契约
  - Consumes: 全部前序任务的最终行为（env 名、决策文件路径、B3 行为、loopback×代理语义）
  - Produces: 无代码接口；know-how §9 成为下次排障入口
- 验证范围

- [ ] Step 1: README + cli.ts 帮助文本增补：`DSHM_NPM_REGISTRY`（元数据预取源覆盖，设了跳过探测）、`DSHM_MIRROR_SYNC=0`（关闭镜像同步自愈）；**写明与 `DSHM_REGISTRY_URL`（收录清单源，非 npm registry）的区别**；补 loopback 调试 × 系统代理组合的 `NO_PROXY=127.0.0.1,localhost` 提示（评审 R1-11）
- [ ] Step 2: CHANGELOG 0.9.32 + package.json 版本号
- Run: `npm run build; node -p "require('./package.json').version"`
- Expected: `0.9.32`
- [ ] Step 3: know-how 020 §9「npmjs 直连元数据预取失败（fetch failed / timeout）」：逐字收录两报错原文；判别特征（`.plugin-manager/logs` 无对应 pnpm.log = 死在委派前）；本修复机制与新 env；0.9.32 起适用；索引表 020 行同步
- [ ] Step 4: dsh-m 仓内提交（**不含 01_docs**——跨仓，评审 R1-15）
- Run: `git add -A; git commit -m "0.9.32: npm route adaptive (L0-L4)"`
- Expected: commit 成功且 `git status` 中无 `../01_docs` 路径
- [ ] Step 5: 01_docs 两文件在 dsh-workspace 私有仓**本地 commit、不 push**（push 需主人确认）
- Run: `git -C D:\_dsh-workspace add 01_docs/dsh-intall-know-how/020-dshm-desktop-immediate-install-channel.md 01_docs/dsh-intall-know-how/AGENTS.md; git -C D:\_dsh-workspace commit -m "know-how 020 §9: npmjs direct metadata fetch failure + 0.9.32 fix"`
- Expected: commit 成功

## 执行纪律

- 开始实现前先批判性复查本计划；发现缺项/矛盾/验证命令无效，先修计划再动手。
- 按任务顺序执行（T1→T8 依赖链），不无声跳步、不合并任务目标。
- 每任务跑该任务验证；绿了才进下一个。
- 分支策略：当前分支非 main 才可直接开工；若在 main，先向用户确认。
- 遇阻（dsh-atomic-write API 与假设不符、B3 通路不可注入、undici 行为与官方注释不符）立即停下说明，不猜。
- 全部任务完成后跑「最终验证」并输出修改摘要。

## 最终验证

- Run: `npm run typecheck` → 无错误
- Run: `npm test` → 全部测试文件绿
- Run: `npm run build; node -e "import('./lib/core/npm-route.js').then(m => console.log('route module ok', typeof m.decideNpmRoute, typeof m.syncNpmmirrorPackage))"` → 两个 function
- 静态锚点核对：
  - Run: `Select-String -Path D:\_dsh-workspace\dsh-m\src\core\httpx.ts -Pattern 'await fetch\('` → 零命中
  - Run: `Select-String -Path D:\_dsh-workspace\dsh-m\src\core\release-age.ts -Pattern 'registry.npmjs.org'` → 仅权威链首腿一处字面量
  - Run: `Select-String -Path D:\_dsh-workspace\dsh-m\src\core\profile-transaction.ts -Pattern 'registry.npmmirror|npmmirror\.com'` → 零命中（分类已下沉 dsh-cli，评审 R1-3）
- 只升不降核对（audit，不改码）：`Select-String -Path D:\_dsh-workspace\dsh-m\src\core\versions.ts -Pattern 'gt\('` 守卫仍在
- 真机验收（发布并升级装机后，人工；评审 R1-16 加严）：
  1. 上海机对刚发布的**scoped 自研包**产品内升级一次——预期一次成功或 B3+sync 自愈，失败消息不再裸 `fetch failed`；
  2. 验收记录必须显式断言「sync 被触发」（B3 heal note 出现 `+npmmirror sync` 或操作日志可见 sync PUT）；
  3. 首尔机 `dshm outdated` 正常返回且探测源为 npmjs（决策文件 `base` 字段核对）；
  4. 失败处置：按「风险与回退」表二开关定位层，再决定回滚。

## 审阅 Checkpoint

- 计划正文结束后请求用户审阅；批准前不进入实现。
