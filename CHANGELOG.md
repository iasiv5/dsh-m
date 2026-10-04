# 更新日志 · Changelog

dsh-m 的完整版本历史，双语维护：**中文在前，英文在后**，同版本号对齐；各语言区块内按版本倒序排列。发版时请在两个区块各补一条目。

The full release history of dsh-m, maintained bilingually: **Chinese first, English second**, aligned by version; entries within each section are newest-first. When releasing, prepend an entry to both sections.

---

## 中文

### 0.9.31 变更：doctor 支持 desktop profile（CLI 例外开口 + farmChecked 语义修订，ADR-0011）

- **动机**：Windows desktop 机实机报告证实 core 引擎本就 profileDir 参数化无 web 硬编码（desktop 物化布局判 hoisted、farm=0 属常态），但 CLI 全命令一刀切拒绝 `--profile desktop` 把只读体检连坐；desktop-only 机器无 flag 体检还会扫不存在的 web 目录得全 0 报告。
- **CLI 例外（仅 doctor）**：`dshm doctor --profile desktop` 允许并路由 `desktopProfileDir()`，输出首行加 `[web|desktop]` 标注；HELP 同步；**其余命令对 `--profile desktop` 的拒绝语义逐字不变**（回归钉子测试钉住），desktop 变更管理仍走官方 Desktop 插件页。
- **空目录提示**：目标 profile 目录不存在时提示「desktop-only 机器请加 --profile desktop」——判据为目录不存在（存在但为空的合法 profile 不误伤）。
- **宿主 method 零改动**：doctor case 本就 active-profile 无关，desktop 宿主免改生效（新增 desktop-kind 注入钉子测试）；MCP 工具 `dshm_doctor` 维持 ADR-0010 决定 3 缓上；Windows Electron 宿主 runtimeVersion 可能仍降级（物化布局 farm=0，stale 无判定对象，实际影响为零，如实记录）。
- **farmChecked 语义修订**：「0=遍历空转」判定仅适用于存在符号链农场的形态；物化布局 0 为常态（ADR-0011）。
- **验证**：新增 7 例（desktop 路由/标注/他命令拒绝/非法值/空提示/正常不提示/method 钉子），更新 1 例旧拒绝样本；全量 1085 pass / 0 fail / 0 skipped；typecheck 零错误。Windows 外机验收清单见实施计划（本机无法执行 Windows E2E）。

### 0.9.30 变更：修复 bin 符号链接静默 no-op（F2）+ 版本解析 realpath 第三源（F1）

- **根因同源**：pnpm 生态里两类关键入口都是**符号链接**——`node_modules/.bin/dshm`（指向 lib/cli.js）与全局 shim `PNPM_HOME/dsh`（指向真实 bin.js）——而两处代码都在 realpath 之前做了路径身份判定。
- **F2（自 v0.2.0 bin 入口引入以来潜在，本机 0.9.28 装机形态首次踩中并实证；🔴 bin 入口全命令静默 exit 0）**：cli.ts `invokedDirectly` 比较 `argv[1]`（链接路径）与 `import.meta.url`（node realpath 后的真实路径）永假，`dshm <任何命令>` 无输出直接退出。修复：比较前对 `argv[1]` 同样 realpath。新增 `tests/cli-bin-symlink.test.mjs`（经符号链接调用 --help 与 doctor --json 的复活验证，EPERM 环境照仓内先例 skip）。
- **F1（0.9.29 装机验收实证）**：dsh-version.ts `readLauncherPackageVersion` 从 shim 位置直接向上三级找 package.json，落在 pnpm home 目录树上空走——宿主内纯 FS 版本解析在本机拓扑（`node PNPM_HOME/dsh web`）不可得，doctor 的 stale 判定降级、ping chip 被迫吃 spawn 回退。修复：判定 entry 形态后先 realpath 再上溯（本机实测解析得 0.2.0-rc.2）。新增 dsh-version.test.mjs shim 形态用例。
- **验证**：专项 9/9（含两新用例）；全量 1079 pass / 0 fail / 0 skipped；typecheck 零错误。装机后预期：`dshm doctor`（bin 入口）可用；宿主 method 通路 runtimeVersion=0.2.0-rc.2、stale 判定复活（装机时农场 dsh 链接 0.1.7-rc.2 为现成 stale 形态，heal 后归零）。**装机实测（2026-10-04）**：预期逐项兑现——`.bin/dshm doctor` 经符号链接复活出报告；宿主 method `runtimeVersion=0.2.0-rc.2 / stale=1（dsh→0.1.7-rc.2 现场点名）`；同日按 know-how 014 heal 该链接并清理 20 项残留后，双通路终验 `farm 236 / dangling 0 / stale 0 / residue 0 / errors 0`。

### 0.9.29 变更：profile 体检 Doctor——`dshm doctor` 上线（只读：农场测活 / 残留物清点 / 账实一致）

- **动机**：dsh-m 至今没有诊断能力——know-how 014 的「每次 DSH 升级后重跑农场测活」是唯一现役周期必查项（曾 81 条悬空、230 行手工映射留档），know-how 023 实录「账实分裂」形态；本机实扫另发现 8 个空 scope 目录 + 12 个 `*.bak-*` 累积。学 dsh-market check.ts 的设计纪律（纯 FS 边界、三级严重度、unknown≠broken、误报记账、修复责任外移）落地 Day1 子集，选点裁决与对比详见 ADR-0010 与对比报告（2026-10-04）。
- **新增**：`src/core/doctor.ts` 纯函数核心（无进程/无网络/无写入，任意时刻可安全调用）+ `/dshm` 新 method `doctor` + CLI `dshm doctor [--json]`（error 级发现 exit 1；HELP 同步）。三项检查：**农场测活**（`@deepseek-ai/*` 符号链祖先链遍历；悬空=error；dsh 伞包指向旧运行时 store=提示级——lockstep 店内非伞包版本不与 runtimeVersion 比较，防 cordis 等误报）、**残留物清点**（空 scope / 无 manifest 目录 / pnpm `*_tmp_*` / `*.bak-*`，全部零告警清单，「可见而非清理」）、**账实一致**（pin/实装/lock 三处核对，不一致=warning；lockfile 仅认 9.0 importers 形状，其余 unknown 不猜）。
- **边界纪律（ADR-0010）**：runtimeVersion 仅用 `readLauncherPackageVersion` 纯 FS 通路（CLI 进程下为 null → stale 判定整体降级 unknown，绝不 spawn）；密钥红线只禁含密钥**配置文件**内容（包元数据 version 字段可读）；布局判定 workspace 声明优先（本机「hoisted 声明 + 仅 lock.yaml 的残留 .pnpm」并存形态实证）；双市场并存（dsh-m+dshmarket 同装）信息级呈现；doctor 永不修复，建议以文字给出。
- **验收结算（2026-10-04 装机实测）**：farmChecked=236（精确命中评审实测值）/ 悬空 0 / 8 空 scope + 12 bak 入清单 / 账实 13:0 / 双市场信息级 / errors=0 → exit=0 / `--json` 可解析。宿主 method 信封正确但 runtimeVersion=null——**发版日新发现**：本机宿主经 pnpm 全局 shim 启动（`node ~/.local/share/pnpm/dsh web`），`readLauncherPackageVersion` 从 shim 三级上溯落空，stale 判定双通路降级（底层事实人工核对成立：农场 dsh 链接 0.1.7-rc.2 vs 运行时 0.2.0-rc.2；版本第三源列下一批）。另录既有 bug：`.bin/dshm` 符号链接静默 no-op（后经考古为 v0.2.0 起潜在、本机 0.9.28 装机形态首次踩中，见 0.9.30 条目——`invokedDirectly` 比较 symlink 路径与 realpath 永假，bin 入口全命令静默 exit 0；修复列 0.9.30 候选，期间用 `node …/dsh-m/lib/cli.js` 直达）。
- **验证**：新增 `tests/doctor.test.mjs`（36 例：布局冲突并存/祖先链反空转/两级 targetVersion/降级路径/零告警清单/023 形态/link 协议/lock peer 后缀/CLI 子进程）+ `tests/doctor-api.test.mjs`（2 例：method 信封真跑 + 空 profile）；全量 1076 pass / 0 fail / 0 skipped。

### 0.9.28 变更：页大小档位去上游化——32/64/96 取代 24/48/96，默认 32

- **动机**：24/48/96 是复刻 dsh-market 筛选面板（0.7.2）时带过来的上游血统数字。甄别后发现 96 早已被 dsh-m 内化为核心参数（`WITH_LATEST_MAX` 探测上限、精选区默认页、fast-open 快照判定基准），真正的上游痕迹只有 24——「砍 24、保 96」即去上游化与兼容性的交集。
- **新档位**：`MARKET_PAGE_SIZES = [32, 64, 96]`（等差 +32，读序顺）、社区区默认 `DEFAULT_PAGE_SIZE = 32`（首页更满，仍低于 0.6.x 历史默认 50 的探测负载，Q46 预算姿态不变）；精选区默认 96 与 core clamp 1..96 不动。
- **联动**：host-api GUI 通道兜底默认 24 → 32（三端一致，不留暗默认）；探测预算注释同步（market.ts / host-api.ts）；README×2 与 DESIGN.md 措辞同步；GLOSSARY「精选区」词条按代码实态锐化（单页无分页 → 常态单页直出 + 超限降级分页）；测试断言与快照 fixture 同步（偏离档位断言改用组内值 64，覆盖「档位内但非默认仍拒写/判假」）。
- **已知一次性影响**：升级后社区区旧快照（limit=24）不再命中 fast-open 判定，首次打开市场多一次正常请求，快照按新默认重建后自愈；不加 legacy 兼容分支。
- **验证**：`npm run build` 成功；全量 1030 pass / 0 fail（8 skipped）。

### 0.9.27 变更：修复遮罩拖选误关——面板内按下、拖出释放不再关面板

- **问题（装机实测 2026-10-03）**：在市场搜索框内左键按下向左拖选（越过面板边界）释放，整个面板被关闭。非浏览器鼠标手势——面板遮罩是裸 `onClick: onClose`，而在面板内容里按下、拖到遮罩上释放时，浏览器把 `click` 派发到按下/释放目标的公共祖先（恰是遮罩），被误判为「点遮罩关面板」。详情 Modal、截图灯箱、兼容确认弹层同属该缺陷类。
- **修复**：新增纯函数 `backdropCloseHandlers`（src/client/backdrop.js）——仅当 **mousedown 与 click 都落在遮罩自身**时才关闭（其余组合一律不关，click 后按位状态复位）；四处遮罩（主面板/详情/灯箱/兼容弹层）统一切换。点遮罩关闭、Esc 关闭、✕ 按钮行为不变。
- **验证**：新增 `tests/client-backdrop.test.mjs`（关闭/两类拖选不关/状态复位/畸形输入安全，5 组断言）；全量 1030 pass / 0 fail。

### 0.9.26 变更：跨区搜索精选稳定前置——摘要行计数与首页所见一致

- **问题（装机实测 2026-10-03）**：搜索「sidebar」摘要行报「⭐ 精选 3 · 社区 315」，首页精选段只见 1 条。非重复计算——`sourceCounts` 不读分类计数（`alsoCategories` 无涉），3 条为真实精选命中；错位根因是摘要行报全局命中数，而相关性排序叠加社区区默认 downloads 降序 tie-break 把弱命中精选压进后页。
- **修复**：`listMarket` 新增 `curatedFirst`——`source='all'` 且 query 非空时精选命中**稳定前置**（稳定分区，分区内相关序不变，社区命中随后）；仅 host-api GUI 通道携带，tools/CLI 不传，搜索排序三端同序不变；单分区/浏览态天然无效。跨页精选段头悬空与计数错位随之消失（精选命中 ≤ 页大小时全数落在首页段内）。
- **验证**：新增测试 ⑮（无 flag 保持交织相关序 / 带 flag 精选前置 / 空 query 与单分区无效）；全量 1025 pass / 0 fail。

### 0.9.25 变更：跨区搜索——浏览分区、搜索全局（社区 + 精选一并命中）

- **跨区搜索**：任一分区（社区/精选）的搜索框升级为全局——`query` 非空时底层查询切 `source=all`，两分区条目统一相关性排序；清空关键词回到本区浏览态。分区制浏览（ADR-0004）与 `dshm_search`/CLI 三端同序不动；服务端唯一增量是 `MarketResult.sourceCounts` 分桶计数。
- **搜索态呈现**：摘要行「⭐ 精选 N · 社区 M」精确计数（`!loading` 门控防旧数字闪现）；精选命中页内置顶分组（段头各自仅在对应段非空时渲染，跨两列 grid）；非社区卡补「精选」徽章；分类 chips 搜索态隐藏、「筛选」按钮随摘要行保留（搜索态只剩页大小组，排序被相关性优先覆盖）；翻页回顶锚点随态切换。
- **修复**：分区 tab 计数改从恒定字段推导（社区 = `acceptedCount - displaced`、精选 = `registryState.count`），不再随查询变化（此前读「最近一次查询的 total」，跨区搜索会污染计数）；搜索提交时清空激活分类（chips 已隐藏，残留分类会成为不可见过滤）。
- **降级**：`sourceCounts` 缺失/畸形时摘要行整体不渲染，列表行为不变；旧快照/旧宿主响应形状漂移免疫。

