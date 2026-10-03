# 升级生效判定（Activation Classification）实施计划 · 0.9.22

## 目标

升级（npm 源）成功后，通过新旧两版 tarball 的逐文件哈希 diff，把「新版本如何生效」分类为三态 `activation: 'client-only' | 'restart-required' | 'unknown'`，并让 tools / CLI / GUI 三端按态分流重启提示：纯客户端更新不再劝重启（刷新页面即生效），检测失败保守回退现状。消灭「skins 升级被提示重启、实际 HMR 已生效」这类噪声（2026-10-03 实证）。

设计共识来源：2026-10-03 /grill-with-docs 两轮对齐（术语已入 GLOSSARY.md：「生效判定 / 纯客户端更新」）。

## 架构快照

```
npm registry metadata ──npmVersion(pkg,ver)──▶ dist.tarball URL（from/to 两版，并行）
        │                                        │
        │                        fetchBytesLimited（8MiB cap，10s 总 deadline）
        │                                        ▼
        │                          zlib.gunzipSync → ustar 只读解析（零依赖）
        │                                        ▼
        │                          逐文件 sha256 → 差异集合 → 分类规则（五条）
        ▼                                        ▼
upgradePluginLocked（web/CLI）──────┐   activation 三态
desktopUpgradeLocked（desktop GUI）─┘        │
        │                            needsRestart = (activation !== 'client-only')
        ▼
UpgradeResult / DesktopUpgradeResult（+activation 字段）
        ├── tools.ts renderUpgrade（agent 提示三态分流）
        ├── cli.ts upgrade case（用户行三态分流）
        └── client/main.jsx doUpgrade（toast 后缀 + needsRestart 分叉，横幅逻辑不动）
```

分类规则（ grill Q2 定稿）：
1. client 集合 = 新版 `package.json` → `exports['./client']` 指向的文件（`./` 前缀归一）。
2. `dsh.bundle.patch` **声明的**补丁目标文件（以新旧任一版 package.json 的 `dsh.bundle.patch` 字段为准，常见名为 cordis.patch.yml）变更 → 宿主侧。本条是规则 4 的显式强调与前向保护——补丁目标永远不会落在 client 集合内。
3. `package.json` 做**忽略顶层 `version` 字段**的语义 diff（只忽略顶层；依赖条目里的版本串变化照常计入）：仅顶层 version 差异 → 不算宿主侧；dependencies / peerDependencies / engines / exports 结构等任一其他字段差异 → 宿主侧。
4. 其余任何文件的变更/新增/删除按路径归属：落在 client 集合内 → 客户端；否则 → 宿主侧。
5. client 指向本身在新旧版间变化 → 保守判宿主侧。

已知局限（grill Q-C 定稿，不做 require 图追踪）：client 入口若 require 同包内 chunk 文件（code-splitting），会被规则 4 保守判宿主侧——安全方向误判，遇到真实样本再立项。

## 全局约束（逐字继承设计共识）

- 词汇：三态常量逐字为 `'client-only' | 'restart-required' | 'unknown'`；不改动 `application`（Profile 变更事务词汇）。
- 范围：判定只接 **npm 源 upgrade** 两个接线点（`upgradePluginLocked` + `desktopUpgradeLocked`）；install / uninstall / selfUpgrade / github 源升级一律不产出 `activation`（维持现状 `needsRestart: true`）。
- fail-open：判定路径中**任何**异常（元数据缺失、下载失败、超时、超限、tar 解析失败、JSON 解析失败）→ 结果 `'unknown'`；**绝不**让判定失败影响升级成功态。
- 零依赖：tar 解析只用 Node 内置（`node:zlib` / `node:crypto` / `node:util` 等），不新增第三方依赖。
- 预算：判定环节独立总 deadline **10s**（`AbortController`，两 tarball **并行**下载+哈希）；单 tarball 下载上限 **8MiB**（实测市场最大 tgz 3.61MB，两倍余量）；**不做缓存**。
- `needsRestart` 仅在 `activation === 'client-only'` 时为 `false`；`unknown` / `restart-required` / 字段缺席 → `true`（现状）。
- 无额外全局约束（版本下限/平台要求无新增；Node ≥22 既有 engines 不变）。

