# 桌面 peer 预检运行时版本改读应用自身 app.asar（issue #32）实施计划

## 目标

- 修复 issue #32：DSH Desktop 上 `resolveDshVersion()` 两条既有通路全部落空（launcher 正则不命中 Electron entry → 回退 `spawn('dsh', ['--version'])` 命中 PATH 残留旧 CLI），peer 兼容预检把 PATH 版本当运行时版本，兼容插件被全数拦下。
- 新增第三条「应用自身」通路 `readAppAsarVersion()`（读 `app.asar` 内嵌 package.json），顺序改为 **asar → launcher → spawn**，且 **Electron 进程内 spawn 整体禁用**（桌面解析失败一律 null，预检按「未检不拦」放行、chip 隐藏，对齐 doctor 既有哲学）。
- doctor 通路顺带一行受益：`readLauncherPackageVersion() ?? readAppAsarVersion()`（桌面 stale 判定可用真实版本）。
- web 与 CLI 形态行为零变化（见「行为零变化承诺」格）。
- 收尾：版本 0.10.25、CHANGELOG 双语条目、发版、issue #32 回执致谢。

## 架构快照

- `src/core/dsh-version.ts` 现状：`resolveDshVersion()` = 进程内缓存（Promise memo）的一次性解析，先 `readLauncherPackageVersion()`（纯 FS：argv[1] → realpath → 向上三级找 package.json），null 则 `spawnDshVersion()`（`dsh --version`，win32 `shell:true`）。
- 本次在该模块内追加（零新依赖，不新增文件）：
  - `readAppAsarVersion(deps?)`：候选 `resourcesPath/app.asar` → `dirname(execPath)/resources/app.asar`；asar pickle 头（`@0 u32=4`、`@4 headerSize`、`@8 headerSize-4`、`@12 jsonLen`、`@16…JSON`，内容区起点 `8+headerSize`）→ 头 JSON 定位 `files["package.json"]`（size/offset 为字符串）→ 内容区按 offset 读**实体 package.json** → `name` 前缀 `@deepseek-ai/dsh` + `version` semver 正则 + size/offset 越界守卫；任一步失败静默 null（风格与 `readLauncherPackageVersion` 一致）。
  - `resolveDshVersionWith(deps?)`：可注入编排（asar/launcher/spawnVersion/isElectron/fallbackTimeoutMs），顺序 asar → launcher →（非 Electron 才）spawn；`resolveDshVersion()` 改为对它的 memoized 包装，缓存语义与 `resetDshVersionCacheForTest` 不变。
- `src/core/host-api.ts`：doctor 通路 `runDoctor(profile.dir, readLauncherPackageVersion())` 追加 `?? readAppAsarVersion()`（web 上 asar 恒 null，行为不变；桌面 launcher 必 null，落到 asar）。
- 受益面（无需改动）：`precheckNpmCompat()` 三个调用点（market-mutation.ts:612、profile-ops.ts:252、profile-ops.ts:1126）与 ping chip（host-api.ts:350）都经 `resolveDshVersion()`，自动切换到新顺序。

## 全局约束

- **零新运行依赖**：`dependencies` 维持 semver/undici/yaml 三件；asar 解析内联实现。
- **测试锚三物理事实**（docs/CODING-STANDARDS.md）：本机工作树为 LF（`git ls-files --eol` 实测 `w/lf`），但量化锚一律用出现次数语义（`split(needle).length - 1`），不用 `grep -c` 行数语义；bundle 负向锚禁用，本计划全部用源结构锚。
- **TDD 红灯先行**：每个代码任务先写失败测试、亲见红灯、再最小实现、亲见绿灯。
- **关键接线锚变异留证**：隔离变异 → 单点红 → 字节恢复 → 绿，证据落 `.dsh-research/`（gitignore 区，不入库）。
- **退出码卫生**：验证命令经管道时 `set -o pipefail`，以原进程退出码判定。
- **无额外全局约束**（无版本下限/平台/文案规则变更；i18n 零改动——本修复不触 client）。

## 输入工件

- 无盘上设计文档。上游共识 = 本会话 grill 轮（2026-10-28）：Q1 桌面 Electron 内 spawn 整体禁用、Q2 内联 asar 解析零新依赖、Q3 doctor 顺带一行、Q4 合成 fixture 测试+红灯复演+真机验证列为发布后回执、Q5 含发版与 issue 回执——用户答复「本轮按推荐」全数采纳；后续追加确认「不用落设计文档，直接进 writing-plans」。
- 事实依据（写入时当场核实）：根因链逐行核实记录见 dsh-version.ts:33/65/96-101、dsh-cli.ts:369-372、compat-check.ts:43/70、host-api.ts:808-810；issue 原文 `.dsh-research/issue32.json`。

