/* 新增视频条目的本地页面脚本,与 scripts/add-new-video-reaction.mjs 的接口配合 */

const AUTHOR = {
  name: 'WencueCryforme',
  url: 'https://github.com/WencueCryforme'
}

const FIELD_IDS = ['title', 'desc', 'filename', 'source', 'source_id', 'tags']
const TOAST_DURATION = 2800
const CONFIRM_WINDOW = 3000

/* 页面图标集中存放,统一使用内联 SVG,不使用 emoji */
const ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5v.01"/></svg>',
  tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  spinner: '<span class="spinner" aria-hidden="true"></span>'
}

const state = {
  tags: [],
  submitting: false,
  resetArmed: false
}

const dom = {}

function byId(id) {
  return document.getElementById(id)
}

/* 建立元素引用,便于后续读写 */
function cacheDom() {
  dom.form = byId('form')
  dom.metaCount = byId('meta-count')
  dom.metaManifest = byId('meta-manifest')
  dom.metaTags = byId('meta-tags')
  dom.tags = byId('tags')
  dom.submit = byId('submit')
  dom.reset = byId('reset')
  dom.quit = byId('quit')
  dom.resultDismiss = byId('result-dismiss')
  dom.author = byId('author')
  dom.toastLayer = byId('toast-layer')
  dom.result = byId('result')
  dom.resultTitle = byId('result-title')
  dom.resultBody = byId('result-body')
  dom.sourceIdEnabled = byId('source_id_enabled')
  dom.sourceId = byId('source_id')

  for (const field of FIELD_IDS) {
    dom[field] = byId(field)
    dom[field + 'Error'] = byId(field + '-error')
  }
}

function toast(message, tone) {
  const node = document.createElement('div')
  node.className = 'toast' + (tone ? ' ' + tone : '')
  const icon = document.createElement('span')
  icon.className = 'toast-icon'
  icon.innerHTML = tone === 'ok' ? ICONS.check : tone === 'bad' ? ICONS.alert : ICONS.info
  const text = document.createElement('span')
  text.textContent = message
  node.append(icon, text)
  dom.toastLayer.appendChild(node)
  window.setTimeout(() => {
    node.classList.add('leaving')
    window.setTimeout(() => node.remove(), 160)
  }, TOAST_DURATION)
}

function setFieldError(field, message) {
  const box = dom.form.querySelector('[data-field="' + field + '"]')
  const error = dom[field + 'Error']
  if (error) {
    error.textContent = message || ''
  }
  if (box) {
    box.classList.toggle('invalid', Boolean(message))
  }
  const control = dom[field]
  if (control && control.setAttribute) {
    if (message) {
      control.setAttribute('aria-invalid', 'true')
    } else {
      control.removeAttribute('aria-invalid')
    }
  }
}

function clearErrors() {
  for (const field of FIELD_IDS) {
    setFieldError(field, '')
  }
}

function renderTags(tags) {
  dom.tags.textContent = ''
  for (const tag of tags) {
    const label = document.createElement('label')
    label.className = 'tag'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.value = tag
    input.addEventListener('change', () => {
      label.classList.toggle('checked', input.checked)
    })
    const tick = document.createElement('span')
    tick.className = 'tick'
    tick.innerHTML = ICONS.tick
    const text = document.createElement('span')
    text.textContent = tag
    label.append(input, tick, text)
    dom.tags.appendChild(label)
  }
}

function collectForm() {
  return {
    title: dom.title.value,
    desc: dom.desc.value,
    filename: dom.filename.value,
    source: dom.source.value,
    source_id_enabled: dom.sourceIdEnabled.checked,
    source_id: dom.sourceId.value,
    tags: [...dom.tags.querySelectorAll('input[type="checkbox"]')].filter(input => input.checked).map(input => input.value)
  }
}

/* 页面侧先做一轮提示,最终判定以服务端返回为准 */
function preCheck(form) {
  const problems = []
  if (form.title.trim().length === 0) {
    problems.push(['title', '标题不能为空'])
  }
  if (form.desc.trim().length === 0) {
    problems.push(['desc', '简介不能为空'])
  }
  if (form.filename.trim().length === 0) {
    problems.push(['filename', '文件名不能为空'])
  }
  if (form.source.trim().length === 0) {
    problems.push(['source', '来源链接不能为空'])
  }
  if (form.source_id_enabled && form.source_id.trim().length === 0) {
    problems.push(['source_id', '已勾选填写来源编号,不能为空'])
  }
  if (form.tags.length === 0) {
    problems.push(['tags', '至少选择一个标签'])
  }
  return problems
}

async function requestJson(url, options) {
  const response = await fetch(url, options)
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('服务端返回的不是约定的结果对象')
  }
  if (!payload || typeof payload.ok !== 'boolean') {
    throw new Error('服务端返回的结果对象格式不正确')
  }
  return payload
}

function setBusy(busy) {
  state.submitting = busy
  dom.submit.disabled = busy
  dom.submit.innerHTML = busy ? ICONS.spinner + '<span>正在添加</span>' : '<span>确定添加</span>'
}

