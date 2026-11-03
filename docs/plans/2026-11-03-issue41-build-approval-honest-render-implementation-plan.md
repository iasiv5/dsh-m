# issue #41 构建审批未遂诚实渲染与重试通道 实施计划

## 目标

修复 dsh-m issue #41（0.11.15 报告，0.12.1 仍在）的两层缺陷，发 0.12.2：

1. **假成功渲染**：desktop 路径 `needsBuildApproval` 结构化未遂结果被 `renderUpgrade`/`renderInstall`/`presentResult`/GUI toast 渲染成「✅ 已升级/已安装」；
2. **重试通道不可达**：core 已支持 `approvedBuilds` 透传（profile-ops.ts:839/:1175），但 `dshm_upgrade`/`dshm_install` 工具 schema 无此入参，「未遂 → 用户确认 → 带名单重试」闭环在工具层走不完。

连带交付：systemPrompt 重试闭环指引句、`:535` desktop 能力句过期更正、GUI 面板 toast 诚实分流、ADR-0002 追加节、GLOSSARY 补词条、CHANGELOG 双语、发版后回评并关闭 issue #41。

## 架构快照

- **沿用 0.8.5 guard 的「return + render 分流」形态**（不改成 throw→isError）：desktop 未遂结果继续原样 return，信息由渲染层分流——保住 `pendingBuilds`/`spec` 结构化载荷随结果到达模型，与 web guard 臂形态一致（tools.ts:320/:486 先例）。
- **渲染层总不变量**（grill Q2/Q11 决议）：`renderInstall`/`renderUpgrade` 对任何 `ok === false` 永不输出「✅ 已安装/已升级」。专臂优先（guard → needsBuildApproval → catch-all）。普查证实 catch-all 当前为空集（工具路径不抛出的 `ok:false` 仅 web guard 与 desktop needsBuildApproval 两族），保留它属防御纵深——此类 bug 已两次漏网（0.8.5、本次）。
- **重试通道**：`approvedBuilds: string[]` 加进两工具 schema，execute 仅在 desktop 分支透传（core 条件展开 profile-ops.ts:515 已保证缺省零漂移）；信任模型与 `force` 同级（模型发起、人确认），**不做回显校验**（journal `ExternalOperationRecord` 白名单无 pendingBuilds 字段，external-journal.ts:38-48，无结构化状态可用——grill Q3 决议，事实核证）。
- **GUI 深度 (a)**（grill Q14 决议）：仅诚实显示 + 指引，host-api/面板不接 `approvedBuilds` 管线；面板用户重试走「让助手处理」或官方 Settings → Plugins。
- **批量语义不动**（grill Q8 决议）：`classifyBatchOutcome` 把 needsBuildApproval 归 'target' 跳过继续（installed-updates.js:91-95 现状即如此），批量升级分支的返回值用 `classifyBatchOutcome(res)` 保持该归类。

## 全局约束

- **文案规则（grill Q7/Q15 逐字定稿，见任务内引用块，不得改写）**：工具渲染文本为中文模型指令体；GUI toast 走 i18n 双字典（键 `notify.buildApprovalPending` + 动词键 `notify.verb.upgrade`/`notify.verb.install`）。
- **测试导入约定**：`src/core/*.ts`、`src/tools.ts` 测试从 `lib/` 引入；**单文件跑测前必须 `npm run build`**。
- **退出码卫生**：过滤管道一律 `set -o pipefail`；计数 0 判据用 `! grep -q` 或 `test "$(…)" = 0`，不用 `grep -c | wc -l` 裸链。
- **源锚纪律**（CODING-STANDARDS）：中文文案锚走源结构锚（grep `src/**` 或 `src.split(needle)` 计数），禁 bundle 中文锚；工作树 CRLF，源串锚禁含 `\n`。
- **npm 缓存前置**：联网 npm 调用（release/install/view）一律前缀 `npm_config_cache=$HOME/workspace/.npm-ci-cache`。
- **发版纪律**：只走 `npm run release`（lock 三处由脚本同步）；门禁 `npm run check-release`；不手动打 tag。
- **命令环境**：bash / Linux 本机（`/home/ubuntu/workspace/dsh-m`）；预计超 90 秒的命令 `run_in_background`。
- 无额外版本/依赖约束。

## 冻结面与断言清点（锚已当场复核 2026-11-03）

**改动不触碰的既有钉子**（执行后逐条核对仍绿）：

| 冻结面 | 钉住它的断言 | 与本次改动的关系 |
|---|---|---|
| upgrade 成功臂三态文案 | `tests/tools-upgrade-message.test.mjs` 4 it（client-only :13 / unknown :20 / restart-required+字段缺席 :26 / guard 回归 :33；:15 ✅ 正则是 it① 内断言非独立 it——评审 I4） | 新臂提前 return，成功臂逐字节不动 |
| install/upgrade guard 臂 | `tests/tools-install.test.mjs` 守卫 describe（「守卫拦截」「不含 ✅」等） | guard 臂零触碰 |
| core 未遂行为 | `tests/profile-ops.test.mjs:135-164`（不抛、记 failed、approvedBuilds 原样透传） | core 零改动 |
| 批量三态 | `tests/client-installed-updates.test.mjs` classifyBatchOutcome 矩阵 | 零触碰 |
| op-outcome 既有五类投影 | `tests/client-op-outcome.test.mjs` 手写字面量矩阵 | 只增新方法，不改既有 |
| web 路径行为 | market-mutation 全部既有测试 | web 分支零改动（approvedBuilds 不透传给 installFromRegistry/upgradePlugin） |