### 0.9.24 变更：排除条目代管——供应链等待期从「提前拒绝」到「治理 + 登记」（ADR-0009）

- **问题（实机 2026-10-03 实证）**：0.9.19 的委派前预检把「目标版本未满 24h 等待期」预测成"官方管理器必拦"并提前拒绝——同目标 dsh-market 却能装上（copilot-auth@1.2.4 发布 8 分钟、quota-watch@0.1.21 两例）。pnpm 11.7 默认非严格策略对显式点名的新版本本来就放行并自动登记排除条目，预检的墙并不存在。
- **三挂点代管**：① 委派前治理——desktop profile 排除块的坏形态（pnpm 自追加的死规则）合并为"每包一条、版本并集复合"；② 装机成功后登记——等待期内目标并入排除块（scoped 精确单条 / 非 scoped 目标+上一版双选择器）；③ 双码失败（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` / `ERR_PNPM_NO_MATURE_MATCHING_VERSION`）→ 治理 → 至多重试一次，仍败走既有失败翻译与账实分裂复读。web ladder 同套三挂点。
- **边界与安全**：红线收窄出唯一例外（desktop 仅此块、仅委派前后挂点、原子写、解析失败即弃、留痕不落全文）；治理/登记全程持官方同款锁并 fail-open——任何失败不阻塞委派，pnpm 仍是最终执行者；显式设置 age 或 strict 的 profile 仍前置拒绝并给可重试时刻；机理按"首条规则生效"口径改判（know-how 020 §2.4 形态论退役）。
- **文档**：决策全文 `docs/adr/0009-release-age-exclude-governance.md`（含 9 项评估过不做的栅栏附录与观察预案）；GLOSSARY 新词「首条规则/排除条目/治理/登记/等待期」。

### 0.9.23 变更：已装页两段加载——列表秒开 + 更新提示就地补 ⬆（ADR-0008）

- **问题（实机 2026-10-03 实证）**：更新探测焊在已装列表接口里且带 60min 内存 TTL——发版后重开面板吃到陈旧缓存，升级提示迟迟不出现（quota-watch 新版发布 17 分钟后面板仍无提示，dshmarket 同刻已见）。
- **两段并行（零新增按钮）**：第一段 `installed {probe:false}` 立即返回已装列表（registry 匹配与开关相位不受影响）；第二段新方法 `installedUpdates`（`probeMode: 'only'`，**TTL=0 每次挂载真实探测**）完成后把 ⬆ 徽标 / tab 红点 / 「全部升级 (N)」就地补上；探测失败仍逐项走「检查未完成」，不冒充「没得更新」。
- **边界与副作用（ADR-0008 如实留痕）**：范围仅已装页——市场浏览页探测、`dshm_list`/`dshm_outdated` 工具、CLI 行为不变（缺省 `probeMode: 'full'`）；ttl=0 会先删 host namespace 共享缓存条目再重探，浏览页/工具的 TTL 内命中被刷新为更新值（数据只更新鲜、代码路径与自身 TTL 制度不变），GitHub 被动预算消耗速率上升（上限 25/req、50/h 滚动不变），超限走 latestError 优雅降级。
- **文档**：决策全文 `docs/adr/0008-installed-two-phase-probe.md`；DESIGN「已装页/缓存语义」补句；GLOSSARY 新词「两段加载」。

### 0.9.22 变更：升级生效判定——tarball 差异三态分类 + 三端重启提示分流（ADR-0007）

- **问题（0.9.21 实证）**：`@iasiv5/dsh-skins` 1.2.3→1.3.0 升级后未重启即已生效（客户端 bundle rev 热更），三端仍无条件提示「需要重启」——警报疲劳会侵蚀提示的权威性，重启本身也有真实成本（web 服务瞬断 / desktop 手动重开）。
- **生效判定（GLOSSARY「生效判定/纯客户端更新」）**：npm 源升级成功点拉取新旧两版 tarball（并行、总 deadline 10s、单包 8MiB、无缓存），零依赖 ustar 只读解析（支持 pax 长名）+ 逐文件 sha256 diff，分类 `activation: 'client-only' | 'restart-required' | 'unknown'`。规则五条：client 集合 = `exports['./client']` 目标；`dsh.bundle.patch` 声明的补丁目标变更 → 宿主；`package.json` 忽略顶层 version 后语义比较（dependencies 等字段变化照常算宿主）；其余差异按路径归属；client 指向变化保守判宿主。**fail-open**：一切异常 → unknown → 现状提示，绝不影响升级成功态。
- **三端分流**：agent 工具消息 client-only 明示「刷新页面即可生效，不要询问 dshm_restart」、unknown 保守建议重启；GUI toast 后缀 + `needsRestart` 门（client-only 不亮重启横幅；纯函数 `upgradeNotify` 可单测）；CLI 行文案换挡。`needsRestart` 源头放宽 boolean（TS2430 规避），`UpgradeResult`/desktop 升级结果新增 `activation` 字段；接线点 `upgradePluginLocked` + `desktopUpgradeLocked`，selfUpgrade/install/uninstall/github 源维持现状。
- **测试与文档**：新增 ustar 解析 11 例、分类规则+fail-open 18 例、升级接线 7 例（npm/github/selfUpgrade/desktop）、renderUpgrade 4 例、upgradeNotify 3 例；既有升级替身统一补 `classifyActivation` 缝（防隐式出网）。决策与已知局限全文见 `docs/adr/0007-activation-classification.md`（client chunk require 图不追踪；docs 类随版差异保守判宿主侧）。

### 0.9.21 变更：设置页「强制刷新」显示连带修复 + registry.json 变更自动清 jsDelivr 缓存

- **设置页强刷显示修复（实机 2026-10-03 实证）**：设置页「强制刷新」只重载 `registry` 接口（force 同步强刷全链路），但面板展示的 registryState **优先读 `registry-config` 的挂载时快照**——于是出现「toast 报已强制刷新、生效来源/更新时间/条目数纹丝不动」的假死，重开设置页才对齐。现在强刷成功后连带重载 `registry-config`（force 已更新 controller 内存快照，零成本取新值），显示即时跟随生效数据。
- **jsDelivr 自动清缓存（`registry.yml` 新增 `purge-jsdelivr` job）**：默认链「线路粘性 + CDN 恒 200 即成功」会让 jsDelivr 的滞后快照**无限钉死**精选清单——实证：0.9.18 收录 DSH Market（18→19）后，粘性在 jsDelivr 的本机持续拉回 18 条旧版，raw 主线路永远轮不到，用户侧强制刷新也无解（唯有手动 `purge.jsdelivr.net`）。现在 push 到 main 且 `registry.json` 实际变更时（`github.event.before` diff 判定），`validate` 全绿后自动调 purge 接口清缓存并回读 cdn 验证条目数，结果写入 step summary；registry.json 未变的 push 与 PR 全部跳过。

### 0.9.20 变更：latest 探测缓存退回纯内存（重启即失效）+ mutation 定向失效（ADR-0006）

- **事故复盘落地（2026-10-03 凌晨）**：0.9.14 起 latest 探测缓存 write-through 落盘、跨重启存活，失效通道只有 TTL 一条——00:22:58 缓存写入后，00:27–01:05 连发四版、01:07 重启 DSH、01:13 重开面板全部吃到陈旧值，卡片与 `dshm_outdated` 双双误报「已是最新」。本次推翻该设计，决策与取舍全文见 `docs/adr/0006-latest-cache-memory-only.md`。
- **缓存退回纯内存**：latest 探测结果只存内存 Map + TTL（`cacheTtlMin`，默认 60 分钟），**重启即失效**——「发完版重启一下就能看到」重新成立。代价是重启后首轮受限重探（当前页条目、8 并发 + deadline 兜底，TTL 内只付一次）；registry/社区**目录正文**的落盘缓存与 SWR 不受影响，页面骨架照旧秒开。0.9.14 遗留的 `<cacheRoot>/latest/<ns>.json` 惰性文件由探测段一次性 best-effort 清扫。
- **mutation 定向失效**：install/upgrade/uninstall 事务**成功点**按 itemId 作废该条目全部 registryKey 缓存变体（浏览页键 / 已装页 matched 键 / npm-only 键）——升级后卡片不再出现「已装新版 / 最新旧版」自相矛盾；`dshm_outdated` 对刚升级包诚实。只失效不回写（故意装旧版时回写会伪造 latest=已装）；事务回滚路径零失效；卸载对 github 源条目的 `gh:` 键尽力而为（pkg 名不可逆推 repo，交由 TTL 自然过期）。
- **不做项留痕**：force 穿透探测缓存与浏览页 GitHub 预算对齐经主人拍板暂缓——前者残余盲区仅「不重启 + TTL 内」窗口，后者对现行全 npm 源精选清单收益为零（ADR-0006 §Considered Options）。

### 0.9.19 变更：供应链等待期「锁文件校验」实证修复——委派前预检 + 全量违规解析 + 账实分裂明示

- **根因（本机 2026-10-03 00:15 实证）**：pnpm 11.7 对 desktop profile 做**锁文件级**供应链校验（`Verifying lockfile against supply-chain policies (180 entries)`），而它给每次成功安装自动追加的 `minimumReleaseAgeExclude` **非 scoped 独立精确条目不被这次校验认可**（`dsh-m@0.9.18` 即被拒；scoped 的 `'@iasiv5/dsh-quota-watch@0.1.13'` 则认可）——装过一个「太新」版本后，**等待期内任何官方包操作都会被这个旁包条目拦死**，与本次目标无关；且校验失败前目标包已被写入 node_modules、官方管理器只回滚 manifest/lockfile → 界面显示新版 active、操作记录却是失败（**「账实分裂」**），下次包操作还会把插件静默回退。
- **委派前预检（`releaseAgePrecheck`，只读、零文件级红线不破、fail-open）**：npm 源安装/升级在委派官方管理器前，对目标版本与锁内「不被校验认可的独立精确排除条目」逐个核对 registry 发布时刻，任一未满等待期 → 结构化 `release-age-wait` 拒绝（含各自可重试时刻），不再产生半写状态；发布时刻不可得 / 策略不可读 / 命中有效排除条目（包名级、`||` 复合、scoped 独立精确）→ 放行，pnpm 仍是最终执行者。
- **失败翻译换新（替代 0.9.10 单条解析）**：解析全部违规条目，按「本次目标 vs 锁内旁包」分述发布时刻与可重试时刻——旁包连坐不再被冒充成目标被拦；移除「改用 DSH Web 安装」的失配指引。`DesktopOpsError` 新增结构化 `details`（violations/targetViolating/splitState/blockers）。
- **账实分裂复读**：等待期失败后复读实装状态，node_modules 已是目标版本而 manifest 仍旧版时，在错误信息中明示「下次包操作会回退到旧版，等待期满重新升级即可对齐」。
- **接线**：desktop install / self-upgrade 调用点补穿 `profileDir`（升级路径此前已有）。

### 0.9.18 变更：精选收录 DSH Market + README 重构与变更日志外迁

- **新收录 DSH Market**（npm `dshmarket`，精选 18→19）：三方可视化插件市场——浏览、搜索社区插件并一键安装，主题一键热切换；主桶装机必备、次桶崔添翼精选（`alsoCategories` 次级归属）。文案按收录规范三句式，三方条目不设 `verified`。
- **文档面重构**：README/README.en 重写为精简结构（亮点、TOC、环境要求、文档索引、支持矩阵 FAQ），推荐安装路径改为 DSH 官方插件管理界面（附截图与升级限制提示）；本变更日志自 README 外迁（双语维护）；Desktop FAQ 对齐 0.9.8 后能力面；DESIGN §3/§12 补实机核验与实测代际记录。
- **附带**：registry 守卫测试条数 18→19；`package.json` files 新增 CHANGELOG.md 随包发布。

### 0.9.17 变更：策展桶次级归属（一插件跨桶）+「iasi自研」更名

- **次级归属 `alsoCategories`**：收录条目可声明次级策展桶——chips 计数与桶过滤按「主桶 ∪ 次桶」计（跨桶条目在每个桶里都出现），详情页分类标签仍随主桶。首批双席位：**better-sidebar**（装机必备 ⊕ 崔添翼精选）、**dsh-m**（装机必备 ⊕ iasi自研）；better-sidebar 原第 5 个「崔添翼精选」tag 由真实席位取代（tags 回归 ≤4 软规范）。
- **更名**：策展桶「我的自研」→「**iasi自研**」（slug `self-dev` 不变，chips/工具/CLI/详情标签四端同步）。
- **例行过渡**：schema 加字段后旧客户端校验拒收新 registry → 回落缓存/包内快照显示旧数据，升级即愈。

### 0.9.16 变更：精选策展五桶分类法 + 严筛收录（23→19）+ 新收录 DSH TUI

- **策展分类法**：精选区分类从功能五分类（市场/工具/界面/搜索/其他）改为**策展五桶**——装机必备 / 崔添翼精选 / iasi自研 / 腾讯轻量云专区 / 观察区（chips 按此序，腾讯轻量云垫后）。分类语义从「插件是什么」转为「为什么值得进精选」；重叠归属按 装机必备 > 崔添翼精选 > 自研 > 腾讯轻量云 优先级归桶，功能属性转 tags 保留检索，旧分类值仍可作开放 slug 命中自定义源（ADR-0004 修订）。
- **严筛收录 23→19**：通道五件套（lark/qqbot/weixin/wecom/dingtalk）退出精选——社区层（4,000+ 条）仍收录可装，只是退出策展位；新增收录 **DSH TUI**（崔添翼 9/26 X 推荐：终端 TUI 客户端，`dsh-tui`，走 DSH 客户端契约 ctx.remote）；better-sidebar 因优先级归装机必备，以 tag「崔添翼精选」保留 9/27 推荐出处。
- **同版本携带**（本地增强随发版收编）：desktop 安装 enable 阶段失败自动重试一次（高频装卸/插件树重载竞速实证）+ 失败文案按 packageResult 精确化；市场页「缓存快照」横幅退役——stale 状态由设置页社区卡承接，浏览页不再提示临时缓存状态。

### 0.9.15 变更：安装进度/终态就地进详情 Modal

- **场景**：从详情 Modal 点「安装」后，安装信息（pnpm 阶段进度行、「变更完成」横幅/toast）都渲染在面板底层，隔着 Modal 遮罩半透明透出——弹窗内只有按钮转圈，看不出装到哪一步（实机截图反馈 2026-10-02）。卸载无此问题：不弹 Modal，状态本来就挂在已装卡片上。
- **变更**：安装进行中，Modal 内直接挂进度行（复用 host status 轮询：阶段/进度条/当前包）；终态在 Modal 内就地显示结果行——成功附版本与构建脚本说明 + 重启提示（desktop 给官方应用生命周期指引），失败/守卫拦截附原因且按钮回到可重试，「已跳过」中性呈现；Modal 打开时底层同源进度行让位（关闭 Modal 后照常回归）。信息全部派生自全局操作记录与安装结果，「状态不挂卡片」的所有权模型不变（DESIGN §2.6）。

### 0.9.14 变更（市场秒开四件套 + 详情 Modal 安装命令显隐）

- **市场秒开四件套**：针对「每次打开市场必现『加载收录清单中…』」的加速组合拳——
  - **SWR 先回缓存**：精选清单与社区目录的 TTL 过期不再同步等网络——磁盘缓存存在即**立即返回快照**（社区侧照常显示「缓存快照」横幅，绝不冒充最新），后台单飞自愈，下次打开即新；「强制刷新」按钮语义不变（始终同步强刷，社区卡不连坐）。
  - **线路粘性**：默认双线路（GitHub 原始文件 → jsDelivr 镜像）按缓存记录的**上次成功线路**排序——镜像成功过就先走镜像，不再每次白等主线路失败（大陆网络实测每次冷打开省 10-20s 等待）。
  - **探测缓存落盘**：页条目 npm/GitHub 版本探测缓存从纯内存改为磁盘信封（`latest/`，跨重启存活）——DSH 服务重启后首次打开市场不再重放探测。
  - **客户端快照**：默认首页响应存浏览器本地（10 分钟 TTL），打开面板先渲染上次数据再后台换新——加载 spinner 仅首次使用（无任何快照）出现。
- **详情 Modal「安装命令」折叠行按上下文显隐**：
  - **场景**：折叠行命令推导写死 `dsh plugin --profile web add …`，社区条目的上游 install 原文也同为 --profile web 语义——两个来源都不看当前宿主 profile。desktop 上下文里照抄会把包装进 web profile（当前界面看不见）；已安装条目还挂着命令纯属噪音（实机截图实证：desktop + dsh-m 自身条目，`已安装` 徽章与命令同屏）。
  - **变更**：desktop 上下文与已安装条目**整行隐藏**；web 未安装条目行为不变（CLI bootstrap 路径保留，「30 秒上手」同款命令）。desktop 装机正路是弹窗内「安装」按钮（官方 pluginManager 委派，ADR 0005 纪律）。不做「精简命令去掉 --profile」——显式 `--profile web` 是 0.9.0 拍板的设计（README「profile 目标」节），裸命令的默认 profile 语义含糊，精简反而更差。

### 0.9.13 变更：desktop 角标悬停文案更新（主人拍板）

- 旧文案「当前 DSH profile：{name}（Desktop 首发仅支持只读市场、安装新包与开关）」在 0.9.8 开放升级/卸载/自升级后已过时；按主人拍板改为「**当前生效 Profile**」（en: Active profile）。

### 0.9.12 变更：0.9.11 的重发

0.9.11 在 npmjs 遭遇幽灵发布：OIDC 发布被受理并 **staged**（CLI exit 0、provenance 已上 Transparency Log），但从未 commit 进注册表——GET 404、同版本重发 409 `Cannot publish over previously staged version`。等待自愈无果后按标准解法换号重发。**内容与 0.9.11 完全一致：设置页「强制刷新」不再连坐社区清单卡。**

### 0.9.11 修复：设置页「强制刷新」不再连坐社区清单卡（force 语义只属精选链）

- **场景**：弱网下点精选清单的「强制刷新」，社区清单卡跟着变「不可用 + 获取超时」——根因是 host 把 `force` 一路透传给社区目录 summary，强制重开获取 flight；弱网下 flight 3s 完不成，waiter 超时返回占位摘要（flight 本身在后台 30s hard cap 内继续，跑完即自愈）。
- **修复**：`registry` 的 force 不再透传社区 summary——「强制刷新」语义只属精选链（registry 链）；社区目录走自己的 TTL/共享 flight（首次打开等边界场景在极差网络下仍可能瞬时超时，但强刷不再触发）。

### 0.9.10 修复：Desktop 自升级撞上官方供应链等待期（minimumReleaseAge）→ 诚实指引发成可读

- **场景**：点升级角标走官方管理器时，desktop profile 的 pnpm 供应链策略（`minimumReleaseAge`，发布满 24h 才可安装）拒绝了刚发布的版本——`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`。**这是策略在正确工作**（防供应链攻击的发布等待期），不是故障；但 dsh-m 此前把它当普通失败甩一屏 pnpm 原文。
- **修复**：管理器结果判定识别该策略码，翻译成诚实指引——点名等待期内的条目与发布时刻、按策略推算「预计何时可重试」，并给出等待期内的替代路径（DSH Web 安装同版本）。绝不做策略绕过（等待期是防供应链攻击的红线，dsh-market #732 同态度）。
- 附带：community 获取链 ⑨ 的挂起上限断言 2s→10s（全量套件并行定时器饥饿下两次闪断；契约「不永久挂起」不变）。

### 0.9.9 修复：备用线路接住后不再弹红色「主线路失败」提示（提示收敛）

- **场景**：默认精选清单双线路（raw → jsDelivr）里主线路 `default-raw` 失败、备用线路成功接管时，设置页仍弹红色「远端提示：default-raw 失败：fetch failed…可稍后重试或检查网络后重试」——对着已经自愈的数据报警，还带着不成立的建议（大陆网络下 raw 间歇不可达是常态，这正是备用线路存在的原因）。
- **修复**：后续线路成功 = 先行失败已自愈，`errors` 不再携带（设置页「生效来源」行已如实标注当前线路，如「GitHub 镜像（备用）」）；全线路失败落 cache/bundled 时错误照常保留——那才是需要行动的信号。custom 链（自定义源失败回退缓存）行为不变，仍然提示。
- 顺带补了 default 链的测试缝（`defaultRoutes` 覆写），双线路收敛与全挂保留各有回归门。

### 0.9.8 修复：Desktop 包操作全面接通官方管理器（安装恒 no-manager；升级/卸载/自升级开放）

- **安装恒失败的根因**：Host API 的 desktop 安装分支调 `desktopInstall(id, cfg, opts)` 漏传第 4 参 deps——`getService` 根本没进适配器，desktop 安装恒报「官方 pluginManager 服务不可用（fail-closed）」（100% 必现，与时机无关）。工具面 `dshm_install` 同病。
- **服务解析与 dsh-market 同源**（借鉴其 official-desktop 接线，本机两轮覆盖安装实证）：探测改双上下文（webServer 注入回调的 hostCtx 优先）+ cordis inject 惰性拉起兜底（短超时）——官方 pluginManager 是惰性服务，未被拉起前一次性 get 恒 undefined；仍缺席才结构化拒绝（绝不文件级回退的红线不动）。
- **能力表扩充（主人裁决，借鉴 dsh-market 策略）**：desktop 的 upgrade（installBundle 覆盖安装）/ uninstall（removeBundle）/ self-upgrade（installBundle('dsh-m@latest')）全部开放——dshmarket 正是这样完成 dsh-m 0.9.3→0.9.4/0.9.5 两轮升级的；判定纪律沿用（application/stage 为准、overridden 非失败、build-blocked 结构化回传 pendingBuilds、listBundles 复读不冒充成功）。restart 继续拒绝（Electron 生命周期归官方壳）。
- GUI 与工具面（dshm_install / dshm_uninstall / dshm_upgrade）三入口同批接线。

### 0.9.7 修复：Desktop 下点升级角标弹红色「升级失败」（能力表拒绝应为指导而非报错）

- **根因**：0.9.1 的升级角标点击后一律调 `self-upgrade`；Desktop 能力表按设计 409 结构化拒绝，但客户端把 409 当普通失败渲染成红色「升级失败」横幅——按能力表这根本不是失败，是「该走官方入口」的指引。
- **修复**：`api()` 透传能力表拒绝的结构化字段（code/action/profile/guidance），角标点击收到 409 时改出**中性 info 横幅**展示官方入口指引（guidance 单一事实源仍在服务端 `active-profile.ts`，客户端零复制）；info 横幅停留 12s。Web 端真实失败仍走红色 err 横幅，行为不变。

### 0.9.6 修复：「清除已完成」对失败记录无声 no-op

- **根因**：0.7.0 评审共识把「失败/已跳过」排除在清除范围外（保留供回看），于是按钮对着一条失败记录点击毫无反应、也无任何反馈——Windows 实机被当成 bug 上报（2026-10-01）。显式点击清除不是「静默抹掉」，旧共识被推翻。
- **修复**：「清除已结束」（原「清除已完成」）现在清除**全部终态**（done/warned/failed/superseded），在途态（queued/running/input）不受影响；没有可清终态时按钮置灰并带说明 tooltip，不再无声 no-op。单条 ✕ 照旧逐条删除。
- **英文文案**同步改为 "Clear ended"。

### 0.9.5 修复：Desktop 下 GUI 读路径漏接 active profile（已装页恒显 web）

- **根因**：0.9.0 双 profile 接线时，Host API 的 `installed` / `market` 两个读路径漏传 active profile——`listInstalledWithMeta` / `listMarket` 内部落回 `webProfileDir()`：Desktop 下已装页恒显「web profile 尚未安装任何插件」、市场「已安装」徽标恒空（agent 工具面 `dshm_list` 同链路已接线，故只有 GUI 错）。
- **修复**：两处补齐 `profileDir: profile.dir` + `profile: profile.name`（与 tools 面同款，profileContext 单一事实源）；registry/社区缓存随 `profile` 参数自动落到 desktop 段。
- **文案**：已装空态/加载态与 profile 提示里的「web profile」硬编码改为 profile 中性表述（实际路径照旧展示）。

### 0.9.4 修复：Windows Desktop 全屏后头部不可点（tab / 还原键被系统标题栏吞掉）

- **根因**：Desktop（Windows）以 `titleBarStyle:hidden + titleBarOverlay` 运行——窗口顶部 40px 是壳的全宽 `-webkit-app-region:drag` 拖拽带（按布局参与拖拽判定、无视 z-index 与绘制顺序），右上角另有系统绘制的 — □ ✕ 悬浮于一切内容之上。面板全屏后头部（tab、还原/关闭键）正好落进这条带：点击被窗口拖拽吞掉、还原键被系统键遮挡，全屏无法退出。
- **修复**：与壳自家 overlay 同款对策——消费壳在 `html` 上设的 `--dsh-windows-titlebar-height` 让出该带（全屏态 `top:var(…)`；浮动态 `padding-top:max(24px,var(…))` 顺带修掉矮窗口下浮板顶边被带压住的边缘情况）。
- **Web 零漂移**：DSH Web / 浏览器无此变量，回落 0px，行为与 0.9.3 完全一致。

### 0.9.3 修复：Windows 原生适配（Windows 宿主实机回归）

- **registry 原子写**：临时文件名此前用 `split('/')` 从绝对路径取尾段，而 Windows 路径分隔符是 `\`——取到的是整条路径（内嵌 `\` 即目录分隔符），临时文件 open 必败且被吞，cache 与 accepted metadata 写入**静默全失败**；改用 `basename()`，三平台一致。
- **本地文件清单地址解析**：`C:\…` 盘符与 `\\server\share` UNC 此前被误当 URL scheme（报「只允许 HTTPS」的误导性错误），`file://C:/…` 会归一成无盘符悬空路径必 ENOENT；现 POSIX 绝对 / Windows 盘符 / UNC 三形态均正确解析为 file kind。
- **构建**：`node_modules/.bin/tsc` 是 POSIX sh shim，Windows 下 `spawnSync ENOENT`；改用当前 Node 直跑 TypeScript 的 JS 入口，`npm run build` 三平台一致。
- **测试面**：Windows 实机全量 829 用例 41 败 → **0**（821 pass / 8 skipped）；POSIX 进程组/SIGTERM 时序、symlink 权限、平台路径断言、固定 sleep 时序假设逐项标注 skip 或平台无关化/有界轮询，测试契约不变。

