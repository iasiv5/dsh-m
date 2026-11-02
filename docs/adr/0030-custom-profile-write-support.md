# 自定义 profile 写操作支持：安全名 + 目录权威 + 保留形态事实探测（issue #39，2026-11-02）

发起自 issue #39（appllove，2026-11-01）：`dsh --profile aqua`（自定义名的普通 web 宿主）下，市场读路径全部正常——已装列表、市场浏览、README 都取 `profileContext.dir`——写操作却全部 409「当前 profile（aqua）不支持该操作」。根因两层：① `kindOf` 字面枚举只认 `web`/`desktop`/`tauri`，其余一律 unknown 显式拒写（ADR-0005 决议②）；② 即使放开判定，写路径四层缺省全部落回 `webProfileDir()`（host-api 与 tools 的 web 写分支不传 → market-mutation / profile-transaction / toggle 三级 `?? webProfileDir()` → dsh CLI `--profile web` 字面量），形成「读走 profile.dir、写走 profiles/web」的不对称——报告者本地补丁实测：安装「成功」却写进 web 名下且零提示，正是评审定性的阻断级「静默错写」形态。0.9.5 修复 desktop 读路径漏传时（host-api.ts 注记）已见过同类 bug 的读侧版本，写侧一直未接线。

判定困境的实质：ADR-0005「未知名显式拒写」是 #3（tauri 名）/ #6（dataelement 桌面 profile 叫 `web`）两次撞车换来的 fail-closed，而官方 `dsh --profile <自定义名>` 又是一等场景（dsh-app-boot 文档明示 custom profiles 受支持）——名字枚举既漏桌面形态，又错杀合法 web 形态。同业 dsh-market 1.73.8 的生产答案：**「这是谁的地盘」由宿主服务契约回答，目录由宿主权威回答，名字只做路径安全性校验**——其三分支（`desktopProfiles` 服务 → 桌面壳；名字 `desktop` → 官方管理器委派；其余一切名字含 tauri/自定义名走同一 web 文件事务）、`isDshProfileName`（非空/非 `.`/`..`/`node_modules`/无分隔符）、`profileDirectory` 恒取 launcher 给的 dir、`argvProfile()` fallback 兜底、代际感知（generationManagedNames）只作读侧事实不构成写权限门。

## 我们决定（2026-11-02，grill 共识 Q1–Q8 + 计划评审 9 项闭环）

1. **判定：安全名即可操作**。host 来源的 profile 名通过路径安全校验（`isDshProfileName`，env.ts 唯一判定源）即 kind web；`unknown` 语义收窄为「名字不可作安全路径段」（唯一保留的拒写场景）。desktop 判定保留两条既有事实——`desktop`/`tauri` 名字快路径 + generation 投影探测——且**探测正恒优先**（事实优先于名字与断言，#6 防线不动）。
2. **目录权威：读写恒用宿主给的 dir**。host 来源读写一律 `profileContext.dir`（宿主说的算，绝不从名字推导）；`webProfileDir()` 只保留给 fallback 分支。fallback（无 profileContext 旧宿主）加 `--profile` argv 兜底（同业 argvProfile 同款，#639 同款教训），kind 恒 web、不做探测——零漂移纪律。
3. **写路径全量接线，单 PR 原子交付**。面板（host-api 五分支）、agent 工具（四工具）、CLI（四写命令 + doctor 目标目录）三个入口全部传 `profileDir`/`profileName`；事务底座补 `profileName` 直达唯一需要名字的点——`dsh plugin --profile <名>` 子进程 argv；文件路径一律只认 profileDir。13 个写入口调用点穷举对账（评审核证），源结构锚计数（host-api 8→13、tools 7→11）+ 集成落点不变量双防线。
4. **desktop 侧零变化**。能力表（DESKTOP_ALLOWED）、委派路径、六条拒绝指引文案逐字冻结（字面快照断言支撑——既有断言全是同源引用断言、不感知漂移，评审 Q4）。
5. **不引入声明面**。`DSHM_PROFILE_KIND` 类显式声明不采纳：同业无声明面生产运行多年，安全名 + 投影探测 + 事务快照回滚足够；少一个配置面少一种误配置。

## Considered Options

- **声明式 `DSHM_PROFILE_KIND` / profile 内标记文件（报告者方案）**：把不可判定场景转成用户断言，最保守；但同业实践证明声明面非必要，且新增配置面本身是新的误配置源——否决（探测正恒优先已接住误声明风险）。
- **纯事实推断（host 来源 + 非 desktop 名 + 投影探测负 → web）**：零配置面；但空 profile（fresh 安装）时探测不可判定，而那恰是误判代价最高的时刻（自定义名桌面宿主撞代际系统）——否决，本项目改以「安全名 + 快照回滚兜底」承担同款残余风险（与 dsh-market 生产现状同级）。
- **dir ≠ webProfileDir() 时结构化拒绝（报告者兜底期望 #3）**：与目标场景自相矛盾——aqua 的 dir 本来就不等于 webProfileDir()；改为「dir 恒以宿主为准」，写路径不存在落到推导目录的可能，拒绝逻辑作废。
- **维持 409 只改文案**：功能不可用依旧，且留着「接线不完整即静默错写」的地雷（任何后续维护者 naive 放开判定就引爆）——否决。

## Consequences

- **行为变化**：自定义 web 形态 profile 的市场写操作从全 409 变可用；dshm CLI 放开安全自定义名（desktop/tauri 名仍拒并指引官方页）；unknown 场景（名字不安全）改用专用模板文案 `WRITE_GUIDANCE_UNKNOWN`。
- **残余风险如实声明**：自定义名 + 代际管理的桌面宿主 + 空 node_modules（投影探测不可判定）+ 不发布 `desktopProfiles` 服务——三者叠加才会误走 web 事务；与 dsh-market 生产现状同级，事务快照回滚兜底。dsh-m 比 dsh-market 多一层写侧投影事实（isGenerationProjectionDir 在名字快路径之外升级 desktop），后防线不劣于同业。
- **断言面**：desktop 六条指引字面快照（冻结面）；`custom-profile-transaction.test.mjs` 落点不变量（runner 工厂/事务路径绝不允许出现 webProfileDir()）钉死接线回退；源结构锚计数（host-api 13 / tools 11）。
- **回退面**：无数据迁移、无环境残留——revert + 版本号递增即回 0.11.15 语义（自定义名重新 409、文案回旧六条）。
- **测试**：全量 `npm test`（基线 1937 + 本轮新增）与 `npm run typecheck` 双绿；锚有效性经隔离副本单点变异验证（改坏接线 → 锚红 → 恢复 → 绿）。
