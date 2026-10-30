<template>
  <div class="app-view" :class="{ 'is-booting': !urlReady, 'is-clear-mode': clearMode }">
    <TopNav
      :active="activeTab"
      :over-video="view === 'home'"
      :hide-menu="uiLocked"
      :hide-topics="urlTopicActive"
      @menu="openDrawer"
      @select="handleTab"
      @search="openSearch"
    />

    <div v-if="view === 'home'" class="feed-layout">
      <div class="feed-shell">
        <div
          ref="scrollEl"
          class="feed-scroll"
          @scroll.passive="onScroll"
          @wheel.passive="feedEnd.onWheel"
          @touchstart.passive="feedEnd.onTouchStart"
          @touchend.passive="feedEnd.onTouchEnd"
          @touchcancel.passive="feedEnd.onTouchCancel"
        >
          <FeedSlide
            v-for="(entry, index) in feedEntries"
            :key="entry.filename"
            :ref="(element) => setSlideRef(element, index)"
            :entry="entry"
            :index="index"
            :active="index === activeSlide"
            :should-load="Math.abs(index - activeIndex) <= 1"
            :should-cover="Math.abs(index - activeIndex) <= 2"
            :muted="muted"
            :clear-mode="clearMode"
            @toggle-mute="toggleMute"
            @clear-screen="enterClearMode"
            @exit-clear-screen="exitClearMode"
          />
        </div>
      </div>

      <div v-if="!feedEntries.length" class="feed-empty">
        <p class="feed-empty__title">当前话题下没有视频</p>
        <button type="button" class="feed-empty__button" @click="clearTopics">查看全部</button>
      </div>

    </div>

    <section v-else class="page-panel">
      <div class="search-head">
        <label class="search-field">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.8" cy="10.8" r="6.2" stroke="currentColor" stroke-width="1.9" fill="none"></circle>
            <path d="M15.4 15.4L20 20" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
          </svg>
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="search"
            placeholder="搜索标题、简介或标签"
            aria-label="搜索标题、简介或标签"
          >
          <button v-if="searchQuery" type="button" class="search-clear" aria-label="清除搜索" @click="searchQuery = ''">
            &times;
          </button>
        </label>
        <button type="button" class="search-cancel" @click="closeSearch">取消</button>
      </div>

      <p class="search-count">{{ searchResults.length }} 条结果</p>
      <VideoGrid :entries="searchResults" @select="openDetail" />

      <footer class="page-footer">
        <span>@{{ site.author.name }}</span>
        <span>Copyright &copy; {{ site.copyrightYear }}</span>
      </footer>
    </section>

    <TopicBubble
      :open="topicBubbleOpen"
      :tags="presetTags"
      :selected="draftTopics"
      @toggle="toggleDraftTopic"
      @apply="applyTopics"
    />

    <SideDrawer :open="drawerOpen" @close="drawerOpen = false" />

    <SearchDetail
      v-if="detailOpen"
      :entries="detailEntries"
      :start-index="detailStart"
      @close="closeDetail"
    />
  </div>
</template>

<script setup lang="ts">
import type { CatalogEntry } from '~/types/catalog'
import { INTERACTION, SITE as site, TOPIC_QUERY_PARAM, TOPIC_QUERY_SEPARATOR, VIDEO_QUERY_PARAM } from '~/const'
import { useFeedEndToast } from '~/composables/useFeedEndToast'
import { useSharedVideoHash } from '~/composables/useSharedVideoHash'

type ViewName = 'home' | 'search'

interface SlideHandle {
  togglePlay: () => void
}

const { entries, presetTags } = useCatalog()
const { push } = useToast()
const route = useRoute()
const router = useRouter()
const urlReady = ref(false)

const selectedTopics = ref<string[]>([])

function setTopics(tags: string[]) {
  selectedTopics.value = [...new Set(tags.filter(tag => typeof tag === 'string' && tag.length > 0))]
}

const view = ref<ViewName>('home')
const drawerOpen = ref(false)
const topicBubbleOpen = ref(false)
const draftTopics = ref<string[]>([])
const detailOpen = ref(false)
const detailEntries = ref<CatalogEntry[]>([])
const detailStart = ref(0)
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

