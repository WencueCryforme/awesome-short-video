import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from './cli.mjs'

/* 解析子进程标准输出最后一行的结果对象 */
export function parseResultLine(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) {
    return { ok: false, error: { kind: 'child', message: '子脚本没有输出' } }
  }

  const last = lines[lines.length - 1]
  try {
    const value = JSON.parse(last)
    if (value && typeof value === 'object' && typeof value.ok === 'boolean') {
      return value
    }
  } catch {
    /* 落到下方的统一错误 */
  }
  return { ok: false, error: { kind: 'child', message: '子脚本输出不是约定的结果对象: ' + last } }
}

/* 子进程输出写入临时文件,避免依赖管道,兼容受限执行环境 */
export function runChildScript(scriptPath, args = []) {
  const tempRoot = join(PROJECT_ROOT, 'temp')
  mkdirSync(tempRoot, { recursive: true })
  const token = randomUUID()
  const outPath = join(tempRoot, 'child-' + token + '.out')
  const errPath = join(tempRoot, 'child-' + token + '.err')
  const outFd = openSync(outPath, 'w')
  const errFd = openSync(errPath, 'w')

  let result
  try {
    result = spawnSync(process.execPath, [scriptPath, ...args], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', outFd, errFd]
    })
  } finally {
    closeSync(outFd)
    closeSync(errFd)
  }

  const stdout = readFileSync(outPath, 'utf8')
  const stderr = readFileSync(errPath, 'utf8')
  rmSync(outPath, { force: true })
  rmSync(errPath, { force: true })

  if (result.error) {
    return { ok: false, error: { kind: 'child', message: result.error.message }, status: null, stderr }
  }

  return { ...parseResultLine(stdout), status: result.status, stderr }
}
