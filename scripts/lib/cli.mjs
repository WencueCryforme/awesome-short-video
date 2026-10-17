import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const DEFAULT_MANIFEST = resolve(PROJECT_ROOT, 'video', 'manifest.json')

const FLAG_OPTIONS = new Set(['bool', 'check', 'mute'])
const VALUE_OPTIONS = new Set(['manifest', 'tags'])

export class CliError extends Error {}

/* 解析 --flag 与 --key value / --key=value 两种写法 */
export function parseArgs(argv) {
  const options = {
    bool: false,
    check: false,
    mute: false,
    manifest: null,
    tags: null
  }
  const errors = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (!arg.startsWith('--')) {
      errors.push('未识别的参数: ' + arg)
      continue
    }

    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    const inline = eq === -1 ? null : arg.slice(eq + 1)

    if (FLAG_OPTIONS.has(name)) {
      if (inline !== null) {
        errors.push('选项 --' + name + ' 不接受值')
        continue
      }
      options[name] = true
      continue
    }

    if (VALUE_OPTIONS.has(name)) {
      const value = inline !== null ? inline : argv[index + 1]
      if (!value || value.startsWith('--')) {
        errors.push('选项 --' + name + ' 缺少路径')
        continue
      }
      if (inline === null) {
        index += 1
      }
      options[name] = value
      continue
    }

    errors.push('未识别的选项: --' + name)
  }

  return { options, errors }
}

export function resolveFromCwd(target) {
  return resolve(process.cwd(), target)
}

/* 依据清单内的 tags 字段解析标签文件,显式传入 --tags 时以显式值为准 */
export function resolveSourcePaths(options, manifest) {
  const manifestPath = options.manifest ? resolveFromCwd(options.manifest) : DEFAULT_MANIFEST
  let tagsPath

  if (options.tags) {
    tagsPath = resolveFromCwd(options.tags)
  } else {
    if (!manifest || typeof manifest.tags !== 'string' || manifest.tags.length === 0) {
      throw new CliError('清单缺少 tags 字段,无法解析标签文件路径')
    }
    tagsPath = resolve(dirname(manifestPath), manifest.tags)
  }

  return { manifestPath, tagsPath }
}
