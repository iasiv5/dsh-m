# 卡片预览图与主题画廊（0.9.34）实施计划

## 目标

- 把社区目录既有的 `screenshots` 数据上卡片：主题类目画廊视图（16:10 封面 + README 抽图兜底 + 灯箱）、其余条目文字卡 ≤3 张横条缩略条。
- 卡面「安装」按钮 + 轻确认弹窗（详情 Modal 保留，能力披露仍在详情层）。
- 精选清单 schema 增补可选 `screenshots` 字段（数据由主人后续手工补，本计划不改 registry.json 数据）。
- 图片线路走「jsDelivr 改写优先 → raw 直连」多线路回退，零新增第三方依赖。
- 文档留痕：ADR-0013（显式修订 Q44「截图仅详情层」与「直连原图」条款）+ DESIGN 修订 + GLOSSARY 术语。
- 交付终点 = 本地 commit + 热部署 desktop profile 供主人实测；**不 push、不打 tag、不发布 npm**。

## 架构快照

- 数据已就绪：上游 awesome-dsh-plugin 目录的 `screenshots` 字段经 `community-adapter.ts` 透传（`CommunityEntry.screenshots`），`toMarketItem` 为 `{ ...entry }` 展开（`src/core/market.ts` L652 附近）——新增精选字段后自动进 MarketItem，**core/market.ts 零改动**。
- 纯逻辑下沉：新增 `src/client/screenshots.js`（不依赖 DOM/React，Node tests 直接 import，同 `market-state.js` 模式），承载图床白名单判定、jsDelivr 线路改写、README 抽图/打分、会话缓存。React 组件与接线留在 `main.jsx`（既有约定：组件在 main.jsx、纯逻辑在独立模块）。
- 画廊视图 = 社区区浏览态 `category === 'theme'` 的分类过滤形态（分类 chip 语义不变，仅渲染卡型切换 + 页大小 16）；搜索态恒文字卡（搜索提交已强制 `category: null`）。收藏区逐条按 `snapshot.category === 'theme'` 选卡型，与文字卡混排（`align-items: start` 防拉伸）。
- 轻确认安装复用既有安全网：确认后才调 `doInstall`，peer 预检拦截 → 既有 `CompatDialog`，装后守卫/操作记录/进度线全部不动。
- README 兜底瘦身版：仅画廊卡、IntersectionObserver 临视口 200px 触发、每条目会话级缓存、纯语义打分（无几何探针）、256KB 正文上限、8s 超时、失败静默降级占位。
- 线路回退：`raw.githubusercontent.com/<o>/<r>/HEAD/<p>` → 首选 `cdn.jsdelivr.net/gh/<o>/<r>@HEAD/<p>`，img onError 逐候选回退；README 文本抓取同链路。灯箱大图直连原图。

## 全局约束（自 DESIGN.md 逐字继承）

- 严格 schema 白名单：未知字段拒绝整份清单；registry 上限 2 MiB / 1,000 条（§2.1/§2.2）。
- schema 演进纪律：**先发 dsh-m 新版、再推 registry @main**；旧客户端拒收回落缓存属例行过渡（§2.7）。
- 所有拉取仅 HTTPS + 响应大小上限 + 超时（§3 安全基线 1）。
- 图片三层懒加载（IntersectionObserver + `loading=lazy` + `fetchPriority=low`）；「缩略图不引第三方图像处理代理」修订为「多线路回退仍不经第三方图像处理服务」（§2.6 技术默认件，本次 ADR-0013 修订）。
- React 从 module loader require，零额外运行时依赖；不新增 npm 依赖。
- UI 中文优先 + 完整英文对照，跟随 DSH Web 深浅色主题变量。
- npm 发布线（publish.yml / assert-pack）一字不改。
- 能力披露/红线仍仅详情层默认收起（Q44 该半边不放宽）。

## 输入工件

