# 自定义 profile 写操作支持（issue #39，同业对齐 dsh-market）实施计划

## 全局约束（逐字继承，来自 2026-11-02 grilling 共识 Q1–Q8）

- **方向**：接受「自定义 profile 支持市场写操作」；判定采用 dsh-market 同业模型——host 来源 + 路径安全名即可操作，desktop 判定保留现有两条事实（`desktop`/`tauri` 名字快路径 + generation 投影探测，探测正恒优先于名字判定）。
- **不引入** `DSHM_PROFILE_KIND` 声明面（共识 Q1；dsh-market 生产实践证明声明面非必要，dsh-m 的投影探测比对方更强，保留后防线不劣于同业）。
- **fallback 零漂移基线**：无 profileContext 的旧宿主，缺省行为完全不变；argv 兜底（共识 Q2=做）只在 fallback 分支内生效且 kind 恒 web（旧宿主无官方管理器可委派，绝不判 desktop）。
- **desktop 侧零变化**：能力表（DESKTOP_ALLOWED）、desktop 委派路径、desktop 拒绝指引文案全部不动（共识 Q8）。**文案冻结的断言面**：既有 WRITE_GUIDANCE 断言全是引用断言（`assert.equal(caught.guidance, WRITE_GUIDANCE[action])` 同源比对，文案改了照样绿）——Task 2 补 desktop 六条指引的字面量快照断言（deepEqual 内联字面量表），使「零改动」可回归验证；DESKTOP_ALLOWED 与委派路径已有行为断言支撑，无需补。restart / self-upgrade 在 web kind 下随判定自然放行，不单独设门（共识 Q8）。
- **原子交付**：判定放开与三入口写路径接线必须同一变更（共识 Q3）——只放开判定而接线不完整 = 静默错写 profile。
- **dir 权威**：host 来源时读写一律用 `profileContext.dir`（宿主说的算，绝不从名字推导）；`webProfileDir()` 只保留给 fallback 分支。不做「dir ≠ webProfileDir() 即拒绝」的兜底（共识 Q1 推翻报告者期望 #3——aqua 的 dir 本来就不等于 webProfileDir()，拒绝它等于拒绝目标场景）。
- **版本**：0.12.0（minor，语义放宽）。**发版不在本计划内**：本计划止于全量验证绿；`npm run release` 待主人批准 diff 后单独走（dsh-m/AGENTS.md 发版纪律：lock 三处同步、`npm run check-release` 门禁）。
- **文档**：新增 ADR-0030；ADR-0005 的「未知名 profile 显式拒写」决议原地修订并标注指向 ADR-0030（共识 Q5）；CHANGELOG 中英双语各补 0.12.0 条目。
- **仓内纪律**（dsh-m/AGENTS.md + docs/CODING-STANDARDS.md）：测试锚纪律（源结构锚用 `src.split(needle).length - 1` 计数语义、禁 `\n` 转义多行锚、中文文案锚走源结构锚）；验证输出过管道必须 `set -o pipefail` 保留退出码；每次 build/test 前 `test -d node_modules`；edit 前先 read。
- 无额外平台约束（验证命令 bash + node --test，与仓内既有惯例一致）。

## 架构快照

判定模型（`resolveActiveProfile`）：

```
profileContext 在（host 来源，source: 'host'）：
  name/dir 恒取宿主（现状不变）
  kind：
    name ∈ {desktop, tauri}            → desktop（不变）
    generation 投影探测正（任意名）      → desktop（不变，事实优先）
    isDshProfileName(name) === true    → web   ← 本次放开（原 unknown 拒写）
    其余（名字不能做安全路径段）         → unknown → 结构化拒写（unknown 语义收窄）
profileContext 缺席（fallback，source: 'fallback'）：
  process.argv 有 --profile <安全名>   → { name, kind: 'web', dir: join(dshHome(),'profiles',name) }  ← 新增兜底
  否则                                → { name:'web', kind:'web', dir: webProfileDir() }（零漂移，不变）
```

写路径接线（读路径 0.9.5 起已传 `profile.dir`，本次补齐写侧同一事实源）：

