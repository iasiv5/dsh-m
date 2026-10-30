# unsupported 信封统一 + reason 透出 + client/cli 成因文案修正实施计划（issue #35）

## 目标

- **信封对称**：web 梯 unsupported 从「`UpgradePathUnsupportedError` 裸抛 → host-api default 臂 500」升级为与 desktop 同构的结构化信封 `409 + {ok:false, error, code:'upgrade-unsupported', failureClass:'target', reason:{code, detail}}`（host-api.ts:293-295 default 兜底退役，专属臂接管）。
- **reason 透出**：ADR-0028 已产出的闭集成因码（`local-spec` / `github-spec-unparseable` / `source-unresolvable`，upgrade-target.ts:16）沿「错误对象 → host-api envelope」透出，desktop 侧 `DesktopOpsError` 同步携带并投影。
- **成因文案修正**：CLI（cli.ts:348）、agent tools（tools.ts:618/670）、client 批量 toast（i18n.js:36/164）不再把一切 unsupported 硬编码为「本地链接安装」，改为消费透出的成因码按码映射（github-spec-unparseable 场景文案失实修复）。
- **W2 双翻译点收拢**：profile-ops.ts「联合臂翻译（L1096-1098）+ 边缘 catch 保真翻译（L1087-1095）」收拢为单一映射函数，防统一后双处硬编码漂移（上轮 impl-review 计划外建议 1）。
- **不动的**：判定语义与 reason 闭集码（ADR-0028 边界）、`UpgradePathUnsupportedError` message 模板与三条 detail 文案字节（B5 冻结延续）、批量 failureClass 白名单语义（ADR-0026 decision 4：unsupported 仍 target、跳过继续）、`upgradePath` 三态投影语义、GLOSSARY 术语口径。

## 架构快照

- **现状不对称**（同一「升级不支持」语义两条出口）：
  - web：market-mutation.ts:927 重抛 `UpgradePathUnsupportedError(target.pkg, resolution.reason.detail)` → host-api errorStatus 无专属臂 → default 臂 500 `{ok:false, error, failureClass:'target'}`（成因码丢失）。
  - desktop：profile-ops.ts:1096-1098 翻译 `DesktopOpsError('upgrade-unsupported', reason.message)` → host-api.ts:242-247 → `409 {ok:false, error, code, failureClass:'target'}`（同样无 reason）。
- **统一终点**：errorStatus 两专属臂产出同构 payload——`409 + {ok:false, error, code:'upgrade-unsupported', failureClass:'target', reason:{code, detail}}`。行为变化仅两处：web status 500→409 + 新增 code/reason 字段；desktop 信封新增可选 reason 字段（缺席时字段不出现，既有 20+ 抛点信封零变化）。
- **reason 携带机制**：`UpgradePathUnsupportedError` 构造签名 `(pkg, reason: {code, detail})`，message 模板字节不变，新增 `readonly reason`；两抛点（upgrade-target.ts:77 / market-mutation.ts:927）结构化 reason 本就在手，零信息损失。`DesktopOpsError` 新增可选第四参 `reason`（独立于既有 `details` 集合，类型显式）。
- **成因码投影**：`InstalledItem` 新增 `upgradePathReason?: UnsupportedReasonCode`（market.ts 两装配点 937/945 经新组合投影 `stampUpgradeProjection` 单点赋值，仅 unsupported 项赋值）；tools 透传（L260/421/542）；client（installed-updates.js 分桶）、CLI/tools 文案（upgrade-target.ts 导出 `unsupportedCauseLabel` 短标签映射，zh 短标签与 detail 同语言文化域，core 唯一产地）。
- **client 批量 toast**：`installed.upgradeBatch.skippedUnsupported` 单段计数退役，改按码分组（`installed.upgradeBatch.skipped.<code>` 四键：三闭集码 + other 兜底），分桶与拼接落 DOM-free 纯函数（installed-updates.js，lookup 注入直测）。
- **client 对 status 零涟漪**（已实测 hooks.js:22-23）：`!res.ok || data.ok === false` 同一错误臂，message = `data.error || 'API ' + status`——error 文本不变即零变化；新增 reason/code 字段 client 零消费即零影响。

## 全局约束

