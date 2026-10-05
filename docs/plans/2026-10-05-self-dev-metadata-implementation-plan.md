# 自研插件元数据模型 v1.1（audience/decoupled）实施计划

## 目标

- dsh-m registry schema 增补两个可选字段 `decoupled?: true` 与 `audience?: 'public' | 'internal'`，三端（GUI/agent 工具/CLI）照常返回与展示、只标注不过滤。
- registry.json 八个自研条目落地终态：4 个 coupled 条目（dsh-m / dsh-skins / dsh-skip-browser-auth / dsh-copilot-auth）保留 verified 原样；4 个 decoupled 条目（dsh-quota-watch / dsh-surf / dsh-obmc-web / dsh-onetree-log）打 `decoupled: true`、删除 verified 数组、兼容句换「版本无关」句式；其中 3 个外部条目另打 `audience: 'internal'`。
- 文档收尾：DESIGN.md §2.2/§2.7、registry-copy-guide 第四句式与收录决策树、CHANGELOG、know-how 008 及其索引行。
- 发布顺序：先发 dsh-m 新版（0.9.33），再推 registry.json @main（「例行过渡」：旧客户端拒收新 registry → 回落缓存 → 升级即愈）。

## 架构快照

- `RegistryEntry`（src/core/registry.ts）是条目唯一事实源；`MarketItem extends Omit<RegistryEntry, 'category'>`（src/core/market.ts:77），新字段加入 RegistryEntry 后市场条目自动透传，无需改 market.ts。
- 校验沿用 `validateRegistry` 严格风格：未知字段整份拒收；组合矛盾报 error（先例：`alsoCategories` 含主 category → error）。`decoupled: true` 与 `verified` 同条目共存 = error（语义互斥，GLOSSARY「解耦条目」）。
- `audience === 'public'` 为缺省，**不产生键**（惯例：缺失不产生键，同 alsoCategories 空数组）；`decoupled` 缺省即常规跟版条目，同样只声明 true。
- 标注语义（共识 Q8-B）：推荐纪律走 `dshm_search` 工具描述约束（软性），机械保证不在本期范围；三端搜索输出对 internal 条目加「作者自用」标，GUI 卡片另加「版本无关」徽章。
- 已知边界：CLI 帮助文本 `--category market|tools|ui|search|other`（src/cli.ts:176）是 0.9.16 前旧分类残留，与本计划无关，**不动**。
- 范围裁决（共识靶面 = 推荐发现链路）：`dshm_list`/CLI list 已装视图与 GUI 已装页**不做** internal 标注——推荐纪律的载体是搜索发现链路（agent dshm_search、市场面板卡片、CLI search）；已装页是管理面，主人自己的插件无需自我提示。GUI 收藏页卡片同裁决不打标（其徽章区现状本就不渲染 verified 徽章，先例一致）。

## 全局约束（逐字继承自 grilling 共识）

- 字段形态：`decoupled?: true`（只声明 true，缺省=常规耦合）；`audience?: 'public' | 'internal'`（缺省 public，值集预留 'team' 扩位但本期不接受）。
- 单值枚举 `hostCoupling` 与旗帜数组 `flags` 已裁决不采用。
- 解耦判定 = 实操口径：DSH 升级后大概率无需跟着发适配新版。
- 文案硬预算：description ≤60 全角当量（全角=1，ASCII=0.5）；「版本无关，详见仓库。」为标准形，60 当量放不下时用紧凑形「版本无关。」（两级形态均合法，写入 copy-guide）。
- internal 标注文案统一为「作者自用」；GUI 徽章「版本无关」title 为「DSH 升级无需跟随适配」。
- 旧 dsh-m 客户端拒收新 registry 属预期「例行过渡」（0.9.17 alsoCategories 先例），不为其做兼容 shim。
- npm 发版遵守 know-how 018：OIDC staged 假绿窗口 17–55 分钟，publish 绿 ≠ 已上架，三键轮询、窗口内不重推 tag。
- 无额外平台约束：全部验证在 Windows PowerShell + Node 内置 test runner 下进行。

## 输入工件

- 设计共识：本对话 2026-10-05 grilling 定稿（三轮，用户逐条确认）；术语已入 `dsh-m/GLOSSARY.md`（解耦条目 / 自用条目 / 实测版本清单交叉引用）。
- 参照纪律：`01_docs/dsh-intall-know-how/008`（verified 填值与升级核对）、`018`（发版 staged）、`022`（verified 污染门禁）。

