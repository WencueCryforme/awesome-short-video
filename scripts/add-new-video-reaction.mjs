import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MANIFEST, INLINE_ARG, PROJECT_ROOT, parseArgs, resolveSourcePaths } from './lib/cli.mjs'
import { readJsonDocument, writeJsonDocument } from './lib/json-style.mjs'
import { buildEntry } from './lib/manifest-entry.mjs'
import { primaryHashId } from './lib/hash-id.mjs'
import { conflictsOf, defaultHisPath, planHisUpdate, readHisDocument, writeHisDocument } from './lib/manifest-his.mjs'
import { SIMILARITY_THRESHOLD, bestSimilarEntry } from './lib/similarity.mjs'
import { advanceVersionForToday, readVersion, versionForToday } from './lib/version.mjs'
import { runChildScript } from './lib/child.mjs'
import { removeQuietly, replaceFile, tempFilePathFor } from './lib/fs-util.mjs'
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
const SYNC_VERSION_SCRIPT = join(SCRIPT_DIR, 'sync-version.mjs')
const COVER_SCRIPT = join(SCRIPT_DIR, 'catch-video-cover.mjs')
const TRY2_SCRIPT = join(SCRIPT_DIR, 'try2-update-manifest-his.mjs')

/* 封面判定等级的取值区间与 catch-video-cover.mjs 的条件个数保持一致,缺省取最严格的一档 */
const COVER_LEVEL_MIN = 1
const COVER_LEVEL_MAX = 3
const COVER_LEVEL_DEFAULT = 3

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
let coverJob = null
let coverJobSeq = 0

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

  /* 文件名不同但内容相近时同样视为重复,避免同一段视频以两个 hash_id 重复收录 */
  const similar = bestSimilarEntry(entry, total)
  if (similar && similar.score >= SIMILARITY_THRESHOLD) {
    const score = Number(similar.score.toFixed(3))
    return {
      ok: false,
      error: makeError('清单已存在内容相近的条目: ' + similar.entry.title + ',相似度 ' + score, 'duplicate', { field: 'title', filename: similar.entry.filename, score })
    }
  }

  const hisPath = defaultHisPath(manifestPath)
  const tempManifest = tempFilePathFor(manifestPath, '.temp.json')
  const tempTags = tempFilePathFor(tagsPath, '.temp.json')
  const tempHis = tempFilePathFor(hisPath, '.temp.json')
  const temporaryFiles = [tempManifest, tempTags, tempHis]

  try {
    await mkdir(dirname(tempManifest), { recursive: true })
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

    /* 排序脚本给出新条目的 hash_id,先登记进历史文件再与清单一起提交,避免历史文件落后于清单 */
    const sortedDocument = await readJsonDocument(tempManifest)
    const sortedTotal = Array.isArray(sortedDocument.value.total) ? sortedDocument.value.total : []
    const sortedEntry = sortedTotal.find(item => item && item.filename === entry.filename)
    const hashId = sortedEntry ? primaryHashId(sortedEntry) : ''
    if (hashId === '') {
      return {
        ok: false,
        error: makeError('排序结果缺少条目 hash_id: ' + entry.filename, 'sort')
      }
    }

    /*
     * 登记日期取自版本号,先把版本号推进到当天再登记
     * 否则先加视频后提版本时,新条目会被钉在上一个版本日期
     */
    const now = new Date()
    const currentVersion = await readVersion()
    const version = versionForToday(currentVersion, now)
    const hisDocument = await readHisDocument(hisPath)
    const planned = planHisUpdate(sortedDocument.value, hisDocument.value, { version, acceptNew: [hashId] })
    const conflicts = conflictsOf(planned.report)
    if (conflicts.length > 0) {
      return {
        ok: false,
        error: makeError('历史文件存在 ' + conflicts.length + ' 处无法自动判定的冲突,请先运行 node scripts/merge-into-manifest-his.mjs 处理', 'conflict', { conflicts })
      }
    }
    /* 版本号落后当天时先写 VERSION 再交给同步脚本,失败则把版本号还原,不留下半套结果 */
    let versionBump = null
    if (version !== currentVersion) {
      try {
        const advanced = await advanceVersionForToday({
          now,
          sync: () => runChildScript(SYNC_VERSION_SCRIPT, [])
        })
        versionBump = advanced.bump
      } catch (error) {
        return {
          ok: false,
          error: makeError(error.message, 'version', { from: currentVersion, to: version })
        }
      }
    }

    await writeHisDocument(tempHis, planned.value)

    /* 排序脚本同时规范化了标签顺序,三份结果一起写回,避免清单,标签文件与历史文件互相不一致 */
    await replaceFile(tempManifest, manifestPath)
    await replaceFile(tempTags, tagsPath)
    await replaceFile(tempHis, hisPath)
    added.push({ title: entry.title, filename: entry.filename, hashId })

    return {
      ok: true,
      data: {
        entry,
        manifest: display(manifestPath),
        count: nextTotal.length,
        version,
        versionBump
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

/* ---- 封面捕获任务: 独立子进程逐行回传进度,与条目写入互不阻塞 ---- */

/* 本地视频目录与清单文件同级,清单在 video/ 下,视频在 video/file/ 下 */
function videoFileDir() {
  return join(dirname(manifestPath), 'file')
}

/* 按行读取子进程输出,过滤空行,末行不带换行时也要交付 */
function readLines(stream, onLine) {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      if (line !== '') {
        onLine(line)
      }
      index = buffer.indexOf('\n')
    }
  })
  stream.on('end', () => {
    const line = buffer.replace(/\r$/, '')
    if (line !== '') {
      onLine(line)
    }
  })
}