## 文件结构与职责

| 文件 | 新建/修改 | 职责 |
|---|---|---|
| `src/core/ustar.ts` | 新建 | 最小 tar 只读解析：`parseTarEntries(tar: Buffer): Map<string, Buffer>`。支持 ustar 基础头 + pax `x` 扩展长文件名（`path=` 记录）；`g`（global）跳过；目录项跳过；损坏/截断抛 `Error`。不落盘、不解引用。 |
| `src/core/activation.ts` | 新建 | 判定域模块：① `type ActivationClassification`；② `classifyUpgradeActivation(pkg, fromVersion, toVersion, opts?, deps?)`（下载→解包→diff→规则）；③ `upgradeEffectLine(activation | undefined)`（CLI 面向用户的行文案）。依赖注入缝：`fetchVersionMeta` / `fetchTarball`。 |
| `src/core/market.ts` | 修改 | `InstallResult.needsRestart` **源头放宽**为 `boolean`（TS2430 规避）；`UpgradeResult` 新增 `activation?`；`upgradePluginLocked` 成功点接线（npm 源条件 + deps.classifyActivation 缝 + try/catch→unknown）。 |
| `src/core/profile-ops.ts` | 修改 | `desktopUpgradeLocked` 成功返回点接线（同款条件与注入缝，缝挂 `DesktopUpgradeDeps.classifyActivation`）；返回类型加 `activation?`。 |
| `src/tools.ts` | 修改 | `renderUpgrade` 三态后缀（agent 指令措辞）+ 导出（供测试）；`InstallOut` 加 `activation?`；`dshm_upgrade` description 改为按 activation 分流的指令。 |
| `src/cli.ts` | 修改 | `upgrade` case 的重启提示行改用 `upgradeEffectLine(res.activation)`。 |
| `src/client/main.jsx` | 修改 | `doUpgrade`（L1722-1734）：消费 `upgradeNotify` 分叉 needsRestart 与 toast 后缀；i18n zh/en 字典各新增 2 键。 |
| `src/client/operations.js` | 修改 | 新增导出纯函数 `upgradeNotify(activation)`（三态 + 缺席 → `{ needsRestart, suffixKey }`），供 doUpgrade 消费与单测。 |
| `tests/fixtures/tar-builder.mjs` | 新建 | 测试专用：内存构造 ustar（含 pax 长名）+ gzip，返回 Buffer。 |
| `tests/ustar.test.mjs` | 新建 | ustar 解析矩阵。 |
| `tests/activation.test.mjs` | 新建 | 分类规则矩阵 + fail-open 矩阵（全部经注入缝，零网络）。 |
| `tests/upgrade-activation.test.mjs` | 新建 | `upgradePlugin` / `desktopUpgradeFromRegistry` 接线断言（沿用 `tests/market.test.mjs` 的 `fakeDeps` + `transaction: { runner }` 替身模式，样例见该文件 L1754-1760 区段）。 |
| `tests/tools-upgrade-message.test.mjs` | 新建 | `renderUpgrade` 三态文案断言（直测导出函数）。 |
| `tests/client-operations.test.mjs` | 修改 | 追加 `upgradeNotify` 三分支 + 缺席断言（评审问题 6）。 |
| `docs/adr/0007-activation-classification.md` | 新建 | 决策记录（背景/决策/后果，含 fail-open 立场与已知局限）。 |
| `docs/DESIGN.md` | 修改 | 新增「生效判定」节（规则集、预算、fail-open 边界、三端分流）。 |
| `CHANGELOG.md` | 修改 | 双语 0.9.22 条目（中文区头部 + English 区头部，沿用既有格式）。 |
| `package.json` | 修改 | `0.9.21` → `0.9.22`。 |
| `GLOSSARY.md` | 已完成 | 「生效判定 / 纯客户端更新」两条已随 grill 入册，本计划不含其改动。**留痕（执行评审问题 3）**：grill 定稿先于本计划定稿，词条实际随 7673375 一并入库（+8 行，内容与术语共识一致、文档互链所需）——清单声明与实际入库不符，如实记录不回退。 |

