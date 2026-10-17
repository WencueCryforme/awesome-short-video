import { TOAST } from '~/const'

export interface ToastItem {
  id: number
  message: string
  tone: 'info' | 'error'
}

let nextId = 0

export function useToast() {
  const items = useState<ToastItem[]>('site-toasts', () => [])

  function dismiss(id: number) {
    items.value = items.value.filter(item => item.id !== id)
  }

  function push(message: string, tone: ToastItem['tone'] = 'info') {
    const id = ++nextId
    /* 按配置保留气泡数量,超出后立即移除旧气泡 */
    const next = [...items.value, { id, message, tone }].slice(-TOAST.maxCount)
    items.value = next
    setTimeout(() => dismiss(id), TOAST.durationMs)
  }

  return { items, push, dismiss }
}
