# dsh-m 0.9.61 图片加载链（weserv 优先双兜底）实施计划

## 目标

dsh-m 0.9.61，纯客户端修复「大陆用户浏览器拉不到 `raw.githubusercontent.com` / `github.com` 图片」（2026-10-09 实测：服务器侧 HTTP 200/0.2s，用户浏览器缩略图条与灯箱全空；0.9.60 已排除灯箱 v2 回归）。2026-10-09 grilling 三轮共识（Q1-Q18 全按推荐拍板，Q16 加严为轮次不压缩）：

1. **对称双兜底加载链**：缩略图 `weserv → 原图 → 剔除`；灯箱 `weserv → 原图 → 占位（重试 + 打开原图）`；图标 `weserv → 原图 → 字母兜底`。超越 dsh-market 1.66.14（其灯箱直连原图、零兜底、零超时，大陆同款黑洞）。
2. **weserv 层 8s 人工超时**（仅此层；原图层零人工超时防误杀慢速合法下载）。
3. **赢家记忆**：页面生命周期、最近成功层、raw/avatar 两桶、三类消费方共享。
4. 顺带收益：`output=webp&q=80` 服务端转码（实测样本 22.5MB 五图预计压到 2-4MB 量级，含 10.4MB GIF）。

## 架构快照

- **纯逻辑层** `src/client/img-chain.js`（无 React、无 DOM，Node 直测）：
  - `WESERV_BASE = "https://images.weserv.nl/?"`（单一常量，未来设置项只改此处）
  - `weservUrl(src, { w?, h? })` → `${WESERV_BASE}url=${encodeURIComponent(src.replace(/^https?:\/\//, ""))}` + (`w=` 或 `h=`) + `&fit=inside&we=1&output=webp&q=80`
  - `serviceBucketOf(url)` → `"avatar"`（host 为 `github.com`）/ `"raw"`（`*.githubusercontent.com` 等其余全部，含未知宿主默认归 raw）
  - tier 机：`tierOrder(preferred)` → `[preferred, 另一层]`；`nextTier(current)` → weserv↔direct、direct 之后 `"failed"`；`needsTimeout(tier)` → 仅 `tier === "weserv"` 为真；`WESERV_TIMEOUT_MS = 8000`
  - 赢家记忆（模块态）：`preferredTier(bucket)` 初始恒 `"weserv"`；`rememberSuccess(bucket, tier)` 仅在成功时覆盖；`resetTierPreferences()` 测试钩子。**tier0 失败不降级偏好**，仅当 tier1 成功后翻转。
- **React 层**（main.jsx）：`useImgChain(url, opts)` hook（`opts = { w?, h?, active = true }`）——`attempt` 状态（0/1/failed），`src` 按 `tierOrder(preferredTier(bucket))[attempt]` 现算（weserv 层经 `weservUrl` 按消费方参数，direct 层用原 URL）；`url` 变化即重置 attempt；`onError` 前进一层；`onLoad` 记 `rememberSuccess`；**8s `setTimeout` 仅在「`active` 为真 且 当前层 `needsTimeout`」时挂**——即当前层的 img 实际开始加载后才计时（load/error/卸载/src 变化/active 翻真均重挂或清理）。`active` 语义为 IO 门控预留：Shot 传 `active: show`，缩略图未滚入视口不计时，**杜绝「不可见期间耗尽 weserv 层」**；Lightbox/Icon 不传（恒真）。返回 `{ src, failed, retry, onError, onLoad }`。
  - **Shot**（main.jsx:1167，IO 200px 懒加载保持）：`show` 为真后走链；双败回调 `onBroken(src)`。
  - **DetailModal 截图条**（main.jsx:~1381-1387）：新增 `broken` 列表 state；`visible = shots.filter(未 broken)`；全部 broken 隐藏整条；灯箱收 `visible` **活引用** + 传入索引钳制 `Math.min(lb, visible.length - 1)`（后台剔除收缩时防越界；已知行为：与灯箱 dots 数可能不一致，接受）；**DetailModal 作用域内四处 shots 基准同步换 visible**——①截图条整条门控 `shots.length → visible.length`（~L1381，全败隐藏的落点）、②截图条 map（**保持全量 shots map + `${i}:${src}` 稳定 key、broken 项渲 null**——剔除不得引发未 broken 项重挂重载）、③灯箱门控 `lb !== null && shots.length > 1`、④键盘导航 `lbStep(i, ±1, …)` 长度基准（~L1289-1291，漏改则剔除后键盘切到 visible 外索引）；键盘 effect 依赖数组 `[lb, shots.length, onClose]`（~L1296）随动换 `visible.length`。
  - **Lightbox**（main.jsx:~1213）：img 走链（`w=1600`）；双败渲染占位——「⚠ + i18n(lb.fail) + [重试 i18n(lb.retry)] + [打开原图 ↗ i18n(lb.open)]（ExtLink 新标签）」；重试 = `retry()` 重走整链（不动桶偏好）。
  - **Icon**（main.jsx:696）：`entry.icon || github.com/<owner>.png?size=64` 走链（`h=96`）；双败保持现有字母渐变兜底。
  - **CSS**：占位块（居中列、`.dsvm-lbfail` 族）新增；既有灯箱控件规则零改动。
  - **i18n**：`lb.fail/lb.retry/lb.open` 中英双字典。
