<template>
  <header class="top-nav" :class="{ 'top-nav--over-video': overVideo }">
    <button type="button" class="nav-icon" aria-label="打开侧边栏" @click="emit('menu')">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"></path>
      </svg>
    </button>

    <nav class="nav-tabs" aria-label="主导航">
      <button
        type="button"
        class="nav-tab"
        :class="{ 'is-active': active === 'home' }"
        @click="emit('select', 'home')"
      >
        首页
      </button>
      <button
        type="button"
        class="nav-tab"
        :class="{ 'is-active': active === 'topics' }"
        @click="emit('select', 'topics')"
      >
        话题
      </button>
    </nav>

    <button
      type="button"
      class="nav-icon"
      :class="{ 'is-active': active === 'search' }"
      aria-label="搜索"
      @click="emit('search')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.8" cy="10.8" r="6.2" stroke="currentColor" stroke-width="1.9" fill="none"></circle>
        <path d="M15.4 15.4L20 20" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
      </svg>
    </button>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  active: 'home' | 'topics' | 'search'
  overVideo?: boolean
}>()

const emit = defineEmits<{
  menu: []
  select: [tab: 'home' | 'topics']
  search: []
}>()
</script>
