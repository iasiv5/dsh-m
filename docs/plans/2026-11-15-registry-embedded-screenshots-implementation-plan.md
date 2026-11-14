# registry 内嵌截图（精选截图主源迁移）实施计划

## 目标

- 精选清单（registry.json）新增可选 `screenshots` 字段（作者仓库相对路径数组），成为精选详情弹窗截图条的**主数据源**：内嵌在场即零网络出图，修复受限网络机器（raw/jsDelivr 直连双被 reset 的 desktop 实录）上「精选详情恒无截图」。
- 既有作者 manifest 双腿抓取链（ADR-0015）**保留为缺席兜底**，不退役、行为不变。
- 配套交付：同步脚本（CDN 两腿拉作者 manifest 写回清单）、validate-registry 漂移 warn、首批内嵌数据、ADR-0015 修订段、DESIGN/GLOSSARY/CONTRIBUTING 文档同步。
- **非目标**：发版（`npm run release`）、CHANGELOG、README——发版另走战役且需当轮批准；客户端（`src/client/`）零改动；GitHub Actions 定时同步列为后续可选，本期不做。

## 架构快照

- 数据流变为两层：`entry.screenshots`（策展同步的内嵌路径，随清单/npm 包内快照通道分发）为主源；`primary-screenshots` Host method 命中内嵌字段即以 `raw.githubusercontent.com/<owner>/<repo>/HEAD/<path>` 解析返回、**不调用** manifest reader；字段缺席才走既有 raw→jsDelivr manifest 双腿链。
- 图片本身仍由客户端 webview 经既有图片加载链（weserv 优先）投递——本计划只换「路径清单从哪来」，不碰图片投递。
- **G4 冻结面达成机制（评审 F5 设计变更）**：`toMarketItem`（`src/core/market.ts` L539 对 RegistryEntry 整条 spread）改为解构剥除 `screenshots`——内嵌相对路径在数据层就不进市场列表响应；社区旁路分支（L556 显式赋值，URL 语义）不动；market-golden 增补带 screenshots 夹具变体永久钉死。
- 依据（2026-11-14/15 实测与判例）：① 本机 raw 与 cdn.jsdelivr.net 直连均 ECONNRESET，走系统代理则 200——manifest 是全 GUI 唯一单源 GitHub 运行时抓取点；② ADR-0036 修订三（R10）确立「时有时无的装饰性字段不值得持续消耗额度与故障面；免抓取、任何用户机器行为一致」；③ registry 默认链含包内快照兜底（`src/core/registry.ts` `bundledSnapshot()`），registry 数据已被证明可经 npm 通道到达任何装机；④ ADR-0025 确立「清单声明元数据、缺席不硬造、非法整份拒绝」先例。
- 兼容语义：`validateRegistry` 对未知字段整份拒载（`src/core/registry.ts` L254/L276 未知字段检查）——带 `screenshots` 的清单被**旧版本 dsh-m** 拒载后回落本地缓存/包内快照（各版本 schema 配对，安全；与 icon/decoupled/audience 同一演化路径）。自定义清单使用该字段需 dsh-m ≥ 本计划落地后的实装版本。

## 全局约束

- **客户端零改动**：`src/client/**` 不允许出现在 diff 中；`MarketItem`、市场列表响应、收藏快照、Agent 工具（`dshm_search` 输出）、CLI 输出一律不携带 screenshots（ADR-0015「不进 MarketItem」约束继续成立）。**达成机制 = `toMarketItem` 解构剥除（新 Task 5 红测钉死）+ market-golden 夹具变体**。边界清点（评审 F6，方案 A 已审采纳）：`registry` Host method 响应（`snap.loaded.registry.plugins` 整包）**携带**内嵌字段——registry 产物=主数据，唯一客户端消费者 settings-tab 忽略未知字段、无持久化面；若主人要求该响应也零携带，改 Task 4 同款剥除即可（升级为方案 B）。
- **GitHub 运行时零新增调用**（R10 精神）：同步与校验只允许 `raw.githubusercontent.com` 与 `cdn.jsdelivr.net` CDN 抓取（无 API 额度概念），禁 `api.github.com`。
- **registry.json 紧凑单行风格**（`tests/registry-format.test.mjs` 门禁）：字段一律单行、数组同行闭合（样例 `"tags": ["市场","插件管理"],`）；同步脚本必须外科手术式行编辑，禁止 `JSON.parse → JSON.stringify(, null, 2)` 整库重排。
- **CRLF/源锚纪律**（`docs/CODING-STANDARDS.md` 测试锚纪律 §3）：源串锚禁含 `\n`；行号锚写入时已复核（本文行号为 2026-11-15 会话时点参考，消费以符号锚优先）。
- 同机禁并发双全量 `npm test`（仓库 AGENTS.md 实录纪律）；本机测试有既有失败清单（know-how 028 §4），回归判别用 `node scripts/test-baseline.mjs`，不手搓管道对照。
- 版本/依赖：无新增 npm 依赖；Node ≥ 22.19（engines 既有）；无额外平台约束。

## 输入工件

- 设计共识：/grill-with-docs 九点决议（2026-11-15，主人逐条确认）：内嵌主源 / 相对路径形态 / 独立同步脚本+收录时手工补充 / 内嵌权威+manifest 兜底 / 全套对齐校验（≤8、复用 manifest 路径规则、需 github、整份拒绝）/ ADR-0015 文内修订段 / 无 manifest 保留+warn / validate 漂移 warn / 本计划即交付物。
- 判例与先例：`docs/adr/0015-primary-screenshot-manifest.md`（被修订对象）、`docs/adr/0025-icon-resolution-chain.md`（声明式先例）、`docs/adr/0036-catalog-stats-alignment.md` 修订三（R10 退役判例）。
- 实测证据：本会话探针 `.dsh-research/skinprobe/probe-manifest-legs.mjs`（undici 两腿直连 ECONNRESET ×2；curl 走系统代理 200）。

## 文件结构与职责

