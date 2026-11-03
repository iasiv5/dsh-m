# issue #43 toggle/事务「web profile 未安装」标签硬编码收编 实施计划

## 目标

- 两处硬编码「web profile 未安装该插件」改为携带实际 profile 名：`src/core/toggle.ts`（not-installed 分支）与 `src/core/profile-transaction.ts`（NOT_INSTALLED 拒绝 note）。缺省（不传 profileName）时消息逐字节不变（B2）。
- 调用链接线（D1）：tools.ts web 与 desktop 分支、cli.ts `case 'toggle'`、profile-ops.ts `desktopToggle` 透传；GUI `host-api.ts` set-enabled 两入口同批纳入（R-02，主人 2026-11-03 决议：纳入，独立 checkpoint B）。
- 0.12.3 patch 发版准备（D5）与发版后的生效探针；发版动作与关闭 issue 需当轮主人明确批示（`AGENTS.md`「Releasing」）。

## 架构快照

- 沿用 0.12.1 在 `src/core/market-mutation.ts:919` 确立的回退链先例。toggle 无 opts 形参，回退链为 `deps?.profileName ?? WEB_PROFILE`；事务侧 `ResolvedDeps.profileName`（`src/core/profile-transaction.ts:614`）已就位，`validateUninstall` 在 `:1307` 直达，回退链为 `d.profileName ?? WEB_PROFILE`。
- `profileName` 只作报错标签，文件路径权威仍是 `profileDir`（ADR-0030 冻结面，不触碰）。
- 不新立 ADR（落在 ADR-0030 收尾延长线上）；代码注释引 ADR-0030 与 issue #43。

## 全局约束

- 缺省回退消息逐字节等于现状：`web profile 未安装该插件: <pkg>`。HEAD 中 toggle 与事务的既有用例只钉 `code`、不钉消息（见「断言面清点」），本计划新增的消息钉为首次钉住；`tests/market-mutation.test.mjs` 的 0.12.1 同款钉法为先例。
- 自定义 profile 消息统一为 `<profileName> profile 未安装该插件: <pkg>`。
- 文案变化面（R-03 修正）：仅 not-installed 报错的 profile 标签随实际 profile 名变化（B1）。desktop 宿主（profile 名 `desktop` 或 `tauri`，见 `src/core/env.ts:6` 的 `DESKTOP_PROFILE` 与 `:15` 的 `DESKTOP_PROFILE_NAMES`）的未装报错由 `web profile 未安装该插件` 变为 `desktop profile …` 或 `tauri profile …`；desktop 其余拒绝路径与成功路径文案零变化。同族先例：`src/core/profile-ops.ts:1071`、`:1084` 已使用 `desktop profile 未安装该插件`。
- 新增类型字段一律 optional，不传时行为零漂移。
- 形状变化（`ToggleDeps`、`DesktopToggleDeps` 加字段）按 `docs/CODING-STANDARDS.md` 评审检查单「改函数返回/输出形态必清点断言面」处理：清点表见下文，改写处逐一列入 commit message。
- 发版前不跑 `check-release`：其 lock 与 tag 判据在 `npm run release` 内、打 tag 之后才成立（`scripts/release.mjs` 头注释步骤顺序；`scripts/check-release.mjs:30–32`、`:66–77`）。

## 需求基线

- B1（issue #43 目标）：自定义 profile 下，toggle 对未装目标的报错携带实际 profile 名。
- B2（issue #43 验收）：缺省（不传 profileName）时报错逐字节不变，仍为 `web profile 未安装该插件: <pkg>`。
- B3（issue #43 验收）：全量 `npm test` 与 `npm run typecheck` 绿。
- D1（grill Q1，经 R-02 追加决议）：生产调用链全修：tools.ts web 分支（`:365`）、cli.ts `case 'toggle'`（`:445`）、desktopToggle 委派（profile-ops.ts `:400`，含 `DesktopToggleDeps` 加字段与 tools.ts desktop 分支 `:363` 透传）、host-api.ts set-enabled 两入口（`:721`、`:724`，主人 2026-11-03 决议纳入）。
- D2（grill Q2）：profile-transaction.ts 的 NOT_INSTALLED 拒绝 note 同批修复。
- D3（grill Q3）：文案统一为 `${profileName} profile 未安装该插件: ${pkg}`；toggle 回退 `deps?.profileName ?? WEB_PROFILE`；事务回退 `d.profileName ?? WEB_PROFILE`；不传 profileName 时消息与现状逐字节相同。
- D4（grill Q4）：测试面：① toggle 正向与缺省逐字节断言（必做）；② desktopToggle 委派链透传断言（建议做）；③ 事务 NOT_INSTALLED 自定义 profile 断言（必做）；④ 不新增 tools/cli 层测试（既有用例的强制改写不属于新增）。
- D5（grill Q5）：0.12.3 patch 发版；CHANGELOG 中英双语顶条；commit message 引用 issue #43；发版后关闭 issue #43。
- D6（grill Q6）：不新立 ADR；代码注释引用 ADR-0030 与 issue #43。

