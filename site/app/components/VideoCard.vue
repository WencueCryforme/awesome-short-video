<template>
  <article class="card" :class="{ 'card--locked': large }">
    <div class="card__media">
      <button
        v-if="!large"
        type="button"
        class="card__play"
        :aria-label="'播放 ' + entry.title"
        @click="emit('open', entry)"
      >
        <span class="play-icon" aria-hidden="true"></span>
      </button>
      <div v-else class="card__locked">
        <span class="card__locked-badge">体积过大</span>
        <span class="card__locked-note">文件未入库,请前往来源观看</span>
      </div>
      <span class="card__duration" aria-hidden="true">
        {{ large ? '外链' : '站内播放' }}
      </span>
    </div>
    <div class="card__body">
      <h3 class="card__title">{{ entry.title }}</h3>
      <p class="card__desc">{{ entry.desc }}</p>
      <div class="card__tags">
        <span v-for="tag in entry.tags" :key="tag" class="tag">{{ tag }}</span>
      </div>
      <div class="card__footer">
        <button v-if="!large" type="button" class="text-button" @click="emit('open', entry)">
          播放视频
        </button>
        <a
          v-else
          class="text-button text-button--accent"
          :href="entry.source"
          target="_blank"
          rel="noopener noreferrer"
        >
          前往来源
        </a>
        <a
          class="card__source"
          :href="entry.source"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="'查看 ' + entry.title + ' 的来源'"
        >
          来源
        </a>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import type { CatalogEntry } from '~/types/catalog'

defineProps<{
  entry: CatalogEntry
  large: boolean
}>()

const emit = defineEmits<{
  open: [entry: CatalogEntry]
}>()
</script>