## 文件结构与职责

- Modify: `src/core/registry.ts` — `RegistryEntry` 接口、`ENTRY_KEYS`、`validateRegistry` 增两字段校验与互斥 error、产出对象条件展开（约 L40-58 / L216 / L350-397 / L412 区段）。
- Test: `tests/registry.test.mjs` — 仿照「verified 字段（0.4.0 Task 19）」describe（L798）新增 describe。
- Modify: `src/tools.ts` — `dshm_search` description（L139-140）、items 投影（L220-237）、`renderSearch`（L607-626）。
- Test: `tests/tools-search.test.mjs` — 沿用现文件 deps 注入模式。
- Modify: `src/cli.ts` — search 输出行（L284）。
- Test: `tests/cli-search.test.mjs` — 新建；`runCli` deps 注入断言 `[作者自用]` 标。
- Modify: `src/client/main.jsx` — zh/en 字典（L34 / L142）、卡片徽章（L1086 / L1530）、详情 kv（L1118）。
- Modify: `scripts/validate-registry.mjs` — 文案软警告段（L57 之后）追加 decoupled 句式 warn。
- Modify: `registry.json` — 八条目数据终态（Task 7 表格）。
- Modify: `docs/DESIGN.md` — §2.2 schema 示例（L35-53）与字段清单（L21）、新增 §2.7。
- Modify: `docs/registry-copy-guide.md` — §4 句式表、新增收录决策树节。
- Modify: `CHANGELOG.md` — 0.9.33 条目。
- Modify: `package.json` — version 0.9.33。
- Modify: `01_docs/dsh-intall-know-how/008-dsh-m-registry-copy-refresh.md` 及 `01_docs/dsh-intall-know-how/AGENTS.md` 索引表 008 行。

## 任务清单

### Task 1: registry.ts schema 校验（decoupled/audience 两字段）

- 目标：`validateRegistry` 接受并校验两个新字段；`decoupled` 与 `verified` 同存报 error。
- 涉及文件：`src/core/registry.ts`、`tests/registry.test.mjs`
- 接口契约
  - Consumes: 现有 `RegistryEntry`/`ENTRY_KEYS`/`validateRegistry` 结构；`alsoCategories` 校验段（L371-397）作 error 风格先例。
  - Produces: `RegistryEntry.audience?: 'public' | 'internal'`、`RegistryEntry.decoupled?: true`；校验规则（下 Step 3 全文）；产出对象条件展开。Task 2/3/4/7 直接消费这两个键。
- 验证范围：`node --test tests/registry.test.mjs` 全绿；全量 `npm test` 无回归。

- [ ] Step 1: 在 `tests/registry.test.mjs` 追加 describe（放在「verifiedPollution」describe 之后）：

```js
// 自带 base fixture（不依赖其他 describe 的作用域；字段为最小合法条目）
const base = { id: 'test-plugin', name: 'Test Plugin', description: '测试条目', category: 'self-dev', tags: ['测试'], source: 'npm', npm: 'test-plugin' }

describe('audience/decoupled 字段（自研元数据 v1.1，2026-10-05）', () => {
  it('decoupled: true 合法且透传', () => {
    const r = validateRegistry({ version: 1, plugins: [{ ...base, decoupled: true }] })
    assert.equal(r.ok, true)
    assert.equal(r.registry.plugins[0].decoupled, true)
  })
  it('decoupled 非 true 值（false / "true"）拒绝', () => {
    for (const decoupled of [false, 'true', 1]) {
      const r = validateRegistry({ version: 1, plugins: [{ ...base, decoupled }] })
      assert.equal(r.ok, false, JSON.stringify(decoupled))
      assert.ok(r.errors.some((e) => e.includes('decoupled')))
    }
  })
  it('audience internal/public 合法；缺省不产生键', () => {
    const r1 = validateRegistry({ version: 1, plugins: [{ ...base, audience: 'internal' }] })
    assert.equal(r1.ok, true)
    assert.equal(r1.registry.plugins[0].audience, 'internal')
    const r2 = validateRegistry({ version: 1, plugins: [{ ...base, audience: 'public' }] })
    assert.equal(r2.ok, true)
    assert.equal(r2.registry.plugins[0].audience, undefined)
    const r3 = validateRegistry({ version: 1, plugins: [{ ...base }] })
    assert.equal(r3.registry.plugins[0].audience, undefined)
    assert.equal(r3.registry.plugins[0].decoupled, undefined)
  })
  it('audience 非法值（team 未开放 / 大写 / 其他字符串）拒绝', () => {
    for (const audience of ['team', 'Public', 'self']) {
      const r = validateRegistry({ version: 1, plugins: [{ ...base, audience }] })
      assert.equal(r.ok, false, JSON.stringify(audience))
      assert.ok(r.errors.some((e) => e.includes('audience')))
    }
  })
  it('decoupled 与 verified 同存 → error（语义互斥）', () => {
    const r = validateRegistry({ version: 1, plugins: [{ ...base, decoupled: true, verified: ['0.2.0-rc.2'] }] })
    assert.equal(r.ok, false)
    assert.ok(r.errors.some((e) => e.includes('decoupled') && e.includes('verified')))
  })
})
```

