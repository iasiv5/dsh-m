# 壳接管哨兵退役实施计划——市场入口恒在场，判定降级诊断（issue #33）

- 日期：2026-10-30
- 仓库：`/home/ubuntu/workspace/dsh-m`（分支 main 直改——本仓既有惯例，见 `docs/plans/2026-10-27-community-displaced-entries-implementation-plan.md` 头注同款）
- 设计来源：2026-10-30 grill-with-docs 共识（决议 Q1–Q10 全 settle，对话即设计来源）；本计划 T4/T5 产出 spec 设计文档与 ADR-0027
- 版本编排：0.11.1 hotfix（0.11.0 已于 2026-10-29 发布，npm latest 实证）
- 纪律基线：`docs/CODING-STANDARDS.md` 全条适用（源锚单行无 `\n`、量化断言出现次数语义、关键接线锚变异红绿留证、退出码卫生、既有失败用 `scripts/test-baseline.mjs` 判别）

## 目标

1. `MarketEntry` 删除 `shellTakeover()` 渲染门控——市场入口在一切壳形态下恒在场（修复 issue #33 better-workspace 误伤，同时解除 ds-bot 0.2.4 Bot 模式的潜伏误伤）；
2. 哨兵判定降级为诊断信号：检测到接管环境时 `console.info` 至多一条提示；
3. 分档机制整体退役：`COOPERATIVE_SHELL_LOCALES` 删除，`isNativeFootShell` 收敛改名 `hasShellTakeover`（只判「负 priority 占位者存在」，locale 不再参与判定）；
4. 文档落盘：spec 设计文档、ADR-0027、CHANGELOG 0.11.1 双语条目、issue #33 回复草稿（GLOSSARY「壳接管」词条已于 2026-10-30 前置落盘，本计划只验证）；
5. 全量测试绿 + typecheck 0。

## 架构快照

**现状链路**（符号锚，行号为 2026-10-30 时点参考）：

- `src/client/main.jsx:37`：`const { isNativeFootShell } = require("./shell-takeover.js");`（CJS require × ESM 导出，esbuild 互操作，既有形态）
- `main.jsx` 「壳接管哨兵」注释块 → `let dshmSlotsRef = null;`（在 slot 接线处赋值）→ `const shellTakeover = () => { try { return isNativeFootShell(dshmSlotsRef…entries("sidebar.workspaces")) } catch { return false } }`
- `main.jsx` `function MarketEntry(props)` 首两行：`useEffect(() => ensureCss(), []);` + `if (shellTakeover()) return null;`
- `src/client/shell-takeover.js`：`export const COOPERATIVE_SHELL_LOCALES` + `export function isNativeFootShell(entries)`（DOM-free 纯函数）
- **断言面普查（2026-10-30 grep 实证）**：`isNativeFootShell` / `COOPERATIVE_SHELL_LOCALES` / `shellTakeover` 的全部消费点 = 上述两个 src 文件 + `tests/client-shell-takeover.test.mjs`（唯一测试消费者），无其他引用。改名即清点完毕，无潜伏断言面。

**变更后链路**：

- `shell-takeover.js` 唯一导出 `hasShellTakeover(entries)`：entries 数组内存在 `options.priority < 0` 即 true；DOM-free 纯函数，node:test 直测；
- `main.jsx`：`shellTakeover` 函数与门控行删除；新增 `diagnoseShellTakeover()`——`MarketEntry` 内 `useEffect(() => { diagnoseShellTakeover(); });`（**无 deps 数组，每次 render 后执行**）；模块级 `takeoverDiagnosticShown` flag 保证至多打点一次。晚挂载接管的覆盖是**尽力而为**语义（评审 R5）：「接管翻转级联页脚重渲染」系复用旧哨兵注释的推断——宿主侧 renderSlot/订阅实现不在仓内取证副本，「渲染 ≠ 订阅」；漏报后果仅 = 少一条 console.info，且首挂载即检出已覆盖主场景（接管插件通常先于 dsh-m 在场），该论证不作为行为正确性依据；
- `MarketEntry` 的 `useEffect(() => ensureCss(), [])` 不动。

## 变化面声明（CODING-STANDARDS「行为零变化承诺」格）

| 场景 | 旧行为 | 新行为 | 口径 |
|---|---|---|---|
| 官方壳（无负 priority 接管） | 入口在场 | 入口在场，**零变化** | DOM 节点数/几何/样式逐项一致（旧门控在 priority≥0 时本来就不触发） |
| 接管环境（better-workspace / ds-bot Bot 模式 / codex-ui） | 入口整行消失（codex-ui 经白名单豁免在场） | 入口照常在场 | 修复目的本身；codex-ui 形态行为等价（白名单豁免 → 恒在场，观察结果相同） |
| 接管视图排序（ds-bot Bot 模式等，评审 R3 增补） | 入口不渲染，无排序参与 | 入口以 order 9 参与页脚排序（DS Bot 条目 -200/-300 在前，工具行贴后） | 「在场」的自然推论；order 数值零变化（旧注释「bot 视图整行不渲染」句随替换 4 更新） |
| 日志面 | 无 | 接管环境下 `console.info` 至多一条（会话级） | 新增；不进 i18n 字典，无新增键 |

