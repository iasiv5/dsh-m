# 锁档观测单源实施计划

## 目标

把 pnpm-lock.yaml 的观测解析从五份产地收敛为唯一判定单源 `src/core/lockfile.ts`（ADR-0037）：立 module 与表驱动套件，四个消费端（npm-integrity / market-mutation / profile-transaction / doctor）迁到 view 上，删私有解析器与「同一口径」注释格，镜像测试收敛为共享夹具。对 pnpm 自产规范锁零行为；意外漂移形态的统一即修复按 #72 先例在 CHANGELOG 声明。

## 架构快照

```
                parseLockfile(lockText) ──► LockfileView（fail-open 观测）
                · lockfileVersion（观测值，不做门）
                · observationOf(pkg)      ← 先在证据语义（文件序首条目）
                · candidatesOf(pkg, ver)  ← 守卫语义（精确 + peer 后缀候选）
                · overrides               ← 首条失败即停语义原样
                · anomalies.duplicateKeys ← 重复键透出
                · importersRootDependencies() ← 惰性（yaml），doctor 专用面
                          │
      ┌───────────┬───────┴────────┬─────────────┐
 npm-integrity    market-mutation  profile-transaction   doctor
 （薄政策层：     （capture 循环    （compensate 复验：    （9.x 软门 +
  v9 硬门/重复键   parse-once，     version/commit         unknown≠broken
  /歧义 fail-     :795 单发）       观测；overrides         留消费端）
  closed，文案    （lockResolutionOf 走 view.overrides）
  逐字节保真）     退休）
```

- 严格性分离：view 全 fail-open；三条 fail-closed 政策（v9 硬门、重复键抛错、多候选歧义）留在 npm-integrity 的 `readPnpmLockIntegrity` 策略层，文案逐字节保真。
- parse-once 收益坐实于 market-mutation 的依赖循环（此前逐包全文重扫 ×N）。
- generation-projection 的 `link:` 单正则探针**不动**（ADR-0037 follow-up 登记簿第 3 条）。

## 全局约束

- **术语**：GLOSSARY「锁档观测」（2026-11-16 已立）。module 名 `src/core/lockfile.ts`，类型 `LockfileView` / `LockObservation`。
- **零行为包络**（ADR-0037 决议 6）：对 pnpm 自产规范锁零行为；既有套件全绿为门，任何翻红立即停下回炉（grill Round-3 仲裁条款），不得就地改断言。已知包络内变化三处，CHANGELOG 须逐条声明：① 双引号键此前 A/B 观测不到、现在能；② A 的 body 早截断（任意缩进冒号行截断）退役为缩进感知扫描；③ doctor 对非引号 `lockfileVersion: 9.0` 形态从 unsupported → supported。
- **七条保真清单**（npm-integrity 政策层，T4 红线）：① 三条异常文案逐字节（`pnpm lockfile 版本不是 9.0（实际 …，拒绝解析）`／`pnpm lockfile packages 键重复: ${key}`／`无法唯一定位 ${pkg}@${version} 的 integrity（N 个候选解析结果不一致），fail closed`）；② 「找不到 → null」与「歧义 → throw」二分不混；③ peer 后缀仅 `(` 起始容忍 + `rest === ''`；④ 门是字面 `'9.0'`（值剥一层首尾引号后精确比对，缺行/空值按「缺失」入文案）；⑤ 判重发生在 unquote 之后；⑥ integrity 捕获的前缀约束（行首或 `{`/`,`+空白）与首中即定；⑦ 三条 throw 在 verifyNpmCommitState / compensate validate / 三重验证的失败态映射（`LOCK_INTEGRITY_MISMATCH` / `COMPENSATE_EVIDENCE_MISMATCH` / `COMPENSATE_RESTORE_FAILED`）不降级为 null 或 warning。
- **门序保真**：`readPnpmLockIntegrity` 政策层检查顺序 = 版本门 → 重复键 → 候选一致性（现 parsePackagesSection 的既有顺序）。
- **测试导入约定**：core 测试从构建产物 `../lib/core/*.js` 引入；单套件跑前必须 `npm run build`。
- **验证命令**（node/npm，跨平台）：`npm run build`、`npm run typecheck`、`npm run lint`、单套件 `node --test tests/<suite>.mjs`、全量 `npm test`（pretest 自带 build）。退出码卫生：grep 门禁一律 `! grep -q …` 恒稳形态（bash 形态；PowerShell 等价 `if (Select-String -Quiet <pattern> <paths>) { exit 1 }`，执行者按所在 shell 取等价命令）。
- **CHANGELOG**：中英双语各补一条；分项计数（如「view 套件 N 例」「迁移消费端 4 处」）当轮实跑取数，禁「全量 N/N」主张。
- **并发纪律**：同机禁并发双全量 `npm test`；全量在飞时禁变异工作树。本机存在环境既有失败时用 `node scripts/test-baseline.mjs` 判别。
- **发版**：`npm run release` 与 issue 关闭属不可逆公开动作，**不在本计划任务链内**，执行到发版前停下等当轮批准。
- **分支**：当前在 `main`。开工前须获主人明确同意在 main 上执行，或指定分支。
- 无删除目录、无大范围文档改写（AGENTS.md 批量变更红线不触发；改动均为任务直接产物）。