- Run: `node --test tests/registry.test.mjs`
- Expected: 新 describe 内 5 例全红（字段未知被拒或断言失败），既有用例仍绿。
- [ ] Step 2: 运行并确认失败（命令同上，观察新用例失败输出）。
- [ ] Step 3: 最小实现，四处改动：
  1. `RegistryEntry` 接口（L53 `verified` 之后）追加：

```ts
  /** 解耦条目（GLOSSARY）：实操口径判定——DSH 升级后大概率无需跟着发适配新版。
   *  只声明 true；与 verified 互斥（validateRegistry 报 error）。 */
  decoupled?: true
  /** 受众标记：internal = 作者自用（GLOSSARY「自用条目」）；缺省 public 不产生键。 */
  audience?: 'public' | 'internal'
```

  2. `ENTRY_KEYS`（L216）追加 `'decoupled', 'audience'`。
  3. `validateRegistry` 内、`alsoCategories` 校验段之后追加：

```ts
    // decoupled（自研元数据 v1.1）：只声明 true；与 verified 互斥（GLOSSARY「解耦条目」）
    let entryDecoupled: true | undefined
    if (e.decoupled !== undefined) {
      if (e.decoupled !== true) errors.push(`${where}.decoupled: 只允许 true 或缺省`)
      else entryDecoupled = true
    }
    // audience：'public' 为缺省不产生键；'team' 值集预留但本期不接受
    let entryAudience: 'internal' | undefined
    if (e.audience !== undefined) {
      if (e.audience === 'internal') entryAudience = 'internal'
      else if (e.audience !== 'public') errors.push(`${where}.audience: 只允许 public/internal`)
    }
    if (entryDecoupled === true && verified !== undefined) {
      errors.push(`${where}.decoupled 与 verified 互斥：解耦条目不携带实测版本数组（GLOSSARY「解耦条目」）`)
    }
```

  4. 产出对象组装（L412 `...(verified !== undefined ? { verified } : {})` 附近）追加：

```ts
      ...(entryDecoupled === true ? { decoupled: true as true } : {}),
      ...(entryAudience !== undefined ? { audience: entryAudience } : {}),
```

- [ ] Step 4: 运行并确认通过（tests 从 `../lib/` 构建产物导入，**必须先 build 再测**）
- Run: `npm run build && node --test tests/registry.test.mjs`，随后 `npm test`
- Expected: registry.test.mjs 全绿；全量测试除 Windows 平台既有 symlink 基线失败集合外零回归。
- [ ] Step 5: checkpoint commit：`git add src/core/registry.ts tests/registry.test.mjs && git commit -m "feat(registry): audience/decoupled fields with mutual-exclusion validation"`

### Task 2: tools.ts 搜索标注 + 工具描述改写

- 目标：`dshm_search` 输出投影携带两字段；`renderSearch` 对 internal 条目加「[作者自用]」标；工具描述写明推荐纪律。
- 涉及文件：`src/tools.ts`、`tests/tools-search.test.mjs`
- 接口契约
  - Consumes: Task 1 的 `RegistryEntry.audience/decoupled`（经 `MarketItem` 自动透传到 `result.items`）。
  - Produces: items 投影键 `audience: 'internal'`（仅 internal 时存在）、`decoupled: true`（仅解耦时存在）；`renderSearch` 行内 `[作者自用]` 标。Task 3 CLI 同语义。
- 验证范围：`node --test tests/tools-search.test.mjs`。

