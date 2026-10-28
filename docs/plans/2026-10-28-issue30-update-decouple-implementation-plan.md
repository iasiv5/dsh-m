# issue #30 更新与收录解耦（来源自证更新）实施计划

## 目标

- 兑现 ADR-0026：`dshm_upgrade` / 面板升级 / CLI 升级支持一切已装插件（npm + github 源，web + desktop profile），非市场安装经「合成条目」走既有升级管线；收录清单不可用不再阻断升级。
- 一键升级批量失败语义升级为三态分流：目标级失败跳过继续并汇总，系统性失败维持短路（issue #10 语义不变）。
- 三端（面板 / agent 工具 / CLI）为每个已装项给出升级通路投影（catalog / synthesized / unsupported）。

## 架构快照

- 升级入口现状：`upgradePluginLocked`（web，market-mutation.ts）与 `desktopUpgradeLocked`（desktop，profile-ops.ts）都先加载收录清单（unavailable 即硬抛），再主清单 find → 社区 `lookupInstalledAll` 找 `InstallableEntry`，miss 即硬抛「不是经 dsh-m 收录的插件」。
- 本次改法：条目查找降级为**元数据增强**——registry unavailable 或 miss 时，从已装项（`InstalledPlugin`：pkg/source/spec）本地合成最小 `InstallableEntry`（`Pick<RegistryEntry, 'id'|'source'|'npm'|'github'>`），下游 `installEntryLocked` / `runManagedInstall` 零改动。本地形态 spec（`file:`/`link:` 前缀）与非线上来源（source 为 link/file/unknown）不合成，抛结构化不支持错误。
- 身份等价依据：`matchInstalledByEntry`（merged-market.ts:108）按 `entry.npm === it.pkg` / `entry.github === spec 仓库` 匹配，故命中条目的 npm/github 字段与已装项合成结果恒等；合成条目只缺策展元数据（描述/verified），不影响安装语义。
- 批量三态：错误信封新增 `failureClass: 'target' | 'systemic'`（host-api.ts 错误序列化器按错误类型标注，**缺省 target、systemic 显式白名单**——InstallGuardError / TransactionError / DesktopOpsError 基建回退码）；客户端 `doUpgrade` 按 `e.failureClass` 与 `res.needsBuildApproval` 分流，循环从 `break` 布尔改为三态收集。
- 投影：`upgradePathFor(item)` 纯函数（registryId 有 → catalog；本地 spec 或非线上来源 → unsupported；其余 → synthesized），落 `InstalledItem.upgradePath`，tools/CLI/客户端同源消费。已装页投影形态（评审 F9 表态留痕）= 数据字段 + 批量排除 + 汇总通知 + 单击升级结构化 toast，**不做 per-item badge**——catalog/synthesized 对面板用户无操作含义，unsupported 有批量汇总与单击 toast 两条可达出口。

## 全局约束

（继承 docs/CODING-STANDARDS.md 与 ADR-0026，逐字执行）

- 测试锚三物理事实：`treeShaking:false`（禁 bundle 负向预言）；esbuild `charset=ascii`（中文文案锚一律源结构锚）；工作树 CRLF（源串锚禁含 `\n`，量化断言用出现次数语义 `split(needle).length - 1`）。
- 退出码卫生：过滤管道前 `set -o pipefail`；以原测试进程退出码判定。
- i18n：`lookup("key")` 直接量全部落字典，中英同步（守卫 tests/client-i18n.test.mjs）。
- 行为零变化承诺：全部升级成功时，面板批量行为与旧版一致——逐项通知形态不变、无新增汇总横幅（汇总横幅仅在存在失败/跳过时出现）；`batchUpgradeOrder` 的 dsh-m 收尾定序不变。
- 安全面不扩大：安装-by-id 门禁、build 审批、release-age 等待期、npm 源兼容预检、desktop 两步安全网对合成条目同等生效（管线零改动自然继承，本计划不改这些模块）。
- 环境：bash（web 机）；超 90 秒命令（`npm test` 全量、`npm run build`）用 run_in_background；每次 build/test 前先 `test -d node_modules`，缺失按 lockfile 恢复（无 lockfile 时 `npm install`）。

