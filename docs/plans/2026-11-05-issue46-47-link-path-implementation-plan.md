# issue #46/#47「link: 依赖路径判定」实施计划（平台无关绝对路径 + 相对基准解析）

## 目标

- `resolvePluginDir()`（`src/core/installed.ts`）的 `link:` 分支从「只认 `/` 开头的 POSIX 绝对路径」改为平台无关判定：绝对 = `isAbsolute(target)` ∪ 盘符正则 `/^[A-Za-z]:[\\/]/`；相对 = 按 pnpm 语义以 profileDir 为基准解析。目标含 `\0` 恒拒。
- 同一修复传导治好四个生产触点（同函数、零额外改动）：① 枚举归类（classifyDep）→ 治 #46 的搜索 fail-closed 与 #47 的已装隐身；② doctor 账实核对 → 治 #47 的「实装=缺失」误报；③ 卸载门 validateUninstall → 治 Windows link 插件卸载必拒（两报告者均未发现）；④ README 预览 → 治「无法解析插件目录」。
- `dshm_search` fail-closed 门禁**逻辑零改动**（条件与 throw 行为不变）；仅错误文案参数化 profile 名（#46 建议③，desktop 不再误报「web profile」；web profile 文案逐字节不变）。
- 相对/盘符 link 依赖目标**可读时**：从「隐身 + complete:false」变为「正常归类 + complete:true」；目标**不可读时**维持 unknown → complete:false（完整性契约 partial 语义不变）。
- 明确不做（本轮 grill 裁决 Q1–Q8，2026-11-05）：fail-closed 降级出口/配置逃生口（Q4 否决，可另开 issue）、doctor 独立修复（Q6：同根因传导）、UNC 平台分支特判（isAbsolute 在 win32 宿主自然放行；POSIX 宿主解析级放行→读败→unknown，观测上与拒绝等价的诚实语义，不另设正则）、`link:C:x` 盘符相对形态放行（无分隔符，维持 null）、发版与 CHANGELOG/version bump（随发版批次另行批准）、issue 回帖与关闭（另行批准）。

## 架构快照

- 缺陷单点：`resolvePluginDir()` 的 link 分支用 `target.startsWith('/')` 判绝对路径（POSIX-only 假设，M1 提交 b5ed177 引入）。Windows 上 pnpm 写 `link:D:/...`（盘符形态）；pnpm 全平台支持相对 `link:./x`、`link:../x`。两类形态今日全部 `null` → `classifyDep` → `'unknown'` → 既不入 items 也不计 others，仅置 `complete:false`。
- `complete:false` 的两个下游：`listMarket` → `dshm_search` 的 fail-closed 门禁（有命中即 throw，#46 主症状）；已装列表/doctor/CLI 直接缺失条目（#47 主症状）。
- 修复形态：`resolve(profileDir, target)` 一函数两形态——`target` 为绝对路径时 `path.resolve` 忽略基准段，相对时以 profileDir 为基准（pnpm 语义）。`\0` 检查前置一次。POSIX 宿主上 `isAbsolute(posix)` ≡ `startsWith('/')`（已探针实证），POSIX 行为零变化（枚举/doctor 观测面口径，见行为零变化承诺格）。
- 宿主平台错配的诚实语义：POSIX 宿主遇盘符 spec（跨机复制 profile 等病态场景），正则放行后 `resolve(profileDir, 'D:/x')` 落 `<profileDir>/D:/x` → 目录不存在 → 读败 → unknown → complete:false，与今日行为等价（不劣化）。

## 全局约束