## 输入工件

- 设计决议：`docs/adr/0037-lockfile-observation-single-source.md`（本计划同 commit 落盘）
- 术语：`GLOSSARY.md`「锁档观测」词条（已落盘）
- 事实基线（已固化进本计划附录 A–C：五产地符号锚、消费端普查、测试锚普查；附录 D 键归一化规格）

## 文件结构与职责

- Create: `src/core/lockfile.ts` — 锁档观测唯一产地（view：packages 观测 + overrides + importers 惰性面）
- Create: `tests/lockfile.test.mjs` — view 表驱动套件（从 `../lib/core/lockfile.js` 引入）
- Create: `tests/fixtures/lockfile-cases.mjs` — 共享 lock 文本构造器与键形态用例（纯函数，src/client 测试同款直引形态）
- Modify: `src/core/npm-integrity.ts` — `parsePackagesSection`/`readPnpmLockOverrides` 删除；`readPnpmLockIntegrity` 重写为 view 上的薄政策层（签名不变）
- Modify: `src/core/market-mutation.ts` — `lockResolutionOf` 删除；capture 循环与 :795 单发改 view
- Modify: `src/core/profile-transaction.ts` — `lockVersionOf`/`lockCommitOf` 删除；compensate 复验改 view；overrides import 改线
- Modify: `src/core/doctor.ts` — `readLockImporters` 的 yaml 解析退休为 view 消费（读文件 + 9.x 软门 + unknown≠broken 留 doctor）
- Modify: `tests/rollback-heal.test.mjs` — `readPnpmLockOverrides` 直测锚改线到 view（期望值不变）
- Modify: `tests/market-mutation.test.mjs` / `tests/profile-transaction.test.mjs` — verbatim 镜像夹具换共享 cases（行为断言不动）
- Modify: `AGENTS.md` —「Owning code and tests」加锁档观测导航行
- Modify: `CHANGELOG.md` — 双语条目（T9）
- 稳定边界：`readPnpmLockIntegrity` / `assertNpmIntegrity` 的导出签名与全部既有测试断言；profile-transaction 与 market-mutation 的对外接口；doctor 报告形状。

## 任务清单

### Task 1: 共享夹具 + view 核心红绿（packages 观测面）

- 目标：`tests/fixtures/lockfile-cases.mjs` 落地；`tests/lockfile.test.mjs` 钉住 packages 观测面；`src/core/lockfile.ts` 最小实现转绿。
- 涉及文件：`tests/fixtures/lockfile-cases.mjs`、`tests/lockfile.test.mjs`、`src/core/lockfile.ts`
- 接口契约
  - Consumes: 附录 D 键归一化规格；七条保真清单里的观测侧事实（④引号剥离 ⑤unquote 判重 ⑥integrity 前缀约束）
  - Produces: `parseLockfile(lockText: string): LockfileView`；`LockfileView.lockfileVersion: string | null`（行扫描 `^lockfileVersion:`、值 `split(':').slice(1).join(':').trim()` 后 `replace(/^['"]|['"]$/g,'')`，无行 → null）；`observationOf(pkg)`（归一键 `=== pkg || startsWith(pkg+'@')` 的文件序首条目，重复键首条胜）；`candidatesOf(pkg, version)`（归一键 startsWith(`pkg@version`) 且余部 `=== '' || startsWith('(')`，按文件序）；`anomalies.duplicateKeys`（unquote 后判重，文件序）；`LockObservation { version?, integrity?, commit?, tarball? }`。夹具导出：`caseRegistryKey` / `caseScopedQuoted` / `casePeerSuffix` / `caseGitTarballUrlKey` / `caseDoubleQuoted` / `caseNodeModulesPrefixV6` / `caseDupKeys` / `caseNoVersionLine` / `lockWith(entries)` 构造器等（命名可在实现内微调，导出面以测试消费为准）。