- **SSR 语义**：renderToString 输出 tier0（weserv）src——**该语义仅对 SSR 即渲染 img 的消费方成立**（Icon、`__Lightbox` 直渲染、`__UseImgChainProbe`）；Shot 因 IO 门控（`show` 初始 false、effect 在 SSR 不跑）SSR 输出只有空 `.dsvm-shotbox`、无 img——缩略图的验证走源锚断言 + 探针 A16（route 命中记录）。占位/换层是运行时行为，由探针覆盖。
- **探针**（scripts/verify-lightbox.mjs 扩展）：weserv 用 `page.route` 伪造应答保确定性，断言「请求发往 weserv 且参数逐字正确」；四场景 + 赢家记忆 + 图标；`--live` 真网实证压缩率。

## 全局约束

- 目标版本 **0.9.61**；Node ≥22；本机 Linux/bash 验证。
- **纯客户端**：`src/client/**`、`tests/**`、`scripts/verify-lightbox.mjs`、`GLOSSARY.md`、`docs/adr/`、`CHANGELOG.md`、`package.json`(+lock) 之外零改动；host/core 零改动、零新 API。
- **白名单不放宽**：`safeScreenshots`（https + github.com/*.githubusercontent.com）逐字不动；weserv 只接收白名单截图 URL 与图标 URL。
- **超时策略**：8s 人工超时仅 weserv 层；direct 层只靠 onError，零人工超时。
- **属性保持**：所有层 `referrerPolicy: "no-referrer"`；img 加 `decoding: "async"`；Shot 保持 `loading: "lazy"` + `fetchPriority: "low"`；GIF 保持动画（动图 WebP）；**换源复用同一 `<img>` 换 `src`**，不重建节点。
- **记忆语义**：页面生命周期（不进 localStorage）；最近成功层；raw/avatar 两桶；未知宿主归 raw；tier0 失败不降级偏好。
- **不做**：设置项自定义代理（记后续候选）、README 图片（MdImg）治理、服务器代理、第三方 base 可配置化。
- **发布门**：本地全绿 → 完整多轮独立 subagent 评审（**轮次不压缩**，直到共识，0.9.60 同款协议）→ 主人确认 → tag `v0.9.61` → push → CI（publish.yml OIDC）→ registry 验证 → `dshm_upgrade` + `dshm_restart`。publish 前的暂停点为主人确认，不可跳过。
- 文案锚点：占位三键 i18n key `lb.fail` / `lb.retry` / `lb.open` 为测试锚，不得改写。
- 当前仓库在 `main`（HEAD `cf8afa5`，0.9.60 已发布）。在 main 直接执行需主人批准——本计划获批即视为该批准（checkpoint 处再显式声明）。

## 输入工件

- 设计来源：2026-10-09 会话 grilling 三轮共识（对话即需求，本文「目标/架构快照」为固化）。
- 对标分析：dsh-market 1.66.14（本机装于 `~/.dsh/profiles/web/node_modules/dshmarket`，源镜像 `.dsh-research/dsh-market-clone`@1.66.3）——`thumbUrl()` 无条件 weserv（实测大陆 1.39s/23KB vs 原图 41KB）、灯箱 `src: shots[index]` 直连零兜底、raw/avatar 赢家记忆先例。
- 故障证据（2026-10-09）：`dsh-wallpaper-engine` 五图全 `raw.githubusercontent.com`（22.5MB，含 10.4MB GIF）；服务器 curl 200/0.2s；用户浏览器全空。
- 相关既有件：`scripts/verify-lightbox.mjs`（0.9.60 探针，A0-A15）、`tests/client-lightbox.test.mjs`、`tests/client-render-smoke.test.mjs`（`__Lightbox` 导出于 L33）、`src/client/lightbox.js`。

## 文件结构与职责

- Create: `src/client/img-chain.js` — 纯逻辑（URL 构造/桶分类/tier 机/赢家记忆），零 React 零 DOM。
- Modify: `src/client/main.jsx` — `useImgChain` hook（Lightbox 组件附近，~L1213 前）；Shot（L1167）、截图条（~L1385）、Lightbox img（~L1223）、Icon（L696）接线；占位 CSS（灯箱 CSS 块 ~L386-408 内追加）；i18n ZH/EN（L86/L197 区）。
- Create: `tests/client-img-chain.test.mjs` — img-chain 单测 + main.jsx 源锚。
- Modify: `tests/client-render-smoke.test.mjs` — SSR 断言（tier0 src=weserv、Icon 走 weserv、占位结构源锚）。
- Modify: `scripts/verify-lightbox.mjs` — 四场景矩阵 + 赢家记忆 + 图标 + `--live`。
- Create: `docs/adr/0014-image-chain-weserv-first.md` — 取舍记录（下一个空号，已到 0013）。
- Modify: `GLOSSARY.md` — 仅加「图片加载链（Image Chain）」一条。
- Modify: `CHANGELOG.md` + `package.json`/`package-lock.json` — 0.9.61 双语条目与版本。

## 任务清单

### Task 1: img-chain 纯逻辑（TDD）

- 目标：`src/client/img-chain.js` 全量导出 + 单测全绿。
- 涉及文件：Create `src/client/img-chain.js`、Create `tests/client-img-chain.test.mjs`。
- 接口契约：
  - Consumes: 无（首任务）。
  - Produces: `WESERV_BASE`、`WESERV_TIMEOUT_MS=8000`、`weservUrl(src,{w,h})`、`serviceBucketOf(url)`、`tierOrder(preferred)`、`nextTier(current)`、`needsTimeout(tier)`、`preferredTier(bucket)`、`rememberSuccess(bucket,tier)`、`resetTierPreferences()`——签名与语义见「架构快照」，后续任务逐字依赖。
- 验证范围：单测覆盖 weservUrl 三参数形态（thumb `h=300`/lightbox `w=1600`/icon `h=96`，参数串逐字 `fit=inside&we=1&output=webp&q=80`，scheme 剥离与 encodeURIComponent）、桶分类（github.com→avatar；raw.githubusercontent/user-images/任意域→raw）、tier 机（nextTier 回绕与 failed 终态、needsTimeout 仅 weserv）、记忆（初始 weserv、rememberSuccess 覆盖、tier0 失败不降级由「无失败 API」结构性保证、reset 复原）。

- [ ] Step 1: 写失败测试
- Change: 新建 `tests/client-img-chain.test.mjs`，用例按验证范围逐条落（断言参数串逐字匹配，如 `weservUrl(u,{h:300})` 以 `https://images.weserv.nl/?url=raw.githubusercontent.com%2F...&h=300&fit=inside&we=1&output=webp&q=80` 结尾断言）。
- [ ] Step 2: 确认失败
- Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-img-chain.test.mjs`
- Expected: 全部用例失败（模块不存在，ERR_MODULE_NOT_FOUND）。
- [ ] Step 3: 最小实现
- Change: 新建 `src/client/img-chain.js`，按「架构快照」导出全集；文件头注释记 0.9.61 根因与 dsh-market 对标一句话。
- [ ] Step 4: 确认通过
- Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-img-chain.test.mjs`
- Expected: 全绿。

### Task 2: useImgChain hook（main.jsx）

- 目标：hook 落地并被 SSR 冒烟验证初始态（tier0 src）。
- 涉及文件：Modify `src/client/main.jsx`（Lightbox 前新增 hook + 文件头 require img-chain）、Modify `tests/client-render-smoke.test.mjs`（追加导出与断言）。
- 接口契约：
  - Consumes: Task 1 全部导出。
  - Produces: `useImgChain(url, opts)`（`opts = { w?, h?, active = true }` 决定 weservUrl 参数与计时资格；返回 `{ src, failed, retry, onError, onLoad }`）；冒烟导出名 `__UseImgChainProbe`（内部小组件 `h("img", { src: chain.src })` 供 SSR 断言）。
- 验证范围：SSR 初始 `src` 为 weserv URL（含正确 w/h 参数）；`url` prop 变化的重置语义由源锚断言（`useEffect` 依赖 `url`）；**计时门控语义**由源锚断言（timer 挂载条件含 `active` 与 `needsTimeout(当前层)`，依赖数组含 active）。

- [ ] Step 1: 冒烟加失败断言
- Change: `tests/client-render-smoke.test.mjs` 导出行（L33）追加 `__UseImgChainProbe`；新增 it：render `h(components.__UseImgChainProbe, { url: "https://raw.githubusercontent.com/a/b/HEAD/c.png", w: 1600 })` 断言输出含 `src="https://images.weserv.nl/?url=raw.githubusercontent.com%2Fa%2Fb%2FHEAD%2Fc.png&amp;w=1600&amp;fit=inside&amp;we=1&amp;output=webp&amp;q=80"`。
- [ ] Step 2: 确认失败
- Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-render-smoke.test.mjs`
- Expected: 新 it 红（导出未定义）。
- [ ] Step 3: 实现 hook 与 Probe
- Change: main.jsx 顶部 `const { WESERV_BASE, weservUrl, serviceBucketOf, tierOrder, nextTier, needsTimeout, preferredTier, rememberSuccess, WESERV_TIMEOUT_MS } = require("./img-chain.js");`；`useImgChain` 按「架构快照」实现（attempt state；**8s 定时器仅在 `active && needsTimeout(当前层)` 的 effect 中挂**，依赖含 active/src——img 实际开始加载后才计时；清理链完备；`retry` 重置 attempt）；紧随其后定义 `UseImgChainProbe`。
- [ ] Step 4: 确认通过
- Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-render-smoke.test.mjs`
- Expected: 全绿（含既有用例零回归）。

### Task 3: Shot + 截图条 broken 接线

- 目标：缩略图走链（h=300），双败剔除、全败隐藏整条。
- 涉及文件：Modify `src/client/main.jsx`（Shot L1167、DetailModal 截图条 ~L1385）、Modify `tests/client-img-chain.test.mjs`（源锚 describe）。
- 接口契约：
  - Consumes: `useImgChain`（含 `active` 语义）。
  - Produces: `Shot` 新签名 `({ src, onClick, onBroken })`（`failed` 为真时经 effect 上报 `onBroken(src)` 后渲染 null——**不得在渲染体内直调父 setState**）；DetailModal 内 `brokenShots` 列表（`setBrokenShots(prev => prev.includes(src) ? prev : prev.concat(src))` 去重）+ `visible` 过滤 + 全败隐藏 + 灯箱改收 `visible`。
- 验证范围：**源锚断言**（Shot 内 `useImgChain(src, { h: 300, active: show })`；img 用 `chain.src` + `decoding: "async"` 且保留 `loading: "lazy"`/`fetchPriority: "low"`/`referrerPolicy`；`onBroken` 在 effect 中调用；`visible` 过滤式；灯箱 `shots={visible}` + `index: Math.min(lb, visible.length - 1)` 钳制；四处 shots→visible 基准（整条门控 `shots.length→visible.length`、灯箱门控 `lb !== null && shots.length > 1`、键盘 `lbStep` 长度基准与 effect 依赖 `[lb, shots.length, onClose]`）；列表 map 基于全量 shots 且 key 形态 `${i}:${src}` 保持、broken 项渲 null）——SSR 不做输出断言（Shot 的 img 不进 SSR，见「架构快照」SSR 语义）；运行时行为由探针 A16（route 命中 `h=300`）与 A23（剔除实证）承担。

- [ ] Step 1: 源锚断言先行
- Change: `tests/client-img-chain.test.mjs` 新增源锚 describe（上述五锚点逐条）。
- [ ] Step 2: 确认失败
- Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-img-chain.test.mjs`
- Expected: 新锚红。
- [ ] Step 3: 实现
- Change: Shot 内 `useImgChain(src, { h: 300, active: show })`，img 换 `chain.src` + `decoding: "async"`（保持 IO/`show`/lazy/low 既有结构）；`failed` 经 `useEffect([failed])` 上报 `onBroken(src)` 并渲染 null；DetailModal 加 `brokenShots` state（去重合并）、`visible` 派生；**四处 shots 基准换 visible**——截图条整条门控 `shots.length`（~L1381）、截图条 map（保持全量 shots map + `${i}:${src}` 稳定 key，broken 项渲 null）、灯箱门控 `lb !== null && shots.length > 1`、键盘导航 `lbStep(i, ±1, …)` 长度基准与 effect 依赖数组（main.jsx:~1289-1296）；Lightbox 传 `shots={visible}` 且 `index` 用 `Math.min(lb, visible.length - 1)` 钳制。
- [ ] Step 4: 确认通过
- Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-render-smoke.test.mjs tests/client-img-chain.test.mjs`
- Expected: 全绿。

### Task 4: Lightbox 占位终态

- 目标：灯箱大图走链（w=1600），双败占位「失败 + 重试 + 打开原图」。
- 涉及文件：Modify `src/client/main.jsx`（Lightbox img ~L1223、CSS 块、i18n ZH/EN）、Modify `tests/client-lightbox.test.mjs`（既有 img 直连源锚更新）、Modify `tests/client-render-smoke.test.mjs`（既有 `src="a.png"` 断言更新）、Modify `tests/client-img-chain.test.mjs`。
- 接口契约：
  - Consumes: `useImgChain`、`ExtLink`（既有）。
  - Produces: 占位结构（`div.dsvm-lbfail` > ⚠ 文案 + `button`（`lb.retry`，onClick `chain.retry()`）+ `ExtLink`（`lb.open`，href 原 URL））；i18n 键 `lb.fail`/`lb.retry`/`lb.open`（zh：图片加载失败/重试/打开原图；en：Failed to load image/Retry/Open original）。
- 验证范围：源锚——占位三件结构、`retry` 接线、`w: 1600` 参数、ExtLink href 为原 URL；i18n 双字典各含三键；**两处既有断言按新链更新**（见 Step 1）。

- [ ] Step 1: 断言先行（新锚 + 两处既有锚更新）
- Change: `tests/client-img-chain.test.mjs` 源锚 describe 追加占位/重试/参数断言；`tests/client-lightbox.test.mjs` L72 直连 img 锚更新为链化形态（断言 `chain.src` 接线 + 保留 `onClick: onClose` 与 `referrerPolicy: "no-referrer"` 语义锚）；`tests/client-render-smoke.test.mjs` 灯箱用例的 `<img[^>]*src="a\.png"` 断言更新为 weserv 形态（`src="https://images.weserv.nl/?url=a.png&amp;w=1600&amp;…`，`url=a.png` 经 scheme 剥离后原样保留）。
- [ ] Step 2: 确认失败
- Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-img-chain.test.mjs`
- Expected: 新锚红（两处既有锚更新后亦暂红——断言先行；至 Step 4 实现后全量转绿）。
- [ ] Step 3: 实现
- Change: Lightbox 内 `useImgChain(shots[index], { w: 1600 })`（注意：`index` 变化即 `url` 变化，hook 自重置）；img 用 `chain.src` + `decoding: "async"`；`chain.failed` 时渲染占位块替代 img（`onClick` 停止冒泡防误关）；CSS 追加 `.dsvm-lbfail` 族（居中列、间距、按钮复用 `.dsvm-btn`，⚠ 用文字符号）；ZH/EN 字典补三键。
- [ ] Step 4: 确认通过
- Run: `cd /home/ubuntu/workspace/dsh-m && npm test`
- Expected: 全量绿——除 img src 直连锚两处按 Step 1 新形态更新外，其余既有断言零回归。

### Task 5: Icon 接线

- 目标：图标走链（h=96），双败保持字母兜底。
- 涉及文件：Modify `src/client/main.jsx`（Icon L696）、Modify `tests/client-render-smoke.test.mjs`。
- 接口契约：
  - Consumes: `useImgChain`。
  - Produces: Icon 内部 `useImgChain(url, { h: 96 })`，`chain.failed` 等价既有 `broken` 分支（字母渐变兜底渲染逐字不变）。
- 验证范围：SSR——community 条目 DetailModal 头部 Icon 的 img src 含 `images.weserv.nl` 与 `&h=96&`（github.com 头像经 scheme 剥离入 url 参数）。

- [ ] Step 1: 失败断言先行
- Change: 冒烟追加 Icon 断言。
- [ ] Step 2: 确认失败
- Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-render-smoke.test.mjs`
- Expected: 红。
- [ ] Step 3: 实现
- Change: Icon 用链替换直连 src，`decoding: "async"`，failed→字母分支。
- [ ] Step 4: 确认通过
- Run: `cd /home/ubuntu/workspace/dsh-m && npm test && npm run typecheck`
- Expected: 全绿、零类型错误。

### Task 6: 探针四场景 + 赢家记忆 + 剔除实证 + --live

- 目标：`scripts/verify-lightbox.mjs` 扩展为加载链确定性验证（不依赖真 weserv 可达）。
- 涉及文件：Modify `scripts/verify-lightbox.mjs`。
- 接口契约：
  - Consumes: Task 3/4/5 的运行时行为。
  - Produces: 场景断言 A16-A23 + `--live` 模式（默认关）。
- 验证范围（每条为独立 PASS/FAIL 行）：
  - **Harness 前置改造**：① 初始化即挂 `**images.weserv.nl**` fulfill route（复用 SVG 生成器）——保证既有 A0-A15 与新场景全程零真网 weserv 依赖；② `__boot` entry 补 `github: "elysia395/dsh-wallpaper-engine"` 使 Icon 走真实头像 URL（github.com 宿主 → avatar 桶，route 伪造应答）；③ 请求记录器（`page.on("request")` 收集 URL 数组，按域名过滤断言；**每场景开头清空**）。
  - **Route 生命周期协议**：Playwright route 跨 reload 持续——凡标注「reload」的场景开头必须 `page.unrouteAll()` 后仅重挂该场景所需 route，再 reload + 重新 `__boot`（记忆归零 + route 干净双保证）。**「基础 fulfill」显式枚举三域（域名为指称，route pattern 须匹配完整 URL——Playwright glob 是全 URL 锚定，照抄裸域名会静默失配）**：直连截图域（pattern `https://github.com/fake/**`，沿用既有脚本先例）、图标头像直连域（pattern `**/elysia395.png*`，命中 `https://github.com/elysia395.png?size=64`）、weserv 域（`**images.weserv.nl**`）——凡图标可能翻 direct 层的场景（A18/A21/A22），图标直连域 fulfill 必须在位，杜绝真网泄漏。
  - A16 默认双通（无 reload，初始态）：灯箱 img `src` 域名 = images.weserv.nl，且请求 URL 参数含 `w=1600&fit=inside&we=1&output=webp&q=80`；缩略图请求含 `h=300`；图标请求含 `h=96`（route 命中记录断言）。
  - A17 断直连（reload + route 重置后 abort `github.com/fake/**` 与图标头像直连域）：图仍渲染（`naturalWidth > 0`，链停在 weserv 层）。
  - A18 断 weserv（reload + route 重置后 abort `**images.weserv.nl**`，两个直连域 fulfill 保留）：img src 翻转为直连 URL 且渲染成功。
  - A19 双断 + 新图触发（**不 reload、保留 A18 的记忆翻转**——在 A18 挂载态上**加挂**两个直连域的 abort route，此时起点 tier0=direct——照实接受）：先经 ‹/› 切换到**下一张**（新 URL 走链，旧图已渲染成功不会自发重走）→ 该图双败 → 占位可见（`.dsvm-lbfail`），含重试钮与 `href` 为原 URL 的打开原图链接。
  - A20 重试（续 A19 双断状态）：点重试 → 网络再收到该图请求（对该图 URL 的请求计数 +1，tier 无关断言）。
  - A21 weserv 挂起（reload + route 重置后 weserv route `delay 30s` 再 fulfill，两个直连域 fulfill 保留）：开灯箱 → ≤9.5s 内 img src 翻转为直连并渲染（8s 守卫实证；本场景自带 reload，不受先前场景污染）。
  - A22 赢家记忆（reload + route 重置后仅 abort weserv，两个直连域 fulfill 保留）：开灯箱（经直连成功）→ ‹/› 切下一张 → 新图的首个图片请求走直连域（最近成功层翻转实证；两桶语义注：本场景全为 raw 桶——图标 avatar 桶的记忆由 A16/A17 的图标请求路径覆盖存在性，不单独断言翻转）。
  - A23 缩略图剔除（reload + route 重置后两域均 abort）：等首张缩略图双败上报 → `.dsvm-shotbox` 数量递减；三张全败后 `.dsvm-shotrow` 整条消失（Q9 剔除/隐藏实证）。
  - `--live` 语义闭合：**A0-A23 照旧跑（route 伪造不变）**，仅追加一段真网压缩对比——样图 `https://raw.githubusercontent.com/elysia395/dsh-wallpaper-engine/HEAD/docs/images/mascot-drawer.png`（2.9MB，不经任何 route）直连与经 weserv 各拉一次，断言 weserv 字节 ≤ 直连字节，实测数值报出并落 CHANGELOG（Task 9 引用）。
