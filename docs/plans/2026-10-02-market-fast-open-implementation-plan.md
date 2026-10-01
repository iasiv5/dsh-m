# dsh-m 0.9.14 市场秒开（SWR 先回缓存 / 线路粘性 / latest 落盘 / 客户端快照）实施计划

## 目标

- 消灭「每次点开市场必现加载 spinner」：客户端默认首页秒开（快照）+ 服务端 TTL 过期先回 stale（SWR）+ 后台自愈。
- 消灭冷链路的两大同步等待：registry 默认链对失败线路（本机 raw.githubusercontent 恒不可达）的白等（线路粘性）；DSH 服务重启后页条目 npm 探测重放（latest 缓存落盘）。
- 全部改动落在 dsh-m 仓库内，目标版本 0.9.14；发版/装机动作不在本计划内（见文末附录，须主人逐步确认）。

## 架构快照

一次 `POST /dshm {method:'market'}` 的数据面（`host-api.ts` market case 与 `listMarket` 骨架不动，只换四个子环节的缓存语义）：

```
main.jsx useMarketData ──(1)客户端快照：默认首页先渲染上次响应，background 换新
   └─▶ listMarket（market.ts）
         ├─ loadRegistry（registry.ts L852）      ←(2)TTL 过期：立即回 stale + 后台单飞刷新
         │     └─ loadDefaultChain（L711）        ←(3)线路顺序按 cache 记录的上次成功来源粘性排序
         ├─ fetchCommunityCatalog（community.ts） ←(4)TTL 过期：立即回 stale + force flight 后台刷新
         └─ probeLatest ←→ latest 缓存            ←(5)内存 Map 迁入新模块 latest-cache.ts，write-through 落盘
```

- SWR 总语义：磁盘缓存存在但 TTL 过期 → **同步返回 stale 数据**（registry 既有 `source:'default-cache'`/community 既有 `status:'stale'` 契约与 `communityStale` 横幅现成），后台单飞刷新写回 cache，下次调用受益。`force: true` 始终同步强刷，不经过 SWR。
- 客户端快照的读侧再次过 `normalizeMarketResponse` 收敛，天然免疫响应形状漂移，因此不需要版本护栏（与 self-check 的版本护栏场景不同：self-check 存的是推导结论，快照存的是可收敛的原始响应）。
- CLI 单发进程触发的后台刷新随进程消亡，无半态风险（全部原子写），不做特殊处理。

## 全局约束

- 测试一律隔离 fixture（`DSHM_CACHE_DIR` 指向 `mkdtempSync` 临时目录 + 本地 `node:http` server），绝不触碰 `~/.dsh`。
- 不新增用户可见设置旋钮（`src/host.ts` L41-45 的 schema 不动）；开关即 revert。
- `force` / `loadRegistryCandidate` / `loadDefaultRegistry`（显式下载）/ 社区 `pin` 命中 / `communityCatalog:false` 语义不变；deadline、namespace、profile、waiter-scoped signal 契约不变（v8-v10 定稿）。
- push / tag / npm publish 均须用户确认；本计划只产本地提交。发版纪律见附录（know-how 018/020）。
- 环境：node ≥22，Windows + pwsh；全部验证命令为 npm scripts / `node --test`，无 bash-only 依赖。命令均在 `dsh-m/` 目录下执行。
- 无额外全局约束（版本/依赖/平台规则无新变化）。
- **执行偏离备案（0.9.14 实现后，实现评审 R1-#1/#2 认领）**：① 提交序列 9 个 = 8 任务提交 + 1 计划文档入仓提交（Task 6 预期已同步修订）。② `writeLatestCache(key, value, profile = WEB_PROFILE)` 增加可选第三参（计划契约原文双参）——desktop profile 探测必须写入自己的缓存段，缺省 web 会错位；Task 4b 两处调用点显式传参。③ probeLatest 的 npm-only cacheKey 归一为 `latestCacheKey(ns, 'npm-only', …)`（原 `npm-only|ns|…` 首段非 host/cli 会被落盘层守卫静默跳过持久化，重启后「不在收录清单的已装包」探测重放）。

## 输入工件

- 2026-10-02 会话研究：症状→根因表（每次打开=客户端无快照；每小时首开=registry raw 白等 + 社区 npm dist-tags 同步探测；重启后首开=内存 latest 缓存丢失；本机缓存 `source: default-jsdelivr` 实证 raw 恒败）。
- know-how 008（registry 文案纪律，本计划不改 registry.json，仅收口时例行跑校验）、018（npm OIDC staged 发布假绿）、020（desktop 装机 minimumReleaseAge/npmmirror）。
- 本文档替换同路径旧稿（2026-10-02 早先版本），按 /writing-plans 骨架重排。
- 基线：dsh-m `main` @ `569f8f6`（package.json 已 bump 0.9.14、README 已有「0.9.14 变更」节；origin/main = 8b8325c，本地 ahead 1；工作树仅本计划文档为新增）。锚点于 569f8f6 复测：569f8f6 只触及 registry.json/install-cmd.js/main.jsx/相关测试与文档，registry.ts/community.ts/market.ts 行号沿用；main.jsx `useMarketData` 实测 L562-615（评审 R1-#3）。

## 文件结构与职责

Create:
- `src/core/latest-cache.ts` — latest 探测缓存的唯一 owner：内存 Map + `latestCacheKey`/`readLatestCache`/`writeLatestCache` + 磁盘信封层（`<cacheRoot(profile)>/latest/<namespace>.json`——**置于 nsDir 之外**：`pruneCaches`（registry.ts L545-561）清扫 `<ns>/` 顶层 `*.json` 且 keep 集不含 latest，放 nsDir 内会被每次 registry 刷新成功后的 prune 删除，评审 R1-#1）+ 懒 seed + write-through 原子写 + 串行持久化队列 + `resetLatestCacheForTest`。
- `src/client/market-snapshot.js` — 市场默认首页快照纯逻辑（localStorage，镜像 `src/client/self-check.js` 形态：读/写/清 + TTL + 静默降级，不依赖 DOM/React）。
- `tests/latest-cache.test.mjs`、`tests/client-market-snapshot.test.mjs`。