- 依赖预检：任何 build/test/typecheck 前确认 node_modules 在场（bash `test -d node_modules` / PowerShell `Test-Path node_modules`；缺失按锁文件恢复——workspace AGENTS.md「仓内构建与依赖恢复」）。
- `src/core/*.ts` 的测试从 `lib/core/*.js`（构建产物）引入；单套件跑之前先 `npm run build`，否则测到旧产物。
- **双机执行环境**：本计划可能在 web 机（Linux bash）或 DSH Desktop Windows 机（PowerShell）执行。命令一律写成跨平台单步形态：不用 `&&` 链（PowerShell 5.1 不支持）、不用 bash-only 判定；每步单独一条命令，退出码以 `$?`（bash）/ `$LASTEXITCODE`（PowerShell）原样判定。npm 调用的 `npm_config_cache` 前缀是 web 机沙箱纪律（EROFS 防护）；Windows 机本地 npm cache 可写，无需前缀。
- 测试输出过过滤管道时保留原进程退出码（bash `set -o pipefail` + `${PIPESTATUS[0]}`；PowerShell 过滤前存 `$LASTEXITCODE`）。
- 源串锚禁含 `\n`（CRLF 检出）；中文文案锚走源结构锚；量化断言用出现次数语义。本役新增测试全为**行为断言**（无源串锚、无 bundle 锚）；tools.ts 文案断言走 rejects 正则（行为面）。
- 注入型测试夹具逐字段对照生产调用点：ActiveProfile 夹具含全部四字段（`name/kind/dir/source`），不得只注部分。
- fail-closed 门禁不动（Q4）：`src/tools.ts` 的 `!result.installedComplete && result.items.length > 0` 条件与空结果豁免行为保持；`tests/market.test.mjs` 三条既有钉例（≈:703/:718/:736）**零改动**。
- 完整性契约（`src/core/installed.ts` 头注，2026-09-09）：任一依赖「无法判断」即 `complete:false`、partial 结果保留、unknown 不冒充非 DSH——本役不改契约，只改「哪些形态能判」。
- 无新增配置面；`PACKUMENT_CAP`/路由/store 等零接触；`parseSpecSource`、`isSafePkgName`、非 link 分支零改动。
- 基线：web 机 2026-11-05 `npm test` 全绿 2071/2071（本役开工前实测）。Windows 机首次全量跑套件时，若出现既有用例平台性失败（如 symlink 权限类），按测试名记录为「环境既有」并与本役回归判别——不得静默跳过或改既有用例。

## 输入工件

- issue #46：https://github.com/iasiv5/dsh-m/issues/46（AA0111-A；盘符+相对 link → fail-closed 全灭；报告者附根因/最小 diff/测试建议——已逐条核实，其正则口径采纳、diff 逻辑重写）
- issue #47：https://github.com/iasiv5/dsh-m/issues/47（18661575856；Windows junction link 隐身 + doctor 误报；其 doctor「第二检测点/lstat 假设」已被推翻——同一函数，未到 stat）
- 设计共识：本轮 grill 8 项决策（Q1–Q8 全按推荐，2026-11-05 会话记录）
- 先例：#45 计划格式（`docs/plans/2026-11-05-issue45-published-at-implementation-plan.md`）；0.11.0 实录「改输出先普查断言面」纪律
- 对抗式评审：`.dsh-research/issue4647-plan-review-scratch/ledger.md`（web 机本地 scratch，其他机器不可达；追溯以本行括注与计划正文「评审 R1-D1 裁决 A′」标记为准——R1：F1 实现块自相矛盾已修 A′、F2 Windows ESM specifier 已修、F3 承诺格已补；R2 复验 2085/2085 全绿零 blocker）

## 文件结构与职责

- Modify: `src/core/installed.ts` —— `resolvePluginDir` link 分支平台无关化（唯一行为改动点）；docstring 补形态语义
- Modify: `src/tools.ts` —— fail-closed throw 文案参数化 `${profile.name}`（一行）
- Modify: `tests/installed.test.mjs` —— 新增两个 describe：`resolvePluginDir` 形态判定单元钉例 + `listInstalledPlugins` link 集成钉例（含 README 触点）
- Modify: `tests/doctor.test.mjs` —— checkAccount describe 增 1 条相对 link 用例
- Modify: `tests/market.test.mjs` —— fail-closed describe 增 1 条 desktop 文案用例
- 只读核对面（零改动）：`src/core/doctor.ts`、`src/core/profile-transaction.ts`、`src/client/installed-view.js`（client 钉例 shape 面）、`tests/market-golden.test.mjs`

关键现场锚（时点 2026-11-05，符号优先，行号为 web 机工作树时点参考）：

