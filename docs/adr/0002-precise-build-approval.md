# needs-builds 拦截后从全量放行收窄为精确放行

pnpm 拦截依赖构建脚本（needs-builds）后，dsh-m 此前用 `dangerouslyAllowAllBuilds: true` 一次性放行全部待决脚本并继续。我们决定对齐官方 plugin-manager 的精确语义：解析 `pnpm-workspace.yaml` 里 pnpm 留下的待决名单（值为 `set this to true or false` 的无通配符键），只为这些包逐键写 `allowBuilds: {pkg: true}`；名单读不出（格式漂移、键带通配符）时才回退全量放行，且结果里明确标注走的是兜底。

理由：全量放行把「本次安装需要的脚本」放大成「profile 内一切未来脚本的永久许可」，精确放行把许可面收回到实际涉及的包；官方同款判定已在生产验证，直接移植成本低于自创新格式。

## Consequences

- 安装/升级结果中原 `usedAllowAllBuilds: boolean` 的报告语义升级为 `buildApprovals: string[]`（放行了谁）+ 兜底标志，notify 文案从「按策略放行」改为列包名。
- 结果类型是破坏性变更，随 0.4.0 一起发（GUI/CLI/agent 工具三入口同步改）。