i18n：零新增键（`tests/client-i18n.test.mjs` 守卫不受影响）。样式/DOM 结构：零变化。

## 全局约束（grill 决议 Q1–Q10 逐字继承）

1. 退役的是门控不是判定资产：`hasShellTakeover` 纯函数保留直测（Q1）；
2. 诊断仅 `console.info`，不建 client→host 上报通道，不进 `dshm_list`/doctor（Q5）；
3. `COOPERATIVE_SHELL_LOCALES` 与「敌意/合作」分档整体删除（Q6）；
4. 不建敌意名单；可见性探针作为备案挂账入 ADR-0027（Q9）；
5. 发版动作不在本计划（Q10）：终点为「全绿 + 文档齐」；issue #33 发帖在 0.11.1 发版后（Q8），本计划只产草稿；
6. ds-bot 上游不留言（Q4）；
7. GLOSSARY「壳接管（Shell Takeover）」词条已前置落盘（2026-10-30，含与「让位（Displacement）」的撞名消解），只验证不重写（Q7）；
8. CODING-STANDARDS 派生约束：`main.jsx` 新注释中**不得出现** `hasShellTakeover` 与 `isNativeFootShell` 字面量（锚自洁——T1 的计数锚/负向锚按字面量出现次数断言，注释夹带即假红/假绿）；所有源锚为单行字符串（行尾以现场为准——本仓实测 LF 检出 / autocrlf 未设，评审批次 3 实证；单行锚在两种行尾下均稳健，多行锚禁用）。

## 环境前提（验证命令执行条件）

- `test -d node_modules`，缺失时按 package-lock `npm ci`；
- 构建类命令（`npm test` 的 pretest → `scripts/build.mjs`，esbuild 会 spawn 子进程）需 danger-full-access 沙箱；
- 任何 npm 调用前 `export npm_config_cache=/home/ubuntu/workspace/.npm-ci-cache`；
- 测试输出经过滤管道时 Bash 先 `set -o pipefail`（退出码卫生）。

## 文件结构与职责

**修改**

| 文件 | 职责 |
|---|---|
| `tests/client-shell-takeover.test.mjs` | 全文重写：`hasShellTakeover` 纯函数直测（5 it）+ 退役锚 describe（4 it：门控移除 / 诊断接线 / 白名单退役 / 模块 DOM-free） |
| `src/client/shell-takeover.js` | 全文重写：唯一导出 `hasShellTakeover`；模块头写裁定史、官方契约勘误、ds-bot 结构性失效事实 |
| `src/client/main.jsx` | require 改名（L37）；「壳接管哨兵」注释块 + `shellTakeover` 函数 → 诊断块（`diagnoseShellTakeover` + `takeoverDiagnosticShown`）；`MarketEntry` 门控行删除 + 诊断 useEffect 接入 |
| `package.json` | `version` 0.11.0 → 0.11.1 |
| `CHANGELOG.md` | 中文区块顶部 + 英文区块顶部各加 0.11.1 条目（双语同版本号对齐，house 格式：症状/根因/做法/验证） |

**新建**

| 文件 | 职责 |
|---|---|
| `docs/specs/2026-10-30-issue33-shell-takeover-sentinel-retirement-design.md` | 设计文档：证据链、三路线对比、诊断设计、变化面声明、测试策略、issue #33 回复策略、备案 |
| `docs/adr/0027-shell-takeover-sentinel-retirement.md` | 决策记录：10-13 让位裁定的退役，house 六段式，含备案两条 |
| `/home/ubuntu/workspace/.dsh-research/issue33-reply-draft.md` | issue #33 中文回复草稿（gitignored 工作区，先例 `issue30-close-comment.md`；发版后人工发帖，不入库） |
| `/home/ubuntu/workspace/.dsh-research/redlight-issue33/` | 变异红绿验证证据（红/绿两份输出落盘；先例 `.dsh-research/redlight-issue32/`） |

**边界保持稳定**：`dshmSlotsRef` 的 slot 接线赋值点不动；`ensureCss` 链不动；`safeRegister`/`registerSlot` 不动；i18n/styles 不动；安装/升级全链路不动；`scripts/build.mjs` 不动。

## 接口契约（Consumes / Produces）