const activeIndex = ref(0)
/* 分享链接命中的条目 hash_id,生效时固定在视频流首位,取值在页面会话内共享 */
const pinnedHashId = useSharedVideoHash()
const { muted, toggle: toggleMute } = useMuted()
const scrollEl = ref<HTMLElement | null>(null)
const slideRefs = ref<Array<SlideHandle | null>>([])

const clearMode = ref(false)
let lastHomeClickAt = 0
let lastTopicClickAt = 0
let topicClickTimer: ReturnType<typeof setTimeout> | null = null
const shuffledEntries = ref<CatalogEntry[]>([])
let scrollFrame = 0

const urlTopicTags = computed(() => {
  if (!urlReady.value) {
    return []
  }
  const raw = route.query[TOPIC_QUERY_PARAM]
  const text = Array.isArray(raw) ? raw[0] : raw
  if (typeof text !== 'string') {
    return []
  }
  const tags = text
    .split(TOPIC_QUERY_SEPARATOR)
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0 && presetTags.includes(tag))
  return [...new Set(tags)]
})

const urlTopicCount = computed(() =>
  entries.filter(entry => urlTopicTags.value.some(tag => entry.tags.includes(tag))).length
)

const urlTopicActive = computed(() => urlTopicTags.value.length > 0 && urlTopicCount.value > 0)
const topicFilter = computed(() => (urlTopicActive.value ? urlTopicTags.value : selectedTopics.value))
const uiLocked = computed(() => urlTopicActive.value)

watch(urlTopicActive, active => {
  if (active) {
    topicBubbleOpen.value = false
    drawerOpen.value = false
    /* URL 指定的话题生效或变化后视频集合重新过滤,回到第一条 */
    resetFeed()
  }
})
watch(uiLocked, locked => {
  if (locked) {
    drawerOpen.value = false
  }
})

const feedEntries = computed(() => {
  const base = shuffledEntries.value.length ? shuffledEntries.value : entries
  const sequence = !topicFilter.value.length
    ? base
    : base.filter(entry => topicFilter.value.some(tag => entry.tags.includes(tag)))

  /* 分享链接命中的条目提到首位,被话题过滤掉时也补到首位 */
  const target = pinnedHashId.value
  if (!target) {
    return sequence
  }
  const index = sequence.findIndex(entry => entry.hash_id === target)
  if (index === 0) {
    return sequence
  }
  if (index > 0) {
    return [sequence[index], ...sequence.slice(0, index), ...sequence.slice(index + 1)]
  }
  const found = entries.find(entry => entry.hash_id === target)
  return found ? [found, ...sequence] : sequence
})

function isAtFeedEnd() {
  const element = scrollEl.value
  const length = feedEntries.value.length
  if (!element || !length || activeIndex.value < length - 1) {
    return false
  }
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 4
}

const feedEnd = useFeedEndToast({ isAtEnd: isAtFeedEnd, push })

const searchResults = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()
  if (!keyword) {
    return entries
  }
  return entries.filter((entry) => {
    const haystack = entry.title + ' ' + entry.desc + ' ' + entry.tags.join(' ')
    return haystack.toLowerCase().includes(keyword)
  })
})

const activeTab = computed<'home' | 'topics' | 'search'>(() => {
  if (view.value === 'search') {
    return 'search'
  }
  if (urlTopicActive.value) {
    return 'home'
  }
  return topicBubbleOpen.value || selectedTopics.value.length > 0 ? 'topics' : 'home'
})

const activeSlide = computed(() => {
  if (view.value !== 'home' || topicBubbleOpen.value) {
    return -1
  }
  return activeIndex.value
})

async function resetFeed() {
  activeIndex.value = 0
  await nextTick()
  scrollEl.value?.scrollTo({ top: 0 })
}

function cancelTopicClick() {
  if (topicClickTimer) {
    clearTimeout(topicClickTimer)
    topicClickTimer = null
  }
}

function performTopicTabToggle() {
  lastHomeClickAt = 0
  if (view.value === 'search') {
    view.value = 'home'
  }
  if (topicBubbleOpen.value) {
    applyTopics()
    return
  }
  draftTopics.value = [...selectedTopics.value]
  topicBubbleOpen.value = true
}

async function handleTopicDoubleClick() {
  cancelTopicClick()
  lastTopicClickAt = 0
  lastHomeClickAt = 0
  if (topicBubbleOpen.value) {
    setTopics(draftTopics.value)
  }
  topicBubbleOpen.value = false
  view.value = 'home'
  reshuffleFeed()
  await resetFeed()
}

