# issue #44 账实误报两类 + 同根因类 github 安全网观测/补偿缺陷 一次性收口 实施计划

## 目标

- 修复 issue #44 的 doctor 两处误报（缺陷 A：多层 peer 后缀只剥一层；缺陷 B：git 源 lock URL 与版本号直接比对）。
- 同根因类（pnpm lock v9 形态假设 ≠ pnpm 实际产出）一并收口三处：`lockResolutionOf` URL 键不可匹配 + commit 兜底提取缺失、`?? sha` 假观测、`lockCommitOf` 对 gitHosted tarball 形态恒 null 导致 github 补偿恒拒绝；`lockVersionOf` 顺手加固（grill Q1–Q6 共识，2026-11-04）。
- 全量测试绿 + 本机实机探针（`doctor --profile web` 的 qiaomu-rss-dsh 误报消失）。

## 架构快照

根因类四点一线，全部经本机实测取证（2026-11-04 会话实录）：

| # | 触点 | 形态假设缺口 | 实测后果 |
|---|---|---|---|
| 1 | `src/core/doctor.ts:416` | `/\([^)]*\)$/` 只剥一层 peer 后缀 | 多 peer 插件（如 `0.1.5(@a@1)(@b@2)`）剥后残留 → 误报账实分裂（issue #44 缺陷 A） |
| 2 | `src/core/doctor.ts:450`（else 双臂 :462-467） | 非 semver 形态只认 `link:`；**双臂同病**——satisfies 臂：semver 7.8.5 `satisfies` 对非法 range 返回 **false** 而非 throw（评审 R2-P6 实测，推翻 issue 原文「satisfiesSafe→null 正确地不判错」假设），`pinOk === false` 独立判假；lockfile 直比臂：lock version 是 codeload/git+ URL，`lockfile !== installed` 恒真 | git 源两臂皆放火 → 恒误报（本机 `doctor --profile web` 正报 qiaomu-rss-dsh）；单修任一臂不消警（评审副本实测：只修 lock 臂后 qiaomu 仍为唯一不一致项） |
| 3 | `src/core/market-mutation.ts:272`（键行正则 `[^\s':]+`） | 字符类排除冒号 → `qiaomu-rss-dsh@https://…` URL 键整行匹配失败 | `lockResolutionOf` 对所有 github tarball 安装返回 null：① `:757` `?.commit ?? sha` 退化为请求值回显（假观测）；② `capturePreMutationState` 缺记录 → `derivePrior`（`:389-391` github 臂 `restorable = Boolean(lock?.commit)`）恒 false → github prior 判不可自动恢复 |
| 4 | `src/core/profile-transaction.ts:1263`（`lockCommitOf`） | 缺口有二：键尾 `'` 强制闭引号——无引号 URL 键（真锁实况）在键尾即失配；体扫描只认 `commit:` 字段无兜底——gitHosted tarball 形态（本机 web profile 实锁逐字：`resolution: {gitHosted: true, tarball: https://codeload…/tar.gz/<sha40>}`）无该字段，SHA 只在键名/tarball URL 内 | `:1144` 补偿证据复验 `commit === null` → **github 补偿恒拒绝**（fail-closed 变砖，全部落 manual-repair） |

真锁形态（`~/.dsh/profiles/web/pnpm-lock.yaml` packages 段，2026-11-04 实测）：

```yaml
  qiaomu-rss-dsh@https://codeload.github.com/joeseesun/qiaomu-rss-dsh/tar.gz/42dc23fd49fe38a06a2400b13e05010a60d6eac1:
    resolution: {gitHosted: true, tarball: https://codeload.github.com/joeseesun/qiaomu-rss-dsh/tar.gz/42dc23fd49fe38a06a2400b13e05010a60d6eac1}
    version: 0.9.3
```

