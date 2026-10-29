/*
 * 脚本输出协议: 每个脚本的标准输出有且只有一行 JSON 对象,形如 Promise 的完成或拒绝状态
 * 成功 { "ok": true, "data": ... };失败 { "ok": false, "error": { "kind": ..., "message": ..., "details"?: ... } }
 * 退出码成功为 0,失败为 1
 */

export function makeError(message, kind = 'error', details) {
  const error = { kind: String(kind), message: String(message) }
  if (details !== undefined) {
    error.details = details
  }
  return error
}

/* 输出唯一一行结果并设置退出码 */
export function emitResult(result) {
  const ok = Boolean(result) && result.ok === true
  const payload = ok
    ? { ok: true, data: result.data === undefined ? null : result.data }
    : { ok: false, error: result && result.error ? result.error : makeError('未提供错误信息') }

  process.stdout.write(JSON.stringify(payload) + '\n')
  process.exitCode = ok ? 0 : 1
  return payload
}
