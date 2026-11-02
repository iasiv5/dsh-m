/**
 * 自定义 profile 写支持（issue #39 / ADR-0030）Task 1：env 层安全名判定与目录解析。
 * 运行：npm run build && node --test tests/env-profile-name.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { isDshProfileName, dshProfileDirByName, desktopProfileDir, dshHome } from '../lib/core/env.js'

describe('isDshProfileName：profile 名路径段安全性（同业对齐 dsh-market isDshProfileName）', () => {
  const unsafe = ['', '.', '..', 'node_modules', 'a/b', 'a\\b', 'a\0b', './x', '../evil', 'x/../y']
  for (const name of unsafe) {
    it(`不安全名拒判：${JSON.stringify(name)} → false`, () => {
      assert.equal(isDshProfileName(name), false)
    })
  }

  const safe = ['aqua', 'web', 'desktop', 'tauri', 'dev-1', '工作区', 'a.b', 'profile_2']
  for (const name of safe) {
    it(`安全名放行：${JSON.stringify(name)} → true`, () => {
      assert.equal(isDshProfileName(name), true)
    })
  }

  it('非字符串输入 → false（不抛）', () => {
    assert.equal(isDshProfileName(undefined), false)
    assert.equal(isDshProfileName(null), false)
    assert.equal(isDshProfileName(42), false)
  })
})

describe('dshProfileDirByName：desktop 名走专用目录，其余安全名走 profiles/<name>', () => {
  it("dshProfileDirByName('desktop') === desktopProfileDir()", () => {
    assert.equal(dshProfileDirByName('desktop'), desktopProfileDir())
  })
  it("dshProfileDirByName('aqua') === join(dshHome(),'profiles','aqua')", () => {
    assert.equal(dshProfileDirByName('aqua'), join(dshHome(), 'profiles', 'aqua'))
  })
  it('tauri 名同 web 形态目录推导（不特判）', () => {
    assert.equal(dshProfileDirByName('tauri'), join(dshHome(), 'profiles', 'tauri'))
  })
})
