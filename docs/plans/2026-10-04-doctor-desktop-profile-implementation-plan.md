# Doctor Desktop Profile 支持实施计划（0.9.31）

## 目标

- 修订 ADR-0010 决定 6（web 先行）：doctor 作为纯 FS 只读体检，成为 CLI 上唯一允许 `--profile desktop` 的子命令；变更类命令维持拒绝语义不变。
- desktop-only 机器的「扫空气目录全 0」困惑：加明确提示（布局 unknown 且三项全 0 时）。
- 宿主 method 通路**零改动**（已 active-profile 无关，desktop 宿主自动生效）——补一个 desktop-kind 的接线测试钉住该性质。
- Windows 实机 E2E 不在本机执行：产出验收清单交 Windows 机 agent 执行。

## 架构快照

- `runDoctor(profileDir, runtimeVersion)` 本就按目录参数化，无 web 硬编码（Windows 机报告实机推演确认：desktop profile 判 hoisted、物化目录 farm 0 属常态）。
- CLI 全局守卫在 runCliDispatch 入口（`profileFlag !== 'web'` 即拒）；doctor 例外需在此开口并在 doctor case 内路由目录。
- MCP 工具 `dshm_doctor` **维持 ADR-0010 决定 3 缓上**（用户拍板 2026-10-04）；Windows 机 agent 走 CLI（bin 入口 0.9.30 已修复）。

## 全局约束

- doctor 例外仅限只读子命令：`install/upgrade/uninstall/toggle/restart/list/search/outdated/registry` 等对 `--profile desktop` 的拒绝语义逐字不变（须有测试钉住）。
- `--profile` 合法值仍只有 web|desktop（doctor 语境）；其他值照旧拒绝。
- farmChecked=0 语义修订：**空转判定仅适用于存在符号链农场的形态**（web 机）；hoisted 物化布局（典型 desktop）0 为常态值，不算验收失败（写入 ADR-0011）。
- 诚实记录：Windows Electron 宿主的 argv[1] 大概率不匹配 launcher 形态 → method 通路 runtimeVersion 在 desktop 宿主可能仍降级（该形态 farmChecked=0，stale 无判定对象，实际影响为零）。
- 版本号 0.9.31；验证命令同仓惯例（typecheck / node --test 单文件 / npm test 全量，基线 1079）。

## 文件结构与职责

- Modify: `src/core/env.ts` — 新增 `DESKTOP_PROFILE` 常量 + `desktopProfileDir()`。
- Modify: `src/cli.ts` — 守卫开口（仅 doctor+desktop）；doctor case 路由目标目录 + 输出行补 profile 名标注 + 空目录提示；HELP 更新 `[--profile web|desktop]`。
- Modify: `tests/doctor.test.mjs` — CLI desktop 路由/标注/空提示/他命令拒绝回归 四组用例。
- Modify: `tests/doctor-api.test.mjs` — desktop-kind profile 接线用例（钉住 method 通路的 profile 无关性）。
- Create: `docs/adr/0011-doctor-desktop-profile.md` — 决策 + ADR-0010 末尾指针。
- Modify: `dsh-m/docs/adr/0010-doctor-read-only-diagnostics.md` — 末尾加被修订指针（决定 6）。
- Modify: `GLOSSARY.md`（体检词条：CLI 双 profile + farmChecked 语义）、`docs/DESIGN.md` §5 体检行、`CHANGELOG.md` 双语、`package.json` 0.9.31。

## 任务清单

### Task 1: env 助手 + CLI 守卫开口与路由（TDD）

- Consumes: 现有全局守卫（cli.ts L227-232）、`webProfileDir()`。
- Produces: `DESKTOP_PROFILE`/`desktopProfileDir()`（env.ts）；`doctorDesktop = cmd==='doctor' && profileFlag==='desktop'` 例外；doctor case 内 `profileFlag==='desktop' ? desktopProfileDir() : webProfileDir()`；输出首行 `profile 体检 · [web|desktop] · <dir>`；HELP 行更新。
- 验证：
  - [ ] 失败测试：fixture 建 `DSH_HOME/profiles/desktop`（workspace hoisted + 1 依赖 + node_modules 实包），跑 `doctor --profile desktop --json` → profileDir 指向 desktop、layout=hoisted、accountChecked≥1、exit 0；人读输出含 `[desktop]` 标注。
  - [ ] 回归钉子：`list --profile desktop` → exit 1 拒绝文案不变；`install --profile desktop` 同拒；`doctor --profile foo` → 拒绝；`doctor --profile web` → 照常。

### Task 2: 空目录提示（TDD）

- Produces: doctor case 呈现层——`layout==='unknown' && farmChecked===0 && residueCount===0 && accountChecked===0` 时输出「目标 profile 目录无任何可扫描内容（可能不存在或为空）；desktop-only 机器请加 --profile desktop」。
- 验证：fixture DSH_HOME 无 profiles/web，默认 doctor → 提示行出现且 exit 0；正常 profile 不出提示。

### Task 3: host-api desktop-kind 接线钉子（TDD）

- Produces: doctor-api.test.mjs 新用例——dispatcher 注入 `{name:'desktop', kind:'desktop', dir:<fixture desktop 目录>, source:'host'}` → `ok:true`、report.profileDir 指向该目录（证明 method 通路 active-profile 无关，desktop 宿主免改生效）。
- 验证：单文件测试通过。

### Task 4: 文档 + 发版

- ADR-0011（决策：CLI 例外仅 doctor / farmChecked 语义修订 / MCP 维持缓上 / Windows 宿主版本解析诚实记录 / Windows E2E 外机执行）；ADR-0010 决定 6 加被修订指针；GLOSSARY/DESIGN/CHANGELOG/版本号。
- 全量回归 → 评审（exec-reviewer 快评）→ tag v0.9.31 → publish → 本机装机回归（web 通路不回归）→ Windows 验收清单交付。

## Windows 验收清单（外机执行，随交付物发出）

0. （本轮动机场景，评审 G5.1 补）默认 `dshm doctor`（无 flag，web 目录不存在）：输出「目标 profile 目录不存在（…）；desktop-only 机器请加 --profile desktop」提示行且 exit 0——desktop-only 机是空提示的唯一真实舞台。
0b. （前置条件）宿主 method 验证前需先在该机 desktop profile 安装 dsh-m ≥0.9.31（method 随插件注册）。
1. `dshm doctor --profile desktop`：profileDir=~/.dsh/profiles/desktop、`[desktop]` 标注、layout=hoisted、accountChecked>0 且为真实扫描、errors=0、exit=0。
2. 宿主 method（desktop 宿主内 POST /dshm {"method":"doctor"}，前置见 0b）：ok:true、profileDir=desktop 目录；runtimeVersion 允许为 null（Electron argv 形态，诚实降级）。
3. 零写入零派生：体检前后 profile 目录 mtime 无变化。
4. `dshm install --profile desktop --id <任意> --yes` 仍被拒绝（语义不变）。
5. 变更类命令对 web 的既有行为不变。

## 执行纪律

同仓惯例：先复查计划；逐任务验证；遇计划与仓库现实不符即停；全量回归收口。