- 设计共识：本会话 grill 第 1–4 轮结论（Q1–Q7，主人 2026-10-05 逐条确认；Q4=多线路回退、Q6=瘦身版兜底、Q7=画廊 16/页）。
- 参考实现（只读）：`D:\_dsh-workspace\.dsh-research\dsh-market-clone\`——`MarketSection.tsx`（themePluginCard ≈L5043、ThemeCover ≈L723、useNearViewport ≈L607）、`market-data.ts`（safeScreenshots ≈L1071、extractReadmeImageCandidates ≈L1171、rankThemeScreenshots ≈L1242）。**只借鉴展示形态与启发式思路，不搬安装链路；克隆实现不含 jsDelivr 改写（多线路回退为本计划新决策，非克隆先例）**。
- 现状调查结论：dsh-m 侧 `safeScreenshots`（main.jsx L667-683）、`Shot`（L971-999）、`Lightbox`（L1002-1020）、`DetailModal` 截图门禁（L1038）、`registry.ts` ENTRY_KEYS（L221）/httpsUrlError（L229-241）。

## 文件结构与职责

- Create: `src/client/screenshots.js` —— 纯逻辑：`isSafeShotUrl` / `shotSrcCandidates` / `extractReadmeImageUrls` / `rankReadmeShots` / `createReadmeShotCache` / `fetchReadmeShots` / 常量。
- Modify: `src/client/main.jsx` —— i18n 字典（ZH L31-139 / EN L140-247）、CSS 模板（L274 起）、`safeScreenshots` 改调 `isSafeShotUrl`、`Shot` 支持候选回退、`Card` 增 `shotStrip`/`footer` 槽、新组件 `CardShots` / `GalleryCard` / `InstallConfirmModal`、`MarketTab` 接线（画廊派生/limit/确认状态机）、`FavoriteZone` 主题画廊卡、smoke 导出追加（L33）。
- Modify: `src/core/registry.ts` —— `ENTRY_KEYS`（L221）、`RegistryEntry` 接口（L40-63）、条目校验循环（L344-352 附近增 screenshots 段）。
- Modify: `src/client/market-state.js` —— `THEME_CATEGORY` / `GALLERY_PAGE_SIZE` / `pageLimitForCategory`。
- Modify: `scripts/validate-registry.mjs` —— 条目循环（L125-156）增 screenshots 逐 URL 可达检查。
- Test: `tests/screenshots.test.mjs`（新）、`tests/registry.test.mjs`（增 case）、`tests/client-market-state.test.mjs`（增 case）、`tests/client-render-smoke.test.mjs`（增 SSR case）。
- Create: `docs/adr/0013-card-previews-and-theme-gallery.md`。
- Modify: `docs/DESIGN.md`（§2.2 / §2.3 / §2.5 Q44 行 / §2.6 / §2.7）、`GLOSSARY.md`。
- Modify: `package.json`（0.9.33 → 0.9.34）、`CHANGELOG.md`。
- 不改：`src/core/market.ts`、`src/core/community-adapter.ts`、`registry.json` 数据、发布 workflow。

## 任务间接口契约（总表）

- `screenshots.js` Produces（T4，被 T6/T7/T8/T9 消费）：
  - `isSafeShotUrl(url: string): boolean`（HTTPS + host ∈ {github.com, *.githubusercontent.com}，≤2048 字符）
  - `shotSrcCandidates(url: string): string[]`（raw 仓库路径图 → `[jsDelivr改写, 原URL]`；其余白名单图 → `[原URL]`；非白名单 → `[]`）
  - `extractReadmeImageUrls(markdown: string): string[]`（内联图 + 参考式图 + `<img src>`；仅 https）
  - `rankReadmeShots(urls: string[], limit: number): string[]`（排除 badge/logo/avatar/icon/spinner/`.svg`，偏好 `screenshot|preview|shot|docs|banner` 路径，保序稳定）
  - `createReadmeShotCache(): { get(id: string): string[] | undefined, set(id: string, shots: string[]): void, clear(): void }`
  - `fetchReadmeShots(entry: { id, github }, deps?: { fetchImpl?, cache? }): Promise<string[]>`（jsDelivr→raw 链、256KB 上限 `README_MAX_BYTES`、8s 超时 `README_FETCH_TIMEOUT_MS`、失败恒 `[]`；`deps.cache` 命中即短路返回，miss 时 fetch 后写回）
  - 常量：`CARD_SHOT_LIMIT = 3`、`GALLERY_SHOT_LIMIT = 6`
- `market-state.js` Produces（T5，被 T8/T9 消费）：`THEME_CATEGORY = 'theme'`、`GALLERY_PAGE_SIZE = 16`、`pageLimitForCategory(zone: string, category: string | null): number`（community+theme→16；community 其他→32；primary→96）。
- `registry.ts` Produces（T2，被 T3/客户端消费）：`RegistryEntry.screenshots?: string[]`（校验后保留原值）。
- main.jsx Produces（T6-T9）：组件 `CardShots({ shots, onOpen })`、`GalleryCard({ it, fav, onToggleFav, onOpenDetail, onQuickInstall, busy, cache })`（`onQuickInstall: null` 时隐藏安装钮）、`InstallConfirmModal({ it, busy, onClose, onConfirm })`；`Card` 新槽位 `shotStrip`、`footer`（React 节点，由调用方组装）。
- i18n 新键（T6/T8 定义，T8/T9 消费）：`confirm.install.title`、`confirm.trust`、`gallery.finding`、`gallery.none`、`gallery.count`。

约定：所有命令在 `D:\_dsh-workspace\dsh-m` 下执行；PowerShell 先设
`$env:PATH = "C:\Users\ies255050\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin;$env:PATH"`。
全量 `node --test` 基线：fail 集合 ⊆ {cli-bin-symlink ×2、doctor-api ×1、doctor ×13、dsh-version ×1}（EPERM symlink 环境性，计数 15/明细 17 随并发浮动）；验证口径 = 失败不超出该清单且无新增。

---

### Task 1: 裁决落盘 ADR-0013 + DESIGN 修订 + GLOSSARY 术语

- 目标：把「预览图上卡」的裁决与被修订的既有决策（Q44 半边、「直连原图」条款）留痕，后续代码任务有据可依。
- 涉及文件：Create `docs/adr/0013-card-previews-and-theme-gallery.md`；Modify `docs/DESIGN.md`、`GLOSSARY.md`。
- 接口契约：Consumes 本计划「架构快照/全局约束」；Produces：ADR 编号 `ADR-0013`、DESIGN 修订段（后续任务注释引用「ADR-0013」）。
- 验证范围：三份文档交叉引用一致（DESIGN 引 ADR-0013 无悬空；ADR 编号不与 0001-0012 冲突）。

- [ ] Step 1: 改动前检查——确认 docs/adr 现有最大编号 0012、GLOSSARY.md 现有格式（先读全文再动手）。
- Run: `Get-ChildItem docs\adr -Name; Get-Content GLOSSARY.md -TotalCount 40`
- Expected: 列出 0001-0012 十二个文件；GLOSSARY 可读且有既有条目格式。
- [ ] Step 2: 写 ADR-0013（状态：已接受；Context = Q44 卡片瘦身裁决 + 主人 2026-10-05 需求 + dsh-market 参考形态；Decision = 六条：①社区 screenshots 上卡（画廊+缩略条）②精选 schema 增可选字段③卡面轻确认、详情 Modal 保留、能力披露仍仅详情层④jsDelivr 多线路回退不经第三方图像代理⑤README 瘦身兜底⑥画廊 16/页（画廊态隐藏筛选页大小组）；Consequences = Q44「截图仅详情层」就此修订、直连原图条款修订、流量与抽图质量权衡、宿主 `/dshm/img` 镜像路由记 v1.1 观察项；附证：jsDelivr `@HEAD` 改写为本计划新决策（克隆实现无此先例），可用性以 2026-10-05 实测 `cdn.jsdelivr.net/gh/iasiv5/dsh-m@HEAD/package.json` → HTTP 200 留证）。
- [ ] Step 3: DESIGN.md 修订七处——§2.2 L33 后加 screenshots 规则行、L51 jsonc 示例加字段；§2.3 L62 步骤 4 加「screenshots 首图可达（允许为空）」；「截图仅详情层」两处同修：§2.5 L79 段尾句（「…卡片不打标（Q44，防警告疲劳）；截图仅详情层加载…」）与 Q44 决策表行（L267）各加「（0.9.34 起截图按 ADR-0013 上卡，能力披露仍仅详情层）」；§2.6 L94 卡片瘦身句同步修订 + §2.6 L98 技术默认件改「多线路回退」表述；「v1.1 字段族」两处同修：§2.2 L21 括注（「v1.1 增补可选 verified、alsoCategories、decoupled、audience」）与 §2.7 L103 段补 `screenshots`。
- [ ] Step 4: GLOSSARY.md 按既有格式追加术语：预览图（screenshots）、缩略条、画廊视图、轻确认安装、线路改写。
- [ ] Step 5: 复核交叉引用。
- Run: `Select-String -Path docs\DESIGN.md,GLOSSARY.md,docs\adr\0013-card-previews-and-theme-gallery.md -Pattern "ADR-0013"`
- Expected: DESIGN ≥2 处、GLOSSARY ≥1 处引用；无文件缺失报错。
- [ ] Step 6: checkpoint commit（`docs(adr): 0013 card previews + theme gallery — design/glossary sync`，含 ADR-0013 + DESIGN.md + GLOSSARY.md 三文件）。

### Task 2: registry schema 增补可选 `screenshots` 字段（TDD）

- 目标：`RegistryEntry.screenshots?: string[]` 进严格白名单并完成校验。
- 涉及文件：Modify `src/core/registry.ts`；Test `tests/registry.test.mjs`。
- 接口契约：Consumes `httpsUrlError`（registry.ts L229）；Produces `RegistryEntry.screenshots?: string[]`（T3 消费；客户端经 market.ts spread 自动透传）。
- 校验规则（与客户端 `safeScreenshots` 同语义收敛到 schema 层）：可选；present 必须为数组；可空数组；每项 trim 非空、`httpsUrlError` 通过（含 ≤2048）、host 为 `github.com` 或 `*.githubusercontent.com`、数组 ≤8、URL 去重；违规逐项报 `plugins[i].screenshots[j]: …`。

- [ ] Step 1: 写失败测试（追加 describe 到 tests/registry.test.mjs，跟随既有 validateRegistry 用例风格）：

```js
describe('screenshots 字段（0.9.34 ADR-0013）', () => {
  const base = { id: 'o1--demo', name: 'demo', description: 'd', category: 'essentials', tags: ['t'], source: 'npm', npm: 'demo-pkg' }
  it('合法数组通过并原样回传', () => {
    const r = validateRegistry({ version: 1, plugins: [{ ...base, screenshots: ['https://raw.githubusercontent.com/o1/demo/HEAD/docs/shot.png'] }] })
    assert.equal(r.ok, true)
    assert.deepEqual(r.registry.plugins[0].screenshots, ['https://raw.githubusercontent.com/o1/demo/HEAD/docs/shot.png'])
  })
  it('空数组与缺省合法', () => {
    for (const s of [undefined, []]) {
      const r = validateRegistry({ version: 1, plugins: [{ ...base, ...(s ? { screenshots: s } : {}) }] })
      assert.equal(r.ok, true)
    }
  })
  it('非数组 / 非法项 / 超 8 张 / 非 GitHub 图床 / 重复 → 拒绝', () => {
    const shot = 'https://raw.githubusercontent.com/o1/demo/HEAD/s.png'
    const cases = [
      { screenshots: 'x' }, { screenshots: [42] }, { screenshots: ['http://raw.githubusercontent.com/o1/demo/s.png'] },
      { screenshots: ['https://cdn.example.com/s.png'] }, { screenshots: Array(9).fill(shot) }, { screenshots: [shot, shot] },
    ]
    for (const p of cases) assert.equal(validateRegistry({ version: 1, plugins: [{ ...base, ...p }] }).ok, false)
  })
})
```

- Run: `node --test tests/registry.test.mjs`
- Expected: 新 describe 内用例失败（`screenshots: 未知字段` → ok:false 使「合法数组通过」红）。
- [ ] Step 2: 运行确认失败。
- [ ] Step 3: 最小实现——`ENTRY_KEYS` 加 `'screenshots'`；`RegistryEntry` 加 `screenshots?: string[]`；条目循环内（homepage/icon 段之后）按「接口契约」规则校验并保留 `entryScreenshots`，随既有 entry 组装返回。
- [ ] Step 4: 验证通过。
- Run: `node --test tests/registry.test.mjs`
- Expected: 全部通过（既有用例零回归）。
- [ ] Step 5: checkpoint commit（`feat(registry): optional screenshots field (ADR-0013)`）。

### Task 3: validate-registry.mjs 增 screenshots 可达检查

- 目标：CI 对 screenshots 每条 URL 执行与 icon 同款可达性检查（允许为空）。
- 涉及文件：Modify `scripts/validate-registry.mjs`（条目循环 L147-151 处）。
- 接口契约：Consumes Task 2 的 `entry.screenshots`；Produces 无（脚本行为）。

- [ ] Step 1: 改动前检查——现 registry.json 无任何 screenshots 数据。
- Run: `node scripts/validate-registry.mjs`
- Expected: 全绿（零新增请求）。
- [ ] Step 2: 实现——icon/homepage 循环旁追加：

```js
for (const [i, url] of (entry.screenshots || []).entries()) {
  await reachable(url)
  console.log(`✓ ${where} screenshots[${i}] 可达`)
}
```

- [ ] Step 3: 验证——临时给 registry.json 首条目加 `"screenshots": ["https://raw.githubusercontent.com/iasiv5/dsh-m/HEAD/docs/images/marketplace.webp"]`（仓库内真实存在的图）：跑应 ✓；再改成不存在的路径：跑应 ✗ exit 1 且报 `screenshots[0]`；随后 `git checkout -- registry.json` 还原。
- Run: `node scripts/validate-registry.mjs`（上述三个状态各跑一次）
- Expected: 还原后全绿 exit 0；404 临时态 exit 1 且报 `screenshots[0]`。
- [ ] Step 4: checkpoint commit（`chore(ci): reachability check for registry screenshots`）。

### Task 4: screenshots.js 纯模块 + 单测（TDD）

- 目标：线路改写、白名单、README 抽取/打分、缓存、抓取链全部下沉纯逻辑。
- 涉及文件：Create `src/client/screenshots.js`；Create `tests/screenshots.test.mjs`。
- 接口契约：Produces 见「任务间接口契约」总表（T6-T9 消费）；无 React/DOM 依赖，`module.exports` 导出（CJS，同 market-state.js 打包方式）。

- [ ] Step 1: 写失败测试（要点逐条成 case）：
  - `isSafeShotUrl`：`https://raw.githubusercontent.com/o/r/HEAD/a.png` true；`http://…` / `https://cdn.example.com/a.png` / 2049 字符 / 非字符串 false。
  - `shotSrcCandidates`：
    - `'https://raw.githubusercontent.com/o1/r1/HEAD/docs/s.png'` → `['https://cdn.jsdelivr.net/gh/o1/r1@HEAD/docs/s.png', 原URL]`；
    - `'https://user-images.githubusercontent.com/1/2.png'`（非仓库路径，无 owner/repo/HEAD 结构）→ `[原URL]`；
    - `'https://github.com/o1/r1/raw/HEAD/s.png'` → `[jsDelivr 改写, 原URL]`（github.com/owner/repo/raw/ 路径归一）；
    - 非白名单 → `[]`。
  - `extractReadmeImageUrls`：内联 `![](https://raw.githubusercontent.com/o/r/HEAD/a.png)`、参考式 `![x][i]` + `[i]: https://…/b.png`、`<img src="https://…/c.png">` 全部抽出；`http://` 与 data URI 不收。
  - `rankReadmeShots`：含 `badge/logo/avatar/icon/spinner.svg` 的排后/剔除（`.svg` 直接剔除），`docs/`、`preview`、`screenshot` 路径加分，`limit` 截断，相对次序稳定。
  - `fetchReadmeShots`：注入 fetchImpl——首候选（jsDelivr）200 返回 README 文本 → 抽图打分 ≤6；首候选 404 回退 raw 成功；content-length > 262144 → `[]`；**无 content-length 头（chunked）但正文超限 → 读满 262144 即截断停止**（评审 R2 观测采纳：把双保险行为锁进回归门）；两候选均网络错误 → `[]`；`entry.github` 缺失 → `[]`（不发起 fetch）。
  - 缓存短路：`deps.cache.get(id)` 命中 → 直接返回且 fetchImpl 零调用；miss → fetch 成功后 `cache.set(id, shots)`。
