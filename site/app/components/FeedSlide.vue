<template>
  <section class="feed-slide" :class="{ 'feed-slide--locked': isLocked }" :data-index="index">
    <template v-if="!isLocked">
      <div class="feed-slide__poster" aria-hidden="true"></div>
      <video
        v-if="shouldLoad"
        ref="videoEl"
        class="feed-slide__video"
        :src="videoUrl"
        :muted="muted"
        playsinline
        webkit-playsinline
        loop
        preload="none"
        @click.stop="togglePlay"
        @timeupdate="onTimeUpdate"
        @play="onPlay"
        @pause="onPause"
      ></video>
      <button
        v-if="active && isPaused"
        type="button"
        class="feed-slide__play"
        aria-label="播放视频"
        @click.stop="togglePlay"
      >
        <span class="play-triangle" aria-hidden="true"></span>
      </button>
    </template>

    <div v-else class="feed-slide__locked">
      <span class="locked-badge">体积过大</span>
      <p class="locked-note">文件未入库,请前往来源观看</p>
      <a class="locked-link" :href="entry.source" target="_blank" rel="noopener noreferrer">前往来源</a>
    </div>

    <div class="feed-slide__shade" aria-hidden="true"></div>

    <aside class="feed-rail" aria-label="视频操作">
      <button
        v-if="!isLocked"
        type="button"
        class="rail-button"
        :aria-label="muted ? '开启声音' : '静音'"
        @click.stop="emit('toggleMute')"
      >
        <svg v-if="muted" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9.5h3.4L12 5.6v12.8L7.4 14.5H4z" fill="currentColor"></path>
          <path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9.5h3.4L12 5.6v12.8L7.4 14.5H4z" fill="currentColor"></path>
          <path d="M15.5 8.6a5 5 0 0 1 0 6.8M18 6.2a8.6 8.6 0 0 1 0 11.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"></path>
        </svg>
        <span>{{ muted ? '静音' : '声音' }}</span>
      </button>

      <a
        class="rail-button"
        :href="entry.source"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="打开来源页面"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 4h6v6M20 4l-8.5 8.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
          <path d="M9 6H5.5A1.5 1.5 0 0 0 4 7.5v11A1.5 1.5 0 0 0 5.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"></path>
        </svg>
        <span>来源</span>
      </a>

      <button type="button" class="rail-button" aria-label="复制来源链接" @click.stop="copySource">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 14a4 4 0 0 1 0-5.6l3-3a4 4 0 1 1 5.6 5.6l-1.3 1.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"></path>
          <path d="M14 10a4 4 0 0 1 0 5.6l-3 3A4 4 0 1 1 5.4 13l1.3-1.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"></path>
        </svg>
        <span>复制</span>
      </button>
    </aside>

    <div class="feed-slide__info">
      <p class="feed-slide__author">@{{ site.author.name }}</p>
      <h2 class="feed-slide__title">{{ entry.title }}</h2>
      <p class="feed-slide__desc">{{ entry.desc }}</p>
      <div class="feed-slide__tags">
        <span v-for="tag in entry.tags" :key="tag" class="feed-tag"># {{ tag }}</span>
      </div>
    </div>

    <div v-if="active && !isLocked" class="feed-slide__progress" aria-hidden="true">
      <span :style="{ width: progress + '%' }"></span>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { CatalogEntry } from '~/types/catalog'
import { SITE as site } from '~/utils/site'

const props = defineProps<{
  entry: CatalogEntry
  index: number
  active: boolean
  shouldLoad: boolean
  muted: boolean
}>()

const emit = defineEmits<{
  toggleMute: []
}>()

const videoEl = ref<HTMLVideoElement | null>(null)
const isPaused = ref(true)
const progress = ref(0)
const resolveVideoUrl = useVideoUrl()
const videoUrl = resolveVideoUrl(props.entry.filename)
const { push } = useToast()

const isLocked = computed(() => props.entry.flag === site.tooLargeFlag)

async function play() {
  const element = videoEl.value
  if (!element) {
    return
  }
  try {
    await element.play()
    isPaused.value = false
  } catch {
    /* 自动播放被拦截时保留播放按钮 */
    isPaused.value = true
  }
}

function pause() {
  videoEl.value?.pause()
}

function togglePlay() {
  const element = videoEl.value
  if (!element) {
    return
  }
  if (element.paused) {
    play()
  } else {
    element.pause()
  }
}

function onPlay() {
  isPaused.value = false
}

function onPause() {
  isPaused.value = true
}

function onTimeUpdate() {
  const element = videoEl.value
  if (element && element.duration > 0) {
    progress.value = (element.currentTime / element.duration) * 100
  }
}

async function copySource() {
  try {
    await navigator.clipboard.writeText(props.entry.source)
    push('来源链接已复制')
  } catch {
    push('复制失败,请手动复制', 'error')
  }
}

watch(
  () => [props.active, props.shouldLoad],
  async () => {
    if (props.active && props.shouldLoad) {
      await nextTick()
      play()
    } else {
      pause()
    }
  }
)

watch(
  () => props.muted,
  (muted) => {
    if (!muted && props.active) {
      play()
    }
  }
)

onMounted(() => {
  if (props.active && props.shouldLoad) {
    play()
  }
})

onBeforeUnmount(() => {
  pause()
})

defineExpose({ togglePlay })
</script>
