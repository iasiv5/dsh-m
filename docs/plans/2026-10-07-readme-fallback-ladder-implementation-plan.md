# README 兜底 /latest 小载荷腿 + 文案 profile-aware + 兜底失败摘要 实施计划

## 目标

dsh-m 0.9.50，三件事（2026-10-07 grilling 共识，六题全按推荐拍板）：

1. **README 兜底阶梯**：`npmPackumentReadme` 内部改为两腿——`/latest` 版本文档（小载荷）优先，空/失败落既有 packument 腿；任一腿成功即成功，两腿全败才失败。解决上海 Windows 桌面机（生效源 npmmirror）上 billion-context 的 packument（实测 8,586,604 字节）超过 8MB（8,388,608）上限、兜底腿必失败的问题（npmjs packument 8,195,089 字节只是帽下侥幸）。
2. **本地未装文案 profile-aware**：desktop profile 上不再误报「web profile 未安装该插件」。
3. **兜底失败摘要**：两腿全败时错误附「npm README 兜底失败: <终末腿原因>」，真实死因（如响应超帽）不再被吞。

> 版本靶变更记录：原靶 0.9.49 已被 commit `decbdd8`（已装 README 基址贯通 + 链接归一三件，2026-10-07 15:18）占用并发布 npm，本计划随之改靶 **0.9.50**。该提交未触及本计划任何靶函数（见「输入工件」），任务内容零变化，仅版本号与锚点刷新。

## 架构快照

- `npmPackumentReadme`（`src/core/versions.ts`）内部两腿，**对外签名与返回形状 `{ readme: string; repo: string }` 不变**：
  - 腿1：`GET <生效源>/<pkg>/latest`（URL 拼法同 `npmLatest` 先例：`registryBase(base) + '/' + encodeURIComponent(pkg) + '/latest'`）。响应 `readme` 非空 → 直接返回 `{ readme, repo: extractGithubRepo(latest 文档.repository) }`，不再请求 packument。**超时收紧为 `Math.min(timeoutMs, 5_000)`**（同文件 `npmLatest` 首腿收紧先例，versions.ts L232）——生效源完全不可达时兜底最坏时延从 40s（20s×2）压回 25s（5s+20s）；主修复场景（npmmirror 超帽）腿1 KB 级载荷快速成功，不受影响。
  - 腿2：packument（现状腿，URL 与 20s 超时不变）。成功（readme 空或不空）→ 返回 `{ readme, repo: extractGithubRepo(packument.repository) }`（= 今日行为，web/npmjs 路由零回归）。
  - 腿1 成功但 readme 空 + 腿2 失败 → 降级成功：返回 `{ readme: '', repo: extractGithubRepo(latest 文档.repository) }`（客户端渲染「没有 README」，不抛错）。
  - 两腿全失败 → 抛**终末腿（packument）**的错误。
  - **两腿 readme 判空同一规则**：`typeof data?.readme === 'string' && data.readme.trim() !== ''`——空白串视为空，腿1 不得用「字段存在即命中」的捷径。
  - 两腿均在**生效源**（ADR-0012 L1：显式 registry 参数 > 生效源），**不跨源**。安全基线：HTTPS、8MB maxBytes 沿用；超时腿1 `Math.min(timeoutMs, 5_000)`、腿2 20s。
- `readInstalledPluginReadme`（`src/core/installed.ts`）新增第三参 `profileName = 'web'`，未装错误改 `${profileName} profile 未安装该插件: ${key}`（形态对齐 `src/core/profile-ops.ts` L600 的 desktop 先例）。
- host-api `readme` 分支（`src/core/host-api.ts`）：本地读取传 `profile.name`；兜底失败抛合成错误 `` `${localErr.message}（npm README 兜底失败: ${fallbackErr.message}）` ``。

## 全局约束