**文案改动断言面**（grep tests/ 零命中，当场复核）：`:535` 过期句（「structured refusals」「read-only market」）零钉扎；两工具 description 零钉扎；renderInstall 成功臂零断言；renderToggle/renderUninstall 零渲染测试（本次不涉）；presentResult 无直接钉断言（经 render + 结构化字段覆盖，沿用 tools-install.test.mjs:68-71 注释口径）。

## 输入工件

- issue #41（snoonk，2026-11-02）：现象、根因两层、期望稿、手动绕过附录
- grill 共识（2026-11-03 会话，Q1–Q16 全按推荐锁定）
- 七节代码事实普查（2026-11-03 子代理报告 + 本会话逐锚复核）
- `docs/adr/0002-precise-build-approval.md`（精确放行治理）
- `docs/CODING-STANDARDS.md`（测试锚、证据、评审检查单）
- 独立评审（2026-11-03，五轮 + 终局）：I1–I8 全闭合，结论「可进入执行」；台账 `.dsh-research/issue41-review-scratch/ledger.md`
- **范围事实（主人 2026-11-03 指示）**：评审计划外建议①（`WRITE_GUIDANCE.upgrade` 过期文案，同族不同文件）并入本役 → Task 7b。评审同族发现 uninstall / self-upgrade 两条亦过期，**不在获批范围**，收尾时上报主人另断。

## 文件结构与职责

- Modify: `src/tools.ts` —— `InstallOut` 补字段（:561-583）；`renderUpgrade`（:702-724）/`renderInstall`（:646-668）各加 needsBuildApproval 专臂 + `ok===false` catch-all 臂；两 `presentResult`（:297-301/:467-471）加专臂 + 失败兜底；两工具 schema 加 `approvedBuilds`、description 补重试闭环句；desktop execute 分支透传（:312/:480）；systemPrompt 段（:528-536）加重试句 + 改写 `:535`
- Modify: `src/client/op-outcome.js` —— 新增 `buildBlockedText(res, verbKey)` 工厂方法（lookup 在工厂闭包内，键名直接量落审计面）
- Modify: `src/client/upgrade-flow.js` —— `performUpgradeFlow` runOp 之后、degraded 判定之前加未遂分支（notify warn + noteSink + refresh + `return classifyBatchOutcome(res)`）
- Modify: `src/client/market-tab.jsx` —— `installResultText`（:141-146）加未遂分支返回未遂文案；`installDone`（:147-152）加未遂分支（kind 'warn'、needsRestart 不走 restartBannerDecision）
- Modify: `src/client/i18n.js` —— ZH/EN 各加 3 键（zh 区 :95/:109 附近，en 区 :225/:239 附近）
- Modify: `src/core/active-profile.ts` —— `WRITE_GUIDANCE.upgrade`（:65）过期文案更正（Task 7b，主人范围事实）
- Test: `tests/active-profile.test.mjs` —— deepEqual 内联快照 :262 同步改写 + 新增出口断言（Task 7b）
- Test: `tests/tools-upgrade-message.test.mjs` —— 新 describe「renderUpgrade × needsBuildApproval 未遂（issue #41）」
- Test: `tests/tools-install.test.mjs` —— 新 describe「issue #41 desktop 未遂」（自带夹具：registerTools 第四参注入 desktop profile + deps.desktopInstall/desktopUpgrade 桩，tools.ts:109-113）
- Test: `tests/client-op-outcome.test.mjs` —— 新 describe（假 lookup 形态断言 buildBlockedText）
- Test: `tests/client-upgrade-flow.test.mjs` —— 新 it（未遂 res → notify warn + 返回 'target'）
- Modify: `docs/adr/0002-precise-build-approval.md` —— 追加「0.12.2 工具层接线」一节
- Modify: `GLOSSARY.md` —— 补 5 词条（稿见 Task 8）
- Modify: `CHANGELOG.md` —— 0.12.2 双语顶条
- Modify: `package.json`（version → 0.12.2；lock 由 release 脚本同步）
- 边界：`src/core/profile-ops.ts`、`src/core/host-api.ts`、`src/client/installed-updates.js`、`src/client/installed-tab.jsx` **零改动**（core 通道已通、批量语义不动、host-api 不加参）

## 任务清单

### Task 0: 计划文档入库

- 目标：计划先行入库，后续提交不混入（先例 `acb5464`/`0d3747f`）。
- 涉及文件：本计划文件。
- Run: `cd /home/ubuntu/workspace/dsh-m && git add docs/plans/2026-11-03-issue41-build-approval-honest-render-implementation-plan.md && git commit -m "docs(plans): issue #41 构建审批未遂诚实渲染实施计划（grill Q1-Q16 共识）" && git status --porcelain`
- Expected: 提交成功，porcelain 为空。
- 验证范围：`git log --oneline -1` 显示计划提交。

