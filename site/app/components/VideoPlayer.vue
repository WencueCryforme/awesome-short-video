<template>
  <Teleport to="body">
    <div class="player" role="dialog" aria-modal="true" :aria-label="entry.title" @click.self="close">
      <div class="player__panel">
        <div class="player__bar">
          <p class="player__heading">{{ entry.title }}</p>
          <button type="button" class="player__close" aria-label="关闭播放器" @click="close">
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        <video
          ref="videoEl"
          class="player__video"
          :src="videoUrl"
          controls
          autoplay
          playsinline
          preload="metadata"
        ></video>
        <div class="player__meta">
          <p class="player__desc">{{ entry.desc }}</p>
          <div class="player__row">
            <div class="card__tags">
              <span v-for="tag in entry.tags" :key="tag" class="tag">{{ tag }}</span>
            </div>
            <a class="player__source" :href="entry.source" target="_blank" rel="noopener noreferrer">
              查看来源
            </a>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { CatalogEntry } from '~/types/catalog'

const props = defineProps<{
  entry: CatalogEntry
  videoUrl: string
}>()

const emit = defineEmits<{
  close: []
}>()

const videoEl = ref<HTMLVideoElement | null>(null)

function close() {
  const el = videoEl.value
  if (el) {
    el.pause()
    el.removeAttribute('src')
    el.load()
  }
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    close()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.body.classList.add('is-locked')
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.classList.remove('is-locked')
})
</script>