## 输入工件

- 设计来源：`docs/adr/0026-update-decoupled-from-catalog.md`（grill 决议 Q1–Q3，2026-10-28）
- 术语：`GLOSSARY.md`「来源自证更新」「合成条目」「目标级失败 / 系统性失败」
- 上游参照：`.dsh-research/dsh-market-fresh/`（dshmarket 1.73.1，只读对照，不入库）

## 文件结构与职责

- Modify: `src/core/market-mutation.ts`（新增 `UpgradePathUnsupportedError`、`synthesizeInstallableEntry`；重构 `upgradePluginLocked` 入口段）
- Modify: `src/core/profile-ops.ts`（重构 `desktopUpgradeLocked` 入口段，本地 spec → `DesktopOpsError('upgrade-unsupported')`）
- Modify: `src/core/market.ts`（`InstalledItem` 增 `upgradePath` 字段；`upgradePathFor` 纯函数；`listInstalledWithMeta` 双落点装配）
- Modify: `src/core/host-api.ts`（错误→HTTP 信封序列化器增 `failureClass` 标注）
- Modify: `src/tools.ts`（dshm_list / dshm_outdated items 映射 `upgradePath`；`renderList` / `renderOutdated` 标注 unsupported）
- Modify: `src/cli.ts`（outdated 输出标注 unsupported 项）
- Modify: `src/client/hooks.js`（`api()` 透传 `err.failureClass`）
- Modify: `src/client/installed-updates.js`（`batchUpgradeOrder` 排除 unsupported；新增 `classifyBatchOutcome`、`summarizeBatch`）
- Modify: `src/client/installed-tab.jsx`（`doUpgrade` 三态返回；批量循环收集 + 汇总 notify）
- Modify: `src/client/i18n.js`（内联 ZH/EN 字典各补 3 个批量汇总文案键——评审 F5 勘误：`locale/zh.json`/`locale/en.json` 是插件 meta 文件（仅 `{meta:{title,description}}`），面板文案字典在本文件，i18n 守卫测试消费的也是它）
- Test: `tests/market-mutation.test.mjs`、`tests/profile-ops.test.mjs`、`tests/market.test.mjs`、`tests/tools-install.test.mjs`、`tests/host-api-profile.test.mjs`、`tests/client-installed-updates.test.mjs`、`tests/client-i18n.test.mjs`（守卫）、`tests/client-render-smoke.test.mjs`（守卫）

## 任务清单

### Task 1: market-mutation.ts + 合成条目纯函数与不支持错误

- 目标：新增 `synthesizeInstallableEntry(target)` 与 `UpgradePathUnsupportedError`，条目合成逻辑独立可测。
- 涉及文件：`src/core/market-mutation.ts`；Test `tests/market-mutation.test.mjs`
- 接口契约
  - Consumes: `InstallableEntry`（market-mutation.ts:189 定义）；`InstalledPlugin`（pkg/name/version/source/spec 字段）；`GITHUB_SPEC_RE`（merged-market.ts:308，`/^github:([^#]+)/`）
  - Produces: `synthesizeInstallableEntry(target: InstalledPlugin): InstallableEntry`（npm → `{ id: \`installed:${pkg}\`, source: 'npm', npm: pkg }`；github → 解析 spec 后 `{ id: \`installed:${pkg}\`, source: 'github', github: '<owner/repo>' }`；**source 为 github 但 spec 不匹配 `GITHUB_SPEC_RE` → 抛 `UpgradePathUnsupportedError`（评审 F4：禁止产出双分支都落空的条目）**；**其余 source（link/file/unknown，含 spec 无本地前缀的变体）→ 抛 `UpgradePathUnsupportedError`（评审 F8 兜底臂：`PluginSource` 五值见 installed.ts:19；穿透将命中 installEntryLocked 尾行普通 Error「缺少可安装来源」market-mutation.ts:797，违反 B5 结构化指引）**）；`UpgradePathUnsupportedError`（`upgradePath: 'unsupported'` 字段 + reason）；两者均具名导出。合成 id 语义约定：合成 id 会经 `InstallResult.id` 透出（installEntryLocked 四处 `id: entry.id`，market-mutation.ts:639/672/752/783），用户可见面（工具渲染 tools.ts renderUpgrade:704、CLI cli.ts:420、外部 journal target 字段）均以 pkg 为键、不受影响（评审 F3）