- 目标版本 **0.9.50**；Node ≥22（engines 既有约束）；本仓库在 Windows + PowerShell 下开发验证。
- 读路径不跨源：不新增「npmmirror 作 readme 补充源」之类跨源腿（grilling Q2 拍板）。
- 错误文案逐字规则：前缀 `` `（npm README 兜底失败: ` `` 与后缀 `` `）` `` 为测试锚点，不得改写；`${profileName} profile 未安装该插件: ${key}` 同为锚点。
- **文案修复范围仅 README 路径**（grilling Q3 拍板）：`src/core/market.ts`（upgrade 路径）、`src/core/toggle.ts`、`src/core/profile-transaction.ts` 中的「web profile 未安装该插件」文案所在函数均为 web 事务专用路径（desktop 走官方 pluginManager 委派，到不了这些代码），文案本来就正确，**本轮一律不动**。
- 不新开 ADR、不动 ADR-0012、不在 GLOSSARY 加词条（grilling Q5 拍板；读分类词汇先例在 ADR-0012 文本中）。
- 除「文件结构与职责」列出的文件外不得改动其它文件；`registry.json`、`src/client/**` 本轮零改动。
- **不发版**：commit/push/npm publish/装机不在本计划内，全绿后另行经主人确认。**checkpoint commit 本轮统一不执行**（含 Task 2/4/5 各步的可选 commit）——全部变更以未提交工作树交付实施评审，commit 粒度待评审通过后由主人决定（实施评审 Round 1 问题 3 修订：消除本条与各 checkpoint 步骤的表述矛盾）。
- 当前仓库在 `main` 分支（HEAD `decbdd8`）：开始实现前须获主人对「在 main 上直接做」的同意，或先开特性分支——执行者不得自行决定。**主人已于 2026-10-07 明确批准「直接在 main 分支开始执行实施计划」（会话指令，实施评审 Round 1 问题 2 留痕），分支门已解除。**

## 输入工件

- 设计来源：2026-10-07 会话 grilling 共识（无独立设计文档，对话即需求；本文档「目标/架构快照」为共识的固化）。
- **0.9.49 交界核查（2026-10-07，HEAD `decbdd8`）**：该提交仅改 `src/client/main.jsx`、`src/client/markdown.js`、`src/core/installed.ts`（P2：`githubRepoFromRepository` L94 尾部 `$`→`[/?#]` 放宽）、`tests/client-markdown.test.mjs`、`tests/installed.test.mjs`（+11 行 repository 五形态用例）及文档/版本文件；`src/core/versions.ts`、`src/core/host-api.ts`、`tests/versions.test.mjs`、`tests/host-api.test.mjs` **零接触**——本计划靶函数体逐字节未动，任务内容无需变化。
- 实测证据（2026-10-07，本机）：
  - `https://registry.npmmirror.com/billion-context` → 200，8,586,604 B，readme len=47876（超帽被 `readCapped` 拒：`src/core/httpx.ts` L123-137 抛 `502 响应超过上限`）
  - `https://registry.npmjs.org/billion-context` → 200，8,195,089 B，readme 为空串
  - 两源 `/billion-context/latest` 与 `/@iasiv5%2Fdsh-skins/latest`（scoped）均 200；npmmirror 的 `/latest` 携带 readme，npmjs 的不带
  - 本机路由决策 `~/.dsh/dshm/cache/npm-route.json` base = npmmirror（2026-10-04）

## 文件结构与职责

- Modify: `src/core/versions.ts` — `npmPackumentReadme`（锚：L179-196，HEAD `decbdd8`）阶梯化；doc 注释补 0.9.50 说明。`extractGithubRepo`（L159-169）复用不改。
- Modify: `src/core/installed.ts` — `readInstalledPluginReadme`（锚：L284-306）加第三参与文案（未装 throw 在 L295）；`PluginReadme` 接口（L254-261，含 0.9.48 可选 `repo`）形状不动。注意：0.9.49 在本文件只动过 L94 `githubRepoFromRepository`，与本任务无交集。
- Modify: `src/core/host-api.ts` — `case 'readme'`（锚：L505-525）两处接线；deps 类型 `readInstalledPluginReadme?: typeof readInstalledPluginReadme`（L62）随签名自动跟随，不改声明。
- Modify: `tests/versions.test.mjs` — `describe('npmPackumentReadme…')` 块（锚：L350-404）重写/扩展；mock 惯例沿用 `installMockFetch`/`fetchCalls`/`jsonResponse`/`_setWireFetchForTests`（L27-38）。
- Modify: `tests/installed.test.mjs` — 'partial 语义与特殊 key' describe 内新增 profileName 用例（as-built 归属，见 Task 3 Step 1——该文件无独立 README describe；0.9.49 已在该文件追加 repository 五形态用例，与本任务用例无交集）。
- Modify: `tests/host-api.test.mjs` — readme 用例（锚：L294-321）改名/扩断言 + 新增两用例；`setup()` 的缺省 `profile: { name: 'web', kind: 'web', dir: '/tmp/profile', source: 'fallback' }`（L83）不改。
- Modify: `CHANGELOG.md` — 中文区「### 0.9.49 变更…」（L11）前与英文区「### Added in 0.9.49」（L374）前各插 0.9.50 条目。
- Modify: `docs/DESIGN.md` — README 预览节「数据源」句（锚：L185 尾段）改写 + 同段「npm packument `repository`」一词级修正。
- Modify: `package.json` — version `0.9.49` → `0.9.50`。
- Modify: `package-lock.json` — 根与 packages."" 两处 version 字段随 package.json 同步 `0.9.50`（版本 bump 的机械伴随物，实施评审 Round 1 问题 1 补录；内容已核实仅此两处）。

