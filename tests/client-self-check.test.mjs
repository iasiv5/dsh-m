/**
 * 头部版本角标 self-check 纯逻辑单测（0.9.1）。
 * 覆盖：TTL 缓存读写清、畸形/过期/版本护栏作废、deriveChipState 三态判定。
 * 需求口径：只有 outdated 才点亮（{ kind: 'outdated' }），其余一律静默。
 * 0.10.0 Task 11：自升级确认先行结构序钉（确认前零 api / needsRestart 透传）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SELF_CHECK_STORAGE_KEY,
  SELF_CHECK_TTL_MS,
  readSelfCheckCache,
  writeSelfCheckCache,
  clearSelfCheckCache,
  deriveChipState,
} from '../src/client/self-check.js'

/** Map 存储桩（localStorage 同构子集；throwing 可注入故障）。 */
function memStorage({ throwOn = null } = {}) {
  const m = new Map()
  return {
    getItem: (k) => {
      if (throwOn === 'get') throw new Error('boom')
      return m.has(k) ? m.get(k) : null
    },
    setItem: (k, v) => {
      if (throwOn === 'set') throw new Error('quota')
      m.set(k, String(v))
    },
    removeItem: (k) => {
      if (throwOn === 'remove') throw new Error('boom')
      m.delete(k)
    },
    _map: m,
  }
}

const DATA = { current: '0.9.0', latest: '0.9.1', outdated: true, ahead: false }
const NOW = 1_700_000_000_000

describe('self-check 缓存', () => {
  it('write → read 回环：TTL 内且版本一致命中', () => {
    const s = memStorage()
    writeSelfCheckCache(s, DATA, { now: NOW })
    assert.deepEqual(readSelfCheckCache(s, { now: NOW + 1000, version: '0.9.0' }), DATA)
    // 未传 version：不做版本护栏
    assert.deepEqual(readSelfCheckCache(s, { now: NOW + 1000 }), DATA)
    assert.ok(s._map.has(SELF_CHECK_STORAGE_KEY))
  })

  it('TTL 过期 → null（默认 30 分钟；自定义 ttlMs 同样生效）', () => {
    const s = memStorage()
    writeSelfCheckCache(s, DATA, { now: NOW })
    assert.equal(readSelfCheckCache(s, { now: NOW + SELF_CHECK_TTL_MS + 1 }), null)
    assert.equal(readSelfCheckCache(s, { now: NOW + 1000, ttlMs: 500 }), null)
  })

  it('版本护栏：缓存 current 与当前 version 不一致（升级重启后）→ 作废', () => {
    const s = memStorage()
    writeSelfCheckCache(s, DATA, { now: NOW })
    assert.equal(readSelfCheckCache(s, { now: NOW + 1000, version: '0.9.1' }), null)
    // version 为 null/空（ping 未带回）→ 不启用护栏，照常命中
    assert.deepEqual(readSelfCheckCache(s, { now: NOW + 1000, version: null }), DATA)
  })

  it('畸形情形全部安全返回 null：storage 缺失 / 无键 / 非 JSON / 畸形 box / 畸形 data / 读取抛错', () => {
    assert.equal(readSelfCheckCache(null, {}), null)
    assert.equal(readSelfCheckCache(undefined, {}), null)
    const s = memStorage()
    assert.equal(readSelfCheckCache(s, {}), null)
    s.setItem(SELF_CHECK_STORAGE_KEY, '{not-json')
    assert.equal(readSelfCheckCache(s, {}), null)
    s.setItem(SELF_CHECK_STORAGE_KEY, JSON.stringify({ ts: NOW })) // 缺 data
    assert.equal(readSelfCheckCache(s, {}), null)
    s.setItem(SELF_CHECK_STORAGE_KEY, JSON.stringify({ ts: NOW, data: { no: 'current' } }))
    assert.equal(readSelfCheckCache(s, {}), null)
    s.setItem(SELF_CHECK_STORAGE_KEY, JSON.stringify({ ts: 'NaN', data: DATA }))
    assert.equal(readSelfCheckCache(s, {}), null)
    assert.equal(readSelfCheckCache(memStorage({ throwOn: 'get' }), {}), null)
  })

  it('write 防御：data 畸形 / storage 缺失 / 写入抛错 → 静默（缓存是优化不是功能）', () => {
    const s = memStorage()
    writeSelfCheckCache(s, null, {})
    writeSelfCheckCache(s, { no: 'current' }, {})
    writeSelfCheckCache(null, DATA, {})
    assert.equal(s._map.size, 0)
    writeSelfCheckCache(memStorage({ throwOn: 'set' }), DATA, {})
  })

  it('clear：删除键；storage 缺失/抛错静默', () => {
    const s = memStorage()
    writeSelfCheckCache(s, DATA, { now: NOW })
    clearSelfCheckCache(s)
    assert.equal(readSelfCheckCache(s, { now: NOW }), null)
    clearSelfCheckCache(null)
    clearSelfCheckCache(memStorage({ throwOn: 'remove' }))
  })
})