## 文件结构与职责

- Modify: `src/core/dsh-version.ts` —— 新增 `readAppAsarVersion` / `resolveDshVersionWith` 及类型；`resolveDshVersion` 改 memoized 包装；模块头注释更新为三通路+桌面门控描述。
- Modify: `src/core/host-api.ts` —— L11 import 追加 `readAppAsarVersion`；doctor case 注释与 `runDoctor` 实参更新。
- Modify: `tests/dsh-version.test.mjs` —— 新增 describe「readAppAsarVersion」与「resolveDshVersionWith」（合成 asar buffer fixture 写 tmpdir，真实 fs，无 fs mock；沿用现有「npm run build 后从 `../lib/core/dsh-version.js` 导入」惯例）。
- Modify: `tests/doctor-api.test.mjs` —— 新增 1 条 doctor 接线源锚 it。
- Modify: `CHANGELOG.md` —— 中文/英文区各插 0.10.25 顶条（体例：症状/根因/修法/验证）。
- Modify: `package.json` + `package-lock.json` —— 版本三处（package.json `version`、lock 根 `version` 与 `packages[""].version`）。
- Create: 无新源文件；测试证据与 issue 回执草稿落 `/home/ubuntu/workspace/.dsh-research/redlight-issue32/`（不入库）。

## 行为零变化承诺

| 形态 | 0.10.24 行为 | 0.10.25 行为 | 口径 |
| --- | --- | --- | --- |
| web 宿主（node，argv[1]=bin.js） | launcher 主通路命中 | **逐字节一致**（asar 先行但恒 null 短路） | 无变化 |
| CLI（bin.js / pnpm shim symlink） | launcher 命中 | **逐字节一致** | 无变化 |
| 非 launcher 的裸 node 嵌入 | spawn PATH（不受控） | spawn PATH（无 electron 标志，不变） | 无变化 |
| DSH Desktop（Electron） | spawn PATH ← **bug 本体** | asar 命中真实版本；读取失败则 null（预检放行、chip 隐藏） | **修复本意的变化**，如实声明 |
| ping chip 桌面显示 | PATH 版本（错值） | asar 版本（真值）或字段缺席 | 同上 |
| doctor | launcher；桌面恒 null→全降级 | launcher ?? asar；桌面可用真实版本 | 顺带修复，如实声明 |

## 冻结面清点（「零改动/不变」类承诺的断言面，reviewer-issue32 实测于 8db58a4）

1. `tests/dsh-version.test.mjs` 既有 **7 it**（parseDshVersionOutput 2 + readLauncherPackageVersion 5）——计划不动其中任何一行；新增只以**追加 describe** 形式落文件尾部。
2. `tests/doctor-api.test.mjs` 既有 **3 it**——其中 L87 `assert.equal(body.report.runtimeVersion, null)` 在 Task 3 新接线后保持绿的隐含前提 = 测试进程 launcher 与 asar 双 null（node --test 下 execPath 旁无 resources/app.asar 成立）；Task 3 Step 4 须确认该既有断言未变红。
3. `tests/host-api.test.mjs` L771-785 ping.dshVersion 2 it 及 L132、`host-api-external.test.mjs` L62、`host-api-profile.test.mjs` L66 的 `resolveDshVersion` 全为 deps 注入桩——零影响冻结面（不触真实实现）。
4. `src/core/dsh-version.ts` 既有 **4 导出签名不变**：`parseDshVersionOutput` / `readLauncherPackageVersion` / `resolveDshVersion` / `resetDshVersionCacheForTest`；新增导出仅 `readAppAsarVersion`、`resolveDshVersionWith`、`AppAsarVersionDeps`、`ResolveDshVersionDeps`。
5. 全量基线 **1800/1800**：评审 scratch 副本亲跑复核（exit 0，60.5s）；执行时 Task 5 以实跑数为准。
6. 环境前提备注：Task 1 用例 5 与 doctor-api L87 均隐含「测试进程 execPath 旁无 `resources/app.asar`」（node --test 形态下成立）；未来更换测试运行器或宿主形态时先复核此前提，防假红误判。

## 任务清单

### Task 1: readAppAsarVersion asar 解析通路（TDD）

- 目标：新增 `readAppAsarVersion()`，合成 asar fixture 全分支覆盖。
- 涉及文件：`tests/dsh-version.test.mjs`、`src/core/dsh-version.ts`。
- 接口契约：
  - Consumes: 现有 `readLauncherPackageVersion` 同款静默 null 风格；`node:fs` 的 `openSync/readSync/closeSync`（新 import）；`dirname/join`（已 import）。
  - Produces: `readAppAsarVersion(deps?: { resourcesPath?: string | undefined; execPath?: string }): string | null`（具名导出，Task 2/3 消费）。
