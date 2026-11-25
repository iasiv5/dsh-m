# needs-builds 拦截后从全量放行收窄为精确放行

pnpm 拦截依赖构建脚本（needs-builds）后，dsh-m 此前用 `dangerouslyAllowAllBuilds: true` 一次性放行全部待决脚本并继续。我们决定对齐官方 plugin-manager 的精确语义：解析 `pnpm-workspace.yaml` 里 pnpm 留下的待决名单（值为 `set this to true or false` 的无通配符键），只为这些包逐键写 `allowBuilds: {pkg: true}`；名单读不出（格式漂移、键带通配符）时才回退全量放行，且结果里明确标注走的是兜底。

理由：全量放行把「本次安装需要的脚本」放大成「profile 内一切未来脚本的永久许可」，精确放行把许可面收回到实际涉及的包；官方同款判定已在生产验证，直接移植成本低于自创新格式。

## Consequences

- 安装/升级结果中原 `usedAllowAllBuilds: boolean` 的报告语义升级为 `buildApprovals: string[]`（放行了谁）+ 兜底标志，notify 文案从「按策略放行」改为列包名。
- 结果类型是破坏性变更，随 0.4.0 一起发（GUI/CLI/agent 工具三入口同步改）。

## 0.12.2 工具层接线（issue #41）

精确放行的重试通道自 core 透传（`installBundle(spec, { approvedBuilds })`）延伸到 agent 工具入参：`dshm_install` / `dshm_upgrade` 新增 `approvedBuilds: string[]`，语义为「上次结构化未遂（needsBuildApproval）返回的 pendingBuilds 原样回传」，且必须经用户确认后使用。信任模型不变：仍按精确名单逐键放行、不做全量放行；与 `force`（跳过 peer 预检）同级——模型发起、人确认。

不带回显校验（「本次回传名单 ⊆ 上次 pending 名单」的比对）的理由：外部操作账本的记录白名单只有 reason 字符串、无结构化 pendingBuilds 字段，校验需要引入新的持久状态；真正的闸门是精确放行语义本身 + 用户确认环节，名单范围错误的代价被逐键放行的许可面上限封死。

配套确立渲染层总不变量：`renderInstall` / `renderUpgrade` 对任何 `ok: false` 的结果永不输出「✅ 已安装/已升级」（needsBuildApproval 专臂 + ok:false 兜底臂）。0.8.5 曾为 guard 形态修过同类假成功，本次是该 bug 类的第二次漏网，不变量为其结构性收口。

## 修订（2026-11-25 · 安全审计 sfind-5dbc…：全量兜底退役）

本文「名单读不出时才回退全量放行」的兜底分支退役：安全审计确认 web 事务路径不经确认就自己写入（desktop 才有 `approvedBuilds` 确认环节），且 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 这类拦截不留占位名单、必然落进全量兜底——一次触发即向 profile 的 `pnpm-workspace.yaml` 写入 `dangerouslyAllowAllBuilds: true` 并永不撤销，pnpm 构建脚本闸门被永久关闭。修订后三端同语义：

- ladder 只对调用方回显在 `approvedBuilds` 里的包名写 `allowBuilds.<name>: true`（回显 ∩ pnpm pending 交集，未知项不写）；未获同意 → 零写盘，经 `buildApprovalNeeded` + `pendingBuilds` 一路上交为结构化 `needsBuildApproval` 结果（web 与 desktop 同形，客户端/工具/CLI 三入口同一渲染）。
- `withDangerouslyAllowAllBuilds` / `writeDangerouslyAllowAllBuilds` 删除；`fallbackAll` / `fallbackAllBuilds:true` 生产路径不再产生（字段保留为兼容标记，恒 false）。
- 名单不可得（无占位/workspace 不可读）→ 结构化请示（pendingBuilds 空 + 指引文案），不重试、不写盘——宁可失败，不关闸门。

Consequences 补充：CLI 新增 `--approved-builds <包名,包名>` 重试通道；web `/dshm` install/upgrade/self-upgrade 请求体新增 `approvedBuilds`。旧 profile 里已存在的 `dangerouslyAllowAllBuilds: true` 不被本修订自动清理（删除会改变用户既有安装面，超出插件市场的职责边界），但 dsh-m 从此不再制造新的。

行为收敛备案（compensate/uninstall 臂）：守卫补偿的依赖恢复臂（compensate-install 门）与 uninstall 门不走放行语义——补偿回装若被构建拦截，按 `ADD_FAILED` fail-closed 回滚（未遂详情在 note 散文，不映射 `BUILD_APPROVAL_REQUIRED` 结构化请示）。修复前该臂会自动放行后「成功恢复」；修复后一律失败回滚，属安全优先的有意收敛（恢复的是用户已卸载的旧依赖，为其脚本请求放行不该绕过确认环节）。
