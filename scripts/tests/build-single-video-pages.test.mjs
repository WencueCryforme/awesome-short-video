import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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

test('清单 hash_id 与内容不一致时失败', async () => {
  const entry = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([{ ...entry, title: '改过的标题' }]), tags: ['爱'] })

  const result = run(['--manifest', fixture.manifestPath, '--out', fixture.dir])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'manifest')
  assert.match(payload.error.message, /hash_id/)
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
})