function showResult(title, body, tone) {
  dom.resultTitle.textContent = title
  dom.resultTitle.insertAdjacentHTML('afterbegin', '<span class="result-icon">' + (tone === 'ok' ? ICONS.check : ICONS.alert) + '</span>')
  dom.resultBody.textContent = body
  dom.result.classList.toggle('ok', tone === 'ok')
  dom.result.classList.toggle('bad', tone !== 'ok')
  dom.result.hidden = false
}

function hideResult() {
  dom.result.hidden = true
}

async function submit() {
  if (state.submitting) {
    return
  }

  clearErrors()
  hideResult()

  const form = collectForm()
  const problems = preCheck(form)
  if (problems.length > 0) {
    for (const [field, message] of problems) {
      setFieldError(field, message)
    }
    const first = dom.form.querySelector('[data-field="' + problems[0][0] + '"] .control')
    if (first && first.focus) {
      first.focus()
    }
    toast(problems[0][1], 'bad')
    return
  }

  setBusy(true)
  try {
    const payload = await requestJson('/api/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form)
    })

    if (!payload.ok) {
      const error = payload.error || {}
      const details = error.details || {}
      if (details.field) {
        setFieldError(details.field, error.message)
      }
      if (Array.isArray(details.problems)) {
        for (const item of details.problems) {
          if (item.field && item.field !== details.field) {
            setFieldError(item.field, item.message)
          }
        }
      }
      toast(error.message || '添加失败', 'bad')
      showResult('添加未完成', JSON.stringify(error, null, 2), 'bad')
      return
    }

    const data = payload.data
    toast('已添加: ' + data.entry.title, 'ok')
    showResult(
      '添加成功,清单现有 ' + data.count + ' 条',
      JSON.stringify(data.entry, null, 2),
      'ok'
    )
  } catch (error) {
    toast('请求失败: ' + error.message, 'bad')
  } finally {
    setBusy(false)
  }
}

/* 清空属于破坏性操作,原按钮替换为确认按钮,3 秒内未确认则回归初始状态 */
function resetForm() {
  if (!state.resetArmed) {
    state.resetArmed = true
    dom.reset.classList.add('armed')
    dom.reset.textContent = '确认清空'
    dom.resetTimer = window.setTimeout(disarmReset, CONFIRM_WINDOW)
    return
  }

  window.clearTimeout(dom.resetTimer)
  state.resetArmed = false
  dom.reset.classList.remove('armed')
  dom.reset.textContent = '清空'

  dom.form.reset()
  clearErrors()
  hideResult()
  for (const input of dom.tags.querySelectorAll('input[type="checkbox"]')) {
    input.checked = false
    input.closest('.tag').classList.remove('checked')
  }
  dom.sourceId.disabled = true
  dom.title.focus()
  toast('已清空表单', 'info')
}

function disarmReset() {
  state.resetArmed = false
  dom.reset.classList.remove('armed')
  dom.reset.textContent = '清空'
}

async function quit() {
  dom.quit.disabled = true
  try {
    await requestJson('/api/shutdown', { method: 'POST' })
    toast('服务已结束,可以关闭本页面', 'ok')
    dom.submit.disabled = true
    dom.reset.disabled = true
  } catch (error) {
    dom.quit.disabled = false
    toast('结束失败: ' + error.message, 'bad')
  }
}

function renderAuthor() {
  const link = document.createElement('a')
  link.href = AUTHOR.url
  link.textContent = AUTHOR.name
  link.target = '_blank'
  link.rel = 'noreferrer'
  dom.author.append('作者 ', link)
}

async function loadState() {
  try {
    const payload = await requestJson('/api/state')
    if (!payload.ok) {
      dom.metaCount.textContent = payload.error.message
      toast(payload.error.message, 'bad')
      return
    }
    const data = payload.data
    state.tags = data.tags
    renderTags(data.tags)
    dom.metaCount.textContent = '清单 ' + data.entryCount + ' 条 / 标签 ' + data.tags.length + ' 个'
    dom.metaManifest.textContent = data.manifest
    dom.metaTags.textContent = data.tagsFile || '-'
  } catch (error) {
    dom.metaCount.textContent = '状态读取失败: ' + error.message
    toast('状态读取失败: ' + error.message, 'bad')
  }
}

function bindEvents() {
  dom.submit.addEventListener('click', submit)
  dom.reset.addEventListener('click', resetForm)
  dom.quit.addEventListener('click', quit)
  dom.resultDismiss.addEventListener('click', hideResult)
  dom.sourceIdEnabled.addEventListener('change', () => {
    dom.sourceId.disabled = !dom.sourceIdEnabled.checked
    if (!dom.sourceIdEnabled.checked) {
      dom.sourceId.value = ''
    } else {
      dom.sourceId.focus()
    }
  })
  dom.form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
      event.preventDefault()
      submit()
    }
  })
}

function start() {
  cacheDom()
  renderAuthor()
  bindEvents()
  loadState()
}

start()