function pushCoverEvent(job, event) {
  job.events.push(event)
  for (const send of job.listeners) {
    send(event)
  }
  if (event.type === 'end') {
    job.finished = true
    job.listeners.clear()
  }
}

/* 封面捕获结束后只做只读校验,不在后台改写历史文件,避免与主流程争抢同一份数据 */
function pushHisCheck(job) {
  const checked = runChildScript(TRY2_SCRIPT, ['--check'])
  if (checked.ok) {
    pushCoverEvent(job, { type: 'check', ok: true, message: '历史文件与清单一致' })
    return
  }
  const message = checked.error ? checked.error.message : '历史文件校验失败'
  pushCoverEvent(job, { type: 'check', ok: false, message })
}

/* 等级缺省取最严格的一档,取值越界视为参数错误,不静默降级 */
function parseCoverLevel(value) {
  if (value === undefined || value === null || value === '') {
    return { level: COVER_LEVEL_DEFAULT }
  }
  const level = Number(value)
  if (!Number.isInteger(level) || level < COVER_LEVEL_MIN || level > COVER_LEVEL_MAX) {
    return {
      level: COVER_LEVEL_DEFAULT,
      error: makeError('封面等级只接受 ' + COVER_LEVEL_MIN + ' 到 ' + COVER_LEVEL_MAX + ': ' + value, 'args')
    }
  }
  return { level }
}