## 断言面清点（计划期 grep `tests/`，HEAD 实测）

| 文件:行 | 现有断言 | 是否受本计划影响 | 处置 |
|---|---|---|---|
| `tests/toggle.test.mjs:91–96` | 仅 `err.code === 'not-installed'` | 否（新增消息钉） | Task 1 Step 1 新增两例 |
| `tests/tools-install.test.mjs:118–131` | `deps.profileDir`；`deps.profileName === undefined`（`:130`） | **是**（tools web 分支补传 profile.name） | Task 1 Step 2 改写标题与 `:130` 断言为 `'aqua'` |
| `tests/tools-install.test.mjs:103–116` | `deps.profileName === 'aqua'`（dshm_install 同形） | 否 | 无 |
| `tests/tools-install.test.mjs` 源结构锚（`src/tools.ts` 中 `profileDir: profile.dir` 出现次数） | 计数 11（HEAD 出现次数实测 11，按 `grep -o` 计次） | 否（新增词元不含该 needle） | 无 |
| `tests/external-journal-channels.test.mjs:236–264`（⑤） | 日志条数、kind、channel、target | 否 | 无；Task 1 Step 3 新增 ⑤b |
| `tests/profile-transaction.test.mjs:1116–1119` | 仅 `failure.code === 'NOT_INSTALLED'` | 否（新增 note 钉） | Task 2 Step 1 新增 |
| `tests/host-api-profile.test.mjs:511–516` | 仅 `calls.toggle[0].deps.profileDir`；标题含「不需要 profileName」 | **是**（R-02 纳入：host-api web 入口补传 profile.name） | Task 1 Step 7 改写标题，并补 `deps.profileName === 'aqua'` 断言 |
| `tests/host-api-profile.test.mjs:330–337` | `calls.desktopToggle[0].opts.profileDir` | **是**（R-02 纳入：host-api desktop 入口补传 profile.name） | Task 1 Step 7 补 `opts.profileName === 'desktop'` 断言 |
| `tests/host-api-profile.test.mjs:528–533` | 源结构锚：`src/core/host-api.ts` 中 `profileDir: profile.dir` = 13（HEAD 出现次数实测 13，按 `grep -o` 计次） | 否（新增 `profileName` 词元与 needle 同行，计数仍为 13） | 无 |
| `tests/cli-custom-profile.test.mjs:69–76` | 仅 `deps.profileDir` | 否 | 无 |
| `tests/host-api.test.mjs:822` | `deepEqual(seen.toggle, [{pkg, enabled, hasService}])`（记录不含 deps） | 否 | 无 |
| `tests/host-api.test.mjs:369/386/843/847` | mock 抛出 `web profile …` 文本驱动 | 否（不触达真实 toggle 消息） | 无 |
| `tests/installed.test.mjs:234/244/267` | `readInstalledPluginReadme` 的 web/desktop 正则 | 否（`src/core/installed.ts` 未改） | 无 |
| `tests/market-mutation.test.mjs:1331/1350/1363` | 0.12.1 同款钉法（`aqua`/`web profile` 正则） | 否（未改） | 无 |
| `tests/profile-ops.test.mjs:296–340`（desktopToggle 组） | 委派与 unaddressable 断言；不截获 togglePlugin 实参 | 否 | Task 2 Step 4 全量复跑覆盖 |

## 文件结构与职责

