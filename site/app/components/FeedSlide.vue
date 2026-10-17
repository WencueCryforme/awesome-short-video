<template>
  <section
    class="feed-slide"
    :class="{ 'feed-slide--locked': isLocked, 'feed-slide--upstream': uiHidden }"
    :data-index="index"
  >
    <div class="feed-slide__poster" aria-hidden="true"></div>

    <iframe
      v-if="isUpstream && active"
      class="feed-slide__frame"
      width="100%"
      :src="embed?.src"
      title="上游视频"
      loading="lazy"
      referrerpolicy="unsafe-url"
      scrolling="no"
      allow="autoplay; encrypted-media; picture-in-picture"
      allowfullscreen
    ></iframe>

    <template v-else-if="!isLocked">
      <video
        v-if="shouldLoad || preloadCover"
        ref="videoEl"
        class="feed-slide__video"
        :src="videoUrl + '#t=0.1'"
        :muted="muted"
        playsinline
        webkit-playsinline
        loop
        :preload="active ? 'auto' : preloadCover ? 'metadata' : 'none'"
        @click.stop="togglePlay"
        @timeupdate="onTimeUpdate"
        @play="onPlay"
        @pause="onPause"
      ></video>
      <button
        v-if="active && isPaused && !clearMode"
        type="button"
        class="feed-slide__play"
        aria-label="播放视频"
        @click.stop="togglePlay"
      >
        <span class="play-triangle" aria-hidden="true"></span>
      </button>
    </template>

    <div v-else-if="!isUpstream" class="feed-slide__locked">
      <span class="locked-badge">体积过大</span>
      <p class="locked-note">{{ canSwitch ? '请切换上游源' : '该视频无上游源' }}</p>
    </div>

    <div v-if="uiHidden" class="feed-slide__edge feed-slide__edge--left" aria-hidden="true"></div>
    <div v-if="uiHidden" class="feed-slide__edge feed-slide__edge--right" aria-hidden="true"></div>

    <div v-if="!hideChrome" class="feed-slide__shade" aria-hidden="true"></div>

    <aside v-if="!hideChrome" class="feed-rail" aria-label="视频操作">
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

      <button
        v-if="active"
        type="button"
        class="rail-button"
        :title="canSwitch ? (isUpstream ? '切换为站内源' : '切换为上游源') : '无上游源'"
        :aria-label="canSwitch ? (isUpstream ? '切换为站内源' : '切换为上游源') : '无上游源'"
        @click.stop="emit('toggleUpstream')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7h8l-2.5-2.5M17 17H9l2.5 2.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
        </svg>
        <span>{{ isUpstream ? '站内源' : '换源' }}</span>
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

      <button
        v-if="active && !isLocked && !isUpstream"
        type="button"
        class="rail-button"
        aria-label="清屏"
        @click.stop="enterClearMode"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 3l18 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
          <path d="M10.6 6.2A10 10 0 0 1 19.5 12a10.3 10.3 0 0 1-4.2 4.7M6.2 7.2A10.2 10.2 0 0 0 4.5 12a10 10 0 0 0 12 5.9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"></path>
        </svg>
        <span>清屏</span>
      </button>
    </aside>

    <div v-if="!hideChrome" class="feed-slide__info">
      <h2 class="feed-slide__title">{{ entry.title }}</h2>
      <p class="feed-slide__desc">{{ entry.desc }}</p>
      <div class="feed-slide__tags">
        <span v-for="tag in entry.tags" :key="tag" class="feed-tag"># {{ tag }}</span>
      </div>
    </div>

    <div
      v-if="active && !isLocked && !isUpstream"
      ref="progressEl"
      class="feed-slide__progress"
      role="slider"
      tabindex="0"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="Math.round(progress)"
      aria-label="播放进度"
      @pointerdown="onSeekStart"
      @pointermove="onSeekMove"
      @pointerup="onSeekEnd"
      @pointercancel="onSeekEnd"
      @keydown.left.prevent.stop="seekBy(-5)"
      @keydown.right.prevent.stop="seekBy(5)"
    >
      <span class="feed-slide__progress-fill" :style="{ width: progress + '%' }"></span>
      <span class="feed-slide__progress-thumb" :style="{ left: progress + '%' }"></span>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { CatalogEntry } from '~/types/catalog'
import { resolveEmbed } from '~/utils/embed'
import { SITE as site } from '~/utils/site'

const props = defineProps<{
  entry: CatalogEntry
  index: number
  active: boolean
  shouldLoad: boolean
  preloadCover: boolean
  muted: boolean
  upstream: boolean
}>()

const emit = defineEmits<{
  toggleMute: []
  toggleUpstream: []
}>()

const videoEl = ref<HTMLVideoElement | null>(null)
const progressEl = ref<HTMLDivElement | null>(null)
const isPaused = ref(true)
const isSeeking = ref(false)
const clearMode = ref(false)
const progress = ref(0)
let lastToggleAt = 0
const CLICK_COOLDOWN_MS = 300
const resolveVideoUrl = useVideoUrl()
const videoUrl = resolveVideoUrl(props.entry.filename)
const { push } = useToast()

const isLocked = computed(() => props.entry.flag === site.tooLargeFlag)
const embed = computed(() => resolveEmbed(props.entry))
const canSwitch = computed(() => embed.value !== null)
const isUpstream = computed(() => props.upstream && canSwitch.value)
const uiHidden = computed(() => isUpstream.value && props.active)
const hideChrome = computed(() => uiHidden.value || clearMode.value)

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
  const now = Date.now()
  if (now - lastToggleAt < CLICK_COOLDOWN_MS) {
    return
  }
  lastToggleAt = now
  if (element.paused) {
    play()
  } else {
    element.pause()
  }
}

function enterClearMode() {
  clearMode.value = true
}

function onPlay() {
  isPaused.value = false
}

function onPause() {
  isPaused.value = true
}

function onTimeUpdate() {
  if (isSeeking.value) {
    return
  }
  const element = videoEl.value
  if (element && element.duration > 0) {
    progress.value = (element.currentTime / element.duration) * 100
  }
}

function seekToClientX(clientX: number) {
  const bar = progressEl.value
  const element = videoEl.value
  if (!bar || !element || !Number.isFinite(element.duration) || element.duration <= 0) {
    return
  }
  const rect = bar.getBoundingClientRect()
  const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
  element.currentTime = ratio * element.duration
  progress.value = ratio * 100
}

function onSeekStart(event: PointerEvent) {
  clearMode.value = false
  isSeeking.value = true
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  seekToClientX(event.clientX)
}

function onSeekMove(event: PointerEvent) {
  if (!isSeeking.value) {
    return
  }
  seekToClientX(event.clientX)
}

function onSeekEnd(event: PointerEvent) {
  isSeeking.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }
}

function seekBy(seconds: number) {
  clearMode.value = false
  const element = videoEl.value
  if (!element || !Number.isFinite(element.duration)) {
    return
  }
  element.currentTime = Math.min(Math.max(element.currentTime + seconds, 0), element.duration)
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
  () => [props.active, props.shouldLoad, isUpstream.value],
  async () => {
    if (!props.active || isUpstream.value) {
      clearMode.value = false
    }
    if (props.active && props.shouldLoad && !isUpstream.value) {
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
    if (!muted && props.active && !isUpstream.value) {
      play()
    }
  }
)

onMounted(() => {
  if (props.active && props.shouldLoad && !isUpstream.value) {
    play()
  }
})

onBeforeUnmount(() => {
  pause()
})

defineExpose({ togglePlay })
</script>
