# 锁档观测单源——lockfile module（架构复审 2026-11-16）

发起自 2026-11-16 代码库架构复审（钢人裁决版，improve-codebase-architecture 流程）唯一选中任务。GLOSSARY「锁档观测」词条已立（2026-11-16）。此前五份产地各自维护 pnpm-lock.yaml 观测解析，靠注释与评审纪律对齐：

- **同日双修实证**：issue #44（2026-11-04，commit c9be061）同一正则转义降级 bug 在 `lockResolutionOf`（market-mutation）与 `lockVersionOf`/`lockCommitOf`（profile-transaction）两份产地各修一遍——deletion test 已在生产跑过：删掉任一份，复杂度在另一份原样重现。
- **五份产地**：`lockResolutionOf`、`lockVersionOf` + `lockCommitOf`、`parsePackagesSection` + `readPnpmLockIntegrity` + `readPnpmLockOverrides`（npm-integrity）、`readLockImporters`（doctor——注释自述「仓内无可复用的 importers 解析导出」，实为来认亲的第五份）。
- **注释格维持对齐**：market-mutation 与 profile-transaction 的「同一口径」注释互相指认；doctor 的 peer 后缀剥离与 B1 是第三份镜像语义。
- **调用形态**：`capturePreMutationState` 在依赖循环里逐包对同一 lock 文本全文重扫 ×N。

## 我们决定（2026-11-16，grill 两轮决议 Q1–Q14）

1. **判定单源**：「锁档观测」全仓唯一产地 `src/core/lockfile.ts`——pnpm-lock.yaml 文本 → 单包解析证据（版本 / integrity / commit 身份 / tarball）、顶层 overrides 映射、importers 根依赖的观测判定。
2. **中性位置**：不入 npm-integrity（它是 fail-closed 政策消费端，兼有快照恢复第二职责，证据收集者反向依赖它是 seam inversion）；不入 profile-transaction（事务 owner 不吸收通用观测原语）。判据同 ADR-0028。
3. **接口形态**：text-in、零 fs——读文件的时刻永远归调用方（verify 相的读后写重读是事务契约，不合并）。parse-once 视图：`parseLockfile(lockText) → LockfileView`；`lockfileVersion` 只观测不做门；`observationOf(pkg)` 文件序首条目（先在证据语义）；`candidatesOf(pkg, version)` 精确 + peer 后缀候选（守卫语义）；`overrides` 保留「首条失败即停」语义；`anomalies.duplicateKeys` 透出重复键；`importersRootDependencies()` 惰性 memoized（yaml 解析成本不进热路径）。
4. **严格性分离**：view 全 fail-open；v9 硬门、重复键抛错、多候选歧义 fail-closed 留在 npm-integrity 作薄政策层。七条保真（三条异常文案逐字节、null/throw 二分、peer 容忍边界、字面 `'9.0'` 门、unquote 后判重、integrity 前缀约束、失败态映射不降级）由实施计划红线逐条承载。
5. **六项仲裁**（权威 ← 退役）：
   - 键归一化取**并集**（单/双引号都剥、`node_modules/` 前缀都容），版本语义差留查询层（`observationOf` vs `candidatesOf`）；
   - version 归一 ← B1/doctor（剥引号 + 全部尾部括号组），A 的原样保留退役；
   - commit 三级 ← A（体内 `commit:` → 键内 hex → tarball URL 内 hex），B2 的「键+body 首个 hex」退役；
   - integrity 捕获 ← C（前缀约束：行首或 `{`/`,`+空白），A 的无约束退役（等价性由 view 套件钉「规范锁上恒等」）；
   - body 边界 ← C（缩进感知块扫描），A 的任意冒号行早截断退役；
   - 段锚定 ← A/C（packages: 段内），B1/B2 的全文裸扫退役。
6. **零行为包络**：对 pnpm 自产规范锁零行为；意外漂移形态（双引号键、截断后字段、跨段误配、doctor 对非引号 `9.0` 的 unsupported→supported）统一即修复，按 issue #72 先例在 CHANGELOG 声明「变化仅限此前观测不到/判不了的形态」，既有套件全绿为门、翻红即回炉重裁。
7. **普查边界**：doctor 的 importers 观测迁入本轮；generation-projection 的单正则探针、pnpm-workspace.yaml 的 patchedDependencies 家族（正则版 + yaml 版 + dsh-cli 写侧行手术）、package.json dependencies 解析 ×4 登记为 follow-up（同病同方，见 Consequences 登记簿）。

## Considered Options

- **加冕 npm-integrity 内导出**：读侧证据收集者（market-mutation/doctor）反向依赖 fail-closed 守卫 module，seam inversion——否决。
- **严格度参数进 view interface**：政策漏进 interface，浅 module 形状——否决。
- **per-consumer 保真不归一**：保留三方键容忍分裂，#44 级漂移照旧重演——否决。
- **全文件家族一把梭**（lock + workspace patchedDeps + manifest deps 同轮收编）：一刀出仓变大迁移，违 ADR-0028 单议题纪律——否决，拆 follow-up。
- **「再等等」**：咬合条件是 pnpm 键形态演化的必然函数，且 #44 的触发器不是 pnpm 升级而是自家正则在 gitHosted tarball 形态上的降级——等待没有安全期。否决。

## Consequences

- **#44 级漂移免疫**：键形态 / 字段演化单点落地，四端（市场变更编排先在证据、事务复验与补偿、npm 完整性断言与冻结自愈、体检账实）同源消费。
- **测试面收敛**：A↔B2 的 commit 键形态镜像、A↔C 的 lock 夹具镜像、doctor↔B1 的 peer 剥离镜像收敛为共享夹具 + view 表驱动套件 + 消费端接线断言；「镜像套件保护两份相似」的假防线退役。
- **capture 循环 parse-once**：依赖循环里逐包全文重扫 ×N 消失。
- **follow-up 登记簿**（同病同方，待本 module 样板立好同法迁移）：
  1. pnpm-workspace.yaml patchedDependencies 家族——正则行扫描（market-mutation `capturePreMutationState`）vs yaml 解析重复键判废（profile-transaction `workspacePatchedKeys`）vs dsh-cli 写侧行手术 `removePatchedDependencyEntries`，三处理者两种语义；
  2. package.json dependencies「读 JSON→剥字段→滤 string」×4（profile-transaction ×2、market-mutation、install-guard）；
  3. generation-projection 的 `link:` 投影单正则探针（单调用点，零共享键形态知识，收编无深度增益，择机并入）。
