# issue #77 + #78 双缺陷修复（win32 回滚阶梯 ENOENT · npmmirror 缺失依赖同步空转）实施计划

## 目标

- 修复 issue #77：Windows 上回滚收敛阶梯（`frozenInstall` / `rebuildInstall`）裸 spawn `pnpm` 必 ENOENT，回滚恒败、profile 被误报「可能需要人工修复」。
- 修复 issue #78：npmmirror 自愈（B3_NPMMIRROR_SYNC）恒同步用户请求的主包；主包镜像已同步而 pin 子依赖缺失时，重试预算（`[5_000, 15_000]`）两次全空转必然失败。
- 全量 `npm test` 零失败 + `npm run typecheck` 绿；**发版（`npm run release`）、issue 回帖、关闭 issue 不在本计划内**（批示门，见全局约束）。

## 架构快照

两缺陷出自同一条事故链（issue #78 报告者实测：dsh-mnemon 0.5.47→0.5.48 升级，npmmirror 镜像）：

```
dshm_upgrade → pnpm add 报 NO_MATCHING_VERSION（缺失的是 pin 子依赖 dsh-mnemon-source-memory-spaces@0.5.30）
  → B3 自愈 syncNpmmirror(req.pkg) 同步主包（主包已是 latest，空操作）→ 退避重试 ×2 全空转 → ADD_RETRY_EXHAUSTED
  → 回滚：字节还原成功 → frozenConvergeLadder → spawn pnpm（win32 裸 spawn）→ ENOENT
  → manualRepair →「依赖回滚也失败（spawn pnpm ENOENT），profile 可能需要人工修复」（实际 profile 账实一致，doctor 证实）
```

| # | 触点（行号 2026-11-18 本会话复核） | 缺口 | 后果 |
|---|---|---|---|
| 1 | `src/core/dsh-cli.ts` `makeDshRunner` `frozenInstall`（:909–921）/ `rebuildInstall`（:922–933），`runCommand('pnpm', ['--dir', profileDir, …])` 未传 `viaShell`；`runCommand` 内 `shell: options.viaShell === true`（:566） | win32 的 pnpm 是 npm 生成的 `.cmd` shim，Node `spawn` 在 `shell:false` 下不走 PATHEXT 解析 → 必 ENOENT（issue #77 三行 node 脚本逐字复现）。同文件 launch 路径已有同判据先例：`resolveDshLaunch` path-fallback `viaShell: platform === 'win32'`（:402），唯独回滚路径漏了 | 回滚阶梯恒败 → `manualRepair`（profile-transaction.ts :479 定义 · :240 文案「profile 可能需要人工修复」· :553–610 回滚二阶段消费链；2026-11-18 复核实读，评审 R1-Q5 修正原 :390/:114 误引）误报人工修复 |
| 2 | `src/core/dsh-cli.ts` `classifyPnpmError`（:287–309）NO_MATCHING 分支只出 `code`/`registry`，不从报错原文提取缺失包名；`src/core/profile-transaction.ts` `addWithLagRetry`（:660–668，if 臂判据在 :662）恒 `d.syncNpmmirror(req.pkg)` | pnpm 报错含稳定可解析片段 `No matching version found for <pkg>@<ver> while fetching it from <registry>`（issue #78 原文实测），无人消费 | 同步错包 → 自愈空转（issue #78 决定性实验：不改代码、手动 PUT 子包 syncs 端点 201 → 同一调用直接成功，因果钉死） |

**修法思路**（与两份 issue 的建议修法一致，落地形态如下）：

- #77：新增**纯函数** `pnpmInstallSpawnPlan(profileDir, mode, platform?)` 产出 spawn 计划（win32：`viaShell: true` + `detached: false` + `--dir` 参数双引号包裹；POSIX 全字段零漂移）；`makeDshRunner` 消费计划，并新增 `deps.runCommand` 注入缝（镜像同文件 `runDshPlugin` 的 `deps.runCommand ?? runCommand` 先例，dsh-cli.ts :677/:698）。
- #78：`classifyPnpmError` NO_MATCHING 分支**条件携带** `missingPackage`（贪婪捕获到最后一个 `@` 兼容 scoped 名；提取结果过包名白名单；提取失败字段缺席，行为同现状）；`addWithLagRetry` 缺失包 ≠ 主包时优先同步缺失包，未受理再主包兜底；缺失包 == 主包或无提取 → 单次主包同步（现状同形）。
- 多缺失包现实：一次 heal 只同步报错指向的第一个缺失包；`addWithLagRetry` 重试循环逐轮重分类，下一个缺失包在下一轮浮现（与镜像同步时序现实同构，不扩scope）。

已排查、判定**不触碰**：`runDshPlugin` 主链（win32 经 path-fallback 已有 viaShell 判据）；`npm-route.ts syncNpmmirrorPackage`（:209–219）的 `registry-direct.npmmirror.com/<pkg>/sync?sync_upstream=true` 端点——issue #78 报告者实测生效的是 `registry.npmmirror.com/-/package/<pkg>/syncs`，但 `registry-direct` 端点有 npm-route.test.mjs :5 记录的真实事故受理实证（HTTP 201），两端点均可用、报告者明示「不作断言」，不凭猜测更换；F1-R/B 进程组终止测试（POSIX-only，win32 skip，spawn 语义未变）。

## 全局约束

