import { mkdtemp, writeFile } from 'node:fs/promises'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runChildScript } from '../lib/child.mjs'

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

/* 空模板与 video/manifest.json 的 blank 保持一致 */
export function makeManifest(total, overrides = {}) {
  return {
    desc: '测试清单',
    filesize: '<=25MB',
    tags: './tags.json',
    blank: {
      title: '',
      desc: '',
      filename: '',
      source: '',
      source_id: '',
      tags: []
    },
    total,
    ...overrides
  }
}

export async function createFixture(options) {
  const { manifest = null, tags = [] } = options

  mkdirSync(TEMP_ROOT, { recursive: true })
  const dir = await mkdtemp(join(TEMP_ROOT, 'manifest-test-'))
  createdDirs.push(dir)

  const manifestPath = join(dir, 'manifest.json')
  const tagsPath = join(dir, 'tags.json')

  if (manifest) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 4) + '\n', 'utf8')
  }
  if (tags.length > 0) {
    const tagText = '[' + tags.map(tag => JSON.stringify(tag)).join(',\n') + '\n]\n'
    await writeFile(tagsPath, tagText, 'utf8')
  }

  return { dir, manifestPath, tagsPath }
}

/* 与脚本调用共用一套子进程执行逻辑,测试只关心标准输出与退出码 */
export function runScript(scriptName, args) {
  const result = runChildScript(join(PROJECT_ROOT, 'scripts', scriptName), args)
  return { stdout: result.stdout, stderr: result.stderr, status: result.status, error: result.spawnError }
}

/* 标准输出有且只有一行结果对象,测试统一从该行取结果 */
export function readResult(result) {
  const lines = (result.stdout || '').trim().split(/\r?\n/).filter(Boolean)
  if (lines.length !== 1) {
    throw new Error('标准输出应当只有一行,实际为 ' + lines.length + ' 行: ' + result.stdout)
  }
  return JSON.parse(lines[0])
}
