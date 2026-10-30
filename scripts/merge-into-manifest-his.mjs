/*
 * 历史文件冲突的人工解决脚本: 按 --old 旧 hash_id --new 新 hash_id 指定配对后重新写入历史文件
 * 声明新增条目时旧侧写 none,即 --old none --new <新 hash_id>
 * 一次可以给多组,按出现顺序一一配对;只有冲突全部清零才写盘,否则只输出剩余冲突
 */
import { DEFAULT_MANIFEST, parseArgs, resolveFromCwd } from './lib/cli.mjs'
import { DECLARED_NEW, conflictsOf, defaultHisPath, idRecordsOf, planHisUpdate, readHisDocument, writeHisDocument } from './lib/manifest-his.mjs'
import { HASH_ID_PATTERN, primaryHashId } from './lib/hash-id.mjs'
import { readJsonDocument } from './lib/json-style.mjs'
import { emitResult, makeError } from './lib/result.mjs'
import { readVersion } from './lib/version.mjs'

const { options, positionals, errors } = parseArgs(process.argv.slice(2), {
  flags: ['check'],
  values: ['manifest', 'his'],
  multi: ['old', 'new']
})
const steps = []

function succeed(data) {
  emitResult({ ok: true, data: { steps, ...data } })
}

function fail(kind, message, details) {
  emitResult({ ok: false, error: makeError(message, kind, details) })
}

/* 冲突列表按人可以照着操作的形式展开 */
function describeConflict(item, manifestEntries) {
  const entry = manifestEntries.find(candidate => primaryHashId(candidate) === item.hashId)
  const title = entry && entry.title ? String(entry.title) : ''
  if (item.reason === 'ambiguous') {
    const candidates = item.candidates
      .map(candidate => candidate.oldId + ' <' + candidate.filename + '> 相似度 ' + candidate.score)
      .join('; ')
    return {
      reason: 'ambiguous',
      hashId: item.hashId,
      filename: item.filename,
      title,
      candidates: item.candidates,
      hint: '用 --old <其中一个旧 hash_id> --new ' + item.hashId + ' 指定配对: ' + candidates
    }
  }
  return {
    reason: item.reason,
    hashId: item.hashId,
    filename: item.filename,
    title,
    hint: '用 --old none --new ' + item.hashId + ' 声明它是新增条目'
  }
}

function summarize(report) {
  return {
    matched: report.matched,
    registered: report.registered,
    archived: report.archived
  }
}

async function main() {
  if (errors.length > 0) {
    return fail('args', errors.join('; '), { steps })
  }
  if (positionals.length > 0) {
    return fail('args', '不接受位置参数: ' + positionals.join(' '), { steps })
  }

  const oldIds = options.old || []
  const newIds = options.new || []
  if (oldIds.length !== newIds.length) {
    return fail('args', '--old 与 --new 必须成对出现,当前 ' + oldIds.length + ' 个 --old 与 ' + newIds.length + ' 个 --new', { steps })
  }

  const invalidOld = oldIds.filter(id => id !== DECLARED_NEW && !HASH_ID_PATTERN.test(id))
  const invalidNew = newIds.filter(id => !HASH_ID_PATTERN.test(id))
  if (invalidOld.length > 0 || invalidNew.length > 0) {
    return fail('args', 'hash_id 需要 16 位小写十六进制,--old 也接受 none: ' + [...invalidOld, ...invalidNew].join(', '), { steps })
  }

  let version
  try {
    version = await readVersion()
    steps.push({ action: '读取版本号', ok: true, version })
  } catch (error) {
    steps.push({ action: '读取版本号', ok: false, message: error.message })
    return fail(error && error.kind ? error.kind : 'version', '读取版本号失败: ' + error.message, { steps })
  }

  const manifestPath = options.manifest ? resolveFromCwd(options.manifest) : DEFAULT_MANIFEST
  const hisPath = options.his ? resolveFromCwd(options.his) : defaultHisPath(manifestPath)

  let manifestDocument
  try {
    manifestDocument = await readJsonDocument(manifestPath)
    steps.push({ action: '读取清单', ok: true, manifest: manifestPath })
  } catch (error) {
    steps.push({ action: '读取清单', ok: false, message: error.message })
    return fail('manifest', '读取清单失败: ' + error.message, { steps, manifest: manifestPath })
  }
  if (!manifestDocument.value || !Array.isArray(manifestDocument.value.total)) {
    steps.push({ action: '读取清单', ok: false, message: '清单缺少 total 数组' })
    return fail('manifest', '清单缺少 total 数组: ' + manifestPath, { steps })
  }

  let hisDocument
  try {
    hisDocument = await readHisDocument(hisPath)
    steps.push({ action: '读取历史文件', ok: true, his: hisPath, exists: hisDocument.exists })
  } catch (error) {
    steps.push({ action: '读取历史文件', ok: false, message: error.message })
    return fail('his', '读取历史文件失败: ' + error.message, { steps, his: hisPath })
  }

  const manifestEntries = manifestDocument.value.total.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry))
  const hisEntries = (Array.isArray(hisDocument.value && hisDocument.value.total) ? hisDocument.value.total : [])
    .filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry))

  /* 人工给出的每个 hash_id 都必须真实存在,避免把笔误静默忽略 */
  const knownNewIds = new Set(manifestEntries.map(entry => primaryHashId(entry)))
  const knownOldIds = new Set()
  for (const entry of hisEntries) {
    for (const record of idRecordsOf(entry, version)) {
      knownOldIds.add(record.id)
    }
  }

  for (let index = 0; index < oldIds.length; index += 1) {
    if (!knownNewIds.has(newIds[index])) {
      return fail('args', '清单里没有 hash_id 为 ' + newIds[index] + ' 的条目', { steps })
    }
    if (oldIds[index] !== DECLARED_NEW && !knownOldIds.has(oldIds[index])) {
      return fail('args', '历史文件里没有记录 hash_id ' + oldIds[index], { steps })
    }
  }

  const decisions = oldIds.map((oldId, index) => ({ oldId, newId: newIds[index] }))
  const plan = planHisUpdate(manifestDocument.value, hisDocument.value, { version, decisions })
  const conflicts = conflictsOf(plan.report).map(item => describeConflict(item, manifestEntries))

  if (conflicts.length > 0) {
    const message = '仍有 ' + conflicts.length + ' 处冲突未解决,--old 与 --new 成对补齐后才能写盘'
    steps.push({ action: '比对新旧条目', ok: false, message })
    return fail('conflict', message, { steps, conflicts, report: summarize(plan.report) })
  }

  if (decisions.length === 0) {
    const message = '当前没有冲突,无需人工配对'
    steps.push({ action: '比对新旧条目', ok: true, message })
    return succeed({ manifest: manifestPath, his: hisPath, version, noop: true, report: summarize(plan.report) })
  }

  steps.push({ action: '比对新旧条目', ok: true, report: summarize(plan.report) })

  try {
    await writeHisDocument(hisPath, plan.value, hisDocument.style)
    steps.push({ action: '写入历史文件', ok: true, his: hisPath })
  } catch (error) {
    steps.push({ action: '写入历史文件', ok: false, message: error.message })
    return fail('write', '写入历史文件失败: ' + error.message, { steps, his: hisPath })
  }

  return succeed({
    manifest: manifestPath,
    his: hisPath,
    version,
    decisions,
    report: summarize(plan.report)
  })
}

main().catch((error) => {
  steps.push({ action: '未预期错误', ok: false, message: error.message })
  fail('error', '未预期错误: ' + error.message, { steps })
})
