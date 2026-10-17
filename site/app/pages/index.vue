<template>
  <div class="feed-layout">
    <div class="feed-shell">
    <header class="feed-top">
      <div class="feed-brand">
        <span class="feed-brand__mark" aria-hidden="true">
          <span class="feed-brand__triangle"></span>
        </span>
        <div>
          <p class="feed-brand__name">{{ site.title }}</p>
          <p class="feed-brand__sub">@{{ site.author.name }}</p>
        </div>
      </div>
      <div class="feed-top__actions">
        <ThemeToggle />
        <a
          class="icon-button"
          :href="site.repositoryUrl"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="打开源码仓库"
          title="打开源码仓库"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
          </svg>
        </a>
      </div>
    </header>

    <nav class="feed-tabs" aria-label="标签筛选">
      <button
        type="button"
        class="feed-tab"
        :class="{ 'is-active': !activeTag }"
        @click="selectTag(null)"
      >
        全部
      </button>
      <button
        v-for="tag in presetTags"
        :key="tag"
        type="button"
        class="feed-tab"
        :class="{ 'is-active': activeTag === tag }"
        @click="selectTag(tag)"
      >
        {{ tag }}
      </button>
    </nav>

    <div ref="scrollEl" class="feed-scroll" @scroll.passive="onScroll">
      <FeedSlide
        v-for="(entry, index) in filtered"
        :key="entry.filename"
        :ref="(element) => setSlideRef(element, index)"
        :entry="entry"
        :index="index"
        :active="index === activeIndex"
        :should-load="Math.abs(index - activeIndex) <= 1"
        :muted="muted"
        @toggle-mute="toggleMute"
      />
    </div>

    <div v-if="!filtered.length" class="feed-empty">
      <p class="feed-empty__title">这个标签下还没有视频</p>
      <button type="button" class="feed-empty__button" @click="selectTag(null)">查看全部</button>
    </div>

    </div>

    <div class="feed-nav" aria-label="切换视频">
      <button
        type="button"
        class="feed-nav__button"
        aria-label="上一个视频"
        :disabled="activeIndex <= 0"
        @click="goRelative(-1)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
        </svg>
      </button>
      <button
        type="button"
        class="feed-nav__button"
        aria-label="下一个视频"
        :disabled="activeIndex >= filtered.length - 1"
        @click="goRelative(1)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SITE as site } from '~/utils/site'

interface SlideHandle {
  togglePlay: () => void
}

const { entries, presetTags } = useCatalog()

const activeTag = ref<string | null>(null)
const activeIndex = ref(0)
const muted = ref(true)
const scrollEl = ref<HTMLElement | null>(null)
const slideRefs = ref<Array<SlideHandle | null>>([])
let scrollFrame = 0

const filtered = computed(() => {
  if (!activeTag.value) {
    return entries
  }
  return entries.filter(entry => entry.tags.includes(activeTag.value as string))
})

function selectTag(tag: string | null) {
  activeTag.value = activeTag.value === tag ? null : tag
}

function setSlideRef(element: unknown, index: number) {
  slideRefs.value[index] = (element as SlideHandle) || null
}

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
    const clamped = Math.min(Math.max(next, 0), Math.max(filtered.value.length - 1, 0))
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
  const next = Math.min(Math.max(activeIndex.value + offset, 0), filtered.value.length - 1)
  if (next === activeIndex.value) {
    return
  }
  element.scrollTo({ top: next * element.clientHeight, behavior: 'smooth' })
}

function toggleMute() {
  muted.value = !muted.value
}

function handleKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented) {
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

watch(activeTag, async () => {
  activeIndex.value = 0
  await nextTick()
  scrollEl.value?.scrollTo({ top: 0 })
})

onMounted(async () => {
  await nextTick()
  /* 恢复刷新前停留的条目,避免首条在视口外自动播放 */
  const element = scrollEl.value
  if (element) {
    const restored = Math.round(element.scrollTop / element.clientHeight)
    activeIndex.value = Math.min(Math.max(restored, 0), Math.max(filtered.value.length - 1, 0))
  }
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
  description: site.description,
  ogTitle: '个人短视频流',
  ogDescription: site.description
})
</script>