| 锚 | 位置 |
|---|---|
| `resolvePluginDir`（docstring + link 分支 `target.startsWith('/')`） | `src/core/installed.ts` ≈:67-82 |
| `import { join, resolve } from 'node:path'` | 同文件 ≈:13 |
| `classifyDep` 的 `if (!dir) return 'unknown'` | 同文件 ≈:212-216 |
| `listInstalledPlugins`（unknown → complete=false，items/others 保留） | 同文件 ≈:267-293 |
| `readInstalledPluginReadme`（`if (!dir) throw 无法解析插件目录`） | 同文件 ≈:331-355（:346-347） |
| 完整性契约头注 | 同文件 ≈:1-11 |
| `checkAccount`（`const dir = resolvePluginDir(root, name, spec)`；link 分支 `consistent = installed !== null`） | `src/core/doctor.ts` ≈:447-490（:456 / :465-466） |
| `validateUninstall`（`dir === null → PLUGIN_METADATA_UNREADABLE`） | `src/core/profile-transaction.ts` ≈:902-936（:916-919） |
| `registerTools` 第 4 参 `profile: ActiveProfile` | `src/tools.ts` ≈:110-115 |
| fail-closed 门禁与 throw 文案 | `src/tools.ts` ≈:195-200（:198-199） |
| `ActiveProfile` 形态（`name/kind/dir/source` 四字段） | `src/core/active-profile.ts` ≈:27-35 |
| 升级路径消费（`installed.find(it => it.pkg === pkg)`，非守卫） | `src/core/market-mutation.ts` ≈:926-936（:931） |
| installed.test 夹具（`manifest`/`pkgJson` helpers；`dir` 每用例 mkdtemp） | `tests/installed.test.mjs` ≈:22-51；import 行 ≈:16（`join`）/:19（补 `resolvePluginDir`/`resolve`） |
| doctor.test 夹具（`mkProfile`/`mkInstalled`/`lock`） | `tests/doctor.test.mjs` ≈:236-247 |
| 既有 doctor link 用例（新用例插其 `it` 块之后） | `tests/doctor.test.mjs` ≈:292-304 |
| fail-closed describe（`searchToolWith` 三参注册；既有钉例） | `tests/market.test.mjs` ≈:656-785（:674-682/:703/:718/:736/:762） |
| 相对 link 守卫用例（零影响验证面：目标不存在两侧同型 unknown） | `tests/market-mutation.test.mjs` ≈:509-537 |
| client link 形态钉例（shape 零变化面） | `tests/client-installed-view.test.mjs` ≈:25-34 |

## 行为零变化承诺（每特性必填格）

| 口径 | 承诺 |
|---|---|
| POSIX 宿主 + POSIX 绝对 link（`link:/x`） | 解析结果逐字节不变：`resolve(target)` ≡ 新实现 `resolve(profileDir, target)`（`isAbsolute(posix)` ≡ `startsWith('/')`，探针已证） |
| 任意宿主 + 非 link spec（npm/github/file） | 零变化：`join(resolve(profileDir), 'node_modules', pkg)` 分支未动 |
| 任意宿主 + `InstalledPluginsResult` / `InstalledPlugin` 形状 | 零变化：无新增字段、无键增删；`complete/others` 语义不变（契约不动） |
| web profile 的 fail-closed 文案 | 逐字节不变：fallback 名即 `'web'`（`active-profile.ts` ≈:28），插值后字符串与今日一致 |
| fail-closed 门禁行为 | 零变化：条件、空结果豁免、throw 通道全部不动；三条既有钉例零改动全绿 |
| 相对/盘符 link 目标不可读 | **枚举与 doctor 观测面**与今日等价：null→unknown 与 解析后读败→unknown 同型（complete:false、items/others 不计）；退化形态（`''`/`.`/`..` 等落 profile 自身或其父）维持 null→unknown |
| 退化输入的非枚举触点（声明面，评审 R1-F3） | POSIX 宿主 + 盘符 spec 的 README 预览：今日 throw `无法解析插件目录` → 修复后解析落不存在路径返回空 README（成功态）；卸载门 note 文案 `无法解析插件目录: pkg` → `插件 package.json 读取失败（<dir>）：ENOENT`——reject code 同为 `PLUGIN_METADATA_UNREADABLE`，枚举/doctor 观测不变 |
| **声明变化面（本役目的）** | ① 盘符/相对（及 win32 宿主 UNC）link 目标可读时：从隐身+incomplete → 正常归类+complete:true（items 增条目、doctor 消警、卸载门放行、README 可读、搜索 fail-closed 不再触发）；② desktop profile 的 fail-closed 文案「web profile」→「desktop profile」；③ Windows 宿主升级路径：link 插件从「未安装该插件」错误 → 进入 ADR-0026 本地 spec unsupported 既有语义 |
| golden（`tests/fixtures/market-golden.json` 8 captures） | 逐字节零漂移（fixture 无 link 形态，grep 零命中已证；`UPDATE_GOLDEN` 全程不触发） |

## 断言面普查（四类，web 机现场核证 2026-11-05，执行时复核）