- Modify: `src/core/primary-screenshots.ts` —— 新增导出纯函数 `screenshotPathError`（自 `screenshotUrl` 提取的路径规则单一事实源）与 `resolveEmbeddedScreenshotUrls`（github+路径 → raw HEAD URL 数组）；既有 reader/缓存/双腿链零行为变化。
- Modify: `src/core/registry.ts` —— `ENTRY_KEYS`（L225）加 `screenshots`；`RegistryEntry`（L40）加可选字段；`validateRegistry` 条目校验块（github 解析之后）新增 screenshots 校验；import 上述两个导出。
- Modify: `src/core/host-api.ts` —— `case 'primary-screenshots'`（L502）内嵌命中分支：字段在场非空 → resolver 直返，不调 reader。
- Modify: `src/core/market.ts` —— `toMarketItem`（L537-539）解构剥除 `screenshots`（G4 冻结面，评审 F5）；社区旁路分支（L556）不动。
- Create: `scripts/sync-registry-screenshots.mjs` —— CDN 两腿拉作者根 `screenshots.json`，外科手术式写回 registry.json；导出纯函数 `applyScreenshotsEdits` 与 `fetchAuthorScreenshotPaths` 供测试与 validate 复用。
- Modify: `scripts/validate-registry.mjs` —— 联网段追加 screenshots 漂移 warn（fail-open，warn 不 fail，`--offline` 跳过）。
- Modify: `registry.json` —— 首批内嵌数据（跑同步脚本落盘，逐行 diff 归因）。
- Test: `tests/primary-screenshots.test.mjs`（追加两个 describe：screenshotPathError 契约、resolveEmbeddedScreenshotUrls 契约）
- Test: `tests/registry.test.mjs`（追加 describe：validateRegistry screenshots 校验）
- Test: `tests/host-api.test.mjs`（追加用例：内嵌在场即权威、不调 reader）
- Test: `tests/market.test.mjs`（追加用例：带 screenshots 的 registry 条目 → listMarket item 无该键）
- Test: `tests/market-golden.test.mjs`（夹具变体：带 screenshots 条目 → golden 快照钉死剥除）
- Test: `tests/sync-screenshots.test.mjs`（新建：applyScreenshotsEdits 行手术纯函数套件）
- Modify: `docs/DESIGN.md`（§2.1 句、§2.2 字段行、§2.5 目录适配层句、§2.6 详情段）
- Modify: `docs/adr/0015-primary-screenshot-manifest.md`（头部状态注记 + 文末决策修订段）
- Modify: `GLOSSARY.md`（新增「内嵌截图」词条；修「缺口直查」star 残留）
- Modify: `CONTRIBUTING.md`（§4 可选字段清单加 `screenshots` + 作者指引一句）

## 行为零变化承诺（CODING-STANDARDS 必填格）

| 面 | 未内嵌条目（含第三方自定义清单） | 内嵌条目 |
|---|---|---|
| 列表卡 / 已装页 / 收藏 / Agent 工具 / CLI | 逐字节不变 | 逐字节不变——内嵌 screenshots 经 `toMarketItem` 解构剥除不进 MarketItem（T5 红测 + golden 变体钉死），仅 `primary-screenshots` method 返回；`registry` method 响应携带属 F6 方案 A 已审边界（settings-tab 忽略未知字段） |
| 详情弹窗截图条 | manifest 双腿链行为逐字节不变（含 10min/60s 缓存、负缓存、超时上限） | 数据源 manifest → 内嵌字段：desktop 受限网络从「无图条」变「有图条」；webview 图片加载链不变；灯箱/坏图剔除行为不变 |
| 清单校验 | 不带新字段的清单判定不变 | 新字段严格校验：非法值整份拒载（icon 同款纪律） |
| 老版本 dsh-m × 新清单 | — | 未知字段整份拒载 → 回落本地缓存/包内快照（既有演化路径，非新增风险面） |

---

### Task 1: primary-screenshots.ts 提取导出 `screenshotPathError`

- 目标：把 `screenshotUrl`（`src/core/primary-screenshots.ts` L66-77）内的路径合法性检查提取为导出纯函数，成为路径规则的单一事实源；`screenshotUrl` 行为零变化。
- 涉及文件：Modify `src/core/primary-screenshots.ts`；Test `tests/primary-screenshots.test.mjs`
- 接口契约
  - Consumes: 无（纯重构，既有常量 `CONTROL_RE` 就地复用）
  - Produces: `export function screenshotPathError(rawPath: unknown): string | null`——返回 `null` = 合法；返回非空中文错误串 = 违规。规则逐字对齐现行 `screenshotUrl`：非字符串/trim 后空串、控制字符（`\u0000-\u001f\u007f`）、以 `/` 或 `\` 开头、含 `\`、协议形 `^[a-z][a-z\d+.-]*:`i、`//` 开头、含 `?`/`#`、段含空串/`.`/`..` → 违规。合法时返回 `null`（trim 语义：检查与返回值均基于 trim 后形态）。