- 验证范围：新套件红→绿；typecheck。

- [ ] Step 1: 写夹具与失败测试
  - Change: 新建 `tests/fixtures/lockfile-cases.mjs`（lock 文本构造器 + 键形态用例）与 `tests/lockfile.test.mjs`，describe「锁档观测 · packages 面」用例至少覆盖：registry/scoped 引号键观测；双引号键**现在可观测**（包络内新行为，断言在场）；`node_modules/` 前缀容忍；version 归一（剥引号 + 剥全部尾部括号组 `1.2.3(@a@1)(@b@2)` → `1.2.3`）；integrity 前缀约束捕获（`resolution: {integrity: …}` 命中、孤立 `integrity:` 上下文不命中）；**等价性用例**（ADR-0037 决议 5：同一 `resolution: {integrity: …}` 规范锁夹具断言 A 形无约束捕获与 C 形前缀约束捕获同值，钉 B6 包络「规范锁上恒等」——R1-2 补；执行载体：A 形探针 = 内联旧正则 `/integrity:\s*([^,}\s'"]+)/`（market-mutation.ts:296 现行形态，T5 删除后在测试内联保留）——R2-3 补）；段内嵌套冒号行（缩进 4/6 的 `peerDependencies:`/`peerDependenciesMeta:` 等块样式子映射）入 body 不入键、不截断同条目后续 `version:`/`commit:` 字段提取、不产生 anomalies（R2-1 补——既有 LOCK_WITH 族夹具全流样式，无此用例即绿灯穿透）；commit 三级（体内 `commit:` → 键内 40-hex → tarball URL 内 40-hex，各一条用例）；observationOf 文件序首条目与重复键首条胜 + anomalies 透出；candidatesOf 精确 + peer 后缀 + 相似包名不误匹配（`pkg-a` vs `pkg`）；段锚定（importers 段同名键不被 packages 观测命中）；**顶格 snapshots: 段键不入观测**（真实锁形态实证：web profile 锁 packages: 之后有顶格 snapshots: 段，其缩进 2 键如 `'@antfu/install-pkg@2.1.0':` 不得流入 packages 观测——评审建议 b 采纳）；无 `lockfileVersion:` 行 → null；无 `packages:` 段 → 观测全 null、无 anomalies。
  - Run: `npm run build && node --test tests/lockfile.test.mjs`
  - Expected: 红——`Cannot find module '../lib/core/lockfile.js'`（ERR_MODULE_NOT_FOUND）。
- [ ] Step 2: 写最小实现
  - Change: 新建 `src/core/lockfile.ts`：缩进感知块扫描——**键行 = 缩进恰好 2（`indent === 2`，npm-integrity.ts:56 逐字）且 `:` 结尾**；缩进 >2 的冒号结尾行（`peerDependencies:` 等块样式子映射）一律属条目 body、不入键、不截断、不产生 anomalies（R2-1）；条目块截至下一缩进 ≤2 的非空行；packages: 之后首个缩进 <2 的非空行终止段扫描（npm-integrity.ts:55 语义）。键归一（unquote 单/双引号成对 + 剥 `node_modules/` 路径前缀），字段提取（version：块内 `version:\s*'?([^\n']+)` 后归一；integrity：C 前缀约束正则首中即定；commit：三级；tarball：`tarball:\s*([^,}\s'"]+)`），重复键入 anomalies 不抛错。
- [ ] Step 3: 确认通过
  - Run: `npm run build && node --test tests/lockfile.test.mjs && npm run typecheck`
  - Expected: 套件全绿；typecheck 0 错。
- [ ] Step 4: 只读真实锁 smoke（评审建议 a 采纳；零写入、本机形态探针非 CI 门禁——CI 无 profile 锁）
  - Run: `node -e "const { pathToFileURL } = require('node:url'); import(pathToFileURL('lib/core/lockfile.js').href).then(({ parseLockfile }) => { const { readFileSync } = require('node:fs'); const text = readFileSync(require('node:os').homedir() + '/.dsh/profiles/web/pnpm-lock.yaml', 'utf8'); const v = parseLockfile(text); if (v.anomalies.duplicateKeys.length !== 0) { console.error('SMOKE-FAIL anomalies:', JSON.stringify(v.anomalies.duplicateKeys.slice(0, 5))); process.exit(1); } console.log('SMOKE-OK', v.lockfileVersion); })"`
  - Expected: `SMOKE-OK 9.0`（真实规范锁 anomalies 空——R2-1 类绿灯穿透的常备哨兵；观测非空可另抽查）。