## 任务清单

### Task 1: versions 阶梯测试先行（红）

- 目标：用测试钉死两腿阶梯语义（含对既有用例的适配）。
- 涉及文件：`tests/versions.test.mjs`
- 接口契约
  - Consumes: 现有 `npmPackumentReadme(pkg, timeoutMs?, signal?, registry?, deps?) → {readme, repo}`（lib 构建产物 `../lib/core/versions.js`）；mock 惯例 `installMockFetch`/`fetchCalls`/`jsonResponse`/`afterEach(() => _setWireFetchForTests(null))`；用例 9 另用 `deps.fetchJsonLimited` 注入 spy（该参数本就是依赖注入缝，测试直接传函数）。
  - Produces: 锁定阶梯语义的 describe 块——Task 2 的实现必须让这些用例全绿；用例中「latest 命中即短路（fetchCalls.length===1）」「终末腿错误文本」「超帽降级空 README」「腿1 超时收紧」四条是 Task 2 的验收核心。
- 验证范围：本文件内全部用例。**断言纪律**：精确索引/精确计数的 fetchCalls 断言（用例 3、4、8、9）一律配**显式 registry 参数**（如 `https://registry.example.com`），与 npm-route probe-once 的混入请求解耦；缺省 registry 的用例（用例 2）只做 `some()` 形态断言（缺省路径存在 probe 混入可能，同文件既有注释自证）。

- [ ] Step 1: 改写/扩展 `describe('npmPackumentReadme（0.9.45 U10b：未安装条目 README 兜底）')`（建议 describe 名更新为 `npmPackumentReadme（0.9.45 U10b 兜底 + 0.9.50 /latest 阶梯）`），用例如下：
  1. **改写既有「显式 registry 参数优先」用例** →「显式 registry 贯穿两腿」（显式传 registry）：handler 按 URL 分流——`/pkg-x/latest` 返回 `jsonResponse({ version: '1.0.0' })`（无 readme），packument 返回 `jsonResponse({ readme: '# hello' })`；断言 `fetchCalls` 每一项都以 `https://registry.example.com/` 开头、结果 readme 为 `# hello`。
  2. **改写既有「缺省走生效源」用例** →「缺省生效源贯穿两腿（形态断言）」（不传 registry）：handler 按 URL 分流——latest 返回 `jsonResponse({ version: '1.0.0' })`（空 readme），packument 返回 `jsonResponse({ readme: '# hi' })`；断言 `fetchCalls.some(u => u.endsWith('/pkg-default/latest'))`、`fetchCalls.some(u => /\/pkg-default$/.test(u))`、两请求均以 `https://` 开头；结果 readme 为 `# hi`。**不做 `fetchCalls[0]/[1]` 精确索引**——缺省路径可能混入 npm-route probe-once 请求。
  3. **新增**「latest 命中即短路」（显式传 registry）：handler 对 `/pkg-l/latest` 返回 `{ version: '1.0.0', readme: '# latest readme', repository: 'git+https://github.com/o/r.git' }`，其它 URL 一律 `throw new Error('不应到达 packument: ' + url)`；断言结果 `{ readme: '# latest readme', repo: 'o/r' }` 且 `fetchCalls.length === 1`。
  4. **新增**「latest 空 → 落 packument，repo 以 packument 为准」（显式传 registry）：latest 返回 `{ version: '1.0.0', repository: 'git+https://github.com/o1/r1.git' }`（无 readme），packument 返回 `{ readme: '# packument readme', repository: { type: 'git', url: 'git@github.com:o2/r2.git' } }`；断言 readme、`repo === 'o2/r2'`、`fetchCalls[0]` 以 `/latest` 结尾且 `fetchCalls[1]` 不以 `/latest` 结尾。
  5. **新增**「latest 失败 → packument 兜住」（显式传 registry）：latest 返回 404，packument 返回 `{ readme: '# from packument' }`；断言 readme 命中。
  6. **新增**「latest 空白 readme + packument 失败 → 降级空 README 不抛」（显式传 registry）：latest 返回 `{ version: '1.0.0', readme: '   ', repository: 'git+https://github.com/o/r.git' }`（**空白 readme，覆盖腿1 trim 判空**——空白不得当作命中短路），packument 返回 `jsonResponse('too big', 502)`；断言 `readme === ''` 且 `repo === 'o/r'`，不 reject。
  7. **新增**「两腿全败 → 抛终末腿（packument）错误」（显式传 registry）：latest `throw new Error('latest down')`，packument `throw new Error('packument leg boom')`；`assert.rejects(…, /packument leg boom/)`。
  8. **既有「readme 缺失/空白 → 空串」用例强化**：两处调用补显式 registry 参数；**fetchCalls 重置时机必须写明**——每次调用前置空 `fetchCalls = []`、调用后紧跟 `assert.equal(fetchCalls.length, 2)`（或拆成两个 it）。不得在用例末尾对累计值一次性断言：两次调用共享同一 fetchCalls 数组且现状无重置，一次性断言在红阶段 1+1=2 恰好假绿、Task 2 后 2+2=4 反而红（评审 Round 2 问题 N2）。
  9. **新增**「腿1 超时收紧 `Math.min(timeoutMs, 5_000)`」：不经 wire mock，直接以 `deps.fetchJsonLimited` 注入 spy 记录 `(url, opts)`，**spy 每次调用返回 `{}`**（勿 reject，驱动腿1→腿2 连续执行）；**显式传 registry（按断言纪律）**。断言：缺省 timeoutMs（20_000）调用下第 1 次（latest 腿）`opts.timeoutMs === 5_000`、第 2 次（packument 腿）`=== 20_000`；再以 `timeoutMs = 3_000` 调用断言 latest 腿 `=== 3_000`（Math.min 双向语义）。（评审 Round 2 问题 N1：「缺省」仅指 timeoutMs 缺省，registry 必须显式传，避免无决策文件机器上的真实网络 probe-once。）
  10. **既有「repo 归一」「非法包名」「scoped 编码」用例保留不改**——「repo 归一」在阶梯下断言值不变（mock 同体返回，leg1 短路、repo 取 latest 文档 repository），在该用例上加一行注释说明此语义。