- [ ] Step 1: 写失败测试——在 `tests/primary-screenshots.test.mjs` 追加 `describe('screenshotPathError：manifest 路径规则单一事实源', ...)`：import 该导出；用例：`'docs/a.png'`→null；`'a b.png'`→null（空格合法）；`''`→违规；`42`/`null`→违规；`'/abs.png'`、`'..\\x.png'`、`'a\\b.png'`、`'//x.png'`、`'https://x/y.png'`、`'a?b.png'`、`'a#b.png'`、`'a/./b.png'`、`'a/../b.png'`、含 `\u0007` → 各自违规。
- Run: `npm run build && node --test tests/primary-screenshots.test.mjs`
- Expected: 红——`SyntaxError: The requested module '../lib/core/primary-screenshots.js' does not provide an export named 'screenshotPathError'`（新增锚 HEAD=0，基线对表通过）
- [ ] Step 2: 运行并确认失败
- Run: 同上
- Expected: 同上（导入期失败即红）
- [ ] Step 3: 写最小实现——在 `screenshotUrl` 上方实现 `screenshotPathError`（检查逻辑与顺序从 `screenshotUrl` 原样搬移，返回 `string | null`）；`screenshotUrl` 改为：`const problem = screenshotPathError(rawPath); if (problem) return null; const path = (rawPath as string).trim()` 后继续既有 URL 构造。
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/primary-screenshots.test.mjs`
- Expected: 全绿（既有 parseManifest/reader 用例一并绿 = `screenshotUrl` 行为零变化自证）
- [ ] Step 5: checkpoint commit（可选）：`feat(core): screenshotPathError 导出——manifest 路径规则单一事实源`

### Task 2: primary-screenshots.ts 导出 `resolveEmbeddedScreenshotUrls`

- 目标：内嵌路径 → 图片 URL 的唯一解析器（宿主 API 与测试共用）。
- 涉及文件：Modify `src/core/primary-screenshots.ts`；Test `tests/primary-screenshots.test.mjs`
- 接口契约
  - Consumes: 模块内既有 `repoSlug()`、`rawManifestUrl()`、`screenshotUrl()`（Task 1 后形态）
  - Produces: `export function resolveEmbeddedScreenshotUrls(github: string, paths: unknown[]): string[]`——`repoSlug` 不合法 → `[]`；否则以 `rawManifestUrl(slug)` 为基址逐条 `screenshotUrl`，剔除 `null`，保持声明顺序。

- [ ] Step 1: 写失败测试——`tests/primary-screenshots.test.mjs` 追加 `describe('resolveEmbeddedScreenshotUrls：内嵌截图主源解析器', ...)`：`('iasiv5/dsh-m', ['docs/a.png', 'shot b.png'])` → `['https://raw.githubusercontent.com/iasiv5/dsh-m/HEAD/docs/a.png', 'https://raw.githubusercontent.com/iasiv5/dsh-m/HEAD/shot%20b.png']`（顺序保持）；`('not-a-slug', ['a.png'])` → `[]`；`('iasiv5/dsh-m', ['../evil.png', 'ok.png'])` → 只有 `ok.png` 的 URL；`('iasiv5/dsh-m', [])` → `[]`。
- Run: `npm run build && node --test tests/primary-screenshots.test.mjs`
- Expected: 红——缺导出 `resolveEmbeddedScreenshotUrls`（HEAD=0 基线对表）
- [ ] Step 2: 运行并确认失败
- Run: 同上
- Expected: 同上
- [ ] Step 3: 写最小实现——导出该函数（≤12 行，纯组合）。
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/primary-screenshots.test.mjs`
- Expected: 全绿
- [ ] Step 5: checkpoint commit（可选）：`feat(core): resolveEmbeddedScreenshotUrls——内嵌截图主源解析器`

### Task 3: registry schema 增补 `screenshots` 字段

- 目标：清单 schema 接受可选 `screenshots`（字符串数组，1..`PRIMARY_SCREENSHOT_LIMIT` 条，条目必须带 `github`，路径规则复用 `screenshotPathError`，非法整份拒绝），值流入校验产物。
- 涉及文件：Modify `src/core/registry.ts`；Test `tests/registry.test.mjs`
- 接口契约
  - Consumes: Task 1 的 `screenshotPathError`、既有 `PRIMARY_SCREENSHOT_LIMIT`（=8，`src/core/primary-screenshots.ts` L193 导出）、`validateRegistry` 条目校验结构（`src/core/registry.ts` L268-366：`entryGithub` 于 L329-341 解析）
  - Produces: `RegistryEntry.screenshots?: string[]`（校验产物携带 trim 后字符串数组）；供 Task 4（host 分支）、Task 5（脚本写入目标形态）、Task 7（validate 读取）

- [ ] Step 1: 写失败测试——`tests/registry.test.mjs`（fixture `entry()` L32、`reg()` L45）追加 `describe('validateRegistry：screenshots 内嵌截图（ADR-0015 修订）', ...)`：
  - 红灯主用例（HEAD=0 时唯一会红的一条）：`validateRegistry(reg([entry({ github: 'iasiv5/dsh-m', screenshots: ['docs/a.png'] })])).ok === true`，且 `parsed.registry.plugins[0].screenshots` 深等于 `['docs/a.png']`——当前因「未知字段」整份拒绝，期望 true 实得 false。
  - 护栏用例（当前即绿——未知字段兜底使其恒 false，实现后须仍绿且**错误信息**变化）：无 github 拒（错误含 `需要条目携带 github`）；`[]` 拒（错误含 `至少 1 条`）；9 条拒（错误含 `超过 8 条`）；非数组拒；路径非法逐类拒（`/abs`、`a/../b`、`a?b`，错误含 `screenshots[0]`）；合法 8 条过。
  - 注意：护栏用例断言**错误消息子串**（如 `screenshots[0]`），当前阶段它们因「未知字段」整份拒而 ok:false——先只断言 `ok===false` 的用例两头都绿，**消息断言用例在 Step 3 实现后必须全部绿**；红灯语义只认主用例。
