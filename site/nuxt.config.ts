import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_THEME, SITE } from './app/const'
import type { CatalogManifest } from './app/types/catalog'

const siteRoot = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(siteRoot, '..')
/* 基路径统一为以斜杠开头并结尾的相对路径,空值回落根路径 */
const rawBaseURL = (process.env.NUXT_APP_BASE_URL || '/').trim()
const trimmedBaseURL = rawBaseURL.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/')
const baseURL = trimmedBaseURL ? '/' + trimmedBaseURL + '/' : '/'

/* 读取构建期 JSON 数据,解析失败时提示具体文件与原因 */
function readJson<T>(relativePath: string): T {
  const filePath = resolve(projectRoot, relativePath)
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error('读取 ' + relativePath + ' 失败: ' + reason)
  }
}

/* 构建期读取清单与标签预选项,序列化进公开运行时配置,避免站点运行时回写源文件 */
const catalog = readJson<CatalogManifest>('video/manifest.json')
const tagPresets = readJson<string[]>('video/tags.json')

export default defineNuxtConfig({
  compatibilityDate: '2026-10-17',
  devtools: { enabled: false },
  app: {
    baseURL,
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: SITE.title,
      meta: [
        { name: 'description', content: SITE.description },
        { name: 'author', content: SITE.author.name },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { property: 'og:title', content: SITE.title },
        { property: 'og:description', content: SITE.description },
        { property: 'og:type', content: 'website' }
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: baseURL + 'favicon.svg' }],
      script: [
        {
          key: 'theme-init',
          tagPosition: 'head',
          innerHTML: "(function(){try{var key='" + SITE.themeStorageKey + "';var stored=localStorage.getItem(key);var theme=stored==='light'||stored==='dark'?stored:'" + DEFAULT_THEME + "';document.documentElement.setAttribute('data-theme',theme)}catch(error){document.documentElement.setAttribute('data-theme','" + DEFAULT_THEME + "')}})()"
        }
      ]
    }
  },
  css: ['~/assets/css/main.css'],
  nitro: {
    /* 封面图片随站点产物一起发布,开发与构建从同一目录取图 */
    publicAssets: [
      { dir: resolve(projectRoot, 'video/cover'), baseURL: 'cover' }
    ]
  },
  runtimeConfig: {
    public: {
      catalog,
      tagPresets
    }
  }
})

