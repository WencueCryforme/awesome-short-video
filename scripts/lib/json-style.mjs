import { readFile, writeFile } from 'node:fs/promises'

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

export function formatJsonDocument(value, style) {
  let body

  /* 零缩进的字符串数组按每行一项输出,保持标签文件的既有风格 */
  if (!style.indent && Array.isArray(value) && value.every(item => typeof item === 'string')) {
    body = '[' + style.newline
      + value.map(item => JSON.stringify(item)).join(',' + style.newline)
      + style.newline + ']'
  } else {
    body = JSON.stringify(value, null, style.indent || 0)
    if (style.newline === '\r\n') {
      body = body.replace(/\n/g, '\r\n')
    }
  }

  return style.trailingNewline ? body + style.newline : body
}

export async function writeJsonDocument(filePath, value, style) {
  await writeFile(filePath, formatJsonDocument(value, style), 'utf8')
}
