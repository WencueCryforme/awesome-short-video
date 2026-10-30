/*
 * 历史文件同步脚本: 把当前清单与历史文件比对后写回新的历史文件
 * 自动配对只处理文件名相同与相似度互为最优的条目,剩余条目需要人工用 merge-into-manifest-his.mjs 指定
 * --check 只比对不写盘,供 CI 拦截未同步的提交
 */
import { DEFAULT_MANIFEST, parseArgs, resolveFromCwd } from './lib/cli.mjs'
import { formatHisDocument, conflictsOf, defaultHisPath, planHisUpdate, readHisDocument, writeHisDocument } from './lib/manifest-his.mjs'
import { HASH_ID_PATTERN } from './lib/hash-id.mjs'
import { readJsonDocument } from './lib/json-style.mjs'
import { emitResult, makeError } from './lib/result.mjs'
import { readVersion } from './lib/version.mjs'

const { options, positionals, errors } = parseArgs(process.argv.slice(2), {
  flags: ['check', 'bootstrap'],
  values: ['manifest', 'his'],
  multi: ['accept-new']
})
const steps = []

function succeed(data) {
  emitResult({ ok: true, data: { steps, ...data } })
}

function fail(kind, message, details) {
  emitResult({ ok: false, error: makeError(message, kind, details) })
}

/* 报告里只保留人能读懂的部分,完整结构由 details 携带 */
function summarize(report) {
  return {
    matched: report.matched.length,
    registered: report.registered,
    archived: report.archived,
    unmatchedNew: report.unmatchedNew,
    ambiguous: report.ambiguous
  }
}

function describeConflicts(conflicts) {
  const shown = conflicts.slice(0, 5).map((item) => {
    if (item.reason === 'ambiguous') {
      const candidates = item.candidates.map(candidate => candidate.oldId + ' <' + candidate.filename + '> 相似度 ' + candidate.score).join(', ')
      return '条目 ' + item.hashId + ' <' + item.filename + '> 命中多个历史条目: ' + candidates
    }
    return '条目 ' + item.hashId + ' <' + item.filename + '> 没有可配对的历史条目'
  })
  const more = conflicts.length > shown.length ? ',另有 ' + (conflicts.length - shown.length) + ' 处' : ''
  return '历史文件有 ' + conflicts.length + ' 处需要人工判定: ' + shown.join(';') + more + ',请运行 node scripts/merge-into-manifest-his.mjs 逐条指定配对'
}

async function main() {
  if (errors.length > 0) {
    return fail('args', errors.join('; '), { steps })
  }
  if (positionals.length > 0) {
    return fail('args', '不接受位置参数: ' + positionals.join(' '), { steps })
  }

  const invalidAccept = (options.acceptNew || []).filter(id => !HASH_ID_PATTERN.test(id))
  if (invalidAccept.length > 0) {
    return fail('args', '选项 --accept-new 需要 16 位小写十六进制 hash_id: ' + invalidAccept.join(', '), { steps })
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

  /* 历史文件缺失时按首次登记处理,把当前清单整体登记为基线 */
  const bootstrap = options.bootstrap === true || !hisDocument.exists
  const plan = planHisUpdate(manifestDocument.value, hisDocument.value, {
    version,
    acceptNew: options.acceptNew || [],
    bootstrap
  })

  if (plan.report.invalid.length > 0) {
    const message = '清单有 ' + plan.report.invalid.length + ' 个条目缺少合法 hash_id,请先运行 node scripts/sort-video-manifest_tags.mjs'
    steps.push({ action: '比对新旧条目', ok: false, message })
    return fail('manifest', message, { steps, invalid: plan.report.invalid })
  }

  const conflicts = conflictsOf(plan.report)
  if (conflicts.length > 0) {
    const message = describeConflicts(conflicts)
    steps.push({ action: '比对新旧条目', ok: false, message })
    return fail('conflict', message, { steps, conflicts, report: summarize(plan.report) })
  }

  steps.push({ action: '比对新旧条目', ok: true, report: summarize(plan.report) })

  if (options.check) {
    if (!hisDocument.exists) {
      const message = '历史文件缺失: ' + hisPath + ',请运行 node scripts/try2-update-manifest-his.mjs 建立基线'
      steps.push({ action: '比对历史文件', ok: false, message })
      return fail('his', message, { steps, his: hisPath })
    }
    if (formatHisDocument(plan.value) !== hisDocument.raw) {
      const message = '历史文件与清单不一致: ' + hisPath + ',请运行 node scripts/try2-update-manifest-his.mjs 同步'
      steps.push({ action: '比对历史文件', ok: false, message })
      return fail('his', message, { steps, his: hisPath, report: summarize(plan.report) })
    }
    steps.push({ action: '比对历史文件', ok: true })
    return succeed({
      manifest: manifestPath,
      his: hisPath,
      version,
      bootstrap: false,
      check: true,
      report: summarize(plan.report)
    })
  }

  try {
    await writeHisDocument(hisPath, plan.value)
    steps.push({ action: '写入历史文件', ok: true, his: hisPath })
  } catch (error) {
    steps.push({ action: '写入历史文件', ok: false, message: error.message })
    return fail('write', '写入历史文件失败: ' + error.message, { steps, his: hisPath })
  }

  return succeed({
    manifest: manifestPath,
    his: hisPath,
    version,
    bootstrap,
    check: false,
    report: summarize(plan.report)
  })
}

main().catch((error) => {
  steps.push({ action: '未预期错误', ok: false, message: error.message })
  fail('error', '未预期错误: ' + error.message, { steps })
})
