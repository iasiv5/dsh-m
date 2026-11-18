# npmLatest in-flight 合并（single-flight）

状态：Proposed（工作决议，待主人复核；未发版）

背景：`npmLatest` 是同进程 6 处调用点的共用探测原语（市场浏览页探测、已装探测、doctor `registry-check`、社区目录 loader、adopt 预检、版本角标）。它逐包直发 `/latest`，没有 in-flight 合并；agent 的 `dshm_list`（TTL 60 分钟）与 GUI 已装页第二段探测（TTL 30 分钟，ADR-0008）在缓存过期窗口重叠时，会把全部 npm 包各请求一遍（当前 profile 18 个）；失败条目不写缓存，重复调用还会重复等待超时。GitHub 侧已有同仓库 single-flight 先例（versions.ts，按 passive/active 预算池分池）。

决定：`npmLatest` 拆为 `npmLatestInner`（原主体逐字节不变）+ 公开包装层：单一 Map，键 = `显式registry|pkg`（隐式调用以 `implicit` 字面入键——生效腿由 inner 两腿阶梯决策，避免 waiter join 前先做异步 registry 解析）；leader 建 flight（内部 AbortController + 30s 硬上限 timer），leader/waiter 都经 `raceWaiter` 四臂等待（自身超时、自身 signal、flight ctrl 三臂竞速 + 共享 Promise）；ctrl 臂 reason 承载 canonical message（「npmLatest flight 30s 硬上限」/「npmLatest flight：全部等待方已离开」）——cap 不借 wire 生效，wire 失灵仍可观测；settle（成功/失败）清键并清 timer；refs 归零且未 settle → abort + 清键（与 settle 清理幂等互容）。**不分 passive/active 池**：npmLatest 没有预算记账（GitHub 的分池源于被动预算），合并对所有调用方安全。

考虑过的替代方案：
- 缩短 TTL 降重叠：增加请求总量与 GitHub 被动预算消耗（ADR-0008 已记录的代价），否决。
- 新增全响应缓存层：与 ADR-0006 内存 TTL 层职责重复，否决。
- passive/active 分池（镜像 versions.ts）：无预算差异可分，徒增复杂度，否决。

后果：
- doctor、版本角标等主动调用会 join 进行中的被动探测 flight：结果一致，等待时间可能变长（受 flight 30s cap 与自身超时裁剪）。
- waiter 预算大于 leader 时以 leader 的 wire 超时为准（有界，错误如实上抛）。
- CLI 是独立进程，不受影响（既有 best-effort 口径不变）。
- ADR-0006 TTL 缓存层与 mutation 定向失效不变：flight 合并的是并发未命中，缓存合并的是时间窗内重复，两层互不替代。