Modify:
- `src/core/registry.ts`（`loadDefaultChain` 粘性排序；`loadRegistry` SWR 分支 + 后台单飞 + 测试钩子 `_waitForRegistryBackgroundForTests`）。
- `src/core/community.ts`（`runChain` SWR 分支 + 测试钩子 `_waitForCommunityBackgroundForTests`）。
- `src/core/market.ts`（删除本地 latestCache 三件套 L337-373，改 import `latest-cache.js`；`listMarket`/`listInstalledWithMeta` 探测段前 `await ensureLatestCacheSeeded`）。
- `src/client/main.jsx`（`useMarketData` L562-615：初始 state 读快照；`fetchPage` 增加 background 模式；默认首页成功响应写快照）。
- `tests/registry.test.mjs`、`tests/community.test.mjs`（各增用例；community 既有 ⑪/⑫ 两条断言按新契约有意翻转）、`tests/market.test.mjs`（仅补 `DSHM_CACHE_DIR` 测试基建，评审 R1-#4）、`tests/registry.test.mjs` 另增 1 例 latest×prune 交互回归（评审 R1-#1）。
- `README.md`、`README.en.md`（**并入既有「0.9.14 变更」节**——569f8f6 已建节且 package.json 已 0.9.14，勿重复 bump/建节，评审 R1-#3）、`docs/DESIGN.md`（缓存语义一段）。

边界保持：`src/core/host-api.ts`、`src/host.ts`、`src/core/profile-ops.ts`、`src/cli.ts`、`src/tools.ts` 不动；registry 的 custom 链、candidate、显式下载路径不动。

## 任务清单

依赖关系：Task 1 → Task 2（同文件先后，避免同段冲突）；Task 3、Task 4a、Task 5a 相互独立可并行；Task 4b 依赖 4a；Task 5b 依赖 5a；Task 6 收口依赖全部。

### Task 1: registry 默认链线路粘性（registry.ts loadDefaultChain）

- 目标：链启动前读 cache 文件记录的上次成功线路（`source` 字段），把同 label 线路排到最前，本机不再每次白等 raw 失败。
- Files:
  - Modify: `src/core/registry.ts` — `loadDefaultChain`（L711-783，`const routes = opts.defaultRoutes ?? DEFAULT_URLS` 之后、for 循环之前）
  - Test: `tests/registry.test.mjs` — 新增 `describe('default 链线路粘性', ...)`
- 接口契约:
  - Consumes: 既有 `readCacheFile(namespace, cacheKey, profile)`（L524）、cache 信封的 `source` 字段（成功路径 L724-733 已写入，粘性零新状态）；测试缝 `opts.defaultRoutes`（L643）与 `tests/registry.test.mjs` 既有 helper `startRegistryServer`/`getDeadPort`。
  - Produces: `loadDefaultChain` 的线路顺序语义（Task 2 的后台刷新直接复用，无名称耦合）。
- 验证范围: `node --test tests/registry.test.mjs` 新增用例由红转绿；既有双线路/全失败用例不回归。

- [ ] Step 1: 写失败测试（追加到 `tests/registry.test.mjs`，风格镜像该文件既有 describe——`beforeEach` 建 `mkdtempSync` 缓存根 + `process.env.DSHM_CACHE_DIR`，`afterEach` 清理）：

```js
it('粘性：cache 记录上次成功线路为 jsdelivr → 后续链路先试 jsdelivr（force 下仍生效）', async () => {
  const paths = []   // 记录命中顺序的本地服务器
  const srv = createServer((req, res) => { paths.push(req.url); res.writeHead(200, { 'content-type': 'application/json' }); res.end(regJson) })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); try {
    const base = `http://127.0.0.1:${srv.address().port}`
    const dead = await getDeadPort()
    // 暖机：raw 死、jsdelivr 活 → cache 写入 source=default-jsdelivr
    await loadRegistry({}, { force: true, defaultRoutes: [
      { source: 'default-raw', url: `http://127.0.0.1:${dead}/dead.json` },
      { source: 'default-jsdelivr', url: `${base}/b.json` },
    ] })
    paths.length = 0
    // 观测：force 同步走链，粘性应把 jsdelivr 排前
    await loadRegistry({}, { force: true, defaultRoutes: [
      { source: 'default-raw', url: `${base}/a.json` },
      { source: 'default-jsdelivr', url: `${base}/b.json` },
    ] })
    assert.equal(paths[0], '/b.json', '上次成功的线路应先被尝试')
  } finally { await new Promise((r) => srv.close(r)) }
})

it('无缓存（全新环境）保持原序 raw→jsDelivr', async () => { /* 同上结构，跳过暖机，断言 paths[0] === '/a.json' */ })
```

  （`regJson` 用该文件既有 `reg([localEntry(1)])` 的序列化产物；`getDeadPort` 为文件既有 helper。）
- Run: `node --test tests/registry.test.mjs`（src 未改、tests 从 `../lib/` 导入旧构建产物——红自旧产物语义缺失，无需 build）
- Expected: 粘性用例失败——`paths[0]` 实际为 `'/a.json'`（AssertionError）；原序用例通过。
- [ ] Step 2: 运行并确认当前失败（上一步运行结果即红信号：粘性语义缺失被测试捕获）。
- [ ] Step 3: 写最小实现（`loadDefaultChain` 内，`const routes = ...` 之后）：

```ts
// 0.9.14 线路粘性：cache 记录的上次成功线路排最前（稳定排序保序；cache 缺失 = 原序）。
// 粘性读不判 TTL——过期 cache 的 source 依然是有效线路记忆；force 同样生效。
const stickySource = (await readCacheFile(chain.namespace, DEFAULT_CACHE_KEY, chain.profile))?.source
const ordered = stickySource
  ? [...routes].sort((a, b) => Number(b.source === stickySource) - Number(a.source === stickySource))
  : routes
