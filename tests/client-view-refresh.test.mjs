/**
 * 跨视图刷新编排：安装/卸载/升级完成后，市场页与已装页必须一起读取。
 * 运行：node --test tests/client-view-refresh.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { refreshAfterMutation } from '../src/client/view-refresh.js'

describe('refreshAfterMutation', () => {
  it('同时刷新市场与已装视图，并让市场刷新保持当前筛选', async () => {
    const calls = []
    await refreshAfterMutation({
      marketReload: async (force) => calls.push(['market', force]),
      installedReload: async () => calls.push(['installed']),
    })
    assert.deepEqual(calls.sort((a, b) => a[0].localeCompare(b[0])), [
      ['installed'],
      ['market', false],
    ])
  })

  it('任一视图刷新失败会透传，调用方可显示刷新失败而不假装已同步', async () => {
    await assert.rejects(
      () => refreshAfterMutation({
        marketReload: async () => { throw new Error('market refresh failed') },
        installedReload: async () => {},
      }),
      /market refresh failed/,
    )
  })
})