- **T1 Produces → T2/T3 Consumes**：新测试文件的 9 个 it 即 T2/T3 的验收红线；其中退役锚 4 it 断言 `main.jsx` / `shell-takeover.js` 的最终源码形态（字面量与计数，见测试全文）；
- **T2 Produces → T3 Consumes**：`export function hasShellTakeover(entries)`——唯一导出，签名 `(entries: Array<{ options?: { priority?: number }, locale?: string } | null | undefined> | unknown) → boolean`；
- **T3 Produces → T4/T5/T6 Consumes**：`main.jsx` 最终符号 `diagnoseShellTakeover` / `takeoverDiagnosticShown`、`shell-takeover.js` 最终模块头文本——文档（T4/T5）与 CHANGELOG（T6）以符号锚引用，不写行号；
- 命名铁律：`main.jsx` 注释禁含 `hasShellTakeover` / `isNativeFootShell` 字面量（T1 计数锚 `split('hasShellTakeover').length - 1 === 2` = require + 调用恰两处，注释夹带即破坏）。

## 任务清单

### T1：测试翻转——全文重写 `tests/client-shell-takeover.test.mjs`（红灯步）

1. 读现场：`tests/client-shell-takeover.test.mjs` 现状 **2 describe / 10 it**（2026-10-30 双证：`grep -c "  it(" = 10`；`node --test` 实跑 tests 10 / pass 10——评审 R2 探针与执行侧复跑一致；此前「9 it」系执行侧计数遗漏），记录 N_old = 10；
2. 用下文**全文替换**该文件（不增删 it）：

```js
/**
 * 壳接管诊断（2026-10-30 哨兵退役，issue #33）：入口恒在场，判定降级为诊断信号。
 * - hasShellTakeover：sidebar.workspaces 台账是否存在负 priority 占位者。不再分档——
 *   COOPERATIVE_SHELL_LOCALES 白名单随门控一并退役（ds-bot 0.2.4 接管条目无 locale/
 *   id/key，locale 名单两方向都结构性够不着；误伤史与契约勘误见 ADR-0027）。
 * - 退役锚：main.jsx 不再消费哨兵作渲染门控（`if (shellTakeover()) return null` 移除），
 *   诊断经 MarketEntry 每次 render 后的 useEffect 打点，会话级一次性 flag 防重复。
 * 运行：npm run build && node --test tests/client-shell-takeover.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { hasShellTakeover } from '../src/client/shell-takeover.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('hasShellTakeover：接管环境判定（诊断专用，不分档）', () => {
  it('负 priority、无 locale → 判定接管存在（ds-bot 0.2.4 形态：无声明字段）', () => {
    assert.equal(hasShellTakeover([{ options: { priority: -100 } }]), true)
  })

  it('负 priority + 任意 locale → 判定接管存在（分档退役，白名单豁免不复存在）', () => {
    assert.equal(hasShellTakeover([{ options: { priority: -1 }, locale: 'michengai.codexUi' }]), true)
    assert.equal(hasShellTakeover([{ options: { priority: -1 }, locale: 'betterWorkspace' }]), true)
  })

  it('官方工作区树（priority 0 / 缺省）→ 非接管', () => {
    assert.equal(hasShellTakeover([{ options: {} }]), false)
    assert.equal(hasShellTakeover([{ options: { priority: 0 }, locale: 'workspace' }]), false)
  })

  it('混合：官方 + 负 priority → 判定接管存在', () => {
    const official = { options: { priority: 0 }, locale: 'workspace' }
    const taker = { options: { priority: -1 }, locale: 'betterWorkspace' }
    assert.equal(hasShellTakeover([official, taker]), true)
  })

  it('畸形输入安全：null 条目 / 非数组 / 空 entries', () => {
    assert.equal(hasShellTakeover([null]), false)
    assert.equal(hasShellTakeover(undefined), false)
    assert.equal(hasShellTakeover('x'), false)
    assert.equal(hasShellTakeover([]), false)
  })
})

describe('退役锚：门控移除 + 诊断接线（main.jsx / shell-takeover.js 源码锚）', () => {
  const main = () => readFileSync(join(root, 'src', 'client', 'main.jsx'), 'utf8')
  const takeover = () => readFileSync(join(root, 'src', 'client', 'shell-takeover.js'), 'utf8')

  it('main.jsx 渲染门控已移除（旧哨兵模式与旧判定名均不残留）', () => {
    const src = main()
    assert.equal(src.includes('if (shellTakeover()) return null'), false, '门控应已移除')
    assert.equal(src.includes('isNativeFootShell'), false, '旧判定名不应残留')
  })

  it('main.jsx 诊断接线：hasShellTakeover 恰 require+调用两处 + 一次性 flag + 话术', () => {
    const src = main()
    const hits = src.split('hasShellTakeover').length - 1
    assert.equal(hits, 2, `hasShellTakeover 应恰有 require + 调用两处（实测 ${hits}）`)
    assert.equal(src.includes('takeoverDiagnosticShown'), true, '一次性 flag 缺失')
    assert.equal(src.includes('diagnoseShellTakeover'), true, '诊断函数缺失')
    assert.equal(src.includes('console.info("[dsh-m] 侧栏工作区座位被外部接管'), true, '诊断话术缺失')
  })

  it('白名单随门控退役：COOPERATIVE_SHELL_LOCALES 在两个源文件中均不复存在', () => {
    assert.equal(takeover().includes('COOPERATIVE_SHELL_LOCALES'), false)
    assert.equal(main().includes('COOPERATIVE_SHELL_LOCALES'), false)
  })

  it('shell-takeover.js 保持 DOM-free 纯函数形态（无 document/window 引用）', () => {
    const src = takeover()
    assert.equal(src.includes('document'), false)
    assert.equal(src.includes('window'), false)
  })
})
```