describe('deriveChipState 三态', () => {
  it('outdated=true 且 latest 非空 → 唯一点亮态', () => {
    assert.deepEqual(deriveChipState(DATA, '0.9.0'), { kind: 'outdated', latest: '0.9.1' })
  })

  it('版本护栏（0.9.2）：check.current ≠ 当前 ping.version（跨服务重启的旧进程判定）→ 一律静默', () => {
    // 面板常开跨重启：version 已是新进程 0.9.1，check 还是旧进程 0.9.0 的 outdated 判定
    // ——不得渲染「v0.9.1 ⬆ v0.9.1」
    assert.deepEqual(deriveChipState(DATA, '0.9.1'), { kind: 'idle' })
    assert.deepEqual(
      deriveChipState({ current: '0.9.0', latest: '0.9.1', outdated: false, ahead: true }, '0.9.1'),
      { kind: 'idle' },
    )
    // version 缺席（ping 失败/旧宿主）→ 无从比对，不启用护栏，维持原判定
    assert.deepEqual(deriveChipState(DATA, null), { kind: 'outdated', latest: '0.9.1' })
  })

  it('outdated=true 但 latest 缺失（服务端半残）→ 静默，不点亮空箭头', () => {
    assert.deepEqual(deriveChipState({ current: '0.9.0', latest: null, outdated: true, ahead: false }), { kind: 'idle' })
    assert.deepEqual(deriveChipState({ current: '0.9.0', outdated: true }), { kind: 'idle' })
  })

  it('ahead → 静默态（仅 title 用），idle 同样静默', () => {
    assert.deepEqual(deriveChipState({ current: '0.9.1', latest: '0.9.0', outdated: false, ahead: true }, '0.9.1'), { kind: 'ahead', latest: '0.9.0' })
    assert.deepEqual(deriveChipState({ current: '0.9.1', latest: null, outdated: false, ahead: true }, '0.9.1'), { kind: 'ahead', latest: null })
    assert.deepEqual(deriveChipState({ current: '0.9.1', latest: '0.9.1', outdated: false, ahead: false }, '0.9.1'), { kind: 'idle' })
    // ahead 携带 error（检查虽成、降级口径）也不影响
    assert.deepEqual(deriveChipState({ current: '0.9.1', latest: '0.9.0', outdated: false, ahead: true, error: 'x' }, '0.9.1'), { kind: 'ahead', latest: '0.9.0' })
  })

  it('无数据 / 检查失败 payload → idle 静默', () => {
    assert.deepEqual(deriveChipState(null, '0.9.0'), { kind: 'idle' })
    assert.deepEqual(deriveChipState(undefined, '0.9.0'), { kind: 'idle' })
    assert.deepEqual(deriveChipState('junk', '0.9.0'), { kind: 'idle' })
    assert.deepEqual(deriveChipState({ current: '0.9.0', latest: null, outdated: false, ahead: false, error: 'network' }, '0.9.0'), { kind: 'idle' })
  })
})

