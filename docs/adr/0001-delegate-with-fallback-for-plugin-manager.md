# 开关写路径委派官方 pluginManager 服务，服务缺席时降级自实现

dsh-m 的开关（见 GLOSSARY.md）需要对 `cordis.patch.yml` / `dsh.profile.bundles` 做与官方插件管理完全同语义的写入。我们决定：写路径先 `ctx.get('pluginManager')` 运行时探测并委派官方服务（白拿保护名单判定、unaddressable 识别、hmr 活体重组、与官方 UI 的锁与事件一致性），服务缺席时降级为 loader `entry.update()` 直操作 + 自带文件锁的保注释 YAML 编辑；读路径（enabled / 运行相位）始终自读 loader entries，不随写路径切换，避免委派/降级双模式读源漂移。探测按服务存在性、不判 DSH 版本号，与 settings 兼容层同一决策传统。

## Considered Options

- **纯委派**（无服务即隐藏开关）：实现最少，但 dsh-m 兼容多代 DSH 的定位会让老运行时上功能整块消失，且 CLI 场景（无宿主进程）完全不可用。
- **纯自实现**：版本无关，但 bundle 级开关的活体重组依赖 dsh-app-boot 模块私有 API（`bootstrapIncludes`），无法安全调用；还得长期自维护官方保护名单的等价物，语义漂移风险高。

## Consequences

- 降级路径的 bundle 级开关只做文件编辑，活体生效退化为 restart-required；单 insert 行插件的行开关在降级路径仍可经 `entry.update()` 即时生效。
- 委派路径写前调一次 `listPlugins()` 校验 `readOnlyReason`，官方判定优先于 dsh-m 硬编码保护名单。
