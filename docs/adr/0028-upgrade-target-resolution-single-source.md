# 升级目标解析单源——upgrade-target module（架构复审 2026-10-30）

发起自 2026-10-30 代码库架构复审（钢人裁决版，improve-codebase-architecture 流程）：唯一选中任务。GLOSSARY「来源自证更新」「合成条目」有名有 ADR，但判定实现无 owning module——同一语义三处并存、靠评审纪律对齐：

- **双梯**：`upgradePluginLocked`（market-mutation.ts）与 `desktopUpgradeLocked`（profile-ops.ts）的条目解析梯（主清单 `matchInstalledByEntry` → 物化合并市场 `lookupInstalledAll` → `synthesizeInstallableEntry` 合成兜底）近逐字双份，注释成对镜像（两处同样的「0.5.1 同语义」「0.9.68 ADR-0016/R2-3」），commit 标题以「同构」自证（8080c0a / 860cfb4）。
- **读写漂移已发生**：c9faf21 整个 commit 的存在理由是读侧投影 `upgradePathFor` 与写侧合成 `synthesizeInstallableEntry` 判据漂移——ADR-0026 修订段自认「此前判 synthesized，实际升级会抛不支持」。漂移不是假设，是已坐实的失败模式。
- **锁步史**：六周内三次语义事件（0.5.1 社区兜底 → ADR-0016 `lookupInstalledAll` → ADR-0026 合成条目）每次双落地、双写测试、靠「同构」评审对齐。

## 我们决定（2026-10-30，grill 决议 Q1–Q11）

1. **判定单源**：升级目标解析（GLOSSARY「升级目标解析」词条，2026-10-30 已立）全仓库唯一产地 `src/core/upgrade-target.ts`——已装项 → 收录命中（主清单/社区让位）/ 合成条目 / unsupported（附成因码）的判定，读侧投影与写侧执行（web/desktop 双梯）消费同一判定；「分支口径逐点一致」的评审义务自此消灭。
2. **中性 module 位置**：不入 market-mutation（读侧 market.ts 也消费，放写侧 = 读 import 写的 seam inversion，且违背 ADR-0024 无转手 re-export 精神）、不入 merged-market（物化合并市场是数据集合的拥有者，不吸收变更政策）。判据原子 `GITHUB_SPEC_RE` / `isLocalSpec` 产地不变，仍出自 merged-market（ADR-0026 修订段口径延续）。
3. **接口形态**：判别联合——`{ kind:'resolved'; entry; matchPath:'primary'|'community'|'synthesized' } | { kind:'unsupported'; reason:{ code; message } }`；`reason.code` 为闭集码（local-spec / github-spec-unparseable / source-unresolvable）。错误信封映射留在各 backend 边缘：web 边缘重抛 `UpgradePathUnsupportedError`（message 字节不变）、desktop 边缘翻译 `DesktopOpsError('upgrade-unsupported')`（信封不变）。对外 `upgradePath` 三态投影语义与金样不变。
4. **零行为边界**：本轮零行为搬家；「web/desktop unsupported 信封不对称 + reason envelope 透出 + client/cli 成因文案修正」为 follow-up（见下）。
5. **deadline 归一**：社区解析 deadline 收敛为 module 内单一 60s 常量（两 backend 现值同 60s，desktop 私有副本删除）。
6. **install 侧不动**：`resolveRegistryEntry`（id → 条目，安装入口）维持 market-mutation 现状——语义不同源、无同构义务、已被两 profile 共享。
7. **生效判定双胞胎不入本轮**：ADR-0007 遗留的逐字双份生效判定块（两 Locked 尾段）记 follow-up——同病同方，待本 module 样板立好后迁移。

## Considered Options

- **market-mutation 内 export**（严守 ADR-0024「写侧变更落 market-mutation」字面）：读侧 market.ts 反向 import 写侧，seam inversion——否决。
- **并入 merged-market**：物化合并市场吸收变更政策，职责越界——否决。
- **两刀迁移**（先 web 后 desktop 分开发版）：同构义务再背一个发版周期——否决；单 issue 多 Task 一刀出仓（T1 判据归一 → T2 壳 → T3 web → T4 desktop → T5 测试瘦身 → T6 导航）。
- **顺手统一 web 错误信封**：破坏零行为承诺，金样/批量 failureClass 语义连带——否决，归 follow-up。
- **只收写侧双梯、判据不归一**：c9faf21 证明读写漂移是主要失败模式，只杀双梯复制不杀漂移——否决。

## Consequences

- **漂移免疫**：判定一处改动，三消费端同步；下次目录语义演进（让位细则、community v2 等）单点落地。
- **测试面收敛**：梯子分支判定迁往新 seam 表驱动套件，market-mutation / profile-ops 镜像用例瘦身为「接线 + 信封映射」薄层——镜像套件今日保护的是「两份相似」而非「同一政策」。
- **文档**：GLOSSARY「升级目标解析」已立；AGENTS.md 导航随实现补行；实施计划见 `docs/plans/2026-10-30-upgrade-target-resolution-implementation-plan.md`。
- **上游对照锚**（dsh-market 1.73.1 镜像复核）：`catalog-local-match.ts` 先例——doc 首句「Shared by the host restore route and the Market client so both refuse the same wrong guesses」与本决定同构，验证共享判定模块形态；其判别联合 + 闭集 `CatalogRestoreReason` 码为 reason 形态参照。两条避坑入计划约束：#485（弱信号不得越强信号，判定优先级严格有序）、#589（逐卡逐键全量过滤实测 ~300ms/渲染——本 module 消费 ADR-0016 物化代，不逐项重 adapt、不新增缓存层）。
- **Follow-up 清单**（已开 issue）：① 生效判定双胞胎收编（ADR-0007 块，#34）；② web/desktop unsupported 信封统一 + reason envelope 透出 + client/cli 成因文案修正（i18n「本地链接安装」硬编码在 github-spec 场景失实，#35）——已实施（0.11.3）；③ client doUpgrade 三胞胎编排出仓 + ops 在途谓词收权 + market-state 几何搬家/drainRestored 退役（backlog 合并单，#36）。
