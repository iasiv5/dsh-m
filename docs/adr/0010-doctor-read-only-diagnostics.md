# 诊断子系统 Doctor：只读边界、三级严重度与三端落位（Day1 子集）

dsh-m 至今没有任何诊断能力：profile 出问题时的排查全靠 know-how 手工清单——014 号 symlink 农场 heal 留下 230 行手工映射，且「每次 DSH 升级后重跑农场测活」是唯一现役周期必查项；023 号快照竞态实录了「账实分裂」（node_modules 已 1.2.7 / lockfile 已 1.2.7 / package.json pin 仍 1.2.5，pnpm 非零退出拦住 pin 写入）。本机 web profile 实扫（2026-10-04）另发现：node_modules 顶层 8 个空 scope 目录、profile 根 12 个 `*.bak-*` 备份文件累积、dsh-m 0.9.28 与 dshmarket 1.66.8 双市场并存——全部是「当时若有诊断页就能一眼看清」的形态。

2026-10-04 对 dshmarket v1.66.8 做了能力与设计的详尽对比（`01_docs/research/2026-10-04-dshm-vs-dshmarket-full-comparison-and-doctor-pick.md`，其 check.ts 1446 行通读），经 grill 四轮拍板：在更新探测收尾与诊断子集两个候选中，按「学习价值×自用价值为主、可行性作门槛」的权重选定诊断子集为本次冲刺。

我们决定：

1. **新增体检（Doctor）子系统**：`src/core/doctor.ts` 纯文件系统分析——无进程、无网络、无写入，任意时刻可安全调用；报告 schema 版本化（`dsh-m/doctor/v1`），后续检查项扩展 finding 枚举不破坏消费方。
2. **三级严重度从第一天编译进数据结构**：error（断链或必然阻断启动）/ warning（确认异常但不阻止启动）/ 结构化清单（只列不警、零告警渲染），另设 unknown≠broken 第三态（看不见的对象显式标 unknown 并沉默，不推断为损坏）。每条告警必须说清三件事：发生了什么 / 为什么 / 现在怎么办。
3. **三端落位 = 方案 D**：`/dshm` 单路由新增 `doctor` method（照 `registry-diagnose` 先例）+ CLI `dshm doctor` 子命令；**不新增第 9 个 agent 工具**——工具描述是宿主 agent 的常驻上下文，行为面代价大于收益，且「诊断」触发词宽、易与 `dshm_list` / `dshm_outdated` 抢活；确有「对 agent 说帮我体检」的高频场景再议（届时描述必须窄化为「只读体检，不修复」）。
4. **Day1 范围三项**（本冲刺）：农场测活（悬空 = error，指向非当前运行时 store = 提示级；**2026-10-04 补记（执行评审 E1.1）：stale 判定仅限 `@deepseek-ai/dsh` 伞包**——非伞包核心包版本与运行时版本分属不同命名空间，逐包比较必然大面积误报（cordis@4.0.1 之类），误报纪律禁止；非伞包 targetVersion 仅信息呈现）、残留物清点（结构化清单零告警：无 package.json 目录 / 空 scope 目录 / `*_tmp_*` 暂存 / `*.bak-*` 备份）、账实一致（pin / 实装 / lock 三处任一不符 = warning）。Day2 三项（bundle 栈完整性、全 profile 重复 loader id、peer 漂移 FS 版）与 GUI 折叠区后置为下一批。
5. **边界与修复责任外移**：绝不转储 `cordis.patch.yml` 等含密钥文件内容，只报结构化事实（包名 / 路径 / 版本号）；双布局（hoisted / isolated）适配，布局判定为 unknown 时显式标注扫描受限而非空报告冒充健康；双市场并存列为信息级事实；doctor 永不写不删——修复建议以文字 / 外部剧本形态给出（dsh-market 教训：残留目录的删除正是常被进程句柄拒绝的操作，诊断进程做修复 = 越权踩写侧事务）。
6. **web profile 先行**：CLI 恒 web profile 的既有惯例不变；desktop profile 诊断不在 Day1（desktop 包操作已委派官方管理器，可见面不同，需要时另议）。

## Considered Options

- **照抄 dsh-market check.ts 全量九类**：其组合逻辑逐行镜像宿主 applyEntryPatches（连 `!!js` 真值边界都镜像），不是 1–2 天能安全消化的量；且其残留扫描以 .pnpm 虚拟店为假设，在本机 hoisted 形态下扫不到东西——先以本机实证需求（014/023 + 实扫残留）裁剪三项。
- **仅 GUI 诊断面板**：呈现力最强，但破三端同源（DESIGN §70），agent 与 CLI 双盲；GUI 折叠区留作下一批在 method 之上叠加。
- **第 9 个 agent 工具 `dshm_doctor`**：代码成本约 S，但系统提示行为面代价无法用代码行衡量；缓上（见决定 3）。
- **只做 CLI 不加 method**：无 `/dshm` 接缝，GUI 折叠区后续接入要重走服务端；method 先行的成本极低且有 registry-diagnose 先例。

## Consequences

- 版本 0.9.29；实施计划见 `docs/plans/2026-10-04-doctor-day1-implementation-plan.md`。
- GUI 折叠区、Day2 三项（bundle 栈 / 重复 id / peer 漂移）、AI 修复提示词（含 agent 身份自检前置的硬禁改契约）列为下一批候选。
- 更新探测域两件快赢**不混入本冲刺**：③ registry deadline 静默跳过补标记（S）、⑥ 更新内容 changelog 消费 `dsh-plugin-updates`（M）；A-④ 区域路由维持暂缓——本机实测官方 npm 源全场最快（对比报告 §7），「中国→镜像」硬编码对本机是负优化。
- know-how 014 的「升级后重跑农场测活」纪律获得工具化出口：`dshm doctor` 一键替代手工 lstat 遍历。
- 验收锚点（本机 web profile 首跑）：8 个空 scope 目录与 12 个 `*.bak-*` 以结构化清单呈现、悬空符号链 0 条（014 heal 后）、账实一致或如实报告不一致、双市场并存以信息级出现。
- 文档连带：GLOSSARY 六词条（体检 / 三级严重度 / unknown≠broken / 账实分裂 / 残留物 / 农场测活）。
