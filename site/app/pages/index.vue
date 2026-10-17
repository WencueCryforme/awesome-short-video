<template>
  <main class="page">
    <section class="hero shell">
      <p class="hero__eyebrow">COLLECTION</p>
      <h2 class="hero__title">把喜欢的片段,留在一块屏幕上</h2>
      <p class="hero__lead">
        {{ entries.length }} 个条目,其中 {{ playableCount }} 个支持站内播放,
        {{ tooLargeCount }} 个体积过大仅保留来源跳转
      </p>
      <dl class="hero__stats">
        <div class="stat">
          <dt>条目</dt>
          <dd>{{ entries.length }}</dd>
        </div>
        <div class="stat">
          <dt>站内可播</dt>
          <dd>{{ playableCount }}</dd>
        </div>
        <div class="stat">
          <dt>标签分类</dt>
          <dd>{{ presetTags.length }}</dd>
        </div>
      </dl>
    </section>

    <section class="toolbar shell">
      <label class="search">
        <span class="search__icon" aria-hidden="true"></span>
        <input
          v-model="query"
          type="search"
          class="search__input"
          placeholder="搜索标题或简介"
          aria-label="搜索标题或简介"
        >
        <button
          v-if="query"
          type="button"
          class="search__clear"
          aria-label="清除搜索"
          @click="query = ''"
        >
          &times;
        </button>
      </label>
      <p class="toolbar__result">
        当前显示 {{ filtered.length }} / {{ entries.length }} 个条目
      </p>
    </section>

    <section class="shell">
      <TagFilter :tags="presetTags" :selected="selectedTags" @toggle="toggleTag" @clear="clearTags" />
      <div v-if="selectedTags.length" class="filter-note">
        <span>已选 {{ selectedTags.length }} 个标签,取交集</span>
        <button type="button" class="text-button" @click="clearTags">清除筛选</button>
      </div>
    </section>

    <section class="shell grid-wrap">
      <TransitionGroup v-if="filtered.length" tag="div" name="card" class="grid">
        <VideoCard
          v-for="entry in filtered"
          :key="entry.filename"
          :entry="entry"
          :large="isTooLarge(entry)"
          @open="openPlayer"
        />
      </TransitionGroup>
      <div v-else class="empty">
        <p class="empty__title">没有匹配的条目</p>
        <p class="empty__note">试着减少标签或更换关键字</p>
        <button type="button" class="solid-button" @click="resetAll">重置筛选</button>
      </div>
    </section>

    <VideoPlayer
      v-if="activeEntry"
      :entry="activeEntry"
      :video-url="activeVideoUrl"
      @close="activeEntry = null"
    />
  </main>
</template>

<script setup lang="ts">
import type { CatalogEntry } from '~/types/catalog'

const { entries, playableCount, tooLargeCount, presetTags } = useCatalog()
const videoUrl = useVideoUrl()
const { push } = useToast()

const query = ref('')
const selectedTags = ref<string[]>([])
const activeEntry = ref<CatalogEntry | null>(null)

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return entries.filter((entry) => {
    const tagsMatched = selectedTags.value.every(tag => entry.tags.includes(tag))
    if (!tagsMatched) {
      return false
    }
    if (!keyword) {
      return true
    }
    return (entry.title + ' ' + entry.desc).toLowerCase().includes(keyword)
  })
})

const activeVideoUrl = computed(() => {
  return activeEntry.value ? videoUrl(activeEntry.value.filename) : ''
})

function toggleTag(tag: string) {
  const index = selectedTags.value.indexOf(tag)
  if (index >= 0) {
    selectedTags.value = selectedTags.value.filter(item => item !== tag)
  } else {
    selectedTags.value = [...selectedTags.value, tag]
  }
}

function clearTags() {
  selectedTags.value = []
}

function resetAll() {
  query.value = ''
  selectedTags.value = []
}

function openPlayer(entry: CatalogEntry) {
  if (isTooLarge(entry)) {
    push('该视频体积过大,请前往来源观看', 'error')
    return
  }
  activeEntry.value = entry
}

useSeoMeta({
  title: '精选短视频收藏',
  ogTitle: '精选短视频收藏'
})
</script>
