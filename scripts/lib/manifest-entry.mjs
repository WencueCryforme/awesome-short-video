/*
 * 清单条目字段的公共定义与校验,供校验脚本与新增条目脚本共用
 * 字段缺省约定: allow_iframe 缺省为 true,default_mode 缺省为 onsite,flag 缺省表示普通条目
 */

export const TOO_LARGE_FLAG = 'THE_FILE_SIZE_IS_TOO_LARGE'
export const MODE_VALUES = ['onsite', 'upstream']
export const FLAG_VALUES = ['none', TOO_LARGE_FLAG]

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/* 返回 null 表示链接合法,否则返回问题描述 */
export function describeSource(value) {
  if (!isNonEmptyString(value)) {
    return '为空'
  }
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? null : '协议不是 http/https'
  } catch {
    return '不是合法链接'
  }
}

/* 逐项检查条目字段,返回问题描述列表 */
export function entryFieldProblems(entry) {
  const problems = []

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return ['条目不是对象']
  }
  if (!isNonEmptyString(entry.title)) {
    problems.push('title 为空')
  }
  if (typeof entry.desc !== 'string') {
    problems.push('desc 不是字符串')
  }
  if (!isNonEmptyString(entry.filename)) {
    problems.push('filename 为空')
  }
  const sourceProblem = describeSource(entry.source)
  if (sourceProblem) {
    problems.push('source ' + sourceProblem)
  }
  if (entry.source_id !== undefined && !isNonEmptyString(entry.source_id)) {
    problems.push('source_id 为空')
  }
  if (entry.allow_iframe !== undefined && typeof entry.allow_iframe !== 'boolean') {
    problems.push('allow_iframe 不是布尔值')
  }
  if (entry.default_mode !== undefined && !MODE_VALUES.includes(entry.default_mode)) {
    problems.push('default_mode 取值非法: ' + String(entry.default_mode))
  }
  if (!Array.isArray(entry.tags) || entry.tags.some(tag => !isNonEmptyString(tag))) {
    problems.push('tags 必须是非空字符串数组')
  }
  if (entry.flag !== undefined && entry.flag !== TOO_LARGE_FLAG) {
    problems.push('flag 取值非法: ' + String(entry.flag))
  }

  return problems
}

/* 表单值转条目对象,只写入非缺省字段;返回条目与逐字段问题 */
export function buildEntry(form) {
  const problems = []
  const entry = {}

  const text = (field, label, required) => {
    const raw = typeof form[field] === 'string' ? form[field] : ''
    const value = raw.trim()
    if (required && value.length === 0) {
      problems.push({ field, message: label + '不能为空' })
    }
    return value
  }

  const title = text('title', '标题', true)
  const desc = text('desc', '简介', true)
  const filename = text('filename', '文件名', true)
  const source = text('source', '来源链接', true)

  if (filename.length > 0 && /[\\/]/.test(filename)) {
    problems.push({ field: 'filename', message: '文件名不能包含路径分隔符' })
  }

  const sourceProblem = describeSource(source)
  if (source.length > 0 && sourceProblem) {
    problems.push({ field: 'source', message: '来源链接' + sourceProblem })
  }

  entry.title = title
  entry.desc = desc

  const flag = FLAG_VALUES.includes(form.flag) ? form.flag : null
  if (flag === null) {
    problems.push({ field: 'flag', message: '标记取值必须是 none 或 ' + TOO_LARGE_FLAG })
  } else if (flag === TOO_LARGE_FLAG) {
    entry.flag = TOO_LARGE_FLAG
  }

  entry.filename = filename
  entry.source = source

  if (form.source_id_enabled === true) {
    const sourceId = text('source_id', '来源编号', true)
    if (sourceId.length > 0) {
      entry.source_id = sourceId
    }
  }

  if (form.allow_iframe !== 'true' && form.allow_iframe !== 'false') {
    problems.push({ field: 'allow_iframe', message: '是否允许站外嵌入必须选择' })
  } else if (form.allow_iframe === 'false') {
    entry.allow_iframe = false
  }

  if (!MODE_VALUES.includes(form.default_mode)) {
    problems.push({ field: 'default_mode', message: '默认播放源必须选择' })
  } else if (form.default_mode !== 'onsite') {
    entry.default_mode = form.default_mode
  }

  const tags = Array.isArray(form.tags)
    ? [...new Set(form.tags.filter(tag => isNonEmptyString(tag)).map(tag => tag.trim()))]
    : []
  if (tags.length === 0) {
    problems.push({ field: 'tags', message: '标签至少选择一个' })
  }
  entry.tags = tags

  return { entry, problems }
}