### Task 1: 红测试——渲染臂与工具接线（TDD 失败先行）

- 目标：为全部新行为写失败测试并确认当前红。
- 涉及文件：`tests/tools-upgrade-message.test.mjs`、`tests/tools-install.test.mjs`。
- 接口契约
  - Consumes: `lib/tools.js` 的 `renderUpgrade`（已存在）；`registerTools(ctx, cfg, deps, profile)`（tools.ts:109-113，profile 第四参缺省 `resolveActiveProfile(ctx)`，测试显式注入 `{ kind: 'desktop', name: 'desktop', dir: <tmp 路径> }`）。
  - Produces: Task 2/3 的绿判据；断言锚清单（见各 it）。
- 验证范围：两文件新 describe 全红（渲染臂不存在、schema 无 approvedBuilds、execute 不透传）。

- [ ] Step 1: `tests/tools-upgrade-message.test.mjs` 追加 describe（自带局部 fixture，不引用兄弟 describe 闭包）：

```js
const blocked = { ok: false, needsBuildApproval: true, id: 'dsh-x', pkg: 'plug-a', spec: 'plug-a@1.2.3', pendingBuilds: ['plug-a@1.2.3', 'esbuild-dep'], message: '该插件需要执行构建脚本（plug-a@1.2.3）。确认后带同样的包名名单重试（approvedBuilds）；dsh-m 不做全量放行（ADR-0002 同语义）' }
```

  it ①：`renderUpgrade(blocked)` 断言——`match /^⛔ 升级未完成：需要批准构建脚本/`；含 `待批准：`；逐行含 `- plug-a@1.2.3` 与 `- esbuild-dep`；含 `目标版本：plug-a@1.2.3（未安装）`；含 `approvedBuilds 重试本工具`；含 `官方 Settings → Plugins`；含 `当前版本未变更`；`doesNotMatch /^✅/`；负向断言为**成功臂尾巴句式** `!text.includes('需要重启生效') && !text.includes('询问是否 dshm_restart')`（执行期修正：Q7 定稿文案末句「不要询问 dshm_restart」自身含该词，裸 `!includes('dshm_restart')` 与已批准文案互斥；断言钉的是「询问是否 dshm_restart」这一成功臂尾巴句式，二者不冲突）。
  it ②：catch-all——`renderUpgrade({ ok: false, message: '未知形态' })` 断言含 `⛔ 操作未完成` 与 `不要对用户宣称成功`，`doesNotMatch /^✅/`。
  it ③：guard 臂先行回归——`renderUpgrade({ ok:false, guard:true, needsBuildApproval:true, message:'m', compensation:{status:'rolled-back',note:'n'} })` 仍走 guard 文案（含 `守卫拦截`，不含 `需要批准构建脚本`），钉住专臂优先序。

- [ ] Step 2: `tests/tools-install.test.mjs` 追加 describe「issue #41 desktop 未遂」（自带夹具）：

```js
async function registerDesktopWith(stubs = {}) {
  const { registerTools } = await import('../lib/tools.js')
  const registered = []
  const ctx = { tools: { register: (t) => registered.push(t) }, inject: () => {} }
  registerTools(ctx, { timeoutMs: 50 }, {
    desktopInstall: stubs.install ?? (async () => ({ ok: false, needsBuildApproval: true, id: 'dsh-x', pkg: 'plug-a', spec: 'plug-a@1.2.3', pendingBuilds: ['plug-a@1.2.3'], message: '该插件需要执行构建脚本（plug-a@1.2.3）。确认后带同样的包名名单重试（approvedBuilds）；dsh-m 不做全量放行（ADR-0002 同语义）' })),
    desktopUpgrade: stubs.upgrade ?? (async () => ({ ok: false, needsBuildApproval: true, id: 'dsh-x', pkg: 'plug-a', spec: 'plug-a@1.2.3', pendingBuilds: ['plug-a@1.2.3'], message: '该插件需要执行构建脚本（plug-a@1.2.3）。确认后带同样的包名名单重试（approvedBuilds）；dsh-m 不做全量放行（ADR-0002 同语义）' })),
  }, { kind: 'desktop', name: 'desktop', dir: '/tmp/dsh-m-test-profile' })
  return registered
}
```

（夹具形态对照生产调用点：tools.ts:312/:480 desktop 分支顶层 opts，不多注内层。）

  it ④：`dshm_upgrade.execute({ pkg: 'plug-a' })` → `output.render` 文本过 it ① 同款锚（⛔ 开头、不含 ✅、不含 dshm_restart）。
  it ⑤：`dshm_install.execute({ id: 'plug-a' })` → render 文本断言 `/^⛔ 安装未完成：需要批准构建脚本/`、含 `未安装任何新版本`、`doesNotMatch /^✅/`、`!text.includes('dshm_restart')`（未遂无重启尾巴，与 it ① 对称）。
  it ⑥：schema——两工具 `parameters.approvedBuilds` 存在且 `type === 'array'`。
  it ⑦：透传与零漂移——`dshm_upgrade.execute({ pkg: 'plug-a', approvedBuilds: ['plug-a@1.2.3'] })` → 桩收到的**第三参**（opts，桩签名 `(target, cfg, opts, deps)`，对照 tools.ts:480 生产调用形态）`approvedBuilds` deepEqual `['plug-a@1.2.3']`；不带参调用 → opts 无 `approvedBuilds` 键（`!('approvedBuilds' in opts)`）；`approvedBuilds: []`（空数组）→ 同样无该键（与 core :515 `length > 0` 门语义对齐）。