- **测试导入约定**（dsh-m/AGENTS.md）：`src/core/*.ts` 测试从 `lib/core/*.js` 引入——单套件绿确认前必须 `npm run build`；全量 `npm test` 的 `pretest` 自带 build。**当前盘上 lib/ 为陈旧产物**（评审 2026-11-18 实测：lib/core/profile-transaction.js 哈希 ≠ HEAD 新鲜构建，内容 pre-ADR-0037）——单套件判据一律发生在对应 Task 的 build 之后，**首个 build 前禁跑 profile-transaction 单套件**（会测到旧产物；跨会话续跑同此提醒，评审 R1-Q3）。
- **红先留证**：红灯确认区分两形态——加载失败（exit ≠ 0 + `does not provide an export` 错误文本，无 `not ok` 行属预期，不得数 not ok 判红）与断言失败（`not ok` 行 + 期望/实际值）。红灯必须落在目标断言行（CODING-STANDARDS）。
- **退出码卫生**：PowerShell 过滤显示前先落盘全量日志并保存 `$LASTEXITCODE`；后台包装任务的通知退出码不可信，判据 = 日志内 `EXIT=` 标记 + 计数行。
- **长命令纪律**：全量 `npm test` 预计 >90s，一律后台起跑、日志落 `.dsh-research/dshm-issue77-78-scratch/logs/`、经 `job_output` 收取。
- **同机单全量**：执行期间不并行第二个全量；全量在飞禁变异工作树（dsh-m/AGENTS.md）。
- **源锚纪律**：测试内报错文本均单行字符串拼接，无 `\n` 源锚（CRLF 纪律）；既有 `\n${pad}\n` 截断构造沿 :318 先例（合成文本非源锚，允许）。
- **分支**：本仓近期提交均直推 main（HEAD 2b17ccb 核于 2026-11-18）；**批准本计划视为同意在 main 提交**（如需特性分支请在批准时明示）。
- **批示门**（dsh-m/AGENTS.md「Releasing」）：`npm run release`、issue #77/#78 回帖、关闭 issue 均需当轮主人明确批示；本计划只到「提交 + 草稿呈报」为止。
- **明确不做**（超出即停下）：① 更换 npmmirror sync 端点；② 失败信封残缺文本（两 issue 附带观察，低优先，另行处理）；③ 回滚失败文案的严重性降级（「可能需要人工修复」的语义调整——#77 根因修复后该文案仅剩真实收敛失败路径才会出现，文案层另行战役）；④ 路径面 `%VAR%` 展开门（注释记录风险，不加运行时门）。
- 无额外版本下限/依赖/命名约束（纯 `src/core` 逻辑 + tests，零新依赖）。

## 输入工件

- issue #77：`gh api repos/iasiv5/dsh-m/issues/77`（全文已取证于本会话，2026-11-18；0 评论）
- issue #78：`gh api repos/iasiv5/dsh-m/issues/78`（同上）
- 现场核对：`src/core/dsh-cli.ts`（:287–309 / :350–423 / :549–568 / :676–711 / :780–935）、`src/core/profile-transaction.ts`（:126–141 / :387–419 / :613–683）——全部本会话实读
- 测试现状：`tests/pnpm-outcome.test.mjs`（324 行，含登记预改）、`tests/profile-transaction.test.mjs`（2398 行）、`tests/fixtures/pnpm-errors.mjs`——全部本会话实读

## 现状登记（侦察轮预改）

工作树已有一处预改（2026-11-18 侦察）：`tests/pnpm-outcome.test.mjs` import 块新增 `pnpmInstallSpawnPlan`（dsh-cli.js 导出名）。这是 Task 1 的组成部分，**批准后从补 describe 开始，不重做、不回滚**。预改使该文件 :17 之后行号整体 +1——**本计划内 pnpm-outcome.test.mjs 的行号均为预改后口径**（评审 R1-Q2）。除此之外工作树干净（main @ 2b17ccb）。

【执行前增补 2026-11-18】主人批示：批准执行，评审终审建议 1（win32 真实 shell 级防线用例）纳入本次——Task 1 增至三个 describe（4 红驱动 + 1 绿钉）；建议 2（Step 2 前一行 lib 哈希石证）与建议 3（:660–668 叙事锚统一）一并落实。新 describe 自包含（用例内动态 import，不碰文件头 import 块），**既有行号锚不受二次漂移影响**。评审 3 轮 6 项闭环结论「可以进入执行」+ 本增补构成执行基线。

## 需求基线

- **B1**（#77）：`pnpmInstallSpawnPlan(dir, 'frozen'|'rebuild', 'win32')` → `{ file: 'pnpm', viaShell: true, detached: false, args: ['--dir', '"<dir>"', 'install', <flag>] }`（flag：frozen → `--frozen-lockfile`，rebuild → `--no-frozen-lockfile`）。
- **B2**（#77）：POSIX（`'linux'`）→ `viaShell: false`、`detached: true`、路径不加引号——与 HEAD 行为零漂移。
- **B3**（#77）：`makeDshRunner(dir, name, { runCommand })` 注入缝生效：frozen/rebuild 把计划透传给注入的 `runCommand`（`viaShell === (platform === 'win32')`、`detached === (platform !== 'win32')`、flag 正确）；缺省仍用模块 `runCommand`，真实 spawn 语义（CI env、timeout、signal）不变。
- **B4**（#78）：`classifyPnpmError` 对 NO_MATCHING 文本提取缺失包名（主包名与 scoped 名皆可），条件携带 `missingPackage`；无「found for」句式 / 非 NO_MATCHING 类 / 提取结果非合法包名 → 字段缺席。截断线外的特征串仍提取（分类先于截断，与 registry 识别同款）。
- **B5**（#78）：`registry === 'npmmirror'` 且 `missingPackage` 存在且 ≠ `req.pkg` → 只同步缺失包（1 次调用），heal `B3_NPMMIRROR_SYNC` 注明包名且保留 `+npmmirror sync` 锚，`clearLatestCache` 照常触发。
- **B6**（#78）：缺失包同步未受理（false）→ 主包兜底同步（共 2 次调用）；`missingPackage` == `req.pkg` 或字段缺席 → 单次主包同步（与 HEAD 行为同形，heal note 原文案不变）。
- **B7**：既有回归零漂移——B3 套件（profile-transaction.test.mjs :2039 committed 路径 / :2078 registry=null / :2119 kill switch 集成）、rollback-heal.test.mjs 验收 3/兜底、F1-R/B（win32 skip）、pnpm-outcome 全部既有分类用例。
- **B8**：全量 `npm test` 零失败（新增 13 例：#77 5（含 1 条真实 shell 级绿钉）+ #78 分类 5 + #78 事务 3）+ `npm run typecheck` exit 0。若现环境既有失败，跑 `node scripts/test-baseline.mjs` 结构化判别（禁止手搓管道对照），回归零容忍、既有失败如实登记。
- **R2 覆盖口径**（#77 期望②，评审 R1-Q4 采纳）：B1 修复后，「字节还原成功 + 收敛 ENOENT → 误报人工修复」的事故路径不可达（issue #77 场景消除）；R2 的文案层诉求（「可能需要人工修复」措辞降级）按「明确不做③」另行战役，回帖草案中向报告者说明——R2 以根因消除方式覆盖，本计划不做文案改动。