已排查、判定**非**同类缺陷（不触碰）：`readPnpmLockIntegrity`（npm-integrity.ts:83）已后缀感知（前缀 + `rest.startsWith('(')` 匹配，10-04 修过）；`verifyInstalledAdditions` 三项检查（marker/entry/loader-id）不碰版本比对；`compat-check.evaluatePeers` 非法 range 上抛是注释明示的 fail-loud 设计（compat-check.ts:39）；generation-projection 的 link: 锚定不做数值比对。

## 全局约束

- **测试导入约定**（`dsh-m/AGENTS.md`）：`src/core/*.ts` 测试从 `lib/core/*.js` 引入——**单文件跑测试前必须 `npm run build`**，否则测的是旧产物。
- **红先留证**：每个修复任务先写失败测试，红灯必须是断言失败实值（记录期望 vs 实际），排除 `ReferenceError` 假红（know-how「测试注入形态与红确认」）。
- **退出码卫生**：过滤测试输出一律 `set -o pipefail`（`docs/CODING-STANDARDS.md`）。
- **长命令纪律**：全量 `npm test`（>90s）用 run_in_background 起跑、经日志/job_output 取结果（workspace AGENTS.md）。
- **逐字节零漂移面**：`link:` 分支语义（一致性=目标可读）；单层后缀既有结果；npm 源补偿既有用例；doctor finding 文案格式（`pin=… · 实装=… · lock=…` 结构不变，`lock` 字段保观测值——tests/ 无 `lock=` 输出钉，grep 零命中实测）。
- **行为变化明示（评审 R2-P6 附注采纳）**：spec 侧门使 dist-tag pin（如 `latest`）从「satisfies false → 报账实分裂」变「unknown → 不判」——现测试面无 dist-tag 用例、本机真实 profile 20 依赖无此类 pin（评审核数），属 satisfiesSafe 注释本就承诺的语义收敛；CHANGELOG 兼容性段须明示此收敛。
- **fail-closed 语义**：commit identity 观测不到 → evidence 记 `null` → 补偿复验拒绝 → manual-repair（不回显请求值）。
- **分支**：本仓近 30 提交除 1 笔发版集成 merge（271fe37，0.9.94）外均直推 main；**批准本计划视为同意在 main 提交**（如需特性分支请在批准时明示）。
- **批示门**（`dsh-m/AGENTS.md`「Releasing」）：`npm run release`、issue #44 回帖、关闭 issue 均需当轮主人明确批示，不在本计划自动执行。
- 无额外全局约束（无版本下限/依赖/平台/命名文案规则变化；纯 `src/core` 逻辑 + 测试）。

## 需求基线

- **B1**（issue #44 缺陷 A）：lock version 带多层 peer 后缀（`1.2.3(@a@1)(@b@2)`）剥全部后缀，三处一致 → `consistent === true`。
- **B2**（issue #44 缺陷 B；评审 R2-P6 修正为双臂）：git 源 spec（github:/git+/URL）不参与 satisfies 判定（spec 侧形态门）且 lock 值（codeload/git+ URL）不参与 lockfile 直比（值侧形态门）→ 双臂皆不误报；`account[].lockfile` 保留观测值（证据保真）。
- **B3**（防过抑制）：真·账实分裂（npm spec + lock ≠ installed）仍报 `consistent === false`；git 源实装缺失仍报 false（issue #44 回归表第 4 行）。
- **B4**（观测修复）：gitHosted tarball 形态下 `lockResolutionOf` 可解析 URL 键 → `lockResolutions[pkg].commit` 观测到 40 位 hex；`derivePrior` github 臂 `restorable === true`。
- **B5**（Q3 决议）：观测不到 commit → evidence `lockCommitIdentity: null`（类型放宽 `string | null`），补偿复验见 null 即拒绝（不回显请求 sha）。
- **B6**（补偿复验修复）：gitHosted 形态 lock + 证据 SHA 一致 → 复验通过（HEAD 恒拒绝 → 修复后首次可用）；SHA 不一致 / 无 SHA → 恒拒绝不变。
- **B7**（Q4 决议）：`lockVersionOf` 提取值剥离 peer 后缀（红先加固钉——夹具取「引号键 + version 行先于 resolution 行」形态使 HEAD 红，评审 R2-P5 探针 B 形态证实唯一有效钉；真实 pnpm 生成序（resolution 先行）下 lockVersionOf 恒 null 走 evidence 回退，B7 属防御性加固非现行为修复）。
- **B8**：全量 `npm test` 零失败（基线 0.12.3 = 2028/2028，新增约 10 例）+ `npm run typecheck` 绿 + 本机探针 B2 场景误报消失。

