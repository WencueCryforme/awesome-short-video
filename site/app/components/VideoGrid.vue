<template>
  <div v-if="entries.length" class="result-grid">
    <button
      v-for="entry in entries"
      :key="entry.filename"
      type="button"
      class="result-card"
      @click="emit('select', entry)"
    >
      <span class="result-card__cover">
        <img
          class="result-card__media"
          :src="coverUrl(entry.filename)"
          alt=""
          loading="lazy"
          decoding="async"
        />
        <span class="result-card__play" aria-hidden="true"></span>
      </span>
      <span class="result-card__body">
        <span class="result-card__title">{{ entry.title }}</span>
        <span class="result-card__tags">
          <span v-for="tag in entry.tags" :key="tag"># {{ tag }}</span>
        </span>
      </span>
    </button>
  </div>
  <div v-else class="panel-empty">
    <p class="panel-empty__title">没有匹配的内容</p>
    <p class="panel-empty__note">换个关键词或话题试试</p>
  </div>
</template>

<script setup lang="ts">
import type { CatalogEntry } from '~/types/catalog'

defineProps<{
  entries: CatalogEntry[]
}>()

const emit = defineEmits<{
  select: [entry: CatalogEntry]
}>()

const resolveCoverUrl = useCoverUrl()
const coverUrl = (filename: string) => resolveCoverUrl(filename)
</script>
