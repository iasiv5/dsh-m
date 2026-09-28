# 安装守卫与补偿事务（M2）实施计划 · v11（第十轮复审修订）

> v11 变更（第十轮复审）：① **restartSafe 进入全部消费端字段清单**——GUI `api()` 保留字段补 `restartSafe`、工具结构化 error result、CLI/GUI 输出断言均含该字段；**一键重启按钮只读 `restartSafe`，不得由 `needsRestart` 推导**；② **candidate-key gate 前置为显式 Task 0**——`scripts/verify-github-key-map.mjs` 的创建与运行独立成首个任务，通过后才开始 Task 1/2/3（未通过 → 停下报告，GitHub preflight 保持 fail-closed）；脚本从 Task 3 Create 清单移至 Task 0；③ 第十轮复审第 1 点（Task 3 执行序泛化表述）经核实为过时引用——v9 已改 Task 3 执行序、v10 已同步架构快照，当前文件无「（prior：恢复 mapping → add ladder…）」字符串，本轮无需改动。
> v10 变更（第九轮复审）：① 架构快照执行序同步为 **PriorUnion 分支**（删除「有 prior → add ladder」通用表述——mappingOnly 不 add）；② **candidate key 实测 gate 落地为可执行验收**：`scripts/verify-github-key-map.mjs`（opt-in 集成脚本：临时 profile + 真实 pinned GitHub fixture 经实际 dsh/pnpm 路径验证 name→key 映射，输出验证报告）——**实测未通过前 candidate 不得作为 mutation 前安全门的充分证据**，列为进入实现后的首个安全验证；③ ㉑d 文案强化——明确「旧 prior（link/file）可能已被覆盖，需人工恢复」+ 修复依据，任何端不显示「已恢复原版本/已安装成功」；④ ㉛㉜ 补四端真实输出的**两类状态可区分断言**（preflight=「先人工处理旧 prior」零写入 vs post-add=「旧 prior 可能已被覆盖」+修复依据）。
> v9 变更（第八轮复审）：① **needsRestart 与 restartSafe 分离**——「最终需要重启」≠「现在允许立即重启」：committed(fresh/restore) 且补偿验证完整 → `restartSafe:true`（可显示一键重启）；rolled-back/manual-repair → `restartSafe:false`（文案「修复后再重启」，**不提供立即重启入口**——坏包仍在或状态未知时一键重启正是守卫要防的启动故障）；rejected → 复读 profile 实况决定，不因「零写入」直接设 false；**pre-mutation `GUARD_MANUAL_REQUIRED` → needsRestart=false、restartSafe=false**（零副作用，先人工处理旧 prior）；② **补偿执行序按 PriorUnion.kind 显式分支**——`none`=remove；`mappingOnly`=remove+恢复 mapping+frozen 验证（**runner.add 零调用**，不落入通用「有 prior 就 add」分支）；`dependency`=恢复 mapping→add ladder→三重验证；㉒ 补断言 add 零调用且 dependency 保持不存在；③ 最终验收补 ㉛㉜（post-add manual-repair 与 pre-mutation manual-required 为**独立结构化状态**，所有消费端不渲染「已安装」、无 force 通道）。
> v8 变更（第七轮复审 + 补充意见）：① **npm 与 GitHub 两条路径的 prior 时序分别写明**——npm key 事务前已知，prior 派生与 restorable 检查在事务前完成（link/file/缺 integrity/lock 多义 → add/remove/setLiveDisabled 三次零调用断言）；GitHub 走 candidate preflight → add → 真实 key reconcile 兜底；② **candidate key 契约用真实 pinned GitHub fixture 经实际 dsh/pnpm 安装路径验证**（package.json.name → dependency key；scoped/缺失/非法 name；key ≠ repo/id；歧义 → add 前 fail-closed，post-add manual-repair 仅作明确披露的最后兜底）；③ **GitHub lock evidence 契约**：从真实 pnpm-lock fixture 解析目标 key 的 commit identity——匹配/同 SHA 异包但目标缺失/目标 commit 篡改/importer 多义或缺失 → 拒绝补偿或 unavailable（InstallResult.sha 是请求时 expected SHA，非独立 lock 观测值）；④ **needsRestart 按四态与最终 profile 状态逐项定义**，四端同一映射；⑤ **补偿 strip 严格读写**：remove 前复读两落点，partial failure → 回滚或 manual-repair；⑥ **严格 allowlist**：仅 canonical npm exact + integrity、pinned GitHub commit + 唯一 lock identity 可自动恢复（alias/workspace/tarball URL/git+ssh/未锁定 ref → restorable:false，不复用 parseSpecSource）；⑦ **GUI self-upgrade（Settings）与 ToolCardRow 安装 catch 路径入验收**；⑧ 标题版本号与最终验收（①–④⑰㉑–㉚）修正。
> v7 变更（第六轮复审）：① **GitHub 真实 key 的 pre-mutation 解析**——add 前只读抓取 pinned SHA 的 package.json 解析包名作为 candidate key（抓取失败/歧义 → fail-closed 拒绝安装），candidate key 命中 link/file 或 restorable:false prior → mutation 前拒绝的承诺成立；post-add derivePrior 保留为兜底网（现实与预解析不符 → manual-repair 如实报告，绝不冒充 pre-mutation 拒绝）；测试 ㉑ 拆分为 npm 可恢复/link-file 前置拒绝/解析失败 fail-closed 三例；② **session 命名统一 `withMutationSession`**（v4 残留 withInstallSession 删除），接口定义处列全五入口 + **单点获取**（core façade 一次获取，toggle file lock 在内层；session 非重入，多层重复获取会死锁——测试钉死）；③ evidence 传值路径明确：npm 由 installEntry 把已校验 expectedIntegrity 传入守卫 evidence 并对当前 lock 再验证；GitHub 从 pnpm-lock.yaml 解析 commit identity 与 pinnedSpec/InstallResult.sha 三方比对——补「只篡改 npm lock integrity / 只篡改 GitHub lock commit」两条负例；④ mapping-only 派生严格按真实 key 关联两处 mapping（不按 repo/id/相似名猜），歧义 → unavailable；㉒ 增加相邻 key 与其他包 mapping 不变断言；⑤ 最终验收编号更新至 ①–④⑰㉑–㉓，Task 3 验证命令补 tests/toggle.test.mjs。
> v6 变更（第五轮复审）：① **变更前全量快照 + 真实 key 派生**——GitHub 安装的真实 dependency key 在 add 后经新旧 manifest diff 才可知（installGithub 真相源），预猜 key 会把同名 npm/file 依赖误判 absent 再误删；改为 mutation 前捕获完整 deps/lock/mapping 快照，add 返回真实 key 后从快照派生 prior，key 关联歧义 → fail-closed，绝不用 fresh remove 兜底；② **prior 判别联合**——`none`（依赖与 mapping 均确认不存在）/`mappingOnly`（依赖不存在但 mapping 有条目）/`dependency`（完整 PriorState）三形态，`absent` 无法承载 mapping-only 的类型缺口闭合，判定表唯一化（ENOENT/确认不存在/已捕获/mapping-only/读取不完整各自唯一状态）；③ **toggle 纳入同一 mutation session**（toggle 改 `dsh.profile.bundles`/`cordis.patch.yml`，不纳入会与 snapshot/strip/补偿并发覆写），「四个 façade 已串行」的表述改正为「全部 profile mutation façade」。
> v5 变更（第四轮复审）：① **分源 evidence**——npm 比对 manifest 值 + node_modules 实际 version + integrity；GitHub 比对 manifest 中 pinned spec（`github:owner/repo#sha`）+ 本次 `InstallResult.sha` + lock resolution 的 commit identity（`InstallResult.version` 在 GitHub 分支不存在，v4 的统一 version 比较会令 GitHub 违例永远失配）；② **live-disable 移到 snapshot 之后**（遵守「快照前零写入」不变量；snapshot 失败 → 零 live-disable，测试钉死）；③ **prior 捕获三态 `absent|captured|unavailable`**——直接读完整 manifest/lock/mapping，`listInstalledPlugins().items` 只收含顶层 dsh 的包、不能作为 prior=null 的依据；捕获 unavailable → 拒绝开始会覆盖它的安装（fail-closed）；④ npm prior **无 integrity → 不可自动恢复**（不得弱于安装安全基线，缺失/多义用例钉死）；⑤ **不可自动恢复的 prior（link/file）在 mutation 前拒绝覆盖**——独立 `GUARD_MANUAL_REQUIRED` 非成功状态，与 fail-open 的 committed+guardWarning 严格区分；⑥ **self-upgrade 与所有 mutation façade 纳入 session+guard**（host-api self-upgrade 直调事务的旁路封死；`installEntry` 转内部 helper）；⑦ 错误渲染闭合：renderer/presentResult 的 ok:false 分支、upgrade 两路径、GUI api() 字段保留与重启横幅、真实渲染文本断言；⑧ `^/~` 恢复语义定稿（接受规范化但明示「spec 已规范化」，不称完全恢复）；⑨ fresh+预置 mapping 的 frozen 收敛不通过 → manual-repair；⑩ patchMapping 结构化双落点（只回写目标包条目）；⑪ 补偿事务测试文件定为本计划内 `tests/profile-transaction.test.mjs` + 新建 `tests/tools-install.test.mjs`（注册真实 dshm_install/dshm_upgrade 工具）。
> v4 变更（第三轮复审）：fresh 自撞排除、mapping 先于 add、market 层操作串行区间、PriorState 完整性、分包 fail-open、读错误分类、needsRestart、root sugar、错误契约、apiBase 贯穿、术语更正。
> v3 变更：实读 manifest 证据、prior 全景、insert id 真相源、保守 resolver、三端 fail-open。
> v2 变更：专用补偿事务方向。