### 0.9.2 修复：跨服务重启后头部角标停留旧版本

- **一键重启确认新进程后就地刷新**：boot id 确认 DSH Web 已恢复的瞬间，面板立即重取 ping——`dsh-m vX.Y.Z` 角标与 profile chip 同步到新进程数据，不再停留旧版本（0.9.1 实测：芯片升级 + 重启后仍显 v0.9.0）。
- **页面回前台时重取**：面板常开、服务在后台被外部重启的场景，`visibilitychange` 回前台即重取 ping（零轮询成本）。
- **角标版本护栏**：self-check 判定携带的版本与当前进程不符（旧进程残留判定）时一律静默，杜绝「v0.9.1 ⬆ v0.9.1」式误渲染。

### 0.9.1 新增：头部版本角标升级提示（有更新才点亮）

- **静默口径**：面板头部 `dsh-m vX.Y.Z` 角标常态维持 0.7.5 起的静态展示——已是最新、检查失败、本地 dev 版领先 npm（ahead）一律不打扰（ahead 仅在悬停 title 里提示「本地开发版」）。
- **仅 outdated 点亮**：`self-check`（npm latest vs 装机版本，只读）判定有新版本时，角标点亮为 warn 态并显示 `⬆ v<最新>`；点击即触发 `self-upgrade`（同一 mutation session + 装后守卫），成功后出「⚡ 一键重启」横幅。Desktop 下点击按能力表结构化拒绝（409，带官方生命周期指引）。
- **TTL 缓存 + 版本护栏**：检查结果在浏览器 localStorage 缓存 30 分钟，开面板不重复打 npm registry；升级重启后缓存按版本号自动作废。检查失败静默，不弹任何错误。

