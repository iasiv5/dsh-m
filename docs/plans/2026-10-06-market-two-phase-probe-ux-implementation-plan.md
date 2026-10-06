# dsh-m 0.9.45 市场页两段加载 + force 探测穿透 + 精选页动线批 实施计划（v2，评审轮次 R1-R12 修订）

## 目标

- **P1**：市场页（社区 + 精选两区）改两段加载——第一段 `probeMode:'cache-only'` 零网络瞬时回页，第二段沿用既有探测语义就地补全徽标；消灭「重启后首开徽标滞后 0.6–1.5s（弱网 8–16s）」。
- **P2**：设置页「强制刷新」穿透探测缓存——**force 语义 = peek 旧值兜底 + 全页重探**（落实 ADR-0006 在案的「peek 不删除」实现约束，见 ADR-0013），并补齐设置页 → 市场区的 force 接线。
- **U10**：详情 Modal 对已装且可升级条目提供「升级」主按钮（动线断裂修复）+ 收录日期本地化 + README 折叠页。
- **U9**：错误行内联「重试」按钮 + 空态三分支（unavailable 主文案 / 分类空桶文案 / 通用）。
- **U12**：收藏快照补 verified/audience/decoupled 三字段，收藏区恢复精选条目身份（「精选」+「已实测」徽标；**受众/解耦徽标不进收藏区**，DESIGN §2.7 裁决⑤不动）。
- **U8**：Modal 可达性子集（role=dialog/aria-modal/初始聚焦/灯箱键盘）；**不做** Tab 圈闭与焦点还原。
- **U3/U7**：0 计数桶显式渲染「0」+ 降透明度、空桶专用空态、Σchips>总数 的容器 title 说明。
- **范围边界**：U2（curatedNote 策展评语）待 owner 拍板，**明确不在本批**；§6.2 其余 21 项维持不做。

## 架构快照

两段加载（已装页 ADR-0008 的市场页扩展，ADR-0013 记录）：

```
GUI market 调用（useMarketData.fetchPage）
  第一段  probeMode:'cache-only' ──▶ listMarket：只回 TTL 内 latest 缓存命中，零网络；
  │                                  有缺口 → latestComplete=false（缺口判定豁免社区 github，Q46）
  │(缺口时自动)
  第二段  probeMode:'full' ──▶ listMarket：既有语义（缓存新鲜直用 + 未命中/过期 inline
                              探测，8 并发 + deadline 兜底），就地 patch 徽标；完成后才写快照

设置页「强制刷新」──▶ onForceMarket → marketReloadAll(true) → reload(true)（force 入参）
                 ──▶ core：peek 旧值兜底展示 + 全页重探（成功覆盖 / 失败保留旧值 + latestError）
```

- 服务端 latest 缓存保持**纯内存**（ADR-0006 不翻案）；**force 不用 ttlMin=0**——ADR-0006 在案要求「peek 不删除语义，而非 ttlMin=0 先删后探」，故 `latest-cache.ts` 新增 `peekLatestCache(key)`（不判 TTL、不删除），force 重探失败时旧值兜底、不产生空徽标窗口。
- `MarketQuery` 新增**两态** `probeMode: 'full' | 'cache-only'`（缺省 'full' 与 0.9.44 等价）。不设 `'only'`：已装页 'only' 是「打开即见新鲜」语义（ttlMin=0 先删后探），与 force 的「旧值兜底重探」不同质，不把 ADR-0006 明示拒绝的先删后探带进浏览页。`withLatest` 契约与 tools/CLI 通路不动。
- 客户端 `mergeLatestFields`（market-state.js 纯函数）：**会话内上一轮响应**（上一筛选态 / 已 merge 的第二段结果）有 latest 族字段而新首段缺 → 按 id 叠加（快照不含 latest 族字段，重启场景天然无徽标可保——该函数防的是会话内导航的徽标回退）。
- `reload`（mutation 后 refreshViews / 显式刷新）不走两段，直发 `full`；force 由既有 params 入参传递，core 侧触发 peek 重探。
- 边界行为（grill 定稿）：冷条目第一段**安静**（无 latest 字段即不渲染该行，不占位）；第二段整体失败**静默保留**第一段数据（background 语义，Q11②）；快照只在「第二段 merge 完成」或「第一段无缺口」时写。

## 全局约束

- 环境：Node ≥ 22、Windows + pwsh；验证命令一律 npm scripts / `node --test`（`npm test` 自带 `pretest` 构建）；命令在 `dsh-m/` 目录下执行。
- 测试隔离纪律（逐字继承仓库惯例）：凡触到 latest cache / registry cache 的测试，`DSHM_CACHE_DIR` 指向 `mkdtempSync` 临时目录，绝不触碰 `~/.dsh`；内存 latest cache 用 `resetLatestCacheForTest()` 复位。
- 三端契约：tools/CLI 的 `withLatest:false` 通路与 `dshm_search` 输出**零变化**；`probeMode` 缺省 `'full'` 时 core 行为与 0.9.44 逐字节等价（既有测试不得回归）。
- 文案规则：新 i18n 键 ZH/EN 双语同批补齐（`lookup` 键名沿用现有点分风格）；中文优先立场不变。
- 渲染断言规则（评审 R9）：SSR 断言优先用**结构/类名/属性/title 等语言无关标记**或源码正则；确需文案时必须 ZH/EN 双兜底（对齐 client-render-smoke.test.mjs L64/L144/L207 既有惯例）。
- 发版纪律：本计划只产本地提交；push / tag / npm publish 须主人逐步确认（know-how 018/020），见文末附录。
- 无额外全局约束（依赖无新增；React/esbuild 版本不动）。

## 输入工件

- 设计共识：`01_docs/research/2026-10-06-dsh-m-curated-zone-ux-perf.md` §6（钢人存活清单）+ 本会话 grill 两轮定稿（Q1–Q11 全按推荐）+ 评审轮 R1–R12 修订。
- 既有 ADR：ADR-0006（latest 纯内存 + force 暂缓与 peek 约束）、ADR-0008（已装页两段加载）、ADR-0012（npm 路由）。
- 代码锚点（写作时行号，执行时以符号/锚段定位为准）：
  - `src/core/market.ts`：MarketQuery L139-163；listMarket 探测段 L805-864；已装页 probeMode 先例 L937-943；`force` 仅入 loadRegistry L709。
  - `src/core/latest-cache.ts`：内存 Map + readLatestCache（ttlMin=0 会先删后探，L43 在案注释）；新增 peek 入口。
  - `src/core/host-api.ts`：market case L387-447（`withLatest: true` 硬编码 L438）。
  - `src/client/main.jsx`：useMarketData L572-642；SettingsTab.refresh L1973-1986（**现状只刷 registry API，从不触达 market 重取**）；SettingsTab 挂载与 onRegistryChanged L2001/L2046；marketReloadAll L2587-2593；DetailModal L1036-1185（actions L1175-1181、added kv L1113、desc L1130）；MarketTab L1196+（收藏区早退 L1416、错误/空态分支 L1618-1623、市场区 Modal 挂载 L1662-1673、ZoneChips 挂载 L1605-1612）；ZoneChips L879-958（chip 渲染 L932-937）；snapshotOf L2236-2249；FavoriteZone 徽标 L2308-2313；ReadmeBlock L1713-1733；fmtDate L551-555；InstalledTab.doUpgrade L1789-1822（三分支范式：builds 后缀 L1801 / guard L1805-1815）；i18n ZH L31-133 / EN L141-247（EN：zone.primary=Curated、badge.verified=Verified、action.upgrade=Upgrade、modal.added=Added）。
  - `src/client/market-state.js`：normalizeMarketResponse L118-177。
  - `src/client/market-snapshot.js`：isDefaultFirstPageQuery / writeMarketSnapshot。
  - 测试范式：`tests/market.test.mjs`（fakeDeps/readyLoaded/resetLatestCacheForTest/社区用例构造）、`tests/host-api.test.mjs`（dispatcher + calls.listMarket 捕获）、`tests/client-market-state.test.mjs`、`tests/client-render-smoke.test.mjs`（SSR + 源码正则断言，__DetailModal/__ZoneChips/__FavoriteZone 已导出）。

## 文件结构与职责

Create:
- `docs/adr/0013-market-two-phase-probe.md` — P1/P2 决策记录（重开 ADR-0006 force 暂缓裁决，**按 peek 不删除语义落实**，并记录 §6.1「检查中」条件被 grill Q10 替代的再裁决）。

