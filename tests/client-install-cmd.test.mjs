/**
 * 0.9.14 详情 Modal「安装命令」折叠行可见性纯函数。
 * 背景：折叠行命令两来源（按源推导 + 社区上游 install 原文）都是 `--profile web`
 * 语义，不看当前宿主 profile——desktop 上下文照抄会装进非当前 profile；
 * 已安装条目的命令也已无用途。
 * 运行：node --test tests/client-install-cmd.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldShowInstallCmd } from '../src/client/install-cmd.js'

describe('shouldShowInstallCmd —— 安装命令折叠行显隐（desktop/已安装隐藏）', () => {
  it('web / 旧宿主（kind 缺席）且未安装 → 显示（现状保持）', () => {
    assert.equal(shouldShowInstallCmd('web', false), true)
    assert.equal(shouldShowInstallCmd(null, false), true)
    assert.equal(shouldShowInstallCmd(undefined, false), true)
    assert.equal(shouldShowInstallCmd('unknown', false), true, 'unknown 不冒充 desktop，保守保持显示')
  })
  it('desktop 上下文 → 整行隐藏（--profile web 命令在 desktop 是误导）', () => {
    assert.equal(shouldShowInstallCmd('desktop', false), false)
    assert.equal(shouldShowInstallCmd('desktop', true), false)
  })
  it('已安装条目 → 整行隐藏（命令已无用途）', () => {
    assert.equal(shouldShowInstallCmd('web', true), false)
    assert.equal(shouldShowInstallCmd(null, true), false)
  })
})
