import { FEED_END_MESSAGE, FEED_END_TOAST_COOLDOWN_MS } from '~/const'

/* 到达末条后继续尝试滑动的提示,滑动事件与键盘共用 */
export function useFeedEndToast(options: {
  isAtEnd: () => boolean
  push: (message: string) => void
}) {
  let lastShownAt = 0
  let touchStartY = 0
  let touchStartedAtEnd = false
  let wheelStartedAtEnd = false
  let wheelResetTimer: ReturnType<typeof setTimeout> | null = null

  function notify() {
    if (!options.isAtEnd()) {
      return
    }
    const now = Date.now()
    if (now - lastShownAt < FEED_END_TOAST_COOLDOWN_MS) {
      return
    }
    lastShownAt = now
    options.push(FEED_END_MESSAGE)
  }

  function onWheel(event: WheelEvent) {
    if (!wheelResetTimer) {
      wheelStartedAtEnd = options.isAtEnd()
    } else {
      clearTimeout(wheelResetTimer)
    }
    wheelResetTimer = setTimeout(() => {
      wheelResetTimer = null
      wheelStartedAtEnd = false
    }, 180)
    if (event.deltaY > 0 && wheelStartedAtEnd) {
      notify()
    }
  }

  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0]
    if (!touch) {
      return
    }
    touchStartY = touch.clientY
    touchStartedAtEnd = options.isAtEnd()
  }

  function onTouchEnd(event: TouchEvent) {
    if (!touchStartedAtEnd) {
      return
    }
    touchStartedAtEnd = false
    const touch = event.changedTouches[0]
    if (touch && touchStartY - touch.clientY > 32) {
      notify()
    }
  }

  function onTouchCancel() {
    touchStartedAtEnd = false
  }

  return { notify, onWheel, onTouchStart, onTouchEnd, onTouchCancel }
}
