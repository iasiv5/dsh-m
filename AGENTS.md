# dsh-m agent navigation

This file is a navigation index; repository scripts and [`docs/CODING-STANDARDS.md`](docs/CODING-STANDARDS.md) are the sources of truth. Before changing or reviewing dsh-m code/tests — or writing implementation plans / red-lines for them — read the coding standards; they define test-anchor, evidence, plan-traceability, and exit-code rules (their evidence-discipline section explicitly governs plans and CHANGELOG claims).

## Owning code and tests

- **Merged materialization / displacement / identity indexes**: `src/core/merged-market.ts`; tests and integration harness: `tests/merged-market.test.mjs`.
- **Market result assembly and filtering**: `src/core/market.ts`; behavior tests: `tests/market.test.mjs`; full-return golden snapshots and reusable `goldDeps` fixture: `tests/market-golden.test.mjs`.
- **Query input grammar only**: `src/core/market-query.ts` and `tests/market-query.test.mjs`. This suite does not provide a `listMarket` integration harness.
- **cordis.patch.yml 解析三纯函数（行枚举/行覆盖编辑/覆盖行读取）**: `src/core/patch-yaml.ts`。写 patch fixture 前先读它——口径：根非序列/坏 YAML/注释-only 文件 = `readable:false`（不可读），「可读的空 patch」规范形态是 `[]`（2026-11-07 install-guard 壳豁免轮实录：注释-only 夹具多付一轮红）。
- **Upgrade-target resolution（升级目标解析，ADR-0028）**: `src/core/upgrade-target.ts`; tests: `tests/upgrade-target.test.mjs`. Sole judge of installed-plugin → installable-entry / unsupported; projection and both upgrade ladders consume it.
- **Market card rendering and badge wiring**: `src/client/market-tab.jsx`; SSR/source-anchor checks: `tests/client-render-smoke.test.mjs`; i18n key coverage: `tests/client-i18n.test.mjs`.
- **Installed-package enumeration and manifest metadata**: `src/core/installed.ts`; tests: `tests/installed.test.mjs`.
- **dshm_search 输出（含注册表状态行）**: `src/tools.ts`（`renderSearch` / `registryNoteOf`）；tests: `tests/tools-search.test.mjs`.
- **dshm_* 工具注册与 schema 断言**: `src/tools.ts`（`registerTools` 第四参可注入 profile）；`defineTool` 把 parameters 规范化为 JSON Schema `{type, properties, required}`——测试断言打 `parameters.properties.<字段>`，不是 `parameters.<字段>`（0.12.2 #41 实录：断言落空付一次探针）。

## Verification entry points

`package.json` scripts are authoritative. `npm test` builds via `pretest` and runs the import guard plus `tests/*.test.mjs`; `npm run typecheck` runs TypeScript checks. Before either gate, follow the workspace AGENTS.md dependency preflight (`test -d node_modules`; recovery details in `01_docs/agent-ops/README.md`「仓内构建与依赖恢复」); preserve the original process exit code when filtering test output.

- **测试导入约定**：`src/core/*.ts` 没有可直接 import 的 JS，相关测试从 `lib/core/*.js`（构建产物）引入；单文件跑测试前先 `npm run build`，否则测到的是旧产物。`src/client/*.js` 的测试直接引 `src/client/`。
- **大 fixture**：`tests/fixtures/search-normalize-corpus.json` 为每行一条用例的 JSON；全文搜索 tests 时排除 `tests/fixtures/**`，需要用例时按行检索。
- **测试锚计数/存在性探针**：node `src.split(needle).length - 1`（或 `grep -F` 裸子串）——`grep -c` 计 0 即 exit 1 且正则转义易错（退出码卫生的使用现场口径，2026-10-31 retro）。
- **跨面符号普查**（找某符号全部触点）：禁用 `--include=*.ts` 类扩展名过滤——`src/client/` 全是 `.js/.jsx`，会漏整个客户端面（0.12.2 #41 实录：首轮普查漏掉 market-tab.jsx 的 GUI 假成功，恰为 issue 低估的那一半）。

## Releasing

- 发版走 `npm run release`（脚本头部列出前置条件与步骤，含 lock 三处同步）；门禁 `npm run check-release`。不要手动打 tag：2026-11-01 实录，tag 落在未包含 registry.json 的提交上、lock 未同步，CI 门禁两次失败并两次重打 tag。
- **发版动作需当轮明确批准**：`npm run release`（push/tag/publish）与 issue 关闭属不可逆公开动作——「批准开工」不默认涵盖发版与关闭步骤，执行到二者前停下等主人确认。（2026-11-02 #42 战役实录：批准开工后被中途叫停一次、回帖草案另送审一次。）
- lock 三处一致判定见 `scripts/release-lock.mjs`；`scripts/release.mjs` 发现不一致时自动同步，同步后的 `package-lock.json` 需纳入发版提交。
- 新增 registry 分类的顺序（先发版 → 宿主升级 → 再推 registry）由 `scripts/validate-registry.mjs` 的分类门禁机械检查（判定逻辑在 `scripts/registry-categories.mjs`）；CHANGELOG 的兼容性说明同步记录。

## Repository references

- Read GitHub issue/PR bodies via `api.github.com/repos/iasiv5/dsh-m/issues/<n>` (the web page is a JS shell; a plain fetch returns only navigation chrome). Anonymous API hits rate-limit 403 fast — use the authenticated local `gh api repos/iasiv5/dsh-m/issues/<n>` instead.
- 收录 PR 的评审与回复 playbook：`../01_docs/dsh-m-registry-playbook.md`（私有 01_docs，不进入本仓库）。
