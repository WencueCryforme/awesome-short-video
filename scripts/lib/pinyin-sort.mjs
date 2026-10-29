/* 中文拼音排序,依赖 Node.js 内置 ICU 的 zh-Hans-CN 排序规则 */
const collator = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'variant'
})

export function compareText(left, right) {
  return collator.compare(String(left ?? ''), String(right ?? ''))
}

export function sortByPinyin(list) {
  return [...list].sort(compareText)
}

export function compareEntries(left, right) {
  const leftTags = Array.isArray(left.tags) ? left.tags : []
  const rightTags = Array.isArray(right.tags) ? right.tags : []
  const length = Math.max(leftTags.length, rightTags.length)

  for (let index = 0; index < length; index += 1) {
    const leftTag = leftTags[index]
    const rightTag = rightTags[index]

    /* 缺失标签的位置优先于存在标签的位置 */
    if (leftTag === undefined && rightTag === undefined) {
      break
    }
    if (leftTag === undefined) {
      return -1
    }
    if (rightTag === undefined) {
      return 1
    }

    const result = compareText(leftTag, rightTag)
    if (result !== 0) {
      return result
    }
  }

  return compareText(left.title, right.title)
}
