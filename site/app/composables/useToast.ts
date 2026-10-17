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
    items.value = [...items.value, { id, message, tone }]
    setTimeout(() => dismiss(id), 3200)
  }

  return { items, push, dismiss }
}
