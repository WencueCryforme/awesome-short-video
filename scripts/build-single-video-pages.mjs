/*
 * 构建期把清单里的每条视频渲染为独立静态页面,写入站点产物目录,仓库内不保留生成结果
 * 每个页面有自己的标题,简介与结构化数据,便于搜索引擎单独索引每条视频
 * 历史文件里已归档的条目渲染为下架提示页,保留地址并告知视频已不存在,这类页面不进站点地图
 * 产物目录不存在时直接报错,避免产出一份只有视频页面的残缺站点
 */
import { statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_MANIFEST, PROJECT_ROOT, parseArgs, resolveFromCwd } from './lib/cli.mjs'
import { readJsonDocument } from './lib/json-style.mjs'
import { HASH_ID_FIELD, isNonEmptyString } from './lib/manifest-entry.mjs'
import { primaryHashId } from './lib/hash-id.mjs'
import { ARCHIVED_FIELD, REMOVED_DATE_FIELD, defaultHisPath, idRecordsOf, readHisDocument } from './lib/manifest-his.mjs'
import { emitResult, makeError } from './lib/result.mjs'
import { readVersion, versionToDate } from './lib/version.mjs'

/* 站点常量是站点级信息的数据源,版本号例外,统一从仓库根目录的 VERSION 文件读取 */
const SITE_CONST_PATH = join(PROJECT_ROOT, 'site', 'app', 'const.ts')
/* 页面写入站点产物目录,该目录由构建生成且不进 git 追踪 */
const DEFAULT_OUT_DIR = join(PROJECT_ROOT, 'site', '.output', 'public')
const PAGE_DIR = 'video'
const PAGE_FILE = 'index.html'
const SITEMAP_FILE = 'sitemap.xml'
const ROBOTS_FILE = 'robots.txt'
const VIDEO_QUERY_PARAM = 'video'
const HASH_ID_PATTERN = /^[0-9a-f]{16}$/
const ROBOTS_CONTENT = 'index, follow, max-image-preview:large'
const TOMBSTONE_ROBOTS = 'noindex, follow'

/* 页面样式按极简原则内联,与主站样式相互独立 */
const PAGE_STYLES = [
  'body{margin:0;background:#000;color:#eee;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6}',
  'main{max-width:720px;margin:0 auto;padding:16px 16px 8px}',
  'h1{font-size:18px;line-height:1.4;margin:0 0 12px}',
  'video{width:100%;height:auto;display:block;background:#000}',
  '.desc{margin:12px 0 0}',
  '.notice{margin:12px 0 0;padding:12px;border:1px solid #444;border-radius:8px;color:#bbb}',
  '.tags{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0;padding:0;list-style:none}',
  '.tags li{font-size:12px;padding:2px 8px;border:1px solid #444;border-radius:999px;color:#bbb}',
  '.meta{margin:12px 0 0;font-size:12px;color:#999}',
  '.actions{margin:16px 0 0;display:flex;flex-wrap:wrap;gap:12px;align-items:center}',
  '.copy-tip{font-size:12px;color:#3ea6ff}',
  '.back{margin:16px 0 0}',
  'a{color:#3ea6ff}',
  'footer{padding:0 16px 24px;font-size:12px;color:#777;text-align:center}'
]

/* 分享链接指页面自身的地址,与站内 ?video=<hash_id> 的分享口径互不影响 */
const SHARE_SCRIPT = [
  '<script>',
  '  (function () {',
  '    var link = document.querySelector("[data-copy]")',
  '    if (!link) {',
  '      return',
  '    }',
  '    var tip = document.querySelector(".copy-tip")',
  '    var url = link.getAttribute("data-copy")',
  '    var timer = 0',
  '    function show(text) {',
  '      if (!tip) {',
  '        return',
  '      }',
  '      tip.textContent = text',
  '      tip.hidden = false',
  '      clearTimeout(timer)',
  '      timer = setTimeout(function () { tip.hidden = true }, 2000)',
  '    }',
  '    function fallback() {',
  '      var area = document.createElement("textarea")',
  '      area.value = url',
  '      document.body.appendChild(area)',
  '      area.select()',
  '      var copied = false',
  '      try { copied = document.execCommand("copy") } catch (error) { copied = false }',
  '      document.body.removeChild(area)',
  '      return copied',
  '    }',
  '    link.addEventListener("click", function (event) {',
  '      event.preventDefault()',
  '      if (navigator.clipboard && navigator.clipboard.writeText) {',
  '        navigator.clipboard.writeText(url).then(function () { show("已复制分享链接") }, function () { show(fallback() ? "已复制分享链接" : "复制失败,请手动复制地址栏") })',
  '        return',
  '      }',
  '      show(fallback() ? "已复制分享链接" : "复制失败,请手动复制地址栏")',
  '    })',
  '  })()',
  '</script>'
]