## 断言面清点（计划期 grep tests/ + src/，2026-11-18 实录）

| 触点 | 现状断言 | 受本计划影响 | 处置 |
|---|---|---|---|
| `tests/pnpm-outcome.test.mjs:49` `deepEqual(classifyPnpmError(NO_MATCHING_TEXT), …)` | 全形状 `{class, code, registry}` | **是**（NO_MATCHING 分支新增条件字段） | Task 3 同改：`missingPackage: '@iasiv5/dsh-skins'`（夹具文本含该包名，贪婪捕获实证） |
| `tests/pnpm-outcome.test.mjs:54`（UNUSED_PATCH deepEqual） | 全形状三键 | 无（字段只在 NO_MATCHING 分支条件携带，非 NO_MATCHING 类不出现） | Task 4 绿确认复跑 |
| `tests/pnpm-outcome.test.mjs:309–323`（registry 识别 / 截断线外） | 只断 `class`/`registry` | 无 | Task 4 绿确认复跑 |
| `tests/profile-transaction.test.mjs:2035–2115`（B3 registry-aware 套件） | `syncs` 记录 `['pkg-a']` + `+npmmirror sync` note | 无（夹具文本 `pkg-a@1.2.3`，缺失包 == req.pkg → 走主包路径，行为同形） | Task 6 绿确认复跑 |
| `tests/profile-transaction.test.mjs:2119–2160`（kill switch 集成，缺省 sync 实现） | 零网络、零 heal | 无（`DSHM_MIRROR_SYNC=0` 下 sync 恒 false） | Task 6 绿确认复跑 |
| `tests/rollback-heal.test.mjs:275–338`（验收 3 / 兜底） | add 抛 `NO_MATCHING`（无 registry URL）→ registry null | 无（不进 sync 分支，门位置不动） | Task 7 全量覆盖 |
| `tests/versions.test.mjs:690–864`（`npmVersion` 阶梯 syncNpmmirror 桩） | packument 层履约链 | 无（非本链，不触碰） | 不涉 |
| `tests/pnpm-outcome.test.mjs:255–303`（F1-R/B 真实 spawn） | POSIX-only（win32 skip） | 无（POSIX spawn 计划零漂移） | Task 2 绿确认复跑（win 本机 skip 形态核过） |
| 新增·真实 shell 级绿钉（Task 1 第三个 describe；评审终审建议 1，主人 2026-11-18 批示纳入） | 无既有用例（本行为新增防线） | 无（**绿钉：现状即绿**——`runCommand` 的 `viaShell` 形参 HEAD 已实现（:549–568），用例钉「真实 pnpm cmd shim 经 shell 可解析 + 引号交互不炸」这一环境契约不被未来回归；红驱动由同文件 seen 接线断言承担；PATH 无 pnpm 的环境整体 skip（t.skip），不假红） | Task 2 Step 4 绿确认（或合法 skip） |
| src 消费面：classify 结果 spread 于 `dsh-cli.ts:785/:826/:880`；`profile-transaction.ts:662` 消费 `code`/`registry` | — | 新字段经 spread 自动携带；:662 臂扩消费 `missingPackage` | Task 4/6 实现 |
| `makeDshRunner` 消费者（upgrade/market 各事务注入 runner） | 注入 stub 对象不受影响 | 无（deps 新增可选键，JS 注入向后兼容） | Task 7 全量覆盖 |
| 「#77 接线无既有覆盖」复搜 | 双 pattern 全 tests 扫读（2026-11-18 评审与执行双方实测一致）：A `frozenInstall\|rebuildInstall\|B3_NPMMIRROR_SYNC\|syncNpmmirror\|NO_MATCHING_VERSION` 命中 80 处；B `frozenInstall\|rebuildInstall\|viaShell\|runCommand` 命中 95 处（B 比 A 多 15 处 = 总数差 95−80，非集合差；B 独有行——含 viaShell/runCommand 而无 A 词——共 46 处：dsh-cli-governance 18 / run-command-error-digest 14 / dsh-launch 8 / restart 5 / exec-route 1，均非 frozen/rebuild spawn options 形态；A 独有 31 处、两 pattern 行重叠 49 处，评审 R2-Q6 口径修正）。结论：无一断言 spawn options 形态（F1-R/B 只钉进程树终止） | — | Task 1 新增接线用例即为防线 |

## 文件结构与职责

- Modify: `src/core/dsh-cli.ts` — ① 新导出纯函数 `pnpmInstallSpawnPlan`（#77 spawn 计划唯一产地）；② `makeDshRunner` deps 增 `runCommand` 缝 + frozen/rebuild 消费计划；③ 新增 `MISSING_PKG_RE` + `missingPackageOf` + `RunnerOutcome.missingPackage?` + classify NO_MATCHING 分支条件携带（#78）。
- Modify: `src/core/profile-transaction.ts` — `addWithLagRetry`（:650–683）缺失包优先、主包兜底（#78 唯一消费点）。
- Modify: `tests/pnpm-outcome.test.mjs` — Task 1 追加 #77 两个 describe（4 例）；Task 3 追加提取 describe（5 例）+ 改写 :49 deepEqual（唯一断言面改写处）。
- Modify: `tests/profile-transaction.test.mjs` — Task 5 新增 1 个 describe（3 例；自带 `SUB_DEP_MISSING` 逐字文本与 `succeedSecondAdd` helper，不跨 describe 引用闭包；文件顶层 helper `makeProfile`/`manifest`/`lockFile`/`mockRunner`/`failWith`/`baseTx`/`healCodes` 为既有公共夹具，允许复用）。
- Create: 无源码新文件；本计划文档自身（docs/plans/）。
- 文档：CHANGELOG 双语条目与 issue #77/#78 回帖**只起草不提交**（Task 7 呈报草案，随发版批示落位）。

