# 排除条目代管：desktop 红线收窄（minimumReleaseAgeExclude 例外）+ 三挂点治理 + 首条规则机理

0.9.19 给 desktop 包操作加了「委派前只读预检」（`releaseAgePrecheck`）：目标版本或锁内排除条目未满供应链等待期（`minimumReleaseAge`，pnpm 11.7 默认 1440 分钟、非严格）就结构化拒绝，理由是「官方管理器会拦、拦了会半写」。2026-10-03 实证该预测对目标腿不成立：`@inventec/dsh-copilot-auth@1.2.4` 发布 8 分钟后同机器的 dsh-market 直接装上（desktop 操作日志 operation-zsc4ei：pnpm 非严格模式对显式点名的新版本**放行并自动向 `minimumReleaseAgeExclude` 追加条目**），`@iasiv5/dsh-quota-watch@0.1.21` 同型——dsh-m 的提前拒绝只是把用户推去别家市场，不构成任何额外保护。

同时实证的还有 dshmarket（第三方市场，v1.66.8）的排除条目子系统：pnpm 的 `evaluateVersionPolicy` **每包名只认第一条排除规则，同名后续规则死亡**（#732），pnpm 自己自动追加的独立精确条目因此常常是死规则，会让等待期内该 profile 的全部包操作被锁文件级校验拦死（know-how 020 §7 的连坐实录）；dshmarket 的对策是在每次 add/remove/install/update 前后把排除块治理成「每包一条、版本并集复合」的规范形态。它只治不登、无锁裸写、desktop 桥上放弃一次性 bypass（宿主不收 flag）。

我们决定（2026-10-03，grill 三轮 + 独立评审三轮，需求要点见 `docs/plans/2026-10-03-release-age-exclude-governance-requirements-brief.md`）：

1. **红线收窄**：ADR-0005 ③「绝不直接编辑 desktop profile 的 pnpm-workspace.yaml」收窄出唯一例外——仅 `minimumReleaseAgeExclude` 块、仅委派前后挂点、原子写（`@deepseek-ai/dsh-atomic-write`）、解析失败即弃、每次编辑留痕（只落 name@version 集合，绝不整文件转储——该文件 allowBuilds 的 git 键可含凭据）。
2. **三挂点**：① 委派前治理（同名多规则合并为规范形态，只修不建）；② 装机成功后登记（仅发布时刻可判「窗口内」的目标并入排除块）；③ 双码失败（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` / `ERR_PNPM_NO_MATURE_MATCHING_VERSION`）→ 治理 → changed 则重试该命令一次（至多一次），仍败走 0.9.19 的失败翻译与账实分裂复读。
3. **登记形态细则**：并入该包既有规则；无既有规则时 scoped → 精确单条，非 scoped 且有异于目标的上一版本 → 目标+上一版双选择器复合，全新包首装 → 精确单条（运行期观察项，见 Consequences）。
4. **预检收敛**：默认策略（未显式设置 age、未开 strict）→ 放行委派 + 陈述性 notice；显式设置 `minimumReleaseAge` 或 `minimumReleaseAgeStrict: true` → 维持拒绝并给可重试时刻。0.9.19 的②腿（锁内死规则预拒绝）退役，由治理取代。
5. **机理改判**：know-how 020 §2.4 的「非 scoped 独立精确条目不被认可」改判为「同名第二规则死亡」的误读——两个 ❌ 案例当时同包名都有更早规则在前，✅ 案例是唯一规则；采「首条规则生效」论（dshmarket profile.ts:1272 生产级实证）。
6. **并发策略**：治理/登记的读-改-写全程持 `withFileLock(<profile>/package.json)`（toggle 既有官方同款锁，锁序一致无死锁）；原子写防撕裂。**残余风险如实记载**：pnpm/官方桥自身的追加不持该锁，跨工具残余窗口接受；竞态丢失的追加条目的恢复路径 = 重新安装该 young 版本（pnpm 重追加）或操作员按 know-how 020 §3 手动补条目——「治理挂点自愈」仅适用于重复条目形态，不覆盖丢失条目。

## Considered Options

- **维持 0.9.19 只读预检**：预测模型与真实策略形态不符（默认非严格下点名新版本必放行），假阳性只生产摩擦——用户绕去 dsh-market 点一下就装上了，等待期的墙并没有多出一堵。
- **只校准预检、不做代管（上轮方案 A）**：消灭假阳性，但 pnpm 自动追加的死规则无人治理——非 scoped 包的 young 安装仍会让 profile 24h 内全部包操作连坐（020 §7），而且 desktop 桥上 dshmarket 的治理（预运行 merge）会在我们委派前跑、我们委派后 pnpm 又可能追加，时机上只有委派方自己能闭环登记。
- **完全照抄 dshmarket（只治不登、无锁裸写）**：它单进程假设成立所以敢裸写；dsh-m 的写入者与官方服务、dshmarket、操作员手编四方并存，原子写 + 同款锁是低成本升级。登记是我们相对它的有意超出：desktop 桥语义下「pnpm 追加 → 下一个操作者治理」的窗口里任何一方都可能踩雷，委派方装完当场修正形态是唯一闭环时机。
- **把文件治理塞进 Profile 变更事务**：desktop 路径没有事务（委派官方管理器），强套会把 manifest/lockfile 快照面拖进来——例外收窄到单块更小、更可验证。

## Consequences

- **行为变化**：默认策略下，等待期内的新版本可经 dsh-m 即时升级（成功后自动登记豁免，操作记录附陈述句）；显式设置 age 或 strict 的 profile 仍前置拒绝并给可重试时刻。web profile 走同一套治理（ladder 三挂点），文件缺席即整体跳过。
- **ADR-0005 ③ 同步修订**（见该文末指针）：desktop 对 pnpm-workspace.yaml 的写入权仅限本例外。
- **零文件级 fallback 的其余部分不变**：不写 allowBuilds、不做 pnpm 自编排、服务缺席仍结构化拒绝。
- **机理改判的证伪出口（观察项）**：首个「young 非 scoped 全新首装」发生后，若随后的锁文件校验 flag 该条目（即首条规则生效论被证伪），登记回退规则切换为包名级（bare name，实证认可），同步修订 know-how 020 §8。
- **留痕**：治理/登记动作以短语（`排除条目治理：合并 <names>` / `排除条目已登记 <name>@<ver>（<form>）`）出现在操作结果 output 或失败 message 中，含失败与拒绝路径——已落盘的编辑不以操作失败为由消失。
- **栅栏（评估过不做）**：hoist 重建（#20，desktop 桥不可传 flag、web 罕见）、host peer 关装（#289，本机零病例且 desktop yaml 已 `autoInstallPeers: false`）、fetch 超时加长（#615）、瞬时网络重试（#83，误判会对非幂等操作盲目重试）、allowBuilds 坏键清除（#698，pnpm 10.26–11.5 版本窗外）、一次性 bypass（#39，desktop 桥不可用；web 侧与 dshmarket #594 立场一致——显式设置的策略是 profile 主人的意愿，不代豁免）、notOnMirror 裸名回退（与精确 pin 语义冲突，npmmirror 滞后走 retryable-lag 翻译 + 020 §3 操作员通道）、heldRelease「仍安装」交互（前置拒绝下走不到）、清理满期条目（满期条目无害，卫生项后置）。
- **文档连带**：know-how 020 §2.4 原地加改判标注、§8 于端到端验收后落笔；GLOSSARY 新词条（首条规则/排除条目/治理/登记/等待期）。