- **A 全对象 deepEqual**：`tests/installed.test.mjs` 中 `deepEqual(res.items, …)` 5 处（≈:79/:89/:145/:161/:205）——4 处空数组形态、1 处 `items.map(pkg)` 序列；本役无形状变化 → 兼容。`tests/doctor.test.mjs` ≈:445 `deepEqual(r.dualMarket)` 无关面。新增条目只增 items 成员，不破坏空数组断言（空数组用例的 deps 均无 link spec）。
- **B `Object.keys` 键集合断言**：涉及 `listInstalledPlugins`/`checkAccount` 结果键集的断言 grep **零命中**（2026-11-05 现场核证）→ 无影响。
- **C 捕获 opts 全对象**：本役不改 `listMarket` 调用 opts（门禁与 opts 零改动，Q4）→ `tests/tools-search.test.mjs` 的 `calls.push(opts)` 捕获面零影响；`deepEqual(captured…)` 形态 grep 零命中。
- **D 冻结钉例逐文件清点**（结论：既有钉例零改动，新增用例自带夹具）：
  - `tests/market.test.mjs` ≈:656 describe 五例：:703/:736 rejects 正则 `/安装标注不可用/` 为**尾部子串匹配**——文案前置段参数化后仍命中 → 兼容；:718 空结果豁免（门禁未动）→ 绿；:684/:762 透传与合法端到端 → 绿。
  - `tests/doctor.test.mjs` ≈:292 既有 link 用例（POSIX 绝对 `link:${join(home,…)}`）：修复后实现值 `resolve(profileDir, target)` 与断言字段（`pin`/`installed`/`lockfile`/`consistent`）全兼容 → 绿（POSIX 宿主）。
  - `tests/market-mutation.test.mjs` ≈:509-537 相对 link 守卫用例：守卫按 spec 前缀拒绝（GUARD_MANUAL_REQUIRED），不经 resolvePluginDir；且其目标目录不存在，枚举（若触达）两侧同型 unknown → 绿。
  - `tests/client-installed-view.test.mjs` ≈:25-34：`source: 'link'` 的 vm/guard 键断言——`InstalledPlugin` shape 零变化 → 绿。
  - `tests/market-golden.test.mjs`：fixture 无 link 形态（grep 零命中）→ 零漂移。
  - `src/cli.ts` ≈:139 `link: '本地 link'` 标签：`PluginSource` 枚举未动 → 绿。

## 任务间验收映射（计划追溯）

| 需求（issue 断言 / grill 决议） | 落点 |
|---|---|
| #46：盘符 link → 判 unknown → fail-closed 全灭 | Task 1（单元 ①② + 集成 ③） |
| #46：相对 link 应按 profileDir 解析（pnpm 语义） | Task 1（单元 ⑤ + 集成 ①） |
| #46：目标不存在仍 unknown + complete:false（partial 保持） | Task 1（单元 ④⑥ + 集成 ②） |
| #47：junction link 隐身 + complete:false + doctor 实装=缺失 | Task 1（集成 ① + doctor 用例；junction 形态由 Windows 实机验收覆盖） |
| Q2：POSIX 行为零变化回归守卫 | Task 1（单元 ⑦ + 全量 + golden） |
| Q4：fail-closed 门禁逻辑不动 | Task 2 零改动面 + 既有三钉例绿 + Task 3 全量 |
| Q5：文案参数化（desktop 不误报 web） | Task 2 |
| Q6：doctor 同根因传导、补相对 link 用例 | Task 1（doctor 用例） |
| 两报告者未发现的触点（卸载门/README/升级路径） | Task 1（README 集成用例）+ 声明变化面格 + Windows 实机验收 |
| Q8：0.12.6 发版 | 计划外（发版批次另行批准） |

---

### Task 1: `resolvePluginDir` 平台无关化（枚举/doctor/README 三面红绿）

- 目标：三组失败测试先红（今日实现），单点修复后全绿。
- 涉及文件：Modify `tests/installed.test.mjs`、Modify `tests/doctor.test.mjs`、Modify `src/core/installed.ts`
- 接口契约
  - Consumes：无新依赖（`node:path` 既有 `resolve`，补 import `isAbsolute`）
  - Produces（全部下游自动消费，签名不变）：`resolvePluginDir(profileDir, pkg, spec): string | null` link 分支语义变更——绝对 = `isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target)`（平台无关字面判定）；相对 = 按 pnpm 语义一律以 profileDir 为基准解析（含 bare `link:foo` 形态；target 绝对时 `resolve` 忽略基准）；恒拒三类：含 `\0`、盘符相对 `C:x`（无分隔符）、退化形态（解析落 profileDir 自身或其父——`''`/`.`/`..`/`./` 等，维持今日 unknown，不冒充 others、不自读 profile manifest）