- 注意：场景顺序即书写顺序（A16→A23）；A19/A20 依赖 A18 的记忆翻转状态，A21/A22/A23 各自 reload + route 重置归零。脚本总时长预期 ~40-50s（A21 含 8s 实等待、A23 含双败上报时序）。

- [ ] Step 1: 扩展探针
- Change: 按上述验证范围落地（harness 前置改造三项、route 生命周期协议、A16-A23、`--live` 分支）。
- [ ] Step 2: 跑通
- Run: `cd /home/ubuntu/workspace/dsh-m && node scripts/verify-lightbox.mjs`
- Expected: A0-A23 全 PASS（既有 A0-A15 零回归）。
- [ ] Step 3: live 实证
- Run: `cd /home/ubuntu/workspace/dsh-m && node scripts/verify-lightbox.mjs --live`
- Expected: A0-A23 全 PASS 且追加的真网压缩对比 PASS（输出直连 vs weserv 字节数值）。

### Task 7: GLOSSARY 词条

- 目标：加且仅加一条术语。
- 涉及文件：Modify `GLOSSARY.md`。
- 接口契约：Consumes 共识 Q14；Produces 词条「图片加载链（Image Chain）」——定义含「有序投递路径（代理层→原图层→终态）」「缩略图/灯箱/图标共用」，零实现细节（不出现 weserv/tier/桶）。
- 验证范围：词条存在、无实现词、其余词条零改动。