for (const candidate of ordered) { /* 原 for-of 循环体不变，仅把 routes 换成 ordered */ }
```

  - Change: 仅 `loadDefaultChain`；custom 链、candidate、`loadRegistry` 主体不动。
- [ ] Step 4: 运行并确认通过
  - Run: `npm run build` → `node --test tests/registry.test.mjs`
  - Expected: 全绿（新增 2 例 + 既有「主线路失败备用成功」「全线路失败」「force 绕过 TTL」等用例零回归）。
- [ ] Step 5: checkpoint commit
  - Run: `git add src/core/registry.ts tests/registry.test.mjs` → `git commit -m "perf(0.9.14): default 链线路粘性——cache 记录的上次成功线路优先"`
  - Expected: commit 成功。

### Task 2: registry SWR——TTL 过期先回 stale + 后台单飞（registry.ts loadRegistry）

- 目标：`loadRegistry` 命中过期 cache 时同步返回缓存数据，网络刷新转入后台单飞；`force` 始终同步强刷。
- Files:
  - Modify: `src/core/registry.ts` — `loadRegistry`（L852-870）；文件尾新增模块级单飞表 + 测试钩子
  - Test: `tests/registry.test.mjs` — 新增 `describe('loadRegistry SWR', ...)`
- 接口契约:
  - Consumes: Task 1 产出的 `loadDefaultChain` 粘性排序（后台刷新复用整条既有链，无新接口）；既有 `readCacheFile`/`cacheFresh`/`loadedFromCacheFile`（L524/L538/L688）；既有测试 helper `writeCacheFixture`、`parseRegistryAddress(undefined).cacheKey`（default cacheKey 获取法，镜像 L622-623）。
  - Produces: `export function _waitForRegistryBackgroundForTests(): Promise<unknown>`（语义 = allSettled 当前全部后台单飞；Task 2 测试专用）。
- 验证范围: 新增用例红转绿：过期 cache + 慢线路 → 同步返回 <500ms 且 `server.hits` 不增；后台完成后二次读取零网络拿到数据；force 直通不进 SWR。

- [ ] Step 1: 写失败测试：

```js
it('SWR：过期 cache 先回 stale（零同步网络），后台刷新后二次读取零网络拿新数据', async () => {
  const defAddr = parseRegistryAddress(undefined)
  writeCacheFixture('host', defAddr.cacheKey, reg([localEntry(1)]), { source: 'default-cache' })
  const srv = await startSlowRegistryServer(800)   // 本 describe 自建：/a.json 延迟 800ms 返回合法 registry（reg([localEntry(1)]) 同构 1 条），hits 计数
  const t0 = Date.now()
  const stale = await loadRegistry({ cacheTtlMin: 0 }, { defaultRoutes: [{ source: 'default-raw', url: srv.url('/a.json') }] })
  assert.ok(Date.now() - t0 < 500, '过期 cache 应同步返回，不等网络')
  assert.equal(stale.status, 'stale'); assert.equal(stale.source, 'default-cache')
  assert.equal(srv.hits.count, 0, '同步路径零网络')
  await _waitForRegistryBackgroundForTests()
  assert.equal(srv.hits.count, 1, '后台恰好刷新一次')
  const fresh = await loadRegistry({ cacheTtlMin: 60 }, {})
  assert.equal(fresh.count, 1)
  assert.equal(srv.hits.count, 1, '二次读取零网络')
})