- Run: `node --test tests/screenshots.test.mjs`
- Expected: 模块不存在 → 用例全红。
- [ ] Step 2: 运行确认失败。
- [ ] Step 3: 实现 `src/client/screenshots.js`（命名 `export`，ESM 同 `market-state.js`——esbuild 打包与 Node test 双通道一致；jsDelivr 改写规则：host 为 `raw.githubusercontent.com` 且路径含 `/<owner>/<repo>/(HEAD|refs/heads/main|<branch前缀>)/` → `cdn.jsdelivr.net/gh/<owner>/<repo>@HEAD/<剩余路径>`；`github.com/<o>/<r>/raw/<ref>/<p>` 同归一；fetch 链手动实现超时（AbortController）与响应大小双保险：content-length 预检（快速拒绝）+ **正文边读边限**（reader 累计截断至 `README_MAX_BYTES`，chunked 无长度头同样受限）；缓存工厂闭包 Map）。
- [ ] Step 4: 验证通过。
- Run: `node --test tests/screenshots.test.mjs`
- Expected: 全绿。
- [ ] Step 5: checkpoint commit（`feat(client): screenshot pure module — route rewrite, readme fallback (ADR-0013)`）。

### Task 5: market-state 页大小随画廊分类切换（TDD）

- 目标：主题分类浏览态页大小 16，其余维持现值；纯函数可测。
- 涉及文件：Modify `src/client/market-state.js`；Test `tests/client-market-state.test.mjs`。
- 接口契约：Produces `THEME_CATEGORY` / `GALLERY_PAGE_SIZE` / `pageLimitForCategory(zone, category)`（T8/T9 消费）；Consumes `normalizeMarketQuery` 既有 clamp（1..96，16 合法无需改）。

