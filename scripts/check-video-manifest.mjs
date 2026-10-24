import { readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { CliError, DEFAULT_MANIFEST, parseArgs, resolveSourcePaths } from './lib/cli.mjs'
import { readJsonDocument } from './lib/json-style.mjs'
import { TOO_LARGE_FLAG, entryFieldProblems, isNonEmptyString } from './lib/manifest-entry.mjs'
import { emitResult, makeError } from './lib/result.mjs'

const { options, errors } = parseArgs(process.argv.slice(2))
const checks = []

function record(name, ok, message, details) {
  const item = { name, ok, message }
  if (details !== undefined) {
    item.details = details
  }
  checks.push(item)
}

/* 从检查项的 details 里提炼一句可读摘要,便于命令行直接看出问题位置 */
function summarizeDetails(details) {
  if (!Array.isArray(details) || details.length === 0) {
    return ''
  }

  const parts = []
  for (const item of details.slice(0, 3)) {
    if (typeof item === 'string') {
      parts.push(item)
    } else if (item && Array.isArray(item.problems)) {
      parts.push('第 ' + (Number(item.index) + 1) + ' 条 ' + item.problems.join('、'))
    } else if (item && typeof item.problem === 'string') {
      parts.push(item.problem)
    }
  }

  return parts.join('; ')
}

/* 无论成功失败都一次性给出全部检查项,失败时取首个失败项作为错误描述 */
function finish(fatal) {
  if (fatal) {
    record('前置条件', false, fatal)
  }
  const passed = checks.length > 0 && checks.every(item => item.ok)

  if (passed) {
    emitResult({ ok: true, data: { manifest: currentManifestPath, checks } })
    return
  }

  const failed = checks.filter(item => item.ok === false)
  const summary = summarizeDetails(failed[0].details)
  emitResult({
    ok: false,
    error: makeError(
      failed[0].name + ': ' + failed[0].message + (summary ? '(' + summary + ')' : ''),
      'manifest',
      { manifest: currentManifestPath, failed: failed.map(item => item.name), checks }
    )
  })
}

let currentManifestPath = DEFAULT_MANIFEST

async function main() {
  if (errors.length > 0) {
    return finish(errors.join('; '))
  }

  const manifestPath = options.manifest ? resolve(process.cwd(), options.manifest) : DEFAULT_MANIFEST
  currentManifestPath = manifestPath

  let manifest
  try {
    const document = await readJsonDocument(manifestPath)
    manifest = document.value
    record('读取清单', true, manifestPath)
  } catch (error) {
    return finish('清单读取失败: ' + error.message)
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    record('清单结构', false, '清单顶层必须是对象')
    return finish()
  }

  const tagsFieldOk = options.tags ? true : typeof manifest.tags === 'string'
  const manifestShapeOk = isNonEmptyString(manifest.filepath) && tagsFieldOk
  record('清单字段', manifestShapeOk, manifestShapeOk ? 'filepath 与 tags 字段合法' : 'filepath 或 tags 字段缺失', {
    filepath: manifest.filepath,
    tags: manifest.tags
  })

  const total = Array.isArray(manifest.total) ? manifest.total : []
  record('条目集合', Array.isArray(manifest.total), 'total 必须是数组', { count: total.length })

  const structuralProblems = []
  total.forEach((entry, index) => {
    const problems = entryFieldProblems(entry)
    if (problems.length > 0) {
      structuralProblems.push({ index, filename: entry && entry.filename, problems })
    }
  })
  record(
    '条目字段',
    structuralProblems.length === 0,
    structuralProblems.length === 0 ? '全部条目字段合法' : '存在字段非法的条目',
    structuralProblems.slice(0, 20)
  )

  const seenFilenames = new Map()
  const duplicateFilenames = []
  total.forEach((entry, index) => {
    const name = entry && entry.filename
    if (!isNonEmptyString(name)) {
      return
    }
    if (seenFilenames.has(name)) {
      duplicateFilenames.push({ filename: name, indexes: [seenFilenames.get(name), index] })
    } else {
      seenFilenames.set(name, index)
    }
  })
  record(
    '文件名唯一',
    duplicateFilenames.length === 0,
    duplicateFilenames.length === 0 ? '文件名无重复' : '存在重复文件名',
    duplicateFilenames
  )

  let videoDirOk = false
  let videoFiles = []
  let videoDir = ''

  if (isNonEmptyString(manifest.filepath)) {
    videoDir = resolve(dirname(manifestPath), manifest.filepath)
    try {
      const entries = await readdir(videoDir, { withFileTypes: true })
      videoFiles = entries.filter(entry => entry.isFile()).map(entry => entry.name)
      videoDirOk = true
      record('入库视频目录', true, videoDir, { count: videoFiles.length })
    } catch (error) {
      record('入库视频目录', false, videoDir + ' 读取失败: ' + error.message)
    }
  } else {
    record('入库视频目录', false, '无法解析 filepath')
  }

  if (videoDirOk) {
    const videoFileSet = new Set(videoFiles)

    const missingFiles = total
      .filter(entry => entry && entry.flag !== TOO_LARGE_FLAG && isNonEmptyString(entry.filename) && !videoFileSet.has(entry.filename))
      .map(entry => entry.filename)
    record(
      '普通条目文件存在',
      missingFiles.length === 0,
      missingFiles.length === 0 ? '普通条目均有对应文件' : '存在缺失文件的普通条目',
      missingFiles
    )

    const flaggedPresent = total
      .filter(entry => entry && entry.flag === TOO_LARGE_FLAG && isNonEmptyString(entry.filename) && videoFileSet.has(entry.filename))
      .map(entry => entry.filename)
    record(
      '过大条目未入库',
      flaggedPresent.length === 0,
      flaggedPresent.length === 0 ? '过大条目均未出现在入库目录' : '过大条目不应出现在入库目录',
      flaggedPresent
    )

    const referenced = new Set(
      total
        .filter(entry => entry && entry.flag !== TOO_LARGE_FLAG && isNonEmptyString(entry.filename))
        .map(entry => entry.filename)
    )
    const extraFiles = videoFiles.filter(name => !referenced.has(name))
    record(
      '无清单外文件',
      extraFiles.length === 0,
      extraFiles.length === 0 ? '入库目录与清单一致' : '入库目录存在未被清单记录的文件',
      extraFiles
    )
  }

  let tagsPath
  try {
    tagsPath = resolveSourcePaths(options, manifest).tagsPath
  } catch (error) {
    record('解析标签文件', false, error instanceof CliError ? error.message : String(error))
    return finish()
  }

  let presetTags
  try {
    const document = await readJsonDocument(tagsPath)
    presetTags = document.value
    record('读取标签文件', true, tagsPath)
  } catch (error) {
    record('读取标签文件', false, tagsPath + ' 读取失败: ' + error.message)
    return finish()
  }

  if (!Array.isArray(presetTags)) {
    record('标签预选项结构', false, '标签文件顶层必须是数组')
    return finish()
  }
  record('标签预选项结构', true, '标签文件为数组', { count: presetTags.length })

  const presetProblems = []
  const seenTags = new Set()
  presetTags.forEach((tag, index) => {
    if (!isNonEmptyString(tag)) {
      presetProblems.push({ index, problem: '不是非空字符串' })
      return
    }
    if (seenTags.has(tag)) {
      presetProblems.push({ index, problem: '重复标签: ' + tag })
      return
    }
    seenTags.add(tag)
  })
  record(
    '标签预选项合法',
    presetProblems.length === 0,
    presetProblems.length === 0 ? '无重复或非法标签' : '标签预选项存在问题',
    presetProblems
  )

  const usedTags = [...new Set(total.flatMap(entry => (entry && Array.isArray(entry.tags) ? entry.tags : [])))]
  const unknownTags = usedTags.filter(tag => !seenTags.has(tag))
  record(
    '条目标签在预选项内',
    unknownTags.length === 0,
    unknownTags.length === 0 ? '未发现预设外标签' : '条目使用了预设外标签',
    unknownTags
  )

  finish()
}

main().catch(error => finish('未预期错误: ' + error.message))
