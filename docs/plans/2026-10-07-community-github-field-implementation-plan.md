# 社区条目 github 字段补全（图标覆盖 45.6% → 100%）实施计划

## 目标

- 社区清单适配层在 npm 源条目上补派生 `github` 辅助字段（`url` 为 github.com 形态时取 `owner/repo`，子包取 repo 根），使社区区图标走既有的 GitHub owner 头像兜底链路，图标覆盖从 45.6%（1928/4226）提升到 100%（4226/4226，2026-10-07 实测 `dsh-plugin-catalog@2026.1007.4837`）。
- 同步设计文档两处失真措辞、版本号 bump 至 0.9.51、CHANGELOG 双语条目。
- `source` 字段语义不变；客户端零改动（Icon / officialLinks / matchInstalledByEntry / toMarketItem 均为既有消费链路，`github` 字段补全后自动生效）。

## 架构快照

- 单点改动：`adaptCommunityCatalog`（`src/core/community-adapter.ts`）的 npm 分支。现状该分支只产出 `npm` 字段即定源，`raw.url` 仅降级进 `homepage`；改动后追加 `github = githubFromUrl(raw.url) ?? undefined`（复用现有函数，仅接受 github.com 的 http(s) URL 且满足 `GITHUB_SHAPE_RE`；`/tree/` 子路径正则天然只捕获前两段 = repo 根）。派生失败不产出键、不跳过条目、不计 warning（条目层宽松语义 Q43）。
- 下游全自动生效，无需改动的既有消费点：客户端 `Icon` 三级兜底（`entry.icon` → `github.com/<owner>.png?size=64` → 字母，`src/client/main.jsx` Icon 组件）；`officialLinks` 详情行（github 存在时渲染 GitHub 链接）；`matchInstalledByEntry` github 分支；`toMarketItem` 的 `...entry` 透传；已装视图 `registryGithub`（README 基址三级兜底第一级）。
- 两条已确认接受的语义激活（grill 共识 Q4/Q5）：①`mergeRegistries` 的 github 碰撞分支开始作用于社区 npm 条目——2026-10-07 全量真实目录模拟：新增让位 0 条（4215 → 4215）；②github 源手装的插件可被社区 npm 条目匹配（升级走 npm 源，与精选双源条目既有语义一致）。
- 性能面：宿主侧零新增网络请求（正则派生自已抓取的 `url` 字符串）；latest 探测路径不变（`source` 仍 npm → npmLatest，Q46 社区 github 豁免与 `GithubBudget` 均不触及，头像请求来自浏览器不占宿主预算）；latest 缓存键仍为 `npm:` 前缀（`latestItemId` npm 优先）不受影响；每条目序列化增量 ~25 字节；搜索字段不含 `github` 零影响。
- 量化证据工件（工作区根，非本仓库内）：`D:\_dsh-workspace\.tmp-icon-analysis\analyze.js`（镜像适配层判定逻辑的只读统计脚本，附 `download.js` 可复现数据抓取）。

## 全局约束

- Node ≥ 22（package.json engines，逐字继承）。
- 条目层宽松语义（Q43）：单条不合格跳过 + 计数，绝不因 github 派生失败中断或跳过条目。
- `source` 字段恒为 `'npm' | 'github'` 二选一；npm 条目附 `github` 是 DESIGN.md §2.2 已记载的合法形态（「source=github 时必填；npm 条目也可附」）。
- 形状校验沿用适配层现有 `GITHUB_SHAPE_RE`（与 registry.ts `GITHUB_RE` 同语义锚定，注释要求「锚定不漂移」）；不新增长度上限校验（registry.ts 的 owner≤39/repo≤100 上限只作用于精选清单校验链，社区条目不经过该链——维持两链现状，不借机扩权）。
- 不新增任何宿主侧网络请求；不做收藏 localStorage 迁移（stale 收藏仍显示字母，重收藏后自然更新）。
- CHANGELOG 双语维护：中文在前、英文在后，同版本号对齐，各区块 newest-first（CHANGELOG.md 头部规则逐字继承）。
- 本机为 Windows + PowerShell（pwsh）；测试跑在构建产物上（tests import `../lib/*`），`npm test` 的 pretest 自动 build。
- 本机存在与本次改动无关的既有测试基线（CHANGELOG 0.9.50 在案「Windows 本机 symlink 族既有基线豁免」）：一切「全绿」判定均为**与 Task 0 基线对照零新增失败**，不是绝对零失败。