it('force 不进 SWR：过期 cache + force 同步等网络并强刷', async () => {
  /* 同上 seed；force: true + 慢服务器 → 断言耗时 ≥800ms、hits=1 */
})
```

  （`_waitForRegistryBackgroundForTests` 从 `../lib/core/registry.js` 具名导入——此刻尚不存在，Step 1 运行必然红。）
- Run: `node --test tests/registry.test.mjs`
- Expected: SWR 用例失败（现状：过期 cache 的非 force 调用同步走链，耗时 ≥800ms、hits=1；或 `_waitForRegistryBackgroundForTests is not a function`）。
- [ ] Step 2: 运行并确认当前失败（同上）。
- [ ] Step 3: 写最小实现：

```ts
// 0.9.14 SWR：过期 cache 同步先回，后台单飞刷新（key = namespace§profile§cacheKey）
const backgroundFlights = new Map<string, Promise<void>>()
export function _waitForRegistryBackgroundForTests(): Promise<unknown> {
  return Promise.allSettled([...backgroundFlights.values()])
}
```

  `loadRegistry` 重构为读一次 cache 三分支：TTL 内 → 既有直读；`!force` 且过期 → 返回 `loadedFromCacheFile(cached, address.normalized, [])` + 若无同 key 单飞则后台起链（单飞闭包**捕获本次调用的 cfg 与 opts**——含 `defaultRoutes` 测试缝、`signal` 除外，内部调既有 `loadDefaultChain`/`loadCustomChain` + ready 后 `pruneCaches`，namespace/profile 与本次一致，不接调用者 signal，`.finally` 自清）；`force`/无 cache → 既有同步链。后台失败静默（stale 已返回，下次再触发）。
  - Change: `loadRegistry` 主体 + 文件级单飞表与钩子；`loadRegistryCandidate`/`loadDefaultRegistry` 不动。
- [ ] Step 4: 运行并确认通过
  - Run: `npm run build` → `node --test tests/registry.test.mjs`
  - Expected: 全绿（含既有「force 绕过 TTL，普通读取遵循 cacheTtlMin」L606-616——它用 `cacheTtlMin: 60` 走 TTL 内分支，不受影响）。
- [ ] Step 5: checkpoint commit
  - Run: `git add src/core/registry.ts tests/registry.test.mjs` → `git commit -m "perf(0.9.14): registry SWR——TTL 过期先回 stale，后台单飞自愈；force 直通不变"`
  - Expected: commit 成功。

### Task 3: community SWR——TTL 过期先回 stale（community.ts runChain）

- 目标：社区目录过期时同步返回 stale 缓存，npm dist-tags 探测转入既有 force flight 后台执行；并发过期调用只触发一条后台 flight。
- Files:
  - Modify: `src/core/community.ts` — `runChain` 快速路径段（L328-344）；文件尾新增 `backgroundRefreshes` 数组 + 测试钩子
  - Test: `tests/community.test.mjs` — 既有 `describe('fetchCommunityCatalog（获取链）')` 内追加用例
- 接口契约:
  - Consumes: 既有 flight 机制 `fetchCommunityCatalog`（L521-559，flightKey 含 force 维度 L478）；既有测试 helper `makeState`/`startCatalog`（L144-192，`probeHits` 计数即探测次数）。
  - Produces: `export function _waitForCommunityBackgroundForTests(): Promise<unknown>`。
- 验证范围: 新增用例红转绿；**既有用例 ⑫（L341-353）与 ⑪（L327-339）属有意契约翻转，翻转范围不同——⑫：首调用为冷启动无缓存（tmp 缓存根全新，SWR 分支前提 `cached && pin===null` 不成立），走既有同步探测、断言 `ready` 不变；仅第二调用翻转 `stale` + `await _waitForCommunityBackgroundForTests()` 后核 `probeHits===2`/`bodyHits===2`/`checkedAt` 推进；⑪：暖机后把 checkedAt 改 garbage → 第二调用翻转 `stale` + 钩子后 `probeHits===2`/`bodyHits===2`。bodyHits 必为 2：后台是 force flight，不走同版本短路（community.ts L382 `if (!opts.force)`），正文必重拉（评审 R3-N6）；均改断言并行尾注释「0.9.14 SWR 契约翻转」，不删测试（评审 R1-#6）；其余用例（TTL 内 0 探测、force、pin、disabled、并发 flight）零回归。

- [ ] Step 1: 写失败测试（追加 it；既有 ⑪ L327-339 / ⑫ L341-353 两条断言将随契约翻转——Step 3 一并改）：

```js
it('SWR：过期 cache 先回 stale（零探测），后台 force flight 自愈', async () => {
  const st = makeState(); const s = await startCatalog(st)
  await fetchCommunityCatalog({}, { routes: s.routes })            // 暖机：probeHits=1
  const stale = await fetchCommunityCatalog({ cacheTtlMin: 0 }, { routes: s.routes })
  assert.equal(stale.state.status, 'stale')
  assert.equal(st.probeHits, 1, '同步路径零探测')
  await _waitForCommunityBackgroundForTests()
  assert.equal(st.probeHits, 2, '后台恰好探测一次（force flight）')
  const again = await fetchCommunityCatalog({ cacheTtlMin: 60 }, { routes: s.routes })
  assert.equal(again.state.status, 'ready')
})
it('SWR 并发：3 个过期调用只触发一条后台 flight', async () => {
  /* makeState({ bodyDelayMs: 60 }) 加宽 flight 存活窗口（仓库⑬ L356 先例，防 flight 自删间隙误报，评审 R1-#7）；
     暖机后 Promise.all 三个 cacheTtlMin:0 调用 → 全部 stale；await 钩子后 probeHits 仅 +1 */
})
it('force 不进 SWR：cacheTtlMin:0 + force 同步探测并返回 ready', async () => { /* probeHits 同步 +1、status ready */ })
```

- Run: `node --test tests/community.test.mjs`（首跑红因 = `_waitForCommunityBackgroundForTests` 具名导入缺失的模块级 SyntaxError、整文件红——与 Task 2 L160 同款，评审 R2-N5；实现后才是断言级红绿）
- Expected: SWR 用例红（现状过期调用同步探测后返回 `ready`，`probeHits` 在同步路径 +1）。
- [ ] Step 2: 运行并确认当前失败（同上）。
- [ ] Step 3: 写最小实现（`runChain` 快速路径改为三分支）：

```ts
if (!opts.force) {
  const cached = await readCache(dir, pin)
  if (cached && (pin !== null || withinTtl(cfg, cached.meta))) {
    /* 既有 ready 返回，原样 */
  } else if (cached && pin === null) {
    // 0.9.14 SWR：过期 → 同步回 stale，force flight 后台自愈（force 分支跳过快速路径，天然无递归）
    const bg = fetchCommunityCatalog(cfg, { ...opts, force: true, signal: undefined })   // 剥离 waiter signal：原请求 abort 不得经 releaseFlight 腰斩后台 flight（community.ts L506-513/L555，与 Task 2「signal 除外」对齐，评审 R1-#5）
      .finally(() => { const i = backgroundRefreshes.indexOf(bg); if (i >= 0) backgroundRefreshes.splice(i, 1) })
    backgroundRefreshes.push(bg)
    void bg.catch(() => undefined)
    return { state: stateOf({ status: 'stale', version: cached.meta.version, checkedAt: cached.meta.checkedAt,
      fetchedAt: cached.meta.fetchedAt, route: cached.meta.route, count: cached.catalog.plugins.length }), catalog: cached.catalog }
  }
}
```

  文件尾：`const backgroundRefreshes: Array<Promise<unknown>> = []` + `export function _waitForCommunityBackgroundForTests() { return Promise.allSettled([...backgroundRefreshes]) }`。
  随后把 ⑪/⑫ 两条既有断言翻转为新契约（改断言 + 行尾注释「0.9.14 SWR 契约翻转」，不删测试；⑫ 用例标题「仅更新 checkedAt、正文 0 拉取」随之失真，改为「TTL 过期 + 同版本：同步 stale 先回，后台 force 自愈重拉正文」，评审 R3-N6）。
  - Change: `runChain` 快速路径 + 钩子 + 既有用例断言翻转。
- [ ] Step 4: 运行并确认通过
  - Run: `npm run build` → `node --test tests/community.test.mjs`
  - Expected: 全绿（② TTL 内 0 探测、③ force 重拉、pin 隔离、waiter signal、并发合并等既有用例零回归）。
- [ ] Step 5: checkpoint commit
  - Run: `git add src/core/community.ts tests/community.test.mjs` → `git commit -m "perf(0.9.14): community SWR——过期先回 stale，force flight 后台自愈（契约翻转点已标注）"`
  - Expected: commit 成功。

### Task 4a: latest 缓存落盘模块（Create src/core/latest-cache.ts + tests）

- 目标：把 latest 探测缓存从 `market.ts` 的纯内存 Map 抽为独立模块，加磁盘信封层（懒 seed + write-through），服务重启后页条目探测零重放。
- Files:
  - Create: `src/core/latest-cache.ts`
  - Test: `tests/latest-cache.test.mjs`（`DSHM_CACHE_DIR` 隔离，镜像 `tests/registry.test.mjs` 的 beforeEach/afterEach 模式）
- 接口契约:
  - Consumes: `cacheRoot(profile)`（`src/core/env.js`，双 profile 段约定）；registry.ts `writeCacheFile` 同款的「原子写 + 静默失败」模式（本模块自实现原子写，不 import registry 内部私有函数）；`RegistryCacheNamespace`/`RegistryEntry` 类型（`import type` 自 registry.js）。
  - Produces（Task 4b 与 market.ts 的全部接缝，逐字命名）:

```ts
export const LATEST_CACHE_VERSION = 1
export interface LatestValue { version?: string; tag?: string; sha?: string }   // 与 market.ts 现 LatestValue 同形迁移
export function latestCacheKey(namespace: RegistryCacheNamespace, registryKey: string,
  item: Pick<RegistryEntry, 'source' | 'npm' | 'github' | 'id'>): string        // 实现自 market.ts L353-357 原样迁移
