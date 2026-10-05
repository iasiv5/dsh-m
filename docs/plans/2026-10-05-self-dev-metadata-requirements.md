# 需求与目标（grilling 共识记录 · 2026-10-05）

> 本文件是主人逐条确认的需求基准，供实施计划评审对照使用。只记录「决定了什么」，不记录论证过程。
> 术语定义见 `dsh-m/GLOSSARY.md`：解耦条目（Decoupled Entry）、自用条目（Internal Entry）、实测版本清单（Verified Runtimes）。

## 1. 原始诉求

梳理 dsh-m registry.json 八个自研插件的描述；识别其中与 DSH 版本解耦的部分并结构化表达；为纯自用插件做特殊标记；让现有与未来自研插件在 dsh-m 中更好展示。

## 2. 已确认决策（R1–R15）

- **R1 解耦判定 = 实操口径**：DSH 升级后，该插件「大概率不需要跟着发适配新版」。
- **R2 解耦载体 = 字段＋文案**：结构化字段做事实源供三端消费，copy-guide 句式同步收编。
- **R3 受众两档起步**：public / internal 两档（不设第三档）；公司同事属内部推广场景，不是 dsh-m 大众读者。
- **R4 标记载体 = 字段，不动策展五桶**：不加新分类桶、不移出主清单（主清单撤出的反例：社区清单浮升更尴尬、失去换机重装便利）。
- **R5 发布打包一次**：解耦字段＋受众字段合成同一次 schema 变更；先发 dsh-m 新版、再推 registry.json @main；旧客户端拒收新 registry → 回落缓存 → 升级即愈（0.9.17 alsoCategories「例行过渡」先例）。
- **R6（主人改判）dsh-quota-watch 也是解耦条目**；数据卫生问题纳入本次范围一并处理，不留尾巴。
- **R7（主人改判）internal 允许被搜索出来**：三端照常返回与展示，只在 description 或其他位置标注「作者自用」即可；因为未来内部推广时也要用搜索功能。不采用「agent 通道默认过滤」方案。
- **R8（主人改判）解耦条目删除 verified 数组**：与 DSH 版本无关的插件不保留版本实测数组；历史记录归 git 与各仓库文档。
- **R9 字段形态**：`decoupled?: true`（只声明 true，缺省=常规耦合）＋ `audience?: 'public' | 'internal'`（缺省 public，值集预留 'team' 扩位但本期不接受）。否决 `hostCoupling` 单值枚举与 `flags` 旗帜数组。
- **R10 八条目逐条终态**：

| 条目 | audience | decoupled | verified | 文案动作 |
|---|---|---|---|---|
| dsh-m | public | — | 保留 | 无 |
| dsh-skins | public | — | 保留 | 无 |
| dsh-skip-browser-auth | public | — | 保留 | 无 |
| dsh-copilot-auth | public | — | 保留 | 无 |
| dsh-quota-watch | public | ✓ | 删除 | 补「版本无关」尾句 |
| dsh-surf | internal | ✓ | 删除 | 补「版本无关」尾句 |
| dsh-obmc-web | internal | ✓ | 删除 | 补「版本无关」尾句 |
| dsh-onetree-log | internal | ✓ | 删除 | 「已适配 0.1.7-rc.2」句替换为「版本无关」句 |

- **R11 标注文案**：GUI 徽章「作者自用」「版本无关」；三端搜索输出对 internal 条目加「作者自用」标。
- **R12（已完成）GLOSSARY 三个术语已入册**：解耦条目、自用条目、实测版本清单交叉引用。
- **R13 self-dev 区排序**：「公开在前、内部在后」（精选区策展顺序即排序）。
- **R14 共识记录落 DESIGN.md 新节**（§2.7），不单开 ADR。
- **R15 数据卫生核验**：四个 coupled 条目的 verified 现状已含 0.2.0-rc.1/rc.2、无欠账；四个 decoupled 条目 verified 删除后历史归档。

## 3. 配套纪律（约束性事实）

- 文案硬预算：description ≤60 全角当量（全角=1、ASCII=0.5）；「版本无关，详见仓库。」标准形，放不下用紧凑形「版本无关。」（两级形态均合法，需写入 copy-guide）。
- `dshm_search` 工具描述需写明推荐纪律：internal 勿向普通用户主动推荐，点名或内部推广场景除外（R7 的软性约束形态）。
- npm 发版纪律：OIDC staged 发布存在 17–55 分钟假绿窗口（know-how 018），publish 绿 ≠ 已上架。
- verified 填值纪律：只记 DSH 运行时版本，机器门禁 validate-registry warn（know-how 022）。
- know-how 008 是「升级后自研条目兼容声明核对」清单，本需求落地后其范围应随 decoupled 标记收缩。

## 4. 验收视角

需求覆盖完整性 / 步骤可行性与顺序依赖 / 有无遗漏多余 / 风险与回退 / 每步可验证的完成标准。
