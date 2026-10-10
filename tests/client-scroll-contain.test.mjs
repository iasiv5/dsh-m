/**
 * 0.9.72 滚轮治理（contain 改为「可滚才挂」）结构锚。
 *
 * 病灶：`.dshm-ops-scroll` / `.dshm-banner-text` 恒挂 overscroll-behavior:contain +
 * overflow-y:auto——内容不满限时元素仍是无溢出的滚动容器，规范口径「没有可滚溢出的
 * 滚动容器恒在滚动边界」+ contain「边界禁链滚」→ 整块区域吞掉滚轮、页面无法翻页。
 * Chrome 144 起（Respect overscroll-behavior on non-scrollable scroll containers）
 * 对该规范行为无条件执行，潜伏缺陷被引擎升级激活（此前引擎仅真可滚才执行 contain）。
 *
 * 修复 = useScrollableContain(dep)：实测 scrollHeight > clientHeight 才挂 .is-scrollable。
 * 本文件用 includes 级结构锚钉住「恒挂形态退役 + 条件挂载形态在 + 三处接线在」——
 * 防止后续改 CSS 时把 contain 写回基规则、或接线时漏 ref/类名（文本级红灯语义 =
 * 「文本变了」，行为回归靠 client-render-smoke + 手动实滚验证）。
 * 运行：npm test 自动发现。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const src = readFileSync(join(root, 'src/client/main.jsx'), 'utf8')

describe('0.9.72 滚轮治理：contain 条件挂载（滚轮黑洞修复）', () => {
  it('恒挂形态退役：基规则不再带 overscroll-behavior', () => {
    assert.ok(
      !src.includes('.dshm-ops-scroll{max-height:220px;overflow-y:auto;overscroll-behavior:contain}'),
      'dshm-ops-scroll 恒挂 contain 已退役',
    )
    assert.ok(
      !src.includes('.dshm-banner-text{flex:1;max-height:140px;overflow:auto;overscroll-behavior:contain'),
      'dshm-banner-text 恒挂 contain 已退役',
    )
  })

  it('条件挂载形态在：.is-scrollable 才带 contain，基规则保持可链滚', () => {
    assert.ok(
      src.includes('.dshm-ops-scroll{max-height:220px;overflow-y:auto}') &&
        src.includes('.dshm-ops-scroll.is-scrollable{overscroll-behavior:contain}'),
      'dshm-ops-scroll 双规则对（基规则可链滚 + is-scrollable 才断链）',
    )
    assert.ok(
      src.includes('.dshm-banner .dshm-banner-text.is-scrollable{overscroll-behavior:contain}'),
      'dshm-banner-text 条件规则在',
    )
  })

  it('hook 在：实测可滚才挂类，ResizeObserver 缺席（SSR/Node）安全跳过', () => {
    assert.ok(src.includes('function useScrollableContain(dep)'), 'useScrollableContain 定义在')
    assert.ok(
      src.includes('if (!el || typeof ResizeObserver === "undefined") return;'),
      'ResizeObserver 缺席守卫在（renderToString 冒烟路径不炸）',
    )
    assert.ok(
      src.includes('setScrollable(el.scrollHeight > el.clientHeight + 1);'),
      '可滚判定 = scrollHeight 严格超出（+1 容亚像素取整）',
    )
  })

  it('三处接线在：操作记录滚动区 / 重启横幅 / toast', () => {
    assert.ok(
      src.includes('className: `dshm-ops-scroll${scrollCls}`'),
      '操作记录滚动区接线在',
    )
    assert.ok(
      src.includes('tabIndex: 0') && src.includes('"aria-label": lookup("settings.ops")'),
      '滚动区键盘可达（0.9.45 U8 纪律延续）',
    )
    assert.ok(
      src.includes('useScrollableContain(finished.length)'),
      '滚动区内容键 = 已结束条数',
    )
    assert.ok(
      src.includes('className: `dshm-banner-text${textScrollCls}`'),
      '重启横幅接线在',
    )
    assert.ok(
      src.includes('useScrollableContain(toast ? toast.text : "")'),
      'toast 内容键在',
    )
    assert.ok(
      src.includes('className: `dshm-banner-text${toastScrollCls}`'),
      'toast 接线在',
    )
  })
})