## 目标

- 消灭「装完即假成功」：所有 mutation 入口（含 self-upgrade）经统一守卫与补偿，违例安全回退（新装→移除并还原既有 mapping；已存在→恢复旧版本+旧 mapping+旧 integrity 验证）。
- 钉死更新语义：`isNewerVersion` 采用标准 semver 前进比较、`githubLatestTag` 两条路径都取 peeled commit sha。
- 统一拉取失败文案三要素，不丢失协议错误根因。

## 架构快照

- **统一 mutation 串行区间**：`market.ts` `withMutationSession(fn)` 包住**全部五个** profile mutation 入口——`installFromRegistry`/`upgradePlugin`/`uninstallPlugin`/`selfUpgrade`（收编 host-api 直调事务的旁路）/**`toggle`**；`installEntry` 转为模块内部 helper 不再导出。**session 单点获取**：只在 core façade（toggle 在 `toggle.ts` 的 `togglePlugin` 本体）获取一次，host-api/tools/CLI 层不重复获取（session 非重入，多层重复获取会死锁）；toggle 自身 file lock 在 session 内层，锁序 = mutation session → toggle file lock / 事务 FIFO。prior/快照捕获→事务→守卫→补偿在同一区间；跨进程仍是既有已知限制。
- **补偿事务 `compensate-install`**：**分源 evidence**——npm：manifest 值 + node_modules 实际 version + 本次 integrity；GitHub：manifest pinned spec（`github:owner/repo#sha`）+ 本次 `InstallResult.sha` + lock resolution commit identity（node_modules package.json version 仅作附加检查）。validate 双重复验任一失配 → `rejected` + `COMPENSATE_EVIDENCE_MISMATCH`。执行序：**validate → snapshot → live-disable → strip → remove → verify gone**，随后按 **PriorUnion 分支**——`none`：终；`mappingOnly`：恢复 mapping + frozen 验证（**runner.add 零调用**）；`dependency`：恢复 mapping → add ladder → frozen 收敛 → 三重验证。live-disable 在 snapshot 后（快照前零写入不变量）。无外部 signal。
- **prior 三态与可恢复性**：捕获 `absent|captured|unavailable`（直读 manifest deps/lock resolution/两处 patchedDependencies；`listInstalledPlugins().items` 不作为 prior 依据）；npm prior 缺 integrity 或 lock resolution 歧义 → `captured` 但 `restorable:false`；link/file → `sourceKind:'other'` + `restorable:false`。**`restorable:false` 的 prior：mutation 前拒绝覆盖**（独立 `GUARD_MANUAL_REQUIRED` 非成功状态），绝不按 fresh 删除、绝不冒充成功。
- **fail-open 分包决策**：确定性 violation 仍补偿；仅结论不可定的包放行 + `guardWarning`；deps 全量读失败 → 整体 fail-open。
- `versions.ts`：`semver.gt`、`apiBase` 贯穿三类请求。GitHub 请求预算层属 M1 Task 5（仅被动探测携带）。

## 全局约束

- 从 DESIGN.md §3 逐字继承：守卫三检查、`compensate-install` 边界（实读分源证据/prior 全景/三重恢复验证/无外部 signal）、快照前零写入、fail-open + `guardWarning`、`isNewerVersion` 切 `semver.gt`、`/tags` 回退解引用。
- 零新运行时依赖；Node `>=22`；中文优先文案；验证命令 `npm run build && node --test tests/<file>.test.mjs`。
- **不改既有事务 kind 的语义**；仅新增 `compensate-install` kind；不改事务内核 FIFO。
- 与 M1 共享 `market.ts`/`httpx.ts`/`tests/market.test.mjs`/`tests/httpx.test.mjs`——可分阶段验证、不支持并行落地；按 M1 → M2 串行。
- 无额外全局约束。

## 输入工件

- `docs/DESIGN.md` §3「装后假成功守卫（0.5.0）」「更新语义加固（0.5.0）」
- 事实依据（已核实）：`profile-transaction.ts` L860 `NOT_DSH_PLUGIN`、L701 `pkg@version` 源 spec、L944-L1006 FIFO 随单次调用释放、L984-L1005 snapshot 先于 dispatch、L899-L930 卸载在 snapshot 后才 setLiveDisabled；`market.ts` GitHub 分支只返回 sha/tag 无 version、L719-L722 安装调 `githubLatestTag`、L657 `installEntry` 导出；`host-api.ts` self-upgrade 直调事务；`tools.ts` L275-291 outdated 投影、L440-453 renderInstall 无 ok:false 分支；`installed.ts` items 只收含顶层 dsh 的包
- dsh-market 事故参照：#122、#64、#597

## 文件结构与职责

- Create: `src/core/install-guard.ts`、`tests/install-guard.test.mjs`、`tests/tools-install.test.mjs`（注册真实 `dshm_install`/`dshm_upgrade` 工具，断言服务端渲染输出）
- Modify: `src/core/profile-transaction.ts`（compensate-install kind）、`src/core/market.ts`（session+`selfUpgrade`+守卫接线+`InstallGuardError`+`guardWarning`；`installEntry` 转内部）、`src/core/versions.ts`（semver.gt、apiBase）、`src/core/host-api.ts`（self-upgrade 收编 + 409 投影 + needsRestart）、`src/client/main.jsx`、`src/tools.ts`、`src/cli.ts`、`src/core/httpx.ts`、`src/core/registry.ts`、`src/core/community.ts`（M1 已落地时必做）
- Test: `tests/install-guard.test.mjs`、`tests/versions.test.mjs`、`tests/profile-transaction.test.mjs`、`tests/market.test.mjs`、`tests/host-api.test.mjs`、`tests/tools-install.test.mjs`

## 任务清单

### Task 0: candidate-key 实测 gate（前置安全验证，先于一切实现任务）

- 目标：用真实 dsh/pnpm 安装路径证明 `package.json.name → dependency key` 映射，为 GitHub preflight 安全门提供充分证据；未通过前 GitHub preflight 保持 fail-closed。
- Files: Create `scripts/verify-github-key-map.mjs`
- 接口契约
  - Consumes: 无（独立脚本）
  - Produces: 验证报告（stdout）——scoped name 样本、name ≠ repo/registry id 的真实 key 清单、映射成立/不成立结论；Task 3 的 candidate preflight 以本 gate 结论为前提
- 验证范围：`node scripts/verify-github-key-map.mjs`（opt-in，CI 外运行；临时 profile + 真实 pinned GitHub fixture，不触碰真实 web profile）
- [ ] Step 1: 当前状态检查：脚本不存在——GitHub preflight 的「name→key」假设无实测证据
- [ ] Step 2: 实现脚本：临时 profile（`mkdtemp`）→ 逐 fixture 执行真实 `dsh plugin --profile <tmp> add github:<owner>/<repo>#<sha>` → diff 前后 manifest 提取真实 dependency key → 与 fixture 的 `package.json.name` 比对 → 汇总报告
- [ ] Step 3: Run: `node scripts/verify-github-key-map.mjs` — Expected: 结论为「成立」（scoped name 命中、name ≠ repo/id 命中）；任何一例不成立 → **停止，不进入 Task 1**，向 owner 报告实测证据（Task 3 的 GitHub preflight 方案需据此重新设计）
- [ ] Step 4: `git add scripts/verify-github-key-map.mjs && git commit -m "test(0.5.0): github candidate-key mapping gate"`

### Task 1: `versions.test.mjs` 语义钉死（seam 先行）

- Files: Create `tests/versions.test.mjs`; Modify `src/core/versions.ts`
- 接口契约：Produces `isNewerVersion`（semver.gt）；`githubTagSha`/`githubLatestTag` 末位可选 `apiBase`（贯穿 releases/tags/commits 三类请求）
- 验证范围：`npm run build && node --test tests/versions.test.mjs`
- [ ] Step 1: **先加 `apiBase` seam** 并 build。随后写测试：`isNewerVersion` 用例表（`1.2.3-beta.1` vs `1.2.3` 旧实现误判回归、build metadata、`0.10.0` vs `0.9.0`、降级/相等 false、非法输入不抛）；`githubTagSha` 本地服务器；`githubLatestTag` release 与 fallback 两分支 **全部 HTTP 请求命中本地 server**（嵌套 SHA 查询不外泄）
- [ ] Step 2: Run — Expected: prerelease 与 fallback 用例失败
- [ ] Step 3: 实现（semver.gt；fallback 改调 `githubTagSha`）
- [ ] Step 4: Run — Expected: 通过
- [ ] Step 5: `git add src/core/versions.ts tests/versions.test.mjs && git commit -m "fix(0.5.0): semver.gt update semantics + peeled tags on both github paths"`

### Task 2: `install-guard.ts` 三项检查（自撞排除 + 读错误分类）

- Files: Create `src/core/install-guard.ts`、`tests/install-guard.test.mjs`
- 接口契约
  - Consumes: `readBundlePatchRows`；profile `package.json` dependencies 全量键
  - Produces: `GuardViolationCode`、`GuardViolation`、`verifyInstalledAdditions(input: { profileDir; addedPkgs; priorPkgs?; pkgsDir? }, deps?: { readDeps? }): Promise<{ ok; violations; unavailable }>`
  - 检查语义（v4 全部保留）：
    1. `NO_DSH_MARKER`：ENOENT → 此 code；EACCES/EIO/坏 JSON → `unavailable`
    2. `ENTRY_UNRESOLVABLE`：exports string（root sugar）/object 仅 default → 可检查；含其他条件键 → `unavailable`；无 exports 用 main；`stat.isFile()` + realpath containment
    3. `LOADER_ID_CONFLICT`：现存集合 = profile 根 patch insert + dependencies 全量键包的 insert ids（**排除 `addedPkgs ∪ priorPkgs`**）；新增包 pairwise；ENOENT=空集、EACCES/坏 YAML=unavailable；bundles 不产生 id（注释澄清）
  - `readDeps` 完整快照或显式失败
- 验证范围：`npm run build && node --test tests/install-guard.test.mjs`
- [ ] Step 1: 失败测试（v4 全部 22 项保留：自撞回归 ⑧、双新包 ⑧b、others 包 ⑩c、读错误分类 ②/②b、conservative exports ④b/④c/④d、containment ⑥、根 patch ⑦b、partial deps ⑪）
- [ ] Step 2: Run — Expected: 失败
- [ ] Step 3: 实现
- [ ] Step 4: Run — Expected: 通过
- [ ] Step 5: `git add src/core/install-guard.ts tests/install-guard.test.mjs && git commit -m "feat(0.5.0): install guard (self-collision excluded, io taxonomy)"`

### Task 3: `compensate-install` 事务 + 统一 session + 三端接线

- Files: Modify `src/core/profile-transaction.ts`、`src/core/market.ts`、`src/core/toggle.ts`（toggle 入口接入 mutation session）、`src/core/host-api.ts`、`src/client/main.jsx`、`src/tools.ts`、`src/cli.ts`；Test `tests/profile-transaction.test.mjs`、`tests/market.test.mjs`、`tests/host-api.test.mjs`、`tests/tools-install.test.mjs`、`tests/toggle.test.mjs`（candidate-key 脚本已前置至 Task 0）
- 接口契约
  - Consumes: Task 2 守卫；事务 snapshot/strip/remove/verify/add ladder 原语；`npm-integrity.ts`
  - Produces:
    - **`withMutationSession(fn)`**：模块级 FIFO（非重入），包住五个入口——`installFromRegistry`/`upgradePlugin`/`uninstallPlugin`/`selfUpgrade`/`toggle`（host-api self-upgrade 改调 `market.selfUpgrade()`；toggle 的 session 在 `toggle.ts` 的 `togglePlugin` 本体获取一次，host-api/tools/CLI 层不重复获取；toggle file lock 在 session 内层）；`installEntry` 转模块内部 helper（不导出）；锁顺序：mutation session 外层 → toggle file lock / 事务 FIFO 内层，无同锁嵌套
    - **变更前全量快照**：`capturePreMutationState(profileDir): Promise<{ kind:'unavailable'; reason } | { kind:'snapshot'; snapshot: { deps: Record<string,string>; lockResolutions: Record<string,{version,integrity,commit?}>; mapping: { workspace: Array<{key,patchPath}>; manifest: Array<{key,patchPath}> } } }>`——npm 与 GitHub 安装统一在 mutation 前捕获完整 deps/lock/mapping。**GitHub 的真实 dependency key 在 add 后经新旧 manifest diff 才可知**（`installGithub` 的 diff 是 key 真相源，profile-transaction.ts L774-L812），预猜 key 会把同名 npm/file 依赖误判 absent 再误删。读取失败 → `unavailable` → 拒绝开始安装（fail-closed 错误，零写入）
    - **npm 路径时序**：npm key 事务前已知（`entry.npm`）——prior 派生与 restorable 检查在**事务前**完成；`restorable:false`（link/file/alias/workspace/tarball/缺 integrity/lock 多义）→ 事务前 `GUARD_MANUAL_REQUIRED`，**runner.add/remove/setLiveDisabled 零调用**（测试 ㉙ 断言三次零调用）
    - **GitHub pre-mutation key 解析（v6 矛盾的解法）**：github 安装在 mutation 前**只读抓取 pinned SHA 的 `package.json`**（走 M1 预算外通道，read-only 不写 profile）解析 `name` 字段作为 candidate dependency key——candidate 命中既有 link/file 依赖或 `restorable:false` prior → **mutation 前 `GUARD_MANUAL_REQUIRED`**（承诺成立）；抓取失败/解析歧义 → fail-closed 拒绝安装（零写入）。**candidate key 契约的证明（补充意见 2）**：用真实 pinned GitHub fixture 经项目实际 dsh/pnpm 安装路径验证 `package.json.name → dependency key` 映射——覆盖 scoped name、name 缺失/非法、key ≠ repo/registry id；映射无法证明（歧义）→ **add 前 fail-closed**；post-add manual-repair 仅作明确披露的最后兜底，不视为已保证保留 prior。**post-add 兜底网保留（残余风险，owner 已确认接受）**：add 后 `derivePrior(snapshot, realKey)` 复核——真实 key 与 candidate 不符且发现不可自动恢复 prior → **manual-repair 非成功状态**，错误体携带旧 manifestSpec/installSpec/mapping 修复依据；不冒充 pre-mutation 拒绝、不承诺 prior 无损（DESIGN §3 残余风险条目）
    - **prior 派生（add 返回真实 key 后、守卫前）**：`derivePrior(snapshot, realKey): { kind:'none' } | { kind:'mappingOnly'; patchMapping } | { kind:'dependency'; state: PriorState } | { kind:'unavailable'; reason }`——**严格按真实 key 精确关联**快照中同 key 的 deps 与两处 mapping（不按 repo、registry id 或相似包名猜）；关联歧义 → `unavailable` fail-closed，**绝不用 fresh remove 兜底、也不归为 none**。判定表（唯一状态映射）：key 不在 deps 且 mapping 无条目 → `none`；不在 deps 但 mapping 有该包条目 → `mappingOnly`；在 deps → `dependency`（npm 需 integrity 可得否则 `restorable:false`；link/file → `other`+`restorable:false`；lock resolution 多义 → `unavailable`）
    - **candidate key 实测 gate（进入实现后的首个安全验证）**：`scripts/verify-github-key-map.mjs`（opt-in，CI 外运行）——临时 profile + 真实 pinned GitHub fixture 经**实际 dsh/pnpm 安装路径**验证 `package.json.name → dependency key` 映射；输出验证报告（scoped name 样本、name ≠ repo/id 的真实 key 清单、映射成立/不成立结论）。**实测未通过前，candidate 不得作为 mutation 前安全门的充分证据**（Task 3 Step 1 的 fake-runner 测试不能证明 pnpm 真实 key 规则）
    - **可自动恢复来源 allowlist（严格白名单，防 parseSpecSource 误归类）**：仅 ① canonical npm registry exact version + 完整 dist integrity、② pinned GitHub commit + 唯一 lock commit identity 可自动恢复；**alias（npm:xxx）/workspace 协议/tarball URL/git+ssh/未锁定 GitHub ref 一律 `restorable:false`**（现 `parseSpecSource()` 会把大多数非空 spec 归为 npm——判定独立实现不复用它，alias/tarball/git+ssh/workspace 各形态入测试 ㉗）
    - `interface PriorState { manifestSpec; installSpec; resolvedVersion; sourceKind: 'npm'|'github'|'other'; integrity?; lockResolution?; patchMapping: { workspace:[{key,patchPath}]; manifest:[{key,patchPath}] }; restorable: boolean }`（dependency 形态专用）——npm prior 的 integrity 取自捕获时快照 lockfile `resolution.integrity`，**缺失/多义 → `restorable:false`**；link/file → `sourceKind:'other'` + `restorable:false`。`mappingOnly` 形态仅携带 `patchMapping`；`none` 无 payload
    - **pre-mutation 拒绝**：`restorable:false` 的 prior → 事务前直接返回独立非成功状态 **`GUARD_MANUAL_REQUIRED`**（不进 mutation、不算成功安装、不与 fail-open 的 committed+guardWarning 混用），消息含「原安装形态无法自动回退，请先手动处理」
    - `TransactionRequest` 新增 `{ kind: 'compensate-install'; pkg; evidence; prior: PriorUnion }`（`pkg` = add 返回的**真实 dependency key**；`PriorUnion` = 上述三形态判别联合）——**分源 evidence 及传值路径**：npm `{ manifestSpec, resolvedVersion, integrity }`——`integrity` 由 `installEntry` 把**本次已校验的 expectedIntegrity**（现为局部变量）传入守卫 evidence，validate 时对**当前 lockfile** 再验证；github `{ pinnedSpec, sha, lockCommitIdentity }`——`lockCommitIdentity` 由守卫从**实际 pnpm-lock.yaml 解析**（npm-integrity 读取器扩展），与 pinnedSpec、InstallResult.sha 三方比对（node_modules version 仅附加检查）。validate 实读比对（不匹配 → `rejected` + `COMPENSATE_EVIDENCE_MISMATCH` 零写入；接入分发与 renderFailure）。执行序（**按 PriorUnion.kind 显式分支，无通用「有 prior 就 add」路径**）：**validate → snapshot → live-disable → strip → remove → verify gone**，随后——`none`：终；`mappingOnly`：恢复 mapping → frozen 验证（**runner.add 零调用**——原依赖本不存在，add 会装回不存在的包）；`dependency`：恢复 mapping → add ladder → frozen 收敛 → 三重恢复验证。无外部 signal；live-disable 异常与 rolled-back/manual-repair 时 best-effort 恢复 live 状态并如实报告
    - **GitHub lock evidence 契约（补充意见 3）**：`lockCommitIdentity` 从**真实 pnpm-lock fixture** 解析目标 key 的 resolution——四例：目标 key commit 匹配（通过）；同一 SHA 出现在其他包但目标 key 缺失（拒绝补偿）；目标 commit 被篡改（拒绝补偿）；root importer 多义/缺失（unavailable）。**`InstallResult.sha` 是请求时 expected SHA，非独立 lock 观测值**——evidence 以 lock 解析为准（测试 ㉖）
    - 恢复验证三重（v4 保留）+ **integrity 为 restore committed 前提**：npm prior 无 integrity 时捕获阶段已 `restorable:false`，不存在「跳过 integrity 的恢复」；lock resolution 与 prior 一致
    - **`^/~` 语义定稿**：恢复后接受 CLI 书写规范化，但结果注明「已恢复旧 resolved version，spec 已规范化为 X」——不称「完全恢复 prior manifest」；frozen 收敛验证 importer specifier 与 lock 一致
    - **fresh + 预置 mapping**：恢复 mapping 后运行 frozen 验证；若 prior 本身未收敛 → `manual-repair`，不宣称 committed/profileConverged
    - **patchMapping 结构化双落点**：`{ workspace: [{key, patchPath}], manifest: [{key, patchPath}] }`——只回写目标包相关条目、保留其他包条目；两落点同时存在与版本化 key 入测试
    - **补偿 strip 严格读写（补充意见 6）**：不复用吞异常的宽松 helper——strip 前后**复读** workspace 与 package.json 两落点，确认目标 mapping 摘除/保留符合预期；任一落点写入失败或复读不符 → 回滚或 manual-repair，不得继续 remove 后报 committed。测试 ㉘：workspace-only、manifest-only、双落点 partial failure 三形态
    - **四态 × fresh/restore 矩阵**（唯一文案权威）：committed(fresh)=「已自动卸载」/committed(restore)=「已恢复原版本 X.Y.Z」/rolled-back=「补偿未完成，已回到补偿前状态，坏包可能仍在，需人工处理」/rejected=「补偿未执行（profile 状态已变化）」/manual-repair=「需人工处理」；断言最终 manifest/node_modules/mapping/profileConverged
    - **needsRestart × restartSafe 按状态与最终 profile 实况逐项定义（v9 修订）**：`needsRestart`=最终需要重启；`restartSafe`=**现在**允许一键重启。committed(fresh/restore)+补偿验证完整 → needsRestart=true, restartSafe=true；rolled-back（坏包可能仍在）→ needsRestart=true, **restartSafe=false**（「修复后再重启」）；manual-repair（状态未知）→ needsRestart=true, **restartSafe=false**；rejected → **复读 profile 实况决定**（不因零写入直接 false）；**pre-mutation `GUARD_MANUAL_REQUIRED` → needsRestart=false, restartSafe=false**（零副作用）。host-api/GUI/agent/CLI 同一映射；GUI 断言：坏包仍在或状态未知时**不显示立即重启按钮**（只有 restartSafe=true 才显示），改为修复指引文案
    - `InstallGuardError { violations; compensation; needsRestart; restartSafe; kind: 'compensated'|'manual_required' }`——各字段按上述映射；host-api 投影 `{ violations, compensation, needsRestart, restartSafe, kind }` 白名单；GUI 重启横幅/入口仅在 `restartSafe===true` 渲染
    - **三端渲染闭合（真实通路）**：`tools.ts` renderer/presentResult 增加 `ok:false` 分支（现 renderInstall 无条件「✅ 已安装」）——`dshm_install` 与 **`dshm_upgrade`** 的 execute 捕获 `InstallGuardError` → 结构化 error result；`cli.ts` install **与 upgrade** 捕获 → stderr 结构化输出 + 重启提示；GUI `main.jsx` `api()` **保留** `violations/compensation/needsRestart/restartSafe/kind` 字段（现只取 issue）；工具结构化 error result 与 CLI stderr 输出同样含 `restartSafe`；**一键重启按钮只读 `restartSafe===true` 渲染，不得由 `needsRestart` 推导**；**GUI 四条入口全覆盖（补充意见 4）**：主市场 doInstall、doUpgrade、**Settings self-upgrade catch（现只显示普通 message）**、**ToolCardRow install catch（现含静默分支）**——四路径分别断言失败 title/violations/不可 force/needsRestart/**restartSafe**/manual-repair 文案（重启入口仅 restartSafe===true 出现）；`guardWarning` 走成功提示
  - 行为：`withMutationSession` 内——变更前快照（unavailable → fail-closed 拒绝，零写入）→ **npm：prior 派生与 restorable 检查（事务前；`GUARD_MANUAL_REQUIRED` → 零写入返回）**；**GitHub：candidate preflight → 事务 → derivePrior(realKey) 复核** → 守卫 → `ok && unavailable 空` → 返回；确定 violations → 按包补偿（`restorable:false` 已在 mutation 前拒绝；`mappingOnly` → 移除新包 + 恢复 mapping；`none` → 移除）→ 按 kind 抛/返回；守卫异常/不可定 → fail-open committed + `guardWarning`。**`toggle` 三入口（host-api/tool/CLI）同样经 `withMutationSession`**——toggle 自身 file lock 保留在 session 区间内层
