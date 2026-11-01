# 已装卡收录名主名（ADR-0029）实施计划

## 目标

- 已装卡主名改按 GLOSSARY「收录名」：收录命中（含社区收录）→ 收录名；未命中 / 收录名空串 / registry 不可用早退臂 → 回退现名（与旧版逐字节一致）。
- 包名可见性三层保留：收录名在写且 ≠ 包名（showPkg 判据）时卡片 byline 行（复用 `dsvm-byline`）显示包名；主名 span 恒挂 `title`；详情行 `detail.pkg` 现状不动。
- 工具/CLI/toast 口径零触碰（grill Q3/Q6）；市场/收藏卡与已装描述零触碰（Q4/Q5）。

## 架构快照

- 数据面单点：`matchInstalled`（src/core/market.ts，符号锚 `item.registryGithub = entry.github ?? null` 所在函数）命中时已消费收录条目，本计划在同处增写 `registryName`；`InstalledItem` 接口（同文件，`registryGithub?: string | null` 字段族旁）增可选字段。早退臂（registry unavailable，不经 `matchInstalled`）天然不写，客户端回退兜住。
- 视图面纯逻辑：`installedViewModel`（src/client/installed-view.js，DOM-free 直测模块）产出 `displayName` / `nameTitle` / `byline` 三字段；`installed-tab.jsx` 只做接线（`name: vm.displayName` 等），与既有 busy 接线同款薄适配。
- 组件面增量：`Card`（src/client/card.jsx）增可选 `nameTitle` prop，span 挂 `title: nameTitle`——缺省不传时 React 不产出该属性，市场/收藏调用点零变化。byline 走 `Card` 既有 `byline` prop（`dsvm-byline` 容器与样式 styles.js 既有，零新增 CSS）。
- 面板 payload 零改动：host-api.ts `'installed'` 臂 `payload = { ...result }` 整体透传，新字段自动到达客户端；`'installedUpdates'` 显式映射不含新字段，不需改。

## 全局约束

- **回退语义逐条**（grill Q1）：回退判据 = `it.registryName || it.name`（空串/undefined/null 一律回退）；早退臂与旧版一致以 `installed.test.mjs` / market.test 早退臂既有断言为准。
- **零触碰面**（Q3/Q4/Q5/Q6 的物理证明）：`src/tools.ts`、`src/cli.ts`、`src/core/host-api.ts`、`src/client/styles.js`、市场/收藏卡调用点（market-tab.jsx / favorite-zone.jsx 的 Card 传参）不改。
- **受控变更面**（评审 P1 采纳）：`tests/fixtures/market-golden.json` 仅在 Task 1 按 `UPDATE_GOLDEN=1` 重生成（机制：tests/market-golden.test.mjs 头注与 L158 `UPDATE_GOLDEN === '1'` 写回分支；该 it capture 8 label = market-* ×6 + installed-none/installed-full，后两 label 为 `listInstalledWithMeta` 全量 deepEqual）；归因核验 = 重生成 diff 仅 installed-* 两 label 新增 `registryName` 键、market-* 六 label 零 diff。
- **锚纪律**（CODING-STANDARDS）：新增源锚只用 ASCII 字面量、出现次数语义（`src.split(needle).length - 1`）；源串锚禁含 `\n`；测试输出过管道时 `set -o pipefail` 保留原退出码。
- **环境**：Node ≥ 22.19.0；验证前 `test -d node_modules`，缺失按 `package-lock.json` → `npm ci` 恢复；`src/core` 相关单套件跑前先 `node scripts/build.mjs`（测试从 `lib/core/` 引），`src/client` 测试直引源码免构建；`npm test` 经 pretest 自带构建。

## 输入工件

- 设计共识：ADR-0029（`docs/adr/0029-installed-card-registry-name.md`）＋ GLOSSARY「收录名 / 现名」词条（2026-11-01 已落盘）＋ grill 决议 Q1–Q7（2026-11-01，对话在案）。
- 评估工件：钢人评估页（会话归档，结论「值得改 P2」）。

