/*
 * 构建期把清单里的每条视频渲染为独立静态页面,写入站点产物目录,仓库内不保留生成结果
 * 每个页面有自己的标题,简介与结构化数据,便于搜索引擎单独索引每条视频
 * 产物目录不存在时直接报错,避免产出一份只有视频页面的残缺站点
 */
import { statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_MANIFEST, PROJECT_ROOT, parseArgs, resolveFromCwd } from './lib/cli.mjs'
import { readJsonDocument } from './lib/json-style.mjs'
import { HASH_ID_FIELD, isNonEmptyString } from './lib/manifest-entry.mjs'
import { computeHashId } from './lib/hash-id.mjs'
import { emitResult, makeError } from './lib/result.mjs'
import { readVersion, versionToDate } from './lib/version.mjs'

/* 站点常量是站点级信息的数据源,版本号例外,统一从仓库根目录的 VERSION 文件读取 */
const SITE_CONST_PATH = join(PROJECT_ROOT, 'site', 'app', 'const.ts')
/* 页面写入站点产物目录,该目录由构建生成且不进 git 追踪 */
const DEFAULT_OUT_DIR = join(PROJECT_ROOT, 'site', '.output', 'public')
const PAGE_DIR = 'video'
const PAGE_FILE = 'index.html'
const SITEMAP_FILE = 'sitemap.xml'
const VIDEO_QUERY_PARAM = 'video'
const HASH_ID_PATTERN = /^[0-9a-f]{16}$/
const ROBOTS_CONTENT = 'index, follow, max-image-preview:large'

/* 页面样式按极简原则内联,与主站样式相互独立 */
const PAGE_STYLES = [
  'body{margin:0;background:#000;color:#eee;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6}',
  'main{max-width:720px;margin:0 auto;padding:16px 16px 8px}',
  'h1{font-size:18px;line-height:1.4;margin:0 0 12px}',
  'video{width:100%;height:auto;display:block;background:#000}',
  '.desc{margin:12px 0 0}',
  '.tags{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0;padding:0;list-style:none}',
  '.tags li{font-size:12px;padding:2px 8px;border:1px solid #444;border-radius:999px;color:#bbb}',
  '.meta{margin:12px 0 0;font-size:12px;color:#999}',
  '.back{margin:16px 0 0}',
  'a{color:#3ea6ff}',
  'footer{padding:0 16px 24px;font-size:12px;color:#777;text-align:center}'
]

const { options, positionals, errors } = parseArgs(process.argv.slice(2), {
  flags: ['check'],
  values: ['single', 'out', 'manifest']
})

class ConfigError extends Error {
  constructor(message, kind) {
    super(message)
    this.kind = kind === undefined ? 'config' : kind
  }
}