- 验证范围：`npm run build && node --test tests/dsh-version.test.mjs` 新增用例全绿、既有用例零改动绿。

- [ ] Step 1: 在 `tests/dsh-version.test.mjs` 追加 import（`readAppAsarVersion`）与 fixture 工具 + 新 describe：

```js
// import 行追加：parseDshVersionOutput, readLauncherPackageVersion, readAppAsarVersion
function makeAsarBuffer({ pkg, headerRaw, u32Fixes = {}, truncateTo } = {}) {
  const pkgBuf = Buffer.from(pkg ?? JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.3' }), 'utf8')
  const headerStr = Buffer.from(headerRaw ?? JSON.stringify({ files: { 'package.json': { size: String(pkgBuf.length), offset: '0' } } }), 'utf8')
  // headerSize 含 pickle 两层 u32：payloadSize 字段（@8..12）+ jsonLen 字段（@12..16）→ = j + 8（评审 T0 实证：
  // 若写 +4 则与实现的 8+headerSize 读点差 4 字节，pkg 读点落进 JSON 尾巴，全命中用例必红——probe-task1*.log）
  const headerSize = headerStr.length + 8
  const buf = Buffer.alloc(16 + headerStr.length + pkgBuf.length)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  dv.setUint32(0, 4, true); dv.setUint32(4, headerSize, true)
  dv.setUint32(8, headerSize - 4, true); dv.setUint32(12, headerStr.length, true)
  headerStr.copy(buf, 16); pkgBuf.copy(buf, 16 + headerStr.length)
  for (const [off, val] of Object.entries(u32Fixes)) dv.setUint32(Number(off), Number(val), true)
  return truncateTo != null ? buf.subarray(0, truncateTo) : buf
}
const writeAsar = (dir, name, buf) => { const p = join(dir, name); writeFileSync(p, buf); return p }
```

新增用例（describe `dsh-version：readAppAsarVersion（issue #32 桌面 asar 通路）`，共 **6 it**；每用例 tmpdir 自建自清，沿用 `mkdtempSync` 惯例）：
1. resourcesPath 候选命中：A 目录放 `app.asar`，`execPath` 指向无关目录 B 下 `node`（B 无 resources）→ 返回 `0.2.1-rc.3`。
2. 第二候选回退可达：resourcesPath 指向空目录（其候选 ENOENT），`execPath = join(B, 'node')` 且 `B/resources/app.asar` 有效 → 返回其版本（只证明回退可达；顺序由用例 6 钉死）。
3. name 前缀守卫：pkg name `@evil/pkg` → null；version `not-semver` → null。
4. 结构守卫全 null（单 it 内 5 组断言，一组一断言）：截断至 10 字节；`u32Fixes = { 0: 9 }`（坏 pickle 标记）；`headerRaw = '{"files":'`（JSON 损坏）；`headerRaw = '{"files":{}}'`（无 package.json 条目）；`headerRaw` 中 size 给 `'999999999'`（越界）。
5. 生产默认（零注入参数调用）：测试进程 execPath 旁无 `resources/app.asar` → null（环境前提备注见「冻结面清点」节第 6 条）。
6. 双候选并存钉顺序（Task 4 锚①红灯判据指向本用例）：A（resourcesPath 侧）放 version `0.2.1-rc.3`，B（execPath 侧）`resources/app.asar` 放 version `0.2.1-rc.4`，两候选同时有效 → 断言返回 resourcesPath 侧 `0.2.1-rc.3`；候选 push 顺序颠倒后本用例必红（返回 0.2.1-rc.4 ≠ 断言）。

- [ ] Step 2: 运行并确认红灯（函数未导出）。
- Run: `cd /home/ubuntu/workspace/dsh-m && npm run build && node --test tests/dsh-version.test.mjs`
- Expected: import 报错 `SyntaxError: The requested module ... does not provide an export named 'readAppAsarVersion'`（构建先绿，测试文件载入失败）。
- [ ] Step 3: `src/core/dsh-version.ts` 最小实现：