- **B5 冻结延续**：`「${pkg}」无法自动升级：${reason}` 模板与三条 detail 文案逐字不变（`本地开发安装（${spec}）不从线上更新；如需线上版本请先卸载后经 dsh-m 安装` / `github 安装的 spec（${spec || '空'}）解析不出 owner/repo，拒绝臆测来源` / `来源 ${target.source} 不可线上解析，不做自动升级`）。
- **行为变化仅限声明面**：web 500→409、两端信封新增 `code`（web）/`reason`（两端）字段、三端成因文案、批量 toast 分组。其余一切信封（DesktopOpsError 其余码、InstallGuardError、TransactionError、ToggleError 等）字节不变。
- **ADR 红线**：ADR-0028（判定语义与 reason 闭集码不变，本计划只收拢「边缘映射→统一信封→透出」）、ADR-0026 decision 4（failureClass 白名单与批量三态语义不回退）、ADR-0024（不新增转手 re-export）。
- **CODING-STANDARDS**：源串锚禁含 `\n` 转义；中文文案锚一律走源结构锚；量化断言为出现次数语义；新 describe 自带夹具（不引用兄弟 describe 闭包）；管道显示测试输出保原始退出码（`set -o pipefail`）；改函数返回/输出形态必清点断言面（下表）。
- **断言面清点表**（「改形状必清点」爆炸半径，全部已读现文核实）：

  | 断言面 | 现状 | 本计划处置 |
  |---|---|---|
  | tests/host-api-profile.test.mjs:438-441 ⑥ | 构造 `UpgradePathUnsupportedError('p', '本地开发安装…')`（string 第二参）+ failureClass 断言 | Task 1 构造改对象形态；Task 3 改写为 409+code+reason 断言 |
  | tests/host-api-profile.test.mjs:413-436 ①-⑤ | 五用例四类错误（裸 Error / InstallGuardError / TransactionError / DesktopOpsError×2） | 零改动（default 臂与其余信封不动） |
  | tests/upgrade-target.test.mjs:185-215 synthesize 五分支 | `instanceof + upgradePath + message 正则` | 零改动兼容；Task 1 另扩 reason 结构断言 |
  | tests/market-mutation.test.mjs:1185 | `instanceof + err.upgradePath` | 零改动兼容 |
  | tests/profile-ops.test.mjs:463-472 | `DesktopOpsError + code + /本地/ message 正则` | Task 4 扩 `err.reason` 断言（原断言零改动） |
  | tests/market.test.mjs:1374-1397 行为锚 | renderList/renderOutdated 标注「本地链接安装」 | local-spec 场景文本不变（零改动）；Task 5 加 github-spec 场景新断言 |
  | tests/market.test.mjs:1399-1404 源结构锚 | `tools.ts split('本地链接安装') ≥2`、`cli.ts ≥1` | Task 5 改写指向 `unsupportedCauseLabel` 消费计数（字面随映射迁往 upgrade-target.ts） |
  | tests/client-installed-updates.test.mjs:107/123-133 | batchUpgradeOrder unsupported 收集 + summarizeBatch 计数入参 | 零改动；Task 6 另扩分桶/拼接 describe |
  | tests/client-i18n.test.mjs | lookup 直接量落字典 audit + ZH/EN 键集配对 | 零改动自动守卫（新键落字典、退役键无 lookup 残留即绿） |
  | tests/fixtures/market-golden.json | 6 处 `"upgradePath": "catalog"`，零 unsupported 项 | Task 2 重生成核验：预期零 diff（条件赋值）；若意外 diff 必须逐键归因恰为 upgradePathReason 增量 |
  | src/core/host-api.ts:293-295 default 臂注释 | 提及 UpgradePathUnsupportedError 属目标级 | Task 3 注释更新（专属臂接管） |
- **环境**：Node ≥ 22.19.0；验证前 `test -d node_modules`（缺失按 package-lock.json → `npm ci`）；任何 npm 调用（含 `npm run release` 内部 assert-pack）一律前置 `npm_config_cache=$HOME/workspace/.npm-ci-cache`；预计 >90s 的命令（全量门、release）以 `run_in_background` 起跑。
- 遵循 `docs/CODING-STANDARDS.md`（评审 Agent 以此为准绳）与上轮计划门禁/红绿风格。

## 输入工件

- 设计共识：本轮 grill 决议 Q1–Q7 全按推荐（2026-10-30，对话在案）：①web 升级为 desktop 形态 409+code；②错误对象携带结构化 reason + errorStatus 两专属臂；③500→409 行为变化入 CHANGELOG；④投影 upgradePathReason + 三端按码映射；⑤批量 toast 按码分组；⑥tools.ts 两处纳入本轮；⑦W2 双翻译点收拢单映射函数。
- issue #35 正文（证据锚：host-api.ts:293-295、profile-ops.ts:1113-1121≈现 1087-1098、i18n.js:36/164、cli.ts:348、market.ts 合成分支、tests/host-api-profile.test.mjs:437-438≈现 438-441）。
- ADR-0028 及其 Follow-up 清单；上轮实施计划 `docs/plans/2026-10-30-upgrade-target-resolution-implementation-plan.md`（样式参照）。

