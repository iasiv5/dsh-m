# issue #52 README 相对链接/图片死链修复 实施计划

## 目标

- 修复 [#52](https://github.com/iasiv5/dsh-m/issues/52)：README 渲染中相对链接与相对图片因「`RENDER_REPO` 构建期设好、`ExtLink`/`MdImg` 渲染期才读」而全部归 `#` 的死链问题（issue 自报 22 插件 62.7% 链接死链——该统计未独立复核，仅机理经本役探针独立复现）。
- 顺带修复同族构建期 bug **F2**（本役新发现，issue 未覆盖）：`mdHtmlBlock` 递归调用 `renderMarkdown(inner, depth + 1)` 把 `depth + 1` 误放进 `opts` 形参位，包裹块（`<div>`/`<details>` 等）内含块结构时 repo 丢失、内容死链。
- 随 C4 闭环补一处 **safeUrl 危险 scheme 硬化（C8）**：带基址时非 http/mailto 的 scheme 形态（`javascript:`/`data:`/`vbscript:` 等）不得借仓库相对分支逃逸成 blob/raw URL——R1/R2 双收敛实证：无 C8 时 TA8 必红、安全闸翻面（附录 A R1-1/R2-1）。
- 范围：仅客户端 `src/client/markdown.js` 及其测试；不触碰 chrome.jsx / settings-tab.jsx / detail-modal.jsx / installed-tab.jsx / core 面；不做 #53/#54。

## 架构快照

- **方案 A（构建期预解析）**：在 `mdInline`/`mdHtmlInline` 构造 React 元素 props 时就地调用 `safeUrl`（此刻在 `renderMarkdown` 的同步窗口内，`RENDER_REPO` 有效），组件收到**已解析**的 `href`/`src`。组件体内的 `safeUrl` 保留——它对解析产物幂等（附录 A E4 不变量），继续充当安全闸与直调兜底。
- 不取 issue 方案 B（全链显式传参）：方案 A 下 `RENDER_REPO` 的全部**值决定性**读取都收敛进同步窗口，issue 提出的重入隐患不复存在。承重前提两条（R1-5）：(a) 生产 h 是真 `React.createElement`（chrome.jsx 工厂），组件体不在窗口内执行；(b) `renderMarkdown` 返回前 `finally` 已复位全局。防未来回归：在构造点之外直接调用组件、或在窗口内做同步组件渲染，都会破坏该前提。
- **F2 修复（C7）**：`renderMarkdown(inner, { repo: RENDER_REPO }, depth + 1)`——`{ repo }` 显式透传 + `depth` 归位第三参（恢复 0.9.47 声明的递归深度护栏意图；现状 depth 恒 0、护栏从不生效）。R2 已验证：调用点确在同步窗口内、全仓递归调用点仅此一处、两层嵌套解析正常、prev/finally 恢复链无泄漏。
- **危险 scheme 硬化（C8）**：`safeUrl` 在仓库相对分支（L44 时点）前拒绝「scheme 形态但非 http/mailto」的输入归 `#`——使安全闸与有无基址无关。R1/R2 双收敛提出同一处方；R2 实证含卫兵修码副本跑既有 suite **fail 0**（卫兵与既有测试面兼容）。
- 与现有结构衔接：`renderMarkdown` 唯一生产调用点是 `chrome.jsx` `ReadmeBlock`（repo 来自 readme API）；`settings-tab.jsx` 只直调 `ExtLink`（绝对 URL）。零调用方改动。

## 全局约束

- **测试锚纪律**（`docs/CODING-STANDARDS.md`）：本计划全部测试为**结构断言**（props 值 / SSR HTML 串包含），不引入源串锚与 bundle 锚；源串锚禁含 `\n`（CRLF 检出）之禁令自然满足。
- **退出码卫生**：过滤管道一律 `set -o pipefail`，门禁以原测试进程退出码判定。
- **改返回形状必清点断言面**：本计划零函数签名/返回形状变化（只改 props 构造点 + safeUrl 内新增一个提前 return 分支），`deepEqual` 断言面零波及——R1/R2 各自 fix-sim 副本跑既有 26 用例均 **fail 0**。
- **行为零变化承诺格**：见附录 A「行为零变化格」，验收按格对账。
- **i18n**：零新增文案键（无 UI 文案改动）。
- **发版纪律**（`dsh-m/AGENTS.md`）：`npm run release`（push/tag/publish）与 issue 回复/关闭属不可逆公开动作，执行前停下等主人当轮明确批准。
- **分支**：仓库在 `main`（HEAD eea9447；0.12.9 发版提交为 3dfd419，eea9447 是其后的 registry-only 提交，`markdown.js` 自 0.9.49 未再改动、锚有效），仓库惯例直接落 main、不发 PR；checkpoint commit 仅本地，不 push。
- 无额外版本/依赖/平台约束（纯客户端 ESM 面，零运行时依赖变化；测试新增 react/react-dom/server import，二者已是 devDeps——package.json L91-92）。

## 输入工件

- issue 原文：`gh api repos/iasiv5/dsh-m/issues/52 --jq .body`
- 证据探针：`/home/ubuntu/workspace/.dsh-research/issue52-deadlink-scratch/`（`probe1.mjs` P1/P2/P3；`probe-ta10.mjs` TA10 形态与红色预测实测——现码 SSR `href="#"` RED 符合预期）
- **R1 规格评审（2026-11-08 已回，6 条发现全部处置）**：F1→C8+TA8 改带基址形态；F2→零变化格补 root-relative 行 + TA9；F3→收集器 children 合并；F4→行号时点勘误；F5→承重前提两句；F6→probe1.mjs 双走修正。探针：`review-r1-ta-probe.mjs`（现状红绿复核）、`fix-sim/`、`collector-check.mjs`。
- **R2 对抗评审（2026-11-08 已回，7 项：1 重要 / 2 次要 / 1 建议 / 3 通过，全部处置）**：F1→C8（与 R1 收敛；含卫兵副本既有 suite fail 0）；F2→E4 条件化改写（幂等 →「渲染期全局恒空」不变量）；F3→零变化格降级面收窄；F6→TA10 SSR 端到端用例；F7→E5 补 repo prop 来源。正向确认：源锚 needle 全部唯一命中（含 L20 注释行）、deferred 与 renderToString 同构、现码真 React 完整复现 issue。探针：`gen-fixed.mjs`/`markdown-fixed.mjs`/`probe-r1.mjs`/`probe-r1-ta8.mjs`/`test-against-fixed.test.mjs`。
- 两轮评审的必须项均已落地，**评审轮闭环，计划定稿待主人审阅**。
- **章程化复审（recheck）已收口（2026-11-08，两轮）**：R-1 [重要] 已接受并修订——Task 2 Step 1 计数门 `grep -cE "^(✖|not ok)"` 在 spec 报告器下实测计 10（含父 describe 聚合行与 failing tests 头行），改 `^ℹ fail` 读数（2026-11-08），recheck 已复核通过。V1-V7 七项核证全部通过（V3 12 用例现码 8红4绿逐字复现；V4 fix-sim 三阶段 12/12 格 + 既有 26 用例对修码 fail 0）。
- **recheck 批次 3/3 处置（2026-11-08）**：R-2 [阻断] 已接受修订——Task 6 恢复判据由「`git diff` 为空」（Task 7 提交前工作树含未提交改动，恒不可满足；recheck 实测全成功仍 11+/8-）改为 pre/post-mutation.diff 对照 + `RESTORE-VERIFIED`；R-3 [重要] 已接受修订——Task 5 两步 Run 前置 `set -o pipefail`（原形态 `$?` 取管道尾 0、真失败仍报 0，违反本计划退出码卫生约束）；S-1 [建议] 采纳——Task 6 Step 1 Expected 改 `ℹ fail 5`（红名单落 Step 3 台账，grep 输出不展示名单）；S-2 [建议] 采纳——零变化格 badge 行措辞修正（a→span 属已列明变化，非回归）。
- 行号时点：`src/client/markdown.js` @ HEAD eea9447，2026-11-08 现场复核（R1 逐锚 grep 12/12 精确）；定位一律**路径 + 符号锚**优先，行号仅辅助。

## 文件结构与职责

- **Modify**: `src/client/markdown.js` —— 全部源码改动（C1-C8 八处编辑点 + 模块头 `RENDER_REPO` 注释），职责：把 `safeUrl` 求值从 React 渲染期收敛到构建期同步窗口；F2 参数错位修复；安全闸与基址解耦。
- **Test**: `tests/client-markdown.test.mjs` —— 文件头补两行 import（react / react-dom/server）；末尾追加一个自含 describe（夹具 `deferredH` + 收集器 `renderedUrls` + 用例 TA1-TA10/TF1/TF2 共 12 条），职责：以真 React createElement 语义 + 真 SSR 端到端钉死渲染期最终 URL。
- **Create**: 无源码文件。计划文档即本文件（仓库约定路径）；台账（探针/变异日志/fix-sim）在 `.dsh-research/issue52-deadlink-scratch/`，不入库。
- 一起变化的边界：`markdown.js` 与其测试同簇推进；`chrome.jsx`/`settings-tab.jsx`/`detail-modal.jsx`/`installed-tab.jsx` 零触碰（消费面普查见附录 A E5；无基址直调路径行为由 safeUrl 原语义保持）。
- 任务间接口依赖：Task 1 产出的用例 ID（TA1-TA10/TF1/TF2）是 Task 2/3/4 的验收标尺；Task 2-4 均只改 `src/client/markdown.js`，符号互不重叠（Task 2：mdInline + safeUrl；Task 3：mdHtmlInline；Task 4：mdHtmlBlock + 模块头注释）。

## 任务清单

### Task 1: tests/client-markdown.test.mjs 追加 deferred-h + SSR 红色测试套件

- 目标：以真 React 语义（函数组件渲染期才执行）+ 真 SSR 端到端钉死 12 个用例的现状红绿基线——8 个红（死链复现）、4 个绿（守护）。
- 涉及文件：`tests/client-markdown.test.mjs`（文件头 import 两行 + 文件末尾追加 describe）
- 接口契约
  - Consumes: 无（基线：2026-11-08 实测 build ok + 本套件 26/26 绿；R1 独立探针复核现状红绿吻合；TA10 现码 RED 经 `probe-ta10.mjs` 实测）；`react`/`react-dom` devDeps 在位（package.json L91-92；SSR 用法先例 `client-render-smoke.test.mjs`）
  - Produces: describe `#52 渲染期取值修复（deferred h 模仿真 React）`；夹具 `deferredH`、收集器 `renderedUrls`；用例 ID `TA1`-`TA10`/`TF1`/`TF2`（Task 2/3/4 的验收标尺）
- 验证范围：`node --test tests/client-markdown.test.mjs` 恰好 **8 红 4 绿新增**（fail=8: TA1-TA5+TA9+TA10+TF1；pass 含 TA6-TA8/TF2 与全部既有 26 用例）

- [ ] Step 1: 现状检查——基线绿确认
  - Run: `cd /home/ubuntu/workspace/dsh-m && npm run build && node --test tests/client-markdown.test.mjs 2>&1 | tail -8`
  - Expected: `build ok` + `pass 26 / fail 0`
- [ ] Step 2: 追加测试代码

文件头部（紧跟既有 import 之后，匹配该文件无分号风格）补：

```js
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
```

文件末尾追加 describe（自带夹具，不引用兄弟 describe 闭包）：

```js
describe('#52 渲染期取值修复（deferred h 模仿真 React）', () => {
  // 真 React.createElement 语义：函数组件不在 createElement 期执行，渲染期才调用
  const deferredH = (type, props, ...children) => {
    const kids = children.flat(Infinity);
    return typeof type === "function"
      ? { $$comp: type, props: props || {}, children: kids }
      : { type, props, children: kids };
  };
  // 渲染期求值收集器：把 $$comp 一路调用穿并收集最终 a[href]/img[src]。
  // 注意：函数组件的 children 必须并回 props 再调用（React 对函数组件合并 children），
  // 否则 ExtLink 解构不到 children、TA3 徽章内层图不可见（R1-3 实录）。
  function renderedUrls(node) {
    const out = { links: [], imgs: [] };
    const walk = (x) => {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) return void x.forEach(walk);
      if (x.$$comp) return void walk(x.$$comp({ ...x.props, children: x.children }));
      if (typeof x.props?.href === "string") out.links.push(x.props.href);
      if (typeof x.props?.src === "string") out.imgs.push(x.props.src);
      const kids = x.children;
      if (Array.isArray(kids)) kids.forEach(walk);
      else if (kids && typeof kids === "object") walk(kids);
    };
    walk(node);
    return out;
  }
  const dmd = createMarkdown(deferredH);
  const REPO = { repo: 'o/r' };
  const BLOB = (p) => `https://github.com/o/r/blob/HEAD/${p}`;
  const RAW = (p) => `https://raw.githubusercontent.com/o/r/HEAD/${p}`;

  it('TA1 有基址：markdown 相对链接渲染期取到 blob URL', () => {
    const t = dmd.renderMarkdown('[配置](CONFIGURATION.md)', REPO);
    assert.deepEqual(renderedUrls(t).links, [BLOB('CONFIGURATION.md')]);
  });
  it('TA2 有基址：markdown 相对图片渲染期取到 raw URL', () => {
    const t = dmd.renderMarkdown('![b](docs/x.png)', REPO);
    assert.deepEqual(renderedUrls(t).imgs, [RAW('docs/x.png')]);
  });
  it('TA3 徽章图包链：内外两层渲染期都解析（issue 复现主例）', () => {
    const t = dmd.renderMarkdown('[![b](i.png)](l.md)', REPO);
    const r = renderedUrls(t);
    assert.deepEqual(r.links, [BLOB('l.md')]);
    assert.deepEqual(r.imgs, [RAW('i.png')]);
  });
  it('TA4 HTML <a>/<img>：行内 HTML 路径渲染期解析', () => {
    const t = dmd.renderMarkdown('<a href="docs/g.md">x</a>\n\n<img src="docs/g.png">', REPO);
    const r = renderedUrls(t);
    assert.deepEqual(r.links, [BLOB('docs/g.md')]);
    assert.deepEqual(r.imgs, [RAW('docs/g.png')]);
  });
  it('TA5 有基址锚点：渲染期取到仓库页锚（0.9.49 意图生产首次生效）', () => {
    const t = dmd.renderMarkdown('[a](#faq)', REPO);
    assert.deepEqual(renderedUrls(t).links, ['https://github.com/o/r#faq']);
  });
  it('TA6 绝对 URL 不回归（守护）', () => {
    const t = dmd.renderMarkdown('[x](https://a.com)', REPO);
    assert.deepEqual(renderedUrls(t).links, ['https://a.com']);
  });
  it('TA7 无基址相对链接归 #（守护，0.9.47 及以前行为）', () => {
    const t = dmd.renderMarkdown('[a](b.md)');
    assert.deepEqual(renderedUrls(t).links, ['#']);
  });
  it('TA8 带基址安全闸：javascript: 不借仓库分支逃逸（守护，钉 C8）', () => {
    const t = dmd.renderMarkdown('[x](javascript:alert(1))', REPO);
    assert.deepEqual(renderedUrls(t).links, ['#']);
  });
  it('TA9 有基址 root-relative：/path 锚仓库根（随主修复定型）', () => {
    const t = dmd.renderMarkdown('[x](/abs/path)', REPO);
    assert.deepEqual(renderedUrls(t).links, [BLOB('abs/path')]);
  });
  it('TF1 F2：包裹块内块结构递归不再丢基址', () => {
    const t = dmd.renderMarkdown('<div>\n\n# H\n\n[x](docs/g.md)\n\n</div>', REPO);
    assert.deepEqual(renderedUrls(t).links, [BLOB('docs/g.md')]);
  });
  it('TF2 F2：12 层深包裹护栏语义保持（无 URL 泄漏，节点数不膨胀）', () => {
    const t = dmd.renderMarkdown('<div>'.repeat(12) + 'core' + '</div>'.repeat(12));
    const r = renderedUrls(t);
    assert.equal(r.links.length + r.imgs.length, 0);
    assert.ok(t.length <= 5, `节点数应被护栏收敛: ${t.length}`);
  });
  it('TA10 真 React SSR 端到端：renderToString 与 deferred 收集同构（防夹具漂移，R2-6）', () => {
    const rmd = createMarkdown(createElement);
    const html = renderToString(createElement('div', null, rmd.renderMarkdown('[配置](CONFIGURATION.md)', REPO)));
    assert.ok(html.includes(`href="${BLOB('CONFIGURATION.md')}"`), html);
  });
});
```

- [ ] Step 3: 运行并确认恰好的红绿分布
  - Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-markdown.test.mjs 2>&1 | grep -E "^(✖|not ok)|^ℹ (tests|pass|fail)" ; true`
  - Expected: `tests 38 / fail 8`（TA1、TA2、TA3、TA4、TA5、TA9、TA10、TF1）且 `pass 30`（TA6-TA8、TF2 + 既有 26）。**任何其它用例红 = 锚普查遗漏或基线漂移，停下排查，不进 Task 2。**