- [ ] Step 1: 在 `tests/tools-search.test.mjs` 按现文件 deps 注入模式追加两例：
  1. mock 条目 `audience: 'internal'` 时：输出 JSON `items[0].audience === 'internal'`，且 `renderSearch` 文本该行含 `[作者自用]`；
  2. mock 条目 `decoupled: true` 且 audience 缺省时：`items[0].audience === undefined`、`items[0].decoupled === true`、该行不含 `[作者自用]`。
  （现文件已测 items 投影与 render 文本，模仿相邻用例的构造与断言写法即可。）
- Run: `node --test tests/tools-search.test.mjs`
- Expected: 新增两例失败（投影无 audience 键、render 无标记）。
- [ ] Step 2: 运行确认失败。
- [ ] Step 3: 三处最小实现：
  1. `dshm_search` description（L140）末尾追加一句：`Cards may carry audience="internal" (作者自用, author's own; do not proactively recommend to general users unless the user names one or asks about internal rollout) and decoupled=true (版本无关, survives DSH upgrades without per-release adaptation).`
  2. items 投影（L234-236 `community` 行之前）插入：

```ts
          ...(e.audience === 'internal' ? { audience: 'internal' as const } : {}),
          ...(e.decoupled === true ? { decoupled: true as const } : {}),
```

  3. `renderSearch`（L612-613）`zone` 行改为：

```ts
    const zone = it.community === true ? '[社区]' : ''
    const own = (it as { audience?: string }).audience === 'internal' ? '[作者自用]' : ''
    return `${i + 1}. ${it.name} · ${it.id}${zone}${own}${inst} · ${it.categoryLabel || it.category}`
```

  （若 `SearchOut` items 类型可显式扩展 `audience?: 'internal'; decoupled?: true`，优先改类型声明而非 as 断言。）
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/tools-search.test.mjs`
- Expected: 全绿、build 成功。
- [ ] Step 5: checkpoint commit：`git commit -m "feat(tools): surface audience/decoupled in dshm_search with internal-use marking"`

### Task 3: cli.ts 搜索输出标注（含自动化测试）

- 目标：`dshm search` 条目行对 internal 条目加「[作者自用]」标，并具备单元测试覆盖。
- 涉及文件：`src/cli.ts`（L284 输出行）、`tests/cli-search.test.mjs`（新建）
- 接口契约
  - Consumes: Task 1 字段（MarketItem 透传，`it.audience`）；`runCli` 的 deps 注入缝（src/cli.ts:215 区 `deps.listMarket`）。
  - Produces: 无下游依赖。
- 验证范围：`npm run build && node --test tests/cli-search.test.mjs`；真机冒烟留待 Task 8 Step 5（registry 数据落地后复验）。

- [ ] Step 1: 新建 `tests/cli-search.test.mjs`：仿 tests/ 现有 deps 注入用例的写法，经 `runCli` deps 注入 mock `listMarket`，返回一条 `audience: 'internal'` 的主清单条目（surf 形状），断言输出该行含 `[作者自用]`；另断言 audience 缺省的条目行不含该标。
- Run: `npm run build && node --test tests/cli-search.test.mjs`
- Expected: 新用例失败（当前输出无标）。
- [ ] Step 2: 运行并确认失败。
- [ ] Step 3: 最小实现，L284 改为：

```ts
        out(`• ${it.name} (${it.id})${zone}${it.audience === 'internal' ? '[作者自用]' : ''}· ${categoryLabelOf(it.category)} · ${it.source}${inst}`)
```

- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/cli-search.test.mjs`
- Expected: 全绿。
- [ ] Step 5: checkpoint commit：`git commit -m "feat(cli): mark audience=internal entries in dshm search output"`

### Task 4: main.jsx GUI 徽章与详情行

- 目标：市场卡片与详情 Modal 对 internal/decoupled 条目分别渲染「作者自用」「版本无关」徽章与详情行。
- 涉及文件：`src/client/main.jsx`（zh 字典 L34、en 字典 L142、卡片徽章 L1086 与收藏卡 L1530、详情 kv L1118）
- 接口契约
  - Consumes: host-api 市场条目（MarketItem 透传）上的 `audience`/`decoupled` 键。
  - Produces: i18n 键 `badge.internal` / `badge.decoupled` / `modal.audience.label` / `modal.audience.value` / `modal.decoupled.label` / `modal.decoupled.value`。
- 验证范围：`npm run build` + 客户端既有测试无回归；真机面板复核放最终验证。