```ts
const ASAR_NAME_PREFIX = '@deepseek-ai/dsh'
const ASAR_VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const ASAR_HEADER_JSON_MAX = 32 * 1024 * 1024
const ASAR_PKG_MAX = 1024 * 1024

function readAsarPackageVersionAt(asarPath: string): string | null {
  let fd: number | null = null
  try {
    fd = openSync(asarPath, 'r')
    const head = Buffer.alloc(16)
    if (readSync(fd, head, 0, 16, 0) !== 16) return null
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
    if (dv.getUint32(0, true) !== 4) return null
    const headerSize = dv.getUint32(4, true)
    const payloadSize = dv.getUint32(8, true)
    const jsonLen = dv.getUint32(12, true)
    if (headerSize < 4 || headerSize - 4 !== payloadSize) return null
    if (jsonLen === 0 || jsonLen > payloadSize || jsonLen > ASAR_HEADER_JSON_MAX) return null
    const jsonBuf = Buffer.alloc(jsonLen)
    if (readSync(fd, jsonBuf, 0, jsonLen, 16) !== jsonLen) return null
    const header: unknown = JSON.parse(jsonBuf.toString('utf8'))
    const files = (header as { files?: unknown } | null)?.files
    const entry = (files as Record<string, { size?: unknown; offset?: unknown } | undefined> | undefined)?.['package.json']
    if (!entry) return null
    const pkgOffset = Number(entry.offset)
    const pkgSize = Number(entry.size)
    if (!Number.isSafeInteger(pkgOffset) || pkgOffset < 0) return null
    if (!Number.isSafeInteger(pkgSize) || pkgSize < 2 || pkgSize > ASAR_PKG_MAX) return null
    const pkgBuf = Buffer.alloc(pkgSize)
    if (readSync(fd, pkgBuf, 0, pkgSize, 8 + headerSize + pkgOffset) !== pkgSize) return null
    const pkg: unknown = JSON.parse(pkgBuf.toString('utf8'))
    const name = (pkg as { name?: unknown } | null)?.name
    const version = (pkg as { version?: unknown } | null)?.version
    if (typeof name !== 'string' || !name.startsWith(ASAR_NAME_PREFIX)) return null
    if (typeof version !== 'string' || !ASAR_VERSION_RE.test(version)) return null
    return version
  } catch {
    return null
  } finally {
    if (fd !== null) { try { closeSync(fd) } catch { /* already closed */ } }
  }
}

export interface AppAsarVersionDeps { resourcesPath?: string | undefined; execPath?: string }

export function readAppAsarVersion(deps: AppAsarVersionDeps = {}): string | null {
  try {
    const proc = process as unknown as { resourcesPath?: string }
    const resources = deps.resourcesPath !== undefined ? deps.resourcesPath : proc.resourcesPath
    const candidates: string[] = []
    if (resources) candidates.push(join(resources, 'app.asar'))
    candidates.push(join(dirname(deps.execPath ?? process.execPath), 'resources', 'app.asar'))
    for (const candidate of candidates) {
      const v = readAsarPackageVersionAt(candidate) // 缺文件 ENOENT → null
      if (v != null) return v
    }
    return null
  } catch {
    return null
  }
}
```

同时把模块头注释（L2-12）的「两条路」描述改为三条：asar（桌面主判据）→ launcher → spawn（非 Electron 才采信）。

- [ ] Step 4: 运行并确认绿灯（新增用例全绿 + 既有用例零改动绿）。
- Run: `cd /home/ubuntu/workspace/dsh-m && npm run build && node --test tests/dsh-version.test.mjs`
- Expected: `pass N fail 0`，exit 0。

### Task 2: resolveDshVersionWith 编排 + Electron 门控（TDD）

- 目标：可注入编排层，顺序 asar → launcher →（非 Electron）spawn；`resolveDshVersion()` 改 memoized 包装。
- 涉及文件：`tests/dsh-version.test.mjs`、`src/core/dsh-version.ts`。
- 接口契约：
  - Consumes: Task 1 `readAppAsarVersion`；现有 `readLauncherPackageVersion`、`spawnDshVersion`（模块内私有，不导出）。
  - Produces: `resolveDshVersionWith(deps?: ResolveDshVersionDeps): Promise<string | null>`；`ResolveDshVersionDeps { readAsar?: () => string | null; readLauncher?: () => string | null; spawnVersion?: (timeoutMs: number) => Promise<string | null>; isElectron?: boolean; fallbackTimeoutMs?: number }`（具名导出，测试消费）。
- 验证范围：单文件测试全绿。

- [ ] Step 1: 追加 describe `dsh-version：resolveDshVersionWith（issue #32 编排与门控）`，import 追加 `resolveDshVersionWith`。用例（桩用调用计数对象）：
  1. asar 桩返回 `'9.9.9'` → 结果 `'9.9.9'`，launcher/spawn 桩计数 0（asar 优先）。
  2. asar 桩 null + launcher 桩 `'0.2.0-rc.2'` → 返回 launcher 值，spawn 桩计数 0。
  3. asar/launcher 桩均 null + `isElectron: false` + spawn 桩 `'0.1.0-rc.6'` → 返回 PATH 值（web/CLI 兼容守卫锚）。
  4. asar/launcher 桩均 null + `isElectron: true` → 返回 null 且 spawn 桩计数 0（**桌面门控核心锚**）。
  5. 不记忆化：同一 deps 两次调用，spawn 桩计数 2。
