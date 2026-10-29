/*
 * 从本地 video/file 目录批量捕获视频封面,产物写入 video/cover
 * 封面文件名为视频文件名(含后缀)再加 .jpg,站点按视频文件名直接拼接封面地址,封面数据不进入清单
 * 单个视频从第一帧起按固定步长逐帧判定,取第一个满足当前严苛等级全部条件的帧,取不到则退化为固定时间点的画面
 * 输出遵循 scripts/lib/result.mjs 的单行 JSON 协议,过程信息放在 data 或 error.details
 */
import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, stat } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { Worker, isMainThread, parentPort, threadId, workerData } from 'node:worker_threads'
import { PROJECT_ROOT, parseArgs } from './lib/cli.mjs'
import { removeQuietly } from './lib/fs-util.mjs'
import { emitResult, makeError } from './lib/result.mjs'

/* 配置区: 目录,后缀,取样步长,并发线程,颜色量化与容差,判定阈值与写出质量集中在此,便于按需调整 */
const CONFIG = {
  videoDir: 'video/file',
  coverDir: 'video/cover',
  videoExtensions: ['.mp4'],
  coverExtension: '.jpg',
  frameStepSeconds: 10,
  scanAttempts: 30,
  endGuardSeconds: 0.5,
  fallbackSeconds: 3,
  tailOffsetSeconds: 0.05,
  colorBits: 5,
  colorToleranceBins: 1,
  minColorFamilies: 3,
  maxDominantShare: 0.6,
  maxFamilyComponents: 2,
  minQualifiedFamilies: 2,
  componentConnectivity: 4,
  severityLevel: 2,
  jpegQuality: 1,
  maxThreads: 4,
  maxThreadsLimit: 16,
  coreShareDivisor: 2
}

const VIDEO_DIR = resolve(PROJECT_ROOT, CONFIG.videoDir)
const COVER_DIR = resolve(PROJECT_ROOT, CONFIG.coverDir)
const TEMP_DIR = resolve(PROJECT_ROOT, 'temp')

/*
 * --debug 时把处理进度与判定细节写到标准错误
 * 标准输出始终只有一行结果对象,进度信息不能混进去
 */
let debugEnabled = false

function debugLog(message) {
  if (!debugEnabled) {
    return
  }
  if (isMainThread) {
    process.stderr.write('[catch-video-cover] ' + message + '\n')
  } else {
    parentPort.postMessage({ type: 'log', line: message })
  }
}

/*
 * 并发数先取命令行与配置区的较小值,再受 CPU 核数一半约束,
 * 核数由脚本自行探测,命令行给得再大也不会超过核数一半,最终至少保留 1 个
 */
function resolveThreadCount(requested) {
  const cores = availableParallelism()
  const coreLimit = Math.max(1, Math.floor(cores / CONFIG.coreShareDivisor))
  const threads = Math.max(1, Math.min(requested, CONFIG.maxThreadsLimit, coreLimit))
  return { threads, cores, coreLimit }
}

function formatDuration(milliseconds) {
  return milliseconds >= 1000 ? (milliseconds / 1000).toFixed(1) + ' s' : Math.round(milliseconds) + ' ms'
}

/* 运行期统计,由 --debug 在末尾汇总命中与退化比例 */
const runStats = { content: 0, fallback: 0, failed: 0, frames: 0, startedAt: Date.now() }

function recordCapture(detail) {
  runStats[detail.method] += 1
  runStats.frames += detail.frames
}

function recordFailure() {
  runStats.failed += 1
}

function debugSummary() {
  debugLog('统计: 命中内容帧 ' + runStats.content + ' 个,退化固定帧 ' + runStats.fallback + ' 个,失败 ' + runStats.failed + ' 个,累计扫描 ' + runStats.frames + ' 帧,总用时 ' + formatDuration(Date.now() - runStats.startedAt))
}

/*
 * 颜色按通道取高位量化成色格,取值相邻的颜色由此落进同一色格或相邻色格
 * 复用同一块色格计数表,只清空当前帧占用的色格,避免逐帧大范围清零
 * familyOfBin 记录色格归入的颜色族编号,连通分量判定据此取出每个族的像素集合
 */