- [ ] Step 5: 可选 checkpoint commit（`feat(core): lockfile view packages 面 + 表驱动套件（ADR-0037 T1）`）

### Task 2: view.overrides 面

- 目标：`readPnpmLockOverrides` 的语义（首条失败即停、恰好 2 空格、单/双/裸引号、无区块 → {}）原样搬进 view，view 套件钉住。
- 涉及文件：`src/core/lockfile.ts`、`tests/lockfile.test.mjs`
- 接口契约
  - Consumes: Task 1 的 `parseLockfile`
  - Produces: `LockfileView.overrides: Record<string, string>`（顶层 `overrides:` 段行扫描；语义逐字等于现 `readPnpmLockOverrides`，npm-integrity.ts:113-129 为迁移源）
- 验证范围：新 describe 绿；`tests/rollback-heal.test.mjs` 仍绿（旧导出未动）。

- [ ] Step 1: 写失败测试（describe「锁档观测 · overrides 面」：区块解析/三种引号/首条失败即停截断/无区块 → {}——期望值对照 rollback-heal.test.mjs:370-390 现值）
  - Run: `npm run build && node --test tests/lockfile.test.mjs`
  - Expected: 红——`view.overrides` 为 undefined，断言失败。
- [ ] Step 2: 实现（搬移 npm-integrity.ts:113-129 逻辑为 view 属性）并确认通过
  - Run: `npm run build && node --test tests/lockfile.test.mjs tests/rollback-heal.test.mjs && npm run typecheck`
  - Expected: 两套件全绿；typecheck 0 错。

### Task 3: view.importersRootDependencies() 面（惰性）

- 目标：doctor `readLockImporters` 的 yaml 解析语义搬进 view（门除外），view 套件钉住。
- 涉及文件：`src/core/lockfile.ts`、`tests/lockfile.test.mjs`
- 接口契约
  - Consumes: Task 1 的 `parseLockfile`；`yaml` 包 `parseDocument`（doctor.ts 现 import 迁入 lockfile.ts）
  - Produces: `LockfileView.importersRootDependencies(): Map<string, string> | null`——惰性 memoized；解析 `importers.'.'.dependencies`，仅收 `version` 为非空字符串者，version 剥全部尾部括号组（与 packages 面同一归一正则）；`link:` 依赖无 version 自然落空；yaml 抛错 → null。**不做 9.x 门**（门留 doctor，Task 7）。
- 验证范围：新 describe 绿；doctor 套件仍绿（未动）。

- [ ] Step 1: 写失败测试（9.0 形状解析 / link: 落空 / 多组 peer 后缀剥净 `1.2.3(@a@1)(@b@2)` / 坏 yaml → null / 无 importers → 空 Map / 惰性：同一 view 二次调用返回同引用）
  - Run: `npm run build && node --test tests/lockfile.test.mjs`
  - Expected: 红——方法不存在。
- [ ] Step 2: 实现并确认通过
  - Run: `npm run build && node --test tests/lockfile.test.mjs tests/doctor.test.mjs && npm run typecheck`
  - Expected: 两套件全绿；typecheck 0 错。
- [ ] Step 3: 可选 checkpoint commit（`feat(core): lockfile view overrides + importers 面（ADR-0037 T2-T3）`）

### Task 4: npm-integrity 政策薄层化

- 目标：`readPnpmLockIntegrity` 重写为 view 上的薄政策层（签名与全部直测不变），`parsePackagesSection`/`readPnpmLockOverrides` 删除，overrides 消费端（profile-transaction + rollback-heal 直测）改线。
- 涉及文件：`src/core/npm-integrity.ts`、`src/core/profile-transaction.ts`、`tests/rollback-heal.test.mjs`
- 接口契约
  - Consumes: Task 1–2 的 `parseLockfile` / view.overrides
  - Produces: `readPnpmLockIntegrity(lockText, pkg, version): string | null`（政策层：① `view.lockfileVersion ?? ''` ≠ `'9.0'` → throw 版本文案（实际值 `raw || '缺失'`）；② `anomalies.duplicateKeys` 非空 → throw 首键文案；③ `candidatesOf(pkg, version)`：0 候选 → null；多候选 integrity 不一致、或多候选含 null → throw 歧义文案；否则返回首个候选的 integrity（**单候选且 integrity=null → 返回 null 非 throw**，npm-integrity.ts:91-96 现语义，R1-4 补）。门序 = ①→②→③）。profile-transaction `restoreOverridesFromLock`（:369）改 `parseLockfile(lockText).overrides`；rollback-heal.test.mjs:16 import 改 `parseLockfile`（自 `'../lib/core/lockfile.js'`），:381/:389/:390 断言改 `parseLockfile(text).overrides`，**期望值逐字不变**。
