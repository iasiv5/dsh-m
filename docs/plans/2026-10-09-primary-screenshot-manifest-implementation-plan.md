# dsh-m 精选条目作者截图清单按需读取实施计划

## 目标

为所有 Primary Registry 条目（不论所属精选分类）提供详情 Modal 截图条：仅当用户打开详情时，dsh-m 根据当前生效主清单条目的 `github: owner/repo` 读取该仓库根目录的 [screenshots.json](https://github.com/iasiv5/dsh-skins/blob/main/screenshots.json)，将仓库相对路径解析成绝对 GitHub Raw 图片 URL，再交给现有截图图库。

本计划落实 2026-10-09 grilling 共识：

- 图片来源属于 Primary Registry 条目作者仓库，不依赖 Community Catalog，不读取被主清单去重让位的社区条目，也不做 README / npm repository 回退。
- 只改详情 Modal，不向市场卡片加封面或缩略图；社区条目继续使用已发布的 `screenshots` 字段。
- manifest 缺失、损坏、超限、路径不安全或网络失败时返回空列表，截图条隐藏，不显示额外错误/空占位。
- 图片仍经现有 `safeScreenshots` 与 weserv → 原图直连双兜底链；不扩宽白名单、不修改图片加载链。
- manifest URL/解析结果只存在于 Host 进程内存与当前 Detail Modal state；不放入 `MarketItem`、市场首页 localStorage 快照、收藏快照、Agent 工具或 CLI 输出。

## 架构快照

- 新增 Host-side Node Module `src/core/primary-screenshots.ts`，对外向 Host 提供 `loadPrimaryScreenshots(github: string): Promise<string[]>`。内部负责构造固定的 `https://raw.githubusercontent.com/{owner}/{repo}/HEAD/screenshots.json`、有界文本读取、逐跳 host guard、array/path 校验、相对路径解析、内存 TTL cache 与 single-flight。测试通过 `createPrimaryScreenshotReader({ fetchText, now })` 注入内存 fetcher 和时钟，不出网。
- 在 [host-api.ts](../../src/core/host-api.ts) 增加 GUI Host method `primary-screenshots`。它只读取 `id`；即使通用 dispatcher 保留请求体中的额外字段，也忽略客户端提供的 `github`/URL。方法调用 controller 的 active Registry snapshot 查找 Primary Registry 条目，仅将已校验条目的 `github` 传给新 Module。找不到条目或 `github` 缺失时返回 `{ screenshots: [] }`。不调用 `listMarket`、`getCommunitySummary` 或 Community Catalog loader。
- `DetailModal` 对 Community live 条目沿用 `safeScreenshots(it)`；对 Primary 条目在 Modal 打开后调用 `api("primary-screenshots", { id })`，并对返回 URL 再调用现有 `safeScreenshots`。结果只落在 Modal 局部 state；`Shot`、`Lightbox`、`useImgChain` 与市场条目数据结构不变。
- manifest 是顶层 JSON 数组，最多 8 个非空仓库相对路径；顺序就是图库顺序。拒绝绝对路径、协议/网络路径、`.`/`..` 路径段、反斜杠、query/hash 与控制字符。每段编码后解析在同一 owner/repo/HEAD 内。非法 manifest 整体降级为空列表。
- Host 请求最大响应 64 KiB、超时 5 秒；`onRequest` 对初始 URL 与每次重定向都要求 HTTPS 且 host 精确为 `raw.githubusercontent.com`。成功列表缓存 10 分钟，空/失败结果负缓存 1 分钟；同一 repo 的并发请求共享一次读取，单个 Modal 关闭不取消共享读取（最多继续 5 秒并可填充内存缓存）。不写磁盘或 localStorage。

## 全局约束

- Node **≥22**；依赖沿用 `undici`、现有 `fetchTextLimited`、React/esbuild 与 Node 内置 `node:test`；不新增 npm 依赖。
- dsh-m 图片消费端白名单保持原样：HTTPS，`github.com` 或 `*.githubusercontent.com`，URL 长度 ≤2048，最多 8 张；weserv 与原图直连的次序、超时和终态不动。manifest 图片路径生成后仍由客户端 `safeScreenshots` 做最终过滤。
- Primary screenshot 读取只认 active Primary Registry；不改严格 Registry schema、不加截图字段、不改 [registry.json](../../registry.json)、`mergeRegistries`、`CommunityEntry` 或 `community-adapter.ts`。默认和自定义 Primary Registry 使用同一 host 查表路径；无 `github` 的条目无图。
- GUI 专用：不改 `dshm_search`、其他 Agent tools 或 CLI。保留现有社区详情路径、`openFavDetail` 的 `source='all'` 回查与收藏快照字段投影；截图数据不进入这些响应或快照。
- 不改 dsh-m 的当前版本号，不增写发版 Changelog，不执行 commit/push/npm publish/装机/restart；本计划只含源码、回归测试、DESIGN 与 ADR。发版版本和发布动作另行确认。
- 基线核验：当前分支为 `main`，当时工作树只有本实施计划未跟踪；用户已于 2026-10-09 明确授权在 `main` 开工。实现启动前仍须重查分支和工作树：若分支不再是 `main` 或出现计划外改动，先停下核对，不得覆盖或带入无关改动。
- 计划完整性：由于实施计划本身是未跟踪文件，`git status` 无法发现其内容被改写；开工前记录其 SHA-256，最终验证时复算并比较，摘要只记入执行报告、不写回本计划。

## 输入工件

- 设计来源：本会话 2026-10-09 grilling 共识（用户逐项确认 Q1–Q14；无独立已批准 ADR，故对话共识为需求基准）。
- Primary/Community 定义与市场展示现状：[GLOSSARY.md](../../GLOSSARY.md#L68-L102) 与 [DESIGN.md](../../docs/DESIGN.md#L68-L100)。
- 作者当前清单：[screenshots.json](https://github.com/iasiv5/dsh-skins/blob/main/screenshots.json#L1-L7)，已是顶层相对路径数组，5 张图。
- 图片安全/加载不变量：[ADR-0014](../../docs/adr/0014-image-chain-weserv-first.md#L10-L24)、[main.jsx](../../src/client/main.jsx#L726-L743)、[img-chain.js](../../src/client/img-chain.js#L15-L30)。
- HTTP 读取、响应上限、超时与逐跳 `onRequest` 接缝：[httpx.ts](../../src/core/httpx.ts#L80-L112) 与 [httpx.ts](../../src/core/httpx.ts#L143-L234)。

## 文件结构与职责

- Create: `src/core/primary-screenshots.ts` — manifest URL 构造、相对路径解析、host/path 安全检查、64 KiB/5 秒预算、10 分钟成功缓存/1 分钟负缓存、single-flight；导出 reader factory 与生产 reader。
- Create: `tests/primary-screenshots.test.mjs` — 用注入 fetcher/时钟验证 manifest parser、URL、错误降级、缓存和并发合并。
- Modify: [host-api.ts](../../src/core/host-api.ts) — `HostApiOverrides` 注入点与 `primary-screenshots` method；根据 active Registry 的 `id` 取 `github`，绝不接收客户端自带 URL。
- Modify: [host-api.test.mjs](../../tests/host-api.test.mjs) — 使用 fake controller snapshot 与注入 reader 验证 host lookup、空结果、请求体错误和零 Community loader 调用。
- Modify: [main.jsx](../../src/client/main.jsx) — `DetailModal` primary/Community 分流与 Modal-local state；不改 `safeScreenshots`、`Shot`、`Lightbox`、`useImgChain`。
- Modify: [client-img-chain.test.mjs](../../tests/client-img-chain.test.mjs) — 按仓库既有源锚风格验证 Modal 的 primary host method 接线、Community 原路径和图片链调用不变。
- Modify: [verify-lightbox.mjs](../../scripts/verify-lightbox.mjs) — 加确定性 Primary Detail Modal 场景，fake `/dshm` host 响应与图片响应，不进行 live 网络请求。
- Modify: [DESIGN.md](../../docs/DESIGN.md) §2.5/§2.6 — 区分 Community Catalog 截图旁路字段和 Primary Registry 作者 manifest 来源，记录详情按需读取及不写入 market/favorite snapshot 的约束。
- Create: `docs/adr/0015-primary-screenshot-manifest.md` — 记录来源选择、被否方案与运行期代价；不新增 GLOSSARY 词条（现有术语足够，无新领域概念）。
- Existing plan artifact (do not modify during implementation): `docs/plans/2026-10-09-primary-screenshot-manifest-implementation-plan.md` — created for this request and untracked at the main-branch baseline; retain it as the reviewed plan.
- Unchanged: [registry.ts](../../src/core/registry.ts)、[market.ts](../../src/core/market.ts)、[community-adapter.ts](../../src/core/community-adapter.ts)、[tools.ts](../../src/tools.ts)、[cli.ts](../../src/cli.ts)、[market-snapshot.js](../../src/client/market-snapshot.js)、[favorites.js](../../src/client/favorites.js)、[registry.json](../../registry.json)、[package.json](../../package.json)。

## 任务清单

### Task 1: 作者 manifest reader 与纯逻辑测试

- 目标：创建一个可在无真网环境下测试的 Module，将受信任 `owner/repo` 与 root [screenshots.json](https://github.com/iasiv5/dsh-skins/blob/main/screenshots.json) 解析为绝对 raw image URLs。
- Files: Create `src/core/primary-screenshots.ts`; Create `tests/primary-screenshots.test.mjs`。
- 接口契约：
  - Consumes: `fetchTextLimited(url, options)`；`owner/repo` 来自已校验的 Primary Registry；`now()` 作为 cache expiry 测试缝。
  - Produces: `createPrimaryScreenshotReader({ fetchText, now })` 返回 `loadPrimaryScreenshots(github): Promise<string[]>`；生产实例使用 `fetchTextLimited`。失败和无图都是 `[]`；保序；有效列表 ≤8。
- 验证范围：不出网验证 URL、路径 containment、HTTP host guard、响应预算、错误降级、缓存和 single-flight。

- [ ] Step 1: 先写 `tests/primary-screenshots.test.mjs`。至少覆盖：
  1. `iasiv5/dsh-skins` 生成固定 root manifest URL `https://raw.githubusercontent.com/iasiv5/dsh-skins/HEAD/screenshots.json`；
  2. 5 条当前 manifest 路径按顺序变成同 repo/ref 的绝对 raw URLs，路径段编码正确；
  3. 非顶层数组、空/非字符串成员、超过 8 项、绝对/协议相对路径、`..`、反斜杠、query/hash、控制字符均返回 `[]`；
  4. 无效 `github` 不出网；404、超时、坏 JSON 返回 `[]`；每次读取选项含 `timeoutMs: 5_000`、`maxBytes: 65_536` 和 raw host 逐跳 guard；
  5. 成功值在 10 分钟内命中缓存，过期后重取；失败/空值 1 分钟负缓存；相同 repo 并发请求只触发一次 fetch。
- Run（工作目录 `dsh-m/`）：
  ```sh
  npm run build && node --test tests/primary-screenshots.test.mjs
  ```
- Expected: 当前因 `lib/core/primary-screenshots.js` 不存在或 reader export 缺失而失败；测试不得访问真实网络。
- [ ] Step 2: 实现 `src/core/primary-screenshots.ts`。路径处理先拒绝绝对/越界形态，再按 `/` 分段编码；fetch 的 `onRequest` 对每一跳只允许 `https://raw.githubusercontent.com`；HTTP/JSON/path 任一错误收敛为 `[]` 并负缓存 1 分钟；成功及 in-flight map 只存在进程内。
- [ ] Step 3: 运行并确认通过
- Run（工作目录 `dsh-m/`）：
  ```sh
  npm run build && node --test tests/primary-screenshots.test.mjs
  npm run typecheck
  ```
- Expected: manifest tests 全绿；TypeScript 零错误。
- 接口产物：Task 2 消费 `loadPrimaryScreenshots(github)`，不得直接拼 raw URL 或重复解析 JSON。

### Task 2: GUI Host method 与 active Primary Registry 查表测试

- 目标：新增不依赖 Community Catalog 的 GUI 读 method，按 `id` 从当前生效 Primary Registry 找 GitHub repo。
- Files: Modify [host-api.ts](../../src/core/host-api.ts); Modify [host-api.test.mjs](../../tests/host-api.test.mjs)。
- 接口契约：
  - Consumes: Task 1 的 `loadPrimaryScreenshots(github)`；`RegistryController.ensureReady()` 与 `snapshot()`；现有 `/dshm` request trust/JSON/method dispatcher。
  - Produces: GUI 发 `POST /dshm` body `{ method: 'primary-screenshots', id }`；成功 payload `{ ok: true, screenshots: string[] }`。方法只消费 `id`；即使请求体附带 `github`/`url`，也必须忽略并只使用 active Registry 中该 id 的 `github`。缺少 id → 400；active Registry 无此 id 或 `github` 缺失 → 200 + `screenshots: []`；reader 错误按图片资料失败降级为空数组。
- 验证范围：默认与自定义 active Registry 都由同一 snapshot 路径取值；该 method 不调用 `listMarket`、`getCommunitySummary` 或 Community Catalog。

- [ ] Step 1: 在 [host-api.test.mjs](../../tests/host-api.test.mjs) 加失败用例，使用结构兼容的 fake controller（`ensureReady`、`snapshot`）与 `loadPrimaryScreenshots` 注入：有效 Primary 条目按其 `github` 调 reader 并返回 URL；请求同时携带已知 id 与恶意 `github`/`url` 时，reader 仍只能收到 active snapshot 中的 repo；无 id、未知 id、无 github 分别验证 400/空数组/空数组；Community summary 与 listMarket 调用数保持 0；reader 拒绝也回空数组。
- Run（工作目录 `dsh-m/`）：
  ```sh
  npm run build && node --test tests/host-api.test.mjs
  ```
- Expected: 新增 method 用例红，既有 host-api 用例维持原结果。
- [ ] Step 2: 在 `HostApiOverrides` 加 `loadPrimaryScreenshots` 注入点，在 dispatcher defaults 绑定生产 reader；新增 `case 'primary-screenshots'`，只从 `ctx.controller.snapshot().loaded.registry.plugins` 精确查 id，再调用 reader。不得在请求体接受 `github` 或任意 URL。
- [ ] Step 3: 运行并确认通过
- Run（工作目录 `dsh-m/`）：
  ```sh
  npm run build && node --test tests/host-api.test.mjs
  npm run typecheck
  ```
- Expected: host-api 全绿，类型检查零错误。
- 接口产物：Task 3 只调用 `api('primary-screenshots', { id })`；不得把 URL 数组并入 `market` 响应。

### Task 3: Detail Modal primary manifest 接线

- 目标：详情打开后为 Primary 条目取图；live Community item 继续使用目录截图；只有 `owner` 标记的 Community 收藏快照保持无图且不调用 Primary method。
- Files: Modify [main.jsx](../../src/client/main.jsx); Modify [client-img-chain.test.mjs](../../tests/client-img-chain.test.mjs)。
- 接口契约：
  - Consumes: Task 2 的 GUI method `{ screenshots: string[] }`；现有 `safeScreenshots(entry)`；现有 `Shot`、`Lightbox` 与 `useImgChain`。
  - Produces: DetailModal local state 中的 `primaryShots`；Community live item 继续用 `safeScreenshots(it)`；Primary item 在 Modal mount/id 变化时请求 host method，返回值经 `safeScreenshots({ screenshots })` 再进入现有 `visible`/Shot/Lightbox。
  - source gate：live Community item（`it.community === true`）走原目录截图；owner-only Community favorite snapshot fallback 不存图且不调用 Primary method；Primary favorite snapshot 不存图 URL，只有 active Primary Registry 仍能按 id 找到条目时才会读 manifest。
- 验证范围：卡片不增加截图；README fold 不变；不改 `openFavDetail` 的现有 `source='all'` 回查；图片链和失败终态零改动；manifest URL 不进入 `MarketItem`。

- [ ] Step 1: 在 [client-img-chain.test.mjs](../../tests/client-img-chain.test.mjs) 为 DetailModal 增源码契约断言：live Community 分支使用原 `it.screenshots`；Primary 分支用 id 调 `primary-screenshots`；owner-only Community snapshot 不调 Primary method且无图库；结果经过 `safeScreenshots` 并仅存于 Modal state、不回写 `it`/`MarketItem`；`snapshotOf` 不含截图 URL；`openFavDetail` 仍以 `source: 'all'` 回查后再 snapshot fallback；`Shot` 仍用 `{ h: 300, active: show }`、Lightbox 仍用 `{ w: 1600 }`。
- Run（工作目录 `dsh-m/`）：
  ```sh
  node --test tests/client-img-chain.test.mjs
  ```
- Expected: 新增 Primary host-call/gate 断言红，既有 WESERV chain 纯逻辑用例通过。
- [ ] Step 2: 在 DetailModal 新增 `primaryShots` state 与加载 effect。modal 关闭或 `id` 切换时中止当前 UI waiter/忽略过期结果；host reader 的共享 HTTP flight 仍受 5 秒上限约束并可写入内存 cache。无图、fetch 失败或 safeScreenshots 过滤为空时维持无截图条，不显示 spinner/error placeholder。
- [ ] Step 3: 运行并确认通过
- Run（工作目录 `dsh-m/`）：
  ```sh
  node --test tests/client-img-chain.test.mjs tests/client-render-smoke.test.mjs
  ```
- Expected: 新 source contract 全绿；既有 SSR DetailModal、community screenshot、Lightbox 与 image-chain checks 零回归。
- 接口产物：Task 4 的浏览器验证从 Primary DetailModal 观察 Host request 和同一图片链，不对组件实现增加第二套截图加载逻辑。

### Task 4: Primary Modal 浏览器回归探针

- 目标：用 fake `/dshm` Host method 与图片响应验证真实 React effect → DetailModal gallery → WESERV image chain，不访问 GitHub/Weserv 真网。
- Files: Modify [verify-lightbox.mjs](../../scripts/verify-lightbox.mjs)。
- 接口契约：
  - Consumes: Task 3 的 `primary-screenshots` client 调用；现有 Playwright `page.route`、WESERV fake response 与 direct image fake response。
  - Produces: A26–A29：Primary id 请求一次且返回后截图条出现；缩略图走 Weserv `h=300`、灯箱走 Weserv `w=1600`；live Community item 与 owner-only Community snapshot 均不请求 Primary method；empty/error response 保持无截图条。
- 验证范围：每个 Playwright page/freshState 都挂 fake `/dshm` route、images.weserv.nl route、github.com/fake 和 raw.githubusercontent.com/fake 图片 route；`reqLog` 覆盖 raw host；不得使用 `--live`。

- [ ] Step 1: 改动前检查：确认现有 `__boot` fixture 固定 `community: true`，`freshState()` 每个场景会新建 page 并重新挂图片 route，脚本目前只覆盖 A0–A25 且没有 `/dshm` route。
- Run（工作目录 `dsh-m/`，需 `playwright-core` 与可用 Chromium）：
  ```sh
  node scripts/verify-lightbox.mjs
  ```
- Expected: A0–A25 全 PASS；Primary manifest 场景和 `/dshm` mock 均不存在。
- [ ] Step 2: 在 [verify-lightbox.mjs](../../scripts/verify-lightbox.mjs) 扩展 `__boot` 支持 Primary/live Community/owner-only snapshot fixture；为初始 page 与每个 `freshState()` page 调用相同 route installer，拦截 `/dshm` 并只对 `{ method: 'primary-screenshots' }` 返回 fixture URL；给 `raw.githubusercontent.com/fake/**` 加 fulfill/abort 路由并纳入 request log。A26 测 primary id 与 gallery；A27 测 Community live 保持旧路径；A28 测 owner-only Community snapshot 不调 primary method；A29 测空/失败响应不渲截图条。所有 route 都本地 fulfill/abort，catch-all 检查禁止未拦截的外网请求。
- [ ] Step 3: 运行并确认通过
- Run（工作目录 `dsh-m/`，需 `playwright-core` 与可用 Chromium）：
  ```sh
  node scripts/verify-lightbox.mjs
  ```
- Expected: A0–A29 全 PASS、脚本退出码 0、所有 remote-origin 请求均命中 mock；不运行 `--live`。

### Task 5: DESIGN 与 ADR 记录

- 目标：记录 Primary 作者清单和 Community Catalog 的来源边界，以及按需读取的可靠性/安全取舍。
- Files: Modify [DESIGN.md](../DESIGN.md); Create `docs/adr/0015-primary-screenshot-manifest.md`。
- 接口契约：
  - Consumes: Task 1–4 的最终 Interface 与行为；现有术语“主清单”“社区清单”“图片加载链”。
  - Produces: DESIGN §2.5/§2.6 说明 community `screenshots` 旁路字段与 primary author manifest 是两条来源；ADR-0015 记录决定、替代方案和后果。
- 验证范围：文档不声称 app-wide 零 Community traffic；准确称新读取入口为 GUI method `primary-screenshots`（只接收 id），并与既有 market method 的 `source='primary'` 分区参数区分；说明该截图 method 不调用 Community Catalog，但 Community Zone 与收藏 `source='all'` 的既有路径不变；无 GLOSSARY 新词。

- [ ] Step 1: 改动前检查。阅读 [DESIGN.md](../DESIGN.md) §2.5/§2.6 与 [ADR-0014](../adr/0014-image-chain-weserv-first.md)，确认现有文案尚未记录 Primary 作者 manifest；确认 `docs/adr/0015-primary-screenshot-manifest.md` 不存在且 DESIGN/ADR 无预先改动。
- Run（工作目录 `dsh-m/`）：
  ```sh
  git status --short -- docs/DESIGN.md docs/adr/0014-image-chain-weserv-first.md docs/adr/0015-primary-screenshot-manifest.md
  ```
- Expected: 0015 不存在；DESIGN 与 ADR-0014 不含本任务前的工作树改动。
- [ ] Step 2: 修改 DESIGN §2.5/§2.6 并创建 ADR-0015。记录：Primary manifest 不通过 Community/README 提供；root manifest 的格式、HEAD 路径、Host method、TTL/失败降级；现有图片 whitelist 与 weserv chain 不变；inline URL / Community merge / README extraction 的取舍。不要改 GLOSSARY 或 ADR-0014。
- [ ] Step 3: 文档格式检查
- Run（工作目录 `dsh-m/`）：
  ```sh
  git diff --check
  ```
- Expected: 退出码 0，无 whitespace/error 标记；DESIGN 与 ADR 对实现的文件路径、TTL、host method 名称一致。

### Task 6: 全量验证与交付边界

- 目标：整合验证 Node/core、GUI bundling、类型和浏览器回归；确认改动严格局限于计划文件。
- Files: 本计划列出的全部实现、测试和设计文档文件。
- 接口契约：Consumes Task 1–5 所有产物；Produces 通过的实现候选，不产生发布或装机动作。
- 验证范围：全量 `node:test`、TypeScript、客户端构建、WESERV/manifest fake 浏览器探针、工作树范围审阅。

- [ ] Step 1: 全量 Node tests（`npm test` 内含 `pretest` → `npm run build`）
- Run（工作目录 `dsh-m/`）：
  ```sh
  npm test
  ```
- Expected: 所有 `tests/*.test.mjs` 通过，pretest build 成功。
- [ ] Step 2: TypeScript 检查
- Run（工作目录 `dsh-m/`）：
  ```sh
  npm run typecheck
  ```
- Expected: 零类型错误。
- [ ] Step 3: 浏览器探针与 diff 范围
- Run（工作目录 `dsh-m/`，需可用 Chromium）：
  ```sh
  node scripts/verify-lightbox.mjs
  git diff --check
  git status --short
  node -e "const fs=require('node:fs'); const crypto=require('node:crypto'); console.log(crypto.createHash('sha256').update(fs.readFileSync('docs/plans/2026-10-09-primary-screenshot-manifest-implementation-plan.md')).digest('hex'))"
  ```
- Expected: A0–A29 全 PASS、`git diff --check` 零错误；本计划 SHA-256 与 Task 1 前记录的摘要完全一致；源码/测试/设计文档改动仅限「文件结构与职责」列出的文件；已存在的未跟踪实施计划文件保持不变；[registry.json](../../registry.json)、[package.json](../../package.json)、[package-lock.json](../../package-lock.json)、[community-adapter.ts](../../src/core/community-adapter.ts)、[tools.ts](../../src/tools.ts)、[cli.ts](../../src/cli.ts)、[market-snapshot.js](../../src/client/market-snapshot.js) 与 [favorites.js](../../src/client/favorites.js) 不变。

## 执行纪律

- 开始实现前先批判性复查本计划、符号锚点和当前工作树；发现设计/实现矛盾、接口命名漂移或验证命令无效，先停下修计划。
- Task 1 前，从 `dsh-m/` 根目录记录本计划 SHA-256 到执行报告；最终验证时以同一 Node 命令复算，摘要不写入本计划：
  ```sh
  node -e "const fs=require('node:fs'); const crypto=require('node:crypto'); console.log(crypto.createHash('sha256').update(fs.readFileSync('docs/plans/2026-10-09-primary-screenshot-manifest-implementation-plan.md')).digest('hex'))"
  ```
- 按 Task 1–6 顺序执行，不跳步、不合并验收、不把 manifest 请求移进 `listMarket()`。
- 每个任务完成后运行该任务定义的验证；失败、网络请求意外出网、Community loader 被 Primary screenshot method 调用或计划外文件改变时立即停止并报告。
- 不提交、不推送、不 bump 版本、不发布 npm、不升级 profile、不重启 DSH；这些均不在本计划范围。
- 用户已明确批准在 `main` 分支实施；开始实现时核验当前仍为 `main`，并确认除本计划这项已知未跟踪文件外没有计划外工作树改动。若不满足，停止并向用户报告，不自行切分支或覆盖改动。
- 所有验证命令在 Node ≥22 环境、从 `dsh-m/` 仓库根目录运行；[verify-lightbox.mjs](../../scripts/verify-lightbox.mjs) 需要 `playwright-core` 和可用 Chromium，且不得带 `--live`。

## 最终验证

- Run: `npm test`
- Expected: 全量 Node 测试与 pretest build 全绿。
- Run: `npm run typecheck`
- Expected: 零错误。
- Run: `node scripts/verify-lightbox.mjs`
- Expected: A0–A29 全 PASS，模拟 Primary manifest → Detail Modal → WESERV 缩略图/灯箱链路，不访问真实 GitHub/Weserv。
- Run: `git diff --check`
- Expected: 零 whitespace/error 标记。
- Run: `git status --short`
- Expected: 变更文件在计划白名单内；计划文档作为基线 untracked 工件保留。
- Run（从 `dsh-m/` 根目录）：
  ```sh
  node -e "const fs=require('node:fs'); const crypto=require('node:crypto'); console.log(crypto.createHash('sha256').update(fs.readFileSync('docs/plans/2026-10-09-primary-screenshot-manifest-implementation-plan.md')).digest('hex'))"
  ```
- Expected: 输出 hash 与 Task 1 前记录在执行报告中的基线完全一致。

## 审阅 Checkpoint

- 本实施计划供普通编码 Agent 或人工执行者使用；计划审阅前不进入实现。
- 用户批准计划后，执行者仍须在开始编码前复查计划与当前分支/工作树；如发现计划遗漏或与仓库现实矛盾，先修计划并重新送审。
- 本计划获批本身不新增 main 授权；本次在 `main` 实施的明确授权已由用户给出并记入全局约束/执行纪律。计划批准不代表批准 npm 发布或本机装机/重启。
- 审阅通过前不得修改计划之外的代码或文档。
