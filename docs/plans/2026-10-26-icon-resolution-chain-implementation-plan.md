# 图标解析链（Icon Resolution Chain）实施计划

- 日期：2026-10-26
- 仓库：`/home/ubuntu/workspace/dsh-m`（分支：从最新 main 拉 feature 分支）
- 设计来源：2026-10-26 grill-with-docs 共识 v1（用户逐题确认）+ 官方机制调查（dsh-app-boot 0.2.1-rc.3 `readPluginMeta`/`iconOf`）+ dsh-m 现状调查
- 配套决策记录：`docs/adr/0025-icon-resolution-chain.md`（本计划 T8 产出）

## 目标

1. 三个面板（社区/精选/已装）统一三级图标解析链：**声明图标 → GitHub owner 头像 → 字母占位**；任一级失败静默降到下一级，永不阻塞卡片渲染。
2. 精选面板的声明图标走 registry.json `icon` 字段，**仅接受 https URL**（用户 Q7 定案：只允许 URL；校验层现状对非法值整份拒绝、客户端纵深过滤按「无图标」降级，见全局约束 2）。
3. 已装面板声明图标与官方面板**同字段同语义**：按官方 `iconOf()` 校验规则自读本机 manifest `icon` 转 data URI（dsh-m 已装列表是自扫磁盘，不走宿主 RPC，官方 `meta.icon` 无法透传，只能本地复刻）。
4. 社区面板本期零改动：上游 `dsh-plugin-catalog` 目前无 icon 字段。如实说明（评审 Q2 修正）：community-adapter 的 `entries.push` 是封闭白名单（L209-234，无透传展开），将来上游长出 icon 时**需在白名单补一行透传**才会流入链①；客户端 https 过滤届时已就位。
5. 性能：纯前端懒加载——`loading="lazy"` + IntersectionObserver 门控（照抄 Shot 先例）+ 浏览器 HTTP 缓存；零后端改动、不建代理、不预爬。
6. 视觉：容器固定 40×40 不变，`object-fit:cover` 改 `contain`（对齐官方渲染语义，防大图裁切）。
7. 文档：GLOSSARY.md 新增「图标解析链」术语；ADR-0025 落盘。

## 架构快照（只讲本次相关的接线）

- **现状链**（`src/client/chrome.jsx` Icon，L42-60）：`entry.icon || (entry.github ? github头像 : null)`，经 `useImgChain(url, {h:96})`（weserv→原图→failed），失败/空返回字母 div。六个消费方全汇聚此组件：market-tab 卡片、installed-tab 卡片、detail-modal、favorite-zone、main.jsx ToolCardRow、（UseImgChainProbe 除外）。
- **官方语义**（逐字对齐对象，dsh-app-boot lib/index.js L2077-2119）：manifest `icon` 必须是包内相对路径（绝对路径/带 scheme 一律拒绝）；root 与 target **两面 realpath** 后做包内 containment（官方 L2092-2095：`root = realpathSync(dirname(manifestPath))`、`relative(root, realModuleFile(target))` 判 `..` 逃逸），stat 与读文件亦用 realpath（L2104-2106）；扩展名白名单 `.svg/.png/.jpg/.jpeg/.webp`；上限 256KiB（stat 与读后双重校验）；产出 `data:<mediaType>;base64,<...>`。fallback：exports `<specifier>/icon`（Node ESM resolver，不执行插件代码）。官方无第三级兜底——「头像兜底」是 dsh-m 对官方链的自觉扩展（ADR-0025 记录）。
- **dsh-m 已装读路径**：`src/core/installed.ts` `listInstalledPlugins` → `classifyDep`（已解析 manifest 在手，item 含 pkg/name/version/description/homepage/githubRepo/path）。`src/core/market.ts` `listInstalledWithMeta`（L854）在 items 构建（L883-887）后做 registry/community 富化，两条返回臂（deadline 早返回 L913 与正常路径）都消费同一 items。
- **useImgChain**（chrome.jsx L335-379）：url 变化渲染期重置；`active:false` 门控 8s 计时与链启动；`chain.failed` 为单 URL 双层（weserv+direct）耗尽的终态。Shot（L284-328）是「IO rootMargin 200px → show 才渲染 img + active 门控」的现成先例。
- **data URI 与 weserv**：`weservUrl` 只接受 http(s) 远端图；data: 候选必须绕过链直连渲染（本计划 T5 处理）。