- [ ] Step 2: 运行并确认失败
  - Run: `npm run build && node --test tests/versions.test.mjs`
  - Expected: 用例 **2、3、4、6、8、9 红**（现实现无 /latest 腿：2 无 latest 请求可 some 命中；3 触发「不应到达 packument」；4 的 `fetchCalls[0]` 非 latest；6 现实现 packument 502 即 reject；8 现实现单腿 `length === 1`；9 现实现无两腿 timeout 形态）。用例 **1、5、7 与既有用例绿**属正常——1/5 改写后等价测 packument 腿，7 锁定「终末腿错误」语义（Task 2 后必须保持绿）。
- [ ] Step 3: 无（实现是 Task 2；本任务止于红灯确认）

### Task 2: versions.ts 阶梯实现（绿）

- 目标：`npmPackumentReadme` 落地两腿阶梯，Task 1 用例全绿。
- 涉及文件：`src/core/versions.ts`
- 接口契约
  - Consumes: `fetchJsonLimited`（经 `deps?.fetchJsonLimited ?? fetchJsonLimited`）、`activeNpmRegistry()`、`registryBase()`、`extractGithubRepo()`（均在本文件既有作用域内）。
  - Produces: `npmPackumentReadme(pkg: string, timeoutMs = 20_000, signal?: AbortSignal, registry?: string, deps?): Promise<{ readme: string; repo: string }>`——签名与返回形状不变，供 `host-api.ts` L517 与测试消费；两腿失败语义（终末腿抛错）供 host-api 附摘要。
- 验证范围：Task 1 全部用例 + typecheck。

- [ ] Step 1: 写最小实现：腿1 `/latest` fetch（同一 `fetcher`，`timeoutMs: Math.min(timeoutMs, 5_000)`、`signal`/`maxBytes: 8 * 1024 * 1024` 与腿2 一致），按「架构快照」五条语义分支（含两腿同一 trim 判空）；doc 注释在 0.9.48 段落后补 0.9.50 阶梯说明（小载荷腿动机一句 + 超时收紧与降级语义一句）。
- [ ] Step 2: 运行并确认通过
  - Run: `npm run build && node --test tests/versions.test.mjs`
  - Expected: 本文件全部用例绿（pass 数以实际为准，零 fail）。
- [ ] Step 3: typecheck
  - Run: `npm run typecheck`
  - Expected: 零错误。
- [ ] Step 4: checkpoint commit（可选，信息如 `feat(readme): npmPackumentReadme /latest 小载荷腿两腿阶梯（0.9.50）`）

### Task 3: installed 文案 profile-aware（红→绿）

- 目标：desktop 上报 `desktop profile 未安装该插件: X`，缺省行为不变。
- 涉及文件：`src/core/installed.ts`、`tests/installed.test.mjs`
- 接口契约
  - Consumes: 现有 `readInstalledPluginReadme(pkg, profileDir = webProfileDir())`（Task 3 自身扩展签名）。
  - Produces: `readInstalledPluginReadme(pkg: string, profileDir: string = webProfileDir(), profileName: string = 'web'): Promise<PluginReadme>`——Task 4 的 host-api 接线依赖第三参存在。
