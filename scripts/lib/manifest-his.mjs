/*
 * 视频清单历史文件(manifest.his.json)的读写与合并规则
 * 历史文件与清 unittest 同顶层结构,条目 hash_id 为记录数组,每项含 id 与登记时的版本日期
 * 条目一旦登记就沿用首次分配的 hash_id;条目被删除时整体移入 archived,保留完整字段供日后手工恢复
 */
import { dirname, join } from 'node:path'
import { ENTRY_FIELDS, HASH_ID_FIELD } from './manifest-entry.mjs'
import { isHashId, primaryHashId } from './hash-id.mjs'
import { readJsonDocument, writeTextDocumentAtomic } from './json-style.mjs'
import { SIMILARITY_THRESHOLD, similarityScore } from './similarity.mjs'

export const HIS_FILE_NAME = 'manifest.his.json'
export const ARCHIVED_FIELD = 'archived'
export const REMOVED_DATE_FIELD = 'removedDate'
/* 合并脚本用它表示"这一条确实是新增条目,旧侧没有对应记录" */
export const DECLARED_NEW = 'none'

const VERSION_DATE_PATTERN = /^\d{4}\.\d{2}\.\d{2}$/

/* 清单与历史文件共享的顶层字段,写入历史文件时按原值复制 */
const HEADER_FIELDS = ['desc', 'filesize', 'tags']

export function defaultHisPath(manifestPath) {
  return join(dirname(manifestPath), HIS_FILE_NAME)
}

function isEntry(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isVersionDate(value) {
  return typeof value === 'string' && VERSION_DATE_PATTERN.test(value)
}

/* 把 hash_id 字段的各种形态规范成记录数组,重复 id 只保留首个,日期缺失时回落到给定值 */
export function normalizeIdRecords(value, fallbackDate) {
  const records = []
  const push = (id, date) => {
    if (!isHashId(id) || records.some(record => record.id === id)) {
      return
    }
    records.push({ id, date: isVersionDate(date) ? date : fallbackDate })
  }

  if (typeof value === 'string') {
    push(value, fallbackDate)
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        push(item, fallbackDate)
      } else if (isEntry(item)) {
        push(item.id, item.date)
      }
    }
  }

  return records
}

export function idRecordsOf(entry, fallbackDate) {
  return normalizeIdRecords(isEntry(entry) ? entry[HASH_ID_FIELD] : undefined, fallbackDate)
}

/* 快照只保留清单条目字段与 id 记录,历史文件不携带其它字段 */
export function snapshotEntry(entry, fallbackDate) {
  const snapshot = {}
  for (const field of ENTRY_FIELDS) {
    if (entry[field] !== undefined) {
      snapshot[field] = entry[field]
    }
  }
  snapshot[HASH_ID_FIELD] = idRecordsOf(entry, fallbackDate)
  return snapshot
}

export function emptyHisValue() {
  return { total: [], [ARCHIVED_FIELD]: [] }
}

/*
 * 历史文件刻意压成"一个条目一行": 去掉全部缩进与无效空白,只保留结构换行
 * 这样 diff 仍能按条目定位,同时不适合人工逐字段阅读与改写,减少被手工篡改的可能
 * 任何手工重排都会被 --check 判定为与清单不一致,必须交给脚本重新写回
 */
const HIS_LIST_FIELDS = ['total', ARCHIVED_FIELD]

function serializeHisValue(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : emptyHisValue()
  const lines = ['{']
  const keys = Object.keys(source)
  keys.forEach((key, index) => {
    const tail = index === keys.length - 1 ? '' : ','
    const item = source[key]
    if (HIS_LIST_FIELDS.includes(key) && Array.isArray(item) && item.length > 0) {
      lines.push(JSON.stringify(key) + ': [')
      item.forEach((child, childIndex) => {
        lines.push(JSON.stringify(child) + (childIndex === item.length - 1 ? '' : ','))
      })
      lines.push(']' + tail)
      return
    }
    lines.push(JSON.stringify(key) + ': ' + JSON.stringify(item) + tail)
  })
  lines.push('}')
  return lines.join('\n') + '\n'
}

export function formatHisDocument(value) {
  return serializeHisValue(value)
}