- [ ] Step 3: 跑红
- Run: `cd /home/ubuntu/workspace/dsh-m && set -o pipefail; npm run build 2>&1 | tail -3 && node --test tests/tools-upgrade-message.test.mjs tests/tools-install.test.mjs 2>&1 | tail -15`
- Expected: 新 describe 全部 fail（it①-⑦ 红；既有 4+守卫 it 仍绿）；整体退出码非 0 属预期。

### Task 2: tools.ts 渲染层实现

- 目标：`InstallOut` 补字段；两 render 加专臂 + catch-all；使 Task 1 it①②③④⑤ 绿。
- 涉及文件：`src/tools.ts`。
- 接口契约
  - Consumes: 未遂结果字段 `ok/needsBuildApproval/pendingBuilds/spec/message`（profile-ops.ts:340/:1183 产出形态）。
  - Produces: `InstallOut` 新可选字段 `ok?: boolean; needsBuildApproval?: boolean; pendingBuilds?: string[]`；渲染文本锚（Task 6 变异验证对象）。
- 验证范围：Task 1 两文件绿；源结构锚计数。

- [ ] Step 1: `InstallOut`（tools.ts:561-583）追加三字段（带注释「issue #41：desktop 未遂形态」）。
- [ ] Step 2: `renderUpgrade` 在 guard 臂（:705-713）后插入：

```
⛔ 升级未完成：需要批准构建脚本
待批准：
  - {pendingBuilds 逐行，官方原样名单}
原因：{out.message}
处理方式（按序尝试）：
  1. 征得用户确认后，把上面的名单原样作为 approvedBuilds 重试本工具
  2. 用户在官方 Settings → Plugins 里重试（管理器会写 allowBuilds）
目标版本：{spec}（未安装）
当前版本未变更。不要对用户说「已升级」，不要询问 dshm_restart。
```

实现为 `[...].filter(Boolean).join('\n')`；`pendingBuilds` 行为 `(out.pendingBuilds ?? []).map((b) => \`  - ${b}\`)`。
- [ ] Step 3: catch-all 臂（专臂之后、成功臂 :714 之前）：`if (out.ok === false) return \`⛔ 操作未完成：${out.message ?? ''}\n状态未变更。不要对用户宣称成功。\``
- [ ] Step 4: `renderInstall`（:646-668）同构插入（guard 臂 :654 之后）：

```
⛔ 安装未完成：需要批准构建脚本
待批准：
  - {pendingBuilds 逐行}
原因：{out.message}
处理方式（按序尝试）：
  1. 征得用户确认后，把上面的名单原样作为 approvedBuilds 重试本工具
  2. 用户在官方 Settings → Plugins 里重试（管理器会写 allowBuilds）
未安装任何新版本。不要对用户说「已安装」，不要询问 dshm_restart。
```

catch-all 同 Step 3 文案。
- [ ] Step 5: 跑绿 + 源锚计数
- Run: `set -o pipefail; npm run build 2>&1 | tail -3 && node --test tests/tools-upgrade-message.test.mjs tests/tools-install.test.mjs 2>&1 | tail -6 && node -e "const s=require('fs').readFileSync('src/tools.ts','utf8');for(const n of ['⛔ 升级未完成','⛔ 安装未完成','⛔ 操作未完成'])console.log(n, s.split(n).length-1)"`
- Expected: 两文件 exit 0；三个锚计数各 ≥1（升级/安装）/≥2（操作未完成，两 render 各一）。

### Task 3: schema / execute / presentResult / description 接线

- 目标：使 Task 1 it⑥⑦ 绿；卡片分流；描述句闭环。
- 涉及文件：`src/tools.ts`（:285-290、:297-301、:303-313、:454-471、:473-481）。
- 接口契约
  - Consumes: Task 2 的 `InstallOut` 新字段；core `DesktopInstallOptions.approvedBuilds`（profile-ops.ts:119）/`DesktopUpgradeOptions.approvedBuilds`（:839）。
  - Produces: 工具层 approvedBuilds 通道（发版后供模型闭环使用）。
- 验证范围：Task 1 全绿；typecheck。