- [ ] Step 1: 追加词条（按文件内既有格式：术语 + 定义 + _Avoid_ 行）
- Run: `cd /home/ubuntu/workspace/dsh-m && git diff --stat GLOSSARY.md`
- Expected: 1 file changed, insertions only（约 +5 行）。

### Task 8: ADR-0014

- 目标：记录 weserv-first 取舍。
- 涉及文件：Create `docs/adr/0014-image-chain-weserv-first.md`（编号承接 0013）。
- 接口契约：Consumes 共识 Q15 + 对标数据；Produces ADR 正文——背景（大陆不可达证据）、决策（对称双兜底 + weserv 优先）、淘汰方案（直连优先/服务器代理/dsh-market 式缩略图-only，各附淘汰理由）、后果（第三方依赖、逃生门演进路径、dsh-market 实测 1.39s/23KB vs 41KB 引用）。
- 验证范围：三淘汰方案齐全、含实测数据、格式对齐仓库既有 ADR（标题/状态行）。

- [ ] Step 1: 写 ADR
- Run: `cd /home/ubuntu/workspace/dsh-m && ls docs/adr/ | tail -2`
- Expected: `0013-npm-registry-route.md` 之后出现 `0014-image-chain-weserv-first.md`。

### Task 9: CHANGELOG + 版本 + 全量回归快照

