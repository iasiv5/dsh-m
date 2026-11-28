# 实施计划：委派 fail-closed 与宿主真拒绝的报错区分（task-1，2026-11-28）

主人已拍板：跳过 grill、短计划直落、做一次对抗评审。设计决策 D1=check 抛专用错误（不改 `RequestTrustCheck` 三态签名）/ D2=「服务缺席」与「服务抛错」同一新文案 / D3=新文案+结构化 code。**fail-closed 判定不变：缺席/抛错仍 403 全拒，唯一变化是响应 error 文案与新增 `code` 键。**

## 现状事实（当场取证）

- `src/core/host-api.ts` parseRequest：`catch { rejection = 403 }` 吞一切 check 异常（注释「异常细节不外泄」），与真拒绝共用 `ApiProtocolError(403, '请求未通过宿主信任检查（不可信 Host/Origin 或跨站）')`；`ApiProtocolError` 仅模块内 class，errorStatus 分支只出 `{ok:false, error}`。
- `src/host.ts` `createRequestRejection(ctx)`：惰性 `ctx.get('connection')`（webServer 注入早于 connection 挂载，**惰性必须保留**），缺席/抛错 → `warnOnce` + `return 403`。**该函数零测试覆盖**（tests/ 无 createRequestRejection 引用，2026-11-28 grep 实证）。
- deps 缺省：`host-api.ts:360` `ctx.deps?.rejectRequest ?? (() => 403)` —— 不注入时走恒 403 stub，非 TypeError。
- 普查（2026-11-28 实跑）：① 旧文案「请求未通过宿主信任检查」在 tests/ 锚数 **0**；② `trust-delegation-unavailable` 在 lib/core/host-api.js **0**（新增锚 HEAD=0）；③ `createRequestRejection` 在 src/host.ts **2**（定义+调用，退役锚 HEAD>0）；④ 新符号在 src **0**。错误响应 body 无全对象 deepEqual 断言（只查 status）；客户端 `payload.code` 零消费，error 文案经 i18n `failed.load`（`加载失败：{err}`）直接透出——新文案无需动 client。
- 测试形态：`tests/host-api.test.mjs` 静态 `import { createApiDispatcher } from '../lib/core/host-api.js'`，`callApi(dispatcher, { headers, body })`，`JSON_HEADERS` 常量在位；信任委派既有用例 L235（只断 status 403，不锚文案）。

## 改动面（符号锚）

1. `src/core/host-api.ts`：
   - 导出 `class TrustDelegationUnavailableError extends Error {}`。
   - 导出 `TRUST_DELEGATION_UNAVAILABLE_MESSAGE = '请求未通过宿主信任检查（宿主信任检查服务不可用，已按 fail-closed 全拒）'`（D3 文案钉死）。
   - 导出 `createDelegatedTrustCheck(ctx)`：返回惰性 check——每次调用 `ctx.get?.('connection')`，`connection.requestRejection` 为函数 → `reject.call(connection, { headers }) ?? undefined`；缺席或调用抛错 → `warnOnce`（原文案 `'dsh-m: 官方 connection.requestRejection 不可用，/dshm 全入口 fail-closed 403（ADR-0005）'` 保留，journal grep 口径不变）+ `throw new TrustDelegationUnavailableError()`。
   - parseRequest catch：`instanceof TrustDelegationUnavailableError` → `throw new ApiProtocolError(403, TRUST_DELEGATION_UNAVAILABLE_MESSAGE)`；其余异常照旧 `rejection = 403`（注释改写：委派不可用按 ADR-0005 追记以专用文案区分，其余异常仍不外泄）。
   - `ApiProtocolError` 构造器加可选第三参 `code`；errorStatus 的 ApiProtocolError 分支 `...(err.code ? { code: err.code } : {})`。
2. `src/host.ts`：删除 `createRequestRejection`（退役锚③），改 `import { createDelegatedTrustCheck }`，调用点 `const rejectRequest = createDelegatedTrustCheck(ctx)`。
3. 不动：`RequestTrustCheck` 类型、`deps.rejectRequest` 缺省 stub、client 全部。

## 红绿矩阵（tests/host-api.test.mjs 新 describe「委派 fail-closed 与真拒绝的报错区分」）

