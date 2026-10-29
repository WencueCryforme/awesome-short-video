import { DEFAULT_THEME, SITE } from '~/const'

export type ThemeName = 'dark' | 'light'

/* 主题偏好写入 localStorage,首屏由 nuxt.config 中的内联脚本提前应用 */
export function useTheme() {
  const theme = useState<ThemeName>('site-theme', () => DEFAULT_THEME)
  /* app.baseURL 由构建期固定为前后均带斜杠的形式,拼接资源路径时直接前置即可 */
  const baseURL = useRuntimeConfig().app.baseURL

  function updateFavicon(next: ThemeName) {
    if (!import.meta.client) {
      return
    }
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (link) {
      link.setAttribute('href', baseURL + (next === 'light' ? 'favicon.svg' : 'favicon-dark.svg'))
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
    theme.value = current === 'light' || current === 'dark' ? current : DEFAULT_THEME
    updateFavicon(theme.value)
  })

  return {
    theme,
    isLight: computed(() => theme.value === 'light'),
    toggle
  }
}