export function readLatestCache(key: string, ttlMin: number): LatestValue | null // 同步，仅内存；语义同 market.ts L358-367
export function writeLatestCache(key: string, value: LatestValue): void          // 内存 set + 磁盘 write-through（串行队列原子写，静默失败）
export async function ensureLatestCacheSeeded(opts?: { namespace?: RegistryCacheNamespace; profile?: string }): Promise<void>
  // 每 (namespace,profile) 记忆化一次；读 <cacheRoot>/latest/<ns>.json 信封 → 逐条灌内存（24h 硬上限淘汰）；损坏/版本不符整文件弃
export function resetLatestCacheForTest(): void   // 清内存 Map + seed 记忆化（dsh-version.ts L101 resetDshVersionCacheForTest 同款先例）
```

  磁盘文件：`<cacheRoot(profile)>/latest/<namespace>.json`——**nsDir 之外，规避 `pruneCaches`（registry.ts L545-561）对 `<ns>/` 顶层 `*.json` 的清扫（keep 集不含 latest）；本任务不改 registry.ts**（评审 R1-#1）。磁盘信封：`{ version: LATEST_CACHE_VERSION, namespace, entries: { [latestCacheKey字符串]: { at: number, value: LatestValue } } }`。
- 验证范围: `npm run build` 成功后 `node --test tests/latest-cache.test.mjs` 全绿。

- [ ] Step 1: 写失败测试（文件从零建，模块不存在即红）：

```js
import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
import assert from 'node:assert/strict'
import { beforeEach, afterEach, describe, it } from 'node:test'
import { writeLatestCache, readLatestCache, ensureLatestCacheSeeded, resetLatestCacheForTest, latestCacheKey } from '../lib/core/latest-cache.js'