grill 决议映射：Q1 范围四点一并（本文档全部）→ D1；Q2 doctor B 口径 = semver 形态门**双侧化**（lock 值门 `^\d+\.\d+\.\d+` + spec 门 `validRange(spec) !== null`——评审 R2-P6 证实单侧门不消警，与 Q2「非 semver 形态不比对」精神同构的自洽扩展），`link:` 早退分支不动，`parseSpecSource` 仅注释提及不接线 → D2；Q3 `?? sha` → `?? null` → D3；Q4 lockVersionOf 加固纳入 → D4；Q5 测试范围红先 → D5；Q6 不立 ADR、CHANGELOG/回帖随发版批示 → D6。

## 断言面清点（计划期 grep tests/，HEAD 实测；无扩展名过滤）

**私有符号普查**（`lockResolutionOf` / `lockCommitOf` / `lockVersionOf`，src/+tests/+scripts/ 无过滤全录）：src 侧 8 触点（transaction :1136/:1143/:1234 + 定义 :1256/:1263；market-mutation 定义 :261 + :326/:757），模块外零消费者、tests 零直接引用（三个函数均模块私有）——行为变更只能经公共面（`capturePreMutationState` / `derivePrior` / `runProfileTransaction` / doctor）观测，本计划测试全部走公共面。

| 触点 | 现状断言 | 受本计划影响 | 处置 |
|---|---|---|---|
| `tests/doctor.test.mjs:315`（单层后缀 `0.9.28(@deepseek-ai/schemastery@3.18.4)`） | `consistent === true` | 无（剥全部后缀对单层等价） | Task 1 Step 4 复跑回归 |
| `tests/doctor.test.mjs:292`（link: 依赖） | pin 原文 / 目标可读 / lockfile null | 无（`isLink` 分支不动） | Task 1 Step 4 复跑 |
| `tests/doctor.test.mjs:253–261`（三处一致 / 实装缺失） | true / false | 无 | Task 1 Step 4 复跑 |
| `tests/doctor.test.mjs:357`（doctor 聚合账实 2 依赖一致） | 零 finding | 无 | Task 4 全量覆盖 |
| doctor 输出格式 `lock=` 钉 | **无**（`grep -rn 'lock=' tests/*.mjs` 零命中，实测） | 无 | `account.lockfile` 保观测值，格式不漂移 |
| `tests/market-mutation.test.mjs:675–689`（带 peer 后缀 quoted scoped 键） | `restorable true` + integrity | 无（新键正则对无冒号 quoted 键捕获等价） | Task 2 Step 4 复跑 |
| `tests/market-mutation.test.mjs:595–617`（scoped integrity） | `restorable true` | 无 | Task 2 Step 4 复跑 |
| `tests/market-mutation.test.mjs:1133–1145`（owner-repo 裸键 `resolution: {commit: …}`） | 升级流重锁 HEAD | 无（裸键两代正则均可匹配；命名 `commit:` 字段恒优先） | Task 4 全量覆盖 |
| 测试内 URL 形态 lock 键夹具 | **无**（`grep 'https://'` 实测两文件 7 处：market-mutation :54/:104/:449/:475/:476、profile-transaction :1948/:2035，逐条核看均为 fetch/tarball 桩 URL 与注释，无一为 lock packages 键夹具） | 无冲突 | 新夹具均为新增 |
| `tests/profile-transaction.test.mjs:1807–1823`（⑧ evidence 篡改 → `COMPENSATE_EVIDENCE_MISMATCH`） | rejected | 无（npm 臂不动；github 臂新增用例在旁） | Task 3 Step 1 镜像其请求构造（`compensate-install` describe 的 `compTempProfile`/`compWriteLock`/`compFakeRunner` 夹具 kit，:1768–1830 实读确认 github 臂请求形态可直接从 ⑧ 平移：`evidence: { source: 'github', pinnedSpec, sha, lockCommitIdentity }`） |
| `tests/upgrade-activation.test.mjs:135–141`（github 升级夹具） | 升级流 needsRestart/不调分类器 | 键无冒号形态两代正则等价捕获、体 `commit:` 字段两版均优先——断言零影响；**:138 注释记录的「键捕获在首个冒号处截断」缺陷在修复后过期** | Task 2 Step 3 同批刷新该注释（仅注释，非断言；引用本计划） |
| `tests/doctor-api.test.mjs:118`（`summary.accountChecked === 1`） | 计数钉，无格式钉 | 无（npm-only 夹具计数不变） | Task 4 全量覆盖 |
| `tests/profile-ops.test.mjs:201–231`（「账实分裂」复读） | 升级等待期 release-age 机制（listInstalled 复读），**与 doctor checkAccount 无关**（同名异义，计划期甄别排除） | 无 | 不触碰 |
| `src/core/profile-transaction.ts:96` evidence 类型 `lockCommitIdentity: string` | 类型面 | **是** | Task 2 Step 3 放宽 `string \| null`（唯一构造点 market-mutation.ts:762、唯一消费点 :1144，实测 grep 全录） |