- Run: `set -o pipefail && npm run build && node --test tests/client-shell-takeover.test.mjs 2>&1 | tail -15`
- Expected: **红**——`hasShellTakeover` 未导出，import 失败整个文件红（纯函数 5 it 与退役锚 4 it 全不可达）；
- 同时记录全量基线：`set -o pipefail && npm test 2>&1 | tail -5`，记录通过总数 N_base（0.11.0 发布口径 1842/1842，以现场为准）；若非全绿，回归判别一律 `node scripts/test-baseline.mjs`（禁止手搓管道对照）。

### T2：`shell-takeover.js` 重写（纯函数绿、退役锚部分红=预期中间态）

用下文**全文替换** `src/client/shell-takeover.js`：

```js
/**
 * 壳接管诊断（DOM-free 纯函数；2026-10-30 哨兵退役，issue #33）。
 *
 * 裁定史：
 * - 2026-10-13（0.9.81）ds-bot 页脚错乱实证 → 负 priority 接管即整行让位；
 * - 2026-10-24（issue #4）codex-ui 合作换壳白名单分档（locale 白名单，已随本裁定退役）；
 * - 2026-10-29（issue #33）better-workspace 误伤曝光。复核发现地基两处不成立：
 *   ① 官方契约被截断误读——SidebarRoot 原文（dsh-client-ui-sidebar 0.2.1-rc.3 与
 *   rc.4 双版核实，注释与渲染逻辑两证；取证副本 .dsh-research/issue33/sb-rc3.js）：
 *   「The workspace/session browsing region between global panel rows and the foot
 *   is the `sidebar.workspaces` registrant's, and the foot holds `sidebar.settings`
 *   plus `sidebar.footer.action`」——中段区域归注册者，页脚（settings + footer.action）
 *   恒由官方壳无条件渲染（footArea 渲染无任何条件分支）。旧注释引「the foot is the
 *   registrant's」砍掉「between global panel rows and」限定语，句意反转。页脚真正
 *   脱离官方之手的唯一方式是整壳经 `sidebar` 槽被替换——此时 footer.action 条目
 *   根本不挂载，天然隐身，无需任何让位判定。
 *   ② locale 白名单结构性失效——ds-bot 0.2.4（2026-10-29，main 与 npm tgz 双证）
 *   接管条目经 freePriority 动态取位，无 locale/id/key 可锚定，名单两方向（合作豁免/
 *   敌意点名）都够不着；且其 0.1.7（#164，2026-10-16）起即为其他插件页脚条目留行，
 *   10-13 实证所针对的伤害上游三天后已自愈。
 * - 2026-10-30 裁定（ADR-0027）：入口恒在场，本模块降级为诊断信号——只回答
 *   「接管环境是否存在」，不再分档、不再参与渲染门控。备案（可见性探针挂账 /
 *   不建敌意名单）见 ADR-0027。
 */

/**
 * sidebar.workspaces 台账 → 是否存在壳接管环境（负 priority 占位者）。
 * 条目形状：{ options?: { priority? }, locale? }（locale 仅形状兼容，不再参与判定）。
 */
export function hasShellTakeover(entries) {
  if (!Array.isArray(entries)) return false
  return entries.some((entry) => {
    if (!entry) return false
    return (entry.options?.priority ?? 0) < 0
  })
}
```