- 验证范围：形态判定矩阵（POSIX 绝对/盘符正反斜杠/盘符相对/相对/`\0`/退化）× 集成（共存/缺失/盘符缺失/非 DSH others/README）

- [ ] Step 0: 断言面普查复核（上表四类为 web 机 2026-11-05 现场证据；Windows 机执行时复核 A/D 两类锚仍在位——`deepEqual(res.items` 5 处、fail-closed describe 五例）
- [ ] Step 1: 写失败测试。

  1a. `tests/installed.test.mjs`：import 行补齐——`import { join, resolve } from 'node:path'`（≈:16 现仅 `join`）；`resolvePluginDir` 并入 ≈:19 的 `installed.js` import。文件末尾追加：

  ```js
  describe('resolvePluginDir：link 目标形态判定（issue #46/#47）', () => {
    it('⑦ POSIX 绝对形态 link:/tmp/x → 非 null（现状回归守卫）', () => {
      assert.equal(resolvePluginDir(dir, 'pkg', 'link:/tmp/x'), resolve(dir, '/tmp/x'))
    })
    it('① 盘符正斜杠 link:C:/x → 非 null（平台无关字面判定）', () => {
      assert.equal(resolvePluginDir(dir, 'pkg', 'link:C:/x'), resolve(dir, 'C:/x'))
    })
    it('② 盘符反斜杠 link:C:\\x → 非 null', () => {
      assert.equal(resolvePluginDir(dir, 'pkg', 'link:C:\\x'), resolve(dir, 'C:\\x'))
    })
    it('④ 盘符相对 link:C:x（无分隔符）→ null', () => {
      assert.equal(resolvePluginDir(dir, 'pkg', 'link:C:x'), null)
    })
    it('⑤ 相对形态 link:./x 与 link:../x → 按 profileDir 基准解析', () => {
      assert.equal(resolvePluginDir(dir, 'pkg', 'link:./x'), resolve(dir, './x'))
      assert.equal(resolvePluginDir(dir, 'pkg', 'link:../x'), resolve(dir, '../x'))
    })
    it('⑥ 目标含 NUL → null（绝对与相对两形态都拒）', () => {
      assert.equal(resolvePluginDir(dir, 'pkg', 'link:/tmp/x\0y'), null)
      assert.equal(resolvePluginDir(dir, 'pkg', 'link:./x\0'), null)
    })
    it('⑧ 退化形态（空目标 / 点 / 双点）→ null（解析落 profile 自身或其父，回归守卫）', () => {
      assert.equal(resolvePluginDir(dir, 'pkg', 'link:'), null)
      assert.equal(resolvePluginDir(dir, 'pkg', 'link:.'), null)
      assert.equal(resolvePluginDir(dir, 'pkg', 'link:..'), null)
    })
  })

  describe('listInstalledPlugins：link 依赖归类（issue #46/#47）', () => {
    it('① 相对 link 目标存在 → 与物化 npm 依赖共存，complete:true，source/path 为真实目标', async () => {
      manifest({ dependencies: { 'pkg-n': '1.0.0', '@local/dev': 'link:./local/dev' } })
      pkgJson('pkg-n', { name: 'pkg-n', version: '1.0.0', dsh: { client: { platform: 'web' } } })
      mkdirSync(join(dir, 'local', 'dev'), { recursive: true })
      writeFileSync(join(dir, 'local', 'dev', 'package.json'), JSON.stringify({ name: 'dev', version: '0.1.0', dsh: { client: { platform: 'web' } } }))
      const res = await listInstalledPlugins(dir)
      assert.equal(res.complete, true)
      assert.deepEqual(res.items.map((it) => it.pkg), ['@local/dev', 'pkg-n'])
      const link = res.items.find((it) => it.source === 'link')
      assert.equal(link.path, resolve(dir, './local/dev'))
      assert.equal(link.spec, 'link:./local/dev')
    })
    it('② 相对 link 目标缺失 → unknown → complete:false（partial 语义不变）', async () => {
      manifest({ dependencies: { '@local/ghost': 'link:./missing/dev' } })
      const res = await listInstalledPlugins(dir)
      assert.equal(res.complete, false)
      assert.deepEqual(res.items, [])
      assert.equal(res.others, 0)
    })
    it('③ 盘符 link 目标不存在 → unknown → complete:false（宿主平台错配的诚实语义）', async () => {
      manifest({ dependencies: { 'win-only': 'link:C:/dshm-issue46-probe-must-not-exist' } })
      const res = await listInstalledPlugins(dir)
      assert.equal(res.complete, false)
      assert.deepEqual(res.items, [])
    })
    it('④ link 目标 manifest 无 dsh 字段 → others 计数（确认非 DSH 语义不变）', async () => {
      manifest({ dependencies: { '@local/plain': 'link:./local/plain' } })
      mkdirSync(join(dir, 'local', 'plain'), { recursive: true })
      writeFileSync(join(dir, 'local', 'plain', 'package.json'), JSON.stringify({ name: 'plain', version: '0.1.0' }))
      const res = await listInstalledPlugins(dir)
      assert.equal(res.complete, true)
      assert.deepEqual(res.items, [])
      assert.equal(res.others, 1)
    })
    it('⑤ 相对 link 依赖的 README 从解析目标读取（触点④）', async () => {
      manifest({ dependencies: { '@local/dev': 'link:./local/dev' } })
      mkdirSync(join(dir, 'local', 'dev'), { recursive: true })
      writeFileSync(join(dir, 'local', 'dev', 'package.json'), JSON.stringify({ name: 'dev', version: '0.1.0', dsh: {} }))
      writeFileSync(join(dir, 'local', 'dev', 'README.md'), '# dev readme')
      const r = await readInstalledPluginReadme('@local/dev', dir)
      assert.equal(r.readme, '# dev readme')
    })
  })
  ```

  1b. `tests/doctor.test.mjs`：在既有用例 `it('link: 依赖——pin 记原文、installed 取目标 package.json、lockfile 置 null'…)`（≈:292-304）的 `it` 块之后、同一 describe 内追加：

  ```js
  it('link: 相对 spec 按 profile 基准解析 → consistent（issue #46/#47）', async () => {
    mkProfile({ 'pkg-rel': 'link:./linked-rel' }, lock([]))
    mkdirSync(join(profile, 'linked-rel'), { recursive: true })
    writeFileSync(join(profile, 'linked-rel', 'package.json'), JSON.stringify({ name: 'linked-rel', version: '3.1.0' }))
    const r = await checkAccount(profile)
    assert.equal(r.account[0].pin, 'link:./linked-rel')
    assert.equal(r.account[0].installed, '3.1.0')
    assert.equal(r.account[0].lockfile, null)
    assert.equal(r.account[0].consistent, true)
    assert.equal(r.findings.length, 0)
  })
  ```