- [ ] Step 4: 台账留档红名单
  - Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-markdown.test.mjs > /home/ubuntu/workspace/.dsh-research/issue52-deadlink-scratch/t1-red.log 2>&1; echo exit=$?`
  - Expected: `exit=1`（有红），`t1-red.log` 含 8 个失败用例名

### Task 2: markdown.js 行内路径预解析（C1-C4）+ safeUrl 危险 scheme 硬化（C8）

- 目标：`mdInline` 四个 props 构造点就地预解析；同时给 `safeUrl` 补 C8 提前 return——两簇改动共用同一验收（TA1/TA2/TA3/TA5/TA9/TA10 转绿、TA8 保持绿），不可拆分：C4 落地而 C8 缺位时 TA8 必红（R1/R2 fix-sim 双实证）。
- 涉及文件：`src/client/markdown.js`（函数 `mdInline`；函数 `safeUrl`）
- 接口契约
  - Consumes: Task 1 的用例 TA1-TA10/TF1/TF2；`safeUrl`（本模块导出，符号锚）
  - Produces: `safeUrl` 的危险 scheme 硬化分支（Task 3/4 的预解析调用天然受益，无额外符号）
- 验证范围：`node --test tests/client-markdown.test.mjs` → fail 从 8 降到 **2**（只剩 TA4、TF1），其余全绿

- [ ] Step 1: 写当前状态检查（复跑红名单，确认仍是 8 红）
  - Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-markdown.test.mjs 2>&1 | grep -E "^ℹ fail" ; true`
  - Expected: `ℹ fail 8`（recheck R-1 修订：原 `grep -cE "^(✖|not ok)"` 计数门在 spec 报告器下实测计 10——8 个用例明细行之外还含父 describe 聚合行与 failing tests 头行，执行者会假停；弃用 ✖ 计数门，改 `^ℹ fail` 读数，与 Task 1/3/4 判据形态统一）
