import { INLINE_ARG } from './cli.mjs'

/*
 * 脚本输出协议: 每个脚本的标准输出有且只有一个 JSON 结果对象,形如 Promise 的完成或拒绝状态
 * 成功 { "ok": true, "data": ... };失败 { "ok": false, "error": { "kind": ..., "message": ..., "details"?: ... } }
 * 缺省格式化输出,便于人工查看;命令行带 --inline 时压成单行,便于跨脚本调用按末行解析
 * 退出码成功为 0,失败为 1
 */

const PRETTY_INDENT = 2

export function makeError(message, kind = 'error', details) {
  const error = { kind: String(kind), message: String(message) }
  if (details !== undefined) {
    error.details = details
  }
  return error
}

/* 命令行是否要求单行输出,跨脚本调用会显式携带该选项 */
export function isInlineOutput(argv = process.argv.slice(2)) {
  return argv.includes(INLINE_ARG)
}

export function stringifyResult(payload, inline) {
  return inline ? JSON.stringify(payload) : JSON.stringify(payload, null, PRETTY_INDENT)
}

/* 输出唯一一个结果对象并设置退出码 */
export function emitResult(result, options = {}) {
  const ok = Boolean(result) && result.ok === true
  const payload = ok
    ? { ok: true, data: result.data === undefined ? null : result.data }
    : { ok: false, error: result && result.error ? result.error : makeError('未提供错误信息') }
  const inline = options.inline === undefined ? isInlineOutput() : Boolean(options.inline)

  process.stdout.write(stringifyResult(payload, inline) + '\n')
  process.exitCode = ok ? 0 : 1
  return payload
}