- Run: `set -o pipefail && npm run build && node --test tests/client-shell-takeover.test.mjs 2>&1 | tail -15`
- Expected: **中间态 7 绿 / 2 红**——`hasShellTakeover` describe 5 it 全绿；退役锚中「白名单退役」（两源文件均已无该字面量）与「DOM-free」绿，「门控移除」「诊断接线」红（main.jsx 未改）。（评审 R1 修订：T2 模块头注释曾误嵌 `COOPERATIVE_SHELL_LOCALES` 字面量致该锚恒红，已改「locale 白名单」表述；T2 中间态由 3 红 1 绿修正为 2 红 2 绿，终态 9/9 由此可达。）
- Run: `set -o pipefail && npm run typecheck`
- Expected: 0 错误。

### T3：`main.jsx` 门控退役 + 诊断接线（目标套件全绿）+ 变异验证留证

四处精确替换（旧串均经 2026-10-30 现场复核，替换 4 旧串逐字精确匹配 count=1 评审实证；行尾以现场为准——本仓实测 LF / autocrlf 未设，评审 R6；用编辑工具按内容替换，不按行号、不按行尾假设）：

**替换 1**（require 行）：
- 旧：`const { isNativeFootShell } = require("./shell-takeover.js");`
- 新：`const { hasShellTakeover } = require("./shell-takeover.js");`

**替换 2**（「壳接管哨兵」注释块 + `let dshmSlotsRef = null;` + `const shellTakeover = () => {...}` 整块）→ 新块：

```js
// ---------- 壳接管诊断（2026-10-30 哨兵退役，issue #33；裁定史、契约勘误与备案见 shell-takeover.js 模块头 + docs/adr/0027） ----------
// 旧哨兵（负 priority 接管即整行让位）地基两处不成立：① 官方契约被截断误读——
// SidebarRoot 原文是「工作区中段区域归 workspaces 注册者，页脚（settings +
// footer.action）恒由官方壳渲染」（rc.3/rc.4 注释与渲染两证），页脚从不移交；
// 整壳替换场景下 footer.action 条目根本不挂载，天然隐身，无需让位。② locale
// 白名单对无声明字段的接管者（ds-bot 0.2.4，freePriority 动态取位）结构性失效，
// 两次误伤在案（issue #4 codex-ui、issue #33 better-workspace）。现仅诊断：
// MarketEntry 每次 render 后的 useEffect 打点，会话级一次性 flag 防重复；
// 晚挂载接管能否补打点取决于宿主侧槽订阅（尽力而为：漏报仅少一条诊断信息，
// 首挂载即检出已覆盖主场景，不涉行为正确性）。
let dshmSlotsRef = null;
let takeoverDiagnosticShown = false;
const diagnoseShellTakeover = () => {
  if (takeoverDiagnosticShown) return;
  let taken = false;
  try {
    taken = hasShellTakeover(
      (dshmSlotsRef && dshmSlotsRef.entries ? dshmSlotsRef.entries("sidebar.workspaces") : []) || [],
    );
  } catch {
    taken = false;
  }
  if (taken) {
    takeoverDiagnosticShown = true;
    console.info("[dsh-m] 侧栏工作区座位被外部接管（负 priority），市场入口照常在场");
  }
};
```

（铁律自检：新块不含 `hasShellTakeover` 以外会破坏锚的字面量——含一次 `hasShellTakeover` 调用即计数 2 的组成之一；不含 `isNativeFootShell`；不含 `if (shellTakeover()) return null`。）

**替换 3**（`MarketEntry` 头部）：
- 旧：
```js
function MarketEntry(props) {
  useEffect(() => ensureCss(), []);
  if (shellTakeover()) return null;
```
- 新：
```js
function MarketEntry(props) {
  useEffect(() => ensureCss(), []);
  useEffect(() => {
    diagnoseShellTakeover();
  });
```

**替换 4**（`sidebar.footer.action` 注册块注释——旧哨兵叙事第二处，评审 R3 实证；测试锚不覆盖该区域，属人工替换项，替换后由人眼复核）：
- 旧（符号锚：`safeRegister` 内 `id: "dshm-market"` 上方注释块，main.jsx L1147-1152 时点参考）：
```js
      // 页脚 order 维持正数工具位（9）：bot 视图的让位由壳接管哨兵负责（该视图
      // 下 MarketEntry 整行不渲染），order 只影响官方 harness 页脚的排序——那里
      // DS Bot 入口（-200）应在本工具行之上。2026-10-13 曾试装深负 order
      // （-400/-500）让 ds-bot 集群贴底，哨兵上线后该做法只剩 harness 视图副作用
      // （DS Bot 入口沉底），已回撤（裁定：哨兵管让位，order 管排序，各司其职）。
```
- 新：
```js
      // 页脚 order 维持正数工具位（9）：order 只影响页脚条目排序——官方 harness
      // 页脚与接管视图（ds-bot Bot 模式等）读同一台账，DS Bot 入口（-200）恒在
      // 本工具行之上。2026-10-13 曾试装深负 order（-400/-500）让 ds-bot 集群贴底，
      // 壳接管哨兵上线后该做法只剩 harness 视图副作用（DS Bot 入口沉底），已回撤
      // （裁定：让位归哨兵、排序归 order）。2026-10-30 哨兵退役（ADR-0027）：接管
      // 视图下入口照常在场，order 9 照常参与排序（工具行贴在 DS Bot 条目之后）。
```
（锚自洁：新注释不含 `hasShellTakeover` / `isNativeFootShell` / `COOPERATIVE_SHELL_LOCALES` 字面量，不影响任何源锚。）

