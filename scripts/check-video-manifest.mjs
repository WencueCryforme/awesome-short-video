import { resolve } from 'node:path'
import { CliError, DEFAULT_MANIFEST, parseArgs, resolveSourcePaths } from './lib/cli.mjs'
import { readJsonDocument } from './lib/json-style.mjs'
import { ENTRY_FIELDS, entryFieldProblems, isNonEmptyString } from './lib/manifest-entry.mjs'
import { emitResult, makeError } from './lib/result.mjs'

const { options, errors } = parseArgs(process.argv.slice(2), {
  flags: [],
  values: ['manifest', 'tags']
})
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

/* 空白模板用于手工复制条目,字段集合必须与代码认定的条目字段保持一致 */
function blankFieldProblems(blank) {
  if (!blank || typeof blank !== 'object' || Array.isArray(blank)) {
    return ['blank 不是对象']
  }

  const problems = []
  for (const field of ENTRY_FIELDS) {
    if (!(field in blank)) {
      problems.push('缺少字段 ' + field)
    }
  }
  for (const field of Object.keys(blank)) {
    if (!ENTRY_FIELDS.includes(field)) {
      problems.push('存在未知字段 ' + field)
    }
  }

  return problems
}

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

  const tagsFromOption = Boolean(options.tags)
  const tagsFieldOk = tagsFromOption || typeof manifest.tags === 'string'
  const manifestShapeOk = isNonEmptyString(manifest.desc) && isNonEmptyString(manifest.filesize) && tagsFieldOk
  const manifestShapeMessage = manifestShapeOk
    ? (tagsFromOption ? 'desc 与 filesize 字段合法,标签文件由参数指定' : 'desc, filesize 与 tags 字段合法')
    : 'desc, filesize 或 tags 字段缺失'
  record('清单字段', manifestShapeOk, manifestShapeMessage, {
    desc: manifest.desc,
    filesize: manifest.filesize,
    tags: manifest.tags
  })

  const totalIsArray = Array.isArray(manifest.total)
  const total = totalIsArray ? manifest.total : []
  record('条目集合', totalIsArray, totalIsArray ? 'total 为数组,共 ' + total.length + ' 条' : 'total 必须是数组', { count: total.length })

  const blankIssues = blankFieldProblems(manifest.blank)
  record(
    '空模板字段',
    blankIssues.length === 0,
    blankIssues.length === 0 ? 'blank 字段与条目字段一致' : 'blank 字段与条目字段不一致',
    blankIssues
  )

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
