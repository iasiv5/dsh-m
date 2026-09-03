// dsh-m build: tsc (host/core) + esbuild (client, wrapped in __ModuleLoader__.load)
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url)) + '/..'
const lib = join(root, 'lib')

function step(name) {
  console.log(`[dsh-m] build: ${name}`)
}

// 0) clean
rmSync(lib, { recursive: true, force: true })
mkdirSync(lib, { recursive: true })

// 1) host + core + cli: tsc
step('tsc (host/core/cli)')
execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
})

// bin 产物确保 shebang（tsc 会保留源码 shebang，此处兜底）
const cliPath = join(lib, 'cli.js')
let cliSrc = readFileSync(cliPath, 'utf8')
if (!cliSrc.startsWith('#!')) {
  writeFileSync(cliPath, '#!/usr/bin/env node\n' + cliSrc)
}

// 2) client: esbuild → CJS bundle with react/react-dom external (resolved via
//    the module-loader's `require` inside the factory), wrapped like skillhub.
step('esbuild (client)')
await build({
  entryPoints: [join(root, 'src/client/main.jsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'transform',
  jsxFactory: 'h',
  external: ['react', 'react-dom'],
  legalComments: 'none',
  minify: false,
  // 入口无 export，返回值由 footer 的 `return { inject, apply }` 提供；
  // esbuild 看不到 footer，会把顶层声明当未使用摇掉，必须关掉 tree-shaking。
  treeShaking: false,
  outfile: join(lib, 'client.js'),
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      '  id: "dsh-m",',
      '  factory: (require) => {',
    ].join('\n'),
  },
  footer: {
    js: ['    return { inject, apply };', '  },', '});', ''].join('\n'),
  },
})

// 3) sanity checks
step('verify')
for (const f of ['host.js', 'client.js']) {
  const p = join(lib, f)
  statSync(p)
}
const client = readFileSync(join(lib, 'client.js'), 'utf8')
if (!client.startsWith('window.__ModuleLoader__.load({')) {
  throw new Error('client.js is not wrapped in __ModuleLoader__.load')
}
if (!/return \{ inject, apply \};\s*\}\s*,\s*\}\);?\s*$/.test(client)) {
  throw new Error('client.js factory does not return { inject, apply }')
}
for (const marker of ['dshm-overlay', 'MarketPanel', 'InstalledTab', 'SettingsTab', 'RestartBanner']) {
  if (!client.includes(marker)) throw new Error(`client.js 缺少组件标记: ${marker}（tree-shaking 可能未关闭）`)
}
writeFileSync(join(lib, '.keep'), '')
console.log('[dsh-m] build ok: lib/host.js + lib/client.js')
