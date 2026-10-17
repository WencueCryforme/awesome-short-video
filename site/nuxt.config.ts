import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SITE } from './app/utils/site'

const siteRoot = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(siteRoot, '..')
/* 统一基路径,保证前后均带斜杠 */
const rawBaseURL = process.env.NUXT_APP_BASE_URL || '/'
const baseURL = ('/' + rawBaseURL + '/').replace(/\/+/g, '/')

/* 构建期读取清单与标签预选项,序列化进公开运行时配置,避免站点运行时回写源文件 */
const catalog = JSON.parse(readFileSync(resolve(projectRoot, 'video/manifest.json'), 'utf8'))
const tagPresets = JSON.parse(readFileSync(resolve(projectRoot, 'video/tags.json'), 'utf8'))

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
          innerHTML: "(function(){try{var key='" + SITE.themeStorageKey + "';var stored=localStorage.getItem(key);var theme=stored==='light'||stored==='dark'?stored:(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',theme)}catch(error){document.documentElement.setAttribute('data-theme','dark')}})()"
        }
      ]
    }
  },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    public: {
      catalog,
      tagPresets
    }
  },
  nitro: {
    publicAssets: [
      {
        /* 只暴露入库视频目录,过大视频目录不进入构建产物 */
        dir: '../video/file',
        baseURL: 'video/file',
        maxAge: 60 * 60 * 24 * 30
      }
    ]
  }
})
