<template>
  <div class="tag-filter" role="group" aria-label="标签筛选">
    <button
      type="button"
      class="tag-filter__item"
      :class="{ 'is-active': selected.length === 0 }"
      @click="emit('clear')"
    >
      全部
    </button>
    <button
      v-for="tag in tags"
      :key="tag"
      type="button"
      class="tag-filter__item"
      :class="{ 'is-active': selected.includes(tag) }"
      :aria-pressed="selected.includes(tag)"
      @click="emit('toggle', tag)"
    >
      {{ tag }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  tags: string[]
  selected: string[]
}>()

const emit = defineEmits<{
  toggle: [tag: string]
  clear: []
}>()
</script>