- 验证范围：npm-integrity / rollback-heal / profile-transaction 三套件绿；退休符号普查归零；typecheck。

- [ ] Step 1: 政策层重写 + 改线（同 commit 内完成三文件，保持可构建）
  - Change: npm-integrity.ts 删 `parsePackagesSection`/`readPnpmLockOverrides`（unquote 随迁或内联于 lockfile.ts）；`readPnpmLockIntegrity` 按契约重写；profile-transaction.ts:49-55 import 面与 :369 调用改线；rollback-heal.test.mjs import 与断言改线。
- [ ] Step 2: 验证
  - Run: `npm run build && node --test tests/npm-integrity.test.mjs tests/rollback-heal.test.mjs tests/profile-transaction.test.mjs tests/lockfile.test.mjs && npm run typecheck`
  - Expected: 四套件全绿（npm-integrity.test.mjs:125-179 直测锚零改动过绿 = 文案保真证据）；typecheck 0 错。
- [ ] Step 3: 退休符号普查
  - Run: `! grep -rq 'parsePackagesSection' src/ tests/ scripts/ && ! grep -rq 'readPnpmLockOverrides' src/ tests/ scripts/ && echo RETIRED-OK`
  - Expected: `RETIRED-OK`。
- [ ] Step 4: 必选 checkpoint commit（`refactor(core): npm-integrity 政策薄层化 + 消费端改线（ADR-0037 T4）`）——本任务是全链最大单步（三文件同 commit 重写），此 commit 为后续任务的**硬回退点**：T5–T7 任一翻红且回炉不可解时，回滚至本 commit 重新仲裁，不带病续跑（R2-4 补）。

### Task 5: market-mutation 迁移

- 目标：`lockResolutionOf` 退休；capture 循环 parse-once；:795 github 守卫失败路径单发改 view。
- 涉及文件：`src/core/market-mutation.ts`
- 接口契约
  - Consumes: Task 1 的 `parseLockfile` / `observationOf`
  - Produces: `capturePreMutationState`（:335-343 区域）读 lock 一次 → `const view = parseLockfile(text)` → 依赖循环内 `view.observationOf(name)`，映射进既有 evidence 字段——**只映射 `version` / `integrity` / `commit` 三字段**（现 `lockResolutionOf` 返回类型无 `tarball`，tarball 只是 commit 第三级的实现细节；向 evidence 添字段会触发全对象 deepEqual 断言面炸裂，禁止）；:795 路径同样 parse-once 单发。`derivePrior` 及下游零改动。
- 验证范围：market-mutation 套件绿（红即回炉，见全局约束）；退休符号归零。

- [ ] Step 1: 迁移（删 `lockResolutionOf` 与 :295-302「同一口径」注释格；capture 与 :795 改 view）
  - Run: `npm run build && node --test tests/market-mutation.test.mjs && npm run typecheck`
  - Expected: 全绿。**翻红处置**：若 :597/:670/:691/:720/:739 任一用例钉住的行为与仲裁冲突（如断言 resolvedVersion 含 peer 后缀），停下回炉——按 grill Round-3 条款带断言原文回来重裁，不得就地改断言。
- [ ] Step 2: 退休符号普查
  - Run: `! grep -rq 'lockResolutionOf' src/ tests/ scripts/ && echo RETIRED-OK`
  - Expected: `RETIRED-OK`。

### Task 6: profile-transaction 迁移

- 目标：`lockVersionOf`/`lockCommitOf` 退休；compensate 复验（validate :1163-1179 与三重复验 :1261-1263）的 version/commit 观测改 view（每处 parse-once 传入）。
- 涉及文件：`src/core/profile-transaction.ts`
- 接口契约
  - Consumes: Task 1 的 `parseLockfile` / `observationOf`；Task 4 改线后的 overrides 消费（不动）
  - Produces: validate 与三重复验各持一个 `view`，`version = view.observationOf(pkg)?.version ?? null`、`commit = …?.commit ?? null`，回退链 `lockVersionOf ?? evidence.resolvedVersion` 语义原样保留（`observationOf(pkg)?.version ?? evidence.resolvedVersion`）。`readPnpmLockIntegrity` 调用点（:778/:1165/:1263）**不动**（政策层自持 lockText）。
- 验证范围：profile-transaction 套件绿（⑧a-d、③、①、⑧ 系全绿）；退休符号归零。