- 验证范围：`npm run build && node --test tests/profile-transaction.test.mjs && node --test tests/market.test.mjs && node --test tests/host-api.test.mjs && node --test tests/tools-install.test.mjs && node --test tests/toggle.test.mjs`
- [ ] Step 1: 失败测试（真实 `runProfileTransaction` + fake runner）：① fresh 无 marker → committed 移除；② fresh+预置 mapping → 移除后 mapping 恢复 + frozen 收敛断言（未收敛 → manual-repair）；③ 重复安装恢复 1.0.0（node_modules version 断言）；④ 升级恢复：**mapping 先于 add**（调用序）+ lock patch 引用 + integrity 对照 + node_modules version；⑤ **GitHub 分源 evidence**：github 安装违例 → 以 pinnedSpec+sha+lock commit identity 复验、补偿成功（fresh 与 upgrade 各一例——`InstallResult.version` 不存在的回归）；⑥ npm prior 无 integrity → `restorable:false`、mutation 前拒绝（零写入）；⑦ link/file prior → `GUARD_MANUAL_REQUIRED` 非成功、包保留、不含「已安装成功」文案；⑧ 篡改 deps → rejected + `COMPENSATE_EVIDENCE_MISMATCH`；⑨ **插队复验**（node_modules version 变更）→ npm/version 与 github/sha 两形态各自拒绝；⑩ retryable-lag → ladder 成功；⑪ remove 失败 → 按收敛断言四态；⑫ 守卫异常/unavailable → committed+guardWarning；⑬ 分包：A 确定冲突补偿、B 不可定保留；⑭ **snapshot 失败 → setLiveDisabled 零调用**；⑮ 无外部 signal：客户端 abort 不影响补偿；⑯ 六类 RunnerOutcome × fresh/restore → 四态；⑰ **self-upgrade**：经 session+守卫（guard 违例 → 恢复旧 dsh-m）、与 install 并发时锁序正确（无同锁嵌套死锁）；⑱ `^/~` 规范化 → committed + note；⑲ 双落点 mapping 恢复且其他包条目不受影响；⑳ 三端：tools-install.test.mjs 注册真实工具断言 error result/渲染文本/标题、CLI stderr、host-api 409 body、GUI api() 字段保留与重启横幅行为——**GUI 四入口（主市场 doInstall/doUpgrade/Settings self-upgrade/ToolCardRow）分别断言失败 title/violations/不可 force/manual-repair 文案**；㉑a **GitHub 真实 key ≠ registry id 且旧 prior 为 npm** → pre-resolution 识别 + 违例后恢复原依赖（预猜 key 误判 absent 的回归）；㉑b **旧 prior 为 link/file** → pre-resolution 命中 → **mutation 前** `GUARD_MANUAL_REQUIRED`（add 零调用断言）；㉑c **package.json@sha 抓取失败/歧义** → fail-closed 拒绝安装、零写入；㉑d post-add 兜底：真实 key 与 candidate 不符且发现 link/file prior → **manual-repair 非成功**——文案明确「旧 prior（link/file）可能已被覆盖，需人工恢复」+ 附旧 manifestSpec/installSpec/mapping 修复依据；任何端不显示「已恢复原版本」/「已安装成功」；㉒ **mapping-only prior**：依赖不存在、workspace 与 manifest 两处均有该包 mapping → 移除新包 + 两处 mapping 恢复（版本化 key）+ **相邻 key 与其他包 mapping 逐字节不变** + **runner.add 零调用** + **dependency 在最终 manifest 中保持不存在**；㉓ **补偿期间 toggle**：并发 toggle 被 session 排队、不与 snapshot/strip/补偿交错；㉔ **evidence 负例×2**：只篡改 npm lock integrity → 拒绝补偿；只篡改 GitHub lock commit identity → 拒绝补偿；㉕ **session 非重入/排队**：toggle 在 session 内单次获取、并发 toggle 排队、session 拒绝后后续 mutation 仍能运行（无死锁）；㉖ **GitHub lock evidence 四例**（真实 lock fixture：目标 commit 匹配/同 SHA 异包但目标缺失/目标 commit 篡改/importer 多义或缺失）；㉗ **严格 allowlist**：alias/workspace/tarball URL/git+ssh/未锁定 ref 各形态 → `restorable:false` + pre-mutation 拒绝；㉘ **strip 严格读写**：workspace-only/manifest-only/双落点 partial failure → 回滚或 manual-repair；㉙ **npm 事务前拒绝零调用**：link/file/缺 integrity/lock 多义 → add/remove/setLiveDisabled 三次零调用；㉚ **needsRestart × restartSafe 映射**与最终 profile/包实体相符——rolled-back/manual-repair 下 GUI **不显示立即重启按钮**（restartSafe:false）、committed 显示；㉛ **post-add manual-repair 独立结构化状态**：非成功、错误体含旧 manifestSpec/installSpec/mapping 修复依据、四端（host-api/MCP/CLI/GUI 四入口）均不渲染「已安装」且无 force 通道；㉜ **pre-mutation GUARD_MANUAL_REQUIRED 独立状态**：needsRestart=false、restartSafe=false、零写入、提示先人工处理旧 prior——**四端真实输出断言两类状态文案可区分**：preflight=「先人工处理旧 prior」（零写入）vs post-add=「旧 prior 可能已被覆盖」+修复依据（㉛）
- [ ] Step 2: Run — Expected: 失败
- [ ] Step 3: 实现
- [ ] Step 4: Run + `npm run typecheck` — Expected: 通过
- [ ] Step 5: `git add src/core/profile-transaction.ts src/core/market.ts src/core/toggle.ts src/core/host-api.ts src/client/main.jsx src/tools.ts src/cli.ts tests/profile-transaction.test.mjs tests/market.test.mjs tests/host-api.test.mjs tests/tools-install.test.mjs tests/toggle.test.mjs && git commit -m "feat(0.5.0): compensate-install transaction + unified session + guard wiring"`