- 验证范围：合成函数五分支（npm / github / 本地 spec 抛错 / github 解析失败抛错 / 非线上来源兜底抛错）单测全绿

- [ ] Step 1: 写失败测试——在 `tests/market-mutation.test.mjs` 末尾新增 describe `synthesizeInstallableEntry`（自带夹具，不引用兄弟 describe）：① `{ pkg: 'foo', source: 'npm', spec: '^1.0.0', version: '1.0.0', name: 'foo' }` → `{ id: 'installed:foo', source: 'npm', npm: 'foo' }`；② `{ pkg: 'bar', source: 'github', spec: 'github:owner/repo#abc1234' }` → `{ id: 'installed:bar', source: 'github', github: 'owner/repo' }`；③ `{ pkg: 'baz', source: 'npm', spec: 'file:../baz' }` → 抛 `UpgradePathUnsupportedError` 且 `err.upgradePath === 'unsupported'`；④ `link:` spec 同 ③；⑤ `{ pkg: 'qux', source: 'github', spec: 'not-a-github-spec' }` → 抛 `UpgradePathUnsupportedError`；⑥ `{ pkg: 'corge', source: 'unknown', spec: 'whatever' }` → 抛 `UpgradePathUnsupportedError`（评审 F8 兜底臂）。
- [ ] Step 2: 运行并确认失败
- Run: `cd /home/ubuntu/workspace/dsh-m && npm run build && node --test tests/market-mutation.test.mjs 2>&1 | tail -5`（`set -o pipefail` 下取尾；构建放后台则经 job_output 取结果）
- Expected: 导入错误 `synthesizeInstallableEntry` 不存在（套件红）
- [ ] Step 3: 写最小实现——market-mutation.ts 新增两个具名导出；本地 spec 判定 = `spec` 以 `file:` 或 `link:` 开头（大小写不敏感）；错误消息形如 `「${pkg}」是本地链接安装（${spec}），不从线上更新；如需线上版本请先卸载后经 dsh-m 安装`
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/market-mutation.test.mjs`
- Expected: 套件全绿（含既有用例零回归）
- [ ] Step 5: checkpoint commit（`git add src/core/market-mutation.ts tests/market-mutation.test.mjs && git commit`）

### Task 2: upgradePluginLocked 解耦重构（web）

- 目标：registry unavailable 不再硬抛；条目 miss → 合成条目兜底；旧「不是经 dsh-m 收录」抛出点移除。
- 涉及文件：`src/core/market-mutation.ts`（`upgradePluginLocked`，现录入点：registry unavailable 抛错段 + miss 抛错段，market-mutation.ts:918-920 与 :944，行号为 2026-10-28 时点参考）
- 接口契约
  - Consumes: Task 1 的 `synthesizeInstallableEntry`、`UpgradePathUnsupportedError`
  - Produces: web 升级对「registry unavailable」「非市场 npm」「非市场 github」目标的成功通路（Task 6 信封、Task 9 收口依赖）；`upgradePluginLocked` 对外签名不变
- 验证范围：新增行为用例绿 + 既有 upgrade 用例零回归

- [ ] Step 1: 写失败测试——`tests/market-mutation.test.mjs` 新增用例（复用该套件既有 deps 注入夹具形态）：① deps 注入 `loadRegistry` 返回 `status: 'unavailable'` + `npmLatest` 假件 → `upgradePlugin('non-catalog-pkg', …)` 成功且 `result.pkg === 'non-catalog-pkg'` 且 `result.id === 'installed:non-catalog-pkg'`（钉住合成 id 语义，评审 F3）；② registry 正常但清单无此包（主清单 + 社区均 miss，`fetchCommunityCatalog` 返回空）+ source github → 走合成条目（可观察出口：注入的 `githubLatestTag` 假件记录到 `'owner/repo'` 调用，且最终 `result.spec` 形如 `github:owner/repo#<sha>`）；③ 本地 `file:` spec 已装项 → 抛 `UpgradePathUnsupportedError`。
- [ ] Step 2: 运行并确认失败
- Run: `npm run build && node --test tests/market-mutation.test.mjs`
- Expected: ①② 红于「收录清单不可用，无法升级」/「不是经 dsh-m 收录的插件」；③ 红于旧消息
- [ ] Step 3: 写最小实现——`upgradePluginLocked`：去掉 unavailable 硬抛（registry 不可用 = 跳过两级查找）；查找成功路径原样保留；`entry` 仍 undefined → `entry = synthesizeInstallableEntry(target)`（其内部抛不支持错误即透传）
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/market-mutation.test.mjs`
- Expected: 全绿，既有「收录清单不可用时升级硬抛」类旧断言同步改写为新语义（改写处逐一列进 commit message）
- [ ] Step 5: checkpoint commit

### Task 3: desktopUpgradeLocked 同构重构（desktop）

- 目标：desktop 升级入口与 Task 2 同语义：unavailable 跳过查找、miss → 合成条目、本地 spec → `DesktopOpsError('upgrade-unsupported', …)`。
- 涉及文件：`src/core/profile-ops.ts`（`desktopUpgradeLocked`，现 miss 抛出点 profile-ops.ts:1108 附近，行号为 2026-10-28 时点参考）
- 接口契约
  - Consumes: Task 1 的 `synthesizeInstallableEntry`（profile-ops.ts 已 import market-mutation，方向合法）
  - Produces: desktop 非市场升级通路；`DesktopOpsError` 新 code `'upgrade-unsupported'`（Task 6 信封映射消费）
- 验证范围：tests/profile-ops.test.mjs 新增用例绿 + 既有 desktop 用例零回归

- [ ] Step 1: 写失败测试并同步改写既有旧语义断言（评审 F10，与 Task 2 对称）——新增三例：① registry unavailable + npmLatest 假件 → `desktopUpgradeFromRegistry` 成功；② 清单 miss 的 github 已装项 → 成功且 spec 为重锁形态；③ `file:` spec → 抛 `DesktopOpsError` 且 `err.code === 'upgrade-unsupported'`。**既有断言改写点**：同套件 desktopUpgradeFromRegistry describe 内两处旧语义断言——「非收录插件（主清单与社区目录都 miss）→ install-refused」（约 :428，断言 install-refused 且 /收录/）与「收录清单不可用 → install-refused」（约 :436，断言 install-refused 且 /不可用/）——分别改写为对应新语义的成功通路断言（与新增①②同形态，需补 npmLatest 假件）；「未安装 → install-refused」语义保留不动；改写处逐一列入 commit message。
- [ ] Step 2: 运行并确认失败
- Run: `npm run build && node --test tests/profile-ops.test.mjs`
- Expected: 新增三例红（①② 红于 unavailable/miss 硬抛，③ 红于无此 code）；两处旧断言本步仍绿（实现后才转红，改写随 Step 3 落地）
- [ ] Step 3: 写最小实现——镜像 Task 2 的入口段改法；本地 spec 抛 `new DesktopOpsError('upgrade-unsupported', …)`（沿用 profile-ops.ts 既有 DesktopOpsError 构造形态）；同步完成 Step 1 列出的两处旧断言改写
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/profile-ops.test.mjs`
- Expected: 全绿（含改写后的两处旧断言）
- [ ] Step 5: checkpoint commit