- Modify: `src/core/toggle.ts` — `:29` import 并入 `WEB_PROFILE`；`ToggleDeps`（`:68–77`）加 `profileName?: string`；`:137` not-installed 报错回退链化。
- Modify: `src/core/profile-ops.ts` — `DesktopToggleDeps`（`:374`）加 `profileName?: string`；`desktopToggle`（`:390`）内 `togglePlugin` 调用（`:400`）透传。
- Modify: `src/tools.ts` — `:363`（desktop 分支）与 `:365`（web 分支）两处 deps 各补 `profileName: profile.name`。
- Modify: `src/cli.ts` — `:445`（`case 'toggle'`）补 `profileName: cliProfileName`。
- Modify: `src/core/profile-transaction.ts` — `:37` import 并入 `WEB_PROFILE`；`:912` note 回退链化。
- Test: `tests/toggle.test.mjs` — `:91–96` 旁新增两例。
- Test: `tests/tools-install.test.mjs` — `:118–131` 改写。
- Test: `tests/external-journal-channels.test.mjs` — `:19` 后新增 `ToggleError` 导入；`⑤`（`:236`）后新增 `⑤b`。
- Test: `tests/profile-transaction.test.mjs` — NOT_INSTALLED 段（`:1110–1119`）扩展。
- Modify: `src/core/host-api.ts`（`:721`、`:724`，R-02 决议纳入）；Test: `tests/host-api-profile.test.mjs`（`:330–337`、`:511–516`）。
- Modify: `CHANGELOG.md`（中英双语顶条）、`package.json`（`:3`）、`package-lock.json`（顶层与 `packages[""]` 两处 `"version"`，由 npm 产生）。

依赖：Task 0 → Task 1 → Task 2 → Task 3 → Task 4。Task 1 内部：checkpoint B（Step 7–8）消费 Step 4 新增的 `ToggleDeps.profileName`、`DesktopToggleDeps.profileName` 类型字段，且 B 必须在 Step 6 的 checkpoint A 之后提交（B 先于 A 时 `npm run typecheck` 失败）。Task 1 与 Task 2 之间无数据依赖（互不消费对方产物），checkpoint C 可在 A 之后任意时点提交。Task 3 消费 Task 1 与 Task 2 全绿；Task 4 消费 Task 3 Step 6 的发版执行结果。

## 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| 形状变化后的既有断言漏改（`tests/tools-install.test.mjs:130`，R-01） | Task 1 Step 2 红灯先行；断言面清点表 | 先 `git revert` checkpoint B，再 revert checkpoint A（或 A、B 同批 revert）；checkpoint C 可单独 revert（R-16） |
| GUI `set-enabled` 两入口改动面（R-02 纳入） | host-api 改动独立为 checkpoint B；两个测试文件的断言改写同批列入 commit message | `git revert` checkpoint B（不影响 A、C） |
| desktop 未装报错标签变化（R-03） | 全局约束与 CHANGELOG 兼容性段显式写明 | 随 checkpoint A 与 B 同序 revert（R-16） |
| 人工抽验写入真实外部操作日志（R-12） | 命令前缀隔离 `DSH_HOME` 与 `DSHM_EXTERNAL_JOURNAL_FILE` | 删除临时目录即可；真实日志不受影响 |
| lock 与 tag 门禁顺序（R-05） | 发版前不跑 check-release；lock 三处同步在发版前独立提交；tag 只由 release 脚本打 | 发版前 `git revert` 版本提交 |
| CHANGELOG 计数与实测不符（R-08/R-11） | N/N 以 Task 2 Step 4 实测 `ℹ pass` 为准回填 | 发版前修正 CHANGELOG 后再提交 |
| 发版后不可逆 | 发版前逐项批示（AGENTS.md「Releasing」） | 已发版：不 unpublish；以 0.12.4 修复，另起 `git revert` 提交 |
| npm 镜像假阴性（know-how 018「本机核验陷阱」） | 探针强制 `--registry=https://registry.npmjs.org/` | — |
| release 一过性 `EALLOWSCRIPTS`（agent-ops「发版与 npm 轮询」） | 同命令复跑，不改计划 | — |

回退顺序（R-16）：checkpoint B 依赖 checkpoint A（B 的 host-api 补丁需要 A 新增的类型字段），因此先 `git revert` B，再 revert A（或 A、B 同批 revert）；checkpoint C 与 A、B 无数据依赖，可单独 revert。

## 任务清单

### Task 0: 前置检查：分支与开工批示（R-14）

- 目标：确认可以开工，且发版路径与分支一致。
- 涉及文件：无（只读检查；git 写操作仅在真实仓库由执行方执行）
- 接口契约
  - Consumes: 无
  - Produces: 开工放行记录（分支名与批示方式）
