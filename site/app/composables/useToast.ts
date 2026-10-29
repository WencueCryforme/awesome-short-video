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
    /* 按配置保留气泡数量,超出后立即移除旧气泡 */
    const next = [...items.value, { id, message, tone }].slice(-TOAST.maxCount)
    for (const item of items.value) {
      if (!next.some(entry => entry.id === item.id)) {
        clearTimer(item.id)
      }
    }
    items.value = next
    clearTimer(id)
    timers.set(id, setTimeout(() => dismiss(id), TOAST.durationMs))
  }

  return { items, push, dismiss }
}
