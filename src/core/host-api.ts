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
  installFromRegistry,
  selfUpgrade,
  uninstallPlugin,
  upgradePlugin,
  InstallGuardError,
} from './market.js'
import { runProfileTransaction, TransactionError, makeNpmWarmPackument } from './profile-transaction.js'
import { readInstalledPluginReadme } from './installed.js'
import { isNewerVersion, npmLatest } from './versions.js'
import { getCommunitySummary } from './community.js'
import type { RegistryController, RegistryControllerSnapshot } from './registry-controller.js'
import { RegistryConfigError } from './registry-controller.js'
import { checkRegistryEntries } from './registry-check.js'
import { CATEGORIES } from './registry.js'
import { servingPort, scheduleRestart } from './restart.js'
import { togglePlugin, ToggleError, type PluginManagerLike } from './toggle.js'
import { IncompatibleError } from './compat-check.js'
import { ProfileUnsupportedError, assertWriteAllowed, type ActiveProfile } from './active-profile.js'
import { DesktopOpsError, desktopInstallFromRegistry, desktopToggle, desktopUninstall, desktopUpgradeFromRegistry, type DesktopManagerLike } from './profile-ops.js'
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
  installFromRegistry?: typeof installFromRegistry
  uninstallPlugin?: typeof uninstallPlugin
  upgradePlugin?: typeof upgradePlugin
  selfUpgrade?: typeof selfUpgrade
  checkRegistryEntries?: typeof checkRegistryEntries
  npmLatest?: typeof npmLatest
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
/** 社区开放分类安全 slug（计划 Task 6；与适配层 COMMUNITY_CATEGORY_RE 同语义） */
const COMMUNITY_SLUG_RE = /^[a-z0-9-]{1,32}$/

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
    // 装后守卫拦截（M2 Task 3）：结构化投影含 needsRestart/restartSafe/kind——GUI 一键重启只读 restartSafe
    return {
      status: 409,
      payload: {
        ok: false,
        error: err.message,
        kind: err.kind,
        violations: err.violations,
        compensation: err.compensation,
        needsRestart: err.needsRestart,
        restartSafe: err.restartSafe,
        ...(err.repairBasis ? { repairBasis: err.repairBasis } : {}),
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
    installFromRegistry: ctx.deps?.installFromRegistry ?? installFromRegistry,
    uninstallPlugin: ctx.deps?.uninstallPlugin ?? uninstallPlugin,
    upgradePlugin: ctx.deps?.upgradePlugin ?? upgradePlugin,
    selfUpgrade: ctx.deps?.selfUpgrade ?? selfUpgrade,
    checkRegistryEntries: ctx.deps?.checkRegistryEntries ?? checkRegistryEntries,
    npmLatest: ctx.deps?.npmLatest ?? npmLatest,
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
    ensureService: ctx.deps?.ensureService,
  }
  const cfg = (): typeof ctx.controller.config => ctx.controller.config
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
          try {
            const latest = await d.npmLatest(ctx.pkg.name, cfg().timeoutMs ?? 20_000)
            const outdated = isNewerVersion(latest.version, ctx.pkg.version)
            // ahead（0.8.0）：本地 dev 版领先 npm 发布——设置页改显「本地开发版」而非误导性的旧「npm 最新」
            const ahead = !outdated && latest.version !== ctx.pkg.version
            payload = { current: ctx.pkg.version, latest: latest.version, outdated, ahead }
          } catch (err) {
            payload = { current: ctx.pkg.version, latest: null, outdated: false, ahead: false, error: err instanceof Error ? err.message : String(err) }
          }
          break
        }

        case 'self-upgrade': {
          assertWriteAllowed(profile, 'self-upgrade')
          // 0.9.8：desktop → 官方管理器覆盖安装 dsh-m@latest（dsh-market 同策略实证；
          // 生效仍需重启 Desktop——banner.desktop 指引由客户端 needsRestart 通道给出）
          if (profile.kind !== 'web') {
            const managed = await d.desktopInstall(ctx.pkg.name, cfg(), {
              namespace: 'host',
              profile: profile.name,
              profileDir: profile.dir,
              signal,
            }, { getService: d.getService, ensureService: d.ensureService })
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
              needsRestart: true as const,
            }
            break
          }
          // M2 Task 3：self-upgrade 收编 market.selfUpgrade（统一 mutation session + 守卫，直调事务旁路封死）
          const result = await d.selfUpgrade(ctx.pkg.name, ctx.pkg.version, cfg(), { signal })
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
          const community = await d.getCommunitySummary(snap.loaded.registry.plugins, cfg(), {
            force: false,
            signal,
            deadlineAt: Date.now() + 3_000,
          })
          payload = { plugins: snap.loaded.registry.plugins, registryState: snap.loaded, community }
          break
        }

        case 'market': {
          await ctx.controller.ensureReady()
          // GUI policy：忽略客户端 withLatest，固定 true；limit clamp 1..96、缺省 32
          // （0.7.0 Task 7 探测预算决策：96 为 opt-in 页大小，0.9.28 起默认 32 仍低于 0.6.x 默认 50 的探测负载；
          //  最坏情况被 core 60s deadline 框死为 latestError，不阻塞列表，Q46 不动）
          const limitRaw = Number(body.limit)
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(96, Math.max(1, Math.floor(limitRaw))) : 32
          const offsetRaw = Number(body.offset)
          const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0
          // category：策展五桶 + 社区开放 slug（非法 slug → 400，不静默吞）
          const categoryRaw = typeof body.category === 'string' ? body.category.trim() : ''
          let category: string | null = null
          if (categoryRaw !== '') {
            if ((CATEGORIES as readonly string[]).includes(categoryRaw) || COMMUNITY_SLUG_RE.test(categoryRaw)) {
              category = categoryRaw
            } else {
              throw new ApiProtocolError(400, `非法分类: ${categoryRaw}（需精选分类或 [a-z0-9-]{1,32} slug）`)
            }
          }
          // source 分区 + sort（0.7.0 Task 7）：非法值 400（不静默吞）；primaryOnly 已删除——显式拒绝而非静默忽略（审计 #8）
          if (body.primaryOnly !== undefined) {
            throw new ApiProtocolError(400, '参数 primaryOnly 已删除：改用 source（primary/community/all）')
          }
          const sourceRaw = typeof body.source === 'string' ? body.source.trim() : ''
          if (sourceRaw !== '' && sourceRaw !== 'primary' && sourceRaw !== 'community' && sourceRaw !== 'all') {
            throw new ApiProtocolError(400, `非法 source: ${sourceRaw}（需 primary/community/all）`)
          }
          const source = sourceRaw === '' ? 'all' : sourceRaw
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
            category,
            source,
            sort,
            // 0.9.26：GUI 跨区搜索精选稳定前置（listMarket 内部仅在 source='all' 且 query 非空时生效）。
            // 本参数仅 GUI 通道携带——tools/CLI 走各自调用面不传，搜索排序三端同序不变。
            curatedFirst: true,
            offset,
            limit,
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
          // 0.9.0 双 profile：README 只读当前 profile 的 node_modules
          const result = await readInstalledPluginReadme(target, profile.dir)
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
            }, { getService: d.getService, ensureService: d.ensureService })) }
            break
          }
          const version = typeof body.version === 'string' ? body.version : undefined
          const result = await d.installFromRegistry(id, cfg(), {
            version,
            forceIncompatible: boolArg(body.forceIncompatible),
            namespace: 'host',
            signal,
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
            payload = { ...(await d.desktopUninstall(target, { getService: d.getService, ensureService: d.ensureService, profileDir: profile.dir })) }
            break
          }
          const result = await d.uninstallPlugin(target, cfg(), { namespace: 'host', signal })
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
            payload = { ...(await d.desktopToggle(target, body.enabled, { getService: d.getService as never, profileDir: profile.dir })) }
            break
          }
          const result = await d.toggle(target, body.enabled, { getService: d.getService })
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
            }, { getService: d.getService, ensureService: d.ensureService })) }
            break
          }
          const result = await d.upgradePlugin(target, cfg(), {
            forceIncompatible: boolArg(body.forceIncompatible),
            namespace: 'host',
            signal,
          })
          payload = { ...result }
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