const colorCounter = new Uint32Array(1 << (CONFIG.colorBits * 3))
const colorBins = []
const familyRed = []
const familyGreen = []
const familyBlue = []
const familyCount = []
const familyOfBin = new Int16Array(1 << (CONFIG.colorBits * 3))
const familyComponents = []
let visitedMask = new Uint8Array(0)
let componentStack = new Int32Array(0)
let severityLevel = CONFIG.severityLevel

/*
 * 判定条件按严苛等级依次累加, -Ox 取前 x 个条件做逻辑与,缺失时取配置区的默认等级
 * 连通分量条件依赖逐族像素布局,只有等级覆盖到它时才计算,避免低等级下多花开销
 */
const CONDITIONS = [
  { name: '颜色族数量', test: stats => stats.families >= CONFIG.minColorFamilies },
  { name: '最大颜色族占比', test: stats => stats.share <= CONFIG.maxDominantShare },
  { name: '达标颜色族数量', test: stats => stats.qualifiedFamilies >= CONFIG.minQualifiedFamilies, needsComponents: true }
]
const COMPONENT_LEVEL = CONDITIONS.findIndex(item => item.needsComponents) + 1

let tempCounter = 0

/* 中间产物放在工作目录的 temp 目录内,用完即删 */
async function useTempPath(extension) {
  await mkdir(TEMP_DIR, { recursive: true })
  tempCounter += 1
  return join(TEMP_DIR, 'catch-video-cover-' + process.pid + '-' + threadId + '-' + tempCounter + extension)
}

function firstLine(text) {
  return String(text || '').trim().split(/\r?\n/)[0] || '无输出'
}

/*
 * 子进程的标准输出与标准错误一律走临时文件,不使用管道
 * 受限环境下管道可能不可用,文件描述符承载输出更稳,也不需要额外缓冲
 */
async function runProcess(command, args, options = {}) {
  const stderrPath = await useTempPath('.err')
  const stdoutPath = options.captureStdout ? await useTempPath('.out') : null

  try {
    const code = await new Promise((resolvePromise, rejectPromise) => {
      const errFd = openSync(stderrPath, 'w')
      const outFd = stdoutPath ? openSync(stdoutPath, 'w') : null
      const child = spawn(command, args, {
        stdio: ['ignore', outFd === null ? 'ignore' : outFd, errFd],
        windowsHide: true
      })

      /*
       * 启动失败时 error 与 close 会先后触发,文件描述符只能关闭一次,
       * 二次关闭会抛 EBADF 并逃出事件监听器,因此用 settled 保证只收尾一次
       */
      let settled = false
      const settle = () => {
        if (settled) {
          return false
        }
        settled = true
        closeSync(errFd)
        if (outFd !== null) {
          closeSync(outFd)
        }
        return true
      }

      child.on('error', error => {
        if (settle()) {
          rejectPromise(error)
        }
      })
      child.on('close', value => {
        if (settle()) {
          resolvePromise(value)
        }
      })
    })

    return {
      code,
      stdout: stdoutPath ? await readFile(stdoutPath) : Buffer.alloc(0),
      stderr: await readFile(stderrPath, 'utf8').catch(() => '')
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('未找到 ' + command + ',请先安装并确认可在命令行直接运行')
    }
    throw error
  } finally {
    await removeQuietly(stderrPath)
    if (stdoutPath) {
      await removeQuietly(stdoutPath)
    }
  }
}

/* 读取像素尺寸与时长,像素尺寸取自视频流本身,用于计算原始帧的字节数 */
async function probeVideo(filePath) {
  const result = await runProcess('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json',
    filePath
  ], { captureStdout: true })

  if (result.code !== 0) {
    throw new Error('ffprobe 读取失败: ' + firstLine(result.stderr))
  }

  let parsed
  try {
    parsed = JSON.parse(result.stdout.toString('utf8'))
  } catch {
    throw new Error('ffprobe 输出无法解析')
  }

  const stream = (parsed.streams || [])[0] || {}
  const width = Number(stream.width)
  const height = Number(stream.height)
  const duration = Number((parsed.format || {}).duration)

  if (!width || !height) {
    throw new Error('无法读取视频像素尺寸')
  }

  return {
    width,
    height,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0
  }
}

/*
 * 抓取指定时间点的一帧,同时写出原始像素与 JPEG
 * 原始像素用于判定,JPEG 在判定命中后直接作为封面,避免重复解码
 */
