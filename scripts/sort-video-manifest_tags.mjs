import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MANIFEST, PROJECT_ROOT, parseArgs, resolveSourcePaths } from './lib/cli.mjs'
import { readJsonDocument, writeJsonDocument } from './lib/json-style.mjs'
import { compareEntries, sortByPinyin } from './lib/pinyin-sort.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const CHECK_SCRIPT = resolve(dirname(SCRIPT_PATH), 'check-video-manifest.mjs')
const { options, errors } = parseArgs(process.argv.slice(2))
const steps = []

function emit(ok, silent) {
  if (!options.mute && !silent) {
    console.log(JSON.stringify({ ok, steps }, null, 2))
  }
  console.log(ok ? 'true' : 'false')
  process.exitCode = ok ? 0 : 1
}

/* 捕获子进程最后一行输出作为布尔判定,输出走文件避免依赖管道 */
async function runChild(script, args) {
  const tempRoot = join(PROJECT_ROOT, 'temp')
  await mkdir(tempRoot, { recursive: true })
  const token = randomUUID()
  const outPath = join(tempRoot, 'child-' + token + '.out')
  const errPath = join(tempRoot, 'child-' + token + '.err')
  const outFd = openSync(outPath, 'w')
  const errFd = openSync(errPath, 'w')

  let result
  try {
    result = spawnSync(process.execPath, [script, ...args], {
      cwd: process.cwd(),
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

  if (result.error) {
    return { ok: false, message: result.error.message }
  }
  const lines = (stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const last = lines.length > 0 ? lines[lines.length - 1] : ''
  return { ok: last === 'true', status: result.status, last, stderr }
}

async function sortDocuments(manifestPath, tagsPath) {
  const tagsDocument = await readJsonDocument(tagsPath)
  const manifestDocument = await readJsonDocument(manifestPath)

  if (!Array.isArray(tagsDocument.value)) {
    throw new Error('标签文件顶层必须是数组')
  }
  if (!manifestDocument.value || !Array.isArray(manifestDocument.value.total)) {
    throw new Error('清单缺少 total 数组')
  }

  const sortedTags = sortByPinyin(tagsDocument.value)
  const sortedTotal = manifestDocument.value.total
    .map((entry) => {
      const tags = Array.isArray(entry.tags) ? sortByPinyin(entry.tags) : []
      return { ...entry, tags }
    })
    .sort(compareEntries)

  const nextManifest = { ...manifestDocument.value, total: sortedTotal }

  await writeJsonDocument(tagsPath, sortedTags, tagsDocument.style)
  await writeJsonDocument(manifestPath, nextManifest, manifestDocument.style, { inlineTags: true })

  return {
    tagCount: sortedTags.length,
    entryCount: sortedTotal.length
  }
}

function tempPathFor(filePath) {
  return join(dirname(filePath), basename(filePath, '.json') + '.temp.json')
}

async function removeQuietly(filePath) {
  try {
    await unlink(filePath)
  } catch {
    /* 临时文件不存在时无需处理 */
  }
}

async function runCheckMode(manifestPath, tagsPath) {
  const original = await runChild(CHECK_SCRIPT, ['--bool', '--manifest', manifestPath, '--tags', tagsPath])
  if (!original.ok) {
    emit(false, true)
    return
  }
  steps.push({ action: '原始文件校验', ok: true })

  const tempManifest = tempPathFor(manifestPath)
  const tempTags = tempPathFor(tagsPath)

  try {
    await copyFile(manifestPath, tempManifest)
    await copyFile(tagsPath, tempTags)
    steps.push({ action: '生成临时副本', ok: true, files: [tempManifest, tempTags] })

    const sorted = await runChild(SCRIPT_PATH, ['--mute', '--manifest', tempManifest, '--tags', tempTags])
    if (!sorted.ok) {
      steps.push({ action: '临时副本重排序', ok: false, message: sorted.message || sorted.last })
      emit(false, true)
      return
    }
    steps.push({ action: '临时副本重排序', ok: true })

    const verified = await runChild(CHECK_SCRIPT, ['--bool', '--manifest', tempManifest, '--tags', tempTags])
    if (!verified.ok) {
      steps.push({ action: '重排序结果校验', ok: false, message: verified.message || verified.last })
      emit(false, true)
      return
    }
    steps.push({ action: '重排序结果校验', ok: true })

    await writeFile(manifestPath, await readFile(tempManifest))
    await writeFile(tagsPath, await readFile(tempTags))
    steps.push({ action: '覆写原文件', ok: true, manifest: manifestPath, tags: tagsPath })
    emit(true)
  } catch (error) {
    steps.push({ action: '检查模式执行', ok: false, message: error.message })
    emit(false, true)
  } finally {
    await removeQuietly(tempManifest)
    await removeQuietly(tempTags)
  }
}

async function main() {
  if (errors.length > 0) {
    steps.push({ action: '参数解析', ok: false, message: errors.join('; ') })
    return emit(false)
  }

  let manifest
  try {
    const manifestPath = options.manifest ? resolve(process.cwd(), options.manifest) : DEFAULT_MANIFEST
    manifest = (await readJsonDocument(manifestPath)).value
  } catch (error) {
    steps.push({ action: '读取清单', ok: false, message: error.message })
    return emit(false)
  }

  let tagsPath
  let manifestPath
  try {
    const resolved = resolveSourcePaths(options, manifest)
    manifestPath = resolved.manifestPath
    tagsPath = resolved.tagsPath
    steps.push({ action: '解析文件源', ok: true, manifest: manifestPath, tags: tagsPath })
  } catch (error) {
    steps.push({ action: '解析文件源', ok: false, message: error.message })
    return emit(false)
  }

  if (options.check) {
    return runCheckMode(manifestPath, tagsPath)
  }

  try {
    const summary = await sortDocuments(manifestPath, tagsPath)
    steps.push({ action: '写入排序结果', ok: true, ...summary })
    emit(true)
  } catch (error) {
    steps.push({ action: '执行排序', ok: false, message: error.message })
    emit(false)
  }
}

main().catch((error) => {
  steps.push({ action: '未预期错误', ok: false, message: error.message })
  emit(false)
})
