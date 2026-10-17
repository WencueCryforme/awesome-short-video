import { readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { CliError, DEFAULT_MANIFEST, parseArgs, resolveSourcePaths } from './lib/cli.mjs'
import { readJsonDocument } from './lib/json-style.mjs'

const TOO_LARGE = 'THE_FILE_SIZE_IS_TOO_LARGE'
const { options, errors } = parseArgs(process.argv.slice(2))
const checks = []

function record(name, ok, message, details) {
  const item = { name, ok, message }
  if (details !== undefined) {
    item.details = details
  }
  checks.push(item)
}

/* 无论成功失败,调试信息都一次性输出,随后输出最终布尔值 */
function finish(fatal) {
  if (fatal) {
    record('前置条件', false, fatal)
  }
  const passed = checks.length > 0 && checks.every(item => item.ok)
  if (!options.bool) {
    console.log(JSON.stringify({ ok: passed, checks }, null, 2))
  }
  console.log(passed ? 'true' : 'false')
  process.exitCode = passed ? 0 : 1
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function describeSource(value) {
  if (!isNonEmptyString(value)) {
    return '为空'
  }
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? null : '协议不是 http/https'
  } catch {
    return '不是合法链接'
  }
}

async function main() {
  if (errors.length > 0) {
    return finish(errors.join('; '))
  }

  const manifestPath = options.manifest ? resolve(process.cwd(), options.manifest) : DEFAULT_MANIFEST

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
    const problems = []
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push('条目不是对象')
    } else {
      if (!isNonEmptyString(entry.title)) {
        problems.push('title 为空')
      }
      if (typeof entry.desc !== 'string') {
        problems.push('desc 不是字符串')
      }
      if (!isNonEmptyString(entry.filename)) {
        problems.push('filename 为空')
      }
      const sourceProblem = describeSource(entry.source)
      if (sourceProblem) {
        problems.push('source ' + sourceProblem)
      }
      if (entry.source_id !== undefined && !isNonEmptyString(entry.source_id)) {
        problems.push('source_id 为空')
      }
      if (entry.allow_iframe !== undefined && typeof entry.allow_iframe !== 'boolean') {
        problems.push('allow_iframe 不是布尔值')
      }
      if (entry.default_mod !== undefined && entry.default_mod !== 'onsite' && entry.default_mod !== 'upstream') {
        problems.push('default_mod 取值非法: ' + String(entry.default_mod))
      }
      if (!Array.isArray(entry.tags) || entry.tags.some(tag => !isNonEmptyString(tag))) {
        problems.push('tags 必须是非空字符串数组')
      }
      if (entry.flag !== undefined && entry.flag !== TOO_LARGE) {
        problems.push('flag 取值非法: ' + String(entry.flag))
      }
    }
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
      .filter(entry => entry && entry.flag !== TOO_LARGE && isNonEmptyString(entry.filename) && !videoFileSet.has(entry.filename))
      .map(entry => entry.filename)
    record(
      '普通条目文件存在',
      missingFiles.length === 0,
      missingFiles.length === 0 ? '普通条目均有对应文件' : '存在缺失文件的普通条目',
      missingFiles
    )

    const flaggedPresent = total
      .filter(entry => entry && entry.flag === TOO_LARGE && isNonEmptyString(entry.filename) && videoFileSet.has(entry.filename))
      .map(entry => entry.filename)
    record(
      '过大条目未入库',
      flaggedPresent.length === 0,
      flaggedPresent.length === 0 ? '过大条目均未出现在入库目录' : '过大条目不应出现在入库目录',
      flaggedPresent
    )

    const referenced = new Set(
      total
        .filter(entry => entry && entry.flag !== TOO_LARGE && isNonEmptyString(entry.filename))
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
