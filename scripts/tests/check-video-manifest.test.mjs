import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createFixture, makeEntry, makeManifest, readBoolean, runScript } from './helpers.mjs'

test('一致清单输出 true 且退出码为 0', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([
      makeEntry({ filename: 'a.mp4', tags: ['爱'] }),
      makeEntry({ title: '乙', filename: 'b.mp4', tags: ['本'] })
    ]),
    tags: ['爱', '本'],
    files: ['a.mp4', 'b.mp4']
  })

  const result = runScript('check-video-manifest.mjs', [
    '--bool', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])

  assert.equal(result.stdout.trim(), 'true')
  assert.equal(result.status, 0)
})

test('--bool 只输出一行布尔值', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]),
    tags: ['爱'],
    files: ['a.mp4']
  })

  const result = runScript('check-video-manifest.mjs', [
    '--bool', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])
  const lines = result.stdout.trim().split(/\r?\n/)

  assert.equal(lines.length, 1)
  assert.equal(lines[0], 'true')
})

test('缺少视频文件时调试信息与 false', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'missing.mp4' })]),
    tags: ['爱']
  })

  const result = runScript('check-video-manifest.mjs', [
    '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])
  const lines = result.stdout.trim().split(/\r?\n/)
  assert.equal(lines[lines.length - 1], 'false')
  assert.equal(result.status, 1)

  const report = JSON.parse(lines.slice(0, -1).join('\n'))
  assert.equal(report.ok, false)
  const missingCheck = report.checks.find(check => check.name === '普通条目文件存在')
  assert.equal(missingCheck.ok, false)
  assert.deepEqual(missingCheck.details, ['missing.mp4'])
})

test('入库目录存在清单外文件时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]),
    tags: ['爱'],
    files: ['a.mp4', 'extra.mp4']
  })

  const result = runScript('check-video-manifest.mjs', [
    '--bool', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])

  assert.equal(result.stdout.trim(), 'false')
  assert.equal(result.status, 1)
})

test('过大条目出现在入库目录时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([
      makeEntry({ filename: 'big.mp4', flag: 'THE_FILE_SIZE_IS_TOO_LARGE' })
    ]),
    tags: ['爱'],
    files: ['big.mp4']
  })

  const result = runScript('check-video-manifest.mjs', [
    '--bool', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])

  assert.equal(result.stdout.trim(), 'false')
})

test('条目使用预设外标签时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4', tags: ['未登记'] })]),
    tags: ['爱'],
    files: ['a.mp4']
  })

  const result = runScript('check-video-manifest.mjs', [
    '--bool', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])

  assert.equal(result.stdout.trim(), 'false')
})

test('仅传 --manifest 时按相对路径解析标签文件', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]),
    tags: ['爱'],
    files: ['a.mp4']
  })

  const result = runScript('check-video-manifest.mjs', [
    '--bool', '--manifest', fixture.manifestPath
  ])

  assert.equal(result.stdout.trim(), 'true')
})

test('同时传 --manifest 与 --tags 时不解析清单内标签路径', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })], { tags: './missing-tags.json' }),
    tags: ['爱'],
    files: ['a.mp4']
  })

  const result = runScript('check-video-manifest.mjs', [
    '--bool', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])

  assert.equal(result.stdout.trim(), 'true')
})

test('source_id 为空时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4', source_id: '' })]),
    tags: ['爱'],
    files: ['a.mp4']
  })

  const result = runScript('check-video-manifest.mjs', [
    '--bool', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])

  assert.equal(result.stdout.trim(), 'false')
})

test('allow_iframe 非布尔值时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4', allow_iframe: 'yes' })]),
    tags: ['爱'],
    files: ['a.mp4']
  })

  const result = runScript('check-video-manifest.mjs', [
    '--bool', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])

  assert.equal(result.stdout.trim(), 'false')
})

test('default_mode 取值非法时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4', default_mode: 'cloud' })]),
    tags: ['爱'],
    files: ['a.mp4']
  })

  const result = runScript('check-video-manifest.mjs', [
    '--bool', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath
  ])

  assert.equal(result.stdout.trim(), 'false')
})

test('未知选项输出 false 并给出调试信息', async () => {
  const result = runScript('check-video-manifest.mjs', ['--unknown'])
  const lines = result.stdout.trim().split(/\r?\n/)

  assert.equal(lines[lines.length - 1], 'false')
  assert.equal(result.status, 1)
  assert.match(lines.slice(0, -1).join('\n'), /未识别的选项/)
})