## 文件结构与职责

- Modify: `src/core/upgrade-target.ts` —— 错误类签名改造 + `reason` 字段（T1）；`stampUpgradeProjection` + `unsupportedCauseLabel` 导出（T2/T5）；唯一产地扩展，判定原子不动。
- Modify: `src/core/market-mutation.ts` —— L927 重抛改传结构化 reason（T1）。
- Modify: `src/core/profile-ops.ts` —— `DesktopOpsError` 加可选 `reason`；联合臂与 W2 边缘 catch 收拢为单一映射函数（T4）。
- Modify: `src/core/host-api.ts` —— errorStatus 加 `UpgradePathUnsupportedError` 专属臂 + default 臂注释更新（T3）；desktop 臂投影 `reason`（T4）。
- Modify: `src/core/market.ts` —— `InstalledItem.upgradePathReason` 字段 + 两装配点改 `stampUpgradeProjection`（T2）。
- Modify: `src/tools.ts` —— L260/421 投影透传 + L542 ListOut 类型（T2）；L618/670 成因标签换映射（T5）。
- Modify: `src/cli.ts` —— L348 成因标签换映射（T5）。
- Modify: `src/client/i18n.js` —— 退役 `installed.upgradeBatch.skippedUnsupported`（L36/164），新增 `installed.upgradeBatch.skipped.<code>` 四键中英（T6）。
- Modify: `src/client/installed-updates.js` —— `summarizeUnsupportedReasons` + `skippedUnsupportedNotice` 纯函数（T6）。
- Modify: `src/client/installed-tab.jsx` —— toast 接线换 notice 函数（T6）。
- Modify: `tests/upgrade-target.test.mjs`（T1/T2/T5 扩断言）、`tests/host-api-profile.test.mjs`（T1 构造形态、T3 ⑥ 改写、T4 desktop reason 用例）、`tests/profile-ops.test.mjs`（T4 扩断言）、`tests/market.test.mjs`（T2 投影断言、T5 行为/源结构锚改写）、`tests/client-installed-updates.test.mjs`（T6 新 describe）。
- 零触碰：`tests/fixtures/market-golden.json`（预期零 diff）、`src/core/merged-market.ts`（判据原子产地）、GLOSSARY。

## 任务间依赖

```
T1（错误类结构化）──→ T3（web 专属臂）──→ T4（desktop reason + W2 收拢）
T2（投影链）──────→ T5（cli/tools 文案）
              └────→ T6（client toast 分组）
T1-T6 全部 ────────→ T7（文档 + 0.11.3 发版）
```

---

### Task 1: UpgradePathUnsupportedError 携带结构化 reason（零行为，测试先行）

- 目标：错误对象携带 `{code, detail}`，message 模板字节不变；两抛点改传结构化 reason。
- Files: Modify `src/core/upgrade-target.ts`、`src/core/market-mutation.ts`、`tests/upgrade-target.test.mjs`、`tests/host-api-profile.test.mjs`
- 接口契约：
  - Consumes: `unsupportedReasonFor` 返回 `{code, detail}`（upgrade-target.ts:24，不动）；`resolveUpgradeTarget` 联合 `reason: {code, detail, message}`（upgrade-target.ts:98，`{code, detail}` 的结构子类型，直传兼容）。
  - Produces: `UpgradePathUnsupportedError` 构造签名 `(pkg: string, reason: { code: UnsupportedReasonCode; detail: string })`；`readonly reason: { code: UnsupportedReasonCode; detail: string }`；message 模板 `「${pkg}」无法自动升级：${reason.detail}`（与现行 `${reason}` 字节相同——现行第二参即 detail 字符串）。**抛点全量清点为 3 处**（评审 #1 修订）：① upgrade-target.ts:77（unsupportedReasonFor reason 对象直传）；② market-mutation.ts:927（`resolution.reason` 直传，结构子类型兼容）；③ upgrade-target.ts:86 `synthesizeInstallableEntry` 不可达兜底（现传 string `'github spec 可解析性复核失败（不可达兜底）'`）→ 改传 `{ code: 'github-spec-unparseable', detail: 'github spec 可解析性复核失败（不可达兜底）' }`——code 归 `github-spec-unparseable` 同域（github spec 可解析性失败），detail 原文冻结，message 模板产出字节不变；此兜底现为不可达路径（unsupportedReasonFor 已放行 github 可解析形态），无测试断言面，改造后由 typecheck 与既有 synthesize 分支测试间接保护。