- Run: `npm run build && node --test tests/registry.test.mjs`
- Expected: 红——主用例 `assert.equal(...ok, true)` 失败（实为 false，未知字段 `plugins[0].screenshots: 未知字段`）
- [ ] Step 2: 运行并确认失败
- Run: 同上
- Expected: 同上
- [ ] Step 3: 写最小实现——三处：① `ENTRY_KEYS`（L225）加 `'screenshots'`；② `RegistryEntry`（L40-63）加 `screenshots?: string[]` 带注释（策展内嵌截图主源，ADR-0015 修订）；③ import `{ screenshotPathError, PRIMARY_SCREENSHOT_LIMIT } from './primary-screenshots.js'`，在 source 必填检查（L343-344）之后插入校验块：非数组→`必须是字符串数组`；`length < 1`→`至少 1 条（空数组请直接省略字段）`；`> PRIMARY_SCREENSHOT_LIMIT`→`超过 N 条`；`entryGithub === undefined`→`需要条目携带 github（作者仓库相对路径的解析基址）`；逐项 `screenshotPathError` 非空→`${where}.screenshots[${pi}]: ${problem}`；全部通过时以 trim 后数组进入产物（`...(entryScreenshots !== undefined ? { screenshots: entryScreenshots } : {})`，与 homepage/icon 同款展开风格）。
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/registry.test.mjs`
- Expected: 全绿（含既有 describe 全部不红——加字段不改任何既有判定）
- [ ] Step 5: checkpoint commit（可选）：`feat(core): registry screenshots 内嵌截图字段（严格校验，需 github）`

### Task 4: host-api 内嵌命中分支（主源生效）

- 目标：`primary-screenshots` method 对内嵌条目直返解析 URL、零 reader 调用；缺席条目走既有 reader 路径不变。
- 涉及文件：Modify `src/core/host-api.ts`；Test `tests/host-api.test.mjs`
- 接口契约
  - Consumes: Task 2 `resolveEmbeddedScreenshotUrls`；既有 case 结构（`src/core/host-api.ts` L502-521：entry 查找 → `!entry || 无 github → {screenshots: []}` → `d.loadPrimaryScreenshots(entry.github)`）；测试侧 `setup()`（`tests/host-api.test.mjs` L84，`loadPrimaryScreenshots` 注入缝）、`writeRegistry()`（L183）、`primaryEntry()`（L189）
  - Produces: 无下游消费（叶子行为）

- [ ] Step 1: 写失败测试——`tests/host-api.test.mjs` 追加用例（放在既有 L283-334 primary-screenshots 用例组之后）：`primary-screenshots：内嵌 screenshots 在场即权威——解析直返且不调用 reader`。夹具 `writeRegistry([primaryEntry({ screenshots: ['docs/a.png', 'shot b.png'] })])`，`setup({ loadPrimaryScreenshots: async (github) => { seen.push(github); return ['https://attacker.example/should-not-be-used.png'] } }, { registryUrl: file })`；断言：`res.body.screenshots` 深等于 `['https://raw.githubusercontent.com/iasiv5/dsh-skins/HEAD/docs/a.png', 'https://raw.githubusercontent.com/iasiv5/dsh-skins/HEAD/shot%20b.png']`；`seen` 深等于 `[]`（reader 未被调用）。
- Run: `npm run build && node --test tests/host-api.test.mjs`
- Expected: 红——首因失败为 `res.body.screenshots` deepEqual（当前实现无内嵌分支，reader 被调用并返回 stub 的 attacker URL，实得值 ≠ 期望的 raw 解析 URL）；`seen` 深等于 `[]` 断言随后同红（评审 F2 采纳：两断言均红，首因是 deepEqual）
- [ ] Step 2: 运行并确认失败
- Run: 同上
- Expected: 同上
- [ ] Step 3: 写最小实现——`host-api.ts` import `resolveEmbeddedScreenshotUrls`（并入既有 `./primary-screenshots.js` import 行）；内嵌分支插在既有 `!entry || typeof entry.github !== 'string' || entry.github.trim() === '' → { screenshots: [] }` 早退检查**之后**、`try { payload = { screenshots: await d.loadPrimaryScreenshots(...) } }` **之前**：`if (Array.isArray(entry.screenshots) && entry.screenshots.length > 0) { payload = { screenshots: resolveEmbeddedScreenshotUrls(entry.github, entry.screenshots) }; break }`——此处 `entry.github` 已被早退检查收窄为 `string`（评审 F1 采纳：分支必须置于收窄之后，否则 `string | undefined` 入参在 tsconfig strict 下报 TS2345、build 门红）；附一行注释「内嵌主源 ADR-0015 修订，缺席落 manifest 兜底」。语义注记：带 screenshots 但无 github 的条目（schema 已拒绝，防御性场景）在此路径得 `{screenshots: []}`，与既有早退语义一致。
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/host-api.test.mjs`
- Expected: 全绿（既有三条 primary-screenshots 用例——reader 路径、缺 id/未知 id/无 github、reader 失败降级——全部不红 = 兜底路径零变化自证）
- [ ] Step 5: checkpoint commit（可选）：`feat(core): 精选截图主源迁移——内嵌字段在场即权威，manifest 降为缺席兜底`

### Task 5: market.ts 内嵌字段剥除（G4 冻结面，评审 F5）

- 目标：`toMarketItem` 不再把 RegistryEntry 的 `screenshots`（内嵌相对路径）spread 进 MarketItem——数据层堵死列表响应泄漏；社区旁路字段（URL 语义）行为零变化。
- 涉及文件：Modify `src/core/market.ts`；Test `tests/market.test.mjs`、`tests/market-golden.test.mjs`
- 接口契约
  - Consumes: Task 3 的 `RegistryEntry.screenshots`；`toMarketItem` 现状（`src/core/market.ts` L537-539 整条 spread、L549-564 社区分支 L556 显式赋值）；market 套件装置（`tests/market.test.mjs` `fakeDeps` L81 + `listMarket(cfg, opts, deps)` 调用形态）
  - Produces: G4 剥除保证——T6 数据落地与 T13 收口清点均依赖本断言