// ---------- 0.10.2（主人 2026-10-17 裁决）：静默自升级——撤确认框，角标点击直接升级（结构钉） ----------
// ADR-0023 第一刀：词典面断言改读 i18n.js；T10：chip 结构锚随 DshmVersionChip 迁 version-chip.jsx
const i18nSrc = readFileSync(new URL('../src/client/i18n.js', import.meta.url), 'utf8')
describe('0.10.2 静默自升级（结构序钉；0.10.1 确认框按主人体验裁决撤除）', () => {
  const src = readFileSync(new URL('../src/client/version-chip.jsx', import.meta.url), 'utf8')

  it('① doUpgrade 直呼 performUpgrade（零中间确认态）；self-upgrade 调用全部收敛在升级臂', () => {
    const start = src.indexOf('const doUpgrade = async () => {')
    const end = src.indexOf('const performUpgrade = async () => {')
    assert.ok(start >= 0 && end > start, 'doUpgrade / performUpgrade 两段结构在')
    const doBody = src.slice(start, end)
    assert.ok(!doBody.includes('api('), '升级臂外零 self-upgrade 调用')
    assert.ok(doBody.includes('performUpgrade()'), '点击即升级（静默，0.10.1 确认框已撤）')
    assert.ok(!src.includes('setConfirming'), '确认态已整体移除')
    // runOp 臂 + 无 ops 回退臂（SSR/探针，0.9.84- 行为）都只允许出现在升级臂内
    let idx = -1
    while ((idx = src.indexOf('api("self-upgrade")', idx + 1)) >= 0) {
      assert.ok(idx > end, `self-upgrade 调用必须位于升级臂（偏移 ${idx}）`)
    }
    assert.ok(src.includes('api("self-upgrade")'), '升级臂存在')
  })

  it('② 确认框文案键与按钮键零残留（dead key 清理；调用面 + 词典面双扫——ADR-0023 T1）', () => {
    assert.ok(!src.includes('selfupgrade.confirm') && !i18nSrc.includes('selfupgrade.confirm'), 'confirm 句式键已退役（双面）')
    assert.ok(!src.includes('selfupgrade.go') && !i18nSrc.includes('selfupgrade.go'), '确认按钮键已退役（双面）')
  })

  it('③ needsRestart 忠实透传响应值（R10）：res.needsRestart ?? true——applied→false 不弹重启横幅', () => {
    // ADR-0023 第二刀：判定单源迁 panel-ops.js（保守默认 ?? true 收进 restartBannerDecision，直测见 client-panel-ops）
    const po = readFileSync(new URL('../src/client/panel-ops.js', import.meta.url), 'utf8')
    assert.ok(po.includes('r.needsRestart ?? true'), '透传锚（旧 needsRestart: true 已退役）')
    // 评审 R1-3：负向锚用单行切片锚（含 \n 的多行锚在 CRLF 工作树恒真、回归保护失效）
    const start = src.indexOf('const performUpgrade = async () => {')
    const end = src.indexOf('const state = deriveChipState(check, version);')
    assert.ok(start >= 0 && end > start, 'performUpgrade 切片边界在')
    const body = src.slice(start, end)
    assert.ok(!body.includes('needsRestart: true'), '升级臂内不得残留硬编码 needsRestart: true（单行锚，CRLF 免疫）')
  })
})

// ---------- 0.10.4（0.10.3 dogfood 挂账）：对账改判补横幅——成功/未完成都不再随面板重载静默 ----------
describe('0.10.4 对账改判补横幅（结构钉 + 文案键双字典）', () => {
  const src = readFileSync(new URL('../src/client/version-chip.jsx', import.meta.url), 'utf8')
  const _count = (needle) => src.split(needle).length - 1

  it('① chip self-check 消费 intentResolved：ok → 成功横幅；未完成 → warn 横幅（单行锚）', () => {
    assert.ok(src.includes('const ir = data.intentResolved;'), 'intentResolved 消费在')
    assert.ok(src.includes('lookup("selfupgrade.reconciled.done"'), '成功补横幅锚')
    assert.ok(src.includes('lookup("selfupgrade.reconciled.failed"'), '未完成 warn 横幅锚')
  })

  it('② done/failed 两键双语各一枚（zh/en；i18n.js 词典面——ADR-0023 T1）', () => {
    assert.equal(i18nSrc.split('"selfupgrade.reconciled.done": "').length - 1, 2)
    assert.equal(i18nSrc.split('"selfupgrade.reconciled.failed": "').length - 1, 2)
  })
})