## 全局约束（从设计共识逐字继承）

1. 图标容器 40×40 不变；`.dshm-icon` 的尺寸/圆角/边框/渐变底全部保留，唯一允许的样式变更是 `object-fit:cover` → `object-fit:contain`。
2. 目录侧（registry.json 与未来社区字段）icon 值**仅认 `https://` URL**。生效是三层结构（评审 Q1 修正）：①校验层——`validateRegistry` 现状即对 icon 做与 homepage 同款的 https 强校验（registry.ts L344-352），非法值整份清单拒绝（L354 注释；bundledSnapshot L445-456 退化为空目录），本计划**不放宽也不加码**、逐字不动；②客户端纵深过滤——`catalogIconUrl` 只放行 https URL，非法值按「无图标」静默降级（对不经 validateRegistry 的社区适配路径真实生效）；③仓库侧 T7 守卫测试在 PR 阶段前置拦截，先于发布。
3. data URI 唯一合法入口 = 已装 item 的 `iconDataUri`（本机官方语义产物）；客户端对 data: 候选直连渲染、不走 weserv。
4. 已装 icon 读盘仅发生在 `listInstalledWithMeta` 且 `opts.icon !== false` 时；`listInstalledPlugins` 直达热路径（市场查询，`patchRows:false`）与 `installedUpdates`（probeMode:'only'）零新增 IO。
5. icon 解析任何一步失败 → 返回 null / 跳到下一候选；绝不 throw、不影响 `complete` 标志、不产生日志噪音。
6. 不改上游 `dsh-plugin-catalog`；不改 `safeScreenshots`/weserv 白名单语义（catalog icon URL 为 https 即可入链，bucket 归属见 T5 步骤 3 的确认项）。
7. 无额外平台/版本约束之外的全局约束：Node ≥22.19.0（package.json engines）、中文注释与文档、仓内 ADR 格式（背景 / Considered Options / 取舍要点 / Consequences）。

## 文件结构与职责

**新建**

| 文件 | 职责 |
|---|---|
| `src/core/installed-icon.ts` | `manifestIconToDataUri(dir, raw, pkg?)`：官方 iconOf 语义复刻（相对路径校验→root/target **两面** realpath 包内 containment→扩展名白名单→256KiB→data URI）+ exports `<pkg>/icon` best-effort（import.meta.resolve，try/catch，失败返回 null）。纯函数无副作用，供 market.ts 富化调用 |
| `src/client/icon-view.js` | 纯逻辑（无 React）：`catalogIconUrl(v)`（https URL 过滤）与 `iconCandidates({icon, github, iconDataUri})`（有序去重候选数组） |
| `tests/installed-icon.test.mjs` | T1 的核心单测（临时目录 fixture） |
| `tests/client-icon-view.test.mjs` | T4 的纯逻辑单测（仿 client-installed-view.test.mjs 风格，直 import `src/client/*.js`） |
| `tests/registry-icon-url.test.mjs` | bundled registry.json 守卫：凡带 `icon` 字段的条目必须是 `https://` URL |
| `docs/adr/0025-icon-resolution-chain.md` | 决策记录（T8） |

**修改**

| 文件 | 职责 |
|---|---|
| `src/core/installed.ts` | `InstalledPlugin` 增 `manifestIcon?: string`；`classifyDep` 从已在手的 manifest 透传 `icon` 原始字符串（零新增读盘） |
| `src/core/market.ts` | `listInstalledWithMeta` 增 `opts.icon`（默认 false）；items 构建后按需并行富化 `iconDataUri?: string \| null` |
| `src/core/host-api.ts` | `installed` case 按 `probeMode !== 'only'` 传 `icon:true`；`installedUpdates` case 显式 `icon:false` |
| `src/client/chrome.jsx` | Icon 重写：候选链 + IO 懒加载 + 候选间失败前进（单 URL 双层失败由 useImgChain 既有 failed 承担） |
| `src/client/installed-tab.jsx` | 卡片 entry 增 `iconDataUri: it.iconDataUri` |
| `src/client/styles.js` | `.dshm-icon` object-fit:contain |
| `registry.json`（仓库根） | 精选条目补 `icon` https URL（T7） |
| `GLOSSARY.md` | 「图片加载链」条目（L211-214）后新增「图标解析链」（T8） |

