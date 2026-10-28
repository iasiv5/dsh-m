/**
 * 遮罩点击关闭（0.9.27 防拖拽误关）：仅当 mousedown 与 click 都命中遮罩自身时才回调 onClose。
 * 背景：在面板/弹层内容里按下（如输入框选词）、拖选越过遮罩边界释放时，浏览器把 click 派发到
 * 按下/释放目标的公共祖先——恰是遮罩本身；旧「onClick: onClose」实现会把它当成「点了遮罩」而误关。
 * 守卫语义：mousedown 在遮罩上 + click 在遮罩上 → 关闭（其余组合一律不关，且 click 后按位状态复位）。
 * 不依赖 DOM/React（合成事件仅取 target/currentTarget 比较），Node tests 直接 import。
 *
 * 触摸路径（0.10.24，issue #31：dsh-mobile WebView 里 compat 遮罩点按无法关闭）：
 * onTouchStart/onTouchEnd 以同一双落语义镜像鼠标路径（双落遮罩 → 关闭）。移动端 tap 会
 * 在 touchend 后补发合成 mousedown/click——WebView 部分场景（内核手势启发式、隧道高延迟
 * 下的事件重排）不产生匹配序列，click 常缺位，故关闭判定落在 touchend 即刻完成；随后若
 * 合成 click 真的来了，用「吞一次」门闩挡下，防 onClose 双触发；门闩在下一手势 touchstart
 * 作废——合成 click 缺位的 WebView 里不残留到下一次真实点击。触摸未关时不设门闩，
 * 鼠标路径（含混合设备）行为逐字节同 0.9.27。
 */
export function backdropCloseHandlers(onClose) {
  let pressedOnBackdrop = false
  let touchPressedOnBackdrop = false
  let swallowSyntheticClick = false
  const selfHit = (e) => Boolean(e) && e.target === e.currentTarget
  return {
    onMouseDown: (e) => {
      pressedOnBackdrop = selfHit(e)
    },
    onTouchStart: (e) => {
      touchPressedOnBackdrop = selfHit(e)
      swallowSyntheticClick = false // 新手势开始：上一轮未消费的门闩作废
    },
    onTouchEnd: (e) => {
      const shouldClose = touchPressedOnBackdrop && selfHit(e)
      touchPressedOnBackdrop = false
      if (shouldClose) {
        swallowSyntheticClick = true // 吞掉紧随的合成 click，防双关
        if (typeof onClose === 'function') onClose()
      }
    },
    onClick: (e) => {
      if (swallowSyntheticClick) {
        swallowSyntheticClick = false
        return
      }
      const onBackdrop = selfHit(e)
      const shouldClose = pressedOnBackdrop && onBackdrop
      pressedOnBackdrop = false
      if (shouldClose && typeof onClose === 'function') onClose()
    },
  }
}
