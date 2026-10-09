# 图片加载链 weserv 优先双兜底（0.9.61，ADR-0014）

背景：dsh-m 的插件截图（raw.githubusercontent.com）与图标（github.com 头像）由用户浏览器直接拉取。2026-10-09 实测：服务器侧（腾讯云出海）对这些域 200/0.2s，大陆用户浏览器路径时断时通——当日故障样本 dsh-wallpaper-engine 五图（22.5MB，含 10.4MB GIF）缩略图条与灯箱全空，且图标实为本地字母兜底、并非「能出图」。对标 dsh-market 1.66.14：其缩略图无条件经 images.weserv.nl 代理（源码注释记载大陆未代理实测 1.39s / 23KB vs 原图 41KB），但灯箱直连原图、零兜底、零超时——大陆用户点开大图同款黑洞。

## Considered Options

- **直连优先、失败换代理**：全球用户零第三方依赖，但大陆用户每张图先吃一次直连失败/黑洞等待（onError 快则毫秒级、TCP 黑洞可拖 20-60s+），首图体验最差的恰是痛点人群，被否。
- **dsh-market 同款（缩略图代理、大图直连）**：缩略图问题解决、灯箱问题原样保留；且其代理无失败兜底（weserv 一挂全球缩略图陪葬），被否。
- **服务器代理（/dshm/img 端点中转）**：零第三方依赖、可控，但 22.5MB/人的流量过自建盒、无服务端转码能力（10MB GIF 原样转发）、新增 SSRF 面与 host API 维护负担，被否。
- **weserv 优先 + 对称双兜底（采纳）**：所有远端图先经 weserv（服务端缩放转码 `fit=inside&we=1&output=webp&q=80`），失败/超时（仅此层 8s 人工守卫）换原图直连，再败走各消费方终态（缩略图剔除/灯箱占位含重试与打开原图/图标字母兜底）。赢家记忆按服务桶（raw/avatar）记最近成功层，链启动时快照次序——同批竞态下兄弟图不因偏好翻转而跳层。

## 取舍要点

- **直连层零人工超时**：0.5MB/s 级合法慢速下载（10MB GIF 合法耗时 20s+）会被人工超时误杀；用户明确点了「看大图」，等待优于误判。weserv 层正常亚秒应答，8s 即判不可用立即换层。
- **代理优先的顺序依据**：dsh-market 实测大陆 weserv 可达且更小；本 ADR 的 --live 实证（2026-10-09）mascot-drawer.png 直连 2859KB vs weserv w=1600 webp 151KB（≈18.9×）——体积收益独立于可达性成立，全球用户走代理不亏。
- **第三方依赖与逃生门**：weserv（开源 images.weserv/Weserv，可自建）成为内置默认；base 为模块级单一常量（`WESERV_BASE`），未来设置项自定义代理只改一处。灯箱终态常驻「打开原图 ↗」链接，保真与最终逃生门不受代理质量影响。
- **安全边界不放宽**：`safeScreenshots`（https + github.com/*.githubusercontent.com）逐字不动，weserv 只接收白名单截图 URL 与图标 URL。

## Consequences

- 三类消费方（缩略图 h=300 / 灯箱 w=1600 / 图标 h=96）共用 `useImgChain`，页面生命周期内赢家记忆按 raw/avatar 两桶独立（github.com 头像与 githubusercontent 系可达性经常不同步，dsh-market 同款分桶）。
- 缩略图与灯箱在直连层同 URL（均为原 URL）——Chromium 已解码位图按 URL 复用，跨消费方秒显是特性不是缺陷；探针以代次化 URL（?g=N）规避其对失败场景确定性的干扰。
- README 内嵌图（MdImg）不在本链射程（grilling Q2：折叠展开才加载、频率低，后续观察）。
- 回归防线：`tests/client-img-chain.test.mjs`（纯逻辑 + 源锚）、SSR 冒烟（tier0 初始 src）、`scripts/verify-lightbox.mjs` A16-A24（四类失败场景 + 赢家记忆 + 序感知换层 + 剔除实证）与 `--live`（真网压缩）。
- 已知接受的怪病：Playwright 同页 unroute+复挂在个别现场会让 route 静默失效（请求绕过拦截真网泄漏）——探针层序断言因此走 `page.on('request')` 的 reqLog 而非路由命中计数；产品代码不受影响。
