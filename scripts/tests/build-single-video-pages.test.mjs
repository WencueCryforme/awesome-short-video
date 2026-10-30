import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defaultHisPath } from '../lib/manifest-his.mjs'
import { countLines, createFixture, makeEntry, makeManifest, readResult, runScript } from './helpers.mjs'

/* 页面标题后缀取自 site/app/const.ts 的副标题 */
const SUBTITLE = '精选短视频'

function run(args) {
  return runScript('build-single-video-pages.mjs', args)
}

function readFileText(path) {
  return readFile(path, 'utf8')
}

function pagePath(fixture, entry) {
  return join(fixture.dir, 'video', entry.hash_id, 'index.html')
}

test('全量生成写入每条页面的独立目录与站点地图', async () => {
  const first = makeEntry({ filename: '中文 名.mp4', tags: ['爱', '本'] })
  const second = makeEntry({ title: '乙', desc: '乙的简介', filename: 'b.mp4', tags: ['本'] })
  const fixture = await createFixture({ manifest: makeManifest([first, second]), tags: ['爱', '本'] })

  const result = run(['--manifest', fixture.manifestPath, '--out', fixture.dir])
  const payload = readResult(result)

  assert.equal(payload.ok, true)
  assert.equal(result.status, 0)
  assert.equal(payload.data.pageCount, 2)
  assert.equal(countLines(result), 1)
  assert.equal(existsSync(pagePath(fixture, first)), true)

  const html = await readFileText(pagePath(fixture, first))
  assert.equal(html.includes('<title>' + first.title + ' - ' + SUBTITLE + '</title>'), true)
  assert.match(html, /<link rel="canonical" href="https:[^"]+\/video\/[0-9a-f]{16}\/">/)
  assert.match(html, /<video [^>]+preload="none"/)
  assert.match(html, /poster="\.\.\/\.\.\/cover\//)
  assert.equal(html.includes(encodeURIComponent(first.filename)), true)
  assert.equal(html.includes('?' + 'video=' + first.hash_id), true)

  const sitemap = await readFileText(join(fixture.dir, 'sitemap.xml'))
  assert.equal((sitemap.match(/<loc>/g) || []).length, 3)

  /* 抓取规则与站点地图同时生成,地址取自站点常量的绝对地址 */
  const canonical = /<link rel="canonical" href="(https:[^"]+)\/video\//.exec(html)[1] + '/'
  const robots = await readFileText(join(fixture.dir, 'robots.txt'))
  assert.equal(robots.includes('User-agent: *'), true)
  assert.equal(robots.includes('Allow: /'), true)
  assert.equal(robots.includes('Sitemap: ' + canonical + 'sitemap.xml'), true)
  assert.equal(payload.data.robots.sitemapUrl, canonical + 'sitemap.xml')
})

test('页面内嵌 VideoObject 结构化数据', async () => {
  const entry = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([entry]), tags: ['爱'] })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--out', fixture.dir]))
  assert.equal(payload.ok, true)

  const html = await readFileText(pagePath(fixture, entry))
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)
  assert.notEqual(match, null)

  const data = JSON.parse(match[1])
  assert.equal(data['@type'], 'VideoObject')
  assert.equal(data.name, entry.title)
  assert.match(data.uploadDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(data.thumbnailUrl, /^https:\/\/[^\s"]+\/cover\//)
  assert.match(data.contentUrl, /^https:\/\/[^\s"]+\/file\//)
})

test('--single 只生成指定页面且不改写站点地图', async () => {
  const first = makeEntry({ filename: 'a.mp4' })
  const second = makeEntry({ title: '乙', desc: '乙的简介', filename: 'b.mp4', tags: ['本'] })
  const fixture = await createFixture({ manifest: makeManifest([first, second]), tags: ['爱', '本'] })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--out', fixture.dir, '--single', second.hash_id]))

  assert.equal(payload.ok, true)
  assert.equal(payload.data.pageCount, 1)
  assert.equal(payload.data.sitemap, null)
  assert.equal(existsSync(pagePath(fixture, second)), true)
  assert.equal(existsSync(pagePath(fixture, first)), false)
  assert.equal(existsSync(join(fixture.dir, 'sitemap.xml')), false)
  assert.equal(existsSync(join(fixture.dir, 'robots.txt')), false)
  assert.equal(payload.data.robots, null)
})

test('--single 取值不是 hash_id 时失败', async () => {
  const fixture = await createFixture({ manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]), tags: ['爱'] })

  const result = run(['--manifest', fixture.manifestPath, '--out', fixture.dir, '--single', '../escape'])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'args')
})

test('--single 指向不存在的条目时失败', async () => {
  const fixture = await createFixture({ manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]), tags: ['爱'] })

  const result = run(['--manifest', fixture.manifestPath, '--out', fixture.dir, '--single', '0123456789abcdef'])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'manifest')
})

test('产物目录不存在时失败并提示先生成站点', async () => {
  const fixture = await createFixture({ manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]), tags: ['爱'] })
  const missing = join(fixture.dir, 'missing')

  const result = run(['--manifest', fixture.manifestPath, '--out', missing])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'output')
  assert.match(payload.error.message, /npm run generate/)
  assert.equal(existsSync(missing), false)
})

test('条目内容变更后仍按首次分配的 hash_id 生成页面', async () => {
  const entry = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([{ ...entry, title: '改过的标题' }]), tags: ['爱'] })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--out', fixture.dir]))

  assert.equal(payload.ok, true)
  assert.equal(payload.data.hisExists, false)
  assert.equal(payload.data.pages[0].hashId, entry.hash_id)
  assert.equal(existsSync(pagePath(fixture, entry)), true)
})