- 验证范围：`tests/installed.test.mjs` 全部用例。

- [ ] Step 1: 写失败测试：在 README 相关用例所在的 describe（as-built 归属：`'listInstalledPlugins/readProfileDeps：partial 语义与特殊 key'`——该文件无独立 README describe，原型链守卫用例同在此）内新增用例「profileName 参数改写未装文案，缺省仍为 web」：
  - `manifest({})` 后 `await assert.rejects(() => readInstalledPluginReadme('missing', dir, 'desktop'), /desktop profile 未安装该插件/)`；
  - 既有两个原型链守卫用例（符号锚：`constructor`/`toString`「继承键不得授权」，HEAD `decbdd8` 下约 L191-209，两参调用）不动——它们继续锁定缺省 `/web profile 未安装该插件/`。
- [ ] Step 2: 运行并确认失败
  - Run: `npm run build && node --test tests/installed.test.mjs`
  - Expected: 新用例红（当前实现忽略第三参，报 `web profile`）。
- [ ] Step 3: 写最小实现：签名加 `profileName: string = 'web'`；L295 改 `` throw new Error(`${profileName} profile 未安装该插件: ${key}`) ``。
- [ ] Step 4: 运行并确认通过
  - Run: `npm run build && node --test tests/installed.test.mjs`
  - Expected: 全绿。

### Task 4: host-api 接线（红→绿）

- 目标：readme 分支传 `profile.name`；兜底失败抛附摘要的合成错误。
- 涉及文件：`src/core/host-api.ts`、`tests/host-api.test.mjs`
- 接口契约
  - Consumes: Task 2 的 `npmPackumentReadme`（签名/两腿语义不变）；Task 3 的 `readInstalledPluginReadme` 第三参；测试侧 `setup(overrides)` 与 `callApi` 既有惯例（`tests/host-api.test.mjs` L76、缺省 profile L83）。
  - Produces: readme 分支最终错误形态 `${本地错误}（npm README 兜底失败: ${兜底错误}）`——客户端红字与已知问题诊断直接消费此文本。
- 验证范围：`tests/host-api.test.mjs` readme 相关用例。

- [ ] Step 1: 写失败测试（改一加二）：
  - **改** readme 用例（锚 L294）：标题改「readme：未安装条目回源 npm 两腿兜底；兜底失败抛本地错误并附摘要（0.9.50 语义修订）」（as-built 标题，实施评审 Round 1 问题 4 对齐）；分支②断言扩展为三条——`includes('未安装该插件')`、`includes('npm README 兜底失败')`、`includes('offline')`（deps 注入的兜底错误文本）。
  - **加**「profile.name 传入本地读取」：`setup({ readInstalledPluginReadme: async (...args) => { seen.push(args); return { pkg: 'p', name: 'p', readme: 'r', truncated: false } } })`，call 后断言 `seen[0][2] === 'web'`（setup 缺省 profile.name）。
  - **加**「合成错误形态」：本地注入抛 `desktop profile 未安装该插件: x`、兜底注入抛 `响应超过上限 8388608 字节`，断言 `r.body.error === 'desktop profile 未安装该插件: x（npm README 兜底失败: 响应超过上限 8388608 字节）'`（全等断言成立依据：500 通路 `error` 即裸 `err.message`，host-api.ts L267）。
- [ ] Step 2: 运行并确认失败
  - Run: `npm run build && node --test tests/host-api.test.mjs`
  - Expected: 三处红（②无摘要、profile.name 用例得 `undefined`、合成用例只抛本地原文）。
- [ ] Step 3: 写最小实现（`case 'readme'`）：
  - L514 改 `await d.readInstalledPluginReadme(target, profile.dir, profile.name)`；
  - L519-521 内层 catch 改 `catch (fallbackErr) { throw new Error(`${localErr instanceof Error ? localErr.message : String(localErr)}（npm README 兜底失败: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}）`, { cause: localErr }) }`；
  - 分支头注释补一行 0.9.50 语义修订说明（0.9.45「如实抛原始错误」→「附兜底失败摘要」）。
- [ ] Step 4: 运行并确认通过
  - Run: `npm run build && node --test tests/host-api.test.mjs`
  - Expected: 全绿。
- [ ] Step 5: checkpoint commit（可选，信息如 `fix(host-api): readme 兜底失败附摘要 + 本地读取传 profile.name（0.9.50）`）

### Task 5: 文档与版本收口