const { options, positionals, errors } = parseArgs(process.argv.slice(2), {
  flags: ['check'],
  values: ['single', 'out', 'manifest', 'his']
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

function isEntry(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
  /* 作者信息成块取出,名称与链接都限定在 author 对象内,避免误取同名字段 */
  const authorBlock = /\bauthor:\s*\{([\s\S]*?)\}/.exec(text)
  const authorText = authorBlock ? authorBlock[1] : ''
  const site = {
    title: readConstString(text, 'title'),
    subtitle: readConstString(text, 'subtitle'),
    description: readConstString(text, 'description'),
    siteUrl: readConstString(text, 'siteUrl'),
    videoBase: readConstString(text, 'video_oss_base_url'),
    coverDir: readConstString(text, 'video_cover_dir'),
    coverExtension: readConstString(text, 'video_cover_extension'),
    authorName: readConstString(authorText, 'name'),
    authorUrl: readConstString(authorText, 'url'),
    repositoryUrl: readConstString(text, 'repositoryUrl'),
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
  site.buildDate = versionToDate(site.version)
  if (site.copyrightYear === null) {
    site.copyrightYear = Number(site.buildDate.slice(0, 4))
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

/*
 * 页脚只放作者与仓库两个入口,站点名直接链到仓库,不再重复指向主页面
 * 主页面入口由正文底部那一条负责,避免同一目标在一个页面里出现两次
 */
function footerOf(site) {
  const items = [
    'Copyright © ' + site.copyrightYear + ' <a href="' + escapeHtml(site.authorUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(site.authorName) + '</a>',
    '<a href="' + escapeHtml(site.repositoryUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(site.title) + '</a>'
  ]
  return '<footer>' + items.join(' · ') + '</footer>'
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

/* 历史文件里的日期沿用版本号的 yyyy.MM.dd 书写,页面统一显示为 yyyy-MM-dd */
function isoDate(value) {
  return String(value).split('.').join('-')
}

/* 历史文件里每个 id 的登记日期,用作条目的更新日期 */
function idDateMap(hisValue, fallbackDate) {
  const dates = new Map()
  const entries = Array.isArray(hisValue && hisValue.total) ? hisValue.total : []
  for (const entry of entries) {
    if (!isEntry(entry)) {
      continue
    }
    for (const record of idRecordsOf(entry, fallbackDate)) {
      dates.set(record.id, isoDate(record.date))
    }
  }
  return dates
}

/* 已归档且当前清单里不存在的条目,地址仍然有效,内容换成下架提示 */
function archivedEntriesOf(hisValue, currentIds) {
  const archived = Array.isArray(hisValue && hisValue[ARCHIVED_FIELD]) ? hisValue[ARCHIVED_FIELD] : []
  return archived.filter((entry) => {
    if (!isEntry(entry)) {
      return false
    }
    const hashId = primaryHashId(entry)
    return hashId !== '' && !currentIds.has(hashId)
  })
}

function tagsOf(entry) {
  return Array.isArray(entry.tags) ? entry.tags : []
}

function tagsHtml(entry) {
  const tags = tagsOf(entry)
  if (tags.length === 0) {
    return ''
  }
  return '<ul class="tags">' + tags.map(tag => '<li>' + escapeHtml(tag) + '</li>').join('') + '</ul>'
}

/* 更新日期与构建日期相同时只显示更新日期,避免同一日期重复出现 */
function dateLineOf(updatedDate, buildDate) {
  return updatedDate === buildDate ? '更新 ' + updatedDate : '更新 ' + updatedDate + ' · 构建 ' + buildDate
}

function shareHtml(site, hashId) {
  const pageUrl = pageUrlOf(site, hashId)
  return [
    '<p class="actions">',
    '<a href="#" data-copy="' + escapeHtml(pageUrl) + '">复制分享链接</a>',
    '<span class="copy-tip" hidden></span>',
    '</p>'
  ]
}

function renderPage(entry, site, state) {
  const hashId = state.hashId
  const pageUrl = pageUrlOf(site, hashId)
  const coverFile = entry.filename + site.coverExtension
  const posterPath = '../../' + site.coverDir + encodeURIComponent(coverFile)
  const source = isNonEmptyString(entry.source) ? entry.source : ''
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: entry.title,
    description: entry.desc,
    thumbnailUrl: coverUrlOf(site, entry.filename),
    uploadDate: state.updatedDate,
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
    tagsHtml(entry),
    '<p class="meta">' + dateLineOf(state.updatedDate, site.buildDate) + ' · 作者 ' + escapeHtml(site.authorName) + '</p>',
    ...shareHtml(site, hashId),
    source === '' ? '' : '<p class="back"><a href="' + escapeHtml(source) + '" target="_blank" rel="noopener noreferrer">查看来源</a></p>',
    '<p class="back"><a href="../../?' + VIDEO_QUERY_PARAM + '=' + hashId + '">点击前往主页面获取最佳观看体验</a></p>',
    '</main>',
    footerOf(site),
    ...SHARE_SCRIPT,
    '</body>',
    '</html>'
  ]

  return lines.filter(line => line.length > 0).join('\n') + '\n'
}

/* 下架条目只保留历史信息,不再输出 video 元素与 VideoObject 结构化数据 */
function renderTombstone(entry, site, state) {
  const pageUrl = pageUrlOf(site, state.hashId)
  const removedDate = typeof entry[REMOVED_DATE_FIELD] === 'string' ? isoDate(entry[REMOVED_DATE_FIELD]) : ''
  const metaParts = []
  if (removedDate !== '') {
    metaParts.push('下架于 ' + removedDate)
  }
  metaParts.push('作者 ' + escapeHtml(site.authorName))
  const lines = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + escapeHtml(entry.title + ' - ' + site.subtitle) + '</title>',
    '<meta name="description" content="' + escapeHtml('这个视频已经下架,页面只保留历史记录') + '">',
    '<meta name="author" content="' + escapeHtml(site.authorName) + '">',
    '<meta name="robots" content="' + TOMBSTONE_ROBOTS + '">',
    '<link rel="canonical" href="' + escapeHtml(pageUrl) + '">',
    '<link rel="icon" href="../../favicon.svg" type="image/svg+xml">',
    '<meta property="og:type" content="article">',
    '<meta property="og:site_name" content="' + escapeHtml(site.title) + '">',
    '<meta property="og:title" content="' + escapeHtml(entry.title) + '">',
    '<meta property="og:description" content="' + escapeHtml('这个视频已经下架,页面只保留历史记录') + '">',
    '<meta property="og:url" content="' + escapeHtml(pageUrl) + '">',
    '<style>',
    ...PAGE_STYLES,
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<h1>' + escapeHtml(entry.title) + '</h1>',
    '<p class="notice">这个视频已经下架,不再提供播放。</p>',
    escapeHtml(entry.desc) === '' ? '' : '<p class="desc">' + escapeHtml(entry.desc) + '</p>',
    tagsHtml(entry),
    '<p class="meta">' + metaParts.join(' · ') + '</p>',
    '<p class="back"><a href="../../">回到主页面</a></p>',
    '</main>',
    footerOf(site),
    '</body>',
    '</html>'
  ]

  return lines.filter(line => line.length > 0).join('\n') + '\n'
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/* 站点地图只收当前条目与首页,更新日期沿用条目自己的登记日期,内容未变时不产生假的更新信号 */
function renderSitemap(site, rows) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
  for (const row of rows) {
    lines.push('  <url>')
    lines.push('    <loc>' + escapeXml(row.url) + '</loc>')
    lines.push('    <lastmod>' + row.lastmod + '</lastmod>')
    lines.push('  </url>')
  }
  lines.push('</urlset>')
  return lines.join('\n') + '\n'
}

/* 抓取规则与站点地图地址一起由构建期生成,站点绝对地址只维护在站点常量里 */
function renderRobots(site) {
  return [
    '# 站点地图由构建期生成,地址取自站点常量',
    'User-agent: *',
    'Allow: /',
    '',
    'Sitemap: ' + site.siteUrl + SITEMAP_FILE
  ].join('\n') + '\n'
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

  const entries = manifest.total.filter(isEntry)
  /* hash_id 首次分配后保持稳定,这里只要求存在,不再与条目内容比对 */
  const missingIds = entries.filter(entry => primaryHashId(entry) === '')
  if (missingIds.length > 0) {
    return fail('manifest', '条目缺少合法 hash_id,请先运行 node scripts/sort-video-manifest_tags.mjs', {
      manifest: manifestPath,
      entries: missingIds.slice(0, 10).map(entry => ({ filename: entry.filename, hashId: entry[HASH_ID_FIELD] }))
    })
  }

  const hisPath = options.his ? resolveFromCwd(options.his) : defaultHisPath(manifestPath)
  let hisDocument
  try {
    hisDocument = await readHisDocument(hisPath)
  } catch (error) {
    return fail('his', '历史文件读取失败: ' + error.message, { his: hisPath })
  }

  const hisDates = idDateMap(hisDocument.value, site.buildDate)
  const currentIds = new Set(entries.map(entry => primaryHashId(entry)))

  let selected = entries
  if (single !== null) {
    selected = entries.filter(entry => primaryHashId(entry) === single)
    if (selected.length === 0) {
      return fail('manifest', '清单中没有 hash_id 为 ' + single + ' 的条目', { manifest: manifestPath, single })
    }
  }

  const check = options.check === true
  const pages = []
  for (const entry of selected) {
    const hashId = primaryHashId(entry)
    const updatedDate = hisDates.get(hashId) || site.buildDate
    const directory = join(outDir, PAGE_DIR, hashId)
    const file = join(directory, PAGE_FILE)
    if (!check) {
      await mkdir(directory, { recursive: true })
      await writeFile(file, renderPage(entry, site, { hashId, updatedDate }), 'utf8')
    }
    pages.push({ hashId, title: entry.title, url: pageUrlOf(site, hashId), updatedDate, buildDate: site.buildDate, file })
  }

  /* 下架页只在全量模式下生成,单条模式只关心当前条目 */
  const tombstones = []
  if (single === null) {
    for (const entry of archivedEntriesOf(hisDocument.value, currentIds)) {
      const hashId = primaryHashId(entry)
      const directory = join(outDir, PAGE_DIR, hashId)
      const file = join(directory, PAGE_FILE)
      if (!check) {
        await mkdir(directory, { recursive: true })
        await writeFile(file, renderTombstone(entry, site, { hashId }), 'utf8')
      }
      tombstones.push({ hashId, title: entry.title, url: pageUrlOf(site, hashId), file })
    }
  }

  /* 单条模式不改写站点地图与抓取规则,避免用不完整的结果覆盖全量产物 */
  let sitemap = null
  let robots = null
  if (single === null) {
    const rows = [{ url: site.siteUrl, lastmod: site.buildDate }]
    for (const page of pages) {
      rows.push({ url: page.url, lastmod: page.updatedDate })
    }
    const sitemapFile = join(outDir, SITEMAP_FILE)
    const robotsFile = join(outDir, ROBOTS_FILE)
    if (!check) {
      await writeFile(sitemapFile, renderSitemap(site, rows), 'utf8')
      await writeFile(robotsFile, renderRobots(site), 'utf8')
    }
    sitemap = { file: sitemapFile, urlCount: rows.length }
    robots = { file: robotsFile, sitemapUrl: site.siteUrl + SITEMAP_FILE }
  }

  emitResult({
    ok: true,
    data: {
      out: outDir,
      manifest: manifestPath,
      his: hisPath,
      hisExists: hisDocument.exists,
      check,
      version: site.version,
      buildDate: site.buildDate,
      pageCount: pages.length,
      tombstoneCount: tombstones.length,
      pages,
      tombstones,
      sitemap,
      robots
    }
  })
}

main().catch(error => fail('write', '未预期错误: ' + error.message))
