/**
 * markdown 渲染 pure 逻辑：safeUrl 安全闸门 + 行内/块级结构。
 * 注入假 h 断言纯结构，不依赖 DOM/React。
 * 运行：node --test tests/client-markdown.test.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { safeUrl, createMarkdown } from '../src/client/markdown.js'

// 假 h：模仿 React.createElement 语义——展平数组 children、解析函数组件
// （现行实现大量使用 h("p", {key}, mdInline(...)) 数组传参与 h(ExtLink, ...) 组件传参）
const h = (type, props, ...children) => {
  const kids = children.flat(Infinity);
  return typeof type === "function"
    ? type({ ...(props || {}), children: kids })
    : { type, props, children: kids };
};

describe('safeUrl', () => {
  it('放行 http/https/mailto/相对与锚点，trim 首尾空白', () => {
    assert.equal(safeUrl('https://a.com'), 'https://a.com')
    assert.equal(safeUrl('HTTP://A.COM'), 'HTTP://A.COM')
    assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c')
    assert.equal(safeUrl('/rel/path'), '/rel/path')
    assert.equal(safeUrl('#frag'), '#frag')
    assert.equal(safeUrl('  https://a.com  '), 'https://a.com')
  })
  it('其余协议与空值一律归 #（安全闸门现行为）', () => {
    assert.equal(safeUrl('javascript:alert(1)'), '#')
    assert.equal(safeUrl('JavaScript:x'), '#')
    assert.equal(safeUrl('data:text/html,<b>x</b>'), '#')
    assert.equal(safeUrl('vbscript:x'), '#')
    assert.equal(safeUrl(''), '#')
    assert.equal(safeUrl(null), '#')
    assert.equal(safeUrl(undefined), '#')
  })
})

describe('createMarkdown(h) 渲染结构', () => {
  const md = createMarkdown(h)

  it('ExtLink 走 safeUrl 且固定 target/rel', () => {
    const n = md.ExtLink({ href: 'https://a.com', className: 'c', children: ['x'] })
    assert.equal(n.type, 'a')
    assert.equal(n.props.href, 'https://a.com')
    assert.equal(n.props.target, '_blank')
    assert.equal(n.props.rel, 'noopener noreferrer')
    assert.equal(typeof n.props.onClick, 'function')
    const bad = md.ExtLink({ href: 'javascript:x', children: ['y'] })
    assert.equal(bad.props.href, '#')
  })

  it('MdImg 固定 no-referrer 且 alt 缺省空串', () => {
    const n = md.MdImg({ src: 'https://i.a/b.png' })
    assert.equal(n.type, 'img')
    assert.equal(n.props.src, 'https://i.a/b.png')
    assert.equal(n.props.alt, '')
    assert.equal(n.props.referrerPolicy, 'no-referrer')
  })

  it('行内：code/粗体/斜体/删除线', () => {
    const [p] = md.renderMarkdown('a `c` **b** *i* ~~d~~')
    assert.equal(p.type, 'p')
    assert.equal(p.children.length, 8)
    assert.equal(p.children[0], 'a ')
    assert.equal(p.children[1].type, 'code')
    assert.deepEqual(p.children[1].children, ['c'])
    assert.equal(p.children[3].type, 'strong')
    assert.equal(p.children[5].type, 'em')
    assert.equal(p.children[7].type, 'del')
  })

  it('链接/图片/徽章链接/自动链接/裸 URL', () => {
    const link = md.renderMarkdown('[t](https://a.com)')
    assert.equal(link[0].children[0].type, 'a')
    assert.equal(link[0].children[0].props.href, 'https://a.com')
    assert.deepEqual(link[0].children[0].children, ['t'])

    const img = md.renderMarkdown('![alt](https://i.a/b.png)')
    assert.equal(img[0].children[0].type, 'img')
    assert.equal(img[0].children[0].props.alt, 'alt')

    const badge = md.renderMarkdown('[![a](https://i.a/b.png)](https://x.y)')
    assert.equal(badge[0].children[0].type, 'a')
    assert.equal(badge[0].children[0].props.href, 'https://x.y')
    assert.equal(badge[0].children[0].children[0].type, 'img')

    const auto = md.renderMarkdown('<https://a.com>')
    assert.equal(auto[0].children[0].type, 'a')
    assert.equal(auto[0].children[0].props.href, 'https://a.com')

    const bare = md.renderMarkdown('see https://a.com/x end')
    assert.equal(bare[0].children[0], 'see ')
    assert.equal(bare[0].children[1].type, 'a')
    assert.equal(bare[0].children[1].props.href, 'https://a.com/x')
    assert.deepEqual(bare[0].children[2], ' end')
  })

  it('块级：围栏代码/标题/分隔线/引用/列表/表格/段落合并', () => {
    const fence = md.renderMarkdown('```\ncode\n```')
    assert.equal(fence[0].type, 'pre')
    assert.equal(fence[0].children[0].type, 'code')
    assert.deepEqual(fence[0].children[0].children, ['code'])

    const open = md.renderMarkdown('```\ncode')
    assert.deepEqual(open[0].children[0].children, ['code'])

    const head = md.renderMarkdown('## T')
    assert.equal(head[0].type, 'h2')
    assert.deepEqual(head[0].children, ['T'])

    assert.equal(md.renderMarkdown('---')[0].type, 'hr')

    const quote = md.renderMarkdown('> q1\n> q2')
    assert.equal(quote[0].type, 'blockquote')
    assert.equal(quote[0].children[0].type, 'p')
    assert.deepEqual(quote[0].children[0].children, ['q1 q2'])

    const ul = md.renderMarkdown('- a\n- b')
    assert.equal(ul[0].type, 'ul')
    assert.equal(ul[0].children.length, 2)
    assert.equal(ul[0].children[0].type, 'li')

    const ol = md.renderMarkdown('1. x\n2. y')
    assert.equal(ol[0].type, 'ol')
    assert.equal(ol[0].children.length, 2)

    const table = md.renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
    assert.equal(table[0].type, 'table')
    assert.equal(table[0].children[0].type, 'thead')
    assert.equal(table[0].children[0].children[0].children[0].children[0], 'a')
    assert.equal(table[0].children[1].type, 'tbody')
    assert.equal(table[0].children[1].children[0].children[1].children[0], '2')

    const para = md.renderMarkdown('x\ny')
    assert.deepEqual(para[0].children, ['x y'])
  })

  it('空输入与 CRLF 归一', () => {
    assert.deepEqual(md.renderMarkdown(''), [])
    const crlf = md.renderMarkdown('a\r\nb')
    assert.deepEqual(crlf[0].children, ['a b'])
  })
})

describe('0.9.47 内嵌 HTML 子集', () => {
  const md = createMarkdown(h)

  it('块级包裹：<p align> 剥壳递归，<img> 走白名单尺寸样式', () => {
    const nodes = md.renderMarkdown('<p align="center">\n  <img src="https://i.a/logo.svg" alt="logo" width="560">\n</p>')
    assert.equal(nodes.length, 1)
    const p = nodes[0]
    assert.equal(p.type, 'p')
    assert.deepEqual(p.props.style, { textAlign: 'center' })
    const img = p.children[0]
    assert.equal(img.type, 'img')
    assert.equal(img.props.src, 'https://i.a/logo.svg')
    assert.equal(img.props.alt, 'logo')
    assert.deepEqual(img.props.style, { width: 560, maxWidth: '100%', height: 'auto', maxHeight: 'none' })
  })

  it('徽章行：<a><img></a> 连排且间隙保留；无 width 的徽章不吃样式帽', () => {
    const nodes = md.renderMarkdown('<p align="center">\n<a href="https://x"><img alt="npm" src="https://i.a/n.svg"></a> <a href="https://y"><img alt="ci" src="https://i.a/c.svg"></a>\n</p>')
    const a1 = nodes[0].children[0]
    assert.equal(a1.type, 'a')
    assert.equal(a1.props.href, 'https://x')
    assert.equal(a1.children[0].type, 'img')
    assert.equal(a1.children[0].props.style, undefined)
    assert.equal(nodes[0].children[1], ' ')
    const a2 = nodes[0].children[2]
    assert.equal(a2.type, 'a')
    assert.equal(a2.props.href, 'https://y')
    assert.equal(a2.children[0].type, 'img')
  })

  it('行内混排：<strong>/<a>/<br> 与文本', () => {
    const nodes = md.renderMarkdown('<p align="center">\n  <strong>English</strong> | <a href="README_ZH.md">简体中文</a>\n</p>')
    const kids = nodes[0].children
    assert.equal(kids[0].type, 'strong')
    assert.deepEqual(kids[0].children, ['English'])
    assert.equal(kids[1], ' | ')
    assert.equal(kids[2].type, 'a')
    assert.equal(kids[2].props.href, '#') // 相对路径走 safeUrl 归 #
    assert.deepEqual(kids[2].children, ['简体中文'])
    const br = md.renderMarkdown('<p>a<br>b</p>')
    assert.equal(br[0].children[0].children.filter((x) => x && x.type === 'br').length, 1)
  })

  it('安全：script 连同内容丢弃，javascript: 链接归 #，文本节点不注入', () => {
    const nodes = md.renderMarkdown('<p>x</p>\n<script>alert(1)</script>\n<a href="javascript:alert(1)">bad</a>')
    const json = JSON.stringify(nodes)
    assert.ok(!json.includes('alert'), `不应出现脚本内容: ${json}`)
    assert.ok(json.includes('bad')) // 剥壳留文本，React 转义兜底
    const style = md.renderMarkdown('<style>p{color:red}</style>\n# T')
    assert.equal(style.length, 1)
    assert.equal(style[0].type, 'h1')
  })

  it('未知标签剥壳留内容，结构标签补分隔', () => {
    const nodes = md.renderMarkdown('<p align="center">\n<foo>bar</foo> tail\n</p>')
    const json = JSON.stringify(nodes)
    assert.ok(json.includes('bar'))
    assert.ok(!json.includes('foo'))
  })

  it('details/summary：摘要行内渲染 + 内部 markdown 保结构', () => {
    const nodes = md.renderMarkdown('<details>\n<summary>FAQ</summary>\n\n- a\n- b\n\n</details>')
    assert.equal(nodes[0].type, 'details')
    const sum = nodes[0].children[0]
    assert.equal(sum.type, 'summary')
    assert.deepEqual(sum.children, ['FAQ'])
    const ul = nodes[0].children[1]
    assert.equal(ul.type, 'ul')
    assert.equal(ul.children.length, 2)
  })

  it('整篇 div 包裹（GitHub 常见）：markdown 结构全保留，收尾内容不受吞块影响', () => {
    const nodes = md.renderMarkdown('<div align="center">\n\n## Features\n\ntext here\n\n</div>\n\nafter')
    const div = nodes[0]
    assert.equal(div.type, 'div')
    assert.deepEqual(div.props.style, { textAlign: 'center' })
    assert.equal(div.children[0].type, 'h2')
    assert.deepEqual(div.children[0].children, ['Features'])
    assert.equal(div.children[1].type, 'p')
    assert.equal(nodes[1].type, 'p')
    assert.deepEqual(nodes[1].children, ['after'])
  })

  it('HTML 表格：table/tr/td 真实表格结构', () => {
    const nodes = md.renderMarkdown('<table>\n<tr>\n<td>a</td>\n<td>b</td>\n</tr>\n</table>')
    assert.equal(nodes[0].type, 'table')
    const tr = nodes[0].children[0]
    assert.equal(tr.type, 'tr')
    assert.equal(tr.children[0].type, 'td')
    assert.equal(tr.children[0].children[0].type, 'p')
    assert.deepEqual(tr.children[0].children[0].children, ['a'])
    assert.deepEqual(tr.children[1].children[0].children, ['b'])
  })

  it('HTML 标题与 mark/kbd 等行内元素', () => {
    const h2 = md.renderMarkdown('<h2 align="center">Title</h2>')
    assert.equal(h2[0].type, 'h2')
    assert.deepEqual(h2[0].props.style, { textAlign: 'center' })
    assert.deepEqual(h2[0].children, ['Title'])
    const mixed = md.renderMarkdown('<p>Press <kbd>Ctrl</kbd> and <mark>hi</mark></p>')
    const kids = mixed[0].children[0].children // wrapper <p> 剥壳递归 → 内层 p
    assert.equal(kids.filter((x) => x && x.type === 'kbd').length, 1)
    assert.equal(kids.filter((x) => x && x.type === 'mark').length, 1)
  })

  it('未闭合包裹标签降级行内流，不吞全文；深度护栏兜底', () => {
    const unclosed = md.renderMarkdown('<p align="center">\n\n## T\n\nbody')
    // p 不跨空行寻闭合 → 止于空行 → 剥壳失败降级，后续 markdown 照常
    assert.ok(unclosed.some((x) => x && x.type === 'h2'))
    const deep = md.renderMarkdown('<div>'.repeat(12) + 'core' + '</div>'.repeat(12))
    const json = JSON.stringify(deep)
    assert.ok(json.includes('core'))
    // 深度护栏降级为纯文本（React 转义），不产生 12 层嵌套结构
    assert.ok(deep.length < 5, `嵌套应被护栏截断: ${deep.length}`)
  })
})