- [ ] Step 1: 写失败测试：

```js
import { pageLimitForCategory, THEME_CATEGORY, GALLERY_PAGE_SIZE } from '../src/client/market-state.js'
describe('画廊页大小（ADR-0013）', () => {
  it('community+theme → 16', () => assert.equal(pageLimitForCategory('community', THEME_CATEGORY), GALLERY_PAGE_SIZE))
  it('community 其他/全部 → 32；primary 恒 96；未知 zone → 32', () => {
    assert.equal(pageLimitForCategory('community', null), 32)
    assert.equal(pageLimitForCategory('community', 'ui'), 32)
    assert.equal(pageLimitForCategory('primary', 'essentials'), 96)
    assert.equal(pageLimitForCategory('favorites', THEME_CATEGORY), 32)
  })
})
```

- Run: `node --test tests/client-market-state.test.mjs`
- Expected: 导入不存在 → 红。
- [ ] Step 2: 运行确认失败。
- [ ] Step 3: 实现（`export const THEME_CATEGORY = 'theme'`、`GALLERY_PAGE_SIZE = 16`、纯函数按契约返回）。
- [ ] Step 4: 验证通过。
- Run: `node --test tests/client-market-state.test.mjs`
- Expected: 全绿。
- [ ] Step 5: checkpoint commit（`feat(client): gallery page size per category (ADR-0013)`）。