- Run: `set -o pipefail && npm run build && node --test tests/client-shell-takeover.test.mjs 2>&1 | tail -8`
- Expected: **9/9 全绿**；
- Run: `set -o pipefail && npm test 2>&1 | tail -5` —— 全量绿，通过数 = N_base + (9 − N_old)（N_old 实证 10 → Δ = −1），记录 Δ；
- Run: `set -o pipefail && npm run typecheck` —— 0 错误；
- **checkpoint commit C1**：`fix(client): 壳接管哨兵退役——市场入口恒在场，判定降级诊断（issue #33）`（三个文件：main.jsx / shell-takeover.js / 测试文件）；
- **变异验证**（CODING-STANDARDS「关键源码接线锚」条，C1 之后做）：
  1. 变异：在 `MarketEntry` 的 `useEffect(() => { diagnoseShellTakeover(); });` 之后插回一行 `if (hasShellTakeover([])) return null;`（单点变异，计数锚 2→3）；
  2. Run: `mkdir -p /home/ubuntu/workspace/.dsh-research/redlight-issue33 && set -o pipefail && node --test tests/client-shell-takeover.test.mjs 2>&1 | tee /home/ubuntu/workspace/.dsh-research/redlight-issue33/red.txt | tail -8` —— Expected: **恰 1 红**（「诊断接线」it 的计数锚红，其余绿）；
  3. 还原：`git checkout -- src/client/main.jsx`；Run: `git diff --exit-code -- src/client/main.jsx` —— Expected: 空输出 exit 0（main.jsx 为入库 tracked 文件，此判据非永真）；
  4. Run: `set -o pipefail && node --test tests/client-shell-takeover.test.mjs 2>&1 | tee /home/ubuntu/workspace/.dsh-research/redlight-issue33/green.txt | tail -8` —— Expected: 9/9 绿。

### T4：spec 设计文档 `docs/specs/2026-10-30-issue33-shell-takeover-sentinel-retirement-design.md`

按以下章节写正文，**必载事实逐条带锚**（全部已在本会话取证，禁止新断言无证据）：

1. **背景与症状**：issue #33（2026-10-29，better-workspace 0.36.13 与 dsh-m 0.10.25 共存，市场入口消失且无任何报错）；报告者根因链与我们独立复核逐条一致；
2. **证据链**（七条，每条带来源锚）：
   - 哨兵判据与门控现状（`src/client/shell-takeover.js` / `main.jsx` MarketEntry 门控，符号锚；T2/T3 改后形态）；
   - 官方契约原文与渲染无条件性：dsh-client-ui-sidebar **0.2.1-rc.3 与 rc.4 双版**，SidebarRoot 注释原文 + footArea 无条件渲染 `renderSlot("sidebar.footer.action")`；取证副本 `.dsh-research/issue33/sb-rc3.js`；
   - better-workspace 形态：`src/client.js` L29 `NS='betterWorkspace'`、L11490 注册块 `priority:-1`；全文零处 `sidebar.footer.action`、零处 `sidebar` 整壳替换；其文件头自述只换工作区树与设置卡；取证副本 `.dsh-research/issue33/bw-client.js`；
   - ds-bot 0.2.4 形态（main 分支 + npm tgz 双证，副本 `.dsh-research/issue33/dsbot/`）：`BOT_PRIORITY=-100` + `freePriority` 动态取位；接管条目**无 locale/id/key**；自身向官方 `sidebar.footer.action` 注册 `bot-account`（order -200）与 `bot-return`（order -300，Agent 模式专用回归按钮，「The only entry registered in every mode」）；CHANGELOG 时间线：#127（0.1.6，codex-ui 共存）、#164（0.1.7，「其他插件页脚条目各占一行」——10-13 实证所针对的伤害上游自愈点）、Classic Agent mode 双模式；
   - 误伤史：issue #4（codex-ui，9b80477 白名单分档）、issue #33（better-workspace）、ds-bot 0.2.4 Bot 模式潜伏误伤（无 locale 可录）；
   - 契约误读勘误：旧模块头引文 vs 官方原文对照（截断处与句意反转说明）；
   - 三分类学：整壳替换（codex-ui 型）/ 座位遮蔽（better-workspace 型）/ 皮肤覆盖（ds-bot 型）——台账字段层面（locale/id/key 缺席）任何名单式判定都无法稳定表达，渲染层才有真值；
