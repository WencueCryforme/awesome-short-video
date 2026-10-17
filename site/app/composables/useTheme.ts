import { DEFAULT_THEME, SITE } from '~/const'

export type ThemeName = 'dark' | 'light'

/* 主题偏好写入 localStorage,首屏由 nuxt.config 中的内联脚本提前应用 */
export function useTheme() {
  const theme = useState<ThemeName>('site-theme', () => DEFAULT_THEME)
  const config = useRuntimeConfig()
  const rawBase = (config.app.baseURL as string) || '/'
  const base = rawBase.endsWith('/') ? rawBase : rawBase + '/'

  function updateFavicon(next: ThemeName) {
    if (!import.meta.client) {
      return
    }
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (link) {
      link.setAttribute('href', base + (next === 'light' ? 'favicon.svg' : 'favicon-dark.svg'))
    }
  }

  function apply(next: ThemeName) {
    theme.value = next
    if (import.meta.client) {
      document.documentElement.setAttribute('data-theme', next)
      updateFavicon(next)
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
    updateFavicon(theme.value)
  })

  return {
    theme,
    isLight: computed(() => theme.value === 'light'),
    toggle
  }
}
