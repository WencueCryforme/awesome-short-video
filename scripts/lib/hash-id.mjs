/*
 * 条目 hash_id 的生成规则,由校验脚本与排序脚本共用
 * 取条目自身内容做 sha-512 摘要: 行压缩、去掉无用空白符、排除 hash_id 字段本身,再取前 16 个字符
 */
import { createHash } from 'node:crypto'
import { ENTRY_FIELDS, HASH_ID_FIELD } from './manifest-entry.mjs'

export const HASH_ALGORITHM = 'sha512'
export const HASH_ID_LENGTH = 16

/* 按固定字段顺序序列化成无空白符的规范文本,字段缺失时跳过 */
export function canonicalEntryText(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return ''
  }

  const ordered = {}
  for (const field of ENTRY_FIELDS) {
    if (entry[field] !== undefined) {
      ordered[field] = entry[field]
    }
  }

  return JSON.stringify(ordered)
}

/* 由条目内容直接算出 hash_id,不读取条目里已有的 hash_id */
export function computeHashId(entry) {
  return createHash(HASH_ALGORITHM).update(canonicalEntryText(entry), 'utf8').digest('hex').slice(0, HASH_ID_LENGTH)
}

/* 返回写入 hash_id 后的新条目,hash_id 固定排在字段末尾 */
export function withHashId(entry) {
  const next = { ...entry }
  delete next[HASH_ID_FIELD]
  next[HASH_ID_FIELD] = computeHashId(entry)
  return next
}