- [ ] Step 2: 最小实现（五处，符号锚定位）

C1（`mdInline` badge 内层图，时点 L211）——`src: im && im[2]` 改为预解析：

```js
const img = h(MdImg, { src: safeUrl(im && im[2], "img"), alt: im && im[1] });
```

C2（badge 外层链 gate+props，时点 L212-213）——预解析一次，gate 与 props 共用：

```js
const href = lm && lm[1];
const linkHref = safeUrl(href, "link");
nodes.push(href && linkHref !== "#" ? h(ExtLink, { key: k, href: linkHref }, img) : h("span", { key: k }, img));
```

C3（markdown 图，时点 L216）：

```js
nodes.push(h(MdImg, { key: k, src: safeUrl(im && im[2], "img"), alt: im && im[1] }));
```

C4（markdown 链接，时点 L219）：

```js
nodes.push(h(ExtLink, { key: k, href: safeUrl(lm && lm[2], "link") }, mdInline(lm ? lm[1] : tok, k)));
```

C8（`safeUrl` 内、锚点分支之后、仓库相对分支 `if (RENDER_REPO && (kind === "img" || kind === "link"))` 之前插入；时点 L43/L44 之间）：

```js
  // #52：危险 scheme 不得借仓库相对分支逃逸成 blob/raw URL（组件体闸门只覆盖无基址面）
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(t) && !/^(https?:\/\/|mailto:)/i.test(t)) return "#";
```