不改动：`selfUpgrade`、`installEntryLocked`、GUI 重启横幅状态机（`main.jsx` L2599 needsRestart 门）、`operations.js` 的操作恢复语义（本计划对该文件仅**新增** `upgradeNotify` 纯导出，恢复逻辑一行不动）、`registry.json`、依赖清单（零新依赖）。

## 任务间接口契约（Consumes / Produces）

- **T1 → T2**：`parseTarEntries(tar: Buffer): Map<string, Buffer>`，键为 tar 内原始路径（保留 npm 的 `package/` 前缀，归一在 T2 做）。
- **T2 → T3/T4**：`classifyUpgradeActivation(pkg: string, fromVersion: string, toVersion: string, opts?: { timeoutMs?: number; maxTarballBytes?: number; signal?: AbortSignal }, deps?: ClassifyActivationDeps): Promise<ActivationClassification>`；`type ActivationClassification = 'client-only' | 'restart-required' | 'unknown'`。T3/T4 经 `deps.classifyActivation` 缝注入替身。
- **T2 → T6**：`upgradeEffectLine(activation: ActivationClassification | undefined): string`（CLI 行文案，三态 + undefined 缺席态）。
- **T3/T4 → T5/T7**：升级结果对象携带 `activation?: ActivationClassification` 与放宽后的 `needsRestart: boolean`；tools/web 两端直接从结果 JSON 读取（tools 的 execute 已 `cloneJson` 全量结果透传，无需新增映射）。

## 任务清单

### T1 · ustar 只读解析器

1. 新建 `tests/fixtures/tar-builder.mjs`：`buildTar([{ name, data, type? }], { paxLongName?: boolean })` → Buffer（512 字节头手写：name@0(100)、size 八进制@124(12)、typeflag@156、ustar magic@257、prefix@345；内容 512 对齐；支持 pax `x` 记录写长名）；`gzip(buf)` 用 `zlib.gzipSync`。
2. 写 `tests/ustar.test.mjs`（先失败）：单文件、多文件、`package/` 前缀保留、目录项跳过、pax 长文件名（>100 字符）、`g` 条目跳过、截断抛错、坏 size 字段抛错。
3. 实现 `src/core/ustar.ts` 的 `parseTarEntries`（读头→按 size 读内容→hash 不在此做；`zlib.gunzipSync` 由 T2 调用方负责，本模块只吃解压后明文）。
4. 验证：`node --test tests/ustar.test.mjs` 全绿。

### T2 · 生效判定分类器

1. 写 `tests/activation.test.mjs`（先失败），全部经 `deps` 注入替身（`fetchVersionMeta` 返回 `{ tarball: 'mem://old' | 'mem://new' }`，`fetchTarball` 按 URL 返回 tar-builder 造的字节）：
   - 规则矩阵：仅 `lib/client.js` 变 → client-only；仅 `lib/index.js` 变 → restart-required；`cordis.patch.yml` 变 → restart-required；`package.json` 仅 version 变 → **client-only**（关键回归）；`package.json` dependencies 变 → restart-required；新增/删除文件按路径归属；client 指向变化 → restart-required；无任何差异 → client-only。
   - fail-open 矩阵：from/to 元数据缺 tarball → unknown；下载抛错 → unknown；tar 损坏 → unknown；package.json 非法 JSON → unknown；超时（fake 挂起 + 注入短 deadline）→ unknown；超限（maxTarballBytes=1）→ unknown。
   - `upgradeEffectLine` 三态 + undefined 断言（含「dshm restart --yes」字样只出现在 unknown/undefined 分支）。
2. 实现 `src/core/activation.ts`：`classifyUpgradeActivation`（AbortController 10s 总预算；`Promise.all` 并行两元数据+两下载；`gunzipSync` → `parseTarEntries` → 逐文件 `crypto.createHash('sha256')` → 规则引擎）；`upgradeEffectLine`。默认依赖：元数据走 `npmVersion(pkg, version, timeoutMs, signal)` 取 `dist.tarball`（不传 registry——与现有 install 路径同源），下载走 `fetchBytesLimited(url, { maxBytes, timeoutMs, signal })`。
3. 验证：`node --test tests/activation.test.mjs` 全绿。