## 断言面清点（2026-11-01 锚普查，行号为时点参考、消费以符号锚优先）

| 断言面 | 普查证据 | 处置 |
|---|---|---|
| `registryName` 符号 | src/ 与 tests/ 现状 0 命中（grep 全文计数为 0） | 新符号，无迁移义务 |
| tests/market.test.mjs `deepEqual(…items…)` | 仅空数组形态（L288 `res.items`、L724 `out.items`——后者在 search 路径，变量名为 out） | 新字段零影响 ✓ |
| tests/market.test.mjs `installedViewModel` 直测（约 L1478-1481） | 字段访问断言，非全对象 deepEqual | 零改动 ✓ |
| tests/client-installed-view.test.mjs | `installedViewModel` 直测套件 | Task 2 增新字段断言，旧断言零改动 |
| tests/client-render-smoke.test.mjs InstalledTab SSR | 空夹具（items: []），不渲染卡片体 | byline/title 零影响；Task 3 增源锚 |
| tests/client-render-smoke busy 源锚（`busyLabel: lookup("action.uninstalling")` 等） | ASCII 字面量锚 | 零触碰 ✓ |
| tests/fixtures/market-golden.json | 8 label：market-* ×6 + installed-none/installed-full（it 标题即「listMarket / listInstalledWithMeta 全量输出与 golden 逐字节等价」；registry ready 场景 3 条已装全部收录命中）→ Task 1 后 installed-* 两 label 必新增 registryName 键 | 改判：受控变更（Task 1 UPDATE_GOLDEN 重生成 + market-* 零 diff 归因核验）。评审 P1 复跑证伪原「零触碰」判断，已采纳 |
| src/tools.ts `dshm_list` items 显式映射（`registryId: it.registryId ?? null` 所在 map） | 字段白名单 | 零触碰（Q3）✓ |
| src/core/host-api.ts `'installed'` 臂 | `payload = { ...result }` 透传 | 零改动，自动携带新字段 ✓ |
| tests/merged-market.test.mjs 等价套件 | 消费 `matchInstalledByEntry`（条目级），不消费 item 字段 | 零改动 ✓ |

## 文件结构与职责

- Modify: `src/core/market.ts` —— `InstalledItem` 增 `registryName?: string | null`；`matchInstalled` 增单行写入。
- Modify: `tests/market.test.mjs` —— 健康臂/早退臂既有 it() 内补 registryName 断言（零新夹具）。
- Modify: `tests/fixtures/market-golden.json` —— 受控重生成（Task 1 Step 4，UPDATE_GOLDEN 机制；归因核验 = market-* 六 label 零 diff）。评审 N1 补录。
- Modify: `src/client/installed-view.js` —— `installedViewModel` 增 `displayName` / `nameTitle` / `byline`。
- Modify: `tests/client-installed-view.test.mjs` —— 三字段表驱动断言。
- Modify: `src/client/installed-tab.jsx` —— Card 传参接线（`name` / `nameTitle` / `byline`）。
- Modify: `src/client/card.jsx` —— `Card` 增可选 `nameTitle` prop（span title 属性）。
- Modify: `tests/client-render-smoke.test.mjs` —— 增接线源结构锚（ASCII 字面量、出现次数语义）。

## 任务清单

### Task 1: core 写入 registryName（测试先行）

- 目标：收录命中（主+社区同一条写入线）时 `InstalledItem.registryName` 收到收录名；miss 与早退臂不写。
- Files:
  - Modify: `src/core/market.ts`（`InstalledItem` 接口 + `matchInstalled`）
  - Modify: `tests/market.test.mjs`（健康臂 it `健康臂：收录命中 → catalog；…` 与早退臂 it `早退臂：registry unavailable → …`，符号锚定位）
  - Modify: `tests/fixtures/market-golden.json`（受控重生成，见全局约束「受控变更面」；评审 P1）
