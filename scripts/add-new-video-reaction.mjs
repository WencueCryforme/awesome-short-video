import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MANIFEST, PROJECT_ROOT, parseArgs, resolveSourcePaths } from './lib/cli.mjs'
import { readJsonDocument, writeJsonDocument } from './lib/json-style.mjs'
import { buildEntry } from './lib/manifest-entry.mjs'
import { runChildScript } from './lib/child.mjs'
import { removeQuietly, replaceFile } from './lib/fs-util.mjs'
import { emitResult, makeError } from './lib/result.mjs'

/*
 * 新增视频条目的图形界面入口: 启动本地页面收集条目字段,先写入临时清单,
 * 依次执行排序与校验脚本,全部通过后才覆盖正式清单
 */

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SCRIPT_DIR = dirname(SCRIPT_PATH)
const GUI_DIR = join(SCRIPT_DIR, 'gui', 'add-video-reaction')
const SORT_SCRIPT = join(SCRIPT_DIR, 'sort-video-manifest_tags.mjs')
const CHECK_SCRIPT = join(SCRIPT_DIR, 'check-video-manifest.mjs')
const TEMP_DIR = join(PROJECT_ROOT, 'temp')

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
])

/* 表单只有短文本字段, 1 MiB 足够容纳整份表单 */
const MAX_BODY_BYTES = 1 << 20

const { options, errors } = parseArgs(process.argv.slice(2), {
  flags: ['no-open'],
  values: ['manifest', 'tags', 'port']
})
const added = []

let manifestPath = DEFAULT_MANIFEST
let tagsPath = ''
let adding = false
let finished = false
let server = null

function display(target) {
  return relative(PROJECT_ROOT, target) || '.'
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  })
  response.end(body)
}

