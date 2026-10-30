import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECT_ROOT } from './cli.mjs'

/* 根目录 VERSION 文件是版本号的唯一来源,内容只有版本号本身,不含任何空白符,格式 yyyy.MM.dd */
export const VERSION_FILE_NAME = 'VERSION'
export const VERSION_PATTERN = /^\d{4}\.\d{2}\.\d{2}$/

export class VersionError extends Error {
  constructor(message, kind = 'version') {
    super(message)
    this.kind = kind
  }
}

export function versionFilePath(root = PROJECT_ROOT) {
  return join(root, VERSION_FILE_NAME)
}

/* 读取并校验版本号,缺失或格式不合规都抛 VersionError,由调用方统一转成结果对象 */
export async function readVersion(root = PROJECT_ROOT) {
  const file = versionFilePath(root)
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw new VersionError('版本号文件缺失或不可读: ' + file)
  }

  const version = text.trim()
  if (!VERSION_PATTERN.test(version)) {
    throw new VersionError('版本号内容不符合 yyyy.MM.dd 格式: ' + JSON.stringify(version) + ' (' + file + ')')
  }
  return version
}

/* 页面与站点地图书写的日期形态,由版本号的分隔点换成横线得到 */
export function versionToDate(version) {
  return version.split('.').join('-')
}