- 验证范围：`tests/upgrade-target.test.mjs` / `tests/market-mutation.test.mjs` 既有断言零改动全绿（message 字节不变的物理证明）；全量门绿。
- [ ] Step 1: 写失败测试——`tests/upgrade-target.test.mjs` 新 describe「错误对象携带结构化 reason（#35）」：① 直接构造 `new UpgradePathUnsupportedError('p', { code: 'local-spec', detail: '本地开发安装（file:../p）不从线上更新' })` → `err.reason` deepEqual 构造参 + `err.message === '「p」无法自动升级：本地开发安装（file:../p）不从线上更新'`（逐字）+ `err.upgradePath === 'unsupported'`；② synthesize 抛出路径：`synthesizeInstallableEntry({ pkg: 'a', source: 'npm', spec: 'file:../a' })` rejects 且 `err.reason.code === 'local-spec'`；github 畸形 spec → `'github-spec-unparseable'`；unknown 源 → `'source-unresolvable'`。
- Run: `node scripts/build.mjs && node --test tests/upgrade-target.test.mjs`
- Expected: 红（现构造第二参 string，`err.reason` undefined）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 最小实现——类签名与 `reason` 字段按契约改造；**三抛点全量改造**（评审 #1）：`synthesizeInstallableEntry` L77 `throw new UpgradePathUnsupportedError(target.pkg, reason)`、同函数 L86 不可达兜底 `throw new UpgradePathUnsupportedError(target.pkg, { code: 'github-spec-unparseable', detail: 'github spec 可解析性复核失败（不可达兜底）' })`、`market-mutation.ts` L927 `throw new UpgradePathUnsupportedError(target.pkg, resolution.reason)`；`tests/host-api-profile.test.mjs:439` 构造改 `new UpgradePathUnsupportedError('p', { code: 'local-spec', detail: '本地开发安装（file:../p）不从线上更新' })`（该用例本步仍断言 failureClass，Task 3 才改写为信封断言）。
- [ ] Step 4: 运行并确认通过。
- Run: `npm test && npm run typecheck`
- Expected: 全量绿（market-mutation/profile-ops 既有断言零改动通过 = message 字节不变证明）。
- [ ] Step 5: checkpoint commit——`refactor(core): #35 UpgradePathUnsupportedError 携带结构化 reason（message 字节不变）`。

### Task 2: InstalledItem.upgradePathReason 投影链（行为增量：新增字段）

- 目标：成因码随已装列表投影到三端数据面；金样预期零 diff。
- Files: Modify `src/core/upgrade-target.ts`、`src/core/market.ts`、`src/tools.ts`、`tests/upgrade-target.test.mjs`、`tests/market.test.mjs`
- 接口契约：
  - Consumes: `upgradePathFor` / `unsupportedReasonFor`（Task 1 后的 upgrade-target.ts）。
  - Produces: `export function stampUpgradeProjection(item: { registryId?: string; spec?: string; source?: string } & { upgradePath?: UpgradePath; upgradePathReason?: UnsupportedReasonCode }): void`——`item.upgradePath = upgradePathFor(item)` + 仅 unsupported 时 `item.upgradePathReason = code`（条件赋值：catalog/synthesized 项字段缺席）；`InstalledItem.upgradePathReason?: UnsupportedReasonCode`（market.ts:252 旁）；tools ListOut items 类型（tools.ts:542）加 `upgradePathReason?: 'local-spec' | 'github-spec-unparseable' | 'source-unresolvable' | null`，L260/421 投影加 `upgradePathReason: it.upgradePathReason ?? null`。