**边界保持稳定**：`img-chain.js`、`useImgChain` 语义、`validateRegistry`、`safeScreenshots`、community-adapter、merged-market 一律不动。

## 任务间接口契约

- **Produces T1** → **Consumes T3**：`manifestIconToDataUri(dir: string, raw: string | undefined, pkg?: string): Promise<string | null>`；失败一律 resolve null。
- **Produces T2** → **Consumes T3**：`InstalledPlugin.manifestIcon?: string`（manifest.icon 原始值，未校验）。
- **Produces T3** → **Consumes T5/T6**：`InstalledItem.iconDataUri?: string | null`（data URI 或 null/缺席）。
- **Produces T4** → **Consumes T5**：`catalogIconUrl(v: unknown): string | null`（仅 `https://` 开头且可被 `new URL` 解析的字符串，否则 null）；`iconCandidates(entry: {icon?, github?, iconDataUri?}): string[]`（序：catalogIconUrl(icon) → iconDataUri（仅当以 `data:image/` 开头）→ `https://github.com/<owner>.png?size=64`（github 为 `owner/repo` 形态时）；去重、剔除 null）。
  - 候选序是纯函数的确定性契约。产品上「catalog icon 与 iconDataUri 同现」的冲突不存在：已装页只喂 `iconDataUri`（T6，entry.icon 恒 null）、市场页只喂 catalog icon——两字段分属不同面板的数据面。
- **Produces T5**：Icon 对外 props 不变（仍 `{ entry }`），六个消费方零改动（T6 的 installed-tab 只是给 entry 多喂一个字段）。

## 任务清单

> 环境（每个任务通用）：仓库根 `/home/ubuntu/workspace/dsh-m`；Node ≥22.19；`npm test` 的 pretest 会先 `npm run build`（esbuild 会 spawn 子进程，须在 danger-full-access 会话执行）；若刚做过插件安装器操作先 `test -d node_modules || npm install`。client 纯逻辑测试直 import `src/client/*.js`；core 测试 import `lib/` 产物，改 core 后必须先 build 再测。

### T1：core 解析器 `src/core/installed-icon.ts`（TDD）

1. 先写 `tests/installed-icon.test.mjs`（import `../lib/core/installed-icon.js`），用 `mkdtempSync` 造临时包目录 fixture，覆盖：
   - 合法 `.svg`/`.png` → 返回 `data:image/svg+xml;base64,...` / `data:image/png;base64,...`（media type 与官方 ICON_MEDIA_TYPES 一致）；
   - 绝对路径（`/etc/passwd`、`C:\x`）→ null；带 scheme（`https://...`）→ null；`../escape.svg` 逃出包目录 → null；
   - **symlink 安装（评审 R-3Q1）**：包目录本身是符号链接（链到临时区另一真实目录，模拟本机现实 `~/.dsh/profiles/web/node_modules/@iasiv5/dsh-onetree-log -> ../../../../../workspace/dsh-onetree-log` 五层跳出 profile）+ 合法 icon → **应成功**出 data URI（root realpath 后 containment 通过）；
   - **icon 文件为包外符号链接（评审 R-3Q1）**：包内 icon.svg 指向包外的白名单扩展名文件 → **应 null**（target realpath 后逃逸被判，官方点名防御场景）。fixture 用 `symlinkSync`；平台不支持时该两条 `t.skip` 并留注释；
   - 扩展名不在白名单（`.txt`、无扩展名）→ null；文件 >256KiB → null；文件不存在 → null；`raw` 非字符串/空串 → null；
   - `pkg` 给定且包 exports `./icon` → best-effort：能 resolve 到包内白名单文件则返回 data URI；`import.meta.resolve` 不可用/throw → 返回 null（**断言不 throw**，两种结果都合法——这条测试钉的是「永不炸」契约，不是解析成功）。