- 目标：0.9.61 双语条目、版本 bump、全量验证绿。
- 涉及文件：Modify `CHANGELOG.md`、`package.json`、`package-lock.json`（`npm version 0.9.61 --no-git-tag-version`）。
- 接口契约：Consumes Task 1-8 全部产物；Produces 中文/英文 0.9.61 条目（根因/双兜底设计/超时与记忆/探针 A0-A23 与 --live 实测数据（--live 样图：dsh-wallpaper-engine mascot-drawer.png 直连 vs weserv 字节）/评审轮记录留空待 Task 10 后补）。
- 验证范围：条目与实现一致（参数、场景编号、阈值逐字）。

- [ ] Step 1: 写双语条目（版本号 0.9.61，两区块各一条）
- [ ] Step 2: bump 版本
- Run: `cd /home/ubuntu/workspace/dsh-m && npm version 0.9.61 --no-git-tag-version && npm run build`
- Expected: 三文件版本一致、build ok。
- [ ] Step 3: 全量验证
- Run: `cd /home/ubuntu/workspace/dsh-m && npm test && npm run typecheck && node scripts/verify-lightbox.mjs`
- Expected: 全绿 / 零错误 / A0-A23 全 PASS。

### Task 10: 完整多轮独立 subagent 评审（轮次不压缩）