describe('latest-cache 落盘', () => {
  let cacheRoot
  beforeEach(() => { cacheRoot = mkdtempSync(join(tmpdir(), 'dshm-latest-')); process.env.DSHM_CACHE_DIR = cacheRoot })
  afterEach(() => { delete process.env.DSHM_CACHE_DIR; rmSync(cacheRoot, { recursive: true, force: true }); resetLatestCacheForTest() })

  it('write-through：写入 → reset 模拟重启 → seed → readLatestCache 命中（零网络）', async () => {
    const key = latestCacheKey('host', '', { source: 'npm', id: 'a', npm: 'a' })
    writeLatestCache(key, { version: '1.2.3' })
    resetLatestCacheForTest()
    await ensureLatestCacheSeeded({ namespace: 'host' })
    assert.equal(readLatestCache(key, 60)?.version, '1.2.3')
  })
  it('TTL 过期条目 readLatestCache 返回 null（语义不变）', async () => { /* write 后把信封 at 改 2h 前 → reset+seed → read(key,60) === null */ })
  it('损坏信封静默弃、seed 后照常可写', async () => { /* 手写 latest.json = 'not-json' → seed 不抛 → write/read 正常 */ })
  it('namespace 隔离：host 写入，cli seed 不命中', async () => { /* reset → ensureLatestCacheSeeded({namespace:'cli'}) → read === null */ })
})
```

- Run: `npm run build` → `node --test tests/latest-cache.test.mjs`
- Expected: 红（`Cannot find module .../lib/core/latest-cache.js`——构建产物缺入口亦算红信号）。
- [ ] Step 2: 运行并确认当前失败（同上）。
- [ ] Step 3: 写最小实现 `src/core/latest-cache.ts`：按接口契约逐字实现；`latestCacheKey`/`readLatestCache` 从 `market.ts` L337-373 原样迁移；磁盘层 = `mkdir(join(cacheRoot(profile), 'latest'), { recursive: true })`（**目录缺席时 writeFile 会静默失败、write-through 全丢——写前必须 mkdir**，评审 R2-N4）+ `readFile(join(cacheRoot(profile), 'latest', `${namespace}.json`))` + JSON.parse 守卫（version/namespace 校验，任一不符整文件弃）+ `writeFile(tmp)` + `rename` 原子写；`writeLatestCache(key, value)` 无 namespace 参数——ns 自 key 首段 `|` 前缀解析定位 `<ns>.json` 信封；persist 用模块级 promise 链串行化（`persistChain = persistChain.then(flush)`）；seed 记忆化用 `Map<`${ns}§${profile}`, Promise<void>>`。
  - Change: 新文件 ~120 行；不动 market.ts（4b 再接）。
- [ ] Step 4: 运行并确认通过
  - Run: `npm run build` → `node --test tests/latest-cache.test.mjs`
  - Expected: 构建成功、4 用例全绿。
- [ ] Step 5: checkpoint commit
  - Run: `git add src/core/latest-cache.ts tests/latest-cache.test.mjs` → `git commit -m "feat(0.9.14): latest 探测缓存落盘模块（信封 seed + write-through，双 profile 隔离）"`
  - Expected: commit 成功。

### Task 4b: market.ts 接线 latest 落盘（迁移 + seed 调用）

- 目标：`market.ts` 删除本地 latestCache 实现，改 import `latest-cache.js`；两处探测段前 seed——重启后首开零探测重放。
- Files:
  - Modify: `src/core/market.ts`（L337-373 三件套与 `LatestCacheEntry` 删除；L811-817 与 L964-973 两处探测段、L842/L994 两处 `writeLatestCache` 调用点）
  - Modify: `tests/market.test.mjs` — **仅测试基建**：模块顶层 `mkdtempSync` + `process.env.DSHM_CACHE_DIR` 赋值 + `after()` 还原删除（现状该文件零 `DSHM_CACHE_DIR`——评审 R1-#4 grep 证实；不补则 seed/write 读写真实 `~/.dsh`，违反全局约束）
  - Modify: `tests/registry.test.mjs` — 追加 1 例 latest×prune 交互回归：seed latest → force `loadRegistry`（触发 pruneCaches）→ `latest/host.json` 仍存活（锁死「信封在 nsDir 外」不变量，评审 R1-#1）
- 接口契约:
  - Consumes: Task 4a 的 `latestCacheKey`/`readLatestCache`/`writeLatestCache`/`ensureLatestCacheSeeded`（逐字同名）。
  - Produces: 无（market.ts 行为不变，缓存多一层磁盘）。
- 验证范围: `node --test tests/market.test.mjs` 与 `node --test tests/registry.test.mjs` 全绿（探测注入计数类用例证明行为零漂移 + prune 回归锁不变量）；全量 `npm test` 在 Task 6 收口。

- [ ] Step 1: 改动前检查（记录基线）
  - Run: `node --test tests/market.test.mjs`
  - Expected: 当前全绿。
- [ ] Step 2: 实现——先落 `tests/market.test.mjs` 基建（跑一次 market 套件确认仍全绿），再做迁移：删除 `market.ts` 内 `LatestCacheEntry`/`LATEST_CACHE_MAX`/`latestCache`/`latestCacheKey`/`readLatestCache`/`writeLatestCache`（L337-373），改为 `import { latestCacheKey, readLatestCache, writeLatestCache, ensureLatestCacheSeeded } from './latest-cache.js'`；`listMarket` 的 `if (withLatest && items.length > 0)` 块首（L811 后）与 `listInstalledWithMeta` 的探测段前（L964 附近）各插 `await ensureLatestCacheSeeded({ namespace, profile: opts.profile })`。所有调用点签名不变（`latestCacheKey(namespace, loaded.configuredAddress, item)` 等）。最后追加 registry.test.mjs 的 prune 回归用例。
  - Change: 测试基建 + 纯迁移 + 两处 seed 调用 + 1 例 prune 回归。
- [ ] Step 3: 运行并确认通过
  - Run: `npm run build` → `node --test tests/market.test.mjs` → `node --test tests/registry.test.mjs`
  - Expected: 与 Step 1 基线同绿 + prune 回归绿（任何红 = 迁移破坏签名/语义，修复实现后再跑，不改断言）。
- [ ] Step 4: checkpoint commit
  - Run: `git add src/core/market.ts tests/market.test.mjs tests/registry.test.mjs` → `git commit -m "refactor(0.9.14): market 接线 latest 落盘——探测缓存跨重启存活（prune 交互回归锁定）"`
  - Expected: commit 成功。

### Task 5a: 客户端快照纯模块（Create src/client/market-snapshot.js + tests）

- 目标：默认首页响应快照的读写纯逻辑（localStorage），消灭面板挂载即空态的必现 spinner 的数据面。
- Files:
  - Create: `src/client/market-snapshot.js`
  - Test: `tests/client-market-snapshot.test.mjs`（镜像 `tests/client-self-check.test.mjs` 的用例族与内存 fake storage）
- 接口契约:
  - Consumes: `normalizeMarketResponse`（`src/client/market-state.js` L103）——快照存**收敛后**的响应对象；读侧由调用方（Task 5b）再次收敛，本模块只做最小形状校验（`response.items` 为数组 + `response.total` 为数字）。
  - Produces（Task 5b 逐字消费）:

```js
export const MARKET_SNAPSHOT_TTL_MS = 10 * 60 * 1000
export function snapshotKey(zone)                    // 'dshm-marketsnap-primary' | 'dshm-marketsnap-community'
export function isDefaultFirstPageQuery(query, zone) // query===''/category==null/offset===0/limit 为该区默认(24|96)/sort 为该区默认（community={downloads,desc}，primary=null）
export function readMarketSnapshot(storage, { zone, now, ttlMs })          // 过期/畸形/storage 不可用 → null
export function writeMarketSnapshot(storage, { zone, response, now })      // 非默认首页形状的 response 拒写；静默降级
export function clearMarketSnapshots(storage)
```

  存储盒：`{ ts, response }`（键含 zone 自隔离；不需版本护栏——读侧 normalize 双重收敛兜形状，见架构快照）。
  测试导入路径写死：`import { ... } from '../src/client/market-snapshot.js'`——client 族 esbuild 单 bundle 只产 `lib/client.js`，无 `lib/client/*.js` 逐文件产物，从 `../lib/` 导入必假红（client-self-check.test.mjs L15 先例，评审 R1-#8）；本任务测试直跑 src，无需 build。
- 验证范围: `node --test tests/client-market-snapshot.test.mjs` 全绿（无需 build；构建门在 Task 5b/6）。

- [ ] Step 1: 写失败测试（用例族照抄 client-self-check.test.mjs 结构）：命中（写入后立读得原对象）、TTL 过期 null、畸形 JSON null、形状缺失（无 items）null、非默认首页形状拒写、storage 抛异常静默、clear 后 null、`isDefaultFirstPageQuery` 六分支真假表（两 zone × 默认/非默认 sort/limit）。
- Run: `node --test tests/client-market-snapshot.test.mjs`
- Expected: 全红（模块不存在）。
- [ ] Step 2: 运行并确认当前失败（同上）。
- [ ] Step 3: 写最小实现 `src/client/market-snapshot.js`（~90 行，JSDoc 注释，风格对齐 self-check.js）。
  - Change: 新文件。
- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-market-snapshot.test.mjs`
  - Expected: 全绿。
- [ ] Step 5: checkpoint commit
  - Run: `git add src/client/market-snapshot.js tests/client-market-snapshot.test.mjs` → `git commit -m "feat(0.9.14): 市场默认首页快照纯模块（localStorage + 10min TTL）"`
  - Expected: commit 成功。

### Task 5b: useMarketData 接线快照（main.jsx）

- 目标：面板挂载命中快照 → 立即渲染上次默认首页，background 模式静默换新；失败静默保留。
- Files:
  - Modify: `src/client/main.jsx` — `useMarketData`（L562-615）与 `fetchPage`
  - Test: 无新增自动化（React 层无测试基建，仓库先例即纯逻辑外置 + Node 测试）；验证 = 构建门 + 全量套件 + 装机后人工 E2E（附录）
- 接口契约:
  - Consumes: Task 5a 全部具名导出（`readMarketSnapshot`/`writeMarketSnapshot`/`isDefaultFirstPageQuery`）；既有 `normalizeMarketResponse`、`normalizeMarketQuery`。
  - Produces: 无外部接口（组件内行为）。
- 验证范围: `npm run build` 成功（esbuild 语法/引用门）+ `npm test` 既有 client 用例零回归。

- [ ] Step 1: 改动前检查（记录基线）
  - Run: `npm run build` → `npm test`
  - Expected: 基线全绿。
- [ ] Step 2: 实现——`useMarketData` 改造（保持既有 generation/abort 守卫与 `updateQuery`/`reload` 语义不变）：

```js
// 仅首渲染读一次 localStorage（useState 惰性初始化，评审 R1-#9——不得每 render 重复读）
const [boot] = useState(() => {
  const snap = readMarketSnapshot(typeof window !== 'undefined' && window.localStorage ? window.localStorage : null, { zone })
  return snap ? { data: normalizeMarketResponse(snap.response), has: true } : { data: null, has: false }
})
const [data, setData] = useState(boot.data)
const [loading, setLoading] = useState(!boot.has)
const dataRef = useRef(data)
// fetchPage 加第三参 background（默认 false）：
// - background 且 dataRef.current 存在 → 不置 loading、不清 data；
// - then: setData(normalizeMarketResponse(raw)); dataRef.current 同步; isDefaultFirstPageQuery(nextQuery, zone) → writeMarketSnapshot(...response: 收敛产物)
// - catch: background && dataRef.current ? 静默 : 既有 setError
// 挂载 useEffect: fetchPage(queryRef.current, false, boot.has)
```

  （上述为语义草图；实现以最小 diff 落在既有 `fetchPage`/`useEffect` 结构内，不重排函数。）
  - Change: `useMarketData` + `fetchPage` 签名加第三参；其余组件零改动。
- [ ] Step 3: 运行并确认通过
  - Run: `npm run build` → `npm test`
  - Expected: 全绿（含 client-market-state 等既有 client 用例）。
- [ ] Step 4: checkpoint commit
  - Run: `git add src/client/main.jsx` → `git commit -m "feat(0.9.14): useMarketData 快照秒开——默认首页先渲染 background 换新"`
  - Expected: commit 成功。

### Task 6: 文档并入既有 0.9.14 节 + 全量门禁收口

- 目标：缓存语义说明落盘（README 已有 0.9.14 节、version 已 bump——569f8f6 完成，勿重复）；仓库门禁全绿；提交序列整理待审。
- Files:
  - Modify: `README.md`、`README.en.md`（**并入既有「0.9.14 变更」节**补一条「打开秒开（SWR + 快照）/ 线路粘性 / 探测缓存跨重启」）、`docs/DESIGN.md`（缓存章节加一段：TTL 过期先回 stale + 后台自愈 + force 同步强刷 + 线路粘性 + latest 落盘 + 客户端快照 10min TTL）；`package.json` **仅核对 0.9.14 不改动**
  - Test: 无新增
- 接口契约:
  - Consumes: 全部前序任务已合入；仓库门禁 `npm run typecheck`、`npm test`、`node scripts/validate-registry.mjs`。
  - Produces: 0.9.14 本地提交序列（附录发版流程的输入）。
- 验证范围: 三门禁全绿 + `git log` 提交序列可读。

- [ ] Step 1: 文档改动（README 中/英并入既有 0.9.14 节；DESIGN.md 缓存段；核对 package.json version === '0.9.14'）。
- [ ] Step 2: 全量门禁
  - Run: `npm run typecheck` → `npm test` → `node scripts/validate-registry.mjs`
  - Expected: typecheck 0 error；测试全绿（总量 = 各任务基线 + 本计划新增 registry×5 / community×3 / latest-cache×4 / market-snapshot×8± 用例）；registry 校验全绿（registry.json 未改，例行跑——know-how 008 纪律）。
- [ ] Step 3: 整理与报告
  - Run: `git log --oneline 569f8f6..HEAD` 与 `git diff 569f8f6..HEAD --stat`
  - Expected: 恰 9 个新语义化提交（Task 1/2/3/4a/4b/5a/5b/6 共 8 个 + 实施计划文档 docs 提交 1 个——计划文档随实现入仓），diff 只触及「文件结构与职责」清单内的文件 + 本计划文档；输出修改摘要交主人审。
- [ ] Step 4: checkpoint commit
  - Run: `git add README.md README.en.md docs/DESIGN.md` → `git commit -m "chore(0.9.14): 缓存语义文档（并入既有 0.9.14 变更节）"`
  - Expected: commit 成功。

## 风险与回退

- stale 数据上限 = 一个 TTL 周期（默认 60min），期间 1-2 次打开内后台自愈；community 侧 `communityStale` 横幅如实标注，registry 侧设置页来源卡可查。
- latest 信封损坏/版本不符 → 整文件静默弃，行为退化为现状（探测重放），无新增错误面。
- 客户端快照 10min 内 installed/outdated 徽标可能陈旧，background 换新后纠正；不阻塞任何操作。
- 回退 = 按任务 checkpoint commit 逐个 `git revert`（四件相互独立；push 前零外部影响）；SWR 语义若撞上隐藏假设，回退顺序 Task 3 → Task 2（Task 1/4/5 无语义风险）。
- 后台单飞表/flight 表进程生命周期内自清（`.finally`），泄漏面 = 进程级、无害；CLI 单发进程随进程消亡。
- 社区 bg 自愈为 force flight，每 TTL 至多全量重拉一次正文（bg 路径放弃「同版本不重拉」省流优化——community.ts L382 `if (!opts.force)` 守卫；同步路径优化保留；catalog 当前 ~5MB、flight 有 30s hard cap，代价可接受）。如需省流，后续可加内部 bypass 旗标（跳 SWR 但保留短路）——非本次范围（评审 R3-N6 语义注记）。

## 执行纪律

- 开始实现前先批判性复查本计划：发现缺项、矛盾、命名不一致或命令无效，先修计划再动工。
- 当前分支为 `main`（本仓历史惯例直接 main 提交）——**开工前须主人一句确认**；确认前不动第一行代码。
- 按任务顺序执行（1 → 2 → 3/4a/5a 可并行 → 4b/5b → 6），不无声跳步、合并步或改变任务目标。
- 每完成一个任务跑该任务的验证命令；红不收尾——修到绿才 commit。
- 既有测试红了的判定规则：**本计划明示的契约翻转**（community 用例 ⑪/⑫ 两条）→ 改断言并注释标注；**其余任何红** = 回归，修复实现而不是改断言；判定不了立即停下说明。
- 遇阻塞、重复失败或计划与仓库现实不符（行号漂移、helper 缺失），立即停下来说明，不猜。
- 全部任务完成后跑最终验证并输出修改摘要。

## 最终验证

- `npm run typecheck`（预期 0 error）
- `npm test`（预期全绿，pretest 自动 build；含本计划新增 registry×5 / community×3 / latest-cache×4 / market-snapshot×8± 用例族）
- `node scripts/validate-registry.mjs`（预期全绿）
- `git log --oneline 569f8f6..HEAD`（预期恰 9 个语义化提交：8 任务 + 1 计划文档，工作树干净）

## 附录：发版与装机（计划外动作，每步须主人确认后执行）

1. push main + tag `v0.9.14` → GitHub Actions publish.yml（OIDC Trusted Publishing）。
2. **know-how 018 纪律**：publish 步骤绿 ≠ 上架（staged 异步定稿 ~17-39 分钟）；窗口期不重推 tag；以 per-version 文档 200 为准；异常按 018 §5 取证四步。
3. **know-how 020 纪律**：本机 desktop profile 装机受 npmmirror 滞后 + `minimumReleaseAge` 24h 约束——(a) 等 24h 产品内正常升级，或 (b) 操作员通道（020 §3：npmmirror sync PUT + `dsh plugin --profile desktop add dsh-m@0.9.14`，操作员显式 pin，产品内绝不内置）。
4. 装机后端到端清单：①>60min 冷打开 ≤1s 出列表（stale 窗口期社区横幅短暂出现属预期）；②「强制刷新」仍同步强刷、社区卡不连坐（0.9.11 语义保持）；③重启 DSH 服务后首开 latest 徽标即刻在位（磁盘 seed）；④设置页来源卡 source 粘性 jsDelivr、连续冷打开无 `default-raw 失败` 等待；⑤registry.json 上游更新 1-2 次打开内出现（后台自愈）。

## 审阅 Checkpoint

- 计划正文到此为止，请主人审阅；审阅通过前不进入实现。
- 审阅通过后默认执行方：普通编码 agent（本会话即可继续）或人工执行者，按任务清单逐个消费。
