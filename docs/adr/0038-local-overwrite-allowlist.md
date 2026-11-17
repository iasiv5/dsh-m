# ADR-0038 — 本地热部署升级白名单（issue #76：file:/link: 撞名保护 + opt-in 放行）

日期：2026-11-17 · 状态：已接受（随 0.12.21 实现）
关联：ADR-0026（#30 边界承诺）、ADR-0028（升级目标解析单源）、issue #53（红点聚合口径）、issue #76（本案）

## 背景

2026-11-17 外部用户报告（issue #76）：`file:`/`link:` 本地部署的插件与市场同名条目（精选或社区）撞名时，`matchInstalledByEntry` 只比 npm 名、`probeLatest` 拿同名条目的线上版本号比本地版本 → 红点永久误报；`upgradePathFor` 与 `resolveUpgradeTarget` 的 `registryId` 短路抢在 `unsupportedReasonFor`（local-spec 判定，B5 冻结文案）之前 → 点「升级」静默装成**别人家的同名 npm 包**。身份混淆 + 静默成功 = 供应链级风险形态；dsh-m 的升级安全网（失败回滚/自动回装）保护「装的过程」，拦不住「装错的对象」。

该行为同时与 #30（v0.11.0 结案回帖）已发布承诺「`file:`/`link:` 本地开发安装不从线上升级（结构化指引）」冲突——承诺此前只对「无同名命中」场景生效，命中场景被 catalog 短路豁免。

维护者自己的热部署工作流（本地调试 → npm 发布 → dsh-m 点升级覆盖本地副本）恰恰依赖这条短路，是它长期存活无人发现的原因。撞名包与自有包共用同一条 npm 名身份通路，dsh-m 没有任何本地证据可区分两者。

## 决策：默认挡 + 显式白名单（opt-in）

1. **判定序（单源，ADR-0028 纪律）**：本地部署（`local-spec`，file:/link:）未入白名单 → `unsupported`，且**先于** `registryId` 短路（撞名根因）；白名单内本地部署与非本地项同序：`registryId` → `catalog`，否则 `synthesized`。非本地 unsupported 维持既有序（`registryId` → `catalog` 先于 `unsupportedReasonFor` 判定，行为不变）。投影（`upgradePathFor`）与写侧（`resolveUpgradeTarget`）同序；写侧对未入白名单的本地 spec 在 registry 加载之前即早退——零网络、不发请求。
2. **白名单判定原子**：`localOverwriteAllowed(item, allow) := isLocalSpec(item.spec) && allow.has(item.pkg)`——npm 包名 trim 后精确匹配，无通配符（信任边界要窄）。**名单写死在源码（v1.3，2026-11-17 主人定）**：`LOCAL_UPGRADE_ALLOWLIST`（产地 `src/core/local-allow.ts`，12 项维护者自研插件）。增删插件 = 编辑该常量后发版。CLI 可用环境变量 `DSHM_LOCAL_UPGRADE_ALLOW`（逗号/空白分隔）临时追加，不持久。判定集合 `localUpgradeAllowSet(cfg)` = 写死名单 ∪ 环境变量注入；market 装配与 `resolveUpgradeTarget` 两边缘消费同一集合。修订记录：v1.1/v1.2（同日早些时候）曾采用 profile 目录文件 `dshm-allowlist.json` 通道，v1.3 撤除。
3. **adopt-online**：名单内本地部署即使未收录，点升级经合成条目 adopt npm 同名包（`synthesizeInstallableEntry` 白名单例外，升级管线两段安全网全套继承）——名单语义统一为「允许被线上同名版本覆盖」。
4. **探测（probeLatest）**：名单外本地部署早退——不查同名条目的线上版本号，红点不亮；名单内照常（命中收录条目走 entry 探测、未收录走 npm-only 归一键——后者是 adopt-online 的红点信号）。
5. **身份层不动**：`matchInstalledByEntry` 照旧写 `registryId`——徽章/图标/收藏 join 语义零变化。白名单外同名条目残留的「市场」徽章接受为已知妥协：修身份层会让一切本地安装失去图标与徽章（UX 面更大），本案只收口升级与探测两条危险通路；身份层守卫列为后续可选项。
6. **覆盖提示**：详情弹窗一行提示（`detail.localOverwrite.*` 双语键，驱动字段 `localUpgradeAllowed` 条件赋值、非白名单项字段缺席）。不做升级二次确认——白名单即同意，一键覆盖是维护者工作流的核心体验。
7. **二段投影不加字段**：`installedUpdates` 保持「七字段全量裁剪」冻结形状（host-api.test 钉，2026-11-17 普查）；客户端合并经 `...it` 展开保留首段标记，无需二段透传。
8. **名单随 npm 包发布（v1.3 的代价，主人已知悉并接受）**：`lib/` 随 dsh-m 发给所有用户，因此所有安装都带这 12 项。可见影响：其他用户若本地部署了与名单同名的插件（例如自己 fork 的 `dsh-stock-kanban`），会出现可升级红点，点升级会被覆盖为维护者的线上版本。安全面：12 个名字在 npm 上均归 iasiv5 所有（2026-11-17 逐一核验），第三方无法发布同名包，覆盖目标只可能是维护者自己的包——风险由「装成别人的包」降为「被维护者的包替换」，属于行为变化而非供应链风险。CHANGELOG 与回帖须如实披露。