### Task 4: upgradePath 投影落 InstalledItem

- 目标：`upgradePathFor(item)` 纯函数 + `listInstalledWithMeta` 装配 `upgradePath` 字段。
- 涉及文件：`src/core/market.ts`（`InstalledItem` 接口 + 双落点装配：registry 早退臂与 matchInstalled 之后）
- 接口契约
  - Consumes: `InstalledItem.registryId`（matchInstalled 产物）；source 兜底判据与 Task 1 同规则
  - Produces: `upgradePathFor(item): 'catalog' | 'synthesized' | 'unsupported'`（具名导出，判据：`registryId` 非空 → catalog；`spec` 以 `file:`/`link:` 开头 → unsupported；**`source ∉ {'npm','github'}` → unsupported（评审 F8，与 Task 1 兜底臂同判据）**；否则 synthesized）；`InstalledItem.upgradePath?: 'catalog' | 'synthesized' | 'unsupported'`（Task 5 / Task 7 消费）
- 验证范围：tests/market.test.mjs 新增投影用例绿 + 既有用例零回归

- [ ] Step 1: 写失败测试——`tests/market.test.mjs` 新增：经 `listInstalledWithMeta`（deps 注入夹具）返回 items 中：收录命中项 `upgradePath === 'catalog'`；registry unavailable 臂（该套件既有降级夹具）非收录 npm 项 `'synthesized'`；`file:` spec 项 `'unsupported'`。另加 `upgradePathFor` 直测四行（本地 spec 判定与 source 兜底判定均与 Task 1 同规则，评审 F8：`{ source: 'unknown', spec: 'whatever' }` → `'unsupported'`）。
- [ ] Step 2: 运行并确认失败
- Run: `npm run build && node --test tests/market.test.mjs`
- Expected: 字段缺席断言红
- [ ] Step 3: 写最小实现——装配两个落点（评审 F6：早退臂不经 matchInstalled）：①`if (loaded === 'deadline' || loaded.status === 'unavailable')` 早退 return 块内为 items 装配（此臂 registryId 必空，逐项按 spec 判 synthesized/unsupported）；②健康臂 `matchInstalled(items, …)` 之后装配（registryId 已写，catalog 判定可达）。`upgradePathFor` 判据不变
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/market.test.mjs`
- Expected: 全绿
- [ ] Step 5: checkpoint commit

### Task 5: 三端投影出口（tools + CLI）

- 目标：agent 工具与 CLI 消费 `upgradePath`，unsupported 项在列表/检查输出中如实标注。
- 涉及文件：`src/tools.ts`（dshm_list execute 的 items 映射、dshm_outdated execute 的 items 映射、`renderList`、`renderOutdated`）；`src/cli.ts`（`case 'outdated'` 的 outdated 清单输出）
- 接口契约
  - Consumes: Task 4 的 `InstalledItem.upgradePath`
  - Produces: `dshm_list` / `dshm_outdated` 输出 items 携带 `upgradePath` 字段；文案规则——unsupported 项标注「本地链接安装，不自动升级」（renderList）与「本地链接安装——不参与自动升级」（renderOutdated / CLI），中文为最终文案基准，不得改写
- 验证范围：tests/tools-install.test.mjs 行为/源锚用例绿

- [ ] Step 1: 写失败测试——`tests/tools-install.test.mjs` 沿既有夹具：① dshm_outdated execute 返回 items 含 `upgradePath` 键；② `renderList` 对 unsupported 项输出含「本地链接安装」（源结构锚：`src/tools.ts` 内 `本地链接安装` 出现次数 ≥2，出现次数语义）；③ CLI outdated 对 unsupported 项输出含同一标记（`cli.ts` 的 outdated 为内联 `out()` 输出，用源结构锚：`src/cli.ts` 内 `本地链接安装` 出现次数 ≥1）。
- [ ] Step 2: 运行并确认失败
- Run: `npm run build && node --test tests/tools-install.test.mjs`
- Expected: 三例红
- [ ] Step 3: 写最小实现——tools.ts 两处 items 映射加 `upgradePath: it.upgradePath ?? null`；renderList/renderOutdated 按上述文案分支；cli.ts outdated 清单行追加标注
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/tools-install.test.mjs`
- Expected: 全绿
- [ ] Step 5: checkpoint commit