- [ ] Step 2: 确认红灯（`resolveDshVersionWith` 未导出，同 Task 1 报错形态）。
- Run: `cd /home/ubuntu/workspace/dsh-m && npm run build && node --test tests/dsh-version.test.mjs`
- Expected: export 缺失 SyntaxError。
- [ ] Step 3: 最小实现：

```ts
export interface ResolveDshVersionDeps {
  readAsar?: () => string | null
  readLauncher?: () => string | null
  spawnVersion?: (timeoutMs: number) => Promise<string | null>
  isElectron?: boolean
  fallbackTimeoutMs?: number
}

export async function resolveDshVersionWith(deps: ResolveDshVersionDeps = {}): Promise<string | null> {
  const versions = process.versions as typeof process.versions & { electron?: string }
  const isElectron = deps.isElectron ?? versions.electron != null
  const readAsar = deps.readAsar ?? ((): string | null => readAppAsarVersion())
  const readLauncher = deps.readLauncher ?? ((): string | null => readLauncherPackageVersion())
  const spawnVersion = deps.spawnVersion ?? spawnDshVersion
  const asarV = readAsar()
  if (asarV != null && asarV !== '') return asarV
  const launcherV = readLauncher()
  if (launcherV != null && launcherV !== '') return launcherV
  if (isElectron) return null // 桌面：PATH 来源不受控，宁可达不成、不可错（issue #32）
  return spawnVersion(deps.fallbackTimeoutMs ?? 3_000)
}
```

`resolveDshVersion` 改为：

```ts
export function resolveDshVersion(opts: { fallbackTimeoutMs?: number } = {}): Promise<string | null> {
  if (!cache) cache = resolveDshVersionWith({ fallbackTimeoutMs: opts.fallbackTimeoutMs })
  return cache
}
```

- [ ] Step 4: 确认绿灯（单文件全绿）。
- Run: `cd /home/ubuntu/workspace/dsh-m && npm run build && node --test tests/dsh-version.test.mjs`
- Expected: `pass N fail 0`，exit 0。

### Task 3: doctor 接线 asar 兜底（TDD）

- 目标：doctor 通路追加以 asar 为兜底的运行时版本来源，并落一条源结构锚。
- 涉及文件：`tests/doctor-api.test.mjs`、`src/core/host-api.ts`。
- 接口契约：
  - Consumes: Task 1 `readAppAsarVersion` 导出；host-api.ts L11 现行 import `import { resolveDshVersion, readLauncherPackageVersion } from './dsh-version.js'`；doctor case 现行实参 `runDoctor(profile.dir, readLauncherPackageVersion())`（符号锚 `case 'doctor'`）。
  - Produces: 无下游消费（收口改动）。
- 验证范围：doctor-api 单文件测试全绿（含新锚）。

- [ ] Step 1: `tests/doctor-api.test.mjs` 顶部 import 追加 `readFileSync`（来自 `node:fs`），describe 内追加：

```js
it('接线锚（issue #32）：doctor runtimeVersion = readLauncherPackageVersion() ?? readAppAsarVersion()', () => {
  const src = readFileSync(new URL('../src/core/host-api.ts', import.meta.url), 'utf8')
  assert.equal(src.split('readLauncherPackageVersion() ?? readAppAsarVersion()').length - 1, 1)
})
```

- [ ] Step 2: 确认红灯（锚计数 0 ≠ 1）。
- Run: `cd /home/ubuntu/workspace/dsh-m && npm run build && node --test tests/doctor-api.test.mjs`
- Expected: 仅新增 it 失败，其余绿。
- [ ] Step 3: `src/core/host-api.ts` 两处改动：L11 import 追加 `readAppAsarVersion`；doctor case 实参改 `runDoctor(profile.dir, readLauncherPackageVersion() ?? readAppAsarVersion())`，注释「spawn 回退是 doctor 禁区」段补一句「issue #32：桌面追加 app.asar 纯 FS 兜底（仍零进程派生）」。
- [ ] Step 4: 确认绿灯。
- Run: `cd /home/ubuntu/workspace/dsh-m && npm run build && node --test tests/doctor-api.test.mjs`
- Expected: 全绿，exit 0。