不改：autolink（时点 L230）与裸 URL（时点 L232）——token 正则保证 `https?://` 前缀，渲染期 `safeUrl` 直通，现状已正确。C8 对既有直测面零波及：无基址时这些输入本就归 `#`（既有 safeUrl describe 全部无 repo）；`git@` 归一（时点 L36-37）与协议相对归一（时点 L35）都在 C8 之前完成，不受影响（R2 实测含卫兵副本既有 suite fail 0）。

- [ ] Step 3: 运行并确认通过
  - Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-markdown.test.mjs 2>&1 | grep -E "^(✖|not ok)|^ℹ (tests|pass|fail)" ; true`
  - Expected: `tests 38 / fail 2`（仅 TA4、TF1）；TA1/TA2/TA3/TA5/TA9/TA10 绿；**TA8 绿（若红 = C8 缺失或错位）**；TA6/TA7/TF2 与既有 26 用例保持绿
- [ ] Step 4: 若出现预期外红 → 立即停下对照附录 A 行为零变化格逐条归因，不猜

### Task 3: markdown.js HTML 子集路径构建期预解析（C5-C6）

- 目标：`mdHtmlInline` 的 `<img>`/`<a>` 两个构造点预解析，TA4 转绿。
- 涉及文件：`src/client/markdown.js`（函数 `mdHtmlInline`）
- 接口契约
  - Consumes: Task 1 用例 TA4；Task 2 同文件已绿基线（fail=2）
  - Produces: 无下游符号（Task 4 消费的是「fail=1」状态）
- 验证范围：`node --test tests/client-markdown.test.mjs` → fail=**1**（仅 TF1）

- [ ] Step 1: 当前状态检查
  - Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-markdown.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)" ; true`
  - Expected: `pass 36 / fail 2`
