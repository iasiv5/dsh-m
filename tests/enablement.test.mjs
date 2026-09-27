/**
 * enablement 契约（plan Task 4）：
 * - 有 loader：enabled = !entry.disabled（顶层有效态）、phase = fiber.state 数字枚举投影
 *   （0/1/2/3/5 有词汇，4 disposed→null，fiber 缺失→null，未知→null）；
 * - 多行插件（modsearch 双行）→ granularity:'bundle'；单 insert 行 → 'row'；
 * - 保护名单：'dsh-m' → lockReason:'self'；官方 16 项 → 'protected'；均 toggleable:false；
 * - no-entry：loader 无 entry 且不在 bundles → toggleable:false（未装载不是被关）；
 * - CLI 无 loader：phase null、enabled 从「在 bundles 且行无 disabled 覆盖」推断；
 * - patchRows 不可读（含文件缺失）→ 判 bundle。
 * 运行：npm run build && node --test tests/enablement.test.mjs tests/installed.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { composeEnablement, PROTECTED_MODULES } from '../lib/core/enablement.js'

/** 脱敏 fixture：单行插件条目（patchRows 由调用方注入，避免文件依赖）。 */
function item(pkg, patchRows) {
  return {
    pkg,
    name: pkg,
    version: '1.0.0',
    description: '',
    homepage: '',
    spec: `${pkg}@1.0.0`,
    source: 'npm',
    dsh: true,
    path: `/tmp/x/${pkg}`,
    githubRepo: null,
    patchRows,
  }
}

const SINGLE = { inserts: [{ id: 'demo', name: 'demo-pkg' }], configRows: 0, readable: true }
const MULTI = {
  inserts: [{ id: 'web-seam', name: 'multi-pkg' }],
  configRows: 1,
  readable: true,
}
const UNREADABLE = { inserts: [], configRows: 0, readable: false }

function entry(name, { disabled = false, state } = {}) {
  return {
    id: name,
    options: { name },
    disabled,
    fiber: state === undefined ? undefined : { state },
  }
}

describe('composeEnablement：有 loader 形态', () => {
  it('active 态：enabled、phase 投影正确', () => {
    const rows = composeEnablement({
      items: [item('demo-pkg', SINGLE)],
      loaderEntries: [entry('demo-pkg', { state: 2 })],
      bundles: ['demo-pkg'],
      profileOverrides: [],
    })
    assert.deepEqual(rows.get('demo-pkg'), {
      pkg: 'demo-pkg',
      enabled: true,
      phase: 'active',
      granularity: 'row',
      toggleable: true,
    })
  })

  it('failed 态：enabled 但 phase failed（徽标红点场景）', () => {
    const rows = composeEnablement({
      items: [item('demo-pkg', SINGLE)],
      loaderEntries: [entry('demo-pkg', { state: 3 })],
      bundles: ['demo-pkg'],
      profileOverrides: [],
    })
    assert.equal(rows.get('demo-pkg').phase, 'failed')
    assert.equal(rows.get('demo-pkg').enabled, true)
  })

  it('disabled 态：entry.disabled=true → enabled:false、fiber 缺失 → phase:null', () => {
    const rows = composeEnablement({
      items: [item('demo-pkg', SINGLE)],
      loaderEntries: [entry('demo-pkg', { disabled: true })],
      bundles: ['demo-pkg'],
      profileOverrides: [],
    })
    assert.equal(rows.get('demo-pkg').enabled, false)
    assert.equal(rows.get('demo-pkg').phase, null)
    assert.equal(rows.get('demo-pkg').toggleable, true)
  })

  it('全部相位枚举值映射（0-5 + 未知）', () => {
    const cases = [
      [0, 'pending'],
      [1, 'loading'],
      [2, 'active'],
      [3, 'failed'],
      [4, null], // disposed → null
      [5, 'unloading'],
      [99, null], // 未知 → null
    ]
    for (const [state, expected] of cases) {
      const rows = composeEnablement({
        items: [item('demo-pkg', SINGLE)],
        loaderEntries: [entry('demo-pkg', { state })],
        bundles: ['demo-pkg'],
        profileOverrides: [],
      })
      assert.equal(rows.get('demo-pkg').phase, expected, `state ${state}`)
    }
  })

  it('多行插件 → bundle 粒度；不可读 patchRows → bundle', () => {
    const rows = composeEnablement({
      items: [item('multi-pkg', MULTI), item('opaque-pkg', UNREADABLE)],
      loaderEntries: [entry('multi-pkg', { state: 2 }), entry('opaque-pkg', { state: 2 })],
      bundles: ['multi-pkg', 'opaque-pkg'],
      profileOverrides: [],
    })
    assert.equal(rows.get('multi-pkg').granularity, 'bundle')
    assert.equal(rows.get('opaque-pkg').granularity, 'bundle')
  })
})