function startCoverJob(filename, level = COVER_LEVEL_DEFAULT) {
  const name = String(filename || '').trim()
  if (name === '') {
    return { ok: false, error: makeError('缺少文件名,无法定位本地视频', 'args') }
  }
  if (coverJob && !coverJob.finished) {
    return { ok: false, error: makeError('上一个封面任务尚未结束,请等待其完成', 'busy', { filename: coverJob.filename }) }
  }

  const target = join(videoFileDir(), name)
  if (!existsSync(target)) {
    return {
      ok: false,
      error: makeError('本地视频文件不存在: ' + display(target) + ',请先把视频放到该目录再捕获封面', 'source', { file: display(target) })
    }
  }

  const job = {
    id: 'cover-' + (coverJobSeq += 1),
    filename: name,
    level,
    events: [],
    listeners: new Set(),
    finished: false,
    child: null
  }
  coverJob = job
  pushCoverEvent(job, { type: 'log', text: '[add-new] 开始为 ' + name + ' 捕获封面,等级 -O' + level })

  /* 子脚本统一带 --inline,结果对象压成单行,便于按末行解析 */
  const child = spawn(process.execPath, [COVER_SCRIPT, '--single', target, '-O' + level, '--debug', INLINE_ARG], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  job.child = child

  const resultLines = []
  readLines(child.stdout, (line) => resultLines.push(line))
  readLines(child.stderr, (line) => pushCoverEvent(job, { type: 'log', text: line }))

  child.on('error', (error) => {
    pushCoverEvent(job, { type: 'result', ok: false, exitCode: null, message: '封面脚本启动失败: ' + error.message })
    pushCoverEvent(job, { type: 'check', ok: false, message: '封面未产出,跳过后置校验' })
    pushCoverEvent(job, { type: 'end' })
  })

  child.on('close', (code) => {
    let result = null
    const last = resultLines.length > 0 ? resultLines[resultLines.length - 1] : ''
    try {
      result = JSON.parse(last)
    } catch {
      result = null
    }
    const ok = code === 0 && result !== null && result.ok === true
    pushCoverEvent(job, {
      type: 'result',
      ok,
      exitCode: code,
      message: ok ? '封面已写入 video/cover/,重建站点后可在页面看到' : '封面捕获失败,可按提示重试',
      result
    })
    pushHisCheck(job)
    pushCoverEvent(job, { type: 'end' })
  })

  return { ok: true, data: { jobId: job.id, filename: name, file: display(target) } }
}

/* 结束服务时一并终止仍在运行的封面任务,避免子进程留在后台 */
function stopCoverJob() {
  if (coverJob && coverJob.child && !coverJob.finished) {
    coverJob.child.kill()
  }
}

/* 请求断开时只摘掉监听,任务本身继续跑完并写盘 */
function attachCoverStream(job, response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive'
  })
  const send = (event) => {
    response.write('data: ' + JSON.stringify(event) + '\n\n')
    if (event.type === 'end') {
      response.end()
    }
  }
  for (const event of job.events) {
    send(event)
  }
  if (job.finished) {
    response.end()
    return
  }
  job.listeners.add(send)
  if (job.finished) {
    job.listeners.delete(send)
    response.end()
    return
  }
  response.on('close', () => {
    job.listeners.delete(send)
  })
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
      const parsedLevel = parseCoverLevel(form && form.coverLevel)
      if (parsedLevel.error) {
        sendJson(response, 400, { ok: false, error: parsedLevel.error })
        return
      }
      const result = await performAdd(form)
      if (result.ok) {
        /* 条目落盘后立刻拉起封面任务,失败不影响已添加的条目 */
        const started = startCoverJob(result.data.entry.filename, parsedLevel.level)
        result.data.cover = started.ok ? started.data : { error: started.error }
      }
      sendJson(response, 200, result)
    } catch (error) {
      sendJson(response, 500, { ok: false, error: makeError('添加过程异常: ' + error.message, 'add') })
    } finally {
      adding = false
    }
    return
  }

  if (request.method === 'POST' && pathname === '/api/cover') {
    try {
      const body = await readJsonBody(request)
      const parsedLevel = parseCoverLevel(body && body.level)
      if (parsedLevel.error) {
        sendJson(response, 400, { ok: false, error: parsedLevel.error })
        return
      }
      const started = startCoverJob(body && body.filename, parsedLevel.level)
      sendJson(response, started.ok ? 200 : 409, started)
    } catch (error) {
      sendJson(response, 500, { ok: false, error: makeError('封面任务启动失败: ' + error.message, 'cover') })
    }
    return
  }

  if (request.method === 'GET' && pathname === '/api/cover/stream') {
    const id = url.searchParams.get('id') || ''
    if (!coverJob || coverJob.id !== id) {
      sendJson(response, 404, { ok: false, error: makeError('封面任务不存在: ' + id, 'cover') })
      return
    }
    attachCoverStream(coverJob, response)
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
  stopCoverJob()
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
  stopCoverJob()
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