- 接口契约：
  - Consumes: `matchInstalled` 现有写入序（`registryId` → `registryGithub` → `registryIcon` → community 打标）；`RegistryEntry.name` / `CommunityEntry.name`（string 必有，community-adapter `Omit<RegistryEntry,'category'>`）。
  - Produces: `InstalledItem.registryName?: string | null`——写入规则 `item.registryName = entry.name || null`（命中线单点，community 条目同线覆盖）；未命中/早退臂字段缺席（`undefined`）。Task 2/3 消费。
- 验证范围：单套件红→绿；金样按受控变更面重生成，market-* 六 label 零 diff（归因旁证）；全量 `npm test` + `npm run typecheck` 绿。
- [ ] Step 1: 写失败断言——健康臂 it 内：命中项（`upgradePath === 'catalog'`）`assert.ok(typeof it.registryName === 'string' && it.registryName.length > 0)`；miss 项 `assert.ok(!('registryName' in it))`。早退臂 it 内：全部 items `'registryName' in it === false`。
- Run: `node scripts/build.mjs && node --test tests/market.test.mjs`
- Expected: 新断言失败（`registryName` undefined / 字段缺席断言恒真项通过、命中项断言红）。
- [ ] Step 2: 确认失败（同上命令）。
- [ ] Step 3: 最小实现——`InstalledItem` 增字段声明（`registryGithub` 旁，含一行注释「收录名（ADR-0029）：matchInstalled 命中时写 entry.name，空串归 null」）；`matchInstalled` 在 `item.registryIcon = …` 行后增 `item.registryName = entry.name || null`。
- Change: `src/core/market.ts`、`tests/market.test.mjs`（fixture 重生成在 Step 4，不混入本步）。
- [ ] Step 4: 金样受控重生成（评审 P1）——机制见 tests/market-golden.test.mjs 头注与 `UPDATE_GOLDEN` 写回分支。
- Run: `node scripts/build.mjs && UPDATE_GOLDEN=1 node --test tests/market-golden.test.mjs`
- Expected: 输出 `[golden] 已重生成 …`；随后 `git diff tests/fixtures/market-golden.json` 核验：仅 `installed-none` / `installed-full` 两 label 内逐条新增 `"registryName"` 键，`market-*` 六 label 零 diff——超出即停下说明，不得续跑。
- [ ] Step 5: 确认通过。
- Run: `npm test && npm run typecheck`
- Expected: 全量绿——market.test 新断言绿、金样在新基线上绿、既有断言零改动通过。
- [ ] Step 6: checkpoint commit。
- Run: `git add src/core/market.ts tests/market.test.mjs tests/fixtures/market-golden.json && git commit -m "feat(core): ADR-0029 matchInstalled 单点写入 registryName（Task 1）"`
- Expected: commit 成功（fixture 与代码同一 commit，可整体回退）。

### Task 2: 视图模型 displayName / nameTitle / byline（测试先行）

- 目标：`installedViewModel` 纯逻辑产出主名与包名可见性三字段，DOM-free 直测钉死回退矩阵。
- Files:
  - Modify: `src/client/installed-view.js`（`installedViewModel` 返回对象扩三字段）
  - Modify: `tests/client-installed-view.test.mjs`（新 it 组，自带夹具，不引用兄弟 describe 闭包）
- 接口契约：
  - Consumes: Task 1 `registryName`（客户端侧仅作可选输入字段，直测用夹具对象注入）。
  - Produces: 判据布尔式 `showPkg = Boolean(it.registryName && it.registryName !== it.pkg)`（评审 P2 精确化：与包名比较的是收录名原值，不是回退后的 displayName；registryName 空串已由 Task 1 归 null，故非市场/未命中卡恒为假、不渲染 byline）。`displayName: string`（= `it.registryName || it.name`）；`byline: Array<{ text: string }> | null`（showPkg 真 → `[{ text: it.pkg }]`，否则 null——`Card` byline 契约形）；`nameTitle: string`（showPkg 真 → `` `${it.registryName}（${it.pkg}）` ``，否则 `it.name`）。Task 3 消费。