### Task 6: 错误信封 failureClass（host-api 序列化 + 客户端透传）

- 目标：升级失败经 `/dshm` 信封携带 `failureClass: 'target' | 'systemic'`，客户端 `api()` 透传到 `err.failureClass`。**缺省 target、systemic 显式白名单**（评审 F1 修正：单包网络错以裸 Error 抛出——installEntryLocked npm 分支 market-mutation.ts:603、github 分支 :689 均无类型包装，若缺省 systemic 则 B4 的主诉场景整批停止）。
- 涉及文件：`src/core/host-api.ts`（错误→HTTP 映射函数，`{ ok: false, … }` 各分支聚集处，2026-10-28 时点位于 231-283 行区）；`src/client/hooks.js`（`api()` 错误装配段）
- 接口契约
  - Consumes: Task 1 `UpgradePathUnsupportedError`、Task 3 `DesktopOpsError('upgrade-unsupported'|'release-age-wait')`、既有 `IncompatibleError`（issue 载体分支）、`InstallGuardError`（toWire 分支）、既有 `TransactionError` 分支（host-api.ts:266-283 detail 投影，import 已在）
  - Produces: 信封字段 `failureClass`——**systemic 白名单（显式标注）**：`InstallGuardError`（装后守卫拦截）；`TransactionError`（事务半残）；`DesktopOpsError` 且 code ∈ {`no-manager`, `remove-failed`, `rollback-failed`} 或未知 code；**其余一律 `'target'`（含无字段裸 Error 缺省臂）**：`UpgradePathUnsupportedError`、`IncompatibleError`、`DesktopOpsError` code ∈ {`upgrade-unsupported`, `release-age-wait`, `install-refused`}、以及单包网络错/404/integrity 缺失等一切未具名错误（B4：目标级失败含单包网络错）。`err.failureClass`（hooks.js api() 装配，Task 8 消费）