| 入口 | 写分支 | 传递 |
|---|---|---|
| host-api（面板） | install / uninstall / set-enabled / upgrade / self-upgrade 的 web 分支 | `profileDir: profile.dir`（+ `profileName: profile.name` 给走事务的四支：install / uninstall / upgrade / self-upgrade；set-enabled 走 toggle 仅 profileDir） |
| tools（agent 工具） | dshm_install / dshm_uninstall / dshm_upgrade / dshm_toggle 的 web 分支 | 同上；toggle 仅 `profileDir`（无子进程，不需要 profileName） |
| CLI（dshm） | install / upgrade / toggle / uninstall 放开安全自定义名后 | 同上（desktop/tauri 名维持拒绝，指引官方管理器） |

事务底座（profile-transaction）已有 `profileDir` 参数缝；本次补 `profileName`，直达唯一需要名字的点：`dsh plugin --profile <名>` 子进程（makeDshRunner → makeAddViaLadder / removeDshPlugin → runDshPlugin）。`pnpm --dir`、manifest/lockfile 路径继续只认 `profileDir`。

同业依据（dsh-market 1.73.8 实证，详见 ADR-0030）：安全名判定 `isDshProfileName`（非空、非 `.`/`..`/`node_modules`、不含 `/` `\` `\0`）；`'web'` 只是兜底链末环不是权限门；桌面分支由服务契约（desktopProfiles/pluginManager + 名字 `desktop`）承接；tauri 名与其余自定义名走同一 web 文件事务路径；代际感知是读侧事实不构成写权限门。

## 文件结构与职责

**修改：**

| 文件 | 职责变化 |
|---|---|
| `src/core/env.ts` | +`isDshProfileName(name)`（路径段安全性，唯一判定源）；+`dshProfileDirByName(name)`（CLI 体检用：desktop → desktopProfileDir()，其余安全名 → `join(dshHome(),'profiles',name)`） |
| `src/core/active-profile.ts` | `kindOf` 收窄 unknown 语义；fallback 分支 argv 兜底；+`WRITE_GUIDANCE_UNKNOWN` 统一文案（unknown 现在只剩「名字不安全」一种；既有六条按 action 的 desktop 指引零改动） |
| `src/core/dsh-cli.ts` | `runDshPlugin` 守卫从字面量比较改为 `isDshProfileName`；`makeAddViaLadder` deps +`profile`（两处 `run(WEB_PROFILE, …)` 改读 deps）；`removeDshPlugin` deps +`profile`；`makeDshRunner(profileDir, profileName?)` |
| `src/core/profile-transaction.ts` | `TransactionDeps` +`profileName`；runner 工厂签名 `(profileDir, profileName?)`；resolveDeps/base 贯穿 |
| `src/core/market-mutation.ts` | `InstallDeps` +`profileName`；`UninstallDeps` +`profileDir`/`profileName`；installFromRegistry / upgradePlugin / selfUpgrade / uninstallPlugin 四入口贯穿到 transaction deps |
| `src/core/host-api.ts` | web 写分支（install/uninstall/set-enabled/upgrade/self-upgrade）传 `profile.dir`/`profile.name` |
| `src/tools.ts` | dshm_install / dshm_uninstall / dshm_upgrade / dshm_toggle web 分支传参（toggle 仅 profileDir） |
| `src/cli.ts` | `--profile` 门禁放开安全名（desktop/tauri 仍拒）；四写命令接线；doctor 目标目录改 `dshProfileDirByName` |
| `GLOSSARY.md` | 「可操作 profile」新词条 + 「Profile（web profile）」词条语义扩自定义名 |
| `docs/adr/0030-custom-profile-write-support.md` | 新增（决策 + 同业对齐证据 + 残余风险） |
| `docs/adr/0005-dual-profile-support.md` | 「未知名显式拒写」处加修订标注指向 0030 |
| `CHANGELOG.md` | 中英双语各补 0.12.0 条目 |

**测试修改/新增：**

| 文件 | 内容 |
|---|---|
| `tests/active-profile.test.mjs` | 改写「未知名 → unknown」块：aqua → web；不安全名 → unknown；新增 fallback argv 兜底用例 |
| `tests/dsh-cli-governance.test.mjs` | runDshPlugin 接受 `aqua`（断言子进程 argv 含 `--profile aqua`）、拒绝 `../evil`；ladder/remove 传名锚 |
| `tests/profile-transaction.test.mjs` | runner 工厂收到 `(profileDir, profileName)` 断言 |
| `tests/host-api-profile.test.mjs` | web 写分支传参断言（stub 捕获全参）；desktop 分支既有断言保持绿 |
| `tests/tools-install.test.mjs` | 四工具（install / uninstall / upgrade / **toggle**）传参断言 |
| `tests/cli-custom-profile.test.mjs`（**新增**，仓内 CLI 门禁此前无测试） | 门禁改写后的红→绿 |
| `tests/custom-profile-transaction.test.mjs` | **新增**：tmpdir 假 profile 全链集成（Task 9） |

## 关键接口契约（Consumes / Produces）

- **P1（Task 1 产出，Task 4/7/8 消费）** `env.ts`：`isDshProfileName(name: string): boolean`——非空串、非 `.`/`..`/`node_modules`、不含 `/`、`\`、`\0` 即 true；`dshProfileDirByName(name: string): string`。
- **P2（Task 4 产出）** `dsh-cli.ts`：`makeDshRunner(profileDir: string, profileName?: string)`（缺省 `WEB_PROFILE`）；`makeAddViaLadder` deps +`profile?: string`；`removeDshPlugin` deps +`profile?: string`；`runDshPlugin` 接受任意安全名。
- **P3（Task 5 产出，Task 6/7/8 消费；依赖 P2（Task 4）前置——缺省 runner 工厂调用 `(deps?.runner ?? makeDshRunner)(base.profileDir, base.profileName)` 需 P2 的 makeDshRunner 新签名，Task 5 先于 Task 4 会 typecheck 红）**：`TransactionDeps.profileName?: string`；runner 工厂类型 `(profileDir: string, profileName?: string) => PnpmRunner`（旧单参注入兼容：JS 多余实参被忽略）；`InstallDeps.profileName?: string`；`UninstallDeps.profileDir?: string`、`UninstallDeps.profileName?: string`。
- **P4（Task 5 产出）** 事务内部不变量：`profileName` **只**用于 `dsh plugin --profile <名>` 子进程 argv；一切文件路径只来自 `profileDir`。
- **P5（Task 2 产出）** `active-profile.ts`：`unknown` kind 语义 = 「名字不可用作安全路径段」；host 来源的安全名恒有 kind ∈ {web, desktop}；+`WRITE_GUIDANCE_UNKNOWN(name: string): string` 模板函数（unknown 拒绝文案唯一新增符号，`ProfileUnsupportedError` 构造消费）。

## 任务清单

> 每个任务红→绿：先写失败测试，`npm run build && node --test tests/<file>.mjs` 确认红（失败面 = 本任务断言），再最小实现，确认绿。命令均在 `dsh-m/` 下执行，前置 `test -d node_modules`。

### Task 1 — env.ts：isDshProfileName + dshProfileDirByName（TDD）

1. 新增 `tests/env-profile-name.test.mjs`（仓内无独立 env 套件；从 `lib/core/env.js` 引入，同 `tests/active-profile.test.mjs` 的构建产物导入约定）写失败用例：`isDshProfileName` 对 `''`/`.`/`..`/`node_modules`/`a/b`/`a\b`/`a\0b` → false；`aqua`/`web`/`dev-1`/`工作区` → true；`dshProfileDirByName('desktop') === desktopProfileDir()`、`dshProfileDirByName('aqua') === join(dshHome(),'profiles','aqua')`。
2. 确认红 → 实现 → 确认绿。
3. 验证：`npm run build && node --test tests/env-profile-name.test.mjs`。

### Task 2 — active-profile：kindOf 收窄 + 文案（TDD）

1. 改写 `tests/active-profile.test.mjs`「未知名 → kind unknown」块：
   - `name: 'aqua'`（dir 随宿主）→ `{ kind: 'web', dir: 宿主dir, source: 'host' }`（**新主用例**）；
   - `name: '../evil'` → `kind: 'unknown'` 且 `assertWriteAllowed` 六动作全抛 `ProfileUnsupportedError`；
   - 既有 desktop/tauri/fallback/`name=web` 块保持不动（天然回归）；**投影用例块（:161-164）例外**：其第二断言 `pcOf('future-name','/x') + generationProbe:()=>false → kind === 'unknown'` 在新 kindOf 下必红（'future-name' 是安全名 → 'web'，与 P5 一致）——同步改写为 `=== 'web'`，用例名与括号说明改为「未知名 + 投影事实 → 升级 desktop（事实优先）；安全未知名零事实 → web 放行（未知拒写语义已收窄，ADR-0030）」。
2. 确认红（aqua 用例失败）→ `kindOf` 实现：`if (DESKTOP_PROFILE_NAMES.includes(name)) return 'desktop'; if (isDshProfileName(name)) return 'web'; return 'unknown'`；头部注释同步改写（unknown 语义收窄 + 同业对齐出处 ADR-0030）。
3. unknown 拒绝文案按 kind 分治（现状事实：`WRITE_GUIDANCE` 是 `Record<ProfileAction, string>` 六条、desktop 与 unknown 共用，**不存在 unknown 条目**——直接「改 unknown 条目」无法落位）：新增**模板函数** `WRITE_GUIDANCE_UNKNOWN(name: string): string`（普通 string 常量无法承载运行期 profile 名插值）：`当前 profile 名（${name}）不可用作目录段，已拒绝写操作。请改用不含路径分隔符的 profile 名（参考官方 --profile 命名）。`；`ProfileUnsupportedError` 构造改为按 `profile.kind === 'unknown' ? WRITE_GUIDANCE_UNKNOWN(profile.name) : WRITE_GUIDANCE[action]` 选文案源；**既有六条 desktop 指引逐字零改动**（B8 冻结，desktop 只会因 restart 命中它们，行为不变）。
4. **desktop 文案字面快照断言（冻结面支撑，评审 Q4）**：既有断言全为引用断言（与实现同源比对，不感知文案漂移）——新增用例：`assert.deepEqual(WRITE_GUIDANCE, { install: '<当前六条逐字>', … })` 内联字面量表（六条全文从 active-profile.ts :56-62 逐字复制），任何一条文案漂移即红；`WRITE_GUIDANCE_UNKNOWN('test-profile')` 断言返回值含 `test-profile` 与 `不可用作目录段` 锚（函数形态，评审 Q8）。
5. 验证：`npm run build && node --test tests/active-profile.test.mjs`；unknown 用例断言新文案（`不可用作目录段` 锚）。

### Task 3 — active-profile：fallback argv 兜底（TDD）

1. 新增用例（用 try/finally 保存还原 `process.argv`）：
   - fallback + `argv = ['node','dsh','--profile','aqua']` → `{ name:'aqua', kind:'web', dir: join(dshHome(),'profiles','aqua'), source:'fallback' }`；
   - fallback + `--profile ../evil`（不安全名）→ 忽略 argv，回退现状（name web / dir webProfileDir()）；
   - fallback + 无 argv → 与既有 fallback 用例逐字节一致（零漂移锚）；
   - host 来源时 argv 存在不影响结果（profileContext 优先）。
2. 确认红 → 实现 `argvProfileName()`（`process.argv` 找 `--profile`，下一元素存在且不以 `-` 开头才取，过 `isDshProfileName`）并在 fallback 分支使用；kind 恒 web 不做投影探测（全局约束；沿用既有注释理由：旧宿主无官方管理器，误判 desktop 反堵可用路径）。
3. 验证：`npm run build && node --test tests/active-profile.test.mjs`。

### Task 4 — dsh-cli：守卫放开 + profile 名参数化（TDD）

1. `tests/dsh-cli-governance.test.mjs` 新增：
   - `runDshPlugin('aqua', ['add','pkg-a@1.0.0'], { dshArgv: 桩 })` → 桩收到 argv 含 `'plugin','--profile','aqua'`（红：现状 `仅支持 web profile` 抛错）；
   - `runDshPlugin('../evil', …)` → 抛错（新文案锚）；
   - `makeAddViaLadder({ runDshPlugin: 捕获桩, profile: 'aqua' })` → 捕获桩首次参数为 `'aqua'`；
   - `removeDshPlugin('pkg-a', { runDshPlugin: 捕获桩, profile: 'aqua' })` → 首参 `'aqua'`；
   - `makeDshRunner(dir, 'aqua')` 经 ladder/remove 间接透传（复用本文件既有 runner 桩模式）。
2. 确认红 → 实现（P2 契约）：守卫 `if (!isDshProfileName(profile)) throw new Error('拒绝不安全的 profile 名: ' + profile)`；`makeAddViaLadder` deps +`profile?: string`，两处 `run(WEB_PROFILE, …)` → `run(deps.profile ?? WEB_PROFILE, …)`；`removeDshPlugin` deps +`profile?: string` 同法；`makeDshRunner(profileDir: string, profileName: string = WEB_PROFILE)` 内部把 `profileName` 绑进 ladder 与 remove。
3. 验证：`npm run build && node --test tests/dsh-cli-governance.test.mjs tests/pnpm-outcome.test.mjs`（后者回归 runner 桩兼容性；既有桩多被多传实参由 JS 忽略，若该套件对 `makeDshRunner` 单参有字面断言则同步放宽）。

### Task 5 — transaction / mutation：profileName 贯穿（TDD）

1. `tests/profile-transaction.test.mjs` 新增：`deps = { profileDir: tmp, profileName: 'aqua' }` 起事务 → 注入 runner 桩断言收到 `(tmp, 'aqua')`；不传 profileName → 第二参 `undefined`（兼容旧注入）。
2. `tests/market-mutation.test.mjs`（core 变更入口既有套件，实名）新增：`installFromRegistry(id, cfg, opts, { profileDir: tmp, profileName: 'aqua' })` + 注入 transaction 桩 → 桩 deps 含 `profileName: 'aqua'`；`uninstallPlugin`/`upgradePlugin`/`selfUpgrade` 同断言（UninstallDeps 新字段）。
3. 确认红 → 实现（P3 契约）：`TransactionDeps` +`profileName`，`resolveDeps` 透传，runner 缺省调用改 `(deps?.runner ?? makeDshRunner)(base.profileDir, base.profileName)`；`InstallDeps` +`profileName`；`UninstallDeps` +`profileDir`/`profileName`，四入口（installFromRegistry :550 / upgradePlugin / selfUpgrade :925 / uninstallPlugin）把两字段并入 transaction deps。
4. 验证：`npm run build && node --test tests/profile-transaction.test.mjs tests/market-mutation.test.mjs`。

### Task 6 — host-api：web 写分支接线（TDD）

1. `tests/host-api-profile.test.mjs`：既有 stub（`installFromRegistry`/`uninstallPlugin`/`upgradePlugin`/`togglePlugin`/`selfUpgrade` 捕获改为全参捕获）新增 web profile（`{ name:'aqua', kind:'web', dir:'/h/profiles/aqua', source:'host' }`）用例组：
   - install / uninstall / upgrade / self-upgrade → 捕获 deps 含 `profileDir:'/h/profiles/aqua'` 且 install/upgrade/selfUpgrade/uninstall 含 `profileName:'aqua'`；
   - set-enabled → `togglePlugin` 捕获 deps 含 `profileDir:'/h/profiles/aqua'`；
   - desktop 用例组既有断言（`:250` 起「携带 profile 目录与名字」）保持全绿（desktop 分支零改动锚）。
2. 确认红 → 五处 web 分支加参：install/uninstall/upgrade 传 `{ profileDir: profile.dir, profileName: profile.name }`（deps 第四参）；set-enabled 传 `{ getService, channel, profileDir: profile.dir }`；self-upgrade 的 `d.selfUpgrade(…)` 补 deps `{ profileDir: profile.dir, profileName: profile.name }`。
3. 源结构锚（出现次数语义，CODING-STANDARDS 禁 grep -c 行数语义）：接线前以 `grep -o 'profileDir: profile\.dir' src/core/host-api.ts | wc -l` 记录基数（当前实测 **8**）；断言以 `src.split('profileDir: profile.dir').length - 1` 落进测试，接线 5 处后终值 **13**。
4. 验证：`npm run build && node --test tests/host-api-profile.test.mjs`。

### Task 7 — tools.ts：四工具接线（TDD）

1. `tests/tools-install.test.mjs`（实名既有套件）：为 `dshm_install`/`dshm_uninstall`/`dshm_upgrade`/`dshm_toggle` 的 web profile 分支加捕获断言：install/uninstall/upgrade 的 core 调用 deps 含 `profileDir`/`profileName`；toggle 的 core 调用 deps 含 `profileDir`（togglePlugin 纯 service/文件操作、无 dsh 子进程，**不传 profileName**）（desktop 分支既有断言不动）。
2. 确认红 → web 分支接线：install/uninstall/upgrade 第四参传 `{ profileDir: profile.dir, profileName: profile.name }`（镜像 :312/:479 desktop 分支风格）；toggle 传 `{ getService, channel: 'host-tool', profileDir: profile.dir }`（镜像其 desktop 分支 :357）。
3. 源结构锚（出现次数语义）：tools.ts `profileDir: profile.dir` 由接线前 7（desktop 四分支 :312/:357/:388/:479 + 读分支三处 :190/:257/:425）增至 11。
4. 验证：`npm run build && node --test tests/tools-install.test.mjs`。

### Task 8 — CLI：门禁放开 + 四命令接线（TDD）

1. CLI 门禁当前**无任何既有测试**（`仅作用于 web profile` 全 tests 零命中）——新建 `tests/cli-custom-profile.test.mjs`，入口调用参照 `tests/cli-search.test.mjs` 的既有模式（直接调 cli.ts 导出主函数，stub core 注入捕获）。用例：
   - `--profile aqua install --id x` → 放行，`installFromRegistry` deps 含 `profileDir: join(dshHome(),'profiles','aqua')`、`profileName: 'aqua'`；
   - `--profile aqua upgrade/uninstall/toggle` → 同断言（toggle 走 `togglePlugin` deps `profileDir`）；
   - `--profile desktop` / `--profile tauri` → 拒绝（文案改写：指引官方 Desktop 插件管理，保留 ADR-0005「CLI 不做桌面文件事务」决议）；
   - `--profile ../evil` → 拒绝（isDshProfileName 锚）；
   - 无 flag → 现状（web）零漂移；
   - doctor：`--profile aqua` → `targetDir === join(dshHome(),'profiles','aqua')`；`--profile desktop` → desktopProfileDir()（既有例外保持）。
2. 确认红 → 实现：`:233` 门禁改为 `!isDshProfileName(profileFlag)` 或 `['desktop','tauri'].includes(profileFlag.toLowerCase())` 即拒；install/upgrade/toggle/uninstall 命令体补 deps（`namespace: 'cli'` channel 不变）；doctor 的 `:461-462` 改 `dshProfileDirByName`。
3. 验证：`npm run build && node --test tests/cli-custom-profile.test.mjs`。

### Task 9 — 集成 fixture：自定义 profile 全链落点（TDD）

1. 新增 `tests/custom-profile-transaction.test.mjs`（参照 `profile-transaction.test.mjs` 的事务注入模式）：
   - tmpdir 造假 profile（package.json / pnpm-lock.yaml / pnpm-workspace.yaml 最小合法内容）；
   - `installFromRegistry('pkg-a@1.2.3', cfg, {}, { profileDir: fakeDir, profileName: 'aqua', transaction: { runner: 捕获桩, … }, …既有注桩 })`（注意 runner 是 `TransactionDeps` 字段，经 `transaction` 注入——InstallDeps 顶层无 runner，写顶层会被静默忽略）→ 断言：变更前快照读的是 `fakeDir/package.json`（经真实 `capturePreMutationState(deps.profileDir)` 路径，非伪造）；runner 收到 `(fakeDir, 'aqua')`；事务 paths 三件全在 fakeDir；
   - `uninstallPlugin` 同构断言；
   - **落点不变量**：全程断言 `webProfileDir()` 相关路径零出现于捕获参数（地雷回归锚——将来任何接线回退在此红）。
2. 确认红 → （实现已在 Task 5/6 完成，本任务是横切回归面；若直接绿则补「红证据」说明：checkout 接线前提交跑同测试确认红，记入 PR 描述）。
3. 验证：`npm run build && node --test tests/custom-profile-transaction.test.mjs`。

### Task 10 — GLOSSARY + ADR-0030 + ADR-0005 修订 + CHANGELOG

1. `GLOSSARY.md`：新增词条 **可操作 profile（operable profile）**——host 来源或 fallback 推导、名字可作安全路径段、kind ∈ {web, desktop} 的 profile；「Profile（web profile）」词条补一句：kind web 不要求名字字面量是 `web`（ADR-0030）。词条零实现细节。
2. 新增 `docs/adr/0030-custom-profile-write-support.md`：背景（issue #39 两层根因）、决策（安全名 + dir 权威 + 保留投影探测 + fallback argv）、同业对齐证据（dsh-market 1.73.8：三分支架构 / isDshProfileName / profileDirectory 宿主权威 / generationManagedNames 读侧事实 / tauri 零特判）、被否方案（声明式 env：被同业实践削弱；dir 不一致拒绝：与目标场景自相矛盾）、残余风险与接受理由（空 profile 投影不可判定窗口——与 dsh-market 生产现状同级，快照回滚兜底）。
3. `docs/adr/0005-dual-profile-support.md`：在「未知名 profile 显式拒写」处加一行修订标注（日期 + 指向 0030），原文保留（ADR 不可变更惯例）。
4. `CHANGELOG.md`：双语区块各补 0.12.0 条目（背景 / 做法 / 兼容性：此前 409 的自定义 web profile 场景变为可用，desktop 行为零变化，无破坏性变更）。
5. 验证（全部出现次数语义 `grep -o … | wc -l`，禁 grep -c）：交叉引用锚（`grep -o '0030' docs/adr/0005-*.md | wc -l` ≥1；`grep -o 'operable' GLOSSARY.md | wc -l` 与词条数一致）；CHANGELOG 双语版本号对齐（`grep -o '### 0.12.0' CHANGELOG.md | wc -l` === 2）。

### Task 11 — 全量验证

1. `npm test`（pretest 自带 build；全量绿，记录用例数）。
2. `npm run typecheck` 绿。
3. 全仓源结构锚复核：`src.split` 计数断言所在套件随 `npm test` 全绿即覆盖，无额外动作。
4. **锚有效性单点变异（评审移交建议①）**：在隔离副本（非工作仓库）对 Task 6.3/7.3 的计数锚做单点变异各一次（改坏一处接线、计数 -1）→ 跑对应套件确认红；恢复 → 确认绿。输出 tee 落盘（`.dsh-research/…-scratch/anchor-mutation.log` 或等价位置）留证。
5. 汇报修改摘要（文件清单 + 红绿证据 + 锚计数基数/终值 + 变异验证结果）。
6. **停**：等主人审 diff；`npm run release`（0.12.0，lock 三处同步 + check-release 门禁）为批准后的计划外步骤。

## 执行纪律

- 开始实现前批判性复查本计划；发现缺项/矛盾/验证命令无效，先修计划再动手。
- 按任务顺序执行，不无声跳步、合并或改变任务目标；每个任务完成即跑其验证。
- Task 5 起多处签名带默认值扩展——所有既有注入点（测试桩）保持兼容（多参被 JS 忽略），不强制改既有桩签名；`tests/pnpm-outcome.test.mjs` 是兼容性回归哨。
- 遇阻塞、重复失败或计划与仓库现实不符（如 locate 到的文件名不符、签名与本文不符），立即停下说明，不猜。
- 当前分支非 main（issue 修复流）；若在 main，先开 feature 分支再动手。
- 全部完成后输出修改摘要；发版动作必须等主人明确批准。
- **回退面**：本计划无数据迁移、无环境残留（aqua 写入的都是 profile 目录内 pnpm 管理的常规文件）——回退 = 对该 PR 做 revert + 正常发一版（版本号递增），行为即回 0.11.15 语义（自定义名重新 409、指引文案回到旧六条）。

## 最终验证

`npm test` 全绿（0.11.15 基线 1937 用例量级 + 本计划新增用例）+ `npm run typecheck` 绿 + Task 9 落点不变量绿 + 文档锚计数绿。发版（0.12.0）与 issue #39 回复（共识 Q6 三段式 + 邀请报告者实测）在 diff 批准后执行。

## 相对报告者期望的显式偏差（汇报时逐条呈现）

1. 期望 #1「DSHM_PROFILE_KIND / dsh.profile.kind 声明」——**不采纳**：同业（dsh-market）无声明面运行多年，安全名 + 投影探测 + 快照回滚足够；少一个配置面少一种误配置。
2. 期望 #3「kind 为 web 且 dir ≠ webProfileDir() 时结构化拒绝」——**替换为 dir 权威模型**：host 来源读写恒用 `profileContext.dir`，不存在「落到 webProfileDir()」的路径；拒绝逻辑反而会拒绝 aqua 本身。
3. 期望 #2（写路径统一用 profile.dir / profile.name）——**全额采纳**，即本计划主体。