- [ ] Step 2: 最小实现（两处）

C5（HTML `<img>`，时点 L391）：

```js
cur().push(h(MdImg, { key, src: safeUrl(attrs.src, "img"), alt: attrs.alt, title: attrs.title, style: htmlImgStyle(attrs) }));
```

C6（HTML `<a>` build 闭包，时点 L399；闭包在闭合标签时同步执行，仍在窗口内）：

```js
stack.push({ name, kids: [], build: (kids) => h(ExtLink, { key, href: safeUrl(attrs.href, "link"), title: attrs.title }, kids) });
```

- [ ] Step 3: 运行并确认通过
  - Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-markdown.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)" ; true`
  - Expected: `tests 38 / pass 37 / fail 1`（仅 TF1）；既有 0.9.48 基址用例（`<p>\n<img src="docs/a.svg">` 形态）保持绿

### Task 4: markdown.js F2 递归修复（C7）+ RENDER_REPO 注释更新

- 目标：包裹块递归显式透传 repo + depth 归位；本任务收口 TF1，全套件绿。
- 涉及文件：`src/client/markdown.js`（函数 `mdHtmlBlock` 的 `inlineKids`；模块头 `RENDER_REPO` 注释）
- 接口契约
  - Consumes: Task 1 用例 TF1/TF2；Task 3 后的 fail=1 基线；`RENDER_REPO`（模块级，符号锚）
  - Produces: 全绿套件（Task 5 全量门禁的前置）
- 验证范围：`node --test tests/client-markdown.test.mjs` → **38/38 全绿**

- [ ] Step 1: 当前状态检查
  - Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-markdown.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)" ; true`
  - Expected: `pass 37 / fail 1`（仅 TF1）
- [ ] Step 2: 最小实现

C7（`inlineKids` 递归，时点 L447）：

```js
const inlineKids = () => (isInlineOnlyHtml(inner) ? mdHtmlInline(inner, kb) : renderMarkdown(inner, { repo: RENDER_REPO }, depth + 1));
```

伴随注释（模块头 `RENDER_REPO` 声明行，时点 L19-20）——改为：

```js
// 渲染级仓库基址（#52 起：仅在 renderMarkdown 同步窗口内读取；渲染期组件体只收到已解析值，幂等安全闸与全局无关）
let RENDER_REPO = ""; // "owner/repo"；空 = 无基址（相对 URL 一律归 #，0.9.47 及以前行为）
```

- [ ] Step 3: 运行并确认通过
  - Run: `cd /home/ubuntu/workspace/dsh-m && node --test tests/client-markdown.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)" ; true`
  - Expected: `tests 38 / pass 38 / fail 0`（TF2 的护栏语义保持绿：单行 12 层在 depth 9 降级为单文本节点，deep.length=1——R2 插桩实测）
- [ ] Step 4: 既有「深度护栏」用例（时点 L251-260，describe `0.9.47 内嵌 HTML 子集`）显式确认仍绿——若红，说明 depth 归位改变了它的判定前提，停下归因

### Task 5: 全量门禁

- 目标：全仓库测试与类型检查零回归。
- 涉及文件：无新改动（纯验证）
- 接口契约
  - Consumes: Task 1-4 全部落地；`node_modules` 在位（workspace AGENTS.md 依赖预检）
  - Produces: 门禁通过状态（Task 6/7 的前置）
- 验证范围：`npm test` 与 `npm run typecheck` 退出码均 0

- [ ] Step 1: 依赖预检 + 全量测试
  - Run: `cd /home/ubuntu/workspace/dsh-m && set -o pipefail && test -d node_modules && npm test 2>&1 | tail -10; echo exit=$?`
  - Expected: 尾部 `fail 0` 且 `exit=0`（recheck R-3 修订：原形态无 pipefail，`$?` 取管道尾 tail 的 0、npm test 真失败仍报 exit=0——recheck 以 `node -e "process.exit(3)" | tail; echo $?` 实测掩蔽；pipefail 后 `$?` 即 npm test 退出码，符合本计划全局约束「退出码卫生」）
- [ ] Step 2: 类型检查
  - Run: `cd /home/ubuntu/workspace/dsh-m && set -o pipefail && npm run typecheck 2>&1 | tail -5; echo exit=$?`
  - Expected: 无 TS 错误输出且 `exit=0`（同 R-3 修订：pipefail 保证 `$?` 为 typecheck 退出码）