- 验证范围：新断言绿；金样核验（预期零 diff）；全量门绿。
- [ ] Step 1: 写失败测试——① `tests/upgrade-target.test.mjs` 新 describe「stampUpgradeProjection（#35 投影）」表驱动：catalog 项（registryId 在）→ `upgradePath==='catalog'` 且 `!('upgradePathReason' in item)`；synthesized 项 → 同缺席；local-spec 项 → `upgradePathReason==='local-spec'`；github 畸形 → `'github-spec-unparseable'`；unknown 源 → `'source-unresolvable'`。② 装配层断言（评审 #2 修订：成因码产生地在 market.ts 装配层，mock 注入证明不了装配）——`tests/market.test.mjs` L454 describe「ADR-0026：upgradePath 投影」（fakeDeps 注入底层 + 直调真实 `listInstalledWithMeta`，stamp 点真实执行）：早退臂用例（L471-488，fixture 已具备三码场景）扩 `byReason` 断言——`pkg-local → 'local-spec'`、`pkg-mystery → 'source-unresolvable'`、`pkg-gh-bad → 'github-spec-unparseable'`、`pkg-1 → !('upgradePathReason' in item)`；健康臂用例（L458-469）加一个 `file:` 项 → `'local-spec'` 断言（评审计划外建议 a 采纳：健康臂装配点 :945 的 unsupported 场景覆盖，此前仅 catalog/synthesized）。③ 透传链断言——L1374 describe（`loadToolsWith` mock 注入 `installedResult`）：fixture p-local 项手工补 `upgradePathReason: 'local-spec'` → 断言 `out.items[1].upgradePathReason === 'local-spec'`（证明 tools execute 投影 map 白名单行生效；tools 层只透传不产生成因码，故 fixture 必须自带字段——若 map 未加该行则透传得 null，红）。
- Run: `node scripts/build.mjs && node --test tests/upgrade-target.test.mjs tests/market.test.mjs`
- Expected: 红（命名导出不存在）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 最小实现——upgrade-target.ts 导出 `stampUpgradeProjection`；market.ts import 并把两装配点（L937/945）循环体替换为 `stampUpgradeProjection(it)`（装配序不变：早退臂在 matchInstalled 前、健康臂在 registryId 写入后）；`InstalledItem` 接口加字段（`import type { UnsupportedReasonCode } from './upgrade-target.js'`）；tools.ts L260/421/542 按契约透传。
- [ ] Step 4: 运行并确认通过 + 金样核验。
- Run: `npm test && npm run typecheck && git diff --exit-code -- tests/fixtures/market-golden.json; echo "golden-diff-exit=$?"`
- Expected: 全量绿；`golden-diff-exit=0`（fixture 无 unsupported 项 + 条件赋值 → 零 diff）。若非 0：停止，逐键归因 diff 必须恰为 unsupported 项的 `upgradePathReason` 增量方可 `UPDATE_GOLDEN=1 npm run build && node --test tests/market-golden.test.mjs` 重生成，否则回滚修实现。
- [ ] Step 5: checkpoint commit——`feat(core): #35 InstalledItem.upgradePathReason 成因码投影链（web/tools 数据面）`。

### Task 3: host-api web 专属臂——409 + code + reason（行为变化主点①）

- 目标：web 梯 unsupported 信封升级为与 desktop 同构的 409 结构化信封。
- Files: Modify `src/core/host-api.ts`、`tests/host-api-profile.test.mjs`
- 接口契约：
  - Consumes: Task 1 `UpgradePathUnsupportedError.reason`。
  - Produces: errorStatus 新专属臂（置于 DesktopOpsError 臂后、default 臂前）：`{ status: 409, payload: { ok: false, error: err.message, code: 'upgrade-unsupported', failureClass: 'target', reason: { code: err.reason.code, detail: err.reason.detail } } }`；default 臂注释更新（移除 UpgradePathUnsupportedError 提及，注明专属臂接管、failureClass:'target' 批量语义不变）。
- 验证范围：⑥ 改写 + 三码表驱动新用例；①-⑤⑦ 零改动通过（default 臂与其余信封不动的证明）；全量门绿。
- [ ] Step 1: 写失败测试——`tests/host-api-profile.test.mjs` ⑥ 改写：`upgradeFailure(new UpgradePathUnsupportedError('p', { code: 'local-spec', detail: '本地开发安装（file:../p）不从线上更新' }))` → `r.status === 409` + `r.body.code === 'upgrade-unsupported'` + `r.body.failureClass === 'target'` + `r.body.reason` deepEqual `{ code: 'local-spec', detail: '本地开发安装（file:../p）不从线上更新' }` + `r.body.error` 逐字；另加三码表驱动（构造 `{code:'github-spec-unparseable',…}` / `{code:'source-unresolvable',…}` → reason.code 透传、status/code/failureClass 恒定）。
- Run: `node scripts/build.mjs && node --test tests/host-api-profile.test.mjs`
- Expected: 红（现 default 臂 500、无 code/reason）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 最小实现——host-api.ts 按契约加专属臂（import `UpgradePathUnsupportedError` 自 `./upgrade-target.js`）+ default 臂注释更新。
- [ ] Step 4: 运行并确认通过。
- Run: `npm test && npm run typecheck`
- Expected: 全量绿。
- [ ] Step 5: checkpoint commit——`feat(api): #35 web unsupported 信封升级 409+code+reason（对齐 desktop 形态）`。

### Task 4: DesktopOpsError.reason 透出 + W2 双翻译点收拢（行为变化主点②）