- 验证范围：单套件红→绿；`npm test` 全量绿。
- [ ] Step 1: 写失败断言——回退矩阵（registryName / name / pkg 三元组 → displayName / byline / nameTitle，评审 P2 补全 pkg 值）：① `'DSH Skins'` / `'@iasiv5/dsh-skins'` / `'@iasiv5/dsh-skins'` → `'DSH Skins'`、`[{ text: '@iasiv5/dsh-skins' }]`、`'DSH Skins（@iasiv5/dsh-skins）'`；②（非市场/link）缺席 / `'My Tool'` / `'my-tool'` → `'My Tool'`、null、`'My Tool'`；③ `''` / `'My Tool'` / `'my-tool'` → 同 ②；④（npm 典型三者同值）`'dsh-context'` / `'dsh-context'` / `'dsh-context'` → 同值、null、同值；⑤（边角）`'X'` / `'X'` / `'pkg-x'` → `'X'`、`[{ text: 'pkg-x' }]`、`'X（pkg-x）'`（原④在精确判据下确实渲染 byline，评审 P2 指认成立）。
- Run: `node --test tests/client-installed-view.test.mjs`
- Expected: 新字段 undefined 断言红（src/client 直引，免构建）。
- [ ] Step 2: 确认失败（同上命令）。
- [ ] Step 3: 最小实现——按 Produces 契约扩 `installedViewModel` 返回对象（不新增 i18n key，byline/title 均为数据原文）。
- Change: 上述 2 文件。
- [ ] Step 4: 确认通过。
- Run: `node --test tests/client-installed-view.test.mjs && npm test`
- Expected: 单套件绿；全量绿（market.test.mjs:1478 一带的字段访问断言零改动通过）。
- [ ] Step 5: checkpoint commit。
- Run: `git add src/client/installed-view.js tests/client-installed-view.test.mjs && git commit -m "feat(client): ADR-0029 installedViewModel 产出收录名主名与包名 byline（Task 2）"`
- Expected: commit 成功。

### Task 3: 卡面接线 + Card nameTitle + 源锚

- 目标：已装卡主名/副行/title 落到 DOM；市场/收藏调用点零变化；接线事实按三桶政策补源结构锚。
- Files:
  - Modify: `src/client/installed-tab.jsx`（Card 传参三处）
  - Modify: `src/client/card.jsx`（`Card` 签名增 `nameTitle`；`.dshm-name` span 增 `title: nameTitle`）
  - Modify: `tests/client-render-smoke.test.mjs`（busy 源锚 it 旁增一个 it，四个 ASCII 锚各出现次数 ≥1）
- 接口契约：
  - Consumes: Task 2 `displayName` / `nameTitle` / `byline`；`Card` 现有 `byline` 渲染契约（`b.title || undefined`，title 缺省不产出属性）。
  - Produces: 无下游消费（终端任务）。
- 验证范围：SSR 冒烟 + 源锚套件绿；全量门绿。
- [ ] Step 1: 写失败锚——新 it（描述「已装卡收录名接线源锚（ADR-0029）」）：`_installedTabSrc` 对 `name: vm.displayName`、`byline: vm.byline`、`nameTitle: vm.nameTitle` 三锚计数 ≥1；card.jsx 源串对 `title: nameTitle` 计数 ≥1（复用 render-smoke 既有 `cardSrc` 常量，L25 已 `readFileSync` 引入——评审 P4，不新增常量）。
- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 新锚红（接线不存在）。
- [ ] Step 2: 确认失败（同上命令）。
- [ ] Step 3: 最小实现——installed-tab.jsx Card 传参改 `name: vm.displayName` 并增 `nameTitle: vm.nameTitle`、`byline: vm.byline`；同处 `h(Icon, { entry: { name: it.name, … } })` 的 name 同步改 `vm.displayName`（图标缺字回退取 name 首字母，与主名语言保持一致）；card.jsx `Card({...})` 解构增 `nameTitle`，`h("span", { className: "dshm-name", title: nameTitle }, name)`。市场/收藏调用点零触碰（未传 `nameTitle` → React 不产出 title 属性）。
- Change: 上述 3 文件。
- [ ] Step 4: 确认通过。
- Run: `node --test tests/client-render-smoke.test.mjs && npm test && npm run typecheck`
- Expected: 全绿（busy 源锚既有断言零改动通过）。
- [ ] Step 5: checkpoint commit。
- Run: `git add src/client/installed-tab.jsx src/client/card.jsx tests/client-render-smoke.test.mjs && git commit -m "feat(client): ADR-0029 已装卡收录名/包名 byline/title 接线（Task 3）"`
- Expected: commit 成功。