### Task 4: 关键锚红灯复演（隔离变异，证据落盘）

- 目标：三处关键接线锚逐个变异可红、恢复后绿，证明锚是真的。
- 涉及文件：只临时改 `src/core/dsh-version.ts` 与 `src/core/host-api.ts`，结束必须字节还原（判据唯一下方「Step 收尾判据」：cmp 备份 + status 快照 diff；不使用 `git diff --exit-code -- <file>`——Task 1-3 改动未提交时该判据对 HEAD 比对恒非空，恒失败）。
- 接口契约：
  - Consumes: Task 1-3 的测试与实现。
  - Produces: `/home/ubuntu/workspace/.dsh-research/redlight-issue32/{task1-order,task2-gate,task3-doctor}.log` 三份证据。
- 验证范围：每个锚一轮「变异 → 红 → 恢复 → 绿」。

- [ ] Step 0（快照）：Task 1-3 的合法改动尚未提交，先落零残留判据的对照基线：`git status --porcelain > /home/ubuntu/workspace/.dsh-research/redlight-issue32/status-before.txt`。
- [ ] Step 1（锚①候选顺序）：备份 `cp src/core/dsh-version.ts /home/ubuntu/workspace/.dsh-research/redlight-issue32/dsh-version.ts.bak`，把 `readAppAsarVersion` 内 `candidates.push(join(dirname(...)))` 一行挪到 `if (resources)` 候选之前 → `npm run build && node --test tests/dsh-version.test.mjs` → Expected: **用例 6（双候选并存）红**（返回 0.2.1-rc.4 ≠ 断言的 0.2.1-rc.3；单候选用例 1/2 倒序后结果不变、不可红，故红灯判据只认用例 6）。恢复字节（`cp` 回）→ 重跑该文件测试绿。全程输出 `tee` 落 `.dsh-research/redlight-issue32/task1-order.log`。
- [ ] Step 2（锚②门控）：把 `if (isElectron) return null` 变异为 `if (false) return null` → 同文件测试 → Expected: 门控用例 4 红。恢复 → `git diff --exit-code` → 绿。证据 `task2-gate.log`。
- [ ] Step 3（锚③doctor 接线）：备份 host-api.ts 后把 `?? readAppAsarVersion()` 删去 → `npm run build && node --test tests/doctor-api.test.mjs` → Expected: 接线锚 it 红。恢复 → `git diff --exit-code -- src/core/host-api.ts` → 绿。证据 `task3-doctor.log`。
- Step 收尾判据（每个锚做完都要执行，共 3 次）：① `cmp /home/ubuntu/workspace/.dsh-research/redlight-issue32/<对应 .bak> <现文件>` 静默 = 字节还原；② `git status --porcelain > /home/ubuntu/workspace/.dsh-research/redlight-issue32/status-after-N.txt` 后与 `status-before.txt` 做 `diff`，静默 = 变异零残留（Task 1-3 的合法改动此时仍应在工作树，porcelain 非空是常态——判据是「与快照一致」而非「为空」）。

### Task 5: 全量收口

- Run: `cd /home/ubuntu/workspace/dsh-m && set -o pipefail && npm test 2>&1 | tee /home/ubuntu/workspace/.dsh-research/redlight-issue32/full-test.log`
- Expected: exit 0；总数 = 基线 1800（评审已在 scratch 副本亲跑复核 1800/1800、exit 0、60.5s）+ 新增 12（Task 1 共 6 it + Task 2 共 5 it + Task 3 共 1 it）= **1812**（以实跑计数为准，记入 CHANGELOG）。
- Run: `cd /home/ubuntu/workspace/dsh-m && npm run typecheck`
- Expected: exit 0，零输出。

### Task 6: 版本三处 bump + CHANGELOG 双语顶条

- 目标：发版前置（release.mjs 人工部分）。
- 涉及文件：`package.json`、`package-lock.json`、`CHANGELOG.md`。
- 接口契约：
  - Consumes: Task 5 实测总数。
  - Produces: 三处版本一致 = `0.10.25`；双语顶条含 `0.10.25`（check-release 门禁项 1/2 的输入）。
- 验证范围：三处一致性探针 + CHANGELOG 顶条探针 + 全量 npm test 复跑绿。

- [ ] Step 1: `package.json` `"version": "0.10.24"` → `"0.10.25"`（edit）。
- [ ] Step 2: lock 两字段同步（离线、零格式扰动优先）：

```bash
cd /home/ubuntu/workspace/dsh-m
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('package-lock.json','utf8'));j.version='0.10.25';j.packages[''].version='0.10.25';fs.writeFileSync('package-lock.json',JSON.stringify(j,null,2)+'\n')"
git diff -- package-lock.json
```