Modify:
- `src/core/market.ts` — MarketQuery.probeMode 两态 + 探测段重构 + force peek 重探 + outdated 全模式执行。
- `src/core/latest-cache.ts` — 新增 `peekLatestCache(key)`（不判 TTL、不删除）。
- `src/core/host-api.ts` — market case 解析/校验/透传 probeMode（两态）。
- `src/client/market-state.js` — 新增 `mergeLatestFields` 纯函数。
- `src/client/main.jsx` — useMarketData 两段接线；SettingsTab 强刷接线（onForceMarket）；DetailModal（升级按钮/README fold/added 本地化/可达性）；MarketTab（doUpgrade/错误重试/空态三分支/chips title/Modal 接线）；ZoneChips（0 计数）；snapshotOf 与 FavoriteZone 徽标；i18n ZH/EN 新键；CSS `.dshm-chip.zero`。
- `src/client/favorites.js` — snapshot typedef 注释补三字段（一行）。
- `package.json` — version → 0.9.45。
- `CHANGELOG.md` — 中英双语 0.9.45 条目（双语区块各 prepend）。
- `docs/DESIGN.md` — §2.6 追加「修订（2026-10-06，0.9.45）」段。
- `GLOSSARY.md` — 新增/交叉引用「探测模式（Probe Mode）」「市场两段加载」术语（R15①：两态定名）。
- `README.md` — 界面小节一行增补（Modal 升级按钮与 README 预览）。

Test:
- `tests/market.test.mjs`、`tests/host-api.test.mjs`、`tests/client-market-state.test.mjs`、`tests/client-render-smoke.test.mjs`（各增用例/断言）。

边界保持：`src/core/registry.ts`、`src/core/versions.ts`、`src/tools.ts`、`src/cli.ts`、`src/client/market-snapshot.js` **一律不动**。

## 任务清单

依赖关系：Task 1 → Task 2 → Task 4；Task 3 → Task 4；Task 5 → Task 6（同文件先后）；Task 7/8/9/10 相互独立但与 Task 4/5/6 同文件，**按编号顺序执行避免同段冲突**；Task 11 依赖全部；Task 12 收口。

### Task 1: market.ts 探测两态 probeMode + force peek 重探

- 目标：`listMarket` 支持 `probeMode: 'full' | 'cache-only'`（缺省 'full' 行为不变）；`force` 触发「peek 旧值兜底 + 全页重探」（不走 ttlMin=0，ADR-0006 在案约束）；outdated 判定对**所有模式**执行。
- Files:
  - Modify: `src/core/latest-cache.ts` — 新增 `peekLatestCache(key)`（按该文件既有 Map 结构对齐取数，不判 TTL、不删除）
  - Modify: `src/core/market.ts` — MarketQuery（L139-163 接口内）+ listMarket 探测段（L805-863）
  - Test: `tests/market.test.mjs` — 新增 `describe('market probeMode 与 force 探测（0.9.45 两段加载）')`
- 接口契约:
  - Consumes: `readLatestCache/latestCacheKey/writeLatestCache/resetLatestCacheForTest`（lib/core/latest-cache.js，已有）；`fakeDeps/readyLoaded`（tests/market.test.mjs 既有 helper；社区用例构造镜像文件内既有社区用例）。
  - Produces: `MarketQuery.probeMode` 两态（Task 2 透传、Task 4 客户端消费）；`peekLatestCache`（仅 core 内部消费）；`latestComplete=false` 新语义（cache-only 有缺口时）。
- 验证范围: `npm run build && node --test tests/market.test.mjs` 新用例由红转绿；既有用例零回归。

- [ ] Step 1: 写失败测试（追加到 `tests/market.test.mjs` 末尾；`beforeEach` 调 `resetLatestCacheForTest()`）：

```js
describe('market probeMode 与 force 探测（0.9.45 两段加载，ADR-0013）', () => {
  beforeEach(() => resetLatestCacheForTest())
  const oneEntry = (id, npm) => [{ id, name: id.toUpperCase(), description: 'd', category: 'tools', tags: [], source: 'npm', npm }]

  it("cache-only：缓存命中直用、零网络、无缺口 latestComplete=true", async () => {
    const { deps, calls } = fakeDeps({ loadRegistry: async () => readyLoaded(oneEntry('a', 'pkg-a'), { configuredAddress: 'reg-co-warm' }) })
    await listMarket({}, { source: 'primary', limit: 32 }, deps)            // 暖缓存（full 缺省）
    assert.equal(calls.npm.length, 1)
    const res = await listMarket({}, { source: 'primary', limit: 32, probeMode: 'cache-only' }, deps)
    assert.equal(calls.npm.length, 1, 'cache-only 零网络')
    assert.equal(res.items[0].latestVersion, '2.0.0', '缓存命中直用')
    assert.equal(res.latestComplete, true, '无缺口不需要第二段')
  })

  it("cache-only：冷缓存有缺口 → latestComplete=false 且零网络（客户端据此发起第二段）", async () => {
    const { deps, calls } = fakeDeps({ loadRegistry: async () => readyLoaded(oneEntry('b', 'pkg-b'), { configuredAddress: 'reg-co-cold' }) })
    const res = await listMarket({}, { source: 'primary', limit: 32, probeMode: 'cache-only' }, deps)
    assert.equal(calls.npm.length, 0)
    assert.equal(res.latestComplete, false)
    assert.equal(res.items[0].latestVersion, undefined)
  })

  it("cache-only：缺口判定豁免社区 github 条目（Q46）——github 缺口不构成第二段理由", async () => {
    // 构造镜像本文件既有 ⑥ 用例（R13：catalog 键为 plugins、条目无显式 id——适配层派生
    // `${owner}--${name}`；github 条目 npm 置 null；withCommunity 签名以文件内既有用例为准）
    // R16：withCommunity 返回 { deps, ccalls }——npm 捕获在 fakeDeps 的 base.calls.npm
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(oneEntry('g', 'pkg-g'), { configuredAddress: 'reg-gh' }) })
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('gh-only', 'o9', { npm: null, tarball: 'https://example.com/gh-only.tgz', category: 'c-gh' }),
    ]))
    await listMarket({}, { source: 'all', limit: 32 }, deps)                // 暖缓存（npm 探测 1 次）
    assert.equal(base.calls.npm.length, 1)
    const res = await listMarket({}, { source: 'all', limit: 32, probeMode: 'cache-only' }, deps)
    assert.equal(base.calls.npm.length, 1, '第二段零网络（github 缺口被豁免）')
    assert.equal(res.latestComplete, true, 'github 条目不构成缺口（Q46 永久缺口，R5）')
  })

  it("cache-only：已装条目照常计算 outdated（暖缓存不丢「可升级」徽标，R3）", async () => {
    const { deps } = fakeDeps({
      loadRegistry: async () => readyLoaded(oneEntry('h', 'pkg-h'), { configuredAddress: 'reg-co-out' }),
      listInstalledPlugins: async () => ({ items: [{ pkg: 'pkg-h', name: 'H', version: '1.0.0', source: 'npm', spec: 'npm:pkg-h' }], others: 0, complete: true, profileDir: '/tmp/profile' }),
    })
    await listMarket({}, { source: 'primary', limit: 32 }, deps)            // 暖缓存
    const res = await listMarket({}, { source: 'primary', limit: 32, probeMode: 'cache-only' }, deps)
    assert.equal(res.items[0].latestVersion, '2.0.0')
    assert.equal(res.items[0].outdated, true, 'cache-only 也产出 outdated')
  })

  it("force：peek 旧值兜底 + 全页重探，成功覆盖旧值（不走 ttlMin=0）", async () => {
    let n = 0
    const { deps, calls } = fakeDeps({
      loadRegistry: async () => readyLoaded(oneEntry('i', 'pkg-i'), { configuredAddress: 'reg-force-ok' }),
      npmLatest: async (pkg) => { n += 1; calls.npm.push(pkg); return { version: n === 1 ? '2.0.0' : '3.0.0' } },
    })
    await listMarket({}, { source: 'primary', limit: 32 }, deps)            // 暖缓存 2.0.0
    const res = await listMarket({}, { source: 'primary', limit: 32, force: true }, deps)
    assert.equal(calls.npm.length, 2, 'TTL 内也全页重探')
    assert.equal(res.items[0].latestVersion, '3.0.0')
    assert.equal(res.latestComplete, true)
  })

  it("force：重探失败保留旧值 + latestError（peek 不删除，ADR-0006 在案约束，R6）", async () => {
    const { deps, calls } = fakeDeps({
      loadRegistry: async () => readyLoaded(oneEntry('j', 'pkg-j'), { configuredAddress: 'reg-force-fail' }),
      npmLatest: async (pkg) => { calls.npm.push(pkg); if (calls.npm.length === 1) return { version: '2.0.0' }; throw new Error('boom') },
    })
    await listMarket({}, { source: 'primary', limit: 32 }, deps)            // 暖缓存 2.0.0
    const res = await listMarket({}, { source: 'primary', limit: 32, force: true }, deps)
    assert.equal(calls.npm.length, 2)
    assert.equal(res.items[0].latestVersion, '2.0.0', '旧值兜底未被删除')
    assert.ok(res.items[0].latestError, '探测失败如实标注')
  })

  it("withLatest=false：probeMode/force 均不生效（tools/CLI 契约不变）", async () => {
    const { deps, calls } = fakeDeps({ loadRegistry: async () => readyLoaded(oneEntry('k', 'pkg-k'), { configuredAddress: 'reg-wl' }) })
    const res = await listMarket({}, { source: 'primary', limit: 32, withLatest: false, probeMode: 'cache-only', force: true }, deps)
    assert.equal(calls.npm.length, 0)
    assert.equal(res.latestComplete, true, '未进探测段，维持既有 true 契约')
  })
})
```