- 目标：0.9.60 同款协议——独立 subagent 凭代码实证评审，多轮交互直到共识，意见直接落码后重验。
- 涉及文件：视评审意见（预期集中在 main.jsx/img-chain.js/探针/CHANGELOG）。
- 接口契约：
  - Consumes: Task 1-9 全部产物（评审输入含：grilling 共识 Q1-Q18、本计划、`git log` 提交范围、可跑的验证命令）。
  - Produces: 评审轮记录（逐轮裁决与吸收清单，摘要补入 CHANGELOG 0.9.61 条目「评审吸收轮」bullet）。
- 验证范围：每轮后如有落码——`npm test && npm run typecheck && node scripts/verify-lightbox.mjs` 重跑全绿；终态裁决为共识 approve。

- [ ] Step 1: 组装评审 prompt（共识+计划+提交范围+验证命令，评审员只读不改）
- [ ] Step 2: 多轮交互直到共识（每轮处置逐条回告，吸收项落码并重验）
- [ ] Step 3: CHANGELOG 补「评审吸收轮」bullet + 重跑 Step 3 of Task 9 验证

### Task 11: 发版（gated——主人确认后）

- 目标：publish 0.9.61 并升级本机。
- 涉及文件：无代码改动（git/npm 操作）。
- 接口契约：Consumes Task 10 共识 approve + 主人显式确认；Produces npm `dsh-m@0.9.61` latest + 本机已装升级 + DSH Web 重启。
- 验证范围：CI run success（含其「Verify version is live」registry 可见性步，publish.yml L70）、registry `latest: 0.9.60→0.9.61`（cache-buster curl packument）、`dshm_outdated` 无 dsh-m。