Expected: 逐行核对仅 2 处行对变更（根对象与 `packages[""]` 各一对 `"version"` 行）；若出现大面积重排（格式不合），改用 `npm_config_cache=/home/ubuntu/workspace/.npm-ci-cache npm install --package-lock-only` 重做（registry 命令须指 workspace 内缓存，workspace AGENTS 红线）。
- [ ] Step 3: CHANGELOG `## 中文` 节顶（`### 0.10.24` 之前）插入 0.10.25 中文条目；`## English` 节顶插入对应英文条目。骨架（症状/根因/修法/验证四段，措辞可润色、事实不可偏离）：症状 = issue #32 桌面带 dsh 系 peer 插件升级全被拦、报错版本实为 PATH 残留旧 CLI（0.1.0-rc.6 ≠ 真实 0.2.1-rc.3）；根因 = `resolveDshVersion()` 两通路桌面全失（launcher 正则不命中 Electron entry → spawn 命中 PATH shim），三处预检调用点均未注入 runtimeVersion；修法 = `readAppAsarVersion()`（内联 pickle 解析零新依赖、name 前缀 + semver + 越界守卫）优先、编排 `resolveDshVersionWith()` Electron 内 spawn 整体禁用（失败即 null，「未检不拦」）、doctor 一行受益，web/CLI 逐字节零变化；顺带备案 = 「PATH 来源版本在非 Electron 形态也不作 compat 判据（全面 fail-open）」为 follow-up 软项，本版不实施；验证 = 新增 asar fixture 6 用例 + 编排门控 5 用例 + doctor 接线锚 1 条、红灯复演三锚可红可绿（证据 `.dsh-research/redlight-issue32/`）、全量 `<实跑数>/<实跑数>`（口径 = 基线 1800 + 新增 12）+ typecheck 0。
- [ ] Step 4: 探针验证：

```bash
cd /home/ubuntu/workspace/dsh-m && set -o pipefail
node -e "const p=require('./package.json'),l=require('./package-lock.json');console.log(p.version,l.version,l.packages[''].version)"
test "$(grep -o '^### 0.10.25' CHANGELOG.md | wc -l)" = "2"
npm test 2>&1 | tail -3
```

Expected: 三处 `0.10.25`；`^### 0.10.25` 全文出现次数恰 2（中文区 + 英文区各一条；`grep -o | wc -l` 出现次数语义，与全局约束「不用 grep -c 行数语义」自洽）；各区「顶条位置」（首个 `###`）由 Task 7 `npm run check-release` 门禁 topAfter('## 中文')/topAfter('## English') 兜底验证（计划显式声明该依赖）；npm test exit 0。

### Task 7: 发布（npm run release + registry 轮询）

- 目标：推 main + tag，GitHub Actions「Publish to npm」绿后 registry 可查。
- 涉及文件：无代码改动（git/npm/gh 操作）。
- 接口契约：
  - Consumes: Task 6 三处 bump + 双语顶条 + 全量绿；Step 1 的 `git add -A && git commit` 使工作树变干净（release.mjs 的干净树检查在该提交之后运行，方可通过；Task 4 只保证变异零残留、不保证树干净）；gh 已登录 `iasiv5`（`gh auth status` 已验）。
  - Produces: npm registry 上 `dsh-m@0.10.25`；本任务把 HEAD hash 写入 `/home/ubuntu/workspace/.dsh-research/redlight-issue32/head-sha.txt`（Task 8 消费）。
- 环境前提：涉及 registry 的 npm 命令一律 `npm_config_cache=/home/ubuntu/workspace/.npm-ci-cache` 前缀（workspace AGENTS 红线）。

- [ ] Step 1: 提交并发布（仓库惯例直提 main，工作树须干净）：

```bash
cd /home/ubuntu/workspace/dsh-m && git status --porcelain
git add -A && git commit -m "fix(core): 桌面 peer 预检运行时版本改读应用自身 app.asar——PATH 残留旧 CLI 不再劫持兼容判定 (issue #32)"
npm run release
```

Expected: `release.mjs` 序列全绿（干净树 → tag v0.10.25 重钉 → check-release 门禁 → push main ×3 → push tag ×3）。
- [ ] Step 2: 等 Actions publish 绿（018：绿 ≠ 已上架）：

```bash
gh run list --repo iasiv5/dsh-m --limit 3
git rev-parse HEAD | tee /home/ubuntu/workspace/.dsh-research/redlight-issue32/head-sha.txt
```

Expected: 最新 run 为「Publish to npm」并转绿（`gh run watch` 可选）。
- [ ] Step 3: registry 直查轮询（分钟级 processing，窗口内不重推）：