## 文件结构与职责

- Modify: `src/core/doctor.ts` — `readLockImporters`（:416）剥全部后缀；`checkAccount`（:450 起）非 link 分支加 semver 形态门。注释引 issue #44 与 10-04 先例。
- Modify: `src/core/market-mutation.ts` — `lockResolutionOf`（:261–284）键正则放开冒号 + commit 三级兜底；`:757` `?? sha` → `?? null`。注释引 0.5.1 同口径先例。
- Modify: `src/core/profile-transaction.ts` — `:96` evidence 类型放宽；`lockCommitOf`（:1263）重写为键行定位 + hex40 兜底；`lockVersionOf`（:1256）提取值剥离后缀。
- Modify: `tests/doctor.test.mjs` — checkAccount describe 内新增 5 用例（3 红钉 + 2 绿钉）。
- Modify: `tests/market-mutation.test.mjs` — derivePrior/capture describe 内新增 3 用例（2 红钉 + 1 绿钉）。
- Modify: `tests/profile-transaction.test.mjs` — 补偿证据复验 describe 内新增 4 用例（1 红钉 + 3 绿/加固钉）。
- Modify: `tests/upgrade-activation.test.mjs` — 仅 `:138` 绕行注释刷新（记录的截断缺陷已修复，改引本计划；零断言改动）。
- Create: 无新文件（不迁移共享提取器——market-mutation 不 import npm-integrity：该文件仅 `:284` 注释提及 npm-integrity 口径，import 语句零命中（实测），引入新依赖边超出本次范围；两侧注释互引同一兜底口径）。
- 文档：CHANGELOG 双语条目与 issue #44 回帖**只起草不提交**（随发版批示）。

## 任务清单

### Task 1 — doctor.ts：缺陷 A 剥全部后缀 + 缺陷 B semver 形态门（红先）