2. 跑 `npm run build && node --test tests/installed-icon.test.mjs` → 确认先红后绿（实现写完后全绿）。
3. 写最小实现，containment 对齐官方**两面 realpath**（评审 R-3Q1，官方 lib/index.js L2092-2095 逐行）：`root = realpathSync(dir)`；`target = resolve(root, raw)`；`const local = relative(root, realpathSync(target))`，`local === '..' || local.startsWith('..'+sep) || isAbsolute(local)` → null（root 与 target **都** realpath，缺一面则 symlink 安装误判逃逸、或包外文件经 icon 符号链被读入）。stat 与读文件都用 `realpath(target)` 并校验 isFile（对齐官方 L2104-2106），256KiB stat 与读后双重校验（官方 L2107-2109）。常量命名对齐官方：`ICON_MEDIA_TYPES`、`MAX_ICON_BYTES = 256 * 1024`。

验证：`npm run build && node --test tests/installed-icon.test.mjs` 全绿；`npm run typecheck` 零错误。

### T2：`installed.ts` 透传 `manifestIcon`

1. `sanitizePkgJson`（installed.ts L185-194）白名单增一行：`manifestIcon: typeof raw.icon === 'string' ? raw.icon.trim().slice(0, 300) : undefined`（`raw` 即 L211 的已解析 manifest 原始对象，零新增读盘；截断 300 对齐 homepage 字段惯例）。评审 Q3 修正：`info` 是 sanitize 产物（六字段白名单，**无 icon**），不得引用 `info.icon`。
2. `classifyDep` 两个返回臂（wantPatch=false L217-231 与 wantPatch=true L237-251）的 item 字面量**各**增一行 `manifestIcon: info.manifestIcon`——两臂同型构造面必须同步改，防静默不一致（评审附1）。
3. `InstalledPlugin` 接口增 `manifestIcon?: string`（undefined = manifest 未声明 icon）。
4. 在 `tests/installed.test.mjs` 追加断言：fixture 包 manifest 带/不带 `icon` 时 item 的 `manifestIcon` 值；并断言 wantPatch 两种取值下两臂都带该字段（沿用该文件现有 fixture 构造方式）。

验证：`npm run build && node --test tests/installed.test.mjs` 全绿。

### T3：`market.ts` 富化 + `host-api.ts` 接线

1. `listInstalledWithMeta` opts 增 `icon?: boolean`（默认 false）。在 items 构建（market.ts L883-887 之后、两条返回臂**之前**——deadline 早返回臂 L913 也在消费 items，必须在它之前完成富化）插入：
   ```ts
   if (opts.icon) {
     const icons = await Promise.all(items.map((it) =>
       it.manifestIcon ? manifestIconToDataUri(it.path, it.manifestIcon, it.pkg) : Promise.resolve(null)))
     // 就地写 iconDataUri（string | null），失败为 null；绝不 reject
   }
   ```
   （`it.path` 即包目录，T2 契约；并发用 Promise.all——本机盘读、单包 ≤256KiB、上限受已装数自然约束。）
2. `host-api.ts` `installed` case（L564-580）传 `icon: true`（'none' 快列表与 'full' 都出卡片，两段都要读）；`installedUpdates` case（L582 起）传 `icon: false`（updates 响应只取版本字段，图标是纯浪费 IO）。
3. `InstalledItem` 类型声明处（grep `interface InstalledItem` 定位）增 `iconDataUri?: string | null`。
4. 在 `tests/installed.test.mjs`（或该文件已有的 listInstalledWithMeta 测试段）追加一条：`icon:true` 时带合法 icon 的 fixture item 产出 `iconDataUri` data URI、`icon:false`/缺省时不产出该键。

验证：`npm run build && node --test tests/installed.test.mjs tests/market.test.mjs` 全绿（market.test 若有 listInstalledWithMeta 快照/形状断言被新键破坏，按其既有更新流程更新快照并在 PR 描述注明）。

