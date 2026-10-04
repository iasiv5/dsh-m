# dsh-m · DSH 插件市场

面向大众的 DeepSeek Harness 插件市场：双清单收录（精选策展 + 社区目录）、安装、卸载、升级 DSH 插件。
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

**主清单（Primary Registry）**:
dsh-m 手工策展的收录清单层：包内 registry.json（默认清单）或 registryUrl 自定义覆盖源，二选一整体替换；verified 实测与收录文案标准的载体。UI 可见名「精选清单」（设置页卡片题与市场「精选」分区同名；0.7 前旧称「收录清单」）。
_Avoid_: 官方清单（「官方」留给 DeepSeek）、第一 registry、收录清单（旧称）

**社区清单（Community Catalog）**:
awesome-dsh-plugin 维护的全量社区目录，经 npm 包 dsh-plugin-catalog 版本化分发；只读叠加层，不可被用户替换，也不做包内快照兜底。
_Avoid_: awesome registry、第二清单、社区 registry

**合并市场（Merged Market）**:
主清单 ∪ 社区清单去重后的数据集合；合并只发生在数据层（主清单恒优先），展示层按社区区/精选区分区呈现；GUI、agent 工具与 CLI 三端同源同语义。
_Avoid_: 混合清单、全量列表、合并视图（展示层已分区）

**目录适配层（Catalog Adapter）**:
把社区清单原生条目转换为收录条目的翻译模块；分类保留原生值不转译，id 需合成保证唯一。
_Avoid_: schema 转换器、normalize 层

**精选分类（Primary Categories）**:
主清单使用的五个一级分类（market/tools/ui/search/other），主清单 schema 严格校验维持不变；分区制下与社区分类彻底解耦，仅作用于精选区。
_Avoid_: 原生分类、旧分类

**社区分类（Community Categories）**:
社区清单的原生分类，开放集，仅作用于社区区：已知条目带中英双语标签（英文取上游目录 categories.en，中文仍由包内单一事实源维护），上游新增的未知分类原样渲染进临时组，等发版收录标签。
_Avoid_: 扩展分类、子分类

**能力披露（Capability Disclosure）**:
社区条目自带的能力扫描结果与红线组合；缺省 = 未扫描 ≠ 未检出；只在详情 Modal 展示且默认收起，卡片不打标。
_Avoid_: 权限声明、安全审查（收录清单明确不做）

**社区区（Community Zone）**:
市场面板的默认落地分区，展示合并市场中的社区清单条目（排除与主清单重复者），自带独立的分类、排序、分页状态；搜索自 0.9.25 起为跨区全局（社区 + 精选一并命中，见「跨区搜索」）。
_Avoid_: 社区 tab（口语可，文档用术语）、社区市场

**精选区（Primary Zone）**:
展示主清单条目的市场分区，策展顺序即排序，常态单页直出（超出单页容量时降级复用社区区分页器）；verified 与收录文案标准的展示载体；搜索为跨区全局（同「跨区搜索」）。
_Avoid_: 精选 tab（口语可，文档用术语）、主清单区

**跨区搜索（Cross-Zone Search）**:
0.9.25 起的市场搜索语义：任一分区的搜索框同时命中社区与精选（`source=all` 相关性统一排序），清空关键词回到本区浏览态；摘要行报两分区精确命中数，精选命中页内置顶分组。搜索即全局、浏览即分区。
_Avoid_: 全局搜索（与宿主全局搜索混淆）、合并搜索

**收藏（Favorites）**:
浏览器 localStorage 本地的插件收藏（市场第三分区）；目录中已下架的 stale 条目单独提示并可一键清理，不进 profile、不进服务端。
_Avoid_: 订阅、书签

**操作记录（Operation Record）**:
一个变更操作（安装/升级/卸载/开关）的全局状态条目（queued/running/input=冲突待决/done/warned/failed），持久化于 localStorage，恢复时逐条校验仍成立才执行；状态不挂卡片。
_Avoid_: 任务列表、任务队列（指持久化整体时口语可）

**生效判定（Activation Classification）**:
对一次升级「新版本如何生效」的三态分类：纯客户端更新（刷新页面即生效，无需重启）、需重启、未知（未能判定，按需重启保守对待）。只对 npm 源升级给出；是给三端的操作建议，不是 Profile 变更事务的结果；任何检测失败一律落为未知——重启永远可用。
_Avoid_: 无需重启（对未知态的绝对化承诺）、热更新（宿主的客户端热更机制，不是本判定）、application 状态（那是 Profile 变更事务的词汇）

