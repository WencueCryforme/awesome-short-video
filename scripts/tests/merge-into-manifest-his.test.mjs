import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultHisPath } from '../lib/manifest-his.mjs'
import { PROJECT_ROOT, createFixture, makeEntry, makeManifest, readResult, runScript } from './helpers.mjs'

const VERSION = (await readFile(join(PROJECT_ROOT, 'VERSION'), 'utf8')).trim()

function run(args) {
  return runScript('merge-into-manifest-his.mjs', args)
}

function readHis(fixture) {
  return readFile(defaultHisPath(fixture.manifestPath), 'utf8').then(text => JSON.parse(text))
}

function writeHis(fixture, value) {
  return writeFile(defaultHisPath(fixture.manifestPath), JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function buildOldEntry() {
  return makeEntry({ title: '旧标题', desc: '旧的简介', filename: 'old-name.mp4', tags: ['爱'] })
}

/* 新条目与旧条目文件名和内容都不同,相似度低于阈值,自动配对判不出来 */
function buildNewEntry() {
  return makeEntry({
    title: '全新的标题',
    desc: '完全不同的简介内容用于拉开差距,长度也要足够长才能降低相似度',
    filename: 'brand-new.mp4',
    source: 'https://example.com/video/9',
    source_id: '9',
    tags: ['本']
  })
}

async function buildConflictFixture() {
  const oldEntry = buildOldEntry()
  const newEntry = buildNewEntry()
  const fixture = await createFixture({ manifest: makeManifest([newEntry]), tags: ['爱', '本'] })
  await writeHis(fixture, {
    desc: '',
    filesize: '',
    tags: './tags.json',
    total: [{ ...oldEntry, hash_id: [{ id: oldEntry.hash_id, date: '2026.09.01' }] }],
    archived: []
  })
  return { fixture, oldEntry, newEntry }
}

test('没有冲突时不给配对也成功', async () => {
  const entry = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([entry]), tags: ['爱'] })
  await writeHis(fixture, {
    desc: '',
    filesize: '',
    tags: './tags.json',
    total: [{ ...entry, hash_id: [{ id: entry.hash_id, date: '2026.09.01' }] }],
    archived: []
  })

  const payload = readResult(run(['--manifest', fixture.manifestPath]))

  assert.equal(payload.ok, true)
  assert.equal(payload.data.noop, true)
})

test('存在冲突且不给配对时失败并列出冲突', async () => {
  const { fixture } = await buildConflictFixture()

  const result = run(['--manifest', fixture.manifestPath])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'conflict')
  assert.equal(payload.error.details.conflicts.length, 1)
  assert.match(payload.error.message, /仍有 1 处冲突/)
})

test('--old none 声明新增条目后写盘', async () => {
  const { fixture, oldEntry, newEntry } = await buildConflictFixture()

  const payload = readResult(run(['--manifest', fixture.manifestPath, '--old', 'none', '--new', newEntry.hash_id]))
  assert.equal(payload.ok, true)

  const his = await readHis(fixture)
  const record = his.total.find(item => item.filename === newEntry.filename)
  assert.deepEqual(record.hash_id, [{ id: newEntry.hash_id, date: VERSION }])
  /* 未配对的旧条目按删除处理,归档留存 */
  assert.equal(his.archived.length, 1)
  assert.equal(his.archived[0].filename, oldEntry.filename)
})

test('--old 旧 id 与 --new 新 id 配对时沿用旧登记日期', async () => {
  const { fixture, oldEntry, newEntry } = await buildConflictFixture()

  const payload = readResult(run([
    '--manifest', fixture.manifestPath,
    '--old', oldEntry.hash_id, '--new', newEntry.hash_id
  ]))
  assert.equal(payload.ok, true)

  const his = await readHis(fixture)
  const record = his.total.find(item => item.filename === newEntry.filename)
  /* 旧 id 作为历史记录保留,新 id 追加在后,登记日期取本次版本号 */
  assert.deepEqual(record.hash_id, [
    { id: oldEntry.hash_id, date: '2026.09.01' },
    { id: newEntry.hash_id, date: VERSION }
  ])
  assert.equal(his.archived.length, 0)
})

test('--old 与 --new 数量不等时失败', async () => {
  const fixture = await createFixture({ manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]), tags: ['爱'] })

  const result = run(['--manifest', fixture.manifestPath, '--old', 'none'])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'args')
})

test('--new 指向清单外的 hash_id 时失败', async () => {
  const fixture = await createFixture({ manifest: makeManifest([makeEntry({ filename: 'a.mp4' })]), tags: ['爱'] })

  const result = run(['--manifest', fixture.manifestPath, '--old', 'none', '--new', '0123456789abcdef'])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'args')
  assert.match(payload.error.message, /清单里没有 hash_id 为 0123456789abcdef 的条目/)
})

test('--old 指向历史文件外的 hash_id 时失败', async () => {
  const entry = makeEntry({ filename: 'a.mp4' })
  const fixture = await createFixture({ manifest: makeManifest([entry]), tags: ['爱'] })
  await writeHis(fixture, { desc: '', filesize: '', tags: './tags.json', total: [], archived: [] })

  const result = run(['--manifest', fixture.manifestPath, '--old', '0123456789abcdef', '--new', entry.hash_id])
  const payload = readResult(result)

  assert.equal(payload.ok, false)
  assert.equal(result.status, 1)
  assert.equal(payload.error.kind, 'args')
  assert.match(payload.error.message, /历史文件里没有记录 hash_id 0123456789abcdef/)
})
