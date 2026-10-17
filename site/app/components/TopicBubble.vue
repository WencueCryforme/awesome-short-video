<template>
  <Teleport to="body">
    <Transition name="bubble">
      <div v-if="open" class="topic-popover-layer" @click.self="emit('apply')">
        <div class="topic-bubble" role="dialog" aria-label="选择话题">
          <button
            v-for="tag in tags"
            :key="tag"
            type="button"
            class="topic-chip"
            :class="{ 'is-selected': selected.includes(tag) }"
            :aria-pressed="selected.includes(tag)"
            @click.stop="emit('toggle', tag)"
          >
            {{ tag }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  open: boolean
  tags: string[]
  selected: string[]
}>()

const emit = defineEmits<{
  toggle: [tag: string]
  apply: []
}>()
</script>
