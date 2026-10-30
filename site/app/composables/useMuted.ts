import { SITE } from '~/const'

/*
  静音状态全站共享,首页与搜索详情层共用同一份,
  偏好写入 localStorage,首屏仍以静音启动以满足自动播放策略
*/
let restored = false

export function useMuted() {
  const muted = useState<boolean>('site-muted', () => true)

  function persist(next: boolean) {
    if (!import.meta.client) {
      return
    }
    try {
      localStorage.setItem(SITE.mutedStorageKey, next ? 'on' : 'off')
    } catch {
      /* 隐私模式下忽略存储失败 */
    }
  }

  function setMuted(next: boolean) {
    muted.value = next
    persist(next)
  }

  function toggle() {
    setMuted(!muted.value)
  }

  onMounted(() => {
    if (restored) {
      return
    }
    restored = true
    let stored: string | null = null
    try {
      stored = localStorage.getItem(SITE.mutedStorageKey)
    } catch {
      stored = null
    }
    if (stored === 'on' || stored === 'off') {
      muted.value = stored === 'on'
    }
  })

  return { muted, setMuted, toggle }
}