### Task 6: C4 关键接线锚单点变异验证

- 目标：证明 TA1 是 C4 的有效防线（评审单「关键源码接线锚」要求）。
- 涉及文件：`src/client/markdown.js`（临时变异 + 恢复）；台账目录（`pre-mutation.diff`/`post-mutation.diff` + 台账补记）
- 接口契约
  - Consumes: Task 2 的 C4 精确形态字符串 `href: safeUrl(lm && lm[2], "link")`；Task 1 的 TA1；Task 4 后未提交的计划态工作树
  - Produces: 台账 `pre-mutation.diff` / `post-mutation.diff` + 补记（变异红名单 + 恢复绿证据）
- 验证范围：变异后 `ℹ fail 5`（红名单含 TA1）；恢复后全绿且 pre/post 两 diff 逐字节一致（恢复失败 → post 含变异残迹 ≠ pre，判据非永真）

- [ ] Step 1: 变异前先存计划态 diff，再做单点变异（C4 预解析退回原始形态）
  - Run: `cd /home/ubuntu/workspace/dsh-m && git diff src/client/markdown.js > /home/ubuntu/workspace/.dsh-research/issue52-deadlink-scratch/pre-mutation.diff && sed -i 's|href: safeUrl(lm \&\& lm\[2\], "link")|href: lm \&\& lm[2]|' src/client/markdown.js && node --test tests/client-markdown.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)" ; true`
  - Expected: `ℹ fail 5`（红名单 TA1/TA5/TA9/TA10/TF1，recheck mut 副本实测；sed 形态唯一命中 C4，不触 C1-C3/C5-C6；grep 输出不展示名单，名单以 Step 3 台账留档为准——recheck S-1 采纳）
- [ ] Step 2: 恢复并留证（pre/post 对照）
  - Run: `cd /home/ubuntu/workspace/dsh-m && sed -i 's|href: lm \&\& lm\[2\]|href: safeUrl(lm \&\& lm[2], "link")|' src/client/markdown.js && node --test tests/client-markdown.test.mjs 2>&1 | grep -E "^ℹ (pass|fail)"; git diff src/client/markdown.js > /home/ubuntu/workspace/.dsh-research/issue52-deadlink-scratch/post-mutation.diff; diff /home/ubuntu/workspace/.dsh-research/issue52-deadlink-scratch/pre-mutation.diff /home/ubuntu/workspace/.dsh-research/issue52-deadlink-scratch/post-mutation.diff && echo RESTORE-VERIFIED`
  - Expected: `pass 38 / fail 0` 且输出 `RESTORE-VERIFIED`（recheck R-2 修订：Task 6 在 Task 7 提交之前，工作树含 Task 2-4 未提交改动，「git diff 为空」恒不可满足——recheck 实测变异/恢复全成功时 diff 仍为 11 insertions(+), 8 deletions(-)；改 pre/post 对照后恢复失败时 post 含变异残迹 ≠ pre，非永真成立）
- [ ] Step 3: 台账补记变异结论（台账文件末尾追加：变异红名单、恢复后 pass/fail 数、RESTORE-VERIFIED 结果）

### Task 7: checkpoint commit（本地，不 push）

- 目标：实施改动 + 计划文档单提交入库，diff 逐文件可归因。
- 涉及文件：`src/client/markdown.js`、`tests/client-markdown.test.mjs`、`docs/plans/2026-11-08-issue52-readme-relative-link-resolution-implementation-plan.md`
- 接口契约
  - Consumes: Task 1-6 全部通过；干净树检查（`git status` 仅上述三文件为改动态）
  - Produces: 本地 commit（Task 8 发版提交的前置）
- 验证范围：`git status` 干净 + `git log -1 --stat` 显示且仅显示三个文件

- [ ] Step 1: 干净树与改动面检查
  - Run: `cd /home/ubuntu/workspace/dsh-m && git status --short`
  - Expected: 恰好三文件（M src/client/markdown.js、M tests/client-markdown.test.mjs、?? docs/plans/<本文件>）。出现其它条目 = 计划外改动，停下归因。
- [ ] Step 2: 提交
  - Run: `cd /home/ubuntu/workspace/dsh-m && git add src/client/markdown.js tests/client-markdown.test.mjs docs/plans/2026-11-08-issue52-readme-relative-link-resolution-implementation-plan.md && git commit -m "fix(markdown): README 相对链接/图片构建期预解析修死链（issue #52）——safeUrl 求值从 React 渲染期收敛进同步窗口，组件体保留幂等安全闸，危险 scheme 与基址解耦（C8）；F2：包裹块递归 {repo} 显式透传 + depth 归位（0.9.47 护栏首次真实生效）；deferred-h + SSR 夹具 12 用例钉渲染期 URL（8 红转绿 + 4 守护）"`
  - Expected: commit 成功，`git log -1 --stat` 恰三文件

### Task 8: 🔴 批准门——发版 0.12.10 + 回帖 issue #52（不可逆公开动作，先送审）

