import { readFile, rename, writeFile } from 'node:fs/promises'

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

export function formatJsonDocument(value, style, options = {}) {
  let body

  /* 零缩进的字符串数组按每行一项输出,保持标签文件的既有风格 */
  if (!style.indent && Array.isArray(value) && value.every(item => typeof item === 'string')) {
    body = '[' + style.newline
      + value.map(item => JSON.stringify(item)).join(',' + style.newline)
      + style.newline + ']'
  } else {
    body = JSON.stringify(value, null, style.indent || 0)
    if (options.inlineTags) {
      body = inlineTagsArrays(body)
    }
    if (style.newline === '\r\n') {
      body = body.replace(/\n/g, '\r\n')
    }
  }

  return style.trailingNewline ? body + style.newline : body
}

export async function writeJsonDocument(filePath, value, style, options = {}) {
  await writeFile(filePath, formatJsonDocument(value, style, options), 'utf8')
}

/* 先写同目录临时文件再改名,避免写入中途失败时留下半个文件 */
export async function writeJsonDocumentAtomic(filePath, value, style, options = {}) {
  const tempPath = filePath + '.writing'
  await writeFile(tempPath, formatJsonDocument(value, style, options), 'utf8')
  await rename(tempPath, filePath)
}
