# 重启终态回传：状态文件 + 惰性折叠（ADR-0032，2026-11-06）

发起自 issue #51（0.12.7 关闭 #48/#50 时新开：helper 的失败/成功只写 `%TEMP%` 日志，`dshm_restart`/面板/CLI 一律呈现「已请求重启」，UI 语义与真实结果存在鸿沟）＋ grill 决策（2026-11-06 会话，两轮 Q1–Q5/R1–Q4 + 设计总账主人确认）＋ 前置事实（restart-wait 2s 轮询 90s deadline 以 `ping.boot` 判成；外部操作日志 `$DSH_HOME/dshm/external-operations.json` 是「终态事实」语义且面板「操作记录」视图已消费；**journal append 层拒绝 `channel='panel'`**——面板通道不走外部日志的防御性不变量；物理边界：替代进程未启动类失败发生时新宿主不存在，90s wait 内客户端无从读到失败态）。

## 我们决定（2026-11-06，grill 决议 + 设计总账）

1. **单一事实源（Q2/Q3）**：helper 对全部终态原子写 `last-restart.json`（`join(dshHome(), 'dshm', 'last-restart.json')`，与 journal 同目录、随 `DSH_HOME` profile 作用域；`DSHM_LAST_RESTART_FILE` 整文件覆盖供测试；绝对路径经 `restartHelperSource` 注入，helper 不做 env 解析）。形状：`{ ok, via:'helper', tag, sha, port, requestChannel, at, elapsedMs, assumed?, reason? }`；文件**持久保留到下次重启覆盖**（「上次重启终态」历史呈现依赖其常驻，不做读后即焚）。
2. **呈现三层（Q1）**：(a) host-api 新 action `last-restart`（镜像 ADR-0031 `published-at` 单条 action 惯例：纯磁盘读零网络）→ 处理器内**惰性折叠**——`requestChannel ∈ {cli, host-tool, external}`（枚举含兜底，见 §3 缺省解析）且未折叠时经 `journalExternalOperation` 钩子补一条 `kind:'restart'` journal 记录（成功与失败都记，与其他 kind 同语义；**panel 不折**——append 层不变量之上在折叠层显式跳过，语义可测），折叠后状态文件回写 `foldedAt` 幂等标记（不用 rename-claim——文件须常驻）；(b) 客户端 RestartBanner 在 `ping.boot` 变化确认后 fetch `last-restart`：成功显「重启完成（X.Xs）」、失败显原因（经现有 notify 通道），不可得静默保持现状（物理边界如实声明：替代进程未启动类失败时新宿主不存在，wait 期内不可能读到失败态）；90s 超时文案改「重启未在 90 秒内确认完成——真实结果已落盘，可稍后查看操作记录」；(c) `dshm_restart` 工具/CLI 在发起重启请求时读状态文件，输出尾行呈现「上次重启终态」。
3. **通道归属（设计总账）**：`requestChannel` 由重启请求方注入 helper（`scheduleRestart` 新可选 dep，四个调用点接线：tools='host-tool'、host-api 面板='panel'、CLI='cli'）；折叠时 `requestChannel ?? 'external'` 解析（与 `journalExternalOperation` 缺省兜底同款）。panel 重启的终态只经 `last-restart` action 与横幅呈现，不入外部 journal（不变量）。
4. **helper 保持哑（Q2）**：终态写盘是 helper 唯一新职责（`mkdirSync(stateDir, {recursive:true})` + `writeFileSync` 单写者场景无需原子替换——helper 写时宿主已死，host 只读不写，`foldedAt` 回写发生在宿主侧且与 helper 生命周期不重叠）；journal 白名单/滚动保留逻辑由 host 侧折叠承担，不入模板。

## Considered Options

- **helper 直写 journal**：需在模板内复刻 normalize/MAX200 白名单与滚动逻辑（~30 行膨胀生成源码）且绕过钩子层 panel 跳过——否决，host 侧惰性折叠替代。
- **rename-claim 消费状态文件**：与「文件常驻供历史呈现」冲突——否决，改 `foldedAt` 回写幂等标记。
- **helper 起反向监听端口供 wait 期实时推送失败态**：复杂度不成比例（helper 需端口选择/生命周期管理，且端口本身可能正被占用——恰是 #50 缺陷 A 场景）——否决，wait 期如实超时文案。
- **折叠进 journal 不分通道（panel 也记 external）**：违反「面板通道零记录」不变量的字面与精神——否决，panel 终态走 `last-restart` action 专属呈现。
- **更新徽章对 HEAD 安装做 SHA 比对**：涉及被动探测比较机制改造（latest-cache/比较管线），与终态回传无关——否决出本范围（#51 后续或另立）。

## Consequences

- **重启的真实终态自此三面可见**：操作记录（外部通道重启折叠入 journal，面板通道经 action）、等待横幅（boot 变化后成功/失败/超时三态文案）、`dshm_restart`/CLI（上次重启终态历史行）。
- **陈旧度有界**：状态文件恰为「最近一次 helper 重启」的终态，语义即「上次」——不做历史序列（历史在 `%TEMP%` 日志对与 journal）。
- **不变量保持**：journal 的 `channel='panel'` 拒绝不变；折叠层显式跳过 panel 使该语义可测（新增钉例）。
- **零漂移承诺**：`RestartResult` 形状、app-exit/systemd 托管路径（无 helper、无终态文件）、desktop 委派路径、「已请求重启」主文案（仅尾行追加）逐字节不变；状态文件缺失（首次使用/手工清理）时三面全部静默降级为现状行为。
- **fail-open**：状态写盘失败吞错（不反噬重启本身）；折叠失败吞错（至多 stderr 一行，ADR-0018 钩子同款纪律）；状态文件损坏按缺失处理（best-effort）。
- **同形异义提示**：`last-restart.json` 的 `assumed: true`（null-port 路径「无端口可探，假定已启动」）与 `ok: true` 语义分层——assumed 成功不做耗时呈报依据，仅作终态记录。