- 目标：版本收口与 issue 回复；**每一步执行前都停下等主人当轮明确批准**（`dsh-m/AGENTS.md` 发版纪律；#42 实录：批准开工不默认涵盖发版与回帖）。
- 涉及文件：`package.json`/`package-lock.json`/`src/tools.ts`（版本三处，`scripts/release.mjs` 自动同步并纳入发版提交）、`docs/CHANGELOG.md`（双语顶条）
- 接口契约
  - Consumes: Task 7 的本地 commit；`npm run release` 脚本头部前置条件清单；`npm run check-release` 门禁
  - Produces: npm 已发布的 0.12.10 + GitHub tag + issue #52 回帖（关闭与否由主人定夺）
- 验证范围：`npm run check-release` 通过；发布后按 `01_docs/agent-ops/README.md`「发版与 npm 轮询」确认上架

- [ ] Step 1: 回帖草案先行送审（**不直接发**）：草拟 issue #52 回复（根因确认 + 方案 A 选择理由 + C8 硬化与 F2 补充发现 + 致谢），交主人审
- [ ] Step 2: 获批后版本 bump + CHANGELOG 双语顶条（顶条注明 #52 死链修复 + C8 安全闸解耦 + F2）
- [ ] Step 3: 获批后 `npm run release`（push/tag/publish 一体）；门禁 `npm run check-release` 先行
- [ ] Step 4: 发布确认 + issue 回帖（按获批草案），关闭 issue 与否待主人指示

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行，不无声跳步、合并步或改变任务目标；每任务完成即跑该任务的验证。
- 红绿判读反常（夹具假绿 / 预期外红）按 CODING-STANDARDS「测试注入形态与红确认」处理：先怀疑锚普查遗漏，后怀疑测试本身。
- 遇阻、重复失败或计划与仓库现实不符，立即停下说明，不猜。
- 本仓库在 `main` 直接落提交（惯例）；push 仅发生在 Task 8 获批的 release 内。
- 台账目录 `.dsh-research/issue52-deadlink-scratch/` 不入库（.dsh-research 已 gitignore）。

## 最终验证

- `cd /home/ubuntu/workspace/dsh-m && npm test` → 尾部 `fail 0`，退出码 0（含 pretest 构建 + import guard + 全 suites）
- `npm run typecheck` → 退出码 0
- `node --test tests/client-markdown.test.mjs` → 38/38（26 既有 + 12 新增）
- `git status --short` → 实施提交后仅剩 Task 8 的发版前改动（或干净树）
- 变异验证台账在案：`.dsh-research/issue52-deadlink-scratch/pre-mutation.diff` / `post-mutation.diff` 一致 + RESTORE-VERIFIED 补记

## 附录 A：证据台账（2026-11-08 实测，探针 `probe1.mjs`/`probe-ta10.mjs` + R1/R2 评审探针）

### E1 夹具假绿机理

`tests/client-markdown.test.mjs` 头部假 h **立即解析函数组件** → `ExtLink`/`MdImg` 体内 `safeUrl` 在构建期（窗口内）就被执行 → 测试全绿；真 React 渲染期才执行 → 生产死链。此即 bug 长期存活的根因，也是本计划引入 `deferredH` 夹具的原因。R2 交叉验证：现码真 React renderToString 完整复现 issue（hrefs 全 `#`），与 deferred 探针同构。

### E2 探针 P1：issue 复现坐实（deferred 假 h）

`repo='ranxianglei/billion-context'`：`[配置](CONFIGURATION.md)` → `#`；`![图](docs/x.png)` → `#`；`[#faq](#faq)` → `#faq`（应为仓库页锚）；绝对 URL → 原值 ✓。eager 假 h（现行夹具）同输入全解析成功——假绿对照。

### E3 探针 P2：F2 坐实（构建期即死，与渲染时机无关）

`<div>\n\n# H\n\n[x](docs/guide.md)\n\n</div>` + repo → **`#`**；对照 `<p>[x](docs/guide.md)</p>`（行内路径不递归）→ 正常解析。根因：`renderMarkdown(inner, depth + 1)` 的 `depth + 1` 落进 `opts` 形参位 → `normalizeRepoInput(1 && (1).repo)` → `""`。R1 独立复现与 E3 逐字吻合。

### E4 safeUrl 求值不变量（P3 + R2 23 输入 × 4 状态对矩阵实测）

无条件幂等**不成立**：`#faq`/`#sec`（link）与 `/abs`（link+img）在「第一跑无基址 → 第二跑有基址」翻转态非恒等（4 例）。但生产可达状态对（`''→''`、`'o/r'→''`、`'o/r'→'o/r'`）全部恒等——方案 A 的安全前提是**不变量「渲染期组件体执行时 RENDER_REPO 恒为空」**，由三件事保证（R2 执行序枚举全过）：createElement 不调函数组件、`finally` 先于返回复位、JS 单线程串行（常规 / 并发中断重放 / 双 ReadmeBlock 交错 / renderToString 同树双 Viewer 实测零串扰）。C8 硬化后危险 scheme 构建期即归 `#`，不进二跑路径。

### E5 消费面普查（符号锚；R1/R2 双全扫复核一致）

