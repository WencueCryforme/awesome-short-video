import { fileURLToPath } from 'node:url'
import { basename, dirname, join, resolve } from 'node:path'
import { copyFile, readFile } from 'node:fs/promises'
import { DEFAULT_MANIFEST, parseArgs, resolveSourcePaths } from './lib/cli.mjs'
import { readJsonDocument, writeJsonDocumentAtomic } from './lib/json-style.mjs'
import { compareEntries, sortByPinyin } from './lib/pinyin-sort.mjs'
import { runChildScript } from './lib/child.mjs'
import { removeQuietly } from './lib/fs-util.mjs'
import { emitResult, makeError } from './lib/result.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const CHECK_SCRIPT = resolve(dirname(SCRIPT_PATH), 'check-video-manifest.mjs')
const { options, errors } = parseArgs(process.argv.slice(2), {
  flags: ['check'],
  values: ['manifest', 'tags']
})
const steps = []

function succeed(data) {
  emitResult({ ok: true, data: { steps, ...data } })
}

function fail(kind, message, details) {
  emitResult({ ok: false, error: makeError(message, kind, details) })
}

function tempPathFor(filePath) {
  return join(dirname(filePath), basename(filePath, '.json') + '.temp.json')
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

  await writeJsonDocumentAtomic(tagsPath, sortedTags, tagsDocument.style)
  await writeJsonDocumentAtomic(manifestPath, nextManifest, manifestDocument.style, { inlineTags: true })

  return { tagCount: sortedTags.length, entryCount: sortedTotal.length }
}

/*
 * 检查模式只做校验与比对,不写回原文件:
 * 若原文件与排序结果字节不一致,说明文件未按规范排序,由调用方决定是否执行排序
 */
async function runCheckMode(manifestPath, tagsPath) {
  const original = runChildScript(CHECK_SCRIPT, ['--manifest', manifestPath, '--tags', tagsPath])
  if (!original.ok) {
    steps.push({ action: '原始文件校验', ok: false, message: original.error.message })
    return fail('check', '原始文件校验失败: ' + original.error.message, { steps })
  }
  steps.push({ action: '原始文件校验', ok: true })

  const tempManifest = tempPathFor(manifestPath)
  const tempTags = tempPathFor(tagsPath)

  try {
    const beforeManifest = await readFile(manifestPath)
    const beforeTags = await readFile(tagsPath)

    await copyFile(manifestPath, tempManifest)
    await copyFile(tagsPath, tempTags)
    steps.push({ action: '生成临时副本', ok: true, files: [tempManifest, tempTags] })

    const sorted = runChildScript(SCRIPT_PATH, ['--manifest', tempManifest, '--tags', tempTags])
    if (!sorted.ok) {
      steps.push({ action: '临时副本重排序', ok: false, message: sorted.error.message })
      return fail('sort', '临时副本重排序失败: ' + sorted.error.message, { steps })
    }
    steps.push({ action: '临时副本重排序', ok: true })

    const verified = runChildScript(CHECK_SCRIPT, ['--manifest', tempManifest, '--tags', tempTags])
    if (!verified.ok) {
      steps.push({ action: '重排序结果校验', ok: false, message: verified.error.message })
      return fail('check', '重排序结果校验失败: ' + verified.error.message, { steps })
    }
    steps.push({ action: '重排序结果校验', ok: true })

    const afterManifest = await readFile(tempManifest)
    const afterTags = await readFile(tempTags)
    const changed = !afterManifest.equals(beforeManifest) || !afterTags.equals(beforeTags)

    if (changed) {
      steps.push({ action: '比对原文件', ok: false, message: '原文件与排序结果不一致' })
      return fail('sort', '原文件未按规范排序,请运行不带 --check 的排序写回', {
        steps,
        manifest: manifestPath,
        tags: tagsPath
      })
    }

    steps.push({ action: '比对原文件', ok: true })
    return succeed({ manifest: manifestPath, tags: tagsPath })
  } catch (error) {
    steps.push({ action: '检查模式执行', ok: false, message: error.message })
    return fail('sort', '检查模式执行失败: ' + error.message, { steps })
  } finally {
    await removeQuietly(tempManifest)
    await removeQuietly(tempTags)
  }
}

async function main() {
  if (errors.length > 0) {
    steps.push({ action: '参数解析', ok: false, message: errors.join('; ') })
    return fail('args', errors.join('; '), { steps })
  }

  let manifest
  let manifestPath
  try {
    manifestPath = options.manifest ? resolve(process.cwd(), options.manifest) : DEFAULT_MANIFEST
    manifest = (await readJsonDocument(manifestPath)).value
  } catch (error) {
    steps.push({ action: '读取清单', ok: false, message: error.message })
    return fail('manifest', '读取清单失败: ' + error.message, { steps })
  }

  let tagsPath
  try {
    const resolved = resolveSourcePaths(options, manifest)
    manifestPath = resolved.manifestPath
    tagsPath = resolved.tagsPath
    steps.push({ action: '解析文件源', ok: true, manifest: manifestPath, tags: tagsPath })
  } catch (error) {
    steps.push({ action: '解析文件源', ok: false, message: error.message })
    return fail('manifest', '解析文件源失败: ' + error.message, { steps })
  }

  if (options.check) {
    return runCheckMode(manifestPath, tagsPath)
  }

  try {
    const summary = await sortDocuments(manifestPath, tagsPath)
    steps.push({ action: '写入排序结果', ok: true, ...summary })
    return succeed({ manifest: manifestPath, tagsPath, ...summary })
  } catch (error) {
    steps.push({ action: '执行排序', ok: false, message: error.message })
    return fail('sort', '执行排序失败: ' + error.message, { steps })
  }
}

main().catch((error) => {
  steps.push({ action: '未预期错误', ok: false, message: error.message })
  fail('sort', '未预期错误: ' + error.message, { steps })
})