- [ ] Step 1: 写失败测试——`tests/market.test.mjs` 追加用例：按套件既有装置（`fakeDeps` + 既有 cfg/registry 夹具构造，参照首个基础 `listMarket` 用例）构造带 `screenshots: ['docs/a.png']` 的合法主清单条目（github 在场），断言响应精选 item **不含** `screenshots` 键（`'screenshots' in item === false`——「缺失不产生键」契约，不用 undefined 判等）。
- Run: `npm run build && node --test tests/market.test.mjs`
- Expected: 红——当前 L539 整条 spread 使 item 携带该键（HEAD=0 基线对表）
- [ ] Step 2: 运行并确认失败
- Run: 同上
- Expected: 同上
- [ ] Step 3: 写最小实现——L539 前解构剥除：`const { screenshots: _embeddedScreenshots, ...entryRest } = entry`，`const item: MarketItem = { ...entryRest, installed: Boolean(inst), outdated: false }`（解构-rest 剥除形态不触 noUnusedLocals；附注释「ADR-0015 修订：内嵌 screenshots 是 Host 详情 API 专属数据，不进 MarketItem」）；社区分支 L556 `item.screenshots = entry.screenshots` 逐字不动（CommunityEntry 的 URL 语义字段，解构后由本行显式回填，净效果不变）。
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/market.test.mjs && node --test tests/market-golden.test.mjs`
- Expected: 两套件全绿（社区条目 screenshots 与列表其余字段零变化自证）
- [ ] Step 5: golden 钉死——`tests/market-golden.test.mjs` 头部 `primary` 夹具数组（L37-42）增补一条带 `screenshots` 的变体条目，按套件头注再生成缝 `UPDATE_GOLDEN=1 npm run build && node --test tests/market-golden.test.mjs` 重生成（L7），diff 审查 `tests/fixtures/market-golden.json`：精选 item 无 screenshots 键、社区 item 键集不变。
- Run: `$env:UPDATE_GOLDEN='1'; npm run build; node --test tests/market-golden.test.mjs; Remove-Item Env:UPDATE_GOLDEN`（market-golden L7 头注为 bash 形态；本机 PowerShell 须 `$env:` 赋值并在收尾移除——评审 F13）后无 env 复跑 `node --test tests/market-golden.test.mjs`
- Expected: 再生成后（无 env）测试绿；此后任何把内嵌字段带进 MarketItem 的改动被 golden 拦截
- [ ] Step 6: checkpoint commit：`fix(core): toMarketItem 剥除内嵌 screenshots——G4 冻结面（评审 F5）`

### Task 6: 同步脚本 `scripts/sync-registry-screenshots.mjs`（行手术纯函数 + 主流程）

- 目标：按需从作者仓库 CDN 两腿拉根 `screenshots.json`，外科手术式写回 registry.json 的单行 `screenshots` 字段；无 manifest 时保留在场字段并 warn（主人 Q7 裁定：脚本只拾取不抹除）。
- 涉及文件：Create `scripts/sync-registry-screenshots.mjs`；Test `tests/sync-screenshots.test.mjs`（新建）
- 接口契约
  - Consumes: Task 1 `screenshotPathError`（`../lib/core/primary-screenshots.js`）；`fetchTextLimited`（`../lib/core/httpx.js`，跑前 `npm run build`）；registry.json 紧凑单行风格（单行形如 `      "tags": ["市场","插件管理"],`，条目块以 `      "id": "<id>"` 行定位）
  - Produces: `export function applyScreenshotsEdits(text, updates)`——`updates: Map<string, string[]>`（id → 路径数组），返回 `{ text, changed: string[], skipped: string[] }`；`export async function fetchAuthorScreenshotPaths(slug, fetchText)`——返回 `{ status: 'ok', paths }` | `{ status: 'missing' }`（404/双腿败/解析不合规） | `{ status: 'probe-failed', reason }`（网络层异常）；main（`import.meta.url` 直跑判定）写盘 + 摘要输出；`--dry-run` 只打印不写。validate-registry（Task 8）import `fetchAuthorScreenshotPaths`。
  - 行手术规则（applyScreenshotsEdits）：按行扫描定位 `"id": "<id>"` 行所在的条目块（`{` 起至配对 `}` 止，缩进 6 空格字段行）；块内已有 `"screenshots":` 行 → 原位替换；无 → 在 `"github": "…"` 行（必然存在，schema 保证）之后插入新行；新行形态 `      "screenshots": ["a.png","b.png"],`（紧凑无空格分隔，与 tags 同款；若插在块内最后一行前则保留后续行的尾逗号结构不变）；文件 EOL 风格（CRLF/LF）按原文件保持；块内找不到 github 行 → 该 id 进 `skipped`（不改写）。

- [ ] Step 1: 写失败测试——新建 `tests/sync-screenshots.test.mjs`（import 自 `'../scripts/sync-registry-screenshots.mjs'`）：① 无该字段条目插入（LF）；② 已有 screenshots 行原位替换（LF）；③ CRLF 输入 → CRLF 输出（逐行断言 `\r` 保持）；④ 无 github 行条目 → skipped 且 text 不变；⑤ 紧凑风格自证：输出中 `"screenshots": [` 行必须单行闭合（逐行**先剥 `\r` 再匹配**正则 `/"screenshots": \[[^\]]*\],?$/`——registry-format.test.mjs L17「先剥 \r 再判定」同款先例，防 CRLF 夹具下 `$` 锚恒不匹配）；⑥ changed/skipped 名单正确；⑦ 多条目混改（改一条、跳一条、其余条目字节不动）；⑧ `fetchAuthorScreenshotPaths` 三态分类（注入 `fetchText` 桩，scripts/registry-url-probe.mjs deps 注入同款先例）：raw 2xx+合规 → ok；raw 2xx+不合规 → missing；raw 404 + mirror 404 → missing；raw throw + mirror 2xx → ok；raw throw + mirror 404 → probe-failed；raw 404 + mirror throw → probe-failed；raw throw + mirror throw → probe-failed（评审 Round 3 建议采纳：双故障腿第七分支也钉进测试）。
- Run: `npm run build && node --test tests/sync-screenshots.test.mjs`
- Expected: 红——`ERR_MODULE_NOT_FOUND`（scripts 文件尚不存在；HEAD=0 基线对表）
- [ ] Step 2: 运行并确认失败
- Run: 同上
- Expected: 同上
- [ ] Step 3: 写最小实现——脚本骨架：头部注释（用途/用法/`--dry-run`/退出码 0=成功含 warn、1=registry 读取或写盘失败）；`applyScreenshotsEdits` 纯函数；`fetchAuthorScreenshotPaths(slug, fetchText)` 三态（两腿 URL 模板与 `src/core/primary-screenshots.ts` L54-64 逐字同源，各腿 5s 超时 `fetchTextLimited`；**腿结果分类：2xx=成功、HTTP 404=权威缺席腿、HTTP 5xx/其它 4xx=故障腿、网络层 throw=故障腿。状态判定按腿结果——评审 F3 采纳，废除「双腿皆败」笼统归类**：raw 2xx → 解析分级（JSON 解析失败/非字符串数组/任一路径 `screenshotPathError` 非空/条数 >8/空数组 → `missing`＝不合规权威缺席，与运行时 parseManifest 同判；合规 → `{status:'ok', paths}`）；raw 404 → 落 mirror 腿（mirror 2xx → 同上解析分级；mirror 404 → `missing`；mirror 故障 → `probe-failed`）；raw 为故障腿 → 落 mirror 腿（mirror 2xx → 解析分级；mirror 404 或故障 → `probe-failed`，reason=末腿错误——raw 不可达时 mirror 404 不能证伪作者文件存在性，保守归探测失败））；main：读 `registry.json`（`JSON.parse` 取 plugins 仅取值，写回走行手术）→ 逐条 `github` 在场者探测 → `ok` 收进 updates；`missing` 且字段在场 → 保留现值 + `console.warn('⚠ <id> 作者仓库无 manifest（权威 404/不合规），保留清单现值——删除需人工')`，`missing` 且字段缺席 → 静默；`probe-failed` → 逐条 `console.warn('⚠ <id> 探测失败（网络层）：<reason>——检查代理 env（HTTPS_PROXY）后重跑')`；`applyScreenshotsEdits` → dry-run 打印摘要（changed/skipped + 每条目路径数）否则写盘（同 EOL）→ 末行汇总 `变更 N 条 / 探测到 manifest M 条 / 权威缺席 A 条 / 网络失败 K 条`（四计数落 stdout——K>0 肉眼可见，代理失效不再静默零变更，评审 F3 生效判据可观测要求）。
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/sync-screenshots.test.mjs`
- Expected: 全绿
- [ ] Step 5: checkpoint commit（可选）：`feat(scripts): registry screenshots 同步脚本（CDN 两腿 + 行手术写回）`