- [ ] Step 1: 两工具 `parameters` 各加 `approvedBuilds: { type: 'array', items: { type: 'string' }, description: '上次 needsBuildApproval 返回的 pendingBuilds 原样回传；仅 desktop 委派路径消费，须用户确认后重试用。' }`
- [ ] Step 2: `dshm_install` execute desktop 分支（:312）与 `dshm_upgrade` execute desktop 分支（:480）的 opts 各改为**条件展开**（评审 I1：显式键即使值 undefined 也使 `'approvedBuilds' in opts` 为 true，会击穿 it ⑦ 零漂移断言；评审 Batch 2 另注：与 core :515 语义对齐——**空数组视为缺省**）：`...(Array.isArray(args.approvedBuilds) && args.approvedBuilds.length > 0 ? { approvedBuilds: args.approvedBuilds.map(String) } : {})`（web 分支不透传）。
- [ ] Step 3: 两 `presentResult` 改为：guard 臂不动 → 新增 `if (out?.needsBuildApproval === true) return { card: 'generic', title: \`未完成 · 需要批准构建脚本 · ${out?.pkg || ''}\`, content: [] }` → `if (isError || out?.ok === false) return { card: 'generic', title: isError ? '升级失败' : '升级失败', content: [] }` 简写收敛为 `title: '升级失败'`（install 侧同理『安装失败』）→ 现成功臂兜底。
- [ ] Step 4: 两工具 description 追加一句：`needsBuildApproval 是未遂不是成功：征得用户确认后把 pendingBuilds 原样作为 approvedBuilds 重试；不得对用户宣称已升级/已安装。`
- [ ] Step 5: 跑绿 + typecheck
- Run: `set -o pipefail; npm run typecheck 2>&1 | tail -3 && npm run build 2>&1 | tail -2 && node --test tests/tools-upgrade-message.test.mjs tests/tools-install.test.mjs 2>&1 | tail -4`
- Expected: typecheck exit 0（`InstallOut` 字段与 args 读取类型闭合）；两文件 exit 0（Task 1 it①-⑦ 全绿）。

### Task 4: systemPrompt 段（重试句 + 过期句更正）

- 目标：指引块补闭环防线（grill Q9）+ 更正 desktop 能力过期句（grill Q10）。
- 涉及文件：`src/tools.ts`（:528-536）。
- 接口契约
  - Consumes: Task 3 的工具入参语义。
  - Produces: systemPrompt 单源句（改写与新增各一处）。
- 验证范围：build + 源锚计数 + 既有测试不红。

- [ ] Step 1: `:535` 句整体替换为：`dsh-m operates on the current host profile (web or desktop, per ping.profile): on desktop install/upgrade/uninstall/self-upgrade/toggle all work via the official plugin manager; only restart is refused with guidance — relay it instead of retrying.`
- [ ] Step 2: 段内追加一句（:532 upgrade 句之后）：`A needsBuildApproval result is an abort, not success: after the user confirms, retry dshm_install/dshm_upgrade with approvedBuilds echoing the returned pendingBuilds verbatim; never claim the upgrade or install succeeded.`
- [ ] Step 3: 跑绿
- Run: `set -o pipefail; npm run build 2>&1 | tail -2 && node --test tests/tools-install.test.mjs 2>&1 | tail -3 && node -e "const s=require('fs').readFileSync('src/tools.ts','utf8');console.log('retry sentence', s.split('an abort, not success').length-1);console.log('desktop fix', s.split('only restart is refused').length-1)"`
- Expected: exit 0；两锚计数各 1；测试绿。

### Task 5: client 未遂文案（op-outcome / upgrade-flow / market-tab / i18n）

- 目标：GUI toast 诚实分流（grill Q14/Q15 决议）。
- 涉及文件：`src/client/op-outcome.js`、`src/client/upgrade-flow.js`、`src/client/market-tab.jsx`、`src/client/i18n.js`、`tests/client-op-outcome.test.mjs`、`tests/client-upgrade-flow.test.mjs`。
- 接口契约
  - Consumes: `createOpOutcome(lookup)` 工厂形态（client-op-outcome.test.mjs 假 lookup 契约 `key{a=v,b=v}`）；`lookup(key, params)` 插值（i18n.js:273）。
  - Produces: `oc.buildBlockedText(res, verbKey)`（返回 string）；i18n 3 键。
- 验证范围：client 三测试文件绿 + i18n 键守卫绿 + 渲染冒烟绿。

- [ ] Step 1（红）：`tests/client-op-outcome.test.mjs` 新 describe：假 lookup 下 `oc.buildBlockedText({ pkg: 'plug-a' }, 'notify.verb.upgrade')` 逐字等于 `notify.buildApprovalPending{verb=notify.verb.upgrade,pkg=plug-a}`；`notify.verb.install` 同理。`tests/client-upgrade-flow.test.mjs` 新 it：`apiCall` 桩 resolve `{ ok:false, needsBuildApproval:true, pkg:'plug-a' }` → notify 收到 `{ kind:'warn' }` 且 `needsRestart` 不为 true、返回值 === `'target'`（消费 `classifyBatchOutcome(res)`）。**另补 `tests/client-i18n.test.mjs` 新 it（评审 I6——动词键是动态 `lookup(verbKey)` 消费、不在直接量审计面，且 upgrade-flow.js 不在 auditTargets；lookup 缺键静默回退裸键名，0.10.4 事故形态）：断言 ZH/EN 两字典均含 `notify.buildApprovalPending`、`notify.verb.upgrade`、`notify.verb.install` 三键（`in` 断言 ×6）。**先跑确认红——
  Run: `set -o pipefail; npm run build 2>&1 | tail -2 && node --test tests/client-op-outcome.test.mjs tests/client-upgrade-flow.test.mjs tests/client-i18n.test.mjs 2>&1 | tail -6`
  Expected: 新 it 全红（buildBlockedText 不存在 / 分支缺失，notify 未收到 warn / i18n 三键不在场）；既有矩阵用例仍绿。