## 备选与否决

- **报告人最小修法原样落地**（unsupported 全序提前、无白名单）：兑现 #30 最彻底，但砍断维护者热部署→一键覆盖工作流（写侧直接拒绝升级、探测跳过失去 npm 新版红点）。否决——撞名保护与自有包覆盖两个场景必须并存。
- **升级时二次确认制**：保留探测/红点现状，仅升级前亮身份确认。红点误报（报告人第一诉求）未解决，只算半个修复。其「亮身份」意图由详情弹窗提示吸收。
- **身份层守卫**（`matchInstalledByEntry` 加本地源排除）：最彻底的身份修复，但本地安装一律失去 registryId（市场徽章/图标/收藏 join 全变），行为面大且不可逆地改变所有本地部署的呈现。列为后续可选，本案不动身份层。
- **名单落在 profile 目录文件**（v1.1/v1.2 方案，`dshm-allowlist.json`）：只影响每台机器自己，新增插件无需发版。但 web 与 desktop 两台机器需各维护一份，且名单与代码版本脱节。2026-11-17 主人选择写死在源码（接受决策 8 的代价），文件通道撤除。
- **维护者名下名单的核验**：12 项写死于源码前逐一核验（npm `/latest`，maintainer=iasiv5，2026-11-17）；`dsh-auth`（hxy91819 的包，本机 runtime link 副本同源同版）**不进名单**——保持 runtime 钉版语义。

## 后果

- 名单外本地部署（除写死名单的 12 个名字外的全部本地部署）：红点消失、批量升级跳过（既有 `installed.upgradeBatch.skipped.local-spec` 键系直接复用）、点升级得结构化指引——#30 承诺首次在全部场景成立。
- 名单内本地部署（写死名单 12 项）：与 npm 安装同等待遇（红点/升级/覆盖），另带 `localUpgradeAllowed` 标记与详情提示。
- 随包发布的可见变化（决策 8）：其他用户本地部署的同名插件会出现可升级红点，覆盖目标是维护者的 npm 包。
- 收口范围：仅本地部署（`local-spec`）的判定序改变。非本地 unsupported（如 `source=unknown` 撞名条目）维持既有行为（`registryId` 先于判定），本次不改，避免行为面外溢。
- 测试面：新增 15 用例（upgrade-target 8 + market 3 + local-allow 4），红证据与绿判定见 `docs/plans/2026-11-17-issue76-local-overwrite-allowlist-implementation-plan.md`。