- **Step 1**（写红测试）：`tests/doctor.test.mjs` 的 `describe('checkAccount'…)` 内、既有 `lock = (entries) =>` 夹具（:244）之上，新增 5 用例（复用 `mkProfile` / `mkInstalled` / `lock`，SHA 用 `'a'.repeat(40)`）：
  1. `三层一致·双层 peer 后缀`：`lock([{ name: 'pkg-m', spec: '1.2.3', ver: '1.2.3(@peer/a@1.0.0)(@peer/b@2.0.0)' }])` + `mkInstalled('pkg-m', '1.2.3')` → `account[0].consistent === true`（HEAD 红：剥一层残留 ≠）。
  2. `git 源·codeload tarball 形态不比对 URL`：spec `'github:o/r#' + sha40`，ver `'https://codeload.github.com/o/r/tar.gz/' + sha40`，installed `'0.3.0'` → `consistent === true` 且 `account[0].lockfile === <URL>`（观测值保留）（HEAD 红：恒不等）。
  3. `git 源·git+https 形态不比对`：ver `'git+https://github.com/o/r.git#' + sha40` → `consistent === true`（HEAD 红）。
  4. `git 源·实装缺失仍报`：用例 2 变体不建 `mkInstalled` → `consistent === false`（绿钉，issue #44 回归表第 4 行）。
  5. `真分裂仍报（防过抑制）`：spec `'1.0.0'`，ver `'2.0.0'`，installed `'1.0.0'` → `consistent === false`（绿钉）。
- **Step 2**（确认红）：`npm run build && set -o pipefail; node --test tests/doctor.test.mjs 2>&1 | tail -30` → 用例 1/2/3 红（用例 2/3 红 = 双臂叠加：satisfies 臂 `pinOk === false` + lockfile 直比臂恒不等；评审 R2-P6 副本实测单修 lock 臂仍红），4/5 绿；记录红灯原因。
- **Step 3**（最小实现）：
  - `:416` → `map.set(name, value.version.replace(/(\([^)]*\))+$/, ''))`；`:414–415` 注释补「多组 peer 后缀一次性剥净（issue #44 缺陷 A，2026-11-04；10-04 单层先例的下一层形态）」。
  - `checkAccount` else 分支（:462–467）比对前加门（**lock 值侧**）：
    ```ts
    const lockComparable = lockfile !== null && /^\d+\.\d+\.\d+/.test(lockfile)
    if (lockComparable && lockfile !== installed) consistent = false
    ```
    注释：「lock 值非 semver 形态（git/patch/tarball URL）不比对——unknown≠broken 同契约；spec 形态判定已有 `parseSpecSource`（installed.ts），此处按值形态门覆盖其超集」（issue #44 缺陷 B lockfile 臂）。`lockfile` 字段仍推送观测值，finding 文案结构不变。
  - `satisfiesSafe`（:425-430）补 **spec 侧门**——让实现兑现既有注释「任一侧非法（dist-tag / workspace 协议等）→ null」的承诺（评审 R2-P6 实测：semver 7.8.5 `satisfies` 对非法 range 返回 false 而非 throw，catch 臂从不触发）：
    ```ts
    // :20 import 改 import { satisfies, validRange } from 'semver'
    function satisfiesSafe(version: string, range: string): boolean | null {
      if (validRange(range) === null) return null // 非 semver range 形态（github:/git+/URL/dist-tag）→ 不可判定，不猜
      try {
        return satisfies(version, range) ?? null
      } catch {
        return null
      }
    }
    ```
    （satisfiesSafe 全仓唯一调用点即 checkAccount :465，语义收窄零外溢；执行 Agent 实测复核：`validRange('github:o/r#…'/'git+…'/URL/'latest') → null`，`validRange('1.0.0'/'^1.0.0')` 正常——B3 用例 5（spec `1.0.0`）与用例 4（installed null 分支）不受影响。）
- **Step 4**（确认绿）：`npm run build && set -o pipefail; node --test tests/doctor.test.mjs 2>&1 | tail -10` → 全绿（含 :292/:315/:253–261 既有回归）。
- **验证命令**：Step 2 / Step 4 两条；预期 Step 4 输出 `pass N` 零 fail、exit 0。

### Task 2 — market-mutation.ts：URL 键匹配 + commit 三级兜底 + `?? null`（红先）