- [ ] Step 1: 改动前检查：`node --test tests/client-render-smoke.test.mjs tests/client-market-state.test.mjs`
- Expected: 当前全绿（基线）。
- [ ] Step 2: 确认基线绿。
- [ ] Step 3: 最小实现：
  1. zh 字典（L34 行）追加：`"badge.internal": "作者自用", "badge.decoupled": "版本无关", "modal.audience.label": "受众", "modal.audience.value": "作者自用（不面向大众推广）", "modal.decoupled.label": "适配", "modal.decoupled.value": "版本无关（DSH 升级无需跟随适配）",`
  2. en 字典（L142 行）追加：`"badge.internal": "Author's own", "badge.decoupled": "Version-independent", "modal.audience.label": "Audience", "modal.audience.value": "Author's own (not for general promotion)", "modal.decoupled.label": "Compat", "modal.decoupled.value": "Version-independent (no per-release adaptation)",`
  3. 两处卡片徽章（`badge.verified` 的两处卡片渲染点，当前约 L1086 与 L1530，以 grep `badge.verified` 实测为准）追加（该渲染点返回数组已含 `busy/dep/u/i/c/cz/v` 等多个 key，新增 `key: "internal"`/`"decoupled"` 无冲突）：

```jsx
        it.audience === 'internal' ? h("span", { className: "dshm-badge dshm-badge-internal", key: "internal" }, lookup("badge.internal")) : null,
        it.decoupled === true ? h("span", { className: "dshm-badge", key: "decoupled", title: "DSH 升级无需跟随适配" }, lookup("badge.decoupled")) : null,
```

  （`.dshm-badge-internal` 样式若无现成变体可先复用 `.dshm-badge`，样式微调不阻塞本任务。）
  4. 详情 kv（L1118 `modal.verified` 行之后）追加（四独立键方案，不经任何字符串拆分）：

```jsx
        it.audience === 'internal' ? kv(lookup("modal.audience.label"), lookup("modal.audience.value")) : null,
        it.decoupled === true ? kv(lookup("modal.decoupled.label"), lookup("modal.decoupled.value")) : null,
```

  （若 `kv(label, value)` 签名不同，按现文件 L1118 既有调用形态对齐。）
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node --test tests/client-render-smoke.test.mjs tests/client-market-state.test.mjs`
- Expected: build 成功、客户端测试基线绿。
- [ ] Step 5: checkpoint commit：`git commit -m "feat(client): author-own and version-independent badges for internal/decoupled entries"`

### Task 5: validate-registry.mjs 解耦句式软警告

- 目标：decoupled 条目的 description 若含「已适配」句式，打 warn 提示改写（copy-guide §4 门禁化延伸）。
- 涉及文件：`scripts/validate-registry.mjs`（文案软警告循环 L38-56 内）
- 接口契约
  - Consumes: Task 1 透传到 `parsed.registry.plugins[]` 的 `decoupled` 键。
  - Produces: 无下游依赖。
- 验证范围：`node scripts/validate-registry.mjs` 零 warn（现 registry 无 decoupled 条目，纯通路验证）；Task 7 落地后复验真实数据。

- [ ] Step 1: 改动前检查：`npm run build && node scripts/validate-registry.mjs`
- Expected: `✓ schema 合法` 且零 warn。
- [ ] Step 2: 确认基线零 warn。
- [ ] Step 3: 最小实现，在 tag 检查（L46-51）之后追加：

```js
  if (entry.decoupled === true && /已适配/.test(desc)) {
    warned = true
    console.warn(`⚠ ${where} 解耦条目 description 含「已适配」句式——应为「版本无关，详见仓库」（registry-copy-guide §4 第四句式）`)
  }