### Task 7: 首批内嵌数据落地（联网，CDN）

- 目标：对现行 37 条精选清单跑同步，落盘首批内嵌数据（dsh-m、dsh-skins 等带 manifest 的条目自动拾取）。
- 涉及文件：Modify `registry.json`（仅脚本写回）
- 接口契约
  - Consumes: Task 6 脚本；本机可用代理（fetchTextLimited 读 env 代理——desktop Windows 机直连 CDN 被墙，须 `$env:HTTPS_PROXY='http://127.0.0.1:7890'`；或移步 web 机跑）
  - Produces: registry.json 中带 screenshots 的条目集；Task 8 漂移检查的基线

- [ ] Step 1: 改动前观察——`git -C dsh-m status --short` 确认工作树干净（registry.json 无未提交改动）；`node scripts/validate-registry.mjs --offline` 当前全绿（基线留证）。
- Run: `git status --short` + `node scripts/validate-registry.mjs --offline`
- Expected: 干净树 + 校验零错误
- [ ] Step 2: 跑同步（真实网络）——`$env:HTTPS_PROXY='http://127.0.0.1:7890'; node scripts/sync-registry-screenshots.mjs --dry-run` 先看摘要，再去掉 `--dry-run` 落盘。
- Run: 见上（PowerShell）
- Expected: 摘要列出 changed 条目（至少 dsh-m；探测不到的条目进静默/warn 名单，不报错）
- [ ] Step 3: diff 归因审查——`git diff registry.json`
- Expected: 每个 hunk 都是单个条目块内新增/替换的单行 `"screenshots": [...]`；无其它字段变动、无整库重排（行级 diff 与 changed 名单一一对应）
- [ ] Step 4: 落盘后校验
- Run: `node scripts/validate-registry.mjs --offline` + `npm run build && node --test tests/registry.test.mjs tests/registry-format.test.mjs tests/registry-icon-url.test.mjs`
- Expected: validate 全绿（新字段通过严格校验）；三套件全绿（紧凑单行风格与 icon 守卫不被新行破坏；行数线性上界 16N+12 仍满足）
- [ ] Step 5: checkpoint commit：`registry: 首批 screenshots 内嵌数据（同步脚本拾取）`

### Task 8: validate-registry 漂移 warn（联网段）

- 目标：联网校验时对内嵌条目做「清单值 vs 作者 HEAD manifest」漂移检查；probe 失败 fail-open 跳过；漂移只 warn 不 fail；`--offline` 整段跳过。
- 涉及文件：Modify `scripts/validate-registry.mjs`
- 接口契约
  - Consumes: Task 6 `fetchAuthorScreenshotPaths`（`import { fetchAuthorScreenshotPaths } from './sync-registry-screenshots.mjs'`——脚本间 import 先例：release.mjs → release-lock.mjs）；既有 warn 形态（`console.warn('⚠ ...')` + `warned` 标志，L39-84 先例）；`OFFLINE` 标志（L18）
  - Produces: 无

