# dsh-m agent navigation

This file is a navigation index; repository scripts and [`docs/CODING-STANDARDS.md`](docs/CODING-STANDARDS.md) are the sources of truth. Before changing or reviewing dsh-m code/tests, read the coding standards; they define test-anchor, evidence, plan-traceability, and exit-code rules.

## Owning code and tests

- **Merged materialization / displacement / identity indexes**: `src/core/merged-market.ts`; tests and integration harness: `tests/merged-market.test.mjs`.
- **Market result assembly and filtering**: `src/core/market.ts`; behavior tests: `tests/market.test.mjs`; full-return golden snapshots and reusable `goldDeps` fixture: `tests/market-golden.test.mjs`.
- **Query input grammar only**: `src/core/market-query.ts` and `tests/market-query.test.mjs`. This suite does not provide a `listMarket` integration harness.
- **Upgrade-target resolution（升级目标解析，ADR-0028）**: `src/core/upgrade-target.ts`; tests: `tests/upgrade-target.test.mjs`. Sole judge of installed-plugin → installable-entry / unsupported; projection and both upgrade ladders consume it.
- **Market card rendering and badge wiring**: `src/client/market-tab.jsx`; SSR/source-anchor checks: `tests/client-render-smoke.test.mjs`; i18n key coverage: `tests/client-i18n.test.mjs`.
- **Installed-package enumeration and manifest metadata**: `src/core/installed.ts`; tests: `tests/installed.test.mjs`.

## Verification entry points

`package.json` scripts are authoritative. `npm test` builds via `pretest` and runs the import guard plus `tests/*.test.mjs`; `npm run typecheck` runs TypeScript checks. Before either gate, follow the workspace AGENTS.md dependency preflight; preserve the original process exit code when filtering test output.

- **测试锚计数/存在性探针**：node `src.split(needle).length - 1`（或 `grep -F` 裸子串）——`grep -c` 计 0 即 exit 1 且正则转义易错（退出码卫生的使用现场口径，2026-10-31 retro）。

## Repository references

- Read GitHub issue/PR bodies via `api.github.com/repos/iasiv5/dsh-m/issues/<n>` (the web page is a JS shell; a plain fetch returns only navigation chrome).