- **Step 1**（写红测试）：`tests/market-mutation.test.mjs` derivePrior describe（:595 所在 describe，复用 `txProfile` 夹具）新增 3 用例（SHA 用 `'c'.repeat(40)`）：
  1. `gitHosted tarball URL 键 → commit 可观测 → github prior restorable`：deps `{ 'dsh-x': 'github:owner/repo#' + sha40 }`，lock packages 段键 `dsh-x@https://codeload.github.com/owner/repo/tar.gz/<sha40>:` + `resolution: {gitHosted: true, tarball: <同 URL>}` + `version: 0.9.3`（本机实锁逐字形态）→ `cap.snapshot.lockResolutions['dsh-x'].commit === sha40`、`.version === '0.9.3'`；`derivePrior(cap.snapshot, 'dsh-x').state.restorable === true`、`sourceKind === 'github'`（HEAD 红：`lockResolutions` 无此键 → restorable false）。
  2. `git+https 键·键内 hex 兜底`：键 `dsh-x@https://github.com/owner/repo.git#<sha40>:`，体仅 `version: 0.10.7`（无 `commit:` 字段）→ `lockResolutions['dsh-x'].commit === sha40`（HEAD 红：整键不可匹配）。
  3. `无 SHA 形态 → commit 缺席 → restorable 维持 false`：键 `dsh-x@https://example.com/x.tgz:`，体 `version: 1.0.0` → `commit` undefined、`restorable === false`（绿钉 fail-closed 方向）。
- **Step 2**（确认红）：`npm run build && set -o pipefail; node --test tests/market-mutation.test.mjs 2>&1 | tail -30` → 用例 1/2 红、3 绿；记录。
- **Step 3**（最小实现）：
  - `:272` 键行正则捕获组 `([^\s':]+)` → `(.+?)`（非贪婪，容忍 URL 冒号；行尾 `'?:\s*$` 锚不变；注释引 0.5.1 引号兼容先例同口径 + 本次 URL 键形态）；`body` 起点分支持久化 `matchedKey = key`。
  - commit 提取（body text 之上追加）：
    ```ts
    const tarball = /tarball:\s*([^,}\s'"]+)/.exec(text)?.[1]?.trim()
    const commit = /commit:\s*'?([0-9a-f]{40})/.exec(text)?.[1]?.trim()
      ?? /([0-9a-f]{40})/.exec(matchedKey ?? '')?.[1]
      ?? (tarball ? /([0-9a-f]{40})/.exec(tarball)?.[1] : undefined)
    ```
    返回对象组装不变（undefined 自然缺席）。注释：「commit identity 三级观测：体内 `commit:` 字段 → 键内 40 位 hex → tarball URL 内 40 位 hex（gitHosted tarball 形态无 commit: 字段，issue #44 同根因类；与 profile-transaction.ts `lockCommitOf` 同一口径）」。
  - `:757` `lockResolutionOf(lockText, realKey)?.commit ?? sha` → `?? null`；上方注释更新为「lock commit identity 从实际 pnpm-lock.yaml 独立观测；观测不到 → null（补偿复验拒绝，不回显请求期望值）」。
  - `tests/upgrade-activation.test.mjs:138` 绕行注释刷新：缺陷已修，注释改为「2026-11-04 issue #44 同根因类修复后 URL 键可解析；本夹具保留无冒号形态不影响断言」（零断言改动）。
  - `src/core/profile-transaction.ts:96` 该联合臂 `lockCommitIdentity: string` → `lockCommitIdentity: string | null`。
- **Step 4**（确认绿）：`npm run build && set -o pipefail; node --test tests/market-mutation.test.mjs 2>&1 | tail -10` 全绿（含 :595–617/:675–689/:1133 既有回归）+ `npm run typecheck` 通过（:96 类型放宽即时核验）。
- **验证命令**：Step 2 / Step 4 三条；预期全绿 + typecheck exit 0。

