/**
 * 壳接管诊断（2026-10-30 哨兵退役，issue #33）：入口恒在场，判定降级为诊断信号。
 * - hasShellTakeover：sidebar.workspaces 台账是否存在负 priority 占位者。不再分档——
 *   COOPERATIVE_SHELL_LOCALES 白名单随门控一并退役（ds-bot 0.2.4 接管条目无 locale/
 *   id/key，locale 名单两方向都结构性够不着；误伤史与契约勘误见 ADR-0027）。
 * - 退役锚：main.jsx 不再消费哨兵作渲染门控（`if (shellTakeover()) return null` 移除），
 *   诊断经 MarketEntry 每次 render 后的 useEffect 打点，会话级一次性 flag 防重复。
 * 运行：npm run build && node --test tests/client-shell-takeover.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { hasShellTakeover } from '../src/client/shell-takeover.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('hasShellTakeover：接管环境判定（诊断专用，不分档）', () => {
  it('负 priority、无 locale → 判定接管存在（ds-bot 0.2.4 形态：无声明字段）', () => {
    assert.equal(hasShellTakeover([{ options: { priority: -100 } }]), true)
  })

  it('负 priority + 任意 locale → 判定接管存在（分档退役，白名单豁免不复存在）', () => {
    assert.equal(hasShellTakeover([{ options: { priority: -1 }, locale: 'michengai.codexUi' }]), true)
    assert.equal(hasShellTakeover([{ options: { priority: -1 }, locale: 'betterWorkspace' }]), true)
  })

  it('官方工作区树（priority 0 / 缺省）→ 非接管', () => {
    assert.equal(hasShellTakeover([{ options: {} }]), false)
    assert.equal(hasShellTakeover([{ options: { priority: 0 }, locale: 'workspace' }]), false)
  })

  it('混合：官方 + 负 priority → 判定接管存在', () => {
    const official = { options: { priority: 0 }, locale: 'workspace' }
    const taker = { options: { priority: -1 }, locale: 'betterWorkspace' }
    assert.equal(hasShellTakeover([official, taker]), true)
  })

  it('畸形输入安全：null 条目 / 非数组 / 空 entries', () => {
    assert.equal(hasShellTakeover([null]), false)
    assert.equal(hasShellTakeover(undefined), false)
    assert.equal(hasShellTakeover('x'), false)
    assert.equal(hasShellTakeover([]), false)
  })
})

describe('退役锚：门控移除 + 诊断接线（main.jsx / shell-takeover.js 源码锚）', () => {
  const main = () => readFileSync(join(root, 'src', 'client', 'main.jsx'), 'utf8')
  const takeover = () => readFileSync(join(root, 'src', 'client', 'shell-takeover.js'), 'utf8')

  it('main.jsx 渲染门控已移除（旧哨兵模式与旧判定名均不残留）', () => {
    const src = main()
    assert.equal(src.includes('if (shellTakeover()) return null'), false, '门控应已移除')
    assert.equal(src.includes('isNativeFootShell'), false, '旧判定名不应残留')
  })

  it('main.jsx 诊断接线：hasShellTakeover 恰 require+调用两处 + 一次性 flag + 话术', () => {
    const src = main()
    const hits = src.split('hasShellTakeover').length - 1
    assert.equal(hits, 2, `hasShellTakeover 应恰有 require + 调用两处（实测 ${hits}）`)
    assert.equal(src.includes('takeoverDiagnosticShown'), true, '一次性 flag 缺失')
    assert.equal(src.includes('diagnoseShellTakeover'), true, '诊断函数缺失')
    assert.equal(src.includes('console.info("[dsh-m] 侧栏工作区座位被外部接管'), true, '诊断话术缺失')
  })

  it('白名单随门控退役：COOPERATIVE_SHELL_LOCALES 在两个源文件中均不复存在', () => {
    assert.equal(takeover().includes('COOPERATIVE_SHELL_LOCALES'), false)
    assert.equal(main().includes('COOPERATIVE_SHELL_LOCALES'), false)
  })

  it('shell-takeover.js 保持 DOM-free 纯函数形态（无 document/window 引用）', () => {
    const src = takeover()
    assert.equal(src.includes('document'), false)
    assert.equal(src.includes('window'), false)
  })
})
