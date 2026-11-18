# 合并 agent 工具：dshm_outdated 并入 dshm_list

状态：Proposed（工作决议，待主人复核；未发版）

背景：`dshm_list` 与 `dshm_outdated` 调用同一探测，items 数据几乎重叠（只差 `registryId` 与 `latestTag`）。两者的文字结果各有缺口：`dshm_list` 不显示 GitHub 升级与检查失败；注册表不可用时，`dshm_outdated` 报「全部最新」，`dshm_list` 把全部插件标为「非市场」。模型可能同时调用两者，产生两份结果与两张卡片。ADR-0010 已确立「工具描述是宿主 agent 的常驻上下文，不随意增加工具数」。

决定：`dshm_list` 成为 agent 面唯一的已装插件与更新状态工具；`dshm_outdated` 不再注册给 agent，不保留别名。文字与卡片区分「未检查」与「已最新」，市场归属增加「未知」一态。CLI 的 `dshm list` / `dshm outdated` 命令保持不变。

考虑过的替代方案：
- 保留两个工具，只修标签与卡片：否决。模型仍可能同时调用，两份结果与两张卡片仍在。
- 改名为 `dshm_status`：否决。GLOSSARY 把「状态」列为过载词；改名扩大迁移面，收益只在名字。
- 保留 `dshm_outdated` 作为别名：否决。两个入口会重新并存。
- 合并 CLI 命令：否决。CLI 是人与脚本的稳定契约，收益只在 agent 侧。

后果：
- agent 工具从 8 个减为 7 个（含 `dshm_toggle`）。
- 历史会话中的 `dshm_outdated` 调用按通用卡片展示，不做兼容。
- 工具面需要宿主重启后才对已装实例生效；发版与重启属于后续需要明确批准的动作，本次不执行。
- 无收录条目的 GitHub 安装仍不探测，以「未检查」如实呈现；扩大探测是独立的 GitHub 预算决策（ADR-0008、ADR-0026）。
