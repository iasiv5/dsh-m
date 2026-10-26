# 图标解析链：声明图标 → 头像兜底 → 字母占位（0.10.21，ADR-0025）

背景：官方已安装面板的图标约定是 package.json 顶层 `icon` 字段（包内相对路径）或 exports `<specifier>/icon` 子路径导出，经校验（相对路径强制、root/target 两面 realpath 包内 containment、扩展名白名单 .svg/.png/.jpg/.jpeg/.webp、≤256KiB 双重校验、isFile）后转 base64 data URI 内嵌进每次列表 RPC——无独立 HTTP 路由、无缓存，官方兜底是内置 SVG 而非头像（dsh-app-boot 0.2.1-rc.3 iconOf L2085-2119 逐行核对）。dsh-m 改造前现状：Icon 组件里「entry.icon ‖ GitHub 头像 ‖ 字母」三级雏形硬编码一行（chrome.jsx），但 registry.json 的 icon 字段 23 条 0 条在用；已装页显式 `icon:null` 恒走头像（installed-tab）；社区目录上游 dsh-plugin-catalog 无 icon 字段，且非安装包的 manifest icon 拿不到（npm registry 元数据不含、拆 tarball 太贵）。主人原始诉求：头像降为兜底，优先与官方面板同源；顾虑几千插件图标的显示性能。量级事实：服务端分页每页默认 32、上限 96——同屏图标 ≤96 张，「几千并发」不存在。经 3 轮对抗评审（独立评审代理，10 问题全闭环，含 1 阻断）后定案。

## Considered Options

- **维持现状**（icon 字段永不生效、已装页焊死头像）：改动最小，但声明图标通路形同虚设、与官方面板同源无从谈起，被否。
- **后端代理缓存 / 构建期预爬全量图标入库**：为「几千并发图标」这个不存在的负载付服务器流量与维护成本，被否。
- **候选链 + 目录侧 https-URL-only + 已装侧官方语义自读 + 纯前端懒加载（采纳）**：三级候选序（声明图标 → 头像 → 字母），每个候选 URL 仍走 useImgChain 投递（weserv h=96 → 原图 → 败）；registry.json icon 仅认 https URL；已装面板按官方 iconOf 同语义自读本机 manifest 转 data URI；Icon 层 IntersectionObserver 懒加载（rootMargin 200px，照抄 Shot 先例）+ loading=lazy + 浏览器 HTTP 缓存，零后端改动。

## 取舍要点

- **头像兜底是对官方链的自觉扩展**：官方无此级（声明图标失败直接内置 SVG 占位）。市场场景下目录声明/账号头像即插件身份，保留为第二级；字母占位为终底。
- **registry icon 只认 URL、拒收 data URI（主人 Q7 定案）**：防 2MiB registry 总闸被 base64 撑爆、防目录侧夹带内联数据。生效是三层结构：①校验层——validateRegistry 现状即对 icon 做与 homepage 同款 https 强校验、非法值整份清单拒绝（registry.ts L344-352，冻结不动、不放宽不加码）；②客户端 catalogIconUrl 纵深过滤——对不经 validateRegistry 的社区适配路径真实生效；③tests/registry-icon-url.test.mjs 守卫在 PR 阶段前置拦截、先于发布。
- **data URI 唯一合法入口是已装 item 的 iconDataUri**：本机实证、与官方面板逐字节同源，客户端跳过 weserv 直连渲染，且喂空串给 useImgChain（其 !url 守卫不挂 8s 计时器，也避免每渲染对 ~349KB 字符串白算 encodeURIComponent）。
- **Icon 组件 hooks 全量无条件调用**（评审 R-2Q1 阻断修正）：已装页 key=pkg 复用实例，插件升级使候选从无到有时，hook 层提前 return 会让同实例 hook 数变化崩子树；「无候选零 IO 零计时器」由渲染层短路 + useImgChain !url 守卫达成，不付 hook 代价。
- **已装读盘范围收窄**：icon 字节只随 listInstalledWithMeta 显式 `icon:true` 读取（'installedUpdates' probeMode:'only' 与市场查询热路径豁免）；官方每次列表全量重读不缓存的行为照抄——本机盘读、≤256KiB/包，量级可忽略。
- **containment 两面 realpath 逐字对齐官方**（评审 R-3Q1）：root 与 target 都 realpath 后 relative 判逃逸，stat/读文件亦用 realpath——否则 symlink 安装的插件（本机活例 `@iasiv5/dsh-onetree-log` 五层符号链跳出 profile）图标被误判逃逸，或包外文件经 icon 符号链被读入。