function handleTopicClick() {
  if (urlTopicActive.value) {
    return
  }
  lastHomeClickAt = 0
  const now = Date.now()
  if (now - lastTopicClickAt <= INTERACTION.topicDoubleClickMs) {
    lastTopicClickAt = 0
    cancelTopicClick()
    handleTopicDoubleClick()
    return
  }
  lastTopicClickAt = now
  cancelTopicClick()
  topicClickTimer = setTimeout(() => {
    topicClickTimer = null
    lastTopicClickAt = 0
    performTopicTabToggle()
  }, INTERACTION.topicDoubleClickMs)
}

async function handleTab(tab: 'home' | 'topics') {
  if (tab === 'home') {
    cancelTopicClick()
    lastTopicClickAt = 0
    const now = Date.now()
    if (now - lastHomeClickAt <= INTERACTION.homeDoubleClickMs) {
      lastHomeClickAt = 0
      topicBubbleOpen.value = false
      view.value = 'home'
      reshuffleFeed()
      await resetFeed()
      return
    }
    lastHomeClickAt = now
    const hadTopics = topicBubbleOpen.value || selectedTopics.value.length > 0
    topicBubbleOpen.value = false
    if (!urlTopicActive.value) {
      setTopics([])
      if (hadTopics) {
        reshuffleFeed()
      }
    }
    view.value = 'home'
    await resetFeed()
    return
  }

  if (urlTopicActive.value) {
    return
  }
  lastHomeClickAt = 0
  handleTopicClick()
}

function toggleDraftTopic(tag: string) {
  if (draftTopics.value.includes(tag)) {
    draftTopics.value = draftTopics.value.filter(item => item !== tag)
  } else {
    draftTopics.value = [...draftTopics.value, tag]
  }
}

function applyTopics() {
  const changed = !sameTopicSelection(draftTopics.value, selectedTopics.value)
  setTopics(draftTopics.value)
  if (changed) {
    reshuffleFeed()
  }
  topicBubbleOpen.value = false
}

function clearTopics() {
  const changed = selectedTopics.value.length > 0
  setTopics([])
  if (changed) {
    reshuffleFeed()
  }
}

function openDrawer() {
  if (uiLocked.value) {
    return
  }
  lastHomeClickAt = 0
  cancelTopicClick()
  lastTopicClickAt = 0
  if (topicBubbleOpen.value) {
    applyTopics()
  }
  drawerOpen.value = true
}

/* 进入清屏时收起侧边栏与话题气泡,页面级导航随视频区域一起让位 */
function enterClearMode() {
  if (topicBubbleOpen.value) {
    applyTopics()
  }
  drawerOpen.value = false
  clearMode.value = true
}

function exitClearMode() {
  clearMode.value = false
}

async function openSearch() {
  lastHomeClickAt = 0
  cancelTopicClick()
  lastTopicClickAt = 0
  if (topicBubbleOpen.value) {
    applyTopics()
  }
  view.value = 'search'
  detailOpen.value = false
  searchQuery.value = ''
  await nextTick()
  searchInput.value?.focus()
}

async function closeSearch() {
  detailOpen.value = false
  view.value = 'home'
  await resetFeed()
}

function openDetail(entry: CatalogEntry) {
  const list = searchResults.value
  const index = list.findIndex(item => item.filename === entry.filename)
  detailEntries.value = [...list]
  detailStart.value = index >= 0 ? index : 0
  detailOpen.value = true
}

function closeDetail() {
  detailOpen.value = false
}

function setSlideRef(element: unknown, index: number) {
  slideRefs.value[index] = (element as SlideHandle) || null
}

function sameTopicSelection(left: string[], right: string[]) {
  return left.length === right.length && left.every(tag => right.includes(tag))
}

function shuffleEntries(list: CatalogEntry[]) {
  const next = [...list]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = next[index]
    next[index] = next[swapIndex]
    next[swapIndex] = current
  }
  return next
}

/* 打乱视频顺序,保留分享链接的首位锁定 */
function shuffleFeed() {
  shuffledEntries.value = shuffleEntries(entries)
}

