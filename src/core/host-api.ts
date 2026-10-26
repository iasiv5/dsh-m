/**
 * /dshm Host API dispatcher（DESIGN.md §4/§5）：可注入的 method 分发 + 请求防护 +
 * HTTP 状态映射，供 host.ts 与契约测试共用。
 *
 * 解析顺序固定：宿主信任检查（0.9.0 起委派官方 `connection.requestRejection`，
 * 全 method 含 ping 与未知 method，任何 body/side effect 之前，fail-closed）→
 * 只接受 POST → JSON Content-Type → 有上限读取并 drain body →
 * 顶层必须是非 null/非数组对象且有 method → typed method/业务错误映射 → 其他 500。
 */
import { BOOT_ID, publicInstallStatus } from './dsh-cli.js'
import { resolveDshVersion, readLauncherPackageVersion } from './dsh-version.js'
import { runDoctor } from './doctor.js'
import {
  listInstalledWithMeta,
  listMarket,
  existingMarketIds,
} from './market.js'
import {
  installFromRegistry,
  selfUpgrade,
  uninstallPlugin,
  upgradePlugin,
  InstallGuardError,
} from './market-mutation.js'
import { runProfileTransaction, TransactionError, makeNpmWarmPackument } from './profile-transaction.js'
import { listExternalOperations, clearExternalOperations, removeExternalOperation } from './external-journal.js'
import { readUpgradeIntent, resolveUpgradeIntent, writeUpgradeIntent } from './upgrade-intent.js'
import { readInstalledPluginReadme, listInstalledPlugins, type PluginReadme } from './installed.js'
import { loadPrimaryScreenshots } from './primary-screenshots.js'
import { isNewerVersion, npmLatest, npmTarballUrl, npmPackumentReadme } from './versions.js'
import { getCommunitySummary } from './community.js'
import type { RegistryController, RegistryControllerSnapshot } from './registry-controller.js'
import { RegistryConfigError } from './registry-controller.js'
import { checkRegistryEntries } from './registry-check.js'
import { parseMarketQueryInput, MarketQueryError, type MarketQueryIntake } from './market-query.js'
import { servingPort, scheduleRestart } from './restart.js'
import { togglePlugin, ToggleError, type PluginManagerLike } from './toggle.js'
import { IncompatibleError } from './compat-check.js'
import { ProfileUnsupportedError, assertWriteAllowed, type ActiveProfile } from './active-profile.js'
import { DesktopOpsError, desktopInstallFromRegistry, desktopToggle, desktopUninstall, desktopUpgradeFromRegistry, desktopSelfUpgradeViaTarball, type DesktopManagerLike } from './profile-ops.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 宿主信任检查的统一签名（生产 = 官方 requestRejection 委派；测试可注入）。 */
export type RequestTrustCheck = (req: Pick<IncomingMessage, 'headers'>) => 401 | 403 | undefined

export class BadJsonError extends Error {}
export class BodyTooLargeError extends Error {}
export class UnsupportedMediaTypeError extends Error {}