## 任务清单

### Task 1 — tests/pnpm-outcome.test.mjs：#77 红线（写红）

- **Step 0**（前置检查）：`Test-Path D:\_dsh-workspace\dsh-m\node_modules` → True（缺失则按 workspace AGENTS 依赖恢复，停下说明）。确认 import 预改在场（`pnpmInstallSpawnPlan` 已在 import 块）。
- **Step 1**（写失败测试）：文件尾（registry 源识别 describe 之后）追加三个 describe（前两个 4 例为红驱动；第三个 1 例为真实 shell 级绿钉，主人 2026-11-18 批示纳入，评审终审建议 1）：

```js
// ---------- 回滚/重建 install 的 spawn 计划（issue #77）：win32 裸 spawn pnpm 必 ENOENT ----------

describe('pnpmInstallSpawnPlan（issue #77）', () => {
  it('win32：viaShell=true + detached=false + --dir 双引号包裹（cmd 分词防护）', () => {
    const p = pnpmInstallSpawnPlan('C:\\Users\\J O\\.dsh\\profiles\\aqua', 'frozen', 'win32')
    assert.equal(p.file, 'pnpm')
    assert.equal(p.viaShell, true)
    assert.equal(p.detached, false)
    assert.deepEqual(p.args, ['--dir', '"C:\\Users\\J O\\.dsh\\profiles\\aqua"', 'install', '--frozen-lockfile'])
  })

  it('win32 rebuild：--no-frozen-lockfile 同款 shell 形态', () => {
    const p = pnpmInstallSpawnPlan('C:\\p', 'rebuild', 'win32')
    assert.deepEqual(p.args, ['--dir', '"C:\\p"', 'install', '--no-frozen-lockfile'])
    assert.equal(p.viaShell, true)
    assert.equal(p.detached, false)
  })

  it('POSIX：viaShell=false + detached=true + 路径不加引号（既有行为零漂移）', () => {
    const p = pnpmInstallSpawnPlan('/tmp/profile-x', 'frozen', 'linux')
    assert.equal(p.viaShell, false)
    assert.equal(p.detached, true)
    assert.deepEqual(p.args, ['--dir', '/tmp/profile-x', 'install', '--frozen-lockfile'])
  })
})

describe('makeDshRunner frozen/rebuild 接线（issue #77）：spawn 计划透传 runCommand', () => {
  it('frozenInstall/rebuildInstall 把计划交给 deps.runCommand（viaShell/detached 随平台）', async () => {
    const seen = []
    const fakeRunCommand = async (file, args, options) => {
      seen.push({ file, args, options })
      return 'installed'
    }
    const runner = makeDshRunner('C:\\Users\\J O\\.dsh\\profiles\\aqua', 'aqua', { runCommand: fakeRunCommand })
    const outF = await runner.frozenInstall()
    const outR = await runner.rebuildInstall()
    assert.equal(outF.class, 'ok')
    assert.equal(outR.class, 'ok')
    assert.equal(seen.length, 2)
    assert.equal(seen[0].file, 'pnpm')
    assert.equal(seen[0].options.viaShell, process.platform === 'win32')
    assert.equal(seen[0].options.detached, process.platform !== 'win32')
    assert.ok(seen[0].args.includes('--frozen-lockfile'))
    assert.ok(seen[1].args.includes('--no-frozen-lockfile'))
    assert.equal(seen[1].options.viaShell, process.platform === 'win32')
    if (process.platform === 'win32') {
      assert.ok(seen[0].args.some((a) => a.startsWith('"') && a.includes('profiles\\aqua')), JSON.stringify(seen[0].args))
    }
  })
})
```

  第三个 describe（绿钉——自包含动态 import，不碰文件头 import 块，既有行号锚零漂移；动态 import 先例 versions.test.mjs `_setWireFetchForTests`）：

```js
// ---------- win32 真实 shell 级防线（issue #77 增强用例，评审终审建议 1） ----------
// 绿钉性质：runCommand 的 viaShell 形参 HEAD 已实现（:549–568），本用例钉「真实 pnpm
// cmd shim 经 shell 可解析 + 引号交互不炸」的环境契约不被未来回归；红驱动由上方 seen
// 接线断言承担。PATH 无 pnpm 的环境整体 t.skip（探测经 shell:true spawnSync，不假红）。

describe('win32 真实 shell 级防线（issue #77）', () => {
  it('runCommand 经 viaShell spawn 真实 pnpm → 非 ENOENT、输出版本号（win32 验证 cmd shim 解析；POSIX 验证直启不回归）', async (t) => {
    const { spawnSync } = await import('node:child_process')
    const probe = spawnSync('pnpm', ['--version'], { shell: true, encoding: 'utf8' })
    if (probe.status !== 0) return t.skip(`PATH 上无 pnpm（shell 探测 status=${probe.status}），本环境不适用`)
    const { runCommand } = await import('../lib/core/dsh-cli.js')
    const out = await runCommand('pnpm', ['--version'], { timeoutMs: 30_000, viaShell: process.platform === 'win32' })
    assert.match(out, /^\d+\.\d+/)
  })
})
```

- **Step 2**（确认红）——先固化盘上 lib 哈希石证（红前提 = 盘上 lib 对应 HEAD 构建产物；评审终审建议 2）：