/* 重排视频顺序并解除分享链接的首位锁定 */
function reshuffleFeed() {
  pinnedHashId.value = ''
  shuffleFeed()
}

/* 从路由中取分享参数,静态预渲染页面首次挂载时可能还取不到 */
function routeShareHashId() {
  const raw = route.query[VIDEO_QUERY_PARAM]
  const text = Array.isArray(raw) ? raw[0] : raw
  return typeof text === 'string' ? text.trim() : ''
}

/*
  分享链接的 video 参数只在首屏定位一次,
  取值优先用路由,取不到时用页面初始化时快照的地址栏参数
*/
function consumeVideoParam() {
  const hashId = routeShareHashId() || pinnedHashId.value
  if (hashId.length > 0) {
    pinnedHashId.value = entries.some(entry => entry.hash_id === hashId) ? hashId : ''
  }
  dropVideoParam()
}

/* 路由与地址栏都移除该参数,清理后重复调用无副作用 */
function dropVideoParam() {
  if (!import.meta.client) {
    return
  }
  if (VIDEO_QUERY_PARAM in route.query) {
    const nextQuery = { ...route.query }
    delete nextQuery[VIDEO_QUERY_PARAM]
    void router.replace({ path: route.path, query: nextQuery, hash: route.hash })
    return
  }
  const url = new URL(window.location.href)
  if (!url.searchParams.has(VIDEO_QUERY_PARAM)) {
    return
  }
  /* 路由尚未带上该参数时直接改写地址,避免触发一次无变化的导航 */
  url.searchParams.delete(VIDEO_QUERY_PARAM)
  window.history.replaceState(window.history.state, '', url.toString())
}

/* 预渲染页面挂载之后才把地址栏参数同步进路由,同步到时再消费一次 */
watch(() => route.query[VIDEO_QUERY_PARAM], value => {
  if (value) {
    consumeVideoParam()
  }
})

watch(selectedTopics, () => {
  if (view.value === 'home') {
    resetFeed()
  }
})

function onScroll() {
  if (scrollFrame) {
    return
  }
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    const element = scrollEl.value
    /* clientHeight 为 0 时无法换算页码,直接跳过本次计算 */
    if (!element || element.clientHeight <= 0) {
      return
    }
    const next = Math.round(element.scrollTop / element.clientHeight)
    const clamped = Math.min(Math.max(next, 0), Math.max(feedEntries.value.length - 1, 0))
    if (clamped !== activeIndex.value) {
      activeIndex.value = clamped
    }
  })
}

function goRelative(offset: number) {
  const element = scrollEl.value
  if (!element) {
    return
  }
  const next = Math.min(Math.max(activeIndex.value + offset, 0), feedEntries.value.length - 1)
  if (next === activeIndex.value) {
    return
  }
  element.scrollTo({ top: next * element.clientHeight, behavior: 'smooth' })
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (detailOpen.value) {
      detailOpen.value = false
      return
    }
    if (drawerOpen.value) {
      drawerOpen.value = false
      return
    }
    if (topicBubbleOpen.value) {
      applyTopics()
      return
    }
    if (view.value === 'search') {
      closeSearch()
      return
    }
    return
  }

  if (view.value !== 'home' || topicBubbleOpen.value || detailOpen.value || drawerOpen.value) {
    return
  }

  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
    return
  }

  if (event.key === 'ArrowDown' || event.key === 'PageDown') {
    event.preventDefault()
    if (isAtFeedEnd()) {
      feedEnd.notify()
      return
    }
    goRelative(1)
  } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
    event.preventDefault()
    goRelative(-1)
  } else if (event.key === ' ') {
    if (target && (target.tagName === 'BUTTON' || target.tagName === 'A')) {
      return
    }
    event.preventDefault()
    slideRefs.value[activeIndex.value]?.togglePlay()
  } else if (event.key === 'm' || event.key === 'M') {
    toggleMute()
  }
}

onMounted(async () => {
  urlReady.value = true
  shuffleFeed()
  consumeVideoParam()
  activeIndex.value = 0
  await nextTick()
  scrollEl.value?.scrollTo({ top: 0 })
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  cancelTopicClick()
  window.removeEventListener('keydown', handleKeydown)
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame)
  }
})

useSeoMeta({
  title: site.title,
  description: site.description,
  ogTitle: site.title
})
</script>