class ApiProtocolError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface HostApiOverrides {
  listMarket?: typeof listMarket
  listInstalledWithMeta?: typeof listInstalledWithMeta
  /** 0.9.87 FP2：批量 id 存在性（收藏 stale 检测批量化；测试注入）。 */
  existingMarketIds?: typeof existingMarketIds
  installFromRegistry?: typeof installFromRegistry
  uninstallPlugin?: typeof uninstallPlugin
  upgradePlugin?: typeof upgradePlugin
  selfUpgrade?: typeof selfUpgrade
  checkRegistryEntries?: typeof checkRegistryEntries
  npmLatest?: typeof npmLatest
  /** 0.9.45 U10b：README 本地读取与 npm 兜底（测试注入；缺省 = 真实现）。 */
  readInstalledPluginReadme?: typeof readInstalledPluginReadme
  npmPackumentReadme?: typeof npmPackumentReadme
  /** Primary detail author screenshots manifest reader（GUI method；测试注入）。 */
  loadPrimaryScreenshots?: typeof loadPrimaryScreenshots
  /** registry 分支社区 summary 数据源（M1 Task 6；测试注入 cache-first 模拟） */
  getCommunitySummary?: typeof getCommunitySummary
  /** Task 7：self-upgrade 委派事务（缺省 = runProfileTransaction） */
  runTransaction?: typeof runProfileTransaction
  /** Host 注入 appExit 后的重启调度器；测试可替换。 */
  scheduleRestart?: typeof scheduleRestart
  /** DSH 运行版本解析（ping.dshVersion 数据源）；测试可替换。 */
  resolveDshVersion?: typeof resolveDshVersion
  /** Task 14：开关委派的官方服务探测（ctx.get('pluginManager')）；测试可替换。 */
  getService?: () => PluginManagerLike | undefined
  /** Task 14：开关执行器；测试可替换。 */
  togglePlugin?: typeof togglePlugin
  /** 0.9.0：宿主信任检查（官方 connection.requestRejection 委派）；缺省 = fail-closed 全拒。 */
  rejectRequest?: RequestTrustCheck
  /** 0.9.0：Desktop adapter 注入（测试可替换；生产 = profile-ops 实现）。 */
  desktopInstall?: typeof desktopInstallFromRegistry
  desktopToggle?: typeof desktopToggle
  /** 0.9.8：Desktop 卸载/升级委派（dsh-market 同策略；生产 = profile-ops 实现）。 */
  desktopUninstall?: typeof desktopUninstall
  desktopUpgrade?: typeof desktopUpgradeFromRegistry
  /** 0.9.8：同步探测缺席时的官方惰性服务拉起（host 侧 cordis inject 实现）。 */
  ensureService?: (timeoutMs?: number) => Promise<PluginManagerLike | undefined>
  /** 0.9.79 外部操作记录（ADR-0018）：读取/清除注入位（测试；缺省 = 真实现）。 */
  listExternalOperations?: typeof listExternalOperations
  clearExternalOperations?: typeof clearExternalOperations
  /** 0.9.82 修订 R2-3：外部 failed 行单条 ✕ 的服务端 per-id 删除注入位（测试；缺省 = 真实现）。 */
  removeExternalOperation?: typeof removeExternalOperation
  /** 0.10.0 D3 自升级专用通道（desktop self-upgrade；测试注入假件）。 */
  desktopSelfUpgradeViaTarball?: typeof desktopSelfUpgradeViaTarball
  /** 0.10.0 开机对账（self-check 每进程一次；测试注入真实现 + DSHM_UPGRADE_INTENT_FILE 隔离）。 */
  readUpgradeIntent?: typeof readUpgradeIntent
  resolveUpgradeIntent?: typeof resolveUpgradeIntent
  writeUpgradeIntent?: typeof writeUpgradeIntent
  /** 0.10.0 D3 全链测试注入位（tarball 解析 / 已装列表，经 desktop deps 透传；缺省 = 真实现）。 */
  npmTarballUrl?: typeof npmTarballUrl
  listInstalled?: typeof listInstalledPlugins
}

export interface HostApiContext {
  controller: RegistryController
  pkg: { name: string; version: string }
  /** 宿主当前 profile（host.ts apply 期解析一次，生命周期内不可变） */
  profile: ActiveProfile
  deps?: HostApiOverrides
}

interface ParsedRequest {
  method: string
  body: Record<string, unknown>
}

const BODY_MAX_BYTES = 1 << 20

function readBody(req: IncomingMessage, maxBytes = BODY_MAX_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        settled = true
        req.resume() // drain：停止收集但不盲目 destroy socket
        reject(new BodyTooLargeError())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!settled) {
        settled = true
        resolve(Buffer.concat(chunks))
      }
    })
    req.on('error', (err) => {
      if (!settled) {
        settled = true
        reject(err)
      }
    })
  })
}

async function parseRequest(req: IncomingMessage, rejectRequest: RequestTrustCheck): Promise<ParsedRequest> {
  // 宿主信任检查第一位（0.9.0 委派官方 requestRejection）：先于 POST/Content-Type/body——
  // 被拒请求零 body 消耗、零业务调用（报告 §3.2/§8）。返回 401/403 原样投影。
  let rejection: 401 | 403 | undefined
  try {
    rejection = rejectRequest(req)
  } catch {
    // 宿主检查异常一律 fail-closed，异常细节不外泄（报告 §3.2）
    rejection = 403
  }
  if (rejection !== undefined) {
    throw new ApiProtocolError(rejection, rejection === 401 ? '请求未通过宿主认证（未登录或凭据无效）' : '请求未通过宿主信任检查（不可信 Host/Origin 或跨站）')
  }
  if ((req.method || 'GET').toUpperCase() !== 'POST') {
    throw new ApiProtocolError(405, '只接受 POST')
  }
  const contentType = String(req.headers['content-type'] ?? '').trim()
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType)) {
    throw new UnsupportedMediaTypeError()
  }
  const raw = await readBody(req)
  let parsed: unknown
  if (raw.length === 0) throw new BadJsonError('请求体不能为空')
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
  } catch {
    throw new BadJsonError('请求体不是合法 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadJsonError('请求体顶层必须是对象')
  }
  const body = parsed as Record<string, unknown>
  const method = typeof body.method === 'string' ? body.method.trim() : ''
  if (!method) throw new BadJsonError('缺少 method')
  return { method, body }
}

function strArg(body: Record<string, unknown>, key: string): string {
  const v = body[key]
  return typeof v === 'string' ? v.trim() : ''
}

function boolArg(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1'
}