```powershell
$scr = 'D:\_dsh-workspace\.dsh-research\dshm-issue77-78-scratch\logs'
$h = (Get-FileHash D:\_dsh-workspace\dsh-m\lib\core\dsh-cli.js -Algorithm SHA256).Hash
Add-Content -Path "$scr\t01-lib-hash.txt" -Value "pre-red dsh-cli.js SHA256=$h $(Get-Date -Format o)"
$log = "$scr\t01-red-pnpm-outcome.log"
node --test tests/pnpm-outcome.test.mjs *> $log; "EXIT=$LASTEXITCODE" >> $log
```

  Expected：exit ≠ 0，日志含 `SyntaxError … does not provide an export named 'pnpmInstallSpawnPlan'`（加载失败红：无 `not ok` 行属预期，红确认 = 非零退出 + 该错误文本；接线用例在 HEAD 上的独立红因 = `deps.runCommand` 被忽略、真实 spawn 'pnpm' 走 `hard-fail`/`seen.length` 0，Task 2 落地后即为绿防线）。
- **验证命令**：Step 2 一条。

### Task 2 — src/core/dsh-cli.ts：#77 spawn 计划 + 接线缝（最小实现）

- **Step 3**（实现）：
  - `resolveDshLaunch`（:403）之后新增：

```ts
/**
 * 回滚/重建 install 的 spawn 计划（issue #77）：win32 的 pnpm 是 npm 生成的 .cmd shim，
 * 裸 spawn（shell:false）不走 PATHEXT 解析 → 必然 ENOENT。viaShell 兜底与 launch 路径
 * path-fallback（resolveDshLaunch 的 `viaShell: platform === 'win32'`）同判据；经 shell 时
 * Node 不转义参数，--dir 路径含空格会被 cmd 分词——双引号包裹（Windows 文件名禁止双引号，
 * 路径不含引号；`%VAR%` 展开风险与 runDshPlugin 的 isCmdSafeProfileName 门同理，路径面
 * 暂无先例门，此处注释记录）。POSIX 全字段零漂移（不引号、viaShell false、detached true）。
 */
export function pnpmInstallSpawnPlan(
  profileDir: string,
  mode: 'frozen' | 'rebuild',
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[]; viaShell: boolean; detached: boolean } {
  const win32 = platform === 'win32'
  const dirArg = win32 ? `"${profileDir}"` : profileDir
  const flag = mode === 'frozen' ? '--frozen-lockfile' : '--no-frozen-lockfile'
  return { file: 'pnpm', args: ['--dir', dirArg, 'install', flag], viaShell: win32, detached: !win32 }
}
```

  - `makeDshRunner`（:890）签名 deps 增缝（注释对齐 :887 既有 ADR-0030 缝说明）：

```ts
  deps: { runDshPlugin?: PluginRunner; runCommand?: typeof runCommand } = {},
```

  - `frozenInstall` / `rebuildInstall` 两个方法体改为消费计划（保留原 try/catch 与 800 截断；F1-R 注释保留）：

```ts
    async frozenInstall(signal?: AbortSignal): Promise<RunnerOutcome> {
      try {
        const plan = pnpmInstallSpawnPlan(profileDir, 'frozen')
        // F1-R：detached 使 pnpm（及其后代）进入独立进程组，abort/超时可整组终止
        //（win32 经 shell，无进程组语义，取消走 child.kill——与主链 win32 形态一致）
        const output = await (deps.runCommand ?? runCommand)(plan.file, plan.args, {
          timeoutMs: installTimeoutMs(),
          signal,
          viaShell: plan.viaShell,
          detached: plan.detached,
        })
        return { class: 'ok', output: output.length <= 800 ? output : output.slice(-800) }
      } catch (err) {
        return rawOutcome(errText(err))
      }
    },
```

  （`rebuildInstall` 同款，`pnpmInstallSpawnPlan(profileDir, 'rebuild')`。）
- **Step 4**（确认绿）：`npm run build *> <log>; "EXIT=$LASTEXITCODE" >> <log>` exit 0 → 单套件：

```powershell
$log = 'D:\_dsh-workspace\.dsh-research\dshm-issue77-78-scratch\logs\t02-green-pnpm-outcome.log'
node --test tests/pnpm-outcome.test.mjs *> $log; "EXIT=$LASTEXITCODE" >> $log
```

  Expected：exit 0、fail 0（Task 1 新增 5 例：4 例红驱动转绿 + 真实 shell 级绿钉绿——本机 win32 有 pnpm 应实跑非 skip，输出含 pnpm 版本号；既有全绿；F1-R/B 在 win32 为 skip 形态）。若 build 报 `spawn EPERM`，按沙箱规则对同一条命令以 workspace-write/danger-full-access 一次性重试（workspace AGENTS「构建子进程与沙箱」）。
- **验证命令**：Step 4 两条（build + 单套件）。
- Consumes：无（文件内既有 `runCommand`/`installTimeoutMs`/`rawOutcome`/`errText`）。
- Produces：`pnpmInstallSpawnPlan`（导出）、`makeDshRunner` 第三参 `deps.runCommand` 缝——Task 1 用例与 Task 7 全量消费。

### Task 3 — tests/pnpm-outcome.test.mjs：#78 分类层红线（写红）

- **Step 1**（写失败测试）：
  1. `:49` deepEqual 改写（断言面清点唯一改写处）：NO_MATCHING 形状对象追加一行 `missingPackage: '@iasiv5/dsh-skins',`。
  2. 文件尾追加：