| 用例 | 注入 | 期望 | 红相形态 |
|---|---|---|---|
| A fail-closed 区分 | stub 抛 `TrustDelegationUnavailableError` | 403 + error=新文案 + `code='trust-delegation-unavailable'` | 红：静态 import 新符号 → 套件加载失败（`does not provide an export named 'TrustDelegationUnavailableError'`）——**预期红形态**，非判据永真 |
| B 普通异常仍不区分（负向锚） | stub 抛 `TypeError('boom')` | 403 + 旧文案 + payload **无** `code` 键 | 红：现行为 error 无断言，新断言「=旧文案」HEAD 上即真 → **本用例是绿驱动护栏非红驱动**；红相来自同 describe 加载失败 |
| C 真拒绝不变 | stub 返回 403（镜像 L235 形态） | 403 + 旧文案 + 无 `code` 键 | 同 B（护栏） |
| D1 core 工厂·服务缺席 | 假 ctx `get→undefined` | check 抛 `TrustDelegationUnavailableError`；logger.warn 恰 1 | 红同 A |
| D2 core 工厂·服务抛错 | connection.requestRejection 抛 TypeError | 抛 `TrustDelegationUnavailableError`；warn 恰 1 | 红同 A |
| D3 core 工厂·在位透传 | requestRejection 返回 403/401/undefined 三态 | 逐态透传；不 warn | 红同 A |
| D4 core 工厂·warnOnce | 缺席 ctx 连调 3 次 | warn 恰 1（纪律钉测） | 红同 A |

夹具纪律：新 describe 自带 helper 与假 ctx 构造，不引兄弟 describe 闭包；注入形态镜像生产（只传顶层 deps.rejectRequest，无内层双注）。

## 判据命令（含已实跑基线）

- 红/绿主判据：`set -o pipefail; npm run build >/dev/null && node --test tests/host-api.test.mjs`（构建后跑，import 走 lib 产物）
- 源结构锚（出现次数语义）：`node -e "const s=require('fs').readFileSync('src/core/host-api.ts','utf8'); console.log(s.split('trust-delegation-unavailable').length-1)"` 预期 **=1**（绿相实跑修正：字面量仅 parseRequest 映射点一处，`TRUST_DELEGATION_UNAVAILABLE_MESSAGE` 常量值不含该词；计划原写 ≥2 系预期笔误，2026-11-28 绿相实跑修正）；lib ASCII 锚同词 **=1**（合法 bundle 锚形态，绿相实跑取数）。
- 退役锚：改后 `grep -o 'createRequestRejection' src/host.ts | wc -l` 预期 0；新符号 `createDelegatedTrustCheck` 在 src/host.ts 预期 2（import+调用）。
- 门禁：`npm run lint`；全量 `npm test`（同机单跑，无并发全量）。

## 文档同步（随实现同批）

- `docs/adr/0005-dual-profile-support.md` Consequences 追记：fail-closed 判定不变；委派不可用响应以专用文案+code 区分（ADR-0005 原「异常细节不外泄」收窄为「检查异常细节不外泄，委派不可用状态除外」）；安全评估：暴露「委派缺失」状态但栅栏仍全拒，无可利用信息增益。
- `README.md` / `README.en.md` FAQ fail-closed 分支句更新为「新版报错文案直接区分（宿主信任检查服务不可用 = 委派 fail-closed）」，旧 grep 日志指引降级为备选。
- CHANGELOG 双语顶条在发版步骤写（引用 tests/host-api.test.mjs）。

## 发版步骤闭合（0.12.26 → 0.12.27）

实现+评审绿后：版本三处 bump（package.json / package-lock / CHANGELOG 双语顶条）→ `npm run check-release` 全绿 → `npm run release`（push/tag/publish，**执行前停下等主人当轮批准**）→ 发版后 `dshm_upgrade dsh-m` + 活体验收（loopback 探针 B/C 形态对照新文案）。

## 验收清单（评审逐条可核对）

- [ ] 矩阵 A–D4 七用例在 diff 中可指认，评审亲跑定向套件命令
- [ ] 退役锚=0 / 新符号锚计数与计划一致（实跑对表）
- [ ] ADR/README/CHANGELOG 三处同步在 diff 中可指认
- [ ] 对抗评审（子代理）通过：语义泄漏面、跨面普查复核、夹具假绿排查
- [ ] 全量 npm test 当轮取数（计数新鲜度）
