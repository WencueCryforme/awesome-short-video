import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultHisPath } from '../lib/manifest-his.mjs'
import { PROJECT_ROOT, createFixture, makeEntry, makeManifest, readResult, runScript } from './helpers.mjs'

/* 登记日期取仓库根目录 VERSION 的值,与脚本读取口径一致 */
const VERSION = (await readFile(join(PROJECT_ROOT, 'VERSION'), 'utf8')).trim()

function run(args) {
  return runScript('try2-update-manifest-his.mjs', args)
}

function readHis(fixture) {
  return readFile(defaultHisPath(fixture.manifestPath), 'utf8').then(text => JSON.parse(text))
}

function writeHis(fixture, value) {
  return writeFile(defaultHisPath(fixture.manifestPath), JSON.stringify(value, null, 2) + '\n', 'utf8')
}

test('首次运行把清单登记为历史文件基线', async () => {
  const first = makeEntry({ filename: 'a.mp4' })
  const second = makeEntry({ title: '乙', desc: '乙的简介', filename: 'b.mp4', tags: ['本'] })
  const fixture = await createFixture({ manifest: makeManifest([first, second]), tags: ['爱', '本'] })

  const result = run(['--manifest', fixture.manifestPath])
  const payload = readResult(result)

  assert.equal(payload.ok, true)
  assert.equal(result.status, 0)
  assert.equal(payload.data.bootstrap, true)
  assert.equal(payload.data.report.registered.length, 2)

  const his = await readHis(fixture)
  assert.equal(his.total.length, 2)
  assert.deepEqual(his.total[0].hash_id, [{ id: first.hash_id, date: VERSION }])
  assert.deepEqual(his.archived, [])

  const checked = readResult(run(['--check', '--manifest', fixture.manifestPath]))
  assert.equal(checked.ok, true)
})

test('--check 在历史文件缺失时失败', async () => {
  const fixture = await createFixture({ manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]), tags: ['爱'] })

  const result = run(['--check', '--manifest', fixture.manifestPath])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'his')
  assert.match(payload.error.message, /历史文件缺失/)
})

test('清单出现无历史记录的新条目时先报冲突', async () => {
  const first = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([first]), tags: ['爱'] })
  run(['--manifest', fixture.manifestPath])

  const before = await readHis(fixture)
  const added = makeEntry({ title: '全新的标题', desc: '完全不同的简介内容', filename: 'brand-new.mp4', source: 'https://example.com/video/9', tags: ['本'] })
  await writeFile(fixture.manifestPath, JSON.stringify(makeManifest([first, added]), null, 4) + '\n', 'utf8')

  const payload = readResult(run(['--manifest', fixture.manifestPath]))
  assert.equal(payload.ok, false)
  assert.equal(payload.error.kind, 'conflict')
  assert.equal(payload.error.details.report.unmatchedNew.length, 1)
  assert.match(payload.error.message, /merge-into-manifest-his/)

  /* 冲突时历史文件保持原样 */
  assert.deepEqual(await readHis(fixture), before)
})

test('--accept-new 放行声明为新增的条目', async () => {
  const first = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([first]), tags: ['爱'] })
  run(['--manifest', fixture.manifestPath])

  const added = makeEntry({ title: '全新的标题', desc: '完全不同的简介内容', filename: 'brand-new.mp4', source: 'https://example.com/video/9', tags: ['本'] })
  await writeFile(fixture.manifestPath, JSON.stringify(makeManifest([first, added]), null, 4) + '\n', 'utf8')

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--accept-new', added.hash_id]))
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.data.report.registered, [added.hash_id])

  const his = await readHis(fixture)
  assert.equal(his.total.length, 2)
  const record = his.total.find(item => item.filename === added.filename)
  assert.deepEqual(record.hash_id, [{ id: added.hash_id, date: VERSION }])
})

test('条目内容变更后保留原登记日期', async () => {
  const entry = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([entry]), tags: ['爱'] })
  run(['--manifest', fixture.manifestPath])

  await writeHis(fixture, {
    desc: '',
    filesize: '',
    tags: './tags.json',
    total: [{ ...entry, hash_id: [{ id: entry.hash_id, date: '2026.09.01' }] }],
    archived: []
  })

  await writeFile(fixture.manifestPath, JSON.stringify(makeManifest([{ ...entry, title: '改过的标题' }]), null, 4) + '\n', 'utf8')

  const payload = readResult(run(['--manifest', fixture.manifestPath]))
  assert.equal(payload.ok, true)
  assert.equal(payload.data.report.matched, 1)

  const his = await readHis(fixture)
  assert.deepEqual(his.total[0].hash_id, [{ id: entry.hash_id, date: '2026.09.01' }])
})

test('清单删除条目时归档进历史文件', async () => {
  const first = makeEntry({ filename: 'a.mp4' })
  const second = makeEntry({ title: '乙', desc: '乙的简介', filename: 'b.mp4', tags: ['本'] })
  const fixture = await createFixture({ manifest: makeManifest([first, second]), tags: ['爱', '本'] })
  run(['--manifest', fixture.manifestPath])

  await writeFile(fixture.manifestPath, JSON.stringify(makeManifest([first]), null, 4) + '\n', 'utf8')

  const payload = readResult(run(['--manifest', fixture.manifestPath]))
  assert.equal(payload.ok, true)
  assert.equal(payload.data.report.archived.length, 1)

  const his = await readHis(fixture)
  assert.equal(his.total.length, 1)
  assert.equal(his.archived.length, 1)
  assert.equal(his.archived[0].filename, second.filename)
  assert.equal(his.archived[0].removedDate, VERSION)
  assert.deepEqual(his.archived[0].hash_id, [{ id: second.hash_id, date: VERSION }])
})

test('--check 在历史文件落后于清单时失败', async () => {
  const first = makeEntry({ filename: 'a.mp4' })
  const second = makeEntry({ title: '乙', desc: '乙的简介', filename: 'b.mp4', tags: ['本'] })
  const fixture = await createFixture({ manifest: makeManifest([first, second]), tags: ['爱', '本'] })
  run(['--manifest', fixture.manifestPath])

  await writeFile(fixture.manifestPath, JSON.stringify(makeManifest([first]), null, 4) + '\n', 'utf8')

  const result = run(['--check', '--manifest', fixture.manifestPath])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'his')
  assert.match(payload.error.message, /与清单不一致/)
})

test('清单条目缺少 hash_id 时失败', async () => {
  const { hash_id: ignored, ...withoutHash } = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([withoutHash]), tags: ['爱'] })

  const result = run(['--manifest', fixture.manifestPath])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'manifest')
  assert.match(payload.error.message, /sort-video-manifest_tags/)
})

test('--accept-new 取值不是 hash_id 时失败', async () => {
  const fixture = await createFixture({ manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]), tags: ['爱'] })

  const result = run(['--manifest', fixture.manifestPath, '--accept-new', 'not-a-hash'])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'args')
})
