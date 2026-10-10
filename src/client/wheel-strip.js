/**
 * 截图条滚轮横滚判定（0.9.74，钢人三红线，Node tests 直测，不依赖 DOM/React）。
 * 背景：详情截图条 .dsvm-shotrow 是横滚容器，鼠标滚轮在横滚容器上默认纵滚祖先
 * （弹窗）——图片多时纯鼠标用户只能拖滚动条。本判定把「裸滚轮 deltaY」安全地
 * 映射为横滚，同时把劫持压到最小：
 * ① 可滚才拦——scrollWidth ≤ clientWidth(+1 亚像素容差，0.9.72 useScrollableContain
 *   同款口径) 时零动作：不满行的多数条目（1-2 张图）滚轮行为与今日完全一致，
 *   杜绝「静态劫持表达动态适用前提」的滚轮黑洞同构病复发；
 * ② 到头放行——已到 deltaY 方向的横滚边界时零动作：纵滚还给弹窗，滚动链保持
 *   自然语义（横向有得滚才借道，借完即还）；
 * ③ deltaX 不碰——|deltaX| ≥ |deltaY|（触控板双指横滑）时不劫持不重复喂，
 *   浏览器原生横滚已正确；Shift+滚轮（Chrome 报 deltaY）落进 deltaY 分支，
 *   映射结果与原生横滚语义一致，无行为冲突。
 * 返回 { scrollBy, preventDefault }：接线处 preventDefault 为 true 时
 * e.preventDefault() + row.scrollLeft += scrollBy；为 false 时整事件放行。
 * 非有限输入一律安全短路（异常事件/SSR 环境零动作）。
 */
export function shotWheelAction({ deltaX, deltaY, scrollWidth, clientWidth, scrollLeft }) {
  const inputs = [deltaX, deltaY, scrollWidth, clientWidth, scrollLeft];
  if (!inputs.every(Number.isFinite)) return { scrollBy: 0, preventDefault: false };
  if (scrollWidth <= clientWidth + 1) return { scrollBy: 0, preventDefault: false };
  if (deltaY === 0 || Math.abs(deltaX) >= Math.abs(deltaY)) return { scrollBy: 0, preventDefault: false };
  const maxScrollLeft = scrollWidth - clientWidth;
  const atEnd = scrollLeft >= maxScrollLeft - 1;
  const atStart = scrollLeft <= 0;
  if ((deltaY > 0 && atEnd) || (deltaY < 0 && atStart)) return { scrollBy: 0, preventDefault: false };
  return { scrollBy: deltaY, preventDefault: true };
}