- [ ] Step 1: 写改动前检查——确认插入点：联网段既有检查之后、最终汇总（L207 `if (warned)`）之前；`--offline` 分支已整体跳过网络段（读脚本头部 L3-4 用法注释确认）。
- Run: `node scripts/validate-registry.mjs --offline`
- Expected: 绿且无任何漂移段输出（跳过自证）
- [ ] Step 2: 实现漂移段——`if (!OFFLINE)` 内：对带 `screenshots` 且带 `github` 的条目逐条 `fetchAuthorScreenshotPaths`；`probe-failed` → `console.warn('⚠ <where> screenshots 漂移检查跳过（网络，fail-open）：<reason>——检查代理 env 后重跑')`（评审 F3 采纳：受限网络误报「作者删了 manifest」被禁止，网络失败只说网络）；`missing` → 静默跳过（权威 404/不合规 = 可核证集为空，手抄条目不产噪音）；`ok` 且路径数组与清单值不相等（含顺序）→ `console.warn('⚠ <where> screenshots 与作者 HEAD manifest 漂移——重跑 scripts/sync-registry-screenshots.mjs 同步')`；一致 → 静默。
- Run: `npm run build && node scripts/validate-registry.mjs --offline`
- Expected: 构建零错（脚本 import 链含 lib/core 与 sync 脚本）；offline 段无任何漂移检查输出
- [ ] Step 3: 三态验证——① 同步后联网跑：`$env:HTTPS_PROXY='http://127.0.0.1:7890'; node scripts/validate-registry.mjs` → 零漂移 warn、整体绿；② 变异点单点验证：临时把 registry.json 中 dsh-m 条目 screenshots 的一个字符改坏 → 联网跑 → 出现 `⚠ plugins[0] screenshots … 漂移` → `git checkout -- registry.json` 还原 → 复跑 → 零 warn（变异可红可绿即锚有效；还原后 `git status` 干净）。
- Expected: ①③ 零漂移 warn；② 变异态必现 warn
- [ ] Step 4: checkpoint commit：`feat(scripts): validate-registry screenshots 漂移 warn（CDN、fail-open、--offline 跳过）`

### Task 9: DESIGN.md 增补（五处，评审 F7/F9/F10）

- 目标：设计文档与新主源语义一致。
- 涉及文件：Modify `docs/DESIGN.md`
- 接口契约
  - Consumes: §2.1 严格 schema 句（L21）、§2.2 字段区（L27-51）、§2.5 目录适配层句（L74「Primary 截图另按 §2.6 从作者仓库读取，不进入 MarketItem」）、§2.6 详情 Modal 段（L94）
  - Produces: 无

- [ ] Step 1: §2.1 L21 句——v1.1 增补可选字段清单追加 `screenshots`。
- [ ] Step 2: §2.2 **两处**（评审 F10）——规则清单区（L29-34，`homepage`/`icon` 行附近）加一行：`screenshots`: 可选；作者仓库相对路径数组（1..8，紧凑单行）；策展内嵌截图主源，宿主直返、零运行时抓取；需条目携带 `github`；缺席时详情截图条按 §2.6 走作者 manifest 兜底。jsonc 示例（L35-53，`"icon"` 行 L51 附近）加示例字段行带行内注释。
- [ ] Step 3: §2.5 L74 句改写——「Primary 截图另按 §2.6 从作者仓库读取」→「Primary 截图优先取条目内嵌 `screenshots`（策展同步，ADR-0015 修订），缺席才按 §2.6 从作者仓库读取；两者都不进入 MarketItem」。
- [ ] Step 4: §2.6 L94 详情段——截图灯箱括注后追加一句：截图条主源=条目内嵌 `screenshots`（零运行时抓取），manifest 为缺席兜底（0.9.77 链保留）。
- [ ] Step 5: §2.6 **L95「详情截图来源」权威段增补修订标注（评审 F7）**——段内「Primary DetailModal 调 GUI Host method…」句前插修订括注：`**修订（2026-11-15，ADR-0015 决策修订）**：Primary 截图主源 = 条目内嵌 \`screenshots\`（策展同步、零运行时抓取）；本段描述的 manifest 懒读降为字段缺席兜底；「不进入 MarketItem、市场 localStorage 快照、收藏快照、Agent 工具或 CLI」禁令保持，达成机制 = toMarketItem 解构剥除。`
- Run: `git diff docs/DESIGN.md` 逐 hunk 归因 + 人工读回复核（文档任务验证 = 内容在场 + 引用不断裂）
- Expected: 五处增补在场，无其它段落变动

### Task 10: ADR-0015 修订段

- 目标：反决策入档（house style：文内修订段，不开新编号）。
- 涉及文件：Modify `docs/adr/0015-primary-screenshot-manifest.md`
- 接口契约
  - Consumes: 决策 2（L21 raw manifest 读取）与决策 1（L20）文本位置；ADR-0036 修订三（R10）三原则；本会话实测证据
  - Produces: 被后续文档（GLOSSARY/CONTRIBUTING）引用的「ADR-0015 修订（2026-11-15）」提法

- [ ] Step 1: 标题下状态行后追加引用块：`> 2026-11-15 修订：Primary 截图主源迁移至 registry 内嵌 screenshots 字段（见文末「决策修订」）；本条第 2 款「按需读取作者 manifest」降级为字段缺席时的兜底，机制不变；原「考虑过的选项」第 1 条由否决转采纳、决策 6 的 RegistryEntry 禁令由本修订取代（均见修订段，评审 F8）。`
- [ ] Step 2: 文末追加 `## 决策修订（2026-11-15，registry 内嵌主源）`——内容五小节：动机（受限网络机器 raw+jsDelivr 双腿直连 ECONNRESET 实录；R10 三原则：免抓取/机器行为一致/装饰性字段不为新鲜度付持续故障面；registry 包内快照通道已被证明可达任何装机）；**对原文两处的翻转（评审 F8）**（① 考虑过的选项第 1 条「registry 内嵌——未采纳」转采纳：其反对理由①「每次改图同步两份清单」由策展同步脚本降为单一动作、理由②「防止市场响应快照持久化这些 URL」由 toMarketItem 解构剥除解除——该泄漏形态 ADR 当年已预言、本轮评审 F5 实证；② 决策 6「不加入 RegistryEntry/MarketItem」——RegistryEntry 禁令由本修订取代（内嵌字段进清单=策展主源），MarketItem 禁令保持并机械化为 golden 钉死）；决策（schema 可选字段、内嵌权威、manifest 兜底、sync 脚本 CDN 同步、validate 漂移 warn）；被否决的替代（镜像条目 join：modal 层加载社区目录违反本 ADR 划界且连坐收藏快照；客户端侧抓取：绕开宿主安全基线且行为随 webview 代理漂移；纯 manifest 维持：受限网络恒空）；后果（老版本未知字段拒载回落包内快照；策展冻结语义 = 作者运行时改图不再穿透精选弹窗；后续可选项 = GitHub Actions cron 每日 sync 漂移开 PR，本期不做）。
- Run: 人工读回复核 + `git diff docs/adr/0015-primary-screenshot-manifest.md`
- Expected: 引用块 + 修订段在场，原文其余段落逐字不动