- [ ] Step 1: 提交与打标
- Run: `cd /home/ubuntu/workspace/dsh-m && git add -A && git commit -m "ui(client): image chain - weserv-first dual fallback (0.9.61)" && git push origin main && git tag v0.9.61 && git push origin v0.9.61`
- Expected: push 成功，GitHub Actions「Publish to npm (trusted publishing / OIDC)」run 触发。
- [ ] Step 2: 等 CI + registry 验证
- Run: `curl -s "https://api.github.com/repos/iasiv5/dsh-m/actions/runs?per_page=2"`（轮至 conclusion=success）；`curl -s -H "Accept: application/json" "https://registry.npmjs.org/dsh-m?_=$(date +%s)" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)['dist-tags'].latest))"`
- Expected: success；latest=0.9.61（registry 异步可见性，必要时带 cache-buster 重查）。
- [ ] Step 3: 本机升级 + 重启
- Run: dshm_upgrade(pkg `dsh-m`) → 主人同意后 dshm_restart
- Expected: 本机已装版本（实查起点，当前应为 0.9.60）→ 0.9.61 升级成功，重启后面板正常。

## 执行纪律

- 开始实现前，先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动代码。
- 按任务顺序执行，不无声跳步、合并步或改变任务目标。
- 每完成一个任务，运行该任务定义的验证；验证不过不算完成。
- 遇到阻塞、重复失败或计划与仓库现实不符（如行号漂移——本计划锚点以符号名为准，行号仅参考），立即停下说明，不猜。
- 在 `main` 分支直接执行已获主人批准（计划获批即生效）；checkpoint commit 仅在自然边界（建议 Task 6 后、Task 9 后）使用，粒度可由主人调整。
- 全部任务完成后跑最终验证并输出修改摘要。

## 最终验证

1. `cd /home/ubuntu/workspace/dsh-m && npm test` — 全量绿（基线 1236——2026-10-09 实跑核对 + 新增用例）。
2. `npm run typecheck` — 零错误。
3. `node scripts/verify-lightbox.mjs` — A0-A23 全 PASS（确定性，不依赖真 weserv）。
4. `node scripts/verify-lightbox.mjs --live` — 压缩实证 PASS。
5. 抽查：`grep -rn "images.weserv.nl" src/client/ | wc -l` — 仅 img-chain.js 一处常量（单一事实源）。
6. 发版后：registry latest=0.9.61 + 本机升级重启 + 真机看图（主人侧验收：大陆网络下缩略图与灯箱均出图）。
