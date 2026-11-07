import { readFile, writeFile } from 'node:fs/promises'
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

/* 当天日期按版本号格式写成 yyyy.MM.dd,取本地时区,不做时区换算 */
export function formatVersionDate(now = new Date()) {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return year + '.' + month + '.' + day
}

/*
 * 新增条目登记用的版本号: 取当天日期,但只向前推进
 * 版本号已领先当天时保持原值,避免把版本号回退
 */
export function versionForToday(currentVersion, now = new Date()) {
  const today = formatVersionDate(now)
  return today > currentVersion ? today : currentVersion
}

/*
 * 把版本号推进到当天后交给同步函数写回各代码与包文件
 * 版本号已等于当天时不写文件也不调用同步;同步失败时把 VERSION 还原,不留下半套结果
 */
export async function advanceVersionForToday(options = {}) {
  const root = options.root || PROJECT_ROOT
  const now = options.now || new Date()
  const sync = typeof options.sync === 'function' ? options.sync : null
  const current = await readVersion(root)
  const version = versionForToday(current, now)
  if (version === current) {
    return { version, bump: null }
  }

  const file = versionFilePath(root)
  await writeFile(file, version, 'utf8')
  const synced = sync ? await sync(version) : { ok: true }
  if (!synced || synced.ok !== true) {
    await writeFile(file, current, 'utf8')
    const reason = synced && synced.error && synced.error.message ? synced.error.message : '未知原因'
    throw new VersionError('版本号同步失败: ' + reason)
  }

  return { version, bump: { from: current, to: version } }
}