3. **三路线对比**：R1 退役门控+诊断（采纳）/ R2 白名单热修（否决：ds-bot 无 locale 结构性够不着 + 名单跑步机已被两次事故证伪）/ R3 在场探针（否决并挂账：三态推演——不挂载场景本就隐身无需探针、挂载但不可见本就无害、可见但丑探针测不出）；
4. **诊断信号设计**：每 render 后 useEffect + 会话级 one-shot flag；话术；级联覆盖论证**明确标注尽力而为语义**（宿主侧 renderSlot 订阅实现不在仓内取证副本，渲染证据 ≠ 订阅证据；漏报后果 = 少一条诊断行，不涉行为正确性；坐实路径备查：runtime asar 宿主侧 renderSlot 实现）；
5. **变化面声明**：照搬本计划「变化面声明」表；
6. **测试策略**：纯函数直测 + 退役源锚（单行锚、出现次数语义）+ 变异红绿留证（`.dsh-research/redlight-issue33/`）；
7. **issue #33 回复策略**：0.11.1 发版后中文公开回复（要点见 T7）；
8. **备案**：可见性探针挂账（触发条件：未来出现挤压/错乱类皮肤实证）；不建敌意名单（理由：ds-bot 型无声明字段不可名状；名单只能事后追认）。

- Run: `grep -c "^## " docs/specs/2026-10-30-issue33-shell-takeover-sentinel-retirement-design.md`
- Expected: ≥ 8（八个章节齐）。

### T5：ADR-0027 `docs/adr/0027-shell-takeover-sentinel-retirement.md`

house 六段式（体例参照 `docs/adr/0026-update-decoupled-from-catalog.md`）：

- 标题：`# 壳接管哨兵退役——市场入口恒在场（issue #33）`；
- **背景**：10-13 裁定语境（ds-bot 页脚错乱实证）→ issue #4 白名单分档 → issue #33 误伤曝光 → 地基复核两处不成立（契约截断误读 + 白名单对无声明字段接管者结构性失效；ds-bot 上游 #164 已自愈原伤害）；
- **## 我们决定（2026-10-30，grill 决议 Q1–Q10）**：① 门控退役，入口恒在场；② 判定降级 console.info 诊断（不建上报通道）；③ `COOPERATIVE_SHELL_LOCALES` 删除、`isNativeFootShell` → `hasShellTakeover` 收敛；④ 不建敌意名单；⑤ 可见性探针挂账备案；⑥ 生态动作范围：仅 issue #33 公开回复（发版后），ds-bot 上游不留言；
- **## Considered Options**：R2 白名单热修（否决+理由）/ R3 在场探针（否决+理由，转备案）/ 维持现状继续补录（否决：跑步机 + 隐藏市场的最坏失败模式）；
- **## Consequences**：官方壳零变化；接管环境入口在场（ds-bot Bot 模式在场系上游 #164 明确留行欢迎）；诊断至多一条；白名单教义退役；GLOSSARY 新增「壳接管」词条且与「让位（Displacement）」撞名消解；测试资产从分档判别转为存在判定 + 退役锚；
- **## 备案**：两条（探针触发条件；不建敌意名单的完整理由）。

- Run: `ls docs/adr/ | tail -3`
- Expected: 0027 为最大编号且文件存在；
- **checkpoint commit C2**：`docs: 哨兵退役设计文档 + ADR-0027（issue #33）`（T4+T5 两个文件一并）。

### T6：CHANGELOG 0.11.1 双语条目 + package.json 版本

1. `package.json`：`"version": "0.11.0"` → `"0.11.1"`；
2. `CHANGELOG.md` 中文区块（`## 中文` 下、`### 0.11.0` 之前）按 house 格式加 `### 0.11.1 修复：壳接管哨兵退役——市场入口恒在场（issue #33）`，小节事实要点：
   - **症状**：与 dsh-better-workspace 等负 priority 遮蔽 `sidebar.workspaces` 的插件共存时，市场入口整行消失且无任何报错/日志（issue #33，0.10.25 实测）；ds-bot 0.2.4 Bot 模式同潜伏误伤（接管条目无 locale，白名单结构性够不着）；
   - **根因**：2026-10-13（0.9.81）ds-bot 页脚错乱裁定引入的壳接管哨兵，以「workspaces 槽出现负 priority 占位者」推断「页脚被接管」——官方契约原文（rc.3/rc.4 双版核实）是「中段区域归注册者，页脚恒由官方壳无条件渲染」，旧注释系截断误读；页脚脱离官方之手的唯一方式（整壳替换 `sidebar` 槽）下入口根本不挂载、天然隐身。白名单分档（issue #4）治不了无声明字段的接管者；
   - **做法**：门控退役（入口恒在场）；判定降级 `hasShellTakeover` 诊断信号（接管环境下 console.info 至多一条）；`COOPERATIVE_SHELL_LOCALES` 删除；裁定与备案见 ADR-0027；GLOSSARY 新增「壳接管」词条；
   - **验证**：全量 npm test（Δ 用例记账）+ typecheck 0 + 变异红绿留证（`.dsh-research/redlight-issue33/`）——数字以最终运行为准填入；