async function grabFramePair(filePath, at, rawPath, jpegPath) {
  const result = await runProcess('ffmpeg', [
    '-v', 'error',
    '-nostdin',
    '-y',
    '-ss', at.toFixed(3),
    '-i', filePath,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    rawPath,
    '-frames:v', '1',
    '-q:v', String(CONFIG.jpegQuality),
    '-an',
    '-sn',
    jpegPath
  ])

  if (result.code !== 0) {
    throw new Error('ffmpeg 抓帧失败(第 ' + at.toFixed(2) + ' 秒): ' + firstLine(result.stderr))
  }
}

/* 按原始帧字节数读取像素,不足一帧说明该时间点没有画面 */
async function readFramePixels(filePath, at, rawPath, jpegPath, frameSize) {
  await grabFramePair(filePath, at, rawPath, jpegPath)

  let bytes = 0
  try {
    bytes = (await stat(rawPath)).size
  } catch {
    return null
  }

  if (bytes < frameSize) {
    return null
  }

  const buffer = await readFile(rawPath)
  return buffer.subarray(0, frameSize)
}

/*
 * 色格按像素数量从多到少归并成颜色族: 与某个颜色族中心的各通道差值都不超过容差时并入该族
 * 每个颜色族按一种颜色计数,避免压缩噪声与轻微渐变把同一种颜色拆成多个取值
 */
function groupColorFamilies(bins) {
  const bits = CONFIG.colorBits
  const mask = (1 << bits) - 1
  const tolerance = CONFIG.colorToleranceBins

  bins.sort((left, right) => colorCounter[right] - colorCounter[left])

  familyRed.length = 0
  familyGreen.length = 0
  familyBlue.length = 0
  familyCount.length = 0

  for (const key of bins) {
    const red = (key >> (bits * 2)) & mask
    const green = (key >> bits) & mask
    const blue = key & mask
    let target = -1
    let bestGap = tolerance + 1

    for (let slot = 0; slot < familyCount.length; slot += 1) {
      const gap = Math.max(
        Math.abs(familyRed[slot] - red),
        Math.abs(familyGreen[slot] - green),
        Math.abs(familyBlue[slot] - blue)
      )
      if (gap < bestGap) {
        bestGap = gap
        target = slot
      }
    }

    if (target === -1) {
      familyRed.push(red)
      familyGreen.push(green)
      familyBlue.push(blue)
      familyCount.push(colorCounter[key])
      familyOfBin[key] = familyCount.length
    } else {
      familyCount[target] += colorCounter[key]
      familyOfBin[key] = target + 1
    }
  }

  let top = 0
  for (const count of familyCount) {
    if (count > top) {
      top = count
    }
  }

  return { families: familyCount.length, top }
}

/*
 * 逐族统计连通分量: 同族像素按相邻关系合并成若干块,块数不超过 maxFamilyComponents 的族计为达标族
 * 达标族数量用于排除由噪声凑出颜色族数量、实际画面仍然单调的帧
 */
function countQualifiedFamilies(pixels, width, height) {
  const total = width * height
  if (visitedMask.length !== total) {
    visitedMask = new Uint8Array(total)
    componentStack = new Int32Array(total)
  } else {
    visitedMask.fill(0, 0, total)
  }
  familyComponents.length = familyCount.length
  familyComponents.fill(0)

  const bits = CONFIG.colorBits
  const shift = 8 - bits
  const eight = CONFIG.componentConnectivity === 8
  const binKeyAt = index => {
    const offset = index * 3
    return ((pixels[offset] >> shift) << (bits * 2))
      | ((pixels[offset + 1] >> shift) << bits)
      | (pixels[offset + 2] >> shift)
  }

  for (let start = 0; start < total; start += 1) {
    if (visitedMask[start] === 1) {
      continue
    }

    const family = familyOfBin[binKeyAt(start)]
    familyComponents[family - 1] += 1

    let pointer = 1
    componentStack[0] = start
    visitedMask[start] = 1
    const tryPush = candidate => {
      if (visitedMask[candidate] === 1 || familyOfBin[binKeyAt(candidate)] !== family) {
        return
      }
      visitedMask[candidate] = 1
      componentStack[pointer] = candidate
      pointer += 1
    }

    while (pointer > 0) {
      pointer -= 1
      const index = componentStack[pointer]
      const x = index % width
      const y = (index - x) / width
      if (x > 0) {
        tryPush(index - 1)
      }
      if (x + 1 < width) {
        tryPush(index + 1)
      }
      if (y > 0) {
        tryPush(index - width)
        if (eight) {
          if (x > 0) {
            tryPush(index - width - 1)
          }
          if (x + 1 < width) {
            tryPush(index - width + 1)
          }
        }
      }
      if (y + 1 < height) {
        tryPush(index + width)
        if (eight) {
          if (x > 0) {
            tryPush(index + width - 1)
          }
          if (x + 1 < width) {
            tryPush(index + width + 1)
          }
        }
      }
    }
  }

  let qualified = 0
  for (const count of familyComponents) {
    if (count <= CONFIG.maxFamilyComponents) {
      qualified += 1
    }
  }

  return qualified
}