function snapshotPayload(snap: RegistryControllerSnapshot, config?: { communityCatalog?: boolean; communityCatalogPin?: string }): Record<string, unknown> {
  return {
    registryUrl: snap.configuredAddress,
    configuredAddress: snap.configuredAddress,
    activeConfigAddress: snap.activeConfigAddress,
    pendingAddress: snap.pendingAddress,
    configStatus: snap.configStatus,
    configErrors: snap.configErrors,
    warnings: snap.warnings,
    registryState: snap.loaded,
    // 社区两键（M1 Task 6）：设置页回显数据源
    communityCatalog: config?.communityCatalog,
    communityCatalogPin: config?.communityCatalogPin,
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function errorStatus(err: unknown): { status: number; payload: Record<string, unknown> } {
  if (err instanceof BadJsonError) return { status: 400, payload: { ok: false, error: err.message } }
  if (err instanceof BodyTooLargeError) return { status: 413, payload: { ok: false, error: '请求体过大' } }
  if (err instanceof UnsupportedMediaTypeError) return { status: 415, payload: { ok: false, error: 'Content-Type 必须是 application/json' } }
  if (err instanceof RegistryConfigError) {
    return { status: 422, payload: { ok: false, error: err.message, errors: err.errors } }
  }
  if (err instanceof ApiProtocolError) return { status: err.status, payload: { ok: false, error: err.message } }
  if (err instanceof ProfileUnsupportedError) {
    // 0.9.0：Desktop/未知 profile 的能力表拒绝——结构化 code + 官方入口指引
    return { status: 409, payload: { ok: false, error: err.message, code: err.code, action: err.action, profile: err.profile, guidance: err.guidance } }
  }
  if (err instanceof DesktopOpsError) {
    // 0.9.0：Desktop adapter 失败（no-manager/install-refused/enable-failed/verify-failed）
    return { status: 409, payload: { ok: false, error: err.message, code: err.code } }
  }
  if (err instanceof ToggleError) {
    const status = err.code === 'protected' ? 403 : err.code === 'not-installed' ? 404 : 409
    return { status, payload: { ok: false, error: err.message, code: err.code } }
  }
  if (err instanceof InstallGuardError) {
    // 装后守卫拦截（M2 Task 3）：结构化投影含 needsRestart/restartSafe/kind——GUI 一键重启只读 restartSafe；
    // 0.9.93 起线格式单源于 toWire（信封 ok/error 本端自拼）
    return {
      status: 409,
      payload: {
        ok: false,
        error: err.message,
        ...err.toWire(),
      },
    }
  }
  if (err instanceof IncompatibleError) {
    // 结构化 issue：GUI 据此弹「仍要安装」确认（forceIncompatible 重试）
    return { status: 409, payload: { ok: false, error: err.message, issue: err.issue } }
  }
  if (err instanceof TransactionError) {
    // detail 白名单投影：结构化事实，不含 raw output（GUI 只读 error，零改动）
    const r = err.result
    return {
      status: 500,
      payload: {
        ok: false,
        error: err.message,
        detail: {
          status: r.status,
          kind: r.kind,
          failure: r.failure,
          healActions: r.healActions,
          snapshotRestoreVerified: r.snapshotRestoreVerified,
          profileConverged: r.profileConverged,
        },
      },
    }
  }
  return { status: 500, payload: { ok: false, error: err instanceof Error ? err.message : String(err) } }
}

export function createApiDispatcher(ctx: HostApiContext): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const d = {
    listMarket: ctx.deps?.listMarket ?? listMarket,
    listInstalledWithMeta: ctx.deps?.listInstalledWithMeta ?? listInstalledWithMeta,
    existingMarketIds: ctx.deps?.existingMarketIds ?? existingMarketIds,
    installFromRegistry: ctx.deps?.installFromRegistry ?? installFromRegistry,
    uninstallPlugin: ctx.deps?.uninstallPlugin ?? uninstallPlugin,
    upgradePlugin: ctx.deps?.upgradePlugin ?? upgradePlugin,
    selfUpgrade: ctx.deps?.selfUpgrade ?? selfUpgrade,
    checkRegistryEntries: ctx.deps?.checkRegistryEntries ?? checkRegistryEntries,
    npmLatest: ctx.deps?.npmLatest ?? npmLatest,
    readInstalledPluginReadme: ctx.deps?.readInstalledPluginReadme ?? readInstalledPluginReadme,
    npmPackumentReadme: ctx.deps?.npmPackumentReadme ?? npmPackumentReadme,
    loadPrimaryScreenshots: ctx.deps?.loadPrimaryScreenshots ?? loadPrimaryScreenshots,
    getCommunitySummary: ctx.deps?.getCommunitySummary ?? getCommunitySummary,
    runTransaction: ctx.deps?.runTransaction ?? runProfileTransaction,
    scheduleRestart: ctx.deps?.scheduleRestart ?? scheduleRestart,
    resolveDshVersion: ctx.deps?.resolveDshVersion ?? resolveDshVersion,
    getService: ctx.deps?.getService,
    toggle: ctx.deps?.togglePlugin ?? togglePlugin,
    desktopInstall: ctx.deps?.desktopInstall ?? desktopInstallFromRegistry,
    desktopToggle: ctx.deps?.desktopToggle ?? desktopToggle,
    desktopUninstall: ctx.deps?.desktopUninstall ?? desktopUninstall,
    desktopUpgrade: ctx.deps?.desktopUpgrade ?? desktopUpgradeFromRegistry,
    desktopSelfUpgradeViaTarball: ctx.deps?.desktopSelfUpgradeViaTarball ?? desktopSelfUpgradeViaTarball,
    readUpgradeIntent: ctx.deps?.readUpgradeIntent ?? readUpgradeIntent,
    resolveUpgradeIntent: ctx.deps?.resolveUpgradeIntent ?? resolveUpgradeIntent,
    writeUpgradeIntent: ctx.deps?.writeUpgradeIntent ?? writeUpgradeIntent,
    npmTarballUrl: ctx.deps?.npmTarballUrl ?? npmTarballUrl,
    listInstalled: ctx.deps?.listInstalled ?? listInstalledPlugins,
    ensureService: ctx.deps?.ensureService,
    listExternalOperations: ctx.deps?.listExternalOperations ?? listExternalOperations,
    clearExternalOperations: ctx.deps?.clearExternalOperations ?? clearExternalOperations,
    removeExternalOperation: ctx.deps?.removeExternalOperation ?? removeExternalOperation,
  }
  const cfg = (): typeof ctx.controller.config => ctx.controller.config
  // 0.10.0：开机对账每进程一次（dispatcher 生命周期 = 宿主一次 apply）
  let selfCheckIntentDone = false
  // 0.9.0：宿主信任检查委派（含 ping 与未知 method，fail-closed）；
  // profile 为 host 生命周期内不可变对象（host.ts apply 期解析一次）
  const rejectRequest: RequestTrustCheck = ctx.deps?.rejectRequest ?? (() => 403)
  const profile = ctx.profile
  // DSH 版本一次性解析，dispatcher 创建即预热（首个 ping 不吃 spawn 回退的延迟）
  const dshVersionP: Promise<string | null> = Promise.resolve()
    .then(() => d.resolveDshVersion())
    .catch(() => null)

  return async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const abort = new AbortController()
    res.once('close', () => abort.abort())
    try {
      const { method, body } = await parseRequest(req, rejectRequest)
      const signal = abort.signal
      let payload: Record<string, unknown>
      switch (method) {
        case 'ping':
          payload = {
            plugin: ctx.pkg.name,
            version: ctx.pkg.version,
            node: process.version,
            boot: BOOT_ID,
            // DSH 运行版本（头部 chip 数据源）；解析失败 → undefined → JSON 序列化时字段缺席
            dshVersion: (await dshVersionP) ?? undefined,
            // 0.9.0 双 profile：GUI/工具展示当前 profile 与能力边界
            profile: { name: profile.name, kind: profile.kind, source: profile.source },
          }
          break

        case 'self-check': {
          // 0.10.0 开机对账（崩溃兜底网，每进程一次）：上进程若死于自升级 promise 悬垂，delegated
          // intent 遗留至此——与本进程实际版本比对收口；本进程内 D3 已就地 resolve 的（或无悬垂）
          // 幂等 no-op。ADR-0018：读写独立 intent ledger，零外部日志。对账自身故障零涟漪。
          let intentResolved: { ok: boolean; target: string; intentVersion: string; fromVersion?: string; installedVersion?: string } | undefined
          if (!selfCheckIntentDone) {
            selfCheckIntentDone = true
            try {
              const rec = await d.readUpgradeIntent()
              if (rec && rec.status === 'delegated') {
                // 0.10.6：匹配放宽为「已到或已超过」（实装 ≥ intent 目标，isNewerVersion rc-aware）——
                // 跨版本滞后记录也能收口，不再反复打扰
                const match = rec.version === ctx.pkg.version || isNewerVersion(ctx.pkg.version, rec.version)
                await d.resolveUpgradeIntent({ ok: match, installedVersion: match ? ctx.pkg.version : undefined })
                intentResolved = {
                  ok: match,
                  target: rec.target,
                  // 0.10.4：intentVersion/fromVersion 透出——client 据此补「对账确认」横幅（成功/未完成双形态）
                  intentVersion: rec.version,
                  ...(rec.fromVersion !== undefined ? { fromVersion: rec.fromVersion } : {}),
                  ...(match ? { installedVersion: ctx.pkg.version } : {}),
                }
              }
            } catch {
              // delegated 残留下次进程再收口；绝不阻塞 self-check
            }
          }
          try {
            const latest = await d.npmLatest(ctx.pkg.name, cfg().timeoutMs ?? 20_000)
            const outdated = isNewerVersion(latest.version, ctx.pkg.version)
            // ahead（0.8.0）：本地 dev 版领先 npm 发布——设置页改显「本地开发版」而非误导性的旧「npm 最新」
            const ahead = !outdated && latest.version !== ctx.pkg.version
            payload = { current: ctx.pkg.version, latest: latest.version, outdated, ahead, ...(intentResolved ? { intentResolved } : {}) }
          } catch (err) {
            payload = { current: ctx.pkg.version, latest: null, outdated: false, ahead: false, error: err instanceof Error ? err.message : String(err), ...(intentResolved ? { intentResolved } : {}) }
          }
          break
        }

        case 'self-upgrade': {
          assertWriteAllowed(profile, 'self-upgrade')
          // 0.10.0 D3 自升级专用通道（desktop）：tarball 直装。0.10.2 实证修订：0.2.1 守卫经
          // specPackageName 对 tarball URL 同样解析包名（自升级写穿后宿主完成路径自触守卫 = post-write
          // 伪失败），由 D3 的账实复读改判兜住；通道分治不变——remove+registry-spec 通用两步仍不达自升级。
          // 恒 panel 语义零外部日志（ADR-0018），intent 预写/收口在 core 层。
          if (profile.kind !== 'web') {
            const managed = await d.desktopSelfUpgradeViaTarball(ctx.pkg.name, ctx.pkg.version, {
              timeoutMs: cfg().timeoutMs,
              signal,
              // 0.10.2：账实复读（post-write 伪失败改判）需要 profile 目录
              profileDir: profile.dir,
            }, {
              getService: d.getService,
              ensureService: d.ensureService,
              npmLatest: d.npmLatest,
              npmTarballUrl: d.npmTarballUrl,
              writeUpgradeIntent: d.writeUpgradeIntent,
              resolveUpgradeIntent: d.resolveUpgradeIntent,
              listInstalled: d.listInstalled,
            })
            if ('needsBuildApproval' in managed) {
              // build-blocked（自升级罕见）：结构化透出，不冒充成功
              payload = { ...managed }
              break
            }
            payload = {
              pkg: managed.pkg,
              version: managed.version,
              buildApprovals: managed.buildApprovals ?? [],
              fallbackAllBuilds: false,
              // R10：忠实透传宿主 application——applied/overridden → false；restart-required → true
              needsRestart: managed.needsRestart,
            }
            break
          }
          // M2 Task 3：self-upgrade 收编 market.selfUpgrade（统一 mutation session + 守卫，直调事务旁路封死）
          const result = await d.selfUpgrade(ctx.pkg.name, ctx.pkg.version, cfg(), { signal, channel: 'panel' })
          payload = {
            pkg: result.pkg,
            version: result.version,
            buildApprovals: result.buildApprovals ?? [],
            fallbackAllBuilds: result.fallbackAllBuilds === true,
            needsRestart: true as const,
          }
          break
        }

        case 'registry': {
          await ctx.controller.ensureReady()
          const snap = await ctx.controller.snapshot({ force: boolArg(body.force), signal })
          // 社区 summary：primaryEntries 直接取本次 snapshot（displaced 与本次响应同代，不重拉主清单）；
          // 3s 是本 waiter 的等待上限——到点返回 unavailable summary，主清单响应按契约照常返回。
          // 0.9.11：不再透传 force——「强制刷新」语义是精选清单（registry 链），社区目录走自己的
          // TTL/共享 flight；此前 force 连坐会在弱网下把社区卡打成 3s 超时的「不可用」占位
          // （Windows 实机 2026-10-01：点强制刷新 → 社区卡「获取超时」，flight 后台自愈前一直报错）。
          // 0.9.87 FP3：getCommunitySummary 改道 mergedOutcome（L2）——registry 传 snap.loaded
          // 整体（身份键需要 configuredAddress/fetchedAt）；namespace 'host' + profile 缺省
          // （WEB_PROFILE）与改道前缓存路径逐字节同路。
          const community = await d.getCommunitySummary(snap.loaded, cfg(), {
            force: false,
            signal,
            deadlineAt: Date.now() + 3_000,
            namespace: 'host',
          })
          payload = { plugins: snap.loaded.registry.plugins, registryState: snap.loaded, community }
          break
        }

        case 'primary-screenshots': {
          const id = strArg(body, 'id')
          if (!id) throw new ApiProtocolError(400, '缺少 id')
          await ctx.controller.ensureReady({ signal })
          const snap = await ctx.controller.snapshot({ signal })
          // 只信 active Primary Registry 的精确 id → github 映射；请求体中的 github/url 一律忽略。
          // 本 method 不调用 listMarket/getCommunitySummary，也不加载 Community Catalog。
          const entry = snap.loaded.registry.plugins.find((candidate) => candidate.id === id)
          if (!entry || typeof entry.github !== 'string' || entry.github.trim() === '') {
            payload = { screenshots: [] }
            break
          }
          try {
            payload = { screenshots: await d.loadPrimaryScreenshots(entry.github) }
          } catch {
            // 截图是可选详情元数据；manifest 不可用不应阻塞详情或安装决策。
            payload = { screenshots: [] }
          }
          break
        }

        case 'market': {
          await ctx.controller.ensureReady()
          // GUI policy：忽略客户端 withLatest，固定 true；limit clamp 1..96、缺省 32
          // （0.7.0 Task 7 探测预算决策：96 为 opt-in 页大小，0.9.28 起默认 32 仍低于 0.6.x 默认 50 的探测负载；
          //  最坏情况被 core 60s deadline 框死为 latestError，不阻塞列表，Q46 不动）
          // 0.9.92 三端查询文法：category/source/limit/offset 经 market-query 单一入口归一（与 tools/CLI
          // 同源同语义）；双违例顺序统一 category → source → 端本地参数（红线 #6 注记）。
          let intake: MarketQueryIntake
          try {
            intake = parseMarketQueryInput(
              { category: body.category, source: body.source, limit: body.limit, offset: body.offset },
              { limitMax: 96, limitDefault: 32 },
            )
          } catch (e) {
            if (e instanceof MarketQueryError) throw new ApiProtocolError(400, e.message)
            throw e
          }
          // source 分区 + sort（0.7.0 Task 7）：非法值 400（不静默吞）；primaryOnly 已删除——显式拒绝而非静默忽略（审计 #8）
          if (body.primaryOnly !== undefined) {
            throw new ApiProtocolError(400, '参数 primaryOnly 已删除：改用 source（primary/community/all）')
          }
          let sort: { field: 'downloads' | 'stars' | 'added'; dir: 'asc' | 'desc' } | undefined
          if (body.sort !== undefined && body.sort !== null) {
            const s = body.sort as { field?: unknown; dir?: unknown }
            if (
              (s.field === 'downloads' || s.field === 'stars' || s.field === 'added') &&
              (s.dir === 'asc' || s.dir === 'desc')
            ) {
              sort = { field: s.field, dir: s.dir }
            } else {
              throw new ApiProtocolError(400, '非法 sort: 需 { field: downloads|stars|added, dir: asc|desc }')
            }
          }
          // probeMode 两态（0.9.45 市场页两段加载，ADR-0013）：GUI 两段式自带；非法值 400（与 source/sort 同款不静默吞）
          const probeModeRaw = typeof body.probeMode === 'string' ? body.probeMode : undefined
          if (probeModeRaw !== undefined && probeModeRaw !== 'full' && probeModeRaw !== 'cache-only') {
            throw new ApiProtocolError(400, `非法 probeMode: ${probeModeRaw}（需 full/cache-only）`)
          }
          const result = await d.listMarket(cfg(), {
            query: strArg(body, 'query'),
            category: intake.category,
            source: intake.source,
            sort,
            // 0.9.26：GUI 跨区搜索精选稳定前置（listMarket 内部仅在 source='all' 且 query 非空时生效）。
            // 本参数仅 GUI 通道携带——tools/CLI 走各自调用面不传，搜索排序三端同序不变。
            curatedFirst: true,
            offset: intake.offset,
            limit: intake.limit,
            force: boolArg(body.force),
            withLatest: true,
            probeMode: probeModeRaw,
            namespace: 'host',
            // 0.9.5 双 profile 读路径接线（实机回归 2026-10-01）：desktop 下市场「已安装」
            // 徽标此前漏传 profile → listMarket 内部落回 webProfileDir，已装徽标恒空。
            profileDir: profile.dir,
            profile: profile.name,
            signal,
          })
          payload = { ...result }
          break
        }

        case 'market-ids-exist': {
          // 0.9.87 FP2：收藏 stale 检测批量化——一次批量 id 存在性查询取代逐收藏完整 market 扇出。
          // 校验：非空字符串数组 ≤500（trim 后透传）；违例 400（与 source/sort/probeMode 同款不静默吞）。
          const rawIds = body.ids
          if (!Array.isArray(rawIds) || rawIds.length > 500 || rawIds.some((v) => typeof v !== 'string' || v.trim() === '')) {
            throw new ApiProtocolError(400, '非法 ids: 需非空字符串数组（≤500）')
          }
          const ids = (rawIds as string[]).map((v) => v.trim())
          const result = await d.existingMarketIds(ids, cfg(), {
            namespace: 'host',
            profile: profile.name,
            signal,
          })
          payload = { present: result.present }
          break
        }

        case 'installed': {
          await ctx.controller.ensureReady()
          // 0.9.5 双 profile 读路径接线（实机回归 2026-10-01）：desktop 下已装列表此前
          // 漏传 profile → 落回 webProfileDir，已装页恒显「web profile 尚未安装任何插件」。
          // 与 tools.ts dshm_list 同款接线（profile.dir 单一事实源）。
          // 两段加载（ADR-0008）：body.probe === false → 跳过探测段（面板第一段快列表）；
          // 缺省 'full'——工具/CLI/旧客户端行为不变。
          const result = await d.listInstalledWithMeta(cfg(), {
            namespace: 'host',
            profileDir: profile.dir,
            profile: profile.name,
            probeMode: body.probe === false ? 'none' : 'full',
            icon: true,
            signal,
          })
          payload = { ...result }
          break
        }

        case 'installedUpdates': {
          // 两段加载（ADR-0008）第二段：probeMode 'only' → ttlMin=0 永远新鲜（先删共享缓存条目再重探）。
          // 响应只保留更新字段且含全部已装项（latestError 项也在——client 的「检查未完成」依赖它），
          // 不携带 items/others 全量负载。
          await ctx.controller.ensureReady()
          const result = await d.listInstalledWithMeta(cfg(), {
            namespace: 'host',
            profileDir: profile.dir,
            profile: profile.name,
            probeMode: 'only',
            icon: false,
            signal,
          })
          payload = {
            updates: result.items.map((it) => ({
              pkg: it.pkg,
              latestVersion: it.latestVersion ?? null,
              latestTag: it.latestTag ?? null,
              latestSha: it.latestSha ?? null,
              outdated: it.outdated,
              latestError: it.latestError ?? null,
              latestErrorCode: it.latestErrorCode ?? null,
            })),
          }
          break
        }

        case 'readme': {
          const target = strArg(body, 'pkg')
          if (!target) throw new ApiProtocolError(400, '缺少 pkg')
          // 0.9.0 双 profile：README 优先只读当前 profile 的 node_modules；
          // 0.9.45 U10b 修复：市场/收藏详情 Modal 的 README 折叠页对「未安装」条目也会发起读取
          // （装前决策场景）——本地未装时回源 npm 兜底（0.9.50 起为 /latest + packument 两腿阶梯）；
          // 0.9.50 语义修订：兜底两腿全败不再只抛原始本地错误——本地错误为主语、附「npm README
          // 兜底失败: <终末腿原因>」摘要，真实死因（如响应超帽）不再被吞。
          let result: PluginReadme
          try {
            result = await d.readInstalledPluginReadme(target, profile.dir, profile.name)
          } catch (localErr) {
            try {
              const fallback = await d.npmPackumentReadme(target)
              result = { pkg: target, name: target, readme: fallback.readme, truncated: false, repo: fallback.repo || undefined }
            } catch (fallbackErr) {
              const localMsg = localErr instanceof Error ? localErr.message : String(localErr)
              const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
              throw new Error(`${localMsg}（npm README 兜底失败: ${fallbackMsg}）`, { cause: localErr })
            }
          }
          payload = { ...result }
          break
        }

        case 'status':
          payload = { ...publicInstallStatus() }
          break

        case 'install': {
          const id = strArg(body, 'id')
          if (!id) throw new ApiProtocolError(400, '缺少 id')
          // 0.9.0：desktop → 官方 pluginManager 委派（新包）；web → 既有事务
          if (profile.kind !== 'web') {
            assertWriteAllowed(profile, 'install')
            payload = { ...(await d.desktopInstall(id, cfg(), {
              version: typeof body.version === 'string' ? body.version : undefined,
              forceIncompatible: boolArg(body.forceIncompatible),
              namespace: 'host',
              profile: profile.name,
              profileDir: profile.dir,
              signal,
              channel: 'panel',
            }, {
              getService: d.getService,
              ensureService: d.ensureService,
              // 0.10.0：R5 previousVersion / SELF_PKG 缝改道注入透传（生产缺省 = 真实现；测试面经 overrides）
              npmLatest: d.npmLatest,
              listInstalled: d.listInstalled,
              npmTarballUrl: d.npmTarballUrl,
              writeUpgradeIntent: d.writeUpgradeIntent,
              resolveUpgradeIntent: d.resolveUpgradeIntent,
            })) }
            break
          }
          const version = typeof body.version === 'string' ? body.version : undefined
          const result = await d.installFromRegistry(id, cfg(), {
            version,
            forceIncompatible: boolArg(body.forceIncompatible),
            namespace: 'host',
            signal,
            channel: 'panel',
          })
          payload = { ...result }
          break
        }

        case 'uninstall': {
          const target = strArg(body, 'pkg')
          if (!target) throw new ApiProtocolError(400, '缺少 pkg')
          assertWriteAllowed(profile, 'uninstall')
          // 0.9.8：desktop → 官方管理器 removeBundle（dsh-market 同策略；此前结构化拒绝）
          if (profile.kind !== 'web') {
            payload = { ...(await d.desktopUninstall(target, { getService: d.getService, ensureService: d.ensureService, profileDir: profile.dir, channel: 'panel' })) }
            break
          }
          const result = await d.uninstallPlugin(target, cfg(), { namespace: 'host', signal, channel: 'panel' })
          payload = { ...result }
          break
        }

        case 'set-enabled': {
          const target = strArg(body, 'pkg')
          if (!target) throw new ApiProtocolError(400, '缺少 pkg')
          if (typeof body.enabled !== 'boolean') throw new ApiProtocolError(400, '缺少 enabled（必须为 boolean）')
          // 0.9.0：desktop → 官方管理器委派（服务缺席结构化拒绝，禁 fallback 文件写）
          if (profile.kind !== 'web') {
            assertWriteAllowed(profile, 'set-enabled')
            payload = { ...(await d.desktopToggle(target, body.enabled, { getService: d.getService as never, profileDir: profile.dir, channel: 'panel' })) }
            break
          }
          const result = await d.toggle(target, body.enabled, { getService: d.getService, channel: 'panel' })
          payload = { ...result }
          break
        }

        case 'upgrade': {
          const target = strArg(body, 'pkg')
          if (!target) throw new ApiProtocolError(400, '缺少 pkg')
          assertWriteAllowed(profile, 'upgrade')
          // 0.9.8：desktop → 官方管理器覆盖安装（dsh-market 同策略；此前结构化拒绝）
          if (profile.kind !== 'web') {
            payload = { ...(await d.desktopUpgrade(target, cfg(), {
              forceIncompatible: boolArg(body.forceIncompatible),
              namespace: 'host',
              profile: profile.name,
              profileDir: profile.dir,
              signal,
              channel: 'panel',
            }, {
              getService: d.getService,
              ensureService: d.ensureService,
              // 0.10.0：两步化 previousVersion / SELF_PKG 缝改道 → D3 全链注入透传（生产缺省 = 真实现）
              npmLatest: d.npmLatest,
              listInstalled: d.listInstalled,
              npmTarballUrl: d.npmTarballUrl,
              writeUpgradeIntent: d.writeUpgradeIntent,
              resolveUpgradeIntent: d.resolveUpgradeIntent,
            })) }
            break
          }
          const result = await d.upgradePlugin(target, cfg(), {
            forceIncompatible: boolArg(body.forceIncompatible),
            namespace: 'host',
            signal,
            channel: 'panel',
          })
          payload = { ...result }
          break
        }

        case 'external-operations': {
          // 0.9.79 外部操作记录（ADR-0018）：面板「已结束」overlay 数据源；鉴权走方法分发前的
          // 既有宿主信任检查（零新增特例）
          const records = await d.listExternalOperations()
          payload = { records }
          break
        }

        case 'external-operations-clear': {
          await d.clearExternalOperations()
          payload = {}
          break
        }

        case 'external-operations-remove': {
          // 0.9.82 修订 R2-3：外部 failed 行单条 ✕ 的服务端出口；鉴权同 list/clear（零新增特例）
          if (typeof body.id !== 'string' || body.id === '') throw new ApiProtocolError(400, '缺少 id')
          await d.removeExternalOperation(body.id)
          payload = {}
          break
        }

        case 'restart': {
          // 0.9.0：Desktop 不触发旧 helper（Electron 生命周期归官方；杀子进程=红线）
          assertWriteAllowed(profile, 'restart')
          const result = d.scheduleRestart(servingPort(req))
          payload = { ...result }
          break
        }

        case 'registry-config': {
          const snap = await ctx.controller.snapshot()
          payload = { applied: false, ...snapshotPayload(snap, cfg()) }
          break
        }

        case 'registry-config-apply': {
          if (typeof body.registryUrl !== 'string') throw new ApiProtocolError(400, '缺少 registryUrl')
          const snap = await ctx.controller.apply(body.registryUrl, { signal })
          payload = { applied: true, ...snapshotPayload(snap, cfg()) }
          break
        }

        case 'set-community': {
          // 0.8.0 设置页社区开关：live 生效（内存）+ store 持久化；无需主清单重载
          if (typeof body.enabled !== 'boolean') throw new ApiProtocolError(400, '缺少 enabled（必须为 boolean）')
          const snap = await ctx.controller.setCommunity(body.enabled)
          payload = { applied: true, ...snapshotPayload(snap, cfg()) }
          break
        }

        case 'registry-default-download': {
          const loaded = await ctx.controller.loadDefault({ force: true, signal })
          payload = { registry: loaded.registry, registryState: loaded }
          break
        }

        case 'registry-diagnose': {
          await ctx.controller.ensureReady()
          const snap = await ctx.controller.snapshot()
          const check = await d.checkRegistryEntries(snap.loaded.registry, { signal })
          payload = { registryState: snap.loaded, check }
          break
        }

        case 'doctor': {
          // 体检（ADR-0010）：纯 FS 只读，不依赖 registry（清单不可用时照常工作）。
          // runtimeVersion 只用 readLauncherPackageVersion 纯 FS 通路——resolveDshVersion 的
          // spawn 回退是 doctor 禁区（无进程派生约束；null 即降级，测试覆盖分工见计划 Task 6）。
          const report = await runDoctor(profile.dir, readLauncherPackageVersion())
          payload = { report }
          break
        }

        default:
          throw new ApiProtocolError(404, `未知 method: ${method}`)
      }
      sendJson(res, 200, { ok: true, ...payload })
    } catch (err) {
      const { status, payload } = errorStatus(err)
      if (!res.headersSent) sendJson(res, status, payload)
      else res.destroy()
    }
  }
}
