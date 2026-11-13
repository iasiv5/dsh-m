# 贡献指南

感谢你愿意为 dsh-m 花时间！dsh-m 的「贡献」分两类完全不同的通道——**本体开发**与**插件收录**。先花一分钟对号入座，能让你的提议少走弯路：

| 你想做的事 | 正确通道 |
|---|---|
| 反馈 bug、提功能建议 | [开 issue](https://github.com/iasiv5/dsh-m/issues)（见 §1） |
| 为 dsh-m 本体（代码 / 测试 / 文档 / CLI）提交 PR | 直接提（见 §1） |
| 让自己的插件被 dsh-m 用户看到 | [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 社区目录（见 §3） |
| 想要一套自己说了算的「精选集」 | 自维护 registry.json（见 §4） |

## 1. 欢迎贡献 dsh-m 本体

### 问题反馈与功能建议

开 issue 前先搜索是否已有同类话题。描述里请包含：

- dsh-m 版本（「已装」页卡片可见）与宿主形态（Web / Desktop）；
- 复现步骤与期望行为；界面问题附截图，CLI 问题附完整输出；
- 有条件的话附 `dshm doctor` 输出（只读体检，不含敏感信息）。

功能建议请带使用场景：你想完成什么、现在怎么做、缺的一环是什么——这比「加一个 XX 开关」更容易被采纳。

### 代码 PR

1. fork → 从 `main` 拉分支；
2. `npm install` 后改动；提交前 `npm test` 与 `npm run typecheck` 全绿；
3. PR 描述写清动机与验证证据（改了什么、为什么、怎么验的）。

评审前请读 [CODING-STANDARDS](./docs/CODING-STANDARDS.md)（测试锚点与证据纪律）；设计共识见 [DESIGN](./docs/DESIGN.md) 与 [ADR](./docs/adr/)。方向不确定的较大改动，建议先开 issue 讨论再动手。安全问题请按 [SECURITY.md](./SECURITY.md) 报告，勿开公开 issue。

## 2. 精选清单（registry.json）：原则上不接受外部收录 PR

dsh-m 的市场数据来自两处：

- **社区目录**：数据来自 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（经 npm 包 `dsh-plugin-catalog` 分发，6,000+ 条），市场默认开启——**第三方插件的既定收录入口**（见 §3）；
- **精选清单**：本仓库的 `registry.json`，维护者手工策展。

精选清单原则上不接受外部投稿，原因有二：

1. **它首先是 dsh-m 核心能力的演示**：在社区目录之外，任何人都可以自维护一套精选清单——这份清单本身就是这个能力的活样例，按 §4 四步就能复制一套你自己的。
2. **它是维护者的个人策展与信任面**：每一条收录都是维护者以自己名义的背书，需要持续装机实测与维护（包括兼容声明的保鲜）。收录由维护者**主动发起**——自己发现、自己实测、自己邀请；一旦放开投稿，「策展」就退化为「目录」，与社区目录功能重叠，失去「少而精」的意义。

因此，给 `registry.json` 增加第三方插件条目的 PR **会被礼貌关闭**。这是通道政策，不是对插件质量的评价——恰恰相反，第三方插件的正途是社区目录：分发面更大、评审更客观、一次收录处处生效。

维护者确实会主动收录少量第三方插件（三方收录门槛与文案规范见 [registry-copy-guide](./docs/registry-copy-guide.md)），但那是策展人发起的动作，不走投稿制；如果你认为自己的插件值得被注意，最好的方式仍然是先进社区目录。历史上确有外部投稿 PR 被合并的先例——那不构成对后续投稿的预期，收录口径以本文档为准。

## 3. 让你的插件被 dsh-m 用户看到：投稿 awesome-dsh-plugin

社区目录是整个 DSH 生态的插件收录枢纽：dsh-m 的社区分区、dsh-market、dsh-find-plugin、中文站等下游读者都会自动跟进——**收录一次，处处生效**。

投稿极简路径（完整指南见[其 contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)）：

1. fork `awesome-dsh-plugin/awesome-dsh-plugin`；
2. 新增一个文件 `data/plugins/<owner>__<repo>.yml`：

   ```yaml
   url: https://github.com/owner/repo        # 必须与仓库地址完全一致
   name: owner/repo
   category: usage                           # 从官方分类列表里挑最贴的
   description:
     en: "One-line factual description ending with a period."
     zh: 一句话中文描述，以句号结尾。         # 可选，缺了维护者会补
   ```

3. 开 PR。CI 校验形式（manifest、仓库年龄、格式），维护者逐条读码核对描述——人工评审等待数天属正常节奏。

最常被打回的原因，提前避开：

- `package.json` 只声明了 `dsh.client`——必须声明 **`dsh.bundle`**（并在仓库根放 `cordis.patch.yml`），否则无法 `dsh plugin add`；
- 仓库创建不满 1 天（CI 自动查；满了再投即可，重新提交没有任何影响）；
- 没加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic；
- 描述夸大或含营销词——描述会被当作对插件的声明，逐句与代码核对；
- 描述含 ASCII `: `（冒号+空格）没加引号，YAML 会解析成嵌套键。

**npm 发布不是社区目录的硬性要求**：dsh-m 支持 GitHub 源安装（锁 release/tag 的 commit SHA，不跟 `main`）。发布 npm 的好处是安装线路更稳、版本探测更即时——锦上添花，不是门票。

## 4. 想要你自己的精选集：自维护 registry.json

精选清单不是特权：**任意 HTTPS 地址或本机文件都能整体替换精选分区**（社区目录不受影响）。这正是 dsh-m 的设计初衷之一——在中心目录之外，人人可以策展。

四步：

1. **拿底稿**：dsh-m「设置」页 → 精选清单区 → 下载默认 `registry.json`；
2. **改成你的**：按 schema 编辑。字段规范（严格校验）见 [DESIGN §2.2](./docs/DESIGN.md)，文案写法见 [registry-copy-guide](./docs/registry-copy-guide.md)。最小示例：

   ```jsonc
   {
     "version": 1,
     "plugins": [
       {
         "id": "my-team-toolkit",            // 清单内唯一 slug
         "name": "Team Toolkit",
         "description": "团队工具合集：一句话说清功能，详见仓库。",
         "category": "essentials",            // 七个策展桶之一（见下）
         "tags": ["工具"],
         "source": "github",                  // npm | github
         "github": "your-name/your-repo",     // source=github 必填；npm 源改填 "npm": "包名"
         "homepage": "https://github.com/your-name/your-repo"
       }
     ]
   }
   ```

   可选字段（`alsoCategories` / `decoupled` / `audience` / `verified` / `icon`）的语义见 [DESIGN §2.2](./docs/DESIGN.md)。
3. **放出去**：托管在任意 HTTPS 地址（如你仓库的 raw / jsDelivr 地址），或放在本机（绝对路径 / `file://`；HTTP 仅限 loopback 调试）；
4. **接入**：dsh-m 设置页填入地址 →「校验并应用」。**即时生效，无需重启。**

接入前值得知道的语义与限制：

- **整体替换，不合并**：你的清单是独立快照，不会自动同步默认精选的新条目；想跟进就重新下载底稿再改；
- **规模限制**：≤ 2 MiB、≤ 1,000 条；schema 严格校验，分类必须取七个策展桶之一（`essentials` / `cui-picks` / `baoyu` / `guizang` / `self-dev` / `tencent-lighthouse` / `watchlist`）；
- **自定义源不经过本仓库 CI**：设置页会如实显示未校验提示，请只引用你信任的源；
- **失效回退**：源不可用时优先使用该源最近一次成功缓存，不会静默切回默认清单。

为你的团队、公司或社区做一套专属精选集，不需要任何中心仓库点头——这正是 dsh-m 想演示的事。

## 5. English summary

- **Bug reports & feature ideas**: open an issue with your dsh-m version, host profile (Web/Desktop), and reproduction steps; attach `dshm doctor` output when possible.
- **Code PRs** are welcome: branch off `main`, keep `npm test` and `npm run typecheck` green, and read [CODING-STANDARDS](./docs/CODING-STANDARDS.md) before review.
- **The curated list (`registry.json`) does not accept third-party listing PRs.** It exists primarily to demonstrate dsh-m's self-maintained registry capability and doubles as the maintainer's personal curation. Third-party plugins belong in the [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) community catalog, which dsh-m loads by default — see its [contributing guide](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md).
- **Want your own curated list?** Host any `registry.json` (HTTPS URL or local path) following the schema in [DESIGN §2.2](./docs/DESIGN.md), paste the address in dsh-m Settings, and it replaces the curated zone instantly — no gatekeeper involved.