- 目标：CHANGELOG 双语条目、DESIGN 数据源句、版本号三件套，与代码状态一致。
- 涉及文件：`CHANGELOG.md`、`docs/DESIGN.md`、`package.json`
- 接口契约
  - Consumes: Task 2/3/4 的最终行为描述（即本文档「架构快照」全文）。
  - Produces: 0.9.50 版本号（发版流程的输入）；可 grep 的文档锚点。
- 验证范围：锚点存在性 + 回归测试仍绿。

- [ ] Step 1: `CHANGELOG.md` 中文区「### 0.9.49 变更…」前插入 0.9.50 条目（要点：动机=上海机 npmmirror packument 8,586,604 B 超 8MB 帽实证、npmjs 8,195,089 B 帽下侥幸；阶梯两腿语义与「任一腿成功即成功」「不跨源」；**腿1 超时收紧 ≤5s、兜底最坏时延 40s→25s**；文案 profile-aware（desktop 先例形态）；兜底失败摘要并**明确标注这是对 0.9.45「兜底失败如实抛原始错误」的语义修订**；测试增量与基线豁免说明）。英文区「### Added in 0.9.49」前插对齐英文条目。条目草稿以本文档「目标/架构快照」为准扩写，中英语义一一对应。
- [ ] Step 2: `docs/DESIGN.md` L185 尾段「数据源」句改写为：
  > 数据源：已装条目读 profile 本地 `README.md`（≤64KB 截断）；未装条目回源 npm，两腿阶梯（0.9.50）——`/latest` 版本文档 `readme` 优先（KB 级小载荷，packument 超帽免疫，超时收紧 ≤5s），空/失败落 packument 顶层 `readme`（0.9.45 U10b）；任一腿成功即成功渲染（readme 空 → 「没有 README」），两腿全败抛本地未装错误并附兜底失败摘要（0.9.50）；`repo` 随到达的腿取 `repository`（packument 到达时以 packument 为准）。两腿均在生效源（ADR-0012），不跨源。
  同段 0.9.48 锚定描述中「npm packument `repository`（host-api readme 结果 `repo` 字段，仅 GitHub 归一）」一词级修正为「npm packument/latest 文档 `repository`（host-api readme 结果 `repo` 字段，仅 GitHub 归一）」。
- [ ] Step 3: `package.json` version 改 `0.9.50`。
- [ ] Step 4: 验证
  - Run: `npm run build && node --test tests/versions.test.mjs tests/host-api.test.mjs tests/installed.test.mjs` ； `npm run typecheck` ； `node -e "console.log(require('./package.json').version)"` ； `Select-String -Path CHANGELOG.md,docs/DESIGN.md -Pattern '0\.9\.50'` （PowerShell）
  - Expected: 三测试文件全绿；typecheck 零错误；输出 `0.9.50`；CHANGELOG 命中 ≥2（中英）、DESIGN 命中 ≥1。
- [ ] Step 5: checkpoint commit（可选，本轮统一不执行——见全局约束「不发版」条；信息备用：`docs: 0.9.50 changelog/design/version（README 阶梯 + 文案 + 摘要）`）

## 风险与回退

- **风险面**：纯读路径 + 错误文案 + 文档；无 schema/数据形态变化、无客户端 bundle 行为变化（错误文本变长由客户端原样渲染）；`readme` 响应无 CLI/tools 消费方（仅 host-api 分支），错误文本无全等匹配的下游。
- **已知取舍（评审 Round 1 问题 3）**：生效源完全不可达场景，兜底最坏时延由 20s 变 25s（腿1 收紧 5s + 腿2 20s）；主修复场景（超帽）腿1 快速成功不受影响。
- **过程回退**：任一任务无法收敛 → `git checkout -- <对应文件>` 回退该任务改动，或整体弃特性分支；checkpoint commit 按粒度 revert。
- **版本回退**：Task 5 bump 后若全量不绿或主人否决发版 → `git checkout -- package.json package-lock.json` 恢复 0.9.49。
- **发版后回退**：0.9.50 与 0.9.49 无数据形态耦合，可经官方通道装回 0.9.49；无需 deprecate。

## 执行纪律

