# dsh-m — DeepSeek Harness 插件市场

[![Release](https://img.shields.io/github/v/release/iasiv5/dsh-m?label=Release&sort=semver)](../../releases)
[![npm](https://img.shields.io/npm/v/dsh-m?label=npm)](https://www.npmjs.com/package/dsh-m)
[![Registry Check](https://img.shields.io/github/actions/workflow/status/iasiv5/dsh-m/registry.yml?branch=main&label=Registry%20Check)](../../actions/workflows/registry.yml)
[![License](https://img.shields.io/github/license/iasiv5/dsh-m?label=License)](./LICENSE)
[![DSH Web](https://img.shields.io/badge/DSH%20Web-0.1.2--rc.1%20%E2%86%92%200.2.0--rc.2%20dual--API-2563eb)](#faq)

[English](./README.en.md) · 中文

可自定义收录清单（Registry）的 DeepSeek Harness (DSH) 插件市场：**收录 · 安装 · 卸载 · 升级**，全部本机完成。以 DSH web 插件形态运行——侧栏「插件市场」打开三视图面板，同时提供 `dshm_*` agent 工具与 `dshm` CLI；同一包装入 **Web（`web`）与官方 Desktop（`desktop`）两个 profile**（0.9.0 起，能力表见变更节）。

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/marketplace.webp" alt="侧栏「插件市场」面板——市场视图：社区 / 精选 / 收藏三分区、分类 chips 与插件卡片（已实测 / 已安装徽标、npm 与 GitHub 详情链接）" width="100%">
  <p><sub>侧栏「插件市场」· 市场视图：社区 4,200+ · 精选 23 · 收藏，卡片即点即装</sub></p>
</div>

## 30 秒上手

**把下面整段贴给 agent 即可完成安装**：

```text
安装并启用 DSH 插件 dsh-m：
1. 执行 `dsh plugin --profile web add dsh-m`
2. 重启 DSH Web 使插件加载（按部署方式重启对应的 DSH user unit；unit 名称不要硬编码）
3. 轮询 `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080`，直到恢复 200
4. 执行 `curl -s -X POST http://127.0.0.1:3080/dshm -H 'content-type: application/json' -d '{"method":"ping"}'`，确认返回 `plugin: dsh-m`
5. 完成后提醒我刷新页面，点击侧栏底部的「插件市场」
```

> `npm install -g dsh-m` 只安装 `dshm` CLI（终端管理用），**不会**把插件注册进 web profile；与上面插件安装不冲突，可并存。

默认收录清单里的插件包括：DSH Skins、ModSearch、Lark / QQ / 微信 / 企业微信 / 钉钉通道桥，以及 dsh-m 自身。

## 界面（侧栏「插件市场」）

| 视图 | 能力 |
|---|---|
| **市场** | **分区制**（0.7.0）：**社区**（默认落地页，4,000+ 条全量目录）与**精选**（手工策展主清单，单页直出）两个独立分区，各有自己的分类/搜索/排序/分页状态（切 tab 互不重置）；另有**收藏**分区（浏览器本地书签，自动检测下架条目并一键清理）。社区区：分类 chips 两行折叠 + 吸顶收缩、排序（下载量/Star/收录日期 × 升降）、页码窗口化分页（24/48/96 每页）、卡片 byline（作者/下载量/Star）；卡片点开**详情 Modal**（卡片信息超集：下载量窗口三要素、截图灯箱、能力披露默认收起、安装命令）；npm 源锁定最新精确版本，GitHub 源锁定 release/tag 指向的 commit |
| **操作记录** | 安装/升级/卸载/开关全部走全局操作记录（0.7.0）：状态不挂卡片，翻页/搜索/切 tab 不丢；localStorage 持久化，宿主重载后自动恢复未完成操作（逐条校验「此刻仍成立才执行」）；良性前提消失以中性「已跳过」呈现；已装页支持「全部更新 (N)」批量入队 |
| **已装** | 当前 profile（web / desktop，0.9.0 起）实装列表，标注「市场安装 / 非市场安装」；可升级徽标、升级、两段式确认卸载；📖 README 预览（64KB 截断）；**运行相位徽标**（●active / ●failed / ○pending）与**一键开关**（0.4.0：委派官方 pluginManager 服务活体生效，服务缺席时文件级编辑 + 重启提示；dsh-m 自身与官方宿主命脉锁定不可开关） |
| **设置** | registry 地址草稿 +「强制刷新 / 校验并应用 / 恢复默认 / 下载默认 registry.json」；配置地址、生效来源与状态一目了然（仅异常时提示）；社区目录开关；dsh-m 自更新 |

<div align="center">
  <img src="https://raw.githubusercontent.com/iasiv5/dsh-m/main/docs/images/settings.webp" alt="设置视图——社区清单状态卡（目录版本 / 获取线路 / 收录条目）、精选清单配置卡（地址草稿与强制刷新 / 校验并应用 / 恢复默认 / 下载默认清单）与关于卡" width="86%">
  <p><sub>设置视图 · 社区清单状态、精选清单配置与 dsh-m 自更新</sub></p>
</div>

以下重启链路仅适用于 **Web**（Desktop 的生效走官方应用生命周期：安装完成后退出并重新打开 Desktop 应用即可，见 0.9.0 节）。安装 / 卸载 / 升级完成后，当前已打开的市场页与已装页会一起重新读取 profile 状态并同步徽标/卡片，不需要关闭后重新打开插件市场；随后出现「⚡ 一键重启」横幅——受 systemd 管理时通过 DSH launcher 的 `appExit` 交给服务的 `Restart` 策略，避免在待停止 unit 的 cgroup 内启动 `systemctl` helper；无 `appExit` 的 systemd 兜底改用 manager-owned transient `systemd-run`，最后才退回 detached-helper。客户端按 boot id 确认新进程已恢复后关闭横幅，交由 DSH Web 自身的后台连接重试恢复页面，不强制整页刷新，避免认证/路由切换期间白屏。重启链路已在当前 DSH Web `0.2.0-rc.2` 实机核验（2026-10-01）：dsh-m 探测 unit `Restart=` 策略后经 `appExit` 交还 systemd，`status=75/TEMPFAIL` 退出由 Restart 策略接住自动拉起，服务恢复后页面后台重连、面板全功能可用。历史口径：`0.1.5-rc.1` 时代已核验 `/dshm` ping 与带认证 `303 → 200`；`0.1.2-rc.1` 按契约核对 + 形态探测兜底收录（verified 数组），部署面演进后不再追旧代 live E2E；transient `systemd-run` 兜底仅适用于无 `appExit` 的宿主（受支持代际均提供 `appExit`），保持设计兜底而非发布门槛；连续安装/卸载由 profile 事务测试面（补偿事务、装后守卫等 813 用例）与 0.4.0→0.4.2 连续发布实证覆盖。安装过程实时显示 pnpm 进度（解析 → 下载 → 链接 → 构建）。

### 0.9.9 修复：备用线路接住后不再弹红色「主线路失败」提示（提示收敛）

- **场景**：默认精选清单双线路（raw → jsDelivr）里主线路 `default-raw` 失败、备用线路成功接管时，设置页仍弹红色「远端提示：default-raw 失败：fetch failed…可稍后重试或检查网络后重试」——对着已经自愈的数据报警，还带着不成立的建议（大陆网络下 raw 间歇不可达是常态，这正是备用线路存在的原因）。
- **修复**：后续线路成功 = 先行失败已自愈，`errors` 不再携带（设置页「生效来源」行已如实标注当前线路，如「GitHub 镜像（备用）」）；全线路失败落 cache/bundled 时错误照常保留——那才是需要行动的信号。custom 链（自定义源失败回退缓存）行为不变，仍然提示。
- 顺带补了 default 链的测试缝（`defaultRoutes` 覆写），双线路收敛与全挂保留各有回归门。

### 0.9.8 修复：Desktop 包操作全面接通官方管理器（安装恒 no-manager；升级/卸载/自升级开放）

- **安装恒失败的根因**：Host API 的 desktop 安装分支调 `desktopInstall(id, cfg, opts)` 漏传第 4 参 deps——`getService` 根本没进适配器，desktop 安装恒报「官方 pluginManager 服务不可用（fail-closed）」（100% 必现，与时机无关）。工具面 `dshm_install` 同病。
- **服务解析与 dsh-market 同源**（借鉴其 official-desktop 接线，本机两轮覆盖安装实证）：探测改双上下文（webServer 注入回调的 hostCtx 优先）+ cordis inject 惰性拉起兜底（短超时）——官方 pluginManager 是惰性服务，未被拉起前一次性 get 恒 undefined；仍缺席才结构化拒绝（绝不文件级回退的红线不动）。
- **能力表扩充（主人裁决，借鉴 dsh-market 策略）**：desktop 的 upgrade（installBundle 覆盖安装）/ uninstall（removeBundle）/ self-upgrade（installBundle('dsh-m@latest')）全部开放——dshmarket 正是这样完成 dsh-m 0.9.3→0.9.4/0.9.5 两轮升级的；判定纪律沿用（application/stage 为准、overridden 非失败、build-blocked 结构化回传 pendingBuilds、listBundles 复读不冒充成功）。restart 继续拒绝（Electron 生命周期归官方壳）。
- GUI 与工具面（dshm_install / dshm_uninstall / dshm_upgrade）三入口同批接线。

### 0.9.7 修复：Desktop 下点升级角标弹红色「升级失败」（能力表拒绝应为指导而非报错）

- **根因**：0.9.1 的升级角标点击后一律调 `self-upgrade`；Desktop 能力表按设计 409 结构化拒绝，但客户端把 409 当普通失败渲染成红色「升级失败」横幅——按能力表这根本不是失败，是「该走官方入口」的指引。
- **修复**：`api()` 透传能力表拒绝的结构化字段（code/action/profile/guidance），角标点击收到 409 时改出**中性 info 横幅**展示官方入口指引（guidance 单一事实源仍在服务端 `active-profile.ts`，客户端零复制）；info 横幅停留 12s。Web 端真实失败仍走红色 err 横幅，行为不变。

### 0.9.6 修复：「清除已完成」对失败记录无声 no-op

- **根因**：0.7.0 评审共识把「失败/已跳过」排除在清除范围外（保留供回看），于是按钮对着一条失败记录点击毫无反应、也无任何反馈——Windows 实机被当成 bug 上报（2026-10-01）。显式点击清除不是「静默抹掉」，旧共识被推翻。
- **修复**：「清除已结束」（原「清除已完成」）现在清除**全部终态**（done/warned/failed/superseded），在途态（queued/running/input）不受影响；没有可清终态时按钮置灰并带说明 tooltip，不再无声 no-op。单条 ✕ 照旧逐条删除。
- **英文文案**同步改为 "Clear ended"。

### 0.9.5 修复：Desktop 下 GUI 读路径漏接 active profile（已装页恒显 web）

- **根因**：0.9.0 双 profile 接线时，Host API 的 `installed` / `market` 两个读路径漏传 active profile——`listInstalledWithMeta` / `listMarket` 内部落回 `webProfileDir()`：Desktop 下已装页恒显「web profile 尚未安装任何插件」、市场「已安装」徽标恒空（agent 工具面 `dshm_list` 同链路已接线，故只有 GUI 错）。
- **修复**：两处补齐 `profileDir: profile.dir` + `profile: profile.name`（与 tools 面同款，profileContext 单一事实源）；registry/社区缓存随 `profile` 参数自动落到 desktop 段。
- **文案**：已装空态/加载态与 profile 提示里的「web profile」硬编码改为 profile 中性表述（实际路径照旧展示）。

### 0.9.4 修复：Windows Desktop 全屏后头部不可点（tab / 还原键被系统标题栏吞掉）

- **根因**：Desktop（Windows）以 `titleBarStyle:hidden + titleBarOverlay` 运行——窗口顶部 40px 是壳的全宽 `-webkit-app-region:drag` 拖拽带（按布局参与拖拽判定、无视 z-index 与绘制顺序），右上角另有系统绘制的 — □ ✕ 悬浮于一切内容之上。面板全屏后头部（tab、还原/关闭键）正好落进这条带：点击被窗口拖拽吞掉、还原键被系统键遮挡，全屏无法退出。
- **修复**：与壳自家 overlay 同款对策——消费壳在 `html` 上设的 `--dsh-windows-titlebar-height` 让出该带（全屏态 `top:var(…)`；浮动态 `padding-top:max(24px,var(…))` 顺带修掉矮窗口下浮板顶边被带压住的边缘情况）。
- **Web 零漂移**：DSH Web / 浏览器无此变量，回落 0px，行为与 0.9.3 完全一致。

### 0.9.3 修复：Windows 原生适配（Windows 宿主实机回归）

- **registry 原子写**：临时文件名此前用 `split('/')` 从绝对路径取尾段，而 Windows 路径分隔符是 `\`——取到的是整条路径（内嵌 `\` 即目录分隔符），临时文件 open 必败且被吞，cache 与 accepted metadata 写入**静默全失败**；改用 `basename()`，三平台一致。
- **本地文件清单地址解析**：`C:\…` 盘符与 `\\server\share` UNC 此前被误当 URL scheme（报「只允许 HTTPS」的误导性错误），`file://C:/…` 会归一成无盘符悬空路径必 ENOENT；现 POSIX 绝对 / Windows 盘符 / UNC 三形态均正确解析为 file kind。
- **构建**：`node_modules/.bin/tsc` 是 POSIX sh shim，Windows 下 `spawnSync ENOENT`；改用当前 Node 直跑 TypeScript 的 JS 入口，`npm run build` 三平台一致。
- **测试面**：Windows 实机全量 829 用例 41 败 → **0**（821 pass / 8 skipped）；POSIX 进程组/SIGTERM 时序、symlink 权限、平台路径断言、固定 sleep 时序假设逐项标注 skip 或平台无关化/有界轮询，测试契约不变。

### 0.9.2 修复：跨服务重启后头部角标停留旧版本

- **一键重启确认新进程后就地刷新**：boot id 确认 DSH Web 已恢复的瞬间，面板立即重取 ping——`dsh-m vX.Y.Z` 角标与 profile chip 同步到新进程数据，不再停留旧版本（0.9.1 实测：芯片升级 + 重启后仍显 v0.9.0）。
- **页面回前台时重取**：面板常开、服务在后台被外部重启的场景，`visibilitychange` 回前台即重取 ping（零轮询成本）。
- **角标版本护栏**：self-check 判定携带的版本与当前进程不符（旧进程残留判定）时一律静默，杜绝「v0.9.1 ⬆ v0.9.1」式误渲染。

### 0.9.1 新增：头部版本角标升级提示（有更新才点亮）

- **静默口径**：面板头部 `dsh-m vX.Y.Z` 角标常态维持 0.7.5 起的静态展示——已是最新、检查失败、本地 dev 版领先 npm（ahead）一律不打扰（ahead 仅在悬停 title 里提示「本地开发版」）。
- **仅 outdated 点亮**：`self-check`（npm latest vs 装机版本，只读）判定有新版本时，角标点亮为 warn 态并显示 `⬆ v<最新>`；点击即触发 `self-upgrade`（同一 mutation session + 装后守卫），成功后出「⚡ 一键重启」横幅。Desktop 下点击按能力表结构化拒绝（409，带官方生命周期指引）。
- **TTL 缓存 + 版本护栏**：检查结果在浏览器 localStorage 缓存 30 分钟，开面板不重复打 npm registry；升级重启后缓存按版本号自动作废。检查失败静默，不弹任何错误。

### 0.9.0 新增：官方 Desktop（双 profile）支持

- **同一包、两个 profile**：dsh-m 现在可装入官方 Desktop 的 `desktop` profile（`~/.dsh/profiles/desktop`），与 Web 的 `web` profile 并列；市场目录、面板与 agent 工具同一套，管理对象始终是宿主当前 profile（官方 `profileContext` 单一事实源）。
- **入口信任检查改委派官方**：`/dshm` 全部 method（含 ping 与未知 method）在读取请求体之前委派官方 `connection.requestRejection()` 判定（trustedHosts / loopback / 跨站 / `Origin: null` 语义随宿主），被拒请求零 body 消耗、零业务调用；宿主缺该能力时 fail-closed 全拒。**行为变化**：旧版自制守卫「缺 Origin 一律 403」不再存在——Desktop 桥合法剥除 Origin 的请求按官方语义放行，无凭据的健康检查探针从「一律 403」变为「按宿主信任判定」。
- **Desktop 首发能力表**：只读市场 + **安装新包**（委派官方 `pluginManager.installBundle`，完整性/锁/生效相位归官方）+ **开关**（委派官方管理器，服务缺席结构化拒绝、绝不文件级 fallback）；**升级 / 卸载 / dsh-m 自更新 / 一键重启**在 Desktop 结构化拒绝（409，带官方入口指引——官方暂无 upgrade API，重启归 Electron 生命周期）；构建脚本按官方 `pendingBuilds` 名单精确重试，绝不全量放行。
- **读模型与缓存按 profile 隔离**：市场安装标注、已装列表、README 预览只读当前 profile；registry / 社区清单 / accepted-source 缓存按 profile 分段（web 沿用旧路径，零迁移零清空）；收藏与操作记录按浏览器 origin 各自独立，Web 与 Desktop 不自动同步。
- **CLI 恒作用于 web profile**：`--profile web` 显式声明；`--profile desktop` 明确拒绝并指引官方 Desktop 插件管理页。
- **如实声明**：Desktop 实机（Win/macOS）E2E 未跑，`registry.json` verified 数组**不新增** Desktop 代际（实测后按收录纪律补录）；Desktop 下不做 dsh-m 文件级装后守卫（app.asar 打包布局探测盲区），以官方结果判定 + `listBundles` 复读替代。

### 0.8.5 修复

- **dshm_upgrade 守卫拦截假成功**：升级命中装后守卫拦截时（如 link/file 来源插件无法自动回退），文本输出误渲染为「✅ undefined 已升级（最新）」；现如实输出拦截原因、补偿终态与修复依据，与卡片标题（守卫拦截）一致。

### 0.8.4 变更：分类标签随界面语言双语化

- **社区分类**：已知 23 个分类的英文名直接取上游目录 `categories.en`，英文界面下分类 chips 与详情/收藏 Modal 的分类行显示英文；缺英文名的上游新分类回退中文，仍按原样渲染进临时组，等发版收录。中文界面不变。
- **精选分类**：五个分类 chip 改走双语字典（市场/工具/界面/搜索/其他 ⇄ Market/Tools/UI/Search/Other），与详情 Modal 口径一致。
- **实现**：summary 新增 `categoryLabelsEn`（`communityOutcome` 从上游目录派生，缺 en 的 id 不进映射，不手养第二张表），客户端按界面语言合并取值。0.8.1–0.8.3 为本地迭代号，无独立变更面，不单列。

### 0.8.0 变更：设置页重做（对齐双清单分区定位）

- **信息架构**：社区清单（from awesome-dsh-plugin）→ 精选清单（registry.json）→ dsh-m 自身 → 关于；「主清单」的 UI 可见名统一为「精选清单」。
- **社区目录开关**：新增 GUI 开关（live 生效，即时切换无确认；关闭态整卡收为一行说明）；新增 `set-community` API。
- **精选清单瘦身**：状态字段 7 行收敛为 4 行（配置地址合并、删除写死的「缓存策略」行）；「配置状态」仅异常时出现；按钮组精简为「强制刷新 / 校验并应用 / 恢复默认 / 下载默认清单」，「检查条目可达性」从 GUI 移除（`registry-diagnose` API 保留）。
- **文案修正**：自定义源说明明确「整体替换主清单、仅影响『精选』区」；删除与实际不符的 TTL 写死描述（`timeoutMs`/`cacheTtlMin` 仍走 config 配置）。
- **dsh-m 自身**：本地 dev 版领先 npm 发布时改显「本地为开发版」而非误导性的旧「npm 最新」（新增 `ahead` 字段）。
- **关于**：文案对齐当前定位，新增 GitHub 仓库与问题反馈链接。

### 0.7.10 美化

- **头部三段分组**：标题与 tab 导航之间加发丝竖分隔线，「标题 | 导航 | 状态+窗口控制」边界清晰。
- **版本角标同色**：v 版本号不再用主文字亮色，与 dsh-m 名称统一为次级灰。
- **垂直节奏收敛**：窗口控制组按钮 26→28px 与 tab 按钮等高；版本角标微调至 24px 高；最大化/还原图标统一 12px；标题字重 700→600。

### 0.7.9 修复

- **分类 chips 顺序恒定**：退役「激活分类置前」的换序逻辑（此前每点一个被折叠裁掉的分类，它就会跳到首位，顺序随点击不断变化）。替换为：激活分类落在收起态裁剪区时自动展开完整分类行——「当前激活的分类始终可见」目标不变，顺序从此稳定；同一激活分类下手动收起会被尊重，换选其他被裁掉的分类或点「全部」时重置。

### 0.7.8 变更

- **修复「最大化没作用」的根因——CSS 热更自愈**：面板样式表此前只在首次注入（`#dshm-css` 存在即跳过），服务热更后旧 bundle 留下的样式表不含新类名规则（全屏/窗口控制组），导致新功能「点了没反应」、按钮裸奔成原生样式。现给注入的样式表带内容哈希（djb2）版本标记，bundle 更新后重新打开面板即自动替换旧样式，无需刷新页面。
- **窗口控制组重新配色**：去掉浮起底色，改透明底 + 发丝外框（与搜索清除钮同一配色语言），单格加宽 34→44px 防误触；关闭悬停仍为红色警示。

### 0.7.7 变更

- **移植 dsh-market 的全屏功能**：面板头部新增「最大化/还原」（连体窗口控制组设计：最大化 + 关闭等宽两格、发丝分隔线、统一 SVG 线条图标；关闭悬停红色警示）。全屏铺满视口、去圆角，状态 localStorage 记忆，Esc 关面板语义不变。
- 0.7.6 补记：版本角标去粗体、去点击复制（改静态展示）；吸顶分类行上沿镂空修复（sticky 锚点上移抵消容器 padding）；关闭/清除按钮改框线平面风。

### 0.7.5 变更

- **头部版本 chip 改显 dsh-m 自身版本**（`dsh-m v0.7.5`，点击复制；DSH 运行版本看设置页与 `dshm ping`）。
- **× 关闭/清除按钮统一重绘**：搜索清除、详情 Modal 关闭、操作记录行移除三处改用 SVG 线条图标 + 悬停浅底的专用按钮样式；搜索清除钮悬浮于输入框右缘（胶囊内对齐）。
- **修复 dsh-market 的 peer 告警**：`@deepseek-ai/dsh-tools` peer 由 `*`（semver 严格口径不匹配 rc 预发布版本）改为显式 range `^0.1.7-rc.2 || ^0.2.0-rc.1 || >=0.2.0`；未来更新的 rc 线（如 0.3.0-rc.x）需再追加。

### 0.7.4 变更

- **面板 tab 回退旧版分段按钮风格**（0.7.2 误改下划线样式，按主人要求还原圆角按钮组 + 高亮态）。
- **搜索框通长**：修复搜索容器缺 `display:flex` 导致输入框未拉伸的问题，恢复整行宽度。
- **筛选按钮与页号跳转控件重新配色**：筛选按钮改浮起面板底色 + 方角与分类 chips 区分（激活态品牌色描边）；页号输入改胶囊形细描边，「跳转」用品牌色文字钮。
- **吸顶分类行彻底不透**：背景直接使用不透明底色 token（此前的 color-mix 半透明配方在深色主题下仍会透出下方卡片文字），保留底部分隔线。

### 0.7.3 变更（含 0.7.2）

- **首页布局复刻 dsh-market**：市场页改为「分区 chips → 整宽搜索行 → 分类 chips + 行尾筛选弹层」结构；筛选弹层独立样式（方角矩形 + 前置 chevron），收纳排序字段（npm 下载量/Star 数/收录日期）、排列方向与每页条数（原排序下拉与分页器条数选择退役）。
- **收藏卡可点开详情**：修复收藏区卡片点击无响应——收藏快照字段不全，打开时按 id 从两分区内存 → market API → 快照三级解析完整条目，详情 Modal 与安装链路（含兼容确认）全量复用。
- **翻页页号跳转**：页码行新增页号输入框，输入有效页号回车或点「跳转」直达。
- **吸顶分类行毛玻璃**：滚动时吸顶的分类行加 backdrop blur 与底部分隔线，下方卡片文字不再透出干扰。
- **按需求移除**：「发现社区/申请收录」行（dsh-m 不支持收录功能）、「任务」按钮（操作记录面板恢复常驻）、「刷新」按钮（强制刷新在设置页）。
- 说明：收录条目不携带宿主版本要求字段，dsh-market 的「宿主版本」筛选项无数据源，未复刻。

### 0.7.1 修复

- **社区条目可安装**：修复 0.7.0 回归——社区区里的条目点安装报「registry 中没有该条目」（安装按收录 id 只查主清单，未查社区目录）；现与升级路径同构，主清单 miss 时按 id 查社区目录再装。
- **市场页第一行紧凑化**：搜索框、刷新、排序（社区区）并入分区 chips 行右侧；信息性来源横幅（「官方默认收录清单 / 自定义收录清单 / 来源为本地缓存」）退役——其「共 {count} 条」计数从未接线（恒显 0）；错误态「收录清单不可用」与社区兜底/陈旧提示保留。

### 0.7.0 新增

- **分区制市场**（[ADR-0004](./docs/adr/0004-zoned-market-display.md)）：数据层双清单合并不变，展示层按「社区（默认）/ 精选 / 收藏」三分区呈现；`dshm_search` 与 `dshm search` 改用 `--source community|primary|all` + `--offset` 真翻页（默认 10 条），`primary_only` 退役。
- **搜索相关性**：NFKC 归一化 + 中西文边界 + 字段加权（name/npm > owner > 描述 > 分类 > tags），多词同字段全命中；id 整串精确匹配最高优先。
- **操作记录 + 恢复执行器**、**本地收藏 + 下架清理**、**详情 Modal + 截图灯箱**、社区卡 byline/deprecated 徽章/目录版本快照兜底（不参与 outdated 判定）。

### 0.4.0 新增

- **开关（Enablement Toggle）**：已装卡片一键启停，内部自动路由行覆盖（单行插件，即时生效）或 Bundle 选择（多行插件）；写路径委派官方 `pluginManager` 服务、缺席时降级 loader 直操作（[ADR-0001](./docs/adr/0001-delegate-with-fallback-for-plugin-manager.md)）。
- **运行相位徽标**：loader fiber 状态投影，failed 一眼可见。
- **保护名单**：`dsh-m` 自身与官方宿主命脉 16 项不可开关、不可卸载（升级不受影响）。
- **精确构建放行**：needs-builds 拦截后按 pnpm 待决名单逐键放行，全量放行降为兜底并如实标注（[ADR-0002](./docs/adr/0002-precise-build-approval.md)）。
- **peer 兼容预检**：安装/升级前校验 `@deepseek-ai/dsh(-*)` peers 与运行时版本（GitHub 源明示未检）；不兼容时 GUI 弹确认、agent 回结构化结果、CLI `--force`。
- **实测版本清单（verified）**：registry 条目可选 `verified` 数组记录实测过的 DSH 运行时版本——实测声明而非预测声明，只展示不拦截。
- **bundle 身份验证**：装后检测无补丁层的包并警告「已装入为纯依赖」。

### 0.4.x 退役

- **元数据源竞速**：0.4.0 曾引入 npmjs / npmmirror ping 竞速选择元数据读取源，现整体移除（含 `probeEnabled` / `probeTimeoutMs` / `probeCacheTtlMin` 三个设置项与设置页展示）。官方同款探测只服务于「安装对话框 registry 默认预选」，dsh-m 无此交互；实测宿主机 npmjs 稳定更快，探测恒等默认行为。元数据读取固定走 npmjs，与安装链路（profile `.npmrc` 默认源）一致。

## Agent 工具（8 个）

| 工具 | 用途 |
|---|---|
| `dshm_search` | 搜收录清单（对话内出卡片） |
| `dshm_list` | 列已装插件（市场/非市场标注） |
| `dshm_install` | 按收录 id 安装（装前 peer 兼容预检；不兼容时回结构化结果，用户确认后 `force` 重试） |
| `dshm_uninstall` | 卸载（先确认；不删数据，报告残留路径） |
| `dshm_outdated` | 检查最新版本 |
| `dshm_upgrade` | 升级到最新 |
| `dshm_toggle` | 切换插件运行状态（0.4.0；默认先确认，用户同句已明确可直接执行） |
| `dshm_restart` | 一键重启 DSH Web（先征得同意） |

## CLI

```sh
dshm search [--query 主题] [--category ui] [--source community|primary|all] [--limit N] [--offset N]
dshm list | outdated | registry
dshm install --id dsh-web-search [--force]   # --force：确认兼容风险后跳过预检拦截
dshm upgrade --pkg dsh-web-search --yes [--force]
dshm uninstall --pkg dsh-web-search --yes
dshm toggle --pkg dsh-web-search --on|--off --yes   # 文件级编辑，重启生效
dshm restart --yes
```

清单不可用时 `registry` / `search` / `outdated` 打印配置与实际生效地址并退出码 1；`list` 仍列出已装插件。CLI 固定独立缓存命名空间，不影响 Web 端。

**profile 目标（0.9.0）**：CLI 恒作用于 web profile——`--profile web` 为显式声明；`--profile desktop` 直接拒绝（Desktop profile 的插件管理走官方 Desktop 插件管理页）。

## 收录清单（registry）

`registry.json` 手工 curated，运行时按 **GitHub 原始文件（raw @main）→ GitHub 镜像（jsDelivr CDN，备用线路）→ 本地 60 分钟 TTL 缓存 → 包内快照** 的顺序获取——收录更新与插件发版**解耦**，push 后最多等一个缓存周期（可在设置页强制刷新）。收录 / 修订直接改 `registry.json` 发 PR，CI 自动校验：严格 schema、npm 包与 GitHub 仓库存在性、重复 id、URL 可达性。

**自定义收录清单（可覆盖官方清单）**：设置页支持单一自定义 registry 地址，**整体覆盖**默认清单（不合并）：

1. 「下载默认 registry.json」得到一份官方清单副本；
2. 自行编辑副本（增删条目）；
3. 在设置页填入副本地址并「校验并应用」——支持 **HTTPS URL**、本机**绝对路径 / `file://`**（HTTP 仅限 127.0.0.1/localhost 本机调试）；
4. 校验失败（字段错误、路径不存在、超过 2 MiB / 1,000 条等）不会保存配置，当前生效清单保持不变；应用成功**即时生效，无需重启**（仅首次部署新版本 dsh-m 需要一次重启）；
5. 「恢复默认」一键回到官方清单。

规则与边界：严格 v1 schema（未知字段 / 非法 ID / 超限 / 重复一律拒绝，不截断）；副本是独立快照，**不会自动同步**官方新条目；自定义源失败时保留其最近一次成功缓存，绝不静默回退官方清单；切换后旧自定义源缓存会被清理（默认缓存保留）；自定义清单未经官方 CI 校验，请确认来源可信再安装；完整本地路径只在设置页显示，工具与卡片只显示短状态。

安全基线：拉取仅 HTTPS（loopback HTTP 除外）+ 重定向逐跳校验 + 体积上限 + 超时；npm 安装按精确版本 dist integrity 对照 pnpm lockfile 校验，不一致 fail closed 并回滚；GitHub 安装强制锁定 commit SHA；pnpm 构建脚本被拦时按策略放行并明确报告。

## 社区清单（awesome-dsh-plugin 目录，0.5.0）

除手工 curated 的主清单外，市场还会叠加一层**只读的社区清单**：锚定 npm 包 [`dsh-plugin-catalog`](https://www.npmjs.com/package/dsh-plugin-catalog)（CC0-1.0，awesome-dsh-plugin 全量目录，4,000+ 条），数据层与主清单合并去重（**主清单恒优先**，重名条目社区侧让位），展示层按「社区 / 精选」分区呈现（ADR-0004）——社区区不再显示与主清单重复的条目，精选区保持策展序单页直出。

- **数据获取**：dist-tags 探测最新版本 → jsDelivr 按精确版本直取 → npmmirror → unpkg 三线路兜底；版本未变不重拉正文，TTL 内跳过探测。失败回落 `<缓存目录>/awesome/` 运行时缓存并**显式标注「缓存快照」**——过期数据绝不冒充最新。
- **开关与锁定**：设置页 `communityCatalog` 开关（默认开，live 生效）、`communityCatalogPin` 可锁定目录版本（精确 semver）；CLI 用 `DSHM_COMMUNITY_CATALOG=0` 退出、`DSHM_COMMUNITY_CATALOG_PIN` 锁版本。
- **分类与搜索**：社区分类是开放集（已知 23 个分类带中英双语标签：中文由包内单一事实源维护、英文取上游目录，按界面语言下发）；搜索走相关性加权管线（中英文双匹配）；社区区排序可切（下载量/Star/收录日期 × 升降，默认下载量降序，无下载量 ≠ 0 下载）。
- **安装语义**：社区条目与主清单走同一 `installEntry`（npm 锁精确版本 / GitHub 锁 commit SHA）；市场浏览页只对 npm 条目做更新探测，GitHub 条目不做页面级探测（匿名配额 60 次/小时不可控）。
- **已装页预算（best-effort）**：已装页对 GitHub 来源插件做更新检查，单次请求 ≤25 个、宿主进程滚动 1 小时 ≤50 个（仅被动检查；主动安装/升级不受限）；超限条目如实标注「检查未完成」而不冒充「全部最新」。独立 CLI 进程不共享宿主内预算，并发场景不承诺 60 次/小时绝不耗尽。
- **能力披露**：社区条目的 capabilities/红线只出现在详情折叠区（**缺省 = 未扫描 ≠ 未检出**），卡片不打标；截图仅在详情层加载并经客户端白名单校验。
- **非安全审查警示**：社区目录为全量收录，**未经安全审查**——安装前请自行确认插件来源与能力；主清单的手工 curated 与 CI 校验不适用于社区条目。

## 开发

```sh
npm ci
npm run build        # tsc（host/core/cli）+ esbuild（client，tree-shaking 已关闭）
npm run typecheck
node scripts/validate-registry.mjs
```

本地调试推荐 `link:` 模式（与 dsh-skins 相同）：profile 依赖指向本仓库目录，`npm run build` + 重启即生效。

发版：`npm version patch|minor|major && git push --tags` → OIDC trusted publishing 自动发布。

## FAQ

**1. 为什么 GitHub 来源的更新提示不走 main HEAD？**
main 上的中间提交可能不稳定。dsh-m 只跟踪 **release / tag**（优先 `releases/latest`，无 release 回退 tags 列表），安装时锁定 tag 指向的 commit SHA。

**1.5 官方 Desktop 上能用哪些功能？**
Desktop（desktop profile）首发支持：浏览市场、**安装新包**、插件开关；升级/卸载/自更新/一键重启会返回结构化拒绝并指引官方入口（官方插件管理页 / Desktop 应用重启）。市场安装标注、已装列表只反映 Desktop 自己装了什么；与 Web 端的收藏、操作记录互不同步。

**2. 卸载 dsh-m 会删我的数据吗？**
不会。只移除 profile 中的包引用（卸载前先下线运行中的界面），并把疑似残留路径报告给你。

**3. 自定义清单会让市场变慢吗？**
收录超过 200 条时会提示性能边界。市场列表是服务端分页（每页 24/48/96 可选），1,000 条清单第一页也只查询当前页的最新版本，浏览仍然流畅。

**4. 自定义源挂了怎么办？**
优先使用该源最近一次成功的缓存并标记「缓存来源」；完全没有缓存时市场显示「收录清单不可用」，已安装插件仍可正常管理。修正地址或恢复默认即可。

**5. 支持哪些 DSH Web 版本？**
与 dsh-skip-browser-auth 同一口径：`0.1.2-rc.1`、`0.1.5-rc.1/rc.2`、`0.1.7-rc.1/rc.2`、`0.2.0-rc.1/rc.2` 的公开包契约均已核对（0.2.0-rc.2 为当前实机运行代际）。其中 0.1.7 把 settings 服务重塑为 `SettingsForms`（旧的 `settings.register` 消失），dsh-m 以运行时形态探测双代兼容：≤0.1.5 全代际走 `register()` scope 通路（0.1.5-rc.2 的 dsh-settings 仍为旧 API，已并入核对），0.1.7-rc.1 / rc.2 走 Config `.volatile()` 字段 + `settings.update` + `loader/volatile-update` 通路（经 tarball 逐字节比对，两个 rc 的 dsh-settings 完全相同、loader 同版，一套实现通吃）；形态不识别时自动降级 cordis 配置文件通路，市场主功能不受影响。重启方面各版本都提供 dsh-m 使用的 `appExit` launcher hook；0.1.5-rc.1 运行时已实际加载并完成 `/dshm` ping 与带认证页面 `303 → 200` 核验。0.1.7 适配的 live E2E 结论（2026-09-28 回写）：装机与 `/dshm` 工具链活性已在 0.1.7-rc.2 实证——0.4.0 → 0.4.2 连续三个版本发布收编，跨两次服务重启后 `dshm list/upgrade` 全链路可用，registry 21 条（自研七件套齐）下发正常；设置页写值持久化未单独核验（0.1.7 起迁移用户层设置存储，旧 `~/.dsh/settings.yaml` 不复存在；dsh-m 自身 config 已观察到以 `cordis.patch.yml` 持久化形态存在，GUI 写值 → 重启对照留待首次实际使用设置面板时顺手完成）。systemd 部署需要 unit 配置 `Restart=on-failure` 或 `Restart=always`，否则请使用部署方的手动重启方式。

## License

MIT