### T4：client 纯逻辑 `src/client/icon-view.js`（TDD）

1. 先写 `tests/client-icon-view.test.mjs`（直 import `../src/client/icon-view.js`，仿 client-installed-view.test.mjs 头注释风格），覆盖：
   - `catalogIconUrl`：`https://cdn.jsdelivr.net/...` → 原样返回；`http://...` / `data:image/png;base64,...` / `'icon.svg'` / `123` / `''` / undefined → null；
   - `iconCandidates`：序断言——`{icon:'https://a/i.png', github:'o/r'}` → `['https://a/i.png','https://github.com/o.png?size=64']`；`{icon:'data:...', github:'o/r'}` → `['https://github.com/o.png?size=64']`（data: 不从目录侧进链）；`{iconDataUri:'data:image/png;base64,xx', github:'o/r'}` → `['data:image/png;base64,xx','https://github.com/o.png?size=64']`；`{iconDataUri:'data:...', icon:'https://a/i.png'}` → catalog 在前（本机实证与目录声明同现时目录声明优先——契约见上，测试钉死这个序）；`{github:'o'}`（无 repo 斜杠）→ `[]`；全空 → `[]`；重复 URL 去重。
2. 写实现（两个导出函数，纯逻辑，无 React import）。

验证：`node --test tests/client-icon-view.test.mjs` 全绿（client 纯逻辑不需 build，但保持 `npm test` 全套可跑）。

### T5：Icon 组件重写 + 样式（chrome.jsx / styles.js）

1. 重写 `chrome.jsx` 的 `Icon`（L42-60），结构（评审 R-2Q1 阻断修正：**hooks 全量无条件调用，禁止任何 hook 调用之前的提前 return**——已装页 key=it.pkg 复用实例，插件升级使 candidates 从 [] 变非空时，hook 层提前 return 会让同实例 hook 数不一致，React 抛「Rendered more hooks」崩卡片子树，违反 B1）：
   - `candidates = useMemo(() => iconCandidates(entry), [entry])`；
   - 候选键（join('|')）变化时渲染期重置 `idx`（useImgChain prevUrl 同款 derived-state 模式）；
   - `show`/`ref`/IO effect 恒初始化：IO 照抄 Shot（L284-304，deps []）——`ref` 恒挂在「未可见/兜底时渲染的字母 div」上（该 div 在 `!show || candidates.length === 0 || 链末位失败` 时渲染，恒有元素可挂），`rootMargin:'200px'`，`IntersectionObserver` 缺失直接 `setShow(true)`；
   - `chain = useImgChain(current && !current.startsWith('data:') ? current : '', { h: 96, active: show })`（评审 R-2Q3：data:/无候选喂空串——useImgChain 对 `!url` 不挂 8s 计时器（L373-374），并避免每次渲染对 ≤256KiB base64（~349KB 字符串）白算一次 weservUrl 的 encodeURIComponent（img-chain.js L30））；
   - 渲染：`!show || candidates.length === 0` → 字母 div（ref 挂它）——**渲染层短路即达成「无候选零 IO 零计时器」，不需要 hook 层提前 return**；`current.startsWith('data:')` → 直连 img（src=current，不走 chain.src；onError=前进 idx）；否则 chain.src img；`chain.failed && idx < len-1` → 渲染期 `setIdx(idx+1)`；`chain.failed` 且已是末位 → 字母 div。
   - img 属性保留既有：`className:"dshm-icon" alt:"" referrerPolicy:"no-referrer" decoding:"async"`，新增 `loading:"lazy"`；onError/onLoad 用 chain 的（data: 分支用手动前进）。