```js
// ---------- classifyPnpmError 缺失包提取（issue #78） ----------

describe('classifyPnpmError 缺失包提取（issue #78）', () => {
  it('主包名形态：found for <pkg>@<ver> → missingPackage 携出', () => {
    const c = classifyPnpmError('ERR_PNPM_NO_MATCHING_VERSION No matching version found for dsh-mnemon@0.5.48 while fetching it from https://registry.npmmirror.com/')
    assert.equal(c.missingPackage, 'dsh-mnemon')
  })

  it('pin 子依赖（issue #78 事故同形）与 scoped 名（贪婪到最后一个 @）', () => {
    const sub = classifyPnpmError('ERR_PNPM_NO_MATCHING_VERSION No matching version found for dsh-mnemon-source-memory-spaces@0.5.30 while fetching it from https://registry.npmmirror.com/')
    assert.equal(sub.missingPackage, 'dsh-mnemon-source-memory-spaces')
    assert.equal(classifyPnpmError(NO_MATCHING_TEXT).missingPackage, '@iasiv5/dsh-skins')
  })

  it('特征串位于 800 字截断线之外仍提取（分类先于截断，与 registry 识别同款）', () => {
    const pad = 'x'.repeat(900)
    const text = `ERR_PNPM_NO_MATCHING_VERSION No matching version found for pkg-dep@0.1.0\n${pad}\nfrom https://registry.npmmirror.com/`
    assert.ok(text.length > 800)
    assert.equal(classifyPnpmError(text).missingPackage, 'pkg-dep')
  })

  it('无「found for」句式 / 非 NO_MATCHING 类 → 字段缺席（负向锚：现状即绿——HEAD 本就不携带该字段）', () => {
    const bare = classifyPnpmError('ERR_PNPM_NO_MATCHING_VERSION while fetching it from https://registry.npmmirror.com/')
    assert.ok(!('missingPackage' in bare))
    assert.ok(!('missingPackage' in classifyPnpmError(OUTDATED_LOCKFILE_TEXT)))
  })

  it('「found for」后非合法包名（多段路径）→ 不携带（负向锚：现状即绿，同上机制）', () => {
    const junk = classifyPnpmError('ERR_PNPM_NO_MATCHING_VERSION No matching version found for ../../etc/passwd@1.0.0 while fetching it from https://registry.npmmirror.com/')
    assert.ok(!('missingPackage' in junk))
  })
})
```

- **Step 2**（确认红）：命令同 Task 1 Step 2（日志名 `t03-red-pnpm-outcome.log`）。Expected：断言失败红（非加载失败）——用例 1/2/3 红（`missingPackage` 实际 `undefined`）+ `:49` deepEqual 红；用例 4/5 **绿**（负向锚，机制已注明：HEAD 无该字段，缺席断言天然成立）。
- **验证命令**：Step 2 一条。

### Task 4 — src/core/dsh-cli.ts：#78 missingPackage 提取（最小实现）

- **Step 3**（实现）：
  - `classifyPnpmError`（:287）之前新增：

```ts
/** npm 包名白名单（与 packument.ts PKG_RE 同形；本地副本——packument 未导出该常量且 dsh-cli 不依赖其模块图，防 import 图扩大）。 */
const MISSING_PKG_RE = /^@?[A-Za-z0-9-._~]+(\/[A-Za-z0-9-._~]+)?$/

/**
 * 从 pnpm「缺包」报错原文提取缺失包名（issue #78）：`No matching version found for <pkg>@<ver>`
 * ——捕获组贪婪到最后一个 @，兼容 scoped 名（@scope/pkg@1.2.3 → @scope/pkg）；
 * 提取结果过包名白名单，防把周边文本当包名。提取不到返回 undefined。
 */
function missingPackageOf(raw: string): string | undefined {
  const m = /No matching version found for (\S+)@/.exec(raw)
  const candidate = m?.[1]
  return candidate !== undefined && MISSING_PKG_RE.test(candidate) ? candidate : undefined
}
```

  - `RunnerOutcome`（:261–273）增可选字段（置于 `registry` 之后）：

```ts
  /** 仅 NO_MATCHING_VERSION：报错原文指向的缺失包名（主包或 pin 子依赖；issue #78）。提取失败缺席。 */
  readonly missingPackage?: string
```

  - classify NO_MATCHING 分支（:294–296）改为条件携带（对齐 `buildApprovals` 仅 ok 才携带的先例）：

```ts
  if (raw.includes(PNPM_OUTCOME_CODES.NO_MATCHING_VERSION)) {
    const missing = missingPackageOf(raw)
    return {
      class: 'retryable-lag',
      code: PNPM_OUTCOME_CODES.NO_MATCHING_VERSION,
      registry,
      ...(missing !== undefined ? { missingPackage: missing } : {}),
    }
  }
```

- **Step 4**（确认绿）：

```powershell
$scr = 'D:\_dsh-workspace\.dsh-research\dshm-issue77-78-scratch\logs'
$b = "$scr\t04-build.log"; npm run build *> $b; "EXIT=$LASTEXITCODE" >> $b
$log = "$scr\t04-green-pnpm-outcome.log"; node --test tests/pnpm-outcome.test.mjs *> $log; "EXIT=$LASTEXITCODE" >> $log
$t = "$scr\t04-typecheck.log"; npm run typecheck *> $t; "EXIT=$LASTEXITCODE" >> $t
```

  Expected：三条 exit 均 0；单套件 fail 0（Task 3 全部 5 例绿 + :49 改写绿 + Task 1 4 例绿 + 既有全绿）。若 build 报 `spawn EPERM`，按沙箱规则对同一条命令以 workspace-write/danger-full-access 一次性重试（workspace AGENTS「构建子进程与沙箱」）。
- **验证命令**：Step 4 一条（三命令串）。
- Consumes：Task 3 的用例与 :49 期望形状。
- Produces：`RunnerOutcome.missingPackage`（Task 5 夹具经 `failWith` 的 classify spread 自动携带；Task 6 消费）。

### Task 5 — tests/profile-transaction.test.mjs：#78 事务层红线（写红）

- **Step 1**（写失败测试）：`describe('B3 registry-aware npmmirror sync（L2，ADR-0012）'…)` 结束（:2115 `})`）与 `// ---------- B3 kill switch 集成` 注释（:2117）之间插入：

