import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixture, makeEntry, makeManifest, readResult, runScript } from './helpers.mjs'

function run(args) {
  return runScript('check-video-manifest.mjs', args)
}

test('一致清单返回成功结果且退出码为 0', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([
      makeEntry({ filename: 'a.mp4', tags: ['爱'] }),
      makeEntry({ title: '乙', filename: 'b.mp4', tags: ['本'] })
    ]),
    tags: ['爱', '本'],
    files: ['a.mp4', 'b.mp4']
  })

  const result = run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath])
  const payload = readResult(result)

  assert.equal(payload.ok, true)
  assert.equal(result.status, 0)
  assert.equal(payload.data.checks.every(check => check.ok), true)
})

test('标准输出有且只有一行结果对象', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]),
    tags: ['爱'],
    files: ['a.mp4']
  })

  const result = run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath])

  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1)
})

test('缺少视频文件时失败并给出缺失项', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'missing.mp4' })]),
    tags: ['爱']
  })

  const result = run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'manifest')
  assert.match(payload.error.message, /普通条目文件存在/)
  const missing = payload.error.details.checks.find(check => check.name === '普通条目文件存在')
  assert.deepEqual(missing.details, ['missing.mp4'])
})

test('入库目录存在清单外文件时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]),
    tags: ['爱'],
    files: ['a.mp4', 'extra.mp4']
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /无清单外文件/)
})

test('过大条目出现在入库目录时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([
      makeEntry({ filename: 'big.mp4', flag: 'THE_FILE_SIZE_IS_TOO_LARGE' })
    ]),
    tags: ['爱'],
    files: ['big.mp4']
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /过大条目未入库/)
})

test('条目使用预设外标签时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4', tags: ['未登记'] })]),
    tags: ['爱'],
    files: ['a.mp4']
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /条目标签在预选项内/)
})

test('仅传 --manifest 时按相对路径解析标签文件', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]),
    tags: ['爱'],
    files: ['a.mp4']
  })

  assert.equal(readResult(run(['--manifest', fixture.manifestPath])).ok, true)
})

test('同时传 --manifest 与 --tags 时不解析清单内标签路径', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })], { tags: './missing-tags.json' }),
    tags: ['爱'],
    files: ['a.mp4']
  })

  assert.equal(readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath])).ok, true)
})

test('source_id 为空时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4', source_id: '' })]),
    tags: ['爱'],
    files: ['a.mp4']
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /source_id 为空/)
})

test('allow_iframe 非布尔值时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4', allow_iframe: 'yes' })]),
    tags: ['爱'],
    files: ['a.mp4']
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /allow_iframe 不是布尔值/)
})

test('default_mode 取值非法时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4', default_mode: 'cloud' })]),
    tags: ['爱'],
    files: ['a.mp4']
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /default_mode 取值非法/)
})

test('未知选项输出失败结果并给出说明', async () => {
  const result = run(['--unknown'])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'manifest')
  assert.match(payload.error.message, /未识别的选项/)
})
