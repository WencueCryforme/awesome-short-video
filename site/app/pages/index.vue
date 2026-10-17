<template>
  <div class="app-view">
    <TopNav
      :active="activeTab"
      @menu="openDrawer"
      @select="handleTab"
      @search="openSearch"
    />

    <div v-if="view === 'home'" class="feed-layout">
      <div class="feed-shell">
        <div ref="scrollEl" class="feed-scroll" @scroll.passive="onScroll">
          <FeedSlide
            v-for="(entry, index) in feedEntries"
            :key="entry.filename"
            :ref="(element) => setSlideRef(element, index)"
            :entry="entry"
            :index="index"
            :active="index === activeSlide"
            :should-load="Math.abs(index - activeIndex) <= 1"
            :preload-cover="index > activeIndex && index <= activeIndex + 2"
            :muted="muted"
            :upstream="upstreams.has(entry.filename)"
            @toggle-mute="toggleMute"
            @toggle-upstream="toggleUpstream(entry)"
          />
        </div>
      </div>

      <div v-if="!feedEntries.length" class="feed-empty">
        <p class="feed-empty__title">当前话题下没有视频</p>
        <button type="button" class="feed-empty__button" @click="clearTopics">查看全部</button>
      </div>

    </div>

    <section v-else class="page-panel search-panel">
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
import { canEmbed } from '~/utils/embed'
import { SITE as site } from '~/utils/site'

type ViewName = 'home' | 'search'

interface SlideHandle {
  togglePlay: () => void
}

const { entries, presetTags } = useCatalog()
const { push } = useToast()

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
const muted = ref(true)
const scrollEl = ref<HTMLElement | null>(null)
const slideRefs = ref<Array<SlideHandle | null>>([])
const upstreams = ref<Set<string>>(
  new Set(
    entries
      .filter(entry => entry.default_mod === 'upstream' && canEmbed(entry))
      .map(entry => entry.filename)
  )
)
let lastHomeClickAt = 0
const HOME_DOUBLE_CLICK_MS = 400
const shuffledEntries = ref<CatalogEntry[]>([])
let scrollFrame = 0

const feedEntries = computed(() => {
  const base = shuffledEntries.value.length ? shuffledEntries.value : entries
  if (!selectedTopics.value.length) {
    return base
  }
  const selected = selectedTopics.value
  return base
    .map((entry, index) => ({
      entry,
      index,
      score: selected.filter(tag => entry.tags.includes(tag)).length
    }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(item => item.entry)
})

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

async function handleTab(tab: 'home' | 'topics') {
  if (tab === 'home') {
    const now = Date.now()
    if (now - lastHomeClickAt <= HOME_DOUBLE_CLICK_MS) {
      lastHomeClickAt = 0
      if (import.meta.client) {
        window.location.reload()
      }
      return
    }
    lastHomeClickAt = now
    topicBubbleOpen.value = false
    setTopics([])
    view.value = 'home'
    await resetFeed()
    return
  }

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

function toggleDraftTopic(tag: string) {
  if (draftTopics.value.includes(tag)) {
    draftTopics.value = draftTopics.value.filter(item => item !== tag)
  } else {
    draftTopics.value = [...draftTopics.value, tag]
  }
}

function applyTopics() {
  setTopics(draftTopics.value)
  topicBubbleOpen.value = false
  resetFeed()
}

function clearTopics() {
  setTopics([])
  resetFeed()
}

function openDrawer() {
  lastHomeClickAt = 0
  if (topicBubbleOpen.value) {
    applyTopics()
  }
  drawerOpen.value = true
}

async function openSearch() {
  lastHomeClickAt = 0
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

function toggleUpstream(entry: CatalogEntry) {
  if (!canEmbed(entry)) {
    push('无上游源', 'error')
    return
  }
  const next = new Set(upstreams.value)
  if (next.has(entry.filename)) {
    next.delete(entry.filename)
    push('当前视频已切换为站内源')
  } else {
    next.add(entry.filename)
    push('当前视频已切换为上游源')
  }
  upstreams.value = next
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
    if (!element) {
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

function toggleMute() {
  muted.value = !muted.value
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
  shuffledEntries.value = shuffleEntries(entries)
  activeIndex.value = 0
  await nextTick()
  scrollEl.value?.scrollTo({ top: 0 })
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame)
  }
})

useSeoMeta({
  title: '个人短视频流',
  description: '个人版抖音式竖屏短视频流,上下滑动浏览,支持话题与搜索',
  ogTitle: '个人短视频流'
})
</script>