### T3 · market.ts 接线（web/CLI 路径）

1. **源头放宽**：`InstallResult`（market.ts L1030）`needsRestart: true` → `needsRestart: boolean`。原因：TS 禁止派生接口把属性放宽（TS2430），交叉类型 `true & boolean` 亦归约为 `true`——任何「子接口/交叉类型放宽」写法都无法编译。审计注记（随代码注释留痕）：现有全部生产方——`installEntryLocked` 各成功臂（L1493/L1526/L1579/L1607/L1638/L1649）、`selfUpgrade`（`true as const`，L1805）、desktop 安装/升级成功臂——均产出 `true`，放宽后类型兼容；消费方（tools/cli/GUI）只读不窄化，无行为影响。随后 `UpgradeResult`（L1701）只新增 `activation?: ActivationClassification`，**不再重声明** `needsRestart`。
2. `upgradePluginLocked`（L1715-1736）：`installEntryLocked` 之后——`entry.source === 'npm' && entry.npm && target.version && result.version` 时 `try { activation = await (deps?.classifyActivation ?? classifyUpgradeActivation)(entry.npm, target.version, result.version); if (activation === 'client-only') needsRestart = false } catch { activation = 'unknown' }`；返回 `{ ...result, fromVersion: target.version, needsRestart, ...(activation ? { activation } : {}) }`。github 源 / 字段缺失 → 不产出 activation、needsRestart 原样。（默认实现即 T2 的 `classifyUpgradeActivation`，从 `./activation.js` 导入。）
3. 写 `tests/upgrade-activation.test.mjs`：沿用 `tests/market.test.mjs` 的 `fakeDeps` + `transaction: { runner: () => runner, profileDir }` 替身构造（先读该文件 L1754-1760 既有 upgradePlugin happy-path 用例，复制其替身组装）；断言：client-only 替身 → `needsRestart === false && activation === 'client-only'`；classifyActivation 抛错 → `activation === 'unknown' && needsRestart === true`；github 条目 → 无 activation 字段且 needsRestart true；`selfUpgrade` 结果不含 activation（回归）。**前置（评审问题 2）**：接线后，凡未注入缝的既有升级替身都会走真实 `classifyUpgradeActivation`（隐式出网）——给 `tests/market.test.mjs` 中全部 `upgradePlugin` 用例的 deps 补 `classifyActivation: async () => 'unknown'`（值必须非 client-only，保持既有 `needsRestart` 断言不变）；执行时以 grep `upgradePlugin(` 于 `tests/` 全量枚举命中文件为准。
4. 验证：`node --test tests/upgrade-activation.test.mjs tests/market.test.mjs` 全绿。

### T4 · profile-ops.ts 接线（desktop 路径）

1. `DesktopUpgradeDeps` 加 `classifyActivation?` 缝；`desktopUpgradeLocked` 成功返回点（L572-591 区段的 `{ ok: true, …, needsRestart: true }` 构造）套用 T3 同款条件与 try/catch（npm 源条件此处为 `entry.source === 'npm' && entry.npm && target.version && version`）；返回类型 `DesktopInstallResult & { fromVersion?: string; activation?: ActivationClassification }`。`needsRestart` 类型已随 T3 源头放宽为 `boolean`，成功臂直接写 `needsRestart: activation === 'client-only' ? false : true`。
2. 在 `tests/upgrade-activation.test.mjs` 追加：`desktopUpgradeFromRegistry` 用例——替身 `resolveManager`（返回 `{ installBundle: async () => ({ class: 'ok', output: 'ok' }) }` 形态的服务桩，先读 `tests/profile-ops.test.mjs` 既有 desktopUpgrade 用例复制其服务桩与 `runManagedInstall` 所需 `deps.listInstalled` 组装）+ classifyActivation 替身；断言同 T3 三分支。**前置（评审问题 2）**：给 `tests/profile-ops.test.mjs` 中全部 `desktopUpgradeFromRegistry` 用例的 deps 补 `classifyActivation: async () => 'unknown'`（同样以 grep 全量枚举为准；值非 client-only，保持既有 needsRestart 断言不变）。
3. 验证：`node --test tests/upgrade-activation.test.mjs tests/profile-ops.test.mjs` 全绿。

