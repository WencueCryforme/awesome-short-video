/*
 * 条目相似度的公共实现: 先按文件名精确配对,剩余条目再按字段拼接文本的编辑距离判定
 * 相似度取 1 - 编辑距离 / 较长文本长度,取值 0 到 1,低于阈值直接丢弃
 */
import { ENTRY_FIELDS } from './manifest-entry.mjs'

/*
 * 相似度阈值,新增条目的重复判定,历史文件的自动配对与人工合并三处共用
 * 调大更保守,只有非常接近的条目才会被当成同一条;调小更容易自动配对,但误判风险变高
 */
export const SIMILARITY_THRESHOLD = 0.6

/* 把条目字段值拼成一段可比对文本,数组按空格连接,缺失字段跳过 */
export function entrySignature(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return ''
  }

  const parts = []
  for (const field of ENTRY_FIELDS) {
    const value = entry[field]
    if (Array.isArray(value)) {
      parts.push(value.join(' '))
    } else if (value !== undefined && value !== null) {
      parts.push(String(value))
    }
  }

  return parts.join(' ').trim()
}

/* 编辑距离,只保留上一行与当前行两组计数,内存占用与文本长度成线性关系 */
export function levenshtein(left, right) {
  if (left === right) {
    return 0
  }
  if (left.length === 0) {
    return right.length
  }
  if (right.length === 0) {
    return left.length
  }

  let previous = new Array(right.length + 1)
  let current = new Array(right.length + 1)
  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      const replacement = previous[column - 1] + cost
      const deletion = previous[column] + 1
      const insertion = current[column - 1] + 1
      current[column] = Math.min(replacement, deletion, insertion)
    }
    const swap = previous
    previous = current
    current = swap
  }

  return previous[right.length]
}

/* 两个条目或两段文本的相似度,两边都为空时视为完全一致 */
export function similarityScore(left, right) {
  const leftText = typeof left === 'string' ? left : entrySignature(left)
  const rightText = typeof right === 'string' ? right : entrySignature(right)
  if (leftText.length === 0 && rightText.length === 0) {
    return 1
  }

  const longest = Math.max(leftText.length, rightText.length)
  return 1 - levenshtein(leftText, rightText) / longest
}

/* 在候选条目里找与目标最相似的一条,没有候选时返回 null */
export function bestSimilarEntry(entry, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null
  }

  const signature = entrySignature(entry)
  let best = null
  candidates.forEach((candidate, index) => {
    const score = similarityScore(signature, entrySignature(candidate))
    if (best === null || score > best.score) {
      best = { index, score, entry: candidate }
    }
  })

  return best
}