/* 取前 severityLevel 个条件做逻辑与,任一条件不满足即淘汰该帧 */
function matchesConditions(stats) {
  for (let index = 0; index < severityLevel; index += 1) {
    if (!CONDITIONS[index].test(stats)) {
      return false
    }
  }
  return true
}

/* 统计单帧的颜色族分布,达到连通分量等级时再统计达标颜色族数量 */
function frameColorStats(pixels, width, height) {
  const shift = 8 - CONFIG.colorBits
  const totalPixels = pixels.length / 3

  colorBins.length = 0
  for (let offset = 0; offset < pixels.length; offset += 3) {
    const key = ((pixels[offset] >> shift) << (CONFIG.colorBits * 2))
      | ((pixels[offset + 1] >> shift) << CONFIG.colorBits)
      | (pixels[offset + 2] >> shift)
    const count = colorCounter[key] + 1
    colorCounter[key] = count
    if (count === 1) {
      colorBins.push(key)
    }
  }

  const groups = groupColorFamilies(colorBins)
  const stats = { families: groups.families, share: groups.top / totalPixels }
  if (severityLevel >= COMPONENT_LEVEL) {
    stats.qualifiedFamilies = countQualifiedFamilies(pixels, width, height)
  }
  for (const key of colorBins) {
    colorCounter[key] = 0
    familyOfBin[key] = 0
  }

  return stats
}

/* 取不到符合条件的帧时,退化到固定时间点,时长不足则取最后一帧 */
function fallbackTimestamp(duration) {
  if (duration > 0 && duration < CONFIG.fallbackSeconds) {
    return Math.max(0, duration - CONFIG.tailOffsetSeconds)
  }
  return CONFIG.fallbackSeconds
}

async function captureCover(filePath, position = null) {
  const startedAt = Date.now()
  const label = position ? '[' + position.index + '/' + position.total + '] ' : ''
  debugLog(label + '开始 ' + basename(filePath))

  const info = await probeVideo(filePath)
  const frameSize = info.width * info.height * 3
  const frameLimit = CONFIG.scanAttempts
  const lastUsableAt = info.duration > 0 ? info.duration - CONFIG.endGuardSeconds : Number.POSITIVE_INFINITY
  const rawPath = await useTempPath('.raw')
  const jpegPath = await useTempPath('.jpg')
  const detail = { file: basename(filePath), cover: basename(filePath) + CONFIG.coverExtension, level: severityLevel, duration: Number(info.duration.toFixed(2)) }

  debugLog(label + '时长 ' + info.duration.toFixed(2) + ' s,画面 ' + info.width + 'x' + info.height + ',最多尝试 ' + frameLimit + ' 次')

  let scanned = 0

  try {
    for (let index = 0; index < frameLimit; index += 1) {
      const at = index * CONFIG.frameStepSeconds
      if (at > lastUsableAt) {
        debugLog(label + '采样点 ' + at.toFixed(1) + ' s 已超出时长 ' + info.duration.toFixed(2) + ' s,停止扫描')
        break
      }
      const pixels = await readFramePixels(filePath, at, rawPath, jpegPath, frameSize)
      if (pixels === null) {
        break
      }
      scanned += 1
      const stats = frameColorStats(pixels, info.width, info.height)
      const passed = matchesConditions(stats)
      debugLog(label + '帧 ' + at.toFixed(1) + ' s: 颜色族 ' + stats.families + ',最大占比 ' + stats.share.toFixed(4) + (stats.qualifiedFamilies === undefined ? '' : ',达标族 ' + stats.qualifiedFamilies) + (passed ? ' 命中' : ' 淘汰'))
      if (passed) {
        detail.method = 'content'
        detail.at = Number(at.toFixed(2))
        detail.frames = scanned
        detail.families = stats.families
        detail.share = Number(stats.share.toFixed(4))
        if (stats.qualifiedFamilies !== undefined) {
          detail.qualifiedFamilies = stats.qualifiedFamilies
        }
        await rename(jpegPath, join(COVER_DIR, detail.cover))
        recordCapture(detail)
        debugLog(label + '写出 ' + detail.cover + ',用时 ' + formatDuration(Date.now() - startedAt))
        return detail
      }
    }

    debugLog(label + '扫描 ' + scanned + ' 帧未命中,退化为第 ' + fallbackTimestamp(info.duration).toFixed(2) + ' 秒画面')
    detail.method = 'fallback'
    detail.at = Number(fallbackTimestamp(info.duration).toFixed(2))
    detail.frames = scanned
    let pixels = await readFramePixels(filePath, detail.at, rawPath, jpegPath, frameSize)

    /* 时长读不出来时退化点可能落在文件末尾之后,此时改用首帧 */
    if (pixels === null && detail.at > 0) {
      detail.at = 0
      pixels = await readFramePixels(filePath, 0, rawPath, jpegPath, frameSize)
    }
    if (pixels === null) {
      throw new Error('无法读取第 ' + detail.at + ' 秒的画面')
    }
    await rename(jpegPath, join(COVER_DIR, detail.cover))
    recordCapture(detail)
    debugLog(label + '写出 ' + detail.cover + ',用时 ' + formatDuration(Date.now() - startedAt))
    return detail
  } finally {
    await removeQuietly(rawPath)
    await removeQuietly(jpegPath)
  }
}

