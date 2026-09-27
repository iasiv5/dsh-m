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

**settings 兼容层（Settings Compat）**:
host 对 DSH settings 服务双代形态的运行时探测与统一接线：≤0.1.5 走 `register()` scope（get/update/watch），0.1.7-rc.1/rc.2 走 Config `.volatile()` 字段 + `settings.update(ns)` + `loader/volatile-update` 事件；形态不识别降级 cordis 配置文件通路。controller 只消费 plain 值，出站一律解包 Volatile 引用；设置集成失败只降级，不拖垮 tools / webServer。
_Avoid_: 版本号分支（按 API 形态探测，不判 DSH 版本）、设置注册（旧 API 时代用语）

**开关（Enablement Toggle）**:
对已装插件运行状态的可逆切换；内部按插件形态路由到行覆盖或 Bundle 选择两种粒度，对外始终呈现为一个开关。不经 Profile 变更事务，自带文件锁的轻量编辑。
_Avoid_: 启用/禁用按钮（指 UI 控件时才这么叫）、开关功能

**行覆盖（Row Override）**:
写入 profile `cordis.patch.yml` 的单条目 `disabled` 覆盖，单 insert 行插件的开关持久化形态；启用写显式 `disabled: false` 以压过更低层。
_Avoid_: 补丁开关、disabled 条目

**Bundle 选择（Bundle Selection）**:
profile `dsh.profile.bundles` 数组的增删，多行插件（含配置补丁行）的整层开关形态。
_Avoid_: bundle 开关（口语可，文档用术语）

**运行相位（Live Phase）**:
loader fiber 状态在已装页的投影（active / failed / pending / loading / unloading / 无 fiber 即已停用）；是观察量不是存储量，与开关状态互为印证。
_Avoid_: 状态（过载词）、健康度

**委派降级（Delegate-with-Fallback）**:
开关写路径先探测官方 pluginManager 服务并委派、服务缺席时退回 loader 直操作与文件编辑的架构形态；探测按服务存在性，不判 DSH 版本号。读路径始终自读，不随写路径切换。
_Avoid_: 兼容层（与 settings 兼容层混淆）、版本分支

**实测版本清单（Verified Runtimes）**:
收录条目中记录实测通过的历史运行时版本数组；是实测声明而非预测声明，只用于展示与收录质量提示，不做安装拦截依据。
_Avoid_: 兼容范围（semver range 才是范围声明）、compat