2. `styles.js` L255 `.dshm-icon`：`object-fit:cover` → `object-fit:contain`，其余逐字不动。
3. 确认项（已核实闭环，2026-10-26）：`serviceBucketOf`（L37-43）对未知宿主（含 `cdn.jsdelivr.net`）归 `raw` 桶（L39-42，两桶制）→ 精选 icon URL 照常 weserv 优先，无需任何改动。
4. 确定性测试同步（评审 R-2Q2）：`tests/client-render-smoke.test.mjs` L318-326 的「Icon 走链」DetailModal SSR 断言（头像 weserv src）在 T5 后**必红**（SSR 下 useEffect 不执行 → show 恒 false → 只渲染字母 div、无 img）——把该断言改锚为「SSR 下 Icon 渲染字母占位 div（aria-hidden）」；weserv 走链的 SSR 覆盖由同文件 L308-316 的 UseImgChainProbe 断言独立承担，覆盖面不丢。随后 `npm test` 全量跑，若 `tests/client-img-chain.test.mjs` / `tests/source-anchor-hygiene.test.mjs` 仍有锚定 Icon 旧实现的断言（行号/源码片段），按其文件头注释的锚更新规则同步。

验证：`npm run build && node --test tests/client-img-chain.test.mjs tests/client-render-smoke.test.mjs tests/source-anchor-hygiene.test.mjs` 全绿；随后 `npm test` 全量绿。

### T6：已装页接线（installed-tab.jsx）

1. L181 `entry: { name: it.name, github: vm.githubRepo, icon: null }` → 增 `iconDataUri: it.iconDataUri ?? null`（字段名对齐 T3 契约）。
2. 其余零改动（Icon props 契约未变）。

验证：`node --test tests/client-installed-view.test.mjs tests/client-render-smoke.test.mjs` 全绿。

### T7：registry.json 补 icon URL + https 守卫

1. 写 `tests/registry-icon-url.test.mjs`：读仓库根 `registry.json`，遍历 `plugins`，凡 `icon` 存在必须 `typeof === 'string' && /^https:\/\//.test(v)` 且 `new URL(v)` 成功；否则断言失败并列出违规条目 id。
2. 逐条为 23 个 bundled 条目找 icon（找不到就**跳过，不硬造**）：
   - npm 源条目：`curl -s https://data.jsdelivr.com/v1/packages/npm/<name>` 取 latest version → 该版本文件清单（同 API 的 flat 文件列表）找根级 `icon.svg|png|jpg|jpeg|webp`；或 `curl -s https://cdn.jsdelivr.net/npm/<name>@<ver>/package.json` 读其 `icon` 字段（官方约定，dsh-m 自己就是 `"icon": "./icon.svg"` 先例）→ 拼成 `https://cdn.jsdelivr.net/npm/<name>@<ver>/<path>`（**pin 精确版本**）；
   - github 源条目：优先同法查其 npm 包；确无 npm 包时用 `https://cdn.jsdelivr.net/gh/<owner>/<repo>@<sha或tag>/<iconPath>`；
   - 每个候选 URL 必须 `curl -sI` 验证 HTTP 200 且 content-type 以 `image/` 开头才写入；jsDelivr 不可达的条目记入 PR 描述表格（条目 id / 候选 / 结果），不阻塞其余条目。
3. 跑守卫测试确认全绿；`npm run build` 后确认 `lib/` 产物 registry 快照同步（若有）。

验证：`node --test tests/registry-icon-url.test.mjs tests/registry.test.mjs` 全绿。网络前提：能出网访问 data.jsdelivr.com / cdn.jsdelivr.com。

### T8：GLOSSARY + ADR-0025

1. `GLOSSARY.md` 在「图片加载链」条目后插入：

   > **图标解析链（Icon Resolution Chain）**:
   > 一个插件图标从声明到眼前依序尝试的候选序：声明图标（目录侧仅认 https URL；已装侧为本机按官方语义读出的 data URI）、GitHub 账号头像、字母占位。任一级失败静默降下一级；与图片加载链的关系是候选序在外、投递链在内——每个候选 URL 仍走图片加载链投递。
   > _Avoid_: 头像链（头像只是兜底级）、favicon（浏览器站点图标，概念错位）、logo 协议（实现细节）

