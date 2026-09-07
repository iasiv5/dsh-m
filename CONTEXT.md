# dsh-m · DSH 插件市场

个人自用的 DeepSeek Harness 插件市场：收录（registry）、安装、卸载、升级 DSH 插件。
设计共识见 `docs/DESIGN.md`；本文件只是领域术语表。

## Language

**Profile（web profile）**:
插件安装的唯一事实源，即 `$DSH_HOME/profiles/web` 下被 pnpm 管理的那份依赖（package.json / pnpm-lock.yaml / pnpm-workspace.yaml）。
_Avoid_: 安装目录、环境、profile 目录（当泛指整个目录树时）

**收录条目（Registry Entry）**:
registry.json 中描述一个可安装插件的条目：来源（npm 或 GitHub）、分类与描述，不写死版本。
_Avoid_: 插件定义、包信息

**市场安装 / 非市场安装**:
已装插件与收录条目匹配上的标注；匹配不上的标注为非市场安装（来源未知），两类都可卸载/升级。
_Avoid_: 官方安装、第三方安装

**Profile 变更事务（Profile Transaction）**:
对 profile 的一次变更单元，两阶段兑现失败保证：先把三个关键文件逐字节还原到变更前快照（还原后立即验证），再跑 frozen 收敛阶梯处理依赖一致性——阶梯允许对 manifest/lockfile 做**有记录的**受控改写。失败终态承诺「一致」不必然「等同」；收敛耗尽则进入需人工修复态（还原事实单独如实报告）。安装、升级、自升级、卸载都是同一事务的入口。
_Avoid_: 安装流程、回滚流程（回滚只是事务内部的机制）、mutate session

**pnpm 结果分类（pnpm outcome）**:
pnpm/dsh CLI 行为的六类归一解释：ok、retryable-lag（CDN 滞后）、config-drift（配置漂移）、unused-patch（残留补丁）、needs-builds（构建脚本被拦）、hard-fail。上层只消费分类，不解读原始输出。
_Avoid_: 错误码映射、pnpm 错误（指原始报错文本时除外）

**自愈动作（heal action）**:
事务为兑现「要么提交，要么恢复到有记录、可解释的一致终态」所做的某一步收敛动作的记录，由机器可断言的 code 与给人看的 note 组成。
_Avoid_: 修复步骤、heal note（note 只是其中一半）