```

- [ ] Step 4: 运行并确认通过
- Run: `node scripts/validate-registry.mjs`
- Expected: 依旧零 warn（现无 decoupled 条目触发）。
- [ ] Step 5: checkpoint commit：`git commit -m "chore(ci): warn on 已适配 wording in decoupled registry entries"`

### Task 6: DESIGN.md 与 registry-copy-guide.md 文档定稿

- 目标：schema 文档同步两字段；DESIGN 新增 §2.7 记录本轮 grilling 共识；copy-guide 落第四句式与收录决策树。
- 涉及文件：`docs/DESIGN.md`、`docs/registry-copy-guide.md`
- 接口契约
  - Consumes: Task 1 定型的校验规则与字段语义；GLOSSARY「解耦条目」「自用条目」。
  - Produces: §2.7 决策记录（后续查证口径）；copy-guide §4 第四句式表行与两级形态规则。
- 验证范围：文档锚点自检（下 Step 4 清单）。

- [ ] Step 1: 改动前检查：read 两文件对应区段确认现状（DESIGN §2.2 示例 L35-53；copy-guide §4 表格）。
- [ ] Step 2: 确认区段定位无误。
- [ ] Step 3: 内容改动：
  1. DESIGN §2.2：字段清单句（L21「条目只允许 …icon」）补 `verified/alsoCategories/decoupled/audience`；jsonc 示例（L43-50 区）的示例条目 id 由 `dsh-skins` 改为中性 `dsh-example`（schema 示例载体，避免与 R10 终态「dsh-skins 无两字段」观感矛盾），并加两行注释字段：

```jsonc
      "decoupled": true,             // 可选；解耦条目（实操口径），与 verified 互斥
      "audience": "internal",        // 可选 public|internal；缺省 public；'team' 预留未开放
```

  2. DESIGN 新增 §2.7（插在 §2.6 之后、§3 之前），小标题「自研条目元数据：受众与解耦（grilling 定稿 2026-10-05）」，记录五项裁决：①两字段形态（否决 hostCoupling 枚举与 flags 数组）；②audience 两档起步（否决三档）；③载体为字段非新桶（否决拆 self-dev 桶与移出主清单）；④三端不过滤只标注、推荐纪律走工具描述（否决机械过滤）；⑤decoupled 条目删除 verified、渲染「版本无关」徽章（否决保留数组改渲染）。发布纪律一句：先发版后推 registry，旧客户端回落缓存属「例行过渡」。
  3. copy-guide §4：导语「统一三种句式」改「统一四种句式」；句式表追加一行（保持「关系/句式/示例」三列）`| 版本无关（解耦条目） | \`版本无关，详见仓库\` | \`…需自建容器与认证反代。版本无关，详见仓库。\` |`；表下补 bullet——空间不足时允许紧凑形`版本无关。`（两级均合法，以 validate-registry widthUnits 实测当量为准）；§4 末尾加一段：decoupled 条目**禁用**「已适配」句式、不填 verified（GLOSSARY「解耦条目」），缺失版本号不构成负面信号；§7 CI 软警告清单补第四种「decoupled 条目 description 含已适配句式 → warn」（与 Task 5 脚本改动对应）。
  4. copy-guide 新增「§9 收录决策树（自研条目）」：发 npm → registry 收录时判 audience（通用价值可公开推广 → 缺省 public；作者自用/内部推广 → internal）→ 判 decoupled（本次 DSH 升级是否需要发适配版？需要 → coupled，按实测填 verified + 「已适配」句；大概率不需要 → decoupled: true + 「版本无关」句、不填 verified）→ 文案过 §2 预算与 validate 零 warn → 入册。know-how 008 升级核对只覆盖 coupled 条目。
- [ ] Step 4: 验证
- Run: 逐条核对四个改动点在文件中存在且与上文文字一致（read 复核）。
- Expected: 四处全部在位；无「已适配」与 decoupled 并存的表述残留。
- [ ] Step 5: checkpoint commit：`git commit -m "docs: record audience/decoupled consensus (DESIGN §2.7) and copy-guide fourth pattern"`

### Task 7: registry.json 数据终态

- 目标：八个自研条目按共识终态落地（字段 + verified 删除 + 文案）。
- 涉及文件：`registry.json`
- 接口契约
  - Consumes: Task 1 校验（本地 `npm run build && node scripts/validate-registry.mjs` 即可门禁）；Task 5 warn。
  - Produces: Task 8 发布的推送内容；Task 9 know-how 008 的事实基础。
- 验证范围：validate 全绿零 warn；五条 decoupled/internally-marked 条目逐条核对。

- [ ] Step 1: 改动前检查：`node scripts/validate-registry.mjs` 基线零 warn。
- [ ] Step 2: 确认基线。
- [ ] Step 3: 按下表逐条改动（字段插入位置统一放在 `tags` 之后、`verified` 之前；删除 verified 用整行删除）：