- 验证范围：tests/host-api-profile.test.mjs 序列化用例绿 + hooks 透传源锚

- [ ] Step 1: 写失败测试——`tests/host-api-profile.test.mjs` 沿既有序列化测试形态新增六例：①裸 `new Error('getaddrinfo ENOTFOUND registry.npmjs.org')`（模拟 npmLatest 网络错走兜底臂）→ `failureClass === 'target'`；②`InstallGuardError` → `'systemic'`；③`TransactionError` → `'systemic'`；④`DesktopOpsError('release-age-wait', …)` → `'target'`；⑤`DesktopOpsError('no-manager', …)` → `'systemic'`；⑥`UpgradePathUnsupportedError` → `'target'`。另加源结构锚：`src/client/hooks.js` 中 `failureClass` 出现 1 次（出现次数语义）。
- [ ] Step 2: 运行并确认失败
- Run: `npm run build && node --test tests/host-api-profile.test.mjs`
- Expected: 六例红 + 源锚计数 0 红
- [ ] Step 3: 写最小实现——映射函数：兜底臂与 target 各分支补 `failureClass: 'target'`；`InstallGuardError` / `TransactionError` / `DesktopOpsError`（按上述 code 白名单）分支补 `failureClass: 'systemic'`；hooks.js `api()` 在 guard 透传段同款追加 `if (typeof data.failureClass === 'string') err.failureClass = data.failureClass;`
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/host-api-profile.test.mjs`
- Expected: 全绿
- [ ] Step 5: checkpoint commit

### Task 7: 批量三态纯逻辑（installed-updates.js）

- 目标：批量升级的三态判定与汇总输入全部落 DOM-free 纯函数。
- 涉及文件：`src/client/installed-updates.js`
- 接口契约
  - Consumes: Task 4 的 `item.upgradePath`；`BATCH_SELF_PKG`（本文件既有导出，定序不变）
  - Produces: `batchUpgradeOrder(items)` 返回值扩展为 `{ targets, selfIncluded, unsupported }`——`targets` 排除 `upgradePath === 'unsupported'` 的 outdated 项，其余语义不变；`unsupported` 为被排除项数组；`classifyBatchOutcome(res)`（`{ ok: true }` → `'ok'`；`failureClass === 'systemic'` → `'systemic'`；其余一律 `'target'`——含 `'target'`、字段缺席（缺省 target，Task 6 契约）与 `res.needsBuildApproval === true`）；`summarizeBatch(outcomes)` → `{ targetFailed: number, systemic: number, skippedUnsupported: number, stopped: boolean }`（入参 outcomes 为 `Array<{ pkg: string, outcome: 'ok' | 'target' | 'systemic' }>`，由 Task 8 批量循环把 `classifyBatchOutcome` 结果按 pkg 收集而成；`skippedUnsupported` 计数取 `batchUpgradeOrder().unsupported.length`；评审 N4 形状澄清；均为具名导出，Task 8 消费）
- 验证范围：tests/client-installed-updates.test.mjs 新增用例绿（该套件直跑 src，无需 build）

- [ ] Step 1: 写失败测试——`tests/client-installed-updates.test.mjs` 新增 describe：① `batchUpgradeOrder` 对含 unsupported outdated 项的输入，targets 不含之、unsupported 含之，普通项与 self 收尾定序与旧断言一致；**既有断言改写点（评审 F2）**：测试 ② 与 ④ 的 4 处全对象 `assert.deepEqual(batchUpgradeOrder(items), { targets, selfIncluded })`（该文件 :82/:93/:94/:95 附近）期望对象补 `unsupported: []`——deepEqual 比对自身可枚举键集合，新增键不改写必炸；测试 ③⑤ 为解构/单字段断言不受影响；改写处逐一列入 commit message；② `classifyBatchOutcome` 五例（ok / 显式 `'systemic'` → systemic / `'target'` → target / 字段缺席 → target / `needsBuildApproval` → target）；③ `summarizeBatch` 停止与非停止两形态。
- [ ] Step 2: 运行并确认失败
- Run: `node --test tests/client-installed-updates.test.mjs`
- Expected: 新 describe 红（导入不存在/断言失败）
- [ ] Step 3: 写最小实现——按契约扩展 `batchUpgradeOrder` 返回值并新增两个纯函数
- [ ] Step 4: 运行并确认通过
- Run: `node --test tests/client-installed-updates.test.mjs`
- Expected: 全绿（既有用例零回归 = 行为零变化承诺的纯逻辑面）
- [ ] Step 5: checkpoint commit

### Task 8: 面板批量接线与 i18n（installed-tab.jsx + locale）

- 目标：`doUpgrade` 三态返回，批量循环收集结局、unsupported 项不发起请求、循环结束后按需汇总通知。已装页投影形态表态（评审 F9 留痕，覆盖 B6 字面）：数据字段 + 批量排除 + 汇总通知 + 单击升级结构化 toast，**不做 per-item badge**——catalog/synthesized 对面板用户无操作含义，unsupported 已有两条可达出口。
- 涉及文件：`src/client/installed-tab.jsx`（`doUpgrade` 与批量 onClick，installed-tab.jsx:94-122 与 :148-158 区段，行号为 2026-10-28 时点参考）；`src/client/i18n.js`（内联 ZH 字典 :2 起、EN 字典 :127 起）
- 接口契约
  - Consumes: Task 6 `err.failureClass`；Task 7 `classifyBatchOutcome` / `summarizeBatch` / `batchUpgradeOrder().unsupported`
  - Produces: 批量升级新行为（target 失败继续、systemic 失败停止、末尾汇总）；新 i18n 键三枚（落 `src/client/i18n.js` 的 ZH 与 EN 两处——评审 F5 勘误，locale/*.json 是 meta 文件）：`installed.upgradeBatch.targetFailed`（`{n}` 项升级失败，已跳过并继续完成其余）、`installed.upgradeBatch.stopped`（`{target}` 升级失败，已停止后续项——请先处理该插件；**仅在 systemic 失败时使用**）、`installed.upgradeBatch.skippedUnsupported`（`{n}` 项为本地链接安装，未参与批量升级），中英同键同步
- 验证范围：i18n 守卫绿 + 渲染冒烟绿 + 源结构锚

- [ ] Step 1: 写失败检查——① `tests/client-i18n.test.mjs` 既有守卫自动覆盖新键（审计机制 = 扫全部 lookup 直接量 ⊆ ZH∪EN 并集 dictKeys，实现前缺键即红）；② 守卫加强（评审 F5 连带②：dictKeys 是并集、无配对断言，只补单语也绿）：该套件新增一行断言 `Object.keys(ZH)` 与 `Object.keys(EN)` 键集相等（排序后 deepEqual），防中英漂移；③ 源结构锚用例入 `tests/client-installed-updates.test.mjs`：`src/client/installed-tab.jsx` 中 `classifyBatchOutcome` 出现次数 ≥1、`failureClass` 出现次数 ≥1（出现次数语义，读文件切片）。
- [ ] Step 2: 运行并确认失败
- Run: `node --test tests/client-i18n.test.mjs tests/client-installed-updates.test.mjs`
- Expected: 源锚计数 0 红；键集相等断言此时应仍绿（既有字典本就配对）——该断言是防回归门，不是本步红灯来源
- [ ] Step 3: 写最小实现——`doUpgrade` 返回 `classifyBatchOutcome` 判定结果（ok 形态不变、通知行为逐字保留）；onClick 循环改为收集 outcomes、unsupported 项零请求直入汇总；循环后 `summarizeBatch` 非零即按三键 notify（全零 = 无新增横幅，行为零变化承诺）；`src/client/i18n.js` ZH 与 EN 两处各补三键
- [ ] Step 4: 运行并确认通过
- Run: `node --test tests/client-i18n.test.mjs tests/client-installed-updates.test.mjs && npm run build && node --test tests/client-render-smoke.test.mjs`
- Expected: 三套件全绿
- [ ] Step 5: checkpoint commit

### Task 9: 收口验证与关键锚变异抽查

- 目标：全量门禁 + 对「合成条目」这一关键行为接线的源锚做单点变异验证（CODING-STANDARDS 评审检查单要求）。
- 涉及文件：无新改动（只读验证；变异在隔离副本进行后还原）
- 接口契约
  - Consumes: Task 1-8 全部产物
  - Produces: 收口证据（命令输出留证 `.dsh-research/issue30-verify.log`）
- 验证范围：见 Steps

- [ ] Step 1: 全量门禁
- Run: `test -d node_modules && npm test`（>90s，run_in_background；输出经 job_output 取）
- Expected: import guard + 全部 tests/*.test.mjs 绿；`npm run typecheck` 绿
- [ ] Step 2: 关键接线锚变异——临时把 `synthesizeInstallableEntry` 的 github 分支改为返回 npm 形态（隔离副本或就地暂改），跑 Task 2 ②用例
- Run: `npm run build && node --test tests/market-mutation.test.mjs`
- Expected: ②用例红（锚有效证据），还原后复跑绿；两段输出追加进留证文件
- [ ] Step 3: 修改摘要输出——按文件列出改动点与对应测试名（计划追溯格），确认无计划外改动（`git diff --stat` 逐文件归因）
- [ ] Step 4: 无 checkpoint commit（此任务零改动）

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行（Task 1 → 9；Task 4/5 与 2/3 无依赖可并行，但 checkpoint commit 顺序保持编号序），不无声跳步、合并步或改变任务目标。
- 每完成一个任务运行该任务定义的验证；过滤输出一律 `set -o pipefail`。
- main 分支确认：当前 dsh-m 工作树若在 main，开始实现前先向用户确认分支策略（worktree 或直接 main）。
- 遇阻、重复失败或计划与仓库现实不符，立即停下说明，不猜。
- CHANGELOG 与发版不在本计划内：按仓库惯例在发版序列中双语言各补条目（版本号未知，不预写）。

## 最终验证

- `test -d node_modules && npm test`（后台跑，job_output 收口）：import guard + 全部套件绿
- `npm run typecheck`：绿
- `git diff --stat`：改动文件逐一可归因到 Task 1-8
- 人工抽查（可选）：web profile 对一个非收录 npm 插件执行 `dshm upgrade <pkg> --yes`，预期走合成条目成功升级

## 审阅 Checkpoint

- 计划正文到此结束。请先审阅本计划；确认后即可交由普通编码 agent 或人工按任务清单执行。
