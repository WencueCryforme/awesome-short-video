import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { tempFilePathFor } from './fs-util.mjs'

/* 识别原文件的换行,缩进与结尾换行,写回时保持既有排版风格 */
export function detectStyle(raw) {
  const newline = raw.includes('\r\n') ? '\r\n' : '\n'
  const indentMatch = raw.match(/\r?\n([ \t]+)"/)
  return {
    newline,
    indent: indentMatch ? indentMatch[1] : '',
    trailingNewline: /\r?\n$/.test(raw)
  }
}

export async function readJsonDocument(filePath) {
  const raw = await readFile(filePath, 'utf8')
  return { raw, value: JSON.parse(raw), style: detectStyle(raw) }
}

/* 把清单条目的 tags 数组压缩为单行 */
function inlineTagsArrays(body) {
  return body.replace(/"tags": \[\n([\s\S]*?)\n[ \t]*\]/g, (match, inner) => {
    const items = inner.split(/,\n/).map(item => item.trim()).filter(Boolean)
    return '"tags": [' + items.join(', ') + ']'
  })
}

/* 标量对象序列化成单行文本,用于 hash_id 这类记录数组 */
function compactObjectText(item) {
  const parts = Object.keys(item).map(key => JSON.stringify(key) + ': ' + JSON.stringify(item[key]))
  return '{' + parts.join(', ') + '}'
}

/* 判断数组能否压成单行: 每项都是键值均为字符串的扁平对象 */
function isCompactableArray(value) {
  return value.length > 0 && value.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return false
    }
    return Object.values(item).every(part => typeof part === 'string')
  })
}

/*
 * 把指定字段的对象数组替换成占位符,序列化后再换回单行文本
 * 占位符只含字母与 @,JSON.stringify 不会转义,替换时不会误伤其它内容
 */
function replaceCompactArrays(value, fields, compacted) {
  if (Array.isArray(value)) {
    return value.map(item => replaceCompactArrays(item, fields, compacted))
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const next = {}
  for (const [key, item] of Object.entries(value)) {
    if (fields.includes(key) && Array.isArray(item) && isCompactableArray(item)) {
      const token = '@@COMPACT_ARRAY_' + compacted.length + '@@'
      compacted.push('[' + item.map(compactObjectText).join(', ') + ']')
      next[key] = token
      continue
    }
    next[key] = replaceCompactArrays(item, fields, compacted)
  }

  return next
}

export function formatJsonDocument(value, style, options = {}) {
  const compactFields = Array.isArray(options.compactArraysFor) ? options.compactArraysFor : []
  const compacted = []
  const prepared = compactFields.length > 0 ? replaceCompactArrays(value, compactFields, compacted) : value

  let body

  /* 零缩进的字符串数组按每行一项输出,保持标签文件的既有风格 */
  if (!style.indent && Array.isArray(value) && value.every(item => typeof item === 'string')) {
    body = '[' + style.newline
      + value.map(item => JSON.stringify(item)).join(',' + style.newline)
      + style.newline + ']'
  } else {
    body = JSON.stringify(prepared, null, style.indent || 0)
    if (options.inlineTags) {
      body = inlineTagsArrays(body)
    }
    /* 记录数组恢复为单行,每个条目仍独占一行 */
    compacted.forEach((text, index) => {
      body = body.split('"@@COMPACT_ARRAY_' + index + '@@"').join(text)
    })
    if (style.newline === '\r\n') {
      body = body.replace(/\n/g, '\r\n')
    }
  }

  return style.trailingNewline ? body + style.newline : body
}

export async function writeJsonDocument(filePath, value, style, options = {}) {
  await writeFile(filePath, formatJsonDocument(value, style, options), 'utf8')
}

/* 排版由调用方决定的文本写回,同样先写中间文件再改名 */
export async function writeTextDocumentAtomic(filePath, text) {
  const tempPath = tempFilePathFor(filePath, '.writing')
  await mkdir(dirname(tempPath), { recursive: true })
  await writeFile(tempPath, text, 'utf8')
  await rename(tempPath, filePath)
}

/* 先把内容写到目标目录下 temp 子目录的中间文件,再改名到目标,避免写入中途失败留下半个文件 */
export async function writeJsonDocumentAtomic(filePath, value, style, options = {}) {
  const tempPath = tempFilePathFor(filePath, '.writing')
  await mkdir(dirname(tempPath), { recursive: true })
  await writeFile(tempPath, formatJsonDocument(value, style, options), 'utf8')
  await rename(tempPath, filePath)
}
