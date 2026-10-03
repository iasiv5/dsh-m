/**
 * 遮罩点击关闭（0.9.27 防拖拽误关）：仅当 mousedown 与 click 都命中遮罩自身时才回调 onClose。
 * 背景：在面板/弹层内容里按下（如输入框选词）、拖选越过遮罩边界释放时，浏览器把 click 派发到
 * 按下/释放目标的公共祖先——恰是遮罩本身；旧「onClick: onClose」实现会把它当成「点了遮罩」而误关。
 * 守卫语义：mousedown 在遮罩上 + click 在遮罩上 → 关闭（其余组合一律不关，且 click 后按位状态复位）。
 * 不依赖 DOM/React（合成事件仅取 target/currentTarget 比较），Node tests 直接 import。
 */
export function backdropCloseHandlers(onClose) {
  let pressedOnBackdrop = false
  return {
    onMouseDown: (e) => {
      pressedOnBackdrop = Boolean(e) && e.target === e.currentTarget
    },
    onClick: (e) => {
      const onBackdrop = Boolean(e) && e.target === e.currentTarget
      const shouldClose = pressedOnBackdrop && onBackdrop
      pressedOnBackdrop = false
      if (shouldClose && typeof onClose === 'function') onClose()
    },
  }
}