- Run: `npm run build && node --test tests/market.test.mjs`
- Expected（R14 修正）：**3 例红**——第 2 例（冷缓存 cache-only 现状 npm 被调用）、第 5/6 例（force 现状不重探：npm 仍 1 次、失败无旧值兜底）；第 1/3/4/7 例为守护/pin 用例，现状即绿（第 1 例现状二次调用本就缓存命中零网络、第 3 例豁免前提待实现后才有意义、第 4 例 outdated 现状即每次计算、第 7 例 withLatest 契约现状成立）。
- [ ] Step 2: 运行并确认失败（上一步输出即红信号）。
- [ ] Step 3: 写最小实现：

① `src/core/latest-cache.ts` 末尾追加（取数形态按该文件既有 Map 信封结构对齐）：

```ts
/** peek 读取（0.9.45，ADR-0013）：不判 TTL、不删除——供 force 全页重探时旧值兜底展示。
 *  落实 ADR-0006 在案约束：「force 穿透须用 peek 不删除语义，而非 ttlMin=0 先删后探（失败时旧值丢失）」。 */
export function peekLatestCache(key: string): LatestValue | undefined {
  /* 按既有 cache Map 结构取 value，不做过期判定、不 delete */
}
```

② `src/core/market.ts` MarketQuery（L160 `force?: boolean` 之后）追加：

```ts
  /** 探测两态（0.9.45 市场页两段加载，ADR-0013）：缺省 'full' 行为不变（缓存新鲜直用 + 未命中/
   *  过期 inline 探测）；'cache-only' 只回 TTL 内缓存命中、零网络，有缺口 → latestComplete=false
   *  （缺口判定豁免社区 github 条目——Q46 永久缺口不构成第二段理由）。
   *  force（非 cache-only 模式）：peek 旧值兜底 + 全页重探——不走 ttlMin=0（ADR-0006 在案约束：
   *  先删后探失败会丢旧值）；重探成功覆盖缓存，失败保留旧值 + latestError。 */
  probeMode?: 'full' | 'cache-only'
```

③ 探测段（L805-863）重构为：

```ts
  let latestComplete = true
  let latestTimedOut = false
  if (withLatest && items.length > 0) {
    await ensureLatestCacheSwept({ namespace, profile: opts.profile })
    const mode = opts.probeMode ?? 'full'
    const forceProbe = mode !== 'cache-only' && opts.force === true
    const ttlMin = Math.max(0, cfg.cacheTtlMin ?? 60)
    // 缓存填充：force 用 peek（旧值兜底，不判 TTL 不删除）；常态用 TTL 内命中
    for (const item of items) {
      const key = latestCacheKey(namespace, loaded.configuredAddress, item)
      const cached = forceProbe ? peekLatestCache(key) : readLatestCache(key, ttlMin)
      if (cached) applyProbe(item, cached)
    }
    if (mode === 'cache-only') {
      // 缺口判定镜像 todo 豁免（社区 github 永不探测 → 不构成缺口，Q46/R5）
      const gap = items.some((it) =>
        it.latestVersion === undefined && it.latestTag === undefined && it.latestSha === undefined &&
        !(it.community === true && it.source === 'github'))
      latestComplete = !gap
    } else {
      const todo = items.filter((it) =>
        !(it.community === true && it.source === 'github') &&
        (forceProbe || (it.latestVersion === undefined && it.latestTag === undefined && it.latestSha === undefined)))
      // ↓ 既有 L825-852 的 budget/mapWithConcurrency 探测循环整体移入此分支，内部逐字节不动；
      //   外层原「budget <= 0 则整批标 timeout」的 if/else 结构原样保留
      if (todo.length > 0) { /* …既有循环体原样… */ }
    }
    // outdated 判定对所有模式执行（R3：cache-only 暖缓存也不丢「可升级」徽标）——既有 L855-863 原样
    for (const item of items) { /* …原样… */ }
  }
```

- Change: latest-cache.ts 一个新纯函数；market.ts 接口 + 探测段；`probeTask`、`probeWithBudget`、既有循环体不动。
- [ ] Step 4: 运行并确认通过
  - Run: `npm run build && node --test tests/market.test.mjs`
  - Expected: 全绿（含既有用例）。
- [ ] Step 5: checkpoint commit（可选）：`git add -A && git commit -m "market: probeMode 两态 + force peek 重探（0.9.45 Task 1，ADR-0013）"`

### Task 2: host-api market case 透传 probeMode

- 目标：GUI 通道可携带 `probeMode`，非法值 400；缺省不下传（core 缺省 'full'）。
- Files:
  - Modify: `src/core/host-api.ts` — market case（L427-445 参数构造区）
  - Test: `tests/host-api.test.mjs` — 在既有「market 转发…」用例（L242）同 describe 内追加
- 接口契约:
  - Consumes: Task 1 的 `MarketQuery.probeMode`（两态）；`ApiProtocolError`；dispatcher 的 `calls.listMarket` 捕获（host-api.test.mjs L78-86）。
  - Produces: `/dshm market` 的 `probeMode` 通道（Task 4 客户端使用）。
- 验证范围: `npm run build && node --test tests/host-api.test.mjs` 新断言由红转绿。

- [ ] Step 1: 写失败测试（追加到 L276 附近的 market 用例之后）：

```js
  it('market 透传 probeMode 两态，非法值 400，缺省不下传（0.9.45 两段加载）', async () => {
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', probeMode: 'cache-only' } })
    assert.equal(calls.listMarket.at(-1).probeMode, 'cache-only')
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', probeMode: 'full' } })
    assert.equal(calls.listMarket.at(-1).probeMode, 'full')
    await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market' } })
    assert.equal(calls.listMarket.at(-1).probeMode, undefined, '缺省不下传')
    const badOnly = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', probeMode: 'only' } })
    assert.equal(badOnly.status, 400, '市场页不设 only（force 走标志位，R6）')
    const bad = await callApi(dispatcher, { headers: JSON_HEADERS, body: { method: 'market', probeMode: 'fast' } })
    assert.equal(bad.status, 400)
  })
```

- Run: `npm run build && node --test tests/host-api.test.mjs`
- Expected: 新用例红（probeMode 未解析：透传 undefined + 非法值 200）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现（market case，L424 sort 解析之后、L427 listMarket 调用之前）：

```ts
          // probeMode 两态（0.9.45 两段加载，ADR-0013）：GUI 两段式自带；非法值 400（与 source/sort 同款不静默吞）
          const probeModeRaw = typeof body.probeMode === 'string' ? body.probeMode : undefined
          if (probeModeRaw !== undefined && probeModeRaw !== 'full' && probeModeRaw !== 'cache-only') {
            throw new ApiProtocolError(400, `非法 probeMode: ${probeModeRaw}（需 full/cache-only）`)
          }
```

listMarket 调用参数（L438 `withLatest: true,` 下一行）追加 `probeMode: probeModeRaw,`。
- [ ] Step 4: 运行并确认通过
  - Run: `npm run build && node --test tests/host-api.test.mjs`
  - Expected: 全绿。
- [ ] Step 5: checkpoint commit（可选）。

### Task 3: market-state.js 增 mergeLatestFields 纯函数

- 目标：会话内徽标不回退的客户端纯逻辑——新 items 缺 latest 族字段而上一轮 items 有 → 按 id 叠加。
- Files:
  - Modify: `src/client/market-state.js` — 文件末尾追加导出
  - Test: `tests/client-market-state.test.mjs` — 追加 describe
- 接口契约:
  - Consumes: 无（自包含纯函数）。
  - Produces: `mergeLatestFields(nextItems, prevItems)`（Task 4 useMarketData 消费）。
- 验证范围: `node --test tests/client-market-state.test.mjs`（client 族从 `../src/` 直跑，无需 build）。

- [ ] Step 1: 写失败测试（追加到 `tests/client-market-state.test.mjs`）：

