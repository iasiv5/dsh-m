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