### Task 4: `describeFetchFailure` 三要素统一（不吞根因）

- Files: Modify `src/core/httpx.ts`、`src/core/registry.ts`、`src/core/community.ts`（M1 已落地时必做）；Test `tests/httpx.test.mjs`、`tests/registry.test.mjs`
- 接口契约：Produces `describeFetchFailure({ label, url, err, attempts?, elapsedMs? }): string`——AbortError=「请求被取消」；超时=「超时」；message 形如 `HTTP <n>` 才映射状态码；其余保留安全化根因。整体：`<label> 失败：<原因>（<attempts> 次尝试，耗时 <s>s）；可稍后重试或检查网络后重试`
- 验证范围：`npm run build && node --test tests/httpx.test.mjs && node --test tests/registry.test.mjs && npm test`
- [ ] Step 1: 失败测试：① 四形态原因段（502 断言根因词）；② `loadRegistryCandidate` 全失败 → errors 三要素断言
- [ ] Step 2: Run — Expected: 失败
- [ ] Step 3: 实现并切换 registry 两链与 community
- [ ] Step 4: Run — Expected: 通过
- [ ] Step 5: `git add src/core/httpx.ts src/core/registry.ts src/core/community.ts tests/httpx.test.mjs tests/registry.test.mjs && git commit -m "feat(0.5.0): three-part fetch failure messages"`

## 执行纪律

- 开始前复查计划；顺序 **0→1→2→3→4**（Task 0 是前置安全 gate，未通过不进入 Task 1；Task 3 依赖 2；Task 4 依赖 M1 的 community.ts）；不无声跳步。
- 每任务运行其验证；checkpoint 显式清单 stage（不用 `git add -A`，提交前 `git status`）。
- 遇阻或与仓库现实不符立即停下说明。
- 在 `feat/community-catalog` 分支（M1 之后）执行。

## 最终验证

- `npm run typecheck && npm test` — Expected: 全部通过
- 守卫端到端判据 = Task 3 Step 1 ①–④⑰㉑–㉜（真实事务 + fake runner，临时 profile），不改动真实 web profile；真实链路冒烟属 opt-in 人工验收
- **candidate key 实测 gate（Task 0，任务序列最前）**：`node scripts/verify-github-key-map.mjs` — Expected: 映射验证报告结论「成立」；未通过 → 实现停止在 Task 0、GitHub preflight 安全门保持 fail-closed
- `npm pack --dry-run --json` — Expected: 产物清单正常

## 审阅 Checkpoint

- 计划正文结束后请求用户审阅；审阅通过前不进入实现。