- 检查命令：
  - `cd ~/workspace/dsh-m && git branch --show-current && git status --porcelain`
  - 期望：`git status --porcelain` 仅列出本计划文件（`?? docs/plans/2026-11-03-issue43-toggle-not-installed-profile-label-implementation-plan.md`）。
- 放行（主人已选定，2026-11-03）：在 `main` 上直接开工（与历史提交 `515e989`、`7371041` 同路径；`scripts/release.mjs:62` 推送的即本地 `main`，无需合并步骤）。开工仍以计划评审通过为前提，须由主人明确批示。
- 计划文档入库：`docs/plans/` 为入库惯例（`git ls-files docs/plans` 可见近期计划）。Task 3 Step 5b 须把本计划文件纳入提交，否则发版脚本的干净树检查（`git status --porcelain` 非空即拒绝）会拒绝发版。
- [ ] Step 1：执行检查命令，记录分支与状态输出。
- [ ] Step 2：计划评审通过后，等待主人明确批示开工；未批示则停止，不进入 Task 1。

### Task 1: toggle 核心 + desktopToggle 透传 + tools/cli 接线（TDD）

- 目标：not-installed 报错携带实际 profile 名；tools web/desktop、CLI、desktopToggle 透传，以及 host-api set-enabled 两入口（R-02）的接线完成。
- 涉及文件：`src/core/toggle.ts`、`src/core/profile-ops.ts`、`src/tools.ts`、`src/cli.ts`、`src/core/host-api.ts`、`tests/toggle.test.mjs`、`tests/tools-install.test.mjs`、`tests/external-journal-channels.test.mjs`、`tests/host-api-profile.test.mjs`
- 接口契约
  - Consumes: `WEB_PROFILE`（`src/core/env.ts:5`）；`cliProfileName`（`src/cli.ts` 既有变量）；`profile.name`（`src/tools.ts` 既有 profile 解析产物）
  - Produces: `ToggleDeps.profileName?: string`；`DesktopToggleDeps.profileName?: string`
- 验证范围：`tests/toggle.test.mjs`、`tests/tools-install.test.mjs`、`tests/external-journal-channels.test.mjs` 三文件红→绿（Step 1–5）；`tests/host-api-profile.test.mjs`、`tests/host-api.test.mjs` 红→绿（Step 7）。

- [ ] Step 1（红）：`tests/toggle.test.mjs` 在「未安装 → not-installed」用例（`:91–96`，describe「togglePlugin：保护门与在装判定」内）之后新增两例；夹具沿用该 describe 的 `dir`（`beforeEach` 中 `mkdtempSync` 生成的空目录，`:27–30`）：
  - ① `it('未安装 + profileName → 报错标签携带实际 profile 名（issue #43）')`：`togglePlugin('ghost-pkg', false, { profileDir: dir, profileName: 'aqua' })`，断言 `err instanceof ToggleError && err.code === 'not-installed' && err.message === 'aqua profile 未安装该插件: ghost-pkg'`。
  - ② `it('未安装 + 不传 profileName → 报错逐字节为 web 文案（issue #43 缺省零漂移）')`：同调用去掉 `profileName`，断言 `err.message === 'web profile 未安装该插件: ghost-pkg'`。
  - 夹具只用顶层字段镜像生产调用点，不额外注入内层缺省对象。
  - Run: `npm run build >/dev/null && node --test tests/toggle.test.mjs`
  - Expected: ① 红（实际 message 为 `web profile …`）；② 绿（现状即字节等值，作防漂移钉）。

- [ ] Step 2（红）：`tests/tools-install.test.mjs:118–131` 改写 dshm_toggle 用例（清点表第 2 行）：
  - 用例名改为 `dshm_toggle web 分支 → togglePlugin deps 收 profileDir+profileName（issue #43 标签透传）`；
  - `:130` 由 `assert.equal(captured[0].deps.profileName, undefined)` 改为 `assert.equal(captured[0].deps.profileName, 'aqua')`（与同文件 `:103–116` dshm_install 用例同口径；`aquaCtx` 解析为 `aqua`）。
  - Run: `npm run build >/dev/null && node --test tests/tools-install.test.mjs`
  - Expected: dshm_toggle 用例红（actual `undefined`，expected `'aqua'`）；同文件其余用例绿。