## 输入工件

- 设计共识：grill-with-docs 八项决策（2026-10-07 会话，用户确认「全部按推荐」）：Q1 补全形态与派生规则 / Q2 子包取根 / Q3 保留原样大小写 / Q4 接受让位语义激活 / Q5 接受已装匹配扩效与升级源切换 / Q6 接受展示层变化且不做 localStorage 迁移 / Q7 测试策略与验证命令 / Q8 版本 0.9.51 + CHANGELOG + 不动 GLOSSARY、不写 ADR + 计划不含 npm publish 与本机插件升级。
- 量化数据：`dsh-plugin-catalog@2026.1007.4837`（4414 条原生，4226 条可收录；npm 源 2298 条 100% 带 github.com url；去重 owner 2691 个）。
- 波及面事实：`tests/community-adapter.test.mjs` L59 `assert.equal(e.github, undefined)` 是唯一需翻转的既有断言；`tests/market.test.mjs` 对社区条目只断言 id 数组（`deepEqual(res.items.map(it => it.id))`），无整条形状快照。
- 数据时效：上述量化数字为编写时点（2026-10-07）对 `dsh-plugin-catalog@2026.1007.4837` 的实测；上游目录持续更新，执行时如需引用最新数字，重跑证据工件脚本（联网抓目录后运行）即可，不阻塞任何任务步骤。

## 文件结构与职责

- Modify: `src/core/community-adapter.ts` —— 适配层 npm 分支补派生 `github`（本次唯一生产代码改动）。
- Test: `tests/community-adapter.test.mjs` —— 翻转 L59 断言；新增 npm 条目 github 派生的四态用例（github url / 非 github url / 无 url / 非法形状）；子包取根断言。
- Test: `tests/market.test.mjs` —— 新增「github 碰撞让位」合并层用例（改动前红、改动后绿，钉死 Q4 语义激活）。
- Modify: `docs/DESIGN.md` —— §2.5 适配层措辞与图标兜底措辞两处同步（约 L74、L183，以文字锚点定位）。
- Modify: `package.json` —— `version` 0.9.50 → 0.9.51。
- Modify: `CHANGELOG.md` —— 中文区、英文区各前置一条 0.9.51 条目。

边界保持：`src/client/**` 零改动；`src/core/registry.ts`（精选校验链）零改动；GLOSSARY.md 不动；不新建 ADR。

## 任务清单

### Task 0: 捕获改动前测试基线

- 目标：记录当前工作树的完整测试结果集合，作为后续所有「零新增失败」判定的对照物。
- 涉及文件：无（只读操作；`npm test` 会重建 `lib/` 构建产物，属常规仓库操作）。
- 接口契约：
  - Consumes: 无
  - Produces: 基线两件套 =（五项统计计数）+（失败用例名集合），供 Task 4 与 Task 7 对照
- 验证范围：命令成功产出可对照的统计与失败名清单。

- [ ] Step 1: 在仓库根运行全量测试，统计与失败名分别提取（管道尾部截断取不全失败名——spec reporter 的失败名散布于全量输出，必须全量落盘后再检索）
- Run: `npm test *> "$env:TEMP\dshm-baseline.log"; Select-String -Path "$env:TEMP\dshm-baseline.log" -Pattern 'ℹ (tests|pass|fail|cancelled|skipped) \d'; Select-String -Path "$env:TEMP\dshm-baseline.log" -Pattern '^\s*✖'`（workdir：`D:\_dsh-workspace\dsh-m`，pwsh；本机 Node v24 管道/重定向下均为 spec reporter：汇总行前缀 `ℹ`、失败用例行首 `✖`——套件级 ✖ 与结尾 recap 段会重复出现，去重后数量 = fail 计数；记录后删除该临时日志）
- Expected: 五项统计（tests/pass/fail/cancelled/skipped）+ 失败用例名清单（✖ 行，去重）；**将失败用例名原样记录为基线集合**（编写本计划时已捕获一次基线：1194 用例、fail 15、全部为 Windows symlink 族既有项——明细见文末「任务附录」；执行者以自己这次运行的输出为准）。
- [ ] Step 2: 记录 typecheck 现状
- Run: `npm run typecheck`
- Expected: 零错误退出。