- 目标：desktop 信封新增可选 `reason` 字段；两翻译点收拢为单一映射函数。
- Files: Modify `src/core/profile-ops.ts`、`src/core/host-api.ts`、`tests/profile-ops.test.mjs`、`tests/host-api-profile.test.mjs`
- 接口契约：
  - Consumes: Task 1 结构化 reason；`DesktopOpsError` 现构造 `(code, message, details?)`（profile-ops.ts:71）。
  - Produces: `DesktopOpsError` 第四可选参——`constructor(code, message, details?, reason?: { code: UnsupportedReasonCode; detail: string })` + `readonly reason?`；errorStatus desktop 臂 payload 追加 `...(err.reason ? { reason: err.reason } : {})`；profile-ops 私有映射函数 `desktopUnsupportedError(reason: { code; detail; message }): DesktopOpsError`（= `new DesktopOpsError('upgrade-unsupported', reason.message, undefined, { code: reason.code, detail: reason.detail })`），联合臂（现 L1096-1098）与 W2 边缘 catch（现 L1087-1095，`{ code: err.reason.code, detail: err.reason.detail, message: err.message }` 喂入——message 直取 err.message 保字节）共用。
- 验证范围：profile-ops 信封用例扩断言；desktop 其余 20+ 抛点无 reason → 既有信封零变化（③④⑤ 用例零改动为证）；全量门绿。
- [ ] Step 1: 写失败测试——① `tests/profile-ops.test.mjs` L463-472 用例扩 rejects 断言 `err.reason` deepEqual `{ code: 'local-spec', detail: '本地开发安装（file:../pkg-a）不从线上更新；如需线上版本请先卸载后经 dsh-m 安装' }`（detail 文案按 unsupportedReasonFor 对 `spec:'file:../pkg-a'` 的逐字产出）；② `tests/host-api-profile.test.mjs` 新用例：`upgradeFailure(new DesktopOpsError('upgrade-unsupported', '「p」无法自动升级：d', undefined, { code: 'local-spec', detail: 'd' }))` → 409 + `code==='upgrade-unsupported'` + `reason` deepEqual + `failureClass==='target'`；再一条无第四参构造 → `r.body.reason === undefined`（字段缺席，既有信封零变化锚）。
- Run: `node scripts/build.mjs && node --test tests/profile-ops.test.mjs tests/host-api-profile.test.mjs`
- Expected: 红（`err.reason` undefined / 信封无 reason）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 最小实现——DesktopOpsError 第四参 + readonly 字段；errorStatus desktop 臂追加条件投影；profile-ops 收拢两翻译点为 `desktopUnsupportedError`（W2 catch 的 UpgradePathUnsupportedError 分支与联合臂都走它；catch 结构本身保留作 future-proof 兜底）。
- [ ] Step 4: 运行并确认通过。
- Run: `npm test && npm run typecheck`
- Expected: 全量绿；`tests/host-api-profile.test.mjs` ③④⑤ 零改动通过。
- [ ] Step 5: checkpoint commit——`feat(api): #35 desktop upgrade-unsupported 信封透出 reason；W2 双翻译点收拢`。

### Task 5: CLI/tools 成因文案按码映射（行为变化：文案）

- 目标：三处「本地链接安装」硬编码换 `unsupportedCauseLabel` 按码映射。
- Files: Modify `src/core/upgrade-target.ts`、`src/cli.ts`、`src/tools.ts`、`tests/market.test.mjs`
- 接口契约：
  - Consumes: Task 2 `upgradePathReason` 投影；Task 1 后的 upgrade-target.ts。
  - Produces: `export function unsupportedCauseLabel(code: UnsupportedReasonCode | undefined): string`——`'local-spec'→'本地链接安装'`、`'github-spec-unparseable'→'github spec 无法解析'`、`'source-unresolvable'→'来源不支持线上升级'`、其余→`'不支持线上升级'`（防御兜底）；cli.ts:348 与 tools.ts:670 后缀拼接 `· ${label}——不参与自动升级` 形态不变；tools.ts:618 标记位换 `unsupportedCauseLabel(it.upgradePathReason)`。