- [ ] Step 3（红）：`tests/external-journal-channels.test.mjs`：
  - `:19` 后新增 `import { ToggleError } from '../lib/core/toggle.js'`（`:18` 为仅副作用的 `import '../lib/core/toggle.js';`，不提供绑定）。
  - `⑤`（`:236`）之后新增 `⑤b`（编号 ⑥ 已被 `:266` 占用）：
    - `const emptyDir = mkdtempSync(join(tmpdir(), 'dshm-extchan-tgl-empty-'))`，`dirs.push(emptyDir)`（`dirs` 与 `afterEach` 清理见 `:178–181`）；
    - `const service = { listPlugins: async () => [], setPluginEnabled: async () => ({}), setBundleEnabled: async () => ({}) }`（`⑤` 的 `service` 为 `it` 回调内局部常量，不可复用；`getService` 必须返回非 `undefined`，否则 `resolveManager` 先抛 `unaddressable`；not-installed 分支在在装判定处抛出，不会调用桩方法）；
    - 断言：`await assert.rejects(() => desktopToggle('ghost-pkg', false, { getService: () => service, profileDir: emptyDir, profileName: 'aqua', channel: 'cli' }), (err) => err instanceof ToggleError && err.code === 'not-installed' && err.message === 'aqua profile 未安装该插件: ghost-pkg')`。
  - Run: `npm run build >/dev/null && node --test tests/external-journal-channels.test.mjs`
  - Expected: ⑤b 红，失败原因为 message 不符（实际 `web profile …`），而非 `ReferenceError`；其余用例绿。

- [ ] Step 4（绿）：最小实现
  - ① `src/core/toggle.ts`：`:29` 改为 `import { webProfileDir, WEB_PROFILE } from './env.js'`；`ToggleDeps`（`:68–77`）加 `/** ADR-0030 / issue #43：目标 profile 名，仅作 not-installed 报错标签；缺省回退 'web'，消息逐字节不变 */ profileName?: string`；`:137` 改为 `` throw new ToggleError('not-installed', `${deps?.profileName ?? WEB_PROFILE} profile 未安装该插件: ${key}`) ``。
  - ② `src/core/profile-ops.ts`：`DesktopToggleDeps`（`:374`）加 `profileName?: string`；`desktopToggle` 内 `togglePlugin(pkg, enabled, {…})`（`:400`）加 `profileName: deps.profileName`。
  - ③ `src/tools.ts`：`:363`（desktop 分支 `m.desktopToggle(...)`）与 `:365`（web 分支 `toggle(...)`）两处 deps 各加 `profileName: profile.name`。
  - ④ `src/cli.ts`：`:445` 改为 `d.togglePlugin(target, onFlag, { channel: 'cli', profileDir: cliProfileDir, profileName: cliProfileName })`。
  - 代码注释引 ADR-0030 与 issue #43。

- [ ] Step 5（绿）：运行三文件。
  - Run: `npm run build >/dev/null && node --test tests/toggle.test.mjs tests/tools-install.test.mjs tests/external-journal-channels.test.mjs`
  - Expected: 三文件全部用例 `fail 0`；原 ⑤ 不双记用例不回归。

- [ ] Step 6：checkpoint A commit：`fix(toggle): not-installed 报错携带实际 profile 名（issue #43，1/3）`。commit message 逐条列出本次改写的既有断言：`tests/tools-install.test.mjs:118–131`（用例名与 `:130` 由 `undefined` 改为 `'aqua'`）。

- [ ] Step 7（R-02 决议纳入；先红后绿）：GUI 开关两入口补传 profile 名。
  - 红：先改写测试。`tests/host-api-profile.test.mjs:330–337` 补断言 `calls.desktopToggle[0].opts.profileName === 'desktop'`（夹具 `desktopProfile`，`:239`）；`:511–516` 标题去除「不需要 profileName」，断言补 `calls.toggle[0].deps.profileName === 'aqua'`（夹具 `aquaProfile`，`:486`）。
    - Run: `npm run build >/dev/null && node --test tests/host-api-profile.test.mjs`
    - Expected: 两处新断言红（actual `undefined`）。
  - 绿：`src/core/host-api.ts:721`（desktop 分支 `d.desktopToggle(...)`，channel `'panel'`）与 `:724`（web 分支 `d.toggle(...)`）各加 `profileName: profile.name`（`profile` 为该 switch 作用域的 ActiveProfile；同文件 `:371`、`:452` 已在用 `profile.name`）。
    - Run: `npm run build >/dev/null && node --test tests/host-api-profile.test.mjs tests/host-api.test.mjs`
    - Expected: 两文件全部用例 `fail 0`。
  - 锚计数复核（出现次数语义，不用 `grep -c`）：`grep -o "profileDir: profile.dir" src/core/host-api.ts | wc -l` 仍为 13（`tests/host-api-profile.test.mjs:528–533` 源结构锚不变）。
  - 依据（R-02 第 2 轮事实修正，已核实）：GUI 点击先入泵（`src/client/installed-tab.jsx:41–53` → `src/client/main.jsx:534–542`）；泵执行前以新鲜 `installed` 实读做 `stillApplies`（`src/client/main.jsx:605–616`，经 `opAppliesTo`，`src/client/operations.js:400–410`），陈旧卡片在此被 `superseded` 拦截，不发出 set-enabled（`operations.js:446–458`）。未装分支的残留仅两类：实读失败保守放行（`main.jsx:612–613`），以及 `stillApplies` 之后到 set-enabled 请求之间的竞态。(a) 覆盖这两类残留。