### Task 1: 适配层失败测试（community-adapter.test.mjs）

- 目标：把「npm 条目 github 派生」的目标行为写成失败测试（红）。
- 涉及文件：`tests/community-adapter.test.mjs`。
- 接口契约：
  - Consumes: 现有测试基建 `catalogOf()` 合成 helper（该文件内已有）、fixture 断言风格（定向字段断言）
  - Produces: 红状态测试集，Task 3 的验收标的
- 验证范围：运行本文件测试，确认**仅**目标用例失败、其余保持通过。

- [ ] Step 1: 翻转 L59 断言（「入库 fixture 全量」describe 内 dsh-j-space 条目）
- Change: `assert.equal(e.github, undefined)` → `assert.equal(e.github, 'AnonyJcy/dsh-j-space')`（fixture 该条目 `url: https://github.com/AnonyJcy/dsh-j-space`）。
- [ ] Step 2: 在 L244 起的子包用例（`dsh-undo/tree/master/packages/bundle-rollback`）内追加一行断言
- Change: 增 `assert.equal(r.entries[0].github, '23swccp/dsh-undo')`（子包取 repo 根，Q2）。
- [ ] Step 3: 在「合成条目契约」describe 末尾新增四态用例
- Change: 追加以下用例（沿用 `catalogOf` helper）：

```js
  it('npm 条目 url 为 github.com → 派生 github 原样大小写，homepage 并存（0.9.51）', () => {
    const r = adaptCommunityCatalog(catalogOf([
      { name: 'a', owner: 'o', category: 'ui', npm: 'pkg-a', url: 'https://github.com/Oo/Ra-Repo', description: { en: 'a' } },
    ]))
    assert.equal(r.entries[0].source, 'npm')
    assert.equal(r.entries[0].github, 'Oo/Ra-Repo', 'owner/repo 保留 url 原样大小写（Q3）')
    assert.equal(r.entries[0].homepage, 'https://github.com/Oo/Ra-Repo')
  })
  it('npm 条目 url 非 github 域 → 不产生 github 键（0.9.51）', () => {
    const r = adaptCommunityCatalog(catalogOf([
      { name: 'b', owner: 'o', category: 'ui', npm: 'pkg-b', url: 'https://gitlab.com/oo/rb', description: { en: 'b' } },
    ]))
    assert.equal('github' in r.entries[0], false)
  })
  it('npm 条目无 url → 不产生 github 键（0.9.51）', () => {
    const r = adaptCommunityCatalog(catalogOf([{ name: 'c', owner: 'o', category: 'ui', npm: 'pkg-c', description: { en: 'c' } }]))
    assert.equal('github' in r.entries[0], false)
  })
  it('npm 条目 url 非法 github 形状（仅 owner）→ 不产生 github 键（0.9.51）', () => {
    const r = adaptCommunityCatalog(catalogOf([
      { name: 'd', owner: 'o', category: 'ui', npm: 'pkg-d', url: 'https://github.com/only-owner', description: { en: 'd' } },
    ]))
    assert.equal('github' in r.entries[0], false)
  })
```

- [ ] Step 4: 构建并运行本文件，确认红
- Run: `npm run build; node --test tests/community-adapter.test.mjs`（pwsh，先 build 因测试跑 `lib/` 产物）
- Expected: 恰好 3 例失败 = 既有 2 例（L59 所在的 dsh-j-space 用例、子包 dsh-undo 用例——各自因新断言失败）+ 新用例 1（github url 派生，实际 `github` 为 `undefined`）。新增用例 2/3/4 为负向守卫（改动前后都不产 github 键），红绿两态均通过、不计入红态；该文件其余用例保持通过。失败多于 3 例时停下比对，不得继续。
- [ ] Step 5: 可选 checkpoint commit（红状态，建议提交以固化 TDD 锚点）
- Run: `git add tests/community-adapter.test.mjs; git commit -m "test(community-adapter): npm 条目 github 派生目标行为（红）"`

### Task 2: 合并层与已装匹配失败测试（market.test.mjs，Q4 碰撞让位 + Q5 已装匹配钉子）

