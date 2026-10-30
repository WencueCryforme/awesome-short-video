import { TOAST } from '~/const'

export interface ToastItem {
  id: number
  message: string
  tone: 'info' | 'error'
}

let nextId = 0
/* 每条气泡的自动关闭定时器,气泡被提前移除或挤出时一并清理 */
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export function useToast() {
  const items = useState<ToastItem[]>('site-toasts', () => [])

  function clearTimer(id: number) {
    const timer = timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(id)
    }
  }

  function dismiss(id: number) {
    clearTimer(id)
    items.value = items.value.filter(item => item.id !== id)
  }

  function push(message: string, tone: ToastItem['tone'] = 'info') {
    const id = ++nextId
    /* 换新时先撤掉全部旧气泡,新气泡重新挂载以播放入场动画 */
    for (const item of items.value) {
      clearTimer(item.id)
    }
    items.value = [{ id, message, tone }].slice(-TOAST.maxCount)
    timers.set(id, setTimeout(() => dismiss(id), TOAST.durationMs))
  }

  return { items, push, dismiss }
}