### 0.9.0 新增：官方 Desktop（双 profile）支持

- **同一包、两个 profile**：dsh-m 现在可装入官方 Desktop 的 `desktop` profile（`~/.dsh/profiles/desktop`），与 Web 的 `web` profile 并列；市场目录、面板与 agent 工具同一套，管理对象始终是宿主当前 profile（官方 `profileContext` 单一事实源）。
- **入口信任检查改委派官方**：`/dshm` 全部 method（含 ping 与未知 method）在读取请求体之前委派官方 `connection.requestRejection()` 判定（trustedHosts / loopback / 跨站 / `Origin: null` 语义随宿主），被拒请求零 body 消耗、零业务调用；宿主缺该能力时 fail-closed 全拒。**行为变化**：旧版自制守卫「缺 Origin 一律 403」不再存在——Desktop 桥合法剥除 Origin 的请求按官方语义放行，无凭据的健康检查探针从「一律 403」变为「按宿主信任判定」。
- **Desktop 首发能力表**：只读市场 + **安装新包**（委派官方 `pluginManager.installBundle`，完整性/锁/生效相位归官方）+ **开关**（委派官方管理器，服务缺席结构化拒绝、绝不文件级 fallback）；**升级 / 卸载 / dsh-m 自更新 / 一键重启**在 Desktop 结构化拒绝（409，带官方入口指引——官方暂无 upgrade API，重启归 Electron 生命周期）；构建脚本按官方 `pendingBuilds` 名单精确重试，绝不全量放行。
- **读模型与缓存按 profile 隔离**：市场安装标注、已装列表、README 预览只读当前 profile；registry / 社区清单 / accepted-source 缓存按 profile 分段（web 沿用旧路径，零迁移零清空）；收藏与操作记录按浏览器 origin 各自独立，Web 与 Desktop 不自动同步。
- **CLI 恒作用于 web profile**：`--profile web` 显式声明；`--profile desktop` 明确拒绝并指引官方 Desktop 插件管理页。
- **如实声明**：Desktop 实机（Win/macOS）E2E 未跑，`registry.json` verified 数组**不新增** Desktop 代际（实测后按收录纪律补录）；Desktop 下不做 dsh-m 文件级装后守卫（app.asar 打包布局探测盲区），以官方结果判定 + `listBundles` 复读替代。

### 0.8.5 修复

- **dshm_upgrade 守卫拦截假成功**：升级命中装后守卫拦截时（如 link/file 来源插件无法自动回退），文本输出误渲染为「✅ undefined 已升级（最新）」；现如实输出拦截原因、补偿终态与修复依据，与卡片标题（守卫拦截）一致。

### 0.8.4 变更：分类标签随界面语言双语化

- **社区分类**：已知 23 个分类的英文名直接取上游目录 `categories.en`，英文界面下分类 chips 与详情/收藏 Modal 的分类行显示英文；缺英文名的上游新分类回退中文，仍按原样渲染进临时组，等发版收录。中文界面不变。
- **精选分类**：五个分类 chip 改走双语字典（市场/工具/界面/搜索/其他 ⇄ Market/Tools/UI/Search/Other），与详情 Modal 口径一致。
- **实现**：summary 新增 `categoryLabelsEn`（`communityOutcome` 从上游目录派生，缺 en 的 id 不进映射，不手养第二张表），客户端按界面语言合并取值。0.8.1–0.8.3 为本地迭代号，无独立变更面，不单列。

### 0.8.0 变更：设置页重做（对齐双清单分区定位）

- **信息架构**：社区清单（from awesome-dsh-plugin）→ 精选清单（registry.json）→ dsh-m 自身 → 关于；「主清单」的 UI 可见名统一为「精选清单」。
- **社区目录开关**：新增 GUI 开关（live 生效，即时切换无确认；关闭态整卡收为一行说明）；新增 `set-community` API。
- **精选清单瘦身**：状态字段 7 行收敛为 4 行（配置地址合并、删除写死的「缓存策略」行）；「配置状态」仅异常时出现；按钮组精简为「强制刷新 / 校验并应用 / 恢复默认 / 下载默认 registry.json」，「检查条目可达性」从 GUI 移除（`registry-diagnose` API 保留）。
- **文案修正**：自定义源说明明确「整体替换主清单、仅影响『精选』区」；删除与实际不符的 TTL 写死描述（`timeoutMs`/`cacheTtlMin` 仍走 config 配置）。
- **dsh-m 自身**：本地 dev 版领先 npm 发布时改显「本地为开发版」而非误导性的旧「npm 最新」（新增 `ahead` 字段）。
- **关于**：文案对齐当前定位，新增 GitHub 仓库与问题反馈链接。

### 0.7.10 美化

- **头部三段分组**：标题与 tab 导航之间加发丝竖分隔线，「标题 | 导航 | 状态+窗口控制」边界清晰。
- **版本角标同色**：v 版本号不再用主文字亮色，与 dsh-m 名称统一为次级灰。
- **垂直节奏收敛**：窗口控制组按钮 26→28px 与 tab 按钮等高；版本角标微调至 24px 高；最大化/还原图标统一 12px；标题字重 700→600。

### 0.7.9 修复

- **分类 chips 顺序恒定**：退役「激活分类置前」的换序逻辑（此前每点一个被折叠裁掉的分类，它就会跳到首位，顺序随点击不断变化）。替换为：激活分类落在收起态裁剪区时自动展开完整分类行——「当前激活的分类始终可见」目标不变，顺序从此稳定；同一激活分类下手动收起会被尊重，换选其他被裁掉的分类或点「全部」时重置。

### 0.7.8 变更

- **修复「最大化没作用」的根因——CSS 热更自愈**：面板样式表此前只在首次注入（`#dshm-css` 存在即跳过），服务热更后旧 bundle 留下的样式表不含新类名规则（全屏/窗口控制组），导致新功能「点了没反应」、按钮裸奔成原生样式。现给注入的样式表带内容哈希（djb2）版本标记，bundle 更新后重新打开面板即自动替换旧样式，无需刷新页面。
- **窗口控制组重新配色**：去掉浮起底色，改透明底 + 发丝外框（与搜索清除钮同一配色语言），单格加宽 34→44px 防误触；关闭悬停仍为红色警示。

### 0.7.7 变更

- **移植 dsh-market 的全屏功能**：面板头部新增「最大化/还原」（连体窗口控制组设计：最大化 + 关闭等宽两格、发丝分隔线、统一 SVG 线条图标；关闭悬停红色警示）。全屏铺满视口、去圆角，状态 localStorage 记忆，Esc 关面板语义不变。
- 0.7.6 补记：版本角标去粗体、去点击复制（改静态展示）；吸顶分类行上沿镂空修复（sticky 锚点上移抵消容器 padding）；关闭/清除按钮改框线平面风。

### 0.7.5 变更

- **头部版本 chip 改显 dsh-m 自身版本**（`dsh-m v0.7.5`，点击复制；DSH 运行版本看设置页与 `dshm ping`）。
- **× 关闭/清除按钮统一重绘**：搜索清除、详情 Modal 关闭、操作记录行移除三处改用 SVG 线条图标 + 悬停浅底的专用按钮样式；搜索清除钮悬浮于输入框右缘（胶囊内对齐）。
- **修复 dsh-market 的 peer 告警**：`@deepseek-ai/dsh-tools` peer 由 `*`（semver 严格口径不匹配 rc 预发布版本）改为显式 range `^0.1.7-rc.2 || ^0.2.0-rc.1 || >=0.2.0`；未来更新的 rc 线（如 0.3.0-rc.x）需再追加。

### 0.7.4 变更

- **面板 tab 回退旧版分段按钮风格**（0.7.2 误改下划线样式，按主人要求还原圆角按钮组 + 高亮态）。
- **搜索框通长**：修复搜索容器缺 `display:flex` 导致输入框未拉伸的问题，恢复整行宽度。
- **筛选按钮与页号跳转控件重新配色**：筛选按钮改浮起面板底色 + 方角与分类 chips 区分（激活态品牌色描边）；页号输入改胶囊形细描边，「跳转」用品牌色文字钮。
- **吸顶分类行彻底不透**：背景直接使用不透明底色 token（此前的 color-mix 半透明配方在深色主题下仍会透出下方卡片文字），保留底部分隔线。

### 0.7.3 变更（含 0.7.2）

- **首页布局复刻 dsh-market**：市场页改为「分区 chips → 整宽搜索行 → 分类 chips + 行尾筛选弹层」结构；筛选弹层独立样式（方角矩形 + 前置 chevron），收纳排序字段（npm 下载量/Star 数/收录日期）、排列方向与每页条数（原排序下拉与分页器条数选择退役）。
- **收藏卡可点开详情**：修复收藏区卡片点击无响应——收藏快照字段不全，打开时按 id 从两分区内存 → market API → 快照三级解析完整条目，详情 Modal 与安装链路（含兼容确认）全量复用。
- **翻页页号跳转**：页码行新增页号输入框，输入有效页号回车或点「跳转」直达。
- **吸顶分类行毛玻璃**：滚动时吸顶的分类行加 backdrop blur 与底部分隔线，下方卡片文字不再透出干扰。
- **按需求移除**：「发现社区/申请收录」行（dsh-m 不支持收录功能）、「任务」按钮（操作记录面板恢复常驻）、「刷新」按钮（强制刷新在设置页）。
- 说明：收录条目不携带宿主版本要求字段，dsh-market 的「宿主版本」筛选项无数据源，未复刻。

### 0.7.1 修复

- **社区条目可安装**：修复 0.7.0 回归——社区区里的条目点安装报「registry 中没有该条目」（安装按收录 id 只查主清单，未查社区目录）；现与升级路径同构，主清单 miss 时按 id 查社区目录再装。
- **市场页第一行紧凑化**：搜索框、刷新、排序（社区区）并入分区 chips 行右侧；信息性来源横幅（「官方默认收录清单 / 自定义收录清单 / 来源为本地缓存」）退役——其「共 {count} 条」计数从未接线（恒显 0）；错误态「收录清单不可用」与社区兜底/陈旧提示保留。

### 0.7.0 新增