3. 英文区块（`## English` 等价位置）加同版本对齐条目（双语内容对齐，house 先例同款）；
- Run: `node -e "console.log(require('./package.json').version)"` → `0.11.1`；
- Run: `grep -c "^### 0.11.1" CHANGELOG.md` → `2`（中英两区块；期望值非 0，无 grep 计 0 退出码陷阱）；
- **checkpoint commit C3**：`chore(release): 0.11.1 —— 壳接管哨兵退役（issue #33）`（package.json + CHANGELOG.md）。

### T7：issue #33 回复草稿 `/home/ubuntu/workspace/.dsh-research/issue33-reply-draft.md`

中文公开回复草稿（**发版后人工发帖**，本任务只产稿；gitignored 区，不提交）。必载六点：

1. 根因确认：报告者定位的 `isNativeFootShell` + `COOPERATIVE_SHELL_LOCALES` 链路与仓库源码逐字一致，判定成立；
2. 独立复核补充：官方 `dsh-client-ui-sidebar`（rc.3/rc.4 双版）SidebarRoot **无条件**渲染 footArea；better-workspace 源码零处消费 `sidebar.footer.action`、零处整壳替换——官方页脚始终在场，dsh-m 是唯一主动隐藏方（与其复现「其他图标在、唯独市场图标缺」吻合）；
3. 修复：0.11.1 哨兵退役，市场入口恒在场（版本号以 npm 实际发布为准）；
4. 裁定变更说明：2026-10-13 让位裁定的语境（ds-bot 当时页脚错乱实证）与退役理由（契约系截断误读 + 白名单对无 locale 的 ds-bot 0.2.4 结构性失效），ADR 链接 `https://github.com/iasiv5/dsh-m/blob/main/docs/adr/0027-shell-takeover-sentinel-retirement.md`；
5. 致谢：报告者从打包产物读出根因链的分析质量；
6. （一句带过）ds-bot 0.1.7（#164）起已为其他插件页脚条目留行，本修复同时解除其 Bot 模式的潜伏误伤。

- Run: `grep -c "^- \[" /home/ubuntu/workspace/.dsh-research/issue33-reply-draft.md 2>/dev/null || true` 配合人工通读——六点齐全即过；不设 grep 硬门（文稿类以通读验收）。

## 执行纪律

- 开工前先通读本计划 + 现场复核三个待改文件的符号锚（`isNativeFootShell` require 行、哨兵注释块、MarketEntry 头部）——行号为时点参考，以符号锚为准；
- 按任务顺序执行，不无声跳步、合并步或改变任务目标；每任务验证后再前进；
- 回归判别遇环境既有失败一律 `node scripts/test-baseline.mjs`，禁止手搓管道对照；
- 遇阻塞、重复失败或计划与仓库现实不符，立即停下说明，不猜；
- T7 产出在 gitignored 区，不进 commit；发帖动作在 0.11.1 发版后由主人执行（不在本计划）。

## 最终验证

1. `set -o pipefail && npm test 2>&1 | tail -5` —— 全绿；通过数 = N_base + Δ（Δ = 9 − 10 = −1，新文件 9 it / 旧文件 10 it）；
2. `npm run typecheck` —— 0 错误（注：tsconfig include 仅 `src/**/*.ts`，本计划 client 改动面不在其检查范围——该判据是回归确认而非本计划的防线，评审批次 2 自证在案）；
3. `node -e "console.log(require('./package.json').version)"` → `0.11.1`；
4. `grep -c "^### 0.11.1" CHANGELOG.md` → `2`；
5. `node --test tests/client-shell-takeover.test.mjs` → 9/9；
6. `ls docs/adr/0027-shell-takeover-sentinel-retirement.md docs/specs/2026-10-30-issue33-shell-takeover-sentinel-retirement-design.md` → 两文件在；
7. `grep -c "壳接管（Shell Takeover）" GLOSSARY.md` → `≥1`（前置已落盘，验证未被误改）；
8. `ls /home/ubuntu/workspace/.dsh-research/redlight-issue33/` → red.txt 与 green.txt 在。

## 审阅 Checkpoint

计划正文到此为止；审阅通过前不进入实现。
