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

export const HASH_ID_PATTERN = /^[0-9a-f]{16}$/

export function isHashId(value) {
  return typeof value === 'string' && HASH_ID_PATTERN.test(value)
}

/*
 * 取条目当前使用的 hash_id:
 * 清单里是字符串,历史文件里是记录数组,两种形态统一按"最后一个有效记录"取值
 */
export function primaryHashId(entry) {
  const stored = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry[HASH_ID_FIELD] : undefined
  if (isHashId(stored)) {
    return stored
  }
  if (Array.isArray(stored)) {
    for (let index = stored.length - 1; index >= 0; index -= 1) {
      const record = stored[index]
      if (record && isHashId(record.id)) {
        return record.id
      }
    }
  }

  return ''
}

/*
 * 保守策略: 条目已分配过 hash_id 时原样沿用,只有强制模式才按当前内容重新计算
 * 这样改标题或简介不会让条目换地址,历史分享链接与已收录页面都保持有效
 */
export function ensureHashId(entry, options = {}) {
  const next = { ...entry }
  const stored = primaryHashId(entry)
  delete next[HASH_ID_FIELD]
  next[HASH_ID_FIELD] = options.force === true || stored === '' ? computeHashId(entry) : stored
  return next
}
