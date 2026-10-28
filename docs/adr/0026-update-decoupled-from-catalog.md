# 更新与收录解耦——来源自证更新（issue #30）

dsh-m issue #30（chenjiang2025，2026-10-27）：「不是经 dsh-m 收录的插件不能更新的话能不能先把别的更新了，再单独列出不能更新的方便手动更新」。主人裁决：排序后置是治标，要求对齐上游模型治本。

断裂面事实（0.10.x 源码核实）：**检测侧早已按「来源自证」运行，升级侧却要求收录匹配**。`probeLatest` 对不在任何清单的已装 npm 包直接按包名探 dist-tag latest（"npm-only" 缓存键，market.ts），github 源按已装 spec 探 HEAD；而 `upgradePluginLocked` / `desktopUpgradeLocked` 要求主清单或社区目录匹配出条目，miss 即硬抛「不是经 dsh-m 收录的插件」（market-mutation.ts / profile-ops.ts）。GLOSSARY「市场安装 / 非市场安装」词条自始声明「两类都可卸载/升级」——升级半句从未被代码兑现。

上游 dsh-market（npm `dshmarket`，参考镜像 1.73.1 复核）的生产模型：更新检测与执行一律以 profile 已装 spec 自身来源为准——「git HEAD for github installs, the npm latest dist-tag for registry installs」（updates.ts）；执行从 manifest `dependencies[name]` 取 spec 重解析（「Re-running add re-resolves the source」）。目录只把守三处：按 URL 装新插件、兼容预检路由（防 open proxy）、`file:`/`link:` 本地开发恢复特例。该模型自 0.1.0 即为地基，1.66.3→1.73.1 仅成熟度补丁，未动架构。

可行性佐证（本仓既有机器）：`selfUpgrade`（npmLatest + integrity fail-closed + install-npm 事务）已证明无条目升级通路存在；`InstallableEntry` 为四字段 Pick（id/source/npm/github），从已装项本地合成即可让整条安装管线——build 审批、patch 层、兼容预检、release-age、desktop 两步兜底、降级恢复、账实复读、外部操作记录、生效判定——原样服务非市场安装；desktop 的拒绝点仅在入口那一次条目查找（profile-ops.ts），执行层 `installBundle` 接受任意 spec。

## 我们决定（2026-10-28，grill 决议 Q1–Q3）

1. **全解耦（npm + github 源，web + desktop profile 同期）**：升级支持一切已装插件。非市场安装经「合成条目」走与市场安装同一条升级管线（web `installEntryLocked`、desktop `runManagedInstall` 零特判）；两步升级、降级恢复、账实复读、生效判定等既有安全网全部继承。
2. **合成条目（Synthesized Entry）**：条目查找 miss 时，从已装项自身来源信息本地合成最小 `InstallableEntry`；github 源解析 `github:owner/repo#sha` 后重锁 HEAD，兼容预检维持 `compatSkipped: 'github-source'` 标注语义（预检可跳、build 审批不跳）。
3. **收录清单故障免疫**：registry 加载失败/不可用不再硬阻断升级——条目查找定位为元数据增强而非升级前置。不可用时对已装 npm 目标走合成条目路径（身份等价：npm 匹配的 `entry.npm` 即已装包名，github 匹配的 `entry.github` 即 spec 仓库）；策展元数据缺席如实降级，不冒充完整。
4. **批量失败分类分流**：一键升级的逐项结果从 boolean 升级为三态——**目标级失败**（单包网络错、等待期拦截、个别包异常）跳过继续、末尾汇总；**系统性失败**（装后守卫拦截、事务半残）维持短路（issue #10 修复语义不变）。issue #30 的「排序后置」不采纳：治本后非市场目标可升级，排序特判失去对象；dsh-m 自身收尾定序保留。
5. **边界（对齐上游）**：`file:`/`link:` 本地开发安装不做线上自动升级（结构化指引「本地链接插件从其 checkout 更新」）；安装侧收录门禁不变——`dshm_install` 仍要求收录 id，安装代理面不扩大。
6. **升级通路投影**：`dshm_list` / `dshm_outdated` / 已装页为每个已装项给出升级通路投影（收录匹配 / 合成条目 / 不支持 + 原因），面板、agent 工具、CLI 三端同源同语义，agent 侧据此分流而非试错。

## Considered Options

- **半解耦（仅 npm 源）**：github 源的检测能力已有（spec 探 HEAD），独缺升级是对称性自残；desktop 官方管理器本就接受任意 spec，拒绝无安全收益——否决，作为第二刀并入全解耦。
- **纯治标（issue #30 原案：不可升级项排序后置）**：只治批量中断，「检测得到却升不了」的主症状原样保留，排序特判是给断裂面打补丁——主人裁决否决（治标不治本）。
- **委托官方 CLI（`dsh plugin update`）**：输出、事务、守卫语义不可控，无法与 Profile 变更事务、外部操作记录、生效判定对账——否决；`dsh-cli` 保留为桌面域既有委派通道，不作升级解耦的实现。
- **维持现状 + 修订术语表**：让文档迁就缺陷，倒置——否决。

## Consequences

- **升级不再依赖收录清单存活**：registry 故障从「全部升级硬失败」降级为「策展元数据缺席」；升级错误面收敛，收录清单的可用性职责收敛到浏览与安装推荐。
- **安全面不扩大**：安装-by-id 门禁、build 审批、release-age 等待期、npm 源兼容预检、desktop 两步安全网对非市场安装同等生效；升级不构成 open proxy——目标必须已在本 profile 安装（与上游 updates 路由同一边界论证）。
- **术语兑现**：GLOSSARY「市场安装 / 非市场安装」的升级承诺自此为真；新增「来源自证更新」「合成条目」「目标级失败 / 系统性失败」三词条。
- **上游对照锚**：dsh-market 自 0.1.0 起「更新 = 按已装来源重解析」模型生产验证十年未变；后续可参照其 UPDATE-API-V1 的失败码纪律（`DOWNGRADE_DETECTED` / `RESOLVED_VERSION_MISMATCH`、操作记录与恢复点）演进本仓的升级终态报告。
- 实施计划（分刀顺序、测试锚、验证门）另立 `docs/plans/` 文档，遵循 CODING-STANDARDS 的测试锚与证据规则。
