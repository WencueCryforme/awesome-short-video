import { DEFAULT_SOURCE_MODE, MODE_QUERY_PARAM, SOURCE_MODE_STORAGE_KEY } from '~/const'
import type { SourceMode } from '~/const'

function isSourceMode(value: string | null): value is SourceMode {
  return value === 'onsite' || value === 'upstream'
}

/* 全局默认源,清单条目显式 default_mode 时以清单为准 */
export function useSourceMode() {
  const route = useRoute()
  const uiMode = useState<SourceMode>('site-source-mode', () => DEFAULT_SOURCE_MODE)
  const hydrated = useState('site-source-mode-hydrated', () => false)

  const rawUrlMode = computed<SourceMode | null>(() => {
    const raw = route.query[MODE_QUERY_PARAM]
    const value = Array.isArray(raw) ? raw[0] : raw
    return isSourceMode(value ?? null) ? value : null
  })

  /* URL 参数只在客户端挂载后生效,避免静态页面的 hydration 不一致 */
  const urlMode = computed<SourceMode | null>(() => (hydrated.value ? rawUrlMode.value : null))
  const mode = computed<SourceMode>(() => urlMode.value ?? uiMode.value)
  const isUrlOverride = computed(() => urlMode.value !== null)

  function setMode(next: SourceMode) {
    uiMode.value = next
    if (import.meta.client) {
      try {
        localStorage.setItem(SOURCE_MODE_STORAGE_KEY, next)
      } catch {
        /* 隐私模式下忽略存储失败 */
      }
    }
  }

  function toggle() {
    setMode(uiMode.value === 'onsite' ? 'upstream' : 'onsite')
  }

  onMounted(() => {
    if (hydrated.value) {
      return
    }
    hydrated.value = true
    try {
      const stored = localStorage.getItem(SOURCE_MODE_STORAGE_KEY)
      if (isSourceMode(stored)) {
        uiMode.value = stored
      }
    } catch {
      /* 隐私模式下忽略读取失败 */
    }
  })

  return { mode, uiMode, urlMode, isUrlOverride, setMode, toggle }
}
