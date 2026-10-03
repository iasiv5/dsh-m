/**
 * 生效判定分类器（生效判定 T2 / 0.9.22）：规则矩阵 + fail-open 矩阵，全部经注入缝（零网络）。
 * 运行：npm run build && node --test tests/activation.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildTarGz } from './fixtures/tar-builder.mjs'

import { classifyUpgradeActivation, upgradeEffectLine } from '../lib/core/activation.js'

const pkgJson = (version, over = {}) => JSON.stringify({
  name: 'p',
  version,
  main: 'lib/index.js',
  exports: { '.': './lib/index.js', './client': './lib/client.js' },
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  ...over,
})

const baseFiles = (version, clientData = 'c1', hostData = 'h1') => ([
  { name: 'package/package.json', data: pkgJson(version) },
  { name: 'package/lib/index.js', data: hostData },
  { name: 'package/lib/client.js', data: clientData },
  { name: 'package/cordis.patch.yml', data: 'id: p\n' },
])

function memDeps(world) {
  const buffers = {}
  const fetchVersionMeta = async (_pkg, version) => {
    const url = `mem://${version}`
    const gz = world[version]
    if (!gz) throw new Error(`HTTP 404 ${version}`)
    buffers[url] = gz
    return { tarball: url }
  }
  const fetchTarball = async (url) => {
    const buf = buffers[url]
    if (!buf) throw new Error(`HTTP 404 ${url}`)
    return buf
  }
  return { fetchVersionMeta, fetchTarball }
}

const classify = (world, opts = {}) => classifyUpgradeActivation('p', '1.0.0', '2.0.0', opts, memDeps(world))

describe('分类规则矩阵', () => {
  it('规则 1/4：仅 client 目标文件变 → client-only', async () => {
    const world = { '1.0.0': buildTarGz(baseFiles('1.0.0', 'c1')), '2.0.0': buildTarGz(baseFiles('2.0.0', 'c2')) }
    assert.equal(await classify(world), 'client-only')
  })

  it('规则 3：package.json 仅顶层 version 差异（其余字节全同）→ client-only', async () => {
    const oldTar = buildTarGz(baseFiles('1.0.0'))
    const newTar = buildTarGz(baseFiles('2.0.0'))
    assert.equal(await classifyUpgradeActivation('p', '1.0.0', '2.0.0', {}, {
      fetchVersionMeta: async (_p, v) => ({ tarball: `mem://${v}` }),
      fetchTarball: async (url) => (url.endsWith('1.0.0') ? oldTar : newTar),
    }), 'client-only')
  })

  it('规则 4：宿主入口 lib/index.js 变 → restart-required', async () => {
    const world = { '1.0.0': buildTarGz(baseFiles('1.0.0')), '2.0.0': buildTarGz(baseFiles('2.0.0', 'c1', 'h2')) }
    assert.equal(await classify(world), 'restart-required')
  })

  it('规则 2：dsh.bundle.patch 声明的补丁文件变 → restart-required', async () => {
    const newFiles = [...baseFiles('2.0.0').slice(0, 3), { name: 'package/cordis.patch.yml', data: 'id: p2\n' }]
    const world = { '1.0.0': buildTarGz(baseFiles('1.0.0')), '2.0.0': buildTarGz(newFiles) }
    assert.equal(await classify(world), 'restart-required')
  })

  it('规则 3：package.json dependencies 变化 → restart-required', async () => {
    const world = {
      '1.0.0': buildTarGz(baseFiles('1.0.0')),
      '2.0.0': buildTarGz([...baseFiles('2.0.0').slice(0, 1), { name: 'package/package.json', data: pkgJson('2.0.0', { dependencies: { lodash: '^4' } }) }, ...baseFiles('2.0.0').slice(1)]),
    }
    assert.equal(await classify(world), 'restart-required')
  })

  it('规则 5：exports ./client 指向变化 → restart-required（两文件内容全同）', async () => {
    const oldFiles = [...baseFiles('1.0.0'), { name: 'package/lib/client.bundle.js', data: 'c1' }]
    const newFiles = [
      { name: 'package/package.json', data: pkgJson('2.0.0', { exports: { '.': './lib/index.js', './client': './lib/client.bundle.js' } }) },
      { name: 'package/lib/index.js', data: 'h1' },
      { name: 'package/lib/client.js', data: 'c1' },
      { name: 'package/cordis.patch.yml', data: 'id: p\n' },
      { name: 'package/lib/client.bundle.js', data: 'c1' },
    ]
    const world = { '1.0.0': buildTarGz(oldFiles), '2.0.0': buildTarGz(newFiles) }
    assert.equal(await classify(world), 'restart-required')
  })

  it('规则 4：新增非 client 文件（README）→ restart-required', async () => {
    const world = {
      '1.0.0': buildTarGz(baseFiles('1.0.0')),
      '2.0.0': buildTarGz([...baseFiles('2.0.0'), { name: 'package/README.md', data: '# new' }]),
    }
    assert.equal(await classify(world), 'restart-required')
  })

  it('规则 4：删除非 client 文件 → restart-required', async () => {
    const world = {
      '1.0.0': buildTarGz([...baseFiles('1.0.0'), { name: 'package/NOTICE', data: 'old' }]),
      '2.0.0': buildTarGz(baseFiles('2.0.0')),
    }
    assert.equal(await classify(world), 'restart-required')
  })

  it('零差异（含 version 同串）→ client-only', async () => {
    const tar = buildTarGz(baseFiles('1.0.0'))
    assert.equal(await classify({ '1.0.0': tar, '2.0.0': tar }), 'client-only')
  })
})

describe('fail-open 矩阵：任何异常 → unknown', () => {
  it('元数据缺 tarball → unknown', async () => {
    const res = await classifyUpgradeActivation('p', '1.0.0', '2.0.0', {}, {
      fetchVersionMeta: async () => ({}),
      fetchTarball: async () => Buffer.alloc(0),
    })
    assert.equal(res, 'unknown')
  })

  it('下载抛错（模拟 404/超限）→ unknown', async () => {
    const world = { '1.0.0': buildTarGz(baseFiles('1.0.0')), '2.0.0': buildTarGz(baseFiles('2.0.0')) }
    const deps = memDeps(world)
    deps.fetchTarball = async (url) => { throw new Error(`HTTP 500 ${url}`) }
    assert.equal(await classifyUpgradeActivation('p', '1.0.0', '2.0.0', {}, deps), 'unknown')
  })

  it('tar 字节损坏 → unknown', async () => {
    const deps = {
      fetchVersionMeta: async (_p, v) => ({ tarball: `mem://${v}` }),
      fetchTarball: async () => Buffer.from('this is not a tar payload at all'),
    }
    assert.equal(await classifyUpgradeActivation('p', '1.0.0', '2.0.0', {}, deps), 'unknown')
  })

  it('package.json 非法 JSON → unknown', async () => {
    const bad = [{ name: 'package/package.json', data: '{not json' }]
    const world = { '1.0.0': buildTarGz(bad), '2.0.0': buildTarGz(baseFiles('2.0.0')) }
    assert.equal(await classify(world), 'unknown')
  })

  it('超时（挂起到 deadline 中止）→ unknown', async () => {
    const world = { '1.0.0': buildTarGz(baseFiles('1.0.0')), '2.0.0': buildTarGz(baseFiles('2.0.0')) }
    const deps = memDeps(world)
    deps.fetchTarball = (_url, _max, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    const started = Date.now()
    assert.equal(await classifyUpgradeActivation('p', '1.0.0', '2.0.0', { timeoutMs: 80 }, deps), 'unknown')
    assert.ok(Date.now() - started < 2000, 'deadline 应按 timeoutMs 生效')
  })

  it('maxBytes 接线：默认 8MiB、可覆写（传导到 fetchTarball）', async () => {
    const world = { '1.0.0': buildTarGz(baseFiles('1.0.0')), '2.0.0': buildTarGz(baseFiles('2.0.0')) }
    const seen = []
    const deps = {
      fetchVersionMeta: async (_p, v) => ({ tarball: `mem://${v}` }),
      fetchTarball: async (url, maxBytes) => {
        seen.push(maxBytes)
        return url.endsWith('1.0.0') ? world['1.0.0'] : world['2.0.0']
      },
    }
    await classifyUpgradeActivation('p', '1.0.0', '2.0.0', {}, deps)
    assert.deepEqual(seen, [8 * 1024 * 1024, 8 * 1024 * 1024])
    seen.length = 0
    await classifyUpgradeActivation('p', '1.0.0', '2.0.0', { maxTarballBytes: 1024 }, deps)
    assert.deepEqual(seen, [1024, 1024])
  })
})

describe('upgradeEffectLine：CLI 行文案', () => {
  it('client-only → 刷新即生效，无 dshm restart 字样', () => {
    const line = upgradeEffectLine('client-only')
    assert.match(line, /刷新页面即生效/)
    assert.doesNotMatch(line, /dshm restart/)
  })

  it('unknown → 建议重启，带 dshm restart 命令', () => {
    assert.match(upgradeEffectLine('unknown'), /生效判定未完成/)
    assert.match(upgradeEffectLine('unknown'), /dshm restart --yes/)
  })

  it('restart-required 与 undefined → 现状文案', () => {
    assert.equal(upgradeEffectLine('restart-required'), '需要重启 DSH Web 生效：dshm restart --yes')
    assert.equal(upgradeEffectLine(undefined), '需要重启 DSH Web 生效：dshm restart --yes')
  })
})