2. 写 `docs/adr/0025-icon-resolution-chain.md`（格式对齐 0014）：
   - **背景**：官方约定调查结论（manifest icon / `<spec>/icon` → 校验 → data URI 内嵌 RPC、无 HTTP 路由无缓存、官方兜底是内置 SVG 而非头像）；dsh-m 现状（chrome.jsx:44 雏形、registry icon 字段 0/23 在用、installed-tab 显式 `icon:null` 焊死、社区上游无字段、已装列表自扫磁盘）；用户原始诉求「头像降为兜底、优先与官方面板同源」与性能疑虑（量级事实：分页 32/上限 96，同屏 ≤96 图标）。
   - **Considered Options**：① 维持现状（icon 字段永不生效）；② 后端代理/预爬图标入库（为不存在的并发问题付服务器与维护成本）；③ 采纳：候选链 + 目录侧 https-URL-only + 已装侧官方语义自读 + 纯前端懒加载。
   - **取舍要点**：头像兜底是对官方链的扩展（官方无此级）——市场场景下目录/头像即身份，保留；registry icon 拒收 data URI 是用户定案（防 2MiB registry 被图标撑爆、防目录侧夹带内联数据）；已装 data URI 唯一例外（本机实证、与官方逐字节同源）；懒加载量级依据（同屏 ≤96）；已装 icon 读盘仅限 detail 路径（`installedUpdates` 与市场查询热路径豁免）；官方读盘无缓存的行为照抄不缓存（本机盘读、量级可忽略）。
   - **Consequences**：回归防线（T1/T4/T7 新测试 + client-img-chain/render-smoke/source-anchor 既有防线）；校验层现状（评审 Q1）——validateRegistry 已对 icon 做 https 强校验、非法值整份拒绝（与 homepage 同款，冻结不动），客户端过滤是纵深防御、T7 守卫 PR 前置；已知偏离（exports `./icon` 依赖 import.meta.resolve 的 best-effort，bundler 剥离或 resolve 失败时该类插件已装页落头像而非图标；manifestIcon 300 字符截断——对齐 homepage 字段惯例，官方 iconOf 对路径无长度限制，超长合法路径截坏后解析 null 落头像，评审 R-2Q4）；上游 `dsh-plugin-catalog` 长出 icon 字段时**需在 community-adapter 白名单补一行透传**方入链①（现状封闭白名单，评审 Q2），客户端 https 过滤届时已就位；后续可选项（exports 解析加固；若将来想改「非法 icon 单条降级而非整份拒绝」，那是 validateRegistry 行为变更、需主人单独立决）不在本期。

验证：`node --test tests/test-title-hygiene.test.mjs` 全绿（若该守卫覆盖文档命名）；人审文档措辞。

### T9：最终验证（全量）

1. `npm run typecheck` 零错误。
2. `npm test` 全量绿（含 pretest build；client-imports 守卫过）。
3. 实机冒烟（本机即 web 机，可直接跑）：
   ```bash
   node -e "import('./lib/core/market.js').then(async m => { const r = await m.listInstalledWithMeta({}, { namespace:'host', probeMode:'none', icon:true }); const hit = r.items.filter(i => i.iconDataUri); console.log('total', r.items.length, 'withIcon', hit.length); console.log(hit.slice(0,3).map(i => i.pkg).join(',')); })"
   ```
   （命令以现场可跑为准：目标断言——`withIcon ≥ 7`（dsh-m 为顶层实体目录、`@iasiv5/` 下六个已装插件 package.json 均 `icon: "./icon.svg"`，评审第 3 轮核证 2026-10-26），且命中的 `iconDataUri` 以 `data:image/` 开头。）
4. UI 手验（可选）：`dshm_upgrade` 或本地 link 后按 know-how 037 的 client-only 验证姿势看已装页/精选页图标与懒加载行为。

## 执行纪律

- 开工前批判性复查本计划；发现缺项/矛盾/与仓库现实不符（行号漂移以「路径+符号锚」为准），先修计划再动手，不要猜。
- 按任务顺序执行，不无声跳步；每任务完成即跑其验证。
- 阻塞或重复失败立即停下说明。
- 当前若在 main/master，开始实现前先确认。
- checkpoint commit 只在 T3、T5、T7 三个自然边界各一次（core 链路通 / client 链路通 / 数据+文档齐），message 用仓内既有风格。
- 全部完成后输出修改摘要（文件 × 变更 × 验证结果）。