- [ ] Step 8：checkpoint B commit（Step 7 全绿后）：`fix(host-api): GUI set-enabled 路径携带 profileName（issue #43，2/3）`。commit message 逐条列出改写的既有断言：`tests/host-api-profile.test.mjs:330–337`（补 `opts.profileName`）、`:511–516`（标题与 `deps.profileName`）。

### Task 2: profile-transaction NOT_INSTALLED note 回退链（TDD）

- 目标：卸载门 validate 的拒绝 note 携带实际 profile 名；缺省逐字节不变。
- 涉及文件：`src/core/profile-transaction.ts`、`tests/profile-transaction.test.mjs`
- 接口契约
  - Consumes: `ResolvedDeps.profileName`（`src/core/profile-transaction.ts:614`，已存在）；`baseTx`（`tests/profile-transaction.test.mjs:102–107`，第三参 spread 进 deps）
  - Produces: 无下游数据依赖（Task 3 以 Task 2 全绿为放行条件）
- 验证范围：`tests/profile-transaction.test.mjs` 红→绿；全量 `npm test`。

- [ ] Step 1（红）：`tests/profile-transaction.test.mjs` NOT_INSTALLED 段（用例「三种 rejected」`:1105`，NOT_INSTALLED 段 `:1110–1119`）：
  - 在 `:1118`（`assert.equal(r1.failure.code, 'NOT_INSTALLED')`）之后新增缺省钉：`assert.equal(r1.failure.note, 'web profile 未安装该插件: pkg-a')`。
  - 在 `:1119`（`rmSync(dir, …)`）之后新增带名变体：重建与 `:1111–1115` 相同的三文件夹具 `dir = makeProfile({…})`；`const r1b = await runProfileTransaction({ kind: 'uninstall', pkg: 'pkg-a' }, baseTx(dir, runner, { setLiveDisabled: async (pkg, flag) => { liveCalls.push([pkg, flag]); return false }, profileName: 'aqua' }))`；断言 `r1b.failure.code === 'NOT_INSTALLED'` 与 `r1b.failure.note === 'aqua profile 未安装该插件: pkg-a'`；随后 `rmSync(dir, …)`。
  - 采用内联 `baseTx` 的写法（不改 `depsOf` 签名）。
  - Run: `npm run build >/dev/null && node --test tests/profile-transaction.test.mjs`
  - Expected: 带名断言红（实际 note 为 `web profile …`）；缺省断言绿（防漂移钉）；该文件其余用例绿。

- [ ] Step 2（绿）：`src/core/profile-transaction.ts`：
  - `:37` 由 `import { webProfileDir } from './env.js'` 改为 `import { webProfileDir, WEB_PROFILE } from './env.js'`（当前未导入 `WEB_PROFILE`，已核实）；
  - `:912` 由 `` note: `web profile 未安装该插件: ${req.pkg}` `` 改为 `` note: `${d.profileName ?? WEB_PROFILE} profile 未安装该插件: ${req.pkg}` ``；注释引 ADR-0030 与 issue #43。

- [ ] Step 3（绿）：Run: `npm run build >/dev/null && node --test tests/profile-transaction.test.mjs`；Expected: `fail 0`。

- [ ] Step 4（全量）：Run: `npm run build >/dev/null && npm test && npm run typecheck`；Expected: 退出码均为 0，`ℹ fail 0`。本步实测的 `ℹ tests` 与 `ℹ pass` 数即为 Task 3 Step 3 回填 CHANGELOG 的 N（不采用计划内估算值）。