- **分区制市场**（[ADR-0004](./docs/adr/0004-zoned-market-display.md)）：数据层双清单合并不变，展示层按「社区（默认）/ 精选 / 收藏」三分区呈现；`dshm_search` 与 `dshm search` 改用 `--source community|primary|all` + `--offset` 真翻页（默认 10 条），`primary_only` 退役。
- **搜索相关性**：NFKC 归一化 + 中西文边界 + 字段加权（name/npm > owner > 描述 > 分类 > tags），多词同字段全命中；id 整串精确匹配最高优先。
- **操作记录 + 恢复执行器**、**本地收藏 + 下架清理**、**详情 Modal + 截图灯箱**、社区卡 byline/deprecated 徽章/目录版本快照兜底（不参与 outdated 判定）。

### 0.4.0 新增

- **开关（Enablement Toggle）**：已装卡片一键启停，内部自动路由行覆盖（单行插件，即时生效）或 Bundle 选择（多行插件）；写路径委派官方 `pluginManager` 服务、缺席时降级 loader 直操作（[ADR-0001](./docs/adr/0001-delegate-with-fallback-for-plugin-manager.md)）。
- **运行相位徽标**：loader fiber 状态投影，failed 一眼可见。
- **保护名单**：`dsh-m` 自身与官方宿主命脉 16 项不可开关、不可卸载（升级不受影响）。
- **精确构建放行**：needs-builds 拦截后按 pnpm 待决名单逐键放行，全量放行降为兜底并如实标注（[ADR-0002](./docs/adr/0002-precise-build-approval.md)）。
- **peer 兼容预检**：安装/升级前校验 `@deepseek-ai/dsh(-*)` peers 与运行时版本（GitHub 源明示未检）；不兼容时 GUI 弹确认、agent 回结构化结果、CLI `--force`。
- **实测版本清单（verified）**：registry 条目可选 `verified` 数组记录实测过的 DSH 运行时版本——实测声明而非预测声明，只展示不拦截。
- **bundle 身份验证**：装后检测无补丁层的包并警告「已装入为纯依赖」。

### 0.4.x 退役

- **元数据源竞速**：0.4.0 曾引入 npmjs / npmmirror ping 竞速选择元数据读取源，现整体移除（含 `probeEnabled` / `probeTimeoutMs` / `probeCacheTtlMin` 三个设置项与设置页展示）。官方同款探测只服务于「安装对话框 registry 默认预选」，dsh-m 无此交互；实测宿主机 npmjs 稳定更快，探测恒等默认行为。元数据读取固定走 npmjs，与安装链路（profile `.npmrc` 默认源）一致。

---

## English

### Added in 0.9.31 — doctor desktop profile support (CLI exception + farmChecked semantics revision, ADR-0011)

- **Motivation**: a Windows desktop machine's report confirmed the core engine is profileDir-parameterized with no web hardcoding (materialized desktop layout detects as hoisted with farm=0 — the norm, not a short-circuit), yet the CLI's blanket `--profile desktop` rejection swept up the read-only doctor; desktop-only machines scanning a nonexistent web dir got an all-zero report.
- **CLI exception (doctor only)**: `dshm doctor --profile desktop` is allowed and routed to `desktopProfileDir()`, with a `[web|desktop]` tag on the first output line; HELP synced; **every other command's rejection of `--profile desktop` stays byte-identical** (pinned by regression tests) — desktop mutation management remains with the official Desktop plugin page.
- **Missing-dir hint**: when the target profile dir does not exist, suggest `--profile desktop` (an existing-but-empty legit profile is not flagged).
- **Host method untouched**: the doctor case was already active-profile agnostic — desktop hosts get it for free (new desktop-kind injection pin test); the `dshm_doctor` MCP tool stays deferred per ADR-0010 decision 3; on Windows Electron hosts runtimeVersion may still degrade (materialized layout means farm=0, so stale has nothing to judge — zero practical impact, recorded honestly).
- **farmCount semantics revision**: "0 = walk short-circuited" applies only to shapes with a symlink farm; 0 is the norm for materialized layouts (ADR-0011).
- **Verification**: 7 new cases + 1 updated legacy rejection sample; full suite 1085 pass / 0 fail / 0 skipped; typecheck clean. The Windows on-machine acceptance checklist ships with the implementation plan (no Windows E2E possible on this machine).

### Fixed in 0.9.30 — bin symlink silent no-op (F2) + realpath third source for version resolution (F1)