- 开始实现前先批判性复查本计划；发现缺项/矛盾/锚点漂移（行号以 HEAD `decbdd8` 为参照，树若前移以符号锚点为准）先修计划再动手。
- **分支确认：当前在 `main`。未经主人明确同意不得在 main 直接实现；默认先开特性分支（如 `feat/0.9.50-readme-fallback-ladder`），合并策略听主人安排。**
- 按任务顺序执行，不无声跳步/合并/改目标；每任务完成即跑该任务定义的验证。
- **全量基线**：第一次跑全量前先记录基线失败集合，以当场实测为准（历史参考：0.9.33–0.9.45 曾记录 Windows 本机 symlink 族 15 项失败基线；0.9.49 实录 1185/1185 全绿——两次记录的环境差异未定论，不作假设），最终验证时对比要求「零新增失败」，不要求清零既有基线。
- 遇阻塞、重复失败或计划与仓库现实不符，立即停下说明，不猜。
- 全部任务完成后运行「最终验证」并输出修改摘要。

## 最终验证

- Run: `npm test`（= pretest build + `node --test tests/*.test.mjs` 全量；Windows PowerShell）
- Expected: 与开始前记录的基线对比**零新增失败**。
- Run: `npm run typecheck`
- Expected: 零错误。
- 计划外的发版后验收（不在本计划执行范围，登记待办）：经主人确认发版 0.9.50 → `dshm_upgrade` 装机 → 本机 desktop 打开 billion-context 详情 README 折叠页应显示 47,876 字符内容（而非红字）；web 侧（Linux 服务器，npmjs 路由）行为不变，由主人目视。

## 审阅 Checkpoint

- 计划正文结束后请求审阅；审阅通过前不进入实现。
- 本计划的默认执行方是普通编码 agent 或人工执行者；评审意见回灌后修改计划并重跑同一轮 inline 自检。

## 附录：评审处置记录

### Round 1（2026-10-07，评审 Agent 独立只读评审）

| # | 严重度 | 问题 | 处置 | 落点 |
|---|---|---|---|---|
| 1 | 建议 | Task 1 Step 2 红集合把用例 5 误判为红（404 挂在 /latest URL，现实现不发该请求，现状绿） | 接受 | 红集合改 {2,3,4,6,8,9}，绿集合含 1/5/7 并注明 5 的锁定语义 |
| 2 | 建议 | 精确 fetchCalls 断言未逐一写明显式 registry；用例 8 加长度断言需先补参 | 接受 + 细节修正 | 验证范围加「断言纪律」段；用例 2/3/4/6/8 逐一标注；**修正**：用例 2 缺省路径只做 `some()` 形态断言，不做精确索引（probe-once 混入，同文件 L401-402 注释自证） |
| 3 | **重要** | 兜底最坏时延 20s→40s 未评估；npmLatest L232 有首腿收紧先例 | 接受 | 腿1 超时 `Math.min(timeoutMs, 5_000)`（架构快照/Task 2 Step 1）；新增用例 9 以 `deps.fetchJsonLimited` spy 锁定两腿 timeoutMs；CHANGELOG/DESIGN 句带最坏时延 40s→25s；「风险与回退」节登记取舍 |
| 4 | 建议 | 腿1 readme 判空未写明与腿2 一致（trim 规则） | 接受 | 架构快照加「两腿 readme 判空同一规则」；用例 6 的 latest 体改空白 readme `'   '` 覆盖 |
| 5 | 建议 | 缺独立风险/回退说明 | 接受 | 新增「风险与回退」节（过程/版本/发版后三层回退 + 已知取舍） |

### Round 2（2026-10-07，同一评审线复核）

**处置判定**：问题 1–5 全部「已修改并复核通过」，0 反驳成立。修订新内容专项核查全部通过：红集合 {2,3,4,6,8,9} 逐用例对照现实现推演成立；用例 9 的 `deps.fetchJsonLimited` 注入缝实证可行（versions.ts:184/187 + httpx.ts:202-224 透传 timeoutMs，spy 索引天然免疫 probe 混入）；腿1 收紧对既有用例零破坏（fetchCalls 只记 URL）；「风险与回退」与执行纪律无冲突。**总体判定：可执行。**

**新问题（均建议级）**：

| # | 严重度 | 问题 | 处置 | 落点 |
|---|---|---|---|---|
| N1 | 建议 | 用例 9「缺省调用」措辞易误读为缺省 registry（真缺省会在无决策文件机器上触发真实网络 probe-once 并落盘，npm-route.ts:171-179）；spy 返回值未写明 | 接受 | 用例 9 改「缺省 timeoutMs（20_000）调用（显式传 registry，按断言纪律）」+「spy 每次调用返回 `{}`」 |
| N2 | 建议 | 用例 8 `fetchCalls.length === 2` 未写明重置时机——两次调用共享同一数组且现状无重置，末尾一次性断言红阶段恰好假绿（1+1=2）、Task 2 后反而红（2+2=4） | 接受 | 用例 8 写明「每次调用前置空 `fetchCalls = []`、调用后紧跟断言（或拆两个 it）」 |

### Round 3（终核）

