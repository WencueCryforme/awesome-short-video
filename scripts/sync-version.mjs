/*
 * 根目录 VERSION 文件是版本号的唯一来源,本脚本把它同步到 npm 包,锁定文件,站点常量与 README 徽章
 * 同步范围只含代码与包文件,md 文档内的版本号无法由 VERSION 自动修正,需手动更新
 * 带 --check 时只比对不写文件,供 CI 在构建前拦住版本号漂移
 * --root 指定项目根目录,缺省为仓库根目录,主要供测试使用
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECT_ROOT, parseArgs, resolveFromCwd } from './lib/cli.mjs'
import { emitResult, makeError } from './lib/result.mjs'
import { readVersion, versionToDate } from './lib/version.mjs'

const JSON_TARGETS = [
  {
    path: 'package.json',
    kind: 'json',
    values: data => [data.version],
    apply: (data, version) => {
      data.version = version
    }
  },
  {
    path: 'site/package.json',
    kind: 'json',
    values: data => [data.version],
    apply: (data, version) => {
      data.version = version
    }
  },
  {
    path: 'site/package-lock.json',
    kind: 'json',
    values: data => [data.version, data.packages && data.packages[''] ? data.packages[''].version : undefined],
    apply: (data, version) => {
      if (!data.packages || !data.packages['']) {
        throw new SyncError('锁定文件缺少 packages[""] 字段: site/package-lock.json', 'file')
      }
      data.version = version
      data.packages[''].version = version
    }
  }
]

/*
 * 文本型目标各自声明取值与替换规则,避免用同一套正则覆盖不同语法
 * expect 声明该文件里版本号应出现的次数,数量不符直接报错,防止新增同形态字段被静默一起改写
 * const.ts 的规则带行首两空格锚点,只认独立成行的字段,注释与字符串里的示例不参与
 * 徽章规则要求日期后面紧跟六位十六进制颜色或行末,避免带后缀的写法被部分替换
 */
const BADGE_SUFFIX = '(?=-[0-9a-fA-F]{6}(?![\\w-])|$)'

const TEXT_TARGETS = [
  {
    path: 'site/app/const.ts',
    kind: 'text',
    expect: 1,
    values: text => matchAll(text, /^ {2}version:\s*'(\d{4}\.\d{2}\.\d{2})'/gm),
    replace: (text, version) => text.replace(/^( {2}version:\s*')\d{4}\.\d{2}\.\d{2}'/gm, (all, head) => head + version + "'")
  },
  {
    path: 'README.md',
    kind: 'text',
    expect: 1,
    values: text => matchAll(text, new RegExp('badge/Version-(\\d{4}\\.\\d{2}\\.\\d{2})' + BADGE_SUFFIX, 'g')),
    replace: (text, version) => text.replace(new RegExp('(badge/Version-)\\d{4}\\.\\d{2}\\.\\d{2}' + BADGE_SUFFIX, 'g'), (all, head) => head + version)
  },
  {
    path: 'README_en-US.md',
    kind: 'text',
    expect: 1,
    values: text => matchAll(text, new RegExp('badge/Version-(\\d{4}\\.\\d{2}\\.\\d{2})' + BADGE_SUFFIX, 'g')),
    replace: (text, version) => text.replace(new RegExp('(badge/Version-)\\d{4}\\.\\d{2}\\.\\d{2}' + BADGE_SUFFIX, 'g'), (all, head) => head + version)
  }
]

class SyncError extends Error {
  constructor(message, kind, details) {
    super(message)
    this.kind = kind === undefined ? 'file' : kind
    this.details = details
  }
}

function matchAll(text, pattern) {
  const list = []
  for (const match of text.matchAll(pattern)) {
    list.push(match[1])
  }
  return list
}

function parseJson(text, path) {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new SyncError('不是合法的 JSON: ' + path + ' (' + error.message + ')', 'file', { path })
  }
}

/* 单个目标读取当前值并比对,写模式下只在确有差异时落盘 */
async function handleTarget(root, target, version, check) {
  const file = join(root, target.path)
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw new SyncError('文件缺失或不可读: ' + target.path, 'file', { path: target.path })
  }

  const data = target.kind === 'json' ? parseJson(text, target.path) : null
  const current = target.kind === 'json' ? target.values(data) : target.values(text)

  if (current.length === 0 || current.some(value => typeof value !== 'string' || value.length === 0)) {
    throw new SyncError('目标文件缺少版本号字段: ' + target.path, 'file', { path: target.path })
  }
  /* 文本目标的匹配数量必须与声明一致,多出来的一律视为新增了同形态字段,直接报错而不是一起改写 */
  if (Number.isInteger(target.expect) && current.length !== target.expect) {
    throw new SyncError(
      '目标文件里的版本号出现 ' + current.length + ' 次,期望 ' + target.expect + ' 次: ' + target.path,
      'file',
      { path: target.path, expected: target.expect, actual: current.length }
    )
  }
  if (current.every(value => value === version)) {
    return { path: target.path, status: 'ok', current }
  }
  if (check) {
    return { path: target.path, status: 'mismatch', current }
  }

  let next
  if (target.kind === 'json') {
    target.apply(data, version)
    next = JSON.stringify(data, null, 2) + '\n'
  } else {
    next = target.replace(text, version)
  }
  await writeFile(file, next, 'utf8')
  return { path: target.path, status: 'updated', current }
}

async function main() {
  const { options, positionals, errors } = parseArgs(process.argv.slice(2), {
    flags: ['check'],
    values: ['root']
  })

  if (errors.length > 0) {
    return fail('args', errors.join('; '))
  }
  if (positionals.length > 0) {
    return fail('args', '未知的位置参数: ' + positionals.join(' '))
  }

  const check = options.check === true
  const root = options.root ? resolveFromCwd(options.root) : PROJECT_ROOT

  let version
  try {
    version = await readVersion(root)
  } catch (error) {
    return fail(error.kind || 'version', error.message)
  }

  const records = []
  try {
    for (const target of [...JSON_TARGETS, ...TEXT_TARGETS]) {
      records.push(await handleTarget(root, target, version, check))
    }
  } catch (error) {
    return fail(error.kind || 'file', error.message, error.details)
  }

  const mismatches = records.filter(record => record.status === 'mismatch')
  if (check && mismatches.length > 0) {
    return fail('version', '版本号不一致: ' + mismatches.length + ' 个文件与 VERSION 不符,请运行 node scripts/sync-version.mjs', {
      version,
      root,
      mismatches: mismatches.map(record => ({ path: record.path, current: record.current }))
    })
  }

  emitResult({
    ok: true,
    data: {
      version,
      uploadDate: versionToDate(version),
      root,
      check,
      changed: records.filter(record => record.status === 'updated').map(record => record.path),
      files: records
    }
  })
}

function fail(kind, message, details) {
  return emitResult({ ok: false, error: makeError(message, kind, details) })
}

main().catch(error => fail('write', '未预期错误: ' + error.message))
