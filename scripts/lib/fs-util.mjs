/*
 * 文件操作的公共小工具,供各脚本共用
 */
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/* 中间文件统一放在目标目录下的 temp 子目录,该目录被 git 忽略,残留文件不会进入仓库 */
export const TEMP_DIR_NAME = 'temp'

export function tempFilePathFor(filePath, suffix) {
  return join(dirname(filePath), TEMP_DIR_NAME, basename(filePath) + suffix)
}

/* 先复制到 temp 子目录的中间文件再改名,避免目标文件被写到一半,也避免在目标目录留下痕迹 */
export async function replaceFile(source, target) {
  const tempPath = tempFilePathFor(target, '.writing')
  await mkdir(dirname(tempPath), { recursive: true })
  await copyFile(source, tempPath)
  await rename(tempPath, target)
}

/* 删除临时文件失败不影响主流程,残留文件会在下次运行时覆盖 */
export async function removeQuietly(filePath) {
  try {
    await unlink(filePath)
  } catch {
    /* 文件不存在或已被删除时无需处理 */
  }
}