- 验证范围：行为锚 local-spec 场景文本不变（零改动）；新增 github-spec 场景断言；源结构锚改写；全量门绿。
- [ ] Step 1: 写失败测试——`tests/market.test.mjs` L1374 describe：① 加 github 畸形 spec 项（`spec: 'not-a-github-spec', source: 'github', outdated: true, upgradePath: 'unsupported', upgradePathReason: 'github-spec-unparseable'`）→ **行级断言**（评审 #4 修订，防与 :1396 全文本断言互斥）：renderOutdated 输出按 `\n` 分行、按该新项 pkg/name 定位其所在行，断言该行含 `'github spec 无法解析——不参与自动升级'` 且不含 `'本地链接安装'`；全文本级断言只保留 :1396 既有断言（p-local 行经映射后正确输出恰含「本地链接安装——不参与自动升级」，与 ① 并不矛盾）；② 源结构锚（L1399-1404）改写：`upgrade-target 源 split('本地链接安装') >= 1`、`tools 源 split('unsupportedCauseLabel') >= 2`、`cli 源 split('unsupportedCauseLabel') >= 1`（红：调用点不存在）。
- Run: `node scripts/build.mjs && node --test tests/market.test.mjs`
- Expected: ①② 红。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 最小实现——upgrade-target.ts 导出 `unsupportedCauseLabel`；cli.ts:348 → `` it.upgradePath === 'unsupported' ? ` · ${unsupportedCauseLabel(it.upgradePathReason)}——不参与自动升级` : '' ``；tools.ts:618/670 同构替换。
- [ ] Step 4: 运行并确认通过。
- Run: `npm test && npm run typecheck`
- Expected: 全量绿（local-spec 行为锚 1391/1396 零改动通过 = 原场景文案不变的证明；前提：Task 2 Step 1 ③ 已为 1374 fixture 的 p-local 补 `upgradePathReason: 'local-spec'`——该行为锚绿依赖此字段存在，孤立读本 Task 勿误判为自证）。
- [ ] Step 5: checkpoint commit——`fix(cli,tools): #35 unsupported 成因文案按码映射（github-spec 场景失实修复）`。

### Task 6: client 批量 toast 按码分组（行为变化：文案 + i18n 键系）

- 目标：跳过提示按成因分组，退役单段「本地链接安装」键。
- Files: Modify `src/client/installed-updates.js`、`src/client/installed-tab.jsx`、`src/client/i18n.js`、`tests/client-installed-updates.test.mjs`
- 接口契约：
  - Consumes: Task 2 `it.upgradePathReason`（batchUpgradeOrder 的 unsupported 数组携带原 item 引用，installed-updates.js:76）。
  - Produces:
    - `export function summarizeUnsupportedReasons(items): { 'local-spec': number; 'github-spec-unparseable': number; 'source-unresolvable': number; other: number }`——按 `it.upgradePathReason` 分桶，码值不在三闭集内（含缺席/垃圾项）归 `other`；
    - `export function skippedUnsupportedNotice(items, lookup): string | null`——固定序 local-spec → github-spec-unparseable → source-unresolvable → other，非零桶经 `lookup('installed.upgradeBatch.skipped.<code>', { n })` 拼接（空格连接），全零 → null；
    - i18n 新键四枚（中英同步）：`installed.upgradeBatch.skipped.local-spec`：`{n} 项为本地链接安装，未参与批量升级。` / `{n} item(s) are local linked installs and were not included in the batch upgrade.`；`…skipped.github-spec-unparseable`：`{n} 项 github spec 无法解析出仓库，未参与批量升级。` / `{n} item(s) have github specs that cannot be resolved to a repository and were not included in the batch upgrade.`；`…skipped.source-unresolvable`：`{n} 项来源不支持线上升级，未参与批量升级。` / `{n} item(s) come from sources that cannot be upgraded online and were not included in the batch upgrade.`；`…skipped.other`：`{n} 项不支持线上自动升级，未参与批量升级。` / `{n} item(s) cannot be upgraded online and were not included in the batch upgrade.`；退役 `installed.upgradeBatch.skippedUnsupported`（i18n.js L36/164）。
- 验证范围：新 describe 全绿；i18n audit 自动守卫（新键落字典 + ZH/EN 配对 + 退役键无 lookup 残留）；全量门绿。
- [ ] Step 1: 写失败测试——`tests/client-installed-updates.test.mjs` 新 describe（自带夹具）：① 分桶计数——三码各若干 + 缺席码项 + 非字符串码项 → 归 other；空数组/非数组 → 全零；② 拼接——单桶单段、多桶固定序、全零 → null；fake lookup 捕获键与 `{n}` 参数逐个比对；③ `summarizeBatch` 既有用例（L123-133）零改动仍绿。
- Run: `node scripts/build.mjs && node --test tests/client-installed-updates.test.mjs`
- Expected: 红（命名导出不存在）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 最小实现——installed-updates.js 两纯函数；installed-tab.jsx L178-180 改 `const notice = skippedUnsupportedNotice(batch.unsupported, lookup); if (notice) notify({ kind: 'warn', text: notice })`；i18n.js 删旧键两行、加新键四枚（中英各四）。
- [ ] Step 4: 运行并确认通过。
- Run: `npm test && npm run typecheck`
- Expected: 全量绿（含 client-i18n audit 与 ZH/EN 配对守卫）。
- [ ] Step 5: checkpoint commit——`feat(client): #35 批量升级跳过提示按成因分组（i18n 四键，退役单段本地链接文案）`。