### T5 · tools.ts 三态渲染与 description

1. `InstallOut`（L562）加 `activation?: string`；`renderUpgrade`（L698-714）成功分支改为三态后缀并 `export`：
   - `activation === 'client-only'` → `纯客户端更新：刷新页面即可生效，无需重启——不要询问 dshm_restart。`
   - `activation === 'unknown'` → `生效判定未完成（网络或解析失败）：为确保生效建议重启——询问是否 dshm_restart。`
   - 其余（undefined / 'restart-required'）→ 现状 `需要重启生效——询问是否 dshm_restart。`
2. `dshm_upgrade` description（L458）改为：`Upgrade an installed DSH plugin to the latest version (npm 拉最新精确版 / github 重新锁 HEAD)。pkg 来自 dshm_list 或 dshm_outdated。用户确认升级哪一个之后再调用。After success follow the result's activation field: 'client-only' → tell the user a page refresh suffices and do NOT offer dshm_restart; 'unknown' or 'restart-required' → tell the user it needs a restart and offer dshm_restart.`
3. 写 `tests/tools-upgrade-message.test.mjs`：直测导出的 `renderUpgrade`，三分支 + guard 分支回归。
4. 验证：`node --test tests/tools-upgrade-message.test.mjs` 全绿。

### T6 · cli.ts 三态行

1. `cli.ts` upgrade case（L407-412）：`out('✅ 已升级 …')` 与 `outBuildsNote` 之后，`out(upgradeEffectLine(res.activation))` 替换原 L411 固定行（helper 已在 T2 实现并测过）。
2. 验证：`npm run typecheck` 绿 + `node --test tests/activation.test.mjs`（helper 断言）绿。

### T7 · client main.jsx 分叉与文案

1. `src/client/operations.js` 新增导出纯函数 `upgradeNotify(activation)`：返回 `{ needsRestart, suffixKey }`——`'client-only'` → `{ needsRestart: false, suffixKey: "notify.upgraded.clientonly" }`；`'unknown'` → `{ needsRestart: true, suffixKey: "notify.upgraded.activationUnknown" }`；其余与缺席 → `{ needsRestart: true, suffixKey: null }`（评审问题 6：让 GUI 分支可单测）。
2. i18n zh 字典（L117 附近）新增：`"notify.upgraded.clientonly": "。纯客户端更新：刷新页面即可生效，无需重启"`、`"notify.upgraded.activationUnknown": "。生效判定未完成：为确保生效请重启 DSH Web"`；en 字典（L224 附近）新增镜像两键。
3. `doUpgrade`（L1722-1734）改为消费 helper：`const note = upgradeNotify(res.activation); notify({ kind: "ok", needsRestart: note.needsRestart, text: lookup("notify.upgraded", { pkg: res.pkg, from: …, to: … }) + builds + (note.suffixKey ? lookup(note.suffixKey) : "") })`。
4. `tests/client-operations.test.mjs` 追加 `upgradeNotify` 三分支 + undefined 缺席断言。
5. 验证：`npm run build`（esbuild client 成功）+ `node --test tests/client-operations.test.mjs tests/client-render-smoke.test.mjs` 绿。
6. 说明（grill Q6 决策留痕）：GUI 文案**不按 profile 分叉**——desktop 的 Electron 渲染层与 web 同构，client bundle 同样由宿主 serve 并走 rev 热更，「刷新页面即可生效」语义在 desktop 成立（等效于重开面板）；`unknown` 态在 desktop 由 needsRestart=true 走既有 `profile.restartHint` 官方生命周期横幅，无需新形态。

### T8 · 文档与版本

