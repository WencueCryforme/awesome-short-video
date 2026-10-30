import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECT_ROOT, readResult, runScript } from './helpers.mjs'

const TEMP_ROOT = join(PROJECT_ROOT, 'temp')
const VERSION = '2026.10.31'
const STALE_VERSION = '2026.10.30'

/* 夹具在进程退出时统一清理,避免在 temp 目录留下残留 */
const createdDirs = []
process.on('exit', () => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function badge(version) {
  return '[![Version](https://img.shields.io/badge/Version-' + version + '-00ee66)](https://github.com/WencueCryforme/awesome-short-video/tree/main)\n'
}

function constText(version) {
  return "export const SITE = {\n  title: 'fixture',\n  version: '" + version + "'\n} as const\n"
}

/*
 * 造一份与真实仓库同形的版本号副本,含 VERSION 文件与全部被同步目标
 * files 里给出的同路径内容整份覆盖默认值,用于制造漂移或异常
 */
async function createVersionFixture({ version = VERSION, files = {} } = {}) {
  mkdirSync(TEMP_ROOT, { recursive: true })
  const dir = await mkdtemp(join(TEMP_ROOT, 'version-test-'))
  createdDirs.push(dir)
  await mkdir(join(dir, 'site', 'app'), { recursive: true })

  const defaults = {
    /* 真实仓库的 VERSION 文件不带任何空白符,夹具保持一致 */
    VERSION: version,
    'package.json': JSON.stringify({ name: 'fixture', version, private: true, type: 'module' }, null, 2) + '\n',
    'site/package.json': JSON.stringify({ name: 'fixture-site', version }, null, 2) + '\n',
    'site/package-lock.json': JSON.stringify({
      name: 'fixture-site',
      version,
      lockfileVersion: 3,
      packages: { '': { name: 'fixture-site', version } }
    }, null, 2) + '\n',
    'site/app/const.ts': constText(version),
    'README.md': badge(version),
    'README_en-US.md': badge(version)
  }

  for (const [name, text] of Object.entries({ ...defaults, ...files })) {
    await writeFile(join(dir, name), text, 'utf8')
  }
  return dir
}

test('sync-version: 全部目标一致时 --check 通过', async () => {
  const dir = await createVersionFixture()
  const result = runScript('sync-version.mjs', ['--root', dir, '--check'])
  assert.equal(result.status, 0)

  const payload = readResult(result)
  assert.equal(payload.ok, true)
  assert.equal(payload.data.version, VERSION)
  assert.equal(payload.data.uploadDate, '2026-10-31')
  assert.equal(payload.data.check, true)
  assert.deepEqual(payload.data.changed, [])
  assert.equal(payload.data.files.length, 6)
  assert.ok(payload.data.files.every(file => file.status === 'ok'))
})

test('sync-version: 存在漂移时 --check 报错且不改动文件', async () => {
  const dir = await createVersionFixture({ files: { 'site/app/const.ts': constText(STALE_VERSION) } })
  const result = runScript('sync-version.mjs', ['--root', dir, '--check'])
  assert.equal(result.status, 1)

  const payload = readResult(result)
  assert.equal(payload.ok, false)
  assert.equal(payload.error.kind, 'version')
  assert.match(payload.error.message, /版本号不一致/)
  assert.deepEqual(payload.error.details.mismatches.map(item => item.path), ['site/app/const.ts'])
  assert.deepEqual(payload.error.details.mismatches[0].current, [STALE_VERSION])

  const text = await readFile(join(dir, 'site', 'app', 'const.ts'), 'utf8')
  assert.ok(text.includes(STALE_VERSION))
})

test('sync-version: 写模式把 VERSION 的值同步到全部目标', async () => {
  const dir = await createVersionFixture({
    files: {
      'site/app/const.ts': constText(STALE_VERSION),
      'README.md': badge(STALE_VERSION),
      'site/package-lock.json': JSON.stringify({
        name: 'fixture-site',
        version: STALE_VERSION,
        lockfileVersion: 3,
        packages: { '': { name: 'fixture-site', version: STALE_VERSION } }
      }, null, 2) + '\n'
    }
  })

  const result = runScript('sync-version.mjs', ['--root', dir])
  assert.equal(result.status, 0)

  const payload = readResult(result)
  assert.equal(payload.data.check, false)
  assert.deepEqual(payload.data.changed.sort(), ['README.md', 'site/app/const.ts', 'site/package-lock.json'])

  const constSource = await readFile(join(dir, 'site', 'app', 'const.ts'), 'utf8')
  assert.ok(constSource.includes("version: '" + VERSION + "'"))

  const readme = await readFile(join(dir, 'README.md'), 'utf8')
  assert.ok(readme.includes('Version-' + VERSION + '-00ee66'))

  const lock = JSON.parse(await readFile(join(dir, 'site', 'package-lock.json'), 'utf8'))
  assert.equal(lock.version, VERSION)
  assert.equal(lock.packages[''].version, VERSION)

  /* 重写后的 JSON 保持两空格缩进与末尾换行 */
  const lockText = await readFile(join(dir, 'site', 'package-lock.json'), 'utf8')
  assert.ok(lockText.endsWith('\n'))
  assert.ok(lockText.includes('\n  "version": "'))

  const recheck = runScript('sync-version.mjs', ['--root', dir, '--check'])
  assert.equal(recheck.status, 0)
})

test('sync-version: VERSION 格式不合规时报错', async () => {
  const dir = await createVersionFixture({ version: '2026.1.1' })
  const result = runScript('sync-version.mjs', ['--root', dir, '--check'])
  assert.equal(result.status, 1)

  const payload = readResult(result)
  assert.equal(payload.ok, false)
  assert.equal(payload.error.kind, 'version')
  assert.match(payload.error.message, /yyyy\.MM\.dd/)
})

test('sync-version: VERSION 缺失时报错', async () => {
  const dir = await createVersionFixture()
  rmSync(join(dir, 'VERSION'))

  const result = runScript('sync-version.mjs', ['--root', dir, '--check'])
  assert.equal(result.status, 1)

  const payload = readResult(result)
  assert.equal(payload.error.kind, 'version')
  assert.match(payload.error.message, /版本号文件缺失/)
})

test('sync-version: 锁定文件缺少包根条目时报错', async () => {
  const dir = await createVersionFixture({
    files: {
      'site/package-lock.json': JSON.stringify({ name: 'fixture-site', version: VERSION, lockfileVersion: 3, packages: {} }, null, 2) + '\n'
    }
  })

  const result = runScript('sync-version.mjs', ['--root', dir, '--check'])
  assert.equal(result.status, 1)

  const payload = readResult(result)
  assert.equal(payload.error.kind, 'file')
  assert.match(payload.error.message, /缺少版本号字段/)
})

test('sync-version: 仓库 VERSION 文件不含空白符', async () => {
  const text = await readFile(join(PROJECT_ROOT, 'VERSION'), 'utf8')

  assert.match(text, /^\d{4}\.\d{2}\.\d{2}$/)
})

test('sync-version: 未知位置参数报错', async () => {
  const result = runScript('sync-version.mjs', ['whatever', '--inline'])
  assert.equal(result.status, 1)

  const payload = readResult(result)
  assert.equal(payload.error.kind, 'args')
})