describe('composeEnablement：保护与 no-entry', () => {
  it('dsh-m 自身 → lockReason self、不可开关', () => {
    const rows = composeEnablement({
      items: [item('dsh-m', SINGLE)],
      loaderEntries: [entry('dsh-m', { state: 2 })],
      bundles: ['dsh-m'],
      profileOverrides: [],
    })
    assert.deepEqual(rows.get('dsh-m').lockReason, 'self')
    assert.equal(rows.get('dsh-m').toggleable, false)
  })

  it('官方命脉包（hmr/loader/…）→ protected', () => {
    const rows = composeEnablement({
      items: [item('@deepseek-ai/dsh-hmr', SINGLE)],
      loaderEntries: [entry('@deepseek-ai/dsh-hmr', { state: 2 })],
      bundles: ['@deepseek-ai/dsh-hmr'],
      profileOverrides: [],
    })
    assert.equal(rows.get('@deepseek-ai/dsh-hmr').lockReason, 'protected')
  })

  it('PROTECTED_MODULES 覆盖官方 16 项全集 + dsh-m', () => {
    assert.equal(PROTECTED_MODULES.length, 17)
    assert.equal(PROTECTED_MODULES.includes('dsh-m'), true)
    const official = [
      '@deepseek-ai/dsh-plugin-manager',
      '@deepseek-ai/cordis-plugin-loader',
      '@deepseek-ai/cordis-plugin-include',
      '@deepseek-ai/dsh-api-gateway',
      '@deepseek-ai/dsh-host-webserver',
      '@deepseek-ai/dsh-client-modules',
      '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
      '@deepseek-ai/dsh-client-ui-plugin-manager',
      '@deepseek-ai/dsh-host-plugin-inventory',
      '@deepseek-ai/dsh-typert-registry',
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/cordis-plugin-timer',
      '@deepseek-ai/dsh-client-connection',
      '@deepseek-ai/dsh-host-frontend-static',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/dsh-hmr',
    ]
    for (const name of official) assert.equal(PROTECTED_MODULES.includes(name), true, name)
  })

  it('loader 无 entry 且不在 bundles + 有补丁层 → Bundle 退选态，可再开', () => {
    const rows = composeEnablement({
      items: [item('ghost-pkg', SINGLE)],
      loaderEntries: [],
      bundles: [],
      profileOverrides: [],
    })
    assert.equal(rows.get('ghost-pkg').lockReason, undefined)
    assert.equal(rows.get('ghost-pkg').toggleable, true)
    assert.equal(rows.get('ghost-pkg').enabled, false)
  })

  it('loader 无 entry 且不在 bundles + 无补丁层 → no-entry（真纯依赖）', () => {
    const rows = composeEnablement({
      items: [item('lib-pkg', UNREADABLE)],
      loaderEntries: [],
      bundles: [],
      profileOverrides: [],
    })
    assert.deepEqual(rows.get('lib-pkg').lockReason, 'no-entry')
    assert.equal(rows.get('lib-pkg').toggleable, false)
  })

  it('loader 无 entry 但在 bundles → 可开关（enabled:false、无 no-entry）', () => {
    const rows = composeEnablement({
      items: [item('selected-pkg', SINGLE)],
      loaderEntries: [],
      bundles: ['selected-pkg'],
      profileOverrides: [],
    })
    assert.equal(rows.get('selected-pkg').lockReason, undefined)
    assert.equal(rows.get('selected-pkg').toggleable, true)
    assert.equal(rows.get('selected-pkg').enabled, false)
  })
})

describe('composeEnablement：CLI 无 loader 形态', () => {
  it('在 bundles 且无覆盖 → enabled:true、phase:null', () => {
    const rows = composeEnablement({
      items: [item('demo-pkg', SINGLE)],
      loaderEntries: null,
      bundles: ['demo-pkg'],
      profileOverrides: [],
    })
    assert.equal(rows.get('demo-pkg').enabled, true)
    assert.equal(rows.get('demo-pkg').phase, null)
  })

  it('profile 覆盖行翻转 enabled（行 id 匹配 insert 声明）', () => {
    const rows = composeEnablement({
      items: [item('demo-pkg', SINGLE)],
      loaderEntries: null,
      bundles: ['demo-pkg'],
      profileOverrides: [{ id: 'demo', disabled: true }],
    })
    assert.equal(rows.get('demo-pkg').enabled, false)
  })

  it('覆盖行 id 与补丁行不符 → 不影响 enabled', () => {
    const rows = composeEnablement({
      items: [item('demo-pkg', SINGLE)],
      loaderEntries: null,
      bundles: ['demo-pkg'],
      profileOverrides: [{ id: 'other-row', disabled: true }],
    })
    assert.equal(rows.get('demo-pkg').enabled, true)
  })

  it('不在 bundles 且无补丁 insert 行（no-patch-layer 纯依赖形态）→ no-entry', () => {
    const rows = composeEnablement({
      items: [item('lib-only-pkg', UNREADABLE)],
      loaderEntries: null,
      bundles: [],
      profileOverrides: [],
    })
    assert.deepEqual(rows.get('lib-only-pkg').lockReason, 'no-entry')
    assert.equal(rows.get('lib-only-pkg').enabled, false)
  })
})