### Task 6: 卡面轻确认安装（InstallConfirmModal + Card footer 槽）

- 目标：文字卡 footer「安装」按钮 → 轻确认弹窗 → 确认后走既有 `doInstall` 全链路（peer 拦截 CompatDialog——即 MarketTab 内联 `compatConfirm` 状态块 + `.dshm-compat-overlay` 渲染，main.jsx L1204/L1350，非独立组件——/ 守卫 / 操作记录不变）；卡片本体点击仍开 DetailModal。
- 涉及文件：Modify `src/client/main.jsx`（i18n ZH/EN 字典、CSS 模板、Card L2204-2231、MarketTab L1196-1674、smoke 导出 L33）；Test `tests/client-render-smoke.test.mjs`。
- 接口契约：Consumes Task 4 无（本任务不用图）；Produces `InstallConfirmModal({ it, busy, onClose, onConfirm })`（T8 画廊卡复用）、`Card` 新槽位 `footer`、i18n 键 `confirm.install.title`（`{name}` 插值）/`confirm.trust`、CSS 类 `dshm-quickinstall` / `dsvm-confirmbox`。

- [ ] Step 1: 写失败 SSR 测试（smoke 文件追加；测试导出行同步补 `__InstallConfirmModal`）：

```js
it('InstallConfirmModal：名称/信任提示/取消确认按钮 + 弹层深度类', () => {
  const it0 = { id: 'o1--demo', name: 'demo', description: 'd', category: 'theme', community: true, source: 'npm', npm: 'demo-pkg' }
  const html = renderToString(h(components.__InstallConfirmModal, { it: it0, busy: false, onClose: () => {}, onConfirm: () => {} }))
  assert.ok(html.includes('dsvm-confirmbox'), '轻确认容器在')
  assert.ok(html.includes('demo') && (html.includes('确认安装') || html.includes('Install')), '标题含名称')
  assert.ok(html.includes('来源可信') || html.includes('verify the source'), '社区信任提示在')
  assert.ok(html.includes('dshm-btn primary'), '确认按钮在')
})
```

- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: `__InstallConfirmModal` 导出 undefined → 红。
- [ ] Step 2: 运行确认失败。
- [ ] Step 3: 实现——①i18n 两字典加 `confirm.install.title` / `confirm.trust`；②CSS 加 `.dsvm-confirmbox{width:min(460px,100%)}`（复用 `.dsvm-modal/.dsvm-modalbox` 主体）与 `.dshm-quickinstall`；③新组件 `InstallConfirmModal`（`useModalDepth(true)`、`backdropCloseHandlers(onClose)`、头部 Icon+名称+deprecated warn、描述 clamp 2 行、`it.community===true` 显示 `confirm.trust` 小字、footer 取消/安装（busy→Spin disabled））；④`Card` 增 `footer` 槽（渲染在 links 之后，点击 stopPropagation）；⑤`MarketTab`：`const [confirmItem, setConfirmItem] = useState(null)` + `useModalDepth(confirmItem != null)`；`cardOf` 的 footer = 未安装时 `h('button', { className: 'dshm-btn sm dshm-quickinstall', onClick: e => { e.stopPropagation(); setConfirmItem(it) } }, lookup('action.install'))`（`it.installed` 时不渲染）；确认回调节 `doInstall(it)` 后 `setConfirmItem(null)`；`busy: activeInstallTarget === confirmItem?.id`；弹窗挂载在 DetailModal 旁（L1662 附近）；⑥smoke 导出行补 `__InstallConfirmModal`。
- [ ] Step 4: 验证通过。
- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 全绿（13 既有 + 1 新增 = 14）。
- [ ] Step 5: checkpoint commit（`feat(client): quick-install confirm from card footer (ADR-0013)`）。

### Task 7: 文字卡横条缩略条（CardShots，有图才显示）