| 条目 | 改动 |
|---|---|
| dsh-m / dsh-skins / dsh-skip-browser-auth / dsh-copilot-auth | 无改动（verified 保留原样，不加字段） |
| dsh-quota-watch | 加 `"decoupled": true`；删 `verified` 行；description 末尾追加「版本无关，详见仓库。」 |
| dsh-surf | 加 `"decoupled": true, "audience": "internal"`；删 `verified` 行；删「自托管」三字；「需自建容器并挂认证反代。」改「需自建容器与认证反代。」；末尾追加「版本无关，详见仓库。」 |
| dsh-obmc-web | 加 `"decoupled": true, "audience": "internal"`；删 `verified` 行；原句收窄（「在 DSH 里打开」→「DSH 内打开」、「同源代理走 SSH 隧道」→「同源 SSH 隧道代理」、「设置面板」→「设置页」、删「支持」）；末尾追加紧凑形「版本无关。」 |
| dsh-onetree-log | 加 `"decoupled": true, "audience": "internal"`；删 `verified` 行；尾句「已适配 0.1.7-rc.2，详见仓库。」替换为「版本无关，详见仓库。」 |

  文案终稿（当量按 validate-registry widthUnits 口径实测：surf 57.0 / obmc-web 57.0 / quota-watch 54.0 / onetree-log 45.5，全部 ≤60 且留余量；执行时若实测超限，按 copy-guide 两级形态降级紧凑形「版本无关。」并复验）：
  - quota-watch：`GLM 与 Copilot 额度悬浮球：胶囊、详情面板与侧栏卡片，宿主解析凭据，适配 web 与 desktop。版本无关，详见仓库。`
  - surf：`网络冲浪入口：设置一级菜单一键打开 Selkies/Chrome 远程桌面，视频流直连；需自建容器与认证反代。版本无关，详见仓库。`
  - obmc-web：`DSH 内打开 OpenBMC 控制台：同源 SSH 隧道代理，设置页一键开启，IP 探测与隧道重定向；需 SSH 跳板可达 BMC。版本无关。`
  - onetree-log：`OneTree/dreport 日志包上传解包，14 域清单与预览；可登记服务器本地路径；版本无关，详见仓库。`
  顺序核对（只验证不改动）：self-dev 主桶条目现序 skip-auth → copilot-auth → quota-watch → surf → obmc-web → onetree-log 已满足「公开在前、内部在后」，无需移动。
- [ ] Step 4: 运行并确认通过
- Run: `npm run build && node scripts/validate-registry.mjs`
- Expected: `✓ schema 合法，共 19 条`、零 warn（无超当量、无「已适配」残留在 decoupled 条目、无 decoupled+verified 互斥）。
- [ ] Step 5: checkpoint commit：`git commit -m "data(registry): mark 4 decoupled + 3 internal self-dev entries, drop their verified arrays"`

### Task 8: 版本收口与发布序列（需主人确认后执行线上步骤）

- 目标：dsh-m 0.9.33 收口、发布、升级本机、再推 registry @main（顺序不可倒置）。
- 涉及文件：`package.json`、`CHANGELOG.md`
- 接口契约
  - Consumes: Task 1-7 全部产物；know-how 018 staged 纪律。
  - Produces: npm `dsh-m@0.9.33`；github `iasiv5/dsh-m` main 分支新 registry。
- 验证范围：本地全量测试；发布后三端冒烟。

- [ ] Step 1: `package.json` version 改 `0.9.33`；CHANGELOG.md 按**既有双语体例**补条目（勿新建顶层 `##`）：中文区块顶部按 `### 0.9.33 变更：…` 格式、英文区块同步补对应 `### 0.9.33 …` 条目（照 0.9.32 两条目的层级与风格）。要点：registry schema 增 `audience`/`decoupled`（含与 verified 互斥校验）；dshm_search/GUI/CLI 的 internal 标注与 decoupled 徽章；validate-registry 解耦句式 warn；registry 八自研条目终态落地。
- Run: `npm run build && npm test`
- Expected: 全量绿（Windows symlink 基线集合除外，与改动前逐项一致）。
- [ ] Step 2: 全量测试确认绿后 commit：`git commit -m "chore(release): 0.9.33"`。
- [ ] Step 3:（🔴 需主人在场确认）push main → 打 tag 触发 OIDC 发布 → 按 know-how 018 §5 三键轮询（per-version endpoint / dist-tags.latest / packument time），17–55 分钟 staged 窗口内**不重推 tag**。
- [ ] Step 4:（🔴 主人确认）本机升级 dsh-m → 重启 DSH Web → 打开市场面板确认新版本正常读清单（此时 registry 未变，徽章不出现属正常）。
- [ ] Step 5:（🔴 主人确认）push registry.json @main；旧 dsh-m 客户端将短暂回落缓存显示旧数据（「例行过渡」预期行为）；随后 CLI 冒烟复验 Task 3 标注：`node lib/cli.js search --query surf --source primary` 应出现 `[作者自用]`，GUI 面板 self-dev 分区应出现两枚新徽章。**缓存防假阴性**：CLI 走独立 `cli` namespace 且 SWR 先回 stale——首跑可能仍显旧数据（无标），连跑两次或等待后台刷新后复验；GUI 用设置页「强制刷新」后再核徽章，勿把缓存延迟误判为标注缺失。
- Expected: 三端冒烟全部命中；`dshm_search`（agent）对 dsh-surf 返回 `audience: "internal"`。