- 生产 `renderMarkdown` 唯一调用点：`chrome.jsx` `ReadmeBlock`（时点 L621；`state.repo` ← `packument.ts` `extractGithubRepo`）。
- `ReadmeBlock` 的 `repo` prop 来源：`detail-modal.jsx`（时点 L254 `repo: it.github`）与 `installed-tab.jsx`（时点 L229 `repo: vm.githubRepo`）——均经 `normalizeRepoInput` 归一（R2 普查补充）。
- `createMarkdown` 工厂消费：`chrome.jsx`（时点 L37；`ExtLink` 另见 L145/L530 等渲染路径，href 均绝对 URL）、`settings-tab.jsx`（时点 L18、L277-281，三处全绝对 URL 字面量，亲读核实）。
- `main.jsx` 零 markdown 引用；`op-outcome.js`/`styles.js` 仅注释性提及，非消费；`scripts/` 零命中。
- tests/ 锚普查：改动面符号仅 `tests/client-markdown.test.mjs`（全文已读）；`tests/client-img-chain.test.mjs:182` 的 `h(ExtLink, { href: shots[index] })` 源锚打在 chrome.jsx Lightbox 路径（纯正则源码切片、无行为依赖），与 diff 无交集。

### 行为零变化格（验收按格对账；R1-2 补 root-relative 行，R2-3 收窄降级面）

| 面 | 缺省态（无 repo） | 有 repo |
|---|---|---|
| 裸相对链接/图片/HTML `<a>`/`<img>`（`a.md`、`docs/x.png`、`../up/x`） | 归 `#`（**不变**） | `#` → 正确 GitHub blob/raw URL（**本役修复的行为变化，唯一目的**） |
| root-relative `/path` | 透传 `/path`（**不变**，非 `#`——既有语义，既有用例 L25 可证） | `/path` → 仓库根 blob/raw URL（**随主修复定型**，GitHub 对 `/path` 即仓库根相对语义） |
| 带 repo 的 `#锚` 链接 | — | `#faq` → `https://github.com/…#faq`（修复 0.9.49 意图，生产首次真正生效） |
| 危险 scheme（`javascript:`/`data:`/`vbscript:`/`file:`/`ftp:`） | 归 `#`（**不变**） | 渲染期最终值恒 `#`（**不变**；实现路径从「渲染期闸门」改为「C8 构建期拒绝 + 组件体闸门」双保险；R2 实测现码 7 例危险 scheme 全 `#`、修码+卫兵后仍全 `#`） |
| 绝对 URL / mailto / 协议相对 / git@ 归一 | 不变 | 不变（C8 在这些归一之后，零影响） |
| badge gate 分流（`!== "#"` 才包 `ExtLink`） | 相对 → span 包裹（不变） | 危险 scheme → 由「a（ExtLink）包裹、渲染期归 #」变为「span 包裹」（C8 使 gate 判 `#`）；最终 href 同为 `#`；包裹结构 a→span 为**已列明变化，非回归**（recheck S-2 措辞修正：原「DOM 语义不变」与同句 a→span 冲突） |
| >8 层包裹嵌套 | 逐层剥壳渲染（护栏从不生效） | depth>8 降级纯文本——**实测降级面仅病理形态可达**（R2-3：单行同标签长链 ≥10 层；多行重复/交替/含 header/footer/nav 的真实 README 形态因 htmlBlockEnd 截断提前断链、不触发）；既有 L255-259 用例亲跑全绿（deep.length=1） |
| DOM 节点数/类名/样式/几何 | 零变化 | 零变化（只改 `href`/`src` 字符串值） |
| i18n 文案 | 零新增键 | — |

### D5 明示不修的相邻项（不夹带）

1. `ExtLink` 丢弃 `title` props（HTML `<a title>` 不生效）：现状行为，不在 issue 范围。
2. `RENDER_REPO` 模块全局保留（改注释说明读取面收敛），不做方案 B 全链参数化。
3. 非 http/mailto 的**良性**自定义 scheme（如 `tel:`/`vscode:`）带基址时从 blob-wrap 变为归 `#`（C8 副作用，已入零变化格；无基址语义不变）。若未来需要放行面扩展，另立 issue。

### 用例红绿预期表（Task 1 Step 3 判据；R1 10/10 复核 + R2 同构验证 + TA8/TA9/TA10 形态修正）

| 用例 | 现状 | Task 2 后 | Task 3 后 | Task 4 后 |
|---|---|---|---|---|
| TA1 markdown 链接 | 红 | 绿 | 绿 | 绿 |
| TA2 markdown 图片 | 红 | 绿 | 绿 | 绿 |
| TA3 badge 图包链 | 红 | 绿 | 绿 | 绿 |
| TA4 HTML a/img | 红 | 红 | 绿 | 绿 |
| TA5 带基址锚点 | 红 | 绿 | 绿 | 绿 |
| TA6 绝对 URL（守护） | 绿 | 绿 | 绿 | 绿 |
| TA7 无基址归 #（守护） | 绿 | 绿 | 绿 | 绿 |
| TA8 带基址安全闸（守护，钉 C8） | 绿 | 绿 | 绿 | 绿 |
| TA9 root-relative 定型 | 红 | 绿 | 绿 | 绿 |
| TA10 真 React SSR 端到端 | 红 | 绿 | 绿 | 绿 |
| TF1 F2 包裹块 | 红 | 红 | 红 | 绿 |
| TF2 12 层护栏语义 | 绿 | 绿 | 绿 | 绿 |

## 审阅 Checkpoint

- 本计划经 writing-plans inline 自检（PHASE 5 六项）+ R1 规格评审（6 条，全部处置）+ R2 对抗评审（7 项，全部处置），两轮评审必须项均已落地，评审轮闭环。
- **计划已定稿，请主人审阅；审阅通过前，不进入 Task 1 实施。**
