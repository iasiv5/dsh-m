/**
 * 环回 registry 源夹具（round-2 遗留外网清偿 A 类）：本地 HTTP 服务供给 registry.json，
 * 供 createRegistryController 的 defaultRoutes 测试缝指路——default 双线路从
 * raw.githubusercontent / cdn.jsdelivr 改指 127.0.0.1，测试零外网（probe2 环回透传同构，
 * source 串沿用生产 'default-raw'/'default-jsdelivr'，保持线路粘性与 cache 语义不变）。
 * 非 *.test.mjs 后缀：npm test 不自动发现，仅作 helper 导入。
 */
import { createServer } from 'node:http'

export function loopbackRegistryFixture() {
  return {
    version: 1,
    plugins: [
      {
        id: 'lb-a', name: 'Loopback A', description: 'loopback fixture entry',
        category: 'essentials', tags: ['fixture'], verified: [], source: 'npm',
        npm: 'lb-a', github: 'example/lb-a',
      },
      {
        id: 'lb-b', name: 'Loopback B', description: 'loopback fixture entry',
        category: 'essentials', tags: ['fixture'], verified: [], source: 'npm',
        npm: 'lb-b', github: 'example/lb-b',
      },
    ],
  }
}

export async function startLoopbackRegistry(registry = loopbackRegistryFixture()) {
  const body = JSON.stringify(registry)
  const server = createServer((req, res) => {
    if (req.url && req.url.endsWith('.json')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(body)
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/registry.json`
  const routes = [
    { source: 'default-raw', url },
    { source: 'default-jsdelivr', url },
  ]
  return { server, url, routes, close: () => new Promise((resolve) => server.close(resolve)) }
}
