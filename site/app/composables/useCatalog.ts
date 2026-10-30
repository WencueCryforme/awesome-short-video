import type { CatalogEntry, CatalogManifest } from '~/types/catalog'
import { SITE } from '~/const'

interface CatalogView {
  entries: CatalogEntry[]
  presetTags: string[]
}

/* 构建期把清单数据写成站点根下的独立脚本,运行时由全局对象直接读取 */
interface CatalogPayload {
  catalog?: CatalogManifest
  tagPresets?: string[]
}

/* 服务端预渲染读私有运行时配置,客户端读构建期脚本写入的全局对象 */
function readCatalogSource(): CatalogPayload {
  if (import.meta.server) {
    const config = useRuntimeConfig()
    return {
      catalog: config.catalog as CatalogManifest,
      tagPresets: config.tagPresets as string[]
    }
  }

  const payload = (globalThis as { __CATALOG__?: CatalogPayload }).__CATALOG__
  if (!payload) {
    console.warn('未读到构建期清单数据,请确认页面已引入清单数据脚本')
    return {}
  }

  return payload
}

/* 清单与标签预选项在构建期生成,站点只读取不修改 */
export function useCatalog(): CatalogView {
  const source = readCatalogSource()
  const presetTags = (source.tagPresets || []).filter(tag => typeof tag === 'string' && tag.length > 0)
  const entries = (source.catalog?.total ?? []).filter(entry => entry && entry.filename)

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
