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
    /* 只保留一条气泡,新气泡立即替换旧气泡 */
    const next = [...items.value, { id, message, tone }].slice(-1)
    items.value = next
    setTimeout(() => dismiss(id), 2000)
  }

  return { items, push, dismiss }
}