## Consequences

- 三面板 + 详情弹窗 + 收藏区 + 聊天工具卡六个消费方共用同一 Icon 候选链：market 页候选 = 目录 icon → 头像 → 字母；installed 页候选 = iconDataUri → 头像 → 字母。
- 回归防线：tests/installed-icon.test.mjs（两面 realpath + symlink 双场景）、tests/client-icon-view.test.mjs（候选序纯逻辑）、tests/registry-icon-url.test.mjs（https 守卫）、tests/installed.test.mjs（manifestIcon 双臂透传）、client-render-smoke（SSR 字母占位、走链覆盖由 Probe 断言独立承担）+ client-img-chain / source-anchor-hygiene 既有防线；实机冒烟判据 `listInstalledWithMeta(cfg, { icon: true })` → withIcon ≥ 7（2026-10-26 本机盘点基线，执行时按现场重估）。
- 已知偏离：exports `<specifier>/icon` 兜底依赖 import.meta.resolve（best-effort，bundler 改写或 resolve 失败时该类插件已装页落头像）；manifestIcon 300 字符截断（homepage 字段惯例；官方对路径无长度限制，超长合法路径截坏后解析 null 落头像，行为安全）。
- 精选清单已为 16/23 条目补 icon（jsDelivr pin 精确版本、逐条 HEAD 200 + image/* 验证；其余 7 条包内无图标文件，落头像，不硬造——缺席名单：modsearch、browser-skill-dsh-plugin、dsh-weknora、dsh-auth、dsh-server-deck、ds-bot、dsh-mermaid）；上游 dsh-plugin-catalog 长出 icon 字段时，需在 community-adapter 封闭白名单（L209-234）补一行透传方入链①，客户端 https 过滤届时已就位。
- 同插件双面图标可能不同源：市场详情弹窗走目录 URL、已装页走 data URI——B2/B3 的固有结果，观感上均为「声明图标」。
- 后续可选项（不在本期）：exports 解析加固；「非法 icon 单条降级而非整份拒绝」属 validateRegistry 行为变更、需主人单独立决。

## 增补（2026-10-27，本机体验反馈）

1. **市场/精选/社区页 join 本机声明图标（主人修订全局约束 4）**：本机体验发现「已装插件在已装页有 logo、精选页却落头像」的割裂——声明图标明明在本机盘上，不该因清单数据未推送而空转链①。解法：listMarket 页内 matched 已装条目 join iconDataUri（`attachEntryIconDataUris`，读盘页面级有界：≤页大小、仅 matched 条目）。客户端候选序不变：目录 icon URL 优先、本机 data URI 次之——registry.json 推送后精选自然过渡到目录图标，无行为跳变。测试：helper 单测 + listMarket 接线测试（接线行被删必红）。
2. **B1 显示侧底板**：细线稿 SVG 在字母兜底的淡紫粉渐变底上对比度不足（pastel on pastel）。拆分：渐变底保留给字母态（div.dshm-icon），img 态垫主题底板（`var(--dsw-alias-bg-layer-1)`，亮色≈浅灰白、暗色≈深底）。素材治本（描边加粗/提饱和/glyph 顶满 viewBox）另行走插件素材改造，不在本 ADR 范围。
