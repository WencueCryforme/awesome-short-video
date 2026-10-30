<template>
  <Teleport to="body">
    <div class="search-detail-layer" :class="{ 'is-clear-mode': clearMode }" @click.self="close">
      <div class="search-detail-shell">
        <button type="button" class="search-detail-back" aria-label="返回搜索" @click="close">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
          </svg>
        </button>

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
            v-for="(entry, index) in entries"
            :key="entry.filename"
            :ref="(element) => setSlideRef(element, index)"
            :entry="entry"
            :index="index"
            :active="index === activeIndex"
            :should-load="Math.abs(index - activeIndex) <= 1"
            :should-cover="Math.abs(index - activeIndex) <= 2"
            :muted="muted"
            :clear-mode="clearMode"
            @toggle-mute="toggleMute"
            @clear-screen="clearMode = true"
            @exit-clear-screen="clearMode = false"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { CatalogEntry } from '~/types/catalog'
import { useFeedEndToast } from '~/composables/useFeedEndToast'

interface SlideHandle {
  togglePlay: () => void
}

const props = defineProps<{
  entries: CatalogEntry[]
  startIndex: number
}>()

const emit = defineEmits<{
  close: []
}>()

const { push } = useToast()
const scrollEl = ref<HTMLElement | null>(null)
const slideRefs = ref<Array<SlideHandle | null>>([])
const activeIndex = ref(props.startIndex)
const { muted, toggle: toggleMute } = useMuted()
const clearMode = ref(false)
let scrollFrame = 0

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
    const clamped = Math.min(Math.max(next, 0), Math.max(props.entries.length - 1, 0))
    if (clamped !== activeIndex.value) {
      activeIndex.value = clamped
    }
  })
}

function isAtDetailEnd() {
  const element = scrollEl.value
  if (!element || !props.entries.length || activeIndex.value < props.entries.length - 1) {
    return false
  }
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 4
}

const feedEnd = useFeedEndToast({ isAtEnd: isAtDetailEnd, push })

function goRelative(offset: number) {
  const element = scrollEl.value
  if (!element) {
    return
  }
  const next = Math.min(Math.max(activeIndex.value + offset, 0), props.entries.length - 1)
  if (next === activeIndex.value) {
    return
  }
  element.scrollTo({ top: next * element.clientHeight, behavior: 'smooth' })
}

function close() {
  emit('close')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    close()
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'PageDown') {
    event.preventDefault()
    if (isAtDetailEnd()) {
      feedEnd.notify()
      return
    }
    goRelative(1)
  } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
    event.preventDefault()
    goRelative(-1)
  } else if (event.key === ' ') {
    event.preventDefault()
    slideRefs.value[activeIndex.value]?.togglePlay()
  } else if (event.key === 'm' || event.key === 'M') {
    toggleMute()
  }
}

onMounted(async () => {
  await nextTick()
  const element = scrollEl.value
  if (element) {
    element.scrollTo({ top: props.startIndex * element.clientHeight })
  }
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame)
  }
})
</script>
