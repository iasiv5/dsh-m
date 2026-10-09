# Primary 截图由作者 manifest 按需读取（ADR-0015）

状态：2026-10-09，经 owner 确认。

## 背景

dsh-m 的 Primary Registry 与 Community Catalog 是两种独立来源。Community 条目的截图已随 `dsh-plugin-catalog` 版本化目录分发；但精选条目可能不在社区目录中，且主/社区重复时 Community 条目整条让位。Primary 详情不能以社区重复项作为截图兜底，也不应为了取图而加载社区目录。

作者仓库可自行维护根目录 `screenshots.json`。例如 dsh-skins 已有一个顶层字符串数组，包含 5 个仓库相对图片路径。目标是在不扩展 Primary Registry schema、不复制这组 URL 的前提下，让 Primary DetailModal 使用作者清单。

## 考虑过的选项

- **Primary Registry 内嵌 `screenshots: string[]`**：数据最确定、无 manifest metadata 请求；但每次改图都要同步维护 Primary Registry 与作者仓库两份清单，并扩展严格 Registry schema。若把截图放进 `MarketItem`，还需额外防止完整市场响应快照持久化这些 URL。未采纳。
- **从重复 Community 条目合并截图**：复用现成目录字段，但要求 Community Catalog 已收录该插件；会把 Primary 图片与 Community 收录状态耦合，并改变主优先去重语义。未采纳。
- **从 README 抽取图片**：能覆盖未声明图片的仓库，但 README 可能有重复图、徽章或文档配图，结果顺序不等于作者选定的图库。dsh-skins 自己的清单已展示“精选代表图”与 README 全部图片不是同一选择。未采纳。
- **按需读取作者仓库 manifest（采纳）**：只在 Primary DetailModal 打开时访问作者仓库根目录清单；作者只维护一份截图列表，不需要社区收录，也不改变市场列表数据流。

## 决策

1. GUI Host method 名称为 `primary-screenshots`，请求只带 Primary 条目 `id`。Host 从当前 active Primary Registry（默认或自定义）精确查找条目，仅信任其已校验的 `github: owner/repo`；忽略请求体中额外的 `github`/URL 字段，不接收任意 URL。
2. 有 `github` 时读取固定地址 `https://raw.githubusercontent.com/{owner}/{repo}/HEAD/screenshots.json`。manifest 只接受顶层 JSON 字符串数组，条目是同仓库根目录内的相对路径，最多 8 个且保持声明顺序。拒绝绝对/协议相对路径、`.`/`..` 越界、反斜杠、query/hash 与控制字符；每段编码后构造 raw image URL。没有 `github`、manifest 缺失/损坏、路径无效或请求失败都返回空列表。
3. manifest GET 走现有 `fetchTextLimited`，响应上限 64 KiB、超时 5 秒，并在每次请求/重定向时只允许 HTTPS `raw.githubusercontent.com`。成功结果进程内缓存 10 分钟；空/失败结果负缓存 1 分钟；相同 repo 的并发读取 single-flight。缓存不写磁盘或浏览器 localStorage。
4. DetailModal 只对 Primary 条目调用 Host method。Community live 条目继续消费其目录 `screenshots`；owner-only Community 收藏快照没有持久化截图且不触发 Primary method。现有收藏详情 `source='all'` 回查保持不变。
5. 返回的图片 URL 仍由现有 `safeScreenshots` 过滤并进入既有 Shot/Lightbox 图片链。缩略图和灯箱继续使用 ADR-0014 的 weserv 优先、原图直连兜底；`safeScreenshots` host 白名单逐字不动。Weserv 只代理/转码图片，manifest JSON 由 Host 独立读取。
6. 截图只存在于 Host 进程缓存和 DetailModal state：不加入 `RegistryEntry`/`MarketItem`、市场首页快照、收藏快照、Agent tools 或 CLI。列表卡、Community merge、社区 loader、README 折叠和主清单 schema 均不改。

## 后果

- Primary 条目详情首次 cache miss 会多一次有界 raw GitHub JSON 请求；请求仅在用户打开详情时发生。raw GitHub 不可达、文件缺失或清单不合规时静默退化为无图库，不阻塞插件查找或安装决策。
- 默认 branch 使用 `HEAD`，作者更新相片清单后通常在正缓存 TTL 到期后可见。非 GitHub Primary 条目、repo 子目录中的非根 manifest、或自定义 manifest URL 本期不支持；这些情形需要未来明确需求后另行扩展。
- Community Catalog 继续独立服务 Community 条目及既有分区；该决策只保证 Primary 截图读取不依赖 Community Catalog，不声称整个 GUI 不会加载 Community Zone。
- 无新增 npm 依赖、Primary Registry schema 字段或版本/发布步骤；作者清单是唯一图片列表事实源，GitHub 图片本身仍可能在分支 HEAD 改动时被重命名/删除。