```js
// ---------- B3 缺失依赖优先同步（issue #78）：报错指向子依赖缺时同步主包是空转 ----------

describe('B3 缺失依赖优先同步（issue #78）', () => {
  let dir = ''
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  // issue #78 事故同形逐字文本：主包镜像已同步（=latest），pin 子依赖缺失
  const SUB_DEP_MISSING = '命令失败 (exit 1): ERR_PNPM_NO_MATCHING_VERSION No matching version found for dsh-mnemon-source-memory-spaces@0.5.30 while fetching it from https://registry.npmmirror.com/'

  // 第二次 add 的成功落盘（镜像 :2050-2054 夹具形态，包名换 dsh-mnemon）
  function succeedSecondAdd() {
    writeFileSync(join(dir, 'package.json'), manifest({ dependencies: { existing: '^1.0.0', 'dsh-mnemon': '0.5.48' } }))
    writeFileSync(join(dir, 'pnpm-lock.yaml'), lockFile({ pkg: 'dsh-mnemon', version: '0.5.48', integrity: sha512('good'), withOverrides: false }))
    return { class: 'ok', output: 'added' }
  }

  it('报错指向子依赖 → 只同步子依赖（1 次），heal 注明包名，主包不动', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const syncs = []
    const { runner } = mockRunner({ add: [failWith(SUB_DEP_MISSING), succeedSecondAdd] })
    const r = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'dsh-mnemon', version: '0.5.48', integrity: sha512('good') },
      baseTx(dir, runner, {
        retryDelaysMs: [0],
        syncNpmmirror: async (pkg) => { syncs.push(pkg); return true },
        clearLatestCache: () => {},
      }),
    )
    assert.equal(r.status, 'committed', `heals=${JSON.stringify(r.healActions)}`)
    assert.deepEqual(syncs, ['dsh-mnemon-source-memory-spaces'])
    const note = r.healActions.find((h) => h.code === 'B3_NPMMIRROR_SYNC')?.note ?? ''
    assert.ok(note.includes('dsh-mnemon-source-memory-spaces'), note)
    assert.ok(note.includes('+npmmirror sync'), note)
  })

  it('子依赖同步未受理 → 主包兜底（2 次），heal 仍记 B3_NPMMIRROR_SYNC', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const syncs = []
    const { runner } = mockRunner({ add: [failWith(SUB_DEP_MISSING), succeedSecondAdd] })
    const r = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'dsh-mnemon', version: '0.5.48', integrity: sha512('good') },
      baseTx(dir, runner, {
        retryDelaysMs: [0],
        syncNpmmirror: async (pkg) => { syncs.push(pkg); return pkg !== 'dsh-mnemon-source-memory-spaces' },
        clearLatestCache: () => {},
      }),
    )
    assert.equal(r.status, 'committed', `heals=${JSON.stringify(r.healActions)}`)
    assert.deepEqual(syncs, ['dsh-mnemon-source-memory-spaces', 'dsh-mnemon'])
    assert.ok(healCodes(r).includes('B3_NPMMIRROR_SYNC'))
  })

  it('报错无可提取包名 → 退回主包同步（既有语义；负向锚：现状即绿——HEAD 恒同步 req.pkg，新逻辑提取失败同形）', async () => {
    dir = makeProfile({
      'package.json': manifest({ dependencies: { existing: '^1.0.0' } }),
      'pnpm-lock.yaml': lockFile(),
      'pnpm-workspace.yaml': 'packages:\n  - .\n',
    })
    const BARE = '命令失败 (exit 1): ERR_PNPM_NO_MATCHING_VERSION while fetching it from https://registry.npmmirror.com/'
    const syncs = []
    const { runner } = mockRunner({ add: [failWith(BARE), succeedSecondAdd] })
    const r = await runProfileTransaction(
      { kind: 'install-npm', pkg: 'dsh-mnemon', version: '0.5.48', integrity: sha512('good') },
      baseTx(dir, runner, {
        retryDelaysMs: [0],
        syncNpmmirror: async (pkg) => { syncs.push(pkg); return true },
        clearLatestCache: () => {},
      }),
    )
    assert.equal(r.status, 'committed')
    assert.deepEqual(syncs, ['dsh-mnemon'])
  })
})
```

- **Step 2**（确认红）：lib 产物经 Task 4 Step 4 build 即为最新（若跨会话续跑，先补 `npm run build` 再跑）；套件较大，预计可能超 90s——直接后台起跑、`job_output` 收取：

```powershell
$log = 'D:\_dsh-workspace\.dsh-research\dshm-issue77-78-scratch\logs\t05-red-profile-transaction.log'
node --test tests/profile-transaction.test.mjs *> $log; "EXIT=$LASTEXITCODE" >> $log
```

  Expected：exit ≠ 0，断言失败红（非加载失败）——用例 1 红（syncs 实际 `['dsh-mnemon']` ≠ 期望子包；红驱动 = `addWithLagRetry` 未消费 Task 4 已产出的 `missingPackage`），用例 2 红（实际 `['dsh-mnemon']` ≠ 期望二元组），用例 3 **绿**（负向锚，机制已注明）。套件其余既有用例保持绿。
- **验证命令**：Step 2 一条。
- Consumes：Task 4 `RunnerOutcome.missingPackage`（经 `failWith` 的 classify spread 进 outcome）。
- Produces：无（纯测试）。

### Task 6 — src/core/profile-transaction.ts：#78 缺失包优先同步（最小实现）

- **Step 3**（实现）：`addWithLagRetry` 的 npmmirror 臂（:660–668）替换为：

