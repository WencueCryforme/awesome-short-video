import type { CatalogEntry } from '~/types/catalog'

export interface EmbedSource {
  src: string
  provider: 'douyin' | 'generic'
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/* 上游嵌入适配器,抖音使用公开 iframe 播放器,其他来源先按原页面嵌入 */
export function resolveEmbed(entry: CatalogEntry): EmbedSource | null {
  if (entry.allow_iframe === false) {
    return null
  }
  if (!entry.source) {
    return null
  }

  const host = hostnameOf(entry.source)
  if (/(^|\.)douyin\.com$/.test(host)) {
    if (!entry.source_id) {
      return null
    }
    return {
      provider: 'douyin',
      src: 'https://open.douyin.com/player/video?vid=' + encodeURIComponent(entry.source_id) + '&autoplay=0'
    }
  }

  return { provider: 'generic', src: entry.source }
}

export function canEmbed(entry: CatalogEntry): boolean {
  return resolveEmbed(entry) !== null
}