function isVideoFile(name) {
  return CONFIG.videoExtensions.includes(extname(name).toLowerCase())
}

/* 目录不存在时按空集合处理,便于首次运行 */
async function readDirectory(dirPath) {
  try {
    return await readdir(dirPath)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

async function listVideoFiles() {
  const names = await readDirectory(VIDEO_DIR)
  return names.filter(isVideoFile).sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

/* 校验模式: 只核对视频与封面的一一对应关系,不读取视频内容 */
async function runCheck(singlePath) {
  debugLog('校验模式: 只核对视频与封面的一一对应,不读取视频内容')
  const covers = (await readDirectory(COVER_DIR)).filter(name => name.endsWith(CONFIG.coverExtension))

  if (singlePath) {
    const videoName = basename(singlePath)
    const expected = videoName + CONFIG.coverExtension
    const data = { videoDir: VIDEO_DIR, coverDir: COVER_DIR, videos: 1, covers: covers.length, scope: [videoName] }

    if (!covers.includes(expected)) {
      emitResult({ ok: false, error: makeError('封面缺失: ' + expected, 'cover', { ...data, missing: [expected], orphan: [] }) })
      return
    }
    emitResult({ ok: true, data: { ...data, missing: [], orphan: [] } })
    return
  }

  const videos = await listVideoFiles()
  const expected = videos.map(name => name + CONFIG.coverExtension)
  const expectedSet = new Set(expected)
  const coverSet = new Set(covers)
  const missing = expected.filter(name => !coverSet.has(name))
  const orphan = covers.filter(name => !expectedSet.has(name))
  const data = { videoDir: VIDEO_DIR, coverDir: COVER_DIR, videos: videos.length, covers: covers.length }
  debugLog('视频 ' + videos.length + ' 个,封面 ' + covers.length + ' 张,缺少 ' + missing.length + ',多余 ' + orphan.length)

  if (missing.length > 0 || orphan.length > 0) {
    const parts = []
    if (missing.length > 0) {
      parts.push('缺少 ' + missing.length + ' 张')
    }
    if (orphan.length > 0) {
      parts.push('多余 ' + orphan.length + ' 张')
    }
    emitResult({ ok: false, error: makeError('视频与封面不是一一对应: ' + parts.join(', '), 'cover', { ...data, missing, orphan }) })
    return
  }

  emitResult({ ok: true, data: { ...data, missing: [], orphan: [] } })
}

function errorText(error) {
  return String(error && error.message ? error.message : error)
}

/*
 * 工作线程复用同一个脚本,判定用的计数表与缓冲在各线程内独立存在,互不共享
 * 捕获结果与日志经消息通道回传,日志由主线程统一写出,避免多线程写标准错误互相穿插
 */
function createWorkerSlot() {
  const worker = new Worker(new URL(import.meta.url), { workerData: { severityLevel, debug: debugEnabled } })
  let settle = null
  let dead = false

  const failPending = message => {
    if (settle) {
      const current = settle
      settle = null
      current.reject(new Error(message))
    }
  }

  worker.on('message', message => {
    if (message.type === 'log') {
      debugLog(message.line)
      return
    }
    if (!settle) {
      return
    }
    const current = settle
    settle = null
    if (message.type === 'done') {
      current.resolve(message.detail)
    } else {
      current.reject(new Error(message.message))
    }
  })

  worker.on('error', error => {
    dead = true
    failPending(errorText(error))
  })

  worker.on('exit', code => {
    dead = true
    failPending('工作线程意外退出,退出码 ' + code)
  })

  return {
    get dead() {
      return dead
    },
    run(file, position) {
      if (dead) {
        return Promise.reject(new Error('工作线程已退出'))
      }
      return new Promise((resolvePromise, rejectPromise) => {
        settle = { resolve: resolvePromise, reject: rejectPromise }
        worker.postMessage({ file, position })
      })
    },
    close() {
      return worker.terminate()
    }
  }
}

/*
 * 单线程时直接在本进程内逐个捕获;多线程时开若干工作线程按同一队列取活
 * 结果按文件原索引回填,输出顺序与单线程一致,失败记录单独收集不中断其余文件
 */
async function runCaptures(files, threads) {
  const results = new Array(files.length).fill(null)
  const failures = []
  let nextIndex = 0

  const recordFailureFor = (index, name, error) => {
    failures.push({ file: name, message: errorText(error) })
    recordFailure()
    debugLog('[' + (index + 1) + '/' + files.length + '] 失败 ' + name + ': ' + errorText(error))
  }

  if (threads <= 1) {
    for (let index = 0; index < files.length; index += 1) {
      const name = files[index]
      try {
        results[index] = await captureCover(join(VIDEO_DIR, name), { index: index + 1, total: files.length })
      } catch (error) {
        recordFailureFor(index, name, error)
      }
    }
    return { captured: results.filter(item => item !== null), failed: failures }
  }

  async function runLane() {
    let slot = createWorkerSlot()
    try {
      while (nextIndex < files.length) {
        const index = nextIndex
        nextIndex += 1
        const name = files[index]
        if (slot.dead) {
          slot = createWorkerSlot()
        }
        try {
          const detail = await slot.run(join(VIDEO_DIR, name), { index: index + 1, total: files.length })
          results[index] = detail

          /* 批量统计由主线程汇总,工作线程内的统计只作用于它自己的运行期 */
          recordCapture(detail)
        } catch (error) {
          recordFailureFor(index, name, error)
        }
      }
    } finally {
      await slot.close()
    }
  }

  const lanes = []
  for (let lane = 0; lane < Math.min(threads, files.length); lane += 1) {
    lanes.push(runLane())
  }
  await Promise.all(lanes)

  return { captured: results.filter(item => item !== null), failed: failures }
}

/* 批量模式: 多线程捕获封面,单个失败不中断其余视频 */
async function runBatch(requestedThreads) {
  const files = await listVideoFiles()

  if (files.length === 0) {
    emitResult({ ok: false, error: makeError('视频目录内没有可处理的文件: ' + VIDEO_DIR, 'source', { videoDir: VIDEO_DIR, extensions: CONFIG.videoExtensions }) })
    return
  }

  await mkdir(COVER_DIR, { recursive: true })

  const startedAt = Date.now()
  const plan = resolveThreadCount(requestedThreads)

  debugLog('批量模式: 共 ' + files.length + ' 个视频,等级 -O' + severityLevel + ',并发 ' + plan.threads + ' 线程(请求 ' + requestedThreads + ',CPU 核数 ' + plan.cores + ',核数一半上限 ' + plan.coreLimit + '),封面目录 ' + COVER_DIR)

  const { captured, failed } = await runCaptures(files, plan.threads)

  debugLog('批量结束: 成功 ' + captured.length + ' 个,失败 ' + failed.length + ' 个,总用时 ' + formatDuration(Date.now() - startedAt))
  debugSummary()

  if (failed.length > 0) {
    emitResult({
      ok: false,
      error: makeError(
        '封面捕获失败 ' + failed.length + ' 个: ' + failed[0].file + ' ' + failed[0].message,
        'cover',
        { videoDir: VIDEO_DIR, coverDir: COVER_DIR, total: files.length, captured, failed }
      )
    })
    return
  }

  emitResult({
    ok: true,
    data: {
      videoDir: VIDEO_DIR,
      coverDir: COVER_DIR,
      level: severityLevel,
      threads: plan.threads,
      total: files.length,
      fallback: captured.filter(item => item.method === 'fallback').map(item => item.file),
      captured
    }
  })
}

/* -Ox 是单横线选项,先从参数里摘出,其余参数交给通用解析器 */
function extractSeverityLevel(argv) {
  const rest = []
  const errors = []
  let level = CONFIG.severityLevel

  for (const arg of argv) {
    const matched = /^-O(\d+)$/.exec(arg)
    if (matched) {
      const value = Number(matched[1])
      if (value >= 1 && value <= CONDITIONS.length) {
        level = value
      } else {
        errors.push('选项 -Ox 只接受 1 到 ' + CONDITIONS.length + ' 的整数: ' + arg)
      }
      continue
    }
    if (arg.startsWith('-O')) {
      errors.push('选项 -Ox 需要写成 -O1 到 -O' + CONDITIONS.length + ': ' + arg)
      continue
    }
    rest.push(arg)
  }

  return { level, rest, errors }
}

/* 配置区取值先做合法性检查,配置写错时直接给出可读错误,不在深层逻辑里留下静默兜底 */
function configProblems() {
  const problems = []

  if (!Number.isInteger(CONFIG.colorBits) || CONFIG.colorBits < 1 || CONFIG.colorBits > 8) {
    problems.push('colorBits 必须是 1 到 8 的整数: ' + CONFIG.colorBits)
  }
  if (CONFIG.componentConnectivity !== 4 && CONFIG.componentConnectivity !== 8) {
    problems.push('componentConnectivity 只能取 4 或 8: ' + CONFIG.componentConnectivity)
  }
  if (!(CONFIG.frameStepSeconds > 0)) {
    problems.push('frameStepSeconds 必须大于 0: ' + CONFIG.frameStepSeconds)
  }
  if (!Number.isInteger(CONFIG.scanAttempts) || CONFIG.scanAttempts < 1) {
    problems.push('scanAttempts 必须是正整数: ' + CONFIG.scanAttempts)
  }
  if (!(CONFIG.endGuardSeconds >= 0)) {
    problems.push('endGuardSeconds 不能为负数: ' + CONFIG.endGuardSeconds)
  }
  if (!(CONFIG.maxDominantShare >= 0 && CONFIG.maxDominantShare <= 1)) {
    problems.push('maxDominantShare 必须落在 0 到 1 之间: ' + CONFIG.maxDominantShare)
  }
  for (const key of ['colorToleranceBins', 'minColorFamilies', 'maxFamilyComponents', 'minQualifiedFamilies']) {
    if (!Number.isInteger(CONFIG[key]) || CONFIG[key] < 0) {
      problems.push(key + ' 必须是非负整数: ' + CONFIG[key])
    }
  }
  if (!Number.isInteger(CONFIG.severityLevel) || CONFIG.severityLevel < 1 || CONFIG.severityLevel > CONDITIONS.length) {
    problems.push('severityLevel 必须是 1 到 ' + CONDITIONS.length + ' 的整数: ' + CONFIG.severityLevel)
  }
  if (!Array.isArray(CONFIG.videoExtensions) || CONFIG.videoExtensions.length === 0) {
    problems.push('videoExtensions 必须是非空数组')
  }
  if (!Number.isInteger(CONFIG.maxThreadsLimit) || CONFIG.maxThreadsLimit < 1) {
    problems.push('maxThreadsLimit 必须是正整数: ' + CONFIG.maxThreadsLimit)
  }
  if (!Number.isInteger(CONFIG.maxThreads) || CONFIG.maxThreads < 1 || CONFIG.maxThreads > CONFIG.maxThreadsLimit) {
    problems.push('maxThreads 必须是 1 到 maxThreadsLimit 的整数: ' + CONFIG.maxThreads)
  }
  if (!(CONFIG.coreShareDivisor >= 1)) {
    problems.push('coreShareDivisor 不能小于 1: ' + CONFIG.coreShareDivisor)
  }

  return problems
}

async function main() {
  const configIssues = configProblems()
  if (configIssues.length > 0) {
    emitResult({ ok: false, error: makeError(configIssues[0], 'config', { problems: configIssues }) })
    return
  }

  const levelResult = extractSeverityLevel(process.argv.slice(2))
  severityLevel = levelResult.level

  const { options, positionals, errors } = parseArgs(levelResult.rest, {
    flags: ['check', 'single', 'debug'],
    values: ['td']
  })
  const cliErrors = levelResult.errors.concat(errors)

  if (cliErrors.length > 0) {
    emitResult({ ok: false, error: makeError(cliErrors[0], 'cli', { errors: cliErrors }) })
    return
  }
  if (options.single && positionals.length === 0) {
    emitResult({ ok: false, error: makeError('--single 模式需要传入视频文件路径', 'cli') })
    return
  }
  if (!options.single && positionals.length > 0) {
    emitResult({ ok: false, error: makeError('位置参数只在 --single 模式下使用,多余的参数: ' + positionals.join(' '), 'cli') })
    return
  }

  let requestedThreads = CONFIG.maxThreads
  if (options.td !== null && options.td !== undefined) {
    const value = Number(options.td)
    if (!Number.isInteger(value) || value < 1 || value > CONFIG.maxThreadsLimit) {
      emitResult({ ok: false, error: makeError('选项 --td 只接受 1 到 ' + CONFIG.maxThreadsLimit + ' 的整数: ' + options.td, 'cli') })
      return
    }
    requestedThreads = value
  }

  debugEnabled = options.debug === true

  if (debugEnabled) {
    debugLog('等级 -O' + severityLevel + ',采样步长 ' + CONFIG.frameStepSeconds + ' s,最多尝试 ' + CONFIG.scanAttempts + ' 次,退化点 ' + CONFIG.fallbackSeconds + ' s')
    debugLog('颜色量化 ' + CONFIG.colorBits + ' 位,容差 ' + CONFIG.colorToleranceBins + ' 格,阈值 族数>=' + CONFIG.minColorFamilies + ',占比<=' + CONFIG.maxDominantShare + ',达标族>=' + CONFIG.minQualifiedFamilies + ',连通性 ' + CONFIG.componentConnectivity)
    debugLog('视频目录 ' + VIDEO_DIR + ',封面目录 ' + COVER_DIR)
  }

  if (options.single) {
    const singlePath = resolve(process.cwd(), positionals[0])

    if (options.check) {
      await runCheck(singlePath)
      return
    }

    const exists = await stat(singlePath).then(item => item.isFile()).catch(() => false)
    if (!exists) {
      emitResult({ ok: false, error: makeError('视频文件不存在: ' + singlePath, 'source') })
      return
    }

    await mkdir(COVER_DIR, { recursive: true })
    try {
      const detail = await captureCover(singlePath, { index: 1, total: 1 })
      emitResult({ ok: true, data: { coverDir: COVER_DIR, level: severityLevel, total: 1, fallback: detail.method === 'fallback' ? [detail.file] : [], captured: [detail] } })
    } catch (error) {
      recordFailure()
      emitResult({ ok: false, error: makeError(String(error && error.message ? error.message : error), 'cover', { file: basename(singlePath) }) })
    }
    debugSummary()
    return
  }

  if (options.check) {
    await runCheck(null)
    return
  }

  await runBatch(requestedThreads)
}

/*
 * 主线程跑命令行流程,工作线程只等待主线程分发的捕获任务
 * 严苛等级与调试开关随 workerData 传入,两侧的判定条件与日志行为保持一致
 */
if (isMainThread) {
  main().catch(error => {
    emitResult({ ok: false, error: makeError('未预期错误: ' + errorText(error), 'unexpected') })
  })
} else {
  severityLevel = Number.isInteger(workerData.severityLevel) ? workerData.severityLevel : CONFIG.severityLevel
  debugEnabled = workerData.debug === true

  parentPort.on('message', async message => {
    try {
      const detail = await captureCover(message.file, message.position)
      parentPort.postMessage({ type: 'done', detail })
    } catch (error) {
      parentPort.postMessage({ type: 'error', message: errorText(error) })
    }
  })
}
