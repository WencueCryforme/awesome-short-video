import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const TEMP_ROOT = join(PROJECT_ROOT, 'temp')

/* 测试夹具在进程退出时统一清理,避免在 temp 目录留下残留 */
const createdDirs = []
process.on('exit', () => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

export function makeEntry(overrides = {}) {
  return {
    title: '默认标题',
    desc: '默认简介',
    filename: 'default.mp4',
    source: 'https://example.com/video/1',
    tags: ['爱'],
    ...overrides
  }
}

/* 空模板与 video/manifest.json 的 blank 保持一致,含除 flag 外的全部条目字段 */
export function makeManifest(total, overrides = {}) {
  return {
    desc: '测试清单',
    filepath: './file',
    filesize: '<=25MB',
    tags: './tags.json',
    blank: {
      title: '',
      desc: '',
      filename: '',
      source: '',
      source_id: '',
      allow_iframe: true,
      default_mode: '',
      tags: []
    },
    total,
    ...overrides
  }
}

export async function createFixture(options) {
  const {
    manifest = null,
    tags = [],
    files = [],
    tooLargeFiles = []
  } = options

  await mkdir(TEMP_ROOT, { recursive: true })
  const dir = await mkdtemp(join(TEMP_ROOT, 'manifest-test-'))
  createdDirs.push(dir)
  const videoDir = join(dir, 'file')
  const tooLargeDir = join(dir, 'THE_FILE_SIZE_IS_TOO_LARGE')
  await mkdir(videoDir, { recursive: true })

  for (const name of files) {
    await writeFile(join(videoDir, name), 'video-bytes', 'utf8')
  }

  if (tooLargeFiles.length > 0) {
    await mkdir(tooLargeDir, { recursive: true })
    for (const name of tooLargeFiles) {
      await writeFile(join(tooLargeDir, name), 'large-video-bytes', 'utf8')
    }
  }

  const manifestPath = join(dir, 'manifest.json')
  const tagsPath = join(dir, 'tags.json')

  if (manifest) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 4) + '\n', 'utf8')
  }
  if (tags.length > 0) {
    const tagText = '[' + tags.map(tag => JSON.stringify(tag)).join(',\n') + '\n]\n'
    await writeFile(tagsPath, tagText, 'utf8')
  }

  return {
    dir,
    manifestPath,
    tagsPath,
    videoDir,
    tooLargeDir
  }
}

/* 子进程输出写入文件,避免依赖管道,兼容受限执行环境 */
export function runScript(scriptName, args) {
  mkdirSync(TEMP_ROOT, { recursive: true })
  const token = randomUUID()
  const outPath = join(TEMP_ROOT, 'run-' + token + '.out')
  const errPath = join(TEMP_ROOT, 'run-' + token + '.err')
  const outFd = openSync(outPath, 'w')
  const errFd = openSync(errPath, 'w')

  let result
  try {
    result = spawnSync(process.execPath, [join(PROJECT_ROOT, 'scripts', scriptName), ...args], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', outFd, errFd]
    })
  } finally {
    closeSync(outFd)
    closeSync(errFd)
  }

  const stdout = readFileSync(outPath, 'utf8')
  const stderr = readFileSync(errPath, 'utf8')
  rmSync(outPath, { force: true })
  rmSync(errPath, { force: true })

  return { stdout, stderr, status: result.status, error: result.error }
}

/* 标准输出有且只有一行结果对象,测试统一从该行取结果 */
export function readResult(result) {
  const lines = (result.stdout || '').trim().split(/\r?\n/).filter(Boolean)
  if (lines.length !== 1) {
    throw new Error('标准输出应当只有一行,实际为 ' + lines.length + ' 行: ' + result.stdout)
  }
  return JSON.parse(lines[0])
}