### Task 3 — profile-transaction.ts：lockCommitOf 重写 + lockVersionOf 加固（红先）

- **Step 1**（写红测试）：`tests/profile-transaction.test.mjs` 补偿复验 describe（镜像 `:1807` ⑧ 的请求构造与夹具形态，github 臂）新增 4 用例：
  1. `gitHosted 形态·SHA 一致 → 复验通过`：evidence `{ source: 'github', pinnedSpec: 'github:o/r#<sha40>', sha: sha40, lockCommitIdentity: sha40 }`，lock packages 键 `pkg-x@https://codeload.github.com/o/r/tar.gz/<sha40>:` + `resolution: {gitHosted: true, tarball: <同 URL>}`（无 `commit:` 字段）→ **不**返回 `COMPENSATE_EVIDENCE_MISMATCH`（走到后续恢复臂）（HEAD 红：`lockCommitOf` 恒 null → 恒拒绝）。
  2. `SHA 不一致 → rejected`：锁键内 hex = 另一 sha40 ≠ evidence → `COMPENSATE_EVIDENCE_MISMATCH`（绿钉）。
  3. `无任何 SHA → rejected`：锁键/体均无 hex40 → rejected（绿钉，覆盖 B5 的 null evidence 消费臂）。
  4. `npm 形态·version 值带 peer 后缀 → 复验通过`（红先加固钉 B7；夹具取探针 B 形态——**引号键、键名不带后缀、version 行先于 resolution 行**：`'pkg-a@1.0.0':` / `version: 1.0.0(@peer/a@1.0.0)` / `resolution: {integrity: …}`；HEAD 上 lockVersionOf 返回带后缀原始串 → integrity 查 `pkg-a@1.0.0(@peer/a@1.0.0)` = null → rejected（红）；strip 后 version=1.0.0 → integrity 命中（绿）。评审 R2-P5 探针 A–D 四形态实测：A（无引号键）/C（resolution 先行）/D（裸 version）形态下 B7 空转）。
