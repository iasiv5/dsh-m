# 已装卡命名：收录名为主、包名为辅（已装/市场一致性 2026-11-01）

发起自 2026-11-01 已装页与市场页命名不一致的钢人评估＋grill 决议 Q1–Q7（对话在案）。三个视图（市场/收藏/已装）共用同一 `Card` 组件与 `.dshm-name` 样式，主名却分属两套语言：市场卡与收藏卡主名是**收录名**（GLOSSARY「收录名」，如 "DSH Skins"），已装卡主名是**现名**（插件自带清单的 name，npm 插件恒等于包名，installed.ts `name` 产地）。后果有二：

- 同一插件在相邻两个标签页叫两个名字（"@inventec/dsh-onetree-l…" ↔ "OneTree Log"），跨页对号靠猜；
- scoped 包名在 `.dshm-name`（单行 ellipsis）下必截断（"@inventec/dsh-copilot-a…"），识别度趋零。

而数据侧 join 点早已存在：`matchInstalled`（market.ts）命中时已把 `registryId` / `registryGithub` / `registryIcon` 写到已装条目上——那一刻收录条目（含社区收录条目，`CommunityEntry extends Omit<RegistryEntry,'category'>`，name 必有）就在手上，收录名只是没带出来。

## 我们决定（2026-11-01，grill 决议 Q1–Q7）

1. **主名回退语义（Q1）**：已装卡主名 = 收录命中（含社区收录）→ 收录名；未命中 / 收录名为空串 / registry 不可用早退臂（matchInstalled 不执行）→ 回退现名。回退路径与旧版逐字节一致。
2. **包名保留形态（Q2）**：判据布尔式「收录名在写且 ≠ 包名」（评审 P2 精确化：比较对象是收录名原值，非回退后主名；空串已归 null，非市场/未命中卡判据恒假）时，卡片 byline 行（复用市场卡 verified 同款 `dsvm-byline` 容器，styles.js 既有样式零新增）显示包名；主名 span 恒挂 `title`（完整主名，判据为真时附包名）防截断。非市场安装卡不新增 DOM 节点。
3. **字段命名（Q7）**：`registryName`，对齐 `registryId` / `registryGithub` / `registryIcon` 命名族；`matchInstalled` 单点写入，早退臂天然不写。
4. **操作语境口径不动（Q3/Q6）**：`dshm_list` payload 与 `renderList`、CLI、toast/确认弹窗文案（`notify.toggled.*` 等）保持包名——操作对象要精确、与工具面口径一致；GUI 一致性目标不涉及工具面。
5. **范围外（Q4/Q5）**：市场/收藏卡反向补包名、已装描述换收录描述，均不捆绑本轮，另立议题。

## Considered Options

- **完全替换为收录名**：非市场安装无收录元数据，页面混排两种命名；展示名可撞车——否决，回退语义消解。
- **纯截断美化**（scope 缩写等）：治标，两套名字仍并存——否决。
- **包名进 sub 行**：sub 行已有相位/版本/来源，挤占——否决，byline 容器现成。
- **市场/收藏反向补包名捆绑本轮**：违背最小 diff——否决，可另立。

## Consequences

- GUI 三视图主名语言统一（GLOSSARY「收录名」词条同步落盘）；包名可见性由 byline + title + 详情行 `detail.pkg` 三层保留，操作语义零损失。
- 零行为口径（CODING-STANDARDS 承诺格）：非市场/未命中卡 DOM 节点数与旧版一致（仅主名 span 多一个 `title` 属性，值 = 现名）；收录命中卡 +1 个 byline 节点。
- 断言面：`installedViewModel` 新增字段（client-installed-view 直测扩展）；market.test 健康臂/早退臂补 registryName 断言；`tools.ts` / `cli.ts` / golden 金样零触碰。