- 目标：社区/精选/收藏文字卡在有安全 screenshots 时显示 ≤3 张横向缩略，点击进既有 Lightbox；无图卡片外观零变化。
- 涉及文件：Modify `src/client/main.jsx`；Test `tests/client-render-smoke.test.mjs`。
- 接口契约：Consumes Task 4 `isSafeShotUrl`/`shotSrcCandidates`/`CARD_SHOT_LIMIT`；Produces `CardShots({ shots, onOpen })`（T9 收藏文字卡复用）、`Card` 新槽位 `shotStrip`、`Shot` 组件新增 `srcs` 数组候选回退。

- [ ] Step 1: 写失败 SSR 测试（导出行补 `__CardShots`）：

```js
it('CardShots：≤3 张、懒加载空壳、候选改写', () => {
  const shots = ['https://raw.githubusercontent.com/o1/r1/HEAD/docs/a.png', 'https://raw.githubusercontent.com/o1/r1/HEAD/docs/b.png']
  const html = renderToString(h(components.__CardShots, { shots, onOpen: () => {} }))
  assert.ok(html.includes('dshm-shotstrip'), '缩略条容器在')
  assert.ok(!html.includes('<img'), 'SSR 不带 img（IO 挂 src 后才有）')
  assert.ok(html.includes('dsvm-shotbox'), '复用 shotbox 槽位')
})
```

- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: `__CardShots` 未定义 → 红。
- [ ] Step 2: 运行确认失败。
- [ ] Step 3: 实现——①`Shot` 改收 `srcs`（默认 `[src]`），内部 `idx` state，onError 递进候选、耗尽停住；DetailModal 既有调用传 `[src]` 不变；②`CardShots`：`shots.slice(0, CARD_SHOT_LIMIT)` 渲染 `.dshm-shotstrip`，每格复用 `Shot`（`srcs: shotSrcCandidates(url)`），onClick → `onOpen(shots, i)`；③CSS `.dshm-shotstrip` 覆盖段（见架构快照）；④`cardOf` 接线：`const shots = safeScreenshots(it)`，非空时 `shotStrip: h(CardShots, { shots, onOpen: (arr, i) => setStripLb({ shots: arr, i }) })`；`MarketTab` 增 `const [stripLb, setStripLb] = useState(null)` 渲染既有 `Lightbox`（`useModalDepth(stripLb != null)` + Esc 关闭，跟随 DetailModal 同款键盘模式）；精选/收藏文字卡同规则。
- [ ] Step 4: 验证通过。
- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 全绿。
- [ ] Step 5: checkpoint commit（`feat(client): card shot strip for entries with screenshots (ADR-0013)`）。

### Task 8: 社区区主题画廊视图（GalleryCard + README 兜底 + limit 16）

- 目标：社区区浏览态选「主题与外观」chip → 网格切换画廊卡；封面 16:10、张数角标、灯箱、无图 README 兜底、无图无兜底占位。
- 涉及文件：Modify `src/client/main.jsx`（CSS、`GalleryCard`、MarketTab 渲染分支与 onPick limit、smoke 导出）；Test `tests/client-render-smoke.test.mjs`（market-state 部分已在 Task 5 覆盖）。
- 接口契约：Consumes Task 4 全部导出、Task 5 `pageLimitForCategory`/`THEME_CATEGORY`、Task 6 `InstallConfirmModal`、既有 `Lightbox`；Produces `GalleryCard({ it, labels, fav, onToggleFav, onOpenDetail, onQuickInstall, busy, cache })`（T9 复用）、CSS 类 `dshm-gallery` / `dshm-gcard` / `dshm-gcover` / `dshm-gcover-empty` / `dshm-gcount` / `dshm-gbody` / `dshm-gfoot`、i18n 键 `gallery.finding` / `gallery.none` / `gallery.count`。

- [ ] Step 1: 写失败 SSR 测试（导出行补 `__GalleryCard`）：

```js
it('GalleryCard：curated 封面走 jsDelivr 改写 + 张数角标 + footer 安装钮', () => {
  const it0 = { id: 'o1--skin', name: 'skin', description: 'd', category: 'theme', community: true, source: 'github', github: 'o1/skin',
    screenshots: ['https://raw.githubusercontent.com/o1/skin/HEAD/docs/a.png', 'https://raw.githubusercontent.com/o1/skin/HEAD/docs/b.png'] }
  const html = renderToString(h(components.__GalleryCard, { it: it0, fav: null, onToggleFav: () => {}, onOpenDetail: () => {}, onQuickInstall: () => {}, busy: false, cache: { get: () => undefined, set: () => {}, clear: () => {} } }))
  assert.ok(html.includes('dshm-gcard'), '画廊卡容器在')
  assert.ok(html.includes('cdn.jsdelivr.net/gh/o1/skin@HEAD/docs/a.png'), '封面首选 jsDelivr 改写（封面 img 直接渲染，原生 lazy）')
  assert.ok(html.includes('dshm-gcount'), '张数角标在')
  assert.ok(html.includes('张预览') || html.includes('preview'), '角标文案在')
  assert.ok(html.includes('dshm-btn'), 'footer 操作在')
})
it('GalleryCard：无图无兜底前渲染占位（SSR 不发起 fetch）', () => {
  const it0 = { id: 'o1--bare', name: 'bare', description: 'd', category: 'theme', community: true, source: 'github', github: 'o1/bare' }
  const html = renderToString(h(components.__GalleryCard, { it: it0, fav: null, onToggleFav: () => {}, onOpenDetail: () => {}, onQuickInstall: () => {}, busy: false, cache: { get: () => undefined, set: () => {}, clear: () => {} } }))
  assert.ok(html.includes('dshm-gcover-empty'), '占位在')
  assert.ok(!html.includes('<img'), 'SSR 零 img')
})
```

- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: `__GalleryCard` 未定义 → 红。
- [ ] Step 2: 运行确认失败。
- [ ] Step 3: 实现——①i18n 三键（ZH：`正在查找预览…` / `暂无预览` / `{n} 张预览`；EN 对应）；②CSS 画廊族（`.dshm-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:10px;align-items:start}` + 封面 `aspect-ratio:16/10`、`object-fit:contain`、角标半透明深底、body/foot flex，跟随既有主题变量）；③`GalleryCard`：shots 派生 `safeScreenshots(it)`；cover = 首图直接渲染 `<img>`（`loading="lazy"` + `referrerPolicy="no-referrer"`，src 用 `shotSrcCandidates(shots[0])`，onError 逐候选回退）——封面是主视觉，不做 IO 门控；无图时占位区 IO（rootMargin 200px）临视口调 `fetchReadmeShots(it, { cache })`（`deps.cache` 短路/写回，结果写组件 state，加载中 `gallery.finding`+Spin，空结果 `gallery.none`，兜底图并入灯箱列表）；cover 点击开内部 Lightbox（`useModalDepth` + Esc/←→ 键盘）；角标 `shots.length > 1` 时显示；body = 名称 + 徽章（社区/弃用/已装）+ byline + 描述 clamp 3；footer = 收藏星标（复用 `dsvm-favbtn`）+「详情」次按钮（`onOpenDetail`）+「安装」主按钮（`onQuickInstall` 为 null 时不渲染；installed 时显 manage.hint 文案）；④`MarketTab`：`const galleryMode = zone === 'community' && !searching && query.category === THEME_CATEGORY`；ZoneChips `onPick` 改 `updateQuery({ category: id, offset: 0, limit: pageLimitForCategory(zone, id) })`；SearchBox onCommit 与「全部」路径补 `limit: pageLimitForCategory(zone, null)`；卡片渲染分支 `galleryMode ? h('div', { className: 'dshm-gallery' }, ...items.map(it => h(GalleryCard, { …, cache: readmeShotCache }))) : 既有 .dshm-cards`；模块级 `const readmeShotCache = createReadmeShotCache()`；筛选弹层「每页条数」组仅 `!galleryMode` 渲染（评审澄清 Q2 定案：画廊态固定 16/页，32/64/96 不适用且不可见，离开画廊自动恢复既有选项）。
- [ ] Step 4: 验证通过。
- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 全绿。
- [ ] Step 5: checkpoint commit（`feat(client): theme category gallery view with readme fallback (ADR-0013)`）。

### Task 9: 收藏区主题条目画廊卡

- 目标：收藏区 `snapshot.category === 'theme'` 的条目用 GalleryCard 渲染，其余维持文字卡（含 Task 7 缩略条规则），混排。
- 涉及文件：Modify `src/client/main.jsx`（FavoriteZone L2249-2340）；Test `tests/client-render-smoke.test.mjs`。
- 接口契约：Consumes `GalleryCard`（Task 8）、`CardShots`（Task 7）、`THEME_CATEGORY`（Task 5）；Produces 无。

- [ ] Step 1: 写失败 SSR 测试（扩展既有 FavoriteZone 用例，并补收藏快照断链回归门）：

```js
it('FavoriteZone：主题收藏渲染画廊卡，非主题维持文字卡', () => {
  const favs = { list: [
    { id: 'o1--skin', savedAt: 1, snapshot: { id: 'o1--skin', name: 'skin', description: 'd', category: 'theme', source: 'github', github: 'o1/skin', screenshots: ['https://raw.githubusercontent.com/o1/skin/HEAD/a.png'] } },
    { id: 'o1--tool', savedAt: 2, snapshot: { id: 'o1--tool', name: 'tool', description: 'd', category: 'ui', source: 'npm', npm: 'tool' } },
  ], toggle: () => {}, removeIds: () => {} }
  const html = renderToString(h(components.__FavoriteZone, { favorites: favs, onOpen: () => {} }))
  assert.ok(html.includes('dshm-gcard'), '主题条目走画廊卡')
  assert.ok(html.includes('dshm-card'), '非主题维持文字卡')
})
it('snapshotOf 保留 screenshots（收藏快照断链回归门）', () => {
  const snap = components.__snapshotOf({ id: 'o1--x', name: 'x', description: 'd', category: 'theme', source: 'github', github: 'o1/x', screenshots: ['https://raw.githubusercontent.com/o1/x/HEAD/a.png'] })
  assert.deepEqual(snap.screenshots, ['https://raw.githubusercontent.com/o1/x/HEAD/a.png'])
})
```

- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 红（画廊卡分支缺失 + `__snapshotOf` 未导出/丢 screenshots——现状两卡都是 dshm-card）。
- [ ] Step 2: 运行确认失败。
- [ ] Step 3: 实现——FavoriteZone 列表 map 内按 `s.category === THEME_CATEGORY` 分支 GalleryCard（`fav`/`onToggleFav` 接既有收藏 store；`onOpenDetail` 接既有 `onOpen(fav)` 解析链；`onQuickInstall` 传 null——收藏区无完整条目上下文，不提供卡面安装；`cache: readmeShotCache` 与市场画廊共用模块级缓存——收藏画廊同属画廊，README 兜底按 R2 适用，评审澄清 Q1 定案）；非主题收藏文字卡接 `shotStrip: h(CardShots, { shots: safeScreenshots(s), onOpen })`，FavoriteZone 内部增 `[stripLb, setStripLb]` state + `Lightbox` 渲染与 Esc 关闭（同 Task 7 模式）；`snapshotOf` 白名单循环数组（main.jsx L2243-2245）补 `"screenshots"`——旧收藏快照缺该字段自然降级 README 兜底，向后兼容；smoke 导出行补 `__snapshotOf`。
- [ ] Step 4: 验证通过。
- Run: `node --test tests/client-render-smoke.test.mjs`
- Expected: 全绿。
- [ ] Step 5: checkpoint commit（`feat(client): gallery cards for favorited themes (ADR-0013)`）。