1. 新建 `docs/adr/0007-activation-classification.md`：背景（0.9.21 skins 实证：无条件重启提示的警报疲劳 + rev HMR 事实）/ 决策（三态词汇、五条规则、零依赖 ustar、npm-upgrade 范围、10s/8MiB、无缓存、fail-open 立场、已知局限：无 require 图追踪）/ 后果（纯客户端升级不再重启；unknown 保守回退；desktop 与 web 双接线点）与已知局限补充（评审问题 3）：README/CHANGELOG 等 docs 类随版差异按规则 4 保守判宿主侧——真实发版的 client-only 命中率取决于上游习惯，验收以构造用例为主（T9.5）。
2. `docs/DESIGN.md` 增「生效判定」节：规则集逐条、预算与 fail-open 边界、三端分流表、与 `application` 词汇的边界。
3. `CHANGELOG.md` 双语各 prepend 0.9.22 条目（中文区 L9 后、English 区头部，沿用「### 0.9.21 变更：…」格式）。
4. `package.json` version → `0.9.22`。
5. 验证：三份文档互链可达（GLOSSARY/ADR/DESIGN 术语一致用「生效判定/纯客户端更新」）；`npm run build && npm run typecheck` 绿。

### T9 · 最终验证与发布

1. 全量门禁：`npm run build && npm run typecheck && npm test && node scripts/validate-registry.mjs`（期望：915+新增用例全绿、registry 校验通过——本次不改 registry.json）。
2. 提交：`feat(0.9.22): 升级生效判定——tarball 差异三态分类 + 三端重启提示分流`；push main（仓库惯例直接 main，主人已批计划即视为同意）。
3. 发布：`git tag v0.9.22 && git push origin v0.9.22` → `gh run watch` Publish（OIDC）与 Registry check（本次 registry.json 未变，purge job 走已验证的 skip 分支）→ `npm view dsh-m@0.9.22 version` 确认上架（018 纪律：绿 ≠ 上架）。
4. 本机装机：npmmirror `PUT …/dsh-m/sync?sync_upstream=true` → desktop `pnpm-workspace.yaml` 排除条目追加 `|| 0.9.22`（020 操作员通道）→ 重启 DSH 使 0.9.22 宿主代码生效（本改动是宿主侧变更，必须重启一次）→ `dshm_upgrade dsh-m` → 磁盘复核 0.9.22。
5. 端到端验收（重启后，三连）：
   - **主断言**：from==to 重复升级（零差异 → `client-only`）或临时降级一版再升（→ `client-only`）——结果含 `activation: 'client-only'`、提示「刷新页面即可生效」。真实 skins 升级若再有新版仅为**观察项**：README/CHANGELOG 等随版差异按规则 4 合法判 `restart-required`，属设计内行为——结果为三态之一且提示与态一致即通过（评审问题 3）。
   - `dshm_upgrade dsh-m`（自身必有宿主变更）→ `restart-required` 现状文案；
   - 断网或断开 npmmirror → `unknown` 保守文案。
   - 无法自然触发 client-only 时，用 CLI 对已升级过的包重复 upgrade（from==to 时分类器照跑）或临时降级一版再升，验收后恢复。

## 执行纪律

- 开工前先批判性复查本计划；发现缺项/矛盾/命令失效，先修计划再动手。
- 按任务顺序执行（T1→T9 存在 Consumes 依赖，不得跳序）；每完成一个任务立即跑该任务定义的验证。
- 在 main 上直接工作（仓库惯例，发布从 main 切 tag）；提交按任务边界（T1+T2 可合并一提交，T3+T4 可合并，其余各自提交，T8+T9 门禁后提交）。
- 阻塞、重复失败或仓库现实与计划不符（如锚点行号漂移——以符号/区段锚点为准重新定位）→ 停下说明，不猜。
- Windows 环境：所有验证命令为 npm scripts / node --test / git / gh，均跨平台；不使用 bash-only 语法。

## 最终验证

`npm run build && npm run typecheck && npm test && node scripts/validate-registry.mjs` 全绿 + T9 的三连端到端验收 + 发布后 npm/npmmirror 双源可见 0.9.22。
