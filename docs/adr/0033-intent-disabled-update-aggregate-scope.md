# 更新聚合口径排除「意图停用」：意图层/活体层分离（ADR-0033）

## 决策

已装页红点计数（`installedUpdateStats`）与「全部更新」目标集（`batchUpgradeOrder`）排除且**仅排除**「意图停用」（GLOSSARY 定语）插件；判据是 `composeEnablement` 新派生的持久层字段 `userDisabled`（仅 `true` 落键）：

```
userDisabled = (!inBundles && hasPatchLayer)                          // Bundle 退选
            || rowIds.some(id => overrideIndex.get(id) === true)      // 行覆盖 disabled:true
```

- **活体分支也查 `overrideIndex`**（此前只在 CLI 无 loader 分支查）：委派关闭（`setBundleEnabled` → bundle 退选）与降级关闭（`cordis.patch.yml` 行覆盖）都是用户意图的持久化记录；宿主门控拦截（peer 失配等）不写这两类记录，故 `userDisabled` 恒 false。
- **门控挡下、加载失败（phase failed）、loader 未挂载、纯依赖（no-entry）永不构成意图停用**——它们照旧计入红点与「全部更新」；self/protected 保护名照旧锁定。`enabled` 字段语义不变（活体观察），不参与过滤。
- **行级通道永不过滤**：每卡片「更新」按钮只看 `outdated`（现状已如此），停用插件随时可单独更新——升级自愈通道在聚合与行级两个层面都保留。
- **服务端探测保持全量**：`installedUpdates` 仍探测全部已装包（含停用），`latestError`/检查未完成语义不动；本决策只改聚合计数口径与批量目标集。
- **呈现纪律**：已装列表停用行（`userDisabled`）排序沉底（稳定分区，不披露原因、不加折叠提示行——dshmarket 实践证明行级按钮 + 沉底够用）；不做 ignore/exempt/blocked 静默体系（与停用正交，另开 issue）。

背景：#53（appllove 提案按 `enabled` 过滤红点与全部更新，2026-11-08 被拒——拒绝理由是 dsh-ops 0.4.4 反例：peer 失配门控挡下的插件观察量 `enabled:false, toggleable:true, phase:null` 与用户显式关闭完全同形，判据不可区分，而升级通道是此类插件唯一自愈路径）与 #59（Niefee：插件多、更新耗时，「不想更新关闭的插件」）。经比对 **dshmarket 1.73.17**（`client.js` :13508 `updatableNames` 过滤 `effectiveDisabledSet`；三源 `marketState.disabled` ∪ `patchDisabled` ∪ `unbundled` 全部是持久层意图记录，`routes.ts` :655/:3504；活体状态在独立的 `activation` 数据里，只用于显示与排序）证实：**「不可区分」只在单字段活体观察量下成立；意图用持久层记录表达后，用户关闭与宿主门控天然可区分**。dsh-ops 形态（仍在 bundles、无覆盖）在 dshmarket 模型下留在 updatable 集合内、自愈不受损。#53 的拒绝结论由此被第三条路取代，但其守护的不变量以更精确的形态保留：**升级通道无条件（对活体异常/门控/依赖），聚合可过滤（对持久层意图）**。

## Considered Options

- **按 `enabled` 过滤（#53 原案）**：被否——dsh-ops 0.4.4 反例（见背景）；`enabled:false` 观察量四成因（用户关闭/门控挡下/未挂载/加载失败）同形，过滤即永久断掉门控插件的自愈升级。
- **`enabled===false && toggleable===true && phase!=='failed'` 守卫修正案**：被否——`phase:null !== 'failed'` 恒真，守卫只覆盖加载后崩溃（有 fiber），覆盖不了加载前被门控挡下（无 fiber）的形态；多判据还引入新的误判面。
- **维持全量计入（#53 拒绝后的现状）**：被否——#53 的降噪诉求与 #59 的意图诉求（「不想动关闭的」）长期悬置；dshmarket 是社区事实标准，其聚合口径排除停用已是用户习惯（两案提案者与社区都以此为预期）。
- **意图层过滤（本决策）**：采纳——持久层信号可区分意图与活体；dsh-ops 形态不在 bundles 退选、无行覆盖，`userDisabled` 恒 false，自愈通道完整保留。

## Consequences

- `composeEnablement` 输出每包增派生字段 `userDisabled`（仅 true 落键，沿 `community:true` 省略惯例）；join 位于 `listInstalledWithMeta` probeMode 分支之前（`src/core/market.ts` :940-952，「enablement join」注释锚），`installed` 快慢两段载荷都携带；`installedUpdates` 七字段白名单不动（客户端合并 `...it` 展开保留）。
- **用户可见行为变更**：停用插件的 ⬆ 徽标仍在卡片上（行级不动），但不再计入 tab 红点数与「全部更新 (n)」；停用行沉底。CHANGELOG 以 0.12.12 记录。
- **自愈保证可测**：dsh-ops 形态（in bundles、无 override、无 live row）断言 `userDisabled` 缺席且 `enabled===false`——此形态必须出现在 enablement 套件中，作为本决策的守护红例。
- GitHub 预算与探测成本零变化（探测面不动）；#59 的耗时治理走 ADR-0008 修订（第二段 TTL 化），与本决策互为独立的两半。
- GLOSSARY 入库三术语：「意图停用」「未运行」「更新聚合口径」；「运行相位」条目同步修正（无 fiber = 未运行，非已停用）。
- dshmarket 的 heldUpdate/maturity/restoreRequired/sourceMigration 等更新语义不在本决策范围（多数是 desktop pnpm 特有，web profile 无对应痛点）。
