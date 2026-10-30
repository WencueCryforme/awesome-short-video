import { mkdtemp, writeFile } from 'node:fs/promises'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runChildScript } from '../lib/child.mjs'
import { withHashId } from '../lib/hash-id.mjs'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const TEMP_ROOT = join(PROJECT_ROOT, 'temp')

/* 测试夹具在进程退出时统一清理,避免在 temp 目录留下残留 */
const createdDirs = []
process.on('exit', () => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* 夹具条目按真实清单的形态带上由内容算出的 hash_id */
export function makeEntry(overrides = {}) {
  return withHashId({
    title: '默认标题',
    desc: '默认简介',
    filename: 'default.mp4',
    source: 'https://example.com/video/1',
    tags: ['爱'],
    ...overrides
  })
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

/*
 * 与脚本调用共用一套子进程执行逻辑,测试只关心标准输出与退出码
 * options.inline 缺省为 true,需要观察缺省格式化输出时传 { inline: false }
 */
export function runScript(scriptName, args, options = {}) {
  const result = runChildScript(join(PROJECT_ROOT, 'scripts', scriptName), args, options)
  return { stdout: result.stdout, stderr: result.stderr, status: result.status, error: result.spawnError }
}

/* 标准输出整段就是一个结果对象,格式化与单行两种形态都能解析 */
export function readResult(result) {
  return JSON.parse((result.stdout || '').trim())
}

/* 标准输出的行数,用于区分格式化输出与单行输出 */
export function countLines(result) {
  return (result.stdout || '').trim().split(/\r?\n/).filter(Boolean).length
}
