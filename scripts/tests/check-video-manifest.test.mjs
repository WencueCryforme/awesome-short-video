import test from 'node:test'
import assert from 'node:assert/strict'
import { countLines, createFixture, makeEntry, makeManifest, readResult, runScript } from './helpers.mjs'

function run(args) {
  return runScript('check-video-manifest.mjs', args)
}

test('一致清单返回成功结果且退出码为 0', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([
      makeEntry({ filename: 'a.mp4', tags: ['爱'] }),
      makeEntry({ title: '乙', filename: 'b.mp4', tags: ['本'] })
    ]),
    tags: ['爱', '本']
  })

  const result = run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath])
  const payload = readResult(result)

  assert.equal(payload.ok, true)
  assert.equal(result.status, 0)
  assert.equal(payload.data.checks.every(check => check.ok), true)
})

test('缺省输出为格式化的多行结果对象', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]),
    tags: ['爱']
  })

  const result = runScript(
    'check-video-manifest.mjs',
    ['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath],
    { inline: false }
  )
  const payload = readResult(result)

  assert.equal(countLines(result) > 1, true)
  assert.equal(result.stdout.includes('\n  "ok": true'), true)
  assert.equal(payload.ok, true)
})

test('带 --inline 时标准输出只有一行结果对象', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]),
    tags: ['爱']
  })

  const result = run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath])

  assert.equal(countLines(result), 1)
  assert.equal(readResult(result).ok, true)
})

test('清单缺少 filesize 字段时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })], { filesize: '' }),
    tags: ['爱']
  })

  const result = run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'manifest')
  assert.match(payload.error.message, /清单字段/)
})

test('条目使用预设外标签时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4', tags: ['未登记'] })]),
    tags: ['爱']
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /条目标签在预选项内/)
})

test('仅传 --manifest 时按相对路径解析标签文件', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]),
    tags: ['爱']
  })

  assert.equal(readResult(run(['--manifest', fixture.manifestPath])).ok, true)
})

test('同时传 --manifest 与 --tags 时不解析清单内标签路径', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })], { tags: './missing-tags.json' }),
    tags: ['爱']
  })

  assert.equal(readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath])).ok, true)
})

test('source_id 为空时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4', source_id: '' })]),
    tags: ['爱']
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /source_id 为空/)
})

test('条目缺少 hash_id 时失败', async () => {
  const { hash_id: ignored, ...withoutHash } = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({
    manifest: makeManifest([withoutHash]),
    tags: ['爱']
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /条目 hash_id/)
  assert.match(payload.error.message, /缺少 hash_id/)
})

test('条目 hash_id 与内容不一致时失败', async () => {
  const entry = makeEntry({ filename: 'a.mp4' })
  entry.hash_id = '0'.repeat(16)
  const fixture = await createFixture({
    manifest: makeManifest([entry]),
    tags: ['爱']
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /条目 hash_id/)
  assert.match(payload.error.message, /不一致/)
})

test('条目出现未知字段时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4', flag: 'none' })]),
    tags: ['爱']
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /存在未知字段/)
})

test('空模板字段与条目字段不一致时失败', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })], {
      blank: { title: '', desc: '', filename: '', source: '', tags: [] }
    }),
    tags: ['爱']
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /空模板字段/)
})

test('校验脚本不接受排序专用的 --check 选项', async () => {
  const fixture = await createFixture({
    manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]),
    tags: ['爱']
  })

  const payload = readResult(run(['--check', '--manifest', fixture.manifestPath, '--tags', fixture.tagsPath]))

  assert.equal(payload.ok, false)
  assert.match(payload.error.message, /未识别的选项: --check/)
})

test('未知选项输出失败结果并给出说明', async () => {
  const result = run(['--unknown'])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'manifest')
  assert.match(payload.error.message, /未识别的选项/)
})
