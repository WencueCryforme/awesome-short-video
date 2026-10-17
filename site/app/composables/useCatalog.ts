import type { CatalogEntry, CatalogManifest } from '~/types/catalog'
import { SITE } from '~/utils/site'

interface CatalogView {
  entries: CatalogEntry[]
  playableCount: number
  tooLargeCount: number
  presetTags: string[]
}

/* 清单与标签预选项由构建期注入运行时配置,站点只读取不修改 */
export function useCatalog(): CatalogView {
  const config = useRuntimeConfig()
  const catalog = config.public.catalog as CatalogManifest
  const presetTags = (config.public.tagPresets as string[]).filter(tag => typeof tag === 'string' && tag.length > 0)

  const entries = (catalog.total || []).filter(entry => entry && entry.filename)
  const playableCount = entries.filter(entry => entry.flag !== SITE.tooLargeFlag).length
  const tooLargeCount = entries.length - playableCount

  return { entries, playableCount, tooLargeCount, presetTags }
}

export function useVideoUrl() {
  const config = useRuntimeConfig()
  const raw = config.app.baseURL || '/'
  const base = raw.endsWith('/') ? raw : raw + '/'

  return (filename: string) => base + SITE.videoDir + '/' + encodeURIComponent(filename)
}

export function isTooLarge(entry: CatalogEntry): boolean {
  return entry.flag === SITE.tooLargeFlag
}