async function readJsonBody(request, limit = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) {
      throw new Error('请求内容过大')
    }
    chunks.push(chunk)
  }
  if (size === 0) {
    return {}
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function describeState() {
  const manifestDocument = await readJsonDocument(manifestPath)
  const tagsDocument = await readJsonDocument(tagsPath)
  const total = Array.isArray(manifestDocument.value.total) ? manifestDocument.value.total : []

  return {
    manifest: display(manifestPath),
    tagsFile: display(tagsPath),
    entryCount: total.length,
    tags: Array.isArray(tagsDocument.value) ? tagsDocument.value : []
  }
}

/* 先按字段校验表单,再交给排序与校验脚本把关 */
async function performAdd(form) {
  const { entry, problems } = buildEntry(form)
  if (problems.length > 0) {
    return {
      ok: false,
      error: makeError(problems[0].message, 'form', { field: problems[0].field, problems })
    }
  }

  let manifestDocument
  try {
    manifestDocument = await readJsonDocument(manifestPath)
  } catch (error) {
    return { ok: false, error: makeError('清单读取失败: ' + error.message, 'manifest') }
  }

  const total = Array.isArray(manifestDocument.value.total) ? manifestDocument.value.total : []
  const duplicated = total.find(item => item && item.filename === entry.filename)
  if (duplicated) {
    return {
      ok: false,
      error: makeError('清单已存在同名文件的条目: ' + duplicated.title, 'duplicate', { field: 'filename' })
    }
  }

  const tempManifest = join(dirname(manifestPath), 'manifest.temp.json')
  const tempTags = join(TEMP_DIR, 'tags.temp.json')
  const temporaryFiles = [tempManifest, tempTags]

  try {
    await mkdir(TEMP_DIR, { recursive: true })
    await copyFile(manifestPath, tempManifest)
    await copyFile(tagsPath, tempTags)

    const tempDocument = await readJsonDocument(tempManifest)
    const nextTotal = [...(Array.isArray(tempDocument.value.total) ? tempDocument.value.total : []), entry]
    await writeJsonDocument(tempManifest, { ...tempDocument.value, total: nextTotal }, tempDocument.style, { inlineTags: true })

    const sorted = runChildScript(SORT_SCRIPT, ['--manifest', tempManifest, '--tags', tempTags])
    if (!sorted.ok) {
      return {
        ok: false,
        error: makeError('排序脚本执行失败: ' + sorted.error.message, 'sort', { details: sorted.error.details })
      }
    }

    const checked = runChildScript(CHECK_SCRIPT, ['--manifest', tempManifest, '--tags', tempTags])
    if (!checked.ok) {
      return {
        ok: false,
        error: makeError('校验未通过: ' + checked.error.message, 'check', { details: checked.error.details })
      }
    }

    /* 排序脚本同时规范化了标签顺序,两份结果一起写回,避免清单与标签文件的排序状态不一致 */
    await replaceFile(tempManifest, manifestPath)
    await replaceFile(tempTags, tagsPath)
    added.push({ title: entry.title, filename: entry.filename })

    return {
      ok: true,
      data: {
        entry,
        manifest: display(manifestPath),
        count: nextTotal.length
      }
    }
  } catch (error) {
    return { ok: false, error: makeError('写入临时清单失败: ' + error.message, 'write') }
  } finally {
    for (const target of temporaryFiles) {
      await removeQuietly(target)
    }
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1')
  const pathname = url.pathname

  if (request.method === 'GET' && STATIC_FILES.has(pathname)) {
    const [name, type] = STATIC_FILES.get(pathname)
    try {
      const content = await readFile(join(GUI_DIR, name))
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-length': content.length })
      response.end(content)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('页面资源读取失败: ' + error.message)
    }
    return
  }

  if (request.method === 'GET' && pathname === '/api/state') {
    try {
      sendJson(response, 200, { ok: true, data: await describeState() })
    } catch (error) {
      sendJson(response, 500, { ok: false, error: makeError('状态读取失败: ' + error.message, 'state') })
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/add') {
    if (adding) {
      sendJson(response, 429, { ok: false, error: makeError('上一次添加尚未结束,请稍后重试', 'busy') })
      return
    }
    adding = true
    try {
      const form = await readJsonBody(request)
      sendJson(response, 200, await performAdd(form))
    } catch (error) {
      sendJson(response, 500, { ok: false, error: makeError('添加过程异常: ' + error.message, 'add') })
    } finally {
      adding = false
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/shutdown') {
    sendJson(response, 200, { ok: true, data: { added: added.length } })
    setTimeout(finish, 20)
    return
  }

  sendJson(response, 404, { ok: false, error: makeError('未知请求: ' + pathname, 'route') })
}

/* 打开系统默认浏览器,失败时把地址输出到标准错误供手动访问 */
function openBrowser(target) {
  const platform = process.platform
  const command = platform === 'win32'
    ? ['cmd', ['/c', 'start', '', target]]
    : platform === 'darwin'
      ? ['open', [target]]
      : ['xdg-open', [target]]

  try {
    const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

function finish() {
  if (finished) {
    return
  }
  finished = true
  if (server) {
    server.closeAllConnections()
    server.close()
  }
  emitResult({ ok: true, data: { manifest: display(manifestPath), added } })
}

/* 被信号终止属于未正常结束,退出结果按失败上报,已写入的条目放在错误详情里 */
function interrupt() {
  if (finished) {
    return
  }
  finished = true
  if (server) {
    server.closeAllConnections()
    server.close()
  }
  emitResult({ ok: false, error: makeError('运行被中断,已添加 ' + added.length + ' 条', 'interrupted', { added }) })
}

async function main() {
  if (errors.length > 0) {
    emitResult({ ok: false, error: makeError(errors.join('; '), 'args') })
    return
  }

  try {
    const sourcePath = options.manifest ? resolve(process.cwd(), options.manifest) : DEFAULT_MANIFEST
    const manifestDocument = await readJsonDocument(sourcePath)
    const resolved = resolveSourcePaths(options, manifestDocument.value)
    manifestPath = resolved.manifestPath
    tagsPath = resolved.tagsPath
  } catch (error) {
    emitResult({ ok: false, error: makeError('清单与标签文件读取失败: ' + error.message, 'manifest') })
    return
  }

  const port = options.port === null ? 0 : Number(options.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    emitResult({ ok: false, error: makeError('端口号必须是 0 到 65535 的整数', 'args') })
    return
  }

  server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      sendJson(response, 500, { ok: false, error: makeError('请求处理失败: ' + error.message, 'server') })
    })
  })

  server.on('error', (error) => {
    if (finished) {
      return
    }
    finished = true
    emitResult({ ok: false, error: makeError('本地页面启动失败: ' + error.message, 'server') })
  })

  server.listen(port, '127.0.0.1', () => {
    const address = server.address()
    const target = 'http://127.0.0.1:' + address.port + '/'
    process.stderr.write('新增视频条目页面: ' + target + '\n')
    if (!options.noOpen && !openBrowser(target)) {
      process.stderr.write('未能自动打开浏览器,请手动访问上面的地址\n')
    }
  })

  process.on('SIGINT', interrupt)
  process.on('SIGTERM', interrupt)
}

main().catch((error) => {
  emitResult({ ok: false, error: makeError('未预期错误: ' + error.message, 'unexpected') })
})