2026-10-07，同一评审线只读终核：N1「已修改并复核通过」（用例 9 registry 歧义消除、spy 返回值 `{}` 已写明，与断言纪律及红集合推演无冲突；命中缺省 timeoutMs 同时显式传 registry/deps 需按位置传 `undefined`，属执行细节非计划缺陷）；N2「已修改并复核通过」（用例 8 重置时机已写明，红阶段逐调用 `length===1≠2` 为红、绿阶段 `===2`，无红绿反转；现状 fetchCalls 共享数组无重置的事实经 versions.test.mjs L30/L374-379 只读抽查证实）。**总体判定：可执行，进入实现。**

## 附录二：实施结果评审处置记录

### 实施评审 Round 1（2026-10-07，评审 Agent 独立只读评审执行结果）

**核验方式**：逐文件核对 git diff（10 改动文件）→ 程序化对比基线/终态日志失败集合 → 独立复跑（build exit 0、三文件 133/133、typecheck exit 0、独立全量 1194/1169/15/10）。**总体判断：达成计划目标**——Task 1-5 全部完成且实现正确；无虚报（执行方报称数字全部为真，失败集合三方对比一致）；无新增风险。

**问题（均建议级，源码零缺陷，全部文书级处置——本轮源码与测试零改动，无需重跑测试）**：

| # | 严重度 | 问题 | 处置 | 落点 |
|---|---|---|---|---|
| 1 | 建议 | package-lock.json 在计划文件清单外被改（仅版本字段 2 处） | 接受（文书补录） | 「文件结构与职责」补 package-lock.json 条目——版本 bump 机械伴随物，内容已核实无其它变化 |
| 2 | 建议 | 「主人同意在 main 直接实现」无法从工件核验 | 反驳成立（主人已在会话中明示批准）+ 文书留痕 | 「全局约束·分支确认」补主人 2026-10-07 批准记录 |
| 3 | 建议 | 计划文本矛盾：全局约束「不发版（commit 不在计划内）」vs Task 5 Step 5 checkpoint commit 未标可选 | 接受 | 「不发版」条明确 checkpoint commit 本轮统一不执行；Task 5 Step 5 补「可选，本轮统一不执行」 |
| 4 | 建议 | 两处措辞微差：测试标题「（0.9.50 语义修订）」vs 计划「（0.9.50）」；profileName 用例 describe 归属与计划措辞不同 | 接受（计划对齐 as-built） | Task 4 Step 1 标题改 as-built；Task 3 Step 1 写明 as-built describe 归属 |

**技术观察（非缺陷，评审自判可接受；按「计划外改动只记录不实施」纪律登记）**：leg1 catch 无差别吞错（含 AbortError）落 leg2——signal 已中止时 leg2 必以终末腿错误抛出，符合「两腿全败抛终末腿」语义。未实施任何加固。

### 实施评审 Round 2（2026-10-07，同一评审线复核）

**处置判定**：问题 1/3/4「已修改并复核通过」（lock diff 实测恰 2 处、两处矛盾落点逐字核对、as-built 对齐经 tests/host-api.test.mjs:294 与 installed.test.mjs:148/227 实证）；问题 2「反驳被接受」（三点依据：会话内事实不可 git 核验、未走特性分支备选的行为旁证自洽、未借机扩大授权）。技术观察登记描述与源码事实（versions.ts:209/221）一致，维持非缺陷自判。附录二转述保真。**终局判定：实现结果达成计划目标，可进入发版确认流程。**

**新问题**：

| # | 严重度 | 问题 | 处置 | 落点 |
|---|---|---|---|---|
| F1 | 建议 | 同源残留：「文件结构与职责」L52 仍写「README describe 内」，与 L113 as-built 声明（无独立 README describe）相抵——问题 4 处置只覆盖 Task 3 Step 1 | 接受 | L52 改「'partial 语义与特殊 key' describe 内（as-built，见 Task 3 Step 1）」 |

### 实施评审 Round 3（终核）

2026-10-07，同一评审线只读终核：F1「已修改并复核通过」——L52 修订与 Task 3 Step 1、tests/installed.test.mjs 实况（L148 describe、L227 用例、L236-244 的 0.9.49 五形态独立 describe）三方一致，无独立 README describe 的陈述经全文件 4 个 describe 清点证实；附录二 Round 2 记录与 F1 行如实（lock 恰 2 处、as-built 标题逐字在位等旁证抽查全过）；无新矛盾（installed.ts 未装 throw 实际 L296 vs 计划锚 L295 系 HEAD 参照下的一行漂移，非本轮引入）。**终局判定维持：实现结果达成计划目标，可进入发版确认流程；实施评审线关线。**