- **Step 2**（确认红）：`npm run build && set -o pipefail; node --test tests/profile-transaction.test.mjs 2>&1 | tail -30` → 用例 1、4 红（用例 4 红 = lockVersionOf 返回带后缀原始串 → integrity null → rejected，评审 R2-P5 探针 B 形态预演）；2/3 绿（2/3 HEAD 因恒 null 恒拒绝而绿——红灯归因写清：HEAD 绿是「错的原因」，修复后绿才是「对的原因」）；记录。
- **Step 3**（最小实现）——`lockCommitOf`（:1263）重写为键行定位式（现正则缺口有二：键尾 `'` 强制闭引号——真锁无引号 URL 键在键尾即失配（评审 R1-P1 实测：真锁 `qiaomu-rss-dsh@https://codeload…:` 无引号，现行正则 test=false）；体扫描只认 `commit:` 字段无兜底）：
  ```ts
  /** pnpm-lock 目标包 entry 的 commit identity：体内 commit: 字段优先，键文本+体内 40 位 hex 兜底（gitHosted tarball 形态无 commit: 字段；与 market-mutation.ts lockResolutionOf 同一口径）。 */
  function lockCommitOf(lockText: string, pkg: string): string | null {
    const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 键尾引号可选：pnpm 对含特殊字符键（URL 冒号/斜杠）加引号，对裸名键不加（真锁实测两形态并存）
    const at = new RegExp(`^  '?(?:[^'\\n]*node_modules/)?${esc}@[^'\\n]*'?:\\s*$`, 'm').exec(lockText)
    if (!at) return null
    const rest = lockText.slice(at.index + at[0].length)
    // 终界拦两类：顶格段界（如 snapshots:，目标包为 packages 段末条时防 body 过界——真锁 :1238 实况）与下一两空格键行
    const end = rest.search(/^\S|^  \S/m)
    const body = end >= 0 ? rest.slice(0, end) : rest
    const named = /commit:\s*'?([0-9a-f]{40})/.exec(body)?.[1]
    return named ?? /([0-9a-f]{40})/.exec(at[0] + body)?.[1] ?? null
  }
  ```
  `lockVersionOf`（:1256）`m[1]!.replace(/'/g, '')` 后追加 `.replace(/(\([^)]*\))+$/, '')` + 注释（B7 加固：键尾闭引号 + 体扫描 `}` 挡路使真实 pnpm 生成序（resolution 先行）下本函数恒 null 走 evidence 回退——strip 仅在 version 行先行的形态下行使，防御 pnpm 未来生成序/形态演化；评审 R2-P5 探针 A–D 四形态实测）。
- **Step 4**（确认绿）：`npm run build && set -o pipefail; node --test tests/profile-transaction.test.mjs 2>&1 | tail -10` 全绿（含 ⑧ 与 custom-profile-transaction 既有回归）。
- **验证命令**：Step 2 / Step 4 两条。

### Task 4 — 全量验证、实机探针、提交、文档草案（批示门前停）

- **Step 1**：`test -d node_modules` 前置 → 后台跑 `npm test`（>90s 纪律；job_output 取结果）零失败（基线 2028 + 新增 12）→ `npm run typecheck` 绿。
- **Step 2**（本机实机探针，B2 验收）：`node lib/cli.js doctor --profile web` → `qiaomu-rss-dsh 账实分裂` 告警消失、摘要 `账实 20（不一致 0）`；`node lib/cli.js doctor --profile web --json` 面上 qiaomu 条目 `lockfile` 保留 codeload URL 且 `consistent: true`。
- **Step 3**：提交到 main（一次提交，message 引 issue #44；列四处变更点 + 红绿留证摘要 + 断言面改写清单——本计划零改写，全为新增）。
- **Step 4**：起草 CHANGELOG 双语条目（背景/做法/测试/兼容性四段，随发版号落位）与 issue #44 回帖草案（扩面说明：#3/#4/#5 同根因类一并修复 + 本机探针证据）——**保存为草案文本随最终回复呈报，不执行发版/回帖/关闭**。

## 接口契约（Consumes / Produces）

- **hex40 三级兜底口径**（体内 `commit:` 字段 → 键内 40 位 hex → tarball 值内 40 位 hex）：Task 2（`lockResolutionOf`）Produces 口径定义；Task 3（`lockCommitOf`）Consumes 同一口径；两侧注释互引，测试夹具用同形态（本机实锁逐字）。
- **`lockCommitIdentity: string | null`**：Task 2 Produces（profile-transaction.ts:96 类型放宽 + market-mutation.ts:762 构造点）；Task 3 Consumes（:1144 消费臂，`commit === null` 拒绝路径由 Task 3 用例 3 钉住）。
- **semver 形态门正则字面 `^\d+\.\d+\.\d+`**：Task 1 Produces；doctor.test.mjs 用例字面钉行为。
- **后缀剥离正则字面 `/(\([^)]*\))+$/`**：Task 1（doctor）与 Task 3（lockVersionOf）各自使用，注释互引同源。

## 执行纪律

- 开工前批判性复查本计划；发现缺项/矛盾/验证命令失效先修计划再动手。
- 按任务顺序执行；edit 前先 read 同文件（workspace 编辑快照规矩）；不无声跳步。
- 每任务完成即跑该任务验证；红灯留证（期望/实际值）后才进实现步。
- 阻塞或计划与仓库现实不符 → 停下说明，不猜。
- 全部完成后跑最终验证并输出修改摘要。

## 最终验证

1. `npm test` 全量零失败（后台跑，基线 2028 + 新增 ≈12）。
2. `npm run typecheck` exit 0。
3. 本机探针：`node lib/cli.js doctor --profile web` 摘要 `账实 20（不一致 0）`、无 qiaomu-rss-dsh 警告。
4. `git log -1 --stat`：单提交含 3 src + 3 tests，message 引 issue #44。