```js
describe('mergeLatestFields（0.9.45 两段加载：会话内徽标不回退）', () => {
  const full = { id: 'a', latestVersion: '2.0.0', outdated: true }
  it('next 缺 latest 族而 prev 有 → 按 id 叠加', () => {
    const out = mergeLatestFields([{ id: 'a', name: 'A' }], [full])
    assert.equal(out[0].latestVersion, '2.0.0')
    assert.equal(out[0].outdated, true)
  })
  it('next 已有值的一律不覆盖（探测结果权威）', () => {
    const out = mergeLatestFields([{ id: 'a', latestVersion: '3.0.0' }], [full])
    assert.equal(out[0].latestVersion, '3.0.0')
  })
  it('latestError 族字段参与叠加；prev 无值不产出键', () => {
    const out = mergeLatestFields([{ id: 'b' }], [{ id: 'b', latestError: '超时', latestErrorCode: 'timeout' }])
    assert.equal(out[0].latestError, '超时')
    assert.equal(out[0].latestErrorCode, 'timeout')
    assert.equal('latestVersion' in out[0], false)
  })
  it('无可叠加 → 返回原引用；非数组/空 prev 入参原样返回', () => {
    const next = [{ id: 'a', latestVersion: '1.0.0' }]
    assert.equal(mergeLatestFields(next, [full]), next)
    assert.equal(mergeLatestFields(null, [full]), null)
    const next2 = [{ id: 'x' }]
    assert.equal(mergeLatestFields(next2, []), next2, '空 prev 直接返回 next 引用')
  })
  it('不可变：不改动入参对象', () => {
    const nextItem = { id: 'a' }
    mergeLatestFields([nextItem], [full])
    assert.equal(nextItem.latestVersion, undefined)
  })
})
```

- Run: `node --test tests/client-market-state.test.mjs`
- Expected: 红（函数不存在，import 报错/断言失败）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现（market-state.js 末尾追加）：

```js
const LATEST_MERGE_FIELDS = ['latestVersion', 'latestTag', 'latestSha', 'latestError', 'latestErrorCode', 'outdated']

/**
 * 会话内徽标不回退（0.9.45 市场页两段加载，ADR-0013）：prev = 会话内上一轮响应（上一筛选态 /
 * 已 merge 的第二段结果；快照不含 latest 族字段，重启场景天然无徽标可保）。next 响应缺 latest
 * 族字段而 prev 有 → 按 id 叠加。next 已有值一律不覆盖（探测结果权威）；latestError 族参与叠加
 * （失败态也是状态）。返回新数组（不可变）；无可叠加项时原样返回 nextItems（引用相等，调用方可省一次 setState）。
 */
export function mergeLatestFields(nextItems, prevItems) {
  if (!Array.isArray(nextItems) || !Array.isArray(prevItems) || prevItems.length === 0) return nextItems
  const prevById = new Map(prevItems.map((it) => [it && it.id, it]))
  let touched = false
  const out = nextItems.map((it) => {
    if (!it || typeof it !== 'object') return it
    const hasLatest = it.latestVersion !== undefined || it.latestTag !== undefined || it.latestSha !== undefined || it.latestError !== undefined
    if (hasLatest) return it
    const prev = prevById.get(it.id)
    if (!prev) return it
    const patch = {}
    for (const k of LATEST_MERGE_FIELDS) {
      if (it[k] === undefined && prev[k] !== undefined) patch[k] = prev[k]
    }
    if (Object.keys(patch).length === 0) return it
    touched = true
    return { ...it, ...patch }
  })
  return touched ? out : nextItems
}
```

- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-market-state.test.mjs`
  - Expected: 全绿。
- [ ] Step 5: checkpoint commit（可选）。

### Task 4: useMarketData 两段接线 + 快照时机 + 设置页强刷接线

- 目标：GUI 市场请求改两段——浏览态（mount/updateQuery）第一段 cache-only，`latestComplete===false` 时自动第二段 `full`；`reload`（mutation 后）直发 `full`（force 由 params 传递）；快照只在终态写；**设置页「强制刷新」接通市场区 force 重取（R4，P2 落地最后一环）**。
- Files:
  - Modify: `src/client/main.jsx` — useMarketData（L572-642）；require 解构区加 `mergeLatestFields`；SettingsTab.refresh（L1973-1986）与签名；SettingsTab 挂载处（含 onRegistryChanged prop 的位置）传 `onForceMarket`；MarketPanel 的 marketReloadAll 消费。
- 接口契约:
  - Consumes: Task 1 `probeMode` 两态（经 Task 2）、Task 3 `mergeLatestFields`、`isDefaultFirstPageQuery/writeMarketSnapshot`、`normalizeMarketResponse`。
  - Produces: 两段行为；SettingsTab 新 prop `onForceMarket`。
- 验证范围: `npm test`（pretest 构建）下 `node --test tests/client-render-smoke.test.mjs`——新增源码正则断言 + 既有 SSR 用例全绿。

- [ ] Step 1: 写失败断言（追加到 render-smoke describe）：

```js
  it('市场页两段加载接线（0.9.45 ADR-0013，R2 修正断言形态）', () => {
    assert.match(src, /probeMode = "cache-only"/, '第一段默认 cache-only（默认参数形态）')
    assert.match(src, /latestComplete === false/, '以 latestComplete 缺口判定发起第二段')
    assert.match(src, /return fetchPage\(nextQuery, force, true, "full"\)/, '第二段 background 换新（force 走入参，core peek 重探）')
    assert.match(src, /mergeLatestFields\(/, '徽标不回退 merge 接线')
  })

  it('P2 接线：设置页强刷 → 市场区 force 重取（R4）', () => {
    assert.match(src, /onForceMarket/, 'SettingsTab 新增强刷回调 prop')
    assert.match(src, /marketReloadAll\(true\)/, '强刷回调以 force 重取两区')
    assert.match(src, /refresh = async \(\) => \{[\s\S]{0,600}onForceMarket\?\.\(\)/, 'refresh 成功路径触发市场强取')
  })
```

- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 新断言红（src 无 probeMode/onForceMarket 接线）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现：

① require 解构区（main.jsx L25 的 `./operations.js` 解构与 market-state.js require 处）把 `mergeLatestFields` 加入解构清单。

② `fetchPage`（L589-625）替换为：

```js
  const fetchPage = useCallback((nextQuery, force, background = false, probeMode = "cache-only") => {
    const gen = ++genRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (!background || !dataRef.current) {
      setLoading(true);
      setError(null);
    }
    const params = {
      query: nextQuery.query || undefined,
      category: nextQuery.category || undefined,
      source: searchSourceOf(nextQuery),
      ...(nextQuery.sort ? { sort: nextQuery.sort } : {}),
      offset: nextQuery.offset,
      limit: nextQuery.limit,
      // 0.9.45 两段加载（ADR-0013）：第一段 cache-only 零网络回页；'full' 为终态语义不下传（core 缺省等价）
      ...(probeMode !== "full" ? { probeMode } : {}),
      ...(force ? { force: true } : {}),
    };
    return api("market", params, ac.signal)
      .then((raw) => {
        if (genRef.current !== gen || ac.signal.aborted) return;
        const next = normalizeMarketResponse(raw);
        // 会话内徽标不回退：上一轮响应有 latest 族值而本响应缺 → 按 id 叠加（快照不含 latest 族字段）
        const prevItems = dataRef.current && Array.isArray(dataRef.current.items) ? dataRef.current.items : null;
        const mergedItems = mergeLatestFields(next.items, prevItems);
        const merged = mergedItems === next.items ? next : { ...next, items: mergedItems };
        dataRef.current = merged;
        setData(merged);
        setLoading(false);
        // 第二段：仅 cache-only 首段有缺口时发起（'full' 恒为终态——防 latestTimedOut 死循环）；
        // force 由 params 传递 → core peek 旧值兜底 + 全页重探（P2）
        if (probeMode === "cache-only" && next.latestComplete === false) {
          return fetchPage(nextQuery, force, true, "full");
        }
        // 快照只在终态写（第一段无缺口，或第二段 merge 完成）——首段缺口 intermediate 态不写，防快照质量降级
        if (isDefaultFirstPageQuery(nextQuery, zone)) writeMarketSnapshot(storage(), { zone, response: merged });
      })
      .catch((e) => {
        if (genRef.current !== gen || ac.signal.aborted) return;
        if (background && dataRef.current) return;   // 第二段失败静默保留（Q11②）
        setError(String((e && e.message) || e));
        setLoading(false);
      });
  }, []);
```

③ `reload`（L634）替换为（mutation 后/显式刷新直发终态语义；force 走 params → core peek 重探）：

```js
  const reload = useCallback((force) => fetchPage(queryRef.current, force, false, "full"), [fetchPage]);
```

mount/updateQuery 调用点不变（缺省 probeMode='cache-only' 即两段第一段）。

④ SettingsTab 强刷接线（R4）：SettingsTab 组件签名（含 `onRegistryChanged` 的参数表）追加 `onForceMarket`；`refresh`（L1973-1986）在 `await reloadRegistryState().catch(...)` 之后、`notify(...)` 之前追加一行：

```js
      onForceMarket?.(); // 0.9.45 P2：强刷穿透探测缓存——市场两区以 force 重取（core peek 旧值兜底 + 全页重探）
```

MarketPanel 的 SettingsTab 挂载处（传 onRegistryChanged 的位置）追加 prop `onForceMarket={() => marketReloadAll(true)}`。
- [ ] Step 4: 运行并确认通过
  - Run: `npm test`
  - Expected: 全量测试绿（Windows 本机允许既有 symlink 族基线失败，见「最终验证」），新 smoke 断言通过。
- [ ] Step 5: checkpoint commit（可选）。

### Task 5: 详情 Modal「升级」主按钮（U10a，R1/R10 修订）

- 目标：`installed && outdated` 的条目 Modal 动作区给「升级」主按钮（走 ops 泵 + 生效判定分流文案）；**record.target = 安装包名**（upgrade record 的 target 语义是包名——operations.js opAppliesTo 以 `x.pkg === rec.target` 判定前提，收录 id ≠ 包名会让泵误判 superseded）；错误分支对齐已装页三分支（guard/opSuperseded/普通失败）+ builds 后缀。
- Files:
  - Modify: `src/client/main.jsx` — MarketTab（新增 `activeUpgradeRec`/`doUpgrade`，L1225 附近与 L1309 附近）；DetailModal 签名与 actions 区（L1036、L1175-1181）；两个 Modal 挂载接线（市场区 L1662-1673、收藏区 L1424-1433）。
- 接口契约:
  - Consumes: `ops.runOp/ops.records`、`upgradeNotify`（main.jsx L25 已从 `./operations.js` 解构，无需新导入）、`lookup("notify.upgraded"/"notify.builds"/"notify.builds.fallback"/"action.upgrade"/"manage.hint"/"guard.*"/"failed.upgrade")`、`api("upgrade",{pkg})`（已装页 doUpgrade 同款，L1789-1822 范式）、MarketItem 的 `installedPkg/installedVersion/outdated`。
  - Produces: `DetailModal` 新 props `onUpgrade/upgradeBusy/upgradeRec`（Task 6 同文件续改；**市场区与收藏区两个 Modal 挂载点都要接线**）。
- 验证范围: `node --test tests/client-render-smoke.test.mjs` 新增 SSR + 源码断言（__DetailModal 已导出；断言用结构/源码正则，R9 语言无关）。

- [ ] Step 1: 写失败测试（追加到 render-smoke describe）：

```js
  it('详情 Modal：已装且可升级 → 「升级」主按钮；已装未过期 → 仅 manage 提示（0.9.45 U10）', () => {
    const base = { id: 'x', name: 'X', description: 'd', source: 'npm', npm: 'pkg-x', installed: true, installedPkg: 'pkg-x', installedVersion: '1.0.0', category: 'tools', tags: [] }
    const up = renderToString(h(components.__DetailModal, { it: { ...base, outdated: true }, labels: {}, busy: false, onClose: () => {}, onInstall: () => {}, onUpgrade: () => {}, upgradeBusy: false, profileKind: 'web' }))
    assert.match(up, /dsvm-modalactions[\s\S]*?dshm-btn primary/, 'outdated → 动作区主按钮在（语言无关）')
    const ok = renderToString(h(components.__DetailModal, { it: base, labels: {}, busy: false, onClose: () => {}, onInstall: () => {}, onUpgrade: () => {}, upgradeBusy: false, profileKind: 'web' }))
    assert.doesNotMatch(ok, /dsvm-modalactions[\s\S]*?dshm-btn primary/, '非 outdated → 动作区无主按钮')
    assert.match(src, /ops\.runOp\("upgrade", it\.installedPkg/, 'record.target = 安装包名（R1：upgrade record 语义是 pkg）')
    assert.match(src, /activeUpgradeRec\.target === detailItem\.installedPkg/, '进度行比对走 installedPkg（R1）')
  })
```

- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 红（当前 actions 区 installed 分支只有 manage.hint；无 runOp upgrade 接线）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现：

① MarketTab（L1225 `activeInstallRec` 旁）追加：

```js
  const activeUpgradeRec = ops.records.find((r) => r.kind === "upgrade" && (r.status === "running" || r.status === "queued" || r.status === "input")) || null;
```

② MarketTab `doInstall`（L1309）之后追加（三分支 + builds 后缀对齐已装页 L1793-1821 范式）：

```js
  const doUpgrade = async (it) => {
    try {
      // R1：upgrade record 的 target 语义是包名（opAppliesTo 以 x.pkg === rec.target 判定前提）——
      // 收录 id ≠ 包名（如 dsh-skins → @iasiv5/dsh-skins），传 id 会被泵误判 superseded
      const res = await ops.runOp("upgrade", it.installedPkg, () => api("upgrade", { pkg: it.installedPkg }));
      const note = upgradeNotify(res.activation); // 0.9.22 生效判定三态分流（client-only 不弹重启横幅）
      const text = lookup("notify.upgraded", { pkg: res.pkg, from: res.fromVersion ? `v${res.fromVersion}` : "—", to: res.version ? `v${res.version}` : res.sha ? res.sha.slice(0, 7) : "latest" })
        + (res.buildApprovals && res.buildApprovals.length ? lookup("notify.builds", { names: res.buildApprovals.join(", ") }) : res.fallbackAllBuilds ? lookup("notify.builds.fallback") : "")
        + (note.suffixKey ? lookup(note.suffixKey) : "");
      notify({ kind: "ok", needsRestart: note.needsRestart, text });
      setInstallNote({ id: it.id, kind: "ok", text });
      await (onMutation ? onMutation() : undefined);
    } catch (e) {
      if (e && e.opSuperseded) {
        const sup = lookup("op.superseded.note", { target: it.installedPkg });
        notify({ kind: "ok", text: sup });
        setInstallNote({ id: it.id, kind: "hint", text: sup });
      } else if (e && e.guard) {
        const guardText = [
          lookup("guard.blocked"),
          `${lookup("guard.compstatus")}: ${e.guard.compensation?.status || "—"}（${e.guard.compensation?.note || ""}）`,
          e.guard.repairBasis ? `${lookup("guard.repairbasis")}: ${e.guard.repairBasis}` : null,
          lookup("guard.noforce"),
          e.guard.restartSafe ? lookup("guard.restartsafenow") : lookup("guard.restartunsafe"),
        ].filter(Boolean).join(" | ");
        notify({ kind: "err", text: guardText });
        setInstallNote({ id: it.id, kind: "err", text: guardText });
      } else {
        const failText = lookup("failed.upgrade", { err: (e && e.message) || e });
        notify({ kind: "err", text: failText });
        setInstallNote({ id: it.id, kind: "err", text: failText });
      }
    }
  };
```

③ DetailModal 签名（L1036）追加 `onUpgrade, upgradeBusy, upgradeRec`；actions 区（L1175-1181）替换为：

```js
      h(
        "div",
        { className: "dsvm-modalactions" },
        it.installed
          ? h(
              React.Fragment,
              null,
              it.outdated
                ? h("button", { className: "dshm-btn primary", disabled: upgradeBusy, onClick: () => onUpgrade(it) }, upgradeBusy ? h(Spin) : lookup("action.upgrade"))
                : null,
              h("span", { className: "dshm-hint" }, lookup("manage.hint")),
            )
          : h("button", { className: "dshm-btn primary", disabled: busy, onClick: () => onInstall(it) }, busy ? h(Spin) : lookup("action.install")),
      ),
```

④ 进度行条件（L1166）`installRec && (…)` 改为同时接受 upgradeRec（`(installRec || upgradeRec) && (…).status === "running" || …` 等价改写）。

⑤ 市场区 Modal 挂载（L1662-1673）追加 props：

```js
          onUpgrade: (it2) => doUpgrade(it2),
          upgradeBusy: activeUpgradeRec != null,
          upgradeRec: activeUpgradeRec && activeUpgradeRec.target === detailItem.installedPkg ? activeUpgradeRec : null,
```

⑥ 收藏区 Modal 挂载（L1424-1433）追加同款三 props（`detailItem` 换 `favDetailItem`，比对同样走 `installedPkg`）——同一组件两个挂载点行为一致。
- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-render-smoke.test.mjs`
  - Expected: 全绿。
- [ ] Step 5: checkpoint commit（可选）。

### Task 6: Modal README 折叠页 + 收录日期本地化（U10b）

- 目标：精选/社区条目 Modal 在全文描述后补 README 折叠页（展开才拉取）；`modal.added` 走 `fmtDate`。
- Files:
  - Modify: `src/client/main.jsx` — DetailModal（L1113 added kv；L1130 desc 之后插入 fold）。
- 接口契约:
  - Consumes: `ReadmeBlock({ pkg })`（L1713-1733，已有）、`readme.show` i18n 键（已有）、`fmtDate`（L551-555，已有）。
  - Produces: 无。
- 验证范围: `node --test tests/client-render-smoke.test.mjs` SSR 断言（结构/语言无关标记，R9）。

- [ ] Step 1: 写失败断言（追加到 render-smoke）：

```js
  it('详情 Modal：README 折叠页（npm 条目）与收录日期 fmtDate（0.9.45 U10b）', () => {
    const it = { id: 'r', name: 'R', description: 'd', source: 'npm', npm: 'pkg-r', category: 'tools', tags: [], added: '2026-09-28T00:00:00.000Z' }
    const html = renderToString(h(components.__DetailModal, { it, labels: {}, busy: false, onClose: () => {}, onInstall: () => {}, profileKind: 'web' }))
    assert.ok(html.includes('dsvm-fold'), 'README 折叠容器在')
    assert.ok(html.includes('📖 README'), '折叠摘要用既有 readme.show 文案（emoji 语言无关）')
    assert.ok(!html.includes('2026-09-28T00:00:00.000Z'), '收录日期不再裸 ISO（语言无关）')
    assert.match(src, /kv\(lookup\("modal\.added"\), fmtDate\(it\.added\)\)/, 'added 走 fmtDate（R9 源码断言替代文案断言）')
  })
```

- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 红（当前无 README fold、added 裸 ISO）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现：

① DetailModal 组件体内（L1039 旁）追加 `const [rmOpen, setRmOpen] = useState(false);`

② L1113 改为 `it.added ? kv(lookup("modal.added"), fmtDate(it.added)) : null,`

③ L1130（descFull 行）之后、screenshots 之前插入：

```js
      it.npm
        ? h(
            "details",
            { className: "dsvm-fold", onToggle: (e) => { if (e.target.open) setRmOpen(true); } },
            h("summary", null, lookup("readme.show")),
            rmOpen ? h(ReadmeBlock, { pkg: it.npm }) : h("div", { className: "dshm-hint" }, lookup("readme.loading")),
          )
        : null,
```

（展开才拉取 README——收起态零请求；`readme.loading` 仅在展开瞬间可见。）
- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-render-smoke.test.mjs`
  - Expected: 全绿。
- [ ] Step 5: checkpoint commit（可选）。

### Task 7: 错误重试 + 空态三分支 + i18n 新键（U9）

- 目标：错误行内联「重试」；空态按 unavailable/分类空桶/通用三分支取文案。
- Files:
  - Modify: `src/client/main.jsx` — MarketTab 渲染分支（L1618-1623，收藏区 L1416 已早退、本分支仅市场区可达，`query` 恒有值）；ZH 字典（L50 附近）与 EN 字典（L159 附近）各加 3 键。
- 接口契约:
  - Consumes: `reload`（Task 4 改造后签名不变）、`data.registryState.status`、既有键 `failed.load`。
  - Produces: i18n 键 `market.retry` / `market.empty.category` / `market.empty.unavailable`（Task 11 CHANGELOG 引用）。
- 验证范围: `node --test tests/client-render-smoke.test.mjs` 源码断言（三分支键齐全 + ZH/EN 成对）。

- [ ] Step 1: 写失败断言（追加到 render-smoke）：

```js
  it('U9：错误重试按钮 + 空态三分支键（ZH/EN 成对）', () => {
    assert.match(src, /lookup\("failed\.load", \{ err: error \}\)[\s\S]{0,120}lookup\("market\.retry"\)/, '错误行内联重试')
    assert.match(src, /market\.empty\.unavailable/, 'unavailable 主文案分支')
    assert.match(src, /market\.empty\.category/, '分类空桶文案分支')
    for (const k of ['market.retry', 'market.empty.category', 'market.empty.unavailable']) {
      assert.ok(new RegExp(`"${k}":`).test(src), `键 ${k} 存在`)
      assert.equal(src.split(`"${k}":`).length - 1, 2, `键 ${k} ZH/EN 各一次`)
    }
  })
```

- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 红。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现：

① i18n（ZH L50 行内追加；EN L159 对应行追加）：

```js
  "market.retry": "重试", "market.empty.category": "该分类暂无收录，换个桶或清空筛选看看", "market.empty.unavailable": "收录清单不可用，暂时无法列出插件",
```

```js
  "market.retry": "Retry", "market.empty.category": "Nothing curated in this category yet — try another bucket or clear the filter", "market.empty.unavailable": "Registry unavailable — listings are temporarily down",
```

② 渲染分支（L1618-1623）替换为：

```js
    loading && !data
      ? h("div", { className: "dshm-empty" }, lookup("market.loading"), Spin())
      : error
        ? h(
            "div",
            { className: "dshm-err" },
            lookup("failed.load", { err: error }), " ",
            h("button", { className: "dshm-btn sm", onClick: () => reload(false) }, lookup("market.retry")),
          )
        : items.length === 0
          ? h(
              "div",
              { className: "dshm-empty" },
              lookup(
                data && data.registryState.status === "unavailable" && !query.query && !query.category
                  ? "market.empty.unavailable"
                  : query.category
                    ? "market.empty.category"
                    : "market.empty",
              ),
            )
          : h( /* …既有卡片/分页 Fragment 原样… */
```

- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-render-smoke.test.mjs`
  - Expected: 全绿。
- [ ] Step 5: checkpoint commit（可选）。

### Task 8: 收藏快照身份字段 + 收藏区徽标（U12，R7 收窄）

- 目标：`snapshotOf` 增 `verified/audience/decoupled` 三标量（只存不标）；收藏区补「精选」身份徽标 +「已实测」质量徽标；**受众/解耦徽标不进收藏区**（DESIGN §2.7 裁决⑤「已装视图与收藏页不打标」不动摇——快照存字段仅为未来详情层消费，不在推荐发现链路打标）。
- Files:
  - Modify: `src/client/main.jsx` — snapshotOf（L2245 字段数组）、FavoriteZone badges（L2308-2313）。
  - Modify: `src/client/favorites.js` — L14-17 typedef 注释同步三字段名（一行）。
- 接口契约:
  - Consumes: 既有键 `badge.verified/badge.community/zone.primary`、`favorites.js` store（不动行为）。
  - Produces: 快照新字段（向后兼容：旧快照字段缺席 → 徽标自然隐藏）。
- 验证范围: `node --test tests/client-render-smoke.test.mjs` SSR 断言（__FavoriteZone 已导出；title 属性与双语兜底，R9）。

- [ ] Step 1: 写失败断言（追加到 render-smoke）：

```js
  it('U12：精选条目收藏卡恢复身份（精选徽标）与质量徽标（已实测）；受众/解耦不打标（§2.7 裁决⑤，R7）', () => {
    const favs = { list: [{ id: 'p', snapshot: { id: 'p', name: 'P', description: 'd', source: 'npm', npm: 'pkg-p', verified: ['0.2.0-rc.2'] }, addedAt: 1 }], toggle: () => {}, removeIds: () => {} }
    const html = renderToString(h(components.__FavoriteZone, { favorites: favs, onOpen: () => {} }))
    assert.ok(html.includes('精选') || html.includes('Curated'), '无 owner 快照 → 精选徽标（R9 双语兜底）')
    assert.ok(html.includes('title="0.2.0-rc.2"'), 'verified 徽标经 title 属性呈现（语言无关）')
    assert.ok(html.includes('已实测') || html.includes('Verified'), 'verified 徽标文案（R9 双语兜底）')
    assert.ok(!html.includes('作者自用') && !html.includes("Author's own"), '收藏区不打受众标（R7）')
    assert.ok(!html.includes('版本无关') && !html.includes('Version-independent'), '收藏区不打解耦标（R7）')
  })
```

- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 红（收藏区当前无「精选」与「已实测」徽标）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现：

① snapshotOf（L2245）字段数组追加三项：

```js
  for (const k of ["descriptionEn", "npm", "github", "homepage", "owner", "downloads", "stars", "added", "deprecated", "verified", "audience", "decoupled"]) {
```

（`src/client/favorites.js` L14-17 的 typedef 注释同步补三字段名。）

② FavoriteZone badges（L2308-2313）替换为（**不含** internal/decoupled——§2.7 裁决⑤）：

```js
          badges: [
            s.deprecated === true ? h("span", { className: "dshm-badge warn", key: "dep" }, lookup("badge.deprecated")) : null,
            s.owner
              ? h("span", { className: "dshm-badge info", key: "c" }, lookup("badge.community"))
              : h("span", { className: "dshm-badge", key: "cz" }, lookup("zone.primary")),
            Array.isArray(s.verified) && s.verified.length && s.community !== true ? h("span", { className: "dshm-badge", key: "v", title: s.verified.join("、") }, lookup("badge.verified")) : null,
            h("span", { className: "dshm-badge info", key: "s" }, s.source === "npm" ? "npm" : "github"),
            isStale ? h("span", { className: "dshm-badge warn", key: "st" }, lookup("favorites.stalebadge")) : null,
          ],
```

- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-render-smoke.test.mjs`
  - Expected: 全绿（`tests/client-favorites.test.mjs` 既有用例不回归——store 层未动）。
- [ ] Step 5: checkpoint commit（可选）。

### Task 9: Modal 可达性子集 + 灯箱键盘（U8）

- 目标：Modal 容器 role/aria + 打开时聚焦关闭钮；Shot 补 Enter/Space。**不做** Tab 圈闭与焦点还原（grill Q5 边界）。
- Files:
  - Modify: `src/client/main.jsx` — DetailModal（modalbox L1083、关闭钮 L1097、新增 focus effect）；Shot（L990-997）。
- 接口契约:
  - Consumes: `useRef`（已导入 L8）。
  - Produces: 无。
- 验证范围: `node --test tests/client-render-smoke.test.mjs` SSR + 源码断言。

- [ ] Step 1: 写失败断言（追加到 render-smoke）：

```js
  it('U8：Modal role=dialog/aria-modal/初始聚焦 + Shot 键盘（子集，无焦点圈闭）', () => {
    const html = renderToString(h(components.__DetailModal, { it: { id: 'a', name: 'A', description: 'd', source: 'npm', npm: 'p', category: 'tools', tags: [] }, labels: {}, busy: false, onClose: () => {}, onInstall: () => {}, profileKind: 'web' }))
    assert.ok(html.includes('role="dialog"'), 'role=dialog')
    assert.ok(html.includes('aria-modal="true"'), 'aria-modal')
    assert.match(src, /role: "dialog"/, '容器接线')
    assert.match(src, /closeRef\.current\.focus\(\)/, '初始聚焦关闭钮')
    assert.match(src, /role: "button", tabIndex: 0[\s\S]{0,400}onKeyDown: \(e\) => \{\s*if \(\(e\.key === "Enter" \|\| e\.key === " "\)/, 'Shot Enter/Space（含既有 role/tabIndex 锚段）')
    assert.doesNotMatch(src, /focus-trap|focusTrap/, '不做焦点圈闭（Q5 边界）')
  })
```

- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 红。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现：

① DetailModal 内追加 `const closeRef = useRef(null);` 与

```js
  useEffect(() => {
    if (closeRef.current) closeRef.current.focus();
  }, []);
```

② modalbox（L1083）props 追加 `role: "dialog", "aria-modal": "true", "aria-label": it.name,`

③ 关闭钮（L1097）追加 `ref: closeRef,`

④ Shot（L990-997）props 追加：

```js
    onKeyDown: (e) => {
      if ((e.key === "Enter" || e.key === " ") && !e.isComposing) {
        e.preventDefault();
        onClick();
      }
    },
```

- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-render-smoke.test.mjs`
  - Expected: 全绿。
- [ ] Step 5: checkpoint commit（可选）。

### Task 10: chips 0 计数显式 + 跨桶说明（U3/U7）

- 目标：0 计数桶显式渲染「0」+ `.zero` 降透明；primary 区 Σchips>registryState.count 时 chips 行容器挂 title 说明。
- Files:
  - Modify: `src/client/main.jsx` — ZoneChips（btn L932-937、chips 容器 L945-947、签名加 `wrapTitle`）；MarketTab ZoneChips 挂载（L1605-1612 传 `wrapTitle`）；ZH/EN 字典加 `chips.crossbucket.tip`；CSS（`.dshm-chip` 规则附近加 `.dshm-chip.zero`）。
- 接口契约:
  - Consumes: `counts`（categoryCounts，alsoCategories 双计）、`data.registryState.count`。
  - Produces: i18n 键 `chips.crossbucket.tip`。
- 验证范围: `node --test tests/client-render-smoke.test.mjs` SSR 断言（__ZoneChips 已导出；class/CSS/键存在性均语言无关）。

- [ ] Step 1: 写失败断言（追加到 render-smoke）：

```js
  it('U3/U7：0 计数桶显式 0 + zero 样式 + 跨桶 title 说明', () => {
    const html = renderToString(h(components.__ZoneChips, { zone: 'primary', counts: { essentials: 4, 'cui-picks': 0, 'self-dev': 8, 'tencent-lighthouse': 3, watchlist: 3 }, labels: null, active: null, onPick: () => {} }))
    assert.ok(html.includes('zero'), '0 计数桶带 zero 类')
    assert.match(src, /\.dshm-chip\.zero\{opacity/, 'zero 降透明 CSS 在')
    assert.match(src, /chips\.crossbucket\.tip/, '跨桶说明键存在')
  })
```

- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 红。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 写最小实现：

① ZoneChips 签名加 `wrapTitle`；chips 容器（L947）加 `title: wrapTitle || undefined`；btn（L932-937）替换为：

```js
  const btn = (c) =>
    h(
      "button",
      { key: c.id, "data-chip": "1", className: `dshm-chip${active === c.id ? " on" : ""}${c.count === 0 ? " zero" : ""}`, onClick: () => onPick(active === c.id ? null : c.id) },
      `${c.labelKey ? lookup(c.labelKey) : c.label} ${c.count || 0}`,
    );
```

（社区区 chip 计数恒 >0（market-state.js L246/254 已滤 0），行为不受影响；「全部」chip 无计数不适用。）

② MarketTab 挂载（L1605-1612）追加 prop：

```js
          wrapTitle:
            zone === "primary" && data
              ? Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0) > ((data.registryState && data.registryState.count) || 0)
                ? lookup("chips.crossbucket.tip")
                : undefined
              : undefined,
```

③ i18n：ZH `"chips.crossbucket.tip": "跨桶条目会在多个分类重复计数，故分类计数之和大于总数"`；EN `"chips.crossbucket.tip": "Cross-bucket entries count in every bucket, so chip counts add up above the total"`。

④ CSS：`.dshm-chip` 规则后追加 `.dshm-chip.zero{opacity:.55}`。
- [ ] Step 4: 运行并确认通过
  - Run: `node --test tests/client-render-smoke.test.mjs`
  - Expected: 全绿。
- [ ] Step 5: checkpoint commit（可选）。

### Task 11: 文档与版本收口

- 目标：ADR-0013、DESIGN §2.6 修订、GLOSSARY 两术语、CHANGELOG 双语、README 一句、版本号 0.9.45。
- Files:
  - Create: `docs/adr/0013-market-two-phase-probe.md`
  - Modify: `docs/DESIGN.md`（§2.6 末尾）、`GLOSSARY.md`（Language 区）、`CHANGELOG.md`（中文区 L9 与英文区各 prepend）、`README.md`（「界面」表格 Modal 行）、`package.json`（version）
- 接口契约:
  - Consumes: Task 1-10 的全部落地事实。
  - Produces: 0.9.45 发版物料。
- 验证范围: `npm run typecheck` 零错误 + `node --test tests/registry.test.mjs`（registry 未动，守护性确认）+ 人工核对 CHANGELOG 双语条目成对。

- [ ] Step 1: 写 ADR-0013（内容骨架，正文按 ADR-0004/0006 文风展开）：

```markdown
# 市场页两段加载与 force 探测穿透（0.9.45，ADR-0013）

背景：ADR-0006 将 latest 探测缓存定为纯内存（「重启即失效」是特性），代价是重启后首开
当前页全部重探 inline 阻塞响应（正常网络 0.6–1.5s，弱网实测 8–16s——0.9.32 记载的网络现实）；
ADR-0008 已在已装页确立两段加载范式（probeMode full/none/only）。本 ADR 把两段范式扩展到
市场页，并按 ADR-0006 在案的实现约束重开其暂缓的「force 穿透探测缓存」裁决。

## Considered Options

- **服务端 latest SWR**（TTL 过期回旧值 + 后台单飞）：修不了重启冷路径（缓存为空无 stale 可回），
  且引入「旧值冒充最新」的呈现风险——0.9.20 事故的同类形态，被否。
- **维持现状**：快照已让页面秒开，但徽标滞后在弱网首开可感（8–16s），且随条目增长线性恶化，被否。
- **市场页两段加载（采纳）**：第一段 probeMode:'cache-only' 零网络回页（缺口 → latestComplete=false，
  缺口判定豁免社区 github 条目——Q46 永久缺口不构成第二段理由），第二段既有 'full' 语义就地补全；
  服务端缓存制度零改动。

## force 语义（重开 ADR-0006 暂缓裁决）

- **采纳「peek 不删除 + 全页重探」**：force 时以 peekLatestCache 取旧值兜底展示（不判 TTL、不删除），
  全页重探成功覆盖缓存、失败保留旧值 + latestError——严格落实 ADR-0006 在案约束「实现须用 peek
  不删除语义，而非 ttlMin=0 先删后探（失败时旧值丢失）」，重探失败不产生空徽标窗口。
- **不引入市场页 'only' 模式**：已装页 'only'（ttlMin=0 先删后探）是「打开即见新鲜」语义，与 force 的
  「旧值兜底重探」不同质；把 ADR-0006 明示拒绝的先删后探带进浏览页无正当性。
- 接线：设置页「强制刷新」→ onForceMarket → marketReloadAll(true) → reload(force) → core peek 重探
  ——ADR-0006 暂缓裁决的盲区（「不重启 + TTL 内」）收敛为零。

## Consequences

- latestComplete 语义扩展：cache-only 有缺口时为 false（此前仅探测超时为 false）；消费方只有 GUI 客户端。
- 服务端**永不回 stale**：TTL 过期 = 缺口 → 第二段补全。research §6.1 P1 的「stale 值渲染为显式检查中」
  通过条件，被 grill 再裁决（Q10）替代为「第一段安静、不占位」——旧值只在会话内经 mergeLatestFields
  保留到第二段完成；第二段失败静默保留（Q11②）为有意接受，不冒充最新。
- mergeLatestFields 的动机口径：会话内上一轮响应 → cache-only 首段（快照不含 latest 族字段，重启场景
  天然无徽标可保）；不做「快照存 latest」扩展（超出本批）。
- 浏览态每次筛选变化最多 +1 次请求（第一段零网络、第二段即既有探测成本；纯 github 社区页无第二段）。
- 快照写入后移到终态（第二段 merge 完成或第一段无缺口），intermediate 态不入快照。
- tools/CLI 的 withLatest=false 通路与三端搜索契约零变化；probeMode 缺省 'full' 时 core 行为与 0.9.44 等价。
- U12 边界：收藏快照存 verified/audience/decoupled 三字段但收藏区**不打**受众/解耦标（DESIGN §2.7
  裁决⑤不动）；「精选」「已实测」徽标为身份/质量呈现，不在裁决射程内。
```

- [ ] Step 2: DESIGN.md §2.6 末尾追加修订段（对齐既有「修订（…，0.9.x）」格式），内容：两段加载（ADR-0013）、Modal 升级按钮与 README fold、错误重试与空态三分支、收藏身份徽标（受众/解耦不打标边界重申）、0 计数桶显式化。
- [ ] Step 3: GLOSSARY.md Language 区处理两术语（沿用 `**术语**:…/ _Avoid_:…` 格式）：**探测三态之外的现状描述不用**——本批落地为两态 probeMode（full/cache-only），术语定名「**探测模式（Probe Mode）**」与「**市场两段加载（Market Two-phase Load）**」；先 `Select-String -Path GLOSSARY.md -Pattern "两段"` 核实既有「两段加载」条目（评审确认已存在）——在其处增补市场页扩展交叉引用，Probe Mode 新增条目时写明已装页 full/none/only 与市场页 full/cache-only 的差异及 ADR 出处。
- [ ] Step 4: CHANGELOG.md 中文区与英文区各 prepend 0.9.45 条目（标题建议「0.9.45 变更：市场页两段加载 + 强制刷新穿透探测 + 精选页动线批」），bullet 覆盖：两段加载/force peek 重开（ADR-0013）/设置页强刷接线/Modal 升级按钮 + README/错误重试 + 空态三分支/收藏身份（受众不打标边界）/0 计数桶/可达性子集/测试增量。
- [ ] Step 5: package.json `version` → `0.9.45`；README「界面」表格「市场」行句尾追加「详情 Modal 支持一键升级与 README 预览」。
- [ ] Step 6: 验证
  - Run: `npm run typecheck && node --test tests/registry.test.mjs`
  - Expected: typecheck 零错误；registry 守护用例全绿。

### Task 12: 最终验证收口

- 目标：全量回归 + 基线核对。
- Files: 无新改动（只验证）。
- 接口契约:
  - Consumes: Task 1-11 全部完成。
  - Produces: 可发版状态（发版动作见附录，不在本计划内执行）。
- 验证范围: 全量测试 + typecheck + 手工验收清单。

- [ ] Step 1: Run: `npm test`
  - Expected: 除 **Windows 平台既有 symlink 语义基线失败**（0.9.33 记载的 15 项集合，逐项与基线一致）外全部通过，**零新增失败**；Linux 环境应全绿。
- [ ] Step 2: Run: `npm run typecheck`
  - Expected: 零错误。
- [ ] Step 3: 手工验收清单（实机，重启 DSH 后刷新）：
  1. 重启 DSH 后首开市场：列表瞬时（快照/首段），徽标 1–4s 内就地补全，无整页 spinner；
  2. 设置页「强制刷新」→ toast 后回到市场：精选清单与「有更新」徽标同时刷新（P2 全链路）；
  3. 精选页点开已装且可升级条目 → 「升级」按钮可见可用，升级后 0.9.22 分流文案正确；升级 record 以包名入泵（装卸期间操作面板可见包名目标）；
  4. Modal 展开 README 折叠页有内容；收录日期为本地化格式；
  5. 断网（或断 registry）刷新市场 → 错误行带「重试」，点击恢复；
  6. 收藏一个精选条目 → 收藏区显示「精选」「已实测」徽标；收藏一个作者自用条目 → 收藏区**不**出现「作者自用」徽标（§2.7 边界）；
  7. Tab 在 Modal 内落焦点在关闭钮；截图缩放可键盘打开；键盘 Tab 仍可进出 Modal（不做圈闭，属预期）；
  8. 精选区 0 计数桶显示「0」且半透明；chips 行悬停有跨桶说明。

## 执行纪律

- 开始实现前先批判性复查本计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务编号顺序执行（同文件任务严禁并行改段）；不无声跳步、合并步或改变任务目标。
- 每完成一个任务运行该任务定义的验证；红不过夜。
- 遇阻塞、重复失败或计划与仓库现实不符，立即停下说明，不猜。
- 当前若在 `main` 分支，开始实现前先征得主人同意（仓库惯例是 main 上本地提交、发版时才 push）。
- 全部任务完成后运行最终验证并输出修改摘要。

## 最终验证

- `npm test`（Windows 本机允许既有 symlink 族基线失败，逐项核对与 0.9.33 基线集合一致；零新增失败）
- `npm run typecheck` 零错误
- Task 12 手工验收清单逐项过
- 验证环境：Windows + pwsh，`dsh-m/` 目录下执行；命令均为 npm scripts / node --test，无 bash-only 依赖。

## 审阅 Checkpoint

- 计划正文到此结束。请主人审阅；批准前不进入实现。
- 批准后默认执行方：普通编码 agent 或人工，按任务清单顺序消费。

## 附录：发版纪律（不在本计划执行范围内）

- 发版 = 主人逐步确认下的 `npm version patch`（已由本计划 bump 0.9.45 则直接 `git push --tags`）→ OIDC trusted publishing（publish.yml 一字不改）→ registry.json 本计划无改动、无需推送。
- 装机验证按 know-how 018（OIDC staged 发布假绿）/020（desktop minimumReleaseAge）纪律执行。
- 发版后 DSH Web 需重启一次使新 Host 生效（客户端 bundle 变更刷新页面即可）。

## 评审修订记录

- R1（阻断，接受）：Task 5 record.target 改 `installedPkg`（泵 opAppliesTo 语义），进度行比对与 superseded 文案同步；补源码断言钉住。
- R2（阻断，接受）：Task 4 断言改默认参数形态 `/probeMode = "cache-only"/`。
- R3（阻断，接受）：outdated 判定移出模式分支、对所有模式执行；补 cache-only outdated 红转绿用例。
- R4（阻断，接受，已核实现场 L1973-1986/2001/2046）：Task 4 新增 SettingsTab onForceMarket 接线 + 断言；手工清单 2 同步。
- R5（重要，接受）：缺口判定镜像 todo 的社区 github 豁免；补豁免用例。
- R6（重要，接受，采纳方案 (a)）：force 语义改「peekLatestCache 旧值兜底 + 全页重探」；probeMode 收为两态（不设 'only'）；latest-cache.ts 进 Modify 清单；ADR-0013 记录取舍与 ADR-0006 约束落实。
- R7（重要，接受，收窄）：Task 8 移除收藏区 internal/decoupled 徽标（§2.7 裁决⑤），保留字段存储 + 精选/已实测徽标；测试加反向断言。
- R8（重要，接受）：ADR-0013 Consequences 记录「服务端不回 stale；§6.1 检查中条件被 Q10 安静态替代；第二段失败静默 Q11②」。
- R9（重要，接受）：SSR 断言改结构/属性/源码正则优先，确需文案处 ZH/EN 双兜底（EN 值已按字典核实）。
- R10（建议，接受）：doUpgrade 对齐三分支 + builds 后缀。
- R11（建议，接受）：mergeLatestFields 动机改为「会话内上一轮响应」口径（快照无 latest 字段，重启场景 no-op）。
- R12（建议，接受）：目标节声明 U2 排除；favorites.js 补入 Modify 清单。
- R13（重要，接受，第 2 轮复核发现）：Task 1 第 3 例社区 fixture 改镜像既有 ⑥ 用例形态（withCommunity + communityLoaded + communityRaw，catalog 键 plugins、id 适配层派生、github 条目 npm 置 null），杜绝豁免用例空转。
- R14（建议，接受，第 2 轮复核发现）：Task 1 Expected 改「3 例红（第 2/5/6）；第 1/3/4/7 例守护/pin 现状即绿」，避免 executor 误停。
- R15（建议，接受，第 2 轮复核发现）：① 文件清单 GLOSSARY 定名「探测模式（Probe Mode）」；② 收藏区 verified 徽标补 `s.community !== true` 守卫（与市场侧 L1090/L1538 一致）。
- R16（阻断，接受，第 3 轮复核发现）：Task 1 第 3 例解构修正——`withCommunity` 返回 `{ deps, ccalls }`，npm 捕获在 `base.calls.npm`；断言统一走 `base.calls.npm.length`。