- [ ] Step 2（实现）：`op-outcome.js` 工厂内加：

```js
/** needsBuildApproval 未遂文案（issue #41）：单一共享键；verbKey 指向本地化动词键。 */
const buildBlockedText = (res, verbKey) =>
  lookup('notify.buildApprovalPending', { verb: lookup(verbKey), pkg: res?.pkg || '' })
```

导出加入工厂返回对象。`upgrade-flow.js` 在 runOp 之后、`degraded` 判定之前加：

```js
if (res && res.needsBuildApproval === true) {
  const text = oc.buildBlockedText(res, 'notify.verb.upgrade')
  notify({ kind: 'warn', needsRestart: false, text })
  noteSink?.({ kind: 'warn', text })
  await (refresh ? refresh() : undefined)
  return classifyBatchOutcome(res)
}
```

`market-tab.jsx`：`installResultText` 顶部加 `if (res && res.needsBuildApproval === true) return oc.buildBlockedText(res, "notify.verb.install");`；`installDone` 顶部加同判分支——`notify({ kind: "warn", needsRestart: false, text: <同文案> })` + `setInstallNote({ id: it2.id, kind: "warn", text: <同文案> })`（文案算一次存局部变量，两处同引用）。
- [ ] Step 3（i18n）：ZH/EN 各加 3 键——
  - zh：`"notify.buildApprovalPending": "{verb}未完成：{pkg} 需要批准构建脚本。可在官方 Settings → Plugins 重试，或让助手处理。"`、`"notify.verb.upgrade": "升级"`、`"notify.verb.install": "安装"`（放 :109 notify.upgraded 同族区）
  - en：`"notify.buildApprovalPending": "{verb} incomplete: {pkg} needs build-script approval. Retry in official Settings → Plugins, or ask the assistant."`、`"notify.verb.upgrade": "Upgrade"`、`"notify.verb.install": "Install"`（:239 同族区）
- [ ] Step 4（绿）：跑 client 面
- Run: `set -o pipefail; npm run build 2>&1 | tail -2 && node --test tests/client-op-outcome.test.mjs tests/client-op-outcome-anchor.test.mjs tests/client-upgrade-flow.test.mjs tests/client-installed-updates.test.mjs tests/client-i18n.test.mjs tests/client-render-smoke.test.mjs 2>&1 | tail -6`
- Expected: exit 0（新分支 it 绿、i18n 键守卫绿、渲染冒烟绿、既有矩阵不动绿）。

### Task 6: 关键接线锚变异验证（评审检查单强制项）

- 目标：证明新臂锚是活的防线，不是永真断言。
- 涉及文件：无净变更（变异→恢复）。
- 接口契约
  - Consumes: Task 2 的 `out.needsBuildApproval === true` 臂条件（renderUpgrade）与 Task 5 的 upgrade-flow 分支条件。
  - Produces: 变异红/恢复绿的留证输出（贴 PR 描述）。
- 验证范围：单点变异红 → 恢复绿，两轮。

- [ ] Step 1: 临时把 renderUpgrade 专臂条件改为 `!== true`，**先 `npm run build` 再**跑 `node --test tests/tools-upgrade-message.test.mjs` → it① 必红（评审 I7：该测试从 lib/tools.js 导入，变异后不重建 = 跑旧产物，变异不可见 → 假绿误判锚永真）。
- [ ] Step 2: 恢复为 `=== true`，重建后同命令 → 绿。upgrade-flow 分支同法：改 `=== true` 为 `!== true` → 测试红 → 恢复 → 测试绿（该测试直引 src/，无需 build）。
- Run: 见上两步内联命令（tools 半边：变异 → `npm run build` → 测试红 → 恢复 → `npm run build` → 测试绿）；最终 `git diff --stat` 确认零残留。
- Expected: 两处变异各自红、恢复各自绿；`git status --porcelain` 仅含本役预期改动。

### Task 7: 全量验证

- 目标：全量回归 + 类型门禁。
- Run: `set -o pipefail; npm test 2>&1 | tail -8 && npm run typecheck 2>&1 | tail -3`
- Expected: 双 exit 0。若有环境既有失败（know-how 028 清单），跑 `node scripts/test-baseline.mjs` 按名对照区分，不手搓管道。
- 验证范围：全量绿 = 实现收口。

### Task 7b: WRITE_GUIDANCE.upgrade 过期文案更正（主人范围事实，2026-11-03）

- 目标：desktop 市场自 0.9.8 起已支持升级（DESKTOP_ALLOWED 含 upgrade，官方管理器覆盖安装），`:65` 的「Desktop 暂不支持在市场内升级插件」与委派现实不符——与 systemPrompt `:535` 同族的镜像过期。该文案经 `assertWriteAllowed` → `ProfileUnsupportedError.guidance` 供 GUI/工具/HTTP 三入口共用。
- 涉及文件：`src/core/active-profile.ts`、`tests/active-profile.test.mjs`。
- 接口契约
  - Consumes: deepEqual 内联快照（tests/active-profile.test.mjs:259-266，全对象逐字钉扎——改值必同步）；出口检查 describe（:247，断言含 `Settings → Plugins`，新文案满足）。
  - Produces: 新文案 `'请在官方宿主的插件管理界面（Settings → Plugins）检查更新并升级；或把 dsh-m 安装到 web / desktop profile 后在市场内升级。'`（镜像 install 条家族结构，删除失实断言，保留官方页出口）。