- 目标：钉死两条补全激活语义——Q4 社区 npm 条目经 github 碰撞让位、Q5 GitHub 源手装可被社区 npm 条目匹配（均改动前红）。
- 涉及文件：`tests/market.test.mjs`。
- 接口契约：
  - Consumes: 该文件现有 helpers `fakeDeps()` / `readyLoaded()` / `withCommunity()` / `communityRaw()` / `communityLoaded()` 与 `cfg` 常量（文件内已有）；`listMarket`、`listInstalledWithMeta` 均已在文件头 import（L12）
  - Produces: 红状态用例 2 条（①-b 合并让位、⑩-b 已装匹配），Task 3 的验收标的
- 验证范围：运行本文件，确认仅两条新用例失败。

- [ ] Step 1: 在 `describe('M1 Task 5：合并市场')` 的用例 ① 之后插入新用例
- Change: 追加（紧跟用例 ① 的 `it(...)` 闭合之后）：

```js
  it('①-b 0.9.51 补全：社区 npm 条目经 github 碰撞让位（npm 名不撞、repo 撞）', async () => {
    const primary = [
      { id: 'p-g', name: 'G', description: 'dg', category: 'tools', tags: [], source: 'npm', npm: 'pkg-g', github: 'own/g-repo' },
    ]
    const base = fakeDeps({ loadRegistry: async () => readyLoaded(primary) })
    const { deps } = withCommunity(base, communityLoaded([
      communityRaw('g-repo', 'own', { npm: 'fresh-npm' }), // npm 名不撞；url 默认 github.com/own/g-repo → 撞主条目 github
      communityRaw('other', 'o2'),                         // 无撞 → 收录
    ]))
    const res = await listMarket(cfg, { withLatest: false }, deps)
    assert.deepEqual(res.items.map((it) => it.id), ['p-g', 'o2--other'])
    assert.equal(res.community.displaced, 1)
  })
```

- [ ] Step 2: 在用例 ⑩（`⑩ 已装页合并匹配社区条目并标 community…`，约 L1356 起，走 `listInstalledWithMeta`）之后插入 ⑩-b
- Change: 追加（已装 fixture 形态逐字对齐用例 ⑩，来源换成 github、spec 用完整 commit sha 形态）：

```js
  it('⑩-b 0.9.51 补全：GitHub 源手装可被社区 npm 条目匹配（Q5 钉子）', async () => {
    const installed = {
      items: [{
        pkg: 'g-repo', name: 'G', version: '0.0.0', description: '', homepage: '',
        spec: `github:own/g-repo#${'a'.repeat(40)}`, source: 'github', dsh: true, path: '/tmp/node_modules/g-repo',
      }],
      others: 0,
      complete: true,
      profileDir: '/tmp/profile',
    }
    const base = fakeDeps({ listInstalledPlugins: async () => installed })
    const { deps } = withCommunity(base, communityLoaded([communityRaw('g-repo', 'own', { npm: 'fresh-npm' })]))
    const res = await listInstalledWithMeta(cfg, {}, deps)
    assert.equal(res.items[0].registryId, 'own--g-repo', 'github 分支命中社区 npm 条目（改动前无 github 字段 → 红）')
    assert.equal(res.items[0].registryGithub, 'own/g-repo')
  })