```ts
    if (out.code === PNPM_OUTCOME_CODES.NO_MATCHING_VERSION && out.registry === 'npmmirror') {
      // L2②（ADR-0012）+ issue #78：pnpm 报错指向的缺失包优先——主包镜像已同步（=latest）而
      // pin 子依赖缺失时，同步主包是空操作，重试预算两次全空转（issue #78 实录）。
      // 提取失败（旧文本形态）或缺失包 == 主包 → 主包同步（既有语义零漂移）；
      // 子依赖同步未受理（false = kill switch / 网络失败）→ 主包兜底一次。
      // sync 失败静默（false = 回到既有退避语义）；kill switch（DSHM_MIRROR_SYNC=0）在缺省实现内。
      const missing = out.missingPackage
      const subTarget = missing !== undefined && missing !== req.pkg ? missing : undefined
      let synced = false
      let syncedTarget: string | undefined
      if (subTarget !== undefined) {
        synced = await d.syncNpmmirror(subTarget)
        if (synced) syncedTarget = subTarget
      }
      if (!synced) {
        synced = await d.syncNpmmirror(req.pkg)
      }
      if (synced) {
        d.clearLatestCache()
        heal.push({ code: 'B3_NPMMIRROR_SYNC', note: syncedTarget !== undefined
          ? `NO_MATCHING_VERSION 来自 npmmirror，缺失依赖 ${syncedTarget} 已按需同步镜像后重试（+npmmirror sync）`
          : 'NO_MATCHING_VERSION 来自 npmmirror，已按需同步镜像后重试（+npmmirror sync）' })
      }
    }
```

- **Step 4**（确认绿）：

```powershell
$scr = 'D:\_dsh-workspace\.dsh-research\dshm-issue77-78-scratch\logs'
$b = "$scr\t06-build.log"; npm run build *> $b; "EXIT=$LASTEXITCODE" >> $b
$log = "$scr\t06-green-profile-transaction.log"; node --test tests/profile-transaction.test.mjs *> $log; "EXIT=$LASTEXITCODE" >> $log
$t = "$scr\t06-typecheck.log"; npm run typecheck *> $t; "EXIT=$LASTEXITCODE" >> $t
```

  Expected：三条 exit 均 0；单套件 fail 0（Task 5 三例绿 + :2039/:2078/kill-switch 既有 B3 套件零回归）。
- **验证命令**：Step 4 一条（三命令串）。
- Consumes：`RunnerOutcome.missingPackage`（Task 4 Produces）。
- Produces：无（行为收口）。

### Task 7 — 全量门禁、提交、草稿（批示门前停）

- **Step 1**（全量 + 类型门）：

```powershell
Test-Path D:\_dsh-workspace\dsh-m\node_modules   # True 前置
$log = 'D:\_dsh-workspace\.dsh-research\dshm-issue77-78-scratch\logs\full-test.log'
npm test *> $log; "EXIT=$LASTEXITCODE" >> $log
```

  后台起跑（>90s 纪律）、`job_output` 收取。Expected：exit 0、日志尾部计数行 `# tests N / # pass N / # fail 0`（TAP 重定向形态；fail ≠ 0 时先跑 `node scripts/test-baseline.mjs` 判别既有 vs 回归——回归即停）。随后 `npm run typecheck *> <log>; "EXIT=…" >> <log>` → exit 0。
- **Step 2**（提交 main，单提交）：`git add src/core/dsh-cli.ts src/core/profile-transaction.ts tests/pnpm-outcome.test.mjs tests/profile-transaction.test.mjs docs/plans/2026-11-18-issue77-78-win32-rollback-and-npmmirror-subdep-implementation-plan.md` → commit message 引 issue #77/#78，正文列：四处变更点、红绿留证日志路径、断言面改写清单（仅 `:49` 一处）。
- **Step 3**（草稿呈报，不执行）：起草 CHANGELOG 双语条目（背景/做法/测试/兼容性四段；兼容性明示：`RunnerOutcome` 新增可选字段、B3 自愈同步目标语义收敛、win32 回滚修复）与 issue #77/#78 回帖草案（修复摘要 + 验证证据 + 「明确不做」三条的说明）。**随最终回复呈报文本，不执行发版/回帖/关闭**。

## 接口契约（Consumes / Produces）

- **`pnpmInstallSpawnPlan(profileDir: string, mode: 'frozen' | 'rebuild', platform?: NodeJS.Platform) → { file, args, viaShell, detached }`**：Task 2 Produces（导出）；Task 1 用例与 `makeDshRunner` 内部消费。名称与字段逐字如此，不得改名。
- **`makeDshRunner` 第三参 `deps.runCommand?: typeof runCommand`**：Task 2 Produces；Task 1 接线用例消费（缺省模块 `runCommand` 语义不变）。
- **`RunnerOutcome.missingPackage?: string`**：Task 4 Produces（classify 条件携带 + 类型声明）；Task 5 夹具经 `failWith` spread 携带、Task 6 `addWithLagRetry` 消费。
- **`MISSING_PKG_RE = /^@?[A-Za-z0-9-._~]+(\/[A-Za-z0-9-._~]+)?$/`**：Task 4 内部常量，注释互引 packument.ts PKG_RE 同形（不导出、不跨文件复用）。
- **heal note 锚 `+npmmirror sync`**：Task 6 两文案均保留（既有用例 :2075 依赖）。

## 执行纪律

- 开工前批判性复查本计划；发现缺项、矛盾、验证命令失效 → 先修计划再动手，不猜。
- 按任务顺序执行（1→7）；Task 2/4 同文件串行（edit 前先 read 同文件——编辑快照规矩）；不无声跳步、不合并步。
- 每任务完成即跑该任务验证；红灯留证（期望/实际值 + 日志路径）后才进实现步；红灯落点与计划 Expected 不符即停。
- 与仓库现实不符（行号漂移、夹具签名不符等）→ 停下说明，以符号锚重新定位后再续。
- 全部完成后跑最终验证并输出修改摘要。

## 最终验证

1. 全量 `npm test`（后台，日志 `full-test.log`）：exit 0、fail 0、新增 13 例全 pass（真实 shell 级绿钉在无 pnpm 环境为合法 skip；计数以当日日志为准——计数新鲜度纪律，禁引历史数字）。
2. `npm run typecheck`：exit 0。
3. `git log -1 --stat`：单提交含 2 src + 2 tests + 1 计划文档，message 引 issue #77/#78。
4. `git status` 干净（工作树无残留）。
5. 草稿（CHANGELOG + 双 issue 回帖）随最终回复呈报，等待批示。

## 审阅 Checkpoint

- 计划正文结束后请求审阅；审阅通过前不进入实现。
- 本计划的默认执行方：普通编码 agent 或人工执行者。
