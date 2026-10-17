<template>
  <Teleport to="body">
    <div class="search-detail-layer" @click.self="close">
      <div class="search-detail-shell">
        <button type="button" class="search-detail-back" aria-label="返回搜索" @click="close">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
          </svg>
        </button>

        <div ref="scrollEl" class="feed-scroll" @scroll.passive="onScroll">
          <FeedSlide
            v-for="(entry, index) in entries"
            :key="entry.filename"
            :ref="(element) => setSlideRef(element, index)"
            :entry="entry"
            :index="index"
            :active="index === activeIndex"
            :should-load="Math.abs(index - activeIndex) <= 1"
            :preload-cover="index > activeIndex && index <= activeIndex + 2"
            :muted="muted"
            :upstream="upstreams.has(entry.filename)"
            :clear-mode="clearMode"
            @toggle-mute="muted = !muted"
            @toggle-upstream="toggleUpstream(entry)"
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
import { canEmbed } from '~/utils/embed'

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
const muted = ref(true)
const clearMode = ref(false)
const upstreams = ref<Set<string>>(
  new Set(
    props.entries
      .filter(entry => entry.default_mod === 'upstream' && canEmbed(entry))
      .map(entry => entry.filename)
  )
)
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
    activeIndex.value = Math.min(Math.max(next, 0), Math.max(props.entries.length - 1, 0))
  })
}

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
    goRelative(1)
  } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
    event.preventDefault()
    goRelative(-1)
  } else if (event.key === ' ') {
    event.preventDefault()
    slideRefs.value[activeIndex.value]?.togglePlay()
  } else if (event.key === 'm' || event.key === 'M') {
    muted.value = !muted.value
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