test('条目缺少合法 hash_id 时失败', async () => {
  const { hash_id: ignored, ...withoutHash } = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([withoutHash]), tags: ['爱'] })

  const result = run(['--manifest', fixture.manifestPath, '--out', fixture.dir])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'manifest')
  assert.match(payload.error.message, /sort-video-manifest_tags/)
})

test('历史文件登记更新日期时页面同时展示更新与构建日期', async () => {
  const entry = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([entry]), tags: ['爱'] })
  const hisPath = defaultHisPath(fixture.manifestPath)
  const archivedEntry = { ...makeEntry({ title: '下架视频', filename: 'gone.mp4', tags: ['爱'] }), hash_id: [{ id: 'ffffffffffffffff', date: '2026-09-01' }] }
  await writeFile(hisPath, JSON.stringify({
    desc: '',
    filesize: '',
    tags: './tags.json',
    total: [{ ...entry, hash_id: [{ id: entry.hash_id, date: '2026.09.01' }] }],
    archived: [{ ...archivedEntry, removedDate: '2026.09.02' }]
  }), 'utf8')

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--out', fixture.dir]))
  assert.equal(payload.ok, true)
  assert.equal(payload.data.hisExists, true)
  assert.equal(payload.data.pageCount, 1)
  assert.equal(payload.data.tombstoneCount, 1)
  assert.equal(payload.data.pages[0].updatedDate, '2026-09-01')

  const html = await readFileText(pagePath(fixture, entry))
  assert.equal(html.includes('更新 2026-09-01'), true)
  assert.equal(html.includes('构建 ' + payload.data.buildDate), true)

  const data = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1])
  assert.equal(data.uploadDate, '2026-09-01')

  /* 站点地图只收现行条目,首页与视频页共两条 */
  const sitemap = await readFileText(join(fixture.dir, 'sitemap.xml'))
  assert.equal((sitemap.match(/<loc>/g) || []).length, 2)
  assert.equal(sitemap.includes('ffffffffffffffff'), false)
})

test('历史文件里的归档条目生成下架提示页', async () => {
  const entry = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([entry]), tags: ['爱'] })
  const archivedEntry = { ...makeEntry({ title: '下架视频', desc: '已经删除的视频', filename: 'gone.mp4', tags: ['爱'] }), hash_id: [{ id: 'ffffffffffffffff', date: '2026-09-01' }] }
  await writeFile(defaultHisPath(fixture.manifestPath), JSON.stringify({
    total: [{ ...entry, hash_id: [{ id: entry.hash_id, date: '2026.10.31' }] }],
    archived: [{ ...archivedEntry, removedDate: '2026.09.02' }]
  }), 'utf8')

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--out', fixture.dir]))
  assert.equal(payload.ok, true)
  assert.equal(payload.data.tombstones.length, 1)

  const html = await readFileText(join(fixture.dir, 'video', 'ffffffffffffffff', 'index.html'))
  assert.equal(html.includes('这个视频已经下架'), true)
  assert.equal(html.includes('<video'), false)
  assert.equal(html.includes('VideoObject'), false)
  assert.match(html, /content="noindex, follow"/)
  assert.equal(html.includes('2026-09-02'), true)
})

test('页脚作者与仓库链接取自站点常量', async () => {
  const entry = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([entry]), tags: ['爱'] })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--out', fixture.dir]))
  assert.equal(payload.ok, true)

  const html = await readFileText(pagePath(fixture, entry))
  const footer = /<footer>([\s\S]*?)<\/footer>/.exec(html)
  assert.notEqual(footer, null)
  /* 版权文案与站内统一为 Copyright © 年份 作者,作者链接取 author 对象内的 url,站点名直接指向 repositoryUrl */
  assert.match(footer[1], /^Copyright © 2026 <a href="/)
  assert.match(footer[1], /<a href="https:\/\/github\.com\/WencueCryforme" target="_blank" rel="noopener noreferrer">WencueCryforme<\/a>/)
  assert.match(footer[1], /<a href="https:\/\/github\.com\/WencueCryforme\/awesome-short-video" target="_blank" rel="noopener noreferrer">awesome-short-video<\/a>/)
  assert.equal(footer[1].includes('GitHub 仓库'), false)
  /* 主页面入口只由正文那一条负责,页脚不再重复 */
  assert.equal(footer[1].includes('href="../../"'), false)
})

test('页面包含来源链接与分享按钮', async () => {
  const entry = makeEntry({ filename: 'a.mp4', source: 'https://www.douyin.com/video/766411867186713260' })
  const fixture = await createFixture({ manifest: makeManifest([entry]), tags: ['爱'] })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--out', fixture.dir]))
  assert.equal(payload.ok, true)

  const html = await readFileText(pagePath(fixture, entry))
  assert.match(html, /<a href="https:\/\/www\.douyin\.com\/video\/766411867186713260" target="_blank" rel="noopener noreferrer">查看来源<\/a>/)
  assert.equal(html.includes('data-copy="https'), true)
  assert.equal(html.includes('navigator.clipboard'), true)
})

test('--check 只校验不写文件', async () => {
  const entry = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([entry]), tags: ['爱'] })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--out', fixture.dir, '--check']))

  assert.equal(payload.ok, true)
  assert.equal(payload.data.check, true)
  assert.equal(payload.data.pageCount, 1)
  assert.equal(existsSync(pagePath(fixture, entry)), false)
  assert.equal(existsSync(join(fixture.dir, 'sitemap.xml')), false)
  assert.equal(existsSync(join(fixture.dir, 'robots.txt')), false)
})
