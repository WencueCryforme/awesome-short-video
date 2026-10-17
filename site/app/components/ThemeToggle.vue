<template>
  <button
    type="button"
    class="icon-button"
    :aria-label="isLight ? '切换到暗色主题' : '切换到亮色主题'"
    :title="isLight ? '切换到暗色主题' : '切换到亮色主题'"
    @click="toggle"
  >
    <svg v-if="isLight" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" fill="currentColor"></path>
    </svg>
    <svg v-else viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="currentColor"></circle>
      <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7"></path>
      </g>
    </svg>
  </button>
</template>

<script setup lang="ts">
const { isLight, toggle } = useTheme()
</script>