function fail(kind, message, details) {
  emitResult({ ok: false, error: makeError(message, kind, details) })
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/* 从常量源码里按字段名取字符串,取不到时返回 null,由调用方统一报错 */
function readConstString(text, field) {
  const match = new RegExp('\\b' + field + ':\\s*([\'"])([^\'"]*)\\1').exec(text)
  return match ? match[2] : null
}

/* 从常量源码里按字段名取整数,用于版权年份 */
function readConstNumber(text, field) {
  const match = new RegExp('\\b' + field + ':\\s*(\\d+)').exec(text)
  return match ? Number(match[1]) : null
}

/* 站点级字段一次性取出并校验,缺失或格式不合规都直接报错 */
async function loadSiteConfig() {
  const text = await readFile(SITE_CONST_PATH, 'utf8')
  const author = /\bauthor:\s*\{[^}]*?name:\s*([\'"])([^\'"]*)\1/.exec(text)
  const site = {
    title: readConstString(text, 'title'),
    subtitle: readConstString(text, 'subtitle'),
    description: readConstString(text, 'description'),
    siteUrl: readConstString(text, 'siteUrl'),
    videoBase: readConstString(text, 'video_oss_base_url'),
    coverDir: readConstString(text, 'video_cover_dir'),
    coverExtension: readConstString(text, 'video_cover_extension'),
    authorName: author ? author[2] : null,
    copyrightYear: readConstNumber(text, 'copyrightYear')
  }

  for (const field of Object.keys(site)) {
    if (field === 'copyrightYear') {
      continue
    }
    if (!isNonEmptyString(site[field])) {
      throw new ConfigError('站点常量 ' + SITE_CONST_PATH + ' 缺少字段 ' + field)
    }
  }
  if (!site.siteUrl.endsWith('/')) {
    throw new ConfigError('站点绝对地址必须以斜杠结尾: ' + site.siteUrl)
  }

  /* 版本号取自根目录 VERSION 文件,读取即校验 yyyy.MM.dd 格式 */
  site.version = await readVersion()
  site.uploadDate = versionToDate(site.version)
  if (site.copyrightYear === null) {
    site.copyrightYear = Number(site.uploadDate.slice(0, 4))
  }
  return site
}

/* 文本与属性统一转义,避免标题或简介里的符号破坏 html 结构 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* 结构化数据内嵌在 html 里,把尖括号换成转义序列,避免提前闭合 script */
function escapeJson(value) {
  return JSON.stringify(value).split('<').join('\\u003c')
}

function pageUrlOf(site, hashId) {
  return site.siteUrl + PAGE_DIR + '/' + hashId + '/'
}

function coverUrlOf(site, filename) {
  return site.siteUrl + site.coverDir + encodeURIComponent(filename + site.coverExtension)
}

function videoUrlOf(site, filename) {
  return site.videoBase + encodeURIComponent(filename)
}

function renderPage(entry, site) {
  const hashId = entry[HASH_ID_FIELD]
  const tags = Array.isArray(entry.tags) ? entry.tags : []
  const pageUrl = pageUrlOf(site, hashId)
  const coverFile = entry.filename + site.coverExtension
  const posterPath = '../../' + site.coverDir + encodeURIComponent(coverFile)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: entry.title,
    description: entry.desc,
    thumbnailUrl: coverUrlOf(site, entry.filename),
    uploadDate: site.uploadDate,
    contentUrl: videoUrlOf(site, entry.filename)
  }
  const lines = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapeHtml(entry.title + ' - ' + site.subtitle) + '</title>',
    '<meta name="description" content="' + escapeHtml(entry.desc) + '">',
    '<meta name="author" content="' + escapeHtml(site.authorName) + '">',
    '<meta name="robots" content="' + ROBOTS_CONTENT + '">',
    '<link rel="canonical" href="' + escapeHtml(pageUrl) + '">',
    '<link rel="icon" href="../../favicon.svg" type="image/svg+xml">',
    '<meta property="og:type" content="video.other">',
    '<meta property="og:site_name" content="' + escapeHtml(site.title) + '">',
    '<meta property="og:title" content="' + escapeHtml(entry.title) + '">',
    '<meta property="og:description" content="' + escapeHtml(entry.desc) + '">',
    '<meta property="og:url" content="' + escapeHtml(pageUrl) + '">',
    '<meta property="og:image" content="' + escapeHtml(coverUrlOf(site, entry.filename)) + '">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<script type="application/ld+json">' + escapeJson(jsonLd) + '</script>',
    '<style>',
    ...PAGE_STYLES,
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<h1>' + escapeHtml(entry.title) + '</h1>',
    '<video src="' + escapeHtml(videoUrlOf(site, entry.filename)) + '" poster="' + escapeHtml(posterPath) + '" controls playsinline preload="none"></video>',
    '<p class="desc">' + escapeHtml(entry.desc) + '</p>',
    tags.length > 0 ? '<ul class="tags">' + tags.map(tag => '<li>' + escapeHtml(tag) + '</li>').join('') + '</ul>' : '',
    '<p class="meta">发布于 ' + site.uploadDate + ' · 作者 ' + escapeHtml(site.authorName) + '</p>',
    '<p class="back"><a href="../../?' + VIDEO_QUERY_PARAM + '=' + hashId + '">点击前往主页面获取最佳观看体验</a></p>',
    '</main>',
    '<footer>© ' + site.copyrightYear + ' ' + escapeHtml(site.authorName) + ' · <a href="../../">' + escapeHtml(site.title) + '</a></footer>',
    '</body>',
    '</html>'
  ]

  return lines.filter(line => line.length > 0).join('\n') + '\n'
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderSitemap(site, entries) {
  const locations = [site.siteUrl]
  for (const entry of entries) {
    locations.push(pageUrlOf(site, entry[HASH_ID_FIELD]))
  }

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
  for (const location of locations) {
    lines.push('  <url>')
    lines.push('    <loc>' + escapeXml(location) + '</loc>')
    lines.push('    <lastmod>' + site.uploadDate + '</lastmod>')
    lines.push('  </url>')
  }
  lines.push('</urlset>')
  return lines.join('\n') + '\n'
}

async function main() {
  if (errors.length > 0) {
    return fail('args', errors.join('; '))
  }
  if (positionals.length > 0) {
    return fail('args', '未知的位置参数: ' + positionals.join(' '))
  }

  const single = options.single
  if (single !== null && !HASH_ID_PATTERN.test(single)) {
    return fail('args', '选项 --single 需要 16 位小写十六进制 hash_id: ' + single)
  }

  const outDir = options.out ? resolveFromCwd(options.out) : DEFAULT_OUT_DIR
  if (!isDirectory(outDir)) {
    return fail('output', '产物目录不存在: ' + outDir + ',请先运行 npm run generate', { out: outDir })
  }

  let site
  try {
    site = await loadSiteConfig()
  } catch (error) {
    return fail(error && typeof error.kind === 'string' ? error.kind : 'config', error.message)
  }

  const manifestPath = options.manifest ? resolveFromCwd(options.manifest) : DEFAULT_MANIFEST
  let manifest
  try {
    manifest = (await readJsonDocument(manifestPath)).value
  } catch (error) {
    return fail('manifest', '清单读取失败: ' + error.message, { manifest: manifestPath })
  }
  if (!manifest || !Array.isArray(manifest.total)) {
    return fail('manifest', '清单缺少 total 数组', { manifest: manifestPath })
  }

  const entries = manifest.total.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry))
  /* hash_id 由条目内容推导,与内容不一致说明清单未重新生成 */
  const mismatched = entries.filter(entry => entry[HASH_ID_FIELD] !== computeHashId(entry))
  if (mismatched.length > 0) {
    return fail('manifest', '条目 hash_id 与内容不一致,请先运行排序脚本', {
      manifest: manifestPath,
      entries: mismatched.slice(0, 10).map(entry => ({
        filename: entry.filename,
        stored: entry[HASH_ID_FIELD],
        computed: computeHashId(entry)
      }))
    })
  }

  let selected = entries
  if (single !== null) {
    selected = entries.filter(entry => entry[HASH_ID_FIELD] === single)
    if (selected.length === 0) {
      return fail('manifest', '清单中没有 hash_id 为 ' + single + ' 的条目', { manifest: manifestPath, single })
    }
  }

  const check = options.check === true
  const pages = []
  for (const entry of selected) {
    const hashId = entry[HASH_ID_FIELD]
    const directory = join(outDir, PAGE_DIR, hashId)
    const file = join(directory, PAGE_FILE)
    if (!check) {
      await mkdir(directory, { recursive: true })
      await writeFile(file, renderPage(entry, site), 'utf8')
    }
    pages.push({ hashId, title: entry.title, url: pageUrlOf(site, hashId), file })
  }

  /* 单条模式不改写站点地图,避免用不完整的结果覆盖全量地图 */
  let sitemap = null
  if (single === null) {
    const file = join(outDir, SITEMAP_FILE)
    if (!check) {
      await writeFile(file, renderSitemap(site, entries), 'utf8')
    }
    sitemap = { file, urlCount: entries.length + 1 }
  }

  emitResult({
    ok: true,
    data: {
      out: outDir,
      manifest: manifestPath,
      check,
      version: site.version,
      uploadDate: site.uploadDate,
      pageCount: pages.length,
      pages,
      sitemap
    }
  })
}

main().catch(error => fail('write', '未预期错误: ' + error.message))