- [ ] Step 1: 迁移（删两函数与 :1286-1300「同一口径」注释格）
  - Run: `npm run build && node --test tests/profile-transaction.test.mjs && npm run typecheck`
  - Expected: 全绿；翻红按 Task 5 同款回炉条款处置。
- [ ] Step 2: 退休符号普查
  - Run: `! grep -rq 'lockVersionOf' src/ tests/ scripts/ && ! grep -rq 'lockCommitOf' src/ tests/ scripts/ && echo RETIRED-OK`
  - Expected: `RETIRED-OK`。
- [ ] Step 3: 可选 checkpoint commit（`refactor(core): 锁档观测消费端迁移（ADR-0037 T4-T6）`）

### Task 7: doctor 迁移

- 目标：`readLockImporters` 的 yaml 解析退休为 view 消费；读文件、9.x 软门、unknown≠broken 留 doctor。
- 涃及文件：`src/core/doctor.ts`
- 接口契约
  - Consumes: Task 3 的 `importersRootDependencies()` 与 Task 1 的 `lockfileVersion`
  - Produces: `readLockImporters(lockPath)` 形状不变（`{ map, supported }`）：readFile catch → `{map:new Map(),supported:false}` 不变；`const view = parseLockfile(text)`；`view.lockfileVersion` 非 `startsWith('9.')`（null 视为非）→ supported:false；`importersRootDependencies()` 为 null → supported:false；否则 map 取其返回（版本已归一，doctor 侧 replace 退役）。**doctor.ts 的 `yaml` import 保留**——`detectLayout`（:106，workspace 布局判定）另有第二用途，仅 :402 的 lockfile 解析退休。
- 验证范围：doctor 套件绿（checkAccount 组 :249/:258/:278/:319 锚全绿）；typecheck。

- [ ] Step 1: 迁移
  - Run: `npm run build && node --test tests/doctor.test.mjs tests/lockfile.test.mjs && npm run typecheck`
  - Expected: 全绿。已知包络变化③（非引号 `9.0` → supported）不在既有用例断言面内；若 :319「非 9.0 不猜」用例翻红，核对其夹具版本值——夹具为引号 `'6.0'` 类形态则不应翻红，翻红即回炉。

### Task 8: 镜像夹具收敛 + 导航行

- 目标：verbatim 镜像夹具换共享 cases；AGENTS.md 加锁档观测导航行。
- 涉及文件：`tests/market-mutation.test.mjs`、`tests/profile-transaction.test.mjs`、`AGENTS.md`
- 接口契约
  - Consumes: Task 1 的 `tests/fixtures/lockfile-cases.mjs`
  - Produces: 镜像组改引共享构造器——A↔B2 commit 键形态组（market-mutation.test :691/:720/:739 ↔ profile-transaction.test :1828/:1856/:1878 的 lock 夹具）与 A↔C integrity 夹具（market-mutation 内联 lock 文本 ↔ npm-integrity.test `LOCK_WITH` 形状）**仅在 verbatim 级等价时替换**；**verbatim 等价的机械化判据：共享构造器输出与原夹具文本逐字节 diff 为空（node Buffer 比较；bash 可用 `diff --no-index` / `<(...)` 等价）才替换，diff 非空即按非 verbatim 保留原样并逐个表态**（R3-1 补）；行为断言一字不动。AGENTS.md「Owning code and tests」新增行：`锁档观测（ADR-0037）: src/core/lockfile.ts; tests: tests/lockfile.test.mjs. pnpm-lock 观测唯一产地；npm-integrity 是其严格政策消费端。`
- 验证范围：被改两套件绿；lint + check-client-imports 过。

- [ ] Step 1: 夹具替换（保守边界：只换逐字等价者）
  - Run: `npm run build && node --test tests/market-mutation.test.mjs tests/profile-transaction.test.mjs tests/npm-integrity.test.mjs`
  - Expected: 全绿。
- [ ] Step 2: AGENTS.md 导航行 + lint
  - Run: `npm run lint`
  - Expected: 0 错。

### Task 9: CHANGELOG 双语 + 终验

- 目标：双语条目（含行为包络三条声明 + 分项计数）；全量门。
- 涉及文件：`CHANGELOG.md`
- 接口契约
  - Consumes: T1–T8 全部产物；各套件当轮实跑计数
  - Produces: 中文区与英文区各一条 `### 未发布`（或按当轮版本号规划）条目：锁档观测单源（ADR-0037）+ 五产地收敛 + 包络三条 + view 套件/迁移计数（分项，禁全量 N/N）。
- 验证范围：双语条目在场；typecheck + 全量 npm test 全绿。