- 验证范围：deepEqual 同步绿 + 出口断言扩到 upgrade + 全量回归（并入 Task 8 前跑一次单文件）。
- 边界：**仅 upgrade 条**。ADR-0030「六条 desktop 指引逐字冻结」为局部修订，代码注释同步注记；uninstall / self-upgrade 同族过期不在获批范围（收尾上报）。CLI 门禁文案与 WRITE_GUIDANCE_UNKNOWN 零触碰。

- [ ] Step 1（红）：`tests/active-profile.test.mjs` 改两处——deepEqual 的 upgrade 值改为新文案；出口 describe 的 action 循环从 `['install', 'set-enabled']` 扩为 `['install', 'set-enabled', 'upgrade']`。跑 `npm run build && node --test tests/active-profile.test.mjs` → 出口 it 红（现文案不含新出口语义断言时）或 deepEqual 绿前置于实现（此处红确认以「实现未改时 deepEqual 必红」为准：先只改 deepEqual → 红；再改实现 → 绿）。
- [ ] Step 2（实现）：active-profile.ts `:65` 换新文案；`:72-75` 注释「既有六条 desktop 指引逐字冻结不动」句尾追加「（0.12.2 局部修订：upgrade 条过期更正，issue #41 配套）」。
- Run: `set -o pipefail; npm run build 2>&1 | tail -2 && node --test tests/active-profile.test.mjs 2>&1 | tail -4`
- Expected: exit 0；`grep -c "暂不支持在市场内升级" src/core/active-profile.ts tests/active-profile.test.mjs` 双 0（退出码卫生：计数 0 用 `! grep -q` 形态核验）。

### Task 8: 文档件（ADR / GLOSSARY / CHANGELOG）

- 目标：决策与术语落盘。
- 涉及文件：`docs/adr/0002-precise-build-approval.md`、`GLOSSARY.md`、`CHANGELOG.md`。
- 接口契约
  - Consumes: 本计划「架构快照」决策（Q1-Q16）。
  - Produces: 发版提交内的文档变更。
- 验证范围：`npm test` 不涉（纯 md）；`grep` 锚计数。

- [ ] Step 1: ADR-0002 文末追加「## 0.12.2 工具层接线（issue #41）」：重试通道从 core 透传延伸到 `dshm_install`/`dshm_upgrade` 工具入参 `approvedBuilds`（原样回传语义）；信任模型不变（精确名单 + 用户确认，与 `force` 同级）；不带回显校验的理由（journal `ExternalOperationRecord` 白名单无 pendingBuilds，无结构化状态可比对）；渲染层确立「`ok:false` 永不渲染 ✅」不变量。
- [ ] Step 2: GLOSSARY 补 5 词条（领域语义、零实现细节）：**结构化未遂（needsBuildApproval）**——desktop 安装/升级被构建脚本闸门拦下时的结构化回包：明示未完成而非失败或成功，携带待批准名单，等待确认后的精确放行重试；**pendingBuilds**——官方管理器报出的待批准构建脚本名单，放行决策的对象；**approvedBuilds**——用户确认后原样回传给重试的放行名单，与 pendingBuilds 同名单回显；**build-blocked**——官方变更结果中「构建脚本被拦」的分类码，结构化未遂的触发源；**精确放行**——逐条目写 allowBuilds 的放行方式，对照已废弃的全量放行。
- [ ] Step 3: CHANGELOG 双语顶条——ZH/EN 两区块**各自顶部**同位插入 `### 0.12.2`（同 token 同位，满足 #42 retro 新增的 `check-release.mjs` 双语近 10 条标题配对门禁，commit 2907451）：修复（desktop needsBuildApproval 假成功——工具渲染/卡片/GUI toast 三面分流为「未完成」；WRITE_GUIDANCE.upgrade 过期指引更正）；新增（dshm_install/dshm_upgrade `approvedBuilds` 入参打通确认重试闭环；systemPrompt desktop 能力句更正）；兼容性说明（新入参可选、向后兼容；成功路径文案逐字节不变）。
- Run: `set -o pipefail; grep -c "0.12.2 工具层接线" docs/adr/0002-precise-build-approval.md && node -e "const s=require('fs').readFileSync('GLOSSARY.md','utf8');console.log(s.split('结构化未遂').length-1)" && test "$(grep -c '^### 0.12.2' CHANGELOG.md)" -ge 2 && echo CHANGELOG_PAIR_OK`
- Expected: 前两计数各 ≥1；`### 0.12.2` 计数 ≥2（zh/en 双区块）且 echo 达成（退出码卫生：`test -ge` 形态，grep -c 不直接入 && 链）。
- [ ] Step 4（评审 I8）：version bump——`package.json` `version` 0.12.1 → 0.12.2（lock 两处由 release 脚本首步同步，不手改）。
  Run: `node -p "require('./package.json').version"`
  Expected: `0.12.2`。