- Run: `npm run build` → `node --test tests/installed.test.mjs` → `node --test tests/doctor.test.mjs`（三条命令分开跑，各自记退出码）
- Expected: **红，且红形态恰好为**——installed 套件红 6 例：单元 ①②⑤（实际值为 `null`，`assert.equal(null, 非null)` 失败；⑦④⑥⑧ 为绿守卫）+ 集成 ①⑤（`complete:false`、README throw `无法解析插件目录`）+ 集成 ④（`others:0`）——集成 ②③ 为绿守卫（两侧同型 unknown）；doctor 套件红 1 例（`consistent:false`）。红例数 7、绿守卫数 6；若出现列表外的红，停下排查（夹具或环境问题），不猜。
- [ ] Step 2: 确认失败形态与上表逐一吻合（红确认纪律：进程退出码非 0 + 具体红例名，而非数 `not ok` 行数）
- [ ] Step 3: 最小实现 `src/core/installed.ts`：≈:13 import 改 `import { isAbsolute, join, resolve } from 'node:path'`；docstring（≈:67-72）补一条：「link 目标形态（issue #46/#47）：绝对 = `isAbsolute`（宿主平台原生：POSIX `/x`、Windows `C:\x`、UNC）∪ 盘符正则 `/^[A-Za-z]:[\\/]/`（跨平台字面形态，ubuntu CI 可钉）；相对（含 bare `link:foo`）= 按 pnpm 语义以 profileDir 为基准解析。恒拒：`\0`、盘符相对 `C:x`、退化形态（解析落 profile 自身或其父）。`resolve(profileDir, target)` 一函数两形态——target 绝对时 resolve 忽略基准」；link 分支（≈:76-80）替换为：

  ```ts
  if (source === 'link') {
    const target = String(spec).slice('link:'.length).trim()
    const absolute = isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target)
    // 恒拒：\0；盘符相对（C:x，无分隔符）。
    if (target.includes('\0') || (!absolute && /^[A-Za-z]:/.test(target))) return null
    const dir = resolve(profileDir, target) // target 绝对时忽略基准——绝对/相对一函数两形态
    // 退化相对形态（''/. / .. / ./ 等——解析落 profile 自身或其父）维持 null：
    // 与今日 unknown 等价，不冒充 others、不自读 profile manifest（评审 R1-D1 裁决 A′）。
    if (!absolute && (dir === resolve(profileDir) || dir === resolve(profileDir, '..'))) return null
    return dir
  }
  ```

  非 link 分支（`return join(resolve(profileDir), 'node_modules', pkg)`）与函数其余部分零改动。
