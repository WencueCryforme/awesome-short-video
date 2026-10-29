import type { CatalogEntry, CatalogManifest } from '~/types/catalog'
import { SITE } from '~/const'

interface CatalogView {
  entries: CatalogEntry[]
  presetTags: string[]
}

/* 清单与标签预选项由构建期注入运行时配置,站点只读取不修改 */
export function useCatalog(): CatalogView {
  const config = useRuntimeConfig()
  const catalog = config.public.catalog as CatalogManifest
  const presetTags = (config.public.tagPresets as string[]).filter(tag => typeof tag === 'string' && tag.length > 0)

  const entries = (catalog.total || []).filter(entry => entry && entry.filename)

  return { entries, presetTags }
}

/* 视频文件统一取自对象存储,基地址已自带结尾斜杠 */
export function useVideoUrl() {
  return (filename: string) => SITE.video_oss_base_url + encodeURIComponent(filename)
}

/* 封面图片随站点构建产物发布,按站点基路径与视频文件名拼接,不再访问对象存储 */
export function useCoverUrl() {
  const baseURL = useRuntimeConfig().app.baseURL
  return (filename: string) => baseURL + SITE.video_cover_dir + encodeURIComponent(filename + SITE.video_cover_extension)
}