### Task 9: know-how 008 与索引表收尾

- 目标：008 文档对象集合与核对范围对齐新事实；索引表同步。
- 涉及文件：`01_docs/dsh-intall-know-how/008-dsh-m-registry-copy-refresh.md`、`01_docs/dsh-intall-know-how/AGENTS.md`（索引表 008 行）
- 接口契约
  - Consumes: Task 7 的 registry 终态（8 个自研条目、4 decoupled）。
  - Produces: 下一次 DSH 升级时的核对清单。
- 验证范围：read 复核两文件一致性。

- [ ] Step 1: 改动前检查：read 008 全文与 AGENTS.md 索引表 008 行，确认「6 个自研条目」表述位置。
- [ ] Step 2: 确认待改点清单（008 §2 对象句、§3 表格；AGENTS.md 索引行「关键修复物」列）。
- [ ] Step 3: 内容改动：
  1. 008 **§2 对象句**（「对象：…6 个自研条目…」所在行）改为：8 个自研条目（补入 dsh-quota-watch / dsh-onetree-log）；核对范围收缩为 **4 个 coupled 条目**（dsh-m / dsh-skins / dsh-skip-browser-auth / dsh-copilot-auth）的兼容句与 verified；4 个 decoupled 条目（quota-watch / surf / obmc-web / onetree-log）只做轻查——「版本无关」句式与 `decoupled`/`audience` 字段仍在、无误删。
  2. 008 §3 表格：现有 surf、obmc-web 两行改标轻查项；**新增** onetree-log、quota-watch 两行轻查项；「（全体）verified 数组」行收窄为「4 个 coupled 条目的 verified 数组」。
  3. AGENTS.md 索引表 008 行「关键修复物」列改为：`dsh-m/registry.json` 8 个自研条目（核对范围 4 个 coupled 条目 + decoupled 条目轻查）；其余列文字同步微调。
- [ ] Step 4: 验证
- Run: read 复核两文件，确认无「6 个自研条目」残留、轻查范围与 Task 7 数据一致。
- Expected: 一致。
- [ ] Step 5: 提交（008 所在仓库为 dsh-workspace）：`git add 01_docs/dsh-intall-know-how/008-dsh-m-registry-copy-refresh.md 01_docs/dsh-intall-know-how/AGENTS.md && git commit -m "docs(know-how): 008 scope 6->8 entries, coupled-only checklist after decoupled marking"`

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行：Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9；Task 3/4/5 相互独立，可在 Task 1 完成后并行。
- 每完成一个任务运行该任务定义的验证；不无声跳步、合并步或改变任务目标。
- Task 8 Step 3-5 为线上动作且标注 🔴，必须主人在场确认；publish 绿 ≠ 已上架（know-how 018），三键轮询前不推进。
- 遇阻塞、重复失败或计划与仓库现实不符，立即停下说明，不要猜。
- 当前分支非 main/master 时直接开工；若在 main，开工前向主人确认。

## 最终验证

- `npm run build && npm test`（dsh-m 仓库）——全量绿，Windows 平台既有 symlink 基线失败集合与改动前逐项一致。
- `node scripts/validate-registry.mjs`——`✓ schema 合法，共 19 条`、零 warn。
- 发布完成后三端冒烟（Task 8 Step 5）：CLI `[作者自用]` 标、GUI 两枚徽章、agent 工具 `audience` 字段。
- read 复核：DESIGN §2.7、copy-guide §4/§9、GLOSSARY 三术语、know-how 008 与索引行全部在位。

## 审阅 Checkpoint

- 计划正文到此结束。请先审阅；批准前不进入实现。批准后默认由普通编码 agent 或人工按任务顺序执行；Task 8 线上步骤需主人在场。