- [ ] Step 5（评审 I8）：两笔提交，使 release 前树干净、版本就位（release.mjs:6 人工前置 + :47 干净树检查）——
  Run: `git add src/ tests/ && git commit -m "fix(tools+client): needsBuildApproval 结构化未遂诚实渲染（工具 render/卡片/GUI toast）+ dshm_install/upgrade approvedBuilds 入参（issue #41）" && git add -A && git commit -m "docs(adr+glossary+changelog): ADR-0002 工具层接线节 + GLOSSARY 五词条 + CHANGELOG 0.12.2 双语 + version bump（issue #41）" && git status --porcelain`
  Expected: 修复提交（Task 1-7 文件：src/ + tests/）与文档提交（Task 8 文件：docs/ + GLOSSARY.md + CHANGELOG.md + package.json）先后落库；porcelain 输出为空。

### Task 9: 发版与收尾（⛔ 不可逆公开动作——当轮单独批准门）

- 目标：0.12.2 上架 + issue #41 回评关闭 + 实机复验交接。
- **硬门禁（dsh-m/AGENTS.md 发版纪律，2026-11-02 #42 战役实录）**：`npm run release`（push/tag/publish）与 issue 关闭属不可逆公开动作，「批准开工」**不默认涵盖**本任务——执行到本任务前停下，获主人**当轮明确批准**后再继续；回评文案先行送审。
- 涉及文件：`package.json`（release 脚本同步 lock）。
- 接口契约
  - Consumes: Task 7 全量绿、Task 8 文档齐、主人当轮批准。
  - Produces: npm 0.12.2 发布提交与 tag；issue #41 关闭回评。
- 验证范围：check-release 门禁绿；npm 上架轮询（agent-ops「发版与 npm 轮询」）。

- [ ] Step 1: `npm_config_cache=$HOME/workspace/.npm-ci-cache npm run release`（超 90 秒，`run_in_background` 起跑；bump 与两笔提交已由 Task 8 Step 4/5 完成，release 首步同步 lock 并纳入发版提交）。
- [ ] Step 2: `npm_config_cache=$HOME/workspace/.npm-ci-cache npm run check-release` → exit 0。
- [ ] Step 3: 回评 issue #41（`gh api repos/iasiv5/dsh-m/issues/41/comments`）：修复版本 0.12.2、三层分流 + approvedBuilds 通道摘要、致谢报告者手动绕过附录的交叉验证价值；关闭 issue。
- [ ] Step 4: desktop 实机复验清单（**handoff，报告者/主人执行，不进本计划自动面**）：①升级一个新增构建脚本的插件 → 工具文本应为「⛔ 升级未完成」（不再 ✅）；②带 `approvedBuilds`（原样名单）重试 → 成功且含放行注记；③GUI 面板手动升级同插件 → toast 为 warn 未完成；④desktop 上 `dshm_restart` 仍被结构化拒绝（:535 改写后语义）。

## 行为零变化承诺（CODING-STANDARDS 必填格）

| 面 | 缺省态/无记忆态口径 | 验收方式 |
|---|---|---|
| web install/upgrade 全路径 | 文案与行为逐字节不变；`approvedBuilds` 不透传给 web 事务 | 既有 market-mutation / tools-install 守卫用例全绿 |
| desktop 成功路径 | 渲染成功臂逐字节不动 | tools-upgrade-message 既有 4 it 绿 |
| 非 needsBuildApproval 的 `ok:false`（web guard） | guard 专臂先行，文案不动 | tools-install 守卫用例 + Task 1 it③ |
| 新入参缺省 | schema 可选；不传 → opts 无该键（core :515 条件展开） | Task 1 it⑦ 零漂移臂 |
| GUI 非 blocked toast | 逐字节不变；批量汇总计数不动 | client-op-outcome 矩阵 + client-installed-updates 绿 |
| 重启提示 | 未遂臂不含任何 dshm_restart 尾巴 | Task 1 it①⑤ 负向断言 |

## 执行纪律

- 开始实现前批判性复查本计划；发现缺项/矛盾/与现实不符，先修计划再动手，不猜。
- 按任务顺序执行，不无声跳步、合并步或改变任务目标；每任务完成即跑其验证。
- **Task 9 双门**：开工批准不涵盖发版与关闭 issue——到 Task 9 前停下等主人当轮明确批准（含回评文案送审）。
- 卡住或重复失败立即停下说明。
- 当前若在 `main`，确认用户已同意直接在 main 实施（grill 会话未另开分支，默认按仓库惯例 main 直做）。
- 全部完成后运行最终验证并输出修改摘要。

## 最终验证

`set -o pipefail; npm test 2>&1 | tail -8 && npm run typecheck 2>&1 | tail -3 && npm run check-release 2>&1 | tail -3`

三条 exit 0；`git log --oneline` 可见：计划入库 → 修复提交 → 文档提交 → release 提交。

<!-- checkpoint：计划审阅。批准前不进入 Task 0。 -->