### Task 7: 文档 + 0.11.3 发版 + 收尾

- 目标：CHANGELOG 双语顶条、版本三处、发版与 registry 轮询、ADR/issue 收尾、本机自升级验证。
- Files: Modify `CHANGELOG.md`、`package.json`、`package-lock.json`、`docs/adr/0028-upgrade-target-resolution-single-source.md`
- [ ] Step 1: CHANGELOG 双语顶条（中文区 + 英文区各 prepend 一条 0.11.3）——行为变化如实声明：web unsupported 500→409 + `code:'upgrade-unsupported'` + `reason{code,detail}` 透出；desktop 信封新增可选 `reason`（其余 DesktopOpsError 码信封不变）；CLI/tools/client 成因文案按码映射（github-spec 场景失实修复）；批量升级跳过提示按成因分组（i18n 键 `installed.upgradeBatch.skippedUnsupported` → `installed.upgradeBatch.skipped.<code>` 四键）；failureClass 语义与批量三态不变声明。
- [ ] Step 2: 版本三处——`package.json` version `0.11.2`→`0.11.3`；`package-lock.json` 两处 version 字段同步；commit message 归因全轮任务（CODING-STANDARDS：改写断言面逐一列入）。
- [ ] Step 3: 全量门——`npm test && npm run typecheck`（npm test 已含 lint + import 守卫 + 金样）；基线 1858/1858 对照，新增用例数归因。
- [ ] Step 4: 发版——`test -d node_modules` 预检 → `npm_config_cache=$HOME/workspace/.npm-ci-cache npm run release`（run_in_background，>90s）→ 按 know-how 018 轮询：npm publish（OIDC）Actions 绿 → npmjs registry 转正为准（窗口内不重推 tag）→ npmmirror sync PUT 收尾 → registry 描述/verified 按 know-how 008。
- [ ] Step 5: ADR-0028 Follow-up 清单 ② 行补「已实施（0.11.3）」注记；issue #35 关闭评论附信封样例（web/desktop 双端 JSON）+ 测试证据锚。
- [ ] Step 6: 本机自升级 0.11.2→0.11.3 并验证（探针：service active、127.0.0.1:3080=200、profile 实装版本）——宿主重启如涉当轮会话，按 know-how 037 分离式姿势并经主人确认后执行，禁当轮直接 restart。

## 执行纪律

- 开始实现前批判性复查整份计划；发现缺项/矛盾/验证命令无效先修计划再动码。
- 按任务顺序执行（依赖图），不无声跳步、合并步或改任务目标；每任务完成即跑该任务验证。
- 全量门命令统一：`npm test && npm run typecheck`（`npm test` = eslint tests + check-client-imports + pretest build + 全量 node --test）；管道显示时 `set -o pipefail` 保原始退出码。
- 计划中的行号为时点参考（2026-10-30 现场核实），消费时以符号锚优先；发现现场漂移先复核再改。
- 遇阻塞、重复失败或计划与仓库现实不符，立即停下说明，不猜。
- 当前分支 main（= v0.11.2 tag），主人已裁决本轮回合，开工无需再确认。

## 最终验证

- `npm test && npm run typecheck` 全绿（基线 1858 + 本轮新增 ≈ 15–20 用例，逐条可归因）。
- 金样 `git diff --exit-code -- tests/fixtures/market-golden.json` = 0（预期零 diff 证明）。
- 冻结面抽检：`DesktopOpsError` 非 upgrade-unsupported 码的信封字节（③④⑤ 用例）、B5 message 三文案（upgrade-target 既有断言）零改动通过。
- 手工探针（发版后，评审建议级补充采纳——前置生效判据可观测）：**前置条件 = 0.11.3 已发版且本机实例完成自升级、host 侧新代码已生效**（探针顺序：`ping.version` 读数 = 0.11.3 + service active 时间戳晚于升级时刻，健康 200 不作数），否则探针撞旧 500 行为造成误判；前置满足后：web 对 file: 安装项发起 upgrade → HTTP 409 + JSON 含 `code:'upgrade-unsupported'` 与 `reason.code:'local-spec'`；desktop 同语义项 → 409 + 同构 reason。
