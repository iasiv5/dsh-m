#!/usr/bin/env node
/**
 * 客户端自由变量守卫（0.10.9 战役 retro C1）。
 *
 * 病灶：T10/T11 脚本化搬移产出 4 颗模块级自由变量（ZONE_TABS/PHASE_LABEL/OP_STATUS_CLS/
 * dsvmModalDepth），npm test + SSR 冒烟 + CI **全绿放行**（SSR 只跑首渲染、测试 DOM-free），
 * 唯一手动渲染探针的浏览器路径抓获。本守卫把该缺陷类机械化：src/client 每个 .js/.jsx 的
 * 被引用标识符必须落在 文件内声明（任意作用域，含参数/解构/catch）/ import / require 解构 /
 * 全局白名单 四者之一，否则 exit 1。
 *
 * 实现：TypeScript AST（issue #20 起 `typescript` devDep 升 7.x——TS 7 是 Go 原生重写，
 * 官方不再随包发布进程内 JS API，`ts.createSourceFile/ScriptTarget` 均不存在；故 AST 解析
 * 固定走 `typescript6` 别名（npm:typescript@^6，TS 6 桥线，同款旧 API），`tsc` CLI 仍走
 * typescript@7 原生二进制。
 * 桥生命周期（PR #21 评审 F-5/F-6）：别名只许在 ^6 范围内演进（6.x 是最后的进程内 JS API
 * 线，禁人肉或越范围升 7.x——那里没有 JS API，本守卫会响亮崩红挡下，不会静默劣化）；
 * TS 7 的 `typescript/unstable/ast` 已有 AST 表示与 is* 守卫但尚无解析器入口，待其稳定出
 * createSourceFile 后本桥可退役。按 Identifier
 * 节点的父节点类型剔除「名字位」（声明位/属性位/成员位），其余计为引用——字符串、模板串、
 * 注释、对象键（非简写）天然不进引用面。
 *
 * 用法：npm test 链首自动运行（package.json "test"），也可单跑 `node scripts/check-client-imports.mjs`。
 */
import ts from 'typescript6'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'src/client')
const files = readdirSync(dir).filter((f) => f.endsWith('.js') || f.endsWith('.jsx'))

// 浏览器/Node 全局白名单：代码里裸引用且不可能由本目录声明的名字。
const GLOBALS = new Set([
  // 浏览器
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'console', 'fetch', 'AbortController', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'getComputedStyle',
  'matchMedia', 'ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'CustomEvent', 'Event',
  'alert', 'btoa', 'atob', 'crypto', 'screen',
  // JS 内建
  'Math', 'JSON', 'Object', 'Array', 'Date', 'Number', 'String', 'Boolean', 'Promise', 'Set', 'Map',
  'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'undefined', 'NaN', 'Infinity', 'globalThis', 'Reflect', 'Proxy',
  'structuredClone', 'URL', 'URLSearchParams', 'FormData', 'Blob', 'File', 'Text', 'Node', 'Element', 'HTMLElement', 'Image', 'HTMLInputElement', 'HTMLTextAreaElement',
  // Node（main.jsx 为 CJS；hooks.js 在 node:test 里直跑）
  'require', 'module', 'exports', 'process', 'Buffer', '__dirname', '__filename',
])

// 名字位的父节点类型：这些 Identifier 是「声明/属性/成员」，不是引用。
const NAME_POSITION = new Set([
  'VariableDeclaration', 'FunctionDeclaration', 'ClassDeclaration', 'ClassExpression',
  'MethodDeclaration', 'MethodSignature', 'GetAccessor', 'SetAccessor', 'FunctionExpression',
  'ArrowFunction', 'InterfaceDeclaration', 'TypeAliasDeclaration', 'PropertySignature',
  'ImportSpecifier', 'ImportClause', 'NamespaceImport', 'ExportSpecifier', 'BindingElement',
  'CatchClause', 'EnumMember', 'ModuleDeclaration', 'NamedImports', 'NamedExports',
])

const collectDeclared = (sf, declared) => {
  const walkBinding = (n) => {
    if (ts.isIdentifier(n)) declared.add(n.text)
    else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) n.elements.forEach((el) => ts.isBindingElement(el) && (ts.isBindingElement(el) && walkBinding(el.name)))
  }
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) {
      walkBinding(node.name)
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionExpression(node)) && node.name && ts.isIdentifier(node.name)) {
      declared.add(node.name.text)
    } else if ((ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && node.name && ts.isIdentifier(node.name)) {
      // 对象字面量方法/存取器名 = 文件内声明（宽口径：方法仅经 this. 触达时裸引用误报不追）
      declared.add(node.name.text)
    } else if (ts.isParameter(node)) {
      // 参数解构（function Card({ icon, name }) / ({ h = 96 })）与标识符参数同为声明
      walkBinding(node.name)
    } else if (ts.isImportDeclaration(node)) {
      if (node.importClause?.name) declared.add(node.importClause.name.text)
      if (node.importClause?.namedBindings) {
        const nb = node.importClause.namedBindings
        if (ts.isNamedImports(nb)) nb.elements.forEach((el) => declared.add(el.name.text))
        else if (ts.isNamespaceImport(nb)) declared.add(nb.name.text)
      }
    } else if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
      declared.add(node.variableDeclaration.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

const collectReferenced = (sf, referenced) => {
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const p = node.parent
      const inNamePosition =
        (NAME_POSITION.has(p.kind) && p.name === node) ||
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        (ts.isPropertyAssignment(p) && p.name === node) ||
        (ts.isQualifiedName(p) && p.right === node)
      // 简写属性 { x } 的键位同时是引用——不计入名字位
      const shorthand = ts.isShorthandPropertyAssignment(p) && p.name === node
      if (!inNamePosition || shorthand) referenced.add(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

const offenders = []
for (const f of files) {
  const text = readFileSync(join(dir, f), 'utf8')
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, f.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS)
  const declared = new Set()
  const referenced = new Set()
  collectDeclared(sf, declared)
  collectReferenced(sf, referenced)
  const free = [...referenced].filter((n) => !declared.has(n) && !GLOBALS.has(n)).sort()
  if (free.length) offenders.push(`${f}: ${free.join(', ')}`)
}

if (offenders.length) {
  console.error(`✗ 客户端自由变量守卫：${offenders.length} 个文件存在未解析引用（模块级雷，SSR/测试不可见）：`)
  offenders.forEach((o) => console.error('  ' + o))
  process.exit(1)
}
console.log(`✓ 客户端自由变量守卫：${files.length} 个文件零未解析引用`)