- [ ] Step 4: 复跑同三条命令
- Expected: 全绿（installed ≈43+12、doctor 全量、market ≈既有+0；以现场计数为准）
- [ ] Step 5: checkpoint commit（可选，自然边界；commit message 逐一列改动文件与用例名）

### Task 2: fail-closed 文案参数化（profile 名插值）

- 目标：desktop profile 报错不再误报「web profile」；web 文案逐字节不变；门禁逻辑零改动。
- 涉及文件：Modify `tests/market.test.mjs`、Modify `src/tools.ts`
- 接口契约
  - Consumes：`registerTools` 第 4 参 `profile: ActiveProfile`（`src/tools.ts` ≈:110-115；测试注入先例 = market.test.mjs `searchToolWith` 的三参注册，本役用例自带四参内联注册）
  - Produces：throw 文案 `读取 ${profile.name} profile 安装状态失败，安装标注不可用；请稍后重试`（模板串，`src/tools.ts` ≈:199）
- 验证范围：desktop 名正则 rejects 红→绿；web 名逐字节等价（回归钉）；既有三钉例零改动全绿

- [ ] Step 1: `tests/market.test.mjs` fail-closed describe（≈:656）内、「非空结果的安装状态不完整时 fail-closed」用例（≈:703）之后追加：

  ```js
  it('fail-closed 文案带 profile 名（desktop 不误报 web，issue #46 建议③）', async () => {
    const { registerTools } = await import('../lib/tools.js')
    const registered = []
    const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {} }
    registerTools(ctx, cfg, { listMarket: async () => ({ items: [{ ...sentinel, installed: false, installedPkg: undefined, installedVersion: undefined }], total: 1, offset: 0, limit: 5, categoryCounts: { ...emptyCounts, tools: 1 }, registryState: readyState, installedComplete: false, latestComplete: true, latestTimedOut: false }) }, { name: 'desktop', kind: 'desktop', dir: 'C:\\dshm-fake-desktop-profile', source: 'fallback' })
    const search = registered.find((t) => t.name === 'dshm_search')
    assert.ok(search, 'dshm_search 已注册')
    await assert.rejects(() => search.execute({ query: 'sentinel' }), /读取 desktop profile 安装状态失败/)
  })
  ```

  （夹具逐字段对照 `ActiveProfile` 四字段：`name/kind/dir/source`；`sentinel`/`emptyCounts`/`readyState` 为同 describe 既有夹具常量，≈:658-672——同一 describe 内引用，符合「不引兄弟 describe」纪律。）

- Run: `npm run build` → `node --test tests/market.test.mjs`
- Expected: 红——恰好新用例 1 例失败（现文案恒 `读取 web profile 安装状态失败…`，正则 `/读取 desktop profile 安装状态失败/` 不命中）；既有 :703/:718/:736 钉例全绿（门禁未动）
- [ ] Step 2: 确认失败（新例红、既有绿，形态吻合）
- [ ] Step 3: 实现 `src/tools.ts` ≈:199：`throw new Error('读取 web profile 安装状态失败，安装标注不可用；请稍后重试')` 改为模板串 `` throw new Error(`读取 ${profile.name} profile 安装状态失败，安装标注不可用；请稍后重试`) ``。门禁条件行（≈:198）零改动。
- [ ] Step 4: 复跑同命令 → 绿（新例过；既有钉例 `/安装标注不可用/` 尾部匹配兼容；web fallback 名 `'web'` 使 web 场景逐字节等价）
- [ ] Step 5: checkpoint commit（可选）

### Task 3: 全量收口 + Windows 实机验收

- 目标：全仓门禁绿 + 两台机器的验收判据闭环。
- 涉及文件：无代码改动（纯验证）