- [ ] Step 5：checkpoint commit：`fix(transaction): NOT_INSTALLED note 携带实际 profile 名（issue #43，3/3）`。本 Task 只新增断言，不改写既有断言；commit message 注明「无既有断言改写」。

### Task 3: 0.12.3 发版准备（不含发版动作）

- 目标：三处版本一致、双语 CHANGELOG 顶条、干净树；待主人批示后执行 `npm run release`。
- 涉及文件：`package.json`、`package-lock.json`、`CHANGELOG.md`、`docs/plans/2026-11-03-issue43-toggle-not-installed-profile-label-implementation-plan.md`
- 接口契约
  - Consumes: Task 1、Task 2 全绿（Task 2 Step 4 的实测计数）；Task 0 放行。
  - Produces: 三处版本一致的提交与干净树；`npm run release` 的前置条件满足。
- 验证范围：版本三处、CHANGELOG 双语配对与计数、`npm test` 与 `typecheck`。

- [ ] Step 1：`package.json:3` 的 `"version": "0.12.2"` 改为 `"version": "0.12.3"`。
- [ ] Step 2：lock 三处同步（与 `515e989` 同形态；命令与 `scripts/release.mjs` 自动同步分支所用一致）：
  - Run: `npm_config_cache=$HOME/workspace/.npm-ci-cache npm install --package-lock-only --ignore-scripts`（联网 npm 调用前指 `npm_config_cache` 到 workspace 内路径，见 agent-ops「npm 调用」）。遇 `EALLOWSCRIPTS` 一过性失败，同命令复跑（agent-ops「发版与 npm 轮询」）。
  - Expected: `git diff --stat -- package-lock.json` 为 `2 insertions(+), 2 deletions(-)`；`grep -n '"version": "0.12.3"' package-lock.json` 恰为 2 行（顶层与 `packages[""]`）。
- [ ] Step 3：CHANGELOG 双语顶条（中文与英文区块各 prepend 一条 0.12.3）：
  - 中文顶条须含「全量 N/N」，N 为 Task 2 Step 4 实测 `ℹ pass`（`scripts/check-release.mjs:107–125` 的计数门禁以 `node --test` 实测比对；不一致则发版门禁失败）；
  - 兼容性段写明：仅 not-installed 报错的 profile 标签随实际 profile 名变化；缺省（不传 profileName）逐字节不变；desktop 宿主未装报错由 `web` 变为 `desktop` 或 `tauri`（R-03 修正，非零变化）；GUI `set-enabled` 两入口同批纳入（R-02 决议），未装报错标签同样随实际 profile 名变化；回退面为 revert 加版本号递增。
- [ ] Step 4：发版前验证（不含 `check-release`）：
  - Run: `npm test && npm run typecheck`；Expected: 退出码均为 0，`ℹ fail 0`。
  - Run: `grep -n '"version"' package.json package-lock.json | head -3`；Expected: 三行均为 `"version": "0.12.3"`（`031-dshm-release-package-lock-version-sync.md` §3）。
- [ ] Step 5a：提交版本三处（照 `515e989`）：`git add package.json package-lock.json && git commit -m "chore(release): 0.12.3 版本三处同步（issue #43）"`。
- [ ] Step 5b：提交 CHANGELOG 与计划文档：`git add CHANGELOG.md docs/plans/2026-11-03-issue43-toggle-not-installed-profile-label-implementation-plan.md && git commit -m "docs(changelog+plans): 0.12.3 双语顶条 + issue #43 实施计划"`。
- [ ] Step 5c：Run: `git status --porcelain`；Expected: 无输出（干净树；发版脚本的前置条件）。
- [ ] Step 6（发版动作，需当轮主人明确批示；未批示则停在此步）：`npm_config_cache=$HOME/workspace/.npm-ci-cache npm run release`。（agent-ops「发版与 npm 轮询」：`npm run release` 首跑可经 assert-pack 触发 EROFS，联网 npm 调用前须先指 workspace 内缓存。）
  - 前置与步骤以 `scripts/release.mjs` 头注释为准（lock 三处同步检测 → 干净树 → push 预检 → tag 重钉 HEAD → check-release 门禁 → push main → push tag）。本计划的 lock 已于 Step 2 同步并提交，`lockVersionMismatch` 为 `null`，脚本不触发自动同步。
  - 禁止手动打 tag（`AGENTS.md`「Releasing」，2026-11-01 实录）。
  - 一过性失败（`EALLOWSCRIPTS`）：同命令复跑，不改计划。
  - 本步退出码 0 不作为生效判据，见 Task 4。