- [ ] Step 1: 写 CHANGELOG（计数当轮实跑取数）
  - Run: `grep -q '锁档观测' CHANGELOG.md && grep -q 'Lockfile observation\|lockfile observation' CHANGELOG.md && echo BILINGUAL-OK`
  - Expected: `BILINGUAL-OK`。
- [ ] Step 2: 终验
  - Run: `npm run typecheck && npm test`
  - Expected: typecheck 0 错；全量全绿（本机有环境既有失败时以 `node scripts/test-baseline.mjs` 对照，零新增失败）。
- [ ] Step 3: 可选 checkpoint commit（`docs: ADR-0037 + 锁档观测单源实施计划 + CHANGELOG（T9 收口）`——若 ADR/计划已先行同 commit 落盘则本步只含 CHANGELOG 与 T8 导航行）。
- 发版提醒：到此处停下。`npm run release` 需当轮明确批准（仓规），不在本计划内自动执行。

## 执行纪律

- 执行期追认（2026-11-16 产出评审 I-1）：计划「文件结构与职责」清单之外另有两处测试文件触碰——`tests/profile-transaction.test.mjs:1912`（断言 message 文案「lockVersionOf」→「观测」，e1686eb）与 `tests/upgrade-activation.test.mjs:138`（注释携锚词改写，a10c478）。动因机械必要：T4-T6 退休门要求 5 个旧符号从 `tests/` 消失（含注释/消息文案携锚），两处均为叙述性文案、断言语义与期望值零改动（产出评审 diff 实读确认）。追认为计划内改动。
- 开始实现前先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行，不无声跳步、合并步或改变任务目标；每完成一个任务运行该任务的验证。
- 任何既有套件翻红且不属于「全局约束」声明的包络三条时，立即停下回炉（grill Round-3 条款），不得就地改断言、不得放宽门。
- 当前在 `main` 分支：开工前须主人明确同意在 main 执行或指定分支。
- 引用测试锚先读：本计划附录 C 的锚为 2026-11-16 实测，执行期以符号/用例名实读为准，行号漂移按过期处理。
- 全量在飞禁变异；同机禁并发双全量。
- 全部任务完成后运行最终验证并输出修改摘要。

## 最终验证

- `npm run typecheck && npm test`——typecheck 0 错、全量全绿（环境既有失败按基线对照，零新增）。
- 退休符号终普查：`! grep -rq 'parsePackagesSection\|readPnpmLockOverrides\|lockResolutionOf\|lockVersionOf\|lockCommitOf' src/ tests/ scripts/ && echo ALL-RETIRED`（grep 多模式 `-r -q -E` 形态允许，语义同上）→ `ALL-RETIRED`。
- `grep -q '锁档观测' GLOSSARY.md && grep -q '锁档观测' AGENTS.md && grep -q '锁档观测' CHANGELOG.md && grep -q '锁档观测' docs/adr/0037-lockfile-observation-single-source.md && echo DOCS-OK` → `DOCS-OK`（ADR 子句验正文含术语，基线实测命中；原「0037」子句查正文永假已废——R1-1 修复）。
- 输出修改摘要：新增/修改文件清单 + 包络三条 + 各套件当轮计数。

## 审阅 Checkpoint

- 计划正文结束。请先审阅本计划与 `docs/adr/0037-lockfile-observation-single-source.md`；确认后可由普通编码 agent 或人工执行者按任务链实施。开工前需答复：在 `main` 直接执行，或另开分支。

---

## 附录 A：五产地符号锚（2026-11-16 实测）

| 产地 | 位置 | 去向 |
|---|---|---|
| `lockResolutionOf` | market-mutation.ts:264-307（模块私有） | T5 退休 |
| `lockVersionOf` / `lockCommitOf` | profile-transaction.ts:1284-1293 / :1296-1309（私有） | T6 退休 |
| `parsePackagesSection` | npm-integrity.ts:36-76（私有） | T4 随迁 view |
| `readPnpmLockIntegrity` | npm-integrity.ts:83-97（导出；唯一消费端 profile-transaction :778/:1165/:1263） | T4 重写为政策层，签名不变 |
| `readPnpmLockOverrides` | npm-integrity.ts:113-129（导出；消费端 profile-transaction :369 + rollback-heal.test 直测） | T4 迁 view，两消费端改线 |
| `readLockImporters` | doctor.ts:394-424（私有） | T7 yaml 解析退休，门保留 |

## 附录 B：消费端普查（2026-11-16 grep 实测）