### Task 10: 全量验证 + 0.9.34 升版 + CHANGELOG + 本地 commit

- 目标：收口验证、版本与变更记录落盘，形成可发布但未发布的本地状态。
- 涉及文件：Modify `package.json`（version → 0.9.34）、`CHANGELOG.md`（0.9.34 条目：预览图上卡三形态/轻确认/精选 screenshots 字段/多线路回退/ADR-0013）。
- 接口契约：Consumes 全部前序任务；Produces 0.9.34 本地提交（发布动作不在本计划）。

- [ ] Step 1: typecheck + 全量测试。
- Run: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`; `node --test`
- Expected: typecheck 0 错误；全量 fail 集合不超出环境性基线清单（见「约定」）且总数不新增。
- [ ] Step 2: registry 校验全绿。
- Run: `node scripts/validate-registry.mjs`
- Expected: exit 0 无新警告。
- [ ] Step 3: 构建。
- Run: `node scripts/build.mjs`
- Expected: `build ok: lib/host.js + lib/client.js`；`Select-String -Path lib\client.js -Pattern "dshm-gallery"` 命中。
- [ ] Step 4: CHANGELOG 单独 commit，随后 bump commit。
- Run: `git add CHANGELOG.md && git commit -m "docs(changelog): 0.9.34"`（docs/ 与 GLOSSARY.md 已随 Task 1 Step 6 提交）；随后改 `package.json` version → 0.9.34，`git add -A && git commit -m "chore(release): 0.9.34"`
- Expected: 两个 commit 落在 main；`git status --short` 干净；**不 push、不打 tag**。

### Task 11: 热部署 desktop profile 供主人实测（交付 Gate）

- 目标：0.9.34 本地构建原位覆盖运行中 profile（know-how 019 同款，同版本号无 lock 脱同步），交主人实测。
- 涉及文件：无仓库改动；目标 `$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-m\`。
- 接口契约：Consumes Task 10 的 `lib/`；Produces 运行中新版客户端。

- [ ] Step 1: 备份 `lib\*` + `package.json` → `D:\_dsh-workspace\.dsh-m-hotdeploy-backup-20261005\dsh-m@0.9.34-<stamp>\`（node_modules 之外；`<stamp>` = `Get-Date -Format yyyyMMdd-HHmmss`）。
- [ ] Step 2: 覆盖 `lib\*` + `package.json` → `$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-m\`。
- Run: `Copy-Item "D:\_dsh-workspace\dsh-m\lib\*" "<profile>\lib\" -Force` + `Copy-Item "D:\_dsh-workspace\dsh-m\package.json" "<profile>\" -Force`（`<profile>` = `$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-m`）
- Expected: 两条 Copy-Item 无报错。
- [ ] Step 3: 校验。
- Run: `Get-FileHash`（仓库与 profile 的 `lib\client.js` 各一次，比对哈希）；`Select-String -Path "<profile>\lib\client.js" -Pattern 'dshm-gallery','dshm-quickinstall','dshm-shotstrip'`
- Expected: 哈希一致；三锚点各命中 ≥1。
- [ ] Step 4: 交主人实测（关开市场面板即可，rev 机制 HMR；必要时刷新窗口）。实测清单：①主题与外观 chip → 画廊（16/页、封面、张数角标、灯箱）；②无图主题卡兜底「正在查找预览…→ 图/暂无预览」；③文字卡缩略条（有图条目）与灯箱；④卡面「安装」→ 轻确认 → 安装成功；⑤收藏主题条目画廊卡；⑥普通窗口 2 列文字卡零回归。任何一条不符 → 回滚备份并向主人报告，不进入发布。

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项/矛盾/命名不一致先修计划再动手。
- 按任务顺序执行（T1→T11），不无声跳步、合并步或改变任务目标；每任务完成即跑该任务验证。
- 分支：沿用主人已确认的 main 本地直连提交惯例（前例 8c4fb70）；checkpoint commit 按各任务 Step 5。
- 遇阻塞、重复失败或计划与仓库现实不符（锚点漂移、测试基线变化），立即停下说明，不猜。
- main.jsx 为多任务顺序编辑热点：严格串行执行 T6→T7→T8→T9，不并行改动。
- 发布（push/tag/npm publish）不在本计划内；Task 10 完成后停在「本地未发布」状态等主人指令。

## 最终验证

- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` → 0 错误。
- `node --test tests/screenshots.test.mjs tests/registry.test.mjs tests/client-market-state.test.mjs tests/client-render-smoke.test.mjs` → 全绿。
- `node --test`（全量）→ fail 集合 ⊆ 已知 EPERM symlink 环境性基线且无新增失败。
- `node scripts/validate-registry.mjs` → exit 0。
- `node scripts/build.mjs` → build ok；产物含 `dshm-gallery` / `dshm-quickinstall` / `dshm-shotstrip` 锚点。
- 热部署后哈希一致 + 主人实测清单（Task 11 Step 4）全过。

## 审阅 Checkpoint

实施计划已写好并保存到 `docs/plans/2026-10-05-theme-gallery-previews-implementation-plan.md`。请先确认这份计划；如果没问题，下一步可以按计划由普通编码 agent 或人工继续执行。
