/*
 * 文件操作的公共小工具,供各脚本共用
 */
import { copyFile, rename, unlink } from 'node:fs/promises'

/* 先复制到同目录临时文件再改名,避免目标文件被写到一半 */
export async function replaceFile(source, target) {
  const tempPath = target + '.writing'
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
