# 排除条目治理（minimumReleaseAgeExclude 代管）需求要点 · 评审用

> 本文件是 2026-10-03 主人逐项批准的需求共识（grill 三轮问答的结论清单），作为实施计划的独立需求锚点。只含"决定了什么"，不含论证过程。计划文档：同目录 `2026-10-03-release-age-exclude-governance-implementation-plan.md`。

## 背景事实（已实证，可直接引用）

1. 本机（Windows）只有 desktop profile；pnpm 11.7.0 执行全部 profile 包操作；`minimumReleaseAge` 未显式配置（默认窗口，实测 1440 分钟），`minimumReleaseAgeStrict` 未开启（非严格）。
2. 非严格模式下，**显式点名**的等待期内新版本会被直接安装，pnpm 自动向 `minimumReleaseAgeExclude` 追加 `pkg@ver` 条目（desktop 操作日志 operation-zsc4ei pnpm.log 逐字记录）。
3. pnpm 每包名只认**第一条**排除规则，同名后续规则死亡（dshmarket profile.ts:1272 实证，#732）；死亡规则会让等待期内所有包操作被锁文件级校验拦死（know-how 020 §7 实录）。
4. 失败双码：`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 与 `ERR_PNPM_NO_MATURE_MATCHING_VERSION`（dshmarket pnpm-compat.ts:358-364 归并为 release-age-violation）。
5. desktop 宿主桥（官方 pluginManager）只接受 `add <target>`/`remove <target>` 两动词，不接受任何 pnpm 附加 flag。
6. 现状痛点：dsh-m ≥0.9.19 的委派前预检把"目标版本在等待期内"预测为"官方必拦"并提前拒绝——同目标 dsh-market（第三方市场，v1.66.8）却能装上（copilot-auth@1.2.4 发布 8 分钟、quota-watch@0.1.21，两例实证）。
7. 参考实现（只读镜像）：`.dsh-research/dsh-market-clone/`（v1.66.8）——install.ts withHoistRecovery（预运行合并 #732、失败后合并+重试、一次性 bypass #39）、profile.ts mergeDuplicateReleaseAgeExcludes、official-desktop.ts（marketFlags=false 语义）。

## 已批准决策（逐条为需求，全部已由主人拍板）

1. **目标**：把 dshmarket 的排除条目代管机制复刻进 dsh-m，并做两处有意超出：登记（装后主动并入豁免条目）与原子写。desktop 与 web 双 profile 通用（文件缺席/解析失败一律跳过，fail-open）。
2. **机理**：采"首条规则生效"论；规范形态 = **每包一条、版本并集复合**（`name@a || b || c`）。不要求在位实验裁决机理。
3. **红线修订**：desktop "绝不直接编辑 pnpm-workspace.yaml"（ADR-0005 ③）收窄出例外——仅 `minimumReleaseAgeExclude` 块、仅委派前后挂点、原子写（复用 `@deepseek-ai/dsh-atomic-write`）、解析失败即弃、每次编辑留痕。落稿六处：ADR-0009（新；0008 已被并行发布的 0.9.23 占用，顺延）、release-age.ts 模块头、CHANGELOG、GLOSSARY、know-how 020 §8、DESIGN.md 一行引用。
4. **三挂点**：① 委派前治理（修复同名多规则等坏形态，只修不建）；② 成功后登记（仅发布时刻可判"窗口内"的目标）；③ 双码失败 → 治理 → changed 则重试一次（至多一次，仅 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`/`ERR_PNPM_NO_MATURE_MATCHING_VERSION` 两码，重试仍败走既有失败翻译）。
5. **登记形态细则**：并入该包既有规则；无既有规则时——scoped → 精确单条；非 scoped 且存在异于目标的上一版本 → 目标+上一版双选择器复合；全新包首装 → 精确单条（运行期观察项：若后续被锁校验 flag，登记回退规则切换为包名级，预案写入 ADR，不在实现期测试）。
6. **预检收敛**：默认策略（未显式设置 age 且未开 strict）→ 放行委派 + 陈述性 notice；显式设置 `minimumReleaseAge` 或 `minimumReleaseAgeStrict: true` → 维持拒绝并给可重试时刻。原②腿（锁内死规则预拒绝）退役，由治理取代。
7. **fail-open**：治理/登记任何失败不阻塞委派，pnpm 是最终执行者；失败翻译与账实分裂复读（0.9.19 已有）接管。
8. **留痕纪律**：操作记录只落排除块的 name@version 集合与动作短语，绝不整文件转储（该文件 allowBuilds git 键可含凭据）。
9. **UI**：陈述不警告；通过现有 `output` 附加句到达三端，不改 client/tools 渲染。
10. **栅栏（评估过不做，落 ADR 附录）**：hoist 重建、host peer 关装、fetch 超时加长、瞬时网络重试、allowBuilds 坏键清除、一次性 bypass、notOnMirror 裸名回退、heldRelease「仍安装」、清理满期条目。
11. **版本**：停在 0.9.x，具体版本号推送前由主人定（另一 agent 并行开发 dsh-m 功能）；不动 `package.json`；CHANGELOG 挂待定标题。
12. **流程**：文档先行（ADR+GLOSSARY+计划）；实现与验收分两段——全量门禁 + 集成测试在实现期完成，端到端验收 gate 在版本合流发布装机后；know-how 020 §8 在端到端验收后写。
13. **测试纪律**：node:test；`DSHM_CACHE_DIR` 指 mkdtemp；绝不触碰 `~/.dsh`；fixture 脱敏手写。