/* 历史文件缺失时按"首次登记"处理,不视为错误 */
export async function readHisDocument(filePath) {
  try {
    const document = await readJsonDocument(filePath)
    return { exists: true, value: document.value, raw: document.raw }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false, value: emptyHisValue(), raw: '' }
    }
    throw error
  }
}

export async function writeHisDocument(filePath, value) {
  await writeTextDocumentAtomic(filePath, formatHisDocument(value))
}

/*
 * 合并计划: 输入当前清单与旧历史文件,输出新的历史文件内容与报告
 * 配对顺序为人工决策,文件名完全一致,相似度互为最优且分数唯一,剩余条目留给人工处理
 */
export function planHisUpdate(manifestValue, hisValue, options = {}) {
  const version = String(options.version || '')
  if (!isVersionDate(version)) {
    throw new Error('版本号不符合 yyyy.MM.dd 格式: ' + version)
  }

  const decisions = Array.isArray(options.decisions) ? options.decisions : []
  const acceptNew = new Set(Array.isArray(options.acceptNew) ? options.acceptNew : [])
  const bootstrap = options.bootstrap === true

  const entries = (Array.isArray(manifestValue && manifestValue.total) ? manifestValue.total : []).filter(isEntry)
  const oldEntries = (Array.isArray(hisValue && hisValue.total) ? hisValue.total : []).filter(isEntry)
  const carried = (Array.isArray(hisValue && hisValue[ARCHIVED_FIELD]) ? hisValue[ARCHIVED_FIELD] : []).filter(isEntry)

  const newIds = entries.map(entry => primaryHashId(entry))
  const oldRecords = oldEntries.map(entry => idRecordsOf(entry, version))

  const boundOld = new Array(entries.length).fill(-1)
  const usedOld = new Set()
  const declared = new Set()

  for (const decision of decisions) {
    const target = newIds.indexOf(String(decision && decision.newId))
    if (target === -1 || boundOld[target] !== -1) {
      continue
    }
    if (String(decision.oldId) === DECLARED_NEW) {
      declared.add(newIds[target])
      continue
    }
    const source = oldRecords.findIndex(records => records.some(record => record.id === String(decision.oldId)))
    if (source === -1 || usedOld.has(source)) {
      continue
    }
    boundOld[target] = source
    usedOld.add(source)
  }

  /* 阶段一: 文件名完全相同直接配对,清单内文件名唯一,因此命中即确定 */
  const freeOldIndexes = () => oldEntries.map((entry, index) => index).filter(index => !usedOld.has(index))
  for (let target = 0; target < entries.length; target += 1) {
    if (boundOld[target] !== -1 || declared.has(newIds[target])) {
      continue
    }
    const candidates = freeOldIndexes().filter(index => oldEntries[index].filename === entries[target].filename)
    if (candidates.length === 1) {
      boundOld[target] = candidates[0]
      usedOld.add(candidates[0])
    }
  }

  /* 阶段二: 剩余条目按相似度配对,只有互为最优且分数唯一时才自动采用 */
  const pendingOld = freeOldIndexes()
  const pendingNew = []
  for (let target = 0; target < entries.length; target += 1) {
    if (boundOld[target] === -1 && !declared.has(newIds[target])) {
      pendingNew.push(target)
    }
  }

  const scoreCache = new Map()
  const scoreOf = (target, old) => {
    const key = target + ':' + old
    if (!scoreCache.has(key)) {
      scoreCache.set(key, similarityScore(entries[target], oldEntries[old]))
    }
    return scoreCache.get(key)
  }

  const bestOldFor = new Map()
  const bestNewFor = new Map()
  for (const target of pendingNew) {
    for (const old of pendingOld) {
      const score = scoreOf(target, old)
      if (score < SIMILARITY_THRESHOLD) {
        continue
      }
      const currentOld = bestOldFor.get(target)
      if (!currentOld || score > currentOld.score) {
        bestOldFor.set(target, { old, score })
      }
      const currentNew = bestNewFor.get(old)
      if (!currentNew || score > currentNew.score) {
        bestNewFor.set(old, { target, score })
      }
    }
  }

  for (const [target, best] of bestOldFor) {
    const reverse = bestNewFor.get(best.old)
    if (!reverse || reverse.target !== target) {
      continue
    }
    const tied = pendingOld.some(old => old !== best.old && scoreOf(target, old) === best.score)
      || pendingNew.some(other => other !== target && scoreOf(other, best.old) === best.score)
    if (tied) {
      continue
    }
    boundOld[target] = best.old
    usedOld.add(best.old)
  }

  const report = {
    matched: [],
    registered: [],
    archived: [],
    unmatchedNew: [],
    ambiguous: [],
    invalid: []
  }

  const total = entries.map((entry, target) => {
    const hashId = newIds[target]
    const oldIndex = boundOld[target]
    const records = oldIndex >= 0 ? oldRecords[oldIndex].map(record => ({ ...record })) : []

    if (hashId === '') {
      report.invalid.push({ index: target, filename: entry.filename, title: entry.title })
    } else if (records.length === 0) {
      if (oldIndex === -1 && !declared.has(hashId) && !acceptNew.has(hashId) && !bootstrap) {
        const candidates = pendingOld
          .map(old => ({ old, score: scoreOf(target, old) }))
          .filter(item => item.score >= SIMILARITY_THRESHOLD)
          .map(item => ({
            oldId: primaryHashId(oldEntries[item.old]),
            filename: oldEntries[item.old].filename,
            score: Number(item.score.toFixed(3))
          }))
        if (candidates.length > 0) {
          report.ambiguous.push({ hashId, filename: entry.filename, title: entry.title, candidates })
        } else {
          report.unmatchedNew.push({ hashId, filename: entry.filename, title: entry.title })
        }
      }
      records.push({ id: hashId, date: version })
      report.registered.push(hashId)
    } else if (!records.some(record => record.id === hashId)) {
      /* 内容变更后重新分配的 id 追加为一条新记录,旧记录保留 */
      records.push({ id: hashId, date: version })
      report.registered.push(hashId)
    }

    if (oldIndex >= 0) {
      report.matched.push({
        oldId: primaryHashId(oldEntries[oldIndex]),
        newId: hashId,
        filename: entry.filename
      })
    }

    const snapshot = snapshotEntry(entry, version)
    snapshot[HASH_ID_FIELD] = records
    return snapshot
  })

  const archivedOut = []
  const seenArchivedKeys = new Set()
  const pushArchived = (entry, removedDate) => {
    const snapshot = snapshotEntry(entry, version)
    snapshot[REMOVED_DATE_FIELD] = isVersionDate(removedDate) ? removedDate : version
    const key = primaryHashId(snapshot) || String(snapshot.filename)
    if (seenArchivedKeys.has(key)) {
      return
    }
    seenArchivedKeys.add(key)
    archivedOut.push(snapshot)
  }

  for (const entry of carried) {
    pushArchived(entry, entry[REMOVED_DATE_FIELD])
  }
  for (let old = 0; old < oldEntries.length; old += 1) {
    if (usedOld.has(old)) {
      continue
    }
    pushArchived(oldEntries[old], version)
    report.archived.push({
      id: primaryHashId(oldEntries[old]),
      filename: oldEntries[old].filename,
      title: oldEntries[old].title
    })
  }
  /* 归档按文件名稳定排序,便于人工比对与差异查看 */
  archivedOut.sort((left, right) => {
    const leftName = String(left.filename)
    const rightName = String(right.filename)
    if (leftName === rightName) {
      return 0
    }
    return leftName < rightName ? -1 : 1
  })

  const value = {}
  for (const field of HEADER_FIELDS) {
    if (manifestValue && manifestValue[field] !== undefined) {
      value[field] = manifestValue[field]
    }
  }
  value.total = total
  value[ARCHIVED_FIELD] = archivedOut

  return { value, report, bootstrap }
}

/* 冲突项: 无法自动登记或无法判定归属的条目,需要人工指定配对 */
export function conflictsOf(report) {
  return [
    ...report.invalid.map(item => ({ reason: 'invalid', ...item })),
    ...report.ambiguous.map(item => ({ reason: 'ambiguous', ...item })),
    ...report.unmatchedNew.map(item => ({ reason: 'unmatched', ...item }))
  ]
}