## 行为零变化承诺（CODING-STANDARDS 必填格）

| 卡片形态 | 主名值 | DOM 节点数 | 新增属性 | 样式 |
|---|---|---|---|---|
| 非市场/未命中（含 link/file、registry 不可用臂） | 现名（与旧版同值） | 与旧版一致（无 byline 节点） | 主名 span + `title`（值=现名） | 不变 |
| 收录命中（主清单/社区） | 收录名 | +1 个 `dsvm-byline` div（文本=包名） | 主名 span + `title`（值=收录名（包名）） | 复用既有 byline 样式，零新增 |
| 市场/收藏卡 | 收录名（不变） | 不变 | 无（不传 nameTitle，不产出 title 属性） | 不变 |

- Icon 缺图回退字母（评审 P5 补列）：收录命中卡由现名首字母变为收录名首字母（Task 3 Icon entry name 同步 `vm.displayName` 的伴生可见变化；已核 icon-view.js `iconCandidates` 不消费 name，无链上副作用，仅 letter 文本变化）；非市场/未命中卡字母不变。

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项/矛盾/锚失效，先修计划再动手。
- 按任务顺序执行，不无声跳步；每任务跑该任务定义的验证；遇阻立即停下说明。
- 若当前在 `main`/`master`，未经用户同意不直接开工（本仓库惯例在 feature 分支作业）。
- 开工前置步（评审 P3 采纳）：先单独提交基线既成工件——`git add GLOSSARY.md docs/adr/0029-installed-card-registry-name.md docs/plans/2026-11-01-installed-card-registry-name-implementation-plan.md && git commit -m "docs: ADR-0029 已装卡命名决议、GLOSSARY 词条与实施计划"`——现状 GLOSSARY 为 M、ADR 与本计划为 untracked，不先提交则「最终验证 git status 干净」判据基线即为假。
- 发版时按 `CHANGELOG.md` 头部规则在中文/英文两区各补一条目（兼容性说明：纯展示层新增字段，无 API/行为破坏）；发版流程走 `npm run release`，不手动打 tag。

## 最终验证

- `npm test && npm run typecheck` 全绿；`git status` 干净、diff 逐文件可归因于本计划 Files 表。
- 人工验收（发版升级插件后）：已装页收录命中卡显示收录名主名 + 包名 byline；非市场卡（如本地 link 项）外观与旧版一致（仅 hover title 新增）。

## 审阅 Checkpoint

- 本计划经 writing-plans PHASE 5 自检（2026-11-01）：设计七决议均有落点（Q1→Task 1/2 回退矩阵、Q2→Task 2/3、Q3/Q6→零触碰面、Q4/Q5→范围外、Q7→ADR/GLOSSARY 已落盘）；无占位符；Consumes/Produces 链闭合；命令与仓库验证入口一致。审阅通过前不进入实现。
- 独立评审结论（2026-11-01，评审 Agent 三轮往来）：首轮 P1（阻断，golden 断言面误判）/P2–P3（重要）/P4–P6（建议）全部接受并修订；R3 复核「P1–P6 修订全部核实落实，无阻断/重要级新矛盾，计划可进入执行」；N1（建议，文件结构总表漏 fixture 行）已补录。台账与探针工件：`.dsh-research/dshm-plan-review-0029-scratch/`（仓库外 scratch，不入库）。
