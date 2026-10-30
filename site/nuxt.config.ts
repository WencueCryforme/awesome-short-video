import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

/* 构建期读取清单与标签预选项,供预渲染与清单元数据脚本共用 */
const catalog = readJson<CatalogManifest>('video/manifest.json')
const tagPresets = readJson<string[]>('video/tags.json')

/* 清单元数据目录与脚本名前缀,目录列在 git 忽略项内 */
const DATA_DIR = resolve(siteRoot, '.data')
const DATA_SCRIPT_PREFIX = 'catalog.'
const DATA_PUBLIC_BASE = 'data'

/*
 * 把清单数据写成独立脚本,避免内联进每个 HTML 页面:
 * 文件名带内容哈希,数据变化后文件名随之变化,浏览器缓存自然失效
 */
function writeCatalogScript() {
  const body = 'window.__CATALOG__=' + JSON.stringify({ catalog, tagPresets })
  const hash = createHash('sha512').update(body, 'utf8').digest('hex').slice(0, 8)
  const fileName = DATA_SCRIPT_PREFIX + hash + '.js'

  mkdirSync(DATA_DIR, { recursive: true })
  for (const name of readdirSync(DATA_DIR)) {
    if (name.startsWith(DATA_SCRIPT_PREFIX)) {
      rmSync(resolve(DATA_DIR, name), { force: true })
    }
  }
  writeFileSync(resolve(DATA_DIR, fileName), body + '\n', 'utf8')

  return fileName
}

const catalogScriptFile = writeCatalogScript()

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
        },
        /* 同步经典脚本,解析到即执行,先于模块入口,首帧渲染前已有清单数据 */
        {
          key: 'catalog-data',
          tagPosition: 'bodyClose',
          src: baseURL + DATA_PUBLIC_BASE + '/' + catalogScriptFile
        }
      ]
    }
  },
  css: ['~/assets/css/main.css'],
  nitro: {
    /* 封面图片与清单数据脚本随站点产物一起发布,开发与构建从同一目录取文件 */
    publicAssets: [
      { dir: resolve(projectRoot, 'video/cover'), baseURL: 'cover' },
      { dir: DATA_DIR, baseURL: DATA_PUBLIC_BASE }
    ]
  },
  runtimeConfig: {
    /* 清单数据只在服务端预渲染时读取,不进入客户端运行时配置 */
    catalog,
    tagPresets
  }
})
