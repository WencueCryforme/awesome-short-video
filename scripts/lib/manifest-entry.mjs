/*
 * 清单条目字段的公共定义与校验,供校验脚本与新增条目脚本共用
 */

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

/* 条目允许出现的字段,空白模板与校验都以这一份清单为准 */
export const ENTRY_FIELDS = ['title', 'desc', 'filename', 'source', 'source_id', 'tags']

/* 由脚本生成的派生字段,不由人手动维护,空白模板中不出现 */
export const HASH_ID_FIELD = 'hash_id'
export const DERIVED_FIELDS = [HASH_ID_FIELD]

/* 条目允许出现的全部字段,人工字段在前,派生字段在后 */
export const ENTRY_KEYS = [...ENTRY_FIELDS, ...DERIVED_FIELDS]

/* 逐项检查条目字段,返回问题描述列表 */
export function entryFieldProblems(entry) {
  const problems = []

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return ['条目不是对象']
  }

  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.includes(key)) {
      problems.push('存在未知字段 ' + key)
    }
  }
  if (!isNonEmptyString(entry.title)) {
    problems.push('title 为空')
  }
  if (!isNonEmptyString(entry.desc)) {
    problems.push('desc 为空')
  }
  if (!isNonEmptyString(entry.filename)) {
    problems.push('filename 为空')
  }
  const sourceProblem = describeSource(entry.source)
  if (sourceProblem) {
    problems.push('source ' + sourceProblem)
  }
  if (entry.source_id !== undefined && !isNonEmptyString(entry.source_id)) {
    problems.push('source_id 为空,不需要该字段时应删除')
  }
  if (!Array.isArray(entry.tags) || entry.tags.some(tag => !isNonEmptyString(tag))) {
    problems.push('tags 必须是非空字符串数组')
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
  entry.filename = filename
  entry.source = source

  if (form.source_id_enabled === true) {
    const sourceId = text('source_id', '来源编号', true)
    if (sourceId.length > 0) {
      entry.source_id = sourceId
    }
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