### Task 11: GLOSSARY 词条与修订

- 目标：领域词汇对齐新主源；顺手修既有漂移。
- 涉及文件：Modify `GLOSSARY.md`
- 接口契约
  - Consumes: 「缺口直查」词条（L379-381，现文仍含「与 GitHub star」——R10 已整链退役，属词条落后决议一轮）；「图片加载链」「图标解析链」相邻词条的行文风格
  - Produces: 「内嵌截图」术语供后续文档/评审引用

- [ ] Step 1: 新增词条（插在「图标解析链」之后——与图片加载链/图标解析链同簇，GLOSSARY 非字母序、按主题聚簇排布，评审 F12 措辞修正）：**内嵌截图（Embedded Screenshots）**：收录条目携带的作者仓库相对路径数组（1..8），策展同步写入、随清单（含包内快照）分发的截图主源；详情弹窗命中即零运行时抓取；缺席条目回退作者 manifest 兜底。`_Avoid_: 截图清单（指作者仓库那份兜底文件）、截图同步（那是动作不是数据）`
- [ ] Step 2: 修「缺口直查」：删「与 GitHub star」**一处**残留（L380，grep 全文唯一命中——L376 的 downloadsStart 为字段名误中不涉；评审 F11 计数修正），改为「对 npm bulk 下载量的直接拉取」（对齐 R10：gh star 直查整链退役；star 唯一来源是上游目录镜像）。
- Run: 人工读回复核（词条互引一致：主清单/图片加载链/镜像条目条目与新词条无冲突）
- Expected: 两处变动在场，其余词条不动

### Task 12: CONTRIBUTING 作者指引

- 目标：收录政策文档告知作者 screenshots.json 通道与字段语义。
- 涉及文件：Modify `CONTRIBUTING.md`
- 接口契约
  - Consumes: §4 可选字段清单句（L105「可选字段（`alsoCategories` / `decoupled` / `audience` / `verified` / `icon`）的语义见 DESIGN §2.2」）
  - Produces: 无

- [ ] Step 1: L105 可选字段清单加 `screenshots`；紧随其后补一句：想被展示截图的插件作者，在仓库根维护 `screenshots.json`（顶层字符串数组，仓库相对路径，≤8 条）即可——收录后同步脚本会自动拾取；自定义清单使用 `screenshots` 字段需 dsh-m ≥ 本字段实装版本（旧版本会因未知字段整份拒载）。
- Run: 人工读回复核
- Expected: 一处变动在场，与 DESIGN §2.2 行文一致

### Task 13: 收口全量验证

- 目标：全仓库门禁与文档一致性终验。
- 涉及文件：无新改动（只验证）
- 接口契约
  - Consumes: 前 12 个任务全部合入

- [ ] Step 1: 全量测试与类型检查（本机 PowerShell；错开其它全量会话）——`npm test`（pretest build + lint + 全测试）；`npm run typecheck`
- Expected: `npm test` 失败集 ⊆ know-how 028 §4 既有失败清单（如有出入，跑 `node scripts/test-baseline.mjs` 结构化对照定谳）；typecheck 零错误
- [ ] Step 2: 客户端零改动与 G4 冻结面自证——`git diff --stat` 输出中不得出现 `src/client/` 路径；`node --test tests/client-img-chain.test.mjs` 全绿（其 L212 既有 Host method 锚「只传 entry id」不受影响）；`node --test tests/market.test.mjs tests/market-golden.test.mjs` 全绿（T5 剥除断言 + golden 夹具变体）。
- Expected: 无 client diff；三套件绿
- [ ] Step 3: 门禁三连——`node scripts/validate-registry.mjs --offline` 绿；联网带代理跑零漂移 warn；`git status --short` 干净（全部任务已提交）。
- Expected: 三项全过

## 执行纪律

- 开始实现前批判性复查本计划；发现缺项/矛盾/锚漂移先修计划再动手。
- 按任务顺序执行（T1→T2→T3→T4→T5 严格串行，接口依赖见 Consumes/Produces；T7 数据落地必须在 T5 剥除断言就位之后）；每任务完成即跑该任务定义的验证；不无声跳步、不合并任务目标。
- 源锚红灯先做基线对表（`git show HEAD:<file>` 计数方向：本计划全部新增锚 HEAD=0；既有锚如 client-img-chain L212 保持 HEAD>0 不红）。
- 全量测试错峰：同机有另一全量 `npm test` 在飞时，本计划只跑单套件定向验证。
- 遇阻塞、重复失败或计划与仓库现实不符（行号漂移、锚失效、门禁新增），立即停下说明，不猜。
- 当前在 `dsh-m` 仓库工作树直接实施（分支策略由主人开工指令定）；发版步骤不在本计划——如需发版另起战役并获当轮批准。
- 计划中所有行为断言的事实依据均为本会话（2026-11-14/15）现场实测或当场读码，引用行号为时点参考。

## 最终验证

- `npm test` 全量（失败集 ⊆ 028 §4 既有清单）+ `npm run typecheck` 零错 + `node scripts/validate-registry.mjs --offline` 绿 + 联网校验零漂移 warn + `git status` 干净。
- 实机验收（主人侧，非本计划门禁）：desktop 弹窗打开精选 dsh-m 卡片 → 截图条出现（宿主零 GitHub 请求）；社区页截图条照旧；web 机行为不变。

## 审阅 Checkpoint

- 计划正文到此为止。请主人审阅；批准后由普通编码 agent 或人工按计划执行（默认执行方为编码 agent，TDD 红先绿后）。