- npm-integrity 的 src/ 消费端仅 `src/core/profile-transaction.ts:55` 一处 import。
- `readPnpmLockIntegrity` 调用点：profile-transaction.ts:778（verifyNpmCommitState）、:1165（compensate validate）、:1263（三重复验）。
- `readPnpmLockOverrides` 调用点：profile-transaction.ts:369（restoreOverridesFromLock ← frozenConvergeLadder）。
- doctor `readLockImporters` 调用点：doctor.ts checkAccount（每 profile 1 次，循环外）。
- generation-projection.ts:101-102 单正则探针：**不在本轮**（ADR-0037 follow-up 3）。
- scripts/、host.js、src/client：零 pnpm-lock 解析点。

## 附录 C：测试锚普查（执行期以用例名实读为准）

- `tests/market-mutation.test.mjs`：:597（quoted scoped 键 integrity）、:670（peer 后缀 quoted scoped）、:691（gitHosted tarball URL 键 commit）、:720（git+https 键内 hex）、:739（无 SHA fail-closed）——T5 门。
- `tests/profile-transaction.test.mjs`：:1779（① fresh+prior none）、:1807（⑧ evidence 篡改 rejected）、:1828/:1856/:1878（⑧a/b/c github 补偿 commit 观测）、:1898（⑧d peer 后缀 strip）、:1942（③ dependency 二次观测）——T6 门。
- `tests/npm-integrity.test.mjs`：:125-179 describe `readPnpmLockIntegrity` 直测（:128/:133/:138/:143-144/:155/:166/:172/:178）——T4 文案保真门，零改动过绿。
- `tests/npm-integrity.test.mjs`：:182-186 describe `assertNpmIntegrity` 直测（:184 一致通过 / :185 找不到 / :186 不一致）——B9 冻结对象（签名与断言零改动），T4 零改动过绿（R1-3 补清点）。
- `tests/rollback-heal.test.mjs`：:16 import + :370-390 describe `readPnpmLockOverrides`——T4 改线（期望值不变）。
- `tests/doctor.test.mjs`：describe `checkAccount`（:228 起；:249 三处一致、:258 pin≠实装、:278 lock 无记录 unknown、:319 非 9.0 不猜）——T7 门。
- 镜像组清单（T8 替换对象）：附录 C 前两行 ↔ npm-integrity `LOCK_WITH`（:66-82）夹具形状对照；doctor ↔ ⑧d 的 peer 剥离语义镜像由 view 套件统一覆盖（测试本体保留）。

## 附录 D：键归一化规格（view implementation 契约）

1. **段锚**：仅 `packages:` 段（首个 `trim() === 'packages:'` 行之后），段扫描终止于其后首个缩进 <2 的非空行（npm-integrity.ts:55）；段外键不入观测。
2. **键行识别**：缩进**恰好 2**（`indent === 2`，npm-integrity.ts:56）且以 `:` 结尾；缩进 >2 的冒号结尾行属条目 body、不入键不截断——真实规范锁 packages: 段内普遍存在块样式子映射行（2026-11-16 双方独立实测 web profile 锁：lead 51 行 / 评审 218 行，`peerDependencies:` 族为主；若按 ≥2 识别会尽数成键、同名列重复数十次触发政策层②对规范锁 throw）；条目块截至下一缩进 ≤2 的非空行（缩进感知，杜绝 A 的任意冒号行早截断）。
3. **归一**：成对单/双引号剥（`unquote`）；可选 `[^']*node_modules/` 路径前缀剥（A 形态）。判重在归一后。
4. **observationOf 匹配**：归一键 `=== pkg || startsWith(pkg + '@')`，文件序首条目胜（重复键首条胜 + anomalies）。
5. **candidatesOf 匹配**：归一键 `startsWith(pkg + '@' + version)` 且余部 `=== '' || startsWith('(')`，文件序。
6. **字段**：`version` 块内 `version:\s*'?([^\n']+)` 捕获后剥全部 `'` 与全部尾部括号组 `(\([^)]*\))+$`；`integrity` 块内 `(?:^|[,{]\s*)integrity:\s*([^,}\s'"]+)` 首中即定；`commit` 三级——块内 `commit:\s*'?` 40-hex（可选单引号，A:302/B2:1307 逐字，R2-2 补）→ 键内 40-hex → 块内 `tarball:` URL 中 40-hex；`tarball` 块内 `tarball:\s*([^,}\s'"]+)`。
7. **lockfileVersion**：行扫描 `^lockfileVersion:`，值 `split(':').slice(1).join(':').trim()` 后 `replace(/^['"]|['"]$/g,'')`；无行 → null。view 不做门。