**纯客户端更新（Client-only Update）**:
升级差异全部落在插件客户端 bundle、宿主侧文件零变化的升级；宿主进程照旧运行，只需客户端采用新 bundle（刷新页面，多数场景自动热更）。仅版本号字段的差异不构成宿主侧变化。
_Avoid_: 前端更新、UI 更新（过宽）、live 更新（与开关的即时生效态撞词）

**两段加载（Two-phase Load）**:
已装页的数据分两段并行获取：第一段快列表（跳过探测段，秒开），第二段 `installedUpdates` 以 TTL=0 真实探测后把更新提示就地补上；探测完成前的短暂无提示不是「没得更新」（ADR-0008）。
_Avoid_: 检查更新按钮（本设计无手动入口）、延迟加载（第一段并不推迟，两段同时发起）

**首条规则（First Rule）**:
pnpm 的排除条目校验每包名只认第一条规则、同名后续规则死亡（dshmarket #732 实证）；治理的目标形态是每包一条、版本并集复合（ADR-0009）。_Avoid_: 认可形态/不认可形态（know-how 020 §2.4 旧口径，机理误称，已退役）

**排除条目（Release-Age Exclusion）**:
profile `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 中一条豁免规则；规范形态 = 每包一条版本并集复合（`name@a || b`）。_Avoid_: 白名单、排除项

**治理（Govern）**:
委派前/双码失败后把排除块修复为规范形态的动作（同名多规则合并）；只修不建。_Avoid_: 修复、清理

**登记（Register）**:
装机成功后把等待期内目标版本以规范形态并入排除块的动作；仅发布时刻可判「窗口内」的目标触发。_Avoid_: 追加（pnpm 自动行为另有其名）、pin

**等待期（Release Age）**:
`minimumReleaseAge` 窗口，缺省 1440 分钟（pnpm 11.7 实测）；显式设置或 `minimumReleaseAgeStrict` 开启时，点名窗口内新版本会被拒。_Avoid_: 冷却期、隔离期

**体检（Doctor）**:
对单个 profile 的只读健康检查：纯文件系统分析（无进程、无网络、无写入），首期覆盖农场测活、残留物清点、账实一致三类；产物是结构化报告，永不修复（ADR-0010）。CLI 上唯一允许 `--profile desktop` 的子命令（ADR-0011 例外开口；其余命令恒 web）。
_Avoid_: 修复器、清理器、诊断修复（体检不做修复）

**三级严重度（Severity Tiers）**:
体检报告的分级纪律：error（断链或必然阻断启动）/ warning（确认异常但不阻止启动）/ 结构化清单（只列不警，零告警渲染）。清单项永不升格为告警。
_Avoid_: 全部当警告、错误级别（泛称时）

**unknown ≠ broken（第三态）**:
诊断进程「看不见」的对象（官方 in-box、asar 内包、无法判定的布局等）显式标记为 unknown 并保持沉默；看不见不推断为损坏。
_Avoid_: 盲区告警、把解析不到当损坏

**账实分裂（Manifest-Reality Split）**:
profile 三处记账任一不符的形态：package.json 的版本 pin、node_modules 实装版本、pnpm-lock 解析版本（know-how 023 §6.2 实录：pnpm 非零退出拦住 pin 写入，node_modules 已 1.2.7 而 pin 仍 1.2.5）。
_Avoid_: 版本不一致（过泛）、缓存滞后

**残留物（Residue）**:
profile 内陈旧但「可见而非清理」的对象：残留目录（无 package.json 目录、空 scope 目录、pnpm `*_tmp_*` 暂存）与备份文件（`*.bak-*`）。体检只清点不删除——删除正是常被进程句柄拒绝的操作。
_Avoid_: 垃圾文件（暗示可自动清理）、临时文件（过窄）

**农场测活（Farm Liveness）**:
对 profile 可见范围内 `@deepseek-ai/*` 符号链接的存活与指向检查：目标悬空为 error；指向非当前运行时版本的 store 目录为提示级（know-how 014：DSH 升级后唯一现役周期必查项，曾 81 条悬空）。
_Avoid_: 符号链接检查（过泛）、农场修复（体检不修复）
