import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { computeHashId } from '../lib/hash-id.mjs'
import { countLines, createFixture, makeEntry, makeManifest, readResult, runScript } from './helpers.mjs'

function buildSortedFixture() {
  return createFixture({
    manifest: makeManifest([
      makeEntry({ title: '甲', filename: 'a.mp4', tags: ['本'] }),
      makeEntry({ title: '乙', filename: 'b.mp4', tags: ['爱'] }),
      makeEntry({ title: '丙', filename: 'c.mp4', tags: [] }),
      makeEntry({ title: '丁', filename: 'd.mp4', tags: ['爱'] })
    ]),
    tags: ['本', '啊', '爱']
  })
}

test('按拼音排序标签与条目并写回', async () => {
  const fixture = await buildSortedFixture()

  const result = runScript('sort-video-manifest_tags.mjs', [
    '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])
  const payload = readResult(result)
  assert.equal(payload.ok, true)
  assert.equal(result.status, 0)

  const tags = JSON.parse(await readFile(fixture.tagsPath, 'utf8'))
  assert.deepEqual(tags, ['啊', '爱', '本'])

  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8'))
  assert.deepEqual(manifest.total.map(entry => entry.title), ['丙', '丁', '乙', '甲'])
  assert.deepEqual(manifest.total.find(entry => entry.title === '甲').tags, ['本'])

  const rawManifest = await readFile(fixture.manifestPath, 'utf8')
  assert.equal(rawManifest.includes('"tags": ["本"]'), true)
})

test('标签文件保持零缩进逐行风格', async () => {
  const fixture = await buildSortedFixture()

  runScript('sort-video-manifest_tags.mjs', ['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath])

  const raw = await readFile(fixture.tagsPath, 'utf8')
  assert.equal(raw, '[\n"啊",\n"爱",\n"本"\n]\n')
})

test('缺省输出为格式化的多行结果对象', async () => {
  const fixture = await buildSortedFixture()

  const result = runScript(
    'sort-video-manifest_tags.mjs',
    ['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath],
    { inline: false }
  )

  assert.equal(countLines(result) > 1, true)
  assert.equal(readResult(result).ok, true)
})

test('带 --inline 时排序结果输出单行', async () => {
  const fixture = await buildSortedFixture()

  const result = runScript('sort-video-manifest_tags.mjs', [
    '--inline', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])

  assert.equal(countLines(result), 1)
  assert.equal(readResult(result).ok, true)
})

test('--check 对未排序文件失败且不改动原文件', async () => {
  const fixture = await buildSortedFixture()
  const manifestBefore = await readFile(fixture.manifestPath, 'utf8')
  const tagsBefore = await readFile(fixture.tagsPath, 'utf8')

  const result = runScript('sort-video-manifest_tags.mjs', [
    '--check', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.match(payload.error.message, /未按规范排序/)
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), manifestBefore)
  assert.equal(await readFile(fixture.tagsPath, 'utf8'), tagsBefore)

  const names = await readdir(fixture.dir)
  assert.equal(names.some(name => name.endsWith('.temp.json')), false)
})

test('--check 失败时返回失败结果且不改动原文件', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4', tags: ['未登记'] })]),
    tags: ['本', '爱']
  })
  const manifestBefore = await readFile(fixture.manifestPath, 'utf8')
  const tagsBefore = await readFile(fixture.tagsPath, 'utf8')

  const result = runScript('sort-video-manifest_tags.mjs', [
    '--check', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.match(payload.error.message, /原始文件校验失败/)
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), manifestBefore)
  assert.equal(await readFile(fixture.tagsPath, 'utf8'), tagsBefore)
})

test('--check 对已排序文件幂等', async () => {
  const fixture = await buildSortedFixture()
  const args = ['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]

  runScript('sort-video-manifest_tags.mjs', args)
  const firstManifest = await readFile(fixture.manifestPath, 'utf8')
  const firstTags = await readFile(fixture.tagsPath, 'utf8')

  const second = runScript('sort-video-manifest_tags.mjs', ['--check', ...args])
  assert.equal(readResult(second).ok, true)
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), firstManifest)
  assert.equal(await readFile(fixture.tagsPath, 'utf8'), firstTags)
})

test('排序结果可通过校验脚本', async () => {
  const fixture = await buildSortedFixture()

  runScript('sort-video-manifest_tags.mjs', ['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath])

  const result = runScript('check-video-manifest.mjs', [
    '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])
  assert.equal(readResult(result).ok, true)
})

test('排序结果按条目内容写入 hash_id', async () => {
  const fixture = await buildSortedFixture()
  const args = ['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]

  runScript('sort-video-manifest_tags.mjs', args)
  const first = JSON.parse(await readFile(fixture.manifestPath, 'utf8'))
  assert.equal(first.total.length, 4)
  for (const entry of first.total) {
    assert.equal(entry.hash_id, computeHashId(entry))
    assert.equal(entry.hash_id.length, 16)
  }

  /* 内容未变时重复排序不改变 hash_id */
  runScript('sort-video-manifest_tags.mjs', args)
  const second = JSON.parse(await readFile(fixture.manifestPath, 'utf8'))
  assert.deepEqual(second.total.map(entry => entry.hash_id), first.total.map(entry => entry.hash_id))
})