```bash
npm_config_cache=/home/ubuntu/workspace/.npm-ci-cache npm view dsh-m version
```

Expected: 输出 `0.10.25`（未转正前每 2-3 分钟复查一次；备选工具 `01_docs/dsh-intall-know-how/tools/release-monitor.sh`）。

### Task 8: issue #32 回执

- 目标：回执根因确认、修复版本、致谢、真机验证邀请；说明其 PR 不必提交（同修法已落地，避免双改）。
- 涉及文件：无仓库改动；回执正文落 `.dsh-research/redlight-issue32/issue32-reply.md`。
- 接口契约：
  - Consumes: Task 7 的 `head-sha.txt`、实跑测试总数（Task 5 日志）、registry 转正事实。
  - Produces: issue #32 下一条可见评论。
- 验证范围：`gh issue view 32 --repo iasiv5/dsh-m --comments` 可见新评论。

- [ ] Step 1: 生成正文（heredoc 注入 SHA 与计数）后评论：

```bash
SHA=$(cat /home/ubuntu/workspace/.dsh-research/redlight-issue32/head-sha.txt)
cat > /home/ubuntu/workspace/.dsh-research/redlight-issue32/issue32-reply.md <<EOF
（正文要点：① 根因确认——逐行核实与你描述一致，launcher 正则在桌面必空、spawn 落 PATH，三处 precheck 调用点均未注入 runtimeVersion；② 修法采纳你的建议——asar 通路（pickle 头 + 内嵌 package.json 实体，name 前缀 + semver + 越界守卫）优先、编排层 Electron 内 spawn 整体禁用、doctor 一行受益；web/CLI 行为零变化；③ 已发布 0.10.25（commit ${SHA}），欢迎在桌面机升级 dsh-m 后复测原 5 个插件；④ PR 不必提交——与你的本地修法同构，避免双改；多谢这份高质量报告，asar 头布局实测数据直接省掉了我们在 Windows/Electron 44 上的取证。）
EOF
gh issue comment 32 --repo iasiv5/dsh-m --body-file /home/ubuntu/workspace/.dsh-research/redlight-issue32/issue32-reply.md
```

Expected: 评论 URL 输出；`gh issue view 32 --repo iasiv5/dsh-m --comments` 可见。
- [ ] Step 2（真机验证为发布后回执项，不在本轮阻塞）：桌面真机复测依赖报告者或主人在 Windows 机升级后反馈；若反馈异常，按「asar 解析在真机的偏差」立项排查，不在本计划范围内猜改。

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项/矛盾/命令无效先修计划再动手。
- **fixture/探针类代码块入计划前必须 node 实跑一次**（评审 T0 实证教训：fixture 与实现的 offset 契约差 4 字节，纯静态审读未拦住。证据链：计划 fixture 原文（+4）实跑 FAIL=6（probe-task1.log）→ 修复为 `headerStr.length + 8` 后 14/14 PASS（probe-task1-fixed.log）→ 修复已采纳进 Task 1 Step 1）。
- 按任务顺序执行，不无声跳步、合并或改目标；每完成一个任务立即跑该任务定义的验证并判退出码。
- 本计划直接在 `main` 实施（仓库惯例：历史版本均直提 main 随发版推送；工作树除本计划文件未跟踪（`?? docs/plans/2026-10-28-desktop-asar-runtime-version-implementation-plan.md`，Task 7 Step 1 `git add -A` 一并入库）外无其他改动——评审实测口径，防「porcelain 为空」虚报；主人已批准修复动作）。Task 6 的 bump 提交与 Task 7 的发版提交可合并为一笔（commit message 用 Task 7 Step 1 所拟）。
- 构建类命令（tsc/esbuild 子进程）在当前沙箱若报 `spawn EPERM`，按仓规升级权限重试一次；`/tmp` 与 npm 缓存红线按 workspace AGENTS（跨步骤中间产物放 `.dsh-research/`，registry 命令指 `npm_config_cache`）。
- 遇到重复失败或计划与仓库现实不符，立即停下说明，不猜。
- 全部任务完成后运行最终验证并输出修改摘要。

## 最终验证

```bash
cd /home/ubuntu/workspace/dsh-m && set -o pipefail
npm test 2>&1 | tail -3          # exit 0，总数 = Task 5 记录值
npm run typecheck                # exit 0
git status --porcelain           # 空
npm_config_cache=/home/ubuntu/workspace/.npm-ci-cache npm view dsh-m version   # 0.10.25
gh issue view 32 --repo iasiv5/dsh-m --comments | tail -20                     # 回执可见
```