- [ ] Step 1: 全量收口（web 机与 Windows 机各跑一遍；Windows 用 PowerShell 逐条跑）
  - `npm run build`
  - `npm test`
  - `npm run typecheck`
  - `node --test tests/market-golden.test.mjs`（不带 `UPDATE_GOLDEN`，零漂移复证）
- Expected: 四条命令退出码全 0；`npm test` 全绿（web 机 2071+14 用例量级：installed 12 + doctor 1 + market 1；Windows 机如有环境既有失败按全局约束基线条判别，本役新增 14 例必须全绿）
- [ ] Step 2: 输出修改摘要（逐文件可归因：`installed.ts` link 分支 + import/docstring、`tools.ts` 一行文案、三个测试文件各新增 describe/用例；计划外改动为零）
- [ ] Step 3（Windows 实机验收——主人在 DSH Desktop 机执行，issue #47 的真实环境即现成夹具）：
  - 环境：`C:\Users\Kele_\.dsh\profiles\desktop` 含 `@local/memos-sidebar-button: link:D:/AgentGlobal/plugins/memos-sidebar-button`（junction 实装）。升级本机 dsh-m 到含本修复的版本（或以仓库 `node .` 直跑）。
  - PowerShell 探针（**先 `Set-Location <repo>` 到仓库根再跑 node**——盘符路径作 ESM specifier 会 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，评审 R1-F2 已实证；用相对 specifier）：
    1. `node --input-type=module -e "import { listInstalledPlugins } from './lib/core/installed.js'; …"` 对该 profile 枚举 → **断言**：`complete === true`、`items` 含 `pkg === '@local/memos-sidebar-button'` 且其 `path === 'D:\\AgentGlobal\\plugins\\memos-sidebar-button'`（resolve 规范化形态）、`source === 'link'`。
    2. 同法 `import { checkAccount } from './lib/core/doctor.js'` → 该包行 `consistent === true`、`installed` 为其 manifest version。
    3. `dshm doctor --profile desktop` → 不再出现该包「账实分裂 · 实装=缺失」告警。
    4. `dshm list` → 已装列表含该插件（「已装」页同理可见）。
    5. 有命中搜索不再 fail-closed：`dshm search <任一该机有命中词>` → 正常出卡片（修复前 `读取 web profile 安装状态失败`）。
  - 传导面说明（无独立验收判据，同函数自动受益）：卸载门 validateUninstall 对该包不再 `PLUGIN_METADATA_UNREADABLE`（实际执行卸载会移除插件，属破坏性操作——**验收只到枚举/doctor/搜索层面即可**，卸载放行由单点修复的单元钉例背书）。
- [ ] Step 4: 输出修改摘要终版

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行；每任务先跑该任务验证再进下一任务；不无声跳步、合并步或改变任务目标。
- Task 1 Step 1 的红形态清单是**判据**：红例多、少、或名不符 → 停下排查（夹具/环境/锚漂移），不猜。行号锚漂移一律以符号锚重定位。
- 双机执行：web 机（bash）与 Windows 机（PowerShell）命令均为单步跨平台形态；Windows 下退出码读 `$LASTEXITCODE`；PowerShell 不用 `&&`。
- 当前分支 `main`：开工前向主人确认（或按主人指示开分支/在 Windows 机的工作副本上执行）。
- 全部任务完成后运行最终验证并输出修改摘要；**停在这里**——`npm run release`、版本 bump/CHANGELOG（0.12.6 发版批次）、issue #46/#47 回帖（须 @ 报告者 AA0111-A、18661575856）与关闭，均属不可逆公开动作，另等当轮明确批准（dsh-m AGENTS.md 发版规矩）。
- CHANGELOG 顶条要点（供发版批次起草，非本任务）：中文/英文各一条 0.12.6 修复条目——link: 依赖平台无关路径判定（盘符/相对 spec 按.profileDir 基准解析），Windows link 插件从已装列表/doctor/卸载/README 四面隐身修复，搜索 fail-closed 误触发消除；compatibility 注明 desktop fail-closed 文案变化与 Windows 升级路径语义面。

## 最终验证

- `npm run build` → `npm test`（全绿，原退出码 0）
- `npm run typecheck`（0 错误）
- `node --test tests/market-golden.test.mjs` 单跑复证（不带 `UPDATE_GOLDEN`，绿 = 缺省零漂移）
- `node --test tests/installed.test.mjs tests/doctor.test.mjs tests/market.test.mjs` 单套件复跑（绿）
- Windows 实机验收（Task 3 Step 3）五判据齐全后，本役验证闭环