- **Shared root cause**: two critical pnpm-ecosystem entry points are **symlinks** — `node_modules/.bin/dshm` (→ lib/cli.js) and the global shim `PNPM_HOME/dsh` (→ the real bin.js) — while both code sites made path-identity decisions before realpath.
- **F2 (latent since the bin entry shipped in v0.2.0; first hit and proven on this machine's 0.9.28 install shape; 🔴 every command via the bin entry silently exits 0)**: cli.ts `invokedDirectly` compared `argv[1]` (link path) against `import.meta.url` (node's realpath) — never equal, so `dshm <any command>` printed nothing and exited. Fix: realpath `argv[1]` before comparing. New `tests/cli-bin-symlink.test.mjs` (revival via symlinked --help and doctor --json; EPERM environments skip per repo precedent).
- **F1 (proven at 0.9.29 install acceptance)**: dsh-version.ts `readLauncherPackageVersion` walked up three levels from the shim location, landing in the pnpm home tree — pure-FS version resolution was unreachable under this host topology (`node PNPM_HOME/dsh web`), degrading doctor's stale judgment and forcing the ping chip onto the spawn fallback. Fix: realpath the entry after the shape check, then walk (locally verified resolving 0.2.0-rc.2). New shim-shape case in dsh-version.test.mjs.
- **Verification**: targeted 9/9 (two new cases); full suite 1079 pass / 0 fail / 0 skipped; typecheck clean. Post-install expectations: `dshm doctor` works via the bin entry; host method path reports runtimeVersion=0.2.0-rc.2 with stale judgment live (the farm's dsh link at 0.1.7-rc.2 is a ready-made stale form until healed).

### Added in 0.9.29 — profile Doctor: `dshm doctor` (read-only: farm liveness / residue inventory / manifest-reality consistency)

- **Motivation**: dsh-m had no diagnostics at all — know-how 014's "re-run farm liveness after every DSH upgrade" was the only standing periodic check (81 dangling links and a 230-line manual heal log), know-how 023 documented the manifest-reality split, and a live scan found 8 empty scope dirs + 12 `*.bak-*` files. Day1 subset adopting dsh-market check.ts's design disciplines (pure-FS boundary, three-tier severity, unknown≠broken, false-positive bookkeeping, repair responsibility shifted outward). See ADR-0010 and the comparison report (2026-10-04).
- **Added**: `src/core/doctor.ts` pure-function core (no processes, no network, no writes — safe to call any time) + new `/dshm` method `doctor` + CLI `dshm doctor [--json]` (exit 1 on error-tier findings; HELP synced). Three checks: **farm liveness** (ancestor-chain walk over `@deepseek-ai/*` symlinks; dangling = error; dsh umbrella pointing at an old runtime store = info-tier — non-umbrella versions are never compared against the runtime version, avoiding cordis-style false positives), **residue inventory** (empty scope dirs / no-manifest dirs / pnpm `*_tmp_*` / `*.bak-*`, all zero-alarm lists, "visible rather than cleaned"), **manifest-reality consistency** (pin vs installed vs lockfile; mismatch = warning; only lockfileVersion 9.0 importers shape is parsed, anything else stays unknown).
- **Boundary disciplines (ADR-0010)**: runtimeVersion comes only from the pure-FS `readLauncherPackageVersion` (null under the CLI → stale judgment degrades to unknown, never spawns); the secrets red line covers credential-bearing config files only (package metadata version fields are readable); layout detection is workspace-declaration-first (proven on the local "hoisted declaration + vestigial lock.yaml-only .pnpm" shape); dual-market coexistence (dsh-m + dshmarket installed together) surfaces as an informational fact; doctor never repairs — advice is text only.
- **Acceptance anchors (to verify after install)**: first local run expects farmChecked ≈236 (0 means the walk short-circuited), 0 dangling, 8 empty scopes + 12 bak files listed, dual market flagged.
- **Verification**: new `tests/doctor.test.mjs` (36 cases) + `tests/doctor-api.test.mjs` (2 cases); full suite 1076 pass / 0 fail / 0 skipped.

### Changed in 0.9.28 — page-size set de-upstreamed: 32/64/96 replaces 24/48/96, default 32

- **Motivation**: 24/48/96 came bundled with the dsh-market filter-panel replica (0.7.2). On inspection, 96 has long been internalized as a dsh-m core parameter (`WITH_LATEST_MAX` probe cap, primary-zone default page, fast-open snapshot baseline); the only real upstream trace is 24 — "drop 24, keep 96" is exactly the intersection of de-upstreaming and compatibility.
- **New set**: `MARKET_PAGE_SIZES = [32, 64, 96]` (arithmetic +32), community default `DEFAULT_PAGE_SIZE = 32` (fuller first page, still below the 0.6.x default of 50 in probe load; Q46 posture unchanged); primary default 96 and the core clamp 1..96 untouched.
- **Ripple**: host-api GUI fallback default 24 → 32 (three ends consistent, no hidden default); probe-budget comments updated (market.ts / host-api.ts); README×2 and DESIGN.md wording synced; GLOSSARY "Primary Zone" entry sharpened to match the code (single-page-no-pager → normally single page, degraded to the community pager beyond capacity); test assertions and snapshot fixtures synced (off-default assertions now use in-set value 64, covering "in set but not default is still rejected/false").
- **Known one-time impact**: after upgrading, a community snapshot with limit=24 no longer matches the fast-open check — the first market open makes one extra normal request, then the snapshot rebuilds on the new default; no legacy-compat branch added.
- **Verification**: `npm run build` clean; full suite 1030 pass / 0 fail (8 skipped).

### Changed in 0.9.27 — fix accidental drag-out close: press inside, release on backdrop no longer closes the panel

- **Problem (observed on install, 2026-10-03)**: pressing inside the market search box and dragging left past the panel edge closed the whole panel. Not a browser mouse gesture — the panel backdrop used a bare `onClick: onClose`; when a press inside the panel content drags onto the backdrop and releases, the browser dispatches `click` to the common ancestor of the press/release targets (the backdrop itself), misread as "clicked the backdrop". The detail modal, screenshot lightbox, and compat dialog shared the same defect class.
- **Fix**: new pure helper `backdropCloseHandlers` (src/client/backdrop.js) — close only when **both mousedown and click land on the backdrop itself** (all other combinations are ignored; the pressed state resets after each click); all four overlays (main panel/detail/lightbox/compat dialog) switched over. Backdrop-click close, Esc, and the ✕ button behave exactly as before.
- **Verification**: new `tests/client-backdrop.test.mjs` (close / two drag-out scenarios ignored / state reset / malformed input safe — 5 assertions); full suite 1030 pass / 0 fail.

### Changed in 0.9.26 — curated hits first in cross-zone search: summary counts now match page one

- **Problem (observed on install, 2026-10-03)**: searching "sidebar" showed "⭐ Curated 3 · Community 315" but only one curated card on the first page. Not double counting — `sourceCounts` never reads category counts (`alsoCategories` is unrelated) and all 3 were genuine curated hits. The mismatch: the summary line reports global hit counts while the relevance ranking plus the community zone's default downloads-desc tie-break pushed weakly-matching curated entries onto later pages.
- **Fix**: `listMarket` gains `curatedFirst` — with `source='all'` and a non-empty query, curated hits are stably moved to the front (stable partition; relevance order preserved within each segment, community hits follow). Carried only by the host-api GUI channel — tools/CLI don't pass it, so the shared search ordering across the three surfaces is unchanged; single-zone and browse states are naturally unaffected. Dangling cross-page section headers and the count mismatch disappear (with curated hits ≤ page size, all of them land in the first-page section).
- **Verification**: new test ⑮ (no flag keeps the interleaved relevance order / flag moves curated first / empty query and single-zone are no-ops); full suite 1025 pass / 0 fail.

### Changed in 0.9.25 — cross-zone search: browsing stays zoned, searching goes global (community + curated together)

- **Cross-zone search**: either zone's (Community/Curated) search box now searches globally — with a non-empty `query` the underlying query switches to `source=all` and both zones' entries are ranked by the shared relevance pipeline; clearing the keyword returns to the zone's own browse state. The zoned browsing model (ADR-0004) and the `dshm_search`/CLI shared ordering are untouched; the only server-side addition is the `MarketResult.sourceCounts` bucket count.
- **Search-mode presentation**: a summary line "⭐ Curated N · Community M" with exact per-zone counts (`!loading`-gated so stale numbers never flash); curated hits grouped on top within the page (section headers render only when their section is non-empty, spanning both grid columns); non-community cards gain a "Curated" badge; category chips hide during search while the Filter button moves onto the summary line (page-size group only — relevance outranks sort while searching); the pagination scroll anchor follows the mode.
- **Fixes**: zone tab counts now derive from stable fields (community = `acceptedCount - displaced`, curated = `registryState.count`) instead of "the last query's total" — cross-zone searches no longer pollute them; committing a search clears the active category (chips are hidden, so a leftover category would act as an invisible filter).
- **Degradation**: a missing/malformed `sourceCounts` hides the summary line entirely; list behavior unchanged; old snapshots/old host responses stay shape-drift immune.

### Changed in 0.9.24 — release-age exclusion governance: from pre-flight refusal to govern + register (ADR-0009)

- **Problem (observed live 2026-10-03)**: the 0.9.19 pre-flight precheck predicted "the official manager will block a target inside the 24h release-age window" and refused up front — while dsh-market installed the very same targets (copilot-auth@1.2.4 published 8 minutes prior; quota-watch@0.1.21). pnpm 11.7's default non-strict policy admits explicitly named fresh releases and auto-registers their exclusion entries; the wall the precheck predicted did not exist.
- **Three governance hooks**: (1) pre-delegation govern — merge malformed exclusion shapes (pnpm's auto-appended dead rules) into "one rule per package, version union"; (2) post-success register — fold in-window targets into the exclusion block (scoped exact / non-scoped target+previous composite); (3) on dual-code failure (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` / `ERR_PNPM_NO_MATURE_MATCHING_VERSION`) → govern → retry the command at most once, then fall through to the existing failure translation. The web ladder gets the same three hooks.
- **Boundary & safety**: the red line narrows by exactly one exception (desktop: this block only, delegation hooks only, atomic write, parse-failure bail-out, tracing without file dumps); govern/register hold the official same lock and fail open — any failure never blocks delegation, pnpm stays the final enforcer; profiles that explicitly set `minimumReleaseAge` or `minimumReleaseAgeStrict` still get refused up front with a retry time; the mechanism verdict follows "first rule wins" (know-how 020 §2.4 form-theory retired).
- **Docs**: full decision record in `docs/adr/0009-release-age-exclude-governance.md` (with a fence appendix of 9 evaluated-and-skipped items and the observation contingency); GLOSSARY terms "First Rule / Release-Age Exclusion / Govern / Register / Release Age".

### Changed in 0.9.23 — two-phase Installed tab: instant list + update hints filled in place (ADR-0008)

- **Problem (observed live 2026-10-03)**: update probes were welded into the installed-list endpoint behind a 60-min in-memory TTL — after publishing a release, reopening the panel served the stale cache and update hints lagged (quota-watch's new version stayed invisible 17 minutes after publish while dsh-market already showed it).
- **Two parallel phases (zero new buttons)**: phase 1 `installed {probe:false}` returns the installed list immediately (registry matching and toggle phase untouched); phase 2 is a new `installedUpdates` method (`probeMode: 'only'`, **TTL=0 — a real probe on every panel mount**) that fills in ⬆ badges / the tab dot / "Upgrade all (N)" in place; failed checks still surface per item as "check incomplete" instead of pretending "up to date".
- **Scope & side effects (documented in ADR-0008)**: installed tab only — browse-page probes, `dshm_list`/`dshm_outdated` tools and CLI are unchanged (default `probeMode: 'full'`); ttl=0 evicts shared host-namespace cache entries before re-probing, so browse/tools TTL hits receive fresher write-backs (data only gets fresher; code paths and their own TTL regimes unchanged); GitHub passive budget consumption rate rises (limits unchanged: 25/req, 50/h rolling) with graceful `latestError` degradation.
- **Docs**: full decision record in `docs/adr/0008-installed-two-phase-probe.md`; DESIGN notes on the installed page / cache semantics; GLOSSARY term "Two-phase Load".

### Changed in 0.9.22 — upgrade activation classification (tarball diff, three states) + three-surface restart-hint split (ADR-0007)

- **Problem (observed in 0.9.21)**: after upgrading `@iasiv5/dsh-skins` 1.2.3→1.3.0 the plugin was already live without a restart (client bundle rev hot-reload), yet all three surfaces still said "restart required" — the noise trains users to ignore the hint, and restarts have real costs (web service blip / manual desktop reopen).
- **Activation classification** (GLOSSARY「生效判定 / 纯客户端更新」): npm-source upgrades now fetch both tarballs at the success point (parallel, 10s total deadline, 8MiB per tarball, no cache), parse them with a zero-dependency read-only ustar reader (pax long names supported) and classify by per-file sha256 diff into `activation: 'client-only' | 'restart-required' | 'unknown'`. Five rules: client set = `exports['./client']` target; a changed `dsh.bundle.patch`-declared patch file → host; `package.json` compared semantically with the top-level `version` ignored (dependency changes still count as host); every other added/removed/changed file attributed by path; a changed client pointer conservatively counts as host. **Fail-open**: any error → unknown → current conservative hint, never affecting the upgrade's success.
- **Three-surface split**: the agent tool message for `client-only` says a page refresh suffices and explicitly forbids offering `dshm_restart`; the GUI toast gains a suffix and its restart banner gate follows `needsRestart` (pure helper `upgradeNotify`, unit-tested); the CLI line switches accordingly. `needsRestart` widened to boolean at the source (TS2430 avoidance); `UpgradeResult` and the desktop upgrade result carry the new `activation` field; wired at `upgradePluginLocked` + `desktopUpgradeLocked`; selfUpgrade/install/uninstall/github sources unchanged.
- **Tests & docs**: 11 new ustar parser cases, 18 classifier rule/fail-open cases, 7 upgrade-wiring cases (npm/github/selfUpgrade/desktop), 4 renderUpgrade cases, 3 upgradeNotify cases; existing upgrade fixtures gained a `classifyActivation` seam (no implicit network). Full decision record and known limitations in `docs/adr/0007-activation-classification.md` (no client chunk require-graph tracking; docs-only diffs conservatively count as host).

### Changed in 0.9.21 — Settings force-refresh display fix + automatic jsDelivr purge on registry.json changes

- **Settings force-refresh display fix (observed live 2026-10-03)**: the Settings tab's "Force refresh" only reloaded the `registry` API (synchronous full-chain force fetch), but the panel renders the registryState **from the `registry-config` snapshot taken at mount** — so the toast said "Registry force-refreshed" while source / fetched-at / entry-count stayed frozen until the settings tab was remounted. A successful force refresh now also reloads `registry-config` (force already updated the controller's in-memory snapshot, so this costs nothing) and the display follows the live data immediately.
- **Automatic jsDelivr purge (new `purge-jsdelivr` job in `registry.yml`)**: the default chain's "sticky route + CDN always answers 200" combo lets a lagging jsDelivr snapshot **pin the curated list indefinitely** — observed: after 0.9.18 added DSH Market (18→19), a machine sticky to jsDelivr kept receiving the 18-entry snapshot; the raw primary route was never retried, and even the user-facing force refresh could not escape (only a manual `purge.jsdelivr.net` call fixed it). Now a push to main that actually changes `registry.json` (diffed against `github.event.before`) triggers a CDN purge **after** `validate` goes green, re-reads the CDN to verify the entry count, and writes both into the step summary; pushes without registry.json changes and PRs skip the job entirely.

### Changed in 0.9.20 — latest probe cache back to memory-only (restart invalidates) + mutation-scoped invalidation (ADR-0006)

- **Post-mortem landed (night of 2026-10-03)**: since 0.9.14 the latest-version probe cache was written through to disk and survived restarts, with TTL as the only invalidation channel — after a cache write at 00:22:58, four releases (00:27–01:05), a DSH restart (01:07) and a panel reopen (01:13) all served the stale value; cards and `dshm_outdated` both wrongly reported "up to date". That design is overturned; the full decision record lives in `docs/adr/0006-latest-cache-memory-only.md`.
- **Memory-only cache**: probe results now live in an in-memory Map + TTL (`cacheTtlMin`, default 60) — **a DSH restart drops them**, so "publish, restart, see the new version" works again. The cost is one bounded re-probe wave on the first open after a restart (current page, 8 workers + deadline cap, paid once per TTL window); the registry/community **catalog body** disk cache and SWR are untouched, so the page skeleton still opens instantly. Leftover inert `latest/<ns>.json` envelopes from 0.9.14 are swept once, best-effort, before the probe segment.
- **Mutation-scoped invalidation**: on **success** of install/upgrade/uninstall, the entry's cached latest value is invalidated across all registryKey variants (browse key / installed matched key / npm-only key) by itemId — no more "installed new / latest old" self-contradicting cards; `dshm_outdated` is honest about freshly upgraded packages. Invalidate-only, no writeback (a deliberate old-version install would otherwise fabricate latest = installed); rollback paths never invalidate; uninstall invalidates npm keys on a best-effort basis (a `gh:` key cannot be reconstructed from a pkg name and expires via TTL).
- **Not done, on record**: force passthrough of the probe cache and browse-page GitHub budget alignment were deferred by the owner — the former's residual blind spot is only the "no restart, within TTL" window; the latter has zero benefit for today's all-npm curated list (ADR-0006 §Considered Options).

### Changed in 0.9.19 — supply-chain release-age: pre-delegation gate, full violation parsing, split-state disclosure

- **Root cause (observed 2026-10-03 00:15 on this machine)**: pnpm 11.7 runs a **lockfile-wide** supply-chain verification on desktop installs (`Verifying lockfile against supply-chain policies (180 entries)`), and the standalone exact `minimumReleaseAgeExclude` entries it auto-appends after each successful install are **not honored by that verification when unscoped** (`dsh-m@0.9.18` flagged; scoped `'@iasiv5/dsh-quota-watch@0.1.13'` honored) — so one freshly installed version bricks every package operation for 24h, regardless of the current target. The target package gets written into node_modules before the verification fails while the official manager rolls back only manifest/lockfile → **"split state"**: the UI shows the new version active, the operation record says failed, and the next operation silently downgrades the plugin.
- **Pre-delegation gate (`releaseAgePrecheck`; read-only, fail-open)**: npm installs/upgrades now check the target version and untrusted lockfile exclude entries against registry publish times **before** delegating; anything inside its waiting window is refused up front as structured `release-age-wait` with per-entry ready times — no more half-written states. Missing publish data / unreadable policy / entries covered by effective selectors (package-level, `||` compound, scoped standalone exact) → proceed; pnpm remains the final enforcer.
- **Failure translation rewritten** (replacing the 0.9.10 single-match parser): all violations are parsed and reported as "target vs lockfile bystanders" with their own publish times and retry deadlines; the misleading "install via DSH Web instead" hint is gone. `DesktopOpsError` gained structured `details` (violations/targetViolating/splitState/blockers).
- **Split-state re-read**: after a release-age failure the installed state is re-read; when node_modules already holds the target version while the manifest still records the old one, the error explains the upcoming silent downgrade and how to converge.
- **Wiring**: desktop install / self-upgrade call sites now pass `profileDir` (upgrade already did).

### Changed in 0.9.18 — DSH Market added to Curated + README restructure, changelog extracted

- **DSH Market added** (npm `dshmarket`, Curated 18→19): a third-party visual plugin market — browse, search community plugins, and one-click install; one-click live theme switching. Primary bucket Essentials, secondary Cui's Picks (via `alsoCategories`). Copy follows the registry guide; third-party entries carry no `verified` claims.
- **Docs restructure**: README/README.en rewritten into a lean shape (highlights, TOC, requirements, documentation index, support-matrix FAQ); the recommended install path is now DSH's official plugin manager (with a screenshot and the upgrade caveat); this changelog moved out of the READMEs (bilingual); the Desktop FAQ reflects the post-0.9.8 capability table; DESIGN §3/§12 gained live-verification and tested-generation records.
- **Also**: the registry guard test moved 18→19; CHANGELOG.md now ships in the npm package (package.json files).

### Changed in 0.9.17 — secondary curated-bucket membership (one plugin across buckets) + the "iasi自研" rename

- **Secondary buckets `alsoCategories`**: curated entries can now declare a secondary curated bucket — chip counts and bucket filtering count "primary ∪ secondary" (a cross-bucket entry appears in every bucket it belongs to), while the detail page's category labels still follow the primary bucket. First dual seats: **better-sidebar** (Essentials ⊕ Cui's Picks) and **dsh-m** (Essentials ⊕ iasi In-house); better-sidebar's former fifth "崔添翼精选" tag is replaced by the real seat (tags return to the ≤4 soft rule).
- **Rename**: curated bucket "我的自研" (My in-house) → "**iasi自研**" (slug `self-dev` unchanged; synced across chips / tools / CLI / detail labels).
- **Routine transition**: once the schema gains a field, old clients reject the new registry on validation → they fall back to cache / bundled snapshot and show old data; upgrading fixes it.

### Changed in 0.9.16 — curated five-bucket taxonomy + stricter curation (23→19) + DSH TUI added

- **Curated taxonomy**: the Curated zone's categories change from the functional five (Market/Tools/UI/Search/Other) to five curated buckets — Essentials / Cui's Picks / iasi In-house / Tencent Lighthouse / Watchlist (chips in this order, Tencent Lighthouse last). Category semantics shift from "what the plugin is" to "why it deserves curation"; overlapping membership is bucketed by priority Essentials > Cui's Picks > In-house > Tencent Lighthouse, functional attributes move into tags for search, and old category values still hit custom sources as open slugs (ADR-0004 revision).
- **Stricter curation 23→19**: the channel five (lark/qqbot/weixin/wecom/dingtalk) leave Curated — still listed and installable in the community layer (4,000+ entries), just off the curated stage; **DSH TUI** is added (Cui's 9/26 X recommendation: a terminal TUI client, `dsh-tui`, speaking the DSH client contract ctx.remote); better-sidebar is bucketed to Essentials by priority and keeps its 9/27 recommendation provenance via the "Cui's Picks" tag.
- **Same-version carry-over** (local enhancements folded into the release): desktop installs retry the enable stage once on failure (proven against high-frequency install/uninstall and plugin-tree reload races) + failure copy keyed precisely to packageResult; the market page's "cached snapshot" banner retires — stale status is now carried by the settings page's community card, and browse pages no longer show transient cache state.

### Changed in 0.9.15 — install progress/result now live inside the detail modal

- **Scenario**: clicking Install in the detail modal rendered all install feedback (the pnpm phase line, the "changes applied" banner/toast) on the panel layer beneath, half-visible through the modal mask — inside the modal the button just spun, with no sense of progress (live screenshot feedback, 2026-10-02). Uninstall never had this problem: no modal is involved and status already lives on the installed card.
- **Change**: while an install runs, the modal hosts the progress line itself (same host-status polling: phase / bar / current package); terminal states render an inline result row — success with version + build-script notes and a restart hint (desktop gets the official app lifecycle guide), failure / guard block with the reason and a re-enabled retry button, "skipped" presented neutrally; while the modal is open the underlying twin line steps aside (and returns once the modal closes). Everything still derives from the global operation log and the install result — the "state lives off cards" ownership model is unchanged (DESIGN §2.6).

### Changed in 0.9.14 (instant-open quartet + context-aware "Install command" row)

- **Instant-open quartet** — a fix combo for the marketplace spinner that used to show on every panel open:
  - **SWR (serve-stale-while-revalidate)**: expired TTL no longer blocks on the network — the disk cache is returned immediately as a snapshot (the community zone keeps its honest "cached snapshot" banner; never pretending to be fresh), a background single-flight refreshes it for the next open. "Force refresh" semantics unchanged (always synchronous; community card stays decoupled).
  - **Route stickiness**: the default two-route chain (GitHub raw → jsDelivr mirror) is ordered by the **last successful route** recorded in the cache — once the mirror has worked it goes first, instead of re-paying the raw timeout on every cold open (~10-20s saved per cold open on CN networks).
  - **Persistent probe cache**: per-page npm/GitHub latest-version probes now persist to a disk envelope (`latest/`, survives restarts) — no probe replay on the first open after a DSH service restart.
  - **Client snapshot**: the default first page is cached browser-locally (10-min TTL); opening the panel renders the last response first and refreshes in the background — the spinner now only appears on the very first use (no snapshot yet).
- **Detail modal "Install command" row is context-aware**:
  - **Scenario**: the row's derived command hardcodes `dsh plugin --profile web add …`, and community entries' upstream `install` text carries the same web-profile semantics — neither source looks at the current host profile. Copying it on Desktop installs into the web profile (invisible in the current UI); for already-installed entries the command is pure noise (live screenshot evidence: desktop + the dsh-m self entry, `installed` badge and the command on screen together).
  - **Change**: the row is hidden entirely on desktop and for installed entries; web + not-installed keeps today's behavior (the CLI bootstrap path, same command as Quick start). The sanctioned Desktop path is the modal's own Install button (official pluginManager delegation, ADR 0005 discipline). No "simplify by dropping --profile": the explicit `--profile web` flag is a settled 0.9.0 decision (see the "profile target" section), and a bare `dsh plugin add` has ambiguous default-profile semantics — not simpler, just worse.

### Changed in 0.9.13 — desktop chip hover copy updated (owner decision)

- The old copy "当前 DSH profile：{name}（Desktop 首发仅支持只读市场、安装新包与开关）" was stale after 0.9.8 opened upgrades/uninstall/self-upgrade; per owner decision it now reads "当前生效 Profile" (Active profile).

### Changed in 0.9.12 — re-issue of 0.9.11

0.9.11 hit a npmjs ghost publish: the OIDC publish was accepted and **staged** (CLI exit 0, provenance published to the transparency log) but never committed into the registry — GET 404, and re-publishing the same version is rejected with 409 `Cannot publish over previously staged version`. After waiting out any propagation, the standard workaround applies: re-issue under a new number. **Content is identical to 0.9.11: settings force-refresh no longer takes down the community catalog card.**

### Fixed in 0.9.11 — Settings "force refresh" no longer takes down the community catalog card (force semantics belong to the curated chain only)

- **Scenario**: on a weak network, clicking the curated registry card's force refresh also flipped the community catalog card to "unavailable / fetch timeout" — the host forwarded `force` into the community summary, restarting its fetch flight; under a weak network the flight couldn't finish within the 3s waiter, which returned the timeout placeholder (the flight itself keeps running under its 30s hard cap and self-heals).
- **Fix**: the `registry` force is no longer forwarded to the community summary — force semantics belong to the curated chain; the community catalog keeps its own TTL/shared-flight cadence (a first-ever load on a terrible network can still transiently time out, but force refresh no longer triggers it).

### Fixed in 0.9.10 — Desktop self-upgrade hitting the official supply-chain release-age policy now yields an honest wait guide

- **Scenario**: clicking the upgrade chip routes through the official manager, whose pnpm supply-chain policy (`minimumReleaseAge`, releases must age 24h before installation) rejected the just-published version — `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. **The policy is working as designed** (anti-supply-chain-attack release waiting period); dsh-m just dumped a screen of raw pnpm output as a generic failure.
- **Fix**: the manager-result judgment recognizes the policy code and translates it into an honest guide — naming the pending entry and its publish time, deriving when a retry will pass, and offering the interim path (install the same version from DSH Web). No policy bypass, ever (the waiting period is the anti-attack red line; same stance as dsh-market #732).
- Also: community chain ⑨ hang-cap assertion 2s→10s (timer starvation under the full parallel suite tripped it twice; the "never hangs forever" contract is unchanged).

### Fixed in 0.9.9 — No more red "primary route failed" notice once the mirror line took over (notice convergence)

- **Scenario**: with the default dual-line registry (raw → jsDelivr), when the primary `default-raw` failed and the mirror succeeded, the settings page still showed a red "Remote notice: default-raw 失败：fetch failed…可稍后重试或检查网络后重试" — alarming against data that had already self-healed, with advice that didn't apply (intermittent raw.githubusercontent.com unreachability is exactly why the mirror line exists).
- **Fix**: a later line succeeding means the earlier failure self-healed — `errors` no longer carries it (the "effective source" row already states the live line, e.g. "GitHub 镜像（备用）"). When ALL lines fail into cache/bundled, the errors are still kept — that's the actionable signal. The custom chain (custom source failing into cache) keeps its warning, unchanged.
- Added a test seam for the default chain (`defaultRoutes` override); regression gates cover both convergence and the keep-on-total-failure cases.

### Fixed in 0.9.8 — Desktop package operations fully wired to the official manager (install always failed; upgrade/uninstall/self-upgrade opened)

- **Why every install failed**: the Host API's desktop install branch called `desktopInstall(id, cfg, opts)` without the 4th `deps` argument — `getService` never reached the adapter, so desktop installs always failed with "official pluginManager service unavailable (fail-closed)" (100% reproducible, timing irrelevant). The `dshm_install` tool had the same defect.
- **Service resolution aligned with dsh-market** (borrowed from its official-desktop wiring, proven on this machine by two managed upgrades): the probe now checks both contexts (the hostCtx from the webServer inject callback first) and falls back to a short-timeout cordis `inject` to lazily wake the official service — `pluginManager` is lazy, so a one-shot `get` returns undefined until something used it. Only a genuinely absent service still refuses (the no-file-level-fallback red line is untouched).
- **Capability table widened (owner decision, following dsh-market strategy)**: desktop upgrade (installBundle over the installed bundle), uninstall (removeBundle) and self-upgrade (installBundle('dsh-m@latest')) are now delegated to the official manager — exactly how dshmarket performed the dsh-m 0.9.3→0.9.4/0.9.5 upgrades on this machine. Judgment discipline unchanged (application/stage first, overridden is not a failure, build-blocked returns structured pendingBuilds, listBundles re-read never fakes success). restart stays refused (Electron lifecycle belongs to the shell).
- All three entry points (GUI, installed-view actions, and the dshm_install / dshm_uninstall / dshm_upgrade tools) are wired in the same pass.

### Fixed in 0.9.7 — Upgrade chip on Desktop showed a red "upgrade failed" banner (capability refusal is guidance, not an error)

- **Root cause**: the 0.9.1 upgrade chip always calls `self-upgrade`; the Desktop capability table refuses by design with a structured 409, but the client rendered that 409 like any other failure — a red "upgrade failed" banner. Per the capability table this is not a failure, it's a pointer to the official entry.
- **Fix**: `api()` now forwards the structured refusal fields (code/action/profile/guidance); on a 409 the chip click shows a **neutral info banner** with the official-entry guidance (the guidance text's single source stays server-side in `active-profile.ts`, zero duplication in the client); info banners stay for 12s. Real failures on Web still use the red error banner — unchanged.

### Fixed in 0.9.6 — "Clear finished" silently no-opped on failed records

- **Root cause**: the 0.7.0 review consensus excluded failed/superseded records from clearing (kept for review), so clicking the button against a failed record did nothing with zero feedback — reported as a bug from the real Windows host (2026-10-01). An explicit clear click is not a "silent wipe"; the old consensus is overruled.
- **Fix**: "Clear ended" (formerly "Clear finished") now clears **all terminal states** (done/warned/failed/superseded); in-flight records (queued/running/input) are untouched. When there is nothing terminal to clear, the button is disabled with an explanatory tooltip instead of silently no-oping. The per-row ✕ still removes single records.
- English copy updated accordingly.

### Fixed in 0.9.5 — GUI read paths missed the active profile on Desktop (Installed tab always showed web)

- **Root cause**: the 0.9.0 dual-profile wiring missed the `installed` / `market` read paths in the Host API — `listInstalledWithMeta` / `listMarket` fell back to `webProfileDir()`: on Desktop the Installed tab always said "no plugins installed in this web profile" and the market "installed" badges stayed empty (the agent-tool surface `dshm_list` was wired correctly, so only the GUI was wrong).
- **Fix**: both now pass `profileDir: profile.dir` + `profile: profile.name` (same as the tools surface; profileContext as the single source of truth); registry/community cache segments follow the `profile` parameter automatically.
- **Copy**: the hardcoded "web profile" in the installed empty/loading states and the profile hint is now profile-neutral (the actual path is still shown).

### Fixed in 0.9.4 — Fullscreen header eaten by the Windows Desktop titlebar (tabs / restore unreachable)

- **Root cause**: on Windows Desktop the shell runs `titleBarStyle:hidden + titleBarOverlay` — the top 40px of the window is a full-width `-webkit-app-region:drag` band (drag hits are decided by layout and ignore z-index / paint order), and the OS-drawn — □ ✕ caption buttons float above everything. The maximized panel header landed inside that band: tab clicks were swallowed by window dragging and the restore/close buttons were covered by the system buttons — no way back.
- **Fix**: the same approach the shell uses for its own overlays — consume the `--dsh-windows-titlebar-height` variable the shell sets on `html` (fullscreen `top:var(…)`; floating `padding-top:max(24px,var(…))`, which also fixes the short-window edge case where the floating panel's top edge sat under the band).
- **Zero drift on Web**: browsers / DSH Web have no such variable — it falls back to 0px, byte-identical to 0.9.3.

### Fixed in 0.9.3 — Windows native support (verified on a real Windows host)

- **Registry atomic writes**: temp file names were derived with `split('/')`, but Windows paths separate with `\` — the "basename" came out as the entire path, the temp-file open always failed silently, and every cache / accepted-metadata write silently failed; now uses `basename()`, identical on all three platforms.
- **Local-file registry address parsing**: `C:\…` drive paths and `\\server\share` UNC were misread as URL schemes (with a misleading "HTTPS only" error), and `file://C:/…` normalized to a drive-less dangling path that always failed with ENOENT; all three local forms (POSIX absolute / Windows drive / UNC) now parse correctly as file kind.
- **Build**: `node_modules/.bin/tsc` is a POSIX sh shim; on Windows `spawnSync` failed with ENOENT — the build now runs TypeScript's JS entry with the current Node, identical on all platforms.
- **Test surface**: on a real Windows host the full 829-case suite went from 41 failures to **0** (821 pass / 8 skipped); POSIX-only contracts (process-group/SIGTERM timing, symlink privileges, platform path assertions, fixed-sleep timing) are now labeled skips, platform-neutral, or poll-based — test contracts unchanged.

### Fixed in 0.9.2 — Header chip stuck on the old version after a service restart

- **In-place refresh once the restart is confirmed**: the moment the boot id confirms DSH Web is back, the panel re-fetches ping — the `dsh-m vX.Y.Z` chip and the profile chip sync to the new process's data instead of lingering on the old version (observed on 0.9.1: chip upgrade + restart still showed v0.9.0).
- **Refetch when the page becomes visible again**: with the panel left open while the service is restarted externally, returning to the tab refetches ping via `visibilitychange` (zero polling cost).
- **Chip version guard**: a self-check verdict whose version doesn't match the current process (stale verdict from the old process) is treated as silent, preventing "v0.9.1 ⬆ v0.9.1"-style misrenders.

### New in 0.9.1 — Header version chip upgrade notice (lights up only when an update exists)

- **Silent by default**: the panel-header `dsh-m vX.Y.Z` chip keeps the static look introduced in 0.7.5 — up to date, failed check, or a local dev build ahead of npm (ahead) never interrupt (ahead only shows a "local dev build" hint in the hover title).
- **Lights up only when outdated**: when `self-check` (npm latest vs the installed version, read-only) finds a newer version, the chip turns into a warn state showing `⬆ v<latest>`; clicking it runs `self-upgrade` (same mutation session + post-install guard) and a "⚡ Restart" banner follows on success. On Desktop the click is rejected structurally by the capability table (409, with official lifecycle guidance).
- **TTL cache + version guard**: check results are cached in browser localStorage for 30 minutes so opening the panel doesn't hit npm every time; after an upgrade + restart the cache auto-invalidates by version. Failed checks stay silent — no error is shown.

### New in 0.9.0 — Official Desktop (dual profile) support

- **One package, two profiles**: dsh-m now installs into the official Desktop's `desktop` profile (`~/.dsh/profiles/desktop`) alongside the Web `web` profile; the catalog, panel, and agent tools are shared, and everything manages the host's current profile (official `profileContext` as the single source of truth).
- **Entrust admission to the host**: every `/dshm` method (including ping and unknown methods) delegates to the official `connection.requestRejection()` before any body is read (trustedHosts / loopback / cross-site / `Origin: null` semantics come from the host); rejected requests consume no body and call no business logic; hosts without the capability fail closed. **Behavior change**: the old home-grown "missing Origin → 403" guard is gone — Origin-less requests from the Desktop bridge are admitted per official semantics, and unauthenticated health probes now follow host trust instead of a blanket 403.
- **Desktop first-release capability table**: read-only market + **installing new packages** (delegated to the official `pluginManager.installBundle`; integrity, locking, and application phases stay with the official manager) + **toggles** (delegated; structured refusal when the service is absent, never a file-level fallback); **upgrade / uninstall / self-update / one-click restart** return structured 409 refusals with official-entry guidance (no official upgrade API exists; restarts belong to the Electron lifecycle); build scripts retry with the exact official `pendingBuilds` list — never an allow-all.
- **Per-profile read model and cache**: market installed-badges, the installed list, and README previews only read the current profile; registry / community / accepted-source caches are segmented per profile (web keeps its legacy paths — zero migration, zero clearing); favorites and operation logs stay per browser origin and do not sync between Web and Desktop.
- **CLI always targets the web profile**: `--profile web` is explicit; `--profile desktop` is rejected with a pointer to the official Desktop plugin management page.
- **Honest limitations**: Desktop on-device (Win/macOS) E2E has not been run; the `registry.json` verified arrays gain **no** Desktop generation (to be recorded after real testing); dsh-m's file-level post-install guard is skipped on Desktop (app.asar probing blind spot) and replaced by official result checks plus a `listBundles` re-read.

### Fixed in 0.8.5

- **dshm_upgrade fake success on guard blocks**: when an upgrade hit the post-install guard (e.g. link/file-sourced plugins cannot be auto-rolled-back), the text output was mis-rendered as "✅ undefined 已升级（最新）"; it now reports the block reason, compensation status and repair basis honestly, consistent with the card title (Guard block).

### Changed in 0.8.4 — Category labels now follow the UI language

- **Community categories**: English names for the 23 known categories come straight from the upstream catalog's `categories.en`; under the English UI, category chips and the category row in detail/favorite modals show English. Upstream categories without an English name fall back to Chinese and keep rendering as raw slugs in the temporary group until labels land in a release. The Chinese UI is unchanged.
- **Curated categories**: the five chips now go through the bilingual dictionary (Market/Tools/UI/Search/Other ⇄ 市场/工具/界面/搜索/其他), consistent with the detail modal.
- **Implementation**: the summary carries `categoryLabelsEn` (derived from the upstream catalog in `communityOutcome`; ids without English are omitted — no second hand-maintained table), and the client merges per UI language. 0.8.1–0.8.3 were local iteration numbers with no separate changelog surface.

### Changed in 0.8.0 — Settings page redo (aligned with the zoned dual-catalog positioning)

- **Information architecture**: Community catalog (from awesome-dsh-plugin) → Curated registry (registry.json) → dsh-m itself → About; the primary registry's user-facing name is now unified as "Curated registry".
- **Community catalog toggle**: a new GUI switch (live effect, instant, no confirm; when off the whole card collapses to one line); new `set-community` API.
- **Curated registry slimmed**: status fields consolidated from 7 rows to 4 (merged address, removed the hard-coded "caching" row); config status only appears when abnormal; buttons reduced to "Force refresh / Validate & apply / Restore default / Download default registry"; "Check entries reachability" removed from the GUI (`registry-diagnose` API kept).
- **Copy fixes**: the custom-source note now says it replaces the whole primary registry and only affects the Curated zone; removed the hard-coded TTL description that didn't match reality (`timeoutMs`/`cacheTtlMin` remain config-file settings).
- **dsh-m itself**: when the local dev build is ahead of npm, show "local dev build" instead of the misleading old "npm latest" (new `ahead` field).
- **About**: copy aligned with the current positioning, plus GitHub repo and issue-tracker links.

### Polished in 0.7.10

- **Head split into three groups**: a hairline divider between the title and tab navigation — "title | nav | status + window controls" reads clearly.
- **Version badge unified color**: the v-number no longer uses the bright primary text color; it matches the dsh-m name in secondary gray.
- **Vertical rhythm consolidated**: window-control cells 26→28px to match tab height; version badge adjusted to 24px; maximize/restore icons unified at 12px; title weight 700→600.

### Fixed in 0.7.9

- **Category chips keep a stable order**: retired the "promote active to front" reordering (every click on a clipped category used to jump it to first place). Instead, when the active category falls inside the collapsed clip region, the row auto-expands so the active filter stays visible — same goal, stable order; a manual collapse under the same active category is respected, and picking another clipped category or "All" resets it.

### Changed in 0.7.8

- **Root cause fix for "maximize does nothing" — CSS hot-update self-healing**: the panel stylesheet was only injected once (`#dshm-css` present → skip), so after a hot update the stale stylesheet lacked rules for new classes (fullscreen/window controls) — new features appeared dead and buttons rendered as unstyled natives. The injected stylesheet now carries a content hash (djb2); reopening the panel after a bundle update swaps in the fresh styles automatically, no page refresh needed.
- **Window-control group recolored**: dropped the raised surface for a transparent background + hairline outline (same language as the search clear button); cells widened 34→44px against mis-clicks; close keeps its red hover.

### Changed in 0.7.7

- **Fullscreen ported from dsh-market**: a maximize/restore control joins the panel head as a unified window-control group (equal-width maximize + close cells, hairline divider, shared SVG line icons; close tints red on hover). Fullscreen fills the viewport without rounded corners, the state is remembered in localStorage, and Esc still closes the panel.
- 0.7.6 catch-up: version badge de-bolded and made static (no copy-on-click); sticky category row's top gap fixed (sticky anchor shifted to offset container padding); close/clear buttons moved to the outlined flat style.

### Changed in 0.7.5

- **Header version chip now shows dsh-m's own version** (`dsh-m v0.7.5`, click to copy; the DSH runtime version lives in Settings and `dshm ping`).
- **× close/clear buttons redrawn**: search clear, detail-modal close, and operation-row remove now use an SVG line icon on a dedicated hover-tinted button; the search clear button floats inside the pill's right edge.
- **Fixed the dsh-market peer warning**: `@deepseek-ai/dsh-tools` peer changed from `*` (strict semver never matches rc prereleases) to the explicit range `^0.1.7-rc.2 || ^0.2.0-rc.1 || >=0.2.0`; newer rc lines (e.g. 0.3.0-rc.x) need another entry.

### Changed in 0.7.4

- **Panel tabs reverted to the classic segmented style** (0.7.2 mistakenly introduced underline tabs; the rounded button group with a highlighted active tab is back).
- **Full-width search**: fixed the search wrapper missing `display:flex`, which kept the input from stretching to the row.
- **Filter button and page-jump control recolored**: the filter button now uses an elevated surface with squared corners to stand apart from the pill category chips (accent outline when open); the page input is a slim pill with a hairline border and an accent-colored "Go" text button.
- **Sticky category row fully opaque**: the background now uses the opaque base token directly (the previous color-mix translucency still let card text bleed through on the dark theme); the bottom divider stays.

### Changed in 0.7.3 (includes 0.7.2)

- **Home layout modeled after dsh-market**: the market view becomes "zone chips → full-width search row → category chips with a trailing Filter popover"; the popover gets its own look (rounded rectangle + leading chevron) and holds sort field (npm downloads/stars/date added), direction, and page size (the old sort dropdown and pager page-size select are retired).
- **Favorites cards open the detail modal**: fixed favorites-zone cards not responding to clicks — favorite snapshots lack full fields, so opening resolves the complete entry by id (in-memory zones → market API → snapshot fallback), reusing the detail modal and the full install path (peer confirm included).
- **Page-number jump**: the pager gains a page input — type a valid page and hit Enter or "Go" to jump.
- **Frosted sticky category row**: the sticky row now blurs content beneath it (backdrop blur + divider), so card text no longer bleeds through.
- **Removed by request**: the "discover/request listing" line (dsh-m does not accept listings), the "Tasks" button (operations panel is always visible again), and the "Refresh" button (force refresh lives in Settings).
- Note: registry entries carry no host-version requirement field, so dsh-market's "host version" filter has no data source here and was not replicated.

### Fixed in 0.7.1

- **Community entries are installable again**: fixes a 0.7.0 regression where installing a community listing failed with "registry 中没有该条目" (install-by-id only consulted the primary registry, never the community catalog); the path now mirrors upgrades — on a primary miss the catalog is searched by id.
- **Compact market header**: search, refresh, and sort (community zone) move into the zone chips row; informational source banners ("official default registry / custom registry / served from local cache") are retired — their "{count} listings" figure was never wired up (always 0); the "registry unavailable" error and community fallback/stale hints remain.

### New in 0.7.0

- **Zoned market** ([ADR-0004](./docs/adr/0004-zoned-market-display.md)): the dual-catalog data merge stays, but the display splits into Community (default) / Curated / Favorites zones; `dshm_search` and `dshm search` switch to `--source community|primary|all` + `--offset` real pagination (default 10 cards) — `primary_only` is retired.
- **Relevance search**: NFKC normalization + CJK↔Latin boundaries + field weighting (name/npm > owner > description > category > tags), multi-term same-field matching; whole-id exact match takes top priority.
- **Operation log + resume executor**, **local favorites + delisted cleanup**, **detail modal + screenshot lightbox**, community byline/deprecated badges/catalog-snapshot version fallback (never used for outdated).

### New in 0.4.0

- **Enablement toggle**: one-click on/off per installed card; internally routed to a row override (single-row plugins, applies live) or bundle selection (multi-row); the write path delegates to the official `pluginManager` service and falls back to direct loader operations when absent ([ADR-0001](./docs/adr/0001-delegate-with-fallback-for-plugin-manager.md)).
- **Live phase badges**: a projection of loader fiber state — failed plugins are visible at a glance.
- **Protection roster**: `dsh-m` itself plus the 16 official host lifeline modules cannot be toggled or uninstalled (upgrades unaffected).
- **Precise build approval**: when pnpm blocks build scripts, only the pending list is approved key-by-key; the allow-everything fallback is labeled honestly ([ADR-0002](./docs/adr/0002-precise-build-approval.md)).
- **Peer compatibility precheck**: install/upgrade validates `@deepseek-ai/dsh(-*)` peers against the runtime version before touching the profile (GitHub sources state the check was skipped); on mismatch the GUI asks, the agent tool returns structured data, the CLI takes `--force`.
- **Verified runtimes**: an optional `verified` array per registry entry records DSH runtimes actually tested — a claim of record, not a prediction; display-only, never gates installs.
- **Bundle identity check**: post-install warning when a package lands without a patch layer ("installed as a plain dependency").

### Retired in 0.4.x

- **Metadata source probe**: 0.4.0 introduced an npmjs / npmmirror ping race to pick the metadata read source; it has been removed entirely (including the `probeEnabled` / `probeTimeoutMs` / `probeCacheTtlMin` settings and the settings-page display). The official counterpart probe only pre-selects a registry in the interactive install dialog, which dsh-m does not have, and npmjs measured consistently faster from the host, so the probe always equaled the default. Metadata reads now always use npmjs, matching the install path (profile `.npmrc` default).
