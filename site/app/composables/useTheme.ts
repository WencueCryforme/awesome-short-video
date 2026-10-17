import { SITE } from '~/utils/site'

export type ThemeName = 'dark' | 'light'

/* 主题偏好写入 localStorage,首屏由 nuxt.config 中的内联脚本提前应用 */
export function useTheme() {
  const theme = useState<ThemeName>('site-theme', () => 'dark')

  function apply(next: ThemeName) {
    theme.value = next
    if (import.meta.client) {
      document.documentElement.setAttribute('data-theme', next)
      try {
        localStorage.setItem(SITE.themeStorageKey, next)
      } catch {
        /* 隐私模式下忽略存储失败 */
      }
    }
  }

  function toggle() {
    apply(theme.value === 'light' ? 'dark' : 'light')
  }

  onMounted(() => {
    const current = document.documentElement.getAttribute('data-theme')
    theme.value = current === 'light' ? 'light' : 'dark'
  })

  return {
    theme,
    isLight: computed(() => theme.value === 'light'),
    toggle
  }
}