### Task 4: 发版生效探针与收口（关闭 issue 需当轮主人批示）

- 目标：以可观测的 registry 与远端 tag 事实判定「发版成功」，再提议关闭 issue #43。
- 涉及文件：无（只读探针；关闭 issue 为公开动作）
- 接口契约
  - Consumes: Task 3 Step 6 已执行，`npm run release` 退出码为 0。
  - Produces: 两条生效探针的输出；关闭动作的批示记录。
- 验证范围：registry 转正与远端 tag 指向。

- [ ] Step 1（registry 转正）：Run: `npm_config_cache=$HOME/workspace/.npm-ci-cache npm view dsh-m@0.12.3 version --registry=https://registry.npmjs.org/`；Expected: 输出 `0.12.3`。未转正则按 know-how 018 两阶段监视：每 2 分钟一次，上限 80 分钟；超时报告主人，不自动重发。不带 `--registry` 的 `npm view` 查询的是镜像，不作为判据。
- [ ] Step 2（远端 tag）：Run: `git ls-remote --tags origin 'refs/tags/v0.12.3^{}'` 与 `git rev-parse 'v0.12.3^{commit}'`；Expected: `ls-remote` 输出的 sha 等于 `rev-parse` 的 sha（若远端为轻量 tag、无 `^{}` 行，则取 `refs/tags/v0.12.3` 行比对）。
- [ ] Step 3（关闭 issue）：仅当 Step 1 与 Step 2 均通过，才提议关闭 issue #43；关闭动作需当轮主人明确批示（`AGENTS.md`「Releasing」），回帖附两条探针输出。Actions/CI 绿不作为判据（`scripts/release.mjs:7–8`「绿 ≠ 已上架」）。

## 执行纪律

- 开始实现前先批判性复查本计划；发现与仓库现实不符（如 `:137`、`:912`、`:363`、`:365`、`:445` 行号漂移）立即停下说明，以符号锚为准修正，不猜。
- `test -d node_modules` 先行。
- 测试导入约定：core 测试从 `lib/core/*.js`（构建产物）引入；每个 Run 命令已含 `npm run build`。`lib/` 为 gitignored 构建产物（`.gitignore:8`），构建不影响干净树。
- 过滤测试输出时 `set -o pipefail`，以原进程退出码判定。
- 按任务顺序执行，每任务跑其验证；红→绿留证（落盘 log），不无声跳步。
- 遇阻、重复失败或计划与仓库现实不符，立即停下说明，不猜。

## 最终验证

- Task 3 Step 4 的 `npm test && npm run typecheck` 为发版前全量口径。
- 人工抽验（隔离，不写真实外部操作日志）：
  - Run:
    ```
    npm run build >/dev/null && T="$(mktemp -d)" && mkdir -p "$T/profiles/aqua" && echo '{}' > "$T/profiles/aqua/package.json" && DSH_HOME="$T" DSHM_EXTERNAL_JOURNAL_FILE="$T/journal.json" node lib/cli.js toggle --pkg ghost-pkg --off --yes --profile aqua; echo "exit=$?"
    ```
  - Expected: stderr 为 `错误：aqua profile 未安装该插件: ghost-pkg`，`exit=1`。HEAD 构建的同一命令输出为 `错误：web profile 未安装该插件: ghost-pkg`（修复前后有区分度）。

## 审阅 Checkpoint

实施计划已写好并保存到 `dsh-m/docs/plans/2026-11-03-issue43-toggle-not-installed-profile-label-implementation-plan.md`。请先确认这份计划；如果没问题，下一步可以按计划由普通编码 agent 或人工继续执行。

## 修订记录

- v2（评审第 1 轮修订）：R-01/R-04（Task 1 Step 2 与 Step 3）、R-03（全局约束与 Task 3 Step 3 兼容性段）、R-05（发版前不跑 check-release；lock 独立同步，Task 3 Step 2）、R-06（依赖段）、R-07（断言面清点表）、R-08/R-11（计数回填，Task 2 Step 4 与 Task 3 Step 3）、R-09（内联 baseTx；红绿措辞）、R-10（风险与回退表）、R-12（隔离抽验命令）、R-13（Task 4 生效探针）、R-14（Task 0）。R-02 已由主人决议纳入（Task 1 Step 7，独立 checkpoint B）；开工分支定为 `main`（Task 0）。v3 修订。