```

  已装 pkg/name（`g-repo`/`G`）刻意不等于条目 npm（`fresh-npm`），确保改动前 npm 名分支必然不命中、只有 github 分支能命中。
- [ ] Step 3: 构建并运行本文件，确认红
- Run: `npm run build; node --test tests/market.test.mjs`
- Expected: 恰好 2 例失败——①-b（改动前 `own--g-repo` 被收录：实际 items 为三个 id、displaced 为 0）与 ⑩-b（改动前无匹配：实际 `registryId` 为 `undefined`）；该文件其余用例保持通过。若出现其他失败，立即停下比对 Task 0 基线并说明，不得继续。
- [ ] Step 4: 可选 checkpoint commit
- Run: `git add tests/market.test.mjs; git commit -m "test(market): 合并层碰撞让位与已装匹配钉子（红）"`

### Task 3: 适配层最小实现（community-adapter.ts）

- 目标：npm 分支补派生 `github`，使 Task 1 / Task 2 全部转绿。
- 涉及文件：`src/core/community-adapter.ts`。
- 接口契约：
  - Consumes: Task 1 / Task 2 的红测试；现有 `githubFromUrl()`（本文件 L85 起，`string | null` 返回）；现有 entries 组装处的可选键展开 `...(github !== undefined ? { github } : {})`（本文件 L213）
  - Produces: `CommunityEntry.github` 语义——npm 源条目在 `raw.url` 为 github.com 形态时携带 `owner/repo`（子包为 repo 根、原样大小写）；派生失败键不产生。Task 4/5/6 与客户端既有消费链均依赖此语义
- 验证范围：Task 1 / Task 2 两个测试文件全绿。

- [ ] Step 1: 修改 npm 分支
- Change: `adaptCommunityCatalog` 内（现 L182-L184，「`if (npm !== null) {`」分支）改为：

```ts
    if (npm !== null) {
      source = 'npm'
      npmName = npm
      // 0.9.51：npm 条目补派生 github（url 为 github.com 形态时取 owner/repo，子包取 repo 根，
      // 原样大小写）——图标 owner 头像兜底 / 详情 GitHub 链接 / 已装匹配与精选双源条目同语义。
      // 派生失败不产出键、不跳过条目（条目层宽松，Q43）。
      github = githubFromUrl(raw.url) ?? undefined
    } else {
```

  其余代码（github 源分支、homepage、id 合成、entries 组装）一律不动。
- [ ] Step 2: 构建并运行两个测试文件，确认绿
- Run: `npm run build; node --test tests/community-adapter.test.mjs; node --test tests/market.test.mjs`
- Expected: 两文件全部用例通过（含 Task 1/2 新增用例与既有全部用例——`communityRaw` 默认 url 给既有用例条目补上 github 键后，既有断言全部为 id 数组或定向字段断言，预期零波及）。若有非新增用例失败：属于「条目形状断言获得 github 键」类的，把断言值更新为 url 派生的 `owner/repo` 后重跑；属于 displaced / 条目计数 / 排序 / id 序列变化的，立即停下说明（那是行为回归信号），不得改断言。
- [ ] Step 3: checkpoint commit
- Run: `git add src/core/community-adapter.ts; git commit -m "feat(community-adapter): npm 条目补派生 github（0.9.51）"`

### Task 4: 全量回归对照基线

- 目标：证明改动在真实全量下零新增失败、类型零错误。
- 涉及文件：无新改动（验证任务；若触发 Step 2 决策规则的更新分支，则涉及对应测试文件）。
- 接口契约：
  - Consumes: Task 0 基线记录、Task 3 产物
  - Produces: 全量回归结论（Task 7 收口引用）
- 验证范围：全量测试 + typecheck。

- [ ] Step 1: 全量测试（统计 + 失败名两件套，命令同 Task 0 Step 1）
- Run: `npm test *> "$env:TEMP\dshm-run.log"; Select-String -Path "$env:TEMP\dshm-run.log" -Pattern 'ℹ (tests|pass|fail|cancelled|skipped) \d'; Select-String -Path "$env:TEMP\dshm-run.log" -Pattern '^\s*✖'`
- Expected: 失败集合与 Task 0 基线**完全一致**（零新增失败；本机 symlink 族既有失败按基线豁免）。
- [ ] Step 2: 决策规则（仅在出现新失败时执行）
- Change: 新失败若为「条目形状断言多出 github 键」类（值 = 条目 url 派生的 `owner/repo`），更新断言并在提交信息注明 `test: 适配 0.9.51 github 字段`；新失败若涉及 displaced / acceptedCount / 排序 / id 序列 / 条目总数，**不得修改断言**，立即停下报告。
- [ ] Step 3: typecheck
- Run: `npm run typecheck`
- Expected: 零错误。

### Task 5: DESIGN.md 两处措辞同步

- 目标：设计文档与实现保持一致（仓库纪律：文档必须真实）。
- 涉及文件：`docs/DESIGN.md`。
- 接口契约：
  - Consumes: Task 3 定稿的适配层语义
  - Produces: 无下游依赖（文档真实性）
- 验证范围：两处锚点文字存在性检查。

- [ ] Step 1: 修订 §2.5「目录适配层」句（文字锚点：「`npm` 非空 → `source: npm`，否则 `source: github`（owner/repo 取自 url）；`url` → homepage」）
- Change: 该句改为「`npm` 非空 → `source: npm`（`url` 为 github.com 形态时同时派生 `github` owner/repo，子包取 repo 根，0.9.51 起），否则 `source: github`（owner/repo 取自 url）；`url` → homepage」。
- [ ] Step 2: 修订图标句（文字锚点：「图标：GitHub 来源自动用 `https://github.com/<owner>.png?size=64`；`icon` 字段可覆盖；npm-only 条目首字母色块回退。」）
- Change: 改为「图标：条目携带 `github`（github 源，或 npm 源自 url 派生）时自动用 `https://github.com/<owner>.png?size=64`；`icon` 字段可覆盖；两者皆缺首字母色块回退。」
- [ ] Step 3: 验证两处修订就位
- Run: `Select-String -Path docs\DESIGN.md -Pattern '0\.9\.51 起','两者皆缺首字母色块回退','npm-only 条目首字母色块回退'`（pwsh，workdir `D:\_dsh-workspace\dsh-m`）
- Expected: 前两条模式各命中 1 次；第三条模式（旧句）命中 0 次。
- [ ] Step 4: checkpoint commit
- Run: `git add docs/DESIGN.md; git commit -m "docs(DESIGN): 社区适配层 github 派生与图标措辞同步（0.9.51）"`

### Task 6: 0.9.51 发版记录（package.json 版本 + CHANGELOG 双语条目）

- 目标：按仓库发版惯例完成 0.9.51 版本与双语变更记录。
- 涉及文件：`package.json`、`CHANGELOG.md`。
- 接口契约：
  - Consumes: Task 3/4/5 的最终行为与测试事实
  - Produces: `dsh-m@0.9.51`（发版前置状态；npm publish 与本机插件升级不在本计划内）
- 验证范围：版本号一致性 + 双区条目存在性 + 构建产物版本随动。

- [ ] Step 1: bump 版本（package.json + package-lock.json 同步，仓库惯例两文件同批变更）
- Change: ①`package.json` 的 `"version": "0.9.50"` → `"0.9.51"`；②运行 `npm install --package-lock-only`（只重算 lock、不触 node_modules），并 `git diff package-lock.json` 确认仅两处根版本行（L3、L9）变化。
- [ ] Step 2: 中文区前置条目（`## 中文` 标题后、`### 0.9.50 变更` 之前插入）
- Change: 在 `## 中文` 标题后、`### 0.9.50 变更` 之前逐字插入以下条目：

```markdown
### 0.9.51 变更：社区条目 github 字段补全（图标覆盖 45.6% → 100%）

- **动机**：社区区 npm 源条目卡片恒为首字母色块——适配层 npm 分支只产出 `npm` 字段即定源，上游目录 `url` 里的 GitHub repo 映射只被降级进 homepage，`github` 字段恒缺，客户端 Icon 的 owner 头像兜底（`github.com/<owner>.png?size=64`）无从触发。实测 `dsh-plugin-catalog@2026.1007.4837`：4,226 条可收录条目中 npm 源 2,298 条 **100% 带 github.com url**，纯数据丢弃，非上游缺失。
- **改动（单点）**：适配层 npm 分支补派生 `github = githubFromUrl(url)`（子包 `/tree/` 取 repo 根、原样大小写；派生失败不产出键、不跳过条目，条目层宽松 Q43）。`source` 语义不变；客户端零改动——Icon 兜底、详情行「GitHub · npm」、已装 `registryGithub`（README 基址三级兜底第一级）既有链路自动生效。
- **语义激活（已在案接受）**：①合并层 github 碰撞分支开始作用于社区 npm 条目（同 repo 让位精选恒优先）——全量真实目录模拟新增让位 0 条（4,215 → 4,215）；②GitHub 源手装的插件可被社区 npm 条目匹配，升级走 npm 源（与精选双源条目既有语义一致）。性能面零回归：宿主侧零新增网络请求、latest 探测路径与缓存键不变、Q46 社区 github 探测豁免与 GithubBudget 不触及。
- **测试**：适配层翻转 1 断言 + 净增 4 例（github url 派生与原样大小写、非 github 域、无 url、非法形状），既有子包用例补 1 断言（取 repo 根）；合并层净增 2 例（github 碰撞让位、GitHub 源手装匹配，均红→绿）；全量与基线对照零新增失败、typecheck 零错误。
```

- [ ] Step 3: 英文区前置对齐条目（`## English` 区 `### Added in 0.9.50 — …` 条目之前插入，版本号一致、newest-first；英文区标题惯例为 `### Added in <版本> — <摘要>`）
- Change: 新增以下条目（逐段对齐 Step 2 中文条目）：

```markdown
### Added in 0.9.51 — community entries gain a derived github field (icon coverage 45.6% → 100%)

- **Motivation**: community npm-source cards always fell back to the initial letter — the adapter's npm branch only produced the `npm` field and discarded the GitHub repo mapping inside the upstream `url` (demoted to `homepage` only), so `github` stayed unset and the client Icon owner-avatar fallback (`github.com/<owner>.png?size=64`) never fired. Measured against `dsh-plugin-catalog@2026.1007.4837`: 2,298 of 2,298 npm-source entries among 4,226 adaptable ones (**100%**) carry a github.com url — pure data discarding, not an upstream gap.
- **Change (single point)**: the adapter npm branch now derives `github = githubFromUrl(url)` (`/tree/` subpaths resolve to the repo root; original casing preserved; derivation failure produces no key and never skips the entry — lenient entry semantics, Q43). `source` semantics unchanged; zero client changes — Icon fallback, the details row gaining "GitHub · npm", and installed-view `registryGithub` (first tier of the README base-URL fallback) all light up through existing pipelines.
- **Activated semantics (accepted on record)**: ① the merge layer's github-collision branch now applies to community npm entries (same-repo entries yield to curated, curated always wins) — full real-catalog simulation shows zero new displacements (4,215 → 4,215); ② plugins installed from GitHub source can now match community npm entries, upgrading via the npm source (same semantics curated dual-source entries already had). Zero performance regression: no new host-side network requests, latest-probe path and cache keys unchanged, the Q46 community-github probe exemption and GithubBudget untouched.
- **Tests**: adapter flips 1 assertion + nets 4 cases (github url derivation with original casing, non-github host, missing url, invalid shape), plus 1 added assertion in the existing subpath case (repo root); merge layer nets 2 cases (github-collision displacement, GitHub-source installed matching; both red → green); full suite shows zero new failures against the captured baseline and zero typecheck errors.
```
- [ ] Step 4: 验证
- Run: `npm run build; node -e "console.log(require('./package.json').version)"; Select-String -Path package-lock.json -Pattern '"version": "0\.9\.5[01]"'; Select-String -Path CHANGELOG.md -Pattern '### 0\.9\.51 变更','### Added in 0\.9\.51'`
- Expected: 输出 `0.9.51`；lock 中 `"version": "0.9.51"` 命中 2 次、`"version": "0.9.50"` 命中 0 次；CHANGELOG 两条模式各命中 1 次（中英各一）；build 成功。
- [ ] Step 5: checkpoint commit
- Run: `git add package.json package-lock.json CHANGELOG.md; git commit -m "chore(release): 0.9.51 社区条目 github 字段补全"`

### Task 7: 最终收口验证

- 目标：全部任务完成后的收口验证与修改摘要输出。
- 涉及文件：无新改动。
- 接口契约：
  - Consumes: Task 0 基线、Task 1-6 全部产物
  - Produces: 收口结论 + 修改摘要（给用户的交付说明）
- 验证范围：与 Task 4 相同的全量命令在文档任务之后复跑一次。

- [ ] Step 1: 全量测试（统计 + 失败名两件套，命令同 Task 0 Step 1）
- Run: `npm test *> "$env:TEMP\dshm-final.log"; Select-String -Path "$env:TEMP\dshm-final.log" -Pattern 'ℹ (tests|pass|fail|cancelled|skipped) \d'; Select-String -Path "$env:TEMP\dshm-final.log" -Pattern '^\s*✖'`
- Expected: 失败集合仍与 Task 0 基线完全一致。
- [ ] Step 2: typecheck
- Run: `npm run typecheck`
- Expected: 零错误。
- [ ] Step 3: 清理临时日志并核对 git 状态
- Run: `Remove-Item "$env:TEMP\dshm-baseline.log", "$env:TEMP\dshm-run.log", "$env:TEMP\dshm-final.log" -Force -ErrorAction SilentlyContinue; git status --short; git log --oneline -6`
- Expected: 三个临时日志已清理（Task 0/4/7 各一）；工作树干净（仅本计划相关提交）；提交序列为 Task 1-6 的 checkpoint（或合并后的等价序列）。
- [ ] Step 4: 输出修改摘要（改动文件清单、基线对照结论、生效方式说明：发布 npm 并升级插件后刷新页面即见社区区头像；本计划不执行发布）

## 执行纪律

- 开始实现前，先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行（Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7），不无声跳步、合并步或改变任务目标。
- 每完成一个任务，立即运行该任务定义的验证；红→绿链条断开时不得进入下一任务。
- 回退方案：各任务的 checkpoint commit 即回退点。任一任务验证不过且无法当场归因时，`git revert` 该任务对应的 checkpoint（或 `git checkout -- <file>` 对未提交改动）回到上一绿态再复盘，不得带红推进。
- 遇到阻塞、重复失败、或计划与仓库现实不符（尤其 Task 4 Step 2 的决策规则第二分支），立即停下说明，不要猜。
- 当前分支若为 `main`/`master`，开始实现前先向用户确认（dsh-m 为独立 Git 仓库，远端 `github.com/iasiv5/dsh-m`）。
- 全部任务完成后运行 Task 7 最终验证并输出修改摘要。

## 最终验证

- `npm test`（workdir `D:\_dsh-workspace\dsh-m`，pwsh）：失败集合与 Task 0 基线完全一致，零新增失败。
- `npm run typecheck`：零错误。
- `git status --short`：工作树干净。
- 生效链路说明（发布后人工步骤，不在本计划内）：`npm publish` → 本机 `dshm upgrade` → 刷新页面，社区区 npm 条目显示 owner 头像、详情行出现 GitHub 链接。

## 任务附录：Task 0 基线记录（2026-10-07 实测，编写本计划时捕获）

- `npm test`（workdir `D:\_dsh-workspace\dsh-m`）：tests **1194** / suites 268 / pass **1169** / **fail 15** / skipped 10 / duration ≈145s。
- 15 个失败**全部**为 Windows symlink 族（`EPERM: operation not permitted, symlink`——非管理员终端无法创建符号链接，与本次改动无关的在案既有基线，CHANGELOG 0.9.50 已注），按文件分布：
  - `tests/doctor.test.mjs`（13）：响应信封 { ok:true, report } 且 report 为完整 DoctorReport（对 fixture profile 真跑）；祖先链遍历命中父目录共享店（farmChecked>0，评审 R1.2 反空转）；悬空 → error finding（check=farm-liveness…）；dsh 伞包指向旧运行时 store → stale-target…；非 dsh 伞包（如 cordis）版本不同于 runtime 也不判 stale…；两级提取第二级：无版本段目标读其 package.json version…；runtimeVersion=null → 不判 stale、记降级 unknowns…；dsh 伞包指向当前运行时版本 → healthy 不 stale；两级提取皆失败 → targetVersion=null 聚合进 unknowns…；聚合：summary 计数与分项一致…；dualMarket：双市场并存命中…；dualMarket：无 dshmarket → null；--json 可解析；有 error（悬空）时 exit 1…
  - `tests/installed.test.mjs`（1）：link: 依赖——pin 记原文、installed 取目标 package.json、lockfile 置 null
  - `tests/dsh-version.test.mjs`（1）：pnpm 全局 shim 形态（F1，0.9.29 装机验收实证）…
- 套件级 ✖（`CLI bin 符号链接入口（F2）`、`doctor method`、`analyzeFarm`、`checkAccount`、`runDoctor`、`dshm doctor（CLI 子命令）`、`dsh-version：readLauncherPackageVersion`）为父套件失败标记（子测试已计入上述 15），不单独计数。
- `npm run typecheck`：零错误（exit 0）。
- 对照规则：改动后 **fail 计数与失败用例名集合必须与本表完全一致**（零新增失败）；tests/pass 总数按 **+6** 预期漂移（Task 1 净增 4 用例 + Task 2 净增 2 用例，且全部通过），属合法变化；除上述之外的任何统计差异（fail 计数、失败名集合、skipped/cancelled 数）即为信号——按 Task 4 Step 2 决策规则处理。

## 审阅 Checkpoint

- 计划正文到此结束。请先审阅这份计划；确认后可交由普通编码 agent 或人工按任务清单执行（每任务含验证命令与预期结果）。审阅通过前不进入实现。
